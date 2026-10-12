# Research notes — P1.M1.T2.S2 (bugfix 001_140e40041dd1): widget typed-arming e2e + /acwords markers + live TTY

## Upstream contract (S1, in flight — assume exact)
- S1 adds a describe at end of test/index.test.ts, FALLBACK path only:
  seriesSession(msgs) helper (wired+useDict+enableDebug+startSession+endMessage+
  vi.waitFor dump poll), composeProvider over addAutocompleteProvider factory,
  cases (a) /acwords series marker, (b) typed arming via provider:597-608,
  (c) series-first ordering, (d) negative control. Explicitly: "T2.S2 owns
  the widget path."
- P1.M1.T1.S1 (Complete): index.ts passes enriched runs (no shim).

## Verified facts
- fakeCtx({editorFactory}) exercises the widget branch (index.ts:281-336
  createWidgetEditorFactory); fakeCtx default editorFactory undefined →
  fallback. ctx needs a factory-shaped editor for the widget path — see
  architecture map §"fakeCtx (:110-152, editorFactory)".
- Widget typing harness: makeInsertHarness (test/widget.test.ts:≈852) +
  typeChar pattern (:2000-2008) — advance live buffer at caret, press char,
  W1 microtask evaluates new state. For index-level composition we compose
  through the factory the same way.
- /acwords marker: src/pi/debug.ts:134-135 `${s.series ? " (series)" : ""}`
  — sample line 'the → fed ×1 (series)'.
- Arming gates: provider.ts:604 / widget.ts:1021 gate on
  topSuccessors(word).some(s => s.series); widget insertHighlighted arms.
- Timing (BUG-003, P2.M1.T1): widget paints zero-char offer on NEXT tick
  pre-fix, at the space tick post-fix — write the paint assertion to match
  whichever landed; keep arming assertion timing-independent.
- Live TTY technique (binding, spec/09): pi --no-session in a tmux pane,
  send-keys ONE char at a time with 0.08–0.12s sleeps (bursts cancel
  in-flight queries), capture-pane asserts; instrumentation via
  appendFileSync behind env var (sanctioned precedent in provider.ts),
  removed before commit. Mock nothing.
- chainShim: nextDisplay carries 'Fed' run casing (store side, P1.M1.T2.S2
  of plan-006 main).
- Sibling P2.M1.T1.S2 also does a live TTY check (space-tick paint) — this
  task's TTY spot-check covers arming+offer presence; record drift for
  P2.M2.T2.S2's drift report, never edit spec/*.md.

## Design
(a) index.test.ts NEW describe "index.ts e2e — series pipeline through the
real factory (widget path)": fakeCtx with editorFactory; ingest
'The Fed raised rates today'; type 'T','h','e',' ' one tick each through the
composed editor; assert chain state {word:'the'}; assert successor set /
painted offer contains 'Fed' (nextDisplay) — paint assertion conditional on
which timing fix landed (comment both expectations); arming assertion
independent of paint.
(b) /acwords e2e: enableDebug, ingest capitalized run, dump() shows
'Fed ×1 (series)'-style marker with run casing (already partially in S1's
case (a) — this task adds the WIDGET-branch variant + asserts the shim-marker
that "never renders under the shim" now renders through production wiring).
(c) Live TTY: ephemeral pi in tmux with hapax loaded; seed user message,
Ctrl+C, type 'The ' one key at a time; capture-pane shows 'Fed' offer.
Record capture in run notes/test comment.
