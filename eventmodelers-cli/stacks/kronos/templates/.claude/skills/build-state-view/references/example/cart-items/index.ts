import { batched, type EventProcessor } from "@kronos-ts/core"
import { handle } from "./handler"
import { projection } from "./projection"

/**
 * The view: its read and its projection. Both reach the read-model database as `ctx.db`, in the handling's
 * transaction, from the wrappers `main.ts` puts on every query and event handler.
 *
 * The processor: global order, a batch of events per transaction, no dead-letter queue: a failing handler holds the
 * token and retries. Named for what it writes: a new table means a new name, so it replays from the start.
 */
export const cartItems = (eventProcessor: (name: string) => EventProcessor) => {
  const processor = batched(eventProcessor("cart-items"), 100)
  return {
    commandHandlers: [],
    queryHandlers: [handle],
    eventHandlers: projection.map((handler) => ({ ...handler, processor })),
  }
}
export { router } from "./controller"
