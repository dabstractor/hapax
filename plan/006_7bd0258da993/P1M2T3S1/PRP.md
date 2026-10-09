---
name: "P1.M2.T3.S1 (plan 006) — /acwords: tally columns + series-marked successor sample"
---

## Goal

**Feature Goal**: Update the `/acwords` debug surfaces (popup + `/tmp/hapax-store.txt`
dump + successor sample in `src/pi/debug.ts`) to reflect the new casing-tally
store schema (spec 06 h2.41: `capCount`/`lowerCount`/`capDisplay`; `Candidate.display`
is GONE since P1.M2.T1.S2) and the series-marked successor index (spec 06 h2.45:
`Successor.series`/`nextDisplay`). The file carries three explicit
`TODO(P1.M2.T3.S1)` markers at exactly these sites — this task retires them all.

**Deliverable**: Modified `src/pi/debug.ts` (three TODO sites + JSDoc), extended
`test/debug.test.ts`. No other files.

**Success Definition**:
- Popup top-N rows show the tally columns: resolved display (capDisplay-when-present,
  else key — the completion-time interim form stays per the TODO note), ×sessionCount,
  and the casing tallies (cap/lower counts).
- `/tmp/hapax-store.txt` TSV gains `capCount`/`lowerCount` columns in every row.
- Successor sample marks series entries (a `series` flag/marker) and renders
  series successors with their `nextDisplay` run casing.
- `npm run check` + `npm test` green; no new persistence (the /tmp dump is the
  existing sanctioned exception); registration still gated on `config.debug`.

## Why

- The store schema changed under the debug dump (P1.M1.T2.S1 tallies;
  P1.M2.T1.S2 removed `Candidate.display`), leaving interim render forms marked
  with TODOs. /acwords is the owner-facing tuning/audit tool (§09 h2.63 tuning
  protocol; §08 h2.58) — it must show the FULL R1/R2 state: casing tallies
  (the R1 evidence) and series bigrams (R2's chain-only members and run casing).
- Downstream: P3.M1.T2.S3's live smoke (branch-hygiene scenario) asserts via
  /acwords — this dump is that scenario's evidence tool.

## What

1. **Popup top-N rows** (`topSection`, `src/pi/debug.ts:66-85`, TODO at :77-81):
   extend the row format from
   `` `${i+1}. ${display} ×${sessionCount} group ${g} (${label})` ``
   to include the tally columns, e.g.
   `` `${i+1}. ${display} ×${sessionCount} (cap ${capCount}/lower ${lowerCount}) group ${g} (${label})` ``
   Display resolution stays the landed interim form (`capDisplay !== "" ?
   capDisplay : c.key`) — completion-time casing resolution (spec 04 h2.32)
  is the query layer's job; the dump shows the resolved form only, per the
   TODO's own note. Keep salience unprinted (count + group is the tuning
   signal — existing comment).
2. **Successor sample** (`successorsSection`, :88-113, TODO at :110):
   - Per-successor rendering: series entries render as
     `nextDisplay ×count (series)` (run casing + flag); ordinary entries stay
     `next ×count`. e.g. `NREL → Renewable ×3 (series), research ×2`.
   - Word column stays the same resolved display form as topSection.
   - Keep the structure: SUCCESSOR_SAMPLE_N=10 filter over the SAME
     `topCandidates` rows (no second "now", no re-sort); empty index → `(none)`;
     pure read of `topSuccessors` (map/join, never mutate).
3. **/tmp/hapax-store.txt TSV** (`registerAcwordsCommand` handler, :183-207,
   TODO at :197): extend the row from
   `key\tdisplay\tx<count>\tg<group>[\tproper][\ttyped]`
   to include the tallies, e.g.
   `key\tdisplay\tx<count>\tcap<capCount>\tlower<lowerCount>\tg<group>[\tproper][\ttyped]`
   — keep column order stable across rows, keep the sort (sessionCount desc →
   key length → byte-lex), keep the try/catch (notify dump survives a failed
   write), keep the footer path line.
4. **JSDoc (Mode A — rides with the work)**: update the module header
   (:1-20 "dump shows words and successor rows only… ") and the handler
   comment (:183-186 "one line per word: key, display, count, group, flags")
   to describe the updated formats incl. the tally columns, the series
   marker + nextDisplay run casing, and the TSV column list.
5. **Tests** in `test/debug.test.ts` (existing conventions: real
   `CandidateStore`, `see()` upsert fixture with `casing` field,
   `fakeStats`/`statsStub`/`fakePi` structural stubs):
   - Popup row: a candidate with mixed sightings (e.g. 3 capitalized + 2
     lowercase) renders `cap 3/lower 2` (exact string containment).
   - Successor sample: seed a series bigram (series entry with nextDisplay)
     via the store's bigram path (see store.test.ts's recordBigramRuns /
     series fixtures — reuse the same seeding helper conventions); assert the
     row shows `nextDisplay ×N (series)` and an ordinary successor unmarked.
   - TSV: after `registerAcwordsCommand` handler runs (fake pi), read
     `/tmp/hapax-store.txt` and assert the column layout on a known word.
   - Registration guard unchanged (debug:false → no command).

