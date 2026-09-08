# PRP — P1.M4.T2.S1: Successor-aware constituent-suppression exemption in rankMatches (BUG-005, part 1)

## Goal

**Feature Goal**: Fix BUG-005's root cause in `src/core/query.ts`: in the
constituent-suppression loop of `rankMatches`, do NOT remove the bare first
word when `store.topSuccessors(firstWord).length > 0` — a successor-bearing
word can arm the chain (PRD §07 h2.43 arming is whole-word-only), so it must
remain acceptable in menus. It co-presents BELOW its phrase (phrase salience
1.2·Σ + repetition bonus ≥ word salience, so `compareRankedMatches` already
sorts the phrase first). Words without successors keep today's suppression
(spec §06 h3.8 behavior preserved where harmless). `enablePhrases=false`
(empty successor index) → behavior identical to today.

**Deliverable**:
1. `src/core/query.ts` — one guard condition in the suppression loop
   (~lines 222–232) + updated comment referencing the exemption.
2. `test/query.test.ts` — new unit tests pinning the exemption (bare word
   survives when it has successors; still suppressed when it doesn't; phrase
   still sorts first; `enablePhrases`-off store unchanged).
3. `test/acceptance.test.ts` — update the fixture-phase workaround
   (comment block at ~L546–560 and the pinned expectation at ~L606-610
   `expect(menu.map((m) => m.description)).toEqual(['phrase','phrase'])`)
   to the fixed behavior, and update acceptance item 7 to arm the chain on
   the FULL replay (no phase-splitting workaround needed for the bare word's
   presence — though the phase-split may stay if item 7's zero-typing flow
   still requires it; see Tasks).
4. `test/chain.test.ts` — update the "SEEDING ORDER GOTCHA" header comment
   (L17-22) to the new invariant (no longer required for arming visibility;
   kept harmless).

**Success Definition**: `npm run check` and `npm test` green. After a full
`nrel.jsonl` replay through the real pipeline (phrase hook wired),
`rankMatches(store, 'natio')` contains the bare `national` word item
alongside the phrase items, and `rankMatches(store, 'na')` likewise. A word
with no successors (phrase exists, no bigram tail recorded for it) is still
suppressed. `compareRankedMatches` ordering unchanged — phrase first.

## User Persona

**Target User**: hapax users who resumed a session (or any session where the
target bigram already recurred) and want to Tab-accept `National` to arm the
zero-typing chain (PRD §09 M2 item 7).
**Use Case**: `/resume` an NREL session; type `natio`; menu shows phrase
items AND the bare `National`; Tab accepts the word → chain arms.
**User Journey**: today the bare word is mathematically always suppressed
(phraseSalience ≥ wordSalience by construction), so the chain can never be
armed post-restore; after this fix the word survives whenever the successor
index can serve a chain from it.
**Pain Points Addressed**: M2 chained completion unreachable in resumed
sessions (BUG-005); acceptance tests had to engineer a phase-split seeding
order to dodge the bug.

## Why

- BUG-005 (bugfix PRD "Major Issues" Issue 4): the phrase salience formula
  (`phraseSalience`, query.ts ~L112: `Σ·PHRASE_MULTIPLIER(1.2)` + `2.0·log2(1+count)`
  when count ≥ 2) ALWAYS ≥ the first word's own salience, so
  `phraseSuppresses` (`>=`, tie→phrase, query.ts ~L133) removes the bare
  word from every menu once a phrase starting with it exists — and ProperProperty
  pairs are fast-path phrases at FIRST SIGHT, so this is near-universal for
  exactly the vocabulary chaining targets.
- `store.topSuccessors(word)` (store.ts:856) is the ready-made O(1)
  predicate: returns the live array or the frozen shared `NO_SUCCESSORS`
  (length 0) on miss — no allocation, no map copy.
- Downstream: P1.M4.T2.S2 (arm chain on phrase acceptance) and P1.M5.T1.S1
  (chain post-restore probe) consume this behavior; P1.M4.T1.S1 (stale
  prefix anchor, provider-side) is independent and lands in parallel.

## What

In `rankMatches`'s constituent-suppression loop, change the removal condition
to skip the bare first word when `store.topSuccessors(fw).length > 0`.
Nothing else in the ranking pipeline changes — gathering, salience
computation, merge, sort, and the `opts.suppress` word-only seam are
untouched. No config surface change (PRD §08: nothing configurable).

### Success Criteria

- [ ] Full nrel.jsonl replay → `rankMatches(store, 'natio')` contains the
      bare `national` word item AND phrase items; phrase sorts first
