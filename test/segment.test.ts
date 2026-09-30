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
  classifyPath,
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

  it("hyphenated compounds are ONE token (2026-09 compound rule); apostrophes still split", () => {
    // Rule 4 flipped by the owner (2026-09): a hyphen between word
    // segments does not split — the compound as typed is the completion
    // target, parts absorbed like the filename pass.
    expect(raws(tokenize("state-of-the-art"))).toEqual(["state-of-the-art"]);
    expect(raws(tokenize("load-bearing wall"))).toEqual(["load-bearing", "wall"]);
    expect(raws(tokenize("e2e-test ok"))).toEqual(["e2e-test", "ok"]);
    expect(raws(tokenize("2e-test ok"))).toEqual(["2e-test", "ok"]); // 2026-10 rule 4c: digit-initial compounds are technical literals
    expect(raws(tokenize("don't"))).toEqual(["don"]); // "t" is length 1 → dropped
  });

  it("leading/doubled hyphens never form tokens (CLI flags are not candidates)", () => {
    expect(raws(tokenize("--flag -v value"))).toEqual(["flag", "value"]);
    expect(raws(tokenize("git-log --verbose"))).toEqual(["git-log", "verbose"]);
  });

  it("compound tokens carry sentenceStart like any other", () => {
    const [c] = tokenize("done. Load-bearing work").filter((t) => t.raw === "Load-bearing");
    expect(c.sentenceStart).toBe(true); // directly after ". " — orthographic capital
    const [m] = tokenize("the load-bearing wall").filter((t) => t.raw === "load-bearing");
    expect(m.raw).toBe("load-bearing");
    expect(m.sentenceStart).toBe(false); // mid-sentence
  });

  it("underscores are word chars; commas still terminate", () => {
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

  it("captures digit runs as literals, never as hexish (2026-10 rule 4c)", () => {
    // Pure digits never hexish (no letters); ≥4-digit runs are now
    // technical-literal tokens per the owner's "numbers over 3 digits"
    // rule, opaque like hexish.
    expect(strip(tokenize("123456"))).toEqual([{ raw: "123456", hexish: false }]);
    // 50 digits: literal cap is 64, so the whole run is one literal
    // token (the shape gate's ≥20-pure-hex rejection still owns it).
    expect(strip(tokenize("1234567890".repeat(5)))).toEqual([
      { raw: "1234567890".repeat(5), hexish: false },
    ]);
    // 3 digits stay out ("over 3 digits" floor).
    expect(tokenize("123")).toEqual([]);
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
    // 2026-10 rule 4c: a 41-char digit-bearing run is ALSO a technical
    // literal spanning all 41 chars, which absorbs the 40-char hexish
    // match — same raw minus the first char, and the literal is the
    // user-visible completion target (typed-shape unit).
    const run = "1a".repeat(20) + "1"; // 41 chars, digit-led
    expect(raws(tokenize(`x ${run} y`))).toEqual([run]); // whole run, literal
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

describe("astral before-side boundary guard (BUG-004)", () => {
  // 𝔘 = U+1D518 (mathematical Fraktur U) — ONE code point, TWO UTF-16
  // units. codePointAt() over its trailing (low) surrogate returns the
  // lone surrogate, which is not \p{L}; the before-side guard must back
  // up one extra code unit to resolve the full pair. The after side was
  // always correct (codePointAt at a HIGH surrogate returns the pair).
  it("an astral letter immediately BEFORE a run disqualifies it (the bug)", () => {
    expect(raws(tokenize("𝔘sword"))).toEqual([]);
  });

  it("an astral letter immediately AFTER a run disqualifies it (pin the correct side)", () => {
    expect(raws(tokenize("sword𝔘"))).toEqual([]);
  });

  it("BMP letters on either side stay disqualified (pin)", () => {
    expect(raws(tokenize("ΩbsidianMirror"))).toEqual([]);
    expect(raws(tokenize("Þórhildur"))).toEqual([]);
    expect(raws(tokenize("éabc"))).toEqual([]);
    expect(raws(tokenize("abcé"))).toEqual([]);
  });

  it("an astral letter between two runs kills both", () => {
    expect(raws(tokenize("aa𝔘bb"))).toEqual([]);
  });

  it("hexish span with an astral prefix yields nothing AND leaks no base tail", () => {
    expect(tokenize("𝔘0f3a9c2")).toEqual([]);
    expect(raws(tokenize("𝔘0f3a9c2"))).not.toContain("f3a9c2");
  });

  it("hexish span with an astral suffix stays disqualified (pin)", () => {
    expect(tokenize("0f3a9c2𝔘")).toEqual([]);
  });

  it("non-adjacent astral letters do not affect runs (offsets stay UTF-16-correct)", () => {
    expect(raws(tokenize("𝔘 sword"))).toEqual(["sword"]);
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
      "123456", // → literal (2026-10 rule 4c: ≥4-digit run)
      "前回の", // → nothing
      "session_token", // one token; splitting is S2's job
      "don't",
      longId,
      longHex,
      "deadbeef",
    ].join(" ");
    const expected: Array<Pick<RawToken, "raw" | "hexish">> = [
      { raw: "fix", hexish: false },
      { raw: "state-of-the-art", hexish: false }, // ONE compound (2026-09 rule)
      { raw: "f3a9c2e", hexish: true },
      { raw: "0f3a9c2", hexish: true },
      { raw: "abcdef", hexish: false },
      { raw: "123456", hexish: false }, // pure-digit literal (rule 4c)
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
      { raw: "fix", hexish: false, start: 0, end: 3, sentenceStart: true },
      { raw: "0f3a9c2", hexish: true, start: 4, end: 11, sentenceStart: false },
      { raw: "now", hexish: false, start: 12, end: 15, sentenceStart: false },
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
      "FOO_1_", // BUG-002 straddle class: '_' is a base word char AND a
      "rename FOO_1_ ok", // literal trim symbol — spans must stay disjoint
      "USER_2_TOKEN_",
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
    expect(whole).toEqual({ raw: "0f3a9c2", hexish: true, start: 0, end: 7, sentenceStart: true });
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
      { raw: "fix", hexish: false, start: 0, end: 3, sentenceStart: true },
      { raw: "error", hexish: false, start: 11, end: 16, sentenceStart: false },
    ]);
  });
});

describe("expandCandidates — camelCase/snake_case subwords (PRD §04 h3.4/h3.5)", () => {
  const expand = (raw: string): CandidateDraft[] =>
    expandCandidates({ raw, hexish: false, start: 0, end: raw.length, sentenceStart: false });

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
      expandCandidates({ raw: "f3a9c2e", hexish: true, start: 0, end: 7, sentenceStart: false }),
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
describe("sentence-start flag + properName suppression (2026-09 rule)", () => {
  const starts = (text: string): boolean[] =>
    tokenize(text).map((t) => t.sentenceStart);

  it("token after '. ', '! ', '? ' (incl. newline + closers) is sentenceStart", () => {
    expect(starts("Done. Check the logs")).toEqual([
      true, // Done — ALSO line-initial (message start) under the extended rule
      true, // Check (after ". ")
      false, // the
      false, // logs
    ]);
    expect(starts("Wow! Really?")[1]).toBe(true); // Really after "! "
    expect(starts("Sure? Yes")[1]).toBe(true);
    expect(starts('He said." Quietly')).toEqual([true, false, true]); // He line-initial; Quietly after closers
    expect(starts("One.\nTwo")[1]).toBe(true); // newline is whitespace
  });

  it("mid-sentence capitals are NOT structural; message/line starts and bullets ARE", () => {
    expect(starts("Check the National labs")).toEqual([
      true, // Check — message start IS structural now (the live-audit extension)
      false,
      false, // National mid-sentence — the only capital that still counts as evidence
      false,
    ]);
    expect(starts("- Bulleted Item here")).toEqual([true, false, false]); // Bulleted after "- " marker
    expect(starts("## Heading Word")).toEqual([true, false]); // 2 tokens; Heading after "## "
    expect(starts("Note: This follows a colon")).toEqual([true, true, false, false]); // 4 tokens (a dropped, len<2)
    expect(starts("v2.5 Release")).toEqual([true, false]); // v2 line-initial; Release preceded by '5', not '.'
  });

  it("expandCandidates suppresses properName for sentence-initial capitals (whole + first sub)", () => {
    const [afterDot] = tokenize(". Check");
    const [, midText] = tokenize("then Check"); // the Check token, mid-sentence
    expect(afterDot.sentenceStart).toBe(true);
    expect(midText.sentenceStart).toBe(false);
    const [afterDraft] = expandCandidates(afterDot);
    const [midDraft] = expandCandidates(midText);
    expect(afterDraft.properName).toBe(false); // orthographic capital
    expect(midDraft.properName).toBe(true); // genuine capitalization signal

    // First sub-word of a sentence-initial identifier too.
    const [init] = tokenize(". DownloadManager");
    const subs = expandCandidates(init).filter((d) => d.isSubword);
    expect(subs[0]!.key).toBe("download");
    expect(subs[0]!.properName).toBe(false);
    expect(subs[1]!.key).toBe("manager");
    expect(subs[1]!.properName).toBe(true); // mid-token camel capital keeps the hint
  });
});

describe("dotted filename tokens (2026-09 rule)", () => {
  const rawsOf = (text: string): string[] => tokenize(text).map((t) => t.raw);

  it("'AGENTS.md' is ONE token; the bare 'AGENTS' is absorbed", () => {
    expect(rawsOf("see AGENTS.md please")).toEqual(["see", "AGENTS.md", "please"]);
  });

  it("multi-dot extensions and ordinary filenames", () => {
    expect(rawsOf("package.json file.tar.gz")).toEqual(["package.json", "file.tar.gz"]);
  });

  it("version numbers and decimals ARE literal tokens (2026-10 rule 4c; were deliberately split by the filename rule)", () => {
    expect(rawsOf("v1.2.3 and 3.14")).toEqual(["v1.2.3", "and", "3.14"]);
  });

  it("the filename token carries sentenceStart and properName correctly", () => {
    const toks = tokenize("done. See AGENTS.md now");
    const fn = toks.find((t) => t.raw === "AGENTS.md")!;
    expect(fn.sentenceStart).toBe(false); // preceded by "See " — mid-sentence
    const [draft] = expandCandidates(fn);
    expect(draft.key).toBe("agents.md");
    expect(draft.properName).toBe(true); // 'A' capitalized, not sentence-initial

    const initialToks = tokenize(". AGENTS.md please");
    const initFn = expandCandidates(
      initialToks.find((t) => t.raw === "AGENTS.md")!,
    ).filter((d) => d.key === "agents.md");
    expect(initFn[0]!.properName).toBe(false); // directly after ". " — orthographic
  });
});

describe("technical literals (2026-10 rule 4c)", () => {
  const raws = (text: string): string[] => tokenize(text).map((t) => t.raw);
  const lit = (text: string): RawToken | undefined =>
    tokenize(text).find((t) => t.literal === true);

  it("the motivating case: '2560x1440@2' is ONE whole token, parts absorbed", () => {
    // Owner report (2026-10): LLM output "…drop the virtual mode to
    // 2560x1440@2." must Tab-complete whole. Pre-rule, the string
    // fragmented to the base tail "x1440" only (digit-initial prefix
    // and '@2' suffix lost). '@' is a single interior join symbol; the
    // trailing sentence period is trimmed.
    expect(raws("drop the virtual mode to 2560x1440@2.")).toContain(
      "2560x1440@2",
    );
    expect(raws("drop the virtual mode to 2560x1440@2.")).not.toContain(
      "x1440",
    );
    const t = lit("2560x1440@2");
    expect(t).toMatchObject({ raw: "2560x1440@2", hexish: false });
    // span points at the trimmed token (excludes the sentence period)
    expect("2560x1440@2 to 2560x1440@2.".slice(t!.start, t!.end)).toBe(
      "2560x1440@2",
    );
  });

  it("trailing-'_' trim defers to the containing base token (BUG-002): 'FOO_1_' is ONE base token", () => {
    // '_' is a word char for the base pass but a trim symbol for the
    // literal pass — the only straddle character. Pre-fix this emitted
    // the 'FOO_1' literal [0,5) AND the 'FOO_1_' base [0,6): overlapping
    // spans → duplicate store candidates ('foo_1' + 'foo_1_').
    expect(raws("FOO_1_")).toEqual(["FOO_1_"]);
    expect(tokenize("FOO_1_")[0]!.raw).toBe("FOO_1_");
    expect(tokenize("FOO_1_")[0]!.literal).not.toBe(true); // base class — no literal fork
    expect(raws("rename FOO_1_ ok")).toEqual(["rename", "FOO_1_", "ok"]);
    expect(raws("call API_V2_KEY_ now")).toEqual([
      "call", "API_V2_KEY_", "now",
    ]);
  });

  it("pure digit runs ≥ 4 are literals; shorter ones stay out", () => {
    expect(raws("port 8080")).toEqual(["port", "8080"]);
    expect(raws("8080 1440 2026")).toEqual(["8080", "1440", "2026"]);
    expect(raws("123 abc 45 7")).toEqual(["abc"]); // < 4 digits: nothing
  });

  it("digit-bearing dotted/joined strings: versions, IPs, decimals, dates", () => {
    expect(raws("v1.2.3")).toEqual(["v1.2.3"]); // was base-split "v1"
    expect(raws("see 192.168.1.1")).toEqual(["see", "192.168.1.1"]);
    expect(raws("pi is 3.14 ok")).toEqual(["pi", "is", "3.14", "ok"]);
    expect(raws("on 2026-09-15 then")).toEqual(["on", "2026-09-15", "then"]);
    expect(raws("~2.1.0")).toEqual(["2.1.0"]); // leading '~' trimmed
    expect(raws("4:36")).toEqual(["4:36"]);
  });

  it("digit-initial hyphen compounds are literals (2e-test)", () => {
    expect(raws("2e-test ok")).toEqual(["2e-test", "ok"]);
  });

  it("mixed-class guard: digit-FREE letter+symbol runs stay with 4a/4b", () => {
    // C++ / and/or are not literals (no digit); e.g. keeps the filename
    // pass's "e.g"; don't keeps the apostrophe split.
    expect(raws("C++ and/or")).toEqual(["and", "or"]);
    expect(raws("see e.g. this")).toEqual(["see", "e.g", "this"]);
    expect(raws("don't")).toEqual(["don"]);
  });

  it("symbol hygiene: no adjacent symbols, no prose punctuation glue", () => {
    expect(raws("see http://x.com/a now")).toEqual([
      "see",
      "http",
      "x.com",
      "now",
    ]); // '//' kills the URL run — today's behavior
    expect(raws("fox. And tail,")).toEqual(["fox", "And", "tail"]); // sentence-final '.' never glues
    expect(raws("a..b2")).toEqual(["b2"]); // adjacent dots kill the literal; the base tail "b2" keeps today's behavior
    expect(raws("--mode=2")).toEqual(["mode=2"]); // leading '--' trimmed
  });

  it("literals are OPAQUE: no subword splitting; equal-span tokens keep their class", () => {
    expect(
      expandCandidates(lit("2560x1440@2")!).map((d) => d.key),
    ).toEqual(["2560x1440@2"]);
    expect(tokenize("utf8Reader")).toHaveLength(1); // equal-span BASE wins → subwords intact
    expect(
      expandCandidates(tokenize("utf8Reader")[0]!).map((d) => d.key),
    ).toEqual(["utf8reader", "utf8", "reader"]);
    expect(
      expandCandidates(tokenize("2ndReader")[0]!).map((d) => d.key),
    ).toEqual(["2ndreader"]); // digit-initial: literal, whole-only (net-new)
  });

  it("CJK adjacency rule applies to literals (rule 3)", () => {
    expect(raws("草2560x1440@2 tail")).toEqual(["x1440", "tail"]);
    // The literal run "2560x1440@2" abuts 草 → disqualified whole; the
    // base tail "x1440" (not adjacent to the CJK char) keeps its
    // pre-rule behavior.
  });

  it("hexish precedence: equal-span hex tokens stay hexish", () => {
    const t = tokenize("0f3a9c2")[0]!;
    expect(t).toMatchObject({ raw: "0f3a9c2", hexish: true });
    expect(t.literal).toBeFalsy();
  });
});

describe("path tokens (2026-10 rule 4d)", () => {
  const raws = (text: string): string[] => tokenize(text).map((t) => t.raw);
  const pathTok = (text: string): RawToken | undefined =>
    tokenize(text).find((t) => t.path === true);
  const draftOf = (t: RawToken): CandidateDraft => expandCandidates(t)[0]!;

  it("'use src/core/query.ts here' → ONE path token; parts never surface alone", () => {
    const text = "use src/core/query.ts here";
    const paths = tokenize(text).filter((t) => t.path === true);
    expect(paths).toHaveLength(1);
    const p = paths[0]!;
    expect(p.raw).toBe("src/core/query.ts"); // display = original run
    expect(p.start).toBe(4);
    expect(p.end).toBe(21);
    expect(p.trimFrom).toBe(0); // no edge symbols to trim
    expect(p.trimTo).toBe(17);
    const d = draftOf(p);
    expect(d.key).toBe("src/core/query.ts");
    expect(d.path).toBe(true);
    expect(d.isSubword).toBe(false);
    // Absorption: components never surface alone.
    expect(raws(text)).toEqual(["use", "src/core/query.ts", "here"]);
  });

  it("'/home/user/projects/hapax' → key trims the leading '/', display keeps it", () => {
    const text = "edit /home/user/projects/hapax now";
    const p = pathTok(text)!;
    expect(p).toBeDefined();
    expect(p.raw).toBe("/home/user/projects/hapax");
    expect(p.start).toBe(5);
    expect(p.trimFrom).toBe(1);
    expect(p.trimTo).toBe(p.raw.length);
    const d = draftOf(p);
    expect(d.key).toBe("home/user/projects/hapax");
    expect(d.display).toBe("/home/user/projects/hapax"); // edge kept for insertion
    // The FIRST intentional key≠display divergence beyond casing.
    expect(d.display.toLowerCase()).not.toBe(d.key);
  });

  it("'docs/architecture.md' → path (1 slash + dotted component)", () => {
    const p = pathTok("see docs/architecture.md first")!;
    expect(p).toBeDefined();
    expect(p.raw).toBe("docs/architecture.md");
    expect(draftOf(p).key).toBe("docs/architecture.md");
    // the filename-class match 'architecture.md' is absorbed
    expect(raws("see docs/architecture.md first")).toEqual([
      "see",
      "docs/architecture.md",
      "first",
    ]);
  });

  it("'../tools/build.mjs' → key trims '../', display keeps it", () => {
    const p = pathTok("run ../tools/build.mjs")!;
    expect(p).toBeDefined();
    expect(p.raw).toBe("../tools/build.mjs");
    expect(p.trimFrom).toBe(3);
    const d = draftOf(p);
    expect(d.key).toBe("tools/build.mjs");
    expect(d.display).toBe("../tools/build.mjs");
  });

  it("'example.com/a/b' → path (host+path form, 2 slashes)", () => {
    const p = pathTok("open example.com/a/b now")!;
    expect(p).toBeDefined();
    expect(p.raw).toBe("example.com/a/b");
    expect(draftOf(p).key).toBe("example.com/a/b");
  });

  it("'src/foo.ts:42:13' → ':line:col' trimmed from KEY and display (§09: retype the path, not the line numbers)", () => {
    const p = pathTok("fix src/foo.ts:42:13 please")!;
    expect(p).toBeDefined();
    expect(p.raw).toBe("src/foo.ts");
    expect(p.trimFrom).toBe(0);
    expect(p.trimTo).toBe(10); // "src/foo.ts" — now also the display span
    const d = draftOf(p);
    expect(d.key).toBe("src/foo.ts");
    expect(d.display).toBe("src/foo.ts");
  });

  it("sentence-final '.' never joins a path: key and display stay clean, class stays path (2026-10 validation MAJOR 2/3)", () => {
    // MAJOR 2: `query.ts.` used to glue the period into key AND display;
    // MAJOR 3: the period defeated the ':line:col' trim, so the
    // sentence-final occurrence forked into a 4c literal that inserted
    // line numbers. Both now reduce to the plain path.
    const dotted = pathTok("open src/core/query.ts. then close it.")!;
    expect(dotted).toBeDefined();
    expect(dotted.raw).toBe("src/core/query.ts");
    const colText = "jump to src/core/query.ts:42:13. end.";
    const colDotted = pathTok(colText)!;
    expect(colDotted).toBeDefined();
    expect(colDotted.raw).toBe("src/core/query.ts");
    expect(draftOf(colDotted).key).toBe("src/core/query.ts");
    // No literal fork either way: the line:col string never surfaces.
    const raws = tokenize(colText).map((t) => t.raw);
    expect(raws).toContain("src/core/query.ts");
    expect(raws).not.toContain("src/core/query.ts:42:13");
  });

  it("'4:36' and 'localhost:8080' are NOT paths (existing literal behavior)", () => {
    expect(raws("4:36")).toEqual(["4:36"]);
    expect(tokenize("4:36")[0]!.path).toBeFalsy();
    expect(raws("hit localhost:8080 now")).toContain("localhost:8080");
    expect(tokenize("hit localhost:8080 now").every((t) => !t.path)).toBe(
      true,
    );
    expect(tokenize("hit localhost:8080 now")[1]!.literal).toBe(true);
  });

  it("'a/b.ts:42:13:99' → falls back to the 4c literal class (pinned)", () => {
    // strip ':13:99' leaves 'a/b.ts:42' — still coloned → restore → the
    // unstripped key contains ':' → not path-shaped → 4c literal wins.
    const text = "open a/b.ts:42:13:99 now";
    expect(raws(text)).toContain("a/b.ts:42:13:99");
    expect(tokenize(text).every((t) => !t.path)).toBe(true);
    expect(tokenize(text)[1]!.literal).toBe(true);
  });

  it("'and/or' → NOT a token (1 slash, no dot, digit-free: 4d and 4c both reject)", () => {
    expect(raws("C++ and/or")).toEqual(["and", "or"]);
    expect(tokenize("and/or").every((t) => !t.path)).toBe(true);
  });

  it("'a/../b' → interior '..' rejects the WHOLE run; no junk fragments", () => {
    expect(raws("a/../b")).toEqual([]);
    expect(tokenize("a/../b").every((t) => !t.path)).toBe(true);
  });

  it("key cap: a 96-char post-trim key admits; 97 rejects (classifyPath-level)", () => {
    const k96 = `${"a".repeat(91)}/x.ts`; // 1 slash + dotted tail → path-shaped
    expect(k96.length).toBe(96);
    expect(classifyPath(k96)).toEqual({ from: 0, to: 96 });
    const k97 = `${"a".repeat(92)}/x.ts`;
    expect(k97.length).toBe(97);
    expect(classifyPath(k97)).toBeNull();
  });

  it("rule-3 guard fires at the TRIMMED bounds: 草 before the key kills the run", () => {
    // 草 abuts the KEY's first char (after '/…' the trimmed bound is what
    // counts) → the path run is disqualified whole; no path token ever
    // surfaces (contained base captures keep their historical behavior).
    const tokens = tokenize("草src/core/query.ts");
    expect(tokens.some((t) => t.path === true)).toBe(false);
    expect(raws("草src/core/query.ts")).not.toContain("src/core/query.ts");
  });
});
