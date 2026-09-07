/**
 * PRD §06 candidate-store suite (P1.M2.T4.S1): the h2.36 upsert contract
 * (absent → create, present → merge), the ordinal counter (monotonic from
 * 1; upsert never advances it — the pipeline owns assignment), casing
 * merging into one entry with most-recent display, sticky OR-in flags,
 * rankGroup min-on-merge, isSubword fixed at creation, defensive entries()
 * snapshots, and the group histogram.
 *
 * Sightings are fabricated inline per the types.ts contract — the store is
 * downstream of segment + shapeGate + score and takes their output on
 * faith; key strings are arbitrary lowercase.
 */

import { describe, expect, it } from "vitest";
import { CandidateStore } from "../src/core/store.js";
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
        isSubword: false,
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
      isSubword: false,
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

  it("isSubword is fixed at creation — a later true sighting does not merge", () => {
    const s = new CandidateStore();
    s.upsert(sighting({ isSubword: false }));
    s.upsert(sighting({ isSubword: true, parentKey: "hapaxologism" }));
    expect(s.get("hapax")!.isSubword).toBe(false);
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