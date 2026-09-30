# PRP — P1.M1.T2.S2 (plan 004): Provider + widget loose-mode wiring, tier-0 always consulted, chain-arm suppression

---

## Goal

**Feature Goal**: Wire the `#` loose mode (spec §04 h2.28 trigger loosening)
end-to-end on BOTH display paths, and suppress chain arming on tier-0
(anchorless) acceptances. (a) `RankOptions.loose?: boolean` in
`src/core/query.ts` — when set, the tier-0 pass runs UNCONDITIONALLY (no
zero-anchored-result precondition; fragment floor 3 still applies), deduped
against anchored admissions (anchored record wins). (b) Provider call site
(:599–603) resolves threshold via `resolveFuzzThreshold(config, mode)` and
passes `loose` under trigger mode. (c) Widget query seam threads mode with
the SAME helper — no divergence. (d) In applyCompletion's plain-key arm
branch, skip `chain.arm(key)` when the accepted item's `RankedMatch.tier
=== 0`; the widget Tab site NEVER arms (pin with comment + test — do not
invent widget arming).

**Deliverable**: edits to `src/core/query.ts`, `src/pi/provider.ts`,
`src/pi/widget.ts` + TDD across `test/query.test.ts`,
`test/provider-match.test.ts`, `test/widget-visibility.test.ts`,
`test/chain.test.ts` / `test/chaining-gating.test.ts`.

**Success Definition**: `#query` → `src/core/query.ts` works directly (no
anchored match needed); `#cfg` → tier-1 `config…` admits at 45; explicit
`fuzzThreshold` overrides both mode defaults on both paths; ambient word
mode byte-unchanged (60 default, zero-result precondition); tier-0
acceptance never arms a chain while tier 1–3, chain-shim, and `#`-alone
listing acceptances still arm; all four suites + full `npm test` +
`npm run check` green.

## Why

- Spec §04 h2.28: "`#` is hapax's explicit search-the-session-vocabulary
  gesture" — tier-0 always consulted + scattered tier-1 visible at 45.
  The core pieces exist (T1.S1 tier-0 pass landed; T2.S1 resolver in
  flight) but no call site uses them: provider still passes flat
  `config.fuzzThreshold`, widget's default closure likewise, and loose
  mode doesn't exist in RankOptions.
- Successor chaining stays anchored everywhere (h2.28): tier-0 matches
  never arm or extend a chain. Chain shims (fabricated RankedMatches from
  `publishChain`, provider.ts:461–480) omit `tier`, so a STRICT
  `tier === 0` check preserves their arming — as does the `#`-alone
  frequency listing (records omit tier).

## What

### (a) query.ts — loose entry

- `RankOptions` gains `loose?: boolean` with JSDoc: "Tier-0 anchorless pass
  runs UNCONDITIONALLY (spec §04 trigger loosening — no zero-anchored-result
  precondition; fragment floor 3 still applies; threshold-gated as usual).
  Records are deduped against anchored admissions — the anchored record
  wins ('queue' under '#que' is tier-3 AND indexOf=0; one record only)."
- In the tier-0 pass: fire when `opts.loose === true || recs.length === 0`
  (fragment ≥ 3 unchanged), and skip any tier-0 record whose key is already
  in `recs`. Implement the dedup skip UNCONDITIONALLY (vacuous in ambient
  mode) so one code path serves both. Ambient behavior byte-identical.

### (b) provider.ts :599–603

```ts
const mode = state.mode === "trigger" ? "trigger" : "ambient";
const matches = rankMatches(store, state.fragment, {
  limit: config.maxSuggestions,
  fuzzThreshold: resolveFuzzThreshold(config, mode), // P1.M1.T2.S1 helper
  loose: state.mode === "trigger",
});
```
+ call-site comment naming the per-mode resolution (Mode A docs ride with
the work). Import `resolveFuzzThreshold` from `./config.js`.

### (c) widget.ts :436–442 + :588–630

- Change the `deps.query` seam signature to
  `(fragment: string, mode: "trigger" | "ambient") => RankedMatch[]`; the
  default closure becomes:
