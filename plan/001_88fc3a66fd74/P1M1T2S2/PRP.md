# PRP — P1.M1.T2.S2: test/dictionary.test.ts + independent binary-writer test helper

---

## Goal

**Feature Goal**: Create the dictionary test infrastructure per PRD §09:
an **independent** in-memory HAPX binary writer (`test/helpers/dict-writer.ts`)
that re-implements the format from the spec without importing any loader
code — thereby double-checking the format by cross-reading — plus
`test/dictionary.test.ts` covering round-trip, miss, corruption, truncation,
and version-mismatch cases against the loader from P1.M1.T2.S1.

**Deliverable**:
- `test/helpers/dict-writer.ts` exporting
  `buildDictBinary(entries: Array<{ word: string; quant: number }>): Buffer`
- `test/dictionary.test.ts` implementing the PRD §09 dictionary test bullets.

**Success Definition**: `npm test` and `npm run check` exit 0 with all new
tests passing; `buildDictBinary` is the single reusable fixture generator for
all later test suites (score, store, integration acceptance, benchmarks).

## Why

- The loader (P1.M1.T2.S1, landing in parallel) has no verification suite yet;
  PRD §09 explicitly requires these tests.
- An **independent** writer (no shared code with the loader) is a deliberate
  cross-check: if both independently produce/consume the same bytes, the
  format implementation is validated against the spec twice.
- Every downstream module (score admission bands, store, acceptance tests,
  the P1.M4.T1.S2 benchmark synthetic dictionary) needs quant fixtures —
  `buildDictBinary` is the one generator they all reuse. **Never hand-craft
  HAPX binaries anywhere else in the repo.**

## What

`test/helpers/dict-writer.ts`:
- Pure function `buildDictBinary(entries)` → a complete, valid HAPX v1 `Buffer`:
  header (magic `HAPX`, version 1, flags bit 0 set, entryCount, blobLen,
  bucketCount = next power of two ≥ 1.3 × entryCount, seed 0), lexicographically
  sorted word blob, `u32[entryCount+1]` offsets, `u8[entryCount]` scores,
  FNV-1a-built `u32[bucketCount]` buckets (value = entry index + 1, linear
  probing on collision).
- Optional convenience export `writeDictFile(path, entries): string` (writes
  via `fs.writeFileSync`, returns path) for temp-file tests.

`test/dictionary.test.ts` (per PRD §09, no mocks — pure `node:fs`):
- Round-trip: 10 words, write to a temp dir (`fs.mkdtempSync`), `loadDictionary`,
  assert `lookup(w) === quant` for every entry; absent word → `null`.
- Corrupt magic → `loadDictionary` throws.
- Truncated file → `loadDictionary` throws.
- Version mismatch (patch u16 at offset 4 to 2) → throws.
- Optional allocation smoke test guarded by env flag (see blueprint), skipped
  by default.

### Success Criteria

- [ ] `buildDictBinary` produces buffers that S1's `loadDictionary` accepts
- [ ] All 5 test scenarios above pass; `lookup` of every inserted word returns
      its exact quant; absent → `null`
- [ ] `npm test` → 0 failures; `npm run check` → 0 errors
- [ ] Helper imports NOTHING from `src/core/dictionary.ts` (independence)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this
successfully?" — Yes: the complete binary format, hash algorithm, loader
throw-behavior, and existing test conventions are all reproduced below.

### Documentation & References

```yaml
- file: src/core/dictionary.ts  (P1.M1.T2.S1 — CONTRACT, assume exact)
  why: the system under test. Exports `loadDictionary(path): Dictionary` and
        `DICT_VERSION = 1`. Throws on bad magic, version ≠ 1, truncation.
        lookup(word) → quant 0–255 | null (null for absent and for words
        whose UTF-8 encoding exceeds 64 bytes).
  gotcha: DO NOT import FNV-1a or any builder logic from it — the writer
          must be independent (that's the point of this task).

- file: src/core/types.ts
  why: `interface Dictionary { lookup(word): number | null; readonly
        version: number; readonly entryCount: number; }` — import type-only
        with `.js` extension if needed.

- file: test/types.test.ts
  why: existing test style — vitest `describe/it/expect`, flat `test/` dir.

- file: plan/001_88fc3a66fd74/P1M1T2S2/research/notes.md
  why: this task's research: verified codebase facts, writer design, gotchas.

- url: https://en.wikipedia.org/wiki/FNV-1a#FNV-1a_hash
  why: exact 32-bit parameters: offset basis 2166136261 (0x811c9dc5),
        prime 16777619 (0x01000193).
  critical: use `Math.imul(h ^ byte, 0x01000193)` — plain `*` loses u32
        semantics via float64 promotion.
```

