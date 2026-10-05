/**
 * PRD §04 query-ranking suite (P1.M2.T5.S1): the rankMatches contract —
 * case-insensitive prefix matching with stored display casing (h2.27),
 * the 2026-10 menu order (spec §04 h2.29: tier desc → shorter key →
 * sessionCount desc → byte-lex, with exact-equal keys excluded;
 * zero-fragment listings keep sessionCount desc → shorter → byte-lex)
 * verified with
 * deliberate ties at the rankMatches AND comparator levels, the default
 * limit 8 plus explicit/defensive limits, the description "session
 * x<count>" item contract, empty results, count-vs-recency interplay, an
 * informal perf sanity (20k store; formal gate is P1.M4.T1.S2), and the R1
 * ONE-WORD INVARIANT (PRD §07 h2.44): every returned display is a single
 * word, proven end-to-end through the REAL ingest pipeline (rankMatches
 * is words-only; the former caller-side filter seam was removed with the
 * multi-word layer).
 *
 * Stores are built by upserting fabricated Sightings — the store IS the
 * input fixture (same style as store.test.ts); keys are arbitrary
 * lowercase. Expected orders are hand-computed where they document the
 * math and cross-checked against compareCandidates (the single source of
 * truth) as a brute-force oracle. The one-word invariant suite is the
 * deliberate exception: it feeds a REAL IngestPipeline, because its
 * claim is that no pipeline stage can ever produce a multi-word display.
 *
 * The matchFragment describe (plan 003 P1.M2.T1.S1, PRD §04 h2.28) is
 * pure-function only — no store. Expected scores are computed by the
 * §04 formulas with hand-traced gapRuns/gapChars; where the PRD prose's
 * ≈-approximations disagree with its own formulas, the FORMULA wins
 * (noted inline at the drifted cases). The admission-threshold describe
 * (plan 003 P1.M2.T1.S2) pins the fuzzThreshold gate: constants
 * single-sourced, strict score < threshold discard inside rankMatches'
 * candidate loop, default-60 admitting ONLY tier-1's single-1-char-hole
 * class (2026-10 gap-size retune), and the zero-fragment bypass
 * (scan-sequencing note in that describe).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CandidateStore } from "../src/core/store.js";
import { loadDictionary } from "../src/core/dictionary.js";
import { compareCandidates, salience } from "../src/core/score.js";
import {
  compareRankedMatches,
  DEFAULT_FUZZ_THRESHOLD,
  DEFAULT_LIMIT,
  matchFragment,
  rankMatches,
  TIER0_BASE_SCORE,
  TIER0_SKIP_FACTOR,
  TIER1_BASE_SCORE,
  TIER1_GAPCHAR_CAP,
  TIER1_GAPCHAR_WEIGHT,
  TIER1_GAPRUN_PENALTY,
  TIER2_BASE_SCORE,
  TIER2_SKIP_FACTOR,
  TIER3_SCORE,
} from "../src/core/query.js";
import { IngestPipeline } from "../src/pi/ingest.js";
import type { RankedMatch, Sighting } from "../src/core/types.js";
import { buildDictBinary, writeDictFile } from "./helpers/dict-writer.js";
import { assertWordsOnly } from "./helpers/query-invariants.js";

/** Fresh group-2 sighting of "hapax" at ordinal 1; override any field. */
const sighting = (over: Partial<Sighting> = {}): Sighting => ({
  key: "hapax",
  display: "hapax",
  ordinal: 1,
  fromUser: false,
  properName: false,
  casing: "lower",
  rankGroup: 2,
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

/** Oracle: expected key order per the 2026-10 menu order (spec §04
 *  h2.29, progressive completion) — match path: tier desc → shorter
 *  key → sessionCount desc → byte-lex, with exact-equal keys
 *  excluded from membership; zero-fragment listing: sessionCount desc
 *  → shorter → byte-lex (the listing's own relevance board) — the
 *  same math rankMatches must apply, computed here from matchFragment
 *  + store entries, deliberately independent of compareRankedMatches.
 *  Membership mirrors the T2.S2 first-char-bucket scan: non-empty
 *  fragments consider every key sharing the fragment's first char
 *  that survives matchFragment at the default fuzzThreshold
 *  (tiers 3/2/1); zero-fragment lists everything (no tiers —
 *  matchFragment("") is null → uniform tier 0). The composite salience
 *  is NOT a sort key. */
const expectedOrder = (s: CandidateStore, prefix: string): string[] => {
  const lower = prefix.toLowerCase();
  const bucket = lower === "" ? "" : lower[0];
  return s
    .entries()
    .filter((c) => c.key.startsWith(bucket))
    .flatMap((c) => {
      if (lower === "") return [{ tier: 0, c }];
      if (c.key === lower) return []; // exact-equal exclusion (§04 h2.29)
      const m = matchFragment(prefix, c.key);
      return m !== null && m.score >= DEFAULT_FUZZ_THRESHOLD
        ? [{ tier: m.tier, c }]
        : [];
    })
    .sort((a, b) => {
      if (lower === "") {
        // Listing board: count first, then the shared tail.
        if (a.c.sessionCount !== b.c.sessionCount)
          return b.c.sessionCount - a.c.sessionCount;
      } else if (a.tier !== b.tier) {
        return b.tier - a.tier;
      }
      if (a.c.key.length !== b.c.key.length)
        return a.c.key.length - b.c.key.length;
      if (a.c.sessionCount !== b.c.sessionCount)
        return b.c.sessionCount - a.c.sessionCount;
      return a.c.key < b.c.key ? -1 : a.c.key > b.c.key ? 1 : 0;
    })
    .map((r) => r.c.key);
};

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
    expect(rankMatches(s, "nre")[0]!.display).toBe("nrel");
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

  it("every match-path result carries exactly the six RankedMatch fields (incl. tier)", () => {
    const s = new CandidateStore();
    put(s, "alpha");
    put(s, "alpine", 2);
    for (const m of rankMatches(s, "al")) {
      expect(Object.keys(m).sort()).toEqual([
        "description",
        "display",
        "key",
        "salience",
        "sessionCount",
        "tier",
      ]);
    }
  });

  it("zero-fragment listing items OMIT tier — public tier===0 means anchorless only", () => {
    const s = new CandidateStore();
    put(s, "alpha");
    put(s, "alpine", 2);
    for (const m of rankMatches(s, "")) {
      expect(Object.hasOwn(m, "tier")).toBe(false);
    }
  });

  it("sessionCount field agrees with the store entry and the description", () => {
    const s = new CandidateStore();
    put(s, "hapax", 3);
    put(s, "alpine", 2);
    for (const m of rankMatches(s, "")) {
      expect(m.sessionCount).toBe(s.get(m.key)!.sessionCount); // copied, not derived
      expect(m.description).toBe(`session x${m.sessionCount}`); // ASCII-x contract
    }
  });
});

