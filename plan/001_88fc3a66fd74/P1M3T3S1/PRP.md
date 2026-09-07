# PRP — P1.M3.T3.S1: extractMatchState (trigger + threshold regexes, priority, delegation gate)

## Goal

**Feature Goal**: Implement a **pure** function `extractMatchState(lines, line, col, config)` in `src/pi/provider.ts` that decides, for the current cursor position, whether hapax should offer suggestions in *trigger mode* or *threshold mode*, or should delegate to pi's built-in completion (return `null`).

**Deliverable**: `src/pi/provider.ts` exporting `MatchState` type + `extractMatchState()`, plus `test/provider-match.test.ts` covering all PRD §09 trigger-mode cases.

**Success Definition**: All tests pass (`npm test`), `npm run check` (tsc --noEmit) clean, and the function is pure (no I/O, no state, no pi runtime dependency) so downstream tasks S2–S4 can consume it.

## Why

This is the entry point of hapax's autocomplete decision logic (PRD §07 "Trigger modes"). Every keystroke, the provider registered via `ctx.ui.addAutocompleteProvider` calls `getSuggestions(lines, cursorLine, cursorCol, options)`; S2 will call `extractMatchState` first. If it returns `null`, S2 returns `current.getSuggestions(...)` untouched — so path/slash completion keeps working exactly as before. Getting this gate exactly right is acceptance-critical (PRD "Never-hijack rules").

## What

A pure function:

```ts
export type MatchState =
  | { mode: "trigger"; fragment: string; prefix: string }
  | { mode: "threshold"; fragment: string; prefix: string };

export function extractMatchState(
  lines: string[],
  line: number,
  col: number,
  config: HapaxConfig,
): MatchState | null;
```

Semantics (PRD §07):

1. **Trigger mode** — regex `/(?:^|[ \t])#([^\s#]*)$/` on **text-before-cursor on the cursor's line only** (`lines[line].slice(0, col)`). The `#` must be at line start or after a space/tab; the fragment contains no whitespace and no further `#`. 0-char minimum: bare `#` matches with `fragment: ""`. Build the regex dynamically from `config.triggerChar`, **regex-escaped** (e.g. triggerChar `"\\", "/"`, `"+"`). `prefix = triggerChar + fragment` (trigger char is consumed on completion by pi's `applyCompletion` replacing `prefix`).
2. **Threshold mode** — regex `/[A-Za-z][A-Za-z0-9_]*$/` on text-before-cursor. Fires when fragment length ≥ `config.threshold` (1–3, default 2). Fires **everywhere** — any word start, any context, no position gating. `prefix = fragment` (bare fragment, no leading char).
3. **Priority**: trigger match wins; else threshold match; else `null` (= delegate).
4. `config.triggerChar === ""` disables trigger mode entirely (config validation allows this).
5. Out-of-range inputs (`line`/`col` not valid for `lines`) return `null` defensively.

### Success Criteria (from PRD §09)

- `#` alone → `{ mode: "trigger", fragment: "", prefix: "#" }`
- `#ze` → trigger, fragment `"ze"`
- mid-line `foo #ze` → trigger, fragment `"ze"`
- `foo#ze` → **NOT** trigger (no start/whitespace before `#`) → falls to threshold
- `##` → trigger regex does not match the `#`-in-fragment rule; result is threshold or null depending on fragment (`##` text-before-cursor ends with `#` which is not `[A-Za-z...]` → `null`)
- threshold 2, fragment `z` (1 char) → `null` (delegates)
- threshold 2, fragment `ze` → `{ mode: "threshold", fragment: "ze", prefix: "ze" }`

## All Needed Context

### Documentation & References

