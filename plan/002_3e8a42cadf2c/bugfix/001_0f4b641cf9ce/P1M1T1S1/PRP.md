# PRP — P1.M1.T1.S1 (bugfix 001_0f4b641cf9ce): classifyStockContext pure helper with unit tests

---

## Goal

**Feature Goal**: Add an exported, pure `classifyStockContext(lines,
cursorLine, cursorCol)` helper to `src/pi/provider.ts` that detects when the
cursor sits in a context pi's built-in completion owns (slash command,
@-mention, quoted path, unquoted path). It returns a non-null classification
exactly when hapax must delegate — the first half of the BUG-001 fix; the
`getSuggestions` wiring is P1.M1.T1.S2, NOT this task.

**Deliverable**:
- `export type StockContext = "slash" | "mention" | "quoted-path" | "path" | null`
- `export function classifyStockContext(lines, cursorLine, cursorCol): StockContext`
  in `src/pi/provider.ts`
- New `describe` block of classifier cases in `test/provider-match.test.ts`
- `extractMatchState` UNCHANGED (its existing unit tests must stay green)

**Success Definition**: All 7+ specified classifier cases pass; full
`npm test` + `npm run check` green; no behavior change anywhere yet (the
function is exported but not called by getSuggestions — that is S2).

## Why

BUG-001(a): `extractMatchState`'s threshold regex
`/[A-Za-z][A-Za-z0-9_]*$/` fires on ANY trailing identifier, so typing
`/re`, `@jo`, or `"src/roun` returns hapax word items while
`current.getSuggestions` is never invoked — pi's slash-command menu, mention
menu, and file/path completion are hijacked. The classifier is the pure
detection primitive S2 gates on. Mirroring pi-tui's own
`isInSlashCommandContext` exactly is acceptance-critical (§09 integration
item 6: "path/slash/@ behaviors identical to stock pi").

## What

`classifyStockContext(lines, cursorLine, cursorCol)` inspects only the text
before the cursor on the cursor's line (`before = lines[line].slice(0, col)`),
mirroring `extractMatchState`'s line-local discipline. Classification rules
(in priority order):

1. **slash** — mirror pi-tui `editor.js` exactly:
   `cursorLine === 0 && before.trimStart().startsWith("/") && !before.trimStart().includes(" ")`
2. **mention** — trailing identifier fragment immediately preceded by `@`,
   where the `@` sits at a word start (line start or after whitespace)
3. **quoted-path** — odd count of `"` in `before` on the cursor line
   (unclosed quote — file completion inside quotes)
4. **path** — trailing fragment immediately preceded by `/` (unquoted path
   segment, e.g. `src/roun` → the fragment `roun` follows `/`)
5. **null** — otherwise (plain prose, trigger-char fragments at word start,
   ordinary word fragments)

### Success Criteria

