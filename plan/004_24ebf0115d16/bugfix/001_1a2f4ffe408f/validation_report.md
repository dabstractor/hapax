# hapax — Comprehensive Validation Report

**Date:** 2026-09-30 (validator run)
**Scope:** Full-codebase validation against the PRD (bug-fix requirements listing 4 defects), the binding spec (`spec/*.md`), and the README's documented user journeys.

---

## Executive Summary

All **four PRD defects (BUG-001 … BUG-004) are verified FIXED** end-to-end through the real modules (shipped dictionary, real `IngestPipeline`/`CandidateStore`, real widget editor factory and fallback provider compositions). The fix changeset (commits `b9e1f6f`…`f204f30` plus staged spec amendments) is spec-synced per AGENTS.md's binding policy for three of the four areas.

Independent fresh-eyes validation found **2 new minor issues**:

1. **V-1** — a residual case of the PRD's BUG-002 class survives the fix: the tokenizer still emits overlapping tokens (and both reach the store as near-duplicate candidates) for literals whose trailing-symbol trim straddles a base token *without containment* (e.g. `q~z9_`, `X=1ZZ_` — the PRD's own fuzz example).
2. **V-2** — the staged spec-drift pass corrected spec/04's 9-char admission boundary but missed its spec/09 twin, leaving the two spec files contradicting each other and both contradicting the pinned test.

Baseline numbers this run: `tsc --noEmit` clean; vitest **1109 passed / 1 skipped (38 files)**; independent E2E harness **22/24 passed** (the 2 failures ARE finding V-1, intentionally failing as recorded evidence).

---

## Phase Results (`./validate.sh`)

| Phase | Result | Detail |
|---|---|---|
| 1. Linting | N/A | No linter configured in this repo (skipped, documented) |
| 2. Type checking | ✅ PASS | `npm run check` (tsc --noEmit) clean |
| 3. Style checking | N/A | No formatter configured (skipped, documented) |
| 4. Unit testing | ✅ PASS | 1109 passed / 1 skipped (38 files); stderr `error:` lines are intentional bad-dict-path test output |
| 5a. E2E harness | ⚠️ 22/24 | Both failures are recorded finding V-1 (below); all 4 PRD repro replays pass |
| 5b. Spec agreement | ⚠️ 3/4 | 5b-4 failure is recorded finding V-2 (below) |

