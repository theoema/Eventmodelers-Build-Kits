import { withNamespace } from "@kronos-ts/core"
import { z } from "zod"

/** The context's namespace and every event in it. Slices share these, and nothing else. */
export const ns = withNamespace("understanding-eventsourcing")

export const CartCreated = ns.event("CartCreated", {
  payload: z.object({ aggregateId: z.uuid() }),
  tags: { aggregateId: (p) => p.aggregateId },
})

export const ItemAdded = ns.event("ItemAdded", {
  payload: z.object({
    aggregateId: z.uuid(),
    description: z.string(),
    image: z.string(),
    price: z.number(),
    itemId: z.uuid(),
    productId: z.uuid(),
    // Assumed optional: the model has no source for it (Add Item does not carry it).
    deviceFingerPrint: z.string().optional(),
  }),
  tags: { aggregateId: (p) => p.aggregateId, itemId: (p) => p.itemId, productId: (p) => p.productId },
})

export const ItemRemoved = ns.event("ItemRemoved", {
  payload: z.object({ aggregateId: z.uuid(), itemId: z.uuid() }),
  tags: { aggregateId: (p) => p.aggregateId, itemId: (p) => p.itemId },
})

export const CartCleared = ns.event("CartCleared", {
  payload: z.object({ aggregateId: z.uuid() }),
  tags: { aggregateId: (p) => p.aggregateId },
})

export const ItemArchived = ns.event("ItemArchived", {
  payload: z.object({ aggregateId: z.uuid(), itemId: z.uuid() }),
  tags: { aggregateId: (p) => p.aggregateId, itemId: (p) => p.itemId },
})

export const PriceChanged = ns.event("PriceChanged", {
  payload: z.object({ newPrice: z.number(), oldPrice: z.number(), productId: z.uuid() }),
  tags: { productId: (p) => p.productId },
})

/** A product in a submitted cart. The model's `orderedProducts` is Custom with no subfields; assumed: id and price. */
export const OrderedProduct = z.object({ productId: z.uuid(), price: z.number() })

export const CartSubmitted = ns.event("CartSubmitted", {
  payload: z.object({ aggregateId: z.uuid(), orderedProducts: z.array(OrderedProduct), totalPrice: z.number() }),
  tags: { aggregateId: (p) => p.aggregateId },
})

export const CartPublished = ns.event("CartPublished", {
  payload: z.object({ aggregateId: z.uuid() }),
  tags: { aggregateId: (p) => p.aggregateId },
})
