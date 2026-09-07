# PRP — P2.M1.T2.S1: Hybrid phrase admission (count≥2 OR all-rare first sight; sticky)

---

## Goal

**Feature Goal**: Implement PRD §06 h3.7 phrase admission in `src/core/store.ts`: an n-gram
becomes a completion **candidate** (distinct from its persisted count) when (a) repetition
path: `count >= 2`, OR (b) fast path first sight: EVERY constituent word is rank group 0
(dictionary-absent, shape-gated) or `properName`, AND the n-gram length in words is ≤ 5.
`sticky = true` when both paths fire. Candidate phrases live in a set distinct from raw
counts; demotion (P2.M1.T2.S2) removes candidacy but keeps counts.

**Deliverable**:
1. Candidate-phrase set + admission logic on `CandidateStore` in `src/core/store.ts`.
2. Public API: `removePhraseCandidacy(key)` (demotion primitive for T2.S2 — removes
   candidacy only, counts stay), readers for T2.S2 and P2.M1.T3.S1
   (`isPhraseCandidate(key)`, `phraseCandidateKeys()` / flag for fast-path-admitted).
3. Unit tests in `test/phrases.test.ts` (extend the file created by P2.M1.T1.S1) covering
   all PRD §06 h3.7 semantics.

**Success Definition**: A phrase repeated twice becomes a candidate; a first-sight
all-rare/properName n-gram (≤5 words) becomes a candidate immediately; a phrase satisfying
both is `sticky` and survives an eviction pass that drops higher-score non-sticky phrases;
a mixed-constituent phrase (one common word) is NOT admitted on first sight but IS admitted
on second sighting; `removePhraseCandidacy` empties candidacy while `getPhrase(key).count`
is unchanged and a later recurrence (count≥2 still true) re-admits. All existing tests pass.

## User Persona

**Target User**: end user of hapax (indirect — internal module).

**Use Case**: A user types about "national renewable energy laboratory" — every word is
rare — the phrase should be offered on FIRST sight. "the meeting" repeats — offered via
repetition. Both signals firing (repeated all-rare phrase) makes it durable (sticky).

**Pain Points Addressed**: Pure repetition delays useful rare-phrase completions by one
message; pure first-sight floods candidates with common-word n-grams. The hybrid rule
(PRD §06, settled) fixes both. This task is the candidacy decision itself.

## Why

- PRD §01 Goals (M2) #6: "Multi-word phrase candidates admitted by repetition or all-rare
  first sight" — this task IS that admission rule.
- Unblocks P2.M1.T3.S1 (query integration consumes the candidate set) and defines the
  removal primitive P2.M1.T2.S2's 40-ordinal demotion sweep calls.

## What

- Add to the phrase layer (built by P2.M1.T1.S1) a **candidate set**
  `#phraseCandidates: Set<string>` — candidacy is orthogonal to counts.
- Admission runs automatically at the tail of `recordPhraseLines` for every key upserted
  in that call (no separate caller, no full-map scan — O(1)-ish per upserted phrase).
