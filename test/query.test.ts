/**
 * PRD §04 query-ranking suite (P1.M2.T5.S1): the rankMatches contract —
 * case-insensitive prefix matching with stored display casing (h2.27),
 * the PRD §09 order (salience desc → shorter key → byte-lex) verified
 * with deliberate ties, the default limit 8 plus explicit/defensive
 * limits, the description "session x<count>" item contract, empty
 * results, the M2 suppression seam, recency re-ranking after the ordinal
 * advances, and an informal perf sanity (20k store; formal gate is
 * P1.M4.T1.S2).
 *
 * Stores are built by upserting fabricated Sightings — the store IS the
 * input fixture (same style as store.test.ts); keys are arbitrary
 * lowercase. Expected orders are hand-computed where they document the
 * math and cross-checked against compareCandidates (the single source of
 * truth) as a brute-force oracle.
 */

import { describe, expect, it } from "vitest";
import { CandidateStore } from "../src/core/store.js";
import { compareCandidates, salience } from "../src/core/score.js";
import { DEFAULT_LIMIT, rankMatches } from "../src/core/query.js";
import type { Sighting } from "../src/core/types.js";

/** Fresh group-2 sighting of "hapax" at ordinal 1; override any field. */
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

/** Upsert `key` `times` times at `ordinal` (sessionCount = times). */
const put = (
  s: CandidateStore,
  key: string,
  times = 1,
  ordinal = 1,
  over: Partial<Sighting> = {},
): void => {
  for (let i = 0; i < times; i++) {
    s.upsert(sighting({ key, display: key, ordinal, ...over }));
  }
};

/** Oracle: expected key order per score.ts's compareCandidates — the
 *  same math rankMatches must apply, applied independently here. */
const expectedOrder = (s: CandidateStore, prefix: string): string[] =>
  s
    .entries()
    .filter((c) => c.key.startsWith(prefix))
    .sort((a, b) => compareCandidates(a, b, s.currentOrdinal()))
    .map((c) => c.key);

describe("rankMatches — empty results (PRD §04)", () => {
  it("empty store → []", () => {
    expect(rankMatches(new CandidateStore(), "a")).toEqual([]);
  });

  it("non-matching prefix → []", () => {
    const s = new CandidateStore();
    put(s, "alpha");
    put(s, "beta");
    expect(rankMatches(s, "zzz")).toEqual([]);
  });

  it("a non-matching query leaves the store untouched (provider delegates)", () => {
    const s = new CandidateStore();
    put(s, "alpha");
    rankMatches(s, "nope");
    expect(s.size).toBe(1);
    expect(s.currentOrdinal()).toBe(0); // queries never advance ordinals
  });
});

describe("rankMatches — case-insensitive prefix, display casing (h2.27)", () => {
  it('uppercase prefix "NRE" finds the lowercase-keyed "nrel" entry', () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "nrel", display: "NREL" }));
    const [m] = rankMatches(s, "NRE");
    expect(m!.key).toBe("nrel");
    expect(m!.display).toBe("NREL"); // stored display casing, not the prefix's
  });

  it("mixed-case prefix works identically", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "nrel", display: "NREL" }));
    expect(rankMatches(s, "nRe").map((m) => m.key)).toEqual(["nrel"]);
  });

  it("insertion uses the stored display even when the prefix is lowercase", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "nrel", display: "NREL" }));
    expect(rankMatches(s, "nre")[0]!.display).toBe("NREL");
  });

  it("display tracks the MOST RECENT casing seen (typed nrel → nrel)", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "nrel", display: "NREL", ordinal: 1 }));
    s.upsert(sighting({ key: "nrel", display: "nrel", ordinal: 2 }));
    expect(rankMatches(s, "nrel")[0]!.display).toBe("nrel");
  });
});

describe("rankMatches — result shape (work-item contract)", () => {
  it("description is 'session x' + sessionCount (ASCII x, not ×)", () => {
    const s = new CandidateStore();
    put(s, "hapax", 3);
    expect(rankMatches(s, "hap")[0]!.description).toBe("session x3");
    expect(rankMatches(s, "hap")[0]!.description).not.toContain("×");
  });

  it("salience field equals score.ts salience at the current ordinal, unquantized", () => {
    const s = new CandidateStore();
    put(s, "verdant", 8, 1, { fromUser: true, properName: true, rankGroup: 0 });
    s.upsert(sighting({ key: "verdant", display: "Verdant", ordinal: 4 }));
    const m = rankMatches(s, "verd")[0]!;
    expect(m.salience).toBe(salience(s.get("verdant")!, s.currentOrdinal()));
    expect(Number.isInteger(m.salience)).toBe(false); // exact float, not rounded
  });

  it("every result carries exactly the four RankedMatch fields", () => {
    const s = new CandidateStore();
    put(s, "alpha");
    put(s, "alpine", 2);
    for (const m of rankMatches(s, "al")) {
      expect(Object.keys(m).sort()).toEqual([
        "description",
        "display",
        "key",
        "salience",
      ]);
    }
  });
});

