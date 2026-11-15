# Kronos build kit

An event-sourced service on [kronos-ts](https://www.npmjs.com/package/@kronos-ts/core) (DCB), running on Bun:
KronosDB holds the events and carries commands and queries between the app's instances; Postgres holds the read
models, processor tokens and dead letters; oRPC is the HTTP contract (`/openapi.json`). Every slice on the board becomes one folder under `src/slices/<context>/<slice>/`.

At the start of every session, read `.build-kit/AGENTS.md` if it exists: the learnings recorded so far. Record a new
one with `npx @eventmodelers/cli learn "<one terse line>" --topic <topic>`, never by editing the file.

When working from a queued task, invoke the `update-slice-status` skill with `InProgress` before anything else. When
the task request names the slice to build (a run-loop build), the run loop has already claimed it and pushes the
final status itself: do not call `update-slice-status`; record the outcome with
`npx @eventmodelers/cli slice-status <status>`.

## Commands

| What | Command |
|---|---|
| Start Postgres + KronosDB | `bun run infra:up` (needed by the specs of a slice with tables and by the app) |
| Typecheck | `bun run typecheck` |
| One slice's specs | `bun test src/slices/<context>/<slice>` |
| Migration after a `schema.ts` change | `bun run db:generate` (commit what it writes to `migrations/`) |
| Removing one table and adding another | `bun run db:generate` after the removal, then again after the addition: in one run drizzle-kit asks whether the table was renamed, and cannot be answered without a terminal |
| Run the app | `bun run dev` (`/openapi.json`, `/health`) |

## The project

```
src/kit/        the conventions slices follow, nothing more: `result`/`rejection` (command.ts), `documented`/
                `problemsOf`/`statusesOf`/`mergeStatuses` (contract.ts), `refuse` (controller.ts),
                `CommandContext`/`QueryContext`/`EventContext`, `drizzleHandler` (`ctx.db`), `untraced`, `pipe`; and
                testing.ts: the `rejected(code)` assertion. kronos-ts, oRPC and Drizzle are used directly, with their
                own types
src/app/http.ts the HTTP edge: `serve(app, { router, statuses }, options)` (statuses, problem documents, correlation,
                the request span)
src/config.ts   the infrastructure, every piece built and configured here and nowhere else: core's
                `eventProcessor` (the log, tokens and unit of work applied) and `deadLettering` (the dead-letter queue
                applied), Postgres, KronosDB, the event store, the buses, and `close`. There is no local or in-memory
                mode: locally it is the same file over `bun run infra:up`
src/server.ts   the HTTP side: `listen(running)` serves every context's procedures (port, API docs, `identify`)
src/migrate.ts  the read models' migrations, applied at boot from `config.ts`
src/telemetry.ts the log, and the OTLP exporter when `OTEL_EXPORTER_OTLP_ENDPOINT` is set
src/main.ts     the final wiring: `const handlers = app(eventProcessor, deadLettering)`, the app's three lists from
                `src/slices/index.ts`; then `kronos({ … })`, a list for each kind at least one slice has
                (`handlers.commandHandlers.map(…)`), each `handler` piped through the wrappers its kind shares (`ctx.db`
                for queries and event handlers, validation, correlation, logging, tracing) and handed the log and the
                buses from `config.ts`, written out in place; then `listen(running)` and shutdown. It names no context
                and no slice and builds no infrastructure. No type annotations: everything is inferred from the
                handlers. The starter has no slice, so it runs `kronos({})`
src/env.ts      every environment variable, typed, parsed once and exported as `env`. `DATABASE_URL` and
                `KRONOSDB_HOST` are required
test/           `testInfrastructure({ db? })`: the same infrastructure in memory (a fresh Postgres database with
                `db: true`), its `eventProcessor` and `deadLettering`, and `app(handlers)`, which takes a slice's
                three lists and writes out `main.ts`'s composition again over them: the same wrappers and `kronos()`,
                handed to `fixture()` once per spec file
src/slices/
  index.ts      every context the app runs, in three places: `app`, the app's three lists, the sum of every
                context's (each context called once, its lists spread into the app's); `router`, every context's
                procedures; and `statuses`, every context's HTTP statuses. A new context adds a line to each
  <context>/
    index.ts    a function returning the context's three lists, the sum of its slices' (each slice spread into
                every list it has handlers for), and what only they use (an outside system's client), built once and
                handed to the slices that need it; beside it, the context's `router` and `statuses`, merged from its
                slices'
    events.ts   the context's namespace and EVERY event in it; the only thing slices share
    <slice>/    one folder per board slice: command.ts (with its rejections) or query.ts, state.ts (EVERY fold
                the slice loads — its decision's and its automation's alike — never a file of its own), handler.ts,
                and what the slice's skill lists
```

`#kit` is the kit; `#kit/result` and `#kit/problems` are its browser-safe parts (zod only), which
`command.ts`, `query.ts` and `contract.ts` import (`contract.ts` imports `command.ts`/`query.ts` too: they hold
only zod, `#kit/result` and the context's `events.ts`). Never import `#kit` itself from those files.

A slice's `index.ts` exports a function of exactly what the slice uses, returning its handlers in three lists,
`{ commandHandlers, queryHandlers, eventHandlers }`, all three always, an empty one for each kind it has none of,
and, beside it, its HTTP side as plain values:

```ts
export const addItem = () => ({ commandHandlers: [handle], queryHandlers: [], eventHandlers: [] })
export { router } from "./controller"
export { statuses } from "./contract"
```

What a slice may take, each only when it uses it, always in this order and under these names:
- an outside system's client (see "What a slice needs from outside"): `publisher: CartPublisher`;
- `eventProcessor: (name: string) => EventProcessor`, when it has event handlers: core's `eventProcessor` with the
  log, tokens and unit of work already applied. The slice names and shapes its own processor with it
  (`batched(eventProcessor("cart-items"), 100)`) and puts every event handler on it;
- `deadLettering: (processor: EventProcessor, sequence: Sequence) => EventProcessor`, when its processor dead-letters: core's
  `deadLettering` with the app's dead-letter queue already applied. The slice gives it only its processor and its
  lanes (`deadLettering(concurrent(…, perCart), perCart)`) and never sees the queue.
Nothing else. A slice never takes the database and never puts a wrapper over its handlers for it: `main.ts` pipes
every query and event handler through `drizzleHandler` so it gets `ctx.db`, in the handling's transaction, so a slice with tables returns its handlers as they
are (`cartItems = (eventProcessor) => ({ commandHandlers: [], queryHandlers: [handle], eventHandlers: … })`). A decision takes nothing: `addItem()`. HTTP needs nothing from outside (a
controller reaches the buses through its request's `Edge`), so `router` and `statuses` are never inside the function.

Every level exposes the same three lists, and each level above is their sum: a slice returns its
`{ commandHandlers, queryHandlers, eventHandlers }`, a context returns the sum of its slices' lists, and `main.ts`
gives `kronos()` the sum of its contexts' lists. Nothing is grouped to be taken apart again.

The slice is called in its context's `index.ts`, which exports a function of what its slices use returning the three
lists, each one its slices' lists of that kind spread into it, and the context's `router` and `statuses` merged from
theirs. A slice is spread into every list it has handlers for, so a read model is in `queryHandlers` and in
`eventHandlers`; a list it is missing from never runs, and nothing fails until a request reaches it. A slice that builds
a processor is called once, into a const, so its lists share that processor; a slice that takes nothing is called
where its list is spread:

```ts
export const understandingEventsourcing = (
  eventProcessor: (name: string) => EventProcessor,
  deadLettering: (processor: EventProcessor, sequence: Sequence) => EventProcessor,
) => {
  const cart = cartItems(eventProcessor)
  const archive = archiveItem(eventProcessor)
  const publish = publishCart(publisher, eventProcessor, deadLettering)
  return {
    commandHandlers: [
      ...addItem().commandHandlers,
      ...archive.commandHandlers,
      ...submitCart().commandHandlers,
      ...publish.commandHandlers,
    ],
    queryHandlers: [...cart.queryHandlers],
    eventHandlers: [...cart.eventHandlers, ...archive.eventHandlers, ...publish.eventHandlers],
  }
}
export const router = { ...addItemRouter, ...cartItemsRouter, ...submitCartRouter }
export const statuses = mergeStatuses(addItemStatuses, submitCartStatuses)
```

`src/slices/index.ts` sums the contexts the same way, so every context the app runs is in that one file, beside its
`router` and `statuses`:

```ts
export const app = (
  eventProcessor: (name: string) => EventProcessor,
  deadLettering: (processor: EventProcessor, sequence: Sequence) => EventProcessor,
) => {
  const understandingEventsourcingHandlers = understandingEventsourcing(eventProcessor, deadLettering)
  return {
    commandHandlers: [...understandingEventsourcingHandlers.commandHandlers],
    queryHandlers: [...understandingEventsourcingHandlers.queryHandlers],
    eventHandlers: [...understandingEventsourcingHandlers.eventHandlers],
  }
}
```

`main.ts` takes the app's three lists from there and gives each kind to `kronos()`, writing out what every handler is
piped through and handed. It never names a context or a slice. `main.ts` has no type annotations: TypeScript infers
everything from the handlers that exist. An empty list has no type to infer, so a kind no slice has yet is left out of
`kronos({ … })`, and an app with no slice runs `kronos({})`. With every kind, it reads:

```ts
const handlers = app(eventProcessor, deadLettering)
const running = kronos({
  commandHandlers: handlers.commandHandlers.map((handler) => ({
    ...handler,
    handler: pipe(
      handler.handler,
      (next) => validatingHandler(next, handler.descriptor),
      (next) => correlatingHandler(next, origin),
      (next) => loggingHandler(next, log),
      (next) => (exporter ? otlpHandler(next, exporter) : untraced(next)),
    ),
    eventStore,
    commandBus,
    queryBus,
  })),
  queryHandlers: handlers.queryHandlers.map((handler) => ({
    ...handler,
    handler: pipe(
      handler.handler,
      (next) => drizzleHandler(next),
      (next) => postgresHandler(next, pg),
      (next) => validatingHandler(next, handler.descriptor),
      (next) => correlatingHandler(next, origin),
      (next) => loggingHandler(next, log),
      (next) => (exporter ? otlpHandler(next, exporter) : untraced(next)),
    ),
    eventStore,
    queryBus,
  })),
  eventHandlers: handlers.eventHandlers.map((handler) => ({
    ...handler,
    handler: pipe(
      handler.handler,
      (next) => drizzleHandler(next),
      (next) => postgresHandler(next, pg),
      (next) => validatingHandler(next, handler.descriptor),
      (next) =>
        correlatingHandler(next, (m) => ({ ...messageOrigin(m), actor: handler.processor.name, actorType: "automation" })),
      (next) => loggingHandler(next, log),
      (next) => (exporter ? otlpHandler(next, exporter) : untraced(next)),
    ),
    eventStore,
    commandBus,
    queryBus,
  })),
})
```

The first slice of a kind adds that kind's list to `kronos({ … })`, exactly as above; every name it uses is already
imported in `main.ts`, from `config.ts`. A new context gets an `index.ts` of its own and, in `src/slices/index.ts`, a line in each of
the three places: in `app` its call into a const
(`const accountsLoginHandlers = accountsLogin(eventProcessor, deadLettering)`) and one spread in each of the app's
lists it has handlers for (`[...understandingEventsourcingHandlers.commandHandlers, ...accountsLoginHandlers.commandHandlers]`);
its router under the context's camelCase name in `router` (`accountsLogin: accountsLoginRouter`, never a quoted key:
the key is in every operation id, `accountsLogin.signUp`); and its `statuses` in `mergeStatuses(…)`. A new context
never touches `main.ts`. Never add a type annotation to `main.ts`.

**kronos-ts is plain TypeScript, and its source ships with it.** It is newer than what you were trained on, so do not
guess its API from other frameworks. The slice's worked example comes first; when you need more (what a function
does, what a context offers, why something throws), read `node_modules/@kronos-ts/<package>/src/` (`core`,
`kronosdb`, `postgres`, `test`, `otlp`): no decorators, no generated code, no runtime magic, so what it does is
what you read. Never edit it.

## Building a slice

**CRITICAL: always build a slice with its skill. Never implement one by hand.**
**Every field, event, command, read model and rule comes from `slice.json`. Invent nothing** (one exception: the
id a create command carries, see "Ids" below).

1. Read `.build-kit/.slices/<context>/<slice>/slice.json`. A file with only id/title/status/sliceType is a summary
   stub, not an empty slice: run `/load-slice` with its `sliceId` and read it again.
   Read it as the board wrote it:
   - every element's `comments` and `description`, and the slice's own, are hints from the board's authors: use them
     where they explain a rule, a field or an endpoint (never as a source of new behaviour). When the slice is done,
     resolve each comment you used:
     `POST <BASE_URL>/api/org/<ORG_ID>/boards/<BOARD_ID>/nodes/<nodeId>/comments/<commentId>/resolve` (the comment
     ids from a GET on the same path without the last two segments; see `learn-eventmodelers-api`);
   - in a storyline, an entry with `type: STORYLINE_NOTE` is a note (an assumption, an outside condition, a gap in
     time), not a beat: read it as background for the beats around it, never as a step, a test's setup or an
     assertion, and skip it when deciding which beats follow each other.
2. Pick the skill:
   - every element (`commands`, `events`, `readmodels`, `processors`) has `elementCopy: true` → a **copy-only slice**,
     already built where its originals live (see "Copy-only slices" below): no skill, no code
   - `processors` non-empty, or `sliceType` `AUTOMATION` / `TRANSLATION` → `/build-automation`. One automation the
     board spreads over several slices (its todo list in one, the automation in another) is built once, as the
     automation slice
   - `readmodels` non-empty (`STATE_VIEW`) whose read model feeds an AUTOMATION (an OUTBOUND dependency to a
     processor) and reads as a todo list (rows the automation acts on, which come and go) → **it belongs to that
     automation slice**: it is the automation's state, whatever its status and wherever the board slices it, planned
     before or after the automation. Nothing is built for it as a slice of its own, ever: no projection, no table;
     record `Done` with `info --kind note` naming the automation slice that owns it. If the same read model also
     feeds a screen, it is in addition an ordinary view: `/build-state-view` builds it for the screen (no contract
     for the automation, no read it exports), and the automation still keeps its own state.
   - `commands` non-empty (`STATE_CHANGE`) → `/build-state-change`
   - only `events` (`UNDEFINED`, an event-only slice) → add each event to `<context>/events.ts` (rules below) and
     nothing else; its specs, if any, belong to the slices that append or read it.
3. Follow the skill completely.
4. **Baseline gate**: run `npx @eventmodelers/cli build-baseline check --scope backend` first. `UNCHANGED`: do not
   rebuild, run the slice's specs and finish. `NO_BASELINE` / `CHANGED`: diff `slice.json` against the code field by
   field and fix every drift. After the checks pass and before committing, run
   `npx @eventmodelers/cli build-baseline record --scope backend`, and commit the baseline file it writes with the
   slice.
5. Verify against `slice.json`: every field and every specification is in the code, nothing else is. A slice's
   tests are its scenarios, exactly (see "Tests are the model's scenarios").
6. `bun run typecheck`, then the slice's specs. A spec file builds ONE fixture over infrastructure from
   `testInfrastructure` (`#test`), calling the slice with it as its context does, and runs every scenario on it:
   `const { app, eventProcessor } = await testInfrastructure({ db: true })`,
   `const scenarios = fixture(app(cartItems(eventProcessor)))`. `app` takes one slice's three lists, pipes every handler through `main.ts`'s wrappers and runs `kronos()`, as
   `main.ts` does. Scenarios share
   the app and nothing is reset between them, so each `it(...)` mints its own ids with `Bun.randomUUIDv7()`.
   `testInfrastructure` stops the app, and drops its database, after the file's last test. A slice with tables needs
   `{ db: true }` and `bun run infra:up`; without it the app runs in memory over a database it never connects to.
7. With handover on, publish the slice's UI contract (the skill's "UI Contract" step, `bun run ui-contract <path>`).
   Commit `feat: [Slice Name]`, then record `Done` (or `Waiting` with handover, see the `ui-contract` skill). A
   task with a `Target status: <status>` line records exactly that status instead, whatever the slice.

