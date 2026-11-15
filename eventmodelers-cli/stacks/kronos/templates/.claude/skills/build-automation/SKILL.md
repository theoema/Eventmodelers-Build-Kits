---
name: build-automation
description: Implements an AUTOMATION or TRANSLATION slice on kronos-ts — an event handler that owns its todo list (folded from the log in its state, or, when a fold would cost too much, a private read model in its own folder) and sends a command — plus the command's handler when the slice owns it, from its slice.json.
---

# Build an automation slice

An automation reacts to an event and sends a command. On the board it reads a todo-list read model; in code **the
todo list is the automation's own state**: this slice builds it, and no other slice does. Names, types, ids and
tags follow `.build-kit/CLAUDE.md` "Decisions the model leaves to you".

`slice.json` is the source of truth: `processors[0]` (the automation: its fields and `mapping`s), its INBOUND
dependencies (the todo-list read model, the trigger), the command it sends (`commands[]`, often owned by this
slice), the events that command appends, `specifications[]`, `storylines[]` and every `comments`. Read the todo-list
read model's slice too, wherever the board puts it and whatever its status: its INBOUND events (including those of
its copies on other sheets) and the event that closes an item are what this slice's state is built from.

**One automation the board spreads over several slices** (the todo list in one slice, the automation and its command
in another, or the todo list planned first) is built here, once, as this one slice. The todo-list slice gets no code
of its own; when it is built, it records `Done` with a note naming this slice.

## How an automation finds what to act on

**It loads state.** With DCB the query is the boundary: an automation `ctx.load`s a `state` whose query is exactly as
wide as it needs, folded from the todo list's INBOUND events plus the event that closes the item, decides whether
there is anything to do, and `ctx.send`s the command. Usually the trigger names the thing (a submitted cart is
published, a registered account is mailed), so the state is keyed by that id. Example:
`references/example/publish-cart/` — **open every file before writing anything, and match it file for file.**

**In steps, when that reads better.** Nothing makes it one state: load a state that yields ids, then states by
those ids, each query only as wide as that step needs.

**From a read model of its own, when a fold would cost too much.** A fold reads every event its query matches on
every load. When a step's answer grows without bound (every cart that ever held a popular product), the slice keeps
its todo list in a private read model instead: its own `schema.ts` and `projection.ts` in this slice's folder, on
this slice's processor, read by the automation through `ctx.db`. Each command it sends still decides against its
own state. Example: `references/from-a-read-model/archive-item/` — open every file. **Never reuse another slice's
read model** (a view built for a screen, say): build a private one, even when it holds the same rows.

An automation's own read needs no consistency of its own: it appends nothing; the command it sends decides, against
its own state, and lands once. So the choice between a fold and a read model is about cost, never about boundaries.

**When the same item can come back** (a resend, a retry, a renewal), every event that opens it reopens it, and the
automation has one handler per such event: the todo list's INBOUND events include its copies' on other sheets (a
READMODEL copy wired to a new event is a new way to open the item). The state folds open and closed in order, per
the id it is keyed by. That is enough when the model allows one open item at a time for that id (a rule such as
"no second resend while the first is on its way"). When it allows several at once, a closing event must say which
one it closes; if the model's closing event cannot (no id of the request it closes), do not invent the field: build
what the model says and record `npx @eventmodelers/cli info "<closing event> cannot say which request it closes" --kind limitation`.

**Time** in an automation's decision (a reminder after 24 hours, a timeout) is the unit of work's instant as a
Temporal value, never the wall clock: see "Time" in `.build-kit/CLAUDE.md` and `/build-state-change`'s
`references/time/`.

## Files

Inside `src/slices/<context>/<slice>/`:

| File | What |
|---|---|
| `automation.ts` | its `processor` (below) and `export const automation = [eventHandler(Trigger, …), …].map((h) => ({ ...h, processor }))`: one plain handler per event it reacts to |
| `state.ts` | EVERY fold the slice loads, in one file: the automation's states and the command's decision state alike — never a file of its own (`mailing.ts`, …) |
| `schema.ts`, `projection.ts` | only for a todo list kept in a read model of its own: its table, and one plain `eventHandler` per INBOUND event, listed first in `automation` |
| `command.ts`, `handler.ts` | the command it sends (with its rejections inline), when this slice owns it, as in build-state-change, without a contract |
| `<client>.ts` | only when it calls an outside system: the type of what it needs from it, each call taking `ctx: ClientContext` last, e.g. `publisher.ts` with `CartPublisher` |
| `index.ts` | `export const <camelName> = { commandHandlers: [handle], eventHandlers: automation } satisfies Slice`; when the command calls an outside system: a function of its client, `(publisher: CartPublisher) => ({ commandHandlers: [handle(publisher)], eventHandlers: automation })`, wired in the context's `index.ts` (`.build-kit/CLAUDE.md`, "What a slice needs from outside") |
| `slice.spec.ts` | exactly the slice's scenarios: one `it(...)` per specification and storyline, the command's decisions and the automation driven by its trigger; none when the board has none |

## The processor

Each slice builds its own, with kronos-ts directly, typed `PartialProcessor` from `#kit`, and named after the slice
folder (a new name replays the log from the start). A stateful automation runs one lane per id it acts on, lanes side
by side, a failing event parked in its own lane only — `concurrent` and `deadLettering` take the same sequence:

