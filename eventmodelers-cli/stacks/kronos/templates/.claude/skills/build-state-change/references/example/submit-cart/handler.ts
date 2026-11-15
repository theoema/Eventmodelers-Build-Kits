import type { CommandContext } from "#kit"
import { commandHandler } from "@kronos-ts/core"
import { CartSubmitted } from "../events"
import { SubmitCart } from "./command"
import { Submission } from "./state"

/** Submit once; the total is the products' prices summed (the model maps totalPrice from orderedProducts). */
export const handle = commandHandler(SubmitCart, async ({ payload: p }, ctx: CommandContext) => {
  const submission = await ctx.load(Submission, { aggregateId: p.aggregateId })
  if (submission.submitted) return { ok: true }
  if (p.orderedProducts.length === 0) return { ok: false, rejection: "CART_EMPTY", aggregateId: p.aggregateId }
  const totalPrice = p.orderedProducts.reduce((sum, product) => sum + product.price, 0)
  ctx.append(CartSubmitted, { ...p, totalPrice })
  return { ok: true }
})
