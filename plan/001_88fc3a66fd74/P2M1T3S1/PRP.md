# PRP — P2.M1.T3.S1: Phrase salience + constituent suppression in rankMatches

---

## Goal

**Feature Goal**: Extend `rankMatches` (src/core/query.ts) so that when the typed
fragment prefixes a **phrase candidate's first word** (case-insensitive), the phrase
competes in the same ranked result set alongside single words. Phrases get their own
salience formula (PRD §06 h3.8) and trigger **constituent suppression**: a prefix-word
candidate is dropped from the same result set when a phrase containing it as its first
word has salience ≥ the word's salience.

**Deliverable**:
1. `phraseSalience(...)` computation + phrase gathering/merge/suppression logic inside
   `src/core/query.ts` (or a small helper it imports — see Task 1).
2. `RankedMatch[]` output that may contain phrase items: `key` = phrase key
   (lowercase, single-space-joined), `display` = constituent display casings joined
   with single spaces, `description` = `"phrase"` (exact literal).
3. Unit tests in `test/query.test.ts` (and/or `test/phrases.test.ts`) covering: phrase
   inclusion via first-word prefix, phrase salience formula (×1.2 + repetition bonus),
   suppression firing only when phrase salience ≥ word's, both kept when the word
   outranks, merged sort order and top-`limit` truncation.

**Success Definition**: Typing `renew` when both the word `renewable` and the admitted
phrase `renewable energy laboratory` are candidates yields the phrase in the results
with `description: "phrase"` and display `"Renewable Energy Laboratory"`-style joined
casing; the bare word `renewable` is absent IF the phrase's salience ≥ the word's, and
present when the word strictly outranks. All existing tests pass; the provider
(P1.M3.T3.S2) requires NO code changes — phrase `display`/`description` flow through
its existing `matches.map(...)` verbatim.

## User Persona

**Target User**: end user of hapax (indirect — internal module; DOCS: none required per
the work-item contract).

**Use Case**: The user's session has discussed "renewable energy laboratory" twice.
They type `renew` → the menu should offer the full phrase (zero extra keystrokes to
insert 3 words), not waste one of 8 slots on `renewable` alone when the phrase
outranks it.

