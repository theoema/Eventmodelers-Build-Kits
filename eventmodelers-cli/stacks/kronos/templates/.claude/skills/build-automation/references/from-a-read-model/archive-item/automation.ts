import type { EventContext } from "#kit"
import { eventHandler } from "@kronos-ts/core"
import { asc, eq } from "drizzle-orm"
import { PriceChanged } from "../events"
import { ArchiveItem } from "./command"
import { projection } from "./projection"
import { archiveItemCarts } from "./schema"

/**
 * When a product's price changes, every cart holding it archives it: the customer re-adds it at the new price.
 *
 * The carts come from this slice's own read model, not a fold: folding every add and removal of a popular product on
 * each price change would read without bound. Each ArchiveItem still decides against its own cart. The read model's
 * handlers come first: the slice's index.ts puts them all on its one processor, in this order.
 */
export const automation = [
  ...projection,
  eventHandler(PriceChanged, async ({ payload: p }, ctx: EventContext) => {
    const carts = await ctx.db
      .selectDistinct({ aggregateId: archiveItemCarts.aggregateId })
      .from(archiveItemCarts)
      .where(eq(archiveItemCarts.productId, p.productId))
      .orderBy(asc(archiveItemCarts.aggregateId))
    for (const cart of carts) await ctx.send(ArchiveItem, { aggregateId: cart.aggregateId, productId: p.productId })
  }),
]
