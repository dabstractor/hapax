import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DICT_VERSION, loadDictionary } from "../src/core/dictionary.js";

/**
 * Minimal self-contained HAPX fixture builder (S1 smoke only — the full
 * independent binary-writer suite is P1.M1.T2.S2).
 */

// Test-local copy of the loader's FNV-1a 32-bit (offset basis 0x811c9dc5,
// prime 0x01000193, seed XOR-folded) for hand-inserting buckets.
function fnv1a(bytes: Uint8Array, seed: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h ^ seed) >>> 0;
}

function buildHapxBin(
  entries: { word: string; score: number }[],
  bucketCount: number,
  seed = 0,
): Buffer {
  const enc = new TextEncoder();
  const words = entries.map((e) => enc.encode(e.word));
  const blobLen = words.reduce((n, w) => n + w.length, 0);
  const blob = Buffer.alloc(blobLen);
  const offsets = new Uint32Array(entries.length + 1);
  let off = 0;
  words.forEach((w, i) => {
    blob.set(w, off);
    off += w.length;
    offsets[i + 1] = off;
  });

  const scores = new Uint8Array(entries.map((e) => e.score));
  const buckets = new Uint32Array(bucketCount);
  for (let i = 0; i < entries.length; i++) {
    let slot = fnv1a(words[i], seed) & (bucketCount - 1);
    while (buckets[slot] !== 0) slot = (slot + 1) & (bucketCount - 1); // linear probe
    buckets[slot] = i + 1; // value = entryIndex + 1
  }

  const header = Buffer.alloc(24);
  header.write("HAPX", 0, "ascii");
  header.writeUInt16LE(DICT_VERSION, 4);
  header.writeUInt16LE(1, 6); // flags: lowercase keys
  header.writeUInt32LE(entries.length, 8);
  header.writeUInt32LE(blobLen, 12);
  header.writeUInt32LE(bucketCount, 16);
  header.writeUInt32LE(seed, 20);

  return Buffer.concat([
    header,
    blob,
    Buffer.from(offsets.buffer, offsets.byteOffset, offsets.byteLength),
    Buffer.from(scores.buffer, 0, scores.byteLength),
    Buffer.from(buckets.buffer, 0, buckets.byteLength),
  ]);
}

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function fixture(name: string, data: Buffer): string {
  dir ??= mkdtempSync(join(tmpdir(), "hapx-dict-"));
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
}

