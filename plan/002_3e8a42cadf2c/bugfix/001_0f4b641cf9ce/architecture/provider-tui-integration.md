# Provider / pi-tui Integration Findings (BUG-001, BUG-005)

## pi-tui editor semantics (verified in node_modules/@earendil-works/pi-tui/dist)
- Provider contract (autocomplete.d.ts): `getSuggestions(lines, cursorLine, cursorCol, options: { signal: AbortSignal; force?: boolean })`,
  `applyCompletion(lines, cursorLine, cursorCol, item, prefix)`, optional `triggerCharacters`, `shouldTriggerFileCompletion`.
  **Providers never see `explicitTab`** — editor.js:1892 passes only `{ signal, force }`.
- `isSlashMenuAllowed()` (~:1765): `cursorLine === 0`. `isInSlashCommandContext(before)` (:1775):
  `isSlashMenuAllowed() && before.trimStart().startsWith("/")`.
- `handleTabCompletion()` (:1812): slash context AND `!before.trimStart().includes(" ")` → `handleSlashCommandCompletion()`
  → `requestAutocomplete({ force: false, explicitTab: true })`; **else** → `forceFileAutocomplete(true)` → `{ force: true, explicitTab: true }`.
- `runAutocompleteRequest` (:1885-1920): single-item fast path (verbatim, :1902):
  `if (options.force && options.explicitTab && suggestions.items.length === 1)` → apply immediately, NO menu.
  Otherwise `applyAutocompleteSuggestions(suggestions, options.force ? "force" : "regular")` — **BOTH modes open the menu**.
- Stock `applyCompletion` (autocomplete.js:265+): blind deletion — `beforePrefix = line.slice(0, cursorCol - prefix.length)`;
  `isQuotedPrefix = prefix.startsWith('"') || prefix.startsWith('@"')`; slash branch when `prefix.startsWith("/") && beforePrefix.trim()==="" && !prefix.slice(1).includes("/")`.
  ⇒ A provider must never return a prefix that is not the literal text before the cursor (BUG-005's `#` residue class).

## hapax provider today (src/pi/provider.ts)
- `extractMatchState(lines, line, col, config)`: trigger regex `(?:^|[ \t])#([^\s#]*)$` → `{mode:"trigger", fragment, prefix:"#"+frag}`;
  else threshold regex `/[A-Za-z][A-Za-z0-9_]*$/` with `len >= config.threshold` → `{mode:"threshold", fragment, prefix:frag}`;
  else null. **No stock-context gating — root of BUG-001(a).**
- `createHapaxProvider(store, config, current, chain).getSuggestions` order:
  1. aborted → delegate to `current`.
  2. armed chain branch (runs BEFORE extractMatchState — root of BUG-005):
     zero-typed-char (`before === "" || /[ \t]$/`) → `topSuccessors(armed.word)`; else fragment regex
     `/[A-Za-z][A-Za-z0-9_]*$/` filters successors at threshold 0 — **fragment NOT required to be at a word start**, so
     `x alphaone #b` matches frag `b`, returns successor `betaword` with prefix `b`, chain stays armed.
     Disqualify (no frag / no survivors) → `chain.reset()` + fall through.
     Forced → single-item return (`forced ? { items:[r.items[0]], prefix }`).
  3. `extractMatchState` → null ⇒ delegate to `current`.
  4. `rankMatches(store, fragment)` → 0 matches ⇒ clear live caches, delegate.
  5. Build items; `forced ? { items:[items[0]], prefix }` (the §07 force mitigation) : full set.
- `applyCompletion`: arms chain via `liveKeyByValue` (CHAIN_KEY_PREFIX `"\u0000chain:"`), then unconditionally
  `current.applyCompletion(...)`.
- **BUG-001(b) mechanics:** slash-context Tab sends `{force:false}` → step 3-5 return the full multi-item hapax word set
  (single-item fast path needs force) → editor opens menu on ONE Tab; second Tab completes `renewable` into `/renewable`.
  Threshold typing `/re`, `@me`, `"src/roun` likewise hijack: `current.getSuggestions` never called.

## Fix design (validated against the above)
1. New exported pure classifier `classifyStockContext(lines, cursorLine, cursorCol): "slash" | "mention" | "quoted-path" | "path" | null` in provider.ts:
   - `slash`: mirror editor.js exactly — `cursorLine === 0 && before.trimStart().startsWith("/") && !before.trimStart().includes(" ")`.
   - `mention`: trailing identifier fragment immediately preceded by `@` at word start.
   - `quoted-path`: odd count of `"` in `before` on the cursor line (unclosed quote).
   - `path`: trailing fragment immediately preceded by `/` (unquoted path segment, e.g. `src/roun`).
   Keep `extractMatchState` itself pure/unchanged (its unit tests stay meaningful); gating lives in `getSuggestions`.
2. In `getSuggestions`, immediately after the aborted check and BEFORE the armed-chain branch:
   `if (classifyStockContext(...)) return current.getSuggestions(lines, cursorLine, cursorCol, options);`
   — options passed through UNCHANGED (tests assert object identity). This simultaneously fixes typing-path preemption,
   the Tab-opens-menu slash path (stock returns its own items; hapax never injects multi-item sets under force:false),
   and forced Tab in stock contexts (stock keeps native behavior). Behavior inside quotes becomes "identical to stock pi"
   (§09 item 6) — word completion inside quotes is deliberately forfeited, matching the acceptance criterion.
3. BUG-005: in the armed-branch fragment path, require the matched fragment to sit at a word start
   (`before.length - frag.length === 0 || /[ \t]/.test(before[before.length - frag.length - 1])`).
   If not (trigger char, punctuation, `/`, etc. glued before the fragment) → `chain.reset()` and fall through to the
   normal path (stock-context guard → extractMatchState) so trigger mode answers with prefix `#frag` (consumed correctly
   by blind deletion) and punctuation resets the chain per the §07 state machine.
4. Leave the §07 force mitigation (single-item when `options.force === true`) intact for genuine hapax contexts.

## Test angles (conventions)
- provider-match.test.ts: classifier unit cases (`/re` line 0; `/model arg re` NOT slash; `@jo`; `"src/roun`; `src/roun`; plain prose unaffected; trigger `#` still hapax).
- provider.test.ts / calibration sentinel identity: `getSuggestions(['/re'],0,3,{signal,force:false})` → SENTINEL (stock), same options object;
  forced variant too; armed chain + `/re` → SENTINEL.
- chain.test.ts: `x alphaone #b` → trigger-mode items, prefix `'#b'`, chain idle; `x alphaone be` still filters; zero-char offer unchanged.
- editor-sim.ts: accepting the `#b` item deletes exactly 2 chars (no `#` residue); one-word invariant via assertWordsOnly.
