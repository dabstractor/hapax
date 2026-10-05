# R5 Scout — Tests & Docs (tests, specs, README, DoD, dict, calibration)

Baseline: `6d8f158` ("feat(core): un-entered Escape forwards verbatim"). Tree clean except `plan/006_7bd0258da993/` (research artifacts).

## 1. The red battery: `test/defer-pi-menu.repro.test.ts` (207 lines, 4 cases)

**File header (lines 1–17), verbatim:**
> INVESTIGATION REPRO (not a regression suite yet): does the widget layer defer to pi's own autocomplete menu when it is open?
>
> Drives the REAL pi-tui Editor (the same class pi instantiates) as the widget factory's inner editor, with a provider that mimics pi's CombinedAutocompleteProvider semantics for the two surfaces classifyStockContext does NOT model:
> 1. Tab-forced file completion on a plain word (editor.js handleTabCompletion → forceFileAutocomplete → provider extractPathPrefix(force=true) answers the bare token).
> 2. Slash-command ARGUMENT completion after a space (isInSlashCommandContext allows spaces; provider answers via getArgumentCompletions).
>
> Real async timing: pi's requestAutocomplete → getSuggestions is a Promise; the menu opens only after it resolves.

**Harness / fakes (no test/helpers files used; everything is inline):**
- `fakeTui()` (line 25) — `{ requestRender: ()=>{}, terminal: {rows:40, columns:120} }`.
- `theme` (line 29) — `{ borderColor:"white", selectList:{selectedText: t=>t} }`.
- `makePiProvider()` (line 33) — pi-provider double: `getSuggestions` regex `^(?:\/[^\s/][^\s]* )?([^\s]*)$` answers bare tokens (forced-file) and `/cmd arg` tokens (argument mode); returns `{items:[{value,label}], prefix:token}` or `null` when empty. `applyCompletion` splices the value into the line and records `applied[]`. Answers `["templates/","terminal-bell/"]` for token `"te"`, `[]` otherwise.
- `build()` (line 88) — real `CandidateStore` seeded with sightings of `terminal/template/test`; `createWidgetEditorFactory` from `src/pi/widget.js` with `inner:` constructing a REAL `Editor` from `@earendil-works/pi-tui` wired with `setAutocompleteProvider(pi.provider)`; `config: {...DEFAULT_CONFIG, menuDelayMs: 0}`; `createChainMachine()` from `src/pi/provider.js`; `restoreReady: Promise.resolve()`; `onKeystroke: ()=>{}`. Observes widget state via `widgetStateOf(editor)` (`{hidden, items:[{display}]}`) and editor via casts `isShowingAutocomplete()`, `getText()`.
- `flush()` — 10 microtask turns to drain pi's async `requestAutocomplete` chain; `type()` drives `editor.handleInput(ch)` per char.
- `setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS))` at module top (line 22).

**The 3 failing cases** (all fail at `expect(pi.applied).toEqual(["templates/"])` with `Received: []` — the 2nd Tab never reaches pi's `applyCompletion`; hapax's widget layer consumes/steals it):

1. **"forced file menu (Tab on plain word) — pi's menu opens, then Tab inserts the PI item, not a hapax word"** (test 1). Types `"load the te"` (hapax line armed with dictionary words), 1st Tab (no pi menu open yet) → pi editor's `handleTabCompletion` → forced file menu opens over `"te"`; 2nd Tab must accept pi's highlighted item (`templates/`). Fix requirement: whenever `editor.isShowingAutocomplete()` is true, Tab (and all keys) must be forwarded to the inner pi editor, never consumed by the widget layer.
2. **"argument completion menu ('/model te') — pi menu auto-opens; Tab must accept pi's item"** (test 2). Types `"/model te"`; pi's argument-completion menu auto-opens (async); Tab must apply pi's item. `classifyStockContext` does not model the `"/cmd <space> arg"` surface, so the widget layer cannot tell this is a stock context synchronously — deferral must be driven by the pi menu's actual open state, not static classification.
3. **"async race: pi's Tab-forced menu opens while the widget line is closed (menuDelayMs hesitation), then re-opens armed and steals the NEXT Tab"** (test 3). `vi.useFakeTimers()`, `menuDelayMs: 400`. Types `"load the te"` fast — hesitation gate holds the hapax line hidden; 1st Tab is forwarded (hidden line) → pi's forced file menu opens; user pauses 500 ms (timers advanced) — during the pause the hapax hesitation window ELAPSES, the hapax line re-opens armed; 2nd Tab (meant to accept pi's item) is stolen by the re-armed hapax widget. Fix requirement: once pi's own menu is open (or opening), the widget line must stay suppressed/defer; the widget may not arm over an open pi menu.

