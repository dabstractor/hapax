---
name: "P1.M2.T1.S1 (plan 005) — README sweep: re-mirror invariant 1 from spec/SPEC.md, purge stale old-model claims"
---

## Goal

**Feature Goal**: Make README.md consistent with the landed widget arrow
interaction model v2 (P1.M1.T1.S1–S3, tests green) by (a) re-mirroring
design invariant 1 VERBATIM from spec/SPEC.md:38–43 — the current mirror
(:318–323) still teaches the old consumed-press "boundary-Esc" model
despite the section claiming "the text below is verbatim" — and (b)
sweeping every remaining old-model claim (the :545 verification note;
auditing the decision-log prose refs). Documentation only: no code, no
tests, no spec edits.

**Deliverable**: Updated README.md rows (:318–323 invariant-1 re-mirror;
:545 note wording; any other stale hit the sweep finds) + grep-clean of
old-model claims.

**Success Definition**: `grep -n 'boundary-Esc' README.md` returns
nothing; invariant 1 matches spec/SPEC.md:38–43 character-for-character;
:195–200 widget prose (already v2) untouched; :545 reads v2-consistent;
false-positive grep hits (rescues/TypeScript/desc/narrow, config-table
"(clamped)", :241 word-boundary) untouched; `npm run check` + `npm test`
green (docs-only change).

## Why

- P1.M1 landed model v2: boundary PASS-THROUGH (one press, caret moves,
  plain-pi parity) supersedes the consumed-press boundary-Esc variant,
  and the carousel (interacted generations wrap; clamp retired)
  supersedes clamping. The README's "Design invariants" section claims
  to mirror spec/SPEC.md verbatim but still carries the old text — a
  reader of the README gets a wrong acceptance-critical invariant.
- Mode B: this subtask IS the changeset-level documentation sweep;
  P1.M2.T1.S4's dated changeset record (docs/M1-DoD.md) consumes it.

## What

### Row 1 — :313–331 "Design invariants" mirror, invariant 1 (:318–323)

Replace the invariant-1 paragraph with the VERBATIM v2 text from
spec/SPEC.md:38–43 (keep the numbered-list formatting and the section's
"that file is authoritative; the text below is verbatim" framing — the
framing becomes TRUE again):

```markdown
1. **Never hijack typing.** No key is ever captured, consumed, or altered except
   Tab while a suggestion is selected — plus, on the one-line widget display
   (M3), the arrow keys and Escape once the result line has been ENTERED; on
   an un-entered line ↑/← on the first word dismiss the line AND forward the
   press (the caret moves — one press, plain-pi parity). The user's typing
   experience is otherwise unchanged; the result line is strictly
   take-it-or-leave.
```

Invariants 2–4 (:324–331) are unchanged by v2 — verify they still match
SPEC.md (they do today) and leave them.

### Row 2 — :545 verification note

Current: "…arrow/Escape/Tab key capture, Enter submits — spec 09
live-verification technique)." That dated 2026-09-08 note describes the
old capture-while-visible model. Reword to be v2-consistent without
falsifying the historical date, e.g.:

```markdown
The M3 widget path was additionally live-verified 2026-09-08 against the
real pi + split-editor stack (widget visibility; arrow/Escape/Tab key
handling — arrows and Escape are captured only once the list is entered,
with one-press boundary pass-through on an un-entered line (spec 07,
2026-10 v2 model); Enter submits — spec 09 live-verification technique).
```

(Exact wording flexible; the requirement is: no claim that arrows are
captured merely "while the line is visible", and boundary behavior
described as pass-through, not consumed-press.)

### Row 3 — full sweep

Run `grep -n -i -E 'boundary|clamp|second press|esc|arrow|carousel|interaction' README.md`
and judge every hit:
- **:195–200** widget-mode prose — ALREADY v2 (two-state, pass-through,
  carousel); DO NOT regress or rewrite.
- **:321** — fixed by Row 1.
- **:545 area** — fixed by Row 2.
- **False positives — leave untouched**: "rescues"/"TypeScript"/"desc"/
  "narrow"; config-table "(clamped)" :462–486 (knob ranges); :241
  word-boundary tokenization mention.
- **Decision-log prose refs** (:14, :23, :70, :251–252, :268 — README has
  no decision-log table): audit each for old-model wording; today none
  mention arrows/clamp — if any does, fix it; otherwise leave.

### Success Criteria

- [ ] Invariant 1 verbatim from spec/SPEC.md:38–43; "verbatim" framing true
- [ ] `grep -n 'boundary-Esc' README.md` → nothing; no "second press"/consumed-press/clamp-as-current claims outside history contexts
- [ ] :195–200 unchanged; false-positive hits untouched
- [ ] :545 v2-consistent
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer needs: the exact stale rows with current text, the
verbatim v2 source text, the already-correct row to protect, the
false-positive list, and the v2 model summary to judge sweep hits. All
below.

### Documentation & References

