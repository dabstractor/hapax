# Research notes — P1.M2.T5.S1 rankMatches

## Upstream contracts (verified in code, 2025-01 session)

- `src/core/store.ts` `CandidateStore`:
  - `prefixRange(prefix: string): [number, number]` — half-open range over an internal sorted key array; THROWS RangeError on non-lowercase prefix; caller must lowercased. Rebuilds lazily. "This is the ONLY binary-search surface over the store — query.ts consumes it exclusively."
  - But prefixRange returns only indices — there is no public index→key accessor. GATHERING candidates needs either keys from `sortedKeysSnapshot()` (may be stale, never rebuilds — unsafe) or `get(key)`. **Resolution: read the sorted key array inside the range.** Simplest correct option within S1's scope: derive keys via `store.sortedKeysSnapshot()` ONLY after calling `prefixRange` (which rebuilds the index, so the snapshot is fresh immediately after). That ordering is safe: prefixRange() rebuilds if dirty → sortedKeysSnapshot() returns exactly the array just binary-searched. Alternatively add a small accessor to store.ts; preferred minimal-touch approach: snapshot-after-prefixRange, documented in code.
  - `currentOrdinal(): number` read-only.
  - `get(key): Candidate | undefined`, `entries(): Candidate[]`.
- `src/core/score.ts`: `salience(c, currentOrdinal)`, `compareCandidates(a, b, currentOrdinal)` (salience desc → shorter key → byte-lex). Import from `./score.js`; never reimplement.
- `src/core/types.ts` already declares `RankedMatch { key, display, description, salience }` — query.ts must not redefine it.
- Types/TS: ESM with `.js` import specifiers, `type: module`, private fields `#x`. Tooling: `tsc --noEmit` (npm run check), vitest `--run` (npm test), `vitest bench` exists for benchmarks (perf gate testing pattern: P1.M4.T1.S2 will use bench).
- Test pattern (test/store.test.ts): vitest describe/it, fabricate inputs via a small `over: Partial<T>` helper factory, import from `../src/core/*.js`.
- Eviction (S3, parallel): may remove keys and mark index dirty. rankMatches must not assume stable indices across calls — always call prefixRange fresh each invocation (it does anyway).

## Extension hook for M2 (P2.M1.T3.S1)
Item description: "accept an optional suppression/phrase hook parameter." Design: `opts.onCandidate?` or a `suppress?: (key: string) => boolean` filter — keep it optional with default no-op so M1 signature is stable. Chosen: `opts.suppress?: (c: Candidate) => boolean` applied during gather (cheapest, before salience math).

## Performance (<1 ms on 20k store, PRD §02 h3.1)
- prefixRange is O(log n + range) after at-most-one lazy rebuild; rebuild is O(n log n) but amortized per dirtying batch, off the hot path in practice.
- For top-N selection with limit 8: full range sort is O(r log r); a partial selection (scan + insertion into a length-8 array) is O(r·8) and allocation-free — but ranges are typically small; keep it simple: sort only if range.length > some bound, else small insertion buffer. Recommended: simple threshold approach — if range length ≤ 64, insertion into fixed small array; else sort slice. Either is fine for the gate; keep code simple first, micro-optimize only with bench evidence.
- description: `'session x' + sessionCount` — PRD menu item shape (h2.44). Note item description uses lowercase 'x'; example in types.ts says "session ×12" (multiplication sign) — item description is the contract: `'session x' + sessionCount` (ASCII x). Follow the item description.

## Provider mapping (P1.M3.T3.S2) — not in scope
rankMatches returns RankedMatch[]; provider maps to AutocompleteItem { value, label, description }. value = display casing, label = display.
