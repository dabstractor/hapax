/**
 * PRD §04 query-ranking suite (P1.M2.T5.S1): the rankMatches contract —
 * case-insensitive prefix matching with stored display casing (h2.27),
 * the PRD §09 order (salience desc → shorter key → byte-lex) verified
 * with deliberate ties, the default limit 8 plus explicit/defensive
 * limits, the description "session x<count>" item contract, empty
 * results, recency re-ranking after the ordinal advances, an informal
 * perf sanity (20k store; formal gate is P1.M4.T1.S2), and the R1
 * ONE-WORD INVARIANT (PRD §07 h2.44): every returned display is a single
 * word, proven end-to-end through the REAL ingest pipeline (rankMatches
 * is words-only — `{ limit }` is its entire option surface; the former
 * caller-side filter seam was removed with the multi-word layer).
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
 * candidate loop, default-60-kills-tier-1, and the zero-fragment bypass
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
  TIER1_BASE_SCORE,
  TIER1_GAPCHAR_CAP,
  TIER1_GAPRUN_PENALTY,
  TIER2_BASE_SCORE,
  TIER2_SKIP_FACTOR,
  TIER3_SCORE,
} from "../src/core/query.js";
import { IngestPipeline } from "../src/pi/ingest.js";
import type { Sighting } from "../src/core/types.js";
import { buildDictBinary, writeDictFile } from "./helpers/dict-writer.js";
import { assertWordsOnly } from "./helpers/query-invariants.js";

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

/** Oracle: expected key order per the CONTENT-DERIVED menu order
 *  (shorter key → byte-lex) — the same math rankMatches must apply,
 *  applied independently here. Salience is NOT a sort key. */
const expectedOrder = (s: CandidateStore, prefix: string): string[] =>
  s
    .entries()
    .filter((c) => c.key.startsWith(prefix))
    .sort((a, b) =>
      a.key.length !== b.key.length
        ? a.key.length - b.key.length
        : a.key < b.key
          ? -1
          : a.key > b.key
            ? 1
            : 0,
    )
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

