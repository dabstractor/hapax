---
name: "P1.M2.T2.S1 (bugfix 001_140e40041dd1) — index.test.ts e2e: ingest path mention → provider display + widget Tab insert keep the edges"
---

## Goal

**Feature Goal**: Prove BUG-002's fix at the PRODUCTION seam (spec 09 integration
item 7: "sr → src/core/query.ts, Tab inserts the whole path; an absolute path
inserts with its leading /"): through the real index.ts factory composition,
ingesting messages that mention `/home/dustin/projects/hapax/src/core/query.ts`
and `../tools/build.mjs` must yield completions whose DISPLAY and INSERTED text
keep the leading `/` and `../` on BOTH display paths — the fallback provider's
menu items and the widget's Tab insert.

**Deliverable**: New describe block in `test/index.test.ts` with (a) fallback-path
cases (provider `getSuggestions` display + real `applyCompletion` via
`editorApplyCompletion` buffer math) and (b) widget-path cases
(`fakeCtx({editorFactory})` composition: type `ho`, Tab → buffer holds the
edge-bearing path verbatim). Mode-A banner citing spec 09 item 7.

**Success Definition**: `getSuggestions(['ho'])` → display `/home/...`; `to` →
`../tools/build.mjs`; provider applyCompletion leaves the edge-bearing form in
the buffer; widget Tab on `ho` yields buffer `/home/dustin/projects/hapax/src/core/query.ts`;
matching still proven to happen on the TRIMMED key (`ho` matches though the key
is `home/...`); `npm run check` + `npm test` green.

## Why