describe("loadDictionary", () => {
  it("round-trips a minimal valid binary", () => {
    const p = fixture(
      "basic.bin",
      buildHapxBin(
        [
          { word: "the", score: 255 },
          { word: "hapax", score: 10 },
          { word: "zzz", score: 1 },
        ],
        8,
      ),
    );
    const dict = loadDictionary(p);
    expect(DICT_VERSION).toBe(1);
    expect(dict.version).toBe(1);
    expect(dict.entryCount).toBe(3);
    expect(dict.lookup("the")).toBe(255);
    expect(dict.lookup("hapax")).toBe(10);
    expect(dict.lookup("zzz")).toBe(1);
    expect(dict.lookup("missing")).toBeNull();
    expect(dict.lookup("")).toBeNull(); // no empty keys in a valid table
  });

  it("probes correctly on hash collisions (same home slot)", () => {
    const bucketCount = 16;
    const enc = new TextEncoder();
    const slotOf = (w: string) => fnv1a(enc.encode(w), 0) & (bucketCount - 1);
    // Deterministically find three words sharing one home slot.
    const bySlot = new Map<number, string[]>();
    let chain: string[] | undefined;
    for (let i = 0; i < 10000 && !chain; i++) {
      const w = `k${i}`;
      const arr = bySlot.get(slotOf(w));
      if (arr) {
        arr.push(w);
        if (arr.length === 3) chain = arr;
      } else {
        bySlot.set(slotOf(w), [w]);
      }
    }
    expect(chain).toBeDefined();
    const [w1, w2, w3] = chain!;
    expect(slotOf(w1)).toBe(slotOf(w2)); // self-verify the collision setup
    expect(slotOf(w2)).toBe(slotOf(w3));

    const p = fixture(
      "collision.bin",
      buildHapxBin(
        [
          { word: w1, score: 7 },
          { word: w2, score: 9 },
          { word: w3, score: 130 },
          { word: "unrelated", score: 42 },
        ],
        bucketCount,
      ),
    );
    const dict = loadDictionary(p);
    expect(dict.lookup(w1)).toBe(7);
    expect(dict.lookup(w2)).toBe(9);
    expect(dict.lookup(w3)).toBe(130);
    expect(dict.lookup("unrelated")).toBe(42);
    expect(dict.lookup("nope")).toBeNull();
  });

  it("rejects over-length words and handles the 64-byte boundary", () => {
    const enc = new TextEncoder();
    const exact64 = "é".repeat(32); // 32 code units = exactly 64 UTF-8 bytes
    expect(enc.encode(exact64).length).toBe(64);
    const p = fixture(
      "boundary.bin",
      buildHapxBin([{ word: exact64, score: 55 }], 4),
    );
    const dict = loadDictionary(p);
    expect(dict.lookup(exact64)).toBe(55); // exactly 64 bytes is a valid key
    expect(dict.lookup("a".repeat(65))).toBeNull(); // UTF-16 pre-reject
    expect(dict.lookup("é".repeat(33))).toBeNull(); // 33 code units ≤ 64,
    // but 66 UTF-8 bytes → encodeInto overflow → miss, never throws
  });

  it("throws on bad magic, wrong version, and truncated files", () => {
    const valid = buildHapxBin([{ word: "the", score: 255 }], 4);

    const badMagic = Buffer.from(valid);
    badMagic[0] = 0x58; // "XAPX"
    expect(() => loadDictionary(fixture("badmagic.bin", badMagic))).toThrow(
      /bad magic/,
    );

    const badVersion = Buffer.from(valid);
    badVersion.writeUInt16LE(2, 4);
    expect(() => loadDictionary(fixture("badver.bin", badVersion))).toThrow(
      /version 2/,
    );

    const truncated = valid.subarray(0, valid.length - 9); // short buckets
    expect(() => loadDictionary(fixture("short.bin", truncated))).toThrow(
      /truncated/,
    );

    expect(() => loadDictionary(fixture("tiny.bin", Buffer.alloc(10)))).toThrow(
      /truncated header/,
    );
  });

  it("loads across all mod-4 section alignments (zero-copy and copy paths)", () => {
    // offsets sit at 24+blobLen and buckets after scores — both arbitrary
    // mod 4. blobLen mod 4 and entryCount drive the absolute alignment of
    // each u32 section, so these fixtures cover all four residues and force
    // both u32View branches (Node ≥ 14 pool byteOffsets are 8-aligned).
    const seenAligned = { aligned: false, unaligned: false };
    const entries = [
      { word: "the", score: 255 },
      { word: "hapax", score: 10 },
      { word: "zzz", score: 1 },
    ];
    for (const pad of [0, 1, 2, 3]) {
      const padded = [...entries, { word: "a".repeat(1 + pad), score: pad }];
      const p = fixture(`align${pad}.bin`, buildHapxBin(padded, 8));
      const dict = loadDictionary(p);
      for (const e of padded) expect(dict.lookup(e.word)).toBe(e.score);
      expect(dict.lookup("miss")).toBeNull();

      const buf = readFileSync(p);
      const blobLen = Buffer.from(buf.subarray(12, 16)).readUInt32LE(0);
      const entryCount = Buffer.from(buf.subarray(8, 12)).readUInt32LE(0);
      const offsetsAbs = buf.byteOffset + 24 + blobLen;
      const bucketsAbs =
        buf.byteOffset + 24 + blobLen + 4 * (entryCount + 1) + entryCount;
      if (offsetsAbs % 4 === 0 && bucketsAbs % 4 === 0) seenAligned.aligned = true;
      else seenAligned.unaligned = true;
    }
    expect(seenAligned).toEqual({ aligned: true, unaligned: true });
  });
});