# P4.M1.T1.S1 research findings — verified against HEAD (a618343)

## Code state (verified by read, not assumed)

- `src/pi/widget.ts` (1884 lines) is the ONLY production file this item touches.
- The suppression seam today: `insertHighlighted` ends with
  `state.hide(); visibility.onDismissed(true)` (~:1462-1463). Doc block
  ~:1306-1344 calls it "the ONLY suppression seam".
- `onDismissed(explicit)` in `createVisibilityMachine` (~:1712-1737) has the
  T3 seam comment listing "Escape / boundary pass-through / Tab-accept /
  Enter-submit" (~:1082 area is the R4 comment; the seam list is inside
  onDismissed). Other callers of `onDismissed(true)` (all STAY):
  enter-submit branch (~:1724), boundary-pass-through branch (~:1740),
  escape branch (~:1780).
- Suppression-lapse machinery (suppressedFingerprint/suppressedFragmentStart,
  evaluate top ~:787-818 + R4 ~:1042-1070, state vars ~:645-650): STAYS —
  now serves only Escape / boundary / Enter-submit.
- No separate "immediate post-Tab re-offer guard" exists in widget.ts today
  (grep found only historical mentions in provider.ts comments / query.ts
  comment). The retirement = removing the `onDismissed(true)` call only.
- Tab-deferral pre-check (`isShowingAutocomplete`) sits in `widgetHandleInput`
  BEFORE the tab-insert branch (~:1670-1690) — must stay first. Regression
  suite: `test/defer-pi-menu.repro.test.ts` (P3.M1.T1.S1, committed c66ba57).
- Chain arm site in the tab-insert branch (~:1790-1818): captures `rec` from
  `machine.painted()` BEFORE `insertHighlighted` (hide() clears painted()),
  then `opts.chain.arm(rec.key); chainGrant.reset();` — UNCHANGED by this item.
- Visibility machine internals:
  - `onDismissed(false)` already exists = `closeWith(now)` → hide + closeAt
    stamp, NO suppression (test :751-761 pins it).
  - R7 fresh-reopen: `closeAt !== null && now - closeAt < reopenMs (200)` →
    bypasses R5 hesitation AND paints immediately on the `!visible` branch
    (no R6 swap-debounce park). A synchronous eval right after the close is
    ALWAYS inside the 200 ms window → immediate render, hesitation bypass —
    exactly h3.12 item 6 semantics, with ZERO new machine machinery.
  - Chain consult inside evaluate (~:830-950) runs BEFORE the normal query
    when armed; its (c) disqualification arm calls `deps.chain?.reset?.()`.
  - Grant tick `grantSpent = ... grant.tick(curArmedPrefix)` (~:875-880).
- `evaluate` order: chainIntent reset → lapse → R1 stock contexts → chain
  consult → threshold-clamp match → R2 startup gate → query → R4/R5/R6/R7.
  Post-insert the buffer is already updated synchronously (setText is sync),
  so a synchronous `machine.onInput()` reads the POST-insert buffer — the W1
  microtask problem does not apply (W1 is about DELEGATED keystrokes).

## The (c)-reset vs fresh-arm interaction (the one real ordering hazard)

Eval-AFTER-arm: consult (b) would filter topSuccessors(NEW word) by
matchFragment(newFragment, next) → offer drawn from the SUCCESSOR index, not
the store query (h3.11 defines the offer as the query result set —
"every live match of the completed word as a fragment"). WRONG.
Eval-BEFORE-arm: common case (chain idle — typing then Tab) → pure query
offer ✓. Ladder case (armed at prev word): consult may answer with successor
extensions or (c)-reset the chain — and the arm site immediately re-arms at
the accepted word, so "chain ends armed at the FINAL accepted word" (the S2
pin) holds either way. ⇒ ORDER: insert → extension eval → arm.

## Query core: NO change needed

Exact-equal exclusion already in `src/core/query.ts`: anchored pass :592
(`if (k === lower) continue;`), tier-0 pass :646. Chain-membership filter in
widget.ts ~:894 (`s.next !== frag.toLowerCase()`). The offer = normal
`rankMatches` call through the machine's existing `query` dep.

## Spec state

spec/07-completion-ui.md ALREADY contains the adopted h3.10 amendment
(:226 "RETIRED ... Tab-accept no longer arms suppression"), h3.11 (:261),
h3.12 item 6 — committed 6799367 "docs(spec): post-Tab extension offer
adopted". Spec is AHEAD of code: this item ships CODE ONLY, no spec edits.

## Tests that pin today's (wrong) behavior — must be updated

- test/widget.test.ts:960 "Tab inserts ... dismissed + suppressed" → asserts
  `suppressUntilWordStart === true` after Tab.
- test/widget.test.ts:1089 — another post-Tab suppression assertion in the
  Tab describe block.
- Harness facts: `makeInsertHarness` `show()` drives `state.set` directly
  (bypasses the machine → painted() empty → no arming, no offer). The
  composed harness (~:900) exposes `machine` (WIDGET_MACHINE), `buf`, a trap
  store (`setHits`), `press`, `requestRender`, `onKeystroke`. Extension-offer
  tests must drive visibility through the machine (trap-store query results +
  machine.onInput()), not show().
- test/widget-visibility.test.ts: fake editor + injected `query` seam +
  vi.useFakeTimers; `machine.onInput()` drive pattern; suppression battery
  :288-351 stays green (Escape taxonomy unchanged).
