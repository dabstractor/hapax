# Research: BUG-001 — M2 chained completion (zero-typed-char successor offers) is dead on the widget PRIMARY display path

## Claim verification

### Claim 1 — spec defines a path-independent chain state machine — VERIFIED
- `spec/07-completion-ui.md:437` `## M2: chained completion`, line 439: "State machine, armed only via Tab acceptance of a whole-word candidate:" with the diagram `idle ──Tab accepts word W──► armed(W)` (line 441).
- Line 443–449: "word start (cursor at the empty next word, ZERO typed chars) → offer the top successor from the successor index immediately (lookup W → top-3, ranked by count). No trigger char, no threshold, no typed fragment needed".
- One-shot grant, lines 450–457: "the immediate offer is granted for exactly ONE word per acceptance. Typing through that offer without accepting disarms at the next word boundary".
- Line 472–474: "Chain offers render on the widget line (or fallback menu) like any result set". So the spec explicitly REQUIRES widget-path chain offers — the code violates it.
- `spec/01-goals-and-scope.md:49–50` goal 7: "Chained completion: accepting a word arms its most-likely successor for zero-additional-typing Tab completion." No path carve-out.

### Claim 2 — widget.ts never arms; visibility machine not chain-wired — VERIFIED
- `src/pi/widget.ts:834–840` (insertHighlighted doc): "CHAIN ARMS: NEVER (plan 004). The widget path does not arm the Tab-chain machine — chain.arm exists ONLY in the provider's applyCompletion (provider.ts). WidgetLayerOptions.chain is held for index.ts's reset wiring and is read by NO widget code … Do not wire arming here." The function body indeed never touches `chain` (verified by reading the full body, widget.ts ~841–980: it edits text, hides state, calls `visibility.onDismissed(true)`, no chain call).
- `createWidgetEditorFactory` (widget.ts:984) builds `createVisibilityMachine({ store, config, restoreReady, getEditorState, onPaint })` (widget.ts ~995–1011) — **`isIntentBypass` and any chain query are NOT passed**. `VisibilityMachineDeps.isIntentBypass` exists (widget.ts ~415: "Intent test ADDITIONAL to trigger mode … T3's armed-chain successors land here via this seam. Default: nothing extra.") — the seam is present but unwired.

### Claim 3 — widget branch registers no provider → applyCompletion never runs — VERIFIED
- `src/pi/index.ts:262–284`: `const editorFactory = ctx.ui.getEditorComponent?.();` — first branch (factory present, not ours): sets the widget editor, comment "PRIMARY: no addAutocompleteProvider — ever." (index.ts ~266); `displayProvider = null`. Reload branch likewise. Only the `else` (fallback) branch calls `ctx.ui.addAutocompleteProvider(...)` with `createHapaxProvider(store!, config, current, sessionChain)` (index.ts ~312–330).
- The ONLY chain-arming site is `provider.ts applyCompletion` (~line 639–706): `chain.arm(key)` / `chain.arm(key.slice(CHAIN_KEY_PREFIX.length))` under `if (config.enableChaining)`. With no provider registered, pi never calls hapax's applyCompletion — the widget path can never arm.

### Claim 4 — tests pin no-arm; validate.sh only exercises fallback chaining — VERIFIED
- `test/widget.test.ts:1053` `describe("widget Tab acceptance NEVER arms a chain (plan 004 pin)")`, :1054 comment "BY DESIGN", :1059 `it("a consumed Tab acceptance with WidgetLayerOptions.chain present never calls chain.arm", ...)` asserting `chain.arm` never fires while the edit lands.
- `plan/004_24ebf0115d16/…/validate.sh` (Journey B, lines ~234–267) drives chaining through `provider.getSuggestions` / `provider.applyCompletion` — the FALLBACK provider only; the widget path is never exercised for chaining.

