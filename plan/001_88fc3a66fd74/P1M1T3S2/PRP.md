# PRP — P1.M1.T3.S2: Self-verification pass + size summary (`tools/build-dict.mjs` step 7)

---

## Goal

**Feature Goal**: Add PRD §03 build step 7 to `tools/build-dict.mjs` (created by
P1.M1.T3.S1): after emitting the packed file, the script **verifies its own
output** by re-opening it with an embedded minimal reader (header parse +
FNV-1a probe — a *third independent implementation* of the lookup contract),
asserting `lookup(w) === quant` for **every** entry, asserting no duplicate
keys, and printing a size summary (blob/offsets/scores/buckets bytes + total +
entryCount). Any assertion failure exits non-zero.

**Deliverable**: Modified `tools/build-dict.mjs` whose `main()` calls
`verify(outPath, entries)` after `emit()`; plus a vitest test
`test/build-dict.test.ts` that runs the script end-to-end against fixtures.
Only `tools/build-dict.mjs` and the new test file change.

**Success Definition**: `node tools/build-dict.mjs --out dict/common-en.bin a.tsv`
prints a per-section size summary and `verified: N/N entries OK` and exits 0;
corrupted output (simulated in tests by bit-flipping the emitted file) causes
the verification to fail and the process to exit non-zero. The script remains
stdlib-only (`node:fs`, `node:path`, `node:process`, `node:child_process`
allowed *in the test only* for spawning the script).

## Why

- PRD §03 step 7 is explicit: "verify: load the output file, re-look up every
  entry, assert `lookup(w) === quant`, assert no duplicate keys."
- The build script's writer, the TS loader (`src/core/dictionary.ts`), and the
  test writer (`test/helpers/dict-writer.ts`) are **three intentionally
  duplicated implementations**. The embedded verifier is the build script's
  independent reader: a mismatch between writer and reader (or loader) is
  exactly what this pass catches before the artifact is committed
  (P1.M1.T3.S3).
- Makes `node tools/build-dict.mjs` the single **trusted producer** of
  `dict/common-en.bin`: exit 0 ⇒ file is self-consistent.

## What

Behavior after emit (step 7, runs inside the same process, after
`fs.writeFileSync` returns):

1. Re-open the output file with `fs.readFileSync` — do NOT trust in-memory
   buffers; the point is to validate the bytes on disk.
2. Parse the header with an embedded minimal reader (NOT an import of
   `src/core/dictionary.ts` — the script must stay plain-Node stdlib-only and
   the duplication is by contract):
   - assert magic `"HAPX"`, version 1, flags bit 0, seed matches what was
     written (0), `bucketCount` is a power of two and ≥ entryCount × 1.3;
   - assert exact file length: `24 + blobLen + 4*(entryCount+1) + entryCount + 4*bucketCount`;
   - build views: `blob` (Uint8Array over the buffer), `offsets` (read with
     `readUInt32LE` — simplest and alignment-safe in a one-shot verifier),
     `scores` (byte at index), `buckets` (readUInt32LE loop).
3. Embedded `lookup(word)`:
   - encode word to UTF-8; if > 64 bytes return null;
   - `h = FNV-1a(word bytes)` (Math.imul, offset basis 0x811c9dc5, prime
     0x01000193), `idx = (h ^ seed) >>> 0 & (bucketCount - 1)`;
   - linear probe: while `buckets[idx] !== 0`: `e = buckets[idx] - 1`; entry
     matches iff `offsets[e+1] - offsets[e] === len` and blob bytes compare
     equal → return `scores[e]`; else `idx = (idx + 1) & (bucketCount - 1)`;
     guard against infinite loop with a probe counter ≤ bucketCount.
4. For EVERY emitted entry `(word, quant)` (the in-memory list from S1's
   pipeline): assert `lookup(word) === quant`; on first mismatch print
   `verify FAILED: word "X": expected q, got r` to stderr, `process.exit(1)`.
5. Duplicate-key check (two layers):
   - **Build-time**: during bucket insertion in `emit()` (S1 code), assert a
     probed slot never already contains this word (collision on equal key ⇒
     duplicate) — add if not already present.
   - **Verify-time**: entry count equality — `lookup(w)` returning the correct
     quant for every entry plus distinct keys ⇒ no duplicates shrank the map;
     additionally assert `new Set(words).size === words.length` on the input
     list (cheap, explicit, satisfies the PRD wording).
6. Size summary on stdout (S1 already prints a basic one — EXTEND it to
   per-section bytes):
   ```
   dict/common-en.bin: entries=70000 blob=421530B offsets=280004B scores=70000B buckets=131072*4=524288B header=24B total=1295846B (~1.3 MB)
   verified: 70000/70000 entries OK, no duplicate keys
   ```

