import { batched, concurrent, type EventProcessor, is, type Sequence } from "@kronos-ts/core"
import { CartSubmitted } from "../events"
import { automation } from "./automation"
import { handle } from "./handler"
import type { CartPublisher } from "./publisher"

/** One lane per cart: events about the same cart are handled in order, one after another. */
const perCart: Sequence = (e) => (is(e, CartSubmitted) ? e.payload.aggregateId : e.identifier)

/**
 * An automation and the command only it sends: no contract. The command's handler calls the external system; the
 * client comes in as a parameter, from the context's index.ts (the real one) or a spec (a stand-in).
 *
 * The processor: carts run side by side, and a persistently failing event is parked and blocks only its own cart;
 * `concurrent` and `deadLettering` are given the same sequence, as core requires. `deadLettering` is core's with the
 * app's dead-letter queue applied: the slice gives it only its processor and its lanes.
 */
export const publishCart = (
  publisher: CartPublisher,
  eventProcessor: (name: string) => EventProcessor,
  deadLettering: (processor: EventProcessor, sequence: Sequence) => EventProcessor,
) => {
  const processor = deadLettering(concurrent(batched(eventProcessor("publish-cart"), 100), perCart), perCart)
  return {
    commandHandlers: [handle(publisher)],
    queryHandlers: [],
    eventHandlers: automation.map((handler) => ({ ...handler, processor })),
  }
}
