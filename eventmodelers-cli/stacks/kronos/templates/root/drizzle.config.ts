import { defineConfig } from "drizzle-kit"

// Read-model migrations only (`bun run db:generate` needs no database). Kronos's own tables (tokens, dead letters)
// bootstrap with the pool, and `main.ts` applies the migrations when it boots.
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/slices/**/schema.ts"],
  out: "./migrations",
})
