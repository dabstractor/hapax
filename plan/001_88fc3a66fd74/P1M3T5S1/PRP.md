# PRP — P1.M3.T5.S1: Extension factory — lifecycle wiring, lazy dict, disable-on-bad-dict

## Goal

**Feature Goal**: Replace the `src/pi/index.ts` stub with the complete hapax
extension factory: registers ONLY `pi.on` handlers
(`session_start` / `message_end` / `session_shutdown` / `before_agent_start`
stub); on `session_start` it loads config, lazily constructs the dictionary
(first-use, with permanent disable + error notify on load failure), creates
the CandidateStore + IngestPipeline, wraps pi's autocomplete provider,
registers `/acwords` when `debug: true`, and kicks background history
restore; on `message_end` it feeds the pipeline (returning undefined ALWAYS);
on `session_shutdown` it tears everything down including all pending timers.
PRD §02 h2.13, h2.12, h2.10.

**Deliverable**: REWRITTEN `src/pi/index.ts` (factory + lazy-dictionary helper
+ dict-path seam) + small ADDITIVE `dispose()` on `IngestPipeline` in
`src/pi/ingest.ts` + NEW `test/index.test.ts`.

**Success Definition**: `npm run check` clean; full `npm test` green including
the new suite; factory body contains only `pi.on(...)` registrations (no I/O,
no timers); message_end handler provably returns `undefined`; dictionary
failure produces exactly one `ctx.ui.notify(..., "error")` and permanently
disables ingestion.

## User Persona

**Target User**: pi users with hapax installed (via `.pi/extensions/hapax`).
**Use Case**: start pi (any reason), type messages, get vocabulary
autocomplete; dictionary corruption must degrade to silent no-op + one error
notify, never a crash.
**User Journey**: pi boots → session_start(startup) → hapax restores store
from history in background → messages flow → completions appear → pi quits →
session_shutdown drops everything.
**Pain Points Addressed**: previously hapax was a stub; this wires the whole
M1 vertical into the real extension lifecycle.

## Why

- This is the M1 assembly point: every completed module (config T1, ingest
  T2, provider T3, debug T4) is inert until the factory wires them.
- Integration acceptance (P1.M4.T1.S1) exercises exactly this wiring; local
  dev-load + jiti-safe dict path verification is the sibling task
  P1.M3.T5.S2 — do NOT do manifest/dev-load verification here.

## What

```ts
export default function hapax(pi: ExtensionAPI): void
```

Factory registers four handlers and nothing else (no timers, no I/O, no
constructors — PRD §02: everything deferred to session_start).

**session_start(event, ctx)**:
1. If disabled flag set (prior dict failure in this extension runtime) → return.
2. `loadConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted(),
   notify: (m, l) => ctx.ui.notify(m, l) })`.
3. Create `lazyDict = createLazyDictionary(resolveDictPath())` (loads on
   first `lookup`; on throw → `ctx.ui.notify("hapax: dictionary failed to
   load", "error")` + set permanent disabled flag).
4. `store = new CandidateStore()`; `pipeline = new IngestPipeline({ store,
   dictionary: lazyDict })`.
5. `displayProvider = createDisplayProvider(
     createHapaxProvider(store, config, current))` passed as the factory to
   `ctx.ui.addAutocompleteProvider(current => ...)`.
6. If `config.debug` → `registerAcwordsCommand(pi, { store, pipeline,
   config })` (from `../pi/debug.js`, T4 contract).
7. History check: obtain entries via try/catch around
   `ctx.sessionManager.getBranch()` (fallback `getEntries()`). If
   `event.reason !== "new"` OR history is non-empty →
   `restoreFromHistory(pipeline, ctx.sessionManager)` (fire-and-forget;
   it is itself a no-op on empty history — the pre-check just honors the
   "fresh store only for new+empty" contract explicitly).

**message_end(event)**: if disabled or no pipeline → return; else
`pipeline.onMessageEnd(event.message)`; **return undefined ALWAYS** (pi may
replace the message from the result — hapax never must).

