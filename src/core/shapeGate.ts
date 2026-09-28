/**
 * Shape gate — stage 2 of the segment → shapeGate → score → store → query
 * pipeline (PRD §04 h2.23). `passesShape` is the always-on admission filter:
 * every segmented CandidateDraft goes through here before dictionary lookup,
 * so dictionary-absent words enter the store only through this gate.
 *
 * Rules, evaluated in order — first failure wins (the reason precedence
 * contract): length → secret → lowEntropy → unigramRun → consonantRun.
 *
 *  1. Length on draft.key: whole tokens 2–64, sub-words 2–32
 *     (`tooShort` / `tooLong`). Floor dropped 4 → 2 (2026): short
 *     dictionary-absent acronyms (TUI, API, CLI) are hapax's core class,
 *     and common short English (the, and, for) is owned downstream by
 *     score.ts's commonness rejection — the floor is shape noise
 *     control, never the stopword filter.
 *  2. Secret (`secret`, PRD §04 h2.23 rule 3; security acceptance §09
 *     integration item 5): pasted API keys must never surface as
 *     suggestions, so this rule is always-on with no config escape hatch
 *     (PRD §08). Evaluated on draft.display (raw casing) by
 *     isSecretShaped: known key prefixes (case-insensitive), '@' plus
 *     '.', base64-shaped runs ≥ 24 (mixed case + digit + '+'/'/'),
 *     whole-candidate pure-hex length ≥ 20 and pure-decimal ≥ 16
 *     (private-key / card-shaped), plus the BUG-003 residue rules:
 *     base64url runs ≥ 16 (mixed case + ≥ 2 digits, no '+'/'/'
 *     required) and charset-relative entropy floors (base64-charset
 *     runs ≥ 16 at ≥ 4.5 bits/char; whole-display hex ≥ 16 at ≥ 3.0).
 *     The flat digit+symbol-ratio heuristic (> 0.4 at ≥ 16) was retired
 *     2026-10 — it rejected the technical-literal class (IP:port, ISO
 *     timestamps) hapax exists to complete.
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
 * maskSecrets (BUG-003 layer 1) is the sibling RAW-TEXT layer: it blanks
 * structured secret windows in the segment string before tokenization
 * (wired at IngestPipeline.#admitSegment), so key bytes never reach
 * tokenize() or this gate's token rules. isSecretShaped stays the
 * token-level layer (P1.M2.T2.S1 adds its residue rules there).
 *
 * Pure: type-only imports, no runtime imports, no mutable state. Thresholds
 * and the secret-prefix list are baked constants (PRD: not a tuning
 * surface). Scanners are single-pass and allocation-light apart from the
 * entropy Map — the gate runs on every candidate.
 */

import type { CandidateDraft } from "./segment.js";
import type { GateResult } from "./types.js";

/** Admission minimum on draft.key (whole and sub-word alike). 2 since
 *  the 2026 floor drop (was 4): short dictionary-absent acronyms (TUI,
 *  API, CLI) are hapax's core class, and common short English is
 *  already rejected by the commonness band in score.ts — the floor was
 *  never the stopword defense. tokenize() emits whole tokens ≥ 2 chars,
 *  so the whole-token tooShort branch is defense-in-depth; the entropy
 *  rule independently rejects every 2-char key (max H = 1.0 < 1.5),
 *  making 3 the EFFECTIVE floor for all-distinct keys. */
