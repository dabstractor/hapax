# Research — P1.M1.T1.S3 (bugfix 001): Invert the no-arm pin; pin the new arming contract

## Verified codebase state

### The pin to invert: test/widget.test.ts:1053-1075
`describe("widget Tab acceptance NEVER arms a chain (plan 004 pin)")` —
one test: spied ChainMachine (`state/arm/reset` as vi.fn), harness via
`makeInsertHarness({lines:["ze"],line:0,col:2},{chain})`, `h.show(["Zendesk"])`,
`h.press("\t")`, then asserts the edit landed AND `chain.arm` NOT called.
The whole describe + its "BY DESIGN" comment block must be REPLACED with
the inverted classification matrix (a)-(e).

### CRITICAL harness fact: `show()` bypasses the machine paint
- `makeInsertHarness` (~L671): builds WidgetLayerOptions with `emptyStore`
  (a stub whose prefixRange → [0,0] ⇒ every query returns []), then
  `show(displays)` writes `state.set(...)` — the **WidgetState** seam,
  NOT `createVisibilityMachine.paint()`.
- S1 (LANDED — verified in src/pi/widget.ts): `paintedSet` is written
  ONLY in `paint()` (line ~547) and cleared in `hide()` (~522);
  `painted()` accessor at L744; interface docs at L373-384 name it "the
  Tab-insert arming seam (BUG-001 fix, P1.M1.T1.S2)".
- S2's contract (from its PRP): the tab-insert branch captures
  `machine.painted()[clamped highlightIndex]` BEFORE calling
  `insertHighlighted` and calls `chain.arm(rec.key)` iff
  `opts.config.enableChaining && rec && rec.tier !== 0 && rec.key`.
- CONSEQUENCE: a `show()`-driven Tab acceptance has `painted()` === []
  ⇒ `rec` undefined ⇒ NO arm even after S2. The inverted pins MUST
  paint through the REAL machine: seed a real CandidateStore, seed the
  harness buffer, press a character (forwarded to the inner), and
  `await Promise.resolve()` (or the microtask flush pattern) so the
  deferred W1 visibility tick runs `onInput` → real `rankMatches` query
  → `paint(records)`. Existing precedent: the span-miss test (~L884)
  uses `await Promise.resolve()` with the comment "W1 fix: visibility
  evaluates post-keystroke (microtask)".

### Machine paint mechanics needed for the pins
- `deps.query` default = `rankMatches(store, fragment, {limit:
  maxSuggestions, fuzzThreshold: resolveFuzzThreshold(config, mode),
  loose: mode === "trigger"})` (widget.ts ~450).
- mode "trigger" = line's word starts with `config.triggerChar`
  (default "#"); ambient otherwise.
- Hesitation gate: `menuDelayMs` default **0 = OFF** (config.ts L127) →
  the first qualifying tick paints immediately — no fake timers needed.
- Debounce (100 ms) applies only to a DIFFERING set while already
  visible; the first paint is synchronous within the deferred tick.
- `applyVisibility` pushes `st.currentSet` into `state.set`, so after
  the awaited tick, `state.items` reflects the painted records and
  highlightIndex is 0.

### Real store recipe (from the bug-report repro + store.test.ts)
```ts
const store = new CandidateStore();
store.upsert({ key: "zendesk", display: "Zendesk", ordinal: 1,
  fromUser: false, properName: false, rankGroup: 0, isSubword: false });
```
`rankMatches(store, "ze")` → `[{key:"zendesk", display:"Zendesk",
tier: 3 (exact prefix), sessionCount: 1, …}]`. Tier is present on
match-path results (plan-004 query change, omit-contract).

### Tier-0 recipe (loose anchorless pass)
Trigger mode + zero anchored results → the loose pass returns
anchorless (tier 0) matches: seed store with only `zendesk`, harness
buffer `["#desk"]` col 5 (`d` does not anchor at `z`), press+await →
painted record carries `tier === 0` (assert this FIRST as a fixture
sanity check). Note '#' + fragment also exercises trigger-mode.

### Existing test fixtures referenced by the contract
- `makeInsertHarness` opts spread: `...over` accepts `{chain}` and
  `{config}` overrides — spied-chain pattern at :1060-1063, config
  override pattern via `cfg({enableChaining:false})` (cfg at :77
  spreads DEFAULT_CONFIG, whose `enableChaining: true`, config.ts L128).
- Span-miss forwarded-Tab shape (test at :884): lines ["foo "] col 4,
  visible + non-empty but no word span under cursor → Tab forwards
  verbatim (`inner:\t`).
- Trigger-span accept shape (test at :785): lines ["foo #ze"] col 7 —
  trigger-char span consumed on accept, inserts the display.
- Hidden/empty forwarded Tab (test at :890-898).
- Parity pins in test/chaining-gating.test.ts: L203 "no arming on
  Tab-accept" (provider, enableChaining:false → chain.state() null),
  L254 externally-armed never offers, L283 force path gated — these
  files stay UNTOUCHED (fallback path unchanged).

### Untouched-and-green requirement
test/chain.test.ts, test/chaining-gating.test.ts, test/provider*.test.ts
must remain unmodified and green. The stale line-230 render assertion
(`line).not.toMatch(/chain/)`) is about RENDER text leakage —
unaffected by arming; leave it.

### Sibling PRP contracts
- S1 (landed): `painted(): readonly RankedMatch[]`, lifetime parity
  with currentSet, single write site paint(), cleared on hide().
- S2 (in flight, READY): arm at the tab-insert CALL SITE (record
  captured pre-insert), `chain.arm(rec.key)` with store key verbatim
  (never lowercased display — path keys trap), strict `tier !== 0`,
  gated on `opts.config.enableChaining`, span-miss forward never arms,
  inside the defensive try. This S3 PRP is S2's acceptance gate.
- T2.S1 (later): chain-successor shims paint through the same seam —
  S3 must NOT pin anything about successor offers (out of scope).
