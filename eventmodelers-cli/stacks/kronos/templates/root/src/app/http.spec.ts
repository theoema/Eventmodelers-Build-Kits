import { afterAll, beforeAll, expect, it } from "bun:test"
import { correlationIdOf, type Edge, pipe, problemsOf, refuse, rejection, result, type Slice, statusesOf } from "#kit"
import {
  AppendConditionError,
  commandHandler,
  consoleLogger,
  correlation,
  inMemoryDeadLetterQueue,
  inMemoryEventStore,
  inMemorySchedulingEventStore,
  inMemoryTokenStore,
  interceptingCommandBus,
  interceptingQueryBus,
  localCommandBus,
  localQueryBus,
  UnavailableError,
  unitOfWork,
  withNamespace,
} from "@kronos-ts/core"
import { oc } from "@orpc/contract"
import { openapi } from "@orpc/openapi"
import { implement } from "@orpc/server"
import { z } from "zod"
import { app } from "../app"
import { signedIn } from "./auth"
import { CORRELATION_HEADER, serve } from "./http"

// The edge's correlation id and a rejection's problem document, through the real HTTP edge and the app's own wiring
// (in memory, no Docker), with a slice of its own so the spec does not depend on the app's slices.
const ns = withNamespace("edge-spec")
const Ping = ns.command("Ping", { payload: z.object({ pingId: z.string() }), result: result({}, rejection("PING_SILENCED", { pingId: z.string() })) })
// Another message refusing with the same code: a problem of its own, in its own words.
const Echo = ns.command("Echo", { payload: z.object({ pingId: z.string() }), result: result({}, rejection("PING_SILENCED", { pingId: z.string() })) })
// The contract's words on each: the domain declares only the code and its facts.
const pingProblems = problemsOf(Ping, {
  PING_SILENCED: {
    title: "The ping is silenced",
    detail: (f) => `Ping ${f.pingId} is silenced.`,
    happened: "The ping was not recorded, because it is silenced.",
    causes: ["The ping id starts with `silent`."],
    resolution: ["Ping with another id."],
    facts: { pingId: { description: "The ping that was silenced." } },
  },
})
const echoProblems = problemsOf(Echo, {
  PING_SILENCED: {
    title: "Echoes are off",
    detail: (f) => `Ping ${f.pingId} is not echoed: echoes are off.`,
    happened: "Nothing was echoed, because echoes are off.",
    causes: ["Echoes were turned off."],
    resolution: ["Turn echoes on."],
    facts: { pingId: { description: "The ping that was not echoed." } },
  },
})
const Pinged = ns.event("Pinged", { payload: z.object({ pingId: z.string() }), tags: { pingId: (p) => p.pingId } })
const contract = {
  ping: oc
    .meta(openapi({ method: "POST", path: "/ping" }))
    .errors(pingProblems.errors)
    .input(z.object({ pingId: z.string() }))
    .output(z.object({})),
  echo: oc
    .meta(openapi({ method: "POST", path: "/echo" }))
    .errors(echoProblems.errors)
    .input(z.object({ pingId: z.string() }))
    .output(z.object({})),
  // Only for a signed-in caller (`signedIn`): who the edge says is asking.
  whoami: oc.meta(openapi({ method: "GET", path: "/whoami" })).output(z.object({ actor: z.string() })),
}
const ping = {
  router: {
    whoami: implement(contract).$context<Edge>().whoami.use(signedIn).handler(({ context }) => ({ actor: context.actor })),
    ping: implement(contract).$context<Edge>().ping.handler(async (call) => {
      const answer = await call.context.send(Ping, call.input)
      if (!answer.ok) throw refuse(call, pingProblems, answer)
      return {}
    }),
    echo: implement(contract).$context<Edge>().echo.handler(async (call) => {
      const answer = await call.context.send(Echo, call.input)
      if (!answer.ok) throw refuse(call, echoProblems, answer)
      return {}
    }),
  },
  statuses: { ...statusesOf(Ping, { PING_SILENCED: 422 }), ...statusesOf(Echo, { PING_SILENCED: 422 }) },
  commandHandlers: [
    commandHandler(Ping, ({ payload }, ctx) => {
      if (payload.pingId.startsWith("silent")) return { ok: false, rejection: "PING_SILENCED", pingId: payload.pingId }
      // Stands in for an append that lost a race with another writer.
      if (payload.pingId.startsWith("race")) throw new AppendConditionError("Append condition violated")
      // Stands in for a store or bus that could not be reached.
      if (payload.pingId.startsWith("down")) throw new UnavailableError("KronosDB could not be reached")
      ctx.append(Pinged, payload)
      return { ok: true }
    }),
    commandHandler(Echo, ({ payload }) => ({ ok: false, rejection: "PING_SILENCED", pingId: payload.pingId })),
  ],
} satisfies Slice
const eventStore = pipe(inMemoryEventStore(), inMemorySchedulingEventStore)
const commandBus = pipe(localCommandBus(unitOfWork), (b) => interceptingCommandBus(b, correlation))
const queryBus = pipe(localQueryBus(unitOfWork), (b) => interceptingQueryBus(b, correlation))
const log = consoleLogger({ write: () => {} })
const running = app(
  {
    eventStore,
    commandBus,
    queryBus,
    tokenStore: inMemoryTokenStore(),
    deadLetterQueue: inMemoryDeadLetterQueue(),
    processing: unitOfWork,
    log,
  },
  [ping],
)
let server: Awaited<ReturnType<typeof serve>>
beforeAll(async () => {
  server = await serve(running, ping, { log, port: 0 })
})
afterAll(async () => {
  await server.stop()
  await running.stop()
})

