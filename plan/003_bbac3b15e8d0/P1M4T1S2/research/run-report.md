# Run report — P1.M4.T1.S2: M3 DoD re-verification sweep

Sweep executed 2026-09-30 at HEAD `0f1018c` (full
`0f1018c49e7570af7811a904be02698a44ccbd15`, "feat(pi): live-verify widget;
repaint on timer swaps"). Environment: Linux x64 · Node v26.10.0 ·
vitest 4.1.11 · pi 0.85.1. Mode B: spec/ read-only — drift notes live here.

The authoritative record is the appended M3 section in `docs/M1-DoD.md`;
this file is the sweep's working narrative and drift log.

## Precondition checks (Task 0)

- **T4.S1 live record (hard input): PRESENT.**
  `plan/003_bbac3b15e8d0/P1M3T4S1/verification-record.md` + `captures/`
  (a0…w12 capture files) landed at HEAD; overall verdict PASS (W1–W12),
  including the W1 bugfix (one-keystroke set lag → microtask post-apply
  evaluation in `src/pi/widget.ts`, live re-verified) and the honest
  findings folded into the DoD record (W7 fallback-unreachable; cold-boot
  first-paint hold; same-column suppression stickiness).
- **S1 README sweep:** landed (staged docs-only change + sweep-log;
  `npm run check`/`npm test` green post-sweep per its log). Non-gating for
  the gauntlet; cited in the DoD files-changed table.
- `git status src/` clean of stray instrumentation (T4.S1 removed its
  HAPAX_DEBUG_LOG instrumentation before finishing; verified again here via
  the no-persistence static grep and a clean `npm run check`).

## Gauntlet results (Tasks 1–5)

| Item | Result |
| --- | --- |
| `npm run check` | exit 0 (2026-09-30) |
| `npm test` | 37 files / 1007 passed / 1 skipped (pre-existing gc skip); 3 consecutive green runs post-fix |
| `npx vitest --run test/perf-gates.test.ts` | 8/8 PASS (gates a/a2/a3/b/c/d/e/f) |
| `npm run bench` | exit 0; means a 0.2486 ms / b 1.81 ms / c 111.2 ms / d 44.1 ms |
| widget.test.ts | 52/52 |
| widget-visibility.test.ts | 18/18 |
| editor-enter.test.ts | 28/28 |
| startup-gate.test.ts | 7/7 |
| query.test.ts (anchored-fuzzy core) | 66/66 |
| score.test.ts (R_eff + guard + salience) | 75/75 |
| config.test.ts (clamps incl. fuzzThreshold/rejectCommonness) | 52/52 |
| segment.test.ts −t "path tokens" (item 7) | 12/12 |
| query.test.ts −t "path candidates" (item 7) | 4/4 |
| no-persistence.test.ts | 3/3 |

Integration items 1-M3 / 2 / 7 walked: scripted halves via the widget +
segment/query suites (commands in the DoD record), live halves cited from
T4.S1 W1–W6 (items 1–2), W8–W10 (items 6–7). Not duplicated, not re-run
(h2.57's binding live pass already happened in T4.S1).

## Triage log

1. **perf gate a2 intermittent 5 s timeout — FIXED (minimal).**
   Symptom: 2 of 4 pre-fix full-suite runs failed
   `perf gate a2 — cold first query on a fresh 20k store` with
   "Test timed out in 5000ms". Root cause: the test's SETUP fills 120
   fresh 20k stores (multi-second by itself), sitting at vitest's default
   5 s test timeout; parallel worker load pushes it over. The measured
   assertion (cold-query p99 < 3 ms) was never the failing part.
   Fix: explicit `30_000` timeout on that one test
   (test/perf-gates.test.ts), with a comment; owning contract
   P1.M2.T2.S2's budget and assertion unchanged. Post-fix: 3/3 green full
   suites. Attributed per the PRP ownership map to the gate's owning
   subtask (P1.M2.T2.S2); logged in the DoD triage table.
2. **Static no-persistence backdrop drift — RECORDED.** The M1/M2-era
   claim "grep → zero hits" no longer holds: `src/pi/debug.ts` writes
   `/tmp/hapax-store.txt` from the user-invoked /acwords dump (commit
   `4d26f3f`, 2026-09-10, inside this changeset). Spec/08 sanctions the
   `debug` surface ("enables /acwords command + store dump"); the write is
   command-gated, /tmp-targeted, best-effort (try/catch), and the dynamic
   snapshot suite stays 3/3 green. Not a persistence regression; recorded
   in the DoD's no-persistence block.
3. **T4.S1 W7 fallback-unreachable finding — RECORDED (upstream).** On the
   recorded pi build the editor factory is always present, so the fallback
   provider path could not be live-exercised; it remains unit-suite
   coverage, and the widget was live-verified around the stock editor
   instead (session B). Cited in the DoD live-verification block.

## Spec-drift notes (spec/ read-only this run — for a later reconciling session)

1. **perf-gate describe labels are CURRENT, not stale** (the PRP's drift
   caveat does not apply at this HEAD): gate a reads "20k-candidate fuzzy
   query (first-char bucket) + rank + top 8" and the bench entry "first-char
   bucket 'p' (~913 range)"; the measurement provably enters the
   anchored-fuzzy bucket (sanity assertions in both files). Earlier plan
   documents referring to a stale "prefix query" label can be retired.
2. **Gate c's budget wording** (spec/09 h2.58 "< 60 ms, yields every
   ≤ 64 KB") vs. reality: measured 122.8 ms (2.05×) inside the documented
   3× CI-variance bound, watch-flagged — consistent with the M2-era
   calibration note (`3182fbc`); spec text itself is internally consistent
   (loose assertion + 3× rule), but the watch history should accompany any
   future budget reconciliation.
3. **h2.58 table lists four gates; the suite runs eight** (a2 cold, a3
   zero-fragment sanity, e restore, f eviction flood are extra hard bounds
   beyond the spec table). Not a contradiction (the spec table is a
   minimum), but a reconciling session may want the extras named.
4. **Node/pin skew across records:** the M1/M2 records cite Node v26.7.0;
   this sweep ran Node v26.10.0 (environment drift only; all gates green).
   The pi CLI reports 0.85.1 while T4.S1's live sessions recorded a
   "pi 0.99.x" build for the fallback finding — version provenance of the
   live stack lives in T4.S1's record; worth a line in any future
   environment reconciliation.
5. **README staleness (r5 §4)** is S1's contract (landed docs-only sweep);
   nothing re-checked here.

## Verdict

**M3 (v3) DONE** — recorded in docs/M1-DoD.md with per-clause commands,
dates, named cases, the re-captured bench table (watch flags per the M2
honesty-note practice), triage log, files-changed table, and reproduction
block. M1/M2/Bugfix sections byte-identical (additive append verified).
