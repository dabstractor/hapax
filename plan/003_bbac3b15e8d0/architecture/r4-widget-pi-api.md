# R4 — One-line widget primary display path / dual-path architecture (delta PRD 003, P1.M3)

Installed versions (verified): `@earendil-works/pi-coding-agent` **0.84.4**
(`node_modules/@earendil-works/pi-coding-agent/package.json:3`), `@earendil-works/pi-tui`
0.84.x (dist layout matches plan/002 findings).

---

## 1. The pi extension API for capturing/replacing the editor component

### Exact API (dist/core/extensions/types.d.ts)

```ts
// dist/core/extensions/types.d.ts:63
export type EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent;

// dist/core/extensions/types.d.ts:171,173  (on ExtensionUIContext)
setEditorComponent(factory: EditorFactory | undefined): void;
getEditorComponent(): EditorFactory | undefined;
```

`CustomEditor` is exported from the package root and is the sanctioned base:

```ts
// dist/modes/interactive/components/custom-editor.d.ts
export declare class CustomEditor extends Editor {
    actionHandlers: Map<AppKeybinding, () => void>;
    onEscape?: () => void; onCtrlD?: () => void;
    onPasteImage?: () => void;
    onExtensionShortcut?: (data: string) => boolean;
    constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: EditorOptions);
    onAction(action: AppKeybinding, handler: () => void): void;
    handleInput(data: string): void;
}
```

Docs (docs/extensions.md:2664–2669, 2828–2838; docs/tui.md:913–916) pin the rules:
extend `CustomEditor` (not base `Editor`) for app keybindings; the factory receives
`(tui, theme, keybindings)`; use `ctx.ui.getEditorComponent()` **before**
`setEditorComponent()` to wrap the previously configured editor; pass `undefined` to
restore the default.

Related UI-context members (same file, verbatim order): `setEditorText(text)` /
`getEditorText()` (:135–138), `addAutocompleteProvider(factory:
AutocompleteProviderFactory)` (:141), plus `setWidget(key, content, options?)` with
`WidgetPlacement = "aboveEditor" | "belowEditor"` (types.d.ts:43,97–100) — an
alternative render surface, but one the app owns (no key routing), so it cannot host
the widget's arrow/Tab semantics.

### How border-status-editor.ts renders a line "around" the editor

`examples/extensions/border-status-editor.ts`, step by step:

1. `session_start` handler receives `ctx` (line ~78).
2. Declares `class BorderStatusEditor extends CustomEditor` **inside** the handler
   (closure over `ctx`, `isWorking`, etc.); constructor is
   `super(tui, theme, keybindings, { paddingX: 0 })`.
3. **Overrides `render(width: number): string[]`**: calls `const lines =
   super.render(width)` — the stock editor's own lines — then rewrites `lines[0]`
   and `lines[lines.length - 1]` (the border rows) with `fitBorder(...)` and returns
   the array. Nothing else about the editor changes; key handling is untouched.
4. Installs it: `ctx.ui.setEditorComponent((tui, theme, keybindings) => new
   BorderStatusEditor(tui, theme, keybindings))`.

Mechanism summary: **subclass + render override composing on `super.render(width)`**.
The width arrives as `render`'s parameter — no terminal-width API needed.
`modal-editor.ts` shows the key-side half: override `handleInput(data)`, branch, and
call `super.handleInput(data)` for everything not handled; its `render` appends a mode
label to the bottom border line. `rainbow-editor.ts` overrides both
(`handleInput` → `super.handleInput(data)` then `this.getText()`; `render` maps
`super.render(width)`), and uses `this.tui.requestRender()` for animation — note
`Editor.tui` is `protected` (:37 of editor.d.ts), accessible to subclasses only.
Public surface used by the examples: `handleInput`, `render(width)`, `getText()`,
`getLines(): string[]`, `getCursor(): { line: number; col: number }`
(editor.d.ts:98–110).

