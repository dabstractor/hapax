# PRP — P1.M3.T3.S1: Arrow navigation, clamp, boundary-Esc, suppress rules (widget key handling, part 1)

## Goal

**Feature Goal**: Implement the widget path's **key consumption layer** (spec §07
h3.9, "Widget key handling — amends the never-hijack invariant"): while the
one-line result widget is VISIBLE, the editor proxy consumes — BEFORE the inner
editor (and before the enter-submit guard) sees them — the four arrow keys and
Escape, implementing: highlight navigation (←/↑ left, →/↓ right), **boundary-Esc**
(↑/← on the FIRST word dismisses the line, consumes the press so the caret does
NOT move, and sets explicit-dismissal suppression), **clamp** (→/↓ on the LAST
word is consumed with no movement), and plain **Escape** (dismiss + suppress).
Every other key — including Tab and Enter, which P1.M3.T3.S2 wires next —
forwards verbatim to the enter-submit proxy.

**Deliverable**:
1. `src/pi/widget.ts` extended with a pure key-decision function
   (`decideWidgetKey` / `handleWidgetKey`, see Blueprint) + wiring of that
   decision into the widget editor composition (`createWidgetEditorFactory`) via
   the proxy get-trap `handleInput` override — the widget layer sees keys FIRST,
   enter-submit second, inner last (r4-widget-pi-api.md §2 seam).
2. `test/widget.test.ts` (new) — the spec-mandated M3 key-handling suite with a
   recording inner-editor stub, including the **never-mutate regression pin**.

**Success Definition**: `npm run check` and `npm test` green; the spec §09
widget.test.ts key-handling clauses for arrows/boundary-Esc/clamp/suppress/
forward-verbatim/never-mutate all pass (Tab-insert and Enter-dismiss clauses land
in S2 — this PRP must leave them forwarding so S2 can wire them).

## Why

- Spec §07 h3.9 + SPEC.md amended invariant 1: while the result line is visible
  the sanctioned capture window is exactly **{four arrows, Escape, Tab}**
  (integration item 2: "only arrows/Escape/Tab are consumed"). This task
  implements the arrows + Escape half; S2 adds Tab insert and Enter
  dismiss-then-forward.
- Boundary-Esc is the escape hatch that makes arrow capture acceptable: "↑ or ←
  while the highlight is on the FIRST word acts as Escape… pressing ← twice
  mid-word goes back one character (first press dismisses, second moves the
  caret)" (spec h3.9, verbatim owner wording).
- Suppression semantics split (spec h3.9): explicit dismissal (Escape,
  boundary-Esc) suppresses the line for the REST OF THE WORD; a disqualification
  close (candidates hit zero) does NOT suppress. The suppress flag lives in
  P1.M3.T2.S1's visibility machine — this task is its only setter from the key
  side.

## What

### Behavior contract

While `widgetState` reports the line visible and the rendered list non-empty,
the widget `handleInput(data)` runs BEFORE the enter-submit guard and BEFORE
`inner.handleInput`:

| Key (while visible) | Action |
|---|---|
| ← or ↑ | highlight moves LEFT one; if already on the FIRST word → **boundary-Esc**: hide the line, set `suppressUntilWordStart` (explicit dismissal), **consume** the press (do NOT call inner — caret unmoved) |
| → or ↓ | highlight moves RIGHT one; if already on the LAST word → **clamp**: consume the press, no movement, no dismissal |
| Escape | hide the line + set suppression (explicit dismissal), consume |
| Tab, Enter | **forward verbatim** (S2 replaces these branches with insert / dismiss-then-forward) |
| everything else | **forward verbatim** — never consumed, never altered |

While the line is hidden or the list is empty: EVERY key forwards verbatim
(zero key handling outside the visible window — invariant 1).

Forwarding means: delegate to the enter-submit proxy's `handleInput(data)` (the
existing composition target inside `createWidgetEditorFactory`), i.e. return
`enterSubmit.handleInput?.(data)` — never mutate or re-implement it.

### Success Criteria (spec §09 widget.test.ts, this task's clauses)

- [ ] ←/→/↑/↓ all navigate (index 0…n−1, both directions, never out of range)
- [ ] ↑/← on the FIRST word dismiss: press CONSUMED (inner `handleInput` not
      called for that data — caret unmoved) + suppressed until the next word
      start
- [ ] →/↓ on the LAST word clamp: consumed, no inner call, no dismissal,
      highlight unchanged
