# PRP — P1.M1.T3.S3: Shipped dict artifact + corpus acquisition documentation

---

## Goal

**Feature Goal**: Make M1 a "fully usable tool" (PRD §02 h2.56) by shipping a
committed, verified `dict/common-en.bin` and a README section **"Dictionary
build"** that lets any operator reproduce the artifact: where frequency TSVs
come from, the exact rebuild command, and the versioning contract.

Because corpus preparation is explicitly **out of repo scope** (PRD §03
h2.20), this task produces a **PROVISIONAL** dictionary when no
operator-provided frequency TSVs exist: derived from a local system word list
(e.g. `/usr/share/dict/cracklib-small`, ~54k lowercase words) with synthetic
rank ordering, clearly labeled PROVISIONAL in the README. The point is that
integration acceptance (P1.M4.T1.S1) exercises the real loader against a real
committed binary, not a test fixture.

**Deliverable**:
1. `dict/common-en.bin` committed to the repo (~1 MB, version 1, verified by
   the build script's step-7 self-verification).
2. `README.md` gains a "Dictionary build" section (Mode A — docs ride with the
   work).
3. Optional helper `tools/gen-provisional-tsv.mjs` (stdlib-only) that converts
   a plain word list into a synthetic-count TSV — this makes the README
   instructions actually executable end-to-end.

**Success Definition**: `git status` shows `dict/common-en.bin` staged;
`node tools/build-dict.mjs --out dict/common-en.bin <tsv...>` (as documented)
exits 0 with `verified: N/N entries OK`; `src/core/dictionary.ts`
`loadDictionary("dict/common-en.bin")` succeeds and `lookup("the")` (or a
word present in the source list) returns a non-null quant; README section
reproduces the build from a fresh clone (modulo the word-list/TSV input).

## Why

- The loader (P1.M1.T2) and everything downstream (shape gate bands 220/120,
  admission, query) need a real table at runtime; M1 acceptance items require
  the extension to load a shipped dictionary, not fabricate one.
- The PRD's versioning contract (h2.21) must be *documented where operators
  will look* before anyone regenerates the file with different quantization.
- A committed artifact removes a chicken-and-egg problem for P1.M3.T5
  (extension lifecycle: lazy dict load, disable-on-bad-dict) and P1.M4.T1.S1
  (integration acceptance).

## What

### Part 1 — Generate and commit the provisional artifact

1. Locate a local word list: prefer `/usr/share/dict/words`; on this machine
   only `/usr/share/dict/cracklib-small` (54,763 lines) exists — use it.
   Accept `--list <path>` argument in the helper so operators can point at
   any word list.
2. Create `tools/gen-provisional-tsv.mjs` (stdlib-only, `node:` imports):
   - read the word list, one word per line;
   - lowercase each; keep only lines matching `^[a-z][a-z0-9_-]{1,31}$`
     (same regex as the build pipeline — filtering here is cosmetic; the
     build re-filters);
   - emit `word<TAB>count` with **synthetic descending counts**:
     `count = lines - i` for line index `i` (any strictly decreasing scheme
     works — rank order is all the build uses after sorting; the synthetic
     counts must simply preserve the list's order deterministically);
   - to bias toward realistic ranking, sort input by ascending word length
     first if the source list is alphabetically ordered (short common words
     rank higher) — simple heuristic, documented as provisional;
   - write to stdout (`process.stdout.write`) so the README command can be a
     pipe: `node tools/gen-provisional-tsv.mjs /usr/share/dict/cracklib-small > /tmp/prov.tsv`.
3. Build the artifact:
   `node tools/build-dict.mjs --out dict/common-en.bin /tmp/prov.tsv`
   (depends on S1/S2's script; treat their PRPs as contract — assume exit 0
   with `verified: N/N entries OK, no duplicate keys`).
4. Cross-check with the production loader (one-off script, not committed —
   or as a tiny vitest case, see tasks): `loadDictionary` succeeds,
   `lookup("the")` and `lookup("hapax"?)` behave as expected (`the` is in
   cracklib-small; absent words return null).
5. `git add dict/common-en.bin` — this is a shipped binary; it is expected
   and intentional (do NOT gitignore it).

### Part 2 — README "Dictionary build" section

Add a `## Dictionary build` section to `README.md` covering:

1. **What ships**: `dict/common-en.bin`, format v1, ~N entries, ~1.2 MB;
   loader is `src/core/dictionary.ts`. Status: **PROVISIONAL** — generated
   from a local system word list with synthetic rank ordering; ranking does
   not reflect real corpus frequencies; will be replaced by a corpus-derived
   build.
2. **Where real TSVs come from**: unigram frequency lists in the style of
   Google Books Ngrams (English unigrams) or `wordfreq`-derived lists,
   cross-checked against an LLM tokenizer vocab (o200k / cl100k) so
   tokenization frequency informs ranking (per PRD §03 h2.20). Format:
   `word<TAB>count`, UTF-8, one per line. Corpus prep is out of scope for
   this repo; the build script is corpus-agnostic.
3. **Exact rebuild command**:
   ```bash
   node tools/build-dict.mjs --out dict/common-en.bin input1.tsv [input2.tsv ...]
   ```
   plus the provisional fallback:
   ```bash
   node tools/gen-provisional-tsv.mjs /usr/share/dict/words > /tmp/prov.tsv
   node tools/build-dict.mjs --out dict/common-en.bin /tmp/prov.tsv
   ```
   Build prints a per-section size summary and self-verifies (exit 0 =
   safe to commit).
4. **Versioning contract** (mirrors PRD h2.21, operator-facing wording):
   the version lives in the file header (u16 at offset 4); the extension
   requires an exact match in M1. **Any regeneration with different
   quantization or different entry set MUST bump the version**, and the
   extension refuses mismatched files (notify + disable). Same-format
   provisional rebuilds that only refresh word data keep version 1.

### Success Criteria

- [ ] `dict/common-en.bin` exists in the repo, loads via
      `loadDictionary`, version 1, entryCount > 50,000
- [ ] Build script self-verification passed for the committed bytes (rebuild
      from documented command reproduces a byte-identical or at least
      verified-equivalent file — note: byte-identical is expected given the
      deterministic pipeline: same TSV → same file)
- [ ] `tools/gen-provisional-tsv.mjs` runs on stock Node, stdlib-only,
      produces valid TSV the build accepts
- [ ] README "Dictionary build" section covers: shipped-artifact status
      (PROVISIONAL), real-TSV sources, exact rebuild command, versioning
      contract
- [ ] `npx vitest --run` fully green (existing suites untouched)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this
successfully?" — Yes: the build CLI contract, binary format, loader
interface, word-list source on this machine, and README placement are all
specified below. The dependency (S1/S2 build script) is specified by its own
PRP, treated as a contract.

### Documentation & References

```yaml
- file: plan/001_88fc3a66fd74/P1M1T3S1/PRP.md
  why: CONTRACT for tools/build-dict.mjs CLI: `node tools/build-dict.mjs
        --out <path> in.tsv [in2.tsv ...]`; merge → filter ^[a-z][a-z0-9_-]{1,31}$
        → sort desc → top 70k → quantize → lexicographic sort → emit → summary.
  critical: filter regex and N=70_000 cap are pinned there; cracklib-small has
        ~54k usable keys, all fit under the cap.

- file: plan/001_88fc3a66fd74/P1M1T3S2/PRP.md
  why: CONTRACT for the self-verification pass — exit 0 + `verified: N/N
        entries OK` is the green light to commit the artifact.
  critical: do NOT modify build-dict.mjs in this task; it is owned by S1/S2.

- file: src/core/dictionary.ts
  why: production loader — use for the cross-check; DICT_VERSION constant and
        exact-match version check implement the refusal half of the versioning
        contract (README documents the bump half).
  gotcha: header version ≠ DICT_VERSION throws at load ("unsupported
        version") — the README wording must match this behavior.

- file: test/dictionary.test.ts + test/helpers/dict-writer.ts
  why: vitest conventions if you add a small shipped-artifact test; also the
        independent writer for format reference.

- url: https://en.wikipedia.org/wiki/Google_Books_Ngram_Grammar
  why: Google Books unigram corpus — README's example real-TSV source.
- url: https://github.com/rspeer/wordfreq
  why: wordfreq package — realistic word frequency lists per language; README
        reference for future real builds.

- system: /usr/share/dict/cracklib-small (54,763 lines) exists on this
        machine; /usr/share/dict/words does NOT. Helper must take the list
        path as an argument.
```

### Current Codebase tree (relevant)

```bash
README.md                     # stub ("Status: scaffolding") — extend
tools/build-dict.mjs          # per S1/S2 PRPs (may be mid-implementation)
src/core/dictionary.ts        # loader (complete)
src/core/types.ts
test/                         # dictionary.test.ts, smoke.test.ts, types.test.ts
dict/                         # empty — output dir
```

### Desired Codebase tree

```bash
dict/common-en.bin            # NEW — committed provisional artifact (~1.2 MB)
tools/gen-provisional-tsv.mjs # NEW — word list → synthetic TSV (stdlib-only)
README.md                     # MODIFIED — add "## Dictionary build" section
test/shipped-dict.test.ts     # NEW (small) — shipped artifact loads & spot-checks
```

### Known Gotchas of our codebase & Library Quirks

```js
// CRITICAL: do NOT modify tools/build-dict.mjs — S2 is being implemented in
// parallel; this task only CONSUMES it.

// GOTCHA: cracklib-small contains proper nouns/capitalized entries — the
// helper must lowercase BEFORE the regex filter, and the build pipeline
// lowercases keys on merge anyway (contract), so results are consistent.

// GOTCHA: counts must be integers the TSV reader accepts (S1 parses with
// Number/parseInt — emit plain integers, no scientific notation).

// GOTCHA: the build sorts by count DESC — synthetic counts must be strictly
// decreasing to make the ranking deterministic (ties would fall back to
// whatever S1's stable sort does; avoid ties).

// GOTCHA: committing a binary: ensure `git add dict/common-en.bin` succeeds;
// repo has no .gitignore entry excluding dict/ — if one appears, it is wrong
// for this file (never gitignore the shipped dict).

// GOTCHA: README is currently a stub; append the new section, keep existing
// title/intro. Version 1 in the file header must stay 1 for the provisional
// build (quantization formula unchanged → no bump required).
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: CREATE tools/gen-provisional-tsv.mjs
  - CLI: `node tools/gen-provisional-tsv.mjs <wordlist-path>`
    (optional second arg: output path, default stdout).
  - IMPLEMENT: read file, split lines, lowercase, filter
    /^[a-z][a-z0-9_-]{1,31}$/, stable-sort ascending by length (ties keep
    input order), emit `${word}\t${count}` with count = N - i.
  - NAMING/PLACEMENT: kebab-case .mjs in tools/, mirroring build-dict.mjs;
    stdlib-only (`node:fs`, `node:process`).
  - GOTCHA: strip BOM/CR (split on /\r?\n/, trim each line).

Task 2: GENERATE dict/common-en.bin
  - RUN: node tools/gen-provisional-tsv.mjs /usr/share/dict/cracklib-small > /tmp/prov.tsv
         node tools/build-dict.mjs --out dict/common-en.bin /tmp/prov.tsv
  - VERIFY: exit 0, "verified: N/N entries OK, no duplicate keys", size
    summary ~1.2 MB total, bucketCount = next pow2 ≥ 1.3×N.
  - COMMIT: git add dict/common-en.bin (do not gitignore).

Task 3: CREATE test/shipped-dict.test.ts (small)
  - FOLLOW pattern: test/dictionary.test.ts (describe/it, expect).
  - CASES:
    1. loadDictionary("dict/common-en.bin") (resolve path relative to repo
       root via `new URL("../dict/common-en.bin", import.meta.url)`) succeeds;
       version === 1; entryCount > 50_000.
    2. spot-check: a handful of common words (e.g. "the", "and", "word" if
       present in the source list — verify first!) return non-null quants;
       one nonsense word absent from the list (e.g. "qqqqzzzz") returns null.
    3. entryCount reported by loader matches the build summary N.
  - GOTCHA: this test makes the artifact load-bearing — it will catch an
    accidental deletion or a version bump without regeneration.

Task 4: UPDATE README.md — add "## Dictionary build" section
  - CONTENT per "What" Part 2 (four subsections: shipped artifact + PROVISIONAL
    status; real TSV sources with Google Books / wordfreq URLs + tokenizer
    cross-check note; exact rebuild commands incl. provisional fallback;
    versioning contract with bump rule and extension-refusal behavior).
  - PLACEMENT: after the existing intro paragraph, before any future
    sections; keep tone terse and operator-facing.

Task 5: RUN validation loop; ensure git shows only intended changes:
  dict/common-en.bin (new), tools/gen-provisional-tsv.mjs (new),
  test/shipped-dict.test.ts (new), README.md (modified).
```

### Implementation Patterns & Key Details

```js
// tools/gen-provisional-tsv.mjs — core loop (complete sketch):
import fs from "node:fs";
const [listPath, outPath] = process.argv.slice(2);
if (!listPath) { console.error("usage: gen-provisional-tsv.mjs <wordlist> [out.tsv]"); process.exit(1); }
const raw = fs.readFileSync(listPath, "utf8");
const words = [...new Set(
  raw.split(/\r?\n/).map(w => w.trim().toLowerCase())
     .filter(w => /^[a-z][a-z0-9_-]{1,31}$/.test(w))
)];
words.sort((a, b) => a.length - b.length); // stable in V8: preserves input order on ties
const lines = words.map((w, i) => `${w}\t${words.length - i}`); // strictly decreasing
const tsv = lines.join("\n") + "\n";
outPath ? fs.writeFileSync(outPath, tsv) : process.stdout.write(tsv);
// GOTCHA: dedupe with Set BEFORE assigning counts (duplicate words would
// otherwise produce duplicate keys — build-time merge handles it, but dedupe
// keeps rank assignment clean).
```

### Integration Points

```yaml
REPO:
  - git: commit dict/common-en.bin (binary, ~1.2 MB — acceptable; PRD expects
    it shipped with the extension)
DOCS:
  - README.md: new "## Dictionary build" section (Mode A — rides with work)
DOWNSTREAM CONSUMERS:
  - P1.M3.T5.S1 (lazy dict load, disable-on-bad-dict) loads this exact file
  - P1.M4.T1.S1 (integration acceptance) requires it present and loadable
NO config / package.json changes required (a "build:dict" script may already
  exist from S1 — leave as is; optionally add "build:dict:prov" only if it
  does not conflict).
```

## Validation Loop

### Level 1: Syntax

```bash
node --check tools/gen-provisional-tsv.mjs
npx tsc --noEmit        # test/shipped-dict.test.ts type-checks
```

### Level 2: Tests

```bash
npx vitest --run test/shipped-dict.test.ts -v
npx vitest --run        # full suite green
```

### Level 3: End-to-end rebuild (the README instructions, executed)

```bash
node tools/gen-provisional-tsv.mjs /usr/share/dict/cracklib-small > /tmp/prov.tsv
head -3 /tmp/prov.tsv          # word<TAB>count, descending counts
wc -l /tmp/prov.tsv            # ~50k+ lines
node tools/build-dict.mjs --out /tmp/rebuilt.bin /tmp/prov.tsv   # exit 0, verified N/N
cmp /tmp/rebuilt.bin dict/common-en.bin && echo "byte-identical rebuild OK"
node -e 'const {loadDictionary}=await import("./src/core/dictionary.ts");'  # or via vitest
ls -la dict/common-en.bin       # ~1.2 MB
git status --short              # shows dict/common-en.bin, tools/..., test/..., README.md
```

### Level 4: Documentation review

```bash
# Read the rendered README section; confirm a fresh-clone operator could:
#  1. find where TSVs come from (with URLs),
#  2. run the exact rebuild command,
#  3. know when to bump the version.
```

## Final Validation Checklist

### Technical

- [ ] `node --check` clean; `npx tsc --noEmit` clean; `npx vitest --run` green
- [ ] `tools/gen-provisional-tsv.mjs` stdlib-only, deterministic
- [ ] Rebuild from documented command is byte-identical to committed artifact

### Feature

- [ ] `dict/common-en.bin` committed, loads, version 1, entryCount > 50,000
- [ ] Spot-check lookups: present word → quant; absent word → null
- [ ] README "Dictionary build" section: PROVISIONAL status, TSV sources
      (Google Books / wordfreq URLs, tokenizer cross-check), exact rebuild
      commands, versioning contract (bump-on-regen, extension refuses
      mismatched files)

### Code Quality

- [ ] Only the four intended files touched; build-dict.mjs untouched
      (S2 owns it, running in parallel)
- [ ] README terse, operator-facing, no marketing copy
- [ ] Committed binary not gitignored

## Anti-Patterns to Avoid

- ❌ Modifying `tools/build-dict.mjs` (parallel S2 owns it — consume only)
- ❌ Shipping the artifact without the self-verification green light
- ❌ Pretending the provisional build is corpus-derived — README must say
      PROVISIONAL and explain what synthetic ranking means
- ❌ Omitting the versioning contract from the README (the PRD's refusal
      behavior depends on operators knowing the bump rule)
- ❌ Ties or non-integer synthetic counts (breaks deterministic ranking)
- [ ] ❌ Adding npm dependencies or TS toolchain requirements to the .mjs helper