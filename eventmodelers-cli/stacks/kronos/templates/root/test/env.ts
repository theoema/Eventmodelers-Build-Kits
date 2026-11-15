import { z } from "zod"
import { parseEnv } from "#kit"

/** What the tests read: the server their fresh databases are made on, and whether handlers' log lines are shown. */
export const testEnv = parseEnv(
  z.object({
    TEST_DATABASE_URL: z.url().default("postgres://app:app@localhost:5432/app"),
    /** Unset: silent. */
    TEST_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  }),
  process.env,
)
