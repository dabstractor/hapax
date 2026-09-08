# PRP — P1.M4.T1.S1: Full check + M1 regression re-run (never-hijack, perf gates, no-persistence)

## Goal

**Feature Goal**: Re-verify the entire M1 acceptance gauntlet against the
D2-delta codebase (phrase layer deleted, bigram successor index, zero-char
chaining, forced single-item Tab branch, `enableChaining` config) and record
hard evidence — suite counts, perf-gate and benchmark numbers, head commit —
that the M1 Definition-of-Doday contract (PRD §09 h2.53) still holds after
the redesign. Evidence-only task: triage, don't build.

**Deliverable**:
1. `plan/002_3e8a42cadf2c/P1M4T1S1/research/regression-evidence.md` — the
   recorded evidence record (per-gauntlet PASS/FAIL, commands, numbers,
   environment, triage notes) consumed by P1.M4.T1.S2 and P1.M4.T2.S1.
2. Any fixes needed to make the gates green, each triaged to its owning
   subtask's PRP contract first (minimal, contract-faithful only).

**Success Definition**: `npm run check` exit 0 zero errors; `npm test` fully
green (updated counts recorded — they differ from the pre-delta 24 files /
413 passed / 1 skipped); `npm run bench` runs with all four gates inside
PRD §09 budgets (and `test/perf-gates.test.ts` hard 3× bounds green);
`test/provider.test.ts` never-hijack a–g green; `test/no-persistence.test.ts`
green; `test/acceptance.test.ts` (items 1–6 scripted halves) green. Evidence
file complete.

## User Persona

**Target User**: hapax maintainer signing off the M2-redesigned changeset.
**Use Case**: before writing the DoD annotation and README sweep, know the
M1 contract survived the redesign.
**User Journey**: read regression-evidence.md → per-gauntlet verdicts with
re-runnable commands and recorded numbers.
**Pain Points Addressed**: the redesign touched ingest (span threading), the
store (slim bigram map), and the provider (forced Tab branch) — exactly the
three surfaces the M1 gauntlet guards; nobody has re-run the gauntlet since.

## Why

- PRD §09 h2.53 (M1 DoD) is a standing contract; D2 changed ingestion shape
  (RawToken spans → adjacency bigram runs), store layout, and Tab semantics.
- Contract item 3 explicitly warns: span threading and the slim bigram map
  must not regress the perf gates (ingest 800 KB < 60 ms with ≤64 KB yields;
  steady-state heap < 6 MB).
- P1.M4.T1.S2 (M2 DoD audit) and P1.M4.T2.S1 (README sweep) consume this
  evidence; without it they cannot cite suite counts or gate numbers.

## What

Run, verify, and record (in this order):

1. **Type check**: `npm run check` — exit 0, zero errors. Record.
2. **Full suite**: `npm test` — fully green. Record file count / passed /
   skipped (expect the 1 gc-dependent skip in dictionary.test.ts to remain;
   counts differ from pre-delta: phrases.test.ts deleted, bigrams.test.ts
   added, chain.test.ts / config.test.ts / debug.test.ts rewritten per
   `plan/002_3e8a42cadf2c/architecture/tests_docs_inventory.md`).
3. **M1 acceptance suites, individually and explicitly** (re-run even though
   `npm test` covers them; record each verdict separately):
   - `npx vitest --run test/provider.test.ts` — never-hijack (a)–(g), now
     including the forced single-item Tab-branch cases (P1.M2.T2 extension).
   - `npx vitest --run test/perf-gates.test.ts` — hard 3× CI-variance
     bounds on the four PRD §09 h2.51 gates.
   - `npx vitest --run test/no-persistence.test.ts` — DoD item 5.
   - `npx vitest --run test/acceptance.test.ts` — integration items 1–6
     scripted halves.
4. **Benchmarks**: `npm run bench` — capture the reported numbers for the
   four gates in `test/bench/core.bench.ts` (query 20k candidates; dict
   load + 20k lookup sweep; ingest 800 KB with yield granularity;
   steady-state heap cycle) and compare against the budgets:
   query < 1 ms p99 · dict sweep < 60 ms · ingest < 60 ms yielding ≤ 64 KB
   per turn · heap delta < 6 MB. Record exact numbers + verdict; flag
   anything > 1× budget as "watch" even if inside the 3× hard bound.
