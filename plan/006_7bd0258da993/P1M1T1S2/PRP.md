# PRP — P1.M1.T1.S2 (plan 006): Uppercase-run walk + enriched onAdmittedTokens payload

---

## Goal

**Feature Goal**: Implement spec/04 h2.26 run DETECTION in the ingest
pipeline: maximal sequences of ≥2 consecutive whole tokens on the same
line, every token beginning with an uppercase ASCII letter, separated by
nothing but plain spaces/tabs (the same strict adjacency window as
bigrams — plus a conservative masked-secret break). Widen the
`onAdmittedTokens` payload from `string[][]` to runs of
`{ key, rawCasing }` members (serializable), with the index.ts wiring
shimmed so `recordBigramRuns` keeps compiling and all tests stay green
until P1.M1.T2.S2 consumes the enrichment.

**Deliverable**:
- Enriched `SpanEntry` (occurrence casing + run-safe gap info) in
  `src/pi/ingest.ts`
- New run walk (a `splitRuns` sibling, e.g. `detectCapRuns`) producing
  `RunMember[][]`
- Widened `IngestPipelineOptions.onAdmittedTokens` contract + JSDoc (Mode A)
- Adapted wiring at `src/pi/index.ts:211` (shim: members → keys for
  `recordBigramRuns`)
- Run-detection battery (window breaks incl. comma, secret split,
  masked-secret split, line-initial runs, ≥2 floor, rawCasing)

**Success Definition**: `processText('Visit National Renewable Energy
Laboratory today')` delivers a run of `national/renewable/energy/
laboratory` members with their raw casings to the hook;
`ZorpWibbleEngine, quuxblat` yields NO run; a masked secret between two
capitals splits the run; `recordBigramRuns` still receives the exact
string[][] it receives today; `npm run check` + `npm test` green.

## Why

Spec goals 11–12 (capitalized-series completion): consecutive capitalized
words are proper-noun series — every member becomes completable vocabulary
and the words chain. The admission override (P1.M1.T3.S1) and series
bigrams (P1.M1.T2.S2) both consume a run-membership payload; nothing
downstream can exist until the pipeline detects runs and carries them out.
Run detection deliberately ignores structural-start (the capitals of the
second+ words cannot be orthographic) — a simpler predicate than S1's
CasingClass split, evaluated at the span site.

## What

### Run rule (spec 04 h2.26, verbatim semantics)

A run = maximal sequence of **≥2 consecutive whole tokens on the same
line** where:
- every token's raw text **begins with an uppercase ASCII letter**
  (`A`–`Z`) — structural-start position is IRRELEVANT here (line-initial
  and after-punctuation runs count);
- adjacent members separated by **nothing but plain spaces/tabs** — the
  SAME strict adjacency window as bigrams: clause punctuation
  (`,` `;` `:` `.` …), quotes/brackets, digits/hexish/symbols, any
  intervening word (admitted or not), and newlines all break;
- each member passed the shape gate (gate-rejected members emit no span
  entry, and their raw bytes then sit in the gap → breaks naturally);
- **masked-secret break (conservative, mandated)**: layer-1 `maskSecrets`
  blanks secret windows to SPACES, so the masked gap around a removed
  secret looks like pure whitespace. For RUNS this must still break (a
  masked secret between two capitalized words must not chain them),
  even though bigram adjacency accepts it (existing, documented behavior
  — unchanged). See Implementation for the raw-gap mechanism.

### Payload widening

```typescript
/** One run member in the onAdmittedTokens payload (spec §04 h2.26). */
export interface RunMember {
  /** lowercase store key (as today) */
  key: string;
  /** the token's casing as seen in the raw text this occurrence
   *  (e.g. "National") — run casing for series-bigram display. */
  rawCasing: string;
}

// IngestPipelineOptions:
onAdmittedTokens?: (runs: readonly (readonly RunMember[])[]) => void;
```

`src/pi/index.ts:211` becomes:

```typescript
onAdmittedTokens: (runs) =>
  sessionStore.recordBigramRuns(runs.map((r) => r.map((m) => m.key))),
```

— a pure shim; `recordBigramRuns` and `store.ts` are UNTOUCHED this task
(the store consumes the enrichment in P1.M1.T2.S2). Note the hook is now
invoked for BOTH purposes (bigram runs + cap runs): cap runs are a SUBSET
of adjacency runs restricted to uppercase-initial members — decide the
payload shape (see Implementation Decision 2) and document it on the hook.

