# PRP — P4.M1.T1.S2: Ladder recursion, sibling-fork backspace recovery, fresh-generation battery (spec 09 widget bullet)

---

## Goal

**Feature Goal**: Implement the normative "Post-Tab extension offer" bullet from
spec 09 h2.59 (widget.test.ts) VERBATIM as a test battery — ladder recursion
(`implem` → Tab → `implement` → offer → Tab → … until the empty offer dismisses
WITHOUT suppression), sibling-fork backspace recovery, fresh-generation semantics,
menuDelayMs intent-show bypass, final-armed-word chain arming (spec 07 h2.53
amendment), trigger-char parity, Space self-close of the residual menu flash, and
Enter-still-submits — pinning the seam change + offer evaluation that
P4.M1.T1.S1 lands.

**Deliverable**: One new describe block appended to `test/widget.test.ts` (the
spec 09 battery, ~12 tests, names citing spec 09 h2.59 / 07 h3.11), reusing the
existing module-level doubles. NO new files. NO spec edits. NO production-code
changes — UNLESS the battery exposes a defect in S1's seam, in which case the fix
stays inside the S1 contract (see Implementation Blueprint, Task 0/Task 7).

**Success Definition**: The full battery is green; `test/defer-pi-menu.repro.test.ts`
and `test/widget-visibility.test.ts` stay green UNTOUCHED; `npm run check` +
`npm test` green — the output P3.M1.T2.S2's gauntlet consumes en route to the
P3.M1.T2.S3 scenario (iv) live smoke.

**NOTE on item-text references**: the work-item description cites "P3.M1.T1.S1" as
the landed seam input and "P4.M1.T2.S2/S3" as output consumers — both are stale
references. Per the task tree and the parallel-execution context: seam input =
**P4.M1.T1.S1**; gauntlet = **P3.M1.T2.S2**; live smoke = **P3.M1.T2.S3** (iv).
P4.M1.T2.S1 (fallback path) is a sibling, not an input. The deferral-state pinning
belongs to P3.M1.T1.S2, not this item.

## User Persona (if applicable)

**Target User**: the pi coding-agent user typing prompts with hapax installed.

**Use Case**: Repeated-Tab ladders through stored vocabulary
(`implem` → Tab → Tab → Tab…), recovering from a sibling-fork dead-end
(`implements` when `implementation` was wanted) with ONE backspace instead of
deleting the whole word.

**User Journey**: Type `implem`; Tab inserts `implement`; the extension offer
`implements | implementation` renders instantly; Tab inserts the top; when the
fork dead-ends (`implements` has no extensions) the line closes silently; ONE
backspace returns to `implement` and the offer re-renders; arrow→ or typing `a`
disambiguates toward `implementation`.

**Pain Points Addressed**: The owner-reported live wedge — mid-word recovery
after a Tab demanded deleting the ENTIRE word (suppression seam); the battery
pins the fix (spec 07 h3.11) so it can never silently regress.

## Why

- Spec 09 h2.59's widget bullet is the CONTRACT for P4.M1.T1.S1's seam change —
  without this battery the seam change ships unpinned (an implementation
  regression would be invisible).
- The ladder is the entire point of the 2026-10 progressive-completion ranking
  (04: shortest-first + exact-equal exclusion); the battery proves the ranking
  and the visibility machine compose as h3.11 specifies.
- Downstream: P3.M1.T2.S2's full gauntlet counts this battery green;
  P3.M1.T2.S3 scenario (iv) live-verifies the same behavior in a real TTY.

## What

Test-only work. The battery (all driven through the existing widget key-handling
doubles — `makeInsertHarness` + real seeded store, NOT `show()`-driven where
arming/painted records matter):

1. **Tab-accept arms NO suppression** — after a consumed Tab, the line either
   shows the extension offer or closes; `suppressUntilWordStart === false` always.
2. **Ladder recursion** — `implem` → Tab inserts `implement` → offer renders with
   exact-equal exclusion + shortest-first ordering (`implements | implementation`)
   → Tab inserts top → recursion until the empty offer dismisses WITHOUT
   suppression.
3. **Sibling-fork backspace recovery** — after the empty-offer dismiss, ONE
   backspace re-queries (fragment `implement`) and the offer re-renders.
