# pi surfaces — R2/R3/R4 scout report (baseline 6d8f158)

## Verified anchor table

| Task anchor | Actual | Status |
|---|---|---|
| provider.ts:436 chain consult (armed branch) | `store.get(s.next)?.display ?? s.next` at **:436** inside `successorDisplay`; zero-char offer arm `:462-474`; publishChain `:438-458` | ✅ exact |
| provider.ts:515 exact-equal exclusion | `s.next !== frag.toLowerCase()` at **:511** (comment cites §07 h2.49) | ⚠️ drift −4 (filter block :503-519) |
| provider.ts:535 close-on-space (no-fragment) | comment block starts **:528** ("1.8 CLOSE-ON-SPACE"); actual null-return/return-null site is further down in the 1.8 block (~:528-560) | ⚠️ ~−7 |
| provider.ts:793 createStartupGate | `export function createStartupGate` at **:793** | ✅ exact |
| widget.ts:655-670 chainShim | `const chainShim = (s: Successor): RankedMatch` at **:655-665** | ✅ exact |
| widget.ts:894 exact-equal exclusion | filter at **:894** (`s.next !== frag.toLowerCase()`) | ✅ exact |
| widget.ts:951-952 close-on-space | `if (match === null) { closeWith(now); … }` at **:951-957** | ✅ exact |
| editor.ts:112 isShowingAutocomplete | guard at **:111-115** inside `createEnterSubmitEditor`'s `handleInput` (function starts :98) | ✅ exact |
| ingest.ts:354 dispose | `dispose(): void` at **:353-363** | ⚠️ −1 |
| ingest.ts:711-745 restoreFromHistory | `export function restoreFromHistory` at **:711-763** | ✅ (extends to 763) |
| debug.ts:74/:120/:203 | popup sections ~:60-80; `/tmp/hapax-store.txt` dump **:118-127**; successor sample **:195-210** | ⚠️ minor drift |
| index.ts session_tree handler | **None exists** — only `session_start` (:153), `message_end` (:398), `session_shutdown` (:404), `before_agent_start` (:414) | ✅ confirmed absent |

## pi extension API (node_modules/@earendil-works/pi-coding-agent, ~0.84.4; pi-tui ~0.84.4)

Types live in `dist/core/extensions/types.d.ts` (re-exported from `dist/core/extensions/index.d.ts` and `dist/core/index.d.ts`).

```ts
// types.d.ts:505-512
/** Fired after navigating in the session tree */
export interface SessionTreeEvent {
    type: "session_tree";
    newLeafId: string | null;
    oldLeafId: string | null;
    summaryEntry?: BranchSummaryEntry;
    fromExtension?: boolean;
}
export type SessionEvent = SessionStartEvent | SessionInfoChangedEvent | SessionBeforeSwitchEvent
  | SessionBeforeForkEvent | SessionBeforeCompactEvent | SessionCompactEvent
  | SessionCompactFailedEvent | SessionShutdownEvent | SessionBeforeTreeEvent | SessionTreeEvent;
```

Registration (types.d.ts:918, on the ExtensionAPI `on` overload set):
```ts
on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): void;
```
There is also a **pre-event**: `session_before_tree` (`SessionBeforeTreeEvent { preparation: TreePreparation; signal: AbortSignal }`) — NOT needed for R3's post-navigation rebuild, but note it exists.

`addAutocompleteProvider` (types.d.ts:137, on ExtensionUIContext):
```ts
addAutocompleteProvider(factory: AutocompleteProviderFactory): void;
```

`ctx.sessionManager: ReadonlySessionManager` (types.d.ts:219) = `Pick<SessionManager, "getCwd"|"getSessionDir"|"getSessionId"|"getSessionFile"|"getLeafId"|"getLeafEntry"|"getEntry"|"getLabel"|"getBranch"|"buildContextEntries"|"getHeader"|"getEntries"|"getTree"|"getSessionName">` (`dist/core/session-manager.d.ts:140`). `getBranch(fromId?: string): SessionEntry[]` at session-manager.d.ts:261.

## R2 surfaces

### provider.ts armed branch (fallback path)
- `createHapaxProvider(store, config, current, chain)` at :266; store accepted, never constructed (:246). `successorDisplay` :436 (`store.get(s.next)?.display ?? s.next` — most-recent-casing-wins display, eviction falls back to lowercase key).
- Zero-typed-char offer **(a)** :462-474 — `before === "" || /[ \t]$/.test(before)` → `store.topSuccessors(armed.word)` count-desc, `publishChain(succ, "")` bare values at prefix `""`; forced returns single item from the FULL published set.
- Fragment arm **(b)** :501-529 — word-start guard (BUG-005) + membership filter with exact-equal exclusion at **:511** + `matchFragment(frag, s.next) !== null`, no re-sort.
- Close-on-space **1.8** starts :528.
- R2 "The " uppercase-arming does NOT exist yet: arming today comes only from `applyCompletion` accepts (provider) and widget Tab acceptance. New rule (uppercase first letter + lowercase key has series successors on space-close) needs insertion at both the 1.8 close-on-space branch (provider) and widget `closeWith`/close-on-space site (:951) — a direct `store.topSuccessors(key)` consult on the just-typed word.

