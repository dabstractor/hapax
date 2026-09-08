# PRP — P1.M3.T2.S1: Public sweepPhrases() on IngestPipeline called at restore tail

## Goal

**Feature Goal**: Close BUG-006 (Minor). The 40-ordinal phrase demotion sweep
(`#onSweepPhrases` → `CandidateStore.sweepPhraseDemotions()`) currently fires
ONLY in `IngestPipeline.#drainQueue`'s `finally` block (src/pi/ingest.ts ≈L249).
`restoreFromHistory` replays via direct `await pipeline.processText(...)`
calls that bypass the queue, so no sweep ever runs during/after a restore
replay — fast-path phrases admitted from ancient history that never recurred
stay candidates (and keep suppressing their first words) until the first live
`message_end` drain. Fix: expose a **public `sweepPhrases(): void`** method on
`IngestPipeline` that invokes the existing hook with the same
try/catch-never-wedge posture as `#drainQueue`, and call it **once at the tail
of the restore replay loop** — but **only when the replay completed normally**
(an aborted replay, per P1.M3.T1.S2's `shouldAbort`, must not sweep a store it
never fully populated).

**Deliverable**:
1. Modified `src/pi/ingest.ts` — new public `sweepPhrases()` method on
   `IngestPipeline` (~JSDoc, Mode A); `restoreFromHistory` widened Pick
   (`"processText" | "sweepPhrases"`), abort-tracking flag, restore-tail sweep
   call + JSDoc.
2. Modified `test/ingest-restore.test.ts` — `fakePipeline` double gains a
   recorded `sweepPhrases`; new tests: tail sweep after normal replay, no
   sweep on aborted replay, no sweep on empty history, throwing sweep contained.
3. New test (the PRD BUG-006 repro) — real `IngestPipeline` + real
   `CandidateStore`: live-path admit of an all-rare fast-path phrase, then 45
   restore-style direct `processText("filler…")` calls + restore-tail sweep ⇒
   phrases demoted. Mirror of the live-path demotion test in
   `test/ingest-pipeline.test.ts` (~L409–460, `onSweepPhrases` describe block).

**Success Definition**: `npm run check` and `npm test` green; the PRD repro
passes: after `onMessageEnd('zorblat quuxified mumblewords')` + flush, 45×
`await processText("filler …")`, then `sweepPhrases()`, the phrase candidates
`zorblat quuxified`, `quuxified mumblewords` are no longer in
`store.phraseCandidateKeys()`. All 523+ existing tests stay green.

## Why

- PRD §06 h3.7: "Fast-path phrases that fail to reach count ≥ 2 within 40
  subsequent message ordinals are demoted." The live path honors this via the
  once-per-flush sweep; the restore path (resume scenario — the flagship
  restore use case) does not, so stale candidates linger after resume.
- Bug-hunt verified (BUG-006, see
  `plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/bug_hunt_result.json`): the
  identical sequence routed through `onMessageEnd` + flush demotes them; direct
  `processText` calls leave them candidates.
- Output is consumed by P1.M5.T1.S2 (adversarial ingest-path probes:
  "demotion cadence") — keep the sweep observable via
  `store.phraseCandidateKeys()` / `isFastPathPhrase()`, not internal counters.

## What

### Behavior contract

1. **`sweepPhrases()` on IngestPipeline** (new public method, placed right
   after `dispose()`/near `flush()` in the class body):
   ```ts
   /**
    * Run the M2 40-ordinal phrase demotion sweep ONCE now (BUG-006,
    * P1.M3.T2.S1): the same #onSweepPhrases hook #drainQueue's finally
    * block fires, with the same error posture — a throwing callback is
    * swallowed and never wedges anything. Public so restoreFromHistory
    * can run the sweep at the tail of a restore replay, which calls
    * processText directly and therefore never enters #drainQueue.
    * No-op when onSweepPhrases is unset (phrases-disabled builds).
    */
   sweepPhrases(): void {
     try {
       this.#onSweepPhrases?.();
     } catch {
       // defensive: sweep failure never blocks anything (matches #drainQueue)
     }
   }
   ```
   Do NOT refactor `#drainQueue` to call `this.sweepPhrases()` — its finally
   block already has this shape inlined; leave it untouched (minimal diff,
   zero regression risk). (Refactoring to delegate is acceptable ONLY if it
   is a pure textual move with the same try/catch; prefer leaving it.)