## Decisions the model leaves to you

The board decides the business; this kit decides the rest, the same way every time. Apply these without asking.

**Names.** Context folder and namespace: the context name in kebab-case (`Understanding Eventsourcing` →
`understanding-eventsourcing`). Slice folder: the slice title in kebab-case (`Add Item` → `add-item`). Commands,
events and queries: the element title in PascalCase (`Item Added` → `ItemAdded`). The oRPC procedure: the slice
title in camelCase (`addItem`).

**Field types.**

| slice.json `type` | zod |
|---|---|
| `String` | `z.string()` |
| `UUID` | `z.uuid()` |
| `Int`, `Long` | `z.number().int()` |
| `Double`, `Decimal` | `z.number()` |
| `Boolean` | `z.boolean()` |
| `Date` | `z.iso.date()` |
| `DateTime` | `z.iso.datetime({ offset: true })` |
| `Custom` | `z.object({...})` of its `subfields` |

`cardinality: "List"` wraps it in `z.array(...)`; `optional: true` adds `.optional()`.

**What a request may leave empty.** On a command's or a query's payload (what a caller sends, and so the contract's
Request), a required `String` is `z.string().min(1)`: an empty string is a missing value, refused with the other
invalid fields before any handler runs. A field that may really be empty is modeled `optional`. Where the field's
name or its examples say what it holds, use that format: an email address is `z.email()`, a URL `z.url()`. Rules
with a number in them (at least 10 characters) stay decisions with a rejection, as the specification says, not schema
limits. Events keep the plain mapping: they record what a decision accepted.

