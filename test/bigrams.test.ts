import { describe, expect, it } from "vitest";
import { CandidateStore } from "../src/core/store.js";
import type { Dictionary } from "../src/core/types.js";
import { IngestPipeline } from "../src/pi/ingest.js";

/**
 * Bigram map suite (PRD §06 h2.38, delta R1): recordBigramRuns counting
 * and lastSeen refresh, successor-index bump equivalence, the 10,000-key
 * cap with batched lazy-heap eviction, successor splicing on eviction,
 * and the bigramSize accessor. The word layer has its own suite
 * (store.test.ts) — nothing here touches #map.
 */

describe("recordBigramRuns — counting", () => {
  it("counts each adjacent pair; overlapping runs share windows", () => {
    const s = new CandidateStore();
    s.recordBigramRuns([["a", "b"], ["a", "b", "c"]]);
    expect(s.bigramSize).toBe(2); // "a b" + "b c"
    expect(s.topSuccessors("a")).toEqual([{ next: "b", count: 2 }]);
    expect(s.topSuccessors("b")).toEqual([{ next: "c", count: 1 }]);
  });

  it("refreshes count and lastSeenOrdinal on repeats (no ordinal argument)", () => {
    const s = new CandidateStore();
    s.recordBigramRuns([["a", "b"]]);
    s.nextOrdinal();
    s.nextOrdinal();
    s.recordBigramRuns([["a", "b"]]);
    // Count lives in the successor index (the only bigram observability
    // besides bigramSize): 2 sightings → count 2.
    expect(s.topSuccessors("a")).toEqual([{ next: "b", count: 2 }]);
    expect(s.bigramSize).toBe(1);
  });

  it("empty runs, 1-word runs, and an empty run list are no-ops", () => {
    const s = new CandidateStore();
    s.recordBigramRuns([]);
    s.recordBigramRuns([[]]);
    s.recordBigramRuns([["solo"]]);
    s.recordBigramRuns([[], ["solo"], []]);
    expect(s.bigramSize).toBe(0);
    expect(s.topSuccessors("solo")).toEqual([]);
  });

  it("never advances the ordinal counter", () => {
    const s = new CandidateStore();
    s.nextOrdinal();
    s.recordBigramRuns([["a", "b"], ["b", "c"]]);
    expect(s.currentOrdinal()).toBe(1);
  });
});

describe("recordBigramRuns — successor index", () => {
  it("bumps successors on merge AND create (the #upsertPhrase equivalence)", () => {
    const s = new CandidateStore();
    s.recordBigramRuns([["alpha", "beta"]]); // create
    s.recordBigramRuns([["alpha", "beta"]]); // merge — same bump
    s.recordBigramRuns([["alpha", "gamma"]]);
    expect(s.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 2 },
      { next: "gamma", count: 1 },
    ]);
  });

  it("respects the top-3 successor cap (4th distinct successor never surfaces)", () => {
    const s = new CandidateStore();
    for (let r = 0; r < 3; r++) s.recordBigramRuns([["w", "a"]]);
    for (let r = 0; r < 2; r++) s.recordBigramRuns([["w", "b"]]);
    s.recordBigramRuns([["w", "c"]]);
    s.recordBigramRuns([["w", "d"]]); // count 1 — loses to c's count 1? byte-lex: c < d
    expect(s.topSuccessors("w")).toEqual([
      { next: "a", count: 3 },
      { next: "b", count: 2 },
      { next: "c", count: 1 },
    ]);
  });
});