### Implementation decisions (binding)

1. **Where casing comes from**: derive at the span site from the token's
   raw text (`isUpperAscii(rawFirstChar)`) and/or thread S1's
   `draft.casing` into SpanEntry. The uppercase-first-char predicate is
   EXACT for run membership (structural-start irrelevant) — the simplest
   correct implementation is enriching `SpanEntry` with the occurrence's
   raw/display string (or a boolean + rawCasing) at the `#admitSegment` /
   `appendSegment` boundary, where the segment text and spans are in hand.
2. **One stream or two**: EITHER (a) keep `splitRuns` (bigrams, keys-only,
   masked-gap semantics) and add a parallel `detectCapRuns(openLine)` over
   the SAME enriched SpanEntries using raw-gap purity, OR (b) build both
   run kinds in one pass and let the hook carry members (bigram consumers
   filter). (a) is lower-risk: bigram behavior provably byte-identical.
   Recommend (a); pin bigram payload equality with a test.
3. **Masked-secret break mechanism**: the token spans index the RAW
   segment identically (maskSecrets is length-preserving). Compute the
   cap-run gap purity against the RAW segment (appendSegment already has
   `r.masked`; it needs the raw segment too — thread it through from
   `#admitSegment`, which receives the pre-mask segment). A raw gap that
   is not `/^[ \t]+$/` breaks the cap run — masked secret windows contain
   their non-whitespace bytes in raw → break. Prose gaps are identical in
   raw and masked, so this is strictly stricter and exactly right. Do NOT
   use space-count heuristics (multi-space prose is legal).

### Success Criteria

- [ ] `'Visit National Renewable Energy Laboratory today'` → one run of
      4 members, keys lowercase, rawCasing preserved (`National`…)
- [ ] Run floor ≥2: a single capitalized word emits NO run
- [ ] `'ZorpWibbleEngine, quuxblat'` → no run (comma break)
- [ ] Line-initial `'Alpha Beta gamma'` → run `[alpha? no — Alpha Beta]`
      (lowercase member breaks; run = the 2 uppercase members)
- [ ] After-punctuation run detected (`'Done. Alpha Beta'` → run)
- [ ] Intervening word breaks: `'Alpha the Beta'` → no run
- [ ] Secret-shaped member splits: a `sk-...` token between capitals →
      run broken around it (gate-rejected → gap pollution)
- [ ] Masked-secret split pinned: two capitals separated ONLY by a
      layer-1-masked secret → NO run (raw-gap purity)
- [ ] Newline breaks; chunk boundary does NOT (64KB seam keeps a run)
- [ ] Bigram payload at recordBigramRuns byte-identical to today (shim)
- [ ] `npm run check` + `npm test` green; store.ts untouched

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the SpanEntry/splitRuns/
appendSegment/processText machinery is described with verified line
anchors and semantics, the run rule and its break matrix are enumerated,
the masked-secret mechanism (raw-gap purity) is pre-solved, and the test
conventions (in-memory dictionary doubles, hook spy) are documented.

### Documentation & References

