---
name: "P1.M2.T2.S1 (plan 006) — Fallback provider: series-first zero-char offers + close-on-space typed arming"
---

## Goal

**Feature Goal**: Implement spec §07 h2.53's capitalized-series chaining rules on the FALLBACK provider path: (1) the armed zero-char word-start offer lists **series successors first (count desc), then ordinary successors (count desc)** in one published set, with series items displaying/inserting their RUN CASING (`Successor.nextDisplay`); (2) a NEW arming transition — a space closing a typed word whose first letter is UPPERCASE and whose lowercase key has series successors arms the chain (typing `The ` offers `Fed`); lowercase typings never arm.

**Deliverable**: Modified `src/pi/provider.ts` (offer composition in `publishChain`/zero-char branch, typed-arming at the 1.8 close-on-space site, Mode-A JSDoc citing 07 h2.53); chain battery cases in `test/provider.test.ts` + `test/chaining-gating.test.ts`.

**Success Definition**: `The ` → zero-char offer top = `Fed` (series-first, run casing); typing through the offer disarms per the one-shot grant; acceptance re-arms; lowercase `the ` never arms; all existing arming paths (Tab-accept, trigger-char accept), the one-shot grant, `before_agent_start` reset, and the exact-equal exclusion unchanged; `npm run check` + `npm test` green.

## Why

- Spec h2.53: "State machine, armed by acceptance **or by typing** of a series member" and "series successors first (count descending among them), then ordinary successors (count descending)". Today arming comes ONLY from applyCompletion accepts (architecture/03 §R2) and offers are plain count-desc with no series awareness.
- Uppercase gate is load-bearing: "a lowercase typing of a top-band word must not arm, or every prose `the ` would offer its run successor".
- The exact rule set is mirrored by P1.M2.T2.S2 on the widget — this task defines the semantics; keep the logic provider-local (no shared-module refactor; the widget mirrors it).

## What

All in `src/pi/provider.ts` inside `createHapaxProvider`:

1. **Series-first offer composition** — the zero-char branch (:462-474): today
   `store.topSuccessors(armed.word).slice(0, maxSuggestions)`. With the
   series-aware `topSuccessors` from P1.M1.T2.S2 (series entries ordered
   first within its result — verify its exact contract: if it already
   returns series-first, this is a no-op; if it returns them interleaved
   or separately, partition here: `series = succ.filter(s => s.series)`
   then `ordinary = rest`, both already count-desc, concat
   series→ordinary) → one combined list → `publishChain(combined, "")`
   unchanged otherwise.
2. **Series display casing**: `successorDisplay` (:435) currently
   `store.get(s.next)?.capDisplay ?? s.next` (interim from P1.M2.T1.S2).
   Replace with: `s.series && s.nextDisplay ? s.nextDisplay : (resolved
   display via the P1.M2.T1.S2 resolver / capDisplay interim)` — series
   items use their RUN CASING (`nextDisplay`) at zero typed chars;
   ordinary items keep the resolver form. Note the h2.53 casing rule:
   once the user types, anchor matching is case-insensitive
   (matchFragment — already true) and insertion preserves a typed
   capital first letter / inserts verbatim on lowercase — that is the
   resolver's job in the typed-fragment branch (:501-529) and at
   applyCompletion; the zero-char offer just publishes `nextDisplay`.
3. **Typed-word arming at the 1.8 close-on-space site** (:534-560): today
   the block returns `null` for a plain trailing space. BEFORE that
   return (same conditions: non-forced, no `@`/`/`), extract the word
   that just ended: `const m = beforeText.match(/([A-Za-z][A-Za-z0-9_-]*)\s$/)`;
   if `m` exists AND `m[1][0]` is uppercase AND
   `store.topSuccessors(m[1].toLowerCase())` is non-empty (direct consult
   — series entries included, so chain-only members arm it) AND the
   chain is not already armed AND the one-shot grant allows (call
   `chain.arm(m[1].toLowerCase())` + `grant.reset()` exactly like the
   applyCompletion arm site) — then arm and STILL return `null` (the
   space closes the menu; the NEXT word-start query produces the
   zero-char offer). Lowercase first letter → never arm.
4. **Unchanged (fences)**: Tab-acceptance arming (applyCompletion
   intercept), trigger-char arming, the one-shot grant semantics
   (chain-grant.ts), `before_agent_start` reset, exact-equal exclusion
   (:511), forced single-item returns, close-on-space's own null
   behavior, armed branch ordering (:462 zero-char before :501
   fragment), the startup gate, all delegation paths.
5. **JSDoc (Mode A)**: on the typed-arming insertion (the h2.53 idle
   transition quoted: uppercase first letter + series-successor consult
   + lowercase-never-arms rationale) and on the offer-ordering rule
   (series first, count desc, then ordinary, count desc — h2.53 cite).

