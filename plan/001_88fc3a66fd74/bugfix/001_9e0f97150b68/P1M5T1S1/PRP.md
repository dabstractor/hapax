# PRP — P1.M5.T1.S1: Typing-path adversarial probes: prose no-menu, Tab-corruption, chain post-restore

## Goal

**Feature Goal**: Create a permanent adversarial e2e regression gate
(`test/adversarial-typing.test.ts`) that runs the three TYPING-PATH probes
from the original bug hunt against REAL modules and the SHIPPED
`dict/common-en.bin` — mock nothing except the pi session shell. Each probe
pins a PRD §01 invariant that the scripted acceptance suite structurally
could not catch:

1. **Prose no-menu (BUG-001)** — ingesting `test/fixtures/sessions/prose.jsonl`
   through a real `IngestPipeline` with the shipped dict, typing
   `with`/`this`/`them`/`thin`/`firs` must NEVER surface the common word
   itself as a hapax menu item.
2. **Tab corruption (BUG-002)** — the full `ze`→`zep`→Tab editor-sim
   sequence plus a pause-then-Tab variant through
   `createDisplayProvider`; applying whatever the provider returns through
   the faithful `editorApplyCompletion` helper must never produce
   `zzendesk`-class corrupted text.
3. **Chain post-restore (BUG-005)** — full `test/fixtures/sessions/nrel.jsonl`
   replay via `restoreFromHistory`, then accept the bare word `national`
   (present thanks to P1.M4.T2.S1's suppression exemption), assert the chain
   offers `renewable`, Tab-accept, `energy`, Tab-accept, `laboratory` —
   the PRD §09 M2 item 7 sequence in a resumed session.

**Deliverable**: One new test file `test/adversarial-typing.test.ts`
(plus optional helper if genuinely needed — prefer reusing existing
helpers), wired into the default `vitest --run` suite, with a header
comment documenting the probe methodology and which PRD bug each probe
pins. No product surface change.

**Success Definition**: `npm run check` + `npm test` green; each probe is a
deterministic e2e gate that would have FAILED against the pre-fix tree and
passes against the current tree (dictionary recalibration, display-provider
anchor fix, chain fixes all landed).

## User Persona

**Target User**: hapax maintainers + CI. This is a test-only work item.
**Use Case**: every PR runs `npm test`; these probes guarantee the typing
invariants (no hijack, no menu for ordinary prose, no text corruption,
chain reachable after resume) can never silently regress even if unit
suites stay green.
**Pain Points Addressed**: the original shipped acceptance suite masked
six real bugs because its probes used ≤3-char words, single-token fake
keys, and pre-ingestion acceptance ordering. These probes reuse the
adversarial shapes that actually found the bugs.

## Why

- The bug hunt (PRD §h2.0) found 6 issues the 523-green suite missed; all
  six fixes are landing across P1.M1–P1.M4. Without adversarial gates, the
  same class of masking failure recurs on the next refactor.
- These probes are the typing-path third of P1.M5.T1 (the sibling
  P1.M5.T1.S2 covers ingest-path probes: secrets, bad-dict restore,
  demotion cadence — do NOT duplicate those here).

## What

Create `test/adversarial-typing.test.ts` with three `describe` blocks
(details in Implementation Blueprint). Key contracts:

- **Probe A (prose no-menu)**: reuse — do not re-derive —
  `COMMON_PROBES` (exported from `test/calibration.test.ts`) plus
  `thin`/`firs` per the item description. Real `IngestPipeline` +
  shipped dict via `resolveDictPath()`, replay `prose.jsonl` through
  `restoreFromHistory` exactly as `test/calibration.test.ts`'s `beforeAll`
  does (copy that harness — it is already self-contained by design and its
  header comment says to lift it). Assertions: for `with`/`this`/`them`:
  provider DELEGATES (exact sentinel identity) and `__hapaxLive()` is null
  — but the item description is stricter: "no menu item for the common
  word itself (pin the exact expected set per the calibrated bands)". So
  additionally pin, per the calibrated bands (imported constants from
  `src/core/score.ts`, never hard-coded):
  - `thin`: mid band (`MID_FREQ_THRESHOLD ≤ q < REJECT_COMMON_THRESHOLD`)
    → menu `['thin']` IS expected (mid-band words legitimately complete) —
    the pin is that the SET is exactly `['thin']`, not that it's empty.
  - `firs`: `first` q ≥ `REJECT_COMMON_THRESHOLD` → zero candidates →
    delegation.
  Use `it.each` with a table mapping probe → expected outcome
  (`delegate` | exact item-value list), so the pins live in one place.
- **Probe B (Tab corruption)**: real `CandidateStore` fixture with exactly
  `zendesk` (display `Zendesk`) and `zephyr`; real `createDisplayProvider`
  wrapping a `createHapaxProvider` (threshold-mode typing, no `#`
  trigger); `vi.useFakeTimers` + `setSystemTime(0)` per
  `test/provider-display.test.ts` conventions. Sequence: type `z`
  (delegate/below threshold) → `e` (paintes {Zendesk, zephyr} @ `ze`) →
  advance < 100 ms → `p` → take whatever the provider returns and Tab-apply
  `items[0]` through `editorApplyCompletion("zep", 3, item.value, res.prefix)`
  from `test/helpers/editor-sim.ts` → assert result ∈
  `{zephyr, Zendesk}`-family and never contains doubled prefix bytes
  (`'zzendesk'`, `'zeZendesk'`, etc.). Variant: same, but after `p`
  advance timers past 100 ms (pending promotes) THEN Tab with no new
  keystroke → still anchor-safe. Also use `prefixIsAnchorSafe` from
  editor-sim where applicable.
- **Probe C (chain post-restore)**: full `nrel.jsonl` replay via
  `restoreFromHistory` (real pipeline, shipped dict, real store). Then
  through `createHapaxProvider`: `getSuggestions(['natio'], 0, 5, …)` →
  the bare word `National` MUST be among items (P1.M4.T2.S1 exemption;
  this is itself an assertion). Accept it via the provider's
  `applyCompletion` (the real wrapper — which arms the chain as a side
  effect, per P1.M4.T2.S2). Then drive the §09 M2 item 7 sequence:
  next query offers chain items — `renewable` present (via
  `CHAIN_KEY_PREFIX` key in `__hapaxLive()` mapping or item description);
  Tab-accept → type/query for `energy` → Tab-accept → `laboratory` offered
  as a chain successor of `energy`. Assert each hop. Also assert the
  phrase-route variant rides along OR is left to `test/chain.test.ts`
  (S2's suite already covers phrase arming — only add the bare-word route
  here to avoid duplication; see anti-patterns).

### Success Criteria

- [ ] `test/adversarial-typing.test.ts` exists, header comment documents
      methodology + pinned bugs (Mode A docs)
- [ ] Probe A: prose replay through real pipeline + shipped dict; common
      words never self-complete; `thin`/`firs` pinned sets per imported
      band constants
- [ ] Probe B: `ze`→`zep`→Tab and pause-then-Tab never corrupt text via
      the faithful editor sim
- [ ] Probe C: bare `national` accepted post-restore arms the chain;
      `renewable` → Tab → `energy` → Tab → `laboratory` sequence passes
- [ ] No mocks beyond the pi session shell (`mockCurrent` sentinel
      delegate + session manager); real store/pipeline/dict/provider
- [ ] `npm run check && npm test` fully green

## All Needed Context

### Context Completeness Check

The implementer gets: the exact existing harnesses to lift (calibration
`beforeAll` replay, provider-display store fixtures + fake-timer
conventions, chain `armViaTab` pattern), the exact helper APIs
(`editorApplyCompletion`, `prefixIsAnchorSafe`, `COMMON_PROBES`,
`parseSessionFixture`/`asSessionManager`/`messageEntriesOf`), the band
constants to import, and the dependency contracts from the four upstream
fix PRPs. No prior knowledge beyond the pointed files needed.

### Documentation & References

```yaml
- file: test/calibration.test.ts
  why: THE harness to lift for Probe A. Its beforeAll (L101-133) replays
        prose.jsonl through a REAL IngestPipeline + shipped dict via
        restoreFromHistory; its COMMON_PROBES (L75) is exported FOR THIS
        TASK ("import COMMON_PROBES from here rather than re-listing").
        Its 'thin/firs' pinned test (L167+) documents the expected
        per-band behavior you must replicate as a table.
  pattern: self-contained helpers cfg()/opts()/mockCurrent(SENTINEL) are
    deliberately replicated from acceptance.test.ts "so later tasks can
    lift it whole" — do exactly that.
  gotcha: HAPAX_DICT env seam — resolveDictPath() must be used, never a
    hard-coded dict path.

- file: test/helpers/editor-sim.ts
  why: faithful pi-tui Tab math for Probe B. Exports
        editorApplyCompletion(line, cursorCol, itemValue, prefix) and
        prefixIsAnchorSafe. Created by P1.M4.T1.S1 specifically for reuse
        by this task — do not reimplement.

- file: test/provider-display.test.ts
  why: display-provider harness conventions for Probe B: store fixtures
        (sighting()/put()), mockCurrent, cfg(), vi.useFakeTimers +
        setSystemTime(0), and the BUG-002 regression tests already in
        place (your probes are e2e-level twins: real store + real
        display provider + real hapax provider chained together).
  gotcha: threshold-mode typing means lines=[fragment], cursor =
    fragment.length; a 1-char fragment delegates (below DEFAULT
    threshold 2).

- file: test/chain.test.ts
  why: armViaTab pattern (L155+) — drive getSuggestions, resolve the live
        item, call the provider's applyCompletion which arms the chain,
        then inspect subsequent getSuggestions for CHAIN_KEY_PREFIX items.
  gotcha: accept the item from the SAME query cycle before any further
    getSuggestions rebuilds liveKeyByValue.

- file: test/helpers/session-fixture.ts
  why: parseSessionFixture / asSessionManager / messageEntriesOf — used
        by both replay harnesses.

- file: src/pi/provider.ts
  why: createHapaxProvider / createDisplayProvider / __hapaxLive /
        CHAIN_KEY_PREFIX semantics. The applyCompletion arming intercept
        (P1.M4.T2.S2) is the side effect Probe C rides.

- file: src/core/score.ts
  why: import REJECT_COMMON_THRESHOLD / MID_FREQ_THRESHOLD for band pins —
        never hard-code numbers.

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M4T2S1/PRP.md
  why: CONTRACT — successor-aware constituent-suppression exemption in
        rankMatches/query.ts that makes bare 'national' co-present with
        the phrase post-restore. Probe C's first assertion guards it.

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M4T2S2/PRP.md
  why: CONTRACT — phrase/word acceptance arms the chain at the accepted
        key. Probe C's Tab sequence depends on it. NOTE: S2 was being
        implemented in parallel with this research; verify its tests
        landed before asserting its route here.

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M4T1S1/PRP.md
  why: CONTRACT — the 4d-exception prefix-anchor invalidation + the
        editor-sim helper Probe B consumes.

- docfile: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/architecture/system_context.md
  section: BUG-001/002/005 + Test infrastructure facts
```

### Current codebase tree (relevant)

```bash
test/calibration.test.ts          # Probe A harness + COMMON_PROBES (lift whole)
test/provider-display.test.ts     # Probe B conventions (fake timers, fixtures)
test/chain.test.ts                # Probe C armViaTab pattern
test/helpers/editor-sim.ts        # faithful Tab math (exists, exported)
test/helpers/session-fixture.ts   # session replay helpers
test/fixtures/sessions/prose.jsonl
test/fixtures/sessions/nrel.jsonl
src/pi/provider.ts                # providers under test (read-only here)
```

### Desired Codebase tree

```bash
test/adversarial-typing.test.ts   # NEW — the three probe suites (only file added)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: no mocks beyond the pi session shell. mockCurrent(SENTINEL)
//   models only pi's delegate provider; store/pipeline/dict/providers real.
// GOTCHA: fresh config per call — cfg() spreads DEFAULT_CONFIG, never
//   mutate it; fresh AbortController signal per query.
// GOTCHA: fake timers: pin setSystemTime(0), advance with
//   vi.advanceTimersByTime; vitest 4 fakes Date.now.
// GOTCHA: store prefix index is lowercase; item.value carries display
//   casing ('National', 'Zendesk') — assert values, query fragments.
// GOTCHA: mid-band words (thin) LEGITIMATELY open menus — the invariant
//   is "no menu item for the REJECT-band common word", not "no menu".
// GOTCHA: restoreFromHistory replays async; calibration harness resolves
//   when processText call count === filtered entry count. Keep the 60s
//   beforeAll timeout.
// GOTCHA: chain accept must happen in the same query cycle as the
//   getSuggestions that produced the item (liveKeyByValue rebuilds).
// CRITICAL: npx vitest --run (npm test) must pick the new file up
//   automatically — vitest default glob covers test/*.test.ts; no config
//   change needed.
// tsc strict: npm run check must stay clean with the new file.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE test/adversarial-typing.test.ts — scaffolding + Probe A
  - HEADER comment: probe methodology (real modules + shipped dict, only
    the pi session shell mocked; probes shaped like the original 8-suite
    bug hunt, which the scripted acceptance masked), and a per-probe bug
    mapping: A→BUG-001 (PRD §h2.1/h3.0), B→BUG-002 (§h2.2/h3.1),
    C→BUG-005 (§h2.2/h3.4)
  - LIFT the self-contained helpers from test/calibration.test.ts
    (cfg, opts, mockCurrent/SENTINEL, replay beforeAll) — that file was
    built to be lifted whole
  - Probe A describe("prose no-menu (BUG-001)"): it.each over
    COMMON_PROBES + thin/firs with an expected-outcome table:
      with/this/them/that/have/would → delegate (toBe SENTINEL) +
        __hapaxLive() null
      thin → menu items exactly ['thin'] (mid band, asserted via
        imported band constants + dict.lookup)
      firs → delegate (first is REJECT-band)
  - POSITIVE control: garde→garden (or equivalent) opens a real menu on
    the SAME store so no-menu results can't be vacuous

Task 2: Probe B describe("Tab corruption (BUG-002)")
  - FIXTURE: real CandidateStore with zendesk (display 'Zendesk', ×3
    sightings) + zephyr ×1; real createHapaxProvider wrapped by real
    createDisplayProvider over mockCurrent sentinel
  - TEST 'ze→zep→Tab': type z, e (paint), advance <100ms, p; res =
    provider.getSuggestions(['zep'],0,3,...); completed =
    editorApplyCompletion('zep',3,res.items[0].value,res.prefix);
    expect(completed) ∈ correct completions; expect(completed) not to
    match /zzendesk|zeZendesk|zepphyr|zephyr/ corruption shapes (use
    explicit allowlist, not substring denial)
  - TEST pause-then-Tab: advance past 100ms after p, Tab without new
    keystroke → same anchor-safety assertion
  - TEST prefix invariant: for every returned result,
    prefixIsAnchorSafe(buffer-prefix) holds (or assert
    'zep'.endsWith(res.prefix))

Task 3: Probe C describe("chain post-restore (BUG-005)")
  - beforeAll: full nrel.jsonl replay via restoreFromHistory with real
    IngestPipeline + shipped dict + real store (lift calibration replay
    harness; note: nrel has 10 lines — count entries the same way)
  - TEST bare-word present: getSuggestions(['natio'],0,5,...) items
    include value 'National' (guards P1.M4.T2.S1's exemption)
  - TEST chain sequence (§09 M2 item 7): accept 'National' via the
    provider's applyCompletion (real arming side effect) → next query
    (space/continuation) offers 'renewable' as a chain item → Tab-accept
    (armViaTab pattern) → 'energy' offered+accepted → 'laboratory'
    offered as successor of 'energy'. Assert each hop individually so a
    failure names the broken link.
  - IF S2's phrase-arming tests have NOT landed, gate nothing on them —
    the bare-word route is fully specified by S1+S2 contracts; check
    test/chain.test.ts for the describe("phrase acceptance...") suite to
    confirm, and do not duplicate it here.

Task 4: VALIDATE
  - npm run check && npm test          # whole suite green
  - npx vitest --run test/adversarial-typing.test.ts -v   # probes green
  - npx vitest --run test/calibration.test.ts test/provider-display.test.ts test/chain.test.ts -v
    # upstream suites still green (no shared-state leaks)
```

### Implementation Patterns & Key Details

```ts
// Probe A table (band constants imported, sets pinned):
const PROSE_EXPECTATIONS: Array<[string, "delegate" | string[]]> = [
  ...COMMON_PROBES.map((w) => [w, "delegate"] as [string, "delegate"]),
  ["thin", ["thin"]],   // mid band — legit completion, exact set pinned
  ["firs", "delegate"], // 'first' REJECT-band → zero candidates
];

// Probe B Tab apply (faithful pi-tui math — no re-verification):
const res = await provider.getSuggestions(["zep"], 0, 3, opts());
const completed = editorApplyCompletion("zep", 3, res.items[0]!.value, res.prefix);
expect(["zephyr", "Zendesk"]).toContain(completed); // allowlist, not /zzendesk/

// Probe C hop pattern (from test/chain.test.ts armViaTab):
const live = await provider.getSuggestions(["natio"], 0, 5, opts());
const item = live!.items.find((i) => i.value === "National");
provider.applyCompletion(["natio"], 0, 5, item!, "natio"); // arms chain
const next = await provider.getSuggestions(["national "], 0, 9, opts());
// expect chain item 'renewable' (via __hapaxLive() key CHAIN_KEY_PREFIX…)
```

### Integration Points

```yaml
CI: consumed automatically — vitest --run default glob picks up
    test/adversarial-typing.test.ts; no vitest.config change
DEPENDS-ON (all Complete or per plan_status): P1.M1.T1.S2 artifact,
    P1.M1.T2.S2 bands, P1.M4.T1.S1 display fix + editor-sim,
    P1.M4.T2.S1 exemption (Complete), P1.M4.T2.S2 phrase arming
    (implementing in parallel — treat as contract)
CONSUMED-BY: P1.M5.T1.S2 (ingest-path probes, sibling file naming
    convention), P1.M5.T2.S1 (README mentions the adversarial suite)
NO product changes: src/ untouched
```

## Validation Loop

### Level 1: Type & style

```bash
npm run check   # tsc --noEmit strict — zero errors
```

### Level 2: The probes themselves

```bash
npx vitest --run test/adversarial-typing.test.ts -v
# all three describe blocks green, each hop/hop-case individually named
```

### Level 3: Full suite (no regressions / no shared state)

```bash
npm test
# 523+ existing tests + new probes green; calibration/display/chain suites
# unaffected (real modules, fresh stores per beforeAll — no leakage)
```

### Level 4: Adversarial honesty check

```bash
# Temporarily sanity-check the gates bite (optional, do NOT commit the
# mutation): e.g. relax REJECT_COMMON_THRESHOLD in a scratch copy and
# confirm Probe A fails. Restore immediately.
```

## Final Validation Checklist

- [ ] `npm run check` clean; `npm test` fully green
- [ ] Header comment documents methodology + bug mapping (Mode A docs)
- [ ] Probe A: real prose replay, common words delegate, thin/firs sets
      pinned via imported band constants, positive control present
- [ ] Probe B: both Tab variants anchor-safe through faithful editor sim
- [ ] Probe C: bare-word exemption guarded; renewable→energy→laboratory
      chain sequence passes post-restore
- [ ] Only mocks: pi session shell (sentinel delegate, session manager)
- [ ] Only file added: test/adversarial-typing.test.ts (+ research notes)
- [ ] No src/ changes, no config changes, no PRD/tasks.json edits

## Anti-Patterns to Avoid

- ❌ Don't mock the store/dictionary/pipeline/providers — the entire point
      is e2e against the committed artifact
- ❌ Don't re-list COMMON_PROBES — import from test/calibration.test.ts
- ❌ Don't reimplement editor Tab math — use test/helpers/editor-sim.ts
- ❌ Don't hard-code band numbers or dict scores — import constants /
      measure via dict.lookup in the test
- ❌ Don't assert "not 'zzendesk'" by substring denial — use allowlists
- ❌ Don't duplicate S2's phrase-arming tests or P1.M5.T1.S2's
      ingest-path probes
- ❌ Don't skip the positive controls — no-menu assertions are vacuous
      against a dead store

## Confidence Score

**9/10** — all three probes lift existing, battle-tested harnesses
(calibration replay, display fake-timer fixtures, chain armViaTab) and the
editor-sim helper was built explicitly for this task; the only residual
risk is the in-flight P1.M4.T2.S2 contract, which this PRP treats as
landed per the plan status and which Probe C will surface immediately if
not.