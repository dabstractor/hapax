# PRP — P1.M1.T1.S1 (bugfix 001_9e0f97150b68): Vendor FrequencyWords en_50k corpus as build input

---

## Goal

**Feature Goal**: Vendor a real English frequency corpus (hermitdave/FrequencyWords
2018 `en_50k.txt`, RAW non-lemmatized) into the repo as `tools/corpus/en-50k.tsv`
— TAB-separated, provenance-documented, sanity-asserted — so P1.M1.T1.S2 can
regenerate `dict/common-en.bin` with rank ordering that actually reflects word
frequency (BUG-001 fix input).

**Deliverable**:
- `tools/corpus/en-50k.tsv` — 50,000 lines, `word<TAB>count`, line order = rank
- `tools/corpus/README.md` — provenance: source URL, license, retrieval
  date/command, conversion note
- Optionally `tools/vendor-corpus.mjs` (download+convert+assert script) so the
  vendor step is reproducible — see Task list; a documented one-liner is also
  acceptable

**Success Definition**: `node tools/build-dict.mjs --out /tmp/test.bin
tools/corpus/en-50k.tsv` succeeds with `verified: N/N entries OK` and the
committed TSV passes the sanity assertions (top-100 membership of
the/with/this, head contains the/you/i/to/a).

## Why

BUG-001 (Critical): today's `dict/common-en.bin` was built from a LENGTH-sorted
system word list (`tools/gen-provisional-tsv.mjs`), so its rank ordering is
unrelated to frequency. Every common English word (the, with, this, them, …)
lands in rank-group-1 "rare" with the rarity bonus and pops completion menus
during ordinary prose — defeating the PRD's #1 no-hijack invariant. This task
supplies the real corpus; the artifact rebuild itself is P1.M1.T1.S2 and band
recalibration is P1.M1.T2. **This task changes NO code behavior** — it only
adds vendored data + documentation.

## What

1. Download `en_50k.txt` once from the verified URL.
2. Convert SPACE-separated `word count` lines to TAB-separated TSV.
3. Commit at `tools/corpus/en-50k.tsv` with `tools/corpus/README.md` provenance.
4. Sanity assertions must pass (documented or scripted):
   - Head (first ~10 lines) contains the/you/i/to/a
   - `the`, `with`, `this` each appear within the first 100 lines
   - Every line matches `^[a-z][a-z0-9_-]{1,31}$` OR is acknowledged as
     filtered at build time by build-dict's existing KEY_RE (lines like
     `'t`, `don`'t fragments, punctuation forms WILL exist and are fine —
     build-dict filters them; do NOT pre-filter the TSV)
5. Use the RAW list, NOT the lemmatized (`qaredux`) variant.

### Success Criteria

- [ ] `tools/corpus/en-50k.tsv` exists, 50,000 lines, TAB-separated
- [ ] `tools/corpus/README.md` records source URL, license (repo MIT; data from
      OpenSubtitles 2018), retrieval date, retrieval command, conversion step
- [ ] Sanity assertions pass (the/with/this in top 100; head has the/you/i/to/a)
- [ ] `node tools/build-dict.mjs --out /tmp/hapax-test.bin tools/corpus/en-50k.tsv`
      exits 0 with verified N/N (smoke-proves consumability; delete /tmp output)
- [ ] `tools/build-dict.mjs`, `src/**`, `test/**` untouched
- [ ] No new runtime or dev dependencies

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: this PRP includes the exact
URL, verified format samples, the consuming script's TSV contract, the
sanity gate, and the license/provenance requirements.

### Documentation & References

