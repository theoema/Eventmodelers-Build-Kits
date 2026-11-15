import type { QueryContext } from "#kit"
import { queryHandler } from "@kronos-ts/core"
import { asc, eq } from "drizzle-orm"
import { GetCartItems } from "./query"
import { cartItems } from "./schema"

/** The read side: the cart's items, oldest first, and their total. */
export const handle = queryHandler(GetCartItems, async ({ payload: p }, ctx: QueryContext) => {
  const items = await ctx.db
    .select({
      itemId: cartItems.itemId,
      productId: cartItems.productId,
      description: cartItems.description,
      image: cartItems.image,
      price: cartItems.price,
    })
    .from(cartItems)
    .where(eq(cartItems.aggregateId, p.aggregateId))
    .orderBy(asc(cartItems.itemId))
  return { ok: true, aggregateId: p.aggregateId, items, totalPrice: items.reduce((sum, i) => sum + i.price, 0) }
})
