# pi Integration Layer Map (scout, plan/002_3e8a42cadf2c)

Targeted at three planned changes: (a) forced single-item branch on `options.force` in `getSuggestions`; (b) chain machine redesign (top successor at zero typed chars, threshold 0, bare item values); (c) config rename `enablePhrases` → `enableChaining` with deprecated alias.

## 1. src/pi/provider.ts (771 lines)

### createHapaxProvider — signature (lines 180–185)
```ts
export function createHapaxProvider(
  store: CandidateStore,
  config: HapaxConfig,
  current: AutocompleteProvider,
  chain: ChainMachine = createChainMachine(),
): HapaxProvider
```
Returns `HapaxProvider = AutocompleteProvider & { __hapaxLive: () => LiveResult | null; __hapaxKey: (value: string) => string | undefined }` (lines 118–131). Per-provider closure state: `lastLive: LiveResult | null` and `liveKeyByValue = new Map<string,string>()` (lines ~187–190).

### getSuggestions control flow — TODAY's exact order (lines 195–349)
1. **Abort check** (197–199): `if (options.signal.aborted) return current.getSuggestions(lines, cursorLine, cursorCol, options);` — the ORIGINAL `options` object is forwarded unchanged on every delegate path. **`options.force` is never read anywhere today.**
2. **Armed/pending chain branch** (239–316): `const armed = chain.state(); if (armed && config.enablePhrases) { ... }`
   - **Pending one-shot offer** (245–290): `chain.consumePending() !== null && before.toLowerCase().endsWith(armed.word)` → unfiltered `store.topSuccessors(armed.word).slice(0, config.maxSuggestions)`; items get **leading-space values** at line 254: `value: ` ${s.next}`` (label clean `s.next`, description `"chain"`); returns `{ items, prefix: "" }`; `lastLive` published with prefix `""`, chain-keyed entries `CHAIN_KEY_PREFIX + s.next` in `liveKeyByValue`.
   - **Fragment path** (292–316): `const frag = before.match(/[A-Za-z][A-Za-z0-9_]*$/)?.[0];` successors filtered by `s.next.startsWith(frag.toLowerCase())` — this is the de-facto "threshold 1" for the chain (extractMatchState deliberately bypassed; fragment must be ≥1 char). If `frag === undefined || succ.length === 0` → `chain.reset()` and fall through to normal path; else items with bare `value: s.next`, `prefix: frag`, chain-keyed live entry, return.
3. **Fragment/match-state detection** (319–322): `const state = extractMatchState(lines, cursorLine, cursorCol, config); if (!state) return current.getSuggestions(...)` — extractMatchState at lines 63–102; trigger mode regex `(?:^|[ \t])<esc>([^\s<esc>]*)$` (79–82), threshold mode `[A-Za-z][A-Za-z0-9_]*$` with `t[0].length >= config.threshold` (89–92), else null → delegate.
4. **Query** (325–334): `rankMatches(store, state.fragment, { limit: config.maxSuggestions })`; zero matches → clear live cache, delegate.
5. **Publish + return** (337–349): `lastLive = { matches, prefix: state.prefix, ts: Date.now() }`; rebuild `liveKeyByValue` (`m.display → m.key`); return `{ items, prefix: state.prefix }`.

**Force branch insertion point:** between step 2's armed block close (line ~317) and step 3's `extractMatchState` call (line 319) — i.e. after the chain block, before fragment detection. Should also presumably clear/delegate considerations: note the chain branch already returned early; a force branch likely needs `lastLive`/`liveKeyByValue` maintenance and possibly its own live-key semantics.

### applyCompletion (lines 351–400)
Gate `if (config.enablePhrases)`. Classifies `liveKeyByValue.get(item.value)`:
1. `key.startsWith(CHAIN_KEY_PREFIX)` → `chain.arm(key.slice(prefix))` (chain successor → armed(next)).
2. `!key.includes(" ")` → `chain.arm(item.value.toLowerCase())` (whole word).
3. else → phrase key → `chain.arm(words[words.length - 1])` (LAST word, BUG-005).
Then delegates verbatim: `return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);` (399). NOTE: leading-space pending values (`" renewable"`) are looked up in `liveKeyByValue` keyed with the same leading space (line ~280: `liveKeyByValue.set(` ${s.next}`, ...)`), and `chain.arm` receives the bare next-word from the CHAIN key. Retiring leading-space values must keep the key/value lookup coherent (also: `chain.arm(item.value.toLowerCase())` at case 2 assumes value == word).