```yaml
- file: src/pi/ingest.ts
  why: PRIMARY file. Verified structure:
    - SpanEntry (:109-122): { key, start, end, gapBefore } — ENRICH
      (occurrence raw/display or casing + whatever the raw-gap check
      needs). gapBefore today is computed from the MASKED segment.
    - WHITESPACE_GAP_RE = /^[ \t]+$/ (:128) — reuse for both walks.
    - splitRuns (:176-189): keys-only bigram runs — UNCHANGED (option (a)).
    - appendSegment (:206-247): computes gapBefore; "GAP PROVENANCE"
      comment documents the masked-text gap choice (accepted for
      bigrams). READ IT — your raw-gap addition amends exactly this
      contract. Segments with no admitted tokens extend openTail with
      their whole masked text (punctuation survives to break runs).
      Needs the RAW segment threaded in for the raw-gap computation.
    - processText (:416-497): line/openLine/openTail/carry loop; collects
      `runs: string[][]`; calls this.#onAdmittedTokens?.(runs) ONCE per
      message at the end. Add the cap-run collection beside it (same
      finalized-line moments: splitRuns call sites).
    - IngestPipelineOptions.onAdmittedTokens (:~258): JSDoc documents
      the string[][] bigram contract — REWRITE for the widened payload
      (Mode A), documenting both consumer kinds and the shim.
    - #admitSegment: runs maskSecrets → tokenize → ... → entries; its
      SegmentResult carries masked + entries. Thread the raw segment out
      (or compute raw-gap flags there) — spans index both strings.
  pattern: pure helper functions over SpanEntry[] (splitRuns style) —
    detectCapRuns should be an equally pure, unit-testable sibling.
  gotcha: gate-rejected tokens emit NO entry — their raw text lands in
    the FOLLOWING entry's gapBefore → the comma/secret/symbol breaks all
    fall out of gap purity; do not add token-level rejection logic.

- file: plan/006_7bd0258da993/P1M1T1S1/PRP.md
  why: CONTRACT for CasingClass (lower | mid-cap | structural-cap) on
    CandidateDraft.casing + Sighting.casing. NOTE: the run predicate is
    deliberately COARSER than the class — "uppercase first char" covers
    mid-cap AND structural-cap; structural-start does not exclude run
    membership (spec h2.26). You MAY thread draft.casing into SpanEntry
    (then membership = casing !== "lower") OR derive isUpperAscii at the
    span site — either is exact; do not consult sentenceStart.
  gotcha: if CasingClass is absent (S1 not landed), STOP.

- file: src/pi/index.ts
  why: the wiring site (:211) — apply the shim exactly as in "What";
    the surrounding comment (:201, "recordBigramRuns is the ONLY
    successor-index path") needs a one-line update noting the enriched
    payload + shim until T2.S2.

- file: src/core/store.ts
  why: recordBigramRuns(runs: readonly string[][]) at :536 — MUST KEEP
    COMPILING UNCHANGED (shim at the call site; the store consumes
    RunMember in P1.M1.T2.S2). Do not touch store.ts.

- docfile: plan/006_7bd0258da993/architecture/01-core-pipeline-r1.md
  sections: §3 (casing info today), §9 (maskSecrets layer-1 pitfall —
    the masked-secret break mandate), and the adjacency machinery notes.
  why: The verified recon behind this contract, including why the
    masked-secret break needs raw-gap knowledge rather than the masked
    gap.

- file: test/ingest.test.ts + test/ingest-pipeline.test.ts
  why: TDD targets. Conventions: in-memory Dictionary doubles
    ({ lookup: () => null } or a small map), IngestPipeline constructed
    with { store, dictionary, onAdmittedTokens: spy }, direct
    processText(text, fromUser) calls (bypasses debounce), assertions on
    the spy's captured runs. Add the battery here (or a dedicated
    cap-runs describe block in ingest-pipeline.test.ts).
  gotcha: chunk-boundary test needs chunkBytes override + a text whose
    line straddles the seam (existing BUG-004 tests show the recipe).

- prd: spec/04 h2.26 Capitalized runs + h3.6 Bigram capture window rules
  + goals h2.9 items 11-12 (reproduced in selected_prd_content).
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/pi/ingest.ts        # MODIFY — SpanEntry enrichment, detectCapRuns, hook widening, JSDoc
├── src/pi/index.ts         # MODIFY — :211 shim + comment
├── src/core/{types,segment,store}.ts  # untouched (S1 fields exist; store consumes in T2.S2)
└── test/ingest-pipeline.test.ts        # MODIFY — run-detection battery
```

### Desired Codebase tree with files to be changed

```bash
src/pi/ingest.ts             # RunMember export, detectCapRuns, enriched SpanEntry, hook JSDoc
src/pi/index.ts              # :211 shim (runs.map(r => r.map(m => m.key)))
test/ingest-pipeline.test.ts # +1 describe block (~10 its)
```

### Known Gotchas of our Codebase & Library Quirks

