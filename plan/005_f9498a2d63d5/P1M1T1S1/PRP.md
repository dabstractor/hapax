# PRP — P1.M1.T1.S1 (plan 005): WidgetState generation flag + WidgetKeyDecision/decideWidgetKey v2 decision table

---

## Goal

**Feature Goal**: Land the 2026-10 arrow-interaction model v2 in its pure,
testable core: (a) an `interacted` generation flag on `WidgetState` (reset
at every result-set change — `set()` IS the generation boundary), (b) the
rewritten `WidgetKeyDecision` union (boundary-esc → boundary-pass-through,
clamp DELETED), and (c) `decideWidgetKey` v2 with the `interacted`
parameter implementing the full decision table (pass-through on un-entered
boundary arrows, carousel wrap after interaction).

**Deliverable** (src/pi/widget.ts + test/widget.test.ts):
- `WidgetState.interacted: boolean` (+ internal, + createWidgetState
  init/reset sites)
- `WidgetKeyDecision` union: navigate / boundary-pass-through / escape /
  tab-insert / enter-submit / forward (clamp and boundary-esc GONE)
- `decideWidgetKey(data, visible, count, highlightIndex, interacted,
  keybindings?)` implementing the v2 table
- The minimal wiring change at the single production call site
  (widget.ts ~1372) required to keep `npm run check` green — S2 completes
  wiring polish/comment sync
- Rewritten pure decision-table describes (test/widget.test.ts:986–1057)
  plus the directly-affected old-model describes that would otherwise not
  compile or pin removed actions

**Success Definition**: `npm run check` green; the new decision-table
describes pin every v2 table cell; widget.test.ts green (old-model
describes updated — see Gotchas on the S1/S3 test split); full `npm test`
green. Zero behavior change is NOT expected — the v2 table IS the new
behavior; the exhaustive spec/09 battery expansion is P1.M1.T1.S3.

## Why

Spec 07 h3.9 (adopted ahead of implementation) replaces the old model
(consumed boundary-Esc, consumed clamp) with one-press plain-pi parity:
before the list is entered, boundary ↑/← dismisses AND forwards the press
(the caret moves on that same keypress), and →/↓ on a one-word line
forwards verbatim (no arrow press is ever consumed pre-entry). After the
first highlight-moving arrow, the generation is "entered": the cluster is
captured and both edges wrap end-to-end (carousel; the clamp is retired as
unreachable). The generation flag resets on every genuinely-new result set
(`applyVisibility`'s signature compare means `set()` fires exactly at set
changes — verified, so set() is the generation boundary). Today's code
(widget.ts:976–1018) implements only the old model and `interacted` has
ZERO hits in src/ and test/.

## What

### v2 decision table (implement exactly; all index math on the RENDERED count param)

| # | Condition | Decision |
|---|-----------|----------|
| 0 | `!visible \|\| count <= 0` | `forward` |
| 1 | Escape (any state, any index) | `escape` (consumed — unchanged) |
| 2 | ↑/←, un-interacted, `i === 0` | `boundary-pass-through` (dismiss + suppress + FORWARD verbatim) |
| 3 | →/↓, un-interacted, `count === 1` | `forward` (line stays, no dismiss, no suppress) |
| 4 | →/↓, un-interacted, multi-word | `navigate {delta: 1}` (entering the list — wiring sets interacted) |
| 5 | ↑/←, interacted, `i === 0` | `navigate` wrapping to LAST |
| 6 | →/↓, interacted, `i === count-1` | `navigate` wrapping to FIRST |
| 7 | interior arrows | `navigate {delta: ±1}` |
| 8 | un-interacted arrow with `i > 0` (theoretically unreachable) | DEGRADE to a navigate decision (marks the generation interacted) — NEVER forward |
| 9 | Tab | `tab-insert` (unchanged) |
| 10 | submit key | `enter-submit` (unchanged) |

