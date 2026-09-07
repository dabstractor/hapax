# PRP — P1.M2.T5.S1: rankMatches — prefix search + salience ranking + top-N

## Goal

**Feature Goal**: Implement `rankMatches(store, prefix, opts): RankedMatch[]` in a new
`src/core/query.ts` — the synchronous query-time stage of the core pipeline
(segment → shapeGate → score → store → **query**). It lowercases the prefix,
gathers candidates from the store's prefix index, ranks them by salience via
`compareCandidates`, and returns the top `opts.limit` (default 8) as
`RankedMatch` objects. This runs on EVERY keystroke (called from the provider,
P1.M3.T3.S2) and must complete in < 1 ms on a 20k-candidate store.

**Deliverable**:
1. `src/core/query.ts` — `rankMatches()` + `RANK_OPTS` defaults (limit 8) +
   an optional suppression hook parameter (M2 extension seam).
2. `test/query.test.ts` — full unit suite per PRD §09.

**Success Definition**: `npm run check` and `npm test` pass; ranking order
matches PRD §04 h2.26 exactly (salience desc → shorter key → byte-lex);
case-insensitive prefix matching with display-casing insertion values
(`nrel` → `NREL`); empty prefix range → `[]`; top-N truncation at 8 default.

## Why

- PRD §02 h3.1 (query path, synchronous, every keystroke): "prefix search the
  store, score-sort, return top 8 items … must complete in < 1 ms. No
  allocation-heavy work; the store's prefix index is maintained at ingest
  time."
- PRD §04 h2.26 (query ranking): salience desc → shorter first → byte order;
  top 8 (menu height).
- PRD §04 h2.27 (case handling): matching case-insensitive, insertion uses
  display casing, store keys lowercase.
- Downstream: `src/pi/provider.ts` (P1.M3.T3.S2) calls this on every
  keystroke and maps `RankedMatch[]` → pi's `AutocompleteItem
  { value, label, description }`. An empty result tells the provider to
  delegate (never an empty menu) — rankMatches just returns `[]`.
- Forward-compat: M2 phrase constituent suppression (P2.M1.T3.S1) EXTENDS
  this function via an optional hook parameter — keep the signature open.

## What

### Behavior contract

1. **Signature** (exact):
   ```ts
   export interface RankOptions {
     /** max results; default 8 (maxSuggestions / menu height, PRD §04) */
     limit?: number;
     /** M2 extension seam (P2.M1.T3.S1): return true to suppress a
      *  candidate (phrase-constituent suppression). Default: nothing
      *  suppressed. Applied BEFORE salience math. */
     suppress?: (c: Candidate) => boolean;
   }
   export function rankMatches(
     store: CandidateStore,
     prefix: string,
     opts: RankOptions = {},
   ): RankedMatch[];
   ```
2. **Lowercase the prefix** (case-insensitive matching, h2.27). Do this
   BEFORE calling `prefixRange` — it throws `RangeError` on non-lowercase
   input (deliberate caller-bug guard in store.ts). `rankMatches` itself
   must accept any casing (`"Nre"` works).
3. **Gather**: `store.prefixRange(lower)` → `[start, end)`; walk the sorted
   key array in that range and `store.get(key)` each Candidate. See Gotchas
   for how to read the keys in-range.
4. **Suppress** (if `opts.suppress` given): filter candidates out before
   scoring. M1 callers never pass it.
5. **Rank**: sort via `compareCandidates(a, b, store.currentOrdinal())`
   imported from `./score.js` — NEVER reimplement salience or comparator
   math (score.ts is the single source of truth).
6. **Top-N**: take first `opts.limit ?? 8`.
7. **Map** to `RankedMatch` (already declared in `src/core/types.ts` —
   import it, do not redefine):
   - `key`: candidate's lowercase key
   - `display`: candidate's `display` (most recent casing — e.g. typed
     `nrel` → `NREL`)
   - `description`: `'session x' + sessionCount` (ASCII `x`, per work-item
     contract — e.g. `"session x12"`)
   - `salience`: the computed `salience(c, store.currentOrdinal())` (import
     from `./score.js`)
8. **Empty range / empty prefix match → `[]`** (provider then delegates).
9. **limit ≤ 0** → return `[]` immediately (defensive).

### Success Criteria

- [ ] `rankMatches` exported from `src/core/query.ts`; `RankedMatch` imported
      from `types.js`, not redeclared
- [ ] Case-insensitive: uppercase/mixed prefix finds lowercase-keyed
      candidates; results carry display casing
- [ ] Order exactly `compareCandidates`'s: salience desc, then shorter key,
      then byte-lex — verified by a test that constructs deliberate ties
- [ ] Default limit 8: 15 matching candidates → exactly 8 returned, the
      top-scoring ones; `limit: 3` → 3
- [ ] `description` is `'session x' + sessionCount`
- [ ] Non-matching prefix and empty store → `[]`
- [ ] `suppress` hook (when provided) removes candidates before ranking
- [ ] `npm run check` + `npm test` pass

## All Needed Context

### Context Completeness Check

Implementer needs: `store.ts`'s `prefixRange` contract (it returns INDICES,
not keys — see Gotchas), `score.ts`'s `salience`/`compareCandidates`
signatures, the existing `RankedMatch` type, and the test conventions. All
quoted below; no external libraries involved (pure TS, zero new deps).

### Documentation & References

```yaml
- file: src/core/store.ts
  why: prefixRange(prefix): [start, end) half-open range over the internally
        sorted key array; THROWS RangeError on non-lowercase prefix;
        currentOrdinal(): number; get(key): Candidate | undefined;
        sortedKeysSnapshot(): string[] (copy of the array as of the LAST
        rebuild — fresh IF taken immediately after a prefixRange call,
        because prefixRange rebuilds when dirty)
  pattern: import { CandidateStore } from "./store.js" — type-only usage in
           query.ts signature (accept the instance; never construct)
  gotcha: prefixRange returns index bounds only. To enumerate keys in range,
          call prefixRange FIRST (this performs any needed lazy rebuild),
          THEN store.sortedKeysSnapshot() and slice [start, end). That
          ordering is the only safe public path; never cache the snapshot
          across calls (S3 eviction dirties the index and invalidates it).

