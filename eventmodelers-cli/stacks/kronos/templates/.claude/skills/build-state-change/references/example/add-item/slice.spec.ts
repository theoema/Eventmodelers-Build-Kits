import { it } from "bun:test"
import { rejected } from "#kit/testing"
import { testApp } from "#test"
import { command, event, events, fixture, noEvents, result } from "@kronos-ts/test"
import { CartCreated, ItemAdded } from "../events"
import { AddItem } from "./command"
import { addItem } from "."

// The slice's scenarios on the board, one test each, named with the scenario's title, and no other tests.

const scenarios = fixture(testApp([addItem]))

// Every scenario shares the app, so each one uses ids of its own.
const item = (aggregateId: string) => ({
  aggregateId,
  itemId: Bun.randomUUIDv7(),
  productId: Bun.randomUUIDv7(),
  description: "Shoes",
  image: "shoes.png",
  price: 49.9,
})

it("creates the cart with its first item", async () => {
  const aggregateId = Bun.randomUUIDv7()
  const shoes = item(aggregateId)
  await scenarios
    .when(command(AddItem, shoes))
    .then(result({ ok: true }), events(event(CartCreated, { aggregateId }), event(ItemAdded, shoes)))
})

it("adds an item to a cart that exists", async () => {
  const aggregateId = Bun.randomUUIDv7()
  const [shoes, socks] = [item(aggregateId), item(aggregateId)]
  await scenarios
    .given(event(CartCreated, { aggregateId }), event(ItemAdded, shoes))
    .when(command(AddItem, socks))
    .then(result({ ok: true }), events(event(ItemAdded, socks)))
})

it("refuses a fourth item", async () => {
  const aggregateId = Bun.randomUUIDv7()
  const [a, b, c, d] = [item(aggregateId), item(aggregateId), item(aggregateId), item(aggregateId)]
  await scenarios
    .given(event(CartCreated, { aggregateId }), event(ItemAdded, a), event(ItemAdded, b), event(ItemAdded, c))
    .when(command(AddItem, d))
    .then(rejected("CART_FULL", { aggregateId, items: 3 }), noEvents())
})
