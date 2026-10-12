# PRP — P1.M1.T1.S2 (bugfix 001_140e40041dd1): Un-shim the mirrored test pipelines and assert series fields through ingest

---

## Goal

**Feature Goal**: Remove the four test-pipeline mirrors of the now-dead
index.ts bare-key shim so the ingest→store path is exercised with the
enriched RunMember payload end-to-end, and extend the affected suites with
regression coverage that a capitalized-run history produces
`series: true` + `nextDisplay` successors THROUGH the real pipeline (not
fabricated stores) — the ingest-level baseline P1.M1.T2.S1's composition
layer builds on.

**Deliverable**:
- Un-shimmed pipelines in `test/acceptance.test.ts` (makeChainPipeline,
  :737-742), `test/adversarial-typing.test.ts` (:471-472),
  `test/successors.test.ts` (makeSuccPipeline, :68-70),
  `test/branch-purity.test.ts` (makeRig, :309-310) — each passes
  `runs`/`lines` directly to `recordBigramRuns`
- Updated assertions: toEqual pins that show bare `{next, count}` objects
  for capitalized-run pairs gain `series: true` + `nextDisplay` (or move
  to field-wise/partial matching) — count/order semantics never weakened
- At least one new case per meaningful site: capitalized-run text (e.g.
  `'National Renewable Energy Laboratory'` / `'The Fed raised rates'`)
  through the un-shimmed pipeline yields series-marked successors
- Mode A: rewritten fixture comments (the stale "index.ts's shim" /
  "wired exactly like src/pi/index.ts" notes now say the payload passes
  through enriched)
- UNTOUCHED legacy arms: `test/bigrams.test.ts` direct `string[][]` calls
  (:16-41) and the flood test (:238-240) — the store's
  `string | RunMemberInput` union is a pinned compat contract

**Success Definition**: all four suites green with the enriched payload
flowing; the NREL/`The Fed`-class histories assert series-marked
successors through real ingest; `npm run check` + full `npm test` green;
bigrams.test.ts bare-string arms untouched and green.

## Why

BUG-001's root cause was that every test either fabricated the enriched
store directly or mirrored the same stale projection index.ts used — so
the suite stayed green while the feature was dead end-to-end. S1 fixed
the production seam; the four mirrored fixtures still project members to
bare keys and thereby keep testing the legacy input shape. Un-shimming
them makes the ingest→store seam continuously exercised with the real
payload, and their capitalized-run fixtures (NREL replay, zephyr chain)
are the natural home for the end-to-end series assertions the PRD
recommends.

## What

For each of the four mirrors, replace the projection with the direct
pass-through:

```typescript
// BEFORE (mirror):
onAdmittedTokens: (runs) =>
  store.recordBigramRuns(runs.map((r) => r.map((m) => m.key))),
// AFTER:
onAdmittedTokens: (runs) => store.recordBigramRuns(runs),
```

(Keep each harness's `enableChaining` spread shape where present —
acceptance's makeChainPipeline takes the flag; branch-purity/adversarial/
successors wire unconditionally per their own comments.)

Then update assertions and add series coverage:

1. **test/acceptance.test.ts** (real shipped dictionary, zephyr-chain.jsonl):
   - The existing topSuccessors pins (:822-827) use lowercase non-run
     words — they should stay green unchanged; if any fixture pair turns
     out to be a capitalized run (check the fixture for adjacent
     uppercase-initial tokens, e.g. all-caps `AZNI` next to another
     capital), pin the truthful enriched shape instead of forcing the old
     one.
   - ADD a case (or extend the describe ≈813): ingest capitalized-run
     text (e.g. a user message `'National Renewable Energy Laboratory'
     repeated, dict-real) → `topSuccessors('national')` includes
     `{ next: 'renewable', count: N, series: true, nextDisplay:
     'Renewable' }`; ordinary (non-run) pairs stay `{next, count}` only.
2. **test/adversarial-typing.test.ts** (:465-478, NREL fixture): after
   un-shimming, add assertions that the run pairs inside
   'National Renewable Energy Laboratory' are series-marked with run
   casing (`nextDisplay: 'Renewable' | 'Energy' | 'Laboratory'`), and
   that any top-band member (e.g. 'The') participates via the payload
   without being stored as a word (`store.get('the')` per the
   chainOnly semantics — assert what actually holds).
3. **test/successors.test.ts** (stub dict): un-shim + rewrite the
   "index.ts's shim" comment; add a feedText-style case with capitalized
   run input asserting series marks (the stub dictionary's rejects()
   controls admission — craft input words that admit).
4. **test/branch-purity.test.ts** (stub dict): un-shim; the battery's
   fixed sequences are lowercase — keep them green; optionally add one
   capitalized-run line to the replay proving series marks survive the
   rebuild path.

Comment sync (Mode A) at every touched site: state the payload passes
through enriched (no "shim"/"until P1.M1.T2.S2" language).

### Success Criteria

- [ ] All four mirrors pass `runs` directly (grep `m.key` in those four
      files → zero shim hits)
- [ ] Acceptance/adversarial assert `series: true` + `nextDisplay` for
      capitalized-run pairs through REAL ingest
- [ ] Ordinary lowercase pairs remain `{next, count}` (asserted at least
      once — the duality is visible)
- [ ] Count/order semantics of every pre-existing pin preserved
- [ ] bigrams.test.ts bare-string arms (:16-41, flood :238-240) untouched
      and green
- [ ] No new mocking (each harness's existing dict — real or stub — stays)
- [ ] `npm run check` + full `npm test` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: all four mirror sites were
read verbatim this session (quoted below), the receiver semantics
(series iff BOTH members enriched with series===true; keys read via
`typeof m === "string" ? m : m.key`) are given by S1's contract, and the
keep-list is explicit.

### Documentation & References

```yaml
- file: test/acceptance.test.ts
  why: Mirror 1. Verified makeChainPipeline (:737-742): the projection
    inside an enableChaining spread; uses the REAL dictionary
    (loadDictionary(resolveDictPath())). The 'acceptance item 7' describe
    (≈:813) replays zephyr-chain.jsonl and pins
    topSuccessors("zorp") toEqual([{next:'zephra',count:4},
    {next:'turbine',count:1}]) etc. (:822-827) — lowercase non-run words,
    expected to stay identical; verify, then add the capitalized-run case.
  pattern: replayChain(pipeline, parseSessionFixture(...)) + toEqual on
    topSuccessors; assert store.get(...) for vocabulary admission.
  gotcha: read zephyr-chain.jsonl before pinning — if any adjacent
    uppercase-initial pair exists (e.g. 'AZNI' next to a capital), that
    entry legitimately gains series:true + nextDisplay; pin the truthful
    enriched shape, never the stale one.

- file: test/adversarial-typing.test.ts
  why: Mirror 2. Verified :465-478: NREL fixture replay
    (parseSessionFixture(NREL), 60s timeout) with the shim. The NREL
    text contains 'National Renewable Energy Laboratory' — THE
    capitalized-run fixture; after un-shimming, its run pairs MUST come
    back series-marked.
  pattern: replay(pipeline, entries) then store assertions; the
    surrounding describes test widget/provider typing paths against
    `store`.

- file: test/successors.test.ts
  why: Mirror 3. Verified makeSuccPipeline (:60-70): stub dictionary
    (lookup → rejects(w) ? REJECT+30 : null), the comment literally says
    "index.ts's shim: members → keys (plan 006 payload widening)" —
    rewrite it (Mode A). The file feeds raw texts through processText
    (its "direct drain path" helper).
  gotcha: the stub's rejects() decides admission — craft capitalized-run
    input whose members are NOT in rejects() so they admit and run-mark.

- file: test/branch-purity.test.ts
  why: Mirror 4. Verified makeRig (:304-311): stubDict + yieldFn + the
    shim. Its battery drives fixed replay sequences (structural caps,
    mid-cap tally drift, all-caps...) — lowercase pairs stay {next,count}.
  gotcha: this suite tests rebuild purity — adding ONE capitalized-run
    line to a sequence proves series marks survive the gated rebuild;
    optional but cheap.

- file: test/bigrams.test.ts
  why: DO NOT TOUCH (beyond nothing). Its direct string[][] calls
    (:16-41) and the flood test's pipeline shim (:238-240) are the
    PINNED legacy bare-string compat arms — the store's string|
    RunMemberInput union stays exercised by them.
  gotcha: the flood test (:238) contains a .map(m => m.key) shim too —
    leave it; the contract explicitly keeps it.

- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P1M1T1S1/PRP.md
  why: CONTRACT for the production seam S1 landed: index.ts passes
    `runs` unprojected inside the enableChaining spread; store.
    recordBigramRuns(runs: readonly (readonly (RunMemberInput|string)[])[])
    marks a pair series iff BOTH members are enriched objects with
    series === true; RunMember = { key, rawCasing, series?, chainOnly? }.
    The payload now flows enriched to every un-shimmed hook.
  gotcha: S1's out-of-scope list named more shim sites (bigrams:118/140,
    chain:751, perf-gates:496, chaining-gating:143, ingest-pipeline:34)
    — THIS contract enumerates exactly four mirrors + the two kept
    bigrams arms. Leave the rest untouched.

- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/bug001-series-pipeline.md
  section: §5 (the mirror table)
  why: The verified inventory of every shim mirror and what each
    fixture exercises.

