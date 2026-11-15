import type { CommandContext } from "#kit"
import { commandHandler } from "@kronos-ts/core"
import { CartPublished } from "../events"
import { PublishCart } from "./command"
import type { CartPublisher } from "./publisher"
import { Publication } from "./state"

/**
 * Publish the cart to the external system, then record that it was: a cart is never recorded published before the
 * system has it. A cart published already is not handed over again. The call takes the handling's `ctx`, so it is
 * traced and logged with it; it can repeat (a crash before the append, an append that lost a race), so the publisher
 * makes a second call for the same cart harmless.
 */
export const handle = (publisher: CartPublisher) =>
  commandHandler(PublishCart, async ({ payload: cart }, ctx: CommandContext) => {
    if ((await ctx.load(Publication, { aggregateId: cart.aggregateId })).published) return { ok: true }
    await publisher.publish(cart, ctx)
    ctx.append(CartPublished, { aggregateId: cart.aggregateId })
    return { ok: true }
  })
