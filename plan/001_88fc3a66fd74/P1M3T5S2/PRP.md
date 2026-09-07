# PRP — P1.M3.T5.S2: jiti-safe dict path + manifest + local dev-load verification

## Goal

**Feature Goal**: Replace the PROVISIONAL `resolveDictPath()` seam left by
P1.M3.T5.S1 with a jiti-safe implementation (works under both jiti-CJS
transpilation and native ESM), verify the package.json `pi` manifest actually
loads hapax into a real pi session, smoke-test end-to-end suggestions, verify
graceful disable when the dict artifact is missing, and document the dev loop
in README.md.

**Deliverable**:
1. `src/pi/paths.ts` (NEW, tiny) or in-place rewrite of the seam in
   `src/pi/index.ts` — jiti-safe dict path resolution.
2. Possibly-small test additions for the resolution logic.
3. VERIFIED end-to-end dev load (`pi -e` and/or symlink) with recorded evidence
   in README.md.
4. README.md "Development" section (dev loop commands, jiti notes, symlink
   option, disable-on-missing-dict behavior).

**Success Definition**: `pi -e /home/dustin/projects/hapax` starts with no
extension errors; typing a session word shows hapax suggestions (smoke);
temporarily renaming `dict/common-en.bin` produces exactly one error notify
and pi is otherwise fully functional; `npm run check` + `npm test` green.

## User Persona

**Target User**: hapax developers (dogfooding the extension in a live pi session).
**Use Case**: iterate on the extension source without a build step or install copy.
**User Journey**: edit `src/**` → run `pi -e /home/dustin/projects/hapax` →
extension loads fresh (jiti transpiles at load) → completions work.
**Pain Points Addressed**: `import.meta.url` silently misbehaving under jiti;
unclear dev workflow; uncertainty whether the manifest layout actually loads.

## Why

- P1.M3.T5.S1's factory deliberately deferred path resolution to this task —
  the dict path is the last unverified seam in the M1 load chain.
- P1.M4.T1.S1 (scripted integration acceptance) builds directly on the
  verified dev-load path produced here; without it, acceptance has no known-good
  harness.

## What

1. **jiti-safe resolution**: implement
   `resolveDictPath(): string` returning the absolute path to
   `dict/common-en.bin`, valid under BOTH jiti-transpiled-CJS and native ESM
   execution, using the mandated dual pattern:
   ```ts
   const here = typeof __dirname !== "undefined"
     ? __dirname
     : path.dirname(fileURLToPath(import.meta.url));
   return path.join(here, "..", "..", "dict", "common-en.bin");
   ```
   (`src/pi/index.ts` lives at `<repo>/src/pi/`, so two `..` hops reach repo root.)
2. **Manifest verification**: `package.json` already has
   `"pi": { "extensions": ["./src/pi/index.ts"] }` — do not modify it; verify
   by loading: `pi -e /home/dustin/projects/hapax` must start with zero
   extension-load errors (check stderr / `pi --help` for flags; no banner
   expected — clean start is success).
3. **Smoke**: in the live session, type a distinctive word in a message (it
   gets ingested via message_end), then begin typing it in the input box and
   observe a hapax suggestion popup. (Manually verified; record result.)
4. **Graceful-disable verification**: `mv dict/common-en.bin /tmp/` → start
   `pi -e ...` → send one message → expect exactly ONE error notify
   ("hapax: dictionary failed to load") and otherwise normal pi operation;
   restore the file. This exercises S1's disable path against real fs failure.
5. **README Development section** documenting all of the above.

### Success Criteria

- [ ] `resolveDictPath()` implemented with the dual `__dirname`/`import.meta.url` pattern; `import path from "node:path"`, `fileURLToPath` from `node:url` — NO new dependencies
- [ ] Unit test asserts the returned path ends with `dict/common-en.bin` and the parent dir chain resolves from the file's real location
- [ ] `pi -e /home/dustin/projects/hapax` loads with no errors (verified, evidence noted in README)
- [ ] Smoke suggestion observed; missing-dict graceful disable observed and restored
- [ ] README.md has a "Development" section with dev loop, jiti note, symlink option
- [ ] `npm run check` and `npm test` green

## All Needed Context

### Context Completeness Check

