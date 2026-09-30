# PRP — plan 003 P1.M3.T1.S1: session_start dual-path branch + widget-primary wiring (no provider registration)

## Goal

**Feature Goal**: Implement the dual-path display-architecture branch (spec §07
h2.42) in `src/pi/index.ts`'s `session_start` handler and land the
`src/pi/widget.ts` module skeleton. Read `ctx.ui.getEditorComponent()` FIRST
(before today's provider registration): **factory exists → widget PRIMARY** —
skip `addAutocompleteProvider` entirely and wrap the factory with the
widget+enter-submit composition (skeleton: pass-through delegation + input
clock + Enter-submits guard; render/visibility/keys land in S2/T2/T3); **no
factory → fallback** — today's steps 3–4 VERBATIM (provider registration with
startup gate + hesitation gate; no enter-submit wrap either — tolerated state,
unchanged). Both paths share the same store/config/sessionChain, the
`restoreReady` startup-gate signal, and the debounce/hesitation timing config.

**Deliverable**:
1. New `src/pi/widget.ts` — skeleton composition
   (`createWidgetEditorFactory(opts)` + idempotence marker), JSDoc mapping
   forward tasks (S2 render, T2 visibility, T3 keys).
2. Modified `src/pi/index.ts` — the branch, with `inputClock` hoisted above it.
3. Extended `test/index.test.ts` (configurable `getEditorComponent`/
   `setEditorComponent` fakes) + new dual-path pin tests.

**Success Definition**: widget path registers NO autocomplete provider and
installs exactly one wrapped factory; fallback path registers exactly today's
stack (existing provider tests green, unmodified); both paths share
restoreReady/timing; `npm run check` + `npm test` green.

## Why

- Spec §07 h2.42 (2026-10 owner rule): primary widget path renders hapax's own
  one-line widget and owns display/key semantics entirely — "No autocomplete
  provider is registered on this path; stock path/slash/@ completion is
  untouched by construction." Fallback (no factory) keeps the pre-2026-10
  provider behavior, single-item forced return included.
- This task is the **enabling seam**: P1.M3.T1.S2 (render), P1.M3.T2.S1
  (visibility), P1.M3.T3 (keys) all extend the widget layer created here;
  P1.M3.T4 verifies live.
