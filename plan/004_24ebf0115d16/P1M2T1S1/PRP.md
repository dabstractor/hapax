---
name: "P1.M2.T1.S1 (plan 004) — README sweep to landed tier-0 + loose-mode behavior"
---

## Goal

**Feature Goal**: Bring README.md into agreement with the LANDED tier-0
anchorless fallback + `#` loose-mode behavior (P1.M1.T1.S1/S2,
P1.M1.T2.S1/S2) by updating the four stale rows identified in
`plan/004_24ebf0115d16/architecture/tier0_design.md` §7 — plus auditing
every other tier/anchor claim the delta invalidates — mirroring the staged
spec text (README is NON-AUTHORITATIVE vs spec per AGENTS.md; quote-adjacent
phrasing, never invent). No code, no tests, no spec edits.

**Deliverable**:
1. Updated README.md rows: :36–44 feature bullet; :45–52 tiered-order
   bullet; :128–131 chaining blurb; :194–195 no-hijack prose; :429
   fuzzThreshold config row; perf-table tier-0 budget row (near :579);
   one-clause query-flow mentions at :213–214/:230/:255.
2. A concise stale-claims list — what was found, what was fixed, what was
   verified-already-agreeing — written to
   `plan/004_24ebf0115d16/P1M2T1S1/research/stale-claims.md` for
   P1.M2.T1.S2's DoD record and drift report.

**Success Definition**: every tier/fuzzThreshold/chaining/no-hijack claim
in README matches the landed behavior and the spec wording; a full-README
grep for the stale phrases ("three strictness tiers", "no result line
appears for common words", tier lists without 0, fuzzThreshold rows
without per-mode semantics) returns nothing; verify-only items (module
rows, dict figures, M2 DoD re-theme, decision-log cite) confirmed
agreeing with residuals noted; `npm run check` + `npm test` still green
(no code touched).

## Why

- The tier-0 fallback and `#` loose mode landed (P1.M1) but README still
  describes matching as three-tier anchored-only with a flat
  fuzzThreshold — the summary a user reads first is wrong about the
  feature's most user-visible behavior change (one-shot cousin menus,
  `#query` path completion, per-mode strictness).
- Mode B: this subtask IS the changeset-level documentation for the
  delta; P1.M2.T1.S2 (DoD record + live smoke + drift report) consumes
  the stale-claims list produced here.

## What

Mirror the spec; the authoritative phrasing lives in spec/04 h2.28
(tier-0 + `#` loosening + performance), spec/07 h2.45 ("Match gates per
mode"), spec/07 h2.49 ("Successor chaining stays ANCHORED everywhere"),
spec/08 h2.52 (fuzzThreshold schema row), spec/09 h2.56 item 2 (amended
no-hijack wording). Spec files are READ-ONLY — README follows them.

### Row 1 — :36–44 feature bullet ("Word matching from the 1st typed character")

Current stale text: "Matches come in three strictness tiers (exact prefix
> contiguous tail > scattered), and a candidate enters the result set only
above the `fuzzThreshold` score (0–100; 100 = exact-prefix-only)." — no
tier 0, no anchorless fallback, no `#` loose mode.