The implementing agent gets the exact dual pattern, the exact path arithmetic
(`src/pi/index.ts` → two `..` to repo root), the exact CLI invocation, and the
verified loading/trust facts. No other knowledge required.

### Documentation & References

```yaml
- file: plan/001_88fc3a66fd74/P1M3T5S1/PRP.md
  why: CONTRACT — defines resolveDictPath() as an isolated exported seam in
    src/pi/index.ts, marked PROVISIONAL for this task; lazy-dict wraps its
    result; failure path = one ctx.ui.notify(..., "error") + permanent disable.
  pattern: Replace ONLY the seam body; do not touch factory wiring.
  gotcha: If S1 placed the seam in index.ts, you may either keep it there or
    extract to src/pi/paths.ts (exported `resolveDictPath`); keep the export
    name identical so the factory import is stable.

- file: plan/001_88fc3a66fd74/architecture/system_context.md
  why: VERIFIED loader behavior + jiti notes + trust rules.
  section: "Extension loading & local dev loop (validated)" and
    "Tooling corrections vs PRD" (item 3 = the dual pattern, verbatim).
  critical: jiti 2.7.0 does not guarantee import.meta.url for TS→CJS;
    project-local .pi/extensions/ requires trust prompt; -e and global
    symlink bypass the prompt.

- file: src/core/dictionary.ts
  why: loadDictionary(path) at ~L82 consumes the resolved path; DICT_VERSION=1.
  pattern: The path is only consumed here — no format concerns for this task.

- file: dict/common-en.bin
  why: the artifact (HAPX v1, 50,927 entries, ~1.2 MB) the path must target.

- file: README.md
  why: existing 129-line README; ADD a "## Development" section (no such
    section exists yet). Keep the existing dictionary-build content intact.

- url: https://github.com/kulshekhar/jiti (jiti transpiler repo)
  why: background on ESM/CJS interop at transpile time.
  critical: never assume import.meta.url semantics under jiti — that is the
    entire reason the dual pattern exists.
```

### Current Codebase tree (relevant part)

```bash
hapax/
├── package.json            # pi manifest — VERIFIED, do not modify
├── dict/common-en.bin      # packed dict artifact (exists)
├── src/pi/
│   ├── index.ts            # S1 factory + PROVISIONAL resolveDictPath seam
│   ├── config.ts, ingest.ts, provider.ts, debug.ts
└── test/
    ├── ... existing suites
```

### Desired Codebase tree with files to be added

```bash
src/pi/paths.ts             # NEW (preferred): export resolveDictPath()
                            #   — or keep seam in index.ts; either acceptable
test/paths.test.ts          # NEW: resolution unit test (path-shape assertion)
README.md                   # MODIFIED: add "## Development" section
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: jiti 2.7.0 transpiles TS→CJS; import.meta.url may be undefined or
//   wrong. ALWAYS the dual pattern:
const here = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
// GOTCHA: `__dirname` is not declared in ESM TS — declare it:
declare const __dirname: string | undefined;
//   (tsc --noEmit under "type": "module" needs this ambient declaration.)
// CRITICAL: no new dependencies (PRD §02). Use node:path + node:url only.
// GOTCHA: `pi --check` does NOT exist. Gates are `npm run check` + `npm test`.
// GOTCHA: vitest runs files natively ESM — the test exercises the
//   import.meta.url branch; the jiti/__dirname branch is exercised by the
//   real `pi -e` load (document both in the test comment).
// GOTCHA: the missing-dict verification MUST restore the file afterwards:
//   `mv dict/common-en.bin /tmp/hapax-dict.bak && ... && mv /tmp/hapax-dict.bak dict/common-en.bin`
```

## Implementation Blueprint

### Module shape (src/pi/paths.ts — preferred)

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

declare const __dirname: string | undefined;

/**
 * jiti-safe path to the packed dictionary (P1.M3.T5.S2).
 * pi loads this module via jiti 2.7.0 (TS→CJS) where import.meta.url is not
 * guaranteed; native ESM (vitest, future pi) lacks __dirname. Dual pattern:
 * `here` = this file's dir = <repo>/src/pi → dict is two hops up.
 */
