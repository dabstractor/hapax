# PRP — P3.M1.T2.S1: README sweep — relief blurb rewrite, feature blurbs, config-table defaults, verification wording

---

## Goal

**Feature Goal**: Bring `README.md` back into agreement with the landed code and
the spec after the P1 (capitalized-series), P2 (branch-hygiene rebuild), and
P3.M1.T1 (widget Tab deferral) changesets. Four defect classes: (1) the
relief-retirement blurb (:108-114) is half-obsolete — casing evidence is BACK
via capitalized runs + the 95-band; (2) the feature blurbs don't cover
capitalized-series completion, branch hygiene, or Tab deferral, and two casing
sentences describe the retired most-recent-casing-wins behavior; (3) the config
table (:467-474) shows stale defaults — `maxSuggestions` 8 (code: 20) and
`rejectCommonness` 12 (code: 30) — and the Calibration-guarantee section
(:424-437) repeats the stale `12` with a stale population count; (4) the
Development/Checks verification wording (:531, :606) doesn't mention the new
regression batteries.

**Deliverable**: Edited `README.md` ONLY (Mode B documentation task — this file
is the deliverable; no source, no spec, no test edits). Input to
P3.M1.T2.S4's DoD entry.

**Success Definition**: Every number, default, and behavioral claim in README
matches the shipped code (`src/pi/config.ts` `DEFAULT_CONFIG`,
`src/core/score.ts` constants) and the spec's rules; the three new behaviors
(series completion, branch hygiene, Tab deferral) have feature-blurb coverage;
`git diff --stat` shows exactly one file (`README.md`); `npm run check` +
`npm test` still green vs baseline (README edits cannot break them, but the run
proves nothing else was touched).

## User Persona (if applicable)

**Target User**: pi users evaluating hapax from its README, and future
implementers using it as the entry map to the codebase.

**Use Case**: A reader decides whether `rejectCommonness` needs tuning, or
whether hapax will hijack Tab over pi's own menu — and gets answers that match
the shipped binary.

**User Journey**: read Features → try the Quick start → consult the config
table → run the Checks. Every step's claims must be true of the build.

**Pain Points Addressed**: config docs that lie about defaults (12/8 vs 30/20)
cause mis-tuned installs; a relief blurb saying proper-nouns are gone hides the
new headline feature; verification docs omitting the new batteries hide the
regression pins.

## Why

- AGENTS.md / spec h2.1: spec is the single source of truth; README is a
  summary that must never contradict it or the code. The floor/width retunes
  (commit 5855f83) and the casing rework landed with no README follow-up.
- Sibling items are gated on this: S2 (full gauntlet), S3 (live smoke), S4
  (M1-DoD append + drift report) — S4's DoD entry consumes a coherent README.
- The relief blurb actively misleads: it says named-entity completion is
  retired and would need an allowlist redesign, while capitalized runs now
  deliver exactly that class of completion (spec 04 h2.26).

## What

All edits are to `README.md`. Four work packages (anchors measured at HEAD
50a7801; RE-ANCHOR before editing — see Level 0):

### WP1 — Relief blurb rewrite (:108-114)

Replace the "Proper-noun relief — retired (2026-09)" bullet with a blurb whose
shape is: **proper nouns are back — via runs and the relaxed band, not relief.**

Must state (concise, README voice, file refs per house style):

- The 2026-09 relief branch stays **retired-in-place**: its ceiling
  (`PROPER_NOUN_ADMIT_CEILING` in `src/core/score.ts`) equals the reject floor
  and scales with retunes, so it admits nothing beyond the floor.
- Casing evidence re-entered through two 2026-10 doors: **capitalized runs**
  (spec 04 h2.26 — full coverage in the new series blurb, WP2) and **single
  mid-sentence capitals** admitting under the relaxed band
  `max(R_eff, 95)` (`MID_CAP_RELAXED_BAND`, `src/core/score.ts`).
- The **noise guard** that makes the doors safe: run members whose dictionary
  commonness sits in the table's top band
  (`PROPER_SERIES_TOP_BAND_CEILING = 135`) are **chain-only** — never standalone
  suggestions, but their series bigrams still form and offer neighbors
  (`The ` → `Fed`). This replaces the retired relief's job without re-admitting
  the ~483 capitalized common words the 2026-09 audit caught (`echo`,
  `windows`, `failed`) — that audit sentence may be kept as history.
