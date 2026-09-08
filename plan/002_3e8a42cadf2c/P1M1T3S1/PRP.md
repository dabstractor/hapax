# PRP — P1.M1.T3.S1 (plan 002): segment.ts — emit token spans on RawToken

---

## Goal

**Feature Goal**: Extend `RawToken` with `start: number; end: number` (UTF-16
code-unit offsets into the tokenized string) and carry the internal
`SpanToken` spans through `tokenize`'s two-pointer merge. **Purely additive,
zero behavior change** to which tokens are emitted or their order. This is the
first half of the raw-text-adjacency bigram rule (PRD 002 delta R1): S2
(`ingest.ts`) uses these offsets to check that the gap between consecutive
admitted whole tokens is `[ \t]+` only.

**Deliverable**:
- `src/core/types.ts`: `RawToken` gains `start: number; end: number`.
- `src/core/segment.ts`: merge loop pushes `{ raw, hexish, start, end }`.
- `test/segment.test.ts`: offset assertions (correct + disjoint across
  base/hexish mixes; non-ASCII-adjacent runs emit nothing) and repair of
  existing exact-shape assertions broken by the type extension.

**Success Definition**: `npm run check` and `npm test` green; every emitted
token satisfies `text.slice(t.start, t.end) === t.raw`; spans strictly
ascending and non-overlapping; rejected Unicode-adjacent runs produce zero
tokens (already true — now asserted with offsets in mind).

## Why

- The strict adjacency rule (PRD §06 h3.6) requires knowing WHERE in the raw
  segment each admitted token sat. Per
  `plan/002_3e8a42cadf2c/architecture/ingest_segment_map.md` §1 CRITICAL,
  position info is lost at exactly two points: (1) segment.ts's
  `out.push({ raw: t.raw, hexish: t.hexish })` in the merge (this task fixes
  it) and (2) `#admitSegment`'s `keys.push(draft.key)` (P1.M1.T3.S2's job).
- Splitting span-carrying into its own task keeps S2 a pure ingest-side
  change with no segment surgery.

## What

