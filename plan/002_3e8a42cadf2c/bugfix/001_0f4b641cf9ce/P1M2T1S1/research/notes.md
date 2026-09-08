# Research notes — P1.M2.T1.S1 (bugfix 001_0f4b641cf9ce): proper-noun relief band in admit()

## Verified codebase facts
- `src/core/score.ts` (read in full):
  - `admit(draft, dictionary, parentGroup?)` at ~L109–135: `q === null → 0; q >= REJECT_COMMON_THRESHOLD → "reject"; q >= MID_FREQ_THRESHOLD → 2; else 1`; subword clamp `Math.min(2, Math.max(result, parentGroup + 1))` applied only for subwords with parentGroup; `'reject'` returns BEFORE the clamp.
  - Exported baked constants: `REJECT_COMMON_THRESHOLD = 50`, `MID_FREQ_THRESHOLD = 20` (both `as const`, extensively JSDoc'd with BUG-001 calibration history).
  - Module header doc-comment describes the admission table — needs the relief band documented (Mode A).
  - No proper-noun handling in admission today (properName only feeds salience W_PROPER_NAME=0.8).
- `CandidateDraft` (src/core/segment.ts:231–241): `{ key, display, properName (first char of display uppercase at extraction), isSubword, parentKey? }`.
- `test/score.test.ts`: existing suite uses two local helpers — `draft(word, isSubword?, overrides?)` building a CandidateDraft and `dict(map)` stubbing Dictionary via a plain map (`lookup` returns map value ?? null). Header pins boundary cases expressed via imported constants so the suite survives recalibration. New tests extend the `admit` describes; import `PROPER_NOUN_ADMIT_CEILING` and express boundary cases via the constant.
- `tools/calibrate-bands.mjs`: Node ≥23.6 native-TS probe; imports real `loadDictionary` + `admit` + both constants; exit 0 = constants satisfy contract. Run it to sanity-check the ceiling against the shipped dict.
- `test/calibration.test.ts` (BUG-001 gate, must stay green): probes lowercase common words (the/with/this/them/context + COMMON_PROBES like posts/thin/firs) — all lowercase, so the properName relief (requires `draft.properName === true`) cannot touch it.
- Shipped dict lookups (bugfix PRD, e2e-verified): national=90, energy=94, laboratory=57, renewable=19; the=240, with=179, this=197, them=156, context=51.
- `architecture/core-engine-findings.md` — chosen fix verbatim: relief band `if (result === "reject" && !draft.isSubword && draft.properName && q !== null && q < PROPER_NOUN_ADMIT_CEILING) result = 2;` with ceiling 120 (must satisfy 94 < ceiling ≤ 156; 120 = original spec mid-band boundary). Admission ⇒ words enter adjacency runs ⇒ bigrams form (§06) — no separate bigram change.
- Previous sibling item (P1.M1.T2.S2): editor-sim integration test for trigger consumption during chains — touches provider tests only, no score.ts overlap.
- Downstream: P1.M2.T1.S2 (tuning protocol re-run), P1.M2.T1.S3 (pin the NREL acceptance phrase e2e).

## Semantics decisions
- Relief placement: compute `q`/`result` as today; apply the relief AFTER the table, BEFORE the reject early-return — i.e. if relief fires, `result = 2` and the token admits at group 2. Sub-words never relieved (`!draft.isSubword` guard); the existing clamp then applies to subwords of relieved parents via parentGroup=2 (max(table,3)→saturate 2 — subwords of a relieved parent land group 2 at best, exactly the "still clamped" requirement).
- Boundary expression in tests: use the imported `PROPER_NOUN_ADMIT_CEILING` (q = ceiling → reject; q = ceiling−1 → admit group 2) so the suite survives a ceiling retune within (94, 156].
- capitalized 'The' at q=240: 240 ≥ 120 → still reject. Lowercase 'national' at q=90: properName=false → reject. ✓
