# PRP — P1.M1.T1.S1: package.json, tsconfig, vitest, directory skeleton

---

## Goal

**Feature Goal**: Scaffold the greenfield hapax repo with the exact project
configuration and directory skeleton mandated by PRD §02, such that
`npm run check` (tsc --noEmit) and `npm test` (vitest --run, 0 tests) both
succeed trivially, and the pi extension manifest points at `src/pi/index.ts`.

**Deliverable**:
- `package.json` (with pi manifest + scripts + devDependencies)
- `tsconfig.json` (strict, NodeNext)
- Directory skeleton: `src/core/`, `src/pi/`, `dict/`, `tools/`, `test/`
- `README.md` stub
- `src/pi/index.ts` minimal stub (empty extension factory — required so tsc
  has something to type-check and the manifest target exists; fleshed out by
  P1.M3.T5.S1 later)

**Success Definition**: `npm install` succeeds; `npm run check` exits 0;
`npm test` exits 0 (0 test files found or empty pass); `npm run bench`
is a defined script; no runtime dependencies present in package.json.

## Why

This is the first subtask of the whole plan — every later subtask
(types.ts, dictionary.ts, segment.ts, …) lands inside this skeleton. Getting
the two-layer layout (`src/core/` pure vs `src/pi/` adapter) and the tooling
contract (check = `tsc --noEmit` + vitest, since `pi --check` does not exist)
right now prevents rework across all 30+ downstream subtasks.

## What

- `package.json` exactly per PRD §02, plus scripts.
- TypeScript strict configuration suitable for a jiti-loaded, no-build-step
  pi extension (ESM, NodeNext, no emit).
- Vitest as the sole test runner (PRD §09 testing strategy).
- Empty directories for `dict/`, `tools/`, `test/`; stub files only where
  required for tsc/manifest resolution.
- README.md stub: title + one-liner only (P1.M4.T2.S1 fills it later).

### Success Criteria

- [ ] `npm run check` → exit 0, zero type errors
- [ ] `npm test` → exit 0 with zero tests
- [ ] `package.json` contains `"pi": { "extensions": ["./src/pi/index.ts"] }`
- [ ] devDependencies ONLY: typescript, vitest, @earendil-works/pi-coding-agent,
      @earendil-works/pi-tui — zero `"dependencies"` key
- [ ] Directories `src/core/`, `src/pi/`, `dict/`, `tools/`, `test/` exist

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: this PRP contains the exact
package.json, tsconfig, and stub contents; the repo is greenfield (only
`spec/`, `plan/`, `.pi/remote-pi/`, `.envrc`, `.gitignore` exist).

### Documentation & References

```yaml
- file: plan/001_88fc3a66fd74/architecture/system_context.md
  why: Validated facts about pi v0.84.4 extension loading (jiti, no build step),
        devDependency version pinning, and the pi.extensions manifest contract.
  critical: "pi --check" does NOT exist; check = "tsc --noEmit" + "vitest --run".
            devDependency types must be pinned "~0.84.4" (installed runtime),
            NOT latest npm 0.85.1.

- file: package.json layout from PRD §02 (reproduced below)
  why: The manifest is the contract pi uses to discover the extension.
  pattern: "pi": { "extensions": ["./src/pi/index.ts"] }
  gotcha: pi discovers via project-local .pi/extensions/ or ~/.pi/agent/extensions/;
          in-repo package layout is loaded via `pi -e <repo>` or symlink (later task).

- url: https://www.typescriptlang.org/tsconfig/#ModuleResolution
  why: NodeNext module resolution requires explicit .js extensions in relative
       imports of .ts files (relevant for later tasks, set the convention now).
```

### Current Codebase tree

```bash
$ tree -a -I .git
.
├── .envrc                # direnv, sets PRD_FILE=./spec/SPEC.md (leave alone)
├── .gitignore            # already ignores node_modules/, dist/, .env (leave alone)
├── .pi/
│   └── remote-pi/        # unrelated pre-existing config (leave alone)
├── plan/                 # orchestrator plan dir (READ-ONLY)
└── spec/                 # PRD sources (READ-ONLY)
```

### Desired Codebase tree with files to be added

