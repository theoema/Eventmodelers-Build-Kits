import { describe } from "@kronos-ts/core"
import type { PostgresCapability } from "@kronos-ts/postgres"
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import type { Sql } from "postgres"

/** `ctx.db`: drizzle over the handling's transaction. */
export type DrizzleCapability = { readonly db: PostgresJsDatabase }

/**
 * Drizzle over `ctx.sql()` as `ctx.db`. Goes INSIDE `postgresHandler`, which supplies the transaction; the boot walk
 * refuses it outside. Never call `db.transaction()` on it: it is already inside the handling's transaction.
 */
export const drizzleHandler = <M, C extends PostgresCapability, R>(next: (message: M, context: C & DrizzleCapability) => R) =>
  describe((message: M, context: C): R => next(message, { ...context, db: drizzle(context.sql().unwrap<Sql>()) }), {
    name: "drizzleHandler",
    supplies: ["db"],
    uses: ["sql"],
    next,
  } as const)
