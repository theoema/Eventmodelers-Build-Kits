import { batched, type EventProcessor } from "@kronos-ts/core"
import { automation } from "./automation"
import { handle } from "./handler"

/**
 * An automation with its own read model, and the command only it sends: no contract. Its event handlers write and
 * read the table as `ctx.db`, in the batch's transaction.
 *
 * The slice's one processor: its read model's handlers first, then the automation, for every event in log order. The
 * automation reads the table through the batch's own transaction, so the rows are current up to the very PriceChanged
 * it handles. The cost: global order, no lanes and no dead-lettering, so a failing archive holds the slice. Named for
 * the slice: a new name replays the log from the start.
 */
export const archiveItem = (eventProcessor: (name: string) => EventProcessor) => {
  const processor = batched(eventProcessor("archive-item"), 100)
  return {
    commandHandlers: [handle],
    queryHandlers: [],
    eventHandlers: automation.map((handler) => ({ ...handler, processor })),
  }
}
