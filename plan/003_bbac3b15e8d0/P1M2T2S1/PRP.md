---
name: "P1.M2.T2.S1 (plan 003) — 4-key comparator + RankedMatch.sessionCount + zero-fragment + plural-prune position"
---

## Goal

**Feature Goal**: Rewrite query ranking to the 2026-10 owner rule (spec §04
h2.29): `compareRankedMatches` becomes a 4-key total order — **tier desc →
sessionCount desc within tier → shorter key → byte-lex** — replacing the
retired 2026-09 content-derived order (length → byte-lex). `RankedMatch`
gains a numeric `sessionCount` field (salience stays as a carried
diagnostic; it never orders). The zero-fragment listing (`#` alone: no
tiers) becomes sessionCount desc then the same ties. Plural pruning stays
after sort, before the limit slice — unchanged mechanics, re-based tests.

**Deliverable**: Modified `src/core/query.ts` (comparator + tier/sessionCount
carry through `rankMatches`) + `src/core/types.ts` (`RankedMatch` field);
rewritten ranking tests in `test/query.test.ts`; one comment update in
`src/pi/provider.ts` (~L603).

**Success Definition**: A 1-count exact-prefix word outranks a 40-count
scattered match; counts reorder ONLY same-tier neighbors; ties resolve
shorter-then-lex; `#` alone lists by sessionCount; pruned plurals never
consume a slot under the new order; `npm run check` + `npm test` green.

## Why

- Spec §04 h2.29 (2026-10 settled): among equally strict matches the more
  conversation-relevant word (higher session count) belongs leftmost.
  Salience still decides MEMBERSHIP (admission/eviction) but never orders —
  only its raw `sessionCount` component does, within tiers.
- This order is what the widget renders left→right (P1.M3.T1.S2) and the
  provider fallback path (provider.ts ~L583) returns.

## What

1. **`RankedMatch` (src/core/types.ts ~L164)**: add `sessionCount: number`.
   Keep `salience` (diagnostic only — spec: it never orders) and
   `description` (`"session x" + sessionCount`, unchanged). The pinned
   EXACTLY-4-field contract becomes 5 fields — test/query.test.ts:167-178
   ("every result carries exactly the four RankedMatch fields") and
   provider.ts:626-630's mapping move in LOCKSTEP with this change.
2. **`compareRankedMatches` (src/core/query.ts ~L73-78)**: new body —
   tier desc, then sessionCount desc, then key length, then byte-lex.
   To compare tiers, `rankMatches` must carry each match's `tier` (from
   `matchFragment`, P1.M2.T1.S1 — already returns `{tier, score}`) through
   to the sort. Recommended: sort an internal `{m: RankedMatch, tier}`
   array (or attach tier pre-sort and strip after), then plural-prune,
   then slice. The comparator itself stays exported for tests — either
   widen its signature to take the tier-carrying shape or keep
   `compareRankedMatches(a, b)` on RankedMatch using `a.sessionCount` for
   keys 2–4 and document that tier (key 1) is applied by the caller's
   pre-grouped sort. **Decision: put tier ON the internal record and give
   the exported comparator the 4-key shape `(a: {tier, m}, b: {tier, m})`;
   update the JSDoc + module doc that today say "content-derived …
   salience never sorts".**
3. **Threshold gate before ranking**: already P1.M2.T1.S2's (in flight) —
   below-`fuzzThreshold` matches discard BEFORE the sort. Do not
   re-implement; your input is the threshold-filtered set.
