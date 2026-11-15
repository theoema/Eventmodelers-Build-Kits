import type { Assertion, Outcome } from "@kronos-ts/test"

// The kit's own testing convention. The grammar is @kronos-ts/test's —
// `fixture(…).given(…).when(…).then(…)` and storylines — and the app a test runs is built by `testApp` (test/).

/**
 * The command was refused with this rejection: `{ ok: false, rejection: code, ...facts }`.
 * Pass the facts too to pin them; leave them out to claim only the code.
 *
 *   .then(rejected("CART_FULL"), noEvents())
 *   .then(rejected("CART_FULL", { aggregateId, items: 3 }))
 */
export function rejected(code: string, facts?: Record<string, unknown>): Assertion {
  const check = ({ result }: Outcome) => {
    const answer = result as { ok?: unknown; rejection?: unknown } | undefined
    if (answer?.ok !== false || answer.rejection !== code) {
      throw new Error(`expected the command to be rejected with ${code}, but it answered ${JSON.stringify(result)}`)
    }
    for (const [key, value] of Object.entries(facts ?? {})) {
      const actual = (answer as Record<string, unknown>)[key]
      if (JSON.stringify(actual) !== JSON.stringify(value)) {
        throw new Error(`${code}: expected ${key} ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`)
      }
    }
  }
  return Object.assign(check, { label: `rejected ${code}` })
}
