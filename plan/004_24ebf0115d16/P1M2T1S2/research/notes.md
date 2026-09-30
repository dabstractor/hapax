# Research notes — plan 004 P1.M2.T1.S2: full gauntlet + DoD append + live smoke + drift report

## The DoD append pattern (SCOUT-CORRECTED — verified in docs/M1-DoD.md)
- docs/ contains ONLY M1-DoD.md (no M2/M3 DoD files). The "established append pattern" = M1-DoD.md's own structure:
  - Section heading `## Gauntlet item N — <name>: PASS` (or `: RECORDED` for pointer items)
  - Fenced re-runnable command block (`$ npm run check`), date + exit status
  - Suite counts verbatim ("24 test files, 413 passed / 1 skipped" + inline skip rationale)
  - Gate table: | Gate | Budget | Measured | vs budget | CI bound (3×) | Verdict |
  - Honesty notes for near-misses; command-substitution note precedent at top of file (pi --check → npm run check)
- Header block: sweep date, head commit (git rev-parse HEAD), environment (node/vitest versions), verdict line.
- Append a new section for the tier-0/loose-mode changeset (e.g. `## Tier-0 anchorless fallback + # loose mode — changeset DoD (2026-10-…)`) with its own gauntlet items; do NOT rewrite the 2026-09-07 M1 record.

## Commands (external_deps.md)
- npm run check (tsc --noEmit strict) · npm test (vitest --run) · npm run bench (vitest bench, reporting only, tinybench)
- Perf-gate precedent (test/perf-gates.test.ts :76–121): warmup 100 → 1000 timed samples → p99 = dts[⌈0.99·N⌉−1] → expect(p99 < 3×budget); NEW tier-0 gate row from P1.M1.T1.S2 (budget 3 ms, CI assert < 9 ms) — take its MEASURED numbers from the run for the gate table.

## Upstream inputs
- P1.M1.T1.S1/.S2 (Complete): tier-0 matcher + RankedMatch.tier + perf gate numbers.
- P1.M1.T2.S1/.S2 (Complete): per-mode fuzzThreshold defaults (60 ambient / 45 trigger), loose-mode wiring, chain-arm suppression on tier-0.
- P1.M2.T1.S1 (Implementing in parallel — README sweep): lands updated README + writes research/stale-claims.md (found/fixed/verified-agreeing lists) — THIS task consumes it for the drift report. Do not duplicate README work.

## Live smoke technique (spec/09 h2.57 — BINDING)
- Ephemeral: `pi --no-session` inside a tmux pane (needs real TTY; piped stdout exits silently).
- Seed store: submit ONE short user message containing the smoke vocabulary, then Ctrl+C the turn (message_end ingest populates candidates).
- Keys via `tmux send-keys` ONE CHAR AT A TIME with 0.08–0.12 s sleeps — bursts CANCEL in-flight autocomplete queries (documented source of false conclusions).
- Verify via `tmux capture-pane`.
- Sanctioned instrumentation: appendFileSync behind an env var in src/pi/provider.ts; MUST be removed before finishing (check git status/diff clean of instrumentation).

## The three smoke scenarios (item contract + tier0_design §7)
1. Zero-anchored-result word whose contiguous-run cousin exists (said→unsaid class): type e.g. `uns`-prefix word whose anchored scan is empty but tier-0 finds the cousin → one-shot menu appears, then NARROWS AWAY as typing continues (tier-0 fires only on empty anchored results — continued typing either anchors or empties).
2. `#query` → completes `src/core/query.ts` (loose mode consults tier-0 unconditionally; path filename).
3. Tab on a tier-0 `#`-mode completion does NOT arm a successor offer (chains stay anchored everywhere; next word start shows no chain offer — verify via capture-pane absence).
- Smoke vocabulary must be seeded in the first message (e.g. include "unsaid" and the path "src/core/query.ts" text) so the store holds the cousins.

## Drift report inputs (tier0_design §8 — verified-agreeing, expected none)
- Module rows spec/02:64–68 ↔ src/pi/{editor,debug,paths}.ts ✅
- Dict figures spec/03:37–54 ↔ 850,554 B / 48,802 entries / LF 0.7445 ✅
- M2 DoD re-theme ↔ acceptance.test.ts:838 (Zorp→Noria→Inverter) ✅
- Decision log = spec/SPEC.md:67 (section, not artifact) ✅
- Plus S1's stale-claims.md residuals (README items verified-already-agreeing).
- spec/*.md were READ-ONLY this whole run — the drift report records, never edits.

## Scope fences
- No code changes (except sanctioned-then-REMOVED instrumentation), no spec edits, no README edits (S1's), no test changes (unless a gauntlet item FAILS — then stop and report, fix is not this task's mandate).
- Mode B: the DoD append + drift report ARE this subtask's documentation output.