```ts
deps.query ?? ((fragment, mode) => rankMatches(deps.store, fragment, {
  limit: deps.config.maxSuggestions,
  fuzzThreshold: resolveFuzzThreshold(deps.config, mode),
  loose: mode === "trigger",
}));
```
- At the machine's query call (~:630, where `match` from extractMatchState
  is live): `query(match.fragment, match.mode === "trigger" ? "trigger" : "ambient")`.
- Update `WidgetOpts.query` type accordingly; comment at the seam naming the
  per-mode resolution.

### (d) Chain-arm suppression (provider applyCompletion plain-key branch)

- Before `chain.arm(key)` in the non-CHAIN_KEY_PREFIX branch: look the
  accepted item up in `lastLive?.matches` (`m => m.display === item.value`,
  ≤ 8 entries); if found and `m.tier === 0`, skip arming (comment: tier-0
  anchorless matches never arm — spec §04; strict `=== 0` so shim and
  listing records, which omit tier, keep arming). If NOT found (stale/null
  lastLive), arm as before — fail-open. CHAIN_KEY_PREFIX branch untouched.
- Widget: add a comment at the widget Tab insertion site stating the widget
  path NEVER arms a chain (WidgetOpts.chain is unwired by design;
  `chain.arm` exists only in provider applyCompletion, :644–686) + a
  no-arm pin test (below). Do NOT wire widget arming.

### Success Criteria

- [ ] `#query` → `src/core/query.ts` (path key) present WITHOUT any anchored
      match existing; same query in ambient mode returns the anchored result
      set byte-identically (no tier-0 when anchored non-empty)
- [ ] `#cfg` → tier-1 `config…` admits at 45; ambient `cfg` gates it (60)
- [ ] Explicit `fuzzThreshold: 80` overrides both modes on BOTH paths
- [ ] Dedup: a key matching anchored and anchorless appears ONCE (anchored tier wins)
- [ ] tier-0 acceptance does not arm; tier 1–3 / chain-shim / `#`-alone acceptances arm (armViaTab-based cases)
- [ ] Widget Tab acceptance never arms (pin test)
- [ ] `npm run check` + `npm test` green; ambient suites unchanged

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they implement this
successfully?" — Yes: every call site is line-anchored with current code
quoted/referenced, the upstream helper signatures are pinned, the
scout-corrected widget/chain reality is documented, and all test
conventions/harnesses are named.

### Documentation & References

```yaml
- docfile: plan/004_24ebf0115d16/architecture/system_context.md
  sections: §Display paths, §Chain-arm reality (SCOUT-CORRECTED — trust over PRD)
  why: verified anchors — extractMatchState (provider.ts:67–100) already
        returns the mode union; provider call site :599–603 passes flat
        config.fuzzThreshold with state.mode in scope; widget default query
        closure :436–440 takes ONLY a fragment but createVisibilityMachine
        branches on mode (:617/:627/:701) where query runs; WidgetOpts.chain
        (widget.ts:122–124) is wired by index.ts and read by NO widget code;
        chain.arm exists ONLY in provider applyCompletion (:644–686);
        liveKeyByValue stores ONLY the key string (tier unreachable) —
        look the item up in lastLive.matches instead.

- docfile: plan/004_24ebf0115d16/architecture/tier0_design.md
  sections: §3–§5
  why: optional-tier design (shims/listing omit tier; strict === 0 check),
        dedup semantics, loose-mode entry design space.

- file: plan/004_24ebf0115d16/P1M1T2S1/PRP.md
  why: CONTRACT (parallel): `resolveFuzzThreshold(config, mode:
        "trigger"|"ambient")` exported from src/pi/config.ts;
        TRIGGER_FUZZ_THRESHOLD=45 from src/core/query.ts; explicit
        fuzzThresholdSet overrides both modes. Do not duplicate.

- file: src/core/query.ts
  why: tier-0 pass landed by P1.M1.T1.S1 — ambient fallback (zero-result
        precondition, L~383–494 region), TIER0_BASE_SCORE/TIER0_SKIP_FACTOR
        (:114–115), RankedMatch.tier (L~148: "0 = anchorless; listing items
        omit tier so tier===0 unambiguously means anchorless"), RankOptions
        (:133), and the L~394 note "the always-consulted (loose) variant is
        P1.M1.T2.S2, not this [task]" — your insertion marker.

- file: src/pi/provider.ts
  why: call site :599–603 (quoted above); lastLive (:274) +
        liveKeyByValue (:275, rebuilt :616–617 as Map<display→key> from
        matches); publishChain fabricated shims (:461–480, no tier field);
        applyCompletion arm branches (:640–686, CHAIN_KEY_PREFIX vs plain
        key with the path-key arm rationale comment); chain membership gate
        (~:540–560) ALREADY anchored — no change.

- file: src/pi/widget.ts
  why: deps.query default closure (:436–442); extractMatchState call (:588)
        + match.mode branches (:617/:627/:701); WidgetOpts.chain (:122–124,
        unwired). Signature change ripples to WidgetOpts.query type + all
        stub fixtures in test/widget-visibility.test.ts / widget.test.ts.

- files: test/chain.test.ts (armViaTab helper :202–218 — the arming
        harness), test/chaining-gating.test.ts, test/provider-match.test.ts,
        test/widget-visibility.test.ts (deps.query stub + fakeEditor
        fixtures), test/query.test.ts (existing tier-0 bullet block to
        extend with the `#`-mode cases)
  why: the four suites this task extends, with their conventions.

