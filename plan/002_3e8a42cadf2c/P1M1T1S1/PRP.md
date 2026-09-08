# PRP — P1.M1.T1.S1 (plan 002): Unicode-letter boundary rejection in segment.ts tokenize

---

## Goal

**Feature Goal**: Implement PRD §04 segmentation rule 3 (R2 delta): a word
candidate must be bounded on BOTH sides by non-letter characters, where ANY
Unicode letter counts as a letter. An ASCII run adjacent to a non-ASCII
letter is disqualified whole — `Þórhildur` → nothing (not `rhildur`),
`ΩbsidianMirror` → nothing, `草sword` → nothing.

**Deliverable**: Modified `tokenize()` in `src/core/segment.ts` (base pass +
hexish pass both guarded) plus updated cases in `test/segment.test.ts`.
Signatures unchanged (`tokenize(text: string): RawToken[]`,
`expandCandidates` untouched); strictly fewer RawTokens emitted for
Unicode-adjacent input.

**Success Definition**: New disqualification tests pass; all existing
segment/ingest/store/query/score tests still pass (minus the one replaced
"resumes ASCII tokens after a non-ASCII run" case); `npm run check` clean;
space/punctuation-bounded ASCII-after-CJK behavior preserved
(`fix 方法 error` still yields `fix`,`error`).

## Why

Today's BASE_RE `/[A-Za-z][A-Za-z0-9_]{0,63}/g` simply restarts matching
after a non-ASCII run, so `Þórhildur` yields the fragment `rhildur` and
`ΩbsidianMirror` yields `bsidianMirror` — completing the ASCII remainder of
a word whose visible form includes non-ASCII letters. Tabbing such a
fragment inserts wrong text and pollutes the store with fragments of real
names. PRD delta R2 overrides the old "CJK run skipped; ASCII resumes after"
bullet (still present in prd_snapshot §09 h2.49 — the delta wins).

## What

After both regex scans in `tokenize()`, reject any candidate span whose
immediately-preceding OR immediately-following source character is a Unicode
letter (`/\p{L}/u`). ASCII letters cannot abut a same-class match (regex
classes are maximal), so this effectively rejects non-ASCII letters only
(CJK, Latin-1, Greek, etc.). Digit-led hexish spans get the same guard.

### Success Criteria

- [ ] `tokenize("Þórhildur")` → `[]`
- [ ] `tokenize("ΩbsidianMirror")` → `[]`
- [ ] `tokenize("草sword")` → `[]`
- [ ] `tokenize("漢字 word")` → `[{raw:"word", hexish:false}]` (space-bounded still works)
- [ ] `tokenize("fix 方法 error")` → `["fix","error"]` unchanged
- [ ] Hexish guarded too: `tokenize("草0f3a9c2")` → `[]` (digit-led hexish preceded by CJK letter)
- [ ] Existing pure-ASCII cases byte-identical (`npm test` green except the replaced case)
- [ ] No signature/type changes; no changes outside segment.ts + segment.test.ts

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the exact function body
structure, line-anchored hook points, guard semantics, and the precise test
cases to add/replace are all reproduced below from the live source.

### Documentation & References

