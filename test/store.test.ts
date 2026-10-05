/**
 * PRD §06 candidate-store suite (P1.M2.T4.S1): the h2.36 upsert contract
 * (absent → create, present → merge), the ordinal counter (monotonic from
 * 1; upsert never advances it — the pipeline owns assignment), casing
 * merging into one entry whose casing lives in the tallies (completion-
 * time resolution in query.ts; no stored display), sticky OR-in flags,
 * rankGroup min-on-merge, defensive entries()
 * snapshots, and the group histogram. Also the prefix index suite
 * (P1.M2.T4.S2): lazy dirty-flag rebuild, binary-searched prefix ranges
 * verified against brute force (20k keys + interleaved rounds), and the
 * lowercase-prefix caller contract. Finally the eviction suite
 * (P1.M2.T4.S3): the STORE_CAP hard cap with exactly-`needed` victim
 * counts, lowest-evictionScore victim choice, userTyped protection
 * (unless the cap can only be met from that pool), sub-words counting
 * toward the cap, and prefix-index consistency after removals.
 *
 * EVICTION BATCHING (PRD §06 h2.37 "Evict in batches of 256 … to
 * amortize cost"): every overflow pass rounds its victim count UP to a
 * whole EVICT_BATCH (bounded by the pool), so a pass runs at most once
 * per 256 new distinct keys while the post-eviction size stays within
 * the cap. The tests below pin both halves: the batch rounding (sizes
 * land at cap − batch + overflow) and the post-pass size bound.
 *
 * Sightings are fabricated inline per the types.ts contract — the store is
 * downstream of segment + shapeGate + score and takes their output on
 * faith; key strings are arbitrary lowercase.
 */

import { describe, expect, it } from "vitest";
import {
  CandidateStore,
  EVICT_BATCH,
  INDEX_MERGE_BATCH,
  STORE_CAP,
} from "../src/core/store.js";
import { evictionScore } from "../src/core/score.js";
import type { Sighting } from "../src/core/types.js";

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

describe("ordinal counter (PRD §06)", () => {
  it("currentOrdinal() is 0 on a fresh store", () => {
    expect(new CandidateStore().currentOrdinal()).toBe(0);
  });

  it("nextOrdinal() returns 1, 2, 3… strictly monotonic, never reset", () => {
    const s = new CandidateStore();
    expect(s.nextOrdinal()).toBe(1);
    expect(s.nextOrdinal()).toBe(2);
    expect(s.nextOrdinal()).toBe(3);
    expect(s.nextOrdinal()).toBe(4);
  });

  it("currentOrdinal() tracks the last issued ordinal", () => {
    const s = new CandidateStore();
    s.nextOrdinal();
    s.nextOrdinal();
    expect(s.currentOrdinal()).toBe(2);
  });

  it("upsert never advances the counter — the pipeline owns assignment", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ ordinal: 7 }));
    s.upsert(sighting({ ordinal: 9 }));
    expect(s.currentOrdinal()).toBe(0);
  });
});

describe("upsert — absent → create (PRD §06 h2.36)", () => {
  it("first sighting creates the exact Candidate and size is 1", () => {
    const s = new CandidateStore();
    s.upsert(
      sighting({
        key: "zzqv",
        display: "Zzqv",
        ordinal: 3,
        fromUser: true,
        casing: "mid-cap", // capitalized display → capitalized sighting
        properName: false,
        rankGroup: 0,
      }),
    );
    expect(s.size).toBe(1);
    expect(s.get("zzqv")).toEqual({
      key: "zzqv",
      capCount: 1, // mid-cap create: capitalized tally starts at 1
      lowerCount: 0,
      capDisplay: "Zzqv",
      sessionCount: 1,
      lastSeenOrdinal: 3,
      firstSeenOrdinal: 3,
      userTyped: true,
      properName: false,
      rankGroup: 0,
    });
  });

  it("firstSeenOrdinal === lastSeenOrdinal === sighting.ordinal at creation", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ ordinal: 42 }));
    const c = s.get("hapax")!;
    expect(c.firstSeenOrdinal).toBe(42);
    expect(c.lastSeenOrdinal).toBe(42);
  });

  it("fromUser maps to Candidate.userTyped at creation", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ fromUser: true }));
    expect(s.get("hapax")!.userTyped).toBe(true);
  });
});

