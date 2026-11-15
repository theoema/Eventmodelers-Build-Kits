import { afterAll } from "bun:test"
import { drizzleHandler, origin, pipe, untraced } from "#kit"
import {
  type App,
  type CommandHandler,
  consoleLogger,
  correlatingHandler,
  correlation,
  deadLettering as coreDeadLettering,
  type EventHandler,
  eventProcessor as coreEventProcessor,
  type EventProcessor,
  inMemoryDeadLetterQueue,
  inMemoryEventStore,
  inMemorySnapshottingEventStore,
  inMemoryTokenStore,
  interceptingCommandBus,
  interceptingQueryBus,
  kronos,
  localCommandBus,
  localQueryBus,
  loggingHandler,
  messageOrigin,
  type QueryHandler,
  type Sequence,
  type SequencedDeadLetterQueue,
  type UnitOfWork,
  unitOfWork,
  validatingHandler,
} from "@kronos-ts/core"
import { type OtlpExporter, otlpHandler } from "@kronos-ts/otlp"
import {
  postgresDeadLetterQueue,
  postgresHandler,
  postgresPool,
  type PostgresResource,
  postgresTokenStore,
  postgresUnitOfWork,
} from "@kronos-ts/postgres"
import { postgresAdapter } from "@kronos-ts/postgres/adapters/postgres"
import { type AdvanceableClock, advanceableClock, recordingCommandBus, recordingEventStore } from "@kronos-ts/test"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { testEnv } from "./env"

type Options = {
  /** A fresh Postgres database for the read models, tokens and dead letters (`bun run infra:up`). */
  readonly db?: boolean
  /** The clock the app's tasks and deadlines read: pass your own to read the time a scenario starts at. */
  readonly clock?: AdvanceableClock
  /** Turns tracing on, for a spec that reads the spans. */
  readonly exporter?: OtlpExporter
}

/**
 * What a spec file runs its scenarios on: the infrastructure `main.ts` builds, in test form, and `app(handlers)`,
 * which wraps every handler of a slice's (or a context's) three lists as `main.ts` does and hands them to `kronos()`. The log is in memory and
 * recorded, holding its deadlines against the app's clock; the command bus is recorded; the query bus is the local
 * one. So the app is one `fixture()` accepts. Build it once at the top of a spec file, and call `app` once: it stops
 * the app, and drops its database, after the file's last test.
 *
 * `eventProcessor` is core's with the log, tokens and unit of work applied, and `deadLettering` core's with this
 * app's dead-letter queue applied, both as `main.ts` hands them to the slices. `db: true` gives the app a fresh
 * Postgres database (`bun run infra:up`) for the read models, which also holds the processors' tokens and dead
 * letters. Without it the tokens and dead letters are in memory and no Docker is needed; the read-model database is
 * then one that is never connected to, which is enough for a slice that never touches a table.
 *
 * Scenarios on one fixture share the app and the database and nothing is reset between them, so each one mints ids
 * of its own with `Bun.randomUUIDv7()`.
 *
 *   const { app, eventProcessor } = await testInfrastructure({ db: true })
 *   const scenarios = fixture(app(cartItems(eventProcessor)))
 *   it("…", async () => {
 *     const aggregateId = Bun.randomUUIDv7()
 *     await scenarios.given(…).when(query(GetCartItems, …)).then(…)
 *   })
 */
export async function testInfrastructure(options: Options = {}) {
  const database = options.db ? await freshDatabase() : unconnected()
  const { close, ...infrastructure } = open(options, database.pg, options.db === true)
  afterAll(async () => {
    await close()
    await database.drop()
  })
  return infrastructure
}

