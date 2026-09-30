# PRP — P1.M1.T2.S3 (plan 003): Store display flow + key≠display audit + bigram whole-token entry

---

## Goal

**Feature Goal**: Prove — and pin with regression tests — that the path
candidates produced by P1.M1.T2.S1 (key = trimmed-lowercase, display =
original edges) flow through the store, the bigram/successor machinery, and
the `/acwords` dump with ZERO structural changes to `src/core/store.ts` or
`src/pi/ingest.ts`. Audit and fix any code or test that silently assumes
`display.toLowerCase() === key`.

**Deliverable**:
- New regression cases in `test/store.test.ts` (path display merge under
  edge variants), `test/bigrams.test.ts` (whole-token path keys in
  adjacency runs, incl. the `edit → src/core/query.ts` successor pair),
  and `test/debug.test.ts` (display-bearing path candidate renders
  unchanged in /acwords format).
- Grep-audit of `display.toLowerCase()` / key≡display assumptions across
  `src/` and `test/` with fixes where a real assumption (not a legitimate
  use) is found.
- Optional comment-only clarification in `src/core/query.ts` (one-word
  invariant wording covers whitespace-free path tokens).

**Success Definition**: `npm run check` + full `npm test` green; store
requires no behavioral change (if a test forces a store edit, STOP and
report — the research contract said zero changes); `edit` followed by a
path yields a bigram `"edit src/core/query.ts"` and successor
`edit → src/core/query.ts`; `/acwords` prints the path's key and display
as-is.

## IMPORTANT — nature of this item

The architecture research (`plan/003_bbac3b15e8d0/architecture/
r2-path-candidates.md` §3–4) concluded: **store.ts needs ZERO structural
changes.** The upsert display merge is recency-wins
(`src/core/store.ts:293` — `existing.display = sighting.display;`) and
nothing assumes `display.toLowerCase() === key`; `splitRuns`
(`src/pi/ingest.ts:156-171`) and `recordBigramRuns`
(`src/core/store.ts:479-515`) take whole-token keys, and a path's trimmed
key enters a run as ONE key automatically (path keys can never contain
whitespace — whitespace terminates the literal scan run — so the
`"w1 w2"` single-space join and the first/last-space splits in
`#dropSuccessorFor` (store.ts:638-647) hold).

This item is therefore a **verify-and-pin** item: your job is tests +
audit, not refactors. If verification surfaces a genuine store/ingest
defect, fix it minimally and document it; do not redesign.

## User Persona

**Target User**: pi users typing file paths (`edit src/core/query.ts`) who
expect path completion from the path's first character (spec/04:162-166 —
mid-path typing remains stock pi's job).

**Use Case**: A gated path candidate is admitted at ingest; the same path
re-typed with a different edge style (`/home/...` vs `home/...`) later in
the session must merge to ONE entry, and the latest display wins.

**Pain Points Addressed**: silent divergence between key and display is
new (previously casing-only, see `expandCandidates` emitting
`key: raw.toLowerCase(), display: raw`); anything assuming key≡display
would corrupt completion insertion or store merging invisibly.

## Why

- Spec/04 rule 4d (spec/04-tokenization-and-scoring.md:118-174) makes path
  candidates first-class; spec/04:157-158 explicitly blesses the successor
  pair "the successor `edit → path` is legitimate".
- Spec/06 (h3.6, spec/06-candidate-store.md:71-78) defines the raw-text
  adjacency window (breaks on anything but plain spaces/tabs) and
  h3.7 (:109-111) the successor index — path tokens must ride both.
- P1.M2 (query core) and the /acwords debug surface consume exactly the
  store contract pinned here; catching key≠display breakage now is cheap,
  later it is silent.

## What

### Success Criteria

- [ ] `test/store.test.ts`: upserting the same path under different edge
      variants (leading `/` vs none, trailing `/`) merges to one key with
      recency-wins display; count/ordinals merge correctly.
- [ ] `test/bigrams.test.ts`: an `edit` → path adjacency produces the
      bigram pair and successor entry (whole path = ONE token in the run);
      path keys never split on internal `/`.
- [ ] `test/debug.test.ts`: a store entry whose display differs from key
      beyond casing (edges) renders in /acwords output exactly as stored.
- [ ] Grep audit clean: no code/test depends on `display.toLowerCase()
      === key` (legitimate content uses — shapeGate secret checks on
      display, fixture constructors — are fine; equality assumptions are
      not).
