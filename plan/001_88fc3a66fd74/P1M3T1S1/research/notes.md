# Research notes — P1.M3.T1.S1 (config load/merge/validate)

## Codebase facts (verified)
- Project: hapax, ESM (`"type": "module"`), TypeScript strict, `module: NodeNext`,
  `noEmit`. Imports in src/test use `.js` extensions (see test/store.test.ts
  importing `../src/core/store.js`). Vitest with globals; tests in `test/*.test.ts`
  (NOT colocated).
- Scripts: `npm run check` (tsc --noEmit), `npm test` (vitest --run).
- `src/pi/` currently contains only a stub `index.ts` (empty factory taking
  `ExtensionAPI`). This task creates `src/pi/config.ts` — first real adapter module.
- Core layer complete: src/core/{types,segment,shapeGate,score,store}.ts; query.ts
  being implemented in parallel (P1.M2.T5.S1) — config is NOT a dependency of it;
  provider.ts (future) will read triggerChar/threshold/maxSuggestions from HapaxConfig.
- README.md has no "Configuration" section yet (checked: no grep hits).

## pi API facts (verified from node_modules/@earendil-works/pi-coding-agent/dist)
- `notify(message: string, type?: "info" | "warning" | "error"): void` exists on
  the UI context (core/extensions/types.d.ts:76). Work item says call with 'warning'
  level — the API accepts "warning".
- `isProjectTrusted` exists on ExtensionContext actions (dist/core/extensions/runner.js:132,180
  — `isProjectTrusted: () => boolean`). Confirmed.
- pi has NO extension-settings API → plain JSON files (PRD §08).

## Design decisions
- `loadConfig(opts)` takes `{ cwd, projectTrusted, notify }` — no pi imports in
  config.ts (only node builtins: node:fs, node:os, node:path). Keeps it pure/testable.
- Unknown JSON keys: PRD is silent; decision = ignore silently (schema is tiny,
  forward-compatible). Document in README.
- Non-string triggerChar / non-number threshold: treat as invalid → repair to default
  + notify. Type coercion rule: enablePhrases/debug coerced via Boolean-ish semantics
  only for actual booleans? Item says "coerced boolean" — accept truthy JSON booleans;
  non-boolean values repair to default. Keep simple + documented.
- Merge semantics: per-key, later layer wins when present AND valid; invalid value in
  a layer → repair to previous layer's value (or default), notify once per repair.
- Malformed JSON (parse error): notify once with path, discard that whole layer.

## Test approach
- Follow test/store.test.ts style: header comment, vitest describe/it, fixture
  factories. Use `mkdtempSync` (node:fs) + `os.tmpdir()` for fake user-global and
  project dirs; `homedir()` is overridden via injected paths — better: loadConfig
  should take explicit paths? Work item fixes signature with cwd/projectTrusted only,
  so homedir override: allow optional `homeDir` in opts for testability (defaults to
  os.homedir()). Document this seam.