- [ ] Escape dismisses + suppresses
- [ ] Disqualification close does NOT suppress (assert via visibility machine:
      `onDismissed(false)` leaves `suppressUntilWordStart` false) — this task
      only sets suppression on EXPLICIT dismissal
- [ ] Every non-arrow/non-Escape key (text, backspace, space, Ctrl-chars, Enter,
      Tab) forwards verbatim to the enter-submit layer exactly once
- [ ] Hidden line → ALL keys (including arrows/Esc) forward verbatim
- [ ] The inner editor instance is NEVER mutated (v1 regression pin)

## All Needed Context

### Context Completeness Check

An implementer who reads spec §07 h3.9/h3.10, `src/pi/widget.ts`,
`src/pi/editor.ts`, this PRP's Blueprint, and the T1.S2/T2.S1 PRP contracts has
everything: the seam (proxy get-trap), the key-matching API (matchesKey), the
state shapes (WidgetState, VisibilityState.onDismissed), and the exact test
matrix.

### Documentation & References

```yaml
- docfile: plan/003_bbac3b15e8d0/architecture/r4-widget-pi-api.md
  why: THE architecture research. §2 documents the exact composition seam
       ("nested proxies are safe — neither layer mutates the inner instance");
       §5 documents key interception feasibility (modal-editor.ts consumes keys
       BEFORE super.handleInput and returns without delegating) and matchesKey.
  section: §2 (proxy seam) and §5 (key matching) — critical for this task

- docfile: plan/003_bbac3b15e8d0/architecture/r5-spec-readme-dod.md
  why: carries the verbatim owner wording for boundary-Esc/clamp/suppress
       (§7 quotes spec 07 h3.9 exactly — lines 143–148) and the M3 test-suite
       contract (line 38–42, widget.test.ts clauses).
  section: "widget.test.ts (primary path, M3)" + invariant quotes

- file: src/pi/widget.ts
  why: THE file to extend. S1 skeleton already composes createEnterSubmitEditor
       and its comment block names this exact task ("P1.M3.T3.S1/S2 add key
       consumption (arrows/Esc/Tab/Enter) BEFORE the enter-submit guard — the
       get-trap seam documented in r4 §2"). WIDGET_WRAPPED/WIDGET_OPTS markers
       and widgetOptsOf already exist.
  pattern: currently returns the enter-submit proxy AS-IS (pass-through) —
       replace with a second proxy whose get trap overrides handleInput and
       forwards everything else to the enter-submit proxy (get/set/has,
       functions bound, then → undefined).
  gotcha: NEVER call the raw inner editor directly — delegate to the
       enter-submit proxy so the input clock keeps ticking and the Enter guard
       stays in the chain.

- file: src/pi/editor.ts
  why: the proxy-composition pattern to replicate (createEnterSubmitEditor:
       get/set/has traps, `then` → undefined, functions .bind(target), fully
       defensive optional-chaining + try/catch — "worst case the guard is
       inert, never broken"). isSubmitKey shows the keybindings.matches seam.
  pattern: copy the Proxy trap structure verbatim for the outer widget layer
  gotcha: v1 monkey-patch crash lesson — instance mutation is FORBIDDEN; also
       a throwing hook must never break input (wrap everything defensive)

- file: node_modules/@earendil-works/pi-tui/dist/keys.d.ts (index.d.ts:21 exports)
  why: matchesKey(data, keyId) — portable key matching: "escape", "up", "down",
       "left", "right", "tab" are SpecialKey ids. Use it instead of raw ANSI
       byte sequences (\x1b[A…) so custom keybindings/kitty protocol keep
       working. Runtime import: import { matchesKey } from "@earendil-works/pi-tui"
       (editor.ts imports nothing at runtime — widget.ts MAY, matchesKey is a
       pure helper; index.test.ts precedent: src/pi already type-imports the pkg)
  gotcha: matchesKey is a plain function exported at the package root — no setup

- file: test/editor-enter.test.ts
  why: THE stub pattern — fakeInner records calls (`inner:${data}`), KeybindingsLike
       stub, assertions on the recorded sequence; reuse it wholesale for the
       widget key tests (record through BOTH proxies down to the inner stub).
  pattern: fakeInner(over), calls array, per-test menuOpen toggles

- file: plan/003_bbac3b15e8d0/P1M3T1S2/PRP.md
  why: CONTRACT for WidgetState (set()/hide()/highlightIndex mutable field,
       set() resets highlight to 0) and the proxy render override. This task
       MOVES highlightIndex via arrows and calls hide() on dismissal.
  gotcha: only this task writes highlightIndex for movement; set() owns reset

- file: plan/003_bbac3b15e8d0/P1M3T2S1/PRP.md
  why: CONTRACT for the visibility machine — VisibilityState.suppressUntilWordStart
       and its `onDismissed(explicit: boolean)` seam: "explicit=true →
       suppressUntilWordStart = true + hides; explicit=false (disqualification)
       does not". This task calls onDismissed(true) for Escape/boundary-Esc and
       NEVER for disqualification (the machine does that itself).
  gotcha: do not re-implement suppression — call the machine's seam
```

