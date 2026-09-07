# Research notes — P1.M1.T1.S2 (bugfix 001): Regenerate dict/common-en.bin

## Sources examined
- tools/build-dict.mjs (full read): CLI `--out <path> input.tsv...`, DICT_N=70_000,
  KEY_RE filter, count-DESC sort, quant(rank) = 255 − floor(254·log2(1+rank)/log2(1+N)),
  HAPX v1 emit (little-endian, seed 0), post-write verify() pass printing
  `verified: N/N entries OK, no duplicate keys`. Guards direct-run vs import.
- test/shipped-dict.test.ts (full read): hard-codes `dict.entryCount === 50_927`
  (line ~28), asserts version=1, entryCount > 50_000, 'the'/'and'/'word' non-null,
  'qqqqzzzz' null. Only file referencing 50927 outside plan/.
- README.md §"Dictionary build" (lines 202-265): documents the provisional
  artifact (cracklib-small, length-sorted, 50,927 entries, ~1.2 MB) — must be
  rewritten per Mode A docs requirement.
- P1M1T1S1 PRP (contract): will deliver tools/corpus/en-50k.tsv (50,000 lines,
  word<TAB>count, rank order; head: you/i/the/to/a) + tools/corpus/README.md
  provenance. Build smoke expected N ≈ 49-50k after KEY_RE filtering.
- Architecture/system_context.md BUG-001 + bug-hunt report (selected PRD):
  measured lookups the=103/that=73/with=71 → all admitted group 1. Fix here is
  rank ORDERING only; band widening (q>=220 covering more than ranks 0-3) is
  P1.M1.T2 — explicitly out of scope.

## Key facts for implementation
- After rebuild from en-50k.tsv: entryCount will be ≈49.7k (50,000 − KEY_RE
  filtered lines like `'t`). The exact number comes from the build's own
  `entries=N` output; test must be updated to that number.
- New expected lookups (quant with rank r, N=70,000): 'the' rank ~2 → q≈255
  (255 − floor(254·log2(3)/log2(70001)) ≈ 255−0=255; only ranks 0-3 hit q>=220
  with the current curve — 'with'/'this' will be high-q (~200s) but likely < 220;
  that's P1.M1.T2 territory). Ordering check: lookup('the') > lookup('that') >
  lookup('tokenizer-ish rare') etc.
- Regeneration is a DATA change only: quant(), DICT_N, emit(), DICT_VERSION must
  NOT be touched (format bump per spec/03 L102-103 otherwise).
- Byte stability: deterministic given input TSVs (lexicographic tie-break).
- Consumers: src/core/dictionary.ts loadDictionary() (no change), P1.M3.T5
  disable-on-bad-dict, P1.M4/P1.M5 regression suites — verify() pass protects them.
- Versioning contract (README L254-265): version stays 1; no loader change.

## Validation approach
- Run build, capture entries=N, update test, run npm test (all 523+ tests), npm run check.
- Node one-liner probing lookup('the')/'with'/'this' ordering via loadDictionary.