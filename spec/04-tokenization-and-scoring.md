# 04 — Tokenization and Scoring

Two independent scores, deliberately conflated nowhere:

- **Global commonness** — static, from the dictionary. Drives **admission**
  (plus the conjugation guard below).
- **Session salience** — dynamic, from store stats. Drives **eviction**
  (06); it never orders the menu.

## Segmentation (`src/core/segment.ts`)

### What counts as a word

Run a single regex pass over input text:

```
/[A-Za-z][A-Za-z0-9_]{0,63}/g          → identifiers/words
plus a second scan for hexish tokens:
/(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g  → letter-containing hex
```

Rules:

1. **Base tokens:** `[A-Za-z][A-Za-z0-9_]*`, length 2–64. (Admission later
   requires ≥ 4.)
2. **Hexish tokens:** 6–40 hex chars containing at least one letter `[a-f]`.
   These are commit-hash-shaped and deliberately captured; the shape gate
   decides their fate (long ones rejected as noise, see below).
3. **Skip CJK and all non-ASCII runs — and never resume mid-word.** A word
   candidate must be a run of `[A-Za-z0-9_]` bounded on BOTH sides by
   non-letter characters (any Unicode letter counts as a letter). A
   non-ASCII letter adjacent to an ASCII run disqualifies the whole run:
   `Þórhildur` yields NOTHING (not `rhildur`), `ΩbsidianMirror` yields
   NOTHING (not `bsidianMirror`). Never slice a non-ASCII letter out of a
   word and complete the ASCII remainder. CJK word segmentation remains a
   documented non-goal.
4. **Punctuation/whitespace terminate tokens.** No hyphen or apostrophe joins
   (`state-of-the-art` segments into three words; multi-word terms are M2
   successor-index territory — chained one word at a time, never a single
   multi-word insertion).

### camelCase / snake_case splitting

Each base token yields **the whole token plus its sub-words**, all as separate
candidates:

- Split on `_` segments.
- Split camelCase boundaries: lowercase→uppercase (`fixR` → `fix|R`), and
  acronym-lowercase (`HTTPServer` → `HTTP|Server`).
- Sub-words shorter than 4 are dropped as standalone candidates (still counted
  for the whole token).

The whole token is what users usually Tab; sub-words enable mid-identifier
completion (`roun` → `Rounding` from `fixRoundingError`).

### Normalization

- Lookup keys and store keys are **lowercase**.
- Each candidate remembers its **display casing**: the most recently seen
  casing variant (recency wins; "how it was last used is how you want it").
- **properName hint (2026-09 sentence-initial rule):** a Capitalized
  token sets the `properName` hint ONLY when its capital is not
  orthographic — i.e. NOT immediately preceded (skipping whitespace)
  by sentence-ending punctuation (`.` `!` `?`, optionally wrapped in
  closing quotes/brackets `)]}"'’”»`). "Done. Check the logs" yields
  `check` WITHOUT the hint; mid-sentence "then Check the logs" yields
  it WITH the hint. The rule applies to the whole token and its FIRST
  sub-word ("…period. DownloadManager" → `download` unhinted,
  `manager` keeps its camelCase hint). Text/message starts do NOT
  count as sentence starts (no preceding punctuation — a capital there
  is still evidence, e.g. "Rain washes…" at a message start keeps the
  hint). Downstream: unhinted capitals lose the proper-noun relief and
  the conjugation guard's casing exemption — sentence-initial
  "Deleted" rejects like lowercase `deleted`.

## Shape gate (`src/core/shapeGate.ts`)

Applied to **every** segmented candidate before dictionary lookup. Rejects:

1. **Too short/long:** whole-token candidates must be 4–64 chars; sub-words
   4–32.
2. **Low entropy:** character-entropy < 1.5 bits/char (kills `aaaaa`,
   `aaaaaaaargh`-ish repetition), or unigram-run of any single char ≥ 4.
3. **Secret-shaped strings** (always reject, not configurable):
   - matches known key prefixes: `sk-`, `sk_`, `ghp_`, `gho_`, `github_pat_`,
     `xox[bpars]-`, `AKIA`, `AIza`, `eyJ` (JWT bodies);
   - digit+symbol character ratio > 0.4 for length ≥ 16;
   - base64-shaped run ≥ 24 chars with mixed case+digits+`+/`;
   - pure-hex length ≥ 20 (private-key-shaped);
   - contains `@` plus a dot (emails are segmented out anyway; belt and braces).
4. **Pure noise:** consonant run ≥ 6 with no vowel and no digits.

