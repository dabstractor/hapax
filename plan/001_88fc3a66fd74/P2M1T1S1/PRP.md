# PRP — P2.M1.T1.S1: Within-line n-gram capture + PhraseEntry map + cap/eviction

---

## Goal

**Feature Goal**: Extend `src/core/store.ts` with the M2 phrase layer (PRD §06 h2.38/h3.6): a
`Map<string, PhraseEntry>` capturing bigrams and trigrams of consecutive admitted whole-token
candidates, within a line only, capped at 10,000 entries with eviction mirroring the word-store
policy. Make `config.enablePhrases` live by wiring the ingest callback that feeds it.

**Deliverable**:
1. `PhraseEntry` interface in `src/core/types.ts` (PRD-exact fields).
2. Phrase layer on `CandidateStore`: per-line n-gram upsert, 10k cap + sticky-aware eviction,
   read/iteration accessors for downstream tasks.
3. `IngestPipeline.processText` change: expose per-LINE admitted whole-token arrays through the
   existing `onAdmittedTokens` hook (currently flat, line-blind — see Gotchas).
4. `src/pi/index.ts` wiring: pass `onAdmittedTokens` when `config.enablePhrases` is true.
5. Unit tests in `test/store.test.ts` (or a new `test/phrases.test.ts`) + pipeline line-splitting
   tests.

**Success Definition**: Ingesting a two-line message produces bigrams only within lines; repeated
phrases increment `count` and refresh `lastSeenOrdinal`; subwords never appear in phrase keys;
overflow past 10,000 phrases evicts lowest-score non-sticky entries first; `enablePhrases: false`
records nothing. All existing tests still pass.

## User Persona

**Target User**: end user of the hapax autocomplete extension (indirect — this is an internal
module).

