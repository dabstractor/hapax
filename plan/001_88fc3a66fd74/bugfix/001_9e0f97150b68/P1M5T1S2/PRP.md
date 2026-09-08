# PRP — P1.M5.T1.S2: Ingest-path adversarial probes: realistic secrets, bad-dict restore, demotion cadence

## Goal

**Feature Goal**: Create a permanent adversarial e2e regression gate
(`test/adversarial-ingest.test.ts`) that runs the three INGEST-PATH probes
from the original bug hunt against REAL modules (`IngestPipeline`,
`CandidateStore`, `rankMatches`, shipped `dict/common-en.bin`, real
`createLazyDictionary`) — mocking ONLY the session manager (fakeSm-style
helper, same as `test/acceptance.test.ts`). Each probe pins a PRD contract
the scripted acceptance suite masked:

1. **Realistic secrets (BUG-003, PRD §h2.2/h3.2)** — `processText` the
   PRD's exact repro text (`aws secret: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
   + the `xoxb-…` line) plus a dotted JWT and an `sk-proj-…` key, then
   assert `rankMatches` for `'wjal'`, `'abc'`, `'dozjg'` and the sk-proj
   payload prefix returns NO key fragments. (Acceptance item 5 passed with
   fake keys: `FAKE_SK` pure-hex ≥20 and `FAKE_GHP` prefix-token — shapes
   that never leak; realistic formats did.)
