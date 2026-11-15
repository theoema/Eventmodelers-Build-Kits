import { expect, it } from "bun:test"
import { parseEnv } from "#kit"
import { Env } from "./env"

const required = { DATABASE_URL: "postgres://app:app@localhost:5432/app", KRONOSDB_HOST: "localhost" }

it("applies the defaults to an environment that has what is required", () => {
  expect(parseEnv(Env, required)).toEqual({
    ...required,
    PORT: 3000,
    KRONOSDB_PORT: 50051,
    KRONOSDB_CONTEXT: "default",
    LOG_LEVEL: "info",
    OTEL_SERVICE_NAME: "app",
    NODE_ENV: "production",
  })
})

it("fails naming the required variables an empty environment lacks, with no localhost to fall back on", () => {
  expect(() => parseEnv(Env, {})).toThrow(/DATABASE_URL[\s\S]*KRONOSDB_HOST/)
  expect(() => parseEnv(Env, { ...required, KRONOSDB_HOST: "" })).toThrow(/KRONOSDB_HOST/)
})

it("reads API_DOCS as a boolean, and leaves it unset for main.ts to default by NODE_ENV", () => {
  expect(parseEnv(Env, required).API_DOCS).toBeUndefined()
  expect(parseEnv(Env, { ...required, API_DOCS: "true" }).API_DOCS).toBe(true)
  expect(parseEnv(Env, { ...required, API_DOCS: "false" }).API_DOCS).toBe(false)
  expect(() => parseEnv(Env, { ...required, API_DOCS: "sometimes" })).toThrow(/API_DOCS/)
})

it("leaves telemetry off unless an endpoint is set", () => {
  expect(parseEnv(Env, required).OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined()
  expect(parseEnv(Env, { ...required, OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" }).OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
    "http://localhost:4318",
  )
})

it("coerces numbers and reads an empty value as unset", () => {
  const env = parseEnv(Env, { ...required, PORT: "8080", KRONOSDB_PORT: "", LOG_LEVEL: "debug" })
  expect(env.PORT).toBe(8080)
  expect(env.KRONOSDB_PORT).toBe(50051)
  expect(env.LOG_LEVEL).toBe("debug")
})

it("fails naming every invalid variable at once, and never their values", () => {
  const parse = () => parseEnv(Env, { ...required, PORT: "eighty", LOG_LEVEL: "loud", OTEL_EXPORTER_OTLP_ENDPOINT: "s3cr3t-not-a-url" })
  expect(parse).toThrow(/PORT[\s\S]*LOG_LEVEL[\s\S]*OTEL_EXPORTER_OTLP_ENDPOINT/)
  expect(parse).not.toThrow(/eighty|loud|s3cr3t/)
})
