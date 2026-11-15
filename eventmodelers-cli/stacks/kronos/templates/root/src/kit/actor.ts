import { type Message, type Metadata, messageOrigin } from "@kronos-ts/core"

/**
 * Who a message is from, on every message's metadata beside its correlation, causation and trace:
 * - `actor`: who, in the app's own terms (an account id, an automation's name);
 * - `actorType`: what kind of who. `user` (signed in), `anonymous` (not signed in), `automation` (one of the app's own
 *   processors, acting as itself), `system` (nothing outside asked: a spec, a script), or any kind the app adds
 *   (`service`, `admin`, …).
 *
 * The edge stamps it on the request's message (from `identify`), and a handling carries it onto everything it births,
 * so a command's events say who sent the command. An automation is an actor of its own: what it sends carries its
 * name, not the actor of the event it reacted to. Whoever started the chain stays one hop away, through the
 * correlation id, so an authorization check never mistakes an automation's command for the user's.
 */
export type Actor = { readonly actor: string; readonly actorType: string }

export const ANONYMOUS: Actor = { actor: "anonymous", actorType: "anonymous" }
export const SYSTEM: Actor = { actor: "system", actorType: "system" }

/** The actor a message is from: its own, else `system` (a chain nothing outside started). */
export function actorOf(metadata: Metadata): Actor {
  const { actor, actorType } = metadata
  return typeof actor === "string" && typeof actorType === "string" ? { actor, actorType } : SYSTEM
}

/**
 * What jumps from a handled command or query onto everything its handling births (`correlatingHandler`'s cargo):
 * core's correlation, causation and trace, and the message's actor.
 */
export const origin = (message: Message): Metadata => ({ ...messageOrigin(message), ...actorOf(message.metadata) })
