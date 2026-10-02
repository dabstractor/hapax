# PRP — P1.M1.T1.S3 (plan 005): widget.test.ts battery rewrite to the v2 model (spec/09 bullets)

---

## Goal

**Feature Goal**: Rewrite test/widget.test.ts's key-handling battery to
the 2026-10 arrow-interaction model v2 (spec/07 h3.9 + spec/09 widget
bullets): one-press boundary pass-through with caret-move parity, the
interaction carousel (clamp retired), fresh-generation resets, unchanged
Escape/Tab/Enter semantics, the never-mutate pin, width-truncation
navigation over the RENDERED count, and input-clock single-tick
observables — enumerating every state×key cell of the v2 table. This is
the acceptance battery for S1 (decision table + flag) and S2 (wiring).

**Deliverable**: Rewritten describes in `test/widget.test.ts` —
navigation/width-truncation (~:470), boundary-pass-through (replacing
the boundary-Esc describe :526 and clamp describe :558), input-clock
(~:631), full-scenario never-mutate (:967), pure decision-table
(:986–1057; S1 may have already rewritten these — VERIFY, then keep or
extend), and the file-header model blurb (:14–20). Zero source changes.

**Success Definition**: `npx vitest --run test/widget.test.ts` green;
full `npm test` + `npm run check` green; every (a)–(h) contract bullet
below is a passing test; no old-model title/comment mentioning
boundary-Esc, clamp, "press CONSUMED", or "caret unmoved" survives.

## Why

Spec/07 h3.9 (adopted ahead of implementation) replaced the consumed
boundary-Esc/clamp model with one-press plain-pi parity and a carousel —
the existing battery actively pins the RETIRED behavior (e.g. ":527
press CONSUMED (no inner call — caret unmoved)", ":507 clamps at 1",
clamp describe :558). S1/S2 land the code; the spec-maintenance policy
requires the test suite to pin the shipped model exactly, and the suite
counts feed P1.M2.T1.S2's gauntlet record.

## What

Test-only. All cases use the existing `makeKeyHarness` (recording
inner, never-mutate pin, real visibility machine + emptyStore,
`press()`, `show()`, `state.hidden` widened, suppression read via
`machine.getState().suppressUntilWordStart`, flag read via
`state.interacted` — S1 exposes it on the public WidgetState
interface). Key constants UP/DOWN/LEFT/RIGHT/ESC ~:415.

### Battery (a)–(h) — one describe group per contract bullet

**describe: boundary pass-through (one-press plain-pi parity; spec/07
h3.9 + invariant 1)**

(a) ↑ and ← on the FIRST word of an UN-interacted multi-word line —
for each key, fresh harness:
- `h.innerCalls` === [key] (verbatim forward — the caret moves on that
  same press; parity asserted BY the forward, since the recording inner
  has a fixed cursor)
- `h.state.hidden` === true
- `machine.getState().suppressUntilWordStart` === true (pass-through IS
  an explicit dismissal)
- `h.state.interacted` stays false (pass-through never sets the flag)
- `h.state.highlightIndex` === 0
- Tick (assert here or defer to the clock describe): `h.onKeystroke`
  called exactly ONCE total for the press (the guard's delegation
  seam — NOT a widget-layer tick plus a forward tick).

(b) → and ↓ on a ONE-WORD un-interacted line: forwarded verbatim
(`innerCalls` [key], return value `inner:${key}`), line STAYS visible
(`hidden` false), NO suppression, flag stays false.

**(fold into the navigation describe): entering + carousel**

(c) entering: →/↓ on an un-interacted multi-word line →
highlightIndex 1 AND `state.interacted` === true; press consumed
(`innerCalls` []); line stays visible; interior arrows navigate ±1.

(d) carousel (after interaction): from a multi-word interacted line —
- ↑/← at index 0 wraps to the LAST rendered index
  (2 for a 3-word line)
- →/↓ at the last index wraps to 0
- interior arrows move ±1
- every navigate/escape press consumed (`innerCalls` [] across the
  whole sequence), line never hides, never suppresses
- NO clamp case anywhere (grep the file: no "clamp" in key-handling
  titles/comments)

