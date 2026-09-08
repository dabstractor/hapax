# Research notes — P1.M3.T2.S1 (BUG-006: restore-tail phrase demotion sweep)

## Verified code facts (read from working tree)

- src/pi/ingest.ts:
  - `#onSweepPhrases?: () => void` field ≈L154, set from options ≈L176.
  - Sweep fires ONLY in `#drainQueue`'s `finally` ≈L243–253, wrapped in
    try/catch ("a throwing callback must never wedge the queue").
  - `dispose()` ≈L205, `flush()` ≈L219 — good placement neighbors for the new
    public `sweepPhrases()`.
  - `restoreFromHistory` ≈L417–446: synchronous void, async IIFE per-entry
    loop calling `await pipeline.processText(text, fromUser)`; pipeline param
    typed `Pick<IngestPipeline, "processText">` — must widen to include
    `"sweepPhrases"`.
  - P1.M3.T1.S2 (in flight) adds `shouldAbort?: () => boolean` with a
    top-of-loop `if (shouldAbort?.()) return;` — the tail sweep must be
    skipped in that branch (use a `let aborted` flag; the `return` exits the
    IIFE so the flag must be set BEFORE returning).
- src/core/store.ts `sweepPhraseDemotions()` ≈L825: demotes fast-path
  candidates (isFastPathPhrase) with count<2 && !sticky when
  `currentOrdinal() - firstSeenOrdinal >= 40`. Assertion surface:
  `phraseCandidateKeys()`, `isFastPathPhrase(key)`, `getPhrase(key)`,
  `currentOrdinal()`.
- src/pi/index.ts: `onSweepPhrases: () => sessionStore.sweepPhraseDemotions()`
  wired ≈L175; `restoreFromHistory(pipeline, ctx.sessionManager, ...)` ≈L212.
  NO wiring change needed for this task.

## Test infrastructure to reuse

- test/ingest-restore.test.ts: `fakeSm(opts)` (branch/entries/throws),
  `fakePipeline()` (records processText calls — must gain a `sweepPhrases`
  vi.fn when the Pick widens), `settle(probe)` = vi.waitFor, message fixtures
  userMsg/assistantMsg, deepFreeze helper.
- test/ingest-pipeline.test.ts: `makePipeline(opts)` ≈L99–128 builds a REAL
  IngestPipeline + CandidateStore + stubDict (COMMON={'context',
  'contextzephyr'}, MIDFREQ={'granite','graniteore'}, everything else → null
  lookup = RARE) + injectable `onAdmittedTokens`/`onSweepPhrases` +
  `drainNow(h)`. The live-path once-per-flush sweep tests live ≈L409–460+
  ("onSweepPhrases — once-per-flush demotion sweep"). The BUG-006 repro
  mirrors this wiring: phrase capture needs onAdmittedTokens feeding the
  store's n-gram path, sweep wired to store.sweepPhraseDemotions.

## PRD repro (BUG-006, h3.5) to encode as the test

1. onMessageEnd('zorblat quuxified mumblewords') + flush → 3 rare word
   candidates + fast-path phrase candidates ("zorblat quuxified",
   "quuxified mumblewords").
2. 45× direct `await pipeline.processText('filler…')` (restore-style, no
   drain → no sweep) → candidates still present.
3. `pipeline.sweepPhrases()` (restore tail) → both phrases demoted
   (isFastPathPhrase false, keys absent). Control: a count≥2 phrase survives.
Gotcha: ensure each filler message issues a store ordinal (one ordinal per
message; verify processText — use admitting filler words like
"zephyr quartz vortex" to be safe).

## Concurrency note

P1.M3.T1.S2 is being implemented in parallel on the same file. This PRP
assumes its contract (optional shouldAbort third param) lands as specified.
Implementation must merge cleanly with it: abort branch sets `aborted = true`
before `return`; tail sweep `if (!aborted) pipeline.sweepPhrases()`.