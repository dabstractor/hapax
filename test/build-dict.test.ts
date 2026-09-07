import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDictionary } from "../src/core/dictionary.js";

/**
 * End-to-end suite for tools/build-dict.mjs (PRD §03 build pipeline steps
 * 1–7). The script is exercised two ways:
 *
 *  - as a spawned CLI (`node tools/build-dict.mjs …`) for exit codes, the
 *    per-section stdout summary, the `verified: N/N` line, and the stderr
 *    failure contracts inherited from P1.M1.T3.S1;
 *  - as an imported ES module for the corruption matrix — `verify()` is a
 *    named export precisely so tests can drive it against mutated files
 *    (bit-flips, truncation, bad headers) without a CLI surface for it.
 *
 * `loadDictionary` (the TS loader) round-trips the script's output: producer
 * and consumer share no code by contract, so agreement here is real format
 * evidence, not a tautology. Expected quants/offsets are re-derived in this
 * file from the PRD §03 rules (filter regex, rank→quant formula, section
 * arithmetic); the test never imports the script's constants for its
 * expectations.
 */

/** Shape of the parts of tools/build-dict.mjs used below. Imported via a
 *  runtime-computed URL (non-literal specifier → no declaration file needed;
 *  the script stays plain stdlib-only .mjs by contract). */
interface BuildDictModule {
  mergeTsv(path: string, map: Map<string, number>): Map<string, number>;
  selectEntries(
    map: Map<string, number>,
  ): Array<{ word: string; count: number; quant: number }>;
  emit(
    outPath: string,
    entries: Array<{ word: string; count: number; quant: number }>,
  ): { entryCount: number; blobLen: number; bucketCount: number; total: number };
  verify(
    outPath: string,
    entries: Array<{ word: string; quant: number }>,
  ): {
    entryCount: number;
    blobLen: number;
    bucketCount: number;
    lookup(word: string): number | null;
    bytes: {
      header: number;
      blob: number;
      offsets: number;
      scores: number;
      buckets: number;
      total: number;
    };
  };
}

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const build = (await import(
  /* @vite-ignore */ pathToFileURL(join(REPO_ROOT, "tools", "build-dict.mjs"))
    .href
)) as BuildDictModule;

// --- Spec-derived expectations (independent of the script's code) ----------

/** PRD §03 step 2 filter — independent copy for expectation building. */
const KEY_RE = /^[a-z][a-z0-9_-]{1,31}$/;

/** PRD §03 dictionary size cap. */
const DICT_N = 70_000;

/** PRD §03 step 4 rank→quant formula, re-implemented for expectations
 *  (rank 0 → 255, monotonic non-increasing, log-scaled over DICT_N). */
function specQuant(rank: number): number {
  return 255 - Math.floor((254 * Math.log2(1 + rank)) / Math.log2(1 + DICT_N));
}

/** PRD §03 step 6: bucketCount = next power of two ≥ 1.3 × entryCount. */
function specBucketCount(entryCount: number): number {
  let n = 1;
  while (n < Math.ceil(entryCount * 1.3)) n *= 2;
  return n;
}

// Two-file fixture (same corpus as the PRP shell validation): multi-TSV
// merge (the/code appear in both files), a `#` comment, a blank line, and a
// key the filter must drop (`!` breaks KEY_RE).
const FIXTURE_A = [
  "the\t1000",
  "and\t800",
  "for\t600",
  "code\t300",
  "hapax\t10",
  "badword\t5",
  "# comment only",
  "",
];
const FIXTURE_B = ["code\t200", "the\t5", "not-in-regex!word\t99"];

/** Post-pipeline expectation for given TSV lines: merge counts (lowercased),
 *  apply the filter, rank count-descending (lexicographic tie-break), and
 *  quantize by rank. */