- [ ] `npm run check` and `npm test` green.

## All Needed Context

### Context Completeness Check

Someone with no codebase knowledge gets: the exact mechanism under test
(store.ts:293 recency-wins, splitRuns, recordBigramRuns), the exact test
files and their existing structure/helpers, the exact spec anchors, and
the grep audit recipe — enough to do this in one pass without touching
production behavior.

### Documentation & References

```yaml
- docfile: plan/003_bbac3b15e8d0/architecture/r2-path-candidates.md
  why: §3 (store feasibility) and §4 (bigram adjacency) are this item's contract; all file:line anchors
  section: "## 3. Store" and "## 4. Bigram adjacency"
  critical: "Nothing in store assumes display.toLowerCase() === key" and "keys with spaces are impossible"

- file: src/core/store.ts
  why: upsert merge (L270-300, display recency-wins at L293), recordBigramRuns (L479-515), #dropSuccessorFor space-split (L638-647), prefixRange (L394-409)
  pattern: do NOT change; only read/verify
  gotcha: prefix index sorts byte-lex; '/' (0x2F) sorts below digits/letters — path keys need no special handling

- file: src/pi/ingest.ts
  why: splitRuns (L156-171), WHITESPACE_GAP_RE (L127), SpanEntry, onAdmittedTokens hook (L435-440)
  pattern: whole-token drafts' keys enter runs; subwords never do
  gotcha: a '\n' finalizes the line — the edit→path pair test must put both tokens on ONE line

- file: src/core/segment.ts
  why: S1 output — path token emission: key trimmed-lower, display original edges (L744 comment; spans L487-491)
  pattern: use expandCandidates in tests to mint real path drafts, or construct Sighting literals directly
  gotcha: path key cap 96 comes from S2's gate, not the store

- file: src/core/query.ts
  why: L6, L83, L118 one-word-invariant comments; L118 display outflow `display: c.display`
  pattern: comment clarification only if wording ("single word") reads stale for whitespace-free paths — no behavior change

- file: src/pi/debug.ts
  why: L74-75 top rows print c.display; L203 tab-dump prints key\tdisplay — outflow to pin in debug.test.ts

- file: test/store.test.ts
  why: existing upsert/display merge cases (L128-136 "display refreshes to the most recent casing") — extend with edge-variant path cases
  pattern: sighting() helper builds Sighting literals; see() style upserts
  gotcha: existing cases conflate nothing; do not weaken them

- file: test/bigrams.test.ts
  why: existing describes — counting, successor index, cap/eviction, BUG-006; add path-key cases alongside
  pattern: direct store.recordBigramRuns calls; for the ingest-path case use IngestPipeline/processText like the BUG-006 describe does

- file: test/debug.test.ts
  why: formatAcwordsDump cases; add one key!=display path entry case
  pattern: real CandidateStore + see() upserts + fakeStats; topRows parser exists

- file: plan/003_bbac3b15e8d0/P1M1T2S2/PRP.md
  why: S2 (in flight) delivers the gate that admits path drafts (cap 4-96); your tests may need drafts that PASS the gate — reuse its test constructions
  gotcha: if S2 hasn't landed when you start, construct admitted store state directly (upsert Sighting literals) so tests don't depend on gate internals

- spec: spec/04-tokenization-and-scoring.md L118-174 (rule 4d; L157-158 successor edit→path; L162-166 first-char surface)
- spec: spec/06-candidate-store.md L71-78 (adjacency window) and L109-111 (successor index, cap 10k)
```

### Current Codebase tree (relevant slice)

```bash
src/core/segment.ts     # S1 done: path tokens, key trimmed-lower, display original edges
src/core/shapeGate.ts   # S2 (in flight): path-class cap 4-96
src/core/store.ts       # target of verification — upsert/display/bigrams/eviction; expect NO changes
src/core/query.ts       # display outflow + invariant comments
src/pi/ingest.ts        # splitRuns / onAdmittedTokens
src/pi/debug.ts         # /acwords dump (config-gated; prints key\tdisplay)
test/store.test.ts test/bigrams.test.ts test/debug.test.ts test/segment.test.ts
```

### Desired Codebase tree with changes

