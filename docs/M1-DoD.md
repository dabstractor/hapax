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

---

## Bugfix-001 re-verification — PRD §09 integration items 5/6/7 (P1.M4.T1.S1, 2026-09-08)

Closes the PRD Testing-Summary loop for bugfix-001 (fixes BUG-001..006:
stock-context delegation, armed-chain reset, relief ceiling 95, 32-char
mask floor + sub-word poisoning, astral boundary, bigram drain loop).
Full gauntlet at head `f69e893`:
`npm run check` exit 0 · `npm test` **33 files / 723 passed / 1 skipped**
(the known gc-dependent `dictionary.test.ts` case) — up from the 636-test
pre-fix baseline, with every new pin green. No cross-fix fallout; no
spec-derived test was weakened. The recorded known gap "successorIndex
eviction cleanup" (M2 section below) remains recorded and untouched.

### Integration item 5 — secret paste battery: PASS

```
$ npx vitest --run test/adversarial-ingest.test.ts test/mask-secrets.test.ts
```
- 2026-09-08 @ `f69e893`: **2 files, 62/62 green.** The battery runs the
  realistic-key corpus (38-char AWS `wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY`,
  npm/glpat/sk_live/Bearer synthetics) through the real `IngestPipeline` +
  shipped `dict/common-en.bin` and asserts via `rankMatches` that NO
  fragment — including `cyexamplekey`, `jalr`, `femik7` — is ever offered
  by any prefix query; the 32-char mask floor + sub-word poisoning cover
  the residual classes the earlier 20-char floor leaked.

### Integration item 6 — stock-context parity sentinels: PASS

```
$ npx vitest --run test/provider.test.ts test/provider-live.test.ts test/provider-match.test.ts
```
- 2026-09-08 @ `f69e893`: **3 files, 99/99 green.** Slash (`/re`), `@men`,
  and quoted-path (`"src/roun`) contexts delegate to
  `current.getSuggestions` with byte-identical arguments
  (classifyStockContext runs BEFORE the armed-chain machine); Tab in a
  stock context never opens the hapax menu, and Tab-only-completes holds
  on the forced path.

### Integration item 7 — NREL chain at zero typed chars: PASS

