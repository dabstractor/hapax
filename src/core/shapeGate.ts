/**
 * Shape gate — stage 2 of the segment → shapeGate → score → store → query
 * pipeline (PRD §04 h2.23). `passesShape` is the always-on admission filter:
 * every segmented CandidateDraft goes through here before dictionary lookup,
 * so dictionary-absent words enter the store only through this gate.
 *
 * Rules, evaluated in order — first failure wins (the reason precedence
 * contract): length → secret → lowEntropy → unigramRun → consonantRun.
 *
 *  1. Length on draft.key: whole tokens 4–64, sub-words 4–32
 *     (`tooShort` / `tooLong`).
 *  2. Secret (`secret`, PRD §04 h2.23 rule 3; security acceptance §09
 *     integration item 5): pasted API keys must never surface as
 *     suggestions, so this rule is always-on with no config escape hatch
 *     (PRD §08). Evaluated on draft.display (raw casing) by
 *     isSecretShaped: known key prefixes (case-insensitive), '@' plus
 *     '.', digit+symbol ratio > 0.4 at length ≥ 16, base64-shaped runs
 *     ≥ 24 (mixed case + digit + '+'/'/'), pure-hex length ≥ 20.
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
 * 1.5 bits/char. Only whole-candidate pure hex ≥ 20 rejects as secret-
 * shaped; the 13–19 band stays gate-admitted (PRD: only dictionary/
 * admission in P1.M2.T3 can demote it).
 *
 * Pure: type-only imports, no runtime imports, no mutable state. Thresholds
 * and the secret-prefix list are baked constants (PRD: not a tuning
 * surface). Scanners are single-pass and allocation-light apart from the
 * entropy Map — the gate runs on every candidate.
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

/** Known secret-key prefixes, lowercase — matched against the lowercased
 *  display so the match is case-insensitive. OpenAI sk-/sk_, GitHub
 *  ghp_/gho_/github_pat_, Slack xox[bpars]-, AWS akia, Google aiza, and
 *  eyj (every JWT body starts with base64(`{"`) = "eyJ"). PRD §04 h2.23
 *  rule 3, first bullet. Baked constant — no config surface. */
const SECRET_PREFIXES: readonly string[] = [
  "sk-",
  "sk_",
  "ghp_",
  "gho_",
  "github_pat_",
  "xoxb-",
  "xoxp-",
  "xoxa-",
  "xoxr-",
  "xoxs-",
  "akia",
  "aiza",
  // JWT bodies — base64(`{"…`) starts "eyJ"; stored lowercase because the
  // match runs against the lowercased display (case-insensitive).
  "eyj",
];
/** Digit+symbol ratio rule applies only from this length up (rule 3,
 *  second bullet). */
const SECRET_RATIO_MIN_LENGTH = 16;
/** Reject above this fraction of digit+symbol characters (strictly >). */
const SECRET_MAX_NOISY_RATIO = 0.4;
/** Base64-run rule: minimum contiguous base64-alphabet characters. */
const MIN_BASE64_RUN = 24;
/** Pure-hex rule: whole-candidate hex rejects at this length and above.
 *  Hexish 6–12 pass, the 13–19 band stays admitted (PRD §04). */
const MIN_PURE_HEX_LENGTH = 20;
/** Whole-candidate hex alphabet, tested against the lowercased display
 *  (so a–f covers A–F too). No /g flag — no lastIndex state. */
const PURE_HEX_RE = /^[0-9a-f]+$/;

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
  // Secret check sits between length and entropy so the precedence
  // contract (length → secret → entropy → …) holds.
  if (isSecretShaped(draft.display)) return { ok: false, reason: "secret" };
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

/**
 * True when the raw candidate text is secret-shaped (PRD §04 h2.23 rule 3;
 * security acceptance §09 integration item 5). Five always-on sub-rules,
 * any one of which rejects — evaluated in this order:
 *
 *  1. Known key prefixes, case-insensitive on the lowercased display.
 *  2. '@' plus '.' — email belt-and-braces (segmentation excludes emails
 *     anyway; this only fires on unusually constructed drafts).
 *  3. Digit+symbol ratio > 0.4 for length ≥ 16 (underscore counts as a
 *     symbol; raw is lowercased so every non-a–z char is digit/symbol).
 *  4. Base64-shaped run ≥ 24 mixing case, digits, and at least one of
 *     '+'/'/' (hasBase64SecretRun — needs ORIGINAL casing, hence display).
 *  5. Whole-candidate pure hex length ≥ 20 (private-key-shaped). Hexish
 *     6–12 — and the 13–19 band — stay admitted: per PRD only the
 *     dictionary/admission stage may demote those, never the gate.
 *
 * Called with draft.display (original casing, same length as key); the
 * single lowercase here is what makes rule 1 case-insensitive. Baked
 * constants only — the rule is always-on per PRD §08, no config surface.
 */
function isSecretShaped(display: string): boolean {
  const raw = display.toLowerCase();

  // 1. Known key prefixes (raw lowercased → case-insensitive match).
  for (const prefix of SECRET_PREFIXES) {
    if (raw.startsWith(prefix)) return true;
  }

  // 2. '@' plus '.'
  if (raw.includes("@") && raw.includes(".")) return true;

  // 3. Digit+symbol ratio (strictly > 0.4).
  if (raw.length >= SECRET_RATIO_MIN_LENGTH) {
    let noisy = 0;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charAt(i);
      if (ch < "a" || ch > "z") noisy++; // digits, symbols, anything else
    }
    if (noisy / raw.length > SECRET_MAX_NOISY_RATIO) return true;
  }

  // 4. Base64-shaped run (evaluated on display — mixed case matters).
  if (hasBase64SecretRun(display)) return true;

  // 5. Pure hex ≥ 20.
  if (raw.length >= MIN_PURE_HEX_LENGTH && PURE_HEX_RE.test(raw)) return true;

  return false;
}

/** True when some contiguous run of ≥ MIN_BASE64_RUN chars from the base64
 *  alphabet [A-Za-z0-9+/] mixes lower AND upper case, a digit, and at
 *  least one '+' or '/' (PRD §04 h2.23 rule 3, third bullet). Scans the
 *  ORIGINAL display — the mixed-case test needs real casing. One left-
 *  to-right pass: class tallies reset whenever a non-alphabet char breaks
 *  the run, and the sentinel iteration at i === length flushes a run that
 *  ends the string. Runs shorter than the minimum, or alphanumeric-only
 *  (no '+'/'/'), never fire — long camelCase identifiers must survive. */
function hasBase64SecretRun(display: string): boolean {
  let run = 0;
  let lower = 0;
  let upper = 0;
  let digit = 0;
  let punct = 0; // '+' or '/'
  for (let i = 0; i <= display.length; i++) {
    const ch = i < display.length ? display.charAt(i) : ""; // sentinel: flush
    const isLower = ch >= "a" && ch <= "z";
    const isUpper = ch >= "A" && ch <= "Z";
    const isDigit = ch >= "0" && ch <= "9";
    if (isLower || isUpper || isDigit || ch === "+" || ch === "/") {
      run++;
      if (isLower) lower++;
      else if (isUpper) upper++;
      else if (isDigit) digit++;
      else punct++;
    } else {
      if (
        run >= MIN_BASE64_RUN &&
        lower > 0 &&
        upper > 0 &&
        digit > 0 &&
        punct > 0
      ) {
        return true;
      }
      run = 0;
      lower = 0;
      upper = 0;
      digit = 0;
      punct = 0;
    }
  }
  return false;
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