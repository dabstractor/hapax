# PRP — P1.M3.T2.S1: Widget visibility machine — fragment extraction, hiding rules, timing carry-over, suppress state

## Goal

**Feature Goal**: Implement the widget path's **visibility state machine**
(spec §07 h3.10, "auto-open, re-based"): a per-keystroke machine, driven by
the editor proxy's input clock (`onKeystroke`, already ticking inside
`createEnterSubmitEditor`'s guard), that decides on EVERY input event whether
the one-line widget shows, hides, or stays suppressed — using only PURE
synchronous reads of live editor state (`getLines()`, `getCursor()`) plus the
already-existing pure helpers `extractMatchState` / `classifyStockContext`
(src/pi/provider.ts) and the query core (`rankMatches`, fuzzThreshold-gated).
It carries over the fallback path's timing stack — `menuDelayMs` hesitation
gate (keystroke-gap, default 0/OFF), the 100 ms swap debounce, flicker
hysteresis, and the `restoreReady` startup gate — **re-homed for the widget
path** (the fallback's `createDisplayProvider` copy stays untouched, per
spec: "Both paths share the query core, the startup gate, and the
debounce/hysteresis timing" — the LOGIC is shared, the code is re-homed). It
also owns the **explicit-dismissal suppress state** (`suppressUntilWordStart`)
that P1.M3.T3.S1's key handler (Escape / boundary-Esc) sets.

**Deliverable**:
1. Extended `src/pi/widget.ts` — a `createVisibilityMachine(deps)` function
   producing `{ onInput(): VisibilityState }` (the per-keystroke transition)
   plus the exported `VisibilityState` shape consumed by rendering
   (P1.M3.T1.S2's `WidgetState`) and key handling (P1.M3.T3.S1).
2. New `test/widget-visibility.test.ts` — fake-timer suite (`vi.useFakeTimers`)
   driving a fake keystroke/editor stream with a stubbed `rankMatches`,
   covering every spec h3.10 rule + suppression semantics + timing carry-over.

**Success Definition**: `npm run check` + `npm test` green; the spec's five
visibility rules each have a passing test; explicit dismissal suppresses
until the next word start/trigger char while a disqualification close does
NOT; the startup gate delays the first visible set by at most its bound;
fallback-path suites (provider-display, provider-live, startup-gate,
editor-enter) untouched and green.

## Why

- Spec §07 h2.42/h3.10: the widget path "does not depend on pi-tui's request
  cadence" — visibility is driven by the proxy's input clock + hapax's own
  context detection per keystroke. This machine IS that detection.
- It is the decision core between two already-planned halves: rendering
  (P1.M3.T1.S2's `WidgetState.set/hide`) consumes its output; key handling
  (P1.M3.T3.S1's boundary-Esc/Escape) sets its suppress flag.
- The timing stack must exist on the widget path or it regresses three
  settled behaviors (100 ms swap debounce, flicker hysteresis, hesitation
  gate + startup restore gate).

## What

### Behavior contract

The machine runs `onInput()` once per input event (the `onKeystroke` seam).
Each run, in order:

```ts
export interface VisibilityState {
  /** Should the widget line render right now? */
  visible: boolean;
  /** Explicit dismissal (Escape/boundary-Esc, set by T3) — the line
   *  stays hidden until the next word start or trigger char. */
  suppressUntilWordStart: boolean;
  /** The current (post-debounce/hysteresis) result set to render —
   *  { display } items in rank order. Empty when not visible. */
  currentSet: readonly { display: string }[];
}
```

**Transition rules** (spec h3.10, mapped exactly):

0. **Input clock bookkeeping FIRST**: record `lastKeystrokeAt = Date.now()`
   (the hesitation gate's timing source; before any state reads).
1. **Stock contexts → HIDDEN**: `classifyStockContext(lines, cursorLine,
   cursorCol) !== null` (slash / mention / quoted-path / path) → hide, clear
   `currentSet`, do NOT set suppression (stock contexts are not dismissal).
2. **Startup gate**: if the restore replay has not settled, AWAIT
   `restoreReady` (bounded ≤ 500 ms — reuse the same bound; a settled
   `restoreReady` is a no-op). Practically: the machine's first qualifying
   query during the gate window returns its result only after the promise
   resolves or the bound elapses (implement as an async guarded query or a
   ready flag + timer — see Implementation Patterns). Fresh sessions resolve
   immediately.
3. **Fragment extraction**: `extractMatchState(lines, cursorLine, cursorCol,
   config)`:
   - `null` (no fragment) → check **trailing space rule**: if the char
     before the cursor is a space/tab AND text-before-cursor contains no
     `@` and no `/` → HIDDEN (close-on-space, carried over as the widget's
     own state — rule 3). Otherwise hidden anyway (no fragment = nothing to
     offer) — but distinguish in code so hysteresis bookkeeping matches the
     spec's close-event taxonomy.
   - non-null → compute the live query: trigger mode queries `fragment`
     (0-char allowed — bare `#` lists top candidates), threshold mode
     queries `fragment`. Run `rankMatches(store, fragment, config)` (or the
     fuzzy core's entry point — see Gotchas) synchronously.
4. **Candidate gate**: `>= 1` candidate above `fuzzThreshold` → the set is a
   candidate for VISIBLE, subject to (a) `suppressUntilWordStart` (if set:
   visible only when the fragment is at a WORD START — the fragment's start
   index is at col 0 or after a non-word char — or the match is TRIGGER
   mode; otherwise stay hidden), (b) the hesitation gate (below),
   (c) the 100 ms swap debounce + flicker hysteresis (below). Zero
   candidates → HIDDEN (**disqualification close — clears the set but does
   NOT set suppression**; the next qualifying keystroke reopens).
5. **Hesitation gate** (`menuDelayMs`, default 0 = OFF): when the line is
   CLOSED and a word-mode set wants to open it, open only if
   `lastKeystrokeAt − previousKeystrokeAt >= menuDelayMs`. Bypassed by
   EXPLICIT INTENT: trigger-mode results (and armed-chain successors — the
   chain machine is T3's concern here; expose the bypass via the deps seam)
   show immediately. `menuDelayMs: 0` → immediate first paint. The previous
   keystroke time comes from the machine's own input-clock history (every
   `onInput` tick records a timestamp — including ticks that ended in
   hide/delegate).
6. **100 ms swap debounce (open line)**: once visible, a NEW non-empty set
   differing from the displayed set paints only if ≥ 100 ms since the last
   paint; otherwise schedule the swap at +100 ms, replacing any pending
   swap (a newer keystroke supersedes). A narrowing keystroke must not
   close-and-reopen (flicker hysteresis: the line stays visible with the
   OLD set until the swap fires or the set empties).
7. **Cursor move / Escape / boundary-Esc / disqualification → HIDDEN**:
   cursor movement is detected by the machine comparing
   `{line, col}` across ticks when the text is otherwise unchanged (an
   input event whose before/after editor state differs only in cursor
   position — arrow keys still produce input events through the proxy's
   clock? NO: arrow keys consumed by T3 never tick the clock; cursor moves
   that DO tick (clicks/paste-resets) are detected here). Escape and
   boundary-Esc are T3's to REPORT — expose
   `onDismissed(explicit: boolean)`: `explicit=true` sets
   `suppressUntilWordStart = true` + hides; `explicit=false`
   (disqualification, T3-triggered close) hides only. Hysteresis
   re-open rule: a close followed by a qualifying keystroke within 200 ms
   re-opens FRESH (no stale set).
8. **Startup gate (rule 5)**: identical to the fallback's — see rule 2.

**Suppression release**: `suppressUntilWordStart` clears when a qualifying
fragment begins at a word start (line start / after whitespace/punctuation)
or when trigger mode matches. A disqualification close NEVER sets it.

**Pure-core discipline**: `onInput` reads live editor state through an
injected `getEditorState(): { lines: string[]; line: number; col: number }`
(closure over the proxy's inner — the proxy exposes `getLines`/`getCursor`;
tests inject a fake). It never mutates the editor and never renders; pushing
`currentSet` into P1.M3.T1.S2's `WidgetState.set/hide` is the WIRING's job
(P1.M3.T1.S2's render layer or a small glue step in `createWidgetEditorFactory`).

### Success Criteria

- [ ] All five spec h3.10 rules have dedicated passing tests
- [ ] Stock contexts (slash/@/quoted-path/path) never show the line
- [ ] Trailing space (no @//) hides; disqualification hides WITHOUT
      suppressing; explicit dismissal (via `onDismissed(true)`) suppresses
      until word start / trigger char
- [ ] 100 ms swap debounce + flicker hysteresis + 200 ms fresh-reopen
      verified with fake timers
- [ ] menuDelayMs hesitation gate: gap-gated first paint, intent bypass,
      0-default off
- [ ] restoreReady gate bounds the first query's wait (≤ 500 ms); settled
      promise = pass-through
- [ ] Fallback path untouched: `createDisplayProvider` and its suites
      byte-identical/green
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

All references verified in the working tree. The machine consumes: pure
helpers in provider.ts (extractMatchState L70, classifyStockContext L128),
query core (matchFragment/rankMatches, fuzzThreshold-gated), widget.ts
skeleton (WidgetLayerOptions carries store/config/chain/restoreReady/
onKeystroke — L52–73), and P1.M3.T1.S2's WidgetState seam (set/hide/
highlightIndex, per its PRP "What" §2).

### Documentation & References

```yaml
- file: src/pi/widget.ts
  why: THE home — S1 skeleton (createWidgetEditorFactory L107+) whose
        header comment reserves exactly this task ("P1.M3.T2.S1 adds the
        visibility machine"); WidgetLayerOptions already carries every
        dependency this machine needs (store, config, chain, restoreReady,
        onKeystroke)
  pattern: module-local creation function + exported state type, mirroring
        createChainMachine's shape
  gotcha: do NOT move rendering or key handling here — S2/T1.S2 owns
        render, T3 owns keys; the machine only computes VisibilityState

- file: src/pi/provider.ts
  why: (a) extractMatchState (L70) + classifyStockContext (L128) — pure,
        synchronous, line-local, reused verbatim per keystroke; (b)
        createDisplayProvider (L950+) — the timing stack to RE-HOME:
        debounceMs=100 swap logic (L954, L1018–1036), firstPaintDelayMs
        hesitation + getPreviousKeystrokeAt (L854–872, ~L1090), flicker
        hysteresis; (c) createStartupGate (~L203 wiring in index.ts) —
        restoreReady + ≤500 ms bound
  pattern: read the display provider's scheduler comments closely — the
        100 ms "at most one swap, superseded by newer keystrokes" and the
        hesitation gate's keystroke-gap math are the exact semantics to
        transplant
  gotcha: createDisplayProvider is FALLBACK-ONLY — do not modify it; copy
        the logic into the widget machine (spec-sanctioned re-home)

- file: src/core/query.ts
  why: rankMatches + matchFragment — the fuzzy query core (first-char
        anchor, tiers, fuzzThreshold discard before ranking). The machine's
        ">= 1 candidate above fuzzThreshold" IS rankMatches returning
        non-empty (the threshold discard already happens inside)
  gotcha: zero-fragment trigger mode (bare "#") is a supported rankMatches
        input (sessionCount-desc listing) — pass "" as the fragment

- file: src/pi/editor.ts
  why: the input clock seam — createEnterSubmitEditor's guard runs
        onKeystroke?.() for EVERY input event BEFORE delegating (L97–102);
        widget.ts composes around it (L107–127), so the machine's onInput
        is exactly this tick
  gotcha: the tick fires for EVERY input event including ones the machine
        will ignore (stock contexts, paste); still record the timestamp —
        the hesitation gate's gap math needs consecutive-tick deltas

- file: plan/003_bbac3b15e8d0/architecture/r4-widget-pi-api.md
  why: §2 (proxy seams: getLines/getCursor/getText per keystroke through
        the proxy; onKeystroke already the input clock) and §5 (per-keystroke
        live state via the pure provider helpers — "exactly what spec 07's
        re-based state machine requires")
  critical: no pi-tui request cadence exists on this path — visibility is
        input-clock-driven only

- file: plan/003_bbac3b15e8d0/P1M3T1S2/PRP.md
  why: CONTRACT for the render half — WidgetState { set(items), hide(),
        highlightIndex } is the seam this machine's output feeds; set()
        resets highlight to 0 on every set change (the machine just calls
        set/hide in its glue)
  critical: this task must NOT re-implement rendering; only the visibility
        decision and the set it hands over

- file: test/provider-display.test.ts, test/startup-gate.test.ts
  why: fake-timer patterns for the 100 ms swap debounce and the
        restoreReady gate (vi.useFakeTimers, promise plumbing, bounded-wait
        assertions) — mirror their structure
  pattern: vi.useFakeTimers + vi.advanceTimersByTime; recorded emission
        sequences for hysteresis assertions ("narrowing must not emit
        close+reopen")
```

### Current Codebase tree (relevant)

```bash
src/pi/
  widget.ts        # S1 skeleton + S2 render (in flight)  <-- add the machine
  provider.ts      # pure helpers + fallback timing stack (READ-ONLY re-home source)
  editor.ts        # input-clock seam (createEnterSubmitEditor)
  index.ts         # wiring: restoreReady, inputClock, dual-path branch
test/
  provider-display.test.ts   # debounce/hysteresis fake-timer patterns
  startup-gate.test.ts       # restoreReady gate patterns
```

### Desired Codebase tree

```bash
src/pi/widget.ts                  # + createVisibilityMachine, VisibilityState
test/widget-visibility.test.ts    # NEW suite (fake timers, fake editor stream,
                                  #   stubbed rankMatches)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: do NOT touch createDisplayProvider or any fallback-path code —
// the fallback keeps its own copy of the timing stack (spec h2.42).
// CRITICAL: rankMatches already applies fuzzThreshold discard internally —
// ">= 1 candidate above threshold" === non-empty rankMatches result; do not
// double-filter.
// GOTCHA: extractMatchState returns null BOTH for stock contexts and for
// no-fragment — ALWAYS run classifyStockContext FIRST (it owns the
// path/slash/@ verdicts; extractMatchState has no idea about them).
// GOTCHA: the hesitation gate needs the PREVIOUS tick's timestamp even
// when that tick produced no visible result — record timestamps for every
// onInput call, unconditionally.
// GOTCHA: trigger-mode results and armed-chain successors BYPASS the
// hesitation gate (explicit intent, spec h2.46 rule 2). The chain machine
// (opts.chain) is armed/consumed by T3 — for now expose an
// isIntentBypass() dep or simply: trigger mode => bypass (chain bypass
// lands with T3 via the seam).
// GOTCHA: restoreReady may already be settled when the machine first runs
// (fresh session resolves immediately) — never unconditionally await.
// GOTCHA: relative imports need .js extensions (NodeNext ESM); vi.useFakeTimers
// with toFake including setTimeout/clearTimeout/Date as needed for gap math.
// GOTCHA: never mutate the inner editor; reads only (getLines/getCursor).
```

## Implementation Blueprint

### Data models and structure

```ts
// src/pi/widget.ts (additions)

/** What the visibility machine hands to rendering/key-handling. */
export interface VisibilityState { /* contract above */ }

export interface VisibilityMachineDeps {
  store: CandidateStore;
  config: HapaxConfig;               // triggerChar, threshold, fuzzThreshold,
                                     // maxSuggestions, menuDelayMs
  /** live editor state per tick (injected; the wiring passes the proxy's
   *  getLines/getCursor) */
  getEditorState: () => { lines: string[]; line: number; col: number };
  /** settled when history replay finishes (bounded by the wiring's gate) */
  restoreReady: Promise<void>;
  /** test seam: defaults to the real query core */
  query?: (fragment: string) => RankedMatch[];
  /** swap-debounce window; default 100 (spec h2.46 rule 2) */
  debounceMs?: number;
  /** fresh-reopen window after a close; default 200 (spec h2.46 rule 3) */
  reopenMs?: number;
}

export interface VisibilityMachine {
  /** run once per input event — the onKeystroke tick */
  onInput(): VisibilityState;
  /** T3 key-handler seam: explicit=true (Escape/boundary-Esc) suppresses
   *  until word start; explicit=false hides only (disqualification). */
  onDismissed(explicit: boolean): void;
  /** current state (for render glue / tests) */
  getState(): VisibilityState;
}

export function createVisibilityMachine(deps: VisibilityMachineDeps): VisibilityMachine;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE test/widget-visibility.test.ts — RED skeleton
  - FIXTURES: fake editor-state holder (mutable lines/line/col the test
    sets before each tick); fake keystroke stream helper
    `type(text)` = set state + machine.onInput(); stubbed query dep
    (vi.fn returning canned RankedMatch lists per fragment); fake timers
    (vi.useFakeTimers({ toFake: ["setTimeout","clearTimeout","Date"] }))
  - WRITE the spec-rule tests (see Task 4 list) — run, expect failures

Task 2: IMPLEMENT createVisibilityMachine in src/pi/widget.ts
  - STRUCTURE per the behavior contract: timestamp bookkeeping → stock
    classify → startup-gate ready flag → extractMatchState → candidate
    gate → suppression check → hesitation gate → swap debounce/hysteresis
  - RE-HOME (copy, do not import from the private display-provider
    internals) the swap-debounce + hesitation logic; study
    provider.ts L950–1100 for the exact semantics (lastPaintAt, pending
    swap replacement, narrowing-keeps-old-set)
  - Startup gate: simplest correct form — a `ready` flag that the machine
    flips when restoreReady settles (void restoreReady.then(...)) plus a
    `gateDeadline = Date.now() + 500` when the first gated query arrives;
    a query before ready holds its result until ready OR deadline (verify
    against startup-gate.test.ts's bound semantics; if a synchronous
    contract is simpler: treat the gate as "results during the window are
    dropped until ready/deadline, and the NEXT tick re-queries" — the
    input clock re-runs per keystroke, so no polling is needed)
  - JSDoc: cite spec h3.10 rules 1–5 per branch

Task 3: WIRE minimal glue in createWidgetEditorFactory
  - CONSTRUCT the machine (deps from WidgetLayerOptions: store, config,
    restoreReady, onKeystroke ticks machine.onInput) — BUT keep wiring
    minimal: P1.M3.T1.S2 (in flight) owns render; connect
    machine.onInput()'s VisibilityState to T1.S2's WidgetState.set/hide
    ONLY if that seam has landed (coordinate; if S2 is still in flight,
    leave a documented TODO hook and assert via getState() in tests)
  - DO NOT touch key handling (T3) beyond exposing onDismissed

Task 4: FULL test matrix (each rule one test minimum)
  - R1 stock contexts: slash line0 "/acw|", "@user" mention, quoted-path
    (odd '"'), "src/roun" path → onInput returns visible:false
  - R2 word fragment + candidates → visible; narrowing keystroke
    ("zend"→"zendk") does NOT emit close+reopen (recorded sequence has no
    hide between paints; the old set persists until the +100ms swap)
  - R2b swap debounce: two rapid set changes → one swap at +100ms; newer
    keystroke supersedes pending
  - R3 trailing space no @// → hidden; trailing space with "@" or "/"
    before cursor → not the space-close path (stock classify handles)
  - R4 cursor move (col change, text unchanged) → hidden; 200ms
    fresh-reopen after close (no stale set)
  - R5 startup gate: restoreReady pending → first qualifying query not
    visible until resolve OR +500ms; settled → immediate
  - SUPPRESSION: onDismissed(true) → hidden + suppressUntilWordStart;
    next keystroke extending the SAME word stays hidden; word-start
    keystroke (space then new letter) or trigger char reopens;
    disqualification (query → []) hides but does NOT suppress (next
    qualifying keystroke reopens immediately)
  - HESITATION: menuDelayMs=200 config: word-mode first paint only when
    tick gap ≥ 200 (advance Date between ticks); trigger mode bypasses;
    menuDelayMs=0 default paints immediately
  - ZERO candidates never visible (invariant 3)

Task 5: VERIFY fallback untouched + full suite
  - git diff must show NO changes under provider.ts's
    createDisplayProvider (fallback timing stack); run
    npm test -- provider-display provider-live startup-gate editor-enter
    → green; npm run check; npm test
```

### Implementation Patterns & Key Details

```ts
// Per-tick skeleton (illustrative — names per contract):
onInput(): VisibilityState {
  const now = Date.now();
  const prev = this.#lastTickAt; this.#lastTickAt = now; // ALWAYS record
  const { lines, line, col } = deps.getEditorState();
  // cursor-move detection: text identical to last tick but cursor moved → hide
  if (classifyStockContext(lines, line, col) !== null) return this.#hide(false);
  const state = extractMatchState(lines, line, col, deps.config);
  if (state === null) return this.#closeOnSpaceOrHide(lines, line, col);
  // startup gate / suppression / hesitation / debounce follow the contract…
  const matches = (deps.query ?? realQuery)(state.fragment);
  if (matches.length === 0) return this.#hide(false); // disqualification: no suppress
  // … hesit­ation: state.mode === "trigger" bypasses; else gap >= menuDelayMs
  // … debounce: visible && set differs && now - lastPaintAt < 100 → pending swap
}
// PATTERN: hide(explicit) and the paint path are the ONLY two exits that
// touch WidgetState; everything else is pure decision.
```

### Integration Points

```yaml
WIRING (minimal, in widget.ts):
  - machine ticks: opts.onKeystroke (already every input event) → also call
    machine.onInput(); state pushed to T1.S2's WidgetState seam when landed
  - restoreReady: WidgetLayerOptions.restoreReady (already present)
  - config: menuDelayMs/fuzzThreshold/triggerChar/threshold/maxSuggestions
    all already in WidgetLayerOptions.config
CONSUMERS:
  - P1.M3.T1.S2 rendering: reads VisibilityState.currentSet/visible
  - P1.M3.T3.S1 keys: calls onDismissed(true/false); reads visible to know
    whether arrows/Tab/Enter are captured
NO FALLBACK CHANGES: provider.ts fallback stack untouched
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check          # tsc --noEmit — the only linter
# Expected: clean. Watch VisibilityState/WidgetState seam typing against
# T1.S2's in-flight shapes (coordinate; use structural { display } items).
```

### Level 2: Unit Tests

```bash
npm test -- widget-visibility
npm test -- widget            # T1.S2 render suite (if landed) still green
npm test                      # full suite — fallback suites untouched/green
# Expected: new suite green; provider-display/startup-gate/editor-enter/
# provider-live byte-identical and green.
```

### Level 3: Integration Testing

Live TTY verification is P1.M3.T4.S1's binding job (spec §09 h2.57). This
task's integration surface is the seam with T1.S2's renderer — assert via
getState() + WidgetState when both have landed.

### Level 4: Domain-Specific Validation

```bash
npm test -- -t "visibility"   # the whole machine matrix
npm test -- -t "suppress"     # dismissal semantics
npm test -- -t "hesitation"   # menuDelayMs carry-over
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean
- [ ] `npm test` fully green; fallback-path suites untouched

### Feature Validation

- [ ] All five h3.10 rules tested and passing
- [ ] Suppression: explicit dismissal only; released at word start/trigger
- [ ] Disqualification close never suppresses
- [ ] Timing carry-over: 100ms swap, hysteresis, 200ms reopen, menuDelayMs,
      restoreReady ≤500ms
- [ ] Zero candidates never visible (invariant 3)

### Code Quality Validation

- [ ] Pure helpers reused (extractMatchState/classifyStockContext) — no
      regex duplication
- [ ] Fallback timing stack untouched (copy re-homed, source intact)
- [ ] Machine has no editor mutation, no rendering, no key consumption
- [ ] JSDoc cites spec rules per branch

## Anti-Patterns to Avoid

- ❌ Don't modify createDisplayProvider or any fallback code — re-home, don't share.
- ❌ Don't re-implement the fragment/stock-context regexes — reuse the pure
  provider helpers.
- ❌ Don't double-apply fuzzThreshold (rankMatches discards below-threshold
  matches already).
- ❌ Don't set suppression on disqualification — only explicit dismissal.
- ❌ Don't gate the machine on pi-tui's request cadence — input clock only.
- ❌ Don't consume keys or render here (T3 / T1.S2 own those).
- ❌ Don't skip timestamp recording on non-qualifying ticks — the hesitation
  gap math needs every tick.
