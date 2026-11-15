import type { Slice } from "#kit"
import { statuses } from "./contract"
import { router } from "./controller"
import { handle } from "./handler"

export const addItem = { router, statuses, commandHandlers: [handle] } satisfies Slice
