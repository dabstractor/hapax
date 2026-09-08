/**
 * PRD §09 segment suite — base tokenization (PRD §04 rules 1–4, P1.M2.T1.S1)
 * and camelCase/snake_case subword expansion (PRD §04 h3.4/h3.5, P1.M2.T1.S2):
 * identifier/word extraction, length bounds, hexish capture + dedupe,
 * CJK/non-ASCII skipping, punctuation termination, document order; subword
 * splitting, hexish opacity, CandidateDraft normalization.
 *
 * Regex behaviors (41+ runs, 64-cap, dedupe shapes) verified empirically
 * against the exact PRD §04 regexes before the assertions were written.
 */

import { describe, expect, it } from "vitest";
import {
  expandCandidates,
  tokenize,
  type CandidateDraft,
} from "../src/core/segment.js";
import type { RawToken } from "../src/core/types.js";

const raws = (tokens: RawToken[]): string[] => tokens.map((t) => t.raw);

/** {raw, hexish} projection (P1.M1.T3.S1): token spans (start/end) get their
 *  own dedicated assertions in the "span offsets" block below, so the legacy
 *  shape cases keep their exact two-field literals. */
const strip = (
  tokens: RawToken[],
): Array<Pick<RawToken, "raw" | "hexish">> =>
  tokens.map(({ raw, hexish }) => ({ raw, hexish }));

