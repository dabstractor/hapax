# PRP — P2.M1.T2.S2: Branch-purity + rebuild acceptance battery (spec/09-mandated)

---

## Goal

**Feature Goal**: Implement the spec/09-mandated acceptance battery for branch purity
and `session_tree` rebuild (spec 09 h2.59's "Branch purity", "Branch rebuild", and
"Branch rebind" test bullets): the store is a **pure function of the active branch's
replayable history** — replaying a fixed sequence twice yields identical stores;
incremental (`message_end`) and rebuilt (`getBranch()` snapshot → `reset()` →
`restoreFromHistory`) stores are deep-equal including casing tallies and the successor
index; the queue discard never loses or double-counts live words; equal-leaf
navigations skip; queries during replay wait behind the bounded gate (≤ 500 ms, forced
requests included); the widget releases its claimed row and re-binds to the rebuilt
store. This battery is the spec's own named unit-test bullets — every implementing
subtask already carries riding tests; this is the standalone acceptance proof.

**Deliverable**: `test/branch-purity.test.ts` — one battery file, header citing the
spec 09 bullets it implements and the pointer that the LIVE version of integration
item 9 runs in P3.M1.T2.S3. Test-only: no src/ changes (the single sanctioned
exception: an internal defensive bigram dump in `src/core/store.ts`, ONLY if
per-word `topSuccessors` enumeration proves insufficient — must stay RAM-only and
grepsafe per `test/no-persistence.test.ts`).

**Success Definition**: The battery passes and pins: (1) two replays of a fixed
message sequence → byte-identical store state (entries + sortedKeys + successor
index + casing tallies); (2) incrementally-built store ≡ rebuilt store for the same
sequence, no dead-branch words survive, nothing double-counts; (3) pending-queue
discard re-captures live-branch texts exactly once and drops dead-branch texts; (4)
`newLeafId === oldLeafId` is a no-op; (5) queries (incl. `force: true`) during the
replay window resolve after settle and within the ≤ 500 ms bound; (6) `session_tree`
releases a claimed widget row and re-binds to the rebuilt (same-instance, in-place)
store. `npm run check` + `npm test` green, zero regressions.

## User Persona

**Target User**: hapax developer (the owner) — this is the acceptance proof for the
2026-10 branch-hygiene rule; evidence feeds P3.M1.T2.S4's DoD entry.

**Use Case**: When someone later touches ingest, reset, restore, or the gate, this
battery fails loudly if store determinism or branch hygiene regresses — the "a
rebuilt store is identical to a fresh `/resume` of the same branch (pinned in
tests, 09)" promise.

**Pain Points Addressed**: The failure class this guards (spec 05 h2.37): a journal
or union approach drifting from fresh-replay semantics — "a bug class visible only
on a `/tree` hop" — plus dead-branch misspelling residue (the owner scenario).

## Why

