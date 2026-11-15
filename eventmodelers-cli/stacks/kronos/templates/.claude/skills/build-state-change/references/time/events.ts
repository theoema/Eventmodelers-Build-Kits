import { withNamespace } from "@kronos-ts/core"
import { z } from "zod"

/** Not a slice of the app: a worked example of time in a decision, tested with the rest. */
export const ns = withNamespace("examples")

export const ReminderSent = ns.event("ReminderSent", {
  // An instant travels as an ISO string; code turns it into a Temporal.Instant where it compares or computes.
  payload: z.object({ orderId: z.uuid(), sentAt: z.iso.datetime({ offset: true }) }),
  tags: { orderId: (p) => p.orderId },
})
