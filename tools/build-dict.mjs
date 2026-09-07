#!/usr/bin/env node
/**
 * HAPX v1 writer. Header layout constants duplicated by contract with
 * src/core/dictionary.ts (loader) and test/helpers/dict-writer.ts
 * (independent test writer) — see PRD §03. Do not share code; the
 * duplication cross-checks the format.
 *
 * Corpus-agnostic build pipeline (PRD §03 "Build pipeline", steps 1–7):
 * consumes `word<TAB>count` TSVs, merges/filters/sorts/quantizes them, emits
 * a packed HAPX v1 binary loadable by `loadDictionary()`, then re-opens the
 * file from disk and verifies it with an embedded minimal reader — `verify()`
 * below, a THIRD independent implementation of the lookup contract next to
 * src/core/dictionary.ts (loader) and test/helpers/dict-writer.ts (test
 * writer); the duplication cross-checks the format and must not be DRYed up.
 * Plain .mjs, node stdlib only — no npm dependencies, no imports from repo
 * TS code.
 *
 * Usage:
 *   node tools/build-dict.mjs --out dict/common-en.bin input1.tsv [input2.tsv ...]
 *
 * Exits 0 with a per-section size summary plus `verified: N/N entries OK,
 * no duplicate keys` on success; exits 1 with a `file:line` message on
 * malformed TSV input, 1 with usage on bad arguments, and 1 with a
 * `verify FAILED: <check>` message when the emitted file fails its own
 * verification pass.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

/** Pipeline step 3: dictionary size cap — keep the top N entries (PRD §03). */
export const DICT_N = 70_000;

/** Step 2 filter (PRD §03). The leading `[a-z]` means pure-digit keys are
 *  dropped by construction — no separate digit check is needed. Max 32 chars
 *  including the first. */
export const KEY_RE = /^[a-z][a-z0-9_-]{1,31}$/;

const USAGE =
  "usage: node tools/build-dict.mjs --out <path> input1.tsv [input2.tsv ...]\n" +
  "  --out <path>      output HAPX v1 binary (required)\n" +
  "  input*.tsv        one or more `word<TAB>count` files (required)";

/** FNV-1a 32-bit over `bytes`, XOR-folded with `seed` at the end.
 *  Duplicated by contract (see header comment): offset basis 0x811c9dc5,
 *  prime 0x01000193. `Math.imul` is required — plain `*` promotes to float64
 *  and breaks u32 semantics. */
export function fnv1a(bytes, seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 0x01000193);
  }
  return (h ^ seed) >>> 0;
}

/** Smallest power of two >= min. */
export function nextPow2(min) {
  let n = 1;
  while (n < min) n *= 2;
  return n;
}

/** Step 4: quantize by FREQUENCY rank (0-based) onto 0–255.
 *  rank 0 → 255; rank DICT_N-1 → ≥ 1; monotonic non-increasing (log-scaled).
 *  The denominator is the DICT_N cap, not the kept count, so scores are
 *  comparable across corpora of different sizes. */
export function quant(rank, n = DICT_N) {
  return 255 - Math.floor((254 * Math.log2(1 + rank)) / Math.log2(1 + n));
}

/** Print `message` plus usage to stderr and exit 1. Arg errors only — TSV
 *  errors go through main()'s catch instead. */
function fail(message) {
  console.error(`error: ${message}`);
  console.error(USAGE);
  process.exit(1);
}

/**
 * Parse CLI args: `--out <path>` (required) plus one or more input paths.
 * Rejects `--out` without a value, unknown flags, a missing `--out`, and
 * empty inputs: prints usage to stderr and exits 1.
 */
export function parseArgs(argv) {
  let out = null;
  const inputs = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      if (i + 1 >= argv.length) fail("--out requires a <path> value");
      out = argv[++i];
    } else if (arg.startsWith("-") && arg.length > 1) {
      fail(`unknown flag: ${arg}`);
    } else {
      inputs.push(arg);
    }
  }
  if (out === null) fail("missing required --out <path>");
  if (inputs.length === 0) fail("missing input TSV path(s)");
  return { out, inputs };
}

/**
 * Step 1 (merge): parse one `word<TAB>count` TSV and accumulate counts into
 * the shared `map`, keyed on `word.toLowerCase()` (counts sum across files).
 * Blank lines and `#` comment lines are skipped; any other malformed line
 * (wrong column count, non-numeric or negative count) throws with the
 * `path:line` location. Returns `map` for chaining.
 */
export function mergeTsv(path, map) {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    const lineno = i + 1;
    if (line === "" || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length !== 2 || !/^\d+$/.test(parts[1])) {
      throw new Error(
        `${path}:${lineno}: bad line "${line}" (expected word<TAB>non-negative-integer)`,
      );
    }
    const key = parts[0].toLowerCase();
    map.set(key, (map.get(key) ?? 0) + Number(parts[1]));
  }
  return map;
}

