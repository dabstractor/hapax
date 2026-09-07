# PRP — P1.M3.T1.S1: Config load/merge/validate with defaults + repair

## Goal

**Feature Goal**: Implement `loadConfig()` in a new `src/pi/config.ts` — the
first module of the pi adapter layer (M3). It merges three layers (built-in
defaults → `~/.pi/agent/hapax.json` user-global → `.pi/hapax.json`
project-local, later wins), validates and repairs every field, warns via an
injected `notify` callback on malformed files or repaired values, and returns a
fully-valid `HapaxConfig`. It imports **only node builtins** (no pi imports) so
it is trivially unit-testable.

**Deliverable**:
1. `src/pi/config.ts` — `HapaxConfig` type, `DEFAULT_CONFIG`, `loadConfig(opts)`,
   pure validation helpers.
2. `test/config.test.ts` — full unit suite (defaults, precedence, malformed
   JSON, repair/clamping, untrusted project, `triggerChar: ""`).
3. `README.md` — new "Configuration" section (schema table, file paths,
   precedence, repair behavior, not-configurable list).

**Success Definition**: `npm run check` and `npm test` pass (including the new
suite); a config file with garbage values still yields a valid config with
notify warnings; missing files are silent.

## Why

- PRD §08 (h2.45–h2.47): pi has **no extension-settings API**; the extension
  reads plain JSON itself. Config surface is deliberately tiny; salience
  weights, admission bands, gate rules, eviction cap, debounce intervals,
  popup timing are **never** configurable.
- Downstream consumers (within M3): `src/pi/provider.ts` (P1.M3.T3) uses
  `triggerChar` / `threshold` / `maxSuggestions`; `src/pi/ingest.ts`
  (P1.M3.T2, M2) uses `enablePhrases`; `src/pi/index.ts` (P1.M3.T5) uses
  `debug` to register `/acwords` (P1.M3.T4). `src/pi/index.ts` will call
  `ctx.ui.notify` and `ctx.isProjectTrusted()` — those exist on pi's
  `ExtensionContext`/UI context (verified in
  `node_modules/@earendil-works/pi-coding-agent/dist`: `notify(message,
  type?: "info"|"warning"|"error")` and `isProjectTrusted: () => boolean`).
- This module is the seam that keeps the adapter testable: inject `notify`,
  `cwd`, `projectTrusted`, and (for tests) `homeDir`.

## What

### Behavior contract

1. **Type & defaults** (exact):
   ```ts
   export interface HapaxConfig {
     /** single non-word non-space char, or "" to disable trigger mode */
     triggerChar: string;
     /** chars before threshold matching: 1 | 2 | 3 */
     threshold: number;
     /** 1–20 */
     maxSuggestions: number;
     /** M2 flag; INERT in M1 builds */
     enablePhrases: boolean;
     /** enables /acwords command + store dump */
     debug: boolean;
   }

   export const DEFAULT_CONFIG: HapaxConfig = {
     triggerChar: "#",
     threshold: 2,
     maxSuggestions: 8,
     enablePhrases: true,
     debug: false,
   };
   ```

2. **Signature** (exact):
   ```ts
   export interface LoadConfigOptions {
     cwd: string;
     projectTrusted: boolean;
     notify: (msg: string, level: "warning") => void;
     /** override for tests; defaults to os.homedir() */
     homeDir?: string;
   }

   export function loadConfig(opts: LoadConfigOptions): HapaxConfig;
   ```

3. **File paths**:
   - User-global: `<homeDir>/.pi/agent/hapax.json` (`homeDir` defaults to
     `os.homedir()`).
   - Project-local: `<cwd>/.pi/hapax.json` — read **only when
     `projectTrusted === true`** (untrusted ⇒ file ignored entirely, no
     warning, as if missing).
   - Use `node:fs`'s `readFileSync` + `JSON.parse`; missing file
     (`ENOENT`) is silent/normal.

4. **Merge order**: defaults → user-global → project-local; later layer wins
   per-key **when the key is present and valid**. Invalid value in a layer ⇒
   repair to the previous layer's value and `notify` once per repaired field.

