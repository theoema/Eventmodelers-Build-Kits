import { state } from "@kronos-ts/core"
import { z } from "zod"
import { CartSubmitted } from "../events"

/** Whether the cart was submitted already: a second submit is a retry. */
export const Submission = state({
  id: { aggregateId: z.uuid() },
  tags: (id) => ({ aggregateId: id.aggregateId }),
  evolve: [
    (): { submitted: boolean } => ({ submitted: false }),
    [CartSubmitted, (): { submitted: boolean } => ({ submitted: true })],
  ],
})
