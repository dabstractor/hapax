/**
 * Synthetic fixture generators for the PRD §09 performance gates
 * (P1.M4.T1.S2): `test/perf-gates.test.ts` (the hard CI gate) and
 * `test/bench/core.bench.ts` (tinybench reporting). EVERYTHING here is
 * generated in-memory from fixed seeds — no committed fixture files and
 * NEVER the shipped dictionary artifact (its path differs per install
 * location and §09 mandates a synthetic dictionary fixture).
 *
 * Generators:
 *   - makeStore(cap, seed)        → CandidateStore filled to `cap` with
 *                                   distinct synthetic keys (deterministic
 *                                   mulberry32 PRNG, interleaved ordinals,
 *                                   mixed rankGroup/fromUser/properName,
 *                                   first-char buckets of ~730–910 keys
 *                                   (measured 891 for 'c' / 913 for 'p' at
 *                                   cap 20k — the T2.S2 gates query these).
 *   - makeSyntheticDict(n, seed)  → { buffer, words } via buildDictBinary
 *                                   (the P1.M1.T2.S2 fixture writer — its
 *                                   output round-trips the real loader),
 *                                   quants spread over all admission bands.
 *   - makeSessionText(bytes, …)   → deterministic synthetic message text
 *                                   (common words + constructed words +
 *                                   camelCase identifiers + hexish tokens,
 *                                   optional dictionary words for realistic
 *                                   admission bands), exactly `bytes` chars.
 *   - makeAbsentWords(n)          → words guaranteed absent from the
 *                                   synthetic dictionary (miss-path sweep).
 *
 * Test-only code: this module MAY allocate freely (unlike the loader's
 * allocation-free lookup contract and the sub-ms keystroke path).
 */

import { CandidateStore, STORE_CAP } from "../../src/core/store.js";
import { MID_FREQ_THRESHOLD, REJECT_COMMON_THRESHOLD } from "../../src/core/score.js";
import type { RankGroup, Sighting } from "../../src/core/types.js";
import { buildDictBinary, type DictEntry } from "./dict-writer.js";

/** Deterministic 32-bit PRNG (mulberry32) — fixed seed ⇒ identical fixtures
 *  on every run, so the gates measure the code, not fixture lottery. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHA = "abcdefghijklmnopqrstuvwxyz";
const letter = (rng: () => number): string =>
  ALPHA[Math.floor(rng() * ALPHA.length)];

/**
 * One synthetic store key. ~0.75% of keys land on each measured hot
 * prefix ("co", "pr") → ~150-candidate fragment ranges at cap 20k; the
 * rest scatter across the 2-char prefix space (676 slots ⇒ ~29
 * candidates each). At the FIRST-CHAR level — what the T2.S2 fuzzy scan
 * actually enters (§06 h2.38) — this yields near-uniform buckets of
 * ~n/26 ≈ 770: measured 726–913 at cap 20k (seed 42), with 'p' (913)
 * and 'c' (891) the hottest since the co/pr bonuses stack onto them —
 * so gate a's sanity asserts a real bucket, never a sliver. The base-36
 * index tag guarantees uniqueness (no accidental key merges shrinking
 * the store below cap).
 */
function storeWord(rng: () => number, i: number): string {
  const r = rng();
  let prefix: string;
  if (r < 0.0075) prefix = "co";
  else if (r < 0.015) prefix = "pr";
  else prefix = letter(rng) + letter(rng);
  const tag = i.toString(36).padStart(4, "0"); // uniqueness anchor
  let word = prefix + tag;
  const bodyLen = 3 + Math.floor(rng() * 6);
  for (let k = 0; k < bodyLen; k++) word += letter(rng);
  return word;
}

/** PRD §04 admission groups, realistic mix: 50% rare-by-default (0),
 *  30% rare-but-attested (1), 20% mid-frequency (2). */
function pickRankGroup(rng: () => number): RankGroup {
  const r = rng();
  if (r < 0.5) return 0;
  if (r < 0.8) return 1;
  return 2;
}

/**
 * Fill a CandidateStore to `cap` distinct candidates (up to STORE_CAP —
 * never past it, so the fill itself triggers no eviction and the store
 * size is exactly the PRD's 20k-candidate bench shape).
 *
 * GOTCHA honored (§09 bench recipe): upsert never advances the ordinal —
 * nextOrdinal() is interleaved every ~20 upserts so lastSeenOrdinal
 * spreads out and salience/recency math sees a realistic non-tie spread.
 * A second pass re-sights ~10% of keys to exercise the merge path
 * (sessionCounts and rankGroups become non-uniform — an all-fresh store
 * would make the ranking sort unrealistically cheap).
 */
