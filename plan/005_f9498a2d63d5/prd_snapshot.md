# hapax — Context-Driven Autocomplete Extension

**Status:** Draft v1.0 · **Name:** `hapax`

## Purpose

A pi extension named **hapax** (from *hapax legomenon*, a word that occurs
only once in a corpus — exactly what it harvests) that watches user prompts and final agent output as they enter the
context window, extracts uncommon words / identifiers / proper names, and offers
them as tab-completions in the prompt input box — reusing pi's built-in
autocomplete menu via `ctx.ui.addAutocompleteProvider()`.

## Spec maintenance policy (binding)

This spec is the **single source of truth** for hapax's requirements and
behavior. Nothing else — JSDoc, README, plan artifacts — overrides it.

- **Interactive sessions MUST update the spec.** When the owner requests
  a behavior change in an interactive session, updating the spec is a
  mandatory part of the change, not an optional follow-up. Without this
  rule the spec could never change: the owner defines requirements only
  here. A change that ships code without the matching spec edit is
  incomplete. Either ORDER is fine — spec-first then implement, or
  implement then sync the spec — so long as the two land in agreement:
  the spec must match what's in the code.
- **Implementation pipeline agents MUST NOT touch the spec.** Agents
  executing plan/ PRPs (P1.M3-style staged tasks) treat `spec/*.md` as
  read-only inputs; they record drift in code comments and reports, and
  an interactive session later reconciles the spec. The
  "do not edit; document changes in JSDoc" instructions inside plan/
  artifacts apply to those pipeline runs only.
- `plan/` directories are historical run artifacts — never edited, never
  authoritative.

## Design invariants (non-negotiable)

1. **Never hijack typing.** No key is ever captured, consumed, or altered except
   Tab while a suggestion is selected — plus, on the one-line widget display
   (M3), the arrow keys and Escape once the result line has been ENTERED; on
   an un-entered line ↑/← on the first word dismiss the line AND forward the
   press (the caret moves — one press, plain-pi parity). The user's typing
   experience is otherwise unchanged; the result line is strictly
   take-it-or-leave.
2. **Tab is never delayed by UI — and Tab only ever completes.** The top
   suggestion is computed synchronously on every keystroke; the popup may be
   debounced, but a single Tab keypress always resolves the current top or
   selected item immediately. Tab never opens, toggles, or summons the
   menu; the menu opens automatically on the 1st char of a matching word
   (when candidates exist), on the 1st char after the trigger char, or at
   the zero-char chain offer. Enter always submits — never accepts a
   completion (see 07).
3. **The popup never flickers and never appears with zero candidates.**
4. **Everything stays in RAM.** No persistence, no telemetry, no network. The
   candidate store is per-session and dies at `session_shutdown`.

## Document index

# 01 — Goals and Scope

## Problem

LLM sessions accumulate project-specific vocabulary — identifiers, API names,
proper names, technical terms — that the user must retype into the prompt box.
Standard autocomplete cannot suggest these because it only knows files and
commands.

hapax watches what enters the context window, extracts the rare and
useful words, and completes them from the 1st typed character of a
matching word (or the 1st character after the trigger char, default `#`).

## Core definitions

- **Candidate** — a word admitted to the session store, available for completion.
- **Admission** — the decision that a segmented word is worth storing (global
  commonness + shape gates).
- **Salience** — the dynamic per-session retention score (frequency,
  recency, source, rarity). Drives store eviction; its frequency
  component (sessionCount) breaks ranking ties within match-strictness
  tiers (04).
- **Trigger char** — a configurable character (default `#`) that initiates
  lookup from the first character after it.
- **Word matching** — anchored fuzzy lookup from the first character
  of a word (first char exact, then a threshold-gated fuzzy
  subsequence — 04), firing everywhere the user types. (The
  `threshold` config value, 1–3, is retained for schema compatibility
  but inert — see 07.)

## Goals (M1)

1. Extract uncommon words from user prompts and final assistant output.
2. Admit them via a static common-words dictionary + shape gates.
3. Order the menu content-derived (shortest match first, then
   lexicographic — stable and predictable); salience governs retention
   and eviction only. (Ordering superseded 2026-10 by M3 goal 9;
   admission/eviction split unchanged.)
4. Complete them through pi's built-in autocomplete menu with zero typing
   interference. (Superseded as PRIMARY display 2026-10 by M3 goal 10;
   retained as the fallback path.)
5. Total memory < 6 MB steady state; query latency < 1 ms; ingest of a
   300k-token session < 100 ms in background.

## Goals (M2)

6. One word per completion, always — no multi-word candidates, ever. The
   only phrase behavior is successor chaining (goal 7).
7. Chained completion: accepting a word arms its most-likely successor for
   zero-additional-typing Tab completion.

## Goals (M3)

8. Anchored-fuzzy matching after the first typed character,
   threshold-gated (`fuzzThreshold`, 08) so a large store never floods
   the results (04).
9. Conversation-frequency tie-breaking within equal match-strictness
   tiers — sessionCount descending inside a tier (04).
10. One-line horizontal result display: words joined `" | "`, no
    frequency column, hapax-rendered widget with arrow selection and
    one-press boundary pass-through on un-entered lists (07); the
    vertical stock menu retained as fallback.

## Non-goals (explicit)

- No ingestion of tool-call results, file reads, thinking tokens, or any
  content the agent did not explicitly present to the user (plus user prompts).
- No persistence across sessions; no per-project caches.
- No learned/ML scorer (hand-tuned constants only; revisit post-M2 with real
  usage experience).
- No semantic/embedding-based matching.
- No CJK word segmentation (CJK runs skipped; see limitations).
- No modification of messages, context, or anything sent to providers.

## Known limitations (accepted)

- **English-only dictionary.** Non-English common words are absent from the
  table and therefore over-admitted as "rare." This degrades memory efficiency,
  not correctness — session salience still ranks them usefully, and the most
  valuable completions (identifiers, API names) are English-shaped regardless
  of user language. Per-language tables are a drop-in later via dictionary
  format versioning.
- **Absence conflates "rare real word" with "random string."** Shape gates
  filter the worst noise; salience handles the ordering. A rare real word that
  never recurs in-session was never a useful completion.
- **Tab may insert a top item the debounced popup hasn't painted yet.** The
  computation is deterministic and correct; treated as cosmetic. Revisit only
  if observed in practice (see 07, "Tab-before-paint").
- **Arrow capture while the result line shows.** The arrow cluster is
  captured only once the list has been ENTERED (an arrow that moved
  the highlight); before that, boundary arrows pass through to the
  editor with the caret moving on the same press (plain-pi parity),
  and after entry both edges carousel end-to-end, per generation
  (07). Owner-accepted trade-off, 2026-10; one-press + interaction
  rules 2026-10.

## UX principles

- The user's typing experience is identical with or without the extension,
  except that Tab occasionally does something useful and, while the
  result line is visible, the arrow keys navigate it (boundary
  pass-through returns the keys instantly, one press, until the
  list has been entered — then Escape is the exit; 07).
- The result line is a suggestion surface, never a modal. The arrow
  cluster is consumed only after the list is entered — boundary
  pass-through returns control instantly, one press (07); never any
  typing key.
- Suggestions that would embarrass (secrets, garbage tokens) must never appear;
  the shape gate is load-bearing for the absent-from-dictionary class.
# 02 — Architecture

## Components

```
┌─────────────────────────────────────────────────────────────┐
│ pi extension (ESM, TypeScript)                               │
│                                                              │
│  message_end events ──► Ingestion Pipeline                   │
│                          │  (debounced, chunk-yielded)       │
│                          ▼                                   │
│                        Segmenter ──► Shape Gate              │
│                          │            │                      │
│                          ▼            ▼                      │
│                     Dictionary    Candidate Store             │
│                     (packed,      (per-session, mutable)     │
│                      frozen,            ▲                    │
│                      ~1–2 MB)           │                    │
│                                       │ │                    │
│  keystrokes ──► Autocomplete Provider ─┘ │ (M2: successor    │
│                 (via addAutocomplete-    │  index)           │
│                  Provider, debounced     │                   │
│                  popup)                  │                   │
└─────────────────────────────────────────│───────────────────┘
                                          │
                            pi built-in path/slash completion
                            (delegated via `current`)
```

## Module layout

Two-layer split: `src/core/` is **pure, agent-agnostic computation** (no
pi imports allowed — enforced by review; unit tests run against it standalone)
and `src/pi/` is the extension wiring. This split is load-bearing for a
future iteration (see "Portability note" at the end of this document).

```
hapax/
├── package.json              # pi extension manifest
├── dict/
│   └── common-en.bin         # packed dictionary (build artifact, shipped)
├── tools/
│   └── build-dict.mjs        # offline dictionary build script
├── src/
│   ├── core/                 # pure, agent-agnostic — no pi imports
│   │   ├── dictionary.ts     # packed-binary loader + lookup
│   │   ├── segment.ts        # word segmentation + normalization
│   │   ├── shapeGate.ts      # shape/entropy/secret rejection
│   │   ├── score.ts          # admission decision + salience formula
│   │   ├── store.ts          # candidate store, eviction, (M2: successor index)
│   │   ├── query.ts          # anchored fuzzy match, tier + frequency
│   │   │                     #   ranking (pure store queries)
│   │   └── types.ts          # shared core types
│   └── pi/                   # pi extension adapter
│       ├── index.ts          # extension factory, event wiring
│       ├── ingest.ts         # message_end handling, debounce, chunking,
│       │                     #   session-history restore replay
│       ├── provider.ts       # autocomplete provider — FALLBACK display
│       │                     #   path (trigger regexes, debounce,
│       │                     #   hysteresis, chaining M2)
│       ├── widget.ts         # one-line result widget — PRIMARY display
│       │                     #   path: rendering, key handling,
│       │                     #   visibility state machine (M3, 07)
│       ├── editor.ts         # enter-submits-while-autocompleting guard
│       │                     #   (07: Enter accepts the menu instead)
│       ├── debug.ts          # /acwords read-only store+stats dump
│       │                     #   (08 h2.48; registered when config.debug)
│       ├── paths.ts          # jiti-safe dictionary path resolution
│       └── config.ts         # config load/merge with defaults
└── test/
    ├── segment.test.ts
    ├── shapeGate.test.ts
    ├── score.test.ts
    ├── store.test.ts
    ├── dictionary.test.ts
    ├── query.test.ts
    ├── provider.test.ts       # fallback-path provider tests (mock ctx.ui)
    └── widget.test.ts         # one-line widget tests (M3: keys, visibility)
```

`package.json` (pi auto-discovers `.pi/extensions/*/index.ts` or
`~/.pi/agent/extensions/*/index.ts`; use the subdirectory package layout):

```json
{
  "name": "hapax",
  "version": "0.1.0",
  "type": "module",
  "pi": { "extensions": ["./src/pi/index.ts"] }
}
```

No npm dependencies required for M1 (dictionary loader is hand-rolled;
build script uses only node stdlib). Do not add dependencies.

## Data flow

### Ingest path (background, never on keystroke path)

1. `message_end` fires with the finalized message (see 05 for event contract).
2. If role is `user` or `assistant` and content yields text: schedule ingest
   (300 ms debounce; only latest message per debounce window is processed —
   intermediate ones queue).
3. Segmentation → per-word shape gate → dictionary lookup → admission decision
   → store upsert (count, lastSeen, source weights).
4. Chunked: yield to the event loop every ≤64 KB of processed text.

### Query path (synchronous, every keystroke)

1. Provider's `getSuggestions` receives editor lines + cursor.
2. Extract the current word fragment before the cursor (or trigger-char run).
3. If a word fragment is live (1 char; see 07) or the trigger char is
   active: anchored-fuzzy search the store (first-char bucket, 04),
   sort tier → sessionCount → length → lex (04), return top 8 items.
4. This must complete in < 1 ms. No allocation-heavy work; the store's
   prefix index is maintained at ingest time — the fuzzy anchor (first
   char exact) keeps it the scan entry point.

### Display path (widget primary; menu fallback)

- Primary: the one-line widget renders the result set synchronously;
  the 100 ms display debounce, flicker hysteresis, and the visibility
  state machine live in the widget layer (07). Fallback: the provider
  returns items and pi renders the vertical menu. Tab completion reads
  the synchronous result directly on either path and is never gated by
  the debounce.

## Extension lifecycle wiring

- `session_start { reason }`: lazily load dictionary (first use), rebuild store
  by replaying session history oldest→newest in background (reason `"resume"`
  or `"startup"` with existing history).
- `message_end`: schedule ingestion.
- `session_shutdown`: drop store and dictionary references; nothing to flush
  (no persistence).
- The factory itself must not start background resources; everything is
  deferred to `session_start` per pi extension rules.

## Portability note (future iteration, out of M1/M2 scope)

The `core/` layer is intentionally free of pi dependencies so that other
agents can reuse it. Verified ecosystem survey (2026-09): message harvesting
is available on every major agent (hooks or on-disk transcripts), but
input-box completion injection is rare. The one credible second target is
**Claude Code**, whose `fileSuggestion` setting offers a pipe-a-query /
print-lines contract for `@`-triggered suggestions — enough for a
trigger-char-only degraded mode (harvest via its `UserPromptSubmit` /
`MessageDisplay` hooks). Do not design for it now; keeping `core/` pure is
the entire obligation this note creates.

## Performance budgets (hard requirements)