- [ ] `rankMatches(store, 'na')` likewise contains the bare word
- [ ] Word with a shadowing phrase but NO successors → still suppressed
      (existing h3.8 behavior for the successor-less class preserved)
- [ ] Store built with `enablePhrases=false` (no successor index entries) →
      identical results to today (successor index empty ⇒ all suppressed as
      before, where phrases exist at all)
- [ ] `phraseSuppresses`, `phraseSalience`, `compareRankedMatches` exports
      and semantics unchanged (their unit tests stay green untouched)
- [ ] acceptance.test.ts pins the NEW behavior (no `['phrase','phrase']`
      pin for a successor-bearing word); chain.test.ts gotcha comment updated
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer needs: the exact suppression loop, the `topSuccessors`
contract, the test harness patterns (real store + real pipeline + shipped
dictionary — mock nothing), and the exact test lines currently pinning the
bug. All specified below with line references.

### Documentation & References

```yaml
- file: src/core/query.ts
  why: THE change site. Suppression loop ~L222-232:
        for (const p of phraseHits) {
          const fw = firstWord(p.key);
          for (let i = words.length - 1; i >= 0; i--) {
            if (words[i].c.key === fw && phraseSuppresses(p.sal, words[i].sal)) {
              words.splice(i, 1);
            }
          }
        }
  pattern: module is heavily doc-commented; every behavior change updates
    its adjacent comment (Mode A docs requirement)
  gotcha: keep phraseSuppresses() itself untouched — the exemption is a
    CALLER-side guard, not a change to the exported predicate or its
    contract-matrix unit tests

- file: src/core/store.ts
  why: topSuccessors(word) at L856 — O(1), returns live array or the frozen
        shared NO_SUCCESSORS (never null, never a copy). Successor index is
        populated by EVERY phrase upsert regardless of admission
        (#upsertPhrase bigram successor tail), and exists only when phrases
        are enabled (hook wiring lives in src/pi/index.ts / test harness).
  gotcha: empty array is the miss case — use .length > 0, never truthiness
    on the array reference (frozen NO_SUCCESSORS is truthy)

- file: test/acceptance.test.ts
  why: L546-560 fixture-phase comment block (documents the workaround) and
        ~L606-610 pinned expectation
        `expect(menu.map((m) => m.description)).toEqual(["phrase","phrase"]);`
        in "fixture sanity" — both must flip to the fixed behavior. Item 7
        ("zero-typing chain") at L641+ currently arms on the PHASE-1-only
        replay (NREL_PHASE1 = 4) before phase 2 fills phrases; with the fix
        the bare word survives a full replay, so the sanity pin becomes
        e.g. expect(menu to include a "session xN" word item for national,
        with a phrase item first). The zero-typing chain test itself may
        keep its phase structure if its accept-order narration depends on
        it, but it no longer NEEDS to — prefer simplifying to full replay
        ONLY if the chain flow (arm on bare word) works identically;
        otherwise keep phases and just fix the pinned comment/pin.

- file: test/chain.test.ts
  why: header comment L17-22 "SEEDING ORDER GOTCHA" — rewrite to state the
        new invariant (suppression exempts successor-bearing words, so the
        arming menu is visible even after bigrams are recorded; the
        before-query seeding in these tests is now only a determinism
        convenience, not a requirement). Tests themselves should stay green
        unchanged — if any FAILS, that is signal the fix is incomplete.

- file: test/fixtures/sessions/nrel.jsonl
  why: the canonical replay fixture (entries: header + n01–n03 phase 1,
        then ×4 "National Renewable Energy Laboratory" occurrences).
  pattern: parseSessionFixture / makeNrelPipeline / replayNrel helpers in
    acceptance.test.ts (real loadDictionary(resolveDictPath()), real
    IngestPipeline with onAdmittedTokens → store.recordPhraseLines, real
    restoreFromHistory) — reuse them; mock nothing (per item contract)

- file: test/query.test.ts
  why: home for the new focused unit tests; existing style is direct
        store construction + rankMatches assertions on key/description/
        salience ordering. Phrase-bearing stores are seeded via
        store.recordPhraseLines(lines, ordinal) after upserting word
        sightings — see existing phrase tests in this file for the exact
        seeding recipe.
  gotcha: a successor entry appears only when a PHRASE upsert records the
    bigram tail — recordPhraseLines(["national","renewable"], ...) gives
    topSuccessors("national") length ≥ 1

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M4T1S1/PRP.md
  why: PARALLEL work on src/pi/provider.ts (stale-prefix anchor, BUG-002).
        Zero overlap with this change (query.ts core vs provider.ts UI), but
        both touch test files near chain/display suites — do not modify
        provider.ts or provider-display tests here.

- docfile: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/ (system_context.md BUG-005)
  why: the adversarial-probe finding this fixes — see selected_prd_content
        Issue 4 for the full reproduction and rationale.
```

