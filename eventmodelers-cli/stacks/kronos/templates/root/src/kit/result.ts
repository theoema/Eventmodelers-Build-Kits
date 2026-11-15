import { z } from "zod"

// Plain data and zod: a slice's command.ts declares its rejections with these, and its contract reads that file, so
// it reaches the browser. Keep this file free of every runtime but zod.

/**
 * A rule the domain guards: its code, and the facts of the case a caller may know. Nothing here knows a protocol or
 * a reader: how the API words a rejection (its title, its explanation, what each fact means) is the contract's, in
 * `problemsOf`.
 */
export type Rejection<Code extends string = string, Facts extends z.ZodRawShape = z.ZodRawShape> = {
  readonly code: Code
  /** What the decision saw that the caller may know: ids and values, never what the requester may not read. */
  readonly facts: Facts
}

/** `rejection("CART_FULL", { aggregateId: z.uuid(), items: z.number().int() })`; a rejection with no facts: `rejection("CODE")`. */
export const rejection = <const Code extends string, Facts extends z.ZodRawShape = {}>(
  code: Code,
  facts: Facts = {} as Facts,
): Rejection<Code, Facts> => ({ code, facts })

/** A rejection as it travels on the bus: `{ ok: false, rejection: CODE, ...facts }`. */
type Refused<R> =
  R extends Rejection<infer Code, infer Facts>
    ? z.ZodObject<{ ok: z.ZodLiteral<false>; rejection: z.ZodLiteral<Code> } & Facts>
    : never

/**
 * A command's or query's result: what success carries, and every rejection it can answer instead. A rejection is plain
 * data on the bus, so a handler returns it as a literal and a caller reads its facts typed.
 *
 *   result: result({}, rejection("CART_FULL", { aggregateId: z.uuid(), items: z.number().int() }))
 *   result: result({ items: z.array(Item) })
 *
 * `.success` is what success carries, without `ok`: the shape a contract's Response starts from
 * (`GetCartItems.result.success`), adjusted with `.omit`, `.pick` or `.extend` where the API differs.
 */
export function result<Success extends z.ZodRawShape, const R extends readonly Rejection[]>(success: Success, ...rejections: R) {
  const ok = z.object({ ok: z.literal(true), ...success })
  const schema = z.union([ok, ...rejections.map((r) => z.object({ ok: z.literal(false), rejection: z.literal(r.code), ...r.facts }))])
  // zod cannot keep which code goes with which facts through a list mapped at runtime; the type says it once, here.
  return Object.assign(schema, { rejections, success: z.object(success) }) as unknown as z.ZodType<
    z.output<typeof ok> | z.output<Refused<R[number]>>
  > & {
    readonly rejections: R
    readonly success: z.ZodObject<Success>
  }
}
