import type { EventContext, PartialProcessor } from "#kit"
import { batched, eventHandler, eventProcessor } from "@kronos-ts/core"
import { asc, eq } from "drizzle-orm"
import { PriceChanged } from "../events"
import { ArchiveItem } from "./command"
import { projection } from "./projection"
import { archiveItemCarts } from "./schema"

/**
 * The slice's one processor: its read model's handlers first, then the automation, for every event in log order. The
 * automation reads the table through the batch's own transaction (`ctx.db`), so the rows are current up to the very
 * PriceChanged it handles. The cost: global order, no lanes and no dead-lettering, so a failing archive holds the
 * slice. Named for the slice: a new name replays the log from the start.
 */
const processor: PartialProcessor = (eventStore, tokenStore, unitOfWork) =>
  batched(eventProcessor("archive-item", eventStore, tokenStore, unitOfWork), 100)

/**
 * When a product's price changes, every cart holding it archives it: the customer re-adds it at the new price.
 *
 * The carts come from this slice's own read model, not a fold: folding every add and removal of a popular product on
 * each price change would read without bound. Each ArchiveItem still decides against its own cart.
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
].map((h) => ({ ...h, processor }))