- Query input: final `rankMatches(store, fragment, { limit, fuzzThreshold })`
  API (P1.M2.T2.S1 / P1.M2.T1.S3, landed; P1.M2.T3.S1 in parallel touches only
  the provider's chain filter — no overlap with index.ts/widget.ts).

## What

### Behavior contract

1. **Branch placement** (`src/pi/index.ts`, session_start): keep steps 1–2
   (loadConfig; sessionStore/sessionChain/lazyDict/pipeline) and the
   `restoreReady`/`markReady` promise creation EXACTLY where they are, but move
   `inputClock`/`tickInputClock` ABOVE the branch (both paths need it). Then:

   ```ts
   // Dual-path display architecture (spec 07 h2.42): an editor factory means
   // some extension owns the editor — hapax composes around it and renders
   // its own one-line widget (PRIMARY). No factory → the proxy cannot
   // install; register the provider and use pi-tui's vertical menu
   // (FALLBACK, pre-2026-10 behavior). TOCTOU with later extensions is the
   // same accepted tolerance as today's enter-submit wrap.
   const editorFactory = ctx.ui.getEditorComponent?.();
   if (editorFactory) {
     // PRIMARY: no addAutocompleteProvider — ever. The widget layer owns
     // display + key semantics (skeleton here; S2/T2/T3 extend it).
     ctx.ui.setEditorComponent?.(
       createWidgetEditorFactory({
         inner: editorFactory,
         store: sessionStore,      // bound const, not the nullable slot
         config,                   // triggerChar, maxSuggestions, menuDelayMs,
                                   // fuzzThreshold, trigger modes…
         chain: sessionChain,
         restoreReady,             // startup gate — shared with the fallback
         onKeystroke: tickInputClock, // shared input clock (hesitation timing)
       }),
     );
     displayProvider = null;       // no provider on this path
   } else {
     // FALLBACK: today's steps 3–4, byte-for-byte (provider registration
     // with createStartupGate + hesitation-gate options; NO editor wrap —
     // there is no factory to wrap, today's tolerated state).
     ...existing addAutocompleteProvider block unchanged...
   }
   ``   Steps 5–6 (debug /acwords, restore gating) stay AFTER the branch,
   shared by both paths, unchanged.

2. **`src/pi/widget.ts` skeleton** — exact shape:
   ```ts
   /** Options for the widget editor composition (PRD 003 §07 h2.42). */
   export interface WidgetLayerOptions {
     /** the captured pi editor factory — built verbatim, never mutated */
     inner: EditorFactory;
     store: CandidateStore;
     config: HapaxConfig;
     chain: ChainMachine;          // same type index.ts uses (createChainMachine)
     restoreReady: Promise<void>;  // startup restore gate signal
     onKeystroke: () => void;      // input clock tick (hesitation timing)
   }

   /** Marker preventing double-wrap across reload cycles (mirrors
    * editor.ts WRAPPED). */
   const WIDGET_WRAPPED = Symbol("hapax.widgetWrapped");
   export function isWidgetWrapper(factory: unknown): boolean { ... }

   export function createWidgetEditorFactory(
     opts: WidgetLayerOptions,
   ): EditorFactory {
     // S1 SKELETON: compose widget layer (pass-through for now) AROUND the
     // existing Enter-submits proxy:
     //   factory(tui, theme, kb) => widgetLayer(
     //     createEnterSubmitEditor(opts.inner(tui, theme, kb), kb, opts.onKeystroke))
     // P1.M3.T1.S2 overrides render (append the one-line widget below the
     // editor's lines); P1.M3.T2.S1 adds the visibility machine;
     // P1.M3.T3.S1/S2 add key consumption (arrows/Esc/Tab/Enter) BEFORE the
     // enter-submit guard — the get-trap seam documented in
     // plan/003_bbac3b15e8d0/architecture/r4-widget-pi-api.md §2.
     // Never mutate the inner instance (v1 recursion crash lesson).
   }
   ```
   S1 rules: the skeleton must (a) build the inner from the captured factory
   verbatim, (b) keep the Enter-submits guard semantics (reuse
   `createEnterSubmitEditor` from editor.ts — do NOT re-implement), (c) tick
   the input clock on every input event, (d) delegate EVERYTHING else
   verbatim (render untouched — no widget line yet), (e) stamp
   `WIDGET_WRAPPED` so a reload cycle re-running session_start cannot stack
   wrappers. Type `EditorFactory` structurally (duck-typed `(tui, theme,
   keybindings) => EditorComponent` like `wrapEditorFactory` does with `any`
   params — do not import runtime values from the pi package beyond types).

3. **Fallback path**: byte-for-byte today's steps 3–4. The forced single-item
   Tab mitigation lives in provider.ts — untouched. `displayProvider = p` only
   on this path.

4. **`displayProvider` slot audit**: on the widget path leave the slot null;
   verify every existing use (e.g. before_agent_start reset / shutdown dispose
   in index.ts) is already null-safe (it is nullable today) — if any path
   dereferences unconditionally, guard it.

5. **Shared-core pins** (tests must assert): both paths receive the same
   `sessionStore`, `config`, `sessionChain`, `restoreReady`, `inputClock`
   timing; only the display composition differs.

6. **No README/config changes** (Mode B — R5/P1.M4.T1.S1 owns docs; no new
   config keys).

## All Needed Context

### Documentation & References

```yaml
- file: src/pi/index.ts
  why: the session_start handler to branch (L137–283): steps 1–6, restoreReady,
        addAutocompleteProvider stack, inputClock, editor wrap, restore gating
  pattern: keep steps 1-2 + restoreReady + (hoisted) inputClock before the
           branch; steps 5-6 after it; fallback block byte-identical
  gotcha: restoreReady/markReady MUST be created before the branch (widget
          path consumes it too); inputClock likewise

- file: src/pi/editor.ts
  why: createEnterSubmitEditor(inner, kb, onKeystroke) to REUSE inside the
        widget composition; WRAPPED symbol / isEnterSubmitWrapper idempotence
        pattern to mirror; the get-trap proxy seam S2/T2/T3 extend
  gotcha: never mutate the inner instance (v1 recursion crash); proxy must
          keep `then` → undefined

- docfile: plan/003_bbac3b15e8d0/architecture/r4-widget-pi-api.md
  why: verified pi 0.84.4 API (getEditorComponent/setEditorComponent at
        types.d.ts:171,173; EditorFactory :63), the proxy-composition options
        (§2), and the exact branch-point plan (§3) this task implements
  section: §2, §3

- file: test/index.test.ts
  why: existing fakePi()/fakeCtx(over)/wired()/startSession harness — extend
        fakeCtx with getEditorComponent/setEditorComponent fakes (default
        undefined keeps every existing test on the fallback path)
  pattern: handlers captured by event name; plain-object ctx; type Handler

- file: test/provider.test.ts
  why: proves the fallback provider stack is byte-identical — suite must stay
        green UNMODIFIED (the fallback branch is today's code)

- file: src/pi/provider.ts (read-only reference)
  why: createStartupGate / createHapaxProvider signatures + rankMatches call
        shape ({limit, fuzzThreshold}) the widget layer will consume in S2/T2
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: the widget path must call addAutocompleteProvider ZERO times —
// a stray registration makes the stock vertical menu fight the widget line.
// CRITICAL: wrap idempotence — reload cycles re-run session_start; the
// WIDGET_WRAPPED marker (mirroring editor.ts WRAPPED) prevents stacking.
// CRITICAL: do NOT double-wrap enter-submit: the widget composition includes
// createEnterSubmitEditor itself; never also call wrapEditorFactory.
// CRITICAL: getEditorComponent read must happen BEFORE addAutocompleteProvider
// (the branch decides whether step 3 runs at all).
// ctx.ui.getEditorComponent?.() — keep optional chaining (API-change
// tolerance degrades to the fallback path, never breaks session start).
// EditorFactory params stay `any`-typed (duck-typed) — mirror wrapEditorFactory.
// TOCTOU with later extensions calling setEditorComponent after our read:
// accepted tolerance, same as today (comment it).
// NodeNext: relative imports end in .js.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/pi/widget.ts (skeleton)
  - IMPLEMENT: WidgetLayerOptions, WIDGET_WRAPPED + isWidgetWrapper,
    createWidgetEditorFactory composing createEnterSubmitEditor over the
    captured inner factory + pass-through widget layer (verbatim delegation)
  - FOLLOW pattern: src/pi/editor.ts wrapEditorFactory (factory wrapping,
    symbol stamping) and createEnterSubmitEditor (proxy/forwarding)
  - IMPORTS: createEnterSubmitEditor from ./editor.js; TYPES ONLY from
    ../core (CandidateStore, HapaxConfig via ./config.js) — duck-type the
    factory like editor.ts does
  - JSDoc: forward-task map (S2 render, T2 visibility, T3 keys) + spec cites

Task 2: MODIFY src/pi/index.ts — the branch
  - HOIST inputClock/tickInputClock above the branch
  - READ ctx.ui.getEditorComponent?.() BEFORE today's step 3
  - WIDGET branch: createWidgetEditorFactory({...deps...}) +
    setEditorComponent; displayProvider stays null
  - FALLBACK branch: today's step 3 + step 4 verbatim (incl. the existing
    isEnterSubmitWrapper guard on re-wrap — note: on fallback there is no
    factory, so step 4's guard block simply doesn't fire; keep it inside the
    fallback branch unchanged)
  - KEEP steps 5–6 after the branch, unchanged

Task 3: EXTEND test/index.test.ts + ADD dual-path pins
  - FOLLOW pattern: fakeCtx(over) — add optional editorFactory key wiring
    configurable getEditorComponent/setEditorComponent vi.fn()s (default
    undefined → fallback, existing tests untouched)
  - ADD describe("dual-path display branch (spec 07 h2.42)"):
    * factory present → addAutocompleteProvider NEVER called;
      setEditorComponent called once with our wrapped factory
    * factory present + re-run of session_start (reload) → no stacking
      (isWidgetWrapper guard; setEditorComponent receives an
      already-wrapped-safe result — assert single wrap layer semantics)
    * no factory → addAutocompleteProvider called once, setEditorComponent
      NOT called, provider stack shape = today's (reuse/delegate to
      provider.test.ts expectations; assert displayProvider wired)
    * both paths: restoreFromHistory gating + markReady run identically
      (assert restore happened / gate resolved on each path)
    * widget factory receives the session's store/config/chain (assert via
      a spy factory that captures opts — expose opts through a test seam or
      capture the returned factory and inspect behavior via tick clock)
  - PLACEMENT: test/index.test.ts (extend) — tests NOT colocated

