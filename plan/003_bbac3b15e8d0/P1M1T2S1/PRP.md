# PRP — P1.M1.T2.S1 (plan 003): classifyPath predicate, edge trim, :line:col trim, key≠display drafts (segment.ts)

---

## Goal

**Feature Goal**: Implement spec/04 rule 4d's segmentation half in
`src/core/segment.ts`: slash-joined path-shaped runs become ONE opaque
token whose KEY is the edge-trimmed (and `:line:col`-trimmed) lowercase
form while the DISPLAY preserves the original edge symbols — the first
key≠display divergence beyond casing in the codebase.

**Deliverable**:
- `LITERAL_RE` widened `{4,80}` → `{4,96}` (fixing the existing spec/code
  window drift; spec/04 already says 96).
- New `classifyPath(raw)` sibling of `classifyLiteral` returning trimmed key
  bounds.
- `RawToken`/`CandidateDraft` gain `path?: boolean` (types.ts); path tokens
  carry the ORIGINAL span plus `trimFrom`/`trimTo` key bounds.
- `expandCandidates` path branch: key = trimmed lowercase slice, display =
  original raw, opaque (`return [whole]`).
- TDD cases in `test/segment.test.ts` per spec §09 h2.55's path bullet.

**Success Definition**: All path cases pass (`src/core/query.ts` one token,
`/home/...` key trims / display keeps, `../tools/build.mjs`,
`example.com/a/b`, `:42:13` trims, `and/or` NOT a token, interior `..`
rejects whole); existing segment suite stays green; `npm run check` +
`npm test` green; perf-gate budget not blown by the widened scan.

## Why

- Spec/04 rule 4d (adopted 2026-10): paths from conversation — model-
  suggested, user-typed, planned-but-not-yet-created — are retyping targets
  disk completion cannot know. Today they shred into components.
- This is the first of four subtasks: T2.S2 (gate caps), T2.S3 (store
  display flow audit), T2.S4 (query interaction) consume this task's
  RawToken/CandidateDraft shapes.

## What

### 1. Widen the scan window

`src/core/segment.ts:97`: `const LITERAL_RE = /[A-Za-z0-9._@:+/~=-]{4,96}/g;`
(comment updated to cite rule 4d).

### 2. `classifyPath(raw: string): { from: number; to: number } | null`

Sibling of `classifyLiteral` (L174–196). Steps:

1. **Edge trim** (leading `/`, `~`, `./`, `../` and combinations; trailing
   `/`): advance `from` past leading chars in the set `/~.`; retreat `to`
   past a trailing `/`. (`from`/`to` bound the KEY inside the raw match.)
2. **Adjacent-symbol guard**: scan `[from, to)`; any two adjacent
   LITERAL_SYMBOL_CHARS (`._@:+/~=-`) → return null. This rejects interior
   `..` (whole run — `a/../b` shreds) and `//`, `::` exactly like 4c.
   NOTE: leading `../` was already trimmed as an EDGE, so only interior
   `..` dies here.
3. **`:line:col` trim** (one iteration): if `/(?::\d+){1,2}$/` matches the
   key, strip it; then require the REMAINDER to be path-shaped AND to
   contain no `:`. If the remainder fails either, restore (no trim) and
   continue with the unstripped key.
   - `src/foo.ts:42:13` → key `src/foo.ts`.
   - `4:36`, `localhost:8080` → remainder has no `/` count / retains `:` →
     no trim → (correctly) not path-shaped → falls to classifyLiteral.
   - PIN: `a/b.ts:42:13:99` → strip `:13:99` leaves `a/b.ts:42` which still
     contains `:` → path fails → the run falls back to 4c literal
     classification (digit-bearing, single interior symbols ⇒ literal
     token). Add a test documenting this exact behavior.
4. **Path-shaped predicate** on the final key: ≥2 interior single `/`
   separators, OR exactly 1 interior `/` plus a dotted component
   (`.` present).
5. **Length**: post-trim key 4–96 chars, else null.

### 3. Pass-4 loop integration (segment.ts ~L404–421)