**Validation lives in the schemas, never in a handler.** Every field's constraint (an id is `z.uuid()`, an instant
`z.iso.datetime(...)`) is declared on the descriptor: the command's, query's or event's payload, with the type of the
board field it comes from, also when the field is a query's id. `main.ts` pipes every handler
through `validatingHandler`, which checks the payload before the handler runs and every message the handler appends or sends,
and oRPC checks the request against the same schema at the edge. So a handler never calls `parse` or `safeParse`, and
never guards against a value its schema already refuses. A request the schema refuses is answered 400 at the edge with a
problem document whose `errors` name each field (`pointer`) and what is wrong (`detail`), in the shape of a rejection. What stays in a handler is a business rule a specification
names (a password too short, too many attempts): that is a decision with its own rejection, not validation.

**Ids are minted by the client and validated by the server.** A command that creates something carries the id of
what it creates, minted by the client (a UUIDv7) and validated by the server (`z.uuid()`), even when the board marks
that id `generated` on the event or leaves it off the command: `generated` means "not typed by the user", not "made
by the server". This is the one exception to "invent nothing": the created thing's id on its create command, and
nothing else. The handler never generates an id. Sending the same command again must land once: when what it would
record is already true, return `{ ok: true }` and append nothing.

**A generated timestamp is the time the command is created.** A `DateTime` or `Date` field the board marks
`generated` on a command is the current time as of creating the command, never a value the client sends. The
contract `.omit`s it from the Request (a client cannot leave it out or backdate it), and the controller stamps it
with Temporal: `call.context.send(SubmitCart, { ...call.input, submittedAt: Temporal.Now.instant().toString() })`
(a `Date`: `Temporal.Now.plainDateISO().toString()`). The controller is the one place that reads the clock with
`Temporal.Now`; the handler takes the value from the payload, as it does every other field. A command an automation
sends gets its generated timestamp from the automation, which takes it from its trigger, so a repeat records the
same value: the trigger's own field when it carries one, else the trigger's time,
`Temporal.Instant.fromEpochMilliseconds(trigger.timestamp).toString()`. Worked example: `/build-state-change`'s
`references/example/submit-cart/` (`command.ts`, `contract.ts`, `controller.ts`).

