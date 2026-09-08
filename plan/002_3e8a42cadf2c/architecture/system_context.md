# hapax D2 (plan/002) — System Context & Synthesis

Synthesis of five read-only recon reports (2026-09-08). Companion files in this directory:
`core_phrase_layer_map.md`, `ingest_segment_map.md`, `pi_layer_map.md`, `external_deps.md`,
`tests_docs_inventory.md`. Repo: `/home/dustin/projects/hapax` — TypeScript, vitest 4, `npm run check`
(tsc --noEmit), `npm test`, `npm run bench`. All M1 + old-M2 work is COMPLETE and green
(docs/M1-DoD.md, PASS at c138b5b: 24 files / 413 passed / 1 skipped). The D2 delta MODIFIES, never rebuilds.

## Current module map (verified)

- `src/core/store.ts` (880 ln) — `CandidateStore`. Word layer (KEEP): `#map`, `STORE_CAP=20_000`,
  `evictIfOverCap()` (329–372), `upsert`, `prefixRange`, `get`, `entries`, `rankGroupHistogram`.
  Phrase layer (DELETE, exact lines in core_phrase_layer_map.md): `PHRASE_CAP/PHRASE_EVICT_BATCH/
  phraseSortKey/EvictNode/heap*` (98–196), fields `#phrases/#phraseCandidates/#phraseEvictHeap/
  #fastPathAdmitted` (213–235), `recordPhraseLines`…`iteratePhrases` (445–880).
  Successor layer (KEEP, re-point): `#successorIndex: Map<string, Successor[]>` (225),
  `#bumpSuccessor` (528–575, private, only called by `#upsertPhrase`), `#dropSuccessorFor`
  (748–758, private, only called by `#evictPhrasesIfOverCap`), `topSuccessors()` (856–859),
  `successorBefore`, `NO_SUCCESSORS`.
- `src/core/types.ts` — `PhraseEntry` (61–78) DELETE; `Successor {next, count}` (82–90) KEEP;
  `RawToken {raw, hexish}` (87–95) gains `start/end` in this delta.
- `src/core/query.ts` (273 ln) — `rankMatches(store, prefix, opts)` KEEP; phrase gathering/suppression
  blocks, `phraseSalience`, `firstWord`, `phraseSuppresses`, `PHRASE_MULTIPLIER/PHRASE_REPETITION_W`
  DELETE; `RankOptions.suppress` has NO production caller (tests only) — PRD removes the seam.
- `src/core/segment.ts` (253 ln) — `tokenize()` + `expandCandidates()`, strings-only output; internal
  `SpanToken` has `start/end` but the merge drops them (~160–175). `BASE_RE` restarts after non-ASCII
  runs → `Þórhildur`→`rhildur`, `ΩbsidianMirror`→`bsidianMirror` today (the R2 bug).
- `src/pi/ingest.ts` (529 ln) — `IngestPipeline`; 300 ms trailing debounce, 64 KiB chunks split on
  `\n` (lines never span chunks); `#admitSegment` returns lowercase keys of admitted WHOLE tokens
  (`isSubword` excluded); emits `onAdmittedTokens(lines: string[][])`. **Spans do NOT survive to the
  windowing point** — the adjacency rule needs new plumbing (see Decisions).
- `src/pi/provider.ts` (771 ln) — `createHapaxProvider(store, config, current, chain)`.
  `getSuggestions` order today: abort → armed/pending chain (leading-space values `" renewable"` at
  line 254; threshold-de-facto-1 fragment filter 292–316) → `extractMatchState` (trigger/threshold)
  → `rankMatches` → publish `lastLive`/`liveKeyByValue` → return. `options.force` is NEVER read;
  delegate paths forward the original options object. `createChainMachine` (409–498): `armed`+`pending`
  closure, `arm/consumePending/reset`. `applyCompletion` (351–400): CHAIN_KEY_PREFIX arm, bare-word arm,
  phrase-key arm (dies). `createDisplayProvider` (583–771): hapax-side 100 ms display debounce; ALWAYS
  queries base first (Tab stays instant); classifies hapax results via `__hapaxLive` + prefix equality.
- `src/pi/config.ts` (252 ln) — `HapaxConfig` (36–45), `DEFAULT_CONFIG` (47–53), `applyLayer`
  per-key blocks (153–224; `enablePhrases` block 197–208); per-field-per-layer injected `notify`.
- `src/pi/index.ts` (255 ln) — session_start wiring: config load, `createChainMachine`, IngestPipeline
  with `config.enablePhrases ? {onAdmittedTokens → recordPhraseLines, onSweepPhrases →
  sweepPhraseDemotions}` (180–188), `createDisplayProvider(createHapaxProvider(...))` (197–202),
  `/acwords` when `config.debug` (207), history restore, and `before_agent_start → chain.reset()` (251–255).
