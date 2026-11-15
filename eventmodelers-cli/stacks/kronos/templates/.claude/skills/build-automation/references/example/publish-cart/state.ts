import { state } from "@kronos-ts/core"
import { z } from "zod"
import { CartPublished } from "../events"

/**
 * Whether the cart is published yet: the one thing publishing needs that the submitted cart does not carry. The
 * board's todo list ("Submitted Cart Data") opens an item with CartSubmitted, whose payload is the cart, and closes it
 * with CartPublished.
 */
export const Publication = state({
  id: { aggregateId: z.uuid() },
  tags: (id) => ({ aggregateId: id.aggregateId }),
  evolve: [(): { published: boolean } => ({ published: false }), [CartPublished, () => ({ published: true })]],
})
