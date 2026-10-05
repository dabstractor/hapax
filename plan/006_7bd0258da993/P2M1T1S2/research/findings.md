# Research findings — P2.M1.T1.S2 (discardPending + re-armable startup gate)

Verified against live code (2026-10; line numbers current, differ from the
item description's older snapshot):

## IngestPipeline (src/pi/ingest.ts, 1155 lines)

- Class at :472. Fields: `#admitMemo` :491 (Map, cap ADMIT_MEMO_CAP = 65_536 at
  :221, clear-on-full), `#pending: {text, fromUser}[]` :494, `#timer` :495,
  `#drain: Promise<void>|null` :499, `#stats` :501 (wordsSeen/admitted/
  rejectedByGate). `#debounceMs ?? 300` at :509.
- `onMessageEnd` :522-533: extractText null→return; push FIFO; clear+restart
  timer; timer fire → start `#drainQueue()` only if `#drain === null`.
- `dispose()` :535-548 (JSDoc :535): clears timer + `#pending.length = 0`.
  Teardown for session_shutdown. In-flight #drain NOT cancelled — loops out
  on emptied queue. **discardPending = this body, non-teardown.**
- `flush()` :550-561: clears timer; starts drain if pending; awaits #drain.
  Key consumer seam: after discardPending() (queue empty), `await flush()`
  awaits ONLY an in-flight drain → quiescence before reset+replay.
- `#drainQueue` :567-580: while shift(); per-item try/catch; finally
  `#drain = null`.
- Admission memo read at :747 (`#admitMemo.get(token.raw)`), write :757-758.
  Plan is pure per raw token (dict+rules session-constant) → survives a
  branch rebuild with identical results. Stats applied per OCCURRENCE
  (#replayAdmitMemo) → stats can't pin the memo; a dictionary.lookup spy can
  (memo hit skips the expand→shape→admit chain).
- `getStats()` :1032.

## createStartupGate (src/pi/provider.ts:799-833)

- Signature :799-801: `createStartupGate<T extends AutocompleteProvider &
  {__hapaxLive; __hapaxKey}>(base: T, ready: Promise<void>, maxWaitMs=500): T`
- `let settled = false` :802; `settledPromise = ready.then(flip, flip)` :803-810
  (reject also flips — errors never wedge); `void settledPromise` :811.
- Gate :813-832: `{...base, async getSuggestions(...) { if (!settled)
  await Promise.race([settledPromise, setTimeout(maxWaitMs)]); return
  base.getSuggestions(...) }}`. **ALL calls wait incl. options.force** (force
  only passes through to base). Per-CALL timeout — the ≤500 ms bound is
  automatic per arming once settledPromise is swapped.
- No re-arm today: `settled` is captured by the getSuggestions closure —
  re-arm = flip it false + swap settledPromise; closure reads the live
  `settledPromise` binding, so a `let` swap works.

## Widget gate (src/pi/widget.ts) — NO CHANGES this item

- `GATE_MAX_WAIT_MS = 500` :526; Rule-2 state `settled/gateDeadline/gateTimer`
  :676-679; `armGate(now)` :756-764 (arms once, deadline + wake timer);
  `deps.restoreReady.then(settle+wakeEvaluate, settle)` :764-770; gate holds
  at :847-850 and :962-967. Widget gate binds the INJECTED restoreReady
  (WidgetDeps :179-180, :450-454). On session_tree the widget re-composes
  (h2.46 rebind) with a fresh restoreReady — handler (P2.M1.T2.S1) scope.

## index.ts consumption (:227-336)

- `restoreReady` deferred per session_start :234-236 (markReady resolved by
  restoreFromHistory onSettled). Widget path passes restoreReady into
  createWidgetEditorFactory :270, :305. Fallback path :321-333:
  `createStartupGate(createHapaxProvider(store!, ...), restoreReady)` INSIDE
  the `ctx.ui.addAutocompleteProvider` callback — the gate instance is not
  retained today; T2.S1 must hoist a handle to call arm(). No index.ts edit
  in this item (seam is additive; consumer wiring is T2.S1).

## Test conventions

- test/startup-gate.test.ts (151 lines): `deferred()` :17-24; `fakeBase()`
  :27-52 (calls recorder, `q:${lines[0]}${o.force ? ":force" : ""}` marker,
  casts to AutocompleteProvider + __hapax introspection pair); bounded test
  :69-88 uses `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(500)` +
  `vi.waitFor(..., {timeout: 50})`; rejected-replay test :107-117;
  restoreFromHistory onSettled exactly-once describe :119-151.
- test/ingest-pipeline.test.ts: `stubDict()` :94-114 (lookup fn over COMMON/
  MIDFREQ sets); `makePipeline({chunkBytes, onAdmittedTokens, withYieldFn})`
  :118-144 (yields counter); `drainNow` :159-162 (advance 300 + flush);
  beforeEach fakes ONLY ["setTimeout","clearTimeout"] :166-172 (never fake
  setImmediate — the yield path is real); `userMsg()` helper; UNIT string
  :146-148.

## Sibling coordination (parallel P2.M1.T1.S1)

- Sibling modifies src/core/store.ts + test/store.test.ts only (adds
  reset()). Zero file overlap with this item (src/pi/ingest.ts,
  src/pi/provider.ts, test/ingest-pipeline.test.ts, test/startup-gate.test.ts).
- Consumer P2.M1.T2.S1 composes: session_tree → guard → pipeline.discardPending()
  → snapshot refs → background task: await flush() (quiesce in-flight drain)
  → store.reset() → replay → gate.arm/settle. Sync handler work stays sub-ms
  (h2.37 performance note).

## Commands (verified)

- `npm run check` = tsc --noEmit. No linter/formatter in package.json.
- `npx vitest --run test/<file>` per-file; `npm test` full suite.
