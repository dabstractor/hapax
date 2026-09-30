# Research notes — P1.M4.T1.S2 (plan 003): DoD re-verification + M3 DoD append

## Verified facts

- **docs/M1-DoD.md structure**: M1 section (line 1) → `## Bugfix-001
  re-verification` (~200) → `## M2 Definition of Done — post-delta
  re-verification (P1.M4.T1.S2)` (~265) with per-item `###` blocks,
  `### Bench numbers (2026-09-08, re-captured at 5739b09)`, triage log,
  files-changed table, reproduction, bolded **Verdict: M2 (D2 redesign)
  DONE.** (~474) → `## Bugfix 001 re-verification (001_0f4b641cf9ce)`
  (~506). The M3 section APPENDS AT THE END; M1/M2/Bugfix sections stay
  byte-identical.
- **r5-spec-readme-dod.md** is the authoritative extraction:
  - §5 = the M3 append pattern (exact heading
    `## M3 Definition of Done — post-delta re-verification (<task id>,
    <date>)`, per-clause `###`s, bench block, triage log, files-changed
    table, reproduction, bolded verdict, suite counts).
  - §1 = the M3 acceptance clauses VERBATIM:
    - widget visibility machine (widget.test.ts bullet 1: word-start
      fragment shows, trailing space hides, path/slash/@ never show, zero
      candidates never render) + widget-visibility.test.ts.
    - key handling (bullet 2: all four arrows navigate; ↑/← on first word
      dismiss + suppress until next word start; →/↓ clamp; Tab synchronous
      insert; Enter dismiss-then-forward; other keys verbatim; inner
      instance never mutated).
    - insertion casing (bullet 3: replaces word-regex span or `#fragment`
      with candidate display casing).
    - highlight reset to top on set change; debounce/hysteresis +
      startup-gate carry-over (bullet 4; startup-gate.test.ts).
    - editor-enter proxy carry-over (test/editor-enter.test.ts: Enter +
      open menu → cancel then delegate once; thenable guard; onKeystroke
      input-clock; never-mutate pin).
    - integration item 1 M3 clause (widget one line below input,
      `Zendesk | …`, arrows, boundary-Esc two-←), item 2 capture window
      ({arrows, Escape, Tab} while line visible), item 7 conversational
      path completion (rule 4d, `sr` → `src/core/query.ts`, absolute path
      leading `/`, `/` hands to stock pi) — §2 verbatim.
  - §3 = perf-gate table (anchored-fuzzy query < 1 ms p99; dict sweep <
    60 ms; ingest 800 KB < 60 ms yields ≤ 64 KB; heap < 6 MB; 3× CI rule)
    + commands: npm run check / npm test / npm run bench; hard CI gate =
    test/perf-gates.test.ts; bench file test/bench/core.bench.ts.
    NOTE: perf-gate describe label still reads "prefix query + rank + top
    8" in places — P1.M2.T2.S2's contract was "prefixRange → first-char
    range + perf gate re-basing (p99 hold)", so confirm gate a actually
    exercises the ANCHORED-FUZZY query (matchFragment path); if the label
    only is stale, that's cosmetic drift → record in run report, do not
    edit spec/tests beyond the sweep's remit.
- **Sibling contract S1 (README sweep, parallel)**: rewrites README.md per
  r5 §4's 12 items; produces research/sweep-log.md; does NOT touch
  docs/M1-DoD.md. This task cites its completion but does not depend on
  its content for the gauntlet (README can't affect tests).
- **Upstream contract P1.M3.T4.S1 (live verification, parallel)**:
  deliverable `plan/003_bbac3b15e8d0/P1M3T4S1/verification-record.md` +
  `captures/*.txt` (tmux capture-pane evidence, W1–W3+ checks: widget
  line below input, boundary-Esc, arrow highlight, no src/ modifications
  beyond P1.M3.T3). The DoD M3 section's "live verification record"
  clause CITES this file. If not yet landed at start → wait/re-check
  (it is a hard input per the item contract).
- **Test tree at research time** (relevant M3 suites verified present):
  widget.test.ts, widget-visibility.test.ts, editor-enter.test.ts,
  startup-gate.test.ts, plus the M1/M2 suites (provider*, chain,
  successors, bigrams, acceptance, perf-gates, no-persistence,
  calibration, paths, adversarial-*). 38 test files.
- **Spec is READ-ONLY this run** (Mode B): any spec drift discovered is
  recorded in the run report ONLY; a later interactive session reconciles.
  Also do NOT edit spec/ files or prd_snapshot.
- `pi --check` does not exist — M1 section records the substitution; cite it.
- No-persistence: test/no-persistence.test.ts + optional static grep
  (writeFile|appendFile|createWriteStream in src/) as prior sections did.

## Method
Mirror the M2 section's discipline: per-clause command + date + named test
cases; bench table re-captured at current HEAD (report commit); triage any
failure to the owning M3 subtask PRP (all Complete/Implementing → failures
are drift); bolded verdict; files-changed table; reproduction block.
