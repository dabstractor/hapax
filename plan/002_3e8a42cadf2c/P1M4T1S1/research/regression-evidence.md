# D2-delta M1 regression evidence (P1.M4.T1.S1)

Re-verification of the M1 acceptance gauntlet (PRD §09 h2.53) against the
D2-delta codebase (phrase layer deleted, span-threaded tokenize, adjacency
bigram successor index, zero-char chaining, forced single-item Tab branch,
`enableChaining` config). Evidence-only sweep — no code was changed; every
verdict below is backed by a re-runnable command.

Consumed by P1.M4.T1.S2 (M2 DoD audit) and P1.M4.T2.S1 (README sweep).

- **Sweep date:** 2026-09-08 (10:57–11:10 UTC)
- **Head commit:** `1b71807` (full: `1b718074715a5cb245cdd12767069320325c0548`
  — "feat(pi): surface successor index in acwords dump", the P1.M3.T2.S1
  landing; Task-0 precondition confirmed: the sweep ran against the
  complete delta, nothing in flight)
- **Environment:** Linux x64 · Node v26.7.0 · vitest 4.1.11 · **pi 0.85.1**
  (the runtime pi upgraded from 0.84.4 since the pre-delta sweep at
  c138b5b; hapax's jiti load path is unaffected — acceptance suite passes)
- **Verdict: M1 contract HOLDS post-delta.** All gauntlet items PASS;
  three perf gates carry "watch" flags (above 1× budget, inside their
  calibrated bounds — see item 4; no budget was loosened by this task).
- **Triage log: empty** — zero failures across every gate; nothing to
  attribute (see the watch-notes under item 4 for the one deliberate
  upstream calibration this sweep inherited).

## Command substitution note (inherited from docs/M1-DoD.md)

The PRD's "`pi --check` (or lint) clean" names a command that does not
exist (verified and recorded in docs/M1-DoD.md at c138b5b). The sanctioned
equivalents stand, already wired in package.json — nothing reinvented:

| PRD wording | Actual command | What it enforces |
| --- | --- | --- |
| "`pi --check` (or lint) clean" | `npm run check` → `tsc --noEmit` (strict) | zero type errors |
| "All unit tests green" | `npm test` → `vitest --run` | whole suite green |

## Gauntlet item 1 — type check clean: PASS

```
$ npm run check        # tsc --noEmit, strict
```
- 2026-09-08: exit 0, zero errors.

## Gauntlet item 2 — all tests green: PASS

```
$ npm test             # vitest --run, whole suite
```
- 2026-09-08: exit 0 — **33 test files, 636 passed / 1 skipped**.
- The one skip is the pre-existing gc-dependent `dictionary.test.ts` case
  ("10k lookups stay correct after forced gc (allocation smoke)") — the
  same expected skip as pre-delta; no NEW skips.
- Delta count movement vs pre-delta c138b5b (24 files / 413 passed /
  1 skipped) matches the inventory
  (plan/002_3e8a42cadf2c/architecture/tests_docs_inventory.md): phrases
  suite deleted (0 hits), bigrams.test.ts + successors.test.ts added,
  chain/config/debug rewritten, adversarial-ingest / adversarial-typing /
  calibration / mask-secrets / chaining-gating / bad-dict-gate added.
  Counts are recorded, not forced to the old numbers.

## Gauntlet item 3 — M1 acceptance suites, individually: PASS (4/4)

Run individually per contract (each also covered by item 2):

```
$ npx vitest --run test/provider.test.ts
$ npx vitest --run test/perf-gates.test.ts
$ npx vitest --run test/no-persistence.test.ts
$ npx vitest --run test/acceptance.test.ts
```

| Suite | Guards | Result |
| --- | --- | --- |
| test/provider.test.ts | never-hijack (a)–(g) incl. forced single-item Tab branch (PRD §07 h2.42) | **PASS — 14/14** |
| test/perf-gates.test.ts | hard 3× CI-variance bounds on the PRD §09 gates | **PASS — 6/6** |
| test/no-persistence.test.ts | DoD item 5, filesystem snapshot assertions | **PASS — 3/3** |
| test/acceptance.test.ts | PRD §09 integration items 1–6, scripted halves (manual TUI halves: test/fixtures/sessions/RESULTS.md) | **PASS — 25/25** |

The Tab-branch extension is green against the never-hijack contract: forced
queries stay single-item and bypass the display debounce without any
delegation-behavior change.

## Gauntlet item 4 — benchmarks: PASS with 3 "watch" flags

```
$ npm run bench        # vitest bench, test/bench/core.bench.ts
```
- 2026-09-08, machine otherwise idle; single bench run (numbers vary
  run-to-run; the authoritative pass/fail is perf-gates.test.ts, green 6/6).

### Bench report (verbatim shape: hz / min / max / mean / p99 / samples)

| Gate | Budget | Bench mean | Bench p99/max | Verdict |
| --- | --- | --- | --- | --- |
| a: query — 20k store, prefix `co` (~150 range) + rank + top 8 | < 1 ms **p99** | 0.0265 ms (37,721 ops/s) | p99 0.0552 ms | **PASS** (≈18× under budget at p99) |
| b: dict load + full 20k-word lookup sweep | < 60 ms | 1.83 ms | max 4.36 ms | **PASS** (≈33× under) |
| c: ingest 800 KB synthetic session text (13 ≤64 KB slices) | < 60 ms | 172.50 ms | max 187.74 ms | **PASS (WATCH — see below)** |
| d: steady-state cycle — dict load + 20k store fill + query | heap delta < 6 MB | 11.93 ms/cycle (time only; heap asserted in perf-gates) | max 22.50 ms | **PASS (WATCH — see below)** |

### perf-gates.test.ts measured logs (same sweep, `--disableConsoleIntercept`)

```
[gate a] store=20000 hot-range=178 p99=0.106ms median=0.033ms max=0.235ms (budget <1ms, CI bound <3ms)
[gate b] load+20000 lookups+1000 absent=4.4ms nullHits=0 phantomHits=0 (budget <60ms, CI bound <180ms)
[gate c] 800000 chars processText=185.1ms (best of 3) yields=39 (min 13) (budget <60ms, CI bound <210ms)
[gate d] heap delta (settled low-water) 6.86MB (before 26.7MB → after 33.6MB) (budget <6MB, CI bound <18MB; no --expose-gc — churn-sampled settling per §09)
[gate e] large-100k bigrams-ON restore=224.9ms words=628 bigrams=10000 (cap 10,000) (budget <600ms)
[gate f] 25k-distinct-word flood=109.8ms final size=19839 (cap 20000) (budget <100ms §05 hard, CI bound <300ms)
```

### Watch flags (above 1× budget, inside calibrated bounds — recorded, not fixed)

- **gate c — WATCH, severe:** 185.1 ms measured (perf-gates best-of-3) /
  172.5 ms bench mean vs 60 ms budget ≈ **2.9–3.1×**. Inside the suite's
  CI bound (<210 ms) so the gate PASSES, but it sits at/over the 3× line.
  Attribution: this is a DELIBERATE delta calibration, not drift — commit
  `3182fbc` ("rewrite successor suite, recalibrate gate c") re-bounded gate
  c when the span-threaded tokenize + adjacency bigram runs added
  per-token successor-capture work to ingest (exactly the surface PRD
  contract item 3 names). No code change by this task; flagged for the M2
  DoD audit (P1.M4.T1.S2) and any future ingest-optimization subtask.
- **gate d — WATCH, marginal:** settled low-water heap delta 6.86 MB vs
  6 MB budget (1.14×; CI bound 18 MB). Measurement is churn-sampled
  settling without `--expose-gc` (Node 26 default), so the number carries
  GC-timing noise; watch for trend, no action.
- **gate f — WATCH, marginal:** 25k-distinct-word flood 109.8 ms vs the
  §05 hard 100 ms budget (1.10×; CI bound 300 ms). Eviction passes
  (~5,000/256) dominate; watch for trend.

## Gauntlet item 5 — no persistence (static + dynamic): PASS

```
$ grep -rn "writeFile\|appendFile\|createWriteStream" src/
```
- 2026-09-08: **zero matches** (grep exit 1). The only fs usage in src/ is
  read-side (`readFileSync` in src/pi/config.ts for the config layers and
  src/core/dictionary.ts for the packed dictionary load).
- Dynamic half: test/no-persistence.test.ts **3/3 green** (item 3).

## Triage log

No gate failed; the Triage protocol was never invoked. Record-keeping
notes only:

1. gate c sits at the 3× line post-recalibration (`3182fbc`) — inherited
   as-is; this task did NOT touch the bound (Anti-pattern honored: no
   budget was loosened here).
2. pi runtime is 0.85.1 (was 0.84.4 pre-delta) — environment change, not a
   repo change; recorded because downstream evidence consumers cite it.

## Re-run everything

```bash
npm run check
npm test
npx vitest --run test/provider.test.ts test/perf-gates.test.ts \
  test/no-persistence.test.ts test/acceptance.test.ts
npm run bench
grep -rn "writeFile\|appendFile\|createWriteStream" src/   # expect empty
```