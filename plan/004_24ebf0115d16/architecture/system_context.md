# System context — plan 004 (Tier-0 anchorless fallback + `#` loose mode)

Status: CONFIRMED against `main` (b26a917) by direct read + scout recon.
All line numbers verified 2026-10-30.

## Headline

- **Spec is AHEAD of code by design**: `spec/04-tokenization-and-scoring.md`
  (§ "Query matching", lines 397–500) already contains the tier-0 + `#`
  loose-mode owner rules, marked "status: adopted ahead of implementation —
  code lands with this spec". This run lands the code; **spec/*.md are
  READ-ONLY** (staged sync = current PRD). Drift goes in the run report only.
- `src/core/query.ts` implements tiers 1–3 only. No TIER0 constant, no
  anchorless pass, no mode plumbing anywhere. Confirmed: grep for `tier`
  finds no tier-0 match class; the only `tier: 0` is the zero-fragment
  listing sentinel.
- Already-shipped deltas verified in git history: `b26a917` (widget
  session_start rebind), `27c61c2` (rule-4d trailing trims + long-path
  unmask). NOT in scope this run.

## The matching core (src/core/query.ts, 446 lines)

Exported surface (the seam this delta extends):

| Symbol | Line | Role |
|---|---|---|
| `DEFAULT_LIMIT = 8` | ~47 | max results |
| `TIER3_SCORE=100, TIER2_BASE_SCORE=85, TIER2_SKIP_FACTOR=40, TIER1_BASE_SCORE=50, TIER1_GAPRUN_PENALTY=5, TIER1_GAPCHAR_CAP=15` | ~66–72 | exported calibration constants; arithmetic single-sources them |
| `DEFAULT_FUZZ_THRESHOLD = 60` | ~96 | ambient default; config.ts imports it as schema default |
| `RankOptions { limit?, fuzzThreshold? }` | ~100–113 | **no mode field today** |
| `MatchResult { tier: 1\|2\|3; score }` | ~122–127 | union must widen for tier 0 |
| `matchFragment(f, c): MatchResult \| null` | ~196 | ANCHORED matcher: anchor char → tier-3 prefix → tier-2 `indexOf(tail,1)` → tier-1 greedy two-pointer |
| `RankedSortRecord { tier: number; m: RankedMatch }` | ~263–273 | internal; `tier` is plain number (already accommodates 0) |
| `compareRankedMatches(a,b)` | ~296–320 | 4-key order: `b.tier - a.tier` → sessionCount desc → shorter → byte-lex. **Works for tier 0 unchanged** |
| `rankMatches(store, prefix, opts)` | ~352–431 | the function this delta extends |

### rankMatches control flow (verified verbatim)

```
limit guard → lower = prefix.toLowerCase()
bucket = lower === "" ? "" : lower[0]              // first-char bucket entry
[start,end] = store.prefixRange(bucket)            // MUST be called before snapshot
keys = store.sortedKeysSnapshot().slice(start,end) // INDEX ORDERING INVARIANT (module doc)
threshold = opts.fuzzThreshold ?? DEFAULT_FUZZ_THRESHOLD
recs: RankedSortRecord[] = []
for k of keys:
  tier = 0                                          // ONLY reachable when lower === ""
  if lower !== "":
    m = matchFragment(lower, k)
    if m === null || m.score < threshold: continue  // STRICT <; == survives
    tier = m.tier
  c = store.get(k); if !c: continue                 // evicted-since-rebuild guard
  recs.push({tier, m:{key, display, description:`session x${count}`, salience, sessionCount}})
recs.sort(compareRankedMatches)
matches = recs.map(r => r.m)                        // tier STRIPPED before return
plural pruning (exact single-"s" pairs) → slice(0, limit)
```

- **Zero-result return shape**: plain `[]` (plural pruning is skipped when
  `matches.length <= 1`). The tier-0 fallback slots in exactly at
  `lower !== "" && recs.length === 0` (ambient) — see tier-0 design note.
