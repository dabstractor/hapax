# PRP — P3.M1.T1.S2: Verify Tab-deferral conformance against the updated PRD (07 h3.10/h3.14 + 09 h2.59); pin the deferral state in widget tests

## Goal

**Feature Goal**: Audit the ALREADY-SHIPPED Tab-deferral implementation (P3.M1.T1.S1) against
the three PRD hunks that were promoted mid-session from a mitigation note to normative spec
text, pin the now-explicit 09 h2.59 test bullet in `test/widget.test.ts` key-handling
coverage if any part of it is not already pinned there, and fix forward ONLY on mismatch.

**Deliverable**: (1) A written conformance verdict — one verdict line per audited PRD clause
(a)–(d) plus the h3.14 parenthetical, with file:line evidence — recorded at
`plan/006_7bd0258da993/P3M1T1S2/VERDICT.md` (this run's own artifact; do not edit any other
file under `plan/`). (2) If (and only if) the audit finds a mismatch: the minimal code/test
edit that brings the artifact into conformance, with green gauntlet. (3) No changes at all
when everything conforms — "no diff" is a fully valid outcome for this task.

**Success Definition**: Every audit dimension below has an explicit CONFORMANT / MISMATCH
verdict backed by file:line evidence; any mismatch is fixed; `npm run check` and `npm test`
are green (including `test/widget.test.ts`, `test/defer-pi-menu.repro.test.ts`, and
`test/editor-enter.test.ts` untouched-or-strengthened); VERDICT.md exists and is complete.

## User Persona (if applicable)

**Target User**: The Mode B documentation tasks (P3.M1.T2.S2/S3/S4) and future maintainers —
they consume this verdict as ground truth for the README's Tab-deferral blurb, the live-smoke
hesitation-race variant, and the M1-DoD drift report.

**Use Case**: T2.S4's drift report must be able to state "code matches the normative spec
text at 07 h3.10/h3.14 and the 09 h2.59 test bullet is pinned" without re-auditing.

**Pain Points Addressed**: The PRD text changed AFTER S1 shipped; without this audit nobody
has verified the landed artifacts against the exact normative wording, and a silent
divergence would surface during documentation (Mode B) instead of now.

## Why

- The mid-session PRD delta turned S1's shipped mitigation into normative spec text: 07 h3.10
  "Tab inserts the highlighted word" now ends "— UNLESS the inner editor's own autocomplete
  menu is open (`isShowingAutocomplete`): the Tab forwards verbatim and pi's menu accepts its
  item; deferral keys on the menu's actual open state, never on context classification (the
  hesitation race can re-arm the widget line while pi's menu is open)"; 07 h3.14's
  parenthetical gained "except while pi's own menu is open, when the widget defers the Tab
  verbatim"; 09 h2.59's widget.test.ts key-handling bullet now requires "Tab with pi's own
  menu open (`isShowingAutocomplete() === true`) forwards verbatim — never inserts a hapax
  word over an open stock menu (P3.M1.T1.S1)".
- S1's contract anticipated all three hunks, so the EXPECTED outcome is full conformance with
  zero code change. This task converts that expectation into verified fact and makes the
  verdict durable for downstream tasks.
- Repo policy (AGENTS.md): spec and code must stay in agreement. The spec side already
  landed; this task closes the loop on the code side by proving (or restoring) agreement.

## What

An audit with four mandated dimensions plus one prose check, each resolved to a verdict:

### Audit dimension (a) — pre-check placement, order, and verbatim forward

Verify in `src/pi/widget.ts` `widgetHandleInput` (the Tab-deferral block sits at
approximately lines 1698–1726; find it by grepping `P3.M1.T1.S1`):

- The pre-check fires only when `decision.action === "tab-insert"` (the pure decision
  table's verdict for a visible, non-empty line — see `decideWidgetKey`, pinned pure at
  test/widget.test.ts:1301+).
