# PRP — P1.M3.T1.S2: Abort restoreFromHistory replay on dictionary failure

## Goal

**Feature Goal**: Close the second half of BUG-004. `restoreFromHistory`
(src/pi/ingest.ts ≈L417–446) is a fire-and-forget `void (async () => {...})()`
loop that calls `await pipeline.processText(text, fromUser)` per message entry
with **no abort check**. Even with the per-segment disable gate from
P1.M3.T1.S1 in place, the replay loop itself keeps churning through every
history entry doing no-op `processText` calls. This task adds an explicit
**abort contract**: restoreFromHistory accepts an optional
`shouldAbort?: () => boolean` predicate, checks it at the top of the per-entry
loop, and stops the replay entirely the moment it returns true. The factory
(`src/pi/index.ts` session_start) wires it to the sticky `disabled` flag.
Net effect: on a resumed session with a missing/corrupt dictionary, the
replay admits **ZERO** candidates — not even the triggering message's words —
while the existing notify-once behavior is untouched.

**Deliverable**:
1. Modified `src/pi/ingest.ts` — `restoreFromHistory` gains an optional third
   parameter `shouldAbort?: () => boolean`, checked at the top of the replay
   loop, plus JSDoc documenting the abort contract (Mode A docs).
2. Modified `src/pi/index.ts` — the session_start `restoreFromHistory(...)`
   call site passes `() => disabled`.
3. New tests in `test/ingest-restore.test.ts` — including one that uses a
   **real** `IngestPipeline` + `createLazyDictionary("/nonexistent/...")`
   (per the work-item instruction: mock nothing) proving zero admissions.

