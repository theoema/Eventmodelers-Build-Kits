import { result } from "#kit/result"
import { z } from "zod"
import { ns } from "../events"

/** One item as the cart shows it. */
export const CartItem = z.object({ itemId: z.uuid(), productId: z.uuid(), description: z.string(), image: z.string(), price: z.number() })
export type CartItem = z.infer<typeof CartItem>

/** A cart's items and what they cost together. An unknown cart is an empty one. */
export const GetCartItems = ns.query("GetCartItems", {
  payload: z.object({ aggregateId: z.uuid() }),
  result: result({ aggregateId: z.uuid(), items: z.array(CartItem), totalPrice: z.number() }),
})

/**
 * What the projection emits to a cart's subscribers: the row a write touched, as `returning()` gives it back. A list
 * view streams its rows' changes, not the whole list again; the subscriber keeps the list (and its total) itself.
 */
export const CartItemsUpdate = z.discriminatedUnion("change", [
  z.object({ change: z.literal("added"), item: CartItem }),
  z.object({ change: z.literal("removed"), itemId: z.uuid() }),
])
export type CartItemsUpdate = z.infer<typeof CartItemsUpdate>
