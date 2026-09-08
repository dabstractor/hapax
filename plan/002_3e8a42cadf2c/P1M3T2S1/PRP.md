# PRP — P1.M3.T2.S1: debug.ts successor-index sample section + debug.test.ts update

## Goal

**Feature Goal**: Implement the final piece of PRD §08 h2.48's `/acwords`
surface (R5): a standalone **successor-index sample section** appended to
`formatAcwordsDump`. The old successor sample (a `topSuccessors` peek) lived
INSIDE `phrasesSection` (src/pi/debug.ts former lines 154–159) and was deleted
with the phrase dump in P1.M1.T2.S3 — successor observability is currently
zero, yet it is the **only tuning signal for chained offers** (PRD §09 h2.52:
"no phrase multipliers exist" — nothing else to dump in the M2 layer). The new
section samples `store.topSuccessors(w)` for the dump's top-N salience words,
rendered in the established `'national → renewable ×4, license ×1'` style, and
renders a sane `(none)` line when the successor index is empty (empty store or
`enableChaining: false`, which stops `recordBigramRuns` from ever being fed).

**Deliverable**:
1. Modified `src/pi/debug.ts` — one new builder `successorsSection` + one
   spread entry in `formatAcwordsDump`; JSDoc updates (header comment already
   anticipates exactly this change).
2. Modified `test/debug.test.ts` — new tests: successor sample present for a
   populated index (exact rendering), `(none)` for an empty store, NO phrase
   section anywhere in the dump, registration behavior unchanged.

**Success Definition**: `npm run check` and `npm test` green; a store fed via
`recordBigramRuns` shows successor rows in the dump; an untouched store shows
the `(none)` rendering; `dump.toLowerCase()` contains no "phrase" section
marker; `debug: false` still registers nothing.

## Why

- PRD §08 h2.48: the debug dump includes "(M2) a successor-index sample" —
  the phrase-layer removal (R1) accidentally removed the only successor
  observability along with the phrase dump.
- PRD §09 h2.52 (tuning protocol): fixture-driven A/B of chained offers
  needs to SEE what successors the index holds; there are no phrase
  multipliers to dump (nothing else belongs in an M2 section).
- PRD §06 h3.7: the successor index is `word → top-3 most frequent
  successors` — `store.topSuccessors(word)` is the pure O(1) reader.