New content (spec-adjacent):
- Four strictness tiers: exact prefix > contiguous tail > scattered >
  **tier 0, the anchorless fallback** — when the anchored scan returns
  ZERO results (and only then), one full-store pass matches the fragment
  (≥ 3 chars) as a single contiguous run anywhere in the key
  (`esk` → `zendesk`, `query` → `src/core/query.ts` — path filenames,
  which sub-word splitting can't serve); scored
  `85 − 40·runStart/len`, threshold-gated, sorted below tier 1.
- The `#` loose mode (spec 04/07): under the trigger char, tier-0 runs
  are ALWAYS consulted (no zero-result precondition — `#query` completes
  `src/core/query.ts` directly) and scattered tier-1 matches are visible
  (`#` default threshold 45 vs ambient 60; an explicitly set
  `fuzzThreshold` overrides both modes).
- Keep the anchor prose and the < 1 ms anchored-scan note; add that the
  fallback pass carries its own budget (< 3 ms p99, empty-anchored path
  only).

### Row 2 — :45–52 tiered-order bullet ("Predictable tiered menu order")

Extend the order to four tiers (3 > 2 > 1 > 0) and add: the zero-result
tier-0 fallback can never enrich a menu that would already open — it only
rescues menus that would not appear. Keep the sessionCount/shorter/lex
tail and the zero-fragment clause unchanged.

### Row 3 — :128–131 chaining blurb

Current: "Typed characters filter the live successor list normally (fuzzy
matches admitted into chains, gated by the same `fuzzThreshold`)."
Add/replace with the spec rule: **chains stay anchored everywhere** —
chain arming and the chain membership gate consult tiers 1–3 only; tier-0
(anchorless) matches never arm or extend a chain. Keep the rest of the
chain paragraph (one-shot grant, resets, restore) untouched.

### Row 4 — :194–195 no-hijack prose

Current: "no result line appears for common words."
Amend per spec/09 item 2 (2026-10): "no result line appears for common
words **with anchored matches** — the zero-result tier-0 fallback MAY
surface one-shot contiguous-run cousin menus (`said`→`unsaid` class,
~5–20% by fragment length) that narrow away as typing continues."

### Row 5 — :429 config table `fuzzThreshold` row

Mirror spec/08 h2.52: default `60` ambient / `45` under the trigger char
(scattered tier-1 visible there); an explicitly set value overrides BOTH
modes; 0–100 clamped; higher = stricter; 100 = exact-prefix-only; default
auto-imported from the baked constant in the query module (same pattern
as `rejectCommonness`).

### Row 6 — perf table (~:579)

Add a tier-0 budget row: "Tier-0 anchorless fallback pass (full store,
fires only when the anchored scan returns zero)" | < 3 ms p99 (CI gate at
3×), mirroring the existing gate-row format. Keep the existing < 1 ms
anchored-query row.

### Full-README audit (grep, then judge each hit)

`grep -n 'tier\|anchor\|never matches\|mid-word\|fuzzThreshold' README.md`
— hits beyond the rows above: :14 (tagline — fine, optionally add
"anchorless fallback"), :213–214/:230/:255 (module/flow blurbs — add a
one-clause tier-0 mention where the query flow is described), :454–457
(tuning/boundaries prose — boundaries-are-semantics stays true; tier 0's
floor-3/score may be added as non-configurable semantics, optional).
Fix anything the delta invalidates; leave accurate prose alone.

### Success Criteria

- [ ] All six rows updated, spec-quote-adjacent, in README's existing voice/format
- [ ] `grep -n 'three strictness tiers' README.md` → nothing; :194–195 amendment present; :429 has 60/45 + override-both; chaining blurb states tier-0 never arms
- [ ] Perf table carries the < 3 ms p99 tier-0 row
- [ ] Verify-only items confirmed (module rows, dict figures 48,802/850,554 B, M2 DoD re-theme, decision-log cite at spec/SPEC.md:67); residuals recorded
- [ ] stale-claims.md written to plan/004_24ebf0115d16/P1M2T1S1/research/
- [ ] `npm run check` + `npm test` green (unchanged — docs only)

## All Needed Context

### Context Completeness Check

An implementer needs: the exact stale rows with current text, the exact
replacement spec phrasing and where it lives, the full-README audit list,
the verify-only items, the style constraint (README non-authoritative),
and the output path for the stale-claims list. All below.

### Documentation & References

