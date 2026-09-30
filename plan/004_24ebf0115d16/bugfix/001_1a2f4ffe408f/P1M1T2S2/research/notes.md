# Research notes — P1.M1.T2.S2 (bugfix 001_1a2f4ffe408f): port one-shot grant tracker as shared helper

## Upstream contract (P1.M1.T2.S1, in flight — assume exact)
- widget.ts visibility machine has the chain consult branch: zero-char offer
  paint, typed-fragment membership filter, reset+fall-through, chainIntent.
- VisibilityMachineDeps.chain?: ChainMachine wired from factory.
- Arm sites on widget: insertHighlighted → chain.arm (P1.M1.T1.S2, landed).
- S1's PRP explicitly fenced: "Porting the one-shot grant tracker here
  (T2.S2 owns it)" — its branch currently has NO one-shot logic.

## Verified live source (provider.ts)
- Tracker fields: `chainWordsSeen = 0` (:279), `chainLastArmedPrefix: string | null = null` (:280).
- Tracker block in armed branch (~:400–435): curArmedPrefix = "" | trailing
  fragment | null (before === "" || /[ \t]$/ → ""; else regex match ?? null);
  if null → skip entirely (disqualification handled elsewhere); isNewWord
  logic (null→first word counts as 1; ""→non-empty = same word; non-empty→""
  = new word; two non-empties w/o mutual prefix relation = different words);
  chainWordsSeen >= 2 → chain.reset() + zero the tracker + fall through to
  normal path SAME keystroke; else record prefix.
- Reset sites (arm): applyCompletion both branches (:670–671, :696–697) set
  seen=0, lastPrefix=null alongside chain.arm.
- Spec/07 one-shot grant: exactly ONE word per acceptance; typing through
  disarms at next word boundary; acceptance re-arms fresh.

## Design
- Extract to exported factory, e.g. `createChainGrantTracker()` returning
  { tick(prefixBeforeCursor: string): boolean /*disarm?*/, reset(): void } —
  keep placement decision simple: export from src/pi/provider.ts (widget
  already imports ChainMachine? verify; else tiny new module
  src/pi/chain-grant.ts — RECOMMENDED: avoids provider.ts import weight and
  keeps the helper pure). Factory closure holds seen/lastPrefix privately.
- Provider refactor: replace :279–280 fields + :400–435 block + :670/:696
  resets with tracker calls — BYTE-IDENTICAL observable behavior (the
  canary suites pin it: chain.test.ts :291 every-word-start, :324 one-shot
  disarm, :454 successor re-arm; chaining-gating; provider*).
- Widget consumption: in S1's chain consult branch, tick the tracker with
  the same `before`-derived prefix string; on disarm → reset chain +
  fall through (same as disqualification); arm site (insertHighlighted)
  calls tracker.reset() next to chain.arm. Tracker instance owned by
  createWidgetEditorFactory (same scope as chain machine) and passed via
  deps (or created inside the machine when absent).
- API shape: tick(curArmedPrefix: string): boolean — true = disarm now
  (wordsSeen>=2 was hit, tracker already zeroed). null-prefix case: tick is
  simply not called (callers already skip on null fragments — mirror
  provider's `if (curArmedPrefix !== null)`).

## Gotchas
- Provider byte-identity: keep the exact isNewWord asymmetry table —
  copy the comment block verbatim into the helper.
- The tracker is stateful per provider/factory instance — never module-level.
- widget machine may be constructed without chain (optional dep): create
  the tracker lazily alongside; tick only when armed branch runs.
- One tracker per chain instance; index.ts fallback path keeps its own
  inside createHapaxProvider (unchanged wiring).
- NodeNext .js imports; vitest style.
