import { type Edge, refuse } from "#kit"
import { implement } from "@orpc/server"
import { SubmitCart } from "./command"
import { contract, problems } from "./contract"

export const router = {
  submitCart: implement(contract).$context<Edge>().submitCart.handler(async (call) => {
    // The generated timestamp: the current time as of creating the command.
    const result = await call.context.send(SubmitCart, { ...call.input, submittedAt: Temporal.Now.instant().toString() })
    if (!result.ok) throw refuse(call, problems, result)
    return {}
  }),
}
