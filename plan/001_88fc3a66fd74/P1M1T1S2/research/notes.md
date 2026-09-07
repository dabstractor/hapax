# Research notes — P1.M1.T1.S2 (src/core/types.ts)

## Sources
- Work item contract (verbatim type list) — authoritative.
- PRD §04 (h1.4): segmentation, shape gate reasons, admission bands, salience, RankedMatch usage.
- PRD §06 (h1.6): Candidate interface verbatim.
- plan/001_88fc3a66fd74/architecture/core_contracts.md: handoff chain; Sighting shape;
  Dictionary contract; "src/core imports NOTHING from pi packages".
- plan/001_88fc3a66fd74/P1M1T1S1/PRP.md: scaffold that will exist — package.json
  (type:module, no deps), tsconfig strict NodeNext noEmit, src/core/ with .gitkeep,
  vitest with test/ glob, `npm run check` = tsc --noEmit.

## Key decisions
1. Pure types file: `export type/interface` only; zero imports (not even pi types) —
   enforces the two-layer rule trivially and satisfies the review gate.
2. `RankGroup = 0 | 1 | 2` literal union (PRD says `rankGroup: 0|1|2`).
3. `GateRejectReason` union exactly: 'tooShort' | 'tooLong' | 'lowEntropy' |
   'unigramRun' | 'secret' | 'consonantRun'. Shape-gate module maps its rules to
   these; `reason` present only when `ok === false` (optional field, not a
   discriminated union — matches the stated GateResult interface).
4. `Dictionary` is an interface (loader contract only); implementation in
   dictionary.ts (P1.M1.T2.S1). `lookup(word)` returns quantized rank 0–255 or null.
5. `Sighting.parentKey?: string` — set only for subword candidates (clamp rule
   handled in score.ts, not here).
6. JSDoc comments on each export citing PRD section — self-documenting contract.
7. Optional smoke test in test/ verifying imports and type-level facts (e.g.
   rankGroup values) — cheap, keeps `npm test` meaningful; the scaffold PRP allows
   vitest with zero tests, adding one here is safe.

## Verification
- `npm run check` must pass with the new file (tsconfig includes src/**/*.ts).
- No new dependencies. No exports duplicated elsewhere.