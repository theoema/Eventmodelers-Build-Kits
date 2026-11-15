import type { EventContext, PartialProcessor } from "#kit"
import { batched, eventHandler, eventProcessor } from "@kronos-ts/core"
import { eq } from "drizzle-orm"
import { CartCleared, ItemAdded, ItemArchived, ItemRemoved } from "../events"
import { GetCartItems, type CartItemsUpdate } from "./query"
import { cartItems } from "./schema"

/**
 * Global order, a batch of events per transaction, no dead-letter queue: a failing handler holds the token and retries.
 * Named for what it writes: a new table means a new name, so it replays from the start.
 */
const processor: PartialProcessor = (eventStore, tokenStore, unitOfWork) =>
  batched(eventProcessor("cart-items", eventStore, tokenStore, unitOfWork), 100)

/** The columns a subscriber sees: the view's item, nothing of the row's bookkeeping. */
const item = {
  itemId: cartItems.itemId,
  productId: cartItems.productId,
  description: cartItems.description,
  image: cartItems.image,
  price: cartItems.price,
}

/**
 * The write side: an item in, an item out, every item out. The view streams (the cart screen changes while it is
 * open: an automation archives items), so each write returns what it changed and emits it to the cart's subscribers.
 * A write that changed nothing returns nothing, so a replayed event emits nothing. Updates leave after the batch
 * commits.
 */
export const projection = [
  eventHandler(ItemAdded, async ({ payload: p }, ctx: EventContext) => {
    const added = await ctx.db
      .insert(cartItems)
      .values({ itemId: p.itemId, aggregateId: p.aggregateId, productId: p.productId, description: p.description, image: p.image, price: p.price })
      .onConflictDoNothing()
      .returning(item)
    for (const row of added) {
      ctx.emitUpdate(GetCartItems, (q) => q.aggregateId === p.aggregateId, { change: "added", item: row } satisfies CartItemsUpdate)
    }
  }),
  eventHandler(ItemRemoved, async ({ payload: p }, ctx: EventContext) => {
    const removed = await ctx.db.delete(cartItems).where(eq(cartItems.itemId, p.itemId)).returning({ itemId: cartItems.itemId })
    for (const row of removed) {
      ctx.emitUpdate(GetCartItems, (q) => q.aggregateId === p.aggregateId, { change: "removed", itemId: row.itemId } satisfies CartItemsUpdate)
    }
  }),
  eventHandler(ItemArchived, async ({ payload: p }, ctx: EventContext) => {
    const removed = await ctx.db.delete(cartItems).where(eq(cartItems.itemId, p.itemId)).returning({ itemId: cartItems.itemId })
    for (const row of removed) {
      ctx.emitUpdate(GetCartItems, (q) => q.aggregateId === p.aggregateId, { change: "removed", itemId: row.itemId } satisfies CartItemsUpdate)
    }
  }),
  eventHandler(CartCleared, async ({ payload: p }, ctx: EventContext) => {
    const removed = await ctx.db.delete(cartItems).where(eq(cartItems.aggregateId, p.aggregateId)).returning({ itemId: cartItems.itemId })
    for (const row of removed) {
      ctx.emitUpdate(GetCartItems, (q) => q.aggregateId === p.aggregateId, { change: "removed", itemId: row.itemId } satisfies CartItemsUpdate)
    }
  }),
].map((h) => ({ ...h, processor }))

