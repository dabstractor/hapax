# PRP — P1.M1.T1.S1 (bugfix 001_140e40041dd1): Replace the index.ts bare-key shim with the enriched runs pass-through

---

## Goal

**Feature Goal**: Wire the enriched RunMember runs payload at the sole
production seam — replace index.ts's transitional `.map(r => r.map(m => m.key))`
projection with `onAdmittedTokens: (runs) => sessionStore.recordBigramRuns(runs)`
— so series marks, run casing, and chain-only members actually reach the
store in a real session (BUG-001's root fix; the store and ingest sides are
already complete and shipped).

**Deliverable**:
- `src/pi/index.ts` (~lines 237–250): pass-through wiring + rewritten
  comment block (remove the "until P1.M1.T2.S2" transitional language)
- `src/pi/ingest.ts` (~lines 427–451 onAdmittedTokens JSDoc area): remove
  the shim's "byte-identically until P1.M1.T2.S2" language, describe the
  enriched payload as live
- `test/index.test.ts` (~lines 447–462): flip the spy pin from
  `toEqual([["alpha","beta","gamma"]])` to the enriched RunMember shape

**Success Definition**: TDD-first — the extended index.test.ts spy test
asserts enriched members for a capitalized-run message; the one-line
production change makes it green; end-to-end, a `'The Fed raised rates'`
history yields `topSuccessors('the')` entries with `series: true` and
`nextDisplay: 'Fed'` (probe, not necessarily a new committed test — the
e2e acceptance layer is P1.M1.T2). Full `npm run check` + `npm test` green.
The other mirrored test shims (acceptance, adversarial-typing, bigrams,
chain, perf-gates, successors, chaining-gating, ingest-pipeline) are
**P1.M1.T1.S2's scope — do NOT touch them here**.

## Why

The store's `recordBigramRuns` (src/core/store.ts:735–744) already accepts
`readonly (readonly (RunMemberInput | string)[])[]` and only marks a pair
series when BOTH members are enriched objects with `series === true`; the
provider (provider.ts:604) and widget (widget.ts:1021) already gate
typed-word chain arming on `topSuccessors(word).some(s => s.series)`. But
index.ts:241–248 — the ONLY production feed — still projects every member
to a bare lowercase string, so in real sessions no bigram is ever
series-marked: typed-word chain arming, series-first ordering, run-casing
display, and /acwords `(series)` markers are all dead end-to-end
(live-verified through the real factory: typing "The " leaves the chain
null with the shim; arms + paints "Fed" with the enriched payload). The
shim's own comment says it stays "until P1.M1.T2.S2" — that task is
Complete. Every existing test fabricates the store directly or mirrors the
same stale shim, which is why the suite is green while the feature is dead.

## What

- index.ts: replace the projection with the direct pass-through, INSIDE
  the existing `...(config.enableChaining ? { ... } : {})` spread (never
  move it out — chaining-off sessions must not record bigrams).
- Comments: rewrite index.ts's "Plan 006 widening ... the shim projects
  keys ... until P1.M1.T2.S2" block (:237–240) and ingest.ts's
  onAdmittedTokens JSDoc transitional sentence to describe the enriched
  payload as the live production contract (Mode A).
- Test: flip test/index.test.ts:462's `toEqual([["alpha","beta","gamma"]])`
  to the RunMember-object shape; extend with a capitalized-run message
  asserting `{key, rawCasing, series: true}` members.

### Success Criteria

- [ ] index.ts passes `runs` unprojected to `recordBigramRuns`, inside the
      enableChaining spread (grep: no `.map((m) => m.key)` left in index.ts)
- [ ] Spy test: `"alpha beta gamma"` message → members are RunMember
      OBJECTS (with `rawCasing`; no `series` flag for lowercase non-run
      members — assert shape, not strings)
- [ ] Spy test (new case): capitalized-run message (dict-absent words,
      e.g. `"Alpha Beta gamma"`) → run pair members carry
      `series: true` and `rawCasing: "Alpha"` / `"Beta"`; `gamma` carries
      no series flag
- [ ] Stale "until P1.M1.T2.S2" language gone from index.ts AND ingest.ts
- [ ] `enableChaining: false` case (:464+) still green (hook unwired)
- [ ] `npm run check` + `npm test` green
- [ ] NO other test files modified (mirrored-shim un-shimming is S2)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the exact current wiring,
the receiving store signature, the payload type, the test to flip, and the
explicit out-of-scope list are all reproduced below from live source.

### Documentation & References