**Time comes from the unit of work, as Temporal.** A handler's current instant is
`Temporal.Instant.fromEpochMilliseconds(ctx.unitOfWork.now())`: a test moves it, and every message of the handling
carries it. Never `Date.now()`, `new Date()` or `Temporal.Now` in a handler (a controller stamping a generated
timestamp is the one `Temporal.Now`, see above). In code, dates and times are Temporal
values: `Instant`, `PlainDate`, `ZonedDateTime`, and `Duration` for spans ("24 hours" is
`Temporal.Duration.from({ hours: 24 })`), never millisecond arithmetic. In events, payloads and on the wire they are
ISO strings (the type table above), turned into Temporal where they are compared or computed:
`Temporal.Instant.from(sentAt)`, `Temporal.PlainDate.from(dueOn)`. A `Date` exists only at a driver's boundary (a
Drizzle `timestamp` column), converted right there. Worked example: `/build-state-change`'s `references/time/`.

**Consistency boundary.** A decision (a command, or a stateful automation) loads a `state` keyed by the id(s) it is
about: the field(s) with `idAttribute: true` when the model flags them (a hint, not a rule), otherwise the id the
command or trigger is about (`aggregateId`, or the `…Id` field naming the thing it changes). Record a choice the model
did not make with `info --kind decision`.

