/**
 * PRD §07 trigger/threshold match-state suite (P1.M3.T3.S1):
 * extractMatchState decides per cursor position whether hapax offers
 * suggestions in trigger mode (trigger char at line start or after a
 * space/tab; fragment without whitespace or further trigger chars;
 * zero-length allowed), in threshold mode (trailing identifier
 * reaching config.threshold; fires everywhere), or must delegate
 * (null — pi's built-in completion stays in charge: the never-hijack
 * rules). Priority: trigger > threshold > null. Pure function — the
 * purity tests at the bottom pin that contract for S3/S4.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { HapaxConfig } from "../src/pi/config.js";
import { classifyStockContext, extractMatchState } from "../src/pi/provider.js";

/** Fresh config per call — never mutate DEFAULT_CONFIG. */
const cfg = (over: Partial<HapaxConfig> = {}): HapaxConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

describe("threshold mode — hyphenated fragments (2026-09 compound rule)", () => {
  it("inner hyphens stay in the fragment: 'load-b' → fragment/prefix 'load-b'", () => {
    expect(extractMatchState(["the load-b"], 0, 10, cfg())).toEqual({
      mode: "threshold",
      fragment: "load-b",
      prefix: "load-b",
    });
  });

  it("trailing hyphen continues the compound: 'load-' → fragment 'load-'", () => {
    expect(extractMatchState(["the load-"], 0, 9, cfg())).toEqual({
      mode: "threshold",
      fragment: "load-",
      prefix: "load-",
    });
  });

  it("letter-initial requirement holds: hyphens never enter the fragment head", () => {
    expect(extractMatchState(["run -v"], 0, 6, cfg())).toBeNull(); // "v" len 1 < threshold 2
    // "--flag": the fragment is "flag" — leading hyphens stay in the
    // buffer, never the fragment/prefix (applyCompletion only replaces
    // the fragment; the "--" survives untouched).
    expect(extractMatchState(["run --flag"], 0, 10, cfg())).toEqual({
      mode: "threshold",
      fragment: "flag",
      prefix: "flag",
    });
  });
});

describe("trigger mode — default triggerChar #", () => {
  it("'#' alone → trigger with empty fragment and prefix '#'", () => {
    expect(extractMatchState(["#"], 0, 1, cfg())).toEqual({
      mode: "trigger",
      fragment: "",
      prefix: "#",
    });
  });

  it("'#ze' → trigger, fragment 'ze', prefix '#ze'", () => {
    expect(extractMatchState(["#ze"], 0, 3, cfg())).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "#ze",
    });
  });

  it("'foo #ze' mid-line → trigger, fragment 'ze'", () => {
    expect(extractMatchState(["foo #ze"], 0, 7, cfg())).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "#ze",
    });
  });

  it("'foo\\t#ze' after a tab → trigger (tab counts as whitespace)", () => {
    expect(extractMatchState(["foo\t#ze"], 0, 7, cfg())).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "#ze",
    });
  });

  it("cursor mid-word '#ze|bc' sees text-before-cursor only → fragment 'ze'", () => {
    expect(extractMatchState(["#zebc"], 0, 3, cfg())).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "#ze",
    });
  });

  it("'world #' on line 2 → trigger on the cursor's line, empty fragment", () => {
    expect(extractMatchState(["hello", "world #", "x"], 1, 7, cfg())).toEqual({
      mode: "trigger",
      fragment: "",
      prefix: "#",
    });
  });
});

describe("trigger anchoring — no start/whitespace before # never triggers", () => {
  it("'foo#ze' is NOT trigger — falls through to threshold, fragment 'ze'", () => {
    expect(extractMatchState(["foo#ze"], 0, 6, cfg())).toEqual({
      mode: "threshold",
      fragment: "ze",
      prefix: "ze",
    });
  });

  it("'foo#' → null (unanchored #; trailing # fails threshold's [A-Za-z] start)", () => {
    expect(extractMatchState(["foo#"], 0, 4, cfg())).toBeNull();
  });

  it("'##' → null (second # kills the fragment rule; # fails threshold)", () => {
    expect(extractMatchState(["##"], 0, 2, cfg())).toBeNull();
  });

  it("'#ze#' → null (# inside the fragment stops the match; trailing # fails threshold)", () => {
    expect(extractMatchState(["#ze#"], 0, 4, cfg())).toBeNull();
  });
});

