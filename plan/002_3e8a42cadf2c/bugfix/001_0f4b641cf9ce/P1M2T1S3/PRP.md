---
name: "P1.M2.T1.S3 (bugfix 001_0f4b641cf9ce) — Pin the PRD M2 acceptance phrase (National → Renewable → Energy → Laboratory) in an automated end-to-end test (integration item 7)"
---

## Goal

**Feature Goal**: Pin BUG-002's fix as a permanent automated regression tripwire: the PRD §09 M2 Definition-of-Done integration item 7 ("accept `National` → with zero additional typed chars `Renewable` is the top result → Tab → `Energy` → Tab → `Laboratory`") becomes a scripted test that replays the PRD's exact three-sentence NREL corpus through the REAL ingest pipeline + SHIPPED dictionary and drives the full chained-completion flow through the real provider + chain machine.

**Deliverable**:
- New fixture `test/fixtures/sessions/nrel-chain.jsonl` containing the PRD's three sentences (§ "What" below), pi-shaped session entries in the same jsonl format as `zephyr-chain.jsonl`.
- A new `describe` block in `test/acceptance.test.ts` ("acceptance item 7 — NREL phrase") that: ingests the fixture with the real dict; asserts `store.get('national'|'energy'|'laboratory')` are all defined (the BUG-002 assertion, inverted); ranks `'na'` → top is `National`; accepts it (arms the chain); at zero typed chars `topSuccessors('national')` top is `renewable`; Tab → `Energy`; Tab → `Laboratory` — the full chain with zero additional typed word-chars; `assertWordsOnly` on every rankMatches output; chain offers at prefix `""`.
- [Mode A] No docs — test + fixture only.

**Success Definition**: The new tests pass; the existing item-7 zephyr tests and the full suite (`npm test`, `npm run check`) stay green; any future band change that re-breaks the NREL phrase fails this test.

## Why

- BUG-002's root cause was exactly this: the band retune (50/20) was never re-validated against the M2 acceptance case — `national` (q=90), `energy` (q=94), `laboratory` (q=57) all rejected, `store.get(...) === undefined`, `topSuccessors('national') === []`, making the PRD's own DoD scenario unreachable. S1's proper-noun relief band + S2's tuned ceiling fix it; this item makes regression structurally impossible to miss again.
- This test is the evidence consumed by P1.M4.T1.S1 (full-suite regression + acceptance re-verification).

## What

1. **Fixture** `test/fixtures/sessions/nrel-chain.jsonl` — pi-shaped session entries (copy the entry shape from `zephyr-chain.jsonl`: a `session` header line then `message` lines with `content: [{type:"text", text: ...}]`, alternating user/assistant) whose ingestable text contains each of the PRD's three sentences verbatim, ≥3 times total (matching the PRD's own repro):
   - `The National Renewable Energy Laboratory is famous.`
   - `National Renewable Energy Laboratory again.`
   - `Visit National Renewable Energy Laboratory today.`
   Recommended: 3 user + 3 assistant messages, each message containing one occurrence of the phrase inside natural surrounding prose (so the fixture is not a degenerate repeated-string blob; surrounding words should avoid creating competing `na*`/successor bigrams — e.g. keep surrounding vocabulary common lowercase words, which the reject band excludes anyway).
