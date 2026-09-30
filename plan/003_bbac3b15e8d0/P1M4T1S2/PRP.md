# PRP — P1.M4.T1.S2: DoD re-verification + docs/M1-DoD.md M3 section append

## Goal

**Feature Goal**: Run and record the full M3 acceptance gauntlet against
the complete M3 changeset (R_eff admission, rule-4d path candidates,
anchored-fuzzy matching + frequency ranking, one-line widget dual-path
display) — type check, full suite with counts, bench gates re-captured,
integration items walked — then append the M3 Definition-of-Done record to
`docs/M1-DoD.md` following the established M2 append pattern, with M1/M2
sections untouched. This record closes the changeset (Mode B) and records
any discovered spec drift in the run report ONLY (spec is read-only this
run).

**Deliverable**:
1. `docs/M1-DoD.md` — appended
   `## M3 Definition of Done — post-delta re-verification (P1.M4.T1.S2,
   <date>)` section: per-clause `###` blocks, bench-numbers block
   re-captured at the current commit, triage log, files-changed table,
   reproduction commands, bolded **Verdict** line, suite counts.
2. `plan/003_bbac3b15e8d0/P1M4T1S2/research/run-report.md` — the sweep's
   working record incl. any spec-drift notes (spec files NOT edited).

**Success Definition**: `npm run check` exit 0; `npm test` fully green
with counts reported; `npm run bench` runs with all four gates inside
spec/09 budgets (hard 3× bounds green in `test/perf-gates.test.ts`); each
M3 acceptance clause (below) mapped to a named green test or the cited
live-verification record; integration items 1 (M3 clause), 2 (capture
window), and 7 walked and recorded; the appended section mirrors the M2
pattern exactly; `git diff docs/M1-DoD.md` is additive-only (M1/M2/Bugfix
sections byte-identical).

## User Persona

**Target User**: hapax maintainer signing off M3; future readers
re-verifying the record.
**Use Case**: prove the M3 changeset meets its acceptance contract before
declaring the milestone complete; re-run any recorded command later.
**User Journey**: run the gauntlet → record per-clause evidence → append
the M3 section → verdict "M3 (v3) DONE" gates the changeset's close.
**Pain Points Addressed**: M3 is the deepest UI-layer change yet (own
rendering + own key handling); spec/09 h2.57 makes live verification
binding; nothing currently records that the M3 clauses pass.

## Why

- The M3 acceptance clauses are binding (spec/09 h2.56 item 1 M3 clause +
  item 2 capture window + item 7; r5 §1 widget suite bullets) and no DoD
  record exists for them.
- The M2 section at docs/M1-DoD.md:265 established the append pattern; r5
  §5 specifies the M3 variant precisely — follow it, don't invent.
- Inputs are contractual: the README sweep from S1 (parallel) and the
  live-verification record from P1.M3.T4.S1 (parallel) — the latter is a
  hard input (spec/09 h2.57 binding technique; the v1 proxy crash is the
  precedent for why live verification is mandatory).
- Closes the changeset: P1.M4 is the final milestone task.

## What

### 1. The gauntlet (run and record, in order)

1. **Type check**: `npm run check` — exit 0. Record.
2. **Full suite**: `npm test` — fully green; record file/passed/skipped
   counts (M1/M2 sections report this shape; the one pre-existing
   gc-dependent skip in dictionary.test.ts is expected — only NEW
   skips/failures are regressions).
