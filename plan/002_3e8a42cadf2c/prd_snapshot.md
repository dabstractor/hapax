# hapax — Context-Driven Autocomplete Extension

**Status:** Draft v1.0 · **Name:** `hapax`

## Purpose

A pi extension named **hapax** (from *hapax legomenon*, a word that occurs
only once in a corpus — exactly what it harvests) that watches user prompts and final agent output as they enter the
context window, extracts uncommon words / identifiers / proper names, and offers
them as tab-completions in the prompt input box — reusing pi's built-in
autocomplete menu via `ctx.ui.addAutocompleteProvider()`.

## Design invariants (non-negotiable)

1. **Never hijack typing.** No key is ever captured, consumed, or altered except
   Tab while a suggestion is selected. The user's typing experience is unchanged;
   the menu is strictly take-it-or-leave.
2. **Tab is never delayed by UI — and Tab only ever completes.** The top
   suggestion is computed synchronously on every keystroke; the popup may be
   debounced, but a single Tab keypress always resolves the current top or
   selected item immediately. Tab never opens, toggles, or summons the
   menu; the menu opens automatically on the 2nd char of a matching word, on
   the 1st char after the trigger char, or at the zero-char chain offer.
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
useful words, and completes them from 2 typed characters (or 1 character after
the trigger char, default `#`).

## Core definitions

- **Candidate** — a word admitted to the session store, available for completion.
- **Admission** — the decision that a segmented word is worth storing (global
  commonness + shape gates).
- **Salience** — the dynamic per-session ranking score (frequency, recency,
  source, rarity).
- **Trigger char** — a configurable character (default `#`) that initiates
  lookup from the first character after it.
- **Threshold matching** — prefix lookup after N characters of a word
  (default N=2, configurable 1–3), firing everywhere the user types.

## Goals (M1)

1. Extract uncommon words from user prompts and final assistant output.
2. Admit them via a static common-words dictionary + shape gates.
3. Rank them via session salience.
4. Complete them through pi's built-in autocomplete menu with zero typing
   interference.
5. Total memory < 6 MB steady state; query latency < 1 ms; ingest of a
   300k-token session < 100 ms in background.

## Goals (M2)

6. One word per completion, always — no multi-word candidates, ever. The
   only phrase behavior is successor chaining (goal 7).
7. Chained completion: accepting a word arms its most-likely successor for
   zero-additional-typing Tab completion.

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

## UX principles

- The user's typing experience is identical with or without the extension,
  except that Tab occasionally does something useful.
- The menu is a suggestion surface, never a modal, never a key consumer.
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
│   │   ├── query.ts          # prefix search + ranking (pure store queries)
│   │   └── types.ts          # shared core types
│   └── pi/                   # pi extension adapter
│       ├── index.ts          # extension factory, event wiring
│       ├── ingest.ts         # message_end handling, debounce, chunking,
│       │                     #   session-history restore replay
│       ├── provider.ts       # autocomplete provider (trigger regexes,
│       │                     #   debounce, hysteresis, chaining M2)
│       └── config.ts         # config load/merge with defaults
└── test/
    ├── segment.test.ts
    ├── shapeGate.test.ts
    ├── score.test.ts
    ├── store.test.ts
    ├── dictionary.test.ts
    ├── query.test.ts
    └── provider.test.ts       # pi-adapter tests (mock ctx.ui)
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
3. If fragment length ≥ threshold (default 2) or trigger char active: prefix
   search the store, score-sort, return top 8 items.
4. This must complete in < 1 ms. No allocation-heavy work; the store's prefix
   index is maintained at ingest time.

### Popup path (display only)

- The provider returns items synchronously; pi renders the menu. The 100 ms
  display debounce and flicker hysteresis are implemented inside the provider
  (see 07). Tab completion reads the synchronous result directly and is never
  gated by the debounce.

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
| Single keystroke query (prefix + sort + top 8) | < 1 ms |
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

Expected size for 70k entries, avg 7 bytes/word:
420 KB blob + 280 KB offsets + 70 KB scores + 512 KB buckets (128k buckets) ≈
**1.3 MB**.

## Hash and probing

- Hash: **FNV-1a 32-bit** over the word's UTF-8 bytes, XOR-folded with `seed`.
- Bucket index: `hash & (bucketCount - 1)`.
- Probing: linear. On collision, compare `memcmp(word, blob+offsets[idx], len)`
  plus exact length match. Insert until empty bucket (table is pre-sized, no
  runtime inserts).
