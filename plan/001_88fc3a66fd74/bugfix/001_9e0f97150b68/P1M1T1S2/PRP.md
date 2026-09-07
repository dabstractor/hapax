# PRP — P1.M1.T1.S2 (bugfix 001_9e0f97150b68): Regenerate dict/common-en.bin from the vendored corpus

---

## Goal

**Feature Goal**: Replace the mis-calibrated provisional artifact
`dict/common-en.bin` (built from a length-sorted system word list — BUG-001,
Critical) with one regenerated from the real frequency corpus
`tools/corpus/en-50k.tsv` (vendored by P1.M1.T1.S1), so the dictionary's
quantized scores are ordered by actual word frequency. This is a **DATA change
only** — no pipeline code, format version, or band constants change.

**Deliverable**:
- Regenerated, committed `dict/common-en.bin` (HAPX v1, built by
  `node tools/build-dict.mjs --out dict/common-en.bin tools/corpus/en-50k.tsv`)
- Updated `test/shipped-dict.test.ts` entry-count assertion (50_927 → the
  actual regenerated count) + comment refresh
- Updated README §"Dictionary build" provenance/entry-count lines (Mode A docs)

**Success Definition**: Build exits 0 with `verified: N/N entries OK, no
duplicate keys`; `loadDictionary('dict/common-en.bin')` succeeds with
version 1; `lookup('the')` is the highest-q entry (~255) and
`lookup('with')`/`lookup('this')` are high-q (ordered by real frequency);
`npm test` and `npm run check` both green.

## Why

BUG-001: the shipped dictionary's rank ordering is unrelated to word frequency
(the=103, that=73, with=71), so every common English word passes the §04
admission bands as "rare" (61/61 of the most common ≥4-letter words admitted)
and completion menus pop during ordinary prose — defeating the PRD's core
no-hijack invariant. Regenerating from the real corpus fixes the rank
**ordering**. Full band correctness (q ≥ 220 covering more than ranks 0–3 under
the current quant curve with DICT_N = 70,000) is deliberately deferred to
P1.M1.T2 (its calibration test depends on this regenerated artifact).

## What

1. Run `node tools/build-dict.mjs --out dict/common-en.bin tools/corpus/en-50k.tsv`
   and confirm the built-in verify pass output (`verified: N/N entries OK, no
   duplicate keys`, exit 0). Capture `N` from the `entries=N` size-summary line.
2. Update `test/shipped-dict.test.ts`:
   - Replace the hard-coded `expect(dict.entryCount).toBe(50_927)` with the
     actual regenerated N (keep the `> 50_000` presence check, version=1 check,
     'the'/'and'/'word' non-null spot-checks, and the `lookup("qqqqzzzz")`
     null check).
   - Refresh the file's header comment: the source is now
     `tools/corpus/en-50k.tsv` (hermitdave/FrequencyWords 2018 en_50k, RAW),
     not cracklib-small.
3. Sanity-check frequency ordering against the regenerated artifact (commands
   below): `lookup('the')` ≈ 255 and strictly greater than `lookup('with')` >
   `lookup('this')` > a deep-tail word; confirm common words now score far
   higher than under the provisional artifact.
4. Update README §"Dictionary build" (Mode A): what ships (entry count, size),
   corpus provenance pointing at `tools/corpus/README.md`, remove the
   "Status: PROVISIONAL / cracklib-small / synthetic rank ordering" paragraphs
   and the gen-provisional regeneration snippet; note that band constants
   calibration is a separate concern. No config/API surface change.

### Success Criteria

- [ ] `dict/common-en.bin` regenerated from `tools/corpus/en-50k.tsv`, committed
- [ ] Build verify pass output confirmed (`verified: N/N ... no duplicate keys`)
- [ ] `loadDictionary()` on the new artifact: version 1, entryCount = N ≈ 49–50k
- [ ] `lookup('the')` is the maximum q (~255); `lookup('with')`, `lookup('this')`
      high-q and frequency-ordered (strictly greater than mid/rare words)
