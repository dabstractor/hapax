---
name: "P1.M2.T1.S2 (plan 005) — Full gauntlet green + §1a drift spot-check report"
---

## Goal

**Feature Goal**: Run the complete gauntlet (`npm run check`, `npm test`, `npm run bench`) against the landed widget arrow-interaction model v2 changeset and capture suite counts + bench gate numbers; then perform ONE verification read pass over the 9-row §1a spot-check table (verification_1a.md), producing the drift report (expected verdict: NONE FOUND) that P1.M2.T1.S3 (live smoke) and P1.M2.T1.S4 (DoD append) consume.

**Deliverable**:
- Green gauntlet evidence: exit codes, dates, suite counts verbatim, bench numbers for the five spec §09 h2.58 gates
- The 9-row drift spot-check verdict table (row → file:line verified → AGREE / MISMATCH verbatim), written to `research/gauntlet-evidence.md` for S4's DoD append
- spec/*.md remain READ-ONLY (AGENTS.md h2.1: pipeline agents record drift, never edit)

**Success Definition**: All three commands green (exit 0); suite counts and gate numbers recorded exactly as printed; each of the 9 spot-check rows verified against the live repo with its verdict recorded; any mismatch captured verbatim with file:line (expected: none); zero edits to code, tests, spec, or README.

## Why

- The changeset's model-v2 code + battery (P1.M1.T1.S1–S3) and README sweep (P1.M2.T1.S1) are landing in parallel; the gauntlet is the gate that proves the whole tree is coherent before the binding live smoke (S3) and the dated DoD record (S4).
- The PRD's §1a table lists deltas ALREADY LANDED by prior changesets — one verification read pass confirms the repo actually contains each cited fix at the cited evidence site, guarding against silent drift between changesets.

## What

### (a) Full gauntlet

Run each separately, capture everything:

```bash
git rev-parse HEAD && node --version && npx vitest --version   # environment
npm run check    # tsc --noEmit — record exit code
npm test         # vitest --run — record "N test files, N passed / N skipped" verbatim
npm run bench    # reporting-only — record the five gate numbers:
                 #   anchored-fuzzy <1ms p99 · tier-0 <3ms p99 · dict load+sweep <60ms ·
                 #   ingest 800KB <180ms CI bound · heap <6MB
```
All green is the gate. If anything is red: STOP and report (fixes are not this task's mandate; coordinate per the task tree — P1.M1.T1.S3's battery is the most likely in-flight dependency; wait for it to land before running).

### (b) The 9-row §1a spot-check (verification read pass — no edits)

For each row: open the cited file:line, confirm the cited evidence exists as described, record AGREE or the verbatim mismatch.

| # | Evidence site (as cited) | What to confirm |
|---|---|---|
| 1 | src/core/segment.ts:575–580 | Rule-4c containment deferral ("equals OR CONTAINED IN" + trailing-`_` straddle absorption, FOO_1_ class) |
| 2 | src/pi/ingest.ts:402–428 | Chunk-boundary token carry ("BUG-004 fix"; a slice boundary never splits a token) |
| 3 | test/score.test.ts:129 | R_eff(9) float-compare note; boundary probes q=82 admits / q=83 rejects at 9 chars |
| 4 | src/pi/config.ts:135–162, 237, 246+ | Reserved triggerChar (@, /, ") advisory warning; notify level is "warning" |
| 5 | test/perf-gates.test.ts:309 | Ingest gate CI bound 180 ms (3× of the 60 ms budget) |
| 6 | test/store.test.ts:431 | Eviction wording: ONE pass / full 256-victim batch |
| 7 | test/acceptance.test.ts:838 + fixtures | Zorp/Zephra re-theme (zephyr-chain.jsonl content, RESULTS.md) |
| 8 | src/pi/query.ts:480, 530 | ASCII `x` in `session x${c.sessionCount}` descriptions — never U+00D7 × |
| 9 | src/pi/widget.ts:1443–1460 | BUG-001 chain arming at Tab-insert (arms at rec.key, tier !== 0 strict, fresh grant) |

Row 9 caution: P1.M1.T1.S2's wiring edit may have SHIFTED widget.ts line numbers — verify by CONTENT (the chain.arm call inside insertHighlighted), and record the actual current line next to the cited one; a line shift with content present is AGREE (note the new line), not drift.

### (c) Record

Write the evidence + verdicts to `plan/005_f9498a2d63d5/P1M2T1S2/research/gauntlet-evidence.md`:
- Environment block (date, head commit, node/vitest versions)
- Gauntlet: per-command exit code + verbatim counts + bench gate numbers
- Spot-check table with per-row verdicts and any verbatim mismatches (expected header: "Drift report (spec read-only this run): NONE FOUND" — cf. docs/M1-DoD.md:1166 precedent)

### Success Criteria

- [ ] `npm run check` / `npm test` / `npm run bench` all exit 0; counts + gate numbers captured verbatim
- [ ] All 9 spot-check rows verified with verdicts recorded; mismatches (if any) verbatim with file:line
- [ ] Zero edits to src/, test/, spec/, README.md, docs/ by this task
- [ ] Evidence file written where S3/S4 consume it

## All Needed Context

### Context Completeness Check

An implementer needs: the three commands, what to capture from each, the full 9-row table with what each row's evidence looks like, the row-9 line-shift caution, the NONE-FOUND precedent, and the scope fences (no edits; not the DoD append itself). All below.

### Documentation & References

```yaml
- file: plan/005_f9498a2d63d5/architecture/verification_1a.md
  why: THE 9-row spot-check table + the drift-report format ("NONE FOUND"
        precedent, verbatim mismatch recording).
  critical: verify by content; line numbers may have shifted under
        parallel edits (esp. widget.ts row 9).

- file: plan/005_f9498a2d63d5/architecture/external_deps.md
  section: "Gauntlet commands" (:27–31) + docs/M1-DoD.md pattern (:33–40)
  why: The three commands; the note that pi --check doesn't exist
        (sanctioned equivalents); DoD is APPEND-ONLY and S4 owns the append.

- file: plan/005_f9498a2d63d5/P1M2T1S1/PRP.md
  why: The parallel README sweep — docs-only, cannot break the gauntlet;
        confirms no overlap (S1 = README, S2 = gauntlet+drift).

- file: plan/005_f9498a2d63d5/P1M1T1S3/PRP.md
  why: The battery rewrite landing in parallel — the gauntlet's centerpiece
        dependency; do not run before it lands (or expect its failures to
        be in-flight, not drift).

- file: docs/M1-DoD.md (:1166)
  why: The "NONE FOUND" drift-report precedent this run mirrors; also the
        append-only pattern S4 will use with this task's evidence.

- file: spec/09-testing-and-acceptance.md (in-repo)
  section: h2.58 performance gates table
  why: The five gate budgets to compare the bench numbers against
        (incl. the 180 ms ingest CI-bound note — do not flag 174–187 ms
        ingest actuals as drift; the note at h2.58 explains).

- file: AGENTS.md / spec/SPEC.md h2.1
  why: The binding rule: pipeline agents treat spec/*.md as read-only and
        record drift in reports.
```

### Current Codebase tree (relevant)

```bash
src/pi/widget.ts         # spot-check row 9 (content-verify chain arming)
src/pi/{ingest,config,query}.ts, src/core/segment.ts  # rows 1/2/4/8
test/{score,perf-gates,store,acceptance}.test.ts      # rows 3/5/6/7
```

### Desired Codebase tree

```bash
plan/005_f9498a2d63d5/P1M2T1S2/research/gauntlet-evidence.md   # NEW — the deliverable
```

### Known Gotchas & Library Quirks

```bash
# GOTCHA: run the gauntlet only AFTER P1.M1.T1.S3 (battery) lands — widget.test.ts
# failures before that are in-flight work, not drift. Check the task tree /
# git log first.

# GOTCHA: bench is REPORTING-ONLY (vitest bench) — gates are asserted in
# test/perf-gates.test.ts; a bench number over a spec budget is a note for
# S4, not a failure, unless the 3× CI gate in perf-gates trips.

# GOTCHA: ingest actuals of 174–187 ms vs the spec's 60 ms headline are NOT
# drift — spec/09 h2.58's validation-Issue-4 note documents the 180 ms CI
# bound as operative. Row 5 checks the TEST's bound (180), not the headline.

# GOTCHA: line-number shifts from parallel edits (esp. widget.ts after the
# P1.M1.T1.S2 wiring) — verify by content; record "AGREE (now at :NNNN)".

# GOTCHA: `npx vitest --version` output may name the runner differently
# across versions — record verbatim what it prints.

# GOTCHA: the skipped test (gc-dependent dictionary case) is pre-existing
# and documented — carry its rationale into the counts line.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITION — confirm P1.M1.T1.S3 (battery) and P1.M2.T1.S1 (README)
  have landed (task tree / git log); if battery still in flight, wait or
  coordinate — do not run a half-changed tree

Task 1: GAUNTLET
  - Record environment (date, HEAD, node, vitest)
  - npm run check → capture exit code
  - npm test → capture counts verbatim (files / passed / skipped)
  - npm run bench → capture the five gate numbers
  - Any red: STOP, report (upstream coordination; not this task's fix scope)

Task 2: SPOT-CHECK the 9 rows
  - For each row in the table: read the cited file:line, confirm by CONTENT,
    record verdict (+ actual line if shifted, esp. row 9)
  - Fixtures for row 7: check test/fixtures/sessions/zephyr-chain.jsonl +
    RESULTS.md content for Zorp/Zephra

Task 3: WRITE research/gauntlet-evidence.md
  - Environment block; gauntlet results; 9-row verdict table; drift verdict
    header (expected "NONE FOUND"; else verbatim mismatches)

Task 4: HANDOFF verification
  - Re-run one command from the evidence verbatim (re-runnable proof)
  - Confirm zero edits: git status shows only the research file
```

### Implementation pattern

Spot-check verdict row format (mirror for all 9):

```markdown
| 9 | widget.ts:1443–1460 — chain arming at Tab-insert | AGREE — arm(rec.key)
with tier !== 0 strict + fresh grant, now at :1451–1468 after the P1.M1.T1.S2
wiring; content matches verification_1a.md row 9 |
```

### Integration Points

```yaml
DOWNSTREAM:
  - P1.M2.T1.S3 (live smoke): runs against the tree this task certifies green
  - P1.M2.T1.S4 (DoD append): consumes gauntlet-evidence.md verbatim into the
    dated docs/M1-DoD.md gauntlet item (counts, gates, drift verdict); S4
    adds the capture-pane records from S3
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check    # the gauntlet itself, part 1
```

### Level 2: The gauntlet

```bash
npm test
npm run bench
```

### Level 3: Spot-check integrity

Each of the 9 rows read and verdicted; at least one row re-read after writing the evidence (guards transcription error).

### Level 4: Re-runnability

Re-run one gauntlet command exactly as recorded — the evidence must reproduce.

## Final Validation Checklist

### Technical Validation

- [ ] All three gauntlet commands exit 0; counts + gate numbers recorded verbatim
- [ ] Evidence file complete and re-runnable

### Feature Validation

- [ ] 9/9 spot-check rows verdicted; expected NONE FOUND or verbatim mismatches
- [ ] Row 9 verified by content (line-shift tolerated, recorded)

### Code Quality Validation

- [ ] Zero edits to src/, test/, spec/, README.md, docs/
- [ ] Evidence format matches the verification_1a.md / DoD precedents

## Anti-Patterns to Avoid

- ❌ Don't run the gauntlet while the battery (P1.M1.T1.S3) is still in flight
- ❌ Don't edit spec/*.md to "resolve" a mismatch — record it verbatim
- ❌ Don't append to docs/M1-DoD.md — that is P1.M2.T1.S4's job
- ❌ Don't flag documented divergences (ingest 180 ms CI bound) as drift without checking spec/09's own note
- ❌ Don't paraphrase suite counts or gate numbers — verbatim or nothing

**Confidence Score: 10/10** — mechanical execution against a pre-verified 9-row table and three known commands; the only judgment call (line shifts from parallel edits) is explicitly handled.
