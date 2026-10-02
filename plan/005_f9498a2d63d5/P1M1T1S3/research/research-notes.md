# Research — P1.M1.T1.S3 (plan 005): widget.test.ts battery rewrite to the v2 model

## Verified file map (test/widget.test.ts at HEAD)

- Header model blurb: lines 3–33 (old-model prose specifically ~16–20:
  "consumes ←/→/↑/↓ … ↑/← on the FIRST word (boundary-Esc: consumed +
  hidden + suppressed), →/↓ on the LAST word (clamp: consumed, no
  movement)").
- makeKeyHarness (~:427–466): recording inner (innerCalls, handleInput
  returns `inner:${data}`, getLines ["hello"], getCursor fixed {0,0}),
  never-mutate Proxy set-trap + setHits(), onKeystroke vi.fn, composed
  via createWidgetEditorFactory with the REAL visibility machine +
  emptyStore stub (prefixRange [0,0] ⇒ forwarded keys close the line
  WITHOUT suppressing — the disqualification shape), press() →
  editor.handleInput, show(displays) → state.set() directly (bypasses
  machine paint — irrelevant here; key battery doesn't need paint).
  state widened structurally with `hidden`; machine via
  widgetMachineOf. Suppression asserted via
  `machine.getState().suppressUntilWordStart`.
- Key constants UP/DOWN/RIGHT/LEFT/ESC defined ~:415–420
  (`\x1b[A`/`\x1b[B`/`\x1b[C`/`\x1b[D`/`\x1b`).
- OLD-MODEL BLOCKS TO REWRITE:
  - navigation/width-truncation describe (~:470): 3 its — two-way
    walk; width-16 → 2 rendered, expects CLAMP at index 1.
  - boundary-Esc describe (:526): "press CONSUMED (no inner call —
    caret unmoved)" + single-item it (:542: down → clamp).
  - clamp describe (:558): consumed-at-last pins.
  - input-clock describe (~:631): counts clamp press as consumed tick.
  - full-scenario never-mutate describe (:967): scenario mixes clamp +
    boundary-Esc steps — KEEP the setHits()===0 pin, update steps.
  - pure decision-table describe (:986–1057): 4-arg decideWidgetKey
    calls, boundary-esc/clamp expectations.
- KEEP UNTOUCHED: suppression-taxonomy describe (Escape + non-explicit
  close — v2-valid as-is), forward-verbatim describe (hidden/empty
  cases still true), Tab/Enter/insert blocks (makeInsertHarness etc.),
  the chain-arming classification matrix at the file tail (BUG-001
  pin; its contract comment explicitly warns NOT to drive arming via
  show()), rendering describes.
- IMPORTANT W1 detail: a FORWARDED key's machine tick is deferred to a
  microtask — `await Promise.resolve()` before asserting machine state
  after a forwarded press (existing pattern in the suppression-taxonomy
  describe ~:590 and span-miss tests).
- Line ~:955-965 (tick test for Tab/Enter): "consumed insert → the
  widget layer's single tick; forwarded Enter → guard's seam, once" —
  v2-valid shape; (h) reuses it.

## S1/S2 contracts consumed (their PRPs, treated as landed)

- S1: `WidgetState.interacted: boolean` (public interface; init false;
  reset in set() AND hide()); `decideWidgetKey(data, visible, count,
  highlightIndex, interacted, keybindings?)`; decision union: navigate
  {delta}, boundary-pass-through, escape, tab-insert, enter-submit,
  forward — boundary-esc/clamp GONE; wrap represented as delta
  ±(count−1) applied MODULARLY by the wiring.
- S2: wiring — boundary-pass-through branch = enter-submit shape
  (state.hide() + machine.onDismissed(true) + return forwardInput(data)
  BEFORE the consumed-tick block ⇒ exactly ONE total tick via the
  guard's delegation seam); navigate applies
  `((i + delta) % n + n) % n` and sets `state.interacted = true`; row-3
  un-interacted →/↓ on one-word line forwards with the line STAYING
  visible (no hide/suppress, no flag); Tab/Enter/escape unchanged; the
  never-mutate pin holds across all of it.

## v2 expected observable matrix (what each press must show)

| state | key | highlight | hidden | suppress | innerCalls | ticks(total) |
|---|---|---|---|---|---|---|
| un-interacted, i=0, multi | ↑/← | 0 | true | true | [key] | 1 |
| un-interacted, 1 word | →/↓ | 0 | false | false | [key] | 1 |
| un-interacted, multi | →/↓ | +1, flag set | false | false | [] | 1 |
| interacted, i=0 | ↑/← | count−1 | false | false | [] | 1 |
| interacted, i=count−1 | →/↓ | 0 | false | false | [] | 1 |
| interacted interior | arrows | ±1 | false | false | [] | 1 |
| any visible | ESC | — | true | true | [] | 1 |
| fresh set() | any | reset 0, flag false | — | — | — | — |

Width truncation (renderedCount < items): 3 items @ width 16 → 2
rendered; first → lands index 1 (renders end) + flag; next → wraps to
0 (modular over RENDERED count n=2).

## Spec anchors

- spec/07 h3.9 (v2 model, authoritative text — in selected PRD).
- spec/09 widget bullets (h2.55, "widget.test.ts (primary path, M3)"
  key-handling bullet): the battery the contract quotes as
  spec/09:134–159.
- spec/02 h2.2 invariant 1: one-press plain-pi parity.
- Suite counts feed P1.M2.T1.S2 (gauntlet) — record passing test count
  for the changeset in the final report (not in the file).
