#!/usr/bin/env node
/**
 * HAPX v1 writer. Header layout constants duplicated by contract with
 * src/core/dictionary.ts (loader) and test/helpers/dict-writer.ts
 * (independent test writer) — see PRD §03. Do not share code; the
 * duplication cross-checks the format.
 *
 * Corpus-agnostic build pipeline (PRD §03 "Build pipeline", steps 1–6):
 * consumes `word<TAB>count` TSVs, merges/filters/sorts/quantizes them, and
 * emits a packed HAPX v1 binary loadable by `loadDictionary()`. Plain .mjs,
 * node stdlib only — no npm dependencies, no imports from repo TS code.
 *
 * Usage:
 *   node tools/build-dict.mjs --out dict/common-en.bin input1.tsv [input2.tsv ...]
 *
 * Exits 0 with a size summary on success; exits 1 with a `file:line` message
 * on malformed TSV input, and 1 with usage on bad arguments.
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
    let slot = fnv1a(wordBufs[i], 0) & mask;
    while (buf.readUInt32LE(bucketsOff + 4 * slot) !== 0) {
      slot = (slot + 1) & mask;
    }
    buf.writeUInt32LE(i + 1, bucketsOff + 4 * slot);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  return { entryCount, blobLen, bucketCount, total };
}

/**
 * Orchestrate parse → merge → filter/sort/quantize → emit, print the size
 * summary to stdout, and exit 0. Any TSV/IO error is printed to stderr with
 * exit 1 (arg errors exit earlier inside parseArgs with usage).
 */
export function main(argv = process.argv.slice(2)) {
  const { out, inputs } = parseArgs(argv);
  try {
    const map = new Map();
    for (const path of inputs) mergeTsv(path, map);
    const entries = selectEntries(map);
    const { entryCount, blobLen, bucketCount, total } = emit(out, entries);
    console.log(
      `wrote ${out}\n` +
        `entries: ${entryCount}, blob: ${blobLen} B, buckets: ${bucketCount}, ` +
        `total: ${total} B (~1.3 MB expected at full N=${DICT_N})`,
    );
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}

// Run only when invoked directly as a script (not when S2 imports the
// exported step functions for its verify pass).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}