**session_shutdown()**: `displayProvider?.dispose()` (popup-scheduler
timers), `pipeline?.dispose()` (debounce timer — added in Task 2), then null
out `store`/`lazyDict`/`pipeline`/`displayProvider`. Nothing to persist.

**before_agent_start**: registered as an explicit no-op stub with a comment
naming P2.M2.T2.S1 (chain-reset machine).

Compaction events: intentionally NOT registered — the store survives
compaction (PRD §05 h2.32).

### Success Criteria

- [ ] Factory body: only `pi.on` calls; zero I/O/timers at import time
- [ ] message_end handler returns `undefined` in every path (no `{ message }`)
- [ ] Dictionary loads lazily on first lookup; failure → one error notify +
      permanent disable; subsequent message_end calls are no-ops
- [ ] session_shutdown clears debounce + popup timers and drops references
- [ ] `/acwords` registered only when `config.debug`
- [ ] `npm run check` + full `npm test` green

## All Needed Context

### Context Completeness Check

The implementing agent gets the exact pi event/context types (verified below),
the exact signatures of every consumed internal module, and the two seams
this task owns (lazy dict, dict path). No other knowledge needed.

### Documentation & References

```yaml
- file: node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
  why: VERIFIED API — ExtensionAPI.on overloads (session_start ~L909,
    session_shutdown ~L916, before_agent_start ~L923, message_end ~L933);
    SessionStartEvent.reason "startup"|"reload"|"new"|"resume"|"fork" (~L416);
    SessionShutdownEvent (~L479); MessageEndEvent { message } (~L604);
    ExtensionContext { ui, cwd, sessionManager, isProjectTrusted() } (~L209);
    addAutocompleteProvider on the UI context (L137: factory
    (current: AutocompleteProvider) => AutocompleteProvider).
  critical: handler return type for message_end is
    Promise<MessageEndEventResult | void> | MessageEndEventResult | void —
    returning a non-void result can REPLACE the user's message. Return nothing.
  gotcha: notify levels are "info" | "warning" | "error" only.

- url: ~/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
  section: extension lifecycle / event handlers
  why: factory contract — the factory must not start background resources;
    everything defers to session_start (PRD §02 h2.13 mirrors this).

- file: src/pi/config.ts
  why: loadConfig({ cwd, projectTrusted, notify: (msg, "warning") => void,
    homeDir? }): HapaxConfig. notify is warning-level only — bind as
    (m, l) => ctx.ui.notify(m, l) so the literal type matches.

- file: src/pi/ingest.ts
  why: IngestPipeline({ store, dictionary }); onMessageEnd(message): void
    (sync); restoreFromHistory(pipeline, sessionManager) fire-and-forget;
    RestoreSessionManager { getBranch, getEntries }. Dictionary interface
    consumed by pipeline = { lookup(word): number|null; version; entryCount }
    from src/core/dictionary.ts — the lazy wrapper must satisfy exactly this.
  gotcha: IngestPipeline currently has NO dispose — Task 2 adds it.

- file: src/pi/provider.ts
  why: createHapaxProvider(store, config, current): HapaxProvider;
    createDisplayProvider(base): { ...AutocompleteProvider, dispose(): void }
    — dispose() clears the popup-scheduler timers. Wire as
    ctx.ui.addAutocompleteProvider(current => createDisplayProvider(
      createHapaxProvider(store, config, current))).

- file: src/pi/debug.ts   (P1.M3.T4.S1 — being implemented in parallel)
  why: registerAcwordsCommand(pi, { store, pipeline, config }) — call only
    when config.debug. Treat the PRP contract as truth; the export exists
    (or will) exactly in that shape.

- file: src/core/dictionary.ts
  why: loadDictionary(path: string): Dictionary — synchronous, throws on
    invalid magic/version. This is the ONLY load surface; the lazy wrapper
    calls it exactly once, inside a try/catch, on first lookup.

- file: src/core/store.ts
  why: new CandidateStore() — no-arg constructor.

- file: test/ingest-restore.test.ts + test/provider-live.test.ts
  why: test conventions — vitest, ESM ".js" import suffixes, injected fakes
    for pi context objects.

- file: plan/001_88fc3a66fd74/P1M3T5S1/research/notes.md
  why: verified API line references + design decisions.
```