```yaml
- file: src/core/segment.ts
  why: The ONLY source file to modify. Structure (read it first, ~330 lines):
    - BASE_RE (line ~47), HEXISH_RE (~50), HAS_DIGIT_RE (~52)
    - interface SpanToken { raw, start, end, hexish, dead } (~line 55)
    - tokenize() (~line 66–143):
        Pass 1 base loop (~line 76): `for (let m = BASE_RE.exec(text); ...)` 
          pushes {raw: m[0], start: m.index, end: m.index + m[0].length, hexish:false, dead:false}
          when m[0].length >= 2.
        Pass 2 hexish loop (~line 93): `for (let m = HEXISH_RE.exec(text); ...)`
          with `const start = m.index; const end = start + m[0].length;` and a
          monotonic cursor `k` over bases for dedupe/absorption.
        Linear two-pointer merge (~line 129–143) skipping dead tokens.
    - expandCandidates() further down — DO NOT TOUCH.
  pattern: internal SpanToken already carries start/end before the merge drops
    them — the guard slots naturally into both pass loops where m.index is in hand.
  gotcha: don't add \p{L} to the character classes; keep the scan regexes
    ASCII-only and reject post-hoc. Post-hoc rejection keeps regex cost
    unchanged for the overwhelmingly-ASCII hot path.

- file: test/segment.test.ts
  why: Replace one case, add several. Existing block at lines 125–135:
      describe("tokenize — CJK and non-ASCII (PRD §04 rule 3)", () => {
        it("skips CJK runs, emitting nothing for them", () => { ... "前回の session トークン" → ["session"] })
        it("resumes ASCII tokens after a non-ASCII run", () => {
          expect(raws(tokenize("fix 方法 error"))).toEqual(["fix", "error"]);
        });
      });
    REPLACE the second `it` with whole-run-disqualification cases (see Tasks).
    KEEP the first it (space-bounded ASCII between CJK runs still valid).
  pattern: tests use `tokenize(...)` + `raws(...)` helper and toEqual on
    full RawToken objects where hexish matters.
  gotcha: "fix 方法 error" must STILL pass (space-bounded) — rename the
    retained/added case to make the boundary semantics explicit.

- docfile: plan/002_3e8a42cadf2c/architecture/ingest_segment_map.md
  section: §2 (segment.ts recon)
  why: Confirms BASE_RE restarts matching after non-ASCII runs (the bug) and
    that SpanToken carries start/end pre-merge.

- url: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Unicode_character_class_escapes
  why: /\p{L}/u semantics — matches any Unicode letter incl. CJK, Latin-1
    (Þ, ó), Greek (Ω). Must compile with the u flag.

- prd: plan/002_3e8a42cadf2c/prd_snapshot.md §04 rule 3 (h3.3) — authoritative
    new text: "A word candidate must be a run of [A-Za-z0-9_] bounded on BOTH
    sides by non-letter characters (any Unicode letter counts as a letter)."
    NOTE: prd_snapshot §09 (h2.49) still lists the old "CJK run skipped;
    ASCII resumes after" bullet — delta R2 explicitly overrides it. Do not
    "fix" the snapshot.
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/core/
│   ├── segment.ts        # MODIFY (tokenize only)
│   └── types.ts          # untouched (RawToken unchanged)
├── test/
│   └── segment.test.ts   # MODIFY (one block)
└── (29 sibling test files — must stay green; ingest/store/etc. consume tokenize)
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: Reject post-hoc, do NOT widen the scan regexes. The guard is:
#     const prev = text.charCodeAt(start - 1)  (or text[start-1] ?? "")
#     reject if /\p{L}/u.test(prev) || /\p{L}/u.test(next)
#   Guard placement: in the BASE loop, skip the push (do NOT mark dead —
#   a disqualified base must also NOT absorb/be-absorbed weirdly; simplest
#   correct behavior: `continue` without pushing). In the HEXISH loop,
#   likewise skip before any dedupe/absorption bookkeeping for that match.
#   BUT CAREFUL: if a base was disqualified and a hexish span would have
#   absorbed it, absorbing a non-existent token is harmless (cursor k just
#   never sees it) — with `continue`-instead-of-push, bases[] simply lacks
#   the entry, so pass-2 logic is automatically consistent.
# GOTCHA: HEXISH_RE's trailing \b is ASCII-\b; a Unicode letter after a hex
#   run counts as non-\w so \b still matches there — e.g. "deadbeef草"
#   yields hexish "deadbeef" today and must now be rejected by the FOLLOWING
#   char guard. Test it.
# GOTCHA: Surrogate pairs — text.codePointAt() vs charCodeAt(). CJK BMP
#   chars are single UTF-16 units; astral letters (rare emoji-adjacent
#   scripts) are surrogate pairs whose individual units are NOT \p{L}. For
#   strictness use code-point-aware access:
#     String.fromCodePoint(text.codePointAt(start - 1) ?? -1) — or simply
#     test the 1-char slice with /u regex on the char BEFORE it via
#     codePointAt; simplest robust helper:
#     function isUniLetterAt(text, i) { const cp = text.codePointAt(i);
#       return cp !== undefined && /\p{L}/u.test(String.fromCodePoint(cp)); }
#   and check both start-1 and end (for end, also start-side of pair). A
#   simpler acceptable v1: check text[start-1] and text[end] with the /u
#   regex — surrogate halves fail \p{L} and thus let astral-adjacent runs
#   through (accepted limitation; note it in a comment).
# GOTCHA: /g regex lastIndex — the module already resets lastIndex=0 at
#   function entry; keep that intact.
# GOTCHA: tokenize() purity invariants (documented in the file header):
#   no node/pi imports, no state beyond module regexes. The new guard is a
#   pure function — keep it module-local.
# GOTCHA: The 64-char cap case ("z".repeat(64) + continuation): a
#   disqualified first capped segment followed by a continuation match —
#   both segments get the guard independently; no interaction to preserve.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD module-local Unicode-letter guard helper in src/core/segment.ts
  - IMPLEMENT: isUnicodeLetter(cp: number | undefined): boolean using
    /\p{L}/u.test(String.fromCodePoint(cp)) — or the charAt variant; keep it
    tiny and documented (surrogate caveat if applicable).
  - PLACEMENT: below HAS_DIGIT_RE, above interface SpanToken.

Task 2: GUARD the base pass (Pass 1 loop, ~line 76)
  - In the `if (m[0].length >= 2)` branch, BEFORE pushing:
      const start = m.index, end = m.index + m[0].length;
      if (isUnicodeLetter(text.codePointAt(start - 1)) ||
          isUnicodeLetter(text.codePointAt(end))) continue;
    (codePointAt(-1) is undefined → guard returns false → no behavior change
     for string-start tokens; codePointAt(end) likewise at string end.)
  - EFFECT: disqualified ASCII runs are never in bases[] → no token emitted,
    no dedupe interaction, strictly fewer RawTokens.

Task 3: GUARD the hexish pass (Pass 2 loop, ~line 93)
  - Immediately after `const end = start + m[0].length;` add the same
    two-sided check; `continue` before any cursor/dedupe/push bookkeeping
    for that match.
  - GOTCHA: do NOT advance cursor k when skipping.

Task 4: UPDATE the module header comment (lines ~5–13)
  - Replace the "CJK and all other non-ASCII text falls outside the ASCII
    character classes, so those runs are skipped for free and ASCII words
    resume after them (rule 3)" sentence with the R2 rule-3 text: runs
    adjacent (either side) to any Unicode letter are disqualified whole;
    cite Þórhildur / ΩbsidianMirror / 草sword exemplars.

Task 5: UPDATE test/segment.test.ts
  - REPLACE the "resumes ASCII tokens after a non-ASCII run" case with:
      it("disqualifies ASCII runs adjacent to a Unicode letter (rule 3, R2)", () => {
        expect(raws(tokenize("Þórhildur"))).toEqual([]);
        expect(raws(tokenize("ΩbsidianMirror"))).toEqual([]);
        expect(raws(tokenize("草sword"))).toEqual([]);
      });
    ADD (same describe block or adjacent):
      it("still captures space/punctuation-bounded ASCII after CJK runs", () => {
        expect(raws(tokenize("fix 方法 error"))).toEqual(["fix", "error"]);
        expect(raws(tokenize("漢字 word"))).toEqual(["word"]);
      });
      it("disqualifies hexish spans adjacent to a Unicode letter", () => {
        expect(tokenize("草0f3a9c2")).toEqual([]);
        expect(tokenize("0f3a9c2草")).toEqual([]);
      });
      it("keeps a following Unicode letter from leaking via trailing \\b (deadbeef草)", () => {
        expect(raws(tokenize("deadbeef草"))).toEqual([]);
      });
  - VERIFY no other test file asserts the old resume-mid-word behavior:
      grep -rn "resumes\|Þ\|Ω\|rhildur\|bsidianMirror" test/ src/
    (expected: only the segment.test.ts case you just replaced).

Task 6: FULL REGRESSION
  - npm run check
  - npm test   # all suites; ingest/store/score/etc. fixtures are pure ASCII
               # (verified: existing fixtures use CJK only as separators)
```