let n = 0
/** Ping over HTTP with these headers: the response's correlation header, and the one its event carries. */
async function addWith(headers: Record<string, string>) {
  const pingId = `ping-${++n}`
  const response = await fetch(new URL("/ping", server.url), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ pingId }),
  })
  expect(response.status).toBe(200)
  const { events } = await eventStore.source({ query: { types: [Pinged] } })
  const appended = events.find((e) => (e.payload as { pingId: string }).pingId === pingId)!
  return { answered: response.headers.get(CORRELATION_HEADER), carried: appended.metadata.correlationId }
}

it("keeps a caller's correlation id that is safe", async () => {
  const { answered, carried } = await addWith({ [CORRELATION_HEADER]: "order-42:retry.1" })
  expect(answered).toBe("order-42:retry.1")
  expect(carried).toBe("order-42:retry.1")
})

it("replaces an unsafe one — it would reach logs and every message — and never refuses the request", async () => {
  const { answered, carried } = await addWith({ [CORRELATION_HEADER]: "evil <script> level=error" })
  expect(answered).not.toContain("evil")
  expect(carried).toBe(answered)
  expect(correlationIdOf("x".repeat(129))).not.toBe("x".repeat(129))
})

it("takes the trace id of an incoming traceparent when there is no header", async () => {
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736"
  const { answered, carried } = await addWith({ traceparent: `00-${traceId}-00f067aa0ba902b7-01` })
  expect(answered).toBe(traceId)
  expect(carried).toBe(traceId)
})

it("generates one when the request brings none", async () => {
  const first = await addWith({})
  const second = await addWith({})
  expect(first.answered).toBeTruthy()
  expect(first.carried).toBe(first.answered)
  expect(second.answered).not.toBe(first.answered)
})

it("answers a rejection with its status and its RFC 9457 problem document", async () => {
  const response = await fetch(new URL("/ping", server.url), {
    method: "POST",
    headers: { "content-type": "application/json", [CORRELATION_HEADER]: "req-7" },
    body: JSON.stringify({ pingId: "silent-1" }),
  })
  expect(response.status).toBe(422)
  expect(await response.json()).toEqual({
    defined: true,
    code: "PING_SILENCED",
    message: "Ping silent-1 is silenced.",
    data: {
      type: "/problems/ping/ping-silenced",
      status: 422,
      title: "The ping is silenced",
      detail: "Ping silent-1 is silenced.",
      instance: "req-7",
      happened: "The ping was not recorded, because it is silenced.",
      causes: ["The ping id starts with `silent`."],
      resolution: ["Ping with another id."],
      pingId: "silent-1",
    },
  })
})