### Current Codebase tree (relevant)

```
src/pi/
  editor.ts     # createEnterSubmitEditor proxy (Enter guard, onKeystroke clock) — DONE, unchanged
  widget.ts     # S1 skeleton: createWidgetEditorFactory wraps enter-submit proxy, pass-through
  provider.ts   # fallback path + pure helpers (extractMatchState, classifyStockContext, ChainMachine)
  index.ts      # dual-path session_start wiring
test/
  editor-enter.test.ts   # proxy/stub test pattern to copy
```

### Desired additions

```
src/pi/widget.ts           # EXTEND: decideWidgetKey (pure) + widgetKeyHandler wiring into the composition
test/widget.test.ts        # NEW: key-handling suite (spec §09 M3, this task's clauses)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: consume = RETURN WITHOUT delegating. Forward = call the
//   enter-submit proxy's handleInput(data) — NOT inner.handleInput — so the
//   input clock (onKeystroke) keeps ticking for every keystroke, consumed or not.
//   (If the enter-submit guard's clock seam only fires on delegation, tick
//   opts.onKeystroke() yourself for consumed keys — arrows ARE input events;
//   the visibility machine's hesitation timing depends on it. Check T2.S1's
//   machine: it reads its clock via onInput/onDismissed; keep the tick BEFORE
//   the branch, mirroring createEnterSubmitEditor's guard order.)
// GOTCHA: boundary-Esc must consume the press — assert inner.calls contains NO
//   entry for that arrow data (caret unmoved). Clamp likewise consumes.
// GOTCHA: never mutate the inner instance (v1 RangeError recursion crash,
//   spec 07 HISTORY) — pin with a Proxy around the inner that throws on `set`.
// GOTCHA: nested proxies are safe (r4 §2): each layer owns only its own
//   handleInput; nothing re-enters.
// GOTCHA: while hidden, do NOT intercept even arrows/Esc — the capture window
//   exists only "while the result line is visible" (invariant 1 amendment).
// GOTCHA: highlightIndex must be clamped to the rendered list length BEFORE
//   deciding first/last (the list can shrink between paints — T1.S2 truncates).
// GOTCHA: empty rendered list + visible flag → treat as hidden (zero candidates
//   never render — invariant 3); forward everything.
// GOTCHA: Tab and Enter FORWARD in this task (S2 wires them). Do not consume
//   them "preparatorily".
// GOTCHA: test imports use ".js" ESM suffix ("../src/pi/widget.js") — repo convention.
```

## Implementation Blueprint

### Data model

```ts
// src/pi/widget.ts — additions (names are the seam S2 consumes; keep exact)

/** Decision of the widget key layer for one input event. */
export type WidgetKeyDecision =
  | { action: "navigate"; delta: -1 | 1 }      // move highlight
  | { action: "boundary-esc" }                  // first word + ←/↑: dismiss+consume+suppress
  | { action: "clamp" }                         // last word + →/↓: consume, no movement
  | { action: "escape" }                        // plain Escape: dismiss+consume+suppress
  | { action: "forward" };                      // everything else (incl. Tab/Enter until S2)

/** Pure decision — no editor access, trivially table-testable. */
export function decideWidgetKey(
  data: string,
  visible: boolean,
  count: number,          // rendered item count
  highlightIndex: number, // current, already clamped
): WidgetKeyDecision;
```

`matchesKey(data, "up"|"left")` → delta −1 (first word → boundary-esc);
`"right"|"down"` → delta +1 (last word → clamp); `matchesKey(data, "escape")` →
escape; hidden or count === 0 → forward; otherwise forward.

### Implementation Tasks (ordered)

