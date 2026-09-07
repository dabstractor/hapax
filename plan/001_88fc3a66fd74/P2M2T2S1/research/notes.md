# Research notes — P2.M2.T2.S1 (armed(W) chain machine)

## Codebase facts (verified)

- `src/pi/provider.ts` (417 lines): S1 extractMatchState (pure), S2 createHapaxProvider
  (live query, `lastLive` cache, `liveKeyByValue` Map value→key, `__hapaxLive`/`__hapaxKey`
  seams), S3 createDisplayProvider (100ms debounce + hysteresis, `dispose()`).
- `createHapaxProvider.applyCompletion` currently delegates verbatim to `current.applyCompletion`
  — the seam where Tab acceptance is detectable (pi passes the accepted `item`; check
  `liveKeyByValue.get(item.value)` to know it was a hapax item).
- `src/pi/index.ts`: `before_agent_start` handler exists as explicit no-op stub with comment
  "the chain-reset machine lands in P2.M2.T2.S1". Provider stack built inside
  `ctx.ui.addAutocompleteProvider((current) => createDisplayProvider(createHapaxProvider(...)))`.
- Config (`src/pi/config.ts`): threshold default 2 (1–3), `enablePhrases` default true,
  maxSuggestions 8, triggerChar "#".
- Never-hijack suite: `test/provider.test.ts` `describe("never-hijack acceptance (PRD §07)")`
  cases (a)–(g); case (b) asserts applyCompletion forwards verbatim and passes through
  current's return — chain interception must still return `current.applyCompletion(...)`'s
  result unchanged (only add side-effect arming before delegating). Case (f) asserts
  provider surface shape — don't break it.
- Store contract from P2.M2.T1.S1 PRP (assume implemented): `topSuccessors(word): readonly Successor[]`
  with `Successor = { next: string; count: number }`, lowercase keys, ≤3 entries, empty
  frozen constant for misses. Phrases/`enablePhrases` gating of *chaining* is P2.M2.T3.S1.
- Display layer classifies hapax result via `__hapaxLive()` prefix match — successor sets
  returned from getSuggestions must publish lastLive (prefix = typed fragment) to enter
  the debounce machine, OR bypass: simplest is publish lastLive with the successor matches
  so armed-set swaps follow the same 100ms rules automatically.
- Successor index is lowercase; stored item display may be cased (h2.27) — normalize with
  `.toLowerCase()` when arming and when filtering successors by fragment.

## Key design decisions

1. Chain state as a small exported class/factory `createChainMachine(store)` in provider.ts;
   returned handle has `state()`, `arm(word)`, `disarm()`, `reset()`. index.ts creates it,
   passes it to createHapaxProvider (new optional param), and calls `reset()` in
   `before_agent_start` (event has `prompt` field — validated in PRD §07).
2. Arming: intercept in createHapaxProvider.applyCompletion — if `liveKeyByValue.get(item.value)`
   exists AND the mapped key has no space (whole-word candidate, incl. trigger-mode items)
   → `chain.arm(item.value.toLowerCase())`. Then delegate verbatim as today.
3. Armed suggestions: in getSuggestions, BEFORE normal extractMatchState threshold path —
   if armed and a trailing identifier fragment of length ≥1 exists at word start, look up
   `store.topSuccessors(armedWord)`, filter `s.next.startsWith(fragment.toLowerCase())`,
   map to items (value = s.next, provenance-ish description), publish lastLive so display
   debounce applies. No matches / no successors → disarm → normal path (threshold 2).
4. Disarm triggers: extractMatchState null (space/punct/escape→delegate path), zero successor
   matches, before_agent_start reset, session_shutdown (provider discarded anyway).
5. Tab on successor item: register successor values in liveKeyByValue with a marker so
   applyCompletion arms the *next* word (armed(next)) — transition on accept.