- [ ] `test/shipped-dict.test.ts` updated to N and passes; full `npm test` green
- [ ] README §"Dictionary build" reflects the real corpus; "PROVISIONAL" removed
- [ ] `tools/build-dict.mjs` untouched (quant/DICT_N/emit/DICT_VERSION unchanged)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: exact build command, the test
file's current contents (quoted), README section location, expected lookup
behavior, and the precise scope fence (data-only, no code/curve changes).

### Documentation & References

```yaml
- file: tools/build-dict.mjs
  why: The build CLI — read-only consumer here. Contract: mergeTsv (word<TAB>count,
        counts sum across multiple inputs) → KEY_RE filter → count-DESC sort →
        slice DICT_N=70_000 → quant(rank) → emit HAPX v1 → verify() re-reads from
        disk and probes every entry.
  critical: DO NOT MODIFY quant(), DICT_N, emit(), or DICT_VERSION — regeneration
        is a DATA change only; touching the format requires a version bump
        (spec/03 L102-103, out of scope).

- file: test/shipped-dict.test.ts
  why: The only file hard-coding the artifact's entry count (50_927, in
        "returns the loader-reported entryCount from the build summary").
        Its header comment cites the cracklib-small source — update both.
  pattern: keep all other assertions intact (version, >50_000, the/and/word
        non-null, qqqqzzzz null).

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M1T1S1/PRP.md
  why: CONTRACT for the input: tools/corpus/en-50k.tsv (50,000 lines,
        word<TAB>count, rank order; head = you/i/the/to/a) + tools/corpus/README.md
        provenance. S1's smoke test expects build entries ≈ 49–50k after KEY_RE
        filtering (~top-10 lines like "'t" are legally filtered at build).

- file: README.md (§"Dictionary build", ~lines 202–265)
  why: Mode A docs update target — "What ships" paragraph (entry count 50,927,
        "Status: PROVISIONAL", cracklib-small provenance) and the
        gen-provisional-tsv regeneration snippet must be rewritten.

- docfile: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/architecture/system_context.md
  section: BUG-001
  why: Root-cause analysis and measured bad lookups (the=103, that=73, with=71);
        explains why only rank ORDERING is fixed here.

- file: src/core/dictionary.ts
  why: The loader that must accept the artifact unchanged (loadDictionary,
        DICT_VERSION). No modification needed — verify pass + this loader agree
        on format by triplicated-contract design.
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── dict/
│   └── common-en.bin       # MIS-CALIBRATED (length-sorted cracklib list) ← REGENERATE
├── tools/
│   ├── build-dict.mjs      # build pipeline — DO NOT MODIFY
│   ├── corpus/             # from P1.M1.T1.S1: en-50k.tsv + README.md (build INPUT)
│   └── gen-provisional-tsv.mjs   # obsolete generator; leave the file, drop README refs
├── src/core/dictionary.ts  # loader — unchanged
└── test/shipped-dict.test.ts     # entry-count assertion ← UPDATE
```

### Desired Codebase tree with files to be changed