For each `LITERAL_RE` match, run `classifyPath(m[0])` FIRST. On success the
match becomes a **path span**; only otherwise run `classifyLiteral` as
today (a slash-bearing run qualifying both ways takes the path class —
emit `path: true, literal: false`, spec/04:128-131).

Path spans record: `raw = m[0]` (the ORIGINAL, untrimmed run),
`start = m.index`, `end = m.index + m[0].length`, plus `trimFrom`/
`trimTo` (relative to raw — `raw.slice(trimFrom, trimTo)` is the key).
Rule-3 Unicode adjacency at the TRIMMED bounds:
`isUniLetterBefore(text, start + trimFrom) || isUniLetter(text.codePointAt(start + trimTo))`
→ skip. Equal-span defer guard stays (paths contain `/` so equal-span
collisions with base/hexish/compound classes are impossible by
construction — keep the guard for symmetry/tests).

The absorber sweep's `spans` entries gain a class tag (`literal` boolean +
`path` boolean + trim fields); `mk()` passes them through into the
RawToken. Tie-sort rule (compound before literal) unchanged; add path last
on exact ties (unreachable, structural only).

### 4. types.ts

- `RawToken`: add `path?: boolean` (JSDoc mirroring `literal?`, citing rule
  4d) and `trimFrom?: number; trimTo?: number` (present iff `path`; valid
  slice bounds into `raw`; `raw.slice(trimFrom, trimTo)` = the store key
  source). `start`/`end` remain the ORIGINAL run bounds — document that for
  path tokens `text.slice(start, end) === raw` is the DISPLAY span (ingest
  adjacency still correct: the raw span is the true text extent).
- `CandidateDraft`: add `path?: boolean` (for T2.S2's class-conditional
  gate caps).

### 5. expandCandidates (segment.ts ~L556–580)

```ts
// Opaque classes — hexish, technical literals, and paths (rule 4d).
if (token.path) {
  const key = token.raw.slice(token.trimFrom!, token.trimTo!).toLowerCase();
  return [{
    key,
    display: token.raw,          // ORIGINAL edges preserved for insertion
    properName: false,           // paths are not proper names (documented choice)
    isSubword: false,
    path: true,
  }];
}
if (token.hexish || token.literal) return [whole];
```

### 6. TDD cases (test/segment.test.ts — write first, red)

Per spec §09 h2.55 path bullet, using the file's existing helper style
(tokens → `{raw, ...}` assertions):

1. `use src/core/query.ts here` → one path token, key `src/core/query.ts`,
   display `src/core/query.ts`; contained `src`, `core`, `query`, `query.ts`
   never surface alone (absorption).
2. `/home/user/projects/hapax` → display keeps the leading `/`; key
   `home/user/projects/hapax`.
3. `docs/architecture.md` (1 slash + dot) → path.
4. `../tools/build.mjs` → key `tools/build.mjs`, display `../tools/build.mjs`.
5. `example.com/a/b` → path (host+path form).
6. `src/foo.ts:42:13` → key `src/foo.ts` (line/col trimmed), display the
   original run.
7. `4:36` → NOT path (untouched; may be a 4c literal per existing rules).
   `localhost:8080` → NOT path (colon retained, single slash absent).
8. `a/b.ts:42:13:99` → falls back to literal class (pinned behavior).
9. `and/or` → NOT a token (1 slash, no dot, digit-free → 4c also rejects).
10. `a/../b` → interior `..` rejects the WHOLE run (no path token; no
    junk fragments).
11. Key-cap: a 96-char post-trim path key admits; a 97-char key rejects
    (construct directly since the window is 96 — e.g. trim makes it easy;
    assert classifyPath-level or token-level).
12. `草src/core/query.ts` (Unicode letter before the trimmed bound) → no
    token (rule-3 guard at TRIMMED bounds).

### Success Criteria

- [ ] All 12 cases pass; existing segment/score/store/ingest suites green
- [ ] `npm run check` + `npm test` green (perf gates included — measure the
      widened scan; baseline ~174–187 ms vs CI budget <180 ms is TIGHT; if
      the gate fails, optimize within the single-pass loop, never add O(n²))
