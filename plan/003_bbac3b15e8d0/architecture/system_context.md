# System context — delta PRD 003 (M3: R_eff, path candidates, anchored fuzzy, one-line widget)

Synthesis of the five research streams for this run. Canonical detail lives in the
sibling files; this orients downstream PRP agents and records PRD-vs-code reality
checks. Repo state: commit `af63f1d` ("docs: spec M3"); spec describes the TARGET
state (sanctioned spec-first order); code lags by exactly the R1–R4 delta.

## Orientation

- Layout: `src/core/` (dictionary, segment, shapeGate, score, store, query, types) →
  `src/pi/` (config, ingest, provider, editor, debug, index). Tests `test/*.test.ts`
  (vitest), hard perf gates `test/perf-gates.test.ts`, bench `test/bench/core.bench.ts`.
  Commands: `npm run check` (tsc --noEmit), `npm test`, `npm run bench`.
- Spec files are READ-ONLY this run. `plan/` is historical artifact, never authoritative.
- Detailed maps (verified line refs, this commit):
  - `r1-admission-reff.md` — score.ts admission/guard/relief, knob flow, calibrate probe.
  - `r2-path-candidates.md` — segment/shapeGate/store, rule 4d insertion points.
  - `r3-query-fuzzy.md` — query.ts matcher/ranking/scan/config/perf.
  - `r4-widget-pi-api.md` — provider/editor/index pi-layer + pi 0.84.4 editor API.
  - `r5-spec-readme-dod.md` — spec 09 acceptance contract, README drift, DoD pattern.

## PRD reality checks (verified)

All five verdicts: **feasible**. Corrections/notes vs PRD assumptions:

1. **R1** — PRD says guard "currently comparing stems against the FLAT threshold":
confirmed; tier-2 additionally compares against flat `MID_FREQ_THRESHOLD` (20) when
the word is absent. PRD pins both tiers → `R_eff(len(word))` (word length, not stem).
`configurations` REJECTS today (stem q=26 ≥ 12) and must flip to ADMIT.
   - Trap: len ≥ 20 "admit-all" must never reject, but naive `R_eff=255` with
     `q >= R_eff` rejects q=255 words — special-case (sentinel/clamp).
   - Knob `rejectCommonness` reaches `admit()` per-call (ingest.ts:558–563);
     R_eff must be computed from the resolved floor, so knob scaling is free.
   - `test/calibration.test.ts` prose store-EMPTY gate may break (long common prose
     words flip to admitted) — fixture re-audit is in scope.
2. **R2** — PRD says "the literal scan window is already sized 96": **wrong in code** —
   `LITERAL_RE` is `{4,80}` (segment.ts:63) vs spec 96; the widening MUST land with 4d.
   Store needs zero changes (recency-wins display merge already generalizes); audit
   every `display.toLowerCase() === key` assumption. Bigrams take path keys
   automatically (whole-token entries). 800 KB ingest gate headroom is thin
   (~174–187 ms baseline vs 180 ms CI bound) — re-measure after widening.
3. **R3** — `compareRankedMatches` is length→byte-lex today; the entire ordering test
   block (query.test.ts:181–257), oracle, and limit tests encode the retired order —
   the test rewrite is the bulk of the diff. RankedMatch is a pinned 4-field contract;
   it gains `sessionCount` (provider mapping in lockstep). Default
   `DEFAULT_FUZZ_THRESHOLD = 60` gates out ALL tier-1 scattered matches (max 50) —
   intended; pin it. Perf gate fixture (`HOT_PREFIX="co"`, ~150-key range)
   understates the new ~n/26 first-char bucket — re-base.
4. **R4** — pi 0.84.4 exposes `ctx.ui.getEditorComponent()/setEditorComponent()`
   (types.d.ts:171,173); `EditorFactory = (tui, theme, keybindings) => EditorComponent`.
   Technique proven by shipped examples: subclass/override `render(width)` composing
   on the inner lines (border-status-editor) and consume keys in `handleInput` before
   delegating (modal-editor). Compose as a SECOND proxy layer over the v2
   enter-submit proxy (never mutate inner). `render(width)` is the ONLY width source
   (cache it). Repaint: capture `tui` in the factory wrapper (`tui` is protected) or
   ride per-keystroke renders. Branch on `getEditorComponent()` FIRST in session_start,
   before `addAutocompleteProvider`. The four pi-tui PINs are fallback-path-only.
5. **R5** — README stale in ~12 places (list with line refs in r5 file §4);
   `docs/M1-DoD.md` M2 section at :265 defines the append pattern for M3; integration
   items 1 (M3 clause), 2 (capture window), 7 are verbatim-captured in r5 §2.

## Cross-cutting handoff map (coherence contract)

- `rEff(floor, len)` exported from `src/core/score.ts` (S M1.T1.S1) → consumed by
  guard (M1.T1.S2), calibrate-bands.mjs (M1.T1.S3), tests.
- Path tokens `{key: trimmed-lower, display: original-edges, path: true}`
  (M1.T2.S1) → shapeGate class caps (M1.T2.S2) → store/bigrams (M1.T2.S3) →
  query candidates (M2) → widget/Tab insertion display (M3) → integration item 7.
- `matchFragment(f, c) → {tier, score}|null` (M2.T1.S1) → threshold discard (M2.T1.S2)
  → `fuzzThreshold` config (M2.T1.S3) → ranking (M2.T2.S1) → chain membership gate
  (M2.T3.S1, threshold 0) → widget visibility ≥1-candidate rule (M3.T2.S1).
- Widget: dual-path branch + factory wrap (M3.T1.S1) → render line (M3.T1.S2) →
  visibility machine (M3.T2.S1) → key handling double (M3.T3.S1/S2) → live TTY (M3.T4.S1)
  → README + DoD (M4.T1).

## Settled decisions encoded in the breakdown

- Guard tier-2 also rides R_eff(len(word)) (PRD Task P1.M1.T1); `MID_FREQ_THRESHOLD`
  stays exported as a compatibility constant (tests + calibrate-bands import it).
- Group 2 survives only via the subword clamp; the dead MID table row is deleted.
- Proper-noun relief stays retired-in-place (ceiling 12 ≤ every R_eff when R ≥ 12;
  knob values above 12 keep it dead) — pinned, no behavior change.
- Chain membership gate uses the fuzzy matcher at threshold 0 for the chain duration;
  chain ranking stays successor-count-based (topSuccessors order, provider.ts:519 filter).
- Tier boundaries are semantics, never tunable; only `fuzzThreshold` is config.
- No spec edits this run; drift (if discovered) is recorded in the run report.
