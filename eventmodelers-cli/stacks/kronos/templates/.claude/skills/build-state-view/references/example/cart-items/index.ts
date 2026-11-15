import type { Slice } from "#kit"
import { router } from "./controller"
import { handle } from "./handler"
import { projection } from "./projection"

export const cartItems = { router, queryHandlers: [handle], eventHandlers: projection } satisfies Slice