- [ ] First path token's `display.toLowerCase() !== key` is INTENTIONAL and
      documented (grep-audit of `display.toLowerCase() === key` assumptions
      is T2.S3's job — here only emit correct shapes)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed?" — Yes: the current pass-4 code shape (classifyLiteral body, loop,
absorber sweep, expandCandidates opacity branch) is quoted/anchored, the
predicate is fully specified with pinned edge cases, and every type change
is enumerated.

### Documentation & References

```yaml
- docfile: plan/003_bbac3b15e8d0/architecture/r2-path-candidates.md
  why: THE recon — current-code line anchors, feasibility verdict, insertion
        points, risks (perf headroom, key≡display assumption, window drift).
  critical: "today the literal pass emits the trimmed slice as raw
        (segment.ts:471); 4d needs the untrimmed span with a separate
        trimmed key — this is the cleanest insertion point for divergence."

- file: src/core/segment.ts
  pattern: LITERAL_RE (L97), LITERAL_SYMBOL_CHARS (L104),
        LITERAL_MIN_LENGTH (L110), classifyLiteral (L174-196) — the template
        for classifyPath; pass-4 loop (L~404-421) — where classifyPath slots
        in FIRST; absorber sweep (L~423-470); expandCandidates opacity
        branch (L~556-580).
  gotcha: the rule-3 guard must use the TRIMMED bounds, not the match
        bounds; keep the monotonic-cursor equal-span check (an .some() here
        made ingest quadratic once — segment.ts:348-352 comments).

- file: src/core/types.ts (RawToken ~L83-113 with literal?/start/end/
        sentenceStart; CandidateDraft)
  why: add path?/trimFrom/trimTo mirrors.

- PRD §04 rule 4d (selected_prd_content h2.24): the full predicate, edge-
        trim-vs-display rule, line/col rule, guards, and §09 h2.55's exact
        test list — this PRP's normative source.

- file: plan/003_bbac3b15e8d0/P1M1T1S3/PRP.md (parallel, tools/calibrate-
        bands.mjs only) — no file overlap; no coordination needed.
```

### Current Codebase tree (relevant)

```bash
src/core/segment.ts    # pass 4 (literal scan) ← fix site
src/core/types.ts      # RawToken / CandidateDraft
test/segment.test.ts   # TDD cases
```

### Desired Codebase tree

```bash
src/core/segment.ts    # LITERAL_RE {4,96}, classifyPath, path spans/drafts
src/core/types.ts      # RawToken.path/trimFrom/trimTo, CandidateDraft.path
test/segment.test.ts   # +12 path cases
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: the literal pass today emits POST-TRIM bounds (start/end from
// classifyLiteral's from/to). Path tokens must NOT follow that: their
// start/end = the ORIGINAL match (display span), with trimFrom/trimTo
// carrying the key. Mixing these up silently corrupts ingest adjacency.

// CRITICAL: classifyLiteral rejects adjacent symbols; classifyPath MUST do
// its own scan (interior '..' rejection) — do not assume reuse.

// CRITICAL: '/': charCode 0x3A sorts before letters; nothing to do, but
// the store prefix index byte-lex order is unaffected by '/' keys.

// GOTCHA: leading-trim set is "/~." COMBINATIONS — '~' alone ('~2.1.0'),
// './', '../', '~/...', even '/../' chains all trim; trailing '/' trims
// ('src/core/' → key 'src/core' → 1 slash no dot → NOT path-shaped → the
// documented trailing-slash gap, spec'd accepted).

// GOTCHA: perf-gate headroom is thin (CI <180 ms, baseline ~174–187 ms).
// The widened window means more matches reaching classification; keep
// classifyPath allocation-free on the null path (return the same shape or
// null, no exceptions/arrays).

// GOTCHA: properName for path drafts is pinned FALSE here (a documented
// choice — paths are not names; spec is silent). Record in the JSDoc so
// T2.S3's audit sees the decision.
```

## Implementation Blueprint

### Implementation Tasks (ordered, TDD)

