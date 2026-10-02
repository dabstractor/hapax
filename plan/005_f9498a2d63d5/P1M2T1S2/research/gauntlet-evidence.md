# Plan 005 P1.M2.T1.S2 — full gauntlet evidence + §1a drift spot-check report

Consumed by P1.M2.T1.S3 (live smoke — runs against the tree certified green
here) and P1.M2.T1.S4 (DoD append — cite this file's counts, gate numbers,
and drift verdict verbatim into docs/M1-DoD.md). Spec is READ-ONLY this run
(AGENTS.md h2.1): drift is recorded, never edited.

## Environment

- **Date:** 2026-10-02
- **Head commit:** `a2e9470` (full: `a2e94703d1488191f32db10a50aaa9c961ffeeeb`
  — "docs(pi): re-mirror README invariant 1 to spec v2", the P1.M2.T1.S1
  README sweep's landing commit)
- **Node:** v26.10.0 · **vitest:** `vitest/4.1.11 linux-x64 node-v26.10.0`
- **Precondition (Task 0):** the v2 changeset is fully landed — `a5c815d`
  (v2 decision core), `816048e` (v2 wiring + tick/flag seams), `97a840e`
  (the v2 widget key battery = P1.M1.T1.S3), `a2e9470` (README re-mirror =
  P1.M2.T1.S1). No in-flight work; the tree swept is the whole changeset.

## Gauntlet (all three commands exit 0)

### `npm run check` — exit 0

tsc --noEmit, strict: zero errors. 2026-10-02 @ `a2e9470`.

### `npm test` — exit 0

Verbatim: **"Test Files  38 passed (38)" / "Tests  1126 passed | 1 skipped
(1127)"**. The one skip is the pre-existing gc-dependent
`dictionary.test.ts` case, documented inline in that file and carried
through every prior DoD record — no new skips.

### `npm run bench` — exit 0 (reporting-only; hard bounds live in
test/perf-gates.test.ts, 9/9 green within `npm test`)

The five spec/09 h2.58 gates, verbatim from the bench table:

| Gate (h2.58) | Budget | Bench mean | Bench p99 | Samples |
| --- | --- | --- | --- | --- |
| a. anchored-fuzzy query — 20k store, first-char bucket 'p' (~913 range) + rank + top 8 | < 1 ms p99 | 0.2313 ms | 0.4521 ms | 3 848 |
| t0. tier-0 anchorless fallback — full-store pass, probed fragment | < 3 ms p99 | 0.3736 ms | 0.8035 ms | 2 356 |
| b. dict load + full 20k-word lookup sweep | < 60 ms | 1.6621 ms | 3.2640 ms | 1 113 |
| c. ingest 800 KB synthetic session text (13 ≤64 KB slices) | < 60 ms headline; **180 ms CI bound is operative** (h2.58 Issue-4 note — 174–187 ms actuals are NOT drift) | 99.7998 ms (max 115.87) | 115.87 ms | 20 |
| d. steady-state cycle — dict load + 20k store fill + query | heap < 6 MB (hard gate asserted in perf-gates: 7.37 MB settled low-water, CI < 18 MB — green) | 38.7345 ms/cycle | 58.5176 ms | 70 |

Bench is reporting-only; every budget's hard assertion passed inside
`npm test` via test/perf-gates.test.ts (9/9).

## §1a spot-check — 9-row verdict table (verification read pass, zero edits)