- Keep the pointer that mechanism/calibration history live in
  `src/core/score.ts`.

### WP2 — Feature-blurb additions + casing fixes (under `## Features`, :32+)

1. **ADD a "Capitalized-series completion" bullet** placed immediately AFTER
   the existing "Chained Tab completion" bullet (they share the successor
   index). Content (spec 01 h2.9 goals 11-13 + 04 h2.26 + 07 h2.53, per the
   landed P1.M1/P1.M2 contracts):
   - Runs of ≥ 2 consecutive capitalized whole words are recognized as
     proper-noun series wherever they sit (line-initial/after punctuation
     included); every member becomes completable vocabulary — a run member
     admits regardless of the commonness band (attested members land in
     admission group 1, dictionary-absent members in group 0), outranking both
     dictionary attestation and lowercase sightings.
   - The words chain: series bigrams are recorded at ingest
     (`recordBigramRuns`, `src/core/store.ts`), and completing or typing a
     member (a space closing an UPPERCASE-initial typed word — lowercase
     typings never arm) arms the next member as the top zero-typed-character
     offer, series successors first, on BOTH display paths
     (`src/pi/provider.ts`, `src/pi/widget.ts`).
   - Dictionary top-band members are chain-only (WP1's noise guard) —
     `The ` still offers `Fed`.
   - Casing admits, never ranks: result ordering stays
     tier → sessionCount → length → lex.
2. **ADD a "Branch hygiene" bullet** placed near "Session salience retention"
   (or after "Zero persistence…"). Content (spec 05 h2.37; P2 landed —
   commit 50a7801):
   - The store is a pure function of the ACTIVE branch's replayable history:
     on `/tree` navigation (`session_tree`), hapax discards pending ingest,
     snapshots `ctx.sessionManager.getBranch()`, and replays it through the
     identical restore pipeline into a fresh store — words typed on an
     abandoned branch (e.g. a misspelling submitted, then `/tree` back to fix
     it) never surface on other branches.
   - Queries are gated at the same seam as startup restore; the first
     post-navigation query resolves at replay settle (tens of ms, background).
     Compaction never triggers a rebuild — the store survives compaction.
   - File refs: `src/pi/index.ts` (handler), `src/core/store.ts` (`reset()`),
     `src/pi/ingest.ts` (`discardPending()`); pinned by
     `test/branch-purity.test.ts`.
3. **EXTEND the "Stock contexts are never preempted" bullet** (widget-path
   paragraph) with the Tab-deferral clause (P3.M1.T1.S1 contract): when pi's
   OWN autocomplete menu is open (forced file menu, slash-argument menu, any
   stock surface), the widget Tab forwards verbatim — pi's menu accepts its
   highlighted item; hapax never inserts over it. Deferral keys on the menu's
   actual open state (`isShowingAutocomplete()`), not context classification,
   because the menuDelayMs race can re-arm the hapax line while pi's menu is
   open. Ref: `src/pi/widget.ts`, `src/pi/editor.ts`,
   `test/defer-pi-menu.repro.test.ts`.
4. **FIX the two stale casing sentences** (casing resolution moved from
   stored-display (most-recent-wins) to completion-time resolution from casing
   tallies — P1.M2.T1.S1/S2, landed):
   - "Case-preserving insertion" bullet (:~120): "insertion uses the casing
     last seen in-session" → insertion casing is resolved at completion time
     from the candidate's casing tallies: a typed capital first letter is
     never uncased; an all-lowercase fragment gets the form that occurred more
     often in the conversation (ties → lowercase; a word seen only
     capitalized completes capitalized). (spec 04 "Case handling".)
   - Chained bullet (:~184): "Inserted chain words use the candidate's display
     casing (most-recent-casing-wins)" → chain words insert with the same
     completion-time resolution as word completions (series successors insert
     in their run casing).

### WP3 — Config table + Calibration guarantee (:467-474, :424-437)

- `maxSuggestions` row: Default `8` → `20`; rewrite the Meaning cell to the
  width-bound rationale (matches `src/pi/config.ts` comment + spec 08 h2.56):
  the widget line's real cap is the TERMINAL WIDTH (rightmost items drop
  first); the count is a sanity ceiling, so the default sits at the schema max
  (2026-10 retune) — tune down for fewer words per line.