```yaml
- url: https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
  why: Primary corpus. VERIFIED: HTTP 200, 50,000 lines, "word count" SPACE-separated,
       descending frequency — line order = rank. Actual first lines:
       "you 28787591", "i 27086016"..."i 27086016"... precisely:
       you/i/the/to/a are lines 1–5; line 10 is "'t 9628970" (KEY_RE-filtered at build, fine);
       line 100 is "some 1166914".
  critical: RAW list only — do NOT use the lemmatized qaredux variant (surface-form
       lookups would miss inflected forms → they'd fall to rank-group-0 "rare").
  license: Repo MIT (verify LICENSE file in the GitHub repo at vendor time; record in README).
       Underlying data: OpenSubtitles 2018 (dialogue register — you/i rank above "the",
       which is fine: the/with/this still well inside top 100).

- file: tools/build-dict.mjs
  why: The CONSUMER of the TSV. Do not modify it. Its contract:
       mergeTsv() reads "word<TAB>count", sums counts across files/duplicate keys;
       step "filter keys against KEY_RE" drops non-matching lines;
       sorts count-DESC; slices to DICT_N=70_000; quantizes by rank.
  pattern: KEY_RE = /^[a-z][a-z0-9_-]{1,31}$/ (line 39); DICT_N = 70_000 (line 34)
  gotcha: mergeTsv expects TAB separators — the raw corpus is SPACE-separated;
       conversion is mandatory. A one-off `tr ' ' '\t'` (or a tiny node script) suffices.

- docfile: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/architecture/external_deps.md
  section: "1. Frequency corpus (BUG-001) — vendoring target"
  why: Research lane's verified vendoring notes (URL, format, license, sanity gate,
       fallback option). Also §2 explains why band recalibration (later task) keeps
       this corpus as the calibration target.

- fallback: Norvig count_1w.txt — https://norvig.com/ngrams/count_1w.txt
  why: Already TAB-separated, written-corpus register; slice to top ~60k during
       vendor. Use ONLY if the primary fails license/sanity verification.
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── .gitignore            # does NOT ignore tools/ or *.tsv → corpus is committable
├── dict/
│   └── common-en.bin     # MIS-CALIBRATED artifact; regenerated in P1.M1.T1.S2 (NOT here)
├── tools/
│   ├── build-dict.mjs    # TSV consumer (DO NOT MODIFY)
│   ├── gen-provisional-tsv.mjs   # the length-sorted generator that caused BUG-001
│   └── gen-large-session.mjs
└── test/ ... (29 test files, all green — must stay green)
```

### Desired Codebase tree with files to be added

```bash
hapax/
└── tools/
    └── corpus/                 # NEW (this task)
        ├── README.md           # provenance note (source URL, license, date, commands)
        └── en-50k.tsv          # 50k lines, word<TAB>count, rank-ordered
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: mergeTsv() requires TAB separation; raw corpus is SPACE separated.
#   Head line "you 28787591" must become "you\t28787591".
# CRITICAL: Do NOT pre-filter the TSV against KEY_RE. Lines like "'t" and
#   punctuation-bearing forms exist (~top-10 area) and are legally filtered
#   by build-dict at build time. Pre-filtering would silently change ranks
#   of subsequent entries vs the source corpus.
# CRITICAL: Do NOT sort or re-order — line order = rank and the pipeline's
#   count-DESC sort must produce the same order; keep counts verbatim.
# GOTCHA: The file is ~600 KB — comfortably committable; .gitignore already
#   permits it (covers only dist/build/node_modules/.env/logs/temps).
# GOTCHA: No runtime deps may be added (PRD mandate); conversion uses shell
#   (tr) or node stdlib only.
# GOTCHA: "the" is rank 3 in this corpus (dialogue skew puts you/i at 1/2) —
#   that is EXPECTED and passes the sanity gate; don't "fix" the order.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY LICENSE
  - Fetch https://github.com/hermitdave/FrequencyWords (LICENSE file) and confirm MIT;
    record the license and the OpenSubtitles-2018 data lineage in the README draft.
  - IF unverifiable or incompatible: switch to the Norvig count_1w.txt fallback
    (TAB-separated already; slice top 60k; document the substitution).

Task 2: CREATE tools/corpus/ and vendor the corpus
  - mkdir -p tools/corpus
  - Download:
      curl -sL -o /tmp/en_50k.txt \
        https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
  - Convert: tr ' ' '\t' < /tmp/en_50k.txt > tools/corpus/en-50k.tsv
    (equivalently a 5-line node stdlib script tools/vendor-corpus.mjs if you
    want the step reproducible — optional; if created, it must take no deps
    and include the sanity assertions below)
  - VERIFY: wc -l tools/corpus/en-50k.tsv  → 50000
    head -5 → you / i / the / to / a (with counts, TAB-separated)

Task 3: RUN SANITY ASSERTIONS (do not skip)
  - the/with/this each within first 100 lines:
      head -100 tools/corpus/en-50k.tsv | cut -f1 | grep -cx -e the -e with -e this → expect 3
      (use separate grep -c checks if -x with multiple -e misbehaves on your grep)
  - Head contains the/you/i/to/a: head -10 | cut -f1 includes all five
  - Shape census (documentation only, NOT a filter):
      cut -f1 tools/corpus/en-50k.tsv | grep -cvE '^[a-z][a-z0-9_-]{1,31}$' \
        → count of build-time-filtered lines; record the number in the README
  - All tabs, no spaces: grep -cP '\t' file == 50000; ! grep -c ' '

Task 4: CREATE tools/corpus/README.md (provenance)
  - CONTENT must include: source URL; retrieval date (today); the exact
    retrieval + conversion commands; license (repo MIT + OpenSubtitles 2018
    data origin); the RAW-not-lemmatized choice and why (surface-form lookups);
    the filtered-line count from Task 3; note that dict/common-en.bin is
    regenerated from this corpus in the NEXT subtask (P1.M1.T1.S2).

Task 5: SMOKE-PROVE CONSUMABILITY (no repo artifact changes)
  - node tools/build-dict.mjs --out /tmp/hapax-corpus-smoke.bin tools/corpus/en-50k.tsv
  - EXPECT: exit 0, size summary, "verified: N/N entries OK, no duplicate keys"
    (N will be < 50,000 — KEY_RE filtering is expected; N should be ≈ 49–50k)
  - DELETE /tmp/hapax-corpus-smoke.bin. Do NOT write dict/common-en.bin here.

Task 6: FULL REGRESSION
  - npm test   → all 523 existing tests still green (nothing changed, but verify)
  - npm run check → exit 0
```

