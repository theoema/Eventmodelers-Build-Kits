---
name: build-state-change
description: Implements a STATE_CHANGE slice on kronos-ts (command and its rejections, state, handler, oRPC contract and controller, given/when/then specs) from its slice.json.
---

# Build a state-change slice

A state-change slice is one command: load the facts its decision needs (a DCB state), decide, append events, answer a
result. Its worked example is `references/example/add-item/` (with `references/example/events.ts`): **open every file
of it before writing anything, and match it file for file.** The rules for names, types, ids, tags, rejections and
paths are in `.build-kit/CLAUDE.md` "Decisions the model leaves to you".

`slice.json` is the source of truth. Read it fully first: `commands[]` (fields, `idAttribute`, `apiEndpoint`),
`events[]` (which this command appends: its `dependencies` of type `OUTBOUND`), `specifications[]`, `storylines[]`,
`description` and every element's `comments`.

## Files

Inside `src/slices/<context>/<slice>/`:

| File | What | From |
|---|---|---|
| `command.ts` | `ns.command("<Name>", { payload, result: result({}, rejection("CODE", { ...facts }), …) })`: the payload's types and constraints, and one `rejection` (code and facts) per refusing specification, inline; no `.meta`, no words | `commands[0].fields`; `specifications[]` whose `then` is an error |
| `state.ts` | EVERY fold the slice loads: `state({ id, tags, evolve })`, never in a file of its own | the events the specs' `given` hold |
| `handler.ts` | `commandHandler`: load → decide → append → result | the specs |
| `contract.ts` | Request (`documented(<Command>.payload, {…})`, adjusted with `.omit`/`.pick`/`.extend` first) / Response, `problems = problemsOf(<Command>, {…})` (each rejection's words and its facts' docs), the oRPC procedure with `.errors(problems.errors)`, and beside its method and path `export const statuses = statusesOf(<Command>, { CODE: status })` | `commands[0]`; the refusing specs |
| `controller.ts` | `implement(contract).$context<Edge>()`: send the command once; `throw refuse(call, problems, result)` on a rejection | |
| `index.ts` | `export const <camelName> = { router, statuses, commandHandlers: [handle] } satisfies Slice` | |
| `slice.spec.ts` | exactly the slice's scenarios: one `it(...)` per specification and storyline, given/when/then, nothing else; none when the board has none | `specifications[]`, `storylines[]` |

Outside the folder: add every event it appends to `src/slices/<context>/events.ts` if missing, and the slice to
its context's `index.ts`. A command only an automation sends (no screen issues it) has no `contract.ts` or
`controller.ts`, and its `index.ts` has no `router` and no `statuses`.

## Steps

1. **Events.** For each event the command appends, make sure `events.ts` declares it (`ns.event`) with exactly its
   `slice.json` fields and its tags. If it exists, diff its fields against `slice.json` and fix the drift.
   Tags: see "Tags" in `.build-kit/CLAUDE.md` — every id a state that folds the event is keyed by. An existing event
   missing a tag this decision needs gets it, and an `info --kind limitation` that events already appended lack it.
2. **Command and its rejections.** Payload = `commands[0].fields` mapped with the type table. A command that
   creates something carries the id of what it creates (`z.uuid()`, minted by the client as a UUIDv7) even when the
   board marks it `generated` on the event or leaves it off the command: see "Ids" in `.build-kit/CLAUDE.md`, and
   record it with `info --kind decision` when the board left it off. Its result is
   `result({}, rejection("CODE", {...}), …)` — one `rejection` per refusing specification, written inline in the
   descriptor (there is no `rejections.ts`). Facts: the ids and values the decision saw that the caller may know.
   Types, constraints, codes and facts only: what a reader is told is written in the contract (step 5).
3. **State** (in `state.ts`, with any other fold this slice loads). Fold only what the decision needs, from the events its specs' `given` hold. `id` = the id fields;
   `tags` = the same ids. Its initial value is real and typed, with no `null` for "not yet" (a boolean, an empty
   list, or a union of phases): see "State holds facts, never placeholders" in `.build-kit/CLAUDE.md`.