(e) fresh generations: after navigating (flag true),
`h.show(newDisplays)` → highlightIndex 0 AND `interacted` false AND a
boundary ↑/← pass-through works again (dismiss + forward + suppress);
also: a one-word line NEVER becomes interacted (press ↓ → forwarded,
flag still false, then ↑ → boundary pass-through STILL fires because
the generation never entered).

(f) Escape unchanged at every state: un-interacted, interacted,
interior index, single-word — line hides, suppress arms, consumed.
Plus the v2-full-scenario never-mutate rewrite (:969): KEEP the
`setHits() === 0` pin, update the scenario steps to v2 (navigate,
wrap, boundary pass-through forward, re-show fresh generation, Escape,
render) and keep `innerCalls.length > 0` (forwarding lived). Tab
synchronous insert / Enter dismiss-then-forward: existing describes
already v2-neutral — leave them, but add ONE case asserting Tab/Enter
ignore the interaction state (Tab inserts while interacted at a
non-zero highlight inserts THAT word — use makeInsertHarness if state
driving is easier; keep it minimal, the insert battery already owns
depth).

(g) width truncation (rewrites the :507 it): 3 items at width 16 →
`editor.render(16)` shows 2; first → lands highlightIndex 1 (the
rendered end) AND sets the flag; a further →/↓ WRAPS to 0 (modular
over the RENDERED count); ↑/← at 0 wraps back to 1; all consumed.

**describe: input clock (exactly one tick per keypress; rewrites ~:631)**

(h) - consumed navigate (multi-word →/↓): `onKeystroke` exactly 1
  total, line stays visible (machine not ticked into closing — the
  emptyStore disqualification shape)
  - consumed escape: 1 total
  - boundary pass-through press: 1 TOTAL (cannot distinguish layers —
    same observable shape as enter-submit/forward) AND `innerCalls`
    contains the verbatim data
  - one-word un-interacted →/↓ forward: 1 total + innerCalls [key]
  - across a mixed sequence the count equals the number of presses
    (no double-tick anywhere)

### Pure decision-table describe (:986–1057)

S1's PRP already rewrites these to the v2 table (11 rows, `interacted`
param). VERIFY against S1's landed shape; if S1's version is present
and pins rows 0–10, KEEP it and only ensure the call signature matches
(`decideWidgetKey(key, visible, count, highlightIndex, interacted,
keybindings?)`). If stale (4-arg calls, boundary-esc/clamp
expectations), rewrite per S1's PRP table — including the stale-index
case (row 8: un-interacted i>0 degrades to navigate, NEVER forward) and
the single-item case (↑/← → boundary-pass-through; →/↓ → forward).

### Header blurb (:14–20, Mode A)

Rewrite the model prose: while the line is visible the proxy consumes
the four arrows and Escape — but arrows are consumed only once the list
is ENTERED (first highlight-moving press marks the generation
interacted; from then on edges wrap carousel-style); on an un-entered
line ↑/← at the first word passes through verbatim (dismiss + suppress
+ the caret moves on the same press) and →/↓ with nothing to navigate
forwards with the line staying; Tab inserts synchronously, Enter
dismiss-then-forwards; every other key forwards verbatim.

### Success Criteria

- [ ] (a) pass-through: forward + hide + suppress + flag-unset + one tick
- [ ] (b) one-word →/↓: forward, line stays, no suppress, flag unset
- [ ] (c) entering moves +1 and sets the flag, consumed
- [ ] (d) carousel wraps both edges over the RENDERED count; no clamp
      cases remain (grep: no `clamp`/`boundary-Esc`/`caret unmoved`/
      `press CONSUMED` in titles/comments — except historical grep
      false-friends noted in research)
- [ ] (e) set() resets highlightIndex + flag and re-arms pass-through;
      one-word line never becomes interacted
- [ ] (f) Escape at every state; never-mutate pin kept (setHits 0);
      Tab/Enter unaffected by the flag
