# hapax — Delta PRD: Capitalized-Series Completion + Branch-Hygiene Rebuild

**Status:** Draft v1.0 · **Delta baseline:** HEAD `6d8f158` · **Spec state:** spec/ is ALREADY at the target PRD (read-only; `plan/006_7bd0258da993/prd_snapshot.md`)

## Delta summary (what actually changed between the two PRDs)

The diff between the previous PRD and the current PRD contains **five feature areas**. Repo state at baseline:

| Diff area | Spec sections | Repo state at `6d8f158` |
|---|---|---|
| Capitalized-series completion (proper-noun runs, casing tallies, casing-evidence admission, series bigrams, typed-word chain arming, completion-time casing resolution) | 01 goals 11–13 (h2.9), 04 h2.26/h3.5/h2.28/h2.32, 06 h2.41/h2.43/h3.6/h3.7, 07 h2.53, 08 h2.57, decision log | **NOT implemented** — zero hits for `capCount`/`capDisplay`/run detection/series bigrams in `src/` |
| `session_tree` branch rebuild (branch purity) | 02 h2.16, 05 h2.37, 06 h2.42, 07 h2.46/h3.9/h3.12, 09 (branch tests + integration item 9) | **NOT implemented** — no `session_tree` reference anywhere in `src/`/`test/`; only the docs commit `73b9c53` exists. NOTE: the h2.36 sub-change (restore reads `getBranch()`, the active branch) IS done (`src/pi/ingest.ts:734`) |
| Atomic identifiers, progressive ranking (tier→length→count→lex) + exact-equal exclusion | 04 h3.4/h2.31, 06, 09 | **Already landed** — commit `02b2501`; verified in code (`src/core/query.ts:511`, `:569`) |
| R=30 floor retune, width-bound `maxSuggestions` 20, tier-1 gap-size scaling | 04 h2.28/h2.30, 08 h2.56 | **Already landed** — commits `5855f83`, `0105293`, `9a61aec`; verified (`src/core/score.ts:109` `= 30`, `src/pi/config.ts:131` `: 20`, `src/core/query.ts:232-233` retuned formula) |
| Line claim, suppression lapse, two-state un-entered-Escape forwarding | SPEC invariant 3, 07 h3.9/h3.10 | **Already landed** — commits `aa17b2e`, `b158c51`, `6d8f158`; line claim verified live per its commit message |

**This delta implements only the two unimplemented areas**, fixes one pre-existing
red test battery, and syncs changeset-level docs. The already-landed areas are
REFERENCE-ONLY (do not re-implement; do not regress).

## Pre-existing condition (must resolve)

`npm test` at baseline: **3 failed / 1129 passed / 1 skipped** — all three in
`test/defer-pi-menu.repro.test.ts`, a red-committed INVESTIGATION REPRO (header:
"not a regression suite yet", introduced failing at `02b2501`). It demonstrates
that on the **widget path**, while **pi's own stock autocomplete menu is open**
(Tab-forced file completion, slash-argument completion), hapax's editor proxy
consumes Tab and inserts a hapax word instead of letting pi's menu accept its
item — violating spec 07 h2.46's "stock path/slash completion is untouched by
construction" claim. Fixing it (R4) is required for the gauntlet-green DoD.

## Out of scope (reference / do-not-touch)

- Re-implementing or "cleaning up" the landed areas above; spec edits (spec is
  READ-ONLY for pipeline agents — AGENTS.md; record drift in reports only).
- Known spec-internal staleness to record as drift (implementation follows the
  authoritative sections): spec/08's schema example shows `"rejectCommonness": 12`
  while 04/tuning-protocol/`score.ts` say 30; spec/09's query.test.ts ranking
  bullet still teaches the retired count-before-length order (04 h2.31's
  tier→length→count→lex governs).
- Config surface: NO new config keys — the 95 casing-evidence band and the
  dictionary top-band ceiling are deliberately NOT configurable (08 h2.57).
- The `context_edit` known gap (05), CJK, per-language dictionaries, undo journal.

---