Wrap representation: delta ±(count−1) OR an absolute-target field —
implementer's choice — but see the CRITICAL wiring pitfall: the existing
navigate clamp at widget.ts:1415–1420 nulls a wrap delta, so if the
decision carries only a delta, the wiring (S2; minimal version included
here for compile parity) must compute the index modularly:
`((i + delta) % count + count) % count`.

### interacted flag semantics

- `WidgetState.interacted: boolean`, init `false` in `createWidgetState`.
- Reset `false` inside `set()` (line ~304, beside `highlightIndex = 0`) —
  covers every show/fresh generation — and defensively inside `hide()`.
- There is no separate `show()` — showing IS `set()` (verified).
- Exposed on the exported `WidgetState` interface so tests drive/read it
  via `widgetStateOf`.

### Success Criteria

- [ ] All 11 table rows pinned by rewritten pure decision-table tests
- [ ] `decideWidgetKey(LEFT, true, 3, 0, false)` → `boundary-pass-through`
- [ ] `decideWidgetKey(DOWN, true, 1, 0, false)` → `forward`
- [ ] `decideWidgetKey(DOWN, true, 3, 0, false)` → `navigate {delta:1}`
- [ ] `decideWidgetKey(UP, true, 3, 0, true)` → wrap to index 2 (last)
- [ ] `decideWidgetKey(RIGHT, true, 3, 2, true)` → wrap to index 0 (first)
- [ ] `decideWidgetKey(UP, true, 3, 2, false)` (row 8 defensive) → navigate,
      NOT forward
- [ ] `state.set(...)` resets `interacted` to false; `hide()` too
- [ ] `WidgetKeyDecision` no longer contains `boundary-esc` or `clamp`
      (grep clean outside docs history)
- [ ] `npm run check` + full `npm test` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: every touched line is
reproduced with verified line anchors, the full v2 table is enumerated,
the wiring pitfall is pre-solved, and the exact test blocks to rewrite are
listed with their old-model contents.

### Documentation & References

