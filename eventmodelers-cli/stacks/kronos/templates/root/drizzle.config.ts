import { defineConfig } from "drizzle-kit"

// Read-model migrations only: Kronos's own tables bootstrap with the pool.
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/slices/**/schema.ts"],
  out: "./migrations",
})
