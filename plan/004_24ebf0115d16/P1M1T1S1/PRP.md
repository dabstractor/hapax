# PRP — P1.M1.T1.S1 (plan 004): Anchorless matcher, ambient fallback, tier slot, RankedMatch.tier diagnostic

---

## Goal

**Feature Goal**: Implement spec/04 h2.28 tier-0 — an AMBIENT anchorless
contiguous-run fallback in `rankMatches` that fires only when the anchored
scan (tiers 1–3) admits zero records and the fragment is ≥3 chars, scanning
the full store with `score = 85 − 40·(runStart/len(key))`, threshold-gated.
Also add `RankedMatch.tier` as an optional public diagnostic (match path
only) and widen `MatchResult.tier` to `0|1|2|3`.

**Deliverable** (all in `src/core/query.ts` + `src/core/types.ts` +
`test/query.test.ts`):
- `export const TIER0_BASE_SCORE = 85` / `TIER0_SKIP_FACTOR = 40`
- Ambient tier-0 pass inside `rankMatches` (after the anchored loop, before
  sort; precondition `lower !== "" && recs.length === 0 && lower.length >= 3`)
- `MatchResult.tier: 0 | 1 | 2 | 3` (query.ts ~line 130)
- `RankedMatch.tier?: 0|1|2|3` (types.ts ~line 164, currently exactly 5
  fields) — populated on the match path, OMITTED on zero-fragment listings
- TDD pins per spec/09 query.test.ts bullet

**Success Definition**: esk→zendesk (74) and query→src/core/query.ts (64)
pass; 1–2-char fragments never fire tier-0; a non-empty anchored result is
byte-identical to pre-tier-0 output; comparator rows 3>2>1>0; the
five-field pin at test/query.test.ts:191 updated to the new shape; full
`npm test` + `npm run check` green. Loose mode (`#` always-consult) is
**P1.M1.T2.S2 — NOT this task**; the `RankOptions` loose flag is NOT added
here.

## Why

The anchored matcher cannot serve mid-word recall (`esk`→`zendesk`) or
rule-4d path-filename entry (`query`→`src/core/query.ts` — path tokens are
opaque to subword splitting, so nothing else serves it). Spec 2026-10 owner
rule: when the anchored scan returns ZERO results, one full-store
anchorless pass may rescue a menu that would not otherwise appear — it can
never enrich a menu that would already open, so the never-hijack profile is
preserved (~5–20% of common words summon a one-shot cousin menu that
narrows away; morphological cousins like said→unsaid accepted by the owner).
The public `tier` diagnostic is required downstream: P1.M1.T2.S2's chain-arm
suppression reads `tier === 0` (anchorless matches never arm a chain), and
the zero-fragment listing path must keep omitting it so `tier === 0`
unambiguously means anchorless match.

## What

Per spec/04 h2.28 tier-0 (AMBIENT mode only):

- Precondition (all three): `lower !== ""`, the anchored loop admitted ZERO
  records, `lower.length >= 3`.