4. **Escape/boundary on an offer suppresses rest-of-word** (seam retained — only
   Tab-accept left the seam).
5. **Fresh generation** — the offer resets `highlightIndex` to 0 and
   `interacted` to false; boundary pass-through (un-entered ↑/← forwards verbatim
   AND dismisses+suppresses on the same press) is live on the offer.
6. **menuDelayMs bypass (intent show)** — under a large `menuDelayMs` + fake
   timers, the offer paints in the Tab keypress with ZERO timer advancement.
7. **Extension accepts arm the chain on the FINAL accepted word** (spec 07 h2.53
   amendment — never armed at the first rung).
8. **Trigger-char completions take the same rule** (`#implem` → Tab → offer
   evaluates on the inserted word).
9. **Residual menu-flash self-closes on Space** (owner-accepted cost, h3.11).
10. **Enter immediately after a Tab completion still SUBMITS** — never accepts
    the offer.
11. Never-mutate (v1 regression pin) + one-clock-tick-per-keypress hold across
    the ladder.

### Success Criteria

- [ ] All ~12 battery tests green; every spec 09 h2.59 bullet sentence has ≥1 test.
- [ ] `test/defer-pi-menu.repro.test.ts` green VERBATIM (untouched file).
- [ ] `test/widget-visibility.test.ts` green UNTOUCHED.
- [ ] `npm run check` and `npm test` green.
- [ ] Any production fix forced by a red test stays within S1's mechanism and is
      documented in the test that forced it.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything needed
to implement this successfully?" — Yes: every test below is spelled out with its
exact fixture, keystroke sequence, buffer hand-mutations, and assertions; the
harness idioms (including the fake-inner-does-not-apply-keys trap) are quoted;
the S1 contract (what will already be landed) is summarized with its mechanism;
ladder determinism is derived fragment-by-fragment so the implementer can trust
the expected sets. Verified against HEAD `a618343`; line numbers drift — navigate
by quoted text.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: spec/09-testing-and-acceptance.md
  why: h2.59 widget.test.ts bullet "Post-Tab extension offer (2026-10, spec 07)"
    is the VERBATIM contract for this battery — every sentence maps to a test
    below. h2.61 live-verification technique (binding for UI changes; the
    formal gate is P3.M1.T2.S3, a sanity pass is recommended).
  pattern: the bullet's exact ordering — no-suppression, ladder, backspace
    recovery, Escape/boundary seam, fresh generation, menuDelayMs bypass,
    final-armed-word.
  gotcha: the battery is NORMATIVE for S1 — if a test is red, the production
    code is wrong, not the test (unless the fixture is demonstrably bad).

- file: spec/07-completion-ui.md
  why: h3.11 "Post-Tab extension offer" (the full rule incl. fork ruling +
    residual cost), h2.53 M2 chained completion (the final-armed-word amendment
    is its last bullet), h3.10 key handling (pass-through/Escape taxonomy),
    h3.12 visibility machine (R3 trailing-space close, R4 disqualification,
    R5 hesitation, R7 fresh-reopen).
  pattern: h3.11's ladder example and fork ruling; h2.53's parenthetical
    "implem → Tab → implement → Tab leaves armed(implementation), not
    armed(implement)".
  gotcha: h2.53's literal example predates the fork ruling — with BOTH
    'implements' and 'implementation' stored, shortest-first makes the second
    accept 'implements'. The NORM is "armed at the FINAL accepted word"; pin
    BOTH variants (Task 4, tests 7-8). Do NOT re-rank to match the example.

- file: plan/006_7bd0258da993/P4M1T1S1/PRP.md
  why: The CONTRACT for what will already be landed when this item starts —
    insertHighlighted's tail becomes state.hide() + visibility.onDismissed(false);
    the Tab-insert branch gains `applyVisibility(machine.onInput());
    requestRender();` BETWEEN the `if (!consumed) return forwardInput(data);`
    line and the enableChaining arm block; the seam comment lists only Escape /
    boundary / Enter-submit.
  pattern: S1's "Implementation Patterns & Key Details" walks the mechanism
    (onDismissed(false) = closeWith(now) → closeAt stamp → R7 fresh-reopen →
    immediate, hesitation-bypassed paint; exact-equal exclusion already in
    src/core/query.ts ~:592).
  gotcha: S1 also updates widget.test.ts (:960-971, :1089-area) and adds its own
    provisional battery — APPEND this battery at END of file and DEDUPE (keep
    an S1 test that already covers a bullet; add only missing cases; the union
    must be the complete bullet).

