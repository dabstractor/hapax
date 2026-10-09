# PRP — P3.M1.T2.S2: Full gauntlet — check + test (incl. former repro) + bench, with counts and gate numbers

---

## Goal

**Feature Goal**: Run the complete verification gauntlet for the P3 changeset
after ALL implementing subtasks have landed, producing the authoritative
evidence record: `npm run check` clean; `npm test` fully green including the
former repro battery (`test/defer-pi-menu.repro.test.ts`) with the one
known environment-sensitive case (`test/acceptance.test.ts` network-gated
`pi -p -e`) explicitly RESOLVED or ACKNOWLEDGED with evidence — never
silently weakened; `npm run bench` executed with gate numbers captured.
Record exact suite counts and all 9 perf-gate numbers vs budgets as a
structured artifact consumed by P3.M1.T2.S4's `docs/M1-DoD.md` append.

**Deliverable**: `plan/006_7bd0258da993/P3M1T2S2/gauntlet-results.md` — a
dated, commit-pinned evidence file (schema in Implementation Blueprint
below) containing: environment/commit header, check result, exact test-suite
counts, the 9-gate table (measured vs budget vs 3× CI bound), the 5-row
bench report, and the environmental-case resolution with captured evidence.
Raw command outputs tee'd into
`plan/006_7bd0258da993/P3M1T2S2/research/*.log`. Optionally, one minimal
test-harness repair in `test/acceptance.test.ts` (the skip-guard evidence
plumbing — see Task 3) plus a matching evidence line in
`test/fixtures/sessions/RESULTS.md`.

**Success Definition**:
- `npm run check` → exit 0.
- `npm test` → **0 failed**; the only permitted skips are the pre-existing
  gc-dependent `dictionary.test.ts` case and (if this environment is
  offline/unauthenticated) the resolved-to-skip `pi -p -e` acceptance case.
  `test/defer-pi-menu.repro.test.ts` → **4/4 green** (3 former reds + the
  pure-slash contrast case).
- `npx vitest --run test/perf-gates.test.ts --disable-console-intercept` →
  **9/9 gates** pass with actuals logged and captured.
- `npm run bench` completes; its 5-row report captured (report-only —
  tinybench cannot fail).
- `gauntlet-results.md` written with every field populated; S4 can append a
  compliant M1-DoD section from it without re-running anything.