**State holds facts, never placeholders.** A `state` folds only what its decision reads that the message being
handled does not carry: what the trigger's payload holds is taken from the payload, never folded again. Its initial
value is a real one, with nothing standing for "not yet": no `null`, no `undefined`, and no optional field (`hash?:
string`, `lastSentAt?: string`), which is the same placeholder spelled differently:
- a yes/no fact is a boolean: `{ published: false }`;
- a collection starts empty: `{ items: [] }`;
- something with phases is a union of them, each holding only what it has:
  `{ reminded: false } | { reminded: true; lastSentAt: string }`, narrowed with `if (s.reminded)`. A fact that
  arrives on its own (a password, the latest link) is a phase of its own:
  `{ password: { set: false } | { set: true; hash: string } }`.
Always give the initial value its type (`(): { published: boolean } => ({ published: false })`): without it
TypeScript infers the literal (`false`, `[]`) and the fold's type collapses to `never`. A union of phases is named
once (`type Phase = { phase: "unsent" } | { phase: "sent"; token: string }`) and every fold returns it
(`(s, { payload }): Phase => …`): then no `as const` is needed, and a fold that returns the wrong shape fails where it
is written. `evolve` puts each entry on its own line, the initial value first and then one `[Event, fold]` per line,
however few there are:

```ts
evolve: [
  (): { published: boolean } => ({ published: false }),
  [CartPublished, () => ({ published: true })],
],
```

**Tags are yours to decide.** An event's tags are the ids every state that loads it needs to find it by — decisions
and automations alike — each under its own name (`aggregateId`, `itemId`, `productId`). Decide them when the event is
first introduced, thinking of every state that will fold it, not only this slice's: tags are stored at append, so a
tag added later does not reach the events already in the log. A model attribute such as `tag: true` is not the
rule; tag every id a state is, or will plausibly be, keyed by.

