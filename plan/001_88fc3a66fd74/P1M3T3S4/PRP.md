# PRP — P1.M3.T3.S4: Never-hijack acceptance tests (delegation, zero-candidate, pass-through)

## Goal

**Feature Goal**: Write `test/provider.test.ts` — the acceptance-test regression net for PRD §07 "Never-hijack rules" and design invariant #1 ("never hijack typing"). The provider only ever *returns* suggestions; pi owns all key handling. These tests assert **delegation correctness** and **emission discipline**: on every non-hapax path the wrapped `current` provider is invoked with *unchanged arguments* and its result is returned untouched; zero-candidate queries never produce a hapax menu; common words (`the`, `context` — quant ≥ 220) never enter the store so they can never surface.

**Deliverable**: `test/provider.test.ts` (new file only — no production code changes expected).

**Success Definition**: `npm run check` clean; `npm test` green with the new suite; all seven contract cases (a)–(g) below covered with a mock `current` built from `vi.fn()` wrappers recording every call. This file is the regression net that P2.M2.T2.S1 (chain machine) must not break.

## Why

PRD §01 invariant 1 and §07 "Never-hijack rules" are acceptance-critical: a broken delegation silently kills pi's path/slash completion (quoting paths, `@`-mentions) and destroys the "typing experience identical with or without the extension" guarantee. These behaviors live as emergent properties spread across S1 (`extractMatchState` null), S2 (delegation paths), and S3 (close/delegate passthrough) — nothing currently tests them end-to-end at the provider-object level. A dedicated suite also protects the M2 chain machine from reintroducing hijacking.

## What

Test the **complete provider stack as it will be registered in P1.M3.T5.S1**:

```ts
const provider = createDisplayProvider(
  createHapaxProvider(store, config, current),
); // current = mock built from vi.fn()
```

Cases (PRD §09-driven; item contract (a)–(g)):

- **(a) No fragment → untouched delegation.** Empty line; prose with no threshold/trigger match (e.g. `col 0`, or `"hello "` with threshold 2). `current.getSuggestions` called with the *exact same* `(lines, line, col, options)` arguments (assert with `toHaveBeenCalledWith` / `vi.fn` arg identity), and its (possibly null, possibly fake path-completion) result returned unchanged. Include a quoted-path fixture (`'read "src/co'` → delegated so path completion keeps working).
- **(b) `applyCompletion` ALWAYS delegates.** Call with arbitrary args even when a hapax menu is live; assert `current.applyCompletion` received them verbatim and its return value is passed through.
- **(c) `shouldTriggerFileCompletion` delegation.** With `current.shouldTriggerFileCompletion` defined: verbatim delegate + return. With it absent: returns `true` (`?.(…) ?? true`), no throw.
- **(d) Zero-candidate query → delegation, never a menu.** Match state qualifies (fragment `"zzzz"` ≥ threshold) but store has no candidates: result is exactly `current.getSuggestions(...)`'s return; no hapax items ever emitted; `__hapaxLive()` (on the inner provider) is `null`.
- **(e) Common words never produce hapax items.** Two layers: (1) admission — run `"the"`/`"context"` tokens through the real `admit()` with a dictionary whose `lookup` returns ≥ 220 (`REJECT_COMMON_THRESHOLD`) and assert `"reject"`, so they never enter the store; (2) end-to-end — a store built without such words + a line ending in `the`/`contex` (≥ threshold chars) → delegation, zero hapax items.
- **(f) Tab pass-through — nothing intercepts.** The provider contract has no key handling; assert that with no visible/selected suggestion the provider's `getSuggestions` returns `null`/delegated result and exposes **no** key-handling surface: the provider object's own enumerable keys are only the pi-tui contract members (+ the documented `dispose` seam of S3). Tab semantics are pi's; we only assert nothing in our object could consume it.
- **(g) Case-insensitive match, display casing inserted.** Store candidate `NREL` (upserted with display casing); type `nrel` → suggestion items include one with `value === "NREL"` (prefix `nrel` matched case-insensitively, insertion uses display casing).

### Success Criteria

- [ ] All cases (a)–(g) implemented and green
- [ ] Every delegation assertion verifies arguments passed through **unchanged** (object identity or deep-equal on all four args incl. `options`)
- [ ] No production file modified (if a genuine S2/S3 bug is found, fix in `src/pi/provider.ts` with a minimal, documented change — this suite is allowed to drive such fixes, that is its purpose)
- [ ] `test/provider-match.test.ts`, `test/provider-live.test.ts`, `test/provider-display.test.ts` untouched and still green