```bash
dict/common-en.bin          # regenerated binary (committed)
test/shipped-dict.test.ts   # entryCount 50_927 → actual N; comments updated
README.md                   # §"Dictionary build" provenance/counts rewritten
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: Byte-stable format. Same TSVs → byte-identical binary (deterministic
#   sort with lexicographic tie-break). Do not introduce nondeterminism (no
#   timestamps, no map-iteration-order dependence in inputs).
# CRITICAL: entryCount WILL change (50,927 → ≈49.7k; the corpus has 50,000 lines
#   minus KEY_RE-filtered ones). Get N from the build's own "entries=N" stdout
#   line and put that exact number in the test.
# CRITICAL: With the CURRENT quant curve (denominator DICT_N=70_000), q>=220
#   covers only ranks 0-3 — 'the' (rank ~2) hits ~255, but 'with'/'this' may
#   land in the 200s BELOW 220. That is EXPECTED here; band recalibration is
#   P1.M1.T2. Do NOT "fix" it by editing quant() or DICT_N.
# GOTCHA: mergeTsv sums counts across multiple input TSVs — pass exactly ONE
#   input file (tools/corpus/en-50k.tsv) or entryCount shifts.
# GOTCHA: The verify() pass re-reads the file from disk (does not trust the
#   write buffer) — its "verified: N/N entries OK" line is the acceptance
#   signal for the artifact.
# GOTCHA: dialogue-register corpus — 'you'/'i' outrank 'the' (ranks 0/1/2).
#   Expected; 'the' at rank ~2 → q≈255 (max) still satisfies the ordering check.
# GOTCHA: tools/gen-provisional-tsv.mjs becomes vestigial — do NOT delete or
#   modify it in this task (other references may exist); just remove its
#   regeneration snippet from README.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITION CHECK
  - Verify tools/corpus/en-50k.tsv exists (P1.M1.T1.S1 output), 50,000 lines,
    head = you/i/the/to/a (word<TAB>count). If absent, STOP — S1 not landed.

Task 1: REGENERATE THE ARTIFACT
  - node tools/build-dict.mjs --out dict/common-en.bin tools/corpus/en-50k.tsv
  - EXPECT: exit 0; stdout lines:
      "dict/common-en.bin: entries=N blob=...B ... total=...B (~1.3 MB)"
      "verified: N/N entries OK, no duplicate keys"
  - RECORD N (≈49.7k expected). If verify fails, do NOT commit; investigate.

Task 2: SANITY-CHECK FREQUENCY ORDERING (before touching tests)
  - Node probe (from repo root, after the loader is importable via vitest/ts —
    simplest: a temporary vitest run or a tiny script executed with
    npx tsx-less approach: reuse the probe INSIDE the updated test):
    lookup('the')  → expect ≈ 255, and the maximum observed q
    lookup('with') / lookup('this') → high-q (> 180), strictly > lookup('would')? 
      (any mid-frequency word), and > a rare deep-tail word like 'dogmatic'
    lookup('qqqqzzzz') → null
  - ORDERING assertions only — do NOT assert >= 220 for 'with'/'this' (P1.M1.T2).

Task 3: UPDATE test/shipped-dict.test.ts
  - Replace `expect(dict.entryCount).toBe(50_927)` with `.toBe(<N from Task 1>)`
  - Update the header comment: source = tools/corpus/en-50k.tsv
    (hermitdave/FrequencyWords 2018 en_50k, RAW/OpenSubtitles); drop the
    cracklib-small / 50,927 references; keep the "qqqqzzzz absent" note.
  - Optionally strengthen the spot-check test: assert lookup('the') ===
    lookup('with')? No — keep ordering checks minimal and non-brittle:
    assert dict.lookup('the') !== null and dict.lookup('the')! >=
    dict.lookup('this')! (frequency ordering), plus the existing checks.

Task 4: UPDATE README.md §"Dictionary build"
  - "What ships": new entry count (N), file size (~1.3 MB from build summary),
    HAPX v1, loaded by loadDictionary().
  - Replace the PROVISIONAL/cracklib paragraphs and the gen-provisional
    regeneration snippet with: corpus provenance pointer to
    tools/corpus/README.md + the canonical regeneration command
    `node tools/build-dict.mjs --out dict/common-en.bin tools/corpus/en-50k.tsv`.
  - Keep the "Versioning contract" subsection as-is (version still 1).

Task 5: FULL REGRESSION
  - npm test   → ALL suites green (some suites load the shipped dict; the
    changed quants may alter nothing in unit tests because most use synthetic
    dictionaries — but run everything and fix only the entryCount assert)
  - npm run check → exit 0
  - git status: changed files = dict/common-en.bin (binary diff),
    test/shipped-dict.test.ts, README.md (+ tools/corpus/ from S1). Nothing else.
```

### Integration Points

```yaml
BUILD PIPELINE:
  - Input: tools/corpus/en-50k.tsv (P1.M1.T1.S1) — exactly ONE input file
  - Output: dict/common-en.bin consumed by src/core/dictionary.ts
    loadDictionary() and, transitively, P1.M3.T5 (disable-on-bad-dict) and
    the P1.M5 adversarial regression suite (prose no-menu gate — but note the
    full no-menu guarantee only lands after P1.M1.T2 band recalibration).

FUTURE (context only — do not implement):
  - P1.M1.T2.S1 recalibrates score.ts REJECT/MID constants against THIS
    artifact's ranks; P1.M1.T2.S2 adds a calibration test asserting
    lookup('the') >= new REJECT threshold. The artifact produced here is the
    calibration target — keep it committed and stable.

FORMAT CONTRACT:
  - magic HAPX, version=1, seed=0, lowercase flag — all unchanged; loader and
    test/helpers/dict-writer.ts byte-contracts untouched.
```

