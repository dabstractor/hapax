/**
 * PRD §04 h2.24 admission suite (P1.M2.T3.S1): the four table rows
 * (q === null → 0, q < MID → 1, MID ≤ q < REJECT → 2, q ≥ REJECT → 'reject'),
 * the exact boundary values MID−1/MID and REJECT−1/REJECT, and the subword
 * clamp (a sub-word never ranks above its parent whole token's group + 1,
 * saturated at 2; 'reject' is immune to the clamp). MID =
 * MID_FREQ_THRESHOLD and REJECT = REJECT_COMMON_THRESHOLD — boundary cases
 * are expressed via the imported constants so the suite survives band
 * recalibration (BUG-001 retune), while the "baked thresholds" describe
 * below deliberately pins the current measured values.
 *
 * The proper-noun relief band (BUG-002 fix, plan 002
 * bugfix/001_0f4b641cf9ce) has its own describe: a capitalized whole
 * token with REJECT ≤ q < PROPER_NOUN_ADMIT_CEILING admits at group 2
 * instead of rejecting; lowercase occurrences, at/above-ceiling words,
 * and sub-words never relieve. Boundary cases use the imported ceiling
 * constant, same discipline as the band boundaries.
 *
 * The Dictionary is stubbed per the types.ts contract — no real binary is
 * loaded in unit tests — so key strings are arbitrary: lookup is a pure
 * function of the stub map.
 *
 * The ranking half (P1.M2.T3.S2) lives in the describes below: hand-computed
 * salience terms (values verified with node before writing assertions, same
 * protocol as shapeGate.test.ts), the τ = 50 eviction decay, and the three
 * PRD §09 orderings by name (frequency-beats-rare-once, recency decay,
 * userTyped tie-flip) plus both tie-breaks and full-sort determinism.
 */

import { describe, expect, it } from "vitest";
import {
  MID_FREQ_THRESHOLD,
  PROPER_NOUN_ADMIT_CEILING,
  REJECT_COMMON_THRESHOLD,
  admit,
  compareCandidates,
  evictionScore,
  salience,
} from "../src/core/score.js";
import type { CandidateDraft } from "../src/core/segment.js";
import type { Candidate, Dictionary, RankGroup } from "../src/core/types.js";

/** Stub Dictionary over a plain map (lookup contract: rank 0–255 or null). */
const dict = (entries: Record<string, number>): Dictionary => ({
  lookup: (w) => (w in entries ? entries[w] : null),
  version: 1,
  entryCount: Object.keys(entries).length,
});

/** Whole-token draft by default; isSubword=true adds a parentKey. The
 *  third parameter overrides any CandidateDraft field — used by the
 *  relief-band cases to set properName/display (admit() reads only
 *  key/isSubword/properName, and the key stays lowercase per its
 *  contract; display carries the capitalized form for realism). */
const draft = (
  key: string,
  isSubword = false,
  over: Partial<CandidateDraft> = {},
): CandidateDraft => ({
  key,
  display: key,
  properName: false,
  isSubword,
  ...(isSubword ? { parentKey: "parent" } : {}),
  ...over,
});

/** Fresh 1-sighting group-0 candidate seen at ordinal 1; override any field. */
const cand = (over: Partial<Candidate> = {}): Candidate => ({
  key: "token",
  display: "token",
  sessionCount: 1,
  lastSeenOrdinal: 1,
  firstSeenOrdinal: 1,
  userTyped: false,
  properName: false,
  rankGroup: 0,
  isSubword: false,
  ...over,
});

describe("admit — baked thresholds (PRD §04/§08)", () => {
  // Deliberate pin of the measured values (tools/calibrate-bands.mjs,
  // BUG-001): P1.M1.T2.S2's calibration test relies on these being exact.
  it("exports REJECT_COMMON_THRESHOLD = 50 and MID_FREQ_THRESHOLD = 20", () => {
    expect(REJECT_COMMON_THRESHOLD).toBe(50);
    expect(MID_FREQ_THRESHOLD).toBe(20);
  });
});

