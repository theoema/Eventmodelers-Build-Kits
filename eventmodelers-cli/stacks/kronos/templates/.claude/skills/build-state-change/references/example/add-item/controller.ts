import { type Edge, refuse } from "#kit"
import { implement } from "@orpc/server"
import { AddItem } from "./command"
import { contract, problems } from "./contract"

export const router = {
  addItem: implement(contract).$context<Edge>().addItem.handler(async (call) => {
    const result = await call.context.send(AddItem, call.input)
    if (!result.ok) throw refuse(call, problems, result)
    return {}
  }),
}
