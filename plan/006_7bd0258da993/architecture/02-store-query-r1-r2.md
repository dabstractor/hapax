# Scout report — store/query R1 (series bigrams) + R2 (query-time casing resolution)

Baseline 6d8f158. All line numbers verified against working tree at scout time.

## 1. Verified anchor table

| Anchor | Claimed | Actual | Status |
|---|---|---|---|
| `Candidate` in types.ts | :18-45 | **:19-33** | corrected |
| `Successor` in types.ts | ~:125 | **:54-60** | corrected |
| `Sighting` in types.ts | — | **:36-47** | located |
| `store.upsert` | :274-293 | **:264-298** | corrected |
| `recordBigramRuns` | :536 | **:536** (method), helper `#bumpSuccessor` :573-606, `#evictBigramsIfOverCap` :619+ | exact |
| query ranking comparator | :511 / :569 | `compareRankedMatches` **:370-392**, `compareListing` **:397-404**, sort call **:602** | corrected |
| tier-1 gap-size scaling | :232-233 | **:232-233** (comment) — formula: `70 − 5·gapRuns − min(3·gapChars, 15)` | exact |
| match construction `display: c.display` | :531 | **:531** (anchored path); second site **:582** (tier-0 anchorless) | exact (two sites, not one) |
| config `maxSuggestions: 20` | :131 | **:131** (inside `DEFAULT_CONFIG`, :121) | exact |

## 2. Verbatim type quotes (src/core/types.ts)

```ts
// :19-33
export interface Candidate {
  /** lowercase */
  key: string;
  /** most recent casing seen */
  display: string;
  /** occurrences this session */
  sessionCount: number;
  /** message ordinal at last sighting */
  lastSeenOrdinal: number;
  firstSeenOrdinal: number;
  /** sticky once true */
  userTyped: boolean;
  /** capitalized-initial seen at least once */
  properName: boolean;
  /** admission group (PRD §04) */
  rankGroup: RankGroup;
}

// :36-47
export interface Sighting {
  /** lowercase key */
  key: string;
  /** casing as seen this occurrence */
  display: string;
  /** message ordinal of this occurrence */
  ordinal: number;
  /** true when the occurrence came from a user message */
  fromUser: boolean;
  properName: boolean;
  rankGroup: RankGroup;
}

// :54-60
export interface Successor {
  /** the word that followed `word` in a bigram */
  next: string;
  /** occurrences of the bigram "word next" this session */
  count: number;
}
```

RankedMatch (query output) is :165-178: `{ key, display, description, salience, sessionCount, tier? }` — the ~20 downstream consumers read `RankedMatch.display`, not `Candidate.display` directly, EXCEPT debug.ts and provider.ts:436 / widget.ts:667 which read `store.get(...)?.display` for successor-chain labels.

## 3. Store internals (src/core/store.ts)