4th case passes (contrast): **"pure slash typing ('/mo', no space)"** — the classified stock context defers today; text stays `/mo…`.

The header's own words — "not a regression suite yet" — plus the `console.log` scaffolding in every case means a fix should also harden this file into assertions (remove logging) or fold it into the widget battery.

## 2. Suite state (RUN at 02:18 + rerun)

- `npm test` (vitest --run, 39 files): **Tests 4 failed | 1128 passed | 1 skipped (1133 total)**; **Test Files 2 failed | 37 passed**. Duration 8.68 s (wall `real 0m8.954s`).
- **Baseline claim (3 failed / 1129 passed / 1 skipped) is WRONG on two counts:**
  - The 3 repro failures match, BUT a 4th test failed: `test/acceptance.test.ts > acceptance — real extension loads under pi -p -e (network-gated) > pi -p loads the real extension and answers cleanly` — `pi -p -e . --no-builtin-tools "say Zendesk lwlock"` exited 1 with stderr not matching the environmental-skip regex (ENOENT/network/401/quota/etc.), so the skip guard fell through and rethrew (test/acceptance.test.ts:645–658). This is an environment-sensitive failure (pi present at `~/.local/bin/pi`; likely auth/model error wording). R5's gauntlet must resolve or acknowledge it — it is NOT one of the 3 repro reds.
  - Passed count is 1128, not 1129 (arithmetic: 1133 total − 4 failed − 1 skipped).
- Skipped test: exactly 1 — the pre-existing gc-dependent case in `test/dictionary.test.ts` (per M1-DoD item 2 note; only runs under `node --expose-gc`).
- `npm run check` (`tsc --noEmit`, strict): exit 0, zero errors.
- `npx vitest --run test/defer-pi-menu.repro.test.ts` alone: 3 failed / 1 passed, 17 ms — confirms isolation; no cross-file interference.

## 3. spec/09-testing-and-acceptance.md — extracted requirements (line refs from the file as read)

**Unit battery bullets:**
- store.test.ts — "Branch purity (2026-10, spec 06): replaying a fixed message sequence twice yields identical stores; a store built incrementally (message_end sequence) equals the store rebuilt from a `getBranch()` snapshot of the same sequence — no dead-branch words survive, nothing double-counts." (also eviction batch-of-256, prefix-index rebuild-after-dirty, upsert merge incl. **casing tallies** semantics documented in spec/06 h"Upsert semantics").
- provider.test.ts — Branch rebuild (2026-10, spec 05): `session_tree` discards the pending ingest queue; `newLeafId === oldLeafId` skips; queries during replay wait behind the same bounded gate as resume. Startup gate battery (test/startup-gate.test.ts): bounded ≤ maxWaitMs, settled pass-through, rejected replay never wedges, onSettled fires exactly once. Chain one-shot grant battery (test/chain.test.ts). Tab-only-completes incl. **forced path**: `getSuggestions` with `force:true` + live fragment returns exactly one item (Tab-before-paint completes).
- widget.test.ts (M3 primary path) — visibility machine; suppression lapse; **Line claim**; Key handling (boundary pass-through, interaction carousel); insertion casing; **Branch rebind (2026-10, spec 05/07): `session_tree` releases a claimed row and re-binds the widget to the rebuilt store**.

