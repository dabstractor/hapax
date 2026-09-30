# PRP — P1.M2.T4.S1: README/overview sweep for the bugfix changeset

## Goal

**Feature Goal**: Make `README.md` (and, only if a line is falsified,
`docs/M1-DoD.md`) consistent with the shipped behavior of bugfix changeset
001: M2 chained completion live on the widget PRIMARY display path (BUG-001),
no duplicate candidates from trailing-`_` literals (BUG-002), no
cross-message suppression leak (BUG-003), and no 64KB chunk-boundary token
shredding (BUG-004).

**Deliverable**: An edited `README.md` whose chained-completion blurb
describes BOTH display paths (widget line via the visibility machine's
intent bypass + the fallback menu), a swept items/status list with no
statements the changeset invalidates, and (only if needed) an additive
note in `docs/M1-DoD.md`.

**Success Definition**: Every user-facing claim in README's Features/Status
sections matches `spec/*.md` (the single source of truth) and the shipped
code; the chained-completion blurb covers widget-primary arming; `npm test`
and `npm run check` still pass (docs-only change must not break anything);
no spec file is edited by this task (that belongs to implementing subtasks
and P1.M2.T4.S2).

## Why

- The repo's binding policy (AGENTS.md): `spec/*.md` is the single source
  of truth and README is a summary that never overrides it. The implementing
  subtasks already landed their spec edits (spec/07 M2 clarifying clause,
  spec/04 strictly-additive containment bullet, spec/05 carry sentence,
  BUG-003 suppression spec note). This Mode B terminal task syncs the
  changeset-level user-facing docs that only make sense once the whole
  change is in place — per the SOW it must run last, after every
  implementing subtask it summarizes.
- README.md's chained-completion blurb currently cites only
  `src/pi/provider.ts` and describes the fallback flow — after this
  changeset that is materially misleading: the typical session (pi-vim,
  split-editor — any extension installing an editor) uses the widget path,
  where chaining now arms and renders zero-typed-char successor offers.

## What

Documentation edits only. No code, no spec changes.

### Success Criteria

- [ ] README chained-completion blurb (~:134-144, header "**Chained Tab
  completion — zero additional typing, one word per Tab**") cites both
  paths — e.g. `(src/pi/provider.ts`, `src/pi/widget.ts`) — and states that
  Tab acceptance arms the chain on the widget primary path as well as the
  fallback menu, with zero-typed-char successor offers rendering on the
  widget line like any result set (spec/07's intent bypass).
- [ ] README items/status list (:20-25 area) contains no statement the
  changeset invalidates; specifically the status paragraph accurately
  reflects that bugfix-001's four fixes (widget-path chaining, tokenizer
  overlap dedupe, suppression leak, chunk-boundary carry) are in.
- [ ] `docs/M1-DoD.md`: ONLY additive — a short bugfix-001 post-delta note
  appended (defects found + fixed + re-verification pointers); existing
  historical records are NOT rewritten (they correctly describe what was
  true when verified). Skip entirely if nothing is falsified.
- [ ] Blurbs stay at feature level — no implementation detail beyond what
  users need (no "isIntentBypass seam", no "insertHighlighted", no
  fingerprint mechanics).
- [ ] No file other than README.md (and optionally docs/M1-DoD.md) touched.
- [ ] `npm run check` and `npm test` pass unchanged.

## All Needed Context

### Context Completeness Check

An implementer who knows nothing about this repo needs: the exact README
regions to edit, the spec sections that are the wording authority, the
system_context documentation-targets list, and the DoD additive-only
policy. All reproduced below.

### Documentation & References

