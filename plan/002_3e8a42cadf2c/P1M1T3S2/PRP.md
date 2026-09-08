# PRP — P1.M1.T3.S2 (plan 002): ingest.ts adjacency runs + onAdmittedTokens contract + break-case suite

---

## Goal

**Feature Goal**: Implement PRD §06 h3.6 (raw-text adjacency, strictly) in
`src/pi/ingest.ts`: split each line's admitted whole-token keys into
**adjacency RUNS** — a run breaks between two consecutive admitted tokens
unless the raw gap between them is plain spaces/tabs (`/^[ \t]+$/`) on the
same line. Change `onAdmittedTokens` to emit **runs** (still `string[][]`,
still exactly one call per message) so the existing wiring
`recordBigramRuns(lines)` becomes semantically correct (today it treats whole
lines as single runs — the stopword-bridging bug this task kills).

**Deliverable**:
- `src/pi/ingest.ts`: `#admitSegment` returns span-carrying entries
  (`{ key, start, end }[]` + the masked segment string) instead of bare keys;
  `processText` computes gaps and emits runs.
- `src/pi/index.ts`: comment/doc updates only (wiring line already calls
  `recordBigramRuns`).
- `test/ingest-pipeline.test.ts`: the `onAdmittedTokens` describe block
  rewritten as the exhaustive adjacency-window suite (every PRD-enumerated
  break case + chain cases + chunk-boundary + repeated-count cases).

**Success Definition**: `npm run check` and `npm test` green;
`"United States of America"` emits `[[united states], [america]]`;
`` `A` `B` `` never chains; `ZorpWibbleEngine, quuxblat` never chains;
`v2 release` does not chain `v2`→`release`; plain `"zephyr  deltaWave"`
chains (tabs included); runs carry correctly across 64 KiB chunk boundaries
with whitespace-only tails, and break across boundaries with punctuation.

## Why

- PRD 002 delta R1 removed the phrase layer; the ONLY M2 structure is the
  successor index built from **strict-adjacency** bigrams. Feeding it whole
  lines (current behavior) creates stopword bridges — exactly the
  `ZorpWibbleEngine, the quuxblat` bug class the PRD calls out as the reason
  for the strict rule.
- P1.M1.T3.S1 (in flight, CONTRACT) extends `RawToken` with `start`/`end`
  (UTF-16 offsets into the string passed to `tokenize`). This task is the
  consumer: it pairs admitted whole-token drafts with those offsets.
- Downstream: the successor index (already live in `recordBigramRuns` /
  `topSuccessors`) feeds P1.M2.T1.S1 (chain machine) and is verified
  end-to-end by P1.M1.T3.S3.

## What

### Semantics

- `#admitSegment` (currently returns `string[]` of keys, ~lines 336–417):
  return `{ masked: string; entries: { key: string; start: number; end: number }[] }`.
  - `masked` = the post-`maskSecrets` segment string it already computes;
    offsets come from `tokenize(masked)` so they are valid slice bounds of
    `masked`. **maskSecrets is length-preserving** (verified:
    `shapeGate.ts:460` — `" ".repeat(m.length)` per match), so offsets also
    line up with the raw segment. Add a comment documenting: *all gaps are
    taken against the MASKED segment; a masked secret becomes spaces, so two
    words around a removed secret look adjacent — accepted: the secret's
    bytes are gone, the gap is real whitespace.*
  - Admission gates, stats, subword handling, store upserts: **unchanged**.
    Only the collected return shape changes. Entries are whole tokens only
    (`!draft.isSubword`), in document order.
- `processText` line assembly (currently `lines: string[][]`, `openLine`):
  - Keep `openLine` as span entries plus a carried `openTail: string`
    (newline-free masked text after the line's last admitted token — spans
    chunk boundaries).
  - Per newline-free segment from `#admitSegment`: compute each entry's
    `gapBefore`:
    - first entry with a carried open line:
      `openTail + masked.slice(0, entry.start)`
    - subsequent entries in the same segment:
      `masked.slice(prevEnd, entry.start)`
    - first entry of a line (nothing carried): `""` (starts a run)
    - update `openTail = masked.slice(lastEntry.end)` per segment.
  - On line finalize (newline segment end / end of message): walk entries;
    start a NEW run whenever `gapBefore` does NOT match `/^[ \t]+$/`
    (including the empty gap of a line's first entry → first entry always
    opens a run). Emit the runs.
  - Chunk-boundary note: a slice boundary never splits a line's run logic —
    the gap check uses concatenated carried text, so `"word   " | "   word"`
    across the 64 KiB edge chains exactly like a same-slice gap.