describe("rankMatches — ordering (PRD §04 h2.26 / §09)", () => {
  it("salience desc: higher sessionCount first at equal recency", () => {
    const s = new CandidateStore();
    put(s, "zaghigh", 3);
    put(s, "zagmid", 2);
    put(s, "zaglow", 1);
    expect(rankMatches(s, "zag").map((m) => m.key)).toEqual([
      "zaghigh",
      "zagmid",
      "zaglow",
    ]);
  });

  it("userTyped beats plain at equal counts (sticky 1.5 bonus)", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "zagtyped", display: "zagtyped", fromUser: true }));
    s.upsert(sighting({ key: "zagplain", display: "zagplain" }));
    expect(rankMatches(s, "zag").map((m) => m.key)).toEqual([
      "zagtyped",
      "zagplain",
    ]);
  });

  it("deliberate exact salience tie → shorter key first: 'fix' before 'fixpoint'", () => {
    const s = new CandidateStore();
    put(s, "fixpoint"); // upserted first on purpose — order must not care
    put(s, "fix");
    expect(rankMatches(s, "fi").map((m) => m.key)).toEqual(["fix", "fixpoint"]);
  });

  it("equal-length tie → byte-lex: 'cod' before 'cow'", () => {
    const s = new CandidateStore();
    put(s, "cow");
    put(s, "cod"); // reverse insertion — byte order must still win
    expect(rankMatches(s, "co").map((m) => m.key)).toEqual(["cod", "cow"]);
  });

  it("hand-computed mixed board sorts salience desc, then length, then bytes", () => {
    const s = new CandidateStore();
    put(s, "abstract"); // 5 — loses every length tie
    put(s, "abort"); // 5 — len 5 beats len 8
    put(s, "zzqv", 1, 1, { rankGroup: 0 }); // 2 + 3 + 1 = 6
    s.upsert(sighting({ key: "meridian", display: "meridian", fromUser: true })); // 6.5
    put(s, "verdant", 8); // 2·log2(9) + 3 ≈ 9.34
    put(s, "cod"); // 5, len 3
    put(s, "cow"); // 5, len 3
    expect(rankMatches(s, "").map((m) => m.key)).toEqual([
      "verdant", // 9.34
      "meridian", // 6.5
      "zzqv", // 6
      "cod", // 5: len 3, byte c-o-d
      "cow", // 5: len 3, byte c-o-w
      "abort", // 5: len 5
      "abstract", // 5: len 8
    ]);
  });

  it("matches the compareCandidates oracle across several prefixes", () => {
    const s = new CandidateStore();
    put(s, "abort");
    put(s, "abstract", 2);
    put(s, "acorn", 1, 1, { properName: true });
    put(s, "cod");
    put(s, "cow", 3);
    put(s, "zeta", 1, 1, { rankGroup: 0 });
    for (const p of ["", "a", "ab", "c", "z", "q"]) {
      expect(rankMatches(s, p).map((m) => m.key)).toEqual(expectedOrder(s, p));
    }
  });
});

describe("rankMatches — limits (PRD §04 h2.26: top 8)", () => {
  it("exports DEFAULT_LIMIT = 8", () => {
    expect(DEFAULT_LIMIT).toBe(8);
  });

  it("15 same-prefix matches → exactly 8 results, the top-scoring ones", () => {
    const s = new CandidateStore();
    for (let i = 0; i < 15; i++) put(s, `lm${String(i).padStart(2, "0")}`, 15 - i);
    const out = rankMatches(s, "lm");
    expect(out).toHaveLength(8);
    expect(out.map((m) => m.key)).toEqual([
      "lm00",
      "lm01",
      "lm02",
      "lm03",
      "lm04",
      "lm05",
      "lm06",
      "lm07",
    ]); // counts 15…8, the top half
    expect(out[0]!.description).toBe("session x15");
  });

  it("limit: 3 → exactly the top 3", () => {
    const s = new CandidateStore();
    for (let i = 0; i < 15; i++) put(s, `lm${String(i).padStart(2, "0")}`, 15 - i);
    expect(rankMatches(s, "lm", { limit: 3 }).map((m) => m.key)).toEqual([
      "lm00",
      "lm01",
      "lm02",
    ]);
  });

  it("limit: 0 → [] (defensive), limit: -1 → []", () => {
    const s = new CandidateStore();
    put(s, "alpha");
    expect(rankMatches(s, "al", { limit: 0 })).toEqual([]);
    expect(rankMatches(s, "al", { limit: -1 })).toEqual([]);
  });

  it("limit larger than the match count → all matches", () => {
    const s = new CandidateStore();
    for (const k of ["lm00", "lm01", "lm02", "lm03"]) put(s, k);
    expect(rankMatches(s, "lm", { limit: 100 })).toHaveLength(4);
  });
});

