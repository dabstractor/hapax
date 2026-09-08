# PRP — P1.M1.T2.S1 (bugfix 001_0f4b641cf9ce): Require word-start fragments in the armed branch; reset + fall through otherwise

---

## Goal

**Feature Goal**: Fix BUG-005 — while a chain is armed, the armed-branch
fragment regex `[A-Za-z][A-Za-z0-9_]*$` matches a fragment glued to the
trigger char (`#b` → matches `b`), returning successors with prefix `b` so
pi-tui's blind `prefix.length` deletion leaves the `#` in the buffer. The
armed-branch fragment path must require the fragment to sit at a WORD START;
otherwise `chain.reset()` and fall through to the normal path so trigger mode
wins with the correct `#frag` prefix.

**Deliverable**: A ~6-line guard + comment update in `src/pi/provider.ts`
armed branch (typed-fragment path (b)), plus TDD cases in `test/chain.test.ts`
using its existing helper conventions.

**Success Definition**: `x alphaone #b` with an armed chain on `alphaone`
returns trigger-mode items with prefix `'#b'` and `chain.state() === null`;
`x alphaone be` still filters successors at prefix `'be'`; the zero-typed-char
offer is unchanged; full `npm test` + `npm run check` green.

## Why

- PRD §07 state machine: "Any non-Tab key that disqualifies (space, escape,
  punctuation) → idle" and trigger-char match has priority over threshold.
  The armed branch deliberately bypasses `extractMatchState`, so without this
  guard trigger mode can never win while armed.
- pi-tui's stock `applyCompletion` (autocomplete.js:265+,
  `beforePrefix = line.slice(0, cursorCol - prefix.length)`) deletes exactly
  `prefix.length` chars blindly — a chain answer at prefix `b` for buffer
  text `#b` corrupts the line into `#betaword`. Trigger-mode completion must
  consume the trigger char (prefix `#b`).
- P1.M1.T2.S2 (editor-sim integration test) consumes this corrected armed
  branch to verify trigger consumption and the one-word invariant during
  chains.

## What

In `src/pi/provider.ts`, armed branch (inside `if (armed && config.enableChaining)`,
~L321), typed-fragment path (b) — currently:

```ts
const frag = before.match(/[A-Za-z][A-Za-z0-9_]*$/)?.[0];
const succ = frag === undefined ? [] : store.topSuccessors(armed.word)
  .filter((s) => s.next.startsWith(frag.toLowerCase()))
  .slice(0, config.maxSuggestions);
if (frag === undefined || succ.length === 0) {
  chain.reset();
} else { ... return ...; }
```

Insert the word-start guard BEFORE the successor filter, extending the
disqualify condition:

```ts
const frag = before.match(/[A-Za-z][A-Za-z0-9_]*$/)?.[0];
// BUG-005 word-start guard: a fragment glued to the trigger char (or any
// punctuation '/') is NOT a chain fragment — pi-tui's applyCompletion
// deletes exactly prefix.length chars blindly, so answering at prefix
// "b" for "#b" would strand the "#". Reset and fall through so the
// normal path (extractMatchState) answers in trigger mode at "#b".
const fragAt = frag === undefined ? -1 : before.length - frag.length;
const fragAtWordStart =
  frag !== undefined &&
  (fragAt === 0 || /[ \t]/.test(before[fragAt - 1] ?? ""));
if (
  frag === undefined ||
  !fragAtWordStart ||
  store.topSuccessors(armed.word)
    .filter((s) => s.next.startsWith(frag.toLowerCase()))
    .slice(0, config.maxSuggestions).length === 0
) {
  // (c) Disqualify ... chain.reset(); fall through (unchanged)
  chain.reset();
} else { ... }
```

(Exact restructuring may vary — the CONTRACT is: fragment not at a word
start → `chain.reset()` with NO return, execution continues past the armed
branch into step 2 `extractMatchState`, exactly like the existing
zero-matching-successors disqualify. Do not return an empty set from the
armed branch.)

Also update the branch's block comment (the (b) bullet, ~L295-297) to
document the word-start requirement and the BUG-005 rationale.

Unchanged: zero-typed-char offer (a) (`before === "" || /[ \t]$/`), normal
filtering at word starts, the force mitigation, the
`enableChaining` gate, `publishChain`, and everything outside the armed
branch.

### TDD cases (test/chain.test.ts, existing conventions)

Write these FIRST (red), then implement. Use the file's helpers:
`makeStack`, `makeCurrent`, `suggest`, `opts`, `put`, and `armViaTab` (the
only production arming path). Fixture words per the item contract:

```ts
// seed: recordBigramRuns([["alphaone","betaword"]]) and
//       recordBigramRuns([["alphaone","deltaword"]]); put() alphaone,
//       betaword, deltaword. Arm on "alphaone" via armViaTab.

1. it("armed chain resets on the trigger char: '#b' answers in trigger
   mode at prefix '#b' and leaves the chain idle", ...)
   - armViaTab(inner, chain, store, "alphaone", "al", seedAlphaoneSuccessors)
   - const r = await suggest(inner, ["x alphaone #b"], 0, 14);
   - expect(r?.prefix).toBe("#b");
   - expect(chain.state()).toBeNull();
   - items are normal hapax trigger-mode items (description ≠ "chain");
     with the seeded store, "betaword" is menu-eligible at fragment "b"
     (verify which words match; assert at minimum prefix + idle + no
     "chain"-described items).

2. it("armed chain still filters successors at a word start ('x alphaone
   be')", ...)
   - arm, then suggest(inner, ["x alphaone be"], 0, 14)
   - expect(r?.prefix).toBe("be"); expect(chain.state()).toEqual({word:"alphaone"});
   - expect(r?.items.map(i => i.value)).toEqual(["betaword"]); // deltaword filtered

3. it("zero-typed-char offer unchanged after the guard (regression)", ...)
   - arm, then suggest(inner, ["x alphaone "], 0, 12)
   - expect(r?.prefix).toBe(""); items = unfiltered successors (betaword
     and deltaword, count order); chain stays armed.

4. it("punctuation glued before a fragment also resets (state machine
   consistency)", ...)  // bonus, cheap
   - arm, then suggest(inner, ["x alphaone!be"], 0, 13)
   - expect(chain.state()).toBeNull(); result comes from the normal path.
```

### Success Criteria

- [ ] Case 1 passes: prefix `'#b'`, chain idle, no chain-provenance items
- [ ] Case 2 passes: prefix `'be'`, chain armed, filtered successor set
- [ ] Case 3 passes: zero-char offer identical to pre-fix behavior
- [ ] `npm test` + `npm run check` green (no other behavior regressions)
- [ ] Diff confined to `src/pi/provider.ts` armed branch (+comment) and
      `test/chain.test.ts`

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed?" — Yes: the exact current armed-branch code, the insertion point and
guard expression, the control-flow contract (reset + fall-through, mirroring
the existing disqualify path), pi-tui's blind-deletion mechanics, the test
file's helper inventory, and the parallel sibling's contract are all
reproduced below.

### Documentation & References

```yaml
- docfile: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/provider-tui-integration.md
  why: THE recon doc — armed-branch line map, pi-tui applyCompletion
        blind-deletion semantics (autocomplete.js:265+), the recommended
        guard expression verbatim, and the test-angle list.
  critical: the guard expression from the doc:
        before.length - frag.length === 0 ||
        /[ \t]/.test(before[before.length - frag.length - 1])

- file: src/pi/provider.ts (armed branch ~L282-410)
  why: the fix site. Path (a) zero-char offer at ~L368-385; path (b)
        fragment filter at ~L390-410; disqualify (c) does chain.reset()
        WITHOUT return — the fall-through precedent to mirror.
  pattern: comment block at (b) bullet L295-297 must gain the word-start
        rule; branch order (abort → stock gate → armed → extractMatchState)
        is the contract.

- file: test/chain.test.ts
  why: helper conventions — makeCurrent (Mock wrapped provider),
        makeStack({chain, inner, provider}), suggest(), opts(), put(),
        armViaTab(inner, chain, store, word, fragment, seed) which asserts
        chain.state()==={word} as precondition. Follow the existing
        describe block ("chain machine — armed successor chaining...").

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M1T1S2/PRP.md
  why: CONTRACT (parallel): classifyStockContext delegation gate wired
        AFTER the aborted check and BEFORE the armed branch. Consequence:
        by the time the armed branch runs, stock contexts are already
        excluded — our fall-through goes straight to extractMatchState and
        never needs to re-check the stock gate. No overlap: T1.S2's case 7
        (armed + '/re') tests the gate; our case 1 (armed + '#b') tests
        trigger-mode fall-through. Do NOT touch the stock gate.

- PRD §07 (h2.43 M2 state machine): "Any non-Tab key that disqualifies
  (space, escape, punctuation) → idle"; trigger-char match wins.
```

### Current Codebase tree (relevant)