- **The zero-fragment `tier: 0` collision**: today `tier: 0` on a sort record
  means "no tiers" (`#`-alone listing), NOT a match class. Zero-fragment and
  match paths are mutually exclusive (the sentinel is only assigned when
  `lower === ""`). After this delta `tier: 0` ALSO means "anchorless match
  class". Per PRD: rename or pin with a comment — do not let it silently
  bite. The spec's order `3 > 2 > 1 > 0` makes the comparator treat both
  identically anyway (sorts last), so the pin is documentation-level, but
  `RankedMatch.tier` exposure (below) MUST be explicit about which meaning
  a consumer sees.
- **Store iteration for the anchorless pass**: no bucket to enter — full
  store is `prefixRange("") → [0, n)` then `sortedKeysSnapshot()` (same
  pattern as the zero-fragment listing and perf gate a3). Respect the module
  doc's ordering invariant: prefixRange first, then snapshot.

## Spec rules (binding, spec/04:397–500 verbatim digest)

1. **Tier 0 — anchorless contiguous run**: fires when the threshold-gated
   ANCHORED scan (tiers 1–3) returns zero — and only then (ambient mode).
   ONE contiguous run anywhere in the key (`c.indexOf(f)`; "or at first
   position" arm is redundant — position 0 implies an anchored tier-3 match
   existed). Fragment floor **3 chars**. No anchor, no subsequence, no
   boundary rules. Score `85 − 40·(runStart/len(c))` → ~45–85, rounded
   (Math.round) and clamped [0,100] like the others (`clampScore` exists).
   Threshold-gated with the SAME threshold (strict `<`, `==` survives).
   Sorts BELOW tier 1: `3 > 2 > 1 > 0`.
2. **`#` loose mode**: (a) tier-0 ALWAYS consulted — no zero-result
   precondition (`#query` → `src/core/query.ts` directly); (b) tier-1
   visible — mode default threshold **45** (ambient 60; 45 < tier-1 max 50,
   so only strongest scattered admit: `#cfg` → `config_manager_service`).
   Explicitly set `fuzzThreshold` overrides BOTH mode defaults.
3. **Chaining stays anchored everywhere**: chain arming and the chain gate
   consult tiers 1–3 only; tier-0 matches never arm or extend a chain.
4. **Perf**: anchorless pass scans the full store (no bucket; measured
   1.1–2.6 ms at 20k cap, synthetic). Own budget **< 3 ms p99, CI gate at
   3× (= 9 ms)**, mirroring existing gate structure. Fires only on the
   empty-anchored path (ambient) — common case never pays it.
5. **Integration item 2 amendment (spec 09)**: "no menu for common words"
   now reads "no menu for common words WITH ANCHORED MATCHES; the
   zero-result fallback may surface contiguous-run cousins."
6. Score arithmetic sanity pins (spec/04 + PRD): `query` →
   `src/core/query.ts`: runStart 9, len 17 → 85 − 40·(9/17) = 63.8 →
   **64**. `esk` → `zendesk`: runStart 2, len 7 → 85 − 11.4 = **74**
   (Math.round). Default-60 pass band: runStart/len ≤ 0.625 (front ~62%).

### CRITICAL dedup requirement (`#` mode only)

Under `#`, tier-0 is consulted EVEN WHEN the anchored scan returned results.
A key can match BOTH paths (e.g. `#que` on `queue`: tier-3 anchored AND
`indexOf('que')=0` anchorless; `#cfg`-class keys can be tier-2 anchored and
also contain the run elsewhere). **The tier-0 pass MUST skip keys already
admitted by the anchored scan** (dedupe by key, anchored record wins — its
tier is higher and already sorted above). In ambient mode the precondition
(recs empty) makes dedup vacuous, but implement the skip unconditionally so
one code path serves both modes.

## RankedMatch contract change (src/core/types.ts:164)

Today exactly 5 fields — **pinned by test/query.test.ts:191** ("every
result carries exactly the five RankedMatch fields" — that pin MUST be
updated with the field addition):

```ts
interface RankedMatch { key; display; description; salience; sessionCount }
```

