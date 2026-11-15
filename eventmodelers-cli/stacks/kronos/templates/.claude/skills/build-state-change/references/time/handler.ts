import type { CommandContext } from "#kit"
import { commandHandler } from "@kronos-ts/core"
import { SendReminder } from "./command"
import { ReminderSent } from "./events"
import { Reminders } from "./state"

const BETWEEN_REMINDERS = Temporal.Duration.from({ hours: 24 })

/** The current instant is the unit of work's, never the wall clock: a test moves it, and a retry sees the same one. */
export const handle = commandHandler(SendReminder, async ({ payload: p }, ctx: CommandContext) => {
  const now = Temporal.Instant.fromEpochMilliseconds(ctx.unitOfWork.now())
  const reminders = await ctx.load(Reminders, { orderId: p.orderId })
  if (reminders.reminded) {
    const nextAt = Temporal.Instant.from(reminders.lastSentAt).add(BETWEEN_REMINDERS)
    if (Temporal.Instant.compare(now, nextAt) < 0)
      return { ok: false, rejection: "REMINDED_RECENTLY", orderId: p.orderId, nextAt: nextAt.toString() }
  }
  ctx.append(ReminderSent, { orderId: p.orderId, sentAt: now.toString() })
  return { ok: true }
})
