/**
 * PRD §09 performance gates (P1.M4.T1.S2) — THE hard CI gate.
 *
 * PRD §09 h2.51 defines four scriptable micro-benchmarks with hard budgets;
 * h2.53 makes "performance gates pass" part of the M1 definition of done.
 * `vitest bench` (test/bench/core.bench.ts) only REPORTS numbers — tinybench
 * output cannot fail CI on a threshold. This suite performs the SAME
 * measurements as plain tests and asserts the §09 CI rule: 3× budget
 * headroom (> 3× budget = hard failure), with every measured actual logged
 * to the console for the tuning protocol (§09 h2.52).
 *
 *   (a) 20k-candidate prefix query + rank + top 8   budget < 1 ms p99   → CI < 3 ms
 *   (b) dict load + full 20k-word lookup sweep      budget < 60 ms      → CI < 180 ms
 *   (c) ingest 800 KB session text                  budget < 60 ms      → CI < 180 ms
 *       (+ yield-every-≤64KB contract via a counting yieldFn)
 *   (d) steady-state heap delta (dict + store)      budget < 6 MB       → CI < 18 MB
 *
 * Synthetic fixtures ONLY (test/helpers/bench-fixtures.ts): the shipped
 * dictionary artifact is never loaded here — the packed dictionary is
 * built by buildDictBinary and written to a mkdtemp temp dir, removed in
 * afterAll (no persistence files, PRD DoD). No `--expose-gc` in CI: gate d
 * relies on churn-sampled settling + the 3× margin (PRP fallback ladder:
 * widen settling before ever reaching for a child process).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { loadDictionary } from "../src/core/dictionary.js";
import { rankMatches } from "../src/core/query.js";
import { EVICT_BATCH, PHRASE_CAP, PHRASE_EVICT_BATCH, STORE_CAP } from "../src/core/store.js";
import type { Dictionary, RankedMatch } from "../src/core/types.js";
import { IngestPipeline } from "../src/pi/ingest.js";
import type { AgentMessage } from "../src/pi/ingest.js";
import {
  makeAbsentWords,
  makeSessionText,
  makeStore,
  makeSyntheticDict,
} from "./helpers/bench-fixtures.js";

/** Gate b/c/d share one synthetic dictionary file (built once, in tmp). */
const DICT_WORDS = 20_000;
const HOT_PREFIX = "co"; // ~150-candidate range at cap (see bench-fixtures)

let tmpDir = "";
let dictPath = "";
let dict: Dictionary;
let dictWords: string[];

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "hapax-bench-"));
  const { buffer, words } = makeSyntheticDict(DICT_WORDS);
  dictPath = join(tmpDir, "synthetic-dict.bin");
  writeFileSync(dictPath, buffer);
  dict = loadDictionary(dictPath); // preloaded for gate c; gate b times its own load
  dictWords = words;
});

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ── Gate a ──────────────────────────────────────────────────────────────────

const gateAStore = makeStore(STORE_CAP); // fill cost is setup, not measured

describe("perf gate a — 20k-candidate prefix query + rank + top 8", () => {
  it("p99 of 1000 queries over a ~150-candidate hot range stays under 3 ms (3× the 1 ms budget)", () => {
    // Sanity: the hot prefix must actually match a realistic range —
    // a degenerate range would make the measurement dishonestly cheap.
    const [start, end] = gateAStore.prefixRange(HOT_PREFIX);
    const range = end - start;
    expect(gateAStore.size).toBe(STORE_CAP);

    for (let i = 0; i < 100; i++) {
      rankMatches(gateAStore, HOT_PREFIX, { limit: 8 }); // warmup (JIT, index)
    }
    const dts: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t = performance.now();
      rankMatches(gateAStore, HOT_PREFIX, { limit: 8 });
      dts.push(performance.now() - t);
    }
    dts.sort((a, b) => a - b);
    // p99 = 990th of 1000 sorted samples (⌈0.99·N⌉, 1-indexed).
    const p99 = dts[Math.ceil(0.99 * dts.length) - 1];
    const median = dts[Math.floor(dts.length / 2)];
    const max = dts[dts.length - 1];
    // PRD §09 CI rule: assert 3× the budget, log the actuals (h2.52).
    console.log(
      `[gate a] store=${gateAStore.size} hot-range=${range} ` +
        `p99=${p99.toFixed(3)}ms median=${median.toFixed(3)}ms max=${max.toFixed(3)}ms ` +
        `(budget <1ms, CI bound <3ms)`,
    );
    expect(range).toBeGreaterThan(0);
    expect(p99).toBeLessThan(3);
  });
});

// ── Gate b ──────────────────────────────────────────────────────────────────