- PRD §04 h2.28 (tier-0 + trigger loosening — normative), §07 h2.45
  (match gates per mode), §09 h2.55 query.test.ts bullets.
```

### Current Codebase tree (relevant)

```bash
src/core/query.ts        # RankOptions.loose + unconditional tier-0 + dedup
src/pi/provider.ts       # call site + arm suppression
src/pi/widget.ts         # query seam signature + no-arm pin comment
test/{query,provider-match,widget-visibility,chain,chaining-gating}.test.ts
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: the widget Tab site NEVER arms — "suppression at both Tab
// sites" reduces to WIRE the provider site + PIN the widget site. Do not
// invent widget arming; WidgetOpts.chain being unwired is verified reality.

// CRITICAL: liveKeyByValue maps display→key ONLY — tier is not there.
// Find the accepted record in lastLive.matches (≤8) by display; if absent
// (stale/null), arm as before (fail-open — suppression only on KNOWN tier 0).

// CRITICAL: strict `tier === 0` — shim entries and '#'-alone listing
// records omit the field; `tier <= 0` or falsy checks would stop shims
// arming and break chaining.

// GOTCHA: dedup must run in the loose path BEFORE merge/sort; implement
// the skip unconditionally (vacuous ambient) — one code path.

// GOTCHA: deps.query signature change breaks existing widget stubs —
// update fixtures in the same change; rm() fixtures are unaffected
// (tier optional). Keep ambient default 60 + zero-result precondition.

// GOTCHA: resolveFuzzThreshold lives in src/pi/config.ts but widget.ts and
// provider.ts are both in src/pi — fine. src/core/query.ts must NOT import
// from src/pi (core invariant): loose is a plain boolean, mode resolution
// stays in the pi layer.
```

## Implementation Blueprint

### Implementation Tasks (ordered, TDD)

```yaml
Task 1: TDD cases (red) across the four suites:
  - test/query.test.ts (extend the tier-0 bullet block):
    * '#query' via rankMatches(store, "query", {loose:true,
      fuzzThreshold:45}) → path key present even with non-empty anchored
      results for other keys; ambient call (no loose) on the same store
      byte-identical to pre-change output
    * '#cfg': tier-1 config_manager_service admits at 45, gated at 60
    * explicit 80 overrides both (loose call with fuzzThreshold:80)
    * dedup: 'queue' under '#que' (tier-3 + indexOf=0) appears ONCE, tier 3
    * floor: '#qu'-style 2-char fragment runs no tier-0 even when loose
  - test/provider-match.test.ts: mode-aware pass-through — trigger-mode
    getSuggestions uses 45/loose (assert a tier-0-only or tier-1 result
    appears), ambient unchanged, explicit override wins
  - test/widget-visibility.test.ts: deps.query receives (fragment, mode);
    trigger keystrokes drive loose queries; rm() fixtures unaffected
  - test/chain.test.ts + chaining-gating.test.ts via armViaTab:
    * tier-0 acceptance (construct lastLive with tier:0 record) →
      chain.state() === null
    * tier 1/2/3 acceptance → arms; chain-shim acceptance (publishChain
      path) → arms; '#'-alone listing acceptance (tier omitted) → arms
  - widget no-arm pin: widget Tab acceptance with WidgetOpts.chain present
    → chain machine state never changes (assert via a spied chain in deps)