### Success Criteria

- [ ] Build of a valid TSV set exits 0 with the per-section summary + `verified: N/N` line
- [ ] Bit-flip / truncation of the emitted file (in tests) ⇒ non-zero exit with a message naming the failing check
- [ ] Word present in TSVs but dropped by filter returns `null` from the embedded lookup (spot-check a filtered key)
- [ ] Duplicate-key detection works (feed a TSV with the same key twice — after merge this is one entry; to test true duplicates, unit-test the assert path directly)
- [ ] Script still imports only `node:` builtins; no imports from `src/` or `test/`
- [ ] `npx vitest --run test/build-dict.test.ts` passes

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this
successfully?" — Yes: the S1 PRP (contract for the existing script structure),
the full binary format, hash parameters, and the loader's semantics are all
reproduced below.

### Documentation & References

```yaml
- file: plan/001_88fc3a66fd74/P1M1T3S1/PRP.md
  why: CONTRACT for tools/build-dict.mjs as S1 leaves it — parseArgs/readTsv/
        filter-sort-quantize/emit/main as separate named functions in ONE file;
        main() orchestrates and prints a basic size summary.
  critical: S2 EXTENDS this file; do not restructure S1's functions, only add
        verify() and extend main() + the summary.

- file: src/core/dictionary.ts
  why: the production loader whose semantics the embedded reader must mirror
        (header validation rules, FNV-1a + mask + linear probe + length-then-
        bytes comparison, >64-byte words rejected before lookup).
  gotcha: DO NOT import it from the .mjs — the reader duplication is by
        contract (§03); the .mjs stays runnable on stock Node with no TS
        toolchain. Note its u32View alignment trick — the embedded verifier
        should NOT copy that; use readUInt32LE (one-shot, simple, correct).

- file: test/helpers/dict-writer.ts
  why: second independent writer; shows the exact byte layout the verifier
        must expect (offsets[0]=0, offsets[N]=blobLen, bucket = idx+1).

- file: test/dictionary.test.ts
  why: existing vitest patterns — import style, describe/it shape, fixture
        construction. Follow its conventions for test/build-dict.test.ts.

- url: https://en.wikipedia.org/wiki/FNV-1a#FNV-1a_hash
  why: FNV-1a 32-bit parameters (basis 2166136261, prime 16777619).
  critical: JS needs Math.imul for the multiply; final `(h ^ seed) >>> 0`.
```

### Current Codebase tree (relevant)

```bash
tools/build-dict.mjs          # exists per S1 (may be mid-implementation — treat S1 PRP as contract)
src/core/dictionary.ts        # loader (complete)
src/core/types.ts             # Dictionary interface
test/dictionary.test.ts       # vitest patterns to follow
test/helpers/dict-writer.ts   # independent TS writer
dict/                         # output dir (created by script)
```

### Desired Codebase tree

```bash
tools/build-dict.mjs          # MODIFIED — add verify() step 7 + extended summary
test/build-dict.test.ts       # NEW — end-to-end script tests (spawn via child_process)
```

### Known Gotchas of our codebase & Library Quirks

