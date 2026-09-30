---
name: "P1.M2.T1.S2 (plan 004) — Full gauntlet + docs/M1-DoD.md append + live smoke + drift report"
---

## Goal

**Feature Goal**: Close the tier-0 anchorless fallback + `#` loose-mode changeset with its evidence record: (a) run the full gauntlet (`npm run check`, `npm test`, `npm run bench`) — all green is the gate; (b) append a changeset DoD section to `docs/M1-DoD.md` following that file's own gauntlet-item PASS pattern, including the tier-0 perf-gate row's measured numbers from P1.M1.T1.S2 and today's date; (c) perform the BINDING live smoke (spec §09 h2.57 technique: ephemeral `pi --no-session` tmux run, one-char-at-a-time keys, capture-pane evidence, zero instrumentation left in the tree) covering the three tier-0/loose-mode scenarios; (d) write the drift report recording every spec-vs-repo mismatch found across the changeset (expected: none — the verification-only syncs were confirmed agreeing).

**Deliverable**:
- `docs/M1-DoD.md` appended section: new tier-0/loose-mode changeset heading, gauntlet items with re-runnable commands + suite counts + gate table (Budget | Measured | vs budget | CI bound 3× | Verdict), live-smoke capture-pane evidence, honesty notes
- Drift report (inside the appended section): the four verified-agreeing checks + residuals from P1.M2.T1.S1's `research/stale-claims.md`

**Success Definition**: gauntlet green (tsc clean, whole suite green, bench runs reporting-only); the three smoke scenarios evidenced by capture-pane text and described honestly; `git status` shows no instrumentation remnants; drift report records "none found" or the actual mismatches; no code/spec/README edits made by this task.

## Why

- The changeset landed matcher, perf gate, per-mode thresholds, provider/widget wiring, and README sync (S1) — the closing record per Mode B is this DoD append + live verification. AGENTS.md binds UI-layer claims to live TTY verification, not unit tests alone; the tier-0 one-shot menu and `#query` path completion are UI-layer behaviors.
- The scout-corrected fact: docs/ contains ONLY M1-DoD.md — the append pattern is that file's own gauntlet-item structure, not any M2/M3 DoD file.

## What

### (a) Full gauntlet

```bash
git rev-parse HEAD                      # record head commit
node --version; npx vitest --version    # record environment
npm run check                           # tsc --noEmit strict — exit 0
npm test                                # vitest --run — record file/test counts verbatim
npm run bench                           # reporting-only; record tier-0 + anchored numbers
```
All green is the gate. If any suite fails: STOP and report — fixing is not this task's mandate; the failure is upstream drift.

### (b) docs/M1-DoD.md append (follow the file's own pattern — verified)

Append a new dated section (do NOT touch the 2026-09-07 M1 record above it):

```markdown
---

# Tier-0 anchorless fallback + `#` loose mode — changeset DoD (<date>)

- **Sweep date:** <date> · **Head commit:** `<rev>` · **Environment:** Linux ·
  Node <v> · vitest <v>
- **Verdict:** ... items below

## Gauntlet item 1 — type check clean: PASS
```
$ npm run check
```
- <date>: exit 0, zero errors.

## Gauntlet item 2 — all tests green: PASS
```
$ npm test
```
- <date>: exit 0 — <N> test files, <N> passed / <N> skipped (<skip rationale inline — the gc-dependent dictionary case is pre-existing>).

## Gauntlet item 3 — performance gates (incl. the new tier-0 row): PASS
```
$ npx vitest --run test/perf-gates.test.ts && npm run bench
```
| Gate | Budget | Measured | vs budget | CI bound (3×) | Verdict |
| --- | --- | --- | --- | --- | --- |
| 20k-candidate anchored-fuzzy query + rank + top 8 | < 1 ms p99 | <from run> | | < 3 ms | |
| **Tier-0 anchorless fallback full-store pass (new, P1.M1.T1.S2)** | < 3 ms p99 | <from run> | | < 9 ms | |
| ... remaining gate rows from the run ...

## Gauntlet item 4 — live smoke (spec §09 h2.57, BINDING): PASS
<the three scenarios, each with the capture-pane excerpt and a one-line reading>

