# PRP — P1.M4.T1.S2: M2 DoD item-by-item audit + record results

## Goal

**Feature Goal**: Audit every item of the rewritten M2 Definition of Done
(PRD §09 h2.54) against the D2-redesigned codebase, item by item, with
re-runnable commands and recorded test names — then append a dated
"M2 Definition of Done — post-delta re-verification" section to
`docs/M1-DoD.md` (the doc this changeset touches directly) capturing fresh
suite/file counts after the phrase-layer deletions, bench numbers, and the
verification date. This record gates P1.M4.T2.S1's "verify every claim"
README sweep.

**Deliverable**:
1. `docs/M1-DoD.md` — appended M2-DoD audit section (per-item PASS blocks,
   environment header, counts, bench table, known-gap note, triage log).
2. Audit itself: every h2.54 checklist item verified green against the
   suites listed below (with any drift fixed minimally toward the owning
   subtask's PRP contract and logged).

**Success Definition**: every h2.54 clause maps to a named, green test or
test block, each backed by a re-runnable command recorded in the doc; the
doc cites P1.M4.T1.S1's `regression-evidence.md` for environment/counts/
bench numbers (no duplication); the known `#successorIndex` eviction gap
is recorded verbatim as an accepted, out-of-scope note; `npm run check` +
`npm test` remain green.

## User Persona

**Target User**: hapax maintainer (and future readers) verifying that the
M2 redesign (successor chaining only) is actually DONE per the rewritten
PRD DoD — before the final README changeset sweep claims it.
**Use Case**: reviewer opens `docs/M1-DoD.md`, reads the M2 section, and
re-runs any listed command to re-verify a clause.
**User Journey**: maintainer runs the audit commands → confirms green →
reads the appended M2-DoD record → unblocks P1.M4.T2.S1's README sync.
**Pain Points Addressed**: h2.54 is currently a rewritten contract with no
recorded evidence; the delta deleted ~70 phrase tests and rewrote the
chain/successor suites, so old M1-era evidence no longer describes reality.

## Why

- PRD §09 h2.54 (rewritten M2 DoD) is the acceptance contract for the
  entire D2 redesign; nothing currently records that it passes.
- `docs/M1-DoD.md` is the established evidence-record format (used for M1
  sign-off); appending keeps one canonical DoD file.
- P1.M4.T2.S1's README sweep must "verify every claim" — it consumes this
  record as its source of truth (gating dependency).
- The item description explicitly names the three upstream test artifacts
  (P1.M1.T3.S2 break cases, P1.M2.T1.S2 chain+item 7, P1.M2.T2.S1 forced
  single-item) plus S1's green-suite evidence as the audit inputs.

## What

Audit the h2.54 checklist EXACTLY, clause by clause (test locations
verified in research — trust but confirm they exist at implementation
time; they were read at plan time):

1. **Successor-index chaining state machine with ZERO-typed-char successor
   offers** — `test/chain.test.ts`, describe
   `"chain machine — armed successor chaining (PRD §07 h2.43, plan 002 S1
   redesign)"`: armed(W) at word start with zero typed chars offers the
   top successor immediately (no trigger char, no threshold).
2. **Live successor filtering** — same describe: typed chars filter the
   armed successor list prefix/case-insensitively with threshold 0 for the
   chain duration; non-Tab disqualifying keys → idle; no successors → idle.
3. **Chain resets on `before_agent_start`** — `test/chain.test.ts`
   `"reset() forces idle — the before_agent_start rule; normal
   config.threshold resumes (h2.43)"` (~line 478).
4. **One-word invariant (no multi-word item ever offered — asserted in
   tests)** — `test/chain.test.ts`
   `"one-word invariant: every chain item value is a single word, never
   leading/multi-word (h2.38/h2.44)"` (~line 547), plus
   `test/helpers/query-invariants.ts` `assertWordsOnly` coverage over
   `RankedMatch` outputs (see chain.test.ts comment ~line 181).
5. **Raw-text-adjacency window breaks — ALL covered and green**:
   - `test/successors.test.ts`
     `"strict adjacency end-to-end: punctuation breaks, whitespace-only
     gaps chain, stopword bridges are forbidden"` (~line 128).
   - `test/ingest-pipeline.test.ts` describe
     `"onAdmittedTokens — adjacency runs (PRD 002 §06 h3.6,
     P1.M1.T3.S2)"` (~line 346) — the break-case suite: commas; quotes /
   brackets / backticks; digits; non-word characters; intervening words
   with stopword bridging forbidden (see
     `"a rejected word between two admitted words breaks the run (no
     stopword bridging)"` ~446, `"ZorpWibbleEngine, quuxblat never chains
     (the stopword-bridge bug class)"` ~465); newlines.
   - Audit method: enumerate each h2.54 break category and point at the
     specific `it(...)` that covers it; if any category has no case,
     record it as a GAP (do not silently pass).
6. **Forced single-item tests green** (R3, "Tab only ever completes") —
   `test/provider-live.test.ts` describe
   `"forced single-item returns (PRD §07 h3.8)"` (~line 294): force:true →
   exactly the live top with prefix unchanged; force absent/false → full
   set byte-identical legacy; delegated options object identity preserved.
7. **Integration item 7** — `test/chain.test.ts` describe
   `"replayed-store arming end-to-end (real ingest pipeline, NREL fixture
   — the PRD §09 item-7 route, h2.54)"` (~line 678): accept `National` →
   with ZERO additional typed chars `Renewable` is top → Tab → `Energy` →
   Tab → `Laboratory`. Assert the zero-typed-char property explicitly
   (read the test body to confirm it checks no keystrokes between accepts).

**Record** (appended M2 section in `docs/M1-DoD.md`):
- Environment header: sweep date, head commit, node/vitest/pi versions —
  CITE `plan/002_3e8a42cadf2c/P1M4T1S1/research/regression-evidence.md`
  (S1 ran the same-day full sweep; reuse its header; only re-capture if
  HEAD moved since S1's run).
- New suite/file counts after the phrase deletions (from S1's evidence;
  e.g. phrases.test.ts / phrase-gating.test.ts absent, bigrams.test.ts
  added — ~34 test files at research time; use S1's exact `npm test`
  banner numbers).
- Bench numbers: the four-gate table from S1's evidence
  (`npm run bench` + perf-gates actuals) — cite, don't re-run unless HEAD
  moved.
- Known-gap note (MUST include, from architecture/system_context.md Key
  decisions #7): word eviction (`evictIfOverCap`) does not clean
  `#successorIndex`; no indirect cleanup since the phrase map is gone;
  out of delta scope — recorded, not fixed.
- Triage log: any failure → owning subtask PRP (chain→P1.M2.T1, forced→
  P1.M2.T2.S1, breaks→P1.M1.T3.S2) → minimal contract-restoring fix →
  re-run. All three owning tasks are Complete per the plan tree; failures
  mean drift, not missing work.
- Verdict line: "M2 (D2 redesign) DONE" (or per-item failures listed).

### Success Criteria

- [ ] All 7 audit items verified green with named tests + commands
- [ ] Every h2.54 break category mapped to a specific `it(...)` (or flagged)
- [ ] `docs/M1-DoD.md` M2 section appended: counts, bench table, date,
      gap note, verdict
- [ ] No duplication of S1's evidence — cited by path
- [ ] `npm run check` + `npm test` green after any fixes

## All Needed Context

### Context Completeness Check

The implementing agent gets the exact h2.54 clause → test-file →
test-name mapping (verified at plan time by reading the repo), the record
format to mirror, the citation contract with S1's evidence file, the
known-gap obligation, and the triage ownership map. No prior knowledge
assumed.

### Documentation & References

```yaml
- file: docs/M1-DoD.md
  why: THE doc to append to; also the FORMAT source — environment header,
    per-gauntlet PASS blocks quoting the exact command, budget tables,
    honesty notes, "Files changed" + "Reproduction" tail. Mirror its shape.
  gotcha: APPEND a clearly-delimited M2 section (e.g. "## M2 Definition of
    Done — post-delta re-verification (P1.M4.T1.S2)"); do not rewrite the
    M1 record — it is history.

- file: plan/002_3e8a42cadf2c/P1M4T1S1/PRP.md
  why: SIBLING CONTRACT — defines regression-evidence.md (environment
    header, fresh npm test counts, 4-gate bench table, no-persistence
    grep) which this task CITES instead of re-running. Also defines the
    ownership map this task reuses for triage.
  gotcha: S1 runs in parallel; if its evidence file is absent at start,
    wait/re-check or re-capture the environment header yourself and note
    the substitution.

- file: plan/002_3e8a42cadf2c/architecture/system_context.md
  why: "Key decisions for the breakdown" — the redesign contracts this
    audit checks against (adjacency runs via /^[ \t]+$/ gaps, slim bigram
    map capped 10k, force-branch truncation, bare-value chain redesign,
    config alias) AND decision #7 (successorIndex eviction gap — must be
    recorded, not fixed).
  section: "Key decisions for the breakdown (research-derived)".

- file: plan/002_3e8a42cadf2c/architecture/tests_docs_inventory.md
  why: authoritative suite map — which suites the delta deleted/rewrote;
    sanity-check the counts you cite against it.

- file: test/chain.test.ts
  why: clauses 1–4 and 7 — armed successor chaining describe, reset()
    case (~478), one-word invariant case (~547), NREL end-to-end
    item-7 describe (~678). Read the item-7 body to confirm zero-keystroke
    assertion before passing it.

- file: test/successors.test.ts
  why: clause 5 — strict-adjacency end-to-end case (~128); also the
    store-direct bump/eviction describes for context.

- file: test/ingest-pipeline.test.ts
  why: clause 5 — "onAdmittedTokens — adjacency runs" describe (~346):
    the full break-case suite incl. stopword-bridging cases (~446, ~465).

- file: test/provider-live.test.ts
  why: clause 6 — "forced single-item returns (PRD §07 h3.8)" (~294) and
    the options-identity delegation assertions (~103–113).

- file: test/helpers/query-invariants.ts
  why: assertWordsOnly — the one-word invariant's shared helper; confirm
    it is exercised by chain/query suites (clause 4's "asserted in tests").

- file: plan/002_3e8a42cadf2c/P1M4T1S2/research/notes.md
  why: this item's research — verified test-name/line map, M1-DoD format
    facts, method notes, count snapshot (34 files at research time).

- docfile: prd_snapshot h2.54 (already embedded in this PRP's context)
  why: the EXACT checklist being audited — use its clause wording
    verbatim in the record's per-item headers.
```

### Current Codebase tree (relevant)

```bash
hapax/
├── docs/M1-DoD.md            # M1 evidence record — APPEND M2 section here
├── test/
│   ├── chain.test.ts             # clauses 1-4, 7 (armed chaining, reset, invariant, NREL item 7)
│   ├── successors.test.ts        # clause 5 (strict adjacency end-to-end)
│   ├── ingest-pipeline.test.ts   # clause 5 (adjacency-run break-case suite)
│   ├── provider-live.test.ts     # clause 6 (forced single-item, options identity)
│   ├── bigrams.test.ts           # delta-new (context)
│   ├── perf-gates.test.ts + bench/core.bench.ts   # cited via S1 evidence
│   └── ...                       # ~34 test files total (phrases/phrase-gating deleted)
└── plan/002_3e8a42cadf2c/
    ├── architecture/system_context.md      # Key decisions (#7 = gap note)
    └── P1.M4.T1.S1/research/regression-evidence.md  # S1 deliverable — CITE
```

### Desired Codebase tree with files to be added

```bash
docs/M1-DoD.md               # MODIFIED: appended "M2 Definition of Done —
                             #   post-delta re-verification" section
(src/** or test/** — only if triage demands a minimal contract-restoring fix)
```

### Known Gotchas of our Codebase & Library Quirks

```bash
# CRITICAL: docs/M1-DoD.md's M1 section is HISTORY — append, never edit it.
# CRITICAL: S1 (parallel) owns the M1 regression sweep and its evidence
#   file; this task owns the M2 audit + the doc annotation. Do not re-run
#   S1's gauntlet wholesale — cite it. Only re-capture if HEAD moved.
# GOTCHA: test line numbers cited above were verified at plan time; tests
#   may have shifted — locate by describe/it NAME (grep), not line number.
# GOTCHA: h2.54's break list is exhaustive ("all covered and green") —
#   enumerate each category (commas; quotes/brackets/backticks; digits;
#   non-word characters; intervening words w/ forbidden stopword bridging;
#   newlines) and map EACH to a named it(...); a missing category is a GAP
#   to record, not a silent pass.
# GOTCHA: h2.54 requires integration item 7 "with zero additional typed
#   chars" — verify the test asserts the absence of keystrokes between
#   accepts (word-start offers), not just the final line contents.
# GOTCHA: `pi --check` does not exist — docs/M1-DoD.md records the
#   substitution (npm run check); cite it, don't hunt.
# GOTCHA: the #successorIndex eviction gap (Key decisions #7) is a KNOWN,
#   accepted, out-of-scope limitation — record it verbatim in the doc;
#   do NOT "fix" it (that would widen the changeset past its contract).
# GOTCHA: vitest -t filters match substrings across describes — use
#   `npx vitest --run test/chain.test.ts -t "<exact it name>"` and confirm
#   the reported case count matches expectations.
```

## Implementation Blueprint

### Audit record structure (appended to docs/M1-DoD.md)

```markdown
## M2 Definition of Done — post-delta re-verification (P1.M4.T1.S2)

PRD §09 h2.54 (rewritten) verbatim quote as the contract.

- Sweep date / Head commit / environment — cited from
  plan/002_3e8a42cadf2c/P1M4.T1.S1/research/regression-evidence.md
  (re-captured locally if HEAD moved).
- Suite counts after phrase deletions: N files / M passed / K skipped
  (phrases.test.ts + phrase-gating.test.ts absent; bigrams.test.ts added).

### Item 1 — successor-index chaining state machine, ZERO-typed-char offers: PASS
`$ npx vitest --run test/chain.test.ts -t "<case>"` → date, result, case names.

### Item 2 — live successor filtering (threshold 0): PASS
### Item 3 — chain resets on before_agent_start: PASS
### Item 4 — one-word invariant: PASS (+ assertWordsOnly coverage note)
### Item 5 — raw-text-adjacency break categories (one sub-line per category)
### Item 6 — forced single-item Tab: PASS
### Item 7 — integration: National → Renewable → Energy → Laboratory with zero typed chars: PASS

### Bench table (cited from S1's evidence; 4 gates × budget × measured × verdict)
### Known accepted gap — successorIndex eviction cleanup (Key decisions #7)
### Triage log (or "no failures — no triage")
**Verdict: M2 (D2 redesign) DONE.**
### Files changed by this sweep
### Reproduction commands
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITION
  - CONFIRM plan/002_3e8a42cadf2c/P1M4.T1.S1/research/regression-evidence.md
    exists (S1 complete); record whether HEAD (git rev-parse HEAD) matches
    its recorded commit — if it moved, plan to re-capture counts/bench
    locally and note it

Task 1: CLAUSE-BY-CLAUSE AUDIT RUN
  - FOR each of the 7 items in "What": grep the test file for the
    describe/it name, run
    `npx vitest --run test/<file> -t "<name>"`, record PASS/FAIL + case
    count + date
  - ITEM 5 specifically: enumerate all six break categories, map each to
    a named it(...) across successors.test.ts + ingest-pipeline.test.ts;
    any unmapped category → GAP recorded in the doc
  - ITEM 7: read the NREL test body; confirm zero-keystroke assertion;
    record the exact assertion lines in the evidence note
  - ON FAILURE: triage → owning PRP (chain→P1.M2.T1, forced→P1.M2.T2.S1,
    breaks→P1.M1.T3.S2) → minimal contract-restoring fix → re-run → log

Task 2: CAPTURE SUPPORTING NUMBERS
  - FROM S1's regression-evidence.md: environment header, npm test counts,
    4-gate bench table — copy into the doc as cited citations
  - IF HEAD MOVED since S1: run `npm test` + `npm run bench` yourself and
    record fresh numbers with a note

Task 3: APPEND docs/M1-DoD.md M2 section
  - FOLLOW format: structure above; mirror M1 section's PASS-block style
    (exact command quoted, date, result)
  - INCLUDE: verbatim h2.54 quote, per-item blocks, bench table, gap note
    (Key decisions #7, verbatim), triage log, verdict line, "Files
    changed" + "Reproduction" tails
  - DO NOT touch the M1 section above it

Task 4: WRITE research notes update
  - APPEND the recorded per-item results to
    plan/002_3e8a42cadf2c/P1M4.T1.S2/research/notes.md (audit trail)

Task 5: VALIDATE
  - npm run check && npm test → green (final state)
  - Re-read the appended section: every PASS has a command + date; every
    break category mapped; gap note present; S1 cited by path
  - git diff docs/M1-DoD.md → additive only (M1 section byte-identical)
```

### Implementation Patterns & Key Details

```bash
# PATTERN: per-item audit record (mirrors M1-DoD.md)
# ### Item 3 — chain resets on before_agent_start: PASS
# `$ npx vitest --run test/chain.test.ts -t "reset() forces idle"`
# - 2026-XX-XX: 1/1 passed.

# PATTERN: break-category mapping table (item 5)
# | h2.54 category | test file | it(...) name |
# | commas         | ingest-pipeline.test.ts | "comma between…" |
# | newlines       | … | … |

# GOTCHA: locate tests by NAME (line numbers shift); vitest -t is a
#   substring filter — quote the distinctive part of the it() name.
```

### Integration Points

```yaml
DATABASE: none
CONFIG: none
ROUTES: none
DEPENDS-ON: P1.M4.T1.S1 evidence file (cite), all P1.M1–P1.M3 subtasks
  (Complete per plan tree)
CONSUMED-BY: P1.M4.T2.S1 (README "verify every claim" pass — this record
  is its source of truth)
DOCS: docs/M1-DoD.md — appended M2 section (the changeset's direct doc;
  Mode A: rides with the work)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # exit 0 (also confirms no test-source drift from fixes)
```

### Level 2: The audited suites

```bash
npx vitest --run test/chain.test.ts test/successors.test.ts \
  test/ingest-pipeline.test.ts test/provider-live.test.ts   # all green
npm test        # whole suite green (final state)
```

### Level 3: Record integrity

```bash
git diff docs/M1-DoD.md    # additive only; M1 section untouched
grep -c "PASS" docs/M1-DoD.md   # all h2.54 items recorded
# every recorded command re-runnable: spot-re-run 2 of them
```

### Level 4: Gate handoff

```bash
# confirm P1.M4.T2.S1 can cite: counts, bench table, verdict, gap note
# all present in docs/M1-DoD.md M2 section
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` exit 0; `npm test` green (after any triage fixes)
- [ ] All 4 audited suites green individually
- [ ] Commands recorded in the doc re-runnable (spot-checked)

### Feature Validation

- [ ] All 7 h2.54 clauses audited with named tests + commands + dates
- [ ] All six break categories explicitly mapped (no silent gaps)
- [ ] Item 7 zero-typed-char property confirmed from the test body
- [ ] Counts + bench numbers cited from S1's evidence (or refreshed with
      a note if HEAD moved)
- [ ] successorIndex eviction gap recorded verbatim (not "fixed")
- [ ] Verdict line present: "M2 (D2 redesign) DONE" (or failures listed)

### Code Quality Validation

- [ ] docs/M1-DoD.md M1 section byte-identical (additive append only)
- [ ] Any code fixes minimal, triaged to owning PRP contracts, logged
- [ ] No duplication of S1's evidence — cited by path
- [ ] Audit trail in research/notes.md updated

## Anti-Patterns to Avoid

- ❌ Don't rewrite or "correct" the M1 section of docs/M1-DoD.md — append
- ❌ Don't re-run S1's full M1 gauntlet wholesale — cite its evidence
- ❌ Don't pass item 5 without mapping EVERY break category to a named test
- ❌ Don't "fix" the known successorIndex eviction gap — record it
- ❌ Don't locate tests by plan-time line numbers — grep by name
- ❌ Don't record PASS without the exact command + date + case count

## Confidence Score

**9/10** — every audited test file, describe block, and key test name was
verified present by reading the repo during research; the record format,
citation contract with S1, and gap obligation are all pinned. Residual
risk: S1's evidence file not yet landed when this task starts (mitigated:
Task 0 precondition + local re-capture fallback).