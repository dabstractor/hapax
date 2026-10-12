# VERDICT — P3.M1.T1.S2: Tab-deferral conformance audit

**Overall verdict: CONFORMANT — zero code changes, zero test changes.**

The already-shipped Tab-deferral implementation (P3.M1.T1.S1, commit `c66ba57`
"feat(pi): widget Tab defers to pi's open menu") satisfies all three promoted
PRD hunks exactly as written. Every audit dimension below is resolved by
reading the actual code and the actual `expect()` assertions (not test names).
Validation at audit time: `npm run check` clean; `npm test` green (40 files,
1286 passed / 1 pre-existing skip); the three subject suites
(`widget.test.ts`, `defer-pi-menu.repro.test.ts`, `editor-enter.test.ts`)
green individually (143 tests).

---

## Normative clauses audited (quoted; READ-ONLY — already landed)

**spec/07-completion-ui.md h3.10, final bullet (line ~242):**

> **Tab inserts the highlighted word** … stock `applyCompletion` semantics,
> reimplemented on the widget path because no provider item exists there —
> UNLESS the inner editor's own autocomplete menu is open
> (`isShowingAutocomplete`): the Tab forwards verbatim and pi's menu accepts
> its item; deferral keys on the menu's actual open state, never on context
> classification (the hesitation race can re-arm the widget line while pi's
> menu is open).

**spec/07-completion-ui.md h3.14 parenthetical (line ~552):**

> (FALLBACK PATH ONLY — on the widget path Tab is consumed by the editor
> proxy before this editor branch can run (except while pi's own menu is
> open, when the widget defers the Tab verbatim …), and no provider answers
> word fragments, so no stock menu can open for them; the bug class is
> structurally absent there.)

**spec/09-testing-and-acceptance.md h2.59 widget.test.ts bullet (line ~191):**

> Tab with pi's own menu open (`isShowingAutocomplete() === true`) forwards
> verbatim — never inserts a hapax word over an open stock menu
> (P3.M1.T1.S1)

---

## (a) Pre-check placement, order, verbatim forward — CONFORMANT

Clause: the pre-check fires on `decision.action === "tab-insert"`, reads the
menu's ACTUAL open state forward through the enter-submit proxy, sits before
every effectful branch, forwards verbatim through the guard, ticks the clock
exactly once, and degrades defensively.

| Property | Evidence |
|---|---|
| Veto fires only on `tab-insert` | `src/pi/widget.ts:1719` — `decision.action === "tab-insert" &&`. `tab-insert` is the pure table's verdict for a visible non-empty line (`decideWidgetKey`, widget.ts:1690; pinned pure at `test/widget.test.ts:1301+`). |
| Probe reads the menu's ACTUAL state through the proxy | `src/pi/widget.ts:1720-1722` — `(innerRecord.isShowingAutocomplete as (() => boolean) \| undefined)?.() === true`, where `innerRecord` is the enter-submit PROXY viewed as a record (`src/pi/widget.ts:1641`). The proxy's get trap binds member functions to the real inner (`src/pi/editor.ts:131-134`) — same precedent as the guard's own probe (`src/pi/editor.ts:112-115`). |
| Veto precedes EVERY effectful branch | The deferral `return forwardInput(data)` at `src/pi/widget.ts:1723` precedes: forward arm (1728), enter-submit dismissal (`state.hide()` + `machine.onDismissed(true)`, 1739-1741), boundary-pass-through dismissal (1757-1759), consumed-key tick (`opts.onKeystroke?.()`, 1771), navigate's `interacted` mutation (1789), escape's hide+suppress (1794-1795), and the tab-insert execution arm (`insertHighlighted`, 1817). Nothing is inserted, suppressed, dismissed, ticked, armed, or mutated before the deferral return. |
| `decideWidgetKey` (pure) running first is correct | The pure table reads no editor state and has no side effects (pinned pure at `test/widget.test.ts:1301+`); the PRD's "before any insert/suppress decision executes" governs effectful branches, which the veto does precede. Not a defect — see PRP gotcha. |
| Claim release cannot interfere | `src/pi/widget.ts:1684` — release fires only `if (isSubmitKey(data, keybindings))`; Tab is never the submit key (`src/pi/editor.ts:63-73`: keybindings match on `tui.input.submit`, fallback `data === "\r"`). |
| Verbatim forward through the guard, never the raw inner | `forwardInput` (`src/pi/widget.ts:1659-1660`) reads `innerRecord.handleInput` dynamically — the get trap returns the GUARD's handleInput (`src/pi/editor.ts:129`), which delegates the exact `data` to the real inner (`src/pi/editor.ts:117`). |
| Exactly ONE clock tick on a forwarded deferral | The guard ticks `onKeystroke` on every delegation (`src/pi/editor.ts:105`) BEFORE delegating; the widget layer's own consumed-key tick (`src/pi/widget.ts:1771`) is unreachable because the deferral returned at 1723. Pinned: `test/widget.test.ts:1167` — `expect(h.onKeystroke).toHaveBeenCalledTimes(1)` in the deferral test. |
| Defensive probe (missing/throwing falls through) | try/catch wraps the whole veto (`src/pi/widget.ts:1716-1726`); absent member → `?.()` → `undefined !== true` → fall-through; throw → caught → fall-through. Pinned: probe-absent case `test/widget.test.ts:1172-1184` (insert still lands: `calls === [setText, caret]`, `innerCalls === []`) and throwing-probe case `test/widget.test.ts:1186-1199` (no throw, insert lands, `hidden === true`). |

