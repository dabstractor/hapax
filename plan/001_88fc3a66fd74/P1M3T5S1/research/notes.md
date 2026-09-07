# Research notes — P1.M3.T5.S1 (extension factory wiring)

## Verified pi API (node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts, ~0.84.4)

- `export default function (pi: ExtensionAPI): void` — factory signature.
- `ExtensionAPI.on(event, handler)` overloads: `session_start` (~909),
  `session_shutdown` (~916), `before_agent_start` (~923),
  `message_end` (~933). Handlers are
  `ExtensionHandler<E, R> = (event, ctx: ExtensionContext) => Promise<R|void> | R | void`.
- `SessionStartEvent { type, reason: "startup"|"reload"|"new"|"resume"|"fork",
  previousSessionFile? }` (~416).
- `SessionShutdownEvent { type, reason: "quit"|"reload"|"new"|"resume"|"fork" }` (~479).
- `MessageEndEvent { type, message: AgentMessage }` (~604). Result type
  `MessageEndEventResult` may replace the message — hapax handlers MUST
  return undefined/void.
- `ExtensionContext` (~209): `ui: ExtensionUIContext`, `cwd: string`,
  `sessionManager: ReadonlySessionManager`, `isProjectTrusted(): boolean`,
  `mode`, `hasUI`, etc.
- `addAutocompleteProvider(factory: (current) => AutocompleteProvider)` lives
  on the UI context (line 137); item contract: `ctx.ui.addAutocompleteProvider`.
- notify levels: "info" | "warning" | "error" (no "warn").

## Repo state (read in full)

- `src/pi/index.ts` — stub, `export default function hapax(_pi) {}`. This task fills it.
- `src/pi/config.ts` — `loadConfig(opts: { cwd, projectTrusted, notify:
  (msg, "warning") => void, homeDir? }): HapaxConfig`; `HapaxConfig.debug`.
- `src/pi/ingest.ts` — `IngestPipeline(options: { store, dictionary,
  debounceMs?, chunkBytes?, yieldFn?, onAdmittedTokens? })`;
  `onMessageEnd(message): void` (sync); `flush()`; `processText()`;
  `getStats()`. **NO dispose/cancel method exists** — debounce timer is
  private; this task adds a small additive `dispose()` to IngestPipeline
  to satisfy "clear pending timers" on shutdown.
- `restoreFromHistory(pipeline, sessionManager: { getBranch, getEntries })`
  — reason-independent, fire-and-forget, no-op on empty history.
- `src/pi/provider.ts` — `createHapaxProvider(store, config, current)` →
  HapaxProvider (has __hapaxLive/__hapaxKey); `createDisplayProvider(base,
  opts)` → `{ ...AutocompleteProvider, dispose(): void }` — dispose clears
  popup-scheduler timers (S3).
- `src/core/dictionary.ts` — `loadDictionary(path: string): Dictionary`
  (sync, readFileSync, throws on bad magic/version).
- `src/core/store.ts` — `new CandidateStore()` no-arg constructor.
- `src/pi/debug.ts` (P1.M3.T4.S1 contract): `registerAcwordsCommand(pi,
  { store, pipeline, config })` — wire when config.debug, after loadConfig.
- package.json already has `pi.extensions: ["./src/pi/index.ts"]` manifest.

## Key design decisions

1. **Lazy dictionary**: IngestPipeline needs a Dictionary at construction,
   but PRD wants lazy load. Solution: a module-private
   `createLazyDictionary(path)` returning `{ lookup, get version, get
   entryCount }` that materializes via loadDictionary on first lookup and,
   on throw, notifies + sets a permanent `disabled` flag owned by the
   factory (subsequent lookups return null; factory gates message_end).
   Empty store ⇒ provider delegates (zero candidates) ⇒ clean disable.
2. **Dict path**: jiti-safe resolution is P1.M3.T5.S2's deliverable. This
   task isolates path resolution into one exported seam
   (`resolveDictPath()`, provisional candidates list) so S2 swaps only that.
3. **Shutdown**: drop store/dict/pipeline refs, call `displayProvider.dispose()`
   (popup timers) and `pipeline.dispose()` (debounce timer — additive method
   this task adds to ingest.ts). Nothing persisted (PRD §02).
4. **session_start reason handling**: 'new' with empty history → fresh store
   only (no restore); anything else → restoreFromHistory (which is itself a
   no-op on empty history, but we pre-check to honor contract).
   Compaction events intentionally NOT handled (store survives compaction).
5. **before_agent_start**: registered as no-op stub (M2 chain reset is
   P2.M2.T2.S1).
6. Factory body must contain ONLY `pi.on(...)` registrations — no timers, no
   I/O (PRD §02: everything deferred to session_start).

## Tests conventions
vitest, ESM ".js" relative import suffixes, module doc-comment headers,
describe/it; existing suites test pi-adapter modules with injected fakes
(see test/ingest-restore.test.ts, test/provider-live.test.ts).