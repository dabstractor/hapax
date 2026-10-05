---
name: "P1.M2.T1.S2 — Wire resolver at match construction (both sites); remove Candidate.display (rev 2)"
description: |
  Completion-time casing cutover: resolve RankedMatch.display at BOTH query.ts
  construction sites via resolveCompletionCasing + rawFirst threading; delete
  Candidate.display (types.ts + both store upsert writes); migrate the five
  direct readers to interim capDisplay-based forms. REV 2 after issue feedback:
  the technical plan from rev 1 was executed correctly — the failure was the
  VALIDATION GATE, which demanded "npm test fully green" while a proven
  pre-existing red suite (test/defer-pi-menu.repro.test.ts, 3/4 tests, owned
  by P3.M1.T1.S1) makes that unreachable. This PRP adds the baseline
  carve-out protocol and an audit path for the in-place diff.
---

## Goal

**Feature Goal**: Every completion the user sees or inserts carries casing
resolved AT COMPLETION TIME from the candidate's casing tallies plus the LIVE
fragment's original first letter (spec 04 h2.32, PRD R2.1) — the stored
`Candidate.display` recency field is deleted, and nothing downstream changes
behavior except reading the resolved string.

**Deliverable**:
1. `rankMatches` in `src/core/query.ts` captures `rawFirst` (the fragment's
   original-casing first letter, BEFORE lowercasing) and sets
   `display: resolveCompletionCasing(c, rawFirst)` at BOTH RankedMatch
   construction sites (anchored/gated loop + tier-0 anchorless pass), with
   Mode-A JSDoc citing spec 04 h2.32.
2. `Candidate.display` removed from `src/core/types.ts` and both upsert
   writes in `src/core/store.ts` (create + "most recent wins" merge), with
   Mode-A JSDoc on the migrated merge. `Sighting.display` and all tally
   writes stay.
3. Five migrated direct readers: `debug.ts` ×3 → interim
   `capDisplay !== "" ? capDisplay : key` + `TODO(P1.M2.T3.S1)`;
   `provider.ts` successor label + `widget.ts` chainShim → interim
   `capDisplay || s.next` + `TODO(P1.M2.T2)`.
4. Query battery extensions + migration of every test that reads
   `Candidate.display`.
5. Validation evidence: `npm run check` exit 0; `npm test` green EXCEPT the
   recorded pre-existing baseline failures in `test/defer-pi-menu.repro.test.ts`
   (see Issue-Feedback Response — this carve-out is the rev-2 fix).

**Success Definition**:
- [ ] `grep -n "display" src/core/types.ts` shows `display:` ONLY on
      `Sighting` (raw sighting form) and `RankedMatch` (resolved form) —
      NOT on `Candidate`.
- [ ] `npm run check` exits 0.
- [ ] `npm test`: **every suite green except `test/defer-pi-menu.repro.test.ts`,
      which fails with EXACTLY the 3 test names recorded in the Task-0
      baseline (3 failed | 1 passed) — identical before and after this
      task's diff.** No new failures anywhere; no test skipped, quarantined,
      or edited to achieve this.
- [ ] ~20 downstream `RankedMatch.display` consumers are UNCHANGED (they
      keep reading the same field, now resolved).
- [ ] Ranking, `compareRankedMatches`, tier boundaries, exact-equal
      exclusion, plural pruning, thresholds: byte-identical (diff shows no
      hunks there).
- [ ] Final report states the baseline proof: the 3 failing test names, that
      the file is untouched by this task's diff, and that the same 3 failed
      at Task-0 baseline before any edit.

## User Persona (if applicable)

**Target User**: the developer typing in pi with hapax active (and, via
caps-series completion, the writer of capitalized proper-noun names).

**Use Case**: user types `Nr` intending `NREL`, or types `verd` after a
conversation full of lowercase `verdigris` — Tab inserts a form whose first
letter honors the Shift they actually pressed, and whose spelling follows
conversation frequency, never "most recently seen casing".

**User Journey**: type fragment → menu labels render with resolved casing →
Tab inserts exactly the rendered word (invariant 2: Tab-insert reads the live
synchronous query result, so query-time resolution IS completion-time
resolution).

**Pain Points Addressed**: recency-flip casing (display changing as
conversation continues, breaking muscle memory); a typed capital letter being
silently uncased.

