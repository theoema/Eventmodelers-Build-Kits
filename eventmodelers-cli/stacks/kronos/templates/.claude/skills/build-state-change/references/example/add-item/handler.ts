import type { CommandContext } from "#kit"
import { commandHandler } from "@kronos-ts/core"
import { CartCreated, ItemAdded } from "../events"
import { AddItem } from "./command"
import { Cart } from "./state"

const MAX_ITEMS = 3

/** Load the cart, decide, append. Adding an item already in the cart is a retry: it lands once. */
export const handle = commandHandler(AddItem, async ({ payload: p }, ctx: CommandContext) => {
  const cart = await ctx.load(Cart, { aggregateId: p.aggregateId })
  if (cart.items.includes(p.itemId)) return { ok: true }
  if (cart.items.length >= MAX_ITEMS) return { ok: false, rejection: "CART_FULL", aggregateId: p.aggregateId, items: cart.items.length }
  if (!cart.created) ctx.append(CartCreated, { aggregateId: p.aggregateId })
  ctx.append(ItemAdded, p)
  return { ok: true }
})