```yaml
Task 1: IMPLEMENT decideWidgetKey in src/pi/widget.ts
  - PURE: matchesKey imports from "@earendil-works/pi-tui" (no editor state touched)
  - Semantics per the table above; clamp highlightIndex into [0, count-1] first
  - TEST: table-driven unit cases in Task 4 (navigation both directions, both
    boundaries, escape, hidden-forward, empty-list-forward)

Task 2: WIRE the widget key layer into createWidgetEditorFactory (src/pi/widget.ts)
  - REPLACE the S1 pass-through: wrap the enter-submit proxy `es` in a second
    Proxy whose get trap returns our handleInput for "handleInput" (and keeps
    `then` → undefined, forwards get/set/has + bound functions to `es`)
  - handleInput(data):
      1. defensive try/catch around everything (editor.ts failure model)
      2. read live state: visible + rendered count + highlightIndex from the
         WidgetState (T1.S2) and the visibility machine (T2.S1) — via the
         deps/options object the factory closure already holds (WidgetLayerOptions
         extended with a WidgetKeyDeps seam: { widgetState, visibility })
      3. decideWidgetKey(...)
      4. navigate   → widgetState.highlightIndex = clamp(current + delta); CONSUME
         boundary-esc / escape → widgetState.hide(); visibility.onDismissed(true); CONSUME
         clamp      → CONSUME (no state change)
         forward    → return es.handleInput?.(data)
  - NOTE the clock: ensure opts.onKeystroke() still fires for consumed keys
    (see Gotchas) — mirror createEnterSubmitEditor's ordering (tick first)
  - PRESERVE: WIDGET_WRAPPED stamp, widgetOptsOf, isWidgetWrapper, fallback path

Task 3: EXTEND WidgetLayerOptions + factory deps
  - ADD optional WidgetKeyDeps (widgetState, visibility machine) — when absent
    (S1-era callers / tests) the layer must degrade to pure pass-through, so
    existing suites (index.test.ts dual-path, T1.S2 render tests) stay green
  - DO NOT touch index.ts wiring beyond what T1.S1/T2.S1 already planned —
    S2 or T2.S1 owns passing the deps (coordinate: if T2.S1's machine is not
    merged yet, the deps stay optional and the key layer is dormant-by-default)

Task 4: CREATE test/widget.test.ts
  - FOLLOW pattern: test/editor-enter.test.ts — fakeInner recording stub
    (calls: string[]), plus an outer Proxy around the inner that THROWS on any
    `set` trap (the v1 never-mutate regression pin)
  - BUILD the composition through createWidgetEditorFactory({ inner: fakeFactory,
    ...stubDeps }) with a controllable widgetState (visible/items/highlightIndex)
    and a stub visibility machine recording onDismissed(explicit) calls
  - CASES (spec §09, verbatim mapping):
    * ←/→/↑/↓ all navigate: highlightIndex 0→1→2 and back; up==left, down==right
    * ↑/← on first word: line hides, onDismissed(true) recorded once,
      inner.calls has NO entry for the arrow data (caret unmoved)
    * →/↓ on last word: consumed (no inner call), highlight unchanged, no hide,
      no onDismissed
    * Escape: hides + onDismissed(true), consumed
    * disqualification close does NOT suppress: drive the stub visibility
      machine's own disqualification path (its onDismissed(false)) →
      suppressUntilWordStart stays false; next qualifying input can show again
    * forward-verbatim: text chars, backspace, space, "\r" (Enter), "\t" (Tab),
      Ctrl+C — each reaches inner exactly once with identical data
    * hidden line: ALL keys including arrows/Esc forward verbatim
    * empty list + visible: forwards (zero-candidate never captures)
    * never-mutate pin: zero set-trap hits across the whole suite
  - NAMING/PLACEMENT: test/widget.test.ts (the spec names this file; a later
    S2 append extends it with Tab/Enter clauses)
```

### Key implementation sketch

