# Research — P1.M4.T1.S1 README sweep (M3 drift)

## Verified facts

- Authoritative drift source: plan/003_bbac3b15e8d0/architecture/r5-spec-readme-dod.md
  §4 — 12 numbered drift items with exact README line refs (see PRP body).
  §6 has the verbatim spec/08 config rows (rejectCommonness, fuzzThreshold)
  to paste. §7 has the verbatim SPEC.md invariant-1 amendment and the
  boundary-Esc operational wording.
- README line refs from r5 §4: :8 intro, :11 Status, :33 word matching,
  :38 menu order, :42-46 flat band, :51-53 + :161-163 Enter/menu wording,
  :55+ stock contexts, :165-196 architecture, :189 query path (stale
  twice), :229-252 invariants, :130-163 usage, :354-369 config table.
  NOTE: r5's line numbers were captured at its read time; line drift is
  possible after implementing subtasks — locate items by the quoted
  phrases, not only line numbers.
- README:26-27 already declares README non-authoritative vs spec — the
  sweep MIRRORS spec wording (spec/04 h2.28 anchored fuzzy, h2.26 R_eff;
  spec/07 h2.42 dual-path widget, h3.8-3.10 key handling; SPEC.md
  invariants; spec/08 schema), never invents.
- Shipped-behavior sources to verify against: src/core/score.ts
  (R_eff baked constant), src/core/query.ts (matchFragment/tiers/fuzz
  threshold baked default), src/pi/config.ts (schema rows, clamps),
  src/pi/index.ts dual-path session_start branch, widget module (under
  src/pi/, M3 module), tools/calibrate-bands.mjs probe.
- Parallel item P1.M3.T4.S1 (tmux live widget verification) — produces a
  live-verification record consumed by P1.M4.T1.S2 (DoD append), NOT by
  the README sweep. It may touch instrumentation only; no README overlap.
  Its live-verification status is worth one Status-line sentence at most
  (and only if shipped).
- r5 §8 risk 4: README's own perf-gate table says "prefix query" — also
  stale ("anchored-fuzzy query"), beyond the 12 items; fix while there.
- Gates: npm run check / npm test — README edits can't break them, but run
  to confirm nothing else moved; grep sweep for stale phrases is the
  real completeness gate.
- Mode B: this subtask IS the changeset-level README sweep; S2 appends
  the M3 DoD section to docs/M1-DoD.md (per r5 §5 pattern) — don't do
  that here.
