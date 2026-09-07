# P2.M1.T1.S1 research notes — within-line n-gram capture + PhraseEntry map

## Codebase facts (verified by reading)

### src/core/store.ts (CandidateStore)
- `Map<string, Candidate>` + `#ordinal` counter (`nextOrdinal()`, `currentOrdinal()`).
- Eviction pattern (`evictIfOverCap`, private, tail of upsert): size check first; `needed = size - CAP`;
  snapshot via `entries()`; pool = non-`userTyped` entries, fall back to all if pool < needed;
  score-once-then-sort (`scored.sort` with float asc + byte-lexicographic key tiebreak);
  delete exactly `needed`; mark `#dirty`.
- Word caps: `STORE_CAP = 20_000`, `EVICT_BATCH = 256` (exported consts, baked per PRD §08 h2.47).
- Test/inspection surfaces: `get`, `size`, `entries()` (defensive copies), `rankGroupHistogram()`.
- `evictionScore(c: Candidate, currentOrdinal)` is imported from score.ts — it requires a
  `Candidate`, NOT usable directly on PhraseEntry. Phrases need their own score
  (count × ageFactor), defined locally in store.ts (or a tiny exported helper) — do not
  shoehorn PhraseEntry into Candidate.

### src/pi/ingest.ts (IngestPipeline)
- `onAdmittedTokens?: (keys: string[]) => void` option EXISTS (added for this subtask) and is
  called ONCE PER MESSAGE at the tail of `processText` with the flat array of admitted
  WHOLE-token lowercase keys (`admittedWhole`), subwords excluded already.
- **GOTCHA — the current callback loses line boundaries.** `admittedWhole` is flat over the
  whole message; tokenization iterates byte-chunk slices of `text` with no newline tracking.
  The PRD requires windows WITHIN A LINE ONLY (newline breaks the window). So this subtask
  MUST also modify `processText` to build per-LINE arrays (see PRP Implementation Tasks).
- `processText(text, fromUser)`: calls `store.nextOrdinal()` once per message, iterates
  `tokenize(slice)` → `expandCandidates` → `passesShape` → `admit` → upsert; whole tokens push
  into `admittedWhole` only when `!draft.isSubword`.
- Chunking: slices at `off += chunkBytes` (default 65,536 chars). A line can span a slice
  boundary — a chunk boundary must NOT break a window (only newline does, per PRD).

### src/pi/config.ts
- `HapaxConfig.enablePhrases: boolean` exists, default `true`, validated/repairable.
  Inert in M1 — nothing reads it. This subtask makes it live at the wiring site.

### src/pi/index.ts (wiring site)
- Line 134: `pipeline = new IngestPipeline({ store, dictionary: lazyDict });` —
  this is where `onAdmittedTokens` gets wired, gated by `config.enablePhrases`.
  Config is loaded before this point in the same handler.

### Tests
- `test/store.test.ts` — vitest, describe-per-contract style, plain object literals;
  eviction tests at "eviction (PRD §06 h2.37 / §05 h2.33)".
- Runner: `npm test` / `npx vitest run` (vitest, ESM, TS via jiti-safe tsconfig).

## PRD contract (§06 M2, selected)
- PhraseEntry = { key, count, lastSeenOrdinal, firstSeenOrdinal, sticky } — exact fields.
- Bigrams + trigrams of consecutive admitted whole tokens, within a line only.
- Key = lowercase words joined by single spaces.
- Map<string, PhraseEntry>, cap 10,000, same eviction policy (lowest evictionScore,
  batches of 256 amortization, sticky resists eviction like userTyped).
- sticky semantics ("admitted via fast path AND repeated") belong to P2.M1.T2.S1 —
  this subtask only stores the field (initialized false) and respects it in eviction.
- Downstream: P2.M1.T2.S1 (admission) and P2.M2.T1.S1 (successor index from the SAME
  bigram counts) need a phrase-iteration accessor.

## Downstream interfaces to expose (contract for siblings)
- `recordLines(lines: readonly string[][], ordinal: number)` (or similarly named) — upsert hook.
- `getPhrase(key)`, `phraseSize`, `phraseEntries()` (defensive copies), and an iteration
  accessor (e.g. `iterateBigrams(): Iterable<{ a: string; b: string; count: number }>`)
  for the successor index.