# Research notes — plan 005 P1.M2.T1.S2: full gauntlet + §1a drift spot-check

## Gauntlet commands (external_deps.md §'Gauntlet commands')
- `npm run check` (tsc --noEmit) · `npm test` (vitest --run) · `npm run bench` (vitest bench). All green required.
- Precedent: docs/M1-DoD.md:16–29 records `pi --check` does not exist; these are the sanctioned equivalents.
- docs/M1-DoD.md is 1261 lines, APPEND-ONLY — but THIS task does NOT append (that's P1.M2.T1.S4); this task only produces the evidence + drift report handed to S3 (live smoke) and S4 (DoD append). Drift precedent: ":1166 NONE FOUND".

## Upstream inputs (assume delivered)
- P1.M1.T1.S1 (Complete): WidgetState generation flag + WidgetKeyDecision/decideWidgetKey v2 decision table.
- P1.M1.T1.S2 (Complete): widgetHandleInput wiring — boundary-pass-through branch, navigate wrap + interacted flag.
- P1.M1.T1.S3 (Implementing): widget.test.ts battery rewrite to the v2 model — the gauntlet's centerpiece; run after it lands.
- P1.M2.T1.S1 (Implementing, parallel): README sweep — docs-only; the gauntlet should see it landed or at least not conflict (docs edits can't break tests).

## §1a spot-check table (verification_1a.md — 9 rows, cite file:line, expect NO drift)
1. segment.ts:575–580 — rule 4c containment deferral (FOO_1_, X=1ZZ_ straddle absorption)
2. ingest.ts:402–428 — chunk-boundary token carry ("BUG-004 fix")
3. test/score.test.ts:129 — R_eff(9) float-compare note; probes q=82 admits / q=83 rejects at 9 chars
4. config.ts:135–162, 237, 246+ — reserved triggerChar (@, /, ") advisory warning; notify level "warning"
5. perf-gates.test.ts:309 — ingest gate CI bound 180 ms (3× of 60)
6. store.test.ts:431 — eviction wording: one pass / full 256-victim batch
7. acceptance.test.ts:838 + fixtures — Zorp/Zephra re-theme (zephyr-chain.jsonl, RESULTS.md)
8. src/pi/query.ts:480, 530 — ASCII `x` in "session x${...}" descriptions (never U+00D7)
9. widget.ts:1443–1460 — BUG-001 chain arming at Tab-insert (rec.key, tier !== 0 strict, fresh grant)
NOTE row 9 interacts with the v2 model changes in P1.M1.T1.S2 — line numbers may have shifted by the wiring edit; verify by content (chain.arm call in insertHighlighted), not just line number; record actual line if moved.

## What to capture for S3/S4
- Per command: exit code, date, suite counts verbatim (files / passed / skipped), bench gate numbers (esp. the 5 gates of spec h2.58: anchored <1ms p99, tier-0 <3ms p99, dict <60ms, ingest <180ms CI, heap <6MB).
- The 9-row spot-check verdict table: row → file:line checked → AGREE / MISMATCH(verbatim quote).
- Expected: no drift; mismatches recorded verbatim (spec/*.md READ-ONLY — AGENTS.md h2.1 pipeline rule).

## Commands
- npm run check && npm test && npm run bench (record each separately).