**Comments are short.** A declaration that needs explaining gets a short doc comment (`/** … */`); anything else gets
one `//` line at most. Never a block of `//` lines, and no commented-out code.

**Tests are the model's scenarios.** A slice's spec file translates the slice's scenarios on the board, all of them
and nothing else: one `it(...)` per entry of `specifications[]`, and one per storyline (as its skill says), each
named with the scenario's title as written. Its `given`, `when` and `then` are the scenario's, element for element,
with the scenario's example values; it asserts what the scenario's `then` says and nothing more. Never add a test the
board does not have: not for a retry, a stream, the actor, a batch, an outside call or any other property of the
code. Tests verify business logic only, and the slice's code still follows every rule here. A slice
whose board gives it no scenario has no spec file: skip its test run, and record `info --kind limitation` that the
board specifies no scenario for it.

**The domain declares, the contract words.** `command.ts`, `query.ts` and `events.ts` hold types, constraints, rejection
codes and their facts, and nothing written for a reader: no `.meta(...)`, no titles, no explanations. Everything a
caller of the API reads (what a field means, its example, what a rejection is called and why it happened) is written
in `contract.ts`, on top of the domain's schemas. A command only an automation sends has no contract, so its
rejections carry no words: nobody reads them over HTTP.

**Results and rejections.** A command (or a view that can refuse) declares its outcomes on its descriptor:
`result(success, rejection("CODE", { ...facts }), …)`, inline in `command.ts` / `query.ts` — there is no
`rejections.ts`. Every specification whose `then` is an error, or whose title says the command is refused, is one
rejection: code in UPPER_SNAKE_CASE from the rule, facts = the ids and values the decision saw that the caller may
know (`rejection("CODE")` when there are none). A command handler returns its answers as plain literals
(`return { ok: true }`, `return { ok: false, rejection: "CODE", ...facts }`): no `as const`, no annotated return type.
The contract words each rejection with `export const problems = problemsOf(<Command>, { CODE: { title, detail: (f) =>
…, happened, causes, resolution, facts: { <fact>: { description, examples } } } })`, written from the refusing spec;
it does not compile unless every rejection has a wording and every fact a doc. The procedure declares
`.errors(problems.errors)` and the controller throws `refuse(call, problems, result)`. None of them knows a
protocol. What a rejection is worth over HTTP sits in `contract.ts` beside the route's method and path:
`export const statuses = statusesOf(<Command>, { CODE: status })`, which does not compile unless every rejection has
exactly one status: `404` when the rule is that something does not exist, `409` otherwise. The HTTP edge answers it
as an RFC 9457 problem document (`type` `/problems/<message>/<code>` in kebab case, `status`, `title`, `detail`,
`instance` = the correlation id, the rejection's words and its facts). A rejection belongs to its slice: write its
words for that slice alone, even when another slice refuses with the same code; each is its own problem in the API
reference. Only the edge's problems (invalid request, conflict, unavailable) are shared by every endpoint. oRPC maps
a status by code, so a code two slices share answers the same status in both.

A lost append race is not a rejection and declares nothing: another writer changed what the decision loaded, so
the append is refused. The HTTP edge recognises it with core's `isConflict(error)`, wherever the command ran, and
answers `409 CONFLICT`; the caller sends the command again, and it lands once. A store or bus that cannot be reached
is answered `503 SERVICE_UNAVAILABLE` (`isUnavailable`). A handler never catches either.

**The API documents itself from the board, and only from the board.** The OpenAPI document (and its reference at
`/docs`) is generated from the contracts, so what the agent writes there is what a reader sees:
- every Request and Response field is documented in `contract.ts` with `documented(<schema>, { <field>: { description,
  examples } })`: the description from the field's own description or comments on the board (or one plain sentence
  naming what it is, when the board has none), the examples from the field's `example`. A field holding an object (or
  a list of them) documents its fields too, under `fields`. It does not compile unless every field has a doc;
- every procedure's `openapi({ … })` has `summary` (the slice title, as a sentence), `description` (the slice's
  `description` and the comments that explain the endpoint) and `tags: ["<Slice Title>"]`. A view and its stream
  share the tag, so they sit together; the edge groups the tags by context;
- each rejection's `happened`, `causes` and `resolution` (in `problemsOf`) become its description in the reference,
  and each of its facts' docs carries examples from the refusing specification: the reference shows every problem as
  the document a client receives, built from them;
Never invent behaviour in a description: say what the board says.

**Contracts are inferred from the messages.** A command's Request is its payload (`<Command>.payload`); a query's
Request is its payload and its Response what its success carries (`<Query>.result.success`, without `ok`). Where the
API differs from the message, say so with `.omit`, `.pick` or `.extend` on it, never by writing the fields again: a
field the edge fills in (who is asking, a generated timestamp) is `.omit`ted from the Request. Then the contract
documents it: `export const Request = documented(AddItem.payload, { … })`. A command's Response is `z.object({})`.