```ts
const perCart: Sequence = (e) => e.tags.find((t) => t.key === "aggregateId")?.value ?? e.identifier

const processor: PartialProcessor = (eventStore, tokenStore, unitOfWork, deadLetterQueue) =>
  deadLettering(
    concurrent(batched(eventProcessor("publish-cart", eventStore, tokenStore, unitOfWork), 100), perCart),
    deadLetterQueue,
    perCart,
  )
```

An automation with a read model of its own runs it and the automation on one processor in global order, its
projection handlers first, so the rows it reads are current up to the very event it handles:
`batched(eventProcessor("<slice-folder>", eventStore, tokenStore, unitOfWork), 100)`. No lanes and no
dead-lettering: a failing send holds the slice. Say so in a comment on the processor.

## Steps

1. **Trigger.** The event that starts it: the todo list's INBOUND event that adds an item (or the event named in
   the specs' `when`). A TRANSLATION reacts to an external system's event: model that event in `events.ts` as it
   arrives, and translate it into the internal command.
2. **State.** `state({ id, tags, evolve })`, usually keyed by the trigger's id (`idAttribute` on the trigger or the command
   is a hint; otherwise the id the payload is about). Fold the todo list's INBOUND events and the event that closes
   the item (the command's own event, usually). Every event it folds must be tagged with that id — see "Tags" in
   `.build-kit/CLAUDE.md`. Fold only what the trigger's payload does not carry (often only whether the item is closed),
with a typed, real initial value and no `null`: see "State holds facts, never placeholders" in
`.build-kit/CLAUDE.md`. When a fold
   would cost too much, a read model of its own instead (`schema.ts`, `projection.ts`; table named after the slice
   folder, every write absolute), then `bun run db:generate`.
3. **Command.** If this slice owns the command, build `command.ts` and `handler.ts` as build-state-change does,
   without `contract.ts` / `controller.ts`: only the automation sends it. Its handler lands once (a second send for
   the same id appends nothing). Field `mapping`s on the processor say which state field fills which command field.
   When the slice does something in an outside system (mails, publishes, charges), the command's handler makes the
   call, with its `ctx`, before it appends: `handle` is a function of the client, as `publish-cart/handler.ts` is.
4. **Automation.** `ctx.load` the state (in steps if it reads better), or select the todo list through `ctx.db`;
   when there is nothing to do, return; otherwise `ctx.send` once per item, its payload taken from the trigger's
   where the trigger carries it, and anything the command's outside call needs made (a token) derived from the
   trigger. The automation never calls outside the system itself: its command's handler does. Never read a table
   through `ctx.query`:
   a query is its own task and does not see what this batch wrote.
5. **Code an earlier build wrote for the todo list** (a projection slice of its own): this slice takes it over.
   Delete its folder and its entry in its context's `index.ts`, run `bun run db:generate` for the migration that drops
   its table (if this slice adds its own table, run it once after the deletion and once after the addition), and
   record it with `info --kind decision`. A view a screen still reads stays, untouched.
6. **Specs**: one spec file, with TWO fixtures at the top, each `fixture(testApp(...))` with `fixture` from
   `@kronos-ts/test` and `testApp` from `#test` (`testApp` drops its database, and stops its app, after the last test):
   - `const decisions = fixture(testApp([{ commandHandlers: [handle] }]))` for the command's decisions
     (`[handle(stub)]` when it calls an outside system: a stand-in, never asserted),
     in memory, as in build-state-change. The command handler alone: in the whole slice the automation would act on a
     `given` trigger, as it does in production, and the decision would see the command already sent.
   - `const scenarios = fixture(testApp([<slice>], { db: true }))` for the automation (`<slice>(stub)` when its
     command takes a client: a stand-in that runs in `ctx.trace.run(...)` as a real one does), on Postgres (`bun run
     infra:up`): `await scenarios.when(event(Trigger, …)).then(commands(command(Cmd, …)), events(event(Trigger, …), ...appended events))` — the arriving event counts as appended.
   `given` events are handled live, never as a replay: an automation acts on them as it would on any event, so its
   state must make a second trigger harmless. Scenarios share an app, its database and its processors, and nothing is
   reset between them, so each `it(...)` mints its own ids with `Bun.randomUUIDv7()`: its own carts and items and, when
   the trigger names a product or any id that reaches every cart, its own of those too (or another scenario's rows
   answer it). One `it(...)` per `specifications[]` entry and storyline, named with its title, and no other tests:
   none for a retry, a batch, the actor or an outside call, and no assertion a scenario does not make (see "Tests
   are the model's scenarios" in `.build-kit/CLAUDE.md`). A slice with no scenarios has no spec file.

## Done when

- [ ] the automation reacts to exactly its trigger and sends exactly its command, once per item
- [ ] its todo list is its own: folded in `state.ts`, or a private read model in its own folder on its own processor
- [ ] every event a state folds carries the tags its query asks for
- [ ] the command's handler appends nothing when the item is closed already (a second send lands once)
- [ ] an outside call is made by the command's handler, with its `ctx`, and a repeat sends and records exactly what the first attempt did
- [ ] its state has no `null`, `undefined` or optional field standing for "not yet"
- [ ] every specification and storyline is an `it(...)` named with its title, and there are no other tests