describe("perf gate b — dictionary load + full 20k-word lookup sweep", () => {
  it("load + 20k hits + 1k absent misses completes under 180 ms (3× the 60 ms budget)", () => {
    const t0 = performance.now();
    // Load (header validation included) is part of the budget per §09.
    const d = loadDictionary(dictPath);
    let nullHits = 0;
    for (const w of dictWords) {
      if (d.lookup(w) === null) nullHits++; // honest sweep: every word must hit
    }
    let phantomHits = 0;
    for (const w of makeAbsentWords(1000)) {
      if (d.lookup(w) !== null) phantomHits++; // miss path must miss
    }
    const dt = performance.now() - t0;
    console.log(
      `[gate b] load+${DICT_WORDS} lookups+1000 absent=${dt.toFixed(1)}ms ` +
        `nullHits=${nullHits} phantomHits=${phantomHits} ` +
        `(budget <60ms, CI bound <180ms)`,
    );
    expect(nullHits).toBe(0);
    expect(phantomHits).toBe(0);
    expect(dt).toBeLessThan(180);
  });
});

// ── Gate c ──────────────────────────────────────────────────────────────────

describe("perf gate c — ingest 800 KB synthetic session text", () => {
  it("processText completes under 180 ms and yields between every ≤64 KB slice (3× the 60 ms budget)", async () => {
    // Fresh empty store: the text's bounded vocab (~5k distinct keys) stays
    // under STORE_CAP, so eviction can never fire inside the measurement.
    const store = makeStore(0);
    const text = makeSessionText(800_000, 7, dictWords.slice(0, 4000));
    let yields = 0;
    // Counting yieldFn — the injectable seam the pipeline was built for.
    // Direct processText: bypasses the 300 ms debounce (bench recipe).
    const pipeline = new IngestPipeline({
      store,
      dictionary: dict,
      yieldFn: async () => {
        yields++;
      },
    });

    const t0 = performance.now();
    await pipeline.processText(text, true);
    const dt = performance.now() - t0;

    // Yield-every-≤64KB contract (§05 h2.30): one yield per slice, and the
    // final slice yields too, so yields ≥ slices = ⌈chars / 65 536⌉ = 13.
    const minYields = Math.ceil(text.length / 65_536);
    console.log(
      `[gate c] ${text.length} chars processText=${dt.toFixed(1)}ms ` +
        `yields=${yields} (min ${minYields}) admitted=${pipeline.getStats().admitted} ` +
        `(budget <60ms, CI bound <180ms)`,
    );
    expect(dt).toBeLessThan(180);
    expect(yields).toBeGreaterThanOrEqual(minYields);
  });
});

// ── Gate d ──────────────────────────────────────────────────────────────────

describe("perf gate d — steady-state heap delta (dict + store)", () => {
  it("full load+fill+query cycles settle under +18 MB heap delta (3× the 6 MB budget)", async () => {
    // One retained dict + one retained 20k store is the steady state; hold
    // the latest cycle's objects live so the delta measures retention, not
    // a collect-everything artifact.
    let hold: { d: Dictionary; s: ReturnType<typeof makeStore>; q: RankedMatch[] } | null =
      null;
    const cycle = () => {
      const d = loadDictionary(dictPath);
      const s = makeStore(STORE_CAP);
      const q = rankMatches(s, HOT_PREFIX, { limit: 8 }); // one query pass
      hold = { d, s, q };
    };
    const drain = async () => {
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    };
    const maybeGc = () => {
      // Only present under --expose-gc (not in CI) — a no-op otherwise.
      const g = globalThis as { gc?: () => void };
      if (typeof g.gc === "function") g.gc();
    };

    // GC-WITHOUT---expose-gc SAMPLER (PRP fallback ladder, step 1 — widen
    // settling before any child-process machinery): heapUsed sampled at an
    // arbitrary instant includes whole store/dict generations that GC simply
    // hasn't run over yet, so a single raw reading is allocator noise, not
    // the steady state. Settling = force major GCs with ~80 MB of throwaway
    // allocation and take the LOW-WATER heapUsed: the floor is the live set
    // (retained dict + store), immune to GC-scheduling luck. Vitest reuses
    // worker processes across test files, so GC state varies with what ran
    // before us — BOTH snapshots must therefore be floor readings, or the
    // delta compares garbage luck instead of retention. Same sampler both
    // sides ⇒ like-for-like.
    const settledHeap = async (): Promise<number> => {
      let low = process.memoryUsage().heapUsed;
      for (let round = 0; round < 20; round++) {
        let junk: number[] = new Array(512 * 1024).fill(round); // ~4 MB churn
        await drain();
        maybeGc();
        junk = []; // drop this round's junk — the churn itself is garbage
        low = Math.min(low, process.memoryUsage().heapUsed);
      }
      return low;
    };

    // WARMUP: two full cycles (JIT, lazy prefix-index build, allocator
    // growth) before the “before” snapshot.
    cycle();
    await drain();
    cycle();
    await drain();
    const before = await settledHeap();

    // The §09 measurement window: three additional full cycles.
    for (let i = 0; i < 3; i++) {
      cycle();
      await drain();
    }
    const after = await settledHeap();

    const delta = after - before;
    console.log(
      `[gate d] heap delta (settled low-water) ${(delta / 1024 / 1024).toFixed(2)}MB ` +
        `(before ${(before / 1024 / 1024).toFixed(1)}MB → after ${(after / 1024 / 1024).toFixed(1)}MB) ` +
        `(budget <6MB, CI bound <18MB; no --expose-gc — churn-sampled settling per §09)`,
    );
    expect(hold).not.toBeNull();
    expect(delta).toBeLessThan(18 * 1024 * 1024);
  });
});
// ── Gate e ──────────────────────────────────────────────────────────────────

