/**
 * PRD §04 h2.23 shape-gate suite (P1.M2.T2.S1): length bounds (whole 2–64),
 * char-entropy < 1.5 bits/char, unigram runs ≥ 4, consonant
 * runs ≥ 6, hexish pass-through, reason precedence (length → entropy →
 * unigramRun → consonantRun), and the no-reason-on-ok contract.
 *
 * Secret-shape rejection (P1.M2.T2.S2) is covered in the "secret rules"
 * describe block below.
 *
 * Entropy expectations were verified against H = -Σ p_c · log2(p_c) with
 * node before the assertions were written (e.g. "blaaaah" ≈ 1.664, the
 * PRP's "waaaaaard" draft corrected: it is H ≈ 1.447 < 1.5 and would die
 * as lowEntropy before the unigram rule could fire).
 */

import { describe, expect, it } from "vitest";
import { passesShape } from "../src/core/shapeGate.js";
import type { CandidateDraft } from "../src/core/segment.js";

/** Whole-token draft (every draft is whole since the 2026-10 rule). */
const draft = (key: string): CandidateDraft => ({
  key,
  display: key,
  properName: false,
});

describe("passesShape — length (PRD §04 h2.23 rule 1)", () => {
  it("rejects a 1-char whole token as tooShort (length precedes entropy)", () => {
    // H("a") = 0 too, but the floor fires first — precedence pinned.
    expect(passesShape(draft("a"))).toEqual({ ok: false, reason: "tooShort" });
  });

  it("accepts a 3-char all-distinct whole token (TUI class — 2026 floor drop)", () => {
    // H = log2(3) ≈ 1.585 ≥ 1.5; "tui" is the floor drop's motivating case.
    expect(passesShape(draft("tui"))).toEqual({ ok: true });
  });

  it("accepts a 4-char all-distinct whole token", () => {
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
    // "aghi"×16: H = 2.0 bits/char, max unigram run 1, consonant runs of 2
    // (vowels a/i break them). (Not "abcd"×16 — a/b/c/d are all hex chars,
    // so that string is pure hex ≥ 20 and the secret rule rightly rejects it.)
    expect(passesShape(draft("aghi".repeat(16)))).toEqual({ ok: true });
  });

  it("accepts a 34-char whole token (the old 32-char sub-word cap is retired)", () => {
    // "s".repeat(33) used to pin the sub-word 32 cap; whole tokens cap
    // at 64, and a varied 33+ char key now passes (2026-10 rule).
    expect(passesShape(draft("aghi".repeat(8) + "jk"))).toEqual({ ok: true });
  });
});