| Operation | Budget |
|---|---|
| Single keystroke query (anchored fuzzy + tier/count sort + top 8) | < 1 ms |
| Dictionary load (parse packed file) | < 50 ms cold, < 5 ms warm |
| Ingest of one message (typical 1–10 KB) | < 5 ms |
| Full 300k-token session restore | < 100 ms total, chunked |
| Steady-state memory (dict + store) | < 6 MB |
| Ingest chunk yield granularity | ≤ 64 KB text per event-loop turn |
# 03 — Dictionary Format and Build

## Purpose

The dictionary answers one question: **is this word common?** It maps lowercase
words to an 8-bit quantized frequency. Presence = commonness evidence.
Absence = rare-by-default (subject to the shape gate, see 04).

The table is **not** a stoplist: mid-frequency words are admitted at low
priority. It is the "known-common" orientation — rarity is the default, and we
only certify commonness.

## Packed binary format (`dict/common-en.bin`)

All integers little-endian.

```
Offset  Size        Field
0       4           magic: ASCII "HAPX"
4       2           version: u16 = 1
6       2           flags: u16 (bit 0 = keys are lowercase; set)
8       4           entryCount: u32
12      4           blobLen: u32  (total bytes of wordBlob)
16      4           bucketCount: u32 (power of two, >= entryCount * 1.3)
20      4           seed: u32 (hash seed, currently 0)
24      blobLen     wordBlob: concatenated UTF-8 lowercase words, no separators
24+blobLen          offsets: u32[entryCount + 1]
                    entry i spans wordBlob[offsets[i], offsets[i+1])
                    offsets are relative to wordBlob start; NUL-free words
+entryCount+1 u32   scores: u8[entryCount]
                    quantized frequency: 255 = most common, 0 = least
                    common word that made the cutoff
+entryCount u8      buckets: u32[bucketCount]
                    value = entry index + 1; 0 = empty slot
```

Expected size at the shipped scale — 48,802 entries (50k-word vendored
unigram corpus; an earlier 70k figure predated corpus selection), avg
7 bytes/word: ~342 KB blob + ~195 KB offsets + ~48 KB scores + 256 KB
buckets (65,536 = next pow2 ≥ 1.3 × 48,802) ≈ **0.85 MB** — the shipped
`dict/common-en.bin` is 850,554 bytes.

## Hash and probing

- Hash: **FNV-1a 32-bit** over the word's UTF-8 bytes, XOR-folded with `seed`.
- Bucket index: `hash & (bucketCount - 1)`.
- Probing: linear. On collision, compare `memcmp(word, blob+offsets[idx], len)`
  plus exact length match. Insert until empty bucket (table is pre-sized, no
  runtime inserts).
- Lookup is one hash plus a small constant number of probes on average
  (linear probing at the load factor the 1.3N sizing rule yields; an
  earlier "load factor ≤ 0.55 / ~1.1 probes" belonged to a nominal
  70k-table sketch and was inconsistent with that rule): ~100 ns
  (bench-gated). Shipped artifact: 48,802 / 65,536 buckets = LF 0.745.

## Loader contract (`src/core/dictionary.ts`)

```ts
export interface Dictionary {
  /** Returns quantized frequency 0–255, or `null` when absent. */
  lookup(word: string): number | null;
  readonly version: number;
  readonly entryCount: number;
}

export function loadDictionary(path: string): Dictionary;
```

- Parse: read file once (`fs.readFileSync`), validate magic/version, create
  `Uint8Array`/`Uint32Array` views over the buffer (no per-entry allocation).
  `Buffer` retained as the single backing allocation; dictionary total heap
  footprint = file size.
- `lookup()` must not allocate: encode candidate word to a reused scratch
  buffer (words are ≤ 64 bytes; reject longer before lookup).
- Invalid magic/version: throw at load; the extension surfaces a notify and
  disables itself rather than running with a bad table.

## Build pipeline (`tools/build-dict.mjs`)

Inputs: one or more TSV files `word<TAB>count` (frequency lists derived from a
large mixed web + code corpus; e.g. unigram lists in the style of
Google Books / wordfreq data cross-checked against an LLM tokenizer vocab such
as o200k/cl100k so that tokenization-frequency informs the ranking). The build
script is corpus-agnostic: it consumes TSVs; corpus preparation is out of scope
for this repo.

Steps:

1. Merge TSVs, summing counts per lowercase key.
2. Filter keys matching `^[a-z][a-z0-9_-]{1,31}$`; drop pure digits.
3. Sort by count descending; keep top `N = 70_000`.
4. Quantize frequency to 8 bits by rank:
   `quant = 255 - floor(254 * log2(1 + rank) / log2(1 + N))`
   (rank 0 → 255; rank N-1 → 1; monotonic, log-scaled so mid-frequency words
   spread across the useful range).
5. Sort entries lexicographically for cache-friendly blob locality.
6. Emit the packed file per the format above; choose `bucketCount` = next
   power of two ≥ 1.3 × N; build buckets via FNV-1a insertion.
7. Print a size summary and verify: load the output file, re-look up every
   entry, assert `lookup(w) === quant`, assert no duplicate keys.

CLI: `node tools/build-dict.mjs --out dict/common-en.bin input1.tsv [input2.tsv ...]`

## Versioning contract

- Dictionary version lives in the file header. The extension requires the
  version it was built for (exact match in M1).
- Because candidate scores embed quantized frequency, any future dictionary
  regen with different quantization bumps `version`; the extension refuses
  mismatched files. Per-language tables (future) ship as separate files
  (`common-de.bin`, …) selected by config; format unchanged.
# 04 — Tokenization and Scoring

Two independent scores, deliberately conflated nowhere:

- **Global commonness** — static, from the dictionary. Drives **admission**
  (plus the conjugation guard below).
- **Session salience** — dynamic, from store stats. Drives **eviction**
  (06). Its frequency component (`sessionCount`) now ALSO breaks ranking
  ties within match-strictness tiers (2026-10 owner rule — see Query
  matching / Query ranking below); the salience score itself still never
  orders anything.

## Segmentation (`src/core/segment.ts`)

### What counts as a word

Regex passes over input text (base + hexish, then the compound/literal
sweep of rules 4a–4c below):

```
/[A-Za-z][A-Za-z0-9_]{0,63}/g          → identifiers/words
plus a second scan for hexish tokens:
/(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g  → letter-containing hex
plus the 4c literal scan (trim/composition rules below):
/[A-Za-z0-9._@:+/~=-]{4,96}/g          → technical literals (digit-bearing)
                                       → and 4d path-shaped runs (see 4d)
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
4. **Punctuation/whitespace terminate tokens — EXCEPT the symbol/hyphen
   joins of rules 4a–4d.** Apostrophes always split (`don't` →
   `don`); commas, brackets, quotes, whitespace terminate.
   4a. **Dotted filename-shaped tokens stay whole (2026-09 rule).** A
       word run with one or more dotted alphanumeric parts whose FINAL
       part is 1–5 letters is ONE token: `AGENTS.md`, `package.json`,
       `file.tar.gz`. The `.` is not a word boundary here — filenames
       are completion targets as typed ("agent" should offer
       `AGENTS.md`, not the bare `AGENTS`). Base/hexish tokens inside
       the span are absorbed. Version numbers (`v1.2.3` — final part
       numeric) and decimals (`3.14`) do not match and keep the
       base-pass split.
   4b. **Hyphenated compounds stay whole (2026-09 owner rule — a
       hyphen between word segments does NOT split).** A letter-initial
       run of two or more segments joined by single inner hyphens is
       ONE token: `load-bearing`, `opt-in`, `e2e-test`,
       `state-of-the-art`. The compound as typed is the completion
       target; the parts are absorbed (never separate candidates),
       exactly like the filename pass. Leading, doubled, or trailing
       hyphens never form tokens — CLI `--flag` and `-v` are not
       candidates (and digit-initial runs like `2e-test` are owned by
       4c). Admission falls out naturally: compound keys are
       dictionary-absent → group 0, the identifier class.
       Rules 4a/4b are one family: COMPOUND TOKENS — typed-shape units
       (`.`-joined or `-`-joined) that complete whole, with contained
       base tokens absorbed by a shared sweep.
       Known gap (accepted): the compound sweep predates rule 3's
       Unicode-letter adjacency guard and never gained it — a non-ASCII
       letter adjacent to a compound span does not disqualify it
       (`草AGENTS.md` yields `AGENTS.md`), unlike the base, hexish, and
       literal passes, which all guard.
   4c. **Technical literals stay whole (2026-10 owner rule — digit-bearing
       mixed strings and long numbers are completion targets).** A
       maximal run of `[A-Za-z0-9]` joined by SINGLE INTERIOR symbols
       from `._@:+/~=-` qualifies as ONE literal token when, after
       trimming leading/trailing symbols, it is 4–64 chars, has no two
       adjacent symbols, and CONTAINS A DIGIT plus a letter or symbol —
       or is pure digits of length ≥ 4: `2560x1440@2`, `v1.2.3`,
       `192.168.1.1`, `3.14`, `8080`, `2026-09-15`, `4:36`, `2e-test`,
       `mode=2`. Motivation (owner, 2026-10): hapax exists to type
       strange identifiers, codes, and ARGUMENTS — LLM output like
       "drop the virtual mode to 2560x1440@2" must complete whole;
       pre-rule it fragmented to the base tail `x1440` only. Guards
       (each is load-bearing against a prose-noise class):
       - **Digit-bearing requirement.** Digit-FREE letter+symbol strings
         (`C++`, `and/or`, `e.g.`) do NOT qualify — that class stays
         with 4a/4b, where prose-shaped noise is already curated. The
         owner's phrase was "any two of numbers, symbols or letters";
         digit-free joins are the deliberately dropped corner
         (digit-free SLASH-joined runs are owned by 4d's path
         predicate).
       - **Single interior symbols, edges trimmed.** `..`, `//`, `::`
         reject (URLs die at `://` exactly as before); trailing
         sentence periods never glue (`fox.` stays `fox`); leading
         `--`/`~` trim (`--mode=2` → `mode=2`, `~2.1.0` → `2.1.0`).
       - **Length floor 4** mirrors "numbers over 3 digits": `123` and
         two-char codes (`4K`) stay out.
       - **Strictly additive.** A literal whose post-trim span EQUALS OR
         IS CONTAINED IN a kept base/hexish/compound token defers to
         that token (`utf8Reader` keeps camelCase subword splitting;
         `0f3a9c2` stays hexish-flagged; `FOO_1_` keeps its base token —
         the trailing-`_` trim cannot fork a `FOO_1` literal);
         literals absorb every base/hexish token inside or OVERLAPPING
         their post-trim span — containment (`2560x1440@2` absorbs its
         `x1440` tail) AND the trailing-`_` straddle class: `_` is a
         base word char AND a trim symbol, so a base token can start
         inside the literal and end past its trimmed edge without either
         span containing the other (`q~z9_` → `q~z9` whole, never the
         shred `z9_`; `X=1ZZ_` → `X=1ZZ`, never `ZZ_`). One span per
         character class region — never overlapping tokens. Rule 3
         (Unicode-letter adjacency) applies to literals like every
         pass. Literals are OPAQUE to subword splitting — codes
         complete whole as typed.

       Shape-gate interplay: letter-free keys (pure digits,
         digit+symbol codes) skip the character-entropy floor —
         `8080` (1.0 bits/char) is a real port shape and unigram-run
         still rejects `1111`. The secret rules apply unchanged
         (`user2@host.com` rejects `@`+`.`; pure-hex ≥ 20 and pure
         decimal ≥ 16 reject) — `192.168.1.1:8080` and ISO
         timestamps pass (the ratio heuristic that killed them is
         retired, 2026-10).
   4d. **Slash-joined paths stay whole (2026-10 owner rule; status:
       adopted ahead of implementation — code lands with this spec).**
       A maximal literal-charset run that is PATH-SHAPED is ONE token:
       `src/core/query.ts`, `/home/user/projects/hapax`,
       `docs/architecture.md`, `../tools/build.mjs`, `example.com/a/b`.
       Paths from conversation — model-suggested, user-typed,
       planned-but-not-yet-created — are retyping targets disk
       completion cannot know. Predicate (after edge trimming):
       **≥ 2 interior single `/` separators, OR exactly 1 interior `/`
       plus a dotted component** (`docs/readme.md`). Digit-bearing runs
       already qualify via 4c; a run qualifying both ways takes the
       path class (the more specific one — downstream behavior is
       identical, both are opaque whole tokens).
       - **Edge trim vs display.** The KEY trims leading `/`, `~`,
         `./`, `../` (and combinations) and a trailing `/` — matching
         happens on the trimmed form, because the editor fragment
         always starts at a letter. The DISPLAY preserves the original
         LEADING edge symbols: `/home/...` inserts with its leading
         slash, `../tools/build.mjs` with its `../`. TRAILING trims —
         sentence periods, a trailing `/`, a trimmed `:line:col` tail —
         leave key AND display alike (2026-09-30 validation fixes; 4c's
         `fox.` guard applied to the path family): a sentence-final
         `query.ts.` or `query.ts:42:13.` inserts as `query.ts`, never
         the period or the line numbers, and one visible path stays ONE
         candidate whether it was seen mid-sentence or sentence-final.
         Casing recency-merge is unchanged.
       - **Line/column suffix.** A trailing `:digits(:digits)?` is
         trimmed when the remainder is path-shaped
         (`src/foo.ts:42:13` → `src/foo.ts`) — the user retypes the
         path, not the line numbers; the trim applies to key AND
         display, so Tab never inserts the suffix. Non-path colons
         keep their meaning: `4:36` (time) and `localhost:8080`
         (host:port) are untouched.
       - **Guards.** Single interior symbols only (interior `..`
         rejects the whole run — `a/../b` shreds; leading `../` is an
         EDGE, trimmed); rule-3 Unicode-letter adjacency applies;
         strictly additive against equal spans of other classes (in
         practice paths cannot equal a base/hexish/compound span —
         they contain `/`); post-trim key length 4–96 (the shape
         gate's path-class cap; the literal scan window is sized to
         96 for this rule); opaque to subword splitting, exactly
         like 4c literals. Secret rules apply unchanged: a path
         segment with base64url-secret texture rejects the whole
         candidate (conservative), and `@`+`.` keeps URL userinfo
         out. The entropy floor applies like any letter-bearing key
         (real paths clear it comfortably; `a/a/a/a`-shaped noise
         dies). Path tokens enter adjacency runs like any whole
         token (the successor `edit → path` is legitimate).
       - **Completion context (owner decision).** hapax's
         stock-context gate delegates to pi's built-in file
         completion whenever a `/` precedes the cursor — UNCHANGED.
         Path candidates therefore surface at the path's FIRST
         segment (`sr` → `src/core/query.ts`; Tab inserts the whole
         path); mid-path typing belongs to stock pi (which completes
         existing files from disk). Integration item 6
         (path/slash/@ identical to stock) is unaffected.
       - **Documented gaps (accepted):** a single-slash letter-only
         path (`src/core`) is shape-identical to prose `and/or` and
         does not qualify — it shreds to components (the common
         `src/core/query.ts` form qualifies via its second slash,
         `docs/readme.md` via slash+dot); trailing-slash directory
         paths (`src/core/`) reduce to that same non-qualifying form;
         interior `..` rejects; Windows backslash paths are not in
         the charset (POSIX-shaped input assumed).

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
  no lowercase sightings in-session — is an OPEN DESIGN ITEM: it would
  also filter words like `national` that appear both ways. The
  alternative is retiring relief outright and relying on the
  dictionary-absent class (identifiers rarely need relief). No decision
  recorded; nothing changes until the owner calls it.

