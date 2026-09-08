---
name: "P1.M2.T2.S2 (plan 002) — createDisplayProvider: forced results bypass the 100 ms display debounce"
---

## Goal

**Feature Goal**: In `createDisplayProvider`'s `getSuggestions` (src/pi/provider.ts), when `options.force === true`, return the base result UNTOUCHED — before any hapax classification (`__hapaxLive()` + prefix equality), before the suppression-window logic, and without scheduling or consuming a pending swap. This completes PRD §07 h3.8's rule "the forced single-item return bypasses the 100 ms display debounce (forced requests are undelayed by design); always return the live top item", so pi-tui's Tab single-item fast path (P1.M2.T2.S1) is never fed a stale/debounced set by the display layer.

**Deliverable**: Modified `src/pi/provider.ts` (forced early-return in `createDisplayProvider.getSuggestions` + doc-comment update) and extended `test/provider-display.test.ts` (forced-bypass cases).

**Success Definition**: A forced single-item result passes through immediately even deep inside the 100 ms suppression window; a pending scheduled swap neither leaks into nor delays a subsequent forced result; ALL non-forced behavior (first paint, suppression, narrowing, close/reset, BUG-002 prefix-anchor exception, acceptance exception) is byte-identical; `npm run check` + `npm test` green.

## Why

- S1 (P1.M2.T2.S1) makes the BASE provider return single-item sets on `force:true`, relying on pi-tui's `force && explicitTab && items.length === 1` fast path. But the display wrapper sits between pi and the base provider: today it classifies every result and, inside the 100 ms window, re-serves the DISPLAYED set (stale multi-item set) instead of the fresh forced single item — the forced completion would then land in pi-tui's menu-open branch (>1 items) or apply a stale prefix. The display layer must get out of the way for forced requests.
- Completes the end-to-end Tab-only-completes behavior verified by P1.M4.T1.S2 (M2 DoD audit) and pinned by PRD §09 provider bullet ("Tab mid-debounce resolves the live (undebounced) top item").

## What

One change in `createDisplayProvider.getSuggestions`, immediately after step 1 (the `base.getSuggestions` call — which ALWAYS runs first, Tab stays instant) and before the `isHapax` classification (step 2–3):

```typescript
const result = await base.getSuggestions(lines, cursorLine, cursorCol, options);
// 1.5. Forced requests (pi-tui Tab path, editor.js ~1892 forwards {signal,
// force}) are undelayed BY DESIGN (PRD §07 h3.8): return the base result
// untouched — no classification, no suppression window, no pending swap
// scheduling. The base layer already narrowed forced hapax returns to the
// single live top item (P1.M2.T2.S1); re-serving a displayed/pending set
// here would resurrect the stale multi-item set pi-tui's single-item fast
// path is meant to consume. Forced calls do NOT touch scheduler state:
// displayed* stays as-is and any pending swap stays scheduled for the next
// NON-forced query (supersede semantics unchanged).
if (options.force === true) return result;
```

Rules:
- `options.force === true` strict comparison (never truthiness).
- The forced return happens BEFORE `base.__hapaxLive()` is consulted and before `reset()` — a forced request must not wipe displayed/pending state (non-forced keystrokes that follow still see correct hysteresis).
- Forced requests do not call `paint()` either: painting the single-item set would corrupt the displayed anchor the hysteresis machine composes against; forced requests are invisible to the scheduler.
- Everything else in `createDisplayProvider` (applyCompletion flagging, shouldTriggerFileCompletion, dispose/reset, triggerCharacters) is untouched.
- Note the type of `options` in this method already carries `force?` — verify the pi-tui `AutocompleteProvider` type; if the wrapper's parameter type doesn't include `force`, read it via the same access the base provider uses (S1 reads `options.force` in `createHapaxProvider.getSuggestions` with the same options object type — mirror that access; do not introduce a new type or cast if avoidable).

### Success Criteria