```yaml
- file: src/pi/widget.ts
  why: PRIMARY file. Verified at HEAD 23fd764:
    - WidgetKeyDecision (:976–983): union with navigate{delta:-1|1},
      boundary-esc, clamp, escape, tab-insert, enter-submit, forward.
    - decideWidgetKey (:999–1018): PURE, params
      (data, visible, count, highlightIndex, keybindings?); stale-index
      clamp `const i = Math.min(Math.max(highlightIndex, 0), count - 1);`
      at :1007; then escape → up/left (i===0 ? boundary-esc : navigate −1)
      → down/right (i===count−1 ? clamp : navigate +1) → tab → isSubmitKey
      → forward. Keys matched via pi-tui's matchesKey; submit via
      isSubmitKey (editor.ts export) — keep both.
    - WidgetState (:278–286): set()/hide()/highlightIndex.
      WidgetStateInternal (:289–292): adds items, hidden.
      createWidgetState (:297–315): set() copies items, highlightIndex=0
      (:304), hidden=false; hide() sets hidden=true, items=[] (:307–310).
    - widgetStateOf (:318–321): the test seam for WidgetState.
    - applyVisibility (:1286–1300): signature-compares (pushedSig) — set()
      fires ONLY on genuinely-new result sets ⇒ set() is the generation
      boundary (verified by architecture recon).
    - renderedCount (:1346–1350): lastWidth undefined → items.length else
      fitItems — the `count` the wiring passes today (keep).
    - widgetHandleInput (:1365–1493): the ONLY production call site of
      decideWidgetKey (:1372–1377, try/catch → forward). Branches:
      navigate (:1414–1420, CLAMPS — the wrap pitfall), escape∥boundary-esc
      (:1421–1429: hide + onDismissed(true)), tab-insert (:1430–1460),
      clamp fall-through (:1480–1481), enter-submit (:1383–1399 — the
      TEMPLATE for boundary-pass-through: dismiss, then
      `return forwardInput(data)` BEFORE the consumed-tick block
      :1400–1413).
  pattern: keep decideWidgetKey pure/table-testable; wiring owns ALL state
    mutation; consumed keys tick opts.onKeystroke exactly once (:1409),
    forwarded keys tick via the guard seam (never double-tick).
  gotcha: boundary-pass-through FORWARDS ⇒ its branch must return
    forwardInput(data) BEFORE the consumed-tick block, exactly like
    enter-submit — otherwise the guard seam double-ticks (observable:
    onKeystroke called exactly once TOTAL per press).

- docfile: plan/005_f9498a2d63d5/architecture/system_context.md
  why: THE verified code map this contract cites. Sections used verbatim
    here: "Where the old model lives" (branch table with hide/tick/return
    columns), "Generation state home" (set()-is-the-boundary proof,
    interacted exposure), "CRITICAL pitfall — wrap vs the navigate clamp"
    (modular-index requirement), "Tick seams", "Suppression seam"
    (onDismissed(true) arms suppression; a pass-through press IS an
    explicit dismissal), "Test harness" (makeKeyHarness :~427–466:
    press() → editor.handleInput, show(displays) → state.set() DIRECTLY,
    innerCalls log, setHits() never-mutate pin), "grep inventory" (false
    friends: config.ts clampNumber, score/query clamps — DO NOT touch),
    "Ripple containment" (decideWidgetKey imported only by widget.ts +
    test/widget.test.ts:47–56; WidgetState also used by
    test/editor-enter.test.ts — type-additive, safe).
  critical: old-model prose to rewrite in this subtask (Mode A docs):
    header blurb :57–73; :1367 ("caret must not move on
    boundary-Esc/clamp"); :1480 ("clamp: consumed, no movement"); the
    decision-type JSDoc (:970–975) and decideWidgetKey JSDoc (:989–998);
    WidgetState field docs (:278–286) incl. the new interacted field's
    generation semantics. (VisibilityState docs :331/:401 mention
    boundary-Esc — update the wording; S2 syncs the rest.)

- file: test/widget.test.ts
  why: TDD target. Verified blocks:
    - Pure decision-table describes :986–1057 — REWRITE to the v2 table
      (old pins at :998–1007 boundary-esc/clamp; stale-index clamp case
      :1045 — KEEP its intent under v2: a stale index > 0 with
      interacted=false must not forward (row 8); single-item case :1052 —
      now expects forward for →/↓ and boundary-pass-through for ↑/←).
      NOTE the old calls `decideWidgetKey(key, false, 3, 0)` take 4-5
      args — the new `interacted` param (before keybindings) changes the
      call shape; every direct call must pass it.
    - Old-model behavior describes that will fail/stop compiling under
      v2: boundary-Esc describe :526 (its :527–541; single-item :542–556),
      clamp describe :558 (:559–574), width-truncation it :507 (asserts
      clamp at rendered end — under v2 that press, after navigation
      (interacted), WRAPS to first), input-clock it :637 (clamp press),
      full-scenario it :969 (KEEP the zero-setHits pin; update the
      scenario's clamp/boundary steps to v2 expectations).
    - KEEP unchanged: never-mutate set-trap pins, insert harness
      (makeInsertHarness :~678–763), tab/enter describes.
  pattern: describe/it with the key constant inline (UP/LEFT/RIGHT/DOWN/
    ESC imported per file header :47–56); harness helper makeKeyHarness.

- prd: spec/07 h3.9 (the authoritative v2 model text — reproduced in
    selected_prd_content above) + spec/01 goals/limitations (one-press
    plain-pi parity) + spec/09 widget bullets — S3 builds the exhaustive
    battery from these; S1 pins the decision-table cells.
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/pi/widget.ts        # MODIFY (state flag + type + decideWidgetKey v2 + minimal wiring compile-parity + docs)
└── test/widget.test.ts     # MODIFY (decision-table rewrite + directly-affected old-model describes)
   (test/editor-enter.test.ts uses WidgetState — additive field, no change)
```

