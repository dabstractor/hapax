# PRP — P2.M1.T1.S2: `IngestPipeline.discardPending()` + re-armable startup gate

## Goal

**Feature Goal**: Land the two pipeline/gate primitives of the P2 branch-hygiene milestone (spec 05 "Branch navigation rebuild" step 2 + spec 07 "Startup restore gate" reuse), ahead of the `session_tree` handler that consumes them:

1. **`IngestPipeline.discardPending(): void`** (src/pi/ingest.ts) — drop the armed debounce timer + empty the pending FIFO **without tearing the pipeline down** (dispose's body minus teardown), so a `/tree` branch navigation discards pre-navigation debounce-window texts (spec 05 h2.37 step 2: "discard is always correct: never loses a live word, never double-counts").
2. **Gate re-arm seam** (src/pi/provider.ts `createStartupGate`) — an `arm(newReady)` method that UN-settles an already-settled gate, so the same ≤ 500 ms bounded wait (forced requests included) applies verbatim to the `session_tree` replay window (spec 07 h3.12: "The session_tree branch rebuild (05) reuses this gate verbatim… forced requests included… under the same ≤ 500 ms bound").

**Deliverable**:
1. `discardPending()` in `src/pi/ingest.ts` with Mode A JSDoc (contrast with `dispose()`; `#admitMemo` survival; stats not reset; in-flight-`#drain` contract).
2. `createStartupGate` extended to return `T & StartupGateHandle` where the handle exposes `arm(newReady: Promise<void>): void` — with Mode A JSDoc citing spec 07 h3.12 + spec 05 h2.37 step 4.
3. Test batteries: `test/ingest-pipeline.test.ts` (new `discardPending` describe) and `test/startup-gate.test.ts` (re-arm battery extension) using this repo's fake-timer / deferred-promise idioms.

**Success Definition**: `npm run check` green; `npm test` green with the new batteries passing; no caller wired (the `session_tree` handler is P2.M1.T2.S1 — this item ships the seams it consumes, exactly as P2.M1.T1.S1 ships `store.reset()`); the widget path is untouched (its gate is already re-armable-by-recomposition — see What).

## User Persona (if applicable)

**Target User**: Not an end user — the next work item. P2.M1.T2.S1's `session_tree` handler must, on every `/tree` navigation: guard, `pipeline.discardPending()`, snapshot `ctx.sessionManager.getBranch()`, rebuild in the background (quiesce → `store.reset()` (P2.M1.T1.S1) → replay), and hold every query path until settle. Today it cannot: the pipeline has only `dispose()` (teardown — kills the live pipeline for the REST of the session) and the fallback gate settles once with no way to re-enter the waiting window.

**Use Case**: `/tree` branch switch → dead-branch texts sitting in the 300 ms debounce window are dropped; the fallback provider's gate is re-armed with a fresh restore-ready promise so the first post-`/tree` query waits (≤ 500 ms) behind the replay instead of reading a half-built store.

**Pain Points Addressed**: (a) `dispose()` is session_shutdown teardown — reusing it on `session_tree` would leave the session with no further ingestion; (b) the fallback-path `createStartupGate` settles permanently at startup, so a `session_tree` replay would race ungated queries against an in-place store rebuild (violating h2.37 step 4's "no query can observe the intermediate state").

## Why

- **Spec 05 h2.37 step 2 (binding)**: "Discard the pending ingest queue. Texts in the 300 ms debounce window are from pre-navigation messages; any of them on the new path is re-captured by the snapshot, any other is dead branch — discard is always correct." `discardPending()` IS that step's primitive.
- **Spec 07 h3.12 (binding)**: "The session_tree branch rebuild (05) reuses this gate verbatim: during the replay window every query path — forced requests included — waits under the same ≤ 500 ms bound, and because nothing can observe the store mid-rebuild, the rebuild runs IN-PLACE." The re-arm seam is what makes the SAME gate object (the one permanently registered via `addAutocompleteProvider` — there is no unregister API, architecture/03 §R3) serve the second waiting window.
- **Unblocks P2.M1.T2.S1** (handler) — this is the second of three primitives (sibling P2.M1.T1.S1 ships `CandidateStore.reset()` in parallel; zero file overlap).
- **No spec edit needed**: spec 05 h2.37 and 07 h3.12 are "status: adopted ahead of implementation — code lands with this spec"; this item IS that code landing.

## What

**Part A — `discardPending(): void`** (src/pi/ingest.ts, placed immediately after `dispose()`):
- If `#timer !== null`: `timers.clearTimeout(this.#timer); this.#timer = null;`
- `this.#pending.length = 0;`
- Synchronous, total (no throw paths), no arguments. That is `dispose()`'s exact body — the difference is contract, not code: the pipeline stays LIVE (subsequent `onMessageEnd` calls schedule fresh debounces and drain normally).
- `#admitMemo` SURVIVES (documented, and pinned by test): the memo caches the admission plan per distinct raw token; the plan is pure per raw token (dictionary + rules are session-constant — the dictionary is NOT reloaded on `session_tree`), so replaying the new branch re-hits identical plans. Dropping it would only slow the rebuild.
- `#stats` NOT reset (documented): session-lifetime diagnostics (`getStats()` feeds `/acwords`), not per-branch state.
- In-flight `#drain`: same deliberate non-cancellation as `dispose()` — it completes its CURRENT item and loops out on the emptied queue. **Composition contract (for P2.M1.T2.S1, stated in JSDoc)**: after `discardPending()`, `await flush()` returns only when any in-flight drain has fully drained the (now empty) queue — the handler's background task awaits `flush()` BEFORE `store.reset()` so the in-flight item's upserts land in the old store and are then dropped wholesale; the handler's synchronous work stays sub-millisecond (h2.37 performance note).

**Part B — gate re-arm** (src/pi/provider.ts):
- Export an interface `StartupGateHandle { arm(newReady: Promise<void>): void }` (or inline type) and widen `createStartupGate`'s return to `T & StartupGateHandle`.
- `arm(newReady)`: set `settled = false`; rebind `settledPromise = newReady.then(flipTrue, flipTrue)` (reject also settles — replay errors never wedge the gate, per arming); `void settledPromise` (keep the fire-and-forget attach). `settled` and `settledPromise` become `let` bindings the `getSuggestions` closure reads live.
- Semantics: every `getSuggestions` call that observes `!settled` (forced `options.force` included — current behavior holds ALL calls) races the CURRENT `settledPromise` against a FRESH per-call `setTimeout(maxWaitMs)` — so the ≤ 500 ms bound applies per arming automatically. Each arming settles exactly once (promise semantics; resolve OR reject both flip).
- Callers already in flight when `arm()` fires are not retroactively held: they finish their race (old promise or their own timeout) and query once — the same accepted sub-second startup edge, now also at re-arm (a `/tree` navigation takes seconds; in-flight queries complete in ms).
- **Backward compatible**: existing callers (index.ts fallback path) are untouched — `arm` is additive and the widened return type is a superset. `getSuggestions`'s spread-copy note ("closure-based provider: method refs copy safely") is unchanged; `arm` is a closure over the same state, so the spread carries it.
- **Widget path: NO code change.** The widget's own gate (widget.ts Rule 2: `settled`/`gateDeadline`/`armGate`) is bound to the INJECTED `deps.restoreReady` at composition time; on `session_tree` the widget re-composes around the remembered pre-hapax factory bound to a fresh restoreReady-style promise (spec 07 h2.46 "Branch navigation (2026-10)" rebind) — handler (P2.M1.T2.S1) scope. Do not touch src/pi/widget.ts or src/pi/index.ts in this item.

### Success Criteria

- [ ] `discardPending()` clears an armed timer (no post-discard drain fires) and empties the queue; pipeline stays live (post-discard `onMessageEnd` drains normally)
- [ ] `#admitMemo` survives: re-ingesting the same raw token after `discardPending()` does not re-run the dictionary lookup (pinned via lookup spy)
- [ ] `getStats()` unchanged across `discardPending()` (session-lifetime diagnostics)
- [ ] In-flight drain: only the current item completes; remaining queued items are never processed (pinned with a blocking yieldFn)
- [ ] `createStartupGate(...).arm(newReady)` un-settles a settled gate: new queries (forced included) WAIT again, resolve on `newReady` settle, ≤ 500 ms bound per arming, rejected re-arm never wedges, each arming settles exactly once
- [ ] Existing gate tests pass unchanged (startup window behavior byte-identical); existing ingest tests pass unchanged
- [ ] Mode A JSDoc on both seams citing spec 05 h2.37 (steps 2/4) + 07 h3.12
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this from this PRP alone?" — Yes: both production files' relevant regions are quoted/anchored below with exact line numbers, the semantics of every field the change touches are described, and every test idiom (deferred promises, fake-timer scoping, blocking yieldFn, call-recorder doubles) is cited to the file that already uses it.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: src/pi/ingest.ts
  why: Part A host. Read lines 460-580 minimum (class header JSDoc, fields, onMessageEnd,
        dispose, flush, #drainQueue) + the #admitMemo read/write sites (747, 757-758) + getStats (1032).
  pattern: dispose() at :535-548 is the literal body to reuse; discardPending() is that body
        under a LIVE-pipeline contract. JSDoc style: dense, cites PRD sections inline.
  gotcha: |
    Line numbers here are CURRENT (verified 2026-10); the item description's ":353-363" cites an
    older snapshot — trust the code. #timer is typed `unknown` (host-safe timers module); use
    timers.clearTimeout exactly as dispose does, never global clearTimeout.

- file: src/pi/provider.ts
  why: Part B host. Read lines 770-840 (createStartupGate JSDoc + implementation).
  pattern: settled/settledPromise are closure state read by the gate's getSuggestions —
        converting them to `let` and swapping inside arm() is the whole change; the per-call
        `new Promise(resolve => setTimeout(resolve, maxWaitMs))` already gives each arming its
        own fresh ≤500 ms bound.
  gotcha: |
    Keep `void settledPromise;` on EVERY arming (the fire-and-forget attach is what flips
    `settled` even with no waiter). Keep the reject-flips-settled branch — a rejected replay
    promise must never wedge ANY arming.

- file: test/startup-gate.test.ts
  why: Host for the re-arm battery; source of every idiom needed.
  pattern: |
    deferred() helper (:17-24) for controllable promises; fakeBase() (:27-52) provider double
    with `calls` recorder incl. a ":force" marker; bounded test (:69-88) = vi.useFakeTimers()
    + advanceTimersByTimeAsync(500) + vi.waitFor(..., {timeout:50}); rejected-promise test (:107-117).

- file: test/ingest-pipeline.test.ts
  why: Host for the discardPending battery; source of the pipeline-harness idioms.
  pattern: |
    makePipeline({chunkBytes, onAdmittedTokens, withYieldFn}) (:118-144) with a yields counter;
    drainNow (:159-162) = advanceTimersByTime(300) + flush; userMsg() helper; describe titles
    cite spec sections.
  gotcha: |
    beforeEach fakes ONLY {toFake: ["setTimeout","clearTimeout"]} (:166-172) — never fake
    setImmediate: the drain's yield path uses the real one. For the in-flight-drain test, pass
    a CUSTOM yieldFn that blocks on a deferred you control (makePipeline accepts yieldFn via
    opts only for counting — extend the opts or construct IngestPipeline directly like
    makePipeline does) so you can freeze the drain mid-queue deterministically.

- file: spec/05-ingestion-pipeline.md
  why: "Branch navigation rebuild (session_tree…)" (PRD h2.37) — steps 1-5; step 2 is
        discardPending's contract, step 4's gate sentence is arm()'s reason to exist.
  critical: "status: adopted ahead of implementation — code lands with this spec" — do NOT
        edit the spec; this item is the code landing with it.

- file: spec/07-completion-ui.md
  why: "Startup restore gate" (h3.12) — the final paragraph is the verbatim-reuse rule arm()
        implements ("forced requests included… under the same ≤ 500 ms bound"); "Display
        architecture" (h2.46) "Branch navigation (2026-10)" paragraph explains why the widget
        path needs no change (it re-composes).

- file: plan/006_7bd0258da993/P2M1T1S1/PRP.md
  why: Sibling contract (parallel implementation). CandidateStore.reset() — the in-place
        wholesale drop; confirms ZERO file overlap (store.ts/store.test.ts only) and that the
        composition order discardPending → await flush → reset → replay → gate settle belongs
        to P2.M1.T2.S1, not either primitive.
  gotcha: reset() zeroes the ordinal so replay re-issues 1..N like a fresh /resume — orthogonal
        to the memo (memo is per-raw-token admission PLANS, not store state).

- file: plan/006_7bd0258da993/architecture/03-pi-surfaces-r2-r3-r4.md
  why: §R3 seams — why the fallback gate must be RE-ARMED rather than re-registered
        (addAutocompleteProvider has no unregister API; the registered provider closure is
        permanent for the process).
```

### Current Codebase tree (relevant excerpt)

```bash
src/pi/
  ingest.ts      # IngestPipeline — MODIFY (add discardPending after dispose, ~:549)
  provider.ts    # createStartupGate — MODIFY (arm seam, :799-833) + export StartupGateHandle
  widget.ts      # widget gate — READ ONLY (already re-armable via recomposition)
  index.ts       # consumer wiring — READ ONLY this item (T2.S1 hoists the gate handle)
test/
  ingest-pipeline.test.ts   # MODIFY (append discardPending describe)
  startup-gate.test.ts      # MODIFY (append re-arm cases to the createStartupGate describe)
```

### Desired Codebase tree with files to be added

```bash
# No new files. Two production methods + one exported interface + two test describes:
src/pi/provider.ts      # + export interface StartupGateHandle { arm(newReady: Promise<void>): void }
src/pi/ingest.ts        # + discardPending(): void (after dispose(), ~:549)
test/ingest-pipeline.test.ts  # + describe("discardPending — branch-navigation queue drop (spec 05 h2.37 / P2.M1.T1.S2)")
test/startup-gate.test.ts     # + re-arm cases inside describe("createStartupGate")
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: discardPending() must NOT touch #admitMemo or #stats. The memo is
// token-intrinsic (pure per raw token; dict + rules session-constant — the dictionary
// is NOT reloaded on session_tree), so replaying the new branch re-hits identical
// plans; clearing it would only slow the rebuild. #stats are session-lifetime
// diagnostics feeding /acwords — not branch state.

// CRITICAL: #timer is typed `unknown` and cleared via the `timers` module
// (timers.clearTimeout) — mirror dispose() exactly; do not "type it properly"
// here (host-safety shim, out of scope).

// CRITICAL (gate): `void settledPromise;` must be re-attached on EVERY arm() —
// the fire-and-forget then() is what flips `settled` when no query is waiting.
// Missing it wedges the gate open forever on that arming.

// CRITICAL (gate): keep BOTH then-handlers flipping settled (resolve AND reject).
// A rejected replay/rebuild promise must settle the gate on every arming — the
// existing "replay errors must never wedge the gate" comment covers re-arms too.

// GOTCHA (gate): in-flight waiters at arm() time hold the OLD settledPromise in
// their Promise.race — they finish on the old promise or their own timeout.
// Do NOT try to retroactively hold them; that edge (query racing a /tree
// navigation) is the same accepted sub-second startup window.

// GOTCHA (tests): fake timers ONLY ["setTimeout","clearTimeout"] in
// ingest-pipeline tests — the drain yields via real setImmediate. The bounded
// gate test needs vi.useFakeTimers() + advanceTimersByTimeAsync(500) and must
// restore real timers in finally (copy the existing test's shape exactly).

// GOTCHA (tests): a single small message drains in one slice with no yield —
// you cannot observe "mid-drain" without a custom yieldFn that blocks on a
// deferred you control. Use a multi-slice text (small chunkBytes) + blocking
// yieldFn for the in-flight-drain case.

// GOTCHA: line numbers in the work-item description (":353-363", ":331-345",
// ":793") are from an older snapshot; the anchors in THIS PRP are current.
// Trust the code you read.

// GOTCHA: no linter/formatter exists (package.json: check/test/bench only);
// `npm run check` IS the style gate (tsc --noEmit).
```

## Implementation Blueprint

### Data models and structure

No store/type changes. The only new public surface:

```ts
// src/pi/provider.ts — new exported type (placed just above createStartupGate):
/** Re-arm handle … (JSDoc: spec 07 h3.12 verbatim reuse for session_tree) */
export interface StartupGateHandle {
  arm(newReady: Promise<void>): void;
}
// createStartupGate return type: T & StartupGateHandle
```

State touched (all existing, all private — listed so nothing is missed):

| Location | Field | discardPending / arm effect |
|---|---|---|
| ingest.ts `#timer` (:495) | armed debounce handle | cleared + nulled |
| ingest.ts `#pending` (:494) | FIFO `{text, fromUser}[]` | `length = 0` |
| ingest.ts `#drain` (:499) | in-flight promise | untouched (loops out; quiesce via flush) |
| ingest.ts `#admitMemo` (:491) | per-raw-token plans | SURVIVES (documented) |
| ingest.ts `#stats` (:501) | session diagnostics | SURVIVES (documented) |
| provider.ts `settled` (:802) | bool (→ `let`) | arm(): false |
| provider.ts `settledPromise` (:803) | promise (→ `let`) | arm(): rebound to `newReady.then(flip, flip)` |

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/pi/ingest.ts — add discardPending()
  - IMPLEMENT: `discardPending(): void` — body identical to dispose()'s:
    if (this.#timer !== null) { timers.clearTimeout(this.#timer); this.#timer = null; }
    this.#pending.length = 0;
  - PLACEMENT: immediately after dispose() (~:549), before flush().
  - JSDOC (Mode A) — MUST cover, citing spec 05 "Branch navigation rebuild" (h2.37):
    (a) session_tree step 2 contract: texts in the 300 ms window are pre-navigation;
    on-new-path ones are re-captured by the snapshot replay, others are dead branch —
    "discard is always correct: never loses a live word, never double-counts";
    (b) CONTRAST with dispose(): teardown (session_shutdown — pipeline dead) vs. this
    (live pipeline; the next onMessageEnd schedules a fresh debounce and drains
    normally) — consumed by P2.M1.T2.S1's session_tree handler;
    (c) #admitMemo SURVIVES deliberately: admission plans are pure per raw token
    (dictionary + rules are session-constant; the dictionary is not reloaded on
    session_tree), so replay re-hits identical plans — clearing would only slow
    the rebuild (capped map, ADMIT_MEMO_CAP, never persisted);
    (d) #stats are session-lifetime diagnostics (getStats / /acwords), NOT reset;
    (e) in-flight #drain: deliberately not cancelled (same as dispose) — completes
    its CURRENT item and loops out on the emptied queue; COMPOSITION NOTE for the
    caller: after discardPending(), `await flush()` settles only when the in-flight
    drain finishes — call it in the background rebuild BEFORE store.reset() so the
    straggler's upserts land in the old store and are dropped wholesale (keeps the
    handler's synchronous work sub-millisecond per h2.37's performance note).

Task 2: MODIFY src/pi/provider.ts — the arm() seam
  - EXPORT: `export interface StartupGateHandle { arm(newReady: Promise<void>): void }`
    directly above createStartupGate, with its own JSDoc citing spec 07 h3.12
    ("The session_tree branch rebuild (05) reuses this gate verbatim: during the
    replay window every query path — forced requests included — waits under the
    same ≤ 500 ms bound") and spec 05 h2.37 step 4 (the gate is what makes the
    in-place rebuild unobservable).
  - CHANGE: `let settled = false` (already let-able); hoist the settle handler to a
    shared `const onSettled = () => { settled = true; };`; `let settledPromise =
    ready.then(onSettled, onSettled);` (reject-flips-settled comment preserved —
    now covering every arming).
  - ADD to the gate object: `arm(newReady: Promise<void>): void { settled = false;
    settledPromise = newReady.then(onSettled, onSettled); void settledPromise; }`
    — plus a one-line comment that in-flight racers keep their existing
    (old-promise + own-timeout) race by design.
  - RETURN type: `T & StartupGateHandle`; keep the existing spread `{ ...base, ... }`
    and the "closure-based provider: method refs copy safely" comment.
  - UPDATE createStartupGate's JSDoc: add a paragraph documenting re-arm semantics —
    un-settles; per-call ≤ maxWaitMs bound applies afresh on every arming; forced
    requests wait too during the window only; each arming settles exactly once
    (resolve OR reject); consumed by P2.M1.T2.S1 (session_tree gating = this gate
    verbatim, 07 h3.12).
  - DO NOT touch widget.ts or index.ts (see Integration Points).

Task 3: MODIFY test/ingest-pipeline.test.ts — discardPending battery
  - PLACEMENT: new describe at a logical spot after the debounce describe:
    `describe("discardPending — branch-navigation queue drop (spec 05 h2.37 / P2.M1.T1.S2)", …)`
  - FOLLOW pattern: makePipeline/drainNow/userMsg + the file's fake-timer
    beforeEach (toFake setTimeout/clearTimeout only).
  - CASES:
    1. "drops queued texts and the armed timer — nothing drains": onMessageEnd ×2,
       discardPending(), expect(vi.getTimerCount()).toBe(0), drainNow(h) →
       store.currentOrdinal() === 0, store.get(...) undefined, getStats().wordsSeen
       unchanged from before the push (stats never counted queued text — assert
       equality with the pre-push snapshot).
    2. "pipeline stays LIVE: post-discard messages ingest normally": onMessageEnd,
       discardPending(), then onMessageEnd(userMsg("lwlock")) → drainNow →
       store.get("lwlock") defined, currentOrdinal() === 1 (fresh debounce armed,
       exactly one timer in flight before drain — expect(vi.getTimerCount()).toBe(1)).
    3. "stats survive (session-lifetime diagnostics, not branch state)":
       ingest a message (drainNow), snapshot getStats(), onMessageEnd ×1,
       discardPending(), drainNow → getStats() deep-equals the snapshot (no words
       counted for the discarded text).
    4. "admission memo survives: re-ingesting the same raw token skips the
       dictionary lookup": build a pipeline whose dictionary wraps stubDict's
       lookup in vi.fn (spread `{ ...stubDict(), lookup: vi.fn(stubDict().lookup) }`
       into the Dictionary slot makePipeline takes — construct IngestPipeline
       directly if makePipeline doesn't take a dictionary override). Ingest
       "granite" (drainNow), record lookup call count C, discardPending(),
       re-ingest "granite" (drainNow) → store evidence of the second sighting
       (sessionCount/currentOrdinal advanced) while the lookup count is still C
       (memo hit — the plan is cached per raw token). If the memo's observable
       seam resists this exact staging, pin the equivalent observable (e.g. spy on
       the core admission chain) — the CONTRACT under test is "memo hit on
       re-ingest post-discard", not the spy mechanism.
    5. "an in-flight drain completes only its CURRENT item; the rest of the queue
       is never processed": multi-slice staging — onMessageEnd(longTextA spanning
       ≥2 slices, small chunkBytes), advance 300 (drain starts slice 1, then
       blocks in a CUSTOM yieldFn awaiting a deferred you control), now
       onMessageEnd(userMsg(B)); discardPending(); release the yield gate;
       await flush(); assert A fully ingested (its words present, ordinal advanced
       for A's message) and B absent (store.get(B-word) undefined, ordinal count
       unchanged by B), queue empty (a final drainNow is a no-op).
       Use a yieldFn that awaits a controllable promise — extend makePipeline's
       opts (it already threads yieldFn) rather than duplicating the harness.

Task 4: MODIFY test/startup-gate.test.ts — re-arm battery
  - PLACEMENT: inside the existing `describe("createStartupGate", …)` — new `it`
    cases following its deferred()/fakeBase() idioms.
  - CASES:
    1. "re-arm: a SETTLED gate waits again — forced requests included": settle the
       first ready (resolve + await), one pass-through query (sanity), arm(new
       deferred); fire a normal AND a force:true query → base.calls still [] after
       microtask settles; resolve newReady → both queries complete, base.calls
       equals ["q:ze", "q:ze:force"] (order per call order).
    2. "re-armed wait is BOUNDED again (≤ maxWaitMs per arming)": copy the existing
       bounded test's shape — settle first, arm(never-settling promise), fake
       timers, advanceTimersByTimeAsync(500) → query completes (cap elapsed).
    3. "a REJECTED re-arm promise never wedges the gate": arm(doomed), reject(),
       query completes immediately with base called.
    4. "each arming settles exactly once — sequencing": arm(p1); resolve(p1) →
       pass-through; arm(p2); reject(p2) → pass-through; arm(p3) held → waits →
       resolve(p3) → pass-through. (Promise semantics make once-per-arming
       structural; this pins the OBSERVABLE contract across a chain of armings —
       the h2.37 onSettled-exactly-once-per-arming analog at the gate seam.)
    5. "arm while still unsettled REPLACES the readiness": arm(p1) (unresolved),
       arm(p2); a query waits; resolve(p2) (p1 never resolves) → query completes.
       (Documents the replace-not-queue semantics for the handler's edge where a
       /tree lands during an unfinished startup replay.)
  - TYPE note: the tests exercise `gate.arm` — cast via the widened return type
    (createStartupGate now returns T & StartupGateHandle, so no casts needed for
    the new method; keep existing `as unknown as` casts in fakeBase untouched).

Task 5: VALIDATE (see Validation Loop) — no Task 5 code exists; running gates IS the task.
```

### Implementation Patterns & Key Details

```ts
// ── src/pi/ingest.ts (placed after dispose(), ~:549) ─────────────────────────
/**
 * Drop the pending ingest queue WITHOUT tearing the pipeline down
 * (spec 05 "Branch navigation rebuild", step 2 / P2.M1.T1.S2) …
 * [Full JSDoc content per Task 1: contrast with dispose(); #admitMemo survives
 *  (pure per raw token — dict + rules session-constant, so branch replay re-hits
 *  identical plans); #stats are session-lifetime diagnostics (not reset);
 *  in-flight #drain completes its current item and loops out — callers doing a
 *  reset+replay should `await flush()` in the background task BEFORE store.reset()
 *  so straggler upserts land in the old store; consumed by P2.M1.T2.S1.]
 */
discardPending(): void {
  if (this.#timer !== null) {
    timers.clearTimeout(this.#timer);
    this.#timer = null;
  }
  this.#pending.length = 0;
}

// ── src/pi/provider.ts (inside createStartupGate) ────────────────────────────
export interface StartupGateHandle {
  /** Un-settle the gate with a fresh readiness promise … (spec 07 h3.12). */
  arm(newReady: Promise<void>): void;
}

export function createStartupGate<T extends …>(
  base: T,
  ready: Promise<void>,
  maxWaitMs = 500,
): T & StartupGateHandle {
  let settled = false;
  const onSettled = (): void => {
    settled = true;
  };
  let settledPromise = ready.then(onSettled, onSettled); // reject settles too — every arming
  void settledPromise; // fire-and-forget; getSuggestions re-awaits as needed

  const gate = {
    ...base, // closure-based provider: method refs copy safely
    arm(newReady: Promise<void>): void {
      // Re-arm (07 h3.12 verbatim reuse): un-settle + swap readiness. Waiters
      // already racing keep their existing race (old promise + own ≤maxWaitMs
      // timeout) — bounded by construction.
      settled = false;
      settledPromise = newReady.then(onSettled, onSettled);
      void settledPromise; // CRITICAL: attach on every arming
    },
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      if (!settled) {
        await Promise.race([
          settledPromise, // reads the CURRENT arming's promise
          new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs)),
        ]);
      }
      return base.getSuggestions(lines, cursorLine, cursorCol, options);
    },
  };
  return gate as T & StartupGateHandle;
}
```

### Integration Points

```yaml
NO CALLER WIRING in this item:
  - P2.M1.T2.S1 (session_tree handler) consumes BOTH seams: guard
    (newLeafId === oldLeafId → no-op) → pipeline.discardPending() → snapshot →
    background task [await pipeline.flush() → store.reset() (P2.M1.T1.S1) →
    replay → settle] → fallback path: gate.arm(freshRestoreReady); widget path:
    re-compose around the remembered pre-hapax factory with a fresh
    restoreReady-style promise (its own armGate binds at composition).
  - CONSUMER NOTE (for T2.S1's research, stated here because this PRP owns the
    seam): index.ts currently creates the gate INLINE inside the
    ctx.ui.addAutocompleteProvider callback (:321-333) and does not retain the
    instance — arming requires hoisting a `sessionGate`-style slot the handler
    reads. That hoist is T2.S1's edit; this item's widened return type is what
    makes it type-safe.
  - Widget path (src/pi/widget.ts): UNTOUCHED — its gate is bound to the injected
    restoreReady at composition and re-arms by recomposition (h2.46).
  - Spec: NO edit — 05 h2.37 + 07 h3.12 are adopted ahead of implementation;
    this code lands with the existing spec (Mode A: JSDoc rides with the work).
  - Config: none (§08 surface unchanged).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check        # tsc --noEmit — zero errors. No linter exists; this IS the gate.
# Run after each production edit, before touching tests.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest --run test/startup-gate.test.ts        # 4 existing + 5 new re-arm cases green
npx vitest --run test/ingest-pipeline.test.ts     # existing debounce suites + new describe green
npx vitest --run test/ingest.test.ts test/ingest-restore.test.ts   # adjacent ingest layers unregressed
npx vitest --run test/provider.test.ts test/provider-match.test.ts # gate consumers unregressed
npm test                                          # FULL suite — zero regressions repo-wide
```

Expected: all green. If a re-arm case fails, suspect a missing `void settledPromise` in `arm()` or a stale-closure read of `settledPromise` (the race must read the live `let` binding, which it does by closure — do not cache it in a local).

### Level 3: Integration Testing (System Validation)

Not applicable — no runtime wiring in this item (no event handlers, no index.ts edits). The consumer integration (guarded `/tree` rebuild, live verification per spec 09 h2.61) is P2.M1.T2.S1/S2 scope.

### Level 4: Creative & Domain-Specific Validation

```bash
# Determinism re-run (gate/pipeline behavior must be time-stable):
npx vitest --run test/startup-gate.test.ts test/ingest-pipeline.test.ts && \
npx vitest --run test/startup-gate.test.ts test/ingest-pipeline.test.ts
```

Spec 09's live-TTY rule binds UI-layer changes; this item touches no UI layer (widget.ts untouched), so the unit batteries above are the binding verification.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` — zero errors
- [ ] `npm test` — full suite green (existing startup-gate cases pass UNCHANGED — startup behavior is byte-identical)
- [ ] Determinism: two consecutive runs of both touched test files green

### Feature Validation

- [ ] discardPending: timer cleared + queue emptied + pipeline live + memo survives (lookup-spy pin) + stats survive + in-flight-drain contract pinned (blocking-yieldFn case)
- [ ] arm(): un-settle + wait-again (forced included) + per-arming ≤ 500 ms bound + rejected re-arm never wedges + once-per-arming sequencing + arm-while-unsettled replaces
- [ ] All 5 + 5 test cases from Tasks 3–4 present and passing
- [ ] No caller wired; widget.ts and index.ts untouched

### Code Quality Validation

- [ ] JSDoc on discardPending() cites spec 05 h2.37 steps 2/4, contrasts dispose(), documents memo/stats survival + the flush-before-reset composition note
- [ ] JSDoc on the arm seam (interface + createStartupGate) cites spec 07 h3.12 verbatim-reuse + forced-included + per-arming bound
- [ ] `void settledPromise` attached on construction AND on every arm()
- [ ] Return type widened to `T & StartupGateHandle`; existing callers compile unchanged
- [ ] Test describe titles carry spec citations per repo convention

### Documentation & Deployment

- [ ] Mode A satisfied: documentation rides with the code (JSDoc), nothing else pending for this item
- [ ] No environment variables, no config, no spec edits (spec adopted ahead of this code)

## Anti-Patterns to Avoid

- ❌ Don't "reset" `#admitMemo` or `#stats` in discardPending — the memo is pure per raw token (safe across rebuilds; clearing only slows replay) and stats are session-lifetime diagnostics, not branch state.
- ❌ Don't touch `#drain` in discardPending — the in-flight drain's non-cancellation is deliberate (same as dispose); quiescence is the caller's `await flush()`, not a forced cancel.
- ❌ Don't add a second gate implementation — extend `createStartupGate` (or the equivalent handle on the SAME closure state); a parallel "tree gate" would drift from the startup semantics h3.12 mandates "verbatim".
- ❌ Don't cache `settledPromise` in a local inside `getSuggestions` before the race in a way that snapshots it — the race must see the current arming's binding (it already does by closure; keep it that way).
- ❌ Don't hold or queue old readiness promises in arm() — replace, never accumulate (arm-while-unsettled replaces; in-flight racers keep their own bounded race).
- ❌ Don't rewire index.ts or widget.ts — the consumer hoist is P2.M1.T2.S1's PRP; scope creep here breaks its plan.
- ❌ Don't fake setImmediate in ingest tests — only setTimeout/clearTimeout (the yield path is real; the file's beforeEach comment says exactly this).
- ❌ Don't edit spec/ — 05 h2.37 and 07 h3.12 were adopted ahead of implementation; this item's code lands WITH the existing spec text.
- ❌ Don't wrap discardPending/arm in try/catch — neither has throw paths.

---

**Confidence Score: 9/10** — Both seams are surgical extensions of code read in full at the cited lines (dispose's body is literally reusable; the gate's closure shape makes `let`-swap re-arm structurally sound), every test idiom is quoted from the host files, and the consumer contract (P2.M1.T2.S1 composition order) is documented from both the spec text and the sibling PRP. Residual risk is concentrated in test staging: the in-flight-drain case needs the custom blocking yieldFn and the memo pin needs the lookup spy — both are specified with fallbacks so a staging mismatch degrades to an equivalent observable rather than a blocked implementer.
