# Research notes — P1.M1.T1.S2 (plan 002): stock-context delegation in getSuggestions

## Sources examined
- src/pi/provider.ts (full read, ~700 lines). getSuggestions flow:
  1. aborted check → delegate (args untouched)
  1.1 `forced = options.force === true`
  1.5 armed-chain branch (`chain.state()` + `config.enableChaining`)
  2. `extractMatchState` null → delegate
  3. `rankMatches` zero → clear cache + delegate
  4. publish lastLive/liveKeyByValue, map items, forced single-item narrowing.
  → The stock gate slots in right after the aborted check, BEFORE step 1.1/1.5,
  so it covers typing, forced Tab, and armed-chain-overlapped contexts.
  Note: classifyStockContext does NOT exist yet in provider.ts — it is added by
  P1.M1.T1.S1 immediately after extractMatchState (per its PRP contract).
- plan/002.../architecture/provider-tui-integration.md (via S1 PRP):
  pi-tui editor.js isInSlashCommandContext (:1775) + handleTabCompletion
  no-space guard (:1812) semantics; fix design item 2 = this task's wiring.
- test/provider.test.ts: established sentinel convention — `mockCurrent()`
  factory with `getSuggestions: vi.fn(async () => SENTINEL)`, `expectUntouchedArgs`
  helper asserting arg identity (calledWith exact objects), makeStack wraps
  createHapaxProvider (inner) + createDisplayProvider (provider).
- test/provider-live.test.ts: delegation describes (aborted, null match state,
  zero candidates), forced-single-item block, armed-chain tests using
  createHapaxProvider(store, cfg(), current) + applyCompletion to arm.
- test/calibration.test.ts: exports COMMON_PROBES = ["with","this","them","that",
  "have","would"] — common-probe words usable as ingest text for negative cases.
- Delegation contract (provider.ts doc): forwards ORIGINAL arguments object
  unchanged — never clone, never drop force; existing tests assert identity.
- Chain interplay: contract says armed chain + '/re' delegates and the chain is
  left to reset per P1.M1.T2 rules — do NOT arm on stock items; delegation
  returns current's result directly without touching chain/lastLive? Existing
  aborted-delegate path does not clear lastLive (only zero-candidate path does).
  Match that precedent: plain `return current.getSuggestions(...)`.

## Key design decisions
- Gate placement: after `options.signal.aborted` check, before `const forced`.
- Gate form: `if (classifyStockContext(lines, cursorLine, cursorCol)) return
  current.getSuggestions(lines, cursorLine, cursorCol, options);`
- No lastLive clearing on this path (mirrors aborted-delegate precedent; the
  display layer's isHapax prefix check already prevents stale-paint issues).
- Tests: vi-mock `current` returning SENTINEL; assert identity of args and
  result; cases: '/re' force:false, '/re' force:true, '@jo', '"src/roun',
  'src/roun', plain 're' after ingest (hapax items), armed chain + '/re'
  (delegates; assert chain.state() unchanged — reset is P1.M1.T2's rule, but
  delegation itself must not arm or alter live state).
