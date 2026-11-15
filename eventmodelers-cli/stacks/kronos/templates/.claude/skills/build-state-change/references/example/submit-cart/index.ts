import { handle } from "./handler"

export const submitCart = () => ({ commandHandlers: [handle], queryHandlers: [], eventHandlers: [] })
export { router } from "./controller"
export { statuses } from "./contract"
