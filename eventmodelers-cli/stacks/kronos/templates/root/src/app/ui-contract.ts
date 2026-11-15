// `bun run ui-contract <path>`: a slice's `## UI Contract` section, as the `ui-contract` skill publishes it, printed
// from the OpenAPI document the app serves. The contract is what was built, never restated by hand: the operation at
// `<path>` and, for a live view, its stream at `<path>/stream`, with their summaries, parameters, request body and
// every response (each refusal's problem document included). Needs no running app and no infrastructure.
import { describe } from "./http"
import { router, statuses } from "../slices"

type Operation = { summary?: string; description?: string; tags?: string[]; [key: string]: unknown }

const path = process.argv[2]
const { spec } = await describe({ router, statuses })
const paths = (spec.paths ?? {}) as Record<string, Record<string, Operation>>
if (!path || !paths[path]) {
  console.error(`Usage: bun run ui-contract <path>, one of:\n${Object.keys(paths).map((p) => `  ${p}`).join("\n")}`)
  process.exit(1)
}

/**
 * The operation as a UI needs it: no tags, every `$ref` followed, so it stands on its own, and no `pattern` where a
 * `format` (uuid, email) already says what the value is.
 */
const components = (spec.components ?? {}) as Record<string, Record<string, unknown>>
function inline(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inline)
  if (value && typeof value === "object") {
    const ref = (value as { $ref?: unknown }).$ref
    if (typeof ref === "string" && ref.startsWith("#/components/")) {
      const [, , kind, name] = ref.split("/")
      return inline(components[kind!]?.[name!])
    }
    const formatted = "format" in value
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "tags" && !(formatted && key === "pattern"))
        .map(([key, v]) => [key, inline(v)]),
    )
  }
  return value
}

const stream = paths[`${path}/stream`]
const contract = Object.fromEntries(
  [path, ...(stream ? [`${path}/stream`] : [])].map((p) => [p, inline(paths[p])]),
)
const [method, operation] = Object.entries(paths[path]!)[0]!
const kind = method === "get" ? "READ" : "WRITE"
const purpose = (operation.summary ?? "").replace(/([^.!?])$/, "$1.")
const live = stream ? ` Live: \`GET ${path}/stream\` sends the view, then each update (Server-Sent Events).` : ""
// Bun writes `key: ` before a nested block; the skill wants clean lines.
const yaml = Bun.YAML.stringify(contract, null, 2).replace(/[ \t]+$/gm, "").trimEnd()

console.log(
  [
    "## UI Contract",
    "",
    `**${kind}** \`${method.toUpperCase()} ${path}\` — ${purpose}${live}`,
    "",
    "```yaml ui-contract",
    yaml,
    "```",
  ].join("\n"),
)
