/**
 * PRD §06 M2 phrase-layer suite (P2.M1.T1.S1): the PhraseEntry upsert
 * contract (absent → create, present → count++ + lastSeenOrdinal refresh,
 * firstSeenOrdinal frozen, sticky stored-but-never-set-here), within-line
 * bigram/trigram windows (the store joins whatever keys a line carries —
 * newline breaking is the PIPELINE's job and is covered there), the
 * PHRASE_CAP hard cap with exactly-`needed` lowest-score victims,
 * sticky protection (unless the cap can only be met from that pool),
 * deterministic byte-lex tie-breaking, the reader accessors downstream
 * tasks consume (getPhrase / phraseSize / phraseEntries / iteratePhrases),
 * and independence from the word store (map, entries, prefix index).
 *
 * Lines are fabricated inline per the ingest contract — the store takes
 * the pipeline's per-line admitted whole-token keys on faith; key strings
 * are arbitrary lowercase words.
 */

import { describe, expect, it } from "vitest";
import {
  CandidateStore,
  EVICT_BATCH,
  PHRASE_CAP,
  PHRASE_EVICT_BATCH,
  STORE_CAP,
} from "../src/core/store.js";
import type { Sighting } from "../src/core/types.js";

/** Fresh group-2 sighting of "hapax" at ordinal 1; override any field.
 *  (Shared shape with store.test.ts — test files are self-contained.) */
const sighting = (over: Partial<Sighting> = {}): Sighting => ({
  key: "hapax",
  display: "hapax",
  ordinal: 1,
  fromUser: false,
  properName: false,
  rankGroup: 2,
  isSubword: false,
  ...over,
});

/** "w00042"-style fixed-width keys so byte order == insertion order. */
const padded = (i: number): string => String(i).padStart(5, "0");

describe("phrase layer (PRD §06 M2) — baked constants", () => {
  it("exports PHRASE_CAP 10,000 and PHRASE_EVICT_BATCH 256 (§08 h2.47)", () => {
    expect(PHRASE_CAP).toBe(10_000);
    expect(PHRASE_EVICT_BATCH).toBe(256);
    // The word constants are untouched by the phrase layer.
    expect(STORE_CAP).toBe(20_000);
    expect(EVICT_BATCH).toBe(256);
  });
});

describe("phrase layer (PRD §06 M2) — within-line n-gram windows", () => {
  it("captures the bigram within a line; no window crosses the line break", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["alpha", "beta"], ["gamma"]], 1);
    expect(s.getPhrase("alpha beta")).toEqual({
      key: "alpha beta",
      count: 1,
      lastSeenOrdinal: 1,
      firstSeenOrdinal: 1,
      sticky: false,
    });
    expect(s.getPhrase("beta gamma")).toBeUndefined(); // line break broke it
    expect(s.getPhrase("alpha beta gamma")).toBeUndefined(); // no trigram of 2
    expect(s.phraseSize).toBe(1);
  });

  it("never joins two two-word lines into a cross-line window", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["alpha", "beta"], ["gamma", "delta"]], 1);
    expect(s.phraseSize).toBe(2); // "alpha beta" + "gamma delta" only
    expect(s.getPhrase("beta gamma")).toBeUndefined();
    expect(s.getPhrase("alpha beta")).toBeDefined();
    expect(s.getPhrase("gamma delta")).toBeDefined();
  });

  it("captures overlapping bigrams AND trigrams of a 4-word line", () => {
    const s = new CandidateStore();
    s.recordPhraseLines(
      [["national", "renewable", "energy", "laboratory"]],
      1,
    );
    expect(s.phraseSize).toBe(5); // 3 bigrams + 2 trigrams
    expect(s.getPhrase("national renewable")?.count).toBe(1);
    expect(s.getPhrase("renewable energy")?.count).toBe(1);
    expect(s.getPhrase("energy laboratory")?.count).toBe(1);
    expect(s.getPhrase("national renewable energy")?.count).toBe(1);
    expect(s.getPhrase("renewable energy laboratory")?.count).toBe(1);
    // Every exact key string, as single-space joins.
    expect(s.phraseEntries().map((p) => p.key).sort()).toEqual([
      "energy laboratory",
      "national renewable",
      "national renewable energy",
      "renewable energy",
      "renewable energy laboratory",
    ]);
  });

  it("repeated windows within one line increment the same entry", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["alpha", "beta", "alpha", "beta"]], 3);
    expect(s.getPhrase("alpha beta")?.count).toBe(2); // windows at 0 and 2
    expect(s.getPhrase("beta alpha")?.count).toBe(1);
    expect(s.getPhrase("alpha beta alpha")?.count).toBe(1);
    expect(s.getPhrase("beta alpha beta")?.count).toBe(1);
    expect(s.phraseSize).toBe(4);
  });

  it("lines shorter than two keys form no windows; empty input is a no-op", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["alpha"], [], []], 1);
    expect(s.phraseSize).toBe(0);
    s.recordPhraseLines([], 1);
    expect(s.phraseSize).toBe(0);
  });

  it("uses keys as given — joined with single spaces, never re-cased", () => {
    const s = new CandidateStore();
    // The pipeline guarantees lowercase keys; the store joins and uses
    // them verbatim (defensive lowercasing is NOT part of the contract).
    s.recordPhraseLines([["alpha", "beta"]], 1);
    expect(s.getPhrase("alpha beta")).toBeDefined();
    expect(s.getPhrase("Alpha Beta")).toBeUndefined();
  });

  it("recordPhraseLines never advances the ordinal counter", () => {
    const s = new CandidateStore();
    s.nextOrdinal();
    s.recordPhraseLines([["alpha", "beta"]], 7);
    expect(s.currentOrdinal()).toBe(1);
  });
});

