# Research notes — P1.M3.T2.S1 (widget visibility machine)

## Verified code facts (working tree)

- src/pi/widget.ts (S1 skeleton landed):
  - `WidgetLayerOptions` already carries every dependency this machine
    needs: `inner` factory, `store`, `config` (triggerChar, maxSuggestions,
    menuDelayMs, fuzzThreshold, threshold), `chain` (ChainMachine),
    `restoreReady: Promise<void>`, `onKeystroke: () => void`.
  - `createWidgetEditorFactory` (L107+) builds inner verbatim, wraps in
    `createEnterSubmitEditor` (which ticks onKeystroke for EVERY input
    event BEFORE delegating — editor.ts L97–102). Header comment reserves:
    "P1.M3.T2.S1 adds the visibility machine".
  - `isWidgetWrapper` / `widgetOptsOf` introspection seams exist for tests.
- src/pi/provider.ts:
  - `extractMatchState(lines, line, col, config): MatchState | null` (L70)
    — PURE, line-local; trigger mode `/(?:^|[ \t])#([^\s#]*)$/` (trigger
    char regex-escaped; "" disables), threshold mode
    `/[A-Za-z][A-Za-z0-9_-]*$/` with inner/trailing hyphens; returns
    {mode, fragment, prefix}. Null = no fragment.
  - `classifyStockContext(lines, line, col): StockContext | null` (L128) —
    PURE; slash (line 0, no space) → mention (@frag at word start) →
    quoted-path (odd `"`) → path (slash with whitespace-free tail).
  - `createDisplayProvider` (L950+): FALLBACK timing stack to re-home —
    debounceMs=100 swap (lastPaintAt, pending swap replaced by newer
    keystroke, L1018–1036), firstPaintDelayMs hesitation +
    getPreviousKeystrokeAt keystroke-gap math (~L1090), flicker hysteresis.
    MUST NOT be modified — copy the semantics.
  - `LiveResult`/chain machine: armed-chain bypass of the hesitation gate
    is T3's to wire via the seam.
- src/pi/editor.ts: input clock = onKeystroke in the enter-submit guard,
  fires for every input event, before delegation; a throwing hook never
  breaks input.
- src/core/query.ts: `rankMatches` applies fuzzThreshold discard BEFORE
  ranking — "≥1 candidate above threshold" === non-empty result; bare `#`
  (zero-fragment) is a supported input (sessionCount-desc listing).
- index.ts: `restoreReady` promise + `createStartupGate(...)` wiring; bound
  ≤ 500 ms (startup-gate.test.ts patterns).
- Timing constants: swap debounce 100 ms, fresh-reopen 200 ms,
  menuDelayMs default 0 (OFF), restore gate ≤ 500 ms.

## Architecture doc (r4-widget-pi-api.md) cross-refs

- §2: per-keystroke live state via proxy `getLines()`/`getCursor()`/
  `getText()`; the onKeystroke hook is the input clock; extractMatchState/
  classifyStockContext run synchronously per keystroke — "exactly what
  spec 07's re-based state machine requires" (no pi-tui request cadence).
- §5: key interception precedes the inner editor (T3); the visibility
  machine is clock-driven detection, not request-driven.
- Risk notes: repaint needs tui.requestRender() or piggybacks on the next
  keystroke render (the 100 ms debounce makes per-keystroke render enough)
  — rendering concerns stay with T1.S2.

## Parallel-work contract (P1.M3.T1.S2, in flight)

- T1.S2's PRP defines `WidgetState { set(items), hide(), highlightIndex }`
  as the render seam; set() resets highlight to 0 on every set change.
  This machine's OUTPUT (VisibilityState { visible, suppressUntilWordStart,
  currentSet }) feeds it; glue connects only when both have landed — PRP
  specifies a documented TODO hook if S2 is still in flight.

## Design decisions settled in the PRP

- Machine = pure decision core: `onInput()` per tick, `onDismissed(explicit)`
  seam for T3, no key consumption, no rendering, no editor mutation.
- classifyStockContext runs BEFORE extractMatchState (null from the latter
  conflates stock contexts and no-fragment).
- Timestamps recorded for EVERY tick (hesitation gap math needs
  consecutive-tick deltas, including non-qualifying ticks).
- Disqualification close never suppresses; explicit dismissal suppresses
  until word start or trigger char.
- Timing logic is COPIED (re-homed) from the fallback display provider,
  which stays byte-identical.
- Tests: vi.useFakeTimers (setTimeout/clearTimeout/Date), fake editor-state
  holder, stubbed query dep, recorded paint sequences for hysteresis.