## Why

- Spec 04 h2.32: "Insertion casing is resolved at completion time from the
  casing tallies… Menu labels use the same resolution against the live
  fragment's first letter." The store currently stores a recency-based
  `display` — this task is the cutover that makes code match spec.
- This is the keystone of the whole casing changeset: it defines the
  completion-time casing contract that P1.M2.T2 (series-first offers,
  `Successor.nextDisplay`), P1.M2.T3.S1 (/acwords tally columns), and
  P1.M1.T2.S2 (series bigrams) build on. Doing it late would multiply
  migration churn.
- `Candidate` casing already collapsed to tallies in P1.M1.T2.S1
  (capCount/lowerCount/capDisplay landed; `display` kept temporarily,
  documented in types.ts as "Removed by P1.M2.T1.S2"). The pure resolver
  `resolveCompletionCasing` landed in P1.M2.T1.S1 (commit `bad61ce`),
  exported and currently consumed at the two sites only by this task.

## What

User-visible: menu labels and Tab-inserts follow frequency-resolved casing
with Shift-preservation; `display` no longer flips with recency. Technical:
see Deliverable above.

### Success Criteria

- [ ] Typed-fragment casing: `Nr` → inserts `NREL` (raw-first pin);
      lowercase fragment + cap-heavy tallies → capitalized form; tie →
      lowercase; word seen ONLY capitalized → completes capitalized;
      all-caps sighting → verbatim; path/technical keys → verbatim.
- [ ] Zero-fragment `#` listing resolves via the frequency branch (rawFirst
      is `""`).
- [ ] Tier-0 anchorless results resolve casing exactly like anchored ones
      (same `rawFirst`).
- [ ] `store.test.ts` exact-literal `toEqual` assertions updated to the
      display-free Candidate shape; legacy "most recent casing wins" pins
      rewritten to the tally contract.
- [ ] Interim fallbacks never render `""` (empty capDisplay sentinel →
      key/`s.next`).
- [ ] Mode-A JSDoc at both query construction sites + the store upsert.

## ISSUE-FEEDBACK RESPONSE (rev 2 — READ FIRST)