- `onAdmittedTokens` hook: **same type** `(runs: string[][]) => void`, same
  one-call-per-message shape (after the last slice), but each inner array is
  now one adjacency RUN, not a whole line. Update its JSDoc in
  `IngestPipelineOptions` and the class doc comment (they currently say
  "per-LINE arrays … a newline is the only window break").
- `src/pi/index.ts` (line ~181): the wiring
  `onAdmittedTokens: (lines) => sessionStore.recordBigramRuns(lines)` stays
  functionally identical — rename the param to `runs` and fix the comment
  ("builds its word → top-3 successor index inside recordBigramRuns" is
  still true).

### Success Criteria

- [ ] `"United States of America"` → runs `[["united","states"],["america"]]` (intervening "of" — a rejected common word — leaves non-whitespace gap text, breaking the run)
- [ ] `` `A` `B` `` (backtick-quoted) → `[["a"],["b"]]`; words entering/leaving quotes/brackets never chain
- [ ] `ZorpWibbleEngine, quuxblat` → no `zorpwibbleengine quuxblat` bigram; same for `; : . ! ? — – … |`
- [ ] `v2 release` → no `v2 release` bigram (digit run between); `/ \ = + & % # * @ - ~ ^` each break
- [ ] `zephyr  deltaWave` (space+tab) chains: `[["zephyr","deltawave"]]`
- [ ] Newline breaks (existing behavior preserved); empty lines produce nothing (runs of ≥1 word only — do NOT emit empty run arrays for empty lines; contrast with old per-line shape which emitted `[]` per empty line)
- [ ] One `onAdmittedTokens` call per message; store/stats/counters identical to current behavior (only run-splitting is new)
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

"Yes" for an implementer who reads this PRP plus `src/pi/ingest.ts` and
`test/ingest-pipeline.test.ts`: every change site (with current line
references), the gap algorithm, the masking caveat, the chunk-boundary carry
design, and the exhaustive test matrix are specified below.

### Documentation & References

```yaml
- file: src/pi/ingest.ts
  why: the change site. #admitSegment (~336–417) currently `keys.push(draft.key)`
        and returns string[]; processText (~262–292) builds `lines: string[][]`
        with `openLine` carry and calls `this.#onAdmittedTokens?.(lines)` (290).
        Options/JSDoc for the hook at ~129 & ~147.
  gotcha: keep ALL admission/stats/store logic byte-identical; only the
        collected shape and line assembly change. Keep the BUG-004 disable
        checks exactly where they are.

- file: plan/002_3e8a42cadf2c/P1M1T3S1/PRP.md
  why: CONTRACT — RawToken gains start/end (UTF-16, into the post-maskSecrets
        segment). Assume implemented exactly; this task consumes the fields.
  gotcha: for hexish tokens the spans are the hexish span's own offsets.

- file: plan/002_3e8a42cadf2c/architecture/ingest_segment_map.md
  why: maps the two places position info is lost; §"NOT in ingest.ts" notes
        the hook signature. (Line numbers pre-date current code — trust code.)

- file: src/core/store.ts (recordBigramRuns, ~447)
  why: the consumer — already takes `readonly string[][]` and counts every
        ADJACENT pair within each inner array. Feeding it runs (instead of
        lines) is the entire fix. No store changes in this task.

- file: src/pi/index.ts (~173–182)
  why: the existing wiring — comment-only updates.

