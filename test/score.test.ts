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
 *
 * The 2026-10 gradient (R_eff) replaces the flat table row: attested words
 * ≤ REJECT_LEN_FLOOR chars keep the flat floor; 9–19 chars ramp the reject
 * threshold toward 255 by sqrt; ≥ REJECT_LEN_FULL chars admit everything
 * (rEff returns a 256 sentinel so q=255 admits). All R_eff boundaries are
 * asserted relative to the imported constants, with the measured 9-char
 * 81/82 boundary pinned explicitly (float compare — no rounding).
 */

import { describe, expect, it } from "vitest";
import {
  MID_FREQ_THRESHOLD,
  PROPER_NOUN_ADMIT_CEILING,
  REJECT_COMMON_THRESHOLD,
  admit,
  compareCandidates,
  evictionScore,
  rEff,
  REJECT_LEN_FLOOR,
  REJECT_LEN_FULL,
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
  it("exports REJECT_COMMON_THRESHOLD = 12 (2026-09 retighten) and MID_FREQ_THRESHOLD = 20", () => {
    expect(REJECT_COMMON_THRESHOLD).toBe(12);
    expect(MID_FREQ_THRESHOLD).toBe(20); // guard tier-2 only; the g2 table band is retired
  });
});

describe("R_eff length-conditioned admission (2026-10 gradient)", () => {
  // Spec/04 h2.26: R_eff(len) = floor for len ≤ 8; floor + (255−floor)·√((len−8)/12)
  // for 8 < len < 20; admit-all at len ≥ 20 (rEff returns 256, above the q
  // domain, so q=255 admits — the naive 255 would reject the most-common q).
  it("pins the exported curve constants", () => {
    expect(REJECT_LEN_FLOOR).toBe(8);
    expect(REJECT_LEN_FULL).toBe(20);
  });

  it("floor hold: q = REJECT rejects at any len ≤ REJECT_LEN_FLOOR", () => {
    for (const [key, len] of [
      ["ok", 2],
      ["token", 5],
      ["tokenish", 8],
    ] as const) {
      expect(key.length).toBe(len);
      expect(admit(draft(key), dict({ [key]: REJECT_COMMON_THRESHOLD }))).toBe(
        "reject",
      );
    }
  });

  it("floor hold: q = REJECT − 1 admits at flat group 1", () => {
    expect(
      admit(draft("tokenish"), dict({ tokenish: REJECT_COMMON_THRESHOLD - 1 })),
    ).toBe(1);
  });

  it("sqrt ramp boundary at 9 chars: rEff ≈ 82.15 → q=82 admits, q=83 rejects (float compare, no rounding)", () => {
    // PRP-fencepost note: ceil(82.147) = 83, so the measured boundary is
    // last-admit 82 / first-reject 83 (the self-relative construction rule:
    // q_reject = ceil(rEff)). Rounding down to 82 would flip q=82 to reject
    // — this pair pins the no-rounding contract.
    expect(rEff(REJECT_COMMON_THRESHOLD, 9)).toBeCloseTo(82.147, 2);
    expect(admit(draft("ninechars"), dict({ ninechars: 82 }))).toBe(1);
    expect(admit(draft("ninechars"), dict({ ninechars: 83 }))).toBe("reject");
  });

  it("ramp probes (spec h2.26 measured values): 10-char 110/139, 14-char 183/184", () => {
    // rEff(12,10) ≈ 111.2 → 110 admits, 139 rejects;
    // rEff(12,14) ≈ 183.8 → 183 admits, 184 rejects.
    expect(admit(draft("government"), dict({ government: 110 }))).toBe(1);
    expect(admit(draft("everything"), dict({ everything: 139 }))).toBe("reject");
    expect(admit(draft("characteristic"), dict({ characteristic: 183 }))).toBe(1);
    expect(
      admit(draft("characteristic"), dict({ characteristic: 184 })),
    ).toBe("reject");
  });

  it("admit-all at len ≥ REJECT_LEN_FULL, including q=255 (sentinel, not 255)", () => {
    const key20 = "x".repeat(20);
    const key21 = "y".repeat(21);
    expect(rEff(REJECT_COMMON_THRESHOLD, 20)).toBe(256);
    expect(admit(draft(key20), dict({ [key20]: 255 }))).toBe(1);
    expect(admit(draft(key21), dict({ [key21]: 255 }))).toBe(1);
  });

  it("every attested admission lands at flat group 1 — no table path to group 2", () => {
    expect(admit(draft("ninechars"), dict({ ninechars: 81 }))).toBe(1);
    expect(admit(draft("tokenish"), dict({ tokenish: 0 }))).toBe(1);
    expect(admit(draft("token"), dict({ token: REJECT_COMMON_THRESHOLD - 1 }))).toBe(1);
    // The old MID row is gone: a mid-band q at floor length rejects flat,
    // never demotes to 2.
    expect(
      admit(draft("tokenish"), dict({ tokenish: MID_FREQ_THRESHOLD })),
    ).toBe("reject");
  });

  it("absent stays group 0 at all lengths, including ≥ REJECT_LEN_FULL", () => {
    expect(admit(draft("zzqv"), dict({}))).toBe(0);
    expect(admit(draft("x".repeat(20)), dict({}))).toBe(0);
  });

  it("rejectCommonness knob moves the floor AND the curve", () => {
    // Floor at knob 10: q=10 rejects at len 8 (admits at default 12).
    expect(
      admit(draft("tokenish"), dict({ tokenish: 10 }), undefined, {
        rejectCommonness: 10,
      }),
    ).toBe("reject");
    expect(
      admit(draft("tokenish"), dict({ tokenish: 9 }), undefined, {
        rejectCommonness: 10,
      }),
    ).toBe(1);
    // Curve: rEff(10, 9) = 10 + 245·√(1/12) ≈ 80.725 → 80 admits, 81 rejects.
    expect(rEff(10, 9)).toBeCloseTo(80.725, 2);
    expect(
      admit(draft("ninechars"), dict({ ninechars: 80 }), undefined, {
        rejectCommonness: 10,
      }),
    ).toBe(1);
    expect(
      admit(draft("ninechars"), dict({ ninechars: 81 }), undefined, {
        rejectCommonness: 10,
      }),
    ).toBe("reject");
  });

  it("rEff arithmetic sanity: exact floor edge, sentinel, monotone non-decreasing", () => {
    expect(rEff(12, 0)).toBe(12);
    expect(rEff(12, REJECT_LEN_FLOOR)).toBe(12);
    expect(rEff(12, REJECT_LEN_FULL)).toBe(256);
    expect(rEff(12, 25)).toBe(256);
    let prev = -Infinity;
    for (let len = 0; len <= 25; len++) {
      const v = rEff(REJECT_COMMON_THRESHOLD, len);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("admit — conjugation guard (2026-09, 'deleted' leak)", () => {
  it("attested inflection under the band still rejects when its stem is reject-common (deleted: q=45, delete: q≥REJECT)", () => {
    expect(admit(draft("deleted"), dict({ deleted: 45, delete: REJECT_COMMON_THRESHOLD }))).toBe(
      "reject",
    );
  });

  it("absent inflection rejects via a reject-common stem (deletes → delete)", () => {
    expect(admit(draft("deletes"), dict({ delete: REJECT_COMMON_THRESHOLD }))).toBe("reject");
  });

  it("absent inflection rejects via an ATTESTED MID-BAND stem (uploads → upload q=38)", () => {
    expect(
      admit(draft("uploads"), dict({ upload: MID_FREQ_THRESHOLD + 18 })),
    ).toBe("reject");
  });

  it("e-restoration stems match (typing → type, caching → cache)", () => {
    expect(admit(draft("typing"), dict({ type: REJECT_COMMON_THRESHOLD }))).toBe("reject");
    expect(admit(draft("caching"), dict({ cache: MID_FREQ_THRESHOLD + 10 }))).toBe("reject");
  });

  it("doubled-consonant stems match (stopped → stop, running → run)", () => {
    expect(admit(draft("stopped"), dict({ stop: REJECT_COMMON_THRESHOLD }))).toBe("reject");
    expect(admit(draft("running"), dict({ run: REJECT_COMMON_THRESHOLD }))).toBe("reject");
  });

  it("adverb -ly stems match (badly → bad)", () => {
    expect(admit(draft("badly"), dict({ bad: REJECT_COMMON_THRESHOLD }))).toBe("reject");
  });

  it("subwords are guarded too (typed as a subword of typedFlag)", () => {
    expect(admit(draft("typed", true), dict({ type: REJECT_COMMON_THRESHOLD }), 2)).toBe(
      "reject",
    );
  });

  it("properName drafts SKIP the guard — casing evidence outranks morphology (Andrews)", () => {
    // 2026-09: with the relief retired (ceiling == REJECT), a capitalized
    // table-rejected word ALSO rejects — but still WITHOUT consulting the
    // guard (the skip is the contract this pins). The q < REJECT twin
    // below shows the skip matters: the stem is reject-common, the word
    // is rare-attested, and properName keeps it admitting via the table.
    const d = { andrews: REJECT_COMMON_THRESHOLD, andrew: REJECT_COMMON_THRESHOLD };
    expect(
      admit(draft("andrews", false, { display: "Andrews", properName: true }), dict(d)),
    ).toBe("reject"); // table-rejected; relief retired
    expect(admit(draft("andrews"), dict(d))).toBe("reject"); // lowercase: same table + guard agrees
    // Rare-attested word with a COMMON stem: properName skips the guard
    // (admits at 1); lowercase hits the guard and rejects.
    const d2 = { andrews: REJECT_COMMON_THRESHOLD - 1, andrew: REJECT_COMMON_THRESHOLD };
    expect(
      admit(draft("andrews", false, { display: "Andrews", properName: true }), dict(d2)),
    ).toBe(1);
    expect(admit(draft("andrews"), dict(d2))).toBe("reject");
  });

  it("stem below the reject band does NOT reject absent jargon (rarestem plurals stay admitted)", () => {
    // 2026-09: at REJECT=12, a stem must sit in the rarest tail to spare
    // its absent inflection — zephyr(q=MID−1=19) is attested-English
    // noise now, so its plural rejects too; a genuinely rare stem
    // (q=10) keeps the absent plural admitting at group 0.
    expect(admit(draft("zephyrs"), dict({ zephyr: MID_FREQ_THRESHOLD - 1 }))).toBe(
      "reject", // stem 19 ≥ 12: tier-1 rejects the absent inflection
    );
    expect(admit(draft("rarewords"), dict({ rareword: 10 }))).toBe(0);
  });

  it("word with no inflection suffix is untouched (lwlock-style jargon)", () => {
    expect(admit(draft("lwlock"), dict({ delete: 255 }))).toBe(0);
  });

  it("rejectCommonness knob governs the stem comparison too", () => {
    // 2026-09: word attested at q=5 (rarest tail → group 1 admits);
    // stem at q=10 stays under the default band (12) → admit. Loosened
    // to 10 the stem clears the bar → reject.
    expect(admit(draft("listses"), dict({ listses: 5, listse: 10 }))).toBe(1);
    expect(
      admit(draft("listses"), dict({ listses: 5, listse: 10 }), undefined, {
        rejectCommonness: 10,
      }),
    ).toBe("reject");
  });
});

describe("admit — whole-token bands (PRD §04 h2.24)", () => {
  it("dictionary-absent word (q === null) → group 0, rare-by-default", () => {
    expect(admit(draft("zzqv"), dict({}))).toBe(0);
  });

  it("q = 0 (rarest attested) → group 1, not 0", () => {
    expect(admit(draft("zzqv"), dict({ zzqv: 0 }))).toBe(1);
  });

  it("q < 12 → group 1 (the rarest-English tail is the ONLY attested class that admits)", () => {
    expect(admit(draft("tokenish"), dict({ tokenish: 11 }))).toBe(1);
    expect(admit(draft("tokenish"), dict({ tokenish: 0 }))).toBe(1);
  });

  it("q = REJECT_COMMON_THRESHOLD − 1 → group 1 (one below the reject boundary)", () => {
    expect(
      admit(draft("tokenish"), dict({ tokenish: REJECT_COMMON_THRESHOLD - 1 })),
    ).toBe(1);
  });

  it("attested English in the OLD mid band (20 ≤ q < 50) now REJECTS (2026-09 retighten)", () => {
    expect(admit(draft("tokenish"), dict({ tokenish: MID_FREQ_THRESHOLD }))).toBe(
      "reject",
    );
    expect(admit(draft("tokenish"), dict({ tokenish: 49 }))).toBe("reject");
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

  it("the old g2 table band (q=30) now REJECTS even for subwords (2026-09 retighten)", () => {
    // MID ≤ q < 50 was table group 2; with REJECT=12 it rejects before
    // the clamp — group 2 remains reachable only via parentGroup values.
    expect(admit(draft("token", true), dict({ token: 30 }), 1)).toBe("reject");
    expect(admit(draft("token", true), dict({ token: 30 }), 0)).toBe("reject");
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
    // through raw: q = null → 0, q = 0 → 1, q = REJECT−1 → 1 (2026-09:
    // the g2 row is retired).
    expect(admit(draft("token", true), dict({}))).toBe(0);
    expect(admit(draft("token", true), dict({ token: 0 }))).toBe(1);
    expect(
      admit(draft("token", true), dict({ token: REJECT_COMMON_THRESHOLD - 1 })),
    ).toBe(1); // 2026-09: rarest-attested tail is group 1 (g2 retired)
  });
});

describe("admit — proper-noun relief (RETIRED-IN-PLACE, 2026-09)", () => {
  // History: the relief admitted CAPITALIZED WHOLE tokens in
  // [REJECT, CEILING) at group 2 so "National Renewable Energy
  // Laboratory" (q 57–94) could chain. A live audit showed it admitting
  // ~483 capitalized common words (echo, windows, failed) — retired by
  // setting the ceiling to the reject band; restoring named entities is
  // an allowlist design question (spec/04), not a band change.
  it("capitalized attested English no longer relieves (ceiling == reject band)", () => {
    expect(
      admit(
        draft("national", false, { display: "National", properName: true }),
        dict({ national: 90 }),
      ),
    ).toBe("reject");
  });

  it("lowercase occurrence of the same word still rejects (properName false)", () => {
    expect(admit(draft("national"), dict({ national: 90 }))).toBe("reject");
  });

  it("capitalized word at/above the ceiling still rejects (The = 240)", () => {
    expect(
      admit(draft("the", false, { display: "The", properName: true }), dict({ the: 240 })),
    ).toBe("reject");
  });

  it("boundary semantics preserved: q = ceiling rejects; below-ceiling is now simply the rare-attested tail", () => {
    // With ceiling == REJECT (12), "q < ceiling" lands in the admitting
    // tail — via the TABLE (group 1), not the relief. The strict-<
    // boundary shape is pinned so restoring a wider ceiling behaves.
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
    ).toBe(1);
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

  it("sub-word of a group-2 parent clamps at group 2 (never above parent + 1)", () => {
    // 2026-09: table group 2 is retired, so a 2-parent arrives only via
    // the (retired) relief or legacy store entries — the clamp itself is
    // unchanged and stays pinned: own table result rare (→ 1) with
    // parent 2 → min(2, max(1, 3)) = 2. Under the 2026-10 gradient an
    // ATTESTED 9-char sub-word (q=30 < R_eff(9)=82.15) also reaches the
    // clamp and lands at 2; mid-band q still rejects outright at floor
    // lengths (≤ 8 chars), where the flat band is unchanged.
    expect(
      admit(draft("energise", true), dict({ energise: 10 }), 2),
    ).toBe(2);
    expect(
      admit(draft("energetic", true), dict({ energetic: 30 }), 2),
    ).toBe(2); // 2026-10: 9-char q=30 rides the ramp down (82.15) → table 1, clamps to 2
    // Mid-band q must still reject at floor lengths (≤ 8 chars): the old g2
    // table row is gone, so 6-char q=30 ≥ floor(12) rejects before the clamp.
    expect(
      admit(draft("energy", true), dict({ energy: 30 }), 2),
    ).toBe("reject");
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