- file: src/core/score.ts
  why: salience(c, currentOrdinal) and compareCandidates(a, b,
        currentOrdinal) — the ONLY ranking math. Import from "./score.js";
        reimplementation anywhere else is forbidden by module invariants.
  pattern: score.ts itself documents "query.ts (P1.M2.T5.S1) … import
           these; never reimplement the math elsewhere."

- file: src/core/types.ts
  why: RankedMatch { key, display, description, salience } already declared
        — its doc comment says "Query result item from src/core/query.ts".
        Candidate interface too.
  pattern: import type { Candidate, RankedMatch } from "./types.js"

- file: test/store.test.ts
  why: test conventions — vitest describe/it, a `sighting(over)` Partial-
        override factory for inputs, plain expect assertions
  pattern: mirror with a `cand` factory or reuse the store by upserting
           fabricated Sightings (the store IS the input fixture)

- file: plan/001_88fc3a66fd74/P1M2T4S3/PRP.md
  why: parallel sibling — eviction removes keys and marks the prefix index
        dirty. Assumed implemented exactly as specified. Consequence for
        this PRP: never cache index state between rankMatches calls; always
        call prefixRange fresh (it rebuilds when dirty). No other coupling.
```

### Current Codebase tree (relevant slice)

```bash
src/core/
  dictionary.ts  score.ts  segment.ts  shapeGate.ts  store.ts  types.ts
test/
  store.test.ts  score.test.ts  segment.test.ts  ... (per-module suites)
```

### Desired Codebase tree

```bash
src/core/
  query.ts        # NEW — rankMatches + RankOptions; stage 5 of the pipeline
test/
  query.test.ts   # NEW — ranking/casing/limit/suppression suite
```

### Known Gotchas of our codebase & Library Quirks

```ts
// 1. prefixRange THROWS on non-lowercase input (RangeError). Lowercase the
//    prefix FIRST: const lower = prefix.toLowerCase();
// 2. prefixRange returns [start, end) INDICES. Safe key enumeration:
//      const [start, end] = store.prefixRange(lower);
//      const keys = store.sortedKeysSnapshot().slice(start, end);
//    — valid because prefixRange just rebuilt the index if it was dirty.
//    Add a code comment explaining this ordering invariant; a future store
//    accessor (e.g. keyAt(i)) would be cleaner but is out of scope here.
// 3. S3 eviction (parallel) deletes keys and sets #dirty — a stale
//    sortedKeysSnapshot from a previous call can contain evicted keys and
//    store.get(key) would return undefined. Always re-derive per call;
//    skip undefined gets defensively.
// 4. ESM project: import with ".js" specifiers ("./score.js") even though
//    sources are .ts. Strict TS; no `any`.
// 5. `salience` must be computed ONCE per candidate per call — compute the
//    value, use it for both sorting (via compareCandidates, which recomputes
//    internally — acceptable; ranges are small) and the RankedMatch field.
//    Do NOT quantize or round salience in the output.
// 6. Zero new dependencies. This module is pure computation.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE src/core/query.ts
  - IMPLEMENT: RankOptions interface + rankMatches() per the behavior
    contract above; module doc-comment naming it stage 5 of the pipeline
    (segment → shapeGate → score → store → query), PRD §02 h3.1 + §04 h2.26/27
  - IMPORT: { CandidateStore } from "./store.js" (type usage);
    { compareCandidates, salience } from "./score.js";
    { Candidate, RankedMatch } (type-only) from "./types.js"
  - NAMING: rankMatches, RankOptions; export const DEFAULT_LIMIT = 8
    (named constant, no magic 8 inline)
  - PLACEMENT: src/core/query.ts; must never import from pi packages
    (architecture invariant, see types.ts header)
  - PERFORMANCE: single prefixRange call, one key-slice, one
    get-per-candidate, one sort of the (typically small) range. For very
    large ranges a full sort of r items is O(r log r) — fine for the <1 ms
    gate at realistic range sizes; keep it simple, note the option of
    partial selection in a comment for the P1.M4.T1.S2 bench pass.

