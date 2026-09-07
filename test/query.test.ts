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
import {
  compareRankedMatches,
  DEFAULT_LIMIT,
  firstWord,
  phraseSalience,
  phraseSuppresses,
  PHRASE_MULTIPLIER,
  PHRASE_REPETITION_W,
  rankMatches,
} from "../src/core/query.js";
import type { PhraseEntry, RankedMatch, Sighting } from "../src/core/types.js";

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

// ═══ Phrase salience + constituent suppression (P2.M1.T3.S1) ═══════════════
// PRD §06 h3.8: admitted phrase candidates whose FIRST word the fragment
// prefixes compete in the same ranked set; a phrase shadows its first word
// when the phrase's salience is >= the word's (settled tie rule).

const PHRASE = "renewable energy laboratory";

/** PhraseEntry fixture override helper (defaults: repetition-path count 2). */
const entry = (over: Partial<PhraseEntry> = {}): PhraseEntry => ({
  key: PHRASE,
  count: 2,
  lastSeenOrdinal: 2,
  firstSeenOrdinal: 1,
  sticky: false,
  ...over,
});

/** Build a store where PHRASE is an admitted candidate via the repetition
 *  path (recorded twice → count 2), with all three constituents upserted
 *  as words using the given display casings. */
const phraseStore = (displays: [string, string, string] = ["renewable", "energy", "laboratory"]): CandidateStore => {
  const s = new CandidateStore();
  put(s, "renewable", 1, 1, { display: displays[0] });
  put(s, "energy", 1, 1, { display: displays[1] });
  put(s, "laboratory", 1, 1, { display: displays[2] });
  s.recordPhraseLines([["renewable", "energy", "laboratory"]], 1);
  s.recordPhraseLines([["renewable", "energy", "laboratory"]], 2);
  return s;
};

describe("phrase helpers — baked weights and key math (PRD §06 h3.8/§08)", () => {
  it("phrase weights are the baked PRD constants: ×1.2, ×2.0", () => {
    expect(PHRASE_MULTIPLIER).toBe(1.2);
    expect(PHRASE_REPETITION_W).toBe(2.0);
  });

  it("firstWord splits on the first space; space-free keys return whole", () => {
    expect(firstWord(PHRASE)).toBe("renewable");
    expect(firstWord("alpha beta")).toBe("alpha");
    expect(firstWord("solo")).toBe("solo"); // defense only — keys are n-grams
  });

  it("phraseSuppresses is the settled >= (tie goes to the phrase)", () => {
    expect(phraseSuppresses(5.5, 5.0)).toBe(true); // phrase strictly higher
    expect(phraseSuppresses(5.0, 5.0)).toBe(true); // exact tie → suppress
    expect(phraseSuppresses(4.9, 5.0)).toBe(false); // word strictly outranks → keep both
  });

  it("phraseSalience: Σ × 1.2 + 2.0·log2(1+count) on the repetition path", () => {
    const s = new CandidateStore();
    put(s, "renewable", 2, 1, { rankGroup: 0 });
    put(s, "energy", 1, 3, { rankGroup: 1, properName: true });
    const constituents = [s.get("renewable"), s.get("energy"), undefined];
    const expected =
      (salience(s.get("renewable")!, 10) + salience(s.get("energy")!, 10)) *
        1.2 +
      2.0 * Math.log2(1 + 3);
    expect(phraseSalience(constituents, entry({ count: 3 }), 10)).toBeCloseTo(expected, 12);
  });

  it("phraseSalience: count 1 (fast path) → multiplier only, no log bonus", () => {
    const s = new CandidateStore();
    put(s, "renewable", 1, 1, { rankGroup: 0 });
    const expected = salience(s.get("renewable")!, 4) * 1.2;
    expect(
      phraseSalience([s.get("renewable")], entry({ count: 1 }), 4),
    ).toBeCloseTo(expected, 12);
  });

  it("phraseSalience: every constituent missing (evicted) → 0-word sum, never a throw", () => {
    const expected = 2.0 * Math.log2(1 + 2); // only the repetition bonus
    expect(phraseSalience([undefined, undefined, undefined], entry(), 7)).toBeCloseTo(expected, 12);
  });
});

