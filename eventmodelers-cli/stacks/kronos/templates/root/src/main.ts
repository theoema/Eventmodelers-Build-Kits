import { both, pipe } from "#kit"
import {
  consoleLogger,
  correlation,
  interceptingCommandBus,
  interceptingQueryBus,
  jsonSerializer,
  localCommandBus,
  localFirstQueryBus,
  localQueryBus,
  unitOfWork,
} from "@kronos-ts/core"
import {
  kronosDbCommandBus,
  kronosDbConnection,
  kronosDbEventStore,
  kronosDbQueryBus,
  kronosDbSchedulingEventStore,
} from "@kronos-ts/kronosdb"
import { otlpCommandBus, otlpExporter, otlpLogger, otlpQueryBus } from "@kronos-ts/otlp"
import { postgresDeadLetterQueue, postgresPool, postgresTokenStore, postgresUnitOfWork } from "@kronos-ts/postgres"
import { postgresAdapter } from "@kronos-ts/postgres/adapters/postgres"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { app } from "./app"
import { serve } from "./app/http"
import { identify } from "./app/auth"
import { env } from "./env"
import { router, statuses } from "./slices"

// The app as it runs in production, top to bottom: KronosDB, Postgres and, when asked for, OTLP. Locally it is the
// same file over `bun run infra:up`. A dependency that cannot be reached stops the boot.

// Telemetry is the one optional part: JSON log lines always; spans and log records over OTLP when
// OTEL_EXPORTER_OTLP_ENDPOINT is set.
const level = env.LOG_LEVEL
const exporter = env.OTEL_EXPORTER_OTLP_ENDPOINT
  ? otlpExporter({
      endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      serviceName: env.OTEL_SERVICE_NAME,
      resource: { "deployment.environment.name": env.NODE_ENV },
    })
  : undefined
const log = exporter ? both(consoleLogger({ level }), otlpLogger(exporter, { level })) : consoleLogger({ level })

// Postgres: read models (migrated here), tokens and dead letters (bootstrapped by the pool).
const pg = postgresPool(postgresAdapter({ connectionString: env.DATABASE_URL, clientOptions: { onnotice: () => {} } }))
await pg.start()
const migrationsFolder = new URL("../migrations", import.meta.url).pathname
// No journal until the first slice with a schema.ts runs `bun run db:generate`. Instances starting together take
// turns: one connection, an advisory lock held on it while it migrates; the next finds nothing left to do.
if (await Bun.file(`${migrationsFolder}/meta/_journal.json`).exists()) {
  const session = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    await session`select pg_advisory_lock(hashtext('migrations'))`
    await migrate(drizzle(session), { migrationsFolder })
  } finally {
    await session.end()
  }
}

// KronosDB: ONE connection for the event log and both buses, the bus named after the context.
const context = env.KRONOSDB_CONTEXT
const kdb = await kronosDbConnection({
  componentName: "app",
  host: env.KRONOSDB_HOST,
  port: env.KRONOSDB_PORT,
  token: env.KRONOSDB_TOKEN,
  serializer: jsonSerializer(),
})

// The buses, innermost first: the handlers of this instance, KronosDB between instances, a span per dispatch, and
// correlation outermost so it stamps every branch. A read needs no transaction, so neither bus takes one.
//
// Commands always go through KronosDB: it spreads unkeyed commands over every instance by weighted round-robin, held
// back by flow control, and routes a command with a routing key to one instance by a consistent-hash ring. Every
// instance hosts every handler, so local-first would hand each command to the instance that took the request, and
// KronosDB would never route one.
// Queries are answered locally first: every instance reads the same Postgres, so another instance would answer the
// same rows a round trip later (KronosDB itself prefers a handler on its own node for a point-to-point query). A
// subscription query still goes through KronosDB, which carries its updates.
const running = app({
  eventStore: pipe(
    kronosDbEventStore(kdb, context),
    (s) => kronosDbSchedulingEventStore(s, kdb, context),
  ),
  commandBus: pipe(
    localCommandBus(unitOfWork),
    (b) => kronosDbCommandBus(b, kdb, context),
    (b) => (exporter ? otlpCommandBus(b, exporter) : b),
    (b) => interceptingCommandBus(b, correlation),
  ),
  queryBus: pipe(
    localQueryBus(unitOfWork),
    (b) => localFirstQueryBus(kronosDbQueryBus(b, kdb, context), b),
    (b) => (exporter ? otlpQueryBus(b, exporter) : b),
    (b) => interceptingQueryBus(b, correlation),
  ),
  tokenStore: postgresTokenStore(pg),
  deadLetterQueue: postgresDeadLetterQueue(pg),
  // A batch's read-model writes and its token commit in one transaction.
  processing: pipe(
    unitOfWork,
    (u) => postgresUnitOfWork(u, pg),
  ),
  pg,
  log,
  exporter,
})
// Every handler is subscribed now; wait until KronosDB routes to them before taking requests.
await kdb.start()
const server = await serve(running, { router, statuses }, {
  log,
  exporter,
  port: env.PORT,
  // The API reference at /docs: in development, unless API_DOCS says otherwise.
  docs: env.API_DOCS ?? env.NODE_ENV === "development",
  // Who is asking, and who may call what: src/app/auth.ts, the one place the app decides it.
  identify,
})
log.info("listening", { url: String(server.url), events: `KronosDB ${context}`, tracing: exporter ? env.OTEL_EXPORTER_OTLP_ENDPOINT : "off" })

const shutdown = async () => {
  await server.stop()
  await running.stop()
  // Drains both buses' in-flight work, then closes the socket.
  await kdb.close()
  await pg.close()
  await exporter?.close()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