describe("bigram cap — 10,000 with batched lazy-heap eviction", () => {
  // 10,001 distinct bigrams, all count 1 at the same ordinal → the victim
  // order is pure byte-lex on the key: "w0 end" is the lexically lowest.
  function flood(s: CandidateStore, n: number): void {
    const runs: string[][] = [];
    for (let i = 0; i < n; i++) runs.push([`w${i}`, "end"]);
    s.recordBigramRuns(runs);
  }

  it("inserting the 10,001st distinct bigram evicts exactly to cap", () => {
    const s = new CandidateStore();
    flood(s, 10_001);
    expect(s.bigramSize).toBe(10_000); // exact overflow dropped (same-call drain)
  });

  it("an evicted bigram's successor is spliced from the index", () => {
    const s = new CandidateStore();
    flood(s, 10_001);
    // "w0 end" was the lexically lowest key → evicted → w0's successor
    // entry dies with it (last successor spliced → key removed).
    expect(s.topSuccessors("w0")).toEqual([]);
    // A survivor keeps its successor with its count intact.
    expect(s.topSuccessors("w1")).toEqual([{ next: "end", count: 1 }]);
    expect(s.topSuccessors("w10000")).toEqual([{ next: "end", count: 1 }]);
  });

  it("a large overflow drains fully in one call; a later no-op call changes nothing", () => {
    const s = new CandidateStore();
    flood(s, 10_300);
    expect(s.bigramSize).toBe(10_000); // same-call guarantee (BUG-006)
    flood(s, 0); // empty call: still within cap → no-op
    expect(s.bigramSize).toBe(10_000);
  });

  it("drains to cap within the SAME recordBigramRuns call (BUG-006)", () => {
    const s = new CandidateStore();
    flood(s, 11_000); // one call, 1,000 over cap — needs ~4 batches
    expect(s.bigramSize).toBeLessThanOrEqual(10_000);
    expect(s.bigramSize).toBe(10_000); // exact: evicts exactly the overflow
  });

  it("multi-round eviction still picks the byte-lex-lowest keys first", () => {
    const s = new CandidateStore();
    flood(s, 11_000); // all count 1, one ordinal → victim order = byte-lex key
    // The evicted set must be EXACTLY the 1,000 byte-lex-lowest keys —
    // computed here rather than hand-enumerated ("w0 end" < "w1 end" <
    // "w10 end" < "w100 end" … is NOT numeric order) — proving all ~4
    // rounds continue the same ordering. topSuccessors is the per-key
    // observability: [] ⇔ evicted (each word's only successor dies with
    // its bigram).
    const keys = Array.from({ length: 11_000 }, (_, i) => `w${i} end`);
    const evicted = new Set(keys.slice().sort().slice(0, 1_000));
    let mismatches = 0;
    let firstBad = "";
    for (let i = 0; i < 11_000; i++) {
      const got = s.topSuccessors(`w${i}`);
      const wasEvicted = evicted.has(`w${i} end`);
      const ok = wasEvicted
        ? got.length === 0
        : got.length === 1 && got[0]!.next === "end" && got[0]!.count === 1;
      if (!ok) {
        if (!firstBad) {
          firstBad = `w${i} (evicted=${wasEvicted}, got=${JSON.stringify(got)})`;
        }
        mismatches++;
      }
    }
    expect(firstBad).toBe("");
    expect(mismatches).toBe(0);
  });
});

// ── BUG-006 — same-call cap drain through the REAL ingest path ─────────────

describe("BUG-006 — same-call cap drain through the real ingest path", () => {
  it("one processText of 11k distinct-pair lines drains to cap immediately", async () => {
    const store = new CandidateStore();
    // PRD repro wiring (src/pi/index.ts ≈L184): all-rare stub dict → every
    // word admits → onAdmittedTokens feeds recordBigramRuns once per
    // message, so ONE processText is ONE recordBigramRuns call.
    const dictionary: Dictionary = {
      lookup: () => null,
      version: 1,
      entryCount: 0,
    };
    const pipeline = new IngestPipeline({
      store,
      dictionary,
      yieldFn: async () => {},
      onAdmittedTokens: (runs) => store.recordBigramRuns(runs),
    });
    // 11,000 single-pair lines — each line is one run, every pair distinct.
    // 'v0ax'/'v0bx' pass the shape gate (4 chars, 4 distinct chars →
    // entropy 2.0 ≥ 1.5; no runs), unlike 3-char 'v0a' (tooShort).
    const text = Array.from(
      { length: 11_000 },
      (_, i) => `v${i}ax v${i}bx`,
    ).join("\n");

    await pipeline.processText(text, false);

    // THE BUG-006 GATE: no further messages — the tail pass must have
    // drained fully within the call (was 10,744 before the fix).
    expect(store.bigramSize).toBe(10_000);
  });
});