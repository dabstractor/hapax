/**
 * Reusable query-result invariant assertions (PRD 002 delta R1).
 *
 * `assertWordsOnly` pins the ONE-WORD INVARIANT (PRD §07 h2.44): every
 * menu item's display is exactly one word — no multi-word candidates,
 * ever; the only successor behavior is provider-side chaining. Consumed
 * by test/query.test.ts today and by the P1.M2.T1.S2 chain tests
 * tomorrow; keep it here (not inline in a suite) so every ranker-
 * consuming test asserts the same gate the same way.
 *
 * Importing vitest from a helper is fine: test/ is type-checked by
 * `npm run check` and vitest is a devDependency.
 */

import { expect } from "vitest";
import type { RankedMatch } from "../../src/core/types.js";

/**
 * Assert every match's display contains no space — i.e. it is a single
 * word. Fails with the supplied `label` (e.g. the queried prefix) and
 * the offending display so the violating fixture is identifiable.
 *
 * @param matches any rankMatches result (read-only view is enough)
 * @param label optional context prefix for the failure message
 */
export function assertWordsOnly(
  matches: ReadonlyArray<RankedMatch>,
  label = "",
): void {
  for (const m of matches) {
    expect(
      m.display,
      `${label ? label + ": " : ""}multi-word display violates the one-word invariant (PRD §07 h2.44)`,
    ).not.toContain(" ");
  }
}