import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DICT_VERSION, loadDictionary } from "../src/core/dictionary.js";
import { REJECT_COMMON_THRESHOLD } from "../src/core/score.js";

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

// Loaded once at module scope: the artifact block below and the BUG-001
// calibration block share the same loaded dictionary.
const dict = loadDictionary(SHIPPED);

describe("shipped dict/common-en.bin", () => {
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
    // 'the' outranks 'this' in the corpus (rank ~1 vs ~12); a mid-frequency
    // word scores below both. Ordering only — band calibration against the
    // score.ts REJECT band is asserted by the "shipped dict calibration
    // (BUG-001 gate)" block below.
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

describe("shipped dict calibration (BUG-001 gate)", () => {
  // BUG-001: the pre-recalibration artifact scored the=103/with=71 and the
  // original uncalibrated REJECT band made rejection mathematically
  // unreachable, so every common word was admitted as rare and typing
  // "with"/"this"/"them" opened menus during ordinary prose. These
  // assertions import the live band constant — never a hard-coded value —
  // so a retune keeps the gate meaningful (they assert lookup >= REJECT,
  // whatever REJECT is), while a deleted, truncated, or mis-calibrated
  // artifact still fails loudly. Measured against the shipped artifact:
  // the=240, with=179, this=197, them=156, that=215, have=190, would=156 —
  // all comfortably in the reject band.
  const COMMON_WORDS = ["the", "with", "this", "them", "that", "have", "would"];

  it.each(COMMON_WORDS)("'%s' scores >= REJECT_COMMON_THRESHOLD", (w) => {
    const q = dict.lookup(w);
    expect(q, `shipped dict lost/mis-ranked '${w}' (BUG-001 regression?)`).not.toBeNull();
    expect(q!).toBeGreaterThanOrEqual(REJECT_COMMON_THRESHOLD);
  });

  it("nonsense stays absent", () => {
    expect(dict.lookup("qqqqzzzz")).toBeNull();
  });
});