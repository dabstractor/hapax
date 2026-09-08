---
name: "P1.M2.T1.S2 (plan 002) — chain.test.ts rewrite + integration item 7 (zero additional typed chars)"
---

## Goal

**Feature Goal**: Rewrite `test/chain.test.ts` for the redesigned chain (P1.M2.T1.S1: zero-typed-char successor offers at EVERY armed word start, bare one-word values, threshold-0 filtering, same-keystroke disqualification) feeding bigrams exclusively through the real `store.recordBigramRuns` path, and make PRD §09 integration item 7 (`National → [space] → Renewable → Tab → Energy → Tab → Laboratory`, zero additional typed word-chars) the scripted, one-word-invariant-asserting evidence base for P1.M4.T1.S2's DoD audit.

**Deliverable**:
- Fully rewritten `test/chain.test.ts` (phrase-era names/comments/harness remnants gone; every h2.43 armed rule pinned against the S1 provider semantics)
- Rewritten/extended integration item 7 tests in `test/acceptance.test.ts` (zero-char offer route with the user's separating space; one-word invariant asserted on every chain item)

**Success Definition**: `npm run check` + `npm test` green; `grep -n recordPhraseLines\|consumePending\|pending test/chain.test.ts` empty; every chain item asserted single-word; the item-7 script literally performs National→space→top=Renewable→Tab→top=Energy→Tab→top=Laboratory with no word-chars typed between accepts.

## Why

- P1.M2.T1.S1 redesigns the chain but only minimally reconciles the old suite; this task replaces the stale one-shot/threshold-1-era tests with the PRD h2.43 semantics so regressions in the zero-char offer are caught.
- The phrase layer is gone (P1.M1.T2) — case (3) and the "phrase acceptance arms the chain" describe content are dead; remaining stale names/comments ("BUG-005 part 2", "#upsertPhrase", "threshold 1") mislead future maintainers.
- PRD h2.54 (M2 DoD) names integration item 7 with zero additional typed chars explicitly; P1.M4.T1.S2 audits against this suite.

## What

### test/chain.test.ts — full rewrite

Keep the existing harness skeleton (`makeCurrent`, `makeStack`, `suggest`, `armViaTab`, `put`, `cfg`, `opts`, `seedStore`, `seedAlphaSuccessors` — verified present and reusable) and rewrite the header comment + case bodies:

- **Header**: describe scope as the S1 redesign — armed(W) word-start zero-char offer (bare values, prefix "", description "chain"), threshold-0 fragment filtering, same-keystroke disarm rules, one-keypress Tab transitions, reset on before_agent_start, verbatim applyCompletion delegation (pinned by provider.test.ts, untouched).
- **Seeding**: bigrams ONLY via `store.recordBigramRuns` (already the case — lines 129/142–143/345/439). NO `recordPhraseLines` (verify: none exists), no phrase symbols.
- **Case list** (renumber cleanly; ≈16 cases):
  1. starts idle — `state()` null, first query takes the normal path.
  2. Tab-accept of a live hapax word item arms (`armViaTab` helper unchanged).
  3. accepting an item absent from the live map (path completion) never arms.
  4. **zero-char offer after separator**: armed "alpha" + buffer `["alpha "]` (trailing space) → `{items: [beta, bravo, ...], prefix: ""}`, values BARE (no leading space), count-desc order, chain still armed. Also line-start variant: `["alpha", ""]` line 1 col 0 (cursor at empty line) → same offer.
  5. **zero-char offer at EVERY armed word start** — after arming again (accept "beta" via case-9 mechanics), the second word-start also offers with zero typed chars (not just the first post-arm query).
  6. typed-char filtering from the UNFILTERED list at threshold 0: armed "alpha" + `"alpha b"` (1-char fragment!) DOES offer (old suite called this "threshold 1" — wrong now: threshold is 0 for the whole chain); `"alpha z"` (no match) → disarm + normal candidates on the SAME call.
  7. further typing filters live (`"alpha be"` → only beta).
  8. zero matching successors → disarm + normal path same call (case 6 variant, keep separate).
  9. armed word with empty successor index → disarm + normal path.
  10. word-less non-start buffer (punctuation, e.g. `"beta!"`) → disarm + delegate with byte-identical args/options identity. (Old case 8 sub-case 1 "trailing space disarms" was superseded by S1 — it is now case 4's offer.)
  11. Tab-accept of a successor: (a) arms to it (`state() === {word: "beta"}`), (b) delegates verbatim (`current.applyCompletion` called with the 5 original args; returned value passed through), (c) **inserts exactly ONE word** — via `editingCurrent()`-style faithful buffer, `"alpha "` + accept beta → `"alpha beta"`, single space, cursor after "beta".
  12. reset() forces idle — the before_agent_start rule; normal config.threshold resumes.
  13. trigger-mode acceptance arms too (whole-word insertion).
  14. armed sets flow through display-layer classification + 100ms debounce (existing case 12 mechanics, fake timers, re-pointed at the word-start offer's `prefix: ""` lastLive shape).
  15. **one-word invariant**: for the case-4 offer and case-11 live sets, assert every `item.value` contains no space (helper takes RankedMatch — see Gotchas; assert directly on AutocompleteItem here).
  16. replayed-store bare-word arming end-to-end (rename the old "BUG-005 part 2" describe/case at ~499–500: real ingest pipeline, `National` in menu, accept → armed, then word-start offer yields renewable) — keep `enablePhrases:false never arms` only if the config gate still exists (it does until P1.M3.T1.S1 — keep as an `enableChaining`-forward-compatible inertness check via `cfg({enablePhrases:false})`).
- Purge ALL phrase-era comments/names: header lines re "#upsertPhrase", `makeNrelPipeline` JSDoc "exists ONLY under enablePhrases" (in acceptance.test.ts — update there too), "BUG-005", "threshold 1" phrasing, `(P2.M2.T2.S1, ...)` datestamp → cite PRD §07 h2.43 + plan-002 S1 redesign.

### test/acceptance.test.ts — item 7 rewrite

- **Keep** the fixture-sanity test (successor chain national→renewable×4/wind×1, renewable→energy×4, energy→laboratory×4; store admissions; "natio"/"na" menu probes) — extend with `assertWordsOnly(rankMatches(...))` from `test/helpers/query-invariants.ts`.
- **Rewrite** the "zero-typing chain" test (currently references the retired PENDING OFFER): buffer "natio" → menu contains "National" → `provider.applyCompletion(["natio"], 0, 5, nationalItem, "natio")` arms + buffer becomes "National" (cursor 8) → **simulate the user's separating space** (advance the harness buffer to `"National "` — zero WORD-chars typed) → `provider.getSuggestions(["National "], 0, 9, opts())` → top item IS "renewable"-displayed successor (casing per store: assert display), `prefix: ""` → applyCompletion inserts ONE word → `"National Renewable"`... wait, insertion uses display casing: assert `["National renewable"]` or whatever the store's display holds — assert `state.lines[0]` equals the two display words joined by single spaces, chain re-armed to "renewable" → repeat space → top "energy" → Tab → space → top "laboratory" → Tab. Assert every offered item's value is a single word (no space) at each stage. Use the existing `editingCurrent()` harness (pi-tui-faithful applyCompletion on persistent buffer state) extended with a `typeSpace()` step.
- Fix `makeNrelPipeline` JSDoc/phrase-gating comment (recordBigramRuns is the only bigram path now).

### Success Criteria

- [ ] Item-7 script: National → separator → Renewable top → Tab → Energy → Tab → Laboratory, zero typed word-chars, all one-word items
- [ ] Zero-char offer at every armed word start (case 5), not just first post-arm
- [ ] 1-char fragment offers (threshold 0), no-match/punct/no-successors disarm same call
- [ ] `recordPhraseLines`/`consumePending`/phrase-case references absent
- [ ] `npm run check` + `npm test` green; provider.test.ts untouched and green

## All Needed Context

### Context Completeness Check

An implementer needs: the S1 provider contract (quoted below), the current test files' helpers (verified names/lines), the pi-tui insertion semantics, the nrel fixture shape, and the one-word invariant helper contract. All below.

### Documentation & References

```yaml
- file: plan/002_3e8a42cadf2c/P1M2T1S1/PRP.md
  why: THE upstream contract. Armed branch (a)/(b)/(c) logic, bare-value publish
        pattern (items/lastLive/liveKeyByValue/CHAIN_KEY_PREFIX), slim ChainMachine,
        applyCompletion arming branches, scope fences. Assume delivered exactly.
  critical: lastLive.prefix MUST equal returned prefix ("") or display classifier breaks.

- file: test/chain.test.ts
  why: The file being rewritten. Helpers at: makeCurrent ~103, put ~76, cfg ~89,
        opts ~95, seedStore ~128, seedAlphaSuccessors ~141, makeStack ~149,
        suggest ~158, armViaTab ~171. Cases 190–500; replayed-store describe ~499.
  gotcha: case (3) and the phrase describe are ALREADY gone; recordPhraseLines
        already replaced by recordBigramRuns — the item description's line numbers
        are stale; verify with grep, don't hunt for dead code.

- file: test/acceptance.test.ts
  why: Item 7 lives here (~546–end): makeNrelPipeline ~431, replayNrel ~590s,
        editingCurrent ~610s, sanity it ~638, zero-typing it ~645+.
  gotcha: the zero-typing test's final act references the retired PENDING OFFER —
        rewrite to the word-start offer; editingCurrent starts at "natio" and must
        gain a typeSpace() step.

- file: test/helpers/query-invariants.ts
  why: assertWordsOnly(matches: RankedMatch[], label?) — the one-word invariant
        helper (P1.M1.T2.S2). Use on rankMatches outputs (item-7 sanity test).
  gotcha: it types RankedMatch — chain AutocompleteItems need a direct inline
        assertion (item.value not containing " "), not this helper.

- file: src/core/store.ts
  why: recordBigramRuns(runs: readonly string[][]) + topSuccessors(word):
        Array<{next,count}> frozen-shared-empty on miss; bigramSize accessor.

- file: test/fixtures/sessions/nrel.jsonl
  why: The item-7 fixture (parseSessionFixture from test/helpers/session-fixture.ts).

- docfile: plan/002_3e8a42cadf2c/architecture/tests_docs_inventory.md
  section: "chain.test.ts (16 — REWRITE)" + "acceptance suites"
  why: The inventory this item was scoped from; stale on recordPhraseLines (see gotcha).

- docfile: plan/002_3e8a42cadf2c/architecture/external_deps.md
  section: §2a zero-prefix insertion semantics
  why: prefix "" splices item.value VERBATIM — bare values, single space separation
        comes from the user's typed space; applyCompletion adds NO trailing space.

- file: src/pi/provider.ts
  why: The S1-redesigned implementation under test: armed branch, CHAIN_KEY_PREFIX,
        lastLive/liveKeyByValue, createChainMachine {state, arm, reset}.

- file: test/provider.test.ts
  why: MUST stay green and untouched (pins verbatim delegation + never-hijack a–g).
```

### Current Codebase tree (relevant)

```bash
test/chain.test.ts        # REWRITE (full)
test/acceptance.test.ts   # MODIFY: item 7 zero-typing test + makeNrelPipeline comments
test/helpers/query-invariants.ts  # reuse (assertWordsOnly)
test/provider.test.ts     # DO NOT TOUCH
src/pi/provider.ts        # read-only here (S1's deliverable)
```

### Desired Codebase tree

```bash
test/chain.test.ts        # REWRITTEN: 16-case S1-semantics suite, phrase-free
test/acceptance.test.ts   # item 7: sanity (extended w/ assertWordsOnly) + zero-char route
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: zero-char offer fires ONLY when before === "" or /[ \t]$/.test(before).
// "alpha" + cursor 5 (adjacent, no separator) is NOT a word start → fragment branch
// → frag undefined → disarm. Don't accidentally test the offer at an adjacent cursor.

// GOTCHA: the user's separating space is part of the scenario but NOT typed by
// the provider — simulate it in the harness (buffer += " ", cursorCol++) and
// assert "zero WORD-chars" (the space is the boundary, not a word char).

// GOTCHA: display casing — insertion uses store display casing; nrel.jsonl stores
// e.g. "renewable" vs "Renewable" per sightings. Assert against store.get(key).display
// rather than hardcoding, or pin the fixture's actual casing in one place.

// GOTCHA: old case numbers are a guide, not a contract — S1 already flipped case
// (8) sub-case 1. Renumber the rewritten suite cleanly; keep every preserved
// SEMANTIC (delegation identity, same-call disarm, re-arm + verbatim delegation).

// GOTCHA: armed sets go through lastLive with CHAIN_KEY_PREFIX keys; applyCompletion
// re-arms by slicing the prefix — construct accepted items with the exact live
// values (bare s.next), never re-wrapped with spaces.

// GOTCHA: case 14's debounce test needs vi.useFakeTimers like provider-display.test.ts;
// the display classifier keys on result.prefix === live.prefix — with prefix "" the
// classifier must still classify as hapax (S1 keeps this shape; pin it).

// GOTCHA: enablePhrases still gates chaining (rename is P1.M3.T1.S1). Gate-inertness
// case: cfg({enablePhrases:false}) → armed state never offers chain items (arm can
// still happen via applyCompletion? NO — S1 keeps the gate around arming side-effects;
// assert: no chain offers, normal path only).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: REWRITE test/chain.test.ts
  - PURGE: phrase-era header prose, "BUG-005"/"#upsertPhrase"/"threshold 1"/
    "P2.M2.T2.S1" references; verify zero recordPhraseLines/consumePending
  - KEEP: helper skeleton (makeCurrent/makeStack/suggest/armViaTab/put/cfg/opts/
    seedStore/seedAlphaSuccessors) — adjust seedStore/seed comments to recordBigramRuns
  - WRITE: the 16 cases enumerated in "What" (zero-char offer x2 variants, threshold-0
    1-char fragment, filters, same-call disarms, one-word insertion via faithful
    buffer, reset, trigger-mode, display composition, one-word invariant, replayed
    bare-word arming end-to-end + gate inertness)
  - EACH disqualification case asserts BOTH chain.state() === null AND the
    fall-through result (normal candidates or delegation with arg identity)

Task 2: EXTEND/REWRITE acceptance.test.ts item 7
  - KEEP + extend sanity test with assertWordsOnly over "natio"/"na" rankMatches
  - REWRITE zero-typing test: editingCurrent + typeSpace(); National → space →
    top successor (assert display, prefix "") → applyCompletion → buffer grows by
    exactly one word, chain armed to it → space → energy → Tab → space → laboratory
  - Assert at every stage: every item.value single-word; prefix "" at word starts
  - FIX makeNrelPipeline JSDoc (bigram path = recordBigramRuns via
    onAdmittedTokens, not phrase upserts)

Task 3: VALIDATE
  - npm run check && npm test
  - npx vitest --run test/chain.test.ts test/acceptance.test.ts -v
  - grep -n 'recordPhraseLines\|consumePending' test/ -r   # empty
  - confirm test/provider.test.ts, provider-display.test.ts untouched & green
```

### Implementation pattern

Zero-char offer assertion core (mirror in cases 4/5/16 and item 7):

```typescript
const res = await suggest(inner, ["alpha "], 0, 6);   // separator typed by user
expect(res?.prefix).toBe("");
expect(res?.items.map((i) => i.value)).toEqual(["beta", "bravo"]); // bare, count-desc
for (const i of res!.items) expect(i.value).not.toContain(" ");    // one-word invariant
expect(chain.state()).toEqual({ word: "alpha" });     // still armed (offer ≠ disarm)
```

Same-call disarm (cases 6/8/9/10):

```typescript
const res = await suggest(inner, ["alpha z"], 0, 7);  // no matching successor
expect(chain.state()).toBeNull();                       // disarmed THIS call
const delegation = await inner.getSuggestions(["alpha z"], 0, 7, options);
// assert the fall-through equals the normal-path/delegation result — reuse the
// existing arg/options identity assertions from old cases 6–8
```

### Integration Points

```yaml
NONE new:
  - Output is the evidence base for P1.M4.T1.S2's M2 DoD audit (item 7, zero
    additional typed chars, one-word invariant, window-break rules from
    P1.M1.T3.S2's ingest break-case suite — already covered there).
  - P1.M2.T2.S1 (forced single-item Tab branch) will EXTEND this suite later —
    keep helpers exported/reusable and case names descriptive.
  - P1.M3.T1.S1 renames the config gate; the gate-inertness case here should be
    written so swapping the key name is a one-line change.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check                              # tsc --noEmit — zero errors
grep -rn 'recordPhraseLines\|consumePending' test/ src/   # expect nothing
```

### Level 2: Unit / Acceptance Tests

```bash
npx vitest --run test/chain.test.ts -v
npx vitest --run test/acceptance.test.ts -v
npm test                                    # full suite green (esp. provider*.test.ts)
```

### Level 3: Behavioral audit (read the run, don't just see green)

- Item-7 trace shows: 3 accepts, 2-3 spaces, ZERO word-char fragments between accepts
- Every chain menu top item matches `store.topSuccessors(armed)[0]`
- No test asserts multi-word values or leading-space values anywhere

### Level 4: DoD evidence capture (for P1.M4.T1.S2)

- Record the passing item-7 output (test names + counts) — that task audits against it.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` full suite green
- [ ] No phrase-layer symbols/comments in chain.test.ts; provider.test.ts untouched

### Feature Validation

- [ ] Zero-char offer at EVERY armed word start; threshold-0 filtering; same-keystroke disarms
- [ ] Tab inserts exactly ONE word; re-arm + verbatim delegation pinned
- [ ] Trigger-mode acceptance arms; reset on before_agent_start pinned
- [ ] Word-less non-start buffer keeps disarm+delegate (preserved case-8 semantics)
- [ ] Item 7 end-to-end: National → separator → Renewable top → Tab → Energy → Tab → Laboratory, all single-word items

### Code Quality Validation

- [ ] Case names carry PRD h2.43/h2.54 citations; helpers documented
- [ ] No hardcoded casing assumptions where the store owns display casing
- [ ] One-word invariant asserted in-suite AND via assertWordsOnly on rankMatches outputs

## Anti-Patterns to Avoid

- ❌ Don't seed bigrams via any store seam other than `recordBigramRuns` (or real ingest in replay cases)
- ❌ Don't test the zero-char offer at an adjacent cursor (no separator) — that's the disarm path
- ❌ Don't regress delegation-identity assertions to survive the rewrite — they are acceptance-critical
- ❌ Don't write leading-space or multi-word expected values anywhere
- ❌ Don't touch src/ files to make tests pass — if the provider contradicts the S1 contract, STOP and report the drift (src changes are S1's scope)

**Confidence Score: 9/10** — the S1 contract is exact, the current test files and helpers are line-verified, and the only stale inputs (recordPhraseLines line numbers, already-dead phrase cases) are identified as such with grep verification instructions.