**Pain Points Addressed**: PRD §06 h3.8 — "offering both `renewable` and `renewable
energy laboratory` wastes two of eight slots — keep only the phrase when phrase
salience ≥ word salience."

## Why

- PRD §06 h3.8 (settled ranking rule, quoted verbatim in the M2 section) and the work
  item's contract.
- This is the query-side payoff of the whole P2.M1 phrase store: T1.S1 captured
  n-grams, T2.S1 admitted candidates, T2.S2 keeps the set self-cleaning — this task
  makes admitted phrases actually appear in completions.
- Consumed by P2.M2.T3.S1 (M2 acceptance, `enablePhrases` gating — gating is wired
  THERE, not here; core query stays unconditional per the established core/wiring
  split).

## What

- **Phrase matching rule**: a phrase candidate participates when
  `prefix` (lowercased) prefixes the phrase's **first constituent word** (the phrase
  key's text up to its first space). Case-insensitive: the fragment is lowercased
  once, phrase keys are already lowercase.
- **Phrase salience** (PRD §06 h3.8, exact):
  `phraseSalience = (Σ constituent word saliences) × 1.2 + (repetition-path ? 2.0 × log2(1 + count) : 0)`
  where constituent saliences are `salience(c, currentOrdinal)` from score.ts for each
  constituent `Candidate` found in the store (skip/omit — see Gotchas — a constituent
  missing from the word store contributes 0; do NOT fail the query).
  **Repetition-path** = the phrase's `count >= 2` (the settled admission definition:
  admitted via repetition or fast-path+repeated). Fast-path-only phrases
  (`count === 1`) get the multiplier but no log bonus.
- **Constituent suppression** (settled): for each matching phrase P with salience
  S_P, for each single-word candidate W in the same result set whose key equals P's
  **first constituent word** (that is the only word the fragment prefixes, hence the
  only word that can co-occur): if `S_P >= S_W`, remove W from the result set. Strict
  inequality keeps both (word strictly outranks → both shown). The `>=` (not `>`) is
  the PRD's settled tie rule.
- **Merge & order**: surviving words + phrases sorted together by salience descending,
  then shorter key, then byte-lex on the lowercase key — the SAME tiebreak ladder as
  `compareCandidates` (PRD §04 h2.26). Take top `limit` (default 8).
- **Provider**: zero changes. `value`/`label` = `m.display`, `description` flows
  through. The item contract notes "accepting longer values" — pi's
  `AutocompleteSuggestion.value` is an arbitrary string; nothing to relax. Do NOT
  touch provider.ts.

### Success Criteria

- [ ] Phrase first-word prefix match works case-insensitively (`Renew` matches
      `renewable energy laboratory`); a fragment matching only a middle/last word
      (`energy`) does NOT surface the phrase.
- [ ] Phrase RankedMatch: `key` = phrase key, `display` = joined constituent `display`
      fields (single spaces), `description` = `"phrase"`, `salience` = exact formula
      value (unquantized).
- [ ] Suppression fires iff phrase salience ≥ word salience and word key === phrase
      first word; word strictly outranking → both in results.
- [ ] Merged order follows salience desc → shorter key → byte-lex; truncated to
      `opts.limit`.
- [ ] Performance: no per-query allocation blowup — gathering phrases is
      O(phrase candidates) (small set, see Gotchas); still comfortably under the
      < 1 ms keystroke budget.
- [ ] Existing `opts.suppress` seam and word-only behavior unchanged when no phrases
      are candidates; full existing test suite green.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything needed?" —
Yes: the exact store API (verified in landed code), the exact salience formula (PRD
quoted), and the existing query.ts structure (read in full) are all embedded below.

### Documentation & References

```yaml
- file: src/core/query.ts
  why: THE file to extend. Read fully first. rankMatches currently: prefixRange →
        snapshot slice → get per key → optional opts.suppress filter → sort with
        compareCandidates → slice(limit) → map to RankedMatch.
  pattern: "module-level JSDoc explaining invariants; DEFAULT_LIMIT = 8 named
           constant; lowercased prefix BEFORE prefixRange (it throws on uppercase)."
  gotcha: "opts.suppress exists as an M1-era extension seam but is a CALLER-supplied
           per-Candidate predicate — it cannot see phrases. Do NOT contort it; add
           phrase logic directly in rankMatches (that is what the seam's doc comment
           anticipated: 'P2.M1.T3.S1 ... constituent suppression'). Keep suppress
           working for word candidates as-is."

- file: src/core/store.ts
  why: Phrase API landed by T1.S1/T2.S1. Verified methods: recordPhraseLines,
        getPhrase(key): PhraseEntry|undefined, isPhraseCandidate(key),
        phraseCandidateKeys(): string[] (copy), isFastPathPhrase(key),
        removePhraseCandidacy(key), phraseEntries(), setPhraseSticky(key).
  pattern: "#phraseCandidates is a Set<string> of phrase keys; candidates ⊆ counts map."
  gotcha: "phraseCandidateKeys() returns a COPY — safe to iterate freely. Candidates
           set is small (bounded by admission + demotion); iterating it per keystroke
           is the intended cost. Do NOT iterate phraseEntries() (the 10k-cap counts
           map)."

- file: src/core/score.ts
  why: salience(c, currentOrdinal) is the single source of truth for word salience —
        IMPORT it, never reimplement. compareCandidates sorts Candidates only.
  gotcha: "Phrases are NOT Candidates — do not fabricate a fake Candidate to reuse
           compareCandidates' internal salience call. Compute phrase salience yourself
           (formula above), then sort the merged list with an explicit
           salience-desc → key.length → byte-lex comparator mirroring
           compareCandidates' ladder. Keep the ladder comment in sync."

- file: src/core/types.ts
  why: RankedMatch { key, display, description, salience } — phrase items reuse this
        shape unchanged. PhraseEntry { key, count, lastSeenOrdinal, firstSeenOrdinal,
        sticky }. NO new types needed (repeating salience per item? salience field is
        already there).
  gotcha: "Do not add a variant/discriminated union to RankedMatch — the provider maps
           it field-wise; the contract says value/label/description flow through."

- file: src/pi/provider.ts
  why: READ ONLY (do not modify). Line ~186: rankMatches(store, state.fragment,
        { limit: config.maxSuggestions }). Confirms phrase items flow through
        matches.map(m => ({ value: m.display, label: m.display,
        description: m.description })) untouched.
  gotcha: "liveKeyByValue maps item.value → RankedMatch.key with m.display keys;
           phrase displays contain spaces and are unique per phrase — no collision
           risk with single-word displays beyond what already exists. Out of scope
           here regardless (P2.M2 chain work owns that map)."

