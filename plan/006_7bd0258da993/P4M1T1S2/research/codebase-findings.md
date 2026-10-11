# Research notes — P4.M1.T1.S2 (Post-Tab extension offer battery)

## What S1 (P4.M1.T1.S1) lands — the CONTRACT this battery pins

From plan/006_7bd0258da993/P4M1T1S1/PRP.md (treat as implemented verbatim):

1. `insertHighlighted` success tail: `state.hide()` + `visibility.onDismissed(false)`
   (close, never suppression). The `onDismissed(true)` Tab-accept suppression is GONE.
2. Tab-insert branch of `widgetHandleInput`, after `if (!consumed) return forwardInput(data);`
   and BEFORE the `enableChaining && rec` arm block:
   `applyVisibility(machine.onInput()); requestRender();` — the synchronous
   extension-offer evaluation (reads the POST-insert buffer; R7 fresh-reopen via the
   closeAt stamp → immediate paint, hesitation bypass).
3. `onDismissed` seam comment lists only Escape / boundary pass-through / Enter-submit.
4. S1 updates the WRONG pins at widget.test.ts :960-971 and :1089-area (suppression
   → no-suppression) and adds a provisional offer battery of its own (Task 5).

S2's job: the FULL spec 09 h2.59 "Post-Tab extension offer" bullet battery — ladder
recursion, sibling-fork backspace recovery, fresh-generation, final-armed-word,
trigger rule, Space self-close, Enter-submits — as the normative test list for S1.

## Item-text reference drift (typos to ignore)

The work-item description cites "P3.M1.T1.S1" as the landed seam input and
"P4.M1.T2.S2/S3" as output consumers. Per the task tree + parallel context, the
real references are: seam input = **P4.M1.T1.S1** (Implementing); gauntlet =
**P3.M1.T2.S2** (check + test + bench); live smoke = **P3.M1.T2.S3** scenario (iv).
P4.M1.T2 has only S1 (fallback path — do not touch). The deferral-state pinning
belongs to P3.M1.T1.S2, NOT this item.

## Harness idioms in test/widget.test.ts (module-level, reusable)

- `makeInsertHarness(seed, over)` (~:852). Returns `{editor, state, machine, buf,
  innerCalls, calls, press, show, onKeystroke, requestRender, setHits}`.
  - The fake inner does NOT apply typed keys — tests hand-mutate `h.buf.lines` /
    `h.buf.col` to simulate buffer state, then press a forwarded key.
  - `press("\t")` = Tab; `press("\x7f")` = backspace (forwarded when hidden);
    `press("\r")` = Enter (matches `tui.input.submit`).
  - `show(displays)` writes `state.set` DIRECTLY — bypasses the machine; painted()
    stays empty; "a show()-driven acceptance is vacuously never-arming" (~:937).
- `spiedChain()` (~:1421): `{ state: vi.fn(() => null), arm: vi.fn(), reset: vi.fn() }`
  cast as ChainMachine. state() → null keeps the machine's armed-chain consult INERT
  → ladder offers are pure QUERY results. Arm-call args are the assertion surface.
- `seedStore([[key, display], ...])` (~:1428): REAL CandidateStore via upsert; mid-cap
  casing derived from display[0]; NO bigrams recorded → the consult's topSuccessors is
  empty → branch (5) reset+fall-through even with a real chain machine.
- `flushPaint()` (~:1455): 5 microtask turns — flushes the W1 deferred machine tick
  after a FORWARDED keypress (restoreReady resolves immediately).
- `cfg(over)` (~:88): DEFAULT_CONFIG spread; defaults `menuDelayMs: 0`,
  `enableChaining: true` (src/pi/config.ts :134-135).
- Real chain machine: `createChainMachine()` from src/pi/provider.ts (:812; used by
  the typed-word-arming describe at :2174); `chain.state()` returns the armed word
  or null (tail test asserts `.toBeNull()`).
