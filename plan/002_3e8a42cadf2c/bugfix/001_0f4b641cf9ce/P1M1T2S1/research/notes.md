# Research — P1.M1.T2.S1 (bugfix 001_0f4b641cf9ce): armed-branch word-start requirement

## BUG-005 root cause (verified in source)
- src/pi/provider.ts armed branch (~L320–410) runs BEFORE extractMatchState,
  at chain threshold 0. Fragment path (b): `const frag =
  before.match(/[A-Za-z][A-Za-z0-9_]*$/)?.[0];` — matches 'b' when before is
  'x alphaone #b' WITHOUT checking what precedes the fragment. Result:
  successors filtered at 'b', returned with prefix 'b', chain stays armed.
- pi-tui stock applyCompletion (autocomplete.js:265+, per
  architecture/provider-tui-integration.md) deletes exactly prefix.length
  chars blindly: prefix 'b' on '#b' leaves '#betaword' — the trigger char
  survives. Trigger-mode completion must consume it (prefix '#b').
- PRD §07: "Any non-Tab key that disqualifies (space, escape, punctuation) →
  idle" and "trigger-char match wins" over threshold.

## Fix site (exact code shape)
In armed branch, after matching frag, add word-start guard:
```ts
const at = before.length - frag.length;
const atWordStart = at === 0 || /[ \t]/.test(before[at - 1]);
if (!atWordStart) { chain.reset(); /* fall through to step 2 */ }
```
Then existing flow: fall-through reaches step 2 `extractMatchState` (whose
trigger regex `(?:^|[ \t])#([^\s#]*)$` yields mode 'trigger', prefix '#b').
Note the disqualify path (c) already does `chain.reset()` without return —
the new guard mirrors that control flow (reset, no return, execution
continues past the armed-branch `else` into step 2).

## Interaction with P1.M1.T1.S2 (parallel, contract)
- classifyStockContext delegation gate sits BEFORE the armed branch
  (after aborted check). Ordered precedence: abort → stock-context → armed →
  force/extractMatchState. Our fall-through passes the stock gate again
  naturally (it already ran before the armed branch — wait: it ran BEFORE, so
  on fall-through it does NOT re-run; but if it had matched we'd never reach
  the armed branch, so fall-through straight to extractMatchState is correct:
  stock contexts were already excluded).
- T1.S2's test case 7 (armed + '/re' → SENTINEL) exercises the stock gate
  ahead of the armed branch — no overlap with our trigger-char case.

## Test conventions (test/chain.test.ts, read in full)
- Helpers: `makeCurrent()` (Mock wrapped provider, contract-shaped),
  `seedStore()`/`seedAlphaSuccessors()` (recordBigramRuns = only bigram seam),
  `makeStack(store, current)` → {chain, inner (no display debounce), provider},
  `suggest(p, lines, line, col)`, `opts()` fresh AbortController signal,
  `armViaTab(inner, chain, store, word, fragment, seed?)` — the ONLY
  production arming path (live menu + inner.applyCompletion + Tab accept),
  asserts `chain.state()` equals `{word}` as precondition.
- Contract fixture words for the new case: successors alphaone→betaword /
  deltaword via `recordBigramRuns`; put() alphaone/betaword/deltaword with
  enough salience. Arm on 'alphaone', then query 'x alphaone #b'.

## Expected post-fix behavior
- 'x alphaone #b' → armed branch: frag 'b' preceded by '#' → reset + fall
  through → extractMatchState trigger mode → hapax trigger items with prefix
  '#b'; chain.state() null.
- 'x alphaone be' → frag 'be' preceded by space → normal chain filtering,
  prefix 'be', chain armed.
- 'x alphaone ' (space end) → zero-char offer unchanged (word-start check in
  path (a) runs before the fragment regex; untouched).
- 'x alphaone' + punctuation like 'x alphaone!"re"' → frag 're' preceded by
  '"' → reset + fall through (bonus: punctuation disqualify now consistent).