/**
 * Steps 2–4: filter keys against KEY_RE, sort by count descending
 * (lexicographic ASC tie-break for deterministic builds), keep the top
 * DICT_N, and attach `quant` computed from each entry's frequency rank.
 * Returns entries in count-descending order, each `{ word, count, quant }`.
 */
export function selectEntries(map) {
  const kept = [];
  for (const [word, count] of map) {
    if (KEY_RE.test(word)) kept.push({ word, count });
  }
  kept.sort(
    (a, b) =>
      b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0),
  );
  const top = kept.slice(0, DICT_N);
  for (let rank = 0; rank < top.length; rank++) {
    top[rank].quant = quant(rank);
  }
  return top;
}

/**
 * Steps 5–6: emit the packed HAPX v1 file (format table in PRD §03),
 * mirroring test/helpers/dict-writer.ts `buildDictBinary` byte-for-byte:
 * lexicographic blob order, offsets[entryCount + 1] (offsets[0] = 0, terminal
 * = blobLen), then scores in the same lexicographic order (each entry's quant
 * was computed from frequency rank BEFORE this sort and carried through it),
 * then buckets sized nextPow2(ceil(entryCount * 1.3)) and filled via
 * FNV-1a home slot + linear probing, value = entryIndex + 1, 0 = empty.
 * Creates `dirname(outPath)` recursively. Returns the size summary fields.
 */
export function emit(outPath, entries) {
  // Step 5: lexicographic ASC (plain string compare suffices — the filter
  // guarantees ASCII-only keys).
  const sorted = [...entries].sort((a, b) =>
    a.word < b.word ? -1 : a.word > b.word ? 1 : 0,
  );
  const entryCount = sorted.length;

  const wordBufs = sorted.map((e) => Buffer.from(e.word, "utf8"));
  const blobLen = wordBufs.reduce((n, w) => n + w.length, 0);
  // Step 6: bucketCount = next power of two >= 1.3 × entryCount
  // (70_000 × 1.3 = 91_000 → 131_072 at full N).
  const bucketCount = nextPow2(Math.ceil(entryCount * 1.3));

  const offsetsOff = 24 + blobLen;
  const scoresOff = offsetsOff + 4 * (entryCount + 1);
  const bucketsOff = scoresOff + entryCount;
  const total = bucketsOff + 4 * bucketCount;
  // One zero-filled allocation for the whole file (~1.3 MB at full N):
  // offsets[0] and the empty bucket slots are already 0.
  const buf = Buffer.alloc(total);

  // Header — all integers LITTLE-ENDIAN (Buffer#write*LE), PRD §03.
  buf.write("HAPX", 0, "ascii");
  buf.writeUInt16LE(1, 4); // version
  buf.writeUInt16LE(1, 6); // flags: bit 0 = keys are lowercase
  buf.writeUInt32LE(entryCount, 8);
  buf.writeUInt32LE(blobLen, 12);
  buf.writeUInt32LE(bucketCount, 16);
  buf.writeUInt32LE(0, 20); // seed

  // wordBlob + cumulative offsets (entryCount + 1 u32s, terminal = blobLen).
  let off = 0;
  for (let i = 0; i < entryCount; i++) {
    wordBufs[i].copy(buf, 24 + off);
    off += wordBufs[i].length;
    buf.writeUInt32LE(off, offsetsOff + 4 * (i + 1));
  }

  // Scores in the same lexicographic order as blob/offsets.
  for (let i = 0; i < entryCount; i++) {
    buf.writeUInt8(sorted[i].quant, scoresOff + i);
  }

  // Buckets: FNV-1a home slot + linear probing, value = entry index + 1.
  // Hash the word's UTF-8 bytes (the same bytes stored in the blob).
  const mask = bucketCount - 1;
  for (let i = 0; i < entryCount; i++) {
    const bytes = wordBufs[i];
    let slot = fnv1a(bytes, 0) & mask;
    while (buf.readUInt32LE(bucketsOff + 4 * slot) !== 0) {
      // Build-time duplicate-key guard (PRD §03 step 7): a collided slot
      // that already holds THIS word (same length, same bytes) means the
      // entry list contained the key twice — fail loudly instead of letting
      // the second copy silently alias the first. Entry LENGTH is compared
      // before blob bytes, same as the probe in verify()/loadDictionary().
      const e = buf.readUInt32LE(bucketsOff + 4 * slot) - 1;
      const start = buf.readUInt32LE(offsetsOff + 4 * e);
      const end = buf.readUInt32LE(offsetsOff + 4 * (e + 1));
      if (end - start === bytes.length) {
        let eq = true;
        for (let k = 0; k < bytes.length; k++) {
          if (buf[24 + start + k] !== bytes[k]) {
            eq = false;
            break;
          }
        }
        if (eq) throw new Error(`duplicate key "${sorted[i].word}"`);
      }
      slot = (slot + 1) & mask;
    }
    buf.writeUInt32LE(i + 1, bucketsOff + 4 * slot);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  return { entryCount, blobLen, bucketCount, total };
}

/** Per-section size summary (PRD §03 step 7 output — machine-greppable
 *  key=value pairs on one line), e.g. at full N:
 *    dict/common-en.bin: entries=70000 blob=421530B offsets=280004B scores=70000B
 *      buckets=131072*4=524288B header=24B total=1295846B (~1.3 MB)
 */
function printSizeSummary(outPath, { entryCount, blobLen, bucketCount, total }) {
  console.log(
    `${outPath}: entries=${entryCount} blob=${blobLen}B ` +
      `offsets=${4 * (entryCount + 1)}B scores=${entryCount}B ` +
      `buckets=${bucketCount}*4=${4 * bucketCount}B header=24B ` +
      `total=${total}B (~${(total / 1e6).toFixed(1)} MB)`,
  );
}

/** Verification failure (build step 7). The message names the failed check;
 *  main() prints `verify FAILED: <message>` and exits 1 (distinguishable
 *  from input errors, which are prefixed `error:`). */
export class VerifyError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerifyError";
  }
}