- **upsert** (:264-298): create fills all 9 Candidate fields; merge bumps sessionCount/lastSeenOrdinal, `existing.display = sighting.display` (:291, "most recent casing wins"), sticky OR-ins for userTyped/properName, `rankGroup = min`. `Sighting.display` feeds Candidate.display here — the R1 tallies must be accumulated at these two sites (create + merge).
- **Successor index** (#successorIndex :241, `Map<string, Successor[]>`): top-3 per word, count-desc / byte-lex-asc ties (`successorBefore` :140). `#bumpSuccessor` (:573-606) bump-or-insert; on length 4 the sorted TAIL drops (strictly-better newcomer needed to displace).
- **Bigram map** (#bigrams, `Map<string, {count, lastSeenOrdinal}>`): `BIGRAM_CAP = 10_000` (:102), lazy min-heap eviction `bigramSortKey = Math.log(e.count) + e.lastSeenOrdinal/50` (:136), `BIGRAM_EVICT_BATCH = 256`, rounds repeat within a single recordBigramRuns call (BUG-006). Evicting a bigram splices it from #successorIndex via `#dropSuccessorFor` (:706-717).
- **recordBigramRuns** (:536-561): already exists (delta R1 partially landed); iterates `runs: readonly string[][]`, records every adjacent pair `key = \`${w1} ${w2}\``, then `#bumpSuccessor(w1,w2)`. Called from ingest.
- **Word-store eviction**: `STORE_CAP = 20_000` (:81), `evictIfOverCap` at tail of every upsert, lowest `evictionScore` first, `EVICT_BATCH = 256`.
- **Salience/eviction formula** (src/core/score.ts :394-402, :415-418):
  `salience = W_FREQ·log2(1+sessionCount) + W_RECENCY·e^(−Δ/RECENCY_TAU) + W_USER_TYPED·[userTyped] + W_PROPER_NAME·[properName] + rarity(rankGroup)`
  `evictionScore = salience · e^(−Δ/EVICTION_TAU=50)`
  **Nothing reads `display` for scoring.** Feeding fields: sessionCount, lastSeenOrdinal, userTyped, properName, rankGroup. Replacing display with tallies breaks nothing in score.ts. Grep confirmed `.display` in score.ts: zero hits.

## 4. Query side (src/core/query.ts, 635 lines)

- Ranking (`compareRankedMatches` :370-392): **tier desc → shorter key → sessionCount desc → byte-lex** — confirmed; salience NEVER sorts. Zero-fragment listing uses `compareListing` (:397): count desc → shorter → byte-lex.
- Exact-equal exclusion: :515 `if (k === lower) continue;` (anchored) and :560 (tier-0 parity).
- Gap-size scaling: tier-1 `70 − 5·gapRuns − min(3·gapChars, 15)` (:232-233, constants exported).
- **Match construction — TWO sites carry `display: c.display`**: :531 (anchored/gated loop) and :582 (tier-0 anchorless pass). R2's pure resolve function must be applied at BOTH. Zero-fragment listing path also flows through :531 (with `tier` omitted when `lower === ""`).
- Tier-0 anchorless: runs only when `lower !== "" && length ≥ 3 && (opts.loose || recs.length === 0)`; dedup vs anchored; fresh `sortedKeysSnapshot().slice(prefixRange(""))`.

## 5. `.display` consumer inventory (all of src/)

RankedMatch.display consumers (keep working unchanged if R2 fills `display` at :531/:582):
- src/pi/provider.ts: :604 (liveKeyByValue), :614-615 (item value/label), :670 (rec lookup by m.display)
- src/pi/widget.ts: :266, :270, :301 (line paint/truncate/accent), :667 (chain label — also `store.get(s.next)?.display`), :719, :739, :905, :1014, :1310 (insert), :1501 (signature)
- src/pi/ingest.ts:630 — `display: draft.display` (Sighting construction, upstream)

Direct `Candidate.display` readers (affected by removing/repurposing the field):
- src/core/store.ts:269, :291 (upsert writes)
- src/core/query.ts:531, :582
- src/pi/debug.ts:74, :120, :203 (/acwords dump)
- src/pi/provider.ts:436, src/pi/widget.ts:667 (successor chain label fallback `store.get(s.next)?.display ?? s.next` — R2's `nextDisplay` on Successor replaces this)
- src/core/shapeGate.ts:194 — reads `draft.display`, but that is the **Sighting/draft** display, not Candidate; unaffected by R1.

Count: ~22 sites total; the "~20" claim holds.

## 6. Config defaults (src/pi/config.ts)

`HapaxConfig` interface :61-120; `DEFAULT_CONFIG` :121-131: `triggerChar: "#"`, `threshold: 2` (inert in live editor), `maxSuggestions: 20` (schema max; terminal width is the real cap), `rejectCommonness: REJECT_COMMON_THRESHOLD` (12), `fuzzThreshold: DEFAULT_FUZZ_THRESHOLD` (60 ambient / 45 trigger via `resolveFuzzThreshold`), `menuDelayMs: 0`, `enableChaining: true`, `debug: false`. No R1/R2-relevant config keys exist yet.

## 7. Test-battery conventions (spec-of-record)

- Style: vitest `describe`/`it` with PRD spec-citation in the describe title (e.g. `describe("upsert — present → merge (PRD §06 h2.36)")` in test/store.test.ts:113). Long doc-comment header at file top citing spec sections.
- Direct store construction: `new CandidateStore()` + hand-built `Sighting` literals; assertions via `expect(s.get(k)).toEqual({ ...exact candidate literal })` — **exact-object toEqual** is the store-equality idiom (store.test.ts:86). `s.entries()` returns a defensive copy (store.test.ts:223-245) — usable for deepEqual-style full-store comparison.
- bigrams.test.ts:14-71 — pattern for recordBigramRuns suites: `s.recordBigramRuns([["a","b"],...])` then `expect(s.topSuccessors("a")).toEqual([{next,count}])`.
- helpers/ (imported by heavier suites): bench-fixtures.ts (`makeStore`, `mulberry32`, `makeSessionText`), dict-writer.ts, editor-sim.ts, query-invariants.ts, session-fixture.ts. fixtures/sessions/ holds session transcripts.
- successors.test.ts, query.test.ts, types.test.ts follow the same describe-with-spec-cite style; types.test.ts asserts type-level/doc contracts.

## 8. Branch-purity comparison options

No `serialize`/`toSnapshot`/`deepEqual` helper exists in src/. Available building blocks:
- `store.entries()` (:472 area; defensive copy array of Candidates) — `expect(a.entries()).toEqual(b.entries())` gives replay-twice / incremental-vs-snapshot equality for the word map.
- `store.sortedKeysSnapshot()` (:472) — key-set equality.
- For the bigram map and successor index there is **no public read API** beyond `topSuccessors(word)` (read-only, returns live array or shared empty). A purity test must either enumerate known words and compare `topSuccessors` per word, or R1 must add an internal/test-accessible dump (e.g. an `entries`-style defensive dump of #bigrams / #successorIndex). This is the one gap for "incremental == snapshot" assertions.
- Precedent for no-persistence discipline: test/no-persistence.test.ts greps for forbidden APIs — new dump methods must not touch fs/network.

## 9. Drift notes & open questions

- **The spec already contains series language**: spec/01-goals-and-scope.md:66-69 ("Goals — capitalized-series completion"), spec/04-tokenization-and-scoring.md:256-286 ("Capitalized runs (proper-noun series)"), spec/06-candidate-store.md:99 (series bigrams incl. chain-only members). The Delta PRD appears to be already partially written into spec/ — implementers must check spec/SPEC.md and spec/04/06 for the authoritative wording (e.g. whether "window-break rules" = the whitespace-only adjacency rule, PRD 002 §06 h3.6, encoded in ingest.ts, not store.ts — recordBigramRuns itself has no window logic; the runs arrays are pre-chunked by ingest).
- Two `display: c.display` sites in query.ts (:531 and :582), not one — R2 must patch both.
- No `series`/`nextDisplay`/`capCount`/`lowerCount`/`capDisplay` identifiers exist in src/ yet (grep clean) — all R1/R2 surface is greenfield.
- `Successor` currently has exactly `{next, count}`; adding optional `series`/`nextDisplay` is backward-compatible with the exact-`toEqual` tests (they will need updating once fields are populated).
- Chain label path `store.get(s.next)?.display ?? s.next` (provider.ts:436, widget.ts:667) is where `Successor.nextDisplay` should be consumed; both sites keep the same fallback shape.