describe("rankMatches — suppress hook (M2 seam, P2.M1.T3.S1)", () => {
  it("omitted by default → nothing suppressed", () => {
    const s = new CandidateStore();
    put(s, "alpha");
    put(s, "alpine");
    expect(rankMatches(s, "al")).toHaveLength(2);
  });

  it("suppress removes a candidate BEFORE ranking (the survivor ranks first)", () => {
    const s = new CandidateStore();
    put(s, "bigshot", 9); // would rank first
    put(s, "underdog", 1);
    const out = rankMatches(s, "", { suppress: (c) => c.key === "bigshot" });
    expect(out.map((m) => m.key)).toEqual(["underdog"]);
  });

  it("the predicate sees every Candidate in the prefix range", () => {
    const s = new CandidateStore();
    put(s, "alpha");
    put(s, "alpine");
    put(s, "beta"); // outside the range
    const seen: string[] = [];
    rankMatches(s, "al", { suppress: (c) => (seen.push(c.key), false) });
    expect(seen.sort()).toEqual(["alpha", "alpine"]); // byte order
  });

  it("suppressing everything → []", () => {
    const s = new CandidateStore();
    put(s, "alpha");
    expect(rankMatches(s, "al", { suppress: () => true })).toEqual([]);
  });

  it("limit still applies after suppression", () => {
    const s = new CandidateStore();
    put(s, "k00", 4);
    put(s, "k01", 3);
    put(s, "k02", 2);
    put(s, "k03", 1);
    const out = rankMatches(s, "k", {
      limit: 1,
      suppress: (c) => c.sessionCount > 2,
    });
    expect(out.map((m) => m.key)).toEqual(["k02"]); // k00/k01 suppressed
  });
});

describe("rankMatches — ordinal interplay (recency re-ranking)", () => {
  it("after nextOrdinal advances + a fresh sighting, recency flips the order", () => {
    const s = new CandidateStore();
    put(s, "oldnews", 3, 1); // 2·log2(4) + 3 ≈ 7 @ ord 1
    put(s, "fresh", 1, 1); // 2 + 3 = 5 @ ord 1
    expect(rankMatches(s, "").map((m) => m.key)).toEqual(["oldnews", "fresh"]);
    for (let i = 0; i < 80; i++) s.nextOrdinal(); // now = 81
    s.upsert(sighting({ key: "fresh", display: "fresh", ordinal: 81 })); // Δ = 0 → 6.17
    // oldnews decays: 2·log2(4) + 3·e^-4 ≈ 4.06 < 6.17.
    expect(rankMatches(s, "").map((m) => m.key)).toEqual(["fresh", "oldnews"]);
  });

  it("salience in results uses the NEW currentOrdinal after the advance", () => {
    const s = new CandidateStore();
    put(s, "oldnews", 3, 1);
    s.nextOrdinal();
    const now = s.nextOrdinal();
    const m = rankMatches(s, "old")[0]!;
    expect(m.salience).toBe(salience(s.get("oldnews")!, now));
  });
});

// ── Performance sanity (informal; the formal gate is P1.M4.T1.S2) ──────────

describe("rankMatches — perf sanity (PRD §02 h3.1: < 1 ms per keystroke)", () => {
  it("20k-entry store: 1000 queries complete in < 1000 ms total", () => {
    const s = new CandidateStore();
    // Distribute keys over 26 first letters so the queried prefix range
    // is realistic (~770 keys — a mid-typing keystroke), not whole-store.
    const key = (i: number): string =>
      "q" + "abcdefghijklmnopqrstuvwxyz".charAt(i % 26) +
      String(i).padStart(5, "0");
    for (let i = 0; i < 20_000; i++) {
      s.upsert(
        sighting({ key: key(i), ordinal: s.nextOrdinal(), rankGroup: 0 }),
      );
    }
    expect(s.size).toBe(20_000);
    const first = rankMatches(s, "qz"); // pays the one-time lazy rebuild
    expect(first.length).toBeGreaterThan(0);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) rankMatches(s, "qz");
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(1000);
    for (const r of rankMatches(s, "qz")) {
      expect(r.key.startsWith("qz")).toBe(true);
    }
  });
});