5. **Malformed JSON** (parse error, or file is not an object): discard the
   entire layer, `notify` exactly once with
   `` `hapax: malformed ${path}, using defaults` `` (level `"warning"`), and
   continue with the previous layer. A layer that is valid JSON but not a
   plain object counts as malformed.

6. **Validation rules**:
   - `triggerChar`: valid iff it matches `/^[^\w\s]$/` **or** equals `""`
     (disables trigger mode). Any other value (multi-char, alphanumeric,
     whitespace, non-string, missing in a layer) ⇒ repair to previous layer
     value.
   - `threshold`: numbers clamped to 1–3 (below 1 → 1, above 3 → 3);
     non-number → repair to previous value. Clamp as `Math.min(3,
     Math.max(1, Math.round(v)))`.
   - `maxSuggestions`: clamped to 1–20 the same way; non-number → repair.
   - `enablePhrases`, `debug`: accept only real booleans (`typeof ===
     "boolean"`); any other type → repair to previous value. (No truthy
     coercion — JSON has real booleans.)
   - **Notify when repaired**: e.g.
     `` `hapax: invalid triggerChar in ${path}, using "${prev}"` `` — one
     notification per repaired field. Exact wording is up to the implementer
     but must include the field name and the path.
   - **Unknown keys are ignored silently** (forward compatibility).
   - The notify callback must never throw the loader: wrap nothing — the
     callback is expected well-behaved (mocked in tests, `ctx.ui.notify` in
     production).

7. **Forbidden** (settled, h2.47): do NOT add config fields for salience
   weights, admission bands (220/120), shape-gate rules, eviction cap,
   debounce intervals, or popup timing. Ever.

## All Needed Context

### Documentation & References

```yaml
- file: src/pi/index.ts
  why: current stub; do NOT modify in this task (factory lands in P1.M3.T5.S1)
  gotcha: only create config.ts here — index wiring is a later task

- file: test/store.test.ts
  why: house test style — long header doc-comment, vitest describe/it,
        fixture factory helpers, .js import extensions
  pattern: follow exactly for test/config.test.ts

- file: package.json
  why: scripts are `npm run check` (tsc --noEmit) and `npm test` (vitest --run)

- file: spec/08-configuration.md
  why: authoritative spec for this task (PRD §08)

- url: https://nodejs.org/api/fs.html#fsreadfilesyncpath-options
  why: readFileSync for config reads; ENOENT check via err.code
- url: https://nodejs.org/api/os.html#oshomedir
  why: os.homedir() default for homeDir
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: NodeNext module resolution — relative imports need .js
// extensions: import { loadConfig } from "../src/pi/config.js";
// CRITICAL: config.ts must import ONLY node builtins
// (node:fs, node:os, node:path) — zero pi imports. Tests stay pure.
// CRITICAL: project-local file is read ONLY if projectTrusted — read the
// trust flag BEFORE touching the filesystem (do not stat an untrusted path).
// Notify level string must be exactly "warning" (matches pi's UI context API).
// Tests: use fs.mkdtempSync(path.join(os.tmpdir(), "hapax-cfg-")) for fake
// home/cwd dirs and write fixture JSON inside; clean up in afterEach.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/pi/config.ts
  - IMPLEMENT: HapaxConfig, DEFAULT_CONFIG, LoadConfigOptions, loadConfig(),
    plus small pure helpers (validateTriggerChar, clampNumber) — keep
    validation pure and individually testable
  - NAMING: exact names above; snake-free camelCase fields per PRD schema
  - IMPORTS: node:fs, node:os, node:path only
  - PLACEMENT: src/pi/config.ts

Task 2: CREATE test/config.test.ts
  - FOLLOW pattern: test/store.test.ts (header doc-comment, describe/it,
    fixture helpers, .js imports)
  - COVERAGE (minimum):
    * defaults returned when no files exist; notify never called
    * user-global overrides defaults; project-local overrides user-global
    * project-local ignored when projectTrusted=false (file present, no effect)
    * malformed JSON in either file → one "hapax: malformed <path>" warning,
      layer discarded, remaining layers still applied
    * triggerChar repairs: "##" → repaired; "a" → repaired; " " → repaired;
      "" accepted; "#" default
    * threshold 0→1, 5→3, "two" (string) → repaired to previous
    * maxSuggestions -3→1, 99→20
    * enablePhrases: "yes" (string) → repaired; false accepted
    * debug: 1 (number) → repaired; true accepted
    * unknown keys ignored silently
    * both files malformed → two warnings, pure defaults
  - FIXTURES: mkdtempSync temp dirs; writeSync JSON files; record notify
    calls into an array
  - PLACEMENT: test/config.test.ts (project test convention — NOT colocated)

Task 3: MODIFY README.md — add "## Configuration" section
  - ADD after the dictionary build material: schema table (field | type |
    default | valid | meaning), file paths, precedence order, repair/clamp
    behavior with malformed-JSON fallback, note that enablePhrases is inert
    in M1, and the explicit "Not configurable" list (h2.47)
```

