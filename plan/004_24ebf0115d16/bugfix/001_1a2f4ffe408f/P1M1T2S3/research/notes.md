# Research notes — P1.M1.T2.S3 (bugfix 001_1a2f4ffe408f): end-to-end widget chain tests + live TTY verification + spec/07 clause

## Upstream state (verified)

- T1 (arming) COMPLETE: commits `fc08633` (expose painted matches), `fef3e54`
  (chain.arm from insertHighlighted), `2a595cf` (classification-matrix pin suite).
  widget.ts now has: painted-record shim (`chainShim`, description "chain",
  tier undefined), consult branch (~L665-748: chain answers before normal query
  when armed, `chainIntent` bypass flag, `chain.reset()` + fall-through on empty
  successor set), arming in insertHighlighted via painted record key/tier.
- T2.S1 (consult branch in visibility machine) COMPLETE — test/widget.test.ts
  :1280-1349 already has "widget chain offers render + re-arm" describe (2 cases:
  zero-char paint + Tab accept re-arm at successor key; fragment 'qu' filtering).
- T2.S2 (shared one-shot grant tracker, src/pi/chain-grant.ts) IN FLIGHT — its
  PRP is the contract: `createChainGrantTracker()` with `tick(prefix): boolean`
  (spent → caller chain.reset() + fall through) and `reset()`; provider refactored
  byte-identically; widget consumes it. My PRP consumes its output and pins the
  one-shot behavior END-TO-END through the composed widget proxy (S2's own tests
  are helper-level + provider-level).

## What S3 must add (per contract + research map)

End-to-end composed-proxy cases (createWidgetEditorFactory over a stateful fake
inner editor — getLines/getCursor/setText/setCursorCol, pattern at
test/widget.test.ts:648 "S2 fixture: recording inner editor with a LIVE buffer"):

1. PRD repro sequence (PRD h2.2 Steps to Reproduce): seed store (upsert +
   recordBigramRuns ×2 → topSuccessors('zorpwibble')===[{next:'quuxblat',count:2}]);
   type 'zorp' → line shows candidates; Tab → inserts word AND chain.state()
   becomes the accepted key; space → zero-typed-char successor offer VISIBLE at
   empty word start; Tab on offer inserts exactly one word and re-arms.
2. One-shot grant END-TO-END (S2's helper through the widget): typing through the
   offer disarms at the next word boundary; normal path answers the same keystroke.
3. Armed chain NEVER overrides a stock context (R1 ordering; provider parity,
   provider.ts:308; pinned on fallback at test/provider-live.test.ts:424-443).
4. Trigger char wins over a glued chain fragment.
5. enableChaining=false → every new branch inert (chaining-gating parity; suite
   test/chaining-gating.test.ts has fallback cases at :203/:254/:281/:351).
6. Line never renders with zero candidates (invariant; reset-on-empty).
7. Count order and ≤ maxSuggestions cap on multi-successor offers.

## Must-keep (fallback canaries — DO NOT regress)

From r1-chain-widget.md §Tests: test/chain.test.ts (zero-char offer :260,
one-shot :291/:324, fragment filtering :356/:391, disqualification :405/:421,
re-arm :454, reset :516, trigger-mode arming :533, debounce :546, one-word
invariant :585, fuzzy membership :651); test/chaining-gating.test.ts (7 cases);
test/provider*.test.ts; test/successors.test.ts; test/widget-visibility.test.ts
(chain-idle expectations unchanged).

## Spec edit (Mode A, rides with this subtask per system_context.md table)

spec/07-completion-ui.md M2 section, after the ":472 Chain offers render on the
widget line (or fallback menu)" bullet (verified the bullet sits among ~465-476;
the bullet text: "Chain offers render on the widget line (or fallback menu) like
any result set — with the description column retired there is no `chain`
marker…"). Add ONE clarifying clause: on the widget path, arming happens at the
widget's Tab-insert (the applyCompletion equivalent) and successor offers
publish through the visibility machine's intent bypass.

## Live TTY verification (binding, spec/09:179-196)

- `pi --no-session` inside a tmux pane; seed store by submitting one short user
  message with a repeated bigram, Ctrl+C the turn; drive keys via
  `tmux send-keys` one char at a time with 0.08–0.12s sleeps (bursts cancel
  in-flight queries); verify via `tmux capture-pane`.
- Sanctioned instrumentation: `appendFileSync` behind an env var in
  src/pi/widget.ts — REMOVE before committing.
- Record the verification (docs or commit message; plan has TEST_RESULTS.md
  convention at plan/004_.../TEST_RESULTS.md).

## Validation commands
- npm run check; npm test (baseline 1053 passed / 1 skipped).
- Targeted: npx vitest --run test/widget.test.ts test/chain.test.ts
  test/chaining-gating.test.ts test/provider*.test.ts test/widget-visibility.test.ts
