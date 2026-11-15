import { it } from "bun:test"
import { testApp } from "#test"
import { event, events, fixture, noEvents, query, result } from "@kronos-ts/test"
import { CartCleared, CartCreated, ItemAdded, ItemArchived, ItemRemoved } from "../events"
import { GetCartItems } from "./query"
import { cartItems } from "."

// The slice's scenarios on the board, one test each, named with the scenario's title, and no other tests.

const app = testApp([cartItems], { db: true })
const scenarios = fixture(app)

// Every scenario shares the app, so each one uses a cart of its own.
const item = (aggregateId: string, n: number, price: number) => ({
  aggregateId,
  itemId: Bun.randomUUIDv7(),
  productId: Bun.randomUUIDv7(),
  description: `Item ${n}`,
  image: `item-${n}.png`,
  price,
})
const row = ({ aggregateId: _, ...i }: { aggregateId: string; itemId: string; productId: string; description: string; image: string; price: number }) => i

it("is empty for a cart with no items", async () => {
  const aggregateId = Bun.randomUUIDv7()
  const items = query(GetCartItems, { aggregateId })
  await scenarios
    .given(event(CartCreated, { aggregateId }))
    .when(items)
    .then(result({ ok: true, aggregateId, items: [], totalPrice: 0 }), noEvents())
})

it("lists the items added and their total", async () => {
  const aggregateId = Bun.randomUUIDv7()
  const items = query(GetCartItems, { aggregateId })
  const [a, b] = [item(aggregateId, 1, 10), item(aggregateId, 2, 5.5)]
  await scenarios
    .given(event(CartCreated, { aggregateId }), event(ItemAdded, a), event(ItemAdded, b))
    .when(items)
    .then(result({ ok: true, aggregateId, items: [row(a), row(b)], totalPrice: 15.5 }))
})

it("drops removed and archived items", async () => {
  const aggregateId = Bun.randomUUIDv7()
  const items = query(GetCartItems, { aggregateId })
  const [a, b, c] = [item(aggregateId, 3, 10), item(aggregateId, 4, 20), item(aggregateId, 5, 30)]
  await scenarios
    .given(
      event(ItemAdded, a),
      event(ItemAdded, b),
      event(ItemAdded, c),
      event(ItemRemoved, { aggregateId, itemId: a.itemId }),
      event(ItemArchived, { aggregateId, itemId: b.itemId }),
    )
    .when(items)
    .then(result({ ok: true, aggregateId, items: [row(c)], totalPrice: 30 }))
})

it("walks a cart from empty to full and back", async () => {
  const aggregateId = Bun.randomUUIDv7()
  const items = query(GetCartItems, { aggregateId })
  const [a, b] = [item(aggregateId, 6, 10), item(aggregateId, 7, 20)]
  await scenarios
    .storyline(items)
    .shows({ ok: true, aggregateId, items: [], totalPrice: 0 })
    .after(event(ItemAdded, a), event(ItemAdded, b))
    .shows({ ok: true, aggregateId, items: [row(a), row(b)], totalPrice: 30 })
    .after(event(ItemRemoved, { aggregateId, itemId: a.itemId }))
    .shows({ ok: true, aggregateId, items: [row(b)], totalPrice: 20 })
    .after(event(CartCleared, { aggregateId }))
    .shows({ ok: true, aggregateId, items: [], totalPrice: 0 })
})