describe("phrase layer (PRD §06 M2) — upsert on repeat", () => {
  it("count++ and lastSeenOrdinal refresh; firstSeenOrdinal frozen; size 1", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["alpha", "beta"]], 1);
    s.recordPhraseLines([["alpha", "beta"]], 5);
    expect(s.phraseSize).toBe(1);
    expect(s.getPhrase("alpha beta")).toEqual({
      key: "alpha beta",
      count: 2,
      lastSeenOrdinal: 5,
      firstSeenOrdinal: 1, // frozen at creation
      sticky: false,
    });
  });

  it("firstSeenOrdinal stays frozen across many refreshes", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["x", "y"]], 3);
    s.recordPhraseLines([["x", "y"]], 4);
    s.recordPhraseLines([["x", "y"]], 9);
    const p = s.getPhrase("x y")!;
    expect(p.count).toBe(3);
    expect(p.firstSeenOrdinal).toBe(3);
    expect(p.lastSeenOrdinal).toBe(9);
  });

  it("bigram and trigram windows of the same tokens count independently", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["alpha", "beta", "gamma"]], 1);
    s.recordPhraseLines([["alpha", "beta", "gamma"]], 2);
    expect(s.getPhrase("alpha beta")?.count).toBe(2);
    expect(s.getPhrase("beta gamma")?.count).toBe(2);
    expect(s.getPhrase("alpha beta gamma")?.count).toBe(2);
    expect(s.phraseSize).toBe(3);
  });

  it("sticky is initialized false and never set by recording", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["alpha", "beta"]], 1);
    s.recordPhraseLines([["alpha", "beta"]], 2);
    expect(s.getPhrase("alpha beta")!.sticky).toBe(false);
  });
});

describe("phrase layer (PRD §06 M2) — setPhraseSticky", () => {
  it("flips sticky to true; recording afterwards keeps it sticky", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["alpha", "beta"]], 1);
    s.setPhraseSticky("alpha beta");
    expect(s.getPhrase("alpha beta")!.sticky).toBe(true);
    s.recordPhraseLines([["alpha", "beta"]], 2); // merge — sticky once true
    expect(s.getPhrase("alpha beta")!.sticky).toBe(true);
    expect(s.getPhrase("alpha beta")!.count).toBe(2);
  });

  it("unknown key is a no-op — never creates an entry", () => {
    const s = new CandidateStore();
    expect(() => s.setPhraseSticky("ghost phrase")).not.toThrow();
    expect(s.getPhrase("ghost phrase")).toBeUndefined();
    expect(s.phraseSize).toBe(0);
  });
});