2. **`restoreFromHistory` changes** (src/pi/ingest.ts ≈L417–446). Assume the
   P1.M3.T1.S2 contract landed: signature is
   `(pipeline, sessionManager, shouldAbort?: () => boolean)` with a
   top-of-loop `if (shouldAbort?.()) return;`. Changes:
   - Widen the pipeline type: `Pick<IngestPipeline, "processText" | "sweepPhrases">`.
   - Track abort inside the async IIFE and sweep at the tail:
   ```ts
   void (async () => {
     let aborted = false;
     for (const entry of ordered) {
       if (shouldAbort?.()) { aborted = true; return; }
       if (entry.type !== "message") continue;
       try {
         const text = extractText(entry.message);
         if (text === null) continue;
         await pipeline.processText(text, entry.message.role === "user");
       } catch {
         continue; // one bad entry never breaks the replay
       }
     }
     // BUG-006 (P1.M3.T2.S1): restore replays bypass #drainQueue, so the
     // once-per-flush demotion sweep never fires for them. Run ONE sweep
     // at the tail of a completed replay — skipped when aborted, because
     // an aborted replay (dictionary died mid-replay, P1.M3.T1.S2) may
     // have populated only part of the store and must not demote phrases
     // whose "40 subsequent ordinals" never got a chance to accrue.
     if (!aborted) pipeline.sweepPhrases();
   })();
   ```
   - JSDoc (Mode A): extend `restoreFromHistory`'s doc-comment with a
     paragraph: "Demotion tail (BUG-006): after the replay loop completes
     normally, exactly one sweepPhrases() runs (the sweep #drainQueue fires
     per live flush). An aborted replay (shouldAbort, P1.M3.T1.S2) skips
     the tail sweep entirely."
   - The tail call is NOT wrapped in try/catch — `sweepPhrases()` itself
     swallows; the fire-and-forget contract is preserved.

3. **Factory wiring: NONE.** `src/pi/index.ts` ≈L212 already wires
   `onSweepPhrases: () => sessionStore.sweepPhraseDemotions()` (≈L175) into
   the pipeline; `restoreFromHistory(pipeline, ctx.sessionManager, () => disabled)`
   passes the same pipeline object, which now has the public method. No
   index.ts change (except none needed — do not touch it). If S2's task
   hasn't landed yet, the third arg is simply absent — still fine.

4. **Existing-test compatibility**: widening the Pick breaks every
   `fakePipeline()` double in `test/ingest-restore.test.ts` (it only supplies
   `processText`). Update the double (see Task 2) — this is expected and
   required by the compiler.

### Success Criteria

- [ ] `sweepPhrases()` public on IngestPipeline; no-op without hook;
      swallowing a throwing hook.
- [ ] restore tail calls it exactly once after a normal replay.
- [ ] Aborted replay: zero tail sweeps (assert via the fake double).
- [ ] PRD repro test (real pipeline + store) shows demotion after
      restore-style replay + tail sweep.
- [ ] `npm run check` + `npm test` green; no index.ts changes.

## All Needed Context

### Context Completeness Check

All file/line references below were read from the current working tree.
`#drainQueue`'s sweep sits at src/pi/ingest.ts ≈L243–253; `restoreFromHistory`
at ≈L417–446; `sweepPhraseDemotions` at src/core/store.ts ≈L825.

### Documentation & References