Task 4: VERIFY
  - npm run check && npm test
```

### Implementation Patterns & Key Details

```ts
// widget.ts composition core (S1 skeleton):
const wrapped = (tui: any, theme: any, keybindings?: any) => {
  const inner = createEnterSubmitEditor(
    opts.inner(tui, theme, keybindings), keybindings, opts.onKeystroke,
  );
  // S1: pass-through — return inner unchanged. S2/T2/T3 wrap `inner` in the
  // widget proxy here (render override + key consumption), always composing
  // OUTWARD (widget layer sees keys FIRST, enter-submit second, inner last).
  return inner;
};
(wrapped as { [WIDGET_WRAPPED]?: boolean })[WIDGET_WRAPPED] = true;
```

### Integration Points

```yaml
# None new in S1 — no config keys, no README, no manifest change.
# Consumers: P1.M3.T1.S2 (render override at the widget layer seam),
# P1.M3.T2.S1 (visibility machine on the same layer), P1.M3.T3.S1/S2 (key
# consumption BEFORE the enter-submit guard), P1.M3.T4.S1 (live TTY verify).
# Fallback-path PINs (provider.ts) untouched — they stay fallback-only per
# spec 07 ("dead on the widget path").
```

## Validation Loop

### Level 1: Syntax & Style
```bash
npm run check
```

### Level 2: Unit Tests
```bash
npx vitest --run test/index.test.ts
npx vitest --run test/provider.test.ts   # fallback stack byte-identical, unmodified
npm test
```

## Final Validation Checklist

- [ ] Widget path: `addAutocompleteProvider` never called; one
      `setEditorComponent` with the widget-composed factory
- [ ] Fallback path: today's steps 3–4 byte-for-byte; provider tests green
      unmodified
- [ ] Enter-submits guard preserved on BOTH paths (widget: inside the
      composition; fallback: today's tolerated no-wrap state unchanged)
- [ ] Reload idempotence: no wrapper stacking (WIDGET_WRAPPED + existing
      WRAPPED guards)
- [ ] restoreReady + inputClock shared by both paths; restore gating runs on
      both
- [ ] Inner factory/instances never mutated; proxy never a thenable
- [ ] No config/README changes; `npm run check` + `npm test` green

## Anti-Patterns to Avoid

- ❌ Don't register the provider "for safety" on the widget path — that is
  the bug class the dual path exists to eliminate
- ❌ Don't re-implement the Enter-submits guard in widget.ts — reuse
  createEnterSubmitEditor
- ❌ Don't call wrapEditorFactory in addition to createWidgetEditorFactory
- ❌ Don't read getEditorComponent after registering the provider
- ❌ Don't mutate the inner editor instance (v1 recursion crash lesson)
- ❌ Don't colocate tests; don't add config keys

**Confidence Score: 8/10** — the branch point, shared-deps list, idempotence
mechanism, and test harness are all pinned against live source and the
verified API doc; residual risk is only in the exact typing of the
ChainMachine/config options surface S2+ will consume, mitigated by the
duck-typing guidance and forward JSDoc map.
