# Tests & Docs Inventory — delta: drop phrase layer, strict bigram tests, segmentation hardening, forced single-item Tab branch, zero-typed-char chaining redesign, enablePhrases→enableChaining, drop phrase dump from /acwords

## 1. test/ directory

All under `test/`. Counts = `it(`/`test(` occurrences. No vitest.config.* exists (defaults only). Bench: `test/bench/core.bench.ts` — 4 `bench()` cases under one describe "PRD §09 core gates" (query, dict load+sweep, ingest 800 KB, steady-state cycle). Helpers: `helpers/{bench-fixtures,dict-writer,editor-sim,session-fixture}.ts`. Fixtures: `fixtures/sessions/` (zendesk-lwlock, prose, large-100k, RESULTS.md, expected.md).

| File | cases | Purpose (one line) |
| --- | --- | --- |
| acceptance.test.ts | 22 | PRD §09 integration items 1–6 scripted halves |
| adversarial-ingest.test.ts | 5 | adversarial text through ingest incl. realistic-key probes |
| adversarial-typing.test.ts | 6 | editor sims: prose no-menu, rapid-Tab, chain-post-restore probe |
| bad-dict-gate.test.ts | 5 | broken dictionary disables ingest, delegates |
| build-dict.test.ts | 13 | dictionary builder / packing |
| calibration.test.ts | 3 | admission-band calibration vs corpora |
| chain.test.ts | 16 | Tab-chain state machine (REWRITE) |
| config.test.ts | 28 | config layers, validation, repair (REWRITE alias) |
| debug.test.ts | 16 | /acwords dump + registration (phrase section DROPS) |
| dictionary.test.ts | 11 | packed-dict load/lookup (1 gc-dependent skip) |
| index.test.ts | 22 | extension factory/lifecycle |
| ingest-pipeline.test.ts | 24 | pipeline debouncing, chunking, hooks |
| ingest-restore.test.ts | 23 | history replay through pipeline |
| ingest.test.ts | 13 | ingest core |
| mask-secrets.test.ts | 10 | layer-1 secret masking |
| no-persistence.test.ts | 3 | M1 DoD item 5: filesystem snapshot assertions (KEEP GREEN) |
| paths.test.ts | 4 | jiti-safe dictionary path |
| perf-gates.test.ts | 6 | hard 3× perf budget gates (KEEP GREEN) |
| phrase-gating.test.ts | 5 | enablePhrases:false inertness (DELETE/REWRITE) |
| phrases.test.ts | 41 | entire phrase layer (DELETE; bigram subset REWRITE) |
| provider-display.test.ts | 18 | display-layer classification + debounce |
| provider-live.test.ts | 15 | delegation + live-cache seams (EXTEND) |
| provider-match.test.ts | 39 | match-state extraction |
| provider.test.ts | 11 | never-hijack acceptance a–g (EXTEND for forced single-item Tab branch) |
| query.test.ts | 48 | rankMatches incl. phrase salience/suppression blocks (partial rewrite) |
| score.test.ts | 37 | admission + salience arithmetic |
| segment.test.ts | 28 | tokenize + expandCandidates (EXTEND for non-ASCII hardening) |
| shapeGate.test.ts | 48 | noise/secret token gate |
| shipped-dict.test.ts | 6 | top ~945 words rejected |
| smoke.test.ts | 1 | imports load |
| store.test.ts | 39 | word store, cap, eviction |
| successors.test.ts | 8 | successor index build/eviction/restore (REWRITE source) |
| types.test.ts | 1 | type-level |

### Named test cases for the delta-relevant files

