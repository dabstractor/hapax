# PRP — P1.M4.T1.S1: Prefix-anchor invalidation in createDisplayProvider + faithful editor-sim regression (BUG-002)

## Goal

**Feature Goal**: Make `createDisplayProvider` structurally incapable of
returning a stale `prefix` to pi: whenever the fresh hapax result's prefix
differs from the currently displayed one, paint the fresh set immediately
instead of re-serving the displayed set with its old prefix during the
suppression window. Guard with a faithful pi-tui editor-simulation
regression test reproducing the PRD's 'zzendesk' corruption (BUG-002).

**Deliverable**:
1. `src/pi/provider.ts` — one new exception branch in `getSuggestions`
   (between the 4c-exception and rule 4d) + comment block stating the hard
   prefix-anchor invariant.
2. `test/helpers/editor-sim.ts` — NEW exported faithful `applyCompletion`
   editor-sim helper mirroring pi-tui's deletion semantics (reused later by
   P1.M5.T1.S1).
3. `test/provider-display.test.ts` (or a new sibling
   `test/provider-anchor.test.ts` — pick one) — regression tests: 'zzendesk'
   repro, Tab-after-pause-after-suppression, no-flicker preservation for
   identical-prefix narrowing.

**Success Definition**: `npm run check` + `npm test` green (all 523+ existing
tests); the PRD repro passes: after 'z'→'e' paints {Zendesk, zephyr}@'ze',
typing 'p' within 100 ms must NOT return prefix 'ze', and Tab-applying
whatever IS returned through the faithful editor-sim never yields
'zzendesk'-class text (prefix always suffix-matches the buffer).

## User Persona

**Target User**: hapax users typing quickly with the completion menu open.
**Use Case**: type a prefix, keep typing while the debounce window is open,
then press Tab (immediately or after a pause).
**User Journey**: 'ze' opens menu; 'p' typed <100 ms later narrows the live
set; Tab completes the highlighted item — text must be correct, never
duplicated/garbled ('zep'+'zephyr' → 'zephyr', not 'zzendesk').
**Pain Points Addressed**: text corruption from stale prefix anchors —
pi's `applyCompletion` deletes `prefix.length` chars before the cursor
verbatim with no re-verification at Tab time.

## Why

- BUG-002 (PRD "Major Issues" Issue 1): rule 4d returns
  `copyOf(displayedItems)` with the STALE `displayedPrefix` while the buffer
  holds more characters; pi-tui caches `suggestions.prefix` from the last
  `getSuggestions` (editor.js:1925-26) and Tab (editor.js:540-551; forced
  single-item apply 1903-12) calls `applyCompletion` which slices exactly
  `prefix.length` chars (autocomplete.js:265-267). Verified end-to-end via a
  faithful editor simulation in the adversarial probe.
- Violates PRD §01 design invariant 1 ("Never hijack typing"); worse than
  the accepted cosmetic Tab-before-paint limitation because it inserts
  WRONG TEXT, and it persists until the next keystroke query.
- The codebase already fixed this hazard class for the acceptance case
  (`completionSincePaint`, the 4c-exception) — this task generalizes the
  same defense to plain typing.

## What

1. **New exception branch** in `createDisplayProvider.getSuggestions`, placed
   AFTER the 4c-exception and BEFORE rule 4d:
   ```ts
   // 4d-exception (new). Prefix-anchor invalidation: the fresh result's
   // prefix differs from the displayed set's, so the buffer changed in a
   // way that moved the anchor (narrowing typed a char, backspace, etc.).
   // Re-serving the displayed set would hand pi its old prefix; pi's
   // applyCompletion replaces prefix.length characters before the cursor
   // VERBATIM with no re-verification at Tab time, so a stale anchor
   // destroys typed text ("zep" + Tab on stale prefix "ze" → "zzendesk").
   // HARD INVARIANT: this provider NEVER returns a prefix that is not the
   // exact suffix of the current line at the cursor. Paint the fresh set
   // immediately. Suppression may only re-serve a displayed set whose
   // prefix still equals the fresh prefix (suffix-matches the buffer —
   // the isHapax check in steps 2–3 guarantees fresh prefixes are computed
   // from the CURRENT buffer).
   if (result.prefix !== displayedPrefix) {
     paint(items, result.prefix);
     return { items: copyOf(displayedItems), prefix: displayedPrefix };
   }
   ```
   Then rule 4d keeps its existing behavior (identical-prefix narrowing —
   set changes, prefix unchanged — stays suppressed; NO flicker regression).