```python
# CRITICAL — masked-secret break: the masked gap is pure whitespace by
#   construction (" ".repeat) — testing the MASKED gap CANNOT detect it.
#   Test the gap purity against the RAW segment (spans index both; prose
#   gaps are identical in raw and masked, so raw is strictly stricter and
#   exactly right). Never use space-count heuristics.
# CRITICAL — structural-start does NOT exclude run members (spec h2.26):
#   line-initial 'Alpha Beta' IS a run. Membership = uppercase first
#   ASCII char of the occurrence's raw text, nothing else.
# CRITICAL — runs need >= 2 members; a lone capitalized word is NOT a
#   run (pin it).
# GOTCHA — keep splitRuns/bigram behavior BYTE-IDENTICAL (option (a)):
#   the bigram walk keeps masked-gap semantics; only the cap-run walk
#   uses raw-gap purity. Pin payload equality at recordBigramRuns.
# GOTCHA — gate-rejected members need no special logic: their raw bytes
#   pollute the gap → break. But verify the SECRET case specifically —
#   layer-2 token-secret rejection and layer-1 masking are DIFFERENT
#   paths; both must break runs (secret-shaped member = gate-rejected
#   between capitals; masked-secret = layer-1 window, no token at all).
# GOTCHA — chunk boundary never breaks a run (openLine/openTail carry);
#   a newline always does. A path token can be uppercase-initial
#   ('/home/User/...') — it enters runs like any whole token if its
#   DISPLAY starts uppercase; classify on the occurrence's first char of
#   the token span text (spec: "every token beginning with an uppercase
#   ASCII letter" — token-level, no class exceptions).
# GOTCHA — processText's runs collection happens at finalized-line
#   moments + the final unterminated line; the cap-run walk must run at
#   the SAME moments over the same openLine (off-by-one = dropped runs
#   at message end).
# GOTCHA — the hook fires ONCE per message with ALL runs; keep that
#   contract (index.ts and tests rely on it). Empty text never calls it.
# GOTCHA — RunMember must be serializable plain data ({key, rawCasing}) —
#   no spans, no class instances (the payload crosses the ingest→store
#   seam and is asserted with toEqual in tests).
# GOTCHA — perf: the walk is O(entries) per line with O(1) per-entry
#   checks (gap regex already computed for bigrams; raw-gap test is one
#   more regex per finalized line) — do NOT add per-token text scans.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies, TDD)

```yaml
Task 0: PRECONDITION
  - Confirm S1 landed: CasingClass exported, CandidateDraft.casing /
    Sighting.casing exist (npx vitest --run test/segment.test.ts -t casing
    → green). If absent, STOP.

Task 1: TDD — ADD the battery FIRST (test/ingest-pipeline.test.ts)
  - describe("capitalized-run detection (spec §04 h2.26)") with the
    Success Criteria cases; spy onAdmittedTokens; in-memory dict double.
    Also: "recordBigramRuns payload byte-identical via the index shim" —
    unit-level: feed the widened hook output through the shim mapping and
    toEqual today's string[][] expectation on a mixed text.
  - RUN → RED.

Task 2: IMPLEMENT RunMember + SpanEntry enrichment (ingest.ts)
  - export interface RunMember { key: string; rawCasing: string }
  - SpanEntry gains the occurrence's raw text (or rawCasing + a
    uppercase-first boolean) and a raw-gap-pure flag — computed in
    #admitSegment/appendSegment where both raw and masked text live.
  - Update the GAP PROVENANCE comment: masked gaps for bigrams, raw gaps
    for cap runs (the deliberate divergence).

Task 3: IMPLEMENT detectCapRuns (pure sibling of splitRuns)
  - walk the enriched entries: break on !WHITESPACE_GAP_RE.test(gap)
    (masked), on raw-gap impurity, on non-uppercase member, on line
    boundaries (inherent — runs never span openLine flushes); collect
    maximal >=2 sequences as RunMember[].

Task 4: WIRE into processText + widen the hook
  - Collect capRuns at the same finalized-line moments as runs; call the
    widened onAdmittedTokens with the member runs (decide: one payload
    carrying both kinds per Decision 2(a) — recommended: pass the MEMBER
    runs; the bigram shim at index.ts derives keys; splitRuns' keys-only
    output remains internal or is derived from members — keep the
    recordBigramRuns input byte-identical).
  - REWRITE onAdmittedTokens JSDoc (Mode A): payload contract, both
    consumer kinds, the shim note, spec anchors (04 h2.26, 06 h3.6).

Task 5: ADAPT src/pi/index.ts:211 (shim per "What") + comment line.

Task 6: FULL REGRESSION
  - npm run check
  - npx vitest --run test/ingest-pipeline.test.ts test/ingest.test.ts
    test/ingest-restore.test.ts test/index.test.ts
  - npm test   # perf gate c must stay green (walk is O(entries))