# R1 — Capitalized-series completion: core pipeline

Detect maximal capitalized runs during ingest, admit their members via casing
evidence (with a dictionary top-band ceiling that makes the very commonst words
chain-only), replace the store's recency-merged `display` with casing tallies,
and record series bigrams that remember run casing.

Authoritative text: **spec/04 h2.26 "Capitalized runs"**, h3.5 "Normalization",
h2.28 "Admission decision" (casing-evidence paragraphs), **spec/06 h2.41/h2.43**
(Candidate schema, upsert tally semantics), **h3.6/h3.7** (series bigrams,
successor index extensions).

Key semantics (pinned, from the spec):

1. **Run** = maximal sequence of ≥2 consecutive whole tokens on the same line,
   every token beginning with an uppercase ASCII letter, adjacent tokens
   separated by nothing but plain spaces/tabs — the SAME strict adjacency window
   as bigram capture (clause punctuation, quotes/brackets, digits/hexish,
   symbols, any intervening word, and newlines all break it). Runs are detected
   wherever they sit (line-initial and after-punctuation included — the
   structural-start exclusion does NOT apply to run detection). Each member must
   pass the shape gate; a secret-shaped/noise member splits the run around it.
2. **Run-member admission**: a member admits regardless of the commonness band,
   whatever its attestation and whatever lowercase sightings exist. Attested →
   group 1; absent → group 0. Casing evidence grants candidacy ONLY — ordering
   is unchanged (h2.31). Run-member admission bypasses the conjugation guard
   (casing evidence outranks morphology, parallel to the existing properName
   skip — pin in tests).
3. **Dictionary top-band ceiling** (baked constant, chain-only rule): a member
   whose `q` lies in the table's very top band never gains admission from
   casing, run or single — it is **chain-only**: never a standalone suggestion,
   but its series bigrams still form and the after-space offer still presents
   its neighbors (typing `The ` offers `Fed`). Calibration guidance (measured
   against the shipped 48,802-entry artifact): **q ≥ 135 covers 203 words** —
   "the most common couple hundred words" (`the` 240, `and` 219, `for` 194,
   `with` 179 in; `national` 90, `energy` 94 out). Probe with
   `node tools/calibrate-bands.mjs <words...>`; pick the ceiling by that
   measurement and document the population count in the constant's JSDoc.
4. **Single mid-sentence capitals** (the properName condition — capital NOT at
   a structural start): admit under the relaxed band
   `max(R_eff(len), 95)` — at group 1 when attested, group 0 when absent.
   Capitalized candidates at structural starts get NO relaxation (they admit on
   the merits exactly as their lowercase form). properName drafts keep the
   conjugation-guard skip (existing behavior, unchanged). The old relief branch
   (group 2 via `PROPER_NOUN_ADMIT_CEILING`) stays retired-in-place/dead.
5. **Casing tallies replace recency-merged display** (06 h2.41/h2.43): store
   `capCount` / `lowerCount` / `capDisplay` (most frequent capitalized form,
   ties → most recent) instead of `display`. A sentence-initial capitalized
   sighting contributes to `capCount` ONLY while the word has never been seen
   lowercase; the FIRST lowercase sighting removes those contributions
   PERMANENTLY (a capitalized sentence-initial form whose lowercase twin exists
   is dropped entirely — the lowercase form is the word; later structural caps
   never contribute again).
6. **Series bigrams** (06 h3.6/h3.7): every adjacent pair inside a run is
   recorded as a series bigram — INCLUDING chain-only members — each marked
   series-derived and remembering both words' run casing (`nextDisplay`).
   Series entries rank above ordinary successors in the per-word successor
   list's top-3 retention (series first by count, then ordinary by count, so
   the h2.53 "series first regardless of counts" offer rule is stable); they
   observe the same window-break rules and the same bigram cap/eviction.

