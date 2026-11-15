import type { EventContext } from "#kit"
import { eventHandler } from "@kronos-ts/core"
import { CartSubmitted } from "../events"
import { PublishCart } from "./command"
import { Publication } from "./state"

/**
 * A submitted cart is published. The board's todo list ("Submitted Cart Data") is this slice's state: folded per cart
 * in state.ts, so no read model is built for it.
 *
 * One handler per event the automation reacts to, all on the processor the slice's index.ts gives them. The cart is
 * the event's payload; the state says only whether it is published yet. An open item is sent as the command; the
 * command's handler does the work.
 */
export const automation = [
  eventHandler(CartSubmitted, async ({ payload: cart }, ctx: EventContext) => {
    if ((await ctx.load(Publication, { aggregateId: cart.aggregateId })).published) return
    await ctx.send(PublishCart, cart)
  }),
]
