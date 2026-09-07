import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DICT_VERSION, loadDictionary } from "../src/core/dictionary.js";
import { buildDictBinary, fnv1a, writeDictFile } from "./helpers/dict-writer.js";

/**
 * PRD §09 dictionary suite: round-trip, miss, corruption, truncation, and
 * version-mismatch cases — plus structural checks on the independent fixture
 * writer. All fixtures come from `buildDictBinary` (the single repo-wide
 * generator); no file in this suite hand-builds packed bytes. Real `node:fs`
 * only — no mocks.
 *
 * Optional allocation smoke (skipped by default): vitest workers do not
 * inherit `--expose-gc` from the CLI, so pass it via NODE_OPTIONS:
 *   NODE_OPTIONS="--expose-gc" HAPAX_TEST_GC=1 npx vitest --run test/dictionary.test.ts
 */

// PRD §09 fixture: 10 words, distinct quants (sum = 1166).
const ENTRIES = [
  { word: "the", quant: 255 },
  { word: "and", quant: 240 },
  { word: "for", quant: 200 },
  { word: "code", quant: 150 },
  { word: "hapax", quant: 120 },
  { word: "nrel", quant: 80 },
  { word: "lwlock", quant: 60 },
  { word: "zendesk", quant: 40 },
  { word: "f3a9c2e", quant: 20 },
  { word: "zzzz", quant: 1 },
];

// Lazily-created temp dir; afterEach removes it even on failure so CI never
// accumulates files.
let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function tmpFile(name: string): string {
  dir ??= mkdtempSync(join(tmpdir(), "hapax-dict-"));
  return join(dir, name);
}

function writeRaw(name: string, data: Buffer): string {
  const p = tmpFile(name);
  writeFileSync(p, data);
  return p;
}

describe("buildDictBinary (independent fixture writer)", () => {
  it("emits a spec-correct header, sorted blob, offsets, scores, buckets", () => {
    const buf = buildDictBinary(ENTRIES);
    const n = ENTRIES.length;

    expect(buf.subarray(0, 4).toString("hex")).toBe("48415058"); // magic bytes
    expect(buf.readUInt16LE(4)).toBe(1); // version
    expect(buf.readUInt16LE(6) & 1).toBe(1); // flags bit 0 (lowercase keys)
    expect(buf.readUInt32LE(8)).toBe(n);
    const blobLen = buf.readUInt32LE(12);
    expect(blobLen).toBe(
      ENTRIES.reduce((s, e) => s + Buffer.byteLength(e.word, "utf8"), 0),
    );
    const bucketCount = buf.readUInt32LE(16);
    expect(bucketCount & (bucketCount - 1)).toBe(0); // power of two
    expect(bucketCount).toBeGreaterThanOrEqual(Math.ceil(n * 1.3)); // ≥ 1.3×N
    expect(buf.readUInt32LE(20)).toBe(0); // seed

    const offsetsOff = 24 + blobLen;
    const scoresOff = offsetsOff + 4 * (n + 1);
    const bucketsOff = scoresOff + n;
    expect(buf.length).toBe(bucketsOff + 4 * bucketCount);

    // offsets: n+1 entries, first 0, terminal blobLen, strictly increasing;
    // decoded blob is the fixture's words, lexicographically sorted.
    expect(buf.readUInt32LE(offsetsOff)).toBe(0);
    expect(buf.readUInt32LE(offsetsOff + 4 * n)).toBe(blobLen);
    const words: string[] = [];
    for (let i = 0; i < n; i++) {
      const start = buf.readUInt32LE(offsetsOff + 4 * i);
      const end = buf.readUInt32LE(offsetsOff + 4 * (i + 1));
      expect(end).toBeGreaterThan(start);
      words.push(buf.toString("utf8", 24 + start, 24 + end));
    }
    expect(words).toEqual(ENTRIES.map((e) => e.word).sort());
    expect(words).toEqual([...words].sort()); // stored order IS sorted

    // scores align with the sorted word order
    const sorted = [...ENTRIES].sort((a, b) =>
      a.word < b.word ? -1 : a.word > b.word ? 1 : 0,
    );
    for (let i = 0; i < n; i++) {
      expect(buf.readUInt8(scoresOff + i)).toBe(sorted[i].quant);
    }

    // buckets: nonzero values are exactly {1..n}, each once (linear-probe
    // placement re-verified end-to-end by the loader round-trips below).
    const values: number[] = [];
    for (let s = 0; s < bucketCount; s++) {
      const v = buf.readUInt32LE(bucketsOff + 4 * s);
      if (v !== 0) values.push(v);
    }
    expect(values.sort((a, b) => a - b)).toEqual(
      Array.from({ length: n }, (_, i) => i + 1),
    );
  });

  it("sizes an empty table to bucketCount 1 and loads it", () => {
    const buf = buildDictBinary([]);
    expect(buf.readUInt32LE(8)).toBe(0); // entryCount
    expect(buf.readUInt32LE(12)).toBe(0); // blobLen
    expect(buf.readUInt32LE(16)).toBe(1); // bucketCount: pow2 ≥ 1.3×0
    expect(buf.length).toBe(24 + 0 + 4 + 0 + 4);

    const dict = loadDictionary(writeDictFile(tmpFile("empty.bin"), []));
    expect(dict.entryCount).toBe(0);
    expect(dict.version).toBe(1);
    expect(dict.lookup("anything")).toBeNull();
  });
});

