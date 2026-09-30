# PRP — P1.M1.T1.S1 (bugfix 001_1a2f4ffe408f): Expose the accepted candidate's key and tier on the visibility snapshot

---

## Goal

**Feature Goal**: Widen the widget visibility machine's public surface so
the Tab-insert call site (`insertHighlighted`, widget.ts ~841) can read the
accepted item's `{key, display, tier}` exactly the way the fallback
provider's `applyCompletion` does — the prerequisite for P1.M1.T1.S2's
chain arming (tier-0 matches never arm; spec §04 "Successor chaining stays
anchored everywhere").

**Deliverable**: A typed, test-stable contract on
`createVisibilityMachine`'s return exposing the currently painted
RankedMatch records. Recommended design (primary): a new machine accessor
`painted(): readonly RankedMatch[]` alongside `state()`. Accepted
alternative: enrich `VisibilityState.currentSet` entries to
`{display, key, tier}` — but that requires updating ~15 exact-shape
`toEqual([{ display: ... }])` assertions (see Gotchas).

**Success Definition**: `test/widget-visibility.test.ts` and
`test/widget.test.ts` stay green as-is with the accessor design
(type-only widening, zero assertion churn); `npm run check` green; the
accessor returns records aligned 1:1 with `VisibilityState.currentSet`
(same order, same lifetime — populated on paint, cleared on hide) carrying
`key`, `display`, and `tier` per item.

## Why

BUG-001 (Major): chained completion is structurally dead on the widget
PRIMARY path — `insertHighlighted` documents "CHAIN ARMS: NEVER (plan 004)"
and never classifies the accepted item. The provider path's arming logic
(provider.ts applyCompletion ~639–706) classifies via a value→key map plus
`tier` (tier-0 → never arm). The widget paints full `RankedMatch` records
internally (paint receives `items: readonly RankedMatch[]`, widget.ts
~522–535) but throws away everything except `display`
(`currentSet = items.map((m) => ({ display: m.display }))`, line 529) — so
the Tab-insert site cannot see key or tier. This task restores the data
flow; S2 adds `chain.arm` on top of it, S3 inverts the no-arm pin.

## What

- Add `painted(): readonly RankedMatch[]` to the `VisibilityMachine`
  interface (widget.ts ~366–372, beside `onInput()`/`getState()`).
- Internally, keep a `let paintedSet: readonly RankedMatch[] = []` updated
  exactly where `currentSet` is updated: set to `items` in `paint()`
  (line ~529 area), cleared to `[]` in `hide()` (line ~505 area, where
  `currentSet = []`). `closeWith` delegates to `hide()` — no third site.
- Return it from `painted()`. Records are the machine's own
  `RankedMatch[]` (already type-carries optional `tier` from plan 004's
  query change) — do NOT copy/strip; the array is never handed out
  mutably except that callers could mutate elements — clone defensively
  only if trivial (`[...items]` at paint time is enough; RankedMatch
  fields are treated as immutable everywhere in this codebase).
- JSDoc (Mode A rides with the code): the accessor is the arming
  classification seam consumed by insertHighlighted (S2) — aligned 1:1
  with currentSet in order and lifetime; `tier === 0` (anchorless) marks
  never-arm items; chain-offer shims painted by P1.M1.T2.S1 flow through
  here too.
- Render behavior unchanged: `renderWidgetLine`/`fitItems`/`applyVisibility`
  read `display` only; zero-candidate and width-truncation semantics
  untouched (spec/07 result-item shape).
- Do NOT touch `insertHighlighted`'s arming (S2), the visibility machine's
  chain consult branch (T2.S1), or the no-arm test pin (S3).

### Success Criteria

- [ ] `VisibilityMachine` interface gains `painted(): readonly RankedMatch[]`
- [ ] Accessor aligned 1:1 with currentSet: after a paint that shows N
      items, `painted().length === state().currentSet.length` and
      `painted()[i].display === currentSet[i].display` for all i
- [ ] `painted()` carries key/display/tier per item (tier present on
      match-path results per plan 004's omit-contract)
- [ ] `hide()`/stock-context close clears it to `[]` (same lifetime as currentSet)
- [ ] Pending swap promoted by the debounce timer ALSO updates it (paint
      is the single write site — verify by test)
- [ ] `test/widget-visibility.test.ts` + `test/widget.test.ts` green
      WITHOUT modification (accessor design) — plus one new pin test
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the exact lines to change,
the paint/hide lifetime sites, the interface shape, the test-seam
convention (stubbed query deps), and the S2/S3 consumer contract are all
reproduced below from live source and the verified architecture research.

### Documentation & References

```yaml
- file: src/pi/widget.ts
  why: The ONLY source file to modify. Verified structure:
    - VisibilityState interface (lines 309–318): { visible,
      suppressUntilWordStart, currentSet: readonly { display: string }[] }.
    - VisibilityMachineDeps (line 322+): store, config, getEditorState,
      restoreReady, optional `query?: (fragment, mode) => RankedMatch[]`,
      onPaint?, isIntentBypass?, debounceMs (100), reopenMs (200).
    - VisibilityMachine interface (~lines 366–372): onInput(): VisibilityState;
      getState(): VisibilityState; onDismissed(...); (ADD painted() here).
    - Machine internals in createVisibilityMachine (~line 434+):
        `let currentSet: readonly { display: string }[] = [];` (line ~455)
        `hide()` (line ~503): visible=false; currentSet=[]; displayedSig=null;
          pendingSet=null; clearSwapTimer()
        `paint(items: readonly RankedMatch[], sig, now)` (lines ~518–535):
          ...; visible=true;
          currentSet = items.map((m) => ({ display: m.display }));  ← line 529
          displayedSig = sig; lastPaintAt = now; ... deps.onPaint?.()
        `parkSwap(items)` (~540): pendingSet = items; timer →
          paint(items, items.map(m=>m.display).join("\u0000"), Date.now())
          — swaps promote THROUGH paint(), so paint is the single write site.
    - `state()` builder (line ~496): { visible, suppressUntilWordStart,
      currentSet } — UNCHANGED.
    - insertHighlighted (line ~841): signature
      (inner, state: WidgetStateInternal, visibility: VisibilityMachine,
      config, requestRender?) — S2 will read visibility.painted() here;
      it reads `state.items` (the WidgetStateInternal copy of currentSet,
      set via applyVisibility → state.set(st.currentSet), lines ~999–1007)
      and clamps `highlightIndex` — the accessor must agree in ORDER with
      state.items for the accepted index to classify the accepted record.
    - The "CHAIN ARMS: NEVER (plan 004)" JSDoc (lines ~833–840) stays
      UNTOUCHED this task (S3 rewrites it).
  pattern: machine accessor beside state()/getState() — follow the
    existing JSDoc density (purpose, lifetime, consumer).
  gotcha: WidgetStateInternal.set stores `[...items]` (line ~284) — a
    shallow copy; your paintedSet must track the machine's own currentSet
    lifetime (paint/hide), NOT the state holder's.

- file: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/r1-chain-widget.md
  section: "Exact contracts" → widget.ts seams + "Recommended fix design" step 1
  why: The verified recon this task implements the first half of: "extend
    VisibilityState.currentSet entries OR the machine to carry
    {display, key, tier?}" so insertHighlighted can mirror the provider's
    arming classification (value→key map + tier-0 skip). Also documents
    provider.ts:639–706 as the reference classification and
    ChainMachine's API (provider.ts:765–790) S2 will consume.
  critical: spec §04 line ~215: "tier-0 matches never arm or extend a
    chain" — the accessor MUST surface tier for that check to be possible.

- file: src/core/types.ts
  why: RankedMatch already carries optional `tier?: 0|1|2|3` (plan 004,
    P1.M1.T1.S1 of that plan) with the omit-contract (zero-fragment
    listing items omit it). The accessor returns RankedMatch — no type
    changes needed in core.

- file: test/widget-visibility.test.ts
  why: THE test-seam template and the reason for the accessor design:
    drives `createVisibilityMachine` with a stubbed `deps.query`
    returning known RankedMatch records (no store round-trip needed —
    see line 477 `machine.onInput().currentSet.map(i => i.display)`).
    CRITICAL: ~15 assertions pin currentSet's EXACT shape via
    `toEqual([{ display: "Zendesk" }])` (lines 139, 147, 151, 173, 177,
    192, 237, 257, 307, 324, 402, ...) — enriching the ENTRIES would
    break all of them; the ACCESSOR leaves them green (the contract's
    "type-only widening"). Add your new pin case in this file's style.
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/pi/widget.ts             # MODIFY (interface + ~4 lines of machine state)
├── src/core/types.ts            # untouched (RankedMatch.tier already exists)
├── test/widget-visibility.test.ts  # EXTEND (one new pin describe/it; existing green)
└── test/widget.test.ts          # untouched, must stay green
```

### Known Gotchas of our Codebase & Library Quirks

```python
# CRITICAL — design choice with test-stability consequences:
#   Option A (RECOMMENDED, this PRP): accessor `painted()`. Type-only for
#   every existing consumer; widget-visibility.test.ts's ~15 exact-shape
#   toEqual([{display}]) pins stay green; S2 reads
#   visibility.painted()[clampedIdx] at the insert site.
#   Option B (only if review prefers state-bag purity): enrich
#   currentSet entries to {display, key, tier} — then you MUST update
#   every toEqual shape pin in widget-visibility.test.ts (mechanical:
#   [{display:"X"}] → [{display:"X", key:"x", tier:3}] with the query
#   stub's actual values) and re-run test/widget.test.ts's sig-based
#   checks. The contract explicitly permits either; A is lower-risk.
# GOTCHA — paint() is the SINGLE write site: swap-debounce promotions
#   route through paint() (parkSwap's timer calls paint), so updating
#   paintedSet ONLY inside paint() + hide() covers every path (R6 swap,
#   R4 close, stock-context hide, gate holds). Do not write to it
#   anywhere else.
# GOTCHA — lifetime parity: painted() must be [] exactly when
#   currentSet is []. hide() is the only clear site (closeWith calls
#   hide). A stale non-empty painted() after hide would let S2 arm a
#   chain on a stale item — that's the exact class of bug this changeset
#   exists to avoid.
# GOTCHA — ORDER parity with state.items: applyVisibility does
#   state.set(st.currentSet) (index.ts wiring, widget.ts ~999–1007), and
#   insertHighlighted indexes state.items by the (clamped) highlightIndex.
#   painted() must be the SAME list in the SAME order as currentSet at
#   paint time — both derive from the one `items` argument, so assigning
#   `paintedSet = items` next to the currentSet map guarantees it. Add a
#   parity test asserting painted()[i].display === currentSet[i].display.
# GOTCHA — width truncation happens at RENDER (fitItems), downstream of
#   the machine; the machine's set is pre-truncation. That is existing
#   behavior (insertHighlighted already clamps against the untruncated
#   state.items) — do not "fix" it here; S2 inherits the same semantics.
# GOTCHA — do NOT copy the RankedMatch objects into a new shape (e.g.
#   {key, display, tier} literals): shims painted by T2.S1 will be full
#   RankedMatch records (salience:-count, sessionCount), and S2 only
#   needs key/tier — returning the records verbatim keeps one shape.
```

## Implementation Blueprint

### Data models and structure

```typescript
// widget.ts — interface addition (~line 372, beside getState()):
export interface VisibilityMachine {
  // ... existing onInput / getState / onDismissed members ...
  /** The currently painted match records (machine-internal RankedMatch
   *  list), aligned 1:1 with VisibilityState.currentSet in order and
   *  lifetime — populated on paint(), cleared on hide(). The Tab-insert
   *  arming seam (BUG-001 fix, P1.M1.T1.S2): the accepted item's key
   *  (store key for chain.arm) and tier (tier-0 anchorless matches never
   *  arm — spec §04) are read here. Chain-offer shims (P1.M1.T2.S1)
   *  flow through the same site. */
  painted(): readonly RankedMatch[];
}

// machine internals (~line 455, beside currentSet):
let paintedSet: readonly RankedMatch[] = [];

// hide() — add the clear beside currentSet = []:
paintedSet = [];

// paint() — add beside currentSet = items.map(...):
paintedSet = items;

// accessor (beside the state() builder / public methods):
painted: () => paintedSet,
```

(If `VisibilityMachine` is an object literal return, add the method to the
returned object; if a class-style closure, define `painted()` alongside
`onInput`/`getState` — mirror the file's actual pattern.)

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — ADD the pin case to test/widget-visibility.test.ts FIRST
  - FOLLOW the file's stubbed-query fixture pattern (deps.query returning
    known RankedMatch records — see the line-477 ambient case).
  - CASES:
      it("painted() mirrors currentSet 1:1 after a paint", ...)
        // stub query → [{key:"zendesk", display:"Zendesk", tier:3, ...}, ...]
        // after machine.onInput(): painted().map(m=>m.key) === ["zendesk",...],
        // painted()[i].display === state().currentSet[i].display for all i
      it("painted() is empty whenever the line is hidden", ...)
        // paint, then a stock-context tick / closeWith path → painted() === []
        // AND state().currentSet === [] (lifetime parity)
      it("swap-debounce promotion updates painted() too", ...)
        // two rapid ticks park a swap; advance timers; painted() reflects the
        // PROMOTED set (proves paint is the only write site)
      it("painted() carries key and tier (arming prerequisites)", ...)
        // assert m.key and m.tier fields present on a match-path stub
  - RUN → RED (painted not exported).

Task 2: IMPLEMENT in src/pi/widget.ts (blueprint above)
  - Interface member + paintedSet variable + two write sites + accessor.
  - JSDoc per blueprint (Mode A: docs ride with the code).
  - DO NOT touch insertHighlighted's body, the CHAIN ARMS: NEVER comment,
    or any render path.

Task 3: FULL REGRESSION
  - npm run check
  - npx vitest --run test/widget-visibility.test.ts test/widget.test.ts
    # both green UNMODIFIED (the contract's type-only-widening guarantee)
  - npm test
```

### Implementation Patterns & Key Details

```typescript
// Parity invariant (the whole point — assert it):
//   ∀i: painted()[i].display === state().currentSet[i].display
// Both derive from the single `items` argument inside paint(), so the
// assignment pair cannot drift:
currentSet = items.map((m) => ({ display: m.display }));
paintedSet = items;

// S2's (future) consumption shape, for orientation only — do NOT implement:
//   const rec = visibility.painted()[clampedIdx];
//   if (rec && rec.tier !== 0) chain.arm(rec.key.toLowerCase());
```

### Integration Points

```yaml
NEXT TASKS (do NOT implement):
  - P1.M1.T1.S2: chain.arm from insertHighlighted using
    visibility.painted()[clampedIdx] — {key, tier} are exactly what it
    needs; thread opts.chain to the insert site.
  - P1.M1.T1.S3: invert test/widget.test.ts:1053's no-arm pin.
  - P1.M1.T2.S1: chain-offer shims paint through the same paint() — they
    become visible via painted() automatically (RankedMatch-shaped).
NO CHANGES: renderWidgetLine, fitItems, applyVisibility (index wiring),
  decideWidgetKey, insertHighlighted body, WidgetLayerOptions, types.ts.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit clean (accessor typing)
```

### Level 2: Unit Tests (TDD)

```bash
npx vitest --run test/widget-visibility.test.ts   # new pins + all existing green
npx vitest --run test/widget-visibility.test.ts -t painted -v
npx vitest --run test/widget.test.ts              # untouched, green
npm test
```

### Level 3: Integration

```bash
npx vitest --run test/widget.test.ts test/provider-display.test.ts test/chain.test.ts
# downstream suites structurally unaffected (no consumer changed yet)
```

### Level 4: Domain-Specific

Not applicable beyond Level 2 — this task is a data-exposure seam; live
TTY verification belongs to P1.M1.T2.S3.

## Final Validation Checklist

- [ ] `VisibilityMachine.painted(): readonly RankedMatch[]` exported and implemented
- [ ] Single write sites: paint() sets, hide() clears; swap promotions route through paint()
- [ ] Parity pin green (painted()[i].display === currentSet[i].display)
- [ ] Hide-lifetime pin green (empty exactly when currentSet empty)
- [ ] key/tier exposure pinned
- [ ] widget-visibility.test.ts and widget.test.ts otherwise UNMODIFIED and green
- [ ] Render/insert/key-handling code untouched; no spec/config surface change
- [ ] JSDoc on the accessor (Mode A)
- [ ] `npm run check` + `npm test` fully green

## Anti-Patterns to Avoid

- ❌ Don't enrich currentSet entries without updating the ~15 toEqual shape pins (or use the accessor instead)
- ❌ Don't write paintedSet anywhere except paint() and hide()
- ❌ Don't copy/reshape records into {key,display,tier} literals — return the RankedMatch list verbatim
- ❌ Don't touch insertHighlighted, the "CHAIN ARMS: NEVER" comment, or the no-arm test pin (S2/S3)
- ❌ Don't add width-truncation awareness (render-layer concern, existing semantics stand)
- ❌ Don't widen beyond what S2/T2.S1 need (no extra fields, no events, no callbacks)

---

**Confidence Score**: 9/10 — the machine's paint/hide/swap-promotion flow,
interface shape, and the exact test-pinning landscape were read from live
source this session; the design doc's verified recon names both permitted
options and this PRP picks the lower-risk one with rationale.