### Claim 5 — repro — VERIFIED (live harness, /tmp only)
Ran a vitest harness (`/tmp/bug001.test.ts`, repo node_modules, no repo files touched):
store seeded `store.upsert({key:"zorpwibble",display:"Zorpwibble",…})`, `store.recordBigramRuns([["zorpwibble","quuxblat"],["zorpwibble","quuxblat"]])` → `store.topSuccessors("zorpwibble")` === `[{next:"quuxblat",count:2}]`; editor composed via `createWidgetEditorFactory`; typed "zo","r","p" → widget line visible with the candidate; Tab consumed and inserted `Zorpwibble`; `chain.state()` stayed `null`; after typing a space the visibility machine reported `visible:false` with empty `currentSet` — no successor offer. Result: 1 passed. (The provider half — same sequence arms and offers successors with `description: "chain"` — is pinned by `test/chain.test.ts` cases 2/4/5, e.g. line 260 "zero-char word-start offer … bare values, prefix ''".)

## Exact contracts

### provider.ts chain flow (the reference implementation, src/pi/provider.ts)
- Arm site: `applyCompletion` (provider.ts ~639). Classifies the accepted `item.value` via `liveKeyByValue` (value→key map rebuilt every query):
  - key starts with `CHAIN_KEY_PREFIX` (`"\u0000chain:"`, provider.ts:725) → `chain.arm(key.slice(prefix.length))`, `chainWordsSeen = 0`, `chainLastArmedPrefix = null`.
  - plain single-token key → tier-0 suppression check: `const rec = lastLive?.matches.find((m) => m.display === item.value); if (rec?.tier === 0) { /* never arms */ } else { chain.arm(key); … }`.
  - not in map (path completion / stale) → never arms. Then delegates verbatim to `current.applyCompletion`.
- Consult site: `getSuggestions` armed branch (provider.ts ~379 `const armed = chain.state(); if (armed && config.enableChaining)`), ordered: abort → stock-context gate (`classifyStockContext`, provider.ts ~308 — armed chains NEVER override stock contexts) → armed branch → force-aware returns → normal.
- One-shot tracker (provider.ts ~380–420): `chainWordsSeen` / `chainLastArmedPrefix`; word-boundary logic — a new word (prefix neither extends nor is-extended-by the previous) after the granted word → `chain.reset()` + fall through to normal path on the SAME keystroke.
- Zero-char offer (a): `before === "" || /[ \t]$/.test(before)` → `store.topSuccessors(armed.word).slice(0, config.maxSuggestions)`; non-empty → `publishChain(succ, "")`; forced (`options.force === true`) narrows returned payload to `items[0]` only; empty → `chain.reset()` and normal path answers.
- `publishChain` (provider.ts ~455–485): items `{ value: successorDisplay(s), label: same, description: "chain" }`; `successorDisplay = (s) => store.get(s.next)?.display ?? s.next`; publishes `lastLive = { matches: succ.map(s => ({ key: CHAIN_KEY_PREFIX+s.next, display, description:"chain", salience:-s.count, sessionCount:s.count })), prefix, ts }`; rebuilds `liveKeyByValue` display→CHAIN key. BARE values (no leading space) — pi-tui splices verbatim at prefix "".
- Typed fragment (b): provider.ts ~505–530 — `frag = before.match(/[A-Za-z][A-Za-z0-9_]*$/)`; BUG-005 word-start guard (`fragAt === 0 || /[ \t]/.test(before[fragAt-1])`); membership filter `matchFragment(frag, s.next) !== null` at threshold 0, NO re-sort (successor-count order kept); glue to trigger char ("#b") disqualifies → reset + fall through (trigger mode wins).
- Disqualification (c): reset + fall through, never an empty hapax set.
- Hesitation/intent: fallback display layer `createDisplayProvider` option (index.ts ~320): `isIntentResult: (r) => (config.triggerChar !== "" && r.prefix.startsWith(config.triggerChar)) || r.items.some((i) => i.description === "chain")` — chain offers bypass `firstPaintDelayMs` (menuDelayMs). The 100 ms swap debounce composes via the shared `lastLive` seam; one-shot close-on-space etc. as above.

