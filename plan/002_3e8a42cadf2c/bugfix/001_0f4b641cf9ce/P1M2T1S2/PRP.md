---
name: "P1.M2.T1.S2 (bugfix 001_0f4b641cf9ce) — Re-run tuning protocol: calibration, shipped-dict, and adversarial suites stay green"
---

## Goal

**Feature Goal**: Execute the PRD §09 tuning protocol (spec/09, quoted in spec-acceptance-map.md L14: "change one constant, run the acceptance suite, A/B against a fixed 3-session corpus fixture checking precision@8") against the proper-noun relief band from P1.M2.T1.S1 — validate (or adjust, one constant only, within (94, 156]) `PROPER_NOUN_ADMIT_CEILING` so that common lowercase prose still delegates while capitalized fixture words store at group 2 and integration item 7's phrase becomes reachable.

**Deliverable**:
- Green evidence run of the six named suites (`calibration`, `shipped-dict`, `adversarial-ingest`, `adversarial-typing`, `score`, `acceptance`) plus `npm run check` / `npm test` / `node tools/calibrate-bands.mjs`
- A scripted prose-replay A/B check (new test or scratch harness per "What" §3) asserting sentinel delegation identity + `__hapaxLive() === null` for common lowercase prose and group-2 storage for capitalized relief-band words
- Final ceiling value + measured numbers appended to the score.ts JSDoc note from P1.M2.T1.S1 (Mode A) and recorded in the run notes (research/ or test comments) for P1.M2.T1.S3 and P1.M4.T1.S1

**Success Definition**: All named suites green with the relief band live; every expected.md prose label still matches (or the ceiling was adjusted within (94,156] to make them match); no test pin edited to accommodate a leak; calibration numbers recorded in score.ts JSDoc; downstream items (P1.M2.T1.S3's end-to-end pin, P1.M4.T1.S1's regression) have their evidence base.

## Why