### Success Criteria

- [ ] `The ` typed (space closes) arms the chain; next word-start query offers successors with the top = `Fed` (series-first, `nextDisplay` casing)
- [ ] Series-before-ordinary in the combined zero-char set (both count-desc within group)
- [ ] Lowercase `the ` (even with successors) never arms; uppercase word with NO series successors never arms
- [ ] Chain-only members (absent from word store, present in successor index) arm via the direct `topSuccessors` consult
- [ ] Typed-through disarm + acceptance re-arm (grant) still work; existing tests unmodified
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer needs: the exact armed-branch/close-on-space code (quoted below), the upstream Successor.series/nextDisplay contract (P1.M1.T2.S2, Ready — treat as delivered), the resolver interim (P1.M2.T1.S2, in flight), the grant/chain API, and the test harness conventions. All below.

### Documentation & References

```yaml
- file: src/pi/provider.ts
  why: THE file. successorDisplay :435; publishChain :437-460 (bare values,
        lastLive publish, liveKeyByValue); zero-char offer :462-474
        (before === "" || /[ \t]$/ → topSuccessors → publishChain(""));
        typed-fragment branch :501-529 (exact-equal exclusion :511,
        matchFragment membership gate); 1.8 CLOSE-ON-SPACE :534-560 (the
        null-return block with @// guards); chain grant usage beside every
        arm site.
  pattern: numbered stage comments; publishChain is the single publish
           seam; delegations pass options by identity.
  gotcha: the close-on-space site fires only for NON-forced queries;
          arming must not consume/alter the null return.

- docfile: plan/006_7bd0258da993/architecture/03-pi-surfaces-r2-r3-r4.md
  section: "R2 surfaces" (:52-64)
  why: Verified line anchors + the explicit finding that typed-word
        arming does NOT exist today ("arming comes only from
        applyCompletion accepts") and that series-first requires merging
        successor items into one published set (the composition site).

- docfile: plan/006_7bd0258da993/architecture/02-store-query-r1-r2.md
  section: Successor/series bigram contract
  why: Upstream shape from P1.M1.T2.S2: series flag + nextDisplay on
        Successor; series-first top-3 retention in the successor index.
        READ FIRST — if topSuccessors already emits series-first
        ordering, task item 1 collapses to verification.

- file: plan/006_7bd0258da993/P1M2T1S2/PRP.md
  why: Sibling in flight (resolver wiring + Candidate.display removal).
        Its interim left provider.ts :436 as
        `store.get(s.next)?.capDisplay ?? s.next` with a TODO(P1.M2.T2)
        — you replace that line. Successor.nextDisplay supersedes the
        interim for series items; ordinary items use the resolver.
  gotcha: Candidate.display is GONE when you start (S2 removes it) —
          never read `.display` off a store candidate.

- file: test/chaining-gating.test.ts + test/provider.test.ts
  why: Harness conventions: mock current-provider (vi.fn), store
        fixtures via upserted Sightings + recordBigramRuns, provider
        getSuggestions driven with lines/col/options; chain state via
        provider seam (state()/chain introspection if exported) and
        behavior via subsequent offers. The 'The '→'Fed' battery rides
        here per the work item.
```

### Current Codebase tree (relevant)

```bash
src/pi/provider.ts           # MODIFY: series-first composition, successorDisplay, typed arming
test/provider.test.ts        # EXTEND: series-first offer + typed arming battery
test/chaining-gating.test.ts # EXTEND: grant/re-arm interplay with typed arming
```

### Known Gotchas & Library Quirks