### Implementation Patterns & Key Details

```ts
// Layer application pattern
function applyLayer(
  current: HapaxConfig,
  raw: unknown,
  path: string,
  notify: (m: string, l: "warning") => void,
): HapaxConfig {
  // raw already parsed; if not a plain object → caller handled malformed
  // per key: only override when present AND valid; else repair-notify
}

// readLayer: readFileSync → JSON.parse; catch parse errors AND
// non-plain-object roots as "malformed"; catch err.code === "ENOENT" as
// missing (silent). Other fs errors (e.g. EACCES) → treat as missing +
// one warning (defensible; document in code comment).
```

### Integration Points

```yaml
# No integration in this task — consumers come later:
# provider.ts (P1.M3.T3): triggerChar/threshold/maxSuggestions
# ingest.ts (P1.M3.T2): enablePhrases (inert in M1)
# index.ts (P1.M3.T5): debug → register /acwords (P1.M3.T4);
#   index.ts will call loadConfig({ cwd: ctx.cwd,
#     projectTrusted: ctx.isProjectTrusted(), notify: (m, l) =>
#     ctx.ui.notify(m, l) })
```

## Validation Loop

### Level 1: Syntax & Style
```bash
npm run check          # tsc --noEmit — must pass with zero errors
```

### Level 2: Unit Tests
```bash
npx vitest --run test/config.test.ts   # new suite green
npm test                               # full suite still green
```

### Level 3: Integration sanity (manual, no pi needed)
```bash
mkdir -p .pi && echo 'garbage{' > .pi/hapax.json
node --input-type=module -e "
import { loadConfig } from './src/pi/config.ts';" # (or via vitest scratch) —
# simpler: rely on the test suite; delete the scratch .pi file afterward:
rm -rf .pi
```

## Final Validation Checklist

- [ ] `npm run check` passes
- [ ] `npm test` passes including test/config.test.ts
- [ ] config.ts imports only node builtins (grep: no `@earendil-works`)
- [ ] Default values exactly: `#, 2, 8, true, false`
- [ ] Malformed file → exactly one warning naming the path; run continues
- [ ] Untrusted project ⇒ project-local file never read
- [ ] No new config fields beyond the five (h2.47 respected)
- [ ] README "Configuration" section added (schema, paths, precedence, repair)
- [ ] No modification to src/pi/index.ts, PRD files, or tasks.json

## Anti-Patterns to Avoid

- ❌ Don't import pi types in config.ts — it stays node-pure
- ❌ Don't truthy-coerce enablePhrases/debug — require real booleans
- ❌ Don't warn on missing files — they are the normal case
- ❌ Don't read the project-local path (even to stat) when untrusted
- ❌ Don't add "helpful" extra config fields
- ❌ Don't colocate tests in src/ — this repo uses test/*.test.ts

**Confidence Score: 9/10** — signature, paths, defaults, and validation rules
are fully pinned by the work item + PRD §08; pi API surface (notify level
"warning", isProjectTrusted) verified against installed types.