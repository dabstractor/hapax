# PRP — P1.M1.T2.S2 (bugfix 001_0f4b641cf9ce): Editor-sim integration test — trigger consumption and one-word invariant during chains

---

## Goal

**Feature Goal**: Lock the BUG-005 fix (P1.M1.T2.S1) end-to-end with
editor-level integration tests: while a chain is armed, `x alphaone #b`
must be answered in **trigger mode** at prefix `'#b'`, and accepting the
returned item through the editor-sim's faithful pi-tui `applyCompletion`
(blind `prefix.length` deletion) must yield exactly `'x alphaone betaword'`
— `#` AND `b` consumed, no residue. Also assert the one-word invariant
(h2.44) on every item returned during chain contexts, assert accepting
re-arms the chain on the accepted word, and re-verify the BUG-001 slash
flow at the sim level (Tab-equivalent forced call on `'/re'` returns the
stock sentinel, never hapax items).

**Deliverable**: New integration coverage in `test/chain.test.ts` (or a
sibling `test/chain-editor-sim.test.ts` following its conventions) using
`test/helpers/editor-sim.ts` (`editorApplyCompletion`, `prefixIsAnchorSafe`),
`assertWordsOnly`/single-word item checks, real ingest, and a mocked `current`
provider ONLY.

**Success Definition**: `npm test` + `npm run check` green; the BUG-005
repro steps from PRD h3.4 pass at the editor-buffer level; P1.M4.T1.S1
consumes this regression net.

## Why

- BUG-005's user-visible damage was buffer corruption: pi-tui's
  `applyCompletion` deletes exactly `prefix.length` chars blindly, so a
  chain answer at prefix `'b'` for buffer text `#b` strands the `#`
  (`…#betaword`). Unit tests on the provider alone don't prove the buffer
  math; only an editor-sim assert does.
- The one-word invariant (PRD §07 h2.44) must hold in every menu state —
  especially chain contexts — and needs a permanent regression gate.
- BUG-001's slash mitigation (P1.M1.T1.S2, landed) deserves a sim-level
  end-to-end pin so the "Tab never opens the hapax menu in slash contexts"
  invariant can't silently regress.

## What

Add to `test/chain.test.ts` (new describe, existing helpers) — or a sibling
file importing the same helpers — three integration cases:

1. **Trigger consumption e2e (BUG-005 h3.4 Steps to Reproduce)**: real-ingest
   `'alphaone betaword gamma\nalphaone deltaword epsilon'`; arm on
   `'alphaone'` via whole-word Tab acceptance; `getSuggestions` at end of
   `'x alphaone #b'` → prefix `'#b'`; every item single-word; accepting the
   item through `editorApplyCompletion('x alphaone #b', 14, value, '#b')`
   yields exactly `'x alphaone betaword'`; `chain.state()` becomes
   `{ word: 'betaword' }` (re-armed on the accepted word).
2. **One-word invariant during chains**: zero-typed-char offer, word-start
   fragment filter, and the post-accept offer all return only single-word
   items.
3. **BUG-001 slash flow at sim level**: Tab-equivalent forced call on
   `'/re'` returns the stock sentinel (delegation), never hapax items.

Mock: `current` only. Everything else real (store, ingest, dictionary, chain
machine, provider).

### Success Criteria

- [ ] Case 1: prefix `'#b'`, buffer result `'x alphaone betaword'` exactly, chain re-armed on accepted word
- [ ] `prefixIsAnchorSafe` asserted before every sim apply
- [ ] All chain-context results single-word
- [ ] `'/re'` forced call → stock sentinel, zero hapax items
- [ ] Only `current` is mocked; `npm test` + `npm run check` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they implement this
successfully?" — Yes: the editor-sim and query-invariants helper APIs, the
chain.test.ts helper inventory (verified signatures), the ingest fixture
route, cursor arithmetic, and the upstream provider contract are all
reproduced below.

### Documentation & References