describe("admit — whole-token bands (PRD §04 h2.24)", () => {
  it("dictionary-absent word (q === null) → group 0, rare-by-default", () => {
    expect(admit(draft("zzqv"), dict({}))).toBe(0);
  });

  it("q = 0 (rarest attested) → group 1, not 0", () => {
    expect(admit(draft("zzqv"), dict({ zzqv: 0 }))).toBe(1);
  });

  it("q = MID_FREQ_THRESHOLD − 1 → group 1 (one below the mid-frequency boundary)", () => {
    expect(
      admit(draft("tokenish"), dict({ tokenish: MID_FREQ_THRESHOLD - 1 })),
    ).toBe(1);
  });

  it("q = MID_FREQ_THRESHOLD → group 2 (mid-frequency boundary exactly)", () => {
    expect(admit(draft("tokenish"), dict({ tokenish: MID_FREQ_THRESHOLD }))).toBe(
      2,
    );
  });

  it("q = REJECT_COMMON_THRESHOLD − 1 → group 2 (one below the reject boundary)", () => {
    expect(
      admit(draft("tokenish"), dict({ tokenish: REJECT_COMMON_THRESHOLD - 1 })),
    ).toBe(2);
  });

  it("q = REJECT_COMMON_THRESHOLD → reject (reject boundary exactly)", () => {
    expect(admit(draft("the"), dict({ the: REJECT_COMMON_THRESHOLD }))).toBe(
      "reject",
    );
  });

  it("q = 255 (most common) → reject", () => {
    expect(admit(draft("context"), dict({ context: 255 }))).toBe("reject");
  });

  it("clamp applies only to subwords: whole token ignores parentGroup", () => {
    // Whole tokens never pass parentGroup (ingest admits them first), but
    // the isSubword check must gate the clamp regardless of the argument.
    expect(admit(draft("tokenish"), dict({ tokenish: 0 }), 2)).toBe(1);
  });
});

describe("admit — subword clamp (PRD §04 h2.24)", () => {
  it("parent group 0 + table group 0 → 1", () => {
    expect(admit(draft("token", true), dict({ token: 0 }), 0)).toBe(1);
  });

  it("parent group 1 + table group 0 → 2", () => {
    expect(admit(draft("token", true), dict({ token: 0 }), 1)).toBe(2);
  });

  it("parent group 2 + table group 0 → 2 (saturates, never returns 3)", () => {
    expect(admit(draft("token", true), dict({ token: 0 }), 2)).toBe(2);
  });

  it("parent group 0 + table group 1 → 1 (table already at parent + 1)", () => {
    // q = 10: attested but below MID_FREQ_THRESHOLD → table group 1.
    expect(admit(draft("token", true), dict({ token: 10 }), 0)).toBe(1);
  });

  it("parent group 1 + table group 2 → 2", () => {
    // q = 30: mid-frequency band (MID ≤ q < REJECT) → table group 2.
    expect(admit(draft("token", true), dict({ token: 30 }), 1)).toBe(2);
  });

  it("parent group 0 + table group 2 → 2", () => {
    expect(admit(draft("token", true), dict({ token: 30 }), 0)).toBe(2);
  });

  it("subword with q ≥ REJECT_COMMON_THRESHOLD → 'reject' regardless of parent (clamp never rescues)", () => {
    for (const parent of [0, 1, 2] as const) {
      expect(
        admit(draft("the", true), dict({ the: REJECT_COMMON_THRESHOLD }), parent),
      ).toBe("reject");
    }
  });

  it("subword without parentGroup → unclamped table result", () => {
    // Defensive path: ingest always supplies parentGroup for subwords, but
    // a missing one must not fabricate a clamp — every table row passes
    // through raw: q = null → 0, q = 0 → 1, q = REJECT−1 → 2.
    expect(admit(draft("token", true), dict({}))).toBe(0);
    expect(admit(draft("token", true), dict({ token: 0 }))).toBe(1);
    expect(
      admit(draft("token", true), dict({ token: REJECT_COMMON_THRESHOLD - 1 })),
    ).toBe(2);
  });
});

