# Research notes — P1.M1.T1.S2 (plan 004): tier-0 perf gate row

## Sources examined
- test/perf-gates.test.ts (full read). Gate pattern (gate a, :76–121):
  shared `gateAStore = makeStore(STORE_CAP)` at module scope (fill = setup);
  sanity asserts (size === STORE_CAP, range > 500) BEFORE timing; 100-iter
  warmup; 1000 performance.now() samples; `p99 = dts[Math.ceil(0.99·N)-1]`
  after sort; console.log actuals (p99/median/max + budget + CI bound);
  `expect(p99).toBeLessThan(3)` = 3× the <1ms budget per §09 CI rule.
  Gate a3 is the full-store precedent: rankMatches(store, "", {limit:8})
  scans prefixRange("")→[0,n) over 20k — measured p99 7.2ms with FULL sort;
  tripwire bound 25ms over 200 samples. Tier-0 pass is CHEAPER than a3
  (indexOf scan + sort of only the rescued subset) — measured 1.1–2.6 ms
  per spec h2.28 — so 1000 samples / 3ms budget / 9ms CI bound fits wall
  time (~2.6s) comfortably.
- File header comment documents the gate list — must be updated with the
  new row (Mode A).
- test/helpers/bench-fixtures.ts: makeStore(STORE_CAP) seed 42, synthetic
  random-letter keys, ~726–913 keys per first-char bucket; makeAbsentWords.
  No shipped dict loaded anywhere in this suite (contract).
- S1 PRP contract: rankMatches gains the ambient tier-0 fallback
  (3-part precondition: lower!=="", anchored recs empty, len≥3) and
  `RankedMatch.tier?: 0|1|2|3` populated ONLY on the match path, OMITTED on
  zero-fragment listings. THE KEY ENABLER: `result.every(r => r.tier === 0)`
  + non-empty result proves the fallback fired (and only it) — no mocking.
- test/bench/core.bench.ts exists (tinybench, reporting-only, npm run bench).
  Check its cases; add a tier-0 bench case only if comparable captured
  numbers exist there.
- spec §09 h2.58 row verbatim: "Tier-0 anchorless fallback full-store pass
  (fires only on empty anchored result; also # loose-mode scans) — < 3 ms
  p99". CI: 3× ⇒ < 9 ms.
- STORE_CAP imported from src/core/store.js (already imported).

## Key design decisions
- Reuse gateAStore (module-scope 20k store) — tier-0 correctness of the
  measurement doesn't depend on a fresh store; keep fill in setup.
- Deterministic probe at setup: iterate candidate ≥3-char fragments over
  the store's keys (e.g. substrings of synthetic keys at various runStart
  positions, first char ≠ key[0]) until one satisfies BOTH:
  (1) rankMatches(store, frag) result non-empty AND every tier === 0
      (anchored empty + fallback fired), and
  (2) at least one key contains frag via indexOf (honest scan).
  Assert the probe found one (expect(found).toBeDefined()) — gate-a's
  `range > 500` sanity-assert precedent style.
  Probing pattern: for keys in the snapshot, try key.slice(m, m+3) for a
  mid m, with fragment[0] !== key[0] preferred (guarantees anchored miss on
  that key; need anchored miss on the WHOLE bucket though — safest probe:
  fragment f such that f[0] is a first-char whose bucket yields no anchored
  tier-3/tier-2/tier-1 match; verifying via tier===0 result is the ground
  truth; loop candidates until success, cap iterations).
  Note: fragment must be ≥3 chars and score-gated at default 60 → probe
  should prefer runs starting in the front ~62% of the key. If a candidate
  produces [] (gated), try another.
- Warmup 100 + 1000 samples mirrors gate a exactly; explicit long timeout
  not needed (~2.6s worst) but follow gate a2's style if flaky.
- Header comment + describe/it text cite the §09 row verbatim (Mode A).
