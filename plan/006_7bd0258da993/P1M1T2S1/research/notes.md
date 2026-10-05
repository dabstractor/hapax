# Research — P1.M1.T2.S1 (plan 006): Candidate casing tallies (additive migration)

## Verified anchors (02-store-query-r1-r2.md §1–§3 + live source)
- Candidate types.ts:19-33 (display "most recent casing seen"); Sighting :36-47
  now carries `casing: CasingClass` (P1.M1.T1.S1 landed/landing).
- store.upsert :264-298: create fills 9 fields; merge bumps sessionCount/
  lastSeenOrdinal, `existing.display = sighting.display` (:291), sticky OR-ins,
  rankGroup min. Tally accumulation lands at these two sites.
- score.ts reads NO display — salience/eviction unaffected (grep: zero .display).
- ~22 .display consumers (inventory 02 §5): RankedMatch.display (provider
  :604/:614/:670; widget many) + direct Candidate.display readers
  (debug.ts, provider.ts:436, widget.ts:667 chain labels). All stay green ONLY
  if display survives until P1.M2.T1.S2 — hence ADDITIVE here.
- test/store.test.ts:86 exact-object toEqual idiom — the battery extends it.

## Design decisions
1. Candidate GAINS (types.ts, spec 06 h2.41 shape): capCount, lowerCount,
   capDisplay: string (empty when no valid capitalized sighting). Plus ONE
   internal non-spec field `structuralCapCount?: number` — pending structural
   contributions to remove on first lowercase (precedent: config.ts's internal
   fuzzThresholdSet load-result field). display KEPT unchanged.
2. Per-form frequency for "most frequent capitalized form (ties → most
   recent)": needs form→count tracking. Use a store-internal side map
   `#capForms: Map<key, Map<form, count>>` (kept in sync: created on first
   mid-cap, deleted on word eviction; NOT part of the Candidate shape).
   Only MID-CAP forms compete for capDisplay (structural forms may be purged;
   contract: "'mid-cap' sightings always count toward capCount and set/compete
   for capDisplay").
3. Merge rules (spec 06 h2.43):
   - lower: lowerCount++; if structuralCapCount > 0 → capCount -=
     structuralCapCount; structuralCapCount = 0 (PERMANENT — sticky by
     lowerCount > 0 from now on).
   - structural-cap: if lowerCount === 0 → capCount++, structuralCapCount++
     (no capDisplay competition). Else DROPPED entirely (still sessionCount++,
     display refresh, sticky flags — only casing tallies ignore it).
   - mid-cap: capCount++; #capForms bump; capDisplay = argmax form count,
     ties → the most recently bumped form wins (bump-then-compare).
   - create path initializes per class the same way.
4. sessionCount counts BOTH casings (unchanged); userTyped/properName/
   rankGroup merge untouched; display still recency (temporary, removed in
   P1.M2.T1.S2).
5. Eviction sync: evictIfOverCap's drop path must `#capForms.delete(key)`
   (side map must never outlive its candidate).
6. Chain-only members never reach upsert (P1.M1.T3.S1 guard) — no store-side
   guard needed here, but note it.

## Upstream contract (P1.M1.T1.S1/S2, parallel)
- S1 delivers Sighting.casing: CasingClass ('lower'|'mid-cap'|'structural-cap')
  threaded through segment→ingest; S2's run walk consumes the same classes.
- If Sighting.casing is not yet landed at start, treat its shape as the
  contract above (required field; S1 is a dependency — sequence after it).

## Test battery (test/store.test.ts, hand-built Sighting literals, no mocks)
- create-per-class tallies (exact-object toEqual incl. new fields)
- mid-cap accumulation + capDisplay majority flips; tie → most recent
- structural-only word: capCount grows while lowerCount 0
- twin suppression PERMANENCE: structural×3 then lower → capCount 0
  (3 removed), lowerCount 1; later structural → no contribution (forever)
- structural after lower never touches capCount/capDisplay
- sessionCount counts both casings; display still recency; sticky flags
- eviction drops #capForms (observable via re-create correctness / no leak
  assertion on store internals if exposed)
