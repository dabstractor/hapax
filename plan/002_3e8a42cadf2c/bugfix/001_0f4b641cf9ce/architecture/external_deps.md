# External Dependencies

## @earendil-works/pi-tui ~0.84.4 (node_modules dist — the shipped artifact the PRD probes)
- `autocomplete.d.ts`: `AutocompleteItem { value, label, description? }`; `AutocompleteSuggestions { items, prefix }`;
  `AutocompleteProvider { triggerCharacters?, getSuggestions(lines, cursorLine, cursorCol, { signal, force? }), applyCompletion(...), shouldTriggerFileCompletion? }`.
  No `explicitTab` reaches providers (editor.js:1892 strips it).
- `components/editor.js`: Tab routing (`handleTabCompletion` :1812): slash context (line 0, `/`-prefixed, no space yet) →
  `{force:false, explicitTab:true}`; everything else → `{force:true, explicitTab:true}`. Fast path :1902
  `if (options.force && options.explicitTab && suggestions.items.length === 1)` applies without menu; otherwise
  `applyAutocompleteSuggestions(suggestions, force ? "force" : "regular")` OPENS the menu in both states.
  `updateAutocomplete` re-queries with `{force: state==="force", explicitTab:false}`.
- `autocomplete.js` stock `applyCompletion`: blind `cursorCol - prefix.length` splice; quoted-prefix and slash-command
  branches keyed on `prefix.startsWith('"')` / `'@"'` / `'/'`.
- Implication: hapax can only prevent Tab-open by never returning multi-item hapax sets in stock-owned contexts
  (delegation) — the single-item fast path requires `force:true`, which slash-context Tab does not send. Verified end-to-end by the PRD probe.
- Version pin: `~0.84.4` alongside `@earendil-works/pi-coding-agent` ~0.84.4 (devDependencies). No other runtime deps.

## Toolchain
- typescript ^5 (`tsc --noEmit`, strict), vitest ^4 (`vitest --run`, no config file, globals via tsconfig), tinybench via `vitest bench`.
- Node scripts in tools/ (calibrate-bands.mjs) run with plain `node`.
- No network, no telemetry (design invariant #4) — tests must not add network deps.