- Output is the final `/acwords` surface documented in P1.M4.T2.S1
  (README Debug section, changeset-level — NOT this task's job).

## What

### Behavior contract

1. **New builder** (placed after `statsSection`, following the file's
   builder-per-section convention — the file header explicitly says
   "P1.M3.T2.S1 (R5) appends the successor-index sample section by adding
   one builder and one spread entry"):
   ```ts
   /** How many top words the successor sample covers (tuning signal for
    *  chained offers, PRD §08 h2.48 + §09 h2.52). */
   const SUCCESSOR_SAMPLE_N = 10;

   /** "successor index sample" section (PRD §08 h2.48, P1.M3.T2.S1): for
    *  the SUCCESSOR_SAMPLE_N highest-salience words that HAVE successors,
    *  render `word → next ×count, next2 ×count2` rows (topSuccessors is
    *  already count-desc, byte-lex ties, max 3 — store.ts h3.7). An empty
    *  index (empty store, or enableChaining:false — nothing ever reaches
    *  recordBigramRuns) renders one `(none)` line. Pure read; never
    *  mutates the live successor arrays. */
   function successorsSection(rows: Candidate[], store: CandidateStore): string[] {
     const sampled = rows.filter((c) => store.topSuccessors(c.key).length > 0)
       .slice(0, SUCCESSOR_SAMPLE_N);
     if (sampled.length === 0) {
       return ["successor index sample", "  (none)"];
     }
     return [
       "successor index sample",
       ...sampled.map((c) => {
         const succ = store.topSuccessors(c.key)
           .map((s) => `${s.next} ×${s.count}`)
           .join(", ");
         return `  ${c.display} → ${succ}`;
       }),
     ];
   }
   ```
   (Adapt names/format to match the final P1.M1.T2.S3 file; the contract is:
   header line `successor index sample`, one row per sampled word in the
   `word → next ×count, next2 ×count2` style, `(none)` fallback.)

2. **Wire into `formatAcwordsDump`**: reuse the already-computed `rows`
   (topCandidates result — do NOT re-sort or capture a second "now"):
   ```ts
   return [
     ...storeSection(store.size, ordinal, histogram),
     "",
     ...topSection(rows),
     "",
     ...statsSection(stats),
     "",
     ...successorsSection(rows, store),
   ].join("\n");
   ```
   Keep `storeSection`, `topSection`, `statsSection` byte-identical.
   Note the file's existing JSDoc on formatAcwordsDump already says
   "M2 appends its section by adding one builder here and one spread entry
   to the join below" — do exactly that, updating the comment to say the
   successor sample HAS landed (not "will").

3. **Sampling semantics** (settled): filter the top-50 `rows` down to words
   that actually have successors, take the first `SUCCESSOR_SAMPLE_N` —
   so the section shows the tuning-relevant words (high salience WITH
   chain offers), never rows of "(no successors)" noise. Sampling follows
   the top-50 salience order (already deterministic: salience desc,
   byte-lex tie-break).

4. **No config read**: `formatAcwordsDump(store, stats)` signature is
   UNCHANGED — chaining-disabled is observable as the empty index
   (`(none)`), because P1.M3.T1.S2 re-points the gate so
   `enableChaining: false` never wires `recordBigramRuns` feeding.

5. **No phrase anything**: the dump must contain no phrase section, no
   `phraseCandidateKeys`, no phrase imports (verify — the current debug.ts
   is already phrase-free after P1.M1.T2.S3; the test ASSERTS it stays so).

### Success Criteria

- [ ] Populated store: dump contains `successor index sample` with
      `word → next ×count` rows for high-salience words with successors
- [ ] Empty store / never-fed index: exactly `successor index sample` +
      `  (none)` (no throw, no empty dangling rows)
- [ ] Store/top/stats sections byte-identical to before
- [ ] No phrase section anywhere in the dump (test-enforced)
- [ ] Registration behavior unchanged: `debug:false` registers nothing
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

All line references below read from the current working tree (post
P1.M1.T2.S3 phrase-strip, post P1.M1.T3.S3 successor rewrite).

### Documentation & References

```yaml
- file: src/pi/debug.ts
  why: THE edit target — section builders storeSection (~70), topSection
        (~81), statsSection (~94), topCandidates (~46), TOP_N=50 (~36),
        formatAcwordsDump join (~166–184), registerAcwordsCommand (~196+)
  pattern: one small pure builder per section + one spread entry in the
        join; the header JSDoc (~line 12) already specifies this task's
        placement contract
  gotcha: reuse the caller-captured `ordinal`/`rows`; NEVER call
        salience() with a second "now" inside the new builder

- file: src/core/store.ts
  why: topSuccessors(word) (~624) — pure O(1) read, count-desc + byte-lex
        ties, max 3, returns LIVE array (read-only contract) or shared
        NO_SUCCESSORS for a miss; bigramSize getter (~630) exists if a
        count line is wanted (optional); recordBigramRuns(runs) (~447) is
        how tests populate the index (runs = per-line arrays of admitted
        lowercase word keys, adjacent pairs counted)
  gotcha: topSuccessors returns the LIVE array — do not sort/mutate it

- file: src/core/types.ts
  why: Successor interface (~64): { next: string; count: number }
  gotcha: `count` is this-session bigram occurrences — ×N rendering matches
        topSection's `×${c.sessionCount}` style

- file: test/debug.test.ts
  why: THE test home — see() helper (upsert one sighting), fakeStats,
        statsStub, fakePi, topRows parser; suite structure: "acwords dump
        (PRD §08)" describe for formatter tests, "acwords registration"
        for the guard tests
  pattern: real CandidateStore + structural stubs; exact-string
        toContain/toBe assertions on dump lines

- file: plan/002_3e8a42cadf2c/architecture/core_phrase_layer_map.md
  why: §debug.ts documents the removed phrasesSection (132–160) and the
        successor sample that lived inside it (154–159); confirms
        topSuccessors is the only successor reader and storeSection/
        topSection/statsSection are the surviving sections
  critical: the old sample's rendering style ('w → next ×N') is the
        established format to reproduce

- file: plan/002_3e8a42cadf2c/P1M3T1S2/PRP.md
  why: CONTRACT for the in-flight gate re-point — enableChaining becomes
        the sole gate for recordBigramRuns feeding; enablePhrases is a
        transitional mirror
  critical: this task reads NO config in debug.ts; do not add a config
        param or an enableChaining branch to the formatter

- file: test/successors.test.ts
  why: post-rewrite (P1.M1.T3.S3) examples of populating the successor
        index via recordBigramRuns with run arrays — copy the fixture style
        for the new debug tests
```

### Current Codebase tree (relevant)

```bash
src/
  core/store.ts        # CandidateStore: topSuccessors, recordBigramRuns, bigramSize
  pi/debug.ts          # formatAcwordsDump + registerAcwordsCommand  <-- edit target
test/debug.test.ts     # formatter + registration suites              <-- edit target
```

### Desired Codebase tree

```bash
src/pi/debug.ts        # + SUCCESSOR_SAMPLE_N, successorsSection builder, spread entry
test/debug.test.ts     # + successor-sample tests, no-phrase assertion
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: topSuccessors() returns the LIVE array (or shared NO_SUCCESSORS
// constant) — treat as read-only; never sort/splice it in the builder.
// CRITICAL: do NOT capture a second "now"/ordinal — sample from the SAME
// topCandidates(rows) the top section uses, in its order.
// GOTCHA: an unseen word returns NO_SUCCESSORS (length 0) with ZERO
// allocation — the .length > 0 filter is the cheap emptiness check.
// GOTCHA: recordBigramRuns keys are the admitted lowercase word keys; the
// sample's LEFT side should render c.display (like topSection), the RIGHT
// side s.next (already lowercase keys — fine, successors are menu values).
// GOTCHA: relative imports need .js extensions (NodeNext ESM).
// GOTCHA: `npm run check` = tsc --noEmit is the only linter; vitest is the
// test runner (`npm test`).
```

## Implementation Blueprint

### Data models and structure

No new data models — the section renders existing `Candidate` + `Successor`
shapes. Only one new constant (`SUCCESSOR_SAMPLE_N = 10`) and one builder.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/pi/debug.ts — successorsSection builder
  - ADD SUCCESSOR_SAMPLE_N constant + successorsSection builder per "What" §1
    (exact rendering contract; adapt names to file style)
  - PLACE: after statsSection, before formatAcwordsDump
  - SIGNATURE: successorsSection(rows: Candidate[], store: CandidateStore): string[]
  - CONSTRAINTS: pure read; no mutation of live arrays; no second "now";
    no config access; no phrase symbols

Task 2: MODIFY src/pi/debug.ts — spread entry + JSDoc
  - ADD `..., ...successorsSection(rows, store)` to the formatAcwordsDump
    join with a preceding blank-line separator (matching section rhythm)
  - UPDATE the file header JSDoc (~line 12) and formatAcwordsDump JSDoc:
    the successor sample has landed (remove the "P1.M3.T2.S1 appends..."
    future-tense note; keep the one-builder-one-spread guidance as the
    standing convention)

Task 3: MODIFY test/debug.test.ts — new formatter tests
  - ADD to the "acwords dump (PRD §08)" describe:
      1. "successor sample: rows for populated index in 'w → next ×N' style"
         — real CandidateStore: see() a few words (establish salience order),
         store.recordBigramRuns([["national","renewable","renewable", ...
         runs that give national→renewable ×4, national→license ×1]]),
         then assert dump contains the exact lines:
         "successor index sample" and
         "  national → renewable ×4, license ×1" (adjust to the store's
         actual top-3 order: count-desc, byte-lex ties — verify against
         successors.test.ts fixtures; make the fixture unambiguous, e.g.
         counts 4 vs 1, distinct first bytes)
      2. "successor sample renders (none) for an empty store" — fresh store,
         dump contains "successor index sample" followed by "  (none)";
         must not throw
      3. "no phrase section anywhere in the dump" — populated store dump:
         expect(dump.toLowerCase()).not.toContain("phrase") — simplest
         total guard (no phrase symbols exist anywhere else in the format)
      4. (optional but recommended) "sample caps at SUCCESSOR_SAMPLE_N rows"
         — feed >10 words with successors, assert the section has at most
         N rows + header
  - REUSE: see(), fakeStats, real CandidateStore; import nothing new from
    query.ts (there is no phrase code left to import — keep it that way)

Task 4: VERIFY registration tests unchanged
  - READ the "acwords registration" describe (test/debug.test.ts ~L200+):
    debug:false registers nothing; debug:true registers once, notifies at
    "info"; fresh snapshot per invocation — these must PASS UNCHANGED
    (the handler automatically includes the new section via
    formatAcwordsDump). If any assertion pins the exact dump body of an
    empty store, extend it with the new "(none)" lines — otherwise no edits.
```

### Implementation Patterns & Key Details

```ts
// Rendering reference (matches topSection's display/×N conventions):
// successor index sample
//   national → renewable ×4, license ×1
//   zendesk → suite ×2
// (none) case:
// successor index sample
//   (none)
//
// Ordering source: rows (topCandidates, salience desc / byte-lex ties) —
// already computed by formatAcwordsDump; the section adds ZERO sorting.
```

### Integration Points

```yaml
NO integration changes:
  - formatAcwordsDump signature unchanged (store, stats) — index.ts's
    registerAcwordsCommand call site untouched
  - store: no changes (topSuccessors, bigramSize already public)
  - config: no reads (enableChaining gate lives in index.ts wiring, owned
    by P1.M3.T1.S2)
  - README Debug section: P1.M4.T2.S1 (Mode B changeset) — do not touch
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check          # tsc --noEmit — the only linter
# Expected: clean. Watch for accidental mutation of the readonly
# Successor[] (topSuccessors returns readonly — map/join only).
```

### Level 2: Unit Tests

```bash
npm test -- debug
npm test                # full suite — no regressions (successors, chain,
                        # provider, acceptance suites must stay green)
# Expected: new tests pass; existing formatter tests pass only if
# store/top/stats sections are byte-identical (any pinned full-dump
# equality assertions need the appended section added — grep
# toBe/toEqual on whole dumps in test/debug.test.ts and update).
```

### Level 3: Integration Testing

Not applicable — formatter is pure; registration path is covered by the
existing structural-stub tests.

### Level 4: Domain-Specific Validation

```bash
npm test -- -t "successor"   # the new sample tests + successors.test.ts
npm test -- -t "phrase"      # must find NOTHING phrase-layer (suites deleted)
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean
- [ ] `npm test` fully green

### Feature Validation

- [ ] Successor sample rendered in `word → next ×N, next2 ×N2` style
- [ ] `(none)` fallback for empty index (no throw)
- [ ] No phrase section/imports anywhere in debug.ts or its dump
- [ ] store/top/stats sections byte-identical
- [ ] Registration guard behavior unchanged

### Code Quality Validation

- [ ] One builder + one spread entry (file's stated convention)
- [ ] No second "now", no live-array mutation, no config read
- [ ] JSDoc updated out of future tense

## Anti-Patterns to Avoid

- ❌ Don't add a config/enableChaining branch to the formatter — the empty
  index IS the disabled signal.
- ❌ Don't re-sort or re-derive salience inside successorsSection.
- ❌ Don't mutate the arrays topSuccessors returns.
- ❌ Don't reintroduce any phrase symbol (imports, sections, constants).
- ❌ Don't touch README (P1.M4.T2.S1 owns it).
- ❌ Don't render "(no successors)" per-word noise — filter, don't annotate.