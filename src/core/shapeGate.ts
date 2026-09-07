/**
 * Shape gate — stage 2 of the segment → shapeGate → score → store → query
 * pipeline (PRD §04 h2.23). `passesShape` is the always-on admission filter:
 * every segmented CandidateDraft goes through here before dictionary lookup,
 * so dictionary-absent words enter the store only through this gate.
 *
 * Rules, evaluated in order — first failure wins (the reason precedence
 * contract): length → [secret] → lowEntropy → unigramRun → consonantRun.
 *
 *  1. Length on draft.key: whole tokens 4–64, sub-words 4–32
 *     (`tooShort` / `tooLong`).
 *  2. Secret — NOT implemented here. P1.M2.T2.S2's insertion point sits
 *     between length and entropy (marked below); this module has no
 *     secret logic.
 *  3. Entropy (`lowEntropy`): Shannon entropy of draft.key's character
 *     distribution < 1.5 bits/char. Computed over the lowercase key, never
 *     the display (PRD gotcha: casing would change the distribution).
 *  4. Unigram run (`unigramRun`): any single character repeated ≥ 4 times
 *     consecutively (exactly 4 rejects; a 3-run inside a word is fine).
 *  5. Consonant run (`consonantRun`): ≥ 6 consecutive consonant letters
 *     (a–z minus aeiou — y is NOT a vowel) with no vowel and no digit
 *     inside the run.
 *
 * Hexish tokens (6–12 chars, e.g. "f3a9c2e") pass on the general rules
 * alone — digits break consonant runs and their mixed characters clear
 * 1.5 bits/char. No hexish special-casing here: the ≥20-pure-hex secret
 * rejection belongs to T2.S2.
 *
 * Pure: type-only imports, no runtime imports, no module state. Thresholds
 * are baked constants (PRD: not a tuning surface). Scanners are single-pass
 * and allocation-light apart from the entropy Map — the gate runs on every
 * candidate.
 */

import type { CandidateDraft } from "./segment.js";
import type { GateResult } from "./types.js";

/** Admission minimum on draft.key (whole and sub-word alike). */
const MIN_LENGTH = 4;
/** Whole-token cap. tokenize()'s base regex caps at 64, but the gate
 *  re-enforces the bound so it holds regardless of upstream. */
const MAX_WHOLE_LENGTH = 64;
/** Sub-word cap (h3.4 sub-words are ≤ 32). */
const MAX_SUBWORD_LENGTH = 32;
/** Reject below this many bits/char of character entropy. */
const MIN_ENTROPY_BITS = 1.5;
/** Single-character run length that rejects (exactly this many is enough). */
const UNIGRAM_RUN_MIN = 4;
/** Consonant-run length that rejects (exactly this many is enough). */
const CONSONANT_RUN_MIN = 6;

/** Vowel letters within a–z; every other a–z char is a consonant. */
const VOWELS = "aeiou";

/**
 * Apply the shape rules to one candidate draft (PRD §04 h2.23).
 *
 * Returns `{ ok: true }` with no `reason` on pass; on reject, exactly one
 * `GateRejectReason` per the precedence contract above. Read-only over the
 * draft — the gate never mutates its input.
 */
export function passesShape(draft: CandidateDraft): GateResult {
  const key = draft.key;
  const max = draft.isSubword ? MAX_SUBWORD_LENGTH : MAX_WHOLE_LENGTH;
  if (key.length < MIN_LENGTH) return { ok: false, reason: "tooShort" };
  if (key.length > max) return { ok: false, reason: "tooLong" };
  // P1.M2.T2.S2: the secret-shape check slots HERE — it must return
  // { ok: false, reason: "secret" } and stay between length and entropy
  // so the precedence contract (length → secret → entropy → …) holds.
  if (charEntropy(key) < MIN_ENTROPY_BITS) {
    return { ok: false, reason: "lowEntropy" };
  }
  if (hasUnigramRun(key, UNIGRAM_RUN_MIN)) {
    return { ok: false, reason: "unigramRun" };
  }
  if (hasConsonantRun(key, CONSONANT_RUN_MIN)) {
    return { ok: false, reason: "consonantRun" };
  }
  return { ok: true };
}

/** Shannon entropy of `s`'s character distribution, in bits/char:
 *  H = -Σ p_c · log2(p_c) over each distinct char's frequency p_c.
 *  Keys are ASCII (tokenize never emits non-ASCII into tokens), so charAt
 *  indexing is exact. */
function charEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** True when any single character repeats ≥ `min` times consecutively.
 *  One left-to-right scan; resets the counter on every change of char. */
function hasUnigramRun(s: string, min: number): boolean {
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    if (s.charAt(i) === s.charAt(i - 1)) {
      run++;
      if (run >= min) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

/** True when any ≥ `min` consecutive chars are all consonant letters
 *  (a–z except aeiou). Vowels and every non-letter (digits, underscores)
 *  reset the run. One left-to-right scan. */
function hasConsonantRun(s: string, min: number): boolean {
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c >= "a" && c <= "z" && !VOWELS.includes(c)) {
      run++;
      if (run >= min) return true;
    } else {
      run = 0;
    }
  }
  return false;
}