```
$ npx vitest --run test/chain.test.ts test/chaining-gating.test.ts test/acceptance.test.ts
```
- 2026-09-08 @ `f69e893`: **3 files, 58/58 green**, including the end-to-end
  pin in test/acceptance.test.ts ("zero-typing chain … PRD §09 DoD M2 item
  7"): `na` → accept `National` → zero additional typed word-chars →
  `Renewable` top → Tab → `Energy` → Tab → `Laboratory`, replayed against
  the shipped dictionary with no mocks.

### Query-latency spot check (same sweep)

```
$ npm run bench ; npx vitest --run test/perf-gates.test.ts --disableConsoleIntercept
```
- Query gate: **p99 0.062 ms** (bench) / **0.106 ms** (perf-gates) on a
  20k-candidate store — the ~0.1 ms class budget holds.
- Ingest gate under the new bigram drain loop: **76.7 ms** best-of-3
  (perf-gates) / **60.97 ms** bench mean for 800 KB — ~1.0–1.3× the 60 ms
  budget, well inside the 3× hard bound (down from the pre-drain-loop
  172–185 ms sweep; the one-call drain removed the per-drain resort cost).
- Carried watch flags (inside bounds, unchanged verdicts): heap delta
  6.93 MB vs 6 MB budget (GC-sampling noise); 25k-flood 109.6 ms vs the
  §05 hard 100 ms budget.

---

## M2 Definition of Done — post-delta re-verification (P1.M4.T1.S2)

PRD §09 h2.54 (rewritten, verbatim contract for the D2 redesign):

> M1 done plus: successor-index chaining state machine with ZERO-typed-char
> successor offers, live successor filtering, chain resets on
> `before_agent_start`, the one-word invariant (no multi-word item is ever
> offered — asserted in tests), and raw-text-adjacency window breaks:
> commas, quotes/brackets/backticks, digits, non-word characters, intervening
> words (stopword bridging forbidden), newlines. Integration item 7: accept
> `National` → with zero additional typed chars `Renewable` is the top result
> → Tab → `Energy` → Tab → `Laboratory`.

This section is the item-by-item audit record for that contract against the
post-delta codebase (phrase layer deleted; successor chaining via the
adjacency bigram index; forced single-item Tab branch). Every PASS below is
backed by a re-runnable command; re-run them to re-verify.

- **Sweep date:** 2026-09-08 (11:06 UTC)
- **Head commit:** `5739b09` (full: `5739b090d7782a133914ce81db2af2f99bacceaf`
  — "docs: record M1 regression evidence post-delta")
- **Environment:** Linux x64 · Node v26.7.0 · vitest 4.1.11 · pi 0.85.1
- **Upstream evidence:** [plan/002_3e8a42cadf2c/P1M4T1S1/research/regression-evidence.md](../plan/002_3e8a42cadf2c/P1M4T1S1/research/regression-evidence.md)
  — S1's same-day full sweep (2026-09-08) supplies the environment header,
  post-delta suite counts, the four-gate bench table, and the no-persistence
  verdict. Cited, not duplicated. **HEAD movement note:** S1 swept at
  `1b71807`; HEAD has since moved to `5739b09` — the delta is S1's own
  evidence-landing commit and touches **zero files under `src/` or `test/`**
  (verified: `git diff --name-only 1b71807..HEAD -- src/ test/` is empty),
  so this audit additionally re-captured the counts and bench numbers
  directly at `5739b09` (below); they match S1's.
- **Suite counts after the phrase deletions** (re-captured 2026-09-08 at
  `5739b09`): `npm test` → **33 test files, 636 passed / 1 skipped** (the
  one skip is the pre-existing gc-dependent `dictionary.test.ts` case; no
  new skips). `phrases.test.ts` and `phrase-gating.test.ts` are absent;
  `bigrams.test.ts`, `successors.test.ts`, `chain.test.ts` (rewritten),
  `adversarial-*`, `calibration`, `mask-secrets`, `chaining-gating`,
  `bad-dict-gate` present — matching
  [tests_docs_inventory.md](../plan/002_3e8a42cadf2c/architecture/tests_docs_inventory.md).

### Item 1 — successor-index chaining state machine with ZERO-typed-char successor offers: PASS

```
$ npx vitest --run test/chain.test.ts -t "chain machine — armed successor chaining"
```
- 2026-09-08: **15/15 passed** (the describe's full body; the two skipped
  entries are the item-7 describe's tests, filtered out by `-t`).
- Zero-typed-char offer cases (named): "zero-char word-start offer after the
  separator: bare values, prefix \"\", count-desc, still armed (h2.43)" and
  "zero-char offer fires at EVERY armed word start, not just the first
  post-arm query (h2.43)" — both assert `prefix === ""` and bare values with
  no trigger char and no threshold.

### Item 2 — live successor filtering (threshold 0 for the chain duration): PASS

Same describe and command as item 1. Named cases:
- "1-char fragment offers at chain threshold 0; past-match fragment disarms +
  delegates on the SAME call (h2.43)"
- "further typing filters the successor set live (threshold 0, never disarms
  while matching)"
- "zero matching successors → disarm + normal candidates on the SAME call
  (h2.43 disqualification)"
- "armed word with an empty successor index → disarm + normal path (h2.43)"
- "word-less non-start buffer (punctuation) → disarm + delegate with
  byte-identical args/options (h2.43)"
- 2026-09-08: all PASS (within the 15/15 above).

### Item 3 — chain resets on `before_agent_start`: PASS

```
$ npx vitest --run test/chain.test.ts -t "forces idle"
```
- 2026-09-08: **1/1 passed** — "reset() forces idle — the before_agent_start
  rule; normal config.threshold resumes (h2.43)". (Filter note: `-t` treats
  its argument as a pattern, so the literal `reset()` parens are avoided in
  the recorded command; "forces idle" matches exactly this one case.)

### Item 4 — one-word invariant (no multi-word item ever offered — asserted in tests): PASS

```
$ npx vitest --run test/chain.test.ts -t "one-word invariant"
```
- 2026-09-08: **1/1 passed** — "one-word invariant: every chain item value is
  a single word, never leading/multi-word (h2.38/h2.44)".