- Lookup is one hash + ~1.1 probes average (load factor ≤ 0.55): ~100 ns.

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
  array of lowercase keys (rebuilt lazily: marked dirty on insert, re-sorted
  on next query if dirty — restores insert ~20k items once, then binary-search
  per keystroke). Query = binary search for prefix range + gather + salience
  sort of the range + top 8.

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

## Provider integration

Single registration in the `session_start` handler:

```ts
ctx.ui.addAutocompleteProvider((current) => ({
  triggerCharacters: [config.triggerChar],   // default "#"
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
insertion if validation proves a need. Never intercept `input`, never replace
the editor component, never consume keys outside the provider contract.

## Trigger modes

Two lookup modes, both always active:

1. **Trigger char** (default `#`): the regex `/(?:^|[ \t])#([^\s#]*)$/` on
   text-before-cursor. When matched, lookup starts from the **first** char
   after `#` (0-char minimum: `#` alone lists top-salience candidates).
   On completion, `applyCompletion` replaces `#fragment` with the word
   (trigger char is consumed).
2. **Threshold matching**: the regex `/[A-Za-z][A-Za-z0-9_]*$/` on
   text-before-cursor. Fires when fragment length ≥ `config.threshold`
   (default 2; 1–3 allowed). Fires **everywhere** — any word start, any
   context, not just after whitespace. This is settled: we never gate on
   position because the menu never interferes with typing (see invariants).

Priority: trigger-char match wins; otherwise threshold match; otherwise
`return current.getSuggestions(...)` untouched (path/slash completion must
keep working exactly as before, including inside quoted paths).

Case-insensitive prefix match; insertion uses candidate display casing.

## Debounce, flicker, and the Tab contract

Four interacting rules, implemented in the provider:

0. **Tab only ever completes — it never opens anything.** A single Tab
   keypress, when a live suggestion set exists (computed synchronously,
   whether or not the debounced popup has painted it), completes the
   **selected** item — or the **top** item if none is selected — immediately.
   Tab must never open, toggle, summon, or expand the menu. Menu visibility
   is driven exclusively by typing: the menu opens automatically on the
   2nd char of any word matching a candidate (threshold mode), on the 1st
   char after the trigger char, and at the zero-char chain offer (see
   chained completion). There is no manual open gesture of any kind, and
   completion is always exactly one keypress.

1. **Synchronous search, every keystroke.** `getSuggestions` runs the store
   query (< 1 ms) on every call and caches the result set. Tab resolves
   against this live result — **never gated by the debounce**. (Known minor:
   tab may insert a top item before the popup painted it; accepted, see 01.)
   Tab resolves to a completion, never to a menu-open action.
2. **Display debounce: 100 ms.** Suggestions are *returned* to pi immediately
   from the live query, but the provider suppresses non-empty result *sets*
   that differ from the currently displayed set within 100 ms of the last
   paint. Implementation: timestamp of last visible set; if a new set
   arrives < 100 ms after paint, schedule the swap on a 100 ms timer; if
   another keystroke supersedes, replace the pending set. The menu thus
   updates at most every 100 ms, between keystrokes.
3. **Flicker hysteresis.**
   - **Empty = invisible.** Zero candidates → return empty/delegate; the menu
     never renders. (Inherited from built-in behavior; assert in tests.)
   - Once visible, the set only ever **narrows, replaces, or closes** — a
     narrowing keystroke (`zend` → `zendk`) must not close-and-reopen.
   - Close events: disqualification (no candidates), cursor move, escape,
     space. A close followed by a qualifying keystroke within 200 ms re-opens
     fresh (no stale set).

### Tab-open gesture: root cause (traced) and mitigation

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

## Never-hijack rules (acceptance-critical)

- No key handling outside `applyCompletion`/Tab semantics.
- **Tab never opens the menu.** Menu opening is automatic (typing-driven)
  only: 2nd-char threshold match, 1st char after the trigger char, or the
  zero-char chain offer. There is no manual open gesture; Tab completes,
  full stop.
- Escape, arrows, backspace, space behave exactly as stock pi.
- Tab with no live suggestion set passes through as a literal Tab.
- The user can type an entire session and never trigger a menu for common
   words: `the`, `context` are rank-rejected; zero-candidate queries never
   render anything.

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
  - typed chars filter the live successor list (prefix,
    case-insensitive, as usual); threshold stays 0 for the duration of
    the chain
  - Tab during armed (selected item, or top if none selected, per rule 0)
    → insert it (ONE word), transition armed(next)
  - Any non-Tab key that disqualifies (space, escape, punctuation) → idle
  - Typing continues to filter normally (chain never blocks typing;
    it only feeds the suggestion set)
  - No successors for W → idle (normal threshold matching resumes)