describe("loadDictionary (PRD §09)", () => {
  it("round-trips every entry via a temp file", () => {
    const dict = loadDictionary(writeDictFile(tmpFile("d.bin"), ENTRIES));
    expect(DICT_VERSION).toBe(1);
    expect(dict.version).toBe(1);
    expect(dict.entryCount).toBe(ENTRIES.length);
    for (const e of ENTRIES) expect(dict.lookup(e.word)).toBe(e.quant);
    expect(dict.lookup("qqqqqqqq")).toBeNull();
  });

  it("returns null for absent and over-length words", () => {
    const dict = loadDictionary(writeDictFile(tmpFile("miss.bin"), ENTRIES));
    expect(dict.lookup("qqqqqqqq")).toBeNull();
    expect(dict.lookup("")).toBeNull();
    expect(dict.lookup("x".repeat(65))).toBeNull(); // > 64 UTF-16 units → pre-reject
    expect(dict.lookup("é".repeat(33))).toBeNull(); // 66 UTF-8 bytes → overflow → miss
  });

  it("throws on a corrupted magic", () => {
    const buf = Buffer.from(buildDictBinary(ENTRIES)); // copy: mutate safely
    buf[0] = 0x58; // corrupt the leading magic byte
    expect(() => loadDictionary(writeRaw("badmagic.bin", buf))).toThrow(
      /bad magic/,
    );
  });

  it("throws on truncated files", () => {
    const valid = buildDictBinary(ENTRIES); // 188 bytes total for this fixture
    // Header + 6 blob bytes: sections declared by the header don't fit.
    expect(() =>
      loadDictionary(writeRaw("short30.bin", valid.subarray(0, 30))),
    ).toThrow(/truncated/);
    // Header-only file: passes the <24 check, fails the section-extent check.
    expect(() =>
      loadDictionary(writeRaw("header-only.bin", valid.subarray(0, 24))),
    ).toThrow(/truncated/);
    expect(() =>
      loadDictionary(writeRaw("tiny.bin", Buffer.alloc(10))),
    ).toThrow(/truncated header/);
  });

  it("throws on a version mismatch", () => {
    const buf = Buffer.from(buildDictBinary(ENTRIES));
    buf.writeUInt16LE(2, 4); // patch version u16
    expect(() => loadDictionary(writeRaw("badver.bin", buf))).toThrow(
      /version 2/,
    );
  });

  it("throws on a non-power-of-two bucketCount", () => {
    const buf = Buffer.from(buildDictBinary(ENTRIES));
    buf.writeUInt32LE(12, 16); // 12 breaks the slot-mask contract
    expect(() => loadDictionary(writeRaw("badbuckets.bin", buf))).toThrow(
      /power of two/,
    );
  });

  it("probes correctly on hash collisions (same home slot)", () => {
    const bucketCount = 8; // writer: ceil(1.3 × 4 entries) = 6 → nextPow2 = 8
    const slotOf = (w: string) => fnv1a(w, 0) & (bucketCount - 1);
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

    const dict = loadDictionary(
      writeDictFile(tmpFile("collision.bin"), [
        { word: w1, quant: 7 },
        { word: w2, quant: 9 },
        { word: w3, quant: 130 },
        { word: "unrelated", quant: 42 },
      ]),
    );
    expect(dict.lookup(w1)).toBe(7);
    expect(dict.lookup(w2)).toBe(9);
    expect(dict.lookup(w3)).toBe(130);
    expect(dict.lookup("unrelated")).toBe(42);
    expect(dict.lookup("nope")).toBeNull();
    // self-verify the writer chose the expected power-of-two bucket count
    expect(readFileSync(tmpFile("collision.bin")).readUInt32LE(16)).toBe(8);
  });

  it("accepts a word of exactly 64 UTF-8 bytes", () => {
    const w = "é".repeat(32); // 32 code units = exactly 64 UTF-8 bytes
    const dict = loadDictionary(
      writeDictFile(tmpFile("boundary.bin"), [{ word: w, quant: 55 }]),
    );
    expect(dict.lookup(w)).toBe(55); // exactly 64 bytes is a valid key
  });

  it("loads across all mod-4 section alignments (zero-copy and copy paths)", () => {
    // offsets sit at 24+blobLen and buckets after scores — both arbitrary
    // mod 4. blobLen mod 4 and entryCount drive the absolute alignment of
    // each u32 section, so these fixtures cover all four residues and force
    // both u32View branches (Node ≥ 14 pool byteOffsets are 8-aligned).
    const seenAligned = { aligned: false, unaligned: false };
    const base = [
      { word: "the", quant: 255 },
      { word: "hapax", quant: 10 },
      { word: "zzz", quant: 1 },
    ];
    for (const pad of [0, 1, 2, 3]) {
      const entries = [...base, { word: "a".repeat(1 + pad), quant: pad }];
      const p = writeDictFile(tmpFile(`align${pad}.bin`), entries);
      const dict = loadDictionary(p);
      for (const e of entries) expect(dict.lookup(e.word)).toBe(e.quant);
      expect(dict.lookup("miss")).toBeNull();

      const buf = readFileSync(p);
      const blobLen = buf.readUInt32LE(12);
      const entryCount = buf.readUInt32LE(8);
      const offsetsAbs = buf.byteOffset + 24 + blobLen;
      const bucketsAbs =
        buf.byteOffset + 24 + blobLen + 4 * (entryCount + 1) + entryCount;
      if (offsetsAbs % 4 === 0 && bucketsAbs % 4 === 0) {
        seenAligned.aligned = true;
      } else {
        seenAligned.unaligned = true;
      }
    }
    expect(seenAligned).toEqual({ aligned: true, unaligned: true });
  });
});

