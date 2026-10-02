---
name: "P1.M2.T1.S4 (plan 005) — docs/M1-DoD.md dated gauntlet-item append (counts, gates, captures, drift verdict)"
---

## Goal

**Feature Goal**: Append the dated gauntlet-item record for the **arrow-model-v2 changeset** (widget boundary pass-through + interaction carousel; P1.M1.T1.S1–S3 code + battery) to `docs/M1-DoD.md`, following the file's own append-only pattern exactly, so the changeset is durably evidenced and documentation is coherent end-to-end (spec ↔ README ↔ DoD).

**Deliverable**: A new dated section at the END of `docs/M1-DoD.md` (after the current last section, the "Bugfix changeset 001 … post-delta note — 2026-09-30" ending ~:1230) containing: the re-runnable command fences, suite counts and bench gate numbers (from P1.M2.T1.S2), the four live-smoke captures with the pacing note (from P1.M2.T1.S3), the §1a drift verdict (expected NONE FOUND), and the post-smoke tree-cleanliness note. A one-line changeset summary mentioning P1.M2.T1.S1's README sync.

**Success Definition**: `git diff` on docs/M1-DoD.md shows pure additions at end-of-file (zero modified/deleted prior lines); every number matches the sibling research evidence verbatim; the section is self-contained and re-runnable (fenced commands a reader can copy-paste); no other file touched.

## Why

- AGENTS.md: interactive changes must land code + spec + docs in agreement; this task IS the changeset-level documentation record ([Mode B] — docs/M1-DoD.md is the only file written).
- The arrow-model-v2 work (decision table, wiring, 52-case battery rewrite) and its acceptance evidence (gauntlet counts, gate numbers, live-smoke captures) currently live only in sibling research directories — the DoD file is hapax's durable history where every prior changeset recorded its evidence (most recent precedent: the M3 post-delta re-verification section, :986–1230).

## What

### Inputs (consume exactly; do not re-run what S2/S3 already measured unless verifying)

| Input | Source file | What to take |
|---|---|---|
| Environment block (date, head commit full sha + subject, Node/vitest versions) | `plan/005_f9498a2d63d5/P1M2T1S2/research/gauntlet-evidence.md` | verbatim |
| Gauntlet: `npm run check` exit 0; `npm test` suite counts verbatim; the five-gate bench numbers (anchored-fuzzy <1 ms p99 · tier-0 <3 ms p99 · dict load+sweep <60 ms · ingest <180 ms CI bound · heap <6 MB) + any watch/honesty notes | same | verbatim, incl. perf-gates file invocation |
| §1a drift spot-check: 9-row verdicts, expected header "Drift report (spec read-only this run): NONE FOUND" | same | verbatim; any residuals restated |
| Four live-smoke scenarios (i boundary pass-through, ii → one-word forward, iii carousel+Escape+re-offer, iv Tab+Enter) each with PASS, the pacing note ("typed one char at a time, 0.12 s apart"), verbatim before/after `capture-pane` blocks, "Reading:" lines | `plan/005_f9498a2d63d5/P1M2T1S3/research/live-smoke.md` | PASS verdicts + pacing note + a COMPRESSED capture excerpt per scenario (one representative before/after pair + its Reading line); full captures stay in research/ — mirror how the M3 precedent (:1054–1165) compressed them |
| README sync (P1.M2.T1.S1) | — | mention in the changeset summary line + tree-cleanliness working-tree note (precedent :993–999: "README.md was dirty at sweep time — P1.M2.T1.S1's own docs deliverable") |
| Named widget battery cases | S2's counts + S3's readings | quote test names verbatim from evidence, never from memory |

