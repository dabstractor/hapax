# Research — P1.M1.T2.S1 (bugfix 001_1a2f4ffe408f): chain consult branch in the widget visibility machine

## Reference implementation (provider.ts, per r1-chain-widget.md §Exact contracts)
- Armed branch ordering: abort → stock gate (classifyStockContext ~308, AHEAD of
  armed) → armed branch → normal.
- Zero-char offer: before === "" || /[ \t]$/.test(before) →
  store.topSuccessors(armed.word).slice(0, maxSuggestions); display =
  store.get(s.next)?.display ?? s.next; EMPTY → chain.reset() + fall through.
- Typed fragment: frag regex + BUG-005 word-start guard
  (fragAt === 0 || /[ \t]/.test(before[fragAt-1])); membership filter
  matchFragment(frag, s.next) !== null at threshold 0 — NEVER
  resolveFuzzThreshold; keep count order, no re-sort; glued ('#b')/non-start
  → reset + fall through (trigger mode wins).
- publishChain shim: matches { key: CHAIN_KEY_PREFIX+s.next, display,
  salience: -s.count, sessionCount: s.count }.

## Current widget.ts state (post T1.S1/S2, verified in source)
- VisibilityMachineDeps (widget.ts:334-360): store, config, getEditorState,
  restoreReady, query? (fragment, mode) → RankedMatch[], onPaint?,
  isIntentBypass? (JSDoc: "T3's armed-chain successors land here via this seam.
  Default: nothing extra"), debounceMs?, reopenMs?. NOTE: NO chain member yet —
  this task adds `chain?: ChainMachine`.
- createVisibilityMachine internals: `paint(items, sig, now)` is the SINGLE
  write site for currentSet + paintedSet (RankedMatch records, 1:1 order);
  parkSwap for R6; hide()/closeWith clear both.
- evaluate order (widget.ts ~615-751): R1 classifyStockContext → hide;
  extractMatchState === null → closeWith (R3) ← zero-char offer must live
  BEFORE this; R2 startup gate (settled/gateDeadline/armGate, 500ms bound);
  query() → R4 zero-candidates close; R4 suppression (word-mode, new word
  start release); R5 hesitation `intent = match.mode === "trigger" ||
  deps.isIntentBypass?.()` at :669-670, gate skips when intent; R6 park/paint.
- VisibilityState.currentSet: readonly {display}[] (:329) — tab-insert path
  only needs display; decideWidgetKey tab-insert works when visible && count>0
  (NO decision-table change).
- painted() (machine member, :391-397 doc): returns RankedMatch list; T1.S2's
  insertHighlighted arming reads accepted record's key + tier from here. So
  chain-offer shims MUST paint with key = s.next (plain store key) so a
  successor Tab-accept re-arms at s.next; shim tier must NOT be 0 (leave
  undefined — `rec?.tier === 0` check arms otherwise). No CHAIN_KEY_PREFIX
  needed on the widget path (no liveKeyByValue disambiguation).
- insertHighlighted (T1.S2) already arms on accepts; the machine is the
  missing consult half.
- matchFragment exported from src/core/query.ts:244.
- topSuccessors: O(1) read, store.ts ~207; store.get(next)?.display for casing.

## Insertion design (resolving the placement question)
- Branch position: INSIDE evaluate, after R1, BEFORE the extractMatchState
  call (so both the zero-char case — extractMatchState null — and the
  typed-fragment case are covered by one block).
- Restore gate parity: gate the branch on `settled` identically to R2 —
  when not settled, armGate(now) and return state() (chain offers must not
  fire during history replay; provider path gates on restoreReady too).
- One-shot grant tracker: NOT here — P1.M1.T2.S2 ports the shared helper;
  this task ships (a)+(b)+(c) consult semantics only (the one-shot word-
  boundary disarm lands with the tracker in T2.S2).
- isIntentBypass: machine-internal `chainIntent` flag set when the chain
  branch painted on THIS tick; R5's intent computation becomes
  `match.mode === "trigger" || chainIntent || deps.isIntentBypass?.() ?? false`.
  deps.isIntentBypass stays as the external seam (JSDoc updated: the machine
  itself accounts for chain paints; the dep remains for future external
  intent sources). R6/R7 compose unchanged (paint on closed line = immediate
  first paint; later swaps park through parkSwap) — fallback parity.
- Suppression (R4): chain offers are INTENT — bypass explicit-dismissal
  suppression on this branch (mirrors trigger mode). P1.M2.T2.S1 refines
  suppression-release semantics ON THIS SAME BLOCK afterwards (deliberate
  sequencing per the item contract); add a pointer comment.
- enableChaining:false / deps.chain undefined → branch fully inert (chaining-
  gating suite must keep passing).
- Zero-candidate invariant: EMPTY successor set → chain.reset() + fall
  through to normal path — never paint an empty set.

## Tests (test/widget-visibility.test.ts + test/widget.test.ts conventions)
Real createVisibilityMachine + real seeded CandidateStore; fake editor
streams via getEditorState; spied ChainMachine where arming is not under
test. Cases: zero-char offer paints successors in count order with store
display casing; typed fragment filters via matchFragment membership, count
order kept; '#b' glued fragment → reset + trigger-mode fall-through; empty
successor set → reset + fall-through (no empty paint); stock context ('/x')
while armed → R1 wins, no chain paint; enableChaining:false inert; hesitation
bypass (menuDelayMs high → chain paint still immediate); suppression bypass;
restored-record shims: painted() keys = s.next so tab-insert re-arms (assert
via spy chain.arm after decideWidgetKey tab-insert with currentSet painted
from shims).
