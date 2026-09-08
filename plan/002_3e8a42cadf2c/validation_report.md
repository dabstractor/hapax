# hapax — Comprehensive Validation Report

**Date:** 2026-09-08 · **Repo:** `/home/dustin/projects/hapax` (HEAD `13af6fd`, clean tree)
**Scope:** PRD `hapax — Context-Driven Autocomplete Extension` (M1+M2 spec, spec/01–09) vs. implementation.
**Method:** full test suite + type check + benchmarks, dictionary artifact integrity rebuild, contract verification against the installed `@earendil-works/pi-coding-agent` / `pi-tui` 0.84.4 `.d.ts`/`editor.js`, and independent end-to-end probes driving the **real extension factory** (`src/pi/index.ts`), real ingest pipeline, real shipped dictionary, and real provider layers through the PRD §09 / README user journeys (61 assertions — see `validate.sh` phase 6).

---

## Verdict

The codebase is in strong shape: strict `tsc` clean, **636/637 tests green** (1 pre-existing gc-dependent skip), three of four PRD §09 performance gates pass with wide margins, the shipped dictionary reproduces **byte-identically** from the vendored corpus, secrets never surface, delegation/no-hijack mechanics are correct, and the M2 chain machine works end to end including zero-typed-char successor offers and `before_agent_start` resets. Four issues were found (1 major, 3 minor): a calibration/guarantee gap, a casing deviation on chain insertions, a stale evidence record, and a performance-budget shortfall — none are logic crashes.

## Issues

### Issue 1 (Major) — PRD-designated reject-band word "context" is admitted by the shipped dictionary; ordinary prose opens completion menus

**Where:** `dict/common-en.bin` + `src/core/score.ts` bands (`REJECT_COMMON_THRESHOLD = 100`, `MID_FREQ_THRESHOLD = 50`) + `tools/corpus/en-50k.tsv` (OpenSubtitles dialogue register).

**Spec says:**
- PRD §04 admission table: `q >= 220` → *Reject — very common word (`the`, `context`)*. `context` is one of the PRD's two named reject examples.
- PRD §07 never-hijack rules: *"The user can type an entire session and never trigger a menu for common words: `the`, `context` are rank-rejected."*
- README "Design invariants" #1: *"ordinary prose never opens a menu — the calibrated bands reject the top ~945 English words … This is guaranteed, not best-effort."*

**Measured (reproducible):**
- `dict.lookup("context")` → **51** → group 2 (mid-frequency, admitted). `tools/calibrate-bands.mjs`: reject band = top **945** words; group 2 = **7,556** words in `[50,100)`.
- E2E probe (validate.sh phase 6, journey 3): after ingesting one ordinary English prose paragraph, 5 of 19 two-char probes open a hapax menu — `co` → `Context(q=51)`, `code(q=91)`, `common(q=91)`; `da` → `data(q=82)`; `ju` → `jumps(q=51)`; `la` → `lazy(q=67)`; `or` → `ordinary(q=79)`.
- The corpus register (dialogue) demotes everyday prose words below the reject band; with a PRD-conforming corpus (web/books + tokenizer cross-check, PRD §03) `context` would sit in the reject band and the guarantee would hold.

**Impact:** typing itself is never hijacked (menu is take-it-or-leave; keystrokes land verbatim — verified), but the documented "ordinary prose never opens a menu" guarantee and the PRD's named acceptance example do not hold with the shipped artifact. The repo's own tests consciously pin mid-band words opening menus (`test/adversarial-typing.test.ts` Probe A: "mid-band words LEGITIMATELY open menus"), so the code and the docs/spec disagree — either the bands/corpus need recalibration (reject ≈ top ~8.5k ranks for this corpus) or the invariant/acceptance wording needs re-anchoring to "top ~945 words only".

**Repro:** `node tools/calibrate-bands.mjs` (band populations) · phase 6 of `./validate.sh` prints the five NOTE lines.

### Issue 2 (Minor) — Chained (successor) completions insert lowercase words, violating the case-preserving insertion rule

**Where:** `src/core/store.ts` (`recordBigramRuns` stores lowercase bigram keys; `Successor.next` is the lowercase key) → `src/pi/provider.ts` `publishChain` (`value: s.next`).

