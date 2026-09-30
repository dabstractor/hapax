# PRP — plan 003 P1.M3.T1.S2: Widget line rendering — join, caps, overflow, highlight, zero-never

## Goal

**Feature Goal**: Implement the render half of hapax's one-line widget (spec
§07 h3.8): when the widget layer (skeleton landed by P1.M3.T1.S1 as
`createWidgetEditorFactory` in `src/pi/widget.ts`) has visible results, its
proxy `render` override appends ONE line directly below the editor's own
lines — items joined by `" | "`, rank order left→right, display strings ONLY
(no `Session ×N`, no descriptions, no chain marker), capped at both
`config.maxSuggestions` and the terminal width (the `render(width)` argument,
cached), overflow dropping the rightmost (lowest-ranked) items first, theme
accent highlight on the selected item (leftmost by default, reset on every
set change), and NEVER rendering when the candidate list is empty (invariant
3). Rendering is pure line-building; visibility decision and key handling
belong to T2/T3 — this task consumes an injected visibility/set API.

**Deliverable**:
1. New/extended `src/pi/widget.ts` — a pure
   `renderWidgetLine(items, { width, maxSuggestions, highlightIndex, accent })`
   function (string | null) + the proxy `render` override composing
   `inner.render(width)` + the widget line + a small widget-state holder
   (set/clear/hide) the visibility machine (T2) will later drive.
2. New `test/widget.test.ts` — TDD suite for join format, cap arithmetic,
   rightmost-drop, zero-never, highlight-reset-on-set-change, display-only
   items, width-cache/before-first-render behavior.

**Success Definition**: A fake inner editor whose `render(width)` returns
`["hello"]`, wrapped by the widget layer, with a 3-item set and width 40
renders exactly `["hello", "Zendesk | zephyr | zlock"]` (accent applied to
item 0); empty set or hidden state renders exactly the inner's lines
unchanged; before the first `render` call the layer caches width=undefined
and renders nothing extra; `npm run check` + `npm test` green; fallback-path
suites untouched.

## Why

- Spec §07 h2.42 (2026-10 owner rule): the widget is the PRIMARY display —
  "A result item is the candidate display string, nothing else … The line is
  words, `" | "` separators, and one highlight, nothing else." The right-hand
  frequency/provenance column is RETIRED on this path.
- Invariant 3 (h2.2): "never appears with zero candidates" — the widget line
  must be structurally absent, not blank (a blank line still shifts layout).
- `render(width)` is the ONLY width source (pi-tui's `TUI` exposes no width
  getter — verified, r4-widget-pi-api.md §2): the line cap "maxSuggestions
  AND terminal width" (spec h2.50/h3.8) therefore requires caching the last
  seen width and re-truncating whenever width changes.
