# R3 — anchored-fuzzy matching, tier→sessionCount ranking, fuzzThreshold

Research report (read-only). All file:line references verified against the working tree.

## 1. Current matcher API (src/core/query.ts)

Exports (whole module is 176 lines):
- `export const DEFAULT_LIMIT = 8;` (query.ts:59)
- `export interface RankOptions { limit?: number }` (query.ts:62-65) — the entire option surface after R1 removed the multi-word layer.
- `export function compareRankedMatches(a: RankedMatch, b: RankedMatch): number` (query.ts:73-78):
  ```ts
  if (a.key.length !== b.key.length) return a.key.length - b.key.length;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  ```
- `export function rankMatches(store: CandidateStore, prefix: string, opts: RankOptions = {}): RankedMatch[]` (query.ts:98).

Prefix matching happens **implicitly via the store's sorted index**: query.ts never does its own string compare; it lowercases the fragment (`query.ts:104`), calls `store.prefixRange(lower)` (query.ts:107), and slices the snapshot (query.ts:108). Case handling: prefix lowercased BEFORE prefixRange because prefixRange throws `RangeError` on uppercase (store.ts:453-455); results keep the stored display casing (`display: c.display`, query.ts:115).

Result item shape (types.ts `RankedMatch`, exactly four fields — pinned by test/query.test.ts:167-178):
```ts
{ key: string; display: string; description: `session x${sessionCount}`; salience: number }
```
(description built at query.ts:116, salience = exact unquantized `salience(c, ordinal)` at query.ts:117.)

Sole production caller: `src/pi/provider.ts:47` imports; `provider.ts:583`:
```ts
const matches = rankMatches(store, state.fragment, { limit: config.maxSuggestions });
```

## 2. Current ranking

- Comparator: `compareRankedMatches` — shorter key → byte-lex; **salience deliberately never sorts** (module doc query.ts:14-24; tests "ordering (content-derived)" block, query.test.ts:181-257).
- Content-derived ordering: length then ASCII byte order; the 2026-09 design. (This is what R3 retires per spec/04:439-487.)
- Plural pruning: query.ts:131-149 — after the sort, before the limit slice. Exact single-"s" pairs in the SAME result set; guards: `!m.key.endsWith("ss")`, singular must be in `keySet`, `es`/`ies`/filename shapes out of scope. `.slice(0, limit)` applied to the filtered array (query.ts:144-148).
- maxSuggestions flow: `DEFAULT_LIMIT` 8 default; `limit <= 0 → []` (query.ts:103); provider passes `config.maxSuggestions` (provider.ts:583-585).
- Zero-fragment (`#` alone): no special case today — `rankMatches(store, "")` hits `prefixRange("")` → `[0, n]` (store.ts:458) so the ENTIRE store is ranked; at 20k that's the whole-index sort. The provider's armed-chain zero-char offer is a separate path (provider.ts:~500, `topSuccessors`), not query.ts.

## 3. Store scan entry

- `prefixRange(prefix: string): [number, number]` (store.ts:452-463). Consolidates first if `#pending.length !== 0 || this.#tombstones !== 0` (store.ts:455-457) — the amortized INDEX_MERGE_BATCH consolidation (store.ts:440-446). `start = CandidateStore.lowerBound(this.#sortedKeys, prefix)` (binary search, store.ts:460); `end` by forward `startsWith` scan (store.ts:461-462).
- Sorted-index assumption: `#sortedKeys` is sorted lexicographically (lowercase keys); `prefixRange` is "the ONLY binary-search surface over the store — query.ts consumes it exclusively" (store.ts:458-459 doc).
- Query drives the scan: prefixRange FIRST (triggers consolidation), THEN `sortedKeysSnapshot().slice(start, end)` (query.ts:107-108) — ordering invariant documented at query.ts:36-48 (snapshot alone can lag: pending inserts missing, evicted ghosts present; `store.get(k)` undefined check at query.ts:113 skips ghosts).
- First-char range generalization: `prefixRange(f[0])` (single char) returns exactly the first-char bucket spec/06:30-31 describes. The sorted-index entry point is fully preserved — lowerBound on a 1-char prefix is the same binary search; the difference is the range is ~n/26 instead of a narrow prefix range, and each candidate then needs a fuzzy subsequence test instead of the index's implicit `startsWith`. Note: `end` scan is still O(range); for a 20k store that's ~770 keys scanned per keystroke (matches the perf-sanity fixture distribution, query.test.ts:358-364).