/**
 * PRD §03 build step 7: self-verification pass. Re-opens the file just
 * written (readFileSync — the in-memory write buffer is NOT trusted; the
 * point is to validate the bytes on disk) and validates it with an embedded
 * minimal reader: a third independent implementation of the lookup contract
 * (see the file header — loader, test writer, and this reader share no code
 * on purpose; a writer/reader disagreement is exactly what this catches).
 *
 * Checks (each failure throws `VerifyError` naming the failed check):
 * 1. header: magic "HAPX", version 1, flags bit 0, seed 0, bucketCount a
 *    power of two and ≥ 1.3 × entryCount, and the exact file length
 *    `24 + blobLen + 4*(entryCount+1) + entryCount + 4*bucketCount`;
 * 2. every `(word, quant)` in `entries` (the in-memory post-pipeline list)
 *    looks up to exactly `quant` via FNV-1a + linear probing, comparing the
 *    entry LENGTH before blob bytes (a blob prefix must not false-positive);
 * 3. no duplicate keys in the list: `new Set(words).size === words.length`
 *    (emit()'s insertion guard is the build-time layer — together they
 *    satisfy the PRD's "assert no duplicate keys");
 * 4. header entryCount equals the list length (nothing silently dropped).
 *
 * The probe loop is bounded by bucketCount, so a corrupt (fully saturated)
 * table degrades to misses, never an infinite loop. u32 sections are read
 * with `readUInt32LE` — alignment-safe and simple in this one-shot context
 * (deliberately NOT the loader's u32View alignment trick).
 *
 * Returns `{ entryCount, blobLen, bucketCount, bytes, lookup }` on success:
 * per-section byte sizes for the summary, plus the embedded `lookup`,
 * exposed so tests can spot-check misses (e.g. filtered keys) directly.
 */
