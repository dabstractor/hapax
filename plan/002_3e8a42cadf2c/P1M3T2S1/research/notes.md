# Research notes — P1.M3.T2.S1 (debug.ts successor-index sample)

## Verified code facts (working tree, post phrase-strip)

- src/pi/debug.ts (223 lines): `formatAcwordsDump(store, stats)` joins
  storeSection → topSection → statsSection. `topCandidates(entries, now)`
  (~L46) computes the deterministic top-50 (salience desc, byte-lex ties)
  with `ordinal` captured ONCE by the caller. `TOP_N = 50` (~L36).
  File header JSDoc (~L12) explicitly says: "P1.M3.T2.S1 (R5) appends the
  successor-index sample section by adding one builder and one spread entry
  below" — the placement contract is pre-declared.
  No phrase symbols remain (P1.M1.T2.S3 stripped them).
- src/core/store.ts:
  - `topSuccessors(word): readonly Successor[]` (~L624): pure O(1) read of
    the top-3-per-word index; count-desc, byte-lex ties; returns LIVE array
    (read-only) or shared `NO_SUCCESSORS` (length 0) on a miss.
  - `recordBigramRuns(runs: readonly string[][])` (~L447): test/ingest feed —
    counts adjacent pairs per run (per-line arrays of admitted lowercase
    keys) and bumps the successor index.
  - `get bigramSize()` (~L630): count of stored bigrams, available if wanted.
- src/core/types.ts: `Successor { next: string; count: number }` (~L64).
- test/debug.test.ts: `see(store, key, display?, extra?)` upsert helper,
  `fakeStats` (all six gate counts distinct), `statsStub`, `fakePi`,
  `topRows` parser. Describes: "acwords dump (PRD §08)" (formatter) and
  "acwords registration" (debug:false → no registration; debug:true → one
  registration, notify "info"; fresh snapshot per invocation).
- test/successors.test.ts (rewritten P1.M1.T3.S3): fixture style for
  populating the index via recordBigramRuns run arrays.

## Architecture doc cross-refs

- plan/002_3e8a42cadf2c/architecture/core_phrase_layer_map.md §debug.ts:
  the deleted phrasesSection (132–160) contained the only successor sample
  (154–159) using store.topSuccessors; rendering style 'w → next ×N'.
- Same doc: PRD §09 h2.52 — no phrase multipliers exist; successor sample
  is the only M2 tuning surface for the debug command.

## Parallel-work contract (P1.M3.T1.S2, in flight)

- Re-points gate reads to `config.enableChaining` (enablePhrases =
  transitional mirror of the same resolved value). Consequence for this
  task: with chaining disabled, recordBigramRuns is never fed → the
  successor index is empty → the `(none)` rendering covers both "empty
  store" and "chaining disabled". debug.ts must NOT read config.

## Design decisions settled in the PRP

- Sample = first N (=10) of the ALREADY-computed top-50 rows that have
  non-empty topSuccessors (filter, don't render per-word "(no successors)"
  noise). Zero extra sorting, no second "now".
- Section text: header `successor index sample`, rows
  `  ${display} → ${next} ×${count}, ...`, fallback `  (none)`.
- No-phrase guard test: `expect(dump.toLowerCase()).not.toContain("phrase")`.