```yaml
- file: README.md
  why: The ONLY file this task edits. Rows: :36–44, :45–52, :128–131,
        :194–195, :429, ~:579 perf table; audit hits :14, :213–214, :230,
        :255, :454–457.
  pattern: existing row voice — bold-lead feature bullets, table cells,
           prose paragraphs; cite spec sections and source files as the
           surrounding text does.
  gotcha: README is NON-AUTHORITATIVE vs spec (AGENTS.md) — mirror, never
          invent; do not touch spec/*.md.

- file: plan/004_24ebf0115d16/architecture/tier0_design.md
  section: "§7 Docs (Mode A riders…) + Mode B final task" and "§8
           Drift/verification notes"
  why: The scout-verified stale-row list with exact line numbers, the
        verify-only items, and the explicit out-of-scope list.

- docfile: plan/004_24ebf0115d16/prd_snapshot.md (mirrors spec/)
  section: h2.28 (tier-0 + `#` loosening + performance + measured record),
           h2.45 (match gates per mode), h2.49 (chaining stays anchored),
           h2.52 (fuzzThreshold schema row), h2.56 item 2 (amended
           no-hijack), h2.58 (tier-0 perf gate row, if present)
  why: The exact phrasing to mirror. Spec/*.md is READ-ONLY; the snapshot
        is the working copy for quoting.

- docfile: plan/004_24ebf0115d16/P1M1T2S2/PRP.md
  why: The parallel in-flight predecessor — defines the LANDED wiring the
        README must describe (RankOptions.loose, resolveFuzzThreshold
        60/45, tier-0 never arms chains, widget Tab never arms). Treat as
        a contract.

- file: test/shipped-dict.test.ts (line ~13)
  why: Verify-only source for the dict figures (48,802 / 850,554 B).

- file: test/acceptance.test.ts (line ~838)
  why: Verify-only source for the M2 DoD re-theme pin.
```

### Current Codebase tree (relevant)

```bash
README.md                                      # MODIFY (six rows + audit fixes)
plan/004_24ebf0115d16/P1M2T1S1/research/       # stale-claims.md (new)
```

### Known Gotchas & Library Quirks

```markdown
# GOTCHA: line numbers drift once edits land — locate rows by their
# current TEXT (quoted in this PRP), not only by line number.

# GOTCHA: don't overstate the fallback in the no-hijack row — the spec's
# amendment is precise: "WITH ANCHORED MATCHES" + "MAY surface one-shot
# contiguous-run cousin menus (… narrowing away as typing continues)".
# The owner ACCEPTED the cousin-menu cost; the README must not apologize
# for or hide it.

# GOTCHA: the tier-0 score is 85 − 40·(runStart / len(c)) — runStart,
# not charsSkippedBeforeRun+1 phrasing; match spec/04's formula verbatim.

# GOTCHA: chains — "tier-0 matches never arm or extend a chain" is the
# load-bearing sentence; do not weaken the existing one-shot-grant/reset
# prose while editing the bullet.

# GOTCHA: per-mode defaults — ambient 60, trigger 45, explicit override
# BOTH. Do not describe 45 as "the new default".

# GOTCHA: verify-only items are NOT edit targets; if a residual mismatch
# is found there, record it in stale-claims.md for S2's drift report —
# do not silently fix beyond the six rows + audit fixes.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: AUDIT pass
  - grep README.md for tier/anchor/fuzzThreshold claims (command above)
  - Read the six target rows + every audit hit; confirm the stale list
    against tier0_design.md §7 (line numbers may drift — match by text)
  - Read spec mirror rows (h2.28/h2.45/h2.49/h2.52/h2.56) in
    plan/004_24ebf0115d16/prd_snapshot.md for the phrasing to mirror

Task 2: EDIT the six rows (README.md)
  - Row 1 (:36–44): four tiers + anchorless fallback + `#` loose mode
  - Row 2 (:45–52): order 3>2>1>0 + "only rescues menus that would not appear"
  - Row 3 (:128–131): chains stay anchored; tier-0 never arms/extends
  - Row 4 (:194–195): WITH ANCHORED MATCHES amendment + cousin-menu clause
  - Row 5 (:429): per-mode 60/45 + explicit-override-both + auto-import
  - Row 6 (~:579): tier-0 perf row < 3 ms p99 (3× CI), fires on empty-anchored only
  - Audit fixes: one-clause tier-0 mentions at :213–214/:230/:255;
    :14/:454–457 optional/leave-accurate-prose-alone

Task 3: VERIFY-ONLY sweep
  - Module rows (editor.ts/debug.ts/paths.ts), dict figures
    (48,802 / 850,554 B / LF ≈0.745), M2 DoD re-theme
    (acceptance.test.ts:838), decision-log cite (spec/SPEC.md:67)
  - Record agreement ✅ / residual mismatch in the stale-claims list

Task 4: WRITE stale-claims.md
  - PATH: plan/004_24ebf0115d16/P1M2T1S1/research/stale-claims.md
  - CONTENT: table/list of (row, what was stale, what it now says, spec
    source) for every fix + the verify-only results + any residuals
    for S2's drift report

Task 5: VALIDATION (docs-only)
  - grep for retired phrases returns nothing:
      grep -n 'three strictness tiers' README.md
  - npm run check && npm test   # green, unchanged — confirms no code touched
```

### Implementation pattern

Style example for Row 5 (table cell, mirroring spec/08 h2.52):

```markdown
| `fuzzThreshold`  | number  | `60`   | `0`–`100` (clamped) | minimum fuzzy match score (spec 04) for a candidate to enter a result set. Per-mode defaults (2026-10): 60 ambient (word matching), 45 under the trigger char (scattered tier-1 visible there); an explicitly set value overrides BOTH modes. Higher = stricter; 100 = exact-prefix-only. Default auto-imported from the baked constant in the query module — same pattern as `rejectCommonness` |
```

### Integration Points

```yaml
NONE (documentation only):
  - P1.M2.T1.S2 consumes research/stale-claims.md for the DoD record
    (docs/M1-DoD.md append) and the drift report.
  - No code/spec/test integration.
```

## Validation Loop

### Level 1–3: docs-only

```bash
grep -n 'three strictness tiers' README.md        # expect: nothing
grep -n 'WITH ANCHORED MATCHES' README.md         # expect: the amended row
grep -n 'never arm' README.md                     # expect: the chaining row
npm run check && npm test                          # green, unchanged
```

### Level 4: spec-conformance re-read

Re-read spec/04 h2.28, spec/07 h2.45/h2.49, spec/08 h2.52, spec/09 h2.56
item 2 against each edited row: every claim in the README must be
traceable to a spec sentence.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` + `npm test` green (no code touched)
- [ ] Stale-phrase greps return nothing

### Feature Validation

- [ ] Six rows updated, spec-quote-adjacent, README voice preserved
- [ ] Four-tier order stated; fallback "only rescues menus that would not appear"
- [ ] `#` loose mode: always-consulted tier-0, tier-1 at 45, override-both
- [ ] No-hijack amendment with cousin-menu clause (owner-accepted cost, not hidden)
- [ ] Chaining: tier-0 never arms/extends; existing grant/reset prose intact
- [ ] Perf table: tier-0 < 3 ms p99 row added
- [ ] Verify-only items confirmed; residuals recorded

### Code Quality Validation

- [ ] No spec/*.md edits; no code edits beyond README.md; no invented claims
- [ ] stale-claims.md delivered for S2
- [ ] Audit hits each judged (fixed or left-accurate), not blanket-edited

## Anti-Patterns to Avoid

- ❌ Don't invent behavior the spec doesn't state — every claim traceable to a spec sentence
- ❌ Don't edit spec/*.md, tests, or source — README + the stale-claims list only
- ❌ Don't hide or soften the cousin-menu cost — the owner accepted it and spec/09 item 2 documents it
- ❌ Don't blanket-rewrite accurate prose (audit each grep hit)
- ❌ Don't describe 45 as the global default — it's the trigger-mode default only

**Confidence Score: 9/10** — pure documentation with a scout-verified row
list, exact spec phrasing quoted, and a defined output artifact; the only
variable is grep-audit judgment, bounded by the explicit hit list.