- file: test/widget.test.ts
  why: The doubles this battery MUST use (item contract: "Mocking: the existing
    widget key-handling doubles") + the assertion idioms.
  pattern: makeInsertHarness (~:852) — composed editor + fake buffer (buf is
    hand-mutatable + exposed) + press/show/requestRender/onKeystroke/setHits;
    spiedChain (~:1421) = {state: vi.fn(()=>null), arm: vi.fn(), reset: vi.fn()}
    (state null keeps the armed-chain consult INERT → pure query offers; arm
    call args are the assertion surface); seedStore (~:1428) — REAL CandidateStore
    via upsert, NO bigrams; flushPaint (~:1455) — 5 microtask turns flushing the
    W1 deferred machine tick after a FORWARDED keypress; the machine-painted
    Tab pattern at :1462-1491 (forwarded char + flushPaint to paint, then press
    "\t"); the Tab assertions at :960-975; Enter describe at :1200;
    never-mutate describe at :1250; typed-word arming describe at :2174 (real
    createChainMachine usage).
  gotcha: (1) show() writes state.set DIRECTLY — machine.painted() stays empty;
    any test needing REAL painted records (arming, offer-rec capture) MUST paint
    through a forwarded keystroke + flushPaint. (2) The fake inner does NOT
    apply typed/backspace keys to buf — simulate buffer state by hand-mutating
    h.buf.lines / h.buf.col BEFORE the press (established idiom). (3) A real
    chain machine is createChainMachine() from src/pi/provider.ts; chain.state()
    returns the armed word or null.

- file: test/widget-visibility.test.ts
  why: Machine-level battery that must stay green UNTOUCHED (close /
    disqualification / suppression-lapse); also the reference for R7 behavior
    ("a fresh close (<200 ms) reopens through the gate", :423) and chain-offer
    hesitation bypass (consult test (8), :761) — the mechanism that makes the
    offer paint immediately under menuDelayMs.
  gotcha: do NOT add S2 tests here — the 09 bullet lives in widget.test.ts.

- file: test/defer-pi-menu.repro.test.ts
  why: P3.M1.T1.S1's regression suite (Tab defers to pi's open stock menu) —
    the "contrast — unaffected" adjacent suite from the item contract. Must stay
    green VERBATIM; never edit it.
  gotcha: its harness seeds piMenuOpen via makeInsertHarness's opt-in knob.

- file: src/pi/widget.ts
  why: Read-only reference for what S1 landed: insertHighlighted tail (~:1462),
    the Tab-insert branch (~:1670-1818), the arm site, createVisibilityMachine's
    evaluate (lapse → R1 stock contexts → chain consult → match → R2 → query →
    R4-R7). getState() fields: visible, currentSet, suppressUntilWordStart.
  gotcha: WidgetState.set resets highlightIndex 0 + interacted false on every
    result-set change — the fresh-generation contract is free; assert it anyway.

- file: src/core/query.ts
  why: Read-only PROOF the expected offer sets are right: exact-equal exclusion
    `if (k === lower) continue;` (~:592 anchored; ~:646 tier-0 parity) + tier-3
    prefix matching + shortest-key-first ranking.
  gotcha: "implementation".startsWith("implements") === false — fragment
    "implements" yields ZERO matches when only implement/implements/
    implementation are stored. That emptiness is the ladder's terminal rung.
