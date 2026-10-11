# PRP — P3.M1.T1.S1: Pre-check isShowingAutocomplete in the widget Tab branch; harden repro into a regression suite

---

## Goal

**Feature Goal**: Fix the pre-existing Tab-stealing bug on the widget path: when
pi's OWN autocomplete menu is open (forced file menu, slash-argument menu, any
stock surface), the widget layer must never consume Tab — it forwards the press
verbatim so pi's menu accepts its highlighted item. Deferral keys on the menu's
ACTUAL open state (`inner.isShowingAutocomplete?.() === true`), not on static
context classification, because case 3 of the repro proves classification cannot
work (the hesitation race re-arms the hapax line while pi's menu is open).
Simultaneously harden `test/defer-pi-menu.repro.test.ts` from an investigation
repro (console.log scaffolding, "not a regression suite yet" header) into a
clean regression suite, and extend `test/widget.test.ts`'s key-handling bullets
to pin the deferral state at the wiring level.

**Deliverable**:
1. A ~6-line deferral pre-check (+ JSDoc) in `widgetHandleInput`
   (`src/pi/widget.ts`), placed after `decideWidgetKey` and BEFORE the
   tab-insert handling — `decideWidgetKey` stays PURE (no editor state).
2. Hardened `test/defer-pi-menu.repro.test.ts`: header updated, describe label
   `repro:` → `regression:`, all `console.log` + eslint-disable scaffolding
   stripped, assertions kept and strengthened with precondition asserts.
3. New key-handling bullets in `test/widget.test.ts` (harness gains an
   `isShowingAutocomplete` knob).
4. Minimal spec sync (spec/07 Tab bullet + h3.13 parenthetical; spec/09
   widget.test.ts key-handling bullet) per the binding spec-maintenance policy.

**Success Definition**: `npx vitest run test/defer-pi-menu.repro.test.ts` →
**4/4 green** (3 former reds + the pure-slash contrast case, which must stay
green unchanged). `npm run check` clean. `npm test` green except the known
environmental network-gated acceptance case (see Validation). The
`defer-pi-menu` battery is the named precondition for P3.M1.T2.S2's gauntlet.
Live TTY verification of this key-handling change is BINDING and is owned by
P3.M1.T2.S3 — this item ships the code + automated proof; do not claim the live
check here.

## User Persona

**Target User**: hapax owner / pi users with the widget path active (any session
where an editor factory exists).

**Use Case**: The user presses Tab to summon pi's own file completion on a plain
word (`templates/`-style), or types a slash command's argument and pi's
argument menu auto-opens, then presses Tab to accept pi's highlighted item.

**User Journey**: Type `load the te` → Tab (1st) opens pi's forced file menu →
Tab (2nd) must accept `templates/`. Today hapax's armed widget line steals that
2nd Tab and inserts a hapax dictionary word instead — the user's explicit
accept of a stock menu is hijacked.

**Pain Points Addressed**: A visible never-hijack violation (spec 07 h2.46
"stock path/slash completion is untouched by construction"; h2.51 never-hijack)
— three red test cases document it.

## Why

- Spec 07 h2.46 (Display architecture) guarantees the widget path leaves stock
  path/slash/`@` completion "untouched by construction"; consuming Tab while
  pi's menu is open breaks that guarantee.
- Spec 07 h2.51 (Never-hijack rules): no key is ever captured outside the
  sanctioned windows — Tab over an OPEN pi menu is pi's Tab, not hapax's.
- This is the P3.M1.T2.S2 gauntlet precondition ("check + test (incl. former
  repro) + bench") — the changeset cannot close while the repro is red.
- Architecture findings (plan/006_7bd0258da993/architecture/03 §R4 and 04 §1)
  already ratified the insertion point and the open-state-keyed rule.

## What

**Behavior**: In `widgetHandleInput`, after the pure `decideWidgetKey` decision
is computed and BEFORE any insert/suppress/tick/arming executes: if the decision
is `tab-insert` AND the inner (enter-submit-proxied, real) editor reports
`isShowingAutocomplete?.() === true`, return `forwardInput(data)` verbatim —
pi's menu accepts its highlighted item; hapax inserts nothing. The deferral:

- does NOT dismiss or suppress the hapax line (pure forward, same shape as the
  `forward` decision),
- does NOT set `interacted` (only navigate does),
- does NOT arm the chain (returns before the arming seam),
- does NOT release or alter the line claim,
- ticks the input clock exactly ONCE via `forwardInput`'s guard seam (same as
  every forwarded key — no double tick),
