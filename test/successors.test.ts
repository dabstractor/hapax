/**
 * Successor index suite (P2.M2.T1.S1, PRD §06 h3.9): the word → top-3
 * most-frequent-successors map CandidateStore maintains INCREMENTALLY at
 * bigram ingest (inside recordBigramRuns — never a scan, never on the
 * keystroke path). Pins count-descending order, byte-lex tie
 * determinism, the 3-entry cap (a 4th distinct successor never
 * surfaces), bigram-only windows, run-break inheritance, eviction
 * cleanup without backfill, restore-replay identity, and the
 * shared-empty reader contract.
 *
 * Runs are fabricated inline per the ingest contract — the store takes
 * the pipeline's per-line admitted whole-token keys on faith; key
 * strings are arbitrary lowercase words.
 */

import { describe, expect, it } from "vitest";
import { CandidateStore } from "../src/core/store.js";

/** "p00042"-style fixed-width keys so byte order == insertion order. */
const padded = (i: number): string => String(i).padStart(5, "0");

describe("successor index (PRD §06 h3.9) — ingest-time build", () => {
  it("orders a word's successors by count desc after mixed-frequency bigrams", () => {
    const s = new CandidateStore();
    for (let r = 0; r < 3; r++) s.recordBigramRuns([["alpha", "beta"]]);
    for (let r = 0; r < 2; r++) s.recordBigramRuns([["alpha", "gamma"]]);
    s.recordBigramRuns([["alpha", "delta"]]);
    expect(s.bigramSize).toBe(3); // one counted bigram per adjacent pair
    expect(s.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 3 },
      { next: "gamma", count: 2 },
      { next: "delta", count: 1 },
    ]);
  });

  it("caps at 3: a 4th distinct successor never appears while the top 3 stand", () => {
    const s = new CandidateStore();
    for (let r = 0; r < 3; r++) s.recordBigramRuns([["alpha", "beta"]]);
    for (let r = 0; r < 2; r++) s.recordBigramRuns([["alpha", "gamma"]]);
    s.recordBigramRuns([["alpha", "delta"]]);
    s.recordBigramRuns([["alpha", "epsilon"]]);
    expect(s.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 3 },
      { next: "gamma", count: 2 },
      { next: "delta", count: 1 },
    ]);
    // The array NEVER holds more than 3 — the newcomer was refused, not
    // hidden (a later delta recurrence would still bump delta's count).
    s.recordBigramRuns([["alpha", "delta"]]);
    expect(s.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 3 },
      { next: "delta", count: 2 },
      { next: "gamma", count: 2 }, // byte-lex asc tie: delta before gamma
    ]);
  });

  it("breaks count ties byte-lex ascending on `next`", () => {
    const s = new CandidateStore();
    // All counts tie at 1; arrival order (zulu first) must not matter.
    s.recordBigramRuns([["w", "zulu"]]);
    s.recordBigramRuns([["w", "novel"]]);
    s.recordBigramRuns([["w", "aurora"]]);
    expect(s.topSuccessors("w")).toEqual([
      { next: "aurora", count: 1 },
      { next: "novel", count: 1 },
      { next: "zulu", count: 1 },
    ]);
    // A 4th byte-lex-smaller newcomer CAN displace the byte-lex-largest
    // incumbent at the same count — sorted-tail drop, fully deterministic.
    s.recordBigramRuns([["w", "ember"]]);
    expect(s.topSuccessors("w")).toEqual([
      { next: "aurora", count: 1 },
      { next: "ember", count: 1 },
      { next: "novel", count: 1 },
    ]);
  });

  it("runs longer than 2 keys form no trigram — counts come from adjacent pairs only", () => {
    const s = new CandidateStore();
    s.recordBigramRuns([["a", "b", "c"]]);
    expect(s.bigramSize).toBe(2); // "a b" + "b c" — NO trigram key exists
    expect(s.topSuccessors("a")).toEqual([{ next: "b", count: 1 }]);
    expect(s.topSuccessors("b")).toEqual([{ next: "c", count: 1 }]);
    expect(s.topSuccessors("c")).toEqual([]); // no trailing successor exists
  });

  it("run breaks are inherited from the ingest contract — no successor crosses runs", () => {
    const s = new CandidateStore();
    s.recordBigramRuns([["alpha", "beta"], ["gamma", "delta"]]);
    expect(s.topSuccessors("alpha")).toEqual([{ next: "beta", count: 1 }]);
    expect(s.topSuccessors("beta")).toEqual([]); // beta→gamma never formed
    expect(s.topSuccessors("gamma")).toEqual([{ next: "delta", count: 1 }]);
  });
});

// ── Eviction cleanup (PRD §06 h3.9 + §06 M2 eviction interplay) ────────────