```yaml
- file: README.md
  why: The ONLY primary deliverable. Sections: chained-completion blurb
        (~lines 134-144, ends with the test-file pointer list) and the
        Status paragraph + Features list (~lines 20-25 area and onward).
  pattern: Existing blurb style — bold header with parenthetical source
        file cites, prose at feature level, test-file pointer sentence at
        the end of each blurb.
  gotcha: "The blurb's many existing TRUE details (successor index source,
        10k cap drain, display casing, threshold gating, tier-0 never
        arms, before_agent_start reset, trigger-char reset, restore
        arming, test pointers) must be PRESERVED — this is a targeted
        amendment, not a rewrite."

- file: spec/07-completion-ui.md
  why: Wording authority for chaining on both paths. Read the M2 chained
        completion section, the intent-bypass clause (~:265: 'Explicit
        intent — trigger-char results and armed-chain successors —
        bypasses the gate and shows immediately'), and the clarifying
        clause that chain offers render on the widget line (or fallback
        menu) like any result set.
  gotcha: "README NEVER overrides spec — if README wording would diverge
        from spec text, fix README wording to match spec."

- file: spec/04-tokenization-and-scoring.md (containment defer bullet, ~:102)
  why: Authority for BUG-002 wording if the README mentions duplicate
        handling anywhere (likely not — verify, don't invent).
- file: spec/05-ingestion.md (~:32-38 slice-carry sentence)
  why: Authority for BUG-004 wording (trailing partial token carried
        across 64KB slice boundaries) — again only if README claims
        anything about chunking.
- file: docs/M1-DoD.md
  why: Milestone record. Check whether any line is falsified by the
        changeset. The M2 post-delta sections verified chaining via the
        fallback path only — historically true, NOT falsified; prefer an
        appended bugfix-001 note (see P1.M1.T2.S3's re-verification
        results for pointers) over rewriting.
  gotcha: "Additive only. It is a dated record of what was measured when."

- file: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/system_context.md
  why: §Documentation targets (:72-80) — the authoritative task split.
        Mode A doc pins were done with the code; this task is the Mode B
        remainder.
  section: "Documentation targets"

- file: AGENTS.md
  why: Binding spec-maintenance policy (spec is single source of truth;
        README never overrides).
```

### Current Codebase tree (relevant part)

```bash
README.md            # EDIT (primary)
docs/M1-DoD.md       # EDIT only additively, only if falsified
spec/                # READ-ONLY for this task (edits belong to implementing
                     #   subtasks — already landed — and P1.M2.T4.S2 drift task)
src/  test/          # read-only reference
```

### Desired Codebase tree

```bash
README.md            # amended chained-completion blurb + swept status list
docs/M1-DoD.md       # optional appended bugfix-001 note
```

### Known Gotchas & Conventions

```text
# CRITICAL: Docs-only task. If you find yourself editing src/ or spec/,
# STOP — you are out of scope.

# GOTCHA: Do not restate implementation internals (isIntentBypass,
# insertHighlighted, chain.arm, fingerprint) in README — feature level only:
# "accepting a word via Tab arms its successor on both the widget line and
# the fallback menu; at the next word start the successor is the top result
# with zero typed characters."

# GOTCHA: The changeset's parallel item P1.M2.T3.S2 (chunk-boundary
# regression battery) may still be landing. Do not block on it; README
# wording depends on the spec/05 carry sentence (already landed), not on
# the test battery.

# GOTCHA: P1.M2.T4.S2 (spec-text drift corrections) follows this task and
# touches spec/04 and spec/09 boundary text — do not front-run it here.

# CONVENTION: README blurbs end with a parenthetical test-pointer sentence
# (e.g. "machine: test/chain.test.ts; gating: ...; index: ..."). Extend it
# to include the widget-path chain tests added by P1.M1.T2.S3 rather than
# replacing existing pointers.
```

## Implementation Blueprint

### Task list (ordered)