const MIN_LENGTH = 2;
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
 *  ghp_/gho_/github_pat_, Slack xox[bpars]-, AWS akia, Google aiza,
 *  eyj (every JWT body starts with base64(`{"`) = "eyJ"), and npm_
 *  (Probe C — P1.M2.T2.S3 battery, BUG-003 PRD h3.2: closes the
 *  zero-digit mixed-case npm payload gap S1's bare-run can't reach —
 *  the whole `npm_<payload>` token AND the bare `npm_` remainder token
 *  left after layer-1 payload masking were stored/ranked pre-fix).
 *  PRD §04 h2.23 rule 3, first bullet. Baked constant — no config
 *  surface. NOTE: hyphen-formats (glpat-) can NEVER work here —
 *  tokenize() splits at '-', so they own a maskSecrets regex instead
 *  (see SECRET_WINDOW_RES). */
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
  // Probe C (P1.M2.T2.S3): npm publish tokens 'npm_' + payload — closes
  // the battery's 'npm short: npm_Xoremu…' / bare-'npm_'-remainder cases
  // (<32-char zero-digit payloads pass every other rule). Verified not to
  // fire on prose/fixtures (no 'npm_'-prefixed token in any fixture; the
  // mask-secrets identity + prose-replay suites pin this).
  "npm_",
];
/** Whole-candidate pure-decimal floor (2026-10): 16+ digits with no
 *  letters/symbols is card/account-number-shaped (PANs are 15–16
 *  digits; IMEIs 15) and never a typing target — replaces the retired
 *  digit+symbol ratio heuristic, which rejected legitimate technical
 *  literals like `192.168.1.1:8080` (owner call, 2026-10). */
const MIN_PURE_DECIMAL_LENGTH = 16;
/** Base64-run rule: minimum contiguous base64-alphabet characters. */
const MIN_BASE64_RUN = 24;
/** Pure-hex rule: whole-candidate hex rejects at this length and above.
 *  Hexish 6–12 pass, the 13–19 band stays admitted (PRD §04). */
const MIN_PURE_HEX_LENGTH = 20;
/** Whole-candidate hex alphabet, tested against the lowercased display
 *  (so a–f covers A–F too). No /g flag — no lastIndex state. */
const PURE_HEX_RE = /^[0-9a-f]+$/;
/** Whole-candidate decimal alphabet for the card-shape rule. */
const PURE_DECIMAL_RE = /^[0-9]+$/;

/** BUG-003 residue rule 6: minimum contiguous base64url-alphabet run
 *  ([A-Za-z0-9_-]; NO '+'/'/' requirement — base64url payloads never
 *  contain them, which is exactly why rule 4 missed the leak). Provenance:
 *  bug report h2.5 ("≥16-char mixed-case+digit runs"). */
const BASE64URL_RUN_MIN = 16;
/** BUG-003 residue rule 7a: minimum base64-charset run length before
 *  entropy is consulted (the hexish 13–15 band stays admitted by design —
 *  13 distinct chars cap at log2(13) ≈ 3.7 anyway). */
const MIN_HIGH_ENTROPY_RUN = 16;
/** BUG-003 residue rule 7a: a base64-charset run at/above this many
 *  bits/char reads as random, not word-like. Charset-relative calibration
 *  (external_deps.md §3): English prose ≈ 4.0–4.2, hex caps at 4.0, random
 *  base64 approaches log2(64) ≈ 6 — a flat 3.5 threshold would
 *  false-positive prose, hence the floor sits at 4.5. */
const BASE64_ENTROPY_MIN = 4.5;
/** BUG-003 residue rule 7b: whole-display pure hex below this length is
 *  never entropy-judged (floor 16 keeps the hexish 13–15 band admitted). */
const HEX_ENTROPY_MIN_LENGTH = 16;
/** BUG-003 residue rule 7b: whole-display pure-hex runs at/above this many
 *  bits/char are private-key-shaped residue (random hex averages ≈ 4.0;
 *  structured repeats like abcabc… fall below and stay — rule 5 owns the
 *  ≥ 20 band outright, this closes only the random-looking 16–19 gap). */