- [ ] (g) width-truncation: rendered-end entry then wrap
- [ ] (h) exactly one tick per press across all classes
- [ ] Decision-table describe matches S1's v2 signature/table
- [ ] Header blurb updated; `npx vitest --run test/widget.test.ts`
      green; `npm test` + `npm run check` green
- [ ] Chain-arming matrix, suppression-taxonomy, forward-verbatim,
      insert/Tab/Enter, and rendering describes untouched

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have
everything needed to implement this successfully?" — Yes: every block
to rewrite is located with its current contents summarized, the
harness API and its quirks (emptyStore disqualification shape, W1
microtask flush, structural `hidden` widening) are documented, the
S1/S2 contracts are stated precisely, and the full expected-observable
matrix is tabulated in the research notes.

### Documentation & References

```yaml
- file: test/widget.test.ts
  why: The ONLY file to modify. Verified map (see research notes for
        line anchors): header blurb :3–33 (model prose ~:16–20);
        makeKeyHarness :~427–466; navigation/width describe :~470;
        boundary-Esc describe :526 (its :527–541, single-item :542–556);
        clamp describe :558–:574; suppression-taxonomy :~577–605 (KEEP);
        forward-verbatim :~607–630 (KEEP); input-clock :~631–650
        (REWRITE); Tab/Enter/insert describes + makeInsertHarness
        (KEEP); full-scenario never-mutate :967–985 (KEEP pin, update
        steps); decision-table :986–1057 (verify vs S1); chain-arming
        matrix at file tail (KEEP — its comment forbids show()-driven
        arming cases).
  pattern: follow the suite's existing style — for..of over [UP, LEFT]
    with `key ${JSON.stringify(key)}` messages; fresh harness per key;
    assertions on state.hidden / highlightIndex / interacted /
    machine.getState().suppressUntilWordStart / innerCalls / setHits().
  gotcha: after a FORWARDED press, machine state settles on a
    microtask — `await Promise.resolve()` (W1) before asserting
    machine-derived state (existing pattern :~590); boundary
    pass-through asserts hidden/suppress through the WIRING
    synchronously (state.hide() + onDismissed(true) happen in-line).

- file: src/pi/widget.ts (READ-ONLY)
  why: The contract under test. Post-S1/S2: WidgetState.interacted
    (public; init false; reset in set() and hide()); decideWidgetKey
    v2 signature (data, visible, count, highlightIndex, interacted,
    keybindings?) — union navigate{delta}/boundary-pass-through/escape/
    tab-insert/enter-submit/forward; wiring: pass-through branch =
    enter-submit shape (hide + onDismissed(true) + forwardInput BEFORE
    the consumed-tick block ⇒ one total tick), navigate applies
    ((i+delta)%n+n)%n over the RENDERED count and sets interacted.
  gotcha: if a battery case fails because SOURCE misbehaves, that is
    an S1/S2 bug — report it; never weaken the test.

- docfile: plan/005_f9498a2d63d5/P1M1T1S1/PRP.md
  why: S1's decision table (rows 0–10), flag semantics, call-shape
    change, and the S1/S3 test-split (S1 rewrote the decision-table
    describes + minimally fixed affected ones; S3 owns THIS exhaustive
    battery — verify what S1 already changed before rewriting).

- docfile: plan/005_f9498a2d63d5/P1M1T1S2/PRP.md
  why: S2's wiring contract (branch shapes, tick seams, interacted
    set-on-navigate, row-3 line-stays-forward) — the observables the
    battery pins.

- docfile: plan/005_f9498a2d63d5/architecture/system_context.md
  why: §'Test harness' (makeKeyHarness anatomy), §'Tick seams',
    §'Suppression seam', §'CRITICAL pitfall — wrap vs the navigate
    clamp' (modular index), §'grep inventory' (clamp false-friends:
    config.ts clampNumber, render-path clamp, decision stale-index
    clamp :1007 stays).

- prd: spec/07 h3.9 (authoritative v2 model — full text in the
    selected PRD content above); spec/09 h2.55 widget key-handling
    bullet (the battery this PRP enumerates); spec/02 h2.2 invariant 1.
```

### Current Codebase tree (relevant excerpt)

