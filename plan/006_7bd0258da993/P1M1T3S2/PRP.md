# PRP — P1.M1.T3.S2 (plan 006): Single mid-sentence capital — relaxed band max(R_eff, 95) + calibrate-bands Cap column

---

## Goal

**Feature Goal**: Implement spec §04 h2.28's "Casing-evidence admission
(single mid-sentence capitals)": a capitalized candidate whose occurrence
casing is `"mid-cap"` (capital NOT at a structural start — the properName
condition) admits under the relaxed band **`max(rEff(len), 95)`** — attested
below that band → group 1, absent → group 0. Capitalized candidates at
structural starts (`"structural-cap"`) get **no relaxation** — they admit on
the merits exactly as their lowercase form. properName drafts keep the
existing conjugation-guard skip (unchanged). Also update
`tools/calibrate-bands.mjs` so its `Cap:` column verdicts follow the 95 band
(+ the chain-only ceiling rules from S1).

**Deliverable**:
- `src/core/score.ts`: baked constant `MID_CAP_RELAXED_BAND = 95` (JSDoc,
  Mode A) + `AdmissionOptions.casing?: CasingClass` occurrence option that
  swaps the threshold to `Math.max(rEff(rejectAt, len), 95)` for `"mid-cap"`
  occurrences (before the reject compare; `"structural-cap"` and `"lower"`
  use the plain threshold).
- `src/pi/ingest.ts`: occurrence-level override in `#replayAdmitMemo` —
  when the memo's table verdict is `"reject"` but the occurrence's casing is
  `"mid-cap"`, re-run `admit(draft, dict, { casing, rejectCommonness })` and
  use that verdict for THIS occurrence's upsert/stats. **`#computeAdmitMemo`
  stays context-free** (memo key = `token.raw`; casing is occurrence
  context — verified hazard).
- `tools/calibrate-bands.mjs`: `Cap:` column = verdict under the 95 band +
  ceiling rules (mid-cap semantics), with a note comment.
- Score battery additions (boundary probes q 94/95/96, structural-start
  no-relaxation, "national"-class single, top-band single chain-only) and
  ingest battery additions.

**Success Definition**: `npm run check` + `npm test` green; mid-sentence
`"Zephyr"` with q=94 admits g1 while lowercase `zephyr` q=94 rejects; q=95
mid-cap rejects; structural-start `"Zephyr"` rejects at q=94 (no relaxation);
q ≥ ceiling mid-cap single is `"chain-only"` (S1's ceiling applies to singles
too); properName conjugation-guard skip intact.

## Why

- Spec goal 12: "mid-sentence capitals ease admission (runs fully, singles
  under a relaxed band); … never ranks." S1 (in-flight CONTRACT) restored
  run-level admission; this task completes the singles half.
- The retired relief (dead branch, `PROPER_NOUN_ADMIT_CEILING == floor`)
  admitted mid-cap words at group 2 — the audit's ~483-word noise leak. The
  95 band is the calibrated replacement: mid-relaxation only, group 1/0
  placement, top-band ceiling, structural starts excluded.
- The calibrate-bands Cap column is the calibration-history probe (spec 08
  h2.63: "run it after any retune") — leaving it at the old relief/flat
  semantics would make the tool's verdicts dishonest.

## What

### 1. score.ts

```ts
/** Relaxed band for single mid-sentence capitals — spec/04 h2.28
 *  ("Casing-evidence admission (single mid-sentence capitals)"). An
 *  occurrence whose casing class is "mid-cap" (capital NOT at a structural
 *  start — the properName condition) is admitted when q < max(R_eff(len),
 *  this value): the floor eases from 30 to 95 while the length ramp still
 *  rides above unchanged. Structural-start capitals get NO relaxation.
 *  Baked, NOT configurable (spec/08 h2.57 "capitalized-series admission
 *  band (95)"). Calibrated against the shipped artifact:
 *  `node tools/calibrate-bands.mjs national energy the echo reject`. */
export const MID_CAP_RELAXED_BAND = 95 as const;
```

