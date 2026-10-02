# Research notes — P1.M2.T1.S1 (plan 005): README sweep, re-mirror invariant 1

## Verified facts
- `architecture/external_deps.md` §"README.md stale inventory" (626 lines) — the authoritative list, re-verified against the live README:
  - **:313–331 "Design invariants" mirror**: header claims "that file is authoritative; the text below is verbatim", but invariant 1 (:318–323) is the OLD model — "the four arrow keys and Escape while the result line is visible; ↑/← on the first word act as Escape (boundary-Esc), dismissing the line and returning every key to the user" (capture-while-visible, consumed press). Authoritative v2 text: spec/SPEC.md:38–43 (read; quoted in the PRP).
  - **:195–200 widget-mode prose**: ALREADY v2 (two-state per result set, boundary pass-through "caret moves on that same press", carousel "both edges wrap end-to-end") — do not regress.
  - **:545 verification note**: "arrow/Escape/Tab key capture" — needs v2-consistent wording (capture applies only once ENTERED; un-entered ↑/← forward).
  - False-positive grep hits to IGNORE: "rescues"/"TypeScript"/"desc"/"narrow"; config-table "(clamped)" :462–486 (knob ranges); :241 word-boundary tokenization.
  - README has NO decision-log table — only prose refs to "(2026-10 decision log)" at :14, :23, :70, :251–252, :268; audit those for old-model wording (grep shows none mention arrows/clamp — verify only).
- Live README grep (my own): :321 carries "boundary-Esc, dismissing the line and" — the sole stale old-model phrase hit; :197/:200 are the already-v2 prose; :462–486 "(clamped)" false positives confirmed.
- spec/SPEC.md:38–43 invariant 1 v2 text (read verbatim — will be quoted in the PRP): "...the arrow keys and Escape once the result line has been ENTERED; on an un-entered line ↑/← on the first word dismiss the line AND forward the press (the caret moves — one press, plain-pi parity)..."
- Invariants 2–4 in the README mirror (:324–331): compared against SPEC.md — identical (v2 only changes invariant 1). Verify during the edit; only invariant 1's text changes.
- Predecessor P1.M1.T1.S3 (parallel): rewrites test/widget.test.ts battery to v2, zero source/README changes — no overlap; its landed v2 behavior (S1 decision table + S2 wiring, both Complete) is the input this README documents.
- Consumers: P1.M2.T1.S4 (dated changeset record in docs/M1-DoD.md) consumes this sweep.
- Validation: docs-only — `npm run check` + `npm test` green trivially; grep-clean assertions.
- README is NON-AUTHORITATIVE vs spec (the section header itself says so) — the mirror must be verbatim from SPEC.md:38–43.