```

### Current Codebase tree (relevant excerpt)

```bash
src/pi/widget.ts              # S1's seam change lands here (read-only for S2)
src/core/query.ts             # exact-equal exclusion (read-only)
test/widget.test.ts           # 2299 lines — APPEND the battery here
test/widget-visibility.test.ts# stays green, untouched
test/defer-pi-menu.repro.test.ts  # stays green, untouched
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files.
test/widget.test.ts           # + one describe block (the spec 09 battery, end of file)
# (src/pi/widget.ts ONLY if a battery test exposes an S1 defect — minimal fix)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: the fake inner editor does NOT apply keys to the buffer. Typed
// state is simulated by hand-mutating h.buf.lines / h.buf.col BEFORE the
// press; a FORWARDED press (e.g. "x" or "\x7f") then ticks the machine via
// the W1 microtask (flushPaint), which reads the LIVE (hand-set) buffer.
// The Tab insert itself is REAL (setText mutates buf) — post-Tab buffer
// state needs NO hand-mutation.

// CRITICAL: paint through the machine, not show(). Any test whose Tab must
// capture a real record (arming, offer recursion — Tab2 reads painted()[0])
// needs machine.painted() populated: forwarded char + flushPaint first.
// show()-driven accepts are "vacuously never-arming" (test comment ~:937).

// CRITICAL: spiedChain().state() returns null → the machine's chain-consult
// branch is INERT → every ladder offer is the pure QUERY result. With a REAL
// chain machine (createChainMachine), seedStore records NO bigrams → the
// consult's topSuccessors is empty → branch (5) reset+fall-through → still a
// query offer, then the arm site re-arms. Deterministic either way.

// GOTCHA: vi.useFakeTimers freezes time → closeAt === now → the R7
// fresh-reopen window (<200 ms) is ALWAYS satisfied → the offer paints with
// ZERO timer advancement. That is exactly the intent-show proof; do not
// advance timers before asserting the offer.

// GOTCHA: rankMatches tier-3 = exact prefix, shortest key first, sessionCount
// only reorders same-tier. seedStore gives every entry count 1 → ordering is
// length-then-byte-lex: implement(9) < implements(10) < implementation(14).

// GOTCHA: fragment floors — "implem"(6) and "implement"(9) are well above
// the 3-char fragment floor; store-seeded keys bypass admission entirely
// (upsert is store-level).

// GOTCHA: the never-mutate proxy trap (setHits) throws on ANY inner mutation
// attempt — assert h.setHits() === 0 after the multi-Tab ladder.

