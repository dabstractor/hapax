# 04 — Tokenization and Scoring

Two independent scores, deliberately conflated nowhere:

- **Global commonness** — static, from the dictionary. Drives **admission**.
- **Session salience** — dynamic, from store stats. Drives **ranking**.

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
- Capitalized-initial words (first char uppercase at extraction) set a
  `properName` hint (feeds salience, below).

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

Let `q = dictionary.lookup(lowercase)` (null when absent). Whole-token
candidates admit when:

| Condition | Result |
|---|---|
| `q !== null && q >= 220` | **Reject** — very common word (`the`, `context`) |
| `q !== null && 120 <= q < 220` | **Admit, rank group 2** — mid-frequency (`tokenizer`) |
| `q !== null && q < 120` | **Admit, rank group 1** — rare-but-attested |
| `q === null` (absent) | **Admit, rank group 0** — rare-by-default (post shape gate) |

Sub-word candidates require their own admission (same table) but never rank
above rank group +1 of their parent whole token.

Constants 220/120 are the only tuning surface; see 09 for the tuning protocol.

## Salience formula (ranking)

Computed at query time from store stats. For candidate `c`:

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

## Query ranking (final order)

1. Salience descending.
2. Ties → shorter candidate first.
3. Ties → lexicographic (byte order on lowercase key).

Return top **8** items (menu height). Under the trigger char, same rules.

## Case handling

- Matching is **case-insensitive**: typed `nrel` matches `NREL`.
- Insertion uses the candidate's display casing (`NREL`).
- The store keys on lowercase; one candidate per lowercase key (casing
  variants merge, display casing = most recent).