**HTTP.** A command is `POST`, a view `GET`. The path is the element's `apiEndpoint` when the model sets one,
otherwise `/<context-folder>/<slice-folder>`. A command answers `{}`: readers follow the views. A live view also streams at `<its path>/stream` (Server-Sent Events: `initial`, then an
`update` per change); which views are live is decided per view (build-state-view).

**A field with no source** (on an event but on no command, say): keep it in the schema as `.optional()`, never fill
it with invented data, and record it with `info --kind decision`.

## Copy-only slices

A slice whose every command, event, read model and processor is `elementCopy: true` repeats elements built in the
slices that hold their originals (their `linkedId`). It is finished without a build: no code and no commit; record
`Done` (`npx @eventmodelers/cli slice-status Done`, or the task's `Target status:`) and say with `info --kind note` which slices hold the originals.

One exception: a READMODEL copy with an INBOUND event its original does not handle yet. Then make sure whatever
builds the original handles that event too: the view's projection, or, for a todo list an automation owns, that
automation — a handler for the event and a state that reopens the item on it (see `/build-automation`, "When the
same item can come back"). That is a change in the slice that owns the code (the view's or the automation's), with
its spec and a `feat: [That Slice Name]` commit; record it with `info --kind decision`.

## Logging

Every handling already runs in a span (when tracing is on) and every refused or failed request is logged at the
edge. A handler logs through `ctx.log` (it carries the message's identity and correlation) only what neither its
events nor its span say: an automation's reason for not acting, a call to an outside system, a refusal its rejection
code cannot explain. Never narrate an event or a dispatch, never log a payload or a personal field, and do not use
`error` for something the code handles: throw instead.

## What a slice needs from outside

`main.ts` pipes every handler of a kind through the same wrappers, once, in place: the read-model database (`ctx.db`,
for queries and event handlers), validation, correlation, logging, tracing. Everything else a
slice uses comes in as a parameter of its function: `eventProcessor` and `deadLettering` (see "A slice's
`index.ts`") and, what only some slices need (a mail provider, a payment provider, a partner's API), a client. It is wired in the context, as `references/example/index.ts` and `publish-cart` do:
- the slice declares what it needs as a type in its own folder, only the calls it makes, each taking the handling's
  context last (`type CartPublisher = { publish(cart, ctx: ClientContext): Promise<void> }`, `ClientContext` from
  `#kit`), and its function takes it first:
  `export const publishCart = (publisher: CartPublisher, eventProcessor: …, deadLettering: …) => ({ … })`;
- the call is made by a **command handler**, never an event handler: the command is the decision to do something in
  the outside world, so its handler calls the system and then appends the event that records it. The slice's
  `handle` becomes a function of the client (`handle(publisher)`), and passes its own `ctx`:
  `await publisher.publish(cart, ctx)`. An automation only sends the command;
- the context's `index.ts` builds the real client once (its settings from `env`) and hands it to every slice that
  uses it: `publishCart(publisher, eventProcessor, deadLettering)`. Every call runs in a child span of the handling
  and carries that span's `traceparent`, so a trace never stops at the edge of the system:
  `ctx.trace.run("cart-publisher.publish", (span) => fetch(url, { headers: { traceparent: span.traceparent }, … }),
  { kind: SpanKind.CLIENT })`. It logs through
  `ctx.log`, so its lines carry the handling's correlation. `ctx.trace` is always there (without an exporter it
  records nothing), so a client never checks for it;
- the slice's spec hands it a stand-in that records nothing the scenarios do not assert (`{ publish: async () => {} }`
  run in `ctx.trace.run(…)`), so the scenarios run.
The handler calls the outside system first and appends after: a fact is never recorded before the system has it.
The call can be repeated (a crash before the append, an append that lost a race, the automation sending again), so
it must be harmless twice: send the slice's own id as the call's idempotency key where the system takes one. A
repeat must also send and record exactly what the first attempt did, so nothing the call needs is made up inside the
handler: it comes in the command's payload. An automation that sends the command takes it from its trigger, and
derives anything new from the trigger too (its `identifier`, keyed with a secret from `env` when it must not be
guessable), never from randomness. When the board does not name the system, the context
wires a stand-in that does nothing, with a comment saying so, and the choice is recorded with `info --kind decision`.

A projection never calls outside the system, and neither does an automation's event handler. It must write the same rows every time it replays from the start, and
an outside answer can differ (and the call would be repeated) on every replay. What the outside system says comes in
as an event, through an automation, and the projection reads that event.

A slice may also put a wrapper only it needs over its own handlers, closer to where they are used. Such a wrapper
sits inside the ones `main.ts` adds: it sees `ctx.db`, and its effects are traced and logged with the handling.

## Who is asking

Every message carries `actor` and `actorType` in its metadata, beside its correlation, causation and trace: who it
is from, and what kind of who (`user`, `anonymous`, `automation`, `system`, or a kind the app adds). The edge stamps
them on the request's message, and `main.ts`'s `correlatingHandler` carries them (`origin` from `#kit`) onto everything a command's handling
births, so its events say who sent it. An automation acts as itself: what it sends carries its processor's name with
`actorType: "automation"`, and whoever started the chain is reached through the correlation id. A chain
nothing outside started is the `system`'s. A slice never stamps or changes them.

The kit does not decide how an app authenticates, and slice work never adds authentication: no token parsing, no
session lookup, no `identify` in a slice. The app decides it in one file, `src/app/auth.ts`: `identify(request)`
answers `{ actor, actorType }`, or nothing (anonymous), and is anonymous for everyone until the app fills it in. A
header the client sets is never taken as an identity.

Once an app has decided how it authenticates, there are two places to refuse a caller:
- **who may call an endpoint at all** (signed in, say): an oRPC middleware on the procedure. `auth.ts` has one,
  `signedIn`: `impl.<procedure>.use(signedIn).handler(…)` answers anyone not signed in with the edge's 401
  problem. Use it in a controller when the board says the caller is a signed-in member (a screen behind a login, a
  field that is "the current user"), and record the choice with `info --kind decision`; a caller who is known but
  may not do this is a `FORBIDDEN` (403) from a middleware the app adds in `auth.ts`;
- **who may send a message, however it arrives** (HTTP, another instance, an automation): a handler wrapper in
  the pipes in `src/main.ts` (and their copy in `test/index.ts`) reading `actorOf(message.metadata)`, beside
  `validatingHandler`. An automation's commands arrive as
  the automation's, never as the user's.
A rule the board states about the data ("only the account's owner changes its password") is neither: it is a
rejection in the slice's decision, like any other rule.

## Environment

Every environment variable is declared once, typed, in `src/env.ts` (zod), which parses `process.env` once and exports
the result as `env`: code that needs a setting imports `env`, and nothing reads `process.env` directly. `DATABASE_URL` and `KRONOSDB_HOST` have no default: the app does
not boot without them, and `.env.example` holds the dev values for `bun run infra:up`. Telemetry is the one optional
part: it is configured only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. A new variable (an outside system's URL, say)
is added to the schema in `src/env.ts`, with its type and, when there is a sensible default, that default, and to
`.env.example` in the same change. A secret has no default and is never logged.

## When the model is unclear

**Default: assume, build, and say so.** For anything unclear or missing, pick the most sensible reading of
`slice.json`, its specifications and the surrounding model, build it, leave a one-line comment at the code it
shaped, and record it on the slice with `npx @eventmodelers/cli info "<one line>" --kind decision`. Only if the
slice literally cannot be built (no elements at all, or two specs that contradict each other) invoke
`/request-feedback`: it comments on the slice and marks it `Blocked`. A Blocked slice means "impossible without a
human", never "the agent preferred to ask".

## What slice work may touch

- the slice's own folder;
- `src/slices/<context>/events.ts` (add or change events, never remove one another slice uses);
- its context's `index.ts` (one import per slice, its lists spread into each of the context's lists it has handlers
  for, its `router` and `statuses` when it has them, what the context's function takes for it, and the clients its
  slices need);
- for a new context, that file, and its line in each of the three places in `src/slices/index.ts` (`app`,
  `router`, `statuses`);
- for the first slice of a kind in the app (the first command, query or event handlers), that kind's list in
  `kronos({ … })` in `src/main.ts`, written exactly as in "The project" above: an empty list has no type to infer, so a
  kind with no slice has no list. Nothing else in `src/main.ts`, and never a type annotation;
- `migrations/` (only what `bun run db:generate` writes; never edit an existing migration);
- `src/env.ts` and `.env.example`: a variable the slice needs, added to both (see "Environment");
- for an automation, the code an earlier build wrote for the todo list it owns (a projection slice of its own): the
  automation takes it over, and its folder, its lines in its context's `index.ts` and its table go (the migration
  `bun run db:generate` writes to drop it).

Never another slice's read model, processor or read: an automation that needs a read model builds a private one in
its own folder. Never `package.json`, the lockfile, `src/kit/`, `src/app/`, `test/`, or anything else in `src/main.ts`. If a slice seems to need one of them, it does not:
find the way within the slice, or record a `limitation` with `info`.