export function makeStore(cap: number = STORE_CAP, seed = 42): CandidateStore {
  const rng = mulberry32(seed);
  const store = new CandidateStore();
  const words: string[] = [];
  for (let i = 0; i < cap; i++) {
    if (i % 20 === 0) store.nextOrdinal();
    const word = storeWord(rng, i);
    words.push(word);
    const properName = rng() < 0.1;
    const sighting: Sighting = {
      key: word,
      display: properName ? word[0].toUpperCase() + word.slice(1) : word,
      ordinal: store.currentOrdinal(),
      fromUser: rng() < 0.3,
      properName,
      rankGroup: pickRankGroup(rng),
    };
    store.upsert(sighting);
  }
  // Merge-path exercise: re-sight a random 10% with fresh dice (the
  // sticky flags and rankGroup min() now actually do something).
  for (let k = 0; k < Math.floor(cap / 10); k++) {
    if (k % 20 === 0) store.nextOrdinal();
    const word = words[Math.floor(rng() * words.length)];
    const properName = rng() < 0.1;
    store.upsert({
      key: word,
      display: properName ? word[0].toUpperCase() + word.slice(1) : word,
      ordinal: store.currentOrdinal(),
      fromUser: rng() < 0.3,
      properName,
      rankGroup: pickRankGroup(rng),
    });
  }
  return store;
}

/** 8-bit quantized commonness spanning every admission band (score.ts
 *  admit()): 50% group 1 (q < MID_FREQ_THRESHOLD), 30% group 2
 *  (MID ≤ q < REJECT_COMMON_THRESHOLD), 20% rejected (q ≥ REJECT) — so
 *  ingest over this dictionary exercises admits AND the commonness-reject
 *  path realistically. Expressed via the imported constants so the
 *  50/30/20 group mix survives band recalibration. */
function pickQuant(rng: () => number): number {
  const r = rng();
  if (r < 0.5) return Math.floor(rng() * MID_FREQ_THRESHOLD);
  if (r < 0.8) {
    return (
      MID_FREQ_THRESHOLD +
      Math.floor(rng() * (REJECT_COMMON_THRESHOLD - MID_FREQ_THRESHOLD))
    );
  }
  return (
    REJECT_COMMON_THRESHOLD +
    Math.floor(rng() * (256 - REJECT_COMMON_THRESHOLD))
  );
}

export interface SyntheticDict {
  /** Complete HAPX v1 binary — write to a temp file and loadDictionary() it. */
  buffer: Buffer;
  /** The generated words (generator order; the binary sorts internally). */
  words: string[];
}

/**
 * Build a SYNTHETIC packed dictionary of ~`wordCount` unique words via
 * `buildDictBinary` (test/helpers/dict-writer.ts — the one fixture writer
 * whose output the real loader round-trips). Bucket count is chosen by the
 * helper itself (next power of two ≥ 1.3 × entryCount) — the loader's
 * power-of-two contract holds by construction.
 */
export function makeSyntheticDict(wordCount = 20_000, seed = 99): SyntheticDict {
  const rng = mulberry32(seed);
  const entries: DictEntry[] = new Array(wordCount);
  const words: string[] = new Array(wordCount);
  for (let i = 0; i < wordCount; i++) {
    // Base-36 index tag ⇒ guaranteed-unique keys; 1–3 trailing letters
    // vary lengths like a real word list.
    let word = `synw${i.toString(36)}`;
    const tail = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < tail; k++) word += letter(rng);
    words[i] = word;
    entries[i] = { word, quant: pickQuant(rng) };
  }
  return { buffer: buildDictBinary(entries), words };
}

/** `count` words guaranteed absent from makeSyntheticDict output
 *  (different prefix namespace) — the honest miss-path sweep for gate b. */
export function makeAbsentWords(count = 1000, seed = 131): string[] {
  const rng = mulberry32(seed);
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    let word = `nope${i.toString(36)}`;
    const tail = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < tail; k++) word += letter(rng);
    words.push(word);
  }
  return words;
}

// ── Session-text pools ──────────────────────────────────────────────────────
// BOUNDED, pre-built pools: repeated processText runs (bench iterations)
// keep the distinct-key count well under STORE_CAP so eviction never fires
// mid-measurement, while the mix still exercises every pipeline path —
// dictionary hits (groups 1/2), commonness rejects (quant ≥
// REJECT_COMMON_THRESHOLD),
// dictionary-absent defaults, camelCase subword expansion, and hexish
// opaque tokens.