- The pre-check reads `innerRecord.isShowingAutocomplete?.() === true` — the menu's ACTUAL
  open state read FORWARD through the enter-submit proxy (the proxy's get trap binds member
  functions to the real inner editor; precedent: `src/pi/editor.ts:111-115`). Note the
  deliberate ordering: `decideWidgetKey` (a PURE table, no side effects, no editor state)
  runs first and is VETOED by the deferral; the PRD's "before any insert/suppress decision
  executes" is satisfied because the veto precedes every EFFECTFUL branch — verify no
  insert, suppress, dismissal, tick, arming, or state mutation executes before the
  `return forwardInput(data)` in the deferral arm.
- The forward is VERBATIM: `forwardInput(data)` delegates through the enter-submit guard's
  `handleInput` (never the raw inner), passing the exact input bytes, so pi's own menu
  accepts its highlighted item.
- A forwarded deferral Tab ticks the shared input clock exactly ONCE (the guard's
  `onKeystroke` seam fires on delegation; the widget layer's own consumed-key tick block is
  NOT reached). Pinned by the widget.test.ts deferral test's
  `expect(h.onKeystroke).toHaveBeenCalledTimes(1)`.
- Defensive posture: a missing member or throwing probe falls through to the normal
  tab-insert path (try/catch around the probe) — pinned by two widget.test.ts cases
  (probe-absent inert; throwing probe falls through, insert still lands).

### Audit dimension (b) — keyed on actual open state, never classification; hesitation race covered

- Confirm the deferral predicate contains NO context-classification logic (no
  `classifyStockContext` / prefix sniffing): the ONLY key is the boolean return of
  `isShowingAutocomplete()`.
- Confirm the hesitation race — `menuDelayMs` re-arming the widget line OVER pi's already
  open menu — remains covered by the regression suite: `test/defer-pi-menu.repro.test.ts`
  case 3 ("async race (menuDelayMs 400, fake timers)") asserts BOTH preconditions of the
  accepting Tab (`isShowingAutocomplete() === true` AND `state.hidden === false`) before
  asserting the forward (`pi.applied`). The suite must stay green and must not be weakened.
- Understand and record WHY classification keying is forbidden (spec 07 h3.10): the
  forced-file and slash-argument surfaces are exactly the contexts classification does NOT
  model, and the race makes any static context guess stale mid-keystroke.

### Audit dimension (c) — 09 h2.59 bullet pinned in test/widget.test.ts key-handling coverage

The bullet: "Tab with pi's own menu open (`isShowingAutocomplete() === true`) forwards
verbatim — never inserts a hapax word over an open stock menu (P3.M1.T1.S1)". Verify the
pin inside `test/widget.test.ts` (currently the describe block "widget key handling — Tab
inserts the highlighted word (spec §07 h2.46 rule 0, S2)", deferral tests at approximately
lines 1144–1205, using the `makeInsertHarness` knobs `piMenuOpen` / `piMenuProbeThrows`):

- "forwards verbatim" half: the test asserts the inner receives the Tab bytes exactly once
  (`expect(out).toBe("inner:\t")`, `expect(h.innerCalls).toEqual(["\t"])`).
- "never inserts a hapax word over an open stock menu" half: asserted via the double as NO
  `setText`/caret edit plus line-stays-visible, no dismissal/suppression (`h.calls` equals
  exactly one delegation, `state.hidden === false`, `dismissedCalls === 0`,
  `suppressUntilWordStart === false`). The "pi's menu accepts its item" half is only
  observable against the REAL pi-tui Editor and is correctly covered by the repro suite —
  that division of labor (double pins the deferral STATE; repro pins the END-TO-END accept)
  is itself part of the conformance verdict.
- If ANY half of the bullet is not actually pinned (read the assertions, don't trust the
  test name), add the missing assertion(s) or a dedicated case IN THIS describe block,
  following the existing harness knobs. Do not relocate the pin to the repro file.

### Audit dimension (d) — contrast case and Enter-submits guard green and untouched

