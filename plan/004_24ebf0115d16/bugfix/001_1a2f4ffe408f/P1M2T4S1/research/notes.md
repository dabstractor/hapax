# Research notes — P1.M2.T4.S1 (README/overview sweep for bugfix changeset 001)

## Verified facts

- **system_context.md §Documentation targets** (plan/004_24ebf0115d16/bugfix/
  001_1a2f4ffe408f/architecture/system_context.md:72-80):
  - Mode A (done with the code, NOT this task): doc pins the fixes
    invalidated — widget.ts "CHAIN ARMS: NEVER", WidgetLayerOptions.chain
    comment, ingest.ts stale docstring, segment.ts overlap-safety comment.
  - **Mode B (this task)**: README.md:134-144 chained-completion blurb
    (currently cites only src/pi/provider.ts — must cover the widget path);
    README items list (:20-25); docs/M1-DoD.md only if a line is invalidated.

- **README.md current state** (verified by reading):
  - :20-27 Status paragraph: "M3 (v3) — complete, live-verified"; mentions
    bugfix-001 re-verification already ("and the bugfix-001 re-verification;
    the M3 DoD append lands with the DoD re-verification sweep") — check
    whether this sentence already covers the changeset or needs updating to
    reflect the four fixes landing.
  - Chained-completion feature blurb (~:134-144): header cites only
    `(src/pi/provider.ts)`; text describes arming as fallback-provider
    behavior ("Accepting a word via Tab arms its most-likely successor").
    After BUG-001 fix, arming happens on BOTH paths: widget
    insertHighlighted arms via the shared chain machine, and zero-char
    successor offers render on the widget line via the visibility machine's
    intent bypass. Spec authority: spec/07-completion-ui.md — intent bypass
    ("Explicit intent — trigger-char results and armed-chain successors —
    bypasses the gate and shows immediately", ~:265) and the new M2
    clarifying clause (chain offers render on the widget line like any
    result set, ~:472 area).

- **Spec edits already landed** (verified present — these are the wording
  authority, README never overrides spec):
  - spec/04 (tokenization): containment defer — "IS CONTAINED IN a kept
    base/hexish/compound token defers to..." (~:102) — BUG-002.
  - spec/05 (ingestion): "A slice boundary never splits a token: the
    trailing partial token (suffix of token-class characters) is carried
    into the next slice" (~:35-38) — BUG-004.
  - spec/07: M2 clarifying clause (widget line + intent bypass) — BUG-001.
  - BUG-003 (suppression fingerprint) spec edit landed with P1.M2.T2.S1.

- **docs/M1-DoD.md**: milestone record; lines around :203, :233-354 pin
  chain/stock-context/one-word invariants and item-7 proof. Nothing found
  that states "chaining does not arm on widget path" — the M2 post-delta
  sections verified chaining through the fallback provider path only, which
  is historically accurate (it was true then). Policy: additive note only —
  append a bugfix-001 post-delta block noting the four defects found and
  fixed, with re-verification pointers, rather than rewriting history.

- **AGENTS.md binding policy**: spec is the single source of truth; README
  is a summary that never overrides spec. Spec maintenance: code+spec land
  together (already done in implementing subtasks); this task is the
  changeset-level README/DoD sync that "only makes sense once the whole
  change is in place" — must run last (it does: only P1.M2.T4.S2 spec-drift
  task follows, which touches spec/04 & spec/09 boundary text only).

- Baseline verification commands: `npm run check`, `npm test`
  (1053 passed / 1 skipped baseline per PRD h2.0).

## README items/status list (:20-25 area) sweep checklist

Statements to check for invalidation by the changeset:
1. Widget primary path description — still true; ADD that chaining is live
   on it (BUG-001).
2. Fallback menu framing — unchanged.
3. Any claim that duplicate candidates / suppression / chunking behave a
   certain way — BUG-002/003/004 are fixes to defects users never saw
   documented as features; the README likely never claimed the buggy
   behavior, so most items survive untouched. Verify, don't assume.