**What happened in attempt 1**: every technical deliverable landed and
verified (`npm run check` exit 0; 1204 passed / 1 pre-existing skip), but the
final gate said "npm test fully green", and 3 tests in
`test/defer-pi-menu.repro.test.ts` fail. Those 3 failures are **proven
pre-existing**: they fail identically with the task's diff stashed; the file
first landed in commits `02b2501`/`515aa2f` (pre-dating this task); the fix
is OWNED BY P3.M1.T1.S1 ("Pre-check isShowingAutocomplete in the widget Tab
branch; harden repro into a regression suite"), which runs later in this
plan. Attempt 1 therefore honestly reported `result: "issue"`.

**The fix (this PRP)**: the gate is redefined to a **baseline-differential
gate** — not blanket green:

1. **Task 0 (BEFORE any edit)**: run
   `npx vitest run test/defer-pi-menu.repro.test.ts` and record the failing
   test names. Expected baseline (verified 2026-10-05, rev-2 research, with
   attempt-1 diff in tree): **3 failed | 1 passed** — failing:
   - `forced file menu (Tab on plain word) — pi's menu opens, then Tab inserts the PI item, not a hapax word`
   - `argument completion menu ('/model te') — pi menu auto-opens; Tab must accept pi's item`
   - `async race: pi's Tab-forced menu opens while the widget line is closed (menuDelayMs hesitation), then re-opens armed and steals the NEXT Tab`
   - passing: `pure slash typing ('/mo', no space) — the classified stock context — defers today (contrast case)`
   If the file is green at baseline, do NOT expect carve-out failures —
   proceed with the normal fully-green gate. If MORE than these 3 fail,
   stop and report (something else drifted).
2. **Scope fence (hard)**: this task NEVER edits
   `test/defer-pi-menu.repro.test.ts`, the widget Tab branch /
   `isShowingAutocomplete` / Tab-arbitration seam, or anything in the
   defer/Tab-consumption path (P3.M1.T1.S1 owns it). Do not fix, skip,
   `todo`-skip, quarantine, or delete the failing tests.
3. **Exit gate**: `npm test` must show NO failures outside the recorded
   baseline set, and the baseline file's results must be IDENTICAL
   (3 failed | 1 passed, same names). This is a PASS — report
   `result: "success"` with the baseline proof (names + "file untouched by
   my diff" + "identical at Task-0 baseline"). Do not report `issue` for the
   carve-out failures.
4. If any OTHER suite fails, that is yours to fix — the carve-out covers
   ONLY the three named tests.

**Tree state**: attempt 1's diff was left UNCOMMITTED in the working tree
(expected: `M` on src/core/{query,store,types}.ts, src/pi/{debug,provider,widget}.ts,
~13 test files, test/fixtures/sessions/expected.md). Task 0 branches on
`git status --short`: audit-and-complete if present, implement from scratch
if clean. Do NOT blanket-revert a present diff — it already satisfies most
of this PRP.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: every construction site,
reader, consumer, interim form, sentinel gotcha, test convention, and the
known-red baseline are enumerated below with file:line anchors (HEAD anchors
given pre-diff; with attempt-1's diff in tree, sites sit ~70 lines lower).

### Documentation & References

```yaml
- file: spec/04-tokenization-and-scoring.md
  why: h2.32 Case handling (completion-time resolution rules), h2.30 Query
    matching (two-scan structure: anchored + tier-0), h2.31 Query ranking
    (order that must NOT change)
  critical: h2.32 verbatim rules — uppercase fragment first letter →
    capitalized form wins (Shift never overridden, only FIRST letter
    adapted); all-lowercase fragment → higher tally wins (tie → lowercase;
    only-capitalized-seen → capitalized); all-caps → verbatim; paths/
    technical literals → verbatim. h2.41 Candidate interface is ALREADY
    display-free in spec (tallies only) — code is being brought INTO
    agreement, so NO spec edit is required (Mode A: JSDoc rides with code).

- file: plan/006_7bd0258da993/architecture/02-store-query-r1-r2.md
  why: §4 Query side — confirms the TWO `display: c.display` construction
    sites (anchored/gated loop; tier-0 anchorless pass), zero-fragment
    listing flowing through the anchored site with tier omitted, and §5
    .display consumer inventory
  critical: exact-equal exclusion lines and compareRankedMatches
    (tier desc → shorter key → sessionCount desc → byte-lex) are named
    MUST-NOT-CHANGE

- file: src/core/query.ts
  why: resolver (resolveCompletionCasing, ~:386 in attempt-1 tree), both
    construction sites (HEAD ~:531 anchored, ~:582 tier-0),
    compareRankedMatches ~:435, exact-equal exclusion ~:515/:560
  pattern: resolver signature
    `resolveCompletionCasing(c: Pick<Candidate,"key"|"capCount"|"lowerCount"|"capDisplay">, fragmentFirstLetter: string): string`
    — imported/defined in the same module; returns "" never
  gotcha: rankMatches lowercases the fragment BEFORE matching — rawFirst
    must be captured from the ORIGINAL `prefix` argument BEFORE
    `prefix.toLowerCase()` (see Implementation Patterns)

- file: src/core/store.ts
  why: upsert — HEAD ~:304 create (`display: sighting.display`) and ~:333
    merge (`existing.display = sighting.display` // most recent wins) are
    the two writes to DELETE; tally writes (capCount/lowerCount/capDisplay
    via forms map, ~:368-:379) stay untouched
  gotcha: capDisplay uses "" as the no-valid-cap-sighting sentinel — never
    compare with `??` (nullish) in new code; use `!== ""` or `||`

- file: src/core/types.ts
  why: Candidate interface (~:21) — delete the `display: string` field and
    its "KEPT (legacy, temporary)" doc comment; Sighting.display (~:78) and
    RankedMatch.display (~:198) STAY
  gotcha: Sighting.display feeds the tallies via upsert — deleting it breaks
    capDisplay refresh

- file: src/pi/debug.ts
  why: three Candidate.display readers (topSection ~:74, successorsSection
    ~:120, registerAcwordsCommand dump ~:203) → interim
    `${c.capDisplay !== "" ? c.capDisplay : c.key}` + `TODO(P1.M2.T3.S1)`
  gotcha: full tally-column treatment belongs to P1.M2.T3.S1 — keep the
    interim minimal

- file: src/pi/provider.ts
  why: successorDisplay closure (~:436) `store.get(s.next)?.display ?? s.next`
    → `store.get(s.next)?.capDisplay || s.next` + `TODO(P1.M2.T2)`
  gotcha: `||` not `??` — covers BOTH the "" sentinel and the
    evicted-entry undefined case; Successor.nextDisplay (P1.M2.T2) replaces it

- file: src/ui/../src/pi/widget.ts  # widget lives in src/pi/widget.ts
  why: chainShim (~:667) same successor-label fallback → same interim form
    + TODO(P1.M2.T2)
  critical: do NOT touch the widget Tab branch / menu deferral logic — the
    3 baseline failures live in that seam and P3.M1.T1.S1 owns it

- file: test/query.test.ts
  why: extend the battery — new describe pinning rawFirst threading
    ('Nr' → 'NREL'), lowercase/cap-heavy/tie frequency matrix, zero-fragment
    listing frequency branch, all-caps verbatim, path verbatim; S1's
    resolver battery already lives here
  pattern: hand-built candidates via makeStore fixtures
    (test/helpers/bench-fixtures.ts) or inline store upserts

- file: test/store.test.ts
  why: EXACT-object toEqual literals on s.get(key) — every literal drops
    `display`; the legacy recency-display pins (sightings with mixed casing
    asserted a most-recent display) get rewritten to assert the TALLY
    contract instead (capCount/lowerCount/capDisplay)
  gotcha: attempt 1 rewrote 4 such legacy pins — with the diff present,
    verify rather than re-derive

- file: plan/006_7bd0258da993/P1M2T1S2/research/notes.md
  why: rev-1 research notes — full .display consumer inventory and the
    rawFirst design decision

- file: plan/006_7bd0258da993/P1M2T1S2/issue_feedback.md
  why: attempt-1 disposition, verbatim — the proven-pre-existing proof and
    the file-history evidence (02b2501/515aa2f)
```

### Current Codebase tree (relevant slice)

```bash
src/core/
  query.ts        # rankMatches + resolveCompletionCasing + compareRankedMatches
  store.ts        # CandidateStore: upsert (tallies land here), prefix index
  types.ts        # Candidate (display to delete), Sighting, RankedMatch
  segment.ts score.ts shapeGate.ts dictionary.ts   # display-free (verified: score.ts has zero .display reads)
src/pi/
  provider.ts     # fallback path; successorDisplay interim
  widget.ts       # widget path; chainShim interim; Tab seam (DO NOT TOUCH)
  debug.ts ingest.ts editor.ts config.ts chain-grant.ts index.ts paths.ts
test/
  query.test.ts store.test.ts types.test.ts debug.test.ts provider*.test.ts
  widget*.test.ts ingest.test.ts score.test.ts mask-secrets.test.ts
  acceptance.test.ts adversarial-typing.test.ts chaining-gating.test.ts
  defer-pi-menu.repro.test.ts   # BASELINE-RED (3/4) — DO NOT TOUCH
  fixtures/sessions/expected.md helpers/bench-fixtures.ts
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. Modification-only task:
#   src/core/query.ts     — rawFirst + resolveCompletionCasing at 2 sites + JSDoc
#   src/core/types.ts     — Candidate.display deleted
#   src/core/store.ts     — 2 display writes deleted + upsert JSDoc (Mode A)
#   src/pi/debug.ts       — 3 interim readers
#   src/pi/provider.ts    — successor label interim
#   src/pi/widget.ts      — chainShim interim (ONLY this hunk)
#   test/**               — battery extensions + fallout migration
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — rawFirst ordering: prefixRange()/matching lowercase the fragment.
// Capture BEFORE any transformation, at the very top of rankMatches:
const rawFirst = prefix.charAt(0);          // ORIGINAL casing ('N' from "Nr")
const lower = prefix.toLowerCase();         // existing line — comes AFTER
// Zero-length fragment ('#'-alone listing) → rawFirst === "" → resolver's
// frequency branch. That is CORRECT per h2.41 ("listing … sessionCount
// descending"): no typed letter to preserve. Do NOT special-case it.

// CRITICAL — capDisplay sentinel is "" (empty string), never undefined:
store.get(s.next)?.capDisplay || s.next     // ✓ covers "" AND evicted-entry undefined
store.get(s.next)?.capDisplay ?? s.next     // ✗ passes "" through — never render ""
c.capDisplay !== "" ? c.capDisplay : c.key  // ✓ debug.ts interim form

// CRITICAL — `??` vs `||` in the ITEM DESCRIPTION text: the item description
// says "capDisplay ?? key" loosely; the implemented correct form is the
// empty-string-aware one above (attempt 1 verified this).

// resolver's path nuance (S1 battery already pins it): 'S' + 'src/core/query.ts'
// → 'Src/core/query.ts' is CORRECT behavior (only first letter adapts; the
// winning form's spelling wins wholesale). Do "not fix" it.

// vitest is the runner; plain functions, no MCP/FastAPI-style infrastructure.
// npm run check = tsc --noEmit; npm test = vitest --run (all of test/).
```

## Implementation Blueprint

### Data models and structure

```typescript
// types.ts — BEFORE (excerpt)                     // AFTER
export interface Candidate {                       export interface Candidate {
  key: string;                                       key: string;
  display: string;  // ← DELETE (and its            capCount: number;
                     //    "KEPT legacy temporary"                    // …tallies & flags unchanged
                     //    doc comment)             }
  capCount: number; /* … unchanged */             // Sighting.display STAYS (feeds tallies)
}                                                 // RankedMatch.display STAYS (now resolved)
```

No new types; no schema migration (RAM-only store, no persistence).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: STATE ASSESSMENT + BASELINE (do first, always)
  - RUN: git status --short
  - IF the attempt-1 diff is present (expected M-set: src/core/{query,store,types}.ts,
    src/pi/{debug,provider,widget}.ts, ~13 test files, fixtures/sessions/expected.md):
    DO NOT revert. AUDIT it hunk-by-hunk against Tasks 1-7 below (it is
    expected to already satisfy nearly all), repair gaps, jump to Validation.
  - IF clean: implement Tasks 1-7 from scratch.
  - ALWAYS: npx vitest run test/defer-pi-menu.repro.test.ts → record the 3
    failing test names (Issue-Feedback Response §1). Verify the file is NOT
    in your diff at every later checkpoint.

Task 1: MODIFY src/core/query.ts — resolve at BOTH construction sites
  - ADD at top of rankMatches (before `const lower = prefix.toLowerCase()`):
    `const rawFirst = prefix.charAt(0);` with JSDoc/comment per attempt-1
    diff (Shift-preserve rule, zero-fragment → frequency branch).
  - REPLACE `display: c.display` at the anchored/gated construction site
    (HEAD ~:531) with `display: resolveCompletionCasing(c, rawFirst)` +
    Mode-A comment citing spec 04 h2.32 / PRD R2.1 / invariant 2.
  - REPLACE `display: c.display` at the tier-0 anchorless site (HEAD ~:582)
    with the SAME call (same rawFirst — one query, one fragment) + comment.
  - DO NOT touch: compareRankedMatches, compareListing, exact-equal
    exclusion, tier scoring/threshold logic, plural pruning, dedup.

Task 2: MODIFY src/core/types.ts — remove Candidate.display
  - DELETE the `display: string;` field + its legacy-KEPT doc comment.
  - KEEP Sighting.display and RankedMatch.display untouched.

Task 3: MODIFY src/core/store.ts — remove both display writes
  - DELETE `display: sighting.display,` from the create branch (~:304).
  - DELETE `existing.display = sighting.display; // most recent casing wins`
    from the merge branch (~:333).
  - KEEP all tally writes (forms map, capCount/lowerCount/capDisplay
    refresh ~:368-:379), sessionCount/ordinal/flag/rankGroup logic.
  - REWRITE module-header upsert contract + upsert JSDoc Mode-A: casing
    lives ONLY in tallies; resolver derives insertion form at completion
    time; no recency merge (follow attempt-1 diff wording).

Task 4: MODIFY src/pi/debug.ts — three interim readers
  - topSection (~:74), successorsSection (~:120), registerAcwordsCommand
    dump (~:203): `c.display` → `c.capDisplay !== "" ? c.capDisplay : c.key`
    each with `// TODO(P1.M2.T3.S1)` (full tally columns land there).

Task 5: MODIFY src/pi/provider.ts + src/pi/widget.ts — successor label interim
  - provider.ts successorDisplay (~:436) and widget.ts chainShim (~:667):
    `store.get(s.next)?.display ?? s.next` → `store.get(s.next)?.capDisplay || s.next`
    with `// TODO(P1.M2.T2)` (Successor.nextDisplay replaces it).
  - FENCE: touch NOTHING else in widget.ts (Tab/menu seam is P3.M1.T1.S1's).

Task 6: RESIDUAL AUDIT — compiler + grep
  - npm run check → fix every .display error (this is the migration driver).
  - grep -rn "\.display" src/ → allowlist ONLY: Sighting.display definition
    + ingest.ts sighting construction (~:630 `display: draft.display` —
    Sighting construction, STAYS), RankedMatch.display definition + its
    ~20 consumers (provider.ts :604/:614-615/:670; widget.ts
    :266/:270/:301/:719/:739/:905/:1014/:1310/:1501 — HEAD anchors), and
    JSDoc prose. Zero Candidate.display reads/writes remain.

Task 7: TESTS — battery extension + fallout migration
  - EXTEND test/query.test.ts (new describe, titles cite spec "PRD §04 h2.32"):
    rawFirst pin (fragment 'Nr' → RankedMatch.display 'NREL' on a
    lowerCount>0 candidate with capDisplay 'NREL'); frequency matrix
    (lowercase fragment: capCount>lowerCount → capDisplay; <→ key; tie →
    lowercase key; seen-only-capitalized → capDisplay); zero-fragment '#'
    listing resolves via frequency branch; all-caps sighting → verbatim;
    path key → verbatim; tier-0 site casing equals anchored site casing
    for the same candidate+fragment.
  - UPDATE test/store.test.ts: drop `display:` from every exact toEqual
    literal; rewrite the 4 legacy recency-display pins to assert tallies.
  - UPDATE test/types.test.ts Candidate doc-contract pin if it enumerates fields.
  - MIGRATE remaining fallout (attempt-1 touched 13 suites total incl.
    debug/provider/provider-display/provider-live/widget/widget-visibility/
    acceptance/adversarial-typing/chaining-gating/ingest/mask-secrets/score
    + fixtures/sessions/expected.md): fixture candidates that previously
    relied on a capitalized display now need CONSISTENT casing evidence
    (sightings with casing "mid-cap") so the resolver yields the expected
    form; expected.md 'Verdigris' → 'verdigris' re-theme (499 lower vs 49
    caps — frequency rule wins).
  - DO NOT touch test/defer-pi-menu.repro.test.ts.
```

### Implementation Patterns & Key Details

```typescript
// PATTERN — construction site (both, identical except comment):
// anchored site (query.ts, in the recs.push where tier comes from the scan):
const rawFirst = prefix.charAt(0); // TOP of rankMatches, before toLowerCase
// …
display: resolveCompletionCasing(c, rawFirst),
description: `session x${c.sessionCount}`,   // unchanged, ASCII x
salience: salience(c, ordinal),              // unchanged
sessionCount: c.sessionCount,                // unchanged (order key)

// PATTERN — interim successor label (provider.ts + widget.ts):
const successorDisplay = (s: Successor): string =>
  store.get(s.next)?.capDisplay || s.next;   // || — "" sentinel AND evicted both fall back

// PATTERN — debug.ts interim (three sites):
`${c.capDisplay !== "" ? c.capDisplay : c.key}  ×${c.sessionCount}  …`

// GOTCHA — do NOT thread casing through callers or change rankMatches's
// signature; rawFirst is internal. Do NOT resolve at render time in
// provider/widget (double resolution / drift risk); both read
// RankedMatch.display verbatim as today.
```

### Integration Points

```yaml
NONE: no config surface, routes, migrations, or persistence changes.
Docs: Mode-A JSDoc rides with the code (Tasks 1, 3). Spec already specifies
  the target behavior (h2.32/h2.41/h2.43 are display-free) — verify with
  grep that no spec/*.md line still describes a stored Candidate.display
  recency field; if one is found, report it in the final report (drift
  note for P3.M1.T2.S4) rather than editing spec from this PRP.
```

## Validation Loop

### Level 0: Pre-flight baseline (BEFORE any edit — rev-2 addition)

```bash
git status --short                       # branch: audit-vs-implement (Task 0)
npx vitest run test/defer-pi-menu.repro.test.ts 2>&1 | tail -15
# RECORD the failing test names (expected 3 failed | 1 passed — named in
# Issue-Feedback Response). These are the ONLY acceptable failures at exit.
```

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check      # tsc --noEmit — the migration driver; expect exit 0
# Expected: zero errors after Task 6. Fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run test/query.test.ts test/store.test.ts test/types.test.ts -v
npx vitest run test/debug.test.ts test/provider.test.ts test/provider-display.test.ts test/widget.test.ts -v
npm test            # full suite — gate: green EXCEPT the 3 recorded baseline
                    # failures in defer-pi-menu.repro.test.ts (identical set)
# Expected (from attempt-1 measurement): ~1204 passed, 1 pre-existing skip,
#   3 failed = baseline set only. Any OTHER failure: debug and fix.
```

### Level 3: Integration Verification (system slice)

```bash
# Residual-casing audit — the cutover's real "integration" check:
grep -rn "\.display" src/ | grep -v "Sighting\|RankedMatch"
# Expected: no Candidate.display reads/writes (JSDoc prose lines only).
# Baseline identity re-check (must equal Level 0 exactly):
npx vitest run test/defer-pi-menu.repro.test.ts 2>&1 | tail -6
git diff --name-only | grep -c defer-pi-menu   # Expected: 0 (untouched)
# No service to start: hapax is a pi extension; live-TUI smoke for the
# casing surface belongs to the changeset-level live smoke task
# (P3.M1.T2.S3, spec/09 h2.61) — note that in the final report.
```

### Level 4: Creative & Domain-Specific Validation

Not applicable beyond Level 3 for this core-path change (battery coverage is
the binding gate here; UI-layer live verification is changeset-scoped).

## Final Validation Checklist

### Technical Validation

- [ ] Level 0 baseline recorded BEFORE edits; 3 named tests, 1 passing
- [ ] `npm run check` exit 0
- [ ] `npm test`: all green EXCEPT exactly the 3 baseline failures (same
      names, 3 failed | 1 passed in that file); zero new failures
- [ ] `test/defer-pi-menu.repro.test.ts` NOT in `git diff --name-only`

### Feature Validation

- [ ] Both construction sites resolve via `resolveCompletionCasing(c, rawFirst)`
- [ ] rawFirst captured before lowercasing; zero-fragment → frequency branch
- [ ] `Candidate.display` gone (types.ts, both store writes, zero readers)
- [ ] `Sighting.display`, tallies, ranking/comparator/exact-equal/plural
      pruning/thresholds untouched
- [ ] Interim fallbacks never yield `""`; TODOs P1.M2.T2 / P1.M2.T3.S1 in place
- [ ] Query battery covers: rawFirst pin, frequency matrix, tie→lowercase,
      only-cap→cap, all-caps, path-verbatim, zero-fragment, tier-0 parity

### Code Quality Validation

- [ ] Follows existing conventions (module-header contracts, JSDoc style,
      test titles citing spec sections)
- [ ] Mode-A JSDoc at both sites + store upsert; no spec edits
- [ ] No scope-fence violations (widget Tab seam, defer repro, successor
      nextDisplay semantics, /acwords full treatment)

### Documentation & Deployment

- [ ] Final report includes the baseline proof (Issue-Feedback Response §3)
      and, if audit-path was taken, what (if anything) the audit repaired

## Anti-Patterns to Avoid

- ❌ Do NOT fix, skip, quarantine, or edit the 3 baseline failures — that is
  P3.M1.T1.S1's deliverable and "absorbing" them hides upstream drift
- ❌ Do NOT report `result: "issue"` solely because the baseline file is red —
  the rev-2 gate explicitly carves it out (with proof) as success
- ❌ Do NOT blanket-revert a present attempt-1 diff; audit it
- ❌ Do NOT use `??` where the "" sentinel matters (`||` / `!== ""`)
- ❌ Do NOT delete Sighting.display or any tally write
- ❌ Do NOT change rankMatches signature, ranking order, tier math, or gates
- ❌ Do NOT resolve casing again in provider/widget render paths (they keep
  reading RankedMatch.display verbatim)
