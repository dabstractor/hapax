# Tier-0 + `#` loose mode — implementation design notes

Grounded in scout recon + direct reads (see system_context.md). Binding
spec text: spec/04 "Query matching (anchored fuzzy + anchorless tier-0)"
(:397–500), spec/07 "Trigger modes" (match-gates paragraph), spec/08 schema
row, spec/09 query.test.ts bullet + ranking bullet + integration item 2 +
perf-gate row.

## 1. rankMatches extension (ambient tier-0) — Task P1.M1.T1.S1

After the anchored loop, BEFORE sort (recs still tier-carrying):

```
if (lower !== "" && recs.length === 0 && lower.length >= 3) → anchorless pass
```

- Anchorless pass over FULL store: `prefixRange("")` → `[0, n)` then
  `sortedKeysSnapshot()` (zero-fragment-listing pattern; respect the
  module's prefixRange-before-snapshot ordering invariant). Per key:
  `runStart = c.key.indexOf(lower)`; `runStart === -1` → skip; score =
  `clampScore(Math.round(TIER0_BASE − TIER0_SKIP·runStart/len))` →
  `{tier: 0, score}`; strict `score < threshold` discard (== survives).
- Constants: spec formula is `85 − 40·(runStart/len(c))` — numerically
  identical to TIER2_BASE_SCORE/TIER2_SKIP_FACTOR but a DISTINCT semantic
  (runStart counts from 0, no anchor consumed). Export dedicated
  `TIER0_BASE_SCORE = 85` / `TIER0_SKIP_FACTOR = 40` (calibration-pattern
  JSDoc like TIER1/2/3 — PRD Mode A). Do NOT inline literals.
- `MatchResult.tier` union widens `1|2|3` → `0|1|2|3`. Comparator
  unchanged (`b.tier - a.tier` already sorts 0 below 1).
- The runStart=0 case cannot admit in ambient mode (a position-0 run is an
  anchored tier-3 match at score 100, which survives any threshold ≤ 100 —
  so recs would not be empty). Spec keeps the "either placement" arm
  formally; implement plain `indexOf` (the anywhere arm is operative).
- **Byte-identical isolation pin**: when the anchored scan yields ≥1
  admission, output must be byte-identical to pre-tier-0 (the fallback
  never enriches a non-empty menu) — spec/09 regression fixture.
- Pins: `esk`→`zendesk` (runStart 2, len 7 → 74), `query`→
  `src/core/query.ts` (runStart 9, len 17 → 64); floor 3 (1–2-char
  fragments never fire); late runs gate at default 60 (pass band
  runStart/len ≤ 0.625); comparator 3>2>1>0 rows.
- Plural pruning + limit slice run AFTER the fallback fills recs (fallback
  results are ordinary records; existing machinery applies unchanged).

## 2. RankedMatch.tier diagnostic — same subtask

- Add `tier?: 0|1|2|3` (OPTIONAL — chain shims and zero-fragment listing
  items omit it; see system_context §Chain-arm reality). Populated ONLY on
  the match path (anchored 1–3, anchorless 0). Update:
  - query.ts `recs.map(r => r.m)` strip → now copies tier into the public
    record; rewrite the "deliberately NOT on RankedMatch" JSDoc (:263–273
    area) and the zero-fragment tier-0 sentinel comment (pin the dual
    meaning: internal sort tier 0 for listings ≠ public anchorless tier 0).
  - types.ts RankedMatch doc (sessionCount/salience precedent wording).
  - test/query.test.ts:191 five-field pin → six-field (tier present on
    match-path results, absent on `#`-alone listing items).
- `tier === 0` (strict) is the anchorless signal for arming suppression.

## 3. Loose-mode entry (RankOptions) — Task P1.M1.T2.S2 consumes S1's pass

- Add a loose/trigger-mode flag to `RankOptions` (e.g. `loose?: boolean`
  or `mode?: "ambient" | "trigger"` — implementer's choice; document in
  JSDoc). Semantics: tier-0 pass runs UNCONDITIONALLY (no zero-result
  precondition, still floor-3), and results are appended BELOW tier 1 via
  the normal comparator.
- **Dedup (critical)**: under loose mode a key can match both paths
  (`#que` on `queue`: tier-3 anchored AND indexOf=0). Skip keys already
  admitted by the anchored scan (anchored record wins — higher tier).
  Implement the skip unconditionally (vacuous in ambient mode) so one code
  path serves both.
- Threshold under loose mode is resolved by the CALLER (see §4) and passed
  as `fuzzThreshold` exactly as today — rankMatches itself stays
  mode-default-agnostic except the loose flag (keeps the seam honest for
  direct callers; see DEFAULT_FUZZ_THRESHOLD JSDoc precedent).

## 4. Per-mode threshold resolution — Tasks T2.S1 (config) + T2.S2 (call sites)

- config.ts: expose explicit-vs-default. Recommended: `fuzzThreshold?`
  optional in HapaxConfig (absent = unset) OR keep required number + set
  flag — either way NO new user-facing schema key (spec/08 row already
  documents per-mode semantics; "Not configurable" list untouched).
- query.ts: export `TRIGGER_FUZZ_THRESHOLD = 45` (name per implementer)
  beside DEFAULT_FUZZ_THRESHOLD, JSDoc'd as the `#`-mode default
  (calibration starting point).
- ONE shared resolver, e.g. `resolveFuzzThreshold(config, mode)` →
  `explicit ?? (mode === "trigger" ? 45 : 60)`, exported from config.ts or
  query.ts; BOTH call sites consume it (PRD: "a shared resolution helper
  avoids divergence").
- Call sites: provider.ts:599–603 (fallback path; `state.mode` already in
  scope from extractMatchState :578) and widget.ts:436–440 (primary path;
  the `deps.query` default closure takes only fragment — thread mode: the
  visibility machine already calls extractMatchState at :588 and branches
  on mode at :617/:627/:701, so mode is available where the query runs;
  change the closure/query seam to (fragment, mode) or resolve inside).
- Under trigger mode pass `loose: true` + resolved threshold. Ambient
  unchanged (threshold 60 default, zero-result precondition).
- Pin: `#cfg` → `config_manager_service` (tier-1 at 45: score 50−5·gapRuns−
  min(gapChars,15) ≥ 45 admits only ≤1 gapRun/≤5 gapChars scattered);
  `#query` → `src/core/query.ts` (score 64) directly, no anchored match
  needed.

## 5. Chain-arm suppression — Task T2.S2

- Provider applyCompletion (:644–686): before `chain.arm(key)` for the
  plain-key (non-CHAIN_KEY_PREFIX) branch, look up the accepted item's
  RankedMatch (via `lastLive.matches` — value/display match — or extend
  `liveKeyByValue` to carry the match/tier) and SKIP arming when
  `m.tier === 0`. CHAIN_KEY_PREFIX branch (chain extension) untouched —
  successors passed the anchored membership gate.
- Widget: NO arming exists (WidgetOpts.chain unread) — add the pinning
  comment + a test asserting widget Tab acceptance never arms, so future
  arming respects tier. Do NOT invent widget arming.
- Chain membership gate (armed-branch matchFragment filter): NO change.

## 6. Perf gate — Task T1.S2

- New gate in test/perf-gates.test.ts mirroring gate a (:76–121):
  20k-store `makeStore(STORE_CAP)` fixture, warmup 100, 1000 samples,
  p99 = `dts[⌈0.99·N⌉−1]`, console.log actuals,
  `expect(p99).toBeLessThan(9)` (3 ms budget × 3 CI rule), header comment
  citing spec/09 row. Gate a3 (full-store zero-fragment listing, loose
  <25 ms tripwire) is the full-store precedent.
- Fixture caveat: synthetic keys are random-letter (seed 42); the gate
  fragment MUST have an EMPTY anchored result (so the fallback fires) —
  probe at setup (seeded scan for a 3+ char fragment whose first-char
  bucket yields zero admissions but whose indexOf hits ≥1 key; assert both
  sanity conditions in-test like gate a's range>500 assertion).
- `npm run bench` (test/bench/core.bench.ts) is reporting-only; add a
  matching bench case if structure warrants (PRD: "extend test/bench if it
  hosts the captured numbers" — pins live only in perf-gates assertions).

## 7. Docs (Mode A riders, per subtask) + Mode B final task

- Mode A: TIER0 constants JSDoc + matcher JSDoc (T1.S1); config.ts
  per-mode-default JSDoc on fuzzThreshold (T2.S1); RankOptions loose-flag
  JSDoc (T2.S2).
- Mode B (P1.M2.T1): README rows — :36–44 (three-tier bullet → four tiers
  + fallback + `#` loose mode), :429 (fuzzThreshold row → per-mode 60/45 +
  explicit-override), :194–195 (no-hijack prose → WITH ANCHORED MATCHES
  amendment per spec/09 item 2), :128–131 (chain blurb → tier-0 never
  arms). DoD: append to **docs/M1-DoD.md** (the ONLY DoD doc — no M2/M3
  files exist; follow its own gauntlet-item PASS pattern: date, re-runnable
  command, suite counts, gate table Budget|Measured|vs|CI bound|Verdict).
  Live smoke per spec/09 §Live verification: (a) zero-anchored-result word
  with a cousin → one-shot menu that narrows away; (b) `#query` completes
  `src/core/query.ts`; (c) Tab on a tier-0 `#` completion does not arm a
  successor offer. Ephemeral `pi --no-session` tmux run, capture-pane
  evidence, no instrumentation left behind.

## 8. Drift/verification notes (record-only; spec read-only this run)

- Module rows (editor.ts/debug.ts/paths.ts): agree ✅. Dict figures
  (48,802 / 850,554 B / LF 0.7445≈0.745): agree ✅ (shipped-dict.test.ts:13,
  spec/03:42). M2 DoD re-theme: pinned in acceptance.test.ts:838 ✅.
- "Decision log" is `spec/SPEC.md:67` (a section, not an artifact) — the
  PRD's "decision-log dictionary row" lives there; verify only, no edit.
- README:49 cites "(2026-10 decision log)" informally — fine.
- Out of scope (do not touch): widget rebind (b26a917), rule-4d (27c61c2),
  M1/M2/M3 behavior, spec/*.md edits, tier-boundary retuning.
