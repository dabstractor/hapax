# hapax — Validation Report (re-validation pass)

**Date:** 2026-10-12 · **Validator:** independent validation agent
**Scope:** verify the PRD's 4 bug findings against the current tree after bugfix changeset `001_140e40041dd1` (commits `d4465d8`…`e924145`), hunt for regressions or new issues introduced by the fixes, and re-run the full shipped gauntlet.
**Method:** full typecheck + test suite, plus 11 purpose-built E2E probes composed through the REAL `src/pi/index.ts` factory (fake pi shell + minimal fixture dict only — pipeline/store/query/provider/widget are production objects), static contract checks at each fix seam, and hand-verification of the pi-tui dist contract. Probe harness is embedded in `validate.sh` (Phase 5c) and re-runnable.

## Verdict on the PRD findings: ALL 4 FIXED (independently verified end-to-end)

### BUG-001 (Major) — Series-bigram enrichment stripped at the production wiring seam — **FIXED**
- `src/pi/index.ts:247` now passes the enriched payload: `onAdmittedTokens: (runs) => sessionStore.recordBigramRuns(runs)`; the mirrored test wirings the PRD named are un-shimmed (`test/acceptance.test.ts:741`, `test/adversarial-typing.test.ts:475`). (`test/bigrams.test.ts` still feeds bare strings at 3 sites — deliberate, pinning the store's documented legacy-string input contract, not a production mirror.)
- Independently verified through the real factory (probes PROBE-1a/b/c): an "Alpha Beta gamma delta epsilon today" history lands `alpha → Beta ×1 (series)` with run casing in `/acwords`; typing `Alpha ` arms the chain and the next query offers `Beta` (prefix `""`, run casing); a ×1 series successor outranks a ×3 ordinary successor; negative control (no series) never arms. The fixer also added factory-seam e2e on both display paths (`test/index.test.ts` fallback + widget describes) and a live-TTY run is recorded.

### BUG-002 (Major) — Path candidates complete with edge-trimmed key — **FIXED**
- `src/core/store.ts:409` seeds `pathDisplay` sticky-first at the upsert create branch (`Sighting.path` rides the occurrence, `src/pi/ingest.ts`); `src/core/query.ts:404` returns `pathDisplay` first on every casing branch — including uppercase fragments (verbatim-path outranks Shift-preserve).
- Independently verified (probes PROBE-3, PROBE-4c): `~/logs/hapax-run.log` and `/srv/data/manifest.json` display AND Tab-insert with edges on the widget path; the fallback provider offers the edge-bearing values; typing `Sr` (Shift) still inserts `/srv/data/manifest.json` verbatim; sticky-first holds across `../lib/util.mjs` → `/lib/util.mjs` edge variants of one trimmed key. Non-path Shift-preserve is unregressed (`feder`/`Feder` → `Federal`).

### BUG-003 (Minor) — Zero-char successor offer one keystroke late (typed-word arming) — **FIXED**
- `src/pi/widget.ts:1101`: the typed-word arming site calls the shared `zeroCharOffer` helper in the space tick's own frame and returns without `closeWith` when it painted; zero successors / swap-window park still fall through to close (menu never renders with zero candidates).
- Independently verified through the real factory (probes PROBE-2a/b/c): after typing `Alpha ` the chain is armed AND the offer `Beta` is visible at the space tick itself (before any further typing); the paint survives a maximal `menuDelayMs: 5000` (chain intent bypasses hesitation); typing `B` narrows without a close-reopen; Tab inserts `Alpha Beta`; ordinary lowercase `gamma ` still closes with no paint and no arm. The parked-then-close path is leak-free (`closeWith`→`hide` clears `pendingSet` and the swap timer).

### BUG-004 (Minor) — Missing PIN + fallback battery for the no-re-request contract — **FIXED**
- PIN present at the consumption site: `src/pi/provider.ts` `applyCompletion` override carries the "NO RE-REQUEST AFTER APPLY" block enumerating all three apply sites with line refs and the re-verify instruction.
- Hand-verified against the installed `@earendil-works/pi-tui@0.84.4` dist: all three `applyCompletion` sites (`editor.js:545`, `:560`, `:1906`) apply and return without `requestAutocomplete` (encoded as a standing check in `validate.sh` Phase 5b).
- Fallback-path post-accept battery delivered: `test/provider-live.test.ts` "fallback path — post-accept battery (spec 07 h3.11 fallback paragraph)" + display-layer twin in `test/provider-display.test.ts`; probe PROBE-4b confirms `applyCompletion` delegates verbatim, exactly once, with no self-query.

## Open Issues (2 minor — new findings, not PRD regressions)

### Issue 1: Spec reconciliation for changeset `001_140e40041dd1` is still pending (D-1…D-4 unapplied)
**Severity**: Minor · **ID**: NEW-001 · **Location**: `spec/04`, `spec/06`, `spec/07` vs. the staged worklist `plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/spec-drift.md`

The changeset shipped code whose spec documentation is now out of agreement in four places (verified against the current tree): spec/04 "Case handling" lacks the verbatim-path-outranks-Shift-preserve clause (D-1); spec/06's `Candidate` interface lacks `pathDisplay` and its sticky-first create-branch semantics (D-2); spec/07 visibility step 3 ("trailing space → hidden") lacks the arming-space exception the BUG-003 fix implements per the governing M2 `armed(W)` requirement (D-3); spec/07 h3.15 still says "Four runtime contracts" — the PIN's fifth bullet (no re-request after applyCompletion) is unapplied (D-4). Per the repo's binding spec-maintenance policy, the changeset is incomplete until an interactive session applies them. The pipeline was correctly forbidden from editing `spec/*.md` (Mode A) and did the right thing: a complete, re-verified, ready-to-apply worklist is staged (`git status`: `architecture/spec-drift.md` etc.). This finding tracks that the handoff is still open — apply D-1…D-4 (D-4 byte-identically as instructed), then `npm run check && npm test`.

### Issue 2: Stale factory-seam timing pin — `test/index.test.ts` widget e2e (a) still describes the pre-BUG-003 timing
**Severity**: Minor · **ID**: NEW-002 · **Location**: `test/index.test.ts:1561` (test name) and `:1583-1591` (comment block)

Commit `7098ea7` inverted "the suite's two timing pins" (widget.test.ts, widget-visibility.test.ts) but missed the third: the factory-seam e2e's name says "the **next word-start tick** paints the run-cased 'Fed' offer" and its comment asserts "today's landed timing — the arming site still closes: 'never paint from the arming site' … When P2.M1.T1.S1's space-tick paint lands, THIS assertion moves up to the space tick above". P2.M1.T1.S1 **has landed** (it *is* `7098ea7`); my probe PROBE-2a proves through the same real-factory composition that the paint now lands at the space tick. The test still passes only because asserting visibility after typing `F` succeeds under both timings — so the new same-tick contract is unpinned at the very factory layer this e2e was added to guard, and its prose describes superseded behavior. Fix: move the `hidden === false` + `["Fed"]` assertions up to the space tick (as the comment itself instructs) and update the name/comment.

## Testing Summary

- Shipped gauntlet: `tsc --noEmit` clean; vitest **40 files, 1315 passed / 1 skipped / 0 failed** (up from 1286 in the PRD — the changeset added ~29 tests incl. factory-seam e2e and the fallback battery).
- Independent E2E probes (real factory, `validate.sh` Phase 5c): **11/11 green** — series enrichment + arming + series-first (fallback & widget), space-tick zero-char paint + hesitation bypass + Tab accept + close-on-space non-regression, verbatim path display/insert on both paths incl. uppercase-fragment precedence and sticky-first edges, Shift-preserve non-regression, applyCompletion delegation.
- Static contract checks: 9/9 green (wiring, seams, PIN, battery, pi-tui dist).
- Invariants spot-checked live: menu never visible with zero candidates (asserted across all probe sequences); Tab-only completion; no persistence beyond the sanctioned `/tmp/hapax-store.txt` debug dump; `session_start`/`session_shutdown` lifecycle exercised implicitly by every probe session.
- Advisory open items (Phase 5d): 5 detected = the 2 issues above (D-1…D-4 count as Issue 1's four deltas).

## Bug counts
- PRD bugs verified fixed: 4 (2 Major, 2 Minor)
- Open issues found this pass: **2 Minor** (NEW-001, NEW-002)
- Critical: 0 · Major: 0 · Minor: 2

## Recommendations
1. Apply the staged spec worklist D-1…D-4 in an interactive session (D-4 byte-identically per its FINAL marker), closing NEW-001; re-run `./validate.sh` — the four drift advisories clear.
2. Update `test/index.test.ts:1561-1591` to pin the space-tick paint at the factory seam (move the assertion up, as its own comment instructs), closing NEW-002.
3. Keep `validate.sh`'s Phase 5b standing check in mind on any pi-tui upgrade: if a post-apply re-request ever appears, the PIN, spec 07 h3.15 fifth bullet, and the fallback battery must be re-verified together.
