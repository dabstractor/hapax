# Research notes — P3.M1.T2.S2 (full gauntlet)

Collected at research time (baseline per item contract: npm test = 4 failed /
1128 passed / 1 skipped, 1133 total; npm run check exit 0).

## 1. The 4 baseline reds and who fixes them

- 3 reds: `test/defer-pi-menu.repro.test.ts` — 4 `it` cases total
  (:150 forced file menu, :170 argument-completion menu, :183 async
  menuDelayMs race, :224 pure-slash contrast case). The first 3 are red
  pre-P3.M1.T1.S1; the 4th is a passing contrast case. P3.M1.T1.S1
  (Implementing in parallel) fixes the widget Tab branch
  (`src/pi/widget.ts` pre-check `inner.isShowingAutocomplete?.() === true`
  after `decideWidgetKey`, before tab-insert) and hardens this battery —
  its Success Definition: **4/4 green**. That is the named precondition for
  this gauntlet.
- 1 red: `test/acceptance.test.ts` "acceptance — real extension loads under
  pi -p -e (network-gated)" — environment-sensitive; S2 resolves or
  acknowledges (see §2).

## 2. The environmental case — structural diagnosis

- Test at test/acceptance.test.ts:604-663. Spawns
  `pi -p -e <cwd> --no-builtin-tools "say Zendesk lwlock"` (stdin ignored,
  120 s kill timer), asserts exit 0 / non-empty stdout / stderr not
  matching `/hapax/i`.
- The guard (catch block :651-662) builds `evidence = err.message` ONLY.
  When `expect(code).toBe(0)` fails because pi exited 1, the rethrown
  vitest AssertionError message is "expected 0 to be 1" — it carries
  NONE of the child's stderr, so the environmental regex
  (`ENOENT` via err.code; `ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timed
  out|aborted`; `\b(401|402|403|429)\b|unauthor|api key|quota|rate limit|
  credit|billing|no available model|provider`) never sees the actual
  wording → test fails instead of skipping. This is the observed 4th
  failure ("exited 1 with stderr outside the environmental-skip regex at
  acceptance.test.ts:645-658" per the item contract).
- Minimal correct fix: surface the child's stderr into the evidence string
  the regex tests (e.g. `` evidence = `${err.message}\n${stderr}` `` —
  stdout/stderr/code are in scope in the try block), and, if the observed
  stderr wording is genuinely environmental but still unmatched, extend the
  regex minimally with that wording. The test's own header comment
  documents the intent: "When the environment is offline or
  unauthenticated the check SKIPS (never fails CI); a real extension load
  error still fails." Do NOT touch the three assertions; do NOT broaden to
  a catch-all.

## 3. Perf gates — test/perf-gates.test.ts (9 gates, console.log actuals)

| Gate | Test | Budget | CI bound (3×) |
|---|---|---|---|
| a  | :80 20k fuzzy query p99, 1000 queries over ~910-key 'p' bucket | < 1 ms | < 3 ms |
| a2 | :246 cold first rankMatches on fresh 20k store | < 1 ms | < 3 ms |
| a3 | :131 zero-fragment full-store '#' listing p99 (tripwire, NOT a §09 gate) | — | < 25 ms |
| t0 | :170 tier-0 anchorless fallback full-store pass | < 3 ms | < 9 ms |
| b  | :282 dict load + 20k hits + 1k misses | < 60 ms | < 180 ms |
| c  | :309 ingest 800 KB, yields between every ≤ 64 KB slice | < 60 ms headline (operative 02 restore figure; healthy ~97–174 ms) | < 180 ms |
| d  | :390 steady-state heap delta (dict + store) | < 6 MB | < 18 MB |
| e  | :483 DEFAULT-config restore of large-100k fixture (1561 msgs, bigrams ON) | — | < 600 ms |
| f  | :525 over-cap flood, 25k distinct words one message | §05 hard < 100 ms | < 300 ms |

- Actuals print via console.log at :106, :143, :219, :269, :295, :378, :451,
  :506, :552 — one `[gate X]` line each. Capture with
  `npx vitest --run test/perf-gates.test.ts --disable-console-intercept`
  (the M1-DoD Reproduction convention).
- session_tree branch rebuild has NO separate gate row — it rides the
  restore budgets (gate e < 600 ms). Do not add one.
- PRD h2.62 note: do NOT re-tighten gate c to 60 ms without re-optimizing
  ingest first; record honesty notes when actuals sit above 1× budget but
  inside the 3× CI bound.

## 4. Bench

`npm run bench` = `vitest bench` over `test/bench/core.bench.ts` only
(vitest's test include excludes `*.bench.*` from `npm test`). 5 benches:
gate a (query), t0 (fallback), b (dict sweep), c (ingest 800 KB, 13 ≤64 KB
slices), d (load+fill+query cycle). REPORT-ONLY (tinybench cannot fail CI);
hard bounds live in perf-gates. Bench names embed their budgets.

## 5. Downstream consumer — S4 append pattern

docs/M1-DoD.md (1,570 lines) is a single append-only evidence log. Per
architecture/04-tests-docs-r5.md §6, each sweep entry has: header (date,
head commit short+full SHA, env OS·Node·vitest·pi version, one-line
verdict); numbered "Gauntlet item N — <name>: PASS" sections with
re-runnable commands + dated result lines ("2026-10-02 @ `a2e9470`: exit 0 —
38 test files, 1126 passed / 1 skipped"); gate tables (Gate | Budget (spec
ref) | Measured | vs budget | CI bound 3× | Verdict) with honesty notes;
"Drift report (spec read-only this run)"; final "Reproduction" block.
S2 supplies the data (counts + gate table + env + commit + environmental
resolution evidence); S4 writes the append.

## 6. Conventions / gotchas

- package.json scripts: `check` = tsc --noEmit; `test` = vitest --run;
  `bench` = vitest bench. No ruff/mypy — this is a TS repo; `npm run check`
  IS the lint gate (the PRD's "pi --check or lint clean" maps to it).
- Environmental-skip record convention: test comment "record in RESULTS.md"
  → test/fixtures/sessions/RESULTS.md (:96-100 documents the scripted
  check + auto-skip behavior; :9 records suite counts).
- The pre-existing 1 skip = gc-dependent dictionary.test.ts case
  (RESULTS.md:9-10). Expected final state: 0 failed; skips ⊆ {gc case,
  pi -p environmental case}.
- Counts will NOT match the 1133 research baseline (parallel/earlier
  subtasks add tests) — record actuals pinned to HEAD; never force-match.
- plan/ dirs are pipeline artifacts — gauntlet output goes to
  plan/006_7bd0258da993/P3M1T2S2/ (gauntlet-results.md) + research/ logs.
  src/ and spec/ stay untouched (the only sanctioned edit is the
  acceptance.test.ts skip-guard, per the item contract's RESOLVE option).
