# PRP — P1.M1.T1.S2 (plan 004): Perf-gate row — tier-0 full-store pass < 3 ms p99 (CI at 3×)

---

## Goal

**Feature Goal**: Add the spec §09 h2.58 perf-gate row for the tier-0
anchorless fallback to `test/perf-gates.test.ts`: a CI-scriptable
measurement of `rankMatches`' ambient tier-0 full-store pass over a 20k
synthetic store, asserting the §09 CI rule (p99 < 3× the 3 ms budget =
**< 9 ms**), with measured actuals logged for the tuning protocol and the
DoD table P1.M2.T1.S2 records.

**Deliverable**:
- New `describe("perf gate t0 — tier-0 anchorless fallback full-store pass")`
  block in `test/perf-gates.test.ts` (gate-a structure: sanity asserts,
  100-iteration warmup, 1000 timed samples, p99, console.log actuals,
  `expect(p99).toBeLessThan(9)`)
- Updated file-header gate list in `test/perf-gates.test.ts` citing the
  §09 h2.58 row verbatim (Mode A docs)
- Optional matching case in `test/bench/core.bench.ts` (reporting-only),
  only if that file hosts comparable captured numbers

**Success Definition**: the gate passes on the seeded 20k store with a
PROBED fragment that demonstrably fires the fallback (anchored result
empty, tier-0 result non-empty, asserted in-test); measured p99/median/max
logged; full `npm test` + `npm run check` green.

## Why

P1.M1.T1.S1 lands the tier-0 anchorless fallback (spec §04 h2.28) with its
own performance budget — "< 3 ms p99, CI gate at 3×, mirroring the existing
gate structure — and fires only on the empty-anchored path, so the common
case never pays it" (measured 1.1–2.6 ms at the 20k cap, synthetic). Spec
§09 h2.58 makes it a first-class gate row. Without this gate, a regression
in the fallback (e.g. an accidental full sort of all 20k records, the
gate-a3 ~7 ms class, or worse) would ship silently — exactly what gate e/f
lessons in this file document happening before.

## What

New gate block in `test/perf-gates.test.ts`, placed after gate a3 (the
full-store-pass precedent) and before gate a2, following gate a's
structure exactly:

1. **Probe at setup (load-bearing)**: the synthetic keys are random-letter,
   so the fragment must be DISCOVERED, not hardcoded. Deterministically
   probe the seeded store for a fragment (≥3 chars) such that:
   - `rankMatches(gateAStore, frag, { limit: 8 })` returns a NON-EMPTY
     result whose every item has `tier === 0` (S1's diagnostic — proves the
     anchored scan returned zero AND the fallback fired and survived the
     threshold gate), and
   - at least one key in the store contains `frag` (`indexOf !== -1`) —
     the scan demonstrably has work.
   Assert the probe succeeded (`expect(found).toBeDefined()`) — the same
   sanity-assert style as gate a's `expect(range).toBeGreaterThan(500)`.
2. **Warmup + sampling**: 100 warmup calls, then 1000
   `performance.now()`-bracketed `rankMatches(gateAStore, frag, { limit: 8 })`
   calls; sort; `p99 = dts[Math.ceil(0.99 * dts.length) - 1]`.
3. **Log + assert**: console.log `[gate t0] store=20000 frag=… p99=…ms
   median=…ms max=…ms rescued=N (budget <3ms, CI bound <9ms)` — include the
   rescued-set size (result length) so the measurement's sort cost is
   auditable; `expect(p99).toBeLessThan(9)`.
4. **Header + describe/it text**: cite the spec row verbatim: "Tier-0
   anchorless fallback full-store pass (fires only on empty anchored
   result; also `#` loose-mode scans) — < 3 ms p99" (§09 h2.58).

Reuse the module-scope `gateAStore = makeStore(STORE_CAP)` — fill cost is
setup, not measured (existing convention). No mocking, no shipped
dictionary artifact (suite contract), synthetic fixtures only.

### Success Criteria

- [ ] Probe asserts BOTH sanity conditions in-test (fallback fired via
      `tier === 0` on every result; ≥1 anchorless hit exists)
- [ ] 1000-sample p99 over the 20k store, actuals console.logged
- [ ] `expect(p99).toBeLessThan(9)` passes (3× the <3 ms budget)
- [ ] File-header gate list updated with the tier-0 row (§09 verbatim)
- [ ] Full `npm test` + `npm run check` green; no other behavior changes

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the gate-a pattern is
reproduced below from the live file, the probe strategy and its rationale
are fully specified, S1's `tier` diagnostic contract is given, and the
fixture's statistical shape (bucket sizes, seed) is documented.

### Documentation & References

