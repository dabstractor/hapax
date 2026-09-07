# hapax

Context-driven autocomplete extension for the pi coding agent — learns the
session's vocabulary and offers word completion. (Status: scaffolding.)

## Dictionary build

### What ships

`dict/common-en.bin` — a packed HAPX v1 binary (magic `HAPX`, version 1,
50,927 entries, ~1.2 MB). It is loaded at runtime by
`src/core/dictionary.ts` (`loadDictionary()`).

**Status: PROVISIONAL.** This artifact was generated from a local system word
list (`/usr/share/dict/cracklib-small`) with synthetic rank ordering (shorter
words rank higher; counts are positional, not corpus-derived). It does **not**
reflect real word frequencies and will be replaced by a corpus-derived build.

### Where real frequency TSVs come from

Corpus preparation is out of scope for this repo — the build script is
corpus-agnostic and accepts any unigram list. For a real build, source
`word<TAB>count` TSVs (UTF-8, one word per line, counts as plain integers)
from e.g.:

- [Google Books Ngrams](https://en.wikipedia.org/wiki/Google_Books_Ngram_Grammar)
  (English unigrams), or
- [`wordfreq`](https://github.com/rspeer/wordfreq)-derived per-language
  frequency lists.

Cross-check the list against an LLM tokenizer vocabulary (o200k / cl100k) so
tokenization frequency informs ranking: words the tokenizer splits should not
outrank common whole words.

### Rebuilding

```bash
node tools/build-dict.mjs --out dict/common-en.bin input1.tsv [input2.tsv ...]
```

Merge → filter (`^[a-z][a-z0-9_-]{1,31}$`) → sort by count desc → cap at
70,000 entries → quantize to u8 → emit. The script prints a per-section size
summary and self-verifies the written file; exit 0 with
`verified: N/N entries OK, no duplicate keys` means the artifact is safe to
commit.

Provisional fallback (regenerate the shipped artifact from a system word
list):

```bash
node tools/gen-provisional-tsv.mjs /usr/share/dict/words > /tmp/prov.tsv
node tools/build-dict.mjs --out dict/common-en.bin /tmp/prov.tsv
```

`gen-provisional-tsv.mjs` is stdlib-only and deterministic: same word list →
byte-identical TSV → byte-identical binary.

### Versioning contract

The format version lives in the file header (u16 at offset 4). The extension
requires an **exact match** and refuses mismatched files (notifies and
disables itself). Rules:

- Any regeneration with **different quantization or a different entry set
  MUST bump the version**.
- Same-format rebuilds that only refresh word data keep the current version
  (1).
- After changing the version in `src/core/dictionary.ts` (`DICT_VERSION`),
  regenerate and commit `dict/common-en.bin` in the same change.