- `rejectCommonness` row: Default `12` → `30` (the baked
  `REJECT_COMMON_THRESHOLD` in `src/core/score.ts`, width-bound retune
  2026-10). The row's Meaning cell is otherwise accurate — keep it.
- Verify every OTHER row against `DEFAULT_CONFIG` (verified correct at HEAD:
  `triggerChar "…"`, `threshold 2`, `fuzzThreshold 60`, `menuDelayMs 0`,
  `enableChaining true`, `debug false`) — change nothing there unless a re-read
  of `src/pi/config.ts` contradicts this PRP.
- Calibration guarantee (:426-429): `REJECT_COMMON_THRESHOLD = 12` → `= 30`;
  recompute the population claim "45,118 of the 48,802 entries score q ≥ 12"
  at floor 30 (see Level 4 — the calibrate tool computes `popReject` counts
  internally, `tools/calibrate-bands.mjs:141`); keep or trim the named
  examples — all still reject at floor 30 (`the` 240, `context` 51, `data` 82,
  `code` 91, `lazy` 67, `ordinary` 79, `provider` 34), and `handoff` (q = 10)
  still admits. Do NOT hand-wave a number — recompute or drop the sentence.
- The "English words barely admit" feature bullet never states `12` — leave it
  (verified).

### WP4 — Development/Checks verification wording (:531, :606)