```yaml
- docfile: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/provider-tui-integration.md
  why: pi-tui applyCompletion blind-deletion semantics + armed-branch map.
- docfile: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/system_context.md
  section: BUG-005 / BUG-001
  why: repro steps this test formalizes.

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M1T2S1/PRP.md
  why: CONTRACT (parallel, in flight): armed branch requires word-start
        fragments; non-word-start → chain.reset() + fall-through so
        extractMatchState answers in trigger mode at '#b'. Its own unit
        cases (makeStack/armViaTab level) are DISTINCT from these
        editor-sim integration cases — no duplication.
- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M1T1S2/PRP.md
  why: CONTRACT (Complete): classifyStockContext gate runs before the
        armed branch — '/re' delegates; case 3 pins it at sim level.

- file: test/helpers/editor-sim.ts
  why: VERIFIED exports:
        editorApplyCompletion(line, cursorCol, itemValue, prefix): string
          — pi-tui's exact math: before = line.slice(0, cursorCol -
          prefix.length); return before + itemValue + after.
        prefixIsAnchorSafe(line, cursorCol, prefix): boolean
          — line.slice(0, cursorCol).endsWith(prefix).
- file: test/helpers/query-invariants.ts
  why: assertWordsOnly(matches, label?) — takes RankedMatch. For provider
        AutocompleteItem[] results use chain.test.ts's existing local
        expectSingleWordItems (or assert !i.value.includes(" ") directly).
- file: test/chain.test.ts
  why: VERIFIED helper inventory:
        makeStack(store, current) → { chain, inner }
        armViaTab(inner, chain, store, word, fragment, seed?) — only
          production arming path; seed callback runs AFTER menu snapshot
        suggest(provider, lines, cursorLine, cursorCol)
        editingCurrent(initial?, cursorCol?) (L648+) — persistent-buffer
          current mock whose applyCompletion performs pi-tui insertion and
          updates state; typeSpace() inserts a space
        makeChainPipeline(true) + replayChain(pipeline, entries) +
        parseSessionFixture(path) — real-ingest route (zephyr-chain
          describe at L678 is the style exemplar)
        item(word) — AutocompleteItem factory
- file: test/fixtures/sessions/zephyr-chain.jsonl
  why: fixture exemplar for the real-ingest route; the new test ingests
        inline text ('alphaone betaword gamma\nalphaone deltaword epsilon')
        via pipeline.processText instead of a fixture file — verify
        makeChainPipeline's dictionary wiring admits alphaone/betaword/
        deltaword (rare, group 0/1); if it uses the shipped dict these
        nonsense words are absent → group 0, admits. Confirm at write time.
```

### Current Codebase tree (relevant)

```bash
src/pi/provider.ts         # corrected armed branch (S1, in flight)
test/chain.test.ts         # add the integration describe here (or sibling)
test/helpers/{editor-sim,query-invariants}.ts   # exist — consume, don't modify
```

### Desired Codebase tree

```bash
test/chain.test.ts   # + describe "editor-sim integration — trigger consumption & one-word invariant (BUG-005/BUG-001)"
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// Cursor math: "x alphaone #b".length === 14 (suggest at (["x alphaone #b"], 0, 14)).
// editorApplyCompletion does NO validation — assert prefixIsAnchorSafe FIRST;
// the sim's whole value is modeling exactly what pi would produce.

// GOTCHA: distinguish this task from S1's unit cases: S1 uses makeStack +
// armViaTab and asserts provider return values; THIS task drives a
// persistent buffer (editingCurrent-style or raw editorApplyCompletion
// calls) and asserts resulting LINE TEXT + chain re-arming.

// GOTCHA: re-arming — the chain arms on whole-word Tab acceptance of a
// hapax item; accepting 'betaword' must set chain.state() === { word: "betaword" }.

// GOTCHA: '/re' forced path: pi-tui calls with force:false + explicitTab in
// slash contexts; the provider forwards to current (delegation). Assert the
// returned value is the current mock's sentinel/applyCompletion result and
// that no hapax items appear — mirror chain.test.ts L421-439's delegation
// assertions (ret === current.applyCompletion.mock.results[0].value).

// NodeNext: .js import extensions; vitest vi.fn for current only.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: ADD describe to test/chain.test.ts
  - SETUP (shared, in a beforeAll-style or per-case): const { store, pipeline }
    = makeChainPipeline(true); await pipeline.processText(
    "alphaone betaword gamma", false); await pipeline.processText(
    "alphaone deltaword epsilon", true); (match the real processText
    signature; alternately replayChain with an inline entries array if the
    fixture parser accepts constructed entries).
  - Current mock: editingCurrent()-style persistent buffer, or plain
    makeCurrent + raw editorApplyCompletion math for the line assertions.
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg(), current, chain);

  - CASE 1 "trigger char during an armed chain is consumed by completion (BUG-005 e2e)":
      a. Arm: const menu = await suggest(provider, ["al"], 0, 2);
         expect(menu.items.map(i=>i.value)).toContain("alphaone");
         provider.applyCompletion(["al"], 0, 2, alphaoneItem, "al");
         expect(chain.state()).toEqual({ word: "alphaone" });
      b. const line = "x alphaone #b";
         const r = await suggest(provider, [line], 0, 14);
         expect(r?.prefix).toBe("#b");
         expect(chain.state()).toBeNull();               // reset by '#'
         singleWord(r.items);                            // invariant pre-accept
         expect(prefixIsAnchorSafe(line, 14, "#b")).toBe(true);
      c. const out = editorApplyCompletion(line, 14, r.items[0].value, r.prefix);
         expect(out).toBe("x alphaone betaword");        // '#'+b consumed
         (If the trigger-mode top item is a different stored 'b'-word,
          assert the exact item deterministically: seed the store so
          'betaword' is the only b-prefixed admitted word, or assert
          /^x alphaone \w+$/ + no '#' residue + document.)
      d. Re-arm: provider.applyCompletion([line], 0, 14, r.items[0], r.prefix);
         expect(chain.state()).toEqual({ word: r.items[0].value.toLowerCase() });

  - CASE 2 "one-word invariant holds across chain-context menus":
      arm on alphaone; then for each state — zero-char offer
      (suggest(["x alphaone "], 0, 12) → prefix ""), word-start filter
      (["x alphaone be"], 0, 14), and the post-accept offer — assert
      every item single-word (expectSingleWordItems or per-item
      !value.includes(" ")), plus assertWordsOnly on a direct
      rankMatches(store, "al") RankedMatch result for the invariant helper.

  - CASE 3 "slash flow: forced Tab on '/re' returns the stock result, never hapax (BUG-001 sim)":
      current = editingCurrent(["/re"], 3)-style; const r = await
      provider.getSuggestions(["/re"], 0, 3, opts({ force: false, explicitTab: true }))
      (match the actual options shape used by chain.test.ts's forced-path
      cases); expect(r).toBe(stockResult / current delegation result);
      expect(hapax items absent — no description "session x…" / "chain").

Task 2: VALIDATE
  - npx vitest --run test/chain.test.ts
  - npm test && npm run check
  - Negative check (prove the net bites): temporarily revert the S1 guard
    mentally/via git — case 1's prefix assertion ('#b' vs 'b') and the
    buffer assertion ('x alphaone betaword' vs 'x alphaone #betaword') are
    exactly the pre-fix failure signatures (do not commit the revert).
```