- Spec 09 h2.59 mandates these exact bullets under store.test.ts ("Branch purity
  (2026-10, spec 06)"), provider.test.ts ("Branch rebuild (2026-10, spec 05)"), and
  widget.test.ts ("Branch rebind (2026-10, spec 05/07)").
- Spec 06 h2.42: "identical gates and merge semantics applied to the same message
  sequence yield an identical store… pinned in tests, 09."
- Completes R3 (branch hygiene) evidence; output feeds the P3.M1.T2.S4 DoD entry.

## What

New test file `test/branch-purity.test.ts` organized in three describes:

- **A. Core purity (store/pipeline level)** — fixed message sequence replayed twice
  into two fresh pipelines+stores → identical state; incremental vs
  reset+`restoreFromHistory` equivalence on the same sequence.
- **B. Handler acceptance (index level, fake ctx)** — queue-discard liveness /
  dead-branch drop; equal-leaf skip; gate-bounded queries during replay (incl.
  forced).
- **C. Widget rebind** — claimed row released; widget re-bound to the rebuilt
  in-place store.

State comparison helper (local to the battery): snapshot a store's observable state
as `{ entries (key-sorted), sortedKeys, successors: per-word topSuccessors(word) }`
and compare with `toEqual`. No serialize/deepEqual helper exists in the codebase —
build this locally; do NOT add one to src/.

### Success Criteria

- [ ] Replay-twice determinism: identical `storeState` for two independent builds
- [ ] Incremental ≡ rebuilt: same `storeState` (tallies + successors included via
      whatever fields are present — `toEqual` handles additive series fields)
- [ ] Dead-branch word absent after rebuild; branch word present in BOTH a
      pre-navigation `message_end` AND the snapshot → counted exactly once (branch
      count, not summed)
- [ ] Undrained (inside debounce window) live-branch text re-captured by snapshot;
      undrained dead-branch text dropped
- [ ] `newLeafId === oldLeafId` fires no rebuild (getBranch call-count unchanged)
- [ ] `getSuggestions` (and `getSuggestions` with `force: true`) during replay
      resolves only after settle, within ≤ 500 ms, serving only branch vocabulary
- [ ] Widget: claim released; fresh composition wraps the original inner factory
      and reads the same in-place store; a post-navigation fragment never completes
      from abandoned-branch vocabulary
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything needed?" —
Yes: every equality building block, wiring seam, and test convention below was
verified by direct code reading; the handler under test is pinned by the T2.S1 PRP
contract (implementing in parallel).

### Documentation & References

```yaml
- file: spec/09-testing-and-acceptance.md
  why: THE mandated bullets. Read h2.59's store/provider/widget "Branch …" bullets
        (quoted in this PRP's item contract) and h2.60 item 9 (live version — runs
        in P3.M1.T2.S3; record the pointer in the battery header).
- file: spec/05-ingestion-pipeline.md
  why: h2.36 (restore) + h2.37 (session_tree rebuild steps 1-5, queue-discard
        correctness argument "never loses a live word, never double-counts").
- file: spec/06-candidate-store.md
  why: h2.42 branch purity — the exact property under test.

- file: src/core/store.ts
  why: Equality building blocks. entries() (~:657, defensive copy of Candidate[]),
        sortedKeysSnapshot() (~:627), topSuccessors(word) (~:883, O(1) live read;
        shared EMPTY array when absent), reset() (~:315 — wholesale drop incl.
        #capForms, #bigrams, successor index, ordinal).
  pattern: "head JSDoc ~:288-308 documents PURITY EQUIVALENCE: reset() followed by
            branch replay ≡ fresh store — this battery pins that claim."
  gotcha: "NO public bigram-map dump exists. Successor-index equality = per-word
           topSuccessors(word) over the union of entries() keys ∪ sortedKeys().
           Only if a purity BUG requires comparing raw bigram counts: add an
           internal defensive dump method (RAM-only, grepsafe per
           test/no-persistence.test.ts) — never serialization."

- file: src/core/types.ts
  why: Candidate fields to compare (:21): key, capCount, lowerCount, capDisplay,
        structuralCapCount?, sessionCount, lastSeenOrdinal, firstSeenOrdinal,
        userTyped, properName, rankGroup. NOTE display was REMOVED (P1.M2.T1.S2)
        — casing lives in the tallies; do not expect a display field.
        Successor (:97): { next, count } today; P1.M1.T2.S2 adds series?/nextDisplay
        — compare with plain toEqual (additive fields compare automatically).
  gotcha: "#capForms (per-form counts) is private with no dump — tallies compare
           via Candidate fields only (accepted proxy)."

- file: src/pi/ingest.ts
  why: restoreFromHistory(pipeline, sessionManager, shouldAbort?, onSettled?) —
        the rebuilt path; processText — the incremental path; both funnel through
        the same gates/counters (the equivalence under test). flush(), and
        discardPending() (P2.M1.T1.S2).
  gotcha: "getBranch() arrives leaf→root; restoreFromHistory reverses a COPY. The
           fake sessionManager must return leaf→root (see
           test/helpers/session-fixture.ts asSessionManager: getBranch =
           [...entries].reverse())."

- file: plan/006_7bd0258da993/P2M1T2S1/PRP.md
  why: CONTRACT for the handler under test (implementing in parallel): guard →
        discardPending → claim.release → fresh restoreReady + sync rebind (widget
        composition around remembered inner OR sessionGate.arm) → background
        flush() → store.reset() → restoreFromHistory. Its OWN tests in
        test/index.test.ts cover handler mechanics (guard no-op, summaryEntry,
        registration discipline) — this battery must NOT duplicate those; it
        asserts the spec-09 purity/acceptance properties THROUGH the handler.
  gotcha: "If the landed handler differs from its PRP, test the actual code."

- file: test/index.test.ts
  why: Fake-ctx conventions: makeCtx(over) (fake ui: notify, addAutocompleteProvider,
        getEditorComponent, setEditorComponent; sessionManager: getBranch,
        getEntries), captured pi.on handlers fired as
        handler({type:'session_tree', newLeafId, oldLeafId}, ctx), startSession
        helper, fake SessionEntry message entries {type:'message',
        message:{role:'user'|'assistant', content:'…'}}.
  gotcha: "makeCtx is NOT exported — replicate a minimal fake ctx inside the
           battery file (copying ~30 lines beats a cross-file test export; the
           codebase favors local doubles)."

- file: test/helpers/session-fixture.ts
  why: parseSessionFixture / messageEntriesOf / asSessionManager — branch fixtures
        from JSONL; asSessionManager returns getBranch as REVERSED entries
        (leaf→root), exactly what restoreFromHistory expects.
- file: test/fixtures/sessions/
  why: Reusable transcripts (zendesk-lwlock.jsonl, nrel-chain.jsonl, prose.jsonl,
        large-100k.jsonl, zephyr-chain.jsonl). Prefer authoring a small inline
        fixture for surgical dead-branch/branch scenarios; reuse a JSONL for the
        incremental≡rebuilt sweep on realistic content.
- file: test/ingest-restore.test.ts
  why: restore-replay test idioms (vi.fn getBranch, onSettled awaiting).
- file: test/startup-gate.test.ts
  why: Gate-bound test idioms (bounded wait, forced requests, rejected-never-wedges)
        — adapt to index level for the during-replay query bullet.
- file: test/widget.test.ts (+ test/widget-visibility.test.ts)
  why: Widget double idioms; claim/release observables; isWidgetWrapper/
        widgetOptsOf seams for the rebind assertions.
- file: test/ingest-pipeline.test.ts
  why: Injected-timer debounce control — needed to hold texts inside the 300 ms
        window for the queue-discard bullet.

- docfile: plan/006_7bd0258da993/P2M1T2S2/research/notes.md
  why: Verified line anchors, equality-helper design, boundary decisions, full
        battery outline (A/B/C).
```

### Current Codebase tree (relevant slice)

```bash
src/core/store.ts            # READ: entries/sortedKeysSnapshot/topSuccessors/reset
src/core/types.ts            # READ: Candidate (no display!), Successor
src/pi/ingest.ts             # READ: restoreFromHistory/processText/flush/discardPending
src/pi/provider.ts           # READ: createStartupGate/arm (≤500 ms, forced incl.)
src/pi/index.ts              # READ: session_tree handler (lands from T2.S1)
test/index.test.ts           # READ: makeCtx/startSession idioms (replicate locally)
test/helpers/session-fixture.ts  # READ: asSessionManager (getBranch = reversed)
test/branch-purity.test.ts   # CREATE: the battery
```

### Desired Codebase tree with files to be added/changed

```bash
test/branch-purity.test.ts   # CREATE — the entire battery (A/B/C describes)
# (src/core/store.ts: only if PROVEN necessary — internal defensive bigram dump,
#  RAM-only, grepsafe)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: no serialize/deepEqual helper exists. Build storeState() locally:
//   { entries: [...store.entries()].sort(byKey),
//     sortedKeys: store.sortedKeysSnapshot(),
//     successors: for each word in union(entries.keys, sortedKeys):
//                  [...store.topSuccessors(word)] }
//   Compare with expect(a).toEqual(b). Successor arrays are already
//   count-desc/byte-lex ordered by construction — no extra sort needed.
// CRITICAL: Candidate has NO display field (removed P1.M2.T1.S2) — casing state
// is capCount/lowerCount/capDisplay. Compare the whole entry object with toEqual;
// structuralCapCount is internal-but-present (undefined ≡ 0 — determinism must
// reproduce it identically; if flaky, normalize `?? 0` before compare).
// CRITICAL: getBranch() must be faked leaf→root (REVERSED file/message order) —
// restoreFromHistory reverses it back. Forgetting the reversal silently swaps
// lastSeenOrdinal/firstSeenOrdinal — the equality assert will catch it, but the
// fixture authoring bug will look like a purity failure. Get it right upfront.
// CRITICAL: ordinals — incremental assigns one nextOrdinal per message_end; the
// rebuilt path replays the same message count → identical ordinals ONLY if the
// fake branch contains exactly the same messages (and non-message entries are
// filtered, not counted — include one in the fixture to pin that filtering).
// CRITICAL: the background rebuild is fire-and-forget — every post-fire content
// assertion needs vi.waitFor(...) (or await the gate's settled promise).
// CRITICAL: debounce control — to hold a text inside the 300 ms window, use the
// injected-timer pattern from test/ingest-pipeline.test.ts / fake timers; firing
// session_tree must discard it BEFORE it drains (real timers may drain first —
// flake source; always inject/advance timers deterministically).
// CRITICAL: live topSuccessors() arrays handed out BEFORE reset are detached by
// design (store.ts ~:308) — never compare a pre-reset captured array.
// CRITICAL: don't duplicate T2.S1's handler-mechanics tests (guard no-op beyond
// the getBranch-count pin, summaryEntry, provider re-registration discipline) —
// this battery asserts spec-09 PROPERTIES through the handler.
// CRITICAL: test/no-persistence.test.ts greps src/ for forbidden APIs — any
// bigram dump added to store.ts must be a plain in-memory method (no fs, no
// JSON.stringify of state to disk, no localStorage).
// GOTCHA: battery header MUST record: "Live version of integration item 9
// (spec 09 h2.60) runs in P3.M1.T2.S3."
// GOTCHA: no linter; `npm run check` (tsc --noEmit) is the only static gate.
```

## Implementation Blueprint

### Data models / structure

Test-only. Local helpers in `test/branch-purity.test.ts`:

```ts
function storeState(store: CandidateStore) {
  const entries = [...store.entries()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const words = new Set<string>([
    ...entries.map((e) => e.key),
    ...store.sortedKeysSnapshot(),
  ]);
  const successors = new Map<string, readonly Successor[]>();
  for (const w of words) successors.set(w, [...store.topSuccessors(w)]);
  return { entries, sortedKeys: store.sortedKeysSnapshot(), successors };
}

function makeBranchCtx(entries: FixtureEntry[]) // minimal fake ctx modeled on
// test/index.test.ts makeCtx: sessionManager.getBranch = () => [...entries].reverse()
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ the landed code
  - READ src/pi/index.ts (the ACTUAL session_tree handler from T2.S1 — landing in
    parallel; its PRP is the contract), src/core/store.ts (reset/entries/
    sortedKeysSnapshot/topSuccessors), test/index.test.ts (makeCtx idiom),
    test/helpers/session-fixture.ts, test/ingest-restore.test.ts.

Task 1: CREATE test/branch-purity.test.ts — header + helpers
  - HEADER comment: cite spec 09 h2.59's three "Branch …" bullets (store purity /
    branch rebuild / branch rebind), spec 06 h2.42 + 05 h2.36-37, and:
    "Live version of integration item 9 (spec 09 h2.60) runs in P3.M1.T2.S3."
  - ADD storeState() + makeBranchCtx() + a startSession-style bootstrap that
    replicates test/index.test.ts's fake-ctx/handler-capture idiom (do NOT export
    anything from index.test.ts; copy the ~30 lines).

Task 2: DESCRIBE A — core purity (store/pipeline level)
  - CASE A1 "replaying a fixed sequence twice yields identical stores": two fresh
    (pipeline, store) pairs; feed the same message sequence through
    processText (one per message, distinct texts incl. a capitalized word, a
    user-typed word, bigram-bearing lines per spec 06 h3.6 window rules);
    expect(storeState(a.store)).toEqual(storeState(b.store)).
  - CASE A2 "incremental ≡ rebuilt": pipeline A ingests messages M1..Mn via
    processText; store B (same pipeline instance or a twin): store.reset() then
    restoreFromHistory(pipeline, fakeSessionManager(getBranch=[Mn..M1] reversed))
    with onSettled awaited → expect(storeState(built-incrementally))
    .toEqual(storeState(rebuilt)). Include casing-tallied words (mid-cap vs
    lower vs structural-cap occurrences) and bigram lines; equality covers
    tallies + successor index (whatever fields are present).
  - CASE A3 "no dead-branch words survive, nothing double-counts": ingest M_dead
    (rare word 'zorpwibbletypo') then the branch M1..Mn containing a SHARED word
    also present in M_dead's line → after reset+replay of M1..Mn:
    store.get('zorpwibbletypo') undefined; shared word's sessionCount equals its
    count within M1..Mn alone (not summed).

Task 3: DESCRIBE B — handler acceptance (index level, fake ctx)
  - FOLLOW pattern: captured session_tree handler fired as
    handler({type:'session_tree', newLeafId:'n1', oldLeafId:'o1'}, ctx).
  - CASE B1 "queue discard never loses or double-counts live words": with
    injected/fake timers, enqueue an undrained message_end whose text contains
    a word ALSO on the new branch, plus one whose word is dead-branch-only;
    fire session_tree; advance timers / vi.waitFor settle → live word present
    exactly once with branch-derived counts; dead word absent.
  - CASE B2 "newLeafId === oldLeafId skips": fire {x, x} and {null, null} →
    getBranch mock call-count unchanged, store content unchanged.
  - CASE B3 "queries during replay wait behind the gate INCLUDING forced
    requests (bounded ≤ 500 ms)": fire a real navigation with a getBranch whose
    replay is held (e.g. a deferred-continue fake or a large-ish fixture with
    controllable microtask pacing — simplest: a shouldAbort-free replay plus a
    manually un-resolved readiness seam if T2.S1 exposes one; otherwise pace via
    a big branch and fake timers); call the registered provider's
    getSuggestions during the window (plain AND {force:true}) → both resolve
    AFTER settle, within the 500 ms bound (fake-timer advance to 500 must
    release even if replay wedged), serving only branch vocabulary. Reuse
    test/startup-gate.test.ts bound idioms.
  - NOTE: do NOT re-test summaryEntry / provider re-registration / guard-null
    slots — T2.S1's own index.test.ts battery owns those.

Task 4: DESCRIBE C — widget rebind (spec 09 h2.59 widget bullet)
  - FOLLOW pattern: editorFactory installed (fake inner), startSession installs
    wrapper #1; open a visible suggestion to CLAIM the row (drive the widget
    double per test/widget.test.ts idioms); fire session_tree → assert:
    (a) the claim was released (claim double/spy: released === true),
    (b) setEditorComponent called again with a fresh widget wrapper whose
        widgetOptsOf(new).inner === originalInner (no stacking),
    (c) post-settle, a fragment typed through the new composition completes
        from branch vocabulary and NEVER from the abandoned-branch word.
  - GOTCHA: if claim/opts aren't reachable from the test seam in the landed
    widget API, assert the closest observable (row blank post-navigation before
    first-show; completion correctness) and note it in a comment.

Task 5: VALIDATE — full gate chain (below); run the suite TWICE (determinism
  pin is cheap insurance for a purity battery).
```

### Implementation Patterns & Key Details

```ts
// The equivalence under test (store.ts ~:288 JSDoc, spec 06 h2.42):
//   store built by message_end sequence  ≡  reset() + restoreFromHistory(branch)
// Both funnel through IngestPipeline.processText — same gates, same counters,
// same bigram capture, same eviction. The battery's job is to PROVE that at
// three levels: state equality (A), observable behavior through the handler
// (B), and user-visible widget surface (C).
// PATTERN: every post-fire assertion on content = await vi.waitFor(() => …)
// PATTERN: fake timers for debounce-window and 500 ms bound control
// CRITICAL: compare stores via storeState() snapshots NEVER via live
// topSuccessors arrays captured before a reset (detached by design).
```

### Integration Points

```yaml
TEST TREE:
  - CREATE test/branch-purity.test.ts (the battery)
SRC: none (exception path: internal store.ts bigram dump ONLY if a purity bug
     requires raw-bigram comparison — RAM-only, grepsafe)
EVIDENCE: passing battery = R3 completion evidence → P3.M1.T2.S4 DoD entry;
     live item 9 → P3.M1.T2.S3 (pointer in header)
SPEC: no edits (read-only input)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check        # tsc --noEmit — zero errors (tests are typechecked too)
```

### Level 2: Unit Tests (the deliverable itself)

```bash
npx vitest --run test/branch-purity.test.ts -v
npx vitest --run test/branch-purity.test.ts -v   # twice — determinism self-pin
npm test                                          # FULL suite — zero regressions
```

### Level 3: Sibling seams stay green

```bash
npx vitest --run test/index.test.ts test/ingest-restore.test.ts \
  test/startup-gate.test.ts test/ingest-pipeline.test.ts test/widget.test.ts
npx vitest --run test/no-persistence.test.ts   # any store.ts touch stays grepsafe
```

### Level 4: Contract validation (domain-specific)

```bash
# Coverage cross-check (manual): each spec 09 h2.59 bullet phrase maps to ≥1 test:
#   "replaying a fixed message sequence twice yields identical stores"  → A1
#   "incremental equals rebuilt; no dead-branch words; nothing double-counts" → A2/A3
#   "queue discard never loses or double-counts; texts re-captured"     → B1
#   "newLeafId === oldLeafId skips"                                      → B2
#   "queries during replay wait behind the bounded gate (forced incl.)"  → B3
#   "session_tree releases a claimed row and re-binds the widget"        → C
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run check` zero errors; `npm test` green twice (determinism)
- [ ] Battery covers every spec 09 h2.59 branch bullet (Level 4 map)

### Feature Validation
- [ ] Replay-twice identical; incremental ≡ rebuilt (tallies + successor index)
- [ ] Dead-branch words absent; shared words counted once (never summed)
- [ ] Queue discard: live texts re-captured once, dead texts dropped
- [ ] Equal-leaf no-op (getBranch not re-read); gate-bounded queries incl. forced
- [ ] Widget: claim released, fresh composition around original inner, branch-only
      completions post-navigation
- [ ] Header cites spec 09 bullets + P3.M1.T2.S3 live-item pointer

### Code Quality Validation
- [ ] Test-only diff; no src/ change unless the sanctioned internal dump was needed
- [ ] No duplication of T2.S1's handler-mechanics cases
- [ ] Local helpers only; no exports added to existing test files
- [ ] No spec/ or PRD.md edits; no-persistence suite green

## Anti-Patterns to Avoid

- ❌ Don't add a src/ serialize/deepEqual helper — storeState() lives in the test
- ❌ Don't fake getBranch oldest-first — it's leaf→root; restoreFromHistory reverses
- ❌ Don't assert on live topSuccessors arrays captured before a reset (detached)
- ❌ Don't rely on real timers for the debounce window or the 500 ms bound — inject
- ❌ Don't re-test handler mechanics T2.S1 already pins (summaryEntry, guards beyond
  the no-op observable, registration discipline)
- ❌ Don't skip vi.waitFor on fire-and-forget rebuild assertions
- ❌ Don't edit spec/, PRD.md, tasks.json, or any src file beyond the sanctioned
  (conditional) internal bigram dump
- ❌ Don't expect a Candidate.display field — it was removed; casing = tallies

---

**Confidence Score: 8/10** — every equality building block, seam, and convention was
verified by direct code reading; the handler under test is pinned by the T2.S1 PRP
contract. Residual risk: (a) exact landed shape of the session_tree handler and its
test observables (mitigated by Task 0: read actual code), (b) B3's replay-pacing
mechanism depends on what T2.S1 exposes for readiness control (two fallback pacing
strategies specified), (c) widget claim/opts seam reachability (fallback observables
specified).
