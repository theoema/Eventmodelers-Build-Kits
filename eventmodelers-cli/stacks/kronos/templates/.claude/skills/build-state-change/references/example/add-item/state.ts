import { state } from "@kronos-ts/core"
import { z } from "zod"
import { CartCleared, CartCreated, ItemAdded, ItemArchived, ItemRemoved } from "../events"

/** The cart as this decision needs it: whether it exists, and which items are in it. */
export const Cart = state({
  id: { aggregateId: z.uuid() },
  tags: (id) => ({ aggregateId: id.aggregateId }),
  evolve: [
    (): { created: boolean; items: string[] } => ({ created: false, items: [] }),
    [CartCreated, (s) => ({ ...s, created: true })],
    [ItemAdded, (s, { payload }) => ({ ...s, items: [...s.items, payload.itemId] })],
    [ItemRemoved, (s, { payload }) => ({ ...s, items: s.items.filter((id) => id !== payload.itemId) })],
    [ItemArchived, (s, { payload }) => ({ ...s, items: s.items.filter((id) => id !== payload.itemId) })],
    [CartCleared, (s) => ({ ...s, items: [] })],
  ],
})
