# PRP — P1.M4.T1.S2: CI-scriptable micro-benchmarks against hard budgets

## Goal

**Feature Goal**: Implement the PRD §09 performance-gate micro-benchmarks
(gates a–d) as a vitest-bench suite runnable via `npm run bench`, using
SYNTHETIC fixtures only (never the shipped 1.3 MB `dict/common-en.bin`),
asserting each budget with 3× CI headroom (> 3× budget = hard failure) and
logging measured actuals.

**Deliverable**:
1. `test/bench/core.bench.ts` — tinybench benchmarks (reporting numbers)
   for all four gates.
2. `test/perf-gates.test.ts` — plain vitest tests performing the SAME
   measurements and asserting the hard 3× bounds (this is what makes a
   regression actually fail CI; tinybench `bench()` output alone does not).
3. `test/helpers/bench-fixtures.ts` — synthetic fixture generators
   (20k-word store fill, 20k-word synthetic dictionary binary, 800 KB
   synthetic session text).
4. One line in README "Development" section: `npm run bench` runs the
   PRD §09 performance gates.
5. `package.json` unchanged (script `bench` already exists).

**Success Definition**: `npm run bench` runs and prints all four gates with
measured numbers; `npm test` includes `test/perf-gates.test.ts` and fails
on any > 3× budget regression; no benchmark touches the shipped dict
artifact; every measured actual is logged to console output.

## User Persona

**Target User**: hapax developer / CI runner verifying the PRD §09
performance gates as part of the M1 definition of done (h2.53).
**Use Case**: after any core-pipeline change, run `npm run bench` and
`npm test` to confirm the four hard budgets still hold.
**User Journey**: developer changes `src/core/query.ts` → runs
`npm run bench` → sees measured p99 for the 20k-candidate query →
`npm test` perf-gates suite stays green.
**Pain Points Addressed**: PRD §09 gates are currently unimplemented —
nothing in CI detects a 10× query or ingest regression.

## Why

- PRD §09 h2.51 defines four CI-scriptable micro-benchmarks; PRD M1 DoD
  (h2.53) requires "performance gates pass". This task is that gate.