- P1.M2.T1.S1 changed admission behavior (the relief band) — the tuning protocol REQUIRES re-validation: the relief admits any capitalized occurrence of q<ceiling words, and prose transcripts contain sentence-initial capitalized common words (`Garden` q=86, `Kitchen` q=96, `Window` q=99, `Fresh` q=93, `Bread` q=84 per expected.md's calibrated-band table). Any of those appearing capitalized in prose.jsonl now stores at group 2 and may flip an expected.md `[]` label into a menu — a precision@8 regression this task must catch and resolve.
- BUG-002's fix is only "done" when the no-menu guarantees (never-hijack for ordinary prose) are re-proven under the new band — that's exactly what calibration.test.ts / adversarial suites / acceptance item 2 pin.

## What

### 1. Baseline run (nothing changed by this task yet)

```bash
node tools/calibrate-bands.mjs                                   # exit 0
npx vitest --run test/calibration.test.ts test/shipped-dict.test.ts \
  test/adversarial-ingest.test.ts test/adversarial-typing.test.ts \
  test/score.test.ts test/acceptance.test.ts
npm run check && npm test
```
If calibration.test.ts fails here, the relief LEAKED to lowercase or subword drafts — that is an upstream (S1) defect: report it, do not patch the test.

### 2. The prose A/B replay (the protocol's "A/B against the fixture corpus")

Script (as a new `it` in test/acceptance.test.ts's item-2 describe, or a temporary script first, then pinned as a test):

- Ingest `test/fixtures/sessions/prose.jsonl` through the REAL pipeline + shipped dict (existing `ingestFixture(FIXTURES + "/prose.jsonl")` helper).
- For every expected.md prose label with expected `[]` (`wate`, `kit`, `mor`, `wind`, `fresh`, `bread`, `gar`, plus the 2-char probes): query the provider wrapped around `mockCurrent(SENTINEL)`; assert `result === SENTINEL` AND `current.getSuggestions` calledOnce AND `provider.__hapaxLive()` is null (mirror adversarial-typing.test.ts Probe A, lines ~297–306).
- Positive side of the A/B: assert capitalized relief-band words that DO occur capitalized in prose.jsonl are now stored at `rankGroup === 2` (`store.get(lowercased).rankGroup`), and that lowercase-only common words (`water`, `kitchen`, ...) remain absent from the store (`store.get(...) === undefined`).
- precision@8: every expected.md label (all three fixtures via the existing SHORT_PROBES / probe blocks in acceptance.test.ts) still matches in rank order.

### 3. Regression resolution ladder (one constant only, record every step)

If a prose `[]` label now opens a menu:
1. Identify the offending capitalized word and its shipped-dict q (`dict.lookup(word)`).
2. Adjust `PROPER_NOUN_ADMIT_CEILING` in src/core/score.ts to exclude it — ceiling must be ≤ that q — while staying in **(94, 156]** (energy=94 must admit strictly below ceiling; Them=156 must stay excluded). Adjust ONE constant only; re-run step 1 + step 2 fully after each change.
3. If the offender's q makes the interval empty (e.g. capitalized `Bread` q=84 < 94 — no legal ceiling excludes it): the documented fallback is re-labeling expected.md (its header: "Re-label after any change to: admission bands..."). Re-label ONLY the affected prose rows, record the diff and rationale in the run notes, and confirm the no-hijack SENTINEL/live-null checks still pass for lowercase probes. Do NOT weaken the delegation-identity assertions.
4. Record the final ceiling + measured numbers.

### 4. Mode A documentation

Append to the score.ts JSDoc note S1 added (module header / PROPER_NOUN_ADMIT_CEILING doc-block): final ceiling value, the probe table (word → dict q → verdict under the final band: admit-group-2 / reject / delegate), and the measured prose A/B result (labels checked, regressions found (if any), resolution chosen). Keep spec/*.md untouched (READ-ONLY).

### Success Criteria

- [ ] `node tools/calibrate-bands.mjs` exit 0; the six named suites green; `npm run check` + `npm test` green
- [ ] Prose replay: lowercase common probes delegate (SENTINEL + calledOnce + `__hapaxLive()` null); capitalized relief words stored at group 2
- [ ] Every expected.md label matches under the final ceiling (or a documented, minimal re-label per the ladder)
- [ ] Final ceiling ∈ (94, 156]; measured numbers in score.ts JSDoc; run notes captured for P1.M2.T1.S3 / P1.M4.T1.S1
- [ ] calibration.test.ts / shipped-dict.test.ts UNTOUCHED (they must pass on their own merits)

## All Needed Context

### Context Completeness Check

An implementer needs: the exact relief contract, the ceiling interval, the q-value table, the fixture label surface, the delegation harness pattern, and the ladder. All below.

### Documentation & References

```yaml
- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M2T1S1/PRP.md
  why: THE upstream contract: PROPER_NOUN_ADMIT_CEILING=120, the five-guard
        relief branch, the interval (94,156], calibrate-bands.mjs usage,
        and the JSDoc note this task appends to.
  critical: properName is set per-sighting at extraction (segment.ts
        expandCandidates) — sentence-initial capitalized common words
        qualify; this is the regression source, not a bug.

- file: test/fixtures/sessions/expected.md
  why: The precision@8 hand labels (prose/zendesk-lwlock/large-100k) + the
        calibrated q table (water 121, kitchen 96, window 99, fresh 93,
        bread 84, fence 71, garden 86, context 51, posts 47...) + the
        re-labeling rule.
  gotcha: re-label is a documented fallback, not the first move — ceiling
        adjustment first.

- file: test/calibration.test.ts
  why: COMMON_PROBES (L64) + the posts/thin/firs pin (L164): all lowercase,
        relief-immune. MUST pass untouched — failure = relief leak upstream.
  pattern: constants imported from score.ts so retunes survive (do the same
        for any new ceiling-dependent assertions).

- file: test/acceptance.test.ts
  why: ingestFixture helper; item-2 prose describe (L188) with SENTINEL
        delegation identity assertions; SHORT_PROBES from expected.md (~L192)
        — the scripted precision@8 surface this task extends.

- file: test/adversarial-typing.test.ts
  why: Probe A pattern (L262–306): SENTINEL identity + calledOnce +
        provider.__hapaxLive() null — copy this assertion triple for the
        prose replay.

- file: src/core/score.ts
  why: Where the ceiling constant lives and where the Mode A numbers go.
  gotcha: change ONLY PROPER_NOUN_ADMIT_CEILING during the ladder; never
        REJECT_COMMON_THRESHOLD / MID_FREQ_THRESHOLD.

- file: tools/calibrate-bands.mjs
  why: Real-admit() probe against the shipped dict; its lowercase no-menu
        assertions double-check the relief didn't leak.

- docfile: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/spec-acceptance-map.md
  section: tuning-protocol quote (L14) + suite inventory (L18)
  why: The protocol text and the full list of suites that must stay green.

- docfile: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/core-engine-findings.md
  why: The relief-band design memo: interval derivation (national 90, energy
        94, laboratory 57 must admit; The 240, This 197, With 179, Them 156
        must reject).
```

### Current Codebase tree (relevant)

```bash
src/core/score.ts          # relief band (S1) — ceiling value MAY be tuned here; JSDoc appended
test/acceptance.test.ts    # EXTEND: prose A/B replay assertions (item 2 describe)
test/fixtures/sessions/    # prose.jsonl, expected.md — labels verified; expected.md re-label ONLY as fallback
tools/calibrate-bands.mjs  # run
```

### Desired Codebase tree

```bash
src/core/score.ts        # final tuned ceiling + measured-numbers JSDoc (Mode A)
test/acceptance.test.ts  # + prose A/B replay: delegation identity/live-null + group-2 storage assertions
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: the interval is OPEN at 94: energy has q=94 and relief requires
// q < ceiling STRICTLY, so ceiling must be ≥ 95. Them=156 requires ceiling ≤ 156.
// Legal integer range: 95..156.

// GOTCHA: a capitalized word in prose.jsonl with q as low as 84 (Bread) cannot
// be excluded by any legal ceiling — expect the re-label fallback for such
// words. Measure BEFORE concluding; only words that actually occur capitalized
// in the fixture matter (display casing = most recent sighting, so a later
// lowercase sighting would change the menu display, not admission: admission
// is per-sighting — the word stores if ANY sighting qualifies).

// GOTCHA: assert lowercase-only common words stay ABSENT (store.get === undefined),
// not just "don't menu" — a relief leak stores them and only later menus.

// GOTCHA: __hapaxLive() must be null after delegating probes; a stale live
// cache is a no-hijack violation even when the return value is the sentinel.

// GOTCHA: keep every new assertion parameterized on the imported
// PROPER_NOUN_ADMIT_CEILING (and dict lookups) — no hardcoded 120s that break
// on the ladder's final value.

// GOTCHA: sub-words of relieved parents clamp at group 2 (min(2, ...)) — don't
// assert group 0 for them.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: BASELINE — run calibrate-bands + the six suites + npm run check/test
  - RECORD: pass/fail per suite, any prose-label mismatch (this is the A/B)
  - IF calibration.test.ts/shipped-dict.test.ts fail: relief leak — STOP, report
    upstream to P1.M2.T1.S1's scope; do not patch tests

Task 2: MEASURE — for each capitalized common word occurring in prose.jsonl:
  dict q, admission verdict, whether any expected.md [] label now menus
  - Use a scratch script or a temporary it() (delete scratch before finishing);
    pin the outcome as a permanent test in Task 4

Task 3: LADDER (only if regressions found)
  - Adjust PROPER_NOUN_ADMIT_CEILING (one constant) within 95..156 to exclude
    the highest-value offender(s) possible; re-run Task 1 fully after each step
  - If un-excludable offenders remain: minimal expected.md re-label for exactly
    those rows; record diff + rationale; keep SENTINEL/live-null assertions green

Task 4: PIN — extend test/acceptance.test.ts item-2 describe
  - prose replay: every expected.md []-label probe → SENTINEL + calledOnce +
    __hapaxLive() null
  - capitalized relief words → store.get(key).rankGroup === 2
  - lowercase-only common words → store.get(key) === undefined
  - all assertions parameterized on imported constants/dict lookups

Task 5: DOCUMENT (Mode A)
  - Append final ceiling + probe table (word/q/verdict) + A/B summary to the
    score.ts JSDoc note from S1
  - Record the run notes (final value, measured A/B, any re-label) — this is
    the evidence consumed by P1.M2.T1.S3 and P1.M4.T1.S1
```

### Implementation pattern

Prose A/B replay core (mirror adversarial-typing Probe A):

```typescript
const { store, provider } = ... // ingestFixture + mockCurrent(SENTINEL) wrap
for (const probe of ["wate", "kit", "mor", "wind", "fresh", "bread", "gar"]) {
  const res = await provider.getSuggestions([probe], 0, probe.length, opts());
  expect(res, probe).toBe(SENTINEL);
  expect(provider.__hapaxLive(), probe).toBeNull();
}
// relief side (parameterized — words chosen from actual capitalized prose sightings):
for (const [word, q] of reliefWords) {
  expect(dict.lookup(word)!, word).toBeLessThan(PROPER_NOUN_ADMIT_CEILING);
  expect(store.get(word)?.rankGroup ?? -1, word).toBe(2); // capitalized sighting admitted
}
expect(store.get("water")).toBeUndefined(); // lowercase-only common stays out
```

### Integration Points

```yaml
NONE structural:
  - Output consumed by P1.M2.T1.S3 (pins the M2 acceptance phrase end-to-end —
    depends on the final ceiling validated here)
  - And by P1.M4.T1.S1 (full regression + acceptance evidence — reuse this task's
    recorded numbers)
  - expected.md re-labels (if any) must be reflected in any probe list that
    derives from it (SHORT_PROBES in acceptance.test.ts reads labels; re-sync).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check    # zero errors
grep -rn "120" src/core/score.ts | grep -v JSDoc   # no stray hardcoded ceilings outside the constant
```

### Level 2: The protocol run itself

```bash
node tools/calibrate-bands.mjs
npx vitest --run test/calibration.test.ts test/shipped-dict.test.ts \
  test/adversarial-ingest.test.ts test/adversarial-typing.test.ts \
  test/score.test.ts test/acceptance.test.ts -v
npm test
```

### Level 3: Behavioral audit (read the run)

- Every prose `[]` label delegates with live cache null (grep the run output)
- Capitalized relief words show `rankGroup 2` in the pinned assertions
- No suite was modified other than acceptance.test.ts additions (+ minimal
  expected.md re-label if the ladder exhausted)

### Level 4: Evidence capture

- Save the final numbers (ceiling, probe table, precision@8 result) into the
  score.ts JSDoc and the run notes — P1.M2.T1.S3 / P1.M4.T1.S1 audit against them.

## Final Validation Checklist

### Technical Validation

- [ ] `node tools/calibrate-bands.mjs` exit 0; `npm run check`; `npm test` all green
- [ ] calibration.test.ts / shipped-dict.test.ts untouched and green

### Feature Validation

- [ ] Lowercase common prose: delegate (SENTINEL identity, calledOnce, `__hapaxLive()` null)
- [ ] Capitalized relief words in the fixture: stored at group 2
- [ ] All expected.md labels match under the final band (or documented minimal re-label)
- [ ] Final ceiling recorded in score.ts JSDoc with measured numbers

### Code Quality Validation

- [ ] New assertions parameterized on imported constants — no magic numbers
- [ ] Only PROPER_NOUN_ADMIT_CEILING tuned; REJECT/MID thresholds untouched
- [ ] Run notes clear enough for P1.M4.T1.S1 to audit without re-deriving

## Anti-Patterns to Avoid

- ❌ Don't touch calibration/shipped-dict/adversarial suites to make them pass — failures there mean an upstream leak
- ❌ Don't tune more than one constant per protocol iteration
- ❌ Don't re-label expected.md as the first move — the ceiling ladder comes first
- ❌ Don't weaken SENTINEL/live-null delegation assertions
- ❌ Don't edit spec/*.md (READ-ONLY; Mode A = code JSDoc only)

**Confidence Score: 9/10** — the upstream contract, q-value table, label surface, harness patterns, and the regression ladder are all pinned to verified files/lines; the only open variable (which capitalized words actually occur in prose.jsonl) is exactly what the protocol's measurement step resolves.
