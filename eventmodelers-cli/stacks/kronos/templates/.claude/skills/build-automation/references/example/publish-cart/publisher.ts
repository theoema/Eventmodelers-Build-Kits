import type { ClientContext } from "#kit"
import type { z } from "zod"
import type { PublishCart } from "./command"

/**
 * What publishing needs from the system carts are published to: only the call it makes. The context's index.ts
 * hands in the real one, a spec a recording one. Every call takes the handling's `ctx`, so it is traced and logged
 * with it.
 */
export type CartPublisher = { publish(cart: z.output<typeof PublishCart.payload>, ctx: ClientContext): Promise<void> }
