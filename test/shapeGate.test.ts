/**
 * PRD §04 h2.23 shape-gate suite (P1.M2.T2.S1): length bounds (whole 4–64,
 * sub-word 4–32), char-entropy < 1.5 bits/char, unigram runs ≥ 4, consonant
 * runs ≥ 6, hexish pass-through, reason precedence (length → entropy →
 * unigramRun → consonantRun), and the no-reason-on-ok contract.
 *
 * Secret-shape rejection is P1.M2.T2.S2 — deliberately untested here.
 *
 * Entropy expectations were verified against H = -Σ p_c · log2(p_c) with
 * node before the assertions were written (e.g. "blaaaah" ≈ 1.664, the
 * PRP's "waaaaaard" draft corrected: it is H ≈ 1.447 < 1.5 and would die
 * as lowEntropy before the unigram rule could fire).
 */

import { describe, expect, it } from "vitest";
import { passesShape } from "../src/core/shapeGate.js";
import type { CandidateDraft } from "../src/core/segment.js";

/** Whole-token draft by default; isSubword=true adds a parentKey. */
const draft = (key: string, isSubword = false): CandidateDraft => ({
  key,
  display: key,
  properName: false,
  isSubword,
  ...(isSubword ? { parentKey: "p" } : {}),
});

describe("passesShape — length (PRD §04 h2.23 rule 1)", () => {
  it("rejects a 3-char whole token as tooShort", () => {
    expect(passesShape(draft("abc"))).toEqual({ ok: false, reason: "tooShort" });
  });

  it("accepts a 4-char all-distinct whole token (lower bound)", () => {
    expect(passesShape(draft("abcd"))).toEqual({ ok: true });
  });

  it("rejects a 65-char whole token as tooLong", () => {
    // Length precedes entropy: H("zzz…") = 0, but tooLong wins.
    expect(passesShape(draft("z".repeat(65)))).toEqual({
      ok: false,
      reason: "tooLong",
    });
  });

  it("accepts a 64-char whole token (upper bound)", () => {
    // "abcd"×16: H = 2.0 bits/char, max unigram run 1, consonant runs of 3.
    expect(passesShape(draft("abcd".repeat(16)))).toEqual({ ok: true });
  });

  it("rejects a 3-char sub-word as tooShort", () => {
    expect(passesShape(draft("abc", true))).toEqual({
      ok: false,
      reason: "tooShort",
    });
  });

  it("rejects a 33-char sub-word as tooLong (sub-word cap is 32, not 64)", () => {
    expect(passesShape(draft("s".repeat(33), true))).toEqual({
      ok: false,
      reason: "tooLong",
    });
  });

  it("accepts a 32-char sub-word (sub-word upper bound)", () => {
    expect(passesShape(draft("abcd".repeat(8), true))).toEqual({ ok: true });
  });
});

describe("passesShape — low entropy (rule 3, over the lowercase key)", () => {
  it("rejects a single repeated char (H = 0)", () => {
    expect(passesShape(draft("aaaa"))).toEqual({
      ok: false,
      reason: "lowEntropy",
    });
  });

  it("rejects two alternating chars ×8 (H = 1.0 < 1.5)", () => {
    // a:4, b:4 → H = -(2 × 0.5 × log2 0.5) = 1.0
    expect(passesShape(draft("abababab"))).toEqual({
      ok: false,
      reason: "lowEntropy",
    });
  });

  it("accepts H exactly 1.5 (reject is strictly < 1.5)", () => {
    // "abbc": p = ½,¼,¼ → H = 0.5 + 0.5 + 0.5 = 1.5 exactly (exact in FP:
    // log2 of powers of two is exact). Run of 2 b's and 3-consonant "bbc"
    // stay below the unigram/consonant thresholds.
    expect(passesShape(draft("abbc"))).toEqual({ ok: true });
  });

  it("accepts 4 distinct chars (NREL → nrel, H = 2.0)", () => {
    expect(passesShape(draft("nrel"))).toEqual({ ok: true });
  });
});