4. **Handler.** `ctx.load(State, id)`, decide in the order the specs imply, `ctx.append(Event, payload)`, return the
   result as the literal (`{ ok: true }` or `{ ok: false, rejection: "CODE", ...facts }`), with no `as const`.
   When what the command would record is already true (a retry with the same client-minted id), return
   `{ ok: true }` and append nothing. Business logic goes here, where it is used: no shared helpers.
   **Time** (a deadline, "within 24 hours", a timestamp on an event): the current instant is
   `Temporal.Instant.fromEpochMilliseconds(ctx.unitOfWork.now())`, spans are `Temporal.Duration`s, and instants
   travel in payloads as ISO strings, read back with `Temporal.Instant.from(…)`. Never `Date.now()`, `new Date()`
   or millisecond arithmetic. Worked example, with its specs moving the clock: `references/time/` — open every file
   when the slice has a time rule.
5. **Contract and controller.** Request = `documented(<Command>.payload, { … })` (`.omit` what the edge fills in
   first, never restated): every field's description and examples from the board. Response = `z.object({})`. `POST`
   at `apiEndpoint` or `/<context>/<slice>`, with `summary`, `description` and `tags: ["<Slice Title>"]` from the
   slice (see "The API documents itself" in `.build-kit/CLAUDE.md`). Each rejection is worded here:
   `export const problems = problemsOf(<Command>, { CODE: { title, detail: (f) => …, happened, causes, resolution,
   facts: { … } } })`, written from the refusing spec's title, description and comments; a fact's example is the value
   that spec shows, so the reference's example problem reads like the real one. The procedure declares
   `.errors(problems.errors)` and the controller throws `refuse(call, problems, result)`. The HTTP part sits
   beside the route: `export const statuses = statusesOf(<Command>, { CODE: status })`, `404` for "does not exist"
   rules, `409` otherwise; it does not compile unless every rejection has exactly one.
6. **Specs** (in memory; no Docker). ONE fixture per spec file, at the top:
   `const scenarios = fixture(testApp([<slice>]))`, with `fixture` from `@kronos-ts/test`, `testApp` from `#test`
   (the same `app()` `main.ts` calls, over in-memory resources; it stops the app after the file's last test) and
   `<slice>` the value `index.ts` exports. Every scenario runs on it, one `it(...)` per specification, mapped one to
   one from `slice.json`: `await scenarios.given(...events).when(command(Cmd, payload)).then(...)`. The spec's
   `given` events become `given(event(E, …))`, its `when` command becomes `when(command(C, …))`, its `then` events
   become `events(event(E, …), …)`, and a spec with `expectError` becomes `rejected("CODE", facts?)` from
   `#kit/testing` plus `noEvents()`. A success claims `result({ ok: true })` too.
   Scenarios share the app and nothing is reset between them, so each `it(...)` mints its own ids with
   `Bun.randomUUIDv7()` (the cart, the item, the product), never ids shared across tests. Take every other value
   from the spec's examples; where it has none, use readable ones. Name each `it(...)` with the specification's
   title. These are the only tests: no test the board does not have (a retry, …), and no assertion its `then` does
   not make (see "Tests are the model's scenarios" in `.build-kit/CLAUDE.md`). A slice with no scenarios has no spec
   file.
   A storyline in `slice.json` adds one scenario per COMMAND beat, in a `describe` named after the storyline:
   `given` the events of every beat before it, in order; `when` the command, from the beat's fields; `then` the
   EVENT beats that follow it. Its READMODEL beats belong to the view's slice, not here.
7. List the slice in its context's `index.ts` (`src/slices/<context>/index.ts`; a new context: that file, and one line in `src/slices/index.ts`).
8. `bun run typecheck`, then `bun test src/slices/<context>/<slice>`.

## UI Contract

**Only when handover is on** (the task's `Handover: on` line): once the slice's specs pass, invoke the `ui-contract`
skill. Its source here is the OpenAPI document the app generates: `bun run ui-contract <path>` prints the slice's
whole `## UI Contract` section (`**WRITE**`), each refusal's problem
document included. Publish that output verbatim; never write or edit the YAML by hand. A mismatch with `slice.json` is a bug in the code: fix it,
then print again.

## Done when

- [ ] every field of `commands[].fields` is in the payload and the Request, and nothing else is
- [ ] every appended event exists in `events.ts` with exactly its `slice.json` fields and tags its ids
- [ ] every specification and storyline is an `it(...)` named with its title, and there are no other tests
- [ ] every refusing specification is a rejection with a status in `statuses`
- [ ] the handler appends nothing on a retry
- [ ] `command.ts` holds types, constraints, codes and facts only; every field, rejection and fact is worded in `contract.ts`
- [ ] its state has no `null`, `undefined` or optional field standing for "not yet"
- [ ] each assumption is a one-line comment where it shaped the code and an `info --kind decision` on the slice