export function verify(outPath, entries) {
  const buf = readFileSync(outPath);
  if (buf.length < 24) {
    throw new VerifyError("truncated header (file < 24 bytes)");
  }
  if (buf.toString("latin1", 0, 4) !== "HAPX") {
    throw new VerifyError("bad magic");
  }
  const version = buf.readUInt16LE(4);
  if (version !== 1) {
    throw new VerifyError(`unsupported version ${version} (expected 1)`);
  }
  const flags = buf.readUInt16LE(6);
  if ((flags & 1) !== 1) {
    throw new VerifyError(`flags ${flags} missing bit 0 (lowercase keys)`);
  }
  const entryCount = buf.readUInt32LE(8);
  const blobLen = buf.readUInt32LE(12);
  const bucketCount = buf.readUInt32LE(16);
  const seed = buf.readUInt32LE(20);
  if (seed !== 0) {
    throw new VerifyError(`seed ${seed} != 0`);
  }
  // The probe masks with bucketCount - 1: that is only valid for powers of
  // two (and 0 would loop forever), mirroring loadDictionary's validation.
  if (bucketCount === 0 || (bucketCount & (bucketCount - 1)) !== 0) {
    throw new VerifyError(`bucketCount ${bucketCount} is not a power of two`);
  }
  if (bucketCount < entryCount * 1.3) {
    throw new VerifyError(
      `bucketCount ${bucketCount} too small for ${entryCount} entries (need >= 1.3x)`,
    );
  }
  const expectedLen =
    24 + blobLen + 4 * (entryCount + 1) + entryCount + 4 * bucketCount;
  if (buf.length !== expectedLen) {
    throw new VerifyError(
      `file length ${buf.length} != ${expectedLen} (truncated or corrupt header)`,
    );
  }

  // Section layout — same arithmetic as emit() (format table in PRD §03).
  const offsetsBase = 24 + blobLen;
  const scoresBase = offsetsBase + 4 * (entryCount + 1);
  const bucketsBase = scoresBase + entryCount;

  /** Embedded lookup — same contract as loadDictionary().lookup: FNV-1a
   *  (Math.imul, offset basis 0x811c9dc5, prime 0x01000193) over the word's
   *  UTF-8 bytes, seed XOR-fold, mask by bucketCount - 1, linear probing
   *  (value = entryIndex + 1, 0 = empty), entry LENGTH compared before blob
   *  bytes. Returns the u8 score on hit, null on miss. Bounded by
   *  bucketCount probes so a saturated table degrades to a miss, not a
   *  hang. Blob byte k of entry e lives at file offset 24 + start + k (the
   *  blob starts right after the 24-byte header). */
  function lookup(word) {
    const bytes = Buffer.from(word, "utf8");
    if (bytes.length > 64) return null; // loader rejects these pre-hash too
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h = Math.imul(h ^ bytes[i], 0x01000193);
    }
    let idx = ((h ^ seed) >>> 0) & (bucketCount - 1);
    for (let probe = 0; probe < bucketCount; probe++) {
      const slot = buf.readUInt32LE(bucketsBase + idx * 4);
      if (slot === 0) return null;
      const e = slot - 1;
      const start = buf.readUInt32LE(offsetsBase + e * 4);
      const end = buf.readUInt32LE(offsetsBase + (e + 1) * 4);
      if (end - start === bytes.length) {
        let eq = true;
        for (let i = 0; i < bytes.length; i++) {
          if (buf[24 + start + i] !== bytes[i]) {
            eq = false;
            break;
          }
        }
        if (eq) return buf[scoresBase + e];
      }
      idx = (idx + 1) & (bucketCount - 1);
    }
    return null; // corrupt/saturated table — miss, never hang
  }

  if (new Set(entries.map((x) => x.word)).size !== entries.length) {
    throw new VerifyError("duplicate keys in entry list");
  }
  for (const { word, quant } of entries) {
    const got = lookup(word);
    if (got !== quant) {
      throw new VerifyError(
        `word "${word}": expected quant ${quant}, got ${got}`,
      );
    }
  }
  if (entryCount !== entries.length) {
    throw new VerifyError(`entryCount ${entryCount} != ${entries.length}`);
  }

  return {
    entryCount,
    blobLen,
    bucketCount,
    lookup, // exposed for tests; main() ignores it
    bytes: {
      header: 24,
      blob: blobLen,
      offsets: 4 * (entryCount + 1),
      scores: entryCount,
      buckets: 4 * bucketCount,
      total: buf.length,
    },
  };
}

/**
 * Orchestrate parse → merge → filter/sort/quantize → emit → verify (PRD §03
 * steps 1–7): print the per-section size summary to stdout, then — after the
 * verification pass — the `verified: N/N entries OK, no duplicate keys`
 * line. Run order is emit → summary → verify: the summary comes from emit's
 * own numbers, then verify() re-reads the file from disk before the verified
 * line is printed, so a failing check still reaches the operator (stderr)
 * with the section sizes already on stdout for diagnosis.
 *
 * Any TSV/IO/verify error is printed to stderr with exit 1 (arg errors exit
 * earlier inside parseArgs with usage); verify failures are prefixed
 * `verify FAILED:` to distinguish them from input errors (`error:`).
 */
export function main(argv = process.argv.slice(2)) {
  const { out, inputs } = parseArgs(argv);
  try {
    const map = new Map();
    for (const path of inputs) mergeTsv(path, map);
    const entries = selectEntries(map);
    const emitted = emit(out, entries);
    printSizeSummary(out, emitted);
    const stats = verify(out, entries);
    console.log(
      `verified: ${stats.entryCount}/${stats.entryCount} entries OK, no duplicate keys`,
    );
  } catch (err) {
    if (err instanceof VerifyError) {
      console.error(`verify FAILED: ${err.message}`);
    } else {
      console.error(`error: ${err.message}`);
    }
    process.exit(1);
  }
}

// Run only when invoked directly as a script (not when S2 imports the
// exported step functions for its verify pass).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}