### Current Codebase tree (relevant)

```bash
src/core/query.ts      # rankMatches, phraseSuppresses, phraseSalience, compareRankedMatches
src/core/store.ts      # CandidateStore, topSuccessors (L856), NO_SUCCESSORS, recordPhraseLines
src/core/score.ts      # salience() — imported by query.ts, unchanged
test/query.test.ts     # unit suite for rankMatches
test/acceptance.test.ts# item 7 + fixture-phase workaround (~L546-610)
test/chain.test.ts     # chain machine suite + gotcha comment L17-22
test/fixtures/sessions/nrel.jsonl
```

### Desired Codebase tree

```bash
# same files — modifications only, no new files required
# (a new test file test/query-suppression.test.ts is acceptable if
#  query.test.ts is unwieldy, but prefer extending it)
```

### Known Gotchas

```ts
// CRITICAL: exempt via the CALLER guard, not by weakening phraseSuppresses
//   (its {>, ==, <} contract-matrix tests are load-bearing exports).
// CRITICAL: topSuccessors returns frozen NO_SUCCESSORS on miss — truthy!
//   Always test `.length > 0`.
// CRITICAL: rankMatches is on the SYNCHRONOUS keystroke path (PRD §02) —
//   topSuccessors is O(1); do NOT iterate successors or copy anything.
// The exemption applies to the FIRST word of the phrase key only (that is
//   the only constituent suppression ever touches — middle/last words are
//   never in a same-prefix menu anyway).
// enablePhrases=false ⇒ successor index never populated ⇒ .length === 0
//   everywhere ⇒ suppression identical to today (this is the "no behavior
//   change without phrases" guarantee; assert it in a test).
// Tests must use the REAL store + real pipeline + shipped dictionary
//   (existing harness); do not mock CandidateStore.
```

## Implementation Blueprint

### The change (exact shape)

```ts
// src/core/query.ts — constituent-suppression loop, new form:
// ── Constituent suppression (PRD §06 h3.8 + BUG-005 exemption) ────────
// A phrase shadows the single-word candidate whose key equals its first
// word when the phrase's salience is >= the word's (tie → phrase) —
// EXCEPT when the word can still arm the chain: if the successor index
// has successors for it (topSuccessors().length > 0), the bare word must
// stay acceptable (PRD §07 h2.43: arming is whole-word Tab acceptance).
// It co-presents BELOW the phrase: phrase salience (1.2·Σ + repetition
// bonus) is by construction >= the word's, so the merged sort keeps the
// phrase first. Successor-less words keep the plain h3.8 rule (the
// exemption is inert there — nothing to arm).
for (const p of phraseHits) {
  const fw = firstWord(p.key);
  const canArm = store.topSuccessors(fw).length > 0; // O(1) read
  if (canArm) continue; // BUG-005: successor-bearing word stays acceptable
  for (let i = words.length - 1; i >= 0; i--) {
    if (words[i].c.key === fw && phraseSuppresses(p.sal, words[i].sal)) {
      words.splice(i, 1);
    }
  }
}
```

(Hoisting `canArm` outside the inner loop is required — `topSuccessors` is
O(1) but the guard is per-phrase, not per-word-candidate. Multiple phrases
sharing a first word each check the same predicate; the `continue`-style
skip is per phrase hit, which is equivalent and clearest.)

### Implementation Tasks (ordered)