## Drift report (spec read-only this run): NONE FOUND / <items>
<the four verified-agreeing checks + S1 stale-claims residuals>
```

### (c) Live smoke (spec §09 h2.57 technique — binding)

Setup (each scenario or one combined session):
1. `tmux new-session -d -s hapax-smoke 'pi --no-session'` then `tmux attach`/capture as needed — pi's TUI needs a real TTY.
2. Seed the store: type ONE short user message containing the smoke vocabulary — include a word whose anchored scan will be empty but whose contiguous-run cousin exists (said→unsaid class, e.g. "unsaid") and the literal text `src/core/query.ts` — then Enter to submit and Ctrl+C the turn so message_end ingest runs.
3. Drive keys via `tmux send-keys -t hapax-smoke` ONE CHARACTER AT A TIME with `sleep 0.1` between (bursts cancel in-flight autocomplete queries — documented false-conclusion source).

Scenarios:
1. **Tier-0 one-shot cousin menu**: type the zero-anchored-result fragment one char at a time (e.g. `sai` if `said`'s anchored scan is empty but `unsaid` is stored) → capture-pane shows the one-shot menu; CONTINUE typing → the menu narrows away/disappears (tier-0 fires only on empty anchored results). Capture at both moments.
2. **`#query` path completion**: type `#query` one char at a time → capture shows `src/core/query.ts` offered; Tab inserts the whole path. Capture before/after Tab.
3. **Tier-0 never arms a chain**: after Tab-inserting a tier-0 `#`-mode completion, type a separator (space) then stop at the next word start → capture shows NO successor offer (chains arm on anchored tiers only, P1.M1.T2.S2). Absence evidence + the reasoning line.

Optional sanctioned instrumentation (`appendFileSync` behind an env var in `src/pi/provider.ts`) ONLY if a capture is ambiguous; REMOVE before finishing and prove it: `git status` / `git diff` clean of instrumentation.

### (d) Drift report

