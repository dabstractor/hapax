# PRP — P1.M1.T2.S2 (bugfix 001_1a2f4ffe408f): Port the one-shot grant tracker as a shared helper for both paths

---

## Goal

**Feature Goal**: Extract provider.ts's one-shot grant tracker
(`chainWordsSeen` / `chainLastArmedPrefix`, :279–280 + the word-boundary
block :400–435) into ONE exported helper consumed by BOTH display paths,
so the widget's new chain consult branch (P1.M1.T2.S1) obeys the spec/07
one-shot grant: exactly ONE word per acceptance; typing through the offer
without accepting disarms at the next word boundary (normal path answers
the SAME keystroke); acceptance re-arms with a fresh grant.

**Deliverable**:
- New `src/pi/chain-grant.ts` (recommended) exporting
  `createChainGrantTracker()` — or an equivalent export from
  `src/pi/provider.ts` if preferred; pure, no pi imports beyond none.
- provider.ts refactored to consume it with **byte-identical observable
  behavior**; widget machine + insertHighlighted consume it for the widget
  path.
- TDD: helper unit suite + widget one-shot cases; canary suites
  (`test/chain.test.ts` :291/:324/:454, `chaining-gating.test.ts`,
  `provider*.test.ts`) green **unchanged**.

**Success Definition**: `npm run check` + `npm test` green with canary
suites untouched; widget chain offers disarm exactly like the fallback
path's (typed-through offer → reset at next word start → hesitation-gated
normal path answers); acceptance re-arms with a fresh grant on both paths.

## Why

