# System Context — hapax (2026-09 research pass)

## Project state: GREENFIELD

`/home/dustin/projects/hapax` is an empty git repo containing ONLY:
- `spec/` — the PRD source documents (SPEC.md + 01..09 section files). **Read-only.**
- `plan/001_88fc3a66fd74/` — orchestrator plan dir (this architecture research).
- `.pi/remote-pi/config.json` — unrelated pre-existing remote-pi config.
- `.envrc` (direnv, 25 bytes).

There is **no source code, no package.json, no test setup yet**. Everything is built
from scratch per the PRD module layout (`src/core/`, `src/pi/`, `dict/`, `tools/build-dict.mjs`,
`test/`). The PRD's file tree is the authoritative layout; no existing patterns constrain us.

## Runtime environment

- pi coding agent **v0.84.4** installed at
  `/home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent`
  (runtime bundle `dist/bundle/cli.js`, launched via `/home/dustin/.local/bin/pi`).
  A duplicate/managed copy exists under `/home/dustin/.pi/agent/npm/node_modules`.
  Latest published on npm is 0.85.1 — pin devDependency types to `~0.84.4` to match
  the installed runtime (see `external_deps.md`).
- Node with ESM support; extensions run under **jiti 2.7.0** TS transpiler at load
  time (no build step, no tsx/esbuild needed for the extension itself).
- The pi **source repo** is available locally at `/home/dustin/projects/pi`
  (`packages/coding-agent/`) with ~80 working extension examples in
  `packages/coding-agent/examples/extensions/` — the best reference implementations:
  - `github-issue-autocomplete.ts` — a complete `addAutocompleteProvider` wrapper
    (trigger regex on text-before-cursor, `AutocompleteSuggestions {items, prefix}`
    return, delegation of `applyCompletion`).
  - `hello.ts` — factory shape (`export default function (pi: ExtensionAPI) {...}`).
  - `with-deps/` — package.json with `"pi": { "extensions": ["./src/..."] }` manifest.

## Extension loading & local dev loop (validated)

Loader: `packages/coding-agent/src/core/extensions/loader.ts`.
Discovery order (`discoverAndLoadExtensions`): project-local `<cwd>/.pi/extensions/`
→ global `~/.pi/agent/extensions/` → explicit settings paths. Within a directory:
direct `*.ts|*.js` files load bare; **subdirectories resolve via (1) package.json
`pi.extensions` manifest, (2) `index.ts`/`index.js`. No recursion beyond one level.**

For hapax (a multi-file package with `package.json { "pi": { "extensions":
["./src/pi/index.ts"] } }`), the dev loop options are:
1. `pi -e /home/dustin/projects/hapax` — the `-e/--extension <path>` CLI flag
   (repeatable) points pi at the repo dir; the pi-manifest in package.json resolves
   the entry. Best iteration loop (no copying).
2. Symlink `~/.pi/agent/extensions/hapax` → the repo (auto-discovered globally).
3. `.pi/extensions/hapax` symlink inside the repo itself for dogfooding.

**Trust:** project-local extension dirs require project trust (`trust.json` maps
trusted cwds; `/home/dustin/projects` is listed — per-cwd resolution may still
prompt on first launch; accept it). Global-dir and `-e` loading bypass the prompt.
`ctx.isProjectTrusted()` exists on `ExtensionContext` and must gate reading the
project-local `.pi/hapax.json` config.

## Tooling corrections vs PRD (IMPORTANT for downstream agents)

1. **`pi --check` does not exist** (verified `pi --help`). The PRD DoD's
   "`pi --check` (or lint) clean" must be satisfied instead by:
   `tsc --noEmit` (strict) + `vitest --run` green. Wire both into `package.json`
   scripts (`check`, `test`).
2. **No test framework ships inside the installed pi node_modules** — hapax needs
   its own standalone vitest devDependency (pi's own repo uses vitest 4.x).
3. jiti transpiles TS transparently; but **`import.meta.url` support under jiti is
   not guaranteed** for TS files transpiled to CJS. The dictionary path resolution
   must use the dual pattern:
   ```ts
   const here = typeof __dirname !== "undefined"
     ? __dirname
     : path.dirname(fileURLToPath(import.meta.url));
   ```
   so `dict/common-en.bin` resolves under both jiti-CJS and native-ESM loading.

## Performance / environment notes

- `getSuggestions` is called on the keystroke path by pi's editor; the PRD's
  "< 1 ms" budget applies to the synchronous store query performed *inside* the
  async provider method (see `pi_extension_api.md` §1 for the async contract).
- Extensions may freely use node builtins (`fs`, `path`, `os`, `node:scheduler`
  where available — guard with a fallback to `setImmediate`).
- No persistence anywhere: store dies at `session_shutdown`; nothing written to
  disk except the repo's own build artifacts.

## Feasibility verdict

PRD is **feasible as written** on pi 0.84.4 with the API corrections catalogued in
`pi_extension_api.md`. The two-layer split (`src/core/` pure, `src/pi/` adapter) is
directly enforceable: `src/core/**` imports nothing from pi packages; `src/pi/**`
imports types from `@earendil-works/pi-coding-agent` + `@earendil-works/pi-tui`
(devDependencies, type-only at runtime).