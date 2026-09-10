#!/usr/bin/env node
/**
 * Calibration probe for score.ts admission bands (BUG-001, 001_9e0f97150b68).
 *
 * BUG-001: with the frozen log-quantization curve quant(r) = 255 −
 * floor(254·log2(1+r)/log2(1+DICT_N)) (denominator pinned at DICT_N = 70,000,
 * tools/build-dict.mjs), the old bands REJECT=220/MID=120 covered only ranks
 * ≤ 3 / ≤ 391 — "the"/"with"/"this" could never be rejected, no matter how
 * good the corpus. This script measures the REAL artifact so the band
 * constants in src/core/score.ts stay pinned by measurement, not guesswork:
 *
 *   1. artifact header + band populations (parsed straight from the scores
 *      section — 24-byte header + u32 offsets + u8 scores, HAPX v1);
 *   2. rank↔word↔q table at corpus probe ranks (TSV line order filtered
 *      through build-dict's KEY_RE — TSV line ≠ dictionary rank because the
 *      filter legally drops ~10 top entries like 'a'/'i'/"'s");
 *   3. the BUG-001 word set with its band under the CURRENT constants;
 *   4. a threshold sweep (dictionary-rank boundary per candidate constant);
 *   5. acceptance assertions — the/with/this/them AND the PRD's named
 *      example 'context' must reject, a tail word must stay group 1, and
 *      the band populations must stay near their calibration targets.
 *
 * Exit 0 = the constants in src/core/score.ts still satisfy the contract
 * (run it after any future retune or artifact regen). Exit 1 = drift.
 *
 * Usage: node tools/calibrate-bands.mjs
 * Requires Node ≥ 23.6 (native TS type stripping) — the repo's floor; the
 * type-only imports inside src/core/*.ts are erased, so the real loader and
 * admit() run directly (no duplication of the format or the banding logic).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadDictionary, DICT_VERSION } from "../src/core/dictionary.ts";
import {
  admit,
  MID_FREQ_THRESHOLD,
  REJECT_COMMON_THRESHOLD,
} from "../src/core/score.ts";
import { DICT_N, KEY_RE, quant } from "./build-dict.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dictPath = join(root, "dict", "common-en.bin");
const tsvPath = join(root, "tools", "corpus", "en-50k.tsv");

// ── 0. Word-probe mode: node tools/calibrate-bands.mjs <word...> ──────────
// The manual tuning dial for admission: print each word's dictionary q
// (null = absent → rarest, group 0) and its verdict under the CURRENT
// constants, then exit. Use it to pick a rejectCommonness value in
// ~/.pi/agent/hapax.json (or .pi/hapax.json): a word rejects when its
// q ≥ the configured band, so to drop "lists" (q=49) set
// rejectCommonness to 49 — and every word at or above it goes too.
const words = process.argv.slice(2);
if (words.length > 0) {
  const dict = loadDictionary(dictPath);
  const draft = (key) => ({
    key,
    display: key,
    properName: false,
    isSubword: false,
  });
  console.log(`word → q → verdict under REJECT=${REJECT_COMMON_THRESHOLD}, MID=${MID_FREQ_THRESHOLD} (lc | Cap)`);
  const capDraft = (key) => ({
    key,
    display: key[0].toUpperCase() + key.slice(1),
    properName: true,
    isSubword: false,
  });
  for (const w of words) {
    const lower = w.toLowerCase();
    const q = dict.lookup(lower);
    const verdict = admit(draft(lower), dict);
    const cap = admit(capDraft(lower), dict);
    const qText = q === null ? "absent" : String(q);
    const fmt = (v) => (v === "reject" ? "REJECT" : `g${v}`);
    console.log(
      `  ${w.padEnd(16)} q=${qText.padEnd(6)} ${fmt(verdict).padEnd(6)} | Cap: ${fmt(cap)}`,
    );
  }
  process.exit(0);
}

// ── 1. Artifact header + raw band populations ──────────────────────────────
const buf = readFileSync(dictPath);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.length);
if (buf.readUInt16LE(4) !== DICT_VERSION) {
  console.error(`artifact version ${buf.readUInt16LE(4)} ≠ DICT_VERSION — regenerate first`);
  process.exit(1);
}
const entryCount = buf.readUInt32LE(8);
const blobLen = buf.readUInt32LE(12);
const bucketCount = buf.readUInt32LE(16);
const scoresOff = 24 + blobLen + 4 * (entryCount + 1);
if (scoresOff + entryCount + 4 * bucketCount > buf.length) {
  console.error("artifact truncated — regenerate first");
  process.exit(1);
}
// scores are u8[entryCount]; entry i carries quant(dictionary rank i).
const scores = buf.subarray(scoresOff, scoresOff + entryCount);
const popReject = (T) => scores.reduce((n, q) => n + (q >= T ? 1 : 0), 0);
const popBand2 = (M, R) =>
  scores.reduce((n, q) => n + (q >= M && q < R ? 1 : 0), 0);

console.log(
  `artifact  dict/common-en.bin  v${buf.readUInt16LE(4)}  entries=${entryCount}  ` +
    `blob=${blobLen}B  buckets=${bucketCount}`,
);
console.log(
  `constants REJECT_COMMON_THRESHOLD=${REJECT_COMMON_THRESHOLD}  ` +
    `MID_FREQ_THRESHOLD=${MID_FREQ_THRESHOLD}  (curve denominator DICT_N=${DICT_N})\n`,
);
console.log(
  `band populations: reject(q≥${REJECT_COMMON_THRESHOLD})=${popReject(REJECT_COMMON_THRESHOLD)}  ` +
    `group2(${MID_FREQ_THRESHOLD}≤q<${REJECT_COMMON_THRESHOLD})=${popBand2(MID_FREQ_THRESHOLD, REJECT_COMMON_THRESHOLD)}  ` +
    `group1(q<${MID_FREQ_THRESHOLD}, attested)=${popBand2(0, MID_FREQ_THRESHOLD)}`,
);

// ── 2. rank↔word↔q table at corpus probe ranks ─────────────────────────────
// The k-th TSV line matching KEY_RE is dictionary rank k (build-dict sorts by
// count DESC; en_50k.tsv arrives pre-sorted with distinct counts, so line
// order is rank order after the filter drops 'a'/'i'/"'s"-style keys).
const dict = loadDictionary(dictPath);
const probeRanks = new Set([100, 500, 1000, 2000, 5000, 10000, 20000, 40000]);
const lines = readFileSync(tsvPath, "utf8").split("\n");
const rankWord = []; // rankWord[k] = word at dictionary rank k (kept order)
for (const line of lines) {
  const tab = line.indexOf("\t");
  if (tab <= 0) continue;
  const word = line.slice(0, tab);
  if (KEY_RE.test(word)) rankWord.push(word);
}
console.log(`\nrank → word → q  (quant(r) predicted vs artifact lookup):`);
for (const k of [...probeRanks].sort((a, b) => a - b)) {
  const word = rankWord[k];
  const q = dict.lookup(word);
  console.log(
    `  ${String(k).padStart(6)}  ${word.padEnd(12)} q=${String(q).padStart(3)}  (quant=${quant(k)})`,
  );
}

// ── 3. BUG-001 word set under the current constants ────────────────────────
const draft = (key) => ({
  key,
  display: key,
  properName: false,
  isSubword: false,
});
const band = (result) => (result === "reject" ? "REJECT" : `group ${result}`);
console.log(`\nBUG-001 word set (admit() vs shipped artifact):`);
for (const w of [
  "the", "of", "and", "to", "in", "that", "is", "was", "it", "for", "with",
  "as", "his", "on", "be", "at", "by", "this", "had", "not", "are", "but",
  "from", "have", "they", "context", "because", "would", "them", "first",
  "time", "people", "world", "work", "system", "data", "code",
]) {
  const q = dict.lookup(w);
  const result = admit(draft(w), dict);
  console.log(`  ${w.padEnd(10)} q=${String(q).padStart(3)}  → ${band(result)}`);
}

// ── 4. Threshold sweep — dictionary-rank boundary per candidate constant ───
console.log(`\nthreshold sweep (max dictionary rank covered by q ≥ T):`);
for (let T = 15; T <= 255; T += 5) {
  const boundary = popReject(T); // q = quant(rank) is non-increasing, so the
  // population of q ≥ T IS the boundary rank (0-based count of covered ranks).
  console.log(
    `  T=${String(T).padStart(3)}  → top ${String(boundary).padStart(6)} ranks` +
      (T === REJECT_COMMON_THRESHOLD ? "  ← REJECT" : T === MID_FREQ_THRESHOLD ? "  ← MID" : ""),
  );
}

// ── 5. Acceptance assertions (BUG-001 inverted) ─────────────────────────────
let failures = 0;
const check = (ok, label) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
};
console.log(`\nacceptance (constants vs shipped artifact):`);
for (const w of ["the", "with", "this", "them"]) {
  check(admit(draft(w), dict) === "reject", `admit('${w}') rejects`);
}
// The 2026-09 FINAL retighten: dictionary attestation is near-disqualifying
// (REJECT=12) — everyday prose rejects across the board, not just the
// top band. Assert the named examples plus former mid-band residents
// (provider/null-class words were the live-audit leak).
for (const w of ["context", "because", "would", "data", "code", "provider", "null", "node"]) {
  const r = admit(draft(w), dict);
  check(r === "reject", `admit('${w}') rejects (${band(r)})`);
}
check(
  admit(draft("hapax"), dict) === 0,
  "dictionary-absent word stays group 0",
);
// Rank 40000 (q≈14) rejects under the final band; the admitting tail is
// roughly ranks ≥ 43,500 — pin a genuinely rare word instead.
const tailWord = rankWord[47000];
const tailVerdict = admit(draft(tailWord), dict);
check(
  tailVerdict === 1 || tailVerdict === "reject",
  `rarest-tail word '${tailWord}' (rank 47000) admits at group 1 or rejects near the boundary (got ${band(tailVerdict)})`,
);
const rejectPop = popReject(REJECT_COMMON_THRESHOLD);
check(
  rejectPop >= 40000 && rejectPop <= 47000,
  `reject band covers the attested bulk, ~top 43.5k ranks (measured ${rejectPop})`,
);
// 2026-09: table group 2 is RETIRED — with REJECT=12 nothing attests into
// [MID, REJECT). Pin its emptiness so a future band change is deliberate.
const group2Pop = popBand2(MID_FREQ_THRESHOLD, REJECT_COMMON_THRESHOLD);
check(
  group2Pop === 0,
  `group-2 band is empty (retired; measured ${group2Pop})`,
);
let monotone = true;
for (let i = 1; i < 500; i++) {
  if (dict.lookup(rankWord[i]) > dict.lookup(rankWord[i - 1])) monotone = false;
}
check(monotone, "artifact q is non-increasing over the top 500 ranks");

if (failures > 0) {
  console.error(`\ncalibration DRIFT: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\ncalibration OK — constants match the shipped artifact");