- Spec/07:450–457 defines the one-shot grant path-independently, but only
  the fallback provider implements it. S1 added the widget consult branch
  WITHOUT the tracker (deliberately fenced: "Porting the one-shot grant
  tracker here (T2.S2 owns it)") — without this port, a widget chain stays
  armed forever, popping successor offers at EVERY word start for the rest
  of the message (the exact 2026-09 live-reproduced popping the grant was
  built to stop).
- Extraction (not duplication) guarantees the two paths can't drift.

## What

### Helper (src/pi/chain-grant.ts)

```ts
export interface ChainGrantTracker {
  /** Feed the armed branch's current prefix read each tick:
   *  "" at an empty word start, the trailing word-regex fragment, or
   *  omit the call when no fragment is live. Returns true when the grant
   *  is spent (second word reached) — the caller MUST chain.reset() and
   *  fall through; the tracker has already zeroed itself. */
  tick(curArmedPrefix: string): boolean;
  /** Fresh grant — call at every arm site. */
  reset(): void;
}

export function createChainGrantTracker(): ChainGrantTracker {
  let seen = 0;
  let lastPrefix: string | null = null;
  return {
    tick(cur) {
      // PORT VERBATIM the provider's isNewWord asymmetry table + comment:
      //  - lastPrefix === null → first armed answer = the GRANTED word (seen=1)
      //  - "" → non-empty  = typing INTO the granted offer (same word)
      //  - non-empty → ""  = moved past a typed-through word (new word)
      //  - two non-empties, no mutual prefix relation = different words
      //    (mutual relation incl. backspace = same word)
      // seen >= 2 → zero state, return true.
    },
    reset() { seen = 0; lastPrefix = null; },
  };
}
```

JSDoc on the module: cite spec/07 one-shot grant, the live-reproduced
popping rationale, and the arm-resets-tracker contract.

### Provider refactor (byte-identical)

- Delete fields :279–280; create `const grant = createChainGrantTracker()`
  in the same closure scope.
- Armed branch :400–435: keep the `curArmedPrefix` computation and the
  `if (curArmedPrefix !== null)` guard; replace the body with
  `if (grant.tick(curArmedPrefix)) { chain.reset(); }` — then the existing
  `if (chain.state() !== null)` flow continues (fall-through preserved).
- applyCompletion arm sites :670–671 and :696–697: replace the two manual
  zeroings with `grant.reset()` next to each `chain.arm(...)`.

### Widget consumption

- `VisibilityMachineDeps` gains `grant?: ChainGrantTracker` (or the machine
  creates one internally when `chain` is present — pick one, document).
  Factory (`createWidgetEditorFactory`) owns the instance next to the chain
  machine and passes it to both the machine and `insertHighlighted`'s scope.
- In S1's consult branch, before painting: compute `curArmedPrefix` from
  `before` exactly as the provider does; on `grant.tick(...)` returning
  true → `deps.chain?.reset(); chainIntent = false;` and fall through
  (identical to the existing disqualification path). Zero-char/typed
  paints tick BEFORE painting (the granted offer's word is word 1).
- `insertHighlighted` (P1.M1.T1.S2's `chain.arm` site): call
  `grant.reset()` beside `chain.arm(key)`.

### Success Criteria

- [ ] Canary suites green unchanged: chain.test.ts (:291 every-word-start, :324 one-shot disarm, :454 successor re-arm), chaining-gating, provider*
- [ ] Widget: typed-through offer disarms at the next word start (hesitation-gated normal path answers that keystroke); narrowing/backspace keeps the chain; acceptance re-arms fresh
- [ ] `npm run check` + `npm test` green; no provider behavior change (diff is structural only)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they implement this
successfully?" — Yes: the tracker's exact current logic (fields, block,
resets — line-anchored with the asymmetry table spelled out), the helper
API, both consumption sites, the S1 branch contract, and the canary tests
are all specified.

### Documentation & References

```yaml
- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/r1-chain-widget.md
  section: §Exact contracts — provider one-shot tracker (~380–420)
  why: the semantics being extracted: word-boundary detection (prefix
        neither extends nor is-extended-by the previous) → reset + fall
        through SAME keystroke; arm sites reset (seen=0, lastPrefix=null).

- file: src/pi/provider.ts
  why: VERIFIED live source: fields :279–280; tracker block :400–435
        (curArmedPrefix = "" | trailing /[A-Za-z][A-Za-z0-9_]*$/ fragment
        | null; guard `if (curArmedPrefix !== null)`; isNewWord asymmetry;
        seen>=2 → chain.reset() + zero + fall-through; else record prefix);
        reset sites :670–671 and :696–697 beside chain.arm.
  gotcha: the null-prefix case SKIPS the tick entirely (disqualification is
        handled by the branch's other guards) — preserve: tick is only
        called with a live prefix string.

- file: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/P1M1T2S1/PRP.md
  why: CONTRACT (parallel): the widget consult branch exists with
        zero-char offer, fragment filter, reset+fall-through, chainIntent —
        and explicitly fences this port ("T2.S2 owns it"). Its
        chainResetAndFallThrough is the exact fall-through mechanism to
        reuse when the grant is spent. Its shim/paint seams are NOT touched
        here.
  critical: S1's branch paints WITHOUT ticking today — your insertion
        point is immediately before each paint (zero-char and filtered).

- files: test/chain.test.ts (armViaTab helper :202; canary cases :291,
        :324, :454), test/chaining-gating.test.ts, test/widget-visibility.test.ts
        (S1's machine-level harness: real machine + seeded store + spied
        ChainMachine — extend for widget one-shot cases)
  why: the canaries proving byte-identity + the harness for the widget
        cases.

- spec/07-completion-ui.md:450–457 (one-shot grant) — normative.
```

### Current Codebase tree (relevant)

```bash
src/pi/provider.ts        # tracker extraction source (:279–280, :400–435, :670, :696)
src/pi/widget.ts          # consult branch (S1) + insertHighlighted arm site (T1.S2)
test/{chain,chaining-gating,widget-visibility,widget}.test.ts
```

### Desired Codebase tree

```bash
src/pi/chain-grant.ts            # NEW — createChainGrantTracker + unit tests target
src/pi/provider.ts               # consumes helper (byte-identical)
src/pi/widget.ts                 # machine + insertHighlighted consume helper
test/chain-grant.test.ts         # NEW — helper unit suite (asymmetry table)
test/widget-visibility.test.ts   # +widget one-shot cases
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: provider byte-identity is the bar — port the isNewWord logic
// AND its explanatory comment verbatim; the asymmetry (""→non-empty same
// word, non-empty→"" new word, mutual-prefix = same word incl. backspace)
// is subtle and pinned only by the canary tests.

// CRITICAL: tick BEFORE paint on the widget (the granted offer's word is
// word 1 — first tick with lastPrefix===null sets seen=1, never disarms).
// A tick placed after paint would disarm one word late.

// GOTCHA: the tracker is per-instance state (closure) — never module-level;
// the fallback provider creates its own inside createHapaxProvider, the
// widget factory its own beside the chain machine. index.ts wiring unchanged.

// GOTCHA: when tick returns true the tracker has ALREADY zeroed itself —
// do not double-reset; just chain.reset() + fall through.

// NodeNext .js imports; src/pi module importing nothing from pi-tui.
```

## Implementation Blueprint

### Implementation Tasks (ordered, TDD)

```yaml
Task 1: CREATE test/chain-grant.test.ts (red)
  - Unit cases over the asymmetry table: first tick (null history) → seen=1,
    no disarm; "" then non-empty → same word, no disarm; non-empty then ""
    → disarm; two unrelated non-empties → disarm; narrowing + backspace
    (mutual prefix) → no disarm; reset() then tick → fresh grant.
Task 2: CREATE src/pi/chain-grant.ts (port the block + comment verbatim).
Task 3: EDIT src/pi/provider.ts — fields → helper; armed branch body →
  grant.tick; :670/:696 resets → grant.reset(). Run canaries FIRST
  (chain/chaining-gating/provider*) to prove byte-identity before touching
  the widget.
Task 4: EDIT src/pi/widget.ts — deps.grant (or internal creation), tick
  before both paint sites in S1's consult branch, grant.reset() beside
  chain.arm in insertHighlighted; factory owns the instance.
Task 5: ADD widget one-shot cases to test/widget-visibility.test.ts
  (typed-through offer disarms at next word start; narrowing keeps;
  accept re-arms fresh) using S1's harness conventions.
Task 6: VALIDATE — full npm test + npm run check.
```

### Implementation Patterns & Key Details

```ts
// Provider armed branch after refactor (shape only — semantics identical):
const curArmedPrefix = before === "" || /[ \t]$/.test(before)
  ? "" : (before.match(/[A-Za-z][A-Za-z0-9_]*$/)?.[0] ?? null);
if (curArmedPrefix !== null && grant.tick(curArmedPrefix)) {
  chain.reset(); // tracker already zeroed; fall through (no return)
}
// Widget mirror, inside S1's branch before paint:
if (grant.tick(curArmedPrefix)) { chainResetAndFallThrough(); return state(); }
```

### Integration Points

```yaml
CODE: src/pi/chain-grant.ts (new), provider.ts (refactor), widget.ts (wire)
TESTS: test/chain-grant.test.ts (new), widget-visibility.test.ts (+cases)
CANARIES (must pass byte-unchanged): test/chain.test.ts, chaining-gating,
  provider*.test.ts, widget.test.ts (T1.S3's inverted arming pin)
DOWNSTREAM: P1.M1.T2.S3 e2e widget chain tests + live TTY validation
FROZEN: chain machine, S1's shims/paint seams, query.ts, store.ts
```

## Validation Loop

### Level 1–2

```bash
npm run check
npx vitest --run test/chain-grant.test.ts test/chain.test.ts test/chaining-gating.test.ts
npm test
```

### Level 3: Behavior spot-check

```bash
# Widget composed factory, armed chain: space→offer; type through the
# offered word; at the NEXT word start the chain is idle and the normal
# (hesitation-gated) path answers. Tab-accept instead → fresh offer next
# word start. Fallback provider: identical (canaries).
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green; canary suites unchanged (diff shows test edits only in the two intended files)
- [ ] Helper exported once; provider and widget both consume it; no duplicated grant logic anywhere
- [ ] Widget: typed-through disarms at next word start (same-keystroke normal answer); narrowing/backspace keeps; accept re-arms fresh
- [ ] isNewWord asymmetry table preserved verbatim (comment + logic)
- [ ] Tick-before-paint ordering; no double-reset; per-instance state
- [ ] JSDoc on the helper (Mode A); no config/user-facing surface

## Anti-Patterns to Avoid

- ❌ Rewriting the asymmetry logic "more cleanly" — byte-identity is the
  contract; port verbatim
- ❌ Ticking after paint (disarms one word late) or ticking on null prefixes
- ❌ Module-level tracker state shared across provider instances
- ❌ Resetting the tracker anywhere except arm sites and spent-grant
- ❌ Touching S1's shims/paint seams or the chain machine
- ❌ Leaving the widget arm site without grant.reset() (stale grant after
  widget acceptance)

---

**Confidence Score: 9/10** — the extracted logic is fully quoted/anchored,
byte-identity is enforced by named canary tests, both consumption sites and
the S1 contract are pinned, and the only judgment call (new module vs
provider export) is resolved with a recommendation.
