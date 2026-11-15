import { result } from "#kit/result"
import { z } from "zod"
import { OrderedProduct, ns } from "../events"

/** Publish a submitted cart. Sent only by the automation. */
export const PublishCart = ns.command("PublishCart", {
  payload: z.object({ aggregateId: z.uuid(), orderedProducts: z.array(OrderedProduct), totalPrice: z.number() }),
  result: result({}),
})
