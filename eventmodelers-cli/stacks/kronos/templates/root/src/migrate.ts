import { drizzle } from "drizzle-orm/postgres-js"
import { migrate as apply } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

const migrationsFolder = new URL("../migrations", import.meta.url).pathname

/**
 * Applies the read models' migrations (`bun run db:generate` writes them). Nothing to do until the first slice with a
 * schema.ts. Instances starting together take turns on an advisory lock, so only one migrates.
 */
export const migrate = async (databaseUrl: string) => {
  if (!(await Bun.file(`${migrationsFolder}/meta/_journal.json`).exists())) return
  const session = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  try {
    await session`select pg_advisory_lock(hashtext('migrations'))`
    await apply(drizzle(session), { migrationsFolder })
  } finally {
    await session.end()
  }
}