describe("admit — proper-noun relief band (BUG-002)", () => {
  // The BUG-002 shape: National=90, Energy=94, Laboratory=57 in the
  // shipped dict — all ≥ REJECT_COMMON_THRESHOLD (50) so the BUG-001
  // bands rejected them and M2 integration item 7 ("National Renewable
  // Energy Laboratory" chaining) could never arm. The relief admits
  // CAPITALIZED WHOLE tokens in [REJECT, CEILING) at group 2.
  it("capitalized mid word (REJECT ≤ q < ceiling) relieves to group 2", () => {
    expect(
      admit(
        draft("national", false, { display: "National", properName: true }),
        dict({ national: 90 }),
      ),
    ).toBe(2);
  });

  it("lowercase occurrence of the same word still rejects (properName false)", () => {
    expect(admit(draft("national"), dict({ national: 90 }))).toBe("reject");
  });

  it("capitalized word at/above the ceiling still rejects (The = 240)", () => {
    expect(
      admit(draft("the", false, { display: "The", properName: true }), dict({ the: 240 })),
    ).toBe("reject");
  });

  it("boundary: q = ceiling rejects, q = ceiling − 1 relieves (strict <)", () => {
    // Synthetic word so the case is independent of any real corpus shift;
    // both edges pinned via the imported constant, same as the band tests.
    const proper = { display: "Nadroj", properName: true };
    expect(
      admit(
        draft("nadroj", false, proper),
        dict({ nadroj: PROPER_NOUN_ADMIT_CEILING }),
      ),
    ).toBe("reject");
    expect(
      admit(
        draft("nadroj", false, proper),
        dict({ nadroj: PROPER_NOUN_ADMIT_CEILING - 1 }),
      ),
    ).toBe(2);
  });

  it("sub-words never relieve: a table-rejected sub-word stays rejected (clamp-immune)", () => {
    // The PRP's literal case (sub-word at q=94, relieved parent → 2)
    // contradicts the module contract this suite already pins: relief
    // requires !isSubword, and 'reject' returns BEFORE the clamp (it is
    // clamp-immune) — so the sub-word of a relieved parent whose OWN
    // lookup lands in the reject band stays rejected. Pinned as such.
    expect(
      admit(
        draft("energy", true, { display: "Energy", properName: true }),
        dict({ energy: 94 }),
        2,
      ),
    ).toBe("reject");
  });

  it("sub-word of a relieved parent clamps at group 2 (never above parent + 1)", () => {
    // Own table result admits (mid band → 2); relieved parent is group 2
    // → min(2, max(2, 2+1)) = 2.
    expect(
      admit(draft("energetic", true), dict({ energetic: 30 }), 2),
    ).toBe(2);
    // Own table result rare (→ 1); parent 2 → min(2, max(1, 3)) = 2.
    expect(
      admit(draft("energise", true), dict({ energise: 10 }), 2),
    ).toBe(2);
  });

  it("capitalized dictionary-absent word stays group 0 (relief never demotes)", () => {
    // q === null already admits rarest (group 0); a relief that returned
    // 2 here would DEMOTE it. The q !== null guard prevents that.
    expect(
      admit(
        draft("zorpwibble", false, { display: "Zorpwibble", properName: true }),
        dict({}),
      ),
    ).toBe(0);
  });
});

const AT = 1; // "now": the ordinal the fresh `cand()` was last seen at

