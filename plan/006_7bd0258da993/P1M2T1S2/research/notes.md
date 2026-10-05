# Research notes — plan 006 P1.M2.T1.S2: wire resolver at both construction sites; remove Candidate.display

## Upstream contract (P1.M2.T1.S1, implementing in parallel — assume delivered)
- `resolveCompletionCasing(c: Pick<Candidate,"key"|"capCount"|"lowerCount"|"capDisplay">, fragmentFirstLetter: string): string` exported from src/core/query.ts, unconsumed. Rules: uppercase first letter → capDisplay (or capitalize-key fallback, never ""); lowercase/zero/non-letter → frequency branch (capCount>lowerCount → capDisplay; else key). Only the first letter is adapted; the winning form's spelling wins wholesale. capDisplay "" = no-valid-cap-sighting sentinel.
- S1's battery in test/query.test.ts pins both branches incl. the path-under-uppercase nuance ('S'+'src/core/query.ts' → 'Src/core/query.ts' is CORRECT).

## Verified current code (grep, store.ts / 02-store-query-r1-r2.md §4–§5)
- TWO RankedMatch.display construction sites in query.ts: **:531** (anchored/gated loop; zero-fragment listing also flows here, tier omitted when fragment empty) and **:582** (tier-0 anchorless pass) — both `display: c.display`.
- Candidate.display writes in store.ts upsert: create ~:304 (`display: sighting.display`) and merge ~:333 (`existing.display = sighting.display` — "most recent wins"). Tally fields (capDisplay etc.) already land (P1.M1.T2.S1); display is TEMPORARY legacy.
- ~20 RankedMatch.display consumers (keep UNCHANGED — they read the resolved string): provider.ts :604/:614-615/:670; widget.ts :266/:270/:301/:719/:739/:905/:1014/:1310/:1501.
- Direct Candidate.display readers needing migration: store.ts :269/:291 (upsert writes, REMOVE); query.ts :531/:582 (RESOLVE); debug.ts :74/:120/:203 (interim `capDisplay ?? key` — full treatment P1.M2.T3.S1); provider.ts :436 + widget.ts :667 (successor label fallback `store.get(s.next)?.display ?? s.next` → interim `c?.capDisplay ?? s.next` — replaced by Successor.nextDisplay logic in P1.M2.T2.S1/S2).
- ingest.ts :630 `display: draft.display` constructs the SIGHTING — Sighting.display STAYS (it feeds the tallies/capDisplay via upsert); only Candidate.display dies.
- score.ts reads no display (grep: zero hits) — removal is scoring-safe.

## The casing-thread subtlety (the one real design point)
- rankMatches lowercases the fragment internally; the resolver needs the LIVE fragment's ORIGINAL first-letter casing (spec h2.32: "typed fragment begins with an uppercase letter"). Options: (a) capture `const rawFirst = fragment.charAt(0)` BEFORE lowercasing at the top of rankMatches and thread it to both construction sites; (b) have callers pass raw. Choose (a) — no signature churn; PRD h2.32 says "menu labels use the same resolution against the live fragment's first letter", and Tab-insert reads the live synchronous result (invariant 2) so query-time resolution satisfies "resolved at completion time".
- Zero-fragment ('#'-alone listing): rawFirst = '' → resolver's frequency branch — correct per spec (listing has no typed letter to preserve).

## Ranking untouched
- compareRankedMatches :370–392 (tier → length → count → lex) and exact-equal exclusion unchanged — this task only changes which string fills `display`.

## Test conventions (02 doc §7)
- describe titles cite spec ("PRD §04 h2.32"); store tests use EXACT-object toEqual on `s.get(k)` — removing `display` means updating every exact candidate literal in store.test.ts (grep `display:` there). Query battery uses makeStore fixtures (test/helpers/bench-fixtures.ts) or hand-built candidates. types.test.ts asserts doc contracts — update the Candidate doc-string pin if it enumerates fields.

## Commands
- npm run check; npx vitest --run test/query.test.ts test/store.test.ts test/debug.test.ts test/provider.test.ts test/widget.test.ts -v; npm test.
