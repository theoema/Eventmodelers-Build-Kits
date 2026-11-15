import { documented } from "#kit/documented"
import { problemsOf, statusesOf } from "#kit/problems"
import { oc } from "@orpc/contract"
import { openapi } from "@orpc/openapi"
import { z } from "zod"
import { AddItem } from "./command"

/** What the caller sends: the command's payload, as is, in the API's words. */
export const Request = documented(AddItem.payload, {
  aggregateId: { description: "The cart. The first item creates it.", examples: ["0192f3a0-0000-7000-8000-000000000001"] },
  description: { description: "The product's name, as the cart shows it.", examples: ["Running shoes"] },
  image: { description: "The product's picture.", examples: ["shoes.png"] },
  price: { description: "The price the item is added at.", examples: [49.9] },
  itemId: { description: "This item in the cart; minted by the client, so a retry lands once.", examples: ["0192f3a0-0000-7000-8000-000000000101"] },
  productId: { description: "The product the item is.", examples: ["0192f3a0-0000-7000-8000-000000000201"] },
})
/** The command answers only whether it landed; readers follow the views. */
export const Response = z.object({})

/** Each rejection the command declares, as the API words it. */
export const problems = problemsOf(AddItem, {
  CART_FULL: {
    title: "The cart is full",
    detail: (f) => `Cart ${f.aggregateId} already holds ${f.items} items, the most a cart can hold.`,
    happened: "The item was not added, because a cart holds at most three items.",
    causes: ["Three items are already in the cart."],
    resolution: ["Remove an item from the cart, then add this one again."],
    facts: {
      aggregateId: { description: "The cart.", examples: ["0192f3a0-0000-7000-8000-000000000001"] },
      items: { description: "How many items the cart already holds.", examples: [3] },
    },
  },
})

const addItem = oc
  .meta(
    openapi({
      method: "POST",
      path: "/understanding-eventsourcing/add-item",
      tags: ["Add Item"],
      summary: "Add an item to a cart",
      description: "Puts a product in the customer's cart. The first item creates the cart; a cart holds at most three items.",
    }),
  )
  .errors(problems.errors)
  .input(Request)
  .output(Response)

/** HTTP only, beside the route's method and path: what each rejection answers with. */
export const statuses = statusesOf(AddItem, { CART_FULL: 409 })

export const contract = { addItem }
