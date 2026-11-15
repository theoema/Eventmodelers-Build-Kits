import { afterAll } from "bun:test"
import { pipe, type Slice } from "#kit"
import {
  consoleLogger,
  correlation,
  inMemoryDeadLetterQueue,
  inMemoryEventStore,
  inMemorySnapshottingEventStore,
  inMemoryTokenStore,
  interceptingCommandBus,
  interceptingQueryBus,
  localCommandBus,
  localQueryBus,
  unitOfWork,
} from "@kronos-ts/core"
import type { OtlpExporter } from "@kronos-ts/otlp"
import { postgresDeadLetterQueue, postgresPool, postgresTokenStore, postgresUnitOfWork } from "@kronos-ts/postgres"
import { postgresAdapter } from "@kronos-ts/postgres/adapters/postgres"
import { type AdvanceableClock, advanceableClock, recordingCommandBus, recordingEventStore } from "@kronos-ts/test"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { app } from "../src/app"
import { testEnv } from "./env"

/**
 * The app a spec file runs its scenarios against: the same `app()` `main.ts` calls, over test resources. The log is
 * in memory and recorded, holding its deadlines against the app's clock; the command bus is recorded; the query bus is
 * the local one. So the app is one `fixture()` accepts. Build it once at the top of a spec file; it stops the app, and
 * drops its database, after the file's last test.
 *
 * `db: true` puts the read models, processor tokens and dead letters on a fresh Postgres database
 * (`bun run infra:up`); without it everything is in memory and no Docker is needed. `clock` is the one the app's tasks
 * and deadlines read: pass your own to read the time a scenario starts at. `exporter` turns tracing on, for a spec
 * that reads the spans.
 *
 * Scenarios on one fixture share the app and the database and nothing is reset between them, so each one mints ids
 * of its own with `Bun.randomUUIDv7()`.
 *
 *   const scenarios = fixture(testApp([addItem]))
 *   it("…", async () => {
 *     const aggregateId = Bun.randomUUIDv7()
 *     await scenarios.given(…).when(command(AddItem, …)).then(…)
 *   })
 */
export function testApp(slices: ReadonlyArray<Slice>, options: { db?: boolean; clock?: AdvanceableClock; exporter?: OtlpExporter } = {}) {
  const opened = open(slices, options)
  afterAll(async () => {
    const { running, database } = await opened
    await running.stop()
    await database?.drop()
  })
  return opened.then(({ running }) => running)
}

async function open(slices: ReadonlyArray<Slice>, options: { db?: boolean; clock?: AdvanceableClock; exporter?: OtlpExporter }) {
  const clock = options.clock ?? advanceableClock()
  const uow = () => unitOfWork(clock)
  const database = options.db ? await freshDatabase() : undefined
  const pg = database?.pg
  const running = app(
    {
      eventStore: pipe(
        inMemoryEventStore(),
        inMemorySnapshottingEventStore,
        (s) => recordingEventStore(s, { clock }),
      ),
      commandBus: pipe(
        localCommandBus(uow),
        (b) => interceptingCommandBus(b, correlation),
        recordingCommandBus,
      ),
      queryBus: pipe(
        localQueryBus(uow),
        (b) => interceptingQueryBus(b, correlation),
      ),
      tokenStore: pg ? postgresTokenStore(pg) : inMemoryTokenStore(),
      deadLetterQueue: pg ? postgresDeadLetterQueue(pg) : inMemoryDeadLetterQueue(),
      processing: pg ? pipe(uow, (u) => postgresUnitOfWork(u, pg)) : uow,
      pg,
      log: quietLog,
      exporter: options.exporter,
    },
    slices,
  )
  return { running, database }
}

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
