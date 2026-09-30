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
 * Every RawToken carries its UTF-16 span (start inclusive, end exclusive)
 * into the exact `text` argument — always valid String.prototype.slice
 * bounds (text.slice(t.start, t.end) === t.raw). Consumed by ingest for the
 * strict whitespace-only adjacency bigram rule (P1.M1.T3.S2, PRD 002 §06
 * h3.6); since ingest tokenizes maskSecrets(segment) and masking blanks in
 * place, the offsets are into the POST-maskSecrets segment string by the
 * time a consumer sees them.
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

/** PRD §04 rule 2: 6–40 hex chars, at least one letter a-f, \b-anchored. */
const HEXISH_RE = /(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g;

/** 2026-09 filename rule: word run with ≥1 dotted part whose FINAL part
 *  is 1–5 letters (AGENTS.md, package.json, file.tar.gz). Version
 *  numbers and decimals never match (final part must be letters). */
const FILENAME_RE = /\b[A-Za-z][A-Za-z0-9_]{0,30}(?:\.[A-Za-z0-9_]{1,16}){0,2}\.[A-Za-z]{1,5}\b/g;

/** 2026-09 hyphen-compound rule: a letter-initial run of ≥2 segments
 *  joined by SINGLE inner hyphens ("load-bearing", "opt-in",
 *  "e2e-test", "state-of-the-art"). The hyphen does NOT split — the
 *  compound as typed is the completion target, parts absorbed like the
 *  filename pass. Leading/doubled hyphens never match (CLI "--flag",
 *  "-v" are not tokens); inner segments may hold digits/underscores. */
const HYPHEN_RE = /\b[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)+\b/g;

/** 2026-10 technical-literal rule (rule 4c) + path rule (4d) shared scan:
 *  maximal runs over the literal charset — alphanumerics joined by single
 *  INTERIOR symbols from LITERAL_SYMBOL_CHARS (4c), and slash-joined
 *  path-shaped runs (4d, spec/04 adopted 2026-10; window widened
 *  {4,80} → {4,96} per spec/04 so long paths fit). Raw pass regex (bounds
 *  pre-trim); per-match classification lives in classifyLiteral /
 *  classifyPath — a run qualifying as BOTH takes the path class (4d
 *  first). */
const LITERAL_RE = /[A-Za-z0-9._@:+/~=-]{4,96}/g;

/** Join symbols for rule 4c technical literals. Curated: sentence/
 *  prose punctuation (, ; ! ? quotes brackets % & * #) is excluded so
 *  prose never glues; `#` additionally excluded because it is the
 *  completion trigger char. Symbols must be SINGLE and INTERIOR
 *  (alphanumeric on both sides after edge trimming). */
const LITERAL_SYMBOL_CHARS = new Set("._@:+/~=-");

/** Post-trim length floor for technical literals (2026-10 rule 4c).
 *  Mirrors the owner's "numbers over 3 digits" floor — pure digit
 *  runs qualify at ≥ 4 digits, and mixed runs need ≥ 4 chars too, so
 *  two-char codes ("4K") and three-digit numbers stay out. */
const LITERAL_MIN_LENGTH = 4;

/** Hash-shape discriminator for letter-initial tokens both passes matched. */
const HAS_DIGIT_RE = /[0-9]/;

/** Rule 4d ':line:col' tail on a path key ('src/foo.ts:42:13'). No /g
 *  flag — no shared lastIndex. Used against a per-match slice (allocated
 *  only when the run actually contains a ':'). */
const LINECOL_TAIL_RE = /(?::\d+){1,2}$/;

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
 * historical behavior. `undefined` (string edge) → false. The BEFORE side
 * resolves astral (surrogate-pair) letters code-point-correctly via
 * `isUniLetterBefore`; the AFTER side needs no help because codePointAt() at
 * a high surrogate already returns the full pair.
 */
function isUniLetter(cp: number | undefined): boolean {
  if (cp === undefined) return false;
  const ch = String.fromCodePoint(cp);
  return UNI_LETTER_RE.test(ch) && !ASCII_LETTER_RE.test(ch);
}

/**
 * Rule 3 before-side check, code-point-correct: when the code unit at
 * index-1 is a low surrogate (0xDC00–0xDFFF), the guard position holds
 * the SECOND half of an astral letter — back up one more unit so
 * codePointAt() resolves the full surrogate pair (codePointAt at a HIGH
 * surrogate already returns the pair; that is why the after-side checks
 * never needed this). String edges resolve to undefined/NaN → false.
 */
function isUniLetterBefore(text: string, index: number): boolean {
  const cu = text.charCodeAt(index - 1); // NaN at index 0 → falls through
  if (cu >= 0xdc00 && cu <= 0xdfff) {
    return isUniLetter(text.codePointAt(index - 2));
  }
  return isUniLetter(text.codePointAt(index - 1));
}

/** Validate one rule-4c raw match (a maximal literal-charset run) and
 *  return its post-trim [from, to) bounds, or null when it does not
 *  qualify as a technical literal. A literal must:
 *   1. Trim leading/trailing symbol chars — symbols never start or end
 *      a candidate (kills sentence-final `fox.`-gluing and CLI `--`
 *      prefixes alike; `2560x1440@2.` → `2560x1440@2`).
 *   2. Be 4–64 chars post-trim (LITERAL_MIN_LENGTH mirrors the owner's
 *      "numbers over 3 digits" floor).
 *   3. Contain NO two adjacent interior symbols — `..`, `//`, `::`
 *      reject (URLs `http://…` die here exactly as today; the run falls
 *      back to the base/filename passes). After trimming, every kept
 *      symbol is single and interior by construction.
 *   4. Contain a digit — the owner's "any two of numbers/symbols/
 *      letters" rule with the digit-bearing guard: digit+letter,
 *      digit+symbol, or all three qualify (pure digit runs ≥ 4 qualify
 *      trivially). Digit-FREE letter+symbol strings (`C++`, `and/or`,
 *      `e.g.`) do NOT — that class stays with the 4a/4b compound rules,
 *      where prose-shaped noise is already curated away. Digits are the
 *      code-shape discriminator: prose almost never glues into a
 *      digit-bearing run.
 */
function classifyLiteral(raw: string): { from: number; to: number } | null {
  let from = 0;
  let to = raw.length;
  while (from < to && LITERAL_SYMBOL_CHARS.has(raw.charAt(from))) from++;
  while (to > from && LITERAL_SYMBOL_CHARS.has(raw.charAt(to - 1))) to--;
  const len = to - from;
  if (len < LITERAL_MIN_LENGTH || len > 64) return null;
  let digit = false;
  let prevSymbol = false;
  for (let i = from; i < to; i++) {
    const ch = raw.charAt(i);
    if (LITERAL_SYMBOL_CHARS.has(ch)) {
      if (prevSymbol) return null; // adjacent symbols: `..` `//` `::`
      prevSymbol = true;
    } else {
      prevSymbol = false;
      if (ch >= "0" && ch <= "9") digit = true;
    }
  }
  return digit ? { from, to } : null;
}

/** Path-shape predicate over [from, to) of `raw` (rule 4d step 4): no
 *  ':' anywhere (a colon outside a successfully-trimmed line:col tail
 *  disqualifies — `localhost:8080`, `a/b.ts:42` stay non-paths); at
 *  least 2 INTERIOR single '/' separators, or exactly 1 interior '/'
 *  plus a dotted component ('docs/architecture.md' yes, 'and/or' no).
 *  The adjacent-symbol guard has already rejected doubled separators, so
 *  every '/' is single by construction. O(to - from), allocation-free. */
function pathShaped(raw: string, from: number, to: number): boolean {
  let slashes = 0;
  let dot = false;
  for (let i = from; i < to; i++) {
    const ch = raw.charAt(i);
    if (ch === ":") return false;
    if (ch === "/") {
      if (i > from && i < to - 1) slashes++; // interior only
    } else if (ch === ".") {
      dot = true;
    }
  }
  return slashes >= 2 || (slashes === 1 && dot);
}

/** Validate one rule-4d raw match (a maximal literal-charset run) and
 *  return the TRIMMED KEY bounds [from, to) inside `raw`, or null when
 *  it does not qualify as a path. Runs in the pass-4 loop try this
 *  BEFORE classifyLiteral — a slash-bearing run qualifying both ways
 *  takes the path class (spec/04:128-131). A path must:
 *   1. Trim EDGE symbols: leading `/`, `~`, `./`, `../` and combinations
 *      (every char in "/~."), trailing sentence periods (ALL — `.` never
 *      ends a file name; 4c's `fox.` guard applied to the path family),
 *      and one trailing `/` (periods may interleave: `a/b./` → `a/b`).
 *      Periods and the trailing `/` trim from KEY and DISPLAY alike — the
 *      caller slices raw to [0, to) so the insertion text never carries a
 *      sentence period (2026-10 validation MAJOR 2); leading edge symbols
 *      stay display-only (the key≠display divergence is the point of 4d).
 *   2. Carry no two adjacent interior symbols — interior `..` ('a/../b')
 *      rejects the WHOLE run, exactly like 4c's `//`/`::`. Leading `../`
 *      was already trimmed as an edge, so only interior doubles die.
 *   3. Trim ONE `:line(:col)?` tail — but only when the REMAINDER is
 *      path-shaped and colon-free ('src/foo.ts:42:13' → 'src/foo.ts');
 *      otherwise restore and continue with the unstripped key
 *      ('4:36', 'localhost:8080' fall to 4c; 'a/b.ts:42:13:99' — whose
 *      remainder 'a/b.ts:42' still holds a colon — is PINNED to the 4c
 *      literal class).
 *   4. Be path-shaped: ≥ 2 interior single '/' separators, or exactly 1
 *      interior '/' plus a dotted component.
 *   5. Be 4–96 chars post-trim (the window caps the raw at 96; the floor
 *      rejects shrink-to-nothing trims).
 *
 *  Exported for the §09 h2.55 key-cap cases (tokenize cannot surface a
 *  >96-char key — the window truncates the match first).
 *  O(len), allocation-free except in the colon-tail branch. */
export function classifyPath(raw: string): { from: number; to: number } | null {
  let from = 0;
  let to = raw.length;
  while (from < to && "/~.".includes(raw.charAt(from))) from++;
  // Trailing trim (2026-10 validation MAJOR 2/3): sentence periods come
  // off BEFORE the `:line:col` tail is consulted, so `src/foo.ts:42:13.`
  // loses the period first and the digit tail then matches; a trailing
  // `/` still trims exactly one, and periods may follow it.
  let slashTrimmed = false;
  while (to > from) {
    const c = raw.charAt(to - 1);
    if (c === ".") to--;
    else if (c === "/" && !slashTrimmed) {
      to--;
      slashTrimmed = true;
    } else break;
  }
  const len = to - from;
  if (len < LITERAL_MIN_LENGTH || len > 96) return null;
  let prevSymbol = false;
  for (let i = from; i < to; i++) {
    const ch = raw.charAt(i);
    if (LITERAL_SYMBOL_CHARS.has(ch)) {
      if (prevSymbol) return null; // interior '..', '//', '::' — whole run
      prevSymbol = true;
    } else {
      prevSymbol = false;
    }
  }
  // ':line:col' trim — ONE iteration, restore-on-doubt (see doc above).
  if (raw.lastIndexOf(":", to - 1) >= from) {
    const tail = LINECOL_TAIL_RE.exec(raw.slice(from, to));
    if (tail !== null) {
      const candTo = to - tail[0].length;
      if (pathShaped(raw, from, candTo)) {
        to = candTo; // remainder is path-shaped and colon-free
      }
    }
  }
  if (!pathShaped(raw, from, to)) return null;
  return { from, to };
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
 * `hexish: true`. Never emits overlapping tokens; never lowercases. Each
 * token reports its own span as UTF-16 offsets into `text` (start
 * inclusive, end exclusive) — a hexish token that absorbed base tails
 * reports the hexish span, never an absorbed tail's. Dead (disqualified or
 * absorbed) tokens are skipped, so their spans never surface.
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
        isUniLetterBefore(text, m.index) ||
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
    if (isUniLetterBefore(text, start) || isUniLetter(text.codePointAt(end))) {
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
  // sentenceStart (2026-09 rule): sentence-ending punctuation — `.`/`!`/`?`,
  //  optionally wrapped in closers (quotes/brackets), then whitespace —
  //  immediately before the token. Orthographic capitals at that position
  // are not proper-name evidence (expandCandidates consults the flag).
  // isSentenceStartBefore: bounded walk-back (O(1) per token — an
  // O(start) slice+regex here made ingest quadratic and blew the 800 KB
  // perf gate).
  // STRUCTURAL-START detection (2026-09, extended after live audit:
  // sentence punctuation alone missed message starts, bullets, headings,
  // and colons — the actual source of "Project"-class clutter in
  // markdown-heavy sessions). A token is at a structural start when it
  // is (a) the first word of its LINE (covers message starts and every
  // wrapped sentence), (b) preceded by a bullet/heading/numbered-list
  // marker run ("- ", "* ", "## ", "1. "), or (c) preceded
  // (after whitespace and closing quotes/brackets) by sentence or
  // clause punctuation (. ! ? ; :). Bounded walk-back, O(1) per token.
  const isSentenceStartBefore = (text: string, start: number): boolean => {
    // Bounded window (perf gate: an unbounded lastIndexOf/slice per token
    // made ingest quadratic on long lines). A token is structurally
    // initial iff only whitespace precedes it on its line (walk back to
    // '\n' or a non-space within the window), or the ≤12 chars before it
    // form a bullet/heading/list marker run, or (after whitespace and
    // closers) sentence/clause punctuation.
    let i = start;
    let sawNonSpace = false;
    let k = start;
    const lim = Math.max(0, start - 64);
    while (k > lim) {
      const c = text[k - 1];
      if (c === "\n") break; // only whitespace (or nothing) since line start
      if (!/\s/.test(c)) { sawNonSpace = true; break; }
      k--;
    }
    if (!sawNonSpace && (k === 0 || text[k - 1] === "\n")) return true; // first word of line / message
    // bullet/heading/list marker immediately before (≤ 12-char window)
    const w = text.slice(Math.max(lim, start - 12), start);
    if (/^\s*([-*+>#]+|\d+[.)])\s*$/.test(w)) return true;
    // punctuation (after whitespace + closing quotes/brackets), ≤ 12 chars
    let m = w.length;
    while (m > 0 && /\s/.test(w[m - 1])) m--;
    while (m > 0 && ")]}\\\"'’”»".includes(w[m - 1])) m--;
    return m > 0 && ".!?;:".includes(w[m - 1]);
  };
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
    out.push({
      raw: t.raw,
      hexish: t.hexish,
      start: t.start,
      end: t.end,
      sentenceStart: isSentenceStartBefore(text, t.start),
    });
  }

  // Pass 3 — COMPOUND tokens (2026-09 rules): dotted filename-shaped
  // runs ("AGENTS.md", "package.json", "file.tar.gz") and hyphenated
  // compounds ("load-bearing", "state-of-the-art"). Neither '.' nor an
  // inner '-' is a word boundary here — the compound as typed is the
  // completion target ("agent" offers "AGENTS.md"; "load" offers
  // "load-bearing"), never the bare parts. Version numbers ("v1.2.3")
  // and decimals ("3.14") keep the base-pass split; CLI "--flag"/"-v"
  // are not tokens. Every base/hexish token fully inside a compound
  // span is absorbed (dropped) — same absorption semantics as the
  // hexish pass. Both span families feed ONE sorted array; they cannot
  // overlap (dots and hyphens are mutually exclusive inside a span).
  FILENAME_RE.lastIndex = 0;
  HYPHEN_RE.lastIndex = 0;
  LITERAL_RE.lastIndex = 0;
  const compounds: Array<{ raw: string; start: number; end: number }> = [];
  for (const re of [FILENAME_RE, HYPHEN_RE]) {
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      compounds.push({ raw: m[0], start: m.index, end: m.index + m[0].length });
    }
  }
  // Pass 4 — TECHNICAL LITERALS (2026-10 rule 4c): digit-bearing mixed
  // strings ("2560x1440@2", "v1.2.3", "192.168.1.1", "2e-test") and
  // pure digit runs ≥ 4 ("8080"). Feeds the SAME absorber list as the
  // 4a/4b compound family — literals absorb every base/hexish token
  // STRICTLY inside their span ("2560x1440@2" absorbs its base tail
  // "x1440", "v1.2.3" absorbs "v1") exactly like compound absorption.
  // Guards:
  //  - rule-3 Unicode-letter adjacency disqualifies ("草2560x1440@2"
  //    yields NOTHING, matching the base/hexish passes);
  //  - a literal with EXACTLY the span of a kept token (base, hexish, or
  //    compound) defers to that token — the pass is STRICTLY ADDITIVE.
  //    Equal spans mean identical raw, and the existing token's class
  //    carries richer semantics: letter-initial mixed identifiers
  //    ("utf8Reader") keep camelCase subword splitting as base tokens,
  //    and hexish flags (opacity, gate interplay) stay intact. The
  //    literal class exists for what the other passes CANNOT see:
  //    digit-initial runs and symbol-joined codes.
  const literals: Array<{ raw: string; start: number; end: number }> = [];
  // Rule 4d path spans: start/end bound the DISPLAY span — the original
  // match minus its trailing trims (sentence periods, one trailing `/`,
  // a trimmed `:line:col` tail; classifyPath owns the trim decisions).
  // raw is the sliced display text (text.slice(start, end) === raw) and
  // trimFrom/trimTo carry the KEY bounds inside it (raw.slice(trimFrom,
  // trimTo) is the store key source; expandCandidates lowercases it).
  const paths: Array<{
    raw: string;
    start: number;
    end: number;
    trimFrom: number;
    trimTo: number;
  }> = [];
  // `out` ascends by start and regex scanning yields literals in ascending
  // start order too, so one monotonic cursor answers the equal-span check
  // in O(out + literals) — an out.some() here made ingest quadratic and
  // blew the 800 KB perf gate (2026-10, mirrors the hexish pass cursor).
  let ck = 0;
  for (let m = LITERAL_RE.exec(text); m !== null; m = LITERAL_RE.exec(text)) {
    // Rule 4d FIRST — a run qualifying as both path and literal takes the
    // path class (spec/04:128-131).
    const p = classifyPath(m[0]);
    if (p !== null) {
      const start = m.index;
      // Span end = KEY end: the trimmed tail (sentence period, trailing
      // `/`, `:line:col`) is off the DISPLAY too — the user retypes the
      // path, not line numbers (spec/04 4d) — and ending the span BEFORE
      // a sentence period breaks the strict-whitespace adjacency run
      // there, so a sentence-final path never bigrams into the next
      // sentence.
      const end = start + p.to;
      // Rule-3 guard at the TRIMMED bounds (the KEY's edges — a Unicode
      // letter glued to the key disqualifies the run whole; this is why
      // the guard cannot reuse the raw match bounds). The char AT p.to is
      // a trimmed `.`/`/`/`:` — never a Unicode letter — so the guard's
      // verdict is unchanged by the span shrink.
      if (
        isUniLetterBefore(text, start + p.from) ||
        isUniLetter(text.codePointAt(start + p.to))
      ) {
        continue;
      }
      while (ck < out.length && out[ck].end <= start) ck++; // ends before us
      const o = out[ck];
      if (o !== undefined && o.start === start && o.end === end) {
        continue; // equal-span defer — structurally impossible for paths
        // (they contain '/'), kept for symmetry with the literal pass
      }
      paths.push({
        raw: m[0].slice(0, p.to),
        start,
        end,
        trimFrom: p.from,
        trimTo: p.to,
      });
      continue;
    }
    const lit = classifyLiteral(m[0]);
    if (lit === null) continue;
    const start = m.index + lit.from;
    const end = m.index + lit.to;
    if (isUniLetterBefore(text, start) || isUniLetter(text.codePointAt(end))) {
      continue;
    }
    while (ck < out.length && out[ck].end <= start) ck++; // ends before us
    const o = out[ck];
    if (o !== undefined && o.start === start && o.end === end) {
      continue; // equal-span token wins — pass is additive-only
    }
    literals.push({ raw: text.slice(start, end), start, end });
  }
  if (compounds.length > 0 || literals.length > 0 || paths.length > 0) {
    // Union with containment dedupe: sort by start asc, longer span first,
    // compound before literal before path on exact ties (same raw either
    // way for compound/literal; a path tie is structurally impossible —
    // paths contain '/', no other family can produce that span — the
    // rank is symmetry only), then drop any span fully covered by an
    // already-kept span's end. Overlaps between the families are almost
    // impossible by construction (a compound match inside a literal/path
    // run can only start at the run's first char), but the filter makes
    // "never overlapping spans" a structural invariant instead of a
    // proof obligation.
    const spans: Array<{
      raw: string;
      start: number;
      end: number;
      literal: boolean;
      path: boolean;
      trimFrom: number;
      trimTo: number;
    }> = [
      ...compounds.map((c) => ({
        ...c,
        literal: false,
        path: false,
        trimFrom: 0,
        trimTo: 0,
      })),
      ...literals.map((l) => ({
        ...l,
        literal: true,
        path: false,
        trimFrom: 0,
        trimTo: 0,
      })),
      ...paths.map((p) => ({
        ...p,
        literal: false,
        path: true,
      })),
    ].sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        (a.literal ? 1 : 0) - (b.literal ? 1 : 0) ||
        (a.path ? 1 : 0) - (b.path ? 1 : 0),
    );
    const absorbers: typeof spans = [];
    let maxEnd = -1;
    for (const s of spans) {
      if (s.end <= maxEnd) continue; // contained in a kept span
      absorbers.push(s);
      maxEnd = s.end;
    }
    const mk = (fn: (typeof spans)[number]): RawToken => ({
      raw: fn.raw,
      hexish: false,
      literal: fn.literal,
      path: fn.path,
      // trim bounds exist only on path tokens (the key source; see
      // RawToken.trimFrom/trimTo in types.ts)
      ...(fn.path ? { trimFrom: fn.trimFrom, trimTo: fn.trimTo } : {}),
      start: fn.start,
      end: fn.end,
      sentenceStart: isSentenceStartBefore(text, fn.start),
    });
    const kept: RawToken[] = [];
    let f = 0;
    let lastEmitted = -1;
    const emitFn = (idx: number): void => {
      if (idx !== lastEmitted) {
        kept.push(mk(absorbers[idx]));
        lastEmitted = idx;
      }
    };
    for (const tok of out) {
      // absorbers entirely before this token (none absorbed it) emit first
      while (f < absorbers.length && absorbers[f].end <= tok.start) {
        emitFn(f);
        f++;
      }
      const fn = absorbers[f];
      if (fn !== undefined && fn.start <= tok.start && tok.end <= fn.end) {
        emitFn(f); // token absorbed by the compound/literal span
        continue;
      }
      if (fn !== undefined && fn.start < tok.end) {
        emitFn(f); // overlap safety (\b boundaries make this unreachable)
        f++;
      }
      kept.push(tok);
    }
    for (; f < absorbers.length; f++) emitFn(f);
    return kept;
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
  /** true for path-shaped candidates (2026-10 rule 4d): the key is the
   *  edge/line:col-trimmed lowercase path while display keeps the
   *  original edge symbols (the first key≠display divergence beyond
   *  casing). Paths are never proper names. Downstream: T2.S2 applies
   *  class-conditional shape-gate caps via this flag. */
  path?: boolean;
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
  // properName (2026-09 sentence-initial rule): a Capitalized token
  // right after sentence-ending punctuation is sentence-INITIAL — the
  // capital is orthographic, not a name signal, so the hint is
  // suppressed. Same for the token's FIRST sub-word (it begins the
  // token; mid-token sub-words keep their own semantics).
  const nameInitial = isUpperAscii(token.raw.charAt(0)) && !token.sentenceStart;
  const whole: CandidateDraft = {
    key: token.raw.toLowerCase(),
    display: token.raw,
    properName: nameInitial,
    isSubword: false,
  };
  // Opaque classes — never subword-split: hexish (2026-09, S2 rule),
  // technical literals (2026-10 rule 4c), and paths (2026-10 rule 4d).
  // A code like "2560x1440@2" or a commit-hash-shaped token completes
  // whole as typed; splitting codes at camel/underscore boundaries would
  // manufacture junk sub-candidates.
  //
  // PATHS (rule 4d) — the ONLY key≠display site beyond casing: the key
  // is the trimmed lowercase slice (edge `/~.` chains, one
  // ':line(:col)?' tail, trailing sentence periods stripped) while
  // display keeps the leading edge symbols (insertion preserves the
  // leading '/' and '..' exactly as typed); line numbers and sentence
  // punctuation are not user intent and are already gone from token.raw
  // (see the pass-4 span comment).
  // properName is pinned FALSE — a documented choice: paths are not
  // names (spec is silent; recorded for T2.S3's display-flow audit).
  if (token.path) {
    return [
      {
        key: token.raw
          .slice(token.trimFrom ?? 0, token.trimTo ?? token.raw.length)
          .toLowerCase(),
        display: token.raw, // ORIGINAL edges preserved for insertion
        properName: false,
        isSubword: false,
        path: true,
      },
    ];
  }
  if (token.hexish || token.literal) return [whole];

  const parentKey = whole.key;
  const subs: CandidateDraft[] = [];
  let firstPart = true; // the first split part begins the token
  for (const seg of token.raw.split("_")) {
    if (seg.length === 0) continue;
    for (const sub of splitCamel(seg)) {
      const atTokenStart = firstPart;
      firstPart = false;
      // A part equal to the whole token (single segment, no boundary — e.g.
      // "HTTPS") IS the whole token, never a sub-word of itself.
      if (sub === token.raw) continue;
      if (sub.length < 4) continue;
      subs.push({
        key: sub.toLowerCase(),
        display: sub,
        // First sub-word of a sentence-initial token: its capital is
        // orthographic too ("DownloadManager" after ". ").
        properName: atTokenStart ? nameInitial : isUpperAscii(sub.charAt(0)),
        isSubword: true,
        parentKey,
      });
    }
  }
  return [whole, ...subs];
}