```yaml
- file: src/pi/index.ts
  why: THE production seam. Verified current state (lines ~230–250):
      // Plan 006 widening: the payload now carries RunMembers
      // ({key, rawCasing, series?}) — the shim projects keys so
      // recordBigramRuns' input stays byte-identical until P1.M1.T2.S2
      // consumes the enrichment (series casing + cap-run marks).
      ...(config.enableChaining
        ? {
            onAdmittedTokens: (runs) =>
              sessionStore.recordBigramRuns(
                runs.map((r) => r.map((m) => m.key)),
              ),
          }
        : {}),
    Preceding comment block (~:225–236) explains WHY the hook is inside
    the enableChaining spread (bigram layer gated; keep it verbatim).
  pattern: REPLACE the 4-line projection body with
      onAdmittedTokens: (runs) => sessionStore.recordBigramRuns(runs),
    and REWRITE the "Plan 006 widening" comment to state the enriched
    payload is now passed through live (RunMember objects with series
    marks reach the store; bare-string legacy feeders remain accepted).
  gotcha: keep the enableChaining conditional spread EXACTLY as is —
    moving the hook out would record bigrams in chaining-off sessions.

- file: src/core/store.ts
  why: The RECEIVER — already widened; NO changes. Verified signature
    (recordBigramRuns, lines 735–744):
      recordBigramRuns(runs: readonly (readonly (RunMemberInput | string)[])[]): void
    Semantics: string members accepted (legacy); a pair is SERIES-marked
    iff BOTH members are enriched objects with series === true; w1/w2 keys
    read via `typeof m === "string" ? m : m.key`.
  gotcha: do not "simplify" the store's string/object duality — other
    feeders (tests, legacy) still pass bare strings.

- file: src/pi/ingest.ts
  why: The PAYLOAD PRODUCER — NO logic changes, only JSDoc. Verified:
    - RunMember interface (:106–~130): { key (lowercase store key),
      rawCasing (token casing as seen, e.g. "National"), series?
      (true iff member of a detected ≥2-member capitalized run),
      chainOnly? (top-band member: stays in the payload, never upserted) }.
    - The hook type (:451): onAdmittedTokens?:
      (runs: readonly (readonly RunMember[])[]) => void.
    - The JSDoc transitional sentence to remove sits in the ~:427–443
      comment region describing the shim (grep
      `byte-identically\|until P1.M1.T2.S2` in this file).
    - Emit site: processText's `this.#onAdmittedTokens?.(runs)` — once
      per message, members carry series marks from detectCapRuns.
  gotcha: read the RunMember doc comment — chainOnly members are IN the
    runs payload by design (their bigrams form; the words never store).

- file: test/index.test.ts
  why: The pin to flip + extend. Verified current test (:447–462,
    "enableChaining true (default) wires the hook — bigrams land in the
    store"): uses `useDict()` (alpha/beta/gamma dict-absent → admitted),
    `wired()`, `vi.spyOn(CandidateStore.prototype, "recordBigramRuns")`,
    fire-and-forget drain handled via `vi.waitFor` + a `mock.calls.find`
    filtered to THIS session's message (the prototype spy is shared across
    store instances — KEEP that filtering pattern; restore-drains from
    earlier tests can land in the window).
    Current pin: `expect(call[0]).toEqual([["alpha","beta","gamma"]]);`
    → flip to the RunMember-object shape (with `rawCasing: "alpha"` etc.,
    no series flag). ADD a second case with `"Alpha Beta gamma"` asserting
    the run pair's `series: true` + `rawCasing` fields.
  pattern: harness is fakePi/fakeCtx (`wired()`, `startSession`,
    `endMessage`, `userMsg`) — no new mocking.

- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/bug001-series-pipeline.md
  section: §3 (the seam analysis)
  why: The verified recon: store accepts RunMemberInput, ingest's
    RunMember is structurally compatible, the shim is the only blocker;
    also the live repro ("The Fed raised rates" → topSuccessors entries
    without/with series+nextDisplay).