- ONE anchorless pass over the full store: `prefixRange("")` → `[0, n)`,
  then `sortedKeysSnapshot()` (call prefixRange BEFORE the snapshot — the
  module's ordering invariant; this is the zero-fragment-listing pattern).
- Per key: `runStart = key.indexOf(lower)`; skip when `-1`;
  `score = clampScore(Math.round(TIER0_BASE_SCORE − TIER0_SKIP_FACTOR · runStart / key.length))`;
  strict `score < threshold` discard (`==` survives, matching the anchored
  gate); record `tier: 0`.
- `store.get(k)` undefined-check skips evicted ghosts (same as anchored loop).
- Plural pruning + limit slice run AFTER the fallback fills recs — existing
  machinery unchanged (fallback records are ordinary records).
- `runStart = 0` cannot admit in ambient mode (position-0 run ⇒ anchored
  tier-3 at 100 ⇒ recs non-empty) — implement plain `indexOf`; the "either
  placement" arm of the spec is formally satisfied by the anywhere arm.
- Public `RankedMatch.tier` populated ONLY on the match path; zero-fragment
  listing items OMIT it.
- Comparator UNCHANGED (`b.tier - a.tier` already sorts 0 below 1).

### Success Criteria

- [ ] `rankMatches(store, "esk")` with only `zendesk` stored → 1 result,
      `key: "zendesk"`, `tier: 0`, `score: 74` (via exported constants)
- [ ] `rankMatches(store, "query")` with `src/core/query.ts` stored →
      tier 0, score 64
- [ ] 1–2-char fragments with zero anchored results → `[]` (floor 3)
- [ ] Non-empty anchored result → output byte-identical to pre-tier-0
      (fallback does not run / does not merge)
- [ ] Late runs gate at default 60 (pass band runStart/len ≤ 0.625)
- [ ] Comparator rows 3 > 2 > 1 > 0
- [ ] test/query.test.ts:191 shape pin updated: match-path results carry
      `tier`; `#`-alone listing items do NOT
- [ ] `npm run check` green (MatchResult union consumers typecheck)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the current rankMatches body
(reproduced with line anchors), the exact insertion points, the score
arithmetic pre-verified, the test fixtures/oracle conventions, and the
dual-meaning tier-0 trap are all below.

### Documentation & References

```yaml
- file: src/core/query.ts
  why: PRIMARY file. Verified structure:
    - Exported constants (lines 87–92): TIER3_SCORE=100, TIER2_BASE_SCORE=85,
      TIER2_SKIP_FACTOR=40, TIER1_BASE_SCORE=50, TIER1_GAPRUN_PENALTY=5,
      TIER1_GAPCHAR_CAP=15; DEFAULT_FUZZ_THRESHOLD=60 (line 107);
      RankOptions {limit?, fuzzThreshold?} (lines 111–121).
    - MatchResult interface (line ~129): `tier: 1 | 2 | 3; score: number;`
      → widen union to `0 | 1 | 2 | 3` and extend its JSDoc.
    - clampScore (line 137): `n => (n < 0 ? 0 : n > 100 ? 100 : n)`.
    - matchFragment (line ~200): returns tier 1–3 or null; unchanged.
    - rankMatches (lines 352–443): control flow —
        limit guard; `lower = prefix.toLowerCase()` (BEFORE prefixRange);
        `const bucket = lower === "" ? "" : lower[0];`
        `const [start, end] = store.prefixRange(bucket);`  ← ordering invariant:
          prefixRange rebuilds a dirty index; only a snapshot taken AFTER is valid
        `const keys = store.sortedKeysSnapshot().slice(start, end);`
        `const threshold = opts.fuzzThreshold ?? DEFAULT_FUZZ_THRESHOLD;`
        anchored loop: `if (lower !== "") { const m = matchFragment(lower, k);
          if (m === null || m.score < threshold) continue; tier = m.tier; }`
        `const c = store.get(k); if (!c) continue; recs.push({tier, m: {...}})`
        → `recs.sort(compareRankedMatches);`
        → `const matches = recs.map((r) => r.m);`   ← STRIP SITE (copy tier here)
        → plural pruning + `.slice(0, limit)`.
    - INSERTION POINT for the fallback: after the anchored loop closes,
      before `recs.sort(...)`.
    - RankedSortRecord internal type: `tier` already `number` — no change.
  pattern: baked-constant JSDoc convention ("calibration starting points
    per §09 tuning protocol; tier boundaries are semantics, never tunable")
    — TIER0 constants follow TIER1/2/3's pattern exactly.
  gotcha: the ONLY existing `tier: 0` is the zero-fragment listing sentinel
    (`let tier = 0; // zero-fragment: tier-agnostic records`) — mutually
    exclusive with the match path, but the dual meaning MUST be pinned with
    a comment so it doesn't silently bite (see system_context §Chain-arm
    reality: public tier===0 is the anchorless signal).

- file: src/core/types.ts
  why: RankedMatch (line ~164) — exactly 5 fields today (key, display,
    description, salience, sessionCount), PINNED by test/query.test.ts:191.
    Add `tier?: 0 | 1 | 2 | 3` with a doc comment in the sessionCount
    precedent style: populated only on the match path (anchored 1–3,
    anchorless 0); OMITTED by zero-fragment listing items so `tier === 0`
    unambiguously means anchorless match; diagnostic only — ordering uses
    the internal record, this field never sorts.
  gotcha: optional field — JSON/toEqual comparisons of listing items are
    unaffected only if you OMIT the key (don't set undefined explicitly
    where toEqual would distinguish; check how the strip/map site builds it).

