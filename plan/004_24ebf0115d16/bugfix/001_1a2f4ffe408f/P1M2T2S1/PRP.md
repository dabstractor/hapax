---
name: "P1.M2.T2.S1 (bugfix 001_1a2f4ffe408f) — Record dismissed-buffer fingerprint and release suppression on context change (BUG-003)"
---

## Goal

**Feature Goal**: Fix BUG-003 — widget suppression keyed by numeric fragment
START leaks across messages (a start-0 dismissal suppresses the FIRST word of
every following message). Replace the start-only release test with a
**buffer-fingerprint** condition: suppression persists only while the current
buffer is a same-word continuation of the dismissed buffer (one a prefix of
the other); a submitted-and-cleared buffer is neither, so the next message's
first word (start 0) releases.

**Deliverable**: Modified `src/pi/widget.ts` `createVisibilityMachine`
(`suppressedFingerprint` state + `onDismissed` recording + R4 release
condition + `paint()` clearing); new release tests in
`test/widget-visibility.test.ts`; regression re-run of `test/widget.test.ts`.

**Success Definition**: The PRD repro inverts — 'ze'→Tab→Enter, then fresh
buffer 'lw' **paints** (lwlock visible), for all three start-0 dismissal
variants (Tab-accept `widget.ts:921`, Escape/boundary-Esc `:1117-1120`,
Enter-submit `:1113-1119`); same-word backspace/edit STAYS suppressed; all
existing suppression pins (`widget-visibility.test.ts:288/316/342`,
`widget.test.ts` suppression cases) pass with NO must-change expectations;
`npm run check` + `npm test` green; live TTY verification per spec/09.

## Why

- Spec 07:72-75: "Explicit dismissal … suppresses the line for the REST OF
  THE WORD. Re-open only at the next word start or trigger char." A new
  message's first word IS the next word start; the numeric-start comparison
  can't tell messages apart. This restores spec intent — no spec edit.
- Chosen design (from `architecture/r3-suppression-leak.md`, "Recommended
  fix design"): buffer-fingerprint release. The start===0+fresh-buffer
  heuristic was REJECTED (fragile, one-symptom patch); reset-on-submit was
  second choice (new seam through editor.ts, misses hidden-Enter submits
  after a Tab acceptance). The machine already sees `lines` via
  `getEditorState()` — no new dependency injection needed.

## What

All in `src/pi/widget.ts` `createVisibilityMachine`:

1. **State** (beside `suppressedFragmentStart` at :533):
   `let suppressedFingerprint: string | null = null;` — the dismissed
   buffer's `lines.join("\n")`, or `null` meaning context-free (empty
   dismissed buffer → release at any boundary).
2. **`onDismissed(explicit)`** (:899-912): keep recording
   `suppressedFragmentStart` as today (the `atBoundary` half of the release
   test still needs it) AND record
   `suppressedFingerprint = lines.join("\n")`; if that fingerprint is
   `""` (empty buffer), set it to `null` (context-free).
3. **R4 release check** (:826 area, `if (!atBoundary || start ===
   suppressedFragmentStart) stay suppressed`): stay suppressed only when
   `atBoundary && start === suppressedFragmentStart &&
   sameWordContinuation`, where
   `const fp = suppressedFingerprint; const current = lines.join("\n");`
   `sameWordContinuation = fp !== null && (current.startsWith(fp) ||
   fp.startsWith(current))`. Rationale: within one message, editing /
   extending / backspacing the dismissed word keeps one buffer a prefix of
   the other; a cleared buffer matches neither, so the next message's
   first word releases.
4. **`paint()`** (:604-620): already clears `suppressedFragmentStart`
   (:613) — add `suppressedFingerprint = null;` beside it.
5. **Trigger-char bypass** (in the R4 block, mode === trigger → release):
   UNTOUCHED.
6. **BUG-001 composition** (CRITICAL — the chain branch from P1.M1.T2.S1
   landed FIRST and rewrites the same evaluate block): a zero-char chain
   offer at start 0 is exactly a released word start — assert in tests
   that after a start-0 Tab-accept dismissal, the armed chain's zero-char
   successor offer PAINTS (chain intent flows through the isIntentBypass
   seam at :352/:640 as landed). Re-run BOTH widget test files.

### Success Criteria

- [ ] Fresh-buffer first word paints after each of the 3 start-0 dismissal variants (PRD repro 'ze'→Tab→Enter then 'lw' visible)
- [ ] Same-word backspace/edit within the SAME buffer stays suppressed (prefix relation holds)
- [ ] Zero-char chain offer at start 0 after a Tab-accept dismissal paints (BUG-001 composition)
- [ ] Trigger-char bypass unchanged; existing suppression pins pass unmodified
- [ ] `npm run check` + `npm test` green; live TTY verification recorded

## All Needed Context

### Context Completeness Check

An implementer needs: the exact current suppression code paths (quoted
below with line anchors), the fingerprint design decision + rejected
alternatives, the evaluate-block state after the landed BUG-001 chain
branch, the test-file harness conventions, and the spec citation. All below.

