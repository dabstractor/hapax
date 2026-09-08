# Research — P1.M4.T1.S1 full-suite regression + acceptance re-measurement

## Verified state (git log / ls)

- BUG-001..BUG-003 fix commits landed (ce61c24 battery, 603290d sub-word
  poisoning, 17f2a0e 32-char mask, c49082f NREL pin, f438272 relief
  ceiling=95 tuned via prose A/B). P1.M1/P1.M2 all Complete.
- P1.M3.T1.S1 (astral boundary) Implementing; P1.M3.T2.S1 (bigram cap
  drain loop in store.ts + bigrams.test.ts rewrite) Implementing — this
  sweep runs AFTER both land (dependency ordering).
- Suite files now include `chaining-gating.test.ts` and `bigrams.test.ts`;
  last recorded green baseline: 636 tests, tsc clean
  (architecture/spec-acceptance-map.md L20). Counts will grow past 636.
- docs/M1-DoD.md already has §09 item re-verification sections:
  "### Item 5 — raw-text-adjacency window breaks" (~L291), "### Item 6 —
  forced single-item returns" (~L318), item 7 chain section around L209.
  NOTE: PRD §09 items 5/6/7 in THIS bugfix refer to the acceptance items
  (5=secrets, 6=stock parity, 7=NREL chain) — the M1-DoD item numbering
  differs (its items 5/6 are window-breaks/forced-single-item). The
  evidence doc has both: integration items 1–7 sections exist; update the
  INTEGRATION item 5/6/7 sections, don't confuse them with M2 DoD
  subsection numbering.
- Known recorded gap "successorIndex eviction cleanup" in docs/M1-DoD.md
  (≈L48 area / M2 sections) is explicitly OUT OF SCOPE per contract — do
  not expand it.
- Commands: `npm test` (vitest --run), `npm run check` (tsc --noEmit =
  DoD substitute for nonexistent pi --check), `npm run bench`, targeted
  `npx vitest --run <file>`.
- Fix-conflict hotspots named by contract: calibration/shipped-dict
  (relief band 95 interacts with band tests), acceptance items 5/6/7,
  adversarial-ingest/typing (mask floor 32 + parent-secret poisoning),
  provider/chain (delegation + reset), segment/bigrams/store,
  perf-gates (3× budgets; bigram drain loop adds eviction work to a
  recordBigramRuns call).
- Evidence destinations: docs/M1-DoD.md integration-item sections (Mode A,
  this task) + numbers consumed by P1.M4.T2.S1 (README) and
  P1.M4.T2.S2 (bugfix-001 record appended to M1-DoD.md — separate task,
  don't write their sections).
- Fix policy: prefer fixing the FIX over weakening spec-derived tests;
  document judgment calls.
