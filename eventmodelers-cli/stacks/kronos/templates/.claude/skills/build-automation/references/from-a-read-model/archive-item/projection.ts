import type { EventContext } from "#kit"
import { eventHandler } from "@kronos-ts/core"
import { eq } from "drizzle-orm"
import { CartCleared, ItemAdded, ItemArchived, ItemRemoved } from "../events"
import { archiveItemCarts } from "./schema"

/** Which carts hold which product: the todo list's INBOUND events, and the one that closes an item. */
export const projection = [
  eventHandler(ItemAdded, async ({ payload: p }, ctx: EventContext) => {
    await ctx.db
      .insert(archiveItemCarts)
      .values({ itemId: p.itemId, aggregateId: p.aggregateId, productId: p.productId })
      .onConflictDoNothing()
  }),
  eventHandler(ItemRemoved, async ({ payload: p }, ctx: EventContext) => {
    await ctx.db.delete(archiveItemCarts).where(eq(archiveItemCarts.itemId, p.itemId))
  }),
  eventHandler(ItemArchived, async ({ payload: p }, ctx: EventContext) => {
    await ctx.db.delete(archiveItemCarts).where(eq(archiveItemCarts.itemId, p.itemId))
  }),
  eventHandler(CartCleared, async ({ payload: p }, ctx: EventContext) => {
    await ctx.db.delete(archiveItemCarts).where(eq(archiveItemCarts.aggregateId, p.aggregateId))
  }),
]
