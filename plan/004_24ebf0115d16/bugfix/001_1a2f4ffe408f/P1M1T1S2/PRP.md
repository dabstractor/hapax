# PRP — P1.M1.T1.S2 (bugfix 001_1a2f4ffe408f): Call chain.arm from insertHighlighted on whole-word accepts

---

## Goal

**Feature Goal**: Implement chain arming on the widget PRIMARY path
(BUG-001, step 1 of the fix): on a consumed Tab accept of a whole-word /
trigger-span / chain-successor candidate in `src/pi/widget.ts`'s
tab-insert flow, call `opts.chain.arm(rec.key)` exactly once with the
accepted record's store key — gated on `config.enableChaining`, skipping
tier-0 (anchorless) matches, never arming on span-miss forwards or hidden
lines — mirroring the fallback provider's `applyCompletion` classification
(provider.ts ~639-706).

**Deliverable**:
- Arming at the tab-insert call site in `src/pi/widget.ts` (~1165),
  reading the accepted record via S1's `machine.painted()` seam
- Deleted "CHAIN ARMS: NEVER (plan 004)" doc block (~833-840), updated
  `WidgetLayerOptions.chain` JSDoc, updated file-header forward-task map
- TDD: failing arming tests first; the `test/widget.test.ts:1053` no-arm
  pin updated minimally (it WILL fail once arming lands — the suite must
  never rest red; S3 formalizes the full pin suite)

**Success Definition**: with a bigram-seeded store, Tab-accepting
`ZorpWibble` through the composed widget editor calls
`chain.arm("zorpwibble")` exactly once; Tab with the line hidden or on a
span-miss forward never arms; tier-0 accepts never arm;
`enableChaining: false` never arms; `npm run check` + `npm test` green.

## Why