- file: test/query.test.ts (and test/phrases.test.ts)
  why: vitest conventions, describe-per-PRD-section. Add a
        describe("phrase salience + constituent suppression (PRD §06 h3.8)") block.

- file: plan/001_88fc3a66fd74/P2M1T2S2/PRP.md
  why: Parallel-work contract (demotion sweep). It only prunes the candidate set
        before queries run; no interface this task consumes changes.
- file: plan/001_88fc3a66fd74/P2M1T2S1/PRP.md
  why: Admission contract — defines when a phrase is a candidate (count ≥ 2 OR
        all-rare fast path) and sticky semantics. Query trusts
        isPhraseCandidate/phraseCandidateKeys blindly; never re-derive admission.
```

### Current Codebase tree (relevant slice)

```bash
src/core/query.ts      # rankMatches + RankOptions — EXTEND
src/core/score.ts      # salience, compareCandidates — import only
src/core/store.ts      # phrase API (T1.S1/T2.S1 landed) — consume
src/core/types.ts      # RankedMatch, PhraseEntry, Candidate — unchanged
src/pi/provider.ts     # call site — unchanged
test/query.test.ts     # extend (phrase describe block)
test/phrases.test.ts   # may host store-level fixtures; extend either file
```

### Desired Codebase tree with files to be added/changed

```bash
src/core/query.ts      # MODIFY: phrase gathering, phraseSalience, suppression, merged sort
test/query.test.ts     # MODIFY: new describe block + fixtures
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: "prefix word of the phrase" (PRD h3.8) in the query context = the
// phrase's FIRST word — only it can prefix-match the same fragment the phrase
// matched on. Middle/last constituents are NOT suppressed (typing "renew" cannot
// co-present with "energy" anyway — different prefixes).
// CRITICAL: phrase salience needs the constituent word Candidates. A constituent
// may have been EVICTED from the word store while the phrase survived (separate
// stores — store.ts header is explicit they share nothing). Missing constituent →
// contribute 0 to the sum; never throw, never skip the phrase.
// CRITICAL: "repetition-path" bonus = entry.count >= 2 (matches admission's
// repetition definition). Do NOT use isFastPathPhrase — a sticky phrase had BOTH
// paths and deserves the bonus; a demoted-then-re-admitted phrase is
// repetition-path with no fast provenance. count >= 2 covers all of these.
// CRITICAL: sort the MERGED list with an explicit comparator (salience desc →
// key length asc → byte-lex on lowercase key). compareCandidates(a: Candidate,...)
// calls salience() itself — you cannot feed it phrase saliences. Mirror the ladder
// exactly; cite h2.26 in the comment.
// CRITICAL: suppression must compare EXACT float saliences with >= (PRD: "phrase
// salience ≥ word salience" suppresses). Word uses salience(c, ordinal); phrase
// uses the formula. Compute both once, compare numbers.
// CRITICAL: keep the prefixRange-before-snapshot ordering invariant (module doc)
// for the WORD half — phrase gathering must not disturb it.
// CRITICAL: prefix.lowercase BEFORE any phrase matching too (phrase keys are
// lowercase; store.prefixRange throws on uppercase input).
// src/core never imports from src/pi (architecture invariant).
// Performance: word path is O(range log range); phrase path adds O(candidates)
// scan + salience math per matching phrase. Candidates set is admission-bounded —
// fine. If profiling (P1.M4.T1.S2 bench) ever flags it, a first-word trie is the
// documented future optimization — NOT now.
```

## Implementation Blueprint

### Data models

No new types. Phrase results reuse `RankedMatch` with `description: "phrase"`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ landed code
  - READ src/core/query.ts, src/core/store.ts (phrase section, lines ~300-520),
    src/core/score.ts (salience + compareCandidates), src/pi/provider.ts (call site).
    Names in this PRP were verified against landed code, but T2.S2 lands in parallel —
    re-verify the phrase API surface before coding.

Task 1: MODIFY src/core/query.ts — phrase integration
  - ADD module-level constants with JSDoc citing PRD §06 h3.8:
      const PHRASE_MULTIPLIER = 1.2;   // phrases are more specific targets
      const PHRASE_REPETITION_W = 2.0; // × log2(1 + count), repetition-path only
  - ADD (module-private or exported-for-test) pure helpers:
      /** Phrase salience (PRD §06 h3.8): Σ constituent saliences × 1.2,
       *  + 2.0·log2(1+count) when repetition-path (count >= 2). Missing
       *  (evicted) constituents contribute 0. */
      function phraseSalience(
        constituents: ReadonlyArray<Candidate | undefined>,  // parallel to key words
        entry: PhraseEntry,
        currentOrdinal: number,
      ): number
      /** First word of a phrase key ("a b c" → "a"). */
      function firstWord(phraseKey: string): string  // key.slice(0, key.indexOf(' '))
  - EXTEND rankMatches AFTER the word candidates array is built (post-get loop,
    pre-sort):
      1. const lower (already computed) — gather matching phrases:
         for (const pk of store.phraseCandidateKeys()):
           if (firstWord(pk).startsWith(lower)):
             entry = store.getPhrase(pk); if (!entry) continue;
             words = pk.split(' ');
             constituentSal = Σ salience(store.get(w) ?? 0-term, ordinal);
             phraseSal = phraseSalience(...);
             keep { key: pk, sal: phraseSal, entry }
      2. Apply opts.suppress to word candidates FIRST (existing behavior), THEN
         constituent suppression: for each phrase, delete any word candidate whose
         key === firstWord(pk) && phraseSal >= wordSal.
      3. Build the merged RankedMatch list:
         words → { key, display, description: `session x${sessionCount}`,
                   salience: salience(c, ordinal) }  (existing mapping)
         phrases → { key: pk, display: words.map(w => store.get(w)?.display ?? w).join(' '),
                     description: "phrase", salience: phraseSal }
      4. Sort merged list: salience desc → key.length asc → byte-lex on key.
         (Explicit comparator — see Gotchas; do NOT call compareCandidates on
         phrase items.)
      5. slice(0, limit) — the shared cap truncates both kinds together.
  - PRESERVE: early returns (limit ≤ 0 → []), empty-result → [] semantics
    (provider delegates), DEFAULT_LIMIT, the module doc's index-ordering invariant.
  - UPDATE the module JSDoc: strike the "M2 EXTENSION SEAM" note's future tense —
    phrases are now first-class; opts.suppress remains a caller-side filter.

Task 2: MODIFY test/query.test.ts — unit tests
  - FIXTURE helper: build a CandidateStore; upsert Sighting-per-constituent (choose
    sessionCount/lastSeenOrdinal to control word salience precisely); recordPhraseLines
    twice (repetition) or once with all-rare rank-0 constituents (fast path) to admit
    the phrase; then rankMatches(store, "renew").
  - TEST phrase inclusion: phrase candidate "renewable energy laboratory", fragment
    "renew" → result contains item with key === the phrase key, description ===
    "phrase", display === constituent displays joined with " ".
  - TEST salience formula (exact float): repetition phrase count 3 → expected
    (Σ saliences) × 1.2 + 2.0·Math.log2(4). Fast-path count 1 → multiplier only.
    Use toBeCloseTo or precomputed exact values.
  - TEST suppression fires: arrange phrase salience ≥ word salience → single-word
    "renewable" absent, phrase present.
  - TEST both kept: arrange word salience strictly > phrase salience (e.g. very high
    word sessionCount / recency, weak constituents) → both present, word ranked
    above the phrase.
  - TEST prefix rule: fragment "energy" does NOT surface the phrase.
  - TEST missing constituent: evict/never-store one constituent word → phrase still
    returned, salience treats missing as 0 (compare against expected value).
  - TEST merged truncation: 10 candidates competing, limit default 8 → exactly 8,
    correctly ordered across kinds.
  - TEST no phrases / phrases-disabled-shaped store (no phrase candidates) →
    behavior byte-identical to M1 (existing tests already cover; add one regression
    assert with an empty phrase set).
  - TEST opts.suppress still applies to word candidates independently of phrases.

Task 3: VALIDATE — full gate chain below.
```

