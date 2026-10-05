/**
 * PRD §06 candidate-store suite (P1.M2.T4.S1): the h2.36 upsert contract
 * (absent → create, present → merge), the ordinal counter (monotonic from
 * 1; upsert never advances it — the pipeline owns assignment), casing
 * merging into one entry with most-recent display, sticky OR-in flags,
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
import { CandidateStore, EVICT_BATCH, STORE_CAP } from "../src/core/store.js";
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
        properName: false,
        rankGroup: 0,
      }),
    );
    expect(s.size).toBe(1);
    expect(s.get("zzqv")).toEqual({
      key: "zzqv",
      display: "Zzqv",
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

  it("display refreshes to the most recent casing (most recent wins)", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: "hapax", display: "hapax" }));
    s.upsert(sighting({ key: "hapax", display: "Hapax" }));
    expect(s.size).toBe(1); // casing variants merge into one entry
    expect(s.get("hapax")!.display).toBe("Hapax");
    s.upsert(sighting({ key: "hapax", display: "HAPAX" }));
    expect(s.size).toBe(1);
    expect(s.get("hapax")!.display).toBe("HAPAX");
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

describe("path display merge (rule 4d: key trimmed, display keeps edges)", () => {
  // Rule 4d (spec/04:118-174): a path sighting's key is the trimmed
  // lowercase form while display keeps the ORIGINAL edges — so the same
  // path re-typed with a different edge style must still merge into ONE
  // entry (the key space, not the display, decides identity), with the
  // latest display winning (store.ts upsert: "most recent wins").
  const KEY = "home/dustin/projects/hapax";

  it("edge-variant sightings of one path merge to one entry; most recent display wins", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: KEY, display: `/${KEY}`, ordinal: 5 }));
    s.upsert(sighting({ key: KEY, display: `${KEY}/`, ordinal: 9 }));
    expect(s.size).toBe(1); // leading-/ and trailing-/ map to ONE key
    const c = s.get(KEY)!;
    expect(c.sessionCount).toBe(2);
    expect(c.display).toBe(`${KEY}/`); // recency-wins, edges verbatim
    expect(c.lastSeenOrdinal).toBe(9);
    expect(c.firstSeenOrdinal).toBe(5); // merge semantics keep the origin
  });

  it("reverse order still hands display to the latest sighting (trailing-/ first)", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ key: KEY, display: `${KEY}/`, ordinal: 3 }));
    s.upsert(sighting({ key: KEY, display: `/${KEY}`, ordinal: 4 }));
    expect(s.size).toBe(1);
    expect(s.get(KEY)!.display).toBe(`/${KEY}`);
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
    snapshot[0].display = "MUTATED";
    expect(s.get("hapax")!.sessionCount).toBe(1);
    expect(s.get("hapax")!.display).toBe("hapax");
    // A fresh snapshot taken after the mutation reflects the true state.
    expect(s.entries()[0].sessionCount).toBe(1);
  });

  it("a snapshot taken before later upserts is not mutated by them", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ ordinal: 1 }));
    const snapshot = s.entries();
    s.upsert(sighting({ ordinal: 2, display: "Hapax" }));
    expect(snapshot[0].sessionCount).toBe(1);
    expect(snapshot[0].display).toBe("hapax");
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