## (b) Keyed on actual open state, never classification; hesitation race — CONFORMANT

Clause: "deferral keys on the menu's actual open state, never on context
classification (the hesitation race can re-arm the widget line while pi's
menu is open)."

- The deferral predicate (`src/pi/widget.ts:1719-1722`) consults exactly one
  thing: the boolean return of `isShowingAutocomplete()`. No
  `classifyStockContext`, no prefix sniffing anywhere in the deferral block —
  `classifyStockContext` appears in widget.ts only at the import (line 140),
  a JSDoc (551), and the ARMING path (835-838), which is a different,
  sanctioned use (stock contexts never arm the line).
- Why classification keying is forbidden (spec 07 h3.10): the forced-file
  surface (`load the te`) and slash-argument surface (`/model te`) are
  contexts classification does NOT model, and the `menuDelayMs` hesitation
  race makes any static context guess stale mid-keystroke — the line can arm
  AFTER pi's menu is already open. Repro cases 1 and 2 exercise exactly those
  unclassified surfaces.
- Hesitation-race regression coverage: `test/defer-pi-menu.repro.test.ts`
  case 3 (lines 200-243), `menuDelayMs: 400` with `vi.useFakeTimers()`, the
  500 ms pause arming hapax OVER pi's open menu. It asserts BOTH preconditions
  of the accepting Tab before pressing it — `expect(showing).toBe(true)`
  (line 234) and `expect(state.hidden).toBe(false)` (line 235) — then the
  end-to-end accept `expect(pi.applied).toEqual(["templates/"])` (line 239).
  Suite green; not weakened (no assertion changed — the tree carries zero
  test edits).

## (c) 09 h2.59 bullet pinned in widget.test.ts key-handling coverage — CONFORMANT

Clause: "Tab with pi's own menu open (`isShowingAutocomplete() === true`)
forwards verbatim — never inserts a hapax word over an open stock menu."

Pin: `test/widget.test.ts:1144-1170`, inside the key-handling describe
"widget key handling — Tab inserts the highlighted word" (line 959). The
harness knob drives the METHOD's boolean return —
`raw.isShowingAutocomplete = (): boolean => true` (`test/widget.test.ts:903-905`)
— the probe contract, not a stubbed classification. The line is armed with a
real result set before the press (`h.show(["Zendesk", "zephyr"])`, line 1148),
so the veto is exercised with a live `tab-insert` decision.

Both claims are pinned by READ assertions (verified by reading the expects):

1. **"forwards verbatim"** — `expect(out).toBe("inner:\t")` (line 1159) and
   `expect(h.innerCalls).toEqual(["\t"])` (line 1160): the inner double's
   handleInput received the exact Tab bytes, exactly once.
2. **"never inserts a hapax word over an open stock menu"** —
   `expect(h.calls).toEqual(["inner:\t"])` (line 1161: NO `setText`, NO caret
   edit), `expect(h.state.hidden).toBe(false)` (1162: line stays visible),
   `expect(dismissedCalls).toBe(0)` (1163: dismissal seam never fired),
   `expect(...suppressUntilWordStart).toBe(false)` (1164: no suppression),
   `expect(h.state.interacted).toBe(false)` (1165), and one tick (1167).
   The armed candidates ("Zendesk") demonstrably did NOT land — the buffer is
   never written.

