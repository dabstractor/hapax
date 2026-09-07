# PRP — P2.M1.T2.S2: 40-ordinal demotion sweep for unconfirmed fast-path phrases

---

## Goal

**Feature Goal**: Implement PRD §06 h3.7's decay rule: fast-path phrase candidates that
never reach `count >= 2` within 40 subsequent message ordinals are **demoted** — removed
from the phrase candidate set while their counts are retained in `#phrases` so a later
recurrence re-admits them via the repetition path. The sweep runs once at the end of
each ingest flush and must be **O(candidates)** — iterating a candidates snapshot, never
the whole counts map.

**Deliverable**:
1. `sweepPhraseDemotions(): number` on `CandidateStore` in `src/core/store.ts`
   (uses T2.S1's `removePhraseCandidacy` primitive; returns the number demoted).
2. Wiring: the sweep fires at the tail of `IngestPipeline`'s drain (`src/pi/ingest.ts`),
   once per flush.
3. Unit tests in `test/phrases.test.ts` covering: demotion at ordinal boundary,
   non-demotion at diff < 40, count ≥ 2 never demoted, re-promotion on recurrence,
   idempotence.

**Success Definition**: A first-sight fast-path phrase (count 1, firstSeenOrdinal 1) is
demoted when the store's current ordinal reaches 41 (diff ≥ 40); its `getPhrase(key)`
entry (count, ordinals) is unchanged; recording the same line again re-admits it via the
repetition path (count 2) with `sticky === false` and `isFastPathPhrase === false`;
phrases with `count >= 2` (including sticky) are never demoted regardless of age; the
sweep iterates only the candidate snapshot. All existing tests pass.

## User Persona

**Target User**: end user of hapax (indirect — internal module; DOCS: none required).

**Use Case**: A user pastes a doc once containing "quantum flux capacitor" (all-rare) —
it's offered immediately (fast path, T2.S1) — but it never recurs. 40 messages later it
must silently disappear from candidates instead of squatting a candidate slot forever.

**Pain Points Addressed**: Unbounded growth of one-off fast-path candidates pollutes the
candidate set feeding P2.M1.T3.S1's ranking. The sweep keeps the set bounded and
self-cleaning without losing information (counts kept for re-promotion).

## Why

- PRD §06 h3.7 (settled): "Fast-path phrases that fail to reach `count >= 2` within 40
  subsequent message ordinals are demoted (removed from phrase candidates, kept in
  counts in case they recur)."
- Produces the "Bounded, self-cleaning phrase candidate set" that P2.M1.T3.S1 (phrase
  query integration) consumes. Without it, every rare n-gram ever seen is forever a
  candidate and M2 ranking degrades over a long session.

## What

- Add `sweepPhraseDemotions(): number` to `CandidateStore`. It demotes every phrase
  where ALL of:
  1. it is currently a phrase candidate AND has fast-path provenance
     (`isFastPathPhrase(key) === true` — T2.S1's set),
  2. `this.currentOrdinal() - entry.firstSeenOrdinal >= 40`
     ("40 **subsequent** message ordinals" — firstSeen 1, now 41 → demoted;
     now 40 → not yet),
  3. `entry.count < 2` (belt-and-braces: also skip `entry.sticky` — sticky implies
     count ≥ 2, but guard anyway).
- Demotion action = T2.S1's existing `removePhraseCandidacy(key)`: removes from
  `#phraseCandidates` and `#fastPathAdmitted`, keeps counts/ordinals/sticky. Do NOT
  re-implement removal and do NOT unstick.
- Implementation MUST iterate a **snapshot** of candidate keys
  (`phraseCandidateKeys()` already returns a copy) — never `#phrases` /
  `iteratePhrases()`. Per key: two O(1) set lookups + one `getPhrase` map lookup.
- Wire the sweep into `src/pi/ingest.ts` at the end of each ingest flush: the tail of
  `#drainQueue()` (its `finally`, where `#drain` is reset). One drain may contain many
  messages — one sweep per drain is correct (demotion isn't latency-sensitive). Follow
  whatever gating T1.S1 landed for phrase recording (`onAdmittedTokens` callback vs
  direct store call) and gate identically, so phrases-disabled builds never sweep.
- Core stays unconditional; no config changes; `enablePhrases` gating is wiring-level.

### Success Criteria

- [ ] Fast-path candidate, count 1, firstSeenOrdinal 1: at `currentOrdinal() === 41` →
      demoted; at 40 → still a candidate.
- [ ] Demoted entry keeps `getPhrase(key)` count/ordinals intact (counts retained).
- [ ] Demoted phrase recurring → count 2 → re-admitted via repetition path; sticky
      stays false; `isFastPathPhrase` false (provenance cleared by demotion).
- [ ] count ≥ 2 phrases (repetition-only AND sticky fast-path) never demoted.
- [ ] Repetition-only candidates (no fast-path provenance) never demoted.
- [ ] Sweep is O(candidates) — candidate-snapshot iteration only; idempotent
      (second consecutive call demotes 0).
- [ ] Sweep fires once per ingest flush drain in the live pipeline.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything needed?" — Yes:
PRD §06 h3.7 is quoted in full above (via selected sections), the store API surface is
pinned by the T1.S1 and T2.S1 PRP contracts, and the wiring point (`#drainQueue`) was
verified by reading `src/pi/ingest.ts`.

### Documentation & References

```yaml
- file: src/core/store.ts
  why: EXTEND with sweepPhraseDemotions. Read the landed T1.S1/T2.S1 code FIRST —
        naming may drift from their PRPs; adapt to actual code.
  pattern: "private #fields, JSDoc'd public methods, currentOrdinal() as 'now',
           eviction pass at line ~147 uses const now = this.currentOrdinal() once."
  gotcha: "phraseCandidateKeys() returns a COPY — safe to call removePhraseCandidacy
           while iterating. Do NOT iterate #phrases or iteratePhrases()."

- file: src/core/types.ts
  why: PhraseEntry shape — { key, count, lastSeenOrdinal, firstSeenOrdinal, sticky }.
        No new types needed for this task.

- file: src/pi/ingest.ts
  why: Wire the sweep at the end of each ingest flush. #drainQueue() drains the pending
        queue (one processText per message, one ordinal per message) in try/finally.
  pattern: "options object in constructor (see onAdmittedTokens, #yieldFn); #drain
           promise invariants; dispose() must not fire the sweep."
  gotcha: "One drain = one sweep, even for N messages. Put the call in the finally of
           #drainQueue (or right after the while loop) so every flush path (timer fire,
           flush(), restore) sweeps. Keep it cheap: it is O(candidates)."

- file: plan/001_88fc3a66fd74/P2M1T2S1/PRP.md
  why: CONTRACT for the admission layer being implemented in parallel. Exact API:
        isPhraseCandidate, phraseCandidateKeys, isFastPathPhrase,
        removePhraseCandidacy (removes candidacy + provenance, keeps counts,
        never unsets sticky). The sweep is the ONLY intended caller of
        removePhraseCandidacy.
  gotcha: "If names differ in landed code, use actual names. Do not duplicate removal
           logic — call removePhraseCandidacy."

- file: plan/001_88fc3a66fd74/P2M1T1S1/PRP.md
  why: CONTRACT for the phrase layer: recordPhraseLines, getPhrase, PhraseEntry,
        PHRASE_CAP. Sweep does not touch capture or eviction.

- file: test/phrases.test.ts
  why: Test conventions (vitest, describe-per-PRD-section). Extend with a
        describe("40-ordinal demotion sweep (PRD §06 h3.7)") block.

- docfile: plan/001_88fc3a66fd74/P2M1T2S2/research/notes.md
  why: Verified facts, boundary semantics (>= 40 not > 40), wiring decision,
        full test plan.
```

### Current Codebase tree (relevant slice)

```bash
src/core/store.ts        # CandidateStore + phrase layer (T1.S1) + admission (T2.S1) — extend
src/core/types.ts        # PhraseEntry — read only
src/pi/ingest.ts         # IngestPipeline — wire sweep at drain tail
test/phrases.test.ts     # created by T1.S1, extended by T2.S1 — extend further
test/store.test.ts       # word-store tests — must stay green
test/ingest-pipeline.test.ts  # pipeline tests — extend for sweep wiring
```

### Desired Codebase tree with files to be added/changed

```bash
src/core/store.ts             # MODIFY: sweepPhraseDemotions(): number
src/pi/ingest.ts              # MODIFY: call sweep at end of each drain (gated like T1.S1)
test/phrases.test.ts          # MODIFY: demotion sweep describe block
test/ingest-pipeline.test.ts  # MODIFY (optional): assert sweep fires after flush
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: boundary is "40 SUBSEQUENT message ordinals" (PRD) → demote when
// currentOrdinal() - firstSeenOrdinal >= 40. The item's own test spec pins this:
// firstSeen 1 + current ordinal 41 (diff 40) → demoted. Diff 39 (ordinal 40) → not.
// (A naive `> 40` reading would demote one ordinal late — wrong per the contract.)
// CRITICAL: sticky implies count >= 2, so count < 2 excludes sticky naturally — but
// skip sticky phrases explicitly anyway (defense against future admission changes).
// CRITICAL: phraseCandidateKeys() is a snapshot copy; mutating during iteration is safe.
// Iterating the LIVE #phrases map (iteratePhrases) violates the O(candidates) contract
// (tens of thousands of counted n-grams vs a small candidate set).
// CRITICAL: firstSeenOrdinal for fast-path phrases equals their sighting ordinal (count
// was 1 at first sight). Use getPhrase(key).firstSeenOrdinal — do not track a separate
// admission ordinal.
// CRITICAL: after demotion, re-admission can ONLY be repetition-path (provenance is
// cleared), so a demoted-then-recurring phrase is never sticky. This is correct per PRD.
// CRITICAL: dispose() cancels pending drain — a cancelled queue must NOT sweep (no
// messages processed). Sweeping in the finally of a drained-to-empty queue is fine;
// sweeping after dispose with #pending cleared also fine (drain exits its loop).
// src/core never imports from src/pi (architecture invariant).
// Ordinals advance via nextOrdinal() only; in tests, either upsert a dummy Sighting
// with ordinal: 41 or loop store.nextOrdinal() — currentOrdinal() then reflects it.
```

## Implementation Blueprint

### Data models

No new types. Sweep state lives entirely in T2.S1's sets + T1.S1's `#phrases` entries.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ the landed code
  - READ src/core/store.ts (actual T1.S1 + T2.S1 implementation — names may drift from
    their PRPs) and src/pi/ingest.ts (drain structure, phrase gating). Adapt names below.

Task 1: MODIFY src/core/store.ts — the sweep
  - ADD public method with JSDoc citing PRD §06 h3.7:
      /** Demote fast-path phrase candidates that never reached count >= 2 within
       *  40 subsequent message ordinals (PRD §06 h3.7). Counts are retained — a
       *  recurrence re-admits via the repetition path. O(candidates): iterates a
       *  candidate-key snapshot, never the phrase counts map.
       *  @returns number of phrases demoted (for stats/tests). */
      sweepPhraseDemotions(): number {
        const now = this.currentOrdinal();        // one "now" for the whole pass
        let demoted = 0;
        for (const key of this.phraseCandidateKeys()) {   // snapshot copy
          if (!this.isFastPathPhrase(key)) continue;      // repetition-only: never demote
          const entry = this.getPhrase(key);              // O(1) map lookup
          if (entry === undefined) continue;              // defensive; shouldn't happen
          if (entry.sticky || entry.count >= 2) continue; // confirmed: keep
          if (now - entry.firstSeenOrdinal >= 40) {       // 40 SUBSEQUENT ordinals
            this.removePhraseCandidacy(key);              // T2.S1 primitive: keeps counts
            demoted++;
          }
        }
        return demoted;
      }
  - DO NOT touch #phrases, word store, prefix index, eviction.

Task 2: MODIFY src/pi/ingest.ts — wire the sweep at end of flush
  - FOLLOW pattern: whatever gating T1.S1 landed for phrase capture (the
    onAdmittedTokens callback and/or a direct #store reference). Gate the sweep the
    SAME way (no sweep when phrases disabled).
  - PLACEMENT: in #drainQueue, after the while loop / in the finally alongside
    this.#drain = null — one sweep per drain regardless of how many messages drained.
    Guard against throwing: wrap in try/catch swallow (defensive, matching #drainQueue's
    existing error posture) or rely on the method being pure over store state.
  - If IngestPipeline holds #store directly (it does), and T1.S1/T2.S1 wired capture
    via an option callback, mirror that: add `#onSweepPhrases?: () => void` option and
    call it in the drain tail; extension wires it to () => store.sweepPhraseDemotions().

Task 3: MODIFY test/phrases.test.ts — sweep unit tests
  - FIXTURES (per test): seed rank-0 constituent words via store.upsert(Sighting)
    so the fast path admits; record one line via recordPhraseLines(["w1","w2"], 1);
    advance time via store.nextOrdinal() loop or upsert(dummy, {ordinal: N}).
  - TEST boundary: fast-path phrase firstSeenOrdinal 1, count 1.
      currentOrdinal 40 (nextOrdinal x39) → sweep() returns 0, still candidate.
      currentOrdinal 41 → sweep() returns 1, isPhraseCandidate === false.
  - TEST counts retained: getPhrase(key) after sweep → count 1, firstSeenOrdinal 1,
      lastSeenOrdinal unchanged.
  - TEST re-promotion: record same line again at ordinal 42 → count 2 →
      isPhraseCandidate === true (repetition path), getPhrase(key).sticky === false,
      isFastPathPhrase === false. Then sweep at ordinal 200 → returns 0 (count >= 2).
  - TEST sticky never demoted: fast-path phrase recorded twice (sticky), advance to
      ordinal 100, sweep → 0, still candidate.
  - TEST repetition-only never demoted: mixed-constituent line recorded twice
      (candidate, no provenance), advance far, sweep → 0.
  - TEST idempotence: two consecutive sweep() calls — second returns 0.
  - TEST no-candidates no-op: sweep on a store with no phrase candidates returns 0.

Task 4: MODIFY test/ingest-pipeline.test.ts — wiring test (optional but recommended)
  - Spy on the sweep (mock store or the #onSweepPhrases option if callback-wired):
    enqueue 2 messages, flush(), assert sweep called exactly once after drain completes.
    Assert dispose() before a drain never sweeps.

Task 5: VALIDATE — full gate chain (below).
```

### Implementation Patterns & Key Details

```ts
// Sweep decision table (key is a current candidate):
//   fast-path provenance | sticky | count | now - firstSeen | action
//   no                   |   -    |   -   |       -         | keep (repetition-confirmed or repetition-only)
//   yes                  | yes    |  >=2  |       -         | keep (both paths fired)
//   yes                  | no     |  >=2  |       -         | keep (repetition-confirmed)
//   yes                  | no     |   1   |     < 40        | keep (still on probation)
//   yes                  | no     |   1   |    >= 40        | DEMOTE (removePhraseCandidacy)
//
// GOTCHA: "still on probation" phrases with count > 1 can't exist in the fast-path
// row with sticky false unless sticky-setting was missed — the count>=2 continue
// handles them correctly regardless.
// GOTCHA: the sweep never increments stats counters unless a stats field exists for
// demotions — if IngestStats gains a demotedPhrases field, add it to getStats()'s copy
// logic; otherwise skip stats entirely (PRD doesn't require it).
```

### Integration Points

```yaml
STORE API (consumed/produced):
  - consumes: phraseCandidateKeys(), isFastPathPhrase(), getPhrase(),
              currentOrdinal(), removePhraseCandidacy()  (all from T2.S1 / T1.S1)
  - produces: sweepPhraseDemotions(): number  # future /acwords M2 dump may surface it
INGEST WIRING:
  - src/pi/ingest.ts #drainQueue tail: one sweep per flush, gated like phrase capture
QUERY: none — P2.M1.T3.S1 consumes the (now self-cleaning) candidate set
CONFIG: none
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check            # tsc --noEmit — must be clean
```

### Level 2: Unit Tests

```bash
npx vitest run test/phrases.test.ts -v
npx vitest run test/store.test.ts test/ingest-pipeline.test.ts -v
npx vitest run                             # FULL suite — zero regressions
```

### Level 3: Integration

```bash
# No new user-facing wiring; verify pipeline + extension entry unaffected:
npx vitest run test/index.test.ts test/ingest-restore.test.ts -v
```

### Level 4: Contract validation (domain-specific)

```bash
# Decision-table completeness: each of the 6 rows above has a dedicated test
# (keep/keep/keep/keep/keep/DEMOTE). Plus: counts-retained, re-promotion,
# idempotence, sweep-fires-once-per-flush.
```

## Final Validation Checklist

### Technical Validation
- [ ] `npm run check` clean; `npx vitest run` all pass, zero regressions
- [ ] New sweep tests pass; boundary test pins `>= 40` (ordinal 41 with firstSeen 1 demotes)

### Feature Validation
- [ ] Fast-path-only candidate, count 1, 40+ ordinals stale → demoted; counts retained
- [ ] count ≥ 2 / sticky / repetition-only candidates never demoted
- [ ] Demoted phrase recurring re-admits via repetition path, sticky false
- [ ] Sweep O(candidates): candidate snapshot iteration only; idempotent
- [ ] Sweep fires once per ingest flush drain; not on dispose-cancelled queues

### Code Quality Validation
- [ ] Uses T2.S1's removePhraseCandidacy — no duplicate removal logic
- [ ] Follows store.ts JSDoc + private-field style; no src/core → src/pi imports
- [ ] Word store, prefix index, phrase capture, eviction, and admission logic untouched
- [ ] No changes to PRD.md, tasks.json, or config surface

## Anti-Patterns to Avoid

- ❌ Don't use `> 40` — the contract is 40 SUBSEQUENT ordinals → `>= 40` diff demotes
- ❌ Don't iterate `#phrases` / `iteratePhrases()` — that's the counts map, O(all n-grams)
- ❌ Don't clear counts, ordinals, or sticky on demotion — candidacy only
- ❌ Don't sweep per-message — once per drain/flush
- ❌ Don't re-implement admission or removal — call T2.S1's primitives
- ❌ Don't add config knobs (the 40 constant is settled, PRD §08 h2.47)

---

**Confidence Score: 8/10** — the rule is fully specified in PRD §06 h3.7, the demotion
primitive and provenance set are pinned by the T2.S1 PRP contract, and the wiring point
was verified in the live code. Residual risk: naming drift between T1.S1/T2.S1 PRPs and
their landed code (mitigated by Task 0) and the `>= 40` vs `> 40` boundary reading,
which this PRP pins to the item's own test spec.