## Validation Loop

### Level 1: Build output

```bash
node tools/build-dict.mjs --out dict/common-en.bin tools/corpus/en-50k.tsv
# Expect exit 0 + "verified: N/N entries OK, no duplicate keys"
ls -l dict/common-en.bin   # ~1.3 MB per summary
```

### Level 2: Loader + calibration sanity

```bash
# Quickest reliable probe: run vitest on the updated shipped-dict test plus a
# one-off describe with ordering asserts (then fold or delete the one-off):
npm test -- test/shipped-dict.test.ts
# Also a raw probe (no TS import needed) using the build script's own verify
# lookup — regenerate to /tmp and probe there if you prefer not to touch dict/:
node -e "
import('./tools/build-dict.mjs').then(m => {
  const map = new Map();
  m.mergeTsv('tools/corpus/en-50k.tsv', map);
  const entries = m.selectEntries(map);
  const v = m.verify('/tmp/probe.bin', entries);
  console.log('the', v.lookup('the'), 'with', v.lookup('with'),
              'this', v.lookup('this'), 'qqqqzzzz', v.lookup('qqqqzzzz'));
});"
# Expect: the ≈ 255 (max), with/this clearly high-q and > mid-tail words,
# qqqqzzzz null. Then verify the COMMITTED artifact via the vitest test.
```

### Level 3: Full regression

```bash
npm test          # all suites green (entryCount assert updated in Task 3)
npm run check     # exit 0
```

### Level 4: End-to-end spot (optional but recommended)

```bash
# Against the repo's own prose fixture — expect FEWER menu popups than the
# bug report, though 'with'/'this' may still admit until P1.M1.T2 widens the
# reject band. Run the existing provider/acceptance suites; do not author new
# e2e here (P1.M5.T1.S1 owns the prose no-menu gate).
npm test -- test/provider-live.test.ts test/acceptance.test.ts
```

## Final Validation Checklist

- [ ] `dict/common-en.bin` regenerated from `tools/corpus/en-50k.tsv` (single input)
- [ ] Build verify pass confirmed: `verified: N/N entries OK, no duplicate keys`, exit 0
- [ ] `loadDictionary()` loads the committed artifact: version 1, entryCount = N
- [ ] Frequency ordering sanity passed: lookup('the') maximal (~255); with/this high-q
- [ ] `test/shipped-dict.test.ts` entryCount = N; all other asserts intact; green
- [ ] `npm test` full suite green; `npm run check` exit 0
- [ ] README §"Dictionary build" updated (real corpus provenance, new counts,
      PROVISIONAL language removed)
- [ ] `tools/build-dict.mjs`, `src/**`, band constants, quant curve: UNTOUCHED
- [ ] No dependencies added; no config/API change; spec/, plan/ untouched

## Anti-Patterns to Avoid

- ❌ Do NOT modify quant(), DICT_N, emit(), DICT_VERSION, or score.ts bands
      (P1.M1.T2 scope; format bump otherwise required by spec/03)
- ❌ Do NOT pre-filter or re-sort the corpus TSV — build-dict owns filtering
- ❌ Do NOT assert q ≥ 220 for 'with'/'this' in any committed test
      (band recalibration is not done yet)
- ❌ Do NOT delete tools/gen-provisional-tsv.mjs — just de-reference it in README
- ❌ Do NOT regenerate with multiple/extra input TSVs — counts would sum
- ❌ Do NOT bypass the verify pass or commit an artifact whose build didn't
      print the verified line

---

**Confidence Score**: 9/10 — build command, test file contents, README section,
and expected quant behavior are all pinned from the actual repo; the only
variable is the exact regenerated N (discovered at build time by design).