### Documentation & References

```yaml
- file: src/pi/widget.ts
  why: THE file. Anchors (verify with grep — the chain branch from
        P1.M1.T2.S1 shifted nearby lines): suppressedFragmentStart decl
        :533; paint() clearing :613; the R4 suppressed check :826
        (`if (!atBoundary || start === suppressedFragmentStart)` — this is
        the "R4 release check :628-637" the research note names, now
        inside evaluate's word-mode branch); onDismissed :899-912; the
        dismissal call sites :921 (Tab accept, via insertHighlighted),
        :1113-1119 (Enter-submit), :1117-1120 (Escape/boundary-Esc),
        :1356/:1389 (key layer). onInput already computes a
        lines.join("\n") fingerprint at :598 (rule 7 cursor-move) —
        recompute in onDismissed/evaluate rather than entangling that one.
  pattern: module doc + per-rule comments (Rule 4 comment at :529-532 must
           be REWORDED to the fingerprint semantics); deps.getEditorState()
           seam for buffer access.

- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/r3-suppression-leak.md
  section: "Recommended fix design" (+ the BUG-001 interaction note)
  why: The verified leak repro (all three start-0 sites), the chosen
        fingerprint condition verbatim, the REJECTED alternatives (fresh-
        buffer heuristic; reset-on-submit) and WHY, and the ordering
        dependency with BUG-001's chain branch.

- file: test/widget-visibility.test.ts
  why: Suppression suite. Anchors: R4 suppression describe :286+ —
        "extending the SAME word stays hidden; a new word reopens" :288,
        trigger-char reopen :316, disqualification-vs-suppression :342.
        These must keep passing UNCHANGED (the prefix relation covers the
        same-buffer same-word case). Add the new release cases here.
  pattern: machine constructed via createVisibilityMachine with a fake
           deps.getEditorState/setEditorState + fake timers (study the
           file's harness before writing).

- file: test/widget.test.ts
  why: The composed widget proxy suite (stateful fake inner editor; Enter
        clears the buffer — exactly the PRD repro harness shape). Re-run;
        add the end-to-end 'ze'→Tab→Enter then 'lw' repro inversion here if
        the harness supports the full compose, else mirror it in
        widget-visibility tests.

- file: spec/07-*.md :72-75
  why: The spec clause whose intent this restores ("Re-open only at the
        next word start or trigger char"). NO spec edit — quote it in the
        Rule 4 comment rewrite.
```

### Current Codebase tree (relevant)

```bash
src/pi/widget.ts                # MODIFY: fingerprint state + onDismissed + R4 + paint
test/widget-visibility.test.ts  # EXTEND: release cases (fresh-buffer per dismissal variant)
test/widget.test.ts             # RE-RUN + end-to-end repro inversion
```

### Desired Codebase tree with files added

```bash
# no new files
```

### Known Gotchas & Library Quirks