```yaml
- url: https://github.com/earendil-works/pi-tui (local: node_modules/@earendil-works/pi-tui/dist/autocomplete.d.ts)
  why: AutocompleteProvider contract — getSuggestions(lines, cursorLine, cursorCol, options) is async,
        returns Promise<AutocompleteSuggestions | null> where AutocompleteSuggestions = { items, prefix }.
        prefix is what the editor replaces on completion.
  critical: import type { AutocompleteProvider } from "@earendil-works/pi-tui" — TYPE-ONLY import so
            provider.ts stays unit-testable without a pi runtime.

- file: src/pi/config.ts
  why: HapaxConfig interface (triggerChar: string — one non-word non-space char or "" to disable;
        threshold: 1|2|3) and DEFAULT_CONFIG. Already validated by loadConfig, so extractMatchState
        can trust the config shape.
  pattern: module header comment style, exported interfaces, pure helpers with doc comments
  gotcha: triggerChar may be "" — trigger mode must be skipped, not matched against a "/" regex.

- file: test/config.test.ts
  why: test file conventions — vitest describe/it, header doc comment explaining scope, fixtures
        and edge-case tables.
  pattern: import from "../src/pi/config.js" (ESM .js suffix); follow the same for provider.

- file: plan/001_88fc3a66fd74/P1M3T2S3/PRP.md
  why: sibling task building src/pi/ingest.ts session restore. No code dependency — extractMatchState
        shares only HapaxConfig. Do not touch ingest.ts.
```

### Current Codebase tree (relevant part)

```
src/
  core/           # pure pipeline: segment, shapeGate, score, store, query, dictionary, types
  pi/
    config.ts     # DONE (P1.M3.T1.S1) — HapaxConfig, loadConfig
    ingest.ts     # in progress (P1.M3.T2) — not touched by this task
    index.ts      # extension entry (future P1.M3.T5) — not touched by this task
test/
  config.test.ts, ingest.test.ts, ... (vitest, --run mode)
package.json      # scripts: check = tsc --noEmit, test = vitest --run
```

### Desired additions

```
src/pi/provider.ts          # NEW: MatchState type + extractMatchState (pure)
test/provider-match.test.ts # NEW: unit tests for extractMatchState
```

### Known Gotchas

```ts
// CRITICAL: regex-escape triggerChar when building the trigger regex:
//   const esc = config.triggerChar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//   new RegExp(`(?:^|[ \\t])${esc}([^\\s${esc}]*)$`)
//   (for "#" the char class is [^\s#] as specified in PRD §07).
// GOTCHA: only inspect the CURRENT line: textBeforeCursor = lines[line].slice(0, col).
//   Never join lines — pi passes the full buffer but the regexes are line-local.
// GOTCHA: 'foo#ze' must NOT trigger: (?:^|[ \t]) anchors the trigger char to start/whitespace.
//   It should still fall through to threshold matching (fragment 'ze' etc. at that position —
//   threshold regex matches the trailing identifier regardless of preceding '#').
// GOTCHA: '##' — the trigger char class [^\s#] excludes '#', so the second '#' kills the match;
//   text ends with '#' which fails [A-Za-z] start → returns null (delegate).
// GOTCHA: config.threshold is already clamped to 1–3 by config.ts; do not re-validate.
// GOTCHA: col may equal line length (cursor at EOL) — slice(0, col) handles this naturally.
// GOTCHA: ESM imports in this repo use ".js" suffixes (e.g. "../src/pi/provider.js" in tests).
// CRITICAL: extractMatchState must remain SYNCHRONOUS and PURE — S3's debounce machinery and
//   S4's acceptance tests depend on it having no side effects.
```

## Implementation Blueprint

### Data model

```ts
// src/pi/provider.ts
import type { HapaxConfig } from "./config.js";

export type MatchState =
  | { mode: "trigger"; fragment: string; prefix: string }
  | { mode: "threshold"; fragment: string; prefix: string };
```

### Implementation Tasks (ordered)