```

- Chaining arms only from our own candidates, never from path completion.
- The chain state resets on every `before_agent_start` (new user turn).
- Trigger-char completions also arm the chain (they're whole-word
  insertions).

## Menu item shape

`AutocompleteItem`: `value` = the string to insert — **always exactly one
word** (candidate display casing). Multi-word items are forbidden
(invariant; see 06). `label` = same, `description` = optional short
provenance (e.g. `session ×12` or `chain`) — keep minimal; do not clutter.

Max 8 items per result set, ordered per 04 ranking. Every item is a single
word, including during chains (06, 07).
# 08 — Configuration

## Config surface (deliberately tiny)

pi has no extension-settings API for this; the extension reads a plain JSON
config file itself. Load order (later wins):

1. Built-in defaults (in code).
2. `~/.pi/agent/hapax.json` (user-global).
3. `.pi/hapax.json` (project-local, if the project is trusted).

Malformed file → warn once via `ctx.ui.notify(..., "warn")`, fall back to
defaults, continue running. Missing files are normal.

## Schema

```jsonc
{
  "triggerChar": "#",        // single non-alphanumeric char; "" disables
                              // trigger mode entirely
  "threshold": 2,            // chars before threshold matching: 1 | 2 | 3
  "maxSuggestions": 8,       // 1–20
  "enableChaining": true,    // M2 flag; gates the successor-index chain
                              // layer only. "enablePhrases" is accepted as a
                              // deprecated alias for this key. Word
                              // completion is unaffected either way.
  "debug": false             // enables /acwords command + store dump
}
```

Validation: clamp/repair invalid values to defaults (log when repaired).
`triggerChar` must match `/^[^\w\s]$/` or be empty. `threshold` clamped to
1–3. `maxSuggestions` clamped 1–20.

## Not configurable (by settled decision)

- Salience weights, admission bands (220/120), shape-gate secret rules,
  eviction cap, debounce intervals, popup timing. These are internal tuning
  constants — the tuning protocol lives in 09, not in user config. Exposing
  them invites unsupported states; if a future version learns better values,
  ship new constants.

## Debug command (`/acwords`, registered when `debug: true`)

Read-only inspection for development: dumps top-50 candidates by salience,
store size, rank-group histogram, shape-gate rejection counts, and (M2)
a successor-index sample. Output via `ctx.ui.notify` or the
widget API; never logs message bodies (store holds words + counters only).
# 09 — Testing and Acceptance

## Unit tests (per module)

**segment.test.ts**
- camelCase splits: `fixRoundingError` → whole + `fix`(dropped, len<4) +
  `Rounding`, `Error`; `HTTPServer` → `HTTP` + `Server`.
- snake_case: `session_token_valid` → whole + `session`, `token`, `valid`.
- Hexish: `f3a9c2e` captured; `123456` (no letter) not; 41+ chars not.
- CJK run skipped; ASCII resumes after.
- Hyphen/apostrophe not joined: `state-of-the-art` → three tokens.

**shapeGate.test.ts** (each rule is a case)
- Accept: `zendesk`, `lwlock`, `NREL`, `f3a9c2e`.
- Reject: `aaaaa`, `aaaaaaa`, `sk-abc123DEF456...`, `ghp_...`, `eyJhbG...`,
  20+ pure hex, `qqqxxxzzzvvv` (consonant run), `ab` (too short), 65+ chars,
  base64 ≥ 24 mixed.

**score.test.ts**
- Admission bands: quant 250 → reject; quant 150 → group 2; quant 80 →
  group 1; absent → group 0.
- Salience arithmetic: construct store entries, assert exact ordering for
  hand-computed cases (frequency beats rare-once; recency decay at τ=20;
  userTyped flips a tie).
- Ranking tiebreaks: salience equal → shorter, then lexicographic.

**store.test.ts**
- Upsert merge semantics (count, ordinals, sticky flags, rankGroup min).
- Eviction: insert 20,001 → exactly one eviction, lowest evictionScore;
  userTyped survives.
- Prefix index rebuild-after-dirty correctness.

**dictionary.test.ts**
- Round-trip: build a tiny table in-memory (10 words), write format, load,
  assert every lookup, absent → null, no allocation in lookup (optional
  via node `--expose-gc` smoke test).
- Corrupt file (bad magic, truncated) → load throws.

**provider.test.ts**
- Trigger regex: `#`, `#ze`, mid-line `foo #ze`, `foo#ze` (no match — needs
  start/whitespace), two `##` → no match.