### widget.ts seams (what the fix must touch)
- `insertHighlighted(inner, state, visibility, config, requestRender?)` (widget.ts ~841): the Tab-accept path — computes `spanLen` via `extractMatchState`/trigger regex/word regex, splices `display` into the line via `inner.setText` + `setCursorCol` caret fix + defensive `onChange`, then `state.hide(); visibility.onDismissed(true); requestRender();`.
- `createVisibilityMachine(deps: VisibilityMachineDeps): VisibilityMachine` (widget.ts ~490). Deps: `store`, `config`, `getEditorState`, `restoreReady`, optional `query?: (fragment, mode) => RankedMatch[]`, `onPaint?`, `isIntentBypass?: () => boolean`, `debounceMs?` (100), `reopenMs?` (200). Rules R1–R7 (widget.ts ~463–487): R1 stock-context hide (classifyStockContext, ~610), R2 startup gate (≤500 ms hold, `settled`/`armGate`), R3 no-fragment → `closeWith(now)` (close-on-space flavor), R4 zero candidates → close, never suppress; suppression release at a NEW word start or trigger mode, R5 hesitation gate code: `if (!intent && !freshReopen && menuDelayMs > 0 && prev !== null && now - prev < menuDelayMs) return state();` where `const intent = match.mode === "trigger" || (deps.isIntentBypass?.() ?? false);` (widget.ts ~700–710), R6 100 ms swap debounce / `parkSwap`, R7 fresh-reopen hysteresis. KEY GAP: `evaluate` short-circuits at R3 — a cursor at an EMPTY word start (`extractMatchState` → null) closes the line; there is no successor query anywhere.
- `decideWidgetKey(data, visible, count, highlightIndex, keybindings?)` (widget.ts ~790): `if (!visible || count <= 0) return { action: "forward" }` — so Tab at zero typed chars returns `{action:"tab-insert"}` whenever the chain offer made the line visible. No changes needed in the decision table itself.
- `WidgetLayerOptions` (widget.ts ~112–131): `inner: EditorFactory; store: CandidateStore; config: HapaxConfig; chain: ChainMachine; restoreReady: Promise<void>; onKeystroke: () => void` — quote: "/** Tab-chain machine — the same instance index.ts resets on before_agent_start (createChainMachine). */ chain: ChainMachine;". The chain instance is ALREADY handed to the widget factory; only unused.
- Introspection seams: `widgetMachineOf`, `widgetStateOf`, `widgetOptsOf`, `WIDGET_WRAPPED` re-bind logic in index.ts:285–305.

### Chain machine public API (src/pi/provider.ts:765–790)
```ts
export interface ChainMachine {
  state(): ChainState;              // { word: string } | null
  arm(word: string): void;          // lowercase key or successor next
  reset(): void;                    // force idle
}
export function createChainMachine(): ChainMachine;
```
State shape: `export type ChainState = { word: string } | null;` (provider.ts ~745). Deliberately dumb — no store, no timers.

## Recommended fix design

Order for a developer with no other context (all names exact):

1. **Arm on widget Tab acceptance** — `src/pi/widget.ts insertHighlighted`: after the successful splice/caret/onChange block and BEFORE/AFTER `state.hide()`+`visibility.onDismissed(true)`, replicate provider.ts's arming classification:
   - `chain` must reach `insertHighlighted` (thread `opts.chain` from `createWidgetEditorFactory` through the `tab-insert` call site, widget.ts ~1165).
   - Gate on `opts.config.enableChaining`.
   - Arm ONLY for whole-word accepts: compute the inserted token's store key the way the provider does. Since the widget has no `liveKeyByValue`, mirror the tier-0 rule with the data it has: the visibility machine knows the current set's RankedMatch records — expose the CURRENT displayed match's key (e.g. extend `VisibilityState.currentSet` entries or the machine to carry `{display, key, tier?}`), lowercase the accepted key, and skip arming on `tier === 0` (anchorless, spec §04 line 215–216: "Successor chaining stays anchored everywhere — tier-0 matches never arm or extend a chain"). A chain-successor accept re-arms at `s.next` (keep a marker analogous to `CHAIN_KEY_PREFIX`, or simply arm at the inserted word's key — equivalent because successor keys are lowercase store keys).
   - `chain.arm(key)` on success; never on path/span-miss forwards.
