#!/usr/bin/env node
/**
 * Provisional TSV generator — word list → `word<TAB>count` frequency file.
 *
 * HAPX needs a corpus-derived frequency table, but corpus preparation is out
 * of repo scope (PRD §03). This helper produces a PROVISIONAL substitute from
 * any plain word list (e.g. /usr/share/dict/cracklib-small): every surviving
 * word gets a synthetic count derived from its position, so the build's
 * rank-ordering step is deterministic. The resulting ranking reflects word
 * LENGTH and input order, not real corpus frequencies.
 *
 * Usage:
 *   node tools/gen-provisional-tsv.mjs <wordlist-path> [out.tsv]
 *
 * With no output path the TSV goes to stdout, enabling a pipe:
 *   node tools/gen-provisional-tsv.mjs /usr/share/dict/cracklib-small > /tmp/prov.tsv
 *
 * Stdlib-only (`node:fs`, `node:process`); runs on stock Node with no npm
 * dependencies. Output is fully deterministic for a given input file.
 */

import fs from "node:fs";
import process from "node:process";

const [listPath, outPath] = process.argv.slice(2);
if (!listPath) {
  console.error("usage: gen-provisional-tsv.mjs <wordlist> [out.tsv]");
  process.exit(1);
}

// Read the word list: one word per line. Strip a UTF-8 BOM and CR so DOS
// line endings / editor artifacts do not leak into keys.
const raw = fs.readFileSync(listPath, "utf8").replace(/^\uFEFF/, "");

// Lowercase BEFORE filtering: source lists contain proper nouns ("Aaron")
// that must collapse into their common-word form. Keep only keys the build
// pipeline accepts (same regex: ^[a-z][a-z0-9_-]{1,31}$) — filtering here is
// cosmetic; the build re-filters anyway.
const words = [
  ...new Set(
    raw
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => /^[a-z][a-z0-9_-]{1,31}$/.test(w)),
  ),
];

// Sort ascending by length, ties keeping input order (Array#sort is stable in
// V8). Short words rank higher — a crude but documented heuristic for common
// words like "a", "the", "of". Dedupe (above) happens BEFORE count
// assignment so duplicate entries cannot receive duplicate keys/ranks.
words.sort((a, b) => a.length - b.length);

// Synthetic strictly-decreasing counts: rank i gets words.length - i. No
// ties (would make ranking depend on the build's sort-stability details) and
// no non-integer values (the TSV parser expects plain integers).
const lines = words.map((w, i) => `${w}\t${words.length - i}`);
const tsv = lines.join("\n") + "\n";

if (outPath) {
  fs.writeFileSync(outPath, tsv);
} else {
  process.stdout.write(tsv);
}