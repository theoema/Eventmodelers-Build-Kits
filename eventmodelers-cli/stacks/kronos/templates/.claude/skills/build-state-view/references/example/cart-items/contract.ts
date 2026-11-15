import { documented } from "#kit/documented"
import { eventIterator, oc } from "@orpc/contract"
import { openapi } from "@orpc/openapi"
import { z } from "zod"
import { CartItem, GetCartItems } from "./query"

/** One item, as the API describes it: in the answer and in the stream's changes alike. */
const item = {
  itemId: { description: "The item in the cart.", examples: ["0192f3a0-0000-7000-8000-000000000101"] },
  productId: { description: "The product the item is.", examples: ["0192f3a0-0000-7000-8000-000000000201"] },
  description: { description: "The product's name.", examples: ["Running shoes"] },
  image: { description: "The product's picture.", examples: ["shoes.png"] },
  price: { description: "The price the item was added at.", examples: [49.9] },
}

/** What the caller asks with: the query's payload, as is, in the API's words. */
export const Request = documented(GetCartItems.payload, {
  aggregateId: { description: "The cart.", examples: ["0192f3a0-0000-7000-8000-000000000001"] },
})
/** The answer: what the query's success carries, as is, in the API's words. */
export const Response = documented(GetCartItems.result.success, {
  aggregateId: { description: "The cart.", examples: ["0192f3a0-0000-7000-8000-000000000001"] },
  items: { description: "The items in the cart, oldest first.", fields: item },
  totalPrice: { description: "What the items cost together.", examples: [99.8] },
})

/**
 * The stream: `initial`, the cart as the plain query answers it, then an `update` for each item added or removed. A
 * list streams the change to one row, so a long cart is not sent again for each item; the changes are the
 * projection's (`CartItemsUpdate`), in the API's words.
 */
export const StreamEvent = z.union([
  z.object({ type: z.literal("initial"), cart: Response }),
  z.object({ type: z.literal("update"), change: z.literal("added"), item: documented(CartItem, item) }),
  z.object({ type: z.literal("update"), change: z.literal("removed"), itemId: z.uuid().meta(item.itemId) }),
])

const cartItems = oc
  .meta(
    openapi({
      method: "GET",
      path: "/understanding-eventsourcing/cart-items",
      tags: ["Cart Items"],
      summary: "A cart's items and their total",
      description: "The items in a customer's cart and what they cost together. An unknown cart answers an empty one.",
    }),
  )
  .input(Request)
  .output(Response)

/** The same view, live (Server-Sent Events): its initial state, then every update until the client goes away. */
const cartItemsStream = oc
  .meta(
    openapi({
      method: "GET",
      path: "/understanding-eventsourcing/cart-items/stream",
      tags: ["Cart Items"],
      summary: "A cart's items, live",
      description:
        "The same view as a stream (Server-Sent Events): first `initial`, the cart as the plain query answers it, then an `update` for each item that comes (`change: added`) or goes (`change: removed`), until the client goes away. An automation archives items while the cart is open.",
    }),
  )
  .input(Request)
  .output(eventIterator(StreamEvent))

export const contract = { cartItems, cartItemsStream }