function open(options: Options, pg: PostgresResource, db: boolean) {
  const clock = options.clock ?? advanceableClock()
  const uow = () => unitOfWork(clock)
  const eventStore = pipe(
    inMemoryEventStore(),
    inMemorySnapshottingEventStore,
    (s) => recordingEventStore(s, { clock }),
  )
  const commandBus = pipe(
    localCommandBus(uow),
    (b) => interceptingCommandBus(b, correlation),
    recordingCommandBus,
  )
  const queryBus = pipe(
    localQueryBus(uow),
    (b) => interceptingQueryBus(b, correlation),
  )
  const tokenStore = inMemoryTokenStore()
  const deadLetterQueue: SequencedDeadLetterQueue = db ? postgresDeadLetterQueue(pg) : inMemoryDeadLetterQueue()
  const eventProcessor = (name: string): EventProcessor =>
    db
      ? coreEventProcessor(name, eventStore, postgresTokenStore(pg), postgresUnitOfWork(uow, pg))
      : coreEventProcessor(name, eventStore, tokenStore, uow)
  const deadLettering = (processor: EventProcessor, sequence: Sequence): EventProcessor =>
    coreDeadLettering(processor, deadLetterQueue, sequence)
  const running: App[] = []
  const { exporter } = options
  const log = quietLog
  // `main.ts`'s composition, written out over this infrastructure: the same wrappers, in the same order.
  const app = (handlers: {
    readonly commandHandlers: ReadonlyArray<CommandHandler<any, any, any>>
    readonly queryHandlers: ReadonlyArray<QueryHandler<any, any, any>>
    readonly eventHandlers: ReadonlyArray<EventHandler<any, any> & { readonly processor: EventProcessor }>
  }) => {
    const app = kronos({
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
          (next: Handler) => postgresHandler(next, pg),
          (next: Handler) => validatingHandler(next, handler.descriptor),
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
          (next: Handler) => postgresHandler(next, pg),
          (next: Handler) => validatingHandler(next, handler.descriptor),
          (next) =>
            correlatingHandler(next, (m) => ({ ...messageOrigin(m), actor: handler.processor.name, actorType: "automation" })),
          (next) => loggingHandler(next, log),
          (next) => (exporter ? otlpHandler(next, exporter) : untraced(next)),
        ),
        eventStore,
        commandBus,
        queryBus,
        // Typed over this recorded log, so `fixture()` accepts the app and offers `advance`.
        processor: handler.processor as EventProcessor<UnitOfWork, typeof eventStore>,
      })),
    })
    running.push(app)
    return app
  }
  return {
    app,
    eventProcessor,
    deadLettering,
    close: async () => {
      for (const app of running) await app.stop()
    },
  }
}

/** Any handler: `drizzleHandler`'s `Omit` cannot narrow the slices' handler types. */
type Handler = (message: any, context: any) => any

/** Silent, unless `TEST_LOG_LEVEL` asks for the handlers' log lines. */
const quietLog = testEnv.TEST_LOG_LEVEL ? consoleLogger({ level: testEnv.TEST_LOG_LEVEL }) : consoleLogger({ write: () => {} })

const migrationsFolder = new URL("../migrations", import.meta.url).pathname
const serverUrl = () => new URL(testEnv.TEST_DATABASE_URL)
const quiet = { max: 1, onnotice: () => {} }

/**
 * The migrated database every scenario's database is copied from. Named for the migrations it holds, so it is built
 * once, reused across runs, and replaced when a migration is added.
 */
let template: Promise<string> | undefined

async function migratedTemplate(): Promise<string> {
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan(migrationsFolder))).sort()
  const contents = await Promise.all(files.map((f) => Bun.file(`${migrationsFolder}/${f}`).text()))
  const name = `test_template_${Bun.hash(contents.join("\n")).toString(16)}`
  const admin = postgres(serverUrl().toString(), quiet)
  try {
    const [exists] = await admin`select 1 from pg_database where datname = ${name}`
    if (exists) return name
    const building = `${name}_building_${crypto.randomUUID().replaceAll("-", "")}`
    await admin.unsafe(`CREATE DATABASE ${building}`)
    const url = serverUrl()
    url.pathname = `/${building}`
    const sql = postgres(url.toString(), quiet)
    try {
      if (files.includes("meta/_journal.json")) await migrate(drizzle(sql), { migrationsFolder })
    } finally {
      await sql.end()
    }
    await admin.unsafe(`ALTER DATABASE ${building} RENAME TO ${name}`)
    return name
  } finally {
    await admin.end()
  }
}

/**
 * Without `db`: a read-model database built from `TEST_DATABASE_URL` and never started, so nothing connects. Every
 * query and event handler is wrapped over it, and none that a spec without `db` runs calls `ctx.sql()`.
 */
function unconnected() {
  const pg = postgresPool(postgresAdapter({ connectionString: testEnv.TEST_DATABASE_URL, clientOptions: { max: 1, onnotice: () => {} } }))
  return { pg, drop: () => pg.close() }
}

async function freshDatabase() {
  template ??= migratedTemplate()
  const from = await template
  const database = `test_${crypto.randomUUID().replaceAll("-", "")}`
  const admin = postgres(serverUrl().toString(), quiet)
  await admin.unsafe(`CREATE DATABASE ${database} TEMPLATE ${from}`)
  const url = serverUrl()
  url.pathname = `/${database}`
  const pg = postgresPool(postgresAdapter({ connectionString: url.toString(), clientOptions: { max: 5, onnotice: () => {} } }))
  await pg.start()
  return {
    pg,
    async drop() {
      await pg.close()
      await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
      await admin.end()
    },
  }
}