- `src/pi/debug.ts` (223 ln) — `formatAcwordsDump`: storeSection/topSection/statsSection KEEP;
  `phrasesSection`/`phraseDisplay`/`TOP_PHRASES` + `firstWord/phraseSalience/PHRASE_CAP/PhraseEntry`
  imports DELETE. The ONLY successor observability (sample of `topSuccessors`) lives inside
  phrasesSection (154–159) — must be extracted to a standalone section.

## pi-tui contract (verified in-repo, `@earendil-works/pi-tui` ~0.84.4)

- Tab (non-slash context): `handleTabCompletion()` → `forceFileAutocomplete(true)` →
  `requestAutocomplete({force:true, explicitTab:true})` → provider call
  `getSuggestions(lines, line, col, {signal, force})` (editor.js:1892 — `explicitTab` is editor-internal).
- **Single-item fast path CONFIRMED** (editor.js:1903): `options.force && options.explicitTab &&
  items.length === 1` → `applyCompletion` applied immediately, no menu; `items.length > 1` → menu opens
  in `"force"` state (1916). The PRD's root-cause trace is accurate: hapax ignoring `force` and
  returning >1 items lands Tab in the menu-open branch.
- **Bare-value zero-prefix insertion CONFIRMED word-safe** (autocomplete.js:265–325): with `prefix:""`,
  `beforePrefix` is everything before the cursor (ending in the separator); plain path splices
  `item.value` verbatim → `"foo " + "bar"` = `"foo bar"`. A leading-space value would DOUBLE-SPACE.
  The plain path adds NO trailing space. ⇒ R4's bare one-word value is correct; retire leading-space
  values; the zero-char offer fires at a word start created by a separator.
- pi-tui's only debounce is 20 ms, non-forced, pattern-gated (editor.js:169, 1876–1888) — forced/Tab
  requests bypass it. The 100 ms display debounce is hapax-side only.
- Forced requests consult `shouldTriggerFileCompletion` (1832–1838) — hapax delegates it, unchanged.
- Slash-context Tab routes to a NON-forced slash completion path — fast path can't fire there (fine).

## Key decisions for the breakdown (research-derived)

1. **Adjacency plumbing**: spans must be threaded `tokenize → RawToken.start/end → #admitSegment →
   per-line adjacency runs`. Compute RUNS in ingest (it holds the masked segment string): break between
   consecutive admitted whole tokens unless `segment.slice(prevEnd, nextStart)` matches `/^[ \t]+$/`.
   `onAdmittedTokens` then emits runs (string[][]); store records bigrams pairwise within each run via
   the re-pointed `#bumpSuccessor`. Keeps the store string-only and the check where the raw text lives.
   VERIFY `maskSecrets` is length-preserving (it blanks in place; offsets are taken against the masked
   segment either way — document which).
2. **Slim bigram map**: keep `Map<"first second", {count, lastSeenOrdinal}>` capped at 10,000 keys,
   evict via the existing lazy-heap pattern minus sticky; evict → `#dropSuccessorFor` splice. No
   PhraseEntry, no admission/sticky/demotion/candidacy, no trigrams.
3. **Force branch**: read `options.force` after the abort check; truncate EVERY hapax-owned return
   (armed zero-char offer, armed filtered, normal query) to `{items:[items[0]], prefix}` when forced;
   no live fragment → delegate with the original options object; empty live set → empty. Pin a comment
   to editor.js:1903. `createDisplayProvider` must pass forced results through untouched.
4. **Chain redesign**: zero-char word-start offer (unfiltered `topSuccessors`), typed-char filter with
   threshold 0, bare values everywhere, `pending/consumePending` dies, phrase-key arm case dies,
   case (8) word-less-buffer disarm+delegate semantics preserved (pinned by comment at provider.ts ~265).
5. **Config alias**: per-layer resolution inside `applyLayer` (alias read first, `enableChaining`
   overrides); optional deprecation notify via the existing per-field repair mechanism.
6. **Known PRD-internal inconsistency**: prd_snapshot §09 (h2.49) still lists the old segment test
   bullet "CJK run skipped; ASCII resumes after" — delta R2 overrides it (whole adjacent run
   disqualified). Implementers should follow R2.
7. **Pre-existing gap (leave, note)**: word eviction (`evictIfOverCap`) does not clean `#successorIndex`;
   with the phrase map gone there is no indirect cleanup. Out of delta scope; do not widen.

## Test impact summary (details in tests_docs_inventory.md)

DELETE: phrases.test.ts (41), phrase-gating.test.ts (5, rewritten as enableChaining inertness),
query.test.ts phrase+suppress blocks (~22), debug.test.ts phrase describe (4), chain.test.ts phrase
cases. REWRITE: successors.test.ts (8, strict adjacency), chain.test.ts (16), config.test.ts (28,
alias/precedence), segment.test.ts (28, extend). EXTEND: provider.test.ts (11), provider-live.test.ts
(15), provider-display.test.ts (18). SEAM UPDATES: ingest-pipeline, ingest-restore, index, acceptance,
adversarial-*, perf-gates (PHRASE_CAP→bigram cap). M1 suites that must re-run green: provider.test.ts
(never-hijack), perf-gates + bench, no-persistence, acceptance.