import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DICT_VERSION, loadDictionary } from "../src/core/dictionary.js";

/**
 * The committed provisional artifact `dict/common-en.bin` is load-bearing:
 * P1.M3.T5 (lazy dict load / disable-on-bad-dict) and P1.M4.T1 (integration
 * acceptance) load this exact file. These tests fail if the artifact is
 * deleted, corrupted, or regenerated with a different version — forcing any
 * regeneration to keep the loader contract.
 *
 * Entry count 50,927 and the spot-check words come from the provisional
 * source list (/usr/share/dict/cracklib-small) documented in
 * README "Dictionary build"; "qqqqzzzz" is absent by construction.
 */
const SHIPPED = fileURLToPath(new URL("../dict/common-en.bin", import.meta.url));

describe("shipped dict/common-en.bin", () => {
  const dict = loadDictionary(SHIPPED);

  it("loads with version 1 and a realistic entry count", () => {
    expect(dict.version).toBe(DICT_VERSION);
    expect(dict.entryCount).toBeGreaterThan(50_000);
  });

  it("returns the loader-reported entryCount from the build summary", () => {
    // tools/build-dict.mjs printed entries=50927 for the committed artifact.
    expect(dict.entryCount).toBe(50_927);
  });

  it("spot-check: common words return non-null quants", () => {
    for (const word of ["the", "and", "word"]) {
      const q = dict.lookup(word);
      expect(q, `expected '${word}' in shipped dict`).not.toBeNull();
      expect(q!).toBeGreaterThanOrEqual(0);
      expect(q!).toBeLessThanOrEqual(255);
    }
  });

  it("spot-check: absent words return null", () => {
    expect(dict.lookup("qqqqzzzz")).toBeNull();
  });
});