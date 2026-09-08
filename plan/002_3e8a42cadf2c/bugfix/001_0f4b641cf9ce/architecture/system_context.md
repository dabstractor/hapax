# System Context — hapax bugfix 001 (6 validation defects)

Repo: `/home/dustin/projects/hapax`. TypeScript ESM (`"type": "module"`), private, pi extension.
Loaded by pi via `package.json` → `"pi": { "extensions": ["./src/pi/index.ts"] }`.

## Commands (authoritative)
- `npm test` → `vitest --run` (whole suite; no vitest.config — defaults; `tsconfig.json` has `"types": ["vitest/globals"]`)
- `npm run check` → `tsc --noEmit` (strict; the DoD substitute for `pi --check`)
- `npm run bench` → `vitest bench` (test/bench/core.bench.ts, tinybench)
- Single file: `npx vitest --run test/<file>.test.ts`
- Band calibration aid: `node tools/calibrate-bands.mjs` (prints rank↔word↔q table against shipped dict)

## Module map (src/core is PURE — no pi imports, enforced by review; src/pi is the adapter)
```
src/core/: dictionary.ts (187) segment.ts (322) shapeGate.ts (551) score.ts (230) store.ts (632) query.ts (129) types.ts (133)
src/pi/:   index.ts (251) ingest.ts (682) provider.ts (813) config.ts (290) debug.ts (188) paths.ts (45)
dict/common-en.bin  — shipped HAPX v1 packed dictionary (real artifact, used by acceptance suites)
spec/*.md           — PRODUCT SPEC (PRD-equivalent). READ-ONLY for this bugfix: never edit spec/.
docs/M1-DoD.md      — DoD evidence record (re-runnable commands + measured numbers; update as fixes land)
README.md           — features/usage/limitations/reference (changeset-level sweep target)
tools/              — calibrate-bands.mjs and dict build tooling
```

## Provider stack wiring (src/pi/index.ts)
`session_start` → `loadConfig` → `new CandidateStore()` + `createChainMachine()` + lazy `loadDictionary(resolveDictPath())`
→ `new IngestPipeline({ store, dictionary, isDisabled, onAdmittedTokens: runs => store.recordBigramRuns(runs) })`
→ registered via `ctx.ui.addAutocompleteProvider((current) => createDisplayProvider(createHapaxProvider(store, config, current, sessionChain)))`.
So the stack is: **stock pi `current` provider (slash/@/path) ← createHapaxProvider (matching + chain) ← createDisplayProvider (100 ms debounce/hysteresis)**.
`before_agent_start` → `chain.reset()`; `session_shutdown` → dispose + null refs.

## Ingest pipeline (src/pi/ingest.ts)
`processText` → per message one `nextOrdinal()` → 64 KB slices split on `\n` → per segment
`#admitSegment`: `maskSecrets(segment)` → `tokenize(masked)` → per distinct token memoized
`#computeAdmitMemo`: `expandCandidates(token)` (whole draft + `_`/camelCase sub-words ≥4 chars, `isSubword:true, parentKey`) →
per-draft `passesShape(draft)` → gate-passers `admit(draft, dict, wholeGroup?)` → `#replayAdmitMemo` upserts sightings;
whole admitted tokens become run entries (sub-words NEVER in runs). Runs split on non-`[ \t]` gaps (`splitRuns`).
End of message: `onAdmittedTokens(runs)` → `store.recordBigramRuns(runs)` (once per message — relevant to BUG-006).

## Test conventions (must be followed by all fixes)
- Real modules always; never a re-implementation of pipeline logic.
- Real shipped dict via `loadDictionary(resolveDictPath())` in acceptance/calibration/adversarial/shipped-dict suites;
  unit suites use synthetic binaries from `test/helpers/dict-writer.ts` (`buildDictBinary`, independent format writer).
- Band constants are IMPORTED from `src/core/score.ts` (`MID_FREQ_THRESHOLD`, `REJECT_COMMON_THRESHOLD`) — never hard-code.
- Provider tests: `createHapaxProvider(store, cfg(), current)` with `current` a vi-mock returning a `SENTINEL`;
  delegation proven by `toBe(SENTINEL)` identity AND args identity (same lines array, same options object — never cloned).
- `provider.__hapaxLive()` asserts live-cache state; `test/helpers/editor-sim.ts` mirrors pi-tui `applyCompletion`
  deletion math exactly (blind `prefix.length` deletion, no verification — providers must never return a non-suffix prefix).
- One-word invariant helper: `test/helpers/query-invariants.ts` (`assertWordsOnly`).
- Fixtures: `test/fixtures/sessions/` (prose.jsonl, zendesk-lwlock.jsonl, zephyr-chain.jsonl, large-100k.jsonl, expected.md, RESULTS.md).
- Last recorded suite state: 636 tests passing, tsc clean (per bugfix PRD overview).

## Config surface (src/pi/config.ts — unchanged by this bugfix)
`HapaxConfig { triggerChar: "#" (regex /^[^\w\s]$/ or ""), threshold: 2 (1–3), maxSuggestions: 8 (1–20), enableChaining: true, debug: false }`.
Layers: defaults → `~/.pi/agent/hapax.json` → `.pi/hapax.json` (trusted). No env vars.

## Scope guardrails for this bugfix
- **spec/*.md is the product spec (PRD-equivalent): READ-ONLY.** Known drift (spec 04 says bands 220/120; code ships 50/20 after a prior
  retune) is recorded in code JSDoc + docs/M1-DoD.md + README — do not "fix" drift by editing spec.
- docs/M1-DoD.md and README.md are the living docs; per-feature evidence rides with the implementing subtask (Mode A),
  changeset-level summary lands in the final docs task (Mode B).
- `plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/` (this directory) is the research record for downstream PRP agents.

## Bug → subsystem map
| Bug | Root file(s) | Fix locus |
|---|---|---|
| BUG-001 stock-context preemption + Tab opens menu | src/pi/provider.ts (extractMatchState ~110-135, getSuggestions ~345-360) | provider stock-context classifier + delegation |
| BUG-002 M2 phrase admission-rejected | src/core/score.ts (bands 50/20) + shipped dict quantization | proper-noun admission relief + pinned acceptance test |
| BUG-003 secret fragments admitted | src/core/shapeGate.ts (rules 6/7, 40-char bare-run floor) + src/pi/ingest.ts memo (no parent context) | mask floor 32 + parent-secret propagation + battery |
| BUG-004 astral letter leaks ASCII run | src/core/segment.ts isUniLetter (~78-90) | code-point-stepping boundary guard |
| BUG-005 armed chain ignores trigger char | src/pi/provider.ts armed branch (~296-330) | word-start guard → reset + fall-through |
| BUG-006 bigram cap overshoot | src/core/store.ts #evictBigramsIfOverCap (~476-505) | same-call full drain loop |
