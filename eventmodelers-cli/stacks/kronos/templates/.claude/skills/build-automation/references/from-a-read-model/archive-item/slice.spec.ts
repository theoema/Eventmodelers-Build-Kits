import { it } from "bun:test"
import { testApp } from "#test"
import { command, commands, event, events, fixture, noEvents, result } from "@kronos-ts/test"
import { ItemAdded, ItemArchived, ItemRemoved, PriceChanged } from "../events"
import { ArchiveItem } from "./command"
import { archiveItem } from "."

// The slice's scenarios on the board, one test each, named with the scenario's title, and no other tests.

// Every scenario shares the app, so each one uses carts, items and products of its own. A price change reaches
// every cart holding the product, so the product is the scenario's own too.
const added = (aggregateId: string, itemId: string, productId: string) =>
  event(ItemAdded, { aggregateId, itemId, productId, description: "", image: "", price: 1 })

const scenarios = fixture(testApp([archiveItem], { db: true }))

it("archives every item of the product in the cart, and nothing else", async () => {
  const [cart, shoes, socks] = [Bun.randomUUIDv7(), Bun.randomUUIDv7(), Bun.randomUUIDv7()]
  const [first, second, third] = [Bun.randomUUIDv7(), Bun.randomUUIDv7(), Bun.randomUUIDv7()]
  await scenarios
    .given(added(cart, first, shoes), added(cart, second, socks), added(cart, third, shoes))
    .when(command(ArchiveItem, { aggregateId: cart, productId: shoes }))
    .then(
      result({ ok: true }),
      events(event(ItemArchived, { aggregateId: cart, itemId: first }), event(ItemArchived, { aggregateId: cart, itemId: third })),
    )
})

it("lands nothing when the product has already left the cart", async () => {
  const [cart, shoes, item] = [Bun.randomUUIDv7(), Bun.randomUUIDv7(), Bun.randomUUIDv7()]
  await scenarios
    .given(added(cart, item, shoes), event(ItemRemoved, { aggregateId: cart, itemId: item }))
    .when(command(ArchiveItem, { aggregateId: cart, productId: shoes }))
    .then(result({ ok: true }), noEvents())
})

it("archives the product in each cart holding it when its price changes", async () => {
  const [shoes, socks] = [Bun.randomUUIDv7(), Bun.randomUUIDv7()]
  const [cart1, cart2, cart3] = [Bun.randomUUIDv7(), Bun.randomUUIDv7(), Bun.randomUUIDv7()]
  const [item1, item2, item3] = [Bun.randomUUIDv7(), Bun.randomUUIDv7(), Bun.randomUUIDv7()]
  const changed = event(PriceChanged, { productId: shoes, oldPrice: 1, newPrice: 2 })
  await scenarios
    .given(added(cart1, item1, shoes), added(cart2, item2, shoes), added(cart3, item3, socks))
    .when(changed)
    .then(
      commands(
        command(ArchiveItem, { aggregateId: cart1, productId: shoes }),
        command(ArchiveItem, { aggregateId: cart2, productId: shoes }),
      ),
      events(
        changed,
        event(ItemArchived, { aggregateId: cart1, itemId: item1 }),
        event(ItemArchived, { aggregateId: cart2, itemId: item2 }),
      ),
    )
})

it("acts once on a cart holding the product twice, and not on a cart that let it go", async () => {
  const [shoes, cart1, cart2] = [Bun.randomUUIDv7(), Bun.randomUUIDv7(), Bun.randomUUIDv7()]
  const [item1, item2, item3] = [Bun.randomUUIDv7(), Bun.randomUUIDv7(), Bun.randomUUIDv7()]
  const changed = event(PriceChanged, { productId: shoes, oldPrice: 1, newPrice: 2 })
  await scenarios
    .given(added(cart1, item1, shoes), added(cart1, item2, shoes), added(cart2, item3, shoes), event(ItemRemoved, { aggregateId: cart2, itemId: item3 }))
    .when(changed)
    .then(commands(command(ArchiveItem, { aggregateId: cart1, productId: shoes })))
})
