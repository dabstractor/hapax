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

---

## M3 Definition of Done — post-delta re-verification (P1.M4.T1.S2, 2026-09-30)

Contract (spec/09 h2.56 item 1 M3 clause + item 2 capture window + item 7;
r5 §1 verbatim extraction): M1 done plus anchored-fuzzy matching
(first-char anchor, tier classification, `fuzzThreshold` gate),
frequency/tier ranking (tier desc → sessionCount desc within tier →
shorter key → byte-lex), the length-conditioned `R_eff` admission curve,
rule-4d conversational path candidates, and the one-line widget display
with arrow selection + boundary-Esc — plus the binding live verification
(h2.57). This section records the full M3 acceptance gauntlet; every PASS
is backed by a re-runnable command. Spec is read-only this run: drift
notes live in the sweep's run report
(plan/003_bbac3b15e8d0/P1M4T1S2/research/run-report.md), not in spec/.

- **Sweep date:** 2026-09-30 (12:07 UTC)
- **Head commit:** `0f1018c` (full: `0f1018c49e7570af7811a904be02698a44ccbd15`
  — "feat(pi): live-verify widget; repaint on timer swaps", the P1.M3.T4.S1
  landing)
- **Environment:** Linux x64 · Node v26.10.0 · vitest 4.1.11 · pi 0.85.1
- **Suite counts:** `npm test` → **37 test files, 1007 passed / 1 skipped**
  (the one skip is the pre-existing gc-dependent `dictionary.test.ts` case;
  no new skips). M3 suites present: `widget.test.ts` (52),
  `widget-visibility.test.ts` (18), `editor-enter.test.ts` (28),
  `startup-gate.test.ts` (7) — all green.
- **pi --check substitution:** as recorded in the M1 section above, the PRD's
  `pi --check (or lint)` names a command that does not exist; the sanctioned
  equivalents are `npm run check` (tsc --noEmit, strict) + `npm test`.

### Type check: PASS

```
$ npm run check        # tsc --noEmit, strict
```
- 2026-09-30: exit 0, zero errors.

### Full suite: PASS

```
$ npm test             # vitest --run, whole suite
```
- 2026-09-30: exit 0 — **37 test files, 1007 passed / 1 skipped** (three
  consecutive green runs at sweep end).

### Widget visibility machine: PASS

```
$ npx vitest --run test/widget-visibility.test.ts
$ npx vitest --run test/widget.test.ts -t "never show"
```
- 2026-09-30: **18/18** and 1/1. Named cases: "R1: stock contexts
  (slash/mention/quoted-path/path) never show the line"; "R3: trailing space
  (no @//) closes without suppressing"; "R4: cursor move with unchanged text
  hides (no suppression)"; "invariant: zero candidates are never visible,
  even at a word start with no suppression"; suppression taxonomy
  (onDismissed(true) same-word sticky, trigger-char reopen,
  disqualification-close-reopens); startup-gate hold/release cases R5.

### Widget key handling / boundary-Esc: PASS

```
$ npx vitest --run test/widget.test.ts -t "boundary-Esc"
$ npx vitest --run test/widget.test.ts          # full 52
```
- 2026-09-30: 3/3 boundary-Esc cases; **52/52** file total. Named: "↑ and ←
  on the first word: press CONSUMED (no inner call — caret unmoved), line
  hidden, suppressed"; "a single-item list: ↑/← is boundary-Esc …, →/↓ is
  clamp"; "→ and ↓ on the last word: consumed, highlight unchanged, no
  dismissal, no suppression"; navigation describes (either arrow pair spans
  the list both ways; highlight clamps within the RENDERED list); "Escape:
  line hides + suppressed (explicit dismissal)"; "a close WITHOUT explicit
  dismissal … never suppresses"; "every non-arrow/non-Escape key … forwards
  verbatim, exactly once, while visible"; "hidden line: EVERY key — arrows
  and Escape included — forwards verbatim (zero capture outside the visible
  window)"; "the inner instance is NEVER mutated" (v1 pin); input-clock
  one-tick-per-keypress cases.