### Implementation Patterns & Key Details

```typescript
// The guard (module-local, pure):
const UNI_LETTER_RE = /\p{L}/u;
function isUniLetter(cp: number | undefined): boolean {
  return cp !== undefined && UNI_LETTER_RE.test(String.fromCodePoint(cp));
}

// Base pass hook (inside the existing for-loop):
if (m[0].length >= 2 && !isUniLetter(text.codePointAt(m.index - 1)) &&
    !isUniLetter(text.codePointAt(m.index + m[0].length))) {
  bases.push({ raw: m[0], start: m.index, end: m.index + m[0].length,
               hexish: false, dead: false });
}

// Hexish pass hook (right after computing start/end):
if (isUniLetter(text.codePointAt(start - 1)) ||
    isUniLetter(text.codePointAt(end))) continue;
```

### Integration Points

```yaml
CONSUMERS (no changes needed — strictly-fewer-tokens is downward-compatible):
  - expandCandidates (same file): receives fewer RawTokens; unchanged.
  - src/pi/ingest.ts #admitSegment: fewer tokens per segment; stats counts shift only
    for Unicode-adjacent text (ASCII fixtures unaffected).
  - P1.M1.T3.S1 (NEXT subtask, same file): adds span emission on RawToken —
    your guard must live in the pass loops (not post-merge on out[]) so span
    threading lands on a clean pass structure. Do the guard per-match, as specced.

PERF: the two codePointAt+regex checks run per matched token only (not per
  input char); keystroke-path budget untouched (tokenize is ingest-path only).

TEST BASELINE: 523+ tests currently green; only the single replaced case
  changes expectations.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — must be clean (note: /u regex + codePointAt typing)
```

