# PRP — P1.M3.T3.S2: Live synchronous query + AutocompleteSuggestions mapping

## Goal

**Feature Goal**: Implement `createHapaxProvider(store, config, current)` in `src/pi/provider.ts` — the hapax `AutocompleteProvider` factory whose `getSuggestions` performs the **synchronous, every-keystroke** store query (PRD §07 "Debounce, flicker, and the Tab contract" rule 1) and maps `RankedMatch[]` to pi's `AutocompleteSuggestions` shape, delegating cleanly on abort / no-match-state / zero candidates.

**Deliverable**: `createHapaxProvider()` in `src/pi/provider.ts` (added alongside S1's `extractMatchState`), a live-result cache readable by later tasks (S3 debounce, M2 chain arming), plus `test/provider-live.test.ts`.

**Success Definition**: `npm run check` clean, `npm test` green (new tests + no regressions); every delegation case returns `current.getSuggestions(...)` with arguments passed through **unchanged**; hapax query path performs zero awaits/I/O.

## Why

This is the heart of the provider: S1 decides *whether* to suggest; S2 decides *what* to suggest and converts it to pi's menu format. It also establishes the live-result cache that S3 (display debounce, P1.M3.T3.S3) and P2.M2.T2.S1 (Tab-armed chaining) consume. Getting delegation exactly right preserves pi's path/slash completion — acceptance-critical per PRD §07 "Never-hijack rules".

## What

A factory in `src/pi/provider.ts`:

```ts
export function createHapaxProvider(
  store: CandidateStore,
  config: HapaxConfig,
  current: AutocompleteProvider,
): AutocompleteProvider
```

Behavior of `getSuggestions(lines, cursorLine, cursorCol, options)`:

1. `if (options.signal.aborted) return current.getSuggestions(lines, cursorLine, cursorCol, options);` — unchanged args, pass through.
2. `const state = extractMatchState(lines, cursorLine, cursorCol, config);` if `null` → delegate unchanged.
3. `const matches = rankMatches(store, state.fragment, { limit: config.maxSuggestions });` — synchronous, no awaits before this point. If `matches.length === 0` → **clear the live cache to `null`** and delegate unchanged (zero candidates never render a menu).
4. Otherwise cache the live result and return the mapped suggestions (details below).

`applyCompletion` delegates verbatim to `current.applyCompletion(lines, cursorLine, cursorCol, item, prefix)`. `shouldTriggerFileCompletion` delegates with `current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true`. `triggerCharacters: config.triggerChar ? [config.triggerChar] : undefined`.

### Live-result cache (contract for S3 / P2.M2.T2.S1)

The provider closure holds:

```ts
let lastLive: { matches: RankedMatch[]; prefix: string; ts: number } | null = null;
const liveKeyByValue = new Map<string, string>(); // item.value -> RankedMatch.key (M2 Tab-acceptance tag)
```

- Set on every successful non-empty query (`ts = Date.now()`), cleared to `null` on delegate-by-zero-candidates.
- Export an accessor `getLiveResult()` from the returned provider object as a non-enumerable extra field or via a second return value — **recommended shape**: the factory returns the provider and S3 wraps it, so expose the cache through an exported helper attached as a property `__hapaxLive` (documented internal seam; S3 and P2.M2.T2.S1 read it). Keep it minimal and typed.
- `liveKeyByValue` maps each emitted item's `value` to its `RankedMatch.key` so M2 can detect Tab acceptance of a hapax item without polluting `description`.

### Mapping

```ts
matches.map((m) => ({ value: m.display, label: m.display, description: m.description }))
```
- `description` is already the PRD §07 minimal provenance string (`"session x<n>"`) built by `src/core/query.ts` — do not reformat.
- Return `{ items, prefix: state.prefix }` (trigger mode prefix includes the trigger char; threshold mode prefix is the bare fragment — S1 computes this; never recompute).

### Success Criteria

- [ ] Abort signal set → delegation, args untouched
- [ ] `extractMatchState` null → delegation, args untouched
- [ ] Zero matches → cache cleared → delegation, args untouched
- [ ] Non-empty matches → `{ items, prefix }` returned with `items.length <= config.maxSuggestions`
- [ ] No `await` on the hapax query path; query completes synchronously inside the async method
- [ ] `applyCompletion` / `shouldTriggerFileCompletion` always delegate
- [ ] `triggerCharacters` respects `config.triggerChar` (undefined when `""`)

## All Needed Context

### Documentation & References

```yaml
- file: node_modules/@earendil-works/pi-tui/dist/autocomplete.d.ts
  why: EXACT AutocompleteProvider contract — verified:
        getSuggestions(lines, cursorLine, cursorCol, options: { signal: AbortSignal; force?: boolean }):
          Promise<AutocompleteSuggestions | null>;
        AutocompleteSuggestions = { items: AutocompleteItem[]; prefix: string };
        AutocompleteItem = { value: string; label: string; description?: string };
        applyCompletion is SYNCHRONOUS, returns { lines, cursorLine, cursorCol };
        shouldTriggerFileCompletion is OPTIONAL.
  critical: import type { AutocompleteProvider } from "@earendil-works/pi-tui" — TYPE-ONLY import
            keeps provider.ts unit-testable without a pi runtime.

- file: src/core/query.ts
  why: rankMatches(store, prefix, { limit }) — pure, synchronous, lowercases internally,
        returns [] when nothing matches; RankedMatch = { key, display, description, salience }
        with description pre-formatted as "session x<n>" (ASCII x).
  pattern: module doc-comment style; do NOT reformat description in the mapping.
  gotcha: do not pass opts.suppress (M2 seam, unused in M1).

- file: src/pi/provider.ts (S1 output — CONTRACT)
  why: extractMatchState(lines, line, col, config): MatchState | null where
        MatchState = { mode: "trigger" | "threshold"; fragment: string; prefix: string }.
        null means delegate. prefix already includes trigger char in trigger mode.
  critical: S1 is implemented in parallel — assume it exists exactly per its PRP
            (plan/001_88fc3a66fd74/P1M3T3S1/PRP.md). Do not reimplement or modify it.

- file: src/pi/config.ts
  why: HapaxConfig { triggerChar: string; threshold; maxSuggestions: number } — already validated.

- file: src/core/store.ts
  why: CandidateStore class — received as constructor arg, never constructed by the provider.

- file: test/config.test.ts (and test/query.test.ts)
  why: vitest conventions — ESM ".js" import suffixes, describe/it, header doc comment.
  gotcha: do NOT modify test/provider-match.test.ts (S1 owns it).

- doc: plan/001_88fc3a66fd74/P1M3T3S2/research/notes.md
  why: verified pi-tui type signatures and rankMatches output shape (this session's research).
```

### Current Codebase tree (relevant)

```
src/core/  query.ts (rankMatches ✓), store.ts (CandidateStore ✓), types.ts (RankedMatch ✓)
src/pi/    config.ts ✓, ingest.ts (in progress), index.ts (stub — P1.M3.T5.S1 wires provider)
test/      *.test.ts (vitest --run), provider-match.test.ts (S1, parallel)
```

### Desired additions

```
src/pi/provider.ts          # EXTEND: add createHapaxProvider + live-result cache seam
test/provider-live.test.ts  # NEW: unit tests for createHapaxProvider (mock `current` + AbortController)
```

### Known Gotchas

```ts
// CRITICAL: delegation must forward the ORIGINAL arguments object unchanged:
//   return current.getSuggestions(lines, cursorLine, cursorCol, options);
//   Do not clone options, do not drop `force`.
// CRITICAL: check options.signal.aborted BEFORE anything else; never call signal.throwIfAborted().
// GOTCHA: getSuggestions must be declared `async` (contract returns Promise) but the hapax
//   path contains ZERO awaits — the PRD's "synchronous search, every keystroke" happens
//   inside this async method. rankMatches must run before any return of hapax results.
// GOTCHA: AbortSignal in tests: use a real AbortController (new AbortController().signal);
//   vitest fake timers are NOT needed for S2 (no timers — S3 adds them).
// GOTCHA: triggerCharacters must be undefined (not []) when triggerChar === "".
// GOTCHA: clear lastLive AND liveKeyByValue on the zero-candidate path — a stale live
//   result would break S3's hysteresis ("close on disqualification").
// GOTCHA: ESM imports use ".js" suffixes ("../core/query.js", "./config.js").
// GOTCHA: rebuild liveKeyByValue on each query (map.set / clear), values may repeat across
//   queries with different keys after eviction.
```

## Implementation Blueprint

### Data model

```ts
// Live result consumed by S3 (debounce) and P2.M2.T2.S1 (chain arming)
export interface LiveResult {
  matches: RankedMatch[];
  prefix: string;      // state.prefix — what applyCompletion would replace
  ts: number;          // Date.now() at query time (S3 compares against paint time)
}
```

### Implementation Tasks (ordered)

```yaml
Task 1: EXTEND src/pi/provider.ts
  - ADD: LiveResult interface, createHapaxProvider(store, config, current) factory
  - KEEP: extractMatchState + MatchState from S1 byte-identical (parallel work)
  - STRUCTURE getSuggestions per "What" steps 1–4; applyCompletion / shouldTriggerFileCompletion /
    triggerCharacters per contract
  - TYPE-ONLY import of AutocompleteProvider from "@earendil-works/pi-tui";
    value imports only from ../core/query.js, ../core/types.js, ./config.js
  - PLACEMENT: below extractMatchState, with module doc-comment noting PRD §07 rule 1

Task 2: CREATE test/provider-live.test.ts
  - FIXTURES: a small real CandidateStore (import from ../src/core/store.js, upsert a few
    candidates like "zendesk", "zephyr", "alpha") — follow test/store.test.ts fixtures;
    a mock `current: AutocompleteProvider` with vi.fn() getSuggestions/applyCompletion
  - CASES:
    * aborted signal → current.getSuggestions called once with exact original args
    * null state (e.g. fragment "z" at threshold 2) → delegation, args untouched
    * state but zero matches (fragment "zzz") → delegation + getLiveResult() === null
    * matching fragment "ze" → returns { items, prefix: "ze" }, items values = display casing,
      items.length <= maxSuggestions, current.getSuggestions NOT called
    * trigger mode "#ze" → prefix "#ze" in result
    * applyCompletion delegates to current.applyCompletion with all args
    * shouldTriggerFileCompletion undefined on current → returns true
    * triggerCharacters: ["#"] default; undefined when triggerChar ""
    * synchronous query: getSuggestions resolves without any I/O (implicitly covered; optionally
      assert store.prefixRange invoked synchronously — skip if awkward)
  - NAMING: test names state input → expected outcome
  - DO NOT touch test/provider-match.test.ts
```

### Key implementation sketch

```ts
export function createHapaxProvider(
  store: CandidateStore, config: HapaxConfig, current: AutocompleteProvider,
): AutocompleteProvider & { __hapaxLive: () => LiveResult | null } {
  let lastLive: LiveResult | null = null;
  const liveKeyByValue = new Map<string, string>();

  return {
    triggerCharacters: config.triggerChar ? [config.triggerChar] : undefined,
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      if (options.signal.aborted) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }
      const state = extractMatchState(lines, cursorLine, cursorCol, config);
      if (!state) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }
      // Synchronous store query — PRD §07 rule 1: no awaits, no I/O before this
      const matches = rankMatches(store, state.fragment, { limit: config.maxSuggestions });
      if (matches.length === 0) {
        lastLive = null; liveKeyByValue.clear();          // close, not stale
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }
      lastLive = { matches, prefix: state.prefix, ts: Date.now() };
      liveKeyByValue.clear();
      for (const m of matches) liveKeyByValue.set(m.display, m.key);
      return {
        items: matches.map((m) => ({ value: m.display, label: m.display, description: m.description })),
        prefix: state.prefix,
      };
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
    __hapaxLive: () => lastLive,
  };
}
```

(If `__hapaxLive` on the returned object conflicts with tsc strictness, define the return type explicitly as shown — it is an intentional, documented seam.)

### Integration Points

```yaml
CONSUMED BY (do NOT implement here):
  - P1.M3.T3.S3: wraps this provider for display debounce/hysteresis; reads __hapaxLive()
  - P1.M3.T5.S1 (src/pi/index.ts): constructs CandidateStore, calls ctx.ui.addAutocompleteProvider(
      (current) => createHapaxProvider(store, config, current)) in session_start
  - P2.M2.T2.S1: reads liveKeyByValue (expose it too, e.g. via __hapaxKey(value): string | undefined)
NO changes to: src/core/*, src/pi/config.ts, src/pi/ingest.ts, index.ts, package.json, tsconfig.json
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check        # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npm test -- test/provider-live.test.ts
npm test               # full suite green — especially provider-match (S1) untouched
```

### Level 3: Integration

None — no pi runtime in unit tests. P1.M3.T5.S1 registers the provider; P1.M4.T1.S1 runs end-to-end acceptance.

## Final Validation Checklist

- [ ] `npm run check` clean
- [ ] `npm test` all green; test/provider-match.test.ts unmodified and passing
- [ ] All three delegation paths (aborted / null state / zero matches) forward original args unchanged
- [ ] Hapax result path has zero awaits; mapping uses m.display for value/label, m.description as-is
- [ ] `prefix` comes from `state.prefix` (trigger char included in trigger mode)
- [ ] Live cache set on success, cleared on zero-candidate; accessible to S3; key side-map present for M2
- [ ] triggerCharacters `["#"]` default, `undefined` when triggerChar `""`
- [ ] Only src/pi/provider.ts extended and test/provider-live.test.ts added

## Anti-Patterns to Avoid

- ❌ Don't await anything on the hapax query path — Tab must resolve against the live result instantly
- ❌ Don't rebuild/duplicate trigger or threshold logic — extractMatchState (S1) is the single source
- ❌ Don't reformat `description` in the mapping — query.ts owns provenance formatting
- ❌ Don't swallow `force` or clone `options` when delegating
- ❌ Don't implement debounce/hysteresis here — that's S3; S2 returns results immediately every keystroke
- ❌ Don't call signal.throwIfAborted() — the contract here is delegate-on-abort, not throw

---

**Confidence Score: 9/10** — pi-tui contract verified verbatim from `autocomplete.d.ts`, rankMatches/RankedMatch shapes read from source, S1's exact interface pinned by its PRP, and test conventions confirmed. Residual risk: the `__hapaxLive` seam shape may need adjusting when S3 lands, but the data (matches/prefix/ts + value→key map) is complete.