2. **Tests** in `test/acceptance.test.ts` (follow the existing item-7 zephyr describe block's harness verbatim — it already lives in this file):
   - Reuse the file-local helpers: `makeChainPipeline(true)` (store + IngestPipeline wired with `onAdmittedTokens: runs => store.recordBigramRuns(runs)` + `loadDictionary(resolveDictPath())`), `replayChain`, `editingCurrent()` (pi-shaped applyCompletion + `typeSpace()`), `cfg()`, `opts()`, `createChainMachine`, `createHapaxProvider`, `rankMatches`, `assertWordsOnly`.
   - Fixture sanity test (mirror the zephyr "fixture sanity" test): after replay, `store.get("national")`, `store.get("energy")`, `store.get("laboratory")` all `toBeDefined()` (THE inverted BUG-002 repro — currently `undefined`); `store.get("renewable")` defined; `store.topSuccessors("national")` top is `renewable`; `topSuccessors("renewable")` top is `energy`; `topSuccessors("energy")` top is `laboratory`; `store.bigramSize > 0`; `rankMatches(store, "na")` top key is `"national"` with display `"National"`; `assertWordsOnly` on that menu.
   - Zero-typing chain test (mirror the zephyr "zero-typing chain" test): build provider with `editingCurrent()`; query `["na"]` at col 2 → menu contains `National`; `provider.applyCompletion(["na"], 0, 2, nationalItem, "na")` → `chain.state()` equals `{ word: "national" }`, buffer becomes `["National"]`; `current.typeSpace()`; `provider.getSuggestions(["National "], 0, 9, opts())` → `prefix === ""`, top item is the store-driven successor display (`store.get(store.topSuccessors("national")[0].next).display` — never hardcode casing); accept it → armed at `{ word: "renewable" }`; space; offer → `Energy`-display top; accept → armed `energy`; space; offer → `Laboratory`-display top; accept. Final buffer `["National Renewable Energy Laboratory"]`-equivalent via display lookups; final `chain.state()` is `{ word: "laboratory" }` (laboratory has no recorded successors — assert the machine's actual final state: if the machine disarms at a successor-less tail, assert `null`; read `src/pi/provider.ts` chain behavior and the zephyr test's "rests armed" comment first, and match reality). Assert every offer had `prefix ""` at zero typed chars, every chain menu is single-word (`items.every(i => !i.value.includes(" "))`), `assertWordsOnly` on every `rankMatches` output, and `current.getSuggestions` never called (hapax answered everything — no delegation mid-chain).
3. **DO NOT** touch the zephyr item-7 tests, `expected.md` (the NREL fixture is not part of the expected.md label surface — do not add labels), calibration/shipped-dict/adversarial suites, or `spec/*.md`.

### Success Criteria

- [ ] `test/fixtures/sessions/nrel-chain.jsonl` exists with the three PRD sentences, ≥3 phrase occurrences, valid `parseSessionFixture` shape
- [ ] Sanity test: all four words stored; deterministic top-successor chain national→renewable→energy→laboratory; `'na'` top is National
- [ ] Chain test: full phrase completed with zero typed word-chars (spaces only), every offer at prefix `""`
- [ ] `assertWordsOnly` applied; no delegation during the chain; `npm test` + `npm run check` green
- [ ] Nothing outside `nrel-chain.jsonl` + the new describe block changed

## All Needed Context

### Context Completeness Check

An implementer who knows nothing else needs: the fixture file format, the exact existing harness (all helpers are file-local in acceptance.test.ts), the upstream relief-band contract from S1/S2, and the store API (`get`, `topSuccessors`, `recordBigramRuns`). All below.

### Documentation & References

```yaml
- file: test/acceptance.test.ts
  why: THE pattern to copy — the item-7 zephyr describe block (search
        "acceptance item 7") contains makeChainPipeline, replayChain,
        editingCurrent, expectSingleWordItems, the arm→space→offer→accept
        loop, and all assertions to mirror. Also item 1's rankMatches/
        extractMatchState usage and the header conventions.
  pattern: ingest fixture via replayChain(makeChainPipeline(true).pipeline,
            parseSessionFixture(...)); drive the provider; assert
            store-driven (never hardcoded) successor displays.
  gotcha: helpers are file-LOCAL — do not re-import; reuse as-is. Reuse
            editingCurrent's typeSpace() for the separating spaces.

- file: test/fixtures/sessions/zephyr-chain.jsonl
  why: The fixture shape to clone: session header line, then message
        entries with role/content[{type:"text",text}]/id/parentId/timestamp.
  gotcha: extractText must return non-null for the message contents (plain
            text blocks — no reasoning/tool parts).

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M2T1S1/PRP.md
  why: The relief-band contract: PROPER_NOUN_ADMIT_CEILING (default 120,
        interval 94 < ceiling ≤ 156) in src/core/score.ts; capitalized
        dictionary-attested whole tokens with q < ceiling admit at group 2.
        national=90, energy=94, laboratory=57 all admit under it.
  critical: energy q=94 requires ceiling > 94 STRICTLY; S2 may have tuned
            the final value within (94,156] — do NOT hardcode 120 anywhere;
            the test must not reference the constant at all (it asserts
            outcomes: store.get(...) defined).

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M2T1S2/PRP.md
  why: The tuning-protocol contract that validated the ceiling — its run
        notes (score.ts JSDoc) record the final value; this item's test is
        the pin that makes the next retune fail loudly.

- file: src/core/store.ts
  why: CandidateStore API: get(key) → entry|undefined, topSuccessors(word)
        → [{next, count}], recordBigramRuns(lines), bigramSize, size.
  gotcha: chain state arms at the LOWERCASE key (see zephyr test:
            chain.state() === { word: "acme" } after accepting "Acme").

- file: src/core/query.ts
  why: rankMatches(store, fragment) → RankedMatch[] (display, key).
  pattern: item-1 tests: expect(matches[0].display).toBe("Zendesk") — the
            display is the exact cased insertion string.

- file: test/helpers/query-invariants.ts
  why: assertWordsOnly(matches, fragment) — the one-word invariant helper
        (already imported by acceptance.test.ts).

- file: src/core/dictionary.ts + src/pi/paths.ts
  why: loadDictionary(resolveDictPath()) — the SHIPPED dict/common-en.bin;
        q values: national 90, energy 94, laboratory 57, renewable 19
        (PRD h3.1 — the relief band admits the first three; renewable
        already admitted pre-fix).

- file: spec/09-testing-and-acceptance.md (line ~109)
  why: The verbatim DoD-M2 item-7 sentence the test encodes. READ-ONLY.
```

### Current Codebase tree (relevant)

```bash
test/acceptance.test.ts                      # EXTEND: new NREL describe block
test/fixtures/sessions/                      # ADD nrel-chain.jsonl; expected.md untouched
src/core/score.ts                            # relief band (S1) — read-only here
plan/.../P1M2T1S1/PRP.md, P1M2T1S2/PRP.md    # upstream contracts (read)
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: assert successor displays STORE-DRIVEN:
//   const d = store.get(store.topSuccessors("national")[0]!.next)!.display;
// never hardcode "Renewable"/"Energy"/"Laboratory" as expectations of the
// OFFER (rankMatches(store,"na")[0].display === "National" IS fine — it is
// the PRD's own assertion).

// GOTCHA: the chain arms at the lowercase key: after accepting "National",
// chain.state() === { word: "national" }.

// GOTCHA: every zero-char offer must assert prefix === "" and that the
// harness typed only spaces (typeSpace) between accepts — that IS the
// "zero additional typed chars" requirement; assert
// current.getSuggestions was NEVER called during the chain.

// GOTCHA: 'na' menu may contain other admitted na-words depending on the
// fixture's surrounding prose — assert National is TOP (matches[0]) and
// optionally the exact list if your fixture is clean; prefer
// expect(matches[0]!.key).toBe("national") plus assertWordsOnly.

// GOTCHA: the zephyr test notes the chain "rests armed" when the final word
// has successors. laboratory is the tail (no successor recorded in the
// fixture) — read src/pi/provider.ts's chain machine to see whether a
// successor-less armed word disarms or stays armed, and assert what it
// actually does; do not guess.

// GOTCHA: the fixture's surrounding prose words become store candidates —
// keep them common (the, visit, today...) so they reject and cannot
// contaminate the 'na' menu or successor lists.

// GOTCHA: BIGRAM adjacency is between ADMITTED whole tokens in a run —
// "The National Renewable..." still yields national→renewable because runs
// are recorded over admitted tokens (renewable already admitted; the three
// target words admitted under the relief band). Verify in the sanity test
// with exact topSuccessors equality (count = your fixture's occurrences,
// e.g. [{ next: "renewable", count: 3 }] — count whatever your fixture
// actually produces, mirroring the zephyr sanity test's exact-array style).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE test/fixtures/sessions/nrel-chain.jsonl
  - FORMAT: clone zephyr-chain.jsonl entry shape (session header + ~6
    message entries, alternating user/assistant, plain text content)
  - CONTENT: the three PRD sentences verbatim, each once (or the phrase
    recurring ≥3 times across messages), embedded in natural sentences
  - CONSTRAINT: surrounding vocabulary = common lowercase words only

Task 2: ADD describe "acceptance item 7 — NREL phrase" (or extend the item-7
        section) in test/acceptance.test.ts
  - TEST A (sanity): replayChain over the fixture; store.get for all four
    words defined (BUG-002 inverted); exact topSuccessors arrays; 'na'
    top is national/National; assertWordsOnly; bigramSize > 0
  - TEST B (zero-typing chain): copy the zephyr zero-typing test flow with
    na→National arming; three space+offer+accept hops; prefix "" on every
    offer; store-driven display assertions; single-word items; no
    delegation; final buffer and final chain state asserted

Task 3: VALIDATE — npx vitest --run test/acceptance.test.ts, then npm test,
        npm run check; confirm zephyr item-7 tests untouched and green
```

### Implementation pattern

```typescript
// Core flow (mirrors the zephyr zero-typing test — see file for the full idiom):
const entries = parseSessionFixture(`${FIXTURES}/nrel-chain.jsonl`);
const { store, pipeline } = makeChainPipeline(true);
const current = editingCurrent();
const chain = createChainMachine();
const provider = createHapaxProvider(store, cfg(), current, chain);
await replayChain(pipeline, entries);

// BUG-002 inverted — the four words of the phrase are in the store:
for (const w of ["national", "renewable", "energy", "laboratory"])
  expect(store.get(w), w).toBeDefined();

const menu = rankMatches(store, "na");
expect(menu[0]!.key).toBe("national");
expect(menu[0]!.display).toBe("National");
assertWordsOnly(menu, "na");

// Arm, then hop with ONLY separating spaces:
provider.applyCompletion(["na"], 0, 2, { value: menu[0]!.display, label: menu[0]!.display }, "na");
expect(chain.state()).toEqual({ word: "national" });
current.typeSpace();
const offer = await provider.getSuggestions(current.state.lines, 0, current.state.cursorCol, opts());
expect(offer?.prefix).toBe("");
const succ = store.topSuccessors("national")[0]!; // { next: "renewable", count: N }
const succDisplay = store.get(succ.next)!.display;
expect(offer?.items[0]!.value).toBe(succDisplay);
// …accept → space → offer → accept → space → offer → accept, asserting
// chain.state() re-arms at "renewable" then "energy"; end at "laboratory".
expect(current.getSuggestions).not.toHaveBeenCalled(); // no delegation in-chain
```

### Integration Points

```yaml
NONE structural:
  - Output (green pinned test) consumed by P1.M4.T1.S1 full-suite regression
  - No source changes; no spec/*.md changes (READ-ONLY); no expected.md changes
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check    # tsc + lint, zero errors
```

### Level 2: The new tests

```bash
npx vitest --run test/acceptance.test.ts -t "NREL" -v   # or the new describe name
npx vitest --run test/acceptance.test.ts -v             # whole file green
```

### Level 3: Full-suite regression

```bash
npm test        # all 600+ tests green; zephyr item-7 tests unchanged
```

### Level 4: Behavioral audit

- Read the run: every offer printed/asserted at prefix `""`; the four words stored; chain hops renewable→energy→laboratory all store-driven
- Confirm the tripwire property: reverting the relief band mentally maps to `store.get('national') === undefined` → TEST A fails (that is the point)

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` and `npm test` green; only acceptance.test.ts + nrel-chain.jsonl differ
- [ ] Zephyr item-7 tests, expected.md, calibration/shipped-dict/adversarial suites untouched

### Feature Validation

- [ ] All four phrase words stored (BUG-002 assertion inverted); topSuccessors chain national→renewable→energy→laboratory exact
- [ ] `rankMatches('na')` top is National; accepted; full phrase completed with zero typed word-chars
- [ ] Every chain offer at prefix `""`; assertWordsOnly on all menus; no delegation during the chain

### Code Quality Validation

- [ ] Successor display expectations store-driven, not hardcoded
- [ ] Fixture format valid for parseSessionFixture; surrounding prose common-only
- [ ] No hardcoded PROPER_NOUN_ADMIT_CEILING value anywhere in the tests

## Anti-Patterns to Avoid

- ❌ Don't re-implement the harness — every helper already exists file-local in acceptance.test.ts
- ❌ Don't hardcode successor casing/displays — read them from the store
- ❌ Don't edit expected.md, spec/*.md, or sibling suites to accommodate anything
- ❌ Don't skip the "no delegation during the chain" and prefix-"" assertions — they ARE the acceptance semantics

**Confidence Score: 9/10** — the harness, store API, fixture format, q-value table, and upstream relief-band contract are all pinned to verified files; the only open variable (exact successor counts / final chain state at a successor-less tail) is resolved by reading the machine and asserting measured reality.