```bash
src/pi/provider.ts        # armed branch ~L282-410 ← fix site
test/chain.test.ts         # TDD cases land here
test/provider-match.test.ts # classifier tests (T1.S1) — do not touch
```

### Desired Codebase tree

```bash
src/pi/provider.ts        # +word-start guard in armed fragment path
test/chain.test.ts         # +4 cases (trigger reset, word-start filter,
                           #  zero-char regression, punctuation reset)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: do NOT return an empty/null result from the armed branch after
// reset — the existing disqualify path falls through (no return) so the
// normal path answers on the SAME keystroke (PRD §01 invariant 3). Mirror it.

// GOTCHA: the stock-context gate (P1.M1.T1.S2) runs BEFORE the armed branch,
// so a '/' fragment in an armed chain already delegates and never reaches
// the guard — the guard's live cases are trigger char and other punctuation
// (!"')( etc.).

// GOTCHA: frag is the RAW typed fragment (may be capitalized); successor
// filtering lowercases it — keep that. The word-start check is on `before`
// positions, case-free.

// GOTCHA: `before[fragAt - 1] ?? ""` — when fragAt === 0 the first operand
// short-circuits, but keep the ?? guard for type safety under noUncheckedIndexedAccess.

// GOTCHA: armViaTab seeds successors AFTER the menu snapshot (determinism
// convention) — pass your seeding function as its `seed` argument.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: ADD the 4 TDD cases to test/chain.test.ts (red)
  - Follow existing describe block + helpers; fixture words alphaone/
    betaword/deltaword per the item contract; arm ONLY via armViaTab.

Task 2: EDIT src/pi/provider.ts armed branch
  - Insert word-start guard per the What section; extend the disqualify
    condition; update the (b) bullet comment with the BUG-005 rationale.
  - Zero-char offer (a), force mitigation, publishChain, enableChaining
    gate untouched.

Task 3: VALIDATE
  - npm test -- test/chain.test.ts   (new cases green)
  - npm test && npm run check        (no regressions)
```

### Implementation Patterns & Key Details

```ts
// Guard (final form) — placed immediately after the frag match:
const fragAt = before.length - frag.length;   // frag defined here
const atWordStart = fragAt === 0 || /[ \t]/.test(before[fragAt - 1] ?? "");
// disqualify when: frag undefined  OR  !atWordStart  OR  zero matching
// successors — all three take the SAME reset-and-fall-through path.
```

### Integration Points

```yaml
CODE:
  - src/pi/provider.ts: armed-branch fragment path only (~L390-410 + comment)

TESTS:
  - test/chain.test.ts: +4 cases

DOWNSTREAM:
  - P1.M1.T2.S2 editor-sim integration test verifies trigger consumption
    and the one-word invariant during chains against this corrected branch

FROZEN:
  - stock-context gate (T1.S2), extractMatchState, chain machine itself,
    store, config
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check
```

### Level 2: Unit Tests

```bash
npm test -- test/chain.test.ts -t "armed"
npm test                      # full suite — watch provider/provider-live too
```

### Level 3: Behavior spot-check (the BUG-005 repro)

```bash
# Via the case-1 test (or a scratch vitest): successors alphaone→
# betaword/deltaword; arm on alphaone; suggest('x alphaone #b') must yield
# prefix '#b' (trigger mode consumes '#') and chain.state() === null.
# Pre-fix it returned {items:['betaword'], prefix:'b'} with chain armed.
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green
- [ ] `'#b'` case: trigger-mode items, prefix `'#b'`, chain idle
- [ ] `'be'` case: successor filtering unchanged, chain armed
- [ ] Zero-char offer regression case passes
- [ ] Diff confined to provider.ts armed branch + chain.test.ts
- [ ] No empty/null returns from the armed branch

## Anti-Patterns to Avoid

- ❌ Returning an empty suggestion set on trigger-char detection instead of
  falling through to the normal path
- ❌ Re-checking or duplicating the stock-context gate inside the armed
  branch (it already ran)
- ❌ Special-casing the trigger char only — the guard is a general
  word-start requirement (punctuation bonus case)
- ❌ Touching extractMatchState, the chain machine, or the display provider
- ❌ Lowercasing/normalizing the returned prefix (prefix is the raw typed
  text, `#`-prefixed for trigger mode)

---

**Confidence Score: 9/10** — the fix site, guard expression, control-flow
precedent, pi-tui deletion mechanics, test conventions, and the parallel
sibling's precedence contract are all pinned; scope is deliberately tiny.