const COMMON_WORDS = [
  "the", "and", "that", "have", "for", "not", "with", "you", "this", "but",
  "his", "from", "they", "say", "her", "one", "all", "would", "there",
  "their", "what", "out", "about", "who", "get", "which", "when", "make",
  "can", "like", "time", "just", "him", "know", "take", "into", "year",
  "your", "good", "some", "could", "them", "see", "other", "than", "then",
  "now", "look", "only", "come", "its", "over", "think", "also", "back",
  "after", "use", "two", "how", "our", "work", "first", "well", "way",
  "even", "new", "want", "because", "any", "these", "give", "day", "most",
];
const CAMEL_VERBS = [
  "get", "set", "load", "make", "read", "write", "parse", "push", "pull",
  "draw", "sync", "hash",
];
const CAMEL_NOUNS = [
  "Buffer", "Token", "Snapshot", "Entry", "Queue", "Stream", "Record",
  "Session", "Candidate", "Segment", "Bucket", "Cursor",
];
const HEX_DIGITS = "0123456789abcdef";

interface TextPools {
  constructed: string[];
  camel: string[];
  hexish: string[];
}

/** Built ONCE per process from a fixed seed (memoized) — deterministic and
 *  bounded, so bench iterations can't grow the store's distinct keys. */
let pools: TextPools | null = null;

function getTextPools(): TextPools {
  if (pools) return pools;
  const rng = mulberry32(7);
  // Consonant/vowel-alternating syllable words (pass the shape gate like
  // ordinary prose words), 3–5 syllables ⇒ 6–15 chars.
  const onset = "bcdfgklmnprstvz";
  const vowel = "aeiou";
  const constructed: string[] = [];
  for (let i = 0; i < 1200; i++) {
    const syllables = 3 + Math.floor(rng() * 3);
    let word = "";
    for (let s = 0; s < syllables; s++) {
      word += onset[Math.floor(rng() * onset.length)];
      word += vowel[Math.floor(rng() * vowel.length)];
      if (rng() < 0.3) word += onset[Math.floor(rng() * onset.length)];
    }
    constructed.push(word);
  }
  // camelCase identifiers: verb+noun with 12×12 = 144 unique combos.
  const camel: string[] = [];
  for (let i = 0; i < CAMEL_VERBS.length * CAMEL_NOUNS.length; i++) {
    camel.push(
      CAMEL_VERBS[i % CAMEL_VERBS.length] +
        CAMEL_NOUNS[Math.floor(i / CAMEL_VERBS.length) % CAMEL_NOUNS.length],
    );
  }
  // Hexish tokens (6–40 hex chars, ≥1 a–f): the tokenizer's hexish scan
  // treats these as opaque — subword expansion must skip them.
  const hexish: string[] = [];
  for (let i = 0; i < 200; i++) {
    const len = 8 + Math.floor(rng() * 5);
    let token = "";
    for (let k = 0; k < len; k++) {
      token += HEX_DIGITS[Math.floor(rng() * HEX_DIGITS.length)];
    }
    token = `a${token.slice(1)}`; // guarantee the a–f letter
    hexish.push(token);
  }
  pools = { constructed, camel, hexish };
  return pools;
}

/**
 * Deterministic synthetic session message text of EXACTLY `bytes` chars
 * (pure ASCII, so chars == bytes for the chunked-ingest budget): realistic
 * word-length mix of common words, constructed prose words, camelCase
 * identifiers, hexish tokens, and — when `dictWords` is supplied — a slice
 * of synthetic-dictionary words so admission sees all quant bands.
 */
export function makeSessionText(
  bytes = 800_000,
  seed = 7,
  dictWords: string[] = [],
): string {
  const rng = mulberry32(seed);
  const { constructed, camel, hexish } = getTextPools();
  const parts: string[] = [];
  let length = 0;
  while (length < bytes) {
    const r = rng();
    let word: string;
    if (r < 0.55) {
      word = COMMON_WORDS[Math.floor(rng() * COMMON_WORDS.length)];
    } else if (r < 0.75) {
      word = constructed[Math.floor(rng() * constructed.length)];
    } else if (r < 0.85) {
      word = camel[Math.floor(rng() * camel.length)];
    } else if (r < 0.9) {
      word = hexish[Math.floor(rng() * hexish.length)];
    } else if (dictWords.length > 0) {
      word = dictWords[Math.floor(rng() * dictWords.length)];
    } else {
      word = constructed[Math.floor(rng() * constructed.length)];
    }
    parts.push(word);
    length += word.length + 1; // + single space separator
  }
  const text = parts.join(" ");
  return text.slice(0, bytes); // exactly `bytes` chars (mid-word cut is fine)
}