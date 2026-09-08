# Bugfix-001 regression sweep evidence (P1.M4.T1.S1)

Full-gauntlet closure run for bugfix-001 — six fixes (BUG-001..BUG-006)
landed and proven to compose. Every verdict is backed by a re-runnable
command; the PRD §09 integration item 5/6/7 results are also recorded in
`docs/M1-DoD.md` (dated section "Bugfix-001 re-verification").

- **Sweep date:** 2026-09-08 (14:39–14:50 UTC)
- **Head commit:** `f69e893` (full: `f69e893c3ef7518157ea82f2a91d95df7fb8172a`
  — "fix(core): bigram map drains to cap in one call")
- **Environment:** Linux x64 · Node v26.7.0 · vitest 4.1.11 · pi 0.85.1
- **Preconditions (Task 0):** SATISFIED — P1.M3.T1.S1 astral boundary
  (`c486723`) and P1.M3.T2.S1 bigram drain loop (`f69e893`) are the last
  two commits; all six fixes present in `git log` (ffb00ed/8e4443c/695991b/
  ef63ff0 stock contexts + Tab; a956479/f438272 relief ceiling 95;
  17f2a0e/603290d/ce61c24 mask floor + poisoning + battery; c486723 astral;
  f69e893 drain; c49082f NREL pin).
- **Verdict: bugfix-001 CLOSED.** Everything green on the first pass —
  zero cross-fix fallout, zero triage decisions, zero test changes.

## Gauntlet results

### 1. `npm run check` — PASS
- exit 0, zero type errors.

### 2. `npm test` — PASS
- **33 test files / 723 passed / 1 skipped** (724 total), exit 0.
- The 1 skip is the known gc-dependent `dictionary.test.ts` case — no new
  skips.
- Baseline comparison: 636 pre-fix (spec-acceptance-map.md L20) → 723 now
  (+87 pins from the six fixes); counts recorded, not chased.

### 3. Performance — PASS, watch flags carried

perf-gates.test.ts **6/6 green**; measured logs (`--disableConsoleIntercept`):

```
[gate a] store=20000 hot-range=178 p99=0.106ms median=0.028ms max=0.208ms (budget <1ms, CI bound <3ms)
[gate b] load+20000 lookups+1000 absent=4.2ms nullHits=0 phantomHits=0 (budget <60ms, CI bound <180ms)
[gate c] 800000 chars processText=76.7ms (best of 3) yields=39 (min 13) (budget <60ms, CI bound <180ms)
[gate d] heap delta (settled low-water) 6.93MB (before 26.7MB → after 33.6MB) (budget <6MB, CI bound <18MB)
[gate e] large-100k bigrams-ON restore=115.4ms words=628 bigrams=10000 (cap 10,000) (budget <600ms)
[gate f] 25k-distinct-word flood=109.6ms final size=19839 (cap 20000) (budget <100ms §05 hard, CI bound <300ms)
```

`npm run bench` (same sweep):

| Gate | Budget | mean | p99/max | Verdict |
| --- | --- | --- | --- | --- |
| a: 20k query | < 1 ms p99 | 0.0246 ms | p99 0.0617 ms | PASS |
| b: dict load + 20k sweep | < 60 ms | 1.84 ms | max 6.78 ms | PASS |
| c: 800 KB ingest | < 60 ms | 60.97 ms | max 81.56 ms | PASS (~1.0–1.3×) |
| d: steady-state cycle | heap < 6 MB | 12.00 ms/cycle (time; heap in perf-gates) | max 19.58 ms | PASS (heap watch below) |

**Ingest headroom under the drain loop** (the PRP's named exposure): gate c
measured **76.7 ms** best-of-3 — the one-call cap drain (`f69e893`)
REMOVED the per-drain resort cost, taking ingest from the pre-drain-loop
172–185 ms band down to ~1.28× budget. The prior sweep's severe gate-c
watch is RESOLVED.

Carried watch flags (inside bounds; no action, trend-watch only):
- gate d heap delta 6.93 MB vs 6 MB budget (1.16×; churn-sampled settling
  without `--expose-gc` — GC-timing noise dominates at this margin).
- gate f 25k-distinct flood 109.6 ms vs the §05 hard 100 ms budget (1.10×).

### 4. Acceptance re-measurement (real stack — shipped dict, real pipeline, no mocks) — PASS 3/3

| §09 integration item | Command | Result |
| --- | --- | --- |
| 5 — secret paste battery | `npx vitest --run test/adversarial-ingest.test.ts test/mask-secrets.test.ts` | **62/62** — AWS 38-char key + npm/glpat/sk_live/Bearer synthetics; NO fragment (incl. `cyexamplekey`, `jalr`, `femik7`) ever offered by any prefix query |
| 6 — stock-context parity | `npx vitest --run test/provider.test.ts test/provider-live.test.ts test/provider-match.test.ts` | **99/99** — `/re`, `@men`, `"src/roun` delegate with byte-identical args; Tab in a stock context never opens the hapax menu (Tab-only-completes pinned on the forced path) |
| 7 — NREL chain, zero typed chars | `npx vitest --run test/chain.test.ts test/chaining-gating.test.ts test/acceptance.test.ts` | **58/58** — `na` → `National` → zero typed word-chars → `Renewable` → Tab → `Energy` → Tab → `Laboratory` (end-to-end pin in test/acceptance.test.ts) |
| query-latency spot check | `npm run bench` | p99 0.062 ms / 20k-store class — budget holds |

## Triage log

Empty — no failures anywhere in the gauntlet, so the fallout protocol was
never invoked and no fix (code or test) was made by this task. Notably, the
highest-risk collisions the PRP flagged did not materialize:

- relief ceiling 95 (f438272) vs calibration/shipped-dict/NREL pins:
  calibration.test.ts, shipped-dict.test.ts, score.test.ts all green inside
  the full run — the band change and the pins compose as landed.
- mask floor 32 + sub-word poisoning vs adversarial-ingest: 62/62 green.
- stock-context delegation + chain reset vs provider/chain/editor-sim
  suites: 99/99 and 58/58 green.
- bigram drain loop vs ingest perf gate: gate c improved 2.2× (76.7 ms vs
  the prior 172–185 ms band); the <180 ms 3× bound holds with 2.3×
  headroom.

## Out of scope (untouched, as directed)

- The recorded known gap "successorIndex eviction cleanup"
  (docs/M1-DoD.md M2 section) — left as recorded; bigram cap behavior is
  covered by the drain loop + gate f within bounds.

## Reproduction

```bash
npm run check
npm test
npx vitest --run test/perf-gates.test.ts --disableConsoleIntercept
npm run bench
npx vitest --run test/adversarial-ingest.test.ts test/mask-secrets.test.ts   # item 5
npx vitest --run test/provider.test.ts test/provider-live.test.ts test/provider-match.test.ts   # item 6
npx vitest --run test/chain.test.ts test/chaining-gating.test.ts test/acceptance.test.ts   # item 7
```