// GOTCHA: onKeystroke ticks EXACTLY ONCE per keypress (consumed Tab ticks in
// the widget layer; forwarded keys tick via the guard seam) — a 2-Tab ladder
// + 1 backspace + 1 space = 4 presses = 4 ticks. Assert in one battery test.
```

## Implementation Blueprint

### Data models and structure

None. Test-only. No types, no config, no store changes.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY the S1 seam is landed (read-only sanity)
  - READ src/pi/widget.ts: insertHighlighted's success tail must read
    state.hide() + visibility.onDismissed(false) (NOT true); the Tab-insert
    branch must call applyVisibility(machine.onInput()) + requestRender()
    between the `if (!consumed) return forwardInput(data);` line and the
    enableChaining arm block.
  - RUN: npx vitest run test/widget.test.ts — S1's updated :960-971/:1089
    assertions + its provisional battery must already be green. If S1 is NOT
    landed, STOP and report (do not implement S1 yourself).

Task 1: ADD test/widget.test.ts — the battery describe (END of file, ~:2299)
  - NAMING: describe("widget key handling — Post-Tab extension offer battery
    (spec 09 h2.59 / 07 h3.11)", ...). Test names cite the bullet sentence.
  - PLACEMENT: append after the last describe (typed-word arming, :2174-2299);
    S1 edits mid-file in parallel — end-append avoids conflicts.
  - FIXTURE (shared by most tests):
      const h = makeInsertHarness({ lines: ["implem"], line: 0, col: 6 },
        { chain: spiedChain(),
          store: seedStore([
            ["implement", "implement"],
            ["implements", "implements"],
            ["implementation", "implementation"],
          ]) });
      h.press("x");            // forwarded char ticks the machine (W1)
      await flushPaint();      // machine paints query("implem") → top "implement"

Task 2: Battery tests 1-3 — no-suppression + the ladder + fork recovery
  - TEST 1 "Tab-accept arms NO suppression (the first rung)":
    after the fixture, sanity machine.getState().visible === true and
    painted()[0].key === "implement"; press "\t" → assert:
    h.buf.lines ["implement"]; innerCalls []; machine.getState().visible TRUE;
    currentSet displays ["implements", "implementation"] (exact-equal excluded
    "implement"; shortest-first); suppressUntilWordStart FALSE;
    state.highlightIndex 0; state.interacted false; requestRender called.
  - TEST 2 "the ladder recurses to the EMPTY offer which dismisses WITHOUT
    suppression": continue from test 1's state (second press "\t"): buf
    ["implements"]; visible FALSE (query("implements") is empty —
    "implementation" is not a prefix extension); suppressUntilWordStart FALSE
    (disqualification close, NOT suppression); chain.arm last call arg
    "implements". Optional 3-rung variant: seed ["implement","implements",
    "implementable","implementation"] and walk one more rung.
  - TEST 3 "sibling-fork recovery: backspace after the empty-offer dismiss
    re-queries": from test 2's end state — h.buf.lines = ["implement"];
    h.buf.col = 9; press "\x7f" (forwards verbatim — assert innerCalls
    ["\x7f"]); await flushPaint() → machine visible again, currentSet
    displays ["implements", "implementation"], suppressUntilWordStart FALSE.
    Optional tail: type "a" (buf ["implementa"], press "a", flushPaint) →
    narrows to ["implementation"] (h3.11 "type-ahead disambiguates").

Task 3: Battery tests 4-5 — seam retained + fresh generation
  - TEST 4 "Escape on the offer is an explicit dismissal (rest-of-word
    suppressed, seam retained)": from test 1's state (offer visible,
    UN-ENTERED) press "\x1b" → Escape forwards VERBATIM (un-entered) AND
    dismisses+suppresses: innerCalls ["\x1b"], visible false,
    suppressUntilWordStart TRUE; then buf ["implementation"] (hand-set),
    press "x", flushPaint → STAYS hidden (rest-of-word suppression).
  - TEST 5 "boundary pass-through on the offer (fresh generation is live)":
    from test 1's state press the ↑/← byte(s) the existing boundary tests at
    :543 use → forwards verbatim AND dismisses+suppresses on the same press
    (assert like :551-571), proving interacted === false on the offer. Also
    the highlight-reset half of "fresh generation": BEFORE the Tab, press
    the RIGHT arrow once (highlightIndex 1, interacted true — mirror
    :519/:622 idioms), THEN Tab inserts items[1] ("implements") — use the
    3-rung store variant so a non-empty offer exists post-Tab: assert
    highlightIndex 0, interacted false (set() reset the generation).

Task 4: Battery tests 6-9 — menuDelayMs bypass + final-armed-word + trigger
  - TEST 6 "menuDelayMs bypass (intent show)": vi.useFakeTimers; harness over
    { config: cfg({ menuDelayMs: 5000 }), store: ladderStore }; paint the
    pre-Tab set via forwarded char + flushPaint + advanceTimersByTime(5000)
    (or show(["implement", ...]) — acceptable here: no arming assertion in
    this test); press "\t" → the offer (query("implement") set) is VISIBLE
    IMMEDIATELY — assert with ZERO further timer advancement.
  - TEST 7 "extension accepts arm the chain on the FINAL accepted word
    (h2.53) — fork variant": spiedChain; the 2-Tab ladder → arm call SEQUENCE
    exactly ["implement", "implements"]; the LAST call is "implements" —
    never a stale "implement". Real-machine variant: over { chain:
    createChainMachine() } imported from src/pi/provider.ts (pattern: the
    :2174 describe) → after the ladder chain.state() === "implements".
  - TEST 8 "h2.53 literal variant": seedStore([["implement","implement"],
    ["implementation","implementation"]]) (no "implements") → 2-Tab ladder
    ends arm("implementation") — the spec's parenthetical example verbatim.
  - TEST 9 "trigger-char completion (#implem → Tab) takes the same rule":
    harness lines ["#implem"], col 7; forwarded char + flushPaint (trigger
    mode query paints; top "implement"); press "\t" → buf ["implement"]
    (trigger consumed), offer renders ["implements", "implementation"],
    no suppression, arm at "implement" (trigger completions arm — h2.53).

Task 5: Battery tests 10-12 — Space self-close + Enter-submits + invariants
  - TEST 10 "residual menu-flash self-closes on Space": from test 1's state
    (offer visible, buf ["implement"]) — h.buf.lines = ["implement "];
    h.buf.col = 10; press " " → forwarded verbatim; flushPaint → visible
    FALSE (R3 trailing-space close), suppressUntilWordStart FALSE.
  - TEST 11 "Enter immediately after a Tab completion still SUBMITS (never
    accepts the offer)": from test 1's state press "\r" → mirrors the Enter
    describe (:1200) assertions: innerCalls ["\r"] (delegated exactly once),
    buf STILL ["implement"] (never "implements"/"implementation" — the offer
    was NOT accepted), state hidden; suppression per the existing Enter
    test's taxonomy assertion (Enter-submit is a seam member — follow
    whatever :1200 asserts; the buffer + delegation assertions are the
    load-bearing ones here).
  - TEST 12 "invariants across the ladder: never-mutate + one tick per
    press": run the 2-Tab + backspace + space sequence; assert
    h.setHits() === 0 and h.onKeystroke toHaveBeenCalledTimes(4) (one tick
    per keypress: consumed Tabs tick in the widget layer, forwarded keys via
    the guard seam — never both).

Task 6: DEDUPE against S1's provisional battery + run the gauntlet
  - If an S1-added test already covers a bullet sentence exactly, keep ONE
    (prefer the more complete; merge assertions). The UNION must cover every
    bullet sentence — do not delete coverage while deduping.
  - npx vitest run test/widget.test.ts test/widget-visibility.test.ts
    test/defer-pi-menu.repro.test.ts  → all green.
  - npm run check && npm test → green (this is P3.M1.T2.S2's input).

Task 7 (CONTINGENCY — only if a battery test is RED against S1's code):
  - Diagnose: is the fixture wrong (fix the test) or the seam wrong (fix
    widget.ts)? The battery is normative; a correct fixture exposing red
    means S1's implementation deviates from its PRP contract.
  - Fix ONLY within the S1 mechanism: onDismissed(false) close + synchronous
    machine.onInput() + eval-BEFORE-arm ordering (re-read S1's PRP "Known
    Gotchas": ordering, no second clock tick, no microtask routing). No new
    machine API, no intent flag, no re-ranking. Document the deviation in a
    short comment on the forcing test.
  - Re-run the FULL suite (widget-visibility + defer-pi-menu must stay green).

Task 8: RECOMMENDED live sanity (formal gate is P3.M1.T2.S3's, not yours)
  - tmux + pi --no-session; seed "implement implementation implements" via
    one submitted message; send-keys ONE CHAR AT A TIME (0.08-0.12 s sleeps —
    bursts cancel in-flight queries); walk 'implem' → Tab → Tab; backspace;
    capture-pane to confirm the offer/close/recovery sequence matches the
    battery. UI-layer change law (spec 09 h2.61) is formally discharged by
    P3.M1.T2.S3 scenario (iv) — record any discrepancy as a note; do not
    expand scope.
```