describe("rankMatches — phrase salience + constituent suppression (PRD §06 h3.8)", () => {
  it("phrase competes on FIRST-word prefix, case-insensitively; item contract holds", () => {
    const s = phraseStore(["Renewable", "Energy", "Laboratory"]);
    const hits = rankMatches(s, "Renew"); // uppercase fragment
    const m = hits.find((x) => x.key === PHRASE);
    expect(m).toBeDefined();
    expect(m!.display).toBe("Renewable Energy Laboratory"); // joined casings
    expect(m!.description).toBe("phrase"); // exact literal
    // exact formula: Σ constituent saliences × 1.2 + 2.0·log2(1+2), count 2
    const sum =
      salience(s.get("renewable")!, s.currentOrdinal()) +
      salience(s.get("energy")!, s.currentOrdinal()) +
      salience(s.get("laboratory")!, s.currentOrdinal());
    expect(m!.salience).toBeCloseTo(sum * 1.2 + 2.0 * Math.log2(3), 12);
  });

  it("repetition-path count 3: exact arithmetic ×1.2 + 2.0·log2(4)", () => {
    const s = new CandidateStore();
    put(s, "renewable", 2, 1);
    put(s, "energy", 1, 3, { rankGroup: 0 });
    put(s, "laboratory", 1, 2, { properName: true });
    for (let o = 1; o <= 3; o++) {
      s.recordPhraseLines([["renewable", "energy", "laboratory"]], o);
    }
    expect(s.getPhrase(PHRASE)!.count).toBe(3);
    for (let i = 0; i < 5; i++) s.nextOrdinal(); // "now" = 5
    const now = s.currentOrdinal();
    const m = rankMatches(s, "renew").find((x) => x.key === PHRASE)!;
    const expected =
      (salience(s.get("renewable")!, now) +
        salience(s.get("energy")!, now) +
        salience(s.get("laboratory")!, now)) *
        1.2 +
      2.0 * Math.log2(4);
    expect(m.salience).toBeCloseTo(expected, 12);
  });

  it("fast-path phrase (count 1): multiplier only, no repetition bonus", () => {
    const s = new CandidateStore();
    // all-rare constituents present at first sight → fast-path admission
    put(s, "renewable", 1, 1, { rankGroup: 0 });
    put(s, "energy", 1, 1, { rankGroup: 0 });
    put(s, "laboratory", 1, 1, { rankGroup: 0 });
    s.recordPhraseLines([["renewable", "energy", "laboratory"]], 1);
    expect(s.isPhraseCandidate(PHRASE)).toBe(true);
    expect(s.getPhrase(PHRASE)!.count).toBe(1);
    for (let i = 0; i < 3; i++) s.nextOrdinal();
    const now = s.currentOrdinal();
    const m = rankMatches(s, "renew").find((x) => x.key === PHRASE)!;
    const sum =
      salience(s.get("renewable")!, now) +
      salience(s.get("energy")!, now) +
      salience(s.get("laboratory")!, now);
    expect(m.salience).toBeCloseTo(sum * 1.2, 12); // no +2.0·log2 term
  });

  it("suppression fires: first word dropped when phrase salience >= its salience", () => {
    const s = phraseStore();
    put(s, "renewer", 1, 1); // same-prefix word that is NOT the first word
    const hits = rankMatches(s, "renew");
    const keys = hits.map((x) => x.key);
    // the fired arm really is >=: phrase salience strictly exceeds the word's
    const phraseSal = hits.find((x) => x.key === PHRASE)!.salience;
    const wordSal = salience(s.get("renewable")!, s.currentOrdinal());
    expect(phraseSal).toBeGreaterThan(wordSal);
    expect(keys).not.toContain("renewable"); // suppressed
    expect(keys).toContain(PHRASE); // phrase kept
    expect(keys).toContain("renewer"); // unrelated word NEVER suppressed
  });

  it("a real store can never produce word salience > phrase salience — the first word IS a constituent", () => {
    // S_P = 1.2·(S_W + rest) + bonus >= 1.2·S_W > S_W, so through rankMatches
    // the word always yields; the PRD h3.8 "word strictly outranks → both kept"
    // arm is exercised at the pure-helper level above (phraseSuppresses/compareRankedMatches).
    const s = new CandidateStore();
    put(s, "renewable", 10, 9, { rankGroup: 0, fromUser: true }); // monster word
    put(s, "energy", 1, 1, { rankGroup: 2 }); // weak constituents
    put(s, "laboratory", 1, 1, { rankGroup: 2 });
    s.recordPhraseLines([["renewable", "energy", "laboratory"]], 1);
    s.recordPhraseLines([["renewable", "energy", "laboratory"]], 2);
    const hits = rankMatches(s, "renew");
    const phraseSal = hits.find((x) => x.key === PHRASE)!.salience;
    const wordSal = salience(s.get("renewable")!, s.currentOrdinal());
    expect(phraseSal).toBeGreaterThan(wordSal); // invariant holds even here
    expect(hits.map((x) => x.key)).not.toContain("renewable");
    expect(hits[0]!.key).toBe(PHRASE); // phrase ranks above everything
  });

  it("word strictly outranking a phrase keeps both, word ranked above (helper level)", () => {
    // rankMatches can only reach the keep-both arm through fabricated numbers
    // (see the invariant test above); the pure ladder is pinned here.
    const word: RankedMatch = {
      key: "renewable",
      display: "renewable",
      description: "session x9",
      salience: 10.5,
    };
    const phrase: RankedMatch = {
      key: PHRASE,
      display: PHRASE,
      description: "phrase",
      salience: 9.25,
    };
    expect(phraseSuppresses(phrase.salience, word.salience)).toBe(false);
    expect(compareRankedMatches(word, phrase)).toBeLessThan(0); // word first
    expect(compareRankedMatches(phrase, word)).toBeGreaterThan(0);
  });

  it("a fragment matching only a middle/last word does NOT surface the phrase", () => {
    const s = phraseStore();
    const hits = rankMatches(s, "energy");
    // the trigram's first word is "renewable" — "energy" cannot surface it
    expect(hits.some((x) => x.key === PHRASE)).toBe(false);
    // recordPhraseLines also captured the bigram "energy laboratory" (count 2),
    // whose FIRST word IS "energy" — so the bigram surfaces and, by the same
    // h3.8 rule, suppresses the bare word (S_P = 1.2·Σ >= S_word always).
    expect(hits.map((x) => x.key)).toEqual(["energy laboratory"]);
  });

  it("missing constituent contributes 0 — phrase still surfaces with exact salience", () => {
    const s = new CandidateStore();
    put(s, "renewable", 1, 1, { rankGroup: 0 });
    put(s, "energy", 1, 1, { rankGroup: 0 });
    // "laboratory" never upserted — evicted/absent words must not fail the query
    s.recordPhraseLines([["renewable", "energy", "laboratory"]], 1);
    s.recordPhraseLines([["renewable", "energy", "laboratory"]], 2);
    for (let i = 0; i < 2; i++) s.nextOrdinal();
    const now = s.currentOrdinal();
    const m = rankMatches(s, "renew").find((x) => x.key === PHRASE);
    expect(m).toBeDefined();
    const expected =
      (salience(s.get("renewable")!, now) + salience(s.get("energy")!, now)) *
        1.2 +
      2.0 * Math.log2(3);
    expect(m!.salience).toBeCloseTo(expected, 12);
  });

  it("merged order and top-8 truncation across words and phrases (hand-computed)", () => {
    const s = new CandidateStore();
    // 10 competing "renew*" words, all count 1 rankGroup 2 at ordinal 1 →
    // identical salience → tie ladder (length asc, byte-lex) decides among them.
    for (const w of [
      "renewable",
      "renewables",
      "renewal",
      "renewing",
      "renewed",
      "renewer",
      "renewment",
      "renewableness",
      "renewly",
    ]) {
      put(s, w, 1, 1);
    }
    put(s, "energy", 1, 1);
    put(s, "laboratory", 1, 1);
    s.recordPhraseLines([["renewable", "energy", "laboratory"]], 1);
    s.recordPhraseLines([["renewable", "energy", "laboratory"]], 2);
    const hits = rankMatches(s, "renew"); // default limit 8
    expect(hits).toHaveLength(DEFAULT_LIMIT);
    // Hand-computed ladder: capture made the trigram AND the bigram
    // "renewable energy" (both count 2 → candidates; both suppress the word
    // "renewable"). Trigram salience (1.2·3-word Σ + bonus) > bigram (1.2·
    // 2-word Σ + bonus) > every count-1 word; surviving words tie → shorter
    // key first, byte-lex:
    //   renewal(7) renewed(7) renewer(7) renewly(7) renewing(8)
    //   renewment(9) renewables(10) renewableness(15)  ← truncated at 8
    expect(hits.map((x) => x.key)).toEqual([
      PHRASE,
      "renewable energy",
      "renewal",
      "renewed",
      "renewer",
      "renewly",
      "renewing",
      "renewment",
    ]);
    expect(hits.some((x) => x.key === "renewableness")).toBe(false);
    expect(hits.some((x) => x.key === "renewables")).toBe(false);
  });

  it("no phrase candidates → M1 word-only behavior unchanged", () => {
    const s = new CandidateStore();
    put(s, "alpha", 2, 1);
    expect(s.phraseCandidateKeys()).toHaveLength(0);
    expect(rankMatches(s, "al")).toEqual([
      {
        key: "alpha",
        display: "alpha",
        description: "session x2",
        salience: salience(s.get("alpha")!, s.currentOrdinal()),
      },
    ]);
  });

  it("opts.suppress still filters WORD candidates independently of phrases", () => {
    const s = phraseStore();
    put(s, "renewer", 1, 1);
    const hits = rankMatches(s, "renew", {
      suppress: (c) => c.key === "renewable" || c.key === "renewer",
    });
    const keys = hits.map((x) => x.key);
    expect(keys).not.toContain("renewable"); // caller seam drops the word…
    expect(keys).not.toContain("renewer");
    expect(keys).toContain(PHRASE); // …but can never see or drop phrases
  });
});
    