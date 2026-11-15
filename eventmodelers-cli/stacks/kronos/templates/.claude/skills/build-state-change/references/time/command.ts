import { rejection, result } from "#kit/result"
import { z } from "zod"
import { ns } from "./events"

/** Remind the customer of an order, at most once in 24 hours. */
export const SendReminder = ns.command("SendReminder", {
  payload: z.object({ orderId: z.uuid() }),
  // The facts say when the next reminder can go. A contract, if the command gets one, words it (`problemsOf`).
  result: result({}, rejection("REMINDED_RECENTLY", { orderId: z.uuid(), nextAt: z.iso.datetime({ offset: true }) })),
})
