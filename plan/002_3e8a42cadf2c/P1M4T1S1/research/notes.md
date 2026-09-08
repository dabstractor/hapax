# Research — P1.M4.T1.S1 full check + M1 regression re-run

## Verified state

- The D2 delta (drop phrase layer, bigram successor index, zero-char
  chaining, forced single-item Tab, enableChaining config) has landed:
  `test/phrases.test.ts` and `test/phrase-gating.test.ts` are GONE;
  `test/bigrams.test.ts` EXISTS; `test/chain.test.ts` rewritten.
  P1.M3.T1.S2 (gate reads) is Complete; P1.M3.T2.S1 (/acwords successor
  dump + debug.test.ts update) is Implementing in parallel — this task's
  `npm test` gate must run AFTER it lands (dependency-ordered by the
  orchestrator).
- Suites that MUST re-run green (tests_docs_inventory.md §1 "M1 acceptance
  suites"): provider.test.ts (never-hijack a–g), perf-gates.test.ts +
  bench/core.bench.ts, no-persistence.test.ts, acceptance.test.ts.
- Scripts: `npm run check` = tsc --noEmit strict; `npm test` = vitest --run;
  `npm run bench` = vitest bench. No vitest.config.* (defaults).
- docs/M1-DoD.md records prior PASS at c138b5b: 24 files / 413 passed /
  1 skipped (gc-dependent dictionary skip). Counts WILL differ now
  (phrases suite deleted, bigrams added, chain rewritten).
- perf gates (PRD §09 h2.51): 20k-candidate query <1 ms p99; dict load +
  20k-word sweep <60 ms; ingest 800 KB <60 ms yielding every ≤64 KB;
  steady-state heap <6 MB. CI-style: perf-gates.test.ts asserts hard 3×
  bounds (KEEP GREEN); core.bench.ts reports actual numbers — capture them.
- Delta-specific risk: "span threading" (RawToken spans → adjacency bigram
  capture) and the "slim bigram map" must not regress the ingest/heap gates.
- Evidence destination: this task writes evidence ONLY (no docs edits —
  docs/M1-DoD.md annotation belongs to P1.M4.T1.S2). Record in
  `plan/002_3e8a42cadf2c/P1M4T1S1/research/regression-evidence.md` so S2
  and P1.M4.T2.S1 (README sweep) can consume it.
- Head commit + environment must be recorded in the evidence (mirror
  M1-DoD.md's header style: date, `git rev-parse HEAD`, node/pi versions).
- Triage rule from contract: on failure, attribute to the owning subtask's
  PRP contract BEFORE touching code; only fix in place if the failure is
  this sweep's own harness.
- Never-hijack extension: the forced single-item Tab branch (P1.M2.T2)
  changed provider behavior — provider.test.ts was extended for it; the
  re-run is the regression proof the branch didn't break a–g.