```yaml
Task 1: MODIFY src/core/query.ts suppression loop + comments
  - IMPLEMENT the exemption exactly as above (hoisted canArm check)
  - UPDATE the loop's doc comment to the new invariant (Mode A docs)
  - PRESERVE phraseSuppresses / phraseSalience / compareRankedMatches exports

Task 2: EXTEND test/query.test.ts
  - TEST bare word survives when successors exist:
      seed word 'national' sightings + recordPhraseLines making
      'national renewable' a phrase (count>=2 or fast-path), assert
      rankMatches(store,'natio') contains key 'national' with a
      'session x*' description AND the phrase item sorts FIRST
  - TEST 'na'-width probe likewise
  - TEST successor-less shadowed word still suppressed (phrase exists,
      first word has NO recorded bigram tail — e.g. phrase recorded
      without that word leading any successor entry)
  - TEST phrases-off equivalence: same store shape built WITHOUT
      recordPhraseLines successors where possible / or store with empty
      successor index → old behavior (word removed)
  - TEST compareRankedMatches ordering unchanged (existing tests cover;
      add one merged-order assertion if not already pinned)

Task 3: UPDATE test/acceptance.test.ts
  - FIX ~L606-610 pin: menu after FULL nrel replay must now contain the
    bare word item; assert e.g. descriptions include "phrase" first and
    a /^session x\d+$/ entry for national (or assert on keys:
    menu.some(m => m.key === 'national') && menu[0].description === 'phrase')
  - REWRITE the fixture-phase comment block (~L546-560): the phase split
    is no longer REQUIRED for bare-word visibility; state the new
    invariant (suppression exempts successor-bearing first words)
  - EVALUATE item 7's phase-split arming (NREL_PHASE1): simplify to a
    single full replay if the zero-typing chain still passes; otherwise
    keep the split and document it as narration-only. Do NOT let item 7
    regress — it is the M2 DoD test.

Task 4: UPDATE test/chain.test.ts header comment (L17-22)
  - REWRITE the SEEDING ORDER GOTCHA paragraph to the new invariant
  - DO NOT change test bodies; all must stay green as-is

Task 5: RUN the gates
  - npm run check && npm test   # all green
```

### Integration Points

```yaml
DOWNSTREAM_CONSUMERS:
  - P1.M4.T2.S2 (arm chain on phrase acceptance): builds on this — the
    bare word being acceptable is the pre-condition it extends
  - P1.M5.T1.S1 (chain post-restore probe): will assert post-restore
    rankMatches contains the bare arming word — this fix makes that pass
NO_CONFIG: no config fields, no constants change (PHRASE_MULTIPLIER etc.
  untouched)
NO_PROVIDER_CHANGES: src/pi/provider.ts belongs to parallel P1.M4.T1.S1
```

## Validation Loop

### Level 1: Type & style

```bash
npm run check    # tsc --noEmit strict — zero errors
```

### Level 2: Unit tests

```bash
npx vitest --run test/query.test.ts test/chain.test.ts test/store.test.ts -v
# all green; new exemption tests pass; phraseSuppresses contract tests untouched & green
```

### Level 3: Acceptance (the pinned-bug flip)

```bash
npx vitest --run test/acceptance.test.ts -v
# item 7 suite green with the NEW pins; full nrel replay yields a menu
# containing bare 'national' — if the old ['phrase','phrase'] pin still
# exists anywhere, grep it: must be gone
grep -n "'phrase', 'phrase'" test/acceptance.test.ts   # expect no matches
```

### Level 4: Behavior proof (BUG-005 repro, inverted)

```bash
npx vitest --run -t "nrel" -v
# sanity test asserts topSuccessors('national') = [renewable×4, license, wind]
# AND the 'natio' menu contains 'national' — the exact probe that failed
# in the adversarial audit
```

## Final Validation Checklist

- [ ] `npm run check` zero errors
- [ ] `npm test` fully green (existing 523+ plus new tests)
- [ ] Full nrel replay: `rankMatches(store,'natio')` includes bare
      `national`, phrase first; `'na'` probe likewise
- [ ] Successor-less words still suppressed; phrases-off behavior identical
- [ ] `phraseSuppresses`/`phraseSalience`/`compareRankedMatches` untouched
- [ ] acceptance.test.ts old pin removed; phase comment rewritten; item 7
      still green (simplified or narration-only split)
- [ ] chain.test.ts comment updated, bodies unchanged & green
- [ ] Only `src/core/query.ts` + the three test files modified (no
      provider.ts, no store.ts, no config)
- [ ] Suppression-loop comment in query.ts reflects the exemption (Mode A)

## Anti-Patterns to Avoid

- ❌ Don't weaken `phraseSuppresses` itself — caller-side guard only
- ❌ Don't iterate/copy successor arrays (keystroke path; `.length > 0` only)
- ❌ Don't skip updating the pinning tests — they currently PIN the bug and
      will fail (correctly) until rewritten to the new behavior
- ❌ Don't mock the store or dictionary — real pipeline harness per
      test/chain.test.ts / acceptance.test.ts
- ❌ Don't touch src/pi/provider.ts (parallel P1.M4.T1.S1 owns it)
- ❌ Don't add config or change baked constants (PRD §08)