```js
// CRITICAL: the verifier must re-read the file from disk (readFileSync),
// not reuse the write Buffer — validating in-memory data proves nothing.

// GOTCHA: probing loop MUST have a trip counter (≤ bucketCount) or a corrupt
// table (all buckets non-zero) hangs forever.

// GOTCHA: comparing entries: check LENGTH FIRST (offsets[e+1]-offsets[e]),
// then bytes — a blob prefix match with different length is a false positive.

// GOTCHA: blob compare in Node: buf.equals only compares whole buffers; use
// for-loop byte compare over [offsets[e], offsets[e+1]) against encoded word.

// GOTCHA: keep stdout/stderr discipline — summary goes to stdout, failures to
// stderr, exit codes: 0 ok, 1 verify failure (same as S1's parse failures).

// GOTCHA: tests spawn `node tools/build-dict.mjs` — use execFileSync with
// cwd = repo root; fixtures written to a temp dir (fs.mkdtempSync(os.tmpdir())).

// GOTCHA: run order in main(): emit → summary → verify. Verify failure must
// exit(1) AFTER printing the failure detail so the operator can diagnose.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: ADD verify(outPath, entries) to tools/build-dict.mjs
  - entries: the in-memory post-pipeline list [{word, quant}, ...] from S1
    (lexicographic order; irrelevant to verification).
  - IMPLEMENT: embedded reader per "What" §2–3 above; return a result object
    { entryCount, blobLen, bucketCount, bytes: {header,blob,offsets,scores,buckets,total} }
    on success; throw VerifyError (message names the failed check) on failure.
  - FOLLOW pattern: header checks mirror src/core/dictionary.ts loadDictionary
    validation (truncated, bad magic, unsupported version, power-of-two
    bucketCount, exact file length) — re-implemented, not imported.

Task 2: EXTEND main() in tools/build-dict.mjs
  - After emit(): const stats = verify(outPath, entries) inside try/catch;
    catch → console.error(`verify FAILED: ${msg}`); process.exit(1).
  - Print the extended per-section size summary + `verified: N/N entries OK,
    no duplicate keys` line (exact format in "What" §6).

Task 3: ADD build-time duplicate-key assertion to emit() (S1 code, minimal edit)
  - During linear-probe insertion: if a collided slot's entry equals the word
    being inserted (same length + bytes), throw Error(`duplicate key "${word}"`).

Task 4: CREATE test/build-dict.test.ts
  - FOLLOW pattern: test/dictionary.test.ts (describe/it, expect).
  - HELPERS: writeTsv(dir, lines) writing fixture files; runBuild(args)
    wrapping execFileSync("node", ["tools/build-dict.mjs", ...args], cwd repo root),
    returning {status via catch of thrown error, stdout}.
  - CASES:
    1. happy path: multi-TSV merge fixture → exit 0, stdout contains
       "verified: 6/6 entries OK" (or the fixture's N) and per-section bytes;
       then load the output with test/helpers/dict-writer.ts-independent
       check OR directly with src/core/dictionary.ts loadDictionary (TS side
       may import it — cross-implementation round-trip) and spot-check
       lookup values match expected quants for top/mid/last ranks.
    2. filtered key ("not-in-regex!word") absent: loadDictionary returns null.
    3. corrupt output: run build, then flip a byte in the scores section and
       flip one in the buckets section; re-running just verify is not exposed
       via CLI — instead simulate by calling the script on a pre-corrupted
       pipeline? NO: simplest deterministic approach — corrupt the emitted
       file, then unit-test verify() behavior by importing it. Since .mjs
       exports are importable from vitest (`await import("../tools/build-dict.mjs")`),
       export verify and import it in the test; corrupt buffer → expect throw.
    4. truncated file (slice off last 100 bytes) → verify throws.
    5. bad magic → verify throws.
    6. duplicate keys in one TSV merge to one entry (the/twice) — entryCount
       reflects merge, not duplication; assert summary count.

Task 5: RUN full validation loop below; fix until green.
```

### Implementation Patterns & Key Details

```js
// Embedded minimal reader (third implementation by contract):
function verify(outPath, entries) {
  const buf = fs.readFileSync(outPath);
  if (buf.length < 24) throw new VerifyError("truncated header");
  if (buf.toString("latin1", 0, 4) !== "HAPX") throw new VerifyError("bad magic");
  const version = buf.readUInt16LE(4);
  if (version !== 1) throw new VerifyError(`unsupported version ${version}`);
  const entryCount = buf.readUInt32LE(8), blobLen = buf.readUInt32LE(12);
  const bucketCount = buf.readUInt32LE(16), seed = buf.readUInt32LE(20);
  if ((bucketCount & (bucketCount - 1)) !== 0) throw new VerifyError("bucketCount not pow2");
  if (bucketCount < entryCount * 1.3) throw new VerifyError("bucketCount too small");
  const expected = 24 + blobLen + 4 * (entryCount + 1) + entryCount + 4 * bucketCount;
  if (buf.length !== expected) throw new VerifyError(`length ${buf.length} != ${expected}`);
  const offsetsBase = 24 + blobLen;
  const scoresBase = offsetsBase + 4 * (entryCount + 1);
  const bucketsBase = scoresBase + entryCount;

  function lookup(word) {
    const bytes = Buffer.from(word, "utf8"); // verifier may allocate; loader may not
    if (bytes.length > 64) return null;
    let h = 0x811c9dc5;
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
    let idx = ((h ^ seed) >>> 0) & (bucketCount - 1);
    for (let probe = 0; probe < bucketCount; probe++) {
      const slot = buf.readUInt32LE(bucketsBase + idx * 4);
      if (slot === 0) return null;
      const e = slot - 1, start = buf.readUInt32LE(offsetsBase + e * 4);
      const end = buf.readUInt32LE(offsetsBase + (e + 1) * 4);
      if (end - start === bytes.length) {
        let eq = true;
        for (let i = 0; i < bytes.length; i++)
          if (buf[start + i] !== bytes[i]) { eq = false; break; }
        if (eq) return buf[scoresBase + e];
      }
      idx = (idx + 1) & (bucketCount - 1);
    }
    return null; // unreachable on valid tables; corrupt table guard
  }

  if (new Set(entries.map(x => x.word)).size !== entries.length)
    throw new VerifyError("duplicate keys in entry list");
  for (const { word, quant } of entries) {
    const got = lookup(word);
    if (got !== quant)
      throw new VerifyError(`word "${word}": expected quant ${quant}, got ${got}`);
  }
  if (entryCount !== entries.length)
    throw new VerifyError(`entryCount ${entryCount} != ${entries.length}`);
  return { entryCount, blobLen, bucketCount, bytes: {
    header: 24, blob: blobLen, offsets: 4 * (entryCount + 1),
    scores: entryCount, buckets: 4 * bucketCount,
    total: buf.length } };
}
```

