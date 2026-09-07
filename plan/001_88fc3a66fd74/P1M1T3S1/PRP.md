# PRP — P1.M1.T3.S1: Merge/filter/sort/quantize/emit pipeline + CLI (`tools/build-dict.mjs`)

---

## Goal

**Feature Goal**: Implement the corpus-agnostic dictionary build pipeline per
PRD §03 "Build pipeline" steps 1–6: a plain `.mjs` Node-stdlib-only CLI that
consumes `word<TAB>count` TSVs, merges/filters/sorts/quantizes them, and emits
a valid HAPX v1 packed binary at `dict/common-en.bin` consumable by
`loadDictionary` (P1.M1.T2.S1).

**Deliverable**: `tools/build-dict.mjs` — runnable as
`node tools/build-dict.mjs --out dict/common-en.bin input1.tsv [input2.tsv ...]`,
exit 0 with a size summary on success; exit non-zero with a clear message on
empty input or TSV parse errors.

**Success Definition**: Given any valid TSV(s), the script writes a file that
`loadDictionary` (from `src/core/dictionary.ts`, P1.M1.T2.S1) accepts and
returns correct quants for every entry. Script uses ONLY node stdlib (`node:fs`,
`node:path`, `node:process`) — no dependencies, no imports from repo TS code.

## Why

- The extension's "is this word common?" oracle needs a shipped binary table;
  this tool is the only producer of it.
- P1.M1.T3.S2 (self-verification pass) and P1.M1.T3.S3 (shipped artifact +
  corpus docs) build directly on this script — this task must leave a clean,
  extensible structure (steps as functions, not one giant main).
- Writer logic is **intentionally duplicated** from
  `test/helpers/dict-writer.ts` (P1.M1.T2.S2) and the loader's hash — three
  independent implementations cross-check the format. Do NOT import TS from
  the `.mjs`; do NOT "DRY up" the duplication.

## What

CLI behavior:
- Args: `--out <path>` (required), one or more input TSV paths (required, else
  exit non-zero with usage message). Reject unknown flags with non-zero exit.
- TSV contract: each line `word<TAB>count`, count a non-negative integer.
  Malformed line (wrong column count, non-numeric count, negative) → exit 1
  with `file:line` in the message. Allow `#` comment lines and blank lines.
- Pipeline (PRD §03 steps 1–6):
  1. Merge all TSVs, keying on `word.toLowerCase()`, summing counts.
  2. Filter keys matching `/^[a-z][a-z0-9_-]{1,31}$/`; drop pure-digit keys
     (unreachable given the regex, but assert it for clarity — regex requires
     a leading `[a-z]`, so digits-only keys are dropped by construction).
  3. Sort count descending; keep top `N = 70_000` (const `DICT_N`).
  4. Quantize by rank: `quant = 255 - floor(254 * log2(1 + rank) / log2(1 + N))`
     (rank 0 → 255, rank N−1 → 1).
  5. Sort entries lexicographically (by UTF-8 byte order —
     `a < b ? -1 : a > b ? 1 : 0` on the strings is sufficient for the
     filtered ASCII-only key set).
  6. Emit the packed file: `bucketCount` = next power of two ≥ 1.3 × N
     (70000 × 1.3 = 91000 → 131072), FNV-1a 32-bit with seed 0, linear
     probing, bucket value = entry index + 1, 0 = empty.
- Success output (stdout size summary): entryCount, blobLen, bucketCount,
  total file bytes, and expected ~1.3 MB for full N. Verify pass
  (step 7 re-lookup) belongs to S2 — this task only prints the summary.

### Success Criteria

- [ ] `node tools/build-dict.mjs --out dict/common-en.bin a.tsv b.tsv` produces
      a file `loadDictionary` loads with `version === 1` and correct
      `entryCount`