Task 2: CREATE test/query.test.ts
  - IMPLEMENT: suites per PRD §09:
    describe("rankMatches"):
      - returns [] for empty store / non-matching prefix
      - case-insensitive prefix ("NRE" finds "nrel" entry; result display
        is the stored display casing)
      - description === "session x" + sessionCount
      - ordering: salience desc (fabricate candidates with different
        sessionCount/recency/userTyped), tie → shorter key first, tie →
        byte-lex on key
      - default limit 8 (upsert 15 same-prefix keys → 8 results, correct
        top ones); limit: 3 → 3; limit: 0 → []
      - suppression hook removes a candidate before ranking
      - works after nextOrdinal advances (recency decay changes order)
  - FOLLOW pattern: test/store.test.ts — import from "../src/core/query.js",
    build the store by upserting fabricated Sighting objects (reuse the
    Partial-override factory style)
  - NAMING: test_<behavior> style matching existing suites
  - PLACEMENT: test/query.test.ts
```

### Implementation Patterns & Key Details

```ts
// Core shape (adapt, don't copy blindly):
import { compareCandidates, salience } from "./score.js";
import type { CandidateStore } from "./store.js";
import type { Candidate, RankedMatch } from "./types.js";

export const DEFAULT_LIMIT = 8;

export interface RankOptions {
  limit?: number;
  suppress?: (c: Candidate) => boolean;
}

export function rankMatches(
  store: CandidateStore,
  prefix: string,
  opts: RankOptions = {},
): RankedMatch[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  if (limit <= 0) return [];
  const lower = prefix.toLowerCase();          // BEFORE prefixRange (it throws)
  const [start, end] = store.prefixRange(lower);
  const keys = store.sortedKeysSnapshot().slice(start, end); // fresh: see gotcha 2
  const ordinal = store.currentOrdinal();
  const out: Candidate[] = [];
  for (const k of keys) {
    const c = store.get(k);
    if (c && !(opts.suppress && opts.suppress(c))) out.push(c);
  }
  out.sort((a, b) => compareCandidates(a, b, ordinal));
  return out.slice(0, limit).map((c) => ({
    key: c.key,
    display: c.display,                        // insertion casing (h2.27)
    description: `session x${c.sessionCount}`, // ASCII x per item contract
    salience: salience(c, ordinal),
  }));
}
```

### Integration Points

```yaml
MODULE REGISTRY: none — pure core module, no pi imports, no registration.
FUTURE CONSUMERS:
  - src/pi/provider.ts (P1.M3.T3.S2): calls rankMatches(store, fragment)
    synchronously in getSuggestions; maps RankedMatch → AutocompleteItem
    { value: display, label: display, description }
  - P2.M1.T3.S1 (M2): passes opts.suppress for phrase-constituent
    suppression — the hook designed here
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check        # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npm test                                  # full suite
npx vitest --run test/query.test.ts       # this module only
# Expected: all pass, including deliberate-tie ordering tests
```

### Level 3: Performance sanity (informal; formal gate is P1.M4.T1.S2)

```bash
npx vitest bench   # if a bench file is added; otherwise a quick timing
                   # check in a scratch vitest test: 20k-entry store,
                   # time 1000 rankMatches calls < 1000 ms total
```

## Final Validation Checklist

- [ ] `npm run check` passes
- [ ] `npm test` passes (full suite; no regressions in sibling modules)
- [ ] All "What" success criteria verified by named tests
- [ ] No reimplemented salience/comparator math (imports from score.js only)
- [ ] No pi-package imports in src/core/query.ts
- [ ] Optional `suppress` hook present and defaulted (M2 seam)
- [ ] Code comments explain the prefixRange → sortedKeysSnapshot ordering
      invariant and the S3-eviction staleness guard

## Anti-Patterns to Avoid

- ❌ Don't re-sort or re-derive salience with local math — score.ts is the
  single source of truth
- ❌ Don't lowercase/modify the returned `display` — insertion uses stored
  casing exactly
- ❌ Don't cache keys/snapshots between rankMatches calls (eviction dirties
  the index)
- ❌ Don't round or quantize salience in the output
- ❌ Don't add a store API for key access in this PRP — use the documented
  prefixRange-then-snapshot ordering

**Confidence Score: 9/10** — all upstream contracts verified in code; only
minor design freedom is perf micro-structure, which the bench gate (later
item) will police.