- leaves the Enter-submits guard and all other branches untouched.

When no menu is open (`undefined` or `false`), behavior is byte-identical to
today. When the hapax line is hidden/empty, the decision is already `forward`
and Tab forwards as today (case 3's 1st Tab) — no change.

### Success Criteria

- [ ] All 3 former red cases pass: pi's `applyCompletion` receives the
      accepting Tab (`pi.applied` `["templates/"]`).
- [ ] Contrast case 4 (pure slash `/mo`) stays green with NO changes to its
      assertions.
- [ ] `decideWidgetKey` signature and purity unchanged (no editor state in, no
      new decision action).
- [ ] JSDoc on the deferral branch citing spec 07 h2.46 + h2.51.
- [ ] Repro file header no longer says "not a regression suite yet"; zero
      `console.log`; zero `eslint-disable` comments.
- [ ] `test/widget.test.ts` gains deferral bullets (forward-not-insert with the
      menu open; inert when closed/absent; throwing probe never breaks input).
- [ ] `npm run check` + `npm test` per Validation Loop.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this
successfully?" — Yes: exact line anchors, the precedent guard to copy, the
composition chain explaining how `isShowingAutocomplete` is reachable from the
wiring, the red-test evidence, and the test-harness anatomy are all below.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/pi/widget.ts
  why: The single source file to modify. Key anchors (verified at HEAD dbafbfc):
    :1197 decideWidgetKey (PURE — signature/data-in/data-out MUST NOT change);
    :1534 inner = createEnterSubmitEditor(opts.inner(...), keybindings, tick)
      (the widget's innerRecord IS the enter-submit proxy — property reads
      forward through its get trap to the REAL editor);
    :1579 forwardInput (dynamic guard-handleInput read; ONE clock tick);
    :1595 widgetHandleInput; :1610 decideWidgetKey call in try/catch;
    :1621 forward branch; :1691 tab-insert branch (the handling to precede).
  pattern: copy the introspection idiom from editor.ts:111-115 verbatim.
  gotcha: NEVER read editor state inside decideWidgetKey (purity convention at
    :1180-1195); editor-state checks live in the wiring — the Enter-submit
    guard is the precedent (architecture/03 §R4 "Recommended: option 2").

- file: src/pi/editor.ts
  why: :111-115 is the exact precedent guard —
    (innerAny.isShowingAutocomplete as (() => boolean) | undefined)?.() === true
    — including the defensive cast and optional-call shape. Also documents the
    proxy's forwarding semantics (get/set/has, functions bound to inner,
    `then` undefined) the widget layer relies on for the read.
  pattern: fully-defensive optional-chaining probe; worst case inert.