describe("passesShape — unigram run ≥ 4 (rule 4)", () => {
  it("rejects a run of exactly 4 in a mixed string", () => {
    // "blaaaah": b,l + 4×a + h — H ≈ 1.664 ≥ 1.5 clears entropy, so the
    // 4-run is what fires (isolates the rule from lowEntropy).
    expect(passesShape(draft("blaaaah"))).toEqual({
      ok: false,
      reason: "unigramRun",
    });
  });

  it("rejects a 4-run anywhere in the string, not just at the start", () => {
    // "hexaaaagon": H ≈ 2.522, consonant runs ≤ 1 — only the mid-string
    // aaaa violates.
    expect(passesShape(draft("hexaaaagon"))).toEqual({
      ok: false,
      reason: "unigramRun",
    });
  });

  it("accepts a run of 3 (faaamily)", () => {
    // H ≈ 2.406, max consonant run 1 — passes every rule.
    expect(passesShape(draft("faaamily"))).toEqual({ ok: true });
  });
});

describe("passesShape — consonant run ≥ 6 (rule 5)", () => {
  it("rejects a 12-consonant run (qqqxxxzzzvvv)", () => {
    // H = 2.0 (4 chars × 3 each), max unigram run 3 → consonantRun is why.
    expect(passesShape(draft("qqqxxxzzzvvv"))).toEqual({
      ok: false,
      reason: "consonantRun",
    });
  });

  it("rejects an all-consonant word (strncpy; y is NOT a vowel)", () => {
    // 7 consonants, H = log2(7) ≈ 2.81 — reject is correct per PRD rule 5.
    expect(passesShape(draft("strncpy"))).toEqual({
      ok: false,
      reason: "consonantRun",
    });
  });

  it("rejects a run of exactly 6 (bcdfgx) and accepts 5 (bcdfg)", () => {
    expect(passesShape(draft("bcdfgx"))).toEqual({
      ok: false,
      reason: "consonantRun",
    });
    expect(passesShape(draft("bcdfg"))).toEqual({ ok: true });
  });

  it("accepts lwlock (max consonant run 3, vowels break it)", () => {
    expect(passesShape(draft("lwlock"))).toEqual({ ok: true });
  });

  it("accepts when a digit breaks the would-be run (strnc9py)", () => {
    // Without the digit this is strncpy (7-run); "9" splits it into 5 + 2.
    // (The PRP's "zz9zzz" draft corrected: its entropy is ≈ 0.65 < 1.5, so
    // it rejects lowEntropy and cannot demonstrate this rule.)
    expect(passesShape(draft("strnc9py"))).toEqual({ ok: true });
  });
});

describe("passesShape — hexish & PRD §04 accepts", () => {
  it("passes a hexish whole token on general rules alone (f3a9c2e)", () => {
    // 7 distinct chars → H = log2(7) ≈ 2.81; digits break consonant runs.
    // No hexish special-casing (the ≥20-pure-hex secret rule is T2.S2's).
    expect(passesShape(draft("f3a9c2e"))).toEqual({ ok: true });
  });

  it("accepts the PRD exemplars; ok carries no reason key", () => {
    for (const key of ["zendesk", "lwlock", "nrel", "f3a9c2e"]) {
      const result = passesShape(draft(key));
      expect(result).toEqual({ ok: true });
      expect(result).not.toHaveProperty("reason");
    }
  });
});

describe("passesShape — reason precedence (first failure wins)", () => {
  it("aaaa → lowEntropy, not unigramRun (entropy precedes unigram)", () => {
    expect(passesShape(draft("aaaa"))).toEqual({
      ok: false,
      reason: "lowEntropy",
    });
  });

  it("qqq → tooShort (length precedes everything)", () => {
    expect(passesShape(draft("qqq"))).toEqual({
      ok: false,
      reason: "tooShort",
    });
  });

  it("65 identical chars → tooLong, not lowEntropy (length precedes entropy)", () => {
    expect(passesShape(draft("z".repeat(65)))).toEqual({
      ok: false,
      reason: "tooLong",
    });
  });

  it("never emits 'secret' — that reason belongs to P1.M2.T2.S2", () => {
    const keys = ["abc", "z".repeat(65), "aaaa", "blaaaah", "strncpy", "abababab"];
    for (const key of keys) {
      const r = passesShape(draft(key));
      if (!r.ok) expect(r.reason).not.toBe("secret");
    }
  });
});