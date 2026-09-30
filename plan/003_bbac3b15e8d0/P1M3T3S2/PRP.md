# PRP — P1.M3.T3.S2: Tab synchronous insert + Enter dismiss-then-forward + never-mutate pin (widget key handling, part 2)

## Goal

**Feature Goal**: Complete the widget path's key layer (spec §07 h2.46 rule 0, h3.9): while the one-line widget is visible, **Tab** synchronously inserts the highlighted candidate's DISPLAY string — reimplementing stock `applyCompletion` semantics on the live query (never debounce-gated, never menu-opening) — and **Enter** dismisses the widget line then forwards so the inner editor submits. The inner editor instance is NEVER mutated (v1 regression pin).

**Deliverable**:
1. `src/pi/widget.ts` extended: replace the Tab/Enter `forward` branches of S1's key layer with `insertHighlighted` (Tab) and dismiss-then-forward (Enter); export `isSubmitKey` from `src/pi/editor.ts` (or add a duck-typed widget-side equivalent).
2. `test/widget.test.ts` extended with the spec §09 Tab/Enter/insertion clauses, and `test/editor-enter.test.ts` extended for the editor-proxy double (enter-submit preserved under the widget layer, thenable guard, onKeystroke fires for every event, throwing hook never breaks input).

**Success Definition**: `npm run check` + `npm test` fully green; Tab inserts the highlighted word synchronously replacing the word-regex span or `#fragment`; Enter always submits; every other key still forwards verbatim; zero set-trap hits on the inner across the entire suite.

## Why

- Spec §07 h2.46 rule 0: "Tab only ever completes — it never opens anything… the proxy consumes Tab while the line is visible and inserts the highlighted word." No provider item exists on the widget path, so pi-tui's `applyCompletion` never runs for word fragments — the widget must do the text edit itself.
- Spec §07 h2.48: Enter ALWAYS submits (shell convention). The enter-submit guard's own pattern (cancel-then-forward, `isSubmitKey` + `isShowingAutocomplete`/`cancelAutocomplete`) is the exact template for the widget's dismiss-then-forward.
- The v1 monkey-patch recursion crash (spec 07 HISTORY) makes the never-mutate pin acceptance-critical on every layer.

## What

### Tab (while the widget line is visible and the rendered list is non-empty)

1. Read live state **synchronously**: `lines = inner.getLines()`, `{line, col} = inner.getCursor()` (via the enter-submit proxy — public members forward), `candidates`/`highlightIndex` from the `WidgetState` (T1.S2) — the LIVE query set, never a debounced/painted copy.
2. Resolve the candidate: `items[clamp(highlightIndex)]`; if none → **forward Tab verbatim** (Tab with no live set passes through as a literal Tab — never-hijack rule).
3. Compute the span to replace on the cursor's line, text before cursor `before = lines[line].slice(0, col)`:
   - **trigger mode first**: `before.match(new RegExp("(?:^|[ \\t])" + esc(triggerChar) + "([^\\s" + esc + "]*)$"))` → span covers `triggerChar + fragment` (trigger char consumed, spec §07 trigger mode).
   - else **word mode**: `before.match(/[A-Za-z][A-Za-z0-9_-]*$/)` → span = that fragment (hyphen-admitting; this is exactly the provider.ts threshold-fragment pattern at src/pi/provider.ts:105).
   - If neither matches → forward Tab verbatim (defensive; the visibility machine should not be visible in that state).
