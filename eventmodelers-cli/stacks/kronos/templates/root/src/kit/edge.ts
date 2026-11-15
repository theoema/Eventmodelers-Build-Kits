import {
  type CommandBus,
  type CommandHandlerContext,
  type InferOutput,
  type InferResult,
  type Logger,
  type Metadata,
  type QueryBus,
  type QueryDescriptor,
  query,
  type StandardSchemaV1,
  type SubscriptionCapableQueryBus,
  send,
  subscriptionQuery,
} from "@kronos-ts/core"
import { ANONYMOUS, type Actor } from "./actor"

/**
 * A view, live: its answer now, then every update its projection emits, until `close()`. The updates are the shape the
 * slice's projection emits (its query's update schema), checked by the stream procedure's output schema.
 */
export type Live<R> = {
  readonly initialResult: Promise<R>
  readonly updates: AsyncIterable<unknown>
  close(): void
}

/**
 * A request's context: where a request becomes a message, and the only place per-request metadata enters. A
 * controller reaches the buses through `send`, `query` and `subscribe` and nothing else.
 */
export type Edge = Pick<CommandHandlerContext, "send" | "query"> & {
  /** A view's answer now, then its updates: what a `/stream` procedure serves. */
  subscribe<P extends StandardSchemaV1, R extends StandardSchemaV1>(
    descriptor: QueryDescriptor<P, R>,
    payload: InferOutput<P>,
    metadata?: Metadata,
  ): Live<InferResult<R>>
  /** Who is asking, and what kind of who: stamped on the request's message, and carried from there. */
  readonly actor: string
  readonly actorType: string
  /** On every message the request births, in its log lines and its response header. */
  readonly correlationId: string
  /** This request's log, bound to its correlation id. */
  readonly log: Logger
}

/** A caller's correlation id is kept only when it is this: short, and nothing a log line or a header could trip on. */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * The caller's correlation id when it is safe (at most 128 of `A-Za-z0-9._:-`), else the trace id it continues, else a
 * new one. An unsafe one is replaced, never refused: it goes into logs and every message's metadata.
 */
export function correlationIdOf(header: string | null | undefined, traceId?: string): string {
  if (header && SAFE_CORRELATION_ID.test(header)) return header
  return traceId ?? crypto.randomUUID()
}

export function edge(deps: {
  /** Absent when the app handles no commands: a send then fails as one nothing handles. */
  commandBus?: CommandBus
  /** Absent when the app answers no queries. */
  queryBus?: QueryBus
  log: Logger
  /** Who is asking. Absent: anonymous. */
  actor?: Actor
  correlationId?: string
  /** The W3C trace context the request's messages continue. */
  traceparent?: string
}): Edge {
  const correlationId = deps.correlationId ?? crypto.randomUUID()
  const { actor, actorType } = deps.actor ?? ANONYMOUS
  const stamped: Metadata = { actor, actorType, correlationId, ...(deps.traceparent ? { traceparent: deps.traceparent } : {}) }
  return {
    actor,
    actorType,
    correlationId,
    log: deps.log.with({ correlationId, actor, actorType }),
    send: (descriptor, payload, metadata) =>
      send(present(deps.commandBus, "command"), descriptor, payload, { ...metadata, ...stamped }),
    query: (descriptor, payload, metadata) =>
      query(present(deps.queryBus, "query"), descriptor, payload, { ...metadata, ...stamped }),
    subscribe: (descriptor, payload, metadata) =>
      subscriptionQuery(live(present(deps.queryBus, "query")), descriptor, payload, { ...metadata, ...stamped }) as Live<never>,
  }
}

function present<B>(bus: B | undefined, kind: string): B {
  if (!bus) throw new Error(`No ${kind} handlers: this app has no ${kind} bus to send over.`)
  return bus
}

/** The query bus, when it carries live updates (in memory and over KronosDB both do). */
function live(bus: QueryBus): SubscriptionCapableQueryBus {
  if (typeof (bus as Partial<SubscriptionCapableQueryBus>).subscriptionQuery !== "function") {
    throw new Error("This app's query bus carries no live updates, so a view cannot stream.")
  }
  return bus as SubscriptionCapableQueryBus
}