### Implementation Patterns & Key Details

```ts
// Phrase gathering sketch (inside rankMatches, after the word loop):
const ordinal = store.currentOrdinal(); // already computed for word path
const phraseHits: { key: string; sal: number; entry: PhraseEntry }[] = [];
if (store.phraseCandidateKeys) {           // defensive: T1.S1 landed — always present
  for (const pk of store.phraseCandidateKeys()) {   // copy — safe
    if (!firstWord(pk).startsWith(lower)) continue; // FIRST word only (h3.8)
    const entry = store.getPhrase(pk);
    if (!entry) continue;                  // demoted/evicted between snapshot & get
    let sum = 0;
    for (const w of pk.split(" ")) {
      const c = store.get(w);              // word may be evicted — contribute 0
      if (c) sum += salience(c, ordinal);
    }
    const sal =
      sum * PHRASE_MULTIPLIER +
      (entry.count >= 2 ? PHRASE_REPETITION_W * Math.log2(1 + entry.count) : 0);
    phraseHits.push({ key: pk, sal, entry });
  }
}
// Constituent suppression: drop word candidates shadowed by an outranking phrase.
// GOTCHA: >= not > — tie goes to the phrase (PRD settled).
// Merged comparator (mirror compareCandidates' ladder, h2.26):
//   sal desc → key.length asc → byte-lex (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
```