4. Insert: `newLine = before.slice(0, spanStart) + candidate.display + lines[line].slice(col)` (candidate's display casing, spec h2.30); write via the inner's OWN public methods: `inner.setText(lines.withReplacedLine(line, newLine).join("\n"))` (public, undoable — it pushes an undo snapshot itself).
5. Caret: `setText` parks the cursor at END of buffer (verified: `setTextInternal(text, "end")`). Fix it to `spanStart + display.length` defensively: `(innerAny.setCursorCol as ((c: number) => void) | undefined)?.(spanStart + candidate.display.length)` in try/catch — calling a method is NOT instance mutation (the ban is on own-property writes). Fallback (method absent/throws): cursor stays at end, which is correct in the common typing-at-end case; degrade gracefully, never throw.
6. Dismiss + hide: `widgetState.hide(); visibility.onDismissed(true)` (explicit dismissal → suppressUntilWordStart; the chain machine, if wired, arms via its own acceptance hook — do NOT touch it here).
7. Repaint: the key is consumed (never delegated), so call `tui.requestRender?.()` defensively if the factory closure holds `tui` (it does — factory signature `(tui, theme, keybindings)`); wrap in try/catch.
8. CONSUME the Tab — do NOT call `es.handleInput`/`inner.handleInput` for it.

Everything in steps 1–8 is synchronous — zero awaits, zero debounce reads. `onKeystroke?.()` still ticks first (S1's ordering — keep it).

### Enter (while visible)

Dismiss-then-forward, mirroring the enter-submit guard exactly:
1. If `isSubmitKey(data, keybindings)` and the widget line is visible (and list non-empty): `widgetState.hide(); visibility.onDismissed(true)` — the dismissal suppresses re-show until the next word start.
2. Then **forward**: `return es.handleInput?.(data)` — the enter-submit guard may still cancel a stock (slash/path) menu, and the inner editor's own submit branch handles the same keystroke. Slash menus keep stock accept-and-submit (the widget never shows for slash contexts anyway).
3. Enter while hidden → S1 already forwards verbatim (unchanged).

### Everything else

Unchanged from S1: forward verbatim; hidden line → all keys forward.

### Success Criteria (spec §09 widget.test.ts + editor-enter.test.ts clauses)

- [ ] Tab inserts the highlighted word synchronously (never debounce-gated — assert insert works immediately after a set change with zero timers advanced)
- [ ] Insertion replaces the word-regex span OR the `#fragment` (incl. trigger char) with the candidate's display casing; caret lands after the insertion
- [ ] Tab with no live set / empty list forwards verbatim exactly once
- [ ] Tab never opens/toggles/summons anything (no `requestAutocomplete`/provider call on the widget path — structurally absent)
- [ ] Enter while visible: dismiss + suppress recorded, then forwarded exactly once so the inner editor submits
- [ ] Enter while hidden / with slash menu open: stock behavior untouched
- [ ] Inner instance NEVER mutated across the whole suite (set-trap throw pin, zero hits)
- [ ] editor-enter.test.ts additions green under the widget layer double: enter-submit behavior preserved, thenable guard (`then` → undefined), `onKeystroke` fires for every event (consumed keys included), a throwing `onKeystroke` never breaks input

## All Needed Context

### Documentation & References

```yaml
- docfile: plan/003_bbac3b15e8d0/architecture/r4-widget-pi-api.md
  why: §2 — the composition seam (nested proxies safe; get/set/has forwarding; getLines/getCursor
       named as the live-state source); §5 — key interception technique (consume = return without
       delegating; matchesKey exported) and "the widget path does not depend on pi-tui's request
       cadence" (that is WHY Tab must resolve against the live state, not a provider round-trip).
  section: §2 and §5

- file: src/pi/widget.ts
  why: THE file to extend. S1 (implementing in parallel per its PRP) adds decideWidgetKey +
       the widget proxy whose handleInput currently returns { action: "forward" } for Tab/Enter.
       WidgetState (T1.S2: visible/items/highlightIndex/hide/set) and widgetMachineOf
       (VisibilityMachine with onDismissed) already exist in this file.
  pattern: replace the forward branch for Tab ("tab-insert") and Enter ("dismiss-forward") inside
           the wiring handleInput; keep decideWidgetKey's other actions byte-identical
  gotcha: delegate non-consumed keys to the ENTER-SUBMIT proxy (es.handleInput), never raw inner —
          the input clock and Enter guard must stay in the chain

- file: src/pi/editor.ts
  why: createEnterSubmitEditor guard = the dismiss-then-forward template (isSubmitKey +
       isShowingAutocomplete + cancelAutocomplete then delegate). isSubmitKey is currently a
       module-private const — EXPORT it (or add a local duck-typed twin) so widget.ts reuses it.
  pattern: fully defensive optional-chaining + try/catch — "worst case inert, never broken"
  gotcha: never re-implement the guard; the widget only adds the widget-line dismissal before it

- file: node_modules/@earendil-works/pi-tui/dist/components/editor.d.ts
  why: verified public mutation surface: getLines() (l.105), getCursor(): {line, col} (l.106),
       setText(text) (l.110 — undoable, cancels autocomplete, cursor → END of buffer),
       insertTextAtCursor(text) (l.116 — inserts only, cannot delete a span),
       setCursorCol (l.139 — PRIVATE but present at runtime; call defensively via optional cast).
  critical: setText parks the caret at buffer end — the caret fix in step 5 is MANDATORY for
            mid-line correctness; there is no public delete-span API, hence setText.

- file: node_modules/@earendil-works/pi-tui/dist/components/editor.js
  why: stock applyCompletion consumption (~l.545/560/1906): lines/cursorLine/cursorCol writes +
       setCursorCol + onChange(getText()) — the semantics being reimplemented. The single-item
       forced fast path (~l.1903) shows the exact write sequence to mirror.
  gotcha: pi-tui also calls this.onChange(getText()) after applying — check whether the widget
          must too (setText does NOT fire onChange; fire it defensively if present: not required
          for the input flow, note as a verify item — live-verify in P1.M3.T4.S1)

- file: src/pi/provider.ts
  why: the word-fragment regex contract — threshold pattern /[A-Za-z][A-Za-z0-9_-]*$/ (l.105,
       hyphen-admitting) and the trigger pattern with regex-escaped triggerChar (l.83-91).
       Import/reuse extractMatchState rather than re-deriving: it returns {mode, fragment, prefix}
       and prefix LENGTH on the cursor line gives the span (prefix = "#frag" or "frag").
  gotcha: extractMatchState applies config.threshold — the widget may be visible with a fragment
          below threshold (chain zero-char / trigger modes); derive the span by re-matching the
          SAME two regexes rather than gating on extractMatchState's non-null. Cleanest: reuse
          extractMatchState when non-null (span = its prefix at the cursor), else fall back to the
          raw trigger regex with zero-length fragment, else forward.

- file: test/editor-enter.test.ts
  why: the recording-stub pattern (fakeInner with calls[], KeybindingsLike stub, menuOpen
       toggles) AND the never-mutate set-trap pin. Extend it for the widget double + reuse the
       stub wholesale in test/widget.test.ts.

- file: plan/003_bbac3b15e8d0/P1M3T3S1/PRP.md
  why: CONTRACT for what exists when this task starts: decideWidgetKey + widget proxy wiring,
       WidgetKeyDeps {widgetState, visibility} optional, Tab/Enter currently forward. This task
       replaces exactly those two forward branches and must not disturb the arrows/Esc/clamp logic.
  gotcha: S1 lands in parallel — assume its PRP exactly; coordinate only on the shared
          handleInput wiring point (its Task-2 wiring function).

- file: plan/003_bbac3b15e8d0/P1M3T2S1/PRP.md (+ src/pi/widget.ts VisibilityMachine)
  why: CONTRACT for onDismissed(explicit) / suppressUntilWordStart. Enter and Tab-insert are
       EXPLICIT dismissals → onDismissed(true). Disqualification closes (explicit=false) stay the
       machine's own; never call onDismissed(false) from the key layer.
```

### Current Codebase tree (relevant)

```
src/pi/
  editor.ts     # enter-submit proxy; isSubmitKey (module-private — export it)
  widget.ts     # WidgetState, VisibilityMachine, render line, factory (S1: decideWidgetKey + key proxy)
  provider.ts   # extractMatchState / trigger+word regexes (span contract)
test/
  editor-enter.test.ts   # stub pattern + set-trap pin
  widget.test.ts         # T1.S2 render suite + S1 key clauses (extend here)
```

### Desired additions

```
src/pi/widget.ts           # EXTEND: Tab insert + Enter dismiss-then-forward branches
src/pi/editor.ts           # MINIMAL: export isSubmitKey (no behavior change)
test/widget.test.ts        # EXTEND: Tab/Enter/insertion/never-mutate clauses
test/editor-enter.test.ts  # EXTEND: proxy-double clauses under the widget layer
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: never write an own property on the inner editor (v1 RangeError recursion crash).
//   CALLING its methods — setText, getCursor, even the private-marked setCursorCol via a
//   defensive optional cast — is fine and is the sanctioned "public methods" route the spec names.
// CRITICAL: setText() puts the caret at END of buffer (setTextInternal default "end"). The caret
//   fix (spanStart + display.length) is mandatory; do it defensively (?.(), try/catch).
// GOTCHA: setText pushes its own undo snapshot — do NOT add another; do not touch undoStack.
// GOTCHA: Tab resolves against the LIVE WidgetState set — never a debounce-gated copy; zero
//   timers/awaits on the insert path (spec rule 0/1).
// GOTCHA: consume = return without delegating; forward = es.handleInput?.(data) (enter-submit
//   proxy, NOT raw inner). onKeystroke already ticked by S1's wiring before the branch — keep it.
// GOTCHA: keybindings.matches(data, "tui.input.submit") is the submit key test — reuse
//   isSubmitKey from editor.ts (export it) so custom keybindings work; raw "\r" is only fallback.
// GOTCHA: the trigger span INCLUDES the trigger char ("#frag" → whole thing replaced);
//   regex-escape triggerChar before building the pattern (provider.ts l.84 pattern).
// GOTCHA: insert the candidate DISPLAY casing (spec h2.30: nrel → NREL), never the typed casing.
// GOTCHA: after a consumed Tab (text changed, no inner handling), call tui.requestRender?.()
//   defensively — the factory closure holds tui (signature (tui, theme, keybindings)).
// GOTCHA: empty rendered list or absent candidate → forward Tab verbatim (literal Tab, never
//   menu-open of any kind).
// GOTCHA: ESM ".js" import suffixes in tests/imports — repo convention.
// GOTCHA: do NOT call onDismissed(false) from the key layer — only true (explicit).
```

## Implementation Blueprint

### Data model

```ts
// src/pi/widget.ts — decision shapes (extend S1's WidgetKeyDecision consumers, don't fork them)
// S1's decideWidgetKey already returns { action: "forward" } for Tab/Enter while visible.
// S2 adds two NEW actions so the decision function stays the single source:
//   { action: "tab-insert" }   when matchesKey(data, "tab") && visible && count > 0
//   { action: "enter-submit" } when isSubmitKey(data, keybindings) && visible && count > 0
// (fall through to forward when count === 0 or hidden — literal-Tab/no-op rules)
```

### Implementation Tasks (ordered)

```yaml
Task 1: EXPORT isSubmitKey from src/pi/editor.ts
  - CHANGE: `const isSubmitKey` → `export const isSubmitKey` (behavior identical)
  - VERIFY: npm test (editor-enter suite untouched-green) — this is the only editor.ts change

Task 2: EXTEND decideWidgetKey (src/pi/widget.ts)
  - ADD "tab-insert" and "enter-submit" actions per the table above; needs keybindings passed in
    (extend its params: decideWidgetKey(data, visible, count, highlightIndex, keybindings?) —
    optional so S1's table tests keep compiling; Enter without keybindings falls back via
    isSubmitKey's own raw-"\r" default)
  - KEEP arrows/Esc/clamp/forward semantics byte-identical (S1 contract)

Task 3: IMPLEMENT insertHighlighted (src/pi/widget.ts)
  - Pure-ish helper taking (inner, widgetState, config) — steps 1–8 of "What/Tab":
    getLines/getCursor → span via extractMatchState-else-raw-trigger-regex → setText →
    defensive setCursorCol caret fix → hide() + onDismissed(true) → tui.requestRender?.()
  - FULLY defensive: any missing member / regex failure / throw → fall back to FORWARDING the
    Tab (never break input; editor.ts failure model)
  - RETURNS: consumed (no delegation) on success; delegates on fallback

Task 4: WIRE the two new branches in the widget proxy's handleInput
  - tab-insert    → insertHighlighted(...); return (consume) — or its forward fallback
  - enter-submit  → widgetState.hide(); visibility.onDismissed(true); return es.handleInput?.(data)
  - EVERYTHING ELSE: S1's existing actions untouched (navigate/boundary-esc/clamp/escape/forward)
  - onKeystroke tick stays FIRST (S1 ordering)

Task 5: EXTEND test/widget.test.ts (spec §09 clauses)
  - FOLLOW pattern: existing widget key tests + editor-enter.test.ts stub; inner wrapped in a
    Proxy whose set trap THROWS (never-mutate pin)
  - CASES:
    * Tab inserts highlighted word: seed widgetState {visible, items:["zendesk","zephyr"],
      highlightIndex}; inner stub getLines/getCursor/setText/setCursorCol recording; feed "\t";
      assert setText called with the line's span replaced by items[highlightIndex].display, caret
      = spanStart + display.length, hide + onDismissed(true) recorded, inner.handleInput NOT
      called, requestRender called
    * highlightIndex drives which item inserts (index 1 → zephyr); display casing used, not typed
    * trigger span: line "foo #ze" cursor after "ze" → inserted line "foo zendesk" (the "#ze"
      replaced wholesale — trigger char consumed)
    * word span with hyphens: "load-b" + candidate "load-balancer" → whole "load-b" replaced
    * zero-length trigger fragment "#" alone → inserts top candidate
    * synchronous: use vi.useFakeTimers, insert immediately with NO timer advance (never
      debounce-gated)
    * Tab with empty list / hidden → forwards verbatim exactly once (literal Tab)
    * Enter while visible: hide + onDismissed(true) recorded once, then inner receives "\r"
      exactly once (dismiss-then-forward ordering: assert dismissal precedes the inner call)
    * Enter while hidden → forwards (S1 regression stays green)
    * setCursorCol missing on the stub → insert still succeeds, no throw (defensive fallback)
    * never-mutate pin: zero set-trap hits across the ENTIRE file (S1 + S2 cases)

Task 6: EXTEND test/editor-enter.test.ts (the proxy double under the widget layer)
  - CASES (spec §09 "Enter-submits proxy" + this task's contract):
    * compose createWidgetEditorFactory around the enter-submit composition with stub deps;
      Enter + open WORD menu on the inner stub → cancel then delegate exactly once (stock guard
      preserved under the widget layer — the widget adds dismissal, never replaces the guard)
    * slash menus untouched (guard skips them); closed menus untouched; non-submit keys untouched
    * thenable guard: (proxy as any).then === undefined on BOTH layers
    * onKeystroke fires for EVERY input event — including consumed keys (Tab insert, arrows):
      assert the clock callback count equals the number of fed events
    * throwing onKeystroke never breaks input (feed text after a throwing tick — inner still
      receives it)
    * inner instance never mutated (set-trap pin)
```

### Key implementation sketch

```ts
// src/pi/widget.ts
import { isSubmitKey, type KeybindingsLike } from "./editor.js";
import { extractMatchState } from "./provider.js";

function insertHighlighted(
  innerAny: EditorLike, widgetState: WidgetState, visibility: VisibilityMachine,
  config: HapaxConfig, requestRender?: () => void,
): boolean { // false → caller must forward the Tab
  try {
    const items = widgetState.items;
    if (!widgetState.visible || items.length === 0) return false;
    const idx = Math.min(Math.max(widgetState.highlightIndex, 0), items.length - 1);
    const display = items[idx]?.display ?? items[idx]?.value; // per WidgetState item shape (T1.S2)
    if (typeof display !== "string" || display === "") return false;

    const lines = (innerAny.getLines as () => string[])?.();
    const cur = (innerAny.getCursor as () => { line: number; col: number })?.();
    if (!lines || !cur) return false;
    const { line, col } = cur;
    if (line < 0 || line >= lines.length) return false;
    const before = lines[line].slice(0, col);

    // Span: stock applyCompletion semantics, reimplemented (no provider on this path)
    let spanLen: number;
    const st = extractMatchState(lines, line, col, config);
    if (st) spanLen = st.prefix.length;
    else if (config.triggerChar !== "") {
      const esc = config.triggerChar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      spanLen = before.match(new RegExp(`(?:^|[ \\t])${esc}([^\\s${esc}]*)$`))?.[0].length ?? 0;
    } else spanLen = 0;
    if (spanLen === 0 && !before.match(/[A-Za-z][A-Za-z0-9_-]*$/)) return false;

    const start = col - spanLen;
    const newLine = before.slice(0, start) + display + lines[line].slice(col);
    const newLines = lines.slice(); newLines[line] = newLine;
    (innerAny.setText as (t: string) => void)?.(newLines.join("\n"));
    // caret fix — setText parks the cursor at buffer END (setTextInternal "end")
    try {
      (innerAny.setCursorCol as ((c: number) => void) | undefined)?.(start + display.length);
    } catch { /* degrade: cursor at end (correct when typing at end) */ }

    widgetState.hide();
    visibility.onDismissed(true);          // EXPLICIT dismissal → suppress
    try { requestRender?.(); } catch { /* never break on repaint */ }
    return true;                            // consumed
  } catch { return false; }                 // forward on any failure
}
```

### Integration Points

```yaml
CONSUMED (do not rebuild):
  - WidgetState (T1.S2): items/highlightIndex/visible/hide()
  - VisibilityMachine (T2.S1): onDismissed(true) owns suppressUntilWordStart
  - createEnterSubmitEditor (editor.ts): unchanged except exporting isSubmitKey
  - decideWidgetKey (S1): extended with two actions, arrows/Esc semantics preserved

CONSUMERS (do NOT implement here):
  - P1.M3.T4.S1 live TTY verification (binding): Tab insert + Enter submit against the REAL
    extension stack (pi-vim + split-editor) — the caret fix and onChange question are its
    verify items
  - M2 chain arming on Tab acceptance: the chain machine reads acceptance via its own seam;
    this task's onDismissed(true) + insert is the event surface it observes later
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check          # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npm test -- test/widget.test.ts
npm test -- test/editor-enter.test.ts
npm test                # full suite green — S1 clauses, render suite, index/provider untouched
```

### Level 3: Integration

None for this task — stub-level composition only. Live TTY verification is P1.M3.T4.S1 (binding; caret placement and onChange-under-widget are its flagged verify items).

## Final Validation Checklist

- [ ] `npm run check` clean; `npm test` fully green
- [ ] Tab inserts the highlighted item's display casing synchronously (fake timers, zero advance)
- [ ] Span replacement correct for: plain word, hyphenated fragment, `#fragment` (char consumed), bare `#`
- [ ] Caret lands after the insertion (setCursorCol fix; defensive fallback verified by test)
- [ ] Tab with empty/hidden list forwards verbatim; Tab never opens anything
- [ ] Enter while visible: dismiss + suppress, then forward exactly once (inner submits)
- [ ] Enter/slash/closed-menu/non-submit behavior of the enter-submit guard preserved under the widget layer
- [ ] `then` === undefined on both proxy layers; onKeystroke fires for every event incl. consumed; throwing hook never breaks input
- [ ] Inner instance never mutated (set-trap throw pin, zero hits across both test files)
- [ ] Only changes: widget.ts (branches + insertHighlighted), editor.ts (export isSubmitKey), the two test files
- [ ] No fallback-path (provider) code touched

## Anti-Patterns to Avoid

- ❌ Don't write own properties on the inner editor — method calls only (v1 recursion crash)
- ❌ Don't route consumed keys to `inner.handleInput` or non-consumed keys anywhere but `es.handleInput`
- ❌ Don't gate Tab on the debounce/painted set — the LIVE WidgetState set is the contract
- ❌ Don't insert typed casing or a key — display casing, always
- ❌ Don't forget the caret fix — setText parks at buffer end
- ❌ Don't re-implement the enter-submit guard — compose (dismiss, then delegate)
- ❌ Don't call onDismissed(false) from the key layer — only the machine disqualifies
- ❌ Don't break S1's arrows/Esc/clamp tests — extend decideWidgetKey, never fork it
- ❌ Don't let any failure throw to the caller — forward-on-failure is the invariant

---

**Confidence Score: 9/10** — the mutation surface (getLines/getCursor/setText/insertTextAtCursor/setCursorCol-private + setText's end-of-buffer cursor behavior) verified against editor.d.ts/editor.js source; the dismiss-then-forward template read from editor.ts; S1's exact seam pinned by its PRP; the span regex contract pinned to provider.ts lines. Residual risk (flagged for live verification): onChange notification after programmatic insert and custom-keybinding Enter variants — both covered by P1.M3.T4.S1's binding verify items.