- `git status --porcelain src/ spec/` clean at the end (the ONLY sanctioned
  edit outside `plan/` is the `test/acceptance.test.ts` skip-guard, and only
  under Task 3's resolve path).

## User Persona (if applicable)

**Target User**: The P3.M1.T2.S4 implementer (DoD append + drift report) and
the hapax owner auditing changeset completion.

**Use Case**: Proving — with re-runnable, dated, commit-pinned evidence —
that the whole changeset (P1 series completion, P2 branch hygiene, P3 Tab
deferral + README sync) leaves the suite green and the performance gates
met, per spec/09 h2.64 (DoD M1: "All unit tests green … performance gates
pass … lint clean").

**User Journey**: Read gauntlet-results.md → verify counts and gate numbers
against budgets → S4 transcribes into `docs/M1-DoD.md` following the
established append pattern → anyone can re-verify via the Reproduction
commands.

**Pain Points Addressed**: A DoD claim with no numbers is unauditable; a
known-flaky environmental case left unfixed keeps CI red and erodes trust in
every future red; a gate table without honesty notes (actuals above 1× but
inside 3×) hides drift.

## Why

- Spec/09 h2.64 (DoD M1) requires unit tests green + perf gates pass + lint
  clean; h2.62 defines the gates and their 3× CI variance rule. This item
  is the changeset's final automated evidence pass before the (separate,
  binding) live smoke in S3 and the DoD append in S4.
- The item contract fixes the baseline reality: at research time
  `npm test` = 4 failed / 1128 passed / 1 skipped (1133 total) — the 3
  repro reds (fixed by P3.M1.T1.S1, landing in parallel) PLUS a 4th
  environment-sensitive failure in `test/acceptance.test.ts`'s network-gated
  `pi -p -e` case (exited 1 with stderr outside the environmental-skip
  regex). Left alone, that 4th red would block S4's "all green" claim.
- The downstream consumer S4 must NOT re-run the gauntlet; it appends from
  S2's captured numbers. Missing or ambiguous numbers = S4 blocks.

## What

Run, in order: preconditions check (all implementing subtasks landed, repro
battery 4/4) → `npm run check` → resolve/acknowledge the environmental
acceptance case → full `npm test` with counts → dedicated perf-gates run
with un-intercepted console (9 gate actuals) → `npm run bench` → write
`gauntlet-results.md`.

### Success Criteria

- [ ] Preconditions verified: repro battery 4/4 green; all implementing
      subtasks (P1.M2.T2.S1/S2, P1.M2.T3.S1, P3.M1.T1.S1, P3.M1.T2.S1)
      landed at the recorded HEAD.
- [ ] `npm run check` exit 0.
- [ ] Environmental case resolved (fix with evidence) or explicitly
      acknowledged as environmental with captured stderr — never silently
      skipped/weakened; the three assertions (exit 0 / non-empty stdout /
      stderr hapax-free) untouched.
- [ ] `npm test` → 0 failed; exact counts recorded (files, passed, skipped,
      total); skip set ⊆ {gc case, pi -p case}.
- [ ] 9/9 perf gates green under their CI bounds; each gate's measured
      actual recorded vs budget vs 3× bound; honesty notes where actual
      > 1× budget but < 3× bound.
- [ ] `npm run bench` report captured (5 rows, report-only).
- [ ] `gauntlet-results.md` written per schema; raw logs in `research/`.

## All Needed Context

### Context Completeness Check

_If someone knew nothing about this codebase, could they run this gauntlet
and produce the S4 artifact?_ Yes — every command is given verbatim, every
expected outcome is named, the one ambiguous case (environmental stderr
wording) has a decision procedure with both branches, and the artifact
schema is fully specified.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: test/perf-gates.test.ts
  why: THE 9 perf gates (a/a2/a3/t0/b/c/d/e/f) — hard CI gate; actuals
    console.log'd per gate at :106 :143 :219 :269 :295 :378 :451 :506 :552
  pattern: gate a at :79, a3 at :130, t0 at :169, a2 at :239, b at :281,
    c at :308, d at :389, e at :482, f at :524; each logs a "[gate X]"
    line with measured actuals + budget + CI bound
  gotcha: console.log is intercepted in plain vitest runs — use
    --disable-console-intercept to see/capture the numbers (M1-DoD
    Reproduction convention)

- file: test/acceptance.test.ts
  why: the environment-sensitive case — describe "acceptance — real
    extension loads under pi -p -e (network-gated)" (:604-663)
  pattern: spawn `pi -p -e <cwd> --no-builtin-tools "say Zendesk lwlock"`
    (stdin ignored, 120 s kill timer); asserts exit 0 / stdout non-empty /
    stderr not /hapax/i; catch block (:651-662) tests err.message ONLY
  gotcha: when pi exits 1, expect(code).toBe(0) throws an AssertionError
    whose message ("expected 0 to be 1") carries NONE of the child's
    stderr — the environmental regex (ENOENT; ENOTFOUND|ECONNREFUSED|
    ETIMEDOUT|EAI_AGAIN|timed out|aborted; 401|402|403|429|unauthor|api
    key|quota|rate limit|credit|billing|no available model|provider) never
    sees the wording → fails instead of skipping. THIS is the 4th baseline
    red. Fix = plumb stderr into the evidence string (Task 3), NOT
    broadening the regex to a catch-all.

- file: test/defer-pi-menu.repro.test.ts
  why: the former repro battery — the named precondition for this gauntlet
  pattern: 4 it-cases (:150 forced file menu, :170 argument menu, :183
    menuDelayMs race, :224 pure-slash contrast); P3.M1.T1.S1 fixes the
    widget and hardens this suite — 3 former reds + contrast = 4/4 green
  gotcha: if ANY case here is red, P3.M1.T1.S1 has not landed — STOP and
    report; do not fix the widget (out of scope for S2)

- file: test/bench/core.bench.ts
  why: `npm run bench` target — 5 report-only benches (gates a/t0/b/c/d)
  pattern: bench names embed budgets; warmup/iteration options tuned per
    gate; REPORT-ONLY (hard bounds live in perf-gates)
  gotcha: vitest's test include excludes *.bench.* from `npm test`, so
    `npm test` never runs these; bench needs its own invocation

- file: plan/006_7bd0258da993/architecture/04-tests-docs-r5.md
  why: §7 = the authoritative 9-gate budget table (RUN at research time);
    §6 = the exact M1-DoD append pattern S4 follows (so the artifact
    contains exactly what S4 needs)
  section: "## 7. Perf gates + dictionary + calibration (RUN)" and
    "## 6. docs/ + M1-DoD.md item-append pattern"

- file: docs/M1-DoD.md
  why: existing append-only evidence log (1,570 lines) — read the LAST
    appended section to match its shape (header block, numbered gauntlet
    items, gate tables with honesty notes, Reproduction block)
  gotcha: DO NOT append to it — that is S4's deliverable; S2 only supplies
    the data

- file: plan/006_7bd0258da993/P3M1T1S1/PRP.md
  why: CONTRACT for the fix that turns the 3 repro reds green (Tab
    deferral pre-check on isShowingAutocomplete in src/pi/widget.ts) —
    its Success Definition names this gauntlet
  gotcha: treat as landed exactly as specified; its live-TTY check belongs
    to S3, not S2

- file: plan/006_7bd0258da993/P3M1T2S1/PRP.md
  why: CONTRACT for the parallel README sweep (README.md ONLY — cannot
    affect tests); S4's DoD entry consumes a coherent README
  gotcha: S2's gauntlet does not verify README content — only that the
    suite is green with it landed

- file: test/fixtures/sessions/RESULTS.md
  why: the convention home for environmental-skip records (:96-100
    documents the scripted pi -p check + auto-skip; :9 records suite
    counts from an earlier sweep)
  pattern: dated line naming the case, the observed wording, and the
    resolution

- file: package.json
  why: the exact scripts — check = "tsc --noEmit", test = "vitest --run",
    bench = "vitest bench". No ruff/mypy exist in this repo; npm run check
    IS the lint gate (the PRD h2.64 "pi --check or lint clean" maps to it)

- file: spec/09-testing-and-acceptance.md
  why: h2.62 perf gates + 3× CI rule; h2.64 DoD M1; gate c note ("Do not
    re-tighten this row to 60 ms without re-optimizing the ingest path
    first")
  gotcha: spec is READ-ONLY for this changeset (drift reporting is S4's);
    the session_tree rebuild deliberately has NO separate gate row — it
    rides gate e's < 600 ms restore budget; do not add one
```

### Current Codebase tree (relevant excerpt)

```bash
test/
  acceptance.test.ts          # environmental case at :604-663
  perf-gates.test.ts          # THE 9 gates (hard CI bounds)
  bench/core.bench.ts         # 5 report-only benches (npm run bench)
  defer-pi-menu.repro.test.ts # former repro battery — 4 cases, precondition
  no-persistence.test.ts      # already in the suite (store-dir-untouched proof)
  fixtures/sessions/RESULTS.md# environmental-skip record convention
docs/
  M1-DoD.md                   # S4 appends here; read tail for the pattern
plan/006_7bd0258da993/
  P3M1T2S2/                   # THIS item — gauntlet-results.md + research/ land here
  architecture/04-tests-docs-r5.md  # §6 append pattern, §7 gate budgets
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
plan/006_7bd0258da993/P3M1T2S2/
  gauntlet-results.md         # NEW — THE deliverable: dated, commit-pinned counts
                              #   + gate table + bench report + environmental
                              #   resolution; consumed verbatim by S4
  research/
    research-notes.md         # already written (research-time findings)
    npm-test.log              # NEW — full `npm test` output (tee'd)
    perf-gates.log            # NEW — dedicated gates run with actuals
    bench.log                 # NEW — `npm run bench` output
    acceptance-case.log       # NEW — diagnostic evidence for the environmental case
# CONDITIONAL (Task 3 resolve path only):
test/acceptance.test.ts       # EDIT — skip-guard evidence plumbing (minimal)
test/fixtures/sessions/RESULTS.md  # EDIT — one dated evidence line
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: vitest intercepts console.log in plain runs — gate actuals
# vanish from `npm test` output. ALWAYS capture gate numbers via:
#   npx vitest --run test/perf-gates.test.ts --disable-console-intercept
# (established M1-DoD Reproduction convention).

# CRITICAL: the environmental guard tests err.message ONLY — an exit-1
# pi run throws AssertionError("expected 0 to be 1") with NO stderr
# attached, so genuinely environmental failures fail instead of skipping.
# Fix the plumbing (surface stderr into evidence), not the assertions.

# CRITICAL: do NOT re-tighten gate c to its 60 ms headline (PRD h2.62
# note; healthy baseline ~97-174 ms; the 180 ms CI bound is the hard
# line). Record actuals with honesty notes when > 1× budget but < 3×.

# The pre-existing 1 skip is the gc-dependent dictionary.test.ts case
# (RESULTS.md:9-10) — it is EXPECTED to stay skipped. Final state:
# 0 failed, skips ⊆ {gc case, pi -p environmental case}.

# Counts will NOT match the research baseline (1133 total): earlier
# subtasks (P1.M2.T2.*, P1.M2.T3.S1, P3.M1.T1.S1) added tests. Record
# ACTUALS pinned to HEAD; never force-match a remembered number.

# `pi -p` waits on stdin when stdin is an open pipe (deadlock) — the
# test already spawns with stdio ignore; when reproducing manually use
# `</dev/null`. The in-test timeout is 120 s (SIGKILL) — a hang resolves
# to "timed out" which the regex already matches (skip).

# plan/ directories are pipeline artifacts: gauntlet outputs go ONLY to
# plan/006_7bd0258da993/P3M1T2S2/. src/ and spec/ stay untouched;
# spec edits are forbidden this changeset (S4 owns the drift report).
```

## Implementation Blueprint

### Data models and structure

The deliverable is a Markdown artifact, not code. Its schema (S4 transcribes
from this directly — fill EVERY field; no elisions):

```markdown
# P3 changeset gauntlet — <YYYY-MM-DD> @ <short-sha>

## Environment
- Head commit: <short> (<full 40-char SHA from `git rev-parse HEAD`>)
- Tree state: <`git status --porcelain src/ spec/ test/` output or CLEAN>
- OS: <uname -s -r> · Node: <node --version> · vitest: <npx vitest --version>
  · pi: <pi --version 2>/dev/null || echo "pi version N/A">
- Verdict: <one line, e.g. "check clean · 0 failed (2 skipped) · 9/9 gates">

## Item 1 — npm run check
`npm run check` → exit 0  (<date> @ <short-sha>)

## Item 2 — npm test (full suite)
`npm test` → <N> test files · <P> passed | <S> skipped | 0 failed (<T> total)
- Former repro battery test/defer-pi-menu.repro.test.ts: 4/4 green
- Skips accounted: <list each skipped case + one-line why>
- Full log: research/npm-test.log

## Item 3 — environmental case resolution (test/acceptance.test.ts)
- Observed at baseline: pi -p -e exited 1; stderr: ```<verbatim wording>```
- Classification: ENVIRONMENTAL (<matched/extended regex wording>) | 
  GENUINE FAILURE (<escalated — see note>) | PASSES HERE (<exit 0 …>)
- Action taken: <plumbing fix (evidence string now includes child stderr;
  regex extended with "<wording>") | documented-only, test unchanged>
- Post-resolution state: <PASS | SKIP — reason>
- Evidence: research/acceptance-case.log

## Item 4 — perf gates (9/9, CI bounds)
| Gate | Budget (spec ref) | Measured | vs budget | CI bound (3×) | Verdict |
|------|------------------|----------|-----------|---------------|---------|
| a    | <1 ms p99 (h2.62)| <p99> ms | <×N or ✅>| <3 ms         | PASS    |
| a2   | <1 ms (cold)     |  …       |           | <3 ms         |         |
| a3   | tripwire only    |  …       |     —     | <25 ms        |         |
| t0   | <3 ms p99        |  …       |           | <9 ms         |         |
| b    | <60 ms           |  …       |           | <180 ms       |         |
| c    | <60 ms headline / 180 CI (h2.62 note) | … | | <180 ms      |         |
| d    | <6 MB            |  …       |           | <18 MB        |         |
| e    | restore <600 ms (session_tree rides this row — NO separate gate) | … | | <600 ms | |
| f    | <100 ms hard / 300 CI | …   |           | <300 ms       |         |
Honesty notes: <any gate above 1× budget but inside 3× — say so plainly>
Command: npx vitest --run test/perf-gates.test.ts --disable-console-intercept
Log: research/perf-gates.log

## Item 5 — npm run bench (report-only)
<table of the 5 tinybench rows verbatim: name · ops/sec · avg ms · p75/p99>
Note: tinybench REPORTS only; hard bounds are Item 4's. Log: research/bench.log

## Reproduction
```bash
git rev-parse HEAD
npm run check
npm test
npx vitest --run test/perf-gates.test.ts --disable-console-intercept
npm run bench
```
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY PRECONDITIONS (halt if unmet — do not implement others' scope)
  - RUN: git rev-parse HEAD (record); git status --porcelain src/ test/ spec/ README.md
  - RUN: npx vitest --run test/defer-pi-menu.repro.test.ts
  - EXPECT: 4/4 green. ANY red ⇒ P3.M1.T1.S1 not landed ⇒ STOP, report
    (this item's contract: "INPUT: all implementing subtasks landed").
  - CONFIRM the other implementing subtasks are present in the tree
    (P1.M2.T2.S1/S2, P1.M2.T3.S1, P3.M1.T2.S1 — e.g. git log --oneline -15,
    README carries the S1 sweep). If any is missing ⇒ STOP, report.
  - NOTE: fixture counts differ from the research baseline (1133) — later
    subtasks added tests; that is EXPECTED, not drift.

Task 1: ENVIRONMENT CAPTURE
  - RUN: node --version; npx vitest --version; pi --version; uname -s -r
  - RECORD all into gauntlet-results.md's Environment header (schema above).

Task 2: CHECK GATE
  - RUN: npm run check
  - EXPECT: exit 0 (baseline: exit 0 at research time). Any error ⇒ STOP:
    type errors mean an implementing subtask landed broken — report, do not
    fix source.

Task 3: ENVIRONMENTAL CASE — DIAGNOSE, THEN RESOLVE OR ACKNOWLEDGE
  - 3a RUN the case alone: npx vitest --run test/acceptance.test.ts
    (tee to research/acceptance-case.log)
  - 3b REPRODUCE manually to capture ground truth:
      pi -p -e "$(pwd)" --no-builtin-tools "say Zendesk lwlock" </dev/null \
        >research/acceptance-case.log 2>&1; echo "exit=$?" >>research/acceptance-case.log
    (stdin MUST be /dev/null — an open pipe deadlocks `pi -p`).
  - 3c DECIDE by the captured stderr:
    * exit 0 + answered + hapax-free stderr ⇒ PASSES HERE: record as
      PASSES; the baseline red was transient environment. STILL apply the
      3d plumbing fix (it is the latent CI hazard the baseline exposed).
    * stderr wording is environmental (provider/auth/network/rate-limit
      class) ⇒ RESOLVE:
      - FIX test/acceptance.test.ts (:651-662): surface the child's stderr
        into the evidence the regex tests, e.g.
        `const evidence = \`${err.message ?? ""}\n${stderr}\`` (stdout,
        stderr, code are destructured inside the try — keep the three
        assertions byte-identical), and extend the regex MINIMALLY with the
        observed wording if it is not already covered ("no available
        model|provider" already covers common pi wordings).
      - RE-RUN: npx vitest --run test/acceptance.test.ts ⇒ expect SKIP
        (environmental) — never FAIL.
      - ADD one dated line to test/fixtures/sessions/RESULTS.md (:~96-100,
        the documented home): observed wording + resolution.
    * stderr indicates a REAL extension error (mentions hapax / module
      load failure / stack trace) ⇒ GENUINE FAILURE: do NOT touch the
      guard. STOP, capture everything, report upstream — a real load error
      contradicts "all subtasks landed" and must be fixed in source, not
      papered over here.
  - 3d (resolve path) ALSO verify the guard's new plumbing does not mask
    real failures: the assertions themselves (exit 0, stdout, /hapax/i)
    are untouched, and the regex gains ONLY the observed environmental
    wording — a hapax stderr mention still fails. State this in the
    artifact's Item 3.

Task 4: FULL SUITE
  - RUN: npm test 2>&1 | tee research/npm-test.log
  - EXPECT: 0 failed. Capture the summary lines verbatim (Test Files /
    Tests / Duration). Enumerate every skipped case with a one-line reason;
    the set must be ⊆ {gc-dependent dictionary.test.ts case, pi -p
    environmental case}.
  - ANY other red ⇒ STOP and report (do not repair source here).

Task 5: PERF GATES (the numbers S4 needs)
  - RUN: npx vitest --run test/perf-gates.test.ts --disable-console-intercept \
      2>&1 | tee research/perf-gates.log
  - EXPECT: 9/9 pass. Extract the nine "[gate X]" console lines and build
    the schema's table (Gate | Budget | Measured | vs budget | CI bound |
    Verdict), budgets/CI bounds exactly as in perf-gates.test.ts headers:
    a <1 ms→3 ms · a2 <1 ms→3 ms · a3 tripwire→25 ms · t0 <3 ms→9 ms ·
    b <60 ms→180 ms · c <60 ms headline→180 ms · d <6 MB→18 MB ·
    e restore→600 ms (session_tree rides this row — NO separate gate) ·
    f <100 ms hard→300 ms.
  - ADD honesty notes for every gate whose actual sits above 1× budget
    but inside the 3× bound (expected for c; possibly b) — plain numbers,
    no rationalization, per the M1-DoD table convention.
  - NEVER re-tighten a budget, never edit perf-gates.test.ts.

Task 6: BENCH (report-only)
  - RUN: npm run bench 2>&1 | tee research/bench.log
  - EXPECT: completes, 5 bench rows (gates a/t0/b/c/d). Copy the tinybench
    table verbatim into the artifact with the report-only note. Numbers do
    NOT gate this item; capture them for the record.

Task 7: WRITE THE ARTIFACT
  - WRITE plan/006_7bd0258da993/P3M1T2S2/gauntlet-results.md exactly per
    the schema (every field filled; verbatim stderr where claimed; the
    Reproduction block at the end).
  - FINAL hygiene: git status --porcelain src/ spec/ ⇒ empty; the only
    changes outside plan/ are (resolve path) test/acceptance.test.ts +
    test/fixtures/sessions/RESULTS.md, or (acknowledge path) none.
```

### Implementation Patterns & Key Details

```ts
// Task 3 resolve path — the ONLY code edit this item may make.
// Current shape (test/acceptance.test.ts:644-663):
//   } catch (error) {
//     const err = error as { message?: string; code?: string };
//     const evidence = err.message ?? "";
//     const environmental =
//       /ENOENT/i.test(err.code ?? evidence) ||
//       /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timed out|aborted/i.test(evidence) ||
//       /\b(401|402|403|429)\b|unauthor|api key|quota|rate limit|credit|billing|no available model|provider/i.test(evidence);
//     if (environmental) { ctx.skip(); }
//     throw error;
//   }
// Minimal fix — make the guard see what the child actually said:
//   } catch (error) {
//     const err = error as { message?: string; code?: string };
//     // P3.M1.T2.S2: an exit-1 pi yields AssertionError("expected 0 to
//     // be 1") with no stderr — surface the child's streams so the
//     // environmental guard can classify honestly. Assertions unchanged.
//     const evidence = `${err.message ?? ""}\n${stdout}\n${stderr}`;
//     ...
//   }
// (stdout/stderr are already in scope — the try block destructures the
//  runPi() result. Keep the three expect() lines byte-identical. Extend
//  the third regex alternation with the observed wording ONLY if needed.)
```

### Integration Points

```yaml
PIPELINE (upstream):
  - P3.M1.T1.S1: widget Tab deferral + hardened repro battery (4/4 green)
    = the named precondition; verify, never re-implement.
  - P1.M2.T2.S1/S2, P1.M2.T3.S1, P3.M1.T2.S1: must be landed at HEAD.

PIPELINE (downstream):
  - P3.M1.T2.S3: live smoke (BINDING, spec/09 h2.61) — runs AFTER this
    item; do NOT claim live verification in the artifact (automated-only
    scope here).
  - P3.M1.T2.S4: consumes gauntlet-results.md verbatim for the
    docs/M1-DoD.md append (architecture/04 §6 pattern) + writes the
    drift report (spec read-only this run).

REPO HYGIENE:
  - plan/006_7bd0258da993/P3M1T2S2/: the ONLY new files (artifact + logs).
  - FORBIDDEN edits: PRD.md, tasks.json, prd_snapshot.md, spec/*, src/*,
    .gitignore; perf-gates.test.ts budgets.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# Applies ONLY if Task 3's resolve path touched test/acceptance.test.ts:
npm run check   # tsc --noEmit — exit 0 (the repo's only lint gate; no ruff/mypy)
# Expected: exit 0. If errors: you broke the test file — re-read the edit.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest --run test/defer-pi-menu.repro.test.ts     # 4/4 green (precondition)
npx vitest --run test/acceptance.test.ts              # PASS or environmental SKIP — never FAIL
npm test 2>&1 | tee plan/006_7bd0258da993/P3M1T2S2/research/npm-test.log
# Expected: 0 failed; skips ⊆ {gc case, pi -p case}; counts recorded verbatim.
```

### Level 3: Integration Testing (System Validation)

```bash
npx vitest --run test/perf-gates.test.ts --disable-console-intercept \
  2>&1 | tee plan/006_7bd0258da993/P3M1T2S2/research/perf-gates.log
# Expected: 9/9 gates PASS; nine "[gate X]" actual lines captured.
# grep -c '\[gate' <log>  → 9

npm run bench 2>&1 | tee plan/006_7bd0258da993/P3M1T2S2/research/bench.log
# Expected: 5 bench rows reported (report-only).

pi -p -e "$(pwd)" --no-builtin-tools "say Zendesk lwlock" </dev/null; echo "exit=$?"
# The ground-truth diagnostic for the environmental case (Task 3b) —
# capture stdout/stderr/exit into research/acceptance-case.log.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Artifact completeness — S4 must be able to append without re-running:
test -s plan/006_7bd0258da993/P3M1T2S2/gauntlet-results.md && echo OK
grep -c "PASS" plan/006_7bd0258da993/P3M1T2S2/gauntlet-results.md   # ≥ 9 gate verdicts + items
# Every schema field filled: Environment (commit/OS/Node/vitest/pi),
# Items 1-5, honesty notes, Reproduction block.
git status --porcelain src/ spec/    # EMPTY — the core guarantee
# Resolve-path only: git diff test/acceptance.test.ts shows the evidence
# plumbing (+ optional minimal regex wording) and NOTHING else —
# assertions untouched.
```

## Final Validation Checklist

### Technical Validation

- [ ] All validation levels completed; logs exist under research/.
- [ ] `npm run check` → exit 0.
- [ ] `npm test` → 0 failed; counts recorded verbatim; skips enumerated.
- [ ] 9/9 perf gates PASS under CI bounds; actuals captured; honesty notes
      for any >1×-inside-3× actual.
- [ ] `npm run bench` report captured (5 rows, report-only).

### Feature Validation

- [ ] Preconditions verified before the gauntlet (repro 4/4; subtasks
      landed; HEAD recorded).
- [ ] Environmental case: RESOLVED with the minimal plumbing fix and
      re-run evidence, or ACKNOWLEDGED with verbatim stderr — never
      silently weakened; assertions untouched; real-load errors still
      fail.
- [ ] gauntlet-results.md complete per schema — S4 can append from it
      alone.
- [ ] No live-verification claims made (S3's binding scope).

### Code Quality Validation

- [ ] Only sanctioned files touched (plan/006_7bd0258da993/P3M1T2S2/**;
      optionally test/acceptance.test.ts + RESULTS.md one line).
- [ ] No budget re-tightening; no perf-gates.test.ts edits; no new gate
      row for session_tree (rides gate e).
- [ ] No edits to PRD.md, tasks.json, prd_snapshot.md, spec/*, src/*.

### Documentation & Deployment

- [ ] Artifact dated + commit-pinned; reproduction commands re-runnable.
- [ ] RESULTS.md line (resolve path) matches the existing convention
      (:96-100 area).

---

## Anti-Patterns to Avoid

- ❌ Don't broaden the environmental regex to a catch-all (e.g. matching any
  exit≠0) — that silences REAL extension load errors; the item contract
  explicitly forbids silently weakening the gate.
- ❌ Don't edit the three assertions in the acceptance case to make it
  pass — the fix lives in the evidence plumbing only.
- ❌ Don't capture gate numbers from plain `npm test` output — vitest
  intercepts console.log; use `--disable-console-intercept`.
- ❌ Don't force-match the research baseline counts (1133) — later
  subtasks legitimately added tests; record actuals.
- ❌ Don't re-tighten gate c to 60 ms, and don't "fix" an above-1× but
  inside-3× actual — record it with an honesty note.
- ❌ Don't append to docs/M1-DoD.md (S4's deliverable) or claim the live
  smoke (S3's, binding per spec/09 h2.61).
- ❌ Don't repair red source or red tests other than the sanctioned
  skip-guard — a red here means an upstream subtask is broken: STOP and
  report.

---

**Confidence Score**: 9/10 — the gauntlet is fully deterministic except the
environmental case's actual stderr wording, which is unobservable until run
time; the PRP handles all three branches (passes here / environmental /
genuine failure) with explicit decision criteria.
