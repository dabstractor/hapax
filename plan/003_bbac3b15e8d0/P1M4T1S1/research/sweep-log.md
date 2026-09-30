# README sweep log — 12-item drift sweep (P1.M4.T1.S1, plan 003)

Sweep date: 2026-09-08 · HEAD at sweep: `0f1018c` (widget live-verification
landed — the last M3 implementing commit). Only `README.md` was modified;
`docs/M1-DoD.md` untouched (S2's deliverable). Every new/edited claim was
verified against shipped code before being written; nothing unimplemented
was documented.

## Verification log (Task 2 — claim → shipped evidence)

| Claim (README) | Spec home | Shipped evidence |
| --- | --- | --- |
| Dual-path display: widget primary / vertical menu fallback | spec/07 h2.42, h3.8 | `src/pi/index.ts` L226–249: editor factory → `createWidgetEditorFactory(...)` PRIMARY, "no addAutocompleteProvider — ever"; else provider fallback. `src/pi/widget.ts` exists |
| Anchored fuzzy: first char exact, subsequence after, 3 tiers, fuzzThreshold-gated | spec/04 h2.28 | `src/core/query.ts`: `DEFAULT_FUZZ_THRESHOLD = 60`, matchFragment tier doc, fuzzThreshold admission gate; live probe: `zsk` → `["Zendesk"]`, `ze` → `["Zendesk","zephyr"]` (spot-check through real `rankMatches`) |
| 4-key comparator: tier desc → sessionCount desc within tier → shorter key → byte-lex | spec/09, SPEC.md decision log | `src/core/query.ts` `compareRankedMatches` doc ("4-KEY TOTAL ORDER"); bare-`#` listing exception (no tiers → count desc → byte-lex) |
| R_eff: floor 12 flat ≤8, sqrt ramp 9–19, admit-all ≥20 | spec/04 h2.26 | `src/core/score.ts` rEff doc; `node tools/calibrate-bands.mjs` header prints exactly that curve; coverage measured: 45,118/48,802 entries q ≥ 12 |
| rejectCommonness = FLOOR, higher = looser | spec/08 schema | config.ts row + score.ts constant 12; probe verdicts (`provider` q=34 REJECT, `handoff` q=10 admit, `context` q=51 REJECT, `data` 82, `code` 91, `lazy` 67, `ordinary` 79 — all REJECT; README examples re-verified, all true) |
| Widget keys: arrows navigate, boundary-Esc, Tab inserts, Enter submits | spec/07 h3.8–h3.10 | `src/pi/widget.ts` + commits 73efbd2 (arrow/Escape capture), b40bd8e (Tab completes / Enter submits), f6ec824 (visibility machine), 0f1018c (live-verified) |
| Stock contexts untouched by construction on widget path | spec/07 h2.42 | index.ts: widget path registers NO provider; fallback `classifyStockContext` verified in provider tests (99/99 green in prior sweep) |
| Conjugation guard rides R_eff | spec/04 | score.ts comment + probe: `deleted` (45) / `lists` (49) REJECT |
| Prose-only session → empty store | spec/04 (2026-10) | `test/shipped-dict.test.ts` "ingests prose.jsonl into a store that is now EMPTY by design (2026-10 R_eff curve)" |
| Dictionary 48,802 entries | — | artifact header read: `entries: 48802` ✓ |
| /acwords shape (top 50, histogram, successor sample) | spec/08 | `src/pi/debug.ts` TOP_N=50, histogram render, SUCCESSOR_SAMPLE_N successor section ✓ |
| Corpus claims (en-50k.tsv vendored, 988-line drop, 70k cap) | — | `tools/corpus/README.md` (988), `tools/build-dict.mjs` (70000) ✓ |
| Probe command works as documented | — | `node tools/calibrate-bands.mjs <words>` runs, prints q + R_eff + verdict (lc | Cap) ✓ |

## Per-item applied (Task 3) — old phrase → new wording

1. **Intro** — "offers them as Tab completions in the prompt input via pi's
   built-in autocomplete menu" → dual-path: one-line widget below the input
   when an editor factory exists; vertical menu as fallback (spec 07).
2. **Status** — prepended "M3 (v3) — complete, live-verified 2026-09-08"
   line + docs/M1-DoD.md pointer (M3 DoD append noted as landing with S2).
   Prior M1/M2/bugfix pointer sentences preserved.
3. **Word matching** — added anchored-fuzzy wording (anchor char,
   subsequence, tiers, fuzzThreshold, first-char bucket keeping <1 ms).
4. **Menu order** — DELETED "content-derived … shortest match first …
   never reshuffled"; replaced with the 4-key comparator + RETIRED
   decision-log note + bare-trigger listing exception; salience →
   retention/eviction only (kept, still true).
5. **Admission band** — DELETED "rarest ~10%" flat-band wording; replaced
   with R_eff (floor 12 flat ≤8, sqrt ramp 9–19, admit-all ≥20) + verified
   examples (provider/null/node reject, handoff stays, context rejects) +
   prose-empty-store pin; rejectCommonness reworded as the floor
   (higher = looser).
6. **Enter/menu wording** — Features "Enter always submits" now covers both
   display paths (widget dismiss-then-forward via the editor proxy);
   widget key semantics (arrows/Escape/Tab consumed while visible,
   boundary-Esc) added to Usage.
7. **Stock contexts** — dual-path wording: widget path registers no
   provider → untouched by construction; delegation priority chain
   described as fallback-path behavior.
8. **Architecture** — src/pi/ module list gains `widget` + `editor`
   (primary) with `provider` marked fallback-only; core `query` described
   as anchored-fuzzy + tier/frequency ranking; `score` as R_eff admission;
   segment mentions rule-4d path tokens; the three-paths list replaces
   "Popup" with "Display (dual-path, decided at session start)"; diagram
   redrawn (widget primary box + provider fallback box); lifecycle
   paragraph describes the session-start dual-path decision.
9. **Design invariants** — invariants 1–2 replaced with SPEC.md verbatim
   (2026-10 amendment: four arrows + Escape on the widget line;
   boundary-Esc; "Tab only ever completes" + auto-open wording; Enter
   always submits). Invariants 3–4 verbatim unchanged. The trailing
   guarantee paragraph updated to the 2026-10 shape (empty prose store
   pin) — the old "~8,500 words" number was stale under the R_eff floor
   (45,118/48,802 entries ≥ q 12).
10. **Config table** — ADDED verbatim-derived `fuzzThreshold` row (0–100,
    default 60, higher = stricter, 100 = exact-prefix-only, default
    imported from the query-module constant per r5 §6); REWORDED
    `rejectCommonness` row as the R_eff floor (higher = looser, curve
    scales from it, governs the conjugation guard, probe pointer) per r5
    §6. `maxSuggestions` row gained the widget-line-cap clarification
    (spec/08 note). Probe command verified live.
11. **Usage** — added the widget-mode note (one line below the input,
    `" | "` join, arrows navigate, boundary-Esc, Tab inserts, Enter
    submits; vertical menu = fallback); example wording "menu offers" →
    "offers" (path-neutral); prose paragraph "menu" → "result line".
12. **Query path** — "prefix search → salience sort, with zero awaits" →
    "anchored-fuzzy tiered query (first-char bucket scan) → frequency
    ranking, with zero awaits".

**Plus the r5 §8-extra**: perf-gate table row 1 → "20k-candidate
anchored-fuzzy query (first-char bucket + tiers + frequency sort + top 8) |
< 1 ms p99" (spec/09 verbatim), + a sentence noting the suite's two
shipped-extra bounds (restore, flood).

## Task 4 whole-file sweep (outside the 12 items)

- **Calibration guarantee section** (stale beyond r5's list): bands
  "REJECT_COMMON_THRESHOLD = 50, MID_FREQ_THRESHOLD = 20" → the shipped
  R_eff floor 12 + curve; "q ≥ 50 covers the top ~8,501" → measured
  45,118/48,802 ≥ 12 + prose-empty pin; the BUG-001 historical narrative
  kept but closed with the 2026-10 retune; calibrate-bands.mjs described
  as R_eff-aware (verified from its output header).
- **"Not configurable (by design)"**: "admission bands (100/50)" → the
  r5 §6 list (tier boundaries/constants, R_eff curve shape, suffix set,
  salience weights, eviction cap, debounce/popup timing).
- **Known limitations**: "Tab may insert a top item the debounced popup
  hasn't painted yet" → display-neutral rewording (widget line or fallback
  popup, one debounce behind).
- **Development**: dev-loop verification note kept (dated 2026-09-07,
  historical); added one sentence: the M3 widget live-verification
  (2026-09-08, real pi + split-editor per spec 09) — justified because
  commit 0f1018c landed it in this changeset.
- **Debug section**: histogram wording tightened (mid/common buckets
  near-empty under the 2026-10 curve — matches score.ts's deleted MID row).
- Verified-unchanged (still true, left alone): Quick start, jiti section,
  symlink section, graceful-disable section, Checks section, corpus
  provenance, versioning contract, non-goals, chaining bullets (verified
  against chain/successors/chaining-gating suites in the bugfix-001 sweep).

## Completeness grep (Task 5) — output + judgment calls

```
$ grep -nE 'flat band|prefix search|prefix-only|prefix match|salience sort|vertical menu|shortest match first|content-derived' README.md
42:  100 = exact-prefix-only). The store's first-character index stays the
48:  `src/core/query.ts`). The pure content-derived order (shortest match
429:| `fuzzThreshold`  | number  | `60`    | `0`–`100` (clamped)  … 100 = exact-prefix-only mode. …
```

All three hits are INTENTIONAL KEEPS:

- **L42, L429** — `exact-prefix-only` matches the `prefix-only` pattern;
  it is the spec/08-verbatim name of fuzzThreshold=100's strictest mode
  (r5 §6: "100 = exact-prefix-only mode"), not the retired prefix-search
  mechanism.
- **L48** — "The pure content-derived order (shortest match first,
  lexicographic) is RETIRED (2026-10 decision log)" is the item-4
  retirement announcement itself, prescribed by the PRP's
  retired-mechanism wording pattern.

Near-miss fallback mentions (do not match the grep literally, recorded for
completeness): "pi's built-in vertical autocomplete menu" (intro) and the
Usage/Architecture fallback descriptions — the vertical menu genuinely
still exists as the fallback path (spec 07 h2.42), so these are accurate
fallback mentions, not drift.

## Validation

- Pointer check: `docs/M1-DoD.md` referenced (status + item-5 evidence) ✓;
  file itself NOT modified (S2's deliverable) ✓.
- Probe check: `node tools/calibrate-bands.mjs lists` prints q + verdict ✓.
- Behavioral spot-checks: `zsk` → `Zendesk` via real `rankMatches` ✓;
  fuzzThreshold default 60 from `src/core/query.ts` ✓; R_eff admit-all ≥20
  from the probe header ✓; prose-empty pin in shipped-dict.test.ts ✓;
  boundary-Esc wording verbatim from spec/07 h3.9 ✓.
- `npm run check` + `npm test`: green post-sweep (docs-only change;
  confirmed in the final run).
