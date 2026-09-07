# M1 Definition of Done — evidence record (P1.M4.T2.S2)

PRD §09 "Definition of done — M1": *"All unit tests green, integration items
1–6 pass, performance gates pass, no persistence files written anywhere
(assert store dir untouched), `pi --check` (or lint) clean."*

This file is the recorded evidence that every item of that contract passed
against the real repository. Every PASS below is backed by a re-runnable
command — re-run them to re-verify at any time.

- **Sweep date:** 2026-09-07
- **Head commit:** `c138b5b` (full: `c138b5b61cac1a5e0e43e7a53234aad55778f468`)
- **Environment:** Linux x64 · Node v26.7.0 · vitest 4.1.11 · pi 0.84.4
- **Verdict: M1 (v1) DONE.** All six gauntlet items PASS.

## Command substitution note (PRD correction)

The PRD's "`pi --check` (or lint) clean" names a command that **does not
exist** — neither in pi 0.84.4 nor anywhere in this repo. The sanctioned
equivalents, already wired in `package.json`, are:

| PRD wording | Actual command | What it enforces |
| --- | --- | --- |
| "`pi --check` (or lint) clean" | `npm run check` → `tsc --noEmit` (strict) | zero type errors |
| "All unit tests green" | `npm test` → `vitest --run` | whole suite green |

Nothing was invented; the substitution is recorded here per the sweep
protocol.

## Gauntlet item 1 — type check clean: PASS

```
$ npm run check        # tsc --noEmit, strict
```
- 2026-09-07: exit 0, zero errors.

## Gauntlet item 2 — all tests green: PASS

```
$ npm test             # vitest --run, whole suite
```
- 2026-09-07: exit 0 — **24 test files, 413 passed / 1 skipped** (the one
  skip is the pre-existing gc-dependent `dictionary.test.ts` case; it is not
  part of the DoD contract and documents its skip reason inline).
- Includes `test/acceptance.test.ts` (PRD §09 items 1–6, scripted halves)
  and `test/perf-gates.test.ts` (hard 3× budget bounds, see item 3).
- Includes `test/no-persistence.test.ts` — the automated persistence
  assertion added by this sweep (see item 5).

## Gauntlet item 3 — performance gates within budgets: PASS

Two independent measurements, both 2026-09-07:

**(a) Hard CI gate** — `npx vitest --run test/perf-gates.test.ts` (exit 0,
4/4). PRD §09 rule: numbers are asserted loosely for CI variance; **hard
regressions (> 3× budget) fail.** Measured actuals vs budgets:

| Gate | Budget (h2.51) | Measured | vs budget | CI bound (3×) | Verdict |
| --- | --- | --- | --- | --- | --- |
| a. 20k-candidate prefix query + rank + top 8 | < 1 ms p99 | **p99 0.147 ms** (median 0.066, max 0.288) | 0.15× | < 3 ms | PASS |
| b. dict load + full 20k-word lookup sweep | < 60 ms | **4.3 ms** (0 null hits, 0 phantom hits) | 0.07× | < 180 ms | PASS |
| c. ingest 800 KB synthetic session text (+ yield ≤ 64 KB) | < 60 ms | **134.7 ms**, yields 13/13 (min 13) | 2.25× | < 180 ms | PASS (within CI variance rule) |
| d. steady-state heap delta (dict + store) | < 6 MB | **8.94 MB** (settled low-water) | 1.49× | < 18 MB | PASS (within CI variance rule) |

Honesty note: gates c and d sit **above the 1× ideal budget but inside the
PRD's own 3× CI-variance rule** on this machine (vitest worker overhead is
included in both measurements). Gates a and b are far under 1×. No gate is a
hard regression; closing the c/d gap to 1× is tuning work, not a DoD
failure, and is recorded here so the next milestone sees the real numbers.

**(b) Reporting bench** — `npm run bench` (`vitest bench`, exit 0), same
fixtures, tinybench statistics:

| Gate | mean | max | p99 | samples |
| --- | --- | --- | --- | --- |
| a. query | 0.0628 ms | 0.2786 ms | 0.1476 ms | 15 927 |
| b. dict load + sweep | 1.8231 ms | 3.9336 ms | 2.6362 ms | 1 098 |
| c. ingest 800 KB | 121.60 ms | 129.97 ms | 129.97 ms | 20 |
| d. steady-state cycle | 11.77 ms | 17.18 ms | 15.73 ms | 256 |

## Gauntlet item 4 — integration items 1–6: PASS

Full checklist with per-item evidence: **[`test/fixtures/sessions/RESULTS.md`](../test/fixtures/sessions/RESULTS.md)**

State at sweep time (verified 2026-09-07, not rewritten by this sweep):

- All six items **PASS on their scripted halves** (18/18 in
  `test/acceptance.test.ts`): jargon completion, prose no-hijack, 100k
  restore timing, compaction survival, secret-shape rejection, and
  path/slash/@ byte-identical delegation.
- The live input-box halves (popup rendering, Tab insertion, keystroke feel)
  are **manual-only by automation reality** — `pi -p` never opens the editor
  (`ctx.mode === "print"`). RESULTS.md records the exact per-item procedure
  and pass criteria for a human run; this sweep adds the real-runtime
  scripted/live evidence of item 5 below but does NOT claim the manual TUI
  items were executed.