- file: test/ingest-pipeline.test.ts (describe "onAdmittedTokens — per-line
        n-gram hook" ~335–417 and the "calls onAdmittedTokens once per
        message" case ~245)
  why: tests to rewrite. makePipeline fixture fakes the dictionary (rare
        words admit; common words reject) and injects onAdmittedTokens.
  gotcha: test words MUST pass gate+admission — use rare-ish tokens
        (zephyr, quuxblat, zorpwibbleengine, deltawave…); common words like
        "of"/"the" appear only as gap text.

- file: test/bigrams.test.ts
  why: store-level run-counting suite — UNTOUCHED by this task (it feeds
        runs directly). It stays green because recordBigramRuns is unchanged.

- file: src/core/shapeGate.ts (maskSecrets ~460)
  why: verify-in-PRP done — masks via " ".repeat(m.length): LENGTH-PRESERVING.
        Offsets valid on both raw and masked segment; document the masked-gap
        choice in a comment at the gap check.
```

### Current Codebase tree (relevant)

```bash
src/pi/ingest.ts          # modify: #admitSegment return shape + processText run assembly
src/pi/index.ts           # comment/doc touch-up only
test/ingest-pipeline.test.ts  # rewrite the onAdmittedTokens describe block
test/bigrams.test.ts      # unchanged (store-level)
```

### Desired Codebase tree

Same files — no new files. (The item text mentions "rewrite
test/phrases.test.ts"; that file does not exist in this repo — the phrase
layer was deleted in P1.M1.T2. The adjacency suite lives in the rewritten
`onAdmittedTokens` describe block of `test/ingest-pipeline.test.ts`. If a
`test/phrases.test.ts` somehow exists at implementation time, fold its cases
in there and delete it.)

### Known Gotchas of our codebase & Library Quirks

```ts
// GOTCHA: the gap regex is /^[ \t]+$/ (PLUS — ≥1 char, spaces/tabs only).
// Empty gap breaks by construction (tokens never emit adjacently, but do
// not rely on that — the regex decides).

// GOTCHA: gap text must come from the MASKED segment, and across chunk
// boundaries it spans two slices: carry openTail (masked text after the
// last admitted token, newline-free because segments split on '\n') and
// concatenate with the next segment's prefix (masked.slice(0, start)).

// GOTCHA: a masked secret becomes a whitespace gap — words around it chain.
// ACCEPTED and must be documented in a comment at the gap check (the item
// contract requires this documentation).

// GOTCHA: keep one onAdmittedTokens call per MESSAGE (after all slices),
// and the isDisabled early-exit before the hook call (BUG-004 comment at
// ~line 285) — a half-admitted message must not feed bigrams.

// GOTCHA: old behavior emitted [] arrays for empty lines; runs-of-words
// semantics should NOT emit empty inner arrays (recordBigramRuns treats
// them as no-ops anyway, but the suite asserts the cleaner shape).

// GOTCHA: subwords never enter entries (isSubword check unchanged); the
// whole token's draft.key is what appears in runs.

// GOTCHA: test fixtures — dictionary fake: lookup returns null (rare) for
// fixture words; "of"/"the"-like common words must be REJECTED by admission
// so their text stays in the gap. Check makePipeline's dictionary stub in
// test/ingest-pipeline.test.ts before writing cases.

// GOTCHA: grep for other suites asserting the old per-line shape:
//   rg -n "onAdmittedTokens" test/ — perf-gates.test.ts (~271) and
// index.test.ts (~411+) wire the hook but don't assert shape; verify after
// the change.

// NodeNext ESM: relative imports use ".js" suffix — existing convention.
```

## Implementation Blueprint

### Data model

```ts
// internal to ingest.ts (not exported unless a test needs it — export if
// the suite wants to unit-test finalize directly; prefer going through
// onAdmittedTokens):
interface SpanEntry { key: string; start: number; end: number; gapBefore: string }
// gapBefore computed at assembly time (see "What"); "" for a line's first entry.

// #admitSegment return:
interface SegmentResult {
  masked: string;                       // post-maskSecrets segment
  entries: { key: string; start: number; end: number }[]; // admitted whole tokens
}
```

### Implementation Tasks (ordered)

```yaml
Task 1: EDIT src/pi/ingest.ts — #admitSegment return shape
  - Change signature to return SegmentResult; keep `masked` (the local
    after maskSecrets) and push {key, start, end} from each RawToken whose
    whole-token draft admitted (the existing `keys.push(draft.key)` site).
  - Token spans come from the RawToken itself (t.start/t.end — CONTRACT
    from S1); the loop iterates `tokenize(masked)` so alignment is by
    construction.
  - Zero logic changes to gates/stats/upserts/disable checks.

Task 2: EDIT src/pi/ingest.ts — processText run assembly
  - Replace `lines: string[][]` / `openLine: string[]` with span-aware
    assembly: openLine: SpanEntry[], openTail: string.
  - Per segment result: compute gapBefore per "What" (first-entry-with-
    carry = openTail + masked.slice(0, start); else masked.slice(prevEnd,
    start)); append entries; openTail = masked.slice(lastEnd).
  - On finalize (each newline-terminated segment; unterminated tail at end
    of message): split entries into runs on gapBefore !~ /^[ \t]+$/; push
    each run (length ≥ 1 only) into `runs: string[][]`.
  - After the slice loop: this.#onAdmittedTokens?.(runs) — same position
    (after the BUG-004 isDisabled check inside the loop and the final flush).
  - Add the masked-gap documentation comment at the gap computation.

Task 3: EDIT src/pi/ingest.ts — hook JSDoc
  - IngestPipelineOptions.onAdmittedTokens (~129) + class doc (~147):
    describe runs semantics (PRD §06 h3.6: adjacency runs, every break
    class, one call per message, feeds recordBigramRuns).

Task 4: EDIT src/pi/index.ts
  - Param rename lines→runs at the wiring (~181) + comment touch-up. No
    behavior change.

Task 5: REWRITE test/ingest-pipeline.test.ts onAdmittedTokens block
  - Replace describe "onAdmittedTokens — per-line n-gram hook (PRD §06 M2)"
    with "onAdmittedTokens — adjacency runs (PRD §06 h3.6, P1.M1.T3.S2)".
  - Cases (assert via captured runs AND — for counting cases — by feeding
    captured runs to a real CandidateStore + topSuccessors):
    1. chains: "zephyr deltaWave", "zephyr  deltaWave" (multi-space+tab)
       → [["zephyr","deltawave"]]; a longer 3-word run yields one run of 3
       and bigrams for both pairs via recordBigramRuns.
    2. clause/punctuation: one case per `,` `;` `:` `.` `!` `?` `—` `–` `…`
       `|` (parametrized it.each) → two runs, no cross bigram.
    3. quotes/brackets: "`A` `B`" style with rare words: "`zephyr` `quuxblat`"
       → [["zephyr"],["quuxblat"]]; entering/leaving parens/brackets/braces/
       angle/"'/": "remove(zephyr quuxblat)" → inner pair chains, boundary
       words don't chain to neighbors outside.
    4. symbols: it.each over `/ \ = + & % # * @ - ~ ^` between two rare
       words → two runs.
    5. digits/hexish: "zephyr v2 quuxblat" and "zephyr 0f3a9c2 quuxblat" →
       no chain across the digit/hex gap.
    6. stopword bridging FORBIDDEN: "United States of America" →
       [["united","states"],["america"]] (assert exact runs; "of"/"the"
       rejected by admission, gap text breaks).
    7. named regression: "ZorpWibbleEngine, quuxblat" → no
       "zorpwibbleengine quuxblat" bigram (recordBigramRuns +
       topSuccessors("zorpwibbleengine") empty).
    8. newline: multi-line message → runs per line; blank lines yield
       nothing; one onAdmittedTokens call total.
    9. chunk boundary: chunkBytes small (fixture uses chunkBytes option),
       line split mid-gap: "zephyr   " + "   quuxblat" across slices →
       chains; "zephyr, " + " quuxblat" → breaks. (Re-pointed existing case.)
    10. repeated windows: same text in two messages → topSuccessors counts
        double (re-pointed existing repeated-window-count case).
    11. absent hook = no-op (keep existing case).
    12. subwords excluded: "deltaWave" run contains "deltawave" only
        (keep whole-token-only assertion).
  - Fix the "calls onAdmittedTokens once per message with per-line
    whole-token keys" case (~245) to the runs shape.

Task 6: REGRESSION sweep
  - rg -n "onAdmittedTokens" test/ src/ — repair any stale per-line
    expectation (perf-gates, index, adversarial suites should pass as-is).
  - npm run check && npm test.
```

### Implementation Patterns & Key Details

```ts
// Run splitting (pure, at finalize time):
function splitRuns(entries: SpanEntry[]): string[][] {
  const runs: string[][] = [];
  let cur: string[] = [];
  for (const e of entries) {
    if (cur.length > 0 && !/^[ \t]+$/.test(e.gapBefore)) { runs.push(cur); cur = []; }
    cur.push(e.key);
  }
  if (cur.length > 0) runs.push(cur);
  return runs;
}

// gapBefore at assembly (per segment result `r`, open line carried):
//   first entry: openLine.length > 0
//     ? openTail + r.masked.slice(0, entry.start) : ""
//   others: r.masked.slice(prev.end, entry.start)
//   then openTail = r.masked.slice(r.entries.at(-1)?.end ?? 0)
```

### Integration Points

```yaml
NO config, NO store, NO query, NO segment changes in this task.
DOWNSTREAM (do not implement):
  - P1.M1.T3.S3: successors.test.ts rewrite + test-seam pruning verifies the
    successor index end-to-end from these runs.
  - P1.M2.T1.S1: chain machine consumes topSuccessors() — unaffected here.
```

## Validation Loop

### Level 1: Types

```bash
npm run check    # tsc --noEmit — catches #admitSegment return-shape fallout
```

### Level 2: Targeted tests

```bash
npx vitest --run test/ingest-pipeline.test.ts
npx vitest --run test/bigrams.test.ts test/successors.test.ts
```

### Level 3: Full regression

```bash
npm test   # index, perf-gates, adversarial-ingest, restore, chain, etc.
```

### Level 4: Behavior spot check (covered by suite, listed for clarity)

- `United States of America` → `[[united states],[america]]`, never a bridged bigram
- `` `zephyr` `quuxblat` `` → two runs
- `zephyr, quuxblat` → two runs (named ZorpWibbleEngine regression case)
- Tab/space-only gap chains, including across a forced chunk boundary

## Final Validation Checklist

### Technical

- [ ] `npm run check` clean; `npm test` fully green
- [ ] Gap regex `/^[ \t]+$/` used exactly (no `*`, no `\s` — `\s` would admit `\n`/`\r`!)
- [ ] One `onAdmittedTokens` call per message, after the disable-gate discipline
- [ ] Masked-gap choice documented in a code comment

### Feature

- [ ] Every PRD h3.6 break class has a passing test case (clause punctuation, quotes/brackets, digits/hexish/symbols, intervening word incl. stopword, newline)
- [ ] Whitespace-only gaps chain, including multi-space, tabs, and chunk-boundary carry
- [ ] No empty inner arrays emitted; store/stats counters unchanged vs HEAD
- [ ] Subwords never appear in runs

### Code Quality

- [ ] Admission/store/stats logic byte-identical; only assembly changed
- [ ] JSDoc on the hook and class updated to runs semantics
- [ ] No changes outside ingest.ts, index.ts (comments), ingest-pipeline.test.ts
- [ ] Existing suites repaired, not deleted (perf-gates, index, adversarial)

## Anti-Patterns to Avoid

- ❌ Using `\s` or `/^[ \t]*$/` in the gap test (admits newlines / zero-width gaps)
- ❌ Bridging gaps from the RAW (pre-mask) text — spans and gaps must be against the masked segment (documented)
- ❌ Emitting per-line arrays instead of runs (the exact bug being fixed)
- ❌ Emitting multiple onAdmittedTokens calls per message or calling it while disabled
- ❌ Touching segment.ts, store.ts, or query.ts (S1 contract / already-correct consumers)
- ❌ Rewriting #admitSegment's admission logic while changing its return type — additive shape change only
- ❌ Deleting instead of repairing existing suites (perf-gates, index.test.ts wiring cases)

---

**Confidence Score: 9/10** — the change site is fully mapped (verified against
current ingest.ts source), the consumer (`recordBigramRuns(runs)`) already
exists and is run-shaped, the S1 span contract is explicit, and the test
matrix is enumerated case-by-case from the PRD text. The one design subtlety
(chunk-boundary gap carry via `openTail`) is specified concretely.