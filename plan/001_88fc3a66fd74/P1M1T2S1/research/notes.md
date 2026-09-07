# Research — P1.M1.T2.S1 Loader + FNV-1a lookup

## Codebase state
- Scaffold exists (P1.M1.T1.S1): package.json (type:module, scripts check/test/bench),
  tsconfig (strict, NodeNext, noEmit, includes src/** + test/**), vitest --run, test/ glob.
- P1.M1.T1.S2 (parallel) defines `src/core/types.ts` exporting
  `interface Dictionary { lookup(word: string): number | null; readonly version: number; readonly entryCount: number; }`
  among other types. This task CONSUMES that type via `import type { Dictionary } from "./types.js"`.

## Key technical findings

### Alignment trap (most important gotcha)
`Uint32Array(buffer, byteOffset)` THROWS if `byteOffset % 4 !== 0`. The HAPX format
places `offsets` at `24 + blobLen` and `buckets` after `scores` — both offsets are
arbitrary mod 4 (blobLen and entryCount are not constrained to multiples of 4).
Additionally, Node `fs.readFileSync` Buffers are *usually* pool-unaligned-zero but this
is NOT guaranteed. Solution used in the PRP:
- read header via DataView (explicit littleEndian=true),
- check section alignment relative to `buf.byteOffset`; if any u32 section is
  misaligned, copy that section once into a fresh Uint32Array at LOAD time
  (O(1) allocations at load, zero during lookup — satisfies the "no per-entry
  allocation" and "no allocation in lookup" contracts).

### FNV-1a 32-bit
offset basis 2166136261, prime 16777619; `hash = (hash ^ byte) * prime >>> 0`
(the `>>> 0` keeps it u32 in JS since `*` promotes to float64). XOR with seed
after the loop, mask with `bucketCount - 1`. Reference:
https://en.wikipedia.org/wiki/FNV-1a (32-bit parameters section).

### Lookup allocation freedom
- Module-level `const SCRATCH = new Uint8Array(64)` + shared `TextEncoder`
  (module singleton, created once).
- `word.length > 64` → return null before encoding (words are byte-limited to 64).
  Note: 64 ASCII chars ≈ 64 bytes; multi-byte chars encode longer —
  `encoder.encodeInto(word, SCRATCH)` returns `{written}`; if written > 64... can't
  happen because string length ≤64 but check anyway via encodeInto result and bail
  to null on overflow.
- Byte compare: loop over SCRATCH[0..len) vs blob[off+i] — no `Buffer.compare` on
  slice (slicing allocates).

### Consumers
- score.ts admission (P1.M2.T3.S1): calls `dict.lookup(key)`.
- extension (P1.M3.T5.S1): lazy-loads, disables on throw.
- Tests come in P1.M1.T2.S2 (independent binary-writer helper) — this task ships
  the module only; a minimal inline-fixture smoke test is acceptable but the full
  suite is the sibling task's deliverable.