**CRITICAL pitfall (load-bearing):** admission is memoized per distinct raw
token (`#admitMemo`, `src/pi/ingest.ts:521-545` — the 2026-09 Issue 4
memoization), but run membership and casing class are OCCURRENCE-CONTEXT
properties, not token-intrinsic ones. The memoized plan must stay
context-free; the run-member override and the casing-class tally must apply at
occurrence level in `#replayAdmitMemo`, exactly like stats/upserts already do.
Memoizing a run-member admission would permanently admit every later lowercase
occurrence of that token.

**Mode A docs (ride with the work):** JSDoc on `Candidate`/`Sighting` casing
fields (`src/core/types.ts:18-45`), the new run-detection export
(`src/core/segment.ts` or the ingest splitter), `recordBigramRuns`'s richer
payload (`src/core/store.ts:536`), the new ceiling constant + relaxed-band
constant + `admit()` override path (`src/core/score.ts`), and
`tools/calibrate-bands.mjs` if its probe output changes (Capitalized verdicts
now follow the 95 band / run rules — update the tool's Cap column so the
calibration history in 08 stays honest).

# R2 — Capitalized-series completion: query + chain surfaces

Consume the tallies and series index at completion time: casing resolution
against the live fragment, series-first successor offers with run-casing
display, and chain arming from TYPED capitalized words.

Authoritative text: **spec/04 h2.32 "Case handling"**, **spec/07 h2.53 "M2:
chained completion"** (state machine + typed-word arming bullets),
h2.54 "Result item shape", 08 h2.58 (/acwords).

Key semantics (pinned, from the spec):

