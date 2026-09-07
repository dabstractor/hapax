# Research notes — P2.M1.T2.S2 (40-ordinal demotion sweep)

## Verified facts (read from code)

- `src/core/store.ts` (current landed state): `#ordinal` counter, `nextOrdinal()`
  (1-based monotonic), `currentOrdinal()` read view. Phrase layer from T1.S1 may not
  be landed yet at time of writing — PRP for T1.S1 is the contract.
- T1.S1 PRP contract API (phrase layer): `recordPhraseLines(lines, ordinal)`,
  `getPhrase(key): PhraseEntry | undefined`, `setPhraseSticky(key)`,
  `iteratePhrases()`, `phraseEntries()`, `phraseSize`, `PHRASE_CAP = 10_000`.
- T2.S1 PRP contract API (admission layer — being implemented in parallel):
  `#phraseCandidates: Set<string>`, `#fastPathAdmitted: Set<string>`,
  `isPhraseCandidate(key)`, `phraseCandidateKeys(): string[]`,
  `isFastPathPhrase(key)`, `removePhraseCandidacy(key)` (deletes from both sets,
  keeps counts, never unsets sticky).
- `PhraseEntry` (types.ts, T1.S1): `{ key, count, lastSeenOrdinal, firstSeenOrdinal, sticky }`.
- `src/pi/ingest.ts`: `IngestPipeline.flush()` awaits `#drainQueue()`;
  `#drainQueue()` loops `processText` for pending items in a try/finally that resets
  `#drain = null`. "End of each ingest flush" = the tail of `#drainQueue` (before or
  in the finally). One drain can process MANY messages (chunked/debounced) — the sweep
  is once per drain, not per message. That is fine: demotion is not latency-sensitive.
- `processText` issues one ordinal per message via `nextOrdinal()`; restore replay uses
  the same path, so `currentOrdinal()` is the correct "now" for the sweep.
- Tests: vitest, files in `test/*.test.ts`. `test/phrases.test.ts` created by T1.S1,
  extended by T2.S1 — this task extends it further. Deterministic ordinal fixtures via
  `nextOrdinal()` or direct `upsert(Sighting{ordinal})`.

## Boundary decisions

- Sweep lives in `CandidateStore` as `sweepPhraseDemotions(): number` (returns count
  demoted — useful for stats/tests); wired in `#drainQueue` tail in `src/pi/ingest.ts`
  ONLY when phrase capture is active (same gating as T1.S1's `onAdmittedTokens`).
  Store method itself is unconditional (core stays unconditional per T2.S1 precedent).
- O(candidates) requirement: iterate `phraseCandidateKeys()` (a snapshot copy — safe to
  call `removePhraseCandidacy` while iterating), filter with `isFastPathPhrase(key)`,
  then `getPhrase(key)` for count/firstSeenOrdinal. NEVER iterate `#phrases` (counts map).
- Demotion condition per PRD §06 h3.7: fast-path-only candidate AND
  `currentOrdinal() - firstSeenOrdinal > 40` AND `count < 2`.
  - "fast-path-only": `isFastPathPhrase(key) === true`. Note T2.S1 keeps fast-path
    provenance even after the phrase becomes sticky; sticky implies count >= 2, so the
    `count < 2` guard alone excludes sticky phrases. Belt-and-braces: also skip
    `getPhrase(key)?.sticky`.
  - Strict inequality: `> 40` means at ordinal 41 with firstSeen 1, diff = 40 → NOT yet
    demoted; ordinal 42 (diff 41) → demoted. BUT the item contract says "fast-path
    phrase at ordinal 41 with count 1 → demoted" — that implies firstSeenOrdinal 0-ish
    or diff ≥ 40 semantics. Resolve: firstSeen ordinal of the phrase is the ordinal of
    the message where it was recorded (≥ 1). "40 subsequent message ordinals" (PRD) —
    the phrase fails when 40 ordinals AFTER its sighting have passed, i.e.
    `currentOrdinal - firstSeenOrdinal >= 40` → demote. This matches the item's test
    spec (ordinal 41, firstSeen 1, diff 40 → demoted). USE `>= 40` and document.
- Re-promotion: demoted phrase recurring → its count climbs; at count ≥ 2 the
  repetition path in T2.S1's `#admitPhrase` re-adds to `#phraseCandidates`
  (already covered by T2.S1 tests; we assert it once here from the sweep side).
  Fast path provenance is cleared on demotion (`removePhraseCandidacy` deletes from
  `#fastPathAdmitted`) → re-admission is repetition-path only → never re-sticky. Good.
- Counts retained: `removePhraseCandidacy` per T2.S1 contract never touches `#phrases`.
- Cap/eviction interplay: sweep only shrinks the candidate set; it does not touch
  `#phrases` so eviction pool/scores unaffected.

## Where the sweep is wired

`#drainQueue` in `src/pi/ingest.ts`:

```ts
} finally {
  this.#drain = null;
  this.#onSweepPhrases?.(); // option, default undefined; extension wires it to
  // store.sweepPhraseDemotions() when phrase capture is enabled
}
```

Alternative considered: call `store.sweepPhraseDemotions()` unconditionally in
finally — harmless when no phrases exist (O(0)), simpler. RECOMMENDED: call it
unconditionally via a direct store reference if IngestPipeline already holds one
(it does: `#store`). Check whether T1.S1 added a gate; follow whatever T1.S1 landed
for recordPhraseLines wiring (the `onAdmittedTokens` callback pattern). Simplest
consistent choice: add the sweep call in `#drainQueue`'s finally guarded the same
way phrase recording is gated (if gated via callback, add `#onSweepPhrases?` option).

## Test plan

- fast-path phrase firstSeen ordinal 1, count 1; advance store to ordinal 41
  (`nextOrdinal()` x N or upsert a dummy word at ordinal 41) → sweep → demoted:
  `isPhraseCandidate === false`, `getPhrase(key).count === 1` (counts kept).
- ordinal 40 (diff 39) → NOT demoted.
- count ≥ 2 phrase (sticky or not) never demoted even at large diff.
- repetition-only candidate (never fast-path) never demoted (not in provenance).
- demoted phrase recurs → count 2 → re-admitted as candidate, sticky false,
  `isFastPathPhrase === false`.
- sweep is idempotent: second call demotes nothing new.
- sweep does not demote when phrase map empty / no candidates (cheap no-op).