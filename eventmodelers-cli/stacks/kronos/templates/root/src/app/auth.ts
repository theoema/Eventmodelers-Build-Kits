import type { Actor, Edge } from "#kit"
import { ORPCError, os } from "@orpc/server"

// Where the app decides who is asking and who may call what. The kit decides neither: it gives every request an actor
// (from `identify`) and carries it onto every message, and leaves the rules to the app. Fill these in for yours.

/**
 * Who is asking, from the request: `{ actor, actorType }`, or nothing for an anonymous caller. `main.ts` gives it to
 * `serve`, which stamps the answer on the request's message; it is carried from there onto everything that message
 * causes. Until it reads something (a session cookie looked up in a sessions view, a bearer token verified), every
 * request is anonymous. A header the client sets is never an identity on its own.
 *
 *   const session = await sessions.find(cookieOf(request, "session"))
 *   return session ? { actor: session.accountId, actorType: "user" } : undefined
 */
export async function identify(_request: Request): Promise<Actor | undefined> {
  return undefined
}

/**
 * For a procedure only a signed-in caller may use: `impl.account.use(signedIn).handler(…)`, or `implement(contract)
 * .$context<Edge>().use(signedIn)` for every procedure of a slice. Anyone else is answered 401, as the edge's
 * `/problems/unauthorized`. A caller who is signed in but may not do this is a `FORBIDDEN` (403) from a middleware of
 * the app's own; a rule about the data ("only the owner may…") is a rejection in the slice, from the board.
 */
export const signedIn = os.$context<Edge>().middleware(({ context, next }) => {
  if (context.actorType !== "user") throw new ORPCError("UNAUTHORIZED")
  return next()
})