### Integration Points

```yaml
STORE API (consumed):
  - phraseCandidateKeys(), getPhrase(), get(), currentOrdinal(), prefixRange(),
    sortedKeysSnapshot()   # no new store methods required
SCORE (imported):
  - salience() — constituent sums; compareCandidates stays for word-only sorts if
    you keep the word half separate, but the merged list needs the explicit ladder
PROVIDER: none — value/label/description flow through (verified call site)
CONFIG: none — enablePhrases gating is P2.M2.T3.S1's job (wiring layer)
DOCS: none — internal module (work-item contract)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check            # tsc --noEmit — must be clean
```

### Level 2: Unit Tests

```bash
npx vitest run test/query.test.ts -v
npx vitest run test/phrases.test.ts test/store.test.ts -v
npx vitest run                             # FULL suite — zero regressions
```

### Level 3: Integration

```bash
npx vitest run test/provider.test.ts test/index.test.ts -v   # provider untouched → green
```

### Level 4: Contract validation (domain-specific)

```bash
# Formula pin: one test asserts the EXACT PRD §06 h3.8 arithmetic (×1.2,
# +2.0·log2(1+count) iff count>=2) against precomputed floats.
# Suppression matrix: {phraseSal > wordSal, ==, <} × {word is first word, isn't}
# → suppress, suppress, keep; unrelated word never suppressed.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run check` clean; `npx vitest run` all pass, zero regressions
- [ ] New query tests cover: inclusion, exact formula, suppression both directions,
      prefix-first-word rule, missing constituent, merged truncation

### Feature Validation
- [ ] Phrase items appear with `description: "phrase"` and joined display casing
- [ ] Suppression fires only when phrase salience ≥ word's; both kept when word wins
- [ ] Same tiebreak ladder + top-8 truncation across words and phrases
- [ ] Provider file untouched and its tests green

### Code Quality Validation
- [ ] salience imported from score.ts — no arithmetic duplication except the
      phrase-specific formula (which PRD defines separately)
- [ ] No new types; no src/core → src/pi imports; no config additions
- [ ] Existing opts.suppress behavior preserved; module JSDoc updated

## Anti-Patterns to Avoid

- ❌ Don't use `isFastPathPhrase` for the repetition bonus — `count >= 2` is the rule
- ❌ Don't suppress middle/last constituents — only the phrase's first word can
      prefix-collide with the fragment
- ❌ Don't fabricate fake Candidates to reuse compareCandidates — explicit merged
      comparator with the same ladder
- ❌ Don't iterate phraseEntries() (10k counts map) — phraseCandidateKeys() only
- ❌ Don't throw on evicted constituents — contribute 0
- ❌ Don't touch provider.ts, config, or admission/demotion logic (parallel T2.S2 owns
      the sweep; query only reads the candidate set)
- ❌ Don't gate phrases on config here — enablePhrases gating is P2.M2.T3.S1

---

**Confidence Score: 8/10** — the formula and suppression rule are quoted verbatim from
the PRD, the store API was verified in landed code, and the query.ts extension point is
documented in that module's own JSDoc. Residual risk: T2.S2 lands in parallel (sweep
only prunes candidates — no interface change, so conflict risk is low), and the
"prefix word = first word" reading (forced by the matching rule itself) plus the
`count >= 2` repetition-path reading are interpretive pins the tests make explicit.