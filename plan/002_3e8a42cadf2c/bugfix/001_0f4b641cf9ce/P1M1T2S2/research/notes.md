# Research notes — P1.M1.T2.S2 (bugfix 001_0f4b641cf9ce): editor-sim integration test (trigger consumption + one-word invariant during chains)

## Upstream contract (P1.M1.T2.S1, in flight — assume exact)
- src/pi/provider.ts armed branch gains the BUG-005 word-start guard:
  fragment not at a word start → chain.reset() + fall-through to
  extractMatchState (trigger mode answers at prefix "#b"). No empty returns.
- Stock-context gate (P1.M1.T1.S2, Complete) runs before the armed branch:
  slash '/re' already delegates; our '#b' case tests trigger-mode fall-through.

## Verified codebase facts
- test/helpers/editor-sim.ts EXISTS: `editorApplyCompletion(line, cursorCol,
  itemValue, prefix)` = pi-tui's blind `prefix.length` deletion verbatim
  (`before = line.slice(0, cursorCol - prefix.length); before+value+after`),
  and `prefixIsAnchorSafe(line, cursorCol, prefix)` (suffix check). Dependency-
  free, exported for cross-suite reuse.
- test/helpers/query-invariants.ts EXISTS: `assertWordsOnly(matches, label?)`
  over RankedMatch. chain.test.ts also has a local `expectSingleWordItems`
  for AutocompleteItem[] (chain items) — items from getSuggestions are
  AutocompleteItem; assertWordsOnly takes RankedMatch. For provider-level
  items use expectSingleWordItems-style checks or map; simplest: assert
  `!i.value.includes(" ")` per item (mirroring existing helper).
- test/chain.test.ts conventions (verified):
  - `makeStack(store, current)` → { chain, inner } where inner wraps provider.
  - `armViaTab(inner, chain, store, word, fragment, seed?)` — only production
    arming path; seeds successors AFTER menu snapshot via seed callback.
  - `suggest(provider, lines, cursorLine, cursorCol)` helper.
  - `editingCurrent(initial, cursorCol)` (L648+): persistent-buffer mock with
    applyCompletion performing pi-tui insertion and typeSpace() — this IS the
    editor-sim at the current-provider level; for direct line math use
    editorApplyCompletion.
  - `makeChainPipeline(true)` + `replayChain(pipeline, entries)` +
    `parseSessionFixture(path)` — real-ingest route (zephyr-chain.jsonl
    fixture pattern, L678+ describe).
  - ingest fixture words per item contract: 'alphaone betaword gamma\n
    alphaone deltaword epsilon' — feed via pipeline.processText (real
    IngestPipeline + dictionary) or store.recordBigramRuns + put(); item says
    "ingest", so use makeChainPipeline/replayChain-style real ingest.
- BUG-001 slash flow: '/re' at line start → classifyStockContext delegates →
  current (mock) sentinel; never hapax items. Forced (Tab-equivalent) call
  with force:false + explicitTab path returns stock sentinel (provider
  forwards to current.applyCompletion — see L421-439 delegation case).

## Test design
- New describe in test/chain.test.ts (or sibling test/chain-editor-sim.test.ts
  following its conventions — prefer extending chain.test.ts, the item allows
  either; choose whichever keeps file size sane).
- Case A (BUG-005 e2e): real ingest of the two lines; arm on 'alphaone'
  (Tab via provider.applyCompletion on menu item from 'al'); build line
  'x alphaone #b'; r = suggest; assert prefix '#b'; assert
  prefixIsAnchorSafe('x alphaone #b', 14, '#b'); apply accepted item through
  editorApplyCompletion('x alphaone #b', 14, value, '#b') → 'x alphaone
  betaword' EXACTLY (no '#', no 'b' residue). Assert every returned item is
  single-word. Assert accepting re-arms the chain on the accepted word:
  provider.applyCompletion → chain.state() === {word: accepted-lowercase}.
- Case B: one-word invariant across chain-context menus (zero-char offer,
  word-start filter, post-accept offer) — assertSingleWordItems each.
- Case C: BUG-001 slash re-verify at sim level: '/re' forced/explicitTab
  call → stock sentinel (current.getSuggestions/applyCompletion result),
  never hapax items.
- Mock ONLY `current`.

## Gotchas
- '#b' cursor col: 'x alphaone #b'.length = 14.
- Dictionary: makeChainPipeline wires a real dict (synthetic or shipped) —
  alphaone/betaword/deltaword must ADMIT (rare); check helper's dict source
  and, if it uses buildDictBinary, ensure these words absent/low-quant.
- Re-arm check: chain arms on whole-word Tab acceptance of a hapax item;
  accepting 'betaword' (a stored word) re-arms on 'betaword'.
- NodeNext .js imports; vitest vi.fn for current.
