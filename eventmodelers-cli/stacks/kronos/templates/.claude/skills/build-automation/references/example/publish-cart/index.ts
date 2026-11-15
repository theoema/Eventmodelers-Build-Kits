import type { Slice } from "#kit"
import { automation } from "./automation"
import { handle } from "./handler"
import type { CartPublisher } from "./publisher"

/**
 * An automation and the command only it sends: no contract. The command's handler calls the external system; the
 * client comes in as a parameter, from the context's index.ts (the real one) or a spec (a recording one).
 */
export const publishCart = (publisher: CartPublisher) =>
  ({ commandHandlers: [handle(publisher)], eventHandlers: automation }) satisfies Slice
