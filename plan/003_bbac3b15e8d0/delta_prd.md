# hapax Delta PRD 003 — R_eff gradient, path candidates (4d), anchored-fuzzy matching, one-line widget (M3)

**Status:** Approved for implementation · **Plan:** `plan/003_bbac3b15e8d0`
**Spec of record:** `spec/*.md` at commit `af63f1d` ("docs: spec M3"). The spec
already describes the target state (spec-first order, sanctioned by the spec
maintenance policy in `spec/SPEC.md`); this session brings the CODE into
agreement. Spec files are **read-only inputs** for this pipeline run — record
drift in reports, do not edit `spec/`.

## Diff analysis — what actually remains

The previous-PRD → current-PRD diff is textually large, but most of it
describes work **already shipped and verified** (git log through `9c0d3a6`;
spec matched code until `af63f1d`). Verified-in-repo, DO NOT REDO:

- Segmentation 4a (dotted filenames), 4b (hyphenated compounds), 4c (technical
  literals); properName structural-start rule; shape-gate floor 4→2 +
  letter-bearing-only entropy + retired digit+symbol ratio + pure-decimal ≥ 16.
- Admission flat floor R=12 with the `rejectCommonness` runtime knob;
  proper-noun relief retired-in-place; conjugation guard (currently comparing
  stems against the FLAT threshold — changed by R1 below).
- Content-derived ranking (shorter → lex) + plural pruning (superseded by R3).
- Store prefix index with amortized 256-key consolidation.
- Provider: identifier-char auto-open (effective threshold 1, `threshold`
  inert), startup restore gate, close-on-space, `menuDelayMs` hesitation gate
  (default 0), chain one-shot grant, forced single-item Tab mitigation, 100 ms
  display debounce + hysteresis.
- Editor proxy v2 (`src/pi/editor.ts`) — Enter-submits, forwarding Proxy,
  never mutates the inner instance, input-clock hook.
- `/acwords` complete-store dump; `tools/calibrate-bands.mjs` word probe.