**Integration acceptance item 9 — Branch hygiene (2026-10):** live owner scenario — submit a prompt containing a rare misspelled word (dictionary-absent — probe with `node tools/calibrate-bands.mjs <word>`), Ctrl+C the turn, `/tree` back, edit the misspelling out, resubmit — the misspelling never appears in suggestions or the `/acwords` dump; the corrected word does. `/tree` navigation shows no perceptible delay; first-word completions after navigation arrive late-but-present (gate) and settle within the bound. Item 4 (compaction survival) re-checked; a post-compaction `/tree` rebuilds from the branch as-replayable (accepted, 05).

**Live verification technique (binding; h"Live verification technique"):** `pi --no-session` inside a tmux pane (real TTY required; piped stdout exits silently); seed store with one short user message then Ctrl+C; drive keys via `tmux send-keys` **one char at a time with 0.08–0.12 s sleeps** (bursts cancel in-flight autocomplete queries — known source of false conclusions); verify via `tmux capture-pane`; temporary `appendFileSync` instrumentation behind an env var in `src/pi/provider.ts` is sanctioned, removed before commit. UI-layer changes are verified live, not by unit tests alone.

**Performance gates (h"Performance gates"):** (a) 20k-candidate anchored-fuzzy query < 1 ms p99; (t0) tier-0 anchorless full-store pass < 3 ms p99; (b) dict load + 20k lookup sweep < 60 ms; (c) ingest 800 KB synthetic text < 180 ms CI bound, yields every ≤ 64 KB (operative bound is 180 ms per the 2026-09-30 note — do NOT re-tighten to 60 ms); (d) steady-state heap delta < 6 MB. Numbers asserted loosely for CI variance; hard regressions (> 3× budget) fail. `npm run bench` (vitest bench/tinybench, `test/bench/core.bench.ts`) is the reporting counterpart with the same fixtures. `session_tree` rebuild has NO separate gate row (reuses restore budgets).

**Tuning protocol:** change one constant (or knob: `rejectCommonness` / `fuzzThreshold`), run acceptance suite, A/B vs fixed 3-session corpus fixture (`test/fixtures/sessions/`) checking precision@8; `tools/calibrate-bands.mjs` is the measurement probe — run after any retune or dictionary regen. Tier boundaries are semantics (never runtime-tunable).