**Use Case**: During ingestion, multi-word phrases the user/agent keeps repeating ("renewable
energy laboratory") accumulate counts so M2 can offer them as completion candidates and chain
completions.

**Pain Points Addressed**: Single-word autocomplete cannot complete multi-word domain phrases;
this layer supplies the counts that admission (P2.M1.T2.S1) and the successor index
(P2.M2.T1.S1) consume.

## Why

- PRD §01 Goals (M2) #6: multi-word phrase candidates — this is its data foundation.
- Provides the single bigram-count source shared by phrase admission and chained completion.
- Consumes the `onAdmittedTokens` hook deliberately added by P1.M3.T2.S2.

## What

- `PhraseEntry { key, count, lastSeenOrdinal, firstSeenOrdinal, sticky }` — PRD §06 verbatim.
- For each message line, for each consecutive window of n=2 and n=3 admitted whole tokens:
  upsert the phrase (create on absent; else `count++`, `lastSeenOrdinal` refresh).
- Key = lowercase words joined by single spaces (tokens are already lowercase from the pipeline).
- Newline breaks the window. Sub-words are already excluded by the pipeline (`!draft.isSubword`).
- Cap 10,000 phrases; eviction mirrors `evictIfOverCap` (§06 h2.37): lowest phrase eviction
  score first, `needed = size - cap` victims, sticky entries excluded from the victim pool
  unless they alone exceed the cap, byte-lexicographic key tie-break.
- `sticky` is stored (init `false`) but never SET here — that is P2.M1.T2.S1 (admission).
- Gated by `config.enablePhrases` at the wiring site only (core stays unconditional).

### Success Criteria

- [ ] Phrase map correct for bigrams/trigrams of multi-line input (no cross-line windows).
- [ ] Counts increment on repeat; ordinals refresh; `firstSeenOrdinal` frozen at creation.
- [ ] 10,000-cap eviction works, deterministic, sticky-protected.
- [ ] Phrase iteration accessor exposes bigram counts for P2.M2.T1.S1.
- [ ] `enablePhrases: false` → hook not wired → zero phrases.
- [ ] All existing tests pass; `npx tsc --noEmit` and lint clean.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything needed?" — Yes: the
PRD excerpt below is complete; every file, pattern, and gotcha below was verified by reading
the code.

### Documentation & References

```yaml
- file: src/core/store.ts
  why: The module being EXTENDED. Copy its eviction pattern verbatim in spirit.
  pattern: "evictIfOverCap(): early size return; snapshot; filter out protected (userTyped→sticky);
           fall back to full snapshot if pool < needed; score-once-then-sort asc with byte-lex
           key tie-break; delete exactly `needed`; mark dirty-equivalent state."
  gotcha: "evictionScore() from score.ts takes a Candidate — NOT reusable for PhraseEntry.
           Write a phrase-specific score: count * exp(-(now - lastSeenOrdinal)/50) (the same
           τ=50 ageFactor the word store uses). Keep it private to store.ts or a local helper."

- file: src/core/types.ts
  why: Pure-declaration module where PhraseEntry must be added (no imports, no runtime code;
       src/core never imports pi packages).
  pattern: "JSDoc'd interface next to Candidate/Sighting."
  gotcha: "PhraseEntry must NOT be called Candidate; downstream tasks (P2.M1.T2.S1) import it by name."

- file: src/pi/ingest.ts
  why: "processText currently builds a FLAT admittedWhole array (line-blind) and calls
        onAdmittedTokens?.(admittedWhole) once per message at its tail (line ~290)."
  pattern: "Options interface IngestPipelineOptions.onAdmittedTokens?: (keys: string[]) => void."
  gotcha: "CHANGE THE HOOK SIGNATURE to per-line: onAdmittedTokens?: (lines: string[][]) => void.
           Split each byte-chunk slice on '\n'; a line open at a chunk boundary CONTINUES into
           the next slice (only newline breaks a window, per PRD — chunk boundaries must not).
           Empty lines produce empty arrays (no windows). No other callers exist yet."

- file: src/pi/index.ts
  why: "Wiring site — line 134: pipeline = new IngestPipeline({ store, dictionary: lazyDict })."
  pattern: "Add onAdmittedTokens gated on config.enablePhrases; callback delegates to
            store.recordPhraseLines(lines, store.currentOrdinal())."

- file: src/pi/config.ts
  why: "enablePhrases: boolean exists (default true, validated). This task makes it live."

- file: test/store.test.ts
  why: "Test conventions: vitest describe-per-PRD-section, plain fixtures, deterministic
        eviction tests. Model new tests on the 'eviction (PRD §06 h2.37)' describe block."

- file: test/ingest-pipeline.test.ts
  why: "Pipeline test patterns (fake dictionary, processText await, stats assertions) — extend
        for per-line callback shape."

- docfile: plan/001_88fc3a66fd74/P2M1T1S1/research/notes.md
  why: Verified codebase facts, hook line numbers, downstream accessor contract.
```

### PRD §06 M2 excerpt (authoritative contract)

```ts
interface PhraseEntry {
  key: string            // "renewable energy laboratory"
  count: number
  lastSeenOrdinal: number
  firstSeenOrdinal: number
  sticky: boolean        // admitted via fast path AND repeated
}
```
Bigrams and trigrams of **consecutive admitted whole-token candidates** (post shape gate +
admission; sub-words excluded), within a line only (newline breaks the window). Key = lowercase
words joined by single spaces. `Map<string, PhraseEntry>`; cap at 10,000 phrases with the same
eviction policy. (sticky semantics: P2.M1.T2.S1; demotion sweep: P2.M1.T2.S2 — NOT this task.)

### Current Codebase tree (relevant slice)

```bash
src/core/types.ts        # shared contracts (PhraseEntry goes here)
src/core/store.ts        # CandidateStore (phrase layer extends this)
src/core/score.ts        # evictionScore — Candidate-only, do not reuse
src/pi/ingest.ts         # IngestPipeline + onAdmittedTokens hook
src/pi/config.ts         # enablePhrases flag
src/pi/index.ts          # wiring: new IngestPipeline({...})
test/store.test.ts       # store tests (extend or sibling phrases.test.ts)
test/ingest-pipeline.test.ts
```

### Desired Codebase tree with files to be added/changed

```bash
src/core/types.ts        # MODIFY: add PhraseEntry interface
src/core/store.ts        # MODIFY: phrase layer on CandidateStore (+ PHRASE_CAP, PHRASE_EVICT_BATCH consts)
src/pi/ingest.ts         # MODIFY: per-line onAdmittedTokens signature + line-splitting in processText
src/pi/index.ts          # MODIFY: wire onAdmittedTokens gated on config.enablePhrases
test/phrases.test.ts     # NEW (recommended): phrase-layer unit tests (or extend store.test.ts)
test/ingest-pipeline.test.ts  # MODIFY: per-line callback tests
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: evictionScore(c: Candidate, now) requires Candidate fields — phrases need their
// own score. Use: phraseScore = e.count * Math.exp(-(now - e.lastSeenOrdinal) / 50).
// CRITICAL: processText chunks text by chunkBytes BEFORE tokenizing; a line can span slices.
// Only '\n' breaks a window — carry an open line across slice boundaries.
// CRITICAL: onAdmittedTokens currently fires with a FLAT keys array — its signature must
// change to string[][] (per line). Only index.ts wiring + tests consume it today.
// CRITICAL: sticky must never be SET in this task (admission is P2.M1.T2.S1); init false,
// honor it in eviction pool filtering exactly like userTyped in the word store.
// CRITICAL: token keys arrive already lowercase — do NOT lowercase again (defensive
// lowercasing is fine but not required; keys are built by joining with single spaces).
// Eviction victim count is EXACTLY size - cap (PRD §09 forbids rounding up to batch size);
// EVICT_BATCH=256 is only the amortization granularity snapshot+sort serves.
// src/core must never import from src/pi (architecture invariant in types.ts header).
// Word store (20k cap) and phrase map (10k cap) are INDEPENDENT — phrase eviction must not
// touch the word map or the prefix index's #dirty flag.
```

## Implementation Blueprint

### Data models

```ts
// src/core/types.ts — add (pure declaration module):
export interface PhraseEntry {
  /** lowercase words joined by single spaces, e.g. "renewable energy laboratory" */
  key: string;
  count: number;
  lastSeenOrdinal: number;
  firstSeenOrdinal: number;
  /** set only by admission (P2.M1.T2.S1); resists eviction like userTyped */
  sticky: boolean;
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/types.ts
  - ADD: PhraseEntry interface (PRD §06 verbatim, JSDoc each field like Candidate).
  - PLACEMENT: after Sighting, before RawToken.

Task 2: MODIFY src/core/store.ts — phrase layer
  - ADD consts: PHRASE_CAP = 10_000, PHRASE_EVICT_BATCH = 256 (exported, matching
    STORE_CAP/EVICT_BATCH style and docs).
  - ADD private #phrases = new Map<string, PhraseEntry>().
  - ADD recordPhraseLines(lines: readonly string[][], ordinal: number): void
    → for each line, for i in [0, line.length): if i+1 < len upsert bigram
      (line[i] + " " + line[i+1]); if i+2 < len upsert trigram (three joined by spaces).
    → upsert: absent → create { key, count: 1, firstSeenOrdinal/lastSeenOrdinal: ordinal,
      sticky: false }; present → count++, lastSeenOrdinal = ordinal (firstSeenOrdinal frozen,
      sticky untouched).
    → tail: private evictPhrasesIfOverCap() mirroring evictIfOverCap (early size return;
      snapshot via phraseEntries(); pool = !sticky, fall back to full snapshot if needed;
      score = count * exp(-(currentOrdinal() - lastSeenOrdinal)/50) computed once per entry;
      sort asc, byte-lex key tie-break; delete exactly `needed = size - PHRASE_CAP`).
  - ADD accessors: getPhrase(key): PhraseEntry | undefined; get phraseSize(): number;
    phraseEntries(): PhraseEntry[] (defensive copies, same as entries());
    iteratePhrases(): IterableIterator<PhraseEntry> (live map values, documented as such)
    — P2.M1.T2.S1 iterates for admission, P2.M2.T1.S1 reads bigrams.
  - FOLLOW pattern: existing upsert/evictIfOverCap/entries in this same file.
  - GOTCHA: do NOT mark the word prefix-index dirty; phrase ops are independent.

Task 3: MODIFY src/pi/ingest.ts — per-line callback
  - CHANGE IngestPipelineOptions.onAdmittedTokens?: (lines: string[][]) => void
    (update its JSDoc: per-line lowercase admitted whole-token keys, in order).
  - REWORK processText: replace the flat admittedWhole accumulator with per-line arrays.
    For each byte slice: split slice on '\n'; tokenize each segment separately and append
    its admitted whole-token keys; if the slice does NOT end with '\n' (last segment open),
    carry that segment's array into the next slice's first line (only newline breaks a
    window — chunk boundaries must not). Multi-block messages already join text with '\n'
    (extractText), so blocks are separate lines automatically.
  - At tail: this.#onAdmittedTokens?.(lines). Empty text still early-returns (no callback).

Task 4: MODIFY src/pi/index.ts — enablePhrases wiring
  - AT line ~134 (pipeline construction): when config.enablePhrases, pass
    onAdmittedTokens: (lines) => store.recordPhraseLines(lines, store.currentOrdinal()).
    (The ordinal was already issued by processText via nextOrdinal() before the callback
    fires — currentOrdinal() equals it.)
  - PRESERVE: all other wiring; enablePhrases false → hook absent → inert (M1 behavior).

Task 5: CREATE test/phrases.test.ts
  - FOLLOW pattern: test/store.test.ts (describe-per-contract, plain fixtures).
  - TEST window breaks on newline: lines [["alpha","beta"],["gamma"]] → bigram
    "alpha beta" only, NO "beta gamma", NO trigram.
  - TEST counts increment + ordinals: record same line twice with ordinals 1, 5 →
    count 2, firstSeenOrdinal 1, lastSeenOrdinal 5.
  - TEST sub-words excluded — this is enforced upstream (pipeline pushes only whole
    tokens); at store level, test that recordPhraseLines uses keys as given; add the
    subword exclusion test in Task 6 (pipeline level).
  - TEST cap eviction: insert 10,001 distinct phrases → phraseSize === 10_000; evicted
    entries are the oldest/lowest-count (low count × old ordinal = lowest score).
  - TEST sticky resists eviction: mark one entry sticky (manipulate via phraseEntries
    result? No — entries are copies; instead make sticky testable: either record a
    phrase then use an internal hook, or simplest: add test-only path by making
    evictPhrasesIfOverCap honor sticky and constructing the scenario with a private
    class method `markStickyForTest` is NOT allowed — instead: expose
    setPhraseSticky(key: string): void as a real public method (P2.M1.T2.S1 will need
    exactly this; shipping it now is correct, not speculative). Sticky phrase survives
    eviction that drops higher-score non-sticky phrases.
  - TEST trigram capture: ["national","renewable","energy","laboratory"] → bigrams 3,
    trigrams 2, keys exact strings.
  - NAMING: test_{behavior} inside describe("phrase layer (PRD §06 M2)").

Task 6: MODIFY test/ingest-pipeline.test.ts + index wiring test
  - TEST per-line callback: processText("alpha beta\ngamma delta", false) → callback
    receives [["alpha","beta"],["gamma","delta"]] (keys actually admitted by the real
    pipeline — pick real words that pass shape gate + admission with the fake dictionary,
    e.g. admit-stubbed).
  - TEST chunk boundary does NOT break a line: processText with chunkBytes set tiny
    (e.g. 5) over a single-line multi-word message → one line array with all words
    (this pins the carry-open-line logic).
  - TEST sub-words excluded: a camelCase token whose subwords admit — only the whole
    token key appears in the line arrays.
  - TEST no callback when text is empty / null-extracted messages.
  - IF test/index.test.ts covers pipeline construction, add: enablePhrases true wires
    the hook (phrases appear in store after processText via the real factory path) and
    false leaves the phrase map empty.

Task 7: VALIDATE — run full gate chain (below).
```

### Implementation Patterns & Key Details

```ts
// Phrase upsert (store.ts) — mirror word upsert semantics exactly:
recordPhraseLines(lines: readonly string[][], ordinal: number): void {
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      if (i + 1 < line.length) this.#upsertPhrase(line[i] + " " + line[i + 1], ordinal);
      if (i + 2 < line.length) this.#upsertPhrase(line[i] + " " + line[i + 1] + " " + line[i + 2], ordinal);
    }
  }
  this.#evictPhrasesIfOverCap();
}

// Phrase eviction score (do NOT import evictionScore — Candidate-typed):
// score(e) = e.count * Math.exp(-(this.currentOrdinal() - e.lastSeenOrdinal) / 50)

// Per-line carry across chunk boundaries (ingest.ts processText):
// maintain `let openLine: string[] = []`; after each slice, split on '\n';
// segments[0..n-2] finalize lines (openLine.concat(seg) if open), last segment
// continues as openLine unless slice ended with '\n'.
```

### Integration Points

```yaml
CONFIG:
  - no new config; existing HapaxConfig.enablePhrases becomes live at src/pi/index.ts wiring.

STORE API (new surface for downstream tasks — treat as contract):
  - recordPhraseLines(lines: readonly string[][], ordinal: number): void   # this task's writer
  - setPhraseSticky(key: string): void                                    # needed by tests here, used by P2.M1.T2.S1
  - getPhrase / phraseSize / phraseEntries / iteratePhrases               # readers (admission, successor index, /acwords M2 dump)
PIPELINE API (changed):
  - onAdmittedTokens?: (lines: string[][]) => void   # was string[]; only index.ts + tests consume
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit          # must be clean (jiti-safe strict TS)
npx vitest run test/phrases.test.ts   # after Task 5
```
(No ruff/mypy — this is a TS project; `tsc --noEmit` + vitest are the gates. If the repo has a
lint script in package.json, run it too.)

### Level 2: Unit Tests

```bash
npx vitest run test/phrases.test.ts -v
npx vitest run test/ingest-pipeline.test.ts -v
npx vitest run test/store.test.ts -v          # word store unchanged
npx vitest run                                  # FULL suite — existing tests must pass
```

### Level 3: Integration (manual smoke)

```bash
# /acwords (debug mode) extension load — verify no crash on session with phrases enabled:
# covered by test/index.test.ts extension-fixture path; run:
npx vitest run test/index.test.ts -v
```

### Level 4: Contract validation (domain-specific)

```bash
# Deterministic eviction test: seed 10,005 phrases with known count/ordinal patterns,
# assert exactly 5 evicted and they are the predicted lowest-score ones — pins the
# "exactly size - cap victims" rule inherited from PRD §09.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` — all pass, zero regressions in the M1 suite
- [ ] New phrase + pipeline tests pass

### Feature Validation
- [ ] Windows break on newline; never across lines or chunk boundaries
- [ ] Bigram AND trigram windows captured; single-space-joined lowercase keys
- [ ] Subwords excluded from line arrays (pipeline level)
- [ ] count++ / ordinal refresh / firstSeenOrdinal frozen
- [ ] 10k cap, exact-`needed` eviction, sticky protection
- [ ] `enablePhrases: false` → phrase map stays empty
- [ ] Accessors present for P2.M1.T2.S1 and P2.M2.T1.S1 (iteratePhrases, getPhrase, phraseEntries)

### Code Quality Validation
- [ ] Follows store.ts's existing upsert/eviction/accessor patterns and doc-comment style
- [ ] No src/core → src/pi imports; types.ts stays declaration-only
- [ ] No changes to word-store behavior, prefix index, or PRD/tests.json

## Anti-Patterns to Avoid

- ❌ Don't reuse `evictionScore` for phrases — it's Candidate-typed; write the count×ageFactor score
- ❌ Don't set `sticky` anywhere except the public `setPhraseSticky` (admission logic is a later task)
- ❌ Don't implement phrase admission, demotion sweeps, salience, or the successor index — those are
  P2.M1.T2 and P2.M2.T1; this task is capture + storage + eviction + accessors only
- ❌ Don't break a window on a chunk boundary — only '\n'
- ❌ Don't touch the word map, prefix index, or word-cap eviction
- ❌ Don't round eviction victim counts up to 256

---

**Confidence Score: 9/10** — all touch points verified by direct code reading; the only
judgment call (per-line callback signature change) is documented with its exact migration and
test coverage.