## Shape gate (`src/core/shapeGate.ts`)

Applied to **every** segmented candidate before dictionary lookup. Rejects:

1. **Too short/long:** whole-token candidates must be 2–64 chars
   (path-class candidates 4–96, rule 4d); sub-words 2–32. (Floor dropped 4 → 2, 2026: short dictionary-absent acronyms —
   API, CLI — are hapax's core class; common short English is rejected
   downstream by the commonness band, not by length.)
2. **Low entropy:** character-entropy < 1.5 bits/char, for LETTER-BEARING
   keys only (kills `aaaaa`, `aaaaaaaargh`-ish repetition), or unigram-run
   of any single char ≥ 4. Letter-free keys — the 2026-10 rule-4c literal
   class: `8080`, `10.0.0.1` — skip the entropy floor (two-char digit
   alternation is a real code shape, not noise; `1111` still dies by the
   unigram run, and pure-digit strings cap at log2(10) ≈ 3.3 bits/char so
   the exemption cannot mint secrets).
3. **Secret-shaped strings** (always reject, not configurable):
   - matches known key prefixes: `sk-`, `sk_`, `ghp_`, `gho_`, `github_pat_`,
     `xox[bpars]-`, `AKIA`, `AIza`, `eyJ` (JWT bodies);
   - `@` plus a dot (emails are segmented out anyway; belt and braces);
   - base64-shaped run ≥ 24 chars with mixed case+digits+`+/`;
   - whole-candidate pure hex ≥ 20 (private-key-shaped) or pure
     decimal ≥ 16 (card/account-shaped);
   - base64url/entropy residue rules (BUG-003; see shapeGate.ts).

   RETIRED 2026-10 (owner): the digit+symbol-ratio heuristic (> 0.4 at
   length ≥ 16) — written before technical literals existed, it
   rejected `192.168.1.1:8080`, ISO timestamps, and dotted versions,
   the exact class hapax exists to complete. Residue accepted:
   separator-bearing card numbers (`5105-1051-0521-0510`) and
   all-lowercase non-hex random alnum ≥ 16 pass the token gate;
   maskSecrets' format rules own real leaked keys, and PAN-shaped
   pure decimals (≥ 16 digits) still reject via the long-number rule.
   Binding layering rule: future card/secret SHAPE rejection belongs
   in maskSecrets (raw layer — it runs before tokenization and covers
   live and restore paths alike), never in a token-shape rule.
4. **Pure noise:** consonant run ≥ 6 with no vowel and no digits.

Hexish tokens 6–12 chars (commit-hash-like) **pass** the gate — they are
legitimate completion targets in dev sessions. Hexish ≥ 20 rejected by rule 3.

The gate is the load-bearing filter for dictionary-absent words; everything
absent from the table enters here or not at all.

## Admission decision (`src/core/score.ts`)

Let `q = dictionary.lookup(lowercase)` (null when absent) and `len` be
the key length. The reject band is **length-conditioned (2026-10 owner
rule, the long-word gradient; status: adopted ahead of implementation —
code lands with this spec)**:

    R_eff(len) = R                                len ≤ 8   (floor hold)
    R_eff(len) = R + (255 − R)·√((len − 8)/12)    8 < len < 20
    R_eff(len) = 255 (admit-all)                  len ≥ 20

`R` is the floor — **default 12** (2026-09 retighten; owner rule),
runtime-tunable via the `rejectCommonness` config (see 08; the knob
moves the floor and the whole curve scales from it). The design premise
(2026-09, refined 2026-10): **dictionary attestation is
near-disqualifying evidence at short lengths** — hapax completes the
dictionary-ABSENT class (identifiers, commit-hash-shaped tokens,
jargon) — but commonness stops being evidence of noise as words
lengthen: typing savings grow with length while noise mass collapses
(of ~50k corpus words, ~13k currently-rejected live at 7–9 chars, ~2.8k
at 11+, ~250 at 14+). The sqrt shape is steep where noise dies (9–12)
and saturates where almost nothing remains to admit (16+). Curve chosen
by owner measurement (2026-10): linear 6→20 was rejected (≈18.9k
flips, re-admitting the audit's own `provider` class); floor-10
variants were rejected as stricter than the owner's intent (~3.2k
flips, nothing below 11 chars); **sqrt 8→20 adopted** (≈10.5k flips).

| Condition | Result |
|---|---|
| `q !== null && q >= R_eff(len)` | **Reject** — attested English too common for its length (`the`, `context`, `provider`, `everything`) |
| `q !== null && q < R_eff(len)` | **Admit, rank group 1** — attested, but worth completing at this length |
| `q === null` (absent) | **Admit, rank group 0** — rare-by-default (post shape gate): THE value class |

Measured effect against the shipped artifact (sqrt 8→20): ≈10.5k
corpus words flip vs the flat band — nothing below 9 chars changes; at
9 chars admits q≤82 (`R_eff(9)` ≈ 82.15, float compare — q=83 is the
first reject), 10 → q<110 (`government` yes; `everything` q=139 no),
11 → q<133 (`information`, `development`), 12 → q<152
(`organization`, `relationship`), 14 → q<184 (`characteristics`,
`infrastructure`, `responsibility`); admit-all from 20. The 2026-09
audit's noise words all stay rejected (`provider` q=34 sits on the
8-char floor hold; `default` q=44, `enable` q=38, `cache` q=30,
`node`/`spec`/`null` are all under their length's threshold).

**Group placement is flat at 1 (2026-10 owner rule).** Every attested
admission lands at rank group 1 regardless of q — long ramp-admitted
words carry the +0.5 rarity bonus like the rarest tail ("weighted a
little more heavily", owner), and the old `[20, 50)` group-2 band
stays dead. That band was the 2026-09 live-audit noise leak (1,183
everyday words: `provider`, `default`, `null`, `node`, `enable`,
`spec`, `cache`, against 4,889 absent identifiers); the ramp does not
revive it. The `RankGroup` type keeps group 2 for compatibility (the
subword clamp can still produce it); it is unreachable via the table
and via relief.

The bands are baked constants calibrated against the shipped artifact
with `tools/calibrate-bands.mjs`, which doubles as a word probe:
`node tools/calibrate-bands.mjs lists deleted` prints a word's `q` and
its verdict (lowercase and capitalized). Calibration history: 220
(BUG-001, mathematically unreachable) → 100 → 50 (Issue-1) → **12
(final)** → length-conditioned sqrt 8→20 (2026-10 gradient).

**Proper-noun relief — RETIRED-IN-PLACE.** The relief mechanism (a
capitalized whole token whose table result is reject admits at group 2)
remains in code but its ceiling is set equal to the reject band, so it
can no longer admit anything. History: it existed so M2's "National
Renewable Energy Laboratory" (q 57–94) could chain; a live audit showed
it admitting ~483 capitalized common words (`echo`, `windows`,
`failed`, `file`). The owner retired it ("not half of the english
language"); restoring named-entity completion is a user-allowlist design
question (config layer), not a band change. The 2026-10 ramp changes
nothing here: the ceiling sits at the floor R, below every R_eff —
relief stays dead.

**Conjugation guard.** An inflection whose STEM is a common word rejects
too, whatever its own `q`. The dictionary ranks inflections separately
(`delete` q=51 rejects; `deleted` q=45 would admit; absent `deletes`
would admit as "rarest"), which leaked everyday verbs, adverbs, and
plurals into the menu. Stems are one-level strips of `-s -es -ed -d
-ing -ly`, with e-restoration (`typing`→`type`, `caching`→`cache`) and
doubled-consonant undo (`stopped`→`stop`). Two tiers, both comparing
the stem against the SAME length-conditioned threshold of the word
being admitted — `R_eff(len(word))` (2026-10):

- stem `q >= R_eff(len)` → reject (any `q` of the word itself);
- word absent AND stem `q >= R_eff(len)` → reject (absent inflections
  of attested stems: `uploads` → `upload` q=38 ≥ R_eff(7) = 12).

The fixed mid-band stem threshold (20, MID) is retired (2026-10) —
both tiers ride R_eff; it survives only as a compatibility constant.
At ramp lengths the guard loosens with the table: `configurations`
(15c, stem `configuration` q=26 < R_eff(15) ≈ 198) admits; a 9-char
absent inflection of a mid-common stem admits at group 0 — an accepted
consequence of the owner-chosen curve. Capitalized (properName) candidates skip the guard — casing
evidence outranks morphology (a relief-restoring change would need this
intact). Known leak (accepted): an inflection whose stem is ALSO
dictionary-absent admits as group 0 — no tier can fire (`parse` and
`parses` are both absent from the table, so `parses` stores as a rare
word). Derivational suffixes (`-tion`, `-ment`, `-er`) are
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

## Query matching (anchored fuzzy + anchorless tier-0; 2026-10 owner rules)

The plain prefix match is RETIRED. The typed fragment `f` (from word
matching or after the trigger char, 07) matches candidate key `c` (both
lowercase) iff:

1. **First-character anchor:** `f[0] === c[0]` — the first typed
   character must equal the candidate's FIRST character
   (case-insensitive). A fragment that does not start with the
   candidate's first character never matches (`esk` never matches
   `zendesk`; mid-identifier entry stays available through sub-word
   candidates — segmentation above).
2. **Anchored subsequence:** `f[1..]` appears in `c[1..]` in order
   (subsequence, greedy leftmost matching).

The anchor is load-bearing for performance: only the store's
first-char bucket is fuzzy-scanned per query (06), so the < 1 ms
keystroke budget (02/09) survives the fuzzy scan.

**Strictness tiers** (order-determining — see Query ranking):

- **Tier 3 — exact prefix:** `c` starts with the whole fragment (the
  retired behavior; always the strictest).
- **Tier 2 — contiguous tail:** `f[1..]` occurs contiguously somewhere
  in `c[1..]` (`zsk` → `zendesk`; `zlock` → `z_lwlock`).
- **Tier 1 — scattered:** anchored-subsequence only, with gaps
  (`hrp` → `handleResponseProxy`).

**Admission score (threshold-gated; NOT order-determining).** Every
match gets an integer score 0–100:

```
tier 3: 100
tier 2: 85 − 40 · (charsSkippedBeforeRun / len(c))   → ~45–85
tier 1: 50 − 5 · gapRuns − min(gapChars, 15)          → ≤ 50
```

Candidates scoring below `fuzzThreshold` (config, 08; default 60,
higher = stricter; 100 degenerates to exact-prefix-only mode) are
discarded BEFORE ranking — they render nothing even though they
technically match. Owner rationale (2026-10): a ~20k-entry store with
loose fuzzy settings floods the results; only fairly strict matches
belong. At the default this admits every exact prefix and strong
contiguous tails (`zsk`→`zendesk` ≈ 62, `hr`→`handleResponse` ≈ 69)
and gates out most scattered matches. The formula constants are
calibration starting points (09 tuning protocol), not gospel; the tier
BOUNDARIES (what is a prefix / contiguous tail / scattered match) are
semantics, never tunable.

**Tier 0 — anchorless contiguous run (2026-10 owner rule; status:
adopted ahead of implementation — code lands with this spec).** When
the ANCHORED scan (tiers 1–3, threshold-gated) returns ZERO results —
and only then — one anchorless pass runs over the full store: the
fragment appears as ONE contiguous run, EITHER placement — anywhere
in the key, or at the first position (the owner's either/or; position
0 is tier 3's territory whenever anchored results exist, so the
anywhere arm is the operative one). Fragment floor **3 chars**;
anchors, subsequence logic, and boundaries do not apply. Admission
score:

    tier 0: 85 − 40 · (runStart / len(c))   → ~45–85

threshold-gated exactly like the other tiers (a run starting in the
front ~62% of the key passes 60; late runs gate). Tier 0 sorts BELOW
tier 1 — the strictness order extends to 3 > 2 > 1 > 0.

Measured record (2026-10, rare-tail corpus — the class that actually
admits; collisions counted only on fragments whose ANCHORED result is
empty, the only case where the fallback fires): the fallback can
never enrich a menu that would already open — it only rescues menus
that would not appear. Cost: ~5% of common 3-char words rising to
~20% at 7 chars summon a one-shot menu that narrows away as typing
continues; the collisions are overwhelmingly morphological cousins
(`said`→`unsaid`, `heard`→`unheard`, `people`→`townspeople`),
accepted by the owner. Wins: mid-word recall no anchored rule can
serve (`esk`→`zendesk`, `tok`→`session_token`) and, in particular,
path-filename entry (`query`→`src/core/query.ts`, score 64) — rule-4d
path tokens are opaque to subword splitting, so nothing else serves
this. This AMENDS integration item 2 (09): "no menu for common
words" now reads "no menu for common words WITH ANCHORED MATCHES; the
zero-result fallback may surface contiguous-run cousins."

**Performance.** The anchorless pass scans the full store (there is
no first-char bucket to enter — measured 1.1–2.6 ms per query at the
20k cap, synthetic). The < 1 ms keystroke budget keeps applying to
the ANCHORED scan (unchanged, bucket-only); the tier-0 pass carries
its own budget — < 3 ms p99, CI gate at 3×, mirroring the existing
gate structure — and fires only on the empty-anchored path, so the
common case never pays it.

**Trigger-char mode (`#`) loosening (2026-10 owner rule).** Under the
trigger char the gates relax — `#` is hapax's explicit "search the
session vocabulary" gesture, and the picker precedent (fzf, command
palettes) puts promiscuous matching behind an explicit invocation,
never in the ambient word-start path: (a) tier-0 anchorless runs are
ALWAYS consulted — no zero-anchored-result precondition (`#query` →
`src/core/query.ts` works directly); (b) scattered tier-1 matches are
VISIBLE — the `#` mode's default threshold is **45** (vs ambient 60;
45 sits under tier-1's max of 50, so only the strongest scattered
matches admit — `#cfg` → `config_manager_service`). An explicitly set
`fuzzThreshold` (08) overrides BOTH mode defaults. Successor
chaining stays ANCHORED everywhere: chain arming and the chain gate
consult tiers 1–3 only — tier-0 matches never arm or extend a chain.