describe("rankMatches — ordering (spec §04 h2.29: tier → shorter → count → lex)", () => {
  it("THE progressive ladder (owner case): shorter sibling completes first regardless of counts", () => {
    const s = new CandidateStore();
    put(s, "anchor-matches", 3); // 3 sightings — count-first order served this first
    put(s, "anchor-match", 1);
    expect(rankMatches(s, "anchor").map((m) => m.key)).toEqual([
      "anchor-match", // shorter key wins (progressive completion)
      "anchor-matches",
    ]);
    // Second Tab: the fully-typed word is excluded — only the extension
    // remains, so the ladder advances instead of re-offering itself.
    expect(rankMatches(s, "anchor-match").map((m) => m.key)).toEqual([
      "anchor-matches",
    ]);
  });

  it("counts order only EQUAL-LENGTH rivals: shorter key beats a 9-count", () => {
    const s = new CandidateStore();
    put(s, "zaghi", 9); // 5 chars, 9 sightings
    put(s, "zagmid", 2); // 6 chars
    put(s, "zaglow", 1); // 6 chars
    expect(rankMatches(s, "zag").map((m) => m.key)).toEqual([
      "zaghi", // length 5 beats count 9
      "zagmid", // equal length 6: count 2 > 1
      "zaglow",
    ]);
  });

  it("userTyped/sticky flags never reorder — equal count → shorter, then byte-lex", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "zagtyped", display: "zagtyped", fromUser: true }));
    s.upsert(sighting({ key: "zagplain", display: "zagplain" }));
    // Both count 1, both length 8 → the comparator's keys 3–4 decide.
    expect(rankMatches(s, "zag").map((m) => m.key)).toEqual([
      "zagplain",
      "zagtyped",
    ]);
  });

  it("equal count → shorter key first: 'fix' before 'fixpoint'", () => {
    const s = new CandidateStore();
    put(s, "fixpoint"); // upserted first on purpose — order must not care
    put(s, "fix", 1, 1, { rankGroup: 0 }); // rarest + highest salience — but count ties, so length wins
    expect(rankMatches(s, "fi").map((m) => m.key)).toEqual(["fix", "fixpoint"]);
  });

  it("equal length + UNEQUAL count → count first; byte-lex only breaks equal-count ties", () => {
    const s = new CandidateStore();
    put(s, "cow", 9);
    put(s, "cod", 1); // retired order had cod first (byte-lex at equal length); counts now decide
    expect(rankMatches(s, "co").map((m) => m.key)).toEqual(["cow", "cod"]);
  });

  it("equal length + equal count → byte-lex: 'cod' before 'cow'", () => {
    const s = new CandidateStore();
    put(s, "cow", 9);
    put(s, "cod", 9); // SAME count — only now does byte-lex decide
    expect(rankMatches(s, "co").map((m) => m.key)).toEqual(["cod", "cow"]);
  });

  it("hand-computed zero-fragment board sorts by count, then length/bytes", () => {
    const s = new CandidateStore();
    put(s, "abstract"); // 1
    put(s, "abort"); // 1
    put(s, "zzqv", 1, 1, { rankGroup: 0 }); // 1
    s.upsert(sighting({ key: "meridian", display: "meridian", fromUser: true })); // 1
    put(s, "verdant", 8); // 8 — the only counted word
    put(s, "cod"); // 1
    put(s, "cow"); // 1
    expect(rankMatches(s, "").map((m) => m.key)).toEqual([
      "verdant", // count 8 — counts order before any length/lex tie
      "cod", // count 1 → shorter first: len 3
      "cow", // len 3, byte-lex after cod
      "zzqv", // len 4
      "abort", // len 5
      "abstract", // len 8, byte a-b
      "meridian", // len 8, byte m-e
    ]);
  });

  it("matches the expectedOrder oracle across several prefixes", () => {
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

describe("rankMatches — tier-0 anchorless ambient fallback (2026-10, spec §04 h2.28)", () => {
  // Spec/04 h2.28 tier-0: when the anchored scan admits ZERO records and
  // the fragment is ≥ 3 chars, ONE anchorless full-store pass may rescue
  // the menu — score = TIER0_BASE_SCORE − TIER0_SKIP_FACTOR·(runStart/len),
  // Math.round + clampScore, strict < threshold gate (== survives),
  // threshold-gated at the active fuzzThreshold. It can never enrich a
  // menu that would already open (isolation), so never-hijack holds.

  it("'esk' → 'zendesk' at tier 0, score 62 (from exported constants), when anchored is empty", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "zendesk", display: "zendesk", rankGroup: 0 }));
    const [m] = rankMatches(s, "esk");
    expect(m!.key).toBe("zendesk");
    expect(m!.tier).toBe(0);
    // runStart 4 (zendesk: z-e-n-d-E-S-K), len 7: 85 − 40·4/7 = 62.14 → 62.
    // (The spec prose's "74 via runStart 2" is a hand-arithmetic slip —
    // indexOf is leftmost, and 'esk' first occurs at index 4; the formula
    // + exported constants are the contract. 62 still clears the default
    // 60, so the exemplar's rescuing behavior holds.)
    const score = Math.round(TIER0_BASE_SCORE - (TIER0_SKIP_FACTOR * 4) / 7);
    expect(score).toBe(62);
    // Score is admission-only and never public — pin the exact value
    // behaviorally: strict gate, == survives.
    expect(rankMatches(s, "esk", { fuzzThreshold: score })).toHaveLength(1);
    expect(rankMatches(s, "esk", { fuzzThreshold: score + 1 })).toEqual([]);
  });

  it("'query' → 'src/core/query.ts' at tier 0, score 64 (rule-4d path filename entry)", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "src/core/query.ts", display: "src/core/query.ts" }));
    const [m] = rankMatches(s, "query");
    expect(m!.key).toBe("src/core/query.ts");
    expect(m!.tier).toBe(0);
    // runStart 9, len 17: 85 − 40·9/17 = 63.82 → 64 (spec exemplar).
    const score = Math.round(TIER0_BASE_SCORE - (TIER0_SKIP_FACTOR * 9) / 17);
    expect(score).toBe(64);
    expect(rankMatches(s, "query", { fuzzThreshold: score })).toHaveLength(1);
    expect(rankMatches(s, "query", { fuzzThreshold: score + 1 })).toEqual([]);
  });

  it("floor 3: 1–2-char fragments with zero anchored results → []", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "zendesk", display: "zendesk" }));
    // "de" (runStart 3 → would-be 68) and "e" (runStart 1 → would-be 79)
    // both live mid-key — without the floor they would fire tier-0.
    expect(rankMatches(s, "de")).toEqual([]);
    expect(rankMatches(s, "e")).toEqual([]);
  });

  it("non-empty anchored result is byte-identical — latent tier-0 match never merges", () => {
    const s = new CandidateStore();
    put(s, "zebra");
    put(s, "zendesk");
    put(s, "amaze"); // latent tier-0 match for "ze" (runStart 2)
    // "ze" anchors on zebra/zendesk (tier 3) → fallback must not run,
    // amaze must never appear, order byte-identical to pre-tier-0.
    expect(rankMatches(s, "ze").map((m) => m.key)).toEqual(["zebra", "zendesk"]);
    for (const m of rankMatches(s, "ze")) {
      expect(m.tier).toBe(3); // match-path records carry their anchored tier
    }
    // Same store, mid-word fragment → anchored empty → the fallback fires.
    expect(rankMatches(s, "esk").map((m) => m.key)).toEqual(["zendesk"]);
  });

  it("late runs gate at default 60: runStart/len > 0.625 discarded (== survives)", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "abcdefghij", display: "abcdefghij" }));
    // runStart 7, len 10: 85 − 40·7/10 = 57 < 60 → discarded.
    expect(rankMatches(s, "hij")).toEqual([]);
    // Boundary: runStart 5, len 8 → 85 − 25 = 60 → == survives the strict
    // gate. The 10-char key also contains "fgh" (runStart 5, len 10 → 65
    // ≥ 60) and admits alongside — shorter key orders first.
    s.upsert(sighting({ key: "abcdefgh", display: "abcdefgh" }));
    expect(rankMatches(s, "fgh").map((m) => m.key)).toEqual([
      "abcdefgh",
      "abcdefghij",
    ]);
  });

  it("explicit fuzzThreshold gates the fallback too", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "src/core/query.ts", display: "src/core/query.ts" }));
    expect(rankMatches(s, "query", { fuzzThreshold: 75 })).toEqual([]);
    expect(rankMatches(s, "query", { fuzzThreshold: 60 })).toHaveLength(1);
  });

  it("plural pruning applies to fallback results before the limit slice", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "midfielder", display: "midfielder" }));
    s.upsert(sighting({ key: "midfielders", display: "midfielders" }));
    // "ield" (4 chars, mid-word, no anchor) admits both at tier 0
    // (85−12=73 / 85−10.9=74); the plural is pruned BEFORE the slice.
    expect(rankMatches(s, "ield").map((m) => m.key)).toEqual(["midfielder"]);
    expect(rankMatches(s, "ield", { limit: 1 }).map((m) => m.key)).toEqual([
      "midfielder",
    ]);
  });

  it("fallback records are ordinary records: tier-0 orders by shorter → count → byte-lex", () => {
    const s = new CandidateStore();
    put(s, "warpath", 3);
    put(s, "warped");
    // "arp" (3 chars, mid-word, no anchor): warpath runStart 1, len 7 →
    // 85−5.7≈79; warped runStart 1, len 6 → 85−6.7≈78 — both admit at
    // tier 0; the comparator's keys 2–4 order within the tier (length
    // first under h2.29 — warped is shorter and leads despite the
    // count deficit).
    expect(rankMatches(s, "arp").map((m) => m.key)).toEqual([
      "warped",
      "warpath",
    ]);
  });
});