### Implementation Patterns & Key Details

```typescript
// THE CANONICAL LADDER TEST (the battery's spine — others vary on it):
it("the ladder: implem → Tab → offer (implements | implementation) → Tab → \
the EMPTY offer dismisses WITHOUT suppression (spec 09 h2.59 / 07 h3.11)", async () => {
  const chain = spiedChain();
  const h = makeInsertHarness({ lines: ["implem"], line: 0, col: 6 }, {
    chain,
    store: seedStore([
      ["implement", "implement"],
      ["implements", "implements"],
      ["implementation", "implementation"],
    ]),
  });
  h.press("x");                 // forwarded tick — machine reads buffer "implem"
  await flushPaint();           // paints query("implem"): top "implement" (tier 3, shortest)
  expect(h.machine.painted()[0]?.key).toBe("implement"); // fixture sanity

  h.press("\t");                // RUNG 1 — synchronous, no timer advancement
  expect(h.buf.lines).toEqual(["implement"]);
  expect(h.machine.getState().visible).toBe(true);            // the extension offer
  expect(h.machine.getState().currentSet.map((i) => i.display))
    .toEqual(["implements", "implementation"]);  // exact-equal out; shortest-first
  expect(h.machine.getState().suppressUntilWordStart).toBe(false); // NO suppression
  expect(h.state.highlightIndex).toBe(0);        // fresh generation…
  expect(h.state.interacted).toBe(false);        // …reset + un-entered

  h.press("\t");                // RUNG 2 — accepts the offer top ("implements")
  expect(h.buf.lines).toEqual(["implements"]);
  expect(h.machine.getState().visible).toBe(false);   // query("implements") = []
  expect(h.machine.getState().suppressUntilWordStart).toBe(false); // close, not seam
  expect((chain.arm as Mock).mock.calls.at(-1)?.[0]).toBe("implements"); // FINAL word
});

// THE FORK-RECOVERY TAIL (append inside the same or a sibling test):
  h.buf.lines = ["implement"];  // hand-mutate — the fake inner applies no keys
  h.buf.col = 9;
  h.press("\x7f");              // backspace forwards verbatim (line hidden)
  expect(h.innerCalls).toEqual(["\x7f"]);
  await flushPaint();           // W1 tick reads "implement" → offer re-renders
  expect(h.machine.getState().visible).toBe(true);
  expect(h.machine.getState().currentSet.map((i) => i.display))
    .toEqual(["implements", "implementation"]);
  expect(h.machine.getState().suppressUntilWordStart).toBe(false);

// WHY the expected sets are RIGHT (do not "fix" them in review):
// - query("implem")  → tier-3 prefix of all three keys; length order:
//   implement(9) < implements(10) < implementation(14); counts all 1.
// - query("implement") → exact-equal exclusion drops "implement"
//   (src/core/query.ts `if (k === lower) continue;`); "implements" and
//   "implementation" are tier-3 prefix matches → [implements | implementation].
// - query("implements") → exact-equal drops "implements";
//   "implementation".startsWith("implements") === FALSE ('a' ≠ 's' at
//   index 8) → ZERO matches → R4 disqualification close (no suppression).
// - The offer paints immediately under fake timers because closeAt === now
//   (time frozen) → R7 fresh-reopen window always satisfied.
```

