---
name: "P1.M2.T3.S1 (plan 004, bugfix 001) — Token carry in processText + docstring + spec/05 sync (BUG-004)"
---

## Goal

**Feature Goal**: Fix BUG-004 — a token straddling a ≤64KB slice boundary in
`IngestPipeline.processText` is today shredded into two halves (junk half
admitted as a rare word, real token lost, bigrams broken). Implement a
bounded token carry across slice boundaries: the trailing partial token of a
non-final slice (suffix of token-class characters) is moved into the next
slice and tokenized there exactly once, mirroring the existing
openLine/openTail run carry.

**Deliverable**: Modified `src/pi/ingest.ts` (`TOKEN_CHAR_RE` + `MAX_CARRY`
module consts; restructured slice loop with `carry`; docstring at ~L388-391
replaced with the carry contract), one spec sentence added to
`spec/05-ingestion-pipeline.md` "Chunked processing" (~L30-36). This task is
the CODE + DOCS; the regression battery is P1.M2.T3.S2 — only add the single
exact repro case needed to prove the fix (the full battery is S2's).

**Success Definition**: The exact repro from the issue — a 135KB message
with `Zorpwibble` placed at offset 65536 — yields store entry `zorpwibble`
(and NOT junk `ibble`), and `topSuccessors('zorpwibble')` contains
`quuxblat` (the run stitches across the boundary). All existing ingest
tests pass unchanged, including the pinned yield-count test
(`test/ingest-pipeline.test.ts:197`: 15 slices → 15 yields) and the
gap-boundary run-chaining tests (:523, :541, :554). `npm run check` +
`npm test` green.

## Why

- Spec/04 mandates maximal-run tokenization; slicing tokenizes each chunk
  independently, so the current code violates spec/04 for any token at a
  64KB edge and pollutes the store with junk candidates (issue BUG-004,
  severity Minor, live-verified). The run layer (openLine/openTail) already
  stitches across boundaries — token stitching was intended but missing.
- AGENTS.md spec-maintenance policy: code and spec land together; the stale
  "accepted approximation" docstring and the spec-silent chunk section both
  get the carry contract.

## What

1. **Module consts in `src/pi/ingest.ts`** near `WHITESPACE_GAP_RE` (~L154):
   ```ts
   /** Characters that can legally appear INSIDE a token — the exact union
    *  of the five tokenize regexes in src/core/segment.ts (BASE adds _,
    *  FILENAME adds '.', HYPHEN adds '-', LITERAL adds ._@:+/~=-). A slice
    *  boundary can only split a token if the char before AND after it are
    *  in this class. KEEP IN SYNC with the segment.ts regexes. */
   const TOKEN_CHAR_RE = /[A-Za-z0-9._@:+/~=-]/;
   /** Carry cap: a >64KB single identifier would grow the carry unbounded;
    *  such a run matches no tokenize regex anyway (max ~96 chars). */
   const MAX_CARRY = 1024;
   ```
2. **Restructure the slice loop** in `processText` (~L392-403; today
   `for (let off = 0; off < text.length; off += this.#chunkBytes) { const
   slice = text.slice(off, off + this.#chunkBytes); ... }`):
   - `let carry = "";` before the loop.
   - Per iteration: `const raw = text.slice(off, off + this.#chunkBytes);`
   - **Final slice** (`off + this.#chunkBytes >= text.length`): `k = 0` —
     carry nothing; text ending mid-token admits that token whole
     (single-slice semantics restored; the regexes need no right anchor).
   - **Non-final slice**: `k` = length of `raw`'s trailing maximal
     `TOKEN_CHAR` run, capped at `MAX_CARRY` (excess dropped — degrade to
     today's behavior, no crash). `const nextCarry = raw.slice(raw.length -
     k); const slice = carry + raw.slice(0, raw.length - k); carry =
     nextCarry;`
     - KEY ORDERING: prepend the PREVIOUS carry FIRST, then trim only the
       raw part's tail. The previous carry was itself trimmed at a class
       boundary, so its chars are already consumed — never trim into or
       re-trim the prepended carry (no double-carry).
   - Feed `slice` through the EXISTING `slice.split("\n")` /
     `appendSegment` / `#admitSegment` machinery unchanged. Carried chars
     therefore never enter slice N's admission (they were removed before
     `#admitSegment` ran on it) and enter slice N+1 exactly once, as a
     prefix.
   - **openTail correctness comes free**: `#admitSegment` runs on the
     trimmed slice, so `appendSegment`'s openTail excludes carried chars.
     (TRAP: if carried chars entered openTail, their non-whitespace token
     chars would wrongly BREAK the run — `zorpwibble quuxblat` would not
     chain. Trim BEFORE appendSegment sees the slice.)
   - **Yield**: `await this.#yieldFn()` must fire EVERY iteration, even if
     the trimmed slice became empty (whole raw slice was class chars and
     carried) — `test/ingest-pipeline.test.ts:197` pins yield count = slice
     count. With `MAX_CARRY (1024) < chunkBytes (65536)` a slice can never
     become fully empty, but keep the yield unconditional anyway.
   - The loop still advances `off += this.#chunkBytes` per iteration — no
     infinite-loop risk from carry.
