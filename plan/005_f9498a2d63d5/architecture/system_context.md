# Widget arrow interaction model v2 — code map (verified at HEAD 23fd764)

Two read-only scout runs mapped the seams the delta builds on. Spec is already
at v2 (`interacted` appears ONLY in spec/07:69–97 and spec/09:139–155 — zero
hits in src/ or test/); code + tests still implement boundary-Esc/clamp.

## Where the old model lives (src/pi/widget.ts, 1524 lines)

- `WidgetKeyDecision` — **:976–983**. Variants: `navigate {delta:-1|1}`,
  `boundary-esc`, `clamp`, `escape`, `tab-insert`, `enter-submit`, `forward`.
- `decideWidgetKey` — **:999–1018**. PURE: params
  `(data, visible, count, highlightIndex, keybindings?)`, no editor access.
  Clamps stale index at **:1007** (doc :994–998), then: up/left `i===0` →
  `boundary-esc` else navigate −1; down/right `i===count−1` → `clamp` else
  navigate +1; escape → `escape`; tab → `tab-insert`; `isSubmitKey` →
  `enter-submit`; else `forward`.
- `widgetHandleInput` — **:1365–1493**. Branch map:
  | branch | lines | hide() | onDismissed | widget tick (:1409) | return |
  |---|---|---|---|---|---|
  | decide error | 1378–1380 | no | no | no | `forwardInput(data)` |
  | forward | 1382 | no | no | no (guard seam ticks) | `forwardInput(data)` |
  | enter-submit | 1383–1399 | yes (:1393) | `(true)` (:1394) | no | `forwardInput(data)` (:1398) |
  | *consumed-tick block* | 1400–1413 | — | — | **yes, once, ALL consumed** | — |
  | navigate | 1414–1420 | no | no | (ticked) | `undefined` (:1492) |
  | escape ∥ boundary-esc | 1421–1429 | yes (:1426) | `(true)` (:1427) | (ticked) | `undefined` |
  | tab-insert | 1430–1460 | via insert | via insert | (ticked) | `undefined` / forward on span-miss (:1455) |
  | clamp | 1480–1481 | no | no | (ticked) | `undefined` (fall-through) |
- Old-model prose to rewrite: header blurb **:57–73**; **:1367** ("caret must
  not move on boundary-Esc/clamp"); **:1480** ("clamp: consumed, no
  movement"); boundary-Esc mentions in docs at **:331**
  (VisibilityState.suppressUntilWordStart) and **:401** (onDismissed).

## Generation state home

- `WidgetState` **:278–286** (set/hide/highlightIndex); `WidgetStateInternal`
  **:289–292** (adds `items`, `hidden`); `createWidgetState` **:297–315**.
- `set()` **:302–306**: copies items, `highlightIndex = 0` (**:304**, "spec
  h3.8"), `hidden = false`. `hide()` **:307–310**: `hidden = true; items = []`.
  There is NO separate `show()` — showing IS `set()`.
- Generation boundary mechanics: `applyVisibility` **:1286–1300**
  signature-compares (`pushedSig` :1286–1287) — a genuinely-new result set
  fires `set()` → highlight reset; same-set repaints do NOT. So resetting
  `interacted = false` inside `set()` gives exactly "new result set ⇒ fresh
  generation, pass-through re-armed"; reset defensively in `hide()` too
  (re-shown line = new paint). Expose `interacted` on `WidgetState` so the
  test harness can read/drive it (`widgetStateOf` :318–321).
- `renderedCount()` **:1346–1350** (`lastWidth` undefined → items.length else
  `fitItems`). Highlight clamps: render :267, decision :1007, insert
  :1094/:1132, navigate :1415–1420, tab :1443.

## CRITICAL pitfall — wrap vs the navigate clamp

The existing navigate wiring (:1415–1420) CLAMPS into `[0, renderedCount−1]`.
A wrap expressed as `delta = ±(count−1)` would be clamped straight back to
the edge (no movement). Either the wiring computes a modular index for
interacted wrap (`((i+delta) % count + count) % count`), or the decision
carries an absolute target — PRD allows either, but it must land exactly on
first/last of the RENDERED count.

## Tick seams (never double-tick)

- Consumed keys: widget layer ticks `opts.onKeystroke` exactly once at
  **:1409** (comment :1400–1408 "Exactly ONE clock tick per keypress,
  consumed or forwarded").
- Forwarded keys: guard seam `createEnterSubmitEditor(..., tick)`
  **:1312–1317**; `tick` **:1302–1308** calls `opts.onKeystroke()`
  synchronously, then microtask-defers `applyVisibility(machine.onInput())` +
  `requestRender()`.
- `boundary-pass-through` forwards ⇒ must `return forwardInput(data)` BEFORE
  the consumed-tick block — exact shape of enter-submit (:1383–1399).
  Observable: `onKeystroke` called exactly once TOTAL per press.

## Suppression seam

`machine.onDismissed(true)` = explicit dismissal → suppression until next
word start (`VisibilityState.suppressUntilWordStart`; set ONLY via the
machine seam). Tests read `machine.getState().suppressUntilWordStart`.
A pass-through press IS an explicit dismissal (suppress arms).

## Test harness (test/widget.test.ts, 1661 lines)

- `makeKeyHarness` **:~427–466**: recording inner fake (`innerCalls` log,
  `handleInput` → `inner:${data}`), never-mutate Proxy set-trap
  (`setHits()`), `onKeystroke = vi.fn()`, `press()` → `editor.handleInput`,
  `show(displays)` → `state.set()` DIRECTLY (does not populate
  `machine.painted()`).
- `makeInsertHarness` **:~678–763** (live-buffer fake; insert tests only —
  unchanged by this delta).
- Old-model blocks to rewrite: navigation describe ~:470 (width-truncation it
  ~:507), boundary-Esc describe **:526** (its :527–541; single-item
  :542–556), clamp describe **:558** (it :559–574), input-clock describe
  ~:632 (it ~:637), never-mutate full-scenario describe **:967** (it :969 —
  KEEP the pin, update the scenario), pure decision-table describes
  **:986–1057** (stale-index clamp :1045, single-item :1052).
- v1 regression pin (KEEP): zero `setHits()` across a full scenario.
- File-header model blurb **:14–20** carries old-model prose.

## grep inventory (widget-relevant only)

`boundary`: widget.ts 59, 61, 331, 401, 978–979, 994, 996, 1010, 1013, 1367,
1424; widget.test.ts 16–17, 526, 542, 552; widget-visibility.test.ts 296.
`clamp`: widget.ts 200, 258, 267, 979, 996, 1013, ~1415–1420, 1480;
widget.test.ts 187, 507, 517, 519, 558, 637, 974, 998–1056.
`interacted`: ZERO hits in src/ and test/.
DO NOT touch (false friends): config.ts `clampNumber`, score/query clamps,
segment/ingest/provider word-boundary mentions, README config-table
"(clamped)" knob ranges.

## Ripple containment

`decideWidgetKey` is imported ONLY by widget.ts's own wiring and
test/widget.test.ts (:47–56). `WidgetState` type also used by
test/editor-enter.test.ts. No other production callers — the signature change
(added `interacted` param) is contained. widget.ts production importers:
src/pi/index.ts (`createWidgetEditorFactory`, `isWidgetWrapper`,
`widgetOptsOf`) — none call decideWidgetKey.

## Gauntlet

`npm run check` = tsc --noEmit · `npm test` = vitest --run ·
`npm run bench` = vitest bench.