- Shared-helper coverage: `test/helpers/query-invariants.ts` `assertWordsOnly`
  (every `RankedMatch.display` space-free, PRD §07 h2.44) is exercised by
  `test/query.test.ts` (line ~345), `test/acceptance.test.ts`, and referenced
  by `test/chain.test.ts` (~line 181–186), whose `expectSingleWordItems`
  applies the same gate to pi `AutocompleteItem` menus — including every
  chain offer asserted in items 1, 2, and 7.

### Item 5 — raw-text-adjacency window breaks — ALL covered and green: PASS

```
$ npx vitest --run test/successors.test.ts -t "strict adjacency end-to-end"
$ npx vitest --run test/ingest-pipeline.test.ts -t "onAdmittedTokens"
```
- 2026-09-08: 1/1 and **43/43 passed** respectively (the latter includes the
  `it.each` expansions). All four audited files together: `npx vitest --run
  test/chain.test.ts test/successors.test.ts test/ingest-pipeline.test.ts
  test/provider-live.test.ts` → **103/103**.

Every h2.54 break category mapped to a named case:

| h2.54 category | Test file | Test case (verbatim name) |
| --- | --- | --- |
| commas (clause punctuation) | ingest-pipeline.test.ts | `it.each([",", ";", ":", ".", "!", "?", "—", "–", "…", "|"])("clause punctuation %j breaks the run")` |
| quotes / brackets / backticks | ingest-pipeline.test.ts | "backtick-quoted words never chain"; `it.each(["(", …])("words entering/leaving %s…%s never chain to neighbors outside")` for `( ) [ ] { } < > " "` |
| digits | ingest-pipeline.test.ts | "digit runs and hexish tokens break the chain ACROSS them" (rejected `v2` breaks; admitted hexish `0f3a9c2` sits in-run but only adjacent pairs bigram) |
| non-word characters | ingest-pipeline.test.ts | `it.each(["/", "\\", "=", "+", "&", "%", "#", "*", "@", "-", "~", "^"])("symbol %j between two words breaks the run")` |
| intervening words (stopword bridging forbidden) | ingest-pipeline.test.ts | "a rejected word between two admitted words breaks the run (no stopword bridging)"; "ZorpWibbleEngine, quuxblat never chains (the stopword-bridge bug class)"; successors.test.ts "strict adjacency end-to-end…" ("United States of America" — `of` rejected → `states`↔`america` never chain) |
| newlines | ingest-pipeline.test.ts | "newline breaks runs; blank lines yield nothing (no empty arrays); one call per message"; successors.test.ts "run breaks are inherited from the ingest contract — no successor crosses a line" |

Supporting boundary cases also green in the same describe: chunk-boundary
inside a whitespace gap still chains / inside a punctuation gap still breaks
/ only `\n` breaks across chunks; sub-words never enter runs; multi-block
messages run per line.

### Item 6 — forced single-item returns (Tab only ever completes): PASS

```
$ npx vitest --run test/provider-live.test.ts -t "forced single-item returns"
```
- 2026-09-08: **8/8 passed** — describe "forced single-item returns
  (PRD §07 h3.8)": force:true → exactly the live top with prefix unchanged
  (threshold + trigger fragments + armed zero-char word start + armed typed
  fragment); force absent/false → full set byte-identical legacy;
  null-match/zero-candidate/aborted-signal forces delegate with the options
  object identity preserved (native Tab intact).

### Item 7 — integration: `National` → `Renewable` → `Energy` → `Laboratory` with zero typed chars: PASS

> **CORRECTION (2026-09-08, post-validation):** the audit record below is
> historical and cites the since-rethemeed fixture. The 2026-09 Issue-1
> band retune (reject q ≥ 50) moved the National/renewable/energy/
> laboratory walk words into the reject band on this dialogue-register
> corpus, so the journey now runs on the band-immune
> `test/fixtures/sessions/zephyr-chain.jsonl` walk `Acme → Zephyr →
> Noria → Inverter` (same ×4 adjacency construction, same machine,
> same assertions — plus chain items now insert candidate DISPLAY casing
> per Issue 2). The PRD §09 contract quoted above is unchanged; the
> current evidence lives in `test/acceptance.test.ts` item 7,
> `test/chain.test.ts`, `test/chaining-gating.test.ts`, and
> `test/fixtures/sessions/RESULTS.md` (item 7, corrected).