- Repetition path: after upsert, `entry.count >= 2` → add to candidates.
- Fast path (first sight only — evaluated when `entry.count === 1` at upsert time): every
  constituent word (`key.split(" ")`) has a word-store `Candidate` with
  `rankGroup === 0 || properName === true`, AND `key.split(" ").length <= 5` → add to
  candidates AND record fast-path provenance (for T2.S2's demotion sweep).
- `sticky`: when both conditions hold (i.e., a fast-path phrase reaches count ≥ 2), set via
  the existing `setPhraseSticky(key)` from T1.S1. Sticky phrases resist eviction (already
  honored by T1.S1's phrase eviction pool filter — do not re-implement).
- Demotion primitive: `removePhraseCandidacy(key: string): void` — deletes from the
  candidate set and clears fast-path provenance; MUST NOT touch `#phrases` counts,
  ordinals, or sticky. (The 40-ordinal sweep that CALLS this is T2.S2 — not this task.)
- Core stays unconditional; no config changes (enablePhrases gating is wiring-level).

### Success Criteria

- [ ] count ≥ 2 alone admits (repetition path), including phrases that failed fast path.
- [ ] First-sight all-rare (rankGroup 0 or properName, every word, ≤ 5 words) admits.
- [ ] Any common constituent (rankGroup 1/2, not properName, or word absent from store)
      blocks the fast path at first sight.
- [ ] 6+-word n-gram never takes the fast path (though trigram capture means keys ≤ 3 words
      today — the length check is defense-in-depth for future n).
- [ ] sticky set exactly when both paths have fired for a key; sticky survives eviction.
- [ ] `removePhraseCandidacy` removes candidacy, keeps counts; recurrence re-admits
      (repetition path count check uses live count).
- [ ] Word store, prefix index, word-cap eviction, and raw phrase counts untouched.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything needed?" — Yes:
the PRD excerpt above is the full contract; every file/pattern below was verified by
reading the code and the sibling PRP for P2.M1.T1.S1 (implementing in parallel; treat as
a contract that will land exactly as specified).

### Documentation & References

```yaml
- file: src/core/store.ts
  why: The module to EXTEND. Read its upsert/evictIfOverCap style first.
  pattern: "private #fields at top; JSDoc'd public methods; O(1) ingest-path methods;
           eviction pool already excludes sticky (T1.S1 phrase layer)."
  gotcha: "store.get(word) returns Candidate | undefined — a constituent word ABSENT from
           the word store (evicted, or never admitted as a whole token) FAILS the fast
           path (conservative: cannot prove all-rare). Do not crash on undefined."

- file: src/core/types.ts
  why: Candidate (rankGroup, properName) and PhraseEntry live here; declaration-only module.
  pattern: "rankGroup: 0 = dictionary-absent/shape-gated, 1/2 = frequency bands;
           properName sticky-once-true via upsert OR-in."
  gotcha: "Do NOT add new types to types.ts unless unavoidable — a plain Set<string> plus a
           provenance set needs no new exported interface. If you add a
           PhraseCandidate record type instead, it goes here and nowhere else."

- file: plan/001_88fc3a66fd74/P2M1T1S1/PRP.md
  why: CONTRACT for the phrase layer being built in parallel. Its exact API surface:
        recordPhraseLines(lines, ordinal), setPhraseSticky(key), getPhrase(key),
        phraseSize, phraseEntries(), iteratePhrases(), PHRASE_CAP=10_000.
  gotcha: "If the landed implementation differs slightly (e.g. method renamed), adapt to
           the ACTUAL code — read src/core/store.ts before editing."

- file: test/store.test.ts
  why: Test conventions (vitest, describe-per-PRD-section, plain fixtures, deterministic
        eviction tests). Extend test/phrases.test.ts in the same style.

- docfile: plan/001_88fc3a66fd74/P2M1T2S1/research/notes.md
  why: Verified facts, boundary decisions (T2.S2 owns the sweep), design sketch.
```

### Current Codebase tree (relevant slice)

```bash
src/core/types.ts        # Candidate, PhraseEntry (T1.S1), RankGroup
src/core/store.ts        # CandidateStore + phrase layer (T1.S1) — admission extends here
src/pi/index.ts          # wiring (enablePhrases gate — already done by T1.S1; no change here)
test/phrases.test.ts     # created by T1.S1 — extend
test/store.test.ts       # word-store tests — must stay green
```

### Desired Codebase tree with files to be added/changed

```bash
src/core/store.ts        # MODIFY: #phraseCandidates set, admission in recordPhraseLines tail,
                         #         isPhraseCandidate/phraseCandidateKeys/removePhraseCandidacy
test/phrases.test.ts     # MODIFY: describe("phrase admission (PRD §06 h3.7)") block
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: fast path is FIRST-SIGHT ONLY — evaluate when entry.count === 1 at upsert time.
// A phrase that first sighted mixed-constituent (fast path failed) and later recurs must be
// admitted by the repetition path, NOT retro-re-evaluated for fast path (its constituents'
// rankGroups may have drifted; PRD says "first sight").
// CRITICAL: sticky = BOTH paths fired. Repetition-only phrases are candidates but NOT sticky.
// sticky is set at the upsert where a fast-path-admitted phrase's count crosses 2.
// CRITICAL: rankGroup uses Math.min-merge in upsert — a word promoted to group 0 later still
// counts as rank 0 now; the fast path checks CURRENT Candidate state at first sight. Fine.
// CRITICAL: admission must run INSIDE recordPhraseLines's tail (per upserted key), not as a
// separate pass over iteratePhrases() — keep ingest O(1)-ish per phrase; PRD §02 h3.0 keeps
// heavy work off the keystroke path and §05 h2.34 forbids extra scans.
// CRITICAL: do NOT mark the word prefix index dirty; phrase/candidacy ops are independent
// of the word store's #sortedKeys/#dirty machinery.
// src/core never imports from src/pi (architecture invariant).
// Token/phrase keys are already lowercase single-space-joined — split(" ") is exact.
// Do NOT implement the 40-ordinal demotion sweep, phrase salience, constituent
// suppression, or the successor index — T2.S2, T3.S1, and P2.M2.T1 respectively.
```

## Implementation Blueprint

### Data models

No new exported types required. Internal state on `CandidateStore` (added alongside
T1.S1's `#phrases`):

```ts
#phraseCandidates = new Set<string>(); // candidacy only; counts live in #phrases
#fastPathAdmitted = new Set<string>(); // provenance for T2.S2's demotion sweep
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ the landed code
  - READ src/core/store.ts (the ACTUAL T1.S1 implementation — it may differ in naming from
    its PRP) and test/phrases.test.ts. Adapt all names below to reality.

Task 1: MODIFY src/core/store.ts — admission logic
  - ADD #phraseCandidates / #fastPathAdmitted private fields.
  - ADD private #admitPhrase(key: string, entry: PhraseEntry): void
      const repetition = entry.count >= 2;
      const fastPath =
        entry.count === 1 && this.#fastPathAdmitted.has(key) === false &&
        this.#firstSightFastPathEligible(key);
      if (repetition) {
        if (this.#fastPathAdmitted.has(key)) this.setPhraseSticky(key); // both paths → sticky
        this.#phraseCandidates.add(key);
      } else if (fastPath) {
        this.#phraseCandidates.add(key);
        this.#fastPathAdmitted.add(key);
      }
  - ADD private #firstSightFastPathEligible(key: string): boolean
      const words = key.split(" ");
      if (words.length > 5) return false;                 // PRD length bound
      return words.every((w) => {
        const c = this.get(w);                            // word store lookup
        return c !== undefined && (c.rankGroup === 0 || c.properName);
      });
      // absent constituent → false (cannot prove all-rare)
  - HOOK: call this.#admitPhrase(key, entry) for every phrase upserted inside
    recordPhraseLines (T1.S1's #upsertPhrase must return/have the entry — adjust it to
    call admit from its tail). No full-map scan.
  - ADD public API:
      isPhraseCandidate(key: string): boolean            // #phraseCandidates.has
      phraseCandidateKeys(): string[]                    // [...#phraseCandidates] (copy)
      isFastPathPhrase(key: string): boolean             // for T2.S2 sweep + /acwords
      removePhraseCandidacy(key: string): void           // T2.S2 demotion primitive:
        // delete from #phraseCandidates AND #fastPathAdmitted.
        // MUST NOT touch #phrases (counts stay). Do NOT unset sticky (once sticky,
        // sticky — same never-unset semantics as userTyped; a repeated phrase re-admits
        // via repetition path anyway, and sticky resisting eviction is desirable).
  - JSDoc every method citing PRD §06 h3.7.

Task 2: MODIFY test/phrases.test.ts — admission tests
  - FOLLOW pattern: existing describe blocks in test/phrases.test.ts / test/store.test.ts.
  - FIXTURES: seed word candidates via store.upsert(Sighting{...}) — see test/store.test.ts
    for the Sighting shape (key, display, ordinal, fromUser, properName, rankGroup,
    isSubword). Create rank-0 words, properName words, and rank-1/2 words deliberately.
  - TEST repetition path: record ["alpha","beta"] at ordinals 1 and 2 (constituents
    ordinary rank-1) → after 2nd record, isPhraseCandidate("alpha beta") === true,
    NOT sticky, not fast-path.
  - TEST fast path first sight: record line of two rank-0 words once → candidate
    immediately, isFastPathPhrase true, count === 1, not sticky.
  - TEST properName constituent counts as rare: line of [properName word + rank-0 word]
    admits first sight.
  - TEST mixed constituent blocks fast path: [rank-0 word + rank-1 word] once → NOT a
    candidate; record again (count 2) → candidate via repetition, still not sticky.
  - TEST sticky: fast-path phrase recorded twice → isPhraseCandidate true, sticky true
    (verify via getPhrase(key).sticky === true). Then force a phrase-map overflow
    (insert PHRASE_CAP other phrases) → sticky phrase survives, low-score ones evicted.
  - TEST length guard: synthesize calling #firstSightFastPathEligible indirectly — since
    capture only produces 2–3 word phrases, test the public behavior instead: a 2-word
    all-rare phrase admits; (length ≤ 5 is trivially satisfied — still assert the
    eligibility helper via a small exported-for-test const or trust code review; do NOT
    export internals solely for tests. A comment + the ≤5 check existing is acceptable.)
  - TEST absent constituent: record a line whose word was evicted from the word store
    (upsert then force word-store overflow, or simply record a line with a word never
    upserted) → fast path fails (get returns undefined → false), not a candidate at
    count 1; admitted at count 2 via repetition.
  - TEST removePhraseCandidacy: candidate phrase → removePhraseCandidacy(key) →
    isPhraseCandidate false, getPhrase(key).count unchanged (counts kept); record the
    line again → count 3 ≥ 2 → re-admitted via repetition path.
  - TEST recurrence after demotion re-admits via repetition only (not fast path:
    isFastPathPhrase false after demotion+re-admit when constituents are mixed).
  - NAMING: test functions inside describe("phrase admission (PRD §06 h3.7)").

Task 3: VALIDATE — full gate chain (below).
```

### Implementation Patterns & Key Details

```ts
// Admission at upsert tail (inside the phrase upsert path added by T1.S1):
// absent → create entry {count:1, sticky:false} → #admitPhrase(key, entry)
// present → count++, lastSeenOrdinal = ordinal → #admitPhrase(key, existing)
//
// #admitPhrase decision table:
//   count>=2, fastPathProvenance present → candidate + sticky = true   (both paths)
//   count>=2, no provenance            → candidate                      (repetition)
//   count==1, all-rare && len<=5       → candidate + provenance         (fast path)
//   count==1, otherwise                → nothing
//
// GOTCHA: sticky is set exactly once at the crossing upsert; never unset (mirrors
// userTyped OR-in semantics in word upsert).
// GOTCHA: fast-path evaluation must NOT depend on phrase map size (no scans) — it is
// O(words-in-key) word lookups, ≤ 5, per upserted phrase.
```

### Integration Points

```yaml
STORE API (new surface — treat as contract for downstream tasks):
  - isPhraseCandidate(key): boolean            # P2.M1.T3.S1 query integration
  - phraseCandidateKeys(): string[]            # P2.M1.T3.S1 / /acwords M2 dump
  - isFastPathPhrase(key): boolean             # P2.M1.T2.S2 demotion sweep filter
  - removePhraseCandidacy(key): void           # P2.M1.T2.S2 demotion action
CONFIG: none (core stays unconditional; enablePhrases gating unchanged from T1.S1)
QUERY: none this task — P2.M1.T3.S1 consumes the candidate set later
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check            # tsc --noEmit — must be clean
npx vitest run test/phrases.test.ts
```

### Level 2: Unit Tests

```bash
npx vitest run test/phrases.test.ts -v
npx vitest run test/store.test.ts -v      # word store unchanged
npx vitest run                             # FULL suite — zero regressions
```

### Level 3: Integration

```bash
# No new wiring this task (admission is internal to store.ts). Verify the extension path
# is unaffected:
npx vitest run test/index.test.ts test/ingest-pipeline.test.ts -v
```

### Level 4: Contract validation (domain-specific)

```bash
# Decision-table completeness check (manual, pinned by tests): every row of the table in
# "Implementation Patterns" has at least one dedicated test — repetition-only,
# fast-only, both (sticky), neither. Plus demotion primitive behavior (counts kept).
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run check` clean; `npx vitest run` all pass, zero regressions
- [ ] New admission tests pass and cover the full decision table

### Feature Validation
- [ ] Repetition path (count ≥ 2) admits regardless of constituent rarity
- [ ] Fast path admits first-sight all-rare (rankGroup 0 / properName) phrases ≤ 5 words
- [ ] Mixed or absent constituent words block the fast path
- [ ] sticky exactly when both paths fire; sticky resists phrase eviction
- [ ] Candidate set distinct from counts; removePhraseCandidacy keeps counts; recurrence re-admits
- [ ] Word store / prefix index / word eviction untouched

### Code Quality Validation
- [ ] Admission runs inside recordPhraseLines tail (no separate scans); O(1)-ish per phrase
- [ ] Follows store.ts JSDoc + private-field style; no src/core → src/pi imports
- [ ] No changes to PRD.md, tasks.json, or any pi/ wiring

## Anti-Patterns to Avoid

- ❌ Don't retro-evaluate the fast path on later sightings — first sight only
- ❌ Don't implement the 40-ordinal sweep (T2.S2), salience/suppression (T3.S1), or the
  successor index (P2.M2.T1.S1)
- ❌ Don't unset sticky on demotion — once true, always true
- ❌ Don't scan iteratePhrases() per ingest — admission is per-upsert
- ❌ Don't let an absent constituent crash the eligibility check (undefined → fail path)
- ❌ Don't touch word-store state or the prefix index dirty flag

---

**Confidence Score: 8/10** — the PRD rule is fully specified and the store API surface is
pinned by the T1.S1 PRP contract; the only uncertainty is naming drift between T1.S1's PRP
and its landed code, mitigated by Task 0 (read the actual code first).