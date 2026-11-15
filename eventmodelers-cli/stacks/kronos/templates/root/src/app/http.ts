import { type Actor, correlationIdOf, edge } from "#kit"
import { type App, isConflict, isUnavailable, type Logger } from "@kronos-ts/core"
import { formatTraceparent, type OtlpExporter, SpanKind, traceparentOf } from "@kronos-ts/otlp"
import { COMMON_ERROR_STATUS_MAP, OpenAPIGenerator } from "@orpc/openapi"
import { OpenAPIHandler } from "@orpc/openapi/fetch"
import { type AnyORPCError, type AnyRouter, ORPCError } from "@orpc/server"
import { ZodToJsonSchemaConverter } from "@orpc/zod"

export const CORRELATION_HEADER = "x-correlation-id"

/** One problem the API can answer, as the reference documents it. */
type Problem = {
  slug: string
  anchor: string
  title: string
  status: number
  markdown: string
  details: string
  tags: string[]
  /** What `/problems/…` answers a client that asks for JSON. */
  json: Record<string, unknown>
}

/** What a problem's description says, split back into its parts (`problemsOf` writes them in this order). */
function partsOf(description: string) {
  const [happened = "", ...rest] = description.split("\n\n")
  const part = (label: string) => rest.find((r) => r.startsWith(`${label}: `))?.slice(label.length + 2)
  return { happened, causes: part("Causes"), resolution: part("Resolution") }
}

/** Scalar's anchor for a heading in the introduction: lower case, punctuation dropped, spaces as dashes. */
const anchorOf = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/ +/g, "-")

/**
 * Every problem in the document: each declared rejection, read off the responses that answer with it (its type, its
 * title, its explanation, its status, the endpoints that answer it), and the edge's own three. A rejection is one
 * problem per message that declares it: two slices refusing with the same code are two problems, each in its words.
 */
