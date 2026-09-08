# Research notes — P1.M2.T1.S1 (plan 002): chain machine + provider armed branch redesign

## Verified codebase facts
- `src/pi/provider.ts` (771 lines), read lines 200–500:
  - Armed branch (239–316): pending one-shot via `chain.consumePending()` + `before.toLowerCase().endsWith(armed.word)` → unfiltered `store.topSuccessors(armed.word).slice(0, config.maxSuggestions)` with **leading-space values** `value: ` ${s.next}`` (line ~254), `liveKeyByValue.set(` ${s.next}`, CHAIN_KEY_PREFIX+s.next)` (~280), returns `{items, prefix: ""}`, publishes `lastLive.prefix === ""`.
  - Fragment path (292–316): `before.match(/[A-Za-z][A-Za-z0-9_]*$/)` → filter `s.next.startsWith(frag.toLowerCase())`; `frag === undefined || succ.length === 0` → `chain.reset()` + fall through to normal path; else bare values, `prefix: frag`.
  - applyCompletion (351–400): gated `if (config.enablePhrases)`; three key shapes: CHAIN_KEY_PREFIX (re-arm next), non-space key (arm whole word lowercase), space-joined key (arm phrase LAST word — phrase case must be DELETED, query.ts is words-only since P1.M1.T2.S2).
  - ChainMachine (409–498): `CHAIN_KEY_PREFIX = "\u0000chain:"`, `ChainState = {word}|null`, interface {state, arm (sets armed+pending), consumePending, reset}; `createChainMachine` closure `let armed, pending`.
  - Display layer `createDisplayProvider` (583–771): composes unchanged — armed sets publish through `lastLive` with matching prefix, so the zero-char offer at prefix "" passes the `result.prefix === live.prefix` classification.
- `test/chain.test.ts`: 12 cases + an end-to-end case at line 500 ("bare-word route still arms end-to-end: 'National' → renewable → energy"). Helpers: `makeStack`, `armViaTab(inner, chain, store, word, frag)`, `suggest`, `seedStore`, `makeCurrent`, `opts()`, `item()`. Case (8) (line 289) currently expects: buffer `"alpha "` (trailing space) → disarm + DELEGATE (null passthrough, verbatim lines/options identity), and `"beta!"` (punctuation) → same. Pin comment at provider.ts ~265 cites case (8).
- `src/pi/index.ts` (251–255): `before_agent_start` → `chain?.reset()` — survives the simplification unchanged (reset still exists). Verify only.
- `src/core/store.ts`: `topSuccessors(word)` is O(1), returns `Array<{next, count}>`, frozen shared empty `NO_SUCCESSORS` on miss. Successor index built by `recordBigramRuns` at ingest (P1.M1.T2.S1/T3.S2, COMPLETE).
- `query.ts` words-only (P1.M1.T2.S2, COMPLETE) — space-joined phrase keys can no longer appear in `liveKeyByValue`, so the applyCompletion phrase arm case is dead code to delete.
- Config gate: provider reads `config.enablePhrases` at lines 239 + ~356/388. The `enableChaining` rename is P1.M3.T1.S1 — this task KEEPS reading `enablePhrases` (rename out of scope).
- Validation: `npm run check`, `npm test`.

## pi-tui semantics (external_deps.md §2a / confirmations — CONFIRMED)
- With `prefix: ""`, `applyCompletion` splices `item.value` VERBATIM at the cursor; text before the cursor already ends with the delimiter (the user's separating space), so a BARE word value inserts correctly word-separated (`"foo " + "bar"` → `"foo bar"`). A leading-space value at the same position produces a DOUBLE space. Hence: bare values are the correct shape; retire leading-space values.
- Plain path adds NO trailing space — chains must not rely on "value + space".

## The case-(8) reconciliation (IMPORTANT)
The item contract says: (a) offer at empty word start (before ends with `[ \t]` or line start); (c) disqualify on non-word-start/non-fragment contexts (escape, punctuation, no successors). It ALSO says preserve case (8) "word-less buffer disarm+delegate". These conflict for case (8)'s FIRST sub-case (`"alpha "` trailing space with alpha armed → old expectation: disarm+delegate):
- Under the new contract (a), `"alpha "` IS a qualifying word start whose preceding token is the armed word → it MUST offer the unfiltered successors (that is the zero-char offer, the entire point of R4).
- Resolution adopted: case (8)'s PRESERVED semantics are its second sub-case (punctuation `"beta!"` → disarm + delegate with verbatim delegation identity) — a non-word-start context. The trailing-space sub-case's expectation is superseded by PRD h2.43 ("word start, ZERO typed chars → offer the top successor… the entire meaning of phrase completion"). The pin comment at provider.ts ~265 belongs to the retired pending/adjacency mechanism; chain.test.ts is rewritten wholesale by P1.M2.T1.S2 anyway. This task therefore MINIMALLY updates case (8)'s first sub-case (and the pin comment it cites) — documented decision, not silent scope creep. Delegation-verbatim assertions in case (8) stay untouched.

## Design decisions
- Word-start test: `before === "" || /[ \t]$/.test(before)`.
- Zero-char offer: `succ = store.topSuccessors(armed.word).slice(0, config.maxSuggestions)`; if empty → `chain.reset()` + fall through (extractMatchState at empty word start → null → delegate). Items: `value: s.next`, `label: s.next`, `description: "chain"`, `prefix: ""`; lastLive prefix "", salience `-s.count` (count-desc), CHAIN_KEY_PREFIX live keys under BARE `s.next`.
- Fragment path unchanged except: stays threshold-0 semantics (any ≥1-char fragment filters — already true); zero matches → reset + fall through (case 6 preserved).
- applyCompletion: delete the phrase (space-joined) arm branch and its BUG-005 comment; keep CHAIN_KEY_PREFIX re-arm + whole-word arm (`item.value.toLowerCase()`); trigger-mode acceptance arms via whole-word case (case 11 unchanged).
- createChainMachine: `arm(word)` = `armed = word` only; DELETE `pending` and `consumePending` from state, interface, and JSDoc. `state`/`reset` keep.
- index.ts before_agent_start `chain?.reset()`: still valid; verify only (no edit unless something breaks).