describe("phrase layer (PRD §06 M2) — accessors", () => {
  it("getPhrase miss returns undefined on a fresh store", () => {
    expect(new CandidateStore().getPhrase("nothing here")).toBeUndefined();
  });

  it("phraseEntries returns defensive copies — mutation leaves the map intact", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["alpha", "beta"]], 1);
    const snapshot = s.phraseEntries();
    expect(snapshot).toHaveLength(s.phraseSize);
    snapshot[0]!.count = 999;
    snapshot[0]!.key = "MUTATED";
    expect(s.getPhrase("alpha beta")!.count).toBe(1);
    expect(s.phraseEntries()[0]!.key).toBe("alpha beta");
  });

  it("a phraseEntries snapshot taken before later records is not mutated by them", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["alpha", "beta"]], 1);
    const snapshot = s.phraseEntries();
    s.recordPhraseLines([["alpha", "beta"]], 2);
    s.recordPhraseLines([["gamma", "delta"]], 3);
    expect(snapshot[0]!.count).toBe(1);
    expect(snapshot).toHaveLength(1);
    expect(s.phraseSize).toBe(2);
  });

  it("iteratePhrases is a live view over the map values", () => {
    const s = new CandidateStore();
    s.recordPhraseLines([["alpha", "beta"]], 1);
    const it = s.iteratePhrases();
    expect(it.next().value!.key).toBe("alpha beta");
    s.recordPhraseLines([["gamma", "delta"]], 2); // after iterator creation
    const step = it.next();
    expect(step.done).toBe(false); // live: the new entry is iterated too
    expect(step.value!.key).toBe("gamma delta");
    expect(it.next().done).toBe(true);
    // Mutating a stored entry through the live view is visible to readers.
    for (const p of s.iteratePhrases()) p.count = 42;
    expect(s.getPhrase("alpha beta")!.count).toBe(42);
  });
});

// ── Phrase eviction (PRD §06 M2, mirrors §06 h2.37) ────────────────────────