```bash
hapax/
├── package.json          # pi extension manifest + scripts + devDeps (THIS TASK)
├── tsconfig.json         # strict TS config, noEmit (THIS TASK)
├── README.md             # stub: title + one-liner (THIS TASK)
├── dict/                 # .gitkeep — packed dict lands here (P1.M1.T3)
├── tools/                # .gitkeep — build-dict.mjs lands here (P1.M1.T3)
├── src/
│   ├── core/             # .gitkeep — pure layer (P1.M1.T1.S2 onward)
│   └── pi/
│       └── index.ts      # minimal stub export (THIS TASK; full factory in P1.M3.T5.S1)
└── test/                 # .gitkeep — *.test.ts files land here (P1.M1.T2.S2 onward)
```

Use `.gitkeep` (empty) files so the otherwise-empty directories survive git.
**Do NOT create empty placeholder .ts files** for the other modules — the
contract explicitly says placeholders are not required.

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: pi extension has NO build step. jiti 2.7.0 transpiles TS at load.
#   → tsconfig must NOT emit ("noEmit": true); vitest/tsc are dev-time only.
# CRITICAL: Version pinning. Installed pi runtime is v0.84.4. npm latest is 0.85.1.
#   devDeps must be: "@earendil-works/pi-coding-agent": "~0.84.4" and
#   "@earendil-works/pi-tui": "~0.84.4" so TS types match the runtime.
#   (Verified: pi-tui publishes matching 0.84.x line; latest 0.85.1 must not float ahead.)
# CRITICAL: "module": "nodenext" requires later code to use `.js` extensions in
#   relative TS imports. Set that convention now in the tsconfig.
# GOTCHA: Node is v26.7.0 / npm 11.18.0 — modern ESM defaults; "type": "module"
#   in package.json is required and tools/*.mjs is naturally ESM.
# GOTCHA: .gitignore already covers node_modules — do not modify it (and never
#   add plan/ or spec/ to it).
# GOTCHA: vitest v4 needs no config file for the default `test/` glob of
#   `**/*.test.ts` — omit vitest.config; add one later only if benchmarks need it.
```

## Implementation Blueprint

### Exact file contents

**package.json** (verbatim — this is the deliverable):

```json
{
  "name": "hapax",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "check": "tsc --noEmit",
    "test": "vitest --run",
    "bench": "vitest bench"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "~0.84.4",
    "@earendil-works/pi-tui": "~0.84.4",
    "typescript": "^5",
    "vitest": "^4"
  }
}
```

Notes: `"private": true` prevents accidental npm publish (harmless addition).
Zero `"dependencies"` key — PRD: "No npm dependencies required for M1. Do not
add dependencies."

**tsconfig.json**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`skipLibCheck: true` is important — the pi-tui / pi-coding-agent type bundles
may pull in lib checks that are out of our control. `types: ["vitest/globals"]`
lets tests use `describe/it/expect` globally (convention for later test files;
if a later test file prefers explicit imports, that's also fine).

**src/pi/index.ts** (minimal valid stub — extension factory comes in
P1.M3.T5.S1; a bare empty module would also satisfy tsc, but a typed no-op
factory matches the eventual shape and proves the type deps resolve):

```typescript
// hapax pi extension entry — full factory implemented in P1.M3.T5.S1.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function hapax(_pi: ExtensionAPI): void {
  // Intentionally empty for now.
}
```

If the `ExtensionAPI` import path does not resolve after install, replace with
`export {}` and a comment — do NOT add a runtime dependency to fix it; the
type import is dev-only and will be resolved in P1.M3.T5.S1. (Check the
installed package's exports map: `node -e "console.log(require('./node_modules/@earendil-works/pi-coding-agent/package.json').exports)"`.)

**README.md**:

```markdown
# hapax