### Integration Points

```yaml
NO new integration: this task only hardens tools/build-dict.mjs.
DOWNSTREAM: P1.M1.T3.S3 relies on exit 0 + summary as the green light to
  commit dict/common-en.bin and documents usage. Keep the summary machine-
  greppable (key=value pairs on one line is fine).
OPTIONAL: no package.json change required; S1 may already have added
  "build:dict" — leave as is.
```

## Validation Loop

### Level 1: Syntax

```bash
node --check tools/build-dict.mjs
npx tsc --noEmit      # test file type-checks
```

### Level 2: Unit / component

```bash
npx vitest --run test/build-dict.test.ts -v
npx vitest --run      # full suite still green (dictionary, types, smoke)
```

### Level 3: End-to-end shell

```bash
T=$(mktemp -d)
printf 'the\t1000\nand\t800\nfor\t600\ncode\t300\nhapax\t10\nbadword\t5\n# c\n\n' > $T/a.tsv
printf 'code\t200\nthe\t5\nnot-in-regex!word\t99\n' > $T/b.tsv
node tools/build-dict.mjs --out $T/d.bin $T/a.tsv $T/b.tsv
echo $?   # 0; stdout shows per-section summary + "verified: 6/6 entries OK, no duplicate keys"
# cross-check with the real loader:
npx vitest --run test/dictionary.test.ts
# corrupt and confirm failure (manual spot check):
cp $T/d.bin $T/d2.bin; printf '\xff' | dd of=$T/d2.bin bs=1 seek=100 conv=notrunc 2>/dev/null
node -e 'import("file://'"$PWD"'/tools/build-dict.mjs").then(m=>{
  try { m.verify("'"$T"'/d2.bin", []); console.log("NO THROW - BAD"); }
  catch (e) { console.log("ok:", e.message); }})'
```

### Level 4: Failure-path sweep

```bash
node tools/build-dict.mjs --out /tmp/x.bin; echo $?   # 1 (S1 arg errors still intact)
# truncated file via vitest case 4; bad magic case 5; wrong quant via score flip case 3
```

## Final Validation Checklist

### Technical

- [ ] `node --check tools/build-dict.mjs` and `npx tsc --noEmit` clean
- [ ] `npx vitest --run` fully green (all suites)
- [ ] Stdlib-only imports in the .mjs; verifier duplication carries the
      cross-reference header comment
- [ ] Probe loop bounded (no infinite loop on corrupt table)
- [ ] Length-before-bytes comparison in lookup

### Feature

- [ ] Valid build: exit 0, `verified: N/N entries OK, no duplicate keys`
- [ ] Per-section size summary prints blob/offsets/scores/buckets/header/total
- [ ] Corrupt (bit-flip/truncate/bad magic) output ⇒ VerifyError + exit 1
- [ ] Duplicate-key detection present at build time and in verify
- [ ] Round-trip vs real loader passes (test loads output with
      `loadDictionary` and spot-checks quants)

### Code Quality

- [ ] S1's function structure preserved; verify() added as a new named export
- [ ] Failures print actionable detail (which word/check failed) to stderr
- [ ] No other repo files modified besides tools/build-dict.mjs and
      test/build-dict.test.ts

## Anti-Patterns to Avoid

- ❌ Verifying the in-memory buffer instead of re-reading the file from disk
- ❌ Importing src/core/dictionary.ts from the .mjs (breaks stdlib-only contract and defeats the independent-implementation cross-check)
- ❌ Unbounded probe loop
- ❌ Comparing blob bytes without checking entry length first
- ❌ Restructuring/renaming S1's pipeline functions — extend, don't rewrite
- ❌ Exiting 0 on verify failure or swallowing the error detail
- ❌ Adding npm dependencies

---

**Confidence Score: 9/10** — the S1 PRP fully specifies the script being
extended, the binary format and hash are pinned in three places, the embedded
reader pattern is fully drafted above, and the loader exists to cross-check
semantics.