Record (expected: all agree, none found):
- Module rows: spec/02:64–68 ↔ src/pi/{editor,debug,paths}.ts ✅
- Dict figures: spec/03:37–54 ↔ dict/common-en.bin 850,554 B, 48,802 entries, LF 0.7445 ✅
- M2 DoD re-theme: acceptance.test.ts:838 (Zorp→Noria→Inverter) ✅
- Decision log = spec/SPEC.md:67 (section, not artifact) ✅
- Residuals from `plan/004_24ebf0115d16/P1M2T1S1/research/stale-claims.md` (S1's verified-already-agreeing list).
Any NEW mismatch found during the gauntlet/smoke: record it verbatim (file:line both sides) — spec/*.md stay READ-ONLY.

### Success Criteria

- [ ] `npm run check` exit 0; `npm test` green with counts recorded; `npm run bench` runs (reporting-only)
- [ ] DoD section appended following the established pattern; tier-0 gate row carries P1.M1.T1.S2's measured numbers + today's date
- [ ] All three smoke scenarios evidenced with capture-pane excerpts; one-char-at-a-time keys honored
- [ ] No instrumentation in the tree at the end (`git status` clean of it)
- [ ] Drift report records the four verified-agreeing checks + S1 residuals + any new findings
- [ ] Zero edits to code, spec/*.md, README.md (README = S1's scope)

## All Needed Context

### Context Completeness Check

An implementer needs: the exact DoD append pattern (quoted below from the real file), the three commands, the live-smoke protocol verbatim, the smoke vocabulary seeding trick, the drift-check list with file:line, and the scope fences. All below.

### Documentation & References

```yaml
- file: docs/M1-DoD.md
  why: THE pattern source + append target. Structure verified: header block
        (sweep date / head commit / environment / verdict), gauntlet-item
        headings with `: PASS`, fenced `$ command` blocks, date + exit
        status, suite counts ("24 test files, 413 passed / 1 skipped" with
        inline gc-skip rationale), gate table (Gate | Budget | Measured |
        vs budget | CI bound 3× | Verdict), honesty notes, and the
        command-substitution precedent (pi --check → npm run check).
  gotcha: APPEND a new dated section; never rewrite the 2026-09-07 record.

- file: plan/004_24ebf0115d16/architecture/external_deps.md
  why: Commands (npm run check/test/bench), perf-gate pattern
        (warmup 100 → 1000 samples → p99 → 3× bound), and the
        verified-agreeing drift list (module rows, dict figures 48,802 /
        850,554 B / LF 0.7445, acceptance.test.ts:838, SPEC.md:67).

- file: plan/004_24ebf0115d16/architecture/tier0_design.md
  section: §7 (Docs/Mode B: the DoD append + the three smoke scenarios) +
        §8 (drift/verification notes, verified-agreeing list, out-of-scope fence)
  why: The task's own design memo.

- file: plan/004_24ebf0115d16/P1M2T1S1/PRP.md
  why: The README sweep running in parallel — its stale-claims list
        (research/stale-claims.md) feeds this task's drift report; confirms
        no overlap (README = S1, DoD/smoke/drift = S2).

- file: plan/004_24ebf0115d16/P1M1T1S2/research/  (+ its PRP)
  why: The tier-0 perf gate implementation — the measured numbers for the
        new gate row come from re-running its gate now (record fresh, don't
        copy stale numbers).

- file: spec/09-testing-and-acceptance.md (in-repo)
  section: h2.57 "Live verification technique (binding)" + h2.56 item 2
        (amended no-hijack: tier-0 cousin menus are EXPECTED, not a hijack)
  why: The binding smoke protocol (tmux, --no-session, 0.08–0.12 s
        one-char keys, capture-pane, sanctioned-then-removed
        instrumentation) and the amended no-hijack wording the smoke
        validates.

- file: test/perf-gates.test.ts
  why: The gate harness (:76–121 pattern) — running it emits the measured
        actuals the gate table needs.
```

### Current Codebase tree (relevant)

```bash
docs/M1-DoD.md           # APPEND changeset section
test/perf-gates.test.ts  # run (includes P1.M1.T1.S2's tier-0 gate row)
README.md                # read-only here (S1's)
spec/*.md                # read-only (drift report only)
```

### Desired Codebase tree

```bash
docs/M1-DoD.md           # + appended tier-0/loose-mode changeset DoD section
```

### Known Gotchas & Library Quirks

```bash
# CRITICAL: pi needs a REAL TTY — `pi --no-session | cat` exits silently.
# Always run inside a tmux pane.

# GOTCHA: send-keys a whole string at once = burst = in-flight autocomplete
# queries CANCELLED — different behavior from human typing and a documented
# source of false conclusions. Loop: for c in sai; do tmux send-keys ... "$c";
# sleep 0.1; done

# GOTCHA: seed BEFORE probing — candidates only exist after a message_end
# ingest: submit one short message containing "unsaid"-class words AND the
# literal path "src/core/query.ts", Enter, then Ctrl+C the turn.

# GOTCHA: tier-0 cousin menus are EXPECTED under the amended no-hijack rule
# (spec/09 item 2, 2026-10): a one-shot menu for said→unsaid is correct
# behavior, NOT a hijack regression.

# GOTCHA: smoke scenario 3 is an ABSENCE assertion — capture the pane at the
# next word start after the Tab and record that no chain offer line appears;
# if ambiguous, sanctioned env-gated appendFileSync instrumentation is the
# tiebreaker, then REMOVE it and prove git-clean.

# GOTCHA: bench is reporting-only (npm run bench) — gates live in
# perf-gates.test.ts; a bench number over budget is a note, not a failure,
# unless the 3× CI gate trips.

# GOTCHA: record suite counts verbatim from the run (files, passed, skipped)
# — the existing record names the pre-existing gc-skip; carry that rationale
# forward if it persists.

# GOTCHA: never edit spec/*.md even when a drift IS found — record it in the
# report; the spec maintenance policy routes fixes to an interactive session.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: GAUNTLET
  - Record head commit + environment; run npm run check / npm test /
    npx vitest --run test/perf-gates.test.ts / npm run bench
  - Record: exit codes, suite counts, gate-table actuals (esp. the tier-0 row)
  - IF anything red: STOP, report — no fixes in this task

Task 2: LIVE SMOKE (spec §09 h2.57, binding)
  - tmux new-session -d -s hapax-smoke 'pi --no-session'
  - Seed: one message with "unsaid" + "src/core/query.ts", Enter, Ctrl+C
  - Scenario 1: one-char-at-a-time zero-anchored fragment → capture menu;
    continue typing → capture narrowing-away
  - Scenario 2: '#query' one char at a time → capture offer; Tab → capture
    inserted path
  - Scenario 3: after tier-0 Tab accept, space + word start → capture
    absence of chain offer
  - Save capture excerpts (research/ or inline in the DoD section)
  - kill the tmux session; verify NO instrumentation: git status/diff clean

Task 3: DRIFT REPORT assembly
  - The four verified-agreeing checks (external_deps.md list) — re-verify
    each cheaply (grep/diff the named lines)
  - Merge residuals from P1M2T1S1/research/stale-claims.md
  - Add any NEW mismatch surfaced by Tasks 1–2 (verbatim file:line pairs)

Task 4: docs/M1-DoD.md APPEND
  - New dated section per the template in "What" §(b)
  - Gauntlet items 1–4 + drift report; honesty notes for any near-miss
    (e.g. bench numbers above budget but under 3× CI bound)

Task 5: FINAL verification
  - npm run check + npm test still green (docs-only change, but prove it)
  - git status: only docs/M1-DoD.md (+ research notes) modified
```

### Implementation pattern

One-char-at-a-time key driver:

```bash
send_chars() { for c in $(fold -w1 <<<"$1"); do
  tmux send-keys -t hapax-smoke "$c"; sleep 0.1; done; }
tmux capture-pane -t hapax-smoke -p > smoke-capture-$(date +%s).txt
```

### Integration Points

```yaml
NONE structural:
  - This is the changeset's closing record; P1.M2.T1.S1's README + this
    DoD section together satisfy Mode B for the tier-0/loose-mode delta.
  - Future DoD sweeps append AFTER this section (keep the file's
    append-only discipline).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check    # docs-only, but still zero errors
```

### Level 2: The gauntlet itself

```bash
npm test
npx vitest --run test/perf-gates.test.ts
npm run bench    # reporting-only
```

### Level 3: Live verification (binding — this IS the acceptance)

The three tmux smoke scenarios with capture-pane evidence (Task 2).

### Level 4: Record integrity

- Re-run one gauntlet command from the appended section verbatim — the record must be re-runnable as written
- `git status` shows no instrumentation, no spec/README edits

## Final Validation Checklist

### Technical Validation

- [ ] Gauntlet green; counts + gate numbers recorded verbatim from the run
- [ ] DoD append follows the file's established pattern (headings, fenced commands, gate table, honesty notes)

### Feature Validation

- [ ] Smoke (i) one-shot cousin menu appears then narrows away — captured
- [ ] Smoke (ii) `#query` → `src/core/query.ts` offered + Tab-inserted — captured
- [ ] Smoke (iii) no successor offer after tier-0 Tab accept — captured absence
- [ ] Drift report complete (4 checks + S1 residuals + new findings, expected none)

### Code Quality Validation

- [ ] No instrumentation left; no code/spec/README/test edits by this task
- [ ] Capture excerpts embedded or stored under the item's research/ dir

### Documentation

- [ ] The appended section IS the documentation output (Mode B); re-runnable as written

## Anti-Patterns to Avoid

- ❌ Don't chase nonexistent M2/M3 DoD files — docs/M1-DoD.md is the only DoD doc; append to it
- ❌ Don't send keys as a burst — one char at a time with 0.08–0.12 s sleeps, always
- ❌ Don't leave env-gated instrumentation in the tree, even "temporarily"
- ❌ Don't edit spec/*.md to resolve drift — record it; fixes route to an interactive session
- ❌ Don't rewrite the 2026-09-07 M1 record — append-only
- ❌ Don't fix failing gauntlet items in-task — stop and report the drift

**Confidence Score: 9/10** — the DoD pattern is quoted from the actual file, the smoke protocol is verbatim from the binding spec section, the drift list is pre-verified, and the only environmental dependency (tmux + pi) is the same technique the repo has used before.
