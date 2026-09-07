# Research notes — P1.M2.T4.S1 (CandidateStore)

## Codebase facts verified
- `src/core/types.ts` already defines `Candidate` and `Sighting` exactly as the
  item contract expects (Sighting: key, display, ordinal, fromUser,
  properName, rankGroup, isSubword, parentKey?). The store must IMPORT these —
  never redeclare.
- ESM NodeNext project (`"type": "module"`, `module: NodeNext`) → imports use
  `.js` extensions: `from "./types.js"`.
- Tests: vitest (`npm test` → `vitest --run`), colocated `test/*.test.ts`,
  plain `describe/it/expect`, no fixtures. See `test/score.test.ts` header
  comment style (PRD citation + module header comment convention).
- Type-check gate: `npm run check` (`tsc --noEmit`).
- `src/core/score.ts` currently exports `admit()` + thresholds;
  P1.M2.T3.S2 (parallel) adds `salience(c, currentOrdinal)`,
  `evictionScore(c, currentOrdinal)`, `compareCandidates(a,b,currentOrdinal)`.
  NOT needed by this item (S3 eviction will use evictionScore) — do not import
  score.ts here; keep store.ts dependency-free except types.
- No existing `src/core/store.ts` — new file.

## PRD grounding
- §06 h2.35: one entry per lowercase key; Map primary; no persistence
  (created at session_start, dropped at session_shutdown — lifecycle wiring is
  P1.M3.T5, not here).
- §06 h2.36 upsert semantics: absent → create (sessionCount=1, ordinals=n,
  flags set); present → sessionCount++, lastSeenOrdinal=n, refresh display
  casing, OR-in userTyped/properName, rankGroup = min(existing, new).
- Ordinal counter: per-session monotonic; pipeline calls nextOrdinal() once
  per message BEFORE processing sightings (P1.M3.T2.S2 will consume).
- casing variants merge with display = most recent (§04/§06).

## Design decisions for the PRP
- `Sighting.fromUser` maps to Candidate.userTyped (OR-in, sticky).
- Snapshot methods for tests: `entries(): Candidate[]` (copy), `get(key)`,
  `size` getter, `rankGroupHistogram(): Record<RankGroup, number>`.
- Prefix index (S2), eviction (S3), phrases (P2) are OUT of scope — but S2
  needs a `dirty` hook; keep upsert side-effect free of index concerns for
  now (S2 will add markDirty internally).