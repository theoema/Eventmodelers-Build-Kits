import { mergeStatuses } from "#kit"
import type { EventProcessor, Sequence } from "@kronos-ts/core"
import { SpanKind } from "@kronos-ts/otlp"
import { addItem, router as addItemRouter, statuses as addItemStatuses } from "./add-item"
import { archiveItem } from "./archive-item"
import { cartItems, router as cartItemsRouter } from "./cart-items"
import { publishCart } from "./publish-cart"
import type { CartPublisher } from "./publish-cart/publisher"
import { submitCart, router as submitCartRouter, statuses as submitCartStatuses } from "./submit-cart"

/**
 * A stand-in for the system carts are published to, which the board leaves open: replace it here. A real client sends
 * `span.traceparent` with its request, so the trace continues in the other system.
 */
const publisher: CartPublisher = {
  publish: (cart, ctx) =>
    ctx.trace.run(
      "cart-publisher.publish",
      async (span) => {
        ctx.log.info("cart publishing is a stand-in: nothing was sent", { aggregateId: cart.aggregateId, traced: span.traceparent !== undefined })
      },
      { kind: SpanKind.CLIENT },
    ),
}

/**
 * The context's handlers: the sum of its slices' three lists, each slice spread into every list it has. A slice that
 * builds a processor is called once, into a const, so its lists share that processor.
 */
export const understandingEventsourcing = (
  eventProcessor: (name: string) => EventProcessor,
  deadLettering: (processor: EventProcessor, sequence: Sequence) => EventProcessor,
) => {
  const cart = cartItems(eventProcessor)
  const archive = archiveItem(eventProcessor)
  const publish = publishCart(publisher, eventProcessor, deadLettering)
  return {
    commandHandlers: [
      ...addItem().commandHandlers,
      ...archive.commandHandlers,
      ...submitCart().commandHandlers,
      ...publish.commandHandlers,
    ],
    queryHandlers: [...cart.queryHandlers],
    eventHandlers: [...cart.eventHandlers, ...archive.eventHandlers, ...publish.eventHandlers],
  }
}

/** Every slice's procedures, merged: the context's router. */
export const router = { ...addItemRouter, ...cartItemsRouter, ...submitCartRouter }

/** Every slice's HTTP statuses, merged; a code two slices answer differently stops the boot. */
export const statuses = mergeStatuses(addItemStatuses, submitCartStatuses)