```yaml
Task 1: ADD the 12 TDD cases to test/segment.test.ts (red)
Task 2: EDIT src/core/types.ts — RawToken.path?/trimFrom?/trimTo?,
        CandidateDraft.path? (+JSDoc citing rule 4d)
Task 3: EDIT src/core/segment.ts
  - LITERAL_RE {4,96}
  - classifyPath per the What section (after classifyLiteral)
  - pass-4 loop: classifyPath FIRST; path spans keep original bounds +
    trim metadata; rule-3 guard at trimmed bounds
  - absorber sweep spans carry path flag + trim; mk() passes through
  - expandCandidates path branch (before the hexish/literal branch)
Task 4: VALIDATE — npm test (segment + full), npm run check, watch
        test/perf-gates.test.ts numbers
```

### Implementation Patterns & Key Details

```ts
// classifyPath skeleton (O(len), allocation-free on null):
function classifyPath(raw: string): { from: number; to: number } | null {
  let from = 0, to = raw.length;
  while (from < to && "/~.".includes(raw.charAt(from))) from++;
  if (to > from && raw.charAt(to - 1) === "/") to--;
  // adjacent-symbol scan over [from,to) — reject interior '..', '//', '::'
  // optional ONE ':digits(:digits)?' tail strip + path-shape check of the
  //   remainder (must be colon-free), else keep unstripped
  // path-shaped: count interior '/' >= 2, or === 1 && key.includes(".")
  // length 4..96, else null
  return { from, to };
}

// expandCandidates path branch — the ONLY key≠display-beyond-casing site:
if (token.path) {
  return [{
    key: token.raw.slice(token.trimFrom ?? 0, token.trimTo ?? token.raw.length).toLowerCase(),
    display: token.raw,
    properName: false,
    isSubword: false,
    path: true,
  }];
}
```

### Integration Points

```yaml
CODE: src/core/segment.ts, src/core/types.ts
TESTS: test/segment.test.ts
DOWNSTREAM (do not implement):
  - P1.M1.T2.S2: shapeGate class-conditional caps (path 4-96) via CandidateDraft.path
  - P1.M1.T2.S3: store display flow + key≠display grep audit + bigram entry
  - P1.M1.T2.S4: query-interaction + perf verification
FROZEN: shapeGate.ts, store.ts, query.ts, provider.ts, ingest.ts
```

## Validation Loop

### Level 1: Syntax

```bash
npm run check
```

### Level 2: Unit tests

```bash
npm test -- test/segment.test.ts
npm test        # full suite, INCLUDING test/perf-gates.test.ts
```

### Level 3: Behavior spot-check

```bash
# Via a vitest scratch or the new cases: confirm the exact spec list —
# src/core/query.ts; /home/user/projects/hapax; docs/architecture.md;
# ../tools/build.mjs; example.com/a/b; ':line:col' trims; 'and/or' not a
# token; interior '..' rejects; 'query.ts' never surfaces alone inside a
# path span.
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green (perf gates not regressed past budget)
- [ ] All 12 path cases pass, including the pinned `a/b.ts:42:13:99`
      fallback-to-literal behavior
- [ ] Path tokens: raw/start/end = original run; key = trimmed lowercase;
      display = original raw
- [ ] Rule-3 guard verified at trimmed bounds (`草src/core/query.ts` → none)
- [ ] `CandidateDraft.path` present for downstream T2.S2/S3
- [ ] No changes to shapeGate/store/query/provider/ingest

## Anti-Patterns to Avoid

- ❌ Emitting post-trim bounds for path tokens like the literal pass does
  (breaks display + ingest adjacency)
- ❌ O(n²) span checks (`.some()` inside the loop) — this pass has two
  perf-regression scars already
- ❌ Trimming the display along with the key (`/home/...` must insert with
  its slash)
- ❌ Letting `:line:col` trim apply when the remainder isn't path-shaped or
  still contains a colon (`localhost:8080` must keep its port)
- ❌ Adding the path class check AFTER classifyLiteral for slash-bearing
  runs (runs qualifying both ways must take the path class)
- ❌ Touching shapeGate caps in this task (T2.S2 owns the 4–96 plumbing)

---

**Confidence Score: 9/10** — predicate, trims, pinned edge cases, exact
code anchors, type changes, test list, and perf risk are all specified from
the verified recon doc plus live source reading; the only judgment calls
(properName=false, `:99` fallback pin) are explicitly documented as pinned
decisions.