### widget.ts chain surfaces
- `chainShim` :655-665 — `key: s.next` (plain store key → tab-insert re-arms for free), display from store entry, no `tier` (undefined arms), `salience: -s.count`.
- Zero-char offer arm above :880 (same `before === "" || /\s$/` shape); exact-equal exclusion :894.
- R2 series-first ordering: today successors and ordinary words never mix in one menu (chain branch either paints or falls through to the normal `query()` path at :961+). R2 needs the zero-char offer to combine series items THEN ordinary (both count-desc) in one set — the paint composition at :904-930 (`items = succ.map(chainShim)`) is the merge site; the normal path fills `matches` via `query(match.fragment, …)` :961.

## R3 seams (session_tree reaction)

### Event registration today
`src/pi/index.ts` head :1-45 documents the event table. Handlers: `pi.on("session_start", (event, ctx) => …)` :153; `pi.on("message_end", …)` :398; `pi.on("session_shutdown", …)` :404; `pi.on("before_agent_start", …)` :414. API is `pi.on(event, handler)` where `pi: ExtensionAPI`. **No `session_tree` handler.**

### session_start fresh-deps core (:153-340)
Per session_start: `loadConfig` → `new CandidateStore()` (bound to local `sessionStore`, also assigned to nullable `store` slot) → `createChainMachine()` → `createLineClaim()` (`claim = sessionClaim`, :150/:177) → `createLazyDictionary` → `new IngestPipeline({store, dictionary, rejectCommonness, isDisabled: () => disabled, onAdmittedTokens?…})` → `restoreReady` promise + `markReady` (:227-230) → shared `inputClock`/`tickInputClock` → dual-path display branch:
- PRIMARY (:256-274): `ctx.ui.getEditorComponent?.()` returns a foreign factory → `ctx.ui.setEditorComponent?.(createWidgetEditorFactory({inner: editorFactory, store: sessionStore, config, chain: sessionChain, claim: sessionClaim, restoreReady, onKeystroke}))`. No provider registered; `displayProvider = null`.
- RELOAD/rebind (:275-308): our wrapper already installed → re-wrap the remembered `widgetOptsOf(editorFactory)?.inner` in a FRESH composition with THIS session's deps. **This is the "re-compose around the remembered pre-hapax factory" precedent R3 reuses.**
- FALLBACK (:309+): `ctx.ui.addAutocompleteProvider((current) => { const p = createDisplayProvider(createStartupGate(createHapaxProvider(store!, config, current, sessionChain), restoreReady), {firstPaintDelayMs, getPreviousKeystrokeAt, isIntentResult}); displayProvider = p; return p; })`.
- History restore :374-390: probe `ctx.sessionManager.getBranch()/getEntries()`; `restoreFromHistory(pipeline, ctx.sessionManager, () => disabled, markReady)` else `markReady()`.
- `/acwords`: `if (config.debug) registerAcwordsCommand(pi, {store, pipeline, config})` :367.

### Startup-gate pattern (provider.ts:757-824)
`createStartupGate(base, ready, maxWaitMs = 500)`: wraps only `getSuggestions` — if `!settled`, `await Promise.race([settledPromise, setTimeout(maxWaitMs)])`, then delegate. `ready.then` flips `settled` on resolve OR reject (replay errors never wedge the gate). Forced (`options.force`) requests wait too (bounded). Spread `{...base}` copies closure-based provider method refs safely. **Rebind note**: the fallback provider closes over `store!` (nullable slot read at factory-call time, inside `addAutocompleteProvider` callback) — a session_tree rebuild that reassigns the module slots would be picked up only by a NEW registration; there is no unregister API, so R3's in-place rebuild should keep the SAME provider instance reading the SAME (rebuilt-in-place) store, or re-read pipeline via the closure. Widget path: `restoreReady` is injected per composition; widget's own gate is `settled/gateDeadline/gateTimer` + `armGate` (widget.ts :668-673, :955-958) — hold queries until settle or 500 ms bound, wake re-evaluates.