- Threshold: fragment of 1 char with threshold 2 → delegate; 2 chars →
  match; case-insensitive `nrel` → `NREL` insertion casing.
- Zero candidates → delegate/empty, never a menu.
- Debounce: two rapid set updates → only one swap at +100 ms; Tab mid-debounce
  resolves the live (undebounced) top item.
- Tab-only-completes: Tab with a live set completes the selected (or top)
  item and never opens/toggles a menu; the menu appears automatically on
  the 2nd char of a matching word and on the 1st char after the trigger
  char, with no manual open gesture of any kind; completion is exactly one
  keypress. Includes the forced path: `getSuggestions` with
  `force: true` + live fragment MUST return exactly one item (the live
  top / chain successor) so pi-tui's single-item fast path applies it —
  assert Tab-before-paint completes rather than opening the menu.
- Hysteresis: narrowing keystroke must not emit close+reopen (assert via
  recorded provider emission sequence).
- Delegation: no fragment → `current.getSuggestions` called with unchanged
  args (path completion intact).

## Integration acceptance (manual or scripted via pi)

1. **Happy path:** session discussing `Zendesk` + `lwlock`; type `ze` → menu
   offers `Zendesk`; Tab inserts `Zendesk` (cased). Type `#l` → `lwlock`.
2. **No-hijack:** type ordinary prose continuously; keystrokes land verbatim,
   no menu for common words, Tab with no selection = literal tab.
3. **Restore:** `/resume` a 100k+ token session; store rebuilt in background
   (< 100 ms total); completions available within the first second.
4. **Compaction:** trigger compaction (long session + `/compact`); store
   survives; previously admitted words still complete.
5. **Secrets:** paste an API key into a user prompt; key never appears in
   suggestions afterwards (shape gate).
6. **Path completion regression:** quoted path completion, slash commands,
   and `@`-mention behaviors identical to stock pi.

## Performance gates (CI-scriptable micro-benchmarks)

| Gate | Limit |
|---|---|
| 20k-candidate prefix query + rank + top 8 | < 1 ms p99 |
| Dictionary load + full lookup sweep of 20k words | < 60 ms |
| Ingest 800 KB synthetic session text | < 60 ms, yields every ≤ 64 KB |
| Steady-state heap delta (dict + store) | < 6 MB |

Benchmarks run with a synthetic dictionary fixture; numbers asserted loosely
(CI variance) — hard regressions (> 3× budget) fail.

## Tuning protocol

The only tuning surfaces: admission bands (220/120), salience weights
(2.0/3.0/1.5/0.8/1.0), no phrase multipliers exist (M2 successor index has none). Protocol: change one constant,
run the acceptance suite, A/B against a fixed 3-session corpus fixture
(`test/fixtures/sessions/`) checking precision@8 by hand-labeled expected
completions. No telemetry exists; tuning is fixture-driven by design.

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
words (stopword bridging forbidden), newlines. Integration item 7: accept
`National` → with zero additional typed chars `Renewable` is the top result
→ Tab → `Energy` → Tab → `Laboratory`.

## Decision log (all settled)

| Topic | Decision |
|---|---|
| Rarity source | Known-common-words frequency table (presence = commonness evidence; absence = rare-by-default, shape-gated) |
| Dictionary size | Top ~60–80k English frequent words, 8-bit quantized frequency, ~1–2 MB packed binary |
| Scoring | Global commonness (static, admission) + session salience (dynamic, ranking). Constants baked, not configurable |
| Ingestion | `message_end` events only; roles `user` + `assistant`; assistant text blocks only (no thinking blocks); code blocks inside assistant output included; toolResult excluded entirely |
| Store lifecycle | Per-session, in-memory, survives compaction, no persistence. Rebuild on resume from history (~30–50 ms background for 200k tokens) |
| Trigger | Configurable trigger char (default `#`, 1st-char lookup); threshold-matching at 2 chars (configurable 1–3), fires after any word start |
| Popup | Display-debounced ~100 ms; synchronous search every keystroke; hysteresis against flicker |
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
