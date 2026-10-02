# Research notes — P1.M2.T1.S4 (docs/M1-DoD.md dated gauntlet-item append)

## The target file
- `docs/M1-DoD.md` — 1261 lines, APPEND-ONLY (external_deps.md §"docs/M1-DoD.md pattern", plan/005 architecture).
- Prior items end ~:1230 (the file now ends with the "Bugfix changeset 001 … post-delta note — 2026-09-30" section). New dated section goes at END of file.
- NEVER edit prior sections; each record stands as true-when-measured.

## Section pattern (from the M3 record, :986–1230 — the most recent full precedent)
1. A `## <Title> — post-changeset re-verification (P1.M2.T1.S4, 2026-XX-XX)`-style dated header preceded by an "everything above untouched (append-only)" note.
2. Sweep metadata block: date · head commit (full + subject) · environment (Linux x64, Node, vitest) · working-tree note (parallel deliverables: README.md from S1).
3. Verdict line: "changeset DONE" — gauntlet PASS, smoke PASS, drift verdict.
4. `## Gauntlet item N — <name>: PASS` subsections: fenced `$ command` blocks, then a `- 2026-XX-XX @ <sha>:` dated bullet with suite counts in bold (`**37 test files, 1046 passed / 1 skipped**`-style), gate numbers table, named test cases quoted verbatim.
5. `## Drift report (spec read-only this run): NONE FOUND` — numbered verified-agreeing checks with ✅, residuals restated from S1/S2 research.
6. `## Tree cleanliness (post-smoke)` — git status enumeration, tmux-killed note.
7. `## Reproduction` — fenced re-runnable commands (git rev-parse, npm run check, npm test, perf-gates invocation, npm run bench, live-smoke sketch).

## Input contracts (siblings)
- **P1.M2.T1.S2** (research/gauntlet-evidence.md): environment block, per-command exit codes + verbatim suite counts, five-gate bench numbers table, 9-row §1a spot-check verdicts, expected drift verdict NONE FOUND. If S2 reports red: STOP — cannot record a FAIL gauntlet; report back.
- **P1.M2.T1.S3** (research/live-smoke.md): four scenarios (boundary pass-through / → one-word forward / carousel+Escape+re-offer / Tab+Enter), each with PASS + pacing note ("typed one char at a time, 0.12 s apart") + verbatim before/after capture-pane blocks + "Reading:" lines. Only its PASS evidence + pacing note + a compressed capture excerpt go into the DoD; full captures stay in research/.
- **P1.M2.T1.S1** (README sweep): mention only in the changeset summary line + tree-cleanliness note (README.md dirty = S1's deliverable — the M3 precedent at :1000 handles exactly this).
- **P1.M1.T1.S1–S3**: the changeset being recorded (WidgetState generation flag, decideWidgetKey v2 decision table, widgetHandleInput wiring, widget.test.ts v2 battery). Cite named battery cases verbatim from the S2/S3 evidence, not by memory.

## Scope fences
- This is [Mode B]: docs/M1-DoD.md is the ONLY file this task writes. No spec, README, src, or test edits.
- Gauntlet commands for the Reproduction block: `npm run check`, `npm test`, `npx vitest --run test/perf-gates.test.ts --disable-console-intercept`, `npm run bench`, plus the widget battery invocation (`npx vitest --run test/widget.test.ts`).
- Honesty-note precedent (:1160s): deviations (capture timing, inherited watch flags) are recorded, never smoothed over.

## Validation commands (verified)
- `npm run check`, `npm test` — repo standard (AGENTS.md).
- `tail -n 80 docs/M1-DoD.md` to verify the append; `git diff --stat docs/M1-DoD.md` should show only additions at the end (append-only proof: `git diff docs/M1-DoD.md | grep -c '^-[^-]'` → 0 removed lines).