### Known Gotchas of our Codebase & Library Quirks

```python
# CRITICAL — wrap vs the navigate clamp: the wiring at :1415–1420 clamps
#   into [0, renderedCount−1]; a wrap delta ±(count−1) would be clamped
#   back to the edge (no movement). Either (preferred for S1 minimalism)
#   keep delta ±(count−1) AND change the wiring's navigate application to
#   modular: idx = ((i + delta) % count + count) % count — or carry an
#   absolute target on the decision. Modular-in-wiring is fine; document it.
# CRITICAL — row ordering matters for rows 2–4: check interacted BEFORE
#   the boundary tests. Row 3 (count===1, un-interacted, →/↓ → forward)
#   must precede the generic navigate arm or a one-word line navigates to
#   itself (consumed!) — the spec forbids ANY consumed arrow pre-entry.
# CRITICAL — row 8 (un-interacted, i>0) must degrade to navigate, never
#   forward: a forward would silently hand the arrow to the editor while
#   hapax's highlight disagrees with the caret — the defensive branch
#   keeps the invariant "no arrow consumed pre-entry unless it
#   pass-through-dismisses".
# GOTCHA — S1/S2 split on wiring: the signature change breaks the single
#   production call site; S1 MUST update it (pass state.interacted; delete
#   the dead clamp branch at :1480–1481; rename/reshape the boundary-esc
#   branch :1421–1429 into boundary-pass-through with the enter-submit
#   shape: hide + machine.onDismissed(true) + return forwardInput(data)
#   BEFORE the consumed-tick block; apply navigate modularly and set
#   state.interacted = true when a navigate lands on an un-interacted
#   generation). S2's job is then comment-sync/polish + tick-seam
#   verification — the semantics land HERE so the suite is green at S1 exit.
# GOTCHA — test split: S1 rewrites only the decision-table describes
#   (:986–1057) and the directly-affected behavior describes (:507, :526,
#   :542–556, :558, :637, :969) to v2 expectations; S3 is the exhaustive
#   spec/09 battery (fresh-generation re-arming, pass-through never setting
#   the flag, one-word never-interacted pin, live-press parity etc.).
#   Do not let S1 balloon into S3.
# GOTCHA — a pass-through press IS an explicit dismissal: hide() +
#   onDismissed(true) arms suppression-until-next-word-start. Forwarding
#   does NOT mean "no state change" — only "no consumption".
# GOTCHA — interacted is set by the WIRING on navigate (the decision stays
#   pure); a pass-through (row 2/3) and Tab/Enter NEVER set it.
# GOTCHA — false friends in grep: config.ts clampNumber, score/query
#   clamps, render-path clamp :267, decision stale-index clamp :1007 (KEEP
#   that one) — only the clamp ACTION variant and its wiring branch die.
# GOTCHA — count param is the RENDERED count (width truncation shrinks the
#   list); the wiring already passes renderedCount() — keep.
```

## Implementation Blueprint

### Data models and structure