### Integration Points

```yaml
NONE — no config, no store, no provider, no index.ts, no spec edits.
Sibling contracts:
- P4.M1.T1.S1 (input): its PRP is the contract; verify landed (Task 0).
- P4.M1.T2.S1 (fallback path): do NOT touch src/pi/provider.ts or its tests.
- P3.M1.T1.S2 (deferral pinning): do NOT claim its work; defer-pi-menu stays
  green verbatim.
- P3.M1.T2.S2 (output consumer): expects npm run check + npm test green.
- P3.M1.T2.S3 (formal live smoke, scenario iv): verifies this behavior live.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check        # tsc — zero errors (test files are typechecked too)
# Expected: clean. Type errors in the new describe mean wrong double shapes —
# re-read the spiedChain/seedStore signatures quoted above.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run test/widget.test.ts                # the battery — all green
npx vitest run test/widget-visibility.test.ts     # untouched, stays green
npx vitest run test/defer-pi-menu.repro.test.ts   # untouched, stays green
npm test                                          # full suite
# Expected: all green. A red battery test: Task 7 contingency (diagnose
# fixture vs seam — the battery is normative; never weaken an assertion to
# pass; never delete coverage while deduping).
```

### Level 3: Integration Testing (Live TTY — recommended sanity; formal gate is P3.M1.T2.S3)