describe("upsert — present → merge (PRD §06 h2.36)", () => {
  it("second sighting bumps sessionCount and lastSeenOrdinal; firstSeenOrdinal and size unchanged", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ ordinal: 5 }));
    s.upsert(sighting({ ordinal: 9 }));
    const c = s.get("hapax")!;
    expect(c.sessionCount).toBe(2);
    expect(c.lastSeenOrdinal).toBe(9);
    expect(c.firstSeenOrdinal).toBe(5);
    expect(s.size).toBe(1);
  });

  it("casing variants merge into one entry; the tallies accumulate (no stored display)", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "hapax", display: "hapax" }));
    s.upsert(sighting({ key: "hapax", display: "Hapax", casing: "mid-cap" }));
    expect(s.size).toBe(1); // casing variants merge into one entry
    expect(s.get("hapax")!.lowerCount).toBe(1);
    expect(s.get("hapax")!.capCount).toBe(1); // mid-cap sighting counted
    s.upsert(sighting({ key: "hapax", display: "HAPAX", casing: "mid-cap" }));
    expect(s.size).toBe(1);
    expect(s.get("hapax")!.capCount).toBe(2);
    expect(s.get("hapax")!.capDisplay).toBe("HAPAX"); // 1–1 mid-cap tie → most recent form
    // No display field exists: the insertion form is resolved at
    // completion time from these tallies (query.ts, spec 04 h2.32).
    expect(s.get("hapax")).not.toHaveProperty("display");
  });

  it("userTyped is OR-in sticky: false → true → false stays true", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ fromUser: false }));
    expect(s.get("hapax")!.userTyped).toBe(false);
    s.upsert(sighting({ fromUser: true }));
    expect(s.get("hapax")!.userTyped).toBe(true);
    s.upsert(sighting({ fromUser: false }));
    expect(s.get("hapax")!.userTyped).toBe(true);
  });

  it("properName is OR-in sticky: false → true → false stays true", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ properName: false }));
    expect(s.get("hapax")!.properName).toBe(false);
    s.upsert(sighting({ properName: true }));
    expect(s.get("hapax")!.properName).toBe(true);
    s.upsert(sighting({ properName: false }));
    expect(s.get("hapax")!.properName).toBe(true);
  });

  it("rankGroup takes the min: 2 → 1 keeps 1; a later 2 does not un-rare it", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ rankGroup: 2 }));
    expect(s.get("hapax")!.rankGroup).toBe(2);
    s.upsert(sighting({ rankGroup: 1 }));
    expect(s.get("hapax")!.rankGroup).toBe(1);
    s.upsert(sighting({ rankGroup: 2 }));
    expect(s.get("hapax")!.rankGroup).toBe(1);
  });

  it("merge never resets counts: three sightings → sessionCount 3", () => {
    const s = new CandidateStore();
    for (const ord of [10, 11, 12]) s.upsert(sighting({ ordinal: ord }));
    const c = s.get("hapax")!;
    expect(c.sessionCount).toBe(3);
    expect(c.firstSeenOrdinal).toBe(10);
    expect(c.lastSeenOrdinal).toBe(12);
  });
});

describe("path merge (rule 4d: key trimmed — edge variants are ONE entry)", () => {
  // Rule 4d (spec/04:118-174): a path sighting's key is the trimmed
  // lowercase form while the sighting's raw text keeps the ORIGINAL
  // edges — so the same path re-typed with a different edge style must
  // still merge into ONE entry (the key space decides identity). The
  // stored entry carries no display: the insertion form is resolved at
  // completion time (spec 04 h2.32) from the tallies + live fragment.
  const KEY = "home/dustin/projects/hapax";

  it("edge-variant sightings of one path merge to one entry", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: KEY, display: `/${KEY}`, ordinal: 5 }));
    s.upsert(sighting({ key: KEY, display: `${KEY}/`, ordinal: 9 }));
    expect(s.size).toBe(1); // leading-/ and trailing-/ map to ONE key
    const c = s.get(KEY)!;
    expect(c.sessionCount).toBe(2);
    expect(c.lastSeenOrdinal).toBe(9);
    expect(c.firstSeenOrdinal).toBe(5); // merge semantics keep the origin
    expect(c).not.toHaveProperty("display"); // completion-time resolution owns casing
  });

  it("reverse insertion order still merges to one entry (trailing-/ first)", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: KEY, display: `${KEY}/`, ordinal: 3 }));
    s.upsert(sighting({ key: KEY, display: `/${KEY}`, ordinal: 4 }));
    expect(s.size).toBe(1);
    expect(s.get(KEY)!.lastSeenOrdinal).toBe(4);
  });

  it("firstSeenOrdinal stays at the first sighting across edge variants", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: KEY, display: `/${KEY}`, ordinal: 2 }));
    s.upsert(sighting({ key: KEY, display: KEY, ordinal: 6 }));
    s.upsert(sighting({ key: KEY, display: `${KEY}/`, ordinal: 7 }));
    const c = s.get(KEY)!;
    expect(c.firstSeenOrdinal).toBe(2);
    expect(c.sessionCount).toBe(3);
  });
});

describe("get / size / entries (PRD §06)", () => {
  it("get() miss returns undefined; fresh size is 0", () => {
    const s = new CandidateStore();
    expect(s.get("nothing")).toBeUndefined();
    expect(s.size).toBe(0);
  });

  it("entries() returns a defensive copy — mutating it leaves the store intact", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ ordinal: 1 }));
    const snapshot = s.entries();
    expect(snapshot).toHaveLength(s.size);
    snapshot[0].sessionCount = 999;
    snapshot[0].capCount = 999;
    expect(s.get("hapax")!.sessionCount).toBe(1);
    expect(s.get("hapax")!.capCount).toBe(0);
    // A fresh snapshot taken after the mutation reflects the true state.
    expect(s.entries()[0].sessionCount).toBe(1);
  });

  it("a snapshot taken before later upserts is not mutated by them", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ ordinal: 1 }));
    const snapshot = s.entries();
    s.upsert(sighting({ ordinal: 2, display: "Hapax", casing: "mid-cap" }));
    expect(snapshot[0].sessionCount).toBe(1);
    expect(snapshot[0].capCount).toBe(0); // snapshot frozen before the mid-cap sighting
    expect(s.entries()[0].capCount).toBe(1);
    expect(s.entries()[0].sessionCount).toBe(2);
  });
});

describe("rankGroupHistogram (PRD §06)", () => {
  it("counts entries per group over current entries", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "a", rankGroup: 0 })); // group 0 ×1
    s.upsert(sighting({ key: "b", rankGroup: 1 })); // group 1 ×2
    s.upsert(sighting({ key: "c", rankGroup: 1 }));
    s.upsert(sighting({ key: "d", rankGroup: 2 })); // group 2 ×2
    s.upsert(sighting({ key: "e", rankGroup: 2 }));
    expect(s.rankGroupHistogram()).toEqual({ 0: 1, 1: 2, 2: 2 });
  });

  it("a merge that lowers rankGroup moves the entry between buckets", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "a", rankGroup: 2 }));
    s.upsert(sighting({ key: "b", rankGroup: 2 }));
    s.upsert(sighting({ key: "a", rankGroup: 0 })); // min-on-merge → 0
    expect(s.rankGroupHistogram()).toEqual({ 0: 1, 1: 0, 2: 1 });
  });

  it("empty store → all three keys present at 0 (never undefined)", () => {
    expect(new CandidateStore().rankGroupHistogram()).toEqual({ 0: 0, 1: 0, 2: 0 });
  });
});