### Success Criteria

- [ ] All three `TODO(P1.M2.T3.S1)` markers gone; no reads of `Candidate.display` anywhere
- [ ] Popup rows + TSV rows carry capCount/lowerCount; successor sample marks series + nextDisplay casing
- [ ] Deterministic formats (stable column order, same sorts, same tie-breaks)
- [ ] Guard (`config.debug`), RAM-only invariant, /tmp exception unchanged; no new persistence
- [ ] JSDoc/module-header updated to the new formats
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer with no prior knowledge needs: the three exact change sites
(with current formats), the new schema fields and their semantics, the series
bigram seeding path for tests, and the existing test harness. All below.

### Documentation & References

```yaml
- file: src/pi/debug.ts
  why: THE file. Three TODO(P1.M2.T3.S1) markers at exactly this task's
        sites: topSection :77-81, successorsSection :110-112, TSV dump
        :197-200. Module convention: one section = one builder function +
        one spread entry in formatAcwordsDump's join (:134-152). Pure
        formatter; store physically cannot leak message bodies.
  pattern: buildXSection helpers, GROUP_LABEL, TOP_N=50,
        SUCCESSOR_SAMPLE_N=10, single `ordinal` capture for the whole dump.
  gotcha: NEVER read `c.display` — removed in P1.M2.T1.S2; the interim
        resolved form is `c.capDisplay !== "" ? c.capDisplay : c.key`.

- file: src/core/types.ts (:25-40, :100-110)
  why: the new fields. Candidate: capCount (capitalized-tally sightings),
        lowerCount, capDisplay (most frequent capitalized form; "" when
        never capitalized — never fabricate one). Successor: series?:
        boolean (proper-noun series pair, ranks above ordinary), 
        nextDisplay?: string (run casing of the SECOND word of a series
        pair).

- file: src/core/store.ts (:360-400)
  why: how tallies accumulate on upsert (mid-cap seeds the capDisplay
        argmax; lowercase sightings zero capDisplay wholesale) — informs
        test fixture expectations (what combos are reachable).
        topSuccessors (:127-185 region) returns the LIVE array count-desc
        with series-first ordering (compareSuccessors :177-183) — map/join
        only, never mutate.

- file: test/debug.test.ts
  why: harness conventions — see() fixture (Sighting with casing field),
        fakeStats with distinct gate counts, statsStub, fakePi capturing
        registerCommand, real CandidateStore. Extend in place; do not
        restructure.

- file: test/store.test.ts / test/bigrams.test.ts (series fixtures)
  why: how series bigrams are seeded in tests (recordBigramRuns over
        capitalized runs; chain-only top-band members). Reuse the same
        seeding approach for the successor-sample test.

- spec: spec/08-configuration.md h2.58 (Debug command)
  why: binding contract — top-50 by salience, size, rank-group histogram,
        gate counts, successor sample, FULL store to /tmp/hapax-store.txt
        "one line per word (key, display, count, group, proper/typed
        flags)". The tally columns EXTEND the count column's spirit (the
        display-free schema's evidence); the listed fields all stay.

- docfile: plan/006_7bd0258da993/architecture/03-pi-surfaces-r2-r3-r4.md §"debug.ts /acwords surfaces"
  why: line anchors (popup ~:60-91, TSV :118-127→now ~:183-207, successor
        sample :195-210→now :88-113) + the note that the series-first rule
        may want the successor sample extended — this task is that
        extension.

- file: plan/006_7bd0258da993/P1M2T2S2/PRP.md
  why: PARALLEL task (widget series-first offers + typed-word arming) —
        touches src/pi/widget.ts only; zero overlap with debug.ts. Its
        chainShim casing rule (`s.series && s.nextDisplay ? s.nextDisplay :
        capDisplay-interim`) is the SAME display rule this task's successor
        sample should render — mirror it for consistency.
```

### Current Codebase tree (relevant)

```bash
src/pi/debug.ts        # formatAcwordsDump + registerAcwordsCommand — the change site
src/core/types.ts      # Candidate tallies + Successor.series/nextDisplay (read-only)
src/core/store.ts      # topSuccessors / upsert tally semantics (read-only)
test/debug.test.ts     # extend in place
```

### Desired Codebase tree

