import { z } from "zod"
import { type DocsOf, documentedShape } from "./documented"
import type { Rejection } from "./result"

// Plain data and zod: a slice's contract.ts words its rejections with these, so it reaches the browser.

/** A command or query descriptor whose result declares its rejections (`result(success, ...rejections)`). */
type Refusing = { readonly name: { readonly name: string }; readonly result?: { readonly rejections: readonly Rejection[] } }
type RejectionOf<D extends Refusing> = NonNullable<D["result"]>["rejections"][number]
type CodeOf<D extends Refusing> = RejectionOf<D>["code"]

/** How the API words one rejection: what it is called, this case from its facts, and what each fact means. */
export type Wording<R extends Rejection = Rejection> = Words<R> &
  // A rejection with no facts needs no `facts`.
  ([keyof R["facts"]] extends [never] ? { readonly facts?: Record<string, never> } : { readonly facts: DocsOf<R["facts"]> })

type Words<R extends Rejection> = {
  /** Short and constant: what the rejection is called. */
  readonly title: string
  /** This case, in a sentence, from its facts. (A method, so any wording fits `Wording`.) */
  detail(facts: z.infer<z.ZodObject<R["facts"]>>): string
  /** What happened: the rule that was not met. */
  readonly happened: string
  /** The situations that lead here. */
  readonly causes: readonly string[]
  /** How to resolve it, or avoid it next time. */
  readonly resolution: readonly string[]
}

/** A wording for every rejection a descriptor declares, keyed by code: no more, no fewer. */
export type WordingOf<D extends Refusing> = { readonly [C in CodeOf<D>]: Wording<Extract<RejectionOf<D>, { code: C }>> }

/** A descriptor's rejections as the API presents them: what `.errors(…)` declares and what `refuse` throws. */
export type Problems<D extends Refusing = Refusing> = {
  readonly descriptor: D
  readonly wording: Readonly<Record<string, Wording>>
  /** The contract's `.errors(…)`. */
  readonly errors: { [K in CodeOf<D>]: { message: string; data: z.ZodObject } }
}

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replaceAll("_", "-").toLowerCase()

/**
 * A rejection's problem type: it belongs to the message that declares it, so two slices refusing with the same code
 * are two problems, each with its own words. `ChangePassword`'s `PASSWORD_TOO_SHORT` is
 * `/problems/change-password/password-too-short`; it names the problem and is where it is documented.
 */
export const problemTypeOf = (descriptor: Refusing, code: string) => `/problems/${kebab(descriptor.name.name)}/${kebab(code)}`

/** An example value for a JSON Schema: its own example, or one by its type and format. */
function exampleOf(schema: Record<string, unknown>): unknown {
  const examples = schema.examples as unknown[] | undefined
  if (examples?.length) return examples[0]
  if ("const" in schema) return schema.const
  switch (schema.type) {
    case "string":
      switch (schema.format) {
        case "uuid":
          return "0192f3a0-0000-7000-8000-000000000001"
        case "date-time":
          return "2026-01-01T12:00:00Z"
        case "date":
          return "2026-01-01"
        case "email":
          return "member@example.com"
        case "uri":
          return "https://example.com"
        default:
          return "…"
      }
    case "integer":
    case "number":
      return 1
    case "boolean":
      return true
    case "array":
      return [exampleOf((schema.items ?? {}) as Record<string, unknown>)]
    case "object":
      return Object.fromEntries(
        Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>).map(([k, v]) => [k, exampleOf(v)]),
      )
    default:
      return null
  }
}

/** A rejection's data as a client receives it, with example facts: what the API reference shows for it. */
function exampleDataOf(type: string, facts: z.ZodRawShape, w: Wording): Record<string, unknown> {
  const example = exampleOf(z.toJSONSchema(z.object(facts)) as Record<string, unknown>) as Record<string, unknown>
  const detail = w.detail(example as never)
  const { title, happened, causes, resolution } = w
  return { type, title, detail, instance: "0192f3a0-0000-7000-8000-0000000000aa", happened, causes, resolution, ...example }
}

/**
 * The contract's words on a descriptor's rejections: for each code, its title, its explanation and what each of its
 * facts means. It does not compile unless every rejection the domain declares has a wording, and every fact a doc.
 * `.errors` is the contract's `.errors(…)`: each rejection's data is its problem type, words and documented facts, and
 * the request's correlation id as `instance`. Protocol-neutral: what a rejection is worth over HTTP is `statusesOf`.
 *
 *   export const problems = problemsOf(AddItem, {
 *     CART_FULL: {
 *       title: "The cart is full",
 *       detail: (f) => `Cart ${f.aggregateId} already holds ${f.items} items, the most a cart can hold.`,
 *       happened: "…", causes: ["…"], resolution: ["…"],
 *       facts: { aggregateId: { description: "The cart.", examples: ["0192…"] }, items: { description: "…", examples: [3] } },
 *     },
 *   })
 */
export function problemsOf<const D extends Refusing>(descriptor: D, wording: WordingOf<D>): Problems<D> {
  const words = wording as unknown as Readonly<Record<string, Wording>>
  const errors = (descriptor.result?.rejections ?? []).map((r) => {
    const w = words[r.code]!
    const facts = documentedShape(r.facts, (w.facts ?? {}) as never)
    return [
      r.code,
      {
        message: w.title,
        data: z
          .object({
            type: z.literal(problemTypeOf(descriptor, r.code)),
            title: z.literal(w.title),
            detail: z.string(),
            instance: z.string(),
            happened: z.string(),
            causes: z.array(z.string()),
            resolution: z.array(z.string()),
            ...facts,
          })
          // The rejection's own words, so the API reference explains each refusal, not just its title.
          .meta({
            title: w.title,
            description: [w.happened, `Causes: ${w.causes.join(" ")}`, `Resolution: ${w.resolution.join(" ")}`].join("\n\n"),
            examples: [exampleDataOf(problemTypeOf(descriptor, r.code), facts, w)],
          }),
      },
    ]
  })
  return { descriptor, wording: words, errors: Object.fromEntries(errors) as Problems<D>["errors"] }
}

/**
 * HTTP only: the status each of a descriptor's rejections answers with, beside the route's method and path. It does
 * not compile unless every rejection has one and no other code appears. An MCP edge ignores it. oRPC maps a status by
 * code alone, so a code another slice also refuses with answers the same status there (`slices/index.ts` checks).
 */
export const statusesOf = <
  const D extends Refusing,
  const S extends Record<CodeOf<D>, number> & Record<Exclude<keyof S, CodeOf<D>>, never>,
>(_descriptor: D, statuses: S): Readonly<Record<string, number>> => statuses

/**
 * What the domain answered, as the contract's declared error, worded as the contract words it, to throw from a
 * controller: `if (!result.ok) throw refuse(call, problems, result)`.
 */
export function refuse<D extends Refusing>(
  call: {
    // `any`: oRPC builds one constructor per code, each typed to its own data; the data is built right here.
    readonly errors: { readonly [K in CodeOf<D>]: (options: { message: string; data: any }) => Error }
    readonly context: { readonly correlationId: string }
  },
  problems: Problems<D>,
  answer: { readonly ok: false; readonly rejection: CodeOf<D> },
): Error {
  const { ok: _, rejection: code, ...facts } = answer
  const w = problems.wording[code]!
  const detail = w.detail(facts)
  const { title, happened, causes, resolution } = w
  return call.errors[code]({
    message: detail,
    data: { ...facts, type: problemTypeOf(problems.descriptor, code), title, detail, instance: call.context.correlationId, happened, causes, resolution },
  })
}