## All Needed Context

### Documentation & References

```yaml
- file: src/pi/provider.ts
  why: The system under test. S1 extractMatchState (already merged, read it);
        S2 createHapaxProvider + __hapaxLive seam; S3 createDisplayProvider —
        both landing per their PRPs (plan/001_88fc3a66fd74/P1M3T3S2/PRP.md,
        P1M3T3S3/PRP.md). Assume those contracts exactly.
  critical: S2 delegation paths (aborted signal, null match state, zero
        candidates) ALL return current.getSuggestions(lines, line, col, options)
        with unchanged args. S3 passes close/delegate results through unchanged.

- file: node_modules/@earendil-works/pi-tui/dist/autocomplete.d.ts
  why: AutocompleteProvider / AutocompleteSuggestions / AutocompleteItem shape —
        verified in S2 research: getSuggestions → Promise<{items, prefix} | null>;
        applyCompletion synchronous returning {lines, cursorLine, cursorCol};
        shouldTriggerFileCompletion OPTIONAL.
  gotcha: import types with ".js"-style ESM discipline used repo-wide:
        `import type { AutocompleteItem } from "@earendil-works/pi-tui";`

- file: src/core/store.ts
  why: CandidateStore fixture — upsert candidates directly (e.g. "NREL",
        "zendesk") so no dictionary/ingest is needed for provider-path cases.
        Check its actual upsert signature before use (single-word key + display).

- file: src/core/score.ts
  why: `admit(draft, dictionary, parentGroup?)` and REJECT_COMMON_THRESHOLD (220)
        — case (e) layer 1. CandidateDraft shape: check src/core/types.ts
        (key/display/isSubword fields). A stub Dictionary is any object with
        `lookup(key) => number | null`.

- file: src/pi/config.ts
  why: HapaxConfig for the fixture — triggerChar default "#", threshold
        (default 2, clamp 1–3), maxSuggestions. Check for an exported
        defaults/constant to build a valid config object (do NOT hand-roll
        invalid values).

- file: test/ingest-pipeline.test.ts, test/query.test.ts
  why: Repo vitest conventions — ESM ".js" import suffixes, describe/it,
        module doc-comment header, no fake timers needed for this suite
        (S4 tests are not debounce tests; use one display wrapper with default
        opts and keep sequences slow enough — i.e. >100 ms apart or identical
        sets — that debounce never muddies an assertion; simplest: fresh
        provider per test).
  gotcha: NEVER modify existing test files; this task adds exactly one file.

- docfile: plan/001_88fc3a66fd74/P1M3T3S2/research/notes.md
  why: Verified pi-tui contract verbatim + S2 delegation semantics summary.
- docfile: plan/001_88fc3a66fd74/P1M3T3S3/PRP.md
  why: S3 wrapper contract: close/delegate results returned UNCHANGED with
        state reset; __hapaxLive() null ⇒ delegation classification.
```

### Current Codebase tree (relevant)

```
src/pi/provider.ts        # S1 merged; S2, S3 landing in parallel per their PRPs
src/core/{store,score,query,types}.ts   # complete (P1.M2)
src/pi/config.ts, src/pi/ingest.ts      # complete
test/provider-match.test.ts             # S1 — DO NOT TOUCH
test/provider-live.test.ts              # S2 (parallel) — DO NOT TOUCH
test/provider-display.test.ts           # S3 (parallel) — DO NOT TOUCH
```

### Desired additions

```
test/provider.test.ts    # NEW — never-hijack acceptance suite (this task's only deliverable)
```

### Known Gotchas

```ts
// CRITICAL: S2/S3 may still be landing when you start. Read src/pi/provider.ts
//   first; if createHapaxProvider/createDisplayProvider are absent, STOP and
//   report blocked rather than reimplementing them.
// CRITICAL: "unchanged args" assertions must include the options object — use
//   toHaveBeenCalledWith(lines, line, col, options) with the SAME object
//   reference passed in (identity, not a clone).
// GOTCHA: (g) case-insensitivity: rankMatches lowercases the prefix internally
//   but the stored display casing is returned in item.value — assert value
//   === "NREL" while prefix === "nrel".
// GOTCHA: (d)/(e) — a fresh provider per test avoids S3 debounce state
//   (lastPaintAt/displayedSig) leaking between cases; alternatively use
//   dispose() in afterEach.
// GOTCHA: (f) has no real "Tab" to press in unit tests — pi owns keys. The
//   meaningful assertions are: delegated/null return on non-qualifying state,
//   and provider surface = contract-only. Do not fake a key event.
// GOTCHA: mock `current.getSuggestions` should return a recognizable sentinel
//   ({ items: [{ value: "/path/", label: "/path/" }], prefix: "" } or null in
//   different tests) so pass-through is provable, not just call-count.
// GOTCHA: ESM ".js" import suffixes on all relative imports.
```

