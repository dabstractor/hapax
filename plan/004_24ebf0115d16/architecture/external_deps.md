# External dependencies & test infrastructure — plan 004

## Runtime dependencies: NONE ADDED

hapax's only runtime deps are the pi extension API + pi-tui (AGENTS.md).
This delta introduces NO new external technology — tier-0/loose-mode is
pure in-repo TypeScript over the existing CandidateStore. No external
documentation research required; all binding rules are in staged spec/*.md.

## Commands (package.json)

- `npm run check` → `tsc --noEmit`
- `npm test` → `vitest --run`
- `npm run bench` → `vitest bench` (reporting only, tinybench)

## Test infrastructure (verified)

- `test/helpers/bench-fixtures.ts`: `makeStore(cap, seed=42)` — synthetic
  CandidateStore via mulberry32 PRNG (`storeWord`: 0.75% "co"/0.75% "pr"
  prefixes, else 2 random letters + base-36 tag + 3–8 letters; ~726–913
  keys/bucket at 20k; 'p'=913). Also makeSyntheticDict/makeSessionText/
  makeAbsentWords. STORE_CAP (20k) from src/core/store.ts.
- `test/perf-gates.test.ts` gate pattern (:76–121): warmup 100 → 1000
  timed `performance.now()` samples → p99 = `dts[⌈0.99·N⌉−1]` →
  console.log actuals → `expect(p99).toBeLessThan(3×budget)`. Gate a3 =
  full-store pass precedent (loose <25 ms tripwire). New tier-0 gate:
  budget 3 ms → CI assert `< 9`; fragment must probe EMPTY-anchored.
- `test/helpers/editor-sim.ts` (display-provider path), `session-fixture`
  (full session wiring: chain/chaining-gating/acceptance), `query-invariants`.
- Chain test helper: `armViaTab(inner, chain, store, word, frag)`
  (chain.test.ts:202–218) — drives provider applyCompletion, asserts
  `chain.state()`; reuse for anchored-only arming pins.

## Prior research still applicable

plan/003_bbac3b15e8d0/architecture/r3-query-fuzzy.md — §3 (prefixRange →
sortedKeysSnapshot ordering invariant; store.get evicted-ghost guard) and
§6 (bench/gate split: gates assert, bench reports) remain accurate for the
full-store tier-0 pass. NOTE: r3's "HOT_PREFIX='co' ~150 candidates" is
stale — current perf-gates uses `HOT_PREFIX='p'` (~913 keys); the gate
fixture is honest as-is.

## Verification-only deltas (already landed — confirm, never edit spec)

- Module rows spec/02:64–68 ↔ src/pi/{editor,debug,paths}.ts ✅
- Dict figures spec/03:37–54 ↔ dict/common-en.bin 850,554 B;
  shipped-dict.test.ts 48,802; LF 0.7445 ✅
- M2 DoD re-theme ↔ acceptance.test.ts:838 (Zorp→Noria→Inverter) ✅
- Decision log = spec/SPEC.md:67 section (no separate artifact) ✅
