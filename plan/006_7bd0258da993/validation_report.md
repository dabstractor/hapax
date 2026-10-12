# hapax — Comprehensive Validation Report

**Date:** 2026-10-11 (repo HEAD `727b619`)
**Scope:** Full codebase validation per PRD (spec/01–09), including type checking,
the complete unit/adversarial/perf-gate suite, dictionary build determinism,
calibration probes, benchmarks, and live TTY end-to-end verification of the
README's documented user journey against a real `pi` instance (spec 09's binding
technique: tmux + `send-keys` one char at a time + `capture-pane`).

---

## Validation Script

`./validate.sh` (16 checks, 6 phases). Full run at validation time:
**16 passed / 0 failed — ALL GREEN.**

| Phase | What | Result |
|---|---|---|
| 1. Type checking | `npm run check` (tsc --noEmit, strict) | PASS — clean |
| 2. Unit + adversarial + perf gates | `npx vitest --run` | PASS — 40 files, **1286 passed / 1 skipped / 0 failed** |
| 3. Dictionary artifact | size, self-verify, deterministic rebuild | PASS — 850,554 bytes (spec 03 exact), 48,802 entries, rebuild **byte-identical** |
| 4. Calibration probe | spec 04 admission verdicts | PASS — `the`/`context`/`provider` reject; `node`/`spec` admit g1 (R=30 flip); `uploads` rejects (conjugation guard); Cap column shows the 95-band |
| 5. Benchmarks | `npm run bench` | PASS — gate a 0.45 ms p99 (<1 ms), t0 0.68 ms (<3 ms), b 2.5 ms (<60 ms), c 106 ms (<180 ms CI), d heap within bound |
| 6. Live TTY E2E | real `pi --no-session -e <repo>` in tmux | PASS — 6/6 checks (details below) |

### Live E2E (real user journey, README "Usage")

Seeded a session with `Zendesk lwlock quokkaflux integration check`, then
verified on the live rendering surface:

- **`ze` → menu offers `Zendesk`** (`→ Zendesk  session x1` on the fallback
  vertical menu — display path correct: no editor factory is exposed to
  extensions in this stack, so the fallback path is the correct primary).
- **Tab inserted `Zendesk` (cased) into the input** — spec 07 case handling
  verified live: the capitalized form completed from a lowercase fragment.
- **`#l` → menu offers `lwlock`** — trigger-char mode verified live.
- **Prose `th` shows no hapax menu rows** — never-hijack/common-words probe,
  with a sanity assertion that `th` actually reached the input line (INSERT
  mode), so the pass is not vacuous.
- **No persistence:** the live session did not write the debug store dump
  (mtime-compared; RAM-only invariant holds at runtime).

---

## Issue Tracker

All findings are **minor** — no critical or major defects. The entire shipped
surface (code, tests, artifact, tooling, live behavior) is green and consistent;
the issues are documentation/spec-consistency drift, stale process artifacts,
and one test-hygiene item.

### Issue 1 — Spec drift: `spec/08` schema example shows `rejectCommonness: 12` (shipped default is 30)
**Severity: minor (spec/code consistency; binding policy)**
`spec/08-configuration.md:39` — the JSONC schema example reads
`"rejectCommonness": 12`, but the shipped floor is
`REJECT_COMMON_THRESHOLD = 30` (`src/core/score.ts:109`, the 2026-10
width-bound retune documented in spec/04 and imported as the config default).
Spec 08's own prose ("Default: the baked constant in src/core/score.ts") and
spec/04 (floor 30, calibration history 12 → 30) contradict the example value.
The repo's binding spec-maintenance policy requires spec/code agreement; the
example value is stale.

### Issue 2 — Spec contradiction: `spec/09` ranking bullet teaches the retired count-before-length order
**Severity: minor (spec internal consistency)**
`spec/09-testing-and-acceptance.md:78-82` — the query.test.ts bullet lists
"sessionCount descending within a tier …; shorter key, then byte-lex, as final
ties" (tier → **count** → length → lex). The governing order in spec/04
("Query ranking", 2026-10 progressive completion) is tier → **shorter key** →
sessionCount → lex — length outranks frequency. A reader implementing tests
from the 09 bullet would pin the wrong ranking. (The shipped code and tests are
correct per 04.)

### Issue 3 — Spec contradiction: `spec/09` suppression-lapse bullet still names "Tab-accept" in the seam and cites the retired guard
**Severity: minor (spec internal consistency)**
`spec/09-testing-and-acceptance.md:161` — "(Escape / boundary / Tab-accept /
Enter-submit)" lists Tab-accept as a suppression-seam dismissal and the bullet
references the retired "immediate post-Tab re-offer guard". Spec/07 h3.11
(2026-10) retired Tab-accept from the seam ("Tab-accept arms NO suppression";
post-Tab extension offer instead), and spec/09's own later bullet (line ~213)
states the new rule — the file contradicts itself. 07 governs; 09's bullet
needs reconciliation.

### Issue 4 — README gap: no post-Tab extension-offer feature blurb
**Severity: minor (docs completeness)**
The post-Tab extension offer (spec 07 h3.11; implemented and tested —
`src/pi/widget.ts` tab-insert path, battery at `test/widget.test.ts:2544+`)
has no README coverage: no "Features" bullet and no Usage mention of the
Tab-Tab ladder (`implem` → `implement` → `implementation`), the empty-offer
backspace recovery, or Enter-still-submits-after-Tab. All other new behaviors
(capitalized-series completion, branch hygiene, Tab deferral to pi's open
menu) have blurbs. This is the outstanding scope of task P3.M1.T2.S1
("README sweep … plus the post-Tab extension offer"), whose other items
(config-table defaults 30/20, relief-blurb rewrite, series/branch/deferral
blurbs) are done.