- `src/core/query.ts` explicitly anticipates this bench pass ("If the
  P1.M4.T1.S2 bench pass ever shows huge hot ranges, partial top-N
  selection is the documented fallback").
- Feeds P1.M4.T2.S2 (M1 DoD verification sweep) with concrete evidence.

## What

Four gates, per the PRD §09 table, each asserted loosely (3× budget) with
actuals logged:

**(a) 20k-candidate prefix query + rank + top 8 — < 1 ms p99**
- Fill a `CandidateStore` to its cap (`STORE_CAP = 20_000`) via synthetic
  `Sighting` upserts (deterministic PRNG, mixed rankGroups/fromUser).
- Repeat 1000×: `rankMatches(store, prefix, { limit: 8 })` on a prefix
  matching a realistic hot range (~20–200 candidates sharing a 2-char
  prefix, e.g. `"co"`, `"pr"`), measure each call with
  `performance.now()`, take p99 = sorted[⌈0.99·N⌉].
- CI assert: p99 < 3 ms. Log actual p99, median, max.

**(b) Dictionary load + full lookup sweep of 20k words — < 60 ms**
- Build a SYNTHETIC dictionary with `buildDictBinary` from
  `test/helpers/dict-writer.ts` (≥ 20k synthetic words, power-of-two
  bucket count — reuse the helper's contract; NEVER load
  `dict/common-en.bin`). Write to a temp file (`os.tmpdir()` +
  `mkdtempSync`, cleaned up in `afterAll`).
- Measure: `loadDictionary(tmpPath)` + lookup of every one of the 20k
  words (assert each returns non-null so the sweep is honest) + a batch of
  absent words (null).
- CI assert: total < 180 ms (3×). Log actual.

**(c) Ingest 800 KB synthetic session text — < 60 ms, yields every ≤ 64 KB**
- Generate 800 KB of synthetic message text deterministically (seeded
  PRNG; realistic word-length distribution, some camelCase identifiers,
  some common words — generator lives in `bench-fixtures.ts`).
- Construct `IngestPipeline` with the synthetic dictionary from (b) and a
  **counting `yieldFn`** (`async () => { yieldCount++ }`).
- Measure `await pipeline.processText(text, true)`; assert
  `yieldCount ≥ Math.ceil(800_000 / 65_536)` (= 13) so the
  yield-every-≤64KB contract is enforced.
- CI assert: < 180 ms (3×). Log actual + yield count.

**(d) Steady-state heap delta (dict + store) — < 6 MB**
- After a warmup full pipeline run (dict loaded + store filled + one query
  pass), record `process.memoryUsage().heapUsed`; run additional full
  iterations of load/fill/query; measure heap delta after settling
  (a couple of `await new Promise(r => setImmediate(r))` drains).
- CI assert: delta < 18 MB (3×). Log actual.
- GC caveat: `--expose-gc` is not on in CI; rely on warmup + 3× margin.
  Fallback if noisy in practice: spawn a child
  `node --expose-gc --import tsx`… — do NOT build this unless flaky;
  prefer widening warmup first.

### Success Criteria

- [ ] `npm run bench` executes `test/bench/core.bench.ts` and prints
      measured numbers for all four gates
- [ ] `npm test` runs `test/perf-gates.test.ts` with 3× budget assertions,
      green on the current codebase
- [ ] Yield-every-≤64KB asserted via counting yieldFn (gate c)
- [ ] No reference to `dict/common-en.bin` in any bench/gate file
      (synthetic fixtures only)
- [ ] README "Development" section notes `npm run bench`

## All Needed Context

### Context Completeness Check

The implementing agent gets exact APIs (`CandidateStore`, `Sighting`,
`rankMatches`, `IngestPipelineOptions`, `loadDictionary`,
`buildDictBinary`), the gate table with CI thresholds, the measurement
recipes (p99-of-1000, before/after heap), and the vitest-bench vs
assert-test split rationale. No prior hapax knowledge assumed.

### Documentation & References

```yaml
- file: test/helpers/dict-writer.ts
  why: buildDictBinary(entries) — THE synthetic dictionary fixture
    generator (contract from P1.M1.T2.S2); also DictEntry shape.
  gotcha: bucket count must be power of two (loader contract);
    check the helper computes it or pass 32_768-ish entries.

- file: src/core/dictionary.ts
  why: loadDictionary(path) (throws on bad magic/truncated — validation is
    load-time, included in gate b measurement), lookup(word) → number|null,
    allocation-free per-lookup contract.

- file: src/core/store.ts
  why: CandidateStore (no ctor args), upsert(Sighting), nextOrdinal(),
    STORE_CAP = 20_000 — the store-fill recipe for gate a.
  gotcha: upsert never advances the ordinal — call store.nextOrdinal()
    periodically while filling so salience/recency math is realistic.

- file: src/core/types.ts
  why: Sighting { key, display, ordinal, fromUser, properName, rankGroup,
    isSubword, parentKey? } + RankGroup enum values for synthetic fills.

- file: src/core/query.ts
  why: rankMatches(store, prefix, { limit }) — the measured call for gate
    a; note the doc's partial top-N fallback plan if the bench shows hot
    ranges blow the budget.

- file: src/pi/ingest.ts
  why: IngestPipeline + IngestPipelineOptions { store, dictionary,
    debounceMs?, chunkBytes? (default 65_536), yieldFn? } and
    processText(text, fromUser) — gate c harness. yieldFn is the
    test-injectable counting hook the pipeline was built for.
  gotcha: use processText directly (bypasses the 300 ms debounce);
    do NOT use onMessageEnd in benches.

- file: src/pi/ingest.ts (restoreFromHistory region)
  why: NOT needed — benches drive processText directly; avoid dragging
    session-manager fakes into the bench.

- file: plan/001_88fc3a66fd74/P1M4T1S1/PRP.md
  why: SIBLING CONTRACT running in parallel — creates test/fixtures/
    sessions/*.jsonl + test/acceptance.test.ts (incl. a < 300 ms restore
    timing). Do NOT duplicate those fixtures or that timing; benchmarks
    are self-contained synthetic. Keep file names disjoint.

- url: https://vitest.dev/guide/features.html#benchmarking
  why: vitest bench API (bench()/describe, options.warmupIterations,
    options.iterations, time unit) — tinybench under the hood.
  critical: bench() reports numbers but does not FAIL on thresholds;
    hard gating must live in a plain test (perf-gates.test.ts).

- url: https://nodejs.org/api/process.html#processmemoryusage
  why: process.memoryUsage().heapUsed for gate d before/after delta.

- file: plan/001_88fc3a66fd74/P1M4T1S2/research/notes.md
  why: verified API signatures, budget table, vitest-bench findings
    (script "bench": "vitest bench" already in package.json).
```

### Current Codebase tree (relevant)

```bash
hapax/
├── package.json            # scripts: check, test, bench (vitest bench) — exists
├── dict/common-en.bin      # SHIPPED artifact — NEVER used by benches
├── src/core/               # dictionary, segment, shapeGate, score, store, query, types
├── src/pi/                 # ingest (IngestPipeline, yieldFn hook), provider, index, config
├── test/helpers/dict-writer.ts   # buildDictBinary — synthetic dict fixture
└── test/                   # vitest suites (S1 is adding acceptance.test.ts + fixtures/sessions/)
```

### Desired Codebase tree with files to be added

```bash
test/
├── helpers/
│   └── bench-fixtures.ts   # synthetic generators: makeSightings(20k),
│                           # makeSyntheticDictBinary(), makeSessionText(800_000)
├── bench/
│   └── core.bench.ts       # tinybench benchmarks (reporting) — gates a–d
└── perf-gates.test.ts      # plain vitest tests asserting 3× bounds (hard CI gate)
README.md                   # +1 line in Development: npm run bench
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: never load dict/common-en.bin in benches — PRD §09 mandates a
//   synthetic dictionary fixture; the artifact path also differs per
//   install location (resolveDictPath) — irrelevant here.
// CRITICAL: tinybench bench() alone cannot fail CI on a threshold — the
//   hard gate MUST be a plain `test()` computing the same metric and
//   asserting the 3× bound. Bench file = reporting, gate test = failure.
// GOTCHA: store.upsert does NOT advance the ordinal — interleave
//   store.nextOrdinal() while filling (e.g. per 20 sightings) or salience
//   /recency comparisons degenerate to ties (unrealistically cheap sort).
// GOTCHA: rankMatches lowercases the prefix; pass lowercase prefixes.
// GOTCHA: buildDictBinary bucket count must be a power of two — verify
//   against test/helpers/dict-writer.ts (it round-trips in
//   test/dictionary.test.ts, so its output satisfies the loader).
// GOTCHA: dict loader throws on any structural violation — include the
//   load inside the gate-b measurement (it's part of the budget).
// GOTCHA: no --expose-gc in CI: gate d needs warmup iterations + a couple
//   of setImmediate drains before the "before" snapshot; 3× margin absorbs
//   GC noise. If flaky, increase warmup before reaching for child
//   processes.
// GOTCHA: timing in CI is noisy — never assert the raw PRD budget
//   (<1 ms/<60 ms/<6 MB); assert 3× and log actuals (PRD §09 rule).
// GOTCHA: temp files for the synthetic dict binary: mkdtempSync under
//   os.tmpdir(), rmSync in afterAll — no artifacts left in the repo
//   (PRD DoD "no persistence files written").
// GOTCHA: vitest bench default include is **/*.bench.ts — placing the
//   file at test/bench/core.bench.ts is picked up by `npm run bench`.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE test/helpers/bench-fixtures.ts
  - IMPLEMENT: makeStore(cap=20_000, seed=42): CandidateStore — deterministic
    seeded PRNG (mulberry32), interleaved nextOrdinal() every ~20 upserts,
    mixed rankGroup/fromUser/properName per Sighting; PLUS
    makeSyntheticDict(wordCount≈20_000): { buffer, words[] } via
    buildDictBinary (synthetic words like `synw<i>base` varied lengths,
    8-bit frequencies; power-of-two buckets per helper contract); PLUS
    makeSessionText(bytes=800_000): string — seeded, realistic word-length
    distribution with occasional camelCase/hexish tokens and common words
    (so shape-gate rejection paths are exercised realistically)
  - NAMING: makeStore / makeSyntheticDict / makeSessionText
  - PLACEMENT: test/helpers/ (sibling of dict-writer.ts)
  - REUSE: import { buildDictBinary, DictEntry } from "./dict-writer"

Task 2: CREATE test/perf-gates.test.ts  (THE hard CI gate)
  - GATE A: fill makeStore(20_000); pick 2-char hot prefix (e.g. "co");
    warmup 100 rankMatches calls; then 1000 timed calls
    (performance.now() each); p99 = sorted[990]; expect(p99).toBeLessThan(3)
    ; console.log actual p99/median/max
  - GATE B: makeSyntheticDict(20_000) → write to tmp file; time
    loadDictionary + full sweep lookup of every word (expect non-null) +
    ~1k absent lookups (expect null); expect total < 180 ms; log actual
  - GATE C: pipeline = new IngestPipeline({ store, dictionary,
      yieldFn: async () => { yields++ } }); time
      await pipeline.processText(makeSessionText(800_000), true);
    expect dt < 180; expect yields >= Math.ceil(800_000 / 65_536);
    log actual dt + yield count
  - GATE D: after a warmup cycle (load dict, fill store, query), snapshot
    process.memoryUsage().heapUsed; run 3 more full cycles + setImmediate
    drains; expect heap delta < 18 * 1024 * 1024; log actual MB
  - CLEANUP: afterAll rmSync(tmpdir, { recursive: true, force: true })
  - NAMING: describe("perf gate a — ...") style, one describe per gate
  - PLACEMENT: test/perf-gates.test.ts (picked up by npm test)
  - GOTCHA: see Known Gotchas — ordinal interleaving, 3x bounds only

Task 3: CREATE test/bench/core.bench.ts  (reporting via vitest bench)
  - IMPLEMENT: same four measurements as tinybench `bench()` entries
    (gate a as bench with manual inner 1000x loop returning p99 — or
    per-op bench; gate b/c single-op benches; gate d computed op) —
    reuse helpers from Task 1; include console.log of thresholds
  - NAMING: bench("query: 20k-candidate prefix + rank + top 8", ...)
  - PLACEMENT: test/bench/core.bench.ts (matches vitest bench include)
  - NOTE: this file REPORTS; only perf-gates.test.ts FAILS CI

Task 4: MODIFY README.md — Development section
  - ADD one line: `npm run bench` runs the PRD §09 performance-gate
    micro-benchmarks (synthetic fixtures; > 3× budget fails via
    `npm test` perf-gates suite)

Task 5: VALIDATE
  - npm run bench → all four benches execute with numbers
  - npm test → perf-gates.test.ts green alongside full suite
  - npm run check → clean
  - grep -r "common-en" test/bench test/perf-gates.test.ts → no matches
  - git status: only intended files; tmp dir cleaned
```

### Implementation Patterns & Key Details

```ts
// PATTERN: p99-of-1000 measurement (gate a)
const dts: number[] = [];
for (let i = 0; i < 1000; i++) {
  const t = performance.now();
  rankMatches(store, prefix, { limit: 8 });
  dts.push(performance.now() - t);
}
dts.sort((a, b) => a - b);
const p99 = dts[Math.ceil(0.99 * dts.length) - 1];
expect(p99).toBeLessThan(3); // 3x PRD budget (1 ms) per §09 CI rule
console.log(`[gate a] p99=${p99.toFixed(3)}ms median=${dts[500].toFixed(3)}ms`);

// PATTERN: counting yield hook (gate c) — injectable seam built for this
let yields = 0;
const pipeline = new IngestPipeline({
  store, dictionary,
  yieldFn: async () => { yields++; },
});
const t = performance.now();
await pipeline.processText(text, true); // direct — bypasses debounce
expect(performance.now() - t).toBeLessThan(180);
expect(yields).toBeGreaterThanOrEqual(Math.ceil(text.length / 65_536));

// PATTERN: store fill with realistic ordinals (gate a/d)
for (let i = 0; i < 20_000; i++) {
  if (i % 20 === 0) store.nextOrdinal();
  store.upsert({ key, display, ordinal: store.currentOrdinal(),
    fromUser: rng() < 0.3, properName: rng() < 0.1,
    rankGroup: pickRankGroup(rng), isSubword: false });
}
```

### Integration Points

```yaml
ROUTES: none
CONFIG: none — benches run on default constants; no env vars
PACKAGE.JSON: unchanged ("bench": "vitest bench" already present)
DEPENDS-ON: buildDictBinary (test/helpers/dict-writer.ts, done),
  CandidateStore + rankMatches + loadDictionary + IngestPipeline (done)
COORDINATION: parallel sibling P1.M4.T1.S1 owns test/acceptance.test.ts
  and test/fixtures/sessions/ — do not touch or duplicate; our files are
  disjoint (test/bench/, test/perf-gates.test.ts, test/helpers/bench-fixtures.ts)
CONSUMED-BY: P1.M4.T2.S2 (M1 DoD sweep — perf gates evidence),
  future tuning protocol (§09 h2.52 regression detection)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check          # tsc --noEmit — clean (bench files included via tsconfig test scope)
```

### Level 2: The gates themselves

```bash
npm run bench                          # all four benches run, numbers printed
npx vitest --run test/perf-gates.test.ts -v   # gates a–d green, actuals logged
npm test                               # full suite green, no interference
```

### Level 3: Regression-detection sanity (prove the gate bites)

```bash
# temporarily change a bound in test (e.g. gate a to < 0.001 ms) →
# perf-gates.test.ts must FAIL; revert. Confirms the harness can fail.
```

### Level 4: Hygiene

```bash
grep -rn "common-en" test/bench test/perf-gates.test.ts   # expect no matches
git status --porcelain   # only intended new files + README line
ls /tmp/hapax-bench-*    # temp dirs cleaned by afterAll
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean
- [ ] `npm test` green including perf-gates suite
- [ ] `npm run bench` executes all four gates and prints measured actuals
- [ ] Level-3 sanity confirmed the gate can fail

### Feature Validation

- [ ] Gate a: p99 < 3 ms asserted, actual logged
- [ ] Gate b: load + 20k sweep < 180 ms asserted, actual logged
- [ ] Gate c: < 180 ms AND yields ≥ ceil(800KB/64KB) asserted
- [ ] Gate d: heap delta < 18 MB asserted, actual logged
- [ ] Synthetic fixtures only — shipped dict never loaded
- [ ] README Development line added

### Code Quality Validation

- [ ] Fixture generators deterministic (fixed seeds)
- [ ] Temp files cleaned (afterAll rmSync)
- [ ] No new npm dependencies
- [ ] No overlap with sibling S1's files

## Anti-Patterns to Avoid

- ❌ Don't assert raw PRD budgets (< 1 ms) — CI noise fails randomly;
  3× bound + logged actual is the PRD §09 contract
- ❌ Don't rely on tinybench `bench()` for the hard failure — it reports
  only; the plain test in perf-gates.test.ts is the gate
- ❌ Don't load dict/common-en.bin — synthetic buildDictBinary fixture only
- ❌ Don't go through onMessageEnd/debounce in gate c — processText
  directly (debounce would add 300 ms of noise)
- ❌ Don't create giant committed fixture files — generate everything
  in-memory at bench time (deterministic seeds)
- ❌ Don't forget ordinal interleaving in store fills — all-tie salience
  makes sort behavior unrealistic and the measurement dishonest

## Confidence Score

**9/10** — every API used here was verified by reading the source
(store, query, dictionary, ingest yieldFn hook, dict-writer helper);
`npm run bench` wiring already exists; the only soft spot is gate d heap
noise in CI, mitigated by warmup + 3× margin with a documented fallback.