- [ ] `lookup(w) === quant` for spot-checked entries (verified in S2's full pass)
- [ ] Zero inputs / only `--out` / missing `--out` / unknown flag → non-zero exit + usage on stderr
- [ ] Malformed TSV line → non-zero exit naming file and line number
- [ ] Script imports nothing outside node: builtins; `node tools/build-dict.mjs` runs on stock Node ≥ 18

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this
successfully?" — Yes: the full binary format, quantization formula, hash
parameters, and CLI contract are reproduced below; nothing outside the script
itself must be modified.

### Documentation & References

```yaml
- file: plan/001_88fc3a66fd74/P1M1T2S2/PRP.md
  why: CONTRACT for the test-side independent writer — the .mjs writer logic
        must match it byte-for-byte (same header layout, FNV-1a, probing).
  gotcha: duplication is intentional; both files must carry the cross-reference
        header comment (see Blueprint).

- file: src/core/dictionary.ts (P1.M1.T2.S1 — CONTRACT, assume exact)
  why: the consumer. loadDictionary(path): Dictionary; validates magic "HAPX",
        version 1; throws on corrupt/truncated. lookup() masks bucket index
        with bucketCount - 1, linear probes, compares blob bytes + length.
  gotcha: DO NOT import it from the .mjs (plain Node, no TS toolchain at runtime).

- file: src/core/types.ts
  why: Dictionary interface (context only; not imported by the script).

- url: https://en.wikipedia.org/wiki/FNV-1a#FNV-1a_hash
  why: 32-bit FNV-1a parameters: offset basis 2166136261 (0x811c9dc5),
        prime 16777619 (0x01000193).
  critical: JS: `h = Math.imul(h ^ byte, 0x01000193)`; plain `*` breaks u32
        semantics. Final: `(h ^ seed) >>> 0`.
```

### Current Codebase tree (relevant)

```bash
tools/               # empty — build-dict.mjs is its first resident
dict/                # does not exist yet — create in --out handling via
                     # fs.mkdirSync(dirname(out), { recursive: true })
src/core/dictionary.ts    # loader (P1.M1.T2.S1, in flight)
test/helpers/dict-writer.ts  # independent TS writer (P1.M1.T2.S2, in flight)
```

### Desired Codebase tree

```bash
tools/
└── build-dict.mjs   # NEW — this deliverable (single file, stdlib only)
dict/
└── common-en.bin    # produced at run time (artifact tracked by S3, not here)
```

### Known Gotchas of our codebase & Library Quirks

```js
// CRITICAL: plain .mjs, node stdlib ONLY (PRD: "build script uses only node
// stdlib. Do not add dependencies"). No imports from src/ or test/.

// GOTCHA: package.json has "type": "module" — .mjs is consistent anyway.

// GOTCHA: header fields LITTLE-ENDIAN: Buffer#writeUInt32LE/writeUInt16LE.

// GOTCHA: offsets has entryCount + 1 entries, offsets[0] = 0, terminal = blobLen.

// GOTCHA: sort lexicographically BEFORE building blob/offsets/scores/buckets.

// GOTCHA: quantize by FREQUENCY rank (step 3) but EMIT in lexicographic order
// (step 5) — the score array must follow the lexicographic entry order, so
// carry quant with each entry through the second sort.

// GOTCHA: FNV-1a with Math.imul; XOR-fold seed at the END: (h ^ seed) >>> 0.
// Loader/bucket index: hash & (bucketCount - 1).

// GOTCHA: header constants duplicated across loader/writer/build script —
// INTENTIONAL. Add the shared header comment per the contract note in §03.

// GOTCHA: N=70_000 → bucketCount = 131072 (next pow2 ≥ 91_000).
```

## Implementation Blueprint

### HAPX v1 format (emit exactly this; PRD §03)

```
0   4  magic "HAPX" (0x48 0x41 0x50 0x58)
4   2  version u16 = 1
6   2  flags u16 = 1 (bit 0: keys are lowercase)
8   4  entryCount u32
12  4  blobLen u32
16  4  bucketCount u32 (power of two, ≥ 1.3 × entryCount)
20  4  seed u32 = 0
24     wordBlob (blobLen bytes, concatenated UTF-8 words)
24+blobLen                    offsets: u32[entryCount+1] (rel. to blob start)
24+blobLen+4*(entryCount+1)   scores:  u8[entryCount] (255 = most common)
after scores                 buckets: u32[bucketCount]; value = idx+1; 0 = empty
```

### Implementation Tasks (ordered)

```yaml
Task 1: CREATE tools/build-dict.mjs — arg parsing
  - HEADER COMMENT (cross-reference contract, §03):
    "// HAPX v1 writer. Header layout constants duplicated by contract with
    // src/core/dictionary.ts (loader) and test/helpers/dict-writer.ts
    // (independent test writer) — see PRD §03. Do not share code; the
    // duplication cross-checks the format."
  - IMPLEMENT parseArgs(argv): { out, inputs } — reject --out without value,
    unknown args, empty inputs; on error print usage to stderr and exit 1.

Task 2: IMPLEMENT readTsv(path): Map<string, number>  (merge = step 1)
  - For each line (split on \n, trim \r): skip blank and lines starting '#'.
  - Split on '\t'; require exactly 2 parts; count must match /^\d+$/
    (non-negative integer). On violation: throw Error(`${path}:${lineno}: bad line "${line}"`).
  - Lowercase key; sum into the shared Map across all files.

Task 3: IMPLEMENT filter/sort/top-N (steps 2–4)
  - Keep keys matching /^[a-z][a-z0-9_-]{1,31}$/ (drops pure digits by
    construction — leading char must be a-z; note this in a comment).
  - Sort [...map] count DESC (stable tie-break lexicographic asc for
    deterministic builds); slice(0, DICT_N = 70_000).
  - quant(rank) = 255 - Math.floor(254 * Math.log2(1 + rank) / Math.log2(1 + DICT_N)).
  - Then sort entries lexicographic ASC for emission.

Task 4: IMPLEMENT emit(outPath, entries)  (steps 5–6)
  - Mirror test/helpers/dict-writer.ts buildDictBinary exactly:
    blob, offsets(entryCount+1), scores, bucketCount = nextPow2(ceil(N*1.3)),
    FNV-1a(word, seed=0) & (bc-1), linear probe while bucket !== 0,
    bucket = idx + 1.
  - fs.mkdirSync(dirname, { recursive: true }); fs.writeFileSync.
  - Buffer.alloc once for the whole file (size ≈ 1.3 MB — fine).

Task 5: IMPLEMENT main(): orchestrate + size summary + exit codes
  - try/catch around parse/merge/emit; errors → console.error, process.exit(1).
  - Success stdout summary:
    entries: 70000, blob: <blobLen> B, buckets: <bucketCount>, total: <bytes> (~1.3 MB expected)
  - Keep steps as separate exported-named functions in ONE file for easy
    extension by S2 (add a verify pass importing nothing new).

Task 6: CREATE fixture-driven smoke check (manual, this task)
  - printf 'the\t100\nAnd\t50\nbad line\n' cases verify error path manually
    (a .ts test harness arrives with S2; here validate via shell, below).
```

### Implementation Patterns & Key Details

```js
// FNV-1a 32-bit (duplicated by contract — see header comment):
function fnv1a(bytes, seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h ^ seed) >>> 0;
}

// Quantization (rank is the count-descending index BEFORE lexicographic sort):
const quant = (rank, n) => 255 - Math.floor(254 * Math.log2(1 + rank) / Math.log2(1 + n));

// Bucket sizing:
const nextPow2 = (min) => { let n = 1; while (n < min) n *= 2; return n; };

// Arg parsing (no deps — keep it ~15 lines, manual loop over argv).
```

### Integration Points

```yaml
OUTPUT ARTIFACT:
  - dict/common-en.bin — consumed by loadDictionary (src/core/dictionary.ts);
    verified end-to-end by P1.M1.T3.S2; shipped/documented by P1.M1.T3.S3.
NO other integration: no package.json script required by the contract, but you
  MAY add "build:dict": "node tools/build-dict.mjs" — do NOT touch other files.
```

## Validation Loop

### Level 1: Syntax

```bash
node --check tools/build-dict.mjs    # parses cleanly
```

### Level 2: Functional (small fixture)

```bash
mkdir -p /tmp/hapax-dict-fix
printf 'the\t1000\nAnd\t800\nfor\t600\ncode\t300\nhapax\t10\n# comment\n\nbadword\t5\n' > /tmp/hapax-dict-fix/a.tsv
printf 'code\t200\nthe\t5\nnot-in-regex!word\t99\n' > /tmp/hapax-dict-fix/b.tsv
node tools/build-dict.mjs --out /tmp/hapax-dict-fix/d.bin /tmp/hapax-dict-fix/a.tsv /tmp/hapax-dict-fix/b.tsv
# expect exit 0; summary shows entries: 4 (the, and, for, code — 'hapax' 10+? note:
# 'hapax' also qualifies (5 chars) → expect 5; badword qualifies too → 6; adjust
# expectation by the filter regex: the/and/for/code/hapax/badword = 6 entries).
```

### Level 3: Consumer compatibility (loader round-trip)

```bash
# quick script using the TS loader via vitest is S2's job; here verify bytes:
node -e '
const b = require("node:fs").readFileSync("/tmp/hapax-dict-fix/d.bin");
console.assert(b.toString("ascii",0,4)==="HAPX","magic");
console.assert(b.readUInt16LE(4)===1,"version");
console.assert(b.readUInt16LE(6)===1,"flags");
const ec=b.readUInt32LE(8), bl=b.readUInt32LE(12), bc=b.readUInt32LE(16);
console.assert((bc&(bc-1))===0 && bc>=ec*1.3,"buckets");
console.assert(b.readUInt32LE(20)===0,"seed");
console.log("OK", {ec, bl, bc, total: b.length});'
```

### Level 4: Error paths

```bash
node tools/build-dict.mjs --out /tmp/x.bin; echo $?                       # expect 1 (no inputs)
node tools/build-dict.mjs /tmp/f.tsv; echo $?                             # expect 1 (no --out)
printf 'bad\tline\textra\n' > /tmp/bad.tsv
node tools/build-dict.mjs --out /tmp/x.bin /tmp/bad.tsv; echo $?          # expect 1, message names file:line
printf 'word\t-5\n' > /tmp/bad2.tsv
node tools/build-dict.mjs --out /tmp/x.bin /tmp/bad2.tsv; echo $?         # expect 1 (negative count)
```

## Final Validation Checklist

- [ ] `node --check tools/build-dict.mjs` passes
- [ ] All Level 2–4 shell checks pass with expected exits/values
- [ ] Header: magic HAPX, version 1, flags 1, seed 0, little-endian, offsets[N+1]
- [ ] bucketCount = 131072 for full N; power of two ≥ 1.3 × N always
- [ ] Quant formula exact: rank 0 → 255, last rank → ≥ 1, monotonic
- [ ] Merge sums across files (code 300+200 → 500); keys lowercased
- [ ] Filter regex `/^[a-z][a-z0-9_-]{1,31}$/` enforced (32-char max incl. first)
- [ ] Zero non-stdlib imports; no imports from src/ or test/
- [ ] Cross-reference header comment present (loader / dict-writer / PRD §03)
- [ ] Error messages include file and line number; exit code 1
- [ ] No other repo files modified (except optional "build:dict" npm script)

## Anti-Patterns to Avoid

- ❌ Adding any npm dependency or importing repo TS from the .mjs
- ❌ Quantizing after the lexicographic sort (quant follows frequency rank, not emit order)
- ❌ Big-endian header writes or DataView default endianness mistakes
- ❌ Plain `*` instead of `Math.imul` in FNV-1a
- ❌ Forgetting offsets[0] = 0 / offsets[N] = blobLen
- ❌ Forgetting `mkdir -p` semantics for the --out directory
- ❌ "DRYing up" the intentional writer duplication across loader/test/script
- ❌ Swallowing parse errors — every bad TSV line must fail loudly with location

---

**Confidence Score: 9/10** — the binary format, hash, quantization, CLI
contract, and the two sibling implementations (loader PRP, independent test
writer PRP) are fully specified and treated as exact contracts; the script is
self-contained stdlib-only code with no framework unknowns.