**phrases.test.ts (41 — DELETE, salvage bigram windows into new strict raw-adjacency suite)**
- describe "phrase layer — baked constants": exports PHRASE_CAP 10,000 / PHRASE_EVICT_BATCH 256
- describe "within-line n-gram windows": captures the bigram within a line; no window crosses the line break; never joins two two-word lines into a cross-line window; captures overlapping bigrams AND trigrams of a 4-word line; repeated windows within one line increment the same entry; lines shorter than two keys form no windows / empty input no-op; uses keys as given — joined with single spaces, never re-cased; recordPhraseLines never advances the ordinal counter
- describe "upsert on repeat": count++ and lastSeenOrdinal refresh, firstSeenOrdinal frozen, size 1; firstSeenOrdinal stays frozen; bigram and trigram windows count independently; sticky initialized false, never set by recording
- describe "setPhraseSticky": flips sticky, recording keeps it; unknown key no-op
- describe "accessors": getPhrase miss undefined; phraseEntries defensive copies; snapshot isolation; iteratePhrases live view
- describe "cap eviction": 10,001 → one eviction pass (256 batch); deterministic lowest-scores-first, byte order; sticky survives eviction; protected pool; phrase eviction never touches word store/prefix index
- describe "phrase admission": repetition path (count ≥ 2, rank-1 constituents); fast path all-rare count 1; properName counts as rare; mixed constituents block fast path; absent constituent fails fast path; sticky survives eviction; removePhraseCandidacy; demotion of repetition-only phrase; phraseCandidateKeys snapshot inert; admission never touches word store
- describe "40-ordinal demotion sweep": demotes at diff 40 / keeps at 39; demotion retains counts/ordinals/sticky; recurrence re-admits via repetition; sticky fast-path never demoted; repetition-only never demoted; sweep idempotent; demotes all stale fast-path in one pass; no candidates → no-op 0

**phrase-gating.test.ts (5 — DELETE; word-parity case may be repurposed)**
- full nrel ingest stores ZERO phrases and ZERO successors (hook unwired); rankMatches yields no phrase items and NO constituent suppression; provider chain layer never arms; word completion parity ze → Zendesk exactly M1 surface; contrast — enablePhrases:true phrase-completes, exempting the arming word

**successors.test.ts (8 — REWRITE: successor source moves from phrase layer to raw bigrams)**
- build: orders successors count desc; caps at 3 (4th never appears); count ties byte-lex; trigram keys never contribute — bigrams only; line breaks inherited from phrase layer — no successor crosses a newline ← this one changes meaning
- eviction cleanup: evicted bigrams spliced out, no backfill (may die if bigrams are no longer a capped store)
- restore replay: two stores same stream → deep-equal indices
- reader: unseen word returns shared empty constant

**query.test.ts (48 — rewrite phrase blocks; keep word-only blocks)**
- Keep: empty results (4), case-insensitive/display casing (4), result shape (3), ordering (6), limits (5), suppress hook (5), ordinal interplay (2), perf sanity (1)
- Phrase blocks to delete/rewrite: "phrase helpers — baked weights and key math" (6: weights ×1.2 ×2.0; firstWord; phraseSuppresses >=; phraseSalience repetition path; fast path; all-evicted) and "phrase salience + constituent suppression" (11: phrase competes on FIRST-word prefix; repetition count 3 arithmetic; fast-path count 1; BUG-005 successor-bearing exemption; never word>phrase; word strictly outranking keeps both; middle/last-word fragment; missing constituent 0; merged order/top-8; no phrase candidates → M1 behavior; successor-less shadowed word still suppressed; A/B bare word; opts.suppress filters words)

**segment.test.ts (28 — EXTEND for non-ASCII-adjacent hardening)**
- tokenize base tokens (5), hexish (8), CJK/non-ASCII (2: skips CJK runs; resumes ASCII tokens after a non-ASCII run ← anchor for new hardening cases), ordering/bounds (2), expandCandidates camel/snake (11)

**chain.test.ts (16 — REWRITE for zero-typed-char offers with bare one-word values)**
- starts idle; (1) Tab-accept of live hapax word item arms; (2) accept absent-from-map (path completion) never arms; (3) accepting a phrase item arms at LAST word (BUG-005 p2 — DIES with phrases); (4) armed + 1-char fragment → successor-only menu threshold 1; (5) further typing filters; (6) zero matching successors → disarm same call; (7) armed with empty successor index → disarm; (8) word-less state (trailing space/punct) → disarm; (9) Tab-accept of successor re-arms, delegates verbatim; (10) reset() before_agent_start; (11) trigger-mode acceptance arms; (12) armed sets through display classification + 100 ms debounce
- describe "phrase acceptance arms the chain": full nrel replay → phrase arms energy → laboratory → re-arms (DIES); enablePhrases=false never arms (DIES); bare-word route still arms end-to-end (KEEPS/ADAPTS)

