# Research — P1.M1.T2.S1(bugfix): Recalibrate REJECT/MID band constants

## Upstream contract (P1.M1.T1.S2, parallel)
- `dict/common-en.bin` regenerated from `tools/corpus/en-50k.tsv`
  (hermitdave/FrequencyWords 2018 en_50k, RAW surface forms, TAB-converted).
- Build pipeline untouched: `quant(rank) = 255 - floor(254*log2(1+rank)/log2(1+70000))`,
  denominator fixed at DICT_N=70,000 regardless of kept count (~49–50k).
  HAPX format v1, `DICT_VERSION=1` unchanged.
- After regeneration: `lookup('the')`≈255 max, ordering by real frequency.

## Curve arithmetic (external_deps.md §2, verified)
With denominator 70,000: rank 0→255, rank 100→q150, rank 500→q114,
rank 1000→q98, rank 5000→q64, rank 20000→q30.
Inverse (for target q, kept-rank r): q ≥ T ⇔ rank ≤ 2^((255-T)·log2(70001)/254) − 1.
- REJECT≈100 → rejects top ~900 ranks → 'the/with/this/them/context' all reject.
- MID≈40 → ranks ~900–7,500 land group 2; tail (7.5k–50k) group 1.
Starting points REJECT≈100, MID≈40; exact values must be MEASURED against the
regenerated artifact (node -e lookups + TSV line numbers as rank), not guessed.

## All hard-coded band literals in repo (grep 220 / 120 over src+test)
- src/core/score.ts — REJECT_COMMON_THRESHOLD=220 (L~49), MID_FREQ_THRESHOLD=120
  (L~54), module header band table (q===null→0, <120→1, <220→2, else reject).
- test/score.test.ts — 11 matches: export assertions (`toBe(220)`, `toBe(120)`),
  boundary cases q=119/120 (group boundary), q=219/220 (reject boundary),
  subword-clamp reject case (q=220), file header comment. Tests using the
  IMPORTED constants with synthetic dicts (e.g. `dict({tokenish:120})`) do NOT
  auto-adapt if literals stay — every hard-coded q literal in band tests must be
  recomputed to the new constants; safest pattern: rewrite boundary cases using
  the imported constants (`MID_FREQ_THRESHOLD`, `MID_FREQ_THRESHOLD - 1`, etc.)
  so future retunes can't desync the suite.
- test/helpers/bench-fixtures.ts L133–140,191 — synthetic-q distribution uses
  literal 120/220 split points; switch to imported constants to keep the
  50/30/20 group mix.
- test/provider.test.ts L279–294 — "q ≥ 220 rejects" test name/comments; uses
  literal q=220/219? check and convert to constants.
- test/ingest-pipeline.test.ts L72,213 — comment "120 ≤ 150 < 220" and a case
  asserting granite q=150 → group 2 (stays group 2 under REJECT≈100; verify).
- src/core/types.ts L13-14 — RankGroup doc comment band table.
- src/pi/config.ts L30, src/pi/debug.ts L27 — comment mentions "(220/120)".

## PRD anchors
- PRD §04 (h2.24): q ≥ REJECT → reject ("the", "context" class); bands baked
  constants, the ONLY tuning surface (spec/04, spec/08) — never config/env.
- spec/03 L102-103: curve/format change requires version bump — OUT OF SCOPE
  here; fallback piecewise curve only if band widening fails calibration review.
- Consumer: P1.M1.T2.S2 calibration test will assert lookup('the')≥REJECT and
  prose no-menu e2e against these constants.