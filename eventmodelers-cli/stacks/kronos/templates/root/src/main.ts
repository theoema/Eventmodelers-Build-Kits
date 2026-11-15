import { drizzleHandler, origin, pipe, untraced } from "#kit"
import { correlatingHandler, kronos, loggingHandler, messageOrigin, validatingHandler } from "@kronos-ts/core"
import { otlpHandler } from "@kronos-ts/otlp"
import { postgresHandler } from "@kronos-ts/postgres"
import {
  close,
  commandBus,
  deadLettering,
  eventProcessor,
  eventStore,
  exporter,
  kdb,
  log,
  pg,
  queryBus,
} from "./config"
import { listen } from "./server"
import { app } from "./slices"

// The final wiring: the app's handlers (src/slices/index.ts) wired to the infrastructure (src/config.ts) and run.
const handlers = app(eventProcessor, deadLettering)

// A kind's list arrives with its first slice (an empty list has no type to infer).
const running = kronos({})
// Every handler is subscribed now; wait until KronosDB routes to them before taking requests.
await kdb.start()
const server = await listen(running)

const shutdown = async () => {
  await server.stop()
  await running.stop()
  await close()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
