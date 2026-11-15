import type { Slice } from "#kit"
import { SpanKind } from "@kronos-ts/otlp"
import { addItem } from "./add-item"
import { archiveItem } from "./archive-item"
import { cartItems } from "./cart-items"
import { publishCart } from "./publish-cart"
import type { CartPublisher } from "./publish-cart/publisher"
import { submitCart } from "./submit-cart"

// What only this context's slices use is built here, once, and handed to the slices that need it: an external
// client, a function, a setting. The board leaves the system carts are published to open, so this stands in for it
// until one is chosen; replace it here and every slice that publishes uses the real one. It already has a real
// client's shape: the call runs in a child span of the handling, and the request would carry that span's traceparent.
const publisher: CartPublisher = {
  publish: (cart, ctx) =>
    ctx.trace.run(
      "cart-publisher.publish",
      async (span) => {
        // await fetch(`${env.CART_PUBLISHER_URL}/carts`, {
        //   method: "POST",
        //   headers: { "content-type": "application/json", "idempotency-key": cart.aggregateId, ...(span.traceparent ? { traceparent: span.traceparent } : {}) },
        //   body: JSON.stringify(cart),
        // })
        ctx.log.info("cart publishing is a stand-in: nothing was sent", { aggregateId: cart.aggregateId, traced: span.traceparent !== undefined })
      },
      { kind: SpanKind.CLIENT },
    ),
}

/** The context's slices, listed explicitly: a slice that is not here does not run. */
export const understandingEventsourcing: ReadonlyArray<Slice> = [
  addItem,
  cartItems,
  archiveItem,
  submitCart,
  publishCart(publisher),
]