**STOP gate**: if S2's evidence shows any red command or S3's record shows a FAIL scenario, do NOT append a PASS record — record the blocker in your own `research/` and report back (fixes are not this task's mandate).

### The append (pattern — mirror the M3 section :986–1230)

Structure the new section in this order (all `##`/`###` headings + fenced commands + dated bullets):

1. **Dated section header**: `## Arrow-model-v2 changeset (widget boundary pass-through + interaction carousel) — post-changeset re-verification (P1.M2.T1.S4, 2026-XX-XX)` — use the actual completion date. Precede with one append-only note line: everything above this point (through the bugfix-001 post-delta note) is untouched.
2. **Sweep metadata block**: sweep date · head commit (full sha + subject of the changeset's last code commit — get via `git log --oneline -1`; if the tree is dirty with the DoD append itself, note it) · environment (Linux x64, Node, vitest versions from S2) · working-tree note (README.md = S1's parallel deliverable).
3. **Verdict line**: "Verdict: changeset DONE." — gauntlet items PASS, live smoke 4/4 PASS, drift NONE FOUND.
4. **Gauntlet items** (`### <name>: PASS` inside the dated section, or `## Gauntlet item N — …: PASS`):
   - *type check clean* — fence `$ npm run check`; dated bullet with exit code.
   - *all tests green* — fence `$ npm test`; dated bullet with suite counts bolded (`**N test files, N passed / N skipped**` — preserve the "same pre-existing gc-dependent skip" note if counts still show 1 skipped); name the changeset's own suites (the rewritten `test/widget.test.ts` v2 battery) with case names quoted verbatim.
   - *performance gates* — fences `$ npx vitest --run test/perf-gates.test.ts --disable-console-intercept` and `$ npm run bench`; the gate-number table (Budget / Measured / vs budget / CI bound / Verdict) transcribed from S2, watch flags carried honestly.
   - *widget battery* — fence `$ npx vitest --run test/widget.test.ts`; counts + the v2 model's named cases (boundary pass-through one-press, carousel wrap both edges, generation reset, Tab-insert synchronous, Enter submits, inner-instance-never-mutated pin).
5. **Live smoke item** (`### Live smoke (spec/09 h2.57, BINDING): PASS`): the technique line (tmux pane 200×50, `pi --no-session`, seed + Ctrl+C, one-char-at-a-time 0.12 s pacing — burst-typing caveat), then one compressed sub-block per scenario (i–iv): name, PASS, the pacing note, ONE representative before/after capture pair (verbatim from S3) + its "Reading:" line.
6. **Drift report**: `### Drift report (spec read-only this run): NONE FOUND` — restate the 9-row §1a verdicts (numbered, ✅, file:line) and S1's residuals, per the :1166–1199 precedent.
7. **Tree cleanliness (post-smoke)**: from S3's closing claims — no instrumentation, `git status` shows only README.md (S1) and docs/M1-DoD.md (this section), zero src/test/spec files, tmux killed.
8. **Reproduction**: one fenced block — `git rev-parse HEAD`, `npm run check`, `npm test`, `npx vitest --run test/perf-gates.test.ts --disable-console-interpret`-style gate invocation, `npm run bench`, the widget battery invocation, and a commented live-smoke sketch (mirror :1211–1229's comment style).

### Success Criteria

- [ ] New dated section appended at end of docs/M1-DoD.md; zero prior lines changed (`git diff docs/M1-DoD.md` → additions only)
- [ ] Every count/gate number/verdict traceable verbatim to S2/S3 research files
- [ ] Four smoke scenarios each present with pacing note + capture excerpt + Reading line
- [ ] Drift verdict NONE FOUND recorded (or blocker reported instead of a false PASS)
- [ ] README sync mentioned in summary line + tree note; no other file edited

## All Needed Context

### Context Completeness Check

An implementer needs: the file's append-only pattern, a worked structural template (the M3 section), the sibling input contracts, and the verification commands. All cited below.

### Documentation & References

```yaml
- file: docs/M1-DoD.md (L986–1230)
  why: THE structural precedent — the most recent dated changeset record
        (M3 post-delta re-verification): header, metadata block, verdict
        line, gauntlet items with fences + dated bullets + gate table,
        live-smoke compression with Reading lines, drift report, tree
        cleanliness, reproduction block. Copy the format, update facts.
  gotcha: APPEND-ONLY — never touch anything above the insertion point;
        worked example at :739–757 is historical old-model evidence, do
        not "fix" it.

- file: plan/005_f9498a2d63d5/architecture/external_deps.md
  section: "docs/M1-DoD.md pattern (1261 lines, APPEND-ONLY)" (~L33–41)
  why: Binding pattern summary: `## Gauntlet item N — <name>: PASS` (or
        `### <item>: PASS` inside a dated section) → fenced re-runnable
        commands → dated bullet with suite counts, gate numbers, named
        test cases quoted verbatim.

- file: plan/005_f9498a2d63d5/P1M2T1S2/PRP.md (and its research/gauntlet-evidence.md once written)
  why: Input contract: gauntlet counts, bench gate numbers, 9-row §1a
        drift verdicts. Transcribe verbatim; S2's PRP defines the exact
        expected evidence shape.

- file: plan/005_f9498a2d63d5/P1M2T1S3/PRP.md (and its research/live-smoke.md once written)
  why: Input contract: the four scenarios' PASS evidence, pacing notes,
        capture blocks, Reading lines; zero-instrumentation + clean-tree
        closing claims to restate.

- file: plan/005_f9498a2d63d5/P1M2T1S1/research/notes.md
  why: What S1 changed (README invariant-1 re-mirror) — enough to write
        the one-line summary mention accurately.

- file: spec/09-testing-and-acceptance.md (h2.58 gates table, h2.60 M1 DoD)
  why: The five gate budgets the bench table must reference; the DoD
        framing. READ-ONLY — spec is never edited by this task.
```

### Current Codebase tree (relevant slice)

```bash
docs/M1-DoD.md            # 1261 lines, append-only target
plan/005_f9498a2d63d5/
  P1M2T1S1/research/notes.md          # README sweep research
  P1M2T1S2/research/gauntlet-evidence.md   # INPUT (counts, gates, drift)
  P1M2T1S3/research/live-smoke.md          # INPUT (captures, pacing)
  P1M2T1S4/research/research-notes.md      # this task's research
  architecture/external_deps.md        # pattern definition
```

### Desired Codebase tree

```bash
docs/M1-DoD.md            # + one dated section at end (~80–130 lines)
# nothing else changes
```

### Known Gotchas

```text
# CRITICAL: append-only — verify with: git diff docs/M1-DoD.md | grep -c '^-[^-]'  → must be 0
# Line numbers cited in research (:739–757, ~:1230) shift once you append —
#   cite by section NAME in the DoD text, not by line number.
# Suite counts: quote from S2's evidence run, not a fresh partial run; if you
#   re-verify with `npm test`, counts must match S2 or be re-measured fully.
# The one skipped test is pre-existing (gc-dependent dictionary case) — note
#   it if still present, per every prior record.
# README.md dirty in git status is EXPECTED (S1's parallel deliverable) — say
#   so in the working-tree note; do not "clean" it.
# Full capture blocks stay in research/ — the DoD gets compressed excerpts
#   (the M3 precedent compresses the same way).
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ inputs
  - plan/005_f9498a2d63d5/P1M2T1S2/research/gauntlet-evidence.md (counts, gates, drift)
  - plan/005_f9498a2d63d5/P1M2T1S3/research/live-smoke.md (captures, pacing, clean-tree claims)
  - plan/005_f9498a2d63d5/P1M2T1S1/research/notes.md (README summary line)
  - docs/M1-DoD.md L986–1230 (the M3 structural precedent)
  - STOP if any red/FAIL in the inputs (record blocker in research/, report)

Task 2: COLLECT current facts
  - git rev-parse HEAD; git log --oneline -1; git status --short
  - date; node --version; npx vitest --version (or take from S2's env block)

Task 3: APPEND the dated section to docs/M1-DoD.md (single append at EOF)
  - STRUCTURE: per "The append" above — 8 blocks in order
  - STYLE: fenced $-prefixed commands; bold suite counts; dated bullets
    `- 2026-XX-XX @ <sha>:`; gate table with Budget/Measured/vs/CI-bound/Verdict
  - NAMING: mirror prior heading grammar exactly ("Gauntlet item N — <name>: PASS")

Task 4: VERIFY
  - append-only: git diff docs/M1-DoD.md | grep -c '^-[^-]'  → 0
  - npm run check && npm test still green (doc-only change, but gate anyway)
  - every number in the new section present in S2/S3 research (spot-check 5)
```

### Integration Points

```yaml
DOCS: docs/M1-DoD.md only ([Mode B]); no spec/, README.md, src/, test/ writes
PLAN: research notes may go to plan/005_f9498a2d63d5/P1M2T1S4/research/
```

## Validation Loop

### Level 1–2: doc-only gate

```bash
git diff --stat                          # docs/M1-DoD.md (+ README.md from S1) only
git diff docs/M1-DoD.md | grep -c '^-[^-]'   # → 0 (append-only proof)
npm run check                            # exit 0
npm test                                 # green, counts match S2's evidence
tail -n 30 docs/M1-DoD.md                # new section renders, headings well-formed
```

### Level 3: coherence read

```bash
# The three documentation layers agree: spec/07 + SPEC.md invariant 1 (v2
# arrow model) ↔ README.md design-invariants mirror (S1) ↔ the new DoD
# section's named battery cases — read all three, confirm the same model
# vocabulary (boundary pass-through, interaction carousel, generation reset).
grep -n 'Gauntlet item' docs/M1-DoD.md | tail   # numbering continues sanely
```

## Final Validation Checklist

- [ ] New dated section at EOF; append-only proven (zero deleted/changed lines)
- [ ] Gauntlet items with re-runnable fences + dated bullets + suite counts + gate table
- [ ] Four live-smoke scenarios with pacing note + capture excerpts + Reading lines
- [ ] Drift report: NONE FOUND (9 rows restated) or blocker escalated instead
- [ ] Tree-cleanliness note; README/S1 mentioned in summary line
- [ ] `npm run check` + `npm test` green; no file outside docs/M1-DoD.md edited

## Anti-Patterns to Avoid

- ❌ Never edit or "correct" prior DoD sections (including the old-model :739–757 evidence)
- ❌ Never invent/round numbers — transcribe from S2/S3 evidence verbatim
- ❌ Never record a PASS gauntlet when inputs show red — escalate instead
- ❌ Don't paste the full research captures — compress like the M3 precedent
- ❌ Don't cite DoD line numbers inside the DoD (they shift on append); cite section names

---

**Confidence Score**: 9/10 — pure documentation append with a strong in-file precedent, explicit sibling input contracts, and mechanical append-only verification. The only risk is sibling evidence arriving incomplete/red, which the STOP gate handles.