- `RawToken` (src/core/types.ts:72–79) becomes:
  `{ raw: string; hexish: boolean; start: number; end: number }` — `start`
  inclusive, `end` exclusive, both UTF-16 code-unit indices into the exact
  string passed to `tokenize`. For hexish tokens these are the hexish span's
  own offsets (not any absorbed base's).
- `tokenize` merge loop (segment.ts ~line 172) pushes
  `{ raw: t.raw, hexish: t.hexish, start: t.start, end: t.end }`. `SpanToken`
  already carries `start`/`end` — no algorithm change; dead tokens are still
  skipped (their spans simply never surface).
- **No other behavior change**: emitted raws, order, hexish flags, and
  `expandCandidates` output identical to HEAD. `expandCandidates` ignores
  the new fields.
- Header doc comments in types.ts and segment.ts updated: RawToken now
  carries spans "consumed by ingest for the strict adjacency bigram rule
  (P1.M1.T3.S2); offsets are into the POST-maskSecrets segment string".

### Success Criteria

- [ ] `tokenize("fix 0f3a9c2 now")` →
      `[{raw:"fix",hexish:false,start:0,end:3},{raw:"0f3a9c2",hexish:true,start:4,end:11},{raw:"now",hexish:false,start:12,end:15}]`
- [ ] Every existing token set unchanged in `{raw, hexish}` projection; spans disjoint & ascending
- [ ] `"Þórhildur"`, `"ΩbsidianMirror"`, `"草x0f3a9c2"` → `[]` (still nothing)
- [ ] `npm run check` + `npm test` green (all suites, incl. ingest/provider tests that consume RawToken)

## All Needed Context

### Context Completeness Check

"Yes" for an implementer who reads this PRP plus the two files: the exact
change points, the offset semantics, the masking caveat, and the test-repair
list are all specified below.

### Documentation & References

```yaml
- file: src/core/segment.ts
  why: the change site. SpanToken {raw,start,end,hexish,dead} already exists;
        ONLY the final merge push (search `out.push({ raw: t.raw`) drops spans.
  gotcha: do NOT touch pass 1/pass 2 logic, the Unicode-letter guards, dedupe,
        or expandCandidates — additive change only.

- file: src/core/types.ts (RawToken at lines 72–79)
  why: extend the interface with start/end + doc comment.
  gotcha: RawToken is consumed by ingest.ts tokenize() loop only — tsc will
        flag any construction site missing the fields (there is exactly one).

- file: src/pi/ingest.ts (#admitSegment ~lines 294–417)
  why: S2's consumer — do NOT change it in this task. Context: it calls
        tokenize(maskSecrets(segment)) — so offsets are against the MASKED
        string. maskSecrets blanks bytes in place (shapeGate.ts ~line 460),
        preserving length; masking also guarantees no NUL-ish surprises in gaps.
  gotcha: a secret masked to spaces may create whitespace gaps that "look
        adjacent" — that risk decision belongs to S2, not here.

- file: test/segment.test.ts
  why: existing suite. Many assertions use toEqual with EXACT object literals
        ({raw:"fix",hexish:false}) — every one breaks when fields are added.
        The `raws()` projection helper is unaffected.

- file: plan/002_3e8a42cadf2c/architecture/ingest_segment_map.md
  why: §1 "CRITICAL" paragraph is this task's raison d'être; §2 documents
        segment.ts internals (pre-hardening line numbers — trust the code).

- file: plan/002_3e8a42cadf2c/P1M1T2S3/PRP.md
  why: parallel sibling (debug.ts phrase-strip) — no interaction; noted only
        to confirm no file overlap (it touches debug.ts/debug.test.ts only).
```

### Current Codebase tree (relevant)

```bash
src/core/types.ts      # RawToken (72–79) — extend
src/core/segment.ts    # tokenize merge (~line 172) — push spans
test/segment.test.ts   # extend + repair exact-shape toEqual assertions
```

### Desired Codebase tree

Same files — no new files.

### Known Gotchas of our codebase & Library Quirks

```ts
// GOTCHA: test/segment.test.ts uses exact toEqual literals like
//   expect(tokenize("fix ...")).toEqual([{ raw: "fix", hexish: false }, ...])
// Adding fields breaks them. Two repair options — PICK ONE consistently:
//   (a) add start/end to each literal (verbose, but keeps exactness), or
//   (b) wrap with a projection helper in the test file:
//         const strip = (ts: RawToken[]) => ts.map(({raw, hexish}) => ({raw, hexish}));
//   prefer (b) for existing cases, and assert offsets in NEW dedicated cases.

// GOTCHA: offsets are UTF-16 code units (m.index is) — astral chars before a
// token shift offsets by 2 per char; that's fine, offsets need only be
// consistent with String.prototype.slice on the same string.

// GOTCHA: hexish spans keep their own start/end — an absorbed base tail's
// span must NOT be reported ("0f3a9c2" reports 0..7, not the tail's span).

// NodeNext ESM: relative imports in tests already use ".js" — follow suit.
```

## Implementation Blueprint

### Data model

```ts
// src/core/types.ts
export interface RawToken {
  raw: string;
  hexish: boolean;
  /** UTF-16 offset of the first char, into the exact string passed to tokenize() */
  start: number;
  /** one past the last char (exclusive) */
  end: number;
}
```

### Implementation Tasks (ordered)

```yaml
Task 1: EDIT src/core/types.ts
  - Extend RawToken with start/end + doc comment noting: offsets are into the
    post-maskSecrets segment string; consumed by ingest (P1.M1.T3.S2) for the
    strict whitespace-only adjacency bigram rule (PRD 002 §06 h3.6).
  - Run `npm run check` — expect exactly ONE error (segment.ts push site).

Task 2: EDIT src/core/segment.ts
  - Merge loop: out.push({ raw: t.raw, hexish: t.hexish, start: t.start, end: t.end });
  - Update the function-level doc comment ("Returns one token per disjoint
    match span" — mention spans now carry start/end) and the header note that
    RawToken offsets are post-masking by the time ingest sees them.
  - NOTHING else changes. Run `npm run check` → clean.

Task 3: EDIT test/segment.test.ts
  - Add a `strip` projection helper (see gotcha) and apply it to existing
    exact-literal toEqual assertions; keep intent of each case identical.
  - NEW describe block "tokenize — span offsets (P1.M1.T3.S1)":
      * for a set of mixed inputs (plain words, "fix 0f3a9c2 now",
        "state-of-the-art", camel identifiers, 64-cap overrun, hexish
        absorbing base tails), assert for EVERY token:
        text.slice(t.start, t.end) === t.raw, and
        tokens[i].end <= tokens[i+1].start (disjoint, ascending) — actually
        strict: end <= next.start always, < when visibly separated.
      * explicit offset case: tokenize("fix 0f3a9c2 now") equals the exact
        array in Success Criteria (single full-object toEqual).
      * "rejected non-ASCII-adjacent runs emit nothing":
        tokenize("Þórhildur ΩbsidianMirror 草x0f3a9c2") === [] — and for
        "fix 草sword error" assert the two emitted tokens' offsets point at
        "fix" (0..3) and "error" (10..15), proving spans survive CJK between.
  - Run full `npm test` — repair any other suite that hand-builds RawTokens
    (grep: `rg -n "hexish:" test/ src/` — constructions outside segment.ts
    need start/end added; expect few or none outside segment.test.ts).

Task 4: REGRESSION sweep
  - npm run check && npm test → all green (ingest, provider, etc. untouched).
```

### Implementation Patterns & Key Details

```ts
// The entire production change:
const t = takeBase ? b : h;
if (takeBase) i++; else j++;
if (t.dead) continue;
out.push({ raw: t.raw, hexish: t.hexish, start: t.start, end: t.end });
```

### Integration Points

```yaml
DOWNSTREAM (do not implement):
  - P1.M1.T3.S2 (ingest.ts): #admitSegment will pair each admitted whole
    token's draft with its RawToken offsets and emit
    { key, start, end } lines to onAdmittedTokens, gating on
    /^[ \t]+$/ for the gap slice. Design RawToken offsets to make that
    cheap: they must be valid slice bounds of the string tokenize received
    (the masked segment) — which they are by construction.
NO config, no store, no query changes in this task.
```

## Validation Loop

### Level 1: Types

```bash
npm run check    # tsc --noEmit — clean after Tasks 1–2
```

### Level 2: Targeted tests

```bash
npx vitest --run test/segment.test.ts
```

### Level 3: Full regression

```bash
npm test   # all suites — ingest/provider consume RawToken; nothing may shift
```

### Level 4: Behavior-invariance spot check

```bash
node --input-type=module -e '
import { tokenize } from "./src/core/segment.ts";' # or via vitest: the new
# span test cases double as the invariance proof (raw/hexish projection
# unchanged + offsets exact). No separate script needed.
```

## Final Validation Checklist

- [ ] `npm run check` clean; `npm test` fully green
- [ ] `text.slice(t.start, t.end) === t.raw` holds for every token in every new span case
- [ ] Spans ascending & non-overlapping in all cases, including hexish-absorbs-base-tail and 64-cap overruns
- [ ] Hexish token reports its own span (not the absorbed tail's)
- [ ] `Þórhildur` / `ΩbsidianMirror` / `草x0f3a9c2` → `[]`; `fix 草sword error` → fix@0..3, error@10..15
- [ ] Existing `{raw, hexish}` behavior identical (projection-helper repair preserves case intent)
- [ ] No changes outside types.ts / segment.ts / segment.test.ts (+ any tsc-forced RawToken literal repairs)
- [ ] Doc comments updated (post-mask offset semantics, S2 consumer)

## Anti-Patterns to Avoid

- ❌ "Improving" tokenize's algorithm, dedupe, or Unicode guards while in there — additive only
- ❌ Emitting offsets relative to the un-masked text (tokenize only ever sees its argument; just document it)
- ❌ Making start/end optional (`start?: number`) — S2 needs them always-present
- [❌] Breaking hexish opacity or expandCandidates (they must ignore the new fields)
- ❌ Rewriting existing test cases' semantics instead of mechanically repairing their shape
- ❌ Sneaking any adjacency-check logic into segment.ts — that is S2's job

---

**Confidence Score: 9/10** — the production change is a two-line push plus a
type extension against a fully-mapped codebase; the only real work is the
test repair, whose exact scope (exact-literal toEqual assertions +
`rg "hexish:"` sweep for RawToken literals) is enumerated above.