describe("prefix index (PRD §06 h2.35)", () => {
  /** Brute-force oracle: the exact sorted keys that should match a prefix,
   *  derived from entries() — independent of the index implementation. */
  const expectedMatches = (s: CandidateStore, prefix: string): string[] =>
    s.entries()
      .map((c) => c.key)
      .sort()
      .filter((k) => k.startsWith(prefix));

  /** Exactness check: [start, end) must slice the snapshot to exactly the
   *  brute-force matches, with no prefix match just outside the bounds. */
  const expectRangeExact = (s: CandidateStore, prefix: string): void => {
    const expected = expectedMatches(s, prefix);
    const [start, end] = s.prefixRange(prefix);
    const snap = s.sortedKeysSnapshot();
    expect(snap.slice(start, end)).toEqual(expected);
    if (start > 0) expect(snap[start - 1].startsWith(prefix)).toBe(false);
    if (end < snap.length) expect(snap[end].startsWith(prefix)).toBe(false);
  };

  it("a NEW key dirties the index; the next query rebuilds (insert never sorts)", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "alpha" }));
    s.upsert(sighting({ key: "beta" }));
    expect(s.prefixRange("al")).toEqual([0, 1]); // covers only "alpha"
    expect(s.sortedKeysSnapshot()).toEqual(["alpha", "beta"]);
    s.upsert(sighting({ key: "alpine" })); // new key → dirty
    // Snapshot still shows the pre-insert rebuild: upsert did NOT sort.
    expect(s.sortedKeysSnapshot()).toEqual(["alpha", "beta"]);
    // Next query rebuilds once — "alpha" and "alpine" are now adjacent.
    expect(s.prefixRange("al")).toEqual([0, 2]);
    expect(s.sortedKeysSnapshot()).toEqual(["alpha", "alpine", "beta"]);
  });

  it("merge-only upserts do not dirty the index — no rebuild, ranges stay correct", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "alpha" }));
    s.upsert(sighting({ key: "alpine" }));
    s.upsert(sighting({ key: "beta" }));
    s.prefixRange("al"); // rebuild → snapshot current
    const before = s.sortedKeysSnapshot();
    s.upsert(sighting({ key: "alpha", ordinal: 2 })); // merge, no new key
    s.upsert(sighting({ key: "alpine", ordinal: 3 })); // merge
    // Merges left the index untouched (same rebuild, byte order intact).
    expect(s.sortedKeysSnapshot()).toEqual(before);
    expect(s.prefixRange("al")).toEqual([0, 2]);
    expectRangeExact(s, "al");
  });

  it("no matching keys → empty [n, n] range", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "alpha" }));
    s.upsert(sighting({ key: "beta" }));
    expect(s.prefixRange("zzz")).toEqual([2, 2]);
    expect(s.prefixRange("b")).toEqual([1, 2]); // sanity: a real match works
  });

  it("empty store → [0, 0]", () => {
    expect(new CandidateStore().prefixRange("a")).toEqual([0, 0]);
  });

  it('empty prefix "" → [0, size] (every key starts with "")', () => {
    const s = new CandidateStore();
    for (const k of ["cod", "dog", "cat"]) s.upsert(sighting({ key: k }));
    expect(s.prefixRange("")).toEqual([0, 3]);
  });

  it("unsorted insertion still yields contiguous, byte-ordered ranges", () => {
    const s = new CandidateStore();
    for (const k of ["dog", "cat", "cow", "cod"]) s.upsert(sighting({ key: k }));
    // Sorted: ["cat","cod","cow","dog"] — "co" covers exactly cod,cow.
    expect(s.prefixRange("co")).toEqual([1, 3]);
    expect(s.sortedKeysSnapshot().slice(1, 3)).toEqual(["cod", "cow"]);
  });

  it("a prefix reaching the array end returns end === length (valid)", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "xy" }));
    s.upsert(sighting({ key: "xyz" }));
    expect(s.prefixRange("xyz")).toEqual([1, 2]); // end == length
    expect(s.prefixRange("xy")).toEqual([0, 2]);
  });

  it("20k synthetic keys: ranges exact vs brute force; rebuild once, then steady state", () => {
    const s = new CandidateStore();
    // Unique lowercase keys, mixed lengths 5–12 (base36, zero-padded).
    const key = (i: number): string => "w" + i.toString(36).padStart(4 + (i % 8), "0");
    for (let i = 0; i < 20_000; i++) s.upsert(sighting({ key: key(i) }));
    for (const p of ["w0", "w1", "wz", "wf3", "w1234", "wzzzz"]) expectRangeExact(s, p);
    // No new inserts between queries → index clean → consistent results.
    expect(s.prefixRange("w0")).toEqual(s.prefixRange("w0"));
    // One more new key → next query's rebuild keeps results exact.
    s.upsert(sighting({ key: "wzzzzzzzztop" }));
    expectRangeExact(s, "wzzzzz");
    expectRangeExact(s, "w0");
  });

  it("interleaved insert/query rounds stay exact regardless of dirty state", () => {
    const s = new CandidateStore();
    const chars = "abcdefghijklmnopqrstuvwxyz";
    const randKey = (): string => {
      const len = 3 + Math.floor(Math.random() * 6); // lengths 3–8
      let k = "";
      for (let j = 0; j < len; j++) k += chars[Math.floor(Math.random() * 26)];
      return k;
    };
    for (let round = 0; round < 20; round++) {
      for (let i = 0; i < 50; i++) {
        s.upsert(sighting({ key: randKey(), ordinal: round * 50 + i }));
      }
      expectRangeExact(s, "a");
      expectRangeExact(s, "q");
      expectRangeExact(s, "zz");
      // A merge while the index may be dirty: must not corrupt anything.
      s.upsert(sighting({ key: s.entries()[0]!.key, ordinal: 9999 }));
      expectRangeExact(s, "b");
    }
  });

  it("uppercase prefix is a caller bug — throws RangeError", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "alpha" }));
    expect(() => s.prefixRange("Al")).toThrow(RangeError);
    expect(() => s.prefixRange("ALPHA")).toThrow(RangeError);
  });

  it("sortedKeysSnapshot reflects the last rebuild and is defensively copied", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "beta" }));
    s.upsert(sighting({ key: "alpha" }));
    expect(s.prefixRange("a")).toEqual([0, 1]); // triggers the rebuild
    expect(s.sortedKeysSnapshot()).toEqual([...s.entries().map((c) => c.key)].sort());
    const snap = s.sortedKeysSnapshot();
    snap.push("MUTATED");
    snap[0] = "MUTATED";
    expect(s.sortedKeysSnapshot()).toEqual(["alpha", "beta"]); // store unaffected
  });
});

