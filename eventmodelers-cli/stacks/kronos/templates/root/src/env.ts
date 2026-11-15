import { parseEnv } from "#kit"
import { z } from "zod"

/**
 * Every environment variable the app reads, typed. A new variable is added here (and to `.env.example`); nothing
 * reads `process.env` directly, everything imports `env`. An empty value counts as unset. What the app cannot run
 * without has no default: importing `env` without it stops the process, naming it. The dev values are in
 * `.env.example`; tests get them from `.env.test`.
 */
export const Env = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_URL: z.url(),
  KRONOSDB_HOST: z.string().min(1),
  KRONOSDB_PORT: z.coerce.number().int().min(1).max(65535).default(50051),
  KRONOSDB_CONTEXT: z.string().default("default"),
  /** An access token, when the server asks for one. */
  KRONOSDB_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Telemetry is optional: unset, nothing is traced and nothing pays for it. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  OTEL_SERVICE_NAME: z.string().default("app"),
  /** `development` turns on what only a developer should see (the API reference at /docs). Unset is production. */
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  /** The API reference (Scalar) at /docs. Unset: on in development only. `true` serves it in production too. */
  API_DOCS: z.stringbool().optional(),
})

export const env = parseEnv(Env, process.env)
