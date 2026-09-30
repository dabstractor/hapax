# R5 — Changeset-level docs + DoD re-verification inputs (M3 acceptance contract extraction)

Delta PRD 003 / Milestone P1.M4 context. All file:line references verified by direct read. Spec is read-only for this run.

---

## 1. M3 acceptance checklist — every spec/09 bullet the M3 delta must cover

Source: `spec/09-testing-and-acceptance.md` (read in full). M3 = anchored-fuzzy matching + frequency/tier ranking + one-line widget with arrow selection & boundary-Esc (SPEC.md "Implementation milestones", M3 line: "anchored-fuzzy matching, frequency tie-break ranking, and the one-line widget display with arrow selection + boundary-Esc (07)").

### score.test.ts (spec/09, "Unit tests" → score.test.ts)
Verbatim:
- "Admission is length-conditioned (2026-10 gradient; assert relative to the imported constants/R_eff, not absolute quants): floor hold — q ≥ 12 rejects at any length ≤ 8; sqrt ramp 9–19 (boundary probes, e.g. q=81 admits / q=82 rejects at 9 chars); admit-all at len ≥ 20; every attested admission lands at GROUP 1 (flat — the old group-2 band stays dead); absent → group 0; the `rejectCommonness` override moves the floor and the curve scales from it."
- "Proper-noun relief stays retired … no capitalized table-reject ever relieves — under the 2026-10 ramp, long capitalized words that admit do so via R_eff at group 1, not relief."
- "Conjugation guard: inflection whose stem is reject-common rejects … stem comparisons ride R_eff(len(word)) (2026-10) — `uploads` (7c, stem q=38) rejects, `configurations` (15c, stem q=26) admits; the rejectCommonness override moves the floor the curve scales from."
- "Salience arithmetic … (frequency term, recency decay at τ=20, sticky userTyped, properName, rarity bonus)."
- "Eviction ordering (salience × slower τ=50 decay) — menu ordering is NOT salience."

### query.test.ts (M3's anchored-fuzzy + tier ranking — core)
Verbatim:
- "Anchor: the fragment's first char must equal the candidate's first char (`esk` never matches `zendesk`; `roun` → `Rounding` still works via sub-word candidates); case-insensitive throughout."
- "Tier classification: exact prefix (3) / contiguous tail (2: `zsk` → `zendesk`, `zlock` → `z_lwlock`) / scattered (1: `hrp` → `handleResponseProxy`)."
- "Admission score + threshold: below-`fuzzThreshold` matches never render; `fuzzThreshold: 100` = exact-prefix-only mode; score arithmetic per 04's formula for each tier."
- "Ranking: tier descending always (a 1-count exact-prefix word outranks a 40-count scattered match); sessionCount descending within a tier (counts reorder ONLY same-tier neighbors); shorter key, then byte-lex, as final ties; zero-fragment (`#` alone) = sessionCount desc then ties; plural pruning still runs before the limit slice."

### segment.test.ts (rule 4d paths, rule 4b hyphens — M3-relevant only if ingest touched; listed for completeness)
- camelCase `fixRoundingError` → whole + `fix`(dropped) + `Rounding` + `Error`; `HTTPServer` → `HTTP` + `Server`; snake_case; hexish `f3a9c2e` captured / `123456` not; CJK skipped; hyphenated compounds ONE token (`state-of-the-art`), apostrophes split, `--flag`/`-v` never tokens; path rules 4d: `src/core/query.ts`, `/home/user/projects/hapax` (key trims leading `/`, display keeps), `docs/architecture.md`, `../tools/build.mjs`, `example.com/a/b`; contained tokens absorbed; `:line:col` trim (`4:36`, `localhost:8080` keep colons); guards `and/or` not a token, interior `..` rejects, path key cap 96.