```bash
test/store.test.ts      # + describe: path display merge (edge variants, recency wins)
test/bigrams.test.ts    # + path whole-token runs, edit→path successor pair
test/debug.test.ts      # + key!=display outflow case
src/core/query.ts       # (optional) comment-only invariant wording fix
# src/core/store.ts, src/pi/ingest.ts, src/pi/debug.ts — UNCHANGED (unless audit finds a real defect)
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: This is a verification item. If a new test forces a store.ts change, the research contract is violated — investigate whether the test is wrong before changing the store.
# CRITICAL: bigram adjacency requires ONE line — '\n' finalizes a line in ingest (ingest.ts:396-434); "edit src/core/query.ts" on one line, gap = single space.
# CRITICAL: WHITESPACE_GAP_RE = /^[ \t]+$/ — a path following "edit" separated by two spaces still pairs; "edit," (comma gap) does NOT.
# CRITICAL: do NOT test that a path's internal components pair (e.g. src→core) — the path is ONE token; contained tokens are absorbed by rule 4d.
# CRITICAL: prefixRange throws RangeError on non-lowercase input (caller-bug guard) — always lowercase query prefixes in tests.
# Imports use .js extensions (ESM/NodeNext). pi's notify levels: "info"|"warning"|"error".
# Sighting literals need: key, display, ordinal, fromUser, properName, rankGroup, isSubword (see test/debug.test.ts see() helper).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: RECON the current tree
  - READ src/core/segment.ts (path emission, ~L720-750), src/core/store.ts (upsert + recordBigramRuns),
    src/pi/ingest.ts (splitRuns), test/store.test.ts, test/bigrams.test.ts, test/debug.test.ts.
  - VERIFY S1 landed (path tokens with key!=display) and check S2 status; if S2 not landed,
    build store state directly via upsert(Sighting literals) so tests stay gate-agnostic.

Task 1: AUDIT key≡display assumptions (before writing tests)
  - RUN: grep -rn "toLowerCase" src/ test/ and review every hit for an equality
    assumption between display and key.
  - KNOWN-BENIGN: src/core/shapeGate.ts:257,434 (secret checks read display content — spec'd,
    isSecretShaped intentionally sees original edges); test/acceptance.test.ts:503
    (fixture constructs key from display — verify no path case conflates them);
    test/segment.test.ts:742 (asserts divergence — correct).
  - FIX only genuine assumptions; record findings (benign or fixed) in the test-file comments
    or commit message.

Task 2: CREATE store display-merge cases in test/store.test.ts
  - NEW describe "path display merge (rule 4d: key trimmed, display keeps edges)":
    - upsert {key:"home/dustin/projects/hapax", display:"/home/dustin/projects/hapax"} then
      {key:"home/dustin/projects/hapax", display:"home/dustin/projects/hapax/"} → ONE entry
      (store.size unchanged), sessionCount 2, display === latest ("home/dustin/projects/hapax/"),
      lastSeenOrdinal advanced.
    - reverse order: trailing-'/' display first, leading-'/' second → latest wins.
    - firstSeenOrdinal stays at the first sighting (merge semantics, store.ts upsert docs).
  - FOLLOW pattern: existing "display refreshes to the most recent casing" case (L128-136).
  - NAMING: it("...") descriptive strings matching file style.

Task 3: CREATE bigram path cases in test/bigrams.test.ts
  - NEW describe "path tokens as whole-token run members (rule 4d)":
    - recordBigramRuns([["edit","src/core/query.ts"]]) → bigram key
      "edit src/core/query.ts" counted; topSuccessors("edit") contains
      {next:"src/core/query.ts", count:1}. (Spec 04:157-158 — this pair is legitimate.)
    - internal components never pair: runs containing "src/core/query.ts" produce NO
      "src core" bigram (the path is one key).
    - Cap interaction sanity: path bigrams count against the 10,000 cap like any other
      (optional, existing cap cases cover mechanics).
  - IF exercising the real ingest path (recommended, mirrors BUG-006 describe):
    processText a message containing "edit src/core/query.ts" on one line (single-space gap)
    through IngestPipeline with a real store; assert the bigram + successor. Add the
    spec-06 h3.6 adjacency break: "edit, src/core/query.ts" (comma gap) forms NO pair.

Task 4: CREATE debug outflow case in test/debug.test.ts
  - it("renders path candidates with key != display exactly as stored (rule 4d)") —
    see(store, "home/dustin/projects/hapax", "/home/dustin/projects/hapax") (key first arg,
    display second per the see() helper signature) then assert the dump line contains
    "/home/dustin/projects/hapax  ×1" (display verbatim) and the format is otherwise unchanged.
  - Verify no format change is needed in src/pi/debug.ts (expect none — it prints c.display).

Task 5: COMMENT clarification in src/core/query.ts (behavior-preserving)
  - L6/L83/L118 "one word / single word" invariant wording: clarify that path tokens
    (rule 4d) are single whitespace-free tokens satisfying the invariant; display may
    differ from key beyond casing. Comment-only diff. If unsure, skip — do not refactor.

Task 6: VALIDATE
  - npm run check; npx vitest --run test/store.test.ts test/bigrams.test.ts test/debug.test.ts; npm test.
```