This delta adds a `tier` diagnostic field (0|1|2|3) — follows the existing
diagnostics pattern (salience: "carried for diagnostics, never orders";
sessionCount orders). Motivation: neither chain-arm site can see the matched
tier today; spec rule 3 requires suppressing arming on tier-0 acceptance.
Note query.ts's own JSDoc currently says tier is "deliberately NOT on
RankedMatch" — that comment must be rewritten with the field addition
(Mode A doc-with-work). The internal `recs.map(r => r.m)` strip must now
COPY the tier into the public record instead. Decide + pin the value for
zero-fragment listing items (they keep internal tier 0; document that
`RankedMatch.tier === 0` on a `#`-alone listing means "listing", not
"anchorless match" — mutually exclusive paths — or use a distinct sentinel;
PRD's guidance: "rename or pin with a comment").

## Config seam (src/pi/config.ts)

- `HapaxConfig.fuzzThreshold: number` (REQUIRED, :73) — doc comment says
  "one number, never two"; `DEFAULT_CONFIG.fuzzThreshold =
  DEFAULT_FUZZ_THRESHOLD` at :101 (constant at query.ts:107 area);
  `applyLayer` merge block at **:261–271** writes
  `next.fuzzThreshold = clampNumber(v, 0, 100)` (silent round-then-clamp;
  wrong type repairs with exactly one warning). `loadConfig` (:348–367)
  spreads DEFAULT_CONFIG then layers `~/.pi/agent/hapax.json` then trusted
  `.pi/hapax.json` (later wins). **Explicit-set is indistinguishable from
  default** — the exact gap the PRD names.
- Required resolution semantics (spec 04/08): explicit value → BOTH modes;
  unset → 60 ambient, 45 under `#`. NO new user-facing config key — per-mode
  defaults are resolution semantics of the EXISTING knob (spec/08 "Not
  configurable" :73–83 pins tier constants as internal; schema row already
  documents the per-mode text). Signal options (scout-2):
  (a) optional `fuzzThreshold?: number` + internal `fuzzThresholdSet`
  flag; (b) optional field only, consumers resolve `?? perModeDefault(mode)`
  — matches the established "absent = DEFAULT" convention (query.ts:377
  `opts.fuzzThreshold ?? DEFAULT_FUZZ_THRESHOLD`). Either is acceptable;
  resolution MUST live in ONE shared helper consumed by provider + widget.
- New exported constant for the 45 default belongs in query.ts next to
  `DEFAULT_FUZZ_THRESHOLD` (single source; config.ts already imports from
  query.ts — the rejectCommonness pattern).
- config.test.ts patterns to extend: round-trip :359–362, clamp :366–379
  (−5→0, 150→100, 100.7→100, 60.4→60), repair :384–388 (exactly one
  warning), via `writeUserConfig` + `loadConfig(loadOpts())`.

## Display paths (both pass threshold today — both need mode-aware calls)

- **Provider fallback path**: `src/pi/provider.ts:599–603` —
  `rankMatches(store, state.fragment, { limit: config.maxSuggestions,
  fuzzThreshold: config.fuzzThreshold })`. `[]` → clears live cache and
  delegates (never-hijack). After tier-0, rankMatches itself returns the
  rescued set, so the `[]`-delegate contract is untouched.
- **Widget primary path**: `src/pi/widget.ts:437–442` —
  `deps.query ?? ((fragment) => rankMatches(deps.store, fragment,
  {limit, fuzzThreshold: deps.config.fuzzThreshold}))`. NOTE: the closure
  takes ONLY a fragment — mode is not plumbed. The widget re-derives state
  per tick; the mode comes from `extractMatchState` (provider.ts:70+, 
  returns discriminated union `{mode:"trigger", fragment, prefix} |
  {mode:"word", ...}` — mode IS already available at extraction time).
- **Shared resolution helper** (PRD): one function resolving
  (config, mode) → threshold to avoid the two call sites diverging.

## Chain-arm reality (scout-verified — corrects the PRD's assumption)

- **The widget/PRIMARY path NEVER arms a chain.** `insertHighlighted`
  (widget.ts:853–910) inserts via `inner.setText` + `setCursorCol` and hides;
  `WidgetOpts.chain` (widget.ts:122–124) is wired by index.ts (:248, :282,
  reset :402) but **read by no widget code**. `grep chain.arm src/pi` finds
  only provider.ts:662,674. So "suppress arming at both Tab sites" is in
  reality: **WIRE the provider site; VERIFY + PIN the widget site** (comment
  + test asserting no arming, so future widget arming respects tier).
- **Provider arm site** (real): `applyCompletion` intercept at provider.ts
  **:644–686** — `if (config.enableChaining) { const key =
  liveKeyByValue.get(item.value); if (key !== undefined) { … chain.arm(key) }}`
  then verbatim delegation. **`liveKeyByValue` stores only the KEY string**
  (Map<value → key>), so tier is not reachable today — suppression needs a
  lookup into `lastLive.matches` (≤8 items) or extending the map value.
  Chain-shim keys use `CHAIN_KEY_PREFIX` and take the `armed(next)` branch.
- **Chain-shim entries are FABRICATED RankedMatches** (`publishChain`,
  provider.ts ~:455–470: key=`CHAIN_KEY_PREFIX+s.next`, salience:`-count`,
  sessionCount:`count`). A REQUIRED `tier` field would break them → the
  diagnostic should be **optional** (`tier?: 0|1|2|3`), populated only by
  the match path; shims omit it. Arming check is strict `=== 0`, so omitted
  tiers keep arming (correct: chain-shim accepts extend chains through the
  anchored membership gate — spec allows arming on anchored tiers).
- **Zero-fragment (`#`-alone) listing items**: accepting one arms today
  (provider :674 "whole-word candidate (incl. trigger-mode completions)").
  If listing items carried `tier: 0`, suppression would silently kill that
  existing behavior → listing items should OMIT tier (or use a distinct
  sentinel); `tier === 0` must unambiguously mean ANCHORLESS MATCH.
  Zero-fragment internal sort records keep uniform tier 0 (mutually
  exclusive paths — pin with comment per PRD).
- Widget `currentSet` keeps only `{display}` rows (widget.ts:519) — tier is
  not plumbed to render/highlight; fine, since the widget never arms.
- Chain MEMBERSHIP gate already anchored (armed-branch filter
  `matchFragment(frag, s.next) !== null` at threshold 0, provider.ts
  ~:540–560; tests chain.test.ts:651+) — no change, per PRD/spec.

## Test surfaces (where pins land)

- `test/query.test.ts` (~700 lines): describes for empty results (:124),
  result shape (:174 — the 5-field pin at :191), ordering (:217, brute-force
  oracle at :86–110 special-cases `"" → tier: 0`), comparator (:296),
  zero-fragment listing (:348), plural pruning (:542), path candidates
  (:603). Tier pins compute expected scores from the exported TIER*
  constants (single-sourced, header :28–32). New tier-0 describes slot after
  "empty results"/near "ordering"; comparator describe gains 3>2>1>0 rows.
- `test/perf-gates.test.ts`: gate pattern fully quoted in
  external_deps/perf-notes; gate a3 (zero-fragment full-store listing,
  loose tripwire <25 ms) is the closest precedent for a full-store pass.
  New gate: anchored-empty fragment over the 20k store, 1000 samples,
  `expect(p99).toBeLessThan(9)` (3 ms budget × 3), console.log actuals.
  **Fixture caveat**: bench-fixtures keys are synthetic random-letter
  (`storeWord`, seed 42) — an anchored-empty fragment must be probed for
  (may need a seeded probe or dedicated fixture tweak so the fallback
  actually fires).
- `test/config.test.ts` (579 lines): clamp + repair-warning patterns exist
  for every knob — extend for the explicit-vs-default signal.
- `test/chain.test.ts`, `test/chaining-gating.test.ts`: chain-arm assertion
  patterns; add anchored-only arming (tier-0 accept does not arm).
- `test/provider-match.test.ts`, `test/widget-visibility.test.ts`: mode
  wiring (`#cfg` → `config_manager_service`).

## Invariants this delta must not break (spec/SPEC.md)

Tab-only completion; menu never renders with zero candidates (tier-0 only
RESCUES empty sets — byte-identical pin when anchored non-empty); RAM-only;
no persistence/telemetry/network; < 1 ms anchored keystroke budget
unchanged (tier-0 has its own < 3 ms budget); tier BOUNDARIES are semantics,
never tunable (only per-mode thresholds are runtime surface).
