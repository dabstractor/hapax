/**
 * Independent in-memory HAPX v1 binary writer — test fixture generator.
 *
 * This module RE-IMPLEMENTS the packed dictionary format (PRD §03) from the
 * spec alone. It deliberately shares ZERO code with the loader in
 * `src/core/dictionary.ts` (no FNV-1a import, no constants, nothing): the
 * writer produces bytes and the loader consumes them without any shared
 * implementation, so `test/dictionary.test.ts` cross-checks the format
 * against the spec twice. If both sides agree, the format is right; do NOT
 * "DRY them up" into a shared module.
 *
 * `tools/build-dict.mjs` (P1.M1.T3) intentionally duplicates this logic a
 * third time — same reasoning, same prohibition.
 *
 * `buildDictBinary` is THE single fixture generator for every downstream
 * suite (score admission bands, store, integration acceptance, the
 * P1.M4.T1.S2 benchmark dictionary). Never hand-craft packed binaries
 * anywhere else in the repo.
 *
 * Emitted layout (all integers little-endian; see PRD §03):
 *
 *   0   4  magic "HAPX" (0x48 0x41 0x50 0x58)
 *   4   2  version u16 = 1
 *   6   2  flags u16 = 1 (bit 0: keys are lowercase)
 *   8   4  entryCount u32
 *   12  4  blobLen u32
 *   16  4  bucketCount u32 (power of two, ≥ 1.3 × entryCount)
 *   20  4  seed u32 = 0
 *   24     wordBlob (blobLen bytes, concatenated UTF-8 words,
 *          lexicographically sorted)
 *   24+blobLen                  offsets: u32[entryCount+1] (terminal = blobLen)
 *   +4*(entryCount+1)           scores:  u8[entryCount]
 *   after scores                buckets: u32[bucketCount]; value = index+1,
 *                               0 = empty; FNV-1a home slot + linear probing
 *
 * Test-only code: this path MAY allocate freely (unlike the loader's
 * allocation-free lookup contract).
 */

import { writeFileSync } from "node:fs";

/** One dictionary fixture entry: a lowercase word and its quantized
 *  commonness rank (0–255). */
export interface DictEntry {
  word: string;
  quant: number;
}

const encoder = new TextEncoder();

/**
 * Writer-local FNV-1a 32-bit hash over the UTF-8 bytes of `word`, XOR-folded
 * with `seed` at the end (matches the header seed field the loader folds in).
 *
 * MUST stay independent of the loader's hash: same spec, separate code.
 * `Math.imul` is required — plain `*` promotes to float64 and loses u32
 * semantics. Parameters: offset basis 0x811c9dc5, prime 0x01000193.
 */
export function fnv1a(word: string, seed: number): number {
  const bytes = encoder.encode(word);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 0x01000193);
  }
  return (h ^ seed) >>> 0;
}

/** Smallest power of two ≥ `min` (min ≤ 1 → 1, so empty tables get 1 slot). */
function nextPow2(min: number): number {
  let n = 1;
  while (n < min) n *= 2;
  return n;
}

/**
 * Build a complete, valid HAPX v1 binary from `entries` (order-independent:
 * entries are sorted lexicographically before the blob is laid out, matching
 * the build-script behavior the loader expects).
 *
 * Bucket placement re-derives the documented probe: home slot =
 * `fnv1a(word, 0) & (bucketCount - 1)`, then linear probing (`(slot + 1) &
 * (bucketCount - 1)`) on collision, storing `entryIndex + 1` (0 = empty).
 */
export function buildDictBinary(entries: DictEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) =>
    a.word < b.word ? -1 : a.word > b.word ? 1 : 0,
  );
  const entryCount = sorted.length;

  const wordBufs = sorted.map((e) => Buffer.from(e.word, "utf8"));
  const blobLen = wordBufs.reduce((n, w) => n + w.length, 0);
  const bucketCount = nextPow2(Math.ceil(entryCount * 1.3));

  const offsetsOff = 24 + blobLen;
  const scoresOff = offsetsOff + 4 * (entryCount + 1);
  const bucketsOff = scoresOff + entryCount;
  const total = bucketsOff + 4 * bucketCount;
  const buf = Buffer.alloc(total); // zero-filled: offsets[0] and empty slots are already 0

  // Header (little-endian — the loader reads with explicit LE accessors).
  buf.write("HAPX", 0, "ascii");
  buf.writeUInt16LE(1, 4); // version
  buf.writeUInt16LE(1, 6); // flags: bit 0 = lowercase keys
  buf.writeUInt32LE(entryCount, 8);
  buf.writeUInt32LE(blobLen, 12);
  buf.writeUInt32LE(bucketCount, 16);
  buf.writeUInt32LE(0, 20); // seed

  // wordBlob + offsets (entryCount + 1 cumulative u32s, terminal = blobLen).
  let off = 0;
  for (let i = 0; i < entryCount; i++) {
    wordBufs[i].copy(buf, 24 + off);
    off += wordBufs[i].length;
    buf.writeUInt32LE(off, offsetsOff + 4 * (i + 1));
  }

  // Scores in the same (sorted) order as the blob/offsets.
  for (let i = 0; i < entryCount; i++) {
    buf.writeUInt8(sorted[i].quant, scoresOff + i);
  }

  // Buckets: FNV-1a home slot + linear probing, value = entryIndex + 1.
  const mask = bucketCount - 1;
  for (let i = 0; i < entryCount; i++) {
    let slot = fnv1a(sorted[i].word, 0) & mask;
    while (buf.readUInt32LE(bucketsOff + 4 * slot) !== 0) {
      slot = (slot + 1) & mask;
    }
    buf.writeUInt32LE(i + 1, bucketsOff + 4 * slot);
  }

  return buf;
}

/**
 * Convenience: write `buildDictBinary(entries)` to `path` and return the
 * path, so temp-file tests read as one expression.
 */
export function writeDictFile(path: string, entries: DictEntry[]): string {
  writeFileSync(path, buildDictBinary(entries));
  return path;
}