2. **Faithful editor-sim helper** (`test/helpers/editor-sim.ts`): mirror
   pi-tui's `applyCompletion` deletion math exactly:
   ```ts
   export function editorApplyCompletion(
     line: string, cursorCol: number, itemValue: string, prefix: string,
   ): string {
     const before = line.slice(0, cursorCol - prefix.length);
     const after = line.slice(cursorCol);
     return before + itemValue + after;
   }
   ```
   (autocomplete.js:265-267 semantics; no re-verification, blind
   `prefix.length` deletion — that blindness is the point.)
3. **Regression tests** (extend `test/provider-display.test.ts`; its
   existing mocks do NOT model deletion — that gap is why this bug escaped):
   - Repro: store with `zendesk` (display `Zendesk`) + `zephyr` only.
     Threshold-mode typing (no `#`; DEFAULT threshold 2): type 'z' →
     delegate/empty (1-char fragment below threshold); type 'e' → paints
     {Zendesk, zephyr} @prefix 'ze'; advance fake clock < 100 ms; type 'p'
     → provider result prefix must be 'zep' (or delegate), NEVER 'ze';
     Tab-apply the returned top item through `editorApplyCompletion` on
     buffer 'zep'@col 3 → assert result ∈ {'zephyr', 'Zendesk'}-family
     correct text and NOT 'zzendesk' / any duplicated text.
   - Tab-after-pause: same setup, after the suppressed 'p' keystroke advance
     fake timers past 100 ms (pending promotes), then Tab with NO further
     keystroke → applyCompletion must still be anchor-safe (prefix matches
     buffer suffix).
   - No-flicker preservation: existing suppression tests (set narrows,
     prefix identical — e.g. new ingest changes membership mid-window) must
     remain green unchanged; add one explicit test asserting suppression
     still occurs when `result.prefix === displayedPrefix` but the set
     differs.
4. **Mode A docs**: the comment block on the new exception (above), mirroring
   the 4c-exception's documentation style. No user-facing/config/API change.

### Success Criteria

- [ ] New branch present before 4d; `result.prefix !== displayedPrefix`
      → immediate paint + fresh prefix
- [ ] Comment states the hard invariant (never return a non-suffix prefix)
- [ ] `test/helpers/editor-sim.ts` exports the faithful helper (reusable by
      P1.M5.T1.S1)
- [ ] 'zzendesk' repro test passes; Tab-after-pause covered
- [ ] All existing display-debounce/flicker tests green (no suppression
      behavior lost for identical-prefix narrowing)
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

The implementing agent gets the exact branch code, its insertion point, the
exact editor-sim math, the exact repro keystroke/timing sequence, and the
existing test-harness conventions (fixtures, fake timers, emission logs).
No prior knowledge beyond the pointed files needed.

### Documentation & References