```bash
test/widget.test.ts   # the ONLY file modified (battery rewrite + header blurb)
src/pi/widget.ts      # read-only contract (S1/S2 landed)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: do NOT touch the chain-arming matrix at the file tail or
// drive any arming case with show() — that suite has its own contract
// comment; this battery is key-handling only.
// CRITICAL: makeKeyHarness's emptyStore means any FORWARDED key makes
// the machine close the line on the next tick WITHOUT suppressing —
// that's the disqualification shape; boundary pass-through's hide is
// the WIRING's synchronous hide + onDismissed(true), asserted
// immediately (no microtask needed for the pass-through assertions;
// needed only when asserting machine-tick side effects of forwards).
// GOTCHA: interacted is set by the WIRING on navigate, never by
// pass-through/Tab/Enter — battery asserts the flag after each class.
// GOTCHA: wrap math runs over the RENDERED count (width truncation),
// not items.length — case (g) pins this.
// GOTCHA: grep false-friends for "clamp": config.ts clampNumber,
// render-path clamp, the decision's stale-index clamp (:1007, KEEP) —
// only key-handling titles/comments must be purged.
// GOTCHA: the onKeystroke counter cannot distinguish widget-layer vs
// guard-seam ticks — assert TOTAL===presses plus innerCalls evidence.
// GOTCHA: S1 may have already rewritten the decision-table describes;
// verify before rewriting (avoid duplicate/conflicting describes).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY preconditions
  - RUN: npx vitest --run test/widget.test.ts
  - IF S1/S2 landed: old-model describes FAIL (expected). Check which
    describes S1 already rewrote (decision-table especially) — extend,
    don't duplicate. IF decideWidgetKey still takes 4 args / boundary-esc
    exists in src: STOP and report (source not landed).

Task 1: REWRITE boundary + navigation describes (:470–574)
  - REPLACE boundary-Esc describe (:526) + clamp describe (:558) with
    the boundary-pass-through describe: cases (a), (b), (e)-re-arm part
  - REWRITE navigation describe (:470): two-way walk (now with flag
    assertions), case (c) entering, case (d) carousel (both edges,
    interior), case (g) width-truncation (rendered-end entry, wrap)

Task 2: REWRITE input-clock describe (~:631)
  - case (h): navigate 1 tick, escape 1 tick, pass-through 1 tick TOTAL
    + innerCalls verbatim, one-word forward 1 tick, mixed-sequence
    count === presses

Task 3: UPDATE full-scenario never-mutate (:967) + Escape battery (f)
  - KEEP setHits()===0; v2 steps; Escape at every state; Tab/Enter
    flag-independence one-liner

Task 4: VERIFY decision-table describe (:986–1057) vs S1's landed table
  - extend only if a row is missing (esp. row 8 degrade + single-item)

Task 5: HEADER BLURB (:14–20) + sweep
  - rewrite model prose; grep purge: "boundary-Esc", "clamp",
    "press CONSUMED", "caret unmoved" in key-handling titles/comments

Task 6: FULL VALIDATION
  - npx vitest --run test/widget.test.ts
  - npm test && npm run check
  - RECORD the passing widget-suite count for P1.M2.T1.S2 (report, not
    in the file)
```

### Implementation Patterns & Key Details