- [ ] `/re` line 0 → `"slash"`
- [ ] `/model arg re` line 0 → `null` (space present — slash rule's no-space clause)
- [ ] `@jo` → `"mention"`
- [ ] `"src/roun` → `"quoted-path"`
- [ ] `src/roun` → `"path"`
- [ ] `renewable en` (plain prose) → `null`
- [ ] `#frag` at word start → `null` (trigger mode stays hapax's)
- [ ] `extractMatchState` untouched; all its existing tests green
- [ ] Function is pure: no I/O, no state, no Date/random; out-of-range
      line/col handled defensively (return `null` — same convention as
      `extractMatchState`)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the helper's exact placement,
signature, classification rules (verbatim from validated architecture
research), the pi-tui source semantics being mirrored, and the test
conventions are all reproduced below.

### Documentation & References

```yaml
- file: src/pi/provider.ts
  why: The ONLY source file to modify. Read it first. Relevant structure:
    - File header comment (~lines 1–42) documents match-state semantics and
      the purity contract — extend it with a short classifier paragraph.
    - extractMatchState (lines ~52–100): the exact pattern to follow —
      bounds checks (`line < 0 || line >= lines.length` → null; `col < 0 ||
      col > text.length` → null), `const before = text.slice(0, col)`,
      regex-escape discipline, line-local inspection only.
    - DEFAULT triggerChar is '#' (from src/pi/config.ts HapaxConfig).
  pattern: pure, synchronous, module-local regexes, defensive null returns.
  gotcha: classifyStockContext takes NO config parameter (per contract —
    stock contexts are config-independent). Placement: immediately AFTER
    extractMatchState, BEFORE the "S2" section divider comment.

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/provider-tui-integration.md
  why: THE authoritative fix design, validated against pi-tui's actual dist
    code. Section "Fix design" item 1 specifies this classifier verbatim;
    item 2 (getSuggestions wiring) is S2 — do NOT implement it here.
  critical: pi-tui semantics being mirrored (verified in
    node_modules/@earendil-works/pi-tui/dist):
    - isInSlashCommandContext (editor.js:1775):
      `cursorLine === 0 && before.trimStart().startsWith("/")`
    - handleTabCompletion (editor.js:1812) additionally requires
      `!before.trimStart().includes(" ")` — the slash classifier must include
      the no-space clause or Tab delegation (S2) diverges from stock Tab.
    - Stock applyCompletion treats prefixes starting with '"', '@"', '/'
      specially — hence quoted-path and mention must delegate with the
      stock provider's own prefix intact.

- file: test/provider-match.test.ts
  why: Extend with the classifier block. Conventions (read the header):
    imports `{ describe, expect, it }` from vitest; direct function calls
    with literal lines arrays; one `it` per case with the input quoted in
    the title. Add `classifyStockContext` to the existing
    `import { extractMatchState } from "../src/pi/provider.js";` line.
  pattern: e.g. `it("'/re' line 0 → 'slash'", () => {
      expect(classifyStockContext(["/re"], 0, 3)).toBe("slash"); });`

- file: src/pi/config.ts
  why: context only — HapaxConfig/DEFAULT_CONFIG live here; the classifier
    does NOT import it (config-independent). Also confirms triggerChar
    default '#', which is why '#frag' → null is correct (trigger stays
    hapax's; '/' trigger-char configs are a config concern, not this
    classifier's).

- url: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/match
  why: trailing-fragment regex idioms. Suggested building blocks:
    trailing identifier: before.match(/[A-Za-z][A-Za-z0-9_]*$/)
    mention: /^|\s anchoring — before.match(/(?:^|[ \t])@([A-Za-z][A-Za-z0-9_-]*)$/)
    path:   before.match(/(?:^|[^\\s/])\/([^\\s/]*)$/) — trailing fragment
            after a '/' that is not itself part of whitespace
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/pi/
│   ├── provider.ts          # MODIFY — add type + classifyStockContext (+ header note)
│   └── config.ts            # untouched
├── test/
│   └── provider-match.test.ts  # MODIFY — add classifier describe block
└── node_modules/@earendil-works/pi-tui/dist  # reference only (editor.js semantics)
```

### Known Gotchas of our Codebase & Library Quirks

```python
# CRITICAL: 'slash' must mirror editor.js EXACTLY, including BOTH clauses:
#   cursorLine === 0  (slash menus only allowed on line 0 — isSlashMenuAllowed)
#   && !before.trimStart().includes(" ")  (handleTabCompletion's extra guard)
# Missing the no-space clause is the classic bug: '/model arg re' would
# misclassify as slash and S2 would delegate where stock threshold-mode
# word completion (hapax's) is correct.
# CRITICAL: Use before.trimStart() (leading whitespace then '/'), not
#   before.startsWith('/') — stock allows indentation before the slash.
# GOTCHA: 'quoted-path' counts '"' occurrences in `before` on the CURSOR
#   LINE only (line-local discipline, like extractMatchState). Odd count =
# unclosed quote. Note: '@"' openers — '@"src/rou' has one '"' → odd →
# quoted-path (correct; stock's isQuotedPrefix checks '"..." and '@"').
# GOTCHA: 'path' vs prose URLs like 'https://example.com/roun' — the rule
#   "trailing fragment immediately preceded by /" classifies this as 'path'
#   too. That is ACCEPTABLE and intended (stock file completion would also
#   be consulted); do not special-case URLs.
# GOTCHA: Priority order matters: check slash → mention → quoted-path →
#   path, return on first hit. '#frag' never reaches a '/' or '@' rule at
#   word start, so it falls to null naturally — do not add trigger-char
#   awareness to this classifier (config-independent by contract).
# GOTCHA: Purity contract of this module (see file header): no runtime pi
#   imports beyond the existing type-only ones, no I/O, no state. Type-only
#   imports from pi-tui already exist and are fine.
# GOTCHA: Defensive bounds: out-of-range line/col → null (same convention
#   as extractMatchState lines ~56-58).
```

## Implementation Blueprint

### Data models and structure

```typescript
/** A cursor context owned by pi's built-in completion. Non-null means
 *  hapax MUST delegate (getSuggestions passes through to `current`). */
export type StockContext = "slash" | "mention" | "quoted-path" | "path";

/**
 * Classify whether the cursor sits in a stock pi completion context.
 * Pure, synchronous, line-local, config-independent (BUG-001 fix, part 1).
 */
export function classifyStockContext(
  lines: string[],
  cursorLine: number,
  cursorCol: number,
): StockContext | null {
  if (cursorLine < 0 || cursorLine >= lines.length) return null;
  const text = lines[cursorLine];
  if (cursorCol < 0 || cursorCol > text.length) return null;
  const before = text.slice(0, cursorCol);
  const trimmed = before.trimStart();

  // slash — mirrors pi-tui editor.js isInSlashCommandContext (:1775)
  // + handleTabCompletion's no-space guard (:1812).
  if (cursorLine === 0 && trimmed.startsWith("/") && !trimmed.includes(" ")) {
    return "slash";
  }
  // mention — trailing identifier after '@' at a word start.
  if (/(?:^|[ \t])@[A-Za-z][A-Za-z0-9_-]*$/.test(before)) return "mention";
  // quoted-path — unclosed '"' on the cursor line.
  if ((before.match(/"/g) ?? []).length % 2 === 1) return "quoted-path";
  // path — trailing fragment immediately preceded by '/'.
  if (/(?<!^|\s)\/[^\s/]*$/.test(before) && /\/[^\s/]*$/.test(before) &&
      /[^\s/]/.test(before.slice(before.lastIndexOf("/") + 1)) === false) {
    // (implement simply: see note below — prefer an explicit match)
  }
  return null;
}
```

The path rule is simplest as an explicit match:
```typescript
// path — a '/' earlier in `before` whose following tail contains the
// cursor-adjacent fragment with no whitespace after that '/'.
const lastSlash = before.lastIndexOf("/");
if (lastSlash !== -1 && !/\s/.test(before.slice(lastSlash + 1))) {
  return "path"; // tail after the last '/' is whitespace-free → path fragment
}
```
Caveat to check: `"src/roun` is already caught by quoted-path first
(priority order), so the path rule sees only unquoted cases. `renewable en`
has no '/' → null. `'https://example.com/roun'` → path (accepted).
**Verify the chosen path formulation against the test cases; adjust the
predicate until all seven spec cases pass — the classification OUTCOMES are
the contract, not any particular regex.**

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: ADD StockContext type + classifyStockContext to src/pi/provider.ts
  - PLACEMENT: directly after extractMatchState, before the "S2 —" divider.
  - IMPLEMENT: per blueprint above; slash/mention/quoted-path/path priority.
  - KEEP extractMatchState byte-identical.
  - HEADER: add 2-4 lines to the file header noting the classifier, its
    purity, and that S2 wires it into getSuggestions (reference BUG-001).

Task 2: EXTEND test/provider-match.test.ts
  - ADD import: classifyStockContext (and StockContext type if useful).
  - ADD describe("classifyStockContext — stock pi contexts (BUG-001)") with
    at minimum these it() cases (titles quote the input, per file convention):
      "/re' line 0 → 'slash'"                      (["/re"], 0, 3)
      "indented '  /re' line 0 → 'slash'"          (["  /re"], 0, 5)
      "'/model arg re' → null (space kills slash)" (["/model arg re"], 0, 13)
      "'@jo' → 'mention'"                          (["@jo"], 0, 3)
      "'foo @jo' mid-line → 'mention'"             (["foo @jo"], 0, 7)
      "x@jo glued @ → null (not word start)"       (["x@jo"], 0, 4)
      "'\"src/roun' → 'quoted-path'"               (['"src/roun'], 0, 9)
      "'src/roun' → 'path'"                        (["src/roun"], 0, 8)
      "'renewable en' plain prose → null"          (["renewable en"], 0, 12)
      "'#frag' at word start → null (trigger is hapax's)" (["#frag"], 0, 5)
      "out-of-range line/col → null"               (["x"], 5, 0) and (["x"], 0, 9)
      "'word' line 1 with slash content on line 0 → null (line-local)"
  - PURITY: mirror the file's existing purity tests if present; at minimum
    the function takes no config and uses no external state (compile-time
    property; no runtime test needed beyond behavior).

Task 3: FULL REGRESSION
  - npm run check
  - npm test   # all suites green; extractMatchState tests untouched & green
```

### Implementation Patterns & Key Details

```typescript
// Slash — the two-clause mirror (CRITICAL: both clauses):
const trimmed = before.trimStart();
if (cursorLine === 0 && trimmed.startsWith("/") && !trimmed.includes(" ")) {
  return "slash";
}

// Mention — @ at word start, trailing identifier fragment:
if (/(?:^|[ \t])@[A-Za-z][A-Za-z0-9_-]*$/.test(before)) return "mention";

// Quoted-path — odd '"' count on the cursor line:
const quotes = (before.match(/"/g) ?? []).length;
if (quotes % 2 === 1) return "quoted-path";

// Path — last '/' with a whitespace-free tail:
const lastSlash = before.lastIndexOf("/");
if (lastSlash !== -1 && !/\s/.test(before.slice(lastSlash + 1))) return "path";

return null;
```

### Integration Points

```yaml
NEXT TASK (S2, NOT this one): getSuggestions wiring —
  src/pi/provider.ts createHapaxProvider, immediately after the aborted
  check and BEFORE the armed-chain branch:
    if (classifyStockContext(lines, cursorLine, cursorCol)) {
      return current.getSuggestions(lines, cursorLine, cursorCol, options);
    }
  (options passed through UNCHANGED — S2's tests assert object identity.)
  This task only ships the primitive; nothing calls it yet. TypeScript will
  not warn about the unused export — do not add a caller.

TEST BASELINE: full suite currently green (636 tests per validation report).
  Only test/provider-match.test.ts gains cases.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit clean
```

### Level 2: Unit Tests

```bash
npx vitest --run test/provider-match.test.ts   # new classifier block green
npx vitest --run test/provider-match.test.ts -t classifyStockContext -v  # see the case list
npm test                                        # full suite green
```

### Level 3: Integration

Not applicable — pure helper, no wiring yet (that is S2). Confirm no
behavior change: `npx vitest --run test/provider.test.ts test/provider-live.test.ts`
still green (provider behavior untouched).

### Level 4: Domain-Specific (spec-case matrix)

```bash
# All seven contract cases in one run:
npx vitest --run test/provider-match.test.ts -t "classifyStockContext"
# Cases: /re→slash, /model arg re→null, @jo→mention, "src/roun→quoted-path,
#        src/roun→path, renewable en→null, #frag→null
```

## Final Validation Checklist

- [ ] `classifyStockContext` exported from src/pi/provider.ts with the exact 5-value return type
- [ ] All seven contract cases pass plus edge cases (indented slash, glued @, line-local, bounds)
- [ ] `extractMatchState` unchanged; its test block untouched and green
- [ ] `npm test` and `npm run check` both fully green
- [ ] Only src/pi/provider.ts and test/provider-match.test.ts modified
- [ ] Function is pure, config-independent, line-local, defensively null on bad bounds
- [ ] File header comment updated; no getSuggestions wiring added (S2's job)

## Anti-Patterns to Avoid

- ❌ Don't modify extractMatchState or wire the classifier into getSuggestions (S2/P1.M1.T1.S2)
- ❌ Don't drop the slash rule's no-space clause or the cursorLine===0 clause (must mirror editor.js exactly)
- ❌ Don't make the classifier config-aware (triggerChar is hapax's concern, never the stock classifier's)
- ❌ Don't inspect text after the cursor or other lines (line-local discipline)
- ❌ Don't special-case URLs inside the path rule
- ❌ Don't import anything new at runtime (type-only imports are already in place)

---

**Confidence Score**: 9/10 — pi-tui's editor semantics were verified against
the actual dist in the architecture research (line-referenced), the
classification rules are reproduced verbatim from the validated fix design,
and the test file conventions were read from source this session. The only
implementation freedom (exact path-rule predicate) is pinned by
outcome-based test cases rather than a specific regex.
