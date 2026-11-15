import { it } from "bun:test"
import { rejected } from "#kit/testing"
import { testInfrastructure } from "#test"
import { command, event, events, fixture, noEvents, result } from "@kronos-ts/test"
import { CartSubmitted } from "../events"
import { SubmitCart } from "./command"
import { submitCart } from "."

// The slice's scenarios on the board, one test each, named with the scenario's title, and no other tests.

const { app } = await testInfrastructure()
const scenarios = fixture(app(submitCart()))

// Every scenario shares the app, so each one uses ids of its own.
const shoes = () => ({ productId: Bun.randomUUIDv7(), price: 49.9 })
const socks = () => ({ productId: Bun.randomUUIDv7(), price: 5.1 })

it("submits the cart with its total", async () => {
  const aggregateId = Bun.randomUUIDv7()
  const orderedProducts = [shoes(), socks()]
  const submittedAt = "2026-01-15T10:30:00Z"
  await scenarios
    .when(command(SubmitCart, { aggregateId, orderedProducts, submittedAt }))
    .then(result({ ok: true }), events(event(CartSubmitted, { aggregateId, orderedProducts, totalPrice: 55, submittedAt })))
})

it("refuses an empty cart", async () => {
  const aggregateId = Bun.randomUUIDv7()
  await scenarios
    .when(command(SubmitCart, { aggregateId, orderedProducts: [], submittedAt: "2026-01-15T10:30:00Z" }))
    .then(rejected("CART_EMPTY", { aggregateId }), noEvents())
})