- prd: BUG-001 Description/Repro + Recommendations (selected_prd_content)
  — names makeChainPipeline and adversarial-typing:471 explicitly; the
  series-marked successor shape [{next, count, series:true,
  nextDisplay}] is live-verified in the PRD's own probe.
```

### Current Codebase tree (relevant excerpt)

```bash
test/
├── acceptance.test.ts        # MODIFY — un-shim makeChainPipeline + series case
├── adversarial-typing.test.ts# MODIFY — un-shim NREL replay + series assertions
├── successors.test.ts        # MODIFY — un-shim makeSuccPipeline + comment + case
├── branch-purity.test.ts     # MODIFY — un-shim makeRig (+optional run line)
└── bigrams.test.ts           # NO CHANGE — pinned legacy bare-string arms
src/ — NO SOURCE CHANGES (S1 landed the production seam; store already widened)
```

### Desired Codebase tree with files to be changed

```bash
test/acceptance.test.ts         # -2 shim lines, +1 pass-through, +1 case, comments
test/adversarial-typing.test.ts # -2 shim lines, +1 pass-through, +series asserts
test/successors.test.ts         # -2 shim lines, +1 pass-through, comment rewrite, +1 case
test/branch-purity.test.ts      # -2 shim lines, +1 pass-through, optional +1 line
```

### Known Gotchas of our Codebase & Library Quirks

```python
# CRITICAL — toEqual pins: recordBigramRuns emits {next,count} entries
#   for ordinary pairs and {next,count,series,nextDisplay} for
#   series-marked ones — toEqual is exact, so EVERY pinned successor of a
#   capitalized-run pair must gain the two fields or the test fails.
#   Where a fixture's full entry shape is noisy, switch THAT assertion to
#   field-wise picks (toMatchObject / entry.next, entry.count, entry.series)
#   — but never weaken count or ORDER semantics.
# CRITICAL — series marking needs BOTH members enriched with series===true;
#   a run interrupted by a lowercase word, punctuation, or a masked secret
#   yields plain entries. Verify the fixture text actually contains an
#   unbroken run before pinning series:true (read the jsonl).
# GOTCHA — chainOnly top-band members ('The') are IN the payload, never
#   stored as words: through real ingest with the shipped dict,
#   topSuccessors('the') CAN exist (bigrams form) while store.get('the')
#   is undefined — assert exactly that duality where relevant, don't
#   assume the word stored.
# GOTCHA — acceptance/adversarial use the REAL shipped dictionary:
#   'National'/'Energy'/'Laboratory' quants decide admission (run-member
#   override may or may not be live depending on plan-006 P1.M1.T3 state)
#   — the PRD's own live probe confirmed 'The Fed' produces
#   {series:true,nextDisplay:'Fed'}; mirror THAT class of input if the
#   NREL words' admission is uncertain, or check dict lookups first.
# GOTCHA — debounce/fire-and-forget: fixtures that go through
#   onMessageEnd + flush() handle it; direct processText calls drain
#   synchronously (successors' helper). Reuse each harness's own drain.
# GOTCHA — keep every harness's dictionary as-is (real or stub); no new
#   mocks, no network.
# GOTCHA — the enableChaining spread in makeChainPipeline is load-bearing
#   (chaining-off arms) — change only the projection body.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies, TDD)

```yaml
Task 0: PRECONDITION
  - Confirm S1 landed: src/pi/index.ts passes runs unprojected
    (grep "m.key" src/pi/index.ts → zero hits) and test/index.test.ts's
    enriched spy pins are green. If not, STOP.

Task 1: TDD — ADD the series-through-ingest cases FIRST (they fail or
        are unprovable while the mirrors still project)
  - acceptance.test.ts: new it("capitalized-run history yields
      series-marked successors through the real pipeline") — replay or
      direct message with 'National Renewable Energy Laboratory'
      (repeated ≥2× for count) → topSuccessors('national') includes
      {next:'renewable', count:≥2, series:true, nextDisplay:'Renewable'}.
  - adversarial-typing.test.ts: after the NREL replay, assert the three
      run pairs carry series:true + nextDisplay run casings.
  - successors.test.ts: capitalized-run feedText case with the stub dict
      (non-rejected members).
  - RUN → RED (mirrors strip the enrichment).

Task 2: UN-SHIM the four mirrors (one-line pass-through each) + rewrite
        their stale comments (Mode A).
  - Run each suite; fix any toEqual pins that now see enriched entries
    (per-fixture truth: lowercase pairs unchanged; run pairs gain fields).

Task 3: BRANCH-PURITY optional enrichment
  - Add one capitalized-run line to a replay sequence; assert series
    marks present before AND after the gated rebuild (marks survive).

Task 4: FULL REGRESSION
  - npm run check
  - npx vitest --run test/acceptance.test.ts test/adversarial-typing.test.ts
    test/successors.test.ts test/branch-purity.test.ts test/bigrams.test.ts
  - npm test
  - grep -n "m) => m.key" test/acceptance.test.ts test/adversarial-typing.test.ts
    test/successors.test.ts test/branch-purity.test.ts → zero hits
    (bigrams.test.ts's flood shim INTENTIONALLY remains)
```

