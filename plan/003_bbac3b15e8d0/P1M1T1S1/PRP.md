# PRP — P1.M1.T1.S1 (plan 003): R_eff curve + admit() rewrite + knob scaling + admit-all edge

---

## Goal

**Feature Goal**: Implement the 2026-10 length-conditioned reject curve
`R_eff(len)` in `src/core/score.ts`: flat floor R (default 12, runtime-tunable
via `rejectCommonness`) through 8 chars, sqrt ramp 9–19, admit-all at ≥20;
rewrite `admit()`'s table to reject iff `q >= rEff(rejectAt, key.length)`,
delete the dead MID table row (flat group 1 for every attested admission),
and handle the len ≥ 20 admit-all edge so q=255 words admit.

**Deliverable**:
- `export const REJECT_LEN_FLOOR = 8` and `export const REJECT_LEN_FULL = 20`
- `export function rEff(floor: number, len: number): number`
- Rewritten table branch in `admit()` (signature UNCHANGED)
- TDD cases in `test/score.test.ts` asserting RELATIVE to imported constants

**Success Definition**: all new curve cases pass (floor hold, ramp boundary
probes, admit-all incl. q=255, flat group 1, knob scaling), the existing
`REJECT_COMMON_THRESHOLD === 12` pin stays green, full `npm test` +
`npm run check` green (with the known fixture fallout — see Gotchas: any
test that asserts long attested words reject must be re-examined; the
conjugation guard is untouched in this task — S2 rides R_eff next).

## Why

Flat `q >= 12` rejects ~13k currently-rejected 7–9-char corpus words and
~2.8k at 11+ even though long words carry the largest typing savings and
near-zero noise mass. The owner-measured sqrt 8→20 gradient (≈10.5k flips;
linear and floor-10 variants rejected) is adopted in spec/04 ahead of
implementation — this task lands the code to match. The `rejectCommonness`
knob already flows per-call from IngestPipeline into `admit()`'s opts, so
"the knob moves the floor and the curve scales from it" falls out by
feeding the resolved `rejectAt` into `rEff` — zero config/ingest changes.

## What

Per spec/04 h2.26 (authoritative):

```
R_eff(len) = R                                len ≤ 8   (floor hold)
R_eff(len) = R + (255 − R)·√((len − 8)/12)    8 < len < 20
R_eff(len) = 255 (admit-all)                  len ≥ 20
```

