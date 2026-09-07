# PRP — P1.M1.T2.S1: Loader + FNV-1a lookup, zero per-entry allocation

---

## Goal

**Feature Goal**: Implement `src/core/dictionary.ts` — the HAPX packed-binary
dictionary loader per PRD §03: one `fs.readFileSync`, header validation
(magic `HAPX`, version exact-match 1), typed-array views over the backing
Buffer, and an allocation-free `lookup()` using FNV-1a 32-bit + linear probing
into a pre-built bucket table.

**Deliverable**: `src/core/dictionary.ts` exporting
`loadDictionary(path: string): Dictionary` and `const DICT_VERSION = 1`.
JSDoc on both explaining the file format offsets. No test suite (that is
sibling P1.M1.T2.S2), though a minimal smoke test is acceptable.

**Success Definition**: `npm run check` exits 0; a hand-built minimal HAPX
binary (can be built in ~10 lines in a scratch node script) loads and returns
correct scores / `null`; `lookup()` performs zero heap allocations after load
(verifiable by inspection: no string→Buffer conversions, no slicing, no
object creation on the lookup path).

## Why

- The dictionary is the **only** source of commonness evidence in the entire
  pipeline (PRD §03). Every admission decision (P1.M2.T3.S1 score.ts) and the
  lazy extension load (P1.M3.T5.S1) go through `Dictionary.lookup`.
- PRD design invariants require the query/ingest hot path to be allocation-
  free per lookup — a sloppy loader (per-lookup string encode + slice compare)
  would blow the performance budget (§02) at 70k-entry scale.
- Runtime is Node: `fs`, `Buffer`, `TextEncoder`, typed arrays all available.
  `src/core/**` must import nothing from pi packages — only `node:fs`,
  `./types.js` (type-only), and global `TextEncoder`.

## What

Create `src/core/dictionary.ts`:

```ts
import { readFileSync } from "node:fs";
import type { Dictionary } from "./types.js";

export const DICT_VERSION = 1;

export function loadDictionary(path: string): Dictionary { ... }
```

The returned object closes over the single backing `Buffer` and typed-array
views; `lookup(word: string): number | null` returns the u8 quantized score
(0–255) on hit, `null` on miss or over-length word. Invalid magic/version
throws (extension disables itself — that wiring is P1.M3.T5.S1, not here).

### Success Criteria

- [ ] `loadDictionary` throws on bad magic, bad version (any value ≠ 1), and
      truncated files (sections beyond file length)
- [ ] `lookup` returns correct score for present words, `null` for absent,
      `null` for words whose UTF-8 encoding exceeds 64 bytes (checked BEFORE
      encoding where possible)
- [ ] Zero allocations inside `lookup` (module-level scratch + shared
      `TextEncoder`; byte-loop compare, no `subarray`/`slice` on hot path)
- [ ] `npm run check` → exit 0; existing `npm test` still exits 0

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed?" — Yes: the complete binary format, hash function, and loader
algorithm are reproduced below; the `Dictionary` interface is defined in
`src/core/types.ts` (P1.M1.T1.S2, parallel — treat as existing contract).

### Documentation & References

```yaml
- file: src/core/types.ts  (from P1.M1.T1.S2 — CONTRACT, assume exact)
  why: exports `interface Dictionary { lookup(word: string): number | null;
        readonly version: number; readonly entryCount: number; }`
  pattern: import with `import type { Dictionary } from "./types.js"`
  gotcha: NodeNext resolution REQUIRES the `.js` extension in the relative
          import specifier even though the source file is `.ts`.

- file: plan/001_88fc3a66fd74/architecture/core_contracts.md
  why: Dictionary is the ONLY touchpoint for commonness; quantized 0–255,
        null = absent. Admission bands (220/120) live in score.ts, NOT here.

- url: https://en.wikipedia.org/wiki/FNV-1a#FNV-1a_hash
  why: exact 32-bit parameters — offset basis 2166136261, prime 16777619.
  critical: in JS, `hash = Math.imul(hash ^ byte, 16777619) >>> 0` — plain
        `*` promotes to float64 and loses u32 semantics; use Math.imul.

- file: plan/001_88fc3a66fd74/P1M1T2S1/research/notes.md
  why: alignment trap analysis and lookup-allocation strategy (this PRP's
        research; read alongside).
```

### Current Codebase tree (relevant part)

```bash
src/core/          # types.ts arriving from P1.M1.T1.S2 (parallel)
src/pi/index.ts    # stub
test/smoke.test.ts # exists, must keep passing
```

### Desired Codebase tree with files to be added