### shapeGate.test.ts
- Accept: `zendesk`, `lwlock`, `NREL`, `f3a9c2e`. Reject: `aaaaa`, `aaaaaaa`, `sk-…`, `ghp_…`, `eyJhbG…`, 20+ pure hex, `qqqxxxzzzvvv`, `ab` (dies at entropy, max H = 1.0), single chars, 65+ chars (path class rejects above 96), base64 ≥ 24 mixed.

### calibration
- Referenced from README section "Calibration guarantee": `test/calibration.test.ts` (band edges, measured behavior) and `test/shipped-dict.test.ts` (top words reject, prose no-menu) pin the guarantee to the shipped binary.

### config.test.ts coverage (per spec/08 validation)
- Clamp/repair: `threshold` 1–3, `maxSuggestions` 1–20, `rejectCommonness` 1–255, `fuzzThreshold` 0–100, `menuDelayMs` 0–2000; malformed file → warn once, defaults, continue; `triggerChar` regex `/^[^\w\s]$/` or "".

### widget.test.ts (primary path, M3) — verbatim, THE M3 suite
- "Visibility machine: word-start fragment + candidates → line shows; trailing space (no `@`/`/`) → hides; path/slash/`@` contexts never show; zero candidates never render."
- "Key handling (editor-proxy double): ←/→/↑/↓ all navigate; ↑/← on the first word dismiss (press consumed — caret unmoved — and suppressed until the next word start; disqualification close does NOT suppress); →/↓ on the last word clamp; Tab inserts the highlighted word synchronously (never debounce-gated); Enter dismisses then forwards (submits); every other key forwards verbatim; the inner instance is NEVER mutated (v1 regression pin)."
- "Insertion: replaces the word-regex span or `#fragment` with the candidate's display casing."
- "Highlight resets to top on every set change; debounce/hysteresis and the startup gate carry over to the widget."

### editor-enter (test/editor-enter.test.ts, under provider.test.ts bullets)
- "Enter-submits proxy …: Enter + open word menu → cancel then delegate exactly once; slash menus, closed menus, non-submit keys untouched; the inner instance is NEVER mutated (v1 recursion regression pin); proxy get/set/has forwarding, the thenable guard, and the onKeystroke input-clock hook (fires for every input event; a throwing hook never breaks input)."

### provider* (fallback path)
- Trigger regex cases (`#`, `#ze`, `foo #ze`, `foo#ze` no match, `##` no match); 1-char fragment answers with insertion casing (`nrel` → `NREL`); startup gate (test/startup-gate.test.ts: race waits bounded ≤ maxWaitMs, settled pure pass-through, rejected replay never wedges, onSettled exactly once); chain one-shot grant (test/chain.test.ts); zero candidates → delegate/empty; debounce (one swap at +100 ms; Tab mid-debounce resolves live top); Tab-only-completes incl. forced `force:true` single-item return; hysteresis (no close+reopen on narrowing); delegation with unchanged args.

### chain
- Covered above (chain.test.ts bullets) + M2 DoD items (§5 below).

### Performance gates (see §3).

---

## 2. Integration acceptance items 1–7 VERBATIM (spec/09 "Integration acceptance")

