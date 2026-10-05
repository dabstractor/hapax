# PRP — P1.M1.T3.S1 (plan 006): Run-member band bypass + conjugation-guard skip + top-band chain-only ceiling

---

## Goal

**Feature Goal**: Implement spec §04 h2.26 run-member admission in `score.ts`
plus the occurrence-level ingest wiring that applies it: a member of a
capitalized run admits **regardless of the commonness band** (attested →
group 1, absent → group 0), **bypasses the conjugation guard**, and — when
its dictionary q sits in the table's very top band (baked ceiling ≈ 135) —
is **chain-only**: never gains admission from casing, never upserted, but
remains in the runs payload so its series bigrams still form ("typing
`The ` offers `Fed`"). Casing evidence grants candidacy ONLY; ordering
untouched (h2.31).

**Deliverable**:
- `src/core/score.ts`: baked constant `PROPER_SERIES_TOP_BAND_CEILING`
  (≈135, calibrated + JSDoc'd), `admit()` gains a `seriesMember` occurrence
  option implementing the bypass/guard-skip/chain-only verdict; dead
  `PROPER_NOUN_ADMIT_CEILING` relief branch left retired-in-place.
- `src/pi/ingest.ts`: occurrence-level retro-override at run finalization
  (eager upserts kept; NO deferred upserts; memo stays context-free) and
  chain-only members carried in the `onAdmittedTokens` runs payload.
- Score battery in `test/score.test.ts` + ingest battery (retro-override,
  no-upsert, payload shape) in `test/ingest.test.ts`.

**Success Definition**: `npm run check` + `npm test` green; a
"National Renewable Energy Laboratory"-class line stores all members
(lowercase-history words included) at the right groups; a "The Fed Cut"
line never stores "the" but its runs payload still contains `The` so
P1.M1.T2.S2's `recordBigramRuns` forms `the fed`; guard words
("Uploaded Files") admit as run members.

## Why

- Spec goals 11/12: capitalized series are completable vocabulary that
  chains; casing eases admission but never ranks. The retired relief
  (dead branch at score.ts:303–310, ceiling == floor) can't deliver this;
  run evidence is the restored mechanism, done occurrence-level per
  architecture/01 §2's load-bearing constraint: `#computeAdmitMemo`
  (ingest.ts:567–598 region) is keyed on `token.raw` and MUST stay
  context-free — memoizing run membership would permanently admit every
  later lowercase occurrence of that token (PRD's critical pitfall).

## What

### 1. score.ts

```ts
/** Top-band ceiling for capitalized-run members — spec/04 h2.26. A run
 *  member whose dictionary q ≥ this value is CHAIN-ONLY: it never gains
 *  admission from casing (run or single), is never upserted, but stays
 *  in the runs payload so its series bigrams form ("typing 'The ' offers
 *  'Fed'"). Baked, NOT configurable (spec/08 h2.57). Calibrated against
 *  the shipped artifact: `node tools/calibrate-bands.mjs the and for with
 *  national energy`; q ≥ <VALUE> covers <MEASURED> of 48,802 words. */
export const PROPER_SERIES_TOP_BAND_CEILING = 135 as const; // calibrate!
```

- **Calibrate before baking**: run
  `node tools/calibrate-bands.mjs the and for with national energy`
  (requires Node ≥ 23.6). Confirm `the/and/for/with` sit ≥ the ceiling and
  `national/energy` below it; measure the exact population of q ≥ ceiling
  against the artifact (expected ~203 of 48,802 — count via the tool's
  threshold sweep or a one-off node probe against
  `dict/common-en.bin` scores) and record both the number and the command
  in the JSDoc. If 135 misses either probe set, pick the tightest legal
  value (the gap between `with`'s q and the first legitimate name class).
- `AdmissionOptions` gains `seriesMember?: boolean`.
- `admit()` result type gains `"chain-only"`:
  `export type AdmissionResult = RankGroup | "reject" | "chain-only";`
  When `opts.seriesMember` is true, REPLACE the table lookup path:
  ```ts
  if (opts.seriesMember) {
    if (q === null) result = 0;                        // absent → group 0
    else if (q >= PROPER_SERIES_TOP_BAND_CEILING) result = "chain-only";
    else result = 1;                                   // attested → group 1, any band
  }
  ```
  placed AFTER the existing table/relief computation, BEFORE the
  conjugation guard — and the guard's condition stays
  `!draft.properName` plus `result !== "reject"` extended to
  `result !== "reject" && result !== "chain-only"`: a run member
  **bypasses the conjugation guard** (casing evidence outranks morphology,
  parallel to the properName skip at score.ts:317 — "Uploaded Files"
  admits though `upload` q ≥ floor). `properName` relief branch, dead
  constants, rEff, everything else: untouched.
- JSDoc (Mode A) on the constant and the admit() override path, citing
  spec §04 h2.26 and the calibration command.

### 2. ingest.ts — occurrence-level wiring (memo untouched)

Structural facts (verified): `#computeAdmitMemo` is context-free
(memo key = `token.raw`); `#replayAdmitMemo` applies per-occurrence
effects and pushes ONLY ADMITTED tokens into `entries`; upserts are
segment-scoped while runs finalize line/message-scoped in `processText`.
Low-risk path per architecture/01 §8 (option b): **keep eager upserts,
retro-override at run finalization**.

- `SpanEntry`/`SegmentResult.entries` entries gain an optional
  `bandRejected?: boolean` mark: in `#replayAdmitMemo`, when the admit
  result is `"reject"` BUT the draft passed the shape gate AND
  `token.raw` starts with an uppercase ASCII letter, still push the entry
  (key/rawCasing/start/end) with `bandRejected: true` — such entries are
  run-eligible (spec: run membership requires the shape gate, not
  admission) but excluded from ordinary adjacency behavior.
- `buildMemberRuns` / the cap-run classification
  (`capRunMemberIndices`): a `bandRejected` entry counts toward a cap run
  exactly like an admitted one (its capital is run evidence); it never
  appears in NON-cap runs (ordinary runs keep today's admitted-only
  semantics — no behavior change to ordinary bigrams).
- At each run-finalization site in `processText`
  (`runs.push(...buildMemberRuns(openLine))`, both the newline loop and
  the final line), after the runs are built: for each run whose members
  are series-marked, retro-evaluate `bandRejected` members with
  `admit(draft, this.#dictionary, { seriesMember: true, ...knob })`:
  - `"chain-only"` → leave the entry un-admitted: NO upsert, NO
    stats.admitted, but the member STAYS in the run payload — mark the
    emitted `RunMember` with `chainOnly: true` (add the optional field to
    the `RunMember` interface, JSDoc'd) so P1.M1.T2.S2 records its pairs.
  - `0 | 1` (the "national"-class member, rejected on the flat band
    pre-override) → retro-admit: `this.#store.upsert(sighting)` with the
    occurrence's casing/ordinal/fromUser/properName/rankGroup=result,
    increment `this.#stats.admitted`, clear the entry's `bandRejected`
    so it behaves as admitted from here on.
  - Memo stays untouched: the seriesMember path is computed per
    occurrence at finalization, never cached.
  - Dictionary knob: pass `this.#rejectCommonness` exactly as
    `#computeAdmitMemo` does (the ceiling itself is baked — not knob-
    scaled; only the absent/attested distinction matters, which the knob
    cannot change).
- The drafted `Sighting` for a retro-admitted member: `display` /
  `properName` from this occurrence (`rawCasing`, capital initial ⇒ true),
  `rankGroup` from the override. (Casing tallies are P1.M1.T2.S1's store
  concern; `Sighting.display` still exists at this stage.)
- Never defer or undo upserts; a member already admitted eagerly keeps
  its eager group (eager admit never returns better than group 1 anyway;
  the override cannot downgrade it — spec's "run evidence outranks"
  concern is admission, not group escalation of already-admitted words;
  DO NOT re-upsert eagerly-admitted members).

### Success Criteria

- [ ] `admit(seriesMember)` verdicts: absent → 0; attested q < ceiling → 1 (incl. q ≥ floor: "national"); attested q ≥ ceiling → `"chain-only"`; band + conjugation guard bypassed on all three
- [ ] Ingest: "National Renewable Energy Laboratory" line → all four members stored (national g1 despite q ≥ floor); lowercase "national" elsewhere stays band-rejected
- [ ] "The Fed Cut" → `the` NEVER upserted; runs payload contains The (chainOnly) + Fed + Cut; store has no "the" candidate
- [ ] "Uploaded Files" → "uploaded" stored (guard bypassed by run membership)
- [ ] Ordinary (non-cap) runs unchanged: band-rejected lowercase words still never enter runs/bigrams
- [ ] Memo context-free: a token seen capitalized in one run and lowercase elsewhere admits/rejects per occurrence (no cross-contamination) — pinned by test
- [ ] `npm run check` + `npm test` green; PROPER_NOUN_ADMIT_CEILING branch untouched and still dead (existing pin test intact)

## All Needed Context

### Context Completeness Check

"Yes": exact current code shapes of admit()/rEff/constants, the memo/replay
seam, run machinery, payload types, sibling contracts, and test conventions
are all reproduced or line-anchored below.

### Documentation & References

```yaml
- file: src/core/score.ts
  why: edit site. REJECT_COMMON_THRESHOLD=30 (:109), MID_FREQ_THRESHOLD=20
        retired (:121), PROPER_NOUN_ADMIT_CEILING=30 (:152, dead branch
        :303-310 — DO NOT revive), rEff (:188-196), admit (:282-361),
        AdmissionOptions (just above admit), conjugation guard properName
        skip (:317).
  gotcha: float compares — never round. The 256 sentinel at len ≥ 20 is
        irrelevant to the seriesMember path (it replaces the table compare
        entirely, and the ceiling is a plain q compare).

- file: src/pi/ingest.ts
  why: edit site. RunMember interface (:103-111 — {key, rawCasing,
        series?}), SpanEntry (:~130-145), SegmentResult (:~148-153),
        WHITESPACE_GAP_RE (:128), buildMemberRuns (:218-235, marks
        series:true for cap-run members), capRunMemberIndices (:251-271),
        processText run-finalization sites (the two
        `runs.push(...buildMemberRuns(openLine))` blocks),
        #admitSegment (:664+), #computeAdmitMemo (:~700 — CONTEXT-FREE,
        DO NOT TOUCH), #replayAdmitMemo (:~740+ — entries.push lives here).
  critical: memo key = token.raw; series membership is line context the
        memo never sees. Retro-override ONLY at run finalization.

- docfile: plan/006_7bd0258da993/architecture/01-core-pipeline-r1.md
  sections: §2 (occurrence-vs-memo seam), §5 (score detail, dead relief),
        §8 feasibility table ("option (b) retro-override — the low-risk
        path"), §9 (structural fact: upserts segment-scoped, runs
        line-scoped).
  why: the design mandate for the wiring approach, straight from research.

- file: plan/006_7bd0258da993/P1M1T2S2/PRP.md
  why: CONTRACT (parallel sibling, store side): recordBigramRuns records
        EVERY adjacent pair in runs incl. chain-only members; RunMember
        import shape {key, rawCasing, series?}. Your `chainOnly?` field is
        additive — T2.S2 ignores unknown fields; verify final RunMember
        home (ingest.ts) after both land and re-read the live file.

- file: plan/006_7bd0258da993/P1M1T3.S2 (Planned, NEXT sibling)
  why: owns the single-capital relaxed band max(R_eff, 95) AND the
        calibrate-bands Cap column update. Do NOT add 95 here; do NOT
        touch calibrate-bands.mjs beyond running it read-only.

- file: tools/calibrate-bands.mjs
  why: the calibration probe (argv word mode prints q + verdict lc/Cap;
        requires Node ≥ 23.6). READ-ONLY in this task.

- file: test/score.test.ts
  why: battery conventions — in-memory dictionary doubles (plain object
        maps per the types.ts Dictionary contract), boundary cases via
        imported constants, describe-per-rule.

- files: test/ingest.test.ts, test/bigrams.test.ts
  why: ingest battery conventions (IngestPipeline with real core chain,
        fake dictionary, onAdmittedTokens capture) and run payload tests.
```

### Current Codebase tree (relevant)

```bash
src/core/score.ts      # constants + admit() — ceiling, seriesMember option
src/pi/ingest.ts       # SpanEntry marks, retro-override, RunMember.chainOnly
test/score.test.ts     # seriesMember battery
test/ingest.test.ts    # retro-override / chain-only payload battery
```

### Desired Codebase tree

Same files — no new files.

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: memoizing seriesMember would be a correctness bug, not just
// style: memo key is token.raw, so "National" seen in one run would
// permanently admit every later "National" occurrence. Occurrence-only.

// CRITICAL: chain-only members are never upserted — the STORE NEVER SEES
// them, which is exactly how they can never become standalone suggestions.
// Their only footprint is the runs payload (series bigrams) — h2.26.

// GOTCHA: band-rejected entries must NOT leak into ordinary
// (non-cap) adjacency runs — ordinary bigram semantics are frozen
// (PRD 002 rules, pinned suites). Cap-run classification only.

// GOTCHA: stats — retro-admitted members increment #stats.admitted at
// finalization; chain-only increment nothing. rejectedByGate is untouched
// (these tokens PASSED the gate; admission-reject has no stats field by
// design — keep it that way).

// GOTCHA: #isDisabled mid-finalization — mirror the BUG-004 discipline:
// if the disable gate fires, skip remaining retro-overrides and do NOT
// call onAdmittedTokens (runs are meaningless once dead).

// GOTCHA: run detection includes line-initial/after-punctuation
// positions (structural-start exclusion does NOT apply to runs —
// h2.26). buildMemberRuns already handles this; don't re-filter.

// calibrate-bands.mjs needs Node ≥ 23.6 (native TS type stripping).

// NodeNext .js imports in src/test; in-memory dictionary doubles, no
// real binary in unit tests.
```

## Implementation Blueprint

### Implementation Tasks (ordered, TDD)

```yaml
Task 1: CALIBRATE
  - node tools/calibrate-bands.mjs the and for with national energy
  - confirm the/and/for/with q ≥ candidate ceiling; national/energy below;
    measure population (expected ~203 / 48,802). Record numbers.

Task 2: ADD score battery (red) — test/score.test.ts, new describe
  "run-member admission (h2.26)":
  - seriesMember+absent → 0; seriesMember+q<ceiling → 1 (incl. q ≥ floor,
    boundary via imported PROPER_SERIES_TOP_BAND_CEILING: q = ceiling−1
    admits, q = ceiling → "chain-only");
  - guard bypass: dictionary {"upload": 200, "uploaded": null}, word
    "uploaded" seriesMember → 1 (lowercase same word, no flag → "reject");
  - non-series above-ceiling capitalized ("The", properName, no flag) →
    "reject" (casing never admits top-band singles);
  - relief branch still dead (existing pin); MID_FREQ_THRESHOLD pin intact.

Task 3: EDIT src/core/score.ts
  - PROPER_SERIES_TOP_BAND_CEILING with calibration JSDoc (Task 1 numbers).
  - AdmissionResult += "chain-only"; AdmissionOptions.seriesMember;
    admit() override branch per What §1 (after relief, before guard;
    guard condition gains the chain-only exclusion). Mode-A JSDoc.

Task 4: ADD ingest battery (red) — test/ingest.test.ts, new describe:
  - full-chain runs (fake dictionary + onAdmittedTokens capture):
    "National Renewable Energy Laboratory" (dict: national=90,
    energy=94, laboratory=57, renewable=null) → all 4 stored
    (store dump or a store double capture), groups 1/0/1/1;
  - "The Fed Cut" (the=240, fed=null, cut=null) → no "the" sighting;
    captured runs contain {key:"the", rawCasing:"The", series:true,
    chainOnly:true} + fed + cut;
  - "Uploaded Files" (upload=200, uploaded=null) → "uploaded" stored g0;
  - lowercase "national energy" (no run) → not stored, runs payload has
    no series members / no band-rejected leak;
  - memo purity: "National" in a run admits THIS message; later message
    "national grid" lowercase-only admits nothing for "national";
  - ordinary runs unchanged: "the quick brown fox" → runs exclude "the".

Task 5: EDIT src/pi/ingest.ts
  - SpanEntry/entries bandRejected mark in #replayAdmitMemo
    (reject + gate-ok + uppercase initial ⇒ push marked entry);
  - cap-run classification counts bandRejected members; ordinary runs
    exclude them;
  - RunMember.chainOnly?: boolean (JSDoc: never upserted; series pairs
    only — h2.26);
  - retro-override pass at both run-finalization sites in processText
    (admit with seriesMember; chain-only → mark payload member;
    0|1 → upsert Sighting + stats.admitted++ + clear mark);
    #isDisabled guard; rejectCommonness knob forwarded;
  - doc comments updated (memo stays context-free — say WHY).

Task 6: VALIDATE — npm run check; npx vitest --run test/score.test.ts
  test/ingest.test.ts test/bigrams.test.ts test/adversarial-ingest.test.ts;
  full npm test.
```

### Implementation Patterns & Key Details

```ts
// admit() override (sketch — placement per What §1):
if (opts.seriesMember === true) {
  if (q === null) result = 0;
  else if (q >= PROPER_SERIES_TOP_BAND_CEILING) result = "chain-only";
  else result = 1;
} else { /* existing table + relief — untouched */ }
// guard:
if (result !== "reject" && result !== "chain-only" && !draft.properName) { ... }

// Retro-override (sketch, at run finalization):
for (const run of lineRuns) {
  if (!run.some(m => m.series)) continue;
  for (const m of run) {
    if (!m.bandRejected) continue;
    const verdict = admit(m.draft, dict, { seriesMember: true, ...knob });
    if (verdict === "chain-only") { m.chainOnly = true; continue; }
    this.#stats.admitted++;
    this.#store.upsert({ key: m.key, display: m.rawCasing, ordinal,
      fromUser, properName: true, rankGroup: verdict });
    m.bandRejected = false;
  }
}
```

### Integration Points

```yaml
CODE: src/core/score.ts, src/pi/ingest.ts
TESTS: test/score.test.ts, test/ingest.test.ts
CONSUMES: RunMember payload shape (P1.M1.T1.S2, landed) — {key, rawCasing, series?}
DOWNSTREAM: P1.M1.T2.S2 recordBigramRuns (records pairs incl. chain-only
  members — verify interplay of your chainOnly mark with its series
  derivation, both additive); P1.M1.T3.S2 (95 band + calibrate Cap column);
  P1.M2.T2.* (offers read topSuccessors — chain-only words absent from
  store by construction)
FROZEN: #computeAdmitMemo (context-free), store.ts (parallel sibling),
  query.ts, provider/widget, tools/calibrate-bands.mjs, the dead relief
  branch, ordinary-run/bigram semantics
```

## Validation Loop

### Level 1: Types + targeted tests

```bash
npm run check
npx vitest --run test/score.test.ts test/ingest.test.ts test/bigrams.test.ts test/adversarial-ingest.test.ts
```

### Level 2: Full suite

```bash
npm test
```

### Level 3: Calibration pin (read-only)

```bash
node tools/calibrate-bands.mjs the and for with national energy
# the/and/for/with: must show q ≥ PROPER_SERIES_TOP_BAND_CEILING (they are
# chain-only material); national/energy: q < ceiling (run-admits as g1).
# The Cap column does NOT yet reflect seriesMember verdicts — that update
# is P1.M1.T3.S2's. Record output numbers in the constant's JSDoc.
```

### Level 4: Behavior spot-check (unit-level, already in Task 4)

The ingest battery IS the integration check (real core chain, fake dict,
hook capture). No live-TTY item here (pure core/ingest logic; live
verification rides P3.M1.T2.S3).

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green
- [ ] Ceiling constant calibrated + JSDoc'd (command, measured population, probe words)
- [ ] seriesMember verdicts: absent→0 / attested→1 / q≥ceiling→"chain-only"; band & guard bypassed
- [ ] Chain-only: never upserted (store never sees "the"), stays in runs payload with chainOnly mark
- [ ] Retro-admit at finalization: Sighting upserted + stats.admitted++ only on the 0|1 path
- [ ] Memo untouched and context-free; occurrence purity pinned by test
- [ ] Ordinary (non-cap) runs and bigrams byte-identical in behavior; existing suites green
- [ ] Dead relief branch untouched; MID_FREQ_THRESHOLD pin intact
- [ ] Diff confined to score.ts, ingest.ts, the two test files

## Anti-Patterns to Avoid

- ❌ Putting seriesMember into the memo (permanently admits later lowercase occurrences — the PRD's critical pitfall)
- ❌ Deferred/buffered upserts (rejected alternative — architecture/00 §3.2; eager + retro-override is the chosen path)
- ❌ Reviving the relief branch or changing PROPER_NOUN_ADMIT_CEILING
- ❌ Making the ceiling configurable (08 h2.57 — baked)
- ❌ Letting band-rejected entries leak into ordinary runs/bigrams
- ❌ Re-upserting eagerly-admitted members or escalating their group
- ❌ Touching calibrate-bands.mjs (T3.S2 owns the Cap column) or store.ts (T2.S1/T2.S2 own it)
- ❌ Ordering changes of any kind — casing grants candidacy only (h2.31)

---

**Confidence Score: 8/10** — the override semantics, memo constraint, and
wiring path are fully anchored in verified code and the architecture
research; the residual risk is the precise ingest plumbing around
`bandRejected` entries (both run-finalization sites must apply the same
pass), mitigated by the enumerated ingest battery.