describe("rankMatches — ordering (content-derived: shorter key → byte-lex)", () => {
  it("length is the ONLY primary key: salience stats never reorder", () => {
    const s = new CandidateStore();
    put(s, "zaghigh", 3); // most salient by count — still sorts by text
    put(s, "zaglow", 1);
    put(s, "zagmid", 2);
    expect(rankMatches(s, "zag").map((m) => m.key)).toEqual([
      "zaglow", // len 6, byte l
      "zagmid", // len 6, byte m
      "zaghigh", // len 7 — longest despite top salience
    ]);
  });

  it("userTyped/sticky flags never reorder either — equal length → byte-lex", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "zagtyped", display: "zagtyped", fromUser: true }));
    s.upsert(sighting({ key: "zagplain", display: "zagplain" }));
    expect(rankMatches(s, "zag").map((m) => m.key)).toEqual([
      "zagplain",
      "zagtyped",
    ]);
  });

  it("shorter key first: 'fix' before 'fixpoint'", () => {
    const s = new CandidateStore();
    put(s, "fixpoint"); // upserted first on purpose — order must not care
    put(s, "fix", 1, 1, { rankGroup: 0 }); // rarest + highest salience — still just shorter
    expect(rankMatches(s, "fi").map((m) => m.key)).toEqual(["fix", "fixpoint"]);
  });

  it("equal-length tie → byte-lex: 'cod' before 'cow'", () => {
    const s = new CandidateStore();
    put(s, "cow", 9);
    put(s, "cod", 1); // reverse insertion + far lower salience — byte order still wins
    expect(rankMatches(s, "co").map((m) => m.key)).toEqual(["cod", "cow"]);
  });

  it("hand-computed mixed board sorts purely by (length, bytes)", () => {
    const s = new CandidateStore();
    put(s, "abstract"); // len 8
    put(s, "abort"); // len 5
    put(s, "zzqv", 1, 1, { rankGroup: 0 }); // len 4 — most salient, sorts 3rd
    s.upsert(sighting({ key: "meridian", display: "meridian", fromUser: true })); // len 8
    put(s, "verdant", 8); // len 7 — top salience, sorts mid-list
    put(s, "cod"); // len 3
    put(s, "cow"); // len 3
    expect(rankMatches(s, "").map((m) => m.key)).toEqual([
      "cod", // 3: c-o-d
      "cow", // 3: c-o-w
      "zzqv", // 4
      "abort", // 5
      "verdant", // 7
      "abstract", // 8: a-b…
      "meridian", // 8: m-e…
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

describe("rankMatches — ordinal interplay (salience carried, never sorted)", () => {
  it("after nextOrdinal advances + a fresh sighting, menu order is UNCHANGED (content-derived)", () => {
    const s = new CandidateStore();
    put(s, "oldnews", 3, 1);
    put(s, "fresh", 1, 1);
    expect(rankMatches(s, "").map((m) => m.key)).toEqual(["fresh", "oldnews"]);
    for (let i = 0; i < 80; i++) s.nextOrdinal(); // now = 81
    s.upsert(sighting({ key: "fresh", display: "fresh", ordinal: 81 }));
    // Recency/counts no longer reorder the menu: stable text order.
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
    // singular in its result set — the plural must still return.
    expect(rankMatches(s, "agen").map((m) => m.key)).toEqual(["agent"]);
    expect(rankMatches(s, "agents").map((m) => m.key)).toEqual(["agents"]);
  });

  it("\"ss\" and \"es\" forms never prune: glass stays, class/classes coexist", () => {
    const s = new CandidateStore();
    put(s, "glas", 1);
    put(s, "glass", 1); // ss-final — must survive even with glas present
    put(s, "class", 1);
    put(s, "classes", 1); // different key shape — not a single-s pair
    expect(rankMatches(s, "glas").map((m) => m.key)).toEqual(["glas", "glass"]);
    expect(rankMatches(s, "clas").map((m) => m.key)).toEqual(["class", "classes"]);
  });

  it("pruning runs BEFORE the limit slice — a pruned plural frees its slot", () => {
    const s = new CandidateStore();
    put(s, "plugged", 1); // len 7
    put(s, "plugin", 1); // len 6 — pairs with plugins
    put(s, "plugins", 1); // len 7
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
    // gapRuns=1, gapChars=2 → 50 − 5 − 2 = 43. (The PRP's "r@1, p@7, one
    // gap" trace miscounted the string; the landed trace is this one.)
    expect(matchFragment("hrp", "handleResponseProxy")).toEqual({
      tier: 1,
      score: 43,
    });
  });

  it("tier 1 — leading stretch never counts as a gap ('zds' → 'zendesk') = 44", () => {
    // d@3 (skips 'en' BEFORE the first tail char — free), s@5 (one gap
    // run of 1 char 'e'). gapRuns=1, gapChars=1 → 50 − 5 − 1 = 44.
    expect(matchFragment("zds", "zendesk")).toEqual({ tier: 1, score: 44 });
  });

  it("tier 1 — gapChars saturates at 15 and the score stays within [0, 100]", () => {
    // 'a' matches at 1 (no gap), 'y' at 18: one gap run of 16 chars →
    // min(16, 15) = 15 → 50 − 5 − 15 = 30. Saturation, not the raw 16.
    const c = "ha" + "x".repeat(16) + "y";
    const r = matchFragment("hay", c);
    expect(r).toEqual({ tier: 1, score: 30 });
    expect(r!.score).toBeGreaterThanOrEqual(0);
    expect(r!.score).toBeLessThanOrEqual(100);
  });

  it("tier 1 — '/ and .' are ordinary characters (path keys, rule 4d)", () => {
    expect(matchFragment("sr", "src/core/query.ts")).toEqual({ tier: 3, score: 100 });
    // 'r/co' is not contiguous in 'rc/core/query.ts' (cl[1..] = 'rc/…'):
    // greedy trace r@1 (free), '/'@3 (gap 1: 'c'), c@4, o@5 →
    // gapRuns=1, gapChars=1 → 50 − 5 − 1 = 44.
    expect(matchFragment("sr/co", "src/core/query.ts")).toEqual({
      tier: 1,
      score: 44,
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

  it("tier scores respect their bands: tier 3 = 100, tier 1 ≤ 50", () => {
    expect(matchFragment("z", "zendesk")!.score).toBe(100);
    for (const [f, c] of [
      ["hrp", "handleResponseProxy"],
      ["zds", "zendesk"],
      ["sr/co", "src/core/query.ts"],
      ["hay", "ha" + "x".repeat(16) + "y"],
    ] as const) {
      const r = matchFragment(f, c)!;
      expect(r.tier).toBe(1);
      expect(r.score).toBeLessThanOrEqual(50);
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Admission threshold — fuzzThreshold gating (PRD §04 h2.28, plan 003 S2) ──
//
// SCAN-SEQUENCING NOTE: today's rankMatches scans the store with
// prefixRange(fragment) — every scanned key is therefore an exact prefix
// (tier 3, score 100), and the §04 h2.28 gate can only bite for
// thresholds > 100 (exercised below to pin the comparison direction and
// the absent = DEFAULT_FUZZ_THRESHOLD semantics through the public seam).
// Tiers 2/1 become reachable through rankMatches when P1.M2.T2.S2
// generalizes the scan to the first-char bucket (r3 doc §8); the gate
// itself — its placement inside the candidate loop (BEFORE the push, so
// discarded candidates are never ranked), its strict score < threshold
// comparison, and its default — are landed HERE and pinned at the
// matcher/constants level, so T2.S2's activation is a one-line scan
// change with its evidence already in place.

describe("admission threshold — fuzzThreshold gating (PRD §04 h2.28, plan 003 S2)", () => {
  /** Keys with known matcher traces: zendesk (tier-2 probe 'zsk' → 62),
   *  z_lwlock (tier-2 'zlock' → 70 exactly), handleresponseproxy
   *  (tier-1 'hrp' → 43). */
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

    // Tier 1: score = BASE − GAPRUN_PENALTY·gapRuns − min(gapChars, CAP).
    // 'hrp'→'handleResponseProxy': greedy trace gives gapRuns=1,
    // gapChars=2 → 50 − 5 − 2 = 43.
    expect(matchFragment("hrp", "handleResponseProxy")).toEqual({
      tier: 1,
      score:
        TIER1_BASE_SCORE -
        TIER1_GAPRUN_PENALTY * 1 -
        Math.min(2, TIER1_GAPCHAR_CAP),
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

  it("absent fuzzThreshold ≡ DEFAULT_FUZZ_THRESHOLD (not 0) — and default 60 kills ALL tier-1 (spec-quoted)", () => {
    const s = seed();
    // SPEC (§04 h2.28): "At the default this admits every exact prefix
    // and strong contiguous tails … and gates out most scattered
    // matches." The arithmetic that makes the last clause true: tier-1's
    // MAXIMUM score is TIER1_BASE_SCORE (50 — every gap subtracts more),
    // strictly below the default 60, so NO scattered match can ever
    // survive the default gate. Do NOT "fix" this — it is the intended
    // calibration (r3 doc §7 feasibility).
    expect(DEFAULT_FUZZ_THRESHOLD).toBe(60); // the §08 h2.52 schema default; a §09 retune updates this pin deliberately
    expect(TIER1_BASE_SCORE).toBeLessThan(DEFAULT_FUZZ_THRESHOLD);
    // Empirically, every tier-1 trace in the matcher suite gates out:
    for (const [f, c] of [
      ["hrp", "handleResponseProxy"],
      ["zds", "zendesk"],
      ["sr/co", "src/core/query.ts"],
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
    // list every candidate in the (unchanged, content-derived) order.
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