## Implementation Blueprint

### Test fixture shape

```ts
import { describe, it, expect, vi } from "vitest";
import { createHapaxProvider, extractMatchState } from "../src/pi/provider.js";
import { createDisplayProvider } from "../src/pi/provider.js";
import { CandidateStore } from "../src/core/store.js";
import { admit, REJECT_COMMON_THRESHOLD } from "../src/core/score.js";

function makeCurrent(overrides: Partial<AutocompleteProvider> = {}) {
  return {
    getSuggestions: vi.fn(async () => null),
    applyCompletion: vi.fn((lines, _l, c, item, prefix) =>
      ({ lines, cursorLine: _l, cursorCol: c + item.value.length - prefix.length })),
    shouldTriggerFileCompletion: vi.fn(() => true),
    ...overrides,
  };
}
// Fresh per test: store (upsert "NREL", "zendesk", ...), config with
// threshold 2, provider = createDisplayProvider(createHapaxProvider(store, config, current))
// opts.signal = new AbortController().signal
```

### Implementation Tasks (ordered)

```yaml
Task 1: CREATE test/provider.test.ts
  - HEADER: module doc-comment naming PRD §01 invariant 1 + §07 never-hijack rules
  - FIXTURES: makeCurrent (vi.fn wrappers, above); CandidateStore upserts;
    config per src/pi/config.ts defaults; helper `suggest(line, col, current)` that
    calls provider.getSuggestions([line], 0, col, { signal })
  - CASES (a)–(g) exactly per "What" above, one describe block "never-hijack acceptance (PRD §07)"
  - NAMING: it("<scenario> → <delegation/emission expectation>")
  - PLACEMENT: test/provider.test.ts; touch NOTHING else
Task 2: RUN + fix-or-report
  - npm test -- test/provider.test.ts; if a production delegation bug surfaces,
    make the minimal src/pi/provider.ts fix with a comment citing the failing
    invariant; re-run full suite
```

### Integration Points

```yaml
DOWNSTREAM:
  - P2.M2.T2.S1 (chain machine) MUST keep this suite green — it is the
    never-hijack regression net for all M2 work.
  - P1.M4.T1.S1 integration acceptance cites these cases.
NO changes to: any src file (unless driving out a real bug), existing tests,
  package.json, tsconfig.json.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors (test files are type-checked too)
```

### Level 2: Unit Tests

```bash
npm test -- test/provider.test.ts   # new suite green
npm test                            # full suite green; sibling provider tests untouched
```

### Level 3: Integration

None — end-to-end never-hijack verification against live pi is P1.M3.T5.S1 (dev-load) and P1.M4.T1.S1.

## Final Validation Checklist

- [ ] `npm run check` clean; `npm test` fully green
- [ ] Cases (a)–(g) all present and passing, each delegation asserted with unchanged arguments (incl. `options`)
- [ ] Quoted-path delegation fixture included in case (a)
- [ ] `shouldTriggerFileCompletion?.(…) ?? true` covered both with and without the optional method
- [ ] Common-word case asserts both admission rejection (q ≥ 220 → `"reject"`) and end-to-end delegation
- [ ] `value === "NREL"` from fragment `nrel` asserted (case g)
- [ ] Only `test/provider.test.ts` added; sibling provider test files unmodified
- [ ] If production code was changed to fix a discovered bug: change is minimal, commented, and the full suite stays green

## Anti-Patterns to Avoid

- ❌ Don't assert call counts without asserting *arguments and return pass-through* — the invariant is about unchanged delegation
- ❌ Don't fake key events / invent a key-handling API to "test Tab" — pi owns keys; test the contract surface
- ❌ Don't reuse one provider instance across tests without dispose — S3 debounce state leaks
- ❌ Don't modify S1/S2/S3 code preemptively "to make tests pass" — only fix a demonstrated invariant violation
- ❌ Don't hand-roll a HapaxConfig with out-of-range values — use the real defaults from src/pi/config.ts