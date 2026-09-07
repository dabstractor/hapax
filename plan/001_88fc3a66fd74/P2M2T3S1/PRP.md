# PRP — P2.M2.T3.S1: Integration item 7 + enablePhrases gating + /acwords M2 dump

---

## Goal

**Feature Goal**: Complete the M2 acceptance surface (PRD §09 h2.54 DoD): (a) a
scripted end-to-end test proving PRD integration item 7 — accept `National` →
chain offers `Renewable` → Tab → `Energy` → Tab → `Laboratory` with ZERO
additional typed characters — plus evidence in `test/fixtures/sessions/RESULTS.md`;
(b) `enablePhrases: false` makes the entire phrase layer inert (no phrase items,
no constituent suppression, no successor capture/chaining) while word completion
is unchanged — asserted in tests; (c) `/acwords` dump extended with top-10
phrases + a successor-index sample; (d) the M1 never-hijack and performance
suites re-run green.

**Deliverable**:
1. `test/fixtures/sessions/nrel.jsonl` — NEW synthetic session fixture carrying
   the "National Renewable Energy Laboratory" vocabulary (verified absent from
   all existing fixtures — see research note).
2. Minimal provider amendment enabling the zero-typing post-accept chain offer
   (the "pending offer" — T2.S1's fragment≥1 contract alone cannot display a
   menu immediately after Tab; see Known Gotchas).
3. `enablePhrases` gating in `src/pi/provider.ts` (chain machine) and — if not
   already inherited from the `onAdmittedTokens` hook — successor capture in
   `src/pi/index.ts`; tests in `test/phrases.test.ts` or new
   `test/phrase-gating.test.ts`.
4. `src/pi/debug.ts` extended: `phrasesSection` builder appended to
   `formatAcwordsDump`; `AcwordsCommandDeps` + `test/debug.test.ts` extended.
5. `test/fixtures/sessions/RESULTS.md` — appended item-7 evidence section.
6. README.md Debug section updated for the extended `/acwords` output
   ([Mode A] rides WITH the work).

**Success Definition**: `npm test` fully green including a new scripted item-7
test that drives the REAL provider (store built from `nrel.jsonl` through the
real ingest pipeline + shipped dict) through
`accept("National") → menu top "Renewable" → accept → "Energy" → accept →
"Laboratory"` with no simulated typed characters between accepts;
`enablePhrases: false` run shows zero phrases/successors/chaining and identical
word completion; `npx vitest --run test/provider.test.ts test/perf-gates.test.ts`
green untouched; `/acwords` dump (unit-tested) contains the phrases section.

## User Persona

Internal acceptance/debug surface. Indirect user: the M2 completion user (PRD
§01 h2.6 goal 7) and the developer tuning phrase multipliers via `/acwords`
(PRD §09 h2.52 tuning protocol — the dump is the only observability).

## Why

- PRD §09 h2.54 (DoD M2) names integration item 7 explicitly as the final gate;
  P2.M2.T4 (README sync) is blocked on this evidence.
- PRD §08 h2.48: `/acwords` must show "(M2) top-10 phrases + successor index
  sample" — currently missing.
- `enablePhrases` exists in config but the phrase layer was built before the
  flag's enforcement was finished; PRD §08 h2.45 ("config surface deliberately
  tiny") requires the flag to actually disable the layer.

## What

### (a) Integration item 7 — zero-typing chained completion (scripted)

Fixture-driven end-to-end test in `test/acceptance.test.ts` (new describe
"acceptance item 7 — chained completion, zero typed characters (nrel.jsonl)"):

1. Load `test/fixtures/sessions/nrel.jsonl` via `test/helpers/session-fixture.ts`
   (`asSessionManager`), restore through the real `restoreFromHistory` with
   `enablePhrases: true` (defaults otherwise: trigger `#`, threshold 2).
   Fixture must admit `National` (and ideally `NREL`) as word candidates AND
   build successor counts `national→renewable`, `renewable→energy`,
   `energy→laboratory` with the successor chain strictly top-ranked.
2. Provider query for `Natio` (or trigger `#n`) → menu contains `National`.
3. `provider.applyCompletion(lines, r, c, nationalItem, prefix)` — arms
   `national` (T2.S1 arming intercept).
4. Immediately call `provider.getSuggestions` on the buffer state right after
   the insertion (cursor after `National` — NO typed characters, NOT even a
   space). Assert: menu offered, top item label `Renewable`.
5. `applyCompletion(renewableItem)` → assert re-armed to `renewable`; next
   `getSuggestions` top item `Energy`.