function expectedEntries(
  files: string[][],
): Array<{ word: string; quant: number }> {
  const counts = new Map<string, number>();
  for (const lines of files) {
    for (const line of lines) {
      if (line === "" || line.startsWith("#")) continue;
      const [w, c] = line.split("\t");
      const key = w!.toLowerCase();
      if (!KEY_RE.test(key)) continue;
      counts.set(key, (counts.get(key) ?? 0) + Number(c));
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([word], rank) => ({ word, quant: specQuant(rank) }));
}

// the, and, for, code, hapax, badword (count-desc; all counts distinct).
const EXPECTED = expectedEntries([FIXTURE_A, FIXTURE_B]);

// --- Helpers ----------------------------------------------------------------

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hapax-builddict-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeTsv(name: string, lines: string[]): string {
  const p = join(dir, name);
  writeFileSync(p, lines.join("\n") + "\n");
  return p;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Spawn `node tools/build-dict.mjs <args>` with cwd = repo root; non-zero
 *  exits are captured (status/stderr), not thrown. */
function runBuild(args: string[]): RunResult {
  try {
    const stdout = execFileSync("node", ["tools/build-dict.mjs", ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number | null; stdout: string; stderr: string };
    return {
      status: e.status ?? 1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
    };
  }
}

/** Run the in-process pipeline (mergeTsv → selectEntries → emit) on the
 *  standard two-file fixture; returns the output path + expected entries. */
function buildFixture(outName = "f.bin"): {
  out: string;
  entries: Array<{ word: string; count: number; quant: number }>;
} {
  const map = build.mergeTsv(writeTsv("a.tsv", FIXTURE_A), new Map());
  build.mergeTsv(writeTsv("b.tsv", FIXTURE_B), map);
  const entries = build.selectEntries(map);
  const out = join(dir, outName);
  build.emit(out, entries);
  return { out, entries };
}

/** Independently decode section offsets from an emitted file. */
function sections(path: string) {
  const buf = readFileSync(path);
  const entryCount = buf.readUInt32LE(8);
  const blobLen = buf.readUInt32LE(12);
  const bucketCount = buf.readUInt32LE(16);
  const offsetsOff = 24 + blobLen;
  const scoresOff = offsetsOff + 4 * (entryCount + 1);
  const bucketsOff = scoresOff + entryCount;
  return {
    buf,
    entryCount,
    blobLen,
    bucketCount,
    offsetsOff,
    scoresOff,
    bucketsOff,
  };
}

// --- CLI (spawned, exit codes + stdout contract) ------------------------------

describe("build-dict CLI", () => {
  it("builds merged TSVs: exit 0, per-section summary, verified line, loader round-trip", () => {
    const a = writeTsv("a.tsv", FIXTURE_A);
    const b = writeTsv("b.tsv", FIXTURE_B);
    const out = join(dir, "d.bin");
    const r = runBuild(["--out", out, a, b]);
    expect(r.status).toBe(0);

    // Per-section summary, re-derived from spec arithmetic. 6 entries: the
    // filter dropped not-in-regex!word despite its count of 99.
    const n = EXPECTED.length;
    expect(n).toBe(6);
    const blobLen = EXPECTED.map((e) => e.word)
      .sort()
      .reduce((s, w) => s + Buffer.byteLength(w, "utf8"), 0);
    const bucketCount = specBucketCount(n);
    const total = 24 + blobLen + 4 * (n + 1) + n + 4 * bucketCount;
    expect(r.stdout).toContain(`entries=${n}`);
    expect(r.stdout).toContain(`blob=${blobLen}B`);
    expect(r.stdout).toContain(`offsets=${4 * (n + 1)}B`);
    expect(r.stdout).toContain(`scores=${n}B`);
    expect(r.stdout).toContain(`buckets=${bucketCount}*4=${4 * bucketCount}B`);
    expect(r.stdout).toContain("header=24B");
    expect(r.stdout).toContain(`total=${total}B`);
    expect(r.stdout).toContain(
      `verified: ${n}/${n} entries OK, no duplicate keys`,
    );

    // Cross-implementation round-trip: the TS loader must read the script's
    // output and agree on every quant (top/mid/last ranks included).
    const dict = loadDictionary(out);
    expect(dict.entryCount).toBe(n);
    for (const e of EXPECTED) expect(dict.lookup(e.word)).toBe(e.quant);
    expect(dict.lookup("the")).toBe(255); // rank 0
    expect(dict.lookup("code")).toBe(EXPECTED[3].quant); // merged 300+200 → rank 3
    expect(dict.lookup("badword")).toBe(EXPECTED[5].quant); // last rank

    // Filtered key is absent from the loaded table (PRD case 2)…
    expect(dict.lookup("not-in-regex!word")).toBeNull();
    expect(dict.lookup("never-present")).toBeNull();
  });

  it("merges duplicate keys within one TSV into a single entry", () => {
    const tsv = writeTsv("dup.tsv", ["the\t1000", "the\t5"]);
    const out = join(dir, "dup.bin");
    const r = runBuild(["--out", out, tsv]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("entries=1"); // merged, not duplicated
    expect(r.stdout).toContain("verified: 1/1 entries OK, no duplicate keys");
    expect(loadDictionary(out).lookup("the")).toBe(255); // merged 1005 → rank 0
  });

  it("accepts an all-comments TSV (0 entries)", () => {
    const tsv = writeTsv("empty.tsv", ["# nothing here", ""]);
    const out = join(dir, "empty.bin");
    const r = runBuild(["--out", out, tsv]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("entries=0");
    expect(r.stdout).toContain("verified: 0/0 entries OK, no duplicate keys");
    expect(loadDictionary(out).lookup("the")).toBeNull();
  });

  it("keeps the S1 arg/TSV failure contracts (exit 1, stderr)", () => {
    const missing = runBuild(["--out", join(dir, "x.bin")]);
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toMatch(/usage:/);

    const tsv = writeTsv("bad.tsv", ["the\t1000", "oops-no-tab"]);
    const bad = runBuild(["--out", join(dir, "y.bin"), tsv]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/bad\.tsv:2: bad line/);
  });
});

// --- verify() (imported module: corruption matrix + assert paths) -------------

describe("build-dict verify()", () => {
  it("returns per-section bytes and exposes the embedded lookup", () => {
    const { out, entries } = buildFixture();
    const stats = build.verify(out, entries);
    expect(stats.entryCount).toBe(6);
    // and, badword, code, for, hapax, the = 3+7+4+3+5+3 blob bytes;
    // nextPow2(ceil(6 × 1.3)) = 8 buckets.
    expect(stats.bytes).toEqual({
      header: 24,
      blob: 25,
      offsets: 28,
      scores: 6,
      buckets: 32,
      total: 115,
    });
    // Embedded reader spot-checks (PRD: filtered key returns null).
    expect(stats.lookup("not-in-regex!word")).toBeNull();
    expect(stats.lookup("zzzzz")).toBeNull();
    for (const e of entries) expect(stats.lookup(e.word)).toBe(e.quant);
  });

  it("detects a flipped score byte (wrong quant)", () => {
    const { out, entries } = buildFixture();
    const s = sections(out);
    const target = entries[0]; // "the" — first in count-desc check order
    const lexIndex = entries
      .map((e) => e.word)
      .sort()
      .indexOf(target.word);
    const wrong = (target.quant + 1) % 256;
    s.buf[s.scoresOff + lexIndex] = wrong;
    writeFileSync(out, s.buf);
    expect(() => build.verify(out, entries)).toThrow(
      `word "${target.word}": expected quant ${target.quant}, got ${wrong}`,
    );
  });

  it("detects a zeroed bucket slot (entry becomes unfindable)", () => {
    const { out, entries } = buildFixture();
    const s = sections(out);
    // Empty the slot holding the LAST lexicographic entry (value = entryCount)
    // — deterministic target, no probe re-implementation needed. That entry
    // is also first in the count-desc check order, so the failure names it.
    let slot = -1;
    for (let i = 0; i < s.bucketCount; i++) {
      if (s.buf.readUInt32LE(s.bucketsOff + 4 * i) === s.entryCount) {
        slot = i;
        break;
      }
    }
    expect(slot).toBeGreaterThanOrEqual(0);
    s.buf.writeUInt32LE(0, s.bucketsOff + 4 * slot);
    writeFileSync(out, s.buf);
    expect(() => build.verify(out, entries)).toThrow(
      `word "the": expected quant 255, got null`,
    );
  });

  it("bounds the probe loop on a fully-saturated (corrupt) table", () => {
    const { out, entries } = buildFixture();
    const s = sections(out);
    for (let i = 0; i < s.bucketCount; i++) {
      s.buf.writeUInt32LE(1, s.bucketsOff + 4 * i); // every slot → entry 0
    }
    writeFileSync(out, s.buf);
    // Every probe walks the full ring and misses; the trip counter must stop
    // it (a hang here would time the suite out instead of failing cleanly).
    expect(() => build.verify(out, entries)).toThrow(
      /expected quant 255, got null/,
    );
  });

  it("detects truncation (last 100 bytes sliced off)", () => {
    const { out, entries } = buildFixture();
    const buf = readFileSync(out);
    const short = `${out}.short`;
    writeFileSync(short, buf.subarray(0, buf.length - 100));
    expect(() => build.verify(short, entries)).toThrow(/truncated/);
  });

  it("detects a sub-header file", () => {
    const { out, entries } = buildFixture();
    const tiny = `${out}.tiny`;
    writeFileSync(tiny, Buffer.alloc(10));
    expect(() => build.verify(tiny, entries)).toThrow(/truncated header/);
  });

  it("detects header corruption (magic, version, seed, flags, bucketCount)", () => {
    const { out, entries } = buildFixture();
    const base = readFileSync(out);

    const magic = Buffer.from(base);
    magic[0] = 0x58; // "HAPX" → "XAPX"
    writeFileSync(out, magic);
    expect(() => build.verify(out, entries)).toThrow(/bad magic/);

    const ver = Buffer.from(base);
    ver.writeUInt16LE(2, 4);
    writeFileSync(out, ver);
    expect(() => build.verify(out, entries)).toThrow(/unsupported version 2/);

    const seed = Buffer.from(base);
    seed.writeUInt32LE(7, 20);
    writeFileSync(out, seed);
    expect(() => build.verify(out, entries)).toThrow(/seed 7 != 0/);

    const flags = Buffer.from(base);
    flags.writeUInt16LE(0, 6);
    writeFileSync(out, flags);
    expect(() => build.verify(out, entries)).toThrow(/flags/);

    const pow2 = Buffer.from(base);
    pow2.writeUInt32LE(12, 16);
    writeFileSync(out, pow2);
    expect(() => build.verify(out, entries)).toThrow(/power of two/);

    const small = Buffer.from(base);
    small.writeUInt32LE(2, 16); // power of two, but < 6 × 1.3
    writeFileSync(out, small);
    expect(() => build.verify(out, entries)).toThrow(/too small/);
  });

  it("rejects true duplicate keys at emit time (build-time assert path)", () => {
    const out = join(dir, "dups.bin");
    expect(() =>
      build.emit(out, [
        { word: "dup", count: 5, quant: 9 },
        { word: "dup", count: 7, quant: 3 },
      ]),
    ).toThrow(/duplicate key "dup"/);
  });

  it("rejects a duplicate-key entry list at verify time", () => {
    const { out } = buildFixture();
    expect(() =>
      build.verify(out, [
        { word: "the", quant: 255 },
        { word: "the", quant: 255 },
      ]),
    ).toThrow(/duplicate keys in entry list/);
  });
});