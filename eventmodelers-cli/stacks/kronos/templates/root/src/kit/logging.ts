import type { Logger } from "@kronos-ts/core"

/** One logger writing to several: the console, and the OTLP exporter when there is one. */
export function both(...loggers: ReadonlyArray<Logger>): Logger {
  return {
    debug: (message, fields) => loggers.forEach((l) => l.debug(message, fields)),
    info: (message, fields) => loggers.forEach((l) => l.info(message, fields)),
    warn: (message, fields) => loggers.forEach((l) => l.warn(message, fields)),
    error: (message, fields) => loggers.forEach((l) => l.error(message, fields)),
    with: (fields) => both(...loggers.map((l) => l.with(fields))),
  }
}
