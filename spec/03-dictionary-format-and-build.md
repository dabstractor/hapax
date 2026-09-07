# 03 — Dictionary Format and Build

## Purpose

The dictionary answers one question: **is this word common?** It maps lowercase
words to an 8-bit quantized frequency. Presence = commonness evidence.
Absence = rare-by-default (subject to the shape gate, see 04).

The table is **not** a stoplist: mid-frequency words are admitted at low
priority. It is the "known-common" orientation — rarity is the default, and we
only certify commonness.

## Packed binary format (`dict/common-en.bin`)

All integers little-endian.

```
Offset  Size        Field
0       4           magic: ASCII "HAPX"
4       2           version: u16 = 1
6       2           flags: u16 (bit 0 = keys are lowercase; set)
8       4           entryCount: u32
12      4           blobLen: u32  (total bytes of wordBlob)
16      4           bucketCount: u32 (power of two, >= entryCount * 1.3)
20      4           seed: u32 (hash seed, currently 0)
24      blobLen     wordBlob: concatenated UTF-8 lowercase words, no separators
24+blobLen          offsets: u32[entryCount + 1]
                    entry i spans wordBlob[offsets[i], offsets[i+1])
                    offsets are relative to wordBlob start; NUL-free words
+entryCount+1 u32   scores: u8[entryCount]
                    quantized frequency: 255 = most common, 0 = least
                    common word that made the cutoff
+entryCount u8      buckets: u32[bucketCount]
                    value = entry index + 1; 0 = empty slot
```

Expected size for 70k entries, avg 7 bytes/word:
420 KB blob + 280 KB offsets + 70 KB scores + 512 KB buckets (128k buckets) ≈
**1.3 MB**.

## Hash and probing

- Hash: **FNV-1a 32-bit** over the word's UTF-8 bytes, XOR-folded with `seed`.
- Bucket index: `hash & (bucketCount - 1)`.
- Probing: linear. On collision, compare `memcmp(word, blob+offsets[idx], len)`
  plus exact length match. Insert until empty bucket (table is pre-sized, no
  runtime inserts).
- Lookup is one hash + ~1.1 probes average (load factor ≤ 0.55): ~100 ns.

## Loader contract (`src/core/dictionary.ts`)

```ts
export interface Dictionary {
  /** Returns quantized frequency 0–255, or `null` when absent. */
  lookup(word: string): number | null;
  readonly version: number;
  readonly entryCount: number;
}

export function loadDictionary(path: string): Dictionary;
```

- Parse: read file once (`fs.readFileSync`), validate magic/version, create
  `Uint8Array`/`Uint32Array` views over the buffer (no per-entry allocation).
  `Buffer` retained as the single backing allocation; dictionary total heap
  footprint = file size.
- `lookup()` must not allocate: encode candidate word to a reused scratch
  buffer (words are ≤ 64 bytes; reject longer before lookup).
- Invalid magic/version: throw at load; the extension surfaces a notify and
  disables itself rather than running with a bad table.

## Build pipeline (`tools/build-dict.mjs`)

Inputs: one or more TSV files `word<TAB>count` (frequency lists derived from a
large mixed web + code corpus; e.g. unigram lists in the style of
Google Books / wordfreq data cross-checked against an LLM tokenizer vocab such
as o200k/cl100k so that tokenization-frequency informs the ranking). The build
script is corpus-agnostic: it consumes TSVs; corpus preparation is out of scope
for this repo.

Steps:

1. Merge TSVs, summing counts per lowercase key.
2. Filter keys matching `^[a-z][a-z0-9_-]{1,31}$`; drop pure digits.
3. Sort by count descending; keep top `N = 70_000`.
4. Quantize frequency to 8 bits by rank:
   `quant = 255 - floor(254 * log2(1 + rank) / log2(1 + N))`
   (rank 0 → 255; rank N-1 → 1; monotonic, log-scaled so mid-frequency words
   spread across the useful range).
5. Sort entries lexicographically for cache-friendly blob locality.
6. Emit the packed file per the format above; choose `bucketCount` = next
   power of two ≥ 1.3 × N; build buckets via FNV-1a insertion.
7. Print a size summary and verify: load the output file, re-look up every
   entry, assert `lookup(w) === quant`, assert no duplicate keys.

CLI: `node tools/build-dict.mjs --out dict/common-en.bin input1.tsv [input2.tsv ...]`

## Versioning contract

- Dictionary version lives in the file header. The extension requires the
  version it was built for (exact match in M1).
- Because candidate scores embed quantized frequency, any future dictionary
  regen with different quantization bumps `version`; the extension refuses
  mismatched files. Per-language tables (future) ship as separate files
  (`common-de.bin`, …) selected by config; format unchanged.