1. **Insertion casing is resolved at completion time from the tallies** — pure
   function of (candidate tallies, live fragment first letter):
   - Fragment begins uppercase → the capitalized form wins; only the first
     letter is adapted, the rest of the word comes from the winning form's
     spelling (typed `Nr` + `capDisplay "NREL"` → `NREL`; + `"National"` →
     `National`; no capitalized sightings → capitalize the key's first letter).
     The user's Shift press is never overridden.
   - Fragment lowercase (or zero-fragment) → the form that occurred more often
     wins (capCount vs lowerCount); ties → lowercase; a word seen only
     capitalized completes capitalized; words seen only in all caps complete
     verbatim; paths/technical literals insert verbatim (falls out of the
     tally rules — pin in tests).
   - Menu labels use the same resolution against the live fragment's first
     letter. **Implementation shape (minimize ripple):** compute the resolved
     form where matches are built today (`src/core/query.ts:531` sets
     `display: c.display`) so the ~20 downstream `.display` consumers
     (provider items `:604-615`, widget paint/insert/`chainShim` `:660-670`,
     signatures) keep working unchanged. Tab-insert reads the live synchronous
     result per invariant 2 — resolution at query time satisfies
     "resolved at completion time".
2. **Series-first successor offers** (07 h2.53): at the armed word-start offer
   (zero typed chars), successors are offered **series first (count descending
   among them), then ordinary (count descending)**. Series items display and
   insert their RUN CASING (`nextDisplay`) at zero typed chars; once the user
   types, the first-char anchor is case-insensitive as everywhere, and
   insertion preserves a typed capital first letter (lowercase typing inserts
   the offer item verbatim). Applies on BOTH display paths — the fallback
   provider's armed branch (`src/pi/provider.ts:436` consult) and the widget's
   `chainShim` (`src/pi/widget.ts:660-670`).
3. **Chain arming from typed words** (07 h2.53 new transition): when a space
   closes a typed word whose **first letter is UPPERCASE** and whose lowercase
   key has **series successors** (direct successor-index consult — so
   chain-only members arm it: typing `The ` offers `Fed`), the chain arms.
   A lowercase typing of the same word must NOT arm (every prose `the ` would
   fire). Hook the close-on-space sites: widget visibility machine
   (`src/pi/widget.ts:951-952` area) and the fallback provider's no-fragment
   branch (`src/pi/provider.ts:535` area). Tab-acceptance arming, the one-shot
   grant, `before_agent_start` reset, and the exact-equal exclusion in the
   chain membership filter (already present both paths: `provider.ts:515`,
   `widget.ts:894`) are unchanged.
4. **/acwords dump** (08 h2.58, `src/pi/debug.ts:74/:120/:203`): update for the
   new schema — per-word tally columns (capDisplay, capCount/lowerCount) in
   popup and `/tmp/hapax-store.txt`; the successor sample marks series entries.

**Mode A docs (ride with the work):** JSDoc on the resolver (core), the
chain-machine arming seam and offer-ordering rule (provider), the widget
series-consult, and `debug.ts`.

# R3 — Branch-hygiene rebuild on `session_tree`

Wire the spec'd `/tree` reaction: the store (and successor index) becomes a
pure function of the active branch's replayable history.

Authoritative text: **spec/05 h2.37 "Branch navigation rebuild"**, **06 h2.42
"Branch purity"**, 02 h2.16 (lifecycle bullet), 07 h2.46 (branch rebind
paragraph) + h3.9 (release set includes `session_tree`) + h3.12 (gate reuse
paragraph), 09 (store/provider/widget branch bullets + integration item 9).

Key semantics (pinned, from the spec):

1. On `session_tree` (`{ newLeafId, oldLeafId, ... }`):
   (a) guard `newLeafId === oldLeafId` → skip; (b) **discard the pending ingest
   queue** (texts in the 300 ms debounce window are dead-branch or re-captured
   by the snapshot — never lost, never double-counted); (c) snapshot
   `ctx.sessionManager.getBranch()`; (d) rebuild IN-PLACE: drop old store +
   successor index, replay the snapshot oldest→newest through the IDENTICAL
   restore pipeline (`restoreFromHistory`, `src/pi/ingest.ts:711-745` — reuse
   verbatim; it already reads `getBranch()` and reverses leaf→root);
   (e) `onSettled` fires exactly once.
2. **All query paths gated until settle** — reuse the startup-gate pattern
   (`createStartupGate`, `src/pi/provider.ts:793`; the widget path's
   restore-ready promise seam) under the same ≤ 500 ms bound, forced (Tab)
   requests included; the gate is what makes the in-place rebuild safe (no
   query observes the intermediate state, no transient double-store).
3. **Rebind**: same fresh-composition rule as the session_start rebind — the
   widget re-composes around the remembered pre-hapax factory, the fallback
   provider re-reads the new pipeline instance, and the **line claim releases**
   (`session_tree` is in h3.9's release set — `claim?.release()` plus the
   fresh composition's unclaimed row).
4. **Branch purity** (06 h2.42): replaying a fixed message sequence twice
   yields identical stores; a store built incrementally (message_end sequence)
   equals the store rebuilt from a `getBranch()` snapshot of the same sequence
   — no dead-branch words survive, nothing double-counts. Series bigrams and
   tallies are part of the store state and must reproduce identically.
5. Compaction NEVER triggers a rebuild; branch summaries are never ingested
   (both already hold — do not regress). No separate perf-gate row (05: the
   rebuild rides the existing restore budgets).

**Mode A docs (ride with the work):** JSDoc on the new
`IngestPipeline.discardPending()` (or equivalent queue-clear seam — note
`dispose()` at `src/pi/ingest.ts:354` also kills the timer; the rebuild needs
either a softer clear or a fresh pipeline), the `session_tree` handler in
`src/pi/index.ts` (event table comment block at file head), and the widget
rebind/claim-release seam.

# R4 — Widget Tab defers to pi's open stock menu (pre-existing red)

On the widget path, while the INNER editor is showing an autocomplete menu
(pi's Tab-forced file menu, slash-argument menu), hapax's proxy Tab must
forward verbatim so pi's menu accepts its item — never insert a hapax word.
Acceptance = the three red cases in `test/defer-pi-menu.repro.test.ts` pass
(forced file menu on a plain word; `/model te` argument menu; the
hesitation/race case), and the file's "not a regression suite yet" header is
updated to reflect that it now is one. Mechanism hint: the same
`isShowingAutocomplete` introspection the Enter-submits guard already uses
(`src/pi/editor.ts:112`) — a pre-check in the widget Tab branch
(`widgetHandleInput`, tab-insert decision site) that forwards before any
insert/suppress. Keep `decideWidgetKey` pure (the editor-state check belongs
in the wiring, like the submit-key seam). This is a key-handling change on
the widget path → live verification required (R5).

**Mode A docs:** JSDoc on the Tab branch documenting the deferral rule and its
spec anchor (07 h2.46 "untouched by construction" + h2.51 never-hijack).

# R5 — Sync changeset-level documentation (Mode B; depends on R1–R4)

1. **README.md sweep** (626 lines): the relief-retirement blurb at :109-111
   ("capitalized attested words … retired-in-place … ~483 capitalized common
   words") is now half-obsolete — casing evidence is back via runs/95-band
   with the top-band ceiling as the noise guard; rewrite it and add
   capitalized-series + branch-hygiene coverage to the feature blurbs. Fix the
   stale config-table defaults while there (`:470` `rejectCommonness` `12` →
   30; `maxSuggestions` `8` → 20) — both landed in earlier commits with no
   README follow-up. Re-check the verification section's wording for the new
   key/claim behaviors.
2. **Full gauntlet**: `npm run check` + `npm test` (all green, including the
   former repro) + `npm run bench`; capture suite counts and gate numbers.
3. **Live smoke (BINDING, spec/09 h2.61)**: tmux + `pi --no-session`, keys via
   `tmux send-keys` one char at a time (0.08–0.12 s), `tmux capture-pane`
   evidence, covering the NEW surfaces: (i) a capitalized-series chain walk
   live — submit a message containing e.g. `National Renewable Energy
   Laboratory`, then type `Na` + Tab and walk the members via the zero-char
   series offers (and a `The Fed`-style chain-only arm if the conversation
   contains one); (ii) integration item 9 (branch hygiene): submit a prompt
   with a rare misspelled word, Ctrl+C, `/tree` back, edit it out, resubmit —
   the misspelling never appears in suggestions or `/acwords`; first
   post-navigation word arrives gate-late but present; (iii) the R4 Tab
   deferral scenario (Tab-forced file menu accepts pi's item while hapax's
   line is armed). Remove any instrumentation before committing; tree clean.
4. **docs/M1-DoD.md**: append a dated gauntlet item per the file's pattern
   (re-runnable commands, suite counts, gate numbers, captures, drift
   verdict). **Drift report (spec read-only):** record the spec-internal
   staleness listed in "Out of scope" above (08 example value 12 vs baked 30;
   09's ranking bullet vs 04 h2.31) for the owner to reconcile interactively.

---

## Phases, milestones, tasks

### Phase P1 — Capitalized-series completion (R1 + R2)

**Milestone P1.M1 — Core pipeline: run detection, tallies, admission, series bigrams**

- **Task P1.M1.T1 — Runs, casing classes, tallies, series bigrams, admission**
  - S1 (3 pts; deps: none) — Run detection + casing classes in the ingest
    seam: uppercase-run walk over `tokenize()` output with the strict
    whitespace-only gap test (reuse the adjacency-window machinery,
    `src/pi/ingest.ts:123-199`), members = shape-gate-passing whole tokens,
    split around rejected members; casing class on `Sighting`
    (`'lower' | 'mid-cap' | 'structural-cap'`, derived from
    `RawToken.sentenceStart` + first char — `src/core/types.ts:100-118`,
    `src/core/segment.ts:763-795`); richer `onAdmittedTokens` payload carrying
    run membership + run casing (ingest options at `src/pi/ingest.ts:254-266`).
  - S2 (3 pts; deps S1) — Store schema + series bigrams: `Candidate`
    `display` → `capCount`/`lowerCount`/`capDisplay` (`src/core/types.ts:18-37`,
    upsert at `src/core/store.ts:274-293`); structural-contribution removal
    semantics (permanent on first lowercase sighting); `Successor` gains
    `series?`/`nextDisplay?` (`src/core/types.ts` ~:125); `recordBigramRuns`
    (`src/core/store.ts:536`) records series pairs incl. chain-only members,
    series-first top-3 retention.
  - S3 (2 pts; deps S1) — Admission (`src/core/score.ts`): run-member
    override + top-band ceiling constant (calibrate ≈135 via
    `tools/calibrate-bands.mjs`, document population) + single-capital relaxed
    band `max(R_eff(len), 95)`; occurrence-level application OUTSIDE
    `#admitMemo` (the pitfall above); chain-only members skip `store.upsert`.
  - Tests riding each subtask (Mode A): segment/ingest run-detection battery
    (window breaks incl. `ZorpWibbleEngine, quuxblat`, secret split,
    line-initial runs), store tally battery (twin suppression permanence,
    capDisplay tie→recent), score battery (run admits `national`-class at g1,
    top-band `The` chain-only, 95-band boundary probes, structural-start no
    relaxation, guard skip), bigram/successor battery (series marking,
    chain-only inclusion, series-first retention).

**Milestone P1.M2 — Completion surfaces: casing resolution, series offers, typed arming**

- **Task P1.M2.T1 — Resolver, series-first offers, typed-word arming, debug dump**
  - S1 (2 pts; deps P1.M1.T1) — Casing resolver in core + `.display` =
    resolved form at match construction (`src/core/query.ts:531`); resolver
    battery (capital-fragment preserve, frequency winner, tie→lower,
    all-caps verbatim, paths verbatim, zero-fragment listing).
  - S2 (3 pts; deps P1.M1.T1, S1) — Series offers + typed-word arming on BOTH
    paths: zero-char offer ordering (series count-desc, then ordinary
    count-desc) with `nextDisplay` run-casing display/insert
    (`src/pi/provider.ts:436`, `src/pi/widget.ts:655-670`); close-on-space
    arming (uppercase first letter + series successors; lowercase never arms;
    chain-only arms) at `src/pi/widget.ts:951` and `src/pi/provider.ts:535`;
    chain battery: `The ` → `Fed` offer, typed-through disarm, re-arm.
  - S3 (1 pt; deps S1) — `/acwords` schema update (`src/pi/debug.ts`) + tests.

### Phase P2 — Branch-hygiene rebuild (R3)

**Milestone P2.M1 — `session_tree` wiring, rebuild, purity**

- **Task P2.M1.T1 — Event handler, queue discard, gated in-place rebuild, rebind, purity tests**
  - S1 (2 pts; deps none; independent of P1 — may land before or after) —
    `IngestPipeline` queue-discard seam + rebuild plumbing reusing
    `restoreFromHistory` verbatim; `session_tree` handler in
    `src/pi/index.ts` (leafId guard, fresh deps via the session_start builder
    core, gate re-arm, widget re-fresh-composition around the remembered
    factory, fallback rebind, `claim?.release()`).
  - S2 (2 pts; deps S1) — Tests: store branch-purity battery (replay-twice
    identical; incremental == snapshot; no dead-branch words; tallies +
    series bigrams reproduce), provider branch-rebuild bullets (queue discard
    never loses/recounts live words; `newLeafId === oldLeafId` skip; gate
    wait incl. forced), widget branch-rebind bullet (reads the new pipeline;
    claimed row released). Integration item 9's live run lands in P3's smoke.

### Phase P3 — Stabilize + sync (R4 + R5)

- **Task P3.T1 — Tab defers to pi's open menu** (1 pt; deps none): pre-check
  inner `isShowingAutocomplete` in the widget Tab branch, forward verbatim;
  repro → regression suite (header + green).
- **Task P3.T2 — Sync changeset-level documentation** (2 pts; deps P1.M1.T1,
  P1.M2.T1, P2.M1.T1, P3.T1): README sweep, gauntlet, live smoke (series
  walk, branch hygiene, Tab deferral), DoD append + drift report, per R5.

## Acceptance (delta DoD)

- All unit tests green (incl. the former 3 red repros), `npm run check` clean,
  `npm run bench` within gates, live smoke captures recorded, README coherent
  with spec, DoD item appended, zero spec edits, no instrumentation left.
