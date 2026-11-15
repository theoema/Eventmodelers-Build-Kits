import { rejection, result } from "#kit/result"
import { z } from "zod"
import { OrderedProduct, ns } from "../events"

/**
 * Submit a cart: the products ordered, as the customer confirmed them. `submittedAt` is generated on the board: the
 * time the command is created, which the controller stamps (the client never sends it).
 */
export const SubmitCart = ns.command("SubmitCart", {
  payload: z.object({
    aggregateId: z.uuid(),
    orderedProducts: z.array(OrderedProduct),
    submittedAt: z.iso.datetime({ offset: true }),
  }),
  // A cart is submitted with at least one product.
  result: result({}, rejection("CART_EMPTY", { aggregateId: z.uuid() })),
})