```yaml
Task 1: READ the wording authorities
  - READ spec/07-completion-ui.md M2 chaining + intent-bypass clauses,
        spec/04 containment bullet, spec/05 carry sentence, README.md
        fully, docs/M1-DoD.md chain-related sections (:203, :233-354),
        system_context.md §Documentation targets
  - CONFIRM: what the shipped behavior now is on each display path

Task 2: EDIT README.md chained-completion blurb (~:134-144)
  - AMEND header cite: "(src/pi/provider.ts)" → cite both
        "src/pi/provider.ts, src/pi/widget.ts" (or equivalent phrasing)
  - ADD one-to-three sentences: Tab acceptance arms the chain on the
        widget primary path too; the zero-typed-char successor offer
        renders on the widget line like any result set (explicit intent
        bypasses the display hesitation gate, spec 07); everything else
        (one-word-per-Tab re-arm, filtering, resets, restore arming)
        applies identically on both paths.
  - PRESERVE all existing true content (successor index, casing, gating,
        tier-0 exclusion, resets, test pointers) — extend test-pointer
        sentence with the new widget chain tests (from P1.M1.T2.S3).
  - KEEP feature level; match existing blurb prose style.

Task 3: SWEEP README status paragraph + items list (:20-25 area and the
        Features bullets) for invalidated statements
  - CHECK each claim against shipped behavior; fix only falsified ones.
    Known candidates: none of the Features bullets document the buggy
    behaviors — verify, don't assume. Update the Status paragraph so the
    bugfix-001 mention reflects the four fixes landing (it currently
    says "the bugfix-001 re-verification" — ensure that reads correctly
    post-changeset, e.g. referencing widget-path chaining restored).

Task 4: CHECK docs/M1-DoD.md
  - DECIDE: is any line falsified? (Expected: no — historical records
        were true when measured.) If not, append a short dated bugfix-001
        post-delta block (4 defects found → fixed, pointer to the
        re-verification evidence from P1.M1.T2.S3 live TTY + tests,
        baseline numbers npm run check / npm test green).
  - NEVER rewrite existing dated records.

Task 5: VALIDATE
  - npm run check && npm test   # unchanged pass — docs can't break these
        but confirm nothing was accidentally touched
  - git diff --stat             # ONLY README.md (+ optionally docs/M1-DoD.md)
  - Re-read the edited blurb against spec/07 — no contradiction
```

### Key wording sketch (implementer may adapt; spec wording wins)

```markdown
**Chained Tab completion — zero additional typing, one word per Tab**
(`src/pi/provider.ts`, `src/pi/widget.ts`) — … (existing text) …
Accepting a word via Tab arms its most-likely successor on BOTH display
paths: on the widget line (the primary path) the successor renders like
any result set — explicit intent bypasses the display hesitation gate
(spec 07) — and in the fallback menu it appears exactly as before. At the
next word start the successor is already the top result with ZERO typed
characters …
```

## Validation Loop

### Level 1: Syntax & Style

```bash
# No code; verify markdown sanity (no broken link targets, no stray diff markers)
grep -n '<<<<<<<\|>>>>>>>' README.md docs/M1-DoD.md   # expect no output
```

### Level 2: Unit Tests (regression guard)

```bash
npm run check && npm test   # expected: clean / 1053+ passed — unchanged
```

### Level 3: Consistency Review (the real gate)

```bash
git diff README.md
# Manually verify against:
#  - spec/07 M2 chaining + intent-bypass clauses — no contradiction
#  - spec/04 containment bullet / spec/05 carry sentence — only if cited
#  - system_context.md §Documentation targets — both Mode B bullets done
```

### Level 4: Domain Validation

```bash
git diff --stat
# Expected output: README.md and (optionally) docs/M1-DoD.md ONLY.
# Any other file ⇒ out of scope, revert it.
```

## Final Validation Checklist

- [ ] Chained-completion blurb covers both display paths with spec-07-aligned wording
- [ ] All existing true blurb content preserved (test pointers extended, not replaced)
- [ ] Status/items list swept — no invalidated statements remain
- [ ] docs/M1-DoD.md additive-only (or untouched)
- [ ] Feature-level prose — no implementation internals in README
- [ ] Only README.md (+ optional docs/M1-DoD.md) modified
- [ ] `npm run check` && `npm test` pass
- [ ] No spec/*.md edited by this task

## Anti-Patterns to Avoid

- ❌ Don't rewrite whole README sections — targeted amendments only
- ❌ Don't let README wording diverge from spec (spec wins, always)
- ❌ Don't edit spec/, src/, or test/ — docs-only task
- ❌ Don't rewrite dated DoD records — append, never falsify history
- ❌ Don't document internals (isIntentBypass, insertHighlighted, fingerprints)
- ❌ Don't front-run P1.M2.T4.S2's spec-drift corrections

---

**Confidence Score: 9/10** — pure docs task with exact target regions
identified, wording authorities already landed in spec, and an explicit
conservative policy for the DoD record. The only judgment call (extent of
status-paragraph update) is bounded by the sweep checklist.