describe("threshold mode — fires everywhere, gated only by length", () => {
  it("threshold 2: 'z' (1 char) → null (delegates)", () => {
    expect(extractMatchState(["z"], 0, 1, cfg())).toBeNull();
  });

  it("threshold 2: 'ze' → threshold match, prefix 'ze'", () => {
    expect(extractMatchState(["ze"], 0, 2, cfg())).toEqual({
      mode: "threshold",
      fragment: "ze",
      prefix: "ze",
    });
  });

  it("threshold 1: single 'z' matches (lower boundary)", () => {
    expect(extractMatchState(["z"], 0, 1, cfg({ threshold: 1 }))).toEqual({
      mode: "threshold",
      fragment: "z",
      prefix: "z",
    });
  });

  it("threshold 3: 'ze' (2 chars) → null, 'zeb' (3 chars) matches (upper boundary)", () => {
    expect(extractMatchState(["ze"], 0, 2, cfg({ threshold: 3 }))).toBeNull();
    expect(extractMatchState(["zeb"], 0, 3, cfg({ threshold: 3 }))).toEqual({
      mode: "threshold",
      fragment: "zeb",
      prefix: "zeb",
    });
  });

  it("'foo/bar' cursor after 'bar' → threshold fragment 'bar' (word starts anywhere)", () => {
    expect(extractMatchState(["foo/bar"], 0, 7, cfg())).toEqual({
      mode: "threshold",
      fragment: "bar",
      prefix: "bar",
    });
  });

  it("identifiers carry digits and underscores: 'ze9_x' → fragment 'ze9_x'", () => {
    expect(extractMatchState(["ze9_x"], 0, 5, cfg())).toEqual({
      mode: "threshold",
      fragment: "ze9_x",
      prefix: "ze9_x",
    });
  });

  it("a leading underscore is not an identifier start: '_ze' → fragment 'ze'", () => {
    expect(extractMatchState(["_ze"], 0, 3, cfg())).toEqual({
      mode: "threshold",
      fragment: "ze",
      prefix: "ze",
    });
  });

  it("digits alone ('123') → null ([A-Za-z] start required)", () => {
    expect(extractMatchState(["123"], 0, 3, cfg())).toBeNull();
  });

  it("threshold match on a later line: line 3 'alpha' → fragment 'alpha'", () => {
    expect(extractMatchState(["", "//", "alpha"], 2, 5, cfg())).toEqual({
      mode: "threshold",
      fragment: "alpha",
      prefix: "alpha",
    });
  });
});

describe("priority — trigger beats threshold", () => {
  it("'#ze' with threshold 1 → still trigger mode (trigger wins)", () => {
    expect(extractMatchState(["#ze"], 0, 3, cfg({ threshold: 1 }))).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "#ze",
    });
  });
});

describe('triggerChar "" disables trigger mode entirely', () => {
  it("'#' → null (no trigger pass; '#' fails threshold)", () => {
    expect(extractMatchState(["#"], 0, 1, cfg({ triggerChar: "" }))).toBeNull();
  });

  it("'#ze' falls through to threshold with bare-fragment prefix 'ze'", () => {
    expect(extractMatchState(["#ze"], 0, 3, cfg({ triggerChar: "" }))).toEqual({
      mode: "threshold",
      fragment: "ze",
      prefix: "ze",
    });
  });
});

describe("non-default triggerChar — regex escaping", () => {
  it("triggerChar '+' → '+ze' triggers with fragment 'ze'", () => {
    expect(extractMatchState(["+ze"], 0, 3, cfg({ triggerChar: "+" }))).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "+ze",
    });
  });

  it("triggerChar '\\' → '\\ze' triggers (backslash escaped correctly)", () => {
    expect(extractMatchState(["\\ze"], 0, 3, cfg({ triggerChar: "\\" }))).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "\\ze",
    });
  });

  it("triggerChar '/' → 'cmd /ze' triggers", () => {
    expect(extractMatchState(["cmd /ze"], 0, 7, cfg({ triggerChar: "/" }))).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "/ze",
    });
  });

  it("triggerChar '^' — the escaped anchor stays literal, '^ze' triggers", () => {
    expect(extractMatchState(["^ze"], 0, 3, cfg({ triggerChar: "^" }))).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "^ze",
    });
  });

  it("triggerChar ']' — escaped class bracket works, ']ze' triggers", () => {
    expect(extractMatchState(["]ze"], 0, 3, cfg({ triggerChar: "]" }))).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "]ze",
    });
  });

  it("triggerChar '-' — hyphen stays literal in and out of the char class", () => {
    expect(extractMatchState(["a -ze"], 0, 5, cfg({ triggerChar: "-" }))).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "-ze",
    });
  });
});