### Level 2: Unit Tests

```bash
npx vitest --run test/segment.test.ts   # new cases green, replaced case gone
npm test                                 # full suite green
```

### Level 3: Integration (behavior spot-probes via existing consumers)

```bash
# Ingest a Unicode-adjacent line through the real pipeline and confirm no fragment:
npx vitest --run test/ingest-pipeline.test.ts test/ingest.test.ts test/store.test.ts
```

### Level 4: Domain-Specific (rule-3 exemplars)

```bash
npx vitest --run test/segment.test.ts -t "disqualifies"
# covers: Þórhildur → [], ΩbsidianMirror → [], 草sword → [],
#         草0f3a9c2 → [], 0f3a9c2草 → [], deadbeef草 → []
npx vitest --run test/segment.test.ts -t "bounded"
# covers: "fix 方法 error" → [fix, error]; "漢字 word" → [word]
```

## Final Validation Checklist

- [ ] All six rule-3 exemplar assertions pass (3 base + 3 hexish/boundary)
- [ ] Space/punctuation-bounded ASCII-after-CJK cases still pass
- [ ] `npm test` full suite green (only the one replaced case changed)
- [ ] `npm run check` clean
- [ ] `tokenize`/`expandCandidates` signatures and RawToken shape unchanged
- [ ] Only `src/core/segment.ts` and `test/segment.test.ts` modified
- [ ] Module header comment updated to R2 rule-3 semantics
- [ ] Guard is pure, module-local, no new imports

## Anti-Patterns to Avoid

- ❌ Don't widen BASE_RE/HEXISH_RE with \p{L} — post-hoc rejection only
- ❌ Don't strip/normalize non-ASCII letters out of tokens (never complete the ASCII remainder)
- ❌ Don't implement the guard post-merge on `out[]` (breaks the per-match span hook P1.M1.T3.S1 needs)
- ❌ Don't mark disqualified bases `dead` instead of not pushing (dead bases still participate in pass-2 cursor math)
- ❌ Don't touch expandCandidates, types.ts, shapeGate, or the prd_snapshot's stale §09 bullet
- ❌ Don't add CJK segmentation (documented non-goal)

---

**Confidence Score**: 9/10 — the exact hook lines, loop structure, and test
block were read from the live source this session; the only residual design
choice (codePoint vs charAt surrogate handling) is spelled out with a
recommended robust option and an accepted simpler fallback.