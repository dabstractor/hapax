# Research notes — P1.M2.T1.S2 (subword splitting + normalization)

## Upstream contract (P1.M2.T1.S1, from its PRP)
- `src/core/segment.ts` exports `tokenize(text: string): RawToken[]` (to be implemented per S1 PRP).
- `RawToken = { raw: string; hexish: boolean }` lives in `src/core/types.ts` (added by S1).
- Hexish tokens are opaque: S2 must NOT subword-split them (see S1 PRP JSDoc: "Hexish tokens are opaque — subword splitting (S2) skips them"). Whole hexish token still emitted as a candidate.
- Base tokens: ASCII `[A-Za-z][A-Za-z0-9_]{0,63}`, length 2–64.

## Downstream consumers
- shapeGate (P1.M2.T2.*) filters `CandidateDraft[]` (whole 4–64, subwords 4–32).
- score.ts (P1.M2.T3.S1) admission bands 220/120, subword clamp ≤ parent group + 1 — needs `isSubword` and `parentKey`.
- architecture/core_contracts.md §"Sighting shape" matches item contract exactly: `{ key, display, ordinal, fromUser, properName, rankGroup, isSubword, parentKey? }`. Segment stage supplies key/display/properName/isSubword/parentKey; ordinal/fromUser/rankGroup come later.

## Naming decision (conflict resolved)
- architecture doc mentions `segment(text) → SegToken[] { key, display, properName, isSubword, wholeKey? }` — BUT the work item contract (authoritative, newer) specifies `expandCandidates(token: RawToken): CandidateDraft[]` with `parentKey` (not `wholeKey`). Follow the item contract. Export `CandidateDraft` type **from segment.ts** (explicit instruction: do not move to types.ts without updating consumers). Types.ts already has `Candidate`/`Sighting` — do not duplicate.

## camelCase splitting algorithm (chosen)
Standard boundary scan: split before an uppercase char when (a) previous char is lowercase/digit (lower→upper: `fixR`→`fix|R`), or (b) previous is uppercase AND next is lowercase (acronym-lower: `HTTPServer`→`HTTP|Server`). Digits don't force splits (`utf8Reader` → `utf8|Reader`? boundary at R via rule a — correct). Underscores split first; camel-split within each `_` segment; empty segments dropped (`__init__` → `init`).

## PRD test cases (§09)
- `fixRoundingError` → whole + `Rounding` + `Error` (`fix` dropped, <4).
- `HTTPServer` → whole + `HTTP` + `Server`.
- `session_token_valid` → whole + `session` + `token` + `valid`.
- Keys lowercase; display = casing of this sighting; properName = first char uppercase.

## Tooling
- `npm run check` = tsc --noEmit; `npm test` = vitest --run. Test dir is flat `test/`, ESM with `.js` import extensions (see test/dictionary.test.ts).