### Current Codebase tree (relevant)

```bash
test/
├── smoke.test.ts     # trivial, keep passing
└── types.test.ts     # type-contract suite (style reference)
src/core/
├── types.ts          # Dictionary interface (exists)
└── dictionary.ts     # loader (arriving from P1.M1.T2.S1)
```

### Desired Codebase tree

```bash
test/
├── helpers/
│   └── dict-writer.ts        # NEW — independent binary writer + writeDictFile
├── dictionary.test.ts        # NEW — PRD §09 dictionary suite
├── smoke.test.ts
└── types.test.ts
```

(`test/helpers/` is not matched by vitest's default `*.test.ts` include, so
the helper runs only when imported; tsconfig already type-checks it via
`test/**/*.ts`.)

### Known Gotchas of our codebase & Library Quirks

```ts
// NodeNext ESM: relative imports MUST use ".js" even in .ts files:
//   import { buildDictBinary } from "./helpers/dict-writer.js";
//   import { loadDictionary } from "../src/core/dictionary.js";

// CRITICAL: all multi-byte header fields are LITTLE-ENDIAN.
// Simplest: Buffer#writeUInt32LE / writeUInt16LE / writeUInt8 — no DataView needed.

// GOTCHA: offsets has entryCount + 1 entries; terminal = blobLen.

// GOTCHA: bucketCount must be a power of two even for tiny tables
//   (N=10 → ceil pow2 of 13 → 16). Loader masks with bucketCount - 1.

// GOTCHA: sort entries lexicographically BEFORE building blob/offsets/scores.

// GOTCHA: the writer duplicates FNV-1a + probing logic that also appears in
//   src/core/dictionary.ts and will appear in tools/build-dict.mjs
//   (P1.M1.T3). This triplication is INTENTIONAL and must be documented in
//   the helper's header comment: independent implementations cross-check the
//   format; do not "DRY them up" into a shared module.

// GOTCHA: temp dirs — always fs.mkdtempSync(os.tmpdir() + "/hapax-test-")
//   and clean up with fs.rmSync(dir, { recursive: true, force: true }) in
//   afterEach/afterAll so CI never accumulates files.
```

## Implementation Blueprint

### HAPX v1 format (writer must emit exactly this; PRD §03)

```
0   4  magic "HAPX" (0x48 0x41 0x50 0x58)
4   2  version u16 = 1
6   2  flags u16 = 1 (bit 0: keys are lowercase)
8   4  entryCount u32
12  4  blobLen u32
16  4  bucketCount u32 (power of two, ≥ 1.3 × entryCount)
20  4  seed u32 = 0
24     wordBlob (blobLen bytes, concatenated UTF-8 words)
24+blobLen                    offsets: u32[entryCount+1] (relative to blob start)
24+blobLen+4*(entryCount+1)   scores:  u8[entryCount]
after scores                 buckets: u32[bucketCount]; value = idx+1; 0 = empty
```

### Implementation Tasks (ordered)

