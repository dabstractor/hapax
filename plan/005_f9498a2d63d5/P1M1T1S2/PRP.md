# PRP — P1.M1.T1.S2 (plan 005): widgetHandleInput wiring — boundary-pass-through branch, navigate wrap + interacted flag, comment sync

---

## Goal

**Feature Goal**: Complete the v2 arrow-interaction wiring in
`widgetHandleInput` (src/pi/widget.ts :1365–1493) on top of S1's landed
primitives (`decideWidgetKey` v2 + `WidgetState.interacted`): (a) a new
`boundary-pass-through` branch shaped exactly like enter-submit
(dismiss + suppress + FORWARD, no widget-layer tick); (b) the navigate
branch applying deltas MODULARLY (carousel wrap) and setting
`state.interacted = true` on every navigate decision; (c) verified
no-op forward for un-interacted →/↓ on a one-word line; (d) all old-model
comments rewritten to the v2 pass-through + carousel model (Mode A).
Tab-insert (incl. chain arming :1457–1460), escape, enter-submit, and the
plain forward branch are UNCHANGED.

**Deliverable**:
- Wired v2 branches in `src/pi/widget.ts` (or a verified+polished audit if
  S1's minimal wiring already landed the semantics)
- Rewritten comments at :57–73 (header model blurb), :1367, :1480, and the
  boundary-Esc mentions at :331 (VisibilityState.suppressUntilWordStart)
  and :401 (onDismissed)
- TDD: failing wiring-level tests first (makeKeyHarness: forwarded data
  verbatim, suppression armed, exactly one tick per press)

**Success Definition**: un-interacted ↑/← at the first word dismisses the
line, arms suppression, and reaches the inner editor verbatim on the SAME
keypress with exactly ONE total onKeystroke tick; interacted edges wrap
end-to-end; every navigate marks the generation interacted;
`npm run check` + full `npm test` green — the wired behavior P1.M1.T1.S3's
battery consumes.

## Why

Spec/07 h3.9 (adopted ahead of implementation) replaces the old consumed
boundary-Esc/clamp model with one-press plain-pi parity: a user who never
enters the list experiences ↑/← exactly as with no extension installed
(the caret moves on that same keypress — NO second press), and after the
first highlight-moving arrow the cluster is captured with carousel wrap
(the clamp is retired as unreachable). S1 landed the pure decision table
and state flag; the wiring — where ticks, returns, and mutation live — is
this task. Getting the branch SHAPE wrong (e.g. letting pass-through hit
the consumed-tick block) double-ticks the input clock and corrupts
hesitation timing — the traps this PRP pre-solves.

## What

### (a) Boundary-pass-through branch — exact enter-submit shape

Place it with the other decision branches, BEFORE the consumed-tick block
(:1400–1413), returning early:

```typescript
if (decision.action === "boundary-pass-through") {
  // v2 one-press plain-pi parity (spec §07 h3.9, 2026-10): un-entered
  // ↑/← at the first word dismisses the line, arms suppression, and
  // FORWARDS the press verbatim — the caret moves on this same keypress.
  // NOT consumed: return BEFORE the consumed-tick block, exactly like
  // enter-submit — the guard's delegation seam ticks exactly once
  // (createEnterSubmitEditor); a widget-layer tick here would
  // double-tick and corrupt hesitation timing.
  try {
    state.hide();                 // immediate visual dismissal…
    machine.onDismissed(true);    // …+ suppression until the next word
                                  // start — the ONLY suppression seam
  } catch {
    /* dismissal hiccups never break the press */
  }
  return forwardInput(data);
}
```

### (b) Navigate branch — modular wrap + interacted flag

Replace the clamp math (:1414–1420):

```typescript
if (decision.action === "navigate") {
  // v2 carousel (spec §07 h3.9): wrap deltas are ±(count−1) — apply
  // MODULARLY; the old Math.max/Math.min clamp nulls them. count is the
  // RENDERED count (width truncation shrinks the list).
  const n = renderedCount();
  if (n > 0) {
    state.highlightIndex =
      ((state.highlightIndex + decision.delta) % n + n) % n;
  }
  // Any arrow press that MOVES the highlight marks the generation
  // interacted (spec: "the first arrow press that MOVES the highlight
  // marks the generation"). Setting on EVERY navigate decision also
  // covers the defensive un-interacted i>0 corner (row 8's degrade).
  state.interacted = true;
}
```

The branch stays inside the consumed path: exactly one widget-layer tick
via the existing `opts.onKeystroke?.()` at :1409 — do not add another.

### (c) Row-3 forward verification (no code unless broken)

Un-interacted →/↓ on a one-word line must forward with the line STAYING
visible — no hide, no suppress. The existing
`if (decision.action === "forward") return forwardInput(data);` (:1382)
already satisfies this (no state touched, tick comes from the guard's
delegation seam). Verify with a harness test; only touch code if it
misbehaves.

### (d) Unchanged branches

`escape`, `tab-insert` (including the painted-capture, chain arming at
rec.key with strict `tier !== 0`, and `chainGrant.reset()` — :1430–1460),
`enter-submit`, and the plain `forward` return keep their current bodies —
only comment labels shift if S1 renamed the union (boundary-esc → gone).

### Comment sync (Mode A — this same subtask)

- Header model blurb (:57–73): rewrite to the v2 model — arrows consumed
  only after the list is entered; boundary pass-through moves the caret on
  the same press; interacted carousel wrap; clamp retired.
- :1367 ("the caret must not move on boundary-Esc/clamp") — now false;
  rewrite (consumed keys never move the caret; boundary-PASS-THROUGH
  deliberately does, via the forward).
- :1480 ("clamp: consumed, no movement") — delete/rewrite (the clamp
  branch is gone; wraps move modularly).
- :331 (VisibilityState.suppressUntilWordStart doc) and :401 (onDismissed
  doc): update boundary-Esc wording to boundary pass-through / explicit
  dismissal.

### Success Criteria

- [ ] Un-interacted ↑/← at first word: line hides,
      `machine.getState().suppressUntilWordStart` arms, `innerCalls`
      receives the press data VERBATIM, exactly ONE total onKeystroke tick
- [ ] Interacted ↑/← at first → highlight lands on LAST; interacted →/↓
      at last → wraps to FIRST (rendered-count aware)
- [ ] Every navigate decision sets `state.interacted = true`
- [ ] Un-interacted →/↓ on a one-word line: forwards, line stays visible,
      no suppress, no hide
- [ ] Pass-through press does NOT set interacted; Tab/Enter/Escape do not
- [ ] tab-insert/arming (:1430–1460), escape, enter-submit byte-identical
- [ ] All listed comments rewritten; no stale boundary-Esc/clamp prose
- [ ] `npm run check` + full `npm test` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the current
widgetHandleInput body is reproduced with line anchors, the branch shapes
are given as exact code, the tick-seam and clamp pitfalls are pre-solved,
and the S1 contract defines precisely what already exists.

### Documentation & References

```yaml
- file: src/pi/widget.ts
  why: The ONLY source file to modify. Verified widgetHandleInput
        (:1365-1493) structure:
        - decision call (:1372-1377) — S1 may already pass
          state.interacted (its Task 4 minimal wiring); VERIFY against
          the landed S1 and keep the call shape
          (data, !state.hidden, renderedCount(), state.highlightIndex,
          state.interacted, keybindings).
        - enter-submit (:1383-1399): THE template — try {state.hide();
          machine.onDismissed(true);} catch {} ; return forwardInput(data);
          placed BEFORE the consumed-tick block. Copy this shape exactly
          for boundary-pass-through.
        - consumed-tick block (:1400-1413): opts.onKeystroke?.() at :1409,
          try/catch, deliberately does NOT tick the visibility machine
          (comment explains: consumed keys never move the caret; a
          re-evaluation could clobber the highlight mid-navigation).
          KEEP as-is.
        - navigate (:1414-1420): clamp math to REPLACE with modular.
        - escape∥boundary-esc (:1421-1429): hide + onDismissed(true),
          consumed — under v2 only "escape" remains; if S1 left a
          boundary-esc case arm it must be gone (the union deleted it).
        - tab-insert (:1430-1460): UNTOUCHED — includes the
          painted-capture-before-insert (hide() clears painted()),
          chain arming (rec.key verbatim, strict tier !== 0,
          enableChaining gate) and chainGrant.reset().
        - :1367 comment and :1480 tail comment — rewrite.
        - :331 / :401 docs (VisibilityState.suppressUntilWordStart,
          onDismissed) — wording sync.
        - Header blurb :57-73 — model rewrite.
  pattern: defensive try/catch around every state/machine interaction —
        "worst case inert, input never breaks" is the file's failure model.
  gotcha: forwardInput is the shared forward closure (guard chain +
        inner); pass-through MUST use it, never a direct inner call.

- file: plan/005_f9498a2d63d5/P1M1T1S1/PRP.md
  why: CONTRACT for what exists at S2 start: WidgetKeyDecision v2 union
        (navigate / boundary-pass-through / escape / tab-insert /
        enter-submit / forward), decideWidgetKey(data, visible, count,
        highlightIndex, interacted, keybindings?), WidgetState.interacted
        (reset in set() — the generation boundary — and hide()). S1's
        Task 4 MAY have landed a minimal wiring (pass interacted, delete
        the clamp branch, reshape boundary-esc, modular navigate, set
        interacted) for compile parity — AUDIT each item below against
        the landed code and complete/polish whatever is missing or
        unpolished; the full semantics + comment sync are S2's
        deliverable either way. If decideWidgetKey v2 is absent, STOP.
  critical: wrap deltas are ±(count−1) — S1 documented the wiring MUST
        apply them modularly (the old clamp nulls them). This PRP's (b)
        is that application.

- docfile: plan/005_f9498a2d63d5/architecture/system_context.md
  sections: 'widgetHandleInput branch map', 'Tick seams',
    'Suppression seam', 'Test harness'
  why: The verified code map. Tick seams: the guard's delegation seam
    (createEnterSubmitEditor :1302-1317) ticks every FORWARDED key
    exactly once; the widget layer ticks consumed keys at :1409 — a
    branch that both forwards AND falls into the consumed-tick block
    double-ticks and corrupts hesitation timing (THE pass-through trap).
    Suppression seam: machine.onDismissed(true) is the ONLY way to arm
    suppressUntilWordStart. Test harness: makeKeyHarness (:~427-466) —
    press() → editor.handleInput, show(displays) → state.set() directly,
    innerCalls log, zero-setHits never-mutate pin.

- file: test/widget.test.ts
  why: TDD target. makeKeyHarness drives the composed proxy; the
    observables for the new wiring tests: (1) innerCalls receives the
    forwarded data verbatim (pass-through + one-word forward); (2) the
    harness's machine state shows suppressUntilWordStart armed after
    pass-through; (3) a tick-counting onKeystrobe via opts.onKeystroke
    called exactly once per press (pass-through press included — its one
    tick comes from the guard seam, so the WIDGET-layer probe must count
    total ticks through the composed stack, or assert the widget-layer
    opts.onKeystroke is NOT called for pass-through while the composed
    press still ticks once — follow the harness's existing tick tests).
    S1 already updated the directly-affected describes; add wiring-level
    cases only for what S2 owns (pass-through branch observables, wrap
    application, interacted flag at the composed level).
  gotcha: do NOT rewrite S3's battery (fresh-generation re-arming,
    never-set-flag-on-pass-through pins at scenario scale) — S2 pins the
    branch observables; S3 expands.

- prd: spec/07 h3.9 + h3.10 + h2.47 (reproduced in selected_prd_content)
  — the authoritative v2 model: one-press plain-pi parity, symmetric
  transparency (row 3), carousel after interaction, explicit-dismissal
  suppression, fresh generation on set().
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/pi/widget.ts        # MODIFY — wiring branches + comment sync
└── test/widget.test.ts     # MODIFY — wiring-level TDD cases (S3 owns the battery)
```

### Desired Codebase tree with files to be changed

```bash
src/pi/widget.ts        # boundary-pass-through branch, modular navigate + interacted, comments
test/widget.test.ts     # +~6 wiring-level its (branch observables)
```

### Known Gotchas of our Codebase & Library Quirks

```python
# CRITICAL — tick ordering: boundary-pass-through MUST return
#   forwardInput(data) BEFORE the consumed-tick block (:1400-1413), or
#   the press double-ticks (widget layer + guard delegation seam) and
#   hesitation timing corrupts. Enter-submit is the exact precedent.
# CRITICAL — modular wrap: the old clamp (Math.max(0, Math.min(i+delta,
#   n-1))) NULLS a wrap delta (i + (n-1) clamps back to n-1 → no
#   movement). Apply ((i + delta) % n + n) % n with n = renderedCount().
# GOTCHA — set state.interacted = true on EVERY navigate decision (not
#   just un-interacted entries): it also covers the defensive row-8
#   corner (un-interacted i>0 degraded to navigate) and costs nothing.
# GOTCHA — a pass-through press IS an explicit dismissal: hide() +
#   onDismissed(true). Forwarding ≠ "no state change" — only
#   "no consumption". Never call onDismissed(false) from the key layer.
# GOTCHA — do NOT tick the visibility machine from the key layer
#   (existing comment at :1405-1408 explains: it could paint a pending
#   swap and clobber the highlight mid-navigation).
# GOTCHA — the tab-insert branch's painted-capture runs BEFORE
#   insertHighlighted (hide() clears painted()) — leave :1430-1460
#   byte-identical; comment sync there is NOT in scope (already current).
# GOTCHA — S1/S2 overlap: S1 may have landed minimal wiring. AUDIT, don't
#   blindly re-apply: verify each of (a)-(d) + interacted threading
#   against the live code; complete only what's missing. Never regress
#   S1's green suite.
# GOTCHA — forwardInput is the guard-chained forward (enter-submit guard
#   sees the press; it may still cancel a stock menu) — use it, never a
#   raw inner.handleInput call.
# GOTCHA — the visibility machine is NOT re-evaluated on pass-through
#   (hide() is direct state manipulation via the machine's seam-adjacent
#   state holder — same as escape/enter-submit today); follow precedent.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies, TDD)

```yaml
Task 0: PRECONDITION + AUDIT
  - Confirm S1 landed: decideWidgetKey v2 signature (interacted param),
    WidgetKeyDecision without boundary-esc/clamp, WidgetState.interacted.
    (npx vitest --run test/widget.test.ts -t decideWidgetKey → green.)
    AUDIT widgetHandleInput against S1's Task 4 list: interacted arg
    passed? clamp branch deleted? boundary branch reshaped? navigate
    modular? interacted set? Note what remains — that is S2's work.

Task 1: TDD — ADD failing wiring-level cases (test/widget.test.ts)
  - Via makeKeyHarness (multi-word show, then press):
      it("un-interacted ↑ at first word forwards verbatim, dismisses,
          and arms suppression")   // innerCalls gains the press data;
                                     state.hidden; suppressUntilWordStart
      it("pass-through press yields exactly ONE total input tick")
        // follow the harness's existing tick-counting pattern; the
        // widget-layer opts.onKeystroke must NOT fire for it
      it("interacted ↑ at first wraps to the LAST word (rendered count)")
      it("interacted → at last wraps to the FIRST word")
      it("every navigate marks the generation interacted (composed)")
      it("un-interacted → on a one-word line forwards; line stays; no
          suppress")
  - RUN → RED (missing/incorrect wiring).

Task 2: IMPLEMENT (a)-(b) in widgetHandleInput per "What"
  - Boundary-pass-through branch in the enter-submit shape, before the
    consumed-tick block.
  - Navigate: modular application + state.interacted = true.
  - Delete any leftover clamp arm / boundary-esc arm.

Task 3: VERIFY (c) — one-word forward
  - Harness case green via the existing :1382 forward path; fix only if
    it hides/suppresses/ticks wrongly.

Task 4: COMMENT SYNC (Mode A)
  - :57-73 header blurb; :1367; :1480; :331; :401 — rewrite to the v2
    model per "What (d)". grep -n "boundary-Esc\|boundary-esc\|clamp" in
    widget.ts → only historical/doc-context mentions that are accurate.

Task 5: FULL REGRESSION
  - npm run check
  - npx vitest --run test/widget.test.ts test/widget-visibility.test.ts
    test/editor-enter.test.ts
  - npm test
```

### Implementation Patterns & Key Details

```typescript
// Branch order inside widgetHandleInput (after the decision try/catch):
//   1. "forward"                      → return forwardInput(data)   (:1382)
//   2. "boundary-pass-through"        → dismiss + return forwardInput(data)  ← NEW, before tick block
//   3. "enter-submit"                 → dismiss + return forwardInput(data) (:1383-1399)
//   4. consumed-tick block            → opts.onKeystroke?.() (:1409)
//   5. navigate (modular + interacted) | escape | tab-insert (untouched)
//   6. return undefined               // consumed

// Wrap arithmetic sanity (3 items): i=0, delta=-(3-1)=-2 → ((0-2)%3+3)%3=1? 
//   ((-2 % 3) + 3) % 3 = (−2 + 3) % 3 = 1 — WRONG for wrap-to-last(2).
//   Prefer delta = +(count-1) for up-wrap or compute the target directly:
//   up/left at i===0 → n-1; down/right at i===n-1 → 0; else ±1 — mirror
//   however S1 encoded the wrap, but TEST the composed result (wrap-to-
//   LAST pinned in Task 1); the modular formula only works if S1 chose
//   delta ±(count−1) with matching sign. Verify against S1's decision
//   encoding FIRST and adapt the application to it.
```

### Integration Points

```yaml
NEXT TASK (P1.M1.T1.S3): the exhaustive spec/09 battery consumes this
  wiring — its observables are exactly this task's seams: innerCalls
  verbatim forwarding, suppressUntilWordStart arming, one tick per press,
  interacted lifecycle across generations.
NO CHANGES: decideWidgetKey body (S1), renderedCount, applyVisibility,
  insertHighlighted + chain arming (:1430-1460), visibility machine,
  config, README (P1.M2.T1 owns the sweep).
SPEC: already adopted (spec/07 h3.9 "code lands with this spec") — no
  spec edit needed in this changeset beyond what S1 recorded.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check
```

### Level 2: Unit Tests (TDD)

```bash
npx vitest --run test/widget.test.ts                        # wiring cases green
npx vitest --run test/widget.test.ts -t "pass-through" -v
npx vitest --run test/widget.test.ts -t wrap -v
npm test
```

### Level 3: Integration (composed stack + siblings)

```bash
npx vitest --run test/editor-enter.test.ts test/widget-visibility.test.ts test/chain.test.ts
# the guard-chain forward (pass-through rides it) and machine seams unchanged
```

### Level 4: Domain-Specific

Not applicable — live TTY verification is P1.M2.T1.S3 (binding). The
harness pins here are the scripted stand-in.

## Final Validation Checklist

- [ ] boundary-pass-through: enter-submit shape, returns before the tick block, no widget tick
- [ ] Forwarded press verbatim in innerCalls; suppression armed; ONE total tick
- [ ] Navigate modular (wrap lands on LAST/FIRST per S1's delta encoding — composed test pins it)
- [ ] state.interacted set on every navigate; never on pass-through/Tab/Enter/Escape
- [ ] One-word un-interacted →/↓ forwards with the line staying; verified no-op
- [ ] tab-insert/arming/escape/enter-submit byte-identical
- [ ] Comments rewritten (:57-73, :1367, :1480, :331, :401); no stale old-model prose
- [ ] S1 audit done — no regression of S1's decision-table pins
- [ ] `npm run check` + full `npm test` green; only widget.ts + widget.test.ts touched

## Anti-Patterns to Avoid

- ❌ Don't let pass-through reach the consumed-tick block (double tick)
- ❌ Don't keep/reintroduce clamp math (nulls wraps)
- ❌ Don't call inner.handleInput directly — forwardInput only (guard chain)
- ❌ Don't set interacted on pass-through/Tab/Enter/Escape
- ❌ Don't touch tab-insert, the visibility machine, decideWidgetKey, or README
- ❌ Don't blindly re-apply wiring S1 already landed — audit first
- ❌ Don't skip the wrap-sign verification against S1's delta encoding
      (modular math with the wrong sign lands one off — pin the composed
      wrap-to-LAST/FIRST result)
- ❌ Don't expand into S3's battery — branch observables only

---

**Confidence Score**: 9/10 — the current widgetHandleInput body was read
verbatim this session, the enter-submit template and tick-seam trap are
pinned with exact code, and S1's contract precisely bounds what exists at
S2 start (with an audit step for its possible minimal wiring). The one
open variable — S1's wrap-delta encoding — is handled by a composed-result
pin rather than an assumption.