Hexish tokens 6–12 chars (commit-hash-like) **pass** the gate — they are
legitimate completion targets in dev sessions. Hexish ≥ 20 rejected by rule 3.

The gate is the load-bearing filter for dictionary-absent words; everything
absent from the table enters here or not at all.

## Admission decision (`src/core/score.ts`)

Let `q = dictionary.lookup(lowercase)` (null when absent), and `R` be the
reject band — default 50, runtime-tunable via the `rejectCommonness`
config (see 08). Whole-token candidates admit when:

| Condition | Result |
|---|---|
| `q !== null && q >= R` | **Reject** — very common word (`the`, `context`, `code`) |
| `q !== null && 20 <= q < R` | **Admit, rank group 2** — mid-frequency |
| `q !== null && q < 20` | **Admit, rank group 1** — rare-but-attested |
| `q === null` (absent) | **Admit, rank group 0** — rare-by-default (post shape gate) |

The bands (reject 50, mid 20) are baked constants calibrated against the
shipped artifact with `tools/calibrate-bands.mjs`, which doubles as a
word probe: `node tools/calibrate-bands.mjs lists deleted` prints a
word's `q` and its verdict (lowercase and capitalized).

**Proper-noun relief.** A capitalized whole token (properName hint) whose
table result is reject admits at group 2 when `q < 95`: sentence-case
names (`National`, `Laboratory`, `Andrews`) complete while lowercase
everyday prose (`context`, `data`) stays rejected. The ceiling 95 is
calibrated so ordinary capitalized words (`Guard`, `Books`, `Water`)
still reject.

**Conjugation guard.** An inflection whose STEM is a common word rejects
too, whatever its own `q`. The dictionary ranks inflections separately
(`delete` q=51 rejects; `deleted` q=45 would admit; absent `deletes`
would admit as "rarest"), which leaked everyday verbs, adverbs, and
plurals into the menu. Stems are one-level strips of `-s -es -ed -d
-ing -ly`, with e-restoration (`typing`→`type`, `caching`→`cache`) and
doubled-consonant undo (`stopped`→`stop`). Two tiers:

- stem `q >= R` → reject (any `q` of the word itself);
- word absent AND stem `q >= 20` → reject (absent inflections of
  attested mid-band stems: `uploads` → `upload` q=38).

Capitalized (properName) candidates skip the guard — casing evidence
outranks morphology, so relief-admitted names are never stem-rejected.
hapax targets proper nouns and identifiers, not verb/adverb/plural
morphology. Derivational suffixes (`-tion`, `-ment`, `-er`) are
deliberately NOT stripped: `deletion` is a distinct lexeme.

Sub-word candidates require their own admission (same table, plus the
guard) but never rank above rank group +1 of their parent whole token.

## Salience formula (eviction)

Computed at query time from store stats; consumed only by the eviction
score (06). For candidate `c`:

```
salience(c) =
    2.0 * log2(1 + sessionCount)          // in-session frequency
  + 3.0 * exp(-(msgsSinceLastSeen) / 20)  // recency decay, τ = 20 messages
  + 1.5 * userTypedBonus                  // 1.0 if ever typed by user, else 0
  + 0.8 * properNameHint                  // 1.0 if capitalized-initial, else 0
  + 1.0 * rarityBonus                     // group 0: 1.0, group 1: 0.5, else 0
```

- `sessionCount`: occurrences this session (each upsert increments; a word
  appearing in both a user message and the assistant reply counts twice).
- `msgsSinceLastSeen`: message ordinal delta (store tracks a per-session
  monotonic message counter, not wall-clock — sessions can idle for hours).
- `userTypedBonus`: set once, forever sticky for the session.
- Weights are baked constants. **Not configurable.** Tuning happens in the
  codebase via 09's protocol, not at user runtime.

## Query ranking (final menu order)

Menu order is **content-derived and stable** — deliberately independent of
salience and of everything that changes during a session:

1. Shorter candidate key first.
2. Ties → lexicographic (byte order on the lowercase key).

Rationale: a menu whose order depends on recency or frequency reshuffles
between keystrokes and between sessions, defeating the muscle memory
completion exists to build. The same fragment must always yield the same
list (editor/shell convention). Salience decides membership — admission
and eviction — never menu position.

Return top **8** items (menu height; `maxSuggestions` config, 1–20). Under
the trigger char, same rules.

## Case handling

- Matching is **case-insensitive**: typed `nrel` matches `NREL`.
- Insertion uses the candidate's display casing (`NREL`).
- The store keys on lowercase; one candidate per lowercase key (casing
  variants merge, display casing = most recent).