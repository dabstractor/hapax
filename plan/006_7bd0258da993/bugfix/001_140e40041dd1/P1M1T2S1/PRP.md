# PRP — P1.M1.T2.S1 (bugfix 001_140e40041dd1): index.test.ts e2e — series marks, typed-word arming, and series-first ordering through the real factory

---

## Goal

**Feature Goal**: Add the production-composition acceptance layer for
BUG-001's fix (PRD recommendation: "an end-to-end 'production wiring' test
layer that composes index.ts's session_start with a fake ctx and asserts
observable behaviors rather than fabricating stores"): through the REAL
`hapax` factory with fakePi/fakeCtx on the FALLBACK path, a capitalized-run
history (`The Fed raised rates today`) must yield (a) series-marked
successors observable in the /acwords dump, (b) typed-word chain arming
(`typing The ` arms via provider.ts:597-608) followed by the zero-char
offer `Fed` in run casing, and (c) series-first ordering that a
higher-count ordinary successor cannot outrank.

**Deliverable**: One new `describe` at the end of `test/index.test.ts`
(banner comment citing spec 07 M2 "typing The offers Fed" + the typed-word
arming state line and spec 06 "series successors rank above ordinary
regardless of counts", stating the layer's purpose), reusing the existing
harness (`wired`, `useDict`, `enableDebug`, `userMsg`, `acwordsHandler`,
`dump`, `settle`, `vi.waitFor` polling). Test-only — no source changes.

**Success Definition**: All new cases pass against the wired production
seam (enriched runs payload from P1.M1.T1.S1); observation is exclusively
through the registered provider and /acwords dump (no fabricated store, no
pipeline object — none is exported); `npm run check` + full `npm test`
green; no duplication of P1.M1.T1.S2's ingest-level fixtures.

## Why

Both majors of the bug hunt survived the 1286-test suite because every
existing test builds its own store; the index.ts seam itself was never
exercised (the acceptance fixtures mirrored the stale shim). This suite is
the template the remaining composition tasks reuse: P1.M1.T2.S2 extends it
to the widget path + live TTY, and the BUG-002 path-display e2e
(P1.M2.T2.S1) copies the structure. Spec anchors: spec/07 M2 (:690+) —
"typing The offers Fed" and "idle ──space closes a typed word whose first
letter is UPPERCASE and whose lowercase key has series successors──►
armed(W)"; spec/06 — "series successors rank above ordinary regardless of
counts".

## What

New describe: `index.ts e2e — series pipeline through the real factory
(fallback path)` with the Mode-A banner comment per the contract.

### Common setup helper (local to the describe)

```ts
// Compose the REAL extension; wire a temp dict ({the: q200}); debug on so
// /acwords observation works. Returns the captured provider FACTORY
// (index.ts:360 registers (current) => provider via addAutocompleteProvider).
async function seriesSession(msgs: string[]) {
  useDict();
  enableDebug();
  const { handlers, ctx, registerCommand, addAutocompleteProvider } = wired();
  startSession(handlers.get("session_start")!, ctx, "new");
  for (const m of msgs) await endMessage(handlers.get("message_end")!, ctx, userMsg(m));
  // Poll the REAL dump until ingest has landed (fire-and-forget drains make
  // fixed sleeps flaky — the restore-replay pattern at :420-433).
  const handler = acwordsHandler(registerCommand);
  await vi.waitFor(async () => {
    const text = await dump(handler);
    if (msgs.some((m) => /fed/i.test(m)))
      expect(text).toMatch(/fed/i);
    else expect(wordsSeenIn(text)).toBeGreaterThan(0);
  });
  return { ctx, registerCommand, addAutocompleteProvider, dumpHandler: handler };
}

// Compose the registered provider over a contract-shaped current.
const composeProvider = (
  addAutocompleteProvider: Mock,
): AutocompleteProvider =>
  (addAutocompleteProvider.mock.calls[0]![0] as (c: AutocompleteProvider) => AutocompleteProvider)(
    currentFake(),
  );
```

### Case (a) — series marks + run casing reach the store (observable)

```ts
it("capitalized-run history yields a series-marked successor with run casing (via /acwords)", async () => {
  const { dumpHandler } = await seriesSession(["The Fed raised rates today"]);
  const text = await dump(dumpHandler);
  // debug.ts successor sample: "the → fed ×1 (series)" — the marker AND the
  // run-casing nextDisplay ('Fed') are the two observable enrichment bits.
  expect(text).toMatch(/the\s*→\s*fed\s*×1\s*\(series\)/i);
  expect(text).toMatch(/fed/i); // run casing present where the sample shows display
});
```

(Match the dump's exact separator format at implementation time — read
`src/pi/debug.ts`'s successor-sample line (~:134-137) and pin it verbatim;
if nextDisplay is shown separately, assert it. If the sample shows only the
marker, assert the marker and rely on (b) for run casing.)

### Case (b) — typed-word arming + zero-char offer (the spec 07 journey)

```ts
it("typing 'The ' arms on the space tick and the next word-start query offers 'Fed' (run casing)", async () => {
  const { addAutocompleteProvider } = await seriesSession(["The Fed raised rates today"]);
  const p = composeProvider(addAutocompleteProvider);
  const signal = () => new AbortController().signal;

  // Space tick: close-on-space returns null (spec 07 h2.51) AND arms —
  // provider.ts:597-608 (typed 'The', uppercase first letter, series
  // successor exists, chain idle). Arming is asserted BEHAVIORALLY: no
  // chain export exists.
  const atSpace = await p.getSuggestions(["The "], 0, 4, { signal: signal() });
  expect(atSpace).toBeNull();

  // Same line, cursor at the empty word start after the space: the armed
  // branch's zero-char offer — top item 'Fed' (successor nextDisplay).
  const offer = await p.getSuggestions(["The "], 0, 4, { signal: signal() });
  expect(offer).not.toBeNull();
  expect(offer!.prefix).toBe("");
  expect(offer!.items[0]!.value).toBe("Fed");
  expect(offer!.items.map((i) => i.value)).not.toContain("the");
});
```

(If the two identical calls behave differently because the FIRST call both
closes and arms while the second consults — that is exactly the contract;
if implementation details make the space-tick call itself return the offer,
pin whichever the production code does AFTER reading the armed-branch
ordering — do not guess; the invariant under test is: arming happened on
the fallback path through index.ts composition, and 'Fed' surfaces with
run casing.)

### Case (c) — series-first ordering beats a higher-count ordinary successor

```ts
it("a series successor outranks an ordinary successor with higher counts (spec 06 series-first)", async () => {
  const { addAutocompleteProvider } = await seriesSession([
    "The Fed raised rates today",
    "the market moved quickly and the market fell sharply", // market ×2 ordinary
    "the market rallied again",                              // market ×3
  ]);
  const p = composeProvider(addAutocompleteProvider);
  await p.getSuggestions(["The "], 0, 4, { signal: new AbortController().signal }); // arm
  const offer = await p.getSuggestions(["The "], 0, 4, { signal: new AbortController().signal });
  // successorBefore (store.ts:177-182): series outranks ANY count.
  expect(offer!.items[0]!.value).toBe("Fed");
  expect(offer!.items.map((i) => i.value)).toContain("market"); // present, ranked below
});
```

### Case (d) — no series evidence ⇒ no typed arming (negative control)

```ts
it("ordinary capitalized typing with no series successor never arms", async () => {
  const { addAutocompleteProvider } = await seriesSession(["alpha beta gamma"]);
  const p = composeProvider(addAutocompleteProvider);
  const r1 = await p.getSuggestions(["Alpha "], 0, 6, { signal: new AbortController().signal });
  const r2 = await p.getSuggestions(["Alpha "], 0, 6, { signal: new AbortController().signal });
  // No series successor for 'alpha' → the gate at provider.ts:597-608 never
  // arms → the second call is an ordinary word-start query (null/word
  // items), never a zero-char successor offer with prefix "".
  expect(r2?.prefix ?? "x").not.toBe("");
});
```

### Success Criteria

- [ ] (a) dump shows the `(series)` marker for `the→fed`
- [ ] (b) `Fed` offered at the empty word start in run casing, prefix ""
- [ ] (c) `Fed` tops despite `market ×3`
- [ ] (d) negative control: no arming without series evidence
- [ ] `npm run check` + `npm test` green; no fabricated stores/pipelines
      anywhere in the describe; no source-file changes

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed?" — Yes: every harness helper is named with its role and anchor, the
provider-composition mechanism (index.ts:360 factory captured by the
addAutocompleteProvider spy) is explained, the producer semantics (arming
gate, successorBefore, nextDisplay, debug marker) are pinned with source
anchors, and the upstream-contract boundary (T1.S2 owns ingest-level
fixtures; T2.S2 owns the widget path) is explicit.

### Documentation & References

```yaml
- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/bug001-series-pipeline.md
  section: §6 (index.ts export structure + what a production-seam test needs)
  why: THE harness map — fakePi (:88-104)/fakeCtx (:110-152, editorFactory
        undefined → fallback), startSession/endMessage/settle(420ms),
        useDict/writeConfig, dump/wordsSeenIn, and the two observation
        paths (registered provider via addAutocompleteProvider; /acwords
        dump). "No pipeline object is exported, so the debounce settle (or
        a sufficiently awaited drain) is required."
  critical: prefer vi.waitFor polling the dump over fixed sleeps — the
        fire-and-forget restore drains make timing flaky (:420-433 pattern).

- file: test/index.test.ts
  pattern: wired() (:262-287), currentFake() (:154-163), userMsg (:68),
        acwordsHandler/dump/wordsSeenIn (:166-204), the :439 describe's
        prototype-spy caveat (:441-447 — avoid prototype spies here; observe
        via provider + dump only).
  gotcha: addAutocompleteProvider captures the FACTORY (index.ts:360
        `(current) => provider`), not the provider — compose it.

- file: src/pi/provider.ts (:597-608 typed-word arming gate)
  why: the exact gate under test — typed regex /([A-Za-z][A-Za-z0-9_-]*)\s$/,
        uppercase-first check, chain idle, some(s => s.series); arms then
        returns null (close-on-space preserved).

- file: src/core/store.ts (:127-182 Successor.series/nextDisplay,
        successorBefore series-first; :713+ recordBigramRuns isSeries)
  why: the observable semantics — series flag outranks ANY count.

- file: src/pi/debug.ts (:134-137 successor sample '(series)' marker)
  why: the dump assertion format — read and pin the exact line format.

- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P1M1T1S2/PRP.md
  why: CONTRACT (parallel): ingest-level series assertions in
        acceptance/adversarial-typing/successors/branch-purity — do NOT
        duplicate; this suite is one layer up (real index.ts composition).
  note: P1.M1.T1.S1 (enriched pass-through at index.ts) is the producer
        seam — if its wiring is absent, (a)-(c) fail RED against the shim:
        that is the point of this suite (it pins the fix).

- spec/07-completion-ui.md M2 (~:690+): "typing The offers Fed"; the
  typed-word arming state line; spec/06 series-first ranking.
```

### Current Codebase tree (relevant)

```bash
src/pi/index.ts        # the seam under test (enriched pass-through from T1.S1)
src/pi/provider.ts     # typed-word arming gate + armed zero-char offer
src/pi/debug.ts        # /acwords '(series)' marker
test/index.test.ts     # harness + the new describe
```

### Desired Codebase tree

```bash
test/index.test.ts     # + describe "index.ts e2e — series pipeline through
                       #   the real factory (fallback path)" + local helpers
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: the provider captured by the spy is a FACTORY over `current` —
// compose with currentFake() (contract-shaped) or the delegation path
// throws on applyCompletion.

// CRITICAL: getSuggestions is async and takes { signal } — fresh
// AbortController per call; never share a signal.

// GOTCHA: 'The' is sentence-initial structural-cap — spec 04 run detection
// deliberately INCLUDES line-initial positions; if the series mark does
// not survive for line-initial members, that is a PRODUCER bug — report it,
// never weaken the assertion.

// GOTCHA: no chain export exists — assert arming BEHAVIORALLY (second
// word-start query returns the zero-char offer).

// GOTCHA: prefer vi.waitFor on the dump; fixed sleeps race the 300 ms
// debounce AND cross-session fire-and-forget drains.

// GOTCHA: do not add CandidateStore.prototype spies in this describe — the
// shared-prototype caveat at :441-447 makes them flaky; provider + dump
// observation is sufficient and is the layer's whole point.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ src/pi/debug.ts's successor-sample line format + provider.ts
        :560-640 (armed offer construction: value/label source for run
        casing) — pin the exact assertion strings before writing tests.
Task 2: ADD the describe + local helpers (seriesSession,
        composeProvider) to test/index.test.ts.
Task 3: ADD cases (a)-(d); run against the tree (T1.S1 landed/landing).
        If (a)-(c) fail because the enriched wire is still absent, the
        suite is doing its job — coordinate with T1.S1 rather than
        weakening assertions.
Task 4: VALIDATE — npm test -- test/index.test.ts; full npm test; check.
```

### Implementation Patterns & Key Details

```ts
// Behavioral arming pin (no chain export):
const r1 = await p.getSuggestions(["The "], 0, 4, { signal: sig() }); // arms
const r2 = await p.getSuggestions(["The "], 0, 4, { signal: sig() }); // offers
expect(r2?.items[0]?.value).toBe("Fed");
```

### Integration Points

```yaml
TESTS ONLY: test/index.test.ts
DOWNSTREAM (templates reuse this structure):
  - P1.M1.T2.S2: widget-path variant (pass an editorFactory to fakeCtx) +
        /acwords deep markers + live TTY spot-check
  - P1.M2.T2.S1 (BUG-002): path-display e2e — same seriesSession shape
        with a path-mention history
FROZEN: all source files (a failing suite here indicates a producer bug —
  report it, do not fix producers from this test-only task)
```

## Validation Loop

### Level 1: Syntax

```bash
npm run check
```

### Level 2: Tests

```bash
npm test -- test/index.test.ts
npm test        # full suite
```

### Level 3: The journey (the BUG-001 repro inverted)

```bash
# The suite IS the repro: 'The Fed raised rates today' history → 'The '
# typed → chain armed → zero-char offer 'Fed' with run casing → series
# outranks market ×3. Pre-fix (shim wiring) every one of these is dead.
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green
- [ ] Series marker + run casing observable via /acwords (case a)
- [ ] Typed-word arming + zero-char 'Fed' offer (case b)
- [ ] Series-first vs market ×3 (case c); negative control (case d)
- [ ] Banner comment cites spec 07 M2 + spec 06 and the layer's purpose
- [ ] No fabricated store/pipeline; no prototype spies; no source changes

## Anti-Patterns to Avoid

- ❌ Building the store directly (the entire point is the production seam)
- ❌ Weakening or conditioning assertions to pass against the stale shim —
  red-against-the-bug is the suite's job; coordinate with T1.S1 instead
- ❌ Asserting chain internals via exports/prototype spies (behavioral only)
- ❌ Fixed sleeps instead of vi.waitFor dump polling
- ❌ Duplicating T1.S2's ingest-level fixture assertions
- ❌ Touching the widget path (editorFactory) — that is P1.M1.T2.S2

---

**Confidence Score: 9/10** — the harness is fully mapped with anchors, the
producer semantics (arming gate, series-first comparator, nextDisplay,
dump marker) are source-verified, the provider-composition mechanism is
explained, and the upstream/downstream contract boundaries are explicit;
the one open detail (exact dump line format / space-tick vs next-query
offer timing) is gated behind a mandatory read-before-write task.
