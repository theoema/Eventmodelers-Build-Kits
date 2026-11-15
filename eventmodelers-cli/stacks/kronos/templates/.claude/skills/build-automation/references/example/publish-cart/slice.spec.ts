import { it } from "bun:test"
import { testInfrastructure } from "#test"
import { command, commands, event, events, fixture, result } from "@kronos-ts/test"
import { CartPublished, CartSubmitted } from "../events"
import { PublishCart } from "./command"
import { publishCart } from "."
import { handle } from "./handler"
import type { CartPublisher } from "./publisher"

// The slice's scenarios on the board, one test each, named with the scenario's title, and no other tests.

// A stand-in for the outside system, run in the trace it is handed.
const stub: CartPublisher = { publish: (_cart, ctx) => ctx.trace.run("cart-publisher.publish", async () => {}) }
// The command's decisions run on its handler alone, so the automation does not act on a given CartSubmitted first.
const decisions = fixture((await testInfrastructure()).app({ commandHandlers: [handle(stub)], queryHandlers: [], eventHandlers: [] }))
const { app, eventProcessor, deadLettering } = await testInfrastructure()
const scenarios = fixture(app(publishCart(stub, eventProcessor, deadLettering)))

// Scenarios share the app, so each submits a cart of its own.
const submitted = (aggregateId: string) => ({
  aggregateId,
  orderedProducts: [{ productId: Bun.randomUUIDv7(), price: 49.9 }],
  totalPrice: 49.9,
})

it("publishes a cart", async () => {
  const aggregateId = Bun.randomUUIDv7()
  const cart = submitted(aggregateId)
  await decisions
    .when(command(PublishCart, cart))
    .then(result({ ok: true }), events(event(CartPublished, { aggregateId })))
})

it("publishes the cart when it is submitted", async () => {
  const aggregateId = Bun.randomUUIDv7()
  const cart = submitted(aggregateId)
  const arrived = event(CartSubmitted, { ...cart, submittedAt: "2026-01-15T10:30:00Z" })
  await scenarios
    .when(arrived)
    .then(commands(command(PublishCart, cart)), events(arrived, event(CartPublished, { aggregateId })))
})

