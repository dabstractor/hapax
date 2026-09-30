# PRP — P1.M1.T1.S2 (plan 003): Conjugation guard rides R_eff(len(word)); MID demoted to compatibility constant; relief stays dead

---

## Goal

**Feature Goal**: Update `admit()`'s conjugation guard (src/core/score.ts,
~L269-283) so BOTH tiers compare the stem's quant against the
length-conditioned threshold `rEff(rejectAt, draft.key.length)` — the WORD's
length, not the stem's — per spec/04 h2.26 (2026-10). Tier-2's
`MID_FREQ_THRESHOLD` comparison is removed (subsumed); `MID_FREQ_THRESHOLD`
remains exported unchanged as a compatibility constant. The proper-noun
relief stays retired-in-place, now pinned by a test proving no capitalized
table-reject ever relieves under the ramp.

**Deliverable**:
- Modified guard block in `src/core/score.ts` (~5 lines) + JSDoc updates
  (guard comment + MID_FREQ_THRESHOLD's doc noting 2026-10 retirement)
- New TDD block in `test/score.test.ts`: guard-rides-R_eff boundary cases +
  the relief-dead pin

**Success Definition**: `uploads` (absent, stem `upload` q=38, len 7) still
REJECTS; `configurations` (absent, stem `configuration` q=26, len 15) FLIPS
from reject to ADMIT (group 0); knob moves the guard's floor with the curve;
relief pin passes; full `npm test` + `npm run check` green.

## Why

Spec/04's 2026-10 long-word gradient loosens the table's reject band as
words lengthen, but the guard's stem comparisons still ride the flat floor
(tier-1 `qs >= rejectAt = 12`, tier-2 `qs >= 20`) — so every long absent
inflection of ANY attested stem (`configurations`, `deactivations`, …) is
still rejected, exactly the noise-vs-value miscalibration the gradient was
adopted to fix ("at ramp lengths the guard loosens with the table", spec
h2.26). Both tiers riding the same `R_eff(len(word))` the table uses makes
the guard and table move together under the `rejectCommonness` knob too.

## What

In `admit()`'s conjugation-guard block, replace both stem comparisons with
one threshold computed from the WORD's length:

```typescript
// Current (S1-landed state; table row already rides rEff):
if (result !== "reject" && !draft.properName) {
  for (const stem of inflectionStems(draft.key)) {
    const qs = dictionary.lookup(stem);
    if (qs === null) continue;
    if (qs >= rejectAt || (q === null && qs >= MID_FREQ_THRESHOLD)) {
      result = "reject";
      break;
    }
  }
}

// New (2026-10): both tiers ride the SAME length-conditioned threshold
// of the word being admitted — R_eff(len(word)), not the stem's length.
if (result !== "reject" && !draft.properName) {
  const guardAt = rEff(rejectAt, draft.key.length); // the WORD's length
  for (const stem of inflectionStems(draft.key)) {
    const qs = dictionary.lookup(stem);
    if (qs === null) continue;
    if (qs >= guardAt) {           // tier-1 AND tier-2 — MID subsumed
      result = "reject";
      break;
    }
  }
}
```

Everything else is unchanged: properName drafts still skip the guard;
subwords still guarded; `inflectionStems` untouched; one stripping level,
no recursion; the relief block and subword clamp byte-identical;
`MID_FREQ_THRESHOLD` stays exported (value 20, pin kept) with JSDoc noting
it is a 2026-10-retired compatibility constant retained for
`test/score.test.ts`, `tools/calibrate-bands.mjs` (R_eff-aware in S3), and
`test/helpers/bench-fixtures.ts`.

### Success Criteria

- [ ] `uploads` (7c, absent, stem `upload` q=38 ≥ rEff(12,7)=12) → "reject"
- [ ] `configurations` (15c, absent, stem `configuration` q=26 <
      rEff(12,15)≈197.2) → admits at group 0 (flips from today's tier-1 reject)
- [ ] Tier-1 unchanged at floor lengths: `caching` (absent, stem `cache`
      q=30 ≥ 12 at len 7) still rejects; `deleted` (stem `delete` q=51 ≥ 12,
      len 7) still rejects
- [ ] Knob scaling: with `{ rejectCommonness: 40 }`, a short absent
      inflection whose stem q=38 no longer rejects at floor
      (38 < 40), and with knob 12 it does — the guard floor moves with the curve
- [ ] properName skip intact: `Uploads` (capitalized) bypasses the guard
- [ ] Relief-dead pin: a capitalized 9-char table-reject (q ≥ rEff(12,9)≈82)
      does NOT relieve; a long capitalized word admits via the TABLE at
      group 1 (not relief/group 2)
- [ ] `MID_FREQ_THRESHOLD` still exported, === 20 pin green, no importer breaks
- [ ] `npm test` + `npm run check` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the current guard body is
quoted verbatim, S1's `rEff` contract is given (formula + sentinel), the
boundary arithmetic is pre-computed, and the test conventions (dict stub,
draft helper, existing pins) are documented.

### Documentation & References

```yaml
- file: src/core/score.ts
  why: The ONLY source file to modify. Current guard block (~L269-283) is
        quoted verbatim in "What". Context you can rely on post-S1:
        - admit() computes `const rejectAt = opts.rejectCommonness ??
          REJECT_COMMON_THRESHOLD;` and the table row is already
          `q >= rEff(rejectAt, draft.key.length)` (S1's deliverable).
        - rEff(floor, len): floor hold len<=8; sqrt ramp 8<len<20;
          returns 256 sentinel at len >= 20 (admit-all — stems can never
          reject there either, correct per spec: guard loosens with table).
        - inflectionStems(word) is module-private (~L160): one-level strips
          of -s -es -ed -d -ing -ly, e-restoration, doubled-consonant undo.
          UNCHANGED.
        - Relief block (~L240-253) sits BEFORE the guard and after the
          table; requires result==="reject" && !isSubword && properName &&
          q !== null && q < PROPER_NOUN_ADMIT_CEILING (=12). UNCHANGED.
        - MID_FREQ_THRESHOLD = 20 (~L107), exported, JSDoc'd — update JSDoc
          to note 2026-10 retirement from the guard (after S1 removed its
          table row); keep the export + value.
  pattern: prefer reusing the threshold S1 computes for the table (or
        compute `guardAt` once as shown) — do NOT recompute per stem.
  gotcha: rEff takes the WORD's key length (`draft.key.length`), never
        the stem's length.

- file: plan/003_bbac3b15e8d0/P1M1T1S1/PRP.md
  why: CONTRACT for the S1-landed state: rEff/REJECT_LEN_FLOOR/
        REJECT_LEN_FULL exports, admit() table rewritten, guard/relief/
        clamp byte-identical after S1 (this task is the first to touch
        the guard). If the guard does NOT match the quoted pre-S2 body,
        STOP and reconcile with S1's actual output first.

- docfile: plan/003_bbac3b15e8d0/architecture/r1-admission-reff.md
  section: §2 (guard body) and §7 (knob/rounding cautions)
  why: Verified guard internals and the "R_eff must consume the resolved
        rejectAt" rule. Float compare `qs >= guardAt` directly — no
        rounding (rounding shifts ramp boundaries).

- file: test/score.test.ts
  why: Extend with the TDD block. Conventions: imports constants from
        ../src/core/score.js; dict stub
        `const dict = (entries: Record<string, number>): Dictionary =>
        ({ lookup: (k) => entries[k] ?? null })`; draft(key, isSubword?,
        over?) helper; existing pins at ~L85-87
        (REJECT_COMMON_THRESHOLD===12, MID_FREQ_THRESHOLD===20 — KEEP both)
        and existing guard cases (e.g. `uploads` at ~L104 uses
        `dict({ upload: MID_FREQ_THRESHOLD + 18 })`) — these need updating
        to the new semantics (see Task 1 note).
  pattern: express stem quants relative to imported constants where
        possible (e.g. `rEff(REJECT_COMMON_THRESHOLD, 15)` computed, or
        arithmetic on REJECT_COMMON_THRESHOLD), per the spec-09 posture.

- file: spec/04-score-and-tokenization.md (h2.26 "Conjugation guard")
  why: The authoritative rule this implements — both tiers compare the
        stem against R_eff(len(word)); MID retired to compatibility
        constant; the `uploads`/`configurations` worked examples.
        ALSO spec/09 h2.55 score.test.ts conjugation bullet = the test list.

- file: tools/calibrate-bands.mjs and test/helpers/bench-fixtures.ts
  why: IMPORTERS of MID_FREQ_THRESHOLD (verified by grep). Do NOT touch
        them (calibrate-bands R_eff-awareness is S3) — keeping the export
        + value is exactly what keeps them compiling and green.
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/core/score.ts        # MODIFY — guard block + JSDoc (MID retirement)
├── src/pi/ingest.ts         # untouched (calls admit(); signature unchanged)
├── test/score.test.ts       # MODIFY — new guard block + relief pin; update old guard cases
├── test/helpers/bench-fixtures.ts  # untouched (imports MID — keep export)
└── tools/calibrate-bands.mjs       # untouched (S3)
```

### Desired Codebase tree with files to be changed

```bash
src/core/score.ts       # guard rides rEff; MID JSDoc; guard comment rewrite
test/score.test.ts      # TDD: guard-rides-R_eff cases + relief-dead pin;
                        # update pre-existing guard cases to new semantics
```

### Known Gotchas of our Codebase & Library Quirks

```python
# CRITICAL: threshold uses the WORD's length (draft.key.length), not the
#   stem's — `configurations` (15) vs stem `configuration` (14) differ.
# CRITICAL: float compare `qs >= guardAt` directly; NO rounding (S1's §7
#   caution — rounding flips ramp boundaries).
# CRITICAL: rEff returns 256 at len >= 20 → at admit-all lengths the guard
#   can never reject either (qs <= 255 < 256). That is the SPEC'd behavior
#   ("at ramp lengths the guard loosens with the table"); do not add a
#   special case.
# GOTCHA: tier-2's `q === null` qualifier becomes redundant once both
#   tiers share one comparison — but keep semantics: tier-1 fired for ANY
#   word q, tier-2 only for absent words. With the shared `qs >= guardAt`
#   and guardAt >= rejectAt-floor... at the FLOOR (len<=8) guardAt ==
#   rejectAt, so old tier-1 `qs >= rejectAt` is identical for any q — the
#   single comparison subsumes both tiers exactly. Verified: no behavior
#   regression at floor lengths beyond the intended ramp loosening.
# GOTCHA: relief deadness domain: ceiling PROPER_NOUN_ADMIT_CEILING = 12
#   and relief requires q < 12, while a table-reject needs q >= rEff >=
#   min(rejectAt,...). Pin the relief test with the DEFAULT knob (12) —
#   the owner domain is R >= 12 (config clamps rejectCommonness; consult
#   test/config.test.ts for the sanctioned range and stay inside it).
# GOTCHA: existing guard tests in score.test.ts were written for flat
#   bands (e.g. `uploads` via `dict({ upload: MID_FREQ_THRESHOLD + 18 })`
#   = 38 — still >= rEff(12,7)=12, so it KEEPS passing). Audit each: only
#   expectations that relied on flat tier-2 (absent word + stem in
#   [rEff_flat_domain]) change. Update fixtures to the new curve, never
#   the curve to fixtures.
# GOTCHA: purity conventions: type-only imports in score.ts, no runtime
#   imports, no state; rEff is pure math — the guard stays pure.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies, TDD)

```yaml
Task 0: PRECONDITION
  - Confirm S1 landed: score.ts exports rEff/REJECT_LEN_FLOOR/
    REJECT_LEN_FULL; the admit() table row uses rEff; the guard block
    matches the pre-S2 body quoted above. If not, STOP.

Task 1: TDD — ADD failing cases to test/score.test.ts
  - ADD describe("conjugation guard rides R_eff(len(word)) — 2026-10"):
      it("'uploads' (7c absent, stem q=38) still rejects at the floor")
        // admit(draft("uploads"), dict({ upload: 38 })) → "reject"
        // (38 >= rEff(12,7)=12)
      it("'configurations' (15c absent, stem q=26) ADMITS at group 0")
        // dict({ configuration: 26 }) — was tier-1 reject, now
        // 26 < rEff(12,15) ≈ 197.24
      it("floor lengths unchanged: 'caching' (stem cache=30) and
          'deleted' (stem delete=51) reject; 'typed' subword guarded too")
      it("guard threshold rides the WORD's length, not the stem's")
        // construct: 16-char absent word whose stem is 6 chars with q=30:
        //   rEff(12,16) ≈ 216 → 30 < 216 → ADMIT, while a 7-char word
        //   with the same stem q=30 rejects
      it("knob moves the guard floor with the curve")
        // { rejectCommonness: 40 }: 'uploads'-like case (stem q=38 < 40)
        // ADMITS; default knob 12 rejects. Use a knob-safe key.
      it("properName skips the guard: 'Uploads' admits (guard bypassed)")
      it("len >= REJECT_LEN_FULL: guard never rejects (sentinel 256)")
        // 21-char absent word, stem q=255 → admit
      it("stem quant boundary self-relative at a ramp length")
        // len 15: q_admit = ceil(rEff(12,15))-1, q_reject = ceil(rEff(12,15))
        // computed from the imported rEff — immune to arithmetic slips
  - ADD the relief-dead pin:
      it("relief stays dead under the ramp: capitalized 9c table-reject
          (q >= rEff(12,9)) never relieves")
        // draft with properName: true, 9-char key, dict q = 200 ≥ 82.15 →
        // "reject" (relief needs q < 12)
      it("long capitalized word admits via the TABLE at group 1, not relief")
        // 15-char properName key, q = 100 < rEff(12,15) ≈ 197 → group 1
  - RUN: npx vitest --run test/score.test.ts → new cases RED.

Task 2: IMPLEMENT in src/core/score.ts
  - Replace the guard's condition per "What" (single `guardAt =
    rEff(rejectAt, draft.key.length)`, single `qs >= guardAt` check).
  - Rewrite the guard's comment block to the 2026-10 semantics: both
    tiers ride R_eff(len(word)); MID retired (2026-10) — survives only as
    a compatibility constant; keep the uploads/configurations examples.
  - Update MID_FREQ_THRESHOLD's JSDoc: "2026-10: retired from the table
    (S1) and from guard tier-2 (S2); compatibility constant retained for
    tools/calibrate-bands.mjs and test helpers."
  - RUN: new cases GREEN.

Task 3: AUDIT + UPDATE pre-existing guard cases
  - Run the full score suite; for each failing legacy guard case, decide:
    is the new verdict the curve's TRUE behavior (update the expectation,
    keeping relative-constant style) or a real bug (fix code)? Document
    each flip in the commit message. Do NOT tune the curve.

Task 4: FULL REGRESSION
  - npm run check
  - npm test   # ingest/store/query/calibration suites; calibration
               # long-word fallout may already exist from S1 — S3 owns the
               # prose re-audit; do not duplicate it here
```

### Implementation Patterns & Key Details

```typescript
// Boundary arithmetic (pre-verified — pin via self-relative tests):
// rEff(12, 7)  = 12                       (floor)   → uploads (stem 38) rejects
// rEff(12, 15) = 12 + 243·√(7/12) ≈ 197.24         → configurations (stem 26) admits
// rEff(12, 16) = 12 + 243·√(8/12) ≈ 216.4          → 16c absent word, stem 30 admits
// rEff(12, 20) = 256 (sentinel)                     → guard never rejects
// Compute boundary pairs in tests as ceil(rEff(...))-1 / ceil(rEff(...)).

// The guard, final form:
if (result !== "reject" && !draft.properName) {
  const guardAt = rEff(rejectAt, draft.key.length);
  for (const stem of inflectionStems(draft.key)) {
    const qs = dictionary.lookup(stem);
    if (qs === null) continue;
    if (qs >= guardAt) { result = "reject"; break; }
  }
}
```

### Integration Points

```yaml
CONSUMERS (implicit — no changes):
  - src/pi/ingest.ts #admitSegment → admit(draft, dict, parentGroup,
    { rejectCommonness }) — signature unchanged; guard semantics upgrade
    automatically.
  - test/calibration.test.ts re-audit of guard probes is P1.M1.T1.S3's
    (probe fixture side); this task only lands score.ts semantics + unit pins.
FUTURE (do NOT implement):
  - S3: tools/calibrate-bands.mjs R_eff-aware verdicts + prose re-audit.
DOCS: none (internal semantics); README rejectCommonness row is R5/Mode B
  (P1.M4.T1) — do not touch README here.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit clean
```

### Level 2: Unit Tests (TDD)

```bash
npx vitest --run test/score.test.ts                      # all green
npx vitest --run test/score.test.ts -t "guard" -v        # new guard cases
npx vitest --run test/score.test.ts -t "relief" -v       # relief-dead pins
npm test                                                 # full suite
```

### Level 3: Integration (downstream consumers)

```bash
npx vitest --run test/ingest-pipeline.test.ts test/ingest.test.ts test/store.test.ts
# admission changes are intended; short-word fixtures unaffected
```

### Level 4: Domain-Specific (boundary words vs the shipped dictionary)

```bash
node tools/calibrate-bands.mjs uploads configurations deleted
# NOTE: calibrate-bands is still flat-band until S3 — its verdicts may
# disagree with the new guard here; treat THIS tool output as advisory
# only. The authoritative check is the vitest run in Level 2. For a live
# lookup of stem quants:
node -e "
const { loadDictionary } = await import('./src/core/dictionary.ts');
const d = loadDictionary('dict/common-en.bin');
for (const w of ['upload','configuration','cache','delete'])
  console.log(w, d.lookup(w));
"
# expect upload=38, configuration=26 (per the contract's measurements)
```

## Final Validation Checklist

- [ ] Guard: single `guardAt = rEff(rejectAt, draft.key.length)`; both tiers subsumed
- [ ] `uploads` rejects; `configurations` admits at group 0; floor cases unchanged
- [ ] Knob scales the guard's floor with the curve (tested)
- [ ] properName skip, subword guarding, one-level stems — all preserved
- [ ] Relief block byte-identical; relief-dead pin under the ramp passes
- [ ] `MID_FREQ_THRESHOLD` exported, === 20 pin green; calibrate-bands.mjs
      and bench-fixtures.ts compile and pass untouched
- [ ] Legacy guard cases audited: flips documented, curve never tuned
- [ ] `npm run check` + `npm test` fully green
- [ ] Only src/core/score.ts and test/score.test.ts modified

## Anti-Patterns to Avoid

- ❌ Don't pass the STEM's length to rEff — always `draft.key.length`
- ❌ Don't round guardAt (float compare; rounding shifts ramp boundaries)
- ❌ Don't delete or re-value `MID_FREQ_THRESHOLD` — it is a compatibility
      constant with live importers
- ❌ Don't touch inflectionStems, the relief block, the subword clamp,
      calibrate-bands.mjs, or ingest/config files
- ❌ Don't tune the curve to rescue a legacy fixture — re-measure and update
      the fixture's expectation
- ❌ Don't pin relief deadness outside the sanctioned rejectCommonness range

---

**Confidence Score**: 9/10 — the pre-S2 guard body was read verbatim from
source, S1's rEff contract (formula, sentinel, resolved-floor rule) is
fixed, and all boundary arithmetic is pre-computed; the only residual work
is auditing legacy guard fixtures, which has an explicit decision rule.
