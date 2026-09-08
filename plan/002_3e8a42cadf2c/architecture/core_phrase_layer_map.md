# Core phrase/successor layer map (read-only recon, PRD 002)

## Deletion inventory (store.ts, src/core/store.ts)

### Module-level helpers/constants
| Symbol | Lines | Notes |
|---|---|---|
| `const PHRASE_CAP = 10_000` | 98–99 | phrase map hard cap |
| `const PHRASE_EVICT_BATCH = 256` | 106–112 | phrase eviction batch |
| `function phraseSortKey(p: PhraseEntry): number` | 121–127 | log-domain eviction key `log(count) + lastSeenOrdinal/50` |
| `type EvictNode = { k: number; key: string }` | 143–147 | heap node |
| `function evictNodeBefore(a,b)` | 150–156 | heap comparator |
| `function heapPush(heap, node): void` | 159–171 | min-heap push |
| `function heapPop(heap): EvictNode \| undefined` | 174–196 | min-heap pop |

`successorBefore(a,b)` (lines 129–135) and `NO_SUCCESSORS` (line 199) are **successor-layer — KEEP**.

### CandidateStore fields
| Field | Line |
|---|---|
| `#phrases = new Map<string, PhraseEntry>()` | 213 |
| `#phraseCandidates = new Set<string>()` | 218 |
| `#phraseEvictHeap: EvictNode[] \| null = null` | 230 |
| `#fastPathAdmitted = new Set<string>()` | 235 |
| `#successorIndex = new Map<string, Successor[]>()` | 225 — **KEEP** |

### CandidateStore methods — DELETE
| Method (exact signature) | Lines |
|---|---|
| `recordPhraseLines(lines: readonly string[][], ordinal: number): void` | 445–481 |
| `#upsertPhrase(key: string, ordinal: number, w1?: string, w2?: string): void` | 484–526 |
| `#admitPhrase(key: string, entry: PhraseEntry): void` | 578–603 |
| `#firstSightFastPathEligible(key: string): boolean` | 609–625 |
| `#evictPhrasesIfOverCap(): void` | 655–709 |
| `#rebuildPhraseHeap(): EvictNode[]` | 714–738 |
| `setPhraseSticky(key: string): void` | 763–766 |
| `isPhraseCandidate(key: string): boolean` | 774–777 |
| `phraseCandidateKeys(): string[]` | 781–784 |
| `isFastPathPhrase(key: string): boolean` | 790–793 |
| `removePhraseCandidacy(key: string): void` | 800–803 |
| `sweepPhraseDemotions(): number` (40-ordinal demotion sweep) | 825–841 |
| `getPhrase(key: string): PhraseEntry \| undefined` | 844–848 |
| `get phraseSize(): number` | 861–864 |
| `phraseEntries(): PhraseEntry[]` | 868–871 |
| `iteratePhrases(): IterableIterator<PhraseEntry>` | 878–880 |

Also: `PhraseEntry` import in store.ts header (line ~79), and the large phrase/successor sections of the class doc comment (lines 44–71).

### CandidateStore methods — KEEP (successor layer)
| Method | Lines | Notes |
|---|---|---|
| `#bumpSuccessor(w1: string, w2: string): void` | 528–575 | bounded top-3 array, count-desc / byte-lex; **currently private, called only from #upsertPhrase — must become the new bigram recording path (re-pointed public method)** |
| `#dropSuccessorFor(key: string): void` | 748–758 | bigram eviction cleanup; **currently private, called only from #evictPhrasesIfOverCap — re-point to whatever evicts bigrams after refactor** |
| `topSuccessors(word: string): readonly Successor[]` | 856–859 | O(1) read; returns live array or `NO_SUCCESSORS` |

Key structural answers:
- **Successor index**: `Map<string, Successor[]>` where `Successor = { next: string; count: number }`; ≤3 per word, sorted count-desc with byte-lex ties (`successorBefore`).
- **Bigram recording today**: `recordPhraseLines` → `#upsertPhrase(key, ordinal, w1, w2)` → `#bumpSuccessor(w1, w2)` on every bigram (create and merge). Trigrams pass no w1/w2.
- **Phrase cap**: `PHRASE_CAP = 10_000`, eviction via lazy min-heap `#phraseEvictHeap`, batch `PHRASE_EVICT_BATCH = 256`, sticky excluded from victim pool (hard cap beats protection), `#dropSuccessorFor` splices evicted bigrams from the successor index.
- **Word cap**: `STORE_CAP = 20_000`, `EVICT_BATCH = 256`, `evictIfOverCap()` (lines 329–372) snapshot-sort via `evictionScore` — word layer, KEEP; does NOT touch successors today.
- **Bigram eviction splice exists today** but only via the *phrase* eviction path. If the refactor records bigrams without a PhraseEntry map, successor cleanup must be re-pointed (new work) or bigrams become unbounded.

