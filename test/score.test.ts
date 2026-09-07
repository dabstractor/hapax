/**
 * PRD §04 h2.24 admission suite (P1.M2.T3.S1): the four table rows
 * (q === null → 0, q < 120 → 1, 120 ≤ q < 220 → 2, q ≥ 220 → 'reject'),
 * the exact boundary values 119/120 and 219/220, and the subword clamp (a
 * sub-word never ranks above its parent whole token's group + 1, saturated
 * at 2; 'reject' is immune to the clamp).
 *
 * The Dictionary is stubbed per the types.ts contract — no real binary is
 * loaded in unit tests — so key strings are arbitrary: lookup is a pure
 * function of the stub map.
 */

import { describe, expect, it } from "vitest";
import {
  MID_FREQ_THRESHOLD,
  REJECT_COMMON_THRESHOLD,
  admit,
} from "../src/core/score.js";
import type { CandidateDraft } from "../src/core/segment.js";
import type { Dictionary, RankGroup } from "../src/core/types.js";

/** Stub Dictionary over a plain map (lookup contract: rank 0–255 or null). */
const dict = (entries: Record<string, number>): Dictionary => ({
  lookup: (w) => (w in entries ? entries[w] : null),
  version: 1,
  entryCount: Object.keys(entries).length,
});

/** Whole-token draft by default; isSubword=true adds a parentKey. */
const draft = (key: string, isSubword = false): CandidateDraft => ({
  key,
  display: key,
  properName: false,
  isSubword,
  ...(isSubword ? { parentKey: "parent" } : {}),
});

describe("admit — baked thresholds (PRD §04/§08)", () => {
  it("exports REJECT_COMMON_THRESHOLD = 220 and MID_FREQ_THRESHOLD = 120", () => {
    expect(REJECT_COMMON_THRESHOLD).toBe(220);
    expect(MID_FREQ_THRESHOLD).toBe(120);
  });
});

describe("admit — whole-token bands (PRD §04 h2.24)", () => {
  it("dictionary-absent word (q === null) → group 0, rare-by-default", () => {
    expect(admit(draft("zzqv"), dict({}))).toBe(0);
  });

  it("q = 0 (rarest attested) → group 1, not 0", () => {
    expect(admit(draft("zzqv"), dict({ zzqv: 0 }))).toBe(1);
  });

  it("q = 119 → group 1 (one below the mid-frequency boundary)", () => {
    expect(admit(draft("tokenish"), dict({ tokenish: 119 }))).toBe(1);
  });

  it("q = 120 → group 2 (MID_FREQ_THRESHOLD exactly)", () => {
    expect(admit(draft("tokenish"), dict({ tokenish: 120 }))).toBe(2);
  });

  it("q = 219 → group 2 (one below the reject boundary)", () => {
    expect(admit(draft("tokenish"), dict({ tokenish: 219 }))).toBe(2);
  });

  it("q = 220 → reject (REJECT_COMMON_THRESHOLD exactly)", () => {
    expect(admit(draft("the"), dict({ the: 220 }))).toBe("reject");
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
    expect(admit(draft("token", true), dict({ token: 50 }), 0)).toBe(1);
  });

  it("parent group 1 + table group 2 → 2", () => {
    expect(admit(draft("token", true), dict({ token: 150 }), 1)).toBe(2);
  });

  it("parent group 0 + table group 2 → 2", () => {
    expect(admit(draft("token", true), dict({ token: 150 }), 0)).toBe(2);
  });

  it("subword with q ≥ 220 → 'reject' regardless of parent (clamp never rescues)", () => {
    for (const parent of [0, 1, 2] as const) {
      expect(admit(draft("the", true), dict({ the: 220 }), parent)).toBe(
        "reject",
      );
    }
  });

  it("subword without parentGroup → unclamped table result", () => {
    // Defensive path: ingest always supplies parentGroup for subwords, but
    // a missing one must not fabricate a clamp — every table row passes
    // through raw: q = null → 0, q = 0 → 1, q = 219 → 2.
    expect(admit(draft("token", true), dict({}))).toBe(0);
    expect(admit(draft("token", true), dict({ token: 0 }))).toBe(1);
    expect(admit(draft("token", true), dict({ token: 219 }))).toBe(2);
  });
});