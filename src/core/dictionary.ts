/**
 * HAPX packed-binary dictionary loader (PRD §03).
 *
 * The dictionary is the ONLY source of commonness evidence in the pipeline:
 * it maps lowercase words to an 8-bit quantized frequency rank (0–255).
 * Loads the entire file with a single `readFileSync`, validates the header,
 * and exposes an allocation-free `lookup()` (FNV-1a 32-bit + linear probing
 * over typed-array views of the retained backing Buffer).
 *
 * This module is pure core: it imports only `node:fs` and the type-only
 * `Dictionary` contract — nothing from pi packages.
 *
 * File format (all integers little-endian, PRD §03):
 *
 * ```
 * Offset  Size   Field
 * 0       4      magic: ASCII "HAPX" (bytes 0x48 0x41 0x50 0x58)
 * 4       2      version: u16 = 1 (exact match required; see DICT_VERSION)
 * 6       2      flags: u16 (bit 0 = keys are lowercase; read, not enforced)
 * 8       4      entryCount: u32
 * 12      4      blobLen: u32 (total bytes of wordBlob)
 * 16      4      bucketCount: u32 (power of two)
 * 20      4      seed: u32 (FNV-1a hash seed, currently 0)
 * 24      blobLen    wordBlob: concatenated UTF-8 lowercase words, no separators
 * 24+blobLen         offsets: u32[entryCount + 1]
 *                    entry i spans wordBlob[offsets[i], offsets[i+1])
 * 24+blobLen+4*(entryCount+1)     scores: u8[entryCount]  (0–255 quantized)
 * 24+blobLen+4*(entryCount+1)+entryCount   buckets: u32[bucketCount]
 *                    bucket value = entryIndex + 1; 0 = empty slot
 * ```
 */

import { readFileSync } from "node:fs";
import type { Dictionary } from "./types.js";

/** Dictionary format version this loader accepts. The header version must
 *  match exactly; any other value throws (the extension catches and disables
 *  itself — wiring in P1.M3.T5.S1). */
export const DICT_VERSION = 1;

// Module singletons: shared encoder + scratch buffer make lookup()
// allocation-free. Safe because lookup is synchronous (single-threaded JS).
const encoder = new TextEncoder();
const SCRATCH = new Uint8Array(64);

/**
 * Alignment-safe u32 view over `buf` at file offset `off` (LOAD TIME ONLY).
 *
 * `new Uint32Array(buffer, offset)` THROWS when offset % 4 !== 0, and the
 * HAPX layout puts `offsets` at 24+blobLen and `buckets` right after —
 * both arbitrary mod 4. When the absolute byte offset happens to be
 * 4-aligned we take a zero-copy view; otherwise we copy the section ONCE
 * into a fresh Uint32Array. Load-time copies are fine: the contract forbids
 * PER-ENTRY and PER-LOOKUP allocation, not load-time.
 */
function u32View(buf: Buffer, off: number, count: number): Uint32Array {
  const abs = buf.byteOffset + off;
  if (abs % 4 === 0) return new Uint32Array(buf.buffer, abs, count);
  const out = new Uint32Array(count); // one-time copy fallback
  const dv = new DataView(buf.buffer, abs, count * 4);
  // DataView reads need explicit littleEndian=true (default is big-endian!).
  // abs is always valid: off+count*4 ≤ buf.length was verified first.
  for (let i = 0; i < count; i++) out[i] = dv.getUint32(i * 4, true);
  return out;
}

/**
 * Load and validate a HAPX dictionary file (format table above).
 *
 * Validation (throws `Error` on failure — callers may catch to disable):
 * - file shorter than the 24-byte header → "truncated header"
 * - magic bytes ≠ "HAPX" → "bad magic"
 * - header version ≠ `DICT_VERSION` (exact match) → "unsupported version"
 * - bucketCount not a power of two → breaks the mask/probe contract
 * - any section extending past end of file → "truncated"
 *
 * The returned object keeps the single backing Buffer alive for its
 * lifetime; all views are zero-copy over it except u32 sections that land
 * on a misaligned absolute byte offset, which are copied once at load.
 * Heap footprint ≈ file size (plus small alignment copies).
 */