describe("successor index (PRD §06 h3.9) — eviction cleanup", () => {
  it("evicted bigrams are spliced out of the index — no backfill, no recomputation", () => {
    const s = new CandidateStore();
    // High-value incumbents first: ×9 → log(9)-boosted eviction key, must
    // survive any eviction pass.
    for (let r = 0; r < 9; r++) s.recordBigramRuns([["alpha", "beta"]]);
    for (let r = 0; r < 9; r++) s.recordBigramRuns([["alpha", "gamma"]]);
    // Base: 9,996 count-1 throwaway bigrams (distinct first words, so no
    // top-3 capping interferes), all at the same current ordinal.
    const base: string[][] = [];
    for (let i = 1; i <= 9_996; i++) base.push([`p${padded(i)}`, `q${padded(i)}`]);
    s.recordBigramRuns(base);
    // Two doomed bigrams: count 1 and byte-lex BELOW every base key
    // ("alpha …" < "p…", "ghost …" < "p…") — the lowest eviction keys in
    // the map (bigramSortKey ties break by byte-lex key order).
    s.recordBigramRuns([["alpha", "delta"]]); // alpha's 3rd successor
    s.recordBigramRuns([["ghost", "final"]]); // ghost's ONLY successor
    expect(s.bigramSize).toBe(10_000); // exactly full, nothing evicted yet
    // +2 → the exact overflow drains: exactly the two doomed bigrams go
    // (batch bound 256 ≥ overflow 2 — eviction is deterministic).
    s.recordBigramRuns([["zzz", "overflow"]]);
    s.recordBigramRuns([["yyy", "overflow"]]);
    expect(s.bigramSize).toBe(10_000);
    // alpha: delta spliced out, survivors intact — and NOT backfilled to 3.
    expect(s.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 9 },
      { next: "gamma", count: 9 },
    ]);
    // ghost: its array emptied → the whole map entry is gone (an unseen-
    // word miss and a post-eviction miss share the same empty constant).
    expect(s.topSuccessors("ghost")).toEqual([]);
    expect(s.topSuccessors("ghost")).toBe(s.topSuccessors("never-seen"));
    // Survivor bigrams recorded after the base are indexed as usual.
    expect(s.topSuccessors("zzz")).toEqual([{ next: "overflow", count: 1 }]);
    expect(s.topSuccessors("yyy")).toEqual([{ next: "overflow", count: 1 }]);
  });
});

// ── Restore replay (PRD §06 M2: "updated at ingest" ⇒ replay rebuilds) ─────

describe("successor index (PRD §06 h3.9) — restore replay", () => {
  it("two stores fed the identical stream build deep-equal indices", () => {
    const stream = (s: CandidateStore): void => {
      s.recordBigramRuns([["alpha", "beta"]]);
      s.recordBigramRuns([["alpha", "beta"]]);
      s.recordBigramRuns([["alpha", "gamma"]]);
      s.recordBigramRuns([["alpha", "delta"]]);
      s.recordBigramRuns([["nova", "quark", "sol"]]); // adjacent pairs only
      s.recordBigramRuns([["nova", "quark"]]); // quark recurs
      s.recordBigramRuns([["wind"]]); // no windows at all
    };
    const a = new CandidateStore();
    const b = new CandidateStore();
    stream(a);
    stream(b);
    // Every first word of the stream — plus misses — deep-equal.
    for (const w of [
      "alpha",
      "nova",
      "quark",
      "beta",
      "gamma",
      "delta",
      "sol",
      "wind",
      "unseen",
    ]) {
      expect(a.topSuccessors(w)).toEqual(b.topSuccessors(w));
    }
    // And the replayed index equals the live-ingest index value-for-value
    // (same bigram stream ⇒ same counts, order, and truncation).
    expect(a.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 2 },
      { next: "delta", count: 1 }, // count tie → byte-lex asc: delta < gamma
      { next: "gamma", count: 1 },
    ]);
    expect(a.topSuccessors("nova")).toEqual([{ next: "quark", count: 2 }]);
    expect(a.topSuccessors("quark")).toEqual([{ next: "sol", count: 1 }]);
  });
});

// ── Reader contract (zero-allocation miss, live read-only array) ──────────

describe("successor index (PRD §06 h3.9) — topSuccessors reader", () => {
  it("unseen word returns the shared empty constant — same reference every miss", () => {
    const s = new CandidateStore();
    const miss = s.topSuccessors("nowhere");
    expect(miss).toEqual([]);
    expect(s.topSuccessors("elsewhere")).toBe(miss); // shared pre-data…
    s.recordBigramRuns([["alpha", "beta"]]);
    expect(s.topSuccessors("nowhere")).toBe(miss); // …and post-data
    // Hits return the LIVE array (mutations after the read stay visible),
    // never the shared constant and never a copy.
    const live = s.topSuccessors("alpha");
    expect(live).not.toBe(miss);
    s.recordBigramRuns([["alpha", "gamma"]]);
    expect(live).toContainEqual({ next: "gamma", count: 1 });
  });
});