2. **Bad-dict restore (BUG-004, PRD §03 disable-don't-degrade)** —
   `createLazyDictionary('/nonexistent/...')` + `restoreFromHistory` over a
   fake session manager with prose messages; after `settle()`
   (setTimeout ~420ms, `test/index.test.ts:180` convention):
   `store.size === 0`, notify (`onLoadError` spy) fired EXACTLY once, and
   a subsequent LIVE `onMessageEnd` is a total no-op (the sticky disable
   covers the live path, not just restore).
3. **Demotion cadence (BUG-006, PRD §h2.3/h3.5)** — admit a fast-path
   all-rare phrase, then 45 restore-style direct `processText` calls, then
   `pipeline.sweepPhrases()` (the restore-tail sweep from P1.M3.T2.S1);
   assert the phrase candidacy is removed (demoted) and the bare first
   word is again offered by `rankMatches` (constituent-suppression
   consequences cleared).

**Deliverable**: One new test file `test/adversarial-ingest.test.ts`,
picked up by the default `vitest --run` glob, with a Mode-A header comment
mapping each probe to its PRD bug. No product surface change.

**Success Definition**: `npm run check` + `npm test` fully green; each
probe is a deterministic gate that would have FAILED against the pre-fix
tree (before P1.M2, P1.M3 fixes) and passes now. Sibling
P1.M5.T1.S1 (`test/adversarial-typing.test.ts`) is landing in parallel —
do NOT duplicate its typing-path probes; this file owns the ingest path.

## User Persona

**Target User**: hapax maintainers + CI. Test-only work item.
**Use Case**: every PR runs `npm test`; these gates guarantee the
secret-masking, disable-on-bad-dict, and restore-tail-demotion contracts
can never silently regress even if unit suites stay green.
**Pain Points Addressed**: acceptance probes historically used fake key
shapes (`FAKE_SK` pure-hex, `FAKE_GHP` prefix-token) and a nonexistent-path
dict probe that never asserted store-emptiness or the live no-op — so the
six bugs shipped behind a 523-green suite.

## Why

- PRD §h2.0: the bug hunt found 6 issues the shipped suite missed; fixes
  landed across P1.M1–P1.M4. P1.M5.T1 is the regression backstop, split
  into typing-path (S1, parallel) and ingest-path (this item) probes.
- These probes reuse the EXACT adversarial input shapes that found the
  bugs (realistic multi-segment keys, real lazy-dictionary failure on a
  nonexistent path, 45-ordinal demotion cadence).

## What

Three `describe` blocks in `test/adversarial-ingest.test.ts`:

- **Probe A (secrets)**: real `IngestPipeline` + shipped dict + real store
  (harness copied from `test/mask-secrets.test.ts` pipeline block, which
  already runs the real modules — but that file tests layers in
  isolation; THIS probe is the end-to-end repro: PRD's exact sentences,
  and the exact probe fragments `wjal`/`abc`/`dozjg` named in the work
  item). Include a POSITIVE CONTROL (a normal rare word from the same
  messages DOES admit) so no-leak assertions cannot pass vacuously.
- **Probe B (bad-dict restore)**: real `createLazyDictionary` on
  `/nonexistent/common-en.bin` (exact idiom from
  `test/bad-dict-gate.test.ts:20`), real `IngestPipeline` wired with
  `isDisabled: () => dict.failed === true` (CLOSURE — the flag flips
  DURING replay), `restoreFromHistory(pipeline, fakeSm)` where `fakeSm`
  is a minimal `RestoreSessionManager` fake returning 2–3 prose messages
  (`getBranch()` returns `[]` so the `getEntries()` path is used — copy
  the fake-shape from `test/ingest-restore.test.ts`). After `settle()`:
  `store.size === 0`, `onLoadError` spy `toHaveBeenCalledOnce()`, and a
  follow-up LIVE `pipeline.processText("with more prose", true)` still
  stores nothing.
- **Probe C (demotion cadence)**: real pipeline + shipped dict; ingest
  text containing an all-rare fast-path bigram phrase (e.g. two absent
  rare words repeated so the phrase admits at first sight — see
  `src/core/store.ts:797-830` `sweepPhraseDemotions` doc and
  `test/phrases.test.ts` for the admission contract). Then 45 ×
  `await pipeline.processText("filler prose ordinal text", true)` —
  restore-style DIRECT calls bypass `#drainQueue`, which is exactly the
  BUG-006 condition. Then `pipeline.sweepPhrases()`. Assert: phrase
  candidacy removed (`rankMatches` no longer returns the phrase item for
  the phrase prefix) and the bare first word IS returned by `rankMatches`
  (suppression lifted — if it was suppressed pre-sweep, pin that it was
  suppressed BEFORE and offered AFTER, so the sweep's effect is explicit).

### Success Criteria

- [ ] `test/adversarial-ingest.test.ts` exists with Mode-A header mapping
      probes → BUG-003/BUG-004/BUG-006 + PRD §h2.2/h3.2, §03, §h2.3/h3.5
- [ ] Probe A: zero key fragments from realistic AWS/Slack/JWT/sk-proj
      shapes; positive control admits
- [ ] Probe B: bad-dict restore stores nothing, notifies once, live
      no-op after failure
- [ ] Probe C: 45-ordinal cadence demotes the fast-path phrase via the
      restore-tail sweep; first-word suppression cleared
- [ ] Only the session manager is a fake; everything else real
- [ ] `npm run check && npm test` green

## All Needed Context

### Context Completeness Check

The implementer gets: exact probe keys (validated against gitleaks
patterns in `test/mask-secrets.test.ts:33-40`), the exact bad-dict
idiom + assertion set, the restoreFromHistory contract doc
(`src/pi/ingest.ts:440-475`), the sweepPhraseDemotions cadence contract
(`src/core/store.ts:797-830`), the fake session-manager shape, and the
settle() convention. No prior knowledge beyond these files needed.

### Documentation & References

```yaml
- file: test/mask-secrets.test.ts
  why: THE layer-1/2 secret harness. Probe keys at L33-40 (AWS_SECRET,
        SLACK, JWT, OPENAI sk-proj, AWS_ID, GOOGLE) are already validated
        against the gitleaks-derived rules — reuse these constants (copy
        into the new file; test files are self-contained) and the
        pipeline-block harness (real IngestPipeline + shipped dict via
        resolveDictPath + real store/rankMatches, no-op yieldFn).
  pattern: await pipeline.processText(`... ${KEY} ...`, true) then
    rankMatches(store, fragment) === [].
  gotcha: shipped-dict facts in its header: "secret" q=108 (rejected as
    too common at admission), "slack" q=51 (admits) — pick the positive
    control word accordingly (use an absent rare word like 'zephyr').

- file: test/bad-dict-gate.test.ts
  why: BUG-004 unit seam tests (failed probe, disable gate) + the exact
        MISSING_DICT idiom and notify-once spy assertions. Probe B is the
        E2E twin: same primitives through restoreFromHistory + a fake
        session manager + settle(), plus the LIVE-no-op assertion that
        this file does not make.
  pattern: createLazyDictionary(MISSING_DICT, onLoadError); new
    IngestPipeline({ store, dictionary: dict, isDisabled: () =>
    dict.failed === true, yieldFn: async () => {} });

- file: src/pi/ingest.ts (L440-475 restoreFromHistory + its full doc comment)
  why: CONTRACT for Probe B/C: shouldAbort semantics, tail-sweep
        ("exactly one sweepPhrases() runs after a normally-completing
        replay; an ABORTED replay skips it"), closure-over-flag rule.
  pattern: restoreFromHistory(pipeline, sm) — pipeline passed whole here
    (not the acceptance.test.ts Pick with sweepPhrases no-op'd).

- file: src/core/store.ts (L797-830 sweepPhraseDemotions doc)
  why: CONTRACT for Probe C: demote when entry count < 2, not sticky,
        currentOrdinal − firstSeenOrdinal ≥ 40 ("firstSeen 1, now 41 →
        demoted; now 40 → still on probation"). 45 filler processText
        calls = 45 ordinals, comfortably past the boundary; a
        second sweep is a no-op.

- file: test/phrases.test.ts + test/phrase-gating.test.ts
  why: how a fast-path all-rare phrase candidate is created through the
        real pipeline (admission at first sight when both words are
        rare/absent from the dict) and how demotion is asserted at the
        store level. Copy the phrase-admission fixture shape.

- file: test/ingest-restore.test.ts (L1-60 + fakes)
  why: minimal valid pi message constructors (userMsg/assistantMsg) and
        the fake RestoreSessionManager shape for fakeSm (getBranch → []
        so getEntries fallback is exercised).

- file: test/index.test.ts (L180)
  why: settle() convention: `new Promise(r => setTimeout(r, 420))` —
        waits out the debounce + drain for the live-no-op assertion.

- file: src/core/query.ts (rankMatches)
  why: assertion API; item.value carries display casing, queries are
        lowercase fragments.

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M5T1S1/PRP.md
  why: CONTRACT (sibling, in parallel) — it owns
        test/adversarial-typing.test.ts (prose no-menu, Tab corruption,
        chain post-restore). Do NOT duplicate any of those probes; match
        its naming/header conventions so P1.M5.T2.S1 can document both
        files as one adversarial suite.

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M2T1S1/PRP.md
  and: .../P1M2T2S1/PRP.md, .../P1M3T1S2/PRP.md, .../P1M3T2S1/PRP.md
  why: the four fix contracts these probes guard (maskSecrets wiring,
        entropy rules, abort-on-failure, restore-tail sweep).

- docfile: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/architecture/system_context.md
  section: BUG-003/BUG-004/BUG-006 + the acceptance item-5 masking note
```

### Current Codebase tree (relevant)

```bash
test/mask-secrets.test.ts     # probe keys + real-pipeline harness (lift)
test/bad-dict-gate.test.ts    # MISSING_DICT idiom + notify-once spies
test/ingest-restore.test.ts   # fake session-manager + msg constructors
test/phrases.test.ts          # fast-path phrase admission fixtures
test/index.test.ts            # settle() convention
src/pi/ingest.ts              # IngestPipeline, sweepPhrases, restoreFromHistory
src/core/store.ts             # sweepPhraseDemotions contract (L797-830)
src/core/query.ts             # rankMatches
dict/common-en.bin            # shipped artifact (via resolveDictPath)
```

### Desired Codebase tree

```bash
test/adversarial-ingest.test.ts   # NEW — the three probe suites (only file added)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: mock ONLY the session manager. Store, pipeline, dict,
//   rankMatches, restoreFromHistory are all REAL. yieldFn: async () => {}
//   is the accepted inter-slice no-op when processText is awaited directly.
// GOTCHA: isDisabled / shouldAbort must be CLOSURES over dict.failed —
//   the flag flips DURING the replay; passing by value freezes false.
// GOTCHA: a NONEXISTENT dict path fails on the FIRST lookup, i.e. during
//   the FIRST message of the replay — the trigger word of message 1 may
//   already be blocked by the per-segment gate; the assertions
//   (size===0, notify-once) hold either way per bad-dict-gate.test.ts.
// GOTCHA: restoreFromHistory is fire-and-forget (returns void
//   synchronously); use settle() (420ms) or a processText-counting
//   wrapper (acceptance.test.ts ingestFixture pattern) to await it.
//   Prefer the counting wrapper + a final settle for determinism.
// GOTCHA: restore-style direct processText calls bypass #drainQueue —
//   that is the BUG-006 premise; the sweep must be invoked via
//   pipeline.sweepPhrases() (or the restore tail) for demotion to run.
// GOTCHA: demotion boundary is ≥40 SUBSEQUENT ordinals — 45 fillers
//   safely clears it; each processText call = 1 ordinal.
// GOTCHA: use resolveDictPath() (HAPAX_DICT env seam) for the shipped
//   dict — never a hard-coded path. See calibration/mask-secrets tests.
// GOTCHA: rankMatches queries are lowercase; item.value has display
//   casing. Assert values, not JSON identity, for casing-bearing items.
// CRITICAL: vitest default glob picks up test/adversarial-ingest.test.ts
//   automatically — no config change. npm run check (tsc strict) must
//   stay clean.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE test/adversarial-ingest.test.ts — scaffolding + Probe A (secrets)
  - HEADER comment (Mode A): methodology (real modules + shipped dict,
    only the session manager faked; probes shaped like the original bug
    hunt that the scripted acceptance masked — acceptance item 5's FAKE_SK
    pure-hex/FAKE_GHP prefix tokens passed while realistic formats
    leaked), and the mapping A→BUG-003 (PRD §h2.2/h3.2),
    B→BUG-004 (§03 disable-don't-degrade), C→BUG-006 (§h2.3/h3.5)
  - COPY the validated probe constants from test/mask-secrets.test.ts:33-40
    (AWS_SECRET, SLACK xoxb line, JWT with dots, OPENAI sk-proj key)
  - LIFT the real-pipeline harness: new IngestPipeline({ store, dictionary:
    loadDictionary(resolveDictPath()), yieldFn: async () => {} }) — copy
    cfg idioms from mask-secrets.test.ts pipeline block
  - TEST 'PRD repro': await processText("aws secret: " + AWS_SECRET + "
    slack token: " + SLACK, true) — the PRD's exact repro text; then
    separate processText calls for `token: ${JWT} ok` and
    `key: ${OPENAI} ok`
  - ASSERT rankMatches(store,'wjal') === [] (AWS payload), 'abc' === []
    (Slack tail), 'dozjg' === [] (per work item), the sk-proj payload
    prefix (first 5 chars of the OPENAI payload after 'sk-proj-') === [],
    'sflkx' === [] (JWT signature), 'akiai' === [] (AWS id), 'aiza' === []
    (Google) — it.each over a [label, fragment] table
  - POSITIVE CONTROL: a rare absent word in the same text (e.g. 'zephyr')
    DOES admit → rankMatches(store,'zephy') non-empty

Task 2: Probe B describe("bad-dict restore (BUG-004)")
  - FIXTURE: createLazyDictionary('/nonexistent/common-en.bin', onLoadError
    = vi.fn()); IngestPipeline wired with isDisabled closure
  - fakeSm: minimal RestoreSessionManager from test/ingest-restore.test.ts
    shapes — getBranch() → [], getEntries() → 2-3 prose message entries
    ("with that and have", etc. — the BUG-004 repro vocabulary)
  - CALL restoreFromHistory(pipeline, fakeSm) (whole pipeline — real
    sweepPhrases rides along; on empty store it is a no-op)
  - AWAIT: processText-counting wrapper (resolve when count === entry
    count) + settle() belt-and-suspenders
  - ASSERT: store.size === 0; rankMatches(store,'with') === []; onLoadError
    toHaveBeenCalledOnce(); THEN a LIVE pipeline.processText("more common
    prose here", true) followed by settle() → store.size STILL 0 and
    getStats().admitted === 0 (sticky disable covers the live path — the
    exact PRD §03 'disables itself rather than running with a bad table')

Task 3: Probe C describe("demotion cadence (BUG-006)")
  - FIXTURE: real pipeline + shipped dict + real store, phrase hook live
    (default IngestPipeline behavior — copy phrase-admission fixture
    shape from test/phrases.test.ts: two absent rare words whose bigram
    repeats once so the fast-path phrase candidate admits with count < 2)
  - TEST: (1) ingest the phrase-bearing text; assert rankMatches(store,
    phrasePrefix) includes the phrase item (admitted) and, if the bare
    first word is suppressed by constituent suppression, pin that state
    now (this assertion documents the 'before'); (2) 45 × await
    pipeline.processText("ordinary filler prose ordinal n", true) with
    varied n (restore-style direct calls — no flush); (3) pipeline.
    sweepPhrases(); (4) assert rankMatches(store, phrasePrefix) no longer
    returns the phrase item (demoted — count < 2, ≥40 subsequent
    ordinals, not sticky) and the bare first word IS returned (suppression
    consequences cleared). Also assert a second sweepPhrases() call
    changes nothing (idempotent, store.ts:823).
  - NEGATIVE boundary (cheap, from the store contract): at 40-1 style
    counts the sweep is a no-op — optional; prefer keeping the single
    45-ordinal deterministic gate if the boundary costs fixture fragility

Task 4: VALIDATE
  - npm run check                          # tsc strict, zero errors
  - npx vitest --run test/adversarial-ingest.test.ts -v
  - npm test                               # whole suite green, no leaks
```

### Implementation Patterns & Key Details

```ts
// Probe A harness (lift from test/mask-secrets.test.ts pipeline block):
const dict = loadDictionary(resolveDictPath());
const store = new CandidateStore();
const pipeline = new IngestPipeline({ store, dictionary: dict, yieldFn: async () => {} });
await pipeline.processText(`aws secret: ${AWS_SECRET} slack token: ${SLACK}`, true);
expect(rankMatches(store, "wjal")).toEqual([]); // it.each table for all fragments

// Probe B: closure over the live flag + settle:
const onLoadError = vi.fn();
const dict = createLazyDictionary("/nonexistent/common-en.bin", onLoadError);
const pipeline = new IngestPipeline({
  store, dictionary: dict,
  isDisabled: () => dict.failed === true,   // CLOSURE — flips mid-replay
  yieldFn: async () => {},
});
restoreFromHistory(pipeline, fakeSm);
await countingWrapper; await settle();      // settle(): setTimeout 420ms
expect(store.size).toBe(0);
expect(onLoadError).toHaveBeenCalledOnce();
await pipeline.processText("more common prose here", true);
await settle();
expect(store.size).toBe(0);                  // sticky live no-op

// Probe C: cadence + tail sweep:
await pipeline.processText(phraseText, true);       // fast-path phrase admits
for (let n = 0; n < 45; n++) await pipeline.processText(`filler prose ordinal ${n}`, true);
pipeline.sweepPhrases();                            // the restore-tail sweep
expect(rankMatches(store, phrasePrefix).map(i => i.value)).not.toContain(PHRASE_VALUE);
expect(rankMatches(store, firstWordPrefix).map(i => i.value)).toContain(FIRST_WORD);
```

### Integration Points

```yaml
CI: consumed automatically by vitest --run default glob; no config change.
DEPENDS-ON (all Complete per plan_status): P1.M2.T1.S1 maskSecrets,
    P1.M2.T2.S1 entropy rules, P1.M3.T1.S1+S2 disable/abort,
    P1.M3.T2.S1 restore-tail sweep.
SIBLING (parallel, treat as contract): P1.M5.T1.S1 —
    test/adversarial-typing.test.ts; disjoint probe set, matching
    header/naming conventions.
CONSUMED-BY: P1.M5.T2.S1 (README changeset will reference both
    adversarial files).
NO product changes: src/ untouched.
```

## Validation Loop

### Level 1: Type & style

```bash
npm run check   # tsc --noEmit strict — zero errors
```

### Level 2: The probes

```bash
npx vitest --run test/adversarial-ingest.test.ts -v
# all three describe blocks green; each it.case individually named
```

### Level 3: Full suite

```bash
npm test   # existing suites + S1's adversarial-typing + this file green
```

### Level 4: Adversarial honesty (optional, do not commit mutations)

```bash
# Scratch-mutate: remove the sk-proj rule from maskSecrets (or point
# isDisabled at a constant false) in a THROWAWAY copy and confirm the
# corresponding probe fails. Restore immediately.
```

## Final Validation Checklist

- [ ] `npm run check` clean; `npm test` fully green
- [ ] Header comment maps probes → BUG-003/004/006 with PRD anchors (Mode A)
- [ ] Probe A: all realistic key fragments leak zero candidates;
      positive control admits; PRD's exact repro text used
- [ ] Probe B: store.size 0 after bad-dict restore; notify once; live
      message post-failure is a no-op
- [ ] Probe C: 45-ordinal cadence + sweepPhrases demotes the fast-path
      phrase; first-word suppression cleared; sweep idempotent
- [ ] Only the session manager is faked; shipped dict via resolveDictPath
- [ ] Only file added: test/adversarial-ingest.test.ts; no src/ changes,
      no PRD/tasks.json edits, no duplication of S1's typing-path probes

## Anti-Patterns to Avoid

- ❌ Don't mock the store/dictionary/pipeline/rankMatches — e2e against
      the committed artifact is the whole point
- ❌ Don't invent fake key shapes — use the validated constants from
      test/mask-secrets.test.ts (gitleaks-validated) and the PRD's exact
      repro sentences
- ❌ Don't pass dict.failed by value — closure over the live flag
- ❌ Don't assert "not containing secret substrings" without a positive
      control — no-leak assertions are vacuous against a dead store
- ❌ Don't rely on wall-clock timing alone — use the processText-counting
      wrapper before settle()
- ❌ Don't duplicate S1's probes (prose no-menu, Tab corruption, chain)
- ❌ Don't hard-code band constants or dict scores — measure via
      dict.lookup or import from src/core/score.ts

## Confidence Score

**9/10** — every probe lifts an existing, battle-tested harness
(mask-secrets pipeline block, bad-dict-gate idiom, phrases admission
fixtures, settle/counting-wrapper conventions), and the contracts being
pinned are documented in the source doc comments the fixes themselves
wrote. Residual risk: exact fast-path phrase admission fixture may need a
iteration against test/phrases.test.ts shapes; the store.ts L797-830
contract doc makes the cadence deterministic.