export function resolveDictPath(): string {
  const here = typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "..", "..", "dict", "common-en.bin");
}
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/pi/paths.ts (or rewrite seam in src/pi/index.ts)
  - IMPLEMENT: resolveDictPath() exactly per the dual pattern above
  - NAMING: keep exported name `resolveDictPath` (S1 factory imports it)
  - PLACEMENT: src/pi/ (no pi imports needed — pure path math)
  - IF EXTRACTING: update src/pi/index.ts import to `./paths.js`
    (note the `.js` suffix convention used in existing relative imports)

Task 2: CREATE test/paths.test.ts
  - IMPLEMENT: assert resolveDictPath() ends with
    `dict/common-en.bin` and that path.dirname(path.dirname(dirname(result)))
    equals process.cwd() (repo root when vitest runs from root)
  - FOLLOW pattern: existing test/*.test.ts (vitest, describe/it, no config)
  - COMMENT: note this covers the import.meta.url branch; the jiti branch
    is covered by the manual `pi -e` load (Task 3)

Task 3: MANUAL VERIFICATION (record outcomes — these feed README Task 4)
  - a. `pi -e /home/dustin/projects/hapax` → starts clean, no extension errors
  - b. Smoke: send a message containing a distinctive word (e.g.
    "quokkatestword"), then type `quok` in the input → hapax suggestion popup
  - c. `mv dict/common-en.bin /tmp/hapax-dict.bak`; restart pi -e; send a
    message → exactly ONE error notify, pi otherwise normal;
    `mv /tmp/hapax-dict.bak dict/common-en.bin` (MUST restore)
  - d. (Optional) `ln -s /home/dustin/projects/hapax ~/.pi/agent/extensions/hapax`
    → plain `pi` auto-loads it; remove the symlink if not wanted permanently

Task 4: MODIFY README.md — add "## Development" section
  - CONTENT: dev loop (`pi -e /home/dustin/projects/hapax`, edit → restart);
    jiti note (no build step; dual __dirname/import.meta.url pattern in
    src/pi/paths.ts and why); global symlink option; project-local
    .pi/extensions/ trust caveat; missing-dict graceful-disable behavior;
    verification commands (`npm run check`, `npm test`)
  - PLACEMENT: after existing dictionary-build content, before any trailing
    sections; keep existing sections intact

Task 5: VALIDATE
  - npm run check && npm test — both green
```

### Implementation Patterns & Key Details

```ts
// PATTERN: ambient declaration keeps tsc strict happy under type:module
declare const __dirname: string | undefined;
// PATTERN: all relative imports in src/ use the `.js` extension (ESM style,
// jiti resolves it) — check existing src/pi/*.ts imports and match.
```

### Integration Points

```yaml
MANIFEST: none — package.json pi manifest is already correct; verify only.
CONFIG: none — config is loaded by S1's factory; path resolution takes no config.
ROUTES: none.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit (strict). Must be clean.
```

### Level 2: Unit Tests

```bash
npm test        # vitest --run; includes new test/paths.test.ts
```

### Level 3: Integration (manual — the core of this task)

```bash
pi -e /home/dustin/projects/hapax   # expect: clean start, no errors
# smoke: type a distinctive word in a message, then its prefix in input box
mv dict/common-en.bin /tmp/hapax-dict.bak
pi -e /home/dustin/projects/hapax   # send a message → one error notify only
mv /tmp/hapax-dict.bak dict/common-en.bin   # RESTORE — never leave repo broken
```

### Level 4: Domain-Specific

- The jiti/CJS branch is validated by the real `pi -e` load itself
  (Task 3a) — no other way to exercise it.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean; `npm test` green
- [ ] `resolveDictPath` uses the dual pattern verbatim; no new dependencies
- [ ] dict/common-en.bin restored (git status clean w.r.t. dict/)

### Feature Validation

- [ ] `pi -e` load verified error-free; smoke suggestion observed
- [ ] Missing-dict graceful disable verified (one notify, pi unaffected)
- [ ] README "Development" section present with dev loop, jiti note, symlink option

### Code Quality

- [ ] Export name/signature unchanged from S1's contract
- [ ] Matches existing ESM `.js`-suffix import convention

## Anti-Patterns to Avoid

- ❌ Do not "simplify" to `import.meta.url` only — jiti will break it
- ❌ Do not modify package.json manifest (it is correct)
- ❌ Do not leave dict/common-en.bin renamed after the disable test
- ❌ Do not add a path-resolution npm dependency
- ❌ Do not duplicate S1's factory work — only the seam is yours