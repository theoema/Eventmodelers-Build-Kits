import type { Edge } from "#kit"
import { implement } from "@orpc/server"
import { contract } from "./contract"
import { type CartItemsUpdate, GetCartItems } from "./query"

const impl = implement(contract).$context<Edge>()

export const router = {
  cartItems: impl.cartItems.handler(async ({ input, context }) => {
    const { ok: _, ...cart } = await context.query(GetCartItems, input)
    return cart
  }),
  // Subscribe before reading, so no change between the read and the subscription is lost. The client going away
  // closes the subscription.
  cartItemsStream: impl.cartItemsStream.handler(async function* ({ input, context, signal }) {
    const live = context.subscribe(GetCartItems, input)
    signal?.addEventListener("abort", () => live.close())
    try {
      const { ok: _, ...cart } = await live.initialResult
      yield { type: "initial", cart }
      for await (const update of live.updates) yield { type: "update", ...(update as CartItemsUpdate) }
    } finally {
      live.close()
    }
  }),
}
