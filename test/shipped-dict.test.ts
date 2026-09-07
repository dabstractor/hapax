import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DICT_VERSION, loadDictionary } from "../src/core/dictionary.js";

/**
 * The committed artifact `dict/common-en.bin` is load-bearing:
 * P1.M3.T5 (lazy dict load / disable-on-bad-dict) and P1.M4.T1 (integration
 * acceptance) load this exact file. These tests fail if the artifact is
 * deleted, corrupted, or regenerated with a different version — forcing any
 * regeneration to keep the loader contract.
 *
 * Entry count 48,802 comes from the real frequency corpus
 * `tools/corpus/en-50k.tsv` (hermitdave/FrequencyWords 2018 en_50k, RAW —
 * OpenSubtitles 2018), documented in README "Dictionary build" and
 * tools/corpus/README.md; quants are ordered by real word frequency.
 * "qqqqzzzz" is absent by construction.
 */
const SHIPPED = fileURLToPath(new URL("../dict/common-en.bin", import.meta.url));

describe("shipped dict/common-en.bin", () => {
  const dict = loadDictionary(SHIPPED);

  it("loads with version 1 and a realistic entry count", () => {
    expect(dict.version).toBe(DICT_VERSION);
    // Presence floor: the top-50k corpus yields 48,802 entries after build-time
    // KEY_RE filtering and case-collision merging (mergeTsv lowercases and
    // sums), so a fixed >50_000 floor no longer applies.
    expect(dict.entryCount).toBeGreaterThan(45_000);
  });

  it("returns the loader-reported entryCount from the build summary", () => {
    // tools/build-dict.mjs printed entries=48802 for the committed artifact.
    expect(dict.entryCount).toBe(48_802);
  });

  it("spot-check: common words return non-null quants", () => {
    for (const word of ["the", "and", "word"]) {
      const q = dict.lookup(word);
      expect(q, `expected '${word}' in shipped dict`).not.toBeNull();
      expect(q!).toBeGreaterThanOrEqual(0);
      expect(q!).toBeLessThanOrEqual(255);
    }
  });

  it("orders quants by real word frequency", () => {
    // 'the' outranks 'this' in the corpus (rank ~2 vs ~8); a mid-frequency
    // word scores below both. Ordering only — band calibration (q >= 220
    // REJECT) is P1.M1.T2's concern, NOT asserted here.
    const the = dict.lookup("the");
    expect(the).not.toBeNull();
    const thisQ = dict.lookup("this");
    expect(thisQ).not.toBeNull();
    expect(the!).toBeGreaterThanOrEqual(thisQ!);
    const would = dict.lookup("would");
    expect(would).not.toBeNull();
    expect(thisQ!).toBeGreaterThanOrEqual(would!);
  });

  it("spot-check: absent words return null", () => {
    expect(dict.lookup("qqqqzzzz")).toBeNull();
  });
});