# Research notes — P1.M1.T2.S2 (plan 002): query.ts words-only rankMatches; drop suppress seam; one-word invariant test

## Upstream contract (P1.M1.T2.S1, in flight — assume exact)
- store.ts: phrase accessors GONE (phraseCandidateKeys, getPhrase, PhraseEntry,
  etc.). New: recordBigramRuns, bigramSize, topSuccessors kept. TypeScript
  enforces the query.ts removal — query.ts won't compile until phrase blocks
  are deleted (S1 already does the MINIMAL deletion to compile).
- S1's minimal deletion covers: phrase gathering block, suppression block,
  phrase RankedMatch push, phraseSalience, firstWord, phraseSuppresses,
  PHRASE_MULTIPLIER, PHRASE_REPETITION_W, PhraseEntry imports.
- THIS task (S2) adds: drop `RankOptions.suppress` seam entirely (R1),
  rewrite test/query.test.ts, add the one-word invariant test as a reusable
  helper.

## Verified codebase facts
- src/core/query.ts current layout (lines): module doc (1–64, heavily
  phrase-flavored — needs a rewrite), imports incl. `PhraseEntry` and
  `Candidate` (for suppress type), DEFAULT_LIMIT (~67), RankOptions with
  `suppress?: (c: Candidate) => boolean` (~71–78), phrase helpers (86–140),
  compareRankedMatches (~153–170), rankMatches (~179–273).
- The `suppress` seam: production caller check — grep shows provider.ts:325
  calls `rankMatches(store, state.fragment, { limit: config.maxSuggestions })`
  — NO suppress. Confirmed: suppress is test-only. Provider comments
  mentioning "suppression" are display-debounce stale-prefix suppression —
  UNRELATED naming; do not touch provider.ts.
- test/query.test.ts (~700 lines): describes at
  - 67 empty results (KEEP)
  - 88 case-insensitive prefix/display casing (KEEP)
  - 117 result shape "session x<count>" (KEEP)
  - 149 ordering (KEEP)
  - 220 limits/top-8 (KEEP)
  - 267 suppress hook (DELETE per R1)
  - 313 ordinal interplay/recency (KEEP)
  - 337 perf sanity (KEEP)
  - 393 "phrase helpers — baked weights and key math" (DELETE, 6 cases)
  - 438 "phrase salience + constituent suppression" (DELETE, 11 cases incl.
    BUG-005 exemption case at 494 and suppress-interplay case at 689)
  - imports: PHRASE_CAP, firstWord, phraseSalience, phraseSuppresses,
    PHRASE_MULTIPLIER, PHRASE_REPETITION_W, PhraseEntry — all to go.
- One-word invariant test: "feed a store via the real ingest path with
  chainable text and assert every returned RankedMatch display contains no
  space". Real ingest = IngestPipeline.processText (src/pi/ingest.ts) with
  real CandidateStore + a dictionary. Existing pattern: test/acceptance.test.ts
  ingestFixture (L80): `new IngestPipeline({ store, dictionary })` + replay
  session messages; dictionary via loadDictionary(resolveDictPath()) or a
  buildDictBinary synthetic (test/helpers/dict-writer.ts). Helper must be
  reusable by P1.M2.T1.S2 chain tests → export from test/query.test.ts or
  (better) test/helpers/.
- vitest style: describe/it/expect, double quotes, `!` non-null.
- NodeNext `.js` import extensions mandatory.

## Design decisions
- rankMatches keeps: signature (store, prefix, opts?: {limit}), DEFAULT_LIMIT=8,
  compareRankedMatches, prefixRange→snapshot→get loop, salience import,
  description `session x${count}`. Only word path remains.
- RankOptions loses `suppress`; Candidate type import drops if unused.
- Module header doc rewrite: PRD §04 h2.26 + §07 h2.44 one-word invariant,
  R1 rationale (no caller; successor chaining replaced suppression).
- Invariant helper: `assertWordsOnly(matches, label?)` — checks
  `!m.display.includes(" ")` for every item; place in
  test/helpers/query-invariants.ts (importable by chain.test.ts in
  P1.M2.T1.S2). Test uses it over ingest-fed store with chainable text
  ("the lwlock guard", "zendesk ticket", repeated bigrams) and various
  prefixes incl. "" (empty → all).
- Note: S1 (in flight) may already prune some query.test.ts phrase cases to
  keep green; S2's job is the full rewrite either way — read the file fresh
  at implementation time.

## Gotchas
- provider.ts "suppression" comments = display-debounce stale-prefix
  machinery, NOT RankOptions.suppress — leave alone.
- Compare test oracles use compareCandidates from score.ts — keep that
  cross-check pattern.
- Ingest path requires a Dictionary; use buildDictBinary (helpers/dict-writer)
  with entries ensuring test words admit (low quant) — don't depend on
  shipped dict calibration.
- onAdmittedTokens payload/adjacency runs change in P1.M1.T3.S2 — the
  invariant test only needs WORD admission, which is stable.