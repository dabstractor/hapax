# hapax — Comprehensive Validation Report

**Date:** 2026-10-02 · **Repo:** `/home/dustin/projects/hapax` · **Head:** `56e7ae8`
**Method:** spec-driven validation (spec/ is the single source of truth) — static checks, full test suite, artifact forensics, calibration probes, and the spec §09 **binding live-TTY technique** (ephemeral `pi --no-session` in tmux, keys sent one at a time at ~0.1 s spacing, state verified via `capture-pane`).

---

## Verdict

**3 issues found** — 1 major (user-visible spec violation on the primary display path, live-reproduced), 2 minor (documentation-level drift). No critical issues. Everything else validated green: typecheck, all 1,126 unit/integration tests, all performance gates, dictionary artifact reproducibility, calibration exemplars, and 14 of 15 live end-to-end scenarios.

---

## Validation phases executed (`./validate.sh`)

| Phase | What ran | Result |
|---|---|---|
| 1. Type checking | `npx tsc --noEmit` (strict) | ✅ clean |
| 2. Architecture invariants | `src/core/` contains zero pi imports; package.json pi manifest correct | ✅ |
| 3. Unit + integration | `npx vitest --run` — 38 files, **1,126 passed, 1 skipped** (the skip is the documented `--expose-gc` allocation smoke, optional per spec §09) | ✅ |
| 4. Artifact integrity | shipped `dict/common-en.bin` header/layout per spec §03 (850,554 B, 48,802 entries, LF 0.745, pow2 buckets); **full rebuild from `tools/corpus/en-50k.tsv` is byte-identical**; corrupt-file loader tests green | ✅ |
| 5. Calibration probe | `tools/calibrate-bands.mjs` on all 17 spec §04 exemplar words — every recorded verdict reproduced (noise class rejects at floor; ramp admissions at group 1) | ✅ |
| 6. Live TTY E2E | spec §09 technique: boot, seed (`Zendesk`/`lwlock`), then widget display, Tab casing, trigger char, zero-fragment listing, boundary pass-through, arrow entry, carousel wrap, Escape, chained completion (Tab→space→offer→Tab), Enter-submits, secrets gate, no-persistence | ⚠️ 14/15 pass — 1 real issue (below) |

