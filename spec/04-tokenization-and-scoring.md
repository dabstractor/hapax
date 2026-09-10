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
5. **Dotted filename-shaped tokens stay whole (2026-09 rule).** A word
   run with one or more dotted alphanumeric parts whose FINAL part is
   1–5 letters is ONE token: `AGENTS.md`, `package.json`, `file.tar.gz`.
   The `.` is not a word boundary here — filenames are completion
   targets as typed ("agent" should offer `AGENTS.md`, not the bare
   `AGENTS`). Base/hexish tokens inside the span are absorbed. Version
   numbers (`v1.2.3` — final part numeric) and decimals (`3.14`) do not
   match and keep the base-pass split.

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
- **properName hint (2026-09 structural-start rule, extended after a
  live audit of real session history):** a Capitalized token sets the
  `properName` hint ONLY when its capital is not orthographic — i.e.
  the token is NOT at a **structural start**: (a) the first word of
  its line (this covers message starts — the audit showed
  "Project"-class clutter entering precisely there), (b) preceded by
  a bullet/heading/list marker run (`- ` `* ` `## ` `1. `), or (c)
  preceded — after whitespace and closing quotes/brackets — by
  sentence or clause punctuation (`.` `!` `?` `;` `:`). Mid-sentence
  "then Check the logs" keeps the hint; "Done. Check", "- Check",
  "## Check", "Note: Check", and message-initial "Check" do not.
  Applies to the whole token and its FIRST sub-word. Detection is a
  bounded walk-back (a fixed window per token; an unbounded scan made
  ingest quadratic and failed the 800 KB perf gate). Downstream:
  unhinted capitals lose the proper-noun relief and the conjugation
  guard's casing exemption. AUDIT FINDING (2026-09, real history
  replay): across ~2k messages this removes the systematic
  sentence-initial harvesting, but ~480 common words still admit via
  relief from occasional MID-SENTENCE capitalized sightings — a mix
  of legitimate names (Windows, Intel) and noise (echo, reject,
  device). The proposed next lever — relief requires the word to have
  no lowercase sightings in-session — is an OPEN DESIGN ITEM
  (docs/HANDOFF.md): it would also filter words like `national` that
  appear both ways.

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
reject band — **default 12** (2026-09 retighten; owner rule), 
runtime-tunable via the `rejectCommonness` config (see 08). The design
premise (2026-09): **dictionary attestation is near-disqualifying
evidence.** hapax exists to complete identifiers, commit-hash-shaped
tokens, and jargon — the dictionary-ABSENT class — not ordinary English.

| Condition | Result |
|---|---|
| `q !== null && q >= R` (12) | **Reject** — attested English (`the`, `context`, `code`, `provider`, `null`) |
| `q !== null && q < R` (12) | **Admit, rank group 1** — the rarest English tail only (roughly the rarest ~10% of the corpus: `handoff`, `workspace`) |
| `q === null` (absent) | **Admit, rank group 0** — rare-by-default (post shape gate): THE value class |

**Table group 2 is retired:** with `R = 12` nothing attests into the old
`[20, 50)` mid band — that band was the live-audit noise leak (1,183
everyday words: `provider`, `default`, `null`, `node`, `enable`, `spec`,
`cache`, against 4,889 absent identifiers). The `RankGroup` type keeps
group 2 for compatibility (subword clamp and salience still reference
it); it is unreachable via the table and via relief.

The bands are baked constants calibrated against the shipped artifact
with `tools/calibrate-bands.mjs`, which doubles as a word probe:
`node tools/calibrate-bands.mjs lists deleted` prints a word's `q` and
its verdict (lowercase and capitalized). Calibration history: 220
(BUG-001, mathematically unreachable) → 100 → 50 (Issue-1) → **12
(final)**.

**Proper-noun relief — RETIRED-IN-PLACE.** The relief mechanism (a
capitalized whole token whose table result is reject admits at group 2)
remains in code but its ceiling is set equal to the reject band, so it
can no longer admit anything. History: it existed so M2's "National
Renewable Energy Laboratory" (q 57–94) could chain; a live audit showed
it admitting ~483 capitalized common words (`echo`, `windows`,
`failed`, `file`). The owner retired it ("not half of the english
language"); restoring named-entity completion is a user-allowlist design
question (docs/HANDOFF.md), not a band change.

**Conjugation guard.** An inflection whose STEM is a common word rejects
too, whatever its own `q`. The dictionary ranks inflections separately
(`delete` q=51 rejects; `deleted` q=45 would admit; absent `deletes`
would admit as "rarest"), which leaked everyday verbs, adverbs, and
plurals into the menu. Stems are one-level strips of `-s -es -ed -d
-ing -ly`, with e-restoration (`typing`→`type`, `caching`→`cache`) and
doubled-consonant undo (`stopped`→`stop`). Two tiers:

- stem `q >= R` (12) → reject (any `q` of the word itself);
- word absent AND stem `q >= 20` (MID) → reject (absent inflections of
  attested stems: `uploads` → `upload` q=38).

With R=12 the second tier is largely subsumed by the first (any stem
q ≥ 12 already rejects); it stays for words whose stem sits in
[12, 20). Capitalized (properName) candidates skip the guard — casing
evidence outranks morphology (a relief-restoring change would need this
intact). Derivational suffixes (`-tion`, `-ment`, `-er`) are
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

**Plural pruning (2026-09 owner rule):** when a result set contains
both a key and that key + `"s"` (exact single-`s` pair: `plugin` /
`plugins`), the plural is dropped — the pair is redundant menu noise
and the singular is the completion target. Guards: the pair must be
in the SAME result set (a plural whose singular is absent — filtered
by the limit, not a prefix match, or evicted — stays); `ss`-final
keys never prune (`glass`/`glas`); `es`/`ies` plurals are different
keys entirely (`class`/`classes` is out of scope); filename-shaped
keys are untouched (`agents` vs `agents.md` is not a pair). Pruning
runs BEFORE the limit slice, so a pruned plural never consumes a
slot. The store itself is never pruned — this is a query-time menu
rule only (the conjugation guard in admission handles common stems;
this covers dictionary-absent jargon pairs that both stored
legitimately).

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