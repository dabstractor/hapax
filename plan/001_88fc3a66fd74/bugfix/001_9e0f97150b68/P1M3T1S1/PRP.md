# PRP — bugfix P1.M3.T1.S1: Expose lazy-dictionary failure state + per-segment disable gate in IngestPipeline

## Goal

**Feature Goal**: Close the seam behind BUG-004's first half. Today a failed
dictionary load is sticky inside `createLazyDictionary` (closure `failed` flag,
`onLoadError` fired once, later lookups return null) but **invisible to any
consumer**, and `IngestPipeline.processText` keeps admitting words — every
`lookup() === null` word is admitted as rank group 0 (rarest, +1.0 rarity
bonus). This task adds (a) a `failed` probe on the lazy dictionary and an
optional `failed?: boolean` field on the `Dictionary` interface
(backward-compatible), and (b) an optional `isDisabled?: () => boolean`
constructor option on `IngestPipeline`, checked at the top of `processText`
**and per segment inside `#admitSegment`'s admission loop** so a failure
observed mid-message stops admissions within that message. The factory
(`src/pi/index.ts`) wires `isDisabled: () => disabled`.

**Deliverable**:
1. Modified `src/core/types.ts` — optional `readonly failed?: boolean` on
   `Dictionary`.
2. Modified `src/pi/index.ts` — `failed` getter on the lazy dictionary object;
   `isDisabled: () => disabled` in the `new IngestPipeline({...})` call.
3. Modified `src/pi/ingest.ts` — `isDisabled?` option + gate checks.
4. New/extended tests (see Task 4) proving `processText` with a failed dict
   stores nothing.

**Success Definition**: With `createLazyDictionary("/nonexistent/common-en.bin",
...)` wired into an `IngestPipeline`, `await processText(prose, true)` stores
ZERO candidates after the failure is observed (the very first lookup triggers
it); the failure probe reads true from that point on, never resets; `npm run
check` and `npm test` green; existing suites untouched except additive.

## Why

- BUG-004 (Major): PRD §03 loader contract — "Invalid magic/version: throw at
  load; the extension surfaces a notify and **disables itself** rather than
  running with a bad table." Today the factory's `disabled` flag (set in
  `onLoadError`) gates only the `message_end` handler. `restoreFromHistory`
  (kicked at `session_start`) calls `processText` directly with no gate — and at
  `session_start` the lazy dict hasn't loaded yet so `disabled` is still false.
  Result: on a resumed session with a missing/corrupt dict, the ENTIRE history
  is ingested as rank-group-0 ultra-rare candidates. Verified by probe: after
  replaying two prose messages, `rankMatches(store, 'with')` returns
  `{display:'with'}`.
- `lookup()` never throws by contract, so the gate must come from an explicit
  failure probe — there is no exception path to catch.
- This task is the **enabling seam** for P1.M3.T1.S2 (abort
  `restoreFromHistory` replay), which will consume the probe/gate. Do not
  modify `restoreFromHistory` here.

## What

### Behavior contract

1. **Dictionary probe** (`src/core/types.ts`):
   ```ts
   export interface Dictionary {
     lookup(word: string): number | null;
     readonly version: number;
     readonly entryCount: number;
     /** OPTIONAL failure probe (BUG-004): true once the backing load threw;
      *  never resets. Absent on the eager loadDictionary() result and on
      *  plain test stubs — check with `dict.failed === true`. */
     readonly failed?: boolean;
   }
   ```
   Adding an optional field is backward-compatible: the real
   `loadDictionary()` return and all existing test stubs compile unchanged.

2. **`createLazyDictionary`** (`src/pi/index.ts`, ≈L79–112): add to the
   returned object literal:
   ```ts
   get failed(): boolean {
     return failed; // closure flag — true from the first load throw, forever
   }
   ```
   Everything else unchanged: sticky failure, exactly one `onLoadError`,
   null lookups after failure, `version`/`entryCount` getters reporting 0.

3. **IngestPipeline option** (`src/pi/ingest.ts`):
   ```ts
   /** Optional disable gate (BUG-004): checked at the top of processText
    *  AND per segment inside #admitSegment's admission loop. When it
    *  returns true, no further candidates are admitted. The factory wires
    *  it to the sticky dictionary-failure flag; tests wire it to a
    *  mutable boolean. NOT config — internal wiring (PRD §08 surface
    *  unchanged). */
   isDisabled?: () => boolean;
   ```
   Store as `#isDisabled?: () => boolean` in the constructor (follow the
   existing `this.#x = options.x` pattern).