- The proxy `render` override (get-trap returning an UNBOUND composing
  function instead of the inner's bound one) is novel vs pi's subclass-based
  examples — this PRP specifies it precisely; live TTY verification is
  P1.M3.T4.S1's binding job.

## What

### Behavior contract

1. **Pure renderer** — exported from `src/pi/widget.ts`:
   ```ts
   export interface WidgetLineOptions {
     width: number;              // last seen render(width) — REQUIRED
     maxSuggestions: number;     // config.maxSuggestions (1–20, already clamped)
     highlightIndex: number;     // 0-based into the RENDERED (post-truncate) list
     accent: (text: string) => string;  // theme-selected-text styler
   }
   /** Build the one-line widget. Returns null when items is empty —
    *  the caller then renders NOTHING (invariant 3). */
   export function renderWidgetLine(
     items: readonly { display: string }[],
     opts: WidgetLineOptions,
   ): string | null;
   ```
   Rules:
   - `items.length === 0` → `null` (line structurally absent).
   - Cap 1 (count): take at most `maxSuggestions` items, leftmost first
     (input is rankMatches output — already rank-ordered).
   - Cap 2 (width): greedily join left→right with `" | "`; an item is
     admissible only if the joined line WITH it (including its separator)
     still fits in `width`; overflow DROPS THE RIGHTMOST (lowest-ranked)
     items first — never ellipsis, never wrap, never truncate a word.
     Always keep ≥1 item if at least one item alone fits; if not even the
     first item fits, render `null` (equivalent to zero candidates — a line
     that can't hold a word must not exist).
   - Highlight: apply `accent(item.display)` to the item at
     `highlightIndex` (clamped into the rendered list); all others plain.
   - Output is ANSI-styled text via `accent` — length arithmetic must run on
     the PLAIN strings, styling applied after (styled length ≠ display
     length).
2. **Widget state holder** — internal to widget.ts, but with a minimal
   exported seam for this task and T2/T3:
   ```ts
   export interface WidgetState {
     /** Replace the result set (resets highlightIndex to 0 — spec h3.8). */
     set(items: readonly { display: string }[]): void;
     /** Hide the line (dismiss/suppress/zero) — renders nothing. */
     hide(): void;
     /** 0-based highlight index within the CURRENT rendered list. */
     highlightIndex: number;
   }
   ```
   `set()` always resets `highlightIndex = 0` (spec: "resets to [leftmost]
   on every result-set change"). Highlight MOVEMENT (arrows) is T3's API —
   a plain mutable `highlightIndex` field suffices here.
3. **Proxy render override** — inside the widget layer (extending S1's
   skeleton composition around `createEnterSubmitEditor`): the Proxy `get`
   trap, for `"render"`, returns an UNBOUND function
   `(width: number) => string[]` that:
   - caches `lastWidth = width` (the only width source);
   - calls the inner's render: `const lines = inner.render(width);`
   - if state is hidden OR set is empty → return `lines` UNCHANGED (byte
     identical; before the first call width is undefined → nothing appended);
   - else appends `renderWidgetLine(items, { width: lastWidth,
     maxSuggestions: config.maxSuggestions, highlightIndex,
     accent })` — returning `null` means return `lines` unchanged;
   - NEVER calls `.bind(inner)` for this member and never returns the
     inner's own `render` reference (the composing function must be a fresh
     closure each read; pi-tui must not see a cached identity — r4 §2 risk
     note).
   `accent` comes from the `theme` argument the factory received:
   `theme.selectList.selectedText` (EditorTheme's selected-text styler —
   verified shape: `EditorTheme { borderColor, selectList:
   SelectListTheme }`, `SelectListTheme.selectedText: (text: string) =>
   string`, node_modules/@earendil-works/pi-tui/dist/components/editor.d.ts
   + select-list.d.ts). Capture `theme` inside the factory wrapper closure.
4. **Repaint strategy**: PREFER the natural per-keystroke render (pi-tui
   renders on every input event; the display swap rides the existing 100 ms
   debounce from the shared timing config). Do NOT capture `tui` or call
   `tui.requestRender()` in this task (fewer moving parts; work-item
   instruction). If T2's visibility machine later needs forced repaints,
   that is its decision.
5. **No key handling, no visibility logic** here — the widget state's
   `set/hide` are driven in this task's tests directly; T2 wires the real
   visibility machine, T3 the keys.

### Success Criteria

- [ ] Join format `" | "`, rank order left→right, never wraps
- [ ] Cap = maxSuggestions AND cached width; overflow drops rightmost first
- [ ] Zero candidates / hidden → inner lines returned unchanged (no blank line)
- [ ] Highlight on leftmost by default; reset to 0 on every `set()`
- [ ] Items are `display` strings only — no description, no count, no marker
- [ ] Before first render (width unknown) nothing is appended
- [ ] Fallback path (provider) untouched; `npm run check` && `npm test` green

## All Needed Context

### Documentation & References

```yaml
- docfile: plan/003_bbac3b15e8d0/architecture/r4-widget-pi-api.md
  why: THE technique reference — §1 border-status-editor render(width)
        composition, §2 the proxy get-trap render-override technique (unbound
        composing function; render(width) as the only width source; tui is
        protected; requestRender exists but is not needed per-keystroke),
        §2/§6 the "novel proxy render override" risk flag → live verify in
        P1.M3.T4.S1
  section: §1 "How border-status-editor.ts renders a line", §2 last two
           paragraphs, §6 Risks

- docfile: plan/003_bbac3b15e8d0/P1M3T1S1/PRP.md
  why: CONTRACT for the skeleton this task extends — createWidgetEditorFactory
        opts (inner/store/config/chain/restoreReady/onKeystroke), WIDGET_WRAPPED
        marker, "compose widget layer AROUND createEnterSubmitEditor", the
        comment naming this task: "P1.M3.T1.S2 overrides render (append the
        one-line widget below the editor's lines)"
  section: "What" §2 (widget.ts skeleton shape)

- file: src/pi/editor.ts
  why: the Proxy pattern to extend — createEnterSubmitEditor's get trap
        (then→undefined; handleInput→guard; everything else→inner value,
        functions .bind(inner)); wrapEditorFactory(wrapEditorFactory ~L148–152);
        isEnterSubmitWrapper's WRAPPED symbol
  pattern: the render override lives in the WIDGET layer's proxy, which
           wraps the enter-submit proxy (nested proxies are safe — neither
           mutates the inner; r4 §2)
  gotcha: NEVER mutate the inner instance (v1 recursion crash, module header)

- file: src/core/types.ts
  why: RankedMatch (L164–176+) — the item shape this renderer consumes:
        { key, display, description, salience, sessionCount } — RENDER ONLY
        `display`
  gotcha: rankMatches output is already final-ranked (compareRankedMatches
          order) — do not re-sort

- file: src/pi/config.ts
  why: config.maxSuggestions (1–20 clamped, default 8) — read at render time
        from the HapaxConfig the widget factory received (S1 opts.config)

- file: node_modules/@earendil-works/pi-tui/dist/components/editor.d.ts
  why: EditorTheme shape (L25–28: borderColor + selectList) — the accent is
        theme.selectList.selectedText, captured from the factory's theme arg
  gotcha: EditorTheme has NO accent member of its own — selectedText IS the
          accent channel pi-tui itself uses for highlighted items

- file: node_modules/@earendil-works/pi-tui/dist/components/select-list.d.ts
  why: SelectListTheme (L7–13) — selectedText/selectedPrefix stylers,
        confirms (text)=>string signature

- file: test/editor-enter.test.ts
  why: house pattern for proxy/editor tests — fake inner editors, recording
        doubles, "inner never mutated" pins
  pattern: construct a minimal fake inner object with render/getLines/etc.
           and assert the proxy's composed output

- file: test/provider-display.test.ts
  why: house pattern for debounce/timing tests (100 ms swap, vi.useFakeTimers)
        — the widget's set() cadence will ride the same timing in T2; this
        task's tests stay synchronous/pure
```

### Desired Codebase tree with files to be added/changed

```bash
src/pi/widget.ts        # S1 created (skeleton); THIS TASK adds
                        # renderWidgetLine + WidgetState + proxy render override
test/widget.test.ts     # NEW — this task's TDD suite (file named by spec h2.55)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: render(width) is the ONLY width source — TUI exposes no width
// getter. Cache lastWidth on every call; before the first render width is
// unknown → append NOTHING.
// CRITICAL: length arithmetic must use PLAIN display strings; apply the
// accent styler only when building the final output (ANSI codes inflate
// .length and would corrupt the width fit).
// CRITICAL: the proxy get trap must return an UNBOUND composing closure for
// "render" — do not fall through to the default `.bind(inner)` path for
// this member, and do not memoize the function (identity stability is not
// guaranteed to consumers; examples subclass instead).
// CRITICAL: empty items → line STRUCTURALLY ABSENT (no blank-line append) —
// invariant 3. Same for hidden state and width-unfit single item.
// CRITICAL: relative imports need .js extensions (NodeNext:
// "../src/pi/widget.js" in tests, "./editor.js" inside src).
// Drop the RIGHTMOST item on overflow (lowest rank) — never truncate a word,
// never add "…".
// set() always resets highlightIndex to 0 — "highlight resets to top on
// every set change" (spec h2.55 widget tests).
// Do not touch tui/requestRender in this task (natural per-keystroke render;
// decision recorded in r4 §6 Risks + this work item's RESEARCH NOTE).
```

## Implementation Blueprint

### Data models and structure

```ts
// src/pi/widget.ts (additions)
export interface WidgetLineOptions {
  width: number;
  maxSuggestions: number;
  highlightIndex: number;
  accent: (text: string) => string;
}

export interface WidgetState {
  set(items: readonly { display: string }[]): void; // resets highlight
  hide(): void;
  highlightIndex: number;
}

export function renderWidgetLine(
  items: readonly { display: string }[],
  opts: WidgetLineOptions,
): string | null;
```

No store/query types are imported by the renderer — it takes plain
`{ display }` shapes (RankedMatch satisfies it structurally), keeping the
pure function free of core coupling.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE the pure renderer in src/pi/widget.ts
  - IMPLEMENT renderWidgetLine per contract §1: zero→null; count cap
    (slice leftmost maxSuggestions); greedy width fit left→right with
    " | " separators, drop rightmost-first; single-unfit-item→null;
    highlight via accent at clamped highlightIndex
  - JSDoc: spec §07 h3.8/h2.50 citations; plain-length-then-style note
  - TDD: write test/widget.test.ts cases 1–6 (below) FIRST or alongside

Task 2: CREATE WidgetState in src/pi/widget.ts
  - IMPLEMENT set()/hide()/highlightIndex per contract §2; set() resets
    highlight to 0; internal items array (copied on set — never alias the
    caller's array); hide() clears items
  - TESTS: highlight-reset-on-set-change; hide renders nothing

Task 3: MODIFY the widget proxy (S1 skeleton) — render override
  - IN the widget layer's Proxy get trap, intercept "render": return an
    unbound (width) => string[] closure composing inner.render(width) +
    renderWidgetLine(state items, cached width, config.maxSuggestions,
    highlightIndex, accent); null → lines unchanged
  - CAPTURE `theme` (from the factory wrapper's (tui, theme, kb) args) →
    accent = theme.selectList.selectedText; keep a module-level fallback
    ((t) => t) if theme is structurally absent in tests
  - PRESERVE: everything else in the get trap forwards verbatim; the
    enter-submit guard, WIDGET_WRAPPED marker, and onKeystroke clock are
    S1's — untouched
  - TESTS: fake inner editor (render: vi.fn((w) => ["hello"])) wrapped by
    the widget factory output; assert composed lines, unchanged lines on
    empty/hidden, width caching (two renders with different widths →
    re-truncation), and that the returned render is a distinct function
    object each read

Task 4: CREATE test/widget.test.ts — the full TDD suite
  - FOLLOW pattern: test/editor-enter.test.ts (proxy doubles, never-mutate
    pins); NodeNext .js imports; vitest describe/it
  - CASES:
    1. join format: 3 items, wide width → "A | B | C", rank order
       left→right (input order preserved)
    2. count cap: 10 items, maxSuggestions 8, wide width → first 8 only
    3. width cap + rightmost-drop: width fits 2 of 3 items (compute the
       exact joined lengths in the test) → only the 2 leftmost render;
       narrower width fits 1 → leftmost only; width < first item → null
    4. zero-never: empty items → null; wrapped proxy with empty set →
       lines identical to inner's (and length unchanged — no blank line)
    5. highlight: accent applied to highlightIndex item only (spy accent
       fn); highlightIndex clamped when post-truncation list is shorter
       than the index
    6. highlight-reset-on-set-change: set([a,b]), move index (mutate
       state.highlightIndex), set([c,d]) → highlight back on c
    7. display-only: items carry description/sessionCount — output string
       contains ONLY display strings (no "session", no "chain", no "×")
    8. width cache: wrapped proxy render(40) then render(20) → second call
       re-truncates to the 20-width line
    9. before-first-render + set() called first: still nothing appended
       (width unknown)
    10. inner never mutated: the fake inner's own props (render identity,
        lines) untouched after wrapping and rendering (v1 pin, mirroring
        editor-enter tests)
  - NAMING: describe("widget line rendering (spec §07 h3.8 — join, caps,
    overflow, highlight, zero-never)")

Task 5: VALIDATE
  - npm run check && npm test
  - Confirm fallback-path suites (provider*.test.ts) green and untouched
```

### Implementation Patterns & Key Details

```ts
// The greedy width fit (plain strings, styled only at the end):
function renderWidgetLine(items, { width, maxSuggestions, highlightIndex, accent }) {
  const capped = items.slice(0, maxSuggestions);
  const kept: string[] = [];           // plain displays
  for (const it of capped) {
    const candidate = kept.length === 0 ? it.display : kept.join(" | ") + " | " + it.display;
    if (candidate.length > width && kept.length > 0) break; // drop rightmost first
    if (candidate.length > width && kept.length === 0) return null; // can't fit one word
    kept.push(it.display);
  }
  if (kept.length === 0) return null;   // invariant 3 — no blank line
  const hi = Math.max(0, Math.min(highlightIndex, kept.length - 1));
  return kept.map((d, i) => (i === hi ? accent(d) : d)).join(" | ");
}

// The proxy render override (widget layer wrapping the enter-submit proxy):
// inside createWidgetEditorFactory's per-instance proxy get trap:
if (prop === "render") {
  return (width: number): string[] => {   // UNBOUND composing closure
    lastWidth = width;                    // the ONLY width source
    const lines = inner.render(width);
    const line = state.items.length === 0 || state.hidden
      ? null
      : renderWidgetLine(state.items, {
          width: lastWidth,
          maxSuggestions: opts.config.maxSuggestions,
          highlightIndex: state.highlightIndex,
          accent, // captured: theme.selectList.selectedText ?? ((t) => t)
        });
    return line === null ? lines : [...lines, line];
  };
}
```

### Integration Points

```yaml
CODE (no config/routes/migrations):
  - src/pi/widget.ts: pure renderer + state + proxy render override
  - src/pi/index.ts: NO changes (S1's dual-path branch already routes here)
DOWNSTREAM (this task's consumers):
  - P1.M3.T2.S1 (visibility machine) drives state.set()/hide() per
    keystroke via the onKeystroke clock + extractMatchState; may add
    requestRender if its timing needs it
  - P1.M3.T3.S1/S2 (keys) mutate state.highlightIndex and consume the
    rendered list for Tab insertion
  - P1.M3.T4.S1 live-verifies the novel proxy render override in a real TTY
UPSTREAM (contracts honored, not modified):
  - S1's WidgetLayerOptions, WIDGET_WRAPPED, enter-submit composition
  - rankMatches' RankedMatch order is final — no re-sorting here
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npm test -- test/widget.test.ts
# Expected: all 10 case groups green.

npm test
# Expected: full suite green; provider/editor suites untouched (the widget
# proxy is only exercised by widget tests; index tests still pin S1 wiring).
```

### Level 3: Composition verification

```bash
# Structural double-check that the render override composes rather than
# replaces: the widget test suite's fake inner asserts its render output is
# a PREFIX of the wrapped output (lines identical, widget line appended).
# No live TTY here — that is P1.M3.T4.S1's binding gate (spec 09
# Live-verification technique).
```

### Level 4: Live verification — DEFERRED (owned by P1.M3.T4.S1)

- The proxy-render technique is flagged novel (r4 §6 Risks); tmux scripted
  verification happens there. This task records the flag in JSDoc on the
  override ("live-verify in P1.M3.T4.S1 per spec §09").

## Final Validation Checklist

### Technical Validation
- [ ] `npm run check` clean
- [ ] `npm test` fully green

### Feature Validation
- [ ] Join `" | "`, rank order left→right, never wraps
- [ ] maxSuggestions cap AND cached-width cap; rightmost dropped first; unfittable single item → no line
- [ ] Zero candidates / hidden / pre-first-render → inner lines byte-identical (no blank line)
- [ ] Accent highlight on leftmost; clamped index; reset to 0 on every set()
- [ ] Output contains display strings only (no descriptions/counts/markers)
- [ ] Width re-fit on width change (cached width updated every render)
- [ ] Inner instance never mutated; enter-submit guard and marker intact

### Code Quality Validation
- [ ] Pure renderer decoupled from core types ({ display } structural input)
- [ ] Length arithmetic on plain strings; accent applied last
- [ ] No tui/requestRender usage in this task
- [ ] JSDoc cites spec h3.8/h2.50 and flags the P1.M3.T4.S1 live-verify

## Anti-Patterns to Avoid

- ❌ Don't render a blank line for zero candidates — structural absence is the invariant
- ❌ Don't compute width fit on ANSI-styled strings
- ❌ Don't return the inner's bound render from the get trap — return a fresh composing closure each read
- ❌ Don't truncate words or append "…" — drop whole rightmost items
- ❌ Don't re-sort items — rankMatches order is final
- ❌ Don't add visibility logic or key handling (T2/T3 own those)
- ❌ Don't capture tui or call requestRender (deferred decision)
- ❌ Don't mutate the inner editor (v1 recursion lesson)

---

**Confidence Score**: 9/10 — the technique is fully documented in
r4-widget-pi-api.md (§1–2, §6) with the exact theme member
(`selectList.selectedText`) verified against the installed pi-tui .d.ts, the
S1 skeleton contract names this task as the render-override owner, and the
pure function design keeps 9 of the 10 test cases trivially deterministic.
The single flagged risk (novel proxy render override against the real TUI)
is explicitly deferred to the binding live-verification task.
