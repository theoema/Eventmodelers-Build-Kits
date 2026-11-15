import { handle } from "./handler"

export const addItem = () => ({ commandHandlers: [handle], queryHandlers: [], eventHandlers: [] })
export { router } from "./controller"
export { statuses } from "./contract"