describe("compareRankedMatches — 4-key order (spec §04 h2.29, comparator level)", () => {
  /** Direct comparator fixture — cross-tier order is pinned here at
   *  the comparator level, independent of which tier-1 shapes clear the
   *  admission threshold (a §09 calibration question); tier-2 IS
   *  observable since T2.S2's bucket scan, but a count can never cross
   *  a tier boundary either way (pinned again below at this level). */
  const rec = (tier: number, key: string, sessionCount: number) => ({
    tier,
    m: {
      key,
      display: key,
      description: `session x${sessionCount}`,
      salience: 0,
      sessionCount,
    },
  });

  it("THE headline rule: a 1-count exact prefix outranks a 40-count scattered match", () => {
    const exact = rec(3, "z", 1);
    const scattered = rec(1, "handleResponseProxy", 40);
    expect(compareRankedMatches(exact, scattered)).toBeLessThan(0);
    expect(compareRankedMatches(scattered, exact)).toBeGreaterThan(0);
  });

  it("counts reorder ONLY same-tier neighbors — a tier boundary is never crossed", () => {
    // 40× the count cannot cross tier 3 → tier 2…
    const t3 = rec(3, "zzexact", 1);
    const t2 = rec(2, "zztail", 40);
    expect(compareRankedMatches(t3, t2)).toBeLessThan(0);
    expect(compareRankedMatches(t2, t3)).toBeGreaterThan(0);
    // …but the same gap INSIDE one tier reorders (both directions).
    const lo = rec(2, "aalo", 1);
    const hi = rec(2, "bbhi", 40);
    expect(compareRankedMatches(hi, lo)).toBeLessThan(0);
    expect(compareRankedMatches(lo, hi)).toBeGreaterThan(0);
  });

  it("ties: shorter key, then byte-lex — a valid total order", () => {
    expect(compareRankedMatches(rec(3, "cod", 2), rec(3, "codfish", 2))).toBeLessThan(0);
    expect(compareRankedMatches(rec(3, "cod", 2), rec(3, "cow", 2))).toBeLessThan(0);
    expect(compareRankedMatches(rec(3, "cow", 2), rec(3, "cod", 2))).toBeGreaterThan(0);
    const same = rec(2, "same", 5);
    expect(compareRankedMatches(same, { ...same })).toBe(0); // total: identical records tie
  });

  it("match-path comparator is LENGTH-first even among uniform tier-0 records (listings order via compareListing)", () => {
    expect(compareRankedMatches(rec(0, "zzlongestkey", 9), rec(0, "a", 1))).toBeGreaterThan(0); // shorter key wins regardless of count
    expect(compareRankedMatches(rec(0, "a", 1), rec(0, "bb", 1))).toBeLessThan(0);
    expect(compareRankedMatches(rec(0, "bb", 1), rec(0, "a", 1))).toBeGreaterThan(0);
  });

  it("strictness chain 3 > 2 > 1 > 0: anchorless ambient (0) loses to scattered (1)", () => {
    // 2026-10 tier-0 (spec §04 h2.28): the comparator already ordered
    // 0 below 1 — the anchorless fallback rides that same row.
    const t3 = rec(3, "a", 1);
    const t2 = rec(2, "b", 1);
    const t1 = rec(1, "c", 1);
    const t0 = rec(0, "d", 99); // 99× the count still cannot cross a tier
    expect(compareRankedMatches(t3, t2)).toBeLessThan(0);
    expect(compareRankedMatches(t2, t1)).toBeLessThan(0);
    expect(compareRankedMatches(t1, t0)).toBeLessThan(0);
    expect(compareRankedMatches(t0, t1)).toBeGreaterThan(0);
  });
});

describe("rankMatches — zero-fragment listing ('#' alone: no tiers)", () => {
  it("orders by sessionCount desc — a count beats a shorter key", () => {
    const s = new CandidateStore();
    put(s, "zz", 1); // shortest possible — length would win under the retired order
    put(s, "zzzzzzzzzz", 9); // long, but 9× the count
    // '#' alone: no matchFragment call, no tiers — count desc, then length.
    expect(rankMatches(s, "").map((m) => m.key)).toEqual(["zzzzzzzzzz", "zz"]);
    // Same store, 1-char fragment: both tier-3 exact prefixes — the
    // match path is LENGTH-first (h2.29 progressive completion), so the
    // two paths deliberately DIVERGE: the listing is a relevance board,
    // the match path is a completion ladder.
    expect(rankMatches(s, "z").map((m) => m.key)).toEqual(["zz", "zzzzzzzzzz"]);
  });

  it("ties: shorter key, then byte-lex", () => {
    const s = new CandidateStore();
    put(s, "cod", 2);
    put(s, "cow", 2);
    put(s, "codd", 2);
    expect(rankMatches(s, "").map((m) => m.key)).toEqual(["cod", "cow", "codd"]);
  });
});

