# Event-sourced service on kronos-ts

Built slice by slice from an Eventmodelers board by the build kit in `.build-kit/`. Bun, kronos-ts (DCB) with
KronosDB for the events and the command and query buses, Postgres for read models, processor tokens and dead
letters, oRPC for HTTP. Every setting is an environment variable declared in `src/env.ts` (see `.env.example`); a
bad or missing one stops the app at startup, naming every variable that is wrong. The app has one mode, the one that runs
in production: it needs the KronosDB and Postgres from `infra:up`, and stops the boot when either is unreachable.

Run as many instances as you like against the same KronosDB and Postgres: KronosDB spreads commands over them, each
processor runs on one instance at a time, and the first instance to start runs the migrations while the others
wait.

```bash
bun install
cp .env.example .env      # the dev values for infra:up; DATABASE_URL and KRONOSDB_HOST have no default
bun run infra:up          # Postgres + KronosDB
bun run dev               # http://localhost:3000 — /docs, /openapi.json, /health
bun test                  # decision specs in memory; view specs need infra:up
```

## The API

`/openapi.json` is generated from the slices' contracts, so it cannot drift from what the app serves. `/docs` is its
reference (Scalar): on in development, off in production unless `API_DOCS=true`. Every refusal is an RFC 9457
problem document whose `type` (`/problems/add-item/cart-full`: the message, then the code; `/problems/conflict` for
what any endpoint can answer)
opens its explanation, or answers it as JSON to `Accept: application/json`. `bun run ui-contract <path>` prints an
endpoint's contract as a UI build kit reads it.

## Who is asking

Every message says who it is from: `actor` and `actorType` in its metadata, carried with the correlation id onto
the events it causes. An automation acts as itself: what it sends carries its processor's name and
`actorType: "automation"`, and whoever started the chain is found by the correlation id. A chain nothing outside
started is the `system`'s.

How your users authenticate is yours to decide, in one file: `src/app/auth.ts`. Its `identify(request)` reads your
session cookie or bearer token and answers `{ actor, actorType }`; until you fill it in, every request is anonymous.
Its `signedIn` middleware is for a procedure only a signed-in caller may use (`impl.account.use(signedIn)`); anyone
else gets the edge's 401 problem, and a 403 from a middleware of your own reads the same. To refuse a message
however it arrives (HTTP, another instance, an automation), add a handler wrapper to `src/app.ts`. A rule
about the data ("only the owner may…") is a rejection in the slice, from the board.

## Running it in production

```bash
docker build -t app .
docker run -p 3000:3000 -e DATABASE_URL=… -e KRONOSDB_HOST=… app
```

The image runs `src/main.ts` on Bun with its production dependencies; migrations run at boot. It needs a KronosDB
(0.14 or later) and a Postgres; `src/env.ts` lists every setting.

## Logs and traces

Logs are one JSON object per line on the console (`LOG_LEVEL`, default `info`). A handling logs through `ctx.log`,
bound to its message and correlation id; the HTTP edge writes one line per refused or failed request.

Tracing is on when `OTEL_EXPORTER_OTLP_ENDPOINT` is set: every request is a span, every dispatch and handling a span
under it (an event handled by a projection or automation is a trace of its own, linked to the one that appended it),
every database statement a span under its handling, and log records go to the same backend. A call to an outside
system is a span too: its client takes the handling's `ctx` and runs the call in `ctx.trace.run(...)`, putting the
span's `traceparent` on the request, so the trace goes on into that system (see the stand-in publisher in
`src/slices/understanding-eventsourcing/index.ts`). To see them locally:

```bash
bun run telemetry:up                                    # Grafana + Tempo + Loki (grafana/otel-lgtm)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 bun run dev
# open http://localhost:3001 (admin/admin) → Explore → Tempo or Loki, service.name = $OTEL_SERVICE_NAME
```

## Correlation

Every request has a correlation id: on every message it births, in every log line, and echoed in the
`x-correlation-id` response header. It is the caller's `x-correlation-id` when that is safe (at most 128 characters
of `A-Za-z0-9._:-`; anything else is replaced, never refused), otherwise the trace id of an incoming `traceparent`,
otherwise a new one. An incoming `traceparent` is continued.
