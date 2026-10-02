# Research notes — P1.M1.T1.S2 (plan 005): widgetHandleInput v2 wiring

## Sources examined
- src/pi/widget.ts widgetHandleInput (:1365–1493, read verbatim at HEAD):
  - decision call site (:1372–1377): `decideWidgetKey(data, !state.hidden,
    renderedCount(), state.highlightIndex, keybindings)` — 5 args, NO
    interacted yet (S1's minimal wiring may have added it; verify).
  - enter-submit branch (:1383–1399): THE pass-through template —
    try { state.hide(); machine.onDismissed(true); } catch {} then
    `return forwardInput(data)` BEFORE the consumed-tick block.
  - consumed-tick block (:1400–1413): opts.onKeystroke?.() at :1409,
    try/catch — consumed keys only; visibility machine deliberately NOT
    ticked (comment explains why).
  - navigate (:1414–1420): clamp math Math.max(0, Math.min(i+delta,
    renderedCount()-1)) — NULLS wrap deltas.
  - escape∥boundary-esc (:1421–1429): hide + onDismissed(true), consumed.
  - tab-insert (:1430–1460): painted-capture pre-call, insertHighlighted,
    chain arming at rec.key + chainGrant.reset() — UNCHANGED by S2.
  - tail comment :1480 "clamp: consumed, no movement".
  - header-ish comment :1367 "caret must not move on boundary-Esc/clamp".
- S1 PRP contract: decideWidgetKey v2 signature (data, visible, count,
  highlightIndex, interacted, keybindings?); WidgetKeyDecision v2 union
  (navigate / boundary-pass-through / escape / tab-insert / enter-submit /
  forward; clamp + boundary-esc DELETED); WidgetState.interacted reset in
  set() and hide(). S1 MAY have landed "minimal wiring compile-parity"
  (its Task 4: pass interacted, delete clamp branch, reshape boundary
  branch, modular navigate, set interacted) — S2 must VERIFY which landed
  and complete/polish whatever remains; the item contract assigns the FULL
  wiring semantics to S2.
- system_context.md sections cited by the item: 'widgetHandleInput branch
  map', 'Tick seams' (guard delegation seam ticks once —
  createEnterSubmitEditor :1302–1317; widget layer ticks consumed keys at
  :1409; NEVER both → double-tick corrupts hesitation timing),
  'Suppression seam' (machine.onDismissed(true) arms
  suppressUntilWordStart).
- Comments to rewrite (Mode A): header model blurb :57–73, :1367, :1480,
  :331 (VisibilityState.suppressUntilWordStart doc mentions boundary-Esc),
  :401 (onDismissed doc).
- Test seam: makeKeyHarness (:~427–466): press() → editor.handleInput,
  show() → state.set() directly, innerCalls log, machine state readable.
  Observable seams for S3's battery: innerCalls receives forwarded data
  verbatim; getState().suppressUntilWordStart arms on pass-through;
  opts.onKeystroke exactly once per press.

## Key decisions
- Boundary-pass-through branch: exact enter-submit shape, placed before
  the consumed-tick block, returns forwardInput(data) — NOT consumed,
  NO widget tick (guard seam ticks on delegation).
- Navigate: modular application (((i + delta) % n + n) % n, n =
  renderedCount()); state.interacted = true on EVERY navigate decision
  (covers the row-8 defensive corner); exactly one tick via :1409.
- Row-3 forward (un-interacted →/↓ one-word): existing :1382 forward path
  suffices — verify no hide/suppress/tick; line stays visible.
- tab-insert (incl. arming :1457–1460 + chainGrant.reset), escape,
  enter-submit, plain forward: unchanged.
- If S1 already landed minimal wiring: S2 audits each branch against the
  contract (tick ordering, modular math, interacted set, comment sync) and
  finishes comment/doc sync only. Do not regress S1's suite-green state.
