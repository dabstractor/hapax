/**
 * PRD §09 performance-gate micro-benchmarks (P1.M4.T1.S2) — REPORTING ONLY.
 *
 * `npm run bench` (vitest bench / tinybench) prints measured numbers for the
 * four §09 gates. Bench output alone CANNOT fail CI on a threshold — the
 * hard 3×-budget assertions live in `test/perf-gates.test.ts`, which
 * performs the same measurements as plain tests. Run both:
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

const HOT_PREFIX = "co"; // ~150-candidate hot range at cap 20k
let keepAlive = 0; // sink for gate-d cycle results (bench fns return void)

console.log(
  "[PRD §09 budgets] (a) query p99 <1ms  (b) dict load + 20k sweep <60ms  " +
    "(c) 800KB ingest <60ms + yield ≤64KB  (d) steady-state heap delta <6MB " +
    "— CI hard-fails at 3× via test/perf-gates.test.ts",
);

// Shared fixtures (module init — fill/build costs are setup, not measured).
const { buffer, words } = makeSyntheticDict(20_000);
const tmpDir = mkdtempSync(join(tmpdir(), "hapax-bench-"));
const dictPath = join(tmpDir, "synthetic-dict.bin");
writeFileSync(dictPath, buffer);

const gateAStore = makeStore(STORE_CAP, 42);

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
    "gate a: query — 20k-candidate store, prefix 'co' (~150 range) + rank + top 8 [budget <1ms p99]",
    () => {
      rankMatches(gateAStore, HOT_PREFIX, { limit: 8 });
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
    "gate c: ingest 800 KB synthetic session text (13 ≤64KB slices) [budget <60ms]",
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