# PRP — P1.M4.T1.S1: README.md sweep — 12 drift items verified against shipped behavior

## Goal

**Feature Goal**: Bring README.md into coherence with shipped M3 behavior
(R_eff length-conditioned admission, rule-4d path candidates, anchored-fuzzy
matching with tier/frequency ranking, one-line widget dual-path display) by
applying the 12 catalogued drift items from
`plan/003_bbac3b15e8d0/architecture/r5-spec-readme-dod.md` §4, verifying
every remaining claim against shipped behavior, deleting anything
unimplemented, and closing with a stale-phrase grep sweep proving
completeness.

**Deliverable**: A rewritten/swept `README.md` — dual-path intro, M3 status
line, anchored-fuzzy matching wording, retired content-derived order
replaced with the 4-key comparator, R_eff admission wording, widget key
semantics + capture window, stock-contexts-by-construction note, updated
architecture section, verbatim-amended invariants, config table with the
`fuzzThreshold` row and reworded `rejectCommonness` row, widget-mode usage
note — plus a recorded grep-clean confirmation in `research/`.

**Success Definition**: All 12 items applied; `grep -nE 'flat|prefix
search|prefix-only|salience sort|vertical menu|shortest match
first|content-derived' README.md` returns only intentional historical
mentions (each justified in notes) or nothing; every behavioral claim in
README matches the spec section it mirrors and the shipped code; `npm run
check` + `npm test` still green; docs/M1-DoD.md untouched (S2's job).

## User Persona

**Target User**: pi users reading README to decide what hapax does and how
to configure it; hapax developers using README as the (non-authoritative)
overview.
**Use Case**: understand M3 behavior — one-line widget, fuzzy matching,
fuzzThreshold/rejectCommonness knobs — without reading spec/.
**User Journey**: read intro → status → features → usage → config table;
every claim matches what actually ships.
**Pain Points Addressed**: README currently describes the pre-M3 product
(built-in menu, prefix matching, content-derived order, flat admission
band, un-amended invariants) — actively misleading since 2026-10.

## Why

- README is explicitly non-authoritative (README:26-27) but is the public
  face of the changeset; the spec/README divergence predates M3 and M3
  widens it (r5 §8 risk 1).
- P1.M4.T1.S2 (DoD re-verification + M3 DoD append) consumes the swept
  README; the changeset ships with docs coherent with behavior.
- Mode B: this subtask IS the changeset-level README sweep.

## What

Apply the 12 drift items from r5 §4 (locate by quoted phrases, not only
line numbers — the codebase moved since r5's read):

1. **Intro (≈:8)**: "via pi's built-in autocomplete menu" → dual-path
   wording: hapax renders its own one-line result widget below the input
   when an editor factory exists; pi's vertical menu is the fallback path
   (spec/07 h2.42).
2. **Status (≈:11)**: add the M3 completion line + DoD pointer (mirror the
   existing M1/M2 status lines' style; cite docs/M1-DoD.md).
3. **Word matching (≈:33)**: add anchored-fuzzy wording — case-insensitive,
   first char exact (anchor), subsequence after, tiers (exact prefix /
   contiguous tail / scattered), gated by `fuzzThreshold` (spec/04 h2.28).
4. **Menu order (≈:38)**: DELETE "content-derived … shortest match first …
   never reshuffled by session stats" (RETIRED per SPEC.md decision log);
   replace with: tier desc → sessionCount desc within tier → shorter key →
   byte-lex (4-key comparator).
5. **Admission band (≈:42-46)**: DELETE "rarest ~10%" flat-band wording;
   replace with R_eff description: floor q≥12 flat ≤8 chars, sqrt ramp
   9–19, admit-all ≥20; `rejectCommonness` is the FLOOR of the curve,
   higher = looser (mirror spec/04 h2.26 + spec/08 row below).
6. **Enter/menu wording (≈:51-53 + ≈:161-163)**: while the one-line result
   line is visible, the four arrows + Escape + Tab are consumed (invariant
   1 amendment); boundary-Esc (↑/← on first word dismisses); Enter always
   dismisses-then-forwards (submits) on the widget path too.
7. **Stock contexts (≈:55+)**: on the widget path no autocomplete provider
   registers at all — stock path/slash/`@` completion untouched BY
   CONSTRUCTION; the priority/delegation wording describes the fallback
   path only.
8. **Architecture (≈:165-196)**: "prefix search → salience sort" →
   anchored-fuzzy tiered query + frequency ranking; provider is
   fallback-path only; add the widget display layer + editor proxy as the
   primary path (dual-path decided at session start).
9. **Design invariants (≈:229-252)**: mirror SPEC.md verbatim — invariant 1
   with the 2026-10 arrow/Escape amendment, invariant 2 with Tab-only-ever-
   completes / auto-open wording (exact text in r5 §7 — paste verbatim).
10. **Config table (≈:354-369)**: ADD the `fuzzThreshold` row and REWORD
    the `rejectCommonness` row — both verbatim from r5 §6 (which captures
    spec/08 schema rows exactly, incl. the
    `node tools/calibrate-bands.mjs <words...>` probe pointer).
11. **Usage (≈:130-163)**: add a widget-mode note: one line below the
    input, arrows navigate, boundary-Esc dismisses (mirror spec/07 h3.9
    operational wording from r5 §7).
12. **Query path (≈:189)**: "prefix search → salience sort, with zero
    awaits" → anchored-fuzzy tiered query + frequency ranking, zero awaits
    retained (stale twice — matching AND ordering).

Plus one r5-§8-extra: README's perf-gate table row "20k-candidate prefix
query" → "anchored-fuzzy query" (spec/09 wording).

Then the completeness sweep: `grep -nE 'flat band|prefix search|
prefix-only|prefix match|salience sort|vertical menu|shortest match first|
content-derived' README.md` — every hit must be either deleted or an
intentional historical mention noted in research notes. Also verify any
claim NOT in the 12 items against shipped code (e.g., debug /acwords,
dictionary build, known limitations sections) and DELETE anything
unimplemented.

## All Needed Context

### Context Completeness Check

The implementing agent gets all 12 items with quoted stale text,
replacement wording sourced verbatim from spec/r5, the grep completeness
gate, and the file map from claim → spec section → shipped code. No prior
knowledge needed.

### Documentation & References

```yaml
- file: plan/003_bbac3b15e8d0/architecture/r5-spec-readme-dod.md
  why: AUTHORITATIVE drift source — §4 the 12 items with line refs;
    §6 verbatim spec/08 config rows to paste; §7 verbatim SPEC.md
    invariant-1 amendment + boundary-Esc wording; §8 risks (incl. the
    perf-gate "prefix query" table drift).
  gotcha: r5's README line numbers predate implementing subtasks —
    locate items by the quoted phrases.

- file: README.md
  why: THE deliverable. Read fully first (it is explicitly
    non-authoritative at :26-27 — mirror spec, never invent).

- file: spec/SPEC.md
  why: "Design invariants" — the verbatim source for item 9.

- file: spec/04-tokenization-and-scoring.md
  why: h2.26 R_eff curve (item 5), h2.28 anchored fuzzy + tiers +
    fuzzThreshold semantics (items 3, 12), h2.29 ranking (item 4's
    4-key comparator wording).

- file: spec/07-completion-ui.md
  why: h2.42 dual-path display architecture (items 1, 7, 8),
    h3.8-h3.10 widget rendering/keys/visibility (items 6, 11),
    h2.47-h2.48 never-hijack + Enter-submits (items 6, 9).

- file: spec/08-configuration.md
  why: h2.52 schema — the verbatim config rows (item 10).

- file: src/core/query.ts, src/core/score.ts, src/pi/config.ts
  why: SHIPPED behavior to verify wording against — matchFragment/tiers/
    baked fuzz default, R_eff baked floor (12), schema rows + clamps.
    If any spec claim is NOT yet shipped, DELETE the README claim rather
    than documenting vapor.

- file: src/pi/index.ts (+ src/pi widget module)
  why: dual-path session_start branch (item 8's architecture wording).

- file: tools/calibrate-bands.mjs
  why: the probe command cited verbatim in the rejectCommonness row —
    confirm it exists and prints q + verdict as the row claims.

- file: plan/003_bbac3b15e8d0/P1M3T4S1/PRP.md
  why: parallel-item contract (tmux live widget verification) — its
    record feeds P1.M4.T1.S2's DoD append, NOT this README sweep; at most
    one Status sentence if its outcome is shipped. No other overlap.

- file: docs/M1-DoD.md
  why: the Status line's DoD POINTER target (item 2) — cite, do not edit
    (the M3 DoD append is S2's deliverable).
```

### Current Codebase tree (relevant)

```bash
hapax/
├── README.md                     # THE deliverable (sweep)
├── spec/                         # authoritative wording sources (read-only)
├── src/core/{score,query}.ts     # R_eff + anchored fuzzy shipped behavior
├── src/pi/                       # config.ts schema, index.ts dual-path, widget
├── tools/calibrate-bands.mjs     # probe cited in config row
└── docs/M1-DoD.md                # pointer target only — DO NOT EDIT
```

### Desired Codebase tree

```bash
README.md                         # MODIFIED: 12-item sweep + grep-clean
plan/003_bbac3b15e8d0/P1M4T1S1/research/sweep-log.md
                                  # NEW: per-item applied/not-found notes +
                                  # grep output + any intentional keeps
```

### Known Gotchas of our Codebase & Library Quirks

```markdown
# CRITICAL: README is NON-AUTHORITATIVE (README:26-27) — every new/edited
#   claim must mirror a spec section verbatim-in-substance; never invent
#   behavior, and never document unimplemented behavior (delete it).
# GOTCHA: r5's line numbers may have drifted — find items by quoted phrase.
# CRITICAL: items 9's invariant text and 10's config rows are provided
#   VERBATIM (r5 §6/§7) — paste them; do not paraphrase the amendment.
# GOTCHA: "vertical menu" may legitimately survive where the FALLBACK path
#   is described (it still exists) — the grep sweep's hits need case-by-
#   case judgment, recorded in sweep-log.md, not blind deletion.
# GOTCHA: don't append the M3 DoD section to docs/M1-DoD.md — that is
#   P1.M4.T1.S2; don't duplicate its live-verification record either.
# GOTCHA: README edits can't break the build, but run npm run check +
#   npm test once at the end to confirm the tree is otherwise green
#   (this task lands last in M3's changeset).
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: READ everything
  - README.md fully; r5 §4/§6/§7/§8; spec/SPEC.md invariants; spec/04
    h2.26/h2.28/h2.29; spec/07 h2.42 + h3.8-3.10; spec/08 h2.52

Task 2: VERIFY shipped behavior for each claim
  - src/core/score.ts R_eff floor; src/core/query.ts matcher + tiers +
    baked fuzz default; src/pi/config.ts schema clamps; src/pi/index.ts
    dual-path; tools/calibrate-bands.mjs probe output shape
  - Any spec claim not shipped → the README gets silence, not the claim

Task 3: APPLY the 12 items (What §1-12) + the perf-gate table extra
  - Work section by section (intro → status → features → usage →
    architecture → invariants → config); paste verbatim blocks from
    r5 §6/§7 for items 9-10; mirror spec wording elsewhere

Task 4: SWEEP the rest of README
  - Verify claims outside the 12 items (dictionary build, calibration
    guarantee, debug /acwords, known limitations, development/dev loop,
    checks section) against shipped code; delete unimplemented claims
  - Update the perf-gate table row to "anchored-fuzzy query"

Task 5: COMPLETENESS GREP
  - grep -nE 'flat band|prefix search|prefix-only|prefix match|salience
    sort|vertical menu|shortest match first|content-derived' README.md
  - Every remaining hit: intentional historical/fallback mention
    (justified in sweep-log.md) or delete

Task 6: RECORD + VALIDATE
  - research/sweep-log.md: per-item applied (old phrase → new wording),
    grep output, judgment calls
  - npm run check && npm test   # confirm green; docs/M1-DoD.md untouched
```

### Implementation Patterns & Key Details

```markdown
# PATTERN: mirror-not-invent — each edited sentence cites its spec home:
#   "…anchored-fuzzy matching (first char exact, subsequence after,
#   threshold-gated; spec 04)" — README prose, spec semantics.

# PATTERN: retired-mechanism wording (decision-log style):
#   "content-derived ordering is RETIRED (2026-10): results now order by
#   match tier, then in-session frequency, then shorter key, then
#   byte-lexicographic."
```

### Integration Points

```yaml
DATABASE: none
CONFIG: none (documenting only — no code/config changes)
ROUTES: none
DEPENDS-ON: all M3 implementing subtasks (P1.M1-P1.M3, code-complete;
  P1.M3.T4.S1 live-verification lands in parallel — no README dependency)
CONSUMED-BY: P1.M4.T1.S2 (DoD re-verification + M3 DoD append cites the
  swept README; its grep log is evidence the changeset is doc-coherent)
DOCS: Mode B — this task IS the README changeset sweep
```

## Validation Loop

### Level 1: Syntax & Style

```bash
# Markdown has no compiler; gate = grep sweep (Task 5) + link/pointer check:
grep -n "docs/M1-DoD" README.md          # Status pointer resolves
node tools/calibrate-bands.mjs lists deleted   # probe claim in config row works
```

### Level 2: Unit Tests

```bash
npm run check && npm test   # unchanged-green confirmation
```

### Level 3: Behavioral cross-check

Every behavioral claim in the swept README maps to a spec section AND a
shipped code path (Task 2 log in sweep-log.md) — spot-verify 5 claims
end-to-end (e.g., `zsk` → `zendesk` tier-2 example, boundary-Esc wording,
fuzzThreshold default from src/core/query.ts, R_eff admit-all at 20 via
calibrate-bands probe).

### Level 4: Completeness

```bash
grep -nE 'flat band|prefix search|prefix-only|prefix match|salience sort|vertical menu|shortest match first|content-derived' README.md
# expect: no hits, or hits recorded+justified in sweep-log.md
```

## Final Validation Checklist

### Technical Validation

- [ ] All 12 items applied (or explicitly not-found-because-drifted,
      resolved by phrase, logged)
- [ ] Grep sweep clean / justified; perf-gate table row updated
- [ ] `npm run check` + `npm test` green; only README.md + research/ touched

### Feature Validation

- [ ] Intro/status/features/usage/architecture/invariants/config all
      describe shipped M3 dual-path behavior
- [ ] Config table includes verbatim `fuzzThreshold` + reworded
      `rejectCommonness` rows; probe command works as documented
- [ ] Invariant 1 mirrors SPEC.md's 2026-10 amendment verbatim
- [ ] No unimplemented behavior documented

### Code Quality

- [ ] README stays explicitly non-authoritative; wording mirrors spec
- [ ] sweep-log.md records per-item old→new and all judgment calls
- [ ] docs/M1-DoD.md NOT modified (S2's deliverable)

## Anti-Patterns to Avoid

- ❌ Don't invent wording where r5/spec provide verbatim text — paste it
- ❌ Don't document behavior that isn't shipped (delete instead)
- ❌ Don't blind-delete grep hits — the fallback vertical-menu path still
  exists; justify each keep in the log
- ❌ Don't append the M3 DoD section or the live-verification record (S2's)
- ❌ Don't trust r5's line numbers alone — match by quoted phrase
- ❌ Don't touch code/config to make README claims true — docs follow code

## Confidence Score

**9/10** — the drift list, verbatim replacement blocks, and completeness
grep are all pre-catalogued; the residual risk is only line-number drift
(mitigated by phrase-based location) and un-catalogued stale claims outside
the 12 items (mitigated by the Task 4 whole-file sweep + grep).
