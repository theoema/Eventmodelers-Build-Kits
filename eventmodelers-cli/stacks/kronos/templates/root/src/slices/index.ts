import type { Slice } from "#kit"
import type { AnyRouter } from "@orpc/server"

/**
 * Every context the app runs, listed explicitly. Each context's index.ts lists its own slices and wires what only
 * they use, so this file grows by a line per context, never per slice.
 */
const contexts: Record<string, ReadonlyArray<Slice>> = {}

/** Every slice the app runs. */
export const slices: ReadonlyArray<Slice> = Object.values(contexts).flat()

// The next two are HTTP only: `app()` never sees them, and a test of a handler does not need them.

/**
 * Every slice's procedures, one router per context: two contexts may name a procedure alike. `serve` hands them to
 * oRPC's REST handler; an oRPC plugin (MCP, pub/sub) would serve the same router and contract next to it.
 */
export const router: Record<string, AnyRouter> = Object.fromEntries(
  Object.entries(contexts).map(([name, slices]) => [name, Object.assign({}, ...slices.map((s) => s.router ?? {}))]),
)

/** Every slice's HTTP statuses in one map, as oRPC keys them: by code alone, so a code is one status everywhere. */
export const statuses: Record<string, number> = {}
for (const [code, status] of slices.flatMap((s) => Object.entries(s.statuses ?? {}))) {
  if (statuses[code] !== undefined && statuses[code] !== status) {
    throw new Error(`${code} answers ${statuses[code]} in one slice and ${status} in another`)
  }
  statuses[code] = status
}