```ts
import { matchesKey } from "@earendil-works/pi-tui";

export function decideWidgetKey(
  data: string, visible: boolean, count: number, highlightIndex: number,
): WidgetKeyDecision {
  if (!visible || count === 0) return { action: "forward" };
  const i = Math.min(Math.max(highlightIndex, 0), count - 1);
  if (matchesKey(data, "escape")) return { action: "escape" };
  if (matchesKey(data, "up") || matchesKey(data, "left")) {
    return i === 0 ? { action: "boundary-esc" } : { action: "navigate", delta: -1 };
  }
  if (matchesKey(data, "down") || matchesKey(data, "right")) {
    return i === count - 1 ? { action: "clamp" } : { action: "navigate", delta: 1 };
  }
  return { action: "forward" };
}

// wiring: second proxy around the enter-submit proxy `es`:
const handleInput = (data: string): unknown => {
  try { opts.onKeystroke?.(); } catch { /* clock failures never break input */ }
  try {
    const d = decideWidgetKey(
      data, deps.widgetState.visible, deps.widgetState.items.length,
      deps.widgetState.highlightIndex,
    );
    if (d.action === "navigate") {
      deps.widgetState.highlightIndex = clamp(deps.widgetState.highlightIndex + d.delta, 0, len - 1);
      return; // consumed
    }
    if (d.action === "boundary-esc" || d.action === "escape") {
      deps.widgetState.hide();
      deps.visibility.onDismissed(true); // explicit → suppressUntilWordStart
      return; // consumed — caret unmoved
    }
    if (d.action === "clamp") return; // consumed, no movement
  } catch { /* never break input: degrade to forward */ }
  return es.handleInput?.(data); // forward verbatim (Tab/Enter included, until S2)
};
```

### Integration Points

```yaml
CONSUMED (already existing, do not rebuild):
  - WidgetState (T1.S2): visible/items/highlightIndex/hide() — highlight MOVEMENT
    is ours, RESET on set() is T1.S2's
  - visibility machine (T2.S1): onDismissed(explicit) seam owns
    suppressUntilWordStart; disqualification (explicit=false) fires from the
    machine itself, never from this key layer
  - createEnterSubmitEditor (editor.ts): unchanged; we wrap OUTWARD (widget
    sees keys first, enter-submit second, inner last)

CONSUMERS (do NOT implement here):
  - P1.M3.T3.S2 replaces the `forward` branch for Tab (synchronous insert of
    the highlighted word, applyCompletion semantics) and Enter (dismiss-then-
    forward so it submits); extends test/widget.test.ts with those clauses
  - P1.M3.T4.S1 live TTY verification exercises this against the real stack
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check          # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npm test -- test/widget.test.ts    # new key-handling suite green
npm test                            # full suite — editor-enter, index, provider-* untouched
```

### Level 3: Integration

None for this task — pure decision + proxy seam over stubs. Live TTY
verification is P1.M3.T4.S1 (binding, tmux technique in spec §09).

## Final Validation Checklist

- [ ] `npm run check` clean; `npm test` fully green
- [ ] All four arrows navigate; up≡left, down≡right
- [ ] First-word ↑/← = boundary-Esc: consumed (no inner call), hidden, `onDismissed(true)`
- [ ] Last-word →/↓ = clamp: consumed, no movement, no hide
- [ ] Escape: dismiss + suppress, consumed
- [ ] Disqualification close does not suppress (asserted via the stub machine)
- [ ] Tab/Enter/text/space/backspace forward verbatim exactly once while visible; ALL keys forward while hidden
- [ ] Inner instance never mutated (set-trap throw pin across the suite)
- [ ] No changes to editor.ts, provider.ts, index.ts, or the fallback path
- [ ] Only src/pi/widget.ts modified + test/widget.test.ts created

## Anti-Patterns to Avoid

- ❌ Don't match raw ANSI byte sequences — use `matchesKey` (custom bindings/kitty-safe)
- ❌ Don't delegate consumed keys to inner OR skip the clock tick — arrows are input events
- ❌ Don't set suppression yourself — only `onDismissed(true)` (the machine owns the flag)
- ❌ Don't consume Tab/Enter "early" — S2 owns those branches
- ❌ Don't intercept anything while hidden — the capture window is visibility-gated
- ❌ Don't mutate the inner instance or re-implement the enter-submit guard — compose outward (v1 crash lesson)
- ❌ Don't let a throwing hook break input — full defensive wrapping (editor.ts failure model)
- ❌ Don't break existing suites: WidgetKeyDeps optional → dormant-by-default pass-through

---

**Confidence Score: 9/10** — the seam (r4 §2/§5), the exact owner wording (r5 §7),
both dependency contracts (T1.S2 WidgetState, T2.S1 onDismissed/suppress), the
key-matching API (matchesKey, keys.d.ts verified), and the stub/never-mutate test
pattern (editor-enter.test.ts) are all pinned to concrete files and lines.
