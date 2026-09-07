/**
 * Successor index suite (P2.M2.T1.S1, PRD §06 h3.9): the word → top-3
 * most-frequent-successors map CandidateStore maintains INCREMENTALLY at
 * phrase ingest (inside the upsert path — bigram keys only, never a scan
 * over #phrases, never on the keystroke path). Pins count-descending
 * order, byte-lex tie determinism, the 3-entry cap (a 4th distinct
 * successor never surfaces), trigram exclusion, line-break inheritance
 * from the phrase layer, eviction cleanup without backfill, restore-
 * replay identity, and the shared-empty reader contract.
 *
 * Lines are fabricated inline per the ingest contract (same approach as
 * phrases.test.ts) — the store takes the pipeline's per-line admitted
 * whole-token keys on faith; key strings are arbitrary lowercase words.
 */

import { describe, expect, it } from "vitest";
import { CandidateStore, PHRASE_CAP } from "../src/core/store.js";

/** "p00042"-style fixed-width keys so byte order == insertion order. */
const padded = (i: number): string => String(i).padStart(5, "0");

describe("successor index (PRD §06 h3.9) — ingest-time build", () => {
  it("orders a word's successors by count desc after mixed-frequency bigrams", () => {
    const s = new CandidateStore();
    for (let r = 0; r < 3; r++) s.recordPhraseLines([["alpha", "beta"]], 1);
    for (let r = 0; r < 2; r++) s.recordPhraseLines([["alpha", "gamma"]], 2);
    s.recordPhraseLines([["alpha", "delta"]], 3);
    expect(s.getPhrase("alpha beta")!.count).toBe(3); // index mirrors #phrases
    expect(s.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 3 },
      { next: "gamma", count: 2 },
      { next: "delta", count: 1 },
    ]);
  });

  it("caps at 3: a 4th distinct successor never appears while the top 3 stand", () => {
    const s = new CandidateStore();
    for (let r = 0; r < 3; r++) s.recordPhraseLines([["alpha", "beta"]], 1);
    for (let r = 0; r < 2; r++) s.recordPhraseLines([["alpha", "gamma"]], 2);
    s.recordPhraseLines([["alpha", "delta"]], 3);
    s.recordPhraseLines([["alpha", "epsilon"]], 4); // ×1 loses to delta ×1
    expect(s.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 3 },
      { next: "gamma", count: 2 },
      { next: "delta", count: 1 },
    ]);
    // The array NEVER holds more than 3 — the newcomer was refused, not
    // hidden (a later delta recurrence would still bump delta's count).
    s.recordPhraseLines([["alpha", "delta"]], 5);
    expect(s.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 3 },
      { next: "delta", count: 2 },
      { next: "gamma", count: 2 }, // byte-lex asc tie: delta before gamma
    ]);
  });

  it("breaks count ties byte-lex ascending on `next`", () => {
    const s = new CandidateStore();
    // All counts tie at 1; arrival order (zulu first) must not matter.
    s.recordPhraseLines([["w", "zulu"]], 1);
    s.recordPhraseLines([["w", "novel"]], 1);
    s.recordPhraseLines([["w", "aurora"]], 1);
    expect(s.topSuccessors("w")).toEqual([
      { next: "aurora", count: 1 },
      { next: "novel", count: 1 },
      { next: "zulu", count: 1 },
    ]);
    // A 4th byte-lex-smaller newcomer CAN displace the byte-lex-largest
    // incumbent at the same count — sorted-tail drop, fully deterministic.
    s.recordPhraseLines([["w", "ember"]], 1);
    expect(s.topSuccessors("w")).toEqual([
      { next: "aurora", count: 1 },
      { next: "ember", count: 1 },
      { next: "novel", count: 1 },
    ]);
  });

  it("trigram keys never contribute — counts come from bigrams only", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["a", "b", "c"]], 1);
    expect(s.getPhrase("a b c")!.count).toBe(1); // trigram recorded…
    // …but NOT counted again: a trigram bump would make these counts 2.
    expect(s.topSuccessors("a")).toEqual([{ next: "b", count: 1 }]);
    expect(s.topSuccessors("b")).toEqual([{ next: "c", count: 1 }]);
    expect(s.topSuccessors("c")).toEqual([]); // no trailing successor exists
  });

  it("line breaks are inherited from the phrase layer — no successor crosses a newline", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["alpha", "beta"], ["gamma", "delta"]], 1);
    expect(s.topSuccessors("alpha")).toEqual([{ next: "beta", count: 1 }]);
    expect(s.topSuccessors("beta")).toEqual([]); // beta→gamma never formed
    expect(s.topSuccessors("gamma")).toEqual([{ next: "delta", count: 1 }]);
  });
});

