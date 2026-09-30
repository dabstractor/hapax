# Research notes — P1.M1.T2.S2 (plan 004): provider+widget loose-mode wiring, tier-0 always consulted, chain-arm suppression

## Upstream contracts (in flight — assume exact)
- P1.M1.T2.S1: `resolveFuzzThreshold(config, mode: "trigger"|"ambient")` exported
  from src/pi/config.ts; `TRIGGER_FUZZ_THRESHOLD = 45` from src/core/query.ts;
  internal `fuzzThresholdSet` flag (explicit overrides both modes).
- P1.M1.T1.S1 (landed): tier-0 ambient pass in rankMatches (zero-anchored-result
  precondition), `RankedMatch.tier` diagnostic (0 = anchorless; listing items
  and chain shims OMIT tier — strict `tier === 0` check preserves them).

## Verified live-source facts
- provider.ts :599–603 call site: `rankMatches(store, state.fragment, {
  limit, fuzzThreshold: config.fuzzThreshold })` — flat threshold, `state.mode`
  in scope (extractMatchState returns union). LiveResult + liveKeyByValue
  (Map<value→key>, :275) built at :616–617 (`liveKeyByValue.set(m.display,
  m.key)`) — tier NOT stored in the map; lastLive.matches (≤8 RankedMatches)
  IS available in applyCompletion scope. Chain shim entries built by
  publishChain (:461–480) as fabricated RankedMatches (no tier field) with
  CHAIN_KEY_PREFIX keys.
- Chain arm site: applyCompletion ~:640–686, two branches — CHAIN_KEY_PREFIX
  (re-arm, keep) and plain key (`chain.arm(key)` — suppress on tier 0).
- widget.ts :436–442: default query closure `(fragment) => rankMatches(store,
  fragment, {limit, fuzzThreshold: config.fuzzThreshold})`; deps.query is the
  override seam. createVisibilityMachine calls extractMatchState at :588 and
  branches on match.mode (:617 suppressed-bypass / :627 intent / :701 area) —
  mode available where query(match.fragment) runs (~:630). WidgetOpts.chain
  (:122–124) wired by index.ts but read by NO widget code — widget Tab NEVER
  arms (scout-corrected; PRD's "both Tab sites" assumption wrong). So: WIRE
  provider arm suppression; PIN widget no-arm (comment + test).
- Tests: test/chain.test.ts armViaTab helper (:202–218) exists;
  test/chaining-gating.test.ts, test/widget-visibility.test.ts exist.

## Design decisions
- RankOptions: add `loose?: boolean` (JSDoc: tier-0 runs unconditionally,
  deduped against anchored recs, floor 3 still applies). Implement dedup skip
  (`recs.some(r => r.key === k)` or a Set) UNCONDITIONALLY — vacuous in
  ambient mode (tier-0 only fires when anchored recs empty), one code path.
- Provider: `fuzzThreshold: resolveFuzzThreshold(config, state.mode ===
  "trigger" ? "trigger" : "ambient")`, `loose: state.mode === "trigger"`.
- Widget: thread mode into query seam — change deps.query signature to
  `(fragment: string, mode: "trigger" | "ambient") => RankedMatch[]`; default
  closure resolves via resolveFuzzThreshold; machine passes match.mode.
- Chain-arm suppression: in applyCompletion plain-key branch, look up accepted
  item's RankedMatch in lastLive.matches (find by display===item.value) and
  skip chain.arm when `m.tier === 0`. Map value NOT extended (≤8 scan is
  cheap, optional-tier design keeps shims arming).
- Chain MEMBERSHIP gate (~:540–560): already anchored — NO change.

## Gotchas
- lastLive may be null/stale in applyCompletion — guard: if no found match
  record, arm as before (fail-open; conservative suppression only when tier
  is KNOWN 0).
- '#'-alone listing: match records omit tier → undefined !== 0 → arms (pinned
  by test).
- Widget tests stub deps.query — signature change ripples: update
  widget-visibility.test.ts fixtures; rm() fixtures unaffected (optional tier).
- NodeNext .js imports.