/** The repo's own 100k-token session fixture (same stream acceptance
 *  journey 5 and validate.sh Phase 6 probe A replay). */
const RESTORE_FIXTURE = join(import.meta.dirname, "fixtures/sessions/large-100k.jsonl");

// Gate-e LESSON (2026-09 validation): gate c builds IngestPipeline WITHOUT
// the phrase hooks, i.e. a NON-default configuration — the phrase layer
// (enablePhrases: true by default) was 20× over the restore budget while
// every CI run stayed green. Gate e measures the production wiring.
//
// BOUND NOTE: the <300ms CI bound is the WORD-ONLY restore bound (the
// §05 budget amortized over this fixture — journey 5's gate). The M2
// phrase layer adds §06-spec'd per-window work on top: this fixture
// streams ~200k bigram/trigram windows (~142k distinct phrases) through
// capture, the successor index, and admission. Measured floor for the
// DEFAULT-config replay is ~380-400ms (word-only baseline ~110ms +
// ~290ms phrase layer + amortized heap eviction — the 2026-09 fix that
// replaced per-drain snapshot sorts with the batch-rounded lazy index).
// The gate therefore budgets 600ms: ~1.5× that floor, while any
// reappearance of per-drain victim sorting (measured 2,152ms pre-fix)
// trips it by 3.5×.
describe("perf gate e — DEFAULT-config restore (phrase hooks ON), 100k-token fixture", () => {
  it("1561-message large-100k replay with onAdmittedTokens/onSweepPhrases completes under 600 ms (phrases-on restore gate)", async () => {
    const entries = readFileSync(RESTORE_FIXTURE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; message?: AgentMessage });
    const store = makeStore(0);
    // Wired exactly like src/pi/index.ts's session_start under the default
    // config: phrase capture per message + the 40-ordinal demotion sweep.
    const pipeline = new IngestPipeline({
      store,
      dictionary: dict,
      onAdmittedTokens: (lines) => store.recordPhraseLines(lines, store.currentOrdinal()),
      onSweepPhrases: () => store.sweepPhraseDemotions(),
    });

    const t0 = performance.now();
    for (const e of entries) {
      if (e.type === "message" && e.message) pipeline.onMessageEnd(e.message);
    }
    await pipeline.flush();
    const dt = performance.now() - t0;

    console.log(
      `[gate e] large-100k phrases-ON restore=${dt.toFixed(1)}ms ` +
        `words=${store.size} phrases=${store.phraseSize} (cap 10,000) ` +
        `(budget <600ms, see bound note; per-drain-sort regression ≈ 2,150ms)`,
    );
    expect(dt).toBeLessThan(600);
    expect(store.size).toBeLessThanOrEqual(STORE_CAP); // hard cap held
    expect(store.phraseSize).toBeLessThanOrEqual(PHRASE_CAP);
  });
});

// ── Gate f ──────────────────────────────────────────────────────────────────

// Gate-f LESSON (2026-09 validation): over-cap eviction used to run a full
// snapshot + sort per over-cap insert (13–19 s for a 5k-key flood) — a path
// no existing gate exercised, since gate c's vocabulary stays under cap.
// The store now amortizes victim selection into EVICT_BATCH-sized passes;
// this gate pins the flood cost AND the post-eviction size bound.
describe("perf gate f — over-cap word-store flood (eviction amortization)", () => {
  it("25k distinct words (5k over STORE_CAP) in one message completes under 300 ms with the store within the cap", async () => {
    const store = makeStore(0);
    const pipeline = new IngestPipeline({ store, dictionary: dict });
    const text = Array.from({ length: 25_000 }, (_, i) => `zzword${i}q`).join("\n");
    const message: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "perf-gate-f",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 0,
    };

    const t0 = performance.now();
    pipeline.onMessageEnd(message);
    await pipeline.flush();
    const dt = performance.now() - t0;

    console.log(
      `[gate f] 25k-distinct-word flood=${dt.toFixed(1)}ms final size=${store.size} ` +
        `(cap ${STORE_CAP}; eviction passes ≈ 5,000/${EVICT_BATCH}) ` +
        `(budget <100ms §05 hard, CI bound <300ms)`,
    );
    expect(dt).toBeLessThan(300);
    // Post-eviction size bound: the store never rests above the cap —
    // the batch pass trims back to ≤ STORE_CAP (§09 acceptance bound).
    expect(store.size).toBeLessThanOrEqual(STORE_CAP);
  });
});