describe("rankMatches — limits (PRD §04 h2.26: top 8)", () => {
  it("exports DEFAULT_LIMIT = 8", () => {
    expect(DEFAULT_LIMIT).toBe(8);
  });

  it("15 same-prefix matches → exactly 8 results, the highest-count ones", () => {
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
    ]); // counts 15…8 — already the count-desc order (key 2 within tier 3)
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

describe("rankMatches — ordinal interplay (salience carried; counts, not recency, order)", () => {
  it("a fresh sighting reorders only through sessionCount — recency alone never does", () => {
    const s = new CandidateStore();
    put(s, "oldnews", 3, 1);
    put(s, "fresh", 1, 1);
    // Count order: oldnews(3) > fresh(1).
    expect(rankMatches(s, "").map((m) => m.key)).toEqual(["oldnews", "fresh"]);
    for (let i = 0; i < 80; i++) s.nextOrdinal(); // now = 81
    s.upsert(sighting({ key: "fresh", display: "fresh", ordinal: 81 }));
    // The fresh sighting raises fresh's count 1 → 2 — still below oldnews'
    // 3, so the menu is unchanged. The ordinal/recency advance itself is
    // invisible to the order; only the count component moved.
    expect(rankMatches(s, "").map((m) => m.key)).toEqual(["oldnews", "fresh"]);
    // Sanity: the count really moved (the assertion above is not vacuous).
    expect(s.get("fresh")!.sessionCount).toBe(2);
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

describe("rankMatches — one-word invariant (PRD §07 h2.44, R1)", () => {
  // The invariant claims NO pipeline stage can produce a multi-word
  // display — so the store here is populated through the REAL ingest
  // path (IngestPipeline.processText: segment → shape gate → admission
  // bands → store), never store.upsert. A SYNTHETIC dictionary
  // (buildDictBinary) keeps the suite independent of the shipped
  // artifact's calibration — that is a different gate's concern
  // (calibration.test.ts). The repeated bigrams ("lwlock guard",
  // "zendesk ticket") give the store's successor index ingest material
  // — harmless for ranking (chaining is provider-side) but exactly the
  // prose shape the P1.M2.T1.S2 chain tests build on with the same
  // assertWordsOnly helper.
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("every result of every queried prefix has a single-word display", async () => {
    dir = mkdtempSync(join(tmpdir(), "hapax-q-"));
    // Low quants (10–30) → group 1 (rare-but-attested) under any sane
    // band constants; the prose's other words miss the dict entirely →
    // group 0 (rare-by-default). Both admit — which is the point: the
    // invariant must hold for the whole menu, not a hand-picked word.
    const dictPath = writeDictFile(join(dir, "d.bin"), [
      { word: "lwlock", quant: 10 },
      { word: "zendesk", quant: 10 },
      { word: "guard", quant: 20 },
      { word: "ticket", quant: 20 },
      { word: "check", quant: 30 },
    ]);
    const store = new CandidateStore();
    const pipeline = new IngestPipeline({
      store,
      dictionary: loadDictionary(dictPath),
    });
    await pipeline.processText(
      "Please check the lwlock guard before the zendesk ticket closes.",
      false,
    );
    await pipeline.processText(
      "The lwlock guard failed again; file a zendesk ticket.",
      true,
    );
    // 2026-09 retighten: t/g-prefix coverage needs absent words (English
    // t-/g-words reject at the table now).
    await pipeline.processText("txidlock and gzorch diagnostics", true);
    expect(store.size, "real ingest must populate the store").toBeGreaterThan(0);

    for (const p of ["", "l", "lw", "z", "t", "g"]) {
      const matches = rankMatches(store, p);
      expect(matches.length, `prefix "${p}" must be populated`).toBeGreaterThan(0);
      assertWordsOnly(matches, `prefix "${p}"`);
      for (const m of matches) {
        // The item contract survives the real path too: provenance is
        // still the session-count string, casing still the stored one.
        expect(m.description, `prefix "${p}"`).toMatch(/^session x\d+$/);
      }
    }

    // Spot-check the fixture words are actually reachable (guards against
    // a silently empty ingest that would vacuously pass the loop above —
    // belt-and-suspenders with the store.size check):
    expect(rankMatches(store, "lw").map((m) => m.key)).toContain("lwlock");
    expect(rankMatches(store, "zen").map((m) => m.key)).toContain("zendesk");
  });
});

// ── Performance sanity (informal; the formal gate is P1.M4.T1.S2) ──────────

describe("rankMatches — perf sanity (PRD §02 h3.1: < 1 ms per keystroke)", () => {
  it("20k-entry store: 1000 queries complete in < 1000 ms total", () => {
    const s = new CandidateStore();
    // Distribute keys over 26 FIRST letters so the queried bucket (the
    // T2.S2 scan entry) is realistic (~770 keys — a mid-typing
    // keystroke), not whole-store. The fixed second char 'z' makes every
    // qa…–qz… key an exact "qz" prefix inside its own bucket.
    const key = (i: number): string =>
      "abcdefghijklmnopqrstuvwxyz".charAt(i % 26) +
      "z" +
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
describe("rankMatches — exact-equal exclusion (spec §04 h2.29, 2026-10 owner rule)", () => {
  it("a fully-typed word is never offered — ambient, loose (tier-0 parity), listing unaffected", () => {
    const s = new CandidateStore();
    put(s, "zendesk", 5);
    put(s, "zendeskdocs", 1);
    expect(rankMatches(s, "zendesk").map((m) => m.key)).toEqual([
      "zendeskdocs", // the exact word itself is gone; extensions remain
    ]);
    expect(rankMatches(s, "zendesk", { loose: true }).map((m) => m.key)).toEqual([
      "zendeskdocs", // tier-0 pass skips the exact-equal key too (parity)
    ]);
    // The '#' listing has no fragment — nothing to exclude.
    expect(rankMatches(s, "").map((m) => m.key)).toEqual(["zendesk", "zendeskdocs"]);
  });

  it("zero candidates remain → [] (provider delegates; the empty menu is the signal)", () => {
    const s = new CandidateStore();
    put(s, "hapax", 2);
    expect(rankMatches(s, "hapax")).toEqual([]);
  });
});

describe("rankMatches — plural pruning (2026-09 owner rule)", () => {
  it("singular + plural both match → only the singular is returned", () => {
    const s = new CandidateStore();
    put(s, "plugin", 3, 1);
    put(s, "plugins", 2, 2);
    expect(rankMatches(s, "plug").map((m) => m.key)).toEqual(["plugin"]);
  });

  it("plural without its singular in the result set → plural stays", () => {
    const s = new CandidateStore();
    put(s, "plugins", 2);
    expect(rankMatches(s, "plug").map((m) => m.key)).toEqual(["plugins"]);
  });

  it("prefix excludes the singular → plural survives on its own", () => {
    const s = new CandidateStore();
    put(s, "agent", 3);
    put(s, "agents", 2);
    // "agen" matches both; "agents" alone (prefix "agents") has no
    // singular in its result set — but the fragment EQUALS the plural
    // key, and the exact-equal exclusion (h2.29) fires first: a
    // fully-typed word is never offered. The plural now completes only
    // via fragments shorter than itself ("agent" → Tab-walk, "agents"
    // is the walk's terminus).
    expect(rankMatches(s, "agen").map((m) => m.key)).toEqual(["agent"]);
    expect(rankMatches(s, "agents").map((m) => m.key)).toEqual([]);
  });

  it("\"ss\" and \"es\" forms never prune: glass stays, class/classes coexist", () => {
    const s = new CandidateStore();
    put(s, "glas", 1);
    put(s, "glass", 1); // ss-final — must survive even with glas present
    put(s, "class", 1);
    put(s, "classes", 1); // different key shape — not a single-s pair
    expect(rankMatches(s, "gla").map((m) => m.key)).toEqual(["glas", "glass"]);
    expect(rankMatches(s, "cla").map((m) => m.key)).toEqual(["class", "classes"]);
  });

  it("pruning runs BEFORE the limit slice — a pruned plural frees its slot under count order", () => {
    const s = new CandidateStore();
    put(s, "plugins", 9); // highest count — pre-slice it owns slot 1…
    put(s, "plugin", 1); // len 6
    put(s, "plugged", 1); // len 7
    // Pre-slice order (§04 h2.29): plugins(9), then the count-1 pair by
    // length: plugin(6), plugged(7). Pruning drops plugins AFTER the sort,
    // and its freed slot goes to plugged — the pruned plural never
    // consumes a slot under the new order either.
    expect(rankMatches(s, "plug", { limit: 2 }).map((m) => m.key)).toEqual([
      "plugin",
      "plugged", // plugins was pruned; its slot went to the next candidate
    ]);
  });
});

// ── rule 4d path candidates under the CURRENT prefix matcher ────────────────
// P1.M1.T2.S4 pre-fuzzy baseline (spec §07 auto-open, spec §09 integration
// item 7): keys are WHOLE trimmed-lowercase paths, so byte-lex prefix
// matching surfaces a path at its FIRST segment only ("sr" →
// "src/core/query.ts") and can never match a mid-path component. How far a
// typed fragment may travel before hapax is consulted at all is upstream's
// business — the threshold regex admits no '/' and the stock-context gate
// delegates every '/'-preceded cursor (order pins in test/provider-match
// and test/provider). This suite pins the query seam those gates protect:
// when "sr" DOES arrive, the whole path comes back with its display.

describe("path candidates under the prefix matcher (rule 4d, pre-fuzzy baseline)", () => {
  /** Store holding the rule-4d path candidate; display = key. */
  const pathStore = (): CandidateStore => {
    const s = new CandidateStore();
    put(s, "src/core/query.ts", 2, 4);
    return s;
  };

  it("'sr' (first-segment prefix) surfaces the whole-path candidate with its display", () => {
    const [m] = rankMatches(pathStore(), "sr");
    expect(m!.key).toBe("src/core/query.ts");
    expect(m!.display).toBe("src/core/query.ts"); // display outflow intact — Tab inserts the whole path
    expect(m!.description).toBe("session x2"); // ordinary item contract rides along
  });

  it("uppercase prefix 'SR' works identically (rankMatches lowercases before prefixRange)", () => {
    expect(rankMatches(pathStore(), "SR").map((m) => m.key)).toEqual([
      "src/core/query.ts",
    ]);
  });

  it("absolute-path key: pre-first-slash prefix matches; display keeps the leading '/'", () => {
    const s = new CandidateStore();
    put(s, "home/dustin/projects/hapax", 1, 3, {
      display: "/home/dustin/projects/hapax",
    });
    const [m] = rankMatches(s, "home/dus");
    expect(m!.key).toBe("home/dustin/projects/hapax");
    expect(m!.display).toBe("/home/dustin/projects/hapax"); // edge character rides along (rule 4d)
  });

  it("a mid-path component is never matchable: 'core' does not return the path", () => {
    // Keys are whole paths — components are absorbed at admission — so a
    // component word only completes as itself, never as a step into a path.
    const s = pathStore();
    put(s, "coreutils", 1, 2); // a genuine word sharing the component prefix
    expect(rankMatches(s, "core").map((m) => m.key)).toEqual(["coreutils"]);
  });
});

describe("matchFragment — anchored fuzzy (PRD §04 h2.28, plan 003)", () => {
  it("ANCHOR: a fragment not starting with the candidate's first char never matches", () => {
    // 'esk' inside 'zendesk' is exactly what plain-substring matching
    // would wrongly admit; mid-identifier entry is sub-word candidates'
    // job, never anchor-less fuzzy.
    expect(matchFragment("esk", "zendesk")).toBeNull();
    expect(matchFragment("e", "zendesk")).toBeNull(); // 1-char anchor miss too
  });

  it("tier 3 — exact prefix ('roun' → 'rounding'), always score 100", () => {
    expect(matchFragment("roun", "rounding")).toEqual({ tier: 3, score: 100 });
    expect(matchFragment("zendesk", "zendesk")).toEqual({ tier: 3, score: 100 }); // f === c
  });

  it("tier 2 — contiguous tail ('zsk' → 'zendesk'); score = 85 − 40·skipped/len", () => {
    // 'sk' first occurs at index 5 → skipped = 5 − 1 = 4 (c[0] is the
    // anchor): 85 − 40·4/7 = 62.14 → 62. (The PRD prose's "≈62" matches
    // the formula; the PRP gotcha's "≈68" miscounted the skipped run —
    // formula wins either way.)
    expect(matchFragment("zsk", "zendesk")).toEqual({ tier: 2, score: 62 });
  });

  it("tier 2 — contiguous past separators ('zlock' → 'z_lwlock') = 70", () => {
    // 'lock' first occurs at index 4 → skipped 3: 85 − 40·3/8 = 70 exact.
    expect(matchFragment("zlock", "z_lwlock")).toEqual({ tier: 2, score: 70 });
  });

  it("tier 2 — 'hr' → 'handleResponse' = 71 by the formula (drift documented)", () => {
    // 'r' first occurs at index 6 → skipped 5; len('handleresponse') = 14:
    // 85 − 40·5/14 = 70.71 → 71. The PRD prose's "≈ 69" AND the PRP
    // gotcha's "exactly 85 (contiguous from c[1], skip 0)" both miscount
    // — 'handleResponse' is 'ha…', so the run is NOT at c[1]. The formula
    // is the spec.
    expect(matchFragment("hr", "handleResponse")).toEqual({ tier: 2, score: 71 });
  });

  it("tier 1 — scattered subsequence ('hrp' → 'handleResponseProxy'), greedy leftmost", () => {
    // Greedy-leftmost trace over 'andleresponseproxy' (after the h
    // anchor): r@6 — the anchor→first-tail stretch is NOT a gap (the
    // anchor is not gapped) — then p@9: one gap run of 2 chars ('es').
    // gapRuns=1, gapChars=2 → 70 − 5 − min(3·2, 15) = 59 (the 2026-10
    // gap-size retune; the first calibration scored this 43).
    expect(matchFragment("hrp", "handleResponseProxy")).toEqual({
      tier: 1,
      score: 59,
    });
  });

  it("tier 1 — leading stretch never counts as a gap ('zds' → 'zendesk') = 62", () => {
    // d@3 (skips 'en' BEFORE the first tail char — free), s@5 (one gap
    // run of 1 char 'e'). gapRuns=1, gapChars=1 → 70 − 5 − min(3·1, 15)
    // = 62 — tier-1's maximum, the single-1-char-hole class the retune
    // admits at the ambient default 60.
    expect(matchFragment("zds", "zendesk")).toEqual({ tier: 1, score: 62 });
  });

  it("tier 1 — gapChars saturates at a 15-point penalty and the score stays within [0, 100]", () => {
    // 'a' matches at 1 (no gap), 'y' at 18: one gap run of 16 chars →
    // min(3·16, 15) = 15 → 70 − 5 − 15 = 50. Saturation at 5 skipped
    // chars, not the raw 3·16 = 48.
    const c = "ha" + "x".repeat(16) + "y";
    const r = matchFragment("hay", c);
    expect(r).toEqual({ tier: 1, score: 50 });
    expect(r!.score).toBeGreaterThanOrEqual(0);
    expect(r!.score).toBeLessThanOrEqual(100);
  });

  it("tier 1 — '/ and .' are ordinary characters (path keys, rule 4d)", () => {
    expect(matchFragment("sr", "src/core/query.ts")).toEqual({ tier: 3, score: 100 });
    // 'r/co' is not contiguous in 'rc/core/query.ts' (cl[1..] = 'rc/…'):
    // greedy trace r@1 (free), '/'@3 (gap 1: 'c'), c@4, o@5 →
    // gapRuns=1, gapChars=1 → 70 − 5 − 3 = 62.
    expect(matchFragment("sr/co", "src/core/query.ts")).toEqual({
      tier: 1,
      score: 62,
    });
  });

  it("case-insensitive on BOTH sides, inside the matcher", () => {
    expect(matchFragment("ZSK", "zendesk")).toEqual({ tier: 2, score: 62 });
    expect(matchFragment("zsk", "ZENDESK")).toEqual({ tier: 2, score: 62 });
    expect(matchFragment("ROUN", "Rounding")).toEqual({ tier: 3, score: 100 });
  });

  it("boundaries: empty fragment → null; 1-char anchor hit → {3,100}; too-long → null", () => {
    expect(matchFragment("", "zendesk")).toBeNull(); // zero-fragment listing is rankMatches' case
    expect(matchFragment("z", "zendesk")).toEqual({ tier: 3, score: 100 });
    expect(matchFragment("zendesklonger", "zendesk")).toBeNull();
  });

  it("null when the tail cannot be consumed at all", () => {
    // 'zendesk' contains no 'p': scattered scan exhausts → null. (The
    // PRP's "'zp' vs 'zendesk' → 41" worked example used a candidate
    // that contains no 'p' at all — correct answer is null.)
    expect(matchFragment("zp", "zendesk")).toBeNull();
    // Partial consumption is not enough: 'zz' needs TWO z's.
    expect(matchFragment("zz", "zendesk")).toBeNull();
  });

  it("tier scores respect their bands: tier 3 = 100, tier 1 ≤ 62 (the one-hole max)", () => {
    expect(matchFragment("z", "zendesk")!.score).toBe(100);
    for (const [f, c] of [
      ["hrp", "handleResponseProxy"],
      ["zds", "zendesk"],
      ["sr/co", "src/core/query.ts"],
      ["hay", "ha" + "x".repeat(16) + "y"],
    ] as const) {
      const r = matchFragment(f, c)!;
      expect(r.tier).toBe(1);
      // Max = BASE − run penalty − one 1-char hole (62), from constants.
      expect(r.score).toBeLessThanOrEqual(
        TIER1_BASE_SCORE - TIER1_GAPRUN_PENALTY - TIER1_GAPCHAR_WEIGHT,
      );
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Admission threshold — fuzzThreshold gating (PRD §04 h2.28, plan 003 S2) ──
//
// SCAN-SEQUENCING NOTE (updated by T2.S2): rankMatches now scans the
// FIRST-CHAR bucket, so the gate is load-bearing at the default — tier-2
// tail matches (≤ 85) admit above it, tier-1 scattered matches stay under
// it except the single-1-char-hole class (62, the 2026-10 gap-size
// retune). The historical pins below (thresholds 150/100)
// still hold: they prove the comparison direction and the absent =
// DEFAULT_FUZZ_THRESHOLD semantics through the public seam, and the
// tier-2/1 boundary cases pinned at the matcher level are now reachable
// end-to-end (see the first-char-bucket-scan describe).

describe("admission threshold — fuzzThreshold gating (PRD §04 h2.28, plan 003 S2)", () => {
  /** Keys with known matcher traces: zendesk (tier-2 probe 'zsk' → 62),
   *  z_lwlock (tier-2 'zlock' → 70 exactly), handleresponseproxy
   *  (tier-1 'hrp' → 59). */
  const seed = (): CandidateStore => {
    const s = new CandidateStore();
    put(s, "zendesk", 2);
    put(s, "z_lwlock", 1);
    put(s, "handleresponseproxy", 1);
    return s;
  };

  it("score arithmetic flows from the exported constants (single-sourced)", () => {
    // Tier 3 is the constant itself — no arithmetic.
    expect(matchFragment("roun", "rounding")).toEqual({ tier: 3, score: TIER3_SCORE });
    expect(TIER3_SCORE).toBe(100);

    // Tier 2: score = round(BASE − SKIP_FACTOR · skipped / len(c)).
    // 'zsk'→'zendesk': 'sk' first occurs at index 5 → skipped = 4 (the
    // anchor consumes c[0]): round(85 − 40·4/7) = 62.
    expect(matchFragment("zsk", "zendesk")).toEqual({
      tier: 2,
      score: Math.round(TIER2_BASE_SCORE - (TIER2_SKIP_FACTOR * 4) / "zendesk".length),
    });
    // 'zlock'→'z_lwlock': 'lock' first at index 4 → skipped 3 → exact 70.
    expect(matchFragment("zlock", "z_lwlock")).toEqual({
      tier: 2,
      score: Math.round(TIER2_BASE_SCORE - (TIER2_SKIP_FACTOR * 3) / "z_lwlock".length),
    });
    expect(
      Math.round(TIER2_BASE_SCORE - (TIER2_SKIP_FACTOR * 3) / "z_lwlock".length),
    ).toBe(70);

    // Tier 1: score = BASE − GAPRUN_PENALTY·gapRuns −
    // min(GAPCHAR_WEIGHT·gapChars, GAPCHAR_CAP).
    // 'hrp'→'handleResponseProxy': greedy trace gives gapRuns=1,
    // gapChars=2 → 70 − 5 − 6 = 59.
    expect(matchFragment("hrp", "handleResponseProxy")).toEqual({
      tier: 1,
      score:
        TIER1_BASE_SCORE -
        TIER1_GAPRUN_PENALTY * 1 -
        Math.min(TIER1_GAPCHAR_WEIGHT * 2, TIER1_GAPCHAR_CAP),
    });
  });

  it("below-threshold matches never render: score < threshold discards BEFORE ranking", () => {
    const s = seed();
    // A threshold above TIER3_SCORE (100) discards even exact prefixes —
    // the one tier reachable under today's prefix scan — proving the
    // gate compares the match score inside the loop and drops the
    // candidate before it can be ranked or rendered.
    expect(rankMatches(s, "zen", { fuzzThreshold: 150 })).toEqual([]);
    // And the discard is not a post-ranking filter artifact: with the
    // gate inactive (threshold ≤ 100) the same query renders.
    expect(rankMatches(s, "zen", { fuzzThreshold: 100 }).map((m) => m.key)).toEqual([
      "zendesk",
    ]);
  });

  it("strict-< boundary: a score exactly AT the threshold survives", () => {
    const s = seed();
    // 100 vs threshold 100 → survives (this is what makes 100 the
    // exact-prefix-only mode rather than an empty menu).
    expect(rankMatches(s, "zen", { fuzzThreshold: 100 }).map((m) => m.key)).toEqual([
      "zendesk",
    ]);
    // Tier-2 boundary pinned at the matcher level (reaches the gate the
    // moment T2.S2's scan surfaces non-prefix candidates): 'zlock' →
    // 'z_lwlock' scores exactly 70 — admits at threshold 70 (70 < 70 is
    // false), discards at 71.
    const zlockScore = matchFragment("zlock", "z_lwlock")!.score;
    expect(zlockScore).toBe(70);
    expect(zlockScore < 70).toBe(false); // exactly-at survives…
    expect(zlockScore < 71).toBe(true); // …one above discards
  });

  it("fuzzThreshold: 0 admits everything that matches", () => {
    const s = seed();
    expect(rankMatches(s, "zen", { fuzzThreshold: 0 }).map((m) => m.key)).toEqual([
      "zendesk",
    ]);
    // 1-char fragment → every anchored candidate is tier 3 → all render.
    expect(rankMatches(s, "z", { fuzzThreshold: 0 }).map((m) => m.key)).toEqual([
      "zendesk",
      "z_lwlock",
    ]);
  });

  it("absent fuzzThreshold ≡ DEFAULT_FUZZ_THRESHOLD (not 0) — default 60 admits ONLY tier-1's one-1-char-hole class (2026-10 retune)", () => {
    const s = seed();
    // SPEC (§04, gap-size retune): "At the default this admits every exact
    // prefix, strong contiguous tails and — since the gap-size retune —
    // exactly one scattered class: the single 1-char interior hole." The
    // arithmetic: tier-1's MAXIMUM is BASE − run penalty − one 1-char
    // hole = 62 ≥ 60, and every looser shape subtracts ≥ 3 more per gap
    // char (2-char hole 59) or 5+ per extra run (≤ 54), staying under.
    expect(DEFAULT_FUZZ_THRESHOLD).toBe(60); // the §08 h2.52 schema default; a §09 retune updates this pin deliberately
    const t1Max = TIER1_BASE_SCORE - TIER1_GAPRUN_PENALTY - TIER1_GAPCHAR_WEIGHT;
    expect(t1Max).toBe(62);
    expect(t1Max).toBeGreaterThanOrEqual(DEFAULT_FUZZ_THRESHOLD);
    // The one-hole traces admit at the default:
    for (const [f, c] of [
      ["zds", "zendesk"],
      ["sr/co", "src/core/query.ts"],
    ] as const) {
      expect(matchFragment(f, c)!.score, `${f} vs ${c}`).toBeGreaterThanOrEqual(
        DEFAULT_FUZZ_THRESHOLD,
      );
    }
    // Every looser tier-1 trace in the matcher suite still gates out:
    for (const [f, c] of [
      ["hrp", "handleResponseProxy"],
      ["hay", "ha" + "x".repeat(16) + "y"],
    ] as const) {
      expect(matchFragment(f, c)!.score, `${f} vs ${c}`).toBeLessThan(
        DEFAULT_FUZZ_THRESHOLD,
      );
    }
    // Absent option ≡ explicit default — distinguishable from absent = 0
    // because a threshold ABOVE 100 discards even tier-3 prefixes under
    // the default reading (and only under it):
    expect(rankMatches(s, "zen")).toEqual(
      rankMatches(s, "zen", { fuzzThreshold: DEFAULT_FUZZ_THRESHOLD }),
    );
    expect(rankMatches(s, "zen").map((m) => m.key)).toEqual(["zendesk"]);
  });

  it("fuzzThreshold: 100 = exact-prefix-only (tiers 2/1 max 85 < 100)", () => {
    // Band property: tier-2's maximum is TIER2_BASE_SCORE (skipped 0) and
    // tier-1's is TIER1_BASE_SCORE — both strictly below 100, so
    // threshold 100 admits ONLY tier-3 exact prefixes.
    expect(TIER2_BASE_SCORE).toBeLessThan(100);
    expect(TIER1_BASE_SCORE).toBeLessThan(100);
    const s = seed();
    // Under today's prefix scan every scanned candidate IS an exact
    // prefix, so the prefix probe renders at 100 —
    expect(rankMatches(s, "zen", { fuzzThreshold: 100 }).map((m) => m.key)).toEqual([
      "zendesk",
    ]);
    // — and the matcher-level contract shows why nothing fuzzy survives
    // once T2.S2's scan makes tiers 2/1 reachable:
    expect(matchFragment("zsk", "zendesk")!.score).toBeLessThan(100);
    expect(matchFragment("hrp", "handleResponseProxy")!.score).toBeLessThan(100);
  });

  it("zero-fragment listing bypasses the gate entirely (full listing, unchanged)", () => {
    const s = seed();
    // '#' alone: no anchor → no tiers → NO gate. Even extreme thresholds
    // list every candidate in the zero-fragment order (sessionCount desc →
    // shorter → byte-lex): zendesk(2) first, then the count-1 pair by
    // length.
    const all = rankMatches(s, "", { fuzzThreshold: 100 });
    expect(all.map((m) => m.key)).toEqual([
      "zendesk",
      "z_lwlock",
      "handleresponseproxy",
    ]);
    expect(rankMatches(s, "", { fuzzThreshold: 1000 }).map((m) => m.key)).toEqual([
      "zendesk",
      "z_lwlock",
      "handleresponseproxy",
    ]);
  });
});

// ── First-char-bucket scan (P1.M2.T2.S2, §06 h2.38) ─────────────────────

describe("rankMatches — first-char-bucket scan (P1.M2.T2.S2)", () => {
  it("tier-2 tail matches in the same bucket now surface (invisible pre-T2.S2)", () => {
    const s = new CandidateStore();
    put(s, "zsketch", 1);
    put(s, "zendesk", 2);
    // 'zsk' IS an exact prefix of zsketch (tier 3); it never prefix-
    // matches zendesk, but it IS a tier-2 contiguous-tail match inside
    // it (score 62 ≥ default 60) — under the old fragment-scoped range
    // the scan never saw it. Tier 3 outranks tier 2 even at 1 vs 2
    // counts (§04 h2.29 key 1 is strictness; counts never cross tiers).
    expect(rankMatches(s, "zsk").map((m) => m.key)).toEqual([
      "zsketch",
      "zendesk",
    ]);
  });

  it("tier-1 scattered matches stay invisible at the default, admit under a lowered threshold", () => {
    const s = new CandidateStore();
    put(s, "handleresponseproxy", 3);
    // The 'h' bucket IS scanned since T2.S2; the tier-1 score (59 — a
    // 2-char hole, one point under the line) is
    // what keeps it out at the default 60 — the gate, not the range.
    expect(rankMatches(s, "hrp")).toEqual([]);
    expect(
      rankMatches(s, "hrp", { fuzzThreshold: 0 }).map((m) => m.key),
    ).toEqual(["handleresponseproxy"]);
  });

  it("anchor holds: different-first-char keys are never scanned, never match", () => {
    const s = new CandidateStore();
    put(s, "zendesk", 4);
    put(s, "pzendesk", 9); // 9× the count — irrelevant: never in the 'z' bucket
    // 'zp' matches nothing: zendesk has no 'p' after the anchor, and
    // pzendesk lives in the 'p' bucket — the scan never leaves 'z'.
    expect(rankMatches(s, "zp", { fuzzThreshold: 0 })).toEqual([]);
  });

  it('empty fragment keeps the full-store listing through prefixRange("")', () => {
    const s = new CandidateStore();
    put(s, "alpha", 2);
    put(s, "beta", 1);
    // bucket "" → [0, n]: both keys, zero-fragment order (count desc →
    // shorter → lex), gate bypassed.
    expect(rankMatches(s, "").map((m) => m.key)).toEqual(["alpha", "beta"]);
  });
});

// ── Tier-1 gap-size retune (2026-10, spec §04) ──────────────────────────

describe("rankMatches — tier-1 single-skip admission (2026-10 gap-size retune)", () => {
  // Spec §04 retune: tier-1 is 70 − 5·gapRuns − min(3·gapChars, 15), so
  // hole SIZE slopes (62 / 59 / 56 / …) instead of the first
  // calibration's cliff (a flat 44 for every one-run-one-char trace,
  // below BOTH mode defaults). At ambient 60 exactly ONE scattered class
  // admits — the single 1-char interior hole. Motivating live report:
  // typing `del`/`delet` offered `delete` but `delt` showed NOTHING.

  const seed = (): CandidateStore => {
    const s = new CandidateStore();
    put(s, "delete", 2);
    put(s, "deliver");
    put(s, "handleresponseproxy");
    return s;
  };

  it("the motivating report: 'delt' → 'delete' admits at the ambient default (62 ≥ 60)", () => {
    const s = seed();
    // Greedy trace: e@1, l@2 consecutive; t skips exactly one char
    // ('e'@3) → gapRuns=1, gapChars=1 → 70 − 5 − min(3·1, 15) = 62.
    expect(matchFragment("delt", "delete")).toEqual({ tier: 1, score: 62 });
    expect(rankMatches(s, "delt").map((m) => m.key)).toEqual(["delete"]);
    expect(rankMatches(s, "delt", { fuzzThreshold: 62 })).toHaveLength(1); // == survives
    expect(rankMatches(s, "delt", { fuzzThreshold: 63 })).toEqual([]); // one above discards
    // Sibling shapes of the same class (one 1-char hole, 3–5 chars):
    expect(matchFragment("dlt", "delete")).toEqual({ tier: 1, score: 62 });
    expect(matchFragment("dlte", "delete")).toEqual({ tier: 1, score: 62 });
    expect(rankMatches(s, "dlt").map((m) => m.key)).toEqual(["delete"]);
  });

  it("'del'/'delet' are unchanged: tier-3 exact prefixes at 100 (tier-2 sibling 72)", () => {
    const s = seed();
    expect(matchFragment("del", "delete")).toEqual({ tier: 3, score: 100 });
    expect(matchFragment("delet", "delete")).toEqual({ tier: 3, score: 100 });
    // Both are also prefixes of nothing else in the 'd' bucket…
    expect(rankMatches(s, "delet").map((m) => m.key)).toEqual(["delete"]);
    // …while 'del' prefix-matches BOTH tier-3 words (count desc within
    // the tier: delete 2 > deliver 1).
    expect(rankMatches(s, "del").map((m) => m.key)).toEqual(["delete", "deliver"]);
    // The tier-2 sibling is untouched: 'det' skips 2 chars BEFORE a
    // contiguous 'et' run → round(85 − 40·2/6) = 72.
    expect(matchFragment("det", "delete")).toEqual({ tier: 2, score: 72 });
  });

  it("slope, not cliff: a 2-char hole gates ambient by one point (59 < 60)", () => {
    const s = seed();
    // 'hrp' → 'handleResponseProxy': one gap run of 2 chars ('es') →
    // 70 − 5 − min(3·2, 15) = 59. The retune's ambient line: one 1-char
    // hole admits (62), a 2-char hole does not — the drop from
    // contiguous (85) is now a slope (85 → 62 → 59), not the old
    // 85 → 44 cliff.
    expect(matchFragment("hrp", "handleResponseProxy")).toEqual({
      tier: 1,
      score: 59,
    });
    expect(rankMatches(s, "hrp")).toEqual([]); // 59 < 60 — gates at the default
  });

  it("deliberately sloppy fragments still gate ambient: two gaps score 54", () => {
    const s = seed();
    // 'dlvr' → 'deliver': l@2, then v skips 'i' (gap 1), then r skips
    // 'e' (gap 2) → gapRuns=2, gapChars=2 → 70 − 10 − 6 = 54 < 60.
    expect(matchFragment("dlvr", "deliver")).toEqual({ tier: 1, score: 54 });
    expect(rankMatches(s, "dlvr")).toEqual([]);
    // …but 54 ≥ 45: the `#` trigger mode still surfaces it (mode split).
    expect(
      rankMatches(s, "dlvr", { loose: true, fuzzThreshold: 45 }).map((m) => m.key),
    ).toEqual(["deliver"]);
  });
});

describe("rankMatches — loose mode (trigger loosening, spec §04 h2.28, plan 004)", () => {
  // Plan-004 erratum RETIRED by the 2026-10 gap-size retune: the first
  // calibration (50 − 5·gapRuns − gapChars) maxed tier-1 at 44 <
  // TRIGGER_FUZZ_THRESHOLD (45), so the spec's own '#cfg' →
  // 'config_manager_service' exemplar could never admit — a pinned
  // erratum, not the intended behavior. With gap-size scaling
  // (70 − 5·gapRuns − min(3·gapChars, 15), max 62) the exemplar finally
  // delivers at the trigger default, and the mode-differentiation
  // vector below (a tier-2 match scoring 58 ∈ [45, 60)) keeps proving
  // the ambient/trigger split.

  /** Shared store: anchored tier-3 words + a rule-4d path key whose only
   *  match path is tier-0 ('query' sits mid-key), plus the PRP's config/
   *  service word and the tier-2 differentiation vector. */
  const looseStore = (): CandidateStore => {
    const s = new CandidateStore();
    put(s, "queryplan");
    put(s, "queue", 2);
    s.upsert(
      sighting({ key: "src/core/query.ts", display: "src/core/query.ts" }),
    );
    s.upsert(
      sighting({
        key: "config_manager_service",
        display: "config_manager_service",
      }),
    );
    s.upsert(sighting({ key: "azzzzzzde", display: "azzzzzzde" }));
    return s;
  };

  it("'#query' loose: the tier-0 path key rides WITH non-empty anchored results", () => {
    const s = looseStore();
    const loose = rankMatches(s, "query", { loose: true, fuzzThreshold: 45 });
    expect(loose.map((m) => [m.key, m.tier])).toEqual([
      ["queryplan", 3],
      ["src/core/query.ts", 0],
    ]);
    // Ambient (no loose): anchored set alone — the latent tier-0 match
    // never merges (the zero-result precondition is kept for ambient).
    expect(rankMatches(s, "query").map((m) => m.key)).toEqual(["queryplan"]);
  });

  it("mode threshold split: a tier-2 scoring 58 admits loose-at-45, gates ambient-at-60", () => {
    const s = looseStore();
    // "ade" in "azzzzzzde": anchor 'a', tail "de" contiguous at index 7 →
    // tier 2, score = round(85 − 40·6/9) = 58 ∈ [45, 60).
    expect(matchFragment("ade", "azzzzzzde")).toEqual({ tier: 2, score: 58 });
    expect(
      rankMatches(s, "ade", { loose: true, fuzzThreshold: 45 }).map((m) => m.key),
    ).toEqual(["azzzzzzde"]);
    expect(rankMatches(s, "ade")).toEqual([]); // ambient 60 gates it
    // Loose is NOT a threshold discount: at 60 the record gates even loose.
    expect(rankMatches(s, "ade", { loose: true, fuzzThreshold: 60 })).toEqual([]);
  });

  it("'#cfg' delivers the §04 exemplar post-retune: 62 admits at the trigger default 45", () => {
    const s = looseStore();
    // One gap run of 1 char ('i' between f@3 and g@5) → 70 − 5 − 3 = 62.
    expect(matchFragment("cfg", "config_manager_service")).toEqual({
      tier: 1,
      score: 62,
    });
    expect(
      rankMatches(s, "cfg", { loose: true, fuzzThreshold: 45 }).map((m) => m.key),
    ).toEqual(["config_manager_service"]);
    // Boundary: exactly-at survives the strict gate; one above discards.
    expect(
      rankMatches(s, "cfg", { loose: true, fuzzThreshold: 62 }).map((m) => m.key),
    ).toEqual(["config_manager_service"]);
    expect(rankMatches(s, "cfg", { loose: true, fuzzThreshold: 63 })).toEqual([]);
  });

  it("dedup: a key matching anchored AND anchorless appears once — anchored wins", () => {
    const s = looseStore();
    const out = rankMatches(s, "que", { loose: true, fuzzThreshold: 45 });
    // "queue" is anchored tier-3 AND indexOf("que") === 0 — exactly one
    // record, carrying the anchored tier:
    expect(out.filter((m) => m.key === "queue")).toHaveLength(1);
    expect(out.map((m) => [m.key, m.tier])).toEqual([
      ["queue", 3],
      ["queryplan", 3],
      ["src/core/query.ts", 0],
    ]);
  });

  it("fragment floor holds under loose: a 2-char fragment runs no tier-0", () => {
    const s = looseStore();
    const out = rankMatches(s, "qu", { loose: true, fuzzThreshold: 45 });
    expect(out.map((m) => m.key)).toEqual(["queue", "queryplan"]); // anchored only
    expect(out.every((m) => m.tier !== 0)).toBe(true);
  });

  it("explicit fuzzThreshold overrides the trigger default under loose", () => {
    const s = looseStore();
    // 80 > 64: the tier-0 path key gates out; the tier-3 anchor survives —
    // loose widens WHICH passes run, never the admission gate itself.
    expect(
      rankMatches(s, "query", { loose: true, fuzzThreshold: 80 }).map((m) => [
        m.key,
        m.tier,
      ]),
    ).toEqual([["queryplan", 3]]);
  });
});