```yaml
- file: src/pi/ingest.ts
  why: both edit sites — IngestPipeline class (options, #onSweepPhrases ≈L154,
        #drainQueue finally sweep ≈L229–253, dispose ≈L205, flush ≈L219) and
        restoreFromHistory ≈L417–446 (RestoreSessionManager, safeEntries, the
        async IIFE loop)
  pattern: copy the existing inlined try/catch sweep posture verbatim into
        sweepPhrases(); keep restoreFromHistory synchronous-void
  gotcha: never let a throw escape the fire-and-forget IIFE; the tail sweep
        must come AFTER the loop, guarded by the aborted flag

- file: src/core/store.ts
  why: sweepPhraseDemotions ≈L825 — demotes fast-path candidates with
        count<2 && !sticky when currentOrdinal() - firstSeenOrdinal >= 40;
        removePhraseCandidacy drops candidacy + provenance only
  pattern: assertions use phraseCandidateKeys(), isFastPathPhrase(key),
        currentOrdinal(), getPhrase(key)
  gotcha: "≥ 40", not "> 40" (firstSeen 1, now 41 → demoted); repetition-
        confirmed (count≥2) phrases are NEVER demoted

- file: test/ingest-restore.test.ts
  why: THE test home — provides fakeSm(opts), fakePipeline(), settle(probe)
        (vi.waitFor), userMsg/assistantMsg/msgEntry fixtures; fakePipeline
        (≈L149–160) must gain sweepPhrases
  pattern: vi.fn() doubles; NodeNext imports "../src/pi/ingest.js"
  gotcha: fire-and-forget — every tail-sweep assertion must go through
        settle(() => expect(pipe.sweepCalls).toBe(1)), never a raw expect

- file: test/ingest-pipeline.test.ts
  why: makePipeline harness (≈L99–128: real IngestPipeline + stub dict +
        CandidateStore + injectable hooks), drainNow, and the LIVE-path
        demotion test to mirror (onSweepPhrases describe block, ≈L409–460+)
  pattern: for the PRD repro reuse makePipeline-style construction with
        onAdmittedTokens + onSweepPhrases both wired to the real store
        (phrase capture requires onAdmittedTokens feeding store n-grams —
        mirror exactly how the live demotion test wires them)
  gotcha: stubDict returns null for anything not in COMMON/MIDFREQ sets —
        'zorblat', 'quzzified'-style words are RARE (null lookup) →
        fast-path phrase admission works; do NOT reuse 'context'/'granite'

- file: src/pi/index.ts
  why: confirms NO wiring change needed — onSweepPhrases already wired to
        sessionStore.sweepPhraseDemotions() (≈L171–175); restoreFromHistory
        call site ≈L212
  gotcha: read-only for this task

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M3T1S2/PRP.md
  why: CONTRACT for the shouldAbort seam this task builds on — optional third
        param, top-of-loop `if (shouldAbort?.()) return;`, closure wiring in
        index.ts; assume it landed exactly as specified
  critical: if S2 has NOT landed when implementation starts, add the abort
        handling per that PRP's "What" §2 (it is tiny) — do not fork the loop
        structure

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/prd_snapshot.md (h2.3/h3.5)
  why: BUG-006 statement + repro steps — use the repro verbatim as the test
```

### Current Codebase tree (relevant)

```bash
src/
  core/store.ts          # CandidateStore incl. sweepPhraseDemotions, phrases
  pi/
    ingest.ts            # IngestPipeline + restoreFromHistory  <-- ONLY edit target
    index.ts             # wiring — UNCHANGED by this task
test/
  ingest-restore.test.ts # restore suite + fakePipeline double  <-- edit
  ingest-pipeline.test.ts# makePipeline harness + live demotion test (mirror)
```

### Desired Codebase tree

```bash
src/pi/ingest.ts            # + sweepPhrases() method; restoreFromHistory tail sweep
test/ingest-restore.test.ts # + sweepPhrases on fakePipeline; new tests
test/ingest-pipeline.test.ts # optionally host the PRD repro here (or in restore suite)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: restoreFromHistory is fire-and-forget void — the async IIFE must
// never surface an unhandled rejection; sweepPhrases() swallows internally.
// CRITICAL: aborted replay MUST NOT sweep (work-item contract): an aborted
// replay with a bad dict never populated the store — sweeping could demote
// phrases from a partially-replayed history whose 40 ordinals never accrued.
// Use the `let aborted` flag, not loop restructuring.
// GOTCHA: widening Pick to include "sweepPhrases" breaks fakePipeline in
// test/ingest-restore.test.ts — TypeScript will force the fix; also update
// any other Pick-satisfying doubles (grep "processText" in test/).
// GOTCHA: sweep cadence is ≥40 SUBSEQUENT ordinals — one store ordinal per
// message; "filler" text must still ADMIT at least one candidate or issue an
// ordinal. Check how processText issues ordinals (one per message, even
// gate-rejected ones count toward ordinals — verify against
// src/pi/ingest.ts processText; if an all-rejected message issues NO ordinal,
// use filler words that admit, e.g. "zephyr quartz" style rare words).
// GOTCHA: relative imports need .js extensions (NodeNext).
// GOTCHA: ESM project; vitest; `npm run check` = tsc --noEmit is the linter.
```