describe("bounds and cursor positions", () => {
  it("col 0 → null (nothing before the cursor)", () => {
    expect(extractMatchState(["#ze"], 0, 0, cfg())).toBeNull();
  });

  it("col at EOL works: '#ze' col 3 → trigger fragment 'ze'", () => {
    expect(extractMatchState(["#ze"], 0, 3, cfg())).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "#ze",
    });
  });

  it("col beyond line length → null (defensive)", () => {
    expect(extractMatchState(["#ze"], 0, 4, cfg())).toBeNull();
  });

  it("negative col → null", () => {
    expect(extractMatchState(["#ze"], 0, -1, cfg())).toBeNull();
  });

  it("line out of range → null", () => {
    expect(extractMatchState(["#ze"], 1, 1, cfg())).toBeNull();
  });

  it("negative line → null", () => {
    expect(extractMatchState(["#ze"], -1, 3, cfg())).toBeNull();
  });

  it("empty buffer → null", () => {
    expect(extractMatchState([], 0, 0, cfg())).toBeNull();
  });

  it("empty line with other lines present → null", () => {
    expect(extractMatchState(["a", "", "b"], 1, 0, cfg())).toBeNull();
  });
});

describe("purity contract (S3 debounce / S4 acceptance depend on it)", () => {
  it("repeated calls with identical input return identical results (no hidden state)", () => {
    const first = extractMatchState(["foo #ze"], 0, 7, cfg());
    const second = extractMatchState(["foo #ze"], 0, 7, cfg());
    expect(first).toEqual(second);
  });

  it("the inputs are never mutated — lines array and config stay untouched", () => {
    const lines = ["foo #ze"];
    const c = cfg();
    extractMatchState(lines, 0, 7, c);
    expect(lines).toEqual(["foo #ze"]);
    expect(c).toEqual(DEFAULT_CONFIG);
  });

  it("works against a frozen config — the function only reads it", () => {
    const frozen = Object.freeze(cfg());
    expect(extractMatchState(["#ze"], 0, 3, frozen)).toEqual({
      mode: "trigger",
      fragment: "ze",
      prefix: "#ze",
    });
  });
});

describe("classifyStockContext — stock pi contexts (BUG-001)", () => {
  it("'/re' line 0 → 'slash'", () => {
    expect(classifyStockContext(["/re"], 0, 3)).toBe("slash");
  });

  it("indented '  /re' line 0 → 'slash' (trimStart mirrors editor.js)", () => {
    expect(classifyStockContext(["  /re"], 0, 5)).toBe("slash");
  });

  it("'/model arg re' → null (space kills slash)", () => {
    expect(classifyStockContext(["/model arg re"], 0, 13)).toBe(null);
  });

  it("'@jo' → 'mention'", () => {
    expect(classifyStockContext(["@jo"], 0, 3)).toBe("mention");
  });

  it("'foo @jo' mid-line → 'mention'", () => {
    expect(classifyStockContext(["foo @jo"], 0, 7)).toBe("mention");
  });

  it("'x@jo' glued @ → null (not word start)", () => {
    expect(classifyStockContext(["x@jo"], 0, 4)).toBe(null);
  });

  it("'\"src/roun' → 'quoted-path' (unclosed quote)", () => {
    expect(classifyStockContext(["\"src/roun"], 0, 9)).toBe("quoted-path");
  });

  it("'src/roun' → 'path'", () => {
    expect(classifyStockContext(["src/roun"], 0, 8)).toBe("path");
  });

  it("'renewable en' plain prose → null", () => {
    expect(classifyStockContext(["renewable en"], 0, 12)).toBe(null);
  });

  it("'#frag' at word start → null (trigger is hapax's)", () => {
    expect(classifyStockContext(["#frag"], 0, 5)).toBe(null);
  });

  it("out-of-range line → null", () => {
    expect(classifyStockContext(["x"], 5, 0)).toBe(null);
  });

  it("out-of-range col → null", () => {
    expect(classifyStockContext(["x"], 0, 9)).toBe(null);
  });

  it("'word' line 1 with slash content on line 0 → null (line-local)", () => {
    expect(classifyStockContext(["/re", "word"], 1, 4)).toBe(null);
  });

  it("repeated calls with identical input return identical results (pure)", () => {
    const first = classifyStockContext(["src/roun"], 0, 8);
    const second = classifyStockContext(["src/roun"], 0, 8);
    expect(first).toBe(second);
  });

  it("the inputs are never mutated — lines array stays untouched", () => {
    const lines = ["src/roun"];
    classifyStockContext(lines, 0, 8);
    expect(lines).toEqual(["src/roun"]);
  });
});

