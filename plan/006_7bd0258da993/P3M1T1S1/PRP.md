# PRP — P4.M1.T1.S1: Seam retirement + extension-offer evaluation in the Tab-insert path

---

## Goal

**Feature Goal**: Tab-accept EXITS the explicit-dismissal suppression seam on
the widget path, and after every Tab insertion the visibility machine runs a
synchronous "extension offer" evaluation — a re-query with the fragment now
equal to the completed word — implementing spec 07 h3.11 + its h3.10 seam
amendment and h3.12 item 6. Escape / boundary pass-through / Enter-submit keep
arming rest-of-word suppression unchanged.

**Deliverable**: A modified `src/pi/widget.ts` (seam retirement in
`insertHighlighted` + extension-offer evaluation in the tab-insert branch of
`widgetHandleInput` + updated JSDoc), plus updated/added tests in
`test/widget.test.ts` (and `test/widget-visibility.test.ts` only if a machine
comment change warrants it). NO new files. NO spec edits (the spec is already
amended — see Context). NO query-core changes (exact-equal exclusion already
shipped).

**Success Definition**: Typing `implem` then Tab inserts `implement` and
IMMEDIATELY offers `implementation | …` (fresh generation, highlight reset,
no hesitation delay even under `menuDelayMs > 0`); typing `node` then Tab
inserts `node` and the line simply closes (0 candidates → disqualification
close, NO suppression — the next keystroke OR backspace reopens); Escape /
boundary / Enter still suppress for the rest of the word; the chain still
arms at every accepted word; the Tab-deferral pre-check still runs first;
`npm run check` + `npm test` green; live TTY verification per spec/09 h2.61.

## User Persona (if applicable)

**Target User**: the pi coding-agent user typing prompts with hapax installed.

**Use Case**: Repeated-Tab ladders — `implem` → Tab (`implement`) → Tab
(`implementation`) — and ordinary single-word completion where the word is
terminal (no extensions).

**User Journey**: Type a fragment; menu offers ranked candidates (shortest
key first); Tab inserts the highlighted word; if extensions of that word
exist, a fresh offer renders instantly and Tab walks the ladder monotonically;
if not, the line closes silently and backspace out of a sibling fork
(`implement` → `implements` dead-end → backspace → `implement`) re-renders
`implement`'s offer.

**Pain Points Addressed**: The 2026-10 owner-reported live wedge —
`implem` → Tab → `implement`, then NOTHING until the entire word was
backspaced (Tab-accept suppression blocked the extension offer the
progressive-completion ranking was built to serve).

## Why

- The 04 ranking (shortest-first + exact-equal exclusion) is designed for
  repeated-Tab ladders, but the T3 suppression seam lumped Tab-accept into
  explicit dismissal, so the first Tab wedged the word (spec 07 h3.11
  "Problem").
- Exact-equal exclusion (already in the query core) plus the extension offer
  now define precisely what deserves to show post-Tab — the seam no longer
  needs to blind the machine (spec 07 h3.10 amendment).
- Sibling P4.M1.T1.S2 (ladder recursion / backspace recovery /
  fresh-generation battery) and P4.M1.T2.S1 (fallback path) pin on top of
  this seam change; P3.M1.T2.S3 scenario iv live-verifies it.

## What

User-visible behavior (spec 07 h3.11, verbatim contract):

- Tab-accept arms NO suppression. Escape / boundary pass-through /
  Enter-submit keep arming rest-of-word suppression unchanged; the
  suppression-lapse machinery now serves only those three.
- After a Tab insertion (word, `#fragment` trigger completion, or chain-shim
  zero-span acceptance — all the same rule), the visibility machine runs
  normally; its first evaluation is the EXTENSION OFFER: re-query with the
  fragment now equal to the completed word. Exact-equal exclusion removes the
  completed word itself; the offer is every live match — in practice the
  proper-prefix extensions — ranked by the normal 04 rules.
- ≥1 candidate → the offer renders as a FRESH generation (highlight reset to
  the first word, un-entered, boundary pass-through available) and is an
  INTENT show: `menuDelayMs` hesitation-gate bypass, immediate render at
  Tab-insert; the 100 ms swap debounce + hysteresis apply as to any set
  change.
- 0 candidates (terminal word — the common case) → disqualification close:
  hide with NO suppression; the next qualifying edit — keystroke OR
  BACKSPACE — reopens normally.
