import type {
  CommandHandlerContext,
  EventHandlerContext,
  LogCapability,
  QueryHandlerContext,
  ScheduleCapableEventStore,
  SubscriptionCapableQueryBus,
} from "@kronos-ts/core"
import type { TraceCapability } from "@kronos-ts/otlp"
import type { PostgresCapability } from "@kronos-ts/postgres"
import type { DrizzleCapability } from "./drizzle"

// What each kind of handler is handed. Add a capability here and no handler is edited.

/** A command handling: load / append / send / query / schedule, `log` and `trace`. Decisions never touch tables. */
export type CommandContext = CommandHandlerContext<ScheduleCapableEventStore, SubscriptionCapableQueryBus> &
  LogCapability &
  TraceCapability

/** A query handling: its read model through `db`, `log` and `trace`. */
export type QueryContext = QueryHandlerContext & PostgresCapability & DrizzleCapability & LogCapability & TraceCapability

/** An event handling (a projection or an automation): send / query / schedule, `db`, `log` and `trace`. */
export type EventContext = EventHandlerContext<ScheduleCapableEventStore, SubscriptionCapableQueryBus> &
  PostgresCapability &
  DrizzleCapability &
  LogCapability &
  TraceCapability

/**
 * What an outside client is handed with every call: the handling's trace and log. The handler passes its own `ctx`.
 * The client runs its call in a child span, `ctx.trace.run("<client>.<call>", (span) => …)`, and puts
 * `span.traceparent` on the request, so the trace goes on into the system it calls. Without an exporter the trace
 * records nothing, and the client is written the same.
 */
export type ClientContext = LogCapability & TraceCapability