```bash
# spec/09 h2.61 technique (pi needs a real TTY; piping stdout exits silently):
tmux new-session -d -s hapax 'pi --no-session'
# Seed vocabulary: submit one short user message: "implement implementation implements"
tmux send-keys -t hapax 'implement implementation implements' Enter; sleep 2
tmux send-keys -t hapax C-c          # end the turn
# Walk the ladder ONE CHAR AT A TIME (0.08-0.12 s sleeps between keys):
tmux send-keys -t hapax 'i' 'm' 'p' 'l' 'e' 'm'   # with per-key sleeps
tmux capture-pane -t hapax -p                     # pre-Tab offer visible
tmux send-keys -t hapax Tab; tmux capture-pane -t hapax -p   # implement + offer
tmux send-keys -t hapax Tab; tmux capture-pane -t hapax -p   # implements + close
tmux send-keys -t hapax BSpace; tmux capture-pane -t hapax -p # offer re-renders
# Discrepancies vs the battery → note in the report; the BINDING live gate
# (scenario iv) is P3.M1.T2.S3's deliverable, not this item's.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Not applicable: test-only change; no network/persistence/telemetry paths
# touched; no performance surface changed (the offer's one synchronous query
# is S1's concern and is within the spec 02 h2.18 budget by construction).
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean
- [ ] `npm test` green (full suite)
- [ ] `test/defer-pi-menu.repro.test.ts` green VERBATIM (file untouched)
- [ ] `test/widget-visibility.test.ts` green UNTOUCHED
- [ ] No changes outside test/widget.test.ts (+ contingency-only src/pi/widget.ts)

### Feature Validation (every spec 09 h2.59 bullet sentence has a green test)

- [ ] Tab-accept arms NO suppression (offer AND close cases)
- [ ] Ladder: exact-equal exclusion + shortest-first offer; recursion to the
      empty offer; empty offer dismisses WITHOUT suppression
- [ ] Backspace after the empty-offer dismiss re-queries → offer re-renders
- [ ] Escape/boundary on an offer suppresses rest-of-word (seam retained)
- [ ] Fresh generation: highlight reset + pass-through live (un-entered)
- [ ] menuDelayMs bypass (intent show; zero timer advancement)
- [ ] Extension accepts arm the chain on the FINAL accepted word (fork variant
      + h2.53 literal variant)
- [ ] Trigger-char completion (#implem → Tab) takes the same rule
- [ ] Residual menu-flash self-closes on Space
- [ ] Enter immediately after a Tab completion still submits (never accepts)
- [ ] Never-mutate + one-tick-per-keypress hold across the ladder

### Code Quality Validation

- [ ] Test names cite spec 09 (h2.59) and spec 07 (h3.11/h2.53) sections
- [ ] Battery uses the existing doubles (makeInsertHarness / seedStore /
      spiedChain / flushPaint / cfg) — no new harness machinery
- [ ] Machine-painted (not show()-driven) wherever arming/painted() matters
- [ ] No assertion weakened to achieve green; any S1 deviation documented

### Documentation & Deployment

- [ ] None needed: test-only; no env vars, no config surface, no spec drift
      (spec half landed in 6799367; S1 ships the code half; this pins it)

---

## Anti-Patterns to Avoid

- ❌ Don't drive arming/offer tests with show() — painted() stays empty; the
  offer recursion and chain arming are vacuous. Paint via forwarded key +
  flushPaint.
- ❌ Don't hand-mutate the buffer where the Tab insert already did it — the
  insert is REAL (setText); only typed/backspace/space effects need hand-set buf.
- ❌ Don't re-rank or reorder expected offer sets to match a failing run — the
  expected sets are derived (exact-equal + shortest-first); a mismatch is a
  seam bug (Task 7), not a fixture bug.
- ❌ Don't interpret h2.53's "armed(implementation)" literally when BOTH
  siblings are stored — shortest-first (fork ruling) makes the final word
  "implements"; the amendment's norm is arm-at-FINAL-accepted-word. Pin both.
- ❌ Don't add tests to widget-visibility.test.ts or touch defer-pi-menu —
  the 09 bullet lives in widget.test.ts; the adjacent suites are contrast pins.
- ❌ Don't advance fake timers before asserting the offer's immediacy — the
  zero-advancement assert IS the menuDelayMs-bypass proof.
- ❌ Don't spawn production changes beyond S1's mechanism if tests go red —
  no new machine API, no intent flags, no provider.ts edits.
- ❌ Don't skip dedupe against S1's provisional battery, and don't delete
  coverage while deduping — the union must be the complete bullet.

---

**Confidence Score: 9/10** — the battery is fully specified with deterministic
fixtures derived from the query core's actual rules; the one residual risk is
S1's parallel implementation differing from its PRP contract, which Task 0's
verification gate and Task 7's bounded contingency cover.