2. **Offer successors at empty word starts** — `src/pi/widget.ts createVisibilityMachine`: in `evaluate`, insert a chain branch AFTER the R1 stock-context check and BEFORE the R3 `extractMatchState === null → closeWith` short-circuit (also before R2 gate? keep gate AFTER stock check but consider the chain offer gated too — provider path gates on restoreReady, so keep R2 ahead):
   - `const armed = deps.chain?.state();` (add optional `chain: ChainMachine` to `VisibilityMachineDeps`; factory passes `opts.chain`).
   - When armed && `config.enableChaining`:
     - cursor at empty word start (`before === "" || /[ \t]$/.test(before)`) → `store.topSuccessors(armed.word).slice(0, config.maxSuggestions)`; build items `{ display: store.get(s.next)?.display ?? s.next }` in count order; zero successors → `chain.reset()` + fall through to normal R3 close.
     - typed fragment at a word start → same BUG-005 guard + `matchFragment(frag, s.next) !== null` membership filter as provider.ts:505–530 (import `matchFragment` from `../core/query.js`), keep count order, threshold 0 (never call `resolveFuzzThreshold` here).
     - Non-start / glued fragment / disqualification → `chain.reset()` + fall through.
   - Repaint these sets as intent: pass `isIntentBypass: () => chainBranchActive` (or set a local `intent` flag on the chain branch) so R5 hesitation never delays them; paint via the existing `paint(matches, sig, now)` (RankedMatch shims `{key: CHAIN-style marker, display, salience: -count, sessionCount: count}` — provider.ts publishChain is the template). Do NOT run these through the swap-debounce park if the line is currently closed; `paint()` on closed → immediate, which matches "offer … immediately".
3. **One-shot grant + re-arm semantics** — port `chainWordsSeen`/`chainLastArmedPrefix` word-boundary logic from provider.ts:380–420 into the machine (or a small shared helper exported from provider.ts to avoid duplication — preferred; both call sites import it). `insertHighlighted` arming resets the tracker (`seen=0, lastPrefix=null`), exactly like `applyCompletion`.
4. **Update the doc pin** — delete the "CHAIN ARMS: NEVER (plan 004)" paragraph (widget.ts:833–840) and the `WidgetLayerOptions.chain` "read by NO widget code" comment; update the file-header forward-task map.
5. **index.ts** — no changes needed beyond passing nothing new (chain already flows into `WidgetLayerOptions`); confirm the reload re-bind branch keeps it.
6. **Spec** — no amendment strictly required: spec/07:472 already says "Chain offers render on the widget line (or fallback menu) like any result set". Optional clarifying sentence under M2 stating the widget path arms via its Tab-insert (equivalent of applyCompletion) and that chain offers bypass the hesitation gate on both paths — spec/07 h3.10 rule text (R5 "isIntentBypass seam") already covers it. Recommend one clarifying clause: "On the widget path, arming happens at the widget's Tab-insert; successor offers publish through the visibility machine's intent bypass." (Fix session edits spec + code together per AGENTS.md.)

## Tests: must-change vs must-keep-passing

MUST CHANGE (pin the no-arm/no-wiring behavior):
- `test/widget.test.ts:1053–1059` — describe/it "widget Tab acceptance NEVER arms a chain (plan 004 pin)" / "a consumed Tab acceptance with WidgetLayerOptions.chain present never calls chain.arm" — invert into: consumed Tab acceptance of a word candidate CALLS chain.arm with the store key; tier-0 accept does not arm; span-miss forward does not arm.
- Any harness fixtures asserting chain unread (widget.test.ts:107,280,453,723 pass `chain: {} as unknown as ChainMachine` — fine to keep, but tests asserting machine invisibility in visibility tests may need updating once `VisibilityMachineDeps.chain` exists).

