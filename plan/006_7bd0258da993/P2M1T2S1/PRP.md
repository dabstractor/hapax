# PRP — P2.M1.T2.S1: `session_tree` handler — guard, queue discard, snapshot, gated in-place rebuild, rebind, claim release

---

## Goal

**Feature Goal**: Implement spec 05 h2.37 + 06 h2.42 + 07 h2.46/h3.9/h3.12 in `src/pi/index.ts`:
on every `session_tree` event (`/tree` branch navigation), rebuild the store as a **pure
function of the active branch's replayable history** — guarded, queue-discarding,
snapshot-replaying, in-place, query-gated — and rebind both display paths, releasing the
line claim.

**Deliverable**:
1. `pi.on("session_tree", handler)` in `src/pi/index.ts` with Mode A JSDoc + an updated
   event-table comment block at the file head.
2. Factory-slot hoists the handler needs: `sessionGate` (the retained
   `createStartupGate` instance — currently created inline and discarded), `config`,
   `tickInputClock` (currently session_start consts the handler cannot otherwise reach).
3. Widget-path rebind on `session_tree` (fresh composition around the remembered
   pre-hapax factory, bound to this rebuild's restoreReady) and fallback-path
   `sessionGate.arm(restoreReady)` on the SAME provider instance reading the SAME
   in-place-reset store.
4. Handler unit tests in `test/index.test.ts` (fake ctx per its `makeCtx` conventions):
   guard no-op, discard-before-reset, reset+replay through the real restore chain, gate
   re-arm, widget rebind, claim release, summaryEntry never ingested.

**Success Definition**: Navigating `/tree` to a different leaf discards the pending
debounce queue, resets the SAME `CandidateStore` instance, replays the new branch's
history oldest→newest through the identical `restoreFromHistory`, holds every query path
(fallback gate + widget rebind) until settle (≤ 500 ms bound), releases the line claim,
and never serves vocabulary from the abandoned branch. `newLeafId === oldLeafId`
navigations are no-ops. `summaryEntry` text never enters the store. No
`session_compact` handler is added (compaction never triggers a rebuild). `npm run
check` + `npm test` green.

## User Persona

**Target User**: hapax end user who navigates `/tree` (branch editing) mid-session.

**Use Case**: User submits a misspelled word, runs `/tree` back to edit the prompt away.
The misspelling (dictionary-absent, rank group 0) currently lingers as a top suggestion
forever — the append-only store never learned about branches.

**User Journey**: type → notice mistake → `/tree` back → retype prompt → autocomplete
offers only vocabulary from the (edited) active branch; the first post-`/tree` query may
wait up to ~500 ms behind the background replay.

**Pain Points Addressed**: dead-branch word residue (owner scenario, spec 05 h2.37
preamble); stale-widget after branch switch (07 h2.46 "Branch navigation").

## Why

- Spec 05 h2.37 (binding, "adopted ahead of implementation — code lands with this
  spec"): this item IS that code landing.
- Spec 06 h2.42: branch purity — the rebuilt store is identical to a fresh `/resume` of
  the same branch (the full purity battery is P2.M1.T2.S2; the handler is its subject).
- Consumes the two sibling primitives: `CandidateStore.reset()` (P2.M1.T1.S1,
  implementing) and `IngestPipeline.discardPending()` + `StartupGateHandle.arm()`
  (P2.M1.T1.S2, implementing). Treat their PRPs as contracts; read the landed code first.

## What

Handler logic on `session_tree` (event: `{ newLeafId: string | null, oldLeafId: string
| null, summaryEntry?, fromExtension? }` — verified in pi's
`core/extensions/types.d.ts:505-511`):

1. **Guard**: `disabled` (dict-failure runtime), `pipeline == null || store == null`
   (pre-session_start / post-shutdown), or `newLeafId === oldLeafId` (both nullable) →
   return, touch nothing.
2. **Discard**: `pipeline.discardPending()` — sync, sub-ms. Debounce-window texts are
   dead-branch or re-captured by the snapshot replay (h2.37 step 2).
3. **Release claim**: `claim?.release()` (spec 07 h3.9 release set).
4. **Prepare gate readiness synchronously**: `let markTreeReady; const restoreReady =
   new Promise(resolve => markTreeReady = resolve)`.
5. **Rebind (both paths, synchronous)**:
   - Widget path: re-read `ctx.ui.getEditorComponent?.()`; if `isWidgetWrapper(f)`,
     `priorInner = widgetOptsOf(f)?.inner`, install a FRESH
     `createWidgetEditorFactory({ inner: priorInner, store, config, chain, claim,
     restoreReady, onKeystroke: tickInputClock })` — the exact reload-branch shape
     (session_start re-fire), bound to THIS rebuild's promise. Skip silently if no
     wrapper is installed (fallback session or another extension took the editor).
   - Fallback path: `sessionGate?.arm(restoreReady)` — the SAME permanently-registered
     provider instance re-arms (no unregister API exists); its closure reads the SAME
     store object we are about to reset in place.
6. **Background rebuild** (fire-and-forget `void (async () => …)()`):
   `await pipeline.flush()` (let any in-flight drain finish into the OLD store) →
   `store.reset()` (in-place wholesale drop — P2.M1.T1.S1) →
   `restoreFromHistory(pipeline, ctx.sessionManager, () => disabled, markTreeReady)`
   (the IDENTICAL restore pipeline; onSettled fires exactly once on finish/abort/throw,
   releasing the gate / settling the widget's restoreReady).
7. **summaryEntry**: never read, never ingested (nothing to do — pin by test).
8. **Compaction**: no `session_compact` handler; compaction never triggers a rebuild
   (holds by absence — pin by test that no rebuild occurs without session_tree).

Required slot hoists (factory scope, all re-assigned at each session_start):
- `sessionGate: StartupGateHandle | null` — set inside the existing
  `ctx.ui.addAutocompleteProvider((current) => { … })` callback:
  `const g = createStartupGate(createHapaxProvider(store!, config, current,
  sessionChain), restoreReady); sessionGate = g;` (return/display wiring unchanged).
- `sessionConfig: <ReturnType of loadConfig> | null` — the handler needs
  `config.triggerChar`-bearing config for the fresh widget composition; assign at
  session_start.
- `sessionTickInputClock: (() => void) | null` — the input-clock tick; assign at
  session_start. (Widget rebind needs it for `onKeystroke`.)

### Success Criteria

- [ ] `newLeafId === oldLeafId` (incl. both null) → no discard, no reset, no rebind
- [ ] Real navigation → `discardPending` called before reset; in-flight drain lands in
      the old store (flush before reset)
- [ ] The SAME CandidateStore instance is reset in place (identity pinned); replay
      refills it through `restoreFromHistory` with `getBranch()` (leaf→root reversed
      copy) oldest→newest
- [ ] Fallback: `sessionGate.arm` called with the fresh promise; the registered provider
      object is NOT re-registered
- [ ] Widget: fresh composition installed around the remembered pre-hapax inner factory;
      the old wrapper replaced (no stacking); bound to the new restoreReady + the SAME
      (in-place-reset) store
- [ ] `claim.release()` called on every non-guarded navigation
- [ ] `summaryEntry` content never appears in the store (fake summaryEntry with a
      distinctive rare word)
- [ ] No rebuild on any non-session_tree event (compaction regression pin)
- [ ] `npm run check` + `npm test` green; existing suites unregressed

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything needed?" — Yes:
the handler's exact placement, every slot it reads, both rebind shapes (the widget rebind
is a verbatim adaptation of the existing reload branch, quoted below), the sibling
primitives' contracts, and the test harness idioms are all anchored to files and lines.

### Documentation & References

```yaml
- file: src/pi/index.ts
  why: THE file to modify. Read in full (431 lines). Key regions: event-table head
        comment (:1-46), factory slots (:172-180), session_start (store/claim/chain/
        restoreReady/inputClock construction ~:186-262), widget primary branch
        (~:236-266), widget RELOAD rebind branch (~:275-308 — the rebind precedent to
        copy), fallback addAutocompleteProvider callback (~:315-350 — gate created
        inline, must hoist), restore gating (~:380-398), before_agent_start (:414-421).
  pattern: "handler registered at factory body level, one pi.on per event; factory-scope
            let-slots, nullable, cleared on shutdown."
  gotcha: "session_start binds per-session CONSTS (sessionStore, restoreReady,
           tickInputClock, config). The session_tree handler runs in the same session, so
           those consts are still correct — but it must read the FACTORY slots
           (store/claim/chain/pipeline) for null-safety, and the hoisted
           sessionConfig/sessionTickInputClock/sessionGate for the rebind. Never capture
           a session_start const into the session_tree closure by reference to a stale
           fire — the hoisted slots ARE the cross-handler seams."

- file: src/pi/ingest.ts
  why: restoreFromHistory (:1101-1130+) — the replay to reuse VERBATIM.
  pattern: "signature (pipeline: Pick<IngestPipeline,'processText'>, sessionManager,
            shouldAbort?, onSettled?); synchronous branch collection via getBranch()
            with [...branch].reverse() COPY; fire-and-forget async replay; onSettled
            exactly once (settled guard; finish/abort/throw)."
  gotcha: "restoreFromHistory is ADD-ONLY — the store must be reset() BEFORE it. It takes
           the pipeline, not the store: pipeline.processText funnels into its #store
           (the same instance we reset). flush() is public and returns a promise."

- file: plan/006_7bd0258da993/P2M1T1S2/PRP.md
  why: CONTRACT for discardPending() + StartupGateHandle.arm(). Includes the composition
        note written FOR THIS TASK: after discardPending(), `await flush()` settles only
        when the in-flight drain finishes — call it in the background rebuild BEFORE
        store.reset().
  gotcha: "arm(newReady) un-settles the gate; per-arming ≤ 500 ms bound; forced requests
           included; rejected promise never wedges. In-flight racers keep their old race
           (accepted)."

- file: plan/006_7bd0258da993/P2M1T1S1/PRP.md
  why: CONTRACT for CandidateStore.reset() — in-place drop of words + bigrams + successor
        index; ordinal zeroed so replay re-issues 1..N like a fresh /resume.

- file: src/pi/widget.ts
  why: isWidgetWrapper (:214), widgetOptsOf (:223, returns WidgetLayerOptions with
        .inner — the remembered pre-hapax factory), createWidgetEditorFactory (:1437),
        LineClaim/createLineClaim (:393/:408, release idempotent).
  gotcha: "widgetOptsOf(f)?.inner is undefined when f is not our wrapper — guard; a
           missing inner means someone else owns the editor now — skip the rebind
           silently, the fallback gate arm still covers nothing (no provider on this
           path) and that TOCTOU is the same accepted tolerance as session_start."

- file: test/index.test.ts
  why: Harness host. makeCtx(over) (:~100-145) with fake ui {notify,
        addAutocompleteProvider, getEditorComponent, setEditorComponent} +
        sessionManager {getBranch, getEntries}; currentFake() provider double;
        startSession helper; describe-per-behavior titles citing spec sections.
  pattern: "fire captured handlers: the fake pi captures pi.on registrations — find the
            session_tree handler and invoke handler({type:'session_tree', newLeafId,
            oldLeafId}, ctx). Script getBranch to return branches of fake SessionEntry
            message entries (see ingest-restore.test.ts for entry shapes: {type:
            'message', message: {role, content}})."

- file: spec/05-ingestion-pipeline.md
  why: h2.37 (this handler's binding spec — steps 1-5, performance note, compaction
        interplay, summary rule, rejected-journal rationale). READ the section in full.
- file: spec/07-completion-ui.md
  why: h2.46 "Branch navigation (2026-10)" rebind rule; h3.9 Line claim release set;
        h3.12 gate reuse verbatim (forced requests included, ≤ 500 ms, in-place safety).

- docfile: plan/006_7bd0258da993/P2M1T2S1/research/notes.md
  why: Verified line anchors, pi-type verification, composition-order rationale,
        boundary decisions (what belongs to T2.S2's purity battery).
```

### Current Codebase tree (relevant slice)

```bash
src/pi/index.ts            # MODIFY: + session_tree handler, + 3 slot hoists, + event-table row
src/pi/ingest.ts           # READ (restoreFromHistory, flush, discardPending-from-T1.S2)
src/pi/provider.ts         # READ (StartupGateHandle from T1.S2)
src/core/store.ts          # READ (reset() from T1.S1)
src/pi/widget.ts           # READ (isWidgetWrapper, widgetOptsOf, createWidgetEditorFactory)
test/index.test.ts         # MODIFY: new describe for the session_tree handler
```

### Desired Codebase tree with files to be added/changed

```bash
src/pi/index.ts            # MODIFY only — no new files anywhere
test/index.test.ts         # MODIFY only
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: the fallback provider is registered PERMANENTLY (no unregister API) and
// its closure captured `store` via `store!` read inside the addAutocompleteProvider
// callback. The ONLY safe rebuild is in-place: store.reset() on the SAME instance.
// NEVER reassign the `store` factory slot inside the session_tree handler.
// CRITICAL: hoist `sessionGate` BEFORE using it — today createStartupGate's return is
// discarded inside the callback; arm() is unreachable without the hoist. Assign the
// hoisted slot INSIDE the callback (the gate object is what gets registered).
// CRITICAL: flush() BEFORE reset() — an in-flight drain must finish landing its
// straggler upserts in the old store so the wholesale drop erases them too; this also
// keeps the handler's synchronous work sub-ms (h2.37 performance note).
// CRITICAL: create the restoreReady promise and do the rebind/arm SYNCHRONOUSLY in the
// handler (before the background task) — the widget composition binds restoreReady at
// construction; the gate must be armed before any post-navigation query can race it.
// CRITICAL: restoreFromHistory collects getBranch() synchronously at call time — the
// "snapshot" of h2.37 step 3 is exactly this call; do NOT copy entries yourself.
// CRITICAL: the handler must NOT return a value (pi handler-result semantics; same
// discipline as message_end).
// CRITICAL: guard order — disabled/null checks FIRST, then leaf-id equality. A
// disabled runtime must not even discard.
// GOTCHA: newLeafId/oldLeafId are BOTH string | null — === covers null===null; also
// compare when one is null and the other is not (real navigation).
// GOTCHA: line numbers in the work-item description cite an older snapshot (:153/:398/
// :404/:414/:275-308/:422/:711-763) — they're close but trust the code you read.
// GOTCHA: no linter; `npm run check` (tsc --noEmit) IS the style gate.
```

## Implementation Blueprint

### Data models / state

No new types. Factory-scope slots added (mirroring existing nullable-slot style):

```ts
// inside hapax(), alongside the existing let-slots:
let sessionGate: StartupGateHandle | null = null;   // armed on session_tree (import type from provider.js)
let sessionConfig: ReturnType<typeof loadConfig> | null = null;
let sessionTickInputClock: (() => void) | null = null;
```

`session_start` assigns the latter two (config already computed; `tickInputClock` is the
existing const); the fallback branch's `addAutocompleteProvider` callback assigns
`sessionGate`. `session_shutdown` nulls `sessionGate` and `sessionConfig`/
`sessionTickInputClock` alongside the others.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ the landed siblings
  - READ src/core/store.ts (reset()) and src/pi/{ingest,provider}.ts (discardPending,
    StartupGateHandle/arm) — they land from P2.M1.T1.S1/.S2 in parallel; adapt names
    to the ACTUAL code, not just the PRPs.

Task 1: MODIFY src/pi/index.ts — slot hoists
  - ADD the three let-slots (above) + session_start assignments
    (sessionConfig = config; sessionTickInputClock = tickInputClock) + shutdown nulls.
  - IN the fallback addAutocompleteProvider callback: capture the gate —
    `const g = createStartupGate(createHapaxProvider(store!, config, current,
    sessionChain), restoreReady); sessionGate = g;` then build createDisplayProvider(g, …)
    and return/displayProvider-assign as today (behavior byte-identical).
  - IMPORT type StartupGateHandle from "./provider.js".

Task 2: MODIFY src/pi/index.ts — the session_tree handler
  - REGISTER after the session_start handler (before message_end is fine; keep event
    order matching the head comment's table):
    pi.on("session_tree", (_event, ctx) => { … }) with Mode A JSDoc (below).
  - BODY (binding order):
    1. if (disabled || !pipeline || !store) return;
    2. if (_event.newLeafId === _event.oldLeafId) return;   // guard, both nullable
    3. pipeline.discardPending();                            // h2.37 step 2
    4. claim?.release();                                     // h3.9 release set
    5. let markTreeReady = (): void => {};
       const restoreReady = new Promise<void>((r) => { markTreeReady = r; });
    6. Widget rebind (synchronous): const f = ctx.ui.getEditorComponent?.();
       if (f && isWidgetWrapper(f)) {
         const priorInner = widgetOptsOf(f)?.inner;
         if (priorInner !== undefined && sessionConfig) {
           ctx.ui.setEditorComponent?.(createWidgetEditorFactory({
             inner: priorInner,
             store,                     // SAME instance — reset in place below
             config: sessionConfig,
             chain: chain!,             // non-null within a live session; guard anyway
             claim: claim!,             // fresh claim? NO — reuse session claim (already released in 4);
                                       //   the fresh-composition claim semantics: createLineClaim per
                                       //   composition per the reload branch — follow whatever the reload
                                       //   branch does; if it reuses `sessionClaim`, reuse; if it creates
                                       //   a fresh one, create fresh AND reassign the factory slot.
             restoreReady,              // THIS rebuild's readiness
             onKeystroke: sessionTickInputClock!,
           }));
         }
       }
       (Mirror the reload branch's exact handling of chain/claim — read it first.)
    7. Fallback arm (synchronous): sessionGate?.arm(restoreReady);
    8. Background rebuild: void (async () => {
         await pipeline.flush();        // in-flight drain finishes into OLD store
         store.reset();                 // in-place wholesale drop (P2.M1.T1.S1)
         restoreFromHistory(pipeline, ctx.sessionManager, () => disabled, markTreeReady);
       })();                            // onSettled EXACTLY once → gate/widget release
    9. No return value. summaryEntry never read.
  - JSDOC (Mode A) must cite: spec 05 h2.37 steps 1-5 + performance note + compaction
    interplay ("rebuild triggers ONLY on session_tree; compaction NEVER; store survives
    compaction untouched") + summary rule ("summaryEntry never ingested; abandoned-branch
    vocabulary re-enters only via real messages on the new branch") + spec 06 h2.42
    (branch purity / identical to fresh /resume) + spec 07 h3.12 (gate reuse verbatim,
    forced included, ≤ 500 ms) + 07 h3.9 (claim release) + 07 h2.46 (rebind rule).

Task 3: MODIFY src/pi/index.ts — event-table head comment
  - ADD a session_tree row to the handler-wiring block at the file head summarizing:
    guard → discard → claim release → gated in-place rebuild (reset + restoreFromHistory)
    → rebind both paths; never fires on compaction; summaryEntry never ingested.

Task 4: MODIFY test/index.test.ts — handler battery
  - NEW describe: "session_tree — branch-hygiene rebuild (spec 05 h2.37 / P2.M1.T2.S1)".
  - FOLLOW pattern: makeCtx + startSession + captured handlers; fake SessionEntry
    message entries shaped like ingest-restore.test.ts fixtures ({type:'message',
    message:{role:'user'|'assistant', content:'…'}}).
  - CASES:
    1. "guard: newLeafId === oldLeafId (incl. both null) is a no-op": start a session,
       ingest nothing; fire session_tree {newLeafId:'a', oldLeafId:'a'} and
       {null, null} → store.size unchanged, getBranch NOT re-read (getBranch mock call
       count unchanged), no setEditorComponent call, claim not released (assert via a
       claim spy or widget state — simplest: assert getBranch call-count and setEditor
       call-count both unchanged).
    2. "real navigation discards pending queue before reset": session with a pending
       (undrained) message_end text; fire session_tree → the pre-navigation text never
       lands in the store post-rebuild (the fake branch doesn't contain it).
    3. "in-place rebuild: SAME store instance, reset then replayed oldest→newest":
       fake branch with entries [user 'alpha beta', user 'alpha gamma'] (getBranch
       returns leaf→root, i.e. REVERSED — restoreFromHistory reverses the copy);
       fire session_tree → await the background task (vi.waitFor on store content);
       store.get('alpha') defined with counts from BOTH messages; store object identity:
       assert via a reference captured from /acwords? simplest — the provider closure
       reads the factory slot; assert store.size reflects ONLY branch words (dead-branch
       word from a pre-navigation ingest absent). Pin in-place identity by exposing
       nothing new: spy — wrap: after session_start, ingest a dead-branch word, fire
       session_tree, assert the dead word is gone while branch words exist (identity is
       structural: the SAME store instance is what makes the registered provider see
       this — assert through a captured addAutocompleteProvider provider: register the
       fallback (no editorFactory), grab the registered provider's getSuggestions, and
       check post-rebuild suggestions serve the branch word).
    4. "fallback: the SAME provider is re-armed, not re-registered": no editorFactory
       → addAutocompleteProvider called ONCE total across session_start + session_tree;
       the registered provider's getSuggestions returns branch words after the rebuild
       settles (vi.waitFor).
    5. "widget: fresh composition around the remembered pre-hapax inner": editorFactory
       set (a fake inner factory) → session_start installs wrapper #1; fire session_tree
       → setEditorComponent called again; the NEW factory passed to it wraps the ORIGINAL
       inner (assert widgetOptsOf(newFactory).inner === originalInner, and that the new
       factory is a widget wrapper but NOT wrapping wrapper #1).
    6. "claim released on real navigation, not on guard no-op": use a claim-spy —
       createLineClaim is injected; assert release called for case 3's fire and not for
       case 1's. (If the claim isn't reachable from the test seam, assert the observable:
       the fresh widget composition carries an unclaimed row — via widgetOptsOf(new
       factory).claim state if exposed; otherwise document and cover identity in T2.S2's
       battery.)
    7. "summaryEntry is never ingested": fake event {summaryEntry: {…, text/summary
       containing a distinctive rare word 'zxqsummaryword'}}; fire with a branch that
       lacks it → store.get('zxqsummaryword') undefined after settle. (Match
       BranchSummaryEntry's actual text-bearing field from pi types.)
    8. "compaction never triggers a rebuild": fire a synthetic session_compact-style
       handler if any exists — there is none; instead assert the module registers NO
       handler for any compact event (inspect the fake pi.on call names) and that firing
       nothing leaves the store untouched after a prior ingest (regression pin).
    9. "disabled runtime: handler is a full no-op": set disabled via a failing dict
       (existing disable-on-bad-dict fixture pattern) → fire real navigation → nothing.
  - GOTCHA (tests): the background task is fire-and-forget — every content assertion
    needs vi.waitFor(...); the replay's processText drains synchronously on empty/short
    fake entries but do not rely on it.

Task 5: VALIDATE — full gate chain (below).
```

### Implementation Patterns & Key Details

```ts
// The handler skeleton (index.ts) — binding order matters:
pi.on("session_tree", (event, ctx) => {
  if (disabled || !pipeline || !store) return;
  if (event.newLeafId === event.oldLeafId) return; // null-safe: null === null covered
  pipeline.discardPending();                        // spec 05 h2.37 step 2
  claim?.release();                                 // spec 07 h3.9
  let markTreeReady = (): void => {};
  const restoreReady = new Promise<void>((r) => { markTreeReady = r; });
  // rebind — synchronous, sub-ms (07 h2.46 "Branch navigation"):
  const f = ctx.ui.getEditorComponent?.();
  if (f && isWidgetWrapper(f)) {
    const priorInner = widgetOptsOf(f)?.inner;      // remembered pre-hapax factory
    if (priorInner !== undefined && sessionConfig && chain && claim && sessionTickInputClock) {
      ctx.ui.setEditorComponent?.(createWidgetEditorFactory({
        inner: priorInner, store, config: sessionConfig, chain, claim,
        restoreReady, onKeystroke: sessionTickInputClock,
      }));
    }
  } else {
    sessionGate?.arm(restoreReady);                 // same provider, re-armed (07 h3.12)
  }
  void (async () => {
    await pipeline.flush();                         // straggler drain → OLD store
    store.reset();                                  // in-place wholesale drop
    restoreFromHistory(pipeline, ctx.sessionManager, () => disabled, markTreeReady);
  })();                                             // onSettled exactly once
});
```

Notes on the branch choice: a session runs widget OR fallback — the editor check
decides which seam to hit. If a widget wrapper is installed but `priorInner` is
missing (foreign wrapper), skip the rebind silently (same TOCTOU tolerance as
session_start). `sessionGate` is null on the widget path and non-null on fallback —
`?.` covers both.

### Integration Points

```yaml
EVENTS (src/pi/index.ts):
  - add: pi.on("session_tree", …) — the only new registration
  - update: event-table head comment
SLOTS (src/pi/index.ts factory scope):
  - sessionGate: StartupGateHandle | null   (assigned in fallback registration callback)
  - sessionConfig / sessionTickInputClock   (assigned at each session_start; nulled on shutdown)
CONSUMERS:
  - P2.M1.T2.S2 purity battery drives THIS handler (branch A vs branch B → stores
    identical to fresh /resume of each).
  - P3.M1.T2.S3 live smoke (integration item 9).
SPEC: NO edits — 05 h2.37 / 07 h3.9 / h3.12 are adopted-ahead-of-implementation;
      this code lands WITH the existing text (Mode A: JSDoc rides with the work).
CONFIG: none (§08 surface unchanged).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check        # tsc --noEmit — zero errors. No linter exists; this IS the gate.
```

### Level 2: Unit Tests

```bash
npx vitest --run test/index.test.ts            # new describe + all existing suites
npx vitest --run test/ingest-restore.test.ts test/startup-gate.test.ts   # sibling seams
npm test                                        # FULL suite — zero regressions
```

### Level 3: Integration

```bash
# No live-TTY surface change lands here beyond the rebind (widget layer untouched
# internally); the live /tree verification is P3.M1.T2.S3's binding smoke. Confirm the
# extension-fixture path still loads:
npx vitest --run test/smoke.test.ts test/no-persistence.test.ts
```

### Level 4: Contract validation (domain-specific)

```bash
# Determinism re-run:
npx vitest --run test/index.test.ts && npx vitest --run test/index.test.ts
# No-persistence invariant (session_tree adds no persistence — pinned by the existing suite):
npx vitest --run test/no-persistence.test.ts
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run check` zero errors; `npm test` full-suite green, twice (determinism)
- [ ] All 9 handler-battery cases present and passing

### Feature Validation
- [ ] Guard (disabled / null slots / equal leaf ids) is a strict no-op — getBranch not even read
- [ ] discardPending → flush → reset → restoreFromHistory composition order pinned
- [ ] Same store instance reset in place; provider never re-registered; gate armed not replaced
- [ ] Widget rebind wraps the remembered pre-hapax inner with the fresh restoreReady; no stacking
- [ ] claim released on real navigation only
- [ ] summaryEntry never ingested; no compact handler registered
- [ ] Handler returns undefined on every path

### Code Quality Validation
- [ ] Mode A JSDoc on the handler + updated event-table comment citing 05 h2.37, 06 h2.42, 07 h2.46/h3.9/h3.12
- [ ] Slot hoists follow the existing nullable-slot style; shutdown nulls them
- [ ] No edits to spec/, src/pi/widget.ts internals, or the core pipeline beyond consumption

## Anti-Patterns to Avoid

- ❌ Don't reassign the `store` factory slot on session_tree — the permanently
  registered provider closure would keep reading the orphaned old instance
- ❌ Don't reset before flush() — the in-flight drain's straggler upserts must land in
  the old store so the wholesale drop erases them
- ❌ Don't re-register the autocomplete provider or wrap the widget wrapper — arm and
  re-compose around the remembered inner only
- ❌ Don't build a second gate — re-arm the hoisted one (h3.12 "verbatim")
- ❌ Don't ingest summaryEntry or add a session_compact handler
- ❌ Don't snapshot getBranch() yourself — restoreFromHistory's synchronous collection IS
  the snapshot
- ❌ Don't return a value from the handler (pi result semantics)
- ❌ Don't trust this PRP's line numbers over the code — the work-item's are from an
  older snapshot; re-read before editing

---

**Confidence Score: 8/10** — every seam (handler registration, pi event type, rebind
precedent, restore pipeline, sibling primitive contracts, test harness) was verified by
direct code reading; residual risk sits in (a) exact landed naming of the two parallel
sibling primitives (mitigated by Task 0) and (b) the claim-release and store-identity
test observables, where fallbacks to equivalent observables are specified rather than
blocked implementers.