```yaml
Task 1: CREATE src/pi/provider.ts
  - IMPLEMENT: MatchState union type + extractMatchState(lines, line, col, config): MatchState | null
  - STRUCTURE: module doc comment (PRD §07 trigger modes + this task), then:
      1. defensive bounds check on line/col (return null if invalid)
      2. const before = lines[line].slice(0, col)
      3. trigger pass (skipped when config.triggerChar === "")
      4. threshold pass
      5. return null
  - FOLLOW pattern: src/pi/config.ts (doc comments, exported pure functions, no pi imports)
  - NAMING: extractMatchState, MatchState — exactly as the contract states (S2/S3/S4 import these names)
  - TYPE-ONLY imports only; NO runtime pi-tui import in this file

Task 2: CREATE test/provider-match.test.ts
  - IMPLEMENT: describe("extractMatchState") with cases:
      * '#', '#ze', 'foo #ze' → trigger mode, correct fragment/prefix
      * 'foo#ze' → NOT trigger (threshold or null per threshold rules)
      * '##' → null
      * threshold 2: 'z' → null; 'ze' → threshold match prefix 'ze'
      * threshold 1 and 3 boundary cases
      * triggerChar "" → trigger mode never fires (e.g. '#ze' falls to threshold)
      * non-default triggerChar (e.g. '+', '\\') regex-escaping works
      * col at EOL, col 0, out-of-range line/col → null
      * word-start everywhere for threshold: 'foo/bar' with cursor after 'bar' → threshold fragment 'bar'
  - FOLLOW pattern: test/config.test.ts (header doc comment, vitest style, .js import suffix)
  - NAMING: test names state input → expected outcome (project convention)
  - PLACEMENT: test/provider-match.test.ts
```

### Key implementation sketch

```ts
export function extractMatchState(
  lines: string[], line: number, col: number, config: HapaxConfig,
): MatchState | null {
  if (line < 0 || line >= lines.length) return null;
  const text = lines[line];
  if (col < 0 || col > text.length) return null;
  const before = text.slice(0, col);

  // Trigger mode (PRD §07 rule 1) — regex built from escaped triggerChar
  if (config.triggerChar !== "") {
    const esc = config.triggerChar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = before.match(new RegExp(`(?:^|[ \\t])${esc}([^\\s${esc}]*)$`));
    if (m) {
      return { mode: "trigger", fragment: m[1], prefix: config.triggerChar + m[1] };
    }
  }

  // Threshold mode (PRD §07 rule 2) — fires everywhere, any word start
  const t = before.match(/[A-Za-z][A-Za-z0-9_]*$/);
  if (t && t[0].length >= config.threshold) {
    return { mode: "threshold", fragment: t[0], prefix: t[0] };
  }

  return null; // DELEGATE: S2 must return current.getSuggestions(...) unchanged
}
```

### Integration Points

```yaml
CONSUMERS (do NOT implement here):
  - S2 (P1.M3.T3.S2): calls extractMatchState inside getSuggestions; on null → delegate
  - S3 (P1.M3.T3.S3): debounce/hysteresis wraps S2's query
  - S4 (P1.M3.T3.S4): acceptance tests import extractMatchState for delegation cases
NO changes to: config.ts, ingest.ts, src/core/*, package.json, tsconfig.json
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check        # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npm test -- test/provider-match.test.ts   # all extractMatchState cases green
npm test                                   # full suite still green (no regressions)
```

### Level 3: Integration

None for this task — pure function, no pi runtime. S4/P1.M4.T1 handle end-to-end acceptance.

## Final Validation Checklist

- [ ] `npm run check` clean
- [ ] `npm test` all pass, including new test/provider-match.test.ts
- [ ] All §09 success criteria cases covered: `#`, `#ze`, `foo #ze`, `foo#ze`, `##`, threshold-2 `z`→null / `ze`→match
- [ ] extractMatchState is pure & synchronous; no runtime pi imports in provider.ts
- [ ] `null` correctly means delegate (no suggestion interception)
- [ ] triggerChar `""` disables trigger mode; escaping verified for `+` and `\`
- [ ] No files other than src/pi/provider.ts and test/provider-match.test.ts created/modified

## Anti-Patterns to Avoid

- ❌ Don't build the trigger regex from raw `triggerChar` without escaping — `+`, `\`, `/` would break or throw
- ❌ Don't join all lines or inspect other lines — regexes apply to the cursor's line only
- ❌ Don't gate threshold mode on whitespace/position — PRD explicitly settles "fires everywhere"
- ❌ Don't make extractMatchState async or stateful — S3's flicker machinery assumes purity
- ❌ Don't re-validate/clamp config — loadConfig (P1.M3.T1.S1) already guarantees the shape

---

**Confidence Score: 9/10** — contract fully specified, pi-tui types verified locally, config interface read, test conventions identified. The only residual risk is pi calling getSuggestions with multi-line semantics, but text-before-cursor on the cursor line is exactly what the PRD's regexes target.