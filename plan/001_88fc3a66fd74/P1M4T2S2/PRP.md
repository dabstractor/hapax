# PRP — P1.M4.T2.S2: M1 definition-of-done verification sweep

## Goal

**Feature Goal**: Run and record the complete PRD §09 h2.53 M1 definition-of-done
gauntlet against the real repository, fix any drift found (small code/doc fixes
allowed), and declare M1 done with durable recorded evidence — unblocking P2 (M2).

**Deliverable**:
1. `docs/M1-DoD.md` — the DoD evidence record: every gauntlet item with the exact
   command run, date, and observed result (pass/fail + measured numbers for perf
   gates).
2. A new scripted persistence assertion test (`test/no-persistence.test.ts`) that
   proves hapax writes no files at runtime.
3. README "Status" updated to M1 complete (Mode B docs change), pointing at the
   evidence file.

**Success Definition**: All six gauntlet checks below are recorded as PASS in
`docs/M1-DoD.md`; `npm run check`, `npm test`, `npm run bench` all green; the
persistence assertion is a permanent, automated part of `npm test`; README no
longer says "Researching/Implementing" style status — it says M1 (v1) complete
with a pointer to `docs/M1-DoD.md`.

## Important correction (from contract research note)

PRD M1 DoD says "`pi --check` (or lint) clean". **`pi --check` DOES NOT EXIST.**
The project equivalent (already wired in package.json) is:
- `npm run check` → `tsc --noEmit` (strict)
- `npm test` → `vitest --run`

Use those. Do not invent a `pi --check` command; note this substitution in
`docs/M1-DoD.md`.

## User Persona

**Target User**: hapax maintainer + the P2 (M2) implementer who needs proof M1's
foundation is sound.
**Use Case**: before starting M2 phrase work, open `docs/M1-DoD.md`, confirm every
gate passed on a recorded date, and know the exact commands to re-run.
**Pain Points Addressed**: DoD currently has no recorded evidence; the
persistence invariant ("no files written anywhere") is asserted nowhere
executable.

## Why

- PRD h2.53 is the M1 contract; P2.M2.T3 hinges on "M1 acceptance" being done.
- All dependencies are complete: unit/integration tests (P1.M4.T1.S1),
  benchmarks (P1.M4.T1.S2), README rewrite (P1.M4.T2.S1 — running in parallel;
  assume its README structure exists; this PRP only touches the Status line and
  adds a DoD pointer).

## What

### The gauntlet (all six must be recorded)

1. **Type check clean**: `npm run check` (tsc --noEmit, strict) — zero errors.
2. **All tests green**: `npm test` (vitest --run) — includes
   `test/acceptance.test.ts` (PRD §09 items 1–6 scripted) and
   `test/perf-gates.test.ts` (hard 3× budget bounds).
3. **Benchmarks within budgets**: `npm run bench` — record measured actuals vs
   the four PRD h2.51 budgets (< 1 ms p99 query, < 60 ms dict load+sweep,
   < 60 ms ingest 800 KB, < 6 MB heap delta) in `docs/M1-DoD.md`.
4. **Integration items 1–6**: confirm the checklist in
   `test/fixtures/sessions/RESULTS.md` (from P1.M4.T1.S1) is fully PASS with
   manual-only items evidenced; link it from `docs/M1-DoD.md`.
