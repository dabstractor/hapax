/**
 * Base tokenization — stage 1 of the segment → shapeGate → score → store →
 * query pipeline (PRD §04 segmentation rules 1–4; unit cases §09).
 *
 * `tokenize` is pure: no node/pi imports (type-only import of RawToken), no
 * external state beyond the module-scope regexes (whose /g lastIndex is reset
 * on every call). Rule 3 (R2 delta): a word candidate must be bounded on BOTH
 * sides by non-letter characters, where ANY Unicode letter counts as a letter
 * — a run adjacent (either side) to a Unicode letter is disqualified whole
 * (Þórhildur, ΩbsidianMirror, 草sword emit nothing — never their ASCII
 * remainder), while space/punctuation-bounded ASCII beside a CJK run still
 * tokenizes normally ("fix 方法 error" → fix, error). The scan regexes stay
 * ASCII-only; disqualification is a post-hoc per-match guard (isUniLetter
 * below), keeping regex cost unchanged for the ASCII hot path. Punctuation
 * and whitespace terminate tokens — no hyphen or apostrophe joining (rule 4).
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
 *
 * Stage 2 — expandCandidates() (S2, same module): takes each RawToken and
 * emits the whole token plus its camelCase/snake_case sub-words (length ≥ 4)
 * as CandidateDrafts, normalized per PRD §04 h3.4/h3.5 (lowercase key,
 * as-seen display casing, per-candidate properName hint). Hexish tokens are
 * opaque — returned as a single whole-token draft, never split. Consumers:
 * shapeGate (P1.M2.T2 passesShape) and score admission (P1.M2.T3.S1), which
 * read isSubword/parentKey.
 */

import type { RawToken } from "./types.js";

/** PRD §04 rule 1: base tokens are [A-Za-z][A-Za-z0-9_]* capped at 64. */
const BASE_RE = /[A-Za-z][A-Za-z0-9_]{0,63}/g;

