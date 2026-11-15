import type { App } from "@kronos-ts/core"
import { identify } from "./app/auth"
import { serve } from "./app/http"
import { context, exporter, log } from "./config"
import { env } from "./env"
import { router, statuses } from "./slices"

/** The HTTP side: every context's procedures on PORT, with the API reference at /docs in development. */
export const listen = async (running: App) => {
  const server = await serve(running, { router, statuses }, {
    log,
    exporter,
    port: env.PORT,
    docs: env.API_DOCS ?? env.NODE_ENV === "development",
    // Who is asking, and who may call what: src/app/auth.ts.
    identify,
  })
  log.info("listening", { url: String(server.url), events: `KronosDB ${context}`, tracing: exporter ? env.OTEL_EXPORTER_OTLP_ENDPOINT : "off" })
  return server
}