it("types a rejection by the message that declares it: the same code from another slice is another problem, in its words", async () => {
  const response = await fetch(new URL("/echo", server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pingId: "p-1" }),
  })
  expect(response.status).toBe(422)
  const body = (await response.json()) as { code: string; data: Record<string, unknown> }
  expect(body.code).toBe("PING_SILENCED")
  expect(body.data).toMatchObject({ type: "/problems/echo/ping-silenced", title: "Echoes are off" })
  const ping = await (await fetch(new URL("/problems/ping/ping-silenced", server.url))).text()
  const echo = await (await fetch(new URL("/problems/echo/ping-silenced", server.url))).text()
  expect(ping).toContain("The ping is silenced")
  expect(echo).toContain("Echoes are off")
  expect(echo).not.toContain("The ping is silenced")
})

it("answers input the contract refuses with 400 and a problem document naming each field, as a rejection is answered", async () => {
  const response = await fetch(new URL("/ping", server.url), {
    method: "POST",
    headers: { "content-type": "application/json", [CORRELATION_HEADER]: "req-10" },
    body: JSON.stringify({ pingId: 42 }),
  })
  expect(response.status).toBe(400)
  const body = (await response.json()) as { code: string; data: Record<string, unknown> }
  expect(body.code).toBe("BAD_REQUEST")
  expect(body.data).toEqual({
    type: "/problems/invalid-request",
    title: "The request is not valid",
    detail: "One field is not valid.",
    status: 400,
    instance: "req-10",
    errors: [{ pointer: "/pingId", detail: expect.stringContaining("expected string") }],
  })
})

it("answers a body that is not JSON with the same problem document, and refuses it rather than failing", async () => {
  const response = await fetch(new URL("/ping", server.url), {
    method: "POST",
    headers: { "content-type": "application/json", [CORRELATION_HEADER]: "req-11" },
    body: '{"pingId":',
  })
  expect(response.status).toBe(400)
  const body = (await response.json()) as { data: Record<string, unknown> }
  expect(body.data).toMatchObject({ type: "/problems/invalid-request", detail: "The request body is not valid JSON.", errors: [] })
})

it("answers an append that lost a race with 409 and a problem document, so the caller sends it again", async () => {
  const response = await fetch(new URL("/ping", server.url), {
    method: "POST",
    headers: { "content-type": "application/json", [CORRELATION_HEADER]: "req-8" },
    body: JSON.stringify({ pingId: "race-1" }),
  })
  expect(response.status).toBe(409)
  const body = (await response.json()) as { code: string; data: Record<string, unknown> }
  expect(body.code).toBe("CONFLICT")
  expect(body.data).toMatchObject({ type: "/problems/conflict", status: 409, instance: "req-8" })
})

it("answers a store or bus that could not be reached with 503 and a problem document, so the caller tries later", async () => {
  const response = await fetch(new URL("/ping", server.url), {
    method: "POST",
    headers: { "content-type": "application/json", [CORRELATION_HEADER]: "req-9" },
    body: JSON.stringify({ pingId: "down-1" }),
  })
  expect(response.status).toBe(503)
  const body = (await response.json()) as { code: string; data: Record<string, unknown> }
  expect(body.code).toBe("SERVICE_UNAVAILABLE")
  expect(body.data).toMatchObject({ type: "/problems/service-unavailable", status: 503, instance: "req-9" })
})

it("serves the API reference at /docs only when asked (development), and the OpenAPI document always", async () => {
  expect((await fetch(new URL("/docs", server.url))).status).toBe(404)
  expect((await fetch(new URL("/openapi.json", server.url))).status).toBe(200)
  const withDocs = await serve(running, ping, { log, port: 0, docs: true })
  try {
    const response = await fetch(new URL("/docs", withDocs.url))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('data-url="/openapi.json"')
  } finally {
    await withDocs.stop()
  }
})