```bash
src/pi/debug.ts        # MODIFIED: 3 TODO sites + JSDoc/module header
test/debug.test.ts     # MODIFIED: tally, series-marker, TSV, guard tests
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: `Candidate.display` no longer exists (P1.M2.T1.S2) — reading it
// is a type error AND a spec violation. Interim resolved form only:
//   c.capDisplay !== "" ? c.capDisplay : c.key
// capDisplay is "" when a word was never seen capitalized (or was zeroed by
// a later lowercase sighting) — never fabricate a capitalized form.
// topSuccessors returns the LIVE array — map/join only, never mutate/sort.
// Series successors already rank first in topSuccessors output
// (compareSuccessors) — just RENDER the marker; do not re-order.
// nextDisplay is present only on series entries; ordinary successors have
// neither series nor nextDisplay (render plain next ×count).
// The /tmp write is inside try/catch — a failed write must never break the
// notify dump; keep that.
// Keep the single `ordinal` capture (one "now" for the whole dump) —
// per-row currentOrdinal() calls produce bogus orderings (existing comment).
// formatAcwordsDump must stay pure: no logging, no store mutation.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY topSection (src/pi/debug.ts:66-85)
  - Row: `${i+1}. ${display} ×${sessionCount} (cap ${capCount}/lower ${lowerCount}) group ${g} (${label})`
  - Remove the TODO comment; keep the salience-not-printed rationale comment.

Task 2: MODIFY successorsSection (:88-113)
  - Per successor: `(s.series && s.nextDisplay ? s.nextDisplay : s.next)` as
    the word, plus ` (series)` suffix when s.series. Plain form unchanged.
  - Update the builder's JSDoc: series marker + nextDisplay run casing.
  - Remove the TODO at :110.

Task 3: MODIFY the /tmp TSV row (registerAcwordsCommand handler :183-207)
  - Insert cap/lower columns after the count column:
    `key\tdisplay\tx<count>\tcap<capCount>\tlower<lowerCount>\tg<group>[...]`
  - Update the handler comment's column list; remove the TODO at :197.

Task 4: UPDATE module header JSDoc (:1-20) — describe the updated dump
  formats (Mode A doc ride-along).

Task 5: EXTEND test/debug.test.ts
  - tally columns in popup rows (exact substring);
  - series-marked successor row with nextDisplay, ordinary successor unmarked;
  - TSV column layout read back from /tmp/hapax-store.txt after the handler runs;
  - guard still: config.debug=false → register not called.

Task 6: VALIDATE — npm run check && npm test
```

### Implementation Patterns & Key Details

```typescript
// topSection row (illustrative):
`    ${i + 1}. ${c.capDisplay !== "" ? c.capDisplay : c.key}  ×${c.sessionCount}  (cap ${c.capCount}/lower ${c.lowerCount})  group ${c.rankGroup} (${GROUP_LABEL[c.rankGroup]})`

// successorsSection entry mapping (illustrative):
const succ = store
  .topSuccessors(c.key)
  .map((s) => {
    const word = s.series && s.nextDisplay ? s.nextDisplay : s.next;
    return `${word} ×${s.count}${s.series ? " (series)" : ""}`;
  })
  .join(", ");

// TSV row (illustrative):
`${c.key}\t${c.capDisplay !== "" ? c.capDisplay : c.key}\tx${c.sessionCount}\tcap${c.capCount}\tlower${c.lowerCount}\tg${c.rankGroup}` +
  `${c.properName ? "\tproper" : ""}${c.userTyped ? "\ttyped" : ""}`
```

### Integration Points

```yaml
REGISTRATION: unchanged — index.ts :367
  (`if (config.debug) registerAcwordsCommand(pi, {store, pipeline, config})`).
CONFIG: no new keys (debug:true already gates everything).
PERSISTENCE: none added — /tmp/hapax-store.txt is the pre-existing
  sanctioned debug exception.
DOWNSTREAM: P3.M1.T2.S3 live smoke asserts via /acwords output — stable,
  deterministic formats matter (same sorts/tie-breaks as today).
PARALLEL: P1.M2.T2.S2 touches src/pi/widget.ts only — no overlap.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — also catches any lingering .display read
```

### Level 2: Unit Tests

```bash
npx vitest --run test/debug.test.ts
npm test        # full suite green
```

### Level 3: Integration

```bash
# Manual smoke of the real dump (optional, quick):
# run pi with debug:true, type a message with a capitalized run, /acwords,
# inspect popup + /tmp/hapax-store.txt column layout. Live-verification
# binding (spec 09 h2.61) is P3.M1.T2.S3's gate, not this task's.
```

### Level 4: Domain-specific

`grep -n "TODO(P1.M2.T3.S1)" src/pi/debug.ts` → no hits;
`grep -n "\.display" src/pi/debug.ts` → no hits. Popup and TSV column
orders stable across all rows. Series marker only on series entries.

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green
- [ ] Three TODO markers retired; no `Candidate.display` reads
- [ ] Popup + TSV tally columns; series marker + nextDisplay in successor sample
- [ ] JSDoc/module header describe the new formats (Mode A)
- [ ] Guard, RAM-only invariant, try/catch TSV write, single-ordinal capture preserved
- [ ] No changes outside debug.ts + test/debug.test.ts

## Anti-Patterns to Avoid

- ❌ Don't read `c.display` (removed) or fabricate a capDisplay
- ❌ Don't mutate/re-sort topSuccessors output (live array; order is store-owned)
- ❌ Don't print salience (count + group is the tuning signal, by design)
- ❌ Don't add persistence beyond the existing /tmp exception
- ❌ Don't register when debug:false or change registration wiring
- ❌ Don't fork the display-resolution rule from P1.M2.T2.S2's chainShim form

## Confidence Score: 9/10

The three change sites are literally marked with TODOs for this task ID, the
schema fields and their semantics are pinned in types.ts/store.ts, the test
harness is in place, and the only open choice (exact column wording) is
cosmetic with a recommended form given.