3. **Docstring** (~L388-391): replace "A slice boundary can split one
   token — an accepted approximation (regex tokenize is safe on any
   slice)" with the carry contract: a slice boundary never splits a token;
   the trailing partial token (suffix of token-class chars, capped at
   MAX_CARRY) is carried into the next slice and tokenized there exactly
   once, mirroring the openLine/openTail run carry; runs/bigrams therefore
   form across boundaries.
4. **Spec edit (Mode A — lands with the code)**:
   `spec/05-ingestion-pipeline.md` "Chunked processing" (~L30-36) gains
   after the ≤64KB clause:
   > "A slice boundary never splits a token: the trailing partial token
   > (suffix of token-class characters) is carried into the next slice and
   > tokenized there exactly once, mirroring the open-line/open-tail run
   > carry."
5. **One repro test** in `test/ingest-pipeline.test.ts` (small-chunk
   analogue; the real-65536 full battery is S2's): e.g. `chunkBytes: 8`
   with text placing the seam inside `Zorpwibble` — assert
   `store.get("zorpwibble")` defined, `store.get("ibble")` undefined, and
   the run `["zorpwibble","quuxblat"]` chains (`topSuccessors` non-empty).
6. **Documented limitations (do NOT harden here)**: a structured secret
   straddling the seam is unmaskable today and stays so (maskSecrets is
   per-segment); the unicode-letter disqualification (rule 3/R2) across a
   seam is accepted as-is (rare; requires a \p{L} char adjacent to the
   boundary inside a class run). Both are noted in the docstring/comments
   only.

### Success Criteria

- [ ] Exact repro fixed: straddling token admitted whole, junk half absent, bigram successor forms
- [ ] No double admission (carried chars never tokenized in slice N)
- [ ] openTail computed from the trimmed slice — runs stitch across boundaries
- [ ] Yield fires once per slice iteration (pinned test :197 unchanged and green)
- [ ] Carry capped at MAX_CARRY; final slice carries nothing (end-of-text mid-token still admits)
- [ ] Docstring + spec/05 sentence landed with the code
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer with no prior knowledge needs: the exact current loop code,
the token-char class derivation, the openTail/yield traps, the pinned tests
that must not move, and the spec sentence. All pinned below.

### Documentation & References

```yaml
- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/r4-chunk-stitching.md
  why: THE research note for this fix — all claims live-verified. Contains
        the token-char class derivation (union of the five regexes), the
        carry rule (sufficient and necessary: both junction chars in class),
        the ordered fix design (§ Recommended fix design), the tests-to-keep
        list with line numbers, risks (unbounded carry, unicode seams,
        surrogate pairs), and the spec-drift analysis.
  section: "Boundary-char definition & carry rule" + "Recommended fix design"

- file: src/pi/ingest.ts (~L388-434)
  why: processText + the slice loop. Loop at L403-407: slice → split("\n")
        → finalized segments via appendSegment/admitSegment → tail segment
        appended → BUG-004 disable check → await this.#yieldFn(). Docstring
        to replace at L388-391. WHITESPACE_GAP_RE at L129 (consts go near
        it). #admitSegment at ~L465 tokenizes slice-locally (maskSecrets →
        tokenize per '\n'-free segment).
  pattern: the openLine/openTail carry already in the loop — the token
        carry is its structural mirror.
  gotcha: TRAP 1 — trim the raw tail BEFORE appendSegment sees the slice
        (carried chars must never enter openTail accounting).
  gotcha: TRAP 2 — the per-iteration `await this.#yieldFn()` fires even for
        an emptied slice (pinned test).

- file: src/core/segment.ts (L75-101)
  why: the five tokenize regexes whose union is exactly
        [A-Za-z0-9._@:+/~=-] — BASE_RE (adds _), HEXISH_RE (subset),
        FILENAME_RE (adds .), HYPHEN_RE (adds -), LITERAL_RE
        (._@:+/~=-). TOKEN_CHAR_RE must stay in sync with these; comment
        cross-references both.

- file: test/ingest-pipeline.test.ts
  why: the chunking tests that PIN current-correct behavior and must stay
        green UNCHANGED: :197 yield-count (15 slices → 15 yields), :208 one
        ordinal per multi-chunk message, :336 drain-reuse (chunkBytes 21),
        :523 whitespace-gap boundary still chains, :541 punctuation-gap
        boundary still breaks, :554 '\n'-only run breaks. Gap/punctuation
        boundaries produce no carry (junction char not in class) so these
        pass by construction — verify, don't edit.

- file: spec/05-ingestion-pipeline.md (L30-36)
  why: "Chunked processing" section receiving the carry sentence. The ≤64KB
        clause stays true: slices are READ at ≤64KB; the bounded (≤1KB)
        carry is prepended before processing (moved between turns, not
        extra text per turn).

- file: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/P1M2T2S1/PRP.md
  why: PARALLEL task — suppression-leak fix in src/pi/widget.ts. ZERO file
        overlap with this task (ingest.ts + spec/05 + one test). No
        coordination needed.
```

### Current Codebase tree (relevant)

```bash
src/pi/ingest.ts            # processText slice loop — the change site
src/core/segment.ts         # five tokenize regexes — READ ONLY (class source)
spec/05-ingestion-pipeline.md  # "Chunked processing" — one sentence added
test/ingest-pipeline.test.ts   # one repro test added; pinned tests verified
```

### Desired Codebase tree

```bash
src/pi/ingest.ts            # MODIFIED: TOKEN_CHAR_RE/MAX_CARRY consts, carry loop, docstring
spec/05-ingestion-pipeline.md  # MODIFIED: carry sentence
test/ingest-pipeline.test.ts   # MODIFIED: one straddle repro test
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: trim the RAW part's tail BEFORE appendSegment/openTail sees the
// slice, or carried token chars pollute openTail and non-whitespace gap
// detection WRONGLY BREAKS the run ('zorpwibble quuxblat' regression).
// CRITICAL: never trim into the PREPENDED previous carry (it was already
// class-boundary-trimmed); carry-once semantics.
// CRITICAL: `await this.#yieldFn()` every iteration — test at :197 pins
// yields === slice count.
// CRITICAL: cap the carry at MAX_CARRY=1024 — a >64KB identifier would
// otherwise grow it unbounded (loop advance stays chunkBytes regardless).
// The carried run contains no '\n' (not a class char) — prepending before
// split("\n") cannot merge lines.
// Final slice: k=0 — end-of-text mid-token admits whole (regexes have no
// right anchor); this restores single-slice semantics exactly.
// MAX_CARRY < chunkBytes, so a fully-carried (empty) slice is impossible;
// keep the unconditional yield anyway.
// maskSecrets stays per-segment: a secret straddling the seam stays
// unmaskable (documented limitation, NOT fixed here).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD consts to src/pi/ingest.ts (~L154, near WHITESPACE_GAP_RE)
  - TOKEN_CHAR_RE + MAX_CARRY with the sync-comment (code above).

Task 2: RESTRUCTURE the processText slice loop (~L403)
  - let carry = ""; const raw = text.slice(...); non-final k = capped
    trailing class-run; slice = carry + raw.slice(0, len-k); carry =
    nextCarry; existing split/appendSegment/#admitSegment machinery
    UNCHANGED downstream; unconditional await this.#yieldFn().
  - PRESERVE: BUG-004 disable check after each slice; ordinal-once
    semantics; runs.push at line finalization; #onAdmittedTokens hook.

Task 3: REPLACE the stale docstring (~L388-391) with the carry contract
  (boundary never splits a token; carried tokenized once; run carry
  parallel; MAX_CARRY bound; documented seam limitations).

Task 4: ADD spec sentence to spec/05-ingestion-pipeline.md (~L30-36)

Task 5: ADD one repro test to test/ingest-pipeline.test.ts
  - small-chunk analogue (chunkBytes ~8, seam inside 'Zorpwibble'):
    store.get('zorpwibble') defined, 'ibble' undefined, successor
    'quuxblat' chained. Full battery = P1.M2.T3.S2 (do NOT write it here).

Task 6: VALIDATE — npm run check && npm test
```

### Implementation Patterns & Key Details

```typescript
// The loop core (illustrative — keep surrounding comments/structure):
let carry = "";
for (let off = 0; off < text.length; off += this.#chunkBytes) {
  const raw = text.slice(off, off + this.#chunkBytes);
  const nonFinal = off + this.#chunkBytes < text.length;
  let k = 0;
  if (nonFinal) {
    while (k < raw.length && k < MAX_CARRY &&
           TOKEN_CHAR_RE.test(raw[raw.length - 1 - k]!)) k++;
  }
  const slice = carry + raw.slice(0, raw.length - k);
  carry = raw.slice(raw.length - k);
  // ... existing split("\n") / appendSegment / #admitSegment on `slice` ...
  await this.#yieldFn(); // ALWAYS — pinned yield count
}
// carry is now empty (final slice carried nothing) — nothing to flush.
```

### Integration Points

```yaml
INGEST: restore replay (restoreFromHistory) calls processText directly —
  it inherits the fix for free (per-message replay, boundaries only occur
  on >64KB single messages).
PERF: spec/02 "Ingest chunk yield granularity ≤64KB per event-loop turn"
  stays true (carry is moved BETWEEN turns, ≤1KB); do not shrink the read
  size — optional tightening explicitly not required.
PARALLEL: P1.M2.T2.S1 touches src/pi/widget.ts — no overlap.
DOWNSTREAM: P1.M2.T3.S2 (regression battery) consumes this fix; leave the
  broad boundary-matrix testing to it.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/ingest-pipeline.test.ts
npx vitest --run test/ingest-restore.test.ts test/adversarial-ingest.test.ts
npm test        # full suite green
```

### Level 3: Integration

```bash
# The exact issue repro (real chunk size) — one-off node harness or a test:
# 135KB message, 'Zorpwibble' at offset 65536 → store holds zorpwibble,
# not 'ibble'; topSuccessors('zorpwibble') includes 'quuxblat'.
npx vitest --run test/ingest-pipeline.test.ts -t "chunk boundary"
```

### Level 4: Domain-specific

Diff audit: production changes confined to ingest.ts consts + loop + docstring.
Pinned tests :197/:208/:336/:523/:541/:554 pass UNEDITED. Spec/05 sentence
present. No changes to segment.ts, store.ts, or the run layer.

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green
- [ ] Straddling token admitted whole; junk half absent; bigram chains across the boundary
- [ ] openTail excludes carried chars (run stitching verified)
- [ ] Yield count = slice count (pinned test untouched and green)
- [ ] MAX_CARRY cap present; final slice carries nothing
- [ ] Docstring replaced; spec/05 sentence landed with the code
- [ ] No edits to the six pinned chunking tests; no changes outside ingest.ts/spec/test

## Anti-Patterns to Avoid

- ❌ Don't let carried chars enter openTail (run-break trap)
- ❌ Don't skip or condition the per-slice yield
- ❌ Don't re-trim the prepended carry (double-carry/double-admission)
- ❌ Don't anchor the segment regexes or touch segment.ts (class stays a mirror)
- ❌ Don't write the S2 regression battery here — one repro test only
- ❌ Don't "fix" seam-straddling secrets or unicode-rule-3 seams (documented limitations)

## Confidence Score: 9/10

The r4 research note pre-verified every claim (line numbers, traps, pinned
tests, risks) and supplies the exact class derivation, loop shape, and spec
sentence. The only execution risk is careless loop ordering — mitigated by
the two CRITICAL traps called out at every level.