## types.ts (src/core/types.ts, 138 lines)

Exported types: `RankGroup` (13), `Candidate` (19–34), `Sighting` (40–56), `PhraseEntry` (61–78), `Successor` (82–90), `RawToken` (94), `GateRejectReason` (99), `GateResult` (110), `Dictionary` (116), `IngestStats` (128), `RankedMatch` (133–138).

- DELETE: `PhraseEntry` (lines 58–78): `{ key: string; count: number; lastSeenOrdinal: number; firstSeenOrdinal: number; sticky: boolean }`.
- KEEP: `Successor` `{ next: string; count: number }` (lines 80–90) — successor index stays. All others stay.

## query.ts (src/core/query.ts, 273 lines)

- `rankMatches(store: CandidateStore, prefix: string, opts: RankOptions = {}): RankedMatch[]` — line 182; signature/return unchanged if only the phrase block goes.
- `RankOptions` (71–78): `limit?: number; suppress?: (c: Candidate) => boolean`.
- Phrase items constructed: "Phrase gathering" block lines ~218–233 (`phraseHits`, iterates `store.phraseCandidateKeys()`, `firstWord(pk).startsWith(lower)`, `store.getPhrase(pk)`, `phraseSalience(...)`); phrase RankedMatch push lines ~255–262 (description literal `"phrase"`, display = constituent displays joined).
- Constituent suppression: lines ~236–253 (BUG-005 exemption `store.topSuccessors(fw).length > 0`; `phraseSuppresses(p.sal, words[i].sal)` splices word whose key === first word).
- `phraseSalience(constituents: ReadonlyArray<Candidate | undefined>, entry: PhraseEntry, currentOrdinal: number): number` — lines 115–131. Formula: `(Σ salience(c)) × PHRASE_MULTIPLIER + (entry.count ≥ 2 ? PHRASE_REPETITION_W · log2(1+count) : 0)`.
- Other exports: `PHRASE_MULTIPLIER = 1.2` (86), `PHRASE_REPETITION_W = 2.0` (93), `firstWord(phraseKey: string): string` (100–104), `phraseSuppresses(phraseSal, wordSal): boolean` (136–140), `compareRankedMatches(a,b): number` (153–170 — KEEP; also sorts word-only), `DEFAULT_LIMIT = 8` (68 — KEEP).
- `opts.suppress`: word-only seam; grep shows **no production caller passes `suppress`** — only tests (`test/query.test.ts`, `test/phrase-gating.test.ts` use it). No phrase dependency.

## debug.ts (src/pi/debug.ts, 223 lines)

Sections of `formatAcwordsDump` (lines 165–184): `storeSection` (size/cap/ordinal/histogram, 70–78), `topSection` (top-50 words, 81–91), `statsSection` (94–105), `phrasesSection` (132–160, spread at line 182).

- Phrase dump code to DELETE: `TOP_PHRASES = 10` (109), `phraseDisplay(store, key)` (114–120), `phrasesSection(store, now)` (122–160) and its spread entry (line 182). It imports `firstWord, phraseSalience` from `../core/query.js` (line 6), `PHRASE_CAP` from store (line 8), type `PhraseEntry` (line 11). Successor sample inside phrasesSection (lines 154–159) uses `store.topSuccessors` — the only successor observability; consider keeping a successor sample somewhere.
- Tuning multipliers: `PHRASE_MULTIPLIER`/`PHRASE_REPETITION_W` are **baked constants in query.ts**, not env vars or config. The only config flag is `enablePhrases: boolean` in src/pi/config.ts (decl line 42, default true line 51, parsing lines 197–204), gate consumed in src/pi/index.ts (180–188) and src/pi/provider.ts (212–214, 240, 355–376, 383–388).

## Cross-file usage of doomed symbols (src/ + test/)