```bash
src/core/
└── dictionary.ts   # THIS TASK
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: Uint32Array(buffer, offset) THROWS when offset % 4 !== 0.
// The HAPX layout puts `offsets` at 24+blobLen and `buckets` at
// 24+blobLen+4*(entryCount+1)+entryCount — both arbitrary mod 4. Also,
// Node Buffer.byteOffset relative to its ArrayBuffer is not guaranteed 0.
// SOLUTION: compute each section's absolute byte offset
//   (buf.byteOffset + sectionOffset); if 4-aligned → create a zero-copy
//   Uint32Array view; if not → copy that section ONCE into a new
//   Uint32Array at load time. Load-time copies are fine (the contract
//   forbids PER-ENTRY and PER-LOOKUP allocation, not load-time).

// CRITICAL: DataView multi-byte reads need explicit littleEndian=true:
//   dv.getUint32(off, true). Header fields are all little-endian (PRD §03).

// GOTCHA: `word.length > 64` (UTF-16 code units) is a cheap pre-reject;
// multi-byte chars can still exceed 64 bytes — use encodeInto's
// {written} and treat overflow as a miss (return null), never throw.

// GOTCHA: TextEncoder must be a module singleton:
//   const encoder = new TextEncoder(); const SCRATCH = new Uint8Array(64);
// Module-level state is safe: lookup is synchronous (single-threaded JS).
```

## Implementation Blueprint

### File format (PRD §03, exact — reproduce in JSDoc)

```
0   4  magic "HAPX" (bytes 0x48 0x41 0x50 0x58)
4   2  version u16 = 1
6   2  flags u16 (bit 0 = lowercase keys; loader reads, does not enforce)
8   4  entryCount u32
12  4  blobLen u32
16  4  bucketCount u32 (power of two)
20  4  seed u32 (currently 0)
24     wordBlob: blobLen bytes
24+blobLen                    offsets: u32[entryCount+1]
24+blobLen+4*(entryCount+1)   scores:  u8[entryCount]
24+blobLen+4*(entryCount+1)+entryCount  buckets: u32[bucketCount]
                              bucket value = entryIndex+1; 0 = empty
```

### Implementation Tasks (ordered)

```yaml
Task 1: CREATE src/core/dictionary.ts — module skeleton
  - IMPORTS: `import { readFileSync } from "node:fs";`
             `import type { Dictionary } from "./types.js";`
  - EXPORT: `export const DICT_VERSION = 1;`
  - DECLARE module singletons: TextEncoder + SCRATCH: Uint8Array(64)
  - JSDoc header comment reproducing the format table above.

Task 2: loadDictionary(path)
  - `const buf = readFileSync(path);` — single read, retained for object lifetime
  - Guard: file < 24 bytes → throw Error("hapax dictionary: truncated header")
  - Parse header via DataView over buf.buffer at buf.byteOffset,
    littleEndian=true for every getUint16/getUint32.
  - Validate magic bytes buf[0..3] === 0x48,0x41,0x50,0x58 → else throw
    ("bad magic"); validate version === DICT_VERSION exactly → else throw
    (include found version in message).
  - Compute section offsets; verify each section END ≤ buf.length →
    else throw ("truncated").
  - Build views:
      blob:   new Uint8Array(buf.buffer, buf.byteOffset+24, blobLen)
      offsets/buckets: per alignment rule (zero-copy view when
        (buf.byteOffset+sectionOff) % 4 === 0, else copy once)
      scores: new Uint8Array(buf.buffer, buf.byteOffset+scoresOff, entryCount)
  - Return object literal implementing Dictionary:
      { lookup, version: parsedVersion, entryCount } — lookup defined as a
      closure capturing views, seed, bucketCount, entryCount.

Task 3: lookup(word: string): number | null
  - `if (word.length > 64) return null;`
  - `const { written } = encoder.encodeInto(word, SCRATCH);`
    (encodeInto never overflows a 64-byte buffer given length ≤64? NO —
    multi-byte chars can overflow → if written === SCRATCH.length AND
    the 64th byte is a truncated code point, or simply: if encoding
    overflowed (written hit 64 with input remaining), return null.
    Simplest robust rule: if written === 64 && word.length > 64 check
    already passed, still verify byte length: treat written===64 &&
    SCRATCH[63] is a UTF-8 continuation byte (0b10xxxxxx) as overflow →
    return null.)
  - FNV-1a: `let h = 0x811c9dc5; for (i<written) h = Math.imul(h ^ SCRATCH[i], 0x01000193) >>> 0;`
    Hmm — Math.imul already returns int32; `>>> 0` after the final seed XOR
    for a clean u32. Then `h = (h ^ seed) >>> 0; let slot = h & (bucketCount - 1);`
  - Probe loop (unbounded-safe: table has empty slots):
      const v = buckets[slot];
      if (v === 0) return null;
      const i = v - 1;
      const len = offsets[i+1] - offsets[i];
      if (len === written) {
        // byte compare, no allocation
        let eq = true;
        for (let k = 0; k < len; k++)
          if (blob[offsets[i] + k] !== SCRATCH[k]) { eq = false; break; }
        if (eq) return scores[i];
      }
      slot = (slot + 1) & (bucketCount - 1);
  - No object/array/string creation anywhere in this path.

Task 4: JSDoc
  - On loadDictionary: format offset table + validation/throw behavior +
    alignment-copy note.
  - On lookup: FNV-1a + linear probe explanation, 64-byte limit,
    allocation-free contract.

Task 5 (optional): test/dictionary.test.ts smoke
  - Build a tiny valid binary inline (writeHeader + few entries +
    hand-inserted buckets using the SAME hash — reuse FNV-1a code copied
    into the test) and assert lookups. NOTE: the full test suite with the
    independent binary-writer helper is P1.M1.T2.S2 — do NOT build that
    infrastructure here; keep this to a minimal inline fixture or skip
    entirely (verification can be a throwaway node script, not committed).
```

