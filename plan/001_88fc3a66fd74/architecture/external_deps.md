# External Dependencies — hapax

## Runtime dependencies: ZERO (PRD constraint, honored)
- Dictionary loader: hand-rolled (fs.readFileSync + typed-array views).
- Build script `tools/build-dict.mjs`: node stdlib only (fs, path, Buffer).
- No network, no telemetry, no persistence.

## devDependencies (needed despite "no deps" — tooling/type-only, never bundled)
| Package | Why | Version |
|---|---|---|
| `@earendil-works/pi-coding-agent` | `ExtensionAPI`, event types (`import type` only in `src/pi/`) | `~0.84.4` (match installed runtime; latest npm is 0.85.1 — do NOT float ahead of runtime) |
| `@earendil-works/pi-tui` | `AutocompleteItem/Provider/Suggestions` types | `~0.84.4` / `~0.85.x` matching the above |
| `typescript` | `tsc --noEmit` strict check (replaces nonexistent `pi --check`) | ^5.x |
| `vitest` | unit tests (pi's own repo standard, vitest 4.x) | ^4 |

Key rules:
- `src/core/**` must import NOTHING from pi packages (two-layer split, enforced).
- `src/pi/**` uses **type-only imports** from the pi packages; at runtime under jiti
  the extension runs inside pi, so no runtime dep is required for these symbols.
- No other deps. Adding any runtime dependency violates the PRD.

## Dictionary corpus (out of repo)
- `tools/build-dict.mjs` consumes `word<TAB>count` TSVs; corpus prep is out of scope.
- Operator supplies TSVs (e.g. Google Books unigrams / wordfreq-style lists).
- `dict/common-en.bin` is a build artifact shipped with the extension; tests use a
  tiny in-memory table (10 words) built by a test helper — never the 1.3 MB artifact.
- Missing/corrupt dict at runtime → notify + extension disables itself (PRD §03).

## Environment facts
- Extensions transpiled by jiti 2.7.0 at load; node builtins (`fs`,`path`,`os`,
  `node:scheduler` guarded) usable.
- No test framework in installed pi node_modules; standalone vitest project required.
- `pi -e <dir>` (repeatable CLI flag) loads an extension dir directly — primary
  dev loop; alternative: symlink into `~/.pi/agent/extensions/hapax`.