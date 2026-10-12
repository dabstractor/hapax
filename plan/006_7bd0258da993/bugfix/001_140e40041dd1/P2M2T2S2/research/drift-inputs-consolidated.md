# Drift inputs — consolidated & verified against the working tree

Verified 2026-10-12 at HEAD `c9097c6` ("docs: pin the no-re-request-after-apply
contract"). Quotes below are CURRENT working-tree text (post-955de50/bb1e99b
concurrent docs commits — line numbers re-measured; cite by section title).

## 1. Complete drift-item list (the report's content)

### spec/04 — "## Case handling" (:701-716) — verbatim-path precedence
- Current: ":713-714 `verbatim in all caps; paths and technical literals always
  insert verbatim.`" + Shift-preserve sentence ":706-708 `the capitalized form
  wins — the user's Shift press is never overridden`".
- Delta: make explicit that the verbatim-path rule OUTRANKS the Shift-preserve
  rule (Shift governs letters; a leading `/`, `~`, `.` is not a letter).
  Supersedes the old battery reading "a typed capital capitalizes a path key".
- Code: src/core/query.ts `resolveCompletionCasing` — guard :404
  `if (c.pathDisplay !== undefined) return c.pathDisplay;` is the FIRST line;
  widened Pick :392; doc block :366.
- Subtask: P1.M2.T1.S2 (wording intent recorded in its PRP Goal item 3 + "Why"
  bullet citing spec/04 :713-714; battery-header drift note).

### spec/06 — "## M1: word candidates" (:3-37) — Candidate.pathDisplay
- Current: Candidate interface :8-21 has NO pathDisplay field.
- Delta: `pathDisplay?: string` — verbatim edge-bearing display for path-class
  candidates; seeded sticky-first by the FIRST path sighting at upsert's
  create branch; merge branch never writes it; absent ≡ never arrived as a
  path sighting; wins over capDisplay at resolution.
- Sub-edit: "## Upsert semantics" (:53-66) create branch gains the
  pathDisplay seeding sentence + the known edge (first-arrival-non-path keeps
  NO pathDisplay → inserts bare).
- Sighting.path: NOTE — "Sighting" appears NOWHERE in spec/*.md (verified
  `rg -n "Sighting" spec/` → 0 hits). It is code-level (src/core/types.ts:99).
  Report should say so and leave the spec-vs-code-doc placement decision to
  the reconciling session (recommend: one-line note under M1).
- Code: src/core/types.ts :43 (Candidate.pathDisplay), :99 (Sighting.path doc);
  src/core/store.ts :407-409 (create-branch seeding).
- Subtask: P1.M2.T1.S1; near-final drafted wording exists in
  `P1M2T1S1/research/spec06-drift.md`.

### spec/07 — "### Widget visibility state machine (auto-open, re-based)" (:323+),
step 3 at :336-337 — armed-typed-word exception
- Current step 3 text (verbatim, :336-337):
  `3. Trailing space with no \`@\`/\`/\` in text-before-cursor → hidden`
  `(close-on-space carried over as the widget's own state).`
- Delta: exception — when the trailing space completes a typed word that ARMS
  a series chain, the zero-char successor offer paints AT the space tick
  (intent-driven show in the spirit of step 6). Governing requirement: spec/07
  "## M2: chained completion" (:690-757), armed(W) ≈:700-701: "the successors
  of W immediately: series successors first …" / "before the user types
  anything".
- Code: src/pi/widget.ts :787 (`zeroCharOffer` helper def), :956-960
  (arming-site paint; comment records the step-3 tension for this task).
  Unit pins took the M2-intent reading (test/widget-visibility.test.ts).
- Subtask: P2.M1.T1.S1.

### spec/07 — "### pi-tui contract dependencies (re-verify on upgrades)" (:596-613)
— fifth bullet
- Current: ":598 `Four runtime contracts are leaned on by the FALLBACK path`"
  intro; four bullets :604-611.
- Delta: "Four"→"Five" + fifth bullet "no re-request after applyCompletion
  (three apply sites in editor.js — menu-Tab accept :545, select.confirm
  :560, forced single-item fast path :1906 — verified against pi-tui 0.84.4)".
- FINAL drafted text exists VERBATIM in
  `P2M2T2S2/research/spec07-h315-reverify-drift.md` (intro diff + full bullet
  + application note tying it to the provider.ts PIN and P2.M2.T1.S2's
  battery). Copy, don't re-draft.
- Code: PIN comment in src/pi/provider.ts `applyCompletion` (≈:745-760; ":750
  none of the three re-requests", ":755 any pi-tui upgrade…"); commit c9097c6.
- Subtask: P2.M2.T1.S1.

### Input (d) — live-TTY divergences from P2.M1.T1.S2: NONE
- architecture/live-tty-bug003-run-notes.md §Divergence log: "**None.** …
  Nothing to route to P2.M2.T2.S2 from this item." (Reproduced twice, zero
  instrumentation.) The report records this as a verified-empty input.

### No-delta ledger (record these determinations too)
- BUG-001 (P1.M1.*) restores already-spec-pinned behavior (spec/07 M2, spec/05)
  — no spec delta; the e2e layers are test-only.
- BUG-002's user-visible behavior (verbatim edges) was already pinned
  (spec/04 rule 4d + integration item 7 + Case handling) — restored; only the
  internal-shape docs drifted (the two items above).
- README (sibling P2.M2.T2.S1) is not spec — AGENTS.md: README never
  overrides spec. No drift item.
- spec/08/09/SPEC.md ranking wording was reconciled by concurrent commit
  bb1e99b itself — not this changeset's drift.

## 2. Governance citations for the report header
- AGENTS.md (repo root): "interactive sessions MUST keep spec and code in
  agreement — a change that ships code without the matching spec edit (or
  vice versa) is incomplete … Pipeline/plan agents treat spec/*.md as
  read-only inputs and record drift in their reports."
- spec/SPEC.md "## Spec maintenance policy (binding)" :14-27 (both bullets).
- architecture/system_context.md "## Binding governance (drives task design)"
  item 1 (spec READ-ONLY for pipeline agents; drift records, not edits).
- architecture/repo-governance-and-conventions.md §1 (policy condensed).

## 3. Method note (for the report's own header)
Quote by SECTION TITLE, not line number: commits 955de50/bb1e99b landed
concurrent spec/docs edits (spec 08/09/SPEC.md in bb1e99b) — line numbers in
the item contract (spec/07:336-337, :596-607) were re-measured and happen to
still hold at c9097c6, but the tree keeps moving (P2.M2.T1.S2's battery and
P2.M2.T2.S1's README sync land after this research). The implementer re-runs
the quote-verification greps at write time.