## Query ranking (final result order)

**2026-10 owner rule — frequency tie-breaking (settled).** Order is:

1. **Strictness tier descending** (3 exact prefix > 2 contiguous tail
   > 1 scattered > 0 anchorless run — 04 Query matching). A
   1-occurrence exact-prefix word outranks a
   40-occurrence scattered match — strictness always wins first.
2. **Within a tier: `sessionCount` descending** — conversation
   frequency breaks ties among equally strict matches (the owner's
   rule: higher occurrence counts make a word rank higher than
   another word matching the query exactly).
3. Ties → shorter candidate key first.
4. Ties → lexicographic (byte order on the lowercase key).

**Zero-fragment listing** (`#` alone — no fragment, no tiers):
sessionCount descending, then rules 3–4.

**Retired (same rule):** the pure content-derived order ("shortest
first, then byte-lex; never salience"). Its 2026-09 rationale was
cross-session muscle-memory stability. Superseding rationale (owner,
2026-10): among equally strict matches the more conversation-relevant
word (higher session count) belongs leftmost; the accepted cost is
that same-tier neighbors may swap as counts change during a session.
Residual stability: tiers and rules 3–4 are content-derived, and two
candidates only reorder relative to each other when one's
sessionCount strictly passes the other's.

**Plural pruning (2026-09 owner rule):** when a result set contains
both a key and that key + `"s"` (exact single-`s` pair: `plugin` /
`plugins`), the plural is dropped — the pair is redundant menu noise
and the singular is the completion target. Guards: the pair must be
in the SAME result set (a plural whose singular is absent — filtered
by the limit, not a match, or evicted — stays); `ss`-final
keys never prune (`glass`/`glas`); `es`/`ies` plurals are different
keys entirely (`class`/`classes` is out of scope); filename-shaped
keys are untouched (`agents` vs `agents.md` is not a pair). Pruning
runs BEFORE the limit slice, so a pruned plural never consumes a
slot. The store itself is never pruned — this is a query-time menu
rule only (the conjugation guard in admission handles common stems;
this covers dictionary-absent jargon pairs that both stored
legitimately).

Rationale for the retired order (kept for history): a menu whose order
depends on recency or frequency reshuffles between keystrokes and
between sessions, defeating the muscle memory completion exists to
build. The 2026-10 owner decision accepts same-tier churn as the price
of conversation-relevant ordering; salience still decides MEMBERSHIP —
admission and eviction — and the full salience score never orders
anything (only its raw `sessionCount` component does, within tiers).

Return top **8** items (`maxSuggestions` config, 1–20; the widget
line's item cap and the fallback menu's height — 07). Under the
trigger char, same rules.

## Case handling

- Matching is **case-insensitive** throughout — anchor, tiers, and score
  all computed on lowercase keys: typed `nrel` matches `NREL`.
- Insertion uses the candidate's display casing (`NREL`).
- The store keys on lowercase; one candidate per lowercase key (casing
  variants merge, display casing = most recent).
# 05 — Ingestion Pipeline

## Event contract

Single hook: `pi.on("message_end", handler)`.

`event.message` is a finalized `AgentMessage`. Ingest exactly these:

| Condition | Action |
|---|---|
| `role === "user"` | Ingest text content (prompt text; images ignored) |
| `role === "assistant"` | Ingest **only `block.type === "text"` blocks**. Skip `thinking` blocks. Code fences inside text blocks are **included** (explicit agent output). Skip tool_use blocks |
| Anything else (`toolResult`, custom types) | **Ignore entirely** |

Rationale (settled): everything the agent explicitly tells the user — not
thinking tokens — is fair game. Generated-or-ingested content (tool results,
file reads) is not.

User message content may be a string or a content-block array; handle both
shapes.

## Debounce and scheduling (`src/pi/ingest.ts`)

- On each `message_end`, push the extracted text into a pending queue and
  (re)start a **300 ms** debounce timer.
- When the timer fires, process all queued texts in order.
- Rationale: agents emit several messages in quick succession during tool
  loops; batching avoids repeated chunk-yield overhead mid-typing.

## Chunked processing

- Process in ≤ 64 KB slices; `await` a microtask/yield between slices
  (`setImmediate` or `scheduler.yield()` if available) so the event loop
  breathes. A pathological multi-MB message must never block a keystroke.
- A slice boundary never splits a token: the trailing partial token
  (suffix of token-class characters) is carried into the next slice and
  tokenized there exactly once, mirroring the open-line/open-tail run
  carry.
- Track cumulative stats (words seen, admitted, rejected-by-gate) for the
  debug command (see 08).

## Session restore (rebuild)

On `session_start` with reason `"startup"` or `"resume"`:

1. Access session history via the pi session API (read messages from the
   current session in order).
2. Replay oldest → newest through the identical pipeline (same gates, same
   counters) in the background (chunked, debounced startup is fine — the
   store fills progressively).
3. Oldest-first ordering matters: `lastSeen` ordinals and display casing must
   end in the correct final state.
4. Completion signal: the replay invokes `onSettled` exactly once (finish,
   abort on dictionary failure, or collection throw) so the provider's
   startup gate (07) can bound-wait for a full store — otherwise a word
   typed during replay queries a partial store, and pi-tui's
   one-query-per-word makes its menu permanently missing until retyped.

Budget: 200k tokens (~800 KB) ≈ 30–50 ms total. This is the **only** cold-start
work; there is no persistence layer by design (rebuild beats deserialize at
this scale; see decision log).

## Compaction

Compaction rewrites context but fires no event we consume. **The store survives
compaction untouched** (settled decision). Consequences:

- `sessionCount` / `lastSeen` continue their monotonic counters across the
  compaction boundary.
- Words only present in compacted-away text remain candidates (acceptable:
  they were real session vocabulary).
- No integration with compaction summaries in M1/M2. ("Integrate with tree
  later" is deferred explicitly.)

## Eviction interplay

The store cap (see 06) applies during restore too: a huge history may evict
early words as it replays. Eviction scores use the same salience formula, so
survivors are the right survivors. Cap is 20,000 whole-token candidates; at
typical vocabulary sizes (~10–20k uniques per 300k tokens) eviction rarely
triggers.

## What ingestion must NOT do

- Never block, mutate, or rewrite the message (no `{ message }` return).
- Never read files or run tools.
- Never hold message text after processing: extract candidates, drop the
  string. The store holds words + counters only, never message bodies.
- Never process text on the keystroke path — all ingest work is debounced and
  chunked.
# 06 — Candidate Store

## M1: word candidates

`src/core/store.ts` maintains the per-session store. One entry per lowercase key:

```ts
interface Candidate {
  key: string            // lowercase
  display: string        // most recent casing seen
  sessionCount: number   // occurrences this session
  lastSeenOrdinal: number // message ordinal at last sighting
  firstSeenOrdinal: number
  userTyped: boolean     // sticky once true
  properName: boolean    // capitalized-initial seen at least once
  rankGroup: 0 | 1 | 2   // admission group (04)
  isSubword: boolean
}
```

Backing structures:

- `Map<string, Candidate>` — primary upsert path.
- **Prefix index** — maintained at ingest time for query-time speed: a sorted
  array of lowercase keys kept consistent by AMORTIZED consolidation (new-key
  inserts push to a pending list; upsert merges it in 256-key chunks and the
  next query merges the ≤-batch tail — no single query ever pays a whole-index
  re-sort, so a cold first query after a 20k restore stays inside the 1 ms
  budget, and insert stays ~O(1) with binary-search per keystroke). Query =
  binary search for the first-char range (the anchored fuzzy match's
  first-character requirement, 04, keeps the prefix index the scan
  entry point) + fuzzy tier/score over the range + rank (tier →
  sessionCount → length → lex, 04) + top 8.

No persistence. Store is created at `session_start`, dropped at
`session_shutdown`.

## Upsert semantics

On admitting a sighting of word `w` in message with ordinal `n`:

- Absent → create entry (`sessionCount = 1`, ordinals = n, source flags set).
- Present → `sessionCount++`, `lastSeenOrdinal = n`, refresh `display` casing,
  OR in `userTyped` / `properName` flags, keep `rankGroup` = min(existing, new)
  (a word first seen mid-frequency then seen rare keeps the better group).

## Eviction

- Hard cap **20,000** entries (whole-token candidates; sub-words count toward
  the same cap).
- On overflow, evict the lowest `evictionScore`:

```
evictionScore = salience(c) * ageFactor
ageFactor = exp(-(currentOrdinal - lastSeenOrdinal) / 50)
```

- Evict in batches of 256 (sort snapshot, drop tail) to amortize cost.
- Never evict `userTyped` candidates unless the cap is exceeded by
  `userTyped` alone.

## M2: successor index (chained completion)

There are **no phrase candidates**. A completion item is always exactly one
word, under all circumstances. "Phrase support" means only this: after a
word is accepted, its most-likely successor is offered as the top
suggestion with **zero** additional typed characters (see 07, chained
completion). No multi-word string is ever a menu item, a `value`, or an
insertion.

### Bigram capture (raw-text adjacency, strictly)

During ingestion, record bigrams of admitted whole-token candidates
(sub-words excluded) that are **adjacent in the raw text**: the two words
are separated by nothing but plain whitespace (spaces/tabs) on the same
line. Key = lowercase `first second`.

The window breaks — no bigram forms — when ANYTHING other than plain
whitespace appears between the two words:

- **Clause and punctuation:** `,` `;` `:` `.` `!` `?` `—` `–` `…` `|` —
  `ZorpWibbleEngine, quuxblat` never chains.
- **Quotes and brackets:** `` ` `` `"` `'` `(` `)` `[` `]` `{` `}` `<` `>` —
  backtick-quoted identifiers separated by even a space do not chain
  (`` `A` `B` `` has two backticks between the words). Words entering a
  quote or leaving one do not chain across the boundary.
- **Digits, hexish, and any non-word character:** `/` `\` `=` `+` `&` `%` `#`
  `*` `@` `-` `~` `^` — a digit run or hexish token between two words breaks
  the window; `v2 release` does not chain `v2`→`release`.
- **Any other word, common or rare:** an intervening word — even a
  rank-rejected common word like `the` or `of` — breaks the window.
  Bridging over dropped common words is FORBIDDEN. `United States of
  America` yields only `united states` and `america`; the stopword-bridge
  tradeoff is accepted for predictability (bugs like
  `ZorpWibbleEngine, the quuxblat` → `zorpwibbleengine quuxblat` are the
  reason).
- **Newline:** the window never crosses a line break (unchanged).

No trigrams. No `PhraseEntry` map, no phrase admission/sticky/demotion
lifecycle, no constituent suppression — those designs are removed. The one
M2 structure is the successor index:

### Successor index (for chained completion)

```ts
Map<string, Array<{ next: string, count: number }>>  // top 3 per word
```

Built from the bigram counts: `word → top-3 most frequent successors`,
updated at ingest; trivial size. Cap the bigram map at 10,000 keys with the
standard eviction policy; evicting a bigram also splices it from the
successor index.

Query use is defined in 07 (chaining). This is the M2 structure; M1 ships
without it.
# 07 — Completion UI

## Display architecture (2026-10 owner rule: one-line widget, dual-path)

hapax displays word suggestions on its own **one-line result widget** —
not pi-tui's vertical SelectList (which renders one item per row, with
an optional right-hand description column, and has no horizontal
mode). Two paths, decided at session start:

- **Primary (widget):** when an editor factory exists — some extension
  installed an editor, so hapax's editor proxy (below) can compose
  around it — hapax renders the widget and owns display and key
  semantics entirely. No autocomplete provider is registered on this
  path; stock path/slash/`@` completion is untouched by construction.
- **Fallback (stock vertical menu):** pi exposes no stock editor to
  extensions (`getEditorComponent()` is undefined until an extension
  sets one). Where no factory exists the proxy cannot install and the
  widget cannot run; there hapax registers the provider below and
  displays through pi-tui's vertical menu (the pre-2026-10 behavior,
  single-item forced return included). Both paths share the query
  core (04), the startup gate, and the debounce/hysteresis timing.