### Implementation Patterns & Key Details

```ts
// Correct FNV-1a (float64 trap avoided):
let h = 0x811c9dc5;
for (let i = 0; i < written; i++) h = Math.imul(h ^ SCRATCH[i], 0x01000193);
h = (h ^ seed) >>> 0;
const mask = bucketCount - 1;          // bucketCount is a power of two
let slot = h & mask;

// Alignment-safe u32 view helper (load-time only):
function u32View(buf: Buffer, off: number, count: number): Uint32Array {
  const abs = buf.byteOffset + off;
  if (abs % 4 === 0) return new Uint32Array(buf.buffer, abs, count);
  const out = new Uint32Array(count);           // one-time copy fallback
  const dv = new DataView(buf.buffer, abs, count * 4);
  for (let i = 0; i < count; i++) out[i] = dv.getUint32(i * 4, true);
  return out;
}
// GOTCHA: DataView(buf.buffer, abs, ...) requires abs ≤ buf.buffer.byteLength;
// abs always valid because off+count*4 ≤ buf.length was verified first.
```

### Integration Points

```yaml
TYPES:
  - consumes: src/core/types.ts `Dictionary` (P1.M1.T1.S2, parallel — if not
    yet merged, the interface is exactly:
      { lookup(word: string): number | null; readonly version: number; readonly entryCount: number; }
    Do not redefine/export the interface from dictionary.ts; import it.)

DOWNSTREAM (do not implement here):
  - score.ts (P1.M2.T3.S1) calls dict.lookup(key) for admission bands 220/120
  - extension (P1.M3.T5.S1) lazy-loads; catches loader throw → notify + disable
  - build-dict.mjs (P1.M1.T3.S1) emits this exact format; the JSDoc here is
    the format's in-repo documentation
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check        # tsc --noEmit — must exit 0
npm test             # vitest --run — existing smoke test still passes
```

### Level 2: Functional round-trip (throwaway script — do not commit)

```bash
cat > /tmp/hapx-roundtrip.mjs <<'EOF'
// Build a minimal valid HAPX file with 3 entries, then load via tsx/ts-node
// or compile check the logic inline. Entries: "the"=255, "hapax"=10, "zzz"=1.
// Assert: lookup("the")===255, lookup("hapax")===10, lookup("missing")===null,
// lookup("a".repeat(65))===null, bad-magic file throws, version=2 throws.
EOF
node --experimental-strip-types -e '...' # or tsx if available; alternative:
# minimal vitest test committed as test/dictionary.test.ts (allowed)
```

Recommended: commit a small `test/dictionary.test.ts` with an inline fixture
builder (self-contained, no shared helper) — the S2 task will supersede it
with the independent binary-writer suite.

### Level 3: Allocation audit (inspection)

- [ ] grep the lookup path: no `.slice(`, `.subarray(`, `.toString(`,
      `String.fromCharCode`, array literals, or object literals inside
      `lookup` or the probe loop
- [ ] `TextEncoder` and `SCRATCH` are module-level, created once

## Final Validation Checklist

- [ ] `npm run check` → 0 errors
- [ ] `npm test` → 0 failures
- [ ] `loadDictionary` throws on: bad magic, version ≠ 1, truncated file
- [ ] `lookup` correct on hit/miss/over-length; collision probe verified
      (fixture with two words hashing to the same slot — force via seed 0
      small bucketCount in fixture)
- [ ] Zero-allocation lookup (Level 3 audit)
- [ ] `DICT_VERSION = 1` exported and used in the version check
- [ ] Only imports: `node:fs`, type-only `./types.js`; nothing from pi packages
- [ ] JSDoc documents format offsets on both exports

## Anti-Patterns to Avoid

- ❌ Re-exporting or redefining the `Dictionary` interface locally
- ❌ `hash * prime` without `Math.imul` (float64 corruption at large hashes)
- ❌ `new Uint32Array(buffer, unalignedOffset, n)` without alignment check
  (throws at load on ~3/4 of real files)
- ❌ Forgetting `true` (littleEndian) in DataView reads — header parses
  garbage on big-endian-semantics reads (JS defaults to big-endian!)
- ❌ Using `Buffer` methods inside lookup (implicit allocs); stick to
  typed-array views
- ❌ Slicing blob for comparison — loop bytes against the view
- ❌ Treating `bucketCount` as non-power-of-two (mask requires power of two;
  the builder guarantees it; loader may optionally assert popcount==1)

---

**Confidence Score: 9/10** — format, hash, alignment pitfalls, and consumer
contracts are fully specified; the only residual uncertainty is fixture
building for collision testing, which is delegated to (and optional here in
favor of) P1.M1.T2.S2.