const HEX_ENTROPY_MIN = 3.0;

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
  // Letter-free keys skip the entropy floor (2026-10 rule-4c interplay):
  // the only letter-free candidates segmentation admits are technical
  // literals (pure digit runs like "8080", digit+symbol codes like
  // "10.0.0.1"), where sub-1.5-bit entropy is ordinary — two-char
  // alternation ("8080" = 1.0 bits) is exactly a real port/code shape,
  // not noise. The unigram-run rule below still rejects true repetition
  // ("1111", "0000"), and every letter-bearing key keeps the floor
  // unchanged ("aaaaa" stays dead). Pure-digit strings max out at
  // log2(10) ≈ 3.3 bits/char, so the exemption cannot mint high-entropy
  // secrets either — the secret rules above and maskSecrets own those.
  if (/[a-z]/.test(key) && charEntropy(key) < MIN_ENTROPY_BITS) {
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
 * security acceptance §09 integration item 5). Six always-on sub-rules
 * (the seven-rule list lost its digit+symbol-ratio member to the 2026-10
 * retirement — see the RETIRED note inside), any one of which rejects —
 * evaluated in this order:
 *
 *  1. Known key prefixes, case-insensitive on the lowercased display.
 *  2. '@' plus '.' — email belt-and-braces (segmentation excludes emails
 *     anyway; this only fires on unusually constructed drafts).
 *  3. Base64-shaped run ≥ 24 mixing case, digits, and at least one of
 *     '+'/'/' (hasBase64SecretRun — needs ORIGINAL casing, hence display).
 *  4. Long-number shapes: whole-candidate pure hex length ≥ 20
 *     (private-key-shaped; hexish 6–12 stays admitted — per PRD only the
 *     dictionary/admission stage may demote those, never the gate) and
 *     pure decimal ≥ 16 (card/account-shaped — the 2026-10 replacement
 *     for the retired ratio rule's numeric-soup coverage).
 *  5. BUG-003 residue: base64url run ≥ 16 (BASE64URL_RUN_MIN) from
 *     [A-Za-z0-9_-] — NO '+'/'/' requirement, because base64url payloads
 *     never contain them and rule 3 therefore missed the leak — carrying
 *     ≥ 1 lowercase, ≥ 1 uppercase, AND ≥ 2 digits (hasBase64UrlSecretRun).
 *     The ≥2-digit and ≥1-lowercase guards are load-bearing: camelCase
 *     identifiers ("fixRoundingError": zero digits) and SCREAMING_CASE
 *     constants (zero lowercase) must survive.
 *  7. BUG-003 residue: charset-relative entropy (hasHighEntropySecretRun)
 *     — (a) a base64-charset run [A-Za-z0-9+/_-] of ≥ 16 chars at
 *     ≥ 4.5 bits/char with ≥ 1 digit and mixed case or a run symbol;
 *     (b) whole-display pure hex ≥ 16 chars at ≥ 3.0 bits/char. The
 *     thresholds are RELATIVE TO EACH CHARSET'S CEILING (prose ≈ 4.0–4.2
 *     bits/char, hex 4.0, random base64 ≈ 6) — a flat threshold would
 *     false-positive ordinary words.
 *
 * Layering (BUG-003 defense in depth): maskSecrets() blanks structured
 * keys on the RAW segment BEFORE tokenize; these token rules are the
 * format-blind residue layer for fragments that reach the gate anyway.
 * Documented NON-goal: mixed-case no-digit fragments like "wJalrXUtnFEMI"
 * / "bPxRfiCYEXAMPLEKEY" (AWS-secret-shaped 13/18-char pieces) stay
 * gate-admitted on purpose — rules 5/6 require digits, and weakening that
 * to catch them would false-positive camelCase identifiers wholesale;
 * maskSecrets' AWS catch-all owns them when the full key is present. The
 * same layering admits Slack-style lowercase tails ("abcdefghijklmnopqrstu
 * vwx": entropy ≈ 4.6 but no digit, no uppercase) — the Slack masking
 * regex owns the full xoxb-… key.
 *
 * Probe C additions (P1.M2.T2.S3, BUG-003 PRD h3.2 battery): rule 1's
 * 'npm_' entry and maskSecrets' glpat- window exist only because the
 * battery proved them leaking — the whole `npm_<payload>` token (zero
 * digits → rules 5/6 never fire) and the bare 'npm_' remainder left after
 * layer-1 payload masking were stored/ranked pre-fix, as were 'glpat'
 * (tokenization splits the hyphen format) and its payload's sub-words.
 * Documented residual: a <32-char vowel-bearing mixed-case no-digit
 * payload after a prose word like "Bearer " still admits (the battery
 * vector is sized so every sub-word is < 4 chars and the whole token is
 * consonant-run repelled) — no prose-safe rule covers it; owner-accepted.
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

  // RETIRED 2026-10 (owner call): the digit+symbol ratio heuristic
  // (> 0.4 at length ≥ 16). Written before technical literals existed,
  // when nothing legitimate was digit-dominant at that length — it
  // rejected the exact strings hapax exists for (`192.168.1.1:8080`,
  // ISO timestamps, dotted versions). The numeric-soup tail it
  // actually owned (undashed card/account numbers) is now covered by
  // the pure-decimal floor inside the long-number rule below.

  // 3. Base64-shaped run (evaluated on display — mixed case matters).
  if (hasBase64SecretRun(display)) return true;

  // 4. Long-number shapes: whole-candidate pure hex ≥ 20
  //    (private-key-shaped; hexish 6–12 stays admitted) and pure
  //    decimal ≥ 16 (card-shaped, 2026-10 replacement for the retired
  //    ratio rule).
  if (raw.length >= MIN_PURE_HEX_LENGTH && PURE_HEX_RE.test(raw)) return true;
  if (raw.length >= MIN_PURE_DECIMAL_LENGTH && PURE_DECIMAL_RE.test(raw)) {
    return true;
  }

  // 5. Base64url residue run (BUG-003 — no '+'/'/' requirement).
  if (hasBase64UrlSecretRun(display)) return true;

  // 6. Charset-relative entropy residue (BUG-003).
  if (hasHighEntropySecretRun(display)) return true;

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

/** BUG-003 residue rule 6: true when some contiguous run of ≥
 *  BASE64URL_RUN_MIN chars from the base64url alphabet [A-Za-z0-9_-]
 *  carries ≥ 1 lowercase, ≥ 1 uppercase, and ≥ 2 digits. Unlike rule 4
 *  there is NO '+'/'/' requirement — base64url payloads (the BUG-003 leak
 *  shape) never contain them. Scans the ORIGINAL display (case matters).
 *  One left-to-right pass with a sentinel flush at i === length, mirroring
 *  hasBase64SecretRun: class tallies reset whenever a non-alphabet char
 *  breaks the run ('_' and '-' are IN the alphabet and do NOT break it). */
function hasBase64UrlSecretRun(display: string): boolean {
  let run = 0;
  let lower = 0;
  let upper = 0;
  let digit = 0;
  for (let i = 0; i <= display.length; i++) {
    const ch = i < display.length ? display.charAt(i) : ""; // sentinel: flush
    const isLower = ch >= "a" && ch <= "z";
    const isUpper = ch >= "A" && ch <= "Z";
    const isDigit = ch >= "0" && ch <= "9";
    if (isLower || isUpper || isDigit || ch === "_" || ch === "-") {
      run++;
      if (isLower) lower++;
      else if (isUpper) upper++;
      else if (isDigit) digit++;
    } else {
      if (run >= BASE64URL_RUN_MIN && lower > 0 && upper > 0 && digit >= 2) {
        return true;
      }
      run = 0;
      lower = 0;
      upper = 0;
      digit = 0;
    }
  }
  return false;
}

/** Rule 7a predicate for one base64-charset run (length already ≥ floor):
 *  key-shaped texture (≥ 1 digit AND mixed case or a '+'/'/'/'_'/'-'
 *  symbol) AND random-looking entropy (≥ BASE64_ENTROPY_MIN, computed over
 *  the run's own char distribution — never the whole candidate). The
 *  digit guard is what keeps all-lowercase no-digit tails like
 *  "abcdefghijklmnopqrstuvwx" (entropy ≈ 4.6, zero digits) admitted —
 *  weakening it would false-positive prose; masking owns those tails. */
function isHighEntropyB64Run(run: string): boolean {
  let digit = 0;
  let lower = 0;
  let upper = 0;
  let symbol = 0;
  for (let i = 0; i < run.length; i++) {
    const ch = run.charAt(i);
    if (ch >= "0" && ch <= "9") digit++;
    else if (ch >= "a" && ch <= "z") lower++;
    else if (ch >= "A" && ch <= "Z") upper++;
    else symbol++; // '+' '/' '_' '-' — the only run-alphabet chars left
  }
  if (digit === 0) return false;
  if ((lower === 0 || upper === 0) && symbol === 0) return false;
  return charEntropy(run) >= BASE64_ENTROPY_MIN;
}

/** BUG-003 residue rule 7: charset-relative entropy, in two branches.
 *  (a) Any contiguous run ≥ MIN_HIGH_ENTROPY_RUN chars from the base64
 *      alphabet [A-Za-z0-9+/_-] that isHighEntropyB64Run flags. Run
 *      boundaries are tracked by index; the substring is sliced (and its
 *      entropy computed) only for runs reaching the floor — rare, keeping
 *      the hot path allocation-light.
 *  (b) Whole-display pure hex ≥ HEX_ENTROPY_MIN_LENGTH at ≥ HEX_ENTROPY_MIN
 *      bits/char, evaluated on the lowercased display (rule 5's
 *      normalization).
 *  Single left-to-right pass with a sentinel flush, mirroring
 *  hasBase64SecretRun. */
function hasHighEntropySecretRun(display: string): boolean {
  let start = 0;
  for (let i = 0; i <= display.length; i++) {
    const ch = i < display.length ? display.charAt(i) : ""; // sentinel: flush
    const inAlphabet =
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "+" ||
      ch === "/" ||
      ch === "_" ||
      ch === "-";
    if (inAlphabet) continue;
    if (
      i - start >= MIN_HIGH_ENTROPY_RUN &&
      isHighEntropyB64Run(display.slice(start, i))
    ) {
      return true;
    }
    start = i + 1;
  }
  if (display.length >= HEX_ENTROPY_MIN_LENGTH) {
    const raw = display.toLowerCase();
    if (PURE_HEX_RE.test(raw) && charEntropy(raw) >= HEX_ENTROPY_MIN) {
      return true;
    }
  }
  return false;
}

/**
 * gitleaks-derived raw-text secret windows (BUG-003 layer 1; patterns quoted
 * from gitleaks.toml v8.x, each validated against the bug report's probe
 * keys before landing). ALWAYS-ON baked constants — no config surface
 * (PRD §08). Applied to the raw segment BEFORE tokenize, because
 * tokenization splits keys at `/`/`-`/`.` and no token-level rule can see a
 * whole multi-segment key.
 *
 * Each match is replaced by an equal-length run of SPACES: length-preserving
 * (segment geometry and slice boundaries stay stable) and fully inert
 * downstream — spaces terminate tokens, so tokenize() emits nothing from a
 * masked span and phrase windows simply see fewer tokens. Masked bytes can
 * never re-match a later rule; the fixed order only decides which rule
 * claims a window first.
 *
 * Inventory, in claim order:
 *  1. AWS access key IDs — (A3T|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA) +
 *     16 or more
 *  2. GitHub classic PAT — ghp_ + 36 or more
 *  3. GitHub fine-grained PAT — github_pat_ + 36 or more
 *  4. Google API key — AIza + 35 or more
 *
 *  The canonical formats above have EXACT core lengths, but the quantifiers
 *  are open-ended on purpose: a fixed window over a longer run leaves a
 *  masked-out tail residue that could still tokenize into a candidate
 *  (probe-validated: a 40-char ghp_ core leaked its last 4 chars). Rules
 *  are prefix-anchored, so the only cost is over-masking — accepted, per
 *  the bare-run (BARE_RUN_MIN = 32) catch-all rationale below.
 *  5. Slack tokens — xox[baprs]-{10–13}-{10–13} plus hyphenated trailing
 *     segments; the `(?:-[a-zA-Z0-9]+)*` tail is REQUIRED: the 24-char
 *     secret follows a THIRD hyphen, which a plain [a-zA-Z0-9]* trailing
 *     class cannot cross (probe-validated against the BUG-003 key
 *     xoxb-…-…-abcdefghijklmnopqrstuvwx, whose tail leaked under the
 *     original inventory)
 *  6. OpenAI legacy — sk-…T3BlbkFJ… (marker in every legacy key)
 *  7. OpenAI modern — sk-[proj-|svcacct-|admin-]+ ≥32 more chars. The class
 *     includes '_', so a literal "sk-" followed by a ≥32-char word-ish run
 *     masks; accepted — "sk-" is rare in prose and tokenize splits on '-'
 *     anyway (documented gotcha)
 *  8. JWT strict — ey…≥17.ey…≥17.sig≥10 (optionally =-padded)
 *  9. JWT loose three-segment — eyJ… for headers the strict second-`ey`
 *     shape misses; empty third segment allowed so a two-dot fragment masks
 * 10. GitLab PAT — glpat- + ≥ 20 [A-Za-z0-9_-] (Probe C, P1.M2.T2.S3,
 *     BUG-003 PRD h3.2: 'glpat-' tokenizes as 'glpat' + payload, so no
 *     token-level prefix can ever see the key whole — pre-fix 'glpat'
 *     itself and the payload's sub-words were stored/ranked). Placed
 *     BEFORE the bare-run catch-all on purpose: the catch-all would mask
 *     only the ≥32 payload run and leave 'glpat' tokenizing standalone.
 * 11. AWS secret bare run — ANY run of ≥ BARE_RUN_MIN (32) [0-9a-zA-Z/+]
 *     chars, greedy catch-all, LAST (open-ended so over-long runs mask
 *     fully). The floor sits at 32: safely below the 38-char classic AWS
 *     secret access key (the BUG-003 h3.2 leak — its slash-free form
 *     slipped under the old bare-40 floor and its camelCase fragments
 *     reached expandCandidates) and safely above anything prose-shaped
 *     (longest English words ~28–30; URLs break runs on ':'/'.'). Over-
 *     masking is accepted: such runs are never legitimate completion
 *     vocabulary (fixture-vocabulary FP test pins this).
 */
/** Min length of the raw-text bare alnum run the greedy catch-all (rule
 *  10) masks. 32 sits safely BELOW the 38-char classic AWS secret access
 *  key (the BUG-003 h3.2 leak class: at the old floor of 40 the slash-free
 *  form slipped past and its camelCase sub-word fragments survived every
 *  token-level gate) and safely ABOVE anything prose-shaped — the longest
 *  unbroken English words are ~28–30 chars, and URLs break runs on
 *  ':'/'.'/'?' anyway. 32+ pure-hex runs are private-key-shaped by intent
 *  (the token-level pure-hex rule rejects ≥ 20 at the gate; masking here
 *  only prevents candidate generation). Baked per PRD §08 — no config
 *  surface. */
const BARE_RUN_MIN = 32;
/** The catch-all run regex, precompiled ONCE at module scope — a regex
 *  literal cannot embed the constant. String.replace resets /g lastIndex,
 *  so the module-scope singleton preserves the no-shared-mutable-state
 *  and precompiled-regex perf profile. */
const BARE_ALNUM_RUN_RE = new RegExp(
  `[0-9a-zA-Z/+]{${BARE_RUN_MIN},}`,
  "g",
);

const SECRET_WINDOW_RES: readonly RegExp[] = [
  /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16,}/g,
  /ghp_[A-Za-z0-9]{36,}/g,
  /github_pat_[A-Za-z0-9_]{36,}/g,
  /AIza[0-9A-Za-z_-]{35,}/g,
  /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}(?:-[a-zA-Z0-9]+)*/g,
  /sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}/g,
  /sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g,
  /ey[a-zA-Z0-9]{17,}\.ey[a-zA-Z0-9/_-]{17,}\.(?:[a-zA-Z0-9/_-]{10,}={0,2})?/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
  /glpat-[A-Za-z0-9_-]{20,}/g, // 10. GitLab PAT (Probe C, BUG-003 h3.2) — precedes the bare-run catch-all, which would otherwise mask only the ≥32 payload and leave 'glpat' tokenizing
  BARE_ALNUM_RUN_RE, // 11. AWS secret bare run — greedy catch-all, LAST; floor BARE_RUN_MIN = 32 (38-char AWS secret class)
];