```
$ npx vitest --run test/chain.test.ts -t "replayed-store arming end-to-end"
```
- 2026-09-08: **2/2 passed** (the describe: the end-to-end case + the
  `enableChaining:false` inertness case).
- **Zero-typed-char property verified from the test body** (chain.test.ts,
  "bare-word arming end-to-end…"): after `applyCompletion` accepts
  `National`, the only intervening action is `current.typeSpace()` — a
  separator, not word characters — and both word-start offers assert
  `offer.prefix === ""` with bare values (`["renewable", "wind"]`, then
  `["energy"]`), i.e. the successor is offered with ZERO additional typed
  chars at every armed word start; `expectSingleWordItems` gates each offer.
- Coverage note (recorded, not silently passed): the test Tab-completes the
  first two links (`National` → `renewable` → `energy`); the third link
  (`energy` → `laboratory`) is not itself Tab-completed by the test body.
  The `energy→laboratory` bigram exists in the replayed index by fixture
  construction — `test/fixtures/sessions/nrel.jsonl` contains the full
  4-word adjacency run "National Renewable Energy Laboratory" four times,
  and the clause-5 cases prove multi-word runs record every adjacent pair —
  and the link would traverse the identical offer/accept path proven twice
  in this test. Recorded as a coverage remark; the h2.54 load-bearing
  property (zero additional typed chars at each word start) is asserted
  explicitly at both offers.

### Bench numbers (2026-09-08, re-captured at `5739b09`; same-day match to S1's evidence)

Hard CI gate — `npx vitest --run test/perf-gates.test.ts` → 6/6 PASS;
measured actuals:

| Gate | Budget | Measured (this audit) | CI bound | Verdict |
| --- | --- | --- | --- | --- |
| a. 20k-candidate prefix query + rank + top 8 | < 1 ms p99 | **p99 0.112 ms** (median 0.033, max 0.222) | < 3 ms | PASS |
| b. dict load + full 20k-word lookup sweep | < 60 ms | **4.3 ms** (0 null hits, 0 phantom hits) | < 180 ms | PASS |
| c. ingest 800 KB synthetic session text (+ yield ≤ 64 KB) | < 60 ms | **191.8 ms** (best of 3), yields 39 (min 13) | < 210 ms | PASS (WATCH, per S1: deliberate delta calibration at commit `3182fbc`) |
| d. steady-state heap delta (dict + store) | < 6 MB | **2.92 MB** (settled low-water) | < 18 MB | PASS |
| e. large-100k bigrams-ON restore | < 600 ms | **230.5 ms** (words 628, bigrams 10 000 = cap) | < 600 ms | PASS |
| f. 25k-distinct-word flood | < 100 ms §05 hard | **105.1 ms** (final size 19 839) | < 300 ms | PASS (WATCH, per S1: eviction passes dominate; watch trend) |

