/**
 * Faithful pi-tui editor simulation (BUG-002 regression support,
 * P1.M4.T1.S1; reused by P1.M5.T1.S1 typing-path probes).
 *
 * `editorApplyCompletion` mirrors pi-tui's AutocompleteProvider
 * applyCompletion deletion math EXACTLY (pi-tui
 * dist/autocomplete.js applyCompletion, ~L265-267):
 *
 *   const beforePrefix   = currentLine.slice(0, cursorCol - prefix.length);
 *   const afterCursor    = currentLine.slice(cursorCol);
 *   return beforePrefix + item.value + afterCursor   // (+ quote tweaks)
 *
 * There is NO re-verification: pi-tui deletes exactly `prefix.length`
 * characters before the cursor and splices the item value in, trusting the
 * provider's `prefix` verbatim. That blindness is what BUG-002 exploited —
 * a provider that returns a prefix that is NOT the exact suffix of the
 * line at the cursor destroys typed text ("zep" + stale prefix "ze" +
 * item "Zendesk" → "zZendesk", the PRD's "zzendesk"-class corruption).
 * The provider-side hard invariant (never return a non-suffix prefix) is
 * the ONLY defense; this helper exists so tests can prove compliance
 * through pi's real math instead of hapax-shaped mocks that model no
 * deletion at all (the gap that let the bug escape).
 *
 * Scope note: the real autocomplete.js also adjusts the after-cursor span
 * for QUOTED prefixes ('"'/'@"' + trailing quote in the item). Hapax
 * prefixes never take that branch in the scenarios under test (trigger
 * char "#" / bare fragments), and modeling it here would blur the
 * invariant being pinned — the blind prefix.length deletion. Deliberately
 * omitted; revisit only if a quoted-trigger acceptance case ever lands.
 *
 * Test-only code: dependency-free, exported for cross-suite reuse
 * (convention: see test/helpers/dict-writer.ts).
 */

/**
 * Apply `itemValue` at `cursorCol` of `line` the way pi-tui does: delete
 * exactly `prefix.length` chars before the cursor, splice the value in.
 * No validation of any kind — caller must guarantee
 * `line.slice(0, cursorCol).endsWith(prefix)` (the provider invariant) or
 * the result models the corruption pi would really produce.
 */
export function editorApplyCompletion(
  line: string,
  cursorCol: number,
  itemValue: string,
  prefix: string,
): string {
  const before = line.slice(0, cursorCol - prefix.length);
  const after = line.slice(cursorCol);
  return before + itemValue + after;
}

/**
 * The invariant pi-tui implicitly relies on: the provider's returned
 * prefix must be the EXACT suffix of the line text at the cursor. Exported
 * so regression tests assert the contract, not just one corruption string.
 */
export function prefixIsAnchorSafe(
  line: string,
  cursorCol: number,
  prefix: string,
): boolean {
  return cursorCol >= 0 && line.slice(0, cursorCol).endsWith(prefix);
}