Performance gates (bench + CI `perf-gates.test.ts` at the spec's 3× rule): query p99 **0.50 ms** (< 1 ms), tier-0 anchorless **0.79 ms** (< 3 ms), dict load + 20k sweep **2.6 ms** (< 60 ms), 800 KB ingest **~102–111 ms** (< 180 ms CI bound), heap delta well under 6 MB.

---

## Bug tracker

### Issue 1 — MAJOR: Widget (primary path) opens the result line only at the **2nd** typed char of a word — violates the never-hijack/open-on-1st-char invariant

**Live-reproduced** (tmux, real pi, fresh session):

- Type `l` (1st char of stored candidate `lwlock`, tier-3 match, score 100 ≫ threshold 60) → **no widget line**.
- Type `lw` → widget renders `lwlock`.
- Backspace back to `l` → widget closes again.
- Same for `z`/`ze` → `Zendesk`.
- Trigger-char mode is unaffected (`#l` offers at 1 char; `#` alone lists) — only **ambient word matching** is affected.

**Binding spec citations contradicted:**

- `spec/SPEC.md` invariant 2: “the menu opens automatically on the 1st char of a matching word (when candidates exist)”.
- `spec/07` widget visibility machine step 2: “Fragment live + ≥ 1 candidate above the fuzzy threshold → line visible” — and “Trigger modes”: word matching “effective from **1** typed char … `config.threshold` is inert”.
- `spec/08` schema: `threshold` “RETAINED BUT INERT in the live editor … matching is effectively 1 char”.

**Root cause (code-level):**

- `src/pi/widget.ts:829` calls `extractMatchState(lines, line, col, deps.config)` with the **raw config** — `DEFAULT_CONFIG.threshold = 2` (`src/pi/config.ts:123`).
- `extractMatchState` gates ambient fragments at `t[0].length >= config.threshold` (`src/pi/provider.ts:105`), so every 1-char fragment returns `null` → the widget closes (“no fragment”) instead of querying.
- The **fallback provider path already clamps correctly**: `src/pi/provider.ts:562` calls `extractMatchState(..., { ...config, threshold: 1 })` with a comment explaining exactly why (“The effective threshold is clamped to 1 HERE”). The widget path — the PRIMARY display path since 2026-10 — never received the same clamp. `src/pi/config.ts:64-66`’s comment (“the provider clamps the effective threshold to 1”) is true only of the fallback.
- Widget tests build on `DEFAULT_CONFIG` (threshold 2) and never exercise a 1-char ambient fragment, so the suite is green despite the deviation — precisely the “unit tests encoded a wrong platform model” failure mode spec §09’s binding live-verification technique exists to catch.

**Secondary effect:** Tab at the 1st char of a matching word cannot complete (the line is hidden, so the editor proxy does not consume Tab — it lands as a literal tab), contrary to invariant 2’s Tab contract.

**Suggested fix direction** (for the fixer agent): pass `{ ...deps.config, threshold: 1 }` at `widget.ts:829` (mirroring `provider.ts:562`), plus a live-TTY-verified unit pin for the 1-char ambient open. Per the binding spec-maintenance policy, no spec edit is needed — the spec already mandates the correct behavior; the code drifted.

### Issue 2 — MINOR: Bench label says 60 ms where the operative budget is 180 ms

`test/bench/core.bench.ts` (lines 40–41, 111) labels gate c “(c) 800KB ingest **<60ms** … [budget <60ms]”. Per spec §09’s 2026-09-30 note (validation Issue 4), the 60 ms headline was never met and the hard CI line is **180 ms** — which `test/perf-gates.test.ts:282` correctly enforces. The stale label invites someone to re-tighten the gate to 60 ms, which the same spec note explicitly forbids without re-optimizing ingest first. Cosmetic (bench names only; behavior correct), but it contradicts the recorded decision.

### Issue 3 — MINOR: Numeric drift in spec §04’s measured-effect prose

Two constants in `spec/04-tokenization-and-scoring.md` don’t match the R_eff formula the code implements (`src/core/score.ts` `rEff`):

- “10 → q<110” — the true boundary is R_eff(10) = 12 + 243·√(2/12) ≈ **111.2** (q ≤ 111 admits). Both cited examples still hold (`government` q=101 admits; `everything` q=139 rejects).
- “`configurations` (15c, … R_eff(15) ≈ 198)” — the word is **14** chars; R_eff(14) ≈ **184**. Verdict unchanged (stem q=26 admits either way; confirmed via `tools/calibrate-bands.mjs`).

Code, calibration tool, and the other boundary figures (9/11/12/14 chars) are exact. Per the binding spec-maintenance policy (spec and code must agree), the spec text should be corrected.

---

## Verified working (no issue)

- **Typecheck + full suite** green (38 files / 1,126 tests; the 1 skip is the documented optional `--expose-gc` smoke).
- **Never-hijack invariant, live:** arrows consumed only after list entry; un-entered ← dismissed the line AND moved the caret on the same press (typing `l` afterwards landed *before* the `#`: `l#` — plain-pi parity); Escape dismissed; **Enter submitted `zend` verbatim while `Zendesk` was offered** (never inserted); every other key forwarded.
- **Arrow model, live:** → entered the list (accent color moved `lwlock`→`Zendesk`); carousel wrapped end-to-end at both edges (verified twice); one-word line forwarded → verbatim.
- **Completion, live:** `ze` → `Zendesk` (one line, `" | "` separators); Tab inserted display casing; `#l` → `lwlock`; `#` alone → zero-fragment listing in sessionCount order.
- **M2 chained completion, live:** Tab (accept `Zendesk`) → space → `lwlock` offered with zero additional typed chars → Tab inserts → `Zendesk lwlock`. Exactly the spec §09 acceptance journey.
- **Secrets, live:** an `sk-…` key submitted into the prompt never surfaced — `#sk` and `#abc` returned zero candidates (shape gate + maskSecrets).
- **No persistence:** live run wrote zero hapax-named files (`/tmp`, `~/.pi/agent`); the no-persistence filesystem unit assertion is green.
- **Dictionary:** header/layout per spec §03; rebuild from the shipped corpus is **byte-identical**; corrupt-file rejection verified.
- **Calibration:** all 17 spec exemplar words keep their recorded verdicts under R_eff.
- **Performance:** every gate passes with wide margin (numbers above).
- **Core purity invariant:** `src/core/` has zero pi imports.

## Observations (not issues)

- Working tree carries uncommitted in-flight plan artifacts (`docs/M1-DoD.md` modified, `plan/005_f9498a2d63d5/` staged) — orchestrator-owned per repo policy; not evaluated.
- `/tmp/hapax-live-*.log` files dated Sep 30 predate this validation (prior session’s instrumentation, outside the repo).
- The `pi -p -e` live smoke inside the test suite passed (real extension load, clean exit).

## Reproducing

```bash
./validate.sh              # all six phases (~3–4 min; live phase uses the
                           # configured default model for two short turns)
HAPAX_SKIP_LIVE=1 ./validate.sh   # skip the live-TTY phase
```

Phase 6’s one failing line is Issue 1; everything else must stay green.