/** Literal necessary-condition anchors for SECRET_WINDOW_RES (index-aligned):
 *  for every anchored rule, any match MUST contain the anchor literal — so
 *  when `segment.indexOf(anchor)` misses for all of a rule's anchors the
 *  regex pass is provably a no-op and is skipped. This is a pure fast path
 *  (same maskings, same claim order); rules with no usable literal (the
 *  bare alnum catch-all, BARE_RUN_MIN = 32, index 10) always run. Anchors are
 *  case-sensitive exactly like the regexes themselves. Without the
 *  prefilter, ten full-string regex scans per segment dominated the ingest
 *  profile (2026-09 Issue 4: ~15 ms of an ~175 ms 800 KB ingest); with it,
 *  secret-free segments — the overwhelming majority — pay one memchr-speed
 *  indexOf per anchor.
 */
const SECRET_WINDOW_ANCHORS: readonly (readonly string[])[] = [
  // 1. AWS access key IDs — every alternative prefix, any one suffices
  ["A3T", "AKIA", "AGPA", "AIDA", "AROA", "AIPA", "ANPA", "ANVA", "ASIA"],
  ["ghp_"], // 2. GitHub classic PAT
  ["github_pat_"], // 3. GitHub fine-grained PAT
  ["AIza"], // 4. Google API key
  ["xox"], // 5. Slack tokens
  ["T3BlbkFJ"], // 6. OpenAI legacy (the invariant marker mid-pattern)
  ["sk-"], // 7. OpenAI modern
  ["ey"], // 8. JWT strict (weak anchor — still memchr-cheap)
  ["eyJ"], // 9. JWT loose three-segment
  ["glpat-"], // 10. GitLab PAT (Probe C, BUG-003 h3.2)
  [], // 11. AWS secret bare run — no literal anchor: always runs
];