## 4. Config surface — fuzzThreshold pattern

Precedent: `rejectCommonness` (src/pi/config.ts):
1. Constant lives baked in a core module: `REJECT_COMMON_THRESHOLD` imported from `../core/score.js` (config.ts:39). For fuzzThreshold the analogue is a constant in `src/core/query.ts` (e.g. `DEFAULT_FUZZ_THRESHOLD = 60`), exported like `DEFAULT_LIMIT`.
2. Field on `HapaxConfig` interface (config.ts:64 pattern) with doc comment.
3. Default in `DEFAULT_CONFIG` (config.ts:91): `rejectCommonness: REJECT_COMMON_THRESHOLD` → `fuzzThreshold: DEFAULT_FUZZ_THRESHOLD`.
4. Layer application in `applyLayer` (config.ts:239-248 pattern):
   ```ts
   if ("rejectCommonness" in raw) {
     const v = raw.rejectCommonness;
     if (typeof v === "number") next.rejectCommonness = clampNumber(v, 1, 255);
     else notify(`... invalid ... using ${formatValue(...)}`, "warning");
   }
   ```
   → fuzzThreshold: `clampNumber(v, 0, 100)` per spec/08:67. Numbers out of range clamp silently (clamp, not repair — config.ts:107-111); wrong type repairs with one warning.
5. Test coverage shape (test/config.test.ts): defaults asserted via `DEFAULT_CONFIG.rejectCommonness` (config.test.ts:96), layer-override values (config.test.ts:134,147), clamping bounds, invalid-type repair-with-warning. Same five assertions for fuzzThreshold (0–100 clamp; 100 = exact-prefix-only).
6. Spec 08 already specifies the key: `"fuzzThreshold": 60, // 0–100: minimum anchored-fuzzy match score` (spec/08-configuration.md:38,66-67) and names it one of the two deliberate config exceptions (08:81-87).

## 5. Provider chain successor filtering

