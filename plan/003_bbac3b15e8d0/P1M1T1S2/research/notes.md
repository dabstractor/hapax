# Research notes — P1.M1.T1.S2 (plan 003): conjugation guard rides R_eff; MID demoted; relief stays dead

## Sources examined
- src/core/score.ts (~L219-290, guard block read verbatim). Current guard:
  `if (result !== "reject" && !draft.properName) { for (const stem of
  inflectionStems(draft.key)) { const qs = dictionary.lookup(stem);
  if (qs === null) continue; if (qs >= rejectAt || (q === null && qs >=
  MID_FREQ_THRESHOLD)) { result = "reject"; break; } } }`
  → S2 change: compute `threshold = rEff(rejectAt, draft.key.length)` (the
  WORD's length) and replace both comparisons with `qs >= threshold`.
  inflectionStems is module-private (L160), unchanged. properName skip and
  subword coverage unchanged. Relief block (L240-253) untouched: ceiling 12
  ≤ every R_eff when R ≥ 12 → dead for all knob values ≥ 12; for knob R < 12?
  r1 doc says ceiling == floor keeps it dead... actually ceiling is a fixed
  const 12; with R > 12 (stricter knob) it stays dead; with R < 12 (looser)
  relief needs q < 12 and q >= rEff(...) — rEff ≥ R < 12 could allow q in
  [rEff,12) at short lengths... The contract says "ceiling 12 <= every
  R_eff when R >= 12 (and for knob R > 12 it stays dead)" — restrict the
  pin test to R ≥ 12 knob domain. Check test/config.test.ts clamps
  rejectCommonness range; pin test uses default/≥12.
- P1M1T1S1 PRP (contract): exports `rEff(floor, len)` (sentinel 256 at
  len ≥ 20), `REJECT_LEN_FLOOR=8`, `REJECT_LEN_FULL=20`; admit() table uses
  `q >= rEff(rejectAt, draft.key.length)`; guard/relief/clamp byte-identical
  after S1; MID table row deleted, MID_FREQ_THRESHOLD still exported.
- MID_FREQ_THRESHOLD importers: test/score.test.ts (pin = 20, boundary
  fixtures), tools/calibrate-bands.mjs (verdicts, summary, bands — S3 makes
  it R_eff-aware), test/helpers/bench-fixtures.ts (quants). Contract mentions
  test/config.test.ts as importer too (verify at implementation; regardless:
  keep the export + its pin).
- Boundary words measured (contract): `uploads` (absent, stem `upload` q=38,
  len 7 → rEff(12,7)=12) → qs 38 ≥ 12 → REJECT (unchanged). `configurations`
  (absent, stem `configuration` q=26, len 15 → rEff(12,15) ≈ 197.2) → 26 <
  197.2 → tier-1 no longer fires... wait: word is ABSENT so today tier-1
  `qs >= rejectAt` (26 ≥ 12) REJECTS; new: 26 < rEff(15) ≈ 197 → ADMITS
  (group 0). Contract says REJECTS today via tier-1, must FLIP to ADMIT. ✔
- rEff arithmetic (from S1): rEff(12,15) = 12 + 243·√(7/12) ≈ 197.24.
- Tests: express boundary quants relative to imported constants where
  possible (e.g. stem q = rEff(12,7) computed, or REJECT_COMMON_THRESHOLD+26).
  Stub dict pattern: `const dict = (entries) => ({ lookup: k => entries[k] ?? null })`,
  draft helper at test/score.test.ts.
- spec/09 h2.55 score.test.ts conjugation bullet = the test posture for S2.

## Key decisions
- Single threshold variable inside admit() (S1 already computes it for the
  table); guard reuses it — pass/compute once, no recompute.
- MID_FREQ_THRESHOLD: JSDoc updated to "compatibility constant (2026-10
  retired from guard); retained for tools/tests"; value 20 unchanged; pin kept.
- Relief pin test: capitalized table-reject never relieves under the ramp —
  e.g. 9-char capitalized word with q ≥ rEff: result reject, relief needs
  q < 12 → impossible since q ≥ 12 floor at ≤8... at ramp lengths q could be
  in [rEff,∞) ≥ 12 → still ≥ ceiling 12 → dead. Long capitalized ADMIT via
  table (q < rEff) at group 1, NOT via relief.
