import { state } from "@kronos-ts/core"
import { z } from "zod"
import { CartCleared, ItemAdded, ItemArchived, ItemRemoved } from "../events"

type Items = { items: { itemId: string; productId: string }[] }

/** The cart's items, each with its product: which ones a product's change takes out. */
export const CartProducts = state({
  id: { aggregateId: z.uuid() },
  tags: (id) => ({ aggregateId: id.aggregateId }),
  evolve: [
    (): Items => ({ items: [] }),
    [ItemAdded, (s, { payload }) => ({ items: [...s.items, { itemId: payload.itemId, productId: payload.productId }] })],
    [ItemRemoved, (s, { payload }) => ({ items: s.items.filter((i) => i.itemId !== payload.itemId) })],
    [ItemArchived, (s, { payload }) => ({ items: s.items.filter((i) => i.itemId !== payload.itemId) })],
    [CartCleared, (): Items => ({ items: [] })],
  ],
})
