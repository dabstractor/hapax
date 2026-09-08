# Research notes — P1.M4.T1.S2: M2 DoD item-by-item audit + record results

## Verified codebase facts

- **Prior record**: `docs/M1-DoD.md` is the M1 evidence record (sweep
  2026-09-07, head c138b5b, 24 files / 413 passed / 1 skipped; perf actuals
  p99 0.147 ms / 4.3 ms / 134.7 ms / 8.94 MB; honesty note about gates c+d
  in the 1×–3× band; command-substitution table for the nonexistent
  `pi --check`; "Files changed" + "Reproduction" sections at the tail).
  This task APPENDS a post-delta M2 section to this file — it is the doc
  the change touches directly (contract Mode A).
- **Sibling contract**: P1.M4.T1.S1 (running in parallel) produces
  `plan/002_3e8a42cadf2c/P1M4T1S1/research/regression-evidence.md` —
  M1-side evidence: fresh suite counts, 4 perf-gate numbers, never-hijack
  verdicts, no-persistence grep, environment header (head commit, node,
  vitest, pi). CONSUME it; do not re-run the M1 gauntlet (except
  spot-citing specific M2-relevant suites).
- **M2 DoD checklist (h2.54, rewritten)** and where each item's tests live
  (all verified present in test/):
  - successor-index chaining state machine + ZERO-typed-char successor
    offers + live successor filtering + threshold-0 during chain:
    `test/chain.test.ts` — describe "chain machine — armed successor
    chaining (PRD §07 h2.43, plan 002 S1 redesign)" (16 cases).
  - chain reset on before_agent_start: `test/chain.test.ts`
    "reset() forces idle — the before_agent_start rule…" (~line 478).
  - one-word invariant: `test/chain.test.ts` "one-word invariant: every
    chain item value is a single word…" (~line 547) + comment at ~181
    referencing `test/helpers/query-invariants.ts assertWordsOnly`.
  - raw-text-adjacency window breaks (commas; quotes/brackets/backticks;
    digits; non-word chars; intervening words — stopword bridging
    forbidden; newlines): `test/successors.test.ts` "strict adjacency
    end-to-end: punctuation breaks, whitespace-only gaps chain, stopword
    bridges are forbidden" (~line 128) + `test/ingest-pipeline.test.ts`
    describe "onAdmittedTokens — adjacency runs (…, P1.M1.T3.S2)"
    (~line 346, break-case suite incl. "a rejected word between two
    admitted words breaks the run (no stopword bridging)" ~446 and
    "ZorpWibbleEngine, quuxblat never chains (the stopword-bridge bug
    class)" ~465).
  - forced single-item Tab (P1.M2.T2.S1, R3 "Tab only ever completes"):
    `test/provider-live.test.ts` describe "forced single-item returns
    (PRD §07 h3.8)" (~line 294) — force:true → exactly the live top,
    prefix unchanged; force absent/false → byte-identical legacy; options
    object identity preserved through delegation (~103–113).
  - integration item 7 (National → Renewable → Energy → Laboratory, zero
    additional typed chars): `test/chain.test.ts` describe "replayed-store
    arming end-to-end (real ingest pipeline, NREL fixture — the PRD §09
    item-7 route, h2.54)" (~line 678).
- **architecture/system_context.md "Key decisions"** (read in full):
  adjacency-run computation in ingest via `/^[ \t]+$/` gap test, slim
  bigram map `Map<"first second",{count,lastSeenOrdinal}>` capped 10,000,
  force branch truncation semantics, chain redesign (bare values,
  threshold 0, zero-char offer), config alias enablePhrases→enableChaining,
  PRD-internal inconsistency note (h2.49 CJK bullet overridden by R2), and
  **known pre-existing gap #7**: `evictIfOverCap` does not clean
  `#successorIndex` — out of delta scope, must be NOTED in the DoD record,
  not fixed.
- **tests_docs_inventory.md** documents which suites were deleted/rewritten
  (phrases.test.ts and phrase-gating.test.ts gone; bigrams/chain/config/
  debug rewritten; provider* extended) — the "new suite/file counts after
  the phrase deletions" numbers come from S1's evidence file.
- Test count check at research time: `test/` currently holds 34 test files
  (incl. new bigrams.test.ts; phrases.test.ts absent — verified).
- Bench file: `test/bench/core.bench.ts`; gate test `test/perf-gates.test.ts`.

## Audit method (mirrors M1-DoD.md format)
- Per DoD item: exact command (`npx vitest --run test/<file> -t "<case>"`),
  PASS/FAIL, test names, date; failures triaged to owning subtask PRPs
  (P1.M1.T3.S2 breaks / P1.M2.T1.S2 chain+item7 / P1.M2.T2.S1 forced) —
  but per the task tree those are Complete, so failures mean drift: fix
  minimally toward contract, log in triage section.
- S1's evidence file supplies environment header + overall counts; cite it
  rather than duplicating.
## Audit results (2026-09-08, HEAD 5739b09) — recorded in docs/M1-DoD.md

Task 0: S1's evidence file present at
plan/002_3e8a42cadf2c/P1M4T1S1/research/regression-evidence.md (sweep
2026-09-08 at 1b71807). HEAD moved to 5739b09 = S1's own docs-only evidence
commit; `git diff --name-only 1b71807..HEAD -- src/ test/` is empty →
counts/bench re-captured fresh at 5739b09 anyway and match S1's.

Per-item runs (all PASS, full commands in the doc):
1. chain machine describe: 15/15 (`-t "chain machine — armed successor chaining"`)
2. same describe — filtering/disqualification cases named in the doc block
3. reset case: 1/1 — GOTCHA hit: `-t "reset() forces idle"` matched 0
   (parens are pattern syntax); `-t "forces idle"` matches exactly 1
4. one-word invariant: 1/1; assertWordsOnly consumed by query/acceptance/chain suites
5. successors strict-adjacency 1/1; ingest onAdmittedTokens describe 43/43;
   all six h2.54 break categories mapped to named cases (comma it.each,
   brackets/backtick its, digits+hexish, symbol it.each, two stopword-bridge
   cases, newline/line-break cases) — no gaps
6. forced single-item describe: 8/8
7. NREL end-to-end: 2/2. Zero-typed-char property CONFIRMED in the body
   (typeSpace-only between accepts; both offers assert prefix === "" with
   bare values). Coverage note recorded: third link energy→laboratory not
   Tab-completed by the test; bigram exists in the replayed index (fixture
   has the full 4-gram 4×).

Fresh numbers at 5739b09: npm run check exit 0; npm test 33 files / 636
passed / 1 skipped (identical to S1); perf-gates 6/6 (a p99 0.112ms,
b 4.3ms, c 191.8ms WATCH, d 2.92MB, e 230.5ms, f 105.1ms WATCH); bench
means 0.0287/1.86/174.1/12.2ms.

Triage log: empty. Verdict: M2 (D2 redesign) DONE.