function problemsOf(spec: { paths?: object }): Problem[] {
  type Variant = {
    title?: string
    description?: string
    examples?: unknown[]
    properties?: { data?: { properties?: { type?: { const?: string }; title?: { const?: string } }; examples?: unknown[] } }
  }
  type Found = {
    code: string
    /** A slice's rejection, declared on its contract; the edge's own problems are not. */
    defined: boolean
    title: string
    status: number
    description: string
    endpoints: string[]
    tags: string[]
    example?: Record<string, unknown>
  }
  const found = new Map<string, Found>()
  for (const [path, operations] of Object.entries((spec.paths ?? {}) as Record<string, Record<string, unknown>>)) {
    for (const [method, operation] of Object.entries(operations ?? {})) {
      const responses = (operation as { responses?: Record<string, { content?: Record<string, { schema?: Variant & { oneOf?: Variant[] } }> }> }).responses
      for (const [status, response] of Object.entries(responses ?? {})) {
        const schema = response.content?.["application/json"]?.schema
        for (const variant of schema?.oneOf ?? (schema ? [schema] : [])) {
          if (!variant.title || !variant.description) continue
          const data = variant.properties?.data
          const type = data?.properties?.type?.const
          if (!type) continue
          const entry: Found = found.get(type) ?? {
            code: variant.title,
            defined: true,
            title: data?.properties?.title?.const ?? variant.title,
            status: Number(status),
            description: variant.description,
            endpoints: [],
            tags: [],
            ...(data?.examples?.[0] ? { example: data.examples[0] as Record<string, unknown> } : {}),
          }
          entry.endpoints.push(`${method.toUpperCase()} ${path}`)
          for (const tag of (operation as { tags?: string[] }).tags ?? []) if (!entry.tags.includes(tag)) entry.tags.push(tag)
          found.set(type, entry)
        }
      }
    }
  }
  const instance = "0192f3a0-0000-7000-8000-0000000000aa"
  const own: Array<[string, Found]> = [
    [
      problemType("INVALID_REQUEST"),
      {
        code: "INVALID_REQUEST",
        defined: false,
        title: "The request is not valid",
        status: 400,
        description: "The request was refused before anything ran: its input does not match the endpoint's schema, or its body is not JSON. `errors` names each field (`pointer`) and what is wrong with it (`detail`).\n\nResolution: Correct the fields named in `errors` and send the request again.",
        endpoints: ["any endpoint"],
        tags: [],
        example: { title: "The request is not valid", detail: "One field is not valid.", instance, errors: [{ pointer: "/email", detail: "Invalid email address" }] },
      },
    ],
    ...failures.map(
      (f): [string, Found] => [
        problemType(f.code),
        {
          code: f.code,
          defined: false,
          title: f.title,
          status: f.status,
          description: `${f.detail}\n\nResolution: ${f.status === 409 ? "Send the request again: it carries its own id and lands once." : "Try again in a moment."}`,
          endpoints: ["any command"],
          tags: [],
          example: { title: f.title, detail: f.detail, instance },
        },
      ],
    ),
  ]
  return [...found, ...own].map(([type, p]) => {
    const { code } = p
    const { happened, causes, resolution } = partsOf(p.description)
    const slug = type.slice("/problems/".length)
    const markdown = [
      `### ${p.title}`,
      "",
      `\`${p.status}\` · \`${type}\``,
      "",
      happened,
      ...(causes ? ["", `**Causes:** ${causes}`] : []),
      ...(resolution ? ["", `**Resolution:** ${resolution}`] : []),
      "",
    ].join("\n")
    // In a slice's section: one line per problem, opened for the explanation.
    const details = [
      "<details>",
      `<summary><code>${p.status}</code> <strong>${p.title}</strong></summary>`,
      "",
      happened,
      "",
      ...(causes ? [`**Causes:** ${causes}`, ""] : []),
      ...(resolution ? [`**Resolution:** ${resolution}`, ""] : []),
      ...(p.example
        ? [
            "**What it answers**",
            "",
            "```json",
            JSON.stringify(
              {
                defined: p.defined,
                code: code === "INVALID_REQUEST" ? "BAD_REQUEST" : code,
                message: p.example.detail,
                data: { type, status: p.status, ...p.example },
              },
              null,
              2,
            ),
            "```",
            "",
          ]
        : []),
      `<sub>type: <a href="${type}"><code>${type}</code></a></sub>`,
      "",
      "</details>",
      "",
    ].join("\n")
    const json = {
      type,
      code: code === "INVALID_REQUEST" ? "BAD_REQUEST" : code,
      title: p.title,
      status: p.status,
      happened,
      ...(causes ? { causes } : {}),
      ...(resolution ? { resolution } : {}),
      endpoints: p.endpoints,
      ...(p.example ? { example: { type, status: p.status, ...p.example } } : {}),
    }
    return { slug, anchor: anchorOf(p.title), title: p.title, status: p.status, markdown, details, tags: p.tags, json }
  })
}

