import { afterAll, expect, it } from "bun:test"
import { type Edge, type EventContext, type PartialProcessor, type QueryContext, result, type Slice } from "#kit"
import { testApp } from "#test"
import { batched, consoleLogger, eventHandler, eventProcessor, queryHandler, withNamespace } from "@kronos-ts/core"
import { event, events, fixture } from "@kronos-ts/test"
import { eventIterator, oc } from "@orpc/contract"
import { openapi } from "@orpc/openapi"
import { implement } from "@orpc/server"
import { z } from "zod"
import { serve } from "./http"

// A live view's stream, through the real HTTP edge, as a UI reads it: `initial` first, then an `update` per change. A
// one-row view sends the whole view again in each update. A slice never tests its stream; the kit does, here, with a
// view of its own so the spec does not depend on the app's slices.
const ns = withNamespace("stream-spec")
const Counted = ns.event("Counted", { payload: z.object({ counterId: z.uuid(), count: z.number().int() }), tags: { counterId: (p) => p.counterId } })
const Count = z.object({ counterId: z.uuid(), count: z.number().int() })
const GetCount = ns.query("GetCount", { payload: z.object({ counterId: z.uuid() }), result: result(Count.shape) })

const counts = new Map<string, number>()
const processor: PartialProcessor = (eventStore, tokenStore, unitOfWork) =>
  batched(eventProcessor("stream-spec-count", eventStore, tokenStore, unitOfWork), 100)

const StreamEvent = z.union([z.object({ type: z.literal("initial"), count: Count }), z.object({ type: z.literal("update"), count: Count })])
const contract = {
  countStream: oc
    .meta(openapi({ method: "GET", path: "/count/stream" }))
    .input(GetCount.payload)
    .output(eventIterator(StreamEvent)),
}
const counter = {
  queryHandlers: [
    queryHandler(GetCount, ({ payload: p }, _ctx: QueryContext) => ({ ok: true, counterId: p.counterId, count: counts.get(p.counterId) ?? 0 })),
  ],
  eventHandlers: [
    eventHandler(Counted, ({ payload: p }, ctx: EventContext) => {
      counts.set(p.counterId, p.count)
      ctx.emitUpdate(GetCount, (q) => q.counterId === p.counterId, p)
    }),
  ].map((h) => ({ ...h, processor })),
  router: {
    countStream: implement(contract)
      .$context<Edge>()
      .countStream.handler(async function* ({ input, context, signal }) {
        const live = context.subscribe(GetCount, input)
        signal?.addEventListener("abort", () => live.close())
        try {
          const { ok: _, ...count } = await live.initialResult
          yield { type: "initial", count }
          for await (const update of live.updates) yield { type: "update", count: update as z.output<typeof Count> }
        } finally {
          live.close()
        }
      }),
  },
} satisfies Slice

const app = testApp([counter], { db: true })
const scenarios = fixture(app)
const server = serve(await app, { router: counter.router, statuses: {} }, { log: consoleLogger({ write: () => {} }), port: 0 })
afterAll(async () => (await server).stop())

it("streams a live view over HTTP: initial, then the whole view again on each change", async () => {
  const counterId = Bun.randomUUIDv7()
  const abort = new AbortController()
  const response = await fetch(new URL(`/count/stream?counterId=${counterId}`, (await server).url), { signal: abort.signal })
  // Each Server-Sent Event's data, parsed, as it arrives.
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffered = ""
  const next = async (): Promise<unknown> => {
    for (;;) {
      const data = buffered.match(/^data: (.*)$/m)
      if (data) {
        buffered = buffered.slice(buffered.indexOf(data[0]) + data[0].length)
        return JSON.parse(data[1]!)
      }
      buffered += (await reader.read()).value ?? ""
    }
  }
  try {
    expect(await next()).toEqual({ type: "initial", count: { counterId, count: 0 } })
    const counted = event(Counted, { counterId, count: 3 })
    await scenarios.when(counted).then(events(counted))
    expect(await next()).toEqual({ type: "update", count: { counterId, count: 3 } })
  } finally {
    abort.abort()
  }
})