BUG-001 (Major): M2 chained completion is structurally dead on the widget
PRIMARY path — the only arming site is the fallback provider's
applyCompletion, which is never registered when an editor factory exists
(pi-vim, split-editor). Spec/07 defines the chain machine as
path-independent ("armed only via Tab acceptance of a whole-word
candidate"; "Chain offers render on the widget line (or fallback menu)")
and spec/01 goal 7 makes zero-typed-char successor offers a core M2
milestone. This task restores the arming half; the consult/render half is
P1.M1.T2.S1/S2 and the pin formalization is S3.

## What

In `src/pi/widget.ts`, at the tab-insert decision branch (~1165):

```typescript
} else if (decision.action === "tab-insert") {
  // Capture the accepted record BEFORE the insert: insertHighlighted's
  // success path hides the line, and hide() clears painted() (S1's
  // lifetime contract) — a post-call read would see [].
  const paintedNow = machine.painted();
  const rec =
    paintedNow.length > 0
      ? paintedNow[Math.min(Math.max(state.highlightIndex, 0), paintedNow.length - 1)]
      : undefined;
  const consumed = insertHighlighted(
    innerRecord as unknown as EditorLike,
    state,
    machine,
    opts.config,
    requestRender,
  );
  if (!consumed) return forwardInput(data); // span-miss forward: NEVER arms
  // Chain arming (BUG-001 fix, mirroring provider.ts applyCompletion):
  // whole-word, trigger-span, and chain-successor accepts all arm at the
  // accepted record's STORE KEY (never a lowercased display — rule-4d
  // path keys are trimmed-lowercase while displays keep edge slashes).
  // Strict tier === 0 skip (spec §04: anchorless matches never arm or
  // extend a chain); undefined tier (chain shims, '#' listings) arms.
  // enableChaining gate: inert flag → M1 word-only behavior.
  if (opts.config.enableChaining && rec && rec.tier !== 0 && rec.key) {
    opts.chain.arm(rec.key);
  }
}
```

Design notes (binding):
- **Arm at the CALL SITE, not inside insertHighlighted** — the record must
  be captured BEFORE the call because `insertHighlighted` calls
  `state.hide()`/`machine.onDismissed(true)` on success and S1's
  `painted()` clears on hide.
- **rec.key verbatim** — `RankedMatch.key` IS the store key
  (trimmed-lowercase, h2.27). Do NOT `toLowerCase()` the display
  (provider.ts's documented trap: path displays keep `/`-edges, the store
  key doesn't — lowercasing a display misses the successor index).
- **Successor accepts re-arm naturally**: chain-successor items painted by
  T2.S1 are RankedMatch-shaped with their own store keys —
  `arm(rec.key)` re-arms at that successor, equivalent to the provider's
  CHAIN_KEY_PREFIX branch. No special-casing here.
- **No one-shot-grant handling** — the grant tracker port is P1.M1.T2.S2;
  S2 arms ONLY (`chain.arm(key)` with no grant state).
- Delete the "CHAIN ARMS: NEVER (plan 004)" doc block (widget.ts
  ~833-840) and replace with an accurate comment (arming lives at the
  tab-insert call site; classification mirrors provider.ts). Update
  `WidgetLayerOptions.chain`'s JSDoc ("read by NO widget code" is now
  false) and the file-header forward-task map.

### Success Criteria

- [ ] Tab-accept of a whole-word candidate (line visible, span hit) →
      `chain.arm(<store key>)` called EXACTLY once
- [ ] Trigger-span accepts arm (whole-word insertions, spec/07:476)
- [ ] Tab with the line hidden, empty items, or a span-miss (forward
      path) → chain.arm NEVER called
- [ ] Accepted record with `tier === 0` → never arms; `tier` undefined
      (shims/listings) → arms (strict `=== 0` check)
- [ ] `enableChaining: false` → never arms (word-only M1 behavior)
- [ ] Path-token key armed verbatim (no display lowercasing)
- [ ] "CHAIN ARMS: NEVER" block deleted; JSDoc + header map accurate
- [ ] test/widget.test.ts:1053 no-arm pin updated (suite green); S3 owns
      the fuller pin suite
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the exact call-site code
(quoted from live source), the provider's reference classification with
its documented traps, S1's painted() lifetime contract, and the test-fixture
recipe from the bug report's repro are all below.

### Documentation & References

```yaml
- file: src/pi/widget.ts
  why: The ONLY source file to modify. Verified structure:
    - WidgetLayerOptions.chain (~L122-131): `chain: ChainMachine` —
      JSDoc currently says "held for index.ts's reset wiring and is read
      by NO widget code" (UPDATE — it is now read at the tab-insert site).
    - insertHighlighted (~L841): (inner, state, visibility, config,
      requestRender) → boolean. Success path ends with hide() +
      machine.onDismissed(true) — the reason the record must be captured
      at the CALL SITE before the call. Its "CHAIN ARMS: NEVER" doc block
      (~833-840) is DELETED/REPLACED this task.
    - Tab-insert branch (~1165): exact current code quoted in "What".
    - The tab branch's catch-wrapped try block: put the arming INSIDE the
      same defensive try (an arm() throw must never break input — the
      file's failure model is "worst case inert").
  pattern: defensive try + never-break-input, exactly like the
    navigate/escape branches above it.
  gotcha: opts (WidgetLayerOptions) is in closure scope at the call site —
    no signature changes to insertHighlighted are needed; do NOT thread
    chain as a 6th parameter.

- file: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/P1M1T1S1/PRP.md
  why: CONTRACT for the seam this consumes: VisibilityMachine.painted():
    readonly RankedMatch[] — aligned 1:1 with currentSet in ORDER and
    LIFETIME (paint() is the single write site; hide() clears to []).
    The ORDER parity is what makes paintedNow[clampedIdx] the accepted
    record: state.items is a copy of currentSet, and insertHighlighted
    indexes state.items by the same clamped state.highlightIndex.
  gotcha: if painted() is absent (S1 not landed), STOP.

- file: src/pi/provider.ts (applyCompletion, ~L639-706)
  why: THE reference classification being mirrored. Verified traps:
    (1) arm the STORE KEY, never a lowercased display (rule-4d path keys
    vs displays); (2) strict `tier === 0` suppression — `tier <= 0` or
    falsy checks BREAK chaining (chain shims and '#' listing records OMIT
    tier and must keep arming); (3) everything gated on
    config.enableChaining; (4) trigger-mode completions arm (whole-word
    insertions, pinned by test/chain.test.ts case 11); (5) one-shot grant
    resets are provider-internal — NOT ported here (T2.S2 owns the shared
    tracker).

- file: test/widget.test.ts
  why: The composed-editor fixture file. The no-arm pin at ~1053 ("CHAIN
    ARMS... BY DESIGN") FAILS once arming lands — update it in this task
    to assert the NEW behavior (arm called with the store key) so the
    suite is green; S3 (P1.M1.T1.S3) formalizes the full arming pin
    suite. Read the file's editor-double/composition helpers first —
    tests drive the proxy's handleInput with Tab after typing.

- file: test/widget-visibility.test.ts
  why: S1's pin tests live here; also the stubbed-query fixture pattern
    if you prefer machine-level tests. The composed-widget arming tests
    belong in widget.test.ts next to the existing tab-insert cases.

- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/r1-chain-widget.md
  section: "Recommended fix design" step 1 + "Exact contracts"
  why: The verified recon this implements: insertHighlighted arming
    mirrored from provider.ts, tier-0 skip, enableChaining gate, never arm
    on span-miss forwards, ChainMachine API (state()/arm(word)/reset(),
    provider.ts:765-790), index.ts:402 resets the SAME instance on
    before_agent_start.

- prd: spec/04:215-216 "tier-0 matches never arm or extend a chain";
  spec/07:476 trigger-char completions arm (whole-word insertions);
  spec/07 h2.49 path-independent chain machine.
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/pi/
│   ├── widget.ts       # MODIFY — arming at tab-insert site + doc updates
│   └── provider.ts     # reference only (applyCompletion classification)
└── test/
    ├── widget.test.ts  # MODIFY — new arming cases + no-arm pin update (:1053)
    └── widget-visibility.test.ts  # untouched (S1's pins stay green)
```

### Desired Codebase tree with files to be changed

```bash
src/pi/widget.ts        # +~20 lines at the tab-insert branch; -8 doc lines; JSDoc/header updates
test/widget.test.ts     # +1 describe block (~5 its); :1053 pin updated
```

### Known Gotchas of our Codebase & Library Quirks

```python
# CRITICAL: capture machine.painted()[idx] BEFORE insertHighlighted runs —
#   its success path calls hide(), and hide() clears painted() (S1's
#   lifetime contract). A post-call read sees [] and never arms (the
#   silent-failure mode this changeset exists to kill).
# CRITICAL: strict `rec.tier !== 0` (arm when undefined). `!rec.tier`
#   would break chaining for chain shims and '#'-listing records, which
#   OMIT tier by design (provider.ts's documented suppression contract).
# CRITICAL: arm rec.key VERBATIM — never item/display.toLowerCase().
#   RankedMatch.key is already the store key; rule-4d path keys are
#   trimmed-lowercase while displays keep '/', so display-lowercasing
#   misses the successor index.
# CRITICAL: never arm on the !consumed path — insertHighlighted returned
#   false (hidden, empty items, span-miss, any throw) means the Tab was
#   FORWARDED verbatim; the user accepted nothing of hapax's.
# GOTCHA: keep the arming inside the branch's defensive try — an arm()
#   throw must degrade to inert, never break input (file failure model).
# GOTCHA: no one-shot-grant state here (chainWordsSeen & co. are
#   provider-internal; the shared tracker is P1.M1.T2.S2). S2 = arm() only.
# GOTCHA: enableChaining:false must leave word-completion behavior
#   byte-identical (the flag gates ONLY the chain layer — provider
#   precedent; pin it).
# GOTCHA: the no-arm pin at test/widget.test.ts:1053 WILL fail. Update it
#   in THIS task (suite must be green before commit); P1.M1.T1.S3 then
#   formalizes the full arming pin suite. Do not delete the pin's
#   rationale — rewrite it to the new contract.
# GOTCHA: index.ts resets opts.chain on before_agent_start (index.ts:402)
#   — arming here uses the SAME instance, so reset semantics compose
#   unchanged; do not create or hold any second machine.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies, TDD)

```yaml
Task 0: PRECONDITION
  - Confirm S1 landed: widget.ts's VisibilityMachine exposes painted()
    (npx vitest --run test/widget-visibility.test.ts -t painted → green).
    If absent, STOP.

Task 1: TDD — ADD failing arming cases to test/widget.test.ts
  - Follow the file's composed-editor fixture (proxy handleInput + Tab
    after typing; bigram store seeded via IngestPipeline
    onAdmittedTokens → store.recordBigramRuns — the bug report's repro
    recipe: ingest "ZorpWibble quuxblat mode. ZorpWibble quuxblat again.").
  - Use a REAL createChainMachine() (or a vi.fn-recording ChainMachine
    double: { state: vi.fn(() => null), arm: vi.fn(), reset: vi.fn() } —
    assert arm called once with the exact store key).
  - CASES:
      it("Tab-accept of a whole-word candidate arms the chain at its
          store key", ...)            // arm('zorpwibble') exactly once
      it("trigger-span accept arms (whole-word insertion, spec/07:476)")
      it("Tab with the line hidden / span-miss forward never arms")
        // hidden line, and a buffer where the span computation misses →
        // forwarded Tab → arm never called
      it("tier-0 accepted record never arms (strict === 0)")
        // machine stub/painted record with tier: 0 (S1 seam or a stubbed
        // query returning tier-0 records)
      it("enableChaining:false never arms; word completion unchanged")
      it("arm called EXACTLY once per accept (no double-arm)")
  - RUN → RED.

Task 2: IMPLEMENT the arming at the tab-insert call site (widget.ts)
  - Code exactly per "What": pre-call record capture, !consumed forward,
    gated arm inside the defensive try.
  - Delete the "CHAIN ARMS: NEVER (plan 004)" doc block; write the
    accurate replacement (arming at the call site; classification mirrors
    provider.ts applyCompletion; tier-0 skip; enableChaining gate).
  - Update WidgetLayerOptions.chain JSDoc (now read by the tab-insert
    site) and the file-header forward-task map (arming landed; consult
    branch = T2.S1; grant tracker = T2.S2; pins = S3).

Task 3: UPDATE the no-arm pin (test/widget.test.ts ~1053)
  - Rewrite it to assert the NEW arming contract (same fixture, arm
    called with the store key) — the suite must be green after this task.
    Preserve the pin's documentation role (S3 will formalize).

Task 4: FULL REGRESSION
  - npm run check
  - npx vitest --run test/widget.test.ts test/widget-visibility.test.ts
    test/chain.test.ts test/provider*.test.ts
  - npm test
```

### Implementation Patterns & Key Details

```typescript
// The ordering trap, visualized:
//   machine.painted() ── paint() sets ──► [rec, rec, ...]
//   insertHighlighted(...):  ...; hide();  ← painted() → [] HERE
//   post-call read → [] → silent never-arm.  Capture BEFORE:
const paintedNow = machine.painted();                  // BEFORE the call
const rec = paintedNow[Math.min(Math.max(state.highlightIndex, 0),
                                paintedNow.length - 1)];
const consumed = insertHighlighted(...);
if (!consumed) return forwardInput(data);              // forward: no arm
try {
  if (opts.config.enableChaining && rec && rec.tier !== 0 && rec.key) {
    opts.chain.arm(rec.key);                           // store key verbatim
  }
} catch { /* arming failures never break input */ }

// Provider-parity checklist (from provider.ts applyCompletion):
//   enableChaining gate ✔ | store-key-not-display ✔ | strict tier===0 ✔ |
//   never-arm-on-forward ✔ | grant state: NOT HERE (T2.S2) ✔
```

### Integration Points

```yaml
NEXT TASKS (do NOT implement):
  - P1.M1.T1.S3: formalize the arming pin suite (inverts the plan-004
    no-arm pin fully; your Task 3 update is the interim contract).
  - P1.M1.T2.S1: visibility-machine consult branch reads chain.state()
    — your arm() calls are what make state() non-null at empty word starts.
  - P1.M1.T2.S2: shared one-shot grant tracker (chainWordsSeen port);
    do not pre-empt.
SHARED INSTANCE: opts.chain is the SAME ChainMachine index.ts resets on
  before_agent_start (index.ts:402) — arming composes with reset free.
SPEC: the spec/07 clarifying clause lands with P1.M1.T2.S3, NOT here
  (Mode A code comments only in this task).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check
```

### Level 2: Unit Tests (TDD)

```bash
npx vitest --run test/widget.test.ts -t arm -v        # new arming cases
npx vitest --run test/widget.test.ts                   # incl. updated pin
npx vitest --run test/widget-visibility.test.ts        # S1 pins untouched
npm test
```

### Level 3: Integration (both chain paths)

```bash
npx vitest --run test/chain.test.ts test/provider.test.ts test/provider-display.test.ts
# fallback-path chaining unchanged; widget arming is additive
```

### Level 4: Domain-Specific (BUG-001 repro, pre-consult)

```bash
# The bug report's repro sequence up to step 4 — arming now happens:
# ingest bigram fixture → compose widget editor → type 'zorp' → Tab.
# chain.state() must be {word:'zorpwibble'} (the successor OFFER still
# does not render until P1.M1.T2.S1 — assert state only, not visibility).
npx vitest --run test/widget.test.ts -t "arms"
```

## Final Validation Checklist

- [ ] Arming at the tab-insert call site; record captured PRE-call (hide() ordering)
- [ ] arm(storeKey) exactly once on consumed whole-word/trigger/successor accepts
- [ ] Never arms: hidden line, span-miss forward, tier === 0, enableChaining:false
- [ ] Strict `tier !== 0` (undefined arms); key verbatim (no display lowercasing)
- [ ] Arming inside the defensive try (inert on throw)
- [ ] "CHAIN ARMS: NEVER" block deleted; chain JSDoc + header map updated
- [ ] test/widget.test.ts:1053 pin updated; S1's visibility pins untouched
- [ ] No grant-tracker state (T2.S2), no consult branch (T2.S1), no spec edit (T2.S3)
- [ ] `npm run check` + `npm test` fully green

## Anti-Patterns to Avoid

- ❌ Don't read painted() after insertHighlighted (hide() cleared it)
- ❌ Don't arm on the !consumed/forward path
- ❌ Don't use `!rec.tier` or `tier <= 0` — strict `!== 0` (shims/listings arm)
- ❌ Don't lowercase the display — arm rec.key, the store key
- ❌ Don't port the one-shot grant or write any chain consult logic (T2)
- ❌ Don't leave the suite red waiting for S3 — update the pin now
- ❌ Don't create a second ChainMachine — opts.chain is the shared instance
- ❌ Don't let an arm() throw break input (defensive try)

---

**Confidence Score**: 9/10 — the exact call-site code, provider reference
classification with its three documented traps, S1's painted() lifetime
contract (including the hide()-clears ordering trap this PRP pre-solves),
and the repro fixture are all verified against live source this session.
