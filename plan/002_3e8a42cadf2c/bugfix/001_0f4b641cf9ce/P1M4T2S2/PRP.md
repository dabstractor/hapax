# PRP — P1.M4.T2.S2: Append the bugfix-001 re-verification record to docs/M1-DoD.md

## Goal

**Feature Goal**: Append a self-contained, re-runnable **"Bugfix 001
re-verification"** section to `docs/M1-DoD.md` — one entry per bug
(BUG-001..BUG-006) with root cause (one line, citing the architecture/ doc),
the fix (subtask IDs), the locking test(s), and the re-run command + measured
result — plus the three explicit records the contract demands: the
admission-relief ceiling value, the spec/§04 drift note, and the still-open
`successorIndex` eviction-cleanup gap.

**Deliverable**: `docs/M1-DoD.md` — appended section only (all existing
content untouched, per the file's own convention). This IS the Mode B
changeset-level docs subtask for the DoD record.

**Success Definition**: A reader can verify the entire bugfix-001 changeset
from this one section: every bug maps to a named green test and a re-runnable
command; the relief ceiling (95) and its constraint interval are recorded; the
spec/code band drift (spec 220/120 vs code 50/20 + relief) is recorded as an
owner-accepted deviation with the spec staying READ-ONLY; the successorIndex
gap is explicitly marked out of scope; `npm run check` + `npm test` still
green (docs-only change).

## User Persona

**Target User**: maintainer / future auditor re-verifying bugfix-001, and the
next planning round deciding whether to fix the successorIndex gap.
**Use Case**: "was BUG-003 actually fixed, and how do I re-check?" → open the
section → root cause, fix ID, locking test, command, measured result.
**User Journey**: scan the six-entry table → run any entry's command →
confirm exit 0 / expected counts.
**Pain Points Addressed**: fix evidence currently lives scattered across six
PRPs, per-file JSDoc, and P1.M4.T1.S1's research notes — no single
changeset-level record.

## Why

- `docs/M1-DoD.md` is the established evidence-record convention (spec-
  acceptanceance-map.md: "docs/M1-DoD.md — evidence record; … update evidence
  as fixes land (Mode A) + add bugfix re-verification record (final task)").
  This is that final task.
- Inputs: all six fixes Complete (P1.M1–P1.M3); P1.M4.T1.S1 (implementing in
  parallel) refreshes docs/M1-DoD.md's integration items 5/6/7 and writes
  `plan/002_…/P1M4T1S1/research/regression-evidence.md` (counts, bench
  table, triage log) — cite it rather than re-measuring.
- README is P1.M4.T2.S1's file (parallel); do not touch it.

## What

Append (end of file) a section in the file's established style (quoted
contract, dated, head commit, re-runnable commands, verdict):

```
## Bugfix 001 re-verification (001_0f4b641cf9ce) — evidence record

- Re-verification date: <date> · Head commit: <git rev-parse HEAD>
- Input: P1.M4.T1.S1 regression evidence (research/regression-evidence.md)
- Suite: <files/tests/skipped counts from the re-run>
- Verdict: all six defects fixed and locked by named green tests.

### BUG-001 — threshold mode preempts stock slash/@/quoted-path; Tab opens menu
- Root cause: extractMatchState's threshold regex fired on any trailing
  identifier and getSuggestions never consulted `current` (BUG-001,
  adversarial-e2e PRD h3.0; architecture/spec-acceptance-map.md §07 quotes).
- Fix: P1.M1.T1.S1 `classifyStockContext` pure helper + unit tests;
  P1.M1.T1.S2 delegation in getSuggestions before the armed-chain branch.
- Locking tests: provider-match.test.ts (classify), provider.test.ts +
  provider-live.test.ts (sentinel delegation, args identity, never-hijack net).
- Re-run: `npx vitest --run test/provider-match.test.ts test/provider-live.test.ts`
  → <measured result>.

### BUG-002 — NREL phrase words admission-rejected; §09 item 7 unreachable
- Root cause: band retune to 50/20 rejects national(90)/energy(94)/
  laboratory(57) → empty successor index (adversarial PRD h3.1).
- Fix: P1.M2.T1.S1 proper-noun relief band in admit(); P1.M2.T1.S2 tuning-
  protocol re-run; P1.M2.T1.S3 item-7 end-to-end pin.
- **Recorded: relief ceiling `PROPER_NOUN_ADMIT_CEILING = 95`** (constraint
  interval 94 < ceiling ≤ 156 so `energy`=94 admits and lowercase
  `context`-class words stay rejected; blanket retune rejected — see
  architecture/core-engine-findings.md).
- **Recorded drift: spec/04 stays 220/120 by owner decision (spec is
  READ-ONLY); code ships 50/20 + relief, documented in score.ts JSDoc.**
- Locking tests: score.test.ts (relief unit), calibration.test.ts +
  shipped-dict.test.ts (COMMON_PROBES unaffected), chain.test.ts item 7.
- Re-run: `npx vitest --run test/score.test.ts test/calibration.test.ts` …
  → <result>.

### BUG-003 — secret fragments (CYEXAMPLEKEY etc.) admitted
- Fix: P1.M2.T2.S1 mask floor 40→32; P1.M2.T2.S2 whole-token secret
  rejection propagated to sub-word drafts (ingest memo); P1.M2.T2.S3
  synthetic-token paste battery.
- Locking tests: mask-secrets.test.ts, shapeGate.test.ts,
  adversarial-ingest.test.ts (paste battery).
- Re-run + result.

### BUG-004 — astral letter before ASCII run leaks remainder (𝔘sword→sword)
- Fix: P1.M3.T1.S1 code-point-correct boundary guard at both guard sites.
- Locking tests: segment.test.ts astral cases.
- Re-run + result.

### BUG-005 — armed chain swallows trigger char; mis-prefixed successor set
- Fix: P1.M1.T2.S1 word-start fragment requirement + reset/fall-through;
  P1.M1.T2.S2 editor-sim integration test.
- Locking tests: chain.test.ts trigger-reset cases, provider-live.test.ts.
- Re-run + result.

### BUG-006 — bigram map over 10k cap after one large message
- Fix: P1.M3.T2.S1 loop batched eviction until within BIGRAM_CAP in the
  same recordBigramRuns call.
- Locking tests: bigrams.test.ts (10k cap, 11k-bigram single message).
- Re-run + result.

### Explicit out-of-scope record
- **`successorIndex` eviction cleanup known gap remains OPEN and out of
  scope for this changeset** (see existing "Known accepted gap —
  successorIndex eviction cleanup" section above; bigram eviction splices
  its own successor entries, but orphaned successor-index cleanup after
  word eviction is not performed).

### Reproduction block
(the exact commands above, consolidated, plus `npm run check` / `npm test`)
```

Fill every `<date>`/`<result>`/counts from an actual fresh run (or from
P1.M4.T1.S1's regression-evidence.md if it has landed — prefer citing it and
running the suite once yourself to confirm counts match).

### Success Criteria

- [ ] Section appended at end of docs/M1-DoD.md; zero edits to existing
      sections (verify with git diff — append-only hunk)
- [ ] Six bug entries, each: root cause w/ architecture-doc citation, fix
      subtask IDs, locking test filenames, re-run command, measured result
- [ ] Relief ceiling 95 + constraint interval recorded
- [ ] Spec/04 drift note recorded (spec 220/120 read-only; code 50/20+relief
      in score.ts JSDoc)
- [ ] successorIndex gap explicitly recorded as remaining out of scope
- [ ] Every command in the section actually run and green before recording
- [ ] `npm run check` + `npm test` green (docs-only change)

## All Needed Context

### Context Completeness Check

Implementer needs: the existing doc's style/structure, the six fixes' PRPs
(for fix IDs + test names), the relief-ceiling facts, the drift decision, the
gap reference, and P1.M4.T1.S1's evidence output. All cited below.

### Documentation & References

```yaml
- file: docs/M1-DoD.md
  why: THE deliverable — append only. Study its established style: quoted
        contract, dated/head-commit banner, per-item PASS blocks with fenced
        command output, triage log, files-changed table, reproduction block.
        It already contains: "Known accepted gap — successorIndex eviction
        cleanup" (L388) and per-item Mode A updates from P1.M4.T1.S1.
  gotcha: append-only; do not rewrite or re-order existing sections

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/spec-acceptance-map.md
  why: root-cause citations (§07 Tab-open quote, §04 band drift note,
        §06 successor cap) + full locking-test inventory per fix area +
        the docs-surfaces contract naming this exact task
  critical: it records "⚠️ Code ships 50/20 — spec/code drift is KNOWN;
        do not edit spec; record relief band in code JSDoc + docs"

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/core-engine-findings.md
  why: why the targeted relief band was chosen over a blanket retune
        (ceiling constraint interval 94 < ceiling ≤ 156)

- file: plan/002_…/P1M2T1S1/PRP.md (same bugfix dir)
  why: PROPER_NOUN_ADMIT_CEILING = 95 export, relief-before-reject ordering,
        boundary semantics (strict: ceiling itself rejects)

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M4T1S1/PRP.md
        + its research/regression-evidence.md (if landed)
  why: PARALLEL dependency — re-measured §09 items 5/6/7, full-suite counts,
        bench table, triage log. Cite it; run the suite once to confirm.

- file: prd_snapshot.md (bugfix dir) h3.0–h3.5 + h2.5
  why: the six PRD issues + recommendations = the checklist this record
        closes out; quote one root-cause line per bug from here

- file: src/core/score.ts
  why: verify the relief ceiling constant + drift JSDoc actually shipped
        before recording them as evidence
- files: src/pi/provider.ts, src/core/shapeGate.ts, src/core/segment.ts, src/core/store.ts
  why: spot-verify each fix's JSDoc/testable surface (Mode A docs landed
        per-subtask) before signing the record
```

### Current codebase tree (relevant)

```bash
docs/M1-DoD.md            # deliverable (append)
src/core/{score,shapeGate,segment,store}.ts   # fix surfaces (read-verify)
src/pi/provider.ts
test/                     # locking suites named above
plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/{architecture,PRP dirs}/
```

### Desired tree

```bash
docs/M1-DoD.md   # + appended "Bugfix 001 re-verification" section (only change)
```

### Known Gotchas

```text
# APPEND-ONLY: the doc's integrity contract is that prior evidence stands
#   as recorded; a git diff showing modified existing lines = failure.
# The drift note must NOT edit spec/*.md (READ-ONLY product spec) — the
#   record lives in code JSDoc + this doc, by owner decision.
# Do not invent measured numbers: run the commands (or cite S1's
#   regression-evidence.md) and paste real counts. If S1 hasn't landed,
#   run npm test yourself and note the count source.
# README.md belongs to parallel P1.M4.T2.S1 — do not touch.
# BUG IDs: this changeset's PRD uses BUG-001..BUG-006 mapped to h3.0-h3.5
#   in PRD order (001 slash-preempt, 002 admission, 003 secrets, 004 astral,
#   005 chain trigger, 006 bigram cap) — keep that mapping explicit.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: VERIFY shipped surfaces
  - GREP score.ts for PROPER_NOUN_ADMIT_CEILING (expect 95) + drift JSDoc
  - GREP provider.ts classifyStockContext, shapeGate/store/segment fixes
  - RUN npm run check && npm test once; capture file/test counts
  - CHECK whether plan/…/P1M4T1S1/research/regression-evidence.md exists;
    if yes, prefer its numbers (and confirm they match your run)

Task 2: APPEND the section to docs/M1-DoD.md
  - WRITE per the structure in What: banner (date, head commit, input
    citation, suite counts, verdict), six bug entries (root cause w/
    architecture-doc citation → fix subtask IDs → locking tests → re-run
    command → measured result), relief-ceiling record, drift record,
    out-of-scope successorIndex record, consolidated reproduction block
  - STYLE: mirror existing sections (fenced code blocks for commands,
    PASS verdicts, tables where counts warrant)

Task 3: SELF-VERIFY
  - RUN every command listed in the new section; results must match what
    is recorded (exit 0, expected test counts)
  - git diff docs/M1-DoD.md → single append hunk
  - npm run check && npm test green
```

### Integration Points

```yaml
DOCS: this IS the Mode B changeset docs task for the DoD record
README: owned by parallel P1.M4.T2.S1 — untouched
SPEC: spec/*.md read-only; drift recorded here + in score.ts JSDoc only
DOWNSTREAM: none — closing task of bugfix-001
```

## Validation Loop

### Level 1: doc sanity

```bash
git diff --stat docs/M1-DoD.md        # docs/M1-DoD.md only
git diff docs/M1-DoD.md | head -5     # hunk header shows pure append (@@ ... +N,0 M)
grep -c "^## Bugfix 001 re-verification" docs/M1-DoD.md   # exactly 1
```

### Level 2: recorded evidence is real

```bash
npm run check && npm test             # counts match the banner
npx vitest --run test/score.test.ts   # relief unit tests green
grep -n "PROPER_NOUN_ADMIT_CEILING" src/core/score.ts   # = 95, drift JSDoc present
```

### Level 3: every listed command re-runnable

```bash
# extract each fenced command from the new section and run them; all exit 0
```

### Level 4: completeness vs contract

```bash
grep -c "BUG-00[1-6]" docs/M1-DoD.md   # ≥ 6 in the new section
grep -n "95" docs/M1-DoD.md            # ceiling recorded
grep -n "220/120" docs/M1-DoD.md       # drift note present
grep -n "successorIndex" docs/M1-DoD.md # out-of-scope record present
```

## Final Validation Checklist

- [ ] Append-only diff on docs/M1-DoD.md; no other file touched
- [ ] Six entries complete (root cause + citation, fix IDs, tests, command,
      measured result)
- [ ] Relief ceiling 95 + interval; spec/04 drift note; successorIndex gap
      recorded out of scope
- [ ] All recorded commands actually re-run green; counts match
- [ ] `npm run check` + `npm test` green
- [ ] Section style matches the document's established conventions
- [ ] BUG-ID → PRD h3.x mapping explicit

## Anti-Patterns to Avoid

- ❌ Don't edit existing DoD sections — append only
- ❌ Don't edit spec/*.md or README.md (parallel/owner files)
- ❌ Don't record unmeasured or aspirational numbers — run the commands
- ❌ Don't describe the successorIndex gap as fixed — it is explicitly open
- ❌ Don't paraphrase the drift as "spec updated" — spec stays 220/120