### ingest.ts seams
- Debounce fields: `#pending` FIFO, `#timer`, `#drain`, `#debounceMs` (300). `onMessageEnd` :331-345 pushes + restarts trailing timer. `dispose()` :353-363 clears timer + empties `#pending`, leaves `#drain` running (deliberate). **A `discardPending()` seam** = exactly dispose's body minus teardown of the pipeline itself (timer clear + `#pending.length = 0`); consider whether to also let in-flight `#drain` finish (it loops on the now-empty queue and exits) — safe.
- `restoreFromHistory(pipeline: Pick<IngestPipeline,"processText">, sessionManager, shouldAbort?, onSettled?)` :711-763: reads `sessionManager.getBranch()` synchronously, copies + reverses, async loop calls `pipeline.processText(text, role==="user")` per message entry, `onSettled` fires EXACTLY once in `finally` (end/abort/throw). **It does NOT reset the store or successor index** — it only adds through the normal ingest chain. An in-place R3 rebuild therefore needs: discard pending → clear/replace the store contents + successor index (CandidateStore has no reset API today; either construct a fresh CandidateStore and swap the slot the pipeline/factory read — but the pipeline holds `#store` privately — or rebuild a fresh IngestPipeline around the existing store field pattern used in session_start) → replay via `restoreFromHistory(newPipeline, ctx.sessionManager, …, onSettled)`. Cleanest in-place path mirroring session_start: build a fresh `IngestPipeline` + fresh `CandidateStore` with identical options and rebind module slots + fresh composition (same as the reload branch). Note `IngestPipeline` constructor options include `rejectCommonness` and `isDisabled` closures that must be rebuilt from current `config`/`disabled`.

### Claim release
`claim` is a module slot; `claim?.release()` at `before_agent_start` :422 and `claim = null` on shutdown :411; the widget key layer calls `claim.release()` on submit key (widget.ts :1597-1607). R3's reaction should `claim?.release()` and either reuse or re-create via `createLineClaim()` alongside the rebind.

## R4 deferral insertion points

- **editor.ts:98-115 `createEnterSubmitEditor`**: precedent guard — `isSubmitKey(data, kb) && innerAny.isShowingAutocomplete?.() === true && !String(innerAny.autocompletePrefix ?? "").startsWith("/")` → `cancelAutocomplete()`. The introspection to reuse: `isShowingAutocomplete` (typed optional `(() => boolean) | undefined`), plus `autocompletePrefix`.
- **widget.ts `widgetHandleInput` :1592+**: after the submit-key claim release (:1597-1607) and BEFORE `decideWidgetKey` (or immediately before the `decision.action === "tab-insert"` branch at :1688): if `matchesKey(data, "tab")` and `innerRecord.isShowingAutocomplete?.() === true` → `return forwardInput(data)` (verbatim forward; pi's stock menu accepts). Pre-check placement options:
  1. Top of `widgetHandleInput`, before the claim release/decision — simplest, but also bypasses submit-key semantics (Tab isn't a submit key, so no conflict).
  2. Just before the `tab-insert` handling (:1688) — after `decideWidgetKey` returns tab-insert, forward instead of insert. This keeps decideWidgetKey PURE (it takes only data/visible/count/index/interacted/keybindings — no editor state; purity convention documented at :1180-1195). **Recommended: option 2**, matching the convention that editor-state checks live in the wiring (the enter-submit guard lives in the handleInput wrapper, not decideWidgetKey).
- `decideWidgetKey(data, visible, count, highlightIndex, interacted, keybindings?)` :1194 — pure decision table (rows documented :1180-1193). Keep it untouched.

## chain-grant.ts (context, unchanged)
One-shot grant tracker shared by both display paths: provider armed branch and widget chain branch tick it per word boundary; every arm site calls `reset()` beside `chain.arm()`. Per-owner instances (never module-level). Exactly one word per acceptance; disarming at next boundary without acceptance.

## debug.ts /acwords surfaces
- Popup sections: header (`size / STORE_CAP (ordinal)`, rank-group histogram) ~:60-65; top-N rows (display ×count group label) :68-79; ingest stats :83-91.
- `/tmp/hapax-store.txt` dump :118-127: TSV `key\tdisplay\tx<count>\tg<group>[\tproper][\ttyped]`, sorted sessionCount desc.
- Successor sample :195-210: for sampled top words, `display → next ×count, …` via `store.topSuccessors(c.key)`.
R2's series-first rule may want the successor sample extended (e.g. run casing) — out of scope here.

## Drift notes / risks
- provider.ts:515→:511 and :535→:528; ingest dispose :354→:353; debug :74/:120/:203 approximate (±6). All anchors re-verified above.
- **No unregister for addAutocompleteProvider** — fallback-path R3 must rebuild in place (same provider closure reading same store slot) rather than re-register; `createHapaxProvider` closes over `store` param captured at factory time inside the callback, which reads the nullable module slot `store!` — a slot reassign would NOT be seen by an already-registered provider. In-place store mutation or full re-registration (leaks the old one) are the only fallback options; the widget path has no such issue (fresh composition replaces the wrapper).
- `CandidateStore` has no reset/clear — in-place rebuild via fresh store instance + pipeline is the established pattern (session_start / reload branch).
- `session_tree` handler must guard `newLeafId === oldLeafId` (both `string | null`) and read `ctx.sessionManager.getBranch()` for the snapshot; `fromExtension`/`summaryEntry` fields exist but are not needed.
- pi-tui types were not separately grepped for session_tree (event lives in the coding-agent package); no pi-tui surface needed for R3.