- Machine-painted Tab pattern: :1462-1491 (forwarded char + flushPaint to paint,
  sanity painted()[0], then press "\t" — synchronous, no timer advancement).

## Assertion surfaces

- `h.machine.getState()` → `{ visible, currentSet (items with .display), suppressUntilWordStart, ... }`
- `h.state.hidden`, `h.state.highlightIndex`, `h.state.interacted` (WidgetState; set()
  resets highlightIndex 0 + interacted false — fresh-generation contract :246/:307)
- `h.setHits()` — never-mutate trap count (v1 regression pin, describe :1250)
- `h.machine.painted()` — arming-seam records (key/tier/display); paint() single write site.

## Ladder mechanics (why the seeded fixtures are deterministic)

seedStore([implement, implements, implementation]):
- fragment "implem" (6 chars, word mode): tier-3 prefix of all three; shortest first →
  top = "implement". Tab1 inserts "implement", arms "implement".
- Offer eval: query("implement") — exact-equal exclusion (`if (k === lower) continue`,
  src/core/query.ts ~:592) drops "implement"; tier-3 prefix matches "implements",
  "implementation"; shortest key first → [implements | implementation]. Fresh set →
  state.set → highlight 0, interacted false.
- Tab2: rec from painted()[0] = "implements" → insert → query("implements") →
  exact-equal drops "implements"; "implementation" is NOT a prefix extension
  ("implementation"[8] === 'a' ≠ 's') → [] → R4 disqualification close, NO
  suppression. Arm("implements") — the FINAL accepted word.
- Backspace: buf hand-set to "implement" + press "\x7f" (forwarded; W1 tick reads the
  live buffer) + flushPaint → offer re-renders [implements | implementation] — the
  sibling-fork recovery (h3.11: "arrow or type-ahead (a) disambiguates" — optional tail).
- h2.53 amendment literal example ('implem'→Tab→'implement'→Tab leaves
  armed('implementation')) assumes 'implements' is NOT stored (pre-fork-ruling
  wording); the NORM is "armed at the FINAL accepted word". Pin BOTH variants:
  fork case (all three seeded → final arm "implements") and the literal case
  (seed only implement+implementation → final arm "implementation"). Never armed('implement').

## Hesitation / fake timers

menuDelayMs holds word-mode FIRST paint on a fast gap (R5); a FRESH close
(now − closeAt < 200 ms reopen window, R7) reopens through the gate — see
widget-visibility.test.ts :423 and consult test (8) (:761). Under vi.useFakeTimers
time is frozen → closeAt == now → freshReopen true → the offer paints with ZERO
timer advancement. Proof of intent-show synchrony.

## Placement / conflict avoidance

S1 edits test/widget.test.ts mid-file (:960-971, :1089-area, its provisional battery).
S2 appends its describe at END of file (~:2299, after the typed-word-arming describe
at :2174) — zero conflict; helpers are module-level. Dedupe guidance: if an S1 test
already covers a bullet sentence, keep one (merge assertions); the UNION must cover
every bullet sentence.

## Adjacent suites (must stay green, untouched)

- test/defer-pi-menu.repro.test.ts (P3.M1.T1.S1) — Tab defers to pi's open stock
  menu; the "contrast — unaffected" suite.
- test/widget-visibility.test.ts — machine-level close/disqualification/suppression
  battery (:288-351, :997-1180) unchanged; do NOT add S2 tests there.
- test/chain.test.ts, test/chain-grant.test.ts — grant semantics already pinned.

## Commands

- `npm run check` (tsc), `npm test` (vitest), `npx vitest run test/widget.test.ts`.
- Live TTY technique (spec 09 h2.61): tmux + send-keys one char at a time
  (0.08-0.12 s sleeps). FORMAL live smoke is P3.M1.T2.S3 scenario (iv); S2 may do a
  cheap sanity pass but the binding gate is not S2's deliverable.
