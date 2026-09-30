/**
 * One-shot grant tracker unit suite (bugfix 001_1a2f4ffe408f, plan 004
 * P1.M1.T2.S2) — the word-boundary asymmetry table ported VERBATIM from
 * provider.ts's armed branch, now shared by both display paths
 * (spec/07:450–457). Each case is one row of the table:
 *
 *   - first armed answer of this arming → the GRANTED word (counts as
 *     word 1, never disarms)
 *   - "" → non-empty = typing INTO the granted offer (same word)
 *   - non-empty → "" = moved past a typed-through word (new word → spent)
 *   - two non-empties with no prefix relation = different words (spent);
 *     mutual prefix relation (incl. backspace narrowing) = same word
 *   - a spent tracker zeroes itself; reset() re-grants explicitly
 */

import { describe, expect, it } from "vitest";
import { createChainGrantTracker } from "../src/pi/chain-grant.js";

describe("createChainGrantTracker — one-shot grant asymmetry table (spec/07:450–457)", () => {
  it("first tick of an arming is the GRANTED word: seen=1, never disarms", () => {
    const g = createChainGrantTracker();
    expect(g.tick("beta")).toBe(false);
    // Re-reading the SAME prefix (repaint/keystroke echo) is still word 1:
    expect(g.tick("beta")).toBe(false);
  });

  it('"" → non-empty = typing INTO the granted offer (same word, no disarm)', () => {
    const g = createChainGrantTracker();
    g.reset();
    expect(g.tick("")).toBe(false); // the granted offer's word start
    expect(g.tick("b")).toBe(false); // typing into it — same word
    expect(g.tick("beta")).toBe(false); // still the same word
  });

  it("non-empty → \"\" = moved past a typed-through word: spent → true", () => {
    const g = createChainGrantTracker();
    expect(g.tick("beta")).toBe(false); // granted word
    expect(g.tick("")).toBe(true); // next word start → the grant is spent
  });

  it("two unrelated non-empties = different words: spent → true", () => {
    const g = createChainGrantTracker();
    expect(g.tick("beta")).toBe(false);
    expect(g.tick("gamma")).toBe(true); // no mutual prefix relation
  });

  it("mutual prefix relation (narrowing AND backspace) = same word, no disarm", () => {
    const g = createChainGrantTracker();
    expect(g.tick("beta")).toBe(false);
    expect(g.tick("bet")).toBe(false); // narrowing
    expect(g.tick("be")).toBe(false); // more narrowing
    expect(g.tick("beta")).toBe(false); // backspace back out
    expect(g.tick("betaword")).toBe(false); // extension (cur ⊇ last)
  });

  it("a spent tracker has already zeroed itself: the next tick is a fresh grant", () => {
    const g = createChainGrantTracker();
    expect(g.tick("beta")).toBe(false);
    expect(g.tick("")).toBe(true); // spent — state zeroed inside tick
    expect(g.tick("gamma")).toBe(false); // fresh grant: word 1 again
    expect(g.tick("")).toBe(true); // and it is one-shot again
  });

  it("reset() re-grants explicitly (the arm-site contract)", () => {
    const g = createChainGrantTracker();
    expect(g.tick("beta")).toBe(false);
    expect(g.tick("")).toBe(true); // spent
    g.reset(); // what every arm site calls beside chain.arm
    expect(g.tick("")).toBe(false); // fresh: the new offer's word start
    expect(g.tick("x")).toBe(false); // typing into the new offer
    expect(g.tick("")).toBe(true); // one-shot again
  });

  it("grants are per-instance — two trackers never share state", () => {
    const a = createChainGrantTracker();
    const b = createChainGrantTracker();
    expect(a.tick("beta")).toBe(false);
    // b has no history: its first tick is ITS granted word, not word 2.
    expect(b.tick("")).toBe(false);
    expect(a.tick("")).toBe(true); // only a's grant is spent
  });
});