- file: test/query.test.ts
  why: TDD target. Verified conventions:
    - `put(s, key, times=1, ordinal=1, over?)` helper (line 73) upserts a
      `sighting({key, display: key, ...})` into a `new CandidateStore()`.
    - A local ordering oracle `expected order per 2026-10 menu order`
      (line ~86) mirrors rankMatches; if you extend the oracle to tier-0,
      keep it in sync or exclude fallback fixtures from it.
    - Line 191: `it("every result carries exactly the five RankedMatch
      fields")` — assert Object.keys(m).sort() equals the 5-name array,
      over rankMatches(s, "al") with put(s,"alpha")/put(s,"alpine",2).
      UPDATE to six fields on the match path + a NEW case asserting the
      '#'-alone listing (rankMatches(s, "")) items do NOT carry tier.
    - Comparator-level fixtures at line ~296 use a local `rec(tier, key,
      sessionCount)` — add the 0 row there (e.g. rec(0,...) loses to
      rec(1,...)) OR via a store-level tier-mixed fixture.
    - Score assertions compute expected values FROM THE EXPORTED CONSTANTS
      (single-sourced — existing convention, header line 7).
  pattern: one describe block, e.g. describe("rankMatches — tier-0
    anchorless ambient fallback (2026-10, spec §04 h2.28)").

- docfile: plan/004_24ebf0115d16/architecture/tier0_design.md
  section: §1–§2 (this task) — binding implementation design, verified
    against source. §3–§4 (loose mode) are P1.M1.T2 — do NOT implement.
  critical: "Export dedicated TIER0_BASE_SCORE = 85 / TIER0_SKIP_FACTOR = 40
    ... Do NOT inline literals." and the dedup note belongs to loose mode —
    in AMBIENT mode the fallback runs only on empty recs, so no dedup is
    needed (precondition guarantees disjointness).

- docfile: plan/004_24ebf0115d16/architecture/system_context.md
  why: rankMatches control flow with verified line numbers + the
    §Chain-arm reality note (why listing items must omit tier).

- prd: spec/04 h2.28 tier-0 paragraph + h2.29 ranking + spec/09 query.test.ts
    tier-0 bullet — all reproduced in selected_prd_content; the tier-0
    PERF budget (<3 ms p99) is P1.M1.T1.S2's gate, not this task's concern.
```

### Current Codebase tree (relevant excerpt)

```bash
hapax/
├── src/core/
│   ├── query.ts       # MODIFY (constants + fallback + strip-site + MatchResult union + JSDoc)
│   └── types.ts       # MODIFY (RankedMatch.tier optional field + doc)
└── test/
    └── query.test.ts  # MODIFY (new describe block + shape-pin update)
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL — dual meaning of internal tier 0: the zero-fragment listing
#   sentinel (let tier = 0 in the anchored loop, mutually exclusive with
#   match records) vs the NEW anchorless tier 0. Internal sort record is
#   fine (comparator b.tier - a.tier already handles 0<1); the PUBLIC
#   RankedMatch.tier disambiguates by OMITMENT on listing items. Pin with
#   comments at both sites.
# CRITICAL — ordering invariant: call prefixRange("") BEFORE
#   sortedKeysSnapshot() in the fallback (the anchored path already
#   respects it; a dirty-index rebuild between calls would desync get()).
#   The fallback's own snapshot must be taken fresh (do NOT reuse the
#   bucket-sliced `keys`).
# CRITICAL — precondition is THREE-part: lower !== "" AND recs.length===0
#   AND lower.length >= 3. Missing the floor lets "ze"-class fragments
#   flood; missing the empty check merges fallback into anchored results
#   (breaking the byte-identical isolation pin).
# GOTCHA — score arithmetic uses Math.round + clampScore, matching the
#   tier-2 precedent; verified values: esk→zendesk: runStart 2, len 7 →
#   85−40·(2/7)=73.57→74; query→src/core/query.ts: runStart 9, len 17 →
#   85−40·(9/17)=63.82→64; default-60 pass band: runStart/len ≤ 0.625.
# GOTCHA — strict threshold gate (score < threshold discard; == survives)
#   exactly like the anchored loop.
# GOTCHA — runStart=0 cannot admit ambient (implies anchored tier-3 at 100,
#   so recs non-empty); plain indexOf is the operative arm — no special case.
# GOTCHA — test/query.test.ts's local oracle (line ~86) hardcodes tier
#   semantics for the anchored path; if the fallback fixtures flow through
#   rankMatches directly (recommended), no oracle change is needed.
# GOTCHA — purity: query.ts is core-layer (no pi imports); the fallback is
#   pure store math; do NOT add any option/flag (loose mode is T2).
```

## Implementation Blueprint

### Data models and structure

```typescript
// query.ts — new constants beside TIER1_* (lines ~90–92):
/** Tier-0 anchorless base score / skip penalty (spec §04 h2.28, 2026-10):
 *  contiguous-run matches anywhere in the key, resorted to only when the
 *  anchored scan admits nothing. Numerically equal to the tier-2 pair but
 *  a DISTINCT semantic (runStart counts from 0; no anchor consumed) —
 *  exported separately so tuning never silently couples the tiers.
 *  Calibration starting points (§09 tuning protocol), never inlined. */
export const TIER0_BASE_SCORE = 85 as const;
export const TIER0_SKIP_FACTOR = 40 as const;

// MatchResult (line ~130):
export interface MatchResult {
  tier: 0 | 1 | 2 | 3;   // widened
  score: number;
}

// types.ts RankedMatch (line ~164) — new optional field:
/** Strictness tier diagnostic (spec §04 h2.28): populated ONLY on the
 *  match path (anchored 1–3, anchorless 0); OMITTED by zero-fragment
 *  listing items, so `tier === 0` unambiguously means an anchorless
 *  match (which never arms a successor chain). Never order-determining —
 *  the internal sort record carries the order key. */
tier?: 0 | 1 | 2 | 3;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: TDD — ADD tier-0 cases to test/query.test.ts FIRST
  - IMPORT TIER0_BASE_SCORE, TIER0_SKIP_FACTOR; compute expected scores
    from them (single-sourced convention):
      esk: TIER0_BASE - TIER0_SKIP*2/7 → Math.round → 74
      query: TIER0_BASE - TIER0_SKIP*9/17 → Math.round → 64
  - describe("rankMatches — tier-0 anchorless ambient fallback") cases:
      it("'esk' → 'zendesk' at tier 0, score 74, when anchored is empty")
      it("'query' → 'src/core/query.ts' at tier 0, score 64 (path filename entry)")
      it("floor 3: 1–2-char fragments with zero anchored results → []")
      it("non-empty anchored result is byte-identical (fallback does not run)")
        // e.g. put zendesk + a 'z...' anchored match; rank 'esk'-adjacent case
        // where anchored yields ≥1 → assert no tier-0 items merged
      it("late runs gate at default 60: runStart/len > 0.625 → discarded")
        // construct e.g. key of len 10 with runStart 7 → 85-28=57 < 60 → []
      it("explicit fuzzThreshold gates the fallback too (e.g. 75 rejects the 64)")
      it("plural pruning applies to fallback results before the limit slice")
      it("zero-fragment listing items OMIT tier (rankMatches(s,'') items have
          no tier key)")
  - UPDATE line-191 shape pin: match-path results carry exactly six fields
    (…, "tier"); keep the '#'-alone omission as its own case.
  - RUN → RED (constants not exported).

Task 2: IMPLEMENT constants + MatchResult widening (query.ts)
  - TIER0_BASE_SCORE / TIER0_SKIP_FACTOR per blueprint; MatchResult union
    widened + JSDoc extended.

Task 3: IMPLEMENT the ambient fallback (rankMatches)
  - After the anchored loop, before recs.sort:
      if (lower !== "" && recs.length === 0 && lower.length >= 3) {
        const [fs, fe] = store.prefixRange("");       // full store, BEFORE snapshot
        const allKeys = store.sortedKeysSnapshot().slice(fs, fe);
        for (const k of allKeys) {
          const runStart = k.indexOf(lower);
          if (runStart === -1) continue;
          const score = clampScore(Math.round(
            TIER0_BASE_SCORE - TIER0_SKIP_FACTOR * runStart / k.length));
          if (score < threshold) continue;            // strict gate, == survives
          const c = store.get(k);
          if (!c) continue;                            // evicted ghost
          recs.push({ tier: 0, m: { key: c.key, display: c.display,
            description: `session x${c.sessionCount}`,
            salience: salience(c, ordinal), sessionCount: c.sessionCount,
            tier: 0 } });                              // public diagnostic
        }
      }
  - NOTE the m-object now carries tier on the match path.

Task 4: STRIP-SITE + comments (query.ts)
  - The public record is built in TWO places (anchored loop push + fallback
    push): set tier in BOTH match-path pushes; the zero-fragment push OMITS
    it (add the pin comment: internal sort tier 0 for listings ≠ public
    anchorless tier 0).
  - REWRITE the "deliberately NOT on RankedMatch" JSDoc (~lines 263–273
    area / the recs.map comment "strip the internal tier before return"):
    the map now COPIES tier into the public record on the match path —
    the comment must describe the new populate/omit contract.
  - Module header (lines ~19–35): extend the tier-order summary to
    3 > 2 > 1 > 0 and note the ambient-only precondition.

Task 5: types.ts RankedMatch.tier field + doc (blueprint above).

Task 6: FULL REGRESSION
  - npm run check   (MatchResult union consumers typecheck)
  - npm test        (query suite green; provider/widget suites unaffected —
                    they consume RankedMatch structurally, optional field is
                    additive; shape-pin assertions elsewhere: grep
                    'Object.keys' test/ for sibling field-count pins)
```

### Implementation Patterns & Key Details

```typescript
// The byte-identical isolation pin (the fallback's safety property):
// anchored non-empty ⟹ the `if` guard is false ⟹ zero behavior delta.
// Pin it with a fixture that ALSO has a latent tier-0 match in the store:
//   put(s, "zendesk"); put(s, "zebra");
//   rankMatches(s, "ze") → anchored tier-3 ["zebra", "zendesk"], and NO
//   change vs pre-tier-0 (snapshot the expected array literally).
// Perf shape (context for S2's gate): full-store scan only on the empty
// path; the anchored <1 ms budget is untouched. Do not add caching here.
```

### Integration Points

```yaml
DOWNSTREAM (do NOT implement, just keep seams honest):
  - P1.M1.T1.S2: perf gate times the new pass (< 3 ms p99 at 20k cap).
  - P1.M1.T2.S2: loose mode flips the precondition to always-consulted via
    a RankOptions flag + dedup (anchored record wins); chain-arm suppression
    reads RankedMatch.tier === 0. Your optional-field omit-contract is what
    makes `tier === 0` unambiguous.
CONSUMERS TODAY: provider.ts / widget.ts map RankedMatch to items
  structurally — the optional tier field rides along harmlessly.
PERF BUDGET SPLIT (spec h2.28 "Performance"): anchored scan keeps <1 ms;
  tier-0 carries its own <3 ms p99 budget (S2's gate, this task must merely
  not add anything to the anchored path).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — MatchResult/RankedMatch consumers typecheck
```

### Level 2: Unit Tests (TDD)

```bash
npx vitest --run test/query.test.ts              # new block + updated pins green
npx vitest --run test/query.test.ts -t "tier-0" -v
npm test
```

### Level 3: Integration (downstream consumers)

```bash
npx vitest --run test/provider-live.test.ts test/provider.test.ts test/chain.test.ts
# optional-field addition is additive; these must stay green unchanged
```

### Level 4: Domain-Specific (spec exemplars, hand-checkable)

```bash
npx vitest --run test/query.test.ts -t "anchorless"
# esk→zendesk 74 | query→src/core/query.ts 64 | floor 3 | isolation pin |
# late-run gate | shape pins (six fields / listing omits tier)
```

## Final Validation Checklist

- [ ] TIER0_BASE_SCORE=85 / TIER0_SKIP_FACTOR=40 exported (never inlined)
- [ ] Ambient fallback: 3-part precondition, prefixRange-before-snapshot, strict gate, ghost skip
- [ ] esk→74 and query→64 pins green (scores computed from exported constants)
- [ ] Byte-identical isolation pin green; floor-3 pin green
- [ ] MatchResult.tier widened; RankedMatch.tier optional field with omit-contract doc
- [ ] Line-191 shape pin updated; listing-omits-tier case added
- [ ] Comparator rows 3>2>1>0 pinned
- [ ] Loose mode NOT added (no RankOptions change); anchored path untouched
- [ ] Strip-site/zero-fragment/module-header comments rewritten (Mode A docs ride with code)
- [ ] `npm run check` + `npm test` fully green

## Anti-Patterns to Avoid

- ❌ Don't inline 85/40 — dedicated TIER0 constants (distinct semantics from TIER2, never coupled)
- ❌ Don't run the fallback when anchored results exist (isolation is a spec property, not an optimization)
- ❌ Don't reuse the bucket-sliced `keys` — fresh prefixRange("") + snapshot in the fallback
- ❌ Don't set tier on zero-fragment listing items (breaks the tier===0 anchorless signal for T2.S2)
- ❌ Don't add the loose flag / TRIGGER_FUZZ_THRESHOLD / dedup (P1.M1.T2)
- ❌ Don't round or gate differently than the anchored path (Math.round + clampScore + strict <)
- ❌ Don't add caching or perf workarounds (S2 measures; measured 1.1–2.6 ms is in budget)

---

**Confidence Score**: 9/10 — rankMatches' control flow, insertion points,
constants, strip-site, and test conventions were all read from live source
this session; the design doc §1–§2 was verified against that source; score
arithmetic pre-checked. The only residual freedom (fixture wording) is
pinned by outcome-based exemplars.
