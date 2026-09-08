# PRP — plan 002 P1.M3.T1.S2: Re-point config gate reads to enableChaining; enableChaining-inertness suite

## Goal

**Feature Goal**: Finish PRD R5's config surface. After P1.M3.T1.S1 lands,
`HapaxConfig` carries BOTH `enableChaining` (primary) and `enablePhrases`
(transitional mirror, same resolved value) so pre-rename gate reads keep
compiling. This task (a) **deletes the transitional `enablePhrases` field**
from `HapaxConfig`, `DEFAULT_CONFIG`, and `applyLayer`, and (b) **re-points
every remaining gate read** to `config.enableChaining`:
- `src/pi/provider.ts:261` — `if (armed && config.enablePhrases)` in
  `getSuggestions` (armed-branch gate)
- `src/pi/provider.ts:~398` — `if (config.enablePhrases)` in
  `applyCompletion` (arming gate)
- `src/pi/index.ts:180–188` — `...(config.enablePhrases ? { onAdmittedTokens:
  ... } : {})` ingest wiring gate (successor capture off entirely when false)

It also (c) rewrites the **inertness test suite**: the old
`test/phrase-gating.test.ts` (5 cases) was deleted in P1.M1.T2.S1, and
`test/chain.test.ts` currently carries a transitional gate case reading
`enablePhrases` (its own comment says "the enableChaining rename is
P1.M3.T1.S1 — swap the key here"). After this task, NO source or test file
mentions `config.enablePhrases` (the string may survive only inside
`src/pi/config.ts`'s alias-handling block and config tests).

**Deliverable**:
1. Modified `src/pi/config.ts` — `enablePhrases` field/mirror/assignments
   removed (alias KEY handling in `applyLayer` stays — it feeds
   `enableChaining`).
2. Modified `src/pi/provider.ts` — both gates read `config.enableChaining`;
   comments updated (`enableChaining gate (P1.M3.T1.S2)`).
3. Modified `src/pi/index.ts` — wiring gate reads `config.enableChaining`;
   the "P1.M3.T1.S2 re-points this gate" comment replaced with the settled
   wording.
4. Test updates: `test/chain.test.ts` gate case keyed on `enableChaining`;
   NEW dedicated inertness file `test/chaining-gating.test.ts` (see Task 4).

**Success Definition**: `grep -rn "enablePhrases" src/` hits ONLY
`src/pi/config.ts` (alias-handling block + JSDoc). `npm run check` and
`npm test` green. With `enableChaining: false`: after full ingest the
successor index is empty (`store.topSuccessors(w) === []` for ingested
words), Tab-accepting a live word item never arms the machine, an
externally-armed machine never offers successors, and word completion
(threshold + trigger modes) behaves identically to the ungated case.

## Why

- PRD §08 h2.46: `enableChaining` gates "the successor-index chain layer
  only … Word completion is unaffected either way." The S1 PRP deliberately
  left a transitional mirror so gates kept compiling mid-milestone; this
  task is the contractually-named cleanup (S1 PRP: "S2 will delete
  `enablePhrases` from the interface, DEFAULT_CONFIG, and all gate reads").
- The old `phrase-gating.test.ts` inertness suite was removed with the
  phrase layer (P1.M1.T2.S1); the redesigned chain + force path
  (P1.M2.T1.S1 / P1.M2.T2.S2, landed) changed what "inert" must prove —
  zero-char armed offers and forced single-item completions now exist and
  must ALSO be gated.
- The final config surface is audited by P1.M4.T1.S2 and documented in
  P1.M4.T2.S1 — those tasks assume this re-point is complete.

## What

### Behavior contract

1. **config.ts**: remove `enablePhrases: boolean` from `HapaxConfig`, remove
   `enablePhrases: true` from `DEFAULT_CONFIG`, remove the mirror line
   `next.enablePhrases = next.enableChaining;` in `applyLayer`. The
   `"enablePhrases" in raw` alias block, its repair-notify, and the
   deprecation notify ALL stay (they write `next.enableChaining` — that is
   the documented deprecated-alias behavior, PRD h2.46).
2. **provider.ts getSuggestions** (≈L261): `if (armed && config.enableChaining)`
   — update the surrounding "enablePhrases gate" comments to name
   `enableChaining` / P1.M3.T1.S2.
3. **provider.ts applyCompletion** (≈L398): `if (config.enableChaining)` —
   same comment update. Delegation remains unconditional either way.
4. **index.ts** (≈L180): `...(config.enableChaining ? { onAdmittedTokens:
   (runs) => sessionStore.recordBigramRuns(runs) } : {})`. Update the
   comment block (the long P2-era explanation referencing
   `enablePhrases: false` and the "re-points this gate" TODO) to the settled
   form: chaining gate — successor capture off entirely when false; word
   completion unaffected.
5. **No README change** — the table row landed in S1; prose sweep is
   P1.M4.T2.S1 (Mode A docs ride there).

### Success Criteria

- [ ] `grep -rn "enablePhrases" src/` → only `src/pi/config.ts`
- [ ] `grep -rn "enablePhrases" test/` → only `test/config.test.ts` (alias
      resolution cases from S1)
- [ ] enableChaining:false → bigram map empty after ingest, no arming on
      Tab-accepts, no successor menu items ever, word completion identical
- [ ] `npm run check` && `npm test` green

## All Needed Context

### Documentation & References

```yaml
- docfile: plan/002_3e8a42cadf2c/P1M3T1S1/PRP.md
  why: CONTRACT for the config state this task starts from — HapaxConfig has
        BOTH fields (enableChasing primary + enablePhrases transitional
        mirror, "same resolved value every time"), applyLayer writes both,
        "S2 will delete enablePhrases from the interface, DEFAULT_CONFIG,
        and all gate reads. Do not do that here."
  section: "⚠️ Key Design Decision" + "What" §1

- file: src/pi/config.ts
  why: HapaxConfig interface (~L36–45 post-S1), DEFAULT_CONFIG, applyLayer
        alias block — remove the field/mirror, keep the alias KEY handling
  gotcha: the `raw.enablePhrases` read inside the alias block STAYS — only
          the config OBJECT's own field goes; also check S1's exact field
          spellings before deleting (mirror line is
          `next.enablePhrases = next.enableChaining;`)

- file: src/pi/provider.ts
  why: gate reads at ~L261 (`if (armed && config.enablePhrases)`) and ~L398
        (`if (config.enablePhrases)`) inside applyCompletion; both sit under
        large "enablePhrases gate (P2.M2.T3.S1)" comment blocks to rewrite
  gotcha: getSuggestions branch ORDER is a landed contract
        (abort → armed → force → normal, P1.M2.T2.S1) — only the boolean
        expression changes, never the ordering; note `options.force` may
        now exist in the forced path — armed gate still precedes force

- file: src/pi/index.ts
  why: ingest wiring gate at ~L180–188: spread conditional holding
        onAdmittedTokens → recordBigramRuns; the stale comment block
        above it (L174–179) explicitly hands the re-point to this task
  gotcha: when false, the spread yields {} — IngestPipeline must still
          construct (options are optional); successor index then builds
          nowhere (recordBigramRuns is the ONLY successor path, per
          src/core/store.ts L45–61)

- file: src/core/store.ts
  why: public successor read for inertness assertions —
        `topSuccessors(word): readonly Successor[]` (~L624, pure O(1),
        shared-empty-array when absent); there is NO bigram-map size
        accessor, so "bigram map empty" is asserted via topSuccessors on
        the fixture's words

- file: test/chain.test.ts
  why: the transitional gate case at ~L737 ("config gate inertness:
        enablePhrases:false never arms and never offers … swap the key
        here") to re-key; ALSO its makeNrelPipeline helper (~L598) takes an
        `enablePhrases` boolean param — rename to enableChaining; header
        comment (~L33) says "gate is enablePhrases until P1.M3.T1.S1" —
        update
  pattern: editingCurrent() harness, suggest()/opts() helpers,
        expectSingleWordItems, replayNrel via restoreFromHistory,
        NREL fixture at test/fixtures/sessions/nrel.jsonl

- file: test/config.test.ts
  why: S1 rewrote the boolean cases around enableChaining + alias; this task
        does NOT touch them (verify they only reference cfg.enableChaining
        as the resolved field; if any still reads cfg.enablePhrases post-S1,
        update those reads — mirror is gone)

- file: test/ingest-pipeline.test.ts, test/successors.test.ts, test/bigrams.test.ts
  why: patterns for constructing a REAL IngestPipeline with
        onAdmittedTokens wiring; confirm no other test constructs config
        objects with enablePhrases (grep first: the compile will catch any
        stragglers via the removed field)

- docfile: plan/002_3e8a42cadf2c/architecture/pi_layer_map.md
  why: §1 documents the exact gate-read sites and branch order (written
        pre-rename, still accurate on structure); §3 the index.ts wiring
  section: §1 "config.enablePhrases gating — all reads", §3

- file: src/pi/provider.ts (createHapaxProvider signature ~L180–185)
  why: provider takes `config: HapaxConfig` — no signature change needed;
        tests construct partials via a cfg() helper (see chain.test.ts L102)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: S1 lands the dual-field config IN PARALLEL — if its PRP has
// landed, delete the mirror; if it has NOT landed when you start, STOP:
// re-pointing reads before the primary key exists breaks tsc. Verify with
// `grep -n enableChaining src/pi/config.ts` FIRST (must hit the interface).
// CRITICAL: the alias KEY handling in applyLayer stays forever (PRD h2.46
// "enablePhrases is accepted as a deprecated alias") — only the output
// FIELD is removed. Deleting the raw-key block breaks existing user configs.
// CRITICAL: getSuggestions branch order (abort → armed → force-aware →
// normal) is a landed contract — change only the gate boolean.
// CRITICAL: relative imports need .js extensions (NodeNext).
// CRITICAL: `config` objects in tests are typed HapaxConfig — removing the
// field makes every `{ enablePhrases: ... }` literal a compile error;
// let `npm run check` enumerate them, fix each (expected: chain.test.ts,
// possibly provider-live.test.ts / provider-display.test.ts / index.test.ts).
// There is no bigram-count accessor — assert inertness via
// store.topSuccessors(word) on fixture words + chain.state() + menu shapes.
// enableChaining:false must NOT change delegation behavior: the armed
// branch simply never fires and applyCompletion skips arming, delegating
// verbatim — the provider must be byte-identical to M1 word-only behavior.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITION CHECK
  - RUN: grep -n "enableChaining" src/pi/config.ts
  - EXPECT: interface + DEFAULT_CONFIG hits (S1 landed). If absent, the
    mirror-field design has NOT landed — do not proceed past re-pointing.

Task 1: MODIFY src/pi/config.ts — remove the mirror field
  - REMOVE `enablePhrases: boolean` from HapaxConfig (keep enableChaining
    with its JSDoc; extend the JSDoc to note the deprecated alias KEY
    remains accepted)
  - REMOVE `enablePhrases: true` from DEFAULT_CONFIG
  - REMOVE the `next.enablePhrases = next.enableChaining;` mirror line in
    applyLayer
  - KEEP the `"enablePhrases" in raw` alias block, repair-notify, and
    deprecation notify (all write next.enableChaining)

Task 2: MODIFY src/pi/provider.ts — re-point both gates
  - L~261: `if (armed && config.enableChaining) {`
  - L~398: `if (config.enableChaining) {`
  - REWRITE the two "enablePhrases gate (P2.M2.T3.S1)" comment blocks to
    "enableChaining gate (P1.M3.T1.S2): the entire chain layer — armed
    branch and arming intercept — is inert under enableChaining:false;
    word completion untouched"

Task 3: MODIFY src/pi/index.ts — re-point the wiring gate
  - L~180: `...(config.enableChaining ? {`
  - REWRITE the comment block L~174–179 to the settled form: chaining gate;
    recordBigramRuns is the only successor path so the index is entirely
    absent when false; before_agent_start chain?.reset() stays harmless

Task 4: FIX COMPILE FALLOUT + re-key existing gate tests
  - RUN npm run check; fix every literal that set/read cfg.enablePhrases
  - test/chain.test.ts: re-key the L~737 inertness case to
    `cfg({ enableChaining: false })`, rename makeNrelPipeline's param,
    drop the "(swap the key here)" parenthetical and update the header
    comment L~33

Task 5: CREATE test/chaining-gating.test.ts — the inertness suite
  - HEADER doc-comment: enableChaining gates the successor-index chain
    layer ONLY (PRD §08 h2.46); word completion unaffected either way;
    successor of the deleted phrase-gating.test.ts (P1.M1.T2.S1)
  - REUSE patterns from test/chain.test.ts: cfg() helper (fresh config
    per call), editingCurrent() harness, suggest()/opts(), makePipeline
    with onAdmittedTokens → store.recordBigramRuns, NREL fixture
    (test/fixtures/sessions/nrel.jsonl) replayed via restoreFromHistory
    (copy replayNrel), createChainMachine, createHapaxProvider
  - CASES (all with enableChaining:false, real loadDictionary on the
    shipped dict via resolveDictPath()):
    1. bigram capture off: pipeline built WITHOUT onAdmittedTokens (mirror
       of index.ts false-branch) after replaying the fixture →
       store.topSuccessors("national") is [] (and a couple more fixture
       words) — successor index never built
    2. no arming on Tab-accept: menu for "natio" contains "National";
       provider.applyCompletion(...) → chain.state() === null
       (applyCompletion gate) and delegation still happens
       (current.applyCompletion called with identical args)
    3. externally-armed machine never offers: chain.arm("national");
       getSuggestions(["National "], 0, 9, opts()) → null +
       current.getSuggestions called once with unchanged args identity;
       chain.state() untouched (gate lives in the provider)
    4. force path gated too (P1.M2.T2 contract): chain.arm("national");
       getSuggestions(["National "], 0, 9, { ...opts(), force: true }) →
       still delegates (no forced single-item successor — the armed
       branch precedes force and is inert)
    5. word completion identical to ungated: SAME store WITH the bigram
       hook on (successors present), provider gated false vs true —
       suggest "natio" (threshold mode) and "#natio" (trigger mode)
       return identical word-item sets; typing 1 char below threshold
       delegates in both
    6. control arm (gated true): chain arms on word accept and the
       zero-char successor offer fires — minimal echo of chain.test.ts
       to prove the suite's harness actually exercises the layer it
       claims is inert
  - NAMING: describe("enableChaining inertness (PRD §08 h2.46 — successor
    chain layer only)"); file test/chaining-gating.test.ts

Task 6: VALIDATE
  - npm run check && npm test
  - grep -rn "enablePhrases" src/ → only src/pi/config.ts
```

### Implementation Patterns & Key Details

```ts
// Gate re-points — expression-level changes only:
// provider.ts getSuggestions (armed branch):
const armed = chain.state();
if (armed && config.enableChaining) { ... }   // was config.enablePhrases

// provider.ts applyCompletion:
if (config.enableChaining) {                  // was config.enablePhrases
  const key = liveKeyByValue.get(item.value);
  ...
}
// delegation below stays unconditional

// index.ts ingest wiring:
pipeline = new IngestPipeline({
  store: sessionStore,
  dictionary: lazyDict,
  // chaining gate (P1.M3.T1.S2): recordBigramRuns is the ONLY successor-
  // index path — false ⇒ no bigrams, no successors, chain can never arm
  // from real data; word completion unaffected (PRD §08 h2.46).
  ...(config.enableChaining
    ? { onAdmittedTokens: (runs) => sessionStore.recordBigramRuns(runs) }
    : {}),
});

// Inertness assertion for the bigram map (no size accessor exists):
expect(store.topSuccessors("national")).toEqual([]); // shared empty array
```

### Integration Points

```yaml
CODE (no routes/migrations — extension internal):
  - src/pi/config.ts: field removal only; alias KEY behavior frozen by S1
  - src/pi/provider.ts: two boolean expressions + comments
  - src/pi/index.ts: one spread condition + comment
DOWNSTREAM:
  - P1.M4.T1.S2 (config surface audit) expects zero enablePhrases reads
    outside config.ts alias handling
  - P1.M4.T2.S1 (README sweep) documents the final surface; no doc work here
UPSTREAM (contracts to honor, do not modify):
  - S1's alias resolution order, notify shapes, and test/ config cases
  - P1.M2.T2.S1's branch order: abort → armed → force → normal
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check
# Expected: zero errors — also the enumerator for stale enablePhrases
# literals (the removed field turns them into excess-property errors).
```

### Level 2: Unit Tests

```bash
npm test -- test/chaining-gating.test.ts test/chain.test.ts test/config.test.ts
# Expected: new inertness suite green; re-keyed chain gate case green;
# S1's config cases untouched and green.

npm test
# Expected: full suite green (provider suites construct configs via
# literals — fix any flagged by tsc in Task 4).
```

### Level 3: Integration verification (grep audits)

```bash
grep -rn "enablePhrases" src/
# Expected: hits ONLY in src/pi/config.ts (alias block + JSDoc)
grep -rn "enablePhrases" test/
# Expected: hits ONLY in test/config.test.ts (alias resolution cases)
```

### Level 4: Domain-specific

- Case 4 (force-path gating) is the adversarial case introduced by the
  redesigned chain — it pins that `force:true` can never resurrect the
  chain layer under `enableChaining:false`. No further tooling.

## Final Validation Checklist

### Technical Validation
- [ ] `npm run check` clean
- [ ] `npm test` fully green
- [ ] `grep -rn "enablePhrases" src/` → only src/pi/config.ts

### Feature Validation
- [ ] enableChaining:false → `store.topSuccessors(fixture words)` all `[]` after full ingest (no onAdmittedTokens wiring)
- [ ] Tab-accept of a live word item leaves `chain.state() === null`
- [ ] Externally-armed machine + force:true still delegates; state untouched
- [ ] Word completion (threshold + trigger modes) identical gated vs ungated
- [ ] All existing alias-resolution config cases from S1 unchanged
- [ ] Branch order in getSuggestions untouched (abort → armed → force → normal)

### Code Quality Validation
- [ ] No new patterns invented — gate edits are expression-level
- [ ] Comment blocks updated to name enableChaining / P1.M3.T1.S2
- [ ] No README/config-doc changes (owned by P1.M4.T2.S1)

## Anti-Patterns to Avoid

- ❌ Don't delete the `enablePhrases` alias KEY handling in applyLayer — only the output field goes; user configs depend on the alias
- ❌ Don't reorder getSuggestions branches while editing the gate
- ❌ Don't add a bigram-count accessor to CandidateStore just for tests — topSuccessors is the public read
- ❌ Don't start before verifying S1 landed (`grep enableChaining src/pi/config.ts`)
- ❌ Don't gate word completion, delegation, or the provider registration — only the chain layer
- ❌ Don't touch README prose (M4.T2.S1 owns the sweep)

---

**Confidence Score**: 9/10 — the gate sites are exhaustively enumerated
(three source reads, verified by grep), the S1 contract explicitly defines
this cleanup, and the test harness (editingCurrent, replayNrel, NREL
fixture, cfg()) already exists in chain.test.ts to copy. The only mild
uncertainty is unknown count of test literals referencing the removed field
— tsc enumerates them mechanically.