describe("salience — hand-computed terms (PRD §04 h2.25)", () => {
  it("fresh single sighting at the current ordinal, group 0: 2·log2(2) + 3·e^0 + 1.0 = 6.0", () => {
    expect(salience(cand(), AT)).toBeCloseTo(6.0, 12);
  });

  it("same sighting with no rarity bonus (group 2): exactly 2 + 3 = 5.0", () => {
    expect(salience(cand({ rankGroup: 2 }), AT)).toBeCloseTo(5.0, 12);
  });

  it("frequency term: sessionCount 8 → 2·log2(9) ≈ 6.33985 (log2-damped)", () => {
    const s = salience(cand({ sessionCount: 8, rankGroup: 2 }), AT);
    // Isolate the frequency term: total minus the fresh-recency constant 3.
    expect(s - 3).toBeCloseTo(2 * Math.log2(9), 12);
    expect(s - 3).toBeCloseTo(6.33985, 4);
    expect(s).toBeCloseTo(9.33985, 4);
  });

  it("recency decay τ=20: Δ20 → 3·e^-1 ≈ 1.1036; Δ40 ≈ 0.4060; Δ100 ≈ 0.0202 (→ 0)", () => {
    // sessionCount 0 zeroes the frequency term and group 2 zeroes rarity,
    // so salience here IS the recency term alone (pure math on the formula).
    const seen = (delta: number) =>
      salience(
        cand({ sessionCount: 0, rankGroup: 2, lastSeenOrdinal: 0 }),
        delta,
      );
    expect(seen(0)).toBeCloseTo(3, 12);
    expect(seen(20)).toBeCloseTo(3 * Math.exp(-1), 12);
    expect(seen(40)).toBeCloseTo(3 * Math.exp(-2), 12);
    expect(seen(100)).toBeCloseTo(3 * Math.exp(-5), 12);
  });

  it("userTyped adds exactly 1.5 (sticky flag, flat bonus)", () => {
    expect(salience(cand({ userTyped: true }), AT) - salience(cand(), AT)).toBeCloseTo(1.5, 12);
  });

  it("properName adds exactly 0.8", () => {
    expect(salience(cand({ properName: true }), AT) - salience(cand(), AT)).toBeCloseTo(0.8, 12);
  });

  it("rarity bonus by admission group: 0 → +1.0, 1 → +0.5, 2 → +0", () => {
    const g = (group: RankGroup) => salience(cand({ rankGroup: group }), AT);
    expect(g(0) - g(2)).toBeCloseTo(1.0, 12);
    expect(g(1) - g(2)).toBeCloseTo(0.5, 12);
  });
});

describe("evictionScore — slower τ=50 decay (PRD §06; store P1.M2.T4.S3)", () => {
  it("delta 0 → equals salience exactly (no decay at the current ordinal)", () => {
    const c = cand({ sessionCount: 5, userTyped: true });
    expect(evictionScore(c, AT)).toBe(salience(c, AT));
  });

  it("delta 50 → salience / e (one eviction τ of decay)", () => {
    const c = cand({ sessionCount: 5, rankGroup: 1, lastSeenOrdinal: AT });
    expect(evictionScore(c, AT + 50)).toBeCloseTo(salience(c, AT + 50) / Math.E, 12);
  });

  it("equals salience · e^(-Δ/50) across arbitrary deltas (reuses salience)", () => {
    const c = cand({
      sessionCount: 5,
      userTyped: true,
      properName: true,
      rankGroup: 1,
      lastSeenOrdinal: AT,
    });
    for (const ord of [AT, AT + 10, AT + 50, AT + 100]) {
      expect(evictionScore(c, ord)).toBeCloseTo(
        salience(c, ord) * Math.exp(-(ord - AT) / 50),
        12,
      );
    }
  });

  it("uses its own τ=50, not ranking's τ=20 (decay factor at Δ50 is e^-1, not e^-2.5)", () => {
    const c = cand({ sessionCount: 5, rankGroup: 2, lastSeenOrdinal: AT });
    expect(evictionScore(c, AT + 50) / salience(c, AT + 50)).toBeCloseTo(
      Math.exp(-1),
      12,
    );
  });

  it("monotonically decreases as the candidate goes unseen (higher = keep longer)", () => {
    const c = cand({ sessionCount: 5, rankGroup: 1, lastSeenOrdinal: AT });
    let prev = evictionScore(c, AT);
    for (let ord = AT + 7; ord <= AT + 200; ord += 7) {
      const cur = evictionScore(c, ord);
      expect(cur).toBeLessThan(prev);
      prev = cur;
    }
  });

  it("large delta → ≈ 0: 500 messages unseen leaves < 1% of the fresh score", () => {
    const c = cand({ sessionCount: 5, rankGroup: 1, lastSeenOrdinal: AT });
    expect(evictionScore(c, AT + 500)).toBeLessThan(0.01 * evictionScore(c, AT));
  });
});