// Allocation smoke (PRD §09 "no allocation" bullet) — skipped unless run
// under --expose-gc with HAPAX_TEST_GC=1.
const GC = globalThis as { gc?: () => void };
const gcIt = it.skipIf(
  process.env.HAPAX_TEST_GC !== "1" || typeof GC.gc !== "function",
);

gcIt("10k lookups stay correct after forced gc (allocation smoke)", () => {
  const gc = GC.gc!;
  const dict = loadDictionary(writeDictFile(tmpFile("gc.bin"), ENTRIES));
  // Warm JIT paths so one-time setup allocations don't pollute the delta.
  for (let i = 0; i < 1000; i++) {
    dict.lookup(ENTRIES[i % ENTRIES.length].word);
  }
  gc();
  const before = process.memoryUsage().heapUsed;
  let sum = 0;
  for (let i = 0; i < 10_000; i++) {
    const r = dict.lookup(ENTRIES[i % ENTRIES.length].word);
    if (r === null) throw new Error("unexpected miss during allocation smoke");
    sum += r; // accumulate a smi — no heap allocation in the measured loop
  }
  gc();
  const delta = process.memoryUsage().heapUsed - before;
  // 10_000 / 10 entries = 1000 full passes over the fixture
  expect(sum).toBe(1000 * ENTRIES.reduce((s, e) => s + e.quant, 0));
  expect(delta).toBeLessThan(1 << 20); // smoke bound: < 1 MiB retained
  expect(dict.lookup("qqqqqqqq")).toBeNull();
});