describe("tokenize — base tokens (PRD §04 rule 1)", () => {
  it("extracts identifiers/words in order, original casing, hexish false", () => {
    expect(strip(tokenize("fix state Tokenized Hello"))).toEqual([
      { raw: "fix", hexish: false },
      { raw: "state", hexish: false },
      { raw: "Tokenized", hexish: false },
      { raw: "Hello", hexish: false },
    ]);
  });

  it("emits 2-char and 64-char identifiers, drops 1-char words", () => {
    expect(strip(tokenize("ok"))).toEqual([{ raw: "ok", hexish: false }]);
    expect(tokenize("a I b")).toEqual([]);
    const id = "z".repeat(64);
    expect(strip(tokenize(id))).toEqual([{ raw: id, hexish: false }]);
  });

  it("caps identifier matches at 64 chars (70-char identifier)", () => {
    // No \b in the base regex: the first match stops at the {0,63} cap and
    // the scan resumes mid-identifier — 70 chars yield 64 + 6.
    expect(raws(tokenize("z".repeat(70)))).toEqual([
      "z".repeat(64),
      "z".repeat(6),
    ]);
  });

  it("terminates tokens at punctuation/whitespace, no joins (rule 4)", () => {
    // PRD §09 enumerates the four segments; the "three words" in §04 prose
    // is a miscount — state/of/the/art is four.
    expect(raws(tokenize("state-of-the-art"))).toEqual([
      "state",
      "of",
      "the",
      "art",
    ]);
    expect(raws(tokenize("don't"))).toEqual(["don"]); // "t" is length 1 → dropped
    expect(raws(tokenize("foo_bar,baz"))).toEqual(["foo_bar", "baz"]); // _ is a word char
  });

  it("returns [] for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("tokenize — hexish tokens (PRD §04 rule 2)", () => {
  it("captures a digit-containing letter-initial hash as hexish", () => {
    // "f3a9c2e" matches both passes with equal spans; the digits prove
    // hash-shape → hexish wins (PRD §09: "f3a9c2e captured").
    expect(strip(tokenize("f3a9c2e"))).toEqual([{ raw: "f3a9c2e", hexish: true }]);
  });

  it("captures digit-leading hashes additively, absorbing the base tail", () => {
    // The base pass only sees the letter-initial tail "f3a9c2"; the hexish
    // span contains it, so one opaque token ships — spans never overlap.
    expect(strip(tokenize("0f3a9c2"))).toEqual([{ raw: "0f3a9c2", hexish: true }]);
  });

  it("keeps all-letter hex words as base tokens (base pass wins)", () => {
    // "abcdef" matches both passes equally but has no digit — plausibly a
    // word (decade, facade, deface) — so the base capture stands.
    expect(strip(tokenize("abcdef"))).toEqual([{ raw: "abcdef", hexish: false }]);
    expect(strip(tokenize("deadbeef"))).toEqual([
      { raw: "deadbeef", hexish: false },
    ]);
  });

  it("does not capture hex runs without letters", () => {
    expect(tokenize("123456")).toEqual([]);
    expect(tokenize("1234567890".repeat(5))).toEqual([]); // 50 digits
  });

  it("does not capture hexish from 41+ char all-letter runs", () => {
    // 42 hex letters: base captures the whole ≤64 run; the hexish scan's
    // last-40 match is strictly inside it → dropped. No hexish:true token.
    expect(strip(tokenize("abcdef".repeat(7)))).toEqual([
      { raw: "abcdef".repeat(7), hexish: false },
    ]);
  });

  it("captures a 40-char digit-led hexish run with a letter", () => {
    const s = "0" + "a".repeat(39);
    expect(strip(tokenize(s))).toEqual([{ raw: s, hexish: true }]);
  });

  it("bounds longer digit-led hex runs to the last 40 chars (regex-as-spec)", () => {
    // \b + {6,40} take the run's LAST 40 chars when it exceeds 40 (digit-led,
    // so no base capture absorbs it). Bounds stay 6–40; the shape gate's
    // ≥20-pure-hex rejection handles noise downstream (P1.M2.T2).
    const run = "1a".repeat(20) + "1"; // 41 chars, digit-led
    expect(strip(tokenize(`x ${run} y`))).toEqual([
      { raw: run.slice(1), hexish: true }, // last 40 chars
    ]);
  });

  it("does not treat a 5-char hex-letter string as hexish (too short)", () => {
    // Below the 6-char minimum; letter-initial and ≥ 2 chars → base token.
    expect(strip(tokenize("abcde"))).toEqual([{ raw: "abcde", hexish: false }]);
  });

  it("keeps hexish spans nested inside an identifier in the identifier", () => {
    // The inner hexish match is strictly inside the base capture → dropped.
    expect(strip(tokenize("xabcdef1"))).toEqual([
      { raw: "xabcdef1", hexish: false },
    ]);
  });
});

describe("tokenize — CJK and non-ASCII (PRD §04 rule 3)", () => {
  it("skips CJK runs, emitting nothing for them", () => {
    expect(strip(tokenize("前回の session トークン"))).toEqual([
      { raw: "session", hexish: false },
    ]);
  });

  it("disqualifies ASCII runs adjacent to a Unicode letter (rule 3, R2)", () => {
    expect(raws(tokenize("Þórhildur"))).toEqual([]);
    expect(raws(tokenize("ΩbsidianMirror"))).toEqual([]);
    expect(raws(tokenize("草sword"))).toEqual([]);
  });

  it("still captures space/punctuation-bounded ASCII after CJK runs", () => {
    expect(raws(tokenize("fix 方法 error"))).toEqual(["fix", "error"]);
    expect(raws(tokenize("漢字 word"))).toEqual(["word"]);
  });

  it("disqualifies hexish spans adjacent to a Unicode letter", () => {
    expect(tokenize("草0f3a9c2")).toEqual([]);
    expect(tokenize("0f3a9c2草")).toEqual([]);
  });

  it("keeps a following Unicode letter from leaking via trailing \\b (deadbeef草)", () => {
    expect(raws(tokenize("deadbeef草"))).toEqual([]);
  });
});

describe("tokenize — ordering and bounds invariants", () => {
  it("interleaves hexish tokens in textual position (document order)", () => {
    expect(strip(tokenize("aa 0f3a9c2 bb"))).toEqual([
      { raw: "aa", hexish: false },
      { raw: "0f3a9c2", hexish: true },
      { raw: "bb", hexish: false },
    ]);
  });

  it("holds 2–64 / 6–40 bounds and exact order over a mixed fixture", () => {
    const longId = "z".repeat(64);
    const longHex = "0" + "b".repeat(39);
    const mixed = [
      "fix",
      "state-of-the-art",
      "f3a9c2e",
      "0f3a9c2",
      "abcdef",
      "123456", // → nothing
      "前回の", // → nothing
      "session_token", // one token; splitting is S2's job
      "don't",
      longId,
      longHex,
      "deadbeef",
    ].join(" ");
    const expected: Array<Pick<RawToken, "raw" | "hexish">> = [
      { raw: "fix", hexish: false },
      { raw: "state", hexish: false },
      { raw: "of", hexish: false },
      { raw: "the", hexish: false },
      { raw: "art", hexish: false },
      { raw: "f3a9c2e", hexish: true },
      { raw: "0f3a9c2", hexish: true },
      { raw: "abcdef", hexish: false },
      { raw: "session_token", hexish: false },
      { raw: "don", hexish: false },
      { raw: longId, hexish: false },
      { raw: longHex, hexish: true },
      { raw: "deadbeef", hexish: false },
    ];
    expect(strip(tokenize(mixed))).toEqual(expected);
    for (const t of expected) {
      if (t.hexish) {
        expect(t.raw.length).toBeGreaterThanOrEqual(6);
        expect(t.raw.length).toBeLessThanOrEqual(40);
      } else {
        expect(t.raw.length).toBeGreaterThanOrEqual(2);
        expect(t.raw.length).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe("tokenize — span offsets (P1.M1.T3.S1)", () => {
  it("reports exact UTF-16 spans on the canonical mixed case", () => {
    expect(tokenize("fix 0f3a9c2 now")).toEqual([
      { raw: "fix", hexish: false, start: 0, end: 3 },
      { raw: "0f3a9c2", hexish: true, start: 4, end: 11 },
      { raw: "now", hexish: false, start: 12, end: 15 },
    ]);
  });

  it("spans are valid slice bounds, disjoint and ascending across mixed inputs", () => {
    const cases = [
      "fix 0f3a9c2 now",
      "state-of-the-art",
      "f3a9c2e deadbeef abcdef 123456", // dedupe shapes + digit run (→ nothing)
      "fixRoundingError HTTPServer session_token_valid", // camel/snake whole tokens
      `${"z".repeat(64)} ${"z".repeat(70)} ok`, // 64-cap overruns + 1-char drop
      `x ${"1a".repeat(20)}1 y`, // digit-led hex overrun → last 40 chars
      "0f3a9c2 absorbs its base-captured tail f3a9c2",
      "前回の session トークン", // CJK neighbors
      "𝕏 fix", // astral char = 2 UTF-16 units; offsets shift by 2, stay valid
    ];
    for (const text of cases) {
      const toks = tokenize(text);
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        // Offsets are UTF-16 code-unit indices into the exact input string —
        // always valid String.prototype.slice bounds (S2's gap-slice relies
        // on exactly this).
        expect(text.slice(t.start, t.end)).toBe(t.raw);
        // Disjoint, ascending (gap 0 only where spans merely abut).
        if (i > 0) expect(toks[i - 1].end).toBeLessThanOrEqual(t.start);
      }
    }
  });

  it("hexish token reports its own span, not an absorbed base tail's", () => {
    const [whole] = tokenize("0f3a9c2");
    expect(whole).toEqual({ raw: "0f3a9c2", hexish: true, start: 0, end: 7 });
    const text = "run 0f3a9c2!";
    const toks = tokenize(text);
    expect(toks).toHaveLength(2); // "run" + one opaque hexish token
    const t = toks[1];
    expect(t.hexish).toBe(true);
    expect(t.start).toBe(4);
    expect(t.end).toBe(11); // absorbed tail "f3a9c2" sits at 5..10 — not reported
    expect(text.slice(t.start, t.end)).toBe("0f3a9c2");
  });

  it("rejected non-ASCII-adjacent runs emit nothing", () => {
    expect(tokenize("Þórhildur ΩbsidianMirror 草x0f3a9c2")).toEqual([]);
  });

  it("spans survive CJK runs between tokens (fix 草sword error)", () => {
    const text = "fix 草sword error";
    // "草sword" is disqualified whole; 草 is ONE UTF-16 unit, so "error"
    // starts after it: f i x ␠ 草 s w o r d ␠ e r r o r → 11..16.
    expect(tokenize(text)).toEqual([
      { raw: "fix", hexish: false, start: 0, end: 3 },
      { raw: "error", hexish: false, start: 11, end: 16 },
    ]);
  });
});

describe("expandCandidates — camelCase/snake_case subwords (PRD §04 h3.4/h3.5)", () => {
  const expand = (raw: string): CandidateDraft[] =>
    expandCandidates({ raw, hexish: false, start: 0, end: raw.length });

  it("fixRoundingError → whole + Rounding + Error (fix dropped, len<4)", () => {
    expect(expand("fixRoundingError")).toEqual([
      {
        key: "fixroundingerror",
        display: "fixRoundingError",
        properName: false,
        isSubword: false,
      },
      {
        key: "rounding",
        display: "Rounding",
        properName: true,
        isSubword: true,
        parentKey: "fixroundingerror",
      },
      {
        key: "error",
        display: "Error",
        properName: true,
        isSubword: true,
        parentKey: "fixroundingerror",
      },
    ]);
  });

  it("HTTPServer → whole + HTTP + Server (acronym boundary before S only)", () => {
    expect(expand("HTTPServer")).toEqual([
      {
        key: "httpserver",
        display: "HTTPServer",
        properName: true,
        isSubword: false,
      },
      {
        key: "http",
        display: "HTTP",
        properName: true,
        isSubword: true,
        parentKey: "httpserver",
      },
      {
        key: "server",
        display: "Server",
        properName: true,
        isSubword: true,
        parentKey: "httpserver",
      },
    ]);
  });

  it("session_token_valid → whole (underscores kept) + session + token + valid", () => {
    expect(expand("session_token_valid")).toEqual([
      {
        key: "session_token_valid",
        display: "session_token_valid",
        properName: false,
        isSubword: false,
      },
      {
        key: "session",
        display: "session",
        properName: false,
        isSubword: true,
        parentKey: "session_token_valid",
      },
      {
        key: "token",
        display: "token",
        properName: false,
        isSubword: true,
        parentKey: "session_token_valid",
      },
      {
        key: "valid",
        display: "valid",
        properName: false,
        isSubword: true,
        parentKey: "session_token_valid",
      },
    ]);
  });

  it("plain word → single whole draft (no boundaries, no splitting)", () => {
    expect(expand("tokenizer")).toEqual([
      {
        key: "tokenizer",
        display: "tokenizer",
        properName: false,
        isSubword: false,
      },
    ]);
  });

  it("short whole word 'ok' survives (length gates are the shape gate's job)", () => {
    expect(expand("ok")).toEqual([
      { key: "ok", display: "ok", properName: false, isSubword: false },
    ]);
  });

  it("hexish tokens are opaque: exactly one whole draft, never split", () => {
    expect(
      expandCandidates({ raw: "f3a9c2e", hexish: true, start: 0, end: 7 }),
    ).toEqual([
      {
        key: "f3a9c2e",
        display: "f3a9c2e",
        properName: false,
        isSubword: false,
      },
    ]);
  });

  it("acronym with no trailing lowercase stays whole (HTTPS → 1 draft)", () => {
    expect(expand("HTTPS")).toEqual([
      { key: "https", display: "HTTPS", properName: true, isSubword: false },
    ]);
  });

  it("digit boundary: utf8Reader → whole + utf8 (len 4 kept) + Reader", () => {
    expect(expand("utf8Reader")).toEqual([
      {
        key: "utf8reader",
        display: "utf8Reader",
        properName: false,
        isSubword: false,
      },
      {
        key: "utf8",
        display: "utf8",
        properName: false,
        isSubword: true,
        parentKey: "utf8reader",
      },
      {
        key: "reader",
        display: "Reader",
        properName: true,
        isSubword: true,
        parentKey: "utf8reader",
      },
    ]);
  });

  it("'__init__' → whole with underscores + init (len 4 kept)", () => {
    expect(expand("__init__")).toEqual([
      {
        key: "__init__",
        display: "__init__",
        properName: false,
        isSubword: false,
      },
      {
        key: "init",
        display: "init",
        properName: false,
        isSubword: true,
        parentKey: "__init__",
      },
    ]);
  });

  it("normalization invariants: lowercase keys, parentKey iff isSubword, as-seen display", () => {
    const drafts = [
      ...expand("fixRoundingError"),
      ...expand("HTTPServer"),
      ...expand("session_token_valid"),
      ...expand("utf8Reader"),
      ...expand("__init__"),
      ...expand("HTTPS"),
    ];
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      expect(d.key).toBe(d.key.toLowerCase());
      expect(d.display.length).toBeGreaterThan(0);
      expect(d.properName).toBe(d.display[0] >= "A" && d.display[0] <= "Z");
      if (d.isSubword) {
        expect(typeof d.parentKey).toBe("string");
        expect(d.display).not.toContain("_");
      } else {
        expect(d.parentKey).toBeUndefined();
      }
    }
  });
});