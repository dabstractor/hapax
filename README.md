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

## Configuration

pi exposes no extension-settings API for extensions, so hapax reads a plain
JSON config file itself (`src/pi/config.ts`, `loadConfig()`). The surface is
deliberately tiny; all fields are optional and unknown keys are ignored
silently (forward compatibility):

| Field            | Type    | Default | Valid                                                   | Meaning                                        |
| ---------------- | ------- | ------- | ------------------------------------------------------- | ---------------------------------------------- |
| `triggerChar`    | string  | `"#"`   | one non-word, non-space character (`/^[^\w\s]$/`), or `""` to disable trigger mode entirely | prefix that opens the completion popup |
| `threshold`      | number  | `2`     | `1`–`3` (clamped)                                        | chars before threshold matching                 |
| `maxSuggestions` | number  | `8`     | `1`–`20` (clamped)                                       | cap on candidates offered at once               |
| `enablePhrases`  | boolean | `true`  | `true` / `false`                                         | phrase completions (M2); inert in M1 builds     |
| `debug`          | boolean | `false` | `true` / `false`                                         | enables the `/acwords` command + store dump     |

### File paths and precedence

Layers merge in order, later wins per key:

1. Built-in defaults (in code).
2. `~/.pi/agent/hapax.json` — user-global.
3. `.pi/hapax.json` — project-local; read **only when the project is
   trusted** (untrusted ⇒ ignored entirely, as if missing — the path is
   never touched).

Missing files are the normal case and stay silent. A malformed file (bad
JSON, or JSON that is not an object) is discarded as a whole with a single
`hapax: malformed <path>, using defaults` warning; the remaining layers
still apply. A present-but-invalid value is repaired to the previous
layer's value with one warning per repaired field; out-of-range numbers
are clamped into range without a warning. Booleans accept only real
booleans — no truthy coercion.

### Not configurable (by design)

Salience weights, admission bands (220/120), shape-gate rules, the eviction
cap, debounce intervals, and popup timing are internal tuning constants —
never user-configurable. If better values are learned, they ship as new
constants, not new config fields.

## Debug

Set `"debug": true` in `~/.pi/agent/hapax.json` (or `.pi/hapax.json`) and
hapax registers a `/acwords` command when the session starts. With the
default `debug: false` the command does not exist. `/acwords` is a
read-only tuning instrument (PRD §09): it dumps, via a popup
notification, what the ingest pipeline actually admitted this session:

- the candidate store size against the 20,000-entry cap and the current
  message ordinal;
- the rank-group histogram (rare / mid / common entry counts);
- the top 50 candidates by salience — display form, occurrence count
  (`×N`), and admission group;
- ingest counters: words seen, admitted, and per-rule shape-gate
  rejections (`tooShort`, `tooLong`, `lowEntropy`, `unigramRun`,
  `secret`, `consonantRun`).

The dump contains stored words and counters only — it never prints
message bodies. M2 will extend the dump with phrase and successor-index
sections.

## Development

### Dev loop (no build step)

pi loads hapax's TypeScript source directly through jiti — there is no
build step and no install copy to keep in sync. Point pi at the repo:

```bash
pi -e /home/dustin/projects/hapax
```

The `pi` manifest in `package.json`
(`"pi": { "extensions": ["./src/pi/index.ts"] }`) resolves the entry file.
Edit `src/**`, quit and relaunch pi (extensions load at startup), and the
new source is live.

Verified 2026-09-07 (P1.M3.T5.S2): `pi -e` starts with zero extension-load
errors; sending a message containing a distinctive word (`quokkatestword`)
and then typing `#quok` in the input box shows the hapax suggestion popup.

### jiti and the dictionary path

pi transpiles the extension with jiti 2.7.0 (TypeScript → CommonJS at load
time), where `import.meta` does not exist; native ESM hosts (vitest, a
future native-ESM pi) are the mirror case with no `__dirname`. The packed
dictionary is therefore resolved in `src/pi/paths.ts` (`resolveDictPath()`)
with the dual pattern:

```ts
const here = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
```

Never "simplify" this to `import.meta.url` only — it breaks under jiti.
`test/paths.test.ts` covers the native-ESM branch; the jiti branch is
exercised by every real `pi -e` load.

### Loading without the flag: global symlink vs project-local

To auto-load hapax with plain `pi` (no flags), symlink the repo into the
global extensions directory:

```bash
ln -s /home/dustin/projects/hapax ~/.pi/agent/extensions/hapax
```

A project-local copy/symlink (`.pi/extensions/hapax` inside a project)
also works, but project-local extension directories are trust-gated: pi
prompts on first load, and untrusted projects never load local extensions.
The `-e` flag and the global symlink bypass the prompt. Remove the symlink
if you don't want hapax in every session.

### Missing dictionary → graceful disable

If `dict/common-en.bin` is missing or corrupt, hapax degrades instead of
crashing: the first dictionary lookup fails, pi shows exactly one
`hapax: dictionary failed to load` error notify, and ingestion is disabled
permanently for that extension runtime — every later event degrades to a
no-op (no repeated toasts), while the empty provider stays registered so
pi's built-in completion is delegated, never hijacked. pi itself remains
fully functional. Restore the file and restart pi to re-enable hapax.
(For testing, the `HAPAX_DICT=/path/to/file.bin` environment variable
overrides the resolved path.)

### Checks

```bash
npm run check   # tsc --noEmit (strict)
npm test        # vitest --run
npm run bench   # PRD §09 perf-gate micro-benchmarks (synthetic fixtures; >3× budget regressions fail via the test/perf-gates.test.ts suite in `npm test`)
```

`pi --check` does not exist — these two gates are the definition of green.