**provider.test.ts (11 — EXTEND: forced single-item Tab branch)**
- never-hijack cases (a)–(g): (a) no fragment → delegation (3: empty line col 0; prose 'hello ' after space; quoted path); (b) applyCompletion always delegates (1); (c) shouldTriggerFileCompletion delegation (2); (d) zero-candidate query → delegation (1); (e) common words never hapax items (2); (f) Tab pass-through, provider surface = pi-tui contract + dispose (1); (g) case-insensitive, display casing inserted (1)

**provider-live.test.ts (15 — EXTEND)**
- aborted signal delegates with exact args; fragment below threshold delegates; zero matches clears live cache; '#ze' pi-shaped mapping; threshold mode; maxSuggestions respected; zero awaits / live cache before await; __hapaxLive published; __hapaxKey maps display→keys; key map rebuilt per query; applyCompletion delegates (5 args); shouldTriggerFileCompletion true/delegates; triggerCharacters default ['#'] / '' → undefined

**config.test.ts (28 — REWRITE enablePhrases→enableChaining + deprecated alias)**
- defaults (4: exactly defaults, fresh copy, empty JSON, unknown keys ignored); precedence (3); trust gating (3); malformed files (4); triggerChar validation (3); threshold/maxSuggestions clamp (4); boolean fields (3: enablePhrases "yes" repairs / false accepted ← rename; debug 1 repairs; user-level repair precedes project); pure helpers (2); warning contract (2)

**debug.test.ts (16 — phrase dump section DROPS, 3 cases die)**
- Keep: renders size/cap/ordinal; rank-group histogram; top rows salience desc; ties byte-lex; caps at 50 rows; <50 all entries; recent display casing ×N; wordsSeen/admitted/six gate counts; never contains words absent from store; registers nothing when debug false; registers "acwords" once; fresh snapshot per invocation
- Delete: describe "acwords dump — phrases + successor sample" (4: populated store count/cap/top-10/(repeat)/successor sample; caps phrase rows at 10; empty store renders (none); phrases-disabled renders identically to empty)

### M1 acceptance suites (must re-run green)
- `test/provider.test.ts` — never-hijack cases (a)–(g)
- `test/perf-gates.test.ts` + `test/bench/core.bench.ts` — perf gates/benchmarks
- `test/no-persistence.test.ts` — no-persistence DoD item 5
- `test/acceptance.test.ts` — PRD §09 integration items 1–6

## 2. docs/M1-DoD.md — checklist summary
Six gauntlet items, all recorded PASS at c138b5b (2026-09-07): (1) `npm run check` tsc strict clean; (2) `npm test` whole suite green (was 24 files / 413 passed / 1 skipped); (3) perf gates: 4 gates a–d with 3× CI-variance hard bounds + `npm run bench` reporting numbers; (4) integration items 1–6 scripted halves in acceptance.test.ts, manual TUI halves documented in test/fixtures/sessions/RESULTS.md; (5) no persistence: automated no-persistence.test.ts + static grep (only readFileSync in src) + scripted live pi run with marker/find snapshots; (6) tuning protocol pointer: baked constants in src/core/score.ts, one-at-a-time, fixture-driven precision@8 vs expected.md. Post-delta this file needs a fresh sweep/annotation (phrase layer removal changes suite counts and adds bigram tests).

## 3. README.md (24 KB) — heading outline
`# hapax` / ## Features / ## Quick start / ## Usage / ## Architecture / ## Design invariants / ## Known limitations / ## Non-goals / ## Reference (### Dictionary build — #### What ships, #### Corpus provenance, #### Rebuilding, #### Calibration guarantee, #### Versioning contract; ### Configuration — #### File paths and precedence, #### Not configurable (by design); ### Debug; ### Development — #### Dev loop, #### jiti and the dictionary path, #### Loading without the flag, #### Missing dictionary → graceful disable, #### Checks)

### Quotes needing edits

**Features — phrase bullet (lines ~49–56):** "**Phrase completions** (`src/core/store.ts`, `src/core/query.ts`) — 2- and 3-word phrases join the menu when the phrase occurs **≥ 2 times in-session** (repetition — confirmed and sticky), or on **first sight when every constituent word is rare** (fast path — unconfirmed, and demoted again unless repeated within **40 messages**). While a phrase is a candidate, its constituent words are suppressed from word-only completion so the phrase wins — except a constituent that bears successors in the chain index, which stays completable so it can still arm the chain (next bullet)." → DELETE / replace with bigram-based successor indexing description.