- [ ] Forced (`force:true`) query mid-suppression-window returns the base result object itself — single item when hapax is live (S1 contract), pass-through for delegates
- [ ] Forced query does not mutate displayed*/pending*/lastPaintAt/completionSincePaint
- [ ] A pending scheduled swap does not leak into a subsequent forced result (forced returns base output, not pendingItems), and does not get cancelled by it (a later non-forced query can still promote/replace it per existing supersede rules)
- [ ] All non-forced behavior identical — existing provider-display.test.ts suite green, unmodified
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer with no prior knowledge needs: the exact current `createDisplayProvider.getSuggestions` flow (quoted below), the step-numbering convention, the pending-swap state machine semantics, S1's base-layer forced contract, and the display test harness (harness/emit/opts helpers, fake timers pinned at t=0). All provided or pointed to below.

### Documentation & References

```yaml
- file: src/pi/provider.ts
  why: THE file. createDisplayProvider spans ~L470–780; getSuggestions at ~L635.
        Current flow: (1) await base.getSuggestions(...) at ~L638; (2–3) isHapax
        classification via base.__hapaxLive() + result.prefix === live.prefix,
        non-hapax → reset() + pass-through; (4a) first paint / idempotent repaint;
        (4b) window elapsed → paint; (4c-exc) completionSincePaint → paint;
        (4d-exc, BUG-002) prefix moved → paint; (4d) suppression → park pending +
        scheduleSwap + re-serve displayed.
  pattern: numbered step comments (1, 2–3, 4a, 4b, 4c-exception, 4d-exception, 4d);
            insert the forced check as step "1.5" so the numbering contract survives.
  gotcha: base.getSuggestions runs FIRST and ALWAYS — keep that; the forced
          early-return goes after it, before everything else. Do not read
          __hapaxLive() before the force check.

- file: plan/002_3e8a42cadf2c/P1M2T2S1/PRP.md
  why: CONTRACT for the base layer's forced behavior (being implemented in
        parallel — treat as done): hapax-owned returns under force are exactly
        one item (live top / chain successor) with prefix unchanged;
        lastLive still holds the FULL set; delegation paths pass the identical
        options object. Your wrapper must return that base result untouched.
  gotcha: display-layer classification uses result.prefix === live.prefix — a
          forced single-item result keeps the same prefix, so classification
          WOULD match and swallow it into the debounce machine. That's exactly
          why the forced check must precede classification.

- file: plan/002_3e8a42cadf2c/architecture/pi_layer_map.md
  why: createDisplayProvider (provider.ts 583–771) is the hapax-side 100 ms
        display debounce; it ALWAYS calls base.getSuggestions first; non-hapax
        results (delegates, empty) already bypass; the editor forwards
        {signal, force} down the provider chain so forced requests reach the
        wrapper with options.force intact.

- file: plan/002_3e8a42cadf2c/architecture/external_deps.md
  section: §1e (editor.js:1892 providers get only {signal, force}; :1903 the
        force && explicitTab && items.length === 1 fast path)
  why: Why the wrapper must not delay or alter forced results.

- file: test/provider-display.test.ts
  why: THE suite you extend. Harness (verified): beforeEach pins fake timers
        at setSystemTime(0); helpers opts() (fresh {signal} — extend to accept
        {force}), mockCurrent, zeStore (Zendesk×4 > ZendeskAgent×3 > zephyr×1),
        reproStore, harness(debounceMs?, store?) whose emit(fragment) types
        "#"+fragment and logs Emission lists. Fixture constants ZE/ZEND/ZENDESKA.
  pattern: describe/it with vi.advanceTimersByTime for window math; emissions
           asserted as whole sequences.
  gotcha: emit() builds opts() without force — add an opts variant or an
          emit-forced helper rather than changing existing call sites.

- file: test/provider-live.test.ts
  why: S1's force-contract suite (base layer). Read for the forced
        single-item assertions your display cases compose with; do NOT modify.

- file: test/helpers/editor-sim.ts
  why: editorApplyCompletion / prefixIsAnchorSafe helpers used by the suite —
        reference if a forced-after-acceptance case needs buffer simulation.
```

### Current Codebase tree (relevant)

```bash
src/pi/provider.ts            # MODIFY: forced early-return in createDisplayProvider.getSuggestions
test/provider-display.test.ts # EXTEND: forced-bypass describe block
```

### Desired Codebase tree

```bash
# no new files — modifications only
src/pi/provider.ts            # step 1.5 forced bypass + doc-comment bullet
test/provider-display.test.ts # + describe("forced results bypass the 100 ms debounce (PRD §07 h3.8)")
```