```yaml
- file: README.md
  why: The ONLY file edited. Rows: :313-331 (invariant mirror — replace
        invariant 1's paragraph :318-323), :545 verification note; sweep
        hits per Row 3.
  pattern: the mirror section keeps its numbered-list structure and the
           "authoritative … verbatim" framing.
  gotcha: do NOT touch :195-200 (already v2) or the false-positive hits.

- file: spec/SPEC.md
  section: "Design invariants" :38-43
  why: The authoritative invariant-1 v2 text to mirror VERBATIM (quoted
        in full in "What" Row 1). Spec is READ-ONLY — mirror only.

- docfile: plan/005_f9498a2d63d5/architecture/external_deps.md
  section: "README.md stale inventory (626 lines)"
  why: The scout-verified stale-row list with exact line numbers, the
        already-v2 rows, and the false-positive list.

- docfile: plan/005_f9498a2d63d5/prd_snapshot.md (mirrors spec/)
  section: h2.2 (invariants), h2.42/h3.9 (widget key handling v2 —
           boundary pass-through, carousel, clamp retired), h2.47
  why: The v2 model reference for judging sweep hits: arrows/Escape
        captured only once ENTERED; un-entered ↑/← dismiss + forward
        (one press, caret moves); interacted generations wrap both
        edges; every new result set resets to un-entered.

- docfile: plan/005_f9498a2d63d5/P1M1T1S3/PRP.md
  why: The parallel predecessor (widget.test.ts v2 battery, zero
        README/source changes) — confirms the landed v2 behavior this
        README documents and confirms no file overlap.
```

### Current Codebase tree (relevant)

```bash
README.md   # MODIFY (invariant-1 mirror + :545 note + sweep fixes)
```

### Known Gotchas & Library Quirks

```markdown
# CRITICAL: the mirror must be VERBATIM from spec/SPEC.md:38-43 — the
# section's own framing ("the text below is verbatim") makes any
# paraphrase a lie. Copy the exact five lines, preserve the numbered-item
# indentation.

# GOTCHA: line numbers drift once edits land — locate rows by their
# current TEXT (quoted here), not only by line number.

# GOTCHA: :195-200 is already correct — the temptation to "harmonize"
# it is a regression risk. Touch only if the sweep proves a stale claim.

# GOTCHA: the :545 note is a dated HISTORICAL verification record — keep
# the 2026-09-08 date; make the described behavior v2-consistent (or
# annotate it as since-superseded) rather than rewriting history.

# GOTCHA: "(clamped)" in the config table :462-486 is about config knob
# ranges — unrelated to the retired arrow clamp. Do not "fix" it.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: RE-MIRROR invariant 1 (README.md :318-323)
  - REPLACE the invariant-1 paragraph with the verbatim v2 text
    (quoted in "What" Row 1)
  - VERIFY invariants 2-4 (:324-331) still match spec/SPEC.md — expect
    no change (v2 touches only invariant 1)

Task 2: FIX the :545 verification note wording (Row 2)

Task 3: SWEEP
  - grep -n -i -E 'boundary|clamp|second press|esc|arrow|carousel|interaction' README.md
  - Judge each hit per Row 3: fix genuine old-model claims; leave
    :195-200, false positives, and already-accurate prose

Task 4: VALIDATION (docs-only)
  - grep -n 'boundary-Esc' README.md            # expect nothing
  - diff the invariant block against spec/SPEC.md:38-43 (verbatim check)
  - npm run check && npm test                    # green, unchanged
```

### Implementation pattern

Row 1 final text (copy exactly, including line-wrapping):

```markdown
1. **Never hijack typing.** No key is ever captured, consumed, or altered except
   Tab while a suggestion is selected — plus, on the one-line widget display
   (M3), the arrow keys and Escape once the result line has been ENTERED; on
   an un-entered line ↑/← on the first word dismiss the line AND forward the
   press (the caret moves — one press, plain-pi parity). The user's typing
   experience is otherwise unchanged; the result line is strictly
   take-it-or-leave.
```

### Integration Points

```yaml
NONE (documentation only):
  - P1.M2.T1.S4's docs/M1-DoD.md dated changeset record consumes this
    sweep's outcome.
```

## Validation Loop

### Level 1–3: docs-only

```bash
grep -n 'boundary-Esc' README.md                 # expect: nothing
sed -n '38,43p' spec/SPEC.md                     # compare against the mirror
grep -n -i -E 'second press|caret unmoved|press consumed' README.md  # expect: nothing
npm run check && npm test                        # green, unchanged
```

### Level 4: spec-conformance re-read

Re-read spec/SPEC.md:38–43 and spec/07 h3.9 against every edited row:
the mirror is verbatim; the :545 note's described behavior matches the
v2 two-state model.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` + `npm test` green (no code touched)
- [ ] Stale-phrase greps return nothing

### Feature Validation

- [ ] Invariant 1 verbatim from SPEC.md:38–43; framing true
- [ ] :545 v2-consistent; historical date preserved
- [ ] :195–200 untouched; false positives untouched
- [ ] Decision-log prose refs audited (fixed or confirmed clean)

### Code Quality Validation

- [ ] No spec edits, no code edits — README.md only
- [ ] Sweep hits each judged, not blanket-edited

## Anti-Patterns to Avoid

- ❌ Don't paraphrase the invariant — the section claims verbatim
- ❌ Don't regress :195–200 (already v2) or "fix" the config-table "(clamped)"
- ❌ Don't rewrite the historical verification date at :545
- ❌ Don't blanket-replace every grep hit — the false-positive list is explicit

**Confidence Score: 9/10** — two pinned rows with verbatim source text,
an explicit false-positive list, and a bounded sweep; pure documentation.