**Features — chaining bullet:** "**Chained Tab completion — zero additional typing** (`src/pi/provider.ts`) — accepting a word via Tab arms its most-likely successor (top-3 successor index built at ingest, `src/core/store.ts`); the very next Tab completes that successor with no additional typing — `National` → `renewable` → `energy` → `laboratory` … Chaining resets on `before_agent_start` and on disqualifying input. Phrases cooperate with the chain instead of killing it: a phrase's **last word** arms the chain exactly as a word accept does, and a bare word that can still arm the chain is exempt from constituent suppression … Chains arm normally in resumed sessions …" → REWRITE for zero-typed-char offers with bare one-word values; drop phrase-last-word arming and exemption prose.

**Usage (lines ~100–115):** whole second/third paragraphs: "Chained completion needs no typing at all once a phrase chain exists … type natio → … four words, four Tabs" and "Once admitted (by repetition or an all-rare first sight), phrases appear in the same menu as words, and phrase salience (1.2 × …) outranks the prefix word … the successor-bearing-constituent exemption … accepting a phrase arms the chain on its last word … (in phrase-free sessions, or with `enablePhrases: false`, everything above is pure word chaining)." → REWRITE: chaining is now the only multi-word mechanism; remove `enablePhrases` mention.

**Architecture:** "store (per-session candidates, 20k cap, plus the M2 phrase store and top-3 successor index)" → drop phrase store, keep successor index (now bigram-fed). Lifecycle paragraph: "A completed replay ends with one phrase-demotion sweep, so fast-path phrases from history that outlived their 40-ordinal probation … are demoted before the first live message" → DELETE. "before_agent_start … resets the Tab-chain machine to idle" stays.

**Design invariants #1 (never-hijack):** "No key is ever captured, consumed, or altered except Tab while a suggestion is selected. … ordinary prose never opens a menu — the calibrated bands reject the top ~945 English words (`test/shipped-dict.test.ts`), and prose-no-menu probes pin it (`test/adversarial-typing.test.ts`)." → Keep; extend for the forced single-item Tab branch semantics if it alters Tab behavior text.

**Configuration table (all rows):** triggerChar (string, `"#"`, one non-word non-space char or `""`); threshold (number, 2, 1–3 clamped); maxSuggestions (number, 8, 1–20 clamped); **`enablePhrases`** (boolean, `true`, "enables phrase completions and Tab-chained successor completion; `false` removes the entire phrase layer — no phrase items, no constituent suppression, no successor capture or chaining — while word completion is unchanged"); debug (boolean, false, /acwords). → Rename to `enableChaining` (boolean, default true, gates bigram capture + chained offers), note deprecated `enablePhrases` alias.

**Debug / /acwords:** bullets: store size vs 20,000 cap + ordinal; rank-group histogram; top 50 by salience; ingest counters (six rejection rules); "the phrase layer (M2): the stored-phrase count against the 10,000-phrase cap, the top 10 phrases by salience … plus one successor-index sample: the top successors of the top phrase's first word, rendered `national → renewable ×4, license ×1`. This sample is the tuning signal for the Tab-chained completion offers." and "A session with no stored phrases (nothing ingested yet, or `enablePhrases: false` …) renders `phrases: (none)` and omits the successor sample." → drop phrase dump; decide whether the successor sample stays (it's the chaining tuning signal).

## 4. Other docs / spec
- docs/: only `M1-DoD.md` (above).
- No CHANGELOG file exists.
- spec/ (filenames only): SPEC.md, 01-goals-and-scope.md, 02-architecture.md, 03-dictionary-format-and-build.md, 04-tokenization-and-scoring.md, 05-ingestion-pipeline.md, 06-candidate-store.md, 07-completion-ui.md, 08-configuration.md, 09-testing-and-acceptance.md.

## 5. package.json / vitest
- scripts: `check` = tsc --noEmit; `test` = vitest --run; `bench` = vitest bench.
- No vitest.config.* file — vitest 4 defaults (test dir auto-discovered, `test/bench/` for benches). No special bench setup beyond `test/helpers/bench-fixtures.ts`.