// ── Eviction (P1.M2.T4.S3, PRD §06 h2.37 / §05 h2.33) ─────────────────────

describe("eviction (PRD §06 h2.37 / §05 h2.33)", () => {
  /** "w00042"-style keys: fixed width so byte order == insertion order. */
  const padded = (i: number): string => String(i).padStart(5, "0");

  it("exports the baked constants (PRD §08 h2.47)", () => {
    expect(STORE_CAP).toBe(20_000);
    expect(EVICT_BATCH).toBe(256);
  });

  it("20,001 inserts → exactly one eviction pass (a full 256 batch), size back within the cap", () => {
    const s = new CandidateStore();
    for (let i = 0; i <= STORE_CAP; i++) {
      // One sighting per message, like ingest: the store's own counter
      // supplies ascending ordinals (pipeline shape).
      s.upsert(
        sighting({ key: `w${padded(i)}`, ordinal: s.nextOrdinal(), rankGroup: 0 }),
      );
    }
    // One overflow pass, batch-rounded (§06 h2.37): 20,001 − 256 = 19,745.
    expect(s.size).toBe(STORE_CAP - EVICT_BATCH + 1);
    // w00000: seen at ordinal 1, never again — oldest lastSeenOrdinal,
    // sessionCount 1, no bonuses → strictly lowest evictionScore. Scores
    // are age-ordered with no ties, so the batch takes the 256 oldest
    // keys: w00000..w00255.
    expect(s.get("w00000")).toBeUndefined();
    expect(s.get(`w${padded(EVICT_BATCH - 1)}`)).toBeUndefined();
    expect(s.get(`w${padded(EVICT_BATCH)}`)).toBeDefined();
    expect(s.get(`w${padded(STORE_CAP)}`)).toBeDefined();
  });

  it("evicts the lowest evictionScore, not the alphabetically-first key", () => {
    const s = new CandidateStore();
    const ord = s.nextOrdinal(); // one message → Δordinal 0 at eviction
    // k00000..k00299 at sessionCount 4 (salience 2·log2(5) + 3 ≈ 7.64),
    // the rest at sessionCount 3 (2·log2(4) + 3 = 7); "zzz" alone at
    // sessionCount 1 → 5. Strictly lowest score, and alphabetically
    // LAST — a byte-order tie-break would have picked k00300 first, so
    // this proves the sort drives eviction. The batch (256 victims)
    // then fills with the byte-lowest score-7 keys, k00300..k00554.
    for (let i = 0; i < STORE_CAP; i++) {
      const key = `k${padded(i)}`;
      const times = i < 300 ? 4 : 3;
      for (let t = 0; t < times; t++) s.upsert(sighting({ key, ordinal: ord }));
    }
    s.upsert(sighting({ key: "zzz", ordinal: ord })); // #20,001 → overflow pass
    expect(s.size).toBe(STORE_CAP - EVICT_BATCH + 1);
    expect(s.get("zzz")).toBeUndefined(); // strictly lowest score went first
    expect(s.get("k00000")).toBeDefined(); // NOT byte order
    expect(s.get("k00299")).toBeDefined();
    expect(s.get("k00300")).toBeUndefined(); // batch fill: byte-first score-7
    expect(s.get("k00554")).toBeUndefined();
    expect(s.get("k00555")).toBeDefined();
  });

  it("userTyped survives even when it has the strictly lowest score", () => {
    const s = new CandidateStore();
    for (let i = 0; i < 11; i++) s.nextOrdinal(); // "now" = 11 at eviction
    // "aaa": userTyped, oldest (Δ = 10), no rarity bonus →
    // (2 + 3·e^(-0.5) + 1.5)·e^(-0.2) ≈ 4.36, strictly below every
    // regular key's (2 + 3 + 1.0)·e^0 = 6. Alphabetically FIRST, too —
    // only the userTyped protection keeps it in the store.
    s.upsert(sighting({ key: "aaa", ordinal: 1, fromUser: true }));
    for (let i = 0; i < STORE_CAP; i++) {
      s.upsert(sighting({ key: `k${padded(i)}`, ordinal: 11, rankGroup: 0 }));
    } // #20,001 → overflow pass, batch-rounded to 256 victims
    const now = s.currentOrdinal();
    expect(evictionScore(s.get("aaa")!, now)).toBeLessThan(
      evictionScore(s.get("k00256")!, now),
    );
    expect(s.size).toBe(STORE_CAP - EVICT_BATCH + 1);
    expect(s.get("aaa")).toBeDefined(); // protection, not score, kept it
    expect(s.get("k00000")).toBeUndefined(); // the non-userTyped batch went,
    expect(s.get("k00255")).toBeUndefined(); // Δ = 0 ties → byte order
    expect(s.get("k00256")).toBeDefined();
  });

  it("userTyped-only overflow still trims: the hard cap wins", () => {
    const s = new CandidateStore();
    const ord = s.nextOrdinal();
    for (let i = 0; i <= STORE_CAP; i++) {
      s.upsert(
        sighting({
          key: `u${padded(i)}`,
          ordinal: ord,
          fromUser: true,
          // u00000 gets no rarity bonus → strictly lowest userTyped score.
          rankGroup: i === 0 ? 2 : 0,
        }),
      );
    }
    expect(s.size).toBe(STORE_CAP - EVICT_BATCH + 1);
    expect(s.get("u00000")).toBeUndefined(); // strictly lowest userTyped score…
    expect(s.get("u00255")).toBeUndefined(); // …batch filled by byte ties
    expect(s.get("u00256")).toBeDefined();
  });

  it("mixed store at scale: overflow victims are never userTyped", () => {
    const s = new CandidateStore();
    const ord = s.nextOrdinal();
    // Regular keys score 2 + 3 + 1.0 = 6; userTyped keys 2 + 3 + 1.5 = 6.5
    // (Δ = 0 for all, no underflow) — the two victims must be regular.
    for (let i = 0; i < 10_002; i++) {
      s.upsert(sighting({ key: `k${padded(i)}`, ordinal: ord, rankGroup: 0 }));
    }
    for (let i = 0; i < 10_000; i++) {
      s.upsert(sighting({ key: `u${padded(i)}`, ordinal: ord, fromUser: true }));
    } // 20,002 total → overflow 2, batch-rounded to 256 victims
    expect(s.size).toBe(20_002 - EVICT_BATCH);
    expect(s.get("k00000")).toBeUndefined(); // victims regular only —
    expect(s.get("k00255")).toBeUndefined(); // …byte order among the ties
    expect(s.get("k00256")).toBeDefined();
    expect(s.entries().filter((c) => c.userTyped)).toHaveLength(10_000);
  });

  it("removals keep the prefix index consistent (S2 interplay)", () => {
    const s = new CandidateStore();
    const ord = s.nextOrdinal();
    for (let i = 0; i < STORE_CAP; i++) {
      s.upsert(sighting({ key: `ev${padded(i)}`, ordinal: ord, rankGroup: 0 }));
    }
    expect(s.prefixRange("ev")).toEqual([0, STORE_CAP]); // clean rebuild
    s.upsert(
      sighting({ key: `ev${padded(STORE_CAP)}`, ordinal: ord, rankGroup: 0 }),
    );
    expect(s.size).toBe(STORE_CAP - EVICT_BATCH + 1); // batch pass: 256 victims
    expect(s.get("ev00000")).toBeUndefined(); // evicted (score tie → byte)
    expect(s.get("ev00255")).toBeUndefined();
    expect(s.get("ev00256")).toBeDefined();
    const [start, end] = s.prefixRange("ev"); // rebuilt after the removals
    expect(end - start).toBe(s.size);
    expect(s.sortedKeysSnapshot()).not.toContain("ev00000");
  });

  it("candidates count toward the cap and evict identically (2026-10: every candidate is a whole token)", () => {
    const s = new CandidateStore();
    const ord = s.nextOrdinal();
    for (let i = 0; i <= STORE_CAP; i++) {
      s.upsert(
        sighting({
          key: `w${padded(i)}`,
          ordinal: ord,
          rankGroup: 0,
        }),
      );
    }
    expect(s.size).toBe(STORE_CAP - EVICT_BATCH + 1);
    // w00000..w00255 went — victims on both sides of the ledger:
    // no special casing in either direction.
    expect(s.get("w00000")).toBeUndefined();
    expect(s.get("w00002")).toBeUndefined();
    expect(s.get("w00003")).toBeUndefined();
    expect(s.get("w00256")).toBeDefined();
    expect(s.get("w00257")).toBeDefined();
  });
});