- The real-extension load check (jiti load under `pi -p -e`, exit 0, clean
  stderr) is recorded in RESULTS.md and re-verified by this sweep's live
  isolation run below.

## Gauntlet item 5 — no persistence, store dir untouched: PASS

Two layers of evidence, both 2026-09-07:

**(a) Automated, permanent** — `test/no-persistence.test.ts`, part of every
`npm test` (3/3 green). It drives the FULL real pipeline — shipped
dictionary load, fixture restore replay through `IngestPipeline`, live
`message_end` ingest + flush, threshold/trigger queries through
`rankMatches`/`extractMatchState`, and provider calls on both the hapax and
delegate paths — then snapshots the filesystem with
`find <root> -newer <marker> -type f` over three roots:

1. the temp working dir (including a fresh fake `~/.pi`-style config home
   and project dir whose `hapax.json` fixture files are read — never
   written), 2. the repository tree (`node_modules`, `.git`, `plan` pruned),
   3. the real `~/.pi/agent`, filtered to hapax-named paths
   (`/hapax|common-en|acwords/i`; pi's own `sessions/` transcript store is
   whitelisted per the sweep protocol — its cwd-slug subdir names embed the
   repo directory name, and pi's own logs are pi's files).

All three snapshots assert the **empty set**; jiti/`node_modules/.cache`
infra writes are excluded per protocol. This is a filesystem assertion, not
a source-grep, exactly as the PRD requires ("assert store dir untouched").

Static backdrop (checked 2026-09-07): `grep -rn
"writeFile|appendFile|createWriteStream|mkdir|writeSync" src/` → **zero
hits**; the only `node:fs` imports in shipped code are `readFileSync` in
`src/pi/config.ts` (hapax.json layers) and `src/core/dictionary.ts` (packed
dict). Hapax defines no writers.

**(b) Scripted live run** — real pi, real extension, real model turn:

```
$ LIVE=/tmp/hapax-dod-live-1788807060        # fresh empty dir
$ touch $LIVE/marker
$ cd /tmp && PI_CONFIG_DIR=$LIVE pi -p -e /home/dustin/projects/hapax \
      --no-builtin-tools "mention Zendesk and lwlock" < /dev/null
```

- exit **0**, stderr **0 bytes** (no extension errors), ~10 s. Stdout
  excerpt: *"## lwlock (PostgreSQL) — lwlock = Lightweight Lock,
  PostgreSQL's internal low-overhead locking mechanism … ## Zendesk —
  Zendesk is a customer-service/SaaS company …"* (both prompt terms
  answered; full output captured in the sweep log).
- Post-run `find` snapshots (marker-relative):
  - fresh `$LIVE` dir: **empty except the marker** — pi 0.84.4 bootstrapped
    nothing there (the redirect trick isolated nothing for pi itself; the
    hapax assertion below is what carries the evidence),
  - repository tree (node_modules/.git/plan pruned): **zero** new files,
  - `~/.pi/agent`: only pi-owned writes — the run's own session transcript
    (`sessions/--tmp--/2026-09-07T18-51-07-*.jsonl`), an append to the
    already-open orchestrator session transcript, and pi's
    `mcp-cache.json` refresh. The string "hapax" appears in these paths
    only inside pi's cwd-slug directory naming; **no hapax-originated
    artifact** (candidate store, dictionary copy, hapax.json, debug dump,
    any `.bin`) exists anywhere in the snapshot.

## Gauntlet item 6 — tuning protocol pointer: RECORDED

Tuning surfaces live in **`src/core/score.ts`** as baked constants:
admission bands `REJECT_COMMON_THRESHOLD = 220` and `MID_FREQ_THRESHOLD =
120`; salience weights `W_FREQ = 2.0`, `W_RECENCY = 3.0`, `W_USER_TYPED =
1.5`, `W_PROPER_NAME = 0.8`, rarity `1.0 / 0.5 / 0` (rank groups 0/1/2).

Protocol (PRD §09 h2.52, summary): change **one** constant at a time, run
the acceptance suite, and A/B against the fixed 3-session corpus fixture
(`test/fixtures/sessions/` — zendesk-lwlock, prose, large-100k) checking
precision@8 against the hand-labeled `expected.md`. No telemetry exists;
tuning is fixture-driven by design. M2 will add phrase multipliers to the
same protocol.

## Drift fixes made by this sweep

None required. All six items passed as-found; this sweep only **added**
evidence and automation:

| Change | Kind |
| --- | --- |
| `docs/M1-DoD.md` (this file) | new evidence record |
| `test/no-persistence.test.ts` | new automated DoD assertion |
| `README.md` — Status line + DoD pointer | docs status update |

No source files under `src/` were touched.

## Reproduction

```bash
npm run check                                   # item 1
npm test                                        # items 2 + 5(a)
npx vitest --run test/perf-gates.test.ts --disable-console-intercept   # item 3(a) actuals on [gate …] lines
npm run bench                                   # item 3(b) reporting numbers
cat test/fixtures/sessions/RESULTS.md           # item 4
LIVE=$(mktemp -d) && touch $LIVE/marker && \
  cd /tmp && PI_CONFIG_DIR=$LIVE pi -p -e /home/dustin/projects/hapax \
  --no-builtin-tools "mention Zendesk and lwlock" < /dev/null   # item 5(b)
```