import type { Slice } from "#kit"
import { handle } from "./handler"

export const sendReminder = { commandHandlers: [handle] } satisfies Slice