### Implementation Patterns & Key Details

```typescript
// store.test.ts — sighting pattern (adapt from existing helper):
const s = new CandidateStore();
s.upsert({ key: "src/core/query.ts", display: "src/core/query.ts",
  ordinal: s.nextOrdinal(), fromUser: false, properName: false,
  rankGroup: 1, isSubword: false });

// bigrams.test.ts — direct pair:
store.recordBigramRuns([["edit", "src/core/query.ts"]]);
expect(store.topSuccessors("edit")[0].next).toBe("src/core/query.ts");

// ingest-path adjacency (one line, single-space gap) via processText —
// mirror the BUG-006 describe's pipeline construction (test/bigrams.test.ts L153+).
// Gap semantics: /^[ \t]+$/ passes; anything else (newline, comma) breaks the run.
```

### Integration Points

```yaml
NONE (structural):
  - no store/ingest/debug code changes expected
  - P1.M2 (query core) and P1.M2.T2.S1 ranking consume the pinned store contract unchanged
  - /acwords output format unchanged (verify in Task 4)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check     # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/store.test.ts test/bigrams.test.ts test/debug.test.ts test/segment.test.ts
npm test          # full suite green
```

### Level 3: Integration / audit gates

```bash
# Audit sweep — review every hit; expect only the benign ones listed in Task 1:
grep -rn "toLowerCase" src/ test/

# Outflow smoke (config-gated dump is pure; direct formatter call):
node --input-type=module -e "
import { CandidateStore } from './src/core/store.js';
import { formatAcwordsDump } from './src/pi/debug.js';
const s = new CandidateStore();
s.upsert({ key:'src/core/query.ts', display:'src/core/query.ts', ordinal:s.nextOrdinal(), fromUser:false, properName:false, rankGroup:1, isSubword:false });
s.recordBigramRuns([['edit','src/core/query.ts']]);
console.log(formatAcwordsDump(s, { wordsSeen:2, admitted:2, rejectedByGate:{tooShort:0,tooLong:0,lowEntropy:0,unigramRun:0,secret:0,consonantRun:0} }));
console.log(JSON.stringify(s.topSuccessors('edit')));
"
# Expect: dump line contains "src/core/query.ts  ×1"; successors [["src/core/query.ts",1-style entry]].
```

### Level 4: Domain-Specific Validation

None beyond Level 3 — this item is test-pinning; live TTY verification
belongs to P1.M3.T4.S1.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean; `npm test` green
- [ ] Store/ingest/debug production code unchanged OR any change documented as a genuine audit fix

### Feature Validation

- [ ] Edge-variant path sightings merge to one key, recency-wins display
- [ ] `edit → path` bigram + successor recorded; comma/newline gaps form no pair
- [ ] /acwords renders key≠display entries verbatim, format unchanged
- [ ] Grep audit reviewed hit-by-hit; genuine assumptions fixed

### Code Quality Validation

- [ ] New tests follow existing helpers/describe style in each file
- [ ] No weakening of existing cases
- [ ] No scope creep into P1.M1.T2.S4 (query-interaction + perf) or P1.M2

## Anti-Patterns to Avoid

- ❌ Don't "fix" the store because a hand-written test is wrong — re-derive
  expectations from spec/06 upsert semantics first
- ❌ Don't test path-internal component pairing — rule 4d absorbs components
- ❌ Don't touch shapeGate (S2's) or query matching (P1.M2's) surfaces
- ❌ Don't skip the audit — the silent-breakage risk is the reason this item exists
```

**Confidence Score: 8/10** — the mechanism is already researched to
file:line precision and expected to need zero production changes; the main
residual risk is S2's landing state at implementation time, mitigated by
gate-agnostic test construction (Task 0).