- `AdmissionOptions` gains `casing?: CasingClass` (import from types.js).
- In `admit()`, resolve the effective threshold once, after
  `const threshold = rEff(rejectAt, draft.key.length);`:
  ```ts
  const eff = opts.casing === "mid-cap"
    ? Math.max(threshold, MID_CAP_RELAXED_BAND)
    : threshold;
  ```
  and compare `q >= eff` for the reject row (float compare — never round).
  Everything else — absent → 0, attested-admit flat at 1, relief branch
  (dead, untouched), conjugation guard with its `!draft.properName` skip,
  S1's `seriesMember` override (CONTRACT: it REPLACES the table path
  entirely, so it ignores `casing`) — unchanged.
- Note in the guard comment: properName (mid-cap) candidates continue to
  skip the conjugation guard (spec: "Capitalized (properName-hinted)
  candidates continue to skip the conjugation guard") — existing behavior,
  no edit needed beyond confirming the skip keys off `draft.properName`,
  which segment.ts sets from the mid-cap condition (P1.M1.T1.S1).

### 2. ingest.ts — occurrence-level override (memo untouched)

- `#computeAdmitMemo` (ingest.ts ~:728, keyed `token.raw`, context-free):
  **DO NOT TOUCH** — a sentenceStart-dependent relaxation cannot live in
  the memo (same raw token at a structural start vs mid-sentence shares one
  entry).
- In `#replayAdmitMemo` (~:767): the memo entry's verdict is currently
  applied as-is. Add: when the memo's table verdict is `"reject"` AND the
  occurrence's `draft.casing === "mid-cap"` (the draft carries `casing:
  CasingClass` per types.ts :87–90 — verified) AND the token passed the
  shape gate, re-run
  `admit(draft, this.#dictionary, { casing: draft.casing, rejectCommonness: this.#rejectCommonness })`
  and use the returned verdict for this occurrence (upsert + `stats.admitted`
  on 0|1; `"chain-only"`/`"reject"` → no upsert, per S1's semantics —
  chain-only singles stay out of the store; they have no series context
  here, so in practice a mid-cap single at q ≥ ceiling just rejects).
  Keep the `#isDisabled` re-check discipline (NEW-001) around the lookup.
- Reuse the memo's already-computed `q` if exposed; otherwise the re-run's
  lookup is one dictionary probe on the reject path only — acceptable
  (rejects are the minority and lookup is ~100 ns).
- JSDoc/comment: occurrence-level override mirrors S1's retro-override
  pattern; the memo stays context-free.

### 3. tools/calibrate-bands.mjs — Cap column

- Current Cap verdict: `admit(capDraft(lower), dict)` where `capDraft` sets
  `properName: true` — under the retired relief that showed the relief
  verdict. Update: pass `{ casing: "mid-cap" }` so the Cap column prints the
  relaxed-band verdict (the probe's purpose: "what happens to this word when
  capitalized mid-sentence"). Keep the lc verdict as-is. Add a short comment
  near the Cap column: *Cap verdicts follow the 95 relaxed band
  (MID_CAP_RELAXED_BAND) + the top-band chain-only ceiling for capitalized
  occurrences (spec/04 h2.26–h2.28); structural-start capitals admit as the
  lc column shows.*
- If `admit` returns `"chain-only"` the formatter `fmt` must print
  `CHAIN-ONLY` (extend `fmt`: `v === "chain-only" ? "CHAIN-ONLY"` — S1 adds
  the verdict; keep the padEnd width sane).
- Note comment at the top of the word-probe section (Mode A docs ride here).

### Success Criteria

- [ ] Score: mid-cap q=94 (floor-hold len) → g1; q=95 → reject; q=95 mid-cap at a length where R_eff > 95 (e.g. len 10, R_eff≈121.8) admits iff q < R_eff (max rule — ramp rides above)
- [ ] Structural-cap q=94 → reject (no relaxation; identical to lc verdict)
- [ ] "national"-class single (q=90, mid-cap) → g1; absent mid-cap → g0
- [ ] Mid-cap single at q ≥ PROPER_SERIES_TOP_BAND_CEILING → chain-only (ceiling applies to singles — S1 contract)
- [ ] Conjugation-guard skip intact: mid-cap "Uploaded" (stem `upload` q=200) admits; lowercase "uploaded" rejects
- [ ] Memo purity: "Zephyr" mid-sentence admits THIS occurrence; a structural-start "Zephyr" occurrence of the same raw token rejects (no memo contamination) — pinned by ingest test
- [ ] `node tools/calibrate-bands.mjs national echo the` shows Cap column per the 95 band (national Cap: g1, echo Cap: g1 if q<95, the Cap: chain-only/REJECT per ceiling)
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

"Yes": exact anchors for every edit site (verified against live code), the
S1 contract, the memo hazard, the calibration tool's current Cap probe, and
test conventions are all below.

### Documentation & References

```yaml
- file: plan/006_7bd0258da993/P1M1T3S1/PRP.md
  why: CONTRACT (in flight) — adds PROPER_SERIES_TOP_BAND_CEILING (≈135,
        calibrate!), AdmissionResult "chain-only", AdmissionOptions.seriesMember
        (replaces the table path entirely, ignores casing), RunMember
        retro-override at run finalization. Consume; do not re-implement.
  gotcha: chain-only members are never upserted; singles hitting the
        ceiling outside a run simply reject/chain-only with no store entry.

- file: src/core/score.ts
  why: edit site. REJECT_COMMON_THRESHOLD=30, rEff(:188–196 — callers pass
        RESOLVED floor; 256 sentinel at len≥20), AdmissionResult/
        AdmissionOptions(:~200–215), admit() threshold compare(:~282–310),
        relief dead branch (leave untouched), conjugation guard properName
        skip.
  gotcha: float compare, never round. The max() rule: ramp values ABOVE 95
        stay (R_eff rides above unchanged); only sub-95 floors lift to 95.

- file: src/core/types.ts
  why: CasingClass = "lower" | "mid-cap" | "structural-cap" (:73);
        CandidateDraft.casing (:87–90) — occurrence context, set by
        segment.ts from token.sentenceStart (P1.M1.T1.S1, landed).

- file: src/pi/ingest.ts
  why: edit site. #computeAdmitMemo(:~728, CONTEXT-FREE — DO NOT TOUCH),
        #replayAdmitMemo(:~767, entries.push + this.#store.upsert +
        draft.casing available), #rejectCommonness knob forwarding
        pattern (mirror #computeAdmitMemo), NEW-001 isDisabled re-check
        after admit() lookups.
  gotcha: the override must fire ONLY on the memo's reject path — an
        eagerly-admitted word needs no second look; and only for mid-cap
        occurrences (structural-cap/lower keep the memo verdict).

- file: tools/calibrate-bands.mjs
  why: edit site. Word-probe mode: capDraft() sets properName:true and the
        Cap column prints admit(capDraft(lower)) — switch to passing
        { casing: "mid-cap" }; fmt() needs a CHAIN-ONLY arm. Requires
        Node ≥ 23.6.

- file: test/score.test.ts / test/ingest.test.ts
  why: battery conventions — in-memory dictionary doubles (plain maps per
        the Dictionary contract), boundary probes via imported constants,
        describe-per-rule; ingest battery uses real core chain + fake dict.

- file: plan/006_7bd0258da993/architecture/01-core-pipeline-r1.md
  why: §2 occurrence-vs-memo seam (the memo hazard this design honors),
        §5 score detail, §8 low-risk-path table.
```

### Current Codebase tree (relevant)

```bash
src/core/score.ts            # MID_CAP_RELAXED_BAND + casing option
src/pi/ingest.ts             # occurrence-level override in #replayAdmitMemo
tools/calibrate-bands.mjs    # Cap column semantics
test/score.test.ts           # boundary battery
test/ingest.test.ts          # occurrence-purity battery
```

### Desired Codebase tree

Same files — no new files.

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: the relaxation is OCCURRECTION-level (casing class lives on
// the occurrence/draft, never the memo). Memoizing it would admit every
// structural-start "Zephyr" after one mid-cap sighting.

// GOTCHA: max(), not replacement: at len ≥ 10 R_eff exceeds 95 — the
// mid-cap band must NOT loosen those (a q=100 mid-cap at len 10 rejects).

// GOTCHA: "chain-only" from the singles path has no series context in
// ingest (runs finalize elsewhere, S1's retro-override owns run members).
// A mid-cap single over the ceiling: no upsert, no stats.admitted.

// GOTCHA: relief branch (PROPER_NOUN_ADMIT_CEILING == floor) must remain
// dead and untouched; existing pin tests protect it.

// GOTCHA: guard skip keys off draft.properName (segment.ts sets it from
// the mid-cap condition) — do not switch it to read opts.casing.

// calibrate-bands.mjs needs Node ≥ 23.6; in-memory dict doubles in tests
// (no binary); NodeNext ".js" relative imports.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: ADD score battery (red) — test/score.test.ts, describe
  "single mid-cap relaxed band (h2.28)":
  - dictionary double {zephyr: 94, national: 90, echo: 96?, ...};
    boundary via imported MID_CAP_RELAXED_BAND: q=94 mid-cap → g1,
    q=95 mid-cap → reject, q = band−1 / band exact;
  - max rule: len-10 word q=100 mid-cap → reject (R_eff(10)≈121.8 > 95
    and q < R_eff... pick q=115 <121.8 → g1 via ramp; q=95 at len 4 →
    reject shows floor lifted exactly to 95);
  - structural-cap q=94 → reject (opts.casing "structural-cap");
  - casing omitted (default/legacy callers) → plain threshold (back-compat);
  - ceiling: mid-cap q ≥ PROPER_SERIES_TOP_BAND_CEILING → "chain-only"
    (only when seriesMember ALSO true? NO — per S1 the ceiling lives in
    the seriesMember branch; for a NON-series mid-cap single at top-band q,
    assert plain "reject" under max(rEff,95) since q ≥ 135 ≥ 95 anyway —
    verify against S1's landed code and pin whichever verdict it gives);
  - guard skip: {"upload": 200}, mid-cap "Uploaded" (properName draft)
    → g1/g0; lowercase → reject.

Task 2: EDIT src/core/score.ts
  - MID_CAP_RELAXED_BAND = 95 + calibration JSDoc (run
    `node tools/calibrate-bands.mjs national energy echo the windows`
    and record q's in the JSDoc).
  - AdmissionOptions.casing?: CasingClass; eff = max(threshold, band) for
    "mid-cap"; reject compare uses eff. Mode-A JSDoc citing h2.28.

Task 3: ADD ingest battery (red) — test/ingest.test.ts:
  - "then Zephyr checked" (fake dict zephyr=94) → "zephyr" stored g1;
    same dict lowercase message "zephyr checked" → not stored;
  - memo purity: one message with structural-start "Zephyr" then a later
    message with mid-sentence "Zephyr" (and reverse order) — each
    occurrence's verdict independent;
  - mid-cap absent word → stored g0;
  - mid-cap over ceiling → not stored, stats.admitted unchanged.

Task 4: EDIT src/pi/ingest.ts — #replayAdmitMemo override per What §2;
  knob forwarding; isDisabled re-check; comments (memo stays
  context-free, override mirrors S1's retro pattern).

Task 5: EDIT tools/calibrate-bands.mjs
  - Cap probe passes { casing: "mid-cap" }; fmt() CHAIN-ONLY arm; note
    comment (Cap verdicts follow the 95 band + ceiling rules); extend the
    header line to mention the Cap band.

Task 6: VALIDATE — npm run check; npx vitest --run test/score.test.ts
  test/ingest.test.ts test/calibration.test.ts (if it pins Cap semantics —
  check and repair); full npm test. Read-only probe:
  node tools/calibrate-bands.mjs national echo the — record output.
```

### Implementation Patterns & Key Details

```ts
// score.ts (sketch):
const threshold = rEff(rejectAt, draft.key.length);
const eff = opts.casing === "mid-cap"
  ? Math.max(threshold, MID_CAP_RELAXED_BAND) : threshold;
...
else if (q !== null && q >= eff) result = "reject";

// ingest.ts #replayAdmitMemo (sketch, reject path only):
if (memoVerdict === "reject" && draft.casing === "mid-cap") {
  if (this.#isDisabled?.()) break; // NEW-001 discipline
  const retry = admit(draft, this.#dictionary,
    { casing: draft.casing, rejectCommonness: this.#rejectCommonness });
  if (retry === 0 || retry === 1) { /* upsert sighting, stats.admitted++ */ }
}
```

### Integration Points

```yaml
CODE: src/core/score.ts, src/pi/ingest.ts, tools/calibrate-bands.mjs
TESTS: test/score.test.ts, test/ingest.test.ts (+ repair any Cap-column pin)
CONSUMES: CasingClass/draft.casing (P1.M1.T1.S1, landed); S1's
  seriesMember/chain-only/ceiling (CONTRACT, in flight)
FROZEN: #computeAdmitMemo, store.ts, query.ts, relief branch, ordinary
  run/bigram semantics, provider/widget
DOWNSTREAM: P3.M1.T2.S3 live smoke uses calibrate-bands output as evidence;
  P1.M2.T1.* casing resolver is unaffected (admission ≠ display)
```

## Validation Loop

### Level 1: Types + targeted

```bash
npm run check
npx vitest --run test/score.test.ts test/ingest.test.ts test/calibration.test.ts
```

### Level 2: Full suite

```bash
npm test
```

### Level 3: Calibration probe (updated tool)

```bash
node tools/calibrate-bands.mjs national energy echo the windows
# national (q~90): lc REJECT, Cap g1. echo (q<95): Cap g1. the (q~240):
# Cap chain-only/REJECT per ceiling+95 rules. Record in JSDoc.
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green
- [ ] MID_CAP_RELAXED_BAND = 95 baked, JSDoc'd with probe command + q's; NOT configurable (08 h2.57)
- [ ] max(R_eff, 95): floor-hold lengths lift to 95; ramp lengths > 95 unchanged
- [ ] Structural-start capitals: zero relaxation (identical to lc verdict)
- [ ] Memo context-free; occurrence purity pinned both orders
- [ ] Chain-only/ceiling interplay pinned (whatever verdict S1's landed code gives for non-series top-band singles — reject under max(rEff,95))
- [ ] Conjugation-guard properName skip intact
- [ ] calibrate-bands Cap column updated + note comment; calibration.test.ts (or any Cap pin) repaired, not deleted
- [ ] Diff confined to score.ts, ingest.ts, calibrate-bands.mjs, the two test files

## Anti-Patterns to Avoid

- ❌ Putting casing/relaxation in the memo (occurrence context, memo key = raw)
- ❌ Replacing R_eff with 95 (max, not swap) or rounding the float compare
- ❌ Relaxing structural-start capitals (h2.28 is explicit: no relaxation)
- ❌ Reviving/touching the relief branch or making 95 a config knob
- ❌ Switching the guard skip off `draft.properName`
- ❌ Upserting chain-only singles or bumping stats for non-admitted occurrences
- ❌ Touching S1's seriesMember path semantics (consume, don't modify)
- ❌ Ordering changes of any kind — casing admits, never ranks

---

**Confidence Score: 8/10** — every edit site is verified against live code
(score.ts threshold compare, ingest.ts memo/replay seam + draft.casing,
calibrate-bands Cap probe), the S1 contract is explicit, and the memo hazard
is designed around; residual risk is the exact verdict for non-series
top-band singles (depends on S1's landed shape) — Task 1 handles it by
pinning whatever the contract yields.
