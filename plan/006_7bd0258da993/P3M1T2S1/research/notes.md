# Research notes — P3.M1.T2.S1 README sweep

Verified at HEAD 50a7801 (2026-10). Line anchors from `grep -n` on README.md
(626 lines); re-grep before editing (see drift note in PRP).

## Code constants (ground truth for defaults)

- `src/core/score.ts:109` — `REJECT_COMMON_THRESHOLD = 30` (commit 5855f83
  "loosen admission floor to R=30 (width-bound retune)"). README still says 12
  in TWO places: config table row (`:470`) and Calibration guarantee (`:426`).
- `src/pi/config.ts` `DEFAULT_CONFIG` (`:121-131` region): triggerChar `"#"`,
  threshold 2, **maxSuggestions 20** (README table `:469` says 8), rejectCommonness
  = REJECT_COMMON_THRESHOLD (30), fuzzThreshold = DEFAULT_FUZZ_THRESHOLD (60),
  menuDelayMs 0, enableChaining true, debug false. Only the two rows are wrong;
  all other table rows verified correct.
- `src/core/score.ts:152` — `PROPER_NOUN_ADMIT_CEILING = 30` — comment:
  "retired-in-place; scales with retunes" (ceiling == floor ⇒ relief branch
  admits nothing beyond the floor).
- `src/core/score.ts:169` — `PROPER_SERIES_TOP_BAND_CEILING = 135` — dictionary
  top-band ceiling; members in it are chain-only (h2.26).
- `src/core/score.ts:192` — `MID_CAP_RELAXED_BAND = 95` — single mid-sentence
  capitals admit under max(R_eff, 95) (P1.M1.T3.S2, landed 541efba).

## README anchors (measured, actual)

| Section | Lines | State |
|---|---|---|
| Status paragraph | :13 | unchanged by this task |
| `## Features` | :32 | add series + branch-hygiene blurbs; fix 2 casing sentences |
| "Case-preserving insertion" bullet | :~120 | STALE: "casing last seen in-session" — casing now resolved from tallies at completion time (P1.M2.T1.S1/S2, landed bad61ce/7b28849) |
| Chained bullet casing clause | :~184 | STALE: "display casing (most-recent-casing-wins)" |
| Relief blurb | :108-114 | rewrite (half-obsolete) |
| Calibration guarantee | :424-437 | STALE: "REJECT_COMMON_THRESHOLD = 12" + "45,118 of the 48,802 entries score q ≥ 12" |
| Config table | :467-474 | maxSuggestions 8→20, rejectCommonness 12→30 |
| `### Development` / `#### Checks` | :531 / :606 | extend adversarial-suites sentence |

## Behavior contracts (dependencies)

- **Capitalized series** (spec 04 h2.26, 01 h2.9; P1.M1/P1.M2 landed or
  contracted): runs of ≥2 consecutive whole capitalized tokens; members admit
  regardless of commonness band (attested → group 1, absent → group 0); members
  in the dictionary top band (q ≤ 135) are chain-only (never standalone, still
  chain via bigrams — `The ` offers `Fed`); singles admit under max(R_eff, 95);
  insertion casing from tallies (typed capital preserved; lowercase fragment →
  frequency-wins, ties→lowercase, capitalized-only completes capitalized);
  series-first zero-char offers; typed-word arming: a space closing an
  UPPERCASE-initial typed word arms (lowercase never arms) — P1M2T2S1 PRP
  (fallback, provider.ts) + P1M2T2S2 (widget mirror, spec 07 h2.53).
- **Branch hygiene** (spec 05 h2.37; P2 COMPLETE, landed 50a7801):
  `session_tree` → guard → discardPending → getBranch() snapshot → gated
  in-place replay (reset() + restore pipeline) → onSettled releases the query
  gate; compaction never triggers a rebuild; `test/branch-purity.test.ts`.
- **Tab deferral** (P3.M1.T1.S1 PRP contract — Implementing in parallel):
  widget Tab with `isShowingAutocomplete() === true` forwards verbatim (pi's
  menu accepts); keyed on actual open state, not classification;
  `test/defer-pi-menu.repro.test.ts` 4/4 regression battery; spec 07
  h2.46/h2.51 clauses land with it.

## Recomputing the stale population count

`tools/calibrate-bands.mjs` computes `popReject = count(q >= T)` internally
(:141) and prints population stats; run `node tools/calibrate-bands.mjs
the with context handoff` to see q values; derive the q ≥ 30 entry count from
the tool's population output (or a throwaway node script replicating its
quantile logic). Named examples still valid at floor 30: the(240),
with(179), this(197), context(51), data(82), code(91), lazy(67),
ordinary(79), provider(34) all q ≥ 30; handoff q=10 still admits.

## Scope guard

Spec is READ-ONLY for this pipeline item (AGENTS.md / PRD h2.1). README must
cohere with spec + code; no live-verification claims beyond what's already
landed (live smoke is S3; DoD append is S4).
