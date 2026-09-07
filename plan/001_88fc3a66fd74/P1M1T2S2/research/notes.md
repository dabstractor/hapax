# Research notes — P1.M1.T2.S2 (dictionary tests + independent binary-writer helper)

## What S1 provides (contract, assume exact)
- `src/core/dictionary.ts`: `loadDictionary(path): Dictionary`, `DICT_VERSION = 1`.
- Throws on: bad magic (`HAPX`), version ≠ 1, truncated header/sections.
- `lookup` returns quant 0–255, `null` on miss / word whose UTF-8 > 64 bytes.

## Codebase facts (verified)
- Vitest 4, `npm test` = `vitest --run`; tests in `test/*.test.ts` (flat dir, no
  subdirs today). NodeNext ESM — relative imports need `.js` extension.
- Existing suites: `test/smoke.test.ts`, `test/types.test.ts` — style: plain
  `describe/it/expect` from `vitest`, single quotes used in types.test.ts.
- tsconfig includes `test/**/*.ts` → helper `test/helpers/dict-writer.ts` is
  type-checked by `npm run check`. `test/helpers/` is NOT matched by vitest's
  default include (`*.test.ts`), so no false test file.
- Node builtins fine: `node:fs`, `node:buffer`. `Buffer.alloc` for building.

## Writer design (independent of loader — cross-read guarantee)
- Do NOT import FNV-1a from `src/core/dictionary.ts` (even if it were exported).
  Re-implement FNV-1a 32-bit inside the helper: offset basis 2166136261
  (0x811c9dc5), prime 16777619 (0x01000193), `Math.imul(h ^ b, prime)`.
- Format per PRD §03: header 24 bytes, little-endian; bucketCount = next pow2
  ≥ 1.3 × N; buckets value = entryIndex+1, 0 = empty; insertion with linear
  probing identical to loader semantics.
- The build script tools/build-dict.mjs (P1.M1.T3) intentionally duplicates
  this writer logic — documented as deliberate cross-check duplication.
- `buildDictBinary(entries: Array<{word; quant}>): Buffer` is THE fixture
  generator for score/store/acceptance tests + benchmark dictionary
  (P1.M4.T1.S2). Export only this (+ maybe a writeDictFile convenience).

## Test cases (PRD §09 h2.49)
- Round-trip 10 words via temp dir (`fs.mkdtempSync(os.tmpdir()+...)`), write
  file, `loadDictionary`, every lookup(w) === quant; absent → null.
- Corrupt magic → load throws (copy buffer, patch byte 0).
- Truncated → throws (subarray of valid buffer).
- Version mismatch → throws (write u16=2 at offset 4).
- Optional no-alloc smoke: `node --expose-gc` + `global.gc?.()` guard via env
  flag `HAPAX_TEST_GC=1`, skip otherwise (vitest `it.skipIf`).

## Gotchas
- Buffer.alloc zero-fills — fine. Use DataView or `buf.writeUInt32LE` for
  little-endian fields (writeUInt32LE is simplest).
- offsets array has entryCount+1 entries (terminal = blobLen).
- Lexicographic sort of entries before writing blob/offsets/scores.
- bucketCount must be power of two even for tiny tables (N=10 → 1.3*10=13 → 16).
- Collision handling in writer probe: same linear probe as loader.