describe("phrase layer (PRD §06 M2) — cap eviction", () => {
  /** One single-bigram line per call element: line [ki, kj] → key "ki kj". */
  const bigramLine = (i: number): [string, string] => [
    `p${padded(i)}`,
    `q${padded(i)}`,
  ];

  it("10,001 distinct phrases → size capped at PHRASE_CAP, exactly one eviction", () => {
    const s = new CandidateStore();
    const ord = s.nextOrdinal(); // one message → all Δ = 0, all counts 1
    const lines: string[][] = [];
    for (let i = 0; i <= PHRASE_CAP; i++) lines.push(bigramLine(i));
    s.recordPhraseLines(lines, ord);
    expect(s.phraseSize).toBe(PHRASE_CAP);
    // All scores tie at count 1 · e^0 = 1 → byte-lex tie-break evicts the
    // byte-LOWEST key ("p00000 q00000"), not the newest.
    expect(s.getPhrase("p00000 q00000")).toBeUndefined();
    expect(s.getPhrase("p00001 q00001")).toBeDefined();
    expect(s.getPhrase(`p${padded(PHRASE_CAP)} q${padded(PHRASE_CAP)}`)).toBeDefined();
  });

  it("deterministic: exactly size − cap victims, the predicted lowest scores", () => {
    const s = new CandidateStore();
    s.nextOrdinal();
    s.nextOrdinal(); // eviction "now" will be ordinal 2
    // 5 high-value phrases, built FIRST: recorded 9 times → count 9,
    // score 9 · e^0 = 9 — the map's highest scores, must survive.
    const kept: string[][] = [];
    for (let i = 0; i < 5; i++) kept.push([`z${padded(i)}`, `y`]);
    for (let r = 0; r < 9; r++) s.recordPhraseLines(kept, 2);
    // 9,995 base phrases: count 1 seen at ordinal 2 → score 1 · e^0 = 1.
    const base: string[][] = [];
    for (let i = 0; i < 9_995; i++) base.push(bigramLine(i + 1)); // p00001…
    s.recordPhraseLines(base, 2);
    expect(s.phraseSize).toBe(10_000); // no eviction yet
    // 5 doomed: count 1 seen at ordinal 1 → 1 · e^(-1/50) ≈ 0.980 —
    // strictly BELOW every base score (score drives, not byte order).
    const doomed: string[][] = [];
    for (let i = 0; i < 5; i++) doomed.push([`a${padded(i)}`, `x`]);
    s.recordPhraseLines(doomed, 1); // 10,005 → ONE tail pass, needed = 5
    // Exactly the five doomed phrases are evicted — never rounded up to
    // PHRASE_EVICT_BATCH, never a base or kept entry.
    expect(s.phraseSize).toBe(PHRASE_CAP);
    for (let i = 0; i < 5; i++) {
      expect(s.getPhrase(`a${padded(i)} x`)).toBeUndefined();
    }
    for (const line of base) {
      expect(s.getPhrase(line.join(" "))).toBeDefined();
    }
    for (const line of kept) {
      const p = s.getPhrase(line.join(" "))!;
      expect(p.count).toBe(9);
      expect(p.firstSeenOrdinal).toBe(2);
    }
  });

  it("sticky survives eviction that drops higher-score non-sticky phrases", () => {
    const s = new CandidateStore();
    s.nextOrdinal();
    s.nextOrdinal(); // now = 2
    // 9,999 base phrases (score 1) + one sticky phrase seen at ordinal 1
    // (score ≈ 0.98 — strictly the LOWEST in the map once protected).
    const base: string[][] = [];
    for (let i = 0; i < 9_999; i++) base.push(bigramLine(i));
    s.recordPhraseLines(base, 2);
    s.recordPhraseLines([["sticky", "alpha"]], 1);
    s.setPhraseSticky("sticky alpha");
    expect(s.phraseSize).toBe(10_000);
    // #10,001 → needed = 1. The sticky entry is excluded from the pool,
    // so the victim is the byte-first score-1 base phrase instead.
    s.recordPhraseLines([["zzz", "final"]], 2);
    expect(s.phraseSize).toBe(PHRASE_CAP);
    expect(s.getPhrase("sticky alpha")).toBeDefined(); // protection, not score
    expect(s.getPhrase("zzz final")).toBeDefined();
    expect(s.getPhrase("p00000 q00000")).toBeUndefined();
    expect(s.getPhrase("p00001 q00001")).toBeDefined();
  });

  it("protected pool still covering `needed` evicts only unprotected entries", () => {
    const s = new CandidateStore();
    s.nextOrdinal();
    // 10,000 phrases, ALL made sticky, then one non-sticky insert: the
    // only pool member is the new phrase — it is the sole victim.
    const lines: string[][] = [];
    for (let i = 0; i < PHRASE_CAP; i++) lines.push(bigramLine(i));
    s.recordPhraseLines(lines, 1);
    for (let i = 0; i < PHRASE_CAP; i++) {
      s.setPhraseSticky(`p${padded(i)} q${padded(i)}`);
    }
    s.recordPhraseLines([["w9", "overflow"]], 1);
    expect(s.phraseSize).toBe(PHRASE_CAP);
    expect(s.getPhrase("w9 overflow")).toBeUndefined(); // only unprotected
    expect(s.getPhrase("p00000 q00000")).toBeDefined(); // sticky kept
    expect(
      s.phraseEntries().filter((p) => p.sticky).length,
    ).toBe(PHRASE_CAP);
  });

  it("phrase eviction never touches the word store or its prefix index", () => {
    const s = new CandidateStore();
    const ord = s.nextOrdinal();
    for (const k of ["alpha", "beta", "gamma"]) {
      s.upsert(sighting({ key: k, ordinal: ord }));
    }
    s.prefixRange("a"); // rebuild the prefix index
    const wordsBefore = s.entries();
    const sortedBefore = s.sortedKeysSnapshot();
    const lines: string[][] = [];
    for (let i = 0; i <= PHRASE_CAP; i++) lines.push(bigramLine(i));
    s.recordPhraseLines(lines, ord); // runs real evictions at the tail
    expect(s.phraseSize).toBe(PHRASE_CAP);
    expect(s.size).toBe(3);
    expect(s.entries()).toEqual(wordsBefore);
    expect(s.prefixRange("al")).toEqual([0, 1]);
    expect(s.sortedKeysSnapshot()).toEqual(sortedBefore);
  });
});