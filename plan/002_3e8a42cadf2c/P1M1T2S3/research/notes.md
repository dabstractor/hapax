# Research notes — P1.M1.T2.S3 (debug.ts phrase dump strip)

## Baseline state (verified 2025-06, after S1 commit b46f7c6)

- S1 ("refactor(core): swap phrase layer for bare bigram counts") already made the
  "minimal compile-preserving deletions" in `src/pi/debug.ts` that its PRP promised:
  - `TOP_PHRASES`, `phraseDisplay`, `phrasesSection`, and its spread entry are GONE.
  - Phrase imports (`firstWord`, `phraseSalience`, `PHRASE_CAP`, `PhraseEntry`) are GONE.
  - File is now 147 lines; `formatAcwordsDump` joins storeSection / topSection /
    statsSection only — exactly the target end state.
- `test/debug.test.ts` no longer contains the
  `describe 'acwords dump — phrases + successor sample'` block (grep for
  "phrase"/"successor" in that file returns nothing). S1 pruned those 4 cases as
  part of keeping the suite green.

## What actually remains for S3

1. **Stale doc comment** in `src/pi/debug.ts` lines 6–12: header says
   "The M2 phrase dump is a REMOVED design (PRD 002 delta R1); P1.M1.T2.S3 adds a
   successor sample section". This is WRONG on two counts:
   - S3 must NOT add a successor sample (that is P1.M3.T2.S1, per the item contract
     and PRD h2.48 which places the successor sample at M2/P1.M3.T2.S1).
   - The comment must instead state that the successor-index sample section is
     appended by P1.M3.T2.S1 via the small section-builder helpers.
2. **Verification sweep**: confirm zero phrase residue repo-wide in the /acwords
   path, `npm run check` clean, `npm test` green.

## Validation commands (verified against package.json)

- `npm run check` → `tsc --noEmit`
- `npm test` → `vitest --run` (run `npx vitest --run test/debug.test.ts` for the
  targeted suite)

## Key file references

- `src/pi/debug.ts` (147 lines) — storeSection/topSection/statsSection builders,
  `topCandidates`, `GROUP_LABEL`, `TOP_N = 50`, `formatAcwordsDump`,
  `AcwordsCommandDeps`, `registerAcwordsCommand`.
- `test/debug.test.ts` — `see()` upsert helper, `fakeStats` literal with all six
  gate keys, `statsStub`, `fakePi`, `topRows` parser; describes:
  "acwords dump (PRD §08)" (11 cases) and "acwords registration (PRD §08)" (3 cases).
- `plan/002_3e8a42cadf2c/architecture/core_phrase_layer_map.md` §debug.ts — the
  line-anchored inventory this item was originally scoped against (pre-S1 line
  numbers 109/114–120/122–160/182 no longer apply).
- PRD h2.48: dump = top-50 by salience, store size, rank-group histogram, gate
  rejection counts, and (added later, P1.M3.T2.S1) successor-index sample.
  PRD h2.52: "no phrase multipliers exist".