Context-driven autocomplete extension for the pi coding agent — learns the
session's vocabulary and offers word completion. (Status: scaffolding.)
```

**Directory skeleton**:

```bash
mkdir -p src/core src/pi dict tools test
touch dict/.gitkeep tools/.gitkeep src/core/.gitkeep test/.gitkeep
```

(`src/pi/` gets index.ts, no .gitkeep needed.)

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE package.json
  - CONTENT: exactly as specified above (name, version, type, private, pi
    manifest, scripts, devDependencies ~0.84.4 pins)
  - VERIFY: pi manifest key "pi.extensions" == ["./src/pi/index.ts"]

Task 2: CREATE tsconfig.json
  - CONTENT: as specified above (strict, NodeNext, noEmit, vitest/globals)

Task 3: CREATE directory skeleton + .gitkeep files
  - mkdir -p src/core src/pi dict tools test; .gitkeep in all except src/pi

Task 4: CREATE src/pi/index.ts
  - Minimal stub per above; fall back to "export {}" if type import fails

Task 5: CREATE README.md stub (title + one-liner, no more)

Task 6: INSTALL + VALIDATE
  - npm install
  - npm run check  → exit 0
  - npm test       → exit 0 (vitest reports 0 test files)
  - npm run bench  → script defined (will report no bench files; that's fine)
  - git status shows only intended new files (node_modules ignored by existing .gitignore)
```

### Integration Points

```yaml
NPM:
  - devDependencies pinned: @earendil-works/pi-coding-agent ~0.84.4,
    @earendil-works/pi-tui ~0.84.4, typescript ^5, vitest ^4
  - NO "dependencies" key, ever, for M1 (PRD mandate)

GIT:
  - Do not modify .gitignore (already correct)
  - Commit: node_modules/ must be ignored; dict/.gitkeep etc. tracked

FUTURE TASKS (context only — do not implement):
  - P1.M1.T1.S2 adds src/core/types.ts inside this skeleton
  - P1.M3.T5.S2 verifies local dev-load via `pi -e /home/dustin/projects/hapax`
    or symlink — nothing in this task needs to enable it yet
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check
# Expected: exit 0, no output (no .ts errors)

npx tsc --showConfig | head   # sanity: config parses
```

### Level 2: Unit Tests

```bash
npm test
# Expected: exit 0. vitest v4 with 0 test files exits successfully
# ("No test files found" is OK only if exit code is 0; if vitest errors on
#  empty run, add a trivial test/smoke.test.ts asserting true — but try empty first).

npm run bench
# Expected: script exists and runs (0 bench files, exit 0 or benign exit)
```

### Level 3: Integration

```bash
node -e "const p = require('./package.json'); \
  if (!p.pi.extensions.includes('./src/pi/index.ts')) process.exit(1); \
  if (p.dependencies) process.exit(1); \
  console.log('manifest OK, no runtime deps')"
# Expected: manifest OK, no runtime deps

test -d src/core && test -d dict && test -d tools && test -d test && echo "skeleton OK"

node -e "console.log(require('fs').existsSync('./src/pi/index.ts'))"
# Expected: true
```

### Level 4: Domain-Specific

Not applicable — no runtime behavior yet. Extension load verification is
deferred to P1.M3.T5.S2 by design.

## Final Validation Checklist

- [ ] `npm install` completes without errors
- [ ] `npm run check` → exit 0
- [ ] `npm test` → exit 0
- [ ] `npm run bench` script defined and runnable
- [ ] package.json: no `dependencies`, devDeps pinned ~0.84.4 for both @earendil-works packages
- [ ] Directories src/core, src/pi, dict, tools, test all exist in git (via .gitkeep or content)
- [ ] README.md is a stub only (title + one-liner)
- [ ] spec/, plan/, .gitignore, .envrc, .pi/ untouched
- [ ] No placeholder .ts files beyond src/pi/index.ts stub

## Anti-Patterns to Avoid

- ❌ Do NOT add runtime dependencies (PRD mandate for M1)
- ❌ Do NOT let devDeps float to 0.85.x — must match installed runtime ~0.84.4
- ❌ Do NOT add a build step / emit config (jiti transpiles at load)
- ❌ Do NOT add vitest.config.ts / eslint / CI in this task (explicitly out of scope)
- ❌ Do NOT create empty stub .ts files for future modules
- ❌ Do NOT modify .gitignore, spec/, plan/

---

**Confidence Score**: 9/10 — the only mild uncertainty is the exact
`ExtensionAPI` type import path in the stub (fallback to `export {}` is
specified, so it cannot block the task).