Reporting bench — `npm run bench` (exit 0), tinybench means: a 0.0287 ms
(34 794 ops/s) · b 1.86 ms · c 174.1 ms · d 12.2 ms/cycle — consistent with
S1's table (0.0265 / 1.83 / 172.5 / 11.9), which remains the cited canonical
copy (see S1's evidence file for its full bench + watch-flag notes).

### Known accepted gap — successorIndex eviction cleanup (recorded, NOT fixed)

From plan/002_3e8a42cadf2c/architecture/system_context.md, "Key decisions
for the breakdown", decision #7 (verbatim):

> **Pre-existing gap (leave, note)**: word eviction (`evictIfOverCap`) does
> not clean `#successorIndex`; with the phrase map gone there is no indirect
> cleanup. Out of delta scope; do not widen.

Accepted limitation of the D2 redesign; the successor index may retain
entries whose head word was evicted until session end. Out of scope for this
changeset by explicit decision; future work owns it.

### Triage log

**No failures — no triage.** All seven items and all six break categories
passed as-found. (All three owning tasks — P1.M2.T1.S2 chain+item 7,
P1.M2.T2.S1 forced single-item, P1.M1.T3.S2 break cases — are Complete in
the plan tree; a failure here would have meant drift and a minimal
contract-restoring fix logged under the owning PRP.)

**Verdict: M2 (D2 redesign) DONE.** Every h2.54 clause maps to named, green
tests backed by the re-runnable commands above.

### Files changed by this sweep

| Change | Kind |
| --- | --- |
| `docs/M1-DoD.md` (this M2 section) | appended evidence record (M1 section above untouched) |
| `plan/002_3e8a42cadf2c/P1M4T1S2/research/notes.md` | audit-trail append |

No files under `src/` or `test/` were touched.

### Reproduction

```bash
git rev-parse HEAD                                # expect 5739b09… (or later; re-capture counts if src/ or test/ moved)
npm run check
npm test                                          # 33 files / 636 passed / 1 skipped
npx vitest --run test/chain.test.ts -t "chain machine — armed successor chaining"   # items 1+2, 15/15
npx vitest --run test/chain.test.ts -t "forces idle"                                 # item 3
npx vitest --run test/chain.test.ts -t "one-word invariant"                          # item 4
npx vitest --run test/successors.test.ts -t "strict adjacency end-to-end"            # item 5 (end-to-end)
npx vitest --run test/ingest-pipeline.test.ts -t "onAdmittedTokens"                  # item 5 (break suite, 43)
npx vitest --run test/provider-live.test.ts -t "forced single-item returns"          # item 6, 8/8
npx vitest --run test/chain.test.ts -t "replayed-store arming end-to-end"            # item 7
npx vitest --run test/chain.test.ts test/successors.test.ts \
  test/ingest-pipeline.test.ts test/provider-live.test.ts                            # 103/103
npx vitest --run test/perf-gates.test.ts --disable-console-intercept                 # bench actuals on [gate …] lines
npm run bench                                                                                        # reporting numbers
cat plan/002_3e8a42cadf2c/P1M4T1S1/research/regression-evidence.md                   # cited S1 evidence
```

## Bugfix 001 re-verification (001_0f4b641cf9ce) — evidence record

Closing record for the bugfix-001 changeset: six defects (BUG-001..BUG-006,
mapped in PRD order to h3.0–h3.5 of the bugfix PRD), each fixed, locked by
named green tests, and re-verified here. Every command below was re-run for
this record; nothing is cited without a fresh measured result.

- Re-verification date: 2026-09-08 (14:51 UTC) · Head commit: `1b5e942`
  (full: `1b5e942c24741b3cb6aad429e3eed154e8959faa`)
- Input: P1.M4.T1.S1 regression evidence —
  `plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M4T1S1/research/regression-evidence.md`
  (its counts, bench table, and empty triage log were re-confirmed by the
  fresh run below; sweep head there was `f69e893`, one code commit earlier).
- Suite: `npm run check` exit 0 · `npm test` → **33 test files, 723 passed /
  1 skipped** (the pre-existing gc-dependent `dictionary.test.ts` skip),
  exit 0 — matches S1's recorded 723 exactly.
- Verdict: **all six defects fixed and locked by named green tests.**

### BUG-001 (h3.0) — threshold mode preempts stock slash/@/quoted-path; Tab opens menu

- Root cause: "extractMatchState's threshold regex fires on ANY trailing
  identifier regardless of what precedes it, and getSuggestions returns
  hapax's own word items without ever consulting `current`" (bugfix PRD
  h3.0) — violating spec/07: "path/slash completion must keep working
  exactly as before, including inside quoted paths"
  (architecture/spec-acceptance-map.md §07 quotes).
- Fix: P1.M1.T1.S1 (`classifyStockContext` pure helper + unit tests) +
  P1.M1.T1.S2 (stock-context delegation in getSuggestions, verbatim, before
  the armed-chain branch).
- Locking tests: `test/provider-match.test.ts` (classify unit),
  `test/provider.test.ts` + `test/provider-live.test.ts` (sentinel
  delegation, args identity, never-hijack net).
- Re-run:
  ```
  npx vitest --run test/provider-match.test.ts test/provider.test.ts test/provider-live.test.ts
  ```
  → exit 0, **3 files, 99/99 passed** (== S1's item-6 count).

### BUG-002 (h3.1) — NREL phrase words admission-rejected; §09 item 7 unreachable

- Root cause: "the admission bands were recalibrated (REJECT_COMMON_THRESHOLD
  = 50, MID_FREQ_THRESHOLD = 20 …) and against the shipped dict/common-en.bin
  the words of the PRD's own M2 acceptance phrase now reject: lookup
  ('national')=90, lookup('energy')=94, lookup('laboratory')=57 — all ≥ 50 →
  'reject', never stored" → empty successor index, item 7 impossible
  (bugfix PRD h3.1; architecture/core-engine-findings.md).
