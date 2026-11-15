import { expect, it } from "bun:test"
import type { Message } from "@kronos-ts/core"
import { actorOf, origin } from "./actor"

const message = (metadata: Record<string, unknown>) =>
  ({ identifier: "m-2", metadata: { correlationId: "c-1", ...metadata } }) as unknown as Message

it("carries the actor beside the correlation, causation and trace", () => {
  expect(origin(message({ actor: "member-1", actorType: "user", traceparent: "00-a-b-01" }))).toEqual({
    correlationId: "c-1",
    causationId: "m-2",
    traceparent: "00-a-b-01",
    actor: "member-1",
    actorType: "user",
  })
})

it("names a chain nothing outside started as the system's, so every message has an actor", () => {
  expect(origin(message({}))).toMatchObject({ actor: "system", actorType: "system" })
  // Half an actor is none: an actor is always both who and what kind of who.
  expect(actorOf({ actor: "member-1" })).toEqual({ actor: "system", actorType: "system" })
})