Division of labor (itself part of the verdict): the double-level test pins
the deferral STATE (forward, no edit, visible, unsuppressed); "pi's menu
accepts its item" is only observable against the REAL pi-tui Editor and is
pinned end-to-end by the repro suite (`pi.applied` in all 4 cases). Both
halves are present; nothing to add. Placement, naming, and knob usage follow
the existing harness style — no edit required.

## (d) Contrast case and Enter-submits guard green and untouched — CONFORMANT

- **Contrast case (classification-keyed defer):**
  `test/defer-pi-menu.repro.test.ts` case 4 (lines 245-256): pure slash
  typing `/mo` (no space) → `expect(text.startsWith("/mo")).toBe(true)` —
  hapax never inserts over the slash. Mechanism is genuinely different from
  (b): the widget line never ARMS in classified stock contexts
  (`classifyStockContext(...) !== null` → no paint, `src/pi/widget.ts:835-838`),
  so there is no `tab-insert` decision to defer. Green.
- **editor.ts untouched by the deferral:** the S1 commit's diff surface
  (`git show --stat c66ba57`) touches only `src/pi/widget.ts` (+27),
  `test/defer-pi-menu.repro.test.ts`, `test/widget.test.ts`, the two spec
  files, and plan artifacts — `src/pi/editor.ts` is absent; the current tree
  carries zero `src/`/`test/` modifications. The guard's own
  `isShowingAutocomplete` read (`src/pi/editor.ts:112-115`) is the sibling
  probe precedent, not deferral logic. `test/editor-enter.test.ts` green
  (cancel-then-delegate, never-mutate, proxy forwarding, thenable guard,
  onKeystroke hook all pass).

## (h3.14) Prose check — CONFORMANT (no change expected; none made)

Clause: "on the widget path Tab is consumed by the editor proxy before this
editor branch can run (except while pi's own menu is open, when the widget
defers the Tab verbatim …)".

- A consumed tab-insert RETURNS without delegating: the tab-insert execution
  arm's ONLY forward is the span-miss fallback
  (`if (!consumed) return forwardInput(data)`, `src/pi/widget.ts:1824`) — on
  a consumed insert (`consumed === true`) no `forwardInput` call executes, so
  pi-tui's `editor.js` Tab branch (`handleTabCompletion` → forced-file menu)
  is unreachable for every insert hapax actually performs.
- The deferral arm (`src/pi/widget.ts:1723`) is the sole Tab-forwarding
  exception while pi's menu is open — and the span-miss forward (1824) is not
  a counterexample: it forwards only when hapax consumed NOTHING, so "Tab is
  consumed" still holds for every insertion. The parenthetical describes
  reality.

---

## Changes made

**None.** Zero edits to `src/`, `test/`, or `spec/`. The audit found no
mismatch: S1's shipped implementation and test pins already satisfy the
promoted normative text verbatim. ("No diff" is this task's fully valid
success outcome.)

## Notes for Mode B (downstream consumers)

- **For T2.S2 (gauntlet):** full suite green at audit time — 40 test files,
  1286 passed / 1 pre-existing skip; `npm run check` (tsc --noEmit) clean.
  Safe to treat "green with repro included" as the baseline.
- **For T2.S3 (live smoke):** the hesitation-race variant is backed by
  `test/defer-pi-menu.repro.test.ts` case 3 (`menuDelayMs 400`, fake timers,
  line arms over pi's open menu, accepting Tab still reaches pi —
  `pi.applied === ["templates/"]`). A live variant should reproduce: type
  `load the te`, pause ≥ `menuDelayMs` (400 ms) so the hapax line arms over
  pi's Tab-forced menu, then Tab — pi's item must be accepted, no hapax word
  inserted.
- **For T2.S4 (DoD drift report):** code matches the normative spec text at
  07 h3.10 (final bullet) and 07 h3.14 (parenthetical); the 09 h2.59 test
  bullet is pinned by assertions in `test/widget.test.ts:1144-1170`
  (key-handling describe at line 959), with the end-to-end accept in the
  repro suite. **No drift.**
- Known cosmetic note (NOT drift, per the PRP's fix-forward rule): the
  deferral JSDoc (`src/pi/widget.ts:1702`) cites "spec 07 h2.46 + h2.51" —
  coarse-but-not-false anchors written before the h3.10/h3.14 hunks landed.
  Left untouched because no code edit landed in that block.
- Invariant framing (spec/SPEC.md): the deferral is an exception surface
  INSIDE the sanctioned Tab capture — the never-hijack invariant and
  Tab-only-completes are preserved (an open pi menu makes the Tab genuinely
  pi's keystroke; the forward is verbatim and singular).
