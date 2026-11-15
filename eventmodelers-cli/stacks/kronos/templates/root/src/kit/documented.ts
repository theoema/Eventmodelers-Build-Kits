import { z } from "zod"

// Plain data and zod: a slice's contract.ts documents its Request and Response with this, so it reaches the browser.
// Keep this file free of every runtime but zod.

/** What a field means to a caller of the API, and an example of it. */
export type FieldDoc = { readonly description: string; readonly examples?: readonly unknown[] }

/** The object a field holds, under its wrappers (optional, nullable, a list), if it holds one. */
type ObjectIn<T> =
  T extends z.ZodOptional<infer U>
    ? ObjectIn<U>
    : T extends z.ZodNullable<infer U>
      ? ObjectIn<U>
      : T extends z.ZodArray<infer U>
        ? ObjectIn<U>
        : T extends z.ZodObject<infer S>
          ? S
          : never

/** A doc for every field of a shape, and for every field of an object a field holds (`fields`): no more, no fewer. */
export type DocsOf<S extends z.ZodRawShape> = {
  readonly [K in keyof S]: FieldDoc & ([ObjectIn<S[K]>] extends [never] ? unknown : { readonly fields: DocsOf<ObjectIn<S[K]>> })
}

type Docs = Readonly<Record<string, FieldDoc & { readonly fields?: Docs }>>

/** `schema` with its nested object documented too, through the same wrappers `ObjectIn` looks under. */
function documentedField(schema: z.ZodType, doc: FieldDoc & { readonly fields?: Docs }): z.ZodType {
  const { fields, ...meta } = doc
  return (fields ? within(schema, fields) : schema).meta(meta)
}

function within(schema: z.ZodType, fields: Docs): z.ZodType {
  if (schema instanceof z.ZodOptional) return within(schema.unwrap() as z.ZodType, fields).optional()
  if (schema instanceof z.ZodNullable) return within(schema.unwrap() as z.ZodType, fields).nullable()
  if (schema instanceof z.ZodArray) return z.array(within(schema.element as z.ZodType, fields))
  if (schema instanceof z.ZodObject) return documentedShapeOf(schema, fields)
  return schema
}

function documentedShapeOf(schema: z.ZodObject, docs: Docs): z.ZodObject {
  return schema.extend(Object.fromEntries(Object.entries(schema.shape).map(([k, v]) => [k, documentedField(v as z.ZodType, docs[k]!)])))
}

/**
 * The contract's words on a domain schema: each field's description and example, for the API reference and the UI
 * contract. The domain declares the types and constraints; the contract says what they mean to a caller. Every field
 * needs a doc, and an object a field holds needs one for each of its fields (`fields`), or it does not compile.
 *
 *   export const Request = documented(AddItem.payload, {
 *     itemId: { description: "This item in the cart; minted by the client, so a retry lands once.", examples: ["0192…"] },
 *     …
 *   })
 *   export const Response = documented(GetCartItems.result.success, {
 *     items: { description: "The items in the cart, oldest first.", fields: { itemId: { description: "…" }, … } },
 *     …
 *   })
 */
export function documented<S extends z.ZodRawShape>(schema: z.ZodObject<S>, docs: DocsOf<S>): z.ZodObject<S> {
  return documentedShapeOf(schema, docs as Docs) as z.ZodObject<S>
}

/** A shape's fields, documented: what `problemsOf` does to a rejection's facts. */
export function documentedShape<S extends z.ZodRawShape>(shape: S, docs: DocsOf<S>): S {
  return documented(z.object(shape), docs).shape
}
