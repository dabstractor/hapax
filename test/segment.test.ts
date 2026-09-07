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

describe("tokenize — base tokens (PRD §04 rule 1)", () => {
  it("extracts identifiers/words in order, original casing, hexish false", () => {
    expect(tokenize("fix state Tokenized Hello")).toEqual([
      { raw: "fix", hexish: false },
      { raw: "state", hexish: false },
      { raw: "Tokenized", hexish: false },
      { raw: "Hello", hexish: false },
    ]);
  });

  it("emits 2-char and 64-char identifiers, drops 1-char words", () => {
    expect(tokenize("ok")).toEqual([{ raw: "ok", hexish: false }]);
    expect(tokenize("a I b")).toEqual([]);
    const id = "z".repeat(64);
    expect(tokenize(id)).toEqual([{ raw: id, hexish: false }]);
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
    expect(tokenize("f3a9c2e")).toEqual([{ raw: "f3a9c2e", hexish: true }]);
  });

  it("captures digit-leading hashes additively, absorbing the base tail", () => {
    // The base pass only sees the letter-initial tail "f3a9c2"; the hexish
    // span contains it, so one opaque token ships — spans never overlap.
    expect(tokenize("0f3a9c2")).toEqual([{ raw: "0f3a9c2", hexish: true }]);
  });

  it("keeps all-letter hex words as base tokens (base pass wins)", () => {
    // "abcdef" matches both passes equally but has no digit — plausibly a
    // word (decade, facade, deface) — so the base capture stands.
    expect(tokenize("abcdef")).toEqual([{ raw: "abcdef", hexish: false }]);
    expect(tokenize("deadbeef")).toEqual([{ raw: "deadbeef", hexish: false }]);
  });

  it("does not capture hex runs without letters", () => {
    expect(tokenize("123456")).toEqual([]);
    expect(tokenize("1234567890".repeat(5))).toEqual([]); // 50 digits
  });

  it("does not capture hexish from 41+ char all-letter runs", () => {
    // 42 hex letters: base captures the whole ≤64 run; the hexish scan's
    // last-40 match is strictly inside it → dropped. No hexish:true token.
    expect(tokenize("abcdef".repeat(7))).toEqual([
      { raw: "abcdef".repeat(7), hexish: false },
    ]);
  });

  it("captures a 40-char digit-led hexish run with a letter", () => {
    const s = "0" + "a".repeat(39);
    expect(tokenize(s)).toEqual([{ raw: s, hexish: true }]);
  });

  it("bounds longer digit-led hex runs to the last 40 chars (regex-as-spec)", () => {
    // \b + {6,40} take the run's LAST 40 chars when it exceeds 40 (digit-led,
    // so no base capture absorbs it). Bounds stay 6–40; the shape gate's
    // ≥20-pure-hex rejection handles noise downstream (P1.M2.T2).
    const run = "1a".repeat(20) + "1"; // 41 chars, digit-led
    expect(tokenize(`x ${run} y`)).toEqual([
      { raw: run.slice(1), hexish: true }, // last 40 chars
    ]);
  });

  it("does not treat a 5-char hex-letter string as hexish (too short)", () => {
    // Below the 6-char minimum; letter-initial and ≥ 2 chars → base token.
    expect(tokenize("abcde")).toEqual([{ raw: "abcde", hexish: false }]);
  });

  it("keeps hexish spans nested inside an identifier in the identifier", () => {
    // The inner hexish match is strictly inside the base capture → dropped.
    expect(tokenize("xabcdef1")).toEqual([{ raw: "xabcdef1", hexish: false }]);
  });
});

describe("tokenize — CJK and non-ASCII (PRD §04 rule 3)", () => {
  it("skips CJK runs, emitting nothing for them", () => {
    expect(tokenize("前回の session トークン")).toEqual([
      { raw: "session", hexish: false },
    ]);
  });

  it("resumes ASCII tokens after a non-ASCII run", () => {
    expect(raws(tokenize("fix 方法 error"))).toEqual(["fix", "error"]);
  });
});

describe("tokenize — ordering and bounds invariants", () => {
  it("interleaves hexish tokens in textual position (document order)", () => {
    expect(tokenize("aa 0f3a9c2 bb")).toEqual([
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
    const expected: RawToken[] = [
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
    expect(tokenize(mixed)).toEqual(expected);
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

describe("expandCandidates — camelCase/snake_case subwords (PRD §04 h3.4/h3.5)", () => {
  const expand = (raw: string): CandidateDraft[] =>
    expandCandidates({ raw, hexish: false });

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
    expect(expandCandidates({ raw: "f3a9c2e", hexish: true })).toEqual([
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