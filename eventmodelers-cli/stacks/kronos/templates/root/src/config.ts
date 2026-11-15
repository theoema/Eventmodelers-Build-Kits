import { pipe } from "#kit"
import {
  correlation,
  deadLettering as coreDeadLettering,
  eventProcessor as coreEventProcessor,
  type EventProcessor,
  interceptingCommandBus,
  interceptingQueryBus,
  jsonSerializer,
  localCommandBus,
  localFirstQueryBus,
  localQueryBus,
  type Sequence,
  unitOfWork,
} from "@kronos-ts/core"
import {
  kronosDbCommandBus,
  kronosDbConnection,
  kronosDbEventStore,
  kronosDbQueryBus,
  kronosDbSchedulingEventStore,
} from "@kronos-ts/kronosdb"
import { otlpCommandBus, otlpQueryBus } from "@kronos-ts/otlp"
import { postgresDeadLetterQueue, postgresPool, postgresTokenStore, postgresUnitOfWork } from "@kronos-ts/postgres"
import { postgresAdapter } from "@kronos-ts/postgres/adapters/postgres"
import { env } from "./env"
import { migrate } from "./migrate"
import { exporter } from "./telemetry"

// The infrastructure, built and configured here and nowhere else. `main.ts` wires the app's handlers to it.

/** Kronos's `eventProcessor` with the log, tokens and unit of work applied: a slice gives it only a name. */
export const eventProcessor = (name: string) =>
  coreEventProcessor(name, eventStore, postgresTokenStore(pg), postgresUnitOfWork(unitOfWork, pg))

/** Kronos's `deadLettering` with the dead-letter queue applied: a slice gives it only its processor and its lanes. */
export const deadLettering = (processor: EventProcessor, sequence: Sequence) =>
  coreDeadLettering(processor, postgresDeadLetterQueue(pg), sequence)

// Postgres: the read models, tokens and dead letters.
export const pg = postgresPool(postgresAdapter({ connectionString: env.DATABASE_URL, clientOptions: { onnotice: () => {} } }))
await pg.start()
await migrate(env.DATABASE_URL)

// KronosDB: one connection for the event log and both buses. `main.ts` starts it once every handler is subscribed.
export const context = env.KRONOSDB_CONTEXT
export const kdb = await kronosDbConnection({
  componentName: "app",
  host: env.KRONOSDB_HOST,
  port: env.KRONOSDB_PORT,
  token: env.KRONOSDB_TOKEN,
  serializer: jsonSerializer(),
})

export const eventStore = pipe(
  kronosDbEventStore(kdb, context),
  (s) => kronosDbSchedulingEventStore(s, kdb, context),
)

// Commands always go through KronosDB; queries are answered locally first, as every instance reads the same Postgres.
export const commandBus = pipe(
  localCommandBus(unitOfWork),
  (b) => kronosDbCommandBus(b, kdb, context),
  (b) => (exporter ? otlpCommandBus(b, exporter) : b),
  (b) => interceptingCommandBus(b, correlation),
)
export const queryBus = pipe(
  localQueryBus(unitOfWork),
  (b) => localFirstQueryBus(kronosDbQueryBus(b, kdb, context), b),
  (b) => (exporter ? otlpQueryBus(b, exporter) : b),
  (b) => interceptingQueryBus(b, correlation),
)

/** Closes it all once the app has stopped: KronosDB after draining both buses' in-flight work. */
export const close = async () => {
  await kdb.close()
  await pg.close()
  await exporter?.close()
}

export { exporter, log } from "./telemetry"