6. `applyCompletion(energyItem)` → top item `Laboratory`; accept; chain state
   = `laboratory` (or idle if no successors).
7. Assert the full insertion sequence `National Renewable Energy Laboratory`
   landed in the buffer and ZERO fragment characters were supplied between
   accepts (the test constructs the post-accept buffer positions directly).

This requires the **post-accept pending offer** amendment (Task 1): after
`applyCompletion` arms, the FIRST subsequent `getSuggestions` at a cursor
adjacent to the accepted insertion offers the unfiltered top successors even
with an empty/word-completing fragment. Details in Implementation Blueprint.

### (b) enablePhrases gating

With `enablePhrases: false` (everything else default), after ingesting the
same `nrel.jsonl` (plus any phrase-bearing text):

- `store.phraseEntries()` is empty (already true: capture gated in index.ts
  line ~147 — assert it stays true).
- `store.topSuccessors("national")` is empty / the empty constant — successor
  capture must be gated. If T1.S1 records successors inside
  `recordPhraseLines`/the `onAdmittedTokens` hook this is inherited; VERIFY and,
  if successors are recorded on a separate path, wrap it in the same
  `config.enablePhrases` ternary in `src/pi/index.ts`.
- `rankMatches` returns NO phrase items and performs NO constituent
  suppression (empty map ⇒ automatic; assert the suppressed-word case from
  `test/query.test.ts` phrase tests does NOT suppress under the flag).
- Provider chain machine never arms: `applyCompletion` of a word item leaves
  `chain.state() === null`; `getSuggestions` never takes the armed branch.
  Implement by guarding the arming intercept AND the armed branch with
  `config.enablePhrases` in `src/pi/provider.ts` (T2.S1 PRP explicitly
  deferred this guard to this task).
- Word completion still works: the `ze → Zendesk` acceptance query against
  `zendesk-lwlock.jsonl` re-asserted under `enablePhrases: false`.

### (c) /acwords M2 dump

