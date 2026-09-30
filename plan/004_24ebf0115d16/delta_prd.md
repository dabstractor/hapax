# hapax Delta PRD — Tier-0 Anchorless Fallback + `#` Loose Mode

**Base:** spec at `main` (b26a917) + staged spec sync (spec/*.md already at the
current PRD text — READ-ONLY this run; record drift in reports).
**Previous session:** plan/003_bbac3b15e8d0 (M3 landing — complete).

## Diff analysis (what actually changed)

The PRD diff (96 staged spec insertions) contains exactly ONE new feature
with two coordinated facets, one already-shipped lifecycle fix, one
already-shipped tokenization fix, and documentation-only syncs:

| Delta | Status |
|---|---|
| **Tier-0 anchorless contiguous-run fallback** (spec 04 Query matching): when the anchored scan returns zero, one full-store pass matches the fragment as a single contiguous run anywhere in the key; floor 3 chars; score `85 − 40·(runStart/len(c))`, threshold-gated; sorts below tier 1 (`3 > 2 > 1 > 0`). New perf budget `< 3 ms p99`. **NOT implemented** — query.ts has tiers 1–3 only | **THIS RUN** |
| **`#` trigger-char loose mode** (spec 04/07/08): under `#`, tier-0 is ALWAYS consulted (no zero-result precondition; `#query` → `src/core/query.ts`) and scattered tier-1 is visible (mode default threshold **45** vs ambient **60**); an explicitly set `fuzzThreshold` overrides BOTH mode defaults. **NOT implemented** — config merges default 60 at load, no mode awareness | **THIS RUN** |
| **Chaining stays anchored** — tier-0 matches never arm or extend a chain | **THIS RUN** (partial: the chain membership gate is already anchored per P1.M2.T3.S1; the ARMING suppression on tier-0 acceptance is missing) |
| Widget **session_start rebind** on re-fire (spec 07) | Already shipped: commit `b26a917` (index.ts, widget.ts, tests) |
| Rule-4d **trailing trims leave key AND display** (sentence periods, trailing `/`, `:line:col`) + long-path unmask | Already shipped: commit `27c61c2` (segment.ts, shapeGate.ts, tests) |
| Module layout adds `editor.ts`/`debug.ts`/`paths.ts`; dictionary size figures (48,802 entries, 0.85 MB, LF 0.745); M2 DoD re-theme wording (`Acme→Zephyr→Noria→Inverter`, pinned in existing test/acceptance.test.ts); decision-log dictionary row | Doc-only syncs, already landed with 27c61c2 / earlier work — verify only |
| Spec 09: query.test.ts tier-0 bullet, ranking bullet gains tier-0 clause, integration item 2 amendment (cousin menus), new perf-gate row | Test surface for THIS run |

**Size check:** medium single-feature delta → 1 phase, 2 milestones, 3 tasks,
6 subtasks, ~9 SP. Do not re-do M3, rebind, or 4d work.

## Scope delta

### 1. Tier-0 anchorless contiguous-run fallback (NEW; spec 04)

Word matching becomes anchored-only PLUS a zero-result fallback. In
`rankMatches` (src/core/query.ts): when the threshold-gated anchored scan
(tiers 1–3) yields ZERO matches AND `fragment.length >= 3`, one anchorless
pass over the full store: the fragment occurs as ONE contiguous run anywhere
in the key (`c.indexOf(f)`; the "or at the first position" arm is redundant —
position 0 implies an anchored tier-3 match existed). No anchor, no
subsequence, no boundary rules. Admission score
`85 − 40·(runStart/len(c))` → ~45–85, gated by the SAME threshold as other
tiers (default 60 passes runs starting in the front ~62% of the key). Tier 0
sorts BELOW tier 1 — the existing tier-desc comparator key slots this in
naturally, but note the internal sort record already uses a uniform `tier: 0`
for zero-fragment listings (query.ts:263-273 JSDoc); zero-fragment and match
paths are mutually exclusive so there is no real collision — rename or pin
with a comment, don't let it silently bite.

**Binding test pins (spec 09):** `esk` → `zendesk`, `query` →
`src/core/query.ts` (score 64); fragment floor 3 (1–2-char fragments never
fire tier-0); a NON-EMPTY anchored result is byte-identical to pre-tier-0
output (the fallback only rescues menus that would not appear); tier
descending extends to `3 > 2 > 1 > 0`; threshold gating applies (late runs
gate at default 60).

**Mode A docs:** JSDoc on the tier-0 matcher + exported score constants
(calibration starting points, same pattern as TIER1/2/3 constants) rides
with the code.

### 2. `#` loose mode + per-mode fuzzThreshold defaults (NEW; spec 04/07/08)

- **Config layer:** `fuzzThreshold` currently merges the baked 60 default at
  load (config.ts:101,261-264), making explicit-set indistinguishable from
  default. The spec requires "an explicitly set value overrides BOTH mode
  defaults" — so config must expose whether the knob was set (e.g. optional
  field / `fuzzThresholdSet` flag; implementation's choice, but the
  provider/widget layers must be able to resolve: explicit value → both
  modes; unset → 60 ambient, 45 under `#`).
- **Trigger-char call sites:** under `#`, tier-0 runs are ALWAYS consulted —
  anchored scan first (threshold 45), tier-0 results appended below tier 1,
  threshold-gated at 45; scattered tier-1 becomes visible at 45 (tier-1 max
  is 50, so only the strongest scattered matches admit — `#cfg` →
  `config_manager_service`). Ambient word matching unchanged (zero-result
  precondition, threshold 60).
- **Both display paths:** provider.ts:599-603 (fallback) and widget.ts:439
  (primary) pass the threshold today — both need the mode-aware call. The
  fragment-extraction layer already knows the mode (trigger regex vs word
  regex); a shared resolution helper avoids divergence.
- **Chain stays anchored (both modes):** tier-0 matches never ARM a chain.
  The arm sites are the provider's applyCompletion intercept (provider.ts
  ~L251-260 chain machine) and the widget's Tab insertion; neither can
  currently see the matched tier — expose it (e.g. a `tier` diagnostic field
  on RankedMatch, which already carries diagnostics like sessionCount/salience)
  and suppress arming when tier === 0. The chain membership gate is already
  anchored (no change). **Mode A docs:** config.ts JSDoc on the per-mode
  default semantics rides with the work.

### 3. Performance gate (NEW row; spec 09)

`Tier-0 anchorless fallback full-store pass (fires only on empty anchored
result; also # loose-mode scans) — < 3 ms p99`. Add to test/perf-gates.test.ts
following the existing structure (gate a pattern at :76-99; CI assert at 3×
budget = 9 ms, loose pinning for variance); extend test/bench if it hosts the
captured numbers.

### 4. Documentation syncs (verification only — already landed)

Module-layout rows (editor.ts/debug.ts/paths.ts), dictionary figures
(48,802 / 0.85 MB / LF 0.745), M2 DoD re-theme, decision-log rows: verify
the repo already agrees; record any drift in the run report (spec read-only
this run).

## Mode B — changeset-level documentation (depends on all above)

README.md is stale against this delta: the matching description (README:37-41
— add the tier-0 fallback), the `fuzzThreshold` config row (README:429 — add
per-mode defaults 60/45 + explicit-override semantics), the chaining blurb
(README:129-130 — chains stay anchored, tier-0 never arms), and any
no-hijack/known-limitations wording that says "no menu for common words"
without the WITH-ANCHORED-MATCHES amendment (spec 09 item 2). Append a DoD
section to docs/M1-DoD.md (suite counts, gate numbers, date, live-smoke
record) per the established M2/M3 append pattern. Run the full gauntlet:
`npm run check`, `npm test`, `npm run bench`.

**Live smoke (light, §09 technique):** the change is query-layer, but menu
POPULATION is user-visible — one ephemeral `pi --no-session` tmux run:
(a) a zero-anchored-result word whose cousin exists shows a one-shot menu
that narrows away; (b) `#query` completes `src/core/query.ts`; (c) Tab on a
tier-0 `#`-mode completion does not arm a successor offer. One-char-at-a-time
keys, capture-pane evidence, no instrumentation left in the tree.

## Phase P1 — Tier-0 + loose mode

### Milestone P1.M1 — Core matching (query.ts + config + both paths)

**Task P1.M1.T1 — Tier-0 anchorless pass in rankMatches (3 SP)**
- **S1 (3 SP):** anchorless matcher + zero-result precondition + floor 3 +
  score/threshold + tier-0 ranking slot + RankedMatch tier diagnostic +
  chain-arm suppression signal. TDD per the binding pins above
  (test/query.test.ts); the "non-empty anchored result is byte-identical"
  pin guards the fallback's isolation. Research: plan/003 r3-query-fuzzy.md
  §3/§6 (scan-entry + bench context) still applies; tier-0 itself is new.
- **S2 (1 SP):** perf-gate row `< 3 ms p99` (20k store, full-store pass) in
  test/perf-gates.test.ts + bench capture; CI at 3× per the existing
  structure.

**Task P1.M1.T2 — `#` loose mode + per-mode threshold plumbing (3 SP)**
- **S1 (1 SP):** config explicit-vs-default resolution for fuzzThreshold;
  ambient 60 / trigger 45 defaults resolved at the call layer; clamp +
  round-trip tests (test/config.test.ts).
- **S2 (2 SP):** provider + widget trigger-mode wiring (tier-0 always
  consulted, threshold 45, `#cfg` → `config_manager_service`); chain-arm
  suppression wired at both Tab sites; explicit knob overrides both modes;
  test suites: query.test.ts `#`-mode bullet, provider-match.test.ts,
  widget-visibility.test.ts, chain.test.ts (anchored-only arming).

### Milestone P1.M2 — Changeset coherence

**Task P1.M2.T1 — README sweep + DoD record + live smoke (2 SP)**
- **S1 (1 SP):** README rows per Mode B (matching blurb, fuzzThreshold row,
  chain blurb, no-hijack amendment); grep for stale claims; README stays
  non-authoritative vs spec.
- **S2 (1 SP):** full gauntlet + docs/M1-DoD.md append (tier-0 section,
  gate numbers, live-smoke captures) + drift report for any spec mismatch
  (spec read-only this run).

## Out of scope (do not touch)

Widget rebind (shipped b26a917), rule-4d trailing trims (shipped 27c61c2),
all M1/M2/M3 behavior, spec edits (staged = current PRD; drift goes in the
report), any tier-boundary retuning (boundaries are semantics; only the
per-mode thresholds are runtime surface).