Production (src/):
- `recordPhraseLines`: src/pi/index.ts:183 (also comments 175–176); src/core/store.ts:445, 497.
- `sweepPhraseDemotions`: src/pi/index.ts:188.
- `topSuccessors`: src/pi/provider.ts:247, 282, 385(comment)/388 area — KEEP (successor).
- `enablePhrases` (gate, likely deleted with layer): src/pi/config.ts:42,51,197–204; src/pi/index.ts:176,180,183,188; src/pi/provider.ts:153,212,214,240,355,376.
- `PhraseEntry`: src/core/types.ts:61; store.ts (fields/methods/types); src/pi/debug.ts:11.
- `phraseSalience`, `firstWord`: src/pi/debug.ts:6, used in phrasesSection.
- query.ts internal: `phraseSalience`, `firstWord`, `phraseSuppresses`, `phraseHits` block.
- ingest.ts seams: `onAdmittedTokens?: (lines: string[][]) => void` (129) and `onSweepPhrases?: () => void` (135), fields 163–164, assigned 187–188, invoked 233, 277, 327. NOTE: `onAdmittedTokens` is ALSO the seam through which bigrams/successors are fed today — if the successor index stays, index.ts must keep feeding bigram lines to the new recording method (re-point, don't delete).
- `phrasesSection` / `phraseDisplay` / `TOP_PHRASES`: debug.ts only.

Tests (all need deletion/update):
- test/phrases.test.ts, test/phrase-gating.test.ts — entire phrase-layer suites.
- test/successors.test.ts, test/chain.test.ts — successor layer; chain.test.ts uses `recordPhraseLines` to feed bigrams (lines 134, 147–148, 372, 466) — must re-point to the new bigram recorder, not delete.
- test/query.test.ts — phrase ranking/suppression cases.
- test/debug.test.ts — phrasesSection dump expectations.
- test/ingest-restore.test.ts:519–522, 605–676 (sweep, candidacy, fast path, `getPhrase`).
- test/ingest-pipeline.test.ts:355–375 (`recordPhraseLines`, `getPhrase`).
- test/index.test.ts:411–444 (`recordPhraseLines` spy, enablePhrases gating).
- test/acceptance.test.ts:585, 667 (`recordPhraseLines`, `phraseSize`).
- test/adversarial-typing.test.ts:444; test/adversarial-ingest.test.ts:293–353 (`isFastPathPhrase`, `phraseCandidateKeys`, `getPhrase`, `#bumpSuccessor` comment 324).
- test/perf-gates.test.ts:33, 282–283, 295–300 (`PHRASE_CAP`, `PHRASE_EVICT_BATCH`, `recordPhraseLines`, `sweepPhraseDemotions`, `phraseSize`).
- test/config.test.ts — `enablePhrases` parsing tests.

## Keep inventory (survivors)

- store.ts word layer: `#map`, `#ordinal`, `#sortedKeys`, `#dirty`, `nextOrdinal`, `currentOrdinal`, `upsert`, `evictIfOverCap`, `prefixRange`, `sortedKeysSnapshot`, `lowerBound`, `get`, `size`, `entries`, `rankGroupHistogram`, `STORE_CAP`, `EVICT_BATCH`, `evictionScore` import from score.ts.
- Successor layer: `#successorIndex`, `#bumpSuccessor`, `#dropSuccessorFor`, `topSuccessors`, `successorBefore`, `NO_SUCCESSORS`, `Successor` type.
- query.ts: `rankMatches`, `RankOptions` (+ word-only `suppress` seam), `DEFAULT_LIMIT`, `compareRankedMatches`, `salience` import.
- debug.ts: storeSection, topSection, statsSection, topCandidates, GROUP_LABEL, TOP_N, formatAcwordsDump (minus phrasesSection spread), registerAcwordsCommand.
- types.ts: everything except `PhraseEntry`.

## Shared-symbols risk notes

- `#upsertPhrase` is currently the ONLY caller of `#bumpSuccessor` and `#admitPhrase`; deleting it orphans both the successor bump (KEEP) and admission (DELETE). The refactor must insert bigram recording into the replacement path.
- `#evictPhrasesIfOverCap` is the ONLY caller of `#dropSuccessorFor` and `#rebuildPhraseHeap`. If phrase eviction dies without a bigram cap replacement, the successor index becomes unbounded (no cap/eviction of its own).
- `onAdmittedTokens` seam feeds both phrases and successors — cannot delete wholesale if successors stay.
- `compareRankedMatches` sorts the merged list; with phrases gone it degenerates to the word order — keep (tests use it).
- Word eviction (`evictIfOverCap`) does NOT clean `#successorIndex` today (a word evicted from `#map` can linger as a successor-index key). Pre-existing gap; more visible if phrase map no longer provides indirect cleanup.