- `admit()` table becomes: `q === null → 0`; `q >= rEff(rejectAt,
  draft.key.length) → "reject"`; else → `1` (flat). DELETE the
  `else if (q >= MID_FREQ_THRESHOLD) result = 2;` row — group 2 stays
  reachable only via the subword clamp; `MID_FREQ_THRESHOLD` remains
  exported (guard tier-2 + calibrate-bands import it; its fate is S2's).
- **Admit-all edge**: at len ≥ 20 a naive `R_eff = 255` with `q >= 255`
  REJECTS q=255 words. Implement via a sentinel: return `256` from
  `rEff` for len ≥ 20 (or short-circuit `len >= REJECT_LEN_FULL → never
  reject` in admit); q ∈ 0..255 can then never reach it.
- Guard/relief/clamp in `admit()` are UNTOUCHED in this task (S2 moves
  the guard's comparisons onto R_eff; relief stays dead: ceiling 12 ≤
  R_eff everywhere, so the relief branch remains unreachable — no change).
- Float comparison: `q >= rEff` directly (q integer, rEff float; no
  rounding — rounding would shift the 9-char 81/82 boundary).

### Success Criteria

- [ ] `rEff(12, len≤8) === 12` for len 0..8 (floor hold, integer)
- [ ] `rEff(12, 9) ≈ 82.15` → q=81 admits, q=82 rejects at 9 chars
- [ ] len ≥ 20 admit-all INCLUDING q=255 (sentinel works)
- [ ] Every attested admission lands at group 1 (no table path to group 2)
- [ ] `q === null` → group 0 unchanged
- [ ] `{ rejectCommonness: 10 }` moves floor AND curve (e.g. rEff(10,9) ≈
      80.4; q=80 admits / q=81 rejects at 9 chars with knob 10)
- [ ] Existing pin `REJECT_COMMON_THRESHOLD === 12` stays green
- [ ] `admit()` signature unchanged; ingest.ts/config.ts/index.ts untouched

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the current `admit()` body
is reproduced below, the curve formula and boundary arithmetic are given,
the admit-all trap is pre-solved, and the test conventions (dict stub,
draft helper, imports) are documented.

### Documentation & References

```yaml
- file: src/core/score.ts
  why: The ONLY source file to modify. Current state (read it first):
    - REJECT_COMMON_THRESHOLD = 12 (line ~95), MID_FREQ_THRESHOLD = 20
      (~107), PROPER_NOUN_ADMIT_CEILING (~110) — all exported consts with
      long calibration-history JSDoc.
    - AdmissionOptions { rejectCommonness?: number } (~line 136–145).
    - admit() (~line 219): 
        const rejectAt = opts.rejectCommonness ?? REJECT_COMMON_THRESHOLD;
        const q = dictionary.lookup(draft.key);
        let result: AdmissionResult;
        if (q === null) result = 0;
        else if (q >= rejectAt) result = "reject";
        else if (q >= MID_FREQ_THRESHOLD) result = 2;   // ← DELETE this row
        else result = 1;
      followed by the relief block (UNCHANGED — stays dead), the
      conjugation guard (UNCHANGED this task — S2), and the subword clamp
      (UNCHANGED).
  pattern: baked-constant JSDoc convention with calibration history —
    extend the doc comments for the new curve; JSDoc on rEff explaining
    the curve rides with the code (contract DOCS requirement).
  gotcha: guard tier-2 imports MID_FREQ_THRESHOLD — keep the export.
  placement: rEff + REJECT_LEN_FLOOR/REJECT_LEN_FULL go next to the
    existing constants (before AdmissionOptions), single source of truth;
    calibrate-bands.mjs and tests import them from here.

- docfile: plan/003_bbac3b15e8d0/architecture/r1-admission-reff.md
  why: THE feasibility study — verified knob flow (src/pi/index.ts:167 →
    IngestPipeline stores #rejectCommonness (ingest.ts L277/310) → passes
    per-call into admit() at ingest.ts L558–563), boundary arithmetic,
    and the two named risks. §7 "Rounding caution" and risk 1 name the
    q=255 admit-all trap this PRP pre-solves. Also notes relief stays
    dead for every knob value (ceiling 12 ≤ R_eff for R ≥ 12).
  critical: "R_eff must consume the same resolved floor R (compute from
    rejectAt), not the baked constant."

- file: test/score.test.ts
  why: Extend with the TDD cases. Conventions (read the header + ~150 lines):
    imports constants from "../src/core/score.js"; `const dict = (entries:
    Record<string, number>): Dictionary => ({ lookup: (k) => entries[k] ?? null })`
    at line 44; a `draft(key, isSubword?, over?)` helper building
    CandidateDraft with key/display/properName. Existing absolute pin at
    line ~85: expect(REJECT_COMMON_THRESHOLD).toBe(12) — KEEP.
  pattern: boundary tests as explicit q values in dict stubs:
    admit(draft("ninechars"), dict({ ninechars: 81 })) → 1, etc.

- prd: spec/04 h2.26 ( Admission decision) — the authoritative curve table,
    measured flip counts, and the flat-group-1 rule (all reproduced in
    What/Patterns below). spec/09 h2.55 score.test.ts bullet specifies the
    exact relative-assertion test posture this task implements.
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/core/score.ts        # MODIFY (constants + rEff + admit table row)
├── src/core/types.ts        # untouched (RankGroup = 0|1|2 at line 17)
├── src/pi/{config,ingest,index}.ts  # untouched — knob flow already correct
├── test/score.test.ts       # MODIFY (new describe block; keep existing pins)
└── tools/calibrate-bands.mjs  # NOT this task (S3 makes it R_eff-aware)
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL (the main correctness trap, per architecture §7): len >= 20 must
#   be ADMIT-ALL. Naive rEff=255 with `q >= 255` rejects q=255 (max q).
#   Solution: rEff returns 256 at len >= REJECT_LEN_FULL (sentinel above
#   the q domain) OR admit() short-circuits. Pick ONE; sentinel-in-rEff is
#   recommended so all future callers (S2 guard, S3 probe) inherit safety.
# CRITICAL: compare floats directly (q >= rEff) — NO rounding. rEff(12,9) =
#   12 + 243*sqrt(1/12) ≈ 82.147; rounding down to 82 would flip q=82 to
#   admit; Math.round could flip the boundary either way. The 81/82 test
#   pins this.
# CRITICAL: the curve takes the RESOLVED floor (rejectAt = opts??
#   REJECT_COMMON_THRESHOLD), so the knob scales the whole curve — including
#   the 255 asymptote constant, which stays literal 255 (the ramp saturates
#   toward max-q regardless of floor; only the (255 - R) span changes).
# GOTCHA: DELETE only the MID TABLE row. The guard's tier-2 still reads
#   MID_FREQ_THRESHOLD — S2 retires/repoints it. Keep the export and its
#   JSDoc (update the JSDoc to note the table row is gone as of 2026-10).
# GOTCHA: Expected fixture fallout (do not "fix" by weakening the curve):
#   test/calibration.test.ts asserts a prose store is EMPTY — prose.jsonl
#   contains ≥9-char attested words that now ADMIT. If that test fails,
#   re-audit the fixture per S3's prose re-audit; a minimal interim fix is
#   acceptable ONLY if it reflects the new curve's true expectations
#   (re-measure which words admit), never a curve tweak to force empty.
#   shipped-dict/no-menu gates use 4–6-char probes — spec says nothing
#   below 9 chars changes, so they hold.
# GOTCHA: relief block untouched and provably still dead: relief needs
#   q >= R_eff(len) && q < 12; R_eff >= R = 12 everywhere → impossible.
# GOTCHA: purity conventions of score.ts: type-only imports, no runtime
#   imports, no state. rEff is pure math — keep it that way.
```

## Implementation Blueprint

### Data models and structure

```typescript
/** 2026-10 long-word gradient: reject floor holds through this length. */
export const REJECT_LEN_FLOOR = 8 as const;
/** 2026-10 long-word gradient: admit-all from this length (sentinel). */
export const REJECT_LEN_FULL = 20 as const;

/**
 * Length-conditioned reject threshold R_eff(len) — spec/04 h2.26 (2026-10
 * owner rule): dictionary attestation is near-disqualifying at short
 * lengths (hapax completes the ABSENT class) but commonness stops being
 * noise evidence as words lengthen — typing savings grow, noise mass
 * collapses. sqrt is steep where noise dies (9–12) and saturates where
 * nothing remains to admit (16+). Returns 256 (above the q domain) at
 * len >= REJECT_LEN_FULL so `q >= rEff` can never reject there —
 * admit-all, including q=255.
 */
export function rEff(floor: number, len: number): number {
  if (len >= REJECT_LEN_FULL) return 256;
  if (len <= REJECT_LEN_FLOOR) return floor;
  return floor + (255 - floor) * Math.sqrt((len - REJECT_LEN_FLOOR) / 12);
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — ADD curve cases to test/score.test.ts FIRST
  - ADD imports: rEff, REJECT_LEN_FLOOR, REJECT_LEN_FULL.
  - ADD describe("R_eff length-conditioned admission (2026-10 gradient)") with:
      it("floor hold: q >= REJECT rejects at any len <= REJECT_LEN_FLOOR")
        // for len in [2, 5, 8]: admit(draft("x".repeat(len)), dict({key: REJECT_COMMON_THRESHOLD})) === "reject"
        // use real distinct keys per length, e.g. 8-char word with q=12
      it("floor hold: q = REJECT-1 admits at group 1 (flat)")
      it("sqrt ramp boundary at 9 chars: q=81 admits, q=82 rejects")
        // rEff(12,9) ≈ 82.147
      it("ramp probes: 10 chars q=110 admits / q=139 'everything' rejects;
          14 chars q=184 admits")  // spec h2.26 measured values — optional but valuable
      it("admit-all at len >= REJECT_LEN_FULL including q=255")
        // 20-char and 21-char keys with q=255 → group 1
      it("every attested admission lands at group 1 (no table group-2)")
      it("absent stays group 0 at all lengths, incl. >= 20")
      it("rejectCommonness knob moves floor AND curve")
        // { rejectCommonness: 10 }: rEff(10,9) ≈ 80.36 → q=80 admits, q=81 rejects;
        // floor: q >= 10 rejects at len 8
      it("rEff arithmetic sanity: rEff(12, 8)===12, rEff(12,20)===256,
          monotone non-decreasing on len 0..25")
  - RUN: npx vitest --run test/score.test.ts → new cases RED (rEff not exported).

Task 2: IMPLEMENT in src/core/score.ts
  - ADD constants + rEff (blueprint above) next to the existing constants.
  - REWRITE the admit() table:
      const rejectAt = opts.rejectCommonness ?? REJECT_COMMON_THRESHOLD;
      const threshold = rEff(rejectAt, draft.key.length);
      const q = dictionary.lookup(draft.key);
      let result: AdmissionResult;
      if (q === null) result = 0;
      else if (q >= threshold) result = "reject";
      else result = 1;                      // flat — MID row deleted
  - TOUCH NOTHING ELSE in admit() (relief, guard, clamp stay byte-identical).
  - UPDATE JSDoc/comments: module header admission summary (lines ~9–40)
    gains the R_eff curve summary; MID_FREQ_THRESHOLD's JSDoc notes its
    table row is deleted (2026-10) and it survives for guard tier-2;
    admit()'s @param/@returns block unchanged.
  - RUN: new cases GREEN.

Task 3: REGRESSION + FALLAUDIT
  - npm run check
  - npm test
  - IF test/calibration.test.ts (prose store-EMPTY) or any shipped-dict gate
    fails: re-measure the fixture's actual admissions under the new curve
    (the flips are EXPECTED per spec: nothing <9 chars changes; ≈10.5k
    corpus words flip overall). Update the test's expectations to the
    curve's true behavior; do NOT tune the curve to rescue a fixture.
    Record the fallout in the commit message. (Full prose re-audit is S3.)

Task 4: KEEP the absolute pin
  - verify expect(REJECT_COMMON_THRESHOLD).toBe(12) still present and green
    (line ~85 of test/score.test.ts).
```

### Implementation Patterns & Key Details

```typescript
// Boundary arithmetic (pre-verified — pin with tests):
// rEff(12, 8)  = 12                       (floor edge, integer)
// rEff(12, 9)  = 12 + 243·√(1/12)  ≈ 82.147   → q=81 admit, q=82 reject
// rEff(12, 10) = 12 + 243·√(2/12)  ≈ 111.2    → q=110 admit ('government'), q=139 reject ('everything')
// rEff(12, 14) = 12 + 243·√(6/12)  ≈ 183.8    → q=184 reject edge at 14 per spec (≈184: use
//                                                q=183 admit / q=184 reject with exact float compare)
// rEff(12, 20) = 256 (sentinel)             → admit-all incl. q=255
// rEff(10, 9)  = 10 + 245·√(1/12)  ≈ 80.7    → knob example
// NOTE: compute the exact float in the test via rEff(...) itself for the
// admit/reject pair construction: pick q_admit = ceil(rEff)-1,
// q_reject = ceil(rEff) — self-relative, immune to arithmetic slips.

// The one-line table change (everything else in admit() untouched):
else if (q >= rEff(rejectAt, draft.key.length)) result = "reject";
else result = 1;   // was: MID row → 2, else 1
```

### Integration Points

```yaml
CONSUMERS (no changes needed):
  - src/pi/ingest.ts (#admitSegment calls admit(draft, dict, parentGroup,
    { rejectCommonness }) at L558–563) — signature unchanged, knob
    semantics upgrade automatically (rejectAt feeds the curve).
  - src/pi/config.ts default (rejectCommonness: 12 at line ~91) — unchanged.
FUTURE (do NOT implement):
  - S2 (P1.M1.T1.S2): guard tiers ride rEff(rejectAt, len(word)); MID demoted.
  - S3 (P1.M1.T1.S3): tools/calibrate-bands.mjs R_eff-aware verdicts.
TEST BASELINE: full suite green today; expected (and acceptable) fallout is
  confined to long-word fixtures (calibration prose store-EMPTY) per above.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit clean
```

### Level 2: Unit Tests (TDD)

```bash
npx vitest --run test/score.test.ts                 # all green incl. new block
npx vitest --run test/score.test.ts -t "R_eff" -v   # see the case list
npm test                                            # full suite (fallout audited)
```

### Level 3: Integration (downstream consumers)

```bash
npx vitest --run test/ingest-pipeline.test.ts test/store.test.ts test/query.test.ts
# admit() behavior change is intended; these suites should stay green
# (their fixtures are short words — nothing <9 chars changes)
npx vitest --run test/shipped-dict.test.ts test/calibration.test.ts
# audit any long-word expectations per Task 3
```

### Level 4: Domain-Specific (curve sanity against the real dictionary)

```bash
# Boundary words from the shipped artifact (measured in research):
node -e "
const { loadDictionary } = await import('./src/core/dictionary.ts');
const d = loadDictionary('dict/common-en.bin');
for (const w of ['everything','government','information','characteristics','provider'])
  console.log(w, w.length, d.lookup(w));
"
# expect: everything 10 139 (rejects), government 10 <111 (admits... verify),
# provider 8 q=34 → rejects (floor hold — the audit word must stay rejected)
```

## Final Validation Checklist

- [ ] `rEff`, `REJECT_LEN_FLOOR`, `REJECT_LEN_FULL` exported from score.ts with JSDoc
- [ ] Floor hold, ramp boundary (81/82 at 9 chars), admit-all (q=255 at ≥20), flat group 1, knob scaling — all tested
- [ ] MID table row deleted; `MID_FREQ_THRESHOLD` still exported (guard tier-2 + tools)
- [ ] `admit()` signature unchanged; relief/guard/clamp blocks byte-identical
- [ ] `REJECT_COMMON_THRESHOLD === 12` pin retained and green
- [ ] ingest.ts / config.ts / index.ts / types.ts untouched
- [ ] `npm run check` + `npm test` green (long-word fixture fallout re-measured, not curve-tuned)
- [ ] Module header comment updated with the 2026-10 gradient summary

## Anti-Patterns to Avoid

- ❌ Don't round rEff (float compare; rounding flips the 9-char boundary)
- ❌ Don't return 255 from rEff at len ≥ 20 (q=255 reject trap — sentinel 256 or short-circuit)
- ❌ Don't compute the curve from the baked constant — use the resolved `rejectAt` (knob must scale the curve)
- ❌ Don't touch the conjugation guard, relief, subword clamp, or calibrate-bands.mjs (S2/S3)
- ❌ Don't tune the curve to rescue a failing fixture — re-measure the fixture
- ❌ Don't make rEff config-aware beyond its `floor` parameter (purity conventions)

---

**Confidence Score**: 9/10 — the current `admit()` body, knob flow, test
conventions, and boundary arithmetic were all verified against live source
and the completed feasibility study this session; the one known risk
(long-word fixture fallout) is named with a decision rule rather than a guess.