### shouldTriggerFileCompletion (lines 402–404)
`return current.shouldTriggerFileCompletion?.(...) ?? true;`

### ChainMachine (lines 409–498)
```ts
const CHAIN_KEY_PREFIX = "\u0000chain:";              // line 421
export type ChainState = { word: string } | null;     // line 428
export interface ChainMachine {
  state(): ChainState;
  arm(word: string): void;        // sets armed = word AND pending = word
  consumePending(): string | null; // one-shot: returns pending, clears it
  reset(): void;                  // armed = null; pending = null
}
export function createChainMachine(): ChainMachine   // lines 483–498
```
Internal closure: `let armed: string | null = null; let pending: string | null = null;` (484–485). Redesign points: threshold-0-for-chain currently lives in provider.ts's armed branch (fragment regex + bypass of extractMatchState), not in the machine; zero-char top-successor offer currently gated on `consumePending()` adjacency; leading-space values at provider.ts:254 and matching map entries at ~280.

### Display debounce — createDisplayProvider (lines 583–771)
`export function createDisplayProvider(base: AutocompleteProvider & { __hapaxLive: () => LiveResult | null }, opts: DisplayProviderOptions = {})` → `AutocompleteProvider & { dispose: () => void }`. `const debounceMs = opts.debounceMs ?? 100;` (line 587). Mechanism: popup-scheduler state (`displayedSig/Items/Prefix`, `lastPaintAt`, `completionSincePaint`, `pendingSig/Items/Prefix`, `timers` Set). In its `getSuggestions` (669–753): ALWAYS calls `base.getSuggestions` first (never gated — Tab stays instant), classifies hapax via `base.__hapaxLive() !== null && result.prefix === live.prefix`; non-hapax results (delegates, empty) bypass the debounce (reset + pass-through); paint-immediately exceptions: first paint / identical sig, window elapsed (≥debounceMs), `completionSincePaint`, and `result.prefix !== displayedPrefix` (BUG-002). Suppression window only re-serves identical-prefix sets with a scheduled pending swap (`scheduleSwap`/`promotePending`). **All request kinds are inner-queried; only non-empty hapax results enter the debounce.** For redesign (b): the pending offer publishes prefix `""` so `result.prefix === live.prefix` holds and it composes with the debounce.

### config.enablePhrases gating — all reads
- provider.ts:239 (`if (armed && config.enablePhrases)` in getSuggestions), provider.ts:356 area (applyCompletion gate, lines 388–399 comment + `if (config.enablePhrases)`).
- index.ts:180 (`config.enablePhrases ?` wiring of onAdmittedTokens/onSweepPhrases).
- config.ts: interface line 42, default line 51, applyLayer block 197–208.

## 2. src/pi/config.ts (252 lines)

`HapaxConfig` interface (36–45): `triggerChar: string` (default `"#"`), `threshold: number` (1|2|3, default 2), `maxSuggestions: number` (1–20, default 8), `enablePhrases: boolean` (default `true`), `debug: boolean` (default `false`). `DEFAULT_CONFIG` at 47–53.

Load pipeline: `loadConfig(opts: LoadConfigOptions)` at 234–252 — merges `{...DEFAULT_CONFIG}` ← user layer `~/.pi/agent/hapax.json` ← project `.pi/hapax.json` (only if `opts.projectTrusted`), via `readLayer` (99–141: ENOENT silent; unreadable/malformed → discard layer + ONE `notify(msg, "warning")`) and `applyLayer(current, raw, filePath, notify)` (153–224): per-key, present-valid overrides, present-invalid repairs to `current` with one warning per field, unknown keys ignored silently; `validateTriggerChar` (74–76), `clampNumber` (84–86).

