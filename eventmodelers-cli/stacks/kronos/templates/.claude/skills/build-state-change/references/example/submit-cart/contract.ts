import { documented } from "#kit/documented"
import { problemsOf, statusesOf } from "#kit/problems"
import { oc } from "@orpc/contract"
import { openapi } from "@orpc/openapi"
import { z } from "zod"
import { SubmitCart } from "./command"

/**
 * What the caller sends: the command's payload, in the API's words, without `submittedAt`. It is generated: the
 * controller stamps it with the time the command is created, so a client cannot leave it out or backdate it.
 */
export const Request = documented(SubmitCart.payload.omit({ submittedAt: true }), {
  aggregateId: { description: "The cart being submitted.", examples: ["0192f3a0-0000-7000-8000-000000000001"] },
  orderedProducts: {
    description: "The products ordered, as the customer confirmed them, each at its price.",
    fields: {
      productId: { description: "The product.", examples: ["0192f3a0-0000-7000-8000-000000000201"] },
      price: { description: "The price it is ordered at.", examples: [49.9] },
    },
  },
})
/** The command answers only whether it landed; readers follow the views. */
export const Response = z.object({})

/** Each rejection the command declares, as the API words it. */
export const problems = problemsOf(SubmitCart, {
  CART_EMPTY: {
    title: "The cart is empty",
    detail: (f) => `Cart ${f.aggregateId} has no products to submit.`,
    happened: "The cart was not submitted, because a cart is submitted with at least one product.",
    causes: ["No products were ordered."],
    resolution: ["Add an item to the cart, then submit it."],
    facts: { aggregateId: { description: "The cart.", examples: ["0192f3a0-0000-7000-8000-000000000001"] } },
  },
})

const submitCart = oc
  .meta(
    openapi({
      method: "POST",
      path: "/understanding-eventsourcing/submit-cart",
      tags: ["Submit Cart"],
      summary: "Submit a cart",
      description: "Places the order for the cart's products. A submitted cart is published to the shop's systems.",
    }),
  )
  .errors(problems.errors)
  .input(Request)
  .output(Response)

/** HTTP only, beside the route's method and path: what each rejection answers with. */
export const statuses = statusesOf(SubmitCart, { CART_EMPTY: 409 })

export const contract = { submitCart }