/** PRD §04 rule 2: 6–40 hex chars, at least one letter a–f, \b-anchored. */
const HEXISH_RE = /(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g;

/** Hash-shape discriminator for letter-initial tokens both passes matched. */
const HAS_DIGIT_RE = /[0-9]/;

/** Any Unicode letter (PRD §04 rule 3, R2 delta): CJK, Latin-1, Greek, … */
const UNI_LETTER_RE = /\p{L}/u;

/** ASCII letters — the only letters the scan regexes can consume. */
const ASCII_LETTER_RE = /[A-Za-z]/;

/**
 * True when a guard-position code point is a NON-ASCII Unicode letter, i.e. a
 * character the ASCII scan regexes could never have consumed — its adjacency
 * disqualifies the whole candidate run (rule 3, R2). ASCII letters are
 * excluded: a maximal-class base match cannot abut one, EXCEPT at the 64-char
 * cap split ("zz…z" × 70 → 64 + 6), where both segments must keep their
 * historical behavior. `undefined` (string edge) → false. Limitation: an
 * astral letter (surrogate pair) immediately BEFORE a match is seen via
 * codePointAt() as its lone low surrogate, which is not \p{L}, so such runs
 * slip through; the AFTER side is code-point-correct because codePointAt() at
 * a high surrogate returns the full pair. Accepted v1 trade-off.
 */
function isUniLetter(cp: number | undefined): boolean {
  if (cp === undefined) return false;
  const ch = String.fromCodePoint(cp);
  return UNI_LETTER_RE.test(ch) && !ASCII_LETTER_RE.test(ch);
}

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
      // Rule 3 (R2): a run abutting a Unicode letter on either side is
      // disqualified whole. Disqualified runs are still pushed (dead: true)
      // rather than skipped, so pass-2 cursor/dedupe math keeps seeing their
      // span: a hexish match inside a disqualified identifier must die with
      // it ("草x0f3a9c2" must not leak "0f3a9c2"), and equal-span letter-
      // initial hexish overlaps must not resurrect it. The merge drops dead
      // tokens, so nothing is emitted.
      const dead =
        isUniLetter(text.codePointAt(m.index - 1)) ||
        isUniLetter(text.codePointAt(m.index + m[0].length));
      bases.push({
        raw: m[0],
        start: m.index,
        end: m.index + m[0].length,
        hexish: false,
        dead,
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
    // Rule 3 (R2): hexish runs abutting a Unicode letter on either side (the
    // trailing \b still matches there — a Unicode letter is non-\w to the
    // ASCII regex) are disqualified whole. Their base-captured inner tails
    // must die with them ("草0f3a9c2" must not leak tail "f3a9c2"), so the
    // absorb-contained-bases bookkeeping runs, but the hexish token itself
    // is not pushed. Advancing k here is safe: bases passed over either end
    // before `start` or lie fully inside this span, so no later match can
    // interact with them.
    if (
      isUniLetter(text.codePointAt(start - 1)) ||
      isUniLetter(text.codePointAt(end))
    ) {
      while (k < bases.length && bases[k].start < end) {
        if (bases[k].end <= end) bases[k].dead = true;
        k++;
      }
      continue;
    }
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

/** One candidate occurrence produced by segment.ts. Input shape for the
 *  shape gate (P1.M2.T2 passesShape) and score admission (P1.M2.T3.S1).
 *  Segment-stage only — Candidate/Sighting (store-level) live in types.ts.
 *  PRD §04 h3.4/h3.5. */
export interface CandidateDraft {
  /** lowercase — lookup/store key */
  key: string;
  /** casing of this sighting (recency-merge is the store's job) */
  display: string;
  /** first char of display is uppercase at extraction */
  properName: boolean;
  isSubword: boolean;
  /** lowercase key of the parent whole token; set iff isSubword */
  parentKey?: string;
}

/** A–Z test (ASCII only — tokenize() never emits non-ASCII into tokens). */
function isUpperAscii(c: string): boolean {
  return c >= "A" && c <= "Z";
}

/**
 * Split one `_`-free segment at camelCase boundaries (PRD §04 h3.4): before
 * an uppercase char whose previous char is lowercase or a digit (lower→up:
 * "fixR" → "fix|R"), or whose previous char is uppercase and next char is
 * lowercase (acronym-lowercase: "HTTPServer" → "HTTP|Server"). Digits
 * themselves never create boundaries ("utf8Reader" splits only before R).
 * The lookahead means an acronym run with no trailing lowercase ("HTTPS")
 * stays whole. The boundary regex has no /g flag — no shared lastIndex.
 */
function splitCamel(seg: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i < seg.length; i++) {
    const c = seg[i];
    if (isUpperAscii(c)) {
      const prev = seg[i - 1];
      const next = i + 1 < seg.length ? seg[i + 1] : "";
      if (
        /[a-z0-9]/.test(prev) ||
        (isUpperAscii(prev) && next >= "a" && next <= "z")
      ) {
        parts.push(seg.slice(start, i));
        start = i;
      }
    }
  }
  parts.push(seg.slice(start));
  return parts;
}

/**
 * Expand one raw token into candidate drafts (PRD §04 h3.4/h3.5): the whole
 * token first, then every camelCase/snake_case sub-word of length ≥ 4.
 * Shorter sub-words are dropped as standalone candidates; the whole token
 * survives regardless of length (shape-gate length rules are P1.M2.T2's).
 *
 * Splitting: on `_` segments (empties dropped; underscores are KEPT in the
 * whole token — users Tab the identifier as typed) and camelCase boundaries
 * within each segment. Hexish tokens are opaque: exactly the whole-token
 * draft, never split.
 *
 * Normalization: `key` is lowercase; `display` is this sighting's casing
 * (recency merge is the store's job, P1.M2.T4.S1); `properName` comes from
 * the candidate's own display initial; `parentKey` is set iff `isSubword`.
 *
 * Pure: no state, no runtime imports (RawToken is a type-only import).
 */
export function expandCandidates(token: RawToken): CandidateDraft[] {
  const whole: CandidateDraft = {
    key: token.raw.toLowerCase(),
    display: token.raw,
    properName: isUpperAscii(token.raw.charAt(0)),
    isSubword: false,
  };
  if (token.hexish) return [whole];

  const parentKey = whole.key;
  const subs: CandidateDraft[] = [];
  for (const seg of token.raw.split("_")) {
    if (seg.length === 0) continue;
    for (const sub of splitCamel(seg)) {
      // A part equal to the whole token (single segment, no boundary — e.g.
      // "HTTPS") IS the whole token, never a sub-word of itself.
      if (sub === token.raw) continue;
      if (sub.length < 4) continue;
      subs.push({
        key: sub.toLowerCase(),
        display: sub,
        properName: isUpperAscii(sub.charAt(0)),
        isSubword: true,
        parentKey,
      });
    }
  }
  return [whole, ...subs];
}