```

### Implementation Patterns & Key Details

```typescript
// detectCapRuns sketch (pure, splitRuns-style):
function detectCapRuns(entries: SpanEntry[]): RunMember[][] {
  const runs: RunMember[][] = [];
  let cur: RunMember[] = [];
  const flush = () => { if (cur.length >= 2) runs.push(cur); cur = []; };
  for (const e of entries) {
    const breaks =
      cur.length > 0 &&
      (!WHITESPACE_GAP_RE.test(e.gapBefore) || !e.gapRawPure);
    const member = e.upperFirst; // occurrence raw[0] is A-Z
    if (breaks || !member) flush();
    if (member) cur.push({ key: e.key, rawCasing: e.rawCasing });
  }
  flush();
  return runs;
}
// gapRawPure: computed at appendSegment from the RAW segment slice —
// the masked-secret break. Pure prose spaces are pure in both strings.

// The index shim (byte-identical bigram input):
onAdmittedTokens: (runs) =>
  sessionStore.recordBigramRuns(runs.map((r) => r.map((m) => m.key))),
```

### Integration Points

```yaml
DOWNSTREAM (do NOT implement):
  - P1.M1.T3.S1 (admission override + chain-only set): consumes run
    membership (the payload's key set).
  - P1.M1.T2.S2 (series bigrams): consumes members incl. rawCasing;
    replaces the index shim.
STORE: recordBigramRuns untouched this task (shim preserves its input).
PERF: gate c (800KB ingest < 60ms budget, 180ms CI) must stay green —
  the walk adds O(entries) with regex checks already computed per gap.
SPEC: h2.26 is adopted-ahead-of-implementation — code lands with the
  spec; no spec edit needed in this task beyond Mode-A JSDoc.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check
```

### Level 2: Unit Tests (TDD)

```bash
npx vitest --run test/ingest-pipeline.test.ts -t "capitalized-run" -v
npx vitest --run test/ingest-pipeline.test.ts test/ingest.test.ts
npm test
```

### Level 3: Integration (wiring + restore path)

```bash
npx vitest --run test/index.test.ts test/ingest-restore.test.ts
# the shim keeps the store path identical; restore replays deliver the
# same payloads
```

### Level 4: Domain-Specific (spec exemplars)

```bash
npx vitest --run test/ingest-pipeline.test.ts -t "capitalized-run" -v
# The spec's own series: National Renewable Energy Laboratory — one run,
# 4 members, rawCasings preserved; every break rule pinned per the
# battery list.
```

## Final Validation Checklist

- [ ] RunMember payload exported + documented; onAdmittedTokens JSDoc rewritten
- [ ] detectCapRuns pure sibling of splitRuns; bigram walk byte-identical
- [ ] Break matrix pinned: comma/punct, quotes, symbols/digits, intervening
      word, newline, secret-shaped member, MASKED secret (raw-gap), lowercase
      member, <2 floor
- [ ] Line-initial + after-punctuation runs detected (no structural-start exclusion)
- [ ] Chunk boundary does not break (carry test)
- [ ] index.ts:211 shim; recordBigramRuns input byte-identical; store.ts untouched
- [ ] Perf gate c still green; walk is O(entries), no new text scans
- [ ] `npm run check` + full `npm test` green; only ingest.ts, index.ts, tests touched

## Anti-Patterns to Avoid

- ❌ Don't apply the structural-start exclusion to run detection (spec forbids)
- ❌ Don't test the masked gap for the secret break — raw gap only
- ❌ Don't use space-count heuristics for masked secrets
- ❌ Don't change splitRuns/bigram semantics or store.ts (shim preserves them)
- ❌ Don't emit runs of length 1 (floor ≥2)
- ❌ Don't add token-level gate logic — gap pollution handles rejected members
- ❌ Don't put spans or class instances in RunMember (serializable payload only)
- ❌ Don't add unbounded text scans (perf-gate history)

---

**Confidence Score**: 9/10 — the adjacency machinery (SpanEntry, splitRuns,
appendSegment, processText) was read from live source with its masked-gap
provenance comment; the masked-secret break mechanism (raw-gap purity) is
pre-solved; S1's contract bounds the classification inputs; the only
open implementation freedom (enrichment shape / one-vs-two walks) is
decided with a low-risk recommendation and a byte-identical pin.