Task 2: EDIT src/core/query.ts — RankOptions.loose + JSDoc; unconditional
  tier-0 fire condition; unconditional dedup skip; update the L~394 note.

Task 3: EDIT src/pi/provider.ts — resolveFuzzThreshold import; call-site
  rewrite per (b) + comment; arm suppression per (d) + comment.

Task 4: EDIT src/pi/widget.ts — query seam signature (default closure +
  WidgetOpts.query type), machine passes mode, no-arm pin comment at the
  Tab insertion site. Update deps.query stubs in widget tests.

Task 5: VALIDATE (all four suites, full npm test, npm run check).
```

### Implementation Patterns & Key Details

```ts
// Tier-0 fire + dedup (single path):
const runTier0 = (opts.loose === true || recs.length === 0)
  && lower.length >= TIER0_MIN_FRAGMENT;
// in the tier-0 loop, before pushing:
if (recKeys.has(k)) continue;   // recKeys: Set built from anchored recs
// (build the Set only when the tier-0 pass actually runs — ambient cost
// unchanged since it only runs on the empty path)

// Arm suppression (provider applyCompletion, plain-key branch):
const rec = lastLive?.matches.find((m) => m.display === item.value);
if (rec?.tier === 0) {
  // tier-0 anchorless: never arms (§04). Strict ===: shims/listing omit tier.
} else if (key !== undefined) {
  chain.arm(key); chainWordsSeen = 0; chainLastArmedPrefix = null;
}
```

### Integration Points

```yaml
CONSUMES: resolveFuzzThreshold + fuzzThresholdSet (T2.S1, in flight);
          RankedMatch.tier + ambient tier-0 (T1.S1, landed)
CODE: query.ts (additive loose flag), provider.ts (2 sites), widget.ts (seam)
FROZEN: chain membership gate (:540–560), CHAIN_KEY_PREFIX branch,
        ambient defaults, config schema, core↔pi import direction
DOWNSTREAM: P1.M2.T1 README sweep documents this user-visible behavior
```

## Validation Loop

### Level 1–2

```bash
npm run check
npx vitest --run test/query.test.ts test/provider-match.test.ts \
  test/widget-visibility.test.ts test/chain.test.ts test/chaining-gating.test.ts
npm test
```

### Level 3: Behavior spot-check

```bash
# '#' query finds mid-word/path candidates ambient mode never surfaces;
# ambient word-typing output byte-identical (run query suite twice, diff);
# tier-0 Tab → no chain; shim Tab → chain armed.
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green; ambient behavior byte-identical
- [ ] Loose mode live on provider AND widget via the shared resolver
- [ ] Explicit fuzzThreshold overrides both modes on both paths
- [ ] Dedup (anchored wins) + fragment floor 3 under loose
- [ ] tier-0 never arms; tier 1–3/shim/listing arm; widget Tab never arms (pinned)
- [ ] lastLive-absent arm path fails open; CHAIN_KEY_PREFIX branch untouched
- [ ] JSDoc on RankOptions.loose + call-site comments (Mode A)
- [ ] No core→pi imports introduced

## Anti-Patterns to Avoid

- ❌ Inventing widget arming to "complete" the suppression story — the
  widget site is a PIN, not a wire
- ❌ `tier <= 0` / falsy checks (kills shim and listing arming)
- ❌ Extending liveKeyByValue's value shape when a ≤8 lastLive scan suffices
- ❌ Duplicating threshold-resolution logic at either call site — one helper
- ❌ Dropping the zero-result precondition for ambient mode
- ❌ Touching the already-anchored chain membership gate
- ❌ Importing config resolution into src/core

---

**Confidence Score: 9/10** — all call sites line-anchored from live source,
upstream contracts pinned, the scout-corrected widget/chain reality
documented, and every test harness named with its helper (armViaTab,
deps.query stubs, fakeEditor).
