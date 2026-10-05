# Research notes — P2.M1.T2.S2 (Branch-purity + rebuild acceptance battery)

## Verified facts (read from code)

- `src/core/store.ts` public surface for equality building blocks:
  - `entries(): Candidate[]` (line ~657) — defensive copy of word candidates.
  - `sortedKeysSnapshot(): string[]` (line ~627) — prefix-index keys.
  - `topSuccessors(word): readonly Successor[]` (line ~883) — O(1) read of the
    live top-3 successor array (hands out the shared EMPTY array when absent).
  - NO public bigram-map dump exists (`#bigrams` is private; grep confirms no
    `bigramEntries`/`dumpBigrams`). Successor-index equality via
    per-word `topSuccessors(word)` over the union of `entries()` keys +
    `sortedKeysSnapshot()` is the sanctioned proxy; the raw bigram map is
    compared only through this lens (item contract explicitly allows this).
- `Candidate` (src/core/types.ts:21) compared fields: key, capCount, lowerCount,
  capDisplay, structuralCapCount?, sessionCount, lastSeenOrdinal,
  firstSeenOrdinal, userTyped, properName, rankGroup. NOTE: `display` was
  REMOVED (P1.M2.T1.S2) — casing lives in the tallies. `structuralCapCount` is
  internal-but-present; include it in deepEqual (undefined ≡ 0 — normalize
  before comparing or compare raw since determinism should reproduce undefined
  identically).
- `Successor` (types.ts:97): `{ next, count }`. Series bigrams (P1.M1.T2.S2,
  status Ready, not landed) will add `series?: boolean, nextDisplay?: string`
  per spec 06 h3.7 — the battery must compare "with whatever fields are
  present" (deepEqual on the arrays handles additive fields automatically).
- Casing tallies ARE landed (capCount/lowerCount/capDisplay + #capForms).
  #capForms (per-form counts) is private with no dump — compare via the
  Candidate tally fields only (accepted proxy; determinism of #capForms is
  implied by capDisplay/capCount determinism).
- `reset()` landed (P2.M1.T1.S1): wholesale drop incl. #capForms, #bigrams,
  successor index, ordinal; live topSuccessors arrays handed out before reset
  are detached (store.ts ~:288-308 JSDoc).
- `src/pi/provider.ts`: `createStartupGate(base, ready, maxWaitMs = 500)` →
  `T & StartupGateHandle` with `arm(newReady)`. Gate is per-arming bounded;
  forced requests included (JSDoc ~:786-826).
- `src/pi/ingest.ts`: `restoreFromHistory(pipeline, sessionManager,
  shouldAbort?, onSettled?)`; getBranch() leaf→root, reversed copy inside;
  onSettled exactly once (finish/abort/throw). `flush()` public.
  `discardPending()` landed from P2.M1.T1.S2.
- `src/pi/index.ts` session_tree handler: being implemented in parallel by
  P2.M1.T2.S1 (its PRP is the contract): guard (disabled/null slots/
  newLeafId===oldLeafId) → discardPending → claim?.release() → fresh
  restoreReady + sync rebind (widget composition around remembered inner, or
  sessionGate.arm) → background `flush() → store.reset() → restoreFromHistory`.
- Test conventions:
  - `test/index.test.ts`: makeCtx(over) fake ctx (ui: notify,
    addAutocompleteProvider, getEditorComponent, setEditorComponent;
    sessionManager: getBranch/getEntries); captured pi.on handlers; fake
    SessionEntry message entries `{type:'message', message:{role, content}}`;
    startSession helper; describe titles cite spec sections. NOTE: T2.S1's
    PRP adds its own `describe("session_tree — …")` battery there — the
    HANDLER mechanics tests live there; THIS battery is the spec-09-mandated
    PURITY + ACCEPTANCE assertions, a separate file: `test/branch-purity.test.ts`.
  - `test/helpers/session-fixture.ts`: parseSessionFixture,
    messageEntriesOf, asSessionManager (getBranch = reversed entries).
  - `test/fixtures/sessions/`: large-100k.jsonl, nrel-chain.jsonl, prose.jsonl,
    zendesk-lwlock.jsonl, zephyr-chain.jsonl (+ expected.md, RESULTS.md).
  - `test/ingest-restore.test.ts`: restore-replay test idioms (vi.fn getBranch).
  - `test/no-persistence.test.ts`: greps src for forbidden APIs — if an
    internal bigram dump is added to src/core/store.ts it must be RAM-only
    (no fs/serialization) and stays grepsafe (a plain method is fine).
  - `test/startup-gate.test.ts`: gate bound/forced-request test idioms.
  - `test/widget.test.ts`: widget doubles; claim/release observables.
- spec 09 bullets this battery implements (h2.59): store.test.ts "Branch
  purity" bullet (replay-twice identical; incremental vs getBranch-snapshot
  rebuild equal, no dead-branch words, nothing double-counted); provider.test.ts
  "Branch rebuild" bullet (queue discard never loses/double-counts live words;
  equal-leaf skip; queries during replay wait behind bounded gate); widget.test.ts
  "Branch rebind" bullet (claimed row released; widget reads new pipeline).
  The LIVE version of integration item 9 is P3.M1.T2.S3 (record pointer in header).
