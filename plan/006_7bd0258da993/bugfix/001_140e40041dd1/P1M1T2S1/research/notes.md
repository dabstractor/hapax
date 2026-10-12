# Research — P1.M1.T2.S1 (bugfix 001_140e40041dd1): index.test.ts e2e series suite

## Harness facts (test/index.test.ts, verified live)
- `wired(over?)` (:262-287): fakePi + fakeCtx + real `hapax(pi)`; useDictPath
  stubs HAPAX_DICT; useDict() writes a temp dict [{word:'the',quant:200}].
- fakeCtx default editorFactory undefined → FALLBACK path; provider is
  registered via `ctx.ui.addAutocompleteProvider((current) => provider)`
  (index.ts:360) — the spy captures the FACTY function; compose with
  `currentFake()` (:154-163) to get a drivable provider instance:
  `const f = addAutocompleteProvider.mock.calls[0]![0]; const p = f(currentFake());`
- settle() = 420 ms (>300 ms debounce); existing tests prefer
  `vi.waitFor(async () => ...)` polling the real /acwords dump
  (acwordsHandler(registerCommand) + dump(handler) → notify text) — the
  fire-and-forget restore drains make fixed sleeps flaky.
- userMsg(content) helper; msgEntry(id, msg) for branch history.
- enableDebug() writes {debug:true} to the temp HOME config.
- PROTOTYPE-SPY caveat (:441-447): spies on CandidateStore.prototype are
  shared across sessions; filter calls to THIS session's message.

## Producer semantics verified in source
- store.ts Successor.series?/nextDisplay? (:131-132, :150);
  successorBefore (:177-182): series flag outranks ANY count; count desc;
  byte-lex. Series pair marked when BOTH members are enriched RunMembers
  with series:true (recordBigramRuns isSeries check :713+).
- provider.ts typed-word arming gate (:597-608): on the close-on-space path
  (before ends with `\s`), `typed = before.match(/([A-Za-z][A-Za-z0-9_-]*)\s$/)`
  — arms when typed[0] is 'A'..'Z', enableChaining, chain idle, and
  topSuccessors(typed.toLowerCase()).some(s => s.series); arms + returns null
  (space still closes the menu).
- Armed branch zero-char offer: cursor at empty word start → successors in
  successorBefore order (series first), display via s.nextDisplay ?? store
  display; item value/label carry 'Fed' run casing.
- debug.ts '(series)' marker on successor sample lines (~:134-137).

## Upstream contracts (parallel/landed)
- P1.M1.T1.S1 (Implementing): index.ts passes the enriched runs payload —
  the shim is gone (already reflected in the T1.S2-era bigram-wiring
  describe at :439 which asserts RunMember objects reach recordBigramRuns).
- P1.M1.T1.S2 (Implementing): un-shimmed mirrored fixtures + ingest-level
  series assertions (acceptance/adversarial-typing/successors/branch-purity).
  THIS task must NOT duplicate those — it goes one layer up: the real
  index.ts composition, provider-driven, observable behavior.

## Test design (new describe, end of index.test.ts)
Session: wired() + useDict() + enableDebug(); startSession(new);
endMessage(userMsg('The Fed raised rates today')); await vi.waitFor(dump
shows fed or words seen > threshold). Then:
(a) /acwords dump contains a successor sample line matching
    /the → fed ×1 \(series\)/i AND mentions 'Fed' run casing where shown.
(b) provider = factory(currentFake()); first getSuggestions(['The '],0,4)
    → null (space closes) BUT arms — proven by the SECOND call at the
    empty word start returning items whose first value === 'Fed'.
    (No chain export — assert arming behaviorally.)
(c) seed ordinary pairs: two more endMessage(userMsg('the market moved and
    the market fell'))-style messages so topSuccessors('the') has
    market ×2+ ordinary vs fed ×1 series; the armed zero-char offer still
    tops with 'Fed' (successorBefore series-first).
Widget path + /acwords deep markers + live TTY = P1.M1.T2.S2 (NOT here).

## Gotchas
- The provider factory captured by the spy composes over `current` — pass a
  contract-shaped currentFake() or applyCompletion delegation throws.
- getSuggestions is async; options need a real AbortController signal.
- 'The' is sentence-initial structural-cap; run detection deliberately
  includes line-initial (spec 04) — the series mark must survive; if the
  pipeline's enrichment classifies differently, that's a producer bug, not
  a test bug — report, don't paper over.
- vi.restoreAllMocks() in afterEach if any prototype spies are used (prefer
  NOT using them here — observation is via provider + dump only).
