/**
 * Base tokenization — stage 1 of the segment → shapeGate → score → store →
 * query pipeline (PRD §04 segmentation rules 1–4; unit cases §09).
 *
 * `tokenize` is pure: no node/pi imports (type-only import of RawToken), no
 * external state beyond the module-scope regexes (whose /g lastIndex is reset
 * on every call). CJK and all other non-ASCII text falls outside the ASCII
 * character classes, so those runs are skipped for free and ASCII words
 * resume after them (rule 3). Punctuation and whitespace terminate tokens —
 * no hyphen or apostrophe joining (rule 4).
 *
 * Passes (PRD §04):
 *  1. Base: /[A-Za-z][A-Za-z0-9_]{0,63}/g — ASCII identifiers/words, capped
 *     at 64 chars by the quantifier. Length-1 matches are dropped (base
 *     tokens are 2–64; the admission minimum of ≥4 is the shape gate's job,
 *     not ours). Because the base regex has no \b, a >64-char identifier
 *     yields consecutive capped matches (64 + remainder), never a boundary
 *     issue.
 *  2. Hexish: /(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g — runs of
 *     6–40 hex chars containing at least one letter a–f (commit-hash-shaped).
 *     The lookahead requires that letter, so pure-digit runs ("123456") match
 *     nothing. \b + the {6,40} window mean a match takes the LAST ≤40 chars
 *     of any longer run (regex-as-spec, verified empirically): all-letter
 *     overruns are absorbed by their own base capture (below); digit-led
 *     overruns surface as a ≤40-char hexish token, which the shape gate
 *     (≥20 pure hex ⇒ reject) deals with downstream.
 *
 * Dedupe — hexish matches that also fall inside a base capture:
 *  - Hexish span strictly inside (or crossing) a base token → dropped; the
 *    identifier stands ("xabcdef1" is one word, not a nested hash).
 *  - Hexish span EQUAL to a base token (letter-initial, both passes saw it):
 *    decided by hash-shape, per the two PRD §09 exemplars — "f3a9c2e"
 *    (contains a digit; never a natural word) → hexish:true, while "abcdef"
 *    (all hex letters; plausibly a word: decade, facade, deface) keeps the
 *    base capture with hexish:false. The digit check is what separates the
 *    PRD's two letter-initial exemplars.
 *  - Hexish span strictly containing base tokens (digit-led "0f3a9c2", whose
 *    tail "f3a9c2" the base pass grabbed) → the hexish scan is genuinely
 *    additive; the contained base tails are absorbed so output spans never
 *    overlap.
 *
 * Output: linear merge of the two ascending, disjoint span lists — document
 * order, hexish tokens in their textual position.
 *
 * Consumed by P1.M2.T1.S2 (camelCase/snake_case subword expansion over this
 * RawToken[]; hexish tokens are opaque to it) and by ingest (P1.M3.T2) per
 * ≤64KB message slice. No normalization/lowercasing here (S2); no shape-gate
 * rules (≥4 chars, entropy, secrets) here (P1.M2.T2).
 */

import type { RawToken } from "./types.js";

/** PRD §04 rule 1: base tokens are [A-Za-z][A-Za-z0-9_]* capped at 64. */
const BASE_RE = /[A-Za-z][A-Za-z0-9_]{0,63}/g;

/** PRD §04 rule 2: 6–40 hex chars, at least one letter a–f, \b-anchored. */
const HEXISH_RE = /(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g;

/** Hash-shape discriminator for letter-initial tokens both passes matched. */
const HAS_DIGIT_RE = /[0-9]/;

/** Internal token with span + liveness for dedupe/merge bookkeeping. */
interface SpanToken {
  raw: string;
  start: number;
  end: number;
  hexish: boolean;
  /** set when a kept hexish span absorbed this token */
  dead: boolean;
}

/**
 * Segment `text` into RawTokens in document order (PRD §04 rules 1–4).
 *
 * Returns one token per disjoint match span, ascending by position: base
 * tokens with `hexish: false`, digit-led/hash-shaped hexish tokens with
 * `hexish: true`. Never emits overlapping tokens; never lowercases.
 */
export function tokenize(text: string): RawToken[] {
  // /g regexes carry mutable lastIndex across calls — always scan from 0.
  BASE_RE.lastIndex = 0;
  HEXISH_RE.lastIndex = 0;

  // Pass 1 — base tokens (rule 1). Spans retained for hexish dedupe;
  // length-1 matches are not emitted (base tokens are length 2–64).
  const bases: SpanToken[] = [];
  for (let m = BASE_RE.exec(text); m !== null; m = BASE_RE.exec(text)) {
    if (m[0].length >= 2) {
      bases.push({
        raw: m[0],
        start: m.index,
        end: m.index + m[0].length,
        hexish: false,
        dead: false,
      });
    }
  }

  // Pass 2 — hexish tokens (rule 2), deduped against base captures. Both
  // lists ascend by start, so one monotonic cursor over the bases makes the
  // pass O(bases + hexish); at most one base can interact with any given
  // hexish span (base spans are disjoint).
  const hexish: SpanToken[] = [];
  let k = 0; // first base not yet known to end before the current hexish span
  for (let m = HEXISH_RE.exec(text); m !== null; m = HEXISH_RE.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    while (k < bases.length && bases[k].end <= start) k++; // ends before us
    const b = bases[k];
    if (b !== undefined && b.start <= start) {
      // `start` lies inside b. Equal span ⇒ letter-initial string both
      // passes saw: a digit proves hash-shape ("f3a9c2e" → hexish:true),
      // an all-hex-letter string stays a base word ("abcdef" → false).
      // Any other shape (nested, or crossing a 64-cap boundary) is dropped;
      // the identifier stands.
      if (b.start === start && b.end === end && HAS_DIGIT_RE.test(m[0])) {
        b.hexish = true;
      }
      continue;
    }
    // Genuinely additive (digit-led or clear of every base edge): absorb
    // base tokens fully inside the hexish run so spans stay disjoint
    // ("0f3a9c2" absorbs its base tail "f3a9c2"). The \b at `end` guarantees
    // no base straddles the right edge, so every overlap is contained.
    while (k < bases.length && bases[k].start < end) {
      if (bases[k].end <= end) bases[k].dead = true;
      k++;
    }
    hexish.push({ raw: m[0], start, end, hexish: true, dead: false });
  }

  // Merge: both lists ascend by start with disjoint spans → linear
  // two-pointer merge produces document order (skipping absorbed bases).
  const out: RawToken[] = [];
  let i = 0;
  let j = 0;
  while (i < bases.length || j < hexish.length) {
    const b = bases[i];
    const h = hexish[j];
    const takeBase = b !== undefined && (h === undefined || b.start < h.start);
    const t = takeBase ? b : h;
    if (takeBase) i++;
    else j++;
    if (t.dead) continue;
    out.push({ raw: t.raw, hexish: t.hexish });
  }
  return out;
}