describe("passesShape — path-class caps (2026-10 rule 4d, 4–96)", () => {
  /** Path-class draft: key is the trimmed lowercase form, display the
   *  ORIGINAL raw (leading '/', casing, etc. — what isSecretShaped must
   *  see, per the S1 segmentation contract). */
  const pathDraft = (key: string, display = key): CandidateDraft => ({
    key,
    display,
    properName: false,
    path: true,
  });

  // Boundary keys: the letter cycle keeps every OTHER rule silent so ONLY
  // the length rule can fire. A 26-letter cycle has H ≈ 4.7 bits/char (≫
  // 1.5), no unigram runs, and max consonant runs of 5 (< 6) at the
  // junctions; a 2-letter alternation would die lowEntropy (H = 1.0)
  // before the cap could matter. "src/" + 3 cycles + prefix = 96/97;
  // all-lowercase keeps the base64url secret rule inert (needs uppercase
  // AND ≥ 2 digits in a ≥ 16 run).
  const key96 = "src/" + "abcdefghijklmnopqrstuvwxyz".repeat(3) + "abcdefghijklmn";
  const key97 = "src/" + "abcdefghijklmnopqrstuvwxyz".repeat(3) + "abcdefghijklmno";

  it("accepts an ordinary deep path (src/core/query.ts)", () => {
    expect(passesShape(pathDraft("src/core/query.ts"))).toEqual({ ok: true });
  });

  it("accepts a trimmed absolute path (leading '/' stripped from the key)", () => {
    expect(passesShape(pathDraft("/home/user/projects/hapax".slice(1)))).toEqual({
      ok: true,
    });
  });

  it("accepts a 96-char path key (class ceiling — beyond MAX_WHOLE_LENGTH 64)", () => {
    expect(key96.length).toBe(96);
    expect(passesShape(pathDraft(key96))).toEqual({ ok: true });
  });

  it("rejects a 97-char path key as tooLong", () => {
    expect(key97.length).toBe(97);
    expect(passesShape(pathDraft(key97))).toEqual({
      ok: false,
      reason: "tooLong",
    });
  });

  it("rejects a 3-char path key as tooShort (floor 4, not the global 2)", () => {
    // H("a/b") = log2(3) ≈ 1.585 would clear entropy — the floor is the
    // ONLY reason this rejects.
    expect(passesShape(pathDraft("a/b"))).toEqual({
      ok: false,
      reason: "tooShort",
    });
  });

  it("accepts a 4-char path key at the floor boundary", () => {
    expect(passesShape(pathDraft("a/b/c"))).toEqual({ ok: true });
  });

  it("base floor is unchanged: a 2-char non-path key dies lowEntropy, not tooShort", () => {
    // H("ab") = 1.0 < 1.5 — entropy, not the global floor, rejects it.
    expect(passesShape(draft("ab"))).toEqual({
      ok: false,
      reason: "lowEntropy",
    });
  });

  it("rejects a path whose display is email-shaped ('@' + '.') as secret", () => {
    // isSecretShaped sees the ORIGINAL raw display — '@' survives there
    // even though the trimmed key is lowercase slash-form.
    expect(
      passesShape(pathDraft("example.com/a/b", "user@example.com/a/b")),
    ).toEqual({ ok: false, reason: "secret" });
  });

  it("rejects a base64url-texture path segment as secret (conservative whole reject)", () => {
    // Rule 5: a ≥ 16-char [A-Za-z0-9_-] run with ≥ 1 lowercase, ≥ 1
    // uppercase, AND ≥ 2 digits — "aB12xY34zQ56wE78" is exactly 16. The
    // whole candidate rejects (spec'd conservative behavior), key form
    // lowercase as segmentation would emit it.
    expect(
      passesShape(pathDraft("src/ab12xy34zq56we78/b", "src/aB12xY34zQ56wE78/b")),
    ).toEqual({ ok: false, reason: "secret" });
  });

  it("rejects a low-entropy letter-bearing path key as lowEntropy", () => {
    // '/' is not [a-z], but the key contains letters — the entropy floor
    // applies as-is (H("a/a/a/a") = 1.0 < 1.5). No path special-case.
    expect(passesShape(pathDraft("a/a/a/a"))).toEqual({
      ok: false,
      reason: "lowEntropy",
    });
  });

  it("length precedes secret: a 97-char key with a base64url-shaped display is tooLong", () => {
    // The display carries a qualifying 16-char base64url run (would be
    // 'secret' if reached) — the precedence contract (length → secret)
    // pins tooLong.
    expect(
      passesShape(pathDraft(key97, "aB12xY34zQ56wE78/" + key97)),
    ).toEqual({ ok: false, reason: "tooLong" });
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

  it("qqq → lowEntropy (3-char passes length since the 2026 floor drop)", () => {
    expect(passesShape(draft("qqq"))).toEqual({
      ok: false,
      reason: "lowEntropy",
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

describe("secret rules (PRD §04 h2.23 rule 3 / §09 item 5)", () => {
  it("rejects known key prefixes, case-insensitively on the raw display", () => {
    const secrets = [
      "sk-abc123DEF456ghi789",
      "SK-Abc123def456ghi789", // uppercase prefix must match too
      "ghp_16CHARACTERSTOKEN0000",
      "gho_TokenAbc123def45678",
      "github_pat_11AAAA0000bbbb0000",
      "xoxb-1234567890123456",
      "AKIAIOSFODNN7EXAMPLE",
      "AIzaSyA1234567890abcdefghijklmnop",
      "eyJhbGciOiJIUzI1NiIsInR5", // JWT body: base64(`{"`)
    ];
    for (const key of secrets) {
      expect(passesShape(draft(key))).toEqual({ ok: false, reason: "secret" });
    }
  });

  it("digit+symbol ratio rule RETIRED (2026-10): IP:port passes; card-shaped pure decimals still reject", () => {
    // Owner call 2026-10: the flat "> 0.4 digit+symbol at ≥ 16" heuristic
    // predated technical literals and rejected exactly the class hapax
    // exists for. It is deleted; its numeric-soup coverage moved to the
    // pure-decimal floor (≥ 16 digits, no letters/symbols — PAN shape).
    expect(passesShape(draft("192.168.1.1:8080"))).toEqual({ ok: true });
    expect(passesShape(draft("2026-09-15T10:30:00Z"))).toEqual({ ok: true });
    expect(passesShape(draft("5105105105210510"))).toEqual({
      // 16 digits, no separators — card-shaped; the replacement rule fires
      ok: false,
      reason: "secret",
    });
    expect(passesShape(draft("123456789012345"))).toEqual({ ok: true }); // 15 digits: IMEI/epoch scale, under the floor
    // The old rule's own exemplar (lowercase alnum+underscore, 20 chars,
    // ratio 0.5) now sails through — accepted residue: all-lowercase
    // non-hex random alnum is prose-guarded, and maskSecrets owns real
    // key formats.
    expect(passesShape(draft("ab12cd34ef56gh78ij9_"))).toEqual({ ok: true });
  });

  it("ratio exactly 0.4 does not fire (reject is strictly > 0.4)", () => {
    // 20 chars, exactly 8 noisy (8 digits, no symbols) → 8/20 = 0.4, not
    // > 0.4 — the candidate sails through the whole gate.
    expect(passesShape(draft("a1b2c3d4e5f6g7h8ijkl"))).toEqual({ ok: true });
  });

  it("length-16+ identifier with ratio ≤ 0.4 passes (rule is not over-eager)", () => {
    expect(
      passesShape({
        key: "camelcaseidentifierx9",
        display: "camelCaseIdentifierX9",
        properName: false,
      })
    ).toEqual({ ok: true });
  });

  it("rejects a ≥ 24 base64 run with mixed case + digit + '/'", () => {
    // One 26-char run with all four classes; its digit+symbol ratio
    // (8/26 ≈ 0.31) is under 0.4, so the run rule itself fires.
    expect(passesShape(draft("abcdefghij012345ABCD+/xyzw"))).toEqual({
      ok: false,
      reason: "secret",
    });
  });

  it("rejects a base64 run embedded mid-string, not just whole-string shape", () => {
    // '_' breaks the first run; the 26-char tail run (abcdefghij0123456789
    // ABCD+/) carries all four classes. Ratio (10 digits + 3 syms)/35 ≈ 0.37
    // stays under 0.4 — the embedded run is what fires.
    expect(passesShape(draft("wxyz_abcdefghij0123456789ABCD+/qrst"))).toEqual({
      ok: false,
      reason: "secret",
    });
  });

  it("rejects a 30-char alphanumeric-only mixed-case+digit run (BUG-003 rule 6)", () => {
    // Supersedes the old "alphanumeric-only run passes" pin: base64url
    // payloads never contain '+'/'/', so rule 6 (≥ 16-char run, mixed case,
    // ≥ 2 digits) deliberately catches exactly this leak shape.
    expect(passesShape(draft("abcdefghij012345ABCDEFGHIJklmn"))).toEqual({
      ok: false,
      reason: "secret",
    });
  });

  it("rejects whole-candidate pure hex ≥ 20 (private-key-shaped)", () => {
    // All-letter hex keeps the digit ratio at 2/20 = 0.1, isolating the
    // pure-hex rule from the ratio rule.
    expect(passesShape(draft("abcdefabcdefabcdef01"))).toEqual({
      ok: false,
      reason: "secret",
    });
    // Uppercase hex must match too (rule tests the lowercased display).
    expect(passesShape(draft("A1B2C3D4E5F6A7B8C9D0E1F2"))).toEqual({
      ok: false,
      reason: "secret",
    });
  });

  it("admits the 13–15 hex band and structured (low-entropy) 16–19 hex", () => {
    // 15 hexish chars — below the ratio gate (16), the BUG-003 rule 6/7
    // floors (16), and the pure-hex rule (20).
    expect(passesShape(draft("a1b2c3d4e5f6a7b"))).toEqual({ ok: true });
    // BUG-003 rule 7b narrowed the 16–19 band: only genuinely random-
    // looking hex (entropy ≥ 3.0) rejects; structured repeats like this
    // 16-char H = 2.0 string stay admitted. (The old 19-char pin
    // "abcdefabcdefabc1234" has H ≈ 3.18 and now rejects — see the
    // BUG-003 block below.)
    expect(passesShape(draft("abcabcabcdefabcd"))).toEqual({ ok: true });
  });

  it("rejects '@' plus '.' (email belt-and-braces on directly-built drafts)", () => {
    // Real segmentation never emits '@'; the gate still defends in depth.
    expect(passesShape(draft("user.name@corp.com"))).toEqual({
      ok: false,
      reason: "secret",
    });
  });

  it("'sk-' (3 chars) rejects as secret since the floor drop; 65-char prefixed is tooLong", () => {
    // Length still precedes secret — but no secret rule can fire under
    // 2 chars (shortest prefix is 3), so the boundary case is only the
    // cap: a secret-shaped draft over MAX_WHOLE_LENGTH is tooLong.
    expect(passesShape(draft("sk-"))).toEqual({
      ok: false,
      reason: "secret",
    });
    expect(passesShape(draft("sk-" + "a".repeat(62)))).toEqual({
      ok: false,
      reason: "tooLong",
    });
  });

  it("secret precedes entropy: 'sk-aaaa' rejects as secret, not lowEntropy", () => {
    // H("sk-aaaa") < 1.5 would fire entropy if the prefix rule ran later.
    expect(passesShape(draft("sk-aaaa"))).toEqual({
      ok: false,
      reason: "secret",
    });
  });

  it("still admits everyday words and hexish tokens (no false positives)", () => {
    for (const key of ["zendesk", "lwlock", "nrel", "f3a9c2e"]) {
      expect(passesShape(draft(key))).toEqual({ ok: true });
    }
    // Mixed-case display must not trip the case-insensitive prefix match.
    expect(
      passesShape({
        key: "nrel",
        display: "NREL",
        properName: true,
      })
    ).toEqual({ ok: true });
  });
});

describe(
  "secret residue rules (BUG-003: base64url run + charset-relative entropy)",
  () => {
    it("rejects the BUG-003 OpenAI residue payload (rule 6: no '+'/'/' needed)", () => {
      // 35 chars: 13 lower / 12 upper / 10 digits. Earlier rules are all
      // silent — digit+symbol ratio 10/35 ≈ 0.29, alphanumeric-only (rule 4
      // wants '+'/'/'), not hex — rule 6 is the only catcher. H ≈ 5.13.
      expect(
        passesShape(draft("4t7RX2bQ9wLm3vN8xKpZ6dJh1cA5eFgH0iU"))
      ).toEqual({ ok: false, reason: "secret" });
    });

    it("rule 6 minimal hit: exactly 16 chars, ≥1 lower + ≥1 upper + 2 digits", () => {
      expect(passesShape(draft("Ab3xK9pQ2wLm5nRt"))).toEqual({
        ok: false,
        reason: "secret",
      });
    });

    it("rule 6 spans '_' and '-' (base64url alphabet — rule 4 excludes them)", () => {
      // '_' is a run char, not a break: one 16-char run (7/5/3).
      expect(passesShape(draft("Ab_xK9pQ2wLm5nRt"))).toEqual({
        ok: false,
        reason: "secret",
      });
      // '-' joins both sides into a single 21-char run (8/7/5).
      expect(passesShape(draft("Ab3xK9pQ2wLm5nRt-vV9Z"))).toEqual({
        ok: false,
        reason: "secret",
      });
      // A run fully embedded mid-string ('.' is a true run break).
      expect(passesShape(draft("zz.Ab3xK9pQ2wLm5nRt.zz"))).toEqual({
        ok: false,
        reason: "secret",
      });
    });

    it("rule 6 boundary: 15 chars passes (floor is exactly 16)", () => {
      // H ≈ 3.91, no consonant/unigram violations — only the run floor
      // keeps this admitted.
      expect(passesShape(draft("Ab3xK9pQ2wLm5nR"))).toEqual({ ok: true });
    });

    it("rule 6 digit/case guards are load-bearing (identifiers must survive)", () => {
      // 16 chars, mixed case, ZERO digits — the ≥ 2-digit requirement is
      // the only thing standing between camelCase and the gate.
      expect(passesShape(draft("fixRoundingError"))).toEqual({ ok: true });
      // 1 digit still sits under the ≥ 2 requirement.
      expect(passesShape(draft("tokenizerProQ5"))).toEqual({ ok: true });
      // SCREAMING_CASE constants: zero lowercase → rule 6 can't fire.
      expect(passesShape(draft("MAX_RETRIES_EXCEEDED"))).toEqual({ ok: true });
      expect(passesShape(draft("SOME_CONST_NAME_VALUE"))).toEqual({ ok: true });
      // Under the 16 floor entirely.
      expect(passesShape(draft("HTTPServer"))).toEqual({ ok: true });
      // Long all-lowercase English word: H ≈ 3.2 < 4.5, no digits.
      expect(passesShape(draft("characterization"))).toEqual({ ok: true });
    });

    it("rule 7a: high-entropy base64url run with a single digit (rule 6 misses)", () => {
      // 28 chars, all distinct → H = log2(28) ≈ 4.81 ≥ 4.5. ONE digit
      // (rule 6 needs ≥ 2) but the '_' satisfies 7a's symbol guard.
      expect(passesShape(draft("abcdefghijklmnopqrstuvwxyz_1"))).toEqual({
        ok: false,
        reason: "secret",
      });
    });

    it("rule 7a boundary: all-lowercase no-digit tails stay admitted (masking owns them)", () => {
      // Slack-tail-shaped: H ≈ 4.59 ≥ 4.5 but ZERO digits and no symbol →
      // neither rule 6 nor 7a fires, BY DESIGN. The maskSecrets Slack regex
      // owns the full xoxb-… key; weakening 7a's digit/mixed-case guard to
      // catch the bare tail would false-positive prose (PRP FINAL CALL —
      // pinned as admitted).
      expect(passesShape(draft("abcdefghijklmnopqrstuvwx"))).toEqual({
        ok: true,
      });
    });

    it("rule 7b: random-looking 16-char hex rejects (closes the 16–19 gap)", () => {
      // 12 distinct hex chars → H = 3.5 ≥ 3.0, and every earlier rule is
      // silent so 7b is the isolated catcher: 6/16 digits = 0.375 stays
      // under the ratio gate, single case + no symbol keeps 7a off, and
      // 16 < 20 keeps pure-hex rule 5 off.
      expect(passesShape(draft("abcdef012345abcd"))).toEqual({
        ok: false,
        reason: "secret",
      });
      // Uppercase variant — 7b tests the lowercased display, like rule 5.
      expect(passesShape(draft("ABCDEF012345ABCD"))).toEqual({
        ok: false,
        reason: "secret",
      });
      // Below the floor: the hexish 13–15 band is untouched (14 chars).
      expect(passesShape(draft("deadbeefcafe12"))).toEqual({ ok: true });
    });

    it("layering boundary: AWS-fragment shapes stay gate-admitted (maskSecrets owns them)", () => {
      // Mixed case, NO digits → rules 6/7 can't fire by design; catching
      // these at the gate would mean dropping the digit guard and
      // false-positiving camelCase identifiers. maskSecrets' AWS catch-all
      // is the catcher when the full 40-char key is present.
      expect(passesShape(draft("wJalrXUtnFEMI"))).toEqual({ ok: true });
      expect(passesShape(draft("bPxRfiCYEXAMPLEKEY"))).toEqual({ ok: true });
    });

    it("hexish 6–12 admissions and the PRD exemplars are unchanged", () => {
      for (const key of ["zendesk", "lwlock", "nrel", "f3a9c2e", "abcdef"]) {
        expect(passesShape(draft(key))).toEqual({ ok: true });
      }
    });
  }
);
describe("technical-literal interplay (2026-10 rule 4c)", () => {
  const draft = (key: string): CandidateDraft => ({
    key,
    display: key,
    properName: false,
  });

  it("letter-free keys skip the entropy floor: repeating digit codes pass", () => {
    // "8080" = 1.0 bits/char — a real port shape, not noise.
    expect(passesShape(draft("8080"))).toEqual({ ok: true });
    expect(passesShape(draft("10.0.0.1"))).toEqual({ ok: true });
    expect(passesShape(draft("12:34"))).toEqual({ ok: true });
  });

  it("unigram-run still rejects pure repetition in digit codes", () => {
    expect(passesShape(draft("1111"))).toEqual({ ok: false, reason: "unigramRun" });
    expect(passesShape(draft("0000"))).toEqual({ ok: false, reason: "unigramRun" });
  });

  it("letter-bearing keys keep the entropy floor unchanged", () => {
    expect(passesShape(draft("aaaaa"))).toEqual({ ok: false, reason: "lowEntropy" });
  });

  it("digit-bearing email-shaped literals reject as secrets (unchanged)", () => {
    // The literal pass segments "user2@host.com" whole; the gate's
    // '@' + '.' rule still owns it.
    expect(passesShape(draft("user2@host.com"))).toEqual({ ok: false, reason: "secret" });
  });

  it("the motivating literal passes the gate", () => {
    expect(passesShape(draft("2560x1440@2"))).toEqual({ ok: true });
    expect(passesShape(draft("v1.2.3"))).toEqual({ ok: true });
    expect(passesShape(draft("192.168.1.1"))).toEqual({ ok: true });
    expect(passesShape(draft("4:36"))).toEqual({ ok: true });
  });
});
