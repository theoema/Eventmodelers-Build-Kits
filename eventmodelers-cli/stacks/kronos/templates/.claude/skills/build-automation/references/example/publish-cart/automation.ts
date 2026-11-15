import type { EventContext, PartialProcessor } from "#kit"
import { batched, concurrent, deadLettering, eventHandler, eventProcessor, type Sequence } from "@kronos-ts/core"
import { CartSubmitted } from "../events"
import { PublishCart } from "./command"
import { Publication } from "./state"

/** One lane per cart: events about the same cart are handled in order, one after another. */
const perCart: Sequence = (e) => e.tags.find((t) => t.key === "aggregateId")?.value ?? e.identifier

/**
 * A submitted cart is published. The board's todo list ("Submitted Cart Data") is this slice's state: folded per cart
 * in state.ts, so no read model is built for it. Carts run side by side, and a persistently failing event is parked
 * and blocks only its own cart; `concurrent` and `deadLettering` are given the same sequence, as core requires.
 */
const processor: PartialProcessor = (eventStore, tokenStore, unitOfWork, deadLetterQueue) =>
  deadLettering(
    concurrent(batched(eventProcessor("publish-cart", eventStore, tokenStore, unitOfWork), 100), perCart),
    deadLetterQueue,
    perCart,
  )

/**
 * One handler per event the automation reacts to, all on its processor. The cart is the event's payload; the state
 * says only whether it is published yet. An open item is sent as the command; the command's handler does the work.
 */
export const automation = [
  eventHandler(CartSubmitted, async ({ payload: cart }, ctx: EventContext) => {
    if ((await ctx.load(Publication, { aggregateId: cart.aggregateId })).published) return
    await ctx.send(PublishCart, cart)
  }),
].map((h) => ({ ...h, processor }))