// ── path fragments never reach hapax matching (rule 4d order pins) ───────────
// P1.M1.T2.S4 baseline (spec §07 auto-open, spec §09 integration items 6–7):
// paths surface at a path's FIRST segment ("sr" → "src/core/query.ts"); once
// a '/' precedes the cursor, stock pi file completion owns the rest. The
// mechanism, verified against the live regexes (never guessed):
//   - threshold mode matches /[A-Za-z][A-Za-z0-9_-]*$/ — a '/' can never
//     enter a threshold fragment; "edit src/co" yields fragment "co" (the
//     regex takes the trailing identifier AFTER the slash).
//   - trigger mode excludes only whitespace + the trigger char, so
//     "#sr/co" IS trigger mode with fragment "sr/co" — but
//     classifyStockContext runs BEFORE extractMatchState in
//     getSuggestions, and a '/' earlier in the line with a whitespace-free
//     cursor tail classifies as "path" → delegate, whatever the mode.
// The provider-level counterfactuals (a match WOULD have existed) live in
// test/provider.test.ts.

describe("path fragments never reach hapax matching (rule 4d order pins)", () => {
  it("threshold regex takes the trailing identifier: 'edit src/co' → fragment 'co' ('/' never enters)", () => {
    expect(extractMatchState(["edit src/co"], 0, 11, cfg())).toEqual({
      mode: "threshold",
      fragment: "co",
      prefix: "co",
    });
  });

  it("'edit src/co' classifies as 'path' — the stock gate disarms the hypothetical 'co' query", () => {
    expect(classifyStockContext(["edit src/co"], 0, 11)).toBe("path");
  });

  it("trigger fragments CAN contain '/': '#sr/co' → mode 'trigger', fragment 'sr/co'", () => {
    expect(extractMatchState(["#sr/co"], 0, 6, cfg())).toEqual({
      mode: "trigger",
      fragment: "sr/co",
      prefix: "#sr/co",
    });
  });

  it("'#sr/co' STILL classifies as 'path' (gate order pin: stock gate outranks trigger mode)", () => {
    expect(classifyStockContext(["#sr/co"], 0, 6)).toBe("path");
  });

  it("'#src/co' trigger fragment classifies as 'path' too (deeper path, same disarm)", () => {
    expect(classifyStockContext(["#src/co"], 0, 7)).toBe("path");
  });

  it("quoted beats path: 'edit \"src/co' → 'quoted-path'", () => {
    expect(classifyStockContext(['edit "src/co'], 0, 12)).toBe("quoted-path");
  });

  it("first-segment seam: 'edit sr' → no stock context (hapax owns; the '/' has not been typed yet)", () => {
    expect(classifyStockContext(["edit sr"], 0, 7)).toBe(null);
  });

  it("'sr.co' (no slash) is a plain word continuation: threshold fragment 'co', stock context null", () => {
    expect(extractMatchState(["edit sr.co"], 0, 10, cfg())).toEqual({
      mode: "threshold",
      fragment: "co",
      prefix: "co",
    });
    expect(classifyStockContext(["edit sr.co"], 0, 10)).toBe(null);
  });
});