### Current Codebase tree (relevant)

```
src/pi/index.ts        # STUB — this task rewrites it
src/pi/config.ts       # complete
src/pi/ingest.ts       # complete (this task adds dispose())
src/pi/provider.ts     # complete (T3.S1–S3; S4 tests in flight — do not touch)
src/pi/debug.ts        # from T4 (parallel)
src/core/*             # complete
package.json           # already has pi manifest → ./src/pi/index.ts
```

### Desired additions

```
src/pi/index.ts        # REWRITE — factory + createLazyDictionary + resolveDictPath
src/pi/ingest.ts       # ADD dispose(): clears #timer, empties #pending
test/index.test.ts     # NEW — factory wiring tests with fake pi + fake ctx
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: message_end result may REPLACE the message — handler must
//   return undefined in every code path (never `return pipeline.onMessageEnd(...)`
//   — that method returns void, but be explicit anyway).
// CRITICAL: the factory must not load config, touch fs, or arm timers —
//   only pi.on registrations. Reload re-runs the factory cleanly.
// GOTCHA: addAutocompleteProvider is on ctx.ui, called per session_start —
//   re-registration on reload is acceptable (fresh session, fresh provider).
// GOTCHA: lazy Dictionary must expose `version` and `entryCount` as getters
//   (before load they can be 0; pipeline only uses lookup()).
// GOTCHA: dict-load failure disables INGESTION permanently, but the (empty)
//   provider stays registered — zero candidates → delegation (never-hijack,
//   PRD §07) — no unregister API exists.
// GOTCHA: ESM ".js" import suffixes on ALL relative imports.
// GOTCHA: session_start may fire again after shutdown-reload within the same
//   runtime: all mutable state (store/dict/pipeline/provider/disabled) must
//   live in factory-scope closure variables re-initialized per session_start.
// GOTCHA: resolveDictPath() is PROVISIONAL here (jiti-safe resolution is
//   P1.M3.T5.S2). Keep it as a single isolated exported seam.
```

## Implementation Blueprint

### Module shape (src/pi/index.ts)

```ts
/**
 * hapax extension entry (PRD §02 h2.13, P1.M3.T5.S1): the ONLY module pi
 * loads. Factory registers pi.on handlers exclusively; all real work is
 * deferred to session_start. ...
 */
import type { ExtensionAPI, AutocompleteProvider } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { IngestPipeline, restoreFromHistory } from "./ingest.js";
import { createHapaxProvider, createDisplayProvider } from "./provider.js";
import { registerAcwordsCommand } from "./debug.js";
import { loadDictionary, type Dictionary } from "../core/dictionary.js";
import { CandidateStore } from "../core/store.js";

export function resolveDictPath(): string; // provisional; P1.M3.T5.S2 makes it jiti-safe
export function createLazyDictionary(
  path: string,
  onLoadError: () => void,
): Dictionary; // lazy + failure-sticky (lookup→null after failure)

export default function hapax(pi: ExtensionAPI): void;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD dispose() to IngestPipeline (src/pi/ingest.ts)
  - IMPLEMENT: dispose(): void — clearTimeout(this.#timer), #timer=null,
    this.#pending.length = 0. Do NOT cancel an in-flight #drain (harmless:
    queue empty → loop exits; comment this).
  - KEEP additive only: no signature/behavior changes elsewhere.
  - DOC: extend the class doc-comment naming P1.M3.T5.S1 shutdown wiring.

Task 2: CREATE the factory core (src/pi/index.ts REWRITE)
  - IMPLEMENT createLazyDictionary(path, onLoadError): satisfies Dictionary;
    private state { dict: Dictionary | null; failed: boolean }. lookup():
    if failed → null; if !dict → try loadDictionary(path) catch { failed =
    true; onLoadError(); return null; }; then dict.lookup(word).
    version/entryCount getters → dict?.version ?? 0 / ?? 0.
  - IMPLEMENT resolveDictPath(): provisional — candidate list tried at
    FIRST USE (inside createLazyDictionary call site is fine to defer to
    lookup): e.g. process.env.HAPAX_DICT, then "dict/common-en.bin"
    resolved against the extension root via fileURLToPath(new URL(...)).
    Mark clearly: `// PROVISIONAL — jiti-safe resolution lands in P1.M3.T5.S2`.
  - IMPLEMENT default hapax(pi): factory-scope state vars (store, lazyDict,
    pipeline, displayProvider, disabled — all initially null/false); register:
    - pi.on("session_start", (event, ctx) => {...}) per "What" section;
      wrap sessionManager history probe in try/catch.
    - pi.on("message_end", (event) => { if (!disabled && pipeline)
        pipeline.onMessageEnd(event.message); /* return undefined */ });
    - pi.on("session_shutdown", () => { displayProvider?.dispose();
        pipeline?.dispose(); null out all refs; });
    - pi.on("before_agent_start", () => { /* no-op in M1 — chain reset is
        P2.M2.T2.S1 */ });
  - NAMING: hapax (default export), createLazyDictionary, resolveDictPath.
  - GOTCHA: notify binding for loadConfig: (m, l) => ctx.ui.notify(m, l).