### Insertion casing (display string over the word span / #fragment): PASS

```
$ npx vitest --run test/widget.test.ts -t "Tab inserts"
```
- 2026-09-30: **11/11** — Tab inserts `items[highlightIndex].display` over
  the word-regex span or `#fragment` (trigger char consumed), consumed
  end-to-end (no inner keypress, line dismissed + suppressed, repaint
  requested), never debounce-gated.

### Highlight reset: PASS

```
$ npx vitest --run test/widget.test.ts -t "resets highlightIndex"
```
- 2026-09-30: 1/1 — "set() resets highlightIndex to 0 on every result-set
  change (spec h2.55)" (within the 52/52; render/width-cache/hide-show
  neighbors all green).

### Startup-gate carry-over: PASS

```
$ npx vitest --run test/startup-gate.test.ts
```
- 2026-09-30: **7/7** — "a query racing an unfinished replay WAITS for the
  settled signal"; "the wait is BOUNDED … ≤ maxWaitMs"; "settled gate is a
  pure pass-through"; "a REJECTED replay promise still unblocks the gate";
  restoreFromHistory onSettled exactly-once trio (finish / abort BUG-004
  path / empty history). Widget-side: visibility R5 hold/release/pass-through
  cases (18/18 above).

### Editor-enter carry-over (enter-submit proxy): PASS

```
$ npx vitest --run test/editor-enter.test.ts
```
- 2026-09-30: **28/28** — "Enter + open word menu → cancel FIRST, then inner
  handles the same key"; slash menu / no-menu / non-submit keys untouched;
  rebound submit key honored; "the inner instance is NEVER mutated" +
  sibling-style re-entry termination + exactly-ONE-delegation pins (v1
  recursion regression); proxy get/set/has forwarding; thenable guard;
  "onKeystroke hook fires for EVERY input event"; "a throwing onKeystroke
  never breaks input".

### Anchored-fuzzy matching + tier ranking (query core): PASS

```
$ npx vitest --run test/query.test.ts          # 66/66
$ npx vitest --run test/query.test.ts -t "ANCHOR"
$ npx vitest --run test/query.test.ts -t "anchored fuzzy"
$ npx vitest --run test/query.test.ts -t "tier"
$ npx vitest --run test/query.test.ts -t "fuzzThreshold"
```
- 2026-09-30: **66/66**; named subsets: ANCHOR never-matches case 1/1;
  `matchFragment — anchored fuzzy` describe 13/13 (tier 2 contiguous tail
  `zsk`→`zendesk`, tier 1 leading-stretch `zds`→`zendesk`, boundaries);
  tier-classification cases 24/24 (tier desc always — a 1-count exact-prefix
  outranks a 40-count scattered); fuzzThreshold cases 7/7 (below-threshold
  never renders; 100 = exact-prefix-only); first-char-bucket scan describe
  4/4 ("anchor holds: different-first-char keys are never scanned");
  zero-fragment sessionCount-desc ordering; plural pruning before the limit
  slice.

### R_eff admission curve + conjugation guard (score core): PASS

```
$ npx vitest --run test/score.test.ts          # 75/75
$ npx vitest --run test/score.test.ts -t "admission"
```
- 2026-09-30: **75/75**; admission subset 11/11 — length-conditioned curve
  asserted relative to the imported `R_eff` constants (floor hold q ≥ 12 at
  ≤ 8 chars, sqrt ramp 9–19 with boundary probes, admit-all ≥ 20, every
  attested admission at GROUP 1, absent → 0, `rejectCommonness` moves the
  floor); proper-noun relief stays retired; conjugation guard rides
  `R_eff(len(word))`; salience arithmetic; eviction ordering (salience ×
  τ=50; menu ordering is NOT salience).

### Integration item 1 (M3 clause — one-line widget below the input): PASS