- The contrast case — pure slash typing (`/mo`, no space) defers via CONTEXT CLASSIFICATION
  (the widget line never arms in stock contexts; a different mechanism from (b)) — stays
  covered by repro case 4 and green.
- The Enter-submits guard (`src/pi/editor.ts`) is untouched by the deferral work: its own
  `isShowingAutocomplete` read (line ~111–115) is a sibling use of the same probe, its suite
  `test/editor-enter.test.ts` stays green. The audit confirms no edit to `editor.ts` is
  needed (grep the S1 diff surface: only `src/pi/widget.ts` should carry the deferral).

### Prose check — 07 h3.14 parenthetical

"(FALLBACK PATH ONLY — on the widget path Tab is consumed by the editor proxy before this
editor branch can run (except while pi's own menu is open, when the widget defers the Tab
verbatim …))". Verify the structure holds: a consumed tab-insert RETURNS without delegating
(pi-tui's `editor.js` Tab branch is unreachable on the widget path), and the deferral arm is
the sole exception that forwards. No code change is expected from this check — it validates
that the h3.14 parenthetical describes reality.

### Success Criteria

- [ ] VERDICT.md at `plan/006_7bd0258da993/P3M1T1S2/VERDICT.md` with per-clause verdicts + file:line evidence
- [ ] Audit dimensions (a)–(d) + h3.14 prose check each resolved CONFORMANT or MISMATCH→fixed
- [ ] If no mismatch: zero source-file edits (comment/citation churn is NOT a mismatch — see fix-forward protocol)
- [ ] `npm run check` green; `npm test` green (full suite, includes the repro suite)
- [ ] `test/defer-pi-menu.repro.test.ts` and `test/editor-enter.test.ts` pass unweakened (no deleted/relaxed assertions)

## All Needed Context

### Context Completeness Check

If someone knew nothing about this codebase: this PRP gives the exact code sites (with
approximate line anchors + grep keys), the exact PRD clauses (quoted), the test inventory
per dimension, and the decision rule for fix-forward. An agent with only this PRP + repo
access can complete the audit mechanically. ✓

### Documentation & References

```yaml
# MUST READ - the normative text being audited against (already landed; READ-ONLY)
- file: spec/07-completion-ui.md
  why: h3.10 "Widget key handling" — final bullet "Tab inserts the highlighted word" ends
        with the UNLESS-deferral clause (line ~242); h3.14 parenthetical "(FALLBACK PATH
        ONLY … except while pi's own menu is open …)". This is the normative target.
  pattern: quote the exact clause in VERDICT.md next to its evidence
  gotcha: the deferral text lives in h3.10's LAST bullet, not in h2.46/h2.50 — older
          comments in the code cite "h2.46 + h2.51" (coarse citations from S1, written
          before the hunks landed). Coarse-but-not-false citations are NOT a mismatch.

- file: spec/09-testing-and-acceptance.md
  why: h2.59 "Unit tests (per module)" → widget.test.ts key-handling bullet (line ~191)
        contains the mandated pin text "(isShowingAutocomplete() === true) forwards
        verbatim — never inserts a hapax word over an open stock menu (P3.M1.T1.S1)".
  pattern: audit test/widget.test.ts against this bullet's TWO claims (forwards verbatim;
        never inserts over an open stock menu)
  gotcha: "isShowingAutocomplete() === true" in the bullet is the probe contract — the
          harness knob must drive the METHOD's boolean return, not a stubbed classification

- file: spec/SPEC.md
  why: Design invariants (never-hijack; Tab only completes) — the deferral is an exception
        surface inside the sanctioned Tab capture; confirm the audit framing respects them.
  pattern: cite invariant 1/2 in VERDICT.md's framing paragraph
  gotcha: the spec is ALREADY updated — this task never edits spec/*.md

# MUST READ - the landed implementation under audit
- file: src/pi/widget.ts
  why: widgetHandleInput's Tab-deferral pre-check (grep "P3.M1.T1.S1"; ~lines 1698-1726):
        veto on decision.action === "tab-insert" + isShowingAutocomplete?.() === true →
        forwardInput(data). Also forwardInput's definition (~line 1659) and innerRecord
        (~line 1641) — reads forward THROUGH the enter-submit proxy.
  pattern: the pre-check's documented placement contract — "after decideWidgetKey … before
        any insert/suppress/tick/arming executes: a forwarded deferral ticks the clock
        exactly once (guard seam) and mutates nothing"
  gotcha: decideWidgetKey running FIRST is correct (pure, side-effect-free table); the PRD
          ordering clause governs effectful branches, not the pure decision. Also note the
          claim-release call at the top of widgetHandleInput fires only on isSubmitKey —
          Tab is never a submit key, so it cannot interfere with the deferral.

- file: src/pi/editor.ts
  why: the enter-submit guard that forwardInput routes through; the original
        isShowingAutocomplete duck-typed probe (lines ~111-115); isSubmitKey export reused
        by the widget layer; onKeystroke = the shared input clock seam (one tick per
        delegated keypress).
  pattern: proxy composition (never instance mutation) — the v1 recursion-crash lesson
  gotcha: dimension (d) requires editor.ts UNTOUCHED — the deferral must live only in
          widget.ts

# MUST READ - the regression suite (real pi-tui Editor)
- file: test/defer-pi-menu.repro.test.ts
  why: S1's hardend repro — 4 cases: (1) forced file surface 'load the te' microtask race;
        (2) argument-completion menu '/model te'; (3) menuDelayMs 400 fake-timer HESITATION
        RACE (both preconditions asserted before the accepting Tab); (4) pure-slash '/mo'
        CONTRAST case. Drives the real Editor with a provider double mimicking
        CombinedAutocompleteProvider's unmodeled surfaces.
  pattern: real-async timing harness (flush microtask loop; vi.useFakeTimers for case 3)
  gotcha: do not "simplify" the microtask/fake-timer choreography — the races are the point

# MUST READ - the pin location for dimension (c)
- file: test/widget.test.ts
  why: key-handling describe blocks; makeInsertHarness (~line 833+) with the S1 OPT-IN
        knobs piMenuOpen / piMenuProbeThrows (absent by default so legacy doubles are
        unchanged); the deferral pin tests (~lines 1144-1205) inside the describe at
        ~line 959 "widget key handling — Tab inserts the highlighted word".
  pattern: recording inner double + calls log + never-mutate set trap; assertions pin the
        EXACT interaction sequence (calls array) and post-state (hidden, suppression,
        interacted, onKeystroke count)
  gotcha: assertions must be READ, not inferred from test names — the audit's job is to
          check the two bullet claims are actually pinned

- file: test/editor-enter.test.ts
  why: dimension (d) — the Enter-submits guard suite (cancel-then-delegate, never-mutate,
        proxy forwarding, thenable guard, onKeystroke hook) must stay green and untouched.
  pattern: guard-level double harness
```

### Current Codebase tree (relevant excerpt)

```bash
src/pi/widget.ts          # widget display + key layer; Tab-deferral pre-check (~L1698-1726)
src/pi/editor.ts          # Enter-submits guard proxy; isShowingAutocomplete probe precedent
test/widget.test.ts       # PRIMARY pin target (dimension c) — key-handling describes
test/defer-pi-menu.repro.test.ts  # real-Editor regression suite (dimensions b + d)
test/editor-enter.test.ts # Enter-guard suite (dimension d)
spec/07-completion-ui.md  # h3.10 (~L242) + h3.14 — normative deferral text (READ-ONLY)
spec/09-testing-and-acceptance.md # h2.59 (~L191) — mandated test bullet (READ-ONLY)
plan/006_7bd0258da993/P3M1T1S2/   # THIS run's directory: PRP.md lives here; VERDICT.md goes here
```

### Desired Codebase tree with files to be added

```bash
plan/006_7bd0258da993/P3M1T1S2/VERDICT.md   # NEW — the conformance verdict (only new file)
# src/, test/ — NO new files. Edits only under the fix-forward protocol below.
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: this is an AUDIT with a conditional fix arm. The expected outcome is ZERO
# code change. Rewriting already-conformant code is a FAILURE mode of this task, not a
# success — it invalidates S1's landed-and-green state and creates drift for Mode B.

# The pure-table-first ordering: decideWidgetKey runs BEFORE the deferral veto BY DESIGN
# (keeps the pure decision table free of editor state; it is side-effect-free). The PRD's
# "BEFORE any insert/suppress decision executes" is about effectful branches. Do NOT
# "fix" this ordering.

# Citation drift ≠ mismatch: widget.ts's deferral JSDoc and the repro header cite
# "spec 07 h2.46 + h2.51" (pre-dating the normative h3.10/h3.14 hunks). Per this item's
# DOCS contract ("JSDoc … extend only if the audit changes code"), leave comments alone
# unless a code edit lands in that exact block.

# The repro suite drives the REAL @earendil-works/pi-tui Editor (~0.84.4): async
# requestAutocomplete → getSuggestions resolution and fake timers are load-bearing.
# pi's menu opens only after the Promise resolves — hence the flush loops.

# isShowingAutocomplete is duck-typed (structural cast, no types enforce it). The probe's
# defensive fall-through (missing/throwing member → normal insert path) is deliberate and
# pinned — do not "harden" it into a throw.

# Never mutate the inner editor instance (v1 recursion crash, editor.ts header). Any fix
# must preserve proxy composition. The never-mutate set-trap in makeInsertHarness pins this.

# Spec maintenance policy: spec/*.md is READ-ONLY for this task (the hunks already
# landed). If a genuine contradiction between code and spec is found that CANNOT be
# resolved by a code fix, STOP and report the contradiction — do not edit the spec.
```

## Implementation Blueprint

### Data models and structure

None — no production data models change. The only structured artifact is VERDICT.md
(markdown; format below).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: READ the normative targets
  - READ: spec/07-completion-ui.md h3.10 final bullet (grep "isShowingAutocomplete") and the
    h3.14 parenthetical; spec/09-testing-and-acceptance.md h2.59 widget.test.ts key-handling
    bullet (grep "isShowingAutocomplete").
  - READ: src/pi/widget.ts widgetHandleInput Tab-deferral block (grep "P3.M1.T1.S1"),
    forwardInput (~L1659), innerRecord (~L1641); src/pi/editor.ts guard handleInput.
  - READ: test/defer-pi-menu.repro.test.ts (all 4 cases); test/widget.test.ts
    makeInsertHarness + the deferral tests (~L1144-1205) + the Tab describe (~L959).
  - PURPOSE: build the evidence map BEFORE judging; every verdict needs file:line evidence.

Task 2: AUDIT dimension (a) — pre-check placement + verbatim forward
  - WALK: widgetHandleInput control flow: claim-release (submit key only) → decideWidgetKey
    (pure) → deferral veto (tab-insert + isShowingAutocomplete() === true → forwardInput) →
    forward/enter-submit/boundary branches → consumed-key tick block → navigate/tab-insert.
  - VERIFY: the deferral return precedes EVERY effectful branch; the forward passes the
    verbatim data through the guard (never the raw inner); exactly one clock tick on the
    forwarded deferral (guard seam); probe is defensive.
  - EVIDENCE: cite widget.ts lines + the widget.test.ts assertions that pin each property.

Task 3: AUDIT dimension (b) — open-state keying + hesitation race
  - VERIFY: the predicate reads ONLY the boolean method result (no classification anywhere
    in the deferral block); repro case 3 asserts both preconditions (menu open AND hapax
    line visible) before the accepting Tab, under fake timers with menuDelayMs 400.
  - EVIDENCE: widget.ts predicate lines + repro case 3's expect() sequence.

Task 4: AUDIT dimension (c) — h2.59 pin in widget.test.ts
  - VERIFY against the bullet's two claims by READING assertions:
    1. forwards verbatim (out === "inner:\t"; innerCalls === ["\t"]) — double-level.
    2. never inserts over an open stock menu (calls === exactly one inner delegation — no
       setText/caret; line stays visible; no suppression; no dismissal) — double-level.
       Plus the repro's end-to-end accept (pi.applied) — real-Editor level.
  - IF a claim is unpinned: ADD the missing assertion(s) or case in the same describe
    block using the existing piMenuOpen knob. NAMING: mirror the existing test-name style
    (claim, not mechanism). PLACEMENT: inside the "Tab inserts the highlighted word"
    describe (~L959) — the h2.59 bullet places this pin in KEY-HANDLING coverage.

Task 5: AUDIT dimension (d) + h3.14 prose check
  - RUN: npx vitest --run test/defer-pi-menu.repro.test.ts test/editor-enter.test.ts —
    both green; diff-check that editor.ts carries no deferral edit (git status/diff if
    the tree is dirty from your own edits only, else grep for stray edits).
  - CHECK h3.14: consumed tab-insert returns WITHOUT delegating (grep the tab-insert
    execution arm); the deferral arm is the sole Tab-forwarding exception.

Task 6: FIX-FORWARD only on MISMATCH (see protocol) — otherwise SKIP
  - SCOPE: the minimal edit that resolves the mismatch, in the same file/style as S1.
  - CONSTRAINTS: never key deferral on classification; never weaken the repro suite; never
    mutate the inner instance; never edit spec/*.md; extend JSDoc only in the edited block.

Task 7: WRITE plan/006_7bd0258da993/P3M1T1S2/VERDICT.md
  - FORMAT: title; one-line overall verdict (CONFORMANT / CONFORMANT AFTER FIX /
    CONTRADICTION-REPORTED); a table or per-clause sections for (a) placement+verbatim
    forward, (b) open-state keying + hesitation race, (c) h2.59 pin (double-level +
    repro-level), (d) contrast case + Enter guard, (h3.14) prose check — each with verdict
    + file:line evidence; a "Changes made" section (explicitly "none" when conformant);
    a "Notes for Mode B" section (T2.S2 gauntlet counts, T2.S3 live-smoke hesitation-race
    variant is backed by repro case 3, T2.S4 DoD drift-report input).
  - THIS IS THE PRIMARY DELIVERABLE. It must be readable standalone by an agent that never
    saw this session.

Task 8: VALIDATE
  - RUN: npm run check && npm test — both green.
  - IF any pre-existing unrelated test flakes: investigate once, rerun; do not mask.
```

### Implementation Patterns & Key Details

```text
# The fix-forward DECISION RULE (what counts as a mismatch):
#   MISMATCH (fix) — a behavioral gap: a PRD clause the code does not satisfy (e.g. the
#     veto could fire after a suppression already executed; the forward is not verbatim;
#     the predicate consults classification; an h2.59 claim with NO pinning assertion).
#   NOT a mismatch (leave alone) — coarse spec citations in comments (h2.46/h2.51 vs the
#     newer h3.10/h3.14 anchors); stylistic preferences; test-name wording; missing
#     coverage that the PRD does not mandate.
#
# The audit must be EVIDENCE-BASED: read the actual expect() calls in the deferral tests;
# do not accept a test's NAME as proof of its ASSERTIONS.
```

### Integration Points

```yaml
TESTS:  # no new integration surfaces; validation only
  - primary: npx vitest --run test/widget.test.ts test/defer-pi-menu.repro.test.ts test/editor-enter.test.ts
  - full:    npm test  (vitest --run, picks up every *.test.ts incl. the .repro suite)
  - types:   npm run check  (tsc --noEmit)

DOCS:
  - plan/006_7bd0258da993/P3M1T1S2/VERDICT.md  # the ONE new file (this run's artifact)
  - NO spec edits, NO README edits (README is P3.M1.T2.S1's task), NO JSDoc churn

DOWNSTREAM CONSUMERS (do not break their inputs):
  - P3.M1.T2.S2 (gauntlet): expects a green full suite with repro included
  - P3.M1.T2.S3 (live smoke): gains the hesitation-race variant — backed by repro case 3
  - P3.M1.T2.S4 (DoD + drift report): consumes this VERDICT.md verbatim
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check   # tsc --noEmit — zero errors (only relevant if a fix landed)
# Expected: clean. If errors exist, read output and fix before proceeding.
```

### Level 2: Unit Tests (Component Validation)

```bash
# The audit's subject suites, run first and individually:
npx vitest --run test/widget.test.ts
npx vitest --run test/defer-pi-menu.repro.test.ts   # all 4 cases incl. hesitation race + contrast
npx vitest --run test/editor-enter.test.ts          # Enter-submits guard (dimension d)

# Full suite (the real gate — no suite may regress):
npm test
# Expected: ALL green. The repro suite's 4 cases and widget.test.ts's Tab describes are
# the conformance evidence — a failure here means the audit found a real mismatch (or a
# fix broke something); resolve before writing the final verdict.
```

### Level 3: Integration Testing (System Validation)

Not applicable — no runtime/service surface changes. (Live TTY smoke of the deferral is
P3.M1.T2.S3's binding task, fed by this verdict; do not attempt it here.)

### Level 4: Creative & Domain-Specific Validation

```bash
# Self-check the audit quality:
# 1. Every verdict row cites at least one file:line (code) and, where applicable, the
#    exact expect() that pins it (test).
# 2. VERDICT.md quotes each PRD clause it audits (so it stands alone).
# 3. "Changes made: none" is present iff no mismatch was found.
# 4. git status shows at most: VERDICT.md (new), and the minimal fix files if any.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` green
- [ ] `npm test` green (full suite, includes defer-pi-menu.repro.test.ts)
- [ ] Targeted suites individually green: widget, defer-pi-menu, editor-enter
- [ ] No assertion in the repro suite or editor-enter suite deleted/relaxed

### Feature Validation

- [ ] All audit dimensions (a)–(d) + h3.14 prose check resolved with file:line evidence
- [ ] h2.59 bullet's two claims verified as pinned in widget.test.ts key-handling coverage
- [ ] Fix-forward applied ONLY on genuine mismatch (or explicitly skipped with "none")
- [ ] VERDICT.md written at plan/006_7bd0258da993/P3M1T1S2/VERDICT.md, standalone-readable,
      with a Notes-for-Mode-B section (T2.S2/S3/S4 inputs)

### Code Quality Validation

- [ ] Any fix follows S1's existing style (defensive probe, proxy composition, calls-log
      assertion pattern) and lands in the same file/block
- [ ] No spec/*.md edits; no plan/ edits outside this run's P3M1T1S2 directory
- [ ] No comment/JSDoc churn in untouched code

### Documentation & Deployment

- [ ] VERDICT.md is the durable record; no other docs touched

---

## Anti-Patterns to Avoid

- ❌ Don't rewrite or "improve" already-conformant code — the expected outcome is NO code diff
- ❌ Don't treat a test's NAME as proof — read its assertions (that is the audit)
- ❌ Don't "fix" the pure-table-first ordering (decideWidgetKey before the veto is by design)
- ❌ Don't key (or add) any classification logic to the deferral — menu open state only
- ❌ Don't touch spec/*.md — the hunks already landed; this task verifies code against them
- ❌ Don't weaken/simplify the repro suite's timing choreography (microtask + fake timers)
- ❌ Don't edit editor.ts — the guard is dimension (d)'s untouched-by-construction artifact
- ❌ Don't skip validation because "it's just an audit" — the green suite IS the evidence
- ❌ Don't chase comment-citation updates (h2.46→h3.10) unless a code edit lands there anyway
