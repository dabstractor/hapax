# Research notes — P1.M3.T5.S2 (jiti-safe dict path + manifest + dev-load verification)

## Verified facts

- **jiti 2.7.0** transpiles hapax's TS at pi load time. `import.meta.url` support
  for TS transpiled to CJS is NOT guaranteed → must use the dual
  `__dirname` / `import.meta.url` pattern (see
  plan/001_88fc3a66fd74/architecture/system_context.md §"Tooling corrections", item 3).
- **Loader discovery** (pi source: `packages/coding-agent/src/core/extensions/loader.ts`,
  mirrored in system_context.md §"Extension loading & local dev loop"):
  project-local `<cwd>/.pi/extensions/` → global `~/.pi/agent/extensions/` →
  explicit `-e/--extension` paths. Subdirectories resolve via (1) package.json
  `pi.extensions` manifest, (2) `index.ts`. No recursion beyond one level.
- **Verified dev-load options** (already validated by prior architecture research):
  1. `pi -e /home/dustin/projects/hapax` (repeatable flag; bypasses trust prompt)
  2. symlink `~/.pi/agent/extensions/hapax -> /home/dustin/projects/hapax`
     (auto-discovered; the `pi` manifest in package.json resolves entry)
  3. project-local `.pi/extensions/hapax` — requires project trust (first-run prompt).
  Currently `~/.pi/agent/extensions/` contains only `sublink`/`subagent` etc.
  (no hapax symlink yet — verification step must use `-e` at minimum).
- **package.json manifest is already correct** (exists at repo root):
  `{ "name": "hapax", "type": "module", "pi": { "extensions": ["./src/pi/index.ts"] } }`
  — nothing to change there; task only VERIFIES it loads.
- **S1 contract** (plan/001_88fc3a66fd74/P1M3T5S1/PRP.md): `resolveDictPath()`
  is an ISOLATED EXPORTED SEAM in `src/pi/index.ts`, explicitly marked
  PROVISIONAL pending this task. S1's lazy-dict wraps `resolveDictPath()`'s
  result; failure → one `ctx.ui.notify(..., "error")` + permanent disable.
  This task REPLACES the provisional body with the jiti-safe implementation.
- **Dict artifact**: `dict/common-en.bin` exists (HAPX v1, 50,927 entries,
  ~1.2 MB). Loaded by `loadDictionary(path)` in `src/core/dictionary.ts` (L82).
- **Repo layout**: `src/pi/index.ts` lives at `<repo>/src/pi/` → `here` = repo
  `/src/pi`, so the dict is at `path.join(here, "..", "..", "dict", "common-en.bin")`.
- **README.md** exists (129 lines) but has NO "Development" section yet —
  task adds one.
- No `pi --check` exists; gates are `npm run check` (tsc) + `npm test` (vitest).
- No new dependencies allowed (PRD §02).