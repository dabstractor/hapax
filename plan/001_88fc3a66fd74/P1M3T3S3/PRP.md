# PRP — P1.M3.T3.S3: Display debounce (100 ms) + flicker hysteresis state machine

## Goal

**Feature Goal**: Wrap the S2 provider (`createHapaxProvider`) with a display-layer state machine (`PopupScheduler`) in `src/pi/provider.ts` that suppresses flicker: the returned suggestion set updates at most once per 100 ms, never renders with zero candidates, never close-and-reopens on narrowing keystrokes, and never delays Tab (Tab reads S2's live cache, which stays ungated).

**Deliverable**: `createDisplayProvider(base, opts)` (plus the `PopupScheduler` state it closes over and a `dispose()` seam) in `src/pi/provider.ts`, and `test/provider-display.test.ts` using `vi.useFakeTimers`.

**Success Definition**: `npm run check` clean; `npm test` green including new tests; recorded emission sequences show (a) no differing-set swap within 100 ms of a paint, (b) no close+reopen (empty→non-empty flapping) for narrowing keystrokes (`zend` → `zendk`), (c) close events reset state so the next qualifying keystroke re-opens fresh, (d) `base.__hapaxLive()` always reflects the latest query even while display is suppressed.

## Why

PRD §01 invariant 3: "The popup never flickers and never appears with zero candidates." Fast typists generate a new result set per keystroke; without debounce the menu visibly repaints/flashes on every key. S2 returns results immediately (correct for Tab); S3 is the display layer that decides what pi actually paints, sitting between S2 and the consumer in `src/pi/index.ts` (P1.M3.T5.S1).

## What

`createDisplayProvider(base, opts)` wraps the S2 provider object:

```ts
export interface DisplayProviderOptions {
  debounceMs?: number;   // default 100
}

export function createDisplayProvider(
  base: AutocompleteProvider & { __hapaxLive: () => LiveResult | null },
  opts: DisplayProviderOptions = {},
): AutocompleteProvider & { dispose: () => void }
```

Behavior of the wrapper's `getSuggestions(lines, line, col, options)`:

1. **Always call `base.getSuggestions(lines, line, col, options)` first** — the inner provider (and its live cache) is never gated. This preserves the Tab contract: Tab resolves against `base.__hapaxLive()`, which reflects every keystroke.
2. **Classify the result**: it is a hapax result iff `base.__hapaxLive() !== null` (S2 sets the cache on every successful non-empty query and clears it on the zero-candidate/delegate paths). Anything else (`null`, or a delegated built-in result) is a **close/delegate event**: reset scheduler state (displayed signature, lastPaintAt, pending), clear pending timers, and return the inner result **unchanged**. Empty = invisible; a close followed by a qualifying keystroke re-opens fresh (no stale set).
3. **Hapax result, empty items** (defensive — S2 shouldn't produce this): same as close event.
4. **Hapax result, non-empty items**: compute `sig = items.map(i => i.value).join("\u0000")`.
   - If `sig === displayedSig` → return a copy of the displayed items (paint is idempotent; refresh lastPaintAt).
   - If `now - lastPaintAt >= debounceMs` → paint immediately: `displayedSig = sig`, `lastPaintAt = now`, clear pending, return the new items.
   - Else (**suppression window**): store `pendingSig/pendingItems` (replacing any previous pending — a newer keystroke supersedes), schedule a 100 ms timer whose callback promotes pending → displayed and advances `lastPaintAt` (bookkeeping only — pi pulls on the next getSuggestions; the timer exists so state advances even between keystrokes and so cleanup has something to own). Return the **currently displayed items** (if none displayed yet — menu not yet open — paint immediately instead; a first paint is never delayed).
5. **Narrowing**: a narrowing keystroke (`zend` → `zendk`) produces a subset set — it flows through the same rule 4 (debounced like any differing set). Because rule 4 always returns a non-empty set (old or new), pi never observes zero-then-nonzero: **no close+reopen**. There is no special-case code for narrowing; the invariant falls out of "always return a non-empty set once open".
6. `applyCompletion`, `shouldTriggerFileCompletion`, `triggerCharacters` pass through to `base` verbatim — the display layer never touches insertion semantics.

`dispose()` clears all pending timers and state; P1.M3.T5.S1 calls it in `session_shutdown` (PRD §02: everything dies at shutdown).

### Success Criteria

- [ ] Differring set arriving <100 ms after last paint → previous displayed set returned; swap scheduled; superseded by a newer keystroke's pending set
- [ ] Set arriving ≥100 ms after last paint → painted immediately
- [ ] First paint never delayed (no displayed set yet → return new set at once)
- [ ] Zero candidates / delegate / null → inner result returned unchanged; state reset; no timers left
- [ ] Narrowing sequence `zend`→`zendk` emits no empty result between non-empty ones (no close+reopen)
- [ ] After a close event, a qualifying keystroke paints fresh (not the stale pre-close set)
- [ ] `base.__hapaxLive()` reflects the newest query even while display is suppressed
- [ ] `dispose()` clears timers (no leaked timer fires after dispose — assert with fake timers)

## All Needed Context

### Documentation & References

```yaml
- docfile: plan/001_88fc3a66fd74/P1M3T3S2/PRP.md
  why: CONTRACT for the S2 provider being wrapped — createHapaxProvider returns
        AutocompleteProvider & { __hapaxLive: () => LiveResult | null };
        LiveResult = { matches: RankedMatch[]; prefix: string; ts: number };
        cache set on every non-empty hapax query, CLEARED on zero-candidate/delegate.
  critical: S2 is being implemented in parallel — assume it exists exactly per its PRP.
            Do NOT reimplement query/mapping/delegation logic; call base and shape the output.

- file: src/pi/provider.ts
  why: S1's extractMatchState + MatchState already live here; S2 adds createHapaxProvider.
        Add createDisplayProvider BELOW S2's code with its own module doc-comment.
  gotcha: do not modify S1/S2 code; this task only ADDS the wrapper.

- file: node_modules/@earendil-works/pi-tui/dist/autocomplete.d.ts
  why: AutocompleteProvider / AutocompleteSuggestions / AutocompleteItem contracts
        (verified in S2 research): getSuggestions → Promise<{ items, prefix } | null>;
        applyCompletion is synchronous.
  critical: type-only import: import type { AutocompleteProvider } from "@earendil-works/pi-tui".

- file: src/core/store.ts + src/core/query.ts
  why: fixtures — real CandidateStore upserted with candidates (e.g. "zendesk",
        "zendeskAgent", "zephyr") then rankMatches drives varied result sets.
        Narrowing fixture: fragment "zend" → [zendesk, zendeskAgent]; "zendk" → [zendeskAgent]
        (subset — verify with your fixture ordering; use store+rankMatches output, not hardcoded lists).

- file: test/config.test.ts, test/query.test.ts
  why: vitest conventions — ESM ".js" import suffixes, describe/it, header doc comment.
  gotcha: do NOT modify test/provider-live.test.ts (S2) or test/provider-match.test.ts (S1).

- docfile: plan/001_88fc3a66fd74/P1M3T3S3/research/notes.md
  why: this session's verified facts + design rationale (why timers are bookkeeping,
        pull-not-push, emission-sequence assertion style).
```

### Current Codebase tree (relevant)

```
src/pi/provider.ts      # S1 ✓ (extractMatchState); S2 adding createHapaxProvider (parallel)
src/pi/config.ts  src/pi/ingest.ts  src/pi/index.ts (stub — P1.M3.T5.S1 wires provider)
test/provider-match.test.ts (S1)  test/provider-live.test.ts (S2, parallel)
```

### Desired additions

```
src/pi/provider.ts            # EXTEND: add createDisplayProvider + DisplayProviderOptions + dispose seam
test/provider-display.test.ts # NEW: fake-timer tests, emission-sequence assertions
```

### Known Gotchas

```ts
// CRITICAL: the wrapper MUST call base.getSuggestions on EVERY keystroke before any
//   suppression decision — gating the inner call would gate Tab (breaks the Tab contract).
// CRITICAL: classification uses base.__hapaxLive() AFTER the inner call, not the return
//   value alone: a delegated built-in result may be non-null and must NOT enter the
//   debounce state machine.
// GOTCHA: we cannot PUSH a set into pi's menu — pi pulls via getSuggestions. The pending
//   swap therefore applies on the next qualifying getSuggestions call; the 100 ms timer's
//   callback only promotes internal state (displayedSig/lastPaintAt) and owns cleanup.
//   PRD: "The menu thus updates at most every 100 ms, between keystrokes" — pull-based.
// GOTCHA: first paint is never delayed — if displayedSig is unset, paint immediately
//   (delaying the FIRST appearance would feel laggy and adds nothing: there is no prior
//   set to flicker against).
// GOTCHA: use Date.now() for lastPaintAt timestamps; with vi.useFakeTimers,
//   vi.setSystemTime / advanceTimersByTime control both timers and Date.now together.
// GOTCHA: clearTimeout every timer you replace; keep ALL live timer ids in a Set for
//   dispose() (PRD §02 lifecycle — P1.M3.T5.S1 calls dispose at session_shutdown).
// GOTCHA: ESM imports use ".js" suffixes ("../core/query.js" etc.).
// GOTCHA: identical-set keystroke (sig unchanged) should NOT reset the suppression
//   window in a way that lets a following differing set paint early — refreshing
//   lastPaintAt on identical sets is the intended behavior (menu didn't change).
// GOTCHA: never return a MUTATED inner array; copy items when returning the displayed
//   set so pi can't mutate our stored pendingItems.
```

## Implementation Blueprint

### Data model (scheduler state, all closure-private)

```ts
// PopupScheduler state (PRD §07 rules 2–3)
let displayedSig: string | null = null;   // "\0"-joined item values currently painted
let displayedItems: AutocompleteItem[] = [];
let displayedPrefix: string = "";
let lastPaintAt = 0;                      // Date.now() of last visible-set change
let pendingSig: string | null = null;     // scheduled swap, superseded by newer keystrokes
let pendingItems: AutocompleteItem[] = [];
let pendingPrefix: string = "";
const timers = new Set<ReturnType<typeof setTimeout>>();  // dispose() clears all
```

### Implementation Tasks (ordered)

```yaml
Task 1: EXTEND src/pi/provider.ts — createDisplayProvider
  - ADD below S2's code: DisplayProviderOptions (debounceMs?: number, default 100),
    createDisplayProvider(base, opts) per "What" rules 1–6
  - KEEP S1's extractMatchState and S2's createHapaxProvider byte-identical (parallel work)
  - RETURN type: AutocompleteProvider & { dispose: () => void } — explicit type annotation
    (documented seam consumed by P1.M3.T5.S1)
  - DOC-COMMENT: reference PRD §07 "Debounce, flicker, and the Tab contract" rules 2–3 and
    the pull-based caveat (timer promotes state; pi pulls on next keystroke)
  - ESM ".js" type-only import of AutocompleteProvider from "@earendil-works/pi-tui"

Task 2: CREATE test/provider-display.test.ts
  - SETUP: vi.useFakeTimers() in beforeEach, vi.useRealTimers() in afterEach;
    a real CandidateStore fixture (import from ../src/core/store.js; upsert "zendesk",
    "zendeskAgent", "zephyr", "alpha" with varied counts so rankMatches ordering is stable);
    build base = createHapaxProvider(store, config, mockCurrent) — import S2's factory;
    wrapper = createDisplayProvider(base)
  - HELPER: async emit(fragment: string) → calls wrapper.getSuggestions(["some " + fragment],
    0, line.length, { signal }) and records the returned items' values (or "<delegate>" for
    null / delegated results) into an emission log; delegate detection via mockCurrent vi.fn
  - CASES:
    * first keystroke with matches → painted immediately (no delay even at t=0)
    * keystroke A paints at t=0; differing keystroke B at t=+50ms → returns A's set;
      __hapaxLive() shows B's matches (Tab ungated); advance to t=+110ms, keystroke C
      (same as B) → returns B's set (pending promoted / window elapsed)
    * superseded pending: A paints; B at +50ms (suppressed); C at +70ms differs →
      only C's set is ever painted after the window; B's set never appears
    * narrowing: type "zend" (paints [zendesk, zendeskAgent]); immediately "zendk" →
      returned set is still the OLD set; emission log shows NO "<delegate>"/empty entry
      between the two non-empty paints (no close+reopen)
    * zero candidates ("zzz") → delegate returned, state reset; then "ze" → fresh paint
      of ze's set (not the stale pre-close set); no timer pending (vi.getTimerCount() === 0)
    * close-then-requalify within 200ms: "zend" → paint; " " (space, delegate) → reset;
      "ze" at +100ms → paints immediately (fresh open, not suppressed by old lastPaintAt)
    * dispose(): schedule a suppressed swap, call dispose(), advance timers → no state
      promotion observable; vi.getTimerCount() === 0
  - NAMING: it("<scenario> → <expected emission>") style
  - DO NOT touch test/provider-match.test.ts or test/provider-live.test.ts
```

### Key implementation sketch

```ts
async getSuggestions(lines, cursorLine, cursorCol, options) {
  const result = await base.getSuggestions(lines, cursorLine, cursorCol, options);
  const live = base.__hapaxLive();
  // close / delegate event: reset and pass through unchanged
  if (!live || !result || result.items.length === 0) { reset(); return result; }
  const items = result.items.map((i) => ({ ...i }));   // defensive copy
  const sig = items.map((i) => i.value).join("\u0000");
  if (displayedSig === null || sig === displayedSig) { paint(items, result.prefix); return { items, prefix: result.prefix }; }
  const now = Date.now();
  if (now - lastPaintAt >= debounceMs) { paint(items, result.prefix); return { items, prefix: result.prefix }; }
  // suppression window: return displayed set, schedule swap (superseding any pending)
  pendingSig = sig; pendingItems = items; pendingPrefix = result.prefix;
  scheduleSwap();  // setTimeout(100ms): promote pending → displayed, lastPaintAt = Date.now()
  return { items: displayedItems.map((i) => ({ ...i })), prefix: displayedPrefix };
}
```

### Integration Points

```yaml
CONSUMED BY (do NOT implement here):
  - P1.M3.T5.S1 (src/pi/index.ts): ctx.ui.addAutocompleteProvider((current) =>
      createDisplayProvider(createHapaxProvider(store, config, current)));
      calls dispose() in session_shutdown.
  - P2.M2.T2.S1: chain machine sits inside/above S2; unaffected by display layer.
NO changes to: src/core/*, src/pi/config.ts, src/pi/ingest.ts, src/pi/index.ts,
  package.json, tsconfig.json, existing tests.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check        # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npm test -- test/provider-display.test.ts
npm test              # full suite; provider-match (S1) and provider-live (S2) untouched and green
```

### Level 3: Integration

None at this task — no pi runtime in unit tests. End-to-end flicker behavior is exercised by P1.M3.T5.S1 (dev-load) and P1.M4.T1.S1 acceptance.

## Final Validation Checklist

- [ ] `npm run check` clean
- [ ] `npm test` green; S1/S2 test files unmodified
- [ ] Wrapper always calls `base.getSuggestions` before any suppression decision
- [ ] Close/delegate/empty results pass through unchanged and reset scheduler state + timers
- [ ] Suppression window returns displayed set, schedules superseding swap, never delays first paint
- [ ] Narrowing emits no close+reopen (emission-log assertion)
- [ ] `__hapaxLive()` fresh while display suppressed (Tab contract)
- [ ] `dispose()` clears all timers; `vi.getTimerCount() === 0` after
- [ ] Only `src/pi/provider.ts` extended and `test/provider-display.test.ts` added

## Anti-Patterns to Avoid

- ❌ Don't gate the inner provider call — that would delay Tab (violates invariant 2)
- ❌ Don't try to push a swap into pi's menu — pi is pull-based; the timer only advances internal state
- ❌ Don't special-case narrowing with close/reopen detection — always returning a non-empty set IS the fix
- ❌ Don't return live references to stored arrays — copy on both store and return
- ❌ Don't modify S1/S2 code or their tests — this task only adds a wrapper
- ❌ Don't leave orphaned timers — every replaced timer is cleared; dispose() clears the rest

---

**Confidence Score: 8/10** — S2's contract is pinned by its PRP (including `__hapaxLive` and its clear-on-delegate semantics), pi-tui types verified in S2 research, and vitest fake-timer patterns are standard. Residual risks: (a) S2 may still be landing, so verify `createHapaxProvider`/`__hapaxLive` exist as specified before finalizing tests; (b) delegated built-in results being non-null is handled by the `__hapaxLive()`-based classification, but double-check S2's actual implementation once merged.