5. **Static no-persistence spot-check** (mirrors the prior sweep method):
   `grep -rn "writeFile\|appendFile\|createWriteStream" src/` → expect only
   read-side fs usage (readFileSync) in src; record output.
6. **Environment header**: date, `git rev-parse HEAD`, `node --version`,
   vitest version (from `npm ls vitest` or test banner), pi version (0.84.4).

### Triage protocol (contract item 3)

On ANY failure:
1. Identify the owning subtask: never-hijack/Tab → P1.M2.T2 PRP; chain →
   P1.M2.T1; bigram capture/spans → P1.M1.T3; store slim-down → P1.M1.T2;
   config gates → P1.M3.T1; /acwords dump → P1.M3.T2.S1 (may still be
   landing — if its debug tests fail, FIRST confirm the parallel item
   finished before treating it as a regression).
2. Read that PRP's contract; check whether the failure violates it or the
   implementation drifted from it.
3. Fix minimally toward the contract (this task MAY touch code, but only to
   restore a broken contract — never to change a contract). Record every
   triage decision in the evidence file.
4. Re-run the failed gate plus `npm test` after any fix.

### Success Criteria

- [ ] `npm run check` exit 0
- [ ] `npm test` fully green; counts recorded
- [ ] All 4 M1 acceptance suites individually green with recorded verdicts
- [ ] `npm run bench` numbers recorded, all within budgets (3× hard bounds
      green in perf-gates.test.ts)
- [ ] No-persistence: test green + static grep clean
- [ ] regression-evidence.md complete with environment header and any
      triage notes
- [ ] Every fix (if any) attributed to an owning subtask's contract

## All Needed Context

### Context Completeness Check

The implementing agent gets every command, every suite's purpose and file
path, the exact budgets, the prior-sweep evidence format to mirror
(docs/M1-DoD.md), the triage ownership map, and the parallel-item caveat.
No prior knowledge needed.

### Documentation & References

```yaml
- file: plan/002_3e8a42cadf2c/architecture/tests_docs_inventory.md
  why: AUTHORITATIVE inventory — per-file suite map, which suites were
    deleted/rewritten by the delta, the "M1 acceptance suites (must re-run
    green)" list, and the docs/M1-DoD.md summary with prior counts.
  section: §1 "M1 acceptance suites" + §2 "docs/M1-DoD.md".

- file: docs/M1-DoD.md
  why: the FORMAT to mirror in regression-evidence.md (environment header,
    per-gauntlet PASS blocks with the exact command quoted) and the
    command-substitution note (pi --check does not exist; npm run check is
    the sanctioned equivalent — cite this, don't reinvent).
  gotcha: DO NOT edit this file — the post-delta annotation is
    P1.M4.T1.S2's deliverable, not yours.

- file: test/perf-gates.test.ts + test/bench/core.bench.ts
  why: the four gates and their assertion style (loose CI bounds, 3× hard
    regressions fail). core.bench.ts runs under `npm run bench`
    (vitest bench, no vitest.config.* — defaults only).

- file: test/provider.test.ts
  why: never-hijack cases (a)–(g) + the P1.M2.T2 forced single-item Tab
    extension — this re-run is the regression proof the Tab branch didn't
    break the never-hijack contract (PRD §07 h2.42).

- file: test/no-persistence.test.ts
  why: DoD item 5 — filesystem snapshot assertions.

- file: test/acceptance.test.ts
  why: PRD §09 integration items 1–6 scripted halves (manual TUI halves live
    in test/fixtures/sessions/RESULTS.md — out of scope here; scripted
    halves only, per contract).

- file: package.json
  why: scripts: check = tsc --noEmit, test = vitest --run, bench =
    vitest bench. No other gates exist.

- file: plan/002_3e8a42cadf2c/P1M4T1S1/research/notes.md
  why: this item's research — verified current repo state (phrases tests
    gone, bigrams.test.ts present), risk surfaces (span threading, slim
    bigram map vs ingest/heap gates), evidence destination.

- url: https://vitest.dev/guide/features-bench.html
  why: vitest bench reporting semantics (mean of runs; p99 must come from
    the gate test, not the bench report — the bench file reports summary
    numbers; record those, assert p99 only where perf-gates.test.ts does).
```