/** A problem's section as a page of its own, for when the reference is off. */
function problemPage(problem: Problem): string {
  const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const html = escape(problem.markdown)
    .replace(/^### (.*)$/m, "<h1>$1</h1>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .split("\n\n")
    .map((block) => (block.startsWith("<h1>") ? block : `<p>${block}</p>`))
    .join("\n")
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(problem.title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#222}code{background:#f3f3f3;padding:.1em .3em;border-radius:4px}</style></head><body>${html}</body></html>`
}

/** The API reference page: Scalar, reading /openapi.json. */
const DOCS = `<!doctype html>
<html>
  <head>
    <title>API reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <style>
      /* A problem's row: the status sits centred beside its title. */
      /* Scalar aligns a summary's items to the top; its rule is more specific than this one, hence !important. */
      details > summary { align-items: center !important; }
      details > summary > code { padding: 0.25em 0.45em; }
    </style>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script>
      // A problem's type (/problems/…) lands here as ?problem=…: open that problem's row and bring it into view, once
      // Scalar has rendered it.
      const asked = new URLSearchParams(location.search).get("problem")
      if (asked) {
        const target = "/problems/" + asked
        const find = () => [...document.querySelectorAll("details")].find((d) => d.querySelector('a[href="' + target + '"]'))
        let tries = 0
        const timer = setInterval(() => {
          const row = find()
          if (row || ++tries > 100) clearInterval(timer)
          if (row) {
            row.open = true
            row.scrollIntoView({ block: "center" })
          }
        }, 100)
      }
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.2"></script>
  </body>
</html>`

/**
 * The edge's own problems, which any endpoint can answer: `INVALID_REQUEST` is `/problems/invalid-request`. A slice's
 * rejection is typed by the message that declares it (`problemTypeOf`, on its data).
 */
const problemType = (code: string) => `/problems/${code.toLowerCase().replaceAll("_", "-")}`

/** Whether `error`, or what oRPC wrapped it around, is of a kind `is` recognises. */
const found = (is: (error: unknown) => boolean, error: unknown): boolean =>
  is(error) || (error instanceof ORPCError && found(is, error.cause))

/**
 * The failures any endpoint can answer, each a problem of the edge's own:
 * - unauthorized: the procedure needs a signed-in caller and this one is not (`signedIn`, src/app/auth.ts): 401;
 * - forbidden: the caller is known but may not call this (a middleware of the app's own): 403;
 * - a conflict: the append lost a race (another writer changed what the decision read). Nothing is wrong with the
 *   request: 409, and the caller sends it again (it carries its own id and lands once);
 * - unavailable: a store or bus could not be reached, is overloaded or shutting down: 503, and the caller tries later.
 * Conflict and unavailable are recognised as kronos-ts names them for every store and bus, on this instance or on
 * another one the command ran on. Anything else that is not a rejection stays oRPC's 500.
 */
const failures = [
  {
    is: (error: unknown) => error instanceof ORPCError && error.code === "UNAUTHORIZED",
    code: "UNAUTHORIZED",
    status: 401,
    title: "Not signed in",
    detail: "This needs a signed-in caller. Sign in, then send the request again.",
  },
  {
    is: (error: unknown) => error instanceof ORPCError && error.code === "FORBIDDEN",
    code: "FORBIDDEN",
    status: 403,
    title: "Not allowed",
    detail: "The caller may not do this.",
  },
  {
    is: isConflict,
    code: "CONFLICT",
    status: 409,
    title: "Changed at the same moment",
    detail: "Someone else changed this at the same moment. Send the request again.",
  },
  {
    is: isUnavailable,
    code: "SERVICE_UNAVAILABLE",
    status: 503,
    title: "Not available right now",
    detail: "The service could not be reached just now. Try again in a moment.",
  },
] as const

/** One field the request got wrong: where (an RFC 6901 JSON Pointer into the input), and what. */
type InvalidField = { pointer: string; detail: string }

/**
 * A request the contract refuses before any handler runs: input that does not match its schema, or a body that is
 * not JSON. Answered 400 with a problem document in the same shape as a rejection, its `errors` naming each field
 * (`pointer`) and what is wrong with it (`detail`, the schema's own message), so a client can put each one next to
 * its field. Nothing else of the schema leaks: no patterns, no internal codes.
 */
function invalidRequest(caught: unknown, instance: string): ORPCError<"BAD_REQUEST", unknown> | undefined {
  const issues =
    caught instanceof ORPCError && caught.code === "BAD_REQUEST" && !caught.defined
      ? (caught.data as { issues?: ReadonlyArray<{ path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>; message: string }> } | undefined)?.issues
      : undefined
  const malformed = caught instanceof SyntaxError || (caught instanceof ORPCError && caught.cause instanceof SyntaxError)
  if (!issues && !malformed) return undefined
  const errors: InvalidField[] = (issues ?? []).map((issue) => ({
    pointer: (issue.path ?? [])
      .map((segment) => String(typeof segment === "object" ? segment.key : segment).replaceAll("~", "~0").replaceAll("/", "~1"))
      .map((segment) => `/${segment}`)
      .join(""),
    detail: issue.message,
  }))
  const detail = malformed
    ? "The request body is not valid JSON."
    : errors.length === 1
      ? "One field is not valid."
      : `${errors.length} fields are not valid.`
  return new ORPCError("BAD_REQUEST", {
    message: detail,
    data: { type: problemType("INVALID_REQUEST"), title: "The request is not valid", detail, status: 400, instance, errors },
    cause: caught,
  })
}

/**
 * The bus of its kind the app has, if any: the edge sends every request over it. None is fine (a fresh app, or one
 * with no commands, has nothing to send); more than one is not, because the edge would not know which to use.
 */
function atMostOne<T>(buses: ReadonlySet<T>, kind: string): T | undefined {
  const [bus, ...more] = buses
  if (more.length > 0) throw new Error(`serve: the app has ${buses.size} ${kind}es and the edge sends over one.`)
  return bus
}

/**
 * The OpenAPI document of the router, and every problem it can answer: what `/openapi.json`, `/docs` and
 * `/problems/…` serve, and what `bun run ui-contract` prints a slice's operations from. Needs no running app.
 */
export async function describe(routes: { router: AnyRouter; statuses: Readonly<Record<string, number>> }) {
  const { statuses } = routes
  const spec = await new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] }).generate(routes.router, {
    base: { info: { title: "API", version: "0.0.0" } },
    errorStatusMap: { ...COMMON_ERROR_STATUS_MAP, ...statuses },
    // The document says what `problem` sends: `status` added to each declared rejection's data (its `type` is there).
    errorResponseBodySchema: (definitions, status, defaultSchema) => {
      if (!definitions.every((d) => statuses[d.code] !== undefined)) return defaultSchema()
      const variants = definitions.map(({ code, dataJsonSchema }) => {
        // The rejection's data (`problemsOf`), with the `status` the edge adds beside its `type`: one object, as sent.
        const data = dataJsonSchema as {
          description?: string
          properties?: Record<string, typeof dataJsonSchema>
          required?: string[]
          examples?: Array<Record<string, unknown>>
        }
        const { type, ...properties } = data.properties ?? {}
        return {
          title: code,
          // The rejection's own words (`problemsOf` puts them on its data), so each refusal is explained.
          ...(typeof data.description === "string" ? { description: data.description } : {}),
          type: "object" as const,
          properties: {
            defined: { const: true },
            code: { const: code },
            message: { type: "string" as const },
            data: {
              ...data,
              properties: { ...(type ? { type } : {}), status: { const: status }, ...properties },
              required: ["status", ...(data.required ?? [])],
              ...(data.examples ? { examples: data.examples.map(({ type, ...rest }) => ({ type, status, ...rest })) } : {}),
            },
          },
          required: ["defined", "code", "message", "data"],
        }
      })
      // One refusal is its own schema; several are a choice between them.
      return variants.length === 1 ? variants[0] : { oneOf: variants }
    },
  })
  // The reference reads like the board: a group per context (the path's first segment), a tag per slice (its title, on
  // every procedure of the slice, so a view and its stream sit together).
  const groups = new Map<string, Set<string>>()
  for (const [path, operations] of Object.entries(spec.paths ?? {})) {
    const context = path.split("/")[1] ?? ""
    for (const operation of Object.values(operations ?? {}) as Array<{ tags?: string[] }>) {
      for (const tag of operation?.tags ?? []) groups.set(context, (groups.get(context) ?? new Set()).add(tag))
    }
}
Object.assign(spec, {
  "x-tagGroups": [...groups].map(([context, tags]) => ({
    name: context.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
    tags: [...tags],
  })),
})
// Every problem the API can answer, one section each, in the reference's introduction: what Scalar shows under
// "Problems", and what a problem document's `type` (`/problems/…`) leads to.
const problems = problemsOf(spec)
Object.assign(spec.info, {
  description: [
    "Every refusal is an RFC 9457 problem document: its `type` names one of the problems below, `status` is its HTTP",
    "status and `instance` the request's correlation id.",
    "",
    "## Problems",
    "What any endpoint can answer. Each slice's own problems are under its section.",
    "",
    ...problems.filter((p) => p.tags.length === 0).map((p) => p.details),
  ].join("\n"),
})
// Each slice's problems at the top of its section, beside the endpoints that answer with them.
const tagNames = [...new Set(problems.flatMap((p) => p.tags))]
Object.assign(spec, {
  tags: tagNames.map((name) => ({
    name,
    description: ["**Problems**", "", ...problems.filter((p) => p.tags.includes(name)).map((p) => p.details)].join("\n"),
  })),
})
return { spec, problems }
}