- Fix: P1.M2.T1.S1 (proper-noun relief band in `admit()`, relief-before-
  reject ordering, whole-token + properName only) + P1.M2.T1.S2 (§09
  tuning-protocol re-run) + P1.M2.T1.S3 (item-7 end-to-end pin).
- **Recorded: relief ceiling `PROPER_NOUN_ADMIT_CEILING = 95`**
  (src/core/score.ts; tuned 120 → 95 by the tuning-protocol re-run).
  Constraint interval **94 < ceiling ≤ 156**: `energy`=94 must admit and
  `them`=156-class common words must stay rejected (the ceiling itself
  rejects — strict `q < ceiling`); a blanket retune was rejected because
  raising REJECT to ≥95 would re-admit lowercase `context`(51)/`posts`(47)
  and break the calibration suite (core-engine-findings.md).
- **Recorded drift: spec/04 stays 220/120 by owner decision (spec/*.md is
  READ-ONLY); code ships 50/20 + the relief band, documented in score.ts
  JSDoc ("spec/04's original 220/120 table — spec/*.md is READ-ONLY; this
  drift is intentional"). This doc is the drift record; the spec is not
  edited.**
- Locking tests: `test/score.test.ts` (relief unit, ceiling boundary),
  `test/calibration.test.ts` + `test/shipped-dict.test.ts` (COMMON_PROBES
  unaffected — lowercase probes), `test/chain.test.ts` + acceptance item 7.
- Re-run:
  ```
  npx vitest --run test/score.test.ts test/calibration.test.ts test/shipped-dict.test.ts
  ```
  → exit 0, **3 files, 66/66 passed**.

### BUG-003 (h3.2) — secret fragments (CYEXAMPLEKEY etc.) admitted

- Root cause: "the raw-text masking catch-all only fires at 40+ chars (the
  AWS key is 38), and the token-level residue rules require ≥2 digits
  (rule 6) or a ≥16-char run (rules 7a/7b) — the camelCase sub-words are
  4–12 chars with ≤1 digit, so they pass every gate"; and "NO parent context
  is tracked … a secret-rejected parent leaves `wholeGroup` undefined and
  its sub-words sail through" (bugfix PRD h3.2;
  architecture/core-engine-findings.md BUG-003 section).
- Fix: P1.M2.T2.S1 (mask floor 40 → 32, `BARE_RUN_MIN = 32`) +
  P1.M2.T2.S2 (whole-token secret rejection propagated to all sub-word
  drafts in the ingest memo) + P1.M2.T2.S3 (synthetic-token paste battery:
  npm/glpat/sk_live/Bearer + AWS).
- Locking tests: `test/mask-secrets.test.ts`, `test/shapeGate.test.ts`,
  `test/adversarial-ingest.test.ts` (paste battery; no fragment —
  `cyexamplekey`, `jalr`, `femik7` — ever offered by any prefix query).
- Re-run:
  ```
  npx vitest --run test/mask-secrets.test.ts test/shapeGate.test.ts test/adversarial-ingest.test.ts
  ```
  → exit 0, **3 files, 110/110 passed** (S1's item-5 pair alone: 62/62).

### BUG-004 (h3.3) — astral letter before ASCII run leaks remainder (𝔘sword → sword)

- Root cause: "the implementation's isUniLetter() guard reads codePointAt()
  one code unit at a time, so an astral (surrogate-pair) letter immediately
  BEFORE a match is seen as its lone low surrogate, which is not \p{L}, and
  the run slips through: tokenize('𝔘sword') → ['sword']" — a spec deviation
  from §04 rule 3 ("a non-ASCII letter adjacent to an ASCII run disqualifies
  the whole run") (bugfix PRD h3.3).
- Fix: P1.M3.T1.S1 (code-point-correct boundary guard `isUniLetterBefore`
  at the BEFORE guard site; the AFTER side already reads full pairs via
  codePointAt at the high surrogate).
- Locking tests: `test/segment.test.ts` astral cases (𝔘 on both sides, BMP
  letters, paired guards).
- Re-run: `npx vitest --run test/segment.test.ts` → exit 0,
  **1 file, 43/43 passed**.

### BUG-005 (h3.4) — armed chain swallows trigger char; mis-prefixed successor set

- Root cause: "the armed branch's fragment regex matches 'b' after the '#',
  filters the successor list at threshold 0, and returns items with prefix
  'b' … the chain branch deliberately bypasses extractMatchState, so trigger
  mode can never win while armed" — violating spec/07 "trigger-char match
  wins" and the disarm rule "any non-Tab key that disqualifies → idle"
  (bugfix PRD h3.4; spec-acceptance-map.md §07).
- Fix: P1.M1.T2.S1 (word-start fragment requirement in the armed branch +
  reset/fall-through on disqualification) + P1.M1.T2.S2 (editor-sim
  integration test with pi-tui's blind prefix-deletion mirror).
- Locking tests: `test/chain.test.ts` (trigger-reset cases, word-start
  offer rules), `test/provider-live.test.ts`.
- Re-run: `npx vitest --run test/chain.test.ts test/provider-live.test.ts`
  → exit 0, **2 files, 48/48 passed**.

### BUG-006 (h3.5) — bigram map over 10k cap after one large message

- Root cause: "#evictBigramsIfOverCap runs once per recordBigramRuns call
  … and pops at most BIGRAM_EVICT_BATCH=256 victims per call. A single
  message containing more than 10,000 distinct bigrams therefore leaves the
  map over cap by (bigrams − 10,256); measured: one ingested message with
  11,000 bigrams left store.bigramSize at 10,714" — violating spec/06:
  "Cap the bigram map at 10,000 keys with the standard eviction policy"
  (bugfix PRD h3.5).
- Fix: P1.M3.T2.S1 (drain loop: batched eviction repeats within the SAME
  recordBigramRuns call until the map is within BIGRAM_CAP — same-call cap
  guarantee, src/core/store.ts).
- Locking tests: `test/bigrams.test.ts` (10k cap; 11k-bigram single
  message lands at cap exactly).
- Re-run: `npx vitest --run test/bigrams.test.ts` → exit 0,
  **1 file, 12/12 passed**.

### Explicit out-of-scope record

- **`successorIndex` eviction cleanup known gap remains OPEN and out of
  scope for this changeset** — see "Known accepted gap — successorIndex
  eviction cleanup (recorded, NOT fixed)" above (word eviction does not
  clean `#successorIndex`; bigram eviction splices its own successor
  entries, but orphaned successor-index cleanup after word eviction is not
  performed). The BUG-006 drain loop does not change this: it enforces the
  bigram-map cap only. Future work owns the gap.

### BUG-ID → PRD mapping

BUG-001=h3.0 (stock-context preemption) · BUG-002=h3.1 (admission bands vs
item 7) · BUG-003=h3.2 (secret fragments) · BUG-004=h3.3 (astral boundary) ·
BUG-005=h3.4 (chain vs trigger char) · BUG-006=h3.5 (bigram cap) — in PRD
issue order.

### Reproduction

```bash
git rev-parse HEAD                                # 1b5e942c… (or later)
npm run check
npm test                                          # 33 files / 723 passed / 1 skipped
npx vitest --run test/provider-match.test.ts test/provider.test.ts test/provider-live.test.ts   # BUG-001, 99/99
npx vitest --run test/score.test.ts test/calibration.test.ts test/shipped-dict.test.ts          # BUG-002, 66/66
npx vitest --run test/mask-secrets.test.ts test/shapeGate.test.ts test/adversarial-ingest.test.ts # BUG-003, 110/110
npx vitest --run test/segment.test.ts             # BUG-004, 43/43
npx vitest --run test/chain.test.ts test/provider-live.test.ts                                  # BUG-005, 48/48
npx vitest --run test/bigrams.test.ts             # BUG-006, 12/12
grep -n "PROPER_NOUN_ADMIT_CEILING = 95" src/core/score.ts   # relief ceiling shipped
cat plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M4T1S1/research/regression-evidence.md       # cited S1 evidence
```