| # | Evidence site (as cited) | Verdict |
| --- | --- | --- |
| 1 | src/core/segment.ts:575–580 — rule-4c containment deferral | **AGREE** — :575–576 `o.start <= start && end <= o.end` → "containing token wins — pass is additive-only (BUG-002)"; :577–580 the trailing-`_` straddle comment verbatim ("'FOO_1_' keeps its base token … no 'FOO_1' literal forks. Only '_' can straddle"). Content exactly as cited, at the cited lines. |
| 2 | src/pi/ingest.ts:402–428 — chunk-boundary token carry | **AGREE** — :404 "A slice boundary never splits a token (BUG-004 fix): the trailing partial token … carried into the next slice … exactly once"; :425 `let carry = ""` implementation with openLine/openTail below. Content exactly as cited, at the cited lines. |
| 3 | test/score.test.ts:129 — R_eff(9) float-compare + boundary probes | **AGREE** — :129 is the it-line "sqrt ramp boundary at 9 chars: rEff ≈ 82.15 → q=82 admits, q=83 rejects (float compare, no rounding)", with `expect(rEff(REJECT_COMMON_THRESHOLD, 9)).toBeCloseTo(82.147, 2)` and both boundary probes (82 → 1, 83 → "reject") in the body. Exact line, exact content. |
| 4 | src/pi/config.ts:135–162, 237, 246+ — reserved triggerChar advisory; notify level "warning" | **AGREE** — :135 `notify: (msg: string, level: "warning") => void`; :142–149 `validateTriggerChar` (schema unchanged — reserved ≠ invalid); :27–34 + :160–168 the reserved-char advisory (@, /, '"' in STOCK_CONTEXT_TRIGGER_CHARS); :237 and :246 notify calls pass `"warning"`; :450+ the warn-once effective-value check. Content exactly as cited. |
| 5 | test/perf-gates.test.ts:309 — ingest gate CI bound 180 ms | **AGREE** — :309 is the it-line "processText completes under 180 ms and yields between every ≤64 KB slice (3× the 60 ms budget)". Exact line, exact bound. (Per the gotcha: the 60 ms headline vs 180 ms operative CI bound is spec/09 h2.58's own note — not drift.) |
| 6 | test/store.test.ts:431 — eviction ONE pass / full 256-victim batch | **AGREE** — :431 is the it-line "20,001 inserts → exactly one eviction pass (a full 256 batch), size back within the cap", with STORE_CAP/EVICT_BATCH=256 pinned at :427–428. Exact line, exact wording. |
| 7 | test/acceptance.test.ts:838 + fixtures — Zorp/Zephra re-theme | **AGREE** — :838 is the it-line "zero-typing chain — Zorp → space → top successor → Tab → Noria → Tab → Inverter, zero typed word-chars (h2.54)" on `zephyr-chain.jsonl` (4 Zephra/zephyr-family hits in the fixture); RESULTS.md:127–131 documents the retheme ("rethemed to `Zorp Zephra Noria Inverter`", `turbine` q=26 second successor). Content exactly as cited. |
| 8 | "src/pi/query.ts:480, 530" — ASCII `x` in session descriptions | **AGREE, with one path correction in the citation itself**: the module is `src/core/query.ts` (query is a core stage; there is no src/pi/query.ts). Content at the cited lines in the real file: :480 `description: \`session x${c.sessionCount}\`` with the comment "ASCII x per item contract", and :530 the same template in the zero-fragment path. Never U+00D7. |
| 9 | src/pi/widget.ts:1443–1460 — BUG-001 chain arming at Tab-insert | **AGREE (line shift, content verified — per the row-9 caution)** — the arming gate + arm call now live at **:1569–1572**: :1569 `if (opts.config.enableChaining && rec && rec.tier !== 0 && rec.key)` (strict tier-0 exclusion), :1570 `opts.chain.arm(rec.key)` (arms at the store key), :1571 `chainGrant.reset()` (fresh one-shot grant per acceptance); supporting doc-comments at :437–440 ("Tab-insert arming seam (BUG-001 fix…): the accepted item's key (the store key for chain.arm) and tier (tier-0 anchorless matches never arm)") and :1300 ("tab-insert arm site below resets it beside chain.arm (fresh grant per acceptance)"). The shift is explained by the P1.M1.T1.S2 wiring edits landing after the table was written; all three cited properties are present. |

**Verdict count: 9/9 AGREE** (one citation-path correction on row 8, one
tolerated line-shift on row 9 — neither is drift; both recorded above).

## Drift report (spec read-only this run): NONE FOUND

No spec-vs-repo mismatch surfaced in the gauntlet or the 9-row read pass.
spec/*.md untouched; no code, test, README, or docs edits made by this task
(this research file is the task's only output).

## Reproduction

```bash
git rev-parse HEAD                                 # a2e94703… (or later; re-capture counts if src/ or test/ moved)
npm run check                                      # exit 0
npm test                                           # 38 files / 1126 passed / 1 skipped
npm run bench                                      # gate rows quoted above
sed -n '575,580p' src/core/segment.ts              # row 1
sed -n '402,428p' src/pi/ingest.ts                 # row 2
sed -n '129p' test/score.test.ts                   # row 3
sed -n '135p;142,149p;160,168p;237p;246,253p' src/pi/config.ts   # row 4
sed -n '309p' test/perf-gates.test.ts              # row 5
sed -n '431p' test/store.test.ts                   # row 6
sed -n '838p' test/acceptance.test.ts              # row 7 (+ zephyr-chain.jsonl, RESULTS.md:127)
grep -n 'session x${' src/core/query.ts            # row 8 (NOTE: core, not pi — see verdict)
grep -n -A 3 'chain.arm(rec.key)' src/pi/widget.ts # row 9 (content-verified, now :1569–1572)
```
