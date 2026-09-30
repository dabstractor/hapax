# README stale-claims audit — plan 004 P1.M2.T1.S1 (tier-0 + `#` loose mode)

Scope: README.md only (spec/*.md READ-ONLY; no code/test edits). Every fix
mirrors the spec wording in `plan/004_24ebf0115d16/prd_snapshot.md`
(h2.28 / h2.45 / h2.49 / h2.52 / h2.56 item 2 / perf-gate table) — README is
non-authoritative per AGENTS.md; nothing invented. Row numbers per
tier0_design.md §7; located by text (lines drifted after edits, as that doc
warned).

## Fixed

| README row (pre-edit anchor) | What was stale | What it now says | Spec source |
|---|---|---|---|
| Feature bullet ":36–44" ("three strictness tiers") | Three tiers, no tier 0, no anchorless fallback, no `#` loose mode | Four tiers (exact prefix > contiguous tail > scattered > **tier 0 anchorless fallback**); tier 0 = zero-anchored-result-only full-store contiguous-run pass, floor 3 chars, score `85 − 40·runStart/len`, threshold-gated, sorts below tier 1; `#` loose mode = tier-0 always consulted + tier-1 visible (45 vs 60, explicit override both); anchored scan < 1 ms + fallback < 3 ms p99 budgets | 04 h2.28 (tier-0, `#` loosening, performance) |
| Tiered-order bullet ":45–52" | Tier list without tier 0 | Order extends to 3 > 2 > 1 > 0 + "the zero-result tier-0 fallback can never enrich a menu that would already open — it only rescues menus that would not appear"; sessionCount/shorter/lex tail and bare-trigger clause unchanged | 04 h2.28 measured record + 09 ranking order |
| Chaining blurb ":128–131" | "fuzzy matches admitted into chains" (implied tier-0 eligible) | Chains stay ANCHORED everywhere — the chain gate consults tiers 1–3 only; tier-0 matches never arm or extend a chain. One-shot grant, reset-on-`before_agent_start`, disqualification, and restore-arm prose untouched | 07 h2.49 |
| No-hijack prose ":194–195" | Flat "no result line appears for common words" | "…for common words **with anchored matches** — the zero-result tier-0 fallback MAY surface one-shot contiguous-run cousin menus (`said`→`unsaid` class, ~5–20% by fragment length) that narrow away as typing continues (spec 09 item 2)" — owner-accepted cost stated, not softened | 09 h2.56 item 2 (amended 2026-10) |
| Config table `fuzzThreshold` row ":429" | Flat default 60, no per-mode semantics | Default 60 ambient / 45 under the trigger char (scattered tier-1 visible there); an explicitly set value overrides BOTH modes; clamped 0–100; higher = stricter; 100 = exact-prefix-only; default auto-imported from the baked query-module constant (same pattern as `rejectCommonness`) | 08 h2.52 (schema row) |
| Perf table "~:579" | No tier-0 budget row | Added: "Tier-0 anchorless fallback pass (full store; fires only when the anchored scan returns zero; also `#` loose-mode scans) \| < 3 ms p99" — existing < 1 ms anchored-query row kept | 09 perf-gate table (h2.58) |
| Audit hit ":14" (M3 status tagline) | "anchored-fuzzy matching with tier/frequency ranking" | "anchored-fuzzy matching with an anchorless tier-0 fallback and tier/frequency ranking" (optional hit, fixed — one clause) | 04 h2.28 |
| Audit hit ":213–214" (src/core module list) | `query` described as anchored-fuzzy + ranking only | "anchored-fuzzy matching + the zero-result tier-0 fallback + tier/frequency ranking" | 04 h2.28 |
| Audit hit ":230" (Query flow bullet) | "anchored-fuzzy tiered query (first-char bucket scan)" | "(first-char bucket scan; zero-result tier-0 fallback)" | 04 h2.28 / 07 h2.45 |
| Audit hit ":255" (ASCII pipeline diagram) | box label "query (anchored fuzzy)" | "query (anchored + tier-0)" — box alignment preserved (31 inner columns) | 04 h2.28 |
| Audit hit ":454–457" (non-configurable list) | Tier constants without tier-0 | "(including the tier-0 fallback's 3-char floor and score formula)" added as non-configurable semantics; boundaries-are-semantics sentence unchanged (still true) | 08 (non-configurable list) |

## Verified already agreeing (no edit)

- Module rows `editor` / `debug` / `paths` in the src/pi list: agree ✅ (tier0_design §8).
- Dictionary figures: README "48,802 entries" (×2, :343/:388) matches
  `test/shipped-dict.test.ts:13`; the 850,554 B artifact size is a
  shipped-dict concern, not stated in README (nothing to fix). LF ≈0.745
  not stated in README either.
- M2 DoD re-theme: pinned at `test/acceptance.test.ts:838` ("zero-typing
  chain — Zorp → space → … (h2.54)") ✅ — README's M2 references don't
  conflict.
- "Decision log" = a section in `spec/SPEC.md:67` ("## Decision log (all
  settled)") ✅ — README's informal "(2026-10 decision log)" cites are fine.
- README:49-style informal decision-log cites and the tagline's "tier/
  frequency ranking": judged, fixed where the delta invalidated them (see
  above).

## Residuals for P1.M2.T1.S2's drift report

- None functional. Two cosmetic notes: (1) README's perf-gate prose says
  "these three gates" (dictionary/ingest/heap rows) while the table now
  carries five rows (the < 1 ms and < 3 ms query rows predate/extend the
  count) — pre-existing wording, left alone per don't-blanket-rewrite;
  (2) the perf-gate table row names "`#` loose-mode scans" inside the
  tier-0 budget — matches the spec table verbatim (09), kept.
- `grep 'three strictness tiers' README.md` → 0 hits post-edit;
  `grep 'WITH ANCHORED MATCHES'` → the amended no-hijack row;
  `grep 'never arm'` → the chaining row.

## Validation

- Docs-only change: `npm run check` + `npm test` green, byte-identical to
  the pre-task state (no code/test/spec file touched by this task).