```typescript
// THE FINGERPRINT IS lines.join("\n"), not lines[0] — multi-line buffers
// and cursor line ≠ 0 must work; join("\n") is what evaluate's rule-7
// cursor-move fingerprint already uses (:598) — but keep them SEPARATE
// variables (rule 7's lastFingerprint has different lifetime semantics).

// null MEANS CONTEXT-FREE, not "no fingerprint": an EMPTY dismissed
// buffer sets suppressedFingerprint = null → sameWordContinuation false →
// release at any boundary. Do not conflate with the "no suppression
// active" state (suppressed === false) — the pair (suppressed,
// suppressedFingerprint) is only meaningful while suppressed.

// KEEP suppressedFragmentStart — the release condition needs BOTH
// atBoundary && start === suppressedFragmentStart (the word-start half)
// AND the fingerprint relation (the same-word half). Dropping the start
// check would release mid-word.

// EMPTY CURRENT BUFFER: "" .startsWith(fp) is false and fp.startsWith("")
// is TRUE (every string startsWith "") — so an empty dismissed buffer
// must be the null case (handled), and an empty CURRENT buffer while
// suppressed with a non-empty fp WOULD pass fp.startsWith(current) —
// that is correct: backspacing the whole word away keeps you in the same
// word context; the next word start (a typed char) then re-tests.

// RECOMPUTE, don't pass through: onInput's :598 fingerprint exists only
// on the input path; onDismissed's evaluate-time state and the R4 check
// must each call deps.getEditorState()/use evaluate's lines argument
// directly.

// ENTER-SUBMIT ORDER: Enter clears the buffer AFTER machine.onDismissed
// fires (:1113-1119) — so the recorded fingerprint is the PRE-submit
// buffer ("Zendesk"), and the cleared buffer "" fails both startsWith
// directions... fp.startsWith("") is TRUE (see above) — so the empty
// post-submit buffer stays suppressed, and the FIRST TYPED CHAR of the
// next message ('l' of "lw") makes current="l", neither a prefix of
// "Zendesk" nor vice versa → RELEASES. Verify this exact sequence in the
// test; if the composed harness types 'lw' as one tick, 'lw' vs
// 'Zendesk' also releases — both hold.

// BUG-001 SEQUENCING: the chain branch (P1.M1.T2.S1, Complete) rewrote
// evaluate's word-mode block — re-read the CURRENT evaluate before
// editing; the R4 check may now sit near the chain-consult branch and
// isIntentBypass (:352/:640). A chain offer at start 0 must paint: the
// fingerprint release makes it a released word start; pin it.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: TDD — write failing release tests first
  - test/widget-visibility.test.ts, new describe("R4 — fingerprint release
    (BUG-003)"): for EACH of Tab-accept / Escape / Enter-submit variants
    (drive onDismissed(true) the way the corresponding key path does):
    dismiss at start 0 with buffer "Zendesk" (post-Tab) or "ze" (Escape),
    then set a FRESH buffer ("", then "lw" at start 0) → evaluate →
    visible === true with the lwlock set. Same-buffer backspace case:
    dismiss "zend", backspace to "zen" → still suppressed. Empty-dismiss
    case: dismiss with buffer "" → any boundary releases.
  - Chain-composition case: armed chain + start-0 Tab-accept dismissal →
    zero-char successor offer at the next word start paints.
  - Run: FAIL today.

Task 1: MODIFY src/pi/widget.ts
  - ADD suppressedFingerprint beside :533; reword the Rule 4 comment
    (spec 07:72-75 quote + fingerprint semantics + prefix relation).
  - onDismissed: record lines.join("\n") ("" → null) beside the start.
  - R4 check: add the sameWordContinuation conjunct (exact expression in
    What §3).
  - paint(): clear suppressedFingerprint beside :613.
  - NO changes to: trigger-char bypass, disqualification close (never
    suppresses), key-layer call sites, the chain branch's logic.

Task 2: GREEN + regression
  - npx vitest --run test/widget-visibility.test.ts test/widget.test.ts -v
  - Existing suppression pins pass UNMODIFIED; if one legitimately
    conflicts, the fingerprint rule is wrong — revisit the rule, not the pin.

Task 3: VALIDATE
  - npm run check && npm test
  - Live TTY verification per spec/09 (UI-layer change): load the
    extension, dismiss a first word via Tab→Enter, type the next message's
    first word, confirm the line paints; record the session evidence.
```

### Implementation pattern

```typescript
// R4 release conjunct (sketch — inside evaluate's suppressed branch)
const fp = suppressedFingerprint;
const current = lines.join("\n");
const sameWord = fp !== null && (current.startsWith(fp) || fp.startsWith(current));
if (!atBoundary || start !== suppressedFragmentStart || !sameWord) {
  /* release: fall through to normal word-mode evaluation */
}
```

### Integration Points

```yaml
NONE this task:
  - Machine-internal state change; deps seam, paint(), trigger bypass,
    and key layer untouched. Closes BUG-003; no spec/config/README edits
    (P1.M2.T4 owns docs sync).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/widget-visibility.test.ts test/widget.test.ts -v
npm test   # full suite green (1053 baseline + new cases)
```

### Level 3: Live TTY (binding — UI-layer change)

```bash
# Load the extension in a real pi session (spec/09 live technique):
# 1. type a stored word prefix → line shows → Tab (accept, suppress at 0)
# 2. Enter (submit, buffer clears)
# 3. type the first word of a new message → the line MUST paint
# Record the verification in the work item notes; remove instrumentation.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green
- [ ] Both widget test files re-run (chain branch + this fix share evaluate)

### Feature Validation

- [ ] All three start-0 dismissal variants release on the next message's first word (PRD repro inverted)
- [ ] Same-buffer same-word edit/backspace stays suppressed; empty-dismiss is context-free
- [ ] Zero-char chain offer at start 0 paints (BUG-001 composition pinned)
- [ ] Trigger-char bypass and existing suppression pins unchanged

### Code Quality Validation

- [ ] Rule 4 comment rewritten with spec citation + prefix-relation rationale
- [ ] suppressedFingerprint lifecycle: set in onDismissed, cleared ONLY in paint; null-semantics documented
- [ ] No new deps/fields on the machine's public interface

## Anti-Patterns to Avoid

- ❌ Don't drop the `start === suppressedFragmentStart` conjunct — the fingerprint alone would release mid-word
- ❌ Don't reuse rule 7's `lastFingerprint` variable — different lifetime
- ❌ Don't special-case "buffer is empty → release" — the null-fingerprint (context-free) design already covers empty DISMISSAL; an empty CURRENT buffer legitimately stays suppressed (same-word backspace-to-nothing)
- ❌ Don't add a reset-on-submit seam through editor.ts (rejected design — misses hidden-Enter submits)
- ❌ Don't touch the trigger-char bypass, chain-branch logic, or key-layer call sites
- ❌ Don't weaken/patch existing suppression pins to pass — if they conflict, the rule is wrong
