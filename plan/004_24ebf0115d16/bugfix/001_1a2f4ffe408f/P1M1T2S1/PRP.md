# PRP — P1.M1.T2.S1 (bugfix 001_1a2f4ffe408f): Add the chain consult branch to the widget visibility machine

---

## Goal

**Feature Goal**: Complete the second half of the BUG-001 fix — after
P1.M1.T1.S2 armed the chain on widget Tab acceptance, the visibility
machine (`createVisibilityMachine` in `src/pi/widget.ts`) must CONSULT the
armed chain: at an empty word start it offers the armed word's top
successors with ZERO typed chars; a typed word-start fragment filters them;
disqualification resets and falls through to the normal path. Ordering,
guards, and semantics mirror the provider's armed branch (provider.ts
~379–530) — the reference implementation.

**Deliverable**:
- `VisibilityMachineDeps.chain?: ChainMachine` (new optional dep, wired from
  `WidgetLayerOptions.chain` in `createWidgetEditorFactory`).
- The chain consult branch inside `evaluate`, placed after the R1
  stock-context check and before the R3 no-fragment close, with:
  restore-gate parity, empty-set reset+fall-through, word-start guard,
  `matchFragment` membership filter at threshold 0, intent-bypass of the R5
  hesitation gate.
- Chain-offer `RankedMatch` shims painting through the existing
  `paint(items, sig, now)` so `VisibilityState.currentSet` carries them and
  `decideWidgetKey`'s tab-insert completes them at zero typed chars.
- JSDoc updates (Mode A) on the new `chain` dep and the now-consumed
  `isIntentBypass` seam.
- TDD suite in `test/widget-visibility.test.ts` (+ `test/widget.test.ts`
  composition cases).

**Success Definition**: With a seeded store (`zorpwibble → quuxblat ×2`) and
an armed chain, an input tick at `'zorpwibble '` (empty word start) paints
`['quuxblat' display]` visible on the widget line IMMEDIATELY (no hesitation
delay); typing `'qu'` filters to `quuxblat`; `'#q'` resets the chain and
answers trigger mode; empty successor set resets + falls through (never an
empty paint); `enableChaining: false` / no chain dep → branch fully inert;
all existing suites green (`test/chain.test.ts`, `test/chaining-gating.test.ts`,
`test/provider*.test.ts`, widget R1–R7 cases unchanged when chain idle).

## Why