- "Incremental vs rebuilt" wiring detail: incremental = message_end ingest via
  the real pipeline; rebuilt = store.reset() + restoreFromHistory over a
  getBranch() snapshot containing the same messages. Both go through
  IngestPipeline.processText → identical gates/counters/bigram capture
  (store.ts :288 JSDoc: "PURITY EQUIVALENCE: reset() followed by replaying the
  branch [≈ a fresh store]").

## Boundary decisions

- New file `test/branch-purity.test.ts` hosts the battery (header cites spec 09
  bullets + P3.M1.T2.S3 pointer). A few provider/widget-scoped assertions can
  ride in their existing files, but one file keeps the battery legible as a unit
  — prefer one file, reusing makeCtx-style doubles locally or importing
  patterns from test/index.test.ts (doubles there aren't exported; replicate a
  minimal fake-ctx inside the battery file, or export nothing — replicate).
- Equality helper (local to the battery): `storeState(store)` →
  { entries: store.entries() (sorted by key), sortedKeys: sortedKeysSnapshot(),
  successors: Map word→topSuccessors(word) for union of keys }. deepEqual via
  vi.expect(...).toEqual — deterministic ordering: sort entries by key; sort
  successor arrays are already count-desc/byte-lex ordered by construction.
- Ordinals: incremental path assigns ordinals via nextOrdinal per message_end;
  rebuilt path replays the same message count → same ordinals. Fixture must
  contain ONLY message entries (getBranch in real pi includes non-message
  entries which restoreFromHistory filters — include one to be faithful).
- Dead-branch scenario for "no dead-branch words survive": ingest a
  message_end containing distinctive rare word (e.g. "zorpwibblemisspell")
  NOT present in the fake branch, then fire session_tree → word absent after
  settle. Double-count scenario: a word present BOTH in a pre-navigation
  message_end AND in the branch snapshot → after rebuild its sessionCount
  equals the branch-only count (not summed).
- Queue-discard bullet: enqueue message_end text (inside 300 ms debounce
  window, undrained) whose word IS on the new branch → after rebuild the word
  appears exactly once with branch-derived counts (snapshot re-captured it);
  and an undrained text from the dead branch → absent. Need control of the
  debounce: IngestPipeline takes debounce/timer options (test/index.test.ts
  fake-timer idioms; ingest.test.ts uses injected timers — reuse).
- Gate bullet: during the replay window, call the registered provider's
  getSuggestions (incl. `force: true`) → resolves only after settle and within
  ≤ 500 ms (fake timers advance). Reuse test/startup-gate.test.ts idioms at the
  index level.
- Widget bullet: after session_tree with an editorFactory installed,
  setEditorComponent re-invoked with a fresh widget wrapper (assert
  widgetOptsOf(new).inner === original inner; the new factory's store option
  is the same in-place store — verify via widgetOptsOf(newFactory) if options
  are exposed, else assert a fragment typed through a simulated widget
  composition completes from branch words). Claim release: claim.release
  observable via the claim object captured in options.
- P1 series-bigram dependency: compare successor arrays with toEqual —
  additive fields (series/nextDisplay) are compared automatically when they
  land; assert "with whatever fields are present" = plain deepEqual, no
  field allow-listing.

## Test plan (battery outline)

A. Core purity (store-level, no pi wiring)
 1. Replay determinism: build store from fixed Sighting/message sequence twice
    (two fresh stores) → storeState equal.
 2. Incremental vs rebuilt: pipeline A ingests messages via processText
    (message_end shape); store B: reset() + restoreFromHistory(getBranch
    snapshot of same messages) → storeState equal (tallies + successor index
    included).
 3. No dead-branch survival + no double-count (via the wired handler at index
    level, or core-level reset+replay equivalence).
B. Handler battery (index level, fake ctx)
 4. Queue discard: undrained live-branch text re-captured (appears once,
    branch counts); undrained dead-branch text absent.
 5. newLeafId === oldLeafId skip (no getBranch re-read — call-count pin).
 6. Queries during replay (incl. force:true) wait behind the gate, ≤ 500 ms,
    then serve branch vocabulary only.
 7. summaryEntry never ingested (riding assertion — S1 also pins it; keep one
    here for battery completeness? NO: avoid duplicating S1's case — battery
    covers only spec-09 bullets; S1's own tests cover summaryEntry. Skip.)
C. Widget
 8. session_tree releases claimed row + rebinds widget to rebuilt store.
D. Header pointer: LIVE item 9 = P3.M1.T2.S3.