/**
 * The HTTP edge: plain Bun.serve, oRPC's fetch handler for every procedure as REST, the OpenAPI document at
 * /openapi.json and liveness at /health.
 *
 * The HTTP part of a rejection lives here: its status, from its slice's `statuses`, and its RFC 9457 problem document,
 * the error's data (the rejection's words, facts and `instance`) with `type` and `status` added. The contract and the
 * controller say nothing about HTTP, so an MCP edge serves the same router without this file.
 *
 * Per request: the correlation id is the caller's `x-correlation-id` when safe, else the incoming trace's id, else
 * new (see `correlationIdOf`), and it is echoed in the response header. With an exporter, the request is a SERVER
 * span continuing the caller's `traceparent`, and every message it births is a child of it. A refused or failed
 * request writes one log line, with its correlation id; a successful one writes none (its spans say it).
 */
export async function serve(
  app: App,
  routes: {
    router: AnyRouter
    /** Code → HTTP status, every slice's `statuses` (`src/slices`). */
    statuses: Readonly<Record<string, number>>
  },
  options: {
    log: Logger
    exporter?: OtlpExporter
    port: number
    /** Serve the API reference (Scalar) at /docs: `API_DOCS`, on by default in development only. */
    docs?: boolean
    /**
     * Who is asking, from the request (a session cookie, a bearer token): `{ actor, actorType }`, stamped on the
     * request's message and carried onto everything it causes (see `#kit` `Actor`). The kit does not decide how an
     * app authenticates; without this, or when it answers nothing, the request is anonymous. A header the client
     * sets is never trusted as an identity.
     */
    identify?: (request: Request) => Actor | undefined | Promise<Actor | undefined>
  },
) {
  const { statuses } = routes
  const { log: appLog, exporter, port } = options
  // The edge sends over the buses the app was wired with: the one command bus and the one query bus of this kit.
  const commandBus = atMostOne(app.commandBuses, "command bus")
  const queryBus = atMostOne(app.queryBuses, "query bus")
  const errorStatusMap: Record<string, number> = { ...COMMON_ERROR_STATUS_MAP, ...statuses }
  /** A declared rejection's body: oRPC's error, its data the problem document (`status` added). Anything else: oRPC's own. */
  const problem = (error: AnyORPCError) => {
    if (!error.defined || statuses[error.code] === undefined) return error.toJSON()
    const { type, ...rest } = error.data as { type: string }
    return { ...error.toJSON(), data: { type, status: statuses[error.code], ...rest } }
  }
  const rest = new OpenAPIHandler(routes.router, {
    errorStatusMap,
    errorResponseBodyEncoder: problem,
    // A live view's stream (Server-Sent Events) sends a comment every 5 s between updates. Bun.serve closes a response
    // that writes nothing for 10 s (its idleTimeout), and so does many a proxy; oRPC's own default, 15 s, is too long.
    toFetchResponse: { eventStream: { keepAlive: { interval: 5_000 } } },
    interceptors: [
      async ({ next, context }) => {
        try {
          return await next()
        } catch (caught) {
          const { log, correlationId } = context as { log: Logger; correlationId: string }
          const failure = failures.find((f) => found(f.is, caught))
          const invalid = failure ? undefined : invalidRequest(caught, correlationId)
          const error = invalid
            ? invalid
            : failure
            ? new ORPCError(failure.code, {
                message: failure.detail,
                data: {
                  type: problemType(failure.code),
                  title: failure.title,
                  detail: failure.detail,
                  status: failure.status,
                  instance: correlationId,
                },
                cause: caught,
              })
            : caught
          if (error instanceof ORPCError && error.code !== "INTERNAL_SERVER_ERROR") {
            log.info("request refused", { code: error.code, status: errorStatusMap[error.code] ?? 500 })
          } else {
            // oRPC hides an unexpected failure from the client, so its cause is logged here or it is lost.
            log.error("request failed", {
              error: error instanceof Error ? error.name : typeof error,
              reason: error instanceof Error ? error.message : String(error),
            })
          }
          throw error
        }
      },
    ],
  })
  const { spec, problems } = await describe(routes)
  return Bun.serve({
    port,
    routes: {
      // A problem document's `type`: with docs on, its section in the reference; otherwise that section on its own.
      "/problems/*": (request) => {
        const slug = new URL(request.url).pathname.slice("/problems/".length)
        const problem = problems.find((p) => p.slug === slug)
        if (!problem) return Response.json({ code: "NOT_FOUND", status: 404 }, { status: 404 })
        // A client that asks for JSON gets the problem as data, wherever the reference is.
        if (request.headers.get("accept")?.includes("application/json")) return Response.json(problem.json)
        if (options.docs) {
          const tag = problem.tags[0]
          const section = tag ? `tag/${anchorOf(tag)}` : "description/problems"
          return Response.redirect(`/docs?problem=${encodeURIComponent(problem.slug)}#${section}`, 302)
        }
        return new Response(problemPage(problem), { headers: { "content-type": "text/html; charset=utf-8" } })
      },
      "/health": () => Response.json({ ok: true }),
      "/openapi.json": () => Response.json(spec),
      // The API reference (Scalar) over the document above, when asked for (development). Its script is pinned.
      "/docs": () =>
        options.docs
          ? new Response(DOCS, { headers: { "content-type": "text/html; charset=utf-8" } })
          : Response.json({ code: "NOT_FOUND", status: 404 }, { status: 404 }),
    },
    async fetch(request) {
      const url = new URL(request.url)
      const incoming = traceparentOf({ traceparent: request.headers.get("traceparent") ?? undefined })
      const correlationId = correlationIdOf(request.headers.get(CORRELATION_HEADER), incoming?.traceId)
      const span = exporter?.startSpan({
        name: `${request.method} ${url.pathname}`,
        kind: SpanKind.SERVER,
        parent: incoming,
        attributes: { "http.request.method": request.method, "url.path": url.pathname, "correlation.id": correlationId },
      })
      const traceparent = span ? formatTraceparent(span) : (incoming && formatTraceparent(incoming)) || undefined
      const context = edge({
        commandBus,
        queryBus,
        actor: await options.identify?.(request),
        correlationId,
        traceparent,
        log: appLog.with({ method: request.method, path: url.pathname }),
      })
      try {
        const { response } = await rest.handle(request, { context })
        const answer = response ?? Response.json({ code: "NOT_FOUND", status: 404 }, { status: 404 })
        answer.headers.set(CORRELATION_HEADER, correlationId)
        if (answer.status >= 500) span?.fail(new Error(`HTTP ${answer.status}`))
        else span?.end()
        return answer
      } catch (error) {
        span?.fail(error)
        throw error
      }
    },
  })
}