**enableChaining insertion point:** `applyLayer` key blocks (parallel to the `"enablePhrases" in raw` block at 197–208). Alias precedence must be resolved per layer inside `applyLayer` (enableChaining wins when both keys present in the same layer; decide behavior when both present across different layers — note later layers already override earlier ones, so simplest: per-layer read enablePhrases into a local, then enableChaining overrides it if present, all stored onto `enableChaining`). Also: HapaxConfig interface, DEFAULT_CONFIG, and optionally a deprecation `notify` when `enablePhrases` is the only key present (one-time is per notify call — existing repair mechanism is per-field-per-layer already).

`LoadConfigOptions` (55–61): `{ cwd, projectTrusted, notify: (msg, "warning") => void, homeDir? }`. `notify` is injected; index.ts maps it to `ctx.ui.notify` — there is no additional one-time-notification mechanism beyond per-call notify.

## 3. src/pi/index.ts (255 lines)

Default export `hapax(pi: ExtensionAPI): void` (128–255); factory-scope slots `store/lazyDict/pipeline/displayProvider/chain/disabled`.
- `pi.on("session_start", ...)` (135–231): `loadConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted(), notify: (m,l) => ctx.ui.notify(m,l) })` (138–142); `const sessionChain = createChainMachine(); chain = sessionChain;` (~160–162); IngestPipeline with `...(config.enablePhrases ? { onAdmittedTokens: ..., onSweepPhrases: ... } : {})` (180–192) — successor index builds ONLY inside `recordPhraseLines` (#bumpSuccessorFor), so the same gate controls successors; provider registration:
  ```ts
  ctx.ui.addAutocompleteProvider((current) => {
    const p = createDisplayProvider(createHapaxProvider(store!, config, current, sessionChain));
    displayProvider = p;
    return p;
  });
  ```
  (197–202). `/acwords`: `if (config.debug) registerAcwordsCommand(pi, { store, pipeline, config });` (207) from `./debug.js`. History restore 209–230.
- `pi.on("message_end", ...)` (233–237): `pipeline.onMessageEnd(event.message)`, never returns a value.
- `pi.on("session_shutdown", ...)` (239–249): `displayProvider?.dispose(); pipeline?.dispose();` then nulls all slots.
- **before_agent_start chain reset** (251–255), quoted:
  ```ts
  pi.on("before_agent_start", () => {
    // New user turn → the chain machine goes idle (P2.M2.T2.S1, PRD §07
    // h2.43). Still no return value: pi would treat a result as a reply.
    chain?.reset();
  });
  ```
Also exports `resolveDictPath` re-export (49) and `createLazyDictionary(path, onLoadError)` (69–124) with sticky `failed` flag.

## 4. src/pi/paths.ts (45 lines)

NOT path-completion detection — jiti-safe dictionary path resolution. `resolveDictPath()` (39–45): `HAPAX_DICT` env override, else dual `__dirname` / `import.meta.url` pattern to `<repo>/dict/common-en.bin`. No edits expected here.

## Cross-cutting notes / risks for the three changes
- (a) force branch: no existing `options.force` read; delegate paths forward the original `options` object (identity preserved), so pi's own provider also sees `force` — decide whether force branch replaces hapax-only behavior or must also avoid delegating.
- (b) redesign: extractMatchState bypass already exists in armed branch; threshold-0-for-chain means the fragment regex `/[A-Za-z][A-Za-z0-9_]*$/` currently returns undefined at zero chars — that's the word-less disarm trigger and the reason `consumePending`/adjacency exists. Tests pinned: `test/chain.test.ts` case (8) (word-less first query must disarm+delegate) may not be modified per comment at provider.ts ~265; check it before redesigning zero-char offers. Leading-space values appear at provider.ts:254 (+ matching `liveKeyByValue.set(" "+next, ...)` ~280, and applyCompletion case 2 does `chain.arm(item.value.toLowerCase())` assuming bare value).
- (c) rename: update provider.ts gates (239, ~390), index.ts (180), config.ts interface/default/applyLayer, plus any docs/comments referencing `enablePhrases`; keep successor-index gating coherent (it rides the same flag).