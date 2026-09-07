# Research Notes — P2.M1.T2.S1 (Phrase admission)

## Verified codebase facts

- `src/core/store.ts` — `CandidateStore` currently word-only (20k cap, prefix index,
  `evictIfOverCap`). P2.M1.T1.S1 (implementing in parallel) adds per its PRP contract:
  - `#phrases: Map<string, PhraseEntry>` (private)
  - `recordPhraseLines(lines: readonly string[][], ordinal: number): void`
  - `setPhraseSticky(key: string): void`
  - `getPhrase(key)`, `phraseSize`, `phraseEntries()`, `iteratePhrases()`
  - `PHRASE_CAP = 10_000`, phrase eviction honoring `sticky`
- `src/core/types.ts` — declaration-only module (no imports, no runtime code). `Candidate`
  carries `rankGroup: RankGroup` (0 = dictionary-absent/shape-gated, 1, 2), `properName:
  boolean`, `key`, `sessionCount`. PhraseEntry added by T1.S1: `{key, count,
  lastSeenOrdinal, firstSeenOrdinal, sticky}`.
- `src/core/store.ts` `get(key): Candidate | undefined` — the exact surface needed to look
  up constituent words' rankGroup/properName during admission.
- Word ordinals: `nextOrdinal()` once per message; `currentOrdinal()` read view. Phrase
  `lastSeenOrdinal`/`firstSeenOrdinal` come from the same ordinal space (T1.S1).
- Tests: vitest, `npx vitest run`, `npm run check` = `tsc --noEmit`. Test style:
  describe-per-PRD-section, plain fixtures (see test/store.test.ts).
- Arch invariant: src/core never imports from src/pi. No config additions in core;
  `enablePhrases` gating stays at src/pi/index.ts wiring.

## Boundary decisions (from plan_status)

- This task (T2.S1): admission rule only — candidate-phrase set, promotion on
  count>=2 OR fast path (all constituents rankGroup 0 or properName, word count ≤ 5),
  sticky when both fire. Candidate set is distinct from raw counts.
- P2.M1.T2.S2 (sibling, NOT ours): the 40-ordinal demotion sweep. We must only
  provide the data it needs: which phrases were admitted via fast-path, and a
  `removePhraseCandidacy(key)`-style removal primitive that demotion calls
  (candidacy removed, counts kept).
- P2.M1.T3.S1: consumes the candidate set in query.ts ranking (phrase salience,
  constituent suppression) — needs a reader like `phraseCandidate(key)` /
  `phraseCandidates()`.

## Design sketch

- Extend CandidateStore (in store.ts, per T1.S1's placement) with:
  - `#phraseCandidates = new Set<string>()` (candidacy; counts stay in #phrases)
  - `#fastPathAdmitted = new Set<string>()` or flag on candidate record — for T2.S2's sweep.
  - Admission evaluated at the tail of `recordPhraseLines` for each upserted key:
    repetition path when entry.count >= 2; fast path when every constituent word's
    Candidate (store.get) has `rankGroup === 0 || properName` AND word count ≤ 5.
  - sticky = true when both fire (use T1.S1's `setPhraseSticky`).
- Constituent words are phrase key `.split(" ")` — keys are single-space joined, lowercase.
- A constituent word absent from the word store (evicted or subword-only) cannot satisfy
  the fast path → fast path fails (conservative). Document this.