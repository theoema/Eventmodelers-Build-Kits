import type { Slice } from "#kit"
import { automation } from "./automation"
import { handle } from "./handler"

/** An automation with its own read model, and the command only it sends: no contract. */
export const archiveItem = { commandHandlers: [handle], eventHandlers: automation } satisfies Slice