```yaml
Task 1: CREATE test/helpers/dict-writer.ts
  - HEADER COMMENT: purpose (independent cross-check writer + fixture
    generator); note that tools/build-dict.mjs duplicates this logic
    intentionally; do not share code with the loader.
  - IMPLEMENT fnv1a(word: string, seed: number): number
    (local FNV-1a 32-bit via TextEncoder + Math.imul; XOR-fold with seed at
    the end: `(h ^ seed) >>> 0`).
  - IMPLEMENT buildDictBinary(entries): Buffer
    Steps:
      a. copy + sort entries lexicographically by word.
      b. build wordBlob via Buffer.concat of Buffer.from(word, "utf8");
         compute blobLen; build offsets (entryCount+1 cumulative u32).
      c. bucketCount: loop `let bc = 1; while (bc < entryCount * 1.3) bc *= 2;`
         (min 1; also guard entryCount === 0 → bc = 1).
      d. total = 24 + blobLen + 4*(entryCount+1) + entryCount + 4*bc;
         Buffer.alloc(total).
      e. write header with writeUInt32LE/writeUInt16LE; copy blob; write
         offsets LE; write scores; then insert buckets:
           for i in entries: slot = fnv1a(word, 0) & (bc - 1);
           while (buckets[slot] !== 0) slot = (slot + 1) & (bc - 1);
           buckets[slot] = i + 1;
         write buckets LE. Return buffer.
  - IMPLEMENT writeDictFile(path: string, entries): string
    (fs.writeFileSync(path, buildDictBinary(entries)); return path).
  - NAMING: exported camelCase functions; no default export.
  - NO imports from src/core/dictionary.ts (assert independence).

Task 2: CREATE test/dictionary.test.ts
  - IMPORTS: vitest describe/it/expect/beforeEach/afterEach;
    node:fs (mkdtempSync, writeFileSync, readFileSync, rmSync), node:os, node:path;
    loadDictionary from "../src/core/dictionary.js";
    buildDictBinary / writeDictFile from "./helpers/dict-writer.js".
  - FIXTURE (module scope): 10 words with distinct quants, e.g.
    ["the"→255, "and"→240, "for"→200, "code"→150, "hapax"→120, "nrel"→80,
     "lwlock"→60, "zendesk"→40, "f3a9c2e"→20, "zzzz"→1].
  - TEST "round-trips every entry via temp file":
      dir = mkdtempSync(join(tmpdir(), "hapax-dict-"));
      path = writeDictFile(join(dir, "d.bin"), ENTRIES);
      const dict = loadDictionary(path);
      for each entry expect(dict.lookup(e.word)).toBe(e.quant);
      expect(dict.lookup("qqqqqqqq")).toBeNull();
      expect(dict.entryCount).toBe(10); expect(dict.version).toBe(1);
    afterEach: rmSync(dir, { recursive: true, force: true }).
  - TEST "corrupt magic throws":
      buf = Buffer.from(buildDictBinary(ENTRIES)); buf[0] = 0x58;
      write to temp; expect(() => loadDictionary(p)).toThrow().
  - TEST "truncated file throws":
      write buildDictBinary(ENTRIES).subarray(0, 30) to temp; expect throw.
      Also a header-only variant (24 bytes) if the loader treats it specially.
  - TEST "version mismatch throws":
      buf = copy; buf.writeUInt16LE(2, 4); write; expect(() => loadDictionary(p)).toThrow().
  - TEST "miss and over-length word": lookup(absent) === null;
      lookup("x".repeat(65)) === null (64-byte UTF-8 limit per PRD §03).
  - TEST (optional, PRD §09 "no allocation" smoke) guarded:
      it.skipIf(process.env.HAPAX_TEST_GC !== "1" || !globalThis.gc)
      — run with `node --expose-gc`; take heap snapshot before/after 10k
      lookups, assert delta negligible. Keep simple: assert lookups still
      correct after forcing gc; document the runner command in a comment:
      `HAPAX_TEST_GC=1 npx vitest --run test/dictionary.test.ts`
      executed via `node --expose-gc node_modules/vitest/vitest.mjs --run ...`.
  - NO MOCKS: pure fs, real files.

Task 3: VERIFY independence & reuse
  - grep test/helpers/dict-writer.ts for "dictionary.js" — must be absent.
  - Confirm downstream note: score/store/acceptance/benchmark tests (M2/M4)
    import buildDictBinary from "../test/helpers/dict-writer.js" (or relative
    from test/ suites: "./helpers/dict-writer.js"). Nothing else in the repo
    hand-crafts binaries.
```

### Implementation Patterns & Key Details

