import { both } from "#kit"
import { consoleLogger } from "@kronos-ts/core"
import { otlpExporter, otlpLogger } from "@kronos-ts/otlp"
import { env } from "./env"

// Optional: spans and log records over OTLP only when OTEL_EXPORTER_OTLP_ENDPOINT is set; JSON log lines always.
export const exporter = env.OTEL_EXPORTER_OTLP_ENDPOINT
  ? otlpExporter({
      endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      serviceName: env.OTEL_SERVICE_NAME,
      resource: { "deployment.environment.name": env.NODE_ENV },
    })
  : undefined

export const log = exporter
  ? both(consoleLogger({ level: env.LOG_LEVEL }), otlpLogger(exporter, { level: env.LOG_LEVEL }))
  : consoleLogger({ level: env.LOG_LEVEL })
