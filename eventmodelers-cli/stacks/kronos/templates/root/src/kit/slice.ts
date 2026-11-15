import type {
  CommandHandler,
  EventHandler,
  EventProcessor,
  EventStore,
  QueryHandler,
  SequencedDeadLetterQueue,
  TokenStore,
  UnitOfWork,
} from "@kronos-ts/core"
import type { AnyRouter } from "@orpc/server"

/**
 * A slice's processor, described but not built: `app()` hands it the shared resources, in this order. Generic over the
 * log, so the processor reads it with its own type and the app reports it that way.
 *
 *   const processor: PartialProcessor = (eventStore, tokenStore, unitOfWork) =>
 *     batched(eventProcessor("cart-items", eventStore, tokenStore, unitOfWork), 100)
 */
export type PartialProcessor = <S extends EventStore>(
  eventStore: S,
  tokenStore: TokenStore,
  unitOfWork: () => UnitOfWork,
  deadLetterQueue: SequencedDeadLetterQueue,
) => EventProcessor<UnitOfWork, S>

// The one `any` of the kit: each handler names its own payload, result and context (CommandContext, …), and a
// function is contravariant in what it takes, so no narrower type admits them all.
type Some = any

/** A slice is plain data: `export const addItem = { router, statuses, commandHandlers: [handle] } satisfies Slice`. */
export type Slice = {
  readonly commandHandlers?: ReadonlyArray<CommandHandler<Some, Some, Some>>
  readonly queryHandlers?: ReadonlyArray<QueryHandler<Some, Some, Some>>
  /** Projections and automations alike, each on its slice's processor. */
  readonly eventHandlers?: ReadonlyArray<EventHandler<Some, Some> & { readonly processor: PartialProcessor }>
  /** Its procedures, keyed by name; the app's router is every slice's, merged. */
  readonly router?: Readonly<Record<string, AnyRouter>>
  /** HTTP only: the status each of its rejections answers with (`statusesOf`). */
  readonly statuses?: Readonly<Record<string, number>>
}