- The PRD's core finding: both majors survived because every suite fabricates
  its own store — segment pinned the DRAFT, query pinned the resolver in
  isolation, and the store→query drop went uncaught. This task is the
  production-wiring test layer the PRD recommends ("composes index.ts's
  session_start with a fake ctx and asserts observable behaviors").
- Closes BUG-002 per the PRD fix recommendation (query-level battery is
  P1.M2.T1.S2's; this is the end-to-end proof on top of S1+S2).

## What

New `describe("e2e — verbatim path display/insert (BUG-002, spec 09 item 7)")`
in `test/index.test.ts`, reusing the file's harness VERBATIM:

1. **(a) Fallback path** (no editorFactory → provider registered):
   - `wired()` (default fakeCtx, no editorFactory) → fire `session_start`.
   - `await endMessage(handlers.get("message_end")!, ctx, assistantMsg("see /home/dustin/projects/hapax/src/core/query.ts and ../tools/build.mjs for details"))` (use the file's message-construction idiom — study `userMsg`/the bigram describe :443-540 for the exact shape); `await settle()` (:209 — 420 ms, lets the 300 ms ingest debounce + drain finish).
   - Grab the registered provider: `addAutocompleteProvider` mock, first registration, pass it a `current` with vi.fn `applyCompletion` delegating semantics (copy the mock idiom at :161-165).
   - `await provider.getSuggestions(["ho"], 0, 2, opts())` → `items.some(i => i.value === "/home/dustin/projects/hapax/src/core/query.ts")` (the leading `/` KEPT); `["to"]` similarly → `../tools/build.mjs`.
   - Insert through the provider's REAL `applyCompletion` with `editorApplyCompletion` (test/helpers/editor-sim.ts :42 — pi-tui-faithful deletion math): `editorApplyCompletion(lines, line, col, item, prefix)` applied to `["ho"]` at prefix "ho" → result buffer contains the edge-bearing full path.
   - KEY-TRIM PROBE: assert the store key is trimmed — via the match itself (`items[0]` keyed under the trimmed key; or `store` accessor if the harness exposes one) — "matching happens on the trimmed key" is the point of rule 4d.
2. **(b) Widget path** (`wired({ editorFactory: stockFactory() })` — the :824/:979 idiom):
   - Same ingest + settle. Drive the installed editor proxy: set buffer `["ho"]`, cursor col 2, fire the input tick, wait for paint, then press Tab (mirror the widget-driving idiom in the :824-1000 describe blocks — read how those tests type and press keys against the proxy before writing).
   - Assert the editor buffer is exactly `["/home/dustin/projects/hapax/src/core/query.ts"]` (THE PRD reproduction, inverted) — cursor after the path.
   - One `../tools` variant: type `to`, Tab → buffer `../tools/build.mjs`.
3. **Mocking discipline** (harness contract): mock ONLY the pi shell (fakePi/fakeCtx) and the dictionary file; the pipeline, store, provider, widget, and editor proxy are the REAL composed production objects.
4. **Mode-A banner**: cite spec 09 integration item 7 verbatim ("an absolute path inserts with its leading /"). README sync is P2.M2.T2.S1's (Mode B) — do not edit README.

### Success Criteria

- [ ] Fallback: display keeps `/` and `../`; real applyCompletion inserts edge-bearing form; key trimmed
- [ ] Widget: `ho` + Tab → buffer `/home/dustin/projects/hapax/src/core/query.ts` (PRD repro inverted)
- [ ] Ingest goes through endMessage + settle (real debounce), not a fabricated store
- [ ] Only pi shell + dict mocked; banner cites item 7
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer needs: the exact index.test.ts harness pieces (fakePi/fakeCtx/wired/endMessage/settle, provider-grab and widget-driving idioms), the editor-sim helper contract, the upstream pathDisplay contract (S1+S2), and the PRD repro strings. All below.

### Documentation & References

```yaml
- file: test/index.test.ts
  why: THE file + THE template. fakePi :89; fakeCtx :115 (over.editorFactory
        :121/:135 — undefined ⇒ fallback/provider path); wired :268;
        endMessage :180; settle :209 (420ms — debounce+drain); provider
        current-mock idiom :161-165; provider getSuggestions usage :623-634;
        bigram describe :443-540 (endMessage + settle + store assertions —
        the closest end-to-end precedent); widget editorFactory describes
        :824-1000 (stockFactory(), typing/Tab driving idiom).
  pattern: describe/it, vi mocks for the pi shell ONLY, real handlers
           from handlers.get("...")!.

- file: test/helpers/editor-sim.ts
  why: editorApplyCompletion :42 — pi-tui's applyCompletion deletion math
        (replace prefix.length chars before cursor with item.value) for the
        fallback-path buffer assertion.
  gotcha: pass the REAL provider.applyCompletion as the function under
          test where the harness allows; at minimum apply its returned
          item/prefix through editorApplyCompletion faithfully.

- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/bug002-path-display.md
  section: §4 (display-flow map)
  why: The verified consumption sites: provider fallback consumes
        MatchResult.display at provider.ts:668-671; widget Tab-insert
        splices display at widget.ts:1390/:1449 — span computed from the
        TYPED fragment, so a longer display is fine (the anchor-safety
        property your buffer assertions lean on).

- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P1M2T1S2/PRP.md
  why: Upstream contract (in flight): resolveCompletionCasing pathDisplay-
        first guard; rankMatches display verbatim, key trimmed. Your tests
        consume this through the composition — never re-assert resolver
        internals here (that's S2's query battery).
  gotcha: S1 (Sighting.path/Candidate.pathDisplay sticky-first) is
          Implementing — assume delivered; if the factory seam shows bare
          keys at test time, STOP and report (upstream not landed), don't
          patch around it.

- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P1M2T1S1/PRP.md
  why: Sibling S1 contract — Sighting.path threading + sticky-first
        pathDisplay merge (the DATA your e2e rides on).

- file: spec/09-*.md
  section: integration item 7
  why: The acceptance sentence this battery cites verbatim in its banner.
```

### Current Codebase tree (relevant)

```bash
test/index.test.ts               # EXTEND: new e2e describe (a)+(b)
test/helpers/editor-sim.ts       # reuse editorApplyCompletion
```

### Known Gotchas & Library Quirks

```typescript
// SETTLE 420ms, not flush-less: the ingest path is debounced 300 ms;
// endMessage + settle() is the proven idiom (:540). Use fake timers ONLY
// if the file already does in the neighborhood — follow local precedent.

// PATHS CLASSIFY AS CASING 'lower' (raw[0] is '/', '.', '~') — that's the
// BUG-002 root; with S1/S2 landed the tally path is bypassed by the
// pathDisplay guard. If your e2e shows the trimmed key anyway, the
// upstream isn't landed — do not "fix" it in the test.

// THE WIDGET TAB SPAN: insertHighlighted computes the span from the TYPED
// fragment ('ho' — 2 chars) and splices the LONGER display in; the cursor
// lands after it. Assert buffer equality AND cursor position
// (path.length, col after insert) where the harness exposes it.

// 'ho' ANCHORS ON THE TRIMMED KEY's first char ('h' of 'home/...') — the
// display's leading '/' never participates in matching. That asymmetry
// (key trimmed for match, display verbatim for render) IS the spec rule;
// assert both sides.

// PROVIDER REGISTRATION: without editorFactory, session_start registers
// the fallback provider through addAutocompleteProvider — capture it from
// the mock's calls BEFORE endMessage (registration order vs message flow
// doesn't matter, but grab the registration from the same ctx).

// WIDGET PATH: the proxy installs over the editorFactory; drive the
// proxy's input/Tab exactly as the :824-1000 tests do (they are the
// working precedent — copy their mechanics, not guesses).

// DON'T re-pin resolver internals (tier arithmetic, guard branch) — those
// live in S2's query battery. This file proves the COMPOSITION: ingest →
// store → query → provider/widget → inserted buffer.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ the precedent blocks
  - test/index.test.ts :443-540 (endMessage+settle+store), :600-650
    (provider getSuggestions), :824-1000 (widget driving). Extract the
    message-construction helper + widget type/Tab mechanics before writing.

Task 1: TDD — (a) fallback cases
  - Banner comment citing spec 09 item 7 (Mode A).
  - Ingest assistant message with both paths; settle.
  - getSuggestions 'ho' → '/home/...' display; 'to' → '../tools/build.mjs'.
  - editorApplyCompletion through the provider's real applyCompletion →
    buffer contains the edge-bearing path.
  - Key-trim probe (match happened on trimmed key).

Task 2: (b) widget cases
  - wired({editorFactory: stockFactory()}); same ingest; type 'ho';
    Tab → buffer === '/home/dustin/projects/hapax/src/core/query.ts'.
  - '../tools' variant via 'to' + Tab.

Task 3: VALIDATE
  - npx vitest --run test/index.test.ts -v
  - npm run check && npm test
```

### Implementation pattern

```typescript
// (a) sketch — reuse file-local helpers verbatim
const { handlers, ctx, addAutocompleteProvider } = wired(); // no editorFactory
await handlers.get("session_start")!({ type: "session_start" } as never, ctx);
await endMessage(handlers.get("message_end")!, ctx,
  assistantMsg("see /home/dustin/projects/hapax/src/core/query.ts and ../tools/build.mjs"));
await settle();
const provider = /* from addAutocompleteProvider mock calls, fed current mock :161 */;
const res = await provider.getSuggestions(["ho"], 0, 2, { signal: new AbortController().signal });
expect(res.items.map(i => i.value)).toContain("/home/dustin/projects/hapax/src/core/query.ts");
```

### Integration Points

```yaml
NONE this task:
  - Test-only; no src/ edits. README sync = P2.M2.T2.S1 (Mode B); spec
    untouched (drift report is P2.M2.T2.S2's).
```

## Validation Loop

### Level 1 & 2

```bash
npm run check
npx vitest --run test/index.test.ts -v
npm test
```

## Final Validation Checklist

- [ ] (a) fallback display + real applyCompletion keep `/` and `../`; key trimmed
- [ ] (b) widget Tab inserts the verbatim path (PRD repro inverted), `../tools` variant
- [ ] Real factory composition (fakePi/fakeCtx only); banner cites item 7
- [ ] `npm run check` + `npm test` green; no src/README/spec edits

## Anti-Patterns to Avoid

- ❌ Don't fabricate a store or call rankMatches directly — the point is the production seam
- ❌ Don't skip settle() (debounce) — flaky-by-construction otherwise
- ❌ Don't re-assert resolver/tier internals (S2's battery owns them)
- ❌ Don't mock the pipeline/provider/widget/editor proxy — only the pi shell + dict file
- ❌ Don't edit README or spec (Mode A test banner only; docs sync is P2.M2.T2.*)