- In `#### Checks` (:606), extend the "npm test gate also runs the adversarial
  suites" sentence to name the two new batteries:
  `test/defer-pi-menu.repro.test.ts` (widget Tab defers to pi's open menu)
  and `test/branch-purity.test.ts` (branch-hygiene rebuild + gated replay).
- Do NOT add live-verification claims for the new behaviors: the live smoke is
  S3's deliverable (spec 09 binding) and lands after this item. Existing
  live-verified claims (Status paragraph, Dev-loop paragraph) stay as-is.
- Re-read the Dev-loop (:~545-556) and Status (:13) paragraphs once against
  the new behaviors; they remain accurate (they describe M3-era
  verifications). Only adjust wording if a sentence becomes false — not to
  add new claims.

### Success Criteria

- [ ] Relief blurb rewritten per WP1 (runs + 95-band in, relief
      retired-in-place, top-band ceiling as noise guard).
- [ ] Series-completion and branch-hygiene blurbs present; stock-contexts
      bullet carries the Tab-deferral clause; both casing sentences fixed.
- [ ] Config table defaults read 20 / 30; width-bound rationale on
      `maxSuggestions`; Calibration guarantee says 30 with a recomputed (or
      dropped) population count.
- [ ] Checks section names both new batteries; no new live-verification
      claims.
- [ ] `git diff --stat` → exactly `README.md`; `npm run check` green;
      `npm test` green vs baseline.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this
successfully?" — Yes: every stale claim is quoted with its anchor and its
replacement content is specified against verified code constants and spec
sections; re-anchoring and verification commands are provided.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: README.md
  why: THE deliverable. 626 lines at HEAD. Re-anchor every target first:
    grep -n -E "Proper-noun relief|^## Features|Case-preserving|display casing|REJECT_COMMON_THRESHOLD|45,118|^\| .(triggerChar|threshold|maxSuggestions|rejectCommonness|fuzzThreshold|menuDelayMs|enableChaining|debug)|^### Development|^#### Checks" README.md
  gotcha: anchors in this PRP were measured at HEAD 50a7801 and drift by a few
    lines is possible — always edit by matched text, never by raw line number.

- file: src/pi/config.ts
  why: DEFAULT_CONFIG is ground truth for every config-table Default cell
    (maxSuggestions: 20, rejectCommonness: REJECT_COMMON_THRESHOLD import,
    fuzzThreshold: DEFAULT_FUZZ_THRESHOLD import, menuDelayMs: 0,
    triggerChar "#", threshold: 2, enableChaining true, debug false). Its
    maxSuggestions comment holds the width-bound rationale to paraphrase.

- file: src/core/score.ts
  why: the four constants the blurbs cite — :109 REJECT_COMMON_THRESHOLD = 30;
    :152 PROPER_NOUN_ADMIT_CEILING = 30 ("retired-in-place; scales with
    retunes"); :169 PROPER_SERIES_TOP_BAND_CEILING = 135; :192
    MID_CAP_RELAXED_BAND = 95. Calibration history for the relief blurb lives
    in this file's comments.

- docfile: plan/006_7bd0258da993/P3M1T2S1/research/notes.md
  why: verified anchors, constant values, behavior contracts, and the
    worked example list (which q values still reject/admit at floor 30).

- file: plan/006_7bd0258da993/P3M1T1S1/PRP.md
  why: CONTRACT for the Tab-deferral behavior (item Implementing in
    parallel): forward-verbatim when isShowingAutocomplete() === true, keyed
    on actual open state, battery test/defer-pi-menu.repro.test.ts. Do not
    restate its code details in README — one clause is enough.

- file: plan/006_7bd0258da993/P1M2T2S1/PRP.md
  why: CONTRACT for series-first offers + typed-word arming (fallback path;
    widget mirrors per spec 07 h2.53): uppercase-initial typed word + space
    arms; lowercase never arms; series successors first, run casing. The
    series blurb describes exactly this behavior.

- file: tools/calibrate-bands.mjs
  why: recomputes the population reject count for the Calibration guarantee
    (popReduce at :141; run `node tools/calibrate-bands.mjs the with context
    handoff` for q values; no-args/word-args output includes population
    stats vs floor R).

- file: spec/SPEC.md (+ numbered spec files)
  why: source of truth the README summarizes — spec 01 h2.9 (series goals),
    04 "Capitalized runs"/"Case handling", 05 "Branch navigation rebuild",
    07 h2.51-53 (never-hijack/chaining), 08 h2.56-57 (config schema).
    READ-ONLY: this pipeline item must not edit spec/ (AGENTS.md policy).
  gotcha: spec/PRD heading numbers (h2.x/h3.x) are PRD-index numbering; the
    spec files use unnumbered headings. README house style cites bare
    section names or "(spec 04)" — follow existing README citations.
```

### Current Codebase tree (relevant excerpt)

```bash
README.md                        # THE deliverable (626 lines)
src/core/score.ts                # constants: 30 / 30 / 135 / 95
src/pi/config.ts                 # DEFAULT_CONFIG ground truth
tools/calibrate-bands.mjs        # population/q recomputation
test/defer-pi-menu.repro.test.ts # battery named by the new Checks wording
test/branch-purity.test.ts       # battery named by the new Checks wording
spec/                            # READ-ONLY reference
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. Modified (README.md only):
README.md  # WP1 relief blurb; WP2 three coverage areas + 2 casing fixes;
           # WP3 config-table defaults + calibration numbers;
           # WP4 Checks wording
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: spec/ is READ-ONLY for this item (pipeline agent; AGENTS.md +
#   spec h2.1). README never overrides spec — when phrasing tightens, keep
#   README a summary; cite spec, don't restate exhaustively.

# CRITICAL: no live-verification claims for the new behaviors — the live
#   smoke is P3.M1.T2.S3's BINDING deliverable and runs AFTER this item.
#   Existing "live-verified" sentences describe past events and stay.

# Line anchors drift: parallel item P3.M1.T1.S1 does not touch README, but
#   always re-grep anchors before editing; edit by exact text match.

# The config table is a wide pipe table — keep every row's pipe count valid
#   and align cells the way existing rows do; no linter exists to catch
#   broken tables (only a rendered read-through).

# Commit 5855f83 LOOSENED the floor 12 → 30 (higher = looser: reject iff
#   q >= threshold) — do not describe 30 as "stricter" in any prose.
#   maxSuggestions 20 is a width-bound retune tied to the same changeset.

# casing resolution: "frequency-wins from tallies", NOT "last seen" and NOT
#   "most-recent-casing-wins" (both retired with Candidate.display,
#   P1.M2.T1.S2). Typed capital first letter is preserved — only the first
#   letter adapts.

# Do not cite file paths that don't exist: the casing resolver landed in
#   core (P1.M2.T1.S1) — pin its actual module with
#   grep -rn "resolveInsertionCasing\|casingResolver\|resolveCasing" src/core
#   before citing it, or cite src/core/store.ts (tallies) generically.
```

## Implementation Blueprint

### Data models and structure

None — prose-only change to one Markdown file.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRE-FLIGHT (verify the world the README will describe)
  - RUN: git log --oneline -12   # confirm series/branch/deferral changesets
    landed (5855f83 floor retune, 50a7801 branch rebuild, the P3.M1.T1.S1
    deferral commit, P1.M2 series-offers commits)
  - RUN: ls test/defer-pi-menu.repro.test.ts test/branch-purity.test.ts &&
    npx vitest run test/defer-pi-menu.repro.test.ts test/branch-purity.test.ts
    # both must exist and be green before README names them
  - RUN: the anchor re-grep (Documentation section) and the resolver-file
    grep; note any drift
  - IF a P1.M2 dependency visibly hasn't landed (batteries red/absent):
    still describe the behavior per spec (spec is truth) but flag it in the
    report for S2/S4 — do not invent landed-state claims.

Task 1: WP1 — rewrite the relief blurb (:108-114)
  - REPLACE the whole bullet with the runs/95-band/retired-in-place blurb
    specified in WP1; keep README voice (bold lead, file refs in parens).
  - KEEP the ~483-word audit sentence only as explicit history
    ("the 2026-09 audit that retired it caught ~483 capitalized common
    words — the top-band ceiling now guards that class").

Task 2: WP2 — feature-blurb additions and casing fixes (:32+)
  - ADD "Capitalized-series completion" bullet AFTER the chained-completion
    bullet; ADD "Branch hygiene" bullet near "Session salience retention";
    EXTEND the stock-contexts bullet with the Tab-deferral clause (WP2.3
    text).
  - FIX the two casing sentences (WP2.4) by exact-text replacement.
  - MATCH the existing bullet style: "- **Bold lead** — explanation
    (`file refs`)."

Task 3: WP3 — config table + calibration numbers (:467-474, :424-437)
  - EDIT the two Default cells (8→20 with width-bound Meaning rewrite;
    12→30), verify the other six rows against src/pi/config.ts, change only
    what contradicts.
  - RECOMPUTE the q >= 30 population count via tools/calibrate-bands.mjs
    (Level 4) and update :426/:429; drop the count sentence rather than
    guess.

Task 4: WP4 — Checks wording (:606)
  - EXTEND the adversarial-suites sentence with the two battery names.
  - READ-THROUGH Status (:13) + Dev-loop (:~545-556): no edits unless a
    sentence is now false.

Task 5: VALIDATION LOOP (below) — all levels, in order.
```

### Implementation Patterns & Key Details

```markdown
<!-- Relief blurb target shape (adapt prose; keep every fact): -->
- **Proper nouns — back via runs, not relief (2026-10)** — the 2026-09
  relief branch stays retired-in-place (ceiling == reject floor, scales
  with retunes — PROPER_NOUN_ADMIT_CEILING in `src/core/score.ts`).
  Casing evidence re-entered through two doors: capitalized runs
  (below) and single mid-sentence capitals under the relaxed band
  max(R_eff, 95) (`MID_CAP_RELAXED_BAND`). The noise guard is the
  dictionary top-band ceiling (q ≤ 135, `PROPER_SERIES_TOP_BAND_CEILING`):
  such members are chain-only — `The ` still offers `Fed` — so the ~483
  capitalized common words of the 2026-09 audit (`echo`, `windows`,
  `failed`) stay out of standalone results.

<!-- maxSuggestions Meaning cell target shape: -->
sanity ceiling on candidates offered at once — the widget line's real cap
is the terminal width (rightmost items drop first), so the default sits at
the schema max (2026-10 width-bound retune); tune down for fewer words
per line
```

### Integration Points

```yaml
NO code/config/spec integration points. Downstream consumers:
- P3.M1.T2.S2 (gauntlet): unaffected; run BEFORE it so the tree is coherent.
- P3.M1.T2.S3 (live smoke): README must not pre-claim its results.
- P3.M1.T2.S4 (DoD append + drift report): consumes this README as input;
  any spec/README divergence found later goes in its drift report.
```

## Validation Loop

### Level 0: Re-anchor

```bash
grep -n -E "Proper-noun relief|^## Features|Case-preserving|display casing|REJECT_COMMON_THRESHOLD|45,118|^### Development|^#### Checks" README.md
```

### Level 1: Syntax & Style (Immediate Feedback)

```bash
git diff --stat          # Expected: README.md ONLY (1 file changed)
npm run check            # Expected: zero errors (proves no code was touched)
```

### Level 2: Unit Tests (Component Validation)

```bash
npm test
# Expected: green vs baseline — the ONLY permitted failure is the known
# environmental network-gated case (test/acceptance.test.ts "pi -p loads
# the real extension...", documented in architecture/04 §2 and owned by
# P3.M1.T2.S2's gauntlet). Any other failure = something besides README
# changed — revert it.
```

### Level 3: Integration Testing (System Validation)

```bash
# Stale-claim sweep — all must return NOTHING:
grep -n "REJECT_COMMON_THRESHOLD = 12\|score q ≥ 12\|score q >= 12" README.md
grep -n "45,118" README.md
grep -n "| \`8 \`" README.md | grep -i maxsuggestions
grep -n "last seen in-session\|most-recent-casing-wins" README.md
grep -n "Proper-noun relief — retired" README.md

# New coverage present — each must match:
grep -cn "series" README.md                                    # >= 4
grep -n "chain-only" README.md                                 # present
grep -n "session_tree\|branch" README.md | grep -ci hygiene     # >= 1
grep -n "defer" README.md                                      # Tab-deferral clause present
grep -n "branch-purity.test.ts\|defer-pi-menu.repro.test.ts" README.md  # both named

# Every cited file exists (spot-check the new refs):
ls test/defer-pi-menu.repro.test.ts test/branch-purity.test.ts
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Recompute the population count for the Calibration guarantee:
node tools/calibrate-bands.mjs the with context handoff
# (prints q + verdict per word; the tool's population section computes
#  count(q >= floor) — read the floor-30 number from it, or replicate its
#  quantile logic in a throwaway node -e script; never estimate by hand.)

# Rendered read-through (binding for docs changes):
# 1. View README.md rendered (or read top-to-bottom): the config table's
#    pipes/columns render; no bullet numbering/duplication artifacts.
# 2. Cross-read each new/edited claim against the spec section it
#    summarizes (spec 01 h2.9, 04 Capitalized runs + Case handling,
#    05 Branch navigation rebuild, 07 never-hijack, 08 Schema) — README
#    must be a faithful summary, never a contradiction (spec h2.1).
# 3. Confirm no NEW live-verification/performance claims were added.
```

## Final Validation Checklist

### Technical Validation

- [ ] Level 1-4 all green; stale-claim sweep returns nothing
- [ ] `git diff --stat` = README.md only; `npm run check` green
- [ ] `npm test` green vs baseline (only the known environmental case may fail)
- [ ] Calibration population count recomputed at floor 30 (or sentence dropped)

### Feature Validation

- [ ] WP1: relief blurb = runs + 95-band + retired-in-place + top-band guard
- [ ] WP2: series blurb, branch-hygiene blurb, Tab-deferral clause, 2 casing
      fixes — all landed; casing phrasing is frequency-wins-from-tallies
- [ ] WP3: defaults 20/30 in table; width-bound rationale; other rows verified
- [ ] WP4: both batteries named in Checks; no new live claims
- [ ] Every file/test the README cites exists at HEAD

### Code Quality Validation

- [ ] README bullet/table style matches surrounding house style
- [ ] No spec edits (spec/ untouched — `git diff --stat` proves it)
- [ ] No content copied beyond summary level — spec remains authoritative

### Documentation & Deployment

- [ ] Report notes any dependency that hadn't landed at edit time (for S2/S4)
- [ ] Drift between README wording and spec recorded in the report for
      P3.M1.T2.S4's drift report if any was found and not resolvable here

## Anti-Patterns to Avoid

- ❌ Don't edit `spec/`, `PRD.md`, `tasks.json`, or any source/test file —
  README.md is the entire deliverable.
- ❌ Don't describe floor 30 as "stricter" — the retune LOOSENED admission.
- ❌ Don't add live-verification or performance claims for the new behaviors
  (S3 owns the live smoke; perf gates are unchanged).
- ❌ Don't keep the stale casing vocabulary ("last seen in-session",
  "most-recent-casing-wins", "display casing") anywhere.
- ❌ Don't hand-wave the 45,118-style population count — recompute or drop it.
- ❌ Don't restate spec sections exhaustively — README is a summary with refs.
- ❌ Don't cite files by guessed paths — verify each path exists before
  citing it.

---

**Confidence Score**: 9/10 — every stale claim is pinned to a measured anchor
with verified code constants and spec backing; the task is prose-only with a
deterministic grep sweep as its gate. Residual risk: sibling P1.M2 widget
series-offer code landing after this PRP was written (mitigated by Task 0's
pre-flight check — behavior is described per spec either way) and the
population-count recomputation requiring one tool run with non-obvious output
shape.