```typescript
// WidgetState (:278–286) — add:
/** True once an arrow has MOVED the highlight in the CURRENT generation
 *  (2026-10 model v2): un-interacted boundary arrows pass through
 *  (one-press plain-pi parity); interacted edges wrap end-to-end
 *  (carousel). Reset by set() — a genuinely-new result set (the
 *  signature compare upstream means set() fires exactly at set changes)
 *  starts a fresh generation — and defensively by hide(). A pass-through
 *  press never sets it; a one-word line therefore never becomes
 *  interacted. */
interacted: boolean;

// WidgetStateInternal init: interacted: false
// set(): state.interacted = false;   // beside highlightIndex = 0
// hide(): state.interacted = false;  // defensive

// WidgetKeyDecision v2 (:976–983):
export type WidgetKeyDecision =
  | { action: "navigate"; delta: -1 | 1 }          // interior ±1; wrap = ±(count−1)
  | { action: "boundary-pass-through" }            // un-entered ↑/← at first: dismiss+suppress+FORWARD
  | { action: "escape" }
  | { action: "tab-insert" }
  | { action: "enter-submit" }
  | { action: "forward" };
// clamp: DELETED (retired as unreachable: reaching the last word requires
// navigation, which interacts the generation, and interacted edges wrap)
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — rewrite the decision-table describes FIRST (test/widget.test.ts :986–1057)
  - Every direct call gains the interacted arg:
      decideWidgetKey(data, visible, count, index, interacted, keybindings?)
  - PIN every row of the table (Success Criteria list above), plus:
      stale-index case (:1045 intent kept): decideWidgetKey(LEFT, true, 3, 2, false)
        → navigate {delta:-1} (row 8 degrade — NOT forward)
      single-item (:1052): (UP, true, 1, 0, false) → boundary-pass-through;
        (DOWN, true, 1, 0, false) → forward
      hidden/empty (:989–992): unchanged → forward
      escape/tab/enter-submit rows: unchanged for both interacted values
  - Also update the directly-affected behavior describes (:507, :526–574,
    :637, :969) to v2 expectations via makeKeyHarness — including the new
    observable: boundary-pass-through forwards (innerCalls gains the key)
    AND dismisses (state.hidden) AND suppresses (machine getState
    suppressUntilWordStart if the harness exposes the machine; else pin
    dismiss+forward). Keep the :969 zero-setHits pin.
  - RUN → RED (v2 not implemented; also type errors on removed variants).

Task 2: IMPLEMENT the flag (src/pi/widget.ts state sites)
  - WidgetState field + JSDoc; WidgetStateInternal; createWidgetState
    init; set() reset (:304 site); hide() reset (:307–310 site).

Task 3: IMPLEMENT decideWidgetKey v2
  - Signature with interacted BEFORE keybindings; keep the stale-index
    clamp (:1007) and matchesKey/isSubmitKey plumbing; order per the
    table (rows 0,1,2,3,4,5,6,7,8,9,10 — interacted checks before
    boundary checks; count===1 forward before generic navigate).
  - Wrap as delta ±(count−1) (recommended) with a comment pointing at the
    wiring's modular application; or absolute target — either, but
    document which.
  - REWRITE the JSDoc on both the type (:970–975) and function (:989–998)
    to describe the v2 table (Mode A).

Task 4: MINIMAL WIRING COMPILE-PARITY (widgetHandleInput)
  - Call site (:1372): pass state.interacted.
  - DELETE the clamp branch (:1480–1481).
  - RESHAPE the boundary branch (:1421–1429) into boundary-pass-through
    with the enter-submit shape: try { state.hide();
    machine.onDismissed(true); } catch {} ; return forwardInput(data);
    — BEFORE the consumed-tick block.
  - NAVIGATE branch (:1414–1420): apply modularly
    (idx = ((state.highlightIndex + delta) % count + count) % count with
    count = renderedCount()) and set state.interacted = true when it
    lands on an un-interacted generation (only →/↓ can, per the table).
  - Update the prose at :57–73, :1367, :1480 to the v2 model.

Task 5: FULL REGRESSION
  - npm run check
  - npm test    # green at S1 exit (S3 expands the battery further)
  - grep -n "boundary-esc\|\"clamp\"" src/pi/widget.ts → only docs/history
    mentions, no live variants
```

### Implementation Patterns & Key Details

```typescript
// The v2 core (rows 2–8), illustrative:
const i = Math.min(Math.max(highlightIndex, 0), count - 1);
if (matchesKey(data, "escape")) return { action: "escape" };
if (matchesKey(data, "up") || matchesKey(data, "left")) {
  if (!interacted && i === 0) return { action: "boundary-pass-through" };
  return { action: "navigate", delta: i === 0 ? -(count - 1) : -1 };
}
if (matchesKey(data, "down") || matchesKey(data, "right")) {
  if (!interacted) {
    if (count === 1) return { action: "forward" };   // one-word: nothing to enter
    return { action: "navigate", delta: 1 };          // entering the list
  }
  return { action: "navigate", delta: i === count - 1 ? (count - 1) : 1 };
}
// row 8 falls out naturally: un-interacted i>0 arrows hit the navigate
// arms (never boundary/forward) — verify with the pin.

// Wiring navigate application (modular — beats the old clamp):
const n = renderedCount();
if (n > 0) {
  state.highlightIndex = ((state.highlightIndex + decision.delta) % n + n) % n;
  state.interacted = true;
}
```