/**
 * Blank structured secret windows in one raw segment (BUG-003 layer 1).
 *
 * Runs the fixed SECRET_WINDOW_RES inventory in order over the segment,
 * replacing every match with same-length spaces (see the inventory JSDoc
 * for the rule list, the always-on status, and the masking semantics).
 * The result feeds tokenize() unchanged otherwise; ordinary prose, URLs,
 * and short identifiers pass through byte-identical.
 *
 * Each anchored rule first probes its literal anchors (see
 * SECRET_WINDOW_ANCHORS) and is skipped when none is present — the regex
 * could never match, so the output is byte-identical to the unfiltered
 * scan (pinned by the full mask-secrets suite).
 *
 * Pure: one replace() per rule over precompiled module-scope regexes
 * (String.replace resets /g lastIndex — no shared mutable state), no
 * per-character scanning. Wired at IngestPipeline.#admitSegment — the
 * single funnel for live messages and restore replay. Consumed by
 * P1.M2.T2.S1 (token-level residue layer) and P1.M5.T1.S2 (e2e probes).
 */
export function maskSecrets(segment: string): string {
  for (let i = 0; i < SECRET_WINDOW_RES.length; i++) {
    const anchors = SECRET_WINDOW_ANCHORS[i]!;
    let present = anchors.length === 0; // unanchored rules always run
    for (let a = 0; a < anchors.length && !present; a++) {
      if (segment.indexOf(anchors[a]!) !== -1) present = true;
    }
    if (!present) continue;
    segment = segment.replace(SECRET_WINDOW_RES[i]!, (m) => " ".repeat(m.length));
  }
  return segment;
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