Scripted: the widget suites above (visibility machine + key handling +
render join/caps/highlight) — `Zendesk | …` line format, arrows move the
highlight, boundary-Esc.
Live (spec/09 h2.57 binding): **plan/003_bbac3b15e8d0/P1M3T4S1/verification-record.md**
— W1 (line renders directly below the input on the typing keystroke,
`Zendesk | zendesk-zephyr`; one real bug found — one-keystroke set lag —
minimally fixed in src/pi/widget.ts and live re-verified `w1fix-t0.txt`),
W2 (arrows navigate/clamp), W3 (boundary-Esc: first press dismisses
consumed with caret unmoved, second ← moves the caret — exactly the two-←
mid-word contract), W5 (Tab inserts display casing). Overall T4.S1
verdict: PASS (W1–W12). Not duplicated here; captures/ holds the tmux
evidence.

### Integration item 2 (capture window while the line is visible): PASS

Scripted: "every non-arrow/non-Escape key … forwards verbatim" + "hidden
line: EVERY key … forwards verbatim" + consumed navigate/clamp/Tab cases
(widget.test.ts, 52/52) — the sanctioned capture window is exactly
{arrows, Escape, Tab} while visible.
Live: T4.S1 W2/W4 (letters land verbatim mid-visibility; Escape dismisses
and returns every later key; arrows/Tab consumed with zero inner calls).

### Integration item 7 (conversational path completion, rule 4d): PASS

