import { result } from "#kit/result"
import { z } from "zod"
import { ns } from "../events"

/** Take a product's items out of a cart, kept for the record. Sent only by the automation. */
export const ArchiveItem = ns.command("ArchiveItem", {
  payload: z.object({ aggregateId: z.uuid(), productId: z.uuid() }),
  result: result({}),
})