- file: test/defer-pi-menu.repro.test.ts
  why: The 207-line battery to turn green and harden. Currently 3 failed/1
    passed (verified live). Harness = REAL pi-tui Editor as widget inner +
    pi-provider double (getSuggestions/applyCompletion recording `applied[]`)
    + createWidgetEditorFactory; flush() = 10 microtask turns; case 3 uses
    vi.useFakeTimers() + advanceTimersByTimeAsync with menuDelayMs 400.
  pattern: keep the harness EXACTLY as-is (contract: mocking stays "the file's
    own harness (real Editor + provider double)").
  gotcha: do NOT rename the file (P3.M1.T2.S2's gauntlet and the task tree
    reference the defer-pi-menu battery by this name); do NOT weaken the
    contrast case.

- file: test/widget.test.ts
  why: Wiring-level key-handling bullets to extend. makeInsertHarness (:843)
    builds the editor double `raw` (handleInput/getLines/getCursor/setText/
    setCursorCol/render) behind a never-mutate pin Proxy; `press()` drives the
    composed handleInput; `show()` seeds state; `calls`/`innerCalls` log every
    inner interaction in order. The Tab describe starts at :942
    ("widget key handling — Tab inserts the highlighted word (spec §07 h2.46
    rule 0, S2)").
  pattern: follow the existing it(...) naming + calls-sequence assertions.
  gotcha: the double has NO isShowingAutocomplete member today — the new
    widget.ts probe reads undefined and stays inert for every existing test
    (backwards compatible). Extend the harness with an opt-in knob; do not add
    the member unconditionally.

- file: spec/07-completion-ui.md
  why: Spec sync target. The "Tab inserts the highlighted word" bullet sits at
    :222 (widget key handling section); the "Tab-open gesture" section's
    FALLBACK-ONLY parenthetical claims the bug class is "structurally absent"
    on the widget path — this repro falsifies the accept-stealing half of that
    claim, so the parenthetical needs one corrective clause.
  gotcha: spec/PRD heading numbers (h2.46/h2.51/h3.13) are the PRD index
    numbering; the spec files use unnumbered headings. Cite by section title
    in prose; h-numbers are fine in code comments (existing convention —
    widget.ts already says "spec §07 h3.9").

- file: spec/09-testing-and-acceptance.md
  why: Unit-battery spec for widget.test.ts key handling ("Key handling
    (editor-proxy double)" bullet) — gains the deferral clause. Also the source
    of the BINDING live-verification technique (tmux send-keys one char at a
    time, 0.08–0.12 s sleeps) that P3.M1.T2.S3 will run for this change.

- docfile: plan/006_7bd0258da993/architecture/03-pi-surfaces-r2-r3-r4.md
  why: §R4 "deferral insertion points" (line 89) — ratifies the exact check,
    the placement options, and recommends option 2 (veto the tab-insert
    decision in the wiring; keep decideWidgetKey pure).

- docfile: plan/006_7bd0258da993/architecture/04-tests-docs-r5.md
  why: §1 documents the red battery case-by-case (why each fails, why static
    classification cannot work for case 3) and §2 the suite baseline —
    including the environmental acceptance.test.ts failure signature that is
    NOT this item's concern.

- file: plan/006_7bd0258da993/P2M1T2S2/PRP.md
  why: The PARALLEL in-flight item (branch-purity battery; test-only + an
    index.ts session_tree handler). No file overlap with this change; do not
    touch its deliverables (test/branch-purity.test.ts) and expect it in the
    tree at gauntlet time.
```

### Current Codebase tree (relevant excerpt)

```bash
src/pi/
  editor.ts        # enter-submit proxy; isSubmitKey export; THE precedent guard
  widget.ts        # widget layer: decideWidgetKey (pure), widgetHandleInput (wiring)
  provider.ts      # fallback path (untouched), createChainMachine import source
test/
  defer-pi-menu.repro.test.ts   # THE battery: 3 red / 1 green today
  widget.test.ts                # wiring-level key handling (extend)
  widget-visibility.test.ts     # visibility machine (untouched)
spec/
  07-completion-ui.md           # Tab bullet :222; Tab-open parenthetical (sync)
  09-testing-and-acceptance.md  # widget key-handling bullet (sync)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. Modified:
src/pi/widget.ts                  # +deferral pre-check in widgetHandleInput (+JSDoc)
test/defer-pi-menu.repro.test.ts  # hardened regression suite (same path, same harness)
test/widget.test.ts               # +deferral key-handling bullets (+harness knob)
spec/07-completion-ui.md          # 2 one-clause sync edits
spec/09-testing-and-acceptance.md # 1 one-clause sync edit
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: decideWidgetKey is PURE (data/visible/count/highlightIndex/
#   interacted/keybindings — no editor state) and MUST STAY PURE. Editor-state
#   checks belong in the wiring; the Enter-submit seam is the precedent.
#   Do NOT add an isShowingAutocomplete parameter or a new decision action.

# CRITICAL: NEVER mutate a shared editor instance (v1 RangeError crash, spec 07
#   h2.52 history). The deferral only READS through the proxy.

# The read must be defensive: innerRecord is Record<PropertyKey, unknown> —
#   cast exactly like editor.ts:113:
#   (innerRecord.isShowingAutocomplete as (() => boolean) | undefined)?.() === true
#   Wrap the whole check in try/catch; on ANY throw fall through to the normal
#   tab-insert path (deferral inert — the file's failure model: worst case
#   inert, never broken).

# Placement: AFTER the decision try/catch (~:1610-1620), BEFORE the
#   `decision.action === "forward"` line (:1621) — or anywhere before the
#   tab-insert branch (:1691). It must return BEFORE the consumed-tick block
#   (~:1667 opts.onKeystroke) so the press ticks exactly once (via
#   forwardInput's guard seam) and never double-ticks.

# Key on decision.action === "tab-insert", NOT on matchesKey(data, "tab"):
#   decideWidgetKey stays the single key classifier; the deferral is a veto on
#   one of its decisions. When the hapax line is hidden/empty the decision is
#   already "forward" — Tab forwards as today (no behavior change; case 3's
#   1st Tab depends on this).

# The eslint-disable comments in the repro are inert scaffolding (repo has no
#   eslint config) — remove them together with the console.log calls.

# test/no-persistence.test.ts greps for persistence: this change adds none.

# No eslint/ruff/prettier here — "style" gate = npm run check (tsc --noEmit,
#   strict). No new imports needed in widget.ts.
```

## Implementation Blueprint

### Data models and structure

None — no new data shapes. The only state touched is the early return path
through the existing `forwardInput` closure; `WidgetState`, the visibility
machine, the chain-grant, and `WidgetKeyDecision` are untouched.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/pi/widget.ts — the deferral pre-check (+ JSDoc)
  - LOCATE: widgetHandleInput (:1595). After the `decision = decideWidgetKey(...)`
    try/catch (:1610-1620) and BEFORE `if (decision.action === "forward")
    return forwardInput(data);` (:1621), insert:

      // Tab-deferral (P3.M1.T1.S1; spec 07 h2.46 + h2.51 — JSDoc below/at
      // the branch): pi's OWN menu is open → the Tab is pi's, never hapax's.
      try {
        if (
          decision.action === "tab-insert" &&
          (innerRecord.isShowingAutocomplete as (() => boolean) | undefined)?.() === true
        ) {
          return forwardInput(data);
        }
      } catch {
        /* deferral probe hiccup → fall through to the normal tab-insert path */
      }

  - JSDOC (Mode A, rides with the work): a block comment on/above the check
    documenting the rule — "Tab is forwarded verbatim (never inserted over)
    while the inner editor's own autocomplete menu is open: forced-file Tab,
    slash-argument menus, any stock surface. Deferral keys on the menu's
    ACTUAL open state, not static context classification — the
    hesitation/race case (menuDelayMs) can re-arm the hapax line while pi's
    menu is open, and classifyStockContext does not model the argument or
    forced-file surfaces. Spec anchors: 07 h2.46 ('stock path/slash
    completion is untouched by construction') + h2.51 never-hijack. The probe
    is fully defensive (optional chaining + try/catch): worst case inert."
  - PRESERVE: decideWidgetKey signature/table untouched; Enter-submits guard
    untouched; enter-submit / boundary-pass-through branches untouched.
  - NAMING: no new symbols beyond the inline check (nothing to name).

Task 2: HARDEN test/defer-pi-menu.repro.test.ts into a regression suite
  - KEEP: the file path, the harness verbatim (real Editor + provider double +
    createWidgetEditorFactory + flush/type helpers + setKeybindings module
    init), all four cases' existing assertions — especially the contrast
    case's `expect(text.startsWith("/mo")).toBe(true)`.
  - HEADER (line 1): replace "INVESTIGATION REPRO (not a regression suite yet)"
    with a regression-suite header, e.g. "REGRESSION SUITE (was an
    investigation repro): the widget layer defers to pi's own autocomplete
    menu when it is open — spec 07 h2.46/h2.51 (P3.M1.T1.S1)." Keep the
    harness-description paragraphs that follow.
  - RENAME describe label: "repro: hapax must defer to pi's open autocomplete
    menu" → "regression: hapax must defer to pi's open autocomplete menu".
  - STRIP: every `console.log(...)` call and its paired
    `// eslint-disable-next-line no-console` comment (all 4 cases).
  - STRENGTHEN (keep assertions, add preconditions so green can't be vacuous):
    in cases 1–3, where `showing` is already computed, assert
    `expect(showing).toBe(true)` BEFORE the accepting Tab (proves pi's menu
    really opened — the deferral's precondition). Where useful, keep the
    getText() read as an assertion (e.g. case 1: text contains "templates/")
    — but do NOT weaken or delete any existing expect.
  - DO NOT: rename the file, change DEFAULT_CONFIG/menuDelayMs values, alter
    the provider double's regex or items, or touch case 4's flow.

Task 3: EXTEND test/widget.test.ts — key-handling bullets for the deferral state
  - HARNESS: extend makeInsertHarness's `seed` parameter with an optional
    `piMenuOpen?: boolean`; when true, add to `raw`:
    `isShowingAutocomplete: () => true`. Default (absent) adds NOTHING —
    existing tests must be byte-identical in behavior (the widget probe reads
    undefined → inert).
  - ADD cases to the Tab describe (:942+), following existing naming and the
    ordered `calls` log style:
    1. "Tab while pi's menu is open (isShowingAutocomplete() === true)
       FORWARDS verbatim: inner receives the Tab bytes, NO setText/caret edit,
       line stays visible, no suppression, interacted untouched"
       — build with lines ["ze"], col 2, show(["Zendesk"]), piMenuOpen: true;
       press "\t"; assert innerCalls === ["\t"], no setText in calls,
       state not hidden, onDismissed never called (machine untouched).
    2. "deferral probe inert when the menu is closed/absent: Tab still inserts
       the highlighted word" — covered by the existing insert cases (the
       double has no member); make it explicit if cheap, else note in the
       describe header.
    3. "a THROWING isShowingAutocomplete never breaks input: falls through to
       the normal tab-insert path" — seed `isShowingAutocomplete: () => { throw
       new Error("probe"); }` (harness knob may need a function form), assert
       the insert still lands (setText called) and nothing throws.
  - CHECK the v2 wiring-observables describe (:643) still passes — deferral
    forwards tick exactly once via the guard seam (no double tick).

Task 4: SPEC SYNC (binding AGENTS.md policy — code and spec land together)
  - spec/07-completion-ui.md, "Tab inserts the highlighted word" bullet
    (:222): append one clause, e.g. "— UNLESS the inner editor's own
    autocomplete menu is open (isShowingAutocomplete): the Tab forwards
    verbatim and pi's menu accepts its item; deferral keys on the menu's
    actual open state, never on context classification (the hesitation race
    can re-arm the widget line while pi's menu is open)."
  - spec/07-completion-ui.md, "Tab-open gesture" FALLBACK-ONLY parenthetical
    (h3.13): amend the clause "Tab is consumed by the editor proxy before
    this editor branch can run" to note the deferral — e.g. "…before this
    editor branch can run (except while pi's own menu is open, when the
    widget defers — see Widget key handling)".
  - spec/09-testing-and-acceptance.md, widget.test.ts "Key handling
    (editor-proxy double)" bullet: append "Tab with pi's own menu open
    (isShowingAutocomplete() === true) forwards verbatim — never inserts a
    hapax word over an open stock menu (P3.M1.T1.S1)."
  - NOTE: these are one-clause edits riding with the code, not a spec
    redesign. If the pipeline context forbids spec edits in this item, record
    the exact three clauses verbatim in the final report for P3.M1.T2.S4's
    drift report instead — but default to landing them (the repo's binding
    policy).

Task 5: VALIDATION LOOP (below) — all levels, in order.
```

### Implementation Patterns & Key Details

```ts
// The ONE code change, in full (src/pi/widget.ts, inside widgetHandleInput):

/**
 * Tab-deferral (P3.M1.T1.S1; spec 07 h2.46 + h2.51). pi's OWN autocomplete
 * menu is open → the Tab is pi's, never hapax's: forward verbatim so the
 * stock menu accepts its highlighted item. Keyed on the menu's ACTUAL open
 * state (isShowingAutocomplete), not context classification — the forced-file
 * and slash-argument surfaces are unclassified, and the menuDelayMs race can
 * re-arm the widget line while pi's menu is open (repro case 3). Reads
 * forward through the enter-submit proxy to the real editor (editor.ts:111-115
 * precedent); fully defensive — a missing member or throw falls through to the
 * normal tab-insert path (worst case inert). Placed after decideWidgetKey (its
 * decision is vetoed, keeping the pure table free of editor state) and before
 * any insert/suppress/tick/arming executes: a forwarded deferral ticks the
 * clock exactly once (guard seam) and mutates nothing.
 */
try {
  if (
    decision.action === "tab-insert" &&
    (innerRecord.isShowingAutocomplete as (() => boolean) | undefined)?.() === true
  ) {
    return forwardInput(data);
  }
} catch {
  /* deferral probe hiccup → normal tab-insert path */
}

// PATTERN: same introspection idiom as the Enter-submit guard
// (editor.ts): optional-chained probe on a Record<PropertyKey, unknown> cast,
// strict `=== true`, try/catch around the whole check.
// GOTCHA: return BEFORE the consumed-tick block — a deferral is a forward,
// and forwardInput already ticks the guard's seam exactly once.
```

### Integration Points

```yaml
NO new integration points. Verified non-interactions:
- decideWidgetKey: unchanged — all table tests keep passing byte-identically.
- Enter-submit guard: untouched and still in the chain (forwardInput routes
  through it; it may still cancel a non-slash pi menu on Enter — unchanged).
- Chain arming: the deferral returns BEFORE the arm seam — a deferred Tab
  never arms/extends a chain (correct: hapax accepted nothing).
- Line claim / suppression / interacted: untouched by the deferral path.
- P2.M1.T2.S2 (parallel): test/branch-purity.test.ts + session_tree handler —
  zero file overlap; do not touch.
- P3.M1.T2.S2 (gauntlet) consumes this battery green; P3.M1.T2.S3 owns the
  BINDING live TTY verification of this key-handling change (spec 09
  technique; the work is not changeset-complete until that lands — note it
  in the commit/report, do not attempt it here).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check        # tsc --noEmit, strict — zero errors. (No eslint/prettier in this repo.)
```

Run after editing widget.ts, again after the test edits. The double cast in
the probe is required (innerRecord is Record<PropertyKey, unknown>).

### Level 2: Unit Tests (Component Validation)

```bash
# The battery — THE deliverable gate:
npx vitest run test/defer-pi-menu.repro.test.ts
# Expected: 4 passed (3 former reds + contrast). If any red persists, read
# which Tab was consumed: insert a temporary log in widgetHandleInput ONLY
# while debugging, remove before finishing (zero console.log in the final file).

# Wiring-level deferral bullets:
npx vitest run test/widget.test.ts
# Expected: all green incl. the new deferral cases; existing insert/navigate/
# escape/pass-through/tick-accounting cases unchanged.

# Guard purity + neighbors:
npx vitest run test/editor-enter.test.ts test/widget-visibility.test.ts test/chain.test.ts
# Expected: green (untouched behavior pins).
```

### Level 3: Integration Testing (System Validation)

```bash
npm test   # full suite
# Expected: green EXCEPT possibly the known environmental network-gated case:
#   test/acceptance.test.ts > "pi -p loads the real extension and answers
#   cleanly" (exit 1 + stderr outside the skip regex — pre-existing baseline
#   failure documented in architecture/04 §2; owned by P3.M1.T2.S2's gauntlet).
# RULE: compare against baseline. That one environmental signature → note it,
#   proceed. ANY other failure → a regression from this change: fix it here.
```

### Level 4: Creative & Domain-Specific Validation

Live TTY verification of this key-handling change is BINDING (spec 09 — UI
changes are verified live, not by unit tests alone) but is **sequenced to
P3.M1.T2.S3** (live smoke: series walk, branch hygiene, Tab deferral). This
item must NOT claim it. Do not add temporary instrumentation here; T2.S3 owns
the tmux send-keys walkthrough (one char at a time, 0.08–0.12 s sleeps).

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` — zero errors
- [ ] `npx vitest run test/defer-pi-menu.repro.test.ts` — 4/4 green
- [ ] `npx vitest run test/widget.test.ts` — green incl. new deferral bullets
- [ ] `npm test` — green vs baseline (only the known environmental acceptance
      case may fail; identical signature, noted in the report)

### Feature Validation

- [ ] All 3 former reds pass (`pi.applied` `["templates/"]` in each)
- [ ] Contrast case 4 unchanged and green; Enter-submits guard untouched
- [ ] `decideWidgetKey` untouched (diff shows zero changes above :1595 except
      none in the pure function)
- [ ] JSDoc present on the deferral branch, citing spec 07 h2.46 + h2.51
- [ ] Repro file: regression header, zero console.log, zero eslint-disable,
      precondition asserts (`showing === true`) in cases 1–3
- [ ] Spec sync clauses landed in spec/07 (×2) and spec/09 (×1) — or recorded
      verbatim for T2.S4's drift report
- [ ] Report notes the BINDING live-verification handoff to P3.M1.T2.S3

### Code Quality Validation

- [ ] Defensive probe only — optional chaining, `=== true`, try/catch,
      no mutation of the inner editor (v1 crash lesson)
- [ ] No new imports, no new symbols, no changes to exported signatures
- [ ] Harness changes are opt-in (`piMenuOpen` absent = today's double)

### Documentation & Deployment

- [ ] JSDoc is self-documenting; no environment variables; nothing persisted

## Anti-Patterns to Avoid

- ❌ Don't pass editor state into `decideWidgetKey` or add a new decision
  action — purity is a ratified convention (architecture/03 §R4).
- ❌ Don't classify contexts instead of probing the menu — case 3 proves
  static classification cannot work (hesitation race + unclassified surfaces).
- ❌ Don't dismiss/suppress the hapax line on deferral — it's a pure forward.
- ❌ Don't tick the clock twice (return before the consumed-tick block).
- ❌ Don't rename the repro file or weaken/delete existing assertions —
  "keep assertions" is contract.
- ❌ Don't mutate any editor instance, ever (v1 RangeError history).
- ❌ Don't chase the environmental acceptance.test.ts failure — it's the
  gauntlet's (T2.S2), not this item's.
- ❌ Don't run or claim the live TTY verification — it's T2.S3's, and it's
  BINDING there.

---

**Confidence Score**: 9/10 — the fix is a single veto branch at a
research-verified insertion point with a live-confirmed red battery as its
gate, an exact precedent idiom to copy, and backwards-compatible harness
extension. Residual risk: case 3's fake-timer choreography interacting with
the hesitation gate is the only subtle path, and the battery itself will
prove it the moment the branch lands.