- Tab on the offer inserts the highlighted word and the rule applies
  recursively (S2's battery pins the ladder); typing narrows; Space closes;
  Escape/boundary on the offer IS an explicit dismissal (suppression, seam
  retained).
- Chain arming: every Tab-insert still arms `armed(inserted word)` — walking
  the ladder leaves the chain armed for the FINAL accepted word (pinned by
  S2).
- Residual menu-flash after Tab when an extension exists but is unwanted
  (`node` → brief `nodes`/`nodejs` offer before the space closes it):
  owner-accepted, self-closing on Space.

### Success Criteria

- [ ] After a consumed Tab that inserts a word WITH extensions, the machine
      is `visible` with the extension set, `suppressUntilWordStart === false`,
      `state.highlightIndex === 0`, `state.interacted === false`, and the
      render was requested — synchronously, in the same keypress.
- [ ] After a consumed Tab that inserts a TERMINAL word, the line is hidden,
      `suppressUntilWordStart === false`, and the next qualifying keystroke
      reopens (backspace-recovery specifics are S2's).
- [ ] Escape / boundary pass-through / Enter-submit still set
      `suppressUntilWordStart === true` (existing suppression battery stays
      green unchanged).
- [ ] With `menuDelayMs > 0`, the post-Tab offer still renders immediately
      (hesitation bypass — intent show).
- [ ] The `isShowingAutocomplete` deferral pre-check still runs FIRST in the
      Tab branch (`test/defer-pi-menu.repro.test.ts` green).
- [ ] Chain arming still fires at the accepted store key with a fresh grant;
      after the offer evaluation the chain ends armed at the accepted word
      (even mid-ladder when the consult's (c) arm resets the chain — the arm
      site re-arms afterward).
- [ ] `npm run check` and `npm test` green; live TTY verification recorded.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: every edit site is pinned to
file + function + current line neighborhood, the mechanism (close +
synchronous re-evaluate riding the R7 fresh-reopen rule) is fully specified
with rationale, the one ordering hazard (eval-before-arm vs the chain
consult's (c) reset) is analyzed, and the tests to update/add are enumerated.
Verified against HEAD `a618343` on 2026 research pass; line numbers drift —
navigate by the quoted code, not only the numbers.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: spec/07-completion-ui.md
  why: The binding contract being implemented — h3.10 "Widget key handling"
    (the seam amendment: "Tab-accept is NOT in the seam (2026-10)"), h3.11
    "Post-Tab extension offer" (the full rule incl. fork ruling + residual
    cost), h3.12 "Widget visibility state machine" item 6 (intent show,
    hesitation-gate bypass, immediate render).
  pattern: h3.10 bullet "Explicit dismissal", h3.11 whole section, h3.12 items 2-6.
  gotcha: The spec is ALREADY amended (commit 6799367 "docs(spec): post-Tab
    extension offer adopted"). Do NOT edit spec/ — spec and code must land in
    agreement, and the spec half already landed. This item ships the code half.

- file: spec/09-testing-and-acceptance.md
  why: "Live verification technique (binding)" (~line 286) — the tmux recipe
    every UI-layer change MUST follow; unit tests alone are insufficient by
    project law.
  pattern: pi --no-session in a tmux pane; tmux send-keys ONE CHAR AT A TIME
    with 0.08-0.12 s sleeps (bursts cancel in-flight autocomplete queries);
    verify via tmux capture-pane.
  gotcha: Piping stdout makes pi's TUI exit silently — a real TTY is required.

- file: src/pi/widget.ts
  why: The ONLY production file to modify. Key sites (verify by quoted text,
    lines drift): insertHighlighted's doc block + its trailing
    "state.hide(); visibility.onDismissed(true)" (~:1462); onDismissed's
    T3-seam comment listing "Tab-accept" as a seam member; the tab-insert
    branch of widgetHandleInput (deferral pre-check → rec capture →
    insertHighlighted → arm site, ~:1670-1818); createVisibilityMachine's
    evaluate (lapse → R1 → chain consult → match → R2 → query → R4-R7).
  pattern: The file's house style — dense JSDoc citing spec sections,
    fully-defensive optional member access, "state/machine failures never
    break input" try/catch, one clock tick per keypress.
  gotcha: (1) hide() clears machine.painted() — rec MUST be captured BEFORE
    insertHighlighted (already the case; do not reorder it away). (2) The
    machine's onInput is normally driven from a microtask (W1 fix) because
    DELEGATED keystrokes read a pre-keystroke buffer — but the Tab insert is
    applied synchronously via setText, so a synchronous machine.onInput()
    after the insert reads the POST-insert buffer. Do not "fix" this into a
    microtask; the offer must land in the same keypress.

- file: src/pi/chain-grant.ts
  why: The one-shot grant tracker ticked inside evaluate's consult branch —
    read it to understand grant.tick's word-boundary counting before
    reasoning about the extension evaluation's interaction with an armed
    chain.
  pattern: tick returns true only when the SECOND word is observed; reset()
    at every arm site.
  gotcha: The consult branch ticks the grant BEFORE its (a)/(b) split; a
    fresh grant's first tick records seen=1 and returns false (never spends).

- file: src/core/query.ts
  why: PROOF the offer needs no core change — exact-equal exclusion is
    already: anchored pass `if (k === lower) continue;` (~:592) and tier-0
    pass (~:646, "parity with the anchored pass").
  pattern: rankMatches(store, fragment, { limit, fuzzThreshold, loose }) —
    exactly what the machine's `query` dep already calls.
  gotcha: Do NOT touch query.ts in this item.

- file: test/widget.test.ts
  why: Test conventions + the tests that pin today's WRONG behavior.
  pattern: makeInsertHarness (composed editor + fake buffer + trap store +
    press/show/requestRender/onKeystroke, ~:900); the Tab describe block
    (~:960+). suppression battery at :701-761 (stays green unchanged);
    Tab-with-suppression assertions at :960-971 and :1089 (MUST change).
  gotcha: show() drives state.set DIRECTLY (bypasses the machine — painted()
    stays empty, no arming, no offer). Extension-offer tests must instead
    seed the trap store and drive machine.onInput() so the machine paints —
    then press Tab and assert on machine.getState()/state.

- file: test/widget-visibility.test.ts
  why: Machine-level drive pattern (fake editor state + injected `query`
    seam + vi.useFakeTimers; machine.onInput() per keystroke; suppression
    battery :288-351). If you add any machine-surface behavior, test it HERE
    with this harness; pure wiring behavior belongs in widget.test.ts.
  gotcha: onDismissed(false) = close-no-suppress is already pinned (:751-761)
    — your seam retirement makes the Tab path USE it.

- file: test/defer-pi-menu.repro.test.ts
  why: P3.M1.T1.S1's regression suite — the isShowingAutocomplete deferral
    pre-check MUST stay first in the Tab branch. It must stay green verbatim.
```

### Current Codebase tree (relevant excerpt)

```bash
src/pi/widget.ts            # 1884 lines — the ONLY production file touched
src/pi/chain-grant.ts       # read-only reference (grant semantics)
src/pi/provider.ts          # read-only (fallback path — P4.M1.T2.S1's scope, NOT yours)
src/core/query.ts           # read-only (exact-equal exclusion already shipped)
test/widget.test.ts         # UPDATE: post-Tab suppression assertions; ADD: offer battery
test/widget-visibility.test.ts  # machine-surface tests, if any
test/defer-pi-menu.repro.test.ts # must stay green (deferral pre-check first)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
# NO new files. Changes:
src/pi/widget.ts            # seam retirement + extension-offer eval + JSDoc (Mode A)
test/widget.test.ts         # updated assertions + new extension-offer battery
test/widget-visibility.test.ts  # only if a machine-surface behavior changed (none expected)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL ORDERING (the one real hazard): the extension evaluation MUST run
// BEFORE the arm site. Evaluating AFTER arm() would send the offer through
// evaluate's CHAIN CONSULT (b) branch — topSuccessors(NEW word) filtered by
// matchFragment — producing a successor-index offer instead of h3.11's
// defined QUERY offer ("every live match of the completed word"). Evaluating
// BEFORE arm(): common case (chain idle) → pure query offer; ladder case
// (chain armed at the PREVIOUS word) → the consult may answer with successor
// extensions or (c)-reset the chain — and the arm site re-arms at the
// accepted word immediately after, so "chain ends armed at the FINAL
// accepted word" (S2's pin) holds either way. TEST the ladder case.

// CRITICAL MECHANISM: the immediate render does NOT need a new intent flag.
// onDismissed(false) is closeWith(now) → hide() + closeAt stamp. The very
// next synchronous evaluate sees !visible AND now - closeAt ≈ 0 < reopenMs
// (200) → R7 fresh-reopen: hesitation (R5) bypassed, paints immediately on
// the !visible branch (R6's swap-debounce park only applies to a CONTINUOUSLY
// visible line). Skipping the close would leave visible=true → R6 parks the
// offer behind the 100 ms swap timer → VIOLATES "immediate render".

// CRITICAL: hide() clears machine.painted() — rec (the accepted record for
// chain.arm) is captured BEFORE insertHighlighted today. Keep that capture;
// the extension evaluation repaints painted() with the offer, which must NOT
// disturb rec (it is a local — safe).

// GOTCHA: fresh generation is automatic. applyVisibility pushes state.set()
// only on a signature change; the offer set can never equal the pre-Tab set
// (the inserted word was IN the pre-Tab set and exact-equal exclusion removes
// it from the offer), so set() always fires → highlightIndex 0 + interacted
// false (WidgetState.set contract). Assert it anyway.

// GOTCHA: trigger completions (#implem → Tab inserts "implement", trigger
// consumed) and chain-shim zero-span acceptances (inserts "Fed" at an empty
// word start) take the SAME rule for free — post-insert the cursor sits
// after a plain word, extractMatchState returns threshold mode with the
// completed word as fragment. No special-casing; ADD A TEST for the trigger
// case anyway.

// GOTCHA: a display containing '/' or '.' (rule-4d keys keep edge slashes)
// can make the post-insert position a STOCK CONTEXT — evaluate's R1 hides
// (no suppression) automatically because "the machine runs normally". Do
// not pre-filter; let R1 handle it.

// GOTCHA: pending swap timers are cancelled by hide() (closeWith → hide →
// clearSwapTimer) — a parked pre-Tab swap cannot leak into the offer.

// GOTCHA: exactly ONE clock tick per keypress. The consumed Tab already
// ticks opts.onKeystroke() in the consumed-keys block BEFORE the branch; do
// NOT tick again, and do NOT route the extension eval through tick()'s
// microtask (it also ticks the clock a second time via the guard seam —
// wrong for a consumed key).
```

## Implementation Blueprint

### Data models and structure

None. No new types, no config, no store, no schema. `VisibilityMachine`'s
public surface is UNCHANGED (`onInput`/`onDismissed`/`getState`/`painted`/
`dispose`) — the machine itself needs NO behavioral change; only a comment
edit inside `onDismissed` (the seam-member list drops "Tab-accept").

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/pi/widget.ts — insertHighlighted seam retirement
  - FIND: the end of insertHighlighted's success path:
      state.hide(); // immediate visual dismissal…
      visibility.onDismissed(true); // …+ suppression until the next word start
  - REPLACE the onDismissed(true) call with onDismissed(false):
      state.hide(); // immediate visual close…
      visibility.onDismissed(false); // …a CLOSE, never suppression (spec 07
      // h3.10 amendment / h3.11: Tab-accept EXITS the seam — the close stamps
      // closeAt so the extension evaluation reopens FRESH and immediately)
  - KEEP state.hide() (defensive: if the extension eval ever throws, the line
    is closed, never stale).
  - UPDATE the doc block (Mode A, spec-maintenance rides with the work):
    the "Dismissal" paragraph must now cite spec 07 h3.11/h3.10 — Tab-accept
    is a CLOSE (no suppression); the suppression seam serves only Escape /
    boundary pass-through / Enter-submit; the post-Tab offer is evaluated by
    the CALLER (the tab-insert branch) right after this returns.
  - NOTE: the failure model (any throw → return false → forward) is untouched.

Task 2: MODIFY src/pi/widget.ts — extension-offer evaluation in the tab-insert branch
  - FIND (widgetHandleInput, tab-insert arm area):
      const consumed = insertHighlighted(
        innerRecord as unknown as EditorLike,
        state,
        machine,
        opts.config,
        requestRender,
      );
      if (!consumed) return forwardInput(data); // span-miss forward: NEVER arms
  - INSERT between that line and the arming block (ORDER IS LOAD-BEARING —
    see Known Gotchas):
      // POST-TAB EXTENSION OFFER (spec 07 h3.11 + h3.12 item 6): the
      // visibility machine "runs normally" — synchronous onInput() against
      // the POST-insert buffer (setText is synchronous; the W1 microtask
      // deferral exists only for DELEGATED keystrokes reading a pre-
      // keystroke buffer). The onDismissed(false) close above stamps
      // closeAt, so this first evaluation is a FRESH REOPEN (R7): immediate
      // paint, menuDelayMs hesitation bypassed — the intent-show semantics
      // of h3.12 item 6 — with the live query's extension set (exact-equal
      // exclusion removed the completed word; ranked by the normal 04
      // rules). 0 candidates → the machine's own R4 disqualification close:
      hidden, NO suppression, next qualifying edit (keystroke OR backspace)
      reopens. Runs BEFORE the arm site so the offer is the QUERY result,
      never a successor-index shim, and the (c) chain reset (mid-ladder
      consult) is immediately superseded by the arm below — the chain ends
      armed at the FINAL accepted word.
      applyVisibility(machine.onInput());
      requestRender();
  - This sits INSIDE the existing try/catch ("state/machine failures never
    break input") — wrap not needed beyond it.
  - DO NOT add a clock tick (the consumed-key block above already ticked
    exactly once); DO NOT use tick() (its microtask double-ticks).

Task 3: MODIFY src/pi/widget.ts — comment retirement (Mode A docs, rides with the work)
  - onDismissed (in createVisibilityMachine): the seam comment currently
    reads "T3 seam (Escape / boundary pass-through / Tab-accept /
    Enter-submit)". Drop "Tab-accept"; cite spec 07 h3.10 amendment
    (2026-10: Tab-accept is NOT in the seam; the suppression lapse now
    serves only the three remaining members).
  - VisibilityState.suppressUntilWordStart doc mentions the dismissal set —
    verify it names only the three remaining members; adjust if it lists Tab.
  - grep widget.ts for any other "Tab-accept" + suppression coupling in
    comments (the R4/lapse comment blocks stay — they serve the three).

Task 4: UPDATE test/widget.test.ts — retire the wrong pins
  - :960 "Tab inserts items[highlightIndex].display over the word span;
    consumed end-to-end … line dismissed + suppressed": suppressUntilWordStart
    must now be FALSE; keep the setText/caret/buffer/innerCalls/consumed
    assertions. NOTE: this harness show()-drives state.set (machine painted()
    empty, trap store) — the offer evaluation will run the machine against
    the trap store; set the trap's expectation for the post-insert fragment
    (e.g. store/next-result) so the machine's verdict is deterministic.
  - :1089-area post-Tab suppression assertion: same change.
  - Any other test asserting suppression after a consumed Tab (grep
    suppressUntilWordStart in Tab-context tests) — same change.

Task 5: ADD test/widget.test.ts — extension-offer battery (this item's core)
  Drive visibility through the MACHINE (seed trap store → machine.onInput()
  paints the pre-Tab set → press Tab), mirroring the composed-editor harness:
  - it("Tab with extensions: offer renders immediately as a fresh generation,
    no suppression"): pre-Tab query paints [implement, implementation] for
    "implem"; press Tab → buffer "implement"; assert consumed, machine
    visible, currentSet is the extension set for fragment "implement"
    (exact-equal excluded — no "implement"), suppressUntilWordStart false,
    state.highlightIndex 0, state.interacted false, requestRender called.
  - it("Tab on a terminal word: disqualification close, no suppression"):
    pre-Tab set [node] for "nod"; Tab → buffer "node"; query("node") → [];
    assert hidden, suppressUntilWordStart false, and the next keystroke at a
    qualifying position reopens (basic case; sibling-fork backspace walk is
    P4.M1.T1.S2's battery).
  - it("menuDelayMs > 0: the offer still renders immediately (intent show)"):
    compose with menuDelayMs e.g. 5000; fast typing paints nothing, Tab
    inserts and the OFFER paints in the same keypress.
  - it("trigger completion takes the same rule"): "#implem" + Tab → buffer
    "implement", offer evaluates on the inserted word.
  - it("chain arming preserved: after the offer evaluation the chain is
    armed at the accepted key with a fresh grant") — including the
    MID-LADDER case: chain armed at "implement" (previous accept), Tab
    inserts "implementation" from the offer; whatever the consult does
    (successor shims or (c) reset), post-branch chain state is armed at
    "implementation" and grant is fresh.
  - it("Escape / boundary / Enter still suppress (regression)"): the
    existing :701-761 battery — keep green; add one explicit Tab-vs-Escape
    contrast case if not already implied.

Task 6: RUN validation (below) and record live TTY results
  - Live technique per spec/09 h2.61 (BINDING for UI-layer changes): pi
    --no-session in tmux, send-keys one char at a time (0.08-0.12 s),
    capture-pane. Scenarios: (a) implem→Tab→offer visible; Tab again →
    ladder walks; (b) node→Tab→line closes, brief flash if extensions
    exist, space/next-word reopens; (c) Escape after an offer → suppressed
    rest of word; (d) Tab while pi's own menu open → deferral intact.
```

### Implementation Patterns & Key Details

```typescript
// The whole production diff, conceptually (widget.ts):

// (1) insertHighlighted, success-path tail — BEFORE:
state.hide(); // immediate visual dismissal…
visibility.onDismissed(true); // …+ suppression until the next word start
// AFTER:
state.hide(); // immediate visual close…
visibility.onDismissed(false); // CLOSE, never suppression (spec 07 h3.11:
// Tab-accept exits the seam; the closeAt stamp makes the caller's extension
// evaluation a fresh, immediate, hesitation-bypassed reopen — h3.12 item 6)

// (2) tab-insert branch — AFTER `if (!consumed) return forwardInput(data);`
// and BEFORE the `if (opts.config.enableChaining && rec && ...)` arm block:
applyVisibility(machine.onInput()); // POST-TAB EXTENSION OFFER (h3.11)
requestRender();

// Why this is correct WITHOUT new machinery:
// - onDismissed(false) === closeWith(now): hide() + closeAt stamp, and
//   hide() clears any pending swap timer (no stale-swap leak).
// - machine.onInput() reads the LIVE post-insert buffer synchronously
//   (setText already applied); fingerprint differs from lastFingerprint →
//   not a cursor-move close; evaluate runs: lapse (no-op) → R1 (stock
//   contexts hide cleanly — the '/'-bearing display corner) → chain consult
//   (only when a PREVIOUS accept left it armed — the ladder case) →
//   extractMatchState returns the completed word as threshold fragment →
//   query → R4 (no suppression — none armed) → R5 bypassed by freshReopen
//   (now - closeAt ≈ 0 < 200) → !visible → paint() immediately.
// - paint() releases suppression flags (none set), sets painted() = offer
//   (S2 reads it for the NEXT Tab's rec), stamps lastPaintAt.
// - applyVisibility: offer sig ≠ pushedSig (the inserted word is absent by
//   exact-equal exclusion but present pre-Tab) → state.set() → FRESH
//   generation (highlightIndex 0, interacted false) — h3.11's "fresh
//   generation" requirement for free.
// - 0 candidates: evaluate's R4 → closeWith(now) → hidden, closeAt stamped
//   → next qualifying edit reopens (fresh-reopen window) — "keystroke OR
//   BACKSPACE": a backspace that produces a qualifying fragment ticks
//   onInput normally and reopens; nothing suppresses.
```

### Integration Points

```yaml
NONE — no config surface, no store, no provider, no index.ts wiring. The
WIDGET_MACHINE / WIDGET_STATE symbol seams are unchanged (tests keep using
widgetMachineOf/widgetStateOf). Sibling dependencies:
- P4.M1.T1.S2 (next): pins ladder recursion + backspace recovery + the
  fresh-generation battery on THIS seam — do not break its ability to read
  machine.painted() post-offer (paint() populates it).
- P4.M1.T2.S1 (fallback path): the seam change is unconditional there too,
  but provider.ts is NOT in this item's scope — do not touch it.
- P3.M1.T2.S3 scenario iv: the live smoke that ultimately verifies this.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check   # tsc typecheck — zero errors; run after the widget.ts edit
# Expected: clean. If errors, READ them; the change is comment + two-line
# logic — type errors mean you touched something beyond the seam.
```

### Level 2: Unit Tests (Component Validation)

```bash
npm test                                  # full suite (vitest)
npx vitest run test/widget.test.ts        # the changed battery
npx vitest run test/widget-visibility.test.ts  # suppression battery stays green
npx vitest run test/defer-pi-menu.repro.test.ts # Tab-deferral pre-check first
# Expected: all green. Failing post-Tab-suppression assertions in OTHER
# files (acceptance/adversarial-typing) mean those tests pinned the retired
# seam — update them to the new contract (cite spec 07 h3.10 amendment in
# the test comment), never delete coverage.
```

### Level 3: Integration Testing (Live TTY — BINDING for UI-layer changes)

```bash
# spec/09 h2.61 technique (pi needs a real TTY; piping stdout exits silently):
tmux new-session -d -s hapax 'pi --no-session'
# Seed the store: submit one short user message containing your ladder words
# (e.g. "implement implementation implements"), Ctrl+C the turn.
# Drive ONE CHAR AT A TIME with 0.08-0.12s sleeps (bursts cancel in-flight
# autocomplete — a known false-conclusion source):
tmux send-keys -t hapax 'i' 'm' 'p' 'l' 'e' 'm'   # with per-key sleeps
tmux capture-pane -t hapax -p                     # verify the pre-Tab offer
tmux send-keys -t hapax Tab                       # insert + extension offer
tmux capture-pane -t hapax -p                     # verify: implement + offer
# Scenarios: (a) implem→Tab→"implementation" offer, Tab again → ladder;
# (b) a terminal word → close, no offer; (c) Escape on the offer →
# suppressed rest-of-word; (d) Tab with pi's own menu open → deferral.
# Temporary appendFileSync instrumentation behind an env var in widget.ts is
# the sanctioned observation channel — REMOVE before committing.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Not applicable: no network, no persistence, no telemetry (invariant 4).
# Performance: the offer adds ONE synchronous store query (< 1 ms budget,
# spec 02 h2.18) per consumed Tab — within budget by construction; no new
# timers, no allocation-heavy paths.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean
- [ ] `npm test` green (full suite)
- [ ] `test/defer-pi-menu.repro.test.ts` green verbatim (deferral first)
- [ ] widget-visibility suppression battery (:288-351, :701-761 in widget
      tests) green UNCHANGED (Escape/boundary/Enter taxonomy untouched)

### Feature Validation

- [ ] Tab + extensions → immediate fresh offer, no suppression, highlight 0
- [ ] Tab + terminal word → close, no suppression, next edit reopens
- [ ] menuDelayMs > 0 → offer still immediate (intent show)
- [ ] Trigger completion (`#implem`) takes the same rule
- [ ] Chain armed at accepted word after the offer evaluation (mid-ladder
      (c)-reset case included), fresh grant
- [ ] Live TTY scenarios (a)-(d) executed and recorded

### Code Quality Validation

- [ ] JSDoc cites spec 07 h3.11/h3.10 at the Tab-insert path (Mode A — rides
      with the work)
- [ ] The seam-member comment lists only Escape / boundary / Enter-submit
- [ ] No changes outside src/pi/widget.ts + tests; spec/ untouched; no new
      files; provider.ts (fallback) untouched
- [ ] Exactly one clock tick per keypress preserved; consumed key never
      delegates

### Documentation & Deployment

- [ ] No new env vars, no config surface changes (nothing to document)
- [ ] Spec/code agreement: spec half landed in 6799367; code half is this
      change — nothing further to sync

---

## Anti-Patterns to Avoid

- ❌ Don't add an `extensionIntent` flag / new machine API — the
  onDismissed(false) close + synchronous onInput() already yield immediate,
  hesitation-bypassed, fresh rendering via the R7 fresh-reopen rule. (If you
  find freshReopen insufficient in a test, STOP and re-read h3.12 item 6
  before inventing machinery.)
- ❌ Don't evaluate the offer AFTER chain.arm() — the consult branch would
  answer from the successor index instead of the query (h3.11 defines the
  offer as the query result) and the fresh grant would interact with the
  consult's tick.
- ❌ Don't reorder the rec capture (must precede insertHighlighted — hide()
  clears painted()).
- ❌ Don't route the extension evaluation through tick()'s microtask or add a
  second onKeystroke tick — one tick per keypress is load-bearing.
- ❌ Don't touch src/pi/provider.ts, src/core/query.ts, or spec/ — the
  fallback path is P4.M1.T2.S1, the core needs nothing, and the spec already
  adopted this change.
- ❌ Don't delete suppression-lapse machinery — it now serves the three
  remaining seam members (spec h3.10: "the lapse now serves only the Escape /
  boundary / Enter-submit dismissals").
- ❌ Don't skip live TTY verification because unit tests pass — UI-layer
  changes require it (spec/09, binding).