// ── casing tallies (spec 06 h2.41/h2.43, plan 006) ─────────────────────────

describe("casing tallies — create per class (spec 06 h2.43)", () => {
  it("lower create: zero tallies, no capDisplay", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ casing: "lower" }));
    expect(s.get("hapax")).toEqual({
      key: "hapax",
      capCount: 0,
      lowerCount: 1,
      capDisplay: "",
      sessionCount: 1,
      lastSeenOrdinal: 1,
      firstSeenOrdinal: 1,
      userTyped: false,
      properName: false,
      rankGroup: 2,
    });
  });

  it("mid-cap create: capCount 1, capDisplay set, no structural residue", () => {
    const s = new CandidateStore();
    s.upsert(
      sighting({ key: "zzqv", display: "Zzqv", casing: "mid-cap" }),
    );
    expect(s.get("zzqv")).toEqual({
      key: "zzqv",
      capCount: 1,
      lowerCount: 0,
      capDisplay: "Zzqv",
      sessionCount: 1,
      lastSeenOrdinal: 1,
      firstSeenOrdinal: 1,
      userTyped: false,
      properName: false,
      rankGroup: 2,
    });
  });

  it("structural-cap create: counts toward capCount but NEVER capDisplay", () => {
    const s = new CandidateStore();
    s.upsert(
      sighting({
        key: "check",
        display: "Check",
        casing: "structural-cap",
      }),
    );
    expect(s.get("check")).toEqual({
      key: "check",
      capCount: 1,
      lowerCount: 0,
      capDisplay: "",
      structuralCapCount: 1,
      sessionCount: 1,
      lastSeenOrdinal: 1,
      firstSeenOrdinal: 1,
      userTyped: false,
      properName: false,
      rankGroup: 2,
    });
  });
});

