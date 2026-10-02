/**
 * PRD §09 performance-gate micro-benchmarks (P1.M4.T1.S2) — REPORTING ONLY.
 *
 * `npm run bench` (vitest bench / tinybench) prints measured numbers for the
 * four §09 gates plus the tier-0 fallback row (§09 h2.58). Bench output alone
 * CANNOT fail CI on a threshold — the hard 3×-budget assertions live in
 * `test/perf-gates.test.ts`, which performs the SAME measurements as plain
 * tests. Run both:
 *
 *   npm run bench   → measured actuals for all four gates (this file)
 *   npm test        → hard bounds (> 3× budget fails) + logged actuals
 *
 * Synthetic fixtures ONLY (test/helpers/bench-fixtures.ts) — never the
 * shipped dictionary artifact; the binary is generated in memory, written
 * to a mkdtemp temp dir, and removed in afterAll.
 */

import { afterAll, bench, describe } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDictionary } from "../../src/core/dictionary.js";
import { rankMatches } from "../../src/core/query.js";
import { STORE_CAP } from "../../src/core/store.js";
import { IngestPipeline } from "../../src/pi/ingest.js";
import {
  makeSessionText,
  makeStore,
  makeSyntheticDict,
} from "../helpers/bench-fixtures.js";

// T2.S2: queries enter at the FIRST-CHAR bucket (the anchored-fuzzy
// anchor). 'p' is the fixture's hottest bucket — measured 913 keys at cap
// 20k (seed 42; see bench-fixtures storeWord for the distribution).
const HOT_PREFIX = "p";
let keepAlive = 0; // sink for gate-d cycle results (bench fns return void)

console.log(
  "[PRD §09 budgets] (a) query p99 <1ms  (t0) tier-0 anchorless fallback p99 <3ms  " +
    "(b) dict load + 20k sweep <60ms  " +
    "(c) 800KB ingest <180ms CI bound + yield ≤64KB  (d) steady-state heap delta <6MB " +
    "— CI hard-fails at 3× via test/perf-gates.test.ts",
);

// Shared fixtures (module init — fill/build costs are setup, not measured).
const { buffer, words } = makeSyntheticDict(20_000);
const tmpDir = mkdtempSync(join(tmpdir(), "hapax-bench-"));
const dictPath = join(tmpDir, "synthetic-dict.bin");
writeFileSync(dictPath, buffer);

const gateAStore = makeStore(STORE_CAP, 42);

// Gate t0 probe (spec §09 h2.58) — same deterministic discovery as
// perf-gates.test.ts "gate t0" (seed-42 store → same fragment), so bench
// and gate report on the identical fallback pass. REPORTING ONLY: the
// tier===0 sanity asserts and the hard <9 ms p99 bound live in the gate.
let t0Frag = "";
{
  const keys = gateAStore.sortedKeysSnapshot();
  for (const k of keys) {
    if (k.length < 8) continue;
    const start = Math.floor(k.length * 0.25);
    const cand = k.slice(start, start + 3);
    if (cand.length < 3 || cand[0] === k[0]) continue;
    const r = rankMatches(gateAStore, cand, { limit: 8 });
    if (r.length === 0 || !r.every((m) => m.tier === 0)) continue;
    t0Frag = cand;
    break;
  }
}

const gateCStore = makeStore(0, 43); // fresh store; text vocab stays < STORE_CAP
const gateCText = makeSessionText(800_000, 7, words.slice(0, 4000));
const gateCPipeline = new IngestPipeline({
  store: gateCStore,
  dictionary: loadDictionary(dictPath),
  yieldFn: async () => {}, // cheap injected yield — debounce never involved
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("PRD §09 core gates — measured actuals (hard bounds: test/perf-gates.test.ts)", () => {
  bench(
    "gate a: query — 20k-candidate store, first-char bucket 'p' (~913 range) + rank + top 8 [budget <1ms p99]",
    () => {
      rankMatches(gateAStore, HOT_PREFIX, { limit: 8 });
    },
    { warmupTime: 100, warmupIterations: 100, time: 1000, iterations: 1000 },
  );

  bench(
    "gate t0: tier-0 anchorless fallback — full-store pass, probed fragment [budget <3ms p99]",
    () => {
      rankMatches(gateAStore, t0Frag, { limit: 8 });
    },
    { warmupTime: 100, warmupIterations: 100, time: 1000, iterations: 1000 },
  );

  bench(
    "gate b: dict load + full 20k-word lookup sweep [budget <60ms]",
    () => {
      const d = loadDictionary(dictPath); // load inside the op — part of §09 budget
      for (const w of words) d.lookup(w);
    },
    { warmupTime: 100, warmupIterations: 3, time: 2000, iterations: 20 },
  );

  bench(
    "gate c: ingest 800 KB synthetic session text (13 ≤64KB slices) [budget <180ms]",
    async () => {
      await gateCPipeline.processText(gateCText, true); // direct — no debounce
    },
    { warmupTime: 100, warmupIterations: 3, time: 2000, iterations: 20 },
  );

  bench(
    "gate d: steady-state cycle — dict load + 20k store fill + query [heap budget <6MB]",
    () => {
      const d = loadDictionary(dictPath);
      const s = makeStore(STORE_CAP, 44);
      rankMatches(s, HOT_PREFIX, { limit: 8 });
      // Refs stay live until the next iteration replaces them — the cycle
      // heap is what §09 budgeting describes; the DELTA gate lives in
      // perf-gates.test.ts (tinybench cannot assert memory).
      keepAlive = d.entryCount + s.size; // bench fns must return void
    },
    { warmupTime: 100, warmupIterations: 2, time: 3000, iterations: 10 },
  );
});