1. "**Happy path:** session discussing `Zendesk` + `lwlock`; type `ze` → menu offers `Zendesk`; Tab inserts `Zendesk` (cased). Type `#l` → `lwlock`. (M3 widget: the offer is one line below the input — `Zendesk | …`; arrows move the highlight; ← twice mid-word dismisses then moves the caret — boundary-Esc.)" — M3 clause is the parenthetical: widget line format, arrow navigation, boundary-Esc two-← behavior.
2. "**No-hijack:** type ordinary prose continuously; keystrokes land verbatim, no menu for common words, Tab with no selection = literal tab. While the result line is visible only arrows/Escape/Tab are consumed (boundary-Esc returns the rest)." — M3 arrow-capture clause is the final sentence: the sanctioned-capture window is exactly {arrows, Escape, Tab} while the line is visible.
3. "**Restore:** `/resume` a 100k+ token session; store rebuilt in background (< 100 ms total); completions available within the first second."
4. "**Compaction:** trigger compaction (long session + `/compact`); store survives; previously admitted words still complete."
5. "**Secrets:** paste an API key into a user prompt; key never appears in suggestions afterwards (shape gate)."
6. "**Path completion regression:** quoted path completion, slash commands, and `@`-mention behaviors identical to stock pi."
7. "**Conversational path completion (2026-10, rule 4d):** a path that appeared in conversation (user-typed or model output) is offered when its FIRST segment is typed — `sr` → `src/core/query.ts`, Tab inserts the whole path; an absolute path inserts with its leading `/`. Once a `/` precedes the cursor, stock pi file completion owns the rest (item 6 unchanged)."

---

## 3. Performance gates: exact numbers + how to run

spec/09 table (verbatim):

| Gate | Limit |
|---|---|
| 20k-candidate anchored-fuzzy query (first-char bucket + tiers + frequency sort + top 8) | < 1 ms p99 |
| Dictionary load + full lookup sweep of 20k words | < 60 ms |
| Ingest 800 KB synthetic session text | < 60 ms, yields every ≤ 64 KB |
| Steady-state heap delta (dict + store) | < 6 MB |

"Benchmarks run with a synthetic dictionary fixture; numbers asserted loosely (CI variance) — hard regressions (> 3× budget) fail."

Commands (package.json scripts, lines 10–12): `npm run check` = `tsc --noEmit`; `npm test` = `vitest --run`; `npm run bench` = `vitest bench`. The hard CI gate is `test/perf-gates.test.ts` ("PRD §09 performance gates … THE hard CI gate", line 2; gates labeled a/b/c/d — e.g. line 70 `describe("perf gate a — 20k-candidate prefix query + rank + top 8")`). Bench file: `test/bench/core.bench.ts`. README "Checks" (~line 490) notes `pi --check` does not exist — the three npm gates are the definition of green.

---

## 4. README drift list — claims that go STALE after M3 (delta PRD 003: anchored fuzzy + tier/frequency ranking + one-line widget)

1. **Line 8 (intro):** "them as Tab completions in the prompt input via pi's built-in autocomplete menu" → post-M3: dual-path — hapax renders its own one-line widget below the input when an editor factory exists (07 h3.8); pi's vertical menu is fallback-only.
2. **Line 11 (Status):** "Status: M2 (v2) — complete, verified 2026-09-07 …" → must gain the M3 completion line + DoD pointer.
3. **Line 33 (Features, Word matching):** silent on matching mode; per spec/07 it's now case-insensitive anchored fuzzy, first char exact, subsequence after, `fuzzThreshold`-gated (04). Add anchored-fuzzy wording.
4. **Line 38 (Features, menu order):** "Predictable, content-derived menu order — shortest match first, then lexicographic; never reshuffled by session stats" → STALE: ranking is now tier desc → sessionCount desc within tier → shorter key → byte-lex (spec/09 query.test.ts; SPEC.md decision log: "the pure content-derived order is RETIRED").
5. **Line 42–46 (Features, English words barely admit):** "Attested English rejects unless it sits in the rarest ~10% of the corpus" and the implicit flat band → STALE: admission is length-conditioned (floor q≥12 flat ≤8 chars, sqrt ramp 9–19, admit-all ≥20; R_eff). RejectCommonness is now the FLOOR of R_eff, not a flat quantile. Required text mirrors spec/08's rejectCommonness row.
6. **Lines 51–53 (Features, Enter always submits) + 161–163 (Usage):** "while a hapax word menu is open" / "The menu is strictly take-it-or-leave" → post-M3 must add: while the one-line result line is visible, arrows/Escape/Tab are consumed (invariant 1 amendment); Enter dismisses then forwards on the widget path too.
7. **Lines 55+ (Features, Stock contexts) — partially stale:** "delegates verbatim to pi's own completion … priority slash → mention → quoted-path → path" → on the widget path no provider registers at all, so stock contexts are untouched "by construction" (07 h3.8). Needs dual-path wording.
8. **Lines 165–196 (Architecture):** "src/pi/ … provider (autocomplete integration)" and Query path "prefix search → salience sort" → STALE: "prefix search" → anchored-fuzzy tiered query; ranking not salience; provider is fallback-path only; add the widget display layer + editor proxy as primary.
9. **Lines 229–252 (Design invariants):** invariant 1 text lacks the 2026-10 arrow/Escape amendment; invariant 2 lacks "Tab only ever completes" / auto-open wording; must mirror SPEC.md verbatim (see §7).
10. **Config table (lines ~354–369):** MISSING `fuzzThreshold` row (spec/08 has it: 0–100, default 60, higher = stricter, 100 = prefix-only, default auto-imported from query module constant). Also `rejectCommonness` description "dictionary quantile at/above which words reject (lower = stricter)" is stale — spec/08 says it's the FLOOR of the length-conditioned R_eff curve, higher = looser, curve scales from it.
11. **Usage examples (lines 130–163):** vertical-menu implied ("menu offers") — fine to keep but a widget-mode note (one line below input, arrows, boundary-Esc) is new-needed.
12. **Line 189 (Query path):** "prefix search → salience sort, with zero awaits" → stale twice (matching + ordering), see #8.

