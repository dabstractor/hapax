# Research notes — P1.M2.T1.S2 (plan 002): chain.test.ts rewrite + integration item 7

## Current state of test/chain.test.ts (verified 2026-09-07, post P1.M1.T3.S3 partial pruning)
- 16 `it()` cases: starts-idle, (1) arm from hapax word, (2) path completion never arms, (4) 1-char fragment → "threshold 1" successor menu, (5) filtering, (6) zero matches disarm, (7) empty successor index disarm, (8) word-less state, (9) successor accept re-arms + verbatim delegation, (10) reset(), (11) trigger-mode arms, (12) display classification + 100ms debounce. Plus 2nd describe at ~499 "bare-word arming on a replayed store (BUG-005 part 2 successor route)".
- Case (3) "phrase item arms at LAST word" is ALREADY GONE (phrase layer deleted by P1.M1.T2). The describe "phrase acceptance arms the chain" is likewise already collapsed to the single bare-word `it` at 499–500 — only stale naming/comments remain.
- Bigram seeding already goes through `store.recordBigramRuns` (lines 129, 142–143, 345, 439) — the item description's `recordPhraseLines` references (134, 147–148, 372, 466) are STALE inventory numbers; the seam has moved. Verify with `grep -n recordPhraseLines test/chain.test.ts` (expect nothing).
- Remaining phrase-era residue to purge in the rewrite: header comment (lines 17–26 "phrase upsert ... #upsertPhrase"), `makeNrelPipeline` JSDoc (~417–431) saying the successor index "exists ONLY under enablePhrases", describe name "BUG-005 part 2", and case (4)'s "threshold 1" language.
- Helpers present and reusable: `makeStack(store, current)` → {chain, inner, provider}; `suggest(p, lines, line, col)`; `armViaTab(inner, chain, store, word, fragment, seed?)`; `makeCurrent()` (contract-shaped mock with pi-tui-faithful applyCompletion); `editingCurrent()` in acceptance.test.ts (pi-tui insertion on persistent buffer state); `put(s, key, n)`, `cfg(over)`, `opts()`.

## Upstream contract (P1.M2.T1.S1 PRP — assume delivered exactly)
- Zero-char offer at EVERY armed word start: `before === "" || /[ \t]$/.test(before)` → unfiltered `store.topSuccessors(armed.word)` (≤ maxSuggestions), BARE single-word values, `prefix: ""`, description "chain", lastLive published with prefix "" and CHAIN_KEY_PREFIX live keys.
- Typed fragment: threshold 0 (never consults config.threshold), filters successors by `startsWith(frag.toLowerCase())`.
- Disqualification (same keystroke): punctuation/word-less non-start/zero matches/no successors → `chain.reset()` + fall through to normal path/delegation.
- ChainMachine slimmed to `{state, arm, reset}` — `consumePending`/`pending` gone.
- applyCompletion: CHAIN_KEY_PREFIX branch → arm(bare word); whole-word branch arms (incl. trigger mode); verbatim delegation; config.enablePhrases still the gate (rename is P1.M3.T1.S1).

## Integration item 7 (test/acceptance.test.ts ~546–end)
- Existing: describe "acceptance item 7 — chained completion, zero typed characters (nrel.jsonl)" with (a) fixture sanity test (successor chain national→renewable×4/wind×1, renewable→energy×4, energy→laboratory×4; word admissions; menu probes) — SOLID, keep, maybe extend with assertWordsOnly; (b) "zero-typing chain" test that currently references the PENDING OFFER — must be rewritten for the word-start offer: after Tab accepts "National", the user types ONE space (separator, zero word-chars), getSuggestions on ["National "] must offer renewable as top item with prefix "".
- Fixture: test/fixtures/sessions/nrel.jsonl; helpers parseSessionFixture + asSessionManager; makeNrelPipeline + replayNrel defined in acceptance.test.ts.
- Editing harness note: acceptance.test.ts's editingCurrent() starts buffer "natio"; for the zero-char route the harness must also model the user's separating space (advance cursorCol after a simulated space keystroke) — the provider's plain applyCompletion adds NO trailing space (external_deps §2a).

## One-word invariant helper
- test/helpers/query-invariants.ts `assertWordsOnly(matches: RankedMatch[], label?)` — consumes rankMatches output. Chain items are AutocompleteItem, not RankedMatch: assert `item.value` contains no space directly in the chain suite (and via live lastLive displays), and use assertWordsOnly on rankMatches calls inside item 7.

## Related suites that must stay green (untouched by this task)
- test/provider.test.ts (verbatim-delegation pins, never-hijack a–g) — DO NOT TOUCH.
- test/successors.test.ts (P1.M1.T3.S3, in progress → assume green).
- test/provider-display.test.ts (case 12 composes against its fake timers; display classifier unchanged by S1).

## Commands
- npm run check (tsc --noEmit), npm test (vitest --run), targeted: npx vitest --run test/chain.test.ts test/acceptance.test.ts -v.