### Integration Points

```yaml
CONSUMERS:
  - widget.ts widgetHandleInput (updated in Task 4; S2 polishes
    comments + verifies tick seams).
  - test/widget.test.ts :47–56 import (rewritten in Task 1; S3 expands).
  - test/editor-enter.test.ts uses the WidgetState TYPE — additive field,
    no change needed (verified by Ripple containment).
NEXT TASKS:
  - P1.M1.T1.S2: wiring polish — comment sync (:331/:401 docs), tick-seam
    one-tick-per-press verification, any branch the minimal version left
    unpolished.
  - P1.M1.T1.S3: exhaustive spec/09 battery (fresh-generation re-arming,
    pass-through-never-sets-flag, one-word never-interacted, live-press
    parity).
NO CHANGES: renderedCount, applyVisibility, insertHighlighted, visibility
  machine, config, README (P1.M2.T1).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — new signature + union typecheck everywhere
```

### Level 2: Unit Tests (TDD)

```bash
npx vitest --run test/widget.test.ts                     # rewritten blocks green
npx vitest --run test/widget.test.ts -t decideWidgetKey -v  # full v2 table
npm test                                                 # full suite green
```

### Level 3: Integration

```bash
npx vitest --run test/editor-enter.test.ts test/widget-visibility.test.ts
# WidgetState type consumer + visibility machine — unaffected, must stay green
```

### Level 4: Domain-Specific

Not applicable — live TTY verification is P1.M2.T1.S3 (binding).

## Final Validation Checklist

- [ ] `interacted` flag on WidgetState with generation semantics documented; reset in set() and hide()
- [ ] `WidgetKeyDecision` v2 union (no boundary-esc, no clamp)
- [ ] `decideWidgetKey` v2 signature with interacted param; all 11 table rows implemented
- [ ] All decision-table pins green incl. stale-index degrade and single-item cases
- [ ] Minimal wiring updated (pass-through branch shape, modular navigate, interacted set, dead clamp removed)
- [ ] Old-model prose rewritten at :57–73, :970–998, :1367, :1480; WidgetState docs updated
- [ ] `npm run check` + full `npm test` green
- [ ] Only src/pi/widget.ts and test/widget.test.ts modified
- [ ] Not ballooned into S2 (comment-sync polish) or S3 (battery expansion)

## Anti-Patterns to Avoid

- ❌ Don't keep or "re-add" clamp in any form — retired as unreachable by the model
- ❌ Don't forward the un-interacted i>0 arrow (row 8 must navigate)
- ❌ Don't check boundary before interacted (rows would invert)
- ❌ Don't let boundary-pass-through hit the consumed-tick block (double tick; follow the enter-submit shape)
- ❌ Don't set interacted on pass-through, Tab, Enter, or Escape — only on a landing navigate
- ❌ Don't apply wrap via the old clamping navigate wiring (nulls the wrap — the CRITICAL pitfall)
- ❌ Don't touch the false friends (config clampNumber, score/query/render clamps, the :1007 stale-index clamp)
- ❌ Don't use raw ANSI matching (matchesKey/isSubmitKey stay)

---

**Confidence Score**: 9/10 — every touched line, branch, and test block was
verified at HEAD by the architecture recon and spot-checked against live
source this session; the v2 table is fully enumerated from the adopted
spec; the two hard traps (navigate clamp nulling wrap; pass-through tick
ordering) are pre-solved with exact code shapes.
