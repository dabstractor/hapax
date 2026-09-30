# PRP — P1.M1.T1.S3 (bugfix 001_1a2f4ffe408f): Invert the plan-004 no-arm pin; pin the new arming contract

---

## Goal

**Feature Goal**: Replace the "widget Tab acceptance NEVER arms a chain
(plan 004 pin)" describe block in `test/widget.test.ts` (L1053-1075) —
which pins BUG-001's dead chaining as "BY DESIGN" — with a full
classification-matrix pin of the NEW widget arming contract delivered by
P1.M1.T1.S2: consumed Tab acceptance of a word candidate arms the chain
exactly once at the accepted record's store key, tier-0 accepts never
arm, trigger-span accepts arm, forwarded (span-miss) Tab never arms, and
`enableChaining: false` never arms.

**Deliverable**: Rewritten describe block (new title, e.g. "widget Tab
acceptance arms the chain — classification matrix (BUG-001 fix pin)") in
`test/widget.test.ts`, backed by an extended `makeInsertHarness` that can
paint REAL records through the visibility machine (seeded real
CandidateStore + keystroke + awaited microtask tick). This test file is
the acceptance gate for P1.M1.T1.S2.

**Success Definition**: All five matrix cases (a)–(e) pass; the edit
still lands in the arming cases (`buf.lines` updated, line hidden);
`test/chain.test.ts`, `test/chaining-gating.test.ts`, and
`test/provider*.test.ts` are UNTOUCHED and green; `npm run check` +
`npm test` green.

## Why

BUG-001 (Major): M2 chained completion is dead on the widget PRIMARY
path; the only existing test coverage actively PINS the defect ("BY
DESIGN", plan-004 descope that was never spec-amended). P1.M1.T1.S2 adds
`chain.arm` at the widget's tab-insert call site; per the repo's
spec/acceptance discipline, the behavior needs a pinning suite that
classifies exactly when arming fires — mirroring the fallback path's
`chaining-gating` coverage — so future regressions on the PRIMARY path
are caught (the plan-004 validate.sh Journey B gap that let BUG-001
ship).

## What

Test-only changes to `test/widget.test.ts` (plus its local harness
helpers). NO source changes, NO spec changes (S2's doc pins own the
"BY DESIGN" comment replacement; T2.S3 owns the spec/07 clause).

### 1. Extend `makeInsertHarness` (or add a sibling harness) to paint REAL records

The existing `show(displays)` writes `WidgetState.set` directly and
therefore does NOT populate the machine's `painted()` set (S1's single
write site is `paint()`; `show()` bypasses it — an acceptance driven by
`show()` yields `painted() === []` ⇒ no arm even with S2 landed). The
inverted pins must paint through the real machine:

- Add an optional `store` seed parameter (or a `chainHarness` sibling)
  that passes a REAL `CandidateStore` in `WidgetLayerOptions.store`
  instead of `emptyStore`, e.g.:

```ts
const seededStore = new CandidateStore();
for (const [key, display] of [["zendesk", "Zendesk"]]) {
  seededStore.upsert({ key, display, ordinal: 1, fromUser: false,
    properName: false, rankGroup: 0, isSubword: false });
}
const h = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 },
  { chain: spiedChain, store: seededStore });
```

- Drive the paint with a keystroke + microtask flush (the W1 deferred
  visibility tick — same pattern as the existing span-miss test at
  ~L884):

```ts
h.press("x"); // any input event ticks the machine (reads live buf "ze")
await Promise.resolve(); // W1 fix: visibility evaluates post-keystroke
// now machine.painted() holds the real RankedMatch records
// (menuDelayMs default 0 = OFF → first qualifying tick paints)
```

  Use an async test. Add a fixture sanity assertion before pressing Tab:
  `h.machine.painted().length` ≥ 1 and the target record's
  `key`/`tier`/`display` are as the case requires (this is what makes
  each classification case non-vacuous).

### 2. Replace the describe block (L1053-1075) with the classification matrix

Spied chain (existing pattern):

```ts
const spiedChain = (): ChainMachine => ({
  state: vi.fn(() => null),
  arm: vi.fn(),
  reset: vi.fn(),
});
```

Pin all five cases (spec §07 "armed only via Tab acceptance of a
whole-word candidate"; §04 tier-0 never arms; parity with
test/chaining-gating.test.ts:203):

**(a) consumed Tab acceptance of a word candidate CALLS chain.arm
exactly once with the STORE KEY while the edit still lands.**
Seed store `zendesk`/`Zendesk`, buffer `["ze"]` col 2, tick+flush →
painted record `{key:"zendesk", display:"Zendesk", tier:3}` (assert the
fixture sanity first). `press("\t")` (sync — no timer advancement needed).
Assert:
- `chain.arm` called exactly ONCE with `"zendesk"` —
  `expect(chain.arm).toHaveBeenCalledExactlyOnceWith("zendesk")` (or
  `toHaveBeenCalledTimes(1)` + `.mock.calls[0][0] === "zendesk"`).
- `h.buf.lines` === `["Zendesk"]` (the edit landed — arming never
  displaces the insert).
- `h.state.hidden` === true; `h.innerCalls` empty (consumed).
- KEY-VERBATIM note in a comment: assert the STORE KEY, never a
  lowercased display (provider.ts's documented path-key trap).

**(b) tier-0 accept never arms.** Trigger-mode loose pass produces
anchorless tier-0 matches: seed store with ONLY `zendesk`, buffer
`["#desk"]` col 5 (`d` does not anchor at `z`; loose pass fires because
zero anchored results exist in trigger mode — per-mode 45/loose
resolution, widget.ts deps.query default). Tick+flush; sanity-assert
`h.machine.painted()[0].tier === 0`. `press("\t")` → assert the insert
landed (`buf.lines` contains the display) AND `chain.arm` NOT called
(strict `=== 0` skip). If the fixture sanity check fails at
implementation time (loose-mode shape differs), FIRST verify with
`rankMatches(seededStore, "desk", {fuzzThreshold:45, loose:true})` in a
scratch node run and adjust the fragment until tier 0 is real — do not
drop the case.

**(c) trigger-span accept arms (whole word).** Buffer `["foo #ze"]`
col 7 (existing trigger-span shape at ~L785), same seeded store,
tick+flush → trigger-mode paint. `press("\t")` → insert lands
(`["foo Zendesk"]`), `chain.arm` once with `"zendesk"`.

**(d) span-miss forwarded Tab never arms.** Existing shape (~L884):
buffer `["foo "]` col 4 — visible line but no word span under the
cursor (paint via a store seed and whatever the machine shows, or keep
the `show()`-visible shape: EITHER is valid since `insertHighlighted`
returns false ⇒ forward ⇒ no arm; prefer the machine-painted variant
for consistency). `press("\t")` → `innerCalls === ["\t"]`,
`chain.arm` NOT called. Add the hidden/empty variants (existing ~L890
shape) asserting forwarded Tab never arms.

**(e) `config.enableChaining: false` never arms (parity with
chaining-gating.test.ts:203).** Identical to (a) but
`cfg({ enableChaining: false })` in the harness `over.config` (cfg
helper at ~L77 spreads DEFAULT_CONFIG). Consumed acceptance, edit
lands, `chain.arm` NOT called, `chain.state()` null — word-only M1
behavior.

Describe-level comment: replace the "BY DESIGN / arm-free" comment with
the new contract summary — arming lives at the widget tab-insert call
site (BUG-001 fix), classification mirrors provider.ts applyCompletion
(store key verbatim, strict tier-0 skip, enableChaining gate), and
chain-successor re-arming renders via T2 (P1.M1.T2) — out of scope here.

### Success Criteria

- [ ] Old "NEVER arms (plan 004 pin)" describe + "BY DESIGN" comment gone
- [ ] (a) arm exactly once with store key, edit lands, consumed
- [ ] (b) tier-0 painted record verified, insert lands, never arms
- [ ] (c) trigger-span accept arms at the word key
- [ ] (d) span-miss + hidden + empty forwarded Tab never arms
- [ ] (e) enableChaining:false never arms, chain stays idle
- [ ] Fixture sanity assertions guard every arming case (painted record
      exists with the expected key/tier BEFORE Tab)
- [ ] test/chain.test.ts, test/chaining-gating.test.ts,
      test/provider*.test.ts byte-identical (untouched) and green
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the exact pin block to
replace, the harness source layout, the show()-vs-paint() trap (the
one non-obvious failure mode, pre-solved with the keystroke+microtask
recipe), the seeded-store upsert shape, the tier-0 loose-mode recipe,
and the provider-path parity anchors are all reproduced below.

### Documentation & References

```yaml
- file: test/widget.test.ts
  why: The ONLY file to modify. Verified landmarks:
    - cfg helper (~L77): Partial<HapaxConfig> over DEFAULT_CONFIG.
    - buildWidget/makeKeyHarness/makeInsertHarness (~L400/430/671);
      makeInsertHarness spreads `...over` into WidgetLayerOptions —
      accepts {chain} and {config} and (after this task) {store}.
    - emptyStore stub (~L658): prefixRange → [0,0] ⇒ every query empty —
      WHY show()-driven accepts cannot arm; the new cases need a real store.
    - Span-miss test (~L884) with `await Promise.resolve()` — the W1
      deferred-tick flush pattern to copy.
    - Trigger-span accept shape (~L785): lines ["foo #ze"] col 7.
    - THE PIN: describe at L1053-1075 (quoted in research notes).
  pattern: follow the suite's existing assertion style (buf.lines,
    calls log, innerCalls, machine.getState(), toHaveBeenCalledOnce).
  gotcha: async test needed ONLY for the paint flush; the Tab press and
    its assertions are synchronous (existing "zero timer advancement"
    pin at ~L820).

- file: src/pi/widget.ts
  why: READ-ONLY dependency. S1 landed: painted() at L744, paintedSet
    written only in paint() (~L547), cleared in hide() (~522). deps.query
    default = rankMatches per-mode resolution (~L450). menuDelayMs
    default 0 (config.ts L127) ⇒ first qualifying tick paints without
    fake timers. Machine tick is DEFERRED to a microtask (W1 fix).
  gotcha: do NOT modify widget.ts — if a pin fails because source
    misbehaves, that is an S2 bug: report it, don't change the test.

- file: src/pi/provider.ts (applyCompletion, ~L639-706)
  why: the reference arming classification (value→key map, tier-0 skip,
    enableChaining gate, store-key-verbatim trap) the matrix mirrors.

- file: test/chaining-gating.test.ts
  why: parity anchors — L203 (enableChaining:false ⇒ chain.state() null
    after whole-word accept), L254 (externally-armed never offers), L283
    (force gated). UNTOUCHED; the widget (e) case mirrors L203.

- file: src/core/store.ts (CandidateStore.upsert)
  why: real-store seeding shape — upsert({key, display, ordinal,
    fromUser, properName, rankGroup, isSubword}) (same call as
    calibration.test.ts's lwlock control and store.test.ts).

- file: src/core/query.ts (rankMatches)
  why: what the machine's default query returns for the seeded store —
    RankedMatch with tier 3 for exact prefix; loose pass (trigger mode,
    zero anchored results) yields tier 0 anchorless matches.

- file: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/P1M1T1S2/PRP.md
  why: THE CONTRACT under test — arming at the tab-insert call site,
    record captured pre-insert, `enableChaining && rec && rec.tier !== 0
    && rec.key` gate, span-miss forward never arms.

- file: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/P1M1T1S3/research/research-notes.md
  why: full measurements: the show()/paint() trap, harness line map,
    tier-0 recipe, paint mechanics.
```

### Current Codebase tree (relevant excerpt)

```bash
test/widget.test.ts               # modify: pin block L1053-1075 + harness store seed
src/pi/widget.ts                  # read-only (S1 landed, S2 in flight)
src/pi/provider.ts                # read-only reference classification
test/chain.test.ts                # untouched, must stay green
test/chaining-gating.test.ts      # untouched, must stay green
test/provider*.test.ts            # untouched, must stay green
src/core/store.ts / query.ts      # read-only (real store seeding)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: h.show() writes WidgetState.set — it does NOT populate
// machine.painted(). An arming case driven by show() is vacuously
// never-arming even with S2 correct. Paint via: real store + press(key)
// + await Promise.resolve() (W1 deferred tick).
// CRITICAL: the Tab press and its assertions are SYNCHRONOUS — never
// advance timers to make arming happen (the insert is never
// debounce-gated; pinned at test ~L820).
// GOTCHA: assert arm's argument with toBe / mock.calls[0][0] === key —
// the STORE key ("zendesk"), never a lowercased display (path keys
// keep trimmed-lowercase while displays keep edge slashes).
// GOTCHA: tier-0 only exists via the trigger-mode loose pass (zero
// anchored results precondition) — sanity-assert painted()[0].tier === 0
// BEFORE the Tab, or the case silently degrades to (d).
// GOTCHA: vi.fn chain spy shape must satisfy ChainMachine
// (state/arm/reset) — copy the existing L1060 pattern.
// GOTCHA: this suite is the S2 acceptance gate — it is EXPECTED to be
// red before S2 lands. Task 0 checks; do not weaken cases to force
// green.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY preconditions
  - RUN: npx vitest run test/widget.test.ts
  - IF S2 has landed: the OLD pin (arm not called after consumed
    accept) FAILS — expected; proceed. IF S2 has NOT landed: stop and
    report (this PRP is S2's gate; implementing it against un-landed
    source produces false-red noise).
  - CONFIRM painted() exists (src/pi/widget.ts L744) — S1 landed.

Task 1: EXTEND makeInsertHarness (test/widget.test.ts ~L671)
  - ADD: optional real-store seeding — accept {store} in `over`
    (already spread into WidgetLayerOptions) and a helper
    `seedStore([[key, display], ...])` building a real CandidateStore
    via upsert (ordinal: store.currentOrdinal()+1 per upsert).
  - KEEP: emptyStore default, never-mutate pin, calls log, show(),
    press() — all existing tests untouched.
  - NOTE in a comment: show() bypasses machine paint (why the arming
    cases use press+flush instead).

Task 2: REPLACE the describe at L1053-1075
  - NEW title: "widget Tab acceptance arms the chain — classification
    matrix (BUG-001 fix pin)"
  - NEW contract comment (arming at the tab-insert call site; mirrors
    provider.ts; successor re-arm lands with P1.M1.T2)
  - spiedChain() helper (existing vi.fn shape)
  - CASE (a): seed zendesk, buf ["ze"] col 2, press("x") + await
    Promise.resolve(), sanity-assert painted()[0] {key:"zendesk",
    tier:3}, press("\t") → arm once with "zendesk", edit lands,
    consumed, hidden.
  - CASE (b): trigger loose tier-0 — buf ["#desk"] col 5, only
    "zendesk" stored; sanity-assert painted()[0].tier === 0; press
    Tab → insert lands, arm NOT called.
  - CASE (c): buf ["foo #ze"] col 7 → trigger-span accept arms at
    "zendesk".
  - CASE (d): buf ["foo "] col 4 span-miss forward + hidden + empty
    variants → arm NOT called.
  - CASE (e): cfg({enableChaining:false}), identical to (a) → edit
    lands, arm NOT called, chain.state() null.

Task 3: FULL VALIDATION
  - RUN: git status --porcelain -- test/chain.test.ts
    test/chaining-gating.test.ts 'test/provider*.test.ts' → must be
    EMPTY (untouched)
  - RUN: npx vitest run test/widget.test.ts test/chain.test.ts
    test/chaining-gating.test.ts
  - RUN: npm test && npm run check
```

### Implementation Patterns & Key Details

```ts
// The core recipe (case a) — every arming case follows this shape:
it("consumed Tab acceptance arms the chain exactly once at the store key", async () => {
  const chain = spiedChain();
  const store = new CandidateStore();
  store.upsert({ key: "zendesk", display: "Zendesk",
    ordinal: store.currentOrdinal() + 1, fromUser: false,
    properName: false, rankGroup: 0, isSubword: false });
  const h = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 },
    { chain, store });

  h.press("x");                    // any input event ticks the machine
  await Promise.resolve();         // W1: visibility evaluates post-keystroke

  // Fixture sanity — the case is about THIS record being armed:
  const rec = h.machine.painted()[0];
  expect(rec?.key).toBe("zendesk");
  expect(rec?.tier).not.toBe(0);   // tier 3 (exact prefix)

  h.press("\t");                   // synchronous acceptance

  expect(chain.arm).toHaveBeenCalledTimes(1);
  expect((chain.arm as Mock).mock.calls[0]![0]).toBe("zendesk"); // STORE key verbatim
  expect(h.buf.lines).toEqual(["Zendesk"]); // the edit still landed
  expect(h.state.hidden).toBe(true);
  expect(h.innerCalls).toEqual([]);         // consumed
});
```

### Integration Points

```yaml
NONE: test-only. No src/, spec/, README changes (S2 owns the source +
  doc pins; T2.S3 owns the spec/07 clarifying clause; README is P1.M2.T4).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc + lint; expect zero errors
```

### Level 2: Unit Tests (the deliverable)

```bash
npx vitest run test/widget.test.ts -t "arms the chain"
npx vitest run test/widget.test.ts
npx vitest run test/chain.test.ts test/chaining-gating.test.ts
npx vitest run test/provider.test.ts test/provider-match.test.ts test/provider-live.test.ts test/provider-display.test.ts
npm test
```

### Level 3: Gate isolation

```bash
git status --porcelain -- test/chain.test.ts test/chaining-gating.test.ts
# expect: no output (untouched)
```

### Level 4: Contract review

```bash
# Re-read the five cases against P1.M1.T1.S2/PRP.md's Success Criteria —
# every S2 criterion (arm once, key verbatim, tier-0 skip, span-miss
# no-arm, enableChaining gate) must be covered by exactly the matrix.
```

## Final Validation Checklist

- [ ] Task 0 precondition check done (S2 landed; old pin failing first)
- [ ] Old no-arm describe + "BY DESIGN" comment fully removed
- [ ] All five matrix cases present, each with a painted-record sanity
      assertion before the Tab press
- [ ] Arming assertions use the STORE key, exactly-once
- [ ] chain/ chaining-gating / provider* files untouched and green
- [ ] `npm test` + `npm run check` green
- [ ] No source, spec, or README edits

## Anti-Patterns to Avoid

- ❌ Don't pin arming through `h.show()` — it bypasses the machine paint
  and is vacuously never-arming (the one trap that would make this
  suite green while BUG-001 recurs)
- ❌ Don't advance timers to force arming — the Tab accept and arm are
  synchronous; timer advancement hides real bugs
- ❌ Don't weaken or delete a matrix case if it fails — a failure is an
  S2 contract violation; report it
- ❌ Don't assert on a lowercased display as the armed key
- ❌ Don't touch the fallback-path tests or provider.ts
- ❌ Don't pin successor-offer rendering (P1.M1.T2 scope)