```yaml
- file: test/perf-gates.test.ts
  why: THE deliverable file. Verified structure (read it first):
    - Module-scope shared fixtures: `const gateAStore = makeStore(STORE_CAP)`
      (fill = setup); `HOT_PREFIX = "p"` (~913 keys at cap 20k, seed 42);
      tmp synthetic dict in beforeAll (this gate does NOT need the dict —
      rankMatches takes only a store).
    - GATE A PATTERN (lines ~76-121), mirror exactly:
        sanity asserts → 100 warmup rankMatches calls → 1000 timed
        performance.now() samples → dts.sort →
        `const p99 = dts[Math.ceil(0.99 * dts.length) - 1]` →
        console.log("[gate a] … p99=… (budget <1ms, CI bound <3ms)") →
        expect(p99).toBeLessThan(3).
    - GATE A3 (~L124-147): the full-store-pass precedent —
      rankMatches(store, "", {limit:8}) scans prefixRange("")→[0,n);
      measured p99 7.2ms WITH a full 20k sort; 200 samples + loose 25ms
      tripwire. The tier-0 pass is CHEAPER (indexOf scan + sort of only
      the rescued subset; spec-measured 1.1–2.6 ms) — so 1000 samples and
      a 9ms CI bound are safely inside wall-time (~2.6s) and honest.
    - Header comment (lines 1-31): the documented gate list — ADD the
      tier-0 row citing §09 h2.58 verbatim.
    - Existing gate ordering: a, a3, a2, b, c, d, e, f — place the new
      block after a3 (thematic: full-store passes) as "gate t0".
  pattern: console.log bracket format "[gate X] … (budget <…, CI bound <…)".
  gotcha: do NOT add a per-test timeout unless flakes appear (gate a2's
    30s timeout was for SETUP-heavy fresh stores; this gate reuses a
    filled store — 1000 samples ≈ ≤3 s).

- file: plan/004_24ebf0115d16/P1M1T1S1/PRP.md
  why: CONTRACT for what S1 lands: rankMatches gains the ambient tier-0
        fallback (3-part precondition: lower !== "" AND anchored recs
        empty AND len >= 3) AND `RankedMatch.tier?: 0|1|2|3`, populated
        ONLY on the match path (anchored 1-3, anchorless 0), OMITTED on
        zero-fragment listings. THE KEY ENABLER for the probe: a non-empty
        result whose every item has tier === 0 PROVES the fallback fired
        with an empty anchored scan — no mocking needed. TIER0_BASE_SCORE
        =85 / TIER0_SKIP_FACTOR=40, default threshold gate 60 → only runs
        starting in the front ~62% of a key pass (probe should prefer
        early-runStart fragments; a gated candidate just yields [] — try
        the next).
  gotcha: if S1 has not landed (no tier field / no fallback), STOP.

- file: test/helpers/bench-fixtures.ts
  why: makeStore(STORE_CAP) — seed 42, synthetic random-letter keys,
        ~726-913 keys per first-char bucket at 20k. Import already present
        in perf-gates.test.ts. Keys are generated with a small alphabet —
        3-char fragments are common INSIDE keys, so the probe converges
        fast (cap the search loop at a few hundred candidates and assert
        success; with a fixed seed the probe is fully deterministic).

- file: test/bench/core.bench.ts
  why: tinybench reporting-only file behind `npm run bench`. Read it; add
        a `bench("tier-0 anchorless full-store pass", …)` case with the
        SAME probed fragment ONLY if the file already hosts comparable
        captured perf numbers (keep its existing style). Pins live
        exclusively in perf-gates assertions — never assert here.

- docfile: plan/004_24ebf0115d16/architecture/tier0_design.md
  section: §6 (perf gate row) + external_deps.md
  why: The binding design for this gate: budget <3 ms p99 at the 20k cap,
        CI at 3×, gate-a structure, the fixture caveat (probe for a
        fragment whose anchored result is empty but anchorless hits ≥1
        key, asserting both so the measurement is honest and includes the
        sort of the rescued set).

- prd: spec/09 h2.58 (gate table row, quoted in "What") + spec/04 h2.28
  "Performance" paragraph (tier-0 carries its own budget; anchored <1 ms
  untouched; measured 1.1-2.6 ms synthetic).
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/core/query.ts          # S1-landed tier-0 fallback + tier diagnostic (untouched here)
└── test/
    ├── perf-gates.test.ts     # MODIFY — new gate block + header row
    ├── bench/core.bench.ts    # OPTIONAL — reporting-only tier-0 bench case
    └── helpers/bench-fixtures.ts  # untouched (makeStore reused as-is)
```

### Desired Codebase tree with files to be changed

```bash
test/perf-gates.test.ts        # +1 describe block (~60 lines) + header row
test/bench/core.bench.ts       # optional +1 bench case (reporting-only)
```