**Success Definition**: With a nonexistent dict path and a fake session
manager holding 2+ prose messages, after `settle()`: `store.size === 0` and
`rankMatches(store, "with") === []` (strictly zero — the S1 per-segment gate
prevents even the first message's words). The `hapax: dictionary failed to
load` notify fires exactly once (unchanged, owned by createLazyDictionary /
onLoadError wiring). All existing restore tests still pass with default
(no-predicate) calls. `npm run check` and `npm test` green.

## Why

- BUG-004 (Major, PRD §03 loader contract): "the extension surfaces a notify
  and **disables itself** rather than running with a bad table." The factory's
  `disabled` flag only gates `message_end`. On `session_start` the lazy dict
  has not loaded yet, so `disabled` is still false when the replay kicks off;
  without an in-loop abort check the replay keeps running after the failure
  flips the flag. Verified by probe (see PRD §09 / bug hunt): replaying two
  prose messages with `/nonexistent/common-en.bin` stored `with`, `that`,
  etc., and `rankMatches(store, 'with')` returned `[{display:'with'}]`.
- The S1 gate (PRD contract, assume landed) makes each `processText` a no-op
  once `isDisabled()` is true — the abort predicate is about **stopping the
  loop** (no wasted work, no ordinals issued, clean early exit) and making
  the contract explicit and testable at the replay level.
- Output is consumed by P1.M5.T1.S2 (adversarial ingest-path probes:
  "bad-dict restore") — keep the abort observable via store emptiness, not
  via internal counters.

## What

### Behavior contract

1. **Signature** (minimal-signature option, consistent with the existing
   `Pick<IngestPipeline, "processText">` style — keep the Pick unchanged):
   ```ts
   export function restoreFromHistory(
     pipeline: Pick<IngestPipeline, "processText">,
     sessionManager: RestoreSessionManager,
     shouldAbort?: () => boolean,
   ): void
   ```
   Optional → every existing two-arg call (all of test/ingest-restore.test.ts)
   compiles and behaves identically.

2. **Abort check placement**: at the TOP of the per-entry loop, before the
   `entry.type !== "message"` filter (cheapest place; skipping non-message
   entries is pointless once aborted):
   ```ts
   for (const entry of ordered) {
     if (shouldAbort?.()) return; // hard stop — dictionary died mid-replay
     if (entry.type !== "message") continue;
     ...
   }
   ```
   The in-flight first message is stopped by the S1 per-segment gate inside
   `#admitSegment`; this loop-level check stops all subsequent messages.

3. **JSDoc (Mode A)** — extend restoreFromHistory's doc-comment with an
   "Abort contract" paragraph: optional `shouldAbort` is polled before each
   entry; once true the replay returns immediately and no further entries
   are processed; combined with the pipeline's `isDisabled` per-segment gate
   (S1) a dictionary failure observed mid-replay yields a fully empty store;
   notify-once behavior lives in createLazyDictionary/onLoadError and is
   untouched by this contract.

4. **Factory wiring** (`src/pi/index.ts` ≈L212):
   ```ts
   restoreFromHistory(pipeline, ctx.sessionManager, () => disabled);
   ```
   The `disabled` closure variable already exists in the factory; `onLoadError`
   sets it true exactly once. Note: a closure over the variable (not its
   value at session_start) is REQUIRED — the flag flips during the replay.

5. **Notify-once preserved**: do NOT touch createLazyDictionary, onLoadError,
   or the notify call. The only failure signal surface is the existing
   `ctx.ui.notify("hapax: dictionary failed to load", "error")` + `disabled =
   true` in onLoadError.

6. **README**: no change here — restore/disable docs ride with P1.M5.T2.S1
   (final changeset sweep).

## All Needed Context

### Documentation & References

```yaml
- file: src/pi/ingest.ts
  why: restoreFromHistory (≈L417–446) — the loop to gate; RestoreSessionManager
        interface and safeEntries helper sit directly above; note the
        fire-and-forget void async pattern and per-entry try/catch-continue
  pattern: add shouldAbort to the signature + top-of-loop check + JSDoc
  gotcha: abort must RETURN (exit the async IIFE), not `continue` — continue
          would keep scanning entries; also do not throw (fire-and-forget
          must never surface an unhandled rejection)

- file: src/pi/index.ts
  why: session_start handler (≈L199–214) with the existing
        restoreFromHistory(pipeline, ctx.sessionManager) call site (≈L212);
        the `disabled` closure flag (set in onLoadError, ≈L147–150);
        createLazyDictionary (≈L79–112) — exported, reused in tests
  pattern: pass `() => disabled` (closure over the live flag)
  gotcha: `disabled` is captured by closure and flips DURING the replay;
          never pass `disabled` by value

- file: test/ingest-restore.test.ts
  why: THE test home; already provides fakeSm(opts) / fakePipeline() /
        settle(probe) = vi.waitFor, msgEntry/userMsg/assistantMsg fixtures
  pattern: describe/it, vi.fn() doubles, NodeNext .js imports from
        "../src/pi/ingest.js"; new bad-dict test imports createLazyDictionary
        from "../src/pi/index.js", CandidateStore + rankMatches from core
  gotcha: the real-pipeline test must drive entries through the pipeline's
          debounce/queue — settle() with vi.waitFor until store reads settle;
          use settle(() => expect(...)) on store emptiness OR a generous
          probe; processText is awaited per entry so a fixed probe on
          store.size===0 after waitFor of notify firing works

- file: src/pi/ingest.ts (IngestPipeline / IngestPipelineOptions ≈L101–169)
  why: S1 contract adds `isDisabled?: () => boolean` option checked in
        processText and #admitSegment — this is what makes the in-flight
        first message store nothing; rely on it, do not duplicate gating here

- file: src/core/store.ts, src/core/query.ts
  why: CandidateStore (size, get) and rankMatches(store, prefix) for the
        zero-admission assertions

- file: test/ingest-pipeline.test.ts
  why: house pattern for constructing a real IngestPipeline with injected
        store/dictionary stubs (options shape: store, dictionary, plus S1's
        isDisabled)

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M3T1S1/PRP.md
  why: CONTRACT for the S1 seam this task consumes — Dictionary.failed probe,
        createLazyDictionary failed getter, IngestPipeline isDisabled option,
        factory wiring `isDisabled: () => disabled`
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: Dictionary.lookup NEVER throws (contract) — a failed load
// returns null forever. The abort signal is the `disabled` flag /
// `shouldAbort()` predicate, never an exception.
// CRITICAL: at session_start the lazy dict has NOT loaded yet; `disabled`
// flips to true DURING the replay (first lookup triggers the load which
// throws). The predicate must be a closure over the live flag.
// CRITICAL: relative imports need .js extensions (NodeNext: "../src/pi/ingest.js").
// CRITICAL: restoreFromHistory must remain synchronous-void
// fire-and-forget; abort is a `return` inside the async IIFE, not a throw.
// restoreFromHistory takes Pick<IngestPipeline, "processText"> — keep the
// Pick narrow; the shouldAbort predicate is the minimal-signature option
// (do NOT widen the Pick just for the gate).
// Test with a REAL IngestPipeline + createLazyDictionary("/nonexistent/...")
// and prose messages — mock nothing (work-item instruction). Assert
// STRICTLY zero: store.size === 0 AND rankMatches(store,'with') === [].
// notify fires exactly once — assert via the onLoadError callback passed
// to createLazyDictionary (count invocations with vi.fn()).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/pi/ingest.ts — signature + abort + JSDoc
  - ADD optional third param `shouldAbort?: () => boolean` to
    restoreFromHistory
  - ADD top-of-loop check `if (shouldAbort?.()) return;` before the
    type filter, with a one-line BUG-004 comment
  - EXTEND the function's doc-comment with the abort-contract paragraph
    (see "What" §3)
  - PRESERVE: synchronous void return, per-entry try/catch-continue,
    copy-before-reverse, safeEntries fallback

Task 2: MODIFY src/pi/index.ts — factory wiring
  - CHANGE the session_start call to
    `restoreFromHistory(pipeline, ctx.sessionManager, () => disabled);`
    with a one-line comment (BUG-004: abort replay once the dict fails)
  - TOUCH NOTHING ELSE (notify-once, onLoadError, message_end gate are
    already correct)

Task 3: CREATE/EXTEND tests in test/ingest-restore.test.ts
  - ADD describe("restoreFromHistory — dictionary-failure abort (BUG-004)"):
    a) predicate unit tests with fakePipeline/fakeSm:
       - shouldAbort true from entry 2 on (mutable boolean flipped after
         first processText resolves) → only 1 processText call
       - shouldAbort absent → all entries replay (regression guard;
         existing tests already cover, one explicit case ok)
       - abort before ANY entry (predicate true immediately) → zero calls
    b) REAL-pipeline test (mock nothing):
       - import { createLazyDictionary } from "../src/pi/index.js"
       - import { CandidateStore } from "../src/core/store.js",
         rankMatches from "../src/core/query.js", IngestPipeline from
         "../src/pi/ingest.js"
       - const onError = vi.fn(); const dict =
         createLazyDictionary("/nonexistent/hapax-test-dict.bin", onError)
       - const store = new CandidateStore(); const pipeline = new
         IngestPipeline({ store, dictionary: dict, isDisabled: () =>
         dict.failed === true })   // mirrors the S1 factory wiring
       - let aborted = 0; sm = fakeSm({ branch: [msgEntry(...) prose with
         'with this that them', ... x2, leaf→root order] })
       - restoreFromHistory(pipeline, sm, () => dict.failed === true)
       - await settle(() => { expect(onError).toHaveBeenCalledTimes(1); })
         then await settle(() => expect(/* replay done */ pipe? not
         available — instead probe a settled condition, e.g. wait 2 ticks
         or waitFor(() => expect(store.size).toBe(0)) — since admissions
         are async-drained, poll until onError fired and a few macrotasks
         passed; the assertion is ZERO, which is stable once the load
         failed)
       - ASSERT: store.size === 0; store.get("with") === undefined;
         rankMatches(store, "with") === []; onError exactly once
  - NAMING: test fns descriptive ("aborts replay when the predicate flips
    mid-replay", "bad dictionary: replays ZERO candidates and notifies once")
  - PATTERN: follow existing fixtures (msgEntry/userMsg/prose strings,
    NodeNext .js imports)

Task 4: VALIDATE
  - npm run check && npm test
```

### Implementation Patterns & Key Details

```ts
// The gated loop (src/pi/ingest.ts) — minimal diff:
void (async () => {
  for (const entry of ordered) {
    if (shouldAbort?.()) return; // BUG-004: dict failed → stop replay cold
    if (entry.type !== "message") continue;
    try {
      const text = extractText(entry.message);
      if (text === null) continue;
      await pipeline.processText(text, entry.message.role === "user");
    } catch {
      continue;
    }
  }
})();

// Factory wiring (src/pi/index.ts session_start):
restoreFromHistory(pipeline, ctx.sessionManager, () => disabled);
// GOTCHA: closure over the LIVE `disabled` variable — it flips during the
// replay when the lazy load throws on first lookup. `() => disabled` works
// because `disabled` is a `let` in the factory scope.
```

### Integration Points

```yaml
CODE (no config / routes / migrations — extension internal only):
  - src/pi/ingest.ts: restoreFromHistory signature + loop + JSDoc
  - src/pi/index.ts: session_start call site gains third arg
DOWNSTREAM:
  - P1.M5.T1.S2 (ingest-path probes) will construct the same
    real-pipeline bad-dict scenario; keep the zero-admission property
    strictly pinned (store.size === 0, rankMatches === [])
  - P1.M3.T2.S1 (sweepPhrases at restore tail) lands in the same loop
    area — keep this diff minimal and localized so it doesn't conflict
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
# Expected: clean. Fix any type errors before proceeding.
```

### Level 2: Unit Tests

```bash
npm test -- test/ingest-restore.test.ts
# Expected: all existing ordering/filtering/error-containment tests pass
# (default no-predicate calls unchanged) AND the new abort describe block
# passes, including the real-pipeline bad-dict zero-admission test.

npm test
# Expected: full suite green (no regressions elsewhere; S1 tests from the
# parallel task may also be present and must not conflict).
```

### Level 3: Contract verification (manual reasoning / probe)

```bash
# The real-pipeline test IS the Level 3 check (bad dict path → zero
# candidates, one notify). Optionally sanity-run the extension:
# 1. Temporarily point resolveDictPath() at a nonexistent file, resume a
#    session with history in pi, confirm: one error toast, no completion
#    menus ever appear (empty store → provider delegates).
```

### Level 4: Adversarial (owned by P1.M5.T1.S2 — do not build here)

- Bad-dict restore probe is formalized there; this task only guarantees the
  property holds at the restoreFromHistory level.

## Final Validation Checklist

- [ ] `npm run check` clean
- [ ] `npm test` fully green
- [ ] New tests: predicate flips mid-replay → replay stops; immediate abort → zero calls; absent predicate → unchanged behavior
- [ ] Real-pipeline test: `/nonexistent` dict + prose history → `store.size === 0`, `rankMatches(store, "with") === []`, notify exactly once
- [ ] All existing two-arg `restoreFromHistory` calls compile & pass unchanged
- [ ] JSDoc abort-contract paragraph present on restoreFromHistory
- [ ] Factory wires `() => disabled` (closure over live flag)
- [ ] No changes to createLazyDictionary / onLoadError / notify path

## Anti-Patterns to Avoid

- ❌ Don't throw from the replay loop to signal abort — return (fire-and-forget must never produce unhandled rejections)
- ❌ Don't widen the `Pick<IngestPipeline, "processText">` type when a `shouldAbort` predicate is the minimal option
- ❌ Don't pass `disabled` by value — it flips during the replay
- ❌ Don't duplicate the per-segment gating here; S1's `isDisabled` inside `#admitSegment` owns the in-flight message
- ❌ Don't touch notify-once semantics — they are already correct
- ❌ Don't use `continue` where the contract says stop (`return`)
- ❌ Don't add config surface — internal wiring only (PRD §08)

---

**Confidence Score**: 9/10 — the seam is precisely located, the S1 contract is
explicit (assume landed as specified in its PRP), the test home and helpers
already exist, and the only mild uncertainty is settle/poll timing in the
real-pipeline test (vi.waitFor handles it; the assertion is a stable zero).