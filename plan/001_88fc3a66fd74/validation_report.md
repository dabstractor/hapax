# hapax — Comprehensive Validation Report

**Date:** 2026-09-07 · **Validator scope:** PRD (hapax M1+M2) vs. repository at
`/home/dustin/projects/hapax` (HEAD `d21460a`, clean tree) · **Script:** `./validate.sh`

## Verdict

The codebase is in strong shape: strict typecheck clean, **520/521 tests green**
(1 pre-existing documented skip), benchmarks within the repo's own CI bounds,
dictionary build pipeline verified end-to-end, **live extension load under the
installed pi 0.85.1 verified with a real model turn** (exit 0, clean stderr,
vocabulary echoed back), zero persistence (static + live filesystem audit),
graceful degradation on a missing dictionary, and all PRD §09 user journeys
(items 1–7) pass when driven through the real modules at realistic interaction
pacing.

However, validation uncovered **3 major and 2 minor issues**, all in paths the
repo's own test/gate suite does not cover (default-config performance and
sub-100ms interaction timing). **Overall: ISSUES FOUND.**

---

## Issues

### Issue 1 — MAJOR: Over-cap word-store eviction is O(n log n) per upsert (13–19 s stalls)

`src/core/store.ts` → `CandidateStore.upsert()` calls `evictIfOverCap()` on
**every** upsert. Once `size > STORE_CAP (20,000)`, each over-cap insert runs a
full `entries()` snapshot + `evictionScore` over the whole store + an O(n log n)
sort to drop exactly **one** victim (`needed = size - STORE_CAP`). The PRD
(§06) prescribes "Evict in batches of 256 (sort snapshot, drop tail) to
amortize cost"; the implementation deliberately amortizes only victim
*selection*, not the *frequency* of the sort (its doc comment cites the §09
acceptance contract "insert 20,001 → exactly one eviction" as forbidding
batch-count eviction) — with the result that the intended amortization is
entirely lost.

**Measured (validate.sh Phase 6, probe B):** ingesting a single ~290 KB
message containing 25k distinct words (5k over cap) takes **12.97 s**
(19.2 s at 30k words in exploratory runs) vs. the PRD §02 budget of
"< 5 ms per typical message" and §05 "< 100 ms for a 300k-token session".
The whole eviction burst runs synchronously inside one ≤64 KB slice between
yields, so the event loop is blocked — directly at odds with §05's "a
pathological multi-MB message must never block a keystroke".

**Likelihood is real, not pathological:** the PRD itself estimates "typical
vocabulary sizes (~10–20k uniques per 300k tokens)" — the top of that range
crosses the cap — and the shipped **PROVISIONAL** dictionary's ≥220
"very common" reject band is effectively unpopulated (documented in
`test/fixtures/sessions/RESULTS.md`), so nearly every 4+-char word admits,
pushing real sessions toward the cap faster than a corpus-derived dictionary
would.

**Suggested fix direction:** trigger eviction when overflow reaches a batch
threshold (e.g. evict `EVICT_BATCH` victims whenever `size ≥ STORE_CAP +
EVICT_BATCH`, or keep a dirty-overflow counter and evict once per drain),
preserving the acceptance contract's post-eviction size bound.

### Issue 2 — MAJOR: Phrase layer (default `enablePhrases: true`) is 20× over restore budget; CI perf gates never measure it

Same non-amortized eviction pattern in `#evictPhrasesIfOverCap`, run per
message via `recordPhraseLines`. Any long session saturates the 10,000-phrase
cap (the repo's own `large-100k.jsonl` fixture records exactly 10,000), after
which **every** message drain pays a full 10k-entry snapshot + score + sort to
drop ~1 phrase.

**Measured (validate.sh Phase 6, probe A):** replaying the repo's own
1561-message `large-100k.jsonl` fixture through the production wiring
(`onAdmittedTokens` + `onSweepPhrases`, i.e. the default config) takes
**2,152–2,191 ms**, vs. **108 ms** with the identical pipeline phrase-less —
a 20× regression, 7× over even the PRD's 3× CI-variance bound (300 ms), and
~40× the PRD §05 hard budget (30–50 ms; <100 ms). Worst-case saturation probe
(14k overflow phrases, all-distinct lines): **36 s**.

**Gate blind spot:** `test/perf-gates.test.ts` (line 140) and
`test/bench/core.bench.ts` (line 50) construct `IngestPipeline` **without**
the phrase hooks, so every CI run measures a non-default configuration and
cannot catch this. `test/perf-gates.test.ts` passed 4/4 while the
default-config restore ran 20× over budget.

**Suggested fix direction:** same batch amortization as Issue 1 for the phrase
map, plus add a default-config (phrases-on) variant of gate c / the restore
gate to the perf suite.

### Issue 3 — MAJOR: Rapid Tab-Tab within the 100 ms display-debounce window corrupts the input buffer

`src/pi/provider.ts` → `createDisplayProvider` rule 4c: when a new qualifying
result set arrives <100 ms after the last paint, it returns the **currently
displayed set** — including its **old `prefix`** — and schedules a swap. After
a Tab acceptance, pi re-queries at the post-accept cursor; if that query lands
inside the suppression window (it always does for a fast second Tab — the
chain feature's exact usage pattern is Tab-Tab-Tab), the returned set is stale
and its prefix no longer matches the buffer.

**Measured (validate.sh Phase 6, probe C; deterministic):** buffer
`discuss National`, menu returns `prefix="natio", items=[National]`. Accepting
that stale item (Tab 2) makes pi's `applyCompletion` replace the 5 chars
before the cursor — `"ional"` — with `"National"`, producing
**`discuss NatNational`** (deleting text the user had already accepted), after
which the next query delegates and the chain stalls.

This is beyond the PRD §01's accepted cosmetic limitation ("Tab may insert a
top item the debounced popup hasn't painted yet" — live ahead of paint): here
the *painted* set is behind live **and carries a prefix that does not match
the buffer**, so acceptance destroys text. With ≥110 ms between Tabs the
chain works perfectly (verified in Phase 5, journey 2).

**Suggested fix direction:** in rule 4c, if the new result's `prefix` differs
from `displayedPrefix`, paint immediately instead of suppressing (a menu whose
replacement anchor no longer matches the buffer must never be re-served), or
return the fresh set whenever `applyCompletion` was called since the last
paint.

### Issue 4 — MINOR: README overstates the chained-completion arming path (phrase suppression shadows it)

README "Usage" and "Features" present `type natio → menu offers National →
Tab … → renewable → …` as the normal user path. In practice, from the first
line that contains the phrase (fast-path admission at first sight, all-rare
constituents), `rankMatches("natio")` returns only the phrases
(`National Renewable Energy`, `National Renewable`) — the bare word is
suppressed per PRD §06 (phrase salience = 1.2 × Σ constituents always
outranks the prefix word), and phrases never arm the chain. The zero-typing
chain is therefore reachable **only in the pre-phrase-admission window**
(before any single line contains the n-gram) — which is exactly how the
repo's own item-7 acceptance test stages it (phase-split replay, hand-fed
`{ value: "National" }` item), and the interaction is documented only in a
test comment ("suppression shadows the bare word"). The behavior itself is
spec-compliant (and arguably better UX — one Tab inserts the whole phrase);
the documentation presents the narrow-window flow as the general case.
Suggest a README caveat noting that once a phrase is admitted, the phrase
completes instead and chain-arming applies to words not heading an admitted
phrase.

### Issue 5 — MINOR: `.gitignore` typo glues two patterns

Line `.DS_Store*.log` is `.DS_Store` and `*.log` fused without a newline;
the intended `.DS_Store` pattern never applies (a later standalone `*.log`
line masks half of the damage). Cosmetic; no functional consequence today.

---

## What was validated and PASSED

| Phase | Check | Result |
|---|---|---|
| 1 | `tsc --noEmit` (strict; the repo's sanctioned `pi --check` equivalent) | ✔ clean |
| 2 | `npm test` — 28 files, 520 passed / 1 skipped (incl. repo acceptance, perf-gate, no-persistence suites) | ✔ green |
| 3 | `npm run bench` — gate a p99 0.06 ms (<1 ms), gate b 1.8 ms (<60 ms), gate c 123 ms, gate d 11.8 ms | ✔ within repo CI bounds |
| 4 | `tools/build-dict.mjs` TSV → packed binary → self-verify (10/10) → `loadDictionary` round trip (`apple`→255, absent→null) | ✔ |
| 5 | Journey 1: threshold matching + PRD §06 phrase suppression of prefix words | ✔ |
| 5 | Journey 2: Tab arms chain; zero-typing successor completion (110 ms pacing) | ✔ |
| 5 | Journey 3: `sk-`, `ghp_`, `eyJ…`, long-hex, low-entropy, consonant-run secrets never suggested; legitimate rare words still are | ✔ |
| 5 | Journey 4: never-hijack delegation — prose, quoted paths, 1-char fragments, aborted signals all delegate untouched; `ze`/`#l` open hapax menus without delegating | ✔ |
| 5 | Journey 5: word-only 100k-token restore 108 ms (<300 ms CI bound); store bounded (628 ≤ 20k); completions live after replay | ✔ |
| 7 | Live `pi -p -e` under installed pi **0.85.1** (types pinned ~0.84.4): exit 0, 0-byte stderr, model turn echoes session vocabulary | ✔ |
| 7 | `HAPAX_DICT=/nonexistent` → graceful disable, pi fully functional (exit 0) | ✔ |
| 8 | Static: zero fs-write calls in `src/`; live: no hapax-originated files under `~/.pi/agent` or the repo tree during real runs | ✔ |

Additional consistency checks performed manually: `plan/…/tasks.json` — all
70 nodes Complete (matches shipped M1+M2 state); README dictionary claims
(50,927 entries, ~1.2 MB, version 1) verified against the artifact; git tree
clean, dict committed, `.pi` manifest intact.

## Notes (no action required)

- **Version drift:** the installed runtime pi is 0.85.1 while devDependencies
  pin `~0.84.4`. The live run above proves the extension still loads and works
  under 0.85.1; consider bumping the pin when convenient.
- **Heap gate d** measures ~9–12 MB vs the 6 MB budget — already recorded in
  `docs/M1-DoD.md` as within the PRD's 3× CI-variance rule (vitest worker
  overhead included).
- **One pre-existing test skip** (`dictionary.test.ts`, gc-dependent) —
  documented inline, not part of the DoD contract.
- The transient `no-persistence` failure seen in one intermediate run was
  caused by this validator editing `validate.sh` seconds before the suite
  (the test's 5 s backdated write-detection window correctly flagged it);
  re-runs with a quiet tree are green. Not a project issue.

## Reproduction

```bash
./validate.sh          # exits 1 (issues found); all failures are in Phase 6
```

Issue-specific minimal repros are embedded in validate.sh Phase 6 (probes A,
B, C) and print their measured numbers on every run.