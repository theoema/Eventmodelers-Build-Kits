import type { CommandContext } from "#kit"
import { commandHandler } from "@kronos-ts/core"
import { ItemArchived } from "../events"
import { ArchiveItem } from "./command"
import { CartProducts } from "./state"

/** Archive every item of the product in the cart. None left (a retry, or it was removed) lands nothing. */
export const handle = commandHandler(ArchiveItem, async ({ payload: p }, ctx: CommandContext) => {
  const cart = await ctx.load(CartProducts, { aggregateId: p.aggregateId })
  for (const item of cart.items.filter((i) => i.productId === p.productId))
    ctx.append(ItemArchived, { aggregateId: p.aggregateId, itemId: item.itemId })
  return { ok: true }
})
