import { drizzleHandler, origin, pipe, type Slice } from "#kit"
import {
  type CommandBus,
  correlatingHandler,
  kronos,
  type Logger,
  loggingHandler,
  messageOrigin,
  type QueryBus,
  type ScheduleCapableEventStore,
  type SequencedDeadLetterQueue,
  type TokenStore,
  type UnitOfWork,
  validatingHandler,
} from "@kronos-ts/core"
import { inertTrace, type OtlpExporter, otlpHandler, type TraceCapability } from "@kronos-ts/otlp"
import { type PostgresResource, postgresHandler } from "@kronos-ts/postgres"
import { slices as all } from "./slices"

// Handlers name their own narrower context (QueryContext, …); once `postgresHandler` has supplied `db`, the wrappers
// outside it are typed for any handler.
type Handler = (message: any, context: any) => any

/**
 * What the app is built on: the objects it shares across every handler. `main.ts` builds them over KronosDB and
 * Postgres; a test builds them in memory, or over a fresh database, with the ones it observes in recorders. The
 * parameters keep the type of the log and the buses, so the app reports a recorded log as recorded.
 */
export type Resources<
  S extends ScheduleCapableEventStore = ScheduleCapableEventStore,
  C extends CommandBus = CommandBus,
  Q extends QueryBus = QueryBus,
> = {
  readonly eventStore: S
  readonly commandBus: C
  readonly queryBus: Q
  readonly tokenStore: TokenStore
  readonly deadLetterQueue: SequencedDeadLetterQueue
  /** The unit of work a processor's batch runs in: with Postgres, its writes and its token commit together. */
  readonly processing: () => UnitOfWork
  /** The read-model database. Queries and event handlers need it; an app of only decisions does not. */
  readonly pg?: PostgresResource
  /** Every handling logs through a child of this, bound to the message it handles. */
  readonly log: Logger
  /** Where spans go. Absent: no tracing, and nothing pays for it. */
  readonly exporter?: OtlpExporter
}

/** Without an exporter: a `ctx.trace` that records nothing, so an outside client always has a trace to run its call in. */
const untraced =
  <M, C, R>(next: (message: M, context: C & TraceCapability) => R) =>
  (message: M, context: C): R =>
    next(message, { ...context, trace: inertTrace })

/**
 * The composition root: the slices' handlers, each wrapped, subscribed and started over the resources. `main.ts` and
 * the tests call this same function, so a test runs what the app runs.
 *
 * One `pipe` per kind of handler, its wrappers listed innermost first:
 *   drizzleHandler       the read-model database as `ctx.db`, over the handling's transaction (queries and events)
 *   postgresHandler      that transaction (queries and events)
 *   validatingHandler    what goes in and comes out is checked against the descriptor
 *   correlatingHandler   what the handling births carries its correlation, causation, trace and actor (`origin`);
 *                        for an event handler, the actor is its processor: an automation acts as itself (a
 *                        projection births nothing, so only an automation's commands show it)
 *   loggingHandler       `ctx.log`, bound to the message's identity and correlation
 *   otlpHandler          a span per handling, joined to the trace the message carries, as `ctx.trace`; with no
 *                        exporter, a `ctx.trace` that records nothing (`untraced`), so code never asks if it is there
 * `otlpHandler` stamps the message, so it sits outside `correlatingHandler` and `loggingHandler`, which read it.
 */
export function app<S extends ScheduleCapableEventStore, C extends CommandBus, Q extends QueryBus>(
  { eventStore, commandBus, queryBus, tokenStore, deadLetterQueue, processing, pg, log, exporter }: Resources<S, C, Q>,
  slices: ReadonlyArray<Slice> = all,
) {
  if (!pg && slices.some((s) => s.queryHandlers?.length || s.eventHandlers?.length)) throw new Error("A query or event handler needs the read-model database: pass `pg`.")

  return kronos({
    commandHandlers: slices
      .flatMap((s) => s.commandHandlers ?? [])
      .map((h) => ({
        ...h,
        handler: pipe(
          h.handler,
          (next) => validatingHandler(next, h.descriptor),
          (next) => correlatingHandler(next, origin),
          (next) => loggingHandler(next, log),
          (next) => (exporter ? otlpHandler(next, exporter) : untraced(next)),
        ),
        eventStore,
        commandBus,
        queryBus,
      })),
    queryHandlers: slices
      .flatMap((s) => s.queryHandlers ?? [])
      .map((h) => ({
        ...h,
        handler: pipe(
          h.handler,
          (next) => drizzleHandler(next),
          (next) => postgresHandler(next, pg!),
          (next: Handler) => validatingHandler(next, h.descriptor),
          (next) => correlatingHandler(next, origin),
          (next) => loggingHandler(next, log),
          (next) => (exporter ? otlpHandler(next, exporter) : untraced(next)),
        ),
        eventStore,
        queryBus,
      })),
    eventHandlers: slices
      .flatMap((s) => s.eventHandlers ?? [])
      .map((h) => {
        const processor = h.processor(eventStore, tokenStore, processing, deadLetterQueue)
        return {
          ...h,
          handler: pipe(
            h.handler,
            (next) => drizzleHandler(next),
            (next) => postgresHandler(next, pg!),
            (next: Handler) => validatingHandler(next, h.descriptor),
            (next) => correlatingHandler(next, (m) => ({ ...messageOrigin(m), actor: processor.name, actorType: "automation" })),
            (next) => loggingHandler(next, log),
            (next) => (exporter ? otlpHandler(next, exporter) : untraced(next)),
          ),
          eventStore,
          commandBus,
          queryBus,
          processor,
        }
      }),
  })
}
