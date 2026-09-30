# Research notes — plan 003 P1.M3.T1.S1 (session_start dual-path branch + widget-primary wiring)

## Verified code state
- `src/pi/index.ts` session_start order (L137–283), exactly as the work item
  describes:
  1. loadConfig (L140)
  2. sessionStore/sessionChain/lazyDict/pipeline (L152–186), incl. enableChaining
     spread gate, isDisabled, rejectCommonness
  3. restoreReady promise + markReady (L~201-205); `ctx.ui.addAutocompleteProvider`
     (L210) stacking createDisplayProvider(createStartupGate(createHapaxProvider(
     store!, config, current, sessionChain), restoreReady), {firstPaintDelayMs:
     config.menuDelayMs, getPreviousKeystrokeAt: () => inputClock.prevAt,
     isIntentResult}); assigns factory-slot `displayProvider = p`
  4. inputClock + tickInputClock (L246-251); `const editorFactory =
     ctx.ui.getEditorComponent?.()`; `if (editorFactory && !
     isEnterSubmitWrapper(editorFactory)) ctx.ui.setEditorComponent?.(
     wrapEditorFactory(editorFactory, tickInputClock))` (L252-255)
  5. debug /acwords (L258)
  6. restore gating + markReady (L261-283)
- `src/pi/editor.ts`: `wrapEditorFactory(inner, onKeystroke?)` (L147-155) builds
  inner from captured factory and wraps each instance in the v2 Proxy
  (`createEnterSubmitEditor`); `WRAPPED` symbol + `isEnterSubmitWrapper` (L159-166)
  prevent stacking across reloads. Proxy get-trap seam: `handleInput` overridden,
  everything else bound to inner; a widget layer may nest a second proxy or the
  same trap can host a key-handler callback (architecture doc §2 options a/b).
- Factory slots: `displayProvider` nullable module/closure slot assigned in step 3
  (also referenced at shutdown?) — check before skipping assignment on widget path
  (grep displayProvider usage; dispose()/reset calls must be null-safe).
- pi API (verified in dist + architecture doc §1): `getEditorComponent():
  EditorFactory|undefined` and `setEditorComponent(factory|undefined)` on
  ExtensionUIContext (types.d.ts:171,173); EditorFactory = (tui, theme,
  keybindings) => EditorComponent (:63). `ctx.ui.getEditorComponent?.()` optional
  chaining already used — keep it (API-change tolerance).
- config surface now includes fuzzThreshold (P1.M2.T1.S3) and menuDelayMs and
  rejectCommonness; rankMatches(store, fragment, {limit, fuzzThreshold}) is the
  query API (provider.ts L584-588).
- Startup gate: `createStartupGate(provider, restoreReady)` in provider.ts; the
  widget path must share the SAME restoreReady promise (per spec h2.42 "Both paths
  share the query core (04), the startup gate, and the debounce/hysteresis
  timing") — so restoreReady/markReady must be created BEFORE the branch.
- Tests: test/index.test.ts already has `fakePi()` (handlers captured by event
  name, type Handler = (event, ctx) => unknown) and `fakeCtx(over)` building a
  plain ctx object with sessionManager fakes, ui fakes, etc., plus `wired(over)`
  fixture and startSession helper — EXTEND fakeCtx with configurable
  `getEditorComponent`/`setEditorComponent` (default undefined = fallback path;
  existing tests unaffected). Provider-stack tests in test/provider.test.ts use
  vi.fn() `current` mocks. NodeNext .js imports; vitest; `npm run check`/`npm test`.
- TOCTOU with later extensions: accepted tolerance (same as today's wrap).
- No README work here (Mode B, R5/P1.M4.T1.S1).

## Design decisions
- widget.ts SKELETON only (this task): export a composition function, e.g.
  `createWidgetEditorFactory(opts)` returning a wrapped EditorFactory that (for
  now) delegates 1:1 to the captured factory + feeds the input clock + keeps the
  Enter-submits guard semantics — i.e. compose: widget layer (pass-through S1) →
  enter-submit proxy → inner. Rendering (S2), visibility (T2), keys (T3) extend
  the widget layer in later tasks via the documented seam. Must carry its own
  WRAPPED-style symbol for reload idempotence (or reuse isEnterSubmitWrapper-style
  check so a re-run session_start never double-wraps).
- Branch placement in index.ts: after pipeline construction + restoreReady
  creation, BEFORE step 3:
  ```
  const editorFactory = ctx.ui.getEditorComponent?.();
  if (editorFactory) { widget primary: setEditorComponent(createWidgetEditorFactory(
    {...deps: sessionStore, config, sessionChain, restoreReady, inputClock tick}));
    // skip addAutocompleteProvider entirely
  } else { steps 3-4 verbatim }
  ```
  Note: inputClock must be declared BEFORE the branch (both paths use it).
  In the widget branch the enter-submit semantics must survive: widget skeleton
  composition includes the enter-submit guard (see widget.ts design) — do NOT
  also call wrapEditorFactory separately (avoid double wrap).
- Fallback path must be byte-for-byte today's steps 3–4 (forced single-item
  included — that lives in provider.ts, untouched).
- displayProvider slot: on widget path leave it null; audit existing uses
  (before_agent_start / shutdown dispose) for null-safety.