### Issue 5 — Missing DoD entry: `docs/M1-DoD.md` lacks the current changeset's gauntlet section
**Severity: minor (process; binding per spec 09)**
The last DoD gauntlet entry is arrow-model-v2 (~line 1267+). The current
changeset (capitalized-series completion, branch-hygiene `session_tree`
rebuild, post-Tab extension offer, Tab deferral — plan/006 phases P1/P2/P4/P3)
has no dated gauntlet/live-smoke/drift entry, and its binding live
verification (spec 09 / P3.M1.T2.S3's four scenarios: series walk live,
`/tree` branch hygiene with the misspelling scenario, Tab-deferral
hesitation-race variant, post-Tab ladder live) has not been executed or
recorded. Task P3.M1.T2.S4 (DoD append + drift report) is outstanding. This
validation's live smoke covered the item-1 happy path only, not those four
scenarios.

### Issue 6 — Stale task tracker: `plan/006_7bd0258da993/tasks.json` marks shipped, tested work as "Ready"
**Severity: minor (process/bookkeeping)**
- `P1.M2.T2.S2` ("Widget path: series-first zero-char offers + close-on-space
  typed arming") — marked **Ready** but implemented
  (`src/pi/widget.ts:665-683` series display/insert via `nextDisplay`;
  combined series-first composition ~`:892`) and tested
  (`test/widget.test.ts:2408+` "widget typed-word arming + series-first
  offers").
- `P4.M1.T1.S2` (post-Tab ladder battery) — marked **Ready** but present
  (`test/widget.test.ts:2544+` "Post-Tab extension offer battery …
  P4.M1.T1.S2").
Risk: an orchestrator reading tasks.json would re-run completed work or
double-book plan slots (recent commits show active slot reshuffling in plan/).
In the other direction, P3.M1.T2.S1's "Ready" is accurate only in part (see
Issue 4).

### Issue 7 — README "Checks" perf table lists the retired 60 ms ingest headline
**Severity: minor (docs accuracy)**
The README Checks section's gate table row reads "Ingest of 800 KB session
text | < 60 ms". Spec/09 explicitly records that the < 60 ms headline was
never met by the shipped implementation and sets the operative CI bound at
180 ms ("Do not re-tighten this row to 60 ms…"). Measured here: ~106–115 ms —
passes only under the 180 ms bound, so the README row misdescribes the gate
anyone re-running it will experience.

### Issue 8 — Test hygiene: `test/debug.test.ts` writes the fixed global path `/tmp/hapax-store.txt` and leaves it behind
**Severity: minor (test hygiene)**
The debug suite exercises the sanctioned `/acwords` full-store dump
(`src/pi/debug.ts:228` `writeFileSync("/tmp/hapax-store.txt", …)`) against the
real fixed path — after `npm test`, a leftover file persists in `/tmp`
(observed: a 1-byte file from the empty-store case). Not a product invariant
violation (the dump is the spec-08 sanctioned debug exception, and the live
session with `debug: false` writes nothing — verified via mtime comparison),
but a fixed /tmp path from unit tests can collide across concurrent runs or
workspaces and misleads after-the-fact persistence checks (it misled this
validation's first pass until mtime-compared). A per-run temp dir (or
cleanup) would fix it.

---

## Environmental observations (not counted as issues)

- **pi's MCP servers fail to connect in this environment** (`web_search`,
  `zread` JSON-RPC handshake errors at startup). This comes from the user's
  global pi MCP config, not hapax; it pollutes startup pane captures during
  live verification.
- **1 skipped test** (`test/dictionary.test.ts:264`) is GC-gated by design
  (`--expose-gc` optional smoke); documented in the suite.
- **Working tree** has staged `plan/` modifications (owner's in-flight plan
  reshuffling). No hapax source modifications were pending.
- pi's built-in editor exposes no editor factory to extensions, so the live
  run exercised the **fallback display path** (vertical menu); the widget
  primary path is covered by the unit suite (widget tests, defer-pi-menu
  repro with the real pi-tui Editor) and prior live verification per the DoD.

## What was verified green (no action needed)

- Typecheck strict-clean; **1286/1287 tests pass** (40 files), including the
  adversarial suites, branch-purity, mask-secrets, defer-pi-menu, perf gates
  (a/a2/a3/t0/b/c/d/e/f all within CI bounds).
- Dictionary artifact exactly matches spec 03 (850,554 B, 48,802 entries,
  65,536 buckets); `tools/build-dict.mjs` is deterministic (byte-identical
  rebuild) and self-verifying; `tools/calibrate-bands.mjs` verdicts match
  spec 04's documented behaviors (R=30 floor, 95 mid-cap band, conjugation
  guard).
- All baked constants match spec 04/08 (REJECT 30, MID_CAP 95, TOP_BAND
  ceiling 135, relief ceiling 30 retired-in-place, STORE_CAP 20k, BIGRAM_CAP
  10k, fuzz 60/45, maxSuggestions 20, threshold 2 inert).
- Live E2E user journey (seed → `ze`→Zendesk → Tab cased insert → `#l`→lwlock
  → prose no-menu → no persistence) passes on a real TTY.

## Verdict

**8 minor issues** (spec-consistency drift ×3, README/docs gaps ×2, stale task
tracker ×1, stale perf-headline ×1, test hygiene ×1). No critical or major
defects; the shipped code, tests, artifact, and live behavior are fully green.
The fixer's highest-value actions are the three spec reconciliations (Issues
1–3, interactive-session spec edits per the binding maintenance policy) and
the README post-Tab blurb (Issue 4); Issues 5–6 are process artifacts the
owner's own pipeline (P3.M1.T2.S3/S4) is chartered to complete.