// ── Eviction cleanup (PRD §06 h3.9 + §06 M2 eviction interplay) ────────────

describe("successor index (PRD §06 h3.9) — eviction cleanup", () => {
  it("evicted bigrams are spliced out of the index — no backfill, no recomputation", () => {
    const s = new CandidateStore();
    s.nextOrdinal();
    s.nextOrdinal(); // eviction "now" will be ordinal 2
    // High-value incumbents first: ×9 at ordinal 2 → score 9, must survive.
    for (let r = 0; r < 9; r++) s.recordPhraseLines([["alpha", "beta"]], 2);
    for (let r = 0; r < 9; r++) s.recordPhraseLines([["alpha", "gamma"]], 2);
    // Base: 9,996 score-1 throwaway phrases (distinct first words, so no
    // top-3 capping interferes), recorded at ordinal 2.
    const base: string[][] = [];
    for (let i = 1; i <= 9_996; i++) base.push([`p${padded(i)}`, `q${padded(i)}`]);
    s.recordPhraseLines(base, 2);
    // Two doomed phrases: count 1 seen at ordinal 1 → score 1·e^(−1/50)
    // ≈ 0.980 — strictly BELOW every other entry in the map.
    s.recordPhraseLines([["alpha", "delta"]], 1); // alpha's 3rd successor
    s.recordPhraseLines([["ghost", "final"]], 1); // ghost's ONLY successor
    expect(s.phraseSize).toBe(PHRASE_CAP); // exactly full, nothing evicted yet
    // +2 → needed = 2: exactly the two doomed phrases go (phrase eviction
    // is deterministic — phrases.test.ts pins the same victim selection).
    s.recordPhraseLines([["zzz", "overflow"]], 2);
    s.recordPhraseLines([["yyy", "overflow"]], 2);
    expect(s.phraseSize).toBe(PHRASE_CAP);
    expect(s.getPhrase("alpha delta")).toBeUndefined();
    expect(s.getPhrase("ghost final")).toBeUndefined();
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
    expect(s.getPhrase("yyy overflow")).toBeDefined();
  });
});

// ── Restore replay (PRD §06 M2: "updated at ingest" ⇒ replay rebuilds) ─────

describe("successor index (PRD §06 h3.9) — restore replay", () => {
  it("two stores fed the identical stream build deep-equal indices", () => {
    const stream = (s: CandidateStore): void => {
      s.recordPhraseLines([["alpha", "beta"]], 1);
      s.recordPhraseLines([["alpha", "beta"]], 2);
      s.recordPhraseLines([["alpha", "gamma"]], 2);
      s.recordPhraseLines([["alpha", "delta"]], 3);
      s.recordPhraseLines([["nova", "quark", "sol"]], 4); // trigram windows
      s.recordPhraseLines([["nova", "quark"]], 5); // quark recurs
      s.recordPhraseLines([["wind"]], 6); // no windows at all
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
    s.recordPhraseLines([["alpha", "beta"]], 1);
    expect(s.topSuccessors("nowhere")).toBe(miss); // …and post-data
    // Hits return the LIVE array (mutations after the read stay visible),
    // never the shared constant and never a copy.
    const live = s.topSuccessors("alpha");
    expect(live).not.toBe(miss);
    s.recordPhraseLines([["alpha", "gamma"]], 2);
    expect(live).toContainEqual({ next: "gamma", count: 1 });
  });
});