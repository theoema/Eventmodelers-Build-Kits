import { it } from "bun:test"
import { rejected } from "#kit/testing"
import { testApp } from "#test"
import { advanceableClock, command, event, events, fixture, noEvents, result } from "@kronos-ts/test"
import { SendReminder } from "./command"
import { ReminderSent } from "./events"
import { sendReminder } from "."

// The slice's scenarios on the board, one test each, named with the scenario's title, and no other tests.

// The app's clock, shared by every scenario here and moving only by `advance`: a scenario reads the instant it starts
// at. It moves by milliseconds: convert at that boundary, nowhere else.
const clock = advanceableClock()
const scenarios = fixture(testApp([sendReminder], { clock }))
const now = () => Temporal.Instant.fromEpochMilliseconds(clock())
const after = (duration: Temporal.DurationLike) => Temporal.Duration.from(duration).total("milliseconds")

it("reminds an order never reminded, stamped with the unit of work's instant", async () => {
  const orderId = Bun.randomUUIDv7()
  const start = now()
  await scenarios
    .when(command(SendReminder, { orderId }))
    .then(result({ ok: true }), events(event(ReminderSent, { orderId, sentAt: start.toString() })))
})

it("refuses a second reminder within 24 hours, saying when the next can go", async () => {
  const orderId = Bun.randomUUIDv7()
  const start = now()
  await scenarios
    .given(event(ReminderSent, { orderId, sentAt: start.toString() }))
    .advance(after({ hours: 23, minutes: 59 }))
    .when(command(SendReminder, { orderId }))
    .then(rejected("REMINDED_RECENTLY", { orderId, nextAt: start.add({ hours: 24 }).toString() }), noEvents())
})

it("reminds again once 24 hours have passed", async () => {
  const orderId = Bun.randomUUIDv7()
  const start = now()
  await scenarios
    .given(event(ReminderSent, { orderId, sentAt: start.toString() }))
    .advance(after({ hours: 24 }))
    .when(command(SendReminder, { orderId }))
    .then(events(event(ReminderSent, { orderId, sentAt: start.add({ hours: 24 }).toString() })))
})