```yaml
- file: src/pi/provider.ts
  why: THE file to modify. Read createDisplayProvider fully first.
  pattern: state vars (displayedSig/Items/Prefix, lastPaintAt,
    completionSincePaint, pending*), paint(), copyOf(), and rule order
    1 → 2-3 (isHapax: result.prefix === live.prefix from CURRENT buffer)
    → 4a → 4b → 4c-exception → [INSERT NEW 4d-exception HERE] → 4d.
  gotcha: insert AFTER the completionSincePaint branch and BEFORE the
    suppression branch; do not touch applyCompletion/shouldTriggerFile-
    Completion/dispose.

- file: test/provider-display.test.ts
  why: harness to extend — zeStore()/put()/sighting() store fixtures,
    mockCurrent(), cfg(), opts(), harness(debounceMs) emission logging,
    vi.useFakeTimers + setSystemTime(0) timing conventions.
  pattern: Emission = string[] | "<delegate>"; per-keystroke emit() calls.
  gotcha: existing harness emit() prefixes '#' (trigger mode); the repro
    wants plain threshold-mode typing ('z','e','p' typed directly, lines =
    [fragment]) — check extractMatchState (same file's provider.ts) fires
    threshold mode at ≥2 chars everywhere.

- file: test/helpers/editor-sim.ts
  why: NEW file; sibling convention = test/helpers/dict-writer.ts (plain
    exported helper, no vitest import needed).

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M4T1S1/research/notes.md
  why: verified line-level facts on the rule order, 4c pattern, and the
    pi-tui deletion semantics with exact upstream line references
    (editor.js:540-551, 1903-12, 1925-26; autocomplete.js:265-267).

- file: node_modules/@earendil-works/pi-tui/dist/components/editor.js
  why: ground truth for Tab/applyCompletion behavior if semantics need
    re-checking (lines ~540-551, ~1903-1926) and dist/components/autocomplete.js
    (~265-267) for the slice math.

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M3T2S1/PRP.md
  why: parallel-item contract — touches ONLY src/pi/ingest.ts + ingest
    tests; zero overlap, listed here to confirm no conflict.
```

### Current Codebase tree (relevant)

```bash
hapax/
├── src/pi/provider.ts        # createDisplayProvider ≈L540-700 — MODIFY
├── test/provider-display.test.ts  # display suite — EXTEND (or sibling)
└── test/helpers/dict-writer.ts    # helper-file convention
```

### Desired Codebase tree with files to be added

```bash
test/helpers/editor-sim.ts    # NEW: exported editorApplyCompletion (faithful
                              #   pi-tui deletion math; reused by P1.M5.T1.S1)
test/provider-display.test.ts # EXTENDED: anchor-invalidation regressions
src/pi/provider.ts            # one new exception branch + invariant comment
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: pi-tui NEVER re-verifies the prefix at Tab time — it slices
//   line.slice(0, col - prefix.length) verbatim. The provider-side invariant
//   is the ONLY defense; that's why the check must precede rule 4d.
// GOTCHA: isHapax (steps 2-3) already guarantees any FRESH result.prefix
//   equals live.prefix computed from the CURRENT buffer — so painting the
//   fresh set is always anchor-safe; only re-SERVING displayed state is
//   hazardous. Don't add buffer re-inspection in the provider.
// GOTCHA: keep suppression for result.prefix === displayedPrefix with a
//   differing SET (identical-prefix narrowing) — removing it regresses the
//   flicker-hysteresis acceptance suite.
// GOTCHA: fake timers — vitest 4 fakes Date.now; existing suite pins
//   setSystemTime(0) and advances with vi.advanceTimersByTime; match it so
//   the 100 ms window arithmetic stays deterministic.
// GOTCHA: store prefix index matches LOWERCASED prefixes; item.value carries
//   the display casing ('Zendesk') — assert on values, query on fragments.
// CRITICAL: no new dependencies; tsc strict must stay clean (npm run check).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE test/helpers/editor-sim.ts
  - IMPLEMENT: export function editorApplyCompletion(line, cursorCol,
    itemValue, prefix): string with the exact slice math above
  - JSDOC: cite pi-tui autocomplete.js:265-267 + note "no re-verification —
    this blindness is what BUG-002 exploited"
  - PLACEMENT: test/helpers/ (convention: see dict-writer.ts)

Task 2: MODIFY src/pi/provider.ts — insert the 4d-exception
  - INSERT: the branch verbatim from What §1, AFTER the completionSincePaint
    (4c) block, BEFORE the suppression (4d) block in getSuggestions
  - KEEP: rule 4d unchanged beneath it
  - COMMENT: full comment block incl. the HARD INVARIANT sentence
  - DO NOT touch: applyCompletion wrapper, reset/paint/promotePending,
    shouldTriggerFileCompletion, dispose, createHapaxProvider

Task 3: EXTEND test/provider-display.test.ts — anchor regressions
  - FIXTURE: new store builder with exactly zendesk(display Zendesk)×3 and
    zephyr×1 (reuse put/sighting); verify ordering via rankMatches expectations
  - TEST A (repro): threshold-mode keystrokes 'z'(delegate) → 'e'(paint
    {Zendesk,zephyr}@'ze') → advanceTimersByTime(<100) → 'p' → assert
    returned prefix === 'zep' (or delegate); editorApplyCompletion('zep', 3,
    top.value, returned.prefix) must NOT contain 'zzendesk' and must be
    'zephyr' or 'Zendesk'
  - TEST B (Tab after pause): continue from suppressed 'p', advance timers
    past 100 ms (promotion), Tab-apply with no new keystroke → still
    anchor-safe
  - TEST C (suppression preserved): result.prefix === displayedPrefix with
    differing set → suppression still returns displayed set (no immediate
    paint); existing flicker tests must remain green untouched
  - NAMING: describe("prefix-anchor invalidation (BUG-002)")

Task 4: VALIDATE
  - npm run check && npm test   # all green, including the full existing
    display-debounce + never-hijack suites
```

