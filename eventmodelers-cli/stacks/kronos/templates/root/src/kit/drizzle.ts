import { describe } from "@kronos-ts/core"
import type { PostgresCapability } from "@kronos-ts/postgres"
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import type { Sql } from "postgres"

/** `ctx.db`: drizzle over the handling's transaction. */
export type DrizzleCapability = { readonly db: PostgresJsDatabase }

/** A handler that names `db` and reads it over `sql()`; anything else is told what is wrong, in its type. */
type DemandsDb<H> = H extends (message: any, context: infer C) => any
  ? C extends DrizzleCapability & PostgresCapability
    ? unknown
    : "drizzleHandler supplies ctx.db over ctx.sql(): wrap a handler whose context names both (QueryContext, EventContext)"
  : never

/**
 * Drizzle over `ctx.sql()` as `ctx.db`. Goes INSIDE `postgresHandler`, which supplies the transaction; the boot walk
 * refuses it outside. Never call `db.transaction()` on it: it is already inside the handling's transaction.
 *
 * Generic over the whole handler, as `postgresHandler` is, so it wraps handlers for different messages alike. `main.ts`
 * puts it on every query and event handler: `pipe(handler.handler, drizzleHandler, (next) => postgresHandler(next, pg), …)`.
 */
export const drizzleHandler = <H extends (message: any, context: any) => any>(next: H & DemandsDb<H>) =>
  describe(
    (message: Parameters<H>[0], context: Omit<Parameters<H>[1], "db">): ReturnType<H> =>
      next(message, { ...context, db: drizzle((context as PostgresCapability).sql().unwrap<Sql>()) }),
    { name: "drizzleHandler", supplies: ["db"], uses: ["sql"], next } as const,
  )