Task 3: CREATE test/index.test.ts
  - FAKES: fake pi = { on: vi.fn(), registerCommand: vi.fn() } capturing
    handlers by event name; fake ctx = { ui: { notify: vi.fn(),
    addAutocompleteProvider: vi.fn(f => f(currentFake)) }, cwd: "/w",
    isProjectTrusted: () => true, sessionManager: { getBranch: () => [],
    getEntries: () => [] } }; currentFake = minimal AutocompleteProvider stub
    (copy shape from test/provider-live.test.ts). Inject dict path via a
    temp file (reuse test/helpers/dict-writer.ts for a VALID packed dict and
    a corrupted buffer for failure cases); resolveDictPath seam must accept
    an override (module-level test hook or parameter) — prefer passing the
    path into createLazyDictionary so tests exercise it directly.
  - CASES:
    - factory registers exactly the 4 events; nothing else; no I/O at call
      time (no notify, no addAutocompleteProvider before session_start)
    - session_start: loadConfig called with cwd + trusted + bound notify;
      addAutocompleteProvider called with a function that, given current,
      returns a disposable provider; debug:false → registerCommand never
      called; debug:true → called with "acwords"
    - session_start with empty history + reason "new" → restore NOT invoked
      (assert via sessionManager fake spy counts); reason "resume" with
      entries → restoreFromHistory path taken (store gains candidates after
      microtask flush, using a valid temp dict)
    - lazy dict: no dictionary file read until first message_end; valid dict
      → candidate lands in store after pipeline flush
    - disable-on-bad-dict: corrupted file → exactly ONE notify(..., "error")
      containing "hapax: dictionary"; subsequent message_end → no throw,
      store stays empty; disabled permanently across further events
    - message_end handler returns undefined in all paths (await handler and
      assert result === undefined)
    - session_shutdown: dispose called on provider (spy) and pipeline;
      handlers no-op afterwards
    - shutdown → session_start again (reload cycle) → fresh state works
  - CONVENTIONS: ESM ".js" imports, module doc-comment, describe/it naming.

Task 4: VERIFY wiring compiles against real types
  - npm run check — the ExtensionAPI/ExtensionContext imports must come from
    "@earendil-works/pi-coding-agent" (type-only import is fine and matches
    the no-runtime-pi-deps rule for src/pi wiring already used by debug.ts).