```typescript
// ARM + STILL RETURN NULL at the close-on-space site: the space closes
// the menu (spec h2.51 close-on-space is untouched); the zero-char offer
// comes from the NEXT word-start query. Do not try to offer inline.

// UPPERCASE TEST IS ON THE TYPED FORM (m[1][0] is A-Z), THE SUCCESSOR
// CONSULT IS ON THE LOWERCASE KEY: "The" arms → topSuccessors("the").
// store.topSuccessors takes lowercase keys (store contract).

// CHAIN-ONLY MEMBERS: the typed word need NOT be a stored word candidate
// — that is why the consult goes to topSuccessors directly, not through
// store.get(). A word present only in the successor index still arms.

// ONE-SHOT GRANT ON TYPED ARMING: an arm is an arm — call grant.reset()
// beside chain.arm() exactly like the applyCompletion site, so typed
// arming gets exactly one granted offer too (typing through it disarms
// at the next word boundary).

// DON'T RE-ARM WHEN ALREADY ARMED: an armed chain sitting at a word
// start whose preceding word ends in space could double-arm at the 1.8
// site — the armed branch (1.5) runs BEFORE 1.8 in evaluate order, so a
// live zero-char offer never reaches 1.8; still guard cheaply
// (chain.state() === null) for safety.

// FORCED QUERIES SKIP 1.8 ENTIRELY — typed arming fires only on the
// non-forced path; that is correct (Tab is the explicit gesture).

// SERIES ITEMS STILL RANK BY COUNT WITHIN THE SERIES GROUP, and ordinary
// by count within theirs — the chain's internal ranking is successor-
// count-based (h2.53), NOT sessionCount (publishChain already sets
// sessionCount: s.count — the combined list's published order IS the
// rank order; never re-sort).

// nextDisplay AT ZERO TYPED CHARS ONLY: the typed-fragment branch
// (:501-529) filters via matchFragment (case-insensitive anchor) and
// publishes successorDisplay per item — series items there keep their
// resolved/resolver casing per h2.53's typed rule; check what S1's
// successorDisplay becomes for typed contexts and keep the zero-char
// run-casing rule distinct.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ upstreams first
  - src/core/store.ts topSuccessors + Successor.series/nextDisplay
    (P1.M1.T2.S2): confirm whether series-first ordering is already
    emitted. src/core/query.ts resolver usage (P1.M2.T1.S2): confirm the
    interim shape at provider.ts :436 after its migration.

Task 1: TDD — failing battery first
  - test/provider.test.ts new describe("series-first offers + typed
    arming (spec 07 h2.53)"):
    * store with series bigrams (the→Fed via a capitalized run, count 4)
      + ordinary successors (the→file count 2): type "The" + space →
      query at word start → items[0].value === "Fed" (nextDisplay),
      items ordered series-then-ordinary, both count-desc
    * lowercase "the" + space → no offer at next word start (never armed)
    * uppercase word with no series successors → no arm
    * chain-only member word (typed, uppercase, only in successor
      index) arms
    * typed-through one granted offer disarms; acceptance re-arms
    * zero-char offer's published set order === rendered order (no re-sort)
  - test/chaining-gating.test.ts: typed-arm + grant interplay case.

Task 2: MODIFY src/pi/provider.ts
  - successorDisplay: series/nextDisplay branch (What §2).
  - Zero-char branch: partition/verify series-first, combined publish (§1).
  - 1.8 site: pre-return typed-arming block (§3) + chain.state() guard.
  - JSDoc both seams (§5).

Task 3: VALIDATE
  - npm run check
  - npx vitest --run test/provider.test.ts test/chaining-gating.test.ts -v
  - npm test   # full suite
```

### Implementation pattern

```typescript
// 1.8 site insertion (sketch)
const m = beforeText.match(/([A-Za-z][A-Za-z0-9_-]*)\s$/);
if (
  m !== null &&
  m[1]!.charAt(0) >= "A" && m[1]!.charAt(0) <= "Z" &&
  chain.state() === null &&
  store.topSuccessors(m[1]!.toLowerCase()).length > 0
) {
  // Spec 07 h2.53 idle→armed typed transition … (Mode-A JSDoc)
  chain.arm(m[1]!.toLowerCase());
  grant.reset();
}
// … existing lastLive = null; return null;  (unchanged)
```

### Integration Points

```yaml
NONE this task:
  - Provider-internal; no config/core/store edits (upstreams deliver
    Successor.series/nextDisplay and the resolver).
  - P1.M2.T2.S2 mirrors this exact rule set on the widget path — keep
    logic provider-local, no premature shared abstraction.
  - P1.M2.T3.S1 (/acwords successor sample) may display series markers
    separately — not here.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check
```

### Level 2: Unit Tests

```bash
npx vitest --run test/provider.test.ts test/chaining-gating.test.ts -v
npm test
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green

### Feature Validation

- [ ] `The ` arms; next word start offers `Fed` first (series-first, run casing); lowercase never arms
- [ ] Combined set series→ordinary, each count-desc; published order = rank order
- [ ] Grant semantics identical for typed arming; typed-through disarm + re-arm pinned
- [ ] Exact-equal exclusion, forced returns, close-on-space null, before_agent_start reset untouched

### Code Quality Validation

- [ ] Mode-A JSDoc on both seams citing 07 h2.53
- [ ] No `.display` reads off Candidate (removed by S2); interim TODO resolved
- [ ] No re-sorting of the published chain set; no shared-module refactor for the widget sibling

## Anti-Patterns to Avoid

- ❌ Don't arm on lowercase words or on words without series successors
- ❌ Don't offer inline at the space — arm, close (null), offer at the next word start
- ❌ Don't re-sort or re-rank the chain set (publishChain order is the order)
- ❌ Don't skip grant.reset() on typed arming (an arm is an arm)
- ❌ Don't touch the widget path, store, query, or config (siblings/upstreams own them)
- ❌ Don't alter the close-on-space null return, forced paths, or 1.5-before-1.8 evaluate order