Armed-branch call site (provider.ts:~516-519):
```ts
const succ = ... store.topSuccessors(armed.word)
  .filter((s) => s.next.startsWith(frag.toLowerCase()))
  .slice(0, config.maxSuggestions);
```
This is the exact filter that must re-point from `startsWith` to fuzzy membership (same anchored-fuzzy predicate + fuzzThreshold, or the chain's threshold-0 semantics per R3 scope — confirm with parent). "Ranking within a chain stays successor-count-based" means today: `topSuccessors(word)` returns successors ordered by the successor index's count (store-side, spec 06 successor index), the provider does NOT re-sort — only filters + slices. That behavior is unchanged by R3.

Also note provider.ts:603 comment (mentions old salience-desc order) and query.test.ts oracle `expectedOrder` (query.test.ts:66-79) — both will need updating, not just query.ts.

## 6. Perf

- Bench: `test/bench/core.bench.ts` (vitest bench via `npm run bench`, package.json `"bench": "vitest bench"`). Gate a (core.bench.ts:56-61): `rankMatches(gateAStore, "co", { limit: 8 })` on a 20k store, prefix "co" ~150-candidate hot range, budget <1 ms p99.
- Hard assertion: `test/perf-gates.test.ts:70-99` — p99 of 1000 queries over the ~150-candidate hot range must stay < 3 ms (CI rule = 3× the 1 ms budget); gate a2 (perf-gates.test.ts:114-115) covers the cold first query (consolidation) also < 3 ms. Informal sanity in query.test.ts:353-375 (1000 queries < 1000 ms total, ~770-key "qz" range).
- Sorted-index preservation: yes — `prefixRange(f[0])` uses the identical lowerBound binary search (store.ts:460); no store change required for the scan entry. The fuzzy subsequence test is O(len(c)) per candidate over ~n/26 candidates; at 20k that is ~770 × short-string scans plus a sort of admitted matches — plausibly within the existing 3× CI headroom, but the current hot-range gate (~150 candidates) understates the new ~770-candidate scan; the gate fixture/prefix may need re-basing (bench-fixtures `HOT_PREFIX = "co"` chosen for a ~150 range, core.bench.ts:32).

## 7. Feasibility of the R3 spec (spec/04:390-510)

All feasible against the current code:

- **First-char anchor + anchored subsequence** — trivial once the scan range is `prefixRange(f[0])`; greedy leftmost subsequence of `f[1..]` in `c[1..]` is a single two-pointer pass. `esk` → `zendesk` correctly never matches (anchor fails). ✔
- **Tiers 3/2/1** — tier 3 = the old `startsWith` (now one of three predicates, not the index filter); tier 2 = contiguous occurrence of `f[1..]` in `c[1..]` (findable during the same pass, or `c.indexOf(f.slice(1), 1)`); tier 1 = fallback. ✔
- **Scores** — integer math, all inputs available (`len(c)`, charsSkippedBeforeRun from the tier-2 match position, gapRuns/gapChars from the tier-1 greedy trace). Score is admission-only (compare to fuzzThreshold before building RankedMatch). ✔
- **fuzzThreshold discard BEFORE ranking** — natural placement: inside the candidate loop (query.ts:110-119), skip candidates below threshold so they never enter `matches`. Note tier 1 max score is 50 (`50 − 5·gapRuns − min(gapChars,15)` ≤ 50) — with the default 60 ALL scattered matches are gated out; only tier 2 tails ≥60 and tier 3 survive at default. That is consistent with spec/04:429-434 ("gates out most scattered matches"). ✔
- **Ranking tier desc → sessionCount desc → shorter key → byte-lex** — rewrite `compareRankedMatches` to a 4-key comparator; `sessionCount` must ride on RankedMatch (new field or replace salience in the item contract — spec says "only its raw sessionCount component… orders anything", 04:487). The description already embeds it as text; add a numeric field. Comparator must be a valid total order (sessionCount ties fall through to length/lex). ✔ — but see risks.
- **Zero-fragment listing** — `""` case: no anchor (f[0] undefined) → no tiers, sort whole store by sessionCount desc then rules 3-4. Perf note: current `prefixRange("")` already ranks the whole store, so no new worst case; but at cap 20k a full sort per `#` keystroke deserves a bench check (gate a only tests a hot range). ✔
- **Plural pruning before limit slice** — already exactly that (query.ts:131-149); unchanged by R3 (prune after sort, before slice; tier placement irrelevant to the rule). ✔
- **fuzzThreshold 100 = exact-prefix-only** — falls out: tier 3 scores 100 ≥ 100 passes; tiers 2/1 max 85 < 100 all discard. ✔ (Edge: clamp range 0–100 inclusive; threshold 0 admits everything.)

## 8. Recommended signatures + risks

```ts
// src/core/query.ts
export const DEFAULT_FUZZ_THRESHOLD = 60;

export interface MatchResult { tier: 1 | 2 | 3; score: number; /* + trace */ }
export function matchFragment(f: string, c: string): MatchResult | null; // lowercase both; anchor + subsequence + tier + score

export interface RankOptions { limit?: number; fuzzThreshold?: number; } // default DEFAULT_FUZZ_THRESHOLD

export function compareRankedMatches(a: RankedMatch, b: RankedMatch): number;
// tier desc → sessionCount desc → key.length → byte-lex

// rankMatches(store, fragment, opts) — signature unchanged; internally:
//   const [start, end] = fragment ? store.prefixRange(fragment[0].toLowerCase())
//                                 : store.prefixRange("");
```

Risks:
1. **Item contract churn**: RankedMatch gains `sessionCount` (and plausibly tier/score); the "exactly four fields" test (query.test.ts:167-178) and provider's item mapping (provider.ts:626-630) must be updated in lockstep. Whether salience stays on the item is an open question (spec: salience never orders; it may still be carried for diagnostics).
2. **Test-suite rewrite scale**: the entire ordering block (query.test.ts:181-257), the oracle `expectedOrder` (66-79), plural-pruning tests (they assume length-first order for the "slot freed" case, 322-333), and limit tests (295-310 keys engineered for length order) all encode the retired order. This is the bulk of the R3 diff, not query.ts itself.
3. **Perf gate realism**: first-char range ≈ n/26 vs today's ~150-key hot range; gate a fixture should be re-based or a fuzzy-specific gate added before trusting the <1 ms p99. Gate a2 (cold consolidation) unaffected.
4. **Chain successor filter** (provider.ts:519 `startsWith`) must switch to the same matcher — behavior spec for chains under fuzzy (does fuzzThreshold apply at chain threshold 0?) needs an explicit decision; spec 04 says "Under the trigger char, same rules" but the armed chain is a different path.
5. **Default 60 kills all tier-1 matches** (max score 50) — intended per spec, but worth a spec-quoted test so it can't silently regress; also `zsk`→`zendesk` ≈ 62 passes only barely (any len(c) growth drops it below 60).
6. **Zero-fragment full-store sort** at 20k on every `#` keystroke — currently unmeasured by any gate.