```

### Implementation Patterns & Key Details

```ts
// Factory pattern (keep ALL state in one closure)
export default function hapax(pi: ExtensionAPI): void {
  let store: CandidateStore | null = null;
  let pipeline: IngestPipeline | null = null;
  let displayProvider: { dispose(): void } | null = null;
  let disabled = false;

  pi.on("session_start", (event, ctx) => {
    if (disabled) return;
    const config = loadConfig({
      cwd: ctx.cwd,
      projectTrusted: ctx.isProjectTrusted(),
      notify: (m, l) => ctx.ui.notify(m, l),
    });
    store = new CandidateStore();
    const lazyDict = createLazyDictionary(resolveDictPath(), () => {
      ctx.ui.notify("hapax: dictionary failed to load", "error");
      disabled = true; // permanent for this runtime
    });
    pipeline = new IngestPipeline({ store, dictionary: lazyDict });
    ctx.ui.addAutocompleteProvider((current) => {
      const p = createDisplayProvider(
        createHapaxProvider(store!, config, current));
      displayProvider = p;
      return p;
    });
    if (config.debug) registerAcwordsCommand(pi, { store, pipeline, config });
    let hasHistory = false;
    try {
      hasHistory = ctx.sessionManager.getBranch().length > 0
        || ctx.sessionManager.getEntries().length > 0;
    } catch { /* treat as empty */ }
    if (event.reason !== "new" || hasHistory)
      restoreFromHistory(pipeline, ctx.sessionManager);
  });

  pi.on("message_end", (event) => {
    if (!disabled && pipeline) pipeline.onMessageEnd(event.message);
    // NEVER return a value — pi may replace the message otherwise.
  });

  pi.on("session_shutdown", () => {
    displayProvider?.dispose();
    pipeline?.dispose();
    displayProvider = null; pipeline = null; store = null;
  });

  pi.on("before_agent_start", () => { /* no-op M1; P2.M2.T2.S1 */ });
}
```

### Integration Points

```yaml
MANIFEST: package.json "pi": { "extensions": ["./src/pi/index.ts"] } already
  correct — DO NOT touch package.json (manifest verification is P1.M3.T5.S2).
DICT PATH: resolveDictPath() is the single seam P1.M3.T5.S2 replaces.
NO changes to: src/pi/provider.ts, src/pi/config.ts, src/core/*, existing
  tests (except additive dispose() in ingest.ts).
DOWNSTREAM: P1.M4.T1.S1 integration acceptance exercises exactly this wiring.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors, including new test file
```

### Level 2: Unit Tests

```bash
npm test -- test/index.test.ts   # new suite green
npm test                          # full suite green (no regressions)
```

### Level 3: Integration (smoke only — full dev-load is P1.M3.T5.S2)

```bash
# Not scriptable here without a live pi; the unit fakes are the proxy.
# Sibling task P1.M3.T5.S2 performs: symlink into .pi/extensions + run pi.
```

## Final Validation Checklist

- [ ] `npm run check` clean; full `npm test` green
- [ ] Factory registers only the 4 pi.on handlers; zero side effects at factory call
- [ ] message_end returns undefined in every path
- [ ] Lazy dictionary: loads on first lookup; bad dict → one "error" notify + permanent disable + no crash
- [ ] session_shutdown disposes popup + debounce timers, nulls references
- [ ] /acwords registered only when debug:true; restore gated per contract
- [ ] resolveDictPath isolated as single seam marked PROVISIONAL (S2)
- [ ] Only files touched: src/pi/index.ts (rewrite), src/pi/ingest.ts (additive dispose), test/index.test.ts (new)
- [ ] ESM ".js" import suffixes; module doc-comments

## Anti-Patterns to Avoid

- ❌ Don't return anything from the message_end handler — pi may replace the message
- ❌ Don't load the dictionary eagerly or at factory time
- ❌ Don't do manifest/dev-load work — that's P1.M3.T5.S2
- ❌ Don't register compaction handlers — store survives compaction by design
- ❌ Don't unregister or tear down the autocomplete provider on disable — empty store + delegation is the designed degradation
- ❌ Don't catch-all broadly; specific try/catch around loadDictionary and sessionManager probes only

## Confidence Score

9/10 — all pi event/context signatures verified against installed ~0.84.4
types; every consumed internal export read in full; only soft spot is the
provisional dict-path seam, which is deliberately delegated to S2.