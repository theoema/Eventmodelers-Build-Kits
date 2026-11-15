// The kit: the conventions every slice follows. kronos-ts, oRPC and drizzle are used directly, with their own types.

export { type Actor, ANONYMOUS, actorOf, origin, SYSTEM } from "./actor"
export type { ClientContext, CommandContext, EventContext, QueryContext } from "./context"
export { type DrizzleCapability, drizzleHandler } from "./drizzle"
export { correlationIdOf, type Edge, edge } from "./edge"
export { parseEnv } from "./env"
export { both } from "./logging"
export { pipe } from "./pipe"
export { type DocsOf, documented, type FieldDoc } from "./documented"
export { type Problems, problemsOf, refuse, statusesOf, type Wording } from "./problems"
export { type Rejection, rejection, result } from "./result"
export type { PartialProcessor, Slice } from "./slice"