---

## 5. DoD record — docs/M1-DoD.md

Path: `docs/M1-DoD.md`. Structure: `# M1 Definition of Done — evidence record (P1.M4.T2.S2)` (line 1), then gauntlet items 1–6 as `##` sections (type check / all tests / perf gates / integration items 1–6 / no persistence / tuning pointer, lines 30–169), plus "Drift fixes", "Reproduction", then appended post-delta re-verification sections: `## Bugfix-001 re-verification` (line 200) and **`## M2 Definition of Done — post-delta re-verification (P1.M4.T1.S2)` (line 265 — yes, an M2 section exists)** with `###` per acceptance item, `### Bench numbers (2026-09-08, re-captured at 5739b09)`, a triage log, a files-changed table, and a reproduction section; verdict line: "**Verdict: M2 (D2 redesign) DONE.**" (line 474). Later `## Bugfix 001 re-verification (001_0f4b641cf9ce)` (line 506).

**M3 append pattern:** new `## M3 Definition of Done — post-delta re-verification (<task id>, <date>)` section at the end, M1/M2 sections untouched; `###` per M3 acceptance clause (widget visibility machine, key handling/boundary-Esc, insertion casing, highlight reset, editor-enter proxy carry-over, startup-gate carry-over, integration item 1 M3 clause + item 2 capture window, live verification record per the tmux technique), a `### Bench numbers (<date>, re-captured at <commit>)` block, triage log, files-changed table, reproduction commands, bolded **Verdict** line. Suite counts: report green test totals (e.g. "N tests / M suites via `npm test`") as prior sections do.

---

## 6. Config schema verbatim rows needed by R1 (rejectCommonness) and R3 (fuzzThreshold) — spec/08 "Schema"

```jsonc
"rejectCommonness": 12,    // 1–255: dictionary-attestation FLOOR of
                            // the length-conditioned reject curve R_eff
                            // (04): flat through 8 chars, sqrt ramp to
                            // admit-all at 20 — higher = looser, the
                            // whole curve scales from this floor.
                            // Governs admission AND the conjugation
                            // guard's stem comparisons (via R_eff).
                            // Probe any word first: node
                            // tools/calibrate-bands.mjs <words...>
                            // prints q + verdict (lowercase and
                            // Capitalized). Default: the baked constant
                            // in src/core/score.ts.
"fuzzThreshold": 60,      // 0–100: minimum anchored-fuzzy match score
                            // (04) for a candidate to enter a result set.
                            // Higher = stricter; 100 = exact-prefix-only
                            // mode. Default is the calibration starting
                            // point (09 tuning protocol), imported from
                            // the baked constant in the query module
                            // automatically — same pattern as
                            // rejectCommonness.
```