export function loadDictionary(path: string): Dictionary {
  // Single read; `buf` is retained (via the views) for the object lifetime.
  const buf = readFileSync(path);
  if (buf.length < 24) {
    throw new Error("hapax dictionary: truncated header (file < 24 bytes)");
  }

  // Header is little-endian (PRD §03); DataView defaults to big-endian.
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.length);

  if (buf[0] !== 0x48 || buf[1] !== 0x41 || buf[2] !== 0x50 || buf[3] !== 0x58) {
    throw new Error("hapax dictionary: bad magic");
  }
  const version = dv.getUint16(4, true);
  if (version !== DICT_VERSION) {
    throw new Error(
      `hapax dictionary: unsupported version ${version} (expected ${DICT_VERSION})`,
    );
  }
  dv.getUint16(6, true); // flags: bit 0 = lowercase keys — read, not enforced
  const entryCount = dv.getUint32(8, true);
  const blobLen = dv.getUint32(12, true);
  const bucketCount = dv.getUint32(16, true);
  const seed = dv.getUint32(20, true);

  // The probe uses `slot & (bucketCount - 1)`; that mask is only valid for
  // powers of two (and would loop forever on bucketCount === 0).
  if (bucketCount === 0 || (bucketCount & (bucketCount - 1)) !== 0) {
    throw new Error("hapax dictionary: bucketCount is not a power of two");
  }

  // Section layout — see format table in the module JSDoc.
  const blobOff = 24;
  const offsetsOff = blobOff + blobLen;
  const scoresOff = offsetsOff + 4 * (entryCount + 1);
  const bucketsOff = scoresOff + entryCount;
  const end = bucketsOff + 4 * bucketCount;
  if (end > buf.length) {
    throw new Error(
      `hapax dictionary: truncated (header declares ${end} bytes, file has ${buf.length})`,
    );
  }

  const blob = new Uint8Array(buf.buffer, buf.byteOffset + blobOff, blobLen);
  const offsets = u32View(buf, offsetsOff, entryCount + 1);
  const scores = new Uint8Array(buf.buffer, buf.byteOffset + scoresOff, entryCount);
  const buckets = u32View(buf, bucketsOff, bucketCount);

  const mask = bucketCount - 1; // bucketCount is a power of two (validated)

  /**
   * Allocation-free commonness lookup.
   *
   * Encodes `word` into the shared 64-byte scratch (no string→Buffer copy),
   * hashes the UTF-8 bytes with FNV-1a 32-bit
   * (`h = Math.imul(h ^ byte, 16777619)` — plain `*` would promote to
   * float64 and corrupt u32 semantics), XOR-folds the table seed, then
   * linearly probes `buckets` (value = entryIndex+1, 0 = empty). Each probe
   * compares byte-by-byte against `blob` via the offsets table — no
   * `subarray`/`slice`, no object or string creation anywhere on this path.
   *
   * Returns the quantized score (0–255) on hit, `null` on miss, and `null`
   * (never throws) for words whose UTF-8 form exceeds 64 bytes: words with
   * more than 64 UTF-16 code units are rejected before encoding, and
   * multi-byte overflow is detected from `encodeInto`'s read count.
   */
  const lookup = (word: string): number | null => {
    if (word.length > 64) return null; // cheap UTF-16 pre-reject
    const enc = encoder.encodeInto(word, SCRATCH);
    // encodeInto never splits a code point, so read < length ⇔ the full
    // UTF-8 form did not fit in 64 bytes → treat as a miss, never throw.
    if (enc.read !== word.length) return null;
    const written = enc.written;

    // FNV-1a 32-bit: offset basis 0x811c9dc5, prime 0x01000193.
    let h = 0x811c9dc5;
    for (let i = 0; i < written; i++) h = Math.imul(h ^ SCRATCH[i], 0x01000193);
    h = (h ^ seed) >>> 0; // fold in the table seed for a clean u32

    let slot = h & mask;
    // Probe is bounded by bucketCount: a well-formed table always has an
    // empty slot (builder keeps load factor ≤ 0.55) and bucketCount steps
    // cover the whole ring, so the bound cannot cause false misses — it
    // only turns a corrupt, fully-saturated table into a miss, not a hang.
    for (let n = 0; n < bucketCount; n++) {
      const v = buckets[slot];
      if (v === 0) return null;
      const i = v - 1;
      const len = offsets[i + 1] - offsets[i];
      if (len === written) {
        const off = offsets[i];
        let eq = true;
        for (let k = 0; k < len; k++) {
          if (blob[off + k] !== SCRATCH[k]) {
            eq = false;
            break;
          }
        }
        if (eq) return scores[i];
      }
      slot = (slot + 1) & mask;
    }
    return null; // corrupt/saturated table — treat as miss
  };

  return { lookup, version, entryCount };
}