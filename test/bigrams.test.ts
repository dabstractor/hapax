import { describe, expect, it } from "vitest";
import { CandidateStore } from "../src/core/store.js";

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
    expect(s.bigramSize).toBe(10_000); // exact overflow dropped, batch-bounded
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

  it("a saturated map drains gradually: each call evicts at most one batch", () => {
    const s = new CandidateStore();
    flood(s, 10_300); // 300 over cap → one batch-bounded pass drops 256
    expect(s.bigramSize).toBe(10_044);
    flood(s, 0); // an empty call still runs the tail pass → drain completes
    expect(s.bigramSize).toBe(10_000);
  });
});