**Session lifecycle (rebind, 2026-10):** `session_start` builds a fresh
store/pipeline/chain/restore-gate per fire and can fire repeatedly
in-process (resume, session switch). The widget path therefore
RE-BINDS on every re-fire: the installed wrapper is replaced by a
fresh composition around the ORIGINAL pre-hapax factory (remembered
in the wrapper's introspection seam), bound to the new session's
deps. This preserves the no-stacking invariant (a wrapper is never
wrapped again) while never leaving the widget reading a previous
session's store — the pre-2026-10 keep-installed behavior left
completions serving stale vocabulary after any `/resume` (violating
acceptance item 3; live-observed via the §09 technique). The fallback
path re-registers a fresh provider per fire and needs no such step.

Considered and rejected (2026-10, recorded for history): a single
synthesized menu item whose label is the joined line (zero pi-tui
changes, but arrow selection of non-top words is lost) and waiting
for an upstream pi-tui horizontal menu mode (no timeline; blocks the
display change indefinitely). The owner chose arrow selection on an
own-rendered line.

### One-line widget (primary display)

- One line directly below the input editor: items joined by `" | "`,
  rank order left→right (04), never wraps. The right-hand column is
  RETIRED: no `Session xN` frequency, no `description` provenance (the
  `chain` marker included). Frequency still ranks (04); it just isn't
  displayed. A result item is the candidate display string, nothing
  else.
- Line cap = `maxSuggestions` AND terminal width: overflow drops the
  lowest-ranked (rightmost) items first.
- Zero candidates → the line never renders (invariant 3).
- The highlight (theme accent) sits on the leftmost/top item by
  default and resets to it on every result-set change.

### Widget key handling (amends the never-hijack invariant; 2026-10)

While the line is visible, the editor proxy consumes — before the
inner editor sees them:

- **All four arrows navigate.** ← and ↑ move the highlight left; →
  and ↓ move it right. (Owner-accepted capture of the arrow cluster
  once the list is entered — an arrow that moved the highlight;
  boundary pass-through below is the un-entered escape hatch.)
- **Boundary pass-through (owner refinement; 2026-10 one-press rule;
  status: adopted ahead of implementation — code lands with this
  spec).** ↑ or ← while the highlight is on the FIRST word of an
  UN-interacted generation: the line dismisses, suppression arms
  until the next word start, and the press FORWARDS verbatim to the
  editor — the caret moves on that same keypress. ONE press,
  plain-pi parity: a user who never enters the list experiences
  ↑/← exactly as with no extension installed. (Supersedes the
  consumed-press variant — first press dismisses, second moves the
  caret — rejected by the owner 2026-10: no second press.)
  Symmetric transparency: → or ↓ with nothing to navigate (a
  one-word line, un-interacted) forwards verbatim too and the line
  simply stays — NO arrow press is ever consumed before the list
  has actually been entered.
- **Carousel after interaction (2026-10 owner rule; status: adopted
  ahead of implementation — code lands with this spec).** A
  generation is one continuously-displayed result set. The first
  arrow press that MOVES the highlight — →/↓ entering an
  un-interacted multi-word line — marks the generation as
  interacted; from then on, for that generation only, the arrow
  cluster is captured and both edges wrap end-to-end: ↑/← on the
  FIRST word wraps to the LAST, →/↓ on the LAST word wraps to the
  FIRST. The clamp is RETIRED — unreachable: reaching the last word
  requires navigation, which interacts the generation, and
  interacted edges wrap. Plain Escape is unchanged (always dismiss +
  suppress) and is the exit once interacted. A genuinely new result
  set (narrowed, replaced, or otherwise changed) starts a FRESH
  generation: the highlight returns to the first word, the
  interaction flag resets with it, and boundary pass-through is
  available again. A pass-through press never sets the flag (no
  movement happened) — a one-word line therefore never becomes
  interacted and keeps full plain-pi arrow behavior. Tab inserts
  and Enter submits are unaffected by the interaction state.
- **Explicit dismissal (Escape, boundary pass-through) suppresses the
  line for
  the REST OF THE WORD.** Re-open only at the next word start or
  trigger char. A disqualification close (candidates hit zero) does
  not suppress — the next qualifying keystroke reopens.
- **Tab inserts the highlighted word** (leftmost if none
  highlighted), synchronously against the live query — never gated by
  the display debounce (invariant 2). Insertion replaces the live
  fragment span (word regex or `#fragment`, below) with the
  candidate's display casing: stock `applyCompletion` semantics,
  reimplemented on the widget path because no provider item exists
  there.
- **Enter ALWAYS submits, never inserts** — the Enter-submits proxy
  rule extends to the widget: Enter dismisses the line, then forwards
  the keystroke so the inner editor submits.
- **Everything else forwards verbatim.** Typing updates the query and
  the line per the debounce/hysteresis rules; no text is ever altered
  outside Tab-insertion.

Invariant amendment (binding; SPEC.md): the never-hijack invariant's
sanctioned captures are now Tab while a suggestion is selected, the
Enter-submits proxy, and — while the result line is visible — the
four arrows and Escape. Outside those windows, zero key handling.

### Widget visibility state machine (auto-open, re-based)

The widget path does not depend on pi-tui's request cadence (the
one-request-per-word constraint was the vertical-menu world's).
Visibility is driven by the editor proxy's input clock (already the
hesitation gate's timing source) plus hapax's own context detection
on each keystroke:

1. Extract the live fragment per the regexes below (trigger char,
   word fragment). Path/slash/`@` contexts: line hidden (stock
   completion owns them).
2. Fragment live + ≥ 1 candidate above the fuzzy threshold (04) →
   line visible, subject to `menuDelayMs` (hesitation gate) and the
   100 ms swap debounce — both carried over unchanged.
3. Trailing space with no `@`/`/` in text-before-cursor → hidden
   (close-on-space carried over as the widget's own state).
4. Cursor move, Escape, boundary pass-through, disqualification →
   hidden (flicker hysteresis carried over: narrowing must not
   close-and-reopen).
5. The startup restore gate (below) applies identically.

## Provider integration (fallback path only)

Single registration in the `session_start` handler — used ONLY when
no editor factory exists (see Display architecture):

```ts
ctx.ui.addAutocompleteProvider((current) => ({
  // trigger char PLUS every identifier char [A-Za-z0-9_] — see
  // "Auto-open" below: pi-tui only auto-requests on keystrokes whose
  // char is a registered trigger character at a word start
  triggerCharacters: [config.triggerChar, ...IDENTIFIER_CHARS],
  async getSuggestions(lines, line, col, options) { /* below */ },
  applyCompletion(lines, line, col, item, prefix) {
    return current.applyCompletion(lines, line, col, item, prefix);
  },
  shouldTriggerFileCompletion(lines, line, col) {
    return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true;
  },
}));
```

Delegate `applyCompletion` to `current` (built-in insertion semantics are
correct: replace the matched prefix with `item.value`). Only override
insertion if validation proves a need. The one sanctioned exception to
"never touch the editor" is the Enter-submits wrapper below.

The wired stack (`src/pi/index.ts`) composes bottom-up: hapax core
query (04) → startup gate → display layer — the widget (primary:
hesitation gate + 100 ms swap debounce + key handling) or provider
registration (fallback). The editor proxy (below) wraps whichever
factory the extension ecosystem installed and feeds the shared input
clock; the widget path depends on it.

## Auto-open (fallback path): how the menu ever appears

Fallback path only — the widget opens per its own visibility state
machine (Display architecture above). pi-tui's editor only CALLS `getSuggestions` while the user types plain
letters under narrow conditions: the typed char must be a registered
trigger character, at a word start (line start or after space/tab) — the
first letter of each word — and once a menu is open it re-requests on
every keystroke (self-updating). Consequences, all load-bearing:

- hapax registers `[A-Za-z0-9_]` as trigger characters so the FIRST
  letter of a word produces a request (the stock letter/continuation
  branch is unreachable when letters are registered — branch shadowing).
- The word-start request carries a 1-char fragment. The effective
  threshold is therefore **1**: `config.threshold` (1–3) is retained for
  schema compatibility but inert in the live editor — a threshold above
  1 is unobservable, because pi-tui never asks at "N chars in" and a
  delegated (empty) answer at 1 char means no menu ever opens and no
  further request arrives for that word.
- The menu opens when the 1st-char query returns candidates; zero
  candidates → delegation → nothing renders, and pi-tui cancels.
- hapax still delegates whenever no fragment matches, so stock contexts
  (slash, @, paths) are unaffected by the registered letters.
- Path-class candidates (04, rule 4d, 2026-10) surface at a path's
  FIRST segment (`sr` → `src/core/query.ts`); once a `/` precedes the
  cursor, stock pi file completion owns the rest — unchanged.

## Trigger modes

Two lookup modes, both always active:

1. **Trigger char** (default `#`): the regex `/(?:^|[ \t])#([^\s#]*)$/` on
   text-before-cursor. When matched, lookup starts from the **first** char
   after `#` (0-char minimum: `#` alone lists the top candidates in
   frequency order — sessionCount desc, 04's zero-fragment rule). On
   completion, `applyCompletion` (fallback) or the widget's Tab
   insertion (primary) replaces `#fragment` with the word (trigger
   char is consumed).
2. **Word matching**: the regex `/[A-Za-z][A-Za-z0-9_-]*$/` on
   text-before-cursor (inner and trailing hyphens admitted — hyphenated
   compounds are single candidates per spec 04 rule 4b, so mid-compound
   continuation queries the compound prefix: `load-b` → fragment
   `load-b`, never `b`; leading hyphens never enter a fragment —
   `--flag` yields fragment `flag` and the `--` survives insertion),
   effective from **1** typed char (see
   "Auto-open" above; `config.threshold` is inert). Fires **everywhere** —
   any word start, any context, not just after whitespace. This is
   settled: we never gate on position because the menu never interferes
   with typing (see invariants).

Priority: trigger-char match wins; otherwise word-fragment match;
otherwise `return current.getSuggestions(...)` untouched (path/slash
completion must keep working exactly as before, including inside quoted
paths).

Case-insensitive **anchored fuzzy** match (04 — first char exact,
subsequence after, threshold-gated, tier-ranked); insertion uses
candidate display casing.

**Match gates per mode (2026-10 owner rules; 04).** Word matching is
anchored-only PLUS the zero-result tier-0 fallback: one anchorless
contiguous-run pass (fragment ≥ 3, score 85 − 40·runStart/len,
threshold-gated) when — and only when — the anchored scan returns
nothing. Trigger-char matching is the loose mode: tier-0 runs always
consulted (no zero-result precondition; `#query` →
`src/core/query.ts`) and scattered tier-1 visible (`#` default
threshold 45 vs ambient 60; an explicit `fuzzThreshold` overrides
both modes). Successor chaining stays anchored everywhere — tier-0
matches never arm or extend a chain.

## Debounce, flicker, and the Tab contract

Four interacting rules, implemented in the provider:

0. **Tab only ever completes — it never opens anything.** A single Tab
   keypress, when a live suggestion set exists (computed synchronously,
   whether or not the debounced popup has painted it), completes the
   **selected** item — or the **top** item if none is selected — immediately.
   (Widget path: the proxy consumes Tab while the line is visible and
   inserts the highlighted word — exactly this rule. Fallback path:
   the forced single-item return below.)
   Tab must never open, toggle, summon, or expand the menu. Menu visibility
   is driven exclusively by typing: the menu opens automatically on the
   1st char of any word matching a candidate, on the 1st char after the
   trigger char, and at the zero-char chain offer (see chained
   completion). There is no manual open gesture of any kind, and
   completion is always exactly one keypress.

1. **Synchronous search, every keystroke.** `getSuggestions` runs the store
   query (< 1 ms) on every call and caches the result set. Tab resolves
   against this live result — **never gated by the debounce**. (Known minor:
   tab may insert a top item before the popup painted it; accepted, see 01.)
   Tab resolves to a completion, never to a menu-open action.
2. **Display debounce: 100 ms — and an OPTIONAL hesitation gate on
   first appearance (`menuDelayMs`, **default 0 = OFF**).** Suggestions
   are
   *returned* to pi immediately from the live query, but:
   - First appearance: with `menuDelayMs: 0` (default) the menu paints
     immediately at the word-start query — the auto-open behavior. A
     non-zero value arms a hesitation gate: while the menu is CLOSED,
     a word-completion paints only when the keystroke that triggered
     the query arrived ≥ `menuDelayMs` after the PREVIOUS keystroke
     (typing with gaps under the threshold never pops the menu).
     CALIBRATION HISTORY (binding): the gate was built to stop
     constant popping that was actually caused by stuck chain offers
     and relief-word clutter (both since fixed). Thresholds 150 ms
     (still popped) and 300 ms (never popped) both failed against
     real typing — the owner's word-boundary gaps straddle any fixed
     value, and because a word's first-letter query is its ONLY one
     (pi-tui asks once per word), suppression is permanent per word.
     Default is therefore OFF; the knob stays for owners with a
     measured pause length. If popping ever returns as a complaint,
     instrument real keystroke gaps before picking any value —
     thresholds chosen without measurement failed twice (150, 300).
     Keystroke times come from the editor
     proxy's input clock; without an editor factory the gate degrades
     to query-gap timing (rarely suppresses). Explicit intent —
     trigger-char results and armed-chain successors — bypasses the
     gate and shows immediately. Forced (Tab) requests are unaffected
     (rule 0/1.5). `menuDelayMs: 0` restores the pre-2026-09 immediate
     first paint.
   - Subsequent set changes: the provider suppresses non-empty result
     *sets* that differ from the currently displayed set within 100 ms
     of the last paint. Implementation: timestamp of last visible set;
     if a new set arrives < 100 ms after paint, schedule the swap on a
     100 ms timer; if another keystroke supersedes, replace the pending
     set. The menu thus updates at most every 100 ms, between
     keystrokes.
3. **Flicker hysteresis.**
   - **Empty = invisible.** Zero candidates → return empty/delegate; the menu
     never renders. (Inherited from built-in behavior; assert in tests.)
   - Once visible, the set only ever **narrows, replaces, or closes** — a
     narrowing keystroke (`zend` → `zendk`) must not close-and-reopen.
   - Close events: disqualification (no candidates), cursor move, escape,
     space. A close followed by a qualifying keystroke within 200 ms re-opens
     fresh (no stale set).

### Startup restore gate

History replay (05) runs in the background after `session_start`, and
pi-tui asks the provider exactly once per word — so a word queried
while the store is still replaying got zero candidates and never
re-asked: its menu was permanently missing until retyped (observed:
"first typed word after restart missed its menu"). The provider stack
carries a bounded startup gate (`createStartupGate`, src/pi/provider.ts):
queries racing an unfinished replay wait for the replay's settled
signal (`restoreFromHistory` onSettled — fires exactly once on
completion, abort, or error) or **≤ 500 ms**, whichever comes first.
Effect: the first typed word's menu is at most ~500 ms late instead of
missing. Fresh sessions (no replay) resolve the signal immediately —
the gate is a no-op there. Forced (Tab) requests wait under the same
bound during that window only; the synchronous-query Tab contract
(rule 1) applies to the steady state, which is unchanged.

### Tab-open gesture: root cause (traced) and mitigation

(FALLBACK PATH ONLY — on the widget path Tab is consumed by the editor
proxy before this editor branch can run, and no provider answers word
fragments, so no stock menu can open for them; the bug class is
structurally absent there.)

The "Tab opens the menu" gesture originates in **pi-tui's editor**
(`components/editor.js`), not in hapax:

- **Tab while the menu is open** → completes the selected item via
  `applyCompletion` (one keypress). Already correct.
- **Tab while no menu is open** → `handleTabCompletion()` →
  `forceFileAutocomplete(true)` → `requestAutocomplete({ force: true,
  explicitTab: true })` → `getSuggestions(lines, line, col, { force: true })`.
  In `runAutocompleteRequest` the editor then branches on the result:
  - `items.length === 1` → it **applies the completion immediately**
    (single-item fast path — one keypress, no menu).
  - `items.length > 1` → it **opens the menu** in state `"force"`.

hapax ignored `options.force` and returned its full ranked word set
(> 1 item), so a Tab pressed before the debounced popup had painted —
or after a set change — landed in the menu-open branch. That is the bug.

**Mitigation (extension-only; no pi-tui changes required):** in
`getSuggestions`, when `options.force === true` AND a hapax fragment is
live (threshold word, trigger char, or armed-chain word start), return a
**single-item** set: the top-ranked item per 04 ranking (during an armed
chain, the top successor). pi-tui's existing single-item fast path then
applies it in the same keypress. Rules:

- The forced single-item return bypasses the 100 ms display debounce
  (forced requests are undelayed by design); always return the live top
  item.
- When hapax has no live fragment (path/slash contexts), delegate to
  `current.getSuggestions(...)` passing the options object through
  unchanged, so stock path/file completion keeps its native Tab behavior.
- Empty live set on force → return empty; the editor cancels and renders
  nothing (stock behavior for "no completion available").
- Verify against pi-tui updates: this leans on the
  `force && explicitTab && items.length === 1` branch; if pi-tui ever
  changes that contract, the mitigation needs revisit (the zero-char
  chain offer and auto-open rules are unaffected).

### pi-tui contract dependencies (re-verify on upgrades)

Four runtime contracts are leaned on by the FALLBACK path (marked as
PINs at their consumption sites in `src/pi/provider.ts`); none is
enforced by types. The widget path leans instead on the editor-proxy
composition rules (never mutate shared instances — the v1 crash
lesson below) and its own render surface below the editor. On any
pi-tui upgrade, re-verify each:

- the single-item forced fast path (`force && explicitTab &&
  items.length === 1` applies the completion without opening a menu);
- trigger-char branch shadowing (letters registered ⇒ the stock
  letter-continuation branch is unreachable);
- one-query-per-word while the menu is closed (the word-start request
  is that word's only one — the startup gate exists because of it);
- the editor's space-updates-open-menu flow (close-on-space depends on
  being consulted at trailing space).

## Never-hijack rules (acceptance-critical)

- No key handling outside `applyCompletion`/Tab semantics — with the one
  sanctioned exception of the Enter-submits proxy (below), which cancels
  hapax's own menu and alters no text.
- **Close-on-space (2026-09, "stuck file menu" fix):** a NON-forced
  query at a plain trailing space — no `@`, no `/` in the text before
  the cursor — returns null (menu closes) instead of delegating (widget
path: the line hides at trailing space by its own state machine). pi's
  stock provider treats text-ending-in-space as the start of file
  completion (`extractPathPrefix` returns `""` → the whole cwd
  listing); in stock pi that is reachable only through deliberate
  flows (Tab-forced file menu, `@` attachments), but a hapax menu open
  at a word delegated straight into it on space and got REPLACED by a
  file listing nobody asked for. Forced (Tab) requests keep native
  delegation; `@`/`/`-bearing text keeps stock behavior; the armed
  chain's zero-char offer (evaluated earlier) is untouched.
- **Tab never opens the menu.** Menu opening is automatic (typing-driven)
  only: 1st-char word match, 1st char after the trigger char, or the
  zero-char chain offer. There is no manual open gesture; Tab completes,
  full stop.
- Fallback path: Escape, arrows, backspace, space behave exactly as
  stock pi. Widget path: arrows and Escape are consumed only after
  the list is entered (boundary pass-through above moves the caret
  on the same press); backspace and space behave as
  stock.
- Tab with no live suggestion set passes through as a literal Tab.
- The user can type an entire session and never trigger a menu for common
   words: `the`, `context` are rank-rejected; conjugations of common words
   (`deleted`, `lists`) are guard-rejected; zero-candidate queries never
   render anything.

## Enter always submits (editor proxy)

pi-tui's stock `handleInput` handles the autocomplete branch BEFORE the
submit branch: while any menu is open, Enter accepts the highlighted item
and the submit branch never runs (slash menus are special-cased to
accept-then-submit; word menus just swallow the key). With auto-open
menus this is disqualifying: finish a word that prefixes a candidate,
press Enter to send, and the candidate gets inserted instead. Policy
(shell convention — fish, zsh): the completion menu is advisory, **Tab
is the accept key, Enter ALWAYS submits.** This is non-negotiable for
this extension.

Mechanism (`src/pi/editor.ts`): hapax captures the editor factory set by
any extension (pi-vim, split-editor, … — the documented capture-previous
composition) and returns a **Proxy** around the factory's instance:
`handleInput` is the only overridden member — when the configured submit
key arrives while a **non-slash** menu is open, it cancels the menu
before delegating, so the inner editor's own submit branch handles that
same keystroke. Everything else (get/set/has, functions bound to inner)
forwards verbatim; `then` is undefined so the proxy is never a thenable.
Slash menus keep stock accept-and-submit. No text is ever altered; the
guard body is fully defensive (worst case inert, never broken).

**HISTORY — v1 monkey-patch crashed (recorded so it never returns):**
v1 patched `handleInput` as an own property on the constructed editor
instance. Sibling wrappers forward keystrokes with DYNAMIC reads
(split-editor: `this.inner.handleInput?.(data)`), so the mutated
property cycled: patch → captured forwarder → dynamic read → patch → …
= `RangeError: Maximum call stack size exceeded` (reproduced live with
pi-vim + split-editor + Shift+Tab). Lessons, both binding: (1) NEVER
mutate a shared editor instance — compose with a forwarding proxy that
leaves the inner untouched (the pattern split-editor itself uses);
(2) any fix here must be verified against the real extension stack
(pi-vim + split-editor + pi-nvim-bridge), not unit tests alone.

Limitation: pi does not expose its stock editor to extensions
(`getEditorComponent()` is undefined until an extension sets one), so
the proxy installs only when an editor factory exists. In a
stock-editor session pi's Enter-accepts behavior stands; the universal
fix belongs upstream in pi-tui (non-slash confirm → cancel + fall
through, exactly as this proxy does).

## M2: chained completion

State machine, armed only via Tab acceptance of a whole-word candidate:

```
idle ──Tab accepts word W──► armed(W)
armed(W):
  - word start (cursor at the empty next word, ZERO typed chars) → offer
    the top successor from the successor index immediately (lookup W →
    top-3, ranked by count). No trigger char, no threshold, no typed
    fragment needed — the successor IS the top result before the user
    types anything. This is the entire meaning of "phrase completion".
  - ONE-SHOT GRANT (2026-09): the immediate offer is granted for exactly
    ONE word per acceptance. Typing through that offer without accepting
    disarms at the next word boundary — the normal path (under the
    hesitation gate) answers from there. Rationale: chain results carry
    the display layer's intent bypass, so an indefinitely-armed chain
    popped immediate menus at EVERY word start for the rest of the
    message after a single Tab (live-reproduced; fixed same day).
    Acceptance re-arms with a fresh grant: Tab→offer→Tab→offer flows
    exactly as before.
  - typed chars filter the live successor list with the same
    anchored fuzzy matcher (04) as a membership gate; ranking within a
    chain stays SUCCESSOR-COUNT-based (the successor index's counts,
    not sessionCount — chains are bigram-driven by design); threshold
    stays 0 for the duration of the chain
  - Tab during armed (selected item, or top if none selected, per rule 0)
    → insert it (ONE word), transition armed(next)
  - Any non-Tab key that disqualifies (space, escape, punctuation) → idle
  - Typing continues to filter normally (chain never blocks typing;
    it only feeds the suggestion set)
  - No successors for W → idle (normal threshold matching resumes)
```

- Chaining arms only from our own candidates, never from path completion.
- Chain offers render on the widget line (or fallback menu) like any
  result set — with the description column retired there is no `chain`
  marker; the offer is visually indistinguishable from a typed match.
  On the widget path, arming happens at the widget's Tab-insert (the
  applyCompletion equivalent) and successor offers publish through the
  visibility machine's intent bypass.
- The chain state resets on every `before_agent_start` (new user turn).
- Trigger-char completions also arm the chain (they're whole-word
  insertions).

## Result item shape

A result item is **one word**: the candidate display casing. On the
widget path an item carries NO metadata — no `Session xN` frequency,
no provenance (`chain`), no rank-group markers. The line is words,
`" | "` separators, and one highlight, nothing else. (Frequency and
provenance still drive ordering; they just aren't rendered.)

On the FALLBACK path, items are `AutocompleteItem`s: `value` = the
string to insert — **always exactly one word** (candidate display
casing); multi-word items are forbidden (invariant; see 06); `label` =
same; `description` = optional short provenance (e.g. `session x12`
— ASCII `x` by item contract, never U+00D7 `×`)
or `chain`) — keep minimal; do not clutter.

Max `maxSuggestions` (default 8) items per result set, ordered per 04
ranking (including 04's plural pruning: an exact key/key+`"s"` pair
in the same result set yields only the singular). Every item is a
single word, including during chains (06, 07); the widget line
additionally truncates to terminal width, lowest-ranked dropped
first.
# 08 — Configuration

## Config surface (deliberately tiny)

pi has no extension-settings API for this; the extension reads a plain JSON
config file itself. Load order (later wins):

1. Built-in defaults (in code).
2. `~/.pi/agent/hapax.json` (user-global).
3. `.pi/hapax.json` (project-local, if the project is trusted).

Malformed file → warn once via `ctx.ui.notify(..., "warning")` (pi's
notify levels are `"info" | "warning" | "error"` — there is no
`"warn"`), fall back to
defaults, continue running. Missing files are normal.

## Schema

```jsonc
{
  "triggerChar": "#",        // single non-alphanumeric char; "" disables
                              // trigger mode entirely. "@", "/" and '"'
                              // are RESERVED: pi's stock @-mention,
                              // path/slash and quoted-path contexts own
                              // them, so the trigger could never fire —
                              // load emits one warning (below); word
                              // matching is unaffected.
  "threshold": 2,            // RETAINED BUT INERT in the live editor:
                              // pi-tui only requests at word starts, so
                              // matching is effectively 1 char (see 07).
                              // Kept for schema compatibility. 1 | 2 | 3.
  "maxSuggestions": 8,       // 1–20
  "rejectCommonness": 12,    // 1–255: dictionary-attestation FLOOR of
                              // the length-conditioned reject curve R_eff
                              // (04): flat through 8 chars, sqrt ramp to
                              // admit-all at 20 — higher = looser, the
                              // whole curve scales from this floor.
                              // Governs admission AND the conjugation
                              // guard's stem comparisons (via R_eff).
                              // Probe any word first: node
                              // tools/calibrate-bands.mjs <words...>
                              // prints q + verdict (lowercase and
                              // Capitalized). Default: the baked constant
                              // in src/core/score.ts.
  "fuzzThreshold": 60,      // 0–100: minimum fuzzy match score (04) for a
                              // candidate to enter a result set. Higher =
                              // stricter; 100 = exact-prefix-only mode.
                              // Per-mode defaults (2026-10): 60 ambient
                              // (word matching), 45 under the trigger
                              // char (scattered tier-1 visible there);
                              // an explicitly set value overrides BOTH.
                              // Default is the calibration starting
                              // point (09 tuning protocol), imported from
                              // the baked constant in the query module
                              // automatically — same pattern as
                              // rejectCommonness.
  "menuDelayMs": 0,          // 0–2000: hesitation gate for the menu's
                              // first appearance. DEFAULT 0 (OFF): the
                              // popping the gate was built to stop turned
                              // out to be chain-offer stickiness and
                              // relief-word clutter (since fixed), and
                              // calibrated values (150, 300) never matched
                              // real typing — the owner's word-boundary
                              // gaps straddle any fixed threshold. Set to
                              // your measured pause length if flow-popping
                              // ever bothers again.
  "enableChaining": true,    // M2 flag; gates the successor-index chain
                              // layer only. "enablePhrases" is accepted as a
                              // deprecated alias for this key. Word
                              // completion is unaffected either way.
  "debug": false             // enables /acwords command + store dump
}
```

Validation: clamp/repair invalid values to defaults (log when repaired).
`triggerChar` must match `/^[^\w\s]$/` or be empty. `threshold` clamped to
1–3. `maxSuggestions` clamped 1–20. `rejectCommonness` clamped 1–255.
`fuzzThreshold` clamped 0–100. `menuDelayMs` clamped 0–2000.

Reserved triggerChar (2026-09-30, validation Issue 2): `@`, `/` and `"`
pass the schema but are structurally dead — `classifyStockContext`
(provider.ts) unconditionally routes `@frag` to the stock mention
context, `/`-bearing text to path (and a line-leading `/` to the
slash-command context), and text under an unclosed `"` to quoted-path
BEFORE the trigger branch is consulted, and that stock delegation is
deliberately config-independent (BUG-001). A user who sets one of these
gets a silently non-functional trigger (word matching still works, so
the failure is invisible). `loadConfig` therefore checks the EFFECTIVE
value once, after all layers merge, and emits one `"warning"` notify
naming the colliding char and the stock context that owns it; a later
layer overriding the collision away silences it. The value still applies
(trigger mode is merely dead, never half-dead); the warning is advisory,
not a rejection.

## Not configurable (by settled decision)

- Salience weights, the mid-frequency band (20; retired 2026-10 — both
  conjugation-guard tiers ride the length-conditioned R_eff), the
  proper-noun relief ceiling (12, retired-in-place), the
  length-gradient curve shape (sqrt, 8-char floor hold, 20-char
  admit-all — 2026-10), shape-gate secret rules, the conjugation-guard
  suffix set, eviction cap, debounce intervals, popup timing, and the
  fuzzy scorer's tier constants (04 — tier BOUNDARIES are semantics,
  not tuning). These are
  internal tuning constants — the tuning protocol lives in 09, not in
  user config. The admission floor and the fuzzy admission threshold
  are the TWO deliberate exceptions (`rejectCommonness`,
  `fuzzThreshold`): dictionary attestation is near-disqualifying
  evidence at short lengths (2026-09 owner rule — "commit hashes and
  variable names, not half of the english language"; length-conditioned
  2026-10 — see 04); the knob exists so the owner can loosen or tighten
  against real sessions without a code edit (fuzz threshold,
  2026-10: a large store with loose fuzzy settings bloats the
  suggestions). The
  config default imports score.ts's baked REJECT_COMMON_THRESHOLD
  automatically — no separate default to keep in sync.

## Debug command (`/acwords`, registered when `debug: true`)

Read-only inspection for development: dumps top-50 candidates by salience,
store size, rank-group histogram, shape-gate rejection counts, and (M2)
a successor-index sample. Output via `ctx.ui.notify` or the
widget API; never logs message bodies (store holds words + counters only).
**Complete list (2026-09):** every invocation also writes the FULL store
to `/tmp/hapax-store.txt` — one line per word (key, display, count,
group, proper/typed flags), count-desc then content order — and the
notify footer names the path. The popup caps at 50; the file does not.

Why the popup/menu is capped at all: `maxSuggestions` (default 8,
1–20) is the per-query return cap — a menu-height decision (04), not a
store cap; pi-tui additionally renders only `autocompleteMaxVisible`
rows (a pi setting) and pages the rest with ↑/↓. The store itself
holds up to 20,000 words (06).
# 09 — Testing and Acceptance

## Unit tests (per module)

**segment.test.ts**
- camelCase splits: `fixRoundingError` → whole + `fix`(dropped, len<4) +
  `Rounding`, `Error`; `HTTPServer` → `HTTP` + `Server`.
- snake_case: `session_token_valid` → whole + `session`, `token`, `valid`.
- Hexish: `f3a9c2e` captured; `123456` (no letter) not; 41+ chars not.
- CJK run skipped; ASCII resumes after.
- Hyphenated compounds are ONE token (2026-09 rule 4b): `state-of-the-art`
  → single token; apostrophes still split (`don't` → `don`); `--flag`/`-v`
  never form tokens. Threshold fragments admit inner/trailing hyphens
  (`load-b` → prefix `load-b`).
- Path-shaped runs are ONE token (2026-10 rule 4d): `src/core/query.ts`
  (2 interior slashes), `/home/user/projects/hapax` (key trims the
  leading `/`, display keeps it), `docs/architecture.md` (slash+dot),
  `../tools/build.mjs` (leading `../` edge-trimmed from the key,
  preserved in display), `example.com/a/b` (URL host+path). Contained
  base/hexish/filename tokens are absorbed (`query.ts` never surfaces
  alone inside a path span). Line/col trim: `src/foo.ts:42:13` →
  `src/foo.ts`; `4:36` and `localhost:8080` keep their colons. Guards:
  `and/or` (single slash, no dot) is NOT a token; interior `..`
  (`a/../b`) rejects whole; path key cap 96 (96 admits, 97 shreds).

**shapeGate.test.ts** (each rule is a case)
- Accept: `zendesk`, `lwlock`, `NREL`, `f3a9c2e`.
- Reject: `aaaaa`, `aaaaaaa`, `sk-abc123DEF456...`, `ghp_...`, `eyJhbG...`,
  20+ pure hex, `qqqxxxzzzvvv` (consonant run), `ab` (low entropy — since
  the 2026 floor drop it is length-legal; every 2-char key dies at
  entropy, max H = 1.0), single chars (too short), 65+ chars (base class; path class rejects
  above 96, rule 4d), base64 ≥ 24 mixed.

**score.test.ts**
- Admission is length-conditioned (2026-10 gradient; assert relative to
  the imported constants/R_eff, not absolute quants): floor hold —
  q ≥ 12 rejects at any length ≤ 8; sqrt ramp 9–19 (boundary probes,
  e.g. q=82 admits / q=83 rejects at 9 chars); admit-all at len ≥ 20;
  every attested admission lands at GROUP 1 (flat — the old group-2
  band stays dead); absent → group 0; the `rejectCommonness` override
  moves the floor and the curve scales from it.
- Proper-noun relief stays retired: the ceiling equals the floor band,
  so no capitalized table-reject ever relieves — under the 2026-10
  ramp, long capitalized words that admit do so via R_eff at group 1,
  not relief.
- Conjugation guard: inflection whose stem is reject-common rejects
  (any q of the word); absent word + mid-band stem rejects; e-restoration
  and doubled-consonant stems match; properName drafts skip the guard;
  stem comparisons ride R_eff(len(word)) (2026-10) — `uploads` (7c,
  stem q=38) rejects, `configurations` (15c, stem q=26) admits; the
  rejectCommonness override moves the floor the curve scales from.
- Salience arithmetic: construct store entries, assert exact values for
  hand-computed cases (frequency term, recency decay at τ=20, sticky
  userTyped, properName, rarity bonus).
- Eviction ordering (salience × slower τ=50 decay) — menu ordering is
  NOT salience (see below).

**query.test.ts**
- Anchor: the fragment's first char must equal the candidate's first
  char (`esk` never matches `zendesk`; `roun` → `Rounding` still works
  via sub-word candidates); case-insensitive throughout.
- Tier classification: exact prefix (3) / contiguous tail (2: `zsk` →
  `zendesk`, `zlock` → `z_lwlock`) / scattered (1: `hrp` →
  `handleResponseProxy`).
- Admission score + threshold: below-`fuzzThreshold` matches never
  render; `fuzzThreshold: 100` = exact-prefix-only mode; score
  arithmetic per 04's formula for each tier.
- Ranking: tier descending always (a 1-count exact-prefix word
  outranks a 40-count scattered match, which outranks any tier-0
  anchorless run); sessionCount descending within
  a tier (counts reorder ONLY same-tier neighbors); shorter key, then
  byte-lex, as final ties; zero-fragment (`#` alone) = sessionCount
  desc then ties; plural pruning still runs before the limit slice.
- Tier-0 anchorless fallback (2026-10): the contiguous run matches
  ANYWHERE in the key (`esk` → `zendesk`, `query` →
  `src/core/query.ts`); fragment floor 3; score 85 − 40·runStart/len
  (position-gated at the default 60); fires ONLY when the anchored
  scan returns zero — a non-empty anchored result is byte-identical
  to pre-tier-0 output; `#` mode consults tier-0 unconditionally AND
  surfaces scattered tier-1 at its 45 default (`#cfg` → `config`);
  an explicit fuzzThreshold overrides both mode defaults; successor
  chains arm/extend on anchored tiers only.

**store.test.ts**
- Upsert merge semantics (count, ordinals, sticky flags, rankGroup min).
- Eviction: insert 20,001 → exactly one eviction pass (a full 256-victim
  batch, per spec/06's batch-of-256 rule), dropping the lowest
  evictionScore victims; userTyped survives.
- Prefix index rebuild-after-dirty correctness.

**dictionary.test.ts**
- Round-trip: build a tiny table in-memory (10 words), write format, load,
  assert every lookup, absent → null, no allocation in lookup (optional
  via node `--expose-gc` smoke test).
- Corrupt file (bad magic, truncated) → load throws.

**provider.test.ts (fallback path)**
- Trigger regex: `#`, `#ze`, mid-line `foo #ze`, `foo#ze` (no match — needs
  start/whitespace), two `##` → no match.
- Word matching: 1-char fragment answers (auto-open contract — pi-tui
  only asks at word starts, effective threshold 1); case-insensitive
  `nrel` → `NREL` insertion casing.
- Enter-submits proxy (test/editor-enter.test.ts): Enter + open word
  menu → cancel then delegate exactly once; slash menus, closed menus,
  non-submit keys untouched; the inner instance is NEVER mutated (v1
  recursion regression pin); proxy get/set/has forwarding, the
  thenable guard, and the onKeystroke input-clock hook (fires for every
  input event; a throwing hook never breaks input).
- Startup gate (test/startup-gate.test.ts): queries racing an
  unfinished replay wait for settled then query; the wait is bounded
  (≤ maxWaitMs); settled gate is pure pass-through; a rejected replay
  promise never wedges it; restoreFromHistory's onSettled fires
  exactly once (finish, abort, empty).
- Chain one-shot grant (test/chain.test.ts): typing through the granted
  offer disarms at the next word boundary (normal gated path answers);
  same-word narrowing (incl. backspace) keeps the chain; acceptance
  re-arms with a fresh grant.
- Zero candidates → delegate/empty, never a menu.
- Debounce: two rapid set updates → only one swap at +100 ms; Tab mid-debounce
  resolves the live (undebounced) top item.
- Tab-only-completes: Tab with a live set completes the selected (or top)
  item and never opens/toggles a menu; the menu appears automatically on
  the 1st char of a matching word and on the 1st char after the trigger
  char, with no manual open gesture of any kind; completion is exactly one
  keypress. Includes the forced path: `getSuggestions` with
  `force: true` + live fragment MUST return exactly one item (the live
  top / chain successor) so pi-tui's single-item fast path applies it —
  assert Tab-before-paint completes rather than opening the menu.
- Hysteresis: narrowing keystroke must not emit close+reopen (assert via
  recorded provider emission sequence).
- Delegation: no fragment → `current.getSuggestions` called with unchanged
  args (path completion intact).

**widget.test.ts (primary path, M3)**
- Visibility machine: word-start fragment + candidates → line shows;
  trailing space (no `@`/`/`) → hides; path/slash/`@` contexts never
  show; zero candidates never render.
- Key handling (editor-proxy double): ←/→/↑/↓ all navigate once the
  list is entered; ↑/← on the first word of an UN-interacted
  generation FORWARDS to the editor — the line dismisses +
  suppresses AND the caret moves on that same press (one-press
  plain-pi parity; disqualification close does NOT suppress); →/↓
  with no word to navigate (one-word line, un-interacted) forwards
  verbatim and the line stays; Tab inserts the highlighted word
  synchronously (never debounce-gated); Enter dismisses then
  forwards (submits); every other key forwards verbatim; the inner
  instance is NEVER mutated (v1 regression pin).
  Interaction carousel (2026-10; spec 07): the first
  highlight-MOVING arrow press (→/↓ entering an un-interacted
  multi-word line) marks the generation interacted — from then on
  ↑/← on the first word wraps to the LAST and →/↓ on the last word
  wraps to the FIRST (the clamp is retired — unreachable); a new
  result set resets the flag with the highlight and re-arms
  boundary pass-through; a pass-through press never sets the flag
  (a one-word line therefore never becomes interacted); plain
  Escape is unchanged at every state.
- Insertion: replaces the word-regex span or `#fragment` with the
  candidate's display casing.
- Highlight resets to top on every set change; debounce/hysteresis
  and the startup gate carry over to the widget.

## Integration acceptance (manual or scripted via pi)

1. **Happy path:** session discussing `Zendesk` + `lwlock`; type `ze` → menu
   offers `Zendesk`; Tab inserts `Zendesk` (cased). Type `#l` → `lwlock`.
   (M3 widget: the offer is one line below the input — `Zendesk | …`;
   arrows move the highlight once the list is entered; ← on an
   un-entered list moves the caret on that same press and the line
   dismisses with it — boundary pass-through, one press; entered
   lists carousel at both edges and Escape is the exit.)
2. **No-hijack (amended 2026-10):** type ordinary prose continuously;
   keystrokes land verbatim, no menu for common words WITH ANCHORED
   MATCHES — the zero-result tier-0 fallback MAY surface one-shot
   contiguous-run cousin menus (said→unsaid class, ~5–20% by length,
   narrowing away as typing continues; 04); Tab with no selection =
   literal tab. While the result line is visible only arrows/Escape/Tab
   are consumed — and arrows only once the list is entered (boundary
   pass-through otherwise: the caret moves on the same press).
3. **Restore:** `/resume` a 100k+ token session; store rebuilt in background
   (< 100 ms total); completions available within the first second.
4. **Compaction:** trigger compaction (long session + `/compact`); store
   survives; previously admitted words still complete.
5. **Secrets:** paste an API key into a user prompt; key never appears in
   suggestions afterwards (shape gate).
6. **Path completion regression:** quoted path completion, slash commands,
   and `@`-mention behaviors identical to stock pi.
7. **Conversational path completion (2026-10, rule 4d):** a path that
   appeared in conversation (user-typed or model output) is offered when
   its FIRST segment is typed — `sr` → `src/core/query.ts`, Tab inserts
   the whole path; an absolute path inserts with its leading `/`. Once a
   `/` precedes the cursor, stock pi file completion owns the rest
   (item 6 unchanged).

## Live verification technique (binding)

Unit tests have repeatedly encoded wrong platform models — the editor,
the trigger plumbing, and the menu lifecycle behave differently in a
real TTY than in test doubles. UI-layer changes are verified live, not
by unit tests alone:

- Run an ephemeral instance: `pi --no-session` inside a tmux pane
  (pi's TUI needs a real TTY — piping stdout makes it exit silently).
  Seed the store by submitting one short user message, then Ctrl+C the
  turn.
- Drive keys with `tmux send-keys`, one char at a time with 0.08–0.12 s
  sleeps between them. A whole string sent at once is a burst, and
  bursts CANCEL in-flight autocomplete queries — different behavior
  from human typing, and the source of at least one false conclusion.
- Verify visible state via `tmux capture-pane`.
- Temporary instrumentation (`appendFileSync` behind an env var) in
  `src/pi/provider.ts` is the sanctioned way to observe internal state
  live; two bugs invisible to every test were found this way. Remove
  instrumentation before committing. The M3 one-line widget is the
  deepest UI-layer change yet (own rendering + own key handling): live
  verification against the real extension stack (pi-vim +
  split-editor) is mandatory before acceptance — the v1 proxy crash
  (07) is the precedent.

## Performance gates (CI-scriptable micro-benchmarks)

| Gate | Limit |
|---|---|
| 20k-candidate anchored-fuzzy query (first-char bucket + tiers + frequency sort + top 8) | < 1 ms p99 |
| Tier-0 anchorless fallback full-store pass (fires only on empty anchored result; also `#` loose-mode scans) | < 3 ms p99 |
| Dictionary load + full lookup sweep of 20k words | < 60 ms |
| Ingest 800 KB synthetic session text (≈ 02's 300k-token restore) | < 180 ms CI bound, yields every ≤ 64 KB |
| Steady-state heap delta (dict + store) | < 6 MB |

Benchmarks run with a synthetic dictionary fixture; numbers asserted loosely
(CI variance) — hard regressions (> 3× budget) fail.

Ingest (gate c) note — 2026-09-30, validation Issue 4: the original
< 60 ms headline was never met by the shipped implementation (healthy
baseline ~174–187 ms; ~92–104 ms after the admission-memoization work).
The operative user-facing budget is 02's restore figure — full
300k-token session < 100 ms total — which the 800 KB pass meets
(~97 ms); the CI gate enforces the 3× variance allowance (180 ms) as
the hard line. Do not re-tighten this row to 60 ms without
re-optimizing the ingest path first.

## Tuning protocol

Tuning surfaces: the runtime `rejectCommonness` and `fuzzThreshold`
config knobs (08 — the
floor of the length-conditioned curve; the anchored-fuzzy admission
threshold), and
the baked constants — the length-gradient parameters (floor R=12,
floor-hold 8, admit-all 20, sqrt shape — 2026-10), the retired mid-band
and relief constants, conjugation-guard suffix set, salience weights
(2.0/3.0/1.5/0.8/1.0), fuzzy scorer tier bases/penalties (04 — tier
BOUNDARIES are semantics, never runtime-tunable; only the threshold
is). No phrase multipliers exist (the M2 successor
index has none). Protocol: change one constant (or the knob), run the
acceptance suite, A/B against a fixed 3-session corpus fixture
(`test/fixtures/sessions/`) checking precision@8 by hand-labeled expected
completions. `tools/calibrate-bands.mjs` is the measurement probe — word
verdicts, band populations, drift assertions; run it after any retune
or dictionary regen. No telemetry exists; tuning is fixture-driven by
design.

## Definition of done — M1

All unit tests green, integration items 1–6 pass, performance gates pass,
no persistence files written anywhere (assert store dir untouched), `pi
--check` (or lint) clean.

## Definition of done — M2

M1 done plus: successor-index chaining state machine with ZERO-typed-char
successor offers, live successor filtering, chain resets on
`before_agent_start`, the one-word invariant (no multi-word item is ever
offered — asserted in tests), and raw-text-adjacency window breaks:
commas, quotes/brackets/backticks, digits, non-word characters, intervening
words (stopword bridging forbidden), newlines. Integration item 7
(re-themed 2026-09: the PRD's `National` → `Renewable` → `Energy` →
`Laboratory` walk cannot run at the shipped floors — `national` (q=90)
and `energy` (q=94) reject at the floor length, so the bigram never
forms; the inversion is pinned in test/acceptance.test.ts, the re-themed
journey in test/fixtures/sessions/RESULTS.md — re-themed AGAIN
2026-09-30, validation Issue 1: the first re-theme's `Acme`/`Zephyr`
walk died the same way, `acme` (q=17) and `zephyr` (q=22) are
dictionary-attested and reject at the floor length): accept `Zorp` →
with zero additional typed chars `Zephra` is the top result → Tab →
`Noria` → Tab → `Inverter`.

## Decision log (all settled)

| Topic | Decision |
|---|---|
| Rarity source | Known-common-words frequency table (presence = commonness evidence; absence = rare-by-default, shape-gated) |
| Dictionary size | ~50k English frequent words (shipped: 48,802 entries), 8-bit quantized frequency, ~0.85 MB packed binary |
| Scoring | Global commonness (static: admission bands + conjugation guard). Result order (2026-10): match-strictness tier desc → sessionCount desc within tier → shorter key → lex; the pure content-derived order is RETIRED (stability now holds only among equal counts within tiers). Session salience (dynamic) drives store eviction only. Admission reject band is length-conditioned (2026-10): flat floor through 8 chars, sqrt ramp to admit-all at 20; runtime-tunable floor via `rejectCommonness`; remaining constants baked |
| Matching | Anchored fuzzy after the first character (2026-10): the fragment's first char must equal the candidate's first char; the rest is a subsequence. Three strictness tiers (exact prefix > contiguous tail > scattered); admission gated by `fuzzThreshold` (0–100, higher = stricter; 100 = prefix-only). The store's first-char index remains the scan entry, preserving the < 1 ms budget |
| Display | One-line widget (2026-10): hapax renders its own single-line result set below the input — words joined `" | "`, no `Session ×N` column, no descriptions, width-truncated lowest-ranked-first, zero candidates never render. Arrow semantics are two-state per generation (2026-10): UN-ENTERED — ↑/← on the first word dismiss + suppress AND forward the press (one press, caret moves — plain-pi parity); →/↓ with nothing to navigate forwards verbatim; →/↓ entering a multi-word line navigates and ENTERS the list. ENTERED — the cluster is captured and both edges wrap end-to-end (carousel; the clamp is retired/unreachable); plain Escape always dismisses. Every new result set resets to un-entered. Tab inserts the highlighted word; Enter always submits. The vertical stock menu is retained as the FALLBACK where no editor factory exists (dual-path; rejected alternatives: a synthesized single item — loses arrow selection — and upstream horizontal-menu support — no timeline) |
| Long-word admission (2026-10) | R_eff length gradient (04): floor R=12 holds through 8 chars, sqrt ramp to admit-all at 20; every attested admission lands at group 1 (+0.5 rarity bonus); conjugation-guard stems ride R_eff; mid band (20) retired. Chosen by owner measurement: linear 6→20 (~18.9k flips, re-admits the audit's `provider`) rejected; floor-10 (~3.2k) stricter than owner intent; sqrt 8→20 (~10.5k) adopted |
| File-path candidates (2026-10, rule 4d) | Slash-joined path runs are whole tokens (≥2 interior slashes, or 1 slash + dotted component); key trims leading `/`/`~`/`./`/`../`, display preserves them (absolute paths insert with the slash); key cap 96; `:line:col` suffix trimmed; single-slash letter-only paths (`src/core` ≡ `and/or`) a documented gap; mid-path typing still delegates to stock pi file completion |
| Tier-0 anchorless fallback (2026-10) | When the anchored scan returns zero — and only then — one full-store pass matches the fragment as ONE contiguous run anywhere in the key (`esk`→`zendesk`, `query`→`src/core/query.ts`); floor 3 chars; score 85−40·runStart/len, threshold-gated; sorts below tier 1. `#` mode: tier-0 always consulted + scattered tier-1 visible (default threshold 45 vs ambient 60; explicit knob overrides both). Measured cost: ~5% (3c) → ~20% (7c) one-shot prose-cousin menus, owner-accepted; fallback pass budget < 3 ms p99; chaining stays anchored |
| Ingestion | `message_end` events only; roles `user` + `assistant`; assistant text blocks only (no thinking blocks); code blocks inside assistant output included; toolResult excluded entirely |
| Store lifecycle | Per-session, in-memory, survives compaction, no persistence. Rebuild on resume from history (~30–50 ms background for 200k tokens) |
| Trigger | Configurable trigger char (default `#`, 1st-char lookup); word matching effectively at 1 char (widget path: the line opens at word start by its own state machine; fallback path: pi-tui requests only at word starts) — the `threshold` config value is retained but inert (see 07) |
| Popup | First appearance immediate by default; OPTIONAL hesitation gate (`menuDelayMs`, default 0 — 150/300 calibration attempts failed against real rhythm); subsequent set changes display-debounced ~100 ms; synchronous search every keystroke; hysteresis against flicker |
| Phrases & chaining | v2 (M2): one word per completion, ALWAYS. There are no multi-word menu items. "Phrase support" = successor index + chained Tab completion: after a word is accepted, its most-likely successor is the top result with zero additional typed chars. Bigrams form only between raw-text-adjacent admitted words (nothing but whitespace between, same line); any other intervening character or word breaks the window |
| Language | English table v1; CJK runs skipped (known limitation); per-language tables possible later via format versioning |
| Secrets | Shape/entropy gate rejects key-shaped strings (sk-, ghp_, long hex, high digit+symbol entropy). Default-on, no config |
| Telemetry | None |

## Implementation milestones

- **M1 (v1):** dictionary build + packed loader, ingestion pipeline, candidate
  store, trigger char + threshold matching, autocomplete provider with debounce
  and hysteresis. Fully usable tool.
- **M2 (v2):** bigram successor index + chained Tab completion — one word per
  Tab, zero typed chars to see the next word. No phrase menu items, no
  multi-word insertion, ever. Specced in 06/07; implemented after M1 acceptance.
- **M3 (v3):** anchored-fuzzy matching, frequency tie-break ranking, and the
  one-line widget display with arrow selection + boundary pass-through
  (07).