## 2. Composing a widget-aware double with the existing v2 forwarding Proxy

`src/pi/editor.ts` today (all of it read):

- `createEnterSubmitEditor<T extends object>(inner, keybindings?, onKeystroke?)`
  returns `new Proxy({} as T, {...})` whose traps:
  - `get`: `then` → `undefined` (never a thenable); `handleInput` → the guard;
    everything else → inner value, functions `.bind(inner)`.
  - `set` / `has` → forward to inner.
  The inner instance is **never mutated** (the v1 monkey-patch recursion crash is
  documented in the module header and spec 07 "HISTORY — v1 monkey-patch crashed").
- The guard's `handleInput(data)` runs `onKeystroke?.()` first (the input clock —
  `() => void`, invoked for EVERY input event), then: submit key +
  `inner.isShowingAutocomplete() === true` + `!inner.autocompletePrefix?.startsWith("/")`
  → `inner.cancelAutocomplete()`; finally `return innerAny.handleInput?.(data)`.
- `wrapEditorFactory(inner, onKeystroke?)` builds the inner from the captured factory
  verbatim and wraps each instance; `isEnterSubmitWrapper(factory)` (via the
  `WRAPPED` symbol) prevents stacking across reloads.

**Where a second layer intercepts keys before the inner editor:** exactly the same
proxy `get` trap seam. A widget layer can either (a) wrap the enter-submit proxy in a
second proxy that additionally overrides `handleInput` (arrow/Tab/Esc consumption
while the line is visible, then delegate to the enter-submit proxy) — nested proxies
are safe because neither mutates the inner instance and each is the sole owner of its
own members; or (b) extend `createEnterSubmitEditor` to consult a `widgetKeyHandler`
callback before the submit guard. Because the proxy's forwarded `handleInput` read on
the inner is dynamic (`innerAny.handleInput?.(data)`) and the inner is untouched,
there is no re-entry cycle. For rendering, the proxy can also override `render` in
its `get` trap (call `inner.render(width)`, append/prepend the widget line) — this is
the technique `border-status-editor` uses via subclassing, transplanted to the proxy
world, and yields the terminal width for the spec's "line cap = maxSuggestions AND
terminal width" without any TUI width API (the `TUI` interface exposes no width
getter — only `requestRender(force?)`; `render(width)` is the only width source).
Live input text/caret per keystroke are available on the inner through the proxy:
`getLines()`, `getCursor()`, `getText()`.

## 3. index.ts session_start wiring — current order and the branch point

Current order in `src/pi/index.ts` `pi.on("session_start", ...)`:

1. `loadConfig(...)` (cwd/isProjectTrusted/notify).
2. `sessionStore = new CandidateStore()`; `sessionChain = createChainMachine()`;
   `lazyDict` (sticky-failure); `pipeline = new IngestPipeline({...})` (with
   `enableChaining`-gated `onAdmittedTokens`).
3. `restoreReady` promise + `ctx.ui.addAutocompleteProvider((current) => { const p =
   createDisplayProvider(createStartupGate(createHapaxProvider(store!, config,
   current, sessionChain), restoreReady), { firstPaintDelayMs, getPreviousKeystrokeAt,
   isIntentResult }); displayProvider = p; return p; })`.
4. `inputClock` + `tickInputClock`; `const editorFactory = ctx.ui.getEditorComponent?.()`;
   `if (editorFactory && !isEnterSubmitWrapper(editorFactory))
   ctx.ui.setEditorComponent?.(wrapEditorFactory(editorFactory, tickInputClock));`
5. `if (config.debug) registerAcwordsCommand(...)` (acwords).
6. History-restore gating (`restoreFromHistory` or `markReady()`).

Dual-path branch: **read `ctx.ui.getEditorComponent()` FIRST (before step 3)** and
split:

- factory exists → widget PRIMARY: skip `addAutocompleteProvider` entirely; wrap the
  factory with the widget+enter-submit proxy (spec 07 Display architecture: "No
  autocomplete provider is registered on this path"). The widget layer must still get
  `store/config/sessionChain`, the startup gate's `restoreReady`, and the
  hesitation/debounce timing (query core + startup gate + timing shared per spec).
- no factory → today's steps 3–4 verbatim (provider registration; enter-submit wrap
  can't install — there is no factory — so the fallback is provider-only, matching
  spec: "Where no factory exists the proxy cannot install and the widget cannot
  run").

Ordering hazard: an extension loaded AFTER hapax could call `setEditorComponent`
after our read; today's enter-submit wrap has the same TOCTOU and accepts it
(reload cycles re-run session_start). Keep the same tolerance.

## 4. The four pi-tui PINs in provider.ts

Only ONE explicit `PIN:` marker exists in `src/pi/provider.ts` today:

- **provider.ts:318** (forced single-item fast path): "PIN: if pi-tui changes the
  `items.length === 1` fast path, this mitigation needs revisit" — the contract
  `options.force && options.explicitTab && suggestions.items.length === 1` applies
  the completion immediately (components/editor.js ~1903).

Spec 07 "pi-tui contract dependencies" lists the full four (fallback-path PINs,
"marked as their consumption sites in src/pi/provider.ts"): (1) the single-item
forced fast path (the explicit PIN above); (2) trigger-char branch shadowing
(letters registered ⇒ stock letter-continuation branch unreachable — consumption
site: the `IDENTIFIER_TRIGGERS` block, provider.ts ~199–207); (3) one-query-per-word
while the menu is closed (consumption site: startup gate + the AUTO-OPEN comment,
provider.ts ~"pi-tui's handleChar fires getSuggestions for plain letters ONLY at a
word start"); (4) space-updates-open-menu flow (consumption site: the CLOSE-ON-SPACE
block 1.8).

**Widget path effect:** per spec 07 the widget path "leans instead on the
editor-proxy composition rules … and its own render surface" — PINs (1)–(4) are
fallback-path-only and become dead on the widget path (no provider registered). The
widget path adds NEW contract surface, not pinned to pi-tui internals but to the
public editor API: `handleInput` being the sole key entry point, `render(width)`
composability, `getLines()/getCursor()` for live state, `cancelAutocomplete()` /
`isShowingAutocomplete` (already used defensively), and re-implemented Tab insertion
("stock `applyCompletion` semantics, reimplemented on the widget path" — spec 07).
These are type-visible public members (editor.d.ts), lower risk than the fallback
PINs.

## 5. Key-event interception feasibility

Feasible on the installed version, by the examples' own technique: `ModalEditor`
consumes keys (`escape`, `h/j/k/l`) BEFORE `super.handleInput(data)` and returns
without delegating (modal-editor.ts handleInput). On the widget path the proxy's
overridden `handleInput` does the same: while the widget line is visible, match the
arrow sequences (`\x1b[A..\x1b[D`, or `matchesKey(data, "up")` etc. from
`@earendil-works/pi-tui` — `matchesKey` is exported, index.d.ts:21), Tab, and Esc;
consume (return without calling inner) per the spec's widget key handling (boundary-
Esc, clamp at last word, Enter dismiss-then-forward). `isSubmitKey(data, keybindings)`
already exists in editor.ts and generalizes via `keybindings.matches(data, action)`
for any registered action.

Per-keystroke live state: the proxy forwards `getLines(): string[]` and
`getCursor(): {line, col}` (editor.d.ts:105–110) — the widget's visibility state
machine can run `extractMatchState`/`classifyStockContext` synchronously on every
input event (they are pure, provider.ts), driven by the `onKeystroke` clock seam that
already ticks in the guard. No pi-tui request cadence is needed — exactly what spec
07's "re-based" state machine requires ("the widget path does not depend on pi-tui's
request cadence").

## 6. VERDICT

**Feasible with pi 0.84.4.** Exact exports to use:

- `ctx.ui.getEditorComponent(): EditorFactory | undefined` / `ctx.ui.setEditorComponent(factory |
  undefined)` (types.d.ts:171,173) — gating + install.
- `EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) =>
  EditorComponent` (types.d.ts:63) — signature the widget wrapper must match
  (`wrapEditorFactory` already matches structurally).
- Editor members via the proxy: `handleInput(data: string)`, `render(width: number):
  string[]`, `getLines()`, `getCursor()`, `getText()`, `isShowingAutocomplete()`,
  `cancelAutocomplete()` (editor.d.ts + existing editor.ts usage).
- `matchesKey` from `@earendil-works/pi-tui` for portable key matching.
- Timing/debounce: reuse `createDisplayProvider`'s scheduler logic (debounceMs 100,
  firstPaintDelayMs, BUG-002 prefix-anchor exceptions) re-homed into the widget layer.

**Risks**
- `render` override via the Proxy `get` trap is novel (examples subclass instead);
  the proxy returns bound inner functions — a wrapper must return an unbound
  function that composes `inner.render(width)` + the widget line, and the app must
  not cache/compare the function identity. Verify live per spec 09 TTY rules.
- Repaint on widget-state change needs `tui.requestRender()`; `tui` is `protected`
  on `Editor` (:37) — not reachable through the proxy by name. Options: capture
  `tui` in the factory wrapper (the factory receives it — same trick
  border-status-editor uses via constructor), or piggyback on the next keystroke's
  natural render (spec's 100 ms debounce makes per-keystroke render sufficient).
- Forced single-item fast path and the other four PINs do NOT apply on the widget
  path (no provider), but the FALLBACK must stay byte-for-byte — regression risk is
  the shared core (startup gate, timing) being subtly coupled to provider semantics.
- Terminal width for the cap comes only from `render(width)` — the widget must cache
  the last width seen; before the first render the width is unknown (render empty).
- Arrow capture while visible must respect boundary-Esc exactly (spec) — one-off
  key-consumption bugs are user-visible immediately; needs live TTY acceptance.
- `getEditorComponent()` returning a factory is itself a precondition; in stock pi
  with no editor extension the fallback path runs — that must be tested too.

## 7. Prior-research drift (plan/002 → today)

`plan/002_3e8a42cadf2c/architecture/pi_layer_map.md` (substance, not line numbers):

- **enablePhrases → enableChaining**: layer map describes `config.enablePhrases`,
  `consumePending()`, pending-one-shot adjacency offers, and **leading-space chain
  values** (`value: \` ${s.next}\``). All gone: provider.ts now gates on
  `config.enableChaining`, chain values are BARE words, the machine is
  `{state/arm/reset}` only (no pending), and the one-shot grant is the
  `chainWordsSeen/chainLastArmedPrefix` tracker inside the provider.
- **applyCompletion phrase branch** (case 3 "phrase key → last word") deleted as dead
  code (BUG-005 part 2) — layer map still documents it.
- **`options.force` "never read anywhere today"** — now read (`forced` narrowing,
  PIN at :318), plus display-layer rule 1.5 (forced = undelayed).
- **Missing from layer map entirely** (newer than plan/002): `createStartupGate`,
  `DisplayProviderOptions.firstPaintDelayMs/getPreviousKeystrokeAt/isIntentResult`,
  CLOSE-ON-SPACE (1.8), `classifyStockContext` (BUG-001), the `src/pi/editor.ts`
  enter-submit proxy + input clock, and the hesitation-gate logic. Also
  `menuDelayMs`, `rejectCommonness` config keys and the `maxSuggestions` default now
  3-ish per provider comments ("≤3 stored") vs layer map's "top 8 items" in spec 02.
- `external_deps.md` §2a (editor.js line numbers, fast path, 20 ms debounce) —
  version unchanged (0.84.4) and the fast-path quote still matches provider.ts's
  PIN comment; no behavioral drift detected, only that its "provider" frame predates
  the widget design (it assumes the vertical menu is the only display).