```ts
// Independent FNV-1a (writer-local; do NOT import from the loader):
const encoder = new TextEncoder();
export function fnv1a(word: string, seed: number): number {
  const bytes = encoder.encode(word);            // writer path MAY allocate (tests only)
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h ^ seed) >>> 0;
}

// Bucket sizing (power of two, ≥ 1.3 × N):
function nextPow2(min: number): number {
  let n = 1;
  while (n < min) n *= 2;
  return n;
}
const bucketCount = nextPow2(Math.ceil(entryCount * 1.3));

// Little-endian header writes:
buf.write("HAPX", 0, "ascii");
buf.writeUInt16LE(1, 4);            // version
buf.writeUInt16LE(1, 6);            // flags: bit 0 set
buf.writeUInt32LE(entryCount, 8);
buf.writeUInt32LE(blobLen, 12);
buf.writeUInt32LE(bucketCount, 16);
buf.writeUInt32LE(0, 20);           // seed

// Temp-dir pattern:
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hapax-dict-"));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
```

### Integration Points

```yaml
SUT:
  - src/core/dictionary.ts (P1.M1.T2.S1) — loadDictionary / DICT_VERSION
DOWNSTREAM REUSE (do not implement, but design for):
  - score/store/acceptance tests (P1.M2.*, P1.M4.T1.S1): quant fixtures via
    buildDictBinary (e.g. quant 250/150/80 words for admission bands)
  - benchmark synthetic dictionary (P1.M4.T1.S2): buildDictBinary with
    generated entries (may need an optional maxSize-aware usage — the
    helper is O(n) memory; fine for ≤ ~70k test entries)
  - tools/build-dict.mjs (P1.M1.T3) duplicates the writer — intentional,
    documented in both places
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check     # tsc --noEmit — helper + test must type-check (NodeNext: .js imports)
npm test          # vitest --run — all suites green
```

### Level 2: Targeted test run

```bash
npx vitest --run test/dictionary.test.ts   # all new cases pass
```

### Level 3: Independence + reuse audit

```bash
grep -n "dictionary.js" test/helpers/dict-writer.ts   # expect: no matches
grep -rn "HAPX" src test --include="*.ts" | grep -v dictionary.ts | grep -v dict-writer.ts
# expect: no other file hand-crafts the magic
```

### Level 4: Optional GC smoke (manual)

```bash
HAPAX_TEST_GC=1 node --expose-gc node_modules/vitest/vitest.mjs --run test/dictionary.test.ts
```

## Final Validation Checklist

- [ ] `npm run check` → 0 errors; `npm test` → 0 failures
- [ ] Round-trip: 10 words, every `lookup(w) === quant`; absent → `null`;
      over-length word → `null`
- [ ] Bad magic, truncated, version-mismatch files each make `loadDictionary` throw
- [ ] `buildDictBinary` exports correct header (bucketCount power of two ≥ 1.3×N,
      flags bit 0, seed 0) and FNV-1a buckets with linear probing
- [ ] Helper is independent — zero imports from `src/core/dictionary.ts`
- [ ] Temp files cleaned up (`rmSync` in afterEach)
- [ ] Helper header comment documents the intentional duplication with
      `tools/build-dict.mjs` and its role as THE fixture generator
- [ ] No mocks; tests use real fs writes/reads
- [ ] Existing `smoke.test.ts` / `types.test.ts` still pass

## Anti-Patterns to Avoid

- ❌ Importing FNV-1a or format constants from the loader (defeats the
  cross-check purpose)
- ❌ "DRYing up" writer/loader/build-script duplication — it is intentional
- ❌ Hand-crafting binary fixtures with byte literals in other test files
- ❌ Forgetting `.js` extensions on relative imports (NodeNext)
- ❌ Big-endian writes (default DataView reads are BE; use writeUInt32LE)
- ❌ Leaving temp files behind on failure (use afterEach, not only happy-path cleanup)
- ❌ Skipping the empty-table edge case (entryCount 0 → bucketCount 1, no entries)

---

**Confidence Score: 9/10** — the format, hash, loader contract, test
conventions, and fixture-generation role are fully specified; the loader
itself lands in parallel but its PRP is treated as an exact contract, and any
divergence surfaces immediately as a test failure (which is precisely the
point of the independent writer).