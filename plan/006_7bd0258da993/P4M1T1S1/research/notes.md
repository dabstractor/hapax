# P3.M1.T1.S1 research notes — Tab defers to pi's open menu

## Verified red state (live run, 05:20)

`npx vitest run test/defer-pi-menu.repro.test.ts` → **3 failed | 1 passed (4)**.
All three failures: `AssertionError: expected [] to deeply equal [ 'templates/' ]`
at `expect(pi.applied).toEqual(["templates/"])` — the accepting Tab never reaches
pi's `applyCompletion`; the widget layer consumes it.

- Case 1 (forced file menu, Tab on plain word "te"): RED
- Case 2 (argument completion '/model te'): RED
- Case 3 (fake timers, menuDelayMs 400, race/re-arm): RED
- Case 4 (pure slash '/mo' contrast): PASS (classified stock context — keep green)

Full-suite baseline caveat (from architecture/04 §2, observed 02:18):
`test/acceptance.test.ts` "pi -p loads the real extension" (network-gated) can
fail environmentally with exit 1 + unrecognized stderr → skip-guard rethrow.
NOT caused by this change; belongs to the P3.M1.T2.S2 gauntlet.

## Insertion-point anatomy (verified line anchors, HEAD dbafbfc)

- `src/pi/editor.ts:111-115` — precedent guard in `createEnterSubmitEditor`:
  `(innerAny.isShowingAutocomplete as (() => boolean) | undefined)?.() === true`
  (+ `autocompletePrefix` slash check) → `cancelAutocomplete()`. Fully defensive.
- `src/pi/widget.ts:1534` — `const inner = createEnterSubmitEditor(opts.inner(...), keybindings, tick)`:
  the widget's `innerRecord` IS the enter-submit proxy; property reads forward
  through its get trap to the REAL editor. `isShowingAutocomplete` is reachable
  from the wiring exactly as editor.ts does it.
- `src/pi/widget.ts:1579` — `const forwardInput = ...`: dynamic read of the
  guard's `handleInput` (never the raw inner). Forwarding = exactly ONE clock
  tick via the guard's seam.
- `src/pi/widget.ts:1595` — `widgetHandleInput` start; `:1610` the
  `decideWidgetKey(...)` call inside try/catch; `:1621` forward branch;
  `:1691` the `else if (decision.action === "tab-insert")` branch.
- `src/pi/widget.ts:1197` — `decideWidgetKey(data, visible, count,
  highlightIndex, interacted, keybindings?)`: PURE decision table (purity
  documented in the block at ~1180–1195). MUST STAY PURE — editor-state checks
  belong in the wiring (enter-submit seam is the precedent; architecture/03 §R4
  "Recommended: option 2").

Recommended check (fires only on the decision the wiring was about to consume):

```ts
try {
  if (
    decision.action === "tab-insert" &&
    (innerRecord.isShowingAutocomplete as (() => boolean) | undefined)?.() === true
  ) {
    return forwardInput(data);
  }
} catch { /* deferral hiccup → normal tab-insert path (inert, never breaks input) */ }
```

Placed immediately after the decision try/catch (before the `forward` branch at
:1621) — i.e., after decideWidgetKey, BEFORE any insert/suppress/tick/arming
executes. Returning via `forwardInput` before the consumed-tick block avoids a
double clock tick and leaves `state.interacted`/claim/suppression untouched.

## Why static classification cannot work (case 3's proof)

`classifyStockContext` (widget.ts :823 consumer) does not model (a) Tab-forced
file completion on a plain token (extractPathPrefix force branch) or (b)
slash-command ARGUMENT completion after a space. And the hesitation race
(menuDelayMs 400) lets the hapax line RE-ARM during the user's pause while pi's
forced menu is open. Only the menu's ACTUAL open state (`isShowingAutocomplete`)
is a sound key.

## Test-file facts

- `test/defer-pi-menu.repro.test.ts` (207 lines): header line 1 says
  "INVESTIGATION REPRO (not a regression suite yet)"; harness = REAL pi-tui
  `Editor` + pi-provider double + `createWidgetEditorFactory` composition;
  `console.log` scaffolding in all 4 cases each preceded by an inert
  `// eslint-disable-next-line no-console` (no eslint config exists in repo).
- `test/widget.test.ts` (~2068 lines): `makeInsertHarness` at :843 builds the
  editor double (`raw` record: handleInput/getLines/getCursor/setText/
  setCursorCol/render) behind a never-mutate pin Proxy. The double has NO
  `isShowingAutocomplete` member → optional chaining reads undefined → new
  check inert for every existing test (backwards compatible). Extend via a
  seed flag (`piMenuOpen`) adding `raw.isShowingAutocomplete = () => true`.
- Spec numbering: spec files use unnumbered headings; the codebase's own
  comments cite PRD h-numbers ("spec §07 h3.9" appears in widget.ts), so
  "spec 07 h2.46/h2.51" anchors are consistent with existing convention.
  spec/07 Tab bullet = line 222; spec/07 h3.13 parenthetical ("structurally
  absent") is falsified in the narrow accept-stealing sense by this repro.

## Repo state / neighbors

- HEAD dbafbfc; P2.M1.T2.S1/S2 (session_tree handler + branch-purity battery)
  in flight in parallel — test-only + index.ts wiring; no overlap with
  widgetHandleInput.
- No eslint/prettier; validation = `npm run check` (tsc --noEmit) + `npm test`
  (vitest --run). No new imports needed in widget.ts (no matchesKey addition —
  key on `decision.action`, keeping decideWidgetKey the single classifier).