5. **Persistence assertion** (must be EXPLICIT per PRD "assert store dir
   untouched"):
   - New automated test `test/no-persistence.test.ts`: exercise the real
     pipeline in a temp working dir (ingest a fixture transcript through
     `IngestPipeline`, run queries through `src/core/query.ts` and
     `extractMatchState`/provider), then snapshot the filesystem:
     `find <tmpdir> ~/.pi/agent -newer <marker-file> -type f` and assert nothing
     hapax-written appears (jiti may create its own cache — exclude paths
     matching `/jiti/` or `node_modules/.cache`; the assertion is about hapax
     writing store/dict/session files at runtime).
   - Additionally record in `docs/M1-DoD.md` one scripted live run:
     `PI_CONFIG_DIR=<fresh tmpdir> pi -p -e /home/dustin/projects/hapax "mention Zendesk and lwlock"`
     with a pre/post `find` snapshot of the fresh config dir + repo, asserting
     no hapax-originated files (transcript/session logs written by pi itself
     are pi's, not hapax's — distinguish by name: hapax defines no writers).
6. **Tuning protocol pointer**: `docs/M1-DoD.md` documents that tuning surfaces
   live in `src/core/score.ts` (admission bands 220/120, salience weights
   2.0/3.0/1.5/0.8/1.0) and the protocol is fixture-driven A/B against
   `test/fixtures/sessions/` per PRD §09 h2.52 — with a 2–3 line summary and a
   pointer, not a copy of the PRD.

### Drift fixing

If any check fails, this subtask MAY make small fixes (e.g. a flaky test, a
timing constant off-budget, README status line). Anything structural → stop and
report instead of a rewrite.

### Success Criteria

- [ ] `docs/M1-DoD.md` exists with all six gauntlet items, commands, dates, results
- [ ] `test/no-persistence.test.ts` passes inside `npm test` and genuinely
      asserts the filesystem
- [ ] `npm run check`, `npm test`, `npm run bench` all green
- [ ] README Status reflects M1 complete + points to `docs/M1-DoD.md`
- [ ] No M2 features described as working anywhere touched

## All Needed Context

### Documentation & References

```yaml
- file: package.json
  why: scripts check/test/bench already defined — use them verbatim
  gotcha: pi --check does not exist; tsc+vitest is the sanctioned equivalent

- file: test/fixtures/sessions/RESULTS.md
  why: gauntlet item 4 evidence (integration items 1–6) — read, verify all PASS,
        link from docs/M1-DoD.md; do not rewrite it

- file: test/perf-gates.test.ts, test/bench/core.bench.ts, test/helpers/bench-fixtures.ts
  why: gauntlet items 2–3; from P1.M4.T1.S2 (already merged in working tree)
  pattern: fixture generators to reuse for no-persistence test input

- file: test/acceptance.test.ts, test/helpers/session-fixture.ts
  why: how fixtures are replayed through real modules — follow the same
        load-replay pattern in test/no-persistence.test.ts

- file: src/pi/index.ts, src/pi/ingest.ts, src/pi/paths.ts
  why: confirm no fs writes in shipped code paths (grep for write/appendFile/
        mkdir — expect none outside tools/); paths.ts shows where hapax WOULD
        write (store dir) — assert it stays absent

- file: README.md
  why: update Status line only (P1.M4.T2.S1 rewrites the rest in parallel —
        keep the edit surgical: the status sentence + one DoD-evidence link)

- file: plan/001_88fc3a66fd74/architecture/system_context.md
  why: dev-loop command `pi -p -e /home/dustin/projects/hapax` validated there;
        PI_CONFIG_DIR redirect trick for the isolation run

- file: plan/001_88fc3a66fd74/prd_snapshot.md
  why: h2.53 (DoD), h2.51 (perf budgets table), h2.52 (tuning protocol)
```

### Current codebase tree (relevant)

```bash
src/core/  dictionary.ts query.ts score.ts segment.ts shapeGate.ts store.ts types.ts
src/pi/    config.ts debug.ts index.ts ingest.ts paths.ts provider.ts
test/      21+ suites incl. acceptance.test.ts, perf-gates.test.ts, bench/core.bench.ts
           fixtures/sessions/{zendesk-lwlock,prose,large-100k}.jsonl, RESULTS.md, expected.md
tools/     build-dict.mjs gen-large-session.mjs gen-provisional-tsv.mjs
dict/      common-en.bin
README.md  (P1.M4.T2.S1 rewrite in flight)
```

### Desired tree (additions only)

```bash
docs/M1-DoD.md              # DoD evidence record (new)
test/no-persistence.test.ts # automated persistence assertion (new)
README.md                   # Status line edit only
```

### Known Gotchas

```text
# pi --check does not exist — use npm run check / npm test. Note the
#   substitution explicitly in docs/M1-DoD.md.
# PRD wording is "assert store dir untouched" — the assertion must check the
#   FILESYSTEM, not just "no fs import in store.ts". Use find -newer marker.
# Exclude jiti's transpile cache and node_modules/.cache from the snapshot —
#   they are infra writes, not hapax writes.
# pi itself writes session logs/transcripts to its config dir — those are
#   pi's files; the assertion targets hapax-originated artifacts (candidate
#   stores, dictionaries, caches). Use a FRESH PI_CONFIG_DIR tmpdir so any
#   hapax write is unambiguous, then whitelist pi's own known files
#   (sessions/, settings, logs) and assert nothing else exists.
# P1.M4.T2.S1 is rewriting README in parallel — touch ONLY the status
#   sentence/DoD link; coordinate so exactly one Status statement results.
# git status at sweep time shows uncommitted plan/ files — that's the
#   orchestrator's, not drift.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: RUN gauntlet items 1–3
  - EXEC: npm run check && npm test && npm run bench
  - CAPTURE: exit codes + bench measured actuals into scratch notes
  - IF drift: small fixes allowed; re-run until green

Task 2: VERIFY gauntlet item 4
  - READ test/fixtures/sessions/RESULTS.md — confirm items 1–6 all PASS
  - IF any FAIL/manual-gap: complete the missing check (fixtures + scripted
    replay per test/acceptance.test.ts patterns) before proceeding

Task 3: CREATE test/no-persistence.test.ts
  - FOLLOW pattern: test/acceptance.test.ts (fixture replay through real
    IngestPipeline + query + provider modules)
  - STRUCTURE: mkdtemp working dir + marker file → full ingest/query cycle →
    `find` marker-newer files in tmpdir, repo, and a fresh PI_CONFIG_DIR-style
    dir → filtered for hapax writes → assert empty set
  - NAMING: test/no-persistence.test.ts, describe('M1 DoD: no persistence')

Task 4: CREATE docs/M1-DoD.md
  - RECORD: date, head commit, all six items with commands + results; the
    pi --check substitution note; perf actuals table vs budgets; tuning
    protocol pointer (score.ts constants + fixtures A/B per h2.52); link
    RESULTS.md for item 4

Task 5: LIVE isolation run (evidence for item 5)
  - EXEC: fresh tmpdir PI_CONFIG_DIR; marker; run
    PI_CONFIG_DIR=<tmp> pi -p -e /home/dustin/projects/hapax "<prompt mentioning Zendesk and lwlock>"
  - SNAPSHOT: post-run find -newer marker in tmpdir + repo; classify writes;
    assert no hapax-originated files
  - RECORD: output excerpt into docs/M1-DoD.md

Task 6: UPDATE README status
  - EDIT: status sentence → "M1 (v1) — complete, verified <date> (see
    docs/M1-DoD.md)"; keep P1.M4.T2.S1's structure intact otherwise

Task 7: FINAL sweep
  - EXEC: npm run check && npm test && npm run bench once more; confirm
    git diff touches only the intended files
```

### Key pattern: filesystem snapshot assertion

```ts
// test/no-persistence.test.ts sketch
import { mkdtempSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const marker = `${tmp}/marker`;
writeFileSync(marker, '');
// ...run full ingest + query + provider cycle...
const newer = execFileSync('find', [root, '-newer', marker, '-type', 'f',
  '-not', '-path', '*/node_modules/*', '-not', '-path', '*/jiti/*'], {encoding: 'utf8'})
  .split('\n').filter(Boolean)
  .filter(f => f !== marker && !isKnownInfraWrite(f));
expect(newer).toEqual([]);
```

## Validation Loop

### Level 1: syntax

```bash
npm run check   # tsc --noEmit, zero errors
```

### Level 2: tests

```bash
npm test        # all suites incl. new test/no-persistence.test.ts, green
```

### Level 3: gauntlet replay

```bash
npm run bench   # four gates, actuals within 3× budgets; numbers recorded
cat docs/M1-DoD.md   # all six items PASS with commands and dates
```

### Level 4: docs consistency

```bash
grep -n "M1" README.md         # exactly one definitive status statement
grep -c "M1-DoD.md" README.md  # exactly 1 link
git status --short             # only docs/M1-DoD.md, test/no-persistence.test.ts,
                               # README.md (status line), research/ notes
```

## Final Validation Checklist

- [ ] docs/M1-DoD.md: six gauntlet items, commands, dates, PASS results
- [ ] pi --check substitution documented
- [ ] test/no-persistence.test.ts green in `npm test`, real fs assertion
- [ ] Live PI_CONFIG_DIR isolation run recorded (no hapax writes)
- [ ] `npm run check`, `npm test`, `npm run bench` all green in final sweep
- [ ] README status = M1 complete + evidence link; no conflict with T2.S1 rewrite
- [ ] Tuning-protocol pointer present (score.ts constants, fixture A/B)
- [ ] No source-code changes beyond drift fixes; all changes enumerated in
      docs/M1-DoD.md if any

## Anti-Patterns to Avoid

- ❌ Don't fake evidence — every PASS must have a re-runnable command
- ❌ Don't skip the live pi run because the unit-level assertion "should cover it"
- ❌ Don't rewrite README wholesale (parallel task owns it)
- ❌ Don't add persistence "for testing convenience" — the invariant is absolute
- ❌ Don't treat jiti/node_modules cache writes as failures (infra, not hapax)