### Implementation Patterns & Key Details

```ts
// The corruption detector — this line is the whole point of the task:
expect(editorApplyCompletion("x alphaone #b", 14, r!.items[0]!.value, r!.prefix))
  .toBe("x alphaone betaword");
// Pre-fix (prefix "b"): produces "x alphaone #betaword" — the stranded '#'.

// Anchor-safety contract before every sim apply:
expect(prefixIsAnchorSafe(line, cursorCol, r!.prefix!)).toBe(true);
```

### Integration Points

```yaml
CONSUMES (read-only):
  - src/pi/provider.ts corrected armed branch (S1, in flight)
  - classifyStockContext gate (T1.S2, landed)
  - test/helpers/editor-sim.ts, test/helpers/query-invariants.ts
DOWNSTREAM:
  - P1.M4.T1.S1 full regression sweep includes these cases
FROZEN:
  - all src/ files; the two helpers (consume, don't modify)
```

## Validation Loop

### Level 1–2

```bash
npm run check
npx vitest --run test/chain.test.ts
npm test
```

### Level 3: Net bites

```bash
# Case 1 must fail against the pre-fix provider (prefix "b", buffer
# "x alphaone #betaword") — the PRD h3.4 repro signatures.
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green
- [ ] `'#b'` → prefix `'#b'`, chain idle, buffer `'x alphaone betaword'`, re-armed on accepted word
- [ ] `prefixIsAnchorSafe` asserted before sim applies
- [ ] All chain-context menus single-word; `assertWordsOnly` used for RankedMatch output
- [ ] `'/re'` forced call → stock sentinel, no hapax items
- [ ] Only `current` mocked; real ingest for the store
- [ ] No src/ or helper modifications; no duplication of S1's unit cases

## Anti-Patterns to Avoid

- ❌ Asserting only provider return values — the deliverable is BUFFER TEXT
- ❌ Skipping `prefixIsAnchorSafe` — without it the sim models nothing
- ❌ Mocking the store/ingest — the point is end-to-end (real pipeline)
- ❌ Duplicating S1's makeStack-level unit cases verbatim — this is the
  editor-level layer above them
- ❌ Depending on which b-word tops the menu without seeding — make the
  expected item deterministic
- ❌ Modifying editor-sim.ts/query-invariants.ts to fit the test

---

**Confidence Score: 8/10** — helper APIs and conventions are verified
against live source; the one open detail (exact expected top item in the
`#b` menu, and the exact forced-call options shape) is resolved by the
documented seed-first / read-the-existing-forced-case instructions.