Extend `formatAcwordsDump` with a phrases/successor section (pure builder, per
the module header's standing instruction):

```
hapax phrases
  phrases: 7   (cap 5120)   demoted: 2
  top 10 by salience:
    1. national renewable energy  ×3  (repeat)
    2. energy laboratory  ×3  (repeat)
    ...
  successor sample (top successors of the top word):
    national → renewable ×5, energy ×1
```

- Top-10 phrases ordered by phrase salience (reuse
  `src/core/query.ts`'s exported phraseSalience if exported; otherwise
  sessionCount desc then byte-lexicographic key — deterministic either way).
- Successor sample: `topSuccessors(topPhraseFirstWord)` rendered as
  `word → next ×count, …`; when the store has no phrases, print
  `  phrases: (none)` and omit the sample.
- Extend `AcwordsCommandDeps` with whatever the section reads (likely nothing
  new — store already exposes `phraseEntries()` / `topSuccessors()`).

### (d) M1 regression re-run

`test/provider.test.ts` (never-hijack a–g), `test/acceptance.test.ts` items
1–6, `test/perf-gates.test.ts` — all green with zero modifications to
existing test files (only appends to acceptance/debug suites allowed).
Perf note: phrases add ingest cost only; if a perf gate now trips at > budget,
investigate ingest path — do not relax budgets.

### Success Criteria

- [ ] Item-7 scripted test passes: National→Renewable→Energy→Laboratory with
      zero typed characters between accepts, driven through the real provider
      + real ingest + shipped dict.
- [ ] RESULTS.md contains an "Item 7" section with verdict table + evidence,
      and updated Hygiene/Reproduction lines.
- [ ] `enablePhrases: false`: zero phrases, zero successors, no suppression,
      no arming, word completion identical (all asserted by named tests).
- [ ] `/acwords` dump includes phrases + successor sample; debug.test.ts
      covers populated, empty, and phrases-disabled store snapshots.
- [ ] Full `npm test` green; `npm run check` clean; existing test files
      unmodified except appends to `test/acceptance.test.ts` (new describe) —
      `test/debug.test.ts` may gain new cases.

## All Needed Context

### Context Completeness Check

Passes "No Prior Knowledge": every file to touch is listed with line anchors;
the sibling contracts (topSuccessors, chain machine) are quoted or referenced
by PRP; the fixture format is documented via the tolerant loader contract; the
zero-typing gap and its fix are fully specified in the blueprint.

### Documentation & References

```yaml
- file: test/acceptance.test.ts
  why: THE pattern for scripted acceptance: real modules, shipped
        dict/common-en.bin, session-fixture loader, deterministic asserts.
        Items 1-6 are describe blocks; APPEND one describe for item 7. Read
        the item-1 helper setup (lines ~135-180) before writing.
  pattern: describe("acceptance item 7 …") + it() per check; reuse its
        makeStore/restore helpers exactly.
  gotcha: do NOT modify items 1-6 or their fixtures.

- file: test/fixtures/sessions/zendesk-lwlock.jsonl
  why: template for the new nrel.jsonl (JSONL: header line + message entries
        with type/message{role,content}; loader is tolerant of extra fields).

- file: test/helpers/session-fixture.ts
  why: loadFixture + asSessionManager used to feed restoreFromHistory.

- file: src/pi/provider.ts
  why: (1) enablePhrases guards on the armed branch + arming intercept
        (T2.S1 additions); (2) the post-accept pending-offer amendment below.
        Anchors: getSuggestions armed branch (added by T2.S1 after the
        aborted check, ~line 240+), applyCompletion arming intercept,
        lastLive/liveKeyByValue publication, HapaxProvider surface (pinned by
        provider.test.ts case (f) — do NOT change the member set).
  gotcha: chain marker keys are "\u0000chain:" + word; phrase keys contain a
        space; arming detection relies on liveKeyByValue lookups.

- file: src/pi/index.ts
  why: line ~142-155 enablePhrases ternary already gates phrase capture and
        demotion sweep; VERIFY successor recording (T1.S1) sits inside the
        gated path — if not, extend the ternary. before_agent_start reset at
        line ~213 must also be a no-op-safe call when phrases disabled.

- file: src/pi/debug.ts
  why: append phrasesSection via the small-helper pattern (module header
        instructs exactly this). formatAcwordsDump joins sections with ""
        separators; AcwordsCommandDeps is a structural Pick — extend only if
        the section needs more than store+stats.
  gotcha: dump is pure and must never read message bodies; keep
        determinism (one "now" ordinal for ordering, byte-lexicographic
        tiebreaks like topCandidates does).

- file: test/debug.test.ts
  why: existing dump tests with stub stores — add cases: populated phrases,
        empty store, and (if the section renders differently) disabled.

- file: test/fixtures/sessions/RESULTS.md
  why: the evidence ledger. APPEND "Item 7" with the same table format
        ([scripted]/[manual] verdicts) and refresh Hygiene/Reproduction.

- file: README.md
  why: Debug section documents /acwords output — extend with the phrases +
        successor sample lines (Mode A: rides with the work).

- file: test/phrases.test.ts
  why: newest phrase-test conventions (store seeding via
        recordPhraseLines + explicit ordinals) — reuse for gating tests or a
        new test/phrase-gating.test.ts following the same style.

- prp: plan/001_88fc3a66fd74/P2M2T1S1/PRP.md (topSuccessors contract),
       plan/001_88fc3a66fd74/P2M2T2S1/PRP.md (chain machine contract —
       arming intercept, armed branch, marker keys, display-layer flow).
- prd: §09 h2.54 (DoD M2 / item 7), §08 h2.48 (/acwords), §01 h2.6 goal 7,
       §09 h2.52 (tuning: the dump is the tuning signal).
```

### Current Codebase tree (relevant excerpt)

```bash
src/pi/
  provider.ts   # MODIFY: enablePhrases guards + pending-offer amendment
  index.ts      # MODIFY (only if successor capture isn't already gated)
  debug.ts      # MODIFY: phrasesSection + dump extension
test/
  acceptance.test.ts            # APPEND item-7 describe
  debug.test.ts                 # APPEND dump cases
  phrases.test.ts | phrase-gating.test.ts  # NEW/EXTEND gating tests
  provider.test.ts  perf-gates.test.ts     # MUST stay green untouched
  fixtures/sessions/
    nrel.jsonl    # NEW fixture
    RESULTS.md    # APPEND item-7 evidence
README.md         # MODIFY: Debug section
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL — the zero-typing gap: T2.S1's armed branch requires a trailing
// fragment (>= 1 char) and disarms on word-less input. Immediately after
// applyCompletion("National") the cursor sits at "...National" — the trailing
// fragment IS "national", which matches no successor of "national", so the
// branch disarms and item 7 fails. The pending-offer amendment (below) is
// REQUIRED; do not re-litigate T2.S1's other rules.

// GOTCHA: applyCompletion must keep delegating verbatim (provider.test.ts
// case (b)). Pending-offer state is a side-effect set alongside arming.

// GOTCHA: successor index and chain arming are lowercase; stored display may
// be cased ("National"). Compare with .toLowerCase(); insert display casing.

// GOTCHA: display debounce — the pending offer flows through the SAME
// createDisplayProvider 100ms debounce/hysteresis; publish lastLive exactly
// like the armed branch does (prefix = "" for the pending offer — check the
// display-layer classification: prefix "" matches an empty live prefix; if
// the classifier requires result.prefix === live.prefix, an empty prefix on
// both sides satisfies it).

// GOTCHA: fragment filtering during the pending offer: if the user DOES type
// after the accept, the armed branch filters successors by the fragment as
// spec'd in T2.S1 — the pending offer only bridges the empty/immediately-
// post-accept query.

// GOTCHA: do not gate word completion anywhere — enablePhrases:false only
// removes the phrase layer (PRD §08: flag disables phrases, not hapax).

// PATTERN: ESM imports use ".js" suffix; new section builder = new pure
// function in debug.ts + one spread in the join.
```

## Implementation Blueprint

### Data models and structure

No new core types. Chain machine gains internal pending state (provider.ts):

```ts
// Amendment to createChainMachine (T2.S1):
//   arm(word) additionally records pendingWord = word (one-shot).
//   New methods:
//     consumePending(): string | null   // returns + clears pendingWord
//   reset() clears pending too.
// Semantics: the FIRST getSuggestions after an arm may render the unfiltered
// successors of the armed word even without a typed fragment, provided the
// cursor is adjacent to the accepted insertion.
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/pi/provider.ts — pending-offer amendment (zero-typing)
  - EXTEND createChainMachine: pendingWord set by arm(); consumePending();
    reset() clears it.
  - ARMED BRANCH: before the fragment regex path, if chain has a pending
    word AND the text before the cursor ends with the accepted insertion
    (case-insensitive match of the armed word, optionally followed by
    whitespace — i.e. before.trimEnd().toLowerCase().endsWith(armed)), then:
      consumePending();
      const succ = store.topSuccessors(armed);   // unfiltered, ≤3
      if (succ.length) publish lastLive { matches: shim, prefix: "" } +
        liveKeyByValue markers; return { items, prefix: "" }.
    Else fall through to the existing fragment rules unchanged (typing
    filters; disqualifying input disarms — T2.S1 semantics preserved).
  - THRESHOLD: pending offer ignores config.threshold (like armed mode).
  - Keep provider surface (case (f)) and delegation behavior byte-identical.

Task 2: MODIFY src/pi/provider.ts — enablePhrases gating
  - GUARD the armed branch entry AND the applyCompletion arming intercept
    with config.enablePhrases (createHapaxProvider already receives config).
    With the flag false: no arming, no pending offer, chain stays idle —
    provider behaves exactly as M1 word-only.
  - Phrase items in the normal path need no gate (empty map ⇒ inert), but
    see Task 3 for capture-side verification.

Task 3: VERIFY/MODIFY src/pi/index.ts — successor capture gating
  - INSPECT how T1.S1 landed successor recording. If it rides
    onAdmittedTokens/recordPhraseLines (inside the existing
    config.enablePhrases ternary at ~line 147) it is already gated — add a
    comment citing this task. If separate, wrap it in the same ternary.

Task 4: CREATE test/fixtures/sessions/nrel.jsonl
  - ~8-12 message entries (user + assistant, text content) where the phrase
    "National Renewable Energy Laboratory" appears verbatim at least 3-4x
    (repeat admission for the 2/3-grams AND successor counts ≥3 so
    topSuccessors is deterministic top-1), plus "NREL" occurrences so the
    acronym admits as a rare word. Follow zendesk-lwlock.jsonl's JSONL shape.
  - Sanity: loading through the real pipeline must yield topSuccessors
    ("national") starting ["renewable"], etc. Assert this in the test itself.

Task 5: APPEND test/acceptance.test.ts — item-7 describe
  - Tests per the What §(a) list: fixture ingest + successor chain assert;
    "natio" query → National item; applyCompletion(National) → immediate
    getSuggestions (post-insert buffer, zero typed chars) top-1 "Renewable";
    chain through Energy → Laboratory; final buffer text assertion; chain
    re-arm at each step.
  - FOLLOW pattern: existing item-1 helpers; real shipped dict; defaults.

Task 6: CREATE/EXTEND phrase gating tests
  - Same nrel text + zendesk fixture under enablePhrases: false:
    phraseEntries() empty; topSuccessors() empty; rankMatches yields no
    phrase items and no constituent suppression; applyCompletion never arms
    (chain.state() null after accepting a word item); "ze" → Zendesk still
    works (word completion parity).

Task 7: MODIFY src/pi/debug.ts — phrases/successor section
  - ADD pure phrasesSection(store, ordinal) builder (format in What §(c));
    spread into formatAcwordsDump's join ("" separators).
  - APPEND cases to test/debug.test.ts: populated store (deterministic
    ordering), empty phrases, phrases-disabled (same as empty — capture
    never ran).

Task 8: APPEND test/fixtures/sessions/RESULTS.md + UPDATE README.md
  - RESULTS.md: "Item 7 — chained completion (nrel.jsonl)" verdict table
    ([scripted] rows citing test names), refresh Hygiene (new fixture file
    listed) and Reproduction commands.
  - README.md Debug section: document the new phrases + successor sample
    lines in the /acwords output.

Task 9: FULL REGRESSION
  - npm run check; npm test (full suite, incl. provider.test.ts and
    perf-gates.test.ts untouched and green).
```

### Implementation Patterns & Key Details

```ts
// Pending-offer sketch (armed branch head, provider.ts):
const st = chain.state();
if (st && config.enablePhrases) {
  const pending = chain.consumePending();
  const before = lines[cursorLine]?.slice(0, cursorCol) ?? "";
  if (pending && before.trimEnd().toLowerCase().endsWith(st.word)) {
    const succ = store.topSuccessors(st.word);
    if (succ.length) {
      // publish exactly like the T2.S1 armed path: shim RankedMatches,
      // liveKeyByValue markers "\u0000chain:" + next, lastLive.prefix = ""
      return { items: succ.map(toItem), prefix: "" };
    }
    // no successors → fall through to normal rules (chain may disarm later)
  }
  // ... existing fragment/filter/disarm logic from T2.S1, unchanged ...
}

// enablePhrases guard on arming (applyCompletion intercept):
if (config.enablePhrases) {
  const key = liveKeyByValue.get(item.value);
  if (key !== undefined) {
    if (key.startsWith("\u0000chain:")) chain.arm(key.slice(8));
    else if (!key.includes(" ")) chain.arm(item.value.toLowerCase());
  }
}
return current.applyCompletion(...); // verbatim, unchanged
```

### Integration Points

```yaml
NO schema/config changes (enablePhrases already in config.ts + README schema).
index.ts: only if successor capture landed outside the gated hook.
Downstream: P2.M2.T4 (README M2 sync) consumes the RESULTS.md evidence and
this README Debug-section update — keep wording factual and final.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check          # repo check script (tsc + lint) — must be clean
```

### Level 2: Unit / Acceptance Tests

```bash
npx vitest --run test/acceptance.test.ts       # items 1-6 green + item 7 new
npx vitest --run test/debug.test.ts
npx vitest --run test/phrases.test.ts test/phrase-gating.test.ts 2>/dev/null || npx vitest --run test/phrases.test.ts
npx vitest --run test/provider.test.ts test/provider-display.test.ts \
  test/provider-live.test.ts test/provider-match.test.ts
```

### Level 3: Full Regression + Perf

```bash
npm test               # full suite green (only pre-existing gc-skip allowed)
npx vitest --run test/perf-gates.test.ts   # phrases add ingest cost only
```

### Level 4: Manual smoke (optional, document as [manual] in RESULTS.md)

```bash
pi -e .   # live: discuss "National Renewable Energy Laboratory" a few
          # turns, then #n → accept National → observe chained menu with
          # zero typing. Record as PENDING [manual] if not performed.
```

## Final Validation Checklist

- [ ] Item 7 scripted test green: 4-word chain, zero typed characters
- [ ] nrel.jsonl fixture committed; successor chain deterministically top-1
- [ ] enablePhrases:false — no phrases, no successors, no suppression, no
      arming, word completion parity — all named tests green
- [ ] /acwords dump includes top-10 phrases + successor sample; empty and
      disabled snapshots render cleanly
- [ ] RESULTS.md item-7 section + hygiene/repro refreshed
- [ ] README Debug section updated
- [ ] provider.test.ts, perf-gates.test.ts, acceptance items 1–6 untouched
- [ ] npm run check clean; npm test fully green
- [ ] No new config keys; no core scoring/store constants changed

## Anti-Patterns to Avoid

- ❌ Don't weaken or delete T2.S1's disarm/filter rules — the pending offer is
  an additive bridge, not a rewrite
- ❌ Don't gate word completion on enablePhrases
- ❌ Don't modify existing tests to make them pass — fix the implementation
- ❌ Don't relax perf budgets if a gate trips; profile ingest instead
- ❌ Don't let /acwords read anything beyond store + stats (no message bodies)
- ❌ Don't write persistence files anywhere (in-memory only)