**Definition of Done:** M1 = all unit tests green, integration items 1–6, perf gates pass, no persistence files (store dir untouched), `npm run check` clean (pi --check doesn't exist — substitution recorded in M1-DoD). M2 = M1 + successor chaining state machine items + integration item 7 (re-themed accept `Zorp` → `Zephra` → `Noria` → `Inverter` walk). Later changesets add: item 8 (line claim, live mandatory) and item 9 (branch hygiene, live).

## 4. Pinned semantics cross-check (specs 05/06/07 + 04)

All confirmed present and matching the PRD summary:
- **Runs detected wherever they sit incl. line-initial** — spec/04-tokenization-and-scoring.md:256–268 ("Runs are detected wherever they sit — line-initial and after-punctuation positions included; the structural-start exclusion does not apply").
- **Casing-evidence admission** — spec/04:269–275 ("A run member admits regardless of the commonness band… run evidence outranks both [dictionary attestation and lowercase sightings]"); casing tallies per spec/06 "Upsert semantics" (capCount/capDisplay/lowerCount, sentence-initial contributions removed at first lowercase sighting).
- **Top-band ceiling chain-only** — spec/04:276–286 (baked ceiling = most common couple hundred words; such members are chain-only; ceiling applies to attested words only).
- **Series-first offers** — spec/06 "Successor index": "series successors rank above ordinary successors regardless of counts (07)"; spec/07:613–616 (top series successor is the top result before any typed fragment).
- **Gate reuse incl. forced requests** — spec/07 h"Startup restore gate" (~:443–462): "The `session_tree` branch rebuild (05) reuses this gate verbatim: during the replay window every query path — forced requests included — waits under the same ≤ 500 ms bound."
- **Release set includes `session_tree`** — spec/07:100–104 (line-claim release fires on submit, `before_agent_start`, `session_start` re-fire, `session_tree`, `session_shutdown`); spec/07:36–40 (branch rebind rule).
- **Replaying a fixed sequence twice yields identical stores incl. tallies + series bigrams** — spec/06 h"Branch purity": "The store — and the M2 successor index — is a pure function of the active branch's replayable history: identical gates and merge semantics applied to the same message sequence yield an identical store… pinned in tests, 09." Series bigrams incl. chain-only members: spec/06 "Bigram capture".

Note: the h2.x/h3.x numbering in the task ("h2.37", "h2.42", "h2.53", "h3.9"…) does **not** exist in these files — spec sections are unnumbered headings; I located them by title (spec 05 "Branch navigation rebuild", spec 06 "Branch purity" + "Bigram capture" + "Successor index", spec 07 "Line claim" + "Startup restore gate" + "pi-tui contract dependencies"). Nothing the PRD missed was found in these sections; the only PRD-summary errors found are the test counts in §2 above.

## 5. README.md (626 lines) — sync targets

**Lines 105–115 (relief retirement blurb, verbatim 105–114):**
> - **Proper-noun relief — retired (2026-09)** — the relief that admitted
>   capitalized attested words (`National`-class) is retired-in-place
>   (ceiling == reject band); the 2026-10 R_eff curve subsumes it. A live
>   audit showed the old band admitting ~483 capitalized common words
>   (`echo`, `windows`, `failed`). Mechanism and calibration history live
>   in `src/core/score.ts`; named-entity completion, if wanted back, is an
>   allowlist design question (spec 04).

**Config table (~:462–474):** `maxSuggestions` default `8` (1–20 clamped); `rejectCommonness` default `12` — **drift risk**: the baked constant in src/core/score.ts and the calibration output both say **REJECT_COMMON_THRESHOLD=30** (see §7); `fuzzThreshold` default `60` (45 under `#`); `menuDelayMs` default `0`; `triggerChar` `#`; `threshold` `2` inert.

**Headings a changeset sweep must touch:**
- 32 `## Features` (feature blurbs: stock-completion delegation ~:100, proper-noun relief ~:108, salience, case-preserving, secrets…)
- 239 `## Architecture`, 318 `## Design invariants`, 353 `## Known limitations`
- 378–606 `## Reference` subtree: 380 `### Dictionary build` (382 `#### What ships`, 389 corpus, 408 rebuild, 423 calibration guarantee, 445 versioning), 458 `### Configuration`, 504 `### Debug`, 531 `### Development` (606 `#### Checks` — verification section, mentions npm run check/test).

## 6. docs/ + M1-DoD.md item-append pattern

`docs/` contains only `M1-DoD.md` (1,570 lines). It is a single append-only evidence log with per-changeset sections, not just M1: sections include "M2 Definition of Done — post-delta re-verification" (:265), "Bugfix-001 re-verification" (:200, :506), "M3 Definition of Done — post-delta re-verification" (:682), "Arrow-model-v2 changeset … post-changeset re-verification" (:1267).

**Item-append pattern to match exactly:**
1. Header block per sweep: sweep **date**, **head commit** (short + full SHA), **environment** (OS · Node · vitest · pi version), one-line **verdict**.
2. Numbered "Gauntlet item N — <name>: PASS" sections, each with the re-runnable command in a fenced code block and dated result lines ("2026-10-02 @ `a2e9470`: exit 0 — 38 test files, 1126 passed / 1 skipped").
3. Gate tables: Gate | Budget (with spec ref) | Measured | vs budget | CI bound (3×) | Verdict — with honesty notes when actuals sit above 1× but inside 3×.
4. Live smoke items: exact tmux key scripts (`z e + Left`, `l w + Right`, Tab, Enter), captures referenced, zero-instrumentation proof, tree-cleanliness statement (`git status --porcelain src/ test/ spec/ README.md docs/` empty at smoke time).
5. **"Drift report (spec read-only this run): NONE FOUND"** section (or findings).
6. Final **"Reproduction"** section: the exact command sequence to re-verify (`git rev-parse HEAD`, `npm run check`, `npm test` with expected counts, `npx vitest --run test/perf-gates.test.ts --disable-console-intercept` 9/9, `npm run bench`, widget battery, live smoke script).
- Command substitution note near the top records PRD-vs-reality corrections (e.g. `pi --check` → `npm run check`).

A new R5 gauntlet entry appends a section in this style (date, commit, env, items: check / full suite with new counts / perf gates 9/9 / defer-pi-menu battery green / live smoke incl. Tab-deferral scenario / drift report / reproduction).

## 7. Perf gates + dictionary + calibration (RUN)

**test/perf-gates.test.ts — 9 gates:**
- a: 20k fuzzy query p99 < 3 ms (3× of 1 ms budget), 1000 queries over ~910-key 'p' bucket
- a2: cold first rankMatches on fresh 20k store < 3 ms
- a3: zero-fragment full-store '#' listing p99 < 25 ms (tripwire, not a §09 gate)
- t0: tier-0 anchorless fallback p99 < 9 ms (3× of 3 ms), §09 h"perf" row
- b: dict load + 20k hits + 1k misses < 180 ms (3× of 60 ms)
- c: ingest 800 KB synthetic text < 180 ms, yields between every ≤ 64 KB slice
- d: steady-state heap delta < 18 MB (3× of 6 MB)
- e: DEFAULT-config restore of large-100k fixture (1561 messages, bigram capture ON) < 600 ms
- f: over-cap flood — 25k distinct words in one message < 300 ms (§05 hard <100 ms; CI bound 300 ms), store stays within cap

**Dictionary:** `dict/common-en.bin`, 850,554 bytes, HAPX v1. Confirmed entry count **48,802**: test/shipped-dict.test.ts:13–35 pins it ("tools/build-dict.mjs printed entries=48802 for the committed artifact"); calibration output confirms `entries=48802 blob=344372B buckets=65536`. `tools/build-dict.mjs` exists (TSV word→count merge/filter/sort/quantize; curve denominator DICT_N=70,000).

**Calibration:** `tools/calibrate-bands.mjs` exists and runs clean. Invoke: `node tools/calibrate-bands.mjs [words...]`. Output: artifact header (entries/blob/buckets), constants (`REJECT_COMMON_THRESHOLD=30 MID_FREQ_THRESHOLD=20 DICT_N=70000`), legacy flat band populations (reject=20464, group2 retired=11286, group1=17052), rank→word→q table, BUG-001 word set verdicts, threshold sweep, acceptance assertions. Word-probe line format (R_eff-aware, **includes the Cap column** — lowercase and Capitalized verdicts):
```
hello            len=5 q=136    R_eff=30  REJECT | Cap: REJECT
World            len=5 q=133    R_eff=30  REJECT | Cap: REJECT
```

## 8. Drift notes / residual risks for R5

1. **Suite count drift**: actual 4 failed / 1128 passed / 1 skipped (1133) vs claimed 3/1129/1. The extra failure is `acceptance.test.ts`'s network-gated `pi -p -e` case (exit 1, stderr not matching the environmental-skip regex). Determine whether it's environment-only or a real extension error before the gauntlet entry.
2. `README.md` config table says `rejectCommonness` default `12`, but baked/runtime constant is `30` (REJECT_COMMON_THRESHOLD=30; R=30 since the 2026-10 width-bound retune). A changeset doc sweep must fix this row.
3. The repro file self-describes as "not a regression suite yet" and is console.log-scaffolded; the fix should convert it to a clean regression battery (and likely extend `test/widget.test.ts` key-handling bullets for the pi-menu-deferral state).
4. Fix shape per the three cases: widget key handling must consult the inner editor's open-autocomplete state (async-resolved) and (a) forward Tab when pi's menu is open, (b) forward when a pi menu auto-opens in unclassified stock surfaces (`/cmd <space> arg`), (c) not re-arm the hapax line over pi's open menu after a hesitation delay elapses.
5. `menuDelayMs` default is 0; case 3 uses 400 — the race is reachable only when the knob is set, but the fix must hold for both.
