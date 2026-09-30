# Research Notes — P1.M3.T3.S2 (Tab insert + Enter dismiss-then-forward + never-mutate pin)

## Editor public mutation surface (verified in `node_modules/@earendil-works/pi-tui/dist/components/editor.d.ts`)

Publicly usable members for the Tab insert:
- `getLines(): string[]` (d.ts:105), `getCursor(): { line: number; col: number }` (d.ts:106)
- `setText(text: string): void` (d.ts:110) — normalizeText, cancels autocomplete, exits history browsing, **pushes an undo snapshot** if content differs, clears paste state, then `setTextInternal(normalized)`.
- `setTextInternal(text, cursorPlacement = "end")` — cursor lands at **END of buffer** (`cursorLine = lines.length - 1`, col at end). So `setText` alone mis-places the caret mid-line.
- `insertTextAtCursor(text: string): void` (d.ts:116) — public, undoable, inserts at cursor (no span deletion; cannot delete the fragment by itself).
- `setCursorCol(col)` is **private** (d.ts:139) but exists at runtime as a method — calling a method (even a private-marked one) via duck-typed optional call `(e as any).setCursorCol?.(col)` is NOT instance mutation (the v1 ban is on own-property monkey-patching). `moveCursor` is also private.
- `deleteWordBackwards` is private too.

→ Chosen algorithm (spec-compliant "public methods, never mutate"):
1. read `lines`/`cursor` via getLines/getCursor
2. find the span with the word-fragment regex `/[A-Za-z][A-Za-z0-9_-]*$/` on `lines[line].slice(0, col)` (the provider.ts:105 threshold pattern, hyphen-admitting) or the trigger pattern `(?:^|[ \t])#([^\s#]*)$` (regex-escaped trigger char)
3. rebuild the line: `before.slice(0, start) + display + before.slice(col)…` (replace from span start to cursor)
4. `inner.setText(newLines.join("\n"))` (undoable)
5. caret fix: defensively `(innerAny.setCursorCol as ((c:number)=>void)|undefined)?.(startCol + display.length)` in try/catch; fallback = cursor at end (correct in the common typing-at-end case)

## pi-tui stock applyCompletion semantics (what we reimplement)

`editor.js` ~545/560/1906: `result = provider.applyCompletion(lines, line, col, item, prefix)` → `state.lines = result.lines; state.cursorLine = result.cursorLine; setCursorCol(result.cursorCol); onChange(getText())`. No provider exists on the widget path, so we do the same writes ourselves via the editor's public methods. The PRD calls this "stock applyCompletion semantics REIMPLEMENTED".

## Enter dismiss-then-forward precedent

`src/pi/editor.ts` guard: `isSubmitKey(data, keybindings) && inner.isShowingAutocomplete?.() === true && !prefix.startsWith("/")` → `inner.cancelAutocomplete?.()` then `return innerAny.handleInput?.(data)` — the inner editor's own submit branch then runs. The widget layer must do the same for its OWN line: hide widget + `visibility.onDismissed(true)` (explicit dismissal → suppressUntilWordStart), then forward to the enter-submit proxy `es.handleInput?.(data)` so it can still cancel any stock menu and the inner editor submits. `isSubmitKey` currently lives as a non-exported const in editor.ts — S2 needs it exported (or duplicated duck-typed).

## Repaint on consumed keys

Consumed keys don't flow into inner.handleInput, but `createWidgetEditorFactory` receives `tui` in the factory signature `(tui, theme, keybindings)` — call `tui.requestRender?.()` defensively after a Tab insert (and rely on pi-tui's per-input-event render otherwise).

## Key matching & tests
- `matchesKey(data, "tab")` from `@earendil-works/pi-tui` (index.d.ts export; S1 already imports matchesKey).
- `test/editor-enter.test.ts` — the recording-stub pattern (fakeInner, calls[], set-trap throw pin). `test/widget.test.ts` exists (T1.S2 render suite); S1 appends key-handling clauses; S2 appends Tab/Enter clauses.
- Never-mutate pin: Proxy around inner whose `set` trap throws.

## Dependencies on in-flight S1
Per `plan/003_bbac3b15e8d0/P1M3T3S1/PRP.md`: widget.ts will have `decideWidgetKey` returning `{action:"forward"}` for Tab/Enter, wired into a second Proxy around the enter-submit proxy; `WidgetKeyDeps {widgetState, visibility}` optional. S2 replaces those forward branches.
