# PRP — P1.M4.T1.S1: Full-suite regression run, cross-fix fallout repair, and acceptance re-measurement

## Goal

**Feature Goal**: Close the PRD Testing-Summary loop for bugfix-001: run the
complete gauntlet (`npm test` + `npm run check`) against the codebase that
now contains all six bug fixes (BUG-001..BUG-006), diagnose and repair any
cross-fix fallout (a fix that broke another fix's or a spec-derived test's
expectations), verify perf-gates stay inside the 3× budgets, and re-measure
§09 integration items 5 (secret-paste battery), 6 (stock parity sentinels),
and 7 (NREL chain) as re-runnable command + result pairs recorded in
docs/M1-DoD.md.

**Deliverable**:
1. Green `npm test` (all suites, ≥636+ tests incl. every new pin) and clean
   `npm run check` — with fallout fixes where needed, each fix preferred
   over any test weakening, judgment calls documented.
2. Updated `docs/M1-DoD.md` — §09 **integration** item 5/6/7
   re-verification sections refreshed with new measured evidence
   (re-runnable command + result pairs, Mode A).
3. Evidence summary in this item's `research/` for P1.M4.T2.S1/S2 to cite.

**Success Definition**: `npm run check` exit 0; `npm test` fully green;
`npx vitest --run test/perf-gates.test.ts` green (3× budgets hold —
especially under the bigram drain loop's added eviction work); the three
acceptance items each have a recorded re-runnable command and its fresh
output in docs/M1-DoD.md; every conflict resolved by fixing code, not by
loosening a spec-derived assertion (or, where a judgment call was made, it
is written down with rationale).

## User Persona

**Target User**: hapax maintainer producing the bugfix-001 changeset record.
**Use Case**: cite trustworthy, freshly measured evidence that the six
defects are closed and nothing else regressed.
**User Journey**: run the gauntlet → read docs/M1-DoD.md item 5/6/7 sections
with new commands + outputs → downstream doc tasks cite the same numbers.
**Pain Points Addressed**: six independent fixes touched provider
delegation, admission bands, secret masking, segmentation, and store
eviction simultaneously — nobody has yet proven they compose.

## Why

- The last recorded green baseline is 636 tests / tsc clean
  (architecture/spec-acceptance-map.md L20), BEFORE the six fixes landed.
- The fixes interact by construction: the relief band (ceiling=95, tuned via
  prose A/B in f438272) sits between calibration/shipped-dict assertions and
  the NREL pin; the 32-char mask floor + parent-token secret poisoning
  interact with adversarial-ingest; stock-context delegation + chain reset
  interact with provider/chain/editor-sim suites; the bigram drain loop adds
  eviction work inside `recordBigramRuns` (perf-gate exposure).
- PRD §09 closure requires items 5/6/7 re-verified with evidence, and
  P1.M4.T2.S1/S2 cite these numbers.

## What

1. **Precondition**: P1.M3.T1.S1 (astral boundary) and P1.M3.T2.S1 (bigram
   cap drain loop) are landed (task status Complete / commits present in
   `git log`). Do not run the gauntlet mid-flight.
2. **Run the gauntlet**:
   - `npm run check` — exit 0, zero type errors.
   - `npm test` — record file/test counts (baseline 636; expect ≥).
   - `npm run bench` / `npx vitest --run test/perf-gates.test.ts` — all
     3× hard budgets green; note the ingest-gate headroom given the drain
     loop now evicts to cap within one `recordBigramRuns` call.
3. **Fallout protocol** (for each failure):
   a. Map to the owning fix: slash/@/path delegation + Tab-open →
      P1.M1.T1 (classifyStockContext); armed-chain reset → P1.M1.T2;
      relief band → P1.M2.T1 (ceiling 95, tuned by prose A/B);
      mask floor 32 / sub-word poisoning → P1.M2.T2; astral boundary →
      P1.M3.T1; bigram drain → P1.M3.T2.
   b. Read the owning subtask's PRP contract (in this bugfix plan dir);
      decide whether the FAILURE is drift-from-contract (fix the code) or
      a genuine contract-vs-contract collision (e.g. relief band admits a
      word the calibration suite expects rejected).
   c. **Prefer fixing the fix, not weakening the test.** If a spec-derived
      test must change, re-derive the expectation from the PRD section it
      cites and write the rationale in the evidence notes. Judgment calls
      are permitted; silent loosening is not.
   d. Re-run the failed suite plus `npm test` after each fix.
4. **Re-measure §09 integration items** (scripted, real stack — no mocks):
   - **Item 5 (secrets)**: run the paste battery — the realistic-key
     corpus from the PRD repros (AWS 38-char
     `wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY`, npm/glpat/sk_live/Bearer
     synthetics) through `IngestPipeline` + shipped dict; assert NO
     fragment (including `cyexamplekey`, `jalr`, `femik7`) is offered by
     any prefix query. Re-runnable as `npx vitest --run
     test/adversarial-ingest.test.ts test/mask-secrets.test.ts`.
   - **Item 6 (stock parity)**: sentinel checks that `/re` (slash), `@men`,
     and `"src/roun` (quoted path) contexts delegate to
     `current.getSuggestions` with unchanged args, and Tab in a slash
     context never opens the hapax menu — `npx vitest --run
     test/provider.test.ts test/provider-live.test.ts test/provider-match.test.ts`.
   - **Item 7 (NREL chain)**: end-to-end NREL pin (P1.M2.T1.S3's test) —
     accept `National` → zero additional typed chars → `Renewable` top →
     Tab → `Energy` → Tab → `Laboratory` — `npx vitest --run
     test/chain.test.ts test/chaining-gating.test.ts test/acceptance.test.ts`.
   - Query-latency spot check: the ~0.1 ms / 20k-store class budget via
     `npm run bench` (query gate), record the number.
5. **Record evidence** in docs/M1-DoD.md's EXISTING integration item 5/6/7
   sections: replace/append dated re-verification entries with the exact
   command + summarized result. Careful with numbering: docs/M1-DoD.md also
   has M2-DoD subsections named "Item 5/6" (window breaks, forced
   single-item) — you are updating the **PRD §09 integration items**, not
   those.

### Success Criteria

- [ ] `npm run check` exit 0; `npm test` fully green (counts recorded)
- [ ] perf-gates green within 3× budgets; bench query number recorded
- [ ] docs/M1-DoD.md integration items 5/6/7 refreshed with dated,
      re-runnable evidence
- [ ] Every fallout fix documented with owning-subtask attribution;
      no spec-derived test weakened without written rationale
- [ ] Known gap "successorIndex eviction cleanup" left untouched (OUT OF SCOPE)

## All Needed Context

### Context Completeness Check

The implementing agent gets every command, the fix-ownership map, the
fallout decision policy, the exact three acceptance items with their suites
and repro corpora, the M1-DoD numbering trap, and the out-of-scope marker.

### Documentation & References

```yaml
- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/spec-acceptance-map.md
  why: maps PRD §09 acceptance items to suites/tests; records the 636-test
    green baseline (L20) this run must supersede.
- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/system_context.md
  why: environment, commands (npm test = vitest --run; npm run check =
    tsc --noEmit is the sanctioned pi --check substitute), no-persistence
    and perf-gate context.
- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/provider-tui-integration.md
  why: pi-tui editor semantics behind item 6 sentinels (slash-context Tab,
    force/explicitTab paths, applyAutocompleteSuggestions).
- file: docs/M1-DoD.md
  why: the evidence doc to UPDATE — find the INTEGRATION item 5/6/7
    sections (item 7 chain ≈L209; item 5 raw-text adjacency section ≈L291
    and forced-single-item ≈L318 are M2-DoD subsections — DO NOT confuse).
  gotcha: append dated re-verification entries; preserve prior records.
    The "successorIndex eviction cleanup" recorded gap is out of scope.
- file: test/perf-gates.test.ts + test/bench/core.bench.ts
  why: 3× hard budgets and reported numbers; ingest gate is the one
    exposed to the new bigram drain loop.
- file: test/adversarial-ingest.test.ts, test/mask-secrets.test.ts
  why: item 5 battery (realistic keys incl. the 38-char AWS example).
- file: test/provider.test.ts, test/provider-live.test.ts, test/provider-match.test.ts
  why: item 6 stock-parity sentinels (classifyStockContext delegation).
- file: test/chain.test.ts, test/chaining-gating.test.ts, test/acceptance.test.ts
  why: item 7 NREL chain pin (P1.M2.T1.S3) + acceptance items 1–6 scripted.
- file: test/calibration.test.ts, test/shipped-dict.test.ts, test/score.test.ts
  why: relief-band interaction hotspots (ceiling=95) — first places to look
    if admission expectations conflict.
- file: test/bigrams.test.ts, test/store.test.ts, test/segment.test.ts
  why: P1.M3 fix surfaces (drain loop, astral boundary).
- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M4T1S1/research/notes.md
  why: this item's research — landed commits, hotspots, numbering trap.
- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M3T2S1/PRP.md
  why: parallel-item CONTRACT (bigram drain loop + bigrams.test.ts
    rewrite) — its behavior is INPUT to this sweep; wait for it to land.
```

### Current Codebase tree (relevant)

```bash
hapax/
├── package.json                 # check / test / bench scripts
├── docs/M1-DoD.md               # evidence doc — UPDATE integration items 5/6/7
├── dict/common-en.bin           # shipped dictionary (real-stack gauntlet)
├── src/{core,pi}/               # all six fixes landed/landing
└── test/                        # ~35 suites incl. chaining-gating, bigrams, adversarial-*
```

### Desired Codebase tree with files to be added

```bash
plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M4T1S1/research/
└── regression-evidence.md       # NEW: counts, bench numbers, triage log
(docs/M1-DoD.md — MODIFIED: dated re-verification entries only)
(src/** — only minimal fallout fixes, each attributed)
```

### Known Gotchas of our Codebase & Library Quirks

```bash
# CRITICAL: run only after P1.M3.T1.S1 AND P1.M3.T2.S1 land; mid-flight
#   failures from those suites are "not landed yet", not regressions.
# GOTCHA: docs/M1-DoD.md has TWO item-numbering systems — PRD §09
#   integration items (yours) vs M2-DoD subsection items (not yours).
# GOTCHA: baseline 636 tests is pre-fix history; expect MORE tests now —
#   record the new count, don't chase the old one.
# GOTCHA: relief ceiling=95 was tuned by prose A/B (f438272) — if
#   calibration/shipped-dict expectations now collide with the NREL pin,
#   the fix owns the collision: re-tune or adjust the calibration fixture
#   per its PRD derivation, and document which and why.
# GOTCHA: the bigram drain loop makes one recordBigramRuns call evict to
#   cap — an 11k-bigram message now does ~40 eviction rounds; the ingest
#   perf gate (800 KB < 60 ms, 3× = 180 ms) must still hold — check the
#   bench number, not just the gate pass.
# GOTCHA: dictionary.test.ts has 1 expected gc-dependent skip.
# CRITICAL: no mocks in the acceptance re-measurement — real shipped dict,
#   real IngestPipeline + provider stack (contract: "real-stack gauntlet").
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITION CHECK
  - CONFIRM P1.M3.T1.S1 + P1.M3.T2.S1 landed (task status / git log)
  - RECORD environment: date, git rev-parse HEAD, node --version, vitest, pi

Task 1: RUN npm run check
  - exit 0 expected; on errors triage to owning fix PRP

Task 2: RUN npm test
  - RECORD counts; on failure → fallout protocol (ownership map in What §3)

Task 3: RUN perf verification
  - npx vitest --run test/perf-gates.test.ts   # 3× budgets green
  - npm run bench                              # record query + ingest numbers
  - VERIFY ingest headroom under the drain loop; triage if in the 1×–3× band

Task 4: RE-MEASURE acceptance items 5/6/7 (real stack, no mocks)
  - ITEM 5: npx vitest --run test/adversarial-ingest.test.ts test/mask-secrets.test.ts
    — paste battery: AWS 38-char key + npm/glpat/sk_live/Bearer synthetics;
    NO fragment ever offered (incl. cyexamplekey/jalr/femik7/mden)
  - ITEM 6: npx vitest --run test/provider.test.ts test/provider-live.test.ts test/provider-match.test.ts
    — slash/@/quoted-path delegation sentinels + Tab-never-opens in slash ctx
  - ITEM 7: npx vitest --run test/chain.test.ts test/chaining-gating.test.ts test/acceptance.test.ts
    — NREL zero-typed-char chain pin green
  - QUERY latency: from bench output (~0.1 ms / 20k-store class) — record

Task 5: RECORD evidence
  - docs/M1-DoD.md: append dated re-verification entries (command + result)
    to the INTEGRATION item 5/6/7 sections; preserve prior records
  - research/regression-evidence.md: full counts, bench table, triage log,
    judgment-call rationales (if any)

Task 6: FINAL
  - npm run check && npm test — both green after any fallout fixes
```

### Implementation Patterns & Key Details

```bash
# PATTERN: evidence entry (mirror existing M1-DoD.md style)
#   $ npx vitest --run test/chain.test.ts test/acceptance.test.ts
#   - 2026-XX-XX @ <commit>: NREL chain pin green — National → Renewable
#     → Energy → Laboratory at zero additional typed chars (item 7: PASS).

# PATTERN: triage log entry
#   FAIL test/calibration.test.ts > "relief band admits X"
#   Owner: P1.M2.T1 (ceiling=95). Decision: <fix-the-fix | re-derived test
#   from PRD §04 h2.24 because …>. Commit: <sha>.
```

### Integration Points

```yaml
DATABASE: none
CONFIG: none
ROUTES: none
DEPENDS-ON: ALL of P1.M1.T1..P1.M3.T2 (the six fixes, code-complete)
CONSUMED-BY: P1.M4.T2.S1 (README cites numbers), P1.M4.T2.S2 (bugfix-001
  record appended to M1-DoD.md — a separate doc section; do not write theirs)
DOCS: docs/M1-DoD.md integration items 5/6/7 ONLY (Mode A dated entries)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # exit 0 — also gauntlet item 1
```

### Level 2: Full suite

```bash
npm test        # fully green; counts recorded
```

### Level 3: Acceptance re-measurement

```bash
npx vitest --run test/adversarial-ingest.test.ts test/mask-secrets.test.ts \
  test/provider.test.ts test/provider-live.test.ts test/provider-match.test.ts \
  test/chain.test.ts test/chaining-gating.test.ts test/acceptance.test.ts
# all green — items 5/6/7 evidence
```

### Level 4: Performance

```bash
npx vitest --run test/perf-gates.test.ts   # 3× budgets green
npm run bench                              # numbers recorded, ingest headroom checked
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` exit 0; `npm test` green (post-fix final state)
- [ ] perf-gates green; bench numbers recorded incl. ingest under drain loop
- [ ] No new skips beyond the known gc-dependent one

### Feature Validation

- [ ] Item 5: realistic secret battery — zero fragments offered
- [ ] Item 6: slash/@/path delegation + Tab-never-opens sentinels green
- [ ] Item 7: NREL chain green at zero typed chars
- [ ] docs/M1-DoD.md entries dated, re-runnable, prior records preserved

### Code Quality

- [ ] Fallout fixes minimal, attributed to owning subtask contracts
- [ ] No spec-derived test weakened without documented PRD-derived rationale
- [ ] Out-of-scope gap (successorIndex eviction cleanup) untouched

## Anti-Patterns to Avoid

- ❌ Don't weaken a spec-derived test to get green — fix the fix, or document
  the PRD-derived re-derivation
- ❌ Don't run before P1.M3 items land
- ❌ Don't touch the "successorIndex eviction cleanup" gap
- ❌ Don't conflate M1-DoD's M2-subsection item numbers with §09 integration
  items when updating the doc
- ❌ Don't record PASS without the exact re-runnable command + fresh output
- ❌ Don't mock anything in the acceptance re-measurement (real-stack gauntlet)

## Confidence Score

**9/10** — deterministic verification with a complete ownership map and
commands; the residual 1 point is genuine cross-fix collisions (relief band
vs calibration expectations) that require judgment, for which the policy and
documentation requirement are specified.
