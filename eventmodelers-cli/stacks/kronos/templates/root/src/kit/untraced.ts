import { inertTrace } from "@kronos-ts/otlp"

/**
 * Without an exporter: a `ctx.trace` that records nothing, in `otlpHandler`'s place, so an outside client always has a
 * trace to run its call in and code never asks if it is there. Typed as `otlpHandler` is, so either fits the same
 * handlers.
 */
export const untraced =
  <M, C, R>(next: (message: M, context: C) => R) =>
  (message: M, context: Omit<C, "trace">): R =>
    next(message, { ...context, trace: inertTrace } as C)