### Integration Points

```yaml
BUILD PIPELINE:
  - Future (P1.M1.T1.S2): node tools/build-dict.mjs --out dict/common-en.bin \
      tools/corpus/en-50k.tsv   ← this corpus is THE build input; keep filename stable
  - P1.M1.T2.S1 calibrates score.ts band constants against THIS corpus's ranks;
    its calibration test will assert e.g. lookup('the')>=REJECT threshold from
    the regenerated artifact — the corpus vendored here is what makes those
    assertions deterministic.

GIT:
  - Commit tools/corpus/ (TSV ~600KB + README). Nothing in .gitignore blocks it.
  - Do NOT touch .gitignore, tools/build-dict.mjs, tools/gen-provisional-tsv.mjs,
    dict/common-en.bin, src/**, test/**, spec/**, plan/**.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
# TSV structural checks
wc -l tools/corpus/en-50k.tsv                       # 50000
awk -F'\t' 'NF!=2 {bad++} END {print bad+0}' tools/corpus/en-50k.tsv   # 0
head -3 tools/corpus/en-50k.tsv                     # you/i/the with counts, TABs
```

### Level 2: Unit Tests (regression)

```bash
npm test        # all existing suites green (no code changed)
npm run check   # tsc clean
```

### Level 3: Integration (consumability smoke)

```bash
node tools/build-dict.mjs --out /tmp/hapax-corpus-smoke.bin tools/corpus/en-50k.tsv
# Expect exit 0 + "verified: N/N entries OK, no duplicate keys"
rm -f /tmp/hapax-corpus-smoke.bin
```

### Level 4: Domain-Specific (sanity gate — the point of this task)

```bash
# Rank sanity: common words must be top-ranked (this is what BUG-001 broke)
head -100 tools/corpus/en-50k.tsv | cut -f1 | grep -c '^the$'   # 1
head -100 tools/corpus/en-50k.tsv | cut -f1 | grep -c '^with$'  # 1
head -100 tools/corpus/en-50k.tsv | cut -f1 | grep -c '^this$'  # 1
head -10  tools/corpus/en-50k.tsv | cut -f1                     # includes you,i,the,to,a
```

## Final Validation Checklist

- [ ] `tools/corpus/en-50k.tsv`: 50,000 lines, exactly 2 TAB-separated fields/line
- [ ] Sanity gate passes: the/with/this in top 100; the/you/i/to/a in head
- [ ] Provenance README complete (URL, license, date, commands, filtered-line count, RAW-not-lemmatized rationale)
- [ ] `build-dict.mjs` smoke-consumes the TSV: verified N/N, exit 0
- [ ] `npm test` and `npm run check` both pass (repo regression green)
- [ ] No source/tooling code modified; no dependencies added; `dict/common-en.bin` untouched
- [ ] Corpus order/counts verbatim from source (no pre-filter, no re-sort)

## Anti-Patterns to Avoid

- ❌ Do NOT regenerate or touch `dict/common-en.bin` (that's P1.M1.T1.S2)
- ❌ Do NOT modify `tools/build-dict.mjs` or recalibrate bands (P1.M1.T2)
- ❌ Do NOT pre-filter non-KEY_RE lines from the TSV — build-dict filters them; pre-filtering shifts ranks
- ❌ Do NOT use the lemmatized (qaredux) corpus variant
- ❌ Do NOT re-sort lines or alter counts — verbatim vendoring only
- ❌ Do NOT add npm dependencies or a package.json change

---

**Confidence Score**: 9/10 — URL and format verified live in this session
(HTTP 200; exact head/rank samples quoted); the only residual risk is license
verification at vendor time, with a fully-specified Norvig fallback.