it("stamps who `identify` says is asking on the request's message and its events, and never trusts a header the client sets", async () => {
  const post = (url: URL | string, headers: Record<string, string>, pingId: string) =>
    fetch(new URL("/ping", url), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ pingId }),
    })
  const actorOf = async (pingId: string) => {
    const { events } = await eventStore.source({ query: { types: [Pinged] } })
    const { actor, actorType } = events.find((e) => (e.payload as { pingId: string }).pingId === pingId)!.metadata
    return { actor, actorType }
  }
  await post(server.url, { "x-actor": "admin" }, "claimed-1")
  expect(await actorOf("claimed-1")).toEqual({ actor: "anonymous", actorType: "anonymous" })
  const identified = await serve(running, ping, {
    log,
    port: 0,
    identify: (request) =>
      request.headers.get("authorization") === "Bearer t-1" ? { actor: "member-1", actorType: "user" } : undefined,
  })
  try {
    await post(identified.url, { authorization: "Bearer t-1" }, "identified-1")
    await post(identified.url, {}, "identified-2")
    expect(await actorOf("identified-1")).toEqual({ actor: "member-1", actorType: "user" })
    expect(await actorOf("identified-2")).toEqual({ actor: "anonymous", actorType: "anonymous" })
  } finally {
    await identified.stop()
  }
})

it("answers a problem's type as data to a client that asks for JSON", async () => {
  const response = await fetch(new URL("/problems/ping/ping-silenced", server.url), { headers: { accept: "application/json" } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    type: "/problems/ping/ping-silenced",
    code: "PING_SILENCED",
    title: "The ping is silenced",
    status: 422,
    happened: "The ping was not recorded, because it is silenced.",
    endpoints: ["POST /ping"],
    example: { type: "/problems/ping/ping-silenced", status: 422, title: "The ping is silenced" },
  })
  const general = await fetch(new URL("/problems/conflict", server.url), { headers: { accept: "application/json" } })
  expect(await general.json()).toMatchObject({ type: "/problems/conflict", code: "CONFLICT", status: 409 })
})

it("documents one refusal as one schema, its data the document as sent: type, status, words and facts in one object", async () => {
  const spec = (await (await fetch(new URL("/openapi.json", server.url))).json()) as {
    paths: Record<string, Record<string, { responses: Record<string, { content: Record<string, { schema: Record<string, any> }> }> }>>
  }
  const schema = spec.paths["/ping"]!.post!.responses["422"]!.content["application/json"]!.schema
  expect(schema.oneOf).toBeUndefined()
  expect(schema.title).toBe("PING_SILENCED")
  const data = schema.properties.data
  expect(data.allOf).toBeUndefined()
  expect(Object.keys(data.properties).slice(0, 3)).toEqual(["type", "status", "title"])
  expect(data.properties.type).toEqual({ const: "/problems/ping/ping-silenced", type: "string" })
  expect(data.examples[0]).toMatchObject({ type: "/problems/ping/ping-silenced", status: 422, pingId: "…" })
  // A fact is described by the contract that words the rejection, not by the domain that declares it.
  expect(data.properties.pingId).toMatchObject({ type: "string", description: "The ping that was silenced." })
})

it("answers a procedure only a signed-in caller may use with the edge's 401 problem for anyone else", async () => {
  const identified = await serve(running, ping, {
    log,
    port: 0,
    identify: (request) =>
      request.headers.get("authorization") === "Bearer t-1" ? { actor: "member-1", actorType: "user" } : undefined,
  })
  try {
    const anonymous = await fetch(new URL("/whoami", identified.url), { headers: { "x-correlation-id": "req-9" } })
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toMatchObject({
      code: "UNAUTHORIZED",
      data: { type: "/problems/unauthorized", status: 401, title: "Not signed in", instance: "req-9" },
    })
    const member = await fetch(new URL("/whoami", identified.url), { headers: { authorization: "Bearer t-1" } })
    expect(member.status).toBe(200)
    expect(await member.json()).toEqual({ actor: "member-1" })
  } finally {
    await identified.stop()
  }
})