MUST KEEP PASSING (fallback path — do not regress):
- `test/chain.test.ts` (all 20+ cases incl. line 260 zero-char offer, 291 every-word-start, 324 one-shot disarm, 356/391 fragment filtering, 405/421 disqualification, 454 successor re-arm one-word insert, 516 reset, 533 trigger-mode arming, 546 debounce composition, 585 one-word invariant; describe at 651 fuzzy membership gate).
- `test/chaining-gating.test.ts` (7 cases: enableChaining:false never arms/never offers, lines 203/254/283; gated-true control at 351; tier-0 never arms at 381).
- `test/provider.test.ts` (30 cases), `test/provider-live.test.ts` (incl. :424–443 armed chain + stock context), `test/provider-display.test.ts`, `test/provider-match.test.ts` — provider path untouched by the fix, but arming-helper extraction (step 3) touches provider.ts internals: re-run all.
- `test/successors.test.ts` (9 cases — store successor index, unchanged).
- `test/index.test.ts`, `test/widget-visibility.test.ts`, `test/acceptance.test.ts`, `test/smoke.test.ts` — visibility machine gains a branch; existing R1–R7 case expectations must not change when chain is idle.

## Spec citations & drift

- `spec/07-completion-ui.md:437–476` — M2 section (quotes above). Line 472 mandates widget-line chain offers → **the current code DRIFTS from spec**; the "CHAIN ARMS: NEVER (plan 004)" comment in widget.ts contradicts spec/07:472 and spec/01 goal 7.
- `spec/07-completion-ui.md:475` — "The chain state resets on every `before_agent_start`" (already honored: index.ts before_agent_start `chain?.reset()`; the widget shares the instance, so free).
- `spec/07-completion-ui.md:476` — "Trigger-char completions also arm the chain (they're whole-word insertions)" — on the widget path, trigger-mode accepts flow through the SAME insertHighlighted span replacement; the fix must arm them too (trigger span consumed ⇒ whole word ⇒ arm).
- `spec/01-goals-and-scope.md:49–50` — goal 7 (quoted).
- `spec/07-completion-ui.md:215–216` (§04 cross-ref) — "tier-0 matches never arm or extend a chain" (drift risk: widget fix must preserve; see provider.ts tier-0 suppression).
- Spec edit needed: minor clarifying clause only (step 6); the binding text already requires the behavior.

## Risks & edge cases

- **Zero-candidate invariant** ("menu never renders with zero candidates", spec invariants): successor set empty → `chain.reset()` + fall through to the normal path — never publish an empty set; `renderWidgetLine` already returns null on zero items, but the reset-on-empty must happen in the machine so the state is honest.
- **Stock-context suppression**: R1 (`classifyStockContext`) must stay AHEAD of the new chain branch, exactly like provider.ts:308 — an armed chain overlapping a `/cmd` or `@mention` must hide/delegate, never offer.
- **Trigger bypass / intent**: chain offers must set the intent flag (bypass R5 hesitation) but should still compose with R6 swap debounce once visible (fallback parity) and R7 hysteresis. Decide deliberately: first chain paint immediate, subsequent swaps debounced (matches fallback's lastLive composition).
- **BUG-003 interaction** (suppression-release semantics will change): the chain branch reads `suppressed` release rules (R4: new word start / trigger mode). A zero-char chain offer IS a new word start — the fix must define whether an armed chain releases explicit-dismissal suppression (fallback: chain offers still show after dismissal at a new word — verify against BUG-003's new semantics before landing; coordinate).
- **Double-arming**: only possible if both paths were ever live for one editor — index.ts guarantees mutual exclusivity (widget branch registers no provider; reload branch re-binds). The shared `chain` instance is fine; but if an editor factory is installed AFTER the fallback provider registered (TOCTOU), both could exist — the provider's `liveKeyByValue`-based arming and the widget's insert-arming would both fire on different events; accepted risk (same TOCTOU tolerance as today), note in fix.
- **One-shot disarm portability**: the word-boundary tracker uses `before`-prefix relation; the widget path's cursor can move by clicks (R7 movedCursor close) — define tracker reset on non-word-start ticks to avoid stuck armed state; `before_agent_start` reset is the backstop.
- **`enableChaining:false`**: every new widget branch must be inert (spec §08 / chaining-gating tests).
- **Forced single-item return** has no widget analog (no pi-tui fast path) — Tab at zero typed chars completes the highlighted item via `decideWidgetKey` "tab-insert", which already works when the line is visible; ensure `renderedCount()` > 0 (fitItems width truncation could hide a too-long successor — acceptable, invariant 3).