### Current Codebase tree (relevant)

```bash
hapax/
├── package.json              # scripts: check / test / bench
├── docs/M1-DoD.md            # prior evidence record (READ-ONLY for this task)
├── test/
│   ├── provider.test.ts          # never-hijack a–g + forced Tab
│   ├── perf-gates.test.ts        # 3× hard bounds, 6 cases
│   ├── no-persistence.test.ts    # DoD item 5
│   ├── acceptance.test.ts        # §09 items 1–6 scripted
│   ├── bench/core.bench.ts       # 4 gates, numbers reported
│   ├── bigrams.test.ts           # NEW (delta)
│   ├── chain.test.ts, config.test.ts, debug.test.ts  # REWRITTEN (delta)
│   └── ...                      # remaining suites
└── plan/002_3e8a42cadf2c/P1M4T1S1/research/   # evidence destination
```

### Desired Codebase tree with files to be added

```bash
plan/002_3e8a42cadf2c/P1M4T1S1/research/regression-evidence.md
                              # NEW: the deliverable evidence record
(src/** — only if triage demands a minimal contract-restoring fix)
```

### Known Gotchas of our Codebase & Library Quirks

```bash
# CRITICAL: dependency order — this sweep runs AFTER P1.M3.T2.S1 (debug.ts
#   successor dump) lands. If debug.test.ts fails, FIRST verify the parallel
#   item is actually complete before calling it a regression.
# GOTCHA: the dictionary.test.ts gc-dependent case is skipped (1 skip is
#   expected and acceptable; only NEW skips/failures are regressions).
# GOTCHA: pre-delta counts (24 files / 413 passed / 1 skipped at c138b5b)
#   are HISTORY, not targets — the delta deleted/added suites; record the
#   new numbers, don't force the old ones.
# GOTCHA: bench numbers vary run-to-run — record them verbatim with the
#   run count; the authoritative pass/fail is perf-gates.test.ts's bounds.
# GOTCHA: `pi --check` does not exist (recorded in docs/M1-DoD.md) — cite
#   the substitution table there; do not hunt for the command.
# GOTCHA: benchmarks + perf tests can be noisy on a loaded machine — run
#   with the machine otherwise idle; if a gate sits between 1× and 3×
#   budget, record it as "watch" with both numbers, not a failure.
```

## Implementation Blueprint

### Evidence record structure

Mirror `docs/M1-DoD.md`'s shape:

```markdown
# D2-delta M1 regression evidence (P1.M4.T1.S1)
- Sweep date / Head commit (`git rev-parse HEAD`) / Node / vitest / pi
- Gauntlet item 1 — npm run check: PASS/FAIL + output summary
- Gauntlet item 2 — npm test: counts (files / passed / skipped) + verdict
- Gauntlet item 3 — M1 acceptance suites: per-suite verdicts
  (provider / perf-gates / no-persistence / acceptance)
- Gauntlet item 4 — npm run bench: 4 gates × recorded numbers × budget
  comparison table (+ "watch" flags)
- Gauntlet item 5 — no-persistence static grep output
- Triage log: failure → owning subtask PRP → decision → fix (if any)
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITION
  - CONFIRM P1.M3.T2.S1 (debug.ts successor dump) is landed/complete
    (task status or git log); if still in flight, wait — the sweep must run
    against the complete delta

Task 1: CAPTURE ENVIRONMENT
  - date; git rev-parse HEAD; node --version; vitest version; pi version

Task 2: RUN npm run check
  - RECORD exit status; on errors → triage per protocol → fix → rerun

Task 3: RUN npm test
  - RECORD file/passed/skipped counts; compare against
    tests_docs_inventory.md expectations (phrases/phrase-gating absent;
    bigrams present); on failure → triage → fix → rerun

Task 4: RUN the 4 M1 acceptance suites individually
  - npx vitest --run test/provider.test.ts test/perf-gates.test.ts \
      test/no-persistence.test.ts test/acceptance.test.ts
  - RECORD per-suite verdicts; triage failures to owning PRPs
    (ownership map in Triage protocol above)

Task 5: RUN npm run bench
  - RECORD all four gate numbers; build the budget-comparison table;
    flag 1×–3× stragglers as "watch"; hard failures (> 3×) mean
    perf-gates.test.ts already failed in Task 4 — triage (prime suspects:
    span threading in ingest, bigram map in store)

Task 6: STATIC no-persistence grep
  - grep -rn "writeFile|appendFile|createWriteStream" src/ → record;
    expect no matches (read-only fs)

Task 7: WRITE research/regression-evidence.md
  - STRUCTURE per the record template above; every verdict backed by the
    exact command; include triage log (or "no failures — no triage")
  - THIS FILE IS THE DELIVERABLE consumed by P1.M4.T1.S2 + P1.M4.T2.S1

Task 8: FINAL sweep
  - npm run check && npm test one last time after any fixes — green
```

### Implementation Patterns & Key Details

```bash
# PATTERN: per-gauntlet recording (mirror M1-DoD.md)
#   $ npm test
#   - 2026-XX-XX: exit 0 — N files / M passed / K skipped.

# PATTERN: bench budget table
# | Gate            | Budget   | Recorded | Verdict |
# | 20k query p99   | < 1 ms   | x.xx ms  | pass/watch |
```

### Integration Points

```yaml
DATABASE: none
CONFIG: none
ROUTES: none
DEPENDS-ON: ALL implementing subtasks of P1.M1–P1.M3 (code-complete delta)
CONSUMED-BY: P1.M4.T1.S2 (M2 DoD audit cites these counts/numbers),
  P1.M4.T2.S1 (README sweep cites the same)
DOCS: none — evidence only; docs/M1-DoD.md annotation is S2's, NOT this task's
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # exit 0, zero errors — this is also gauntlet item 1
```

### Level 2: Unit / Acceptance Tests

```bash
npm test        # fully green — gauntlet item 2 (counts recorded)
```

### Level 3: M1 acceptance suites

```bash
npx vitest --run test/provider.test.ts test/perf-gates.test.ts \
  test/no-persistence.test.ts test/acceptance.test.ts   # all green
```

### Level 4: Benchmarks

```bash
npm run bench   # numbers within budgets; recorded in evidence table
grep -rn "writeFile\|appendFile\|createWriteStream" src/   # empty
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` exit 0; `npm test` green (final state after fixes)
- [ ] All 4 acceptance suites green individually
- [ ] Bench numbers recorded, all within budgets, "watch" flags noted
- [ ] Static persistence grep clean

### Feature Validation

- [ ] Never-hijack a–g + forced-Tab extension green (Tab contract intact)
- [ ] Perf gates green under the delta's span-threaded ingest + slim
      bigram store (the two named regression risks)
- [ ] No-persistence invariant holds

### Code Quality

- [ ] No code changes beyond minimal contract-restoring fixes, each triaged
      and logged
- [ ] Evidence file complete, commands re-runnable, environment recorded
- [ ] docs/M1-DoD.md NOT modified (S2's deliverable)

## Anti-Patterns to Avoid

- ❌ Don't "fix" a failing gate by loosening a test or budget — triage to
  the owning contract or report upward
- ❌ Don't edit docs/M1-DoD.md or README (documentation tasks own those)
- ❌ Don't treat old count numbers (413/24/1) as targets
- ❌ Don't run the sweep while P1.M3.T2.S1 is still landing
- ❌ Don't record PASS without the exact command + numbers in the evidence
  file

## Confidence Score

**10/10** — this is a deterministic verification task with every command,
budget, ownership map, and output format specified; there is no design
uncertainty, only execution and honest recording.