# Research notes — plan 003 P1.M2.T1.S2: admission score constants + below-threshold discard

## Upstream contract (P1.M2.T1.S1, implementing in parallel — assume delivered)
- `src/core/query.ts` exports `interface MatchResult { tier: 1|2|3; score: number }` and `matchFragment(f, c): MatchResult | null` — single two-pointer pass, anchor + greedy subsequence + tiers, score formulas computed inline (NOT yet exported constants): tier 3 = 100; tier 2 = 85 − 40·(charsSkippedBeforeRun/len(c)); tier 1 = 50 − 5·gapRuns − min(gapChars,15). Integer (Math.round), clamped [0,100]. `rankMatches` left as-is (prefix).
- Worked values (formula wins over PRD prose — S1 documents the drift):
  - `zsk`→`zendesk`: runStart at c[4]? trace: c="zendesk", tail "sk" first occurs at index 4 → skipped=3, 85−40·3/7 = 67.86 → **68** (prose says ≈62; both ≥ 60 — passes either way; pin the FORMULA value 68 and comment the drift).
  - `hr`→`handleResponse`: contiguous from c[1], skipped 0 → **85** (prose ≈69 is inconsistent with its own formula).
  - `zlock`→`z_lwlock`: 85−40·1/8 = 80.
  - tier 1 max = **50** (e.g. `zp`→`zendesk` = 50−5−4 = 41) → default threshold 60 kills ALL tier-1 — intended, must be pinned.
- S1 tests live in test/query.test.ts describe "matchFragment — anchored fuzzy (PRD §04 h2.28)".

## Scope split (the delicate part)
- S1: pure matcher + arithmetic inline. **S2 (this)**: export the score constants as named calibration starting points + `DEFAULT_FUZZ_THRESHOLD = 60` + `RankOptions.fuzzThreshold` (S3 wires config → schema auto-imports the baked constant "same pattern as rejectCommonness", r3 doc line 48) + below-threshold discard inside rankMatches' candidate loop (skip before pushing to matches) — r3 doc §7: "natural placement: inside the candidate loop (query.ts:110-119)".
- P1.M2.T2.S1: the 4-key comparator rewrite + RankedMatch.sessionCount + zero-fragment ranking + plural-prune position. P1.M2.T2.S2: prefixRange → first-char range scan re-basing. S2 must NOT do comparator/scan changes.
- Zero-fragment (f === "" / `#` alone): NO anchor, NO tiers, NO threshold — the full-listing path "falls to the ranking path" (T2.S1). S2's gate only runs when the fragment is non-empty.

## Current rankMatches shape (verified via S1 PRP + r3 doc)
- query.ts ~L107: rankMatches(store, fragment, opts) with RankOptions + DEFAULT_LIMIT; candidate loop ~L110–119 pushing matches; comparator compareRankedMatches sorts. S1 leaves these untouched.
- After S2: loop = for each candidate key: if fragment non-empty → m = matchFragment(f, key); if (m === null || m.score < fuzzThreshold) continue; push. Fragment empty → current behavior (all candidates, no gate).
- IMPORTANT consequence to pin: with the fuzzy gate in the loop, rankMatches' effective match predicate becomes fuzzy membership (prefix matches are tier 3, score 100, always pass at ≤100 thresholds) — the prefix-era tests must stay green at default (all their probes are prefixes), but any test relying on mid-word prefix behavior... prefixes are exactly tier 3, so green. Non-prefix old behavior: rankMatches never matched non-prefixes anyway. So gating is compatible; only candidates that pass the OLD prefix check but score < threshold could newly drop — impossible for prefixes (score 100). Safe.

## Config/schema facts (spec 08 h2.52)
- fuzzThreshold: 0–100 clamped; default auto-imported from baked constant in the query module — exactly like rejectCommonness (config.ts:39 imports REJECT_COMMON_THRESHOLD from ../core/score.js).
- 100 = exact-prefix-only mode (tier 3 scores 100 ≥ 100; tiers 2/1 max 85 < 100). 0 admits everything.

## Test surface (spec 09 h2.55 query.test.ts)
- "Admission score + threshold: below-fuzzThreshold matches never render; fuzzThreshold: 100 = exact-prefix-only mode; score arithmetic per 04's formula for each tier."

## Commands
- npx vitest --run test/query.test.ts -v; npm run check; npm test. Perf gates unaffected (default path unchanged for prefixes).