4. **Gate checks** (`src/pi/ingest.ts`):
   - **Top of `processText`**: `if (this.#isDisabled?.()) return;` — placed
     before the empty-text early return or immediately after (either is fine;
     keep it first so a disabled pipeline is a total no-op). This covers both
     the message drain and restore replay (both funnel through `processText`).
   - **Inside `#admitSegment`**: at the top of the `for (const token of
     tokenize(segment))` loop body: `if (this.#isDisabled?.()) break;` — so a
     failure observed mid-message (the first lookup of message 1 triggers it)
     stops admissions for the remainder of that message, and because failure
     is sticky, all subsequent messages too. **This is the load-bearing
     check**: without it, the whole first message's words are admitted as
     group 0 before the drain-level gate ever sees `disabled === true`.
   - **processText outer-loop exit**: after `#admitSegment` calls, if
     `this.#isDisabled?.()` is true, return early WITHOUT calling
     `#onAdmittedTokens(lines)` and WITHOUT continuing further slices — a
     half-disabled message's phrase windows are meaningless when the
     extension is dead. Add a one-line comment explaining this.
   - Keep the edits MINIMAL and localized: P1.M2.T1.S1 (`maskSecrets` in
     `#admitSegment`) is landing in parallel — do not restructure the loop.

5. **Factory wiring** (`src/pi/index.ts`, ≈L151):
   ```ts
   pipeline = new IngestPipeline({
     ...existing options...,
     isDisabled: () => disabled, // sticky dict-failure flag (BUG-004)
   });
   ```
   The closure already holds `disabled`; nothing else changes in the factory.
   `session_start`/`restoreFromHistory` wiring is P1.M3.T1.S2's work — do not
   touch it.

6. **No resets**: once `failed`/`disabled` is true it is true for the whole
   extension runtime (shutdown → session_start re-initializes, which is
   existing behavior).

## All Needed Context

### Documentation & References

```yaml
- file: src/pi/index.ts
  why: createLazyDictionary (≈L79–112) to extend with the `failed` getter;
        factory `disabled` flag (≈L125, L147–150) and the new IngestPipeline
        construction site (≈L151) to wire `isDisabled`
  pattern: getter-backed object literal already used for version/entryCount
  gotcha: at session_start the lazy dict has NOT loaded yet — `disabled` is
          still false; that is why the per-segment probe matters and why
          S2 aborts the replay loop on the probe, not just the flag

- file: src/pi/ingest.ts
  why: IngestPipelineOptions (≈L101) to extend; constructor (≈L169) option
        storage pattern; processText (≈L267) top-of-method gate + outer-loop
        early exit; #admitSegment (≈L302) token-loop gate
  gotcha: processText fires #onAdmittedTokens at the end — skip it when
          disabled; do NOT restructure loops (parallel maskSecrets work)

- file: src/core/types.ts
  why: Dictionary interface (L115–119) — add OPTIONAL failed field
  gotcha: keep it optional; eager loadDictionary() result and test stubs
          must compile unchanged

- file: test/ingest-pipeline.test.ts
  why: house pattern for constructing IngestPipeline with injected stubs
  pattern: NodeNext .js imports, vitest describe/it, header doc-comment

- file: test/ingest-restore.test.ts
  why: shows restoreFromHistory driving processText directly — the path
        being gated; S2 extends it, this task only needs the processText
        gate proven

- file: src/core/dictionary.ts
  why: loadDictionary throws on bad path/magic — the trigger for `failed`
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: Dictionary.lookup NEVER throws (contract) — a failed load
// returns null forever. Gating must probe `failed`/`isDisabled` explicitly.
// CRITICAL: failure observed MID-MESSAGE is the core bug: without the
// per-segment check inside #admitSegment, message 1's every word admits as
// group 0 before any drain-level gate runs. Both checks are required.
// CRITICAL: relative imports need .js extensions (NodeNext).
// Use a REAL createLazyDictionary on a nonexistent path in tests — mock
// nothing (work-item instruction): loadDictionary('/nonexistent/...') throws
// on first lookup, `failed` flips true, lookups return null thereafter.
// The sticky `failed` getter must never reset (no lazy retry).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/types.ts
  - ADD optional `readonly failed?: boolean` to Dictionary with the JSDoc
    above (Mode A docs: JSDoc IS the documentation for this seam)

Task 2: MODIFY src/pi/index.ts
  - ADD `get failed(): boolean { return failed; }` to the lazy dictionary
    object literal, with JSDoc ("true once the load threw; never resets;
    consumed by IngestPipeline's isDisabled wiring and restore abort")
  - ADD `isDisabled: () => disabled,` to the new IngestPipeline({...}) call
    with a one-line comment referencing BUG-004

Task 3: MODIFY src/pi/ingest.ts
  - ADD `isDisabled?: () => boolean` to IngestPipelineOptions (+ JSDoc)
  - STORE `#isDisabled` in the constructor per existing pattern
  - ADD top-of-processText gate; per-token-loop `break` gate in
    #admitSegment; outer-loop early return (skip slices AND
    #onAdmittedTokens) when disabled — all with brief comments

Task 4: EXTEND test/ingest-pipeline.test.ts (or new test/bad-dict-gate.test.ts
        if cleaner)
  - FOLLOW pattern: test/ingest-pipeline.test.ts (injected options, .js
    imports, header doc-comment)
  - COVERAGE (all against a REAL createLazyDictionary on a nonexistent
    path — no mocks):
    * processText(prose) with the failed dict → store.size() === 0,
      admitted stat 0, rankMatches(store, 'with') → []
      (the exact BUG-004 repro, now clean)
    * failure is sticky: second processText also stores nothing;
      lazyDict.failed === true both times; onLoadError fired exactly ONCE
    * mid-message disable: isDisabled wired to a mutable boolean that flips
      true after N admitted tokens (use a store.upsert-wrapping fake store
      or flip inside a tokenize-counting hook) → admissions stop at the
      flip; #onAdmittedTokens either skipped or partial per contract
    * absent isDisabled (undefined): pipeline behaves exactly as before
      (backward-compat — no gate)
    * eager Dictionary (real loadDictionary or plain stub) without
      `failed` field: typechecks and works (proves optionality)
  - NAMING: test/bad-dict-gate.test.ts or describe("disable gate (BUG-004)")
  - PLACEMENT: test/ (project convention — tests are NOT colocated)
```

### Implementation Patterns & Key Details

```ts
// #admitSegment gate — placed at the TOP of the token loop body:
for (const token of tokenize(segment)) {
  if (this.#isDisabled?.()) break; // BUG-004: dict failure mid-message
  ...
}

// processText top gate + outer-loop early exit:
async processText(text: string, fromUser: boolean): Promise<void> {
  if (this.#isDisabled?.()) return; // disabled pipeline = total no-op
  ...
  for (let off = 0; ...) {
    ...
    if (this.#isDisabled?.()) return; // skip phrase hook + remaining slices
    await this.#yieldFn();
  }
```

### Integration Points

```yaml
# No config change (option is internal wiring, not user config — PRD §08
# surface untouched). No manifest change.
# Consumed NEXT by P1.M3.T1.S2: restoreFromHistory's replay loop will check
# pipeline.isDisabled (or the lazyDict.failed probe) each iteration and
# abort the replay — this task provides that seam only.
```

## Validation Loop

### Level 1: Syntax & Style
```bash
npm run check        # tsc --noEmit — zero errors
```

### Level 2: Unit Tests
```bash
npx vitest --run test/ingest-pipeline.test.ts   # or the new suite file
npx vitest --run test/index.test.ts             # lazy dict behavior intact
npm test                                          # full suite green
```

### Level 3: Direct repro check (the bug report's probe, now inverted)
```bash
npx vitest --run test/bad-dict-gate.test.ts
# asserts: processText on a failed dict → store empty,
# rankMatches(store,'with') === [], onLoadError fired once
```

## Final Validation Checklist

- [ ] `npm run check` passes; `npm test` passes (existing suites unbroken)
- [ ] `Dictionary.failed` optional — eager dict + stubs compile unchanged
- [ ] Lazy dict `failed` getter: false before load, true after first failed
      load, never resets
- [ ] Top-of-processText gate + per-segment break + outer-loop early exit
      all present and commented (JSDoc = Mode A docs)
- [ ] Factory wires `isDisabled: () => disabled`
- [ ] BUG-004 repro inverted: failed dict + processText → store.size 0
- [ ] `restoreFromHistory` NOT modified (that is P1.M3.T1.S2)
- [ ] No config surface change; no PRD/tasks.json modifications
- [ ] Minimal, localized edits to `#admitSegment` (parallel maskSecrets work)

## Anti-Patterns to Avoid

- ❌ Don't gate only at drain level — the mid-message per-segment check is
  the actual fix
- ❌ Don't make `lookup()` throw or retry — sticky-null is the settled contract
- ❌ Don't make `failed` required on `Dictionary` — it would break every stub
- ❌ Don't mock the lazy dictionary — test against a nonexistent path
- ❌ Don't touch `restoreFromHistory` or session_start (S2's scope)
- ❌ Don't colocate tests in src/ — use test/

**Confidence Score: 9/10** — exact insertion points verified by reading the
current source; the contract is fully pinned by the work item + BUG-004
analysis; only risk is merge overlap with the parallel maskSecrets task in
`#admitSegment`, mitigated by the keep-edits-minimal instruction.