The **unimplemented delta** (spec marks the first two "adopted ahead of
implementation — code lands with this spec"; the rest is the M3 milestone):

1. **R1** — length-conditioned reject curve R_eff (spec 04, admission).
2. **R2** — rule 4d slash-joined path candidates (spec 04, segmentation).
3. **R3** — anchored-fuzzy matching, tier → sessionCount ranking,
   `fuzzThreshold` (spec 04; M3 goals 8–9).
4. **R4** — one-line widget primary display path, dual-path architecture
   (spec 07; M3 goal 10).
5. **R5** — changeset-level documentation + DoD re-verification (Mode B).

Out of scope: everything listed as already shipped above; pi-tui or upstream
pi modifications; persistence/telemetry (invariants unchanged); per-language
dictionaries.

## Prior research that still applies

`plan/002_3e8a42cadf2c/architecture/` (pre-D2 line numbers have drifted, but
structure holds):

- `pi_layer_map.md` — provider.ts internals (chain machine, display provider,
  liveKey mechanism), config applyLayer pattern, index.ts wiring order.
- `external_deps.md` — pi-tui runtime contracts (single-item forced fast
  path, trigger-char branch shadowing, one-query-per-word, space-updates-menu
  flow). The four PINs in provider.ts must be re-verified on any pi-tui
  upgrade; R4 adds new contract surface (below).
- `system_context.md` + `core_phrase_layer_map.md` / `ingest_segment_map.md` —
  store/ingest/segment structure (post-D2 shapes verified during this
  analysis).

NEW research needed only for R4: pi's extension editor-component API —
`node_modules/@earendil-works/pi-coding-agent/examples/extensions/`
(`border-status-editor.ts`, `modal-editor.ts`, `rainbow-editor.ts`) and the
extension docs under that package's `docs/` — for (a) capturing the editor
factory, (b) rendering a line below the input editor, (c) composing the
existing editor.ts Proxy with a widget-aware double.

---

# Phase P1 — M3 landing

## Milestone P1.M1 — Core admission & tokens (R1, R2)

### Task P1.M1.T1 — R_eff length-conditioned reject curve (R1; spec 04 "Admission decision")

`src/core/score.ts` currently rejects at flat `REJECT_COMMON_THRESHOLD` (12).
Implement the length-conditioned curve exactly as spec'd:

- `R_eff(len)`: flat `R` for len ≤ 8; `R + (255 − R)·√((len − 8)/12)` for
  8 < len < 20; 255 (admit-all) for len ≥ 20. `R` = the existing
  `REJECT_COMMON_THRESHOLD` (12); the existing `rejectCommonness` config knob
  moves the floor and the WHOLE curve scales from it (no new config surface).
- Reject iff `q !== null && q >= R_eff(len)`; every attested admission lands
  at **rank group 1 flat** (the old group-2 band stays dead; `RankGroup`
  keeps 2 only for the subword clamp). Absent → group 0 unchanged.
- Conjugation guard: both tiers compare the stem against
  `R_eff(len(word))` — NOT the flat threshold. The fixed MID constant (20)
  survives only as a compatibility constant. Spec's boundary examples must
  hold: `uploads` (7c, stem q=38) rejects; `configurations` (15c, stem q=26)
  admits.
- Proper-noun relief stays retired-in-place (ceiling = floor R, below every
  R_eff) — verify, no behavior change expected.
- Update `tools/calibrate-bands.mjs` to print R_eff-aware verdicts
  (a word's q vs its length's R_eff, lowercase and Capitalized) — spec 08/09
  name it as the probe for the now-current bands.
  **Mode A docs:** the probe's output header/comments; README's
  `rejectCommonness` row description is R5 (Mode B).
- Tests (`test/score.test.ts` + `test/calibration.test.ts`): assert RELATIVE
  to the imported constants/R_eff, not absolute quants — floor hold (q ≥ 12
  rejects at any len ≤ 8), sqrt-ramp boundary probes (q=81 admits / q=82
  rejects at 9 chars), admit-all at len ≥ 20, flat group 1, knob scaling
  (override moves floor and curve), guard stems riding R_eff, relief stays
  dead under the ramp.

### Task P1.M1.T2 — Rule 4d slash-joined path candidates (R2; spec 04 rule 4d)

No path class exists today. Implement in `src/core/segment.ts` +
`src/core/shapeGate.ts` + store display handling:

- **Predicate** (after edge trimming): a maximal literal-charset run that is
  path-shaped — ≥ 2 interior single `/` separators, OR exactly 1 interior
  `/` plus a dotted component — is ONE opaque token. Digit-bearing runs that
  already qualify via 4c take the path class when they qualify both ways.
- **Edge trim vs display:** the KEY trims leading `/`, `~`, `./`, `../`
  (combinations) and a trailing `/`; the DISPLAY preserves original edge
  symbols (`/home/...` inserts with its slash). This is the first
  key≠display-only-by-casing candidate — extend `Candidate` upsert/display
  merge accordingly (display still recency-wins).
- **Line/col suffix:** trailing `:digits(:digits)?` trimmed when the
  remainder is path-shaped (`src/foo.ts:42:13` → `src/foo.ts`); non-path
  colons (`4:36`, `localhost:8080`) untouched.
- **Guards:** single interior symbols only (interior `..` rejects the whole
  run; leading `../` is an edge, trimmed); rule-3 Unicode-letter adjacency
  applies; strictly additive vs equal spans of other classes; post-trim key
  length 4–96 (shape gate gains the path-class cap — the literal scan window
  is already sized 96); opaque to subword splitting; secret rules apply
  (base64url-texture segment rejects whole candidate; `@`+`.`); entropy floor
  applies to letter-bearing keys. Path tokens enter bigram adjacency runs as
  whole tokens.
- **Query interaction (verify, mostly free):** paths surface at the FIRST
  segment (`sr` → `src/core/query.ts`, Tab inserts the whole path); the
  word-fragment regex admits no `/`, so a path is only ever matched by its
  pre-first-slash prefix; once a `/` precedes the cursor the existing
  stock-context gate delegates to pi file completion — unchanged. Fuzzy
  anchor (R3) matches on first char of the trimmed key.
- Tests: `test/segment.test.ts` per spec 09 (`src/core/query.ts`,
  `/home/user/projects/hapax` key-trim/display-keep, `docs/architecture.md`,
  `../tools/build.mjs`, `example.com/a/b`, `:line:col` trims, `and/or` NOT a
  token, `a/../b` rejects whole, key cap 96/97); `test/shapeGate.test.ts`
  path-class cap; bigram adjacency case (`edit → path` chains);
  `test/shipped-dict.test.ts` / perf gates re-run clean (scan cost stays
  linear — the 800 KB ingest gate must hold).

## Milestone P1.M2 — Core query: anchored fuzzy + frequency ranking (R3; spec 04 "Query matching/ranking", M3 goals 8–9)

`src/core/query.ts` is plain prefix + content-derived order today. Rewrite:

- **Matcher:** first-character anchor (`f[0] === c[0]`, case-insensitive) +
  anchored subsequence (`f[1..]` in `c[1..]`, greedy leftmost). Retire plain
  prefix as the only match mode.
- **Tiers:** 3 exact prefix / 2 contiguous tail (`zsk` → `zendesk`) /
  1 scattered (`hrp` → `handleResponseProxy`). Tier boundaries are
  semantics, never tunable.
- **Admission score** (0–100, NOT order-determining): tier 3 = 100;
  tier 2 = `85 − 40·(charsSkippedBeforeRun / len(c))`; tier 1 =
  `50 − 5·gapRuns − min(gapChars, 15)`. Candidates below `fuzzThreshold`
  are discarded BEFORE ranking. Constants are calibration starting points.
- **Ranking:** tier descending → `sessionCount` descending within tier →
  shorter key → byte-lex. Zero-fragment listing (`#` alone):
  sessionCount desc, then the same ties. Plural pruning stays, before the
  limit slice. `maxSuggestions` stays the return cap.
- **Store scan entry:** generalize `prefixRange` to a first-char range (the
  anchor keeps the sorted index the entry point); keep the amortized
  consolidation and the < 1 ms / 20k-candidate p99 perf gate.
- **Config:** add `fuzzThreshold` (0–100, clamped; default auto-imported
  from the baked query-module constant — same pattern as
  `rejectCommonness`; 100 = exact-prefix-only mode). Update
  `test/config.test.ts`.
  **Mode A docs:** JSDoc on the query module's exported constants.
- **Chain membership gate (provider.ts):** armed-chain typed chars filter
  successors with this same fuzzy matcher as a membership gate; ranking
  within a chain stays successor-count-based (spec 07). Threshold stays 0
  for the chain duration.
- Tests: `test/query.test.ts` per spec 09 (anchor cases incl. `esk` never
  matches `zendesk`; tier classification; score arithmetic per tier;
  below-threshold never renders; `fuzzThreshold: 100` prefix-only;
  tier-beats-count and count-within-tier ordering; zero-fragment; plural
  pruning before limit); `test/provider-match.test.ts` / `chain.test.ts`
  re-pointed to fuzzy membership; perf gates re-run.

Dependencies: P1.M1 (paths are query candidates; single rewrite over the
final token classes).

## Milestone P1.M3 — One-line widget, primary display path (R4; spec 07 "Display architecture", M3 goal 10)

The largest item. New `src/pi/widget.ts`; `src/pi/editor.ts` extended; dual
path selected at `session_start`.

- **Research first (bounded):** pi extension editor-component API (examples
  listed above + that package's docs) — factory capture, rendering below the
  editor, and how the existing v2 Proxy composes with a widget-aware double.
  Record findings in the run report; never mutate shared editor instances
  (the v1 crash lesson is binding).
- **Dual-path selection:** editor factory exists → widget is PRIMARY (no
  autocomplete provider registered for words on this path; stock
  path/slash/`@` completion untouched by construction); no factory → the
  existing provider registration is the FALLBACK, byte-for-byte unchanged
  (forced single-item included). Both paths share the query core (P1.M2),
  startup gate, debounce/hysteresis timing.
- **Widget rendering:** one line directly below the input editor; items
  joined `" | "`, rank order left→right, never wraps; cap =
  `maxSuggestions` AND terminal width, overflow drops lowest-ranked
  (rightmost) first; zero candidates → never renders (invariant 3);
  highlight (theme accent) on the leftmost item, reset on every set change;
  items are the candidate display string ONLY — no `Session ×N`, no
  descriptions, no `chain` marker.
- **Key handling (editor-proxy double, consumed before the inner editor
  while the line is visible):** all four arrows navigate (←/↑ left, →/↓
  right); ↑/← on the FIRST word = boundary-Esc (dismiss, consume the press —
  caret unmoved — and suppress the line until the next word start or trigger
  char; a disqualification close does NOT suppress); →/↓ at the last word
  clamp; Tab inserts the highlighted word synchronously against the live
  query (never debounce-gated), replacing the word-regex span or
  `#fragment` with the candidate's display casing (applyCompletion
  semantics reimplemented — no provider item exists on this path); Enter
  dismisses then forwards so the inner editor submits; everything else
  forwards verbatim; inner instance NEVER mutated.
- **Visibility state machine** (input-clock driven, not pi-tui request
  cadence): per keystroke extract the live fragment (trigger char / word
  regex); path/slash/`@` contexts hidden; fragment live + ≥ 1 candidate
  above `fuzzThreshold` → visible, subject to `menuDelayMs` and the 100 ms
  swap debounce + flicker hysteresis (all carried over); trailing space with
  no `@`/`/` → hidden; cursor move / Escape / boundary-Esc /
  disqualification → hidden; startup gate applies identically.
- **Invariant amendment already in spec:** while the line is visible the
  four arrows and Escape are sanctioned captures (spec SPEC.md invariant 1).
  No other key handling.
- Tests: `test/widget.test.ts` per spec 09 (visibility machine, key
  handling incl. consumed-boundary-Esc and no-suppress-on-disqualification,
  insertion spans, highlight reset, debounce/hysteresis/startup-gate carry-
  over, never-mutate-inner pin); `test/editor-enter.test.ts` extended for
  the double.
- **Live TTY verification is MANDATORY before acceptance** (spec 09 binding
  technique): `pi --no-session` in tmux, keys via `tmux send-keys` one char
  at a time (0.08–0.12 s gaps — bursts cancel in-flight queries), state via
  `capture-pane`, sanctioned temporary instrumentation removed before
  commit. Verify against the real extension stack (pi-vim + split-editor),
  including integration item 1's M3 clause and item 2's arrow-capture
  clause.

Dependencies: P1.M2.

## Milestone P1.M4 — Changeset coherence (R5; Mode B)

- **README.md sweep** (verify every claim against shipped behavior, delete
  anything unimplemented): Features — anchored-fuzzy matching, path
  candidates, one-line widget; Configuration — add the `fuzzThreshold` row,
  update the `rejectCommonness` row to describe the R_eff curve (floor of a
  length-conditioned curve, not a flat quantile); Architecture — dual-path
  display (widget primary, stock menu fallback); Design invariants — the
  arrow/Escape capture amendment with boundary-Esc.
- **DoD re-verification:** full `npm run check` + `npm test` + `npm run
  bench` (20k fuzzy query < 1 ms p99; dict load+sweep < 60 ms; 800 KB
  ingest < 60 ms with yields; heap < 6 MB), integration items 1–7 (item 7 =
  conversational path completion, rides P1.M1.T2), live widget verification
  recorded. Annotate the DoD record in `docs/` (append an M3 section to the
  existing DoD doc) with suite counts, bench numbers, and the date.
- Grep README for stale claims (e.g. flat-band description, prefix-only
  matching, vertical-menu-only display) to confirm the sweep is complete.

Dependencies: P1.M1, P1.M2, P1.M3.

---

## Definition of done — this delta

- All new/updated suites green (`score`, `calibration`, `segment`,
  `shapeGate`, `query`, `config`, `widget`, `editor-enter`, `provider*`,
  `chain`, perf gates); `npm run check` clean; benches within budgets.
- Spec 09's M3-relevant bullets all covered: fuzzy anchor/tiers/threshold,
  tier→sessionCount ranking, path-token cases, widget key handling and
  visibility, integration item 7.
- Live TTY verification of the widget against the real extension stack,
  recorded in the run report; no instrumentation left in the tree.
- README coherent with shipped behavior; DoD record annotated.
- No spec edits (pipeline run; drift — if any is discovered — recorded in
  the report for a later interactive session to reconcile).