- prd: BUG-001 description + Recommendations (selected_prd_content
    above) — the fix is literally the recommendation's first clause;
    the mirrored-fixture updates and the e2e layer are S2/T2 by the
    task tree.
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/pi/index.ts       # MODIFY (wiring + comment)
├── src/pi/ingest.ts      # MODIFY (JSDoc only)
├── src/core/store.ts     # NO CHANGE (receiver already widened)
└── test/index.test.ts    # MODIFY (flip pin + enriched case)
   OUT OF SCOPE (S2's mirrored shims — grep-verified sites):
   test/acceptance.test.ts:740, test/adversarial-typing.test.ts:472,
   test/bigrams.test.ts:118/140/240, test/chain.test.ts:751,
   test/perf-gates.test.ts:496, test/successors.test.ts:70,
   test/chaining-gating.test.ts:143, test/ingest-pipeline.test.ts:34
```

### Known Gotchas of our Codebase & Library Quirks

```python
# CRITICAL — scope discipline: the bare-string shim ALSO lives in 9 test
#   files (list above). recordBigramRuns ACCEPTS bare strings, so those
#   suites stay green with the production seam fixed — but they keep
#   testing the legacy input shape. Un-shimming them + asserting series
#   fields through ingest is P1.M1.T1.S2. Touching them here is scope
#   creep that risks churn conflicts.
# GOTCHA — the prototype spy is SHARED across store instances; the
#   existing vi.waitFor + find-filter-to-this-message pattern exists
#   because earlier tests' fire-and-forget restore drains land in the
#   window. Keep it; your new capitalized-run case needs the same guard.
# GOTCHA — assert RunMember SHAPE not strings, but don't over-pin:
#   non-run lowercase members are objects with {key, rawCasing} and NO
#   series key. Use toEqual on the member objects (toEqual treats
#   undefined-absent as equal, but series is genuinely ABSENT — construct
#   expected objects without the field) or field-wise picks.
# GOTCHA — chainOnly members (top-band, e.g. "The") never upsert but DO
#   appear in the runs payload — your "Alpha Beta gamma" case uses
#   dict-absent words precisely to avoid the chainOnly branch; keep it
#   that way here (T2's e2e layer covers 'The Fed').
# GOTCHA — comments ride with the code (Mode A): both comment rewrites
#   (index.ts, ingest.ts) are deliverables, not optional polish.
# GOTCHA — fire-and-forget debounce: endMessage arms a 300 ms timer;
#   the existing test's waitFor pattern handles it — reuse, don't
#   hand-roll sleeps.
```

## Implementation Blueprint

### Data models and structure

No model changes — RunMember (ingest.ts:106) and
RunMemberInput|String (store.ts:735) already align structurally. The
change is one projection removal.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — extend test/index.test.ts FIRST
  - FLIP the :462 pin: expect(call[0]).toEqual([[
      { key: "alpha", rawCasing: "alpha" },
      { key: "beta",  rawCasing: "beta" },
      { key: "gamma", rawCasing: "gamma" },
    ]]);
    (adjust field names to the actual RunMember emission — run the test
    against the CURRENT shim to see it fail with the true expected shape
    in the diff if uncertain; the store accepts strings so the spy sees
    the payload BEFORE the store: members will be RunMember objects
    already today — the projection lives in index.ts, AFTER the spy
    boundary. CONFIRM by reading the diff when RED.)
  - ADD case: "capitalized-run members carry series marks through the
    production seam":
      useDict(); wired(); spy; startSession;
      await endMessage(..., userMsg("Alpha Beta gamma"));
      vi.waitFor(() => spy.mock.calls.some(([runs]) =>
        runs.flat().some((m) => m.key === "alpha")));
      const call = ...find filtered to alpha...;
      expect(call[0]).toEqual([[
        { key: "alpha", rawCasing: "Alpha", series: true },
        { key: "beta",  rawCasing: "Beta",  series: true },
        { key: "gamma", rawCasing: "gamma" },
      ]]);
    (If detectCapRuns requires the run's gap to be plain space in raw
    text — it is here. If the exact flags differ, read the spy's actual
    payload and pin THAT — the contract is "series members marked,
    non-run member unmarked".)
  - RUN → RED (the shim strips the fields before the store... verify
    which side of the spy the projection sits; if the spy already sees
    objects, RED comes instead from topSuccessors assertions — in that
    case add the store-level assertion:
      expect(sessionStore-or-captured-store.topSuccessors("alpha"))
        .toEqual([{ next: "beta", count: 1, series: true, nextDisplay: "Beta" }]);
    adapting to what the harness exposes.)
  - KEEP the enableChaining:false case (:464+) untouched and green.

Task 2: IMPLEMENT src/pi/index.ts
  - Replace the projection: onAdmittedTokens: (runs) =>
    sessionStore.recordBigramRuns(runs),
  - REWRITE the "Plan 006 widening ... until P1.M1.T2.S2" comment block:
    the enriched payload now passes through live; series marks + run
    casing + chain-only members reach recordBigramRuns; bare-string
    feeders remain accepted (legacy/test).
  - PRESERVE the enableChaining spread and its preceding rationale comment
    (:225–236) verbatim.

Task 3: JSDoc sync in src/pi/ingest.ts
  - Locate the onAdmittedTokens transitional language (grep
    "P1.M1.T2.S2" / "byte-identical" in this file, ~:427–443 region);
    rewrite to state index.ts passes the enriched runs through (the
    production contract), removing the shim-era sentence.

Task 4: FULL REGRESSION
  - npm run check
  - npm test   # every suite green — the 9 mirrored test shims pass bare
               # strings, which recordBigramRuns still accepts
  - grep -n "m.key" src/pi/index.ts → zero hits
```

### Implementation Patterns & Key Details

```typescript
// The entire production change:
...(config.enableChaining
  ? {
      onAdmittedTokens: (runs) => sessionStore.recordBigramRuns(runs),
    }
  : {}),

// End-to-end probe (Level 4): with a real 'The Fed raised rates' history
// through the factory, the session store yields
//   topSuccessors('the') → [{ next: 'fed', count: 1, series: true, nextDisplay: 'Fed' }]
// ('the' is top-band chainOnly — in the payload, never stored as a word).
```

### Integration Points

```yaml
PRODUCTION CONSUMERS (already shipped, now live end-to-end):
  - provider.ts:604 + widget.ts:1021 — typed-word arming gate
    (topSuccessors(word).some(s => s.series)) starts firing.
  - debug.ts:134-135 — /acwords '(series)' markers start rendering.
NEXT TASKS (do NOT implement):
  - P1.M1.T1.S2: un-shim the 9 mirrored test pipelines + assert series
    fields through ingest.
  - P1.M1.T2.S1/S2: production-composition acceptance layer (series
    arming e2e, widget typed-arming e2e, /acwords markers, live TTY).
NO CHANGES: store.ts, ingest.ts logic, provider.ts, widget.ts, debug.ts,
  config.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check
grep -n "m.key" src/pi/index.ts   # zero hits — shim gone
```

### Level 2: Unit Tests (TDD)

```bash
npx vitest --run test/index.test.ts            # flipped + enriched cases green
npx vitest --run test/index.test.ts -t "series" -v
npm test                                        # full suite green (mirrored shims unaffected)
```

### Level 3: Integration (downstream layers, unchanged code)

```bash
npx vitest --run test/chain.test.ts test/successors.test.ts test/chaining-gating.test.ts test/acceptance.test.ts
# all green via the string-accepting store duality
```

### Level 4: Domain-Specific (end-to-end probe of the live seam)

```bash
# Reproduce the PRD's live verification: real factory + 'The Fed raised rates'
# history → session store topSuccessors('the') has series:true + nextDisplay:'Fed'.
# Quickest existing harness: the index.test.ts fakePi/fakeCtx composition —
# add a temporary assertion (or keep it as the Task-1 store-level pin):
npx vitest --run test/index.test.ts -t "wires the hook"
```

## Final Validation Checklist

- [ ] index.ts passes enriched runs unprojected, inside the enableChaining spread
- [ ] Comment block rewritten (no "until P1.M1.T2.S2" language); ingest.ts JSDoc synced
- [ ] test/index.test.ts pin flipped to RunMember-object shape; capitalized-run series case added
- [ ] enableChaining:false case still green; spy's shared-instance filtering preserved
- [ ] Store-level enrichment observable (series:true + nextDisplay) through the production seam
- [ ] Zero modifications to the 9 mirrored test shims (S2 scope)
- [ ] `npm run check` + `npm test` green

## Anti-Patterns to Avoid

- ❌ Don't move the hook out of the enableChaining spread (bigrams must stay gated)
- ❌ Don't un-shim the mirrored test pipelines here (P1.M1.T1.S2)
- ❌ Don't touch store.ts, ingest.ts logic, provider/widget/debug consumers (all shipped)
- ❌ Don't remove recordBigramRuns' string-member duality (legacy feeders depend on it)
- ❌ Don't drop the spy's cross-instance filtering (shared prototype spy race)
- ❌ Don't add sleeps — reuse the vi.waitFor drain pattern

---

**Confidence Score**: 9/10 — the seam, receiver signature, payload type,
test-to-flip, and the exact out-of-scope shim list were all verified
against live source this session; the change is one line plus comments and
one flipped pin, with the only uncertainty (which side of the spy the
projection sits) handled by a read-the-diff instruction in Task 1.