Clamping (spec/08 "Validation"): "clamp/repair invalid values to defaults (log when repaired). … `rejectCommonness` clamped 1–255. `fuzzThreshold` clamped 0–100." Also relevant rows: `maxSuggestions: 8 // 1–20` (widget line cap AND terminal-width truncation per 07), `menuDelayMs: 0 // 0–2000 … DEFAULT 0 (OFF)`, `debug: false // enables /acwords command + store dump`. Not-configurable list (spec/08 "Not configurable"): tier constants, curve shape, salience weights, suffix set, eviction cap, debounce intervals, popup timing — "tier BOUNDARIES are semantics, never runtime-tunable; only the threshold is."

---

## 7. Invariant amendment exact wording (spec/SPEC.md "Design invariants")

Invariant 1 (2026-10 amendment, verbatim):
> "1. **Never hijack typing.** No key is ever captured, consumed, or altered except Tab while a suggestion is selected — plus, on the one-line widget display (M3), the four arrow keys and Escape while the result line is visible; ↑/← on the first word act as Escape (boundary-Esc), dismissing the line and returning every key to the user. The user's typing experience is otherwise unchanged; the result line is strictly take-it-or-leave."

Boundary-Esc operational wording (spec/07 h3.9, verbatim):
> "**Boundary-Esc (owner refinement).** ↑ or ← while the highlight is on the FIRST word acts as Escape: the line dismisses, the press is consumed (it does NOT also move the caret), and control returns to the user — pressing ← twice mid-word goes back one character (first press dismisses, second moves the caret). → and ↓ at the LAST word clamp (consumed, no movement)…" And: "Explicit dismissal (Escape, boundary-Esc) suppresses the line for the REST OF THE WORD. … A disqualification close (candidates hit zero) does not suppress."

Invariant 3 as applied to the widget line (SPEC.md):
> "3. **The popup never flickers and never appears with zero candidates.**"
spec/07 h3.8: "Zero candidates → the line never renders (invariant 3)."

---

## 8. VERDICT

**Feasible.** The M3 acceptance contract is fully specified and internally consistent: spec/09's widget.test.ts suite + integration item 1's M3 parenthetical + item 2's capture window + SPEC.md's amended invariant 1 + 07 h3.8–h3.10 give an unambiguous, testable contract. The DoD append pattern is established (M2 section at docs/M1-DoD.md:265) and an M3 section can follow it directly.

**Risks / drift to record (spec read-only this run):**
1. **README is broadly stale vs. spec already** — ranking description (line 38 "content-derived … shortest match first"), flat-band rejectCommonness wording (line 366), missing fuzzThreshold row, "built-in autocomplete menu" (line 8), architecture "prefix search → salience sort" (line 189), un-amended invariant 1 (lines 229+). README is explicitly non-authoritative (README:26–27), but a docs delta is required post-M3 (§4 list).
2. **No M3 DoD section exists yet** in docs/M1-DoD.md — must be appended, not the spec.
3. **Live verification is binding** for the widget (spec/09 Live verification technique: "the M3 one-line widget is the deepest UI-layer change yet (own rendering + own key handling): live verification against the real extension stack (pi-vim + split-editor) is mandatory before acceptance").
4. Minor: spec/09 perf-gate table says "anchored-fuzzy query … < 1 ms p99" while README's gate table says "prefix query" — README drift, not a spec contradiction.

**Open questions:** none blocking — the only judgment call is how much of README to rewrite in the docs changeset (recommend: all of §4's 12 items, since the spec/README divergence predates M3).