**Spec says:** PRD §07 menu item shape: *"`value` = the string to insert — always exactly one word (**candidate display casing**)"*; PRD §04 case handling: *"Insertion uses the candidate's display casing (`NREL`)"*.

**Measured:** accept `National` → Tab → the zero-char chain offer's value is `renewable`, not `Renewable`; PRD §09 integration item 7's expected walk *"National → Renewable → Energy → Laboratory"* actually inserts `National renewable energy laboratory`. (The README usage section itself displays the lowercase walk, so the behavior is known — but it deviates from the PRD's case-handling invariant. The successor index would need to carry the display casing of `next` to fix it.)

**Repro:** validate.sh phase 6, journey 1 NOTE line.

### Issue 3 (Minor) — Stale acceptance evidence in `test/fixtures/sessions/RESULTS.md` (item 7) references removed phrase-era machinery

**Where:** `test/fixtures/sessions/RESULTS.md`, "Item 7" section.

**Details:** the section documents `"216 stored phrases"`, `test/phrase-gating.test.ts` (file no longer exists — the successor suite is `test/chaining-gating.test.ts`), a one-shot "pending offer" mechanism, and "PRD §06 h3.8 constituent suppression" — all from the **removed** phrase design (current spec: "no phrase admission/sticky/demotion lifecycle … those designs are removed"; PRD §06 successor-index design). The live implementation is the armed-branch chain machine (`src/pi/provider.ts`). An evidence record citing a non-existent test file and deleted semantics can mislead future regression sweeps and auditors. Item 7's PASS verdict is nonetheless substantiated by the current suites (`test/chain.test.ts`, `test/acceptance.test.ts`) and re-verified live by this validation.

---

### Issue 4 (Minor) — 800 KB session ingest runs ~3× the PRD's <60 ms budget; the CI bound was consciously relaxed to 210 ms (3.5×)

**Where:** `src/pi/ingest.ts` `processText` chunked pipeline · `test/perf-gates.test.ts` gate c.

**Spec says:** PRD §02 performance budgets ("hard requirements"): "Full 300k-token session restore < 100 ms total, chunked"; PRD §09 gate: "Ingest 800 KB synthetic session text < 60 ms, yields every ≤ 64 KB", with the CI rule "hard regressions (> 3× budget) fail".

**Measured:** the benchmark (validate.sh phase 4) reports 168–183 ms for the 800 KB synthetic ingest — ~3× the 60 ms budget and at/over the PRD's own 3× hard-failure line (180 ms). `test/perf-gates.test.ts` asserts `< 210 ms (3.5×)` with an inline comment documenting that "the healthy ingest baseline is ~174–187 ms — already ~3× budget BEFORE" the bigram work landed — i.e. the gate bound was moved to accommodate a baseline that never met the PRD number. Contributing factors include the mandatory inter-slice event-loop yields (setImmediate latency) and the multi-pass mask + tokenize + expand pipeline.

**Impact:** low — ingest is background-only (300 ms debounce, ≤64 KB slices, never on the keystroke path), so typing latency is unaffected; a 300k-token restore takes roughly ~0.7 s of spread-out background work rather than <100 ms. But the PRD's stated hard budget is not met, and the local CI gate was loosened past the PRD's own 3× rule; the budget should either be re-benchmarked/revisited in the PRD or the ingest hot path optimized (e.g. single-pass segmentation) before the numbers are cited as "passing".

**Repro:** `npx vitest bench --run` (gate c row) · `npx vitest --run test/perf-gates.test.ts`.

---

## Verified clean (summary of what passed)

**Phase 1 — Type check:** `npm run check` (tsc strict, NodeNext) — zero errors.

**Phase 3 — Unit/acceptance:** 33 files, 636 passed / 1 skipped (the documented gc-dependent `dictionary.test.ts` case). Includes the adversarial regression suites (typing-path corruption sims, realistic-key masking, bad-dict restore), `perf-gates` hard bounds, and no-persistence assertions.

**Phase 4 — PRD §09 perf gates (measured vs budget):** query p99 0.097 ms (<1 ms) PASS · dict load + 20k sweep p99 2.7 ms (<60 ms) PASS · steady-state heap cycle p99 19.2 ms (heap asserted in `test/perf-gates.test.ts`, <6 MB) PASS · 800 KB ingest ~183 ms — OVER budget, see Issue 4.

**Phase 5 — Dictionary artifact:** `tools/build-dict.mjs` rebuild from `tools/corpus/en-50k.tsv` is deterministic and **byte-identical** to shipped `dict/common-en.bin` (48,802 entries, ~0.9 MB, self-verification `48802/48802 OK`); `tools/calibrate-bands.mjs` re-verifies the constants.

**Phase 6 — E2E user journeys (real factory + shipped dict, 61 assertions):**
- *Jargon completion (item 1):* `ze` → top item `Zendesk` (prefix `ze`); `lw` → `lwlock`; `#z` trigger prefix `#z`; bare `#` lists top-salience candidates; trigger-regex pins (`foo #ze` matches, `foo#ze`/`foo ##ze` fall back to threshold fragment, bare `##` delegates).
- *Forced Tab contract (§07 h3.8):* `force:true` + live fragment returns **exactly one** item — verified against the installed pi-tui 0.84.4 `editor.js` single-item fast path (`options.force && options.explicitTab && items.length === 1`).
- *Chained completion (item 7):* accept `National` → zero-typed-char successor at prefix `""` → Tab walks the chain; one-word invariant on every item; `before_agent_start` resets to idle (delegates).
- *Secrets (item 5):* realistic AWS/GitHub/OpenAI/Slack/JWT/Google keys + 40-hex in a user prompt → zero key material reachable via any fragment probe or the bare-`#` top list; positive control present. Two-layer masking verified.
- *No-hijack (item 2, reject band):* all reject-band 2-char probes delegate with byte-identical args and empty live cache; path contexts delegate unchanged; aborted signals delegate; prose keystrokes unaffected.
- *Restore (item 3):* `session_start resume` replays history oldest→newest through the real pipeline (`zep` → `Zephyr`, `quux` → `quuxblat`); `thinking` blocks and `toolResult` never ingested; `toolCall` blocks skipped while assistant text is kept; user images ignored.
- *Config (§08):* layering (defaults → user → trusted project), clamping (9→3), repair with warnings (`"##"`, `"yes"`), deprecated `enablePhrases` alias mapping, malformed-file fallback, untrusted-project layer ignored.
- *Bigram adjacency (§06):* plain adjacency chains; comma, backticks, digit run, intervening stopword (`united states of america` → only `united→states`), and newline all break; a 64 KiB chunk boundary does **not** break same-line adjacency.
- *Segmentation (§04):* `草sword`, `Þórhildur`, `ΩbsidianMirror` emit nothing; `fix 方法 error` → `fix, error`; `state-of-the-art` → four tokens; `roun` → `Rounding` sub-word from `fixRoundingError`.
- *Chaining gate:* `enableChaining:false` keeps word completion, never arms, offers no successors.
- *Zero persistence (§01 invariant 4):* a full session lifecycle writes **no files anywhere** in the repo.

**Phase 7 — Hygiene:** working tree clean apart from the three validation deliverables; `.gitignore` untouched and contains no plan/PRD/task entries.

## Non-issue observations (documented/sanctioned deviations, not counted as issues)

- **Admission bands 100/50 vs PRD's literal 220/120** — sanctioned by PRD §09's tuning protocol; the BUG-001 recalibration is measured (`tools/calibrate-bands.mjs`), documented in README/score.ts, and pinned by tests. (Issue 1 is about the *consequence* for prose, not the constant change itself.)
- **Eviction drops a batch of 256 at cap overflow** vs PRD §09's "insert 20,001 → exactly one eviction" wording — PRD §06 itself prescribes batches of 256; implementation documents and tests pin the batch semantics; post-eviction size ≤ cap holds.
- **`notify` level `"warning"`** vs PRD §08's literal `"warn"` — pi 0.84.4's API levels are `"info" | "warning" | "error"`; implementation matches the real API.
- **`pi --check` does not exist** — the documented substitution (`npm run check`) is recorded in `docs/M1-DoD.md`.
- **Shape-gate consonant-run rule rejects some legitimate camelCase whole tokens** (e.g. `ZephyrBlaster` — `phyrbl` is a 6-consonant run) — faithful to PRD §04 rule 4 as written; sub-words (`Zephyr`, `Blaster`) still complete, so this is a spec-level limitation, not an implementation bug.
- **`>64`-char identifiers split at the regex cap** — documented "regex-as-spec" behavior in `segment.ts`.