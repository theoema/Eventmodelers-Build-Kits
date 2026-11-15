import type { z } from "zod"

/**
 * Parse an environment against its schema, or fail naming EVERY invalid variable at once. Never prints a value: some
 * are secrets. An empty value counts as unset.
 */
export function parseEnv<S extends z.ZodObject>(schema: S, source: Record<string, string | undefined>): z.output<S> {
  const set = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""))
  const parsed = schema.safeParse(set)
  if (parsed.success) return parsed.data
  const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
  throw new Error(`Invalid environment:\n${problems.join("\n")}`)
}