4. **Zero-fragment** (empty prefix, `#` alone): no tiers apply — order is
   sessionCount desc → shorter → byte-lex. Keep whatever zero-fragment
   listing path exists today (it bypasses the fuzz gate per S3's contract)
   and re-point its ordering.
5. **Limits**: `maxSuggestions`/`opts.limit` stays the return cap;
   `limit <= 0 → []` unchanged.
6. **Plural pruning**: block at query.ts ~L289-312 (after sort, before
   slice) — mechanics UNCHANGED; re-base its tests to the new order.
7. **provider.ts ~L603**: comment currently says "items[0] is rankMatches'
   top (salience desc → shorter → lexicographic)" — update to the new
   order ("tier desc → sessionCount desc → shorter → lex"). No logic
   change there (items[0] is still rankMatches' top by construction).

### Success Criteria

- [ ] 1-count tier-3 outranks 40-count tier-1 (strictness always first)
- [ ] sessionCount reorders ONLY same-tier neighbors (tier boundary never crossed by counts)
- [ ] Ties: shorter key, then byte-lex (valid total order)
- [ ] Zero-fragment: sessionCount desc then ties; no tiers
- [ ] `RankedMatch.sessionCount` numeric; description/salience unchanged
- [ ] Plural pruning before the limit slice under the new order; slot-freed case re-based
- [ ] provider.ts:603 comment updated; no behavior change in provider

## All Needed Context

### Context Completeness Check

An implementer needs: the current comparator/rankMatches/plural-prune code
(quoted/sketched below), the upstream matchFragment + threshold-gate
contracts, the exact test blocks to rewrite (with line anchors), the
RankedMatch consumers, and the store's Candidate shape (sessionCount
field). All below.

### Documentation & References

```yaml
- file: src/core/query.ts
  why: THE file. compareRankedMatches ≈L73-78 (length→byte-lex today,
        "content-derived" JSDoc); rankMatches ≈L218+: lowercases prefix,
        prefixRange snapshot, builds matches, sorts, plural-prunes
        (≈L289-312, the matches.length>1 keySet/filter/slice block),
        slices to limit. matchFragment (S1, done) returns
        {tier: 1|2|3, score} — your tier source. RankOptions already has
        limit (+ fuzzThreshold arriving from S3).
  pattern: exported comparator + baked constants + dense JSDoc citing
           spec sections; no magic numbers.

- file: src/core/types.ts
  why: RankedMatch ≈L164-169 — exactly key/display/description/salience
        today. Add sessionCount: number with a JSDoc citing §04 h2.29
        key 2. Candidate (store entry) already carries sessionCount —
        copy from the store entry when building the match.

- file: test/query.test.ts
  why: The bulk of the subtask is rewriting this suite's ordering
        expectations. Verified anchors: expectedOrder oracle ≈L66-79
        (filter startsWith, sort length→byte-lex — REWRITE to the 4-key
        math incl. tier via matchFragment); result-shape describe
        ≈L141-178 (4-field pin at ~167 becomes 5; add sessionCount
        assertion); ordering describe ≈L181-257 (salience-never-reorders
        case INVERTS — counts DO reorder same-tier now); limits describe
        ≈L243-286 (top-3 expectations re-derive); plural describe ≈L407+
        (guard cases + the slot-freed limit:2 case at ~L441 re-based).
  pattern: describe/it, put() upsert helper (times = sessionCount),
           sighting overrides, per-case WHY comments.
  gotcha: grep first — the research note's line numbers (:181-257,
        :295-310, :322-333) are approximate; trust grep over the note.

- file: plan/003_bbac3b15e8d0/P1M2T1S2/PRP.md
  why: Upstream contract (in flight): the admission-score + threshold
        discard runs BEFORE ranking in rankMatches; fuzzThreshold absent
        = default. Your sort receives its survivors. Do not re-gate.

- file: plan/003_bbac3b15e8d0/P1M2T1S3/PRP.md
  why: Sibling (in flight): fuzzThreshold config surface +
        provider pass-through at ~L583. No overlap with your comparator
        work; do not touch config.ts or the provider call site's options.

- file: src/pi/provider.ts
  why: ~L603 comment ("salience desc → shorter → lexicographic") —
        stale after this task; update text only. Mapping at ~L605-610
        (value/label/description from m) unaffected by the new field.
  gotcha: provider re-spreads config per query; nothing else to do there.

- file: spec/04-*.md (h2.29)
  why: Authoritative rule text — quoted verbatim in this PRP's refs
        (the selected PRD content above).
```

### Current Codebase tree (relevant)

```bash
src/core/query.ts       # MODIFY: comparator, tier carry, zero-fragment order, JSDoc
src/core/types.ts       # MODIFY: RankedMatch.sessionCount
test/query.test.ts      # REWRITE ordering/oracle/shape/limit/plural expectations
src/pi/provider.ts      # MODIFY: one comment (~L603)
```

### Desired Codebase tree with files added

```bash
# no new files — modifications only
```

### Known Gotchas & Library Quirks

```typescript
// TIER IS NOT ON RankedMatch (deliberate — the widget/provider never
// consume it). Carry tier on an INTERNAL sort record, strip before
// return: the exported RankedMatch stays the 5-field public contract.

// sessionCount COMES FROM THE STORE ENTRY, not from salience arithmetic:
// matches are built from Candidate entries (c.sessionCount). Copy it.

// COUNTS REORDER ONLY SAME-TIER NEIGHBORS — pin this asymmetrically:
// within one tier, higher count first; ACROSS tiers, count is invisible
// (the 1-vs-40 headline case). Both directions need tests.

// ZERO-FRAGMENT HAS NO matchFragment CALL (empty fragment → null by
// contract) — the zero-fragment path is rankMatches' own special case;
// it must not attempt tier computation. Order: sessionCount desc →
// shorter → lex.

// STABILITY CLAIM (JSDoc): two candidates reorder relative to each other
// ONLY when one's sessionCount strictly passes the other's — same-tier
// churn is the owner-accepted cost; tiers + rules 3-4 stay
// content-derived.

// PLURAL PRUNING STILL RUNS POST-SORT: the singular/prural drop uses the
// keySet — order-independent — but the slot-freed limit test's expected
// array changes because the pre-slice order changed. Re-derive, don't
// patch.

// PATH KEYS (up to 96 chars, P1.M1.T2.S3) flow through the same order —
// length tiebreak now sits at key 3, so long paths lose to short words
// at equal tier+count; that is correct per h2.29, no special-casing.

// THE OLD "salience never sorts" MODULE DOC is now half-wrong: the FULL
// salience score still never sorts, but its sessionCount component is
// key 2. Reword precisely, don't delete the membership/eviction point.

// DESCRIPTION STAYS "session x" + sessionCount (ASCII x) — the new field
// and the description must agree in tests.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: TDD — rewrite test/query.test.ts expectations FIRST
  - REWRITE expectedOrder oracle (~L66-79): filter + matchFragment per
    candidate (anchor + tiers, mirroring production) + sort by the 4-key
    math. Keep it independent of query.ts's comparator.
  - REWRITE ordering describe (~L181-257): headline 1-count-tier3 vs
    40-count-tier1; same-tier count reorder (both directions); shorter/
    lex ties at equal tier+count; equal-count same-tier lex case.
  - UPDATE result-shape describe (~L141-178): 5-field pin; assert
    m.sessionCount === the store entry's count; description agreement.
  - UPDATE limits describe (~L243-286): re-derive top-3 arrays under the
    new order; limit 0 / -1 → [] cases unchanged.
  - UPDATE plural describe (~L407+): guards unchanged in intent; re-derive
    the slot-freed limit:2 expected array (~L441) under the new order.
  - ADD zero-fragment describe: '#' alone (empty prefix) → sessionCount
    desc → shorter → lex; no tier effect (craft two matches where the
    tier rule WOULD invert if wrongly applied — e.g. a tier-3-ish
    short-prefix word vs a higher-count word — and assert count wins).
  - Run: FAIL against current comparator.

Task 1: MODIFY src/core/types.ts — RankedMatch.sessionCount
  - ADD field after `salience` (or after `key` — pick display order that
    reads well) with §04 h2.29 JSDoc.

Task 2: MODIFY src/core/query.ts
  - REWRITE compareRankedMatches: signature over the internal
    {tier, m} record; 4-key body; full JSDoc (2026-10 rule, retired
    order noted as history, stability claim).
  - rankMatches: build {tier, m, sessionCount-carrying} records via
    matchFragment per candidate (zero-fragment path: tier-agnostic
    records); sort; plural-prune; strip to RankedMatch[]; slice.
  - REWORD the module doc + rankMatches JSDoc ("content-derived" → the
    new order; salience-membership point preserved).
  - DO NOT touch: matchFragment, the threshold gate (S2), RankOptions
    surface (S3), prefixRange (T2.S2 generalizes it — yours only needs
    today's scan to keep working).

Task 3: MODIFY src/pi/provider.ts — comment only (~L603)
  - "items[0] is rankMatches' top (tier desc → sessionCount desc →
    shorter → lexicographic) — never re-sorted."

Task 4: VALIDATE
  - npm run check
  - npx vitest --run test/query.test.ts -v
  - npm test   # full suite — chain/provider tests consuming rankMatches
               # order may need ONLY order-expectation touch-ups in
               # THEIR files if they pinned order; check failures,
               # re-derive per the new rule (do not weaken assertions)
```

### Implementation pattern

```typescript
// Internal sort record (sketch)
interface SortRec { tier: number; m: RankedMatch }
export function compareRankedMatches(a: SortRec, b: SortRec): number {
  if (a.tier !== b.tier) return b.tier - a.tier;           // key 1: strictness
  const ca = a.m.sessionCount, cb = b.m.sessionCount;
  if (ca !== cb) return cb - ca;                            // key 2: frequency
  if (a.m.key.length !== b.m.key.length)
    return a.m.key.length - b.m.key.length;                 // key 3: shorter
  return a.m.key < b.m.key ? -1 : a.m.key > b.m.key ? 1 : 0; // key 4: byte-lex
}
```

### Integration Points

```yaml
NONE this task:
  - Downstream (do NOT implement): P1.M2.T2.S2 generalizes prefixRange
    to first-char buckets (perf gate re-basing) — orthogonal to order;
    P1.M3.T1.S2 renders this order left→right; P1.M2.T3.S1 chain gating
    consumes rankMatches membership, not order.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/query.test.ts -v
npm test   # full suite green
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green (incl. in-flight S2/S3 suites)

### Feature Validation

- [ ] 4-key order implemented and pinned (both directions of the count rule)
- [ ] Zero-fragment: sessionCount desc + ties, no tiers
- [ ] RankedMatch 5 fields; sessionCount agrees with store + description
- [ ] Plural pruning before limit slice; slot-freed case re-based and passing
- [ ] provider comment updated; no provider behavior change

### Code Quality Validation

- [ ] Tier never leaks onto RankedMatch; internal record stripped before return
- [ ] JSDoc precise: full salience never orders, sessionCount component is key 2
- [ ] No comparator magic numbers; spec citations in doc comments

## Anti-Patterns to Avoid

- ❌ Don't sort by salience (or let it break ties) — only raw sessionCount, within tiers
- ❌ Don't add tier to the public RankedMatch — internal carry only
- ❌ Don't reorder the pipeline (gate → sort → prune → slice stays)
- ❌ Don't touch matchFragment, the threshold gate, RankOptions, prefixRange, or config
- ❌ Don't patch old expectations to "whatever passes" — re-derive from the 4-key rule
- ❌ Don't special-case path keys or chains in the comparator