3. **Perf gates**: `npx vitest --run test/perf-gates.test.ts` (hard 3× CI
   bounds — the authoritative pass/fail) and `npm run bench` for reporting
   numbers. **Re-capture the four gate numbers at the current HEAD** into
   the `### Bench numbers (<date>, re-captured at <commit>)` block:
   | Gate (spec/09 h2.58) | Limit |
   |---|---|
   | 20k-candidate anchored-fuzzy query (first-char bucket + tiers + frequency sort + top 8) | < 1 ms p99 |
   | Dictionary load + full lookup sweep of 20k words | < 60 ms |
   | Ingest 800 KB synthetic session text | < 60 ms, yields every ≤ 64 KB |
   | Steady-state heap delta (dict + store) | < 6 MB |
   Follow the M2 section's honesty-note practice (flag 1×–3× stragglers as
   "watch", not failures). Confirm gate a exercises the ANCHORED-FUZZY
   query path (P1.M2.T2.S2 re-based it); a stale describe LABEL ("prefix
   query") is cosmetic drift → run-report note only, do not widen scope.
4. **Integration items walked** (per item contract; scripted where the
   suites cover them, live-verified where h2.57 binds):
   - Item 1 M3 clause: offer one line below the input (`Zendesk | …`),
     arrows move highlight, boundary-Esc (← twice mid-word dismisses then
     moves the caret) — live record from P1.M3.T4.S1 (cite file + W-item
     ids) + scripted `test/widget.test.ts` cases.
   - Item 2 capture window: while the result line is visible ONLY
     arrows/Escape/Tab are consumed — scripted widget key-handling cases +
     live record.
   - Item 7 conversational path completion (rule 4d, riding P1.M1.T2):
     `sr` → `src/core/query.ts`, Tab inserts whole path; absolute path
     keeps leading `/`; `/` before cursor hands to stock pi — scripted
     suite (paths/segment/query/store tests from P1.M1.T2.S1–S4).
5. **No-persistence**: `npx vitest --run test/no-persistence.test.ts` +
   static `grep -rn "writeFile\|appendFile\|createWriteStream" src/`
   (expect read-side only), as prior sections did.

### 2. M3 acceptance clauses → `###` blocks (r5 §1 verbatim sources)

Each gets its own `###` block with command + named cases + date:
- **Widget visibility machine** — `test/widget.test.ts` +
  `test/widget-visibility.test.ts`: word-start fragment + candidates →
  line shows; trailing space (no `@`/`/`) → hides; path/slash/`@`
  contexts never show; zero candidates never render.
- **Key handling / boundary-Esc** — `test/widget.test.ts`: all four
  arrows navigate; ↑/← on first word dismisses (press consumed, caret
  unmoved, suppressed until next word start; disqualification close does
  NOT suppress); →/↓ clamp on last word; Tab inserts synchronously
  (never debounce-gated); Enter dismisses-then-forwards; every other key
  forwards verbatim; inner instance NEVER mutated (v1 pin).
- **Insertion casing** — replaces the word-regex span or `#fragment` with
  the candidate's display casing.
- **Highlight reset** — resets to top on every set change.
- **Startup-gate carry-over** — `test/startup-gate.test.ts` (race waits
  bounded, settled pass-through, rejected replay never wedges, onSettled
  once).
- **Editor-enter carry-over** — `test/editor-enter.test.ts`: Enter +
  open menu → cancel then delegate exactly once; proxy get/set/has
  forwarding; thenable guard; onKeystroke input-clock hook (throwing hook
  never breaks input); never-mutate pin.
- **Integration items 1-M3 / 2 / 7** — per §1.4 above.
- **Live verification record** — CITE
  `plan/003_bbac3b15e8d0/P1M3T4S1/verification-record.md` + `captures/`
  (tmux technique per spec/09 h2.57); summarize its verdicts; do not
  duplicate its captures.

### 3. The append (r5 §5 pattern, exact)

```markdown
## M3 Definition of Done — post-delta re-verification (P1.M4.T1.S2, <date>)
<one-paragraph contract statement; cite spec/09 items + r5 §1>
- Sweep date / Head commit / Environment (Node/vitest/pi)
- Suite counts: <N test files, M passed / K skipped>
### <one ### per M3 clause — see §2 above>
### Bench numbers (<date>, re-captured at <commit>)
<table: gate | budget | measured | vs budget | verdict — honesty notes>
### Triage log  (or "no failures — no triage")
### Files changed by this sweep
### Reproduction
**Verdict: M3 (v3) DONE.**   (or per-clause failures listed)
```

- Spec drift discovered during verification → run-report ONLY (spec/ is
  read-only this run; a later interactive session reconciles).
- M1, M2, and Bugfix sections untouched.

### Success Criteria

- [ ] Gauntlet items 1–5 recorded with commands + dates
- [ ] All M3 clauses mapped to named green tests or the cited live record
- [ ] Bench table re-captured at current HEAD; 3× bounds green
- [ ] docs/M1-DoD.md append additive-only, M2-pattern compliant
- [ ] Spec drift (if any) in run-report only; no spec/ edits
- [ ] npm run check + npm test green at final state

## All Needed Context

### Context Completeness Check

The implementing agent gets every clause's test-file + test-name source
(r5 §1 verbatim), the exact append pattern (r5 §5), the gate table +
commands, the citation contracts for both parallel inputs, and the
additive-only discipline. No prior knowledge assumed.

### Documentation & References

```yaml
- file: plan/003_bbac3b15e8d0/architecture/r5-spec-readme-dod.md
  why: AUTHORITATIVE — §1 M3 acceptance clauses verbatim (widget/
    editor-enter/startup-gate suite bullets + integration items 1-7),
    §3 perf-gate table + commands, §5 the exact M3 append pattern.
  section: §1, §3, §5 (§4/§6/§7 are S1's — ignore here).

- file: docs/M1-DoD.md
  why: THE deliverable + format source. M2 section (~line 265) is the
    pattern to mirror: per-item PASS blocks quoting exact commands, bench
    block "re-captured at <commit>", honesty notes, triage log,
    files-changed table, reproduction, bolded verdict. Also: the
    pi --check substitution note near the top — cite it.
  gotcha: APPEND AT END; M1/M2/both Bugfix sections byte-identical
    (verify: git diff shows only additions after line ~506).

- file: plan/003_bbac3b15e8d0/P1M3T4S1/PRP.md
  why: upstream contract — defines verification-record.md + captures/
    (tmux live widget verification, W1-W3 checks, instrumentation
    removal). HARD INPUT: the M3 DoD's live-verification clause cites it.
  gotcha: P1.M3.T4.S1 is still Implementing — confirm its record landed
    before writing the live-verification clause; if absent, that is a
    blocker to escalate, not a clause to skip.

- file: plan/003_bbac3b15e8d0/P1M4T1S1/PRP.md
  why: sibling contract (README sweep, parallel) — owns README.md and
    its sweep-log; no file overlap with this task. The changeset's
    files-changed table may cite its outcome; README content does not
    gate the gauntlet.

- file: test/widget.test.ts, test/widget-visibility.test.ts,
        test/editor-enter.test.ts, test/startup-gate.test.ts
  why: the M3 suites — per-clause test names to quote in the record.

- file: test/perf-gates.test.ts + test/bench/core.bench.ts
  why: hard 3× CI gate + reporting numbers. Confirm gate a exercises the
    anchored-fuzzy path (P1.M2.T2.S2 re-basing); stale describe labels
    are run-report drift notes, not edits.

- file: test/acceptance.test.ts, test/paths.test.ts, test/segment.test.ts,
        test/store.test.ts, test/query.test.ts
  why: item 7 (rule-4d path candidates) scripted coverage from
    P1.M1.T2.S1–S4; cite the specific path-candidate cases.

- file: test/no-persistence.test.ts
  why: DoD no-persistence assertion + the static-grep companion method
    used by prior sections.

- file: plan/003_bbac3b15e8d0/P1M4T1S2/research/notes.md
  why: this item's research — verified doc structure/line anchors, M3
    suite presence (38 test files at research time), gate-label drift
    caveat, method notes.

- file: spec/09-testing-and-acceptance.md
  why: READ-ONLY — the binding source for h2.56 items, h2.57 live
    verification technique, h2.58 gate table. Drift found here goes to
    the run report only.
```

### Current Codebase tree (relevant)

```bash
hapax/
├── docs/M1-DoD.md            # APPEND M3 section at end (after Bugfix-001 ~line 506)
├── spec/09-testing-and-acceptance.md   # read-only contract source
├── test/
│   ├── widget.test.ts, widget-visibility.test.ts   # M3 widget clauses
│   ├── editor-enter.test.ts, startup-gate.test.ts  # carry-over clauses
│   ├── perf-gates.test.ts, bench/core.bench.ts     # gates
│   ├── acceptance.test.ts, paths/segment/store/query # item 7 coverage
│   ├── no-persistence.test.ts, provider*, chain, successors, bigrams, …
│   └── …                     # ~38 test files at research time
└── plan/003_bbac3b15e8d0/
    ├── P1M3T4S1/verification-record.md (+captures/)  # live record — CITE
    └── P1M4T1S2/research/                            # run-report home
```

### Desired Codebase tree with files to be added

```bash
docs/M1-DoD.md                                        # MODIFIED: appended M3 section
plan/003_bbac3b15e8d0/P1M4T1S2/research/run-report.md # NEW: sweep record + drift notes
(src/** or test/** — only for minimal contract-restoring triage fixes, logged)
```

### Known Gotchas of our Codebase & Library Quirks

```bash
# CRITICAL: spec/ is READ-ONLY this run (Mode B) — discovered drift goes
#   into run-report.md ONLY; a later interactive session reconciles.
# CRITICAL: P1.M3.T4.S1's verification-record.md is a HARD INPUT — the
#   live-verification clause cannot be written without it; if it hasn't
#   landed, escalate rather than skip.
# CRITICAL: append-only discipline — verify with
#   git diff docs/M1-DoD.md (only additions; prior sections untouched).
# GOTCHA: perf-gate describe labels may still say "prefix query" though
#   gate a was re-based to anchored-fuzzy (P1.M2.T2.S2) — confirm the
#   MEASUREMENT path is fuzzy; label staleness = run-report drift note.
# GOTCHA: bench numbers vary run-to-run — perf-gates.test.ts is the
#   authority; record bench actuals verbatim with machine idle; 1x-3x
#   stragglers = "watch" (M2 section's honesty-note precedent).
# GOTCHA: the dictionary.test.ts gc-skip is pre-existing and expected;
#   only new skips/failures are regressions.
# GOTCHA: `pi --check` does not exist — cite the M1 section's
#   substitution table; don't hunt for the command.
# GOTCHA: locate tests by NAME (grep), not by line number — the codebase
#   moved during M3.
# GOTCHA: tmux/live re-verification beyond citing T4.S1's record is OUT
#   OF SCOPE — h2.57's binding live pass already happened there.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITIONS
  - CONFIRM plan/003_bbac3b15e8d0/P1M3T4S1/verification-record.md +
    captures/ exist (P1.M3.T4.S1 complete; instrumentation removed —
    spot-check git status shows no stray src/ modifications)
  - CONFIRM S1's README sweep landed or is irrelevant to the gauntlet
    (it is — README can't affect tests); note its status for the
    files-changed table
  - CAPTURE environment: date, git rev-parse HEAD, node --version,
    vitest + pi versions

Task 1: GAUNTLET — type check + full suite
  - npm run check → record exit 0
  - npm test → record file/passed/skipped counts; triage failures to
    owning M3 subtask PRPs (P1.M1.T1 R_eff, P1.M1.T2 paths, P1.M2.T1-T3
    fuzzy/ranking/chain-gate, P1.M3.T1-T3 widget) — minimal
    contract-restoring fixes only, logged

Task 2: GAUNTLET — perf gates
  - npx vitest --run test/perf-gates.test.ts → hard 3x bounds verdict
  - npm run bench → record the four actuals; build the budget table with
    "watch" flags for 1x-3x stragglers; confirm gate a measures the
    anchored-fuzzy path (matchFragment), note label drift if any

Task 3: GAUNTLET — M3 clause audits
  - FOR each clause in What §2: grep the suite for the named cases,
    run `npx vitest --run test/<file> -t "<name>"`, record PASS + case
    names + date; failures → triage per Task 1's ownership map

Task 4: GAUNTLET — integration items 1-M3 / 2 / 7
  - Item 1 M3 clause + item 2 capture window: cite T4.S1 record W-items
    + scripted widget cases
  - Item 7: run/cite the rule-4d path-candidate cases (segment/paths/
    store/query/acceptance suites from P1.M1.T2); walk the sr →
    src/core/query.ts scenario in the scripted suite

Task 5: GAUNTLET — no-persistence
  - npx vitest --run test/no-persistence.test.ts; grep -rn
    "writeFile|appendFile|createWriteStream" src/ → record (expect none)

Task 6: APPEND docs/M1-DoD.md M3 section
  - FOLLOW the exact structure in What §3; mirror the M2 section's
    PASS-block style; quote commands verbatim
  - VERIFY additive-only: git diff docs/M1-DoD.md

Task 7: WRITE run-report.md
  - Sweep narrative, per-clause results, spec-drift notes (if any),
    triage log, environment header

Task 8: FINAL sweep
  - npm run check && npm test one last time after any fixes — green
  - git status: only docs/M1-DoD.md + research/run-report.md (+ any
    logged triage fixes)
```

### Implementation Patterns & Key Details

```markdown
# PATTERN: per-clause record (mirror M2 section)
# ### Widget key handling / boundary-Esc: PASS
# `$ npx vitest --run test/widget.test.ts -t "Key handling"`
# - 2026-XX-XX: N/N passed. Named: "↑/← on the first word dismiss …".

# PATTERN: bench table row with honesty note
# | a. anchored-fuzzy query p99 | < 1 ms | x.xx ms | 0.xx× | < 3 ms | PASS |

# PATTERN: cite-don't-duplicate for the live record
# Live verification (spec/09 h2.57): recorded in
# plan/003_bbac3b15e8d0/P1M3T4S1/verification-record.md (W1-W…, all PASS
# at <commit>); captures/ holds the tmux evidence. Not duplicated here.
```

### Integration Points

```yaml
DATABASE: none
CONFIG: none
ROUTES: none
DEPENDS-ON: all M3 implementing subtasks (P1.M1–P1.M3; T4.S1 live record
  is a hard input), S1 README sweep (parallel, non-gating for the gauntlet)
CONSUMED-BY: the changeset close (this is M3's final gate); future
  milestones' DoD sections follow the same pattern
DOCS: Mode B — the docs/M1-DoD.md M3 append IS the changeset-level DoD
  record
SPEC: read-only this run — drift to run-report only
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check    # exit 0 (also gauntlet item 1)
```

### Level 2: Full suite

```bash
npm test         # green; counts recorded
```

### Level 3: Gates + clauses

```bash
npx vitest --run test/perf-gates.test.ts test/widget.test.ts \
  test/widget-visibility.test.ts test/editor-enter.test.ts \
  test/startup-gate.test.ts test/no-persistence.test.ts   # all green
npm run bench    # numbers within budgets; table recorded
```

### Level 4: Record integrity

```bash
git diff docs/M1-DoD.md   # additive only; M3 section follows r5 §5 shape
# spot re-run 2 recorded commands; confirm T4.S1 record cited, not duplicated
grep -rn "writeFile\|appendFile\|createWriteStream" src/   # expect none
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` exit 0; `npm test` green with counts recorded
- [ ] perf-gates hard bounds green; bench actuals re-captured at HEAD
- [ ] All M3 clause suites green individually with named cases recorded

### Feature Validation

- [ ] Every M3 clause mapped to named green tests or the cited live record
- [ ] Integration items 1-M3 / 2 / 7 walked and recorded
- [ ] Live verification cited from T4.S1 (not skipped, not duplicated)
- [ ] Bench table with honesty notes ("watch" flags where 1×–3×)
- [ ] Bolded verdict line present

### Code Quality Validation

- [ ] docs/M1-DoD.md additive-only; M2-pattern compliance (r5 §5)
- [ ] Spec untouched; drift notes confined to run-report.md
- [ ] Triage fixes minimal, logged, attributed to owning PRPs
- [ ] Reproduction commands re-runnable

## Anti-Patterns to Avoid

- ❌ Don't edit M1/M2/Bugfix sections or spec/ files — append + record only
- ❌ Don't skip or paraphrase the live-verification clause — cite T4.S1's
  record; escalate if it hasn't landed
- ❌ Don't record PASS without the exact command + date + named cases
- ❌ Don't treat old count numbers (33 files / 636 passed at M2) as
  targets — record what runs NOW
- ❌ Don't "fix" stale perf-gate describe labels by widening scope —
  run-report drift note only
- ❌ Don't re-do the tmux live pass — it already happened in T4.S1

## Confidence Score

**9/10** — deterministic verification task; every clause's test source,
the append pattern, gate table, commands, and both parallel-input
contracts were verified against the repo and r5. Residual risk: T4.S1's
live record landing in time (hard precondition, escalated not skipped).