describe("compareCandidates — PRD §09 orderings", () => {
  it("§09: frequency beats rare-once — an 8× group-2 word outranks a 1× group-0 word", () => {
    // A = 2·log2(9) + 3 + 0 ≈ 9.34 vs B = 2 + 3 + 1.0 = 6.0.
    const a = cand({ key: "kerfuffle", display: "kerfuffle", sessionCount: 8, rankGroup: 2 });
    const b = cand({ key: "zzqv", display: "zzqv" });
    expect(compareCandidates(a, b, AT)).toBeLessThan(0); // a first
    expect(compareCandidates(b, a, AT)).toBeGreaterThan(0);
  });

  it("§09: recency decay τ=20 — seen 30 messages ago loses to seen 1 message ago", () => {
    // Equal counts/groups: old ≈ 7.01 vs fresh ≈ 9.19.
    const old = cand({ key: "quixotic", sessionCount: 8, lastSeenOrdinal: 1, rankGroup: 2 });
    const fresh = cand({ key: "verdant", sessionCount: 8, lastSeenOrdinal: 30, rankGroup: 2 });
    expect(compareCandidates(old, fresh, 31)).toBeGreaterThan(0); // fresh first
    expect(compareCandidates(fresh, old, 31)).toBeLessThan(0);
  });

  it("§09: userTyped flips a tie — identical candidates split by the sticky 1.5", () => {
    const typed = cand({ key: "meridian", display: "Meridian", userTyped: true });
    const untyped = cand({ key: "obelisk", display: "obelisk" });
    expect(compareCandidates(typed, untyped, AT)).toBeLessThan(0);
    expect(compareCandidates(untyped, typed, AT)).toBeGreaterThan(0);
  });

  it("exact salience tie → shorter key first: 'fix' before 'fixpoint'", () => {
    const fix = cand({ key: "fix", display: "fix" });
    const fixpoint = cand({ key: "fixpoint", display: "fixpoint" });
    expect(compareCandidates(fix, fixpoint, AT)).toBeLessThan(0);
    expect(compareCandidates(fixpoint, fix, AT)).toBeGreaterThan(0);
  });

  it("still tied (equal length) → byte order on the lowercase key: 'abort' before 'abstract'", () => {
    const abort = cand({ key: "abort", display: "abort" });
    const abstract = cand({ key: "abstract", display: "abstract" });
    expect(compareCandidates(abort, abstract, AT)).toBeLessThan(0);
    expect(compareCandidates(abstract, abort, AT)).toBeGreaterThan(0);
  });

  it("identical keys and stats → 0; comparator is consistent and never NaN", () => {
    expect(compareCandidates(cand(), cand(), AT)).toBe(0);
    const board = [cand(), cand({ sessionCount: 9 }), cand({ userTyped: true, lastSeenOrdinal: 90 })];
    for (const x of board) {
      for (const y of board) {
        const c = compareCandidates(x, y, AT);
        const r = compareCandidates(y, x, AT);
        expect(Number.isNaN(c)).toBe(false);
        // Antisymmetry with an explicit zero branch (Object.is(0, -0) is false).
        if (c === 0) expect(r).toBe(0);
        else expect(Math.sign(r)).toBe(-Math.sign(c));
      }
    }
  });

  it("full-order determinism: a shuffled mixed board sorts identically twice", () => {
    const board = [
      cand({ key: "verdant", sessionCount: 8, lastSeenOrdinal: 30, rankGroup: 2 }),
      cand({ key: "kerfuffle", sessionCount: 8, rankGroup: 2 }),
      cand({ key: "zzqv" }),
      cand({ key: "meridian", userTyped: true }),
      cand({ key: "fix" }),
      cand({ key: "fixpoint", userTyped: true }),
      cand({ key: "abort", properName: true, rankGroup: 1 }),
      cand({ key: "abstract", lastSeenOrdinal: 100 }),
    ];
    // Deterministic LCG shuffle: each seed walks a different permutation.
    const shuffled = (seed: number) => {
      let s = seed;
      const arr = [...board];
      for (let i = arr.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) % 4294967296;
        const j = s % (i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr.sort((x, y) => compareCandidates(x, y, 40));
    };
    const once = shuffled(1);
    expect(shuffled(99)).toEqual(once);
    // Total order: re-sorting the sorted output is a no-op.
    expect([...once].sort((x, y) => compareCandidates(x, y, 40))).toEqual(once);
  });
});