The E2E harness is validator-authored (not the project's own tests) and drives the REAL modules: real shipped `dict/common-en.bin`, real `IngestPipeline` → `CandidateStore` → `recordBigramRuns`, real `createWidgetEditorFactory` composition over a stateful fake inner editor (typing/submit), real `createHapaxProvider` fallback, 25k-iteration tokenizer fuzz, 300-iteration chunk-seam fuzz, and README journey replays.

---

## PRD Defect Fix Verification

### BUG-001 — M2 chained completion dead on the widget PRIMARY path → **VERIFIED FIXED**
Evidence (E2E tests A0–A4, real pipeline + real widget factory):
- Seeding the PRD's exact text yields `topSuccessors("zorpwibble") === [{next:"quuxblat",count:2}]` (A0).
- Typing `zorpw` paints the line live with `zorpwibble`; **Tab inserts `ZorpWibble`, consumes the key (never forwarded), and arms the chain** — `chain.state() === {word:"zorpwibble"}` (was `null` before the fix) (A1).
- **Space at the empty word start renders the zero-typed-char successor offer on the widget line** (`visible === true`, set `["quuxblat"]`, provenance `description === "chain"`); a second Tab inserts exactly one word and re-arms at `quuxblat` (A1).
- The offer filters live as typing continues (A2); the fallback provider path still chains (A3, regression); `enableChaining:false` keeps M1 word-only behavior — Tab arms nothing, no successor offer (A4).
- Spec sync: spec/07 now states chain offers render on the widget line with arming at the widget's Tab-insert (validate 5b-1 PASS). README amended accordingly (commit `f204f30`).

### BUG-002 — tokenizer overlapping spans / duplicate candidates → **VERIFIED FIXED for the reported shape; residual class found (V-1)**
- `tokenize("FOO_1_")` now returns exactly ONE token `[0,6)` (the base token; literal defers — commit `c90d5f8`) (B1).
- Full ingest of `rename FOO_1_ and USER_2_TOKEN_ constants` stores `foo_1_`/`user_2_token_` with **no** `foo_1`+`foo_1_` duplicate pair; `rankMatches(store,"foo_")` offers `FOO_1_` only (B2).
- **However** the fix only implemented the containment/defer arm of the PRD's recommendation. The overlap-without-containment arm is still missing → finding V-1 below.

### BUG-003 — cross-message suppression leak → **VERIFIED FIXED**
- PRD repro replayed through the composed widget: `ze` → line visible → Tab inserts `Zendesk` at column 0 (suppression recorded) → Enter submits, buffer clears → fresh buffer `lw` now shows the line with `["lwlock"]` (C1 PASS; was `visible:false` pre-fix per PRD).
- The fix (dismissed-buffer fingerprint, commit `fac248b`) does not over-release: extending the SAME dismissed word after Escape stays suppressed; the next word start releases (C2 PASS).

### BUG-004 — 64KB chunk-boundary token shredding → **VERIFIED FIXED**
- Separated construction at true 64KB scale (word starting at the slice edge): `zorpwibble` lands whole, no `ibble`/`zorpw` junk halves, and the bigram spans the seam (`topSuccessors === [{next:"quuxblat",count:1}]`) (D1a).
- The PRD's exact glued construction (`'a'.repeat(65531)+"Zorpwibble…"`): the defect symptoms are gone — **no severed halves in the store**, post-seam `quuxblat` intact (D1b). Note: clean `zorpwibble` is not extractable from the glued form even UNCHUNKED (the 65541-char run exceeds the 96-char run cap and shreds identically), so the PRD repro's "store contains zorpwibble" expectation was achievable only for the separated form; chunked and unchunked semantics now agree.
- Boundaries on space/comma/newline count each word exactly once (D2); a 300-iteration fuzz at `chunkBytes=13` shows every intended word landing whole with zero junk keys (D3). Commit `4255690` + test battery `390a8f1`.

---

## New Findings

### V-1 (Minor) — Tokenizer still emits OVERLAPPING tokens when a rule-4c literal's trailing-symbol trim straddles a base token without containment
**Location:** `src/core/segment.ts` — final union/merge loop, "overlap safety" branch (~lines 660–680); the containment-defer added by commit `c90d5f8` covers only the strict-containment direction.

**Repro (deterministic, minimized):**
```
tokenize("q~z9_")   → tokens "q~z9"[0,4)  and "z9_"[2,5)   — OVERLAP
tokenize("X=1ZZ_")  → tokens "X=1ZZ"[0,5) and "ZZ_"[3,6)   — OVERLAP  (the PRD fuzz's own example)
tokenize("l~gY1p_") → tokens "l~gY1p"[0,6) and "gY1p_"[2,7) — OVERLAP
```
25k-iteration fuzz over the segment alphabet hits the class broadly (first hit: `"l~1gY1p_-\r…"`).

**Mechanism:** the literal pass trims the trailing `_` from the literal's span; a base token (which may contain `_`) starts INSIDE the literal and ends past its post-trim end. The merge loop's containment check (`fn.start <= tok.start && tok.end <= fn.end`) fails, and the "overlap safety" fallback then **emits the literal AND keeps the straddling base token** — exactly the two-token overlap the PRD described for BUG-002. The shipped fix handles only the case where one span strictly contains the other (`FOO_1_`).

**User impact (verified end-to-end):** ingesting `fix the q~z9_ flag and the X=1ZZ_ var today` through the real pipeline stores BOTH `q~z9` AND `z9_` as candidates — near-duplicate completion targets pollute the menu, violating the documented structural invariant in `segment.ts` ("Never emits overlapping tokens", which the union filter claims to make "a structural invariant instead of a proof obligation").

**Recommended fix:** implement the PRD BUG-002 recommendation's first arm — treat a base/hexish token as absorbed when it merely OVERLAPS the literal's post-trim span (`tok.start < litEnd && tok.end > litStart`), mirroring the existing compound-vs-literal tie handling.

### V-2 (Minor) — spec/09 still claims "q=82 rejects at 9 chars", contradicting the amended spec/04 and the pinned test
**Location:** `spec/09-testing-and-acceptance.md` line 38 ("sqrt ramp 9–19 (boundary probes, e.g. q=81 admits / q=82 rejects at 9 chars)").

The staged drift-fix pass amended `spec/04` to the correct boundary ("9 chars admits q≤82 (`R_eff(9)` ≈ 82.15 … q=83 is the first reject") and fixed spec/09's eviction line, but missed this second instance. As staged, **the two spec files now contradict each other**, and both spec/09's claim and reality diverge: `test/score.test.ts` (~line 129) pins `q=82` ADMITS / `q=83` rejects. Under AGENTS.md's binding spec-maintenance policy ("spec and code in agreement"), the fix changeset's spec sync is incomplete.

**Fix:** one-line edit to spec/09 ("q=82 admits / q=83 rejects at 9 chars").

---

## Observations (not counted as issues)

1. **Uncommitted staged work:** the spec/04 + spec/09 amendments and `plan/004…/bugfix` PRP/tasks files are staged but not committed (`git status`). Not a defect; noted so the changeset isn't accidentally split.
2. **README chain illustration:** the "Acme → Zephyr" example uses two words the admission rules reject as too common (`acme` q=17, `zephyr` q=22 in the shipped dictionary), so that literal pair never arms in a real session. The mechanism itself is sound and was journey-tested with admitting words (`Noria → Inverter → quuxblat → Zorpwibble`, four consecutive zero-typed-char accepts, E3 PASS). Cosmetic/doc-level nuance only.
3. **The unit suite grew from 1053 (PRD baseline) to 1109 tests** — the fix changeset added regression batteries for all four defects (widget chain matrix + E2E, underscore ingest, suppression, chunk-boundary battery), which all pass.

---

## Testing Summary

| Area | Result |
|---|---|
| Type check (`tsc --noEmit`) | ✅ clean |
| Unit suite (`vitest`) | ✅ 1109 passed / 1 skipped |
| PRD BUG-001 widget chain E2E (A0–A4) | ✅ fixed, incl. fallback regression + config gate |
| PRD BUG-002 repro (B1–B2) | ✅ fixed for reported shape |
| PRD BUG-003 repro (C1–C2) | ✅ fixed, no over-release |
| PRD BUG-004 repro (D1a/D1b/D2/D3) | ✅ fixed at true 64KB scale + fuzz |
| README journeys (E1–E6) | ✅ all pass (incl. 4-hop chain walk, trigger mode, Enter-submit, never-hijack) |
| Core invariants fuzz (F1–F3) | ✅ pass |
| Tokenizer span-disjointness fuzz (B3/B4) | ❌ **V-1 residual overlap** |
| Spec agreement (5b) | ❌ **V-2 spec/09 contradiction** |

**Total new issues found: 2** (0 critical, 0 major, 2 minor).
PRD issues: 4/4 verified fixed.

## Recommendations

- **V-1:** extend the pass-4 literal/base resolution to absorb on plain overlap (not just containment), and pin the minimized cases (`q~z9_`, `X=1ZZ_`) plus the existing 25k fuzz as a permanent test.
- **V-2:** correct the spec/09 boundary sentence to "q=82 admits / q=83 rejects" so the spec files agree with each other and with the pinned test.
- Commit the staged spec/plan changes so the bugfix changeset lands atomically.