BUG-001 (Major): M2 chained completion is dead on the widget PRIMARY path.
T1.S2 added arming (`insertHighlighted` → `chain.arm`); without this consult
branch the chain arms but nothing renders — spec/07:472 ("Chain offers
render on the widget line (or fallback menu) like any result set") and
spec/01 goal 7 remain unmet on the path used whenever any editor extension
is installed. P1.M1.T2.S2 (one-shot grant tracker) and P1.M2.T2.S1
(suppression release) build directly on this evaluate block — sequencing is
deliberate.

## What

### 1. Deps + wiring

```ts
// VisibilityMachineDeps (widget.ts:334-360):
/** Tab-chain machine (BUG-001 fix, P1.M1.T2.S1): when armed (and
 *  config.enableChaining), evaluate consults store.topSuccessors at
 *  empty word starts / word-start fragments BEFORE the normal query —
 *  mirroring the provider armed branch (provider.ts ~379). Optional so
 *  idle-chain builds and tests without a machine change behavior. */
chain?: ChainMachine;
```

Wire in `createWidgetEditorFactory` (~995–1011): pass `chain: opts.chain`
into `createVisibilityMachine` deps.

### 2. The consult branch (inside `evaluate`, after R1, before `extractMatchState`)

```ts
// R1 already ran (stock contexts hide + return — armed chains NEVER
// override stock contexts, provider.ts:308 parity).
const armed = deps.chain?.state();
if (armed && deps.config.enableChaining) {
  const before = (lines[line] ?? "").slice(0, col);

  // Restore-gate parity with R2: chain offers never fire during history
  // replay; hold exactly like a normal query would.
  if (!settled && (gateDeadline === null || now < gateDeadline)) {
    armGate(now);
    return state();
  }

  // (a) Zero-typed-char offer: cursor at an EMPTY word start.
  if (before === "" || /[ \t]$/.test(before)) {
    const succ = deps.store
      .topSuccessors(armed.word)
      .slice(0, deps.config.maxSuggestions);
    if (succ.length > 0) {
      const items = succ.map(chainShim);          // see §3
      chainIntent = true;
      paint(items, chainSig(items), now);         // intent paint: immediate
      return state();
    }
    chainResetAndFallThrough();                    // empty → reset + normal
  } else {
    // (b) Typed fragment at a word start (BUG-005 guard), membership
    // filter at threshold 0 — NEVER resolveFuzzThreshold here.
    const frag = before.match(/[A-Za-z][A-Za-z0-9_]*$/)?.[0];
    const fragAt = frag === undefined ? -1 : before.length - frag.length;
    const atStart = frag !== undefined &&
      (fragAt === 0 || /[ \t]/.test(before[fragAt - 1] ?? ""));
    if (frag !== undefined && atStart) {
      const succ = deps.store
        .topSuccessors(armed.word)
        .filter((s) => matchFragment(frag, s.next) !== null)
        .slice(0, deps.config.maxSuggestions);
      if (succ.length > 0) {
        const items = succ.map(chainShim);
        chainIntent = true;
        paint(items, chainSig(items), now);
        return state();
      }
    }
    // (c) Disqualification: glued fragment ('#q' — trigger mode wins),
    // non-start, punctuation, or zero matching successors.
    chainResetAndFallThrough();
  }
}
```

`chainResetAndFallThrough()` = `deps.chain?.reset(); chainIntent = false;`
then execution continues into the existing code (extractMatchState → R3
close or normal query) — exactly the provider's reset-without-return
precedent. NEVER paint an empty set and NEVER return one from this branch.

### 3. Chain-offer shims (RankedMatch, painted through `paint()`)

```ts
const chainShim = (s: Successor): RankedMatch => ({
  key: s.next,                                   // PLAIN store key — a
  display: deps.store.get(s.next)?.display ?? s.next,  // successor Tab-accept
  salience: -s.count,                            // re-arms at s.next via
  sessionCount: s.count,                         // insertHighlighted's
});                                              // painted()-record read
```

- `key: s.next` (NO CHAIN_KEY_PREFIX — the widget has no `liveKeyByValue`;
  the plain key IS the store key T1.S2's arming needs, so accepting a
  successor re-arms at `s.next` automatically).
- Do NOT set `tier` (leave undefined): the arming check is
  `rec?.tier === 0`, so undefined arms — correct, chain members passed an
  anchored membership gate.
- Count order preserved (topSuccessors is count-desc); no re-sort.
- `paint()` is the single write site, so `currentSet` (display-only) and
  `painted()` (records) populate together; `decideWidgetKey`'s tab-insert
  then completes the highlighted successor at zero typed chars —
  **the decision table needs NO change** (`visible && count > 0`).

### 4. Intent bypass (R5)

Add machine-local `let chainIntent = false;` (reset at the top of every
`onInput`/`evaluate` tick, set only on a chain paint this tick). R5's intent
computation (widget.ts ~669–670) becomes:

```ts
const intent =
  match.mode === "trigger" || chainIntent || (deps.isIntentBypass?.() ?? false);
```

Chain-offer paints bypass the R5 hesitation gate; once visible, subsequent
swaps still compose with R6 swap-debounce (`parkSwap`) and R7 hysteresis —
fallback parity (first paint immediate, swaps debounced). Update the
`isIntentBypass` JSDoc: the machine now accounts for chain paints itself;
the dep remains the seam for external intent sources.

### 5. Suppression note (deliberate scope line)

Chain offers are INTENT: this branch paints even under explicit-dismissal
suppression (mirroring trigger mode's R4 bypass). Add a pointer comment:
"suppression-release refinement lands in P1.M2.T2.S1 on this same block."

### 6. TDD cases (write first, red)

Using the existing conventions — real `createVisibilityMachine`, real seeded
`CandidateStore`, fake editor via `getEditorState`, spied `ChainMachine`
where arming is not under test (`{state, arm, reset}` vi.fn spy):

1. Zero-char offer: seed `recordBigramRuns([['zorpwibble','quuxblat']])`
   ×2 + `put(zorpwibble)`; spy machine `state: () => ({word:'zorpwibble'})`;
   tick with editor `'zorpwibble '` col 12 → `state().visible === true`,
   `currentSet` displays `['quuxblat' with store display casing]` in count
   order; `chain.reset` NOT called.
2. Typed fragment filter: `'zorpwibble qu'` → filters via matchFragment
   membership (multi-successor store: `quuxblat` matches `qu`, `deltaword`
   does not); count order kept; no re-sort.
3. Glued trigger fragment: `'zorpwibble #q'` → `chain.reset` called once,
   fall-through answers trigger mode (fragment `q`, prefix `#q`), no chain
   shim in `painted()`.
4. Word-start guard: punctuation-glued fragment
   (`'zorpwibble!"qu"'`-style) → reset + fall-through.
5. Empty successor set: armed word with no successors → reset + fall-
   through; NEVER a visible line with zero candidates.
6. Stock context wins: armed + editor `'/cmd arg'` → R1 hides before the
   branch runs; no chain paint, no reset (R1 returns early).
7. `enableChaining: false`: armed state present → branch inert, normal
   behavior byte-identical.
8. Hesitation bypass: `menuDelayMs: 2000` in config, chain paint at empty
   word start → visible IMMEDIATELY on this tick (contrast: a normal
   word-mode paint would be gated).
9. Restore-gate parity: unsettled `restoreReady` + armed chain → held
   (armGate), no paint; after settle, tick paints.
10. Re-arm seam: paint shims via the branch, then `decideWidgetKey` →
    tab-insert path → assert spied `chain.arm` called with the successor's
    key (composes with T1.S2's insertHighlighted arming; drive through the
    composed factory like widget.test.ts's insert harness).

### Success Criteria

- [ ] All 10 cases pass; existing widget/visibility/chain/gating/provider
      suites green unchanged (chain idle ⇒ byte-identical behavior)
- [ ] `npm run check` + `npm test` green
- [ ] Diff confined to `src/pi/widget.ts` (deps + evaluate branch + intent +
      JSDoc) and the two test files

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed?" — Yes: the provider reference implementation's exact semantics,
the current widget machine structure (deps, evaluate order, paint/parkSwap/
hide internals, currentSet/painted duality), the shim shape rationale
(plain key, tier undefined), insertion point with restore-gate resolution,
and the test conventions are all reproduced.

### Documentation & References

```yaml
- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/r1-chain-widget.md
  why: THE fix design — §Exact contracts (provider reference: arm/consult/
        publishChain/one-shot/tier-0 rules; widget seams with line anchors;
        ChainMachine API), §Recommended fix design steps 2-3, §Risks
        (zero-candidate invariant, stock-context precedence, intent/swap
        composition, enableChaining inertness).
  critical: "R1 must stay AHEAD of the new chain branch, exactly like
        provider.ts:308"; "never publish an empty set".

- file: src/pi/widget.ts
  pattern: VisibilityMachineDeps (:334-360, isIntentBypass at :364-367);
        evaluate R1 (:621-626) → extractMatchState (:628) → R3 close
        (:630-634) ← insertion point; R2 settled/armGate (:636-640);
        R4 zero/suppression (:642-665); R5 intent (:669-670); paint (:
        553-570 single write site for currentSet+paintedSet); parkSwap;
        createWidgetEditorFactory wiring (~995-1011).
  gotcha: paint() on a closed line is the immediate-first-paint path; a
        visible line with a DIFFERENT set parks through parkSwap (R6) —
        chain swaps must inherit that, not bypass it.

- file: src/pi/provider.ts (armed branch ~379-530, publishChain ~455-485,
        ChainMachine :765-790)
  why: the reference semantics being mirrored — zero-char offer, word-start
        guard, membership filter at threshold 0, reset+fall-through.
  gotcha: do NOT copy resolveFuzzThreshold into the chain filter — the
        provider's chain gate is threshold-0 membership, full stop.

- file: src/core/query.ts (matchFragment :244)
  why: the membership filter import.

- file: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/P1M1T1S3/PRP.md
  why: CONTRACT (parallel): the inverted arming pin in test/widget.test.ts —
        its makeInsertHarness extension (real store, paint through the
        machine) is the harness pattern to reuse for case 10; its matrix
        (tier-0/spans/gating) already covers arming — do not duplicate.

- spec/07-completion-ui.md:437-476 (M2 section; :472 mandates widget-line
  chain offers), :215-216 cross-ref (tier-0 never arms), h3.10 R5
  isIntentBypass seam.
```

### Current Codebase tree (relevant)

```bash
src/pi/widget.ts          # visibility machine ← fix site (post T1.S1/S2)
src/pi/provider.ts        # reference implementation (armed branch, ChainMachine)
test/widget-visibility.test.ts, test/widget.test.ts   # TDD targets
test/chain.test.ts, test/chaining-gating.test.ts      # must stay green
```

### Desired Codebase tree

```bash
src/pi/widget.ts          # +chain dep, +consult branch, +chainIntent, JSDoc
test/widget-visibility.test.ts  # +machine-level cases 1-9
test/widget.test.ts              # +composed re-arm case 10
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: NEVER paint an empty successor set — chain.reset() + fall
// through (spec invariant 3; renderWidgetLine would null it but the
// machine state must stay honest).

// CRITICAL: shim tier must stay UNDEFINED, not 0 — the T1.S2 arming check
// is `rec?.tier === 0`; undefined arms (chain members passed an anchored
// gate). Setting tier: 0 would silently break successor re-arm.

// CRITICAL: shim key = s.next PLAIN (no prefix) — insertHighlighted arms at
// the accepted record's key read from painted(); the plain key IS the store
// key, giving successor re-arm for free.

// GOTCHA: reset chainIntent at the TOP of every tick — a stale intent flag
// would bypass hesitation for a subsequent normal word-mode paint.

// GOTCHA: keep R2-style restore gating on the branch — firing chain offers
// during history replay would race the replaying store.

// GOTCHA: evaluate is synchronous; store.topSuccessors is O(1) and
// matchFragment O(len) — no perf risk, but do NOT call deps.query() inside
// the chain branch.

// GOTCHA: suppression bypass here is DELIBERATE and temporary-shaped —
// P1.M2.T2.S1 refines release semantics on this same block; leave the
// pointer comment so the later task finds it.
```

## Implementation Blueprint

### Implementation Tasks (ordered, TDD)

```yaml
Task 1: ADD the 10 TDD cases (red) — widget-visibility machine cases 1-9
        (real machine + seeded store + spied ChainMachine), widget.test.ts
        case 10 reusing T1.S3's harness pattern.
Task 2: EDIT src/pi/widget.ts — VisibilityMachineDeps.chain? + factory
        wiring; chainIntent flag + R5 intent extension; the consult branch
        per the What section (with chainShim/chainSig helpers + JSDoc);
        isIntentBypass JSDoc update; suppression pointer comment.
Task 3: VALIDATE — npm test (widget*, chain, chaining-gating, provider*),
        npm run check.
```

### Implementation Patterns & Key Details

```ts
// Fall-through mechanics: the branch never RETURNS on disqualification —
// deps.chain?.reset(); chainIntent = false;  // then simply do not return;
// execution reaches extractMatchState → R3 close or the normal query,
// exactly like the provider's disqualify path (reset WITHOUT return).

// Signature for paint: reuse a join signature like the normal path's
// (items.map(m => m.key + "\u0000" + m.display).join()) so successive
// narrowing ticks of the SAME successor set don't churn swaps.
```

### Integration Points

```yaml
CODE: src/pi/widget.ts only
TESTS: test/widget-visibility.test.ts, test/widget.test.ts
DOWNSTREAM (do not implement here):
  - P1.M1.T2.S2: one-shot grant tracker as a shared helper (both paths)
  - P1.M2.T2.S1: suppression-release refinement on this same block
  - P1.M1.T2.S3: e2e widget chain tests + live TTY + spec/07 clause
FROZEN: provider.ts, decideWidgetKey decision table, query.ts, store.ts,
  chain machine itself
```

## Validation Loop

### Level 1: Syntax

```bash
npm run check
```

### Level 2: Unit tests

```bash
npm test -- test/widget-visibility.test.ts test/widget.test.ts
npm test -- test/chain.test.ts test/chaining-gating.test.ts   # canaries
npm test        # full suite
```

### Level 3: Behavior spot-check (BUG-001 repro inverted)

```bash
# Composed factory, seeded store, armed chain: type 'zorpwibble' → Tab
# (arms, T1.S2) → space → widget line shows the successor offer
# IMMEDIATELY; Tab again inserts it with zero typed chars.
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green; existing suites byte-stable when chain idle
- [ ] Zero-char offer paints successors (count order, store casing) immediately
- [ ] Fragment filter via matchFragment at threshold 0; '#q' resets → trigger mode wins
- [ ] Empty set → reset + fall-through; never an empty visible line
- [ ] Stock contexts outrank the armed chain; enableChaining:false inert
- [ ] Hesitation bypassed; swap-debounce/hysteresis compose after first paint
- [ ] Restore gate holds chain offers until replay settles
- [ ] Successor Tab-accept re-arms at s.next through the painted()-record seam

## Anti-Patterns to Avoid

- ❌ Copying `resolveFuzzThreshold` into the chain membership filter
  (threshold 0 only — the provider's chain gate)
- ❌ Setting shim `tier: 0` (breaks re-arm) or prefixing shim keys
  (no liveKeyByValue on this path)
- ❌ Returning an empty/hidden state from the branch instead of falling
  through on disqualification
- ❌ Letting the chain branch run before R1 or during restore replay
- ❌ Resetting the shared ChainMachine semantics or touching decideWidgetKey
- ❌ Porting the one-shot grant tracker here (T2.S2 owns it)

---

**Confidence Score: 9/10** — the provider reference semantics, exact widget
seams and internals, shim-shape rationale (plain key, undefined tier), the
restore-gate placement resolution, and harness conventions are all pinned
from the verified recon doc plus live source; downstream sequencing
(T2.S2 tracker, M2.T2.S1 suppression) is explicitly fenced.
