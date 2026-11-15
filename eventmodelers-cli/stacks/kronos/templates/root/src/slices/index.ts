import { mergeStatuses } from "#kit"
import type { EventProcessor, Sequence } from "@kronos-ts/core"

/**
 * The app's handlers: the sum of every context's three lists. A new context adds a line here, to `router` and to
 * `statuses`; `main.ts` never names one.
 */
export const app = (
  eventProcessor: (name: string) => EventProcessor,
  deadLettering: (processor: EventProcessor, sequence: Sequence) => EventProcessor,
) => {
  return {
    commandHandlers: [],
    queryHandlers: [],
    eventHandlers: [],
  }
}

/**
 * Every context's procedures, one router per context, under the context's name (so it is in every operation id: two
 * contexts may name a procedure alike). `serve` hands them to oRPC's REST handler; an oRPC plugin (MCP, pub/sub)
 * would serve the same router and contract next to it.
 */
export const router = {
}

/** Every context's HTTP statuses in one map, as oRPC keys them: by code alone, so a code is one status everywhere. */
export const statuses = mergeStatuses(
)