### Known Gotchas of our Codebase & Library Quirks

```typescript
// ORDER: base.getSuggestions FIRST (Tab stays instant — the live cache and
// pi-tui's Tab resolution must never be gated), THEN the force check, THEN
// classification. Never skip the base call for forced requests.

// DO NOT reset() ON FORCED CALLS: reset() clears displayed*/pending*/timers.
// A forced Tab mid-menu must not close the menu or drop a pending swap —
// forced requests are invisible to the scheduler (no paint, no reset, no
// pending bookkeeping).

// DO NOT paint() THE FORCED RESULT: painting the single-item set would make
// the 1-item set the displayed anchor; the next non-forced keystroke's
// identical-prefix suppression math would then compose against the wrong
// anchor (and completionSincePaint semantics — applyCompletion flags it —
// handle acceptance separately).

// PENDING SWAP NON-INTERFERENCE: a pending swap scheduled by an earlier
// non-forced keystroke stays armed across a forced call. Its timer may fire
// later and promote pendingItems — that only mutates internal state, which
// the next NON-forced getSuggestions observes. The forced return path reads
// nothing from pending*: it returns `result` from the base call.

// TYPE ACCESS: mirror S1's access pattern (`options.force === true`). If
// the wrapper's options parameter type lacks `force`, extend the local
// signature minimally (pi-tui forwards {signal, force}) — never a broad cast.

// FAKE TIMERS: the suite pins Date.now() to 0; suppression-window cases use
// vi.advanceTimersByTime/debounceMs from the harness. Forced-pass-through
// cases assert on the RETURN VALUE shape (items.length === 1, prefix, or the
// exact delegate sentinel), not on internal state — the wrapper's scheduler
// state is closure-private by design.

// DEFENSIVE COPY NOT REQUIRED for the forced path: the base provider already
// returns fresh arrays (S1 builds new items each call); "untouched" means
// identity return is fine and is the cheapest correct behavior.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/pi/provider.ts — forced bypass in createDisplayProvider
  - IN getSuggestions, immediately after `const result = await base.getSuggestions(...)`
    and before the isHapax classification block, add:
      if (options.force === true) return result;
    with the step-1.5 comment sketched in this PRP's "What" section.
  - UPDATE the function's doc comment (the numbered rules ~L496–540): add a
    bullet after rule 1 stating forced requests return the base result
    untouched — no classification, no suppression, no scheduler mutation
    (PRD §07 h3.8, P1.M2.T2.S1 contract).
  - NO other edits: classification, 4a/4b/4c-exc/4d-exc/4d, applyCompletion,
    shouldTriggerFileCompletion, dispose/reset all unchanged.

Task 2: EXTEND test/provider-display.test.ts
  - ADD opts variant: const forcedOpts = (): { signal: AbortSignal; force: true } =>
      ({ signal: new AbortController().signal, force: true });
    (or an opts(over) overload — pick the smaller diff; do not change
    existing opts() call sites)
  - ADD describe("forced results bypass the 100 ms debounce (PRD §07 h3.8)"):
    * forced inside the suppression window: paint "#ze" (ZE set) at t=0,
      advance ~30ms, mutate store membership so a non-forced query would be
      suppressed (existing mid-window pattern — e.g. upsert to change the
      ranked set with the SAME "ze" prefix), then call
      wrapper.getSuggestions(["#ze"], 0, 3, forcedOpts()) → returns the
      BASE live result for the CURRENT store (not the displayed ZE set) —
      and since the base layer is force-aware (S1), items.length === 1 and
      items[0].value is the live top ("Zendesk")
    * forced result passes through untouched: with a mock-current delegate
      result (sentinel, as in the existing "/s" delegate case ~L323),
      wrapper.getSuggestions(["/s"], 0, 3, forcedOpts()) → toEqual(sentinel)
      and no classification state reset (a following non-forced "#ze" query
      still returns the previously displayed set — scheduler untouched)
    * pending swap does not leak: paint "#ze" (ZE); at t<100ms trigger a
      suppressed identical-prefix set change (pending armed via scheduleSwap);
      then a forced query returns the LIVE base result, NOT pendingItems and
      NOT displayedItems; the pending timer still fires at +100ms
      (advanceTimersByTime(100)) and the next NON-forced query observes the
      promoted set — supersede/promote semantics unchanged
    * forced does not paint: after a mid-window forced query, a non-forced
      identical-prefix query still behaves per rule 4d (re-serves displayed,
      pending intact) — i.e. lastPaintAt/displayedSig unchanged by the forced
      call (observable: a fresh suppressed change still schedules against
      the ORIGINAL paint timestamp)
    * empty/zero-candidate forced: harness where the base delegates
      (e.g. "#zzz" no candidates) with forcedOpts → pass-through delegate
      emission "<delegate>"
    * non-forced regression pin: the same sequences with opts() (no force)
      behave exactly as before (one representative: mid-window suppressed
      query re-serves the displayed set)
  - DO NOT modify existing describe blocks or the harness/emit helpers'
    existing behavior; extend helpers additively only.

Task 3: VALIDATE
  - npm run check
  - npx vitest --run test/provider-display.test.ts -v
  - npx vitest --run test/provider-live.test.ts test/provider.test.ts test/chain.test.ts -v
  - npm test   # full suite green
```