describe("casing tallies — mid-cap accumulation and capDisplay argmax", () => {
  it("majority form leads; a later majority flips capDisplay", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ display: "Zendesk", casing: "mid-cap" }));
    s.upsert(
      sighting({ display: "Zendesk", casing: "mid-cap", ordinal: 2 }),
    );
    s.upsert(
      sighting({ display: "ZENDESK", casing: "mid-cap", ordinal: 3 }),
    );
    expect(s.get("hapax")!.capCount).toBe(3);
    expect(s.get("hapax")!.capDisplay).toBe("Zendesk"); // 2–1 majority
    s.upsert(
      sighting({ display: "ZENDESK", casing: "mid-cap", ordinal: 4 }),
    );
    s.upsert(
      sighting({ display: "ZENDESK", casing: "mid-cap", ordinal: 5 }),
    );
    expect(s.get("hapax")!.capDisplay).toBe("ZENDESK"); // 2–2 tie → most recent
  });

  it("tie → the most recent sighting's form wins", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ display: "Abc", casing: "mid-cap" }));
    s.upsert(sighting({ display: "ABC", casing: "mid-cap", ordinal: 2 }));
    expect(s.get("hapax")!.capDisplay).toBe("ABC"); // 1–1 tie → latest
    s.upsert(sighting({ display: "Abc", casing: "mid-cap", ordinal: 3 }));
    expect(s.get("hapax")!.capDisplay).toBe("Abc"); // flip back on the re-tie
  });
});

describe("casing tallies — structural-cap conditionality (twin suppression)", () => {
  it("structural sightings accumulate while no lowercase exists (capDisplay stays empty)", () => {
    const s = new CandidateStore();
    for (const ordinal of [1, 2, 3]) {
      s.upsert(
        sighting({
          display: "Check",
          casing: "structural-cap",
          ordinal,
        }),
      );
    }
    expect(s.get("hapax")!.capCount).toBe(3);
    expect(s.get("hapax")!.lowerCount).toBe(0);
    expect(s.get("hapax")!.capDisplay).toBe(""); // structural never competes
  });

  it("PERMANENCE: the first lowercase sighting purges structural contributions forever", () => {
    const s = new CandidateStore();
    for (const ordinal of [1, 2, 3]) {
      s.upsert(
        sighting({
          display: "Check",
          casing: "structural-cap",
          ordinal,
        }),
      );
    }
    s.upsert(sighting({ display: "check", casing: "lower", ordinal: 4 }));
    expect(s.get("hapax")!.capCount).toBe(0); // 3 structural removed wholesale
    expect(s.get("hapax")!.lowerCount).toBe(1);
    // A later structural sighting NEVER contributes again.
    s.upsert(
      sighting({ display: "Check", casing: "structural-cap", ordinal: 5 }),
    );
    expect(s.get("hapax")!.capCount).toBe(0);
    expect(s.get("hapax")!.capDisplay).toBe("");
    // Mid-cap after lowercase still counts (only structural is suppressed).
    s.upsert(
      sighting({ display: "Check", casing: "mid-cap", ordinal: 6 }),
    );
    expect(s.get("hapax")!.capCount).toBe(1);
    expect(s.get("hapax")!.capDisplay).toBe("Check");
  });

  it("structural after lowercase: dropped from tallies only — occurrence bookkeeping intact", () => {
    const s = new CandidateStore();
    s.upsert(
      sighting({ key: "word", display: "word", casing: "lower", ordinal: 1 }),
    );
    s.upsert(
      sighting({
        key: "word",
        display: "Word",
        casing: "structural-cap",
        ordinal: 2,
        fromUser: true,
      }),
    );
    const c = s.get("word")!;
    expect(c.capCount).toBe(0); // tally untouched…
    expect(c.lowerCount).toBe(1);
    expect(c.sessionCount).toBe(2); // …but BOTH casings count occurrences
    expect(c.capDisplay).toBe(""); // structural form never becomes capDisplay (suppressed post-lowercase)
    expect(c.userTyped).toBe(true); // sticky OR-ins intact
  });

  it("mid-cap tallies count even after lowercase; capDisplay keeps the capitalized form", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ display: "foo", casing: "lower" }));
    s.upsert(
      sighting({ display: "Foo", casing: "mid-cap", ordinal: 2 }),
    );
    expect(s.get("hapax")!.capCount).toBe(1); // mid-cap ALWAYS counts (only structural is conditional)
    expect(s.get("hapax")!.capDisplay).toBe("Foo");
    s.upsert(sighting({ display: "foo", casing: "lower", ordinal: 3 }));
    expect(s.get("hapax")!.lowerCount).toBe(2);
    expect(s.get("hapax")!.capDisplay).toBe("Foo"); // 1–1 capCount vs lowerCount tie → frequency branch resolves to key at query time
  });

  it("merge regression: rankGroup min + userTyped stickiness compose with tallies", () => {
    const s = new CandidateStore();
    s.upsert(
      sighting({
        casing: "mid-cap",
        display: "Hapax",
        rankGroup: 2,
        fromUser: true,
      }),
    );
    s.upsert(
      sighting({
        casing: "lower",
        rankGroup: 0,
        ordinal: 2,
      }),
    );
    const c = s.get("hapax")!;
    expect(c.rankGroup).toBe(0); // min merge
    expect(c.userTyped).toBe(true); // sticky
    expect(c.capCount).toBe(1); // mid-cap tally survives the merge
    expect(c.lowerCount).toBe(1);
    expect(c.sessionCount).toBe(2);
  });
});