### Implementation Patterns & Key Details

```typescript
// The un-shim (identical at all four sites):
onAdmittedTokens: (runs) => store.recordBigramRuns(runs),

// Series assertion pattern (through real ingest, real dict):
const { store, pipeline } = makeChainPipeline(true);
await replayChain(pipeline, userMsgs([
  "Visit the National Renewable Energy Laboratory",
  "The National Renewable Energy Laboratory again",
]));
expect(store.topSuccessors("national")).toEqual([
  expect.objectContaining({ next: "renewable", count: 2, series: true,
                            nextDisplay: "Renewable" }),
]);
// Ordinary pair duality, asserted once somewhere:
expect(store.topSuccessors("zorp")).toEqual([{ next: "zephra", count: 4 }]);

// Comment rewrite pattern (successors.test.ts :68-69):
//   BEFORE: "// index.ts's shim: members → keys (plan 006 payload widening)"
//   AFTER:  "// enriched payload pass-through — mirrors src/pi/index.ts's
//            production wiring (series marks + run casing reach the store)"
```

### Integration Points

```yaml
NEXT TASK (P1.M1.T2.S1): the production-composition acceptance layer
  (index.test.ts e2e: series arming, typed-word arming, series-first
  ordering through the real factory) builds on this ingest-level baseline.
PRODUCTION SEAM: S1's index.ts pass-through — the un-shimmed fixtures now
  mirror it faithfully.
COMPAT CONTRACT: recordBigramRuns' string|RunMemberInput union stays —
  bigrams.test.ts's bare-string arms are its pin; do not "clean them up".
NO SOURCE CHANGES in this task (src/** untouched).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check
grep -n "m) => m.key" test/acceptance.test.ts test/adversarial-typing.test.ts \
  test/successors.test.ts test/branch-purity.test.ts   # zero hits
```

### Level 2: Unit Tests (TDD)

```bash
npx vitest --run test/acceptance.test.ts -t "series" -v
npx vitest --run test/adversarial-typing.test.ts -t "series" -v
npx vitest --run test/successors.test.ts test/branch-purity.test.ts
npx vitest --run test/bigrams.test.ts   # legacy arms untouched, green
npm test
```

### Level 3: Integration (the whole ingest→store seam)

```bash
npx vitest --run test/index.test.ts test/ingest-pipeline.test.ts test/chain.test.ts
# S1's production pins + untouched mirrors stay green
```

### Level 4: Domain-Specific (BUG-001 repro as a test)

```bash
# The PRD's live repro, now pinned: 'The Fed raised rates today' through
# an un-shimmed pipeline → topSuccessors('the') gains
# {series:true, nextDisplay:'Fed'} while 'the' itself never stores
# (chainOnly). Verify via the new acceptance/adversarial cases:
npx vitest --run test/acceptance.test.ts test/adversarial-typing.test.ts -t "series"
```

## Final Validation Checklist

- [ ] Four mirrors un-shimmed (direct runs pass-through); stale comments rewritten
- [ ] Series-through-real-ingest asserted at acceptance + adversarial (+ successors/branch-purity cases)
- [ ] Ordinary pairs still asserted as bare {next,count} somewhere (duality visible)
- [ ] All pre-existing pins green with count/order semantics intact
- [ ] bigrams.test.ts bare-string arms (:16-41, flood :238-240) untouched
- [ ] No src/ changes; no new mocks; real/stub dictionaries per harness unchanged
- [ ] `npm run check` + full `npm test` green
- [ ] Only the four named test files modified

## Anti-Patterns to Avoid

- ❌ Don't weaken count/order assertions to absorb the new fields — use
      objectContaining/field picks or pin the full enriched shape
- ❌ Don't un-shim bigrams.test.ts (pinned legacy compat arms) or the
      other shim sites outside this contract's four
- ❌ Don't pin series:true without reading the fixture (broken runs yield
      plain entries — pin truth, not hope)
- ❌ Don't touch src/** (S1 landed the seam; the store is already widened)
- ❌ Don't add mocks or network — reuse each harness's dictionary/drain
- ❌ Don't assume top-band run members store as words (chainOnly: bigrams
      form, words don't)

---

**Confidence Score**: 9/10 — all four mirror sites, the assertion blocks,
and the keep-list were read verbatim from live source this session; the
receiver semantics and production seam are fixed by S1's contract; the
one fixture-dependent uncertainty (whether zephyr-chain contains any
capitalized-run pair) is handled by a read-the-fixture-then-pin-truth
instruction rather than an assumption.
