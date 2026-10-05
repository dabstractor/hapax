# External dependencies — pi extension API + pi-tui (verified in node_modules)

Versions (package.json): `@earendil-works/pi-coding-agent` ~0.84.4,
`@earendil-works/pi-tui` ~0.84.4. No new runtime dependencies are
introduced by this delta; everything below is already imported by src/.

## pi extension API (`@earendil-works/pi-coding-agent`)

Types: `dist/core/extensions/types.d.ts` (re-exported from
`dist/core/extensions/index.d.ts` and `dist/core/index.d.ts`).

### session_tree (R3 — the new event we handle)

```ts
// types.d.ts:505-512
/** Fired after navigating in the session tree */
export interface SessionTreeEvent {
    type: "session_tree";
    newLeafId: string | null;
    oldLeafId: string | null;
    summaryEntry?: BranchSummaryEntry;
    fromExtension?: boolean;
}
```

- Registration: `on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): void`
  (types.d.ts:918, ExtensionAPI overload set). hapax registers handlers
  today via `pi.on("session_start"|"message_end"|"session_shutdown"|"before_agent_start", ...)`
  in `src/pi/index.ts` (:153/:398/:404/:414) — same shape.
- A pre-event `session_before_tree` (`SessionBeforeTreeEvent`) also
  exists — NOT needed; the rebuild is post-navigation.
- Guard nuance: both ids are `string | null` — the equality guard must
  compare them as-is (`newLeafId === oldLeafId` covers null===null).
- `summaryEntry` (branch summary) must NEVER be ingested (h2.38/h2.40).

### sessionManager (R3 snapshot source)

`ctx.sessionManager: ReadonlySessionManager` (types.d.ts:219) =
`Pick<SessionManager, "getCwd"|"getSessionDir"|"getSessionId"|"getSessionFile"|"getLeafId"|"getLeafEntry"|"getEntry"|"getLabel"|"getBranch"|"buildContextEntries"|"getHeader"|"getEntries"|"getTree"|"getSessionName">`
(`dist/core/session-manager.d.ts:140`).
`getBranch(fromId?: string): SessionEntry[]` (:261) returns leaf→root;
`restoreFromHistory` already copies + reverses it (`src/pi/ingest.ts:738-741`).

### UI registration constraints (drive R3 design)

- `ctx.ui.addAutocompleteProvider(factory)` (types.d.ts:137) — there is
  NO unregister API. A registered fallback provider keeps the store
  instance captured at factory time ⇒ session_tree must rebuild the
  SAME CandidateStore instance in place (reset + replay), not swap slots.
- `ctx.ui.getEditorComponent` / `setEditorComponent` — the widget path
  re-composes by re-wrapping the remembered inner factory
  (`index.ts:275-308` reload-branch precedent).

## pi-tui (widget + tests)

- `Editor` (real class; instantiated directly by
  `test/defer-pi-menu.repro.test.ts` via `createWidgetEditorFactory`'s
  `inner:` option) — its introspection surface used by the editor proxy:
  `isShowingAutocomplete?: () => boolean` and `autocompletePrefix`
  (consumed at `src/pi/editor.ts:111-115`).
- `KeybindingsManager` + `TUI_KEYBINDINGS` (used in the repro harness).
- pi's autocomplete is ASYNC (`requestAutocomplete → getSuggestions`
  returns a Promise; menus open only after resolution) — this is the
  root cause of the R4 race case; deferral must key on the menu's actual
  open state, never on static context classification.

## Tooling

- `node tools/calibrate-bands.mjs [words...]` — dictionary band probe
  (prints len/q/R_eff/verdict + `Cap:` column); reads
  `dict/common-en.bin` (48,802 entries; HAPX v1; 850,554 bytes).
- Node ≥ 18 (test/scripts use ESM `.mjs`); vitest ^4; TypeScript ^5
  strict (`npm run check` = `tsc --noEmit`).
- No network/persistence may be added (design invariants; enforced by
  `test/no-persistence.test.ts`).