describe("casing tallies — #capForms eviction sync", () => {
  it("evicted keys leave no stale form counts behind on re-create", () => {
    const s = new CandidateStore();
    const padded = (i: number): string => String(i).padStart(5, "0");
    // "aa" is the FIRST insert → strictly lowest eviction score → certain
    // first-batch victim. Its mid-cap form tally must die with it.
    s.upsert(sighting({ key: "aa", display: "Aa", casing: "mid-cap", rankGroup: 0 }));
    s.upsert(sighting({ key: "aa", display: "Aa", casing: "mid-cap", ordinal: 2, rankGroup: 0 }));
    s.upsert(sighting({ key: "aa", display: "Aa", casing: "mid-cap", ordinal: 3, rankGroup: 0 }));
    for (let i = 0; i <= STORE_CAP; i++) {
      s.upsert(
        sighting({
          key: `w${padded(i)}`,
          ordinal: s.nextOrdinal(),
          casing: "lower",
          rankGroup: 0,
        }),
      );
    }
    expect(s.get("aa")).toBeUndefined(); // evicted (oldest, lowest score)
    // Re-create the key: fresh tallies — a stale {Aa: 3} would keep
    // capDisplay on "Aa" through the AA bump (4 ≥ 2), while fresh counts
    // hand capDisplay to "AA" (1–2 majority).
    s.upsert(sighting({ key: "aa", display: "Aa", casing: "mid-cap", rankGroup: 0 }));
    s.upsert(sighting({ key: "aa", display: "AA", casing: "mid-cap", ordinal: s.currentOrdinal() + 1, rankGroup: 0 }));
    s.upsert(sighting({ key: "aa", display: "AA", casing: "mid-cap", ordinal: s.currentOrdinal() + 2, rankGroup: 0 }));
    expect(s.get("aa")!.capDisplay).toBe("AA");
    expect(s.get("aa")!.capCount).toBe(3); // fresh: 1 + 2, not 3 stale + 3
  });
});

// ── reset() — branch-purity drop (spec 06 h2.42 / P2.M1.T1.S1) ─────────────

/**
 * Scripted mixed ingest sequence S, public API ONLY — the exact replay
 * chain the session_tree handler will use (nextOrdinal per fake message,
 * upserts with that ordinal, then recordBigramRuns; recordBigramRuns
 * reads currentOrdinal() inside). Ingredients (spec 06 h2.42: the purity
 * equivalence only proves what the sequence exercises):
 *   - all three casing classes; twin suppression (structural-cap then
 *     lower — capCount collapses via the pending-structural counter);
 *   - multi-form mid-cap argmax incl. a 2–2 tie resolved by recency
 *     (the #capForms side-map evidence);
 *   - userTyped (fromUser) + properName stickiness; rankGroup min-merge;
 *   - ordinal gaps (a nextOrdinal() with no upserts);
 *   - repeated bigrams (count > 1, within and across messages);
 *   - top-3 successor displacement (a 4th distinct successor drops);
 *   - INDEX_MERGE_BATCH + 44 distinct keys (a consolidation fires
 *     mid-replay) with a sub-batch #pending tail left at the end — both
 *     stores must lag identically.
 */
function applySeq(s: CandidateStore): void {
  let o = s.nextOrdinal(); // message 1: casing classes + flags + bigrams
  s.upsert(sighting({ key: "hapax", ordinal: o, casing: "lower", rankGroup: 2 }));
  s.upsert(
    sighting({
      key: "zorpwibble",
      display: "ZorpWibble",
      ordinal: o,
      casing: "mid-cap",
      rankGroup: 1,
      properName: true,
    }),
  );
  s.upsert(
    sighting({
      key: "typed",
      ordinal: o,
      casing: "lower",
      rankGroup: 0,
      fromUser: true,
    }),
  );
  s.upsert(
    sighting({
      key: "twins",
      display: "Twins",
      ordinal: o,
      casing: "structural-cap",
      rankGroup: 2,
    }),
  );
  s.recordBigramRuns([["hapax", "zorpwibble"], ["zorpwibble", "typed"]]);

  o = s.nextOrdinal(); // message 2: twin suppression + rankGroup min-merge
  s.upsert(
    sighting({ key: "twins", display: "Twins", ordinal: o, casing: "lower", rankGroup: 2 }),
  );
  s.upsert(sighting({ key: "hapax", ordinal: o, casing: "lower", rankGroup: 0 }));
  s.upsert(
    sighting({ key: "vendor", display: "Vendor", ordinal: o, casing: "mid-cap", rankGroup: 2 }),
  );
  s.recordBigramRuns([["typed", "twins"], ["twins", "vendor"]]);

  o = s.nextOrdinal(); // message 3: multi-form argmax, tie → recency
  s.upsert(
    sighting({ key: "vendor", display: "VENDOR", ordinal: o, casing: "mid-cap", rankGroup: 2 }),
  );
  s.upsert(
    sighting({ key: "vendor", display: "Vendor", ordinal: o, casing: "mid-cap", rankGroup: 2 }),
  );
  s.upsert(
    sighting({ key: "vendor", display: "VENDOR", ordinal: o, casing: "mid-cap", rankGroup: 2 }),
  );
  s.recordBigramRuns([["vendor", "hub"]]);

  o = s.nextOrdinal(); // message 4: successor displacement begins
  s.upsert(sighting({ key: "hub", ordinal: o, casing: "lower", rankGroup: 1 }));
  s.recordBigramRuns([["hub", "alpha"]]);
  o = s.nextOrdinal(); // ordinal GAP — no upserts; replay must reproduce it
  s.recordBigramRuns([["hub", "alpha"]]); // repeated bigram, count 2
  s.recordBigramRuns([["hub", "bravo"], ["hub", "charlie"]]);
  s.recordBigramRuns([["hub", "zulu"]]); // 4th distinct → sorted-tail drop

  o = s.nextOrdinal(); // message 5: INDEX_MERGE_BATCH + 44 distinct keys —
  for (let i = 0; i < INDEX_MERGE_BATCH + 44; i++) {
    // a consolidation fires mid-batch (upsert merges at exactly the batch
    // size), leaving a sub-batch pending tail below
    s.upsert(
      sighting({
        key: `bulk${String(i).padStart(4, "0")}`,
        ordinal: o,
        casing: "lower",
        rankGroup: 0,
      }),
    );
  }
  s.recordBigramRuns([["bulk0000", "bulk0001"]]);

  o = s.nextOrdinal(); // message 6: sub-batch tail — #pending non-empty at end
  for (let i = 0; i < 10; i++) {
    s.upsert(
      sighting({
        key: `tail${String(i).padStart(4, "0")}`,
        ordinal: o,
        casing: "lower",
        rankGroup: 1,
      }),
    );
  }
  s.recordBigramRuns([["tail0000", "hapax"], ["tail0000", "hapax"]]); // count 2
}

/** Bigram-cap flood (case 3): 10,050 distinct bigrams in one message —
 *  past BIGRAM_CAP = 10,000, so #evictBigramsIfOverCap runs, builds the
 *  lazy #bigramEvictHeap wholesale, and drains to cap (successors.test.ts
 *  fabricated-runs precedent; the store takes admitted keys on faith). */
function applyFlood(s: CandidateStore): void {
  const o = s.nextOrdinal();
  s.upsert(sighting({ key: "anchor", ordinal: o, casing: "lower", rankGroup: 1 }));
  const runs: string[][] = [];
  for (let i = 0; i < 10_050; i++) {
    runs.push([`f${String(i).padStart(5, "0")}`, "end"]);
  }
  s.recordBigramRuns(runs);
}

/** The full branch-purity comparison battery (spec 06 h2.42): every
 *  observable surface, exact toEqual / toBe. topSuccessors() is compared
 *  per word over the union of both stores' entry keys — the documented
 *  comparison surface (architecture/02 §8); there is no bigram dump API
 *  and none is needed. */
function expectPurityEquivalent(a: CandidateStore, b: CandidateStore): void {
  expect(a.entries()).toEqual(b.entries());
  expect(a.sortedKeysSnapshot()).toEqual(b.sortedKeysSnapshot());
  expect(a.size).toBe(b.size);
  expect(a.bigramSize).toBe(b.bigramSize);
  expect(a.currentOrdinal()).toBe(b.currentOrdinal());
  expect(a.rankGroupHistogram()).toEqual(b.rankGroupHistogram());
  const words = new Set([...a.entries(), ...b.entries()].map((c) => c.key));
  for (const w of words) {
    expect(a.topSuccessors(w)).toEqual(b.topSuccessors(w));
  }
}

describe("reset() — branch-purity drop (spec 06 h2.42 / P2.M1.T1.S1)", () => {
  it("empties every public surface; nextOrdinal() restarts at 1", () => {
    const s = new CandidateStore();
    applySeq(s);
    expect(s.size).toBeGreaterThan(0);
    expect(s.bigramSize).toBeGreaterThan(0);
    s.reset();
    expect(s.size).toBe(0);
    expect(s.entries()).toEqual([]);
    expect(s.sortedKeysSnapshot()).toEqual([]);
    expect(s.bigramSize).toBe(0);
    expect(s.topSuccessors("hapax")).toEqual([]);
    expect(s.get("hapax")).toBeUndefined();
    expect(s.rankGroupHistogram()).toEqual({ 0: 0, 1: 0, 2: 0 });
    expect(s.prefixRange("a")).toEqual([0, 0]);
    expect(s.currentOrdinal()).toBe(0);
    expect(s.nextOrdinal()).toBe(1); // replay re-issues 1..N like a fresh store
  });

  it("reset-then-replay ≡ fresh-store-replay (purity, spec 06 h2.42)", () => {
    const rebuilt = new CandidateStore();
    applySeq(rebuilt);
    rebuilt.reset(); // wholesale drop — dead-branch words cannot linger
    applySeq(rebuilt); // replay S through the identical public chain
    const fresh = new CandidateStore();
    applySeq(fresh); // the fresh /resume of the same branch
    expectPurityEquivalent(rebuilt, fresh);
  });

  it("bigram-cap flood: reset re-lazy-ifies the eviction heap", () => {
    const rebuilt = new CandidateStore();
    applyFlood(rebuilt);
    expect(rebuilt.bigramSize).toBe(10_000); // saturated + drained: heap built
    rebuilt.reset();
    applyFlood(rebuilt);
    const fresh = new CandidateStore();
    applyFlood(fresh);
    expect(rebuilt.bigramSize).toBe(10_000);
    expect(fresh.bigramSize).toBe(10_000);
    expectPurityEquivalent(rebuilt, fresh);
  });

  it("#capForms isolation: re-created keys inherit no stale form counts", () => {
    const s = new CandidateStore();
    s.upsert(
      sighting({ key: "acme", display: "Acme", casing: "mid-cap", rankGroup: 2 }),
    );
    s.upsert(
      sighting({ key: "acme", display: "Acme", casing: "mid-cap", ordinal: 2, rankGroup: 2 }),
    );
    expect(s.get("acme")!.capDisplay).toBe("Acme"); // argmax from {Acme: 2}
    s.reset();
    const o = s.nextOrdinal();
    s.upsert(
      sighting({ key: "acme", display: "ACME", casing: "mid-cap", ordinal: o, rankGroup: 2 }),
    );
    // A stale {Acme: 2} tally would keep capDisplay on "Acme" (1 ≥ 2
    // fails the argmax bump); fresh evidence hands it to "ACME".
    expect(s.get("acme")!.capDisplay).toBe("ACME");
    expect(s.get("acme")!.capCount).toBe(1); // fresh tally, not 2 stale + 1
  });

  it("reset on a fresh store is a safe no-op (empty-consolidation edge)", () => {
    const s = new CandidateStore();
    s.reset();
    expect(s.prefixRange("")).toEqual([0, 0]); // query path on the reset store
    applySeq(s);
    const fresh = new CandidateStore();
    applySeq(fresh);
    expectPurityEquivalent(s, fresh);
  });
});
