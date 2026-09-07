# Research notes — P1.M3.T3.S3 (display debounce + flicker hysteresis)

## Codebase facts (verified this session)

- `src/pi/provider.ts` currently contains ONLY S1's `extractMatchState` + `MatchState`
  (read in full). S2 (`createHapaxProvider`) is implemented in parallel; per its PRP
  (plan/001_88fc3a66fd74/P1M3T3S2/PRP.md) it will add:
  - `createHapaxProvider(store, config, current)` returning
    `AutocompleteProvider & { __hapaxLive: () => LiveResult | null }`
  - `LiveResult = { matches: RankedMatch[]; prefix: string; ts: number }`
  - Delegation paths (aborted / null state / zero matches) forward original args
    unchanged; zero matches clears `__hapaxLive()` to `null`.
  - Hapax path is fully synchronous inside the async `getSuggestions`.
- `src/core/query.ts`: `rankMatches(store, prefix, { limit })` → `RankedMatch[]`
  (`{ key, display, description, salience }`), description pre-formatted.
- Test conventions: vitest, ESM `.js` import suffixes, header doc comment, real
  `CandidateStore` fixtures (see test/store.test.ts, test/query.test.ts).
  `npm run check` (tsc), `npm test` (vitest --run).
- pi-tui contract: `getSuggestions(...) => Promise<AutocompleteSuggestions | null>`
  where `AutocompleteSuggestions = { items: AutocompleteItem[]; prefix: string }`.

## Design decisions for S3

1. **Where the debounce lives**: a wrapper, `createDisplayProvider(base, opts)`,
   that wraps the S2 provider. Rationale: S2's contract says "S3 wraps it". The
   wrapper intercepts only the RESULT of the inner `getSuggestions`; everything
   else (applyCompletion, shouldTriggerFileCompletion, triggerCharacters) passes
   through untouched.
2. **What "suppress" means**: the inner provider is called on EVERY keystroke
   (so Tab's live cache `__hapaxLive` stays fresh — never gated). Only the
   RETURNED suggestion set is debounced: if the fresh non-empty hapax set differs
   from the displayed set and <100ms since last paint, return the displayed set
   and schedule a swap timer; newer keystrokes replace the pending set.
   - Important nuance: a timer alone cannot push a new set into pi's menu (pi
     calls getSuggestions, we don't push). The pending swap applies on the NEXT
     getSuggestions call whose arrival is >=100ms after lastPaintAt, OR — if no
     further keystroke ever comes — the paint simply never updates (acceptable:
     pi re-queries per keystroke; the 100ms window is between keystrokes). This
     is exactly the PRD's "menu updates at most every 100 ms, between
     keystrokes". The timer's role is bookkeeping (advancing lastPaintAt /
     flushing pending) and cleanup ownership; test it with vi.useFakeTimers.
   - Distinguishing "hapax result" vs "delegated result": inner returns a hapax
     set when the result is non-null AND state matched. S3 re-derives the
     signature from `base.__hapaxLive()` (live cache non-null ⇒ hapax path) plus
     the inner return value. If `__hapaxLive()` is null and inner returned
     null/delegated → pass through untouched (empty = invisible, close events).
3. **Hysteresis rules encoded**:
   - empty candidate set → forward inner result (delegate/empty) immediately; no
     timers; reset displayed state.
   - narrowing (new set's values ⊆ old displayed set's values) within debounce
     window → still debounce per PRD rule 2 (suppression applies to ANY differing
     set), but narrowing must never emit a "close" in between: we always return a
     non-empty set (old or new), so pi never sees zero-then-nonzero. Assert
     emission sequence contains no empty/non-empty flapping for `zend→zendk`.
   - close events (cursor move / escape / space / disqualification) manifest as
     inner returning delegate/empty or null → we reset displayed state and
     lastPaintAt so a qualifying keystroke re-opens fresh (no stale set). The
     200ms re-open rule means: after a close, do NOT carry displayed state
     forward; next qualifying query paints immediately.
4. **Set signature**: `items.map(i => i.value).join("\u0000")` — stable, cheap.
5. **Timer ownership**: every scheduled timer id stored in a Set; exported
   `dispose()` clears them all. P1.M3.T5.S1 calls dispose in session_shutdown
   (PRD §02 lifecycle).
6. **Testing**: vi.useFakeTimers + vi.advanceTimersByTime; record emission
   sequence (array of returned item-value tuples per call) and assert no
   close+reopen pairs on narrowing; assert Tab path: `__hapaxLive()` reflects
   the newest query even while display is debounced (call `base.__hapaxLive()`
   after a suppressed keystroke).