# PRP — P2.M1.T1.S1: zeroCharOffer helper + arming-site paint + flip the timing pins

**Work item**: BUG-003 fix (bug-hunt PRD h2.3/h3.2). Plan: P2.M1.T1.S1.

---

## Goal

**Feature Goal**: On the widget path, when typed-word arming fires (typing `"The "` with an
enriched the→Fed series), the zero-char successor offer paints AT the space tick — in the same
render frame — instead of one input event late. Spec 07 M2 `armed(W)`: "offer the successors of
W immediately … the top series successor is the top result before the user types anything."

**Deliverable**:
1. A `zeroCharOffer(word, now): boolean` helper in `src/pi/widget.ts` factored from the armed
   branch's (a)-offer body, called from both the armed branch (no behavior change) and the
   typed-word arming site (new paint).
2. Flipped timing pins in `test/widget-visibility.test.ts` and `test/widget.test.ts` plus a new
   machine-level intent/idempotence/narrowing test.
3. Updated arming-site comment describing the new contract (replacing the "never paint from the
   arming site" text at widget.ts:1005-1007).

**Success Definition**: After the space tick of `"The "` (cursor 4), `machine.getState().visible
=== true` with `currentSet` = `[Fed, Market]` (series first, run casing); a second identical-
buffer tick does not duplicate or close; typing `F` narrows without close+reopen; Tab-accept-
originated arms unchanged; all existing tests pass. Live TTY verification is P2.M1.T1.S2 (NOT
this task — this task ends with the green suite + comment updates).

## User Persona

**Target User**: end user typing in the hapax widget editor.
**Use Case**: User types a capitalized series member followed by a space; the chain arms and
the successor offer appears immediately, before any further typing.
**Pain Points Addressed**: Today the offer appears only after the NEXT input event (e.g. typing
`F` shows a filtered offer) — the "phrase completion" immediacy the M2 spec promises is lost.

## Why

- Spec 07 M2 armed(W) timing: "before the user types anything" — the current code honors
  visibility-machine step 3 ("trailing space → hidden", spec/07:336-337) instead. The fix makes
  the widget honor M2; the step-3 tension is recorded as drift (Mode A — never edit spec here;
  P2.M2.T2.S2 compiles the drift report).
- The W1 microtask deferral makes this possible: evaluate() sees the POST-keystroke buffer
  `"The "` on the space tick, so an arming-site paint lands in the same
  `applyVisibility(...)` + `requestRender()` frame.

## What

- Factor branch (a)'s offer body (widget.ts:889-906 succ build + the 931-956 paint ladder) into
  a `zeroCharOffer(word, now): boolean` helper beside the consult.
- At the arming site (widget.ts:1013-1027): after `deps.chain?.arm?.(...)` + `grant.reset()`,
  tick the grant with prefix `""` (armed-branch discipline: tick BEFORE any paint), then call
  the helper; if it painted, `return state()` WITHOUT `closeWith(now)`; otherwise fall through
  to `closeWith(now)` exactly as today (zero successors / inert chain → identical old behavior).
- Tab-accept-originated arms: UNCHANGED (already correct — the arm runs after the post-Tab
  evaluation, so the separating space's tick hits the armed branch).
- The fallback path: intentionally unchanged (pi-tui owns the menu; no paint site of its own).

### Success Criteria

- [ ] `"The "` space tick: `visible === true`, currentSet = series-first successor set
- [ ] Zero-successor arm falls through to `closeWith(now)` (no empty-menu paint — invariant:
      the menu never renders with zero candidates)
- [ ] Identical-buffer second tick: idempotent refresh, no duplicate paint, no close
- [ ] Typing `F` narrows via branch (b) park/swap — never closes + reopens
- [ ] `chainIntent` bypasses R5 (fast typing with menuDelayMs high still paints)
- [ ] One-shot grant survives (`''`→`'f'` is not a new word; the offer word still spends
      exactly once at the next boundary)
- [ ] All existing tests pass after pin flips

## All Needed Context

### Context Completeness Check

Verified by direct reads of widget.ts, both pinned tests, and the full architecture research
doc. "No Prior Knowledge" test: the PRD excerpt + this document + the files cited are
sufficient.

### Documentation & References

```yaml
- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/bug003-004-widget-provider.md
  why: THE definitive research — §1 has every code quote with line numbers (arming site, (a)
       branch, paint ladder, chainShim, closeWith, W1 tick), §1.4 guard interaction analysis
       (R5 hesitation, closeAt/fresh-reopen, double-paint, grant semantics, line claim),
       §1.5 the minimal fix sketch this PRP refines, §2.3 the spec quotes.
  section: "§1 in full; §2.3 spec quotes; §4 (test pins)"

- file: src/pi/widget.ts
  why: the only production file modified.
  pattern: "armed-branch consult ≈:829-960 (grant tick at :873-885 'tick BEFORE any paint';
           (a) offer :889-906; paint ladder :931-956: !visible → paint; sig===displayedSig →
           paint (idempotent); debounceMs elapsed → paint; else parkSwap). chainShim :683-694.
           closeWith :713-716 = hide() + closeAt stamp. paint() :718-737 sets
           visible/currentSet/paintedSet/displayedSig/lastPaintAt, CLEARS closeAt +
           suppression flags, calls deps.onPaint?.(). Typed-word arming site :≈995-1027 —
           gates: trailing space/tab, no '@'/'/' in before, typed word, enableChaining, chain
           idle, first char A-Z, topSuccessors(lowercase).some(s => s.series); then
           chain.arm + grant.reset(); then closeWith(now); comment at :1005-1007 forbids
           exactly this fix ('never paint from the arming site') — REWRITE it."
  gotcha: "NAME COLLISION: an UNRELATED 'BUG-003' label exists ≈:640-660 (2026-10 start-0
           dismissal-suppression fix). Do not conflate in comments or commit messages.
           W1 microtask tick ≈:1597-1607 (queueMicrotask → onInput → requestRender) is why
           evaluate() sees the post-keystroke buffer — a paint at the arming site lands in
           the same render frame."

- file: test/widget-visibility.test.ts
  why: PIN 1. describe("close-on-space typed-arming × visibility (P1.M2.T2.S2)") at :1244.
  pattern: "stateful chain double + CandidateStore.recordBigramRuns([{key:'the',rawCasing:'The',series:true},{key:'fed',rawCasing:'Fed',series:true}]);
           fakeEditor() + machine.onInput() harness at :59-100 ('tests set text+cursor, then
           tick')."
  gotcha: "FLIP the assertion 'expect(machine.getState().visible).toBe(false); // arm-and-close'
           at the editor.set('The ', 4) tick → visible must be TRUE (with currentSet
           ['Fed'] in that test's store). The FOLLOWING machine.onInput() tick (identical
           buffer) must still be visible with the same set (idempotent) — keep those
           assertions, update the comments that say 'the next tick's chain offer paints'."

- file: test/widget.test.ts
  why: PIN 2. describe("widget typed-word arming + series-first offers...") ≈:2422; the test
           "'The ' arms the chain and still closes; the NEXT word-start tick offers..." with
           seedTheFedStore() :2388-2406 (the→fed series + the→market ×5 ordinary — series
           still leads).
  pattern: "makeInsertHarness ≈:852-960 (restoreReady: Promise.resolve() at :922 — the
           settle-wake wakeEvaluate masks next-tick timing), typeChar :2000-2008
           ('advance the live buffer at the caret, then press the char'), await flushPaint()."
  gotcha: "The test's current comment already hedges ('whether the offer landed on this tick
           or the settle-wake's re-evaluation … the SET is [the contract]'). After the fix,
           assert currentSet ['Fed','Market'] right after the flush AND tighten the comment
           to pin the SAME-TICK contract. Do NOT weaken the arm/grant.reset assertions."

- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P1M2T2S1/PRP.md
  why: Previous (parallel) item — path-display e2e (index.test.ts ingest → provider display →
       widget Tab insert). No overlap with this task; both touch widget.test.ts only in
       different describes. Do not duplicate or conflict.

- file: spec/07-completion-ui.md (READ-ONLY here)
  why: "M2 armed(W) :≈688-715 requires the immediate offer; visibility step 3 :336-337 says
        'trailing space → hidden'. DO NOT EDIT — record the step-3 armed-exception as drift
        in code comments; P2.M2.T2.S2 compiles the drift report."
```

### Current Codebase tree (relevant slice)

```bash
src/pi/widget.ts                       # only production file modified
test/widget-visibility.test.ts         # machine-level pin (flip)
test/widget.test.ts                    # insert-harness pin (flip) + new test home
spec/07-completion-ui.md               # read-only reference
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: keep the chain-intent character. The (a) helper MUST set chainIntent = true and
// paint through its OWN paint() call — the arming site sits in the R3 close branch, BELOW the
// R5 hesitation gate's normal-path paint; if you re-route through a word-mode paint without
// intent, menuDelayMs>0 silently holds the paint during fast typing (gap < menuDelayMs).
// CRITICAL: paint() clears closeAt + suppression flags — so painting INSTEAD of closeWith is
// consistent either way; but do NOT run closeWith(now) first "for symmetry" — closeWith's
// hide() nulls displayedSig, making the first paint a fresh open (fine) yet stamping a
// pointless close event. Prefer: painted → return state() without closeWith.
// CRITICAL: grant.tick('') BEFORE the paint (armed-branch discipline :873-885). The first
// tick after reset() sets seen=1 and NEVER spends; ''→'f' is not a new word, so the one-shot
// survives into the offer word — ticking is parity, not a spend risk.
// CRITICAL: never paint an empty set — if topSuccessors(word) is empty (possible only when
// the arm gates passed via a series flag that the slice… they can't: .some(s=>s.series)
// guarantees ≥1 series successor), the helper returns false and the site falls through to
// closeWith(now). Guard anyway: succ.length === 0 → return false (zero-candidate invariant).
// CRITICAL: NAME COLLISION — existing 'BUG-003' comment at widget.ts ≈:640-660 is an
// UNRELATED start-0 suppression fix. Cite 'bug-hunt BUG-003' / plan 006 in new comments.
// CRITICAL: sig-identical repaint is idempotent by design (sig === displayedSig → paint,
// advances window clock, no flicker) — the second-tick test relies on this; do not add a
// visible-check that returns early.
// NOTE: an arming-tick paint CLAIMS the render row (claim.arm() at the render override,
// ≈:1873-1876 — only a painted line claims). Fresh-prompt first-arm layout shifts one tick
// earlier — expected; live verification belongs to P2.M1.T1.S2.
```

## Implementation Blueprint

### Data models

No new types. Helper signature (inside the widget factory closure, beside the consult):

```ts
/** Zero-char successor offer (bug-hunt BUG-003, plan 006): the armed
 *  branch's (a) body factored so the typed-word ARMING site can paint the
 *  same offer at the space tick itself. Returns whether it painted. */
const zeroCharOffer = (word: string, now: number): boolean => {
  const succ = deps.store.topSuccessors(word).slice(0, deps.config.maxSuggestions);
  if (succ.length === 0) return false;
  const items = succ.map(chainShim);
  chainIntent = true; // R5 intent: bypasses hesitation (keep this character!)
  const sig = items.map((m) => m.display).join("\u0000");
  // Same ladder as the armed branch: first paint / idempotent refresh /
  // elapsed debounce / parkSwap. Suppression bypass is chain-intent (R4).
  if (!visible) { paint(items, sig, now); return true; }
  if (sig === displayedSig) { paint(items, sig, now); return true; }
  if (now - lastPaintAt >= debounceMs) { paint(items, sig, now); return true; }
  parkSwap(items);
  return false; // parked, not painted this tick — the set WILL land at the window edge
};
```

(Adjust to actual closure variables — `visible`, `displayedSig`, `lastPaintAt`, `debounceMs`,
`parkSwap`, `paint`, `chainIntent`, `chainShim` are all in scope in the current factory.)

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REFACTOR src/pi/widget.ts — factor zeroCharOffer
  - PLACE the helper inside the widget factory closure just before evaluate()'s armed consult.
  - REWRITE the armed branch's (a) branch to call it: replace the (a) succ-build + the shared
    paint-ladder usage for the zero-char case with `if (zeroCharOffer(armed.word, now))
    return state();` — the (b)/(c) branches and the grant-tick block at :873-885 stay put.
    BEHAVIOR-IDENTICAL: same succ source, same chainShim, same ladder, same return semantics.
  - GOTCHA: the (a) branch currently shares ONE paint ladder with (b); after factoring, (b)
    keeps the inline ladder. Do not reorder the grant tick relative to (b)/(c).

Task 2: MODIFY the arming site (widget.ts :≈995-1027)
  - AFTER deps.chain?.arm?.(typed.toLowerCase()) + grant.reset():
      grant.tick(""); // one-shot discipline: tick BEFORE any paint (first
                      // post-reset tick sets seen=1, never spends)
      if (zeroCharOffer(typed.toLowerCase(), now)) {
        // painted in this render frame — the space tick IS the offer
        return state(); // NO closeWith(now)
      }
  - FALL THROUGH to closeWith(now) when the helper returns false (zero successors / parked —
    parked cannot happen on a fresh arm since !visible, but the code stays total).
  - NOTE: grant.tick's return value is ignored here — a spend is impossible on the first
    post-reset tick; a comment saying so is enough.
  - REWRITE the :1005-1007 comment: replace "never paint from the arming site" with the new
    contract — the typed-word space tick arms, ticks the grant, and PAINTS the zero-char
    successor offer in the same frame (spec 07 M2 armed(W) immediacy); zero successors still
    closeWith. Reference bug-hunt BUG-003 (plan 006) — NOT the unrelated :640-660 BUG-003.

Task 3: FLIP PIN — test/widget-visibility.test.ts (describe at :1244)
  - At the editor.set("The ", 4) + machine.onInput() step: change
    `expect(machine.getState().visible).toBe(false); // arm-and-close` →
    expect visible === true AND currentSet displays ["Fed"] (that test's store has only the
    series successor). Keep the chain.arm assertion.
  - The FOLLOWING identical-buffer machine.onInput() tick: visible stays true, same set
    (idempotent) — keep/assert; machine.painted() keys ["fed"].
  - Update the test NAME + comments ("the next tick's chain offer paints" → same-tick paint;
    note the suppression-intent character is unchanged: the paint still bypasses R4/R5).
  - Do not touch the rest of the suppression preamble (alpha dismissal) — the arming still
    happens under suppression; now the paint does too (intent bypass, per research §1.4).

Task 4: FLIP PIN — test/widget.test.ts (typed-arming battery ≈:2422)
  - In the "'The ' arms the chain and still closes; the NEXT word-start tick offers…' test:
    keep arm/grant.reset/currentSet ['Fed','Market'] assertions; tighten the hedging comment
    to pin the SAME-TICK contract (the offer paints on the 'The ' tick's evaluation, visible
    immediately after flushPaint). Rename the test to drop "still closes / NEXT word-start".
  - Sweep the describe for other assertions/comments encoding next-tick timing (grep
    'arm-and-close', 'NEXT word', 'next tick') and update to the new contract.

Task 5: ADD machine-level test (test/widget-visibility.test.ts, new describe
        "zero-char offer at the typed-arming tick (bug-hunt BUG-003)")
  - SETUP: vi.useFakeTimers if needed; menuDelayMs HIGH (e.g. 5000) via build() options;
    stateful chain double; store with seedTheFedStore-equivalent (series the→Fed run casing +
    ordinary the→market ×5 — copy the fixture from widget.test.ts :2388-2406 or extract a
    shared helper into test/helpers).
  - STEP 1: editor.set("The ", 4); single machine.onInput() → visible === true,
    currentSet displays ["Fed", "Market"] (series first in run casing — intent bypass proves
    R5 did NOT hold despite menuDelayMs 5000 and a recent prior tick).
  - STEP 2: identical second machine.onInput() → still visible, same currentSet, no close
    (sig-identical idempotent — assert painted()/currentSet stability, no flicker).
  - STEP 3: editor.set("The F", 5); machine.onInput() → visible === true and the set narrows
    (["Fed"]) WITHOUT a close in between (branch (b) membership filter / parkSwap — narrowing
    never closes+reopens; assert currentSet never went empty across the transition by
    sampling state after the tick).
  - FOLLOW pattern: fakeEditor/machine harness (:59-100), recordBigramRuns seeding (:1244
    describe), state assertions via machine.getState()/machine.painted().

Task 6: VALIDATE
  - npx tsc --noEmit
  - npx vitest run test/widget-visibility.test.ts test/widget.test.ts -v
  - npx vitest run   # full suite — zero regressions (especially the post-Tab battery,
                     # hesitation-gate tests, line-claim tests, and the P1 e2e layers)
  - Spec/07 is NOT edited (Mode A). Leave a one-line code comment at the arming site noting
    the step-3 tension is recorded for P2.M2.T2.S2's drift report.
```

### Implementation Patterns & Key Details

```ts
// Arming site after the fix (sketch — match surrounding comment density):
  if (typed !== undefined && /* existing gates */) {
    deps.chain?.arm?.(typed.toLowerCase());
    grant.reset(); // fresh one-shot grant — an arm is an arm
    // BUG-003 fix (bug-hunt plan 006): the space tick IS the word start.
    // Tick-then-paint (armed-branch discipline :873-885 — the first
    // post-reset tick sets seen=1, never spends), then offer the
    // successors NOW, in this render frame (spec 07 M2 armed(W)
    // "before the user types anything"). Spec-07 step-3 ("trailing
    // space → hidden") tension recorded for P2.M2.T2.S2 drift report.
    grant.tick("");
    if (zeroCharOffer(typed.toLowerCase(), now)) return state();
  }
  closeWith(now); // zero successors / inert chain — unchanged fallback
  return state();
```

### Integration Points

```yaml
NO config, store, or provider changes. Widget-internal refactor + one new call site.
DOWNSTREAM CONTRACTS PRESERVED:
  - painted() / currentSet feed the Tab-insert arming (T1.S2) — the space-tick paint makes
    the offer Tab-acceptable immediately; accept arms at s.next exactly as before.
  - Line claim: only painted lines claim rows (render override) — unchanged code, new timing.
  - The armed branch consult and (b)/(c) branches untouched.
NO SPEC EDITS (Mode A): drift compiled later by P2.M2.T2.S2.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit
```

### Level 2: Unit Tests

```bash
npx vitest run test/widget-visibility.test.ts -v
npx vitest run test/widget.test.ts -v
npx vitest run                    # full suite, zero regressions
```

### Level 3: Integration (this task: suite-level only)

```bash
npx vitest run test/index.test.ts test/adversarial-typing.test.ts test/acceptance.test.ts
# The composed production seam (P1.M1.T2) must stay green — the arming-site change is behind
# the same enableChaining/series gates the e2e layers exercise.
```

### Level 4: Live TTY verification

NOT in this task — P2.M1.T1.S2 owns the tmux binding verification (spec/09 :291-314
technique: `pi --no-session` in tmux, send-keys one char at a time with 0.08-0.12s sleeps,
capture-pane asserts the offer at the space). This task's definition of done is the green
suite + code/comment contract.

## Final Validation Checklist

### Technical Validation
- [ ] `npx tsc --noEmit` clean; full `npx vitest run` green
- [ ] Both timing pins flipped and their comments state the new same-tick contract
- [ ] New machine-level test passes (intent bypass / idempotence / narrowing)

### Feature Validation
- [ ] `"The "` tick: visible + series-first set in run casing
- [ ] Zero-successor arm: unchanged closeWith fallback, no empty menu (invariant)
- [ ] Identical-buffer tick: no duplicate paint, no close
- [ ] `F` narrows without close+reopen; grant one-shot survives into the offer word
- [ ] Tab-accept-originated arms: behavior unchanged (existing battery green)
- [ ] The (a) refactor is behavior-identical for the armed branch's own use

### Code Quality Validation
- [ ] Comment at :1005-1007 rewritten; no conflation with the unrelated :640-660 BUG-003
- [ ] chainIntent character preserved (no hesitation-gate hold)
- [ ] spec/*.md untouched

## Anti-Patterns to Avoid

- ❌ Don't paint through the word-mode path without chainIntent — R5 will hold it under
  menuDelayMs during fast typing
- ❌ Don't call closeWith before the paint (needless close event; paint() clears closeAt anyway)
- ❌ Don't tick the grant AFTER the paint — armed-branch discipline is tick-BEFORE-paint
- ❌ Don't early-return on `!visible` inside the helper without painting (first arm is always
  !visible — that IS the paint case)
- ❌ Don't edit spec/07 (Mode A — drift recorded by P2.M2.T2.S2)
- ❌ Don't touch the fallback provider path or the Tab-accept arm site
- ❌ Don't weaken the arm/grant.reset assertions while flipping pins

---

**Confidence Score: 9/10** — the architecture research doc §1 quotes every touched site with
line numbers and pre-analyzed every guard interaction (R4/R5, closeAt, idempotence, grant,
line claim); the only residual risk is comment-wording churn in the two pinned tests, which
the PRP bounds explicitly.