### Implementation pattern

```typescript
async getSuggestions(lines, cursorLine, cursorCol, options) {
  // 1. ALWAYS query the inner provider first — it (and Tab's live
  // cache) is never gated by the display layer.
  const result = await base.getSuggestions(lines, cursorLine, cursorCol, options);

  // 1.5. Forced requests are undelayed BY DESIGN (PRD §07 h3.8): return the
  // base result untouched. The base layer already narrowed forced hapax
  // returns to the single live top item (P1.M2.T2.S1); classification or
  // suppression here would re-serve a stale multi-item set and defeat
  // pi-tui's single-item Tab fast path. Forced calls never touch scheduler
  // state (no paint, no reset, no pending bookkeeping).
  if (options.force === true) return result;

  const live = base.__hapaxLive();
  // ... steps 2–4 unchanged
}
```

### Integration Points

```yaml
NONE this task:
  - Provider-internal display-layer change; no config, core, store, or ingest edits.
  - Downstream (do NOT implement): P1.M4.T1.S2 audits the end-to-end
    Tab-only-completes behavior (S1 base + this display bypass) in the M2
    DoD sweep; P1.M4.T2.S1 refreshes the README never-hijack bullet.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/provider-display.test.ts -v   # new + existing cases green
npx vitest --run test/provider-live.test.ts test/provider.test.ts -v
npm test   # full suite green (chain.test.ts and S1's force cases included)
```

### Level 3: Integration

None beyond the suites — end-to-end acceptance is P1.M4.T1.S2's scope (PRD §09 Tab-only-completes bullet, Tab-before-paint case).

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green
- [ ] Existing provider-display.test.ts cases unmodified and passing

### Feature Validation

- [ ] `options.force === true` → base result returned untouched, before classification/suppression, after the mandatory base call
- [ ] Forced single-item result passes through immediately inside the 100 ms window (S1's live top item, not the displayed set)
- [ ] Pending scheduled swap neither leaks into nor delays a subsequent forced result; swap/promote semantics for non-forced queries unchanged
- [ ] Forced calls perform no scheduler mutation (no reset, no paint, no pending writes)
- [ ] Strict `=== true` comparison; no new config knob; step numbering/doc comment updated

### Code Quality Validation

- [ ] Smallest-diff change; doc comment documents the forced bypass alongside the existing numbered rules
- [ ] No changes to applyCompletion / shouldTriggerFileCompletion / dispose / chain machine / base provider

## Anti-Patterns to Avoid

- ❌ Don't skip or reorder the base.getSuggestions call — it always runs first
- ❌ Don't reset() or paint() on forced requests — the scheduler is untouched by force
- ❌ Don't classify forced results via __hapaxLive()/prefix equality before the force check — that swallows them into the debounce machine
- ❌ Don't use truthiness on `options.force` — strict `=== true`
- ❌ Don't modify S1's base-layer force logic, existing display tests, or chain.test.ts
- ❌ Don't add a debounceMs/config escape for forced behavior — forced bypass is unconditional per PRD