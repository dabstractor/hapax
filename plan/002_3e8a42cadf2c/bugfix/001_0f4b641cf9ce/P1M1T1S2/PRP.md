# PRP — P1.M1.T1.S2 (plan 002, bugfix 001_0f4b641cf9ce): Wire stock-context delegation into getSuggestions before the armed-chain branch

---

## Goal

**Feature Goal**: Fix BUG-001(a) and its Tab-opens-menu half (b): wire
`classifyStockContext` into `createHapaxProvider.getSuggestions` so that any
cursor position pi's built-in completion owns (slash command, @-mention,
quoted path, path) delegates VERBATIM to the wrapped `current` provider —
before the armed-chain branch, after the aborted check — restoring PRD §07
("return current.getSuggestions(...) untouched — path/slash completion must
keep working exactly as before, including inside quoted paths"), the §01
"Tab never opens the menu" invariant in slash contexts, and §09 integration
item 6.

**Deliverable**:
- Modified `src/pi/provider.ts`: one delegation gate in `getSuggestions`
  (≈3 lines) + doc-comment updates (flow order note in the factory doc and
  the getSuggestions step list).
- New TDD test coverage in `test/provider.test.ts` (and/or
  `test/provider-live.test.ts` per the sentinel convention) for the eight
  contract cases below.

**Success Definition**: All new delegation cases pass with the sentinel
convention (identity of args and result); existing suite stays green;
`npm run check` clean; plain-word hapax behavior and the forced single-item
mitigation are unchanged for genuine hapax contexts.

## Why

BUG-001: `extractMatchState`'s threshold regex fires on any trailing
identifier, so `/re`, `@jo`, and `"src/roun` return hapax word items while
`current.getSuggestions` is never called — pi's slash-command menu,
@-mention menu, and path completion are hijacked. Worse, in a slash context
pi-tui's Tab path calls `requestAutocomplete({force:false, explicitTab:true})`,
gets hapax's multi-item word set, and OPENS the menu on a single Tab (violating
the acceptance-critical Tab contract). Gating on
`classifyStockContext` (built in P1.M1.T1.S1) delegates those contexts so
both failures vanish simultaneously. The gate must run BEFORE the armed-chain
branch so stock contexts also win while a chain is armed (e.g. Tab-accepting
a word then typing `/re`).

## What

In `src/pi/provider.ts` `createHapaxProvider`'s `getSuggestions`, insert
immediately after the aborted-signal check (step 1) and BEFORE
`const forced = options.force === true;` (step 1.1) and the armed-chain
branch (step 1.5):

```typescript
// 1.2 Stock-context gate (BUG-001): the cursor sits in a context pi's
// built-in completion owns (slash / @-mention / quoted path / path —
// see classifyStockContext above). Delegate VERBATIM, before the armed
// branch and the force read, so typing-path, forced Tab, and
// armed-chain-overlapped stock contexts all delegate. Options are the
// ORIGINAL object — never cloned (existing tests assert identity).
if (classifyStockContext(lines, cursorLine, cursorCol)) {
  return current.getSuggestions(lines, cursorLine, cursorCol, options);
}
```

Nothing else changes: keep the §07 h3.8 forced single-item mitigation intact
for genuine hapax contexts; do not clear `lastLive` on this path (mirror the
aborted-delegate precedent — only the zero-candidate path clears the cache);
do not reset the chain here (chain reset semantics belong to P1.M1.T2 rules);
do not arm on stock items.

TDD cases (sentinel convention — `current` is a vi.fn mock whose
`getSuggestions` returns a recognizable SENTINEL object):

1. `getSuggestions(['/re'], 0, 3, {signal:{aborted:false}, force:false})`
   after ingesting a rare word ('renewable') → returns the SENTINEL, with
   args passed by IDENTITY (same lines array, same options object).
2. Same input with `{force:true}` → still the SENTINEL (stock gate outranks
   the force read/mitigation — that is the Tab-opens-menu fix).
3. `['@jo']` (col 3) → delegates (SENTINEL).
4. `['"src/roun']` (col 9) → delegates (SENTINEL).
5. `['src/roun']` (col 8) → delegates (SENTINEL).
6. Plain `'re'` after ingest of a rare word (e.g. via a CandidateStore +
   real-or-stub dictionary; reuse `COMMON_PROBES`-style ingest or
   provider-live's ingest helper) → returns hapax items (NOT the sentinel),
   proving the gate does not over-fire on prose.
7. Armed chain + `'/re'`: arm a word via the production path (menu + Tab
   `applyCompletion`, as test/provider-live.test.ts lines ~415-437 do), then
   call `getSuggestions(['/re'], 0, 3, opts)` → delegates (SENTINEL); the
   chain is NOT armed on a stock item (assert via `chain.state()` unchanged
   or `__hapaxLive()` semantics — chain reset refinement is P1.M1.T2's, so
   only assert delegation here, not reset).
8. Purity of the gate path: no modification of `lines`, `options`, or any
   element (identity assertions cover this — `toHaveBeenCalledWith` with the
   exact same references, per the existing `expectUntouchedArgs` helper).

### Success Criteria

- [ ] Gate present in `getSuggestions` after the aborted check, before the
      armed-chain branch and the `forced` read
- [ ] Cases 1–8 pass; `/re` with force:true returns the stock sentinel
- [ ] Options/args forwarded by identity — never cloned
- [ ] Forced single-item mitigation still works in genuine hapax contexts
      (existing `test/provider.test.ts` forced-single-item block stays green)
- [ ] Existing extractMatchState / classifier / chain / debounce suites green
- [ ] `npm test` + `npm run check` fully green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the exact insertion point
(current `getSuggestions` step order quoted below), the exact gate code, the
test files' sentinel conventions (helpers named), and the full current flow
of `createHapaxProvider.getSuggestions` are reproduced here.

### Documentation & References

```yaml
- file: src/pi/provider.ts
  why: The ONLY source file to modify. Current getSuggestions step order
        (verified this session):
          1.  aborted check → current.getSuggestions(args unchanged)
          1.1 const forced = options.force === true   ← gate goes BEFORE this
          1.5 armed-chain branch (chain.state() && config.enableChaining)
          2.  extractMatchState null → delegate
          3.  rankMatches [] → clear cache, delegate
          4.  publish lastLive/liveKeyByValue → items, forced narrowing
        Also update the factory doc comment's delegation priority list to
        insert "stock-context" as step 2, and the file header if it
        summarizes the flow.
  pattern: delegation always `return current.getSuggestions(lines,
        cursorLine, cursorCol, options);` with the ORIGINAL options object.
  gotcha: classifyStockContext is added by P1.M1.T1.S1 directly after
        extractMatchState — it will exist by the time this task starts
        (contract). If absent, STOP: S1 not landed.

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M1T1S1/PRP.md
  why: CONTRACT for classifyStockContext: signature
        (lines: string[], cursorLine: number, cursorCol: number) =>
        StockContext | null; values "slash"|"mention"|"quoted-path"|"path"|null;
        truthy === delegate. Config-independent, pure, line-local.
        Its classifier unit tests live in test/provider-match.test.ts.

- file: test/provider.test.ts
  why: PRIMARY test target. Established conventions (read the header, ~lines
        1-130): `mockCurrent()` factory (getSuggestions: vi.fn, applyCompletion:
        vi.fn forwarding, shouldTriggerFileCompletion: vi.fn(() => true));
        `expectUntouchedArgs(current, lines, line, col, options)` asserting
        one call with the exact arg references; `makeStack(store, current)`
        wrapping createHapaxProvider (exposed as `inner`) + createDisplayProvider
        (`provider`); PATH_SENTINEL-style sentinel objects with identity asserts.
  pattern: "expect(result).toBe(PATH_SENTINEL)  // identity — pi's result,
        not a copy". Use a STOCK_SENTINEL for the new cases.
  gotcha: test BOTH layers where relevant — the inner createHapaxProvider
        for the gate, and note createDisplayProvider passes delegated results
        through its !isHapax branch untouched (existing behavior, covered by
        its own suite; no new display-layer change is needed or wanted).

- file: test/provider-live.test.ts
  why: Delegation describes (aborted / null match state / zero candidates)
        + forced-single-item block + the armed-chain production-path arming
        recipe (menu → applyCompletion → getSuggestions at ["alpha "]) used
        for case 7. Conventions: describe/it from vitest, opts() helper
        building {signal:{aborted:false}} etc.
  pattern: it("'...' delegates with args untouched (stock context)") with
        expectUntouchedArgs-style identity assertions.

- file: test/calibration.test.ts
  why: exports COMMON_PROBES = ["with","this","them","that","have","would"]
        (line ~64) — importable for ingest text in negative case 6 if you
        want realistic prose; or simply ingest a made-up rare word
        ('renewable', 'zendesk') through the pipeline/store helper the
        provider tests already use.

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/provider-tui-integration.md
  why: Validated fix design (mirrors pi-tui dist): fix item 2 is this wiring;
        explains why the gate must precede the armed branch (stock contexts
        must also win during chains) and why options pass through unchanged.

- type: AutocompleteProvider from @earendil-works/pi-tui (autocomplete.d.ts)
  why: `current`'s shape — getSuggestions(lines, cursorLine, cursorCol,
        options) => Promise<AutocompleteSuggestions | null>. No pi-tui import
        needed in tests: `current` is a plain vi.fn mock object.
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/pi/
│   └── provider.ts          # MODIFY — add the stock gate + doc updates
│                            #   (extractMatchState + classifyStockContext already present from S1)
├── test/
│   ├── provider.test.ts     # EXTEND — sentinel delegation cases
│   ├── provider-live.test.ts# EXTEND (optional) — live-path delegation + armed-chain case
│   └── provider-match.test.ts # untouched (S1's classifier tests live here)
└── node_modules/@earendil-works/pi-tui  # reference only
```

### Desired Codebase tree with files to be changed

```bash
src/pi/provider.ts           # +~15 lines (gate + comments)
test/provider.test.ts        # +1 describe block (~8 its)
test/provider-live.test.ts   # +1-2 its (armed-chain-overlapped case) — optional home
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: Gate ORDER is the contract: aborted check → STOCK GATE → forced
#   read → armed branch → extractMatchState. Placing it after the armed
#   branch lets chains hijack '/re'; placing it after `forced` re-enables
#   the Tab-opens-menu path in slash contexts (force:false+explicitTab).
# CRITICAL: options passed UNCHANGED — same object reference. Existing tests
#   assert arg identity; cloning breaks them and pi semantics.
# CRITICAL: Do NOT clear lastLive on the stock-delegate path — the existing
#   aborted-delegate path doesn't (only zero-candidates does), and the
#   display layer's isHapax prefix check already prevents stale-paint issues.
# GOTCHA: Do NOT reset the chain in this gate — P1.M1.T2 owns chain reset
#   rules (armed chain + '/re' delegates; what happens to the armed state
#   afterwards is T2's spec). Case 7 asserts delegation only.
# GOTCHA: '/model arg re' must NOT delegate (classifier's no-space clause
#   returns null) — plain threshold word completion stays hapax's there.
#   Add a negative classifier-interplay case if cheap.
# GOTCHA: vi-mock ONLY `current`; no pi-tui runtime import in tests (the
#   provider file's own type-only import is fine and already present).
# GOTCHA: force is optional on the options type — tests build it explicitly
#   ({signal:{aborted:false}, force:false} / {force:true}) per the contract.
# GOTCHA: Ingest for case 6: the provider test files already construct
#   stores; the simplest deterministic setup is ingesting a
#   dictionary-absent word (e.g. 'renewable zendesk') through IngestPipeline
#   with a stub dictionary, or seeding the store directly via upsert —
#   reuse whatever the surrounding file's helpers do; do NOT invent a new
#   harness.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies, TDD)

```yaml
Task 0: PRECONDITION
  - Confirm src/pi/provider.ts exports classifyStockContext (P1.M1.T1.S1
    landed) and its tests in test/provider-match.test.ts are green.
    If absent: STOP — S1 not landed.

Task 1: WRITE FAILING TESTS FIRST (TDD)
  - EXTEND test/provider.test.ts with
    describe("stock-context delegation (BUG-001)"):
      - "'/re' with force:false delegates to current, args by identity"
      - "'/re' with force:true delegates (stock gate outranks force)"
      - "'@jo' delegates"
      - "'\"src/roun' delegates (quoted path)"
      - "'src/roun' delegates (path)"
      - "'/model arg re' does NOT delegate (no-space clause) — hapax path"
      - "plain 're' after ingest returns hapax items (gate silent on prose)"
  - Each delegating case: current mock returns STOCK_SENTINEL; assert
    result === STOCK_SENTINEL and getSuggestions called once with the exact
    arg references (reuse expectUntouchedArgs or inline toHaveBeenCalledWith
    identity).
  - EXTEND test/provider-live.test.ts (or provider.test.ts) with
    "armed chain + '/re' delegates" using the existing arming recipe.
  - RUN: npx vitest --run test/provider.test.ts → new cases FAIL (gate absent).

Task 2: IMPLEMENT THE GATE
  - src/pi/provider.ts getSuggestions: insert the 1.2 gate exactly as
    quoted in "What", after the aborted check, before `const forced`.
  - Update the factory doc comment's delegation priority list to include
    the stock-context gate (renumber: abort → stock context → armed →
    null-match-state → zero-candidates) and note BUG-001.
  - Update the file header's flow summary if present.

Task 3: RUN AND GREEN
  - npx vitest --run test/provider.test.ts test/provider-live.test.ts
  - npm test        # full suite (636+ tests) green
  - npm run check   # tsc clean

Task 4: REGRESSION SPOT-CHECKS
  - Forced single-item block in provider.test.ts still green (genuine
    hapax contexts unchanged).
  - test/provider-display.test.ts (if present) / debounce suites green —
    no display-layer change made.
  - Chain tests (test/chain.test.ts) green — gate added before the armed
    branch must not affect chain behavior in non-stock contexts.
```

### Implementation Patterns & Key Details

```typescript
// THE gate (exact placement quoted from current source):
async getSuggestions(lines, cursorLine, cursorCol, options) {
  // 1. Aborted → pass pi's request through, arguments untouched.
  if (options.signal.aborted) {
    return current.getSuggestions(lines, cursorLine, cursorCol, options);
  }
  // 1.2 Stock-context gate (BUG-001): slash / @-mention / quoted path /
  // path — delegate verbatim BEFORE the forced read and the armed branch.
  if (classifyStockContext(lines, cursorLine, cursorCol)) {
    return current.getSuggestions(lines, cursorLine, cursorCol, options);
  }
  const forced = options.force === true;   // unchanged
  // ... rest of getSuggestions unchanged ...

// Test pattern (mirror test/provider.test.ts conventions):
const STOCK_SENTINEL: AutocompleteSuggestions = {
  items: [{ value: "/resume", label: "/resume", description: "stock" }],
  prefix: "/re",
};
const current = mockCurrent({
  getSuggestions: vi.fn(async () => STOCK_SENTINEL),
});
const { inner } = makeStack(store, current);
const options = { signal: { aborted: false }, force: false };
const result = await inner.getSuggestions(["/re"], 0, 3, options);
expect(result).toBe(STOCK_SENTINEL);              // identity
expect(current.getSuggestions).toHaveBeenCalledOnce();
expect(current.getSuggestions).toHaveBeenCalledWith(["/re"], 0, 3, options);
```

### Integration Points

```yaml
NEXT TASK (P1.M1.T2): armed-chain trigger-char reset — its rules define what
  happens to an armed chain AFTER a stock-context delegation (and trigger-char
  consumption). This task deliberately leaves chain state untouched; do not
  pre-empt T2's reset semantics.
CONSUMERS: the final regression task (P1.M4.T1) re-verifies §09 integration
  item 6 and the Tab-never-opens-menu invariant against this gate; user-facing
  behavior summary lands in P1.M4.T2 docs (Mode A: no docs change here).
TEST BASELINE: 636 tests green, tsc clean. Only provider.ts + test files change.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit clean
```

### Level 2: Unit Tests (the deliverable's core)

```bash
npx vitest --run test/provider.test.ts -t "stock-context" -v   # all new cases
npx vitest --run test/provider.test.ts test/provider-live.test.ts
npm test                                                       # full suite
```

### Level 3: Integration-level (within unit harness)

```bash
# End-to-end shape of the bug report's repro, now delegating:
# (covered by the new tests; no live pi process exists for this repo)
npx vitest --run test/provider.test.ts -t "delegates"
# Verify the armed-chain-overlapped case specifically:
npx vitest --run test/provider-live.test.ts -t "armed"
```

### Level 4: Domain-Specific (spec invariants)

```bash
# §09 integration item 6 (path/slash/@ identical to stock pi) is restored by
# these tests — confirm the full-suite run includes calibration/acceptance:
npm test
# Tab-never-opens-menu in slash contexts: the force:true '/re' case is the
# regression pin for it (pi-tui's slash Tab path returns the stock single
# command set / null, never hapax's word set).
```

## Final Validation Checklist

- [ ] Gate inserted after aborted check, before `forced` read and armed branch
- [ ] Options and lines forwarded by identity (no cloning) — asserted in tests
- [ ] All 8 contract cases pass (incl. `/re`+force:true → SENTINEL; armed
      chain + `/re` → SENTINEL; plain `re` after ingest → hapax items)
- [ ] Forced single-item mitigation intact for genuine hapax contexts
- [ ] classifyStockContext / extractMatchState / chain machine / display
      provider code otherwise unchanged
- [ ] `npm test` full suite green; `npm run check` clean
- [ ] Only src/pi/provider.ts and test/provider*.test.ts modified
- [ ] No docs/config/env change (Mode A); no new dependencies

## Anti-Patterns to Avoid

- ❌ Don't place the gate after the armed branch or after the `forced` read
- ❌ Don't clone/rebuild `options` or `lines` when delegating
- ❌ Don't clear `lastLive` or reset the chain on the delegate path (chain
      reset semantics are P1.M1.T2's)
- ❌ Don't modify extractMatchState or classifyStockContext (S1 owns them)
- ❌ Don't special-case trigger chars inside the gate (classifier is
      config-independent by contract)
- ❌ Don't import pi-tui at runtime in tests — `current` is a vi.fn mock
- ❌ Don't skip the TDD order — write the failing sentinel tests first

---

**Confidence Score**: 9/10 — insertion point, exact gate code, test-file
conventions (helpers, sentinel pattern, arming recipe) all verified against
the live source this session; the only dependency is S1's classifier landing
as contracted.
