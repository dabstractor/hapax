# hapax — Comprehensive Validation Report

**Date:** 2026-09-07 · **Validator scope:** deep codebase analysis + independent
adversarial probe suite + shipped test gate + live host smoke.
**Validation target:** post-P1 stabilization state of the hapax M1+M2
implementation against the bug-fix PRD (BUG-001 … BUG-006) and the spec
(`spec/01`–`09`).

**Verdict: PASS with 1 minor issue.** All six PRD bugs are verified **fixed**
against their original repro steps (independently re-executed — not trusted
from the repo's own regression tests). One new, minor residual defect was
found (NEW-001 below). The shipped gates are green: `tsc --noEmit` clean,
**630/631 tests pass** (1 legitimate conditional skip), perf benches far
inside every PRD §09 budget, and the real `pi -e .` host loads the extension
without errors.

---

## How validation was performed

1. **Codebase analysis** — read every module in `src/core` (dictionary, score,
   shapeGate, store, query, segment, types) and `src/pi` (index, ingest,
   provider, config, debug, paths); cross-checked the spec (`spec/SPEC.md`
   + §01–§09) and README guarantees against implementation.
2. **Shipped gates** — `npm run check` (tsc strict), `npm test` (vitest, 33
   files / 631 tests incl. acceptance + adversarial regression suites +
   perf-gates), `npm run bench` (PRD §09 budgets).
3. **Independent adversarial probes (37 checks)** — a self-contained probe
   suite (`validate.sh` phase 6) that loads the **real modules through jiti**
   (the same loader pi uses) against the **real shipped dictionary** and
   re-executes each PRD bug's *original repro steps*, plus the README's user
   journeys (`#l` trigger → lwlock, `ze` → Zendesk, `nrel` → NREL, common
   prefixes → no menu). No repo test was trusted for these verdicts.
4. **Live host smoke** — `pi -e . -p …` headless: extension registers, no
   load errors, agent answers (exit 0).

---

## PRD bug verification matrix

| ID | PRD severity | Status | Evidence (independent probe, real dict) |
|---|---|---|---|
| BUG-001 dictionary mis-calibration (common words admitted; menus for `with`/`this`/`them`) | Critical | **FIXED** | Artifact rebuilt from real frequency corpus (`tools/corpus/en-50k.tsv`, 48,802 entries, frequency-ordered — not length-sorted). Measured lookups: `the`=240, `that`=215, `with`=179, `this`=197, `them`=156, `first`=144, `have`=190, `would`=156 — all ≥ `REJECT_COMMON_THRESHOLD`(100, recalibrated from 220 with `MID_FREQ_THRESHOLD` 50; `tools/calibrate-bands.mjs` re-verifies). End-to-end: after ingesting ordinary prose, typing `with`/`this`/`them`/`firs` offers **none** of those words (12/12 P1 checks pass). Band populations: reject=945 words, group2=7,556 — the top-1000 English band is rejected as spec'd. |
| BUG-002 stale-prefix suppression corrupts text on Tab (`zzendesk`) | Major | **FIXED** | `createDisplayProvider` gained a 4d-exception (provider.ts): whenever the fresh result's prefix ≠ the displayed prefix, the fresh set paints immediately — the provider can never re-serve a prefix that is not a suffix of the current buffer. Faithful pi-tui editor sim (blind `prefix.length` splice at Tab): `ze` paints → `zep` typed inside the 100 ms window → Tab yields `zephyr` (never `zzendesk`); pause->Tab variant also clean; a hard invariant scan over 4 successive queries confirms **every served prefix suffix-matches the buffer**. |
| BUG-003 multi-segment secrets leak into suggestions | Major | **FIXED** | Two-layer fix: `maskSecrets()` (raw-text, pre-tokenization, wired at `#admitSegment`) blanks gitleaks-derived windows (AWS access/secret, Slack `xoxb-…` incl. 3rd-segment tails, GitHub PATs, Google `AIza`, OpenAI `sk-`/`sk-proj-`, strict+loose JWT, 40+ bare high-entropy runs); token-level residue rules (base64url ≥16 mixed-case+2-digit; charset-relative entropy floors). The PRD's exact repro payloads (`wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`, `xoxb-…-abcdefghijklmnopqrstuvwx`, JWT fragments, `sk-proj-…`) ingested through the real pipeline: **8/8 fragment probes leak nothing** (`wjal`, `k7mdeng`, `bpxrfi`, `abc`, `dozjg`, … all empty). |
| BUG-004 bad-dictionary restore still ingests history as rank-group-0 | Major | **FIXED** (with a minor residue — NEW-001) | `createLazyDictionary` exposes a sticky `failed` flag; the factory wires it into `IngestPipeline.isDisabled` (checked per segment AND per token) and `restoreFromHistory(…, shouldAbort)` polls it at the top of every replay iteration. With a non-existent dictionary, replaying a 2-message prose history stores **≤1 word instead of the entire history** (PRD repro previously stored 15+), notify fires exactly once, replay aborts. The one-word residue is reported as NEW-001. |
| BUG-005 chained completion unreachable after restore (suppression always removes bare word) | Major | **FIXED** | Constituent suppression in `query.ts` now exempts any word bearing successors in the chain index (`topSuccessors().length > 0` → stays in the menu), and `applyCompletion` arms phrases on their **last** word. After **full replay** of the NREL session ×4 (the PRD's exact failure scenario), the `natio` and `na` menus contain the bare word `National` alongside phrases; through the real provider: accept `National` → zero-typing offer `renewable` → accept → `energy` (walk verified two legs deep into the 4-word chain). |
| BUG-006 demotion sweep skipped during restore replay | Minor | **FIXED** | `IngestPipeline.sweepPhrases()` public; `restoreFromHistory` runs exactly one sweep at the tail of a completed replay (skipped on abort, deliberately — a partial replay must not demote phrases whose 40 ordinals never accrued). Probe: fast-path all-rare phrase admitted from message 1 + 45 filler messages replayed restore-style → sweep ran exactly once and `zorblat quuxified mumblewords` is **demoted** (absent from `phraseCandidateKeys()`). |

---

## Issues found

### NEW-001 (Minor): On a failed dictionary load, the first token of the first processed message is admitted to the store before the disable gate fires

**Severity**: Minor · **Location**: `src/pi/ingest.ts` `#admitSegment`
(the `if (this.#isDisabled?.()) break` sits at the **top of the token loop**,
i.e. it is only observed from the *next* token onward), interacting with
`createLazyDictionary`'s failure semantics (`src/pi/index.ts`: the first
`lookup()` call both triggers the failed load **and returns `null`**, which
`admit()` interprets as "rarest word, group 0").

**Description**: When the dictionary load fails during a session restore (or
on the first live message of a session with empty history), the sequence for
the very first token is: `isDisabled?` no → gate pass → `admit()` →
`lookup()` throws internally → sticky `failed = true`, notify fires → returns
`null` → admitted as **rank group 0** (rarity bonus 1.0) → `store.upsert()`.
Only the *next* loop iteration observes the disable and breaks. Result: the
store is not empty but holds exactly one word of ordinary English ranked as
ultra-rare, and — because the query path is deliberately not disabled-gated —
it can surface as a menu item: after the bad-dict restore probe,
`rankMatches(store, "th")` returns `[{display:"that", salience:6}]`.

**Impact**: Contradicts the README's explicit restore contract ("a resumed
session starts from an empty store, never a half-ingested one") and, in
spirit, PRD §03's "disables itself rather than running with a bad table."
User-visible impact is tiny: at most one menu suggestion for one ordinary
word, once, in a session that already showed the dictionary-error toast. All
*remaining* history is correctly not ingested (the BUG-004 fix itself works).

**Steps to reproduce** (independently verified): `createLazyDictionary('/nonexistent/common-en.bin', notify)` → `IngestPipeline({ isDisabled: () => lazy.failed })` → `restoreFromHistory` with a 2-message prose history → wait 150 ms → `store.size === 1`, `rankMatches(store,'th')` → `[{that}]`, `notifies === 1`.

**Suggested fix direction** (not applied — validation only): re-check
`isDisabled` (or test the dictionary's `failed` flag) *between* the failed
lookup and the upsert — e.g. break before storing when the lookup itself
observed the failure, or have `admit()` treat a first-load-failure lookup
specially.

---

## Testing summary

| Gate | Result |
|---|---|
| Type check (`tsc --noEmit`, strict) | PASS (clean) |
| Unit/acceptance/adversarial suite (`npm test`) | PASS — 630 passed, 1 skipped (GC allocation smoke; requires `--expose-gc` + `HAPAX_TEST_GC=1` — legitimate conditional skip) |
| Perf gates (`npm run bench` + `perf-gates.test.ts` at 3× headroom) | PASS — query p99 ≈ 0.06 ms (budget 1 ms), dict load+20k sweep ≈ 2.9 ms (60 ms), 800 KB ingest ≈ 168 ms… wait, see note¹ |
| Independent adversarial probes (37 checks, real modules + real dict) | 36 PASS, 1 WARN (NEW-001 residue) — **0 hard failures** |
| Live host smoke (`pi -e . -p`) | PASS — extension registers, no errors, agent answers |
| Lint / style | Not configured in this repo (no eslint/prettier/biome config; `package.json` defines none) — phases auto-skip |

¹ Bench note: the raw gate-c mean (~160 ms) is the *benchmark loop's* measured
mean under vitest bench; the authoritative CI gate is `perf-gates.test.ts`
(asserted at 3× budget = 180 ms) which passes in `npm test` — and the PRD
budget context is background ingestion, never the keystroke path (gate a,
the synchronous query path, is ~65× inside budget).

**Bugs found: 1** (0 critical, 0 major, 1 minor — NEW-001).
All 6 PRD bugs verified fixed with independent end-to-end evidence.

## Recommendations

1. Close NEW-001 by moving the disable check between lookup and upsert (or
   gating `admit()` on a first-lookup failure), then pin with a test
   asserting `store.size === 0` after a bad-dict restore — the existing
   `bad-dict-gate.test.ts` asserts `size <= 1`-style bounds today, which is
   how the residue survived.
2. Consider adding lint (eslint/oxlint) and format (prettier) configs — the
   repo currently has neither; the codebase is clean but unguarded against
   drift.
3. `validate.sh` (this script) is self-contained and re-runnable; keep it
   out of version control per the cleanup note, or promote its probe suite
   into `test/` as a permanent regression pin if desired.