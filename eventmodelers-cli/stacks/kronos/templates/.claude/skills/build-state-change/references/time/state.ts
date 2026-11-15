import { state } from "@kronos-ts/core"
import { z } from "zod"
import { ReminderSent } from "./events"

/** Whether the order was reminded yet and, once it was, when last: an ISO instant, as the event says it. */
export const Reminders = state({
  id: { orderId: z.uuid() },
  tags: (id) => ({ orderId: id.orderId }),
  evolve: [
    (): { reminded: false } | { reminded: true; lastSentAt: string } => ({ reminded: false }),
    [ReminderSent, (_, { payload }) => ({ reminded: true, lastSentAt: payload.sentAt })],
  ],
})