### Known Gotchas of our Codebase & Library Quirks

```python
# CRITICAL: the probe is the honesty of the gate. A hardcoded fragment
#   could silently stop firing the fallback after fixture changes (gate
#   then measures the ANCHORED path at ~1ms and passes vacuously). Probe
#   AT SETUP against the actual store and ASSERT both conditions —
#   tier0-only non-empty result + >=1 anchorless hit — gate-a's
#   `range > 500` sanity-assert style.
# CRITICAL: verify "fallback fired" ONLY via the public RankedMatch.tier
#   === 0 diagnostic (S1's omit-contract makes it unambiguous); do NOT
#   introspect internals or mock anything.
# CRITICAL: the probe must respect the 3-char floor and the 60 default
#   threshold (runs in the back ~38% of a key gate out). Prefer fragments
#   taken from the FIRST HALF of keys, first char != key[0] (helps the
#   anchored scan miss). If a candidate yields [], just try the next —
#   deterministic under the fixed seed.
# GOTCHA: rankMatches takes (store, fragment, opts) — no dictionary
#   involved; do not touch the tmp-dict beforeAll plumbing.
# GOTCHA: reuse gateAStore; do NOT build a fresh 20k store inside the test
#   (fill is seconds of setup — the a2 lesson about timeouts).
# GOTCHA: p99 index formula is ⌈0.99·N⌉-1 (0-indexed) — copy gate a
#   verbatim; off-by-one here is a silent median-instead-of-p99.
# GOTCHA: keep console.log actuals — P1.M2.T1.S2 copies these numbers into
#   the docs/M1-DoD.md "Budget | Measured | vs budget | CI bound (3×) |
#   Verdict" row. Log the rescued-set size too.
# GOTCHA: no shipped dictionary artifact anywhere in this suite (existing
#   contract); synthetic fixtures only.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITION
  - Confirm S1 landed: src/core/query.ts exports TIER0_BASE_SCORE/
    TIER0_SKIP_FACTOR and rankMatches returns tier-0 items (run
    `npx vitest --run test/query.test.ts -t "tier-0"` → green).
    If not, STOP.

Task 1: IMPLEMENT the gate block in test/perf-gates.test.ts
  - Placement: after gate a3's describe, before gate a2; name
    "perf gate t0 — tier-0 anchorless fallback full-store pass".
  - PROBE (inside the it, before timing):
      const keys = gateAStore.sortedKeysSnapshot();
      let frag: string | undefined;
      let rescued = 0;
      for (const k of keys) {
        if (k.length < 8) continue;
        // prefer an early run whose first char differs from the key's
        // (anchored miss on this key; threshold: runStart/len <= 0.6)
        const start = Math.floor(k.length * 0.25);
        const cand = k.slice(start, start + 3);
        if (cand.length < 3 || cand[0] === k[0]) continue;
        const r = rankMatches(gateAStore, cand, { limit: 8 });
        if (r.length === 0) continue;
        if (!r.every((m) => m.tier === 0)) continue;  // anchored polluted
        if (!keys.some((k2) => k2.includes(cand))) continue; // paranoia
        frag = cand; rescued = r.length; break;
      }
      expect(frag).toBeDefined();   // sanity assert — the gate's honesty
  - MEASUREMENT (gate-a structure):
      for (let i = 0; i < 100; i++) rankMatches(gateAStore, frag!, { limit: 8 });
      const dts: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const t = performance.now();
        rankMatches(gateAStore, frag!, { limit: 8 });
        dts.push(performance.now() - t);
      }
      dts.sort((a, b) => a - b);
      const p99 = dts[Math.ceil(0.99 * dts.length) - 1]!;
      const median = dts[Math.floor(dts.length / 2)]!;
  - LOG + ASSERT:
      console.log(`[gate t0] store=${gateAStore.size} frag='${frag}' ` +
        `rescued=${rescued} p99=${p99.toFixed(3)}ms median=${median.toFixed(3)}ms ` +
        `max=${dts[dts.length - 1]!.toFixed(3)}ms ` +
        `(budget <3ms, CI bound <9ms; spec §09 h2.58)`);
      expect(p99).toBeLessThan(9);
  - The probe loop cost is setup, not measured (before the warmup).
  - NOTE: the `keys.some(includes)` paranoia check is O(n) per candidate;
    cap the probe loop (e.g. examine at most ~200 candidate keys) so setup
    stays fast; with seed 42 a hit converges within a handful of keys.

Task 2: HEADER ROW (Mode A docs)
  - Extend the file-header comment's gate list with the §09 h2.58 row
    verbatim: "Tier-0 anchorless fallback full-store pass (fires only on
    empty anchored result; also # loose-mode scans) — < 3 ms p99 → CI < 9 ms".

Task 3: OPTIONAL bench case (test/bench/core.bench.ts)
  - Read the file; only if it hosts comparable captured numbers, add a
    bench() case reusing the same probe + 20k makeStore, in the file's
    existing style. REPORTING-ONLY — no assertions.

Task 4: FULL REGRESSION
  - npx vitest --run test/perf-gates.test.ts    # all gates + new t0 green
  - npm run check
  - npm test
  - CAPTURE the console.log actuals line for P1.M2.T1.S2's DoD table.
```