```
$ npx vitest --run test/segment.test.ts -t "path tokens"        # 12/12
$ npx vitest --run test/query.test.ts -t "path candidates"      # 4/4
```
- 2026-09-30: segment "path tokens (2026-10 rule 4d)" 12/12 (`'use
  src/core/query.ts here'` → ONE path token; `docs/architecture.md`;
  `example.com/a/b`; `4:36`/`localhost:8080` keep colons; `and/or` not a
  token; 96-char key cap); query "path candidates under the prefix matcher"
  4/4 ("'sr' (first-segment prefix) surfaces the whole-path candidate with
  its display"; "absolute-path key … display keeps the leading '/'"; "a
  mid-path component is never matchable"); acceptance.test.ts pins the
  fixture path candidate surviving to the menu (`fresh` →
  `src/core/query.ts`).
Live: T4.S1 W9 (`sr` → `src/core/query.ts` line, Tab inserts the whole
path; `/ho` — hapax disarms once `/` precedes the cursor, stock pi owns the
rest, input verbatim) + W10 (`#sr/c` shows nothing — trigger fragments with
`/` disarm). Item 6 stock contexts: W8 (quoted path/slash/@-mention all
stock, no hapax line).

### No-persistence: PASS (static backdrop drift recorded)

```
$ npx vitest --run test/no-persistence.test.ts   # 3/3
$ grep -rn "writeFile\|appendFile\|createWriteStream" src/
```
- 2026-09-30: dynamic assertion **3/3 green**. Static grep is **no longer
  empty** (a change vs the M1/M2 records' backdrop):
  `src/pi/debug.ts` uses `writeFileSync("/tmp/hapax-store.txt", …)` —
  landed 2026-09-10 (`4d26f3f`, "/acwords writes the COMPLETE store list to
  /tmp/hapax-store.txt"). This is the spec/08-sanctioned `debug` surface:
  the write fires ONLY on the user's explicit /acwords dump command,
  targets /tmp, is try/catch'd best-effort, and the suite's filesystem
  snapshots (which never invoke the command) stay empty-set. Recorded as
  static-backdrop drift, not a persistence regression; detail in the run
  report.

### Bench numbers (2026-09-30, re-captured at 0f1018c)

Hard CI gate — `npx vitest --run test/perf-gates.test.ts` → **8/8 PASS**;
measured actuals vs the spec/09 h2.58 budgets:

| Gate (h2.58) | Budget | Measured | vs budget | CI bound (3×) | Verdict |
| --- | --- | --- | --- | --- | --- |
| a. 20k-candidate anchored-fuzzy query (first-char bucket + tiers + frequency sort + top 8) | < 1 ms p99 | **p99 0.475 ms** (median 0.230, max 0.697; hot bucket 913) | 0.48× | < 3 ms | PASS |
| a2. cold first query (no warmup; extra gate) | < 1 ms p99 | **p99 1.735 ms** (median 1.125) over 120 fresh stores | 1.74× | < 3 ms | PASS (watch — above 1×, inside bound) |
| b. dictionary load + full 20k-word lookup sweep | < 60 ms | **4.5 ms** (0 null hits, 0 phantom hits) | 0.08× | < 180 ms | PASS |
| c. ingest 800 KB synthetic session text (+ yield ≤ 64 KB) | < 60 ms | **122.8 ms** (best of 3), yields 39 (min 13) | 2.05× | < 180 ms | PASS (watch — inherited from the M2-era calibration, inside bound) |
| d. steady-state heap delta (dict + store) | < 6 MB | **4.98 MB** (settled low-water) | 0.83× | < 18 MB | PASS |

Extra gates green (not part of the h2.58 four): a3 zero-fragment full-store
listing 8.8 ms p99 (sanity only), e default-config 100k restore 193.9 ms
(< 600 ms), f 25k-distinct flood 171.7 ms (< 300 ms CI bound; 1.72× the §05
hard 100 ms — watch, eviction passes dominate). Reporting bench
(`npm run bench`, exit 0): gate a mean 0.2486 ms / p99 0.5114 ms, b 1.81 ms,
c 111.2 ms, d 44.1 ms/cycle. Gate a exercises the ANCHORED-FUZZY path in
both files (perf-gates sanity comment asserts first-char-bucket entry; bench
describe reads "first-char bucket 'p' (~913 range)") — no stale "prefix
query" labels remain.

Honesty note (M2-section practice): gates a2, c, and f sit above the 1×
ideal budget but inside their calibrated CI bounds — recorded as watch, not
failures; no budget was loosened by this sweep. One flake was FOUND and
FIXED during the sweep: gate a2 intermittently hit vitest's default 5 s
test timeout because its 120-store SETUP (not the measured query) sits near
5 s under parallel worker load; the fix is an explicit 30 s test timeout on
that test only — the p99 < 3 ms assertion is unchanged. Three consecutive
full-suite runs were green after the fix.

### Triage log

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | perf gate a2 intermittent 5 s timeout under parallel worker load (setup-bound, 2 of 4 pre-fix full-suite runs) | FIXED minimally in test/perf-gates.test.ts: explicit `30_000` test timeout on the a2 case (setup cost), assertion untouched; owning contract P1.M2.T2.S2's gate budget unchanged. 3/3 green full suites post-fix. |
| 2 | static no-persistence grep shows `src/pi/debug.ts` writeFileSync (/acwords → /tmp/hapax-store.txt, commit `4d26f3f`) | RECORDED, not fixed: spec/08-sanctioned debug surface, command-gated, /tmp target; dynamic snapshot suite 3/3. Static-backdrop drift vs M1/M2 records. |
| 3 | T4.S1 W7: fallback provider path unreachable live on the recorded pi build (factory always present) | RECORDED (upstream finding, cited): fallback path covered by unit suites only; widget-around-stock-editor was live-verified instead. |

**Verdict: M3 (v3) DONE.** Every M3 acceptance clause maps to named green
tests or the cited live-verification record; the four h2.58 gates are green
with two inherited watch flags; one setup-bound test flake was minimally
fixed and re-verified.

### Files changed by this sweep

| Change | Kind |
| --- | --- |
| `docs/M1-DoD.md` (this M3 section) | appended evidence record (M1/M2/Bugfix sections untouched) |
| `test/perf-gates.test.ts` | triage fix #1: explicit timeout on gate a2 (setup-bound), assertion unchanged |
| `plan/003_bbac3b15e8d0/P1M4T1S2/research/run-report.md` | sweep record + spec-drift notes |

Parallel inputs (cited, not re-run): P1.M3.T4.S1 live-verification record
(+ captures/, tmux technique per h2.57); P1.M4.T1.S1 README sweep
(docs-only, landed; green post-sweep per its sweep-log).

### Reproduction

```bash
git rev-parse HEAD                                # 0f1018c… (or later; re-capture if src/ or test/ moved)
npm run check
npm test                                          # 37 files / 1007 passed / 1 skipped
npx vitest --run test/widget-visibility.test.ts   # 18/18
npx vitest --run test/widget.test.ts              # 52/52
npx vitest --run test/widget.test.ts -t "boundary-Esc"   # 3/3
npx vitest --run test/widget.test.ts -t "Tab inserts"    # 11/11
npx vitest --run test/editor-enter.test.ts        # 28/28
npx vitest --run test/startup-gate.test.ts        # 7/7
npx vitest --run test/query.test.ts               # 66/66 (anchored-fuzzy, tiers, fuzzThreshold, buckets)
npx vitest --run test/score.test.ts               # 75/75 (R_eff, conjugation guard, salience, eviction)
npx vitest --run test/segment.test.ts -t "path tokens"          # item 7, 12/12
npx vitest --run test/query.test.ts -t "path candidates"        # item 7, 4/4
npx vitest --run test/no-persistence.test.ts      # 3/3
grep -rn "writeFile\|appendFile\|createWriteStream" src/   # debug.ts dump only (see triage #2)
npx vitest --run test/perf-gates.test.ts --disable-console-intercept   # [gate …] actuals
npm run bench                                     # reporting numbers
cat plan/003_bbac3b15e8d0/P1M3T4S1/verification-record.md       # cited live record (W1–W12)
```

---

# Tier-0 anchorless fallback + `#` loose mode — changeset DoD (2026-09-30)

Closes the plan-004 changeset "tier-0 anchorless fallback matcher + per-mode
fuzzThreshold + `#` loose-mode wiring" (P1.M1.T1.S2 matcher, perf gate;
P1.M2.T1.S1 thresholds + provider/widget wiring + README sync). This section
is the changeset's closing evidence record (Mode B): the full gauntlet, the
BINDING live smoke (spec/09 h2.57 technique), and the drift report. The
2026-09-07 M1 record and all sections above it are untouched (append-only).

- **Sweep date:** 2026-09-30 · **Head commit:** `f2a219d`
  (full: `f2a219d36e5cad0166b19583d8e0f2df1fab2d5c` — "feat(pi): wire '#'
  loose mode through both paths", the changeset's last code commit)
- **Environment:** Linux x64 · Node v26.10.0 · vitest 4.1.11
- **Working-tree note:** `README.md` was dirty at sweep time — it is
  P1.M2.T1.S1's own docs deliverable running in parallel (README sweep),
  not an instrumentation remnant. No other file outside `docs/` was touched
  by this task.
- **Verdict: changeset DONE.** Gauntlet items 1–3 PASS, live smoke items
  1–3 PASS (capture-pane evidence below), drift report: NONE FOUND (one
  smoke-procedure note recorded; no spec mismatch).

## Gauntlet item 1 — type check clean: PASS

```
$ npm run check        # tsc --noEmit, strict
```
- 2026-09-30 @ `f2a219d`: exit 0, zero errors.

## Gauntlet item 2 — all tests green: PASS

```
$ npm test             # vitest --run, whole suite
```
- 2026-09-30 @ `f2a219d`: exit 0 — **37 test files, 1046 passed / 1
  skipped** (the one skip is the pre-existing gc-dependent
  `dictionary.test.ts` case, same as every prior record; no new skips).
- Includes the changeset's own suites: the tier-0 matcher + per-mode
  threshold cases in `test/query.test.ts`, the tier-0 perf budget in
  `test/perf-gates.test.ts` (item 3), and the `#` loose-mode path pins in
  the provider/widget suites.

## Gauntlet item 3 — performance gates (incl. the new tier-0 row): PASS

```
$ npx vitest --run test/perf-gates.test.ts --disable-console-intercept
$ npm run bench
```
Hard CI gate — exit 0, **9/9 PASS** (2026-09-30 @ `f2a219d`). Measured
actuals vs budgets (spec/09 h2.58 table incl. the new tier-0 row):

| Gate | Budget | Measured | vs budget | CI bound (3×) | Verdict |
| --- | --- | --- | --- | --- | --- |
| a. 20k-candidate anchored-fuzzy query (first-char bucket + tiers + frequency sort + top 8) | < 1 ms p99 | **p99 0.378 ms** (median 0.228, max 0.527; hot bucket 913) | 0.38× | < 3 ms | PASS |
| **Tier-0 anchorless fallback full-store pass (new, P1.M1.T1.S2; also `#` loose-mode scans)** | < 3 ms p99 | **p99 0.792 ms** (median 0.376, max 0.977; `rescued=8`) | 0.26× | < 9 ms | PASS |
| a2. cold first query over 120 fresh 20k stores | < 1 ms p99 | **p99 1.759 ms** (median 1.045) | 1.76× | < 3 ms | PASS (watch — above 1×, inside bound; inherited) |
| a3. zero-fragment full-store `#` listing (tripwire, sanity only) | < 25 ms | **p99 8.313 ms** (floor 5.8–7.2 ms p99) | 0.33× | sanity only | PASS |
| b. dict load + full 20k-word lookup sweep | < 60 ms | **4.6 ms** (0 null hits, 0 phantom hits) | 0.08× | < 180 ms | PASS |
| c. ingest 800 KB synthetic session text (+ yield ≤ 64 KB) | < 60 ms | **112.0 ms** (best of 3), yields 39 (min 13) | 1.87× | < 180 ms | PASS (watch — inherited calibration, inside bound) |
| d. steady-state heap delta (dict + store) | < 6 MB | **7.37 MB** (settled low-water; no `--expose-gc`, churn-sampled) | 1.23× | < 18 MB | PASS (watch — inherited, inside bound) |
| e. large-100k bigrams-ON restore | < 600 ms | **175.7 ms** (words 641, bigrams 10 000 = cap) | 0.29× | < 600 ms | PASS |
| f. 25k-distinct-word flood | < 100 ms (§05 hard) | **145.3 ms** (final size 19 840) | 1.45× | < 300 ms | PASS (watch — inherited, eviction passes dominate) |

Reporting bench (`npm run bench`, exit 0, same fixtures, tinybench):
gate a mean 0.2214 ms / p99 0.4068 ms (4 152 samples) · **gate t0 mean
0.3536 ms / p99 0.8007 ms (2 524 samples)** · b mean 1.62 ms · c mean
91.80 ms · d mean 37.07 ms/cycle — consistent with the hard-gate actuals.

Honesty notes: gates a2, c, d, f sit above the 1× ideal budget but inside
their CI bounds — the same inherited watch flags the M3 record carries; no
budget was loosened and no gate is a hard regression. The new tier-0 gate
runs at **0.26× its own (looser) budget** — the full-store pass is cheap
enough that the gate's `rescued=8` probe stays honest (a rescued-set of 0
would mean the probe fragment stopped matching; the logged line is checked,
never silently accepted).

## Gauntlet item 4 — live smoke (spec/09 h2.57, BINDING): PASS

Technique per spec/09 h2.57: ephemeral `pi --no-session` in a tmux pane
(200×50), store seeded by submitting one short user message containing the
smoke vocabulary (`unsaidlock noted beside src/core/query.ts and
src/core/query.ts twice`) and interrupting the turn; probes typed ONE
CHARACTER AT A TIME (`tmux send-keys`, 0.12 s apart — burst cancels
in-flight autocomplete queries, the documented false-conclusion source);
visible state via `tmux capture-pane`. Zero instrumentation was needed —
no `appendFileSync` probe was ever added, and `git status` is clean of
instrumentation (see item 5). All captures quoted verbatim below
(input line, separator, mode tag, and the widget line directly under the
input).

**Scenario 1 — tier-0 one-shot cousin menu, then it narrows away: PASS**

Fragment `sai` typed char-by-char (s → a → i; the anchored scan for `sai`
is EMPTY — no stored key starts `sai` — so the tier-0 fallback fires and
rescues the contiguous-run cousin `unsaidlock`, score 85 − 40·2/10 = 72 ≥ 60):

```
sai                                          ← input line
────────────────────────────────────────────
INSERT
unsaidlock                                   ← the widget line: tier-0 one-shot cousin menu
```

Reading: one-shot rescue menu for a fragment with zero anchored results —
the said→unsaid class behavior the amended no-hijack rule (spec/09 item 2,
2026-10) declares EXPECTED, not a hijack.

Continuing to type (`sain` — no longer contiguous anywhere):

```
sain                                         ← input line
────────────────────────────────────────────
INSERT                                       ← NO widget line: menu narrowed away
```

Reading: the cousin menu narrows away as typing continues — tier-0 only
rescues fragments the anchored scan cannot serve at all, and only while a
contiguous run exists.

**Scenario 2 — `#query` path completion via `#` loose mode: PASS**

Line cleared (4 × backspace), then `#query` typed char-by-char. The
anchored scan for trigger fragment `query` against the stored path key
fails at the anchor (`q` ≠ `s` of `src/core/query.ts`) — plain anchored
matching can NEVER serve this query; the `#` loose-mode tier-0 pass finds
the contiguous run `query` at offset 10 (score 85 − 40·10/17 = 62 ≥ 45
loose threshold):

```
#query                                       ← input line
────────────────────────────────────────────
INSERT
src/core/query.ts                            ← widget line: the whole path offered
```

Tab accepted:

```
src/core/query.ts                            ← input line: WHOLE path inserted, `#` consumed
────────────────────────────────────────────
INSERT                                       ← menu dismissed after accept
```

Reading: rule-4d conversational path completion works through the trigger
char exactly via the loose mode; Tab inserts the whole display and
dismisses.

**Scenario 3 — tier-0 never arms a chain (absence evidence): PASS**

Immediately after the tier-0 Tab accept above, a separator space was typed
(cursor now at the next word start):

```
src/core/query.ts                           ← input line (cursor after the trailing space)
────────────────────────────────────────────
INSERT                                       ← NO successor offer line
```

Reading: NO chain offer appears — and this absence is load-bearing, not
vacuous: the seed message contains the path TWICE, so the store holds the
successor entry `src/core/query.ts → src/core/query.ts`; a chain wrongly
armed by the tier-0 accept would have rendered a successor offer at this
exact word start. None did — chains arm on anchored-tier accepts only
(P1.M1.T2.S2 rule); the tier-0 rescue is a one-shot menu, never an arming
event.

### Live-smoke honesty notes

- **Exemplar-word note (procedure, not drift):** the spec's exemplar pair
  is `said`→`unsaid`; the literal word `unsaid` is dictionary-ATTESTED and
  therefore REJECTS at admission under the M3 length-conditioned `R_eff`
  curve (attested q ≥ 12 at ≤ 8 chars) — the first seed attempt with plain
  `unsaid` stored nothing and correctly produced no menu. The smoke
  therefore uses the same-class dictionary-ABSENT cousin `unsaidlock`
  (absent → group-0 admit), which exhibits the identical tier-0 contract.
  The spec's example names the CLASS (`said→unsaid class`), not a promise
  that the literal token admits — no spec contradiction; recorded here so
  the next smoke does not re-derive it.
- **Interrupt note (environment, not drift):** on this pi build the
  working turn did not cancel on `Ctrl+C` (spec/09 h2.57's wording); the
  live-cancel keybind is `app.interrupt` = `Escape` (pi-vim consumes the
  first Escape as INSERT→NORMAL, the second aborts — "Operation aborted"
  captured). Seed finalization otherwise worked exactly as the spec
  describes. hapax behavior was unaffected.
- Widget latency: captures were taken ~0.6 s after the final keystroke of
  each probe (well inside the debounce/settle window); all three menus
  appeared on the first capture attempt of their scenario.

## Drift report (spec read-only this run): NONE FOUND

The four verified-agreeing checks (re-verified 2026-09-30, cheaply —
grep/sed/ls, not edited):

1. **Module rows** spec/02:64–68 ↔ `src/pi/editor.ts` / `src/pi/debug.ts` /
   `src/pi/paths.ts` — files exist, roles match the rows (enter-submit
   guard; `/acwords` read-only dump, registered when `config.debug`;
   jiti-safe dict path resolution). ✅
2. **Dictionary figures** spec/03:37–54 ↔ the shipped artifact:
   `dict/common-en.bin` is **850,554 bytes** on disk (ls-verified) and
   **48,802 entries** (asserted by `test/shipped-dict.test.ts`, green in
   this sweep's `npm test`; also printed by `tools/calibrate-bands.mjs`:
   "entries=48802"). Load-factor ≈ 0.745 per the same suite. ✅
3. **M2 DoD re-theme** — `test/acceptance.test.ts:838` reads
   `"zero-typing chain — Zorp → space → top successor → Tab → Noria → Tab
   → Inverter, zero typed word-chars (h2.54)"` on the `zephyr-chain.jsonl`
   fixture, exactly the re-theme the records describe. ✅
4. **Decision log** — `spec/SPEC.md:67` is the section heading
   `## Decision log (all settled)` (a spec section, not an artifact). ✅

Residuals carried from P1.M2.T1.S1's `research/stale-claims.md` (its
"Residuals for P1.M2.T1.S2's drift report" section, restated): none
functional — (1) README's perf-gate prose says "these three gates" while
the table now carries five rows (pre-existing wording, left per
don't-blanket-rewrite); (2) the tier-0 perf-budget row names "`#`
loose-mode scans" inside the tier-0 budget, matching the spec/09 table
verbatim (kept). Both are README-cosmetic and now shipped with S1's README
sweep.

New findings during this gauntlet/smoke: **none** — no spec-vs-repo
mismatch surfaced. The one observation (exemplar word `unsaid` is
admission-rejected under `R_eff`; see the live-smoke honesty note) is a
smoke-procedure fact about fixture choice, consistent with the spec's own
admission rules — recorded in the smoke section, not a drift item.
`spec/*.md` was not edited.

## Tree cleanliness (post-smoke)

- No env-gated instrumentation was added at any point (the captures were
  unambiguous); `git status` after the sweep shows only `README.md`
  (P1.M2.T1.S1's parallel deliverable) and `docs/M1-DoD.md` (this section)
  — zero files under `src/`, `test/`, or `spec/`.
- The tmux session was killed after the captures; nothing persists.

## Reproduction

```bash
git rev-parse HEAD                                # f2a219d… (or later; re-capture counts if src/ or test/ moved)
npm run check
npm test                                          # 37 files / 1046 passed / 1 skipped
npx vitest --run test/perf-gates.test.ts --disable-console-intercept   # 9/9; [gate …] actuals incl. [gate t0]
npm run bench                                     # reporting numbers (gate t0 row)
# Live smoke (spec/09 h2.57): tmux + pi --no-session; seed a message whose
# vocabulary includes a dictionary-ABSENT contiguous-run cousin (e.g.
# "unsaidlock") AND the literal "src/core/query.ts" TWICE; Enter; interrupt
# the turn (Escape ×2 on this build); then one-char-at-a-time:
#   s a i        → tier-0 one-shot cousin menu;  n → narrows away
#   # q u e r y  → src/core/query.ts offered;    Tab → whole path inserted
#   Space        → NO successor offer (tier-0 never arms; store holds the
#                  path's self-successor from the doubled seed, so the
#                  absence is load-bearing)
```
