import { handle } from "./handler"

export const sendReminder = () => ({ commandHandlers: [handle], queryHandlers: [], eventHandlers: [] })