```ts
// (a) the canonical pass-through case — copy this shape for every cell:
it("↑/← on the first word of an un-entered line: line dismisses + suppresses AND the press forwards verbatim (one press, plain-pi parity)", () => {
  for (const key of [UP, LEFT]) {
    const h = makeKeyHarness();
    h.show(["alpha", "beta", "gamma"]); // fresh generation, interacted=false
    const out = h.press(key);
    expect(h.innerCalls, `key ${JSON.stringify(key)}`).toEqual([key]); // caret moves THIS press
    expect(out, `key ${JSON.stringify(key)}`).toBe(`inner:${key}`);
    expect(h.state.hidden, `key ${JSON.stringify(key)}`).toBe(true);
    expect(h.machine.getState().suppressUntilWordStart, `…`).toBe(true);
    expect(h.state.interacted).toBe(false); // pass-through never enters
    expect(h.onKeystroke).toHaveBeenCalledTimes(1); // ONE total — guard seam
  }
});

// (d) carousel: entering first (multi-word), then wrap both edges
it("carousel after interaction: edges wrap end-to-end, all consumed", () => {
  const h = makeKeyHarness();
  h.show(["alpha", "beta", "gamma"]);
  h.press(DOWN);                       // enter → i=1, flag set
  expect(h.state.interacted).toBe(true);
  h.press(RIGHT);                      // i=2 (last)
  h.press(RIGHT);                      // wrap → 0
  expect(h.state.highlightIndex).toBe(0);
  h.press(UP);                         // wrap → 2 (last)
  expect(h.state.highlightIndex).toBe(2);
  expect(h.innerCalls).toEqual([]);    // every navigate consumed
  expect(h.state.hidden).toBe(false);
  expect(h.machine.getState().suppressUntilWordStart).toBe(false);
});

// (g) width truncation: rendered count drives the wrap
it("3 items at width 16 render 2; entering reaches the rendered end, further →/↓ wraps to 0", () => {
  const h = makeKeyHarness();
  h.show(["Zendesk", "zephyr", "zlock"]);
  expect((h.editor.render as (w: number) => string[])(16))
    .toEqual(["hello", "Zendesk | zephyr"]);
  h.press(RIGHT);
  expect(h.state.highlightIndex).toBe(1); // rendered end; flag set
  expect(h.state.interacted).toBe(true);
  h.press(RIGHT);
  expect(h.state.highlightIndex).toBe(0); // wrap over n=2
  expect(h.innerCalls).toEqual([]);
});
```

### Integration Points

```yaml
NONE: test-only + header-comment prose. No src/, spec/, README changes
  (README sweep is P1.M2.T1.S1; gauntlet/DoD is P1.M2.T1.S2/S4).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # zero errors
```

### Level 2: The battery (the deliverable)

```bash
npx vitest --run test/widget.test.ts
npx vitest --run test/widget.test.ts -t "pass-through"
npx vitest --run test/widget.test.ts -t "carousel"
# Expected: all green; suite count recorded for P1.M2.T1.S2.
```

### Level 3: Full suite

```bash
npm test
```

### Level 4: Model-purge sweep

```bash
grep -nE "boundary-Esc|boundary-esc|clamp|press CONSUMED|caret unmoved" test/widget.test.ts
# Expect: only grep false-friends (none expected in this file's
# key-handling sections) — decision-table stale-index clamp comment is
# in src, not here; any hit in titles/comments = rewrite missed.
git diff --stat   # confirm ONLY test/widget.test.ts changed
```

## Final Validation Checklist

- [ ] Task 0 precondition check (S1/S2 landed; no duplicate describes)
- [ ] (a)–(h) all present and green, each cell asserting the full
      observable row (highlight/hidden/suppress/innerCalls/flag/ticks)
- [ ] Old boundary-Esc/clamp describes fully replaced; purge grep clean
- [ ] Never-mutate pin kept (setHits 0) with a v2 scenario
- [ ] Decision-table describe consistent with S1's signature
- [ ] Header blurb describes the v2 model
- [ ] Chain-arming matrix / suppression-taxonomy / forward-verbatim /
      insert describes untouched
- [ ] `npm test` + `npm run check` green; widget-suite count recorded
      for the gauntlet

## Anti-Patterns to Avoid

- ❌ Don't weaken an observable to force green — a failure is an S1/S2
  contract violation; report it
- ❌ Don't delete the never-mutate pin or the chain-arming matrix while
  rewriting neighboring describes
- ❌ Don't assert caret MOVEMENT beyond the verbatim forward — the
  recording inner has a fixed cursor; parity IS "the inner received the
  bytes on the same press"
- ❌ Don't compute wrap expectations over items.length — the RENDERED
  count governs (case g exists to pin that)
- ❌ Don't add microtask awaits where the wiring is synchronous
  (pass-through hide/suppress assert immediately); DO await before
  asserting machine-tick side effects of forwarded keys (W1)
- ❌ Don't let the battery drift into insert/chain territory — those
  suites own their depth