### Implementation Patterns & Key Details

```typescript
// Gate-a skeleton to mirror (verbatim conventions from the live file):
describe("perf gate t0 — tier-0 anchorless fallback full-store pass (§09 h2.58)", () => {
  it("p99 of 1000 fallback queries over the 20k store stays under 9 ms (3× the 3 ms budget)", () => {
    // …probe… (assert found; store the frag + rescued size)
    // …warmup 100, sample 1000, sort, p99 = dts[Math.ceil(0.99·N)−1]…
    // …console.log actuals…
    expect(p99).toBeLessThan(9);
  });
});
// The measurement times rankMatches end-to-end on the empty-anchored
// path: prefixRange("") + full 20k indexOf scan + threshold gate + sort
// of the rescued set + top-8 slice — the honest full cost of the pass.
```

### Integration Points

```yaml
DOCS (Mode A): the header comment + describe/it text ARE the docs — cite
  spec §09 h2.58 verbatim; no README/config/API change in this task
  (README perf-table sync is P1.M2.T1.S1 if listed there).
DOWNSTREAM: P1.M2.T1.S2 copies the logged actuals into docs/M1-DoD.md's
  "Budget | Measured | vs budget | CI bound (3×) | Verdict" table row.
LOOSE MODE (P1.M1.T2): '#'-mode always-consult scans ride the SAME pass;
  this gate's budget covers them (§09 row wording) — no second gate needed.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit clean
```

### Level 2: The Gate Itself

```bash
npx vitest --run test/perf-gates.test.ts -t "gate t0"   # green + actuals logged
npx vitest --run test/perf-gates.test.ts                # all gates green
```

### Level 3: Full Suite

```bash
npm test
# Perf suites run alongside others — if the t0 gate flakes near the bound,
# first check sibling-process interference (gate c's best-of-3 lesson);
# the 9ms bound has ~3.5× headroom over the 2.6ms spec measurement, so a
# flake means a real regression or a probe that stopped firing — never
# silently loosen the bound (gate a3's documented rule).
```

### Level 4: Domain-Specific (honesty audit)

```bash
# Confirm the probe fires the fallback (not a vacuous pass): temporarily
# log rankMatches(gateAStore, frag).map(m => m.tier) — must be all 0 and
# length >= 1. Also sanity: run twice, confirm identical frag (seed-42
# determinism), so the DoD record is reproducible.
npx vitest --run test/perf-gates.test.ts -t "gate t0" 2>&1 | grep "\[gate t0\]"
```

## Final Validation Checklist

- [ ] New gate block mirrors gate-a structure (warmup 100, 1000 samples, p99 formula)
- [ ] Probe asserts fallback-fired (all-tier-0 non-empty result) + ≥1
      anchorless hit, gate-a sanity-assert style
- [ ] `expect(p99).toBeLessThan(9)`; actuals (p99/median/max/rescued) logged
- [ ] File-header gate list updated with the §09 h2.58 row verbatim
- [ ] Optional bench case reporting-only (assertions absent)
- [ ] No mocking; no shipped dictionary; synthetic fixtures only
- [ ] Reuses gateAStore; probe cost in setup, not measured
- [ ] `npm run check` + full `npm test` green
- [ ] Actuals captured for P1.M2.T1.S2's DoD table row

## Anti-Patterns to Avoid

- ❌ Don't hardcode the probe fragment (fixture drift → vacuous gate)
- ❌ Don't verify fallback firing by mocking or internal introspection —
      public `tier === 0` only
- ❌ Don't assert the raw budget (3 ms) — the CI rule is 3× (9 ms)
- ❌ Don't build a fresh 20k store inside the test (a2 timeout lesson)
- ❌ Don't add assertions to test/bench/core.bench.ts (reporting-only)
- ❌ Don't loosen the bound on flake — investigate (probe firing, sibling
      interference, real regression) first
- ❌ Don't off-by-one the p99 index (copy gate a verbatim)

---

**Confidence Score**: 9/10 — the gate pattern, fixture statistics, S1's
tier diagnostic contract, and the probe strategy are all verified against
live source; the spec's own 1.1–2.6 ms measurement gives ~3.5× headroom
under the 9 ms CI bound.
