# Research — P1.M1.T2.S1 (plan 004): config explicit-vs-default + per-mode fuzz defaults

## Verified current state (source + system_context.md §Config seam, tier0_design.md §4)
- HapaxConfig.fuzzThreshold REQUIRED number (config.ts:73); DEFAULT_CONFIG
  bakes DEFAULT_FUZZ_THRESHOLD (60, query.ts:107) at config.ts:101 — the
  rejectCommonness auto-import pattern.
- applyLayer merge block config.ts:261–271: `"fuzzThreshold" in raw` →
  number → `next.fuzzThreshold = clampNumber(v,0,100)` (round-then-clamp,
  silent); wrong type → exactly one warning, keeps previous value.
- loadConfig (:348–367) spreads DEFAULT_CONFIG then layers user-global then
  trusted project file; later wins.
- query.ts: RankOptions.fuzzThreshold?: number with `?? DEFAULT_FUZZ_THRESHOLD`
  convention (the "absent = DEFAULT" precedent).
- test/config.test.ts harness: writeUserConfig (= writeConfig(userPath())),
  loadOpts(), h.warnings collector; existing describe at :351 with default
  identity (:359–362 — `loadConfig(loadOpts())` toEqual DEFAULT_CONFIG —
  LOAD-BEARING for design choice), round-trip, clamp (−5→0, 150→100,
  100.7→100, 60.4→60), wrong-type repair (one warning, "using 60").
- Spec §08 h2.52 schema row ALREADY documents per-mode semantics (60 ambient /
  45 trigger / explicit overrides both) — no spec edit, no new user key.

## Design decision (resolving the contract's either/or)
Chosen: keep `fuzzThreshold: number` REQUIRED in HapaxConfig (default 60 =
ambient default, unchanged shape so `toEqual(DEFAULT_CONFIG)` identity tests
and every existing consumer keep working) + an INTERNAL explicitness flag
`fuzzThresholdSet?: boolean` on HapaxConfig, set ONLY in applyLayer when the
key is present AND typeof number (i.e., post-clamp). Property semantics:
- absent/undefined on a fresh load (unset) → vitest `toEqual` ignores
  undefined-valued keys, so default-identity tests keep passing IF the flag
  is only assigned (never initialized to false) when explicit. Add
  `fuzzThresholdSet?: boolean` to the interface (internal seam, NOT part of
  the user-facing JSON schema — schema keys are what applyLayer reads; this
  is a load RESULT field; document "internal, not a config file key").
- wrong-type repair does NOT set the flag (repair keeps previous value AND
  previous explicitness — repaired-from-default stays unset → per-mode).
- layering: user sets 80 (flag true), project file omits key → spread keeps
  flag true and value 80 (later wins only on presence); project sets 50 →
  value 50, flag true; project sets "bad" → warning, value/flag unchanged.

## New pieces
- query.ts: `export const TRIGGER_FUZZ_THRESHOLD = 45 as const;` beside
  DEFAULT_FUZZ_THRESHOLD (JSDoc: `#`-mode calibration default, spec §04
  trigger loosening; below tier-1 max 50 so strongest scattered matches admit).
- config.ts: `export function resolveFuzzThreshold(config: HapaxConfig,
  mode: "trigger" | "ambient"): number` →
  `config.fuzzThresholdSet ? config.fuzzThreshold
   : mode === "trigger" ? TRIGGER_FUZZ_THRESHOLD : DEFAULT_FUZZ_THRESHOLD`.
  Mode string union chosen so provider (state.mode === "trigger") and widget
  (extractMatchState mode branch) both map trivially. Single source; S2
  consumes at provider.ts:599–603 and widget.ts:437–442.

## Test additions (extend the :351 describe)
- explicit round-trip resolves for BOTH modes (80 → 80/80).
- unset → 60 ambient / 45 trigger; fresh load keeps flag undefined.
- clamp cases preserve per-mode resolution AFTER explicit set (−5→0 → 0/0;
  60.4→60 → 60/60 — note explicit 60 ≡ ambient default numerically but still
  overrides trigger's 45: assert resolve(trigger) === 60 when set).
- wrong-type repair from fresh default → per-mode defaults (60/45), one
  warning containing "using 60".
- layering: user explicit + project absent keeps explicit; project repair
  keeps prior explicit.

## Upstream contract (P1.M1.T1.S2, parallel: perf-gate row in
test/perf-gates.test.ts) — no file overlap with config.ts/query.ts constants
beyond co-located edits; T1.S1 (tier-0 matcher) already landed TIER0 constants
in query.ts — additive edit beside them is safe.
