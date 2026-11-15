import { rejection, result } from "#kit/result"
import { z } from "zod"
import { ns } from "../events"

/** Put an item in a cart. The first item creates the cart. */
export const AddItem = ns.command("AddItem", {
  payload: z.object({
    aggregateId: z.uuid(),
    description: z.string().min(1),
    image: z.string().min(1),
    price: z.number(),
    itemId: z.uuid(),
    productId: z.uuid(),
  }),
  // A cart holds at most three items: the facts are the cart and how many it already holds.
  result: result({}, rejection("CART_FULL", { aggregateId: z.uuid(), items: z.number().int() })),
})