## Implementation Blueprint

### Data models and structure

No new data models. One new public method, one widened Pick, one flag, one
call. Full reference code is in "What" §1–§2 above — implement verbatim.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/pi/ingest.ts — sweepPhrases() method
  - ADD public sweepPhrases(): void per "What" §1 (JSDoc cites BUG-006 /
    P1.M3.T2.S1; try/catch swallows; optional-chained hook)
  - PLACE: after dispose(), before flush() (grouping with lifecycle methods)
  - DO NOT: change #drainQueue, #onSweepPhrases wiring, or constructor

Task 2: MODIFY src/pi/ingest.ts — restoreFromHistory tail sweep
  - WIDEN Pick to "processText" | "sweepPhrases"
  - ADD `let aborted = false;` + set-and-return in the abort branch
  - ADD `if (!aborted) pipeline.sweepPhrases();` after the loop
  - EXTEND JSDoc with the demotion-tail paragraph ("What" §2)
  - PRESERVE: synchronous void return, per-entry try/catch-continue,
    copy-before-reverse, safeEntries fallback, empty-history no-op semantics
    (empty history = replay "completes normally" → tail sweep DOES run;
    harmless because #onSweepPhrases on an empty store is a no-op)

Task 3: MODIFY test/ingest-restore.test.ts — double + contract tests
  - EXTEND fakePipeline(): add `sweepPhrases: vi.fn()` and expose
    `sweepCalls` (or assert via the vi.fn's call count); keep processText
    recording unchanged — existing ordering tests unaffected
  - ADD tests (settle() every fire-and-forget assertion):
      1. "runs exactly one sweepPhrases at the tail of a completed replay"
         — fakeSm with 3 message entries → settle(pipe.processText called 3×);
         expect sweepPhrases toHaveBeenCalledTimes(1) after settle
      2. "aborted replay skips the tail sweep" — shouldAbort returns true on
         first poll → settle(processText never called); expect
         sweepPhrases toHaveBeenCalledTimes(0)
      3. "empty history still sweeps once (no-op sweep)" — branch [] and
         entries [] → settle; sweepPhrases called 1× (documents the
         semantics; if implementer prefers skip-on-empty, that is ALSO
         acceptable — but then update this test; pick one and JSDoc it)
      4. "a throwing sweepPhrases never surfaces as unhandled rejection" —
         real-ish double whose sweepPhrases throws; settle + expect no
         unhandled rejection (vitest fails tests on unhandled rejections)

Task 4: ADD the BUG-006 repro test (PRD verbatim) — real pipeline + store
  - HOST: test/ingest-restore.test.ts (it is the restore-cadence home) or
    test/ingest-pipeline.test.ts next to the live demotion test — either is
    fine; keep it near its mirror
  - CONSTRUCT: real IngestPipeline via makePipeline-style options with a REAL
    CandidateStore, stub dict (null lookups → all-rare), onAdmittedTokens
    and onSweepPhrases BOTH wired to the store exactly as the live demotion
    test (≈test/ingest-pipeline.test.ts L409–460) wires them
  - REPRO (PRD h3.5 steps, adapted to restore tail):
      1. pipeline.onMessageEnd(userMsg("zorblat quuxified mumblewords"))
         then await flush() → all three words admitted (rare), phrase
         candidates contain "zorblat quuxified" and "quuxified mumblewords"
         (fast-path, all-rare first sight) — assert via
         store.phraseCandidateKeys() / isFastPathPhrase
      2. 45 × await pipeline.processText("filler zephyr quartz vortex", true)
         — DIRECT calls, restore-style (no onMessageEnd, no drain, no sweep)
      3. assert candidates are STILL present (the bug's precondition)
      4. pipeline.sweepPhrases() (or drive restoreFromHistory with a fake sm
         whose entries replay 45 filler messages — stronger, exercises the
         real tail; prefer this if cheap)
      5. assert store.isFastPathPhrase("zorblat quuxified") === false and
         phraseCandidateKeys() no longer contains either phrase; assert a
         control: a count≥2 phrase (feed one phrase twice) SURVIVES the sweep
  - NAMING: describe("BUG-006 — demotion cadence after restore replay")
  - FOLLOW pattern: live-path demotion test in ingest-pipeline.test.ts

Task 5: VERIFY factory needs nothing
  - READ src/pi/index.ts ≈L171–212: confirm onSweepPhrases wiring passes
    through to restoreFromHistory's new tail call; NO code change
```

### Implementation Patterns & Key Details

```ts
// The entire source delta is ~15 lines. Do not add config, stats counters,
// or new options — onSweepPhrases is already the single seam.

// Purity/lifecycle notes:
// - sweepPhrases() is synchronous void; sweepPhraseDemotions is O(candidates)
//   and pure over store state — safe at a replay tail (no keystroke path).
// - No timer manipulation: the tail sweep is immediate, not debounced
//   (demotion is not latency-sensitive; the replay itself already yields
//   between chunks).
```

### Integration Points

```yaml
NO integration changes:
  - src/pi/index.ts: read-only (onSweepPhrases already wired ≈L175)
  - store: no changes (sweepPhraseDemotions already exists, store.ts ≈L825)
  - config: no new surface (Mode A docs only — JSDoc)
  - P1.M5.T1.S2 consumes this via observable store state only
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check          # tsc --noEmit — the widened Pick + updated doubles must compile
# Expected: clean. If fakePipeline in test/ingest-restore.test.ts errors on
# the missing sweepPhrases member, that is Task 3's expected compiler-forced fix.
```

### Level 2: Unit Tests

```bash
npm test -- ingest-restore
npm test -- ingest-pipeline
npm test                # full suite — 523+ pre-existing tests must stay green
# Expected: new tests pass; zero regressions (especially: abort test from
# P1.M3.T1.S2's bad-dict restore must still assert store.size === 0 AND now
# also implicitly zero sweeps — if it uses a REAL pipeline, its aborted
# restore should not have swept; that test's assertions remain valid).
```

### Level 3: Integration Testing

Not applicable — no factory/wiring changes; behavior is fully covered by
Level 2 with real pipeline + store objects.

### Level 4: Domain-Specific Validation

```bash
# PRD repro gate (the BUG-006 probe, scripted):
npm test -- -t "BUG-006"
# Expected: the repro test passes — restore-style replay + tail sweep demotes
# the fast-path phrases; control (count≥2 phrase) survives.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean
- [ ] `npm test` fully green (no regressions in ingest/restore/phrase suites)

### Feature Validation

- [ ] `sweepPhrases()` public, no-op without hook, swallows throwing hooks
- [ ] Restore tail: exactly one sweep after a completed replay
- [ ] Aborted replay: zero sweeps
- [ ] BUG-006 repro test passes with a control phrase surviving
- [ ] No src/pi/index.ts change; no config/stats surface change

### Code Quality Validation

- [ ] JSDoc on sweepPhrases() and the restore-tail call (Mode A docs)
- [ ] Minimal diff; #drainQueue untouched (or pure-textual delegation only)
- [ ] Fire-and-forget contract preserved (no unhandled rejections)

## Anti-Patterns to Avoid

- ❌ Don't sweep on aborted replays — the store was never fully populated.
- ❌ Don't wrap the tail call in try/catch (sweepPhrases already swallows).
- ❌ Don't add a new option/flag for the tail sweep — reuse #onSweepPhrases.
- ❌ Don't let the widened Pick break silently — fix every double.
- ❌ Don't restructure the replay loop; a boolean flag is the whole mechanism.
- ❌ Don't assert raw expectations on fire-and-forget work — always settle().