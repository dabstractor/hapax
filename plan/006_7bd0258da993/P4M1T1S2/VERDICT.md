# VERDICT — P3.M1.T1.S2: Tab-deferral conformance audit (07 h3.10/h3.14 + 09 h2.59)

**Overall verdict: CONFORMANT — zero code changes required.**

The shipped Tab-deferral (commit `c66ba57` "feat(pi): widget Tab defers to pi's open
menu") satisfies every audited PRD clause as they now read in the promoted normative
text. No behavioral gap was found; per the fix-forward protocol, no source file was
edited. All evidence below was re-verified by reading the live code and assertions in
this session (not inherited from S1's notes).

**Framing.** The deferral is an exception surface inside the sanctioned Tab capture:
SPEC.md invariant 1 ("Never hijack typing. No key is ever captured, consumed, or
altered except…") and invariant 2's Tab-only completion rule are what make pi's open
menu the Tab's rightful owner whenever the probe reports it open. The audit confirms
the shipped code implements exactly that exception and nothing broader.

**Normative targets audited against (read-only):**

- `spec/07-completion-ui.md:240-244` — h3.10 final bullet: "…UNLESS the inner editor's
  own autocomplete menu is open (`isShowingAutocomplete`): the Tab forwards verbatim
  and pi's menu accepts its item; deferral keys on the menu's actual open state, never
  on context classification (the hesitation race can re-arm the widget line while pi's
  menu is open)."
- `spec/09-testing-and-acceptance.md:189-192` — h2.59 widget key-handling bullet:
  "Tab with pi's own menu open (`isShowingAutocomplete() === true`) forwards verbatim —
  never inserts a hapax word over an open stock menu (P3.M1.T1.S1)."
- `spec/07-completion-ui.md:552-556` — h3.14 parenthetical: "(FALLBACK PATH ONLY — on
  the widget path Tab is consumed by the editor proxy before this editor branch can run
  (except while pi's own menu is open, when the widget defers the Tab verbatim …)".

---

## (a) Pre-check placement, order, and verbatim forward — CONFORMANT

Control-flow walk of `widgetHandleInput` (`src/pi/widget.ts:1683-1730`):

1. **Claim-release cannot interfere** (`widget.ts:1684-1693`): it fires only under
   `isSubmitKey(data, keybindings)`; Tab is never a submit key, so no state mutation
   precedes the deferral on a Tab keystroke.
2. **Pure table first, by design** (`widget.ts:1695-1701`): `decideWidgetKey` is
   side-effect-free (no editor state read — pinned pure at
   `test/widget.test.ts:1301+`); its hiccup degrades to a plain forward
   (`:1699-1700`). The PRD's "before any insert/suppress decision executes" governs
   EFFECTFUL branches, and the veto precedes every one of them: the deferral return
   (`:1723`) sits before the generic forward arm (`:1731`), the enter-submit
   dismiss-then-forward arm (`:1732ff`), the boundary/pass-through arms, the
   consumed-key tick block, and the tab-insert arm — so on a deferred Tab there is no
   insert, no suppression, no dismissal, no clock tick from the widget layer, no
   arming, and no state mutation.
3. **Verbatim forward through the guard** (`widget.ts:1641,1659-1660`):
   `forwardInput(data)` calls `innerRecord.handleInput(data)` — `innerRecord` is the
   editor read FORWARD THROUGH the enter-submit proxy (`:1636-1639` comment; proxy get
   trap binds `handleInput` to the guard, `src/pi/editor.ts:124-131`), so the exact
   input bytes reach pi's editor via the guard and pi's menu accepts its highlighted
   item.
4. **Exactly one clock tick on a forwarded deferral**: the widget's consumed-key tick
   block is never reached (early `return` at `:1723`); the single tick comes from the
   guard's `onKeystroke` seam, which fires once per delegated keypress
   (`src/pi/editor.ts:108-112`). Pinned by
   `expect(h.onKeystroke).toHaveBeenCalledTimes(1)` in the deferral pin test
   (`test/widget.test.ts:1170`).
5. **Defensive posture** (`widget.ts:1726-1729`): a missing member
   (`innerRecord.isShowingAutocomplete` undefined → `?.()` yields undefined ≠ true)
   or a throwing probe lands in the catch and falls through to the normal tab-insert
   path. Pinned by two dedicated cases: probe-absent inert
   (`test/widget.test.ts:1174-1188` — insert still lands, `innerCalls === []`) and
   throwing probe falls through (`test/widget.test.ts:1190-1206` — insert lands,
   full acceptance "as if the probe never existed").

**Gating**: the veto fires only for `decision.action === "tab-insert"` — the pure
table's verdict for a visible, non-empty line (`widget.ts:1307`; hidden/empty lines
classify `"forward"` at `widget.ts:1277` and reach pi as literal Tabs regardless, where
no hapax insert is possible).

## (b) Keyed on actual open state, never classification; hesitation race — CONFORMANT

- The predicate (`widget.ts:1719-1724`) reads exactly one thing: the boolean result of
  `(innerRecord.isShowingAutocomplete as (() => boolean) | undefined)?.() === true`,
  AND-gated with the pure decision's `tab-insert`. No `classifyStockContext`, no
  prefix sniffing, no context classification anywhere in the deferral block.
- WHY classification keying is forbidden (spec 07 h3.10, `spec/07-completion-ui.md:242-244`):
  the forced-file and slash-argument surfaces are exactly the contexts classification
  does NOT model, and the `menuDelayMs` hesitation race can re-arm the widget line
  while pi's menu is already open — any static context guess is stale mid-keystroke.
- The race is regression-pinned by `test/defer-pi-menu.repro.test.ts` case 3
  (`:200-243`): under fake timers with `menuDelayMs: 400`, the arm lands only after
  the 500 ms pause with pi's menu already open, and BOTH preconditions of the
  accepting Tab are asserted before it — `expect(showing).toBe(true)` AND
  `expect(state.hidden).toBe(false)` (`:229-233`) — after which the Tab forwards and
  `expect(pi.applied).toEqual(["templates/"])` (`:239`). The suite runs green and was
  not modified in this audit (no weakening).

## (c) 09 h2.59 bullet pinned in test/widget.test.ts key-handling coverage — CONFORMANT

The pin lives in the key-handling describe "widget key handling — Tab inserts the
highlighted word (spec §07 h2.46 rule 0, S2)" as the case at
`test/widget.test.ts:1143-1172`, driven through the harness opt-in knob `piMenuOpen`
(`makeInsertHarness`, `test/widget.test.ts:872-885` — the knob drives the METHOD's
boolean return on the double, not a stubbed classification). Both bullet claims are
pinned by explicit assertions, verified by reading (not the test name):

- **"forwards verbatim"**: `expect(out).toBe("inner:\t")` (`:1159`) and
  `expect(h.innerCalls).toEqual(["\t"])` (`:1160`) — the inner receives the Tab bytes
  exactly once.
- **"never inserts a hapax word over an open stock menu"**:
  `expect(h.calls).toEqual(['inner:"\\t"'])` (`:1161`) — the full interaction log is
  exactly one delegation, i.e. NO `setText`, NO caret edit; `h.state.hidden === false`
  (`:1163`, line stays visible); `dismissedCalls === 0` (`:1164`, machine dismissal
  seam never fired); `suppressUntilWordStart === false` (`:1165`); plus
  `interacted === false` (`:1166`) and the single-tick assertion (`:1170`).
- The fixture asserts the interesting posture explicitly: hapax line armed
  (`h.show([...])`) AND pi's menu open simultaneously — deferral keys on the MENU, not
  the line (`:1150` comment).
- **Division of labor** (part of this verdict): the double pins the deferral STATE;
  the real-Editor repro suite pins the END-TO-END accept
  (`test/defer-pi-menu.repro.test.ts:157-197`, `pi.applied` assertions — "pi's menu
  accepts its item" is only observable against the real pi-tui Editor). Both halves
  are green.

No gap found → no additional assertions required.

## (d) Contrast case and Enter-submits guard green and untouched — CONFORMANT

- **Contrast case** (classification-deferred pure slash typing, a different mechanism
  from (b)): repro case 4 `test/defer-pi-menu.repro.test.ts:245-256` — `/mo` + Tab
  leaves the text starting `/mo` (hapax never inserts over the slash); green.
- **Enter-submits guard** (`src/pi/editor.ts`) untouched by the deferral work: the
  deferral commit `c66ba57`'s diff surface is `src/pi/widget.ts` (+ tests + the spec
  hunks) only; `editor.ts`'s own `isShowingAutocomplete` read (`:110-115`) is the
  pre-existing submit-menu cancel use inside the guard (last touched by `b40bd8e`,
  which predates the deferral). Its suite `test/editor-enter.test.ts` is green
  (28/28) with no deleted or relaxed assertions.

## (h3.14) Prose check — CONFORMANT

`spec/07-completion-ui.md:552-556` describes reality:

- A consumed tab-insert RETURNS without delegating: the tab-insert arm runs
  `insertHighlighted` and, on success, returns the consumed result — pi-tui's
  `editor.js` Tab branch is unreachable on the widget path. The only in-arm forward is
  the span-miss/no-span degrade (`widget.ts:1824`) — cases where no hapax insert
  occurs at all.
- The deferral arm (`widget.ts:1719-1730`) is the sole exception that forwards a Tab
  while pi's own menu is open over an ARMED widget line. (When the hapax line is
  hidden/empty, `decideWidgetKey` classifies `"forward"` — `widget.ts:1277` — and the
  literal Tab forwards as plain never-hijack pass-through; nothing is consumed, so the
  parenthetical's failure mode, inserting a hapax word over an open stock menu, cannot
  arise there.)

---

## Changes made

**None.** The audit found full conformance; per the fix-forward protocol, zero source
edits, zero comment/JSDoc churn, zero spec edits. `git status` after the audit shows
only this VERDICT.md as the run's new artifact.

## Notes for Mode B

- **P3.M1.T2.S2 (gauntlet)**: full suite is green with the repro suite included —
  targeted counts this session: `test/widget.test.ts` 111, `test/defer-pi-menu.repro.test.ts`
  4, `test/editor-enter.test.ts` 28; `npm run check` and `npm test` re-verified green
  at audit time.
- **P3.M1.T2.S3 (live smoke)**: the hesitation-race variant of the deferral smoke is
  backed by repro case 3 (`test/defer-pi-menu.repro.test.ts:200-243`, menuDelayMs 400
  under fake timers, both preconditions asserted) — the live variant should reproduce
  that sequence in a real TTY: arm hapax over pi's open menu, then Tab → pi accepts,
  no hapax insert.
- **P3.M1.T2.S4 (DoD drift report)**: deliberate citation drift remains and is NOT a
  mismatch (per this item's docs contract, comments are touched only by code edits):
  the deferral JSDoc cites "spec 07 h2.46 + h2.51" (`src/pi/widget.ts:1702`) and the
  repro header cites h2.46/h2.51 (`test/defer-pi-menu.repro.test.ts:4`), both written
  before the normative hunks landed. The normative anchors are 07 h3.10
  (`spec/07-completion-ui.md:240-244`), 07 h3.14 (`:552-556`), and 09 h2.59
  (`spec/09-testing-and-acceptance.md:189-192`). The code satisfies the NEW wording
  as audited above; only the comment anchors are coarser.
