import { it } from "bun:test"
import { testApp } from "#test"
import { command, commands, event, events, fixture, result } from "@kronos-ts/test"
import { CartPublished, CartSubmitted } from "../events"
import { PublishCart } from "./command"
import { publishCart } from "."
import { handle } from "./handler"
import type { CartPublisher } from "./publisher"

// The slice's scenarios on the board, one test each, named with the scenario's title, and no other tests.

// Two fixtures. The command's decisions run on the command handler alone: in the whole slice the automation would act
// on a `given` CartSubmitted, as it does in production, and the command would find the cart published already. The
// automation runs on the whole slice.
// The external system, stood in for so the scenarios run: it runs in the trace it is handed, as a real client does,
// and no scenario asserts on it.
const stub: CartPublisher = { publish: (_cart, ctx) => ctx.trace.run("cart-publisher.publish", async () => {}) }
const decisions = fixture(testApp([{ commandHandlers: [handle(stub)] }]))
const scenarios = fixture(testApp([publishCart(stub)], { db: true }))

// Every scenario shares the app, so each one submits a cart of its own.
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
  const arrived = event(CartSubmitted, cart)
  await scenarios
    .when(arrived)
    .then(commands(command(PublishCart, cart)), events(arrived, event(CartPublished, { aggregateId })))
})