### Implementation Patterns & Key Details

```ts
// PATTERN: keystroke emission in threshold mode (repro needs plain typing,
// not the existing harness's '#'+fragment trigger mode)
const type = async (frag: string) =>
  (await wrapper.getSuggestions([frag], 0, frag.length, opts()));

// PATTERN: faithful Tab-apply against the provider's returned contract
const res = await type("zep");
const completed = editorApplyCompletion(
  "zep", /*cursorCol*/ 3, res.items[0].value, res.prefix,
);
expect(completed).not.toContain("zzendesk");
expect(["zephyr", "Zendesk"]).toContain(completed);
```

### Integration Points

```yaml
CONFIG: none — no config surface change (Mode A docs only)
ROUTES: none
DEPENDS-ON: nothing from other subtasks — self-contained in createDisplayProvider
CONSUMED-BY: P1.M5.T1.S1 (typing-path probes) reuses test/helpers/editor-sim.ts —
  keep it dependency-free and exported
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit strict — must be clean
```

### Level 2: Unit / Regression Tests

```bash
npx vitest --run test/provider-display.test.ts -v   # new + existing green
npm test                                            # full suite (523+ green)
```

### Level 3: Behavioral verification (the fix's essence)

The repro test IS the verification — it drives the real wrapper and the
faithful editor math; no live pi session needed for this bug (popup timing
is fully faked deterministically).

### Level 4: Regression sweep

```bash
# Never-hijack + debounce + flicker suites specifically must be untouched-green:
npx vitest --run test/provider-display.test.ts test/provider.test.ts test/provider-live.test.ts test/acceptance.test.ts -v
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean; `npm test` fully green
- [ ] New branch inserted at the exact rule position (after 4c, before 4d)
- [ ] No behavioral change to rule 4d for identical-prefix narrowing

### Feature Validation

- [ ] Provider can never return a prefix ≠ exact suffix of the buffer at
      cursor (hard invariant documented and test-enforced)
- [ ] 'zzendesk' repro passes; Tab-after-pause case passes
- [ ] editor-sim helper exported and faithful (slice math matches
      autocomplete.js)

### Code Quality

- [ ] Comment mirrors 4c-exception style (Mode A docs)
- [ ] Reuses existing store fixtures/mock patterns; no new dependencies
- [ ] Only provider.ts + tests touched (ingest.ts belongs to parallel item)

## Anti-Patterns to Avoid

- ❌ Don't "verify" the prefix against the buffer inside the provider — the
  isHapax check already guarantees fresh prefixes are buffer-derived; the
  fix is refusing to re-serve stale ones, not re-validation
- ❌ Don't suppress-then-paint (park as pending) when prefixes differ — that
  re-serves the stale set for one more query, which is the bug
- ❌ Don't break identical-prefix suppression (flicker regression)
- ❌ Don't put the editor-sim helper inside the test file unexported —
  P1.M5.T1.S1 needs it importable
- ❌ Don't add config flags or API surface — this is a pure safety fix

## Confidence Score

**9/10** — the fix is a single well-scoped branch with the exact code
provided, the hazard and its upstream semantics are verified down to line
numbers, and the regression harness pattern already exists in the repo;
residual risk is only in matching the existing harness's timing conventions,
which are documented above.