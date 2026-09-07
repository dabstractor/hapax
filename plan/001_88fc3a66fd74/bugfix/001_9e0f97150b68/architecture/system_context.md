# System Context — hapax bugfix 001_9e0f97150b68 (BUG-001..BUG-006)

Verified against working tree @ 9c23075 ("Add bug report"). Engine modules are sound; failures cluster
at artifact calibration, cross-component timing contracts, and adversarial input shapes. All six PRD
bug reproductions were independently confirmed against source during recon.

## Module map (files touched by this changeset)

| File | Role | Bugs |
|---|---|---|
| `tools/gen-provisional-tsv.mjs` | provisional `word<TAB>count` generator (length-sorted, synthetic counts) | BUG-001 root cause |
| `tools/build-dict.mjs` | TSV → `dict/common-en.bin`. Exports `DICT_N=70_000`, `KEY_RE=/^[a-z][a-z0-9_-]{1,31}$/`, `quant(rank,n=DICT_N)=255-floor(254*log2(1+rank)/log2(1+n))`, `mergeTsv` (sums counts across dup keys/files), `selectEntries`, `emit`, `verify`. Counts DESC sort, lexicographic tie-break, slice(0,DICT_N) | BUG-001 |
| `dict/common-en.bin` | v1 packed dict, 50,927 entries (hard-coded in `test/shipped-dict.test.ts`), seed 0, byte-stable per input TSVs | BUG-001 artifact |
| `src/core/score.ts` | `admit()` bands: `REJECT_COMMON_THRESHOLD=220` (~L49), `MID_FREQ_THRESHOLD=120` (~L54); null→group 0, <120→1, 120–219→2, ≥220→reject. Constants are the sanctioned "only tuning surface" (spec/04, spec/08) | BUG-001 |
| `src/core/dictionary.ts` | `loadDictionary(path)` throws on bad magic/version ≠ `DICT_VERSION=1`; `lookup()` never throws, returns null on miss | BUG-004 |
| `src/pi/index.ts` | `createLazyDictionary(path, onLoadError)` (~L79–130): sticky failure, `onLoadError` fired exactly once, **no failure state exposed**. `disabled` flag set in onLoadError, checked ONLY in `session_start` + `message_end`. `onSweepPhrases: () => sessionStore.sweepPhraseDemotions()` behind `config.enablePhrases` | BUG-004 |
| `src/pi/ingest.ts` | `IngestPipeline.processText` (~L292) → per-line `#admitSegment` (~L330, raw segment string pre-tokenize) → `tokenize` → `passesShape` (L314) → `admit` → `store.upsert`. `#drainQueue` finally fires `onSweepPhrases` once per live flush only. `restoreFromHistory(pipeline, sm)` (~L426): fire-and-forget async loop, per entry `await pipeline.processText(text, fromUser)`, **no abort check, no sweep** | BUG-003, BUG-004, BUG-006 |
| `src/core/shapeGate.ts` | `passesShape(draft)` (L103) → `isSecretShaped(display)` (L143–191, private, single call site L110): prefix list (sk-, ghp_, xoxb-, akia, eyj…), email, digit+symbol ratio >0.4 @len≥16, base64 run ≥24 **requiring `+`/`/`**, pure hex ≥20. Write-time only; read path (`rankMatches`) trusts the store | BUG-003 |
| `src/core/segment.ts` | `tokenize`: BASE_RE `[A-Za-z][A-Za-z0-9_]{0,63}` + hexish; `/`, `-`, `.`, `@` all split tokens → multi-segment keys fragment | BUG-003 |
| `src/core/query.ts` | `rankMatches` (~L179): constituent suppression loop (~L222–232) splices the bare first word when `phraseSuppresses(p.sal, w.sal)`; `phraseSuppresses = phraseSal >= wordSal` (L133). `phraseSalience = 1.2·Σ constituents + 2.0·log2(1+count)` (L112) ⇒ always > word salience ⇒ bare word always suppressed once a phrase exists | BUG-005 |
| `src/core/store.ts` | `topSuccessors(word)` (L856) O(1) read, frozen `NO_SUCCESSORS` on miss — ready-made "has successors" predicate. `sweepPhraseDemotions()` (L825): demotes non-sticky fast-path phrases with count<2 after 40 ordinals | BUG-005, BUG-006 |
| `src/pi/provider.ts` | `createHapaxProvider` arming in `applyCompletion` (~L351–375): chain key → `chain.arm(next)`; single-token key → `chain.arm(lower)`; **phrase key (contains space) → never arms**. `createDisplayProvider` rules 4a–4d (~L626–682): 4d returns `displayedItems` + stale `displayedPrefix` during the 100 ms suppression window; 4c-exception (`completionSincePaint`, L659–673) is the pattern to mirror | BUG-002, BUG-005 |
| pi-tui (dep `~0.84.4`) | `editor.js`: stores `suggestions.prefix` on every rendered response (L1925–26); Tab calls `applyCompletion(lines, line, col, selected, prefix)` (L540–551, also single-item force-apply L1903–1912). Reference impl `autocomplete.js:265–267`: deletes exactly `prefix.length` chars before the cursor, verbatim, unconditionally. No re-verification at Tab time | BUG-002 contract |

## Confirmed root causes & chosen fix strategies

### BUG-001 (Critical) — mis-calibrated dictionary
Two stacked causes: (1) rank ordering from `gen-provisional-tsv.mjs` is length+input-order, not frequency;
(2) even with a real corpus, `quant` with denominator DICT_N=70,000 gives q≥220 ⇔ rank ≤ 3 and q≥120 ⇔ rank ≤ 391
— the §04 bands can never reject "with/this"-class words.
**Strategy:** vendor a real frequency list (see external_deps.md) and regenerate the artifact — data-only
change, binary format v1 unchanged; then recalibrate the two band constants in `score.ts` (the sanctioned
tuning surface) so the top ~1,000 corpus ranks reject and the next few thousand land group 2. The alternative
(new quantization curve) forces a format-version bump per spec/03 L102–103 ("regen with different
quantization bumps version; the extension refuses") — loader, `DICT_VERSION`, `test/helpers/dict-writer.ts`,
`test/build-dict.test.ts` churn; adopt ONLY if band widening demonstrably compresses the group-1/2
distribution unacceptably. `test/shipped-dict.test.ts`'s hard-coded `entryCount === 50_927` must be updated
to the regenerated count.

### BUG-002 (Major) — stale-prefix suppression corrupts text on Tab
pi-tui stores whatever prefix the provider's last response carried; rule 4d re-serves the stale
`displayedPrefix` while the buffer has advanced ('ze' displayed, 'zep' typed) → Tab replaces the wrong span
('ep' → 'zendesk' ⇒ 'zzendesk'). The 4c-exception already solves this class for acceptance; the plain-typing
case is unprotected.
**Strategy:** add a sibling exception before 4d — if `result.prefix !== displayedPrefix` (fresh prefix
differs from the anchor), paint the fresh set immediately; suppression may only re-serve a set whose prefix
still suffix-matches the current buffer. Test with a NEW faithful `applyCompletion` helper mirroring
`autocomplete.js:265–267` slice semantics (existing `provider-display.test.ts` mocks do not model deletion).

### BUG-003 (Major) — multi-segment secrets leak
Prefix rules die at tokenization (`-`, `/`, `.` split); base64 rule requires `+/` which base64url never has;
ratio rule rarely exceeds 0.4 for mixed-case. Gating is write-time only, so any gate gap is a direct leak.
**Strategy:** two layers. (1) Raw-text window masking BEFORE tokenize: `maskSecrets(segment)` in
`shapeGate.ts` replaces structured key windows (AWS 40-char run, AKIA/AIza IDs, xox[baprs]- tokens,
sk-/sk-proj-, ghp_/github_pat_, JWT eyJ three-segment) with a placeholder so key bytes never reach the
tokenizer; wired in `#admitSegment` where the un-tokenized segment string is available. (2) Token-level
base64url + charset-relative entropy rules in `isSecretShaped` for residue fragments (≥16 chars, mixed case
+ ≥2 digits; entropy ≥4.5 bits/char for base64 charset, ≥3.0 for hex — flat 3.5 folklore false-positives on
English prose).

### BUG-004 (Major) — restore ignores dictionary failure
`createLazyDictionary` exposes no failure state; `disabled` only gates `message_end`/`session_start`
(but at `session_start` the lazy dict hasn't loaded yet, so restore always starts). Restore's background loop
admits the whole history as rank-group-0.
**Strategy:** expose sticky failure state on the lazy dictionary (e.g. `get failed()`), add an optional
`isDisabled` predicate to `IngestPipeline` checked per segment inside `processText` (covers failure
mid-message, not just between messages), and abort the `restoreFromHistory` loop when it fires; notify-once
behavior preserved. Post-settle contract: zero candidates stored under a bad dict.

### BUG-005 (Major) — chain unreachable after phrase learned/restored
`phraseSalience ≥ 1.2 × wordSalience > wordSalience` always ⇒ `phraseSuppresses` (>= tie) always removes the
bare first word; `test/acceptance.test.ts:606–610` currently PINS this buggy behavior (`toEqual(["phrase","phrase"])`),
and its fixture-phase comment (L498–514) works around it by accepting before ingestion.
**Strategy:** (1) successor-aware exemption — skip suppression when `store.topSuccessors(firstWord).length > 0`
(O(1), exists today); bare word co-presents below the phrase (salience sorts it after). (2) Arm the chain on
phrase acceptance: phrase-key branch in `applyCompletion` arming the phrase's LAST word (successor semantics:
`topSuccessors(armed.word)` is the natural continuation; the bug report's "first word" phrasing would re-offer
words already typed — deviating deliberately, documented here). Both restore reachability end-to-end.

### BUG-006 (Minor) — no demotion sweep during restore replay
Sweep fires only in `#drainQueue` finally; restore replays via `processText` directly.
**Strategy:** public `sweepPhrases()` on `IngestPipeline` invoking the existing `onSweepPhrases` hook, called
once at the tail of `restoreFromHistory` (skipped when the replay aborted for BUG-004 reasons).

## Test infrastructure facts
- `vitest --run` (523 tests green, `tsc --noEmit` clean at baseline).
- `test/provider-display.test.ts`: fake timers (`vi.useFakeTimers`, pinned system clock), `harness().emit(fragment)` drives `getSuggestions` directly — NO editor/applyCompletion simulation (must be built new for BUG-002).
- `test/ingest-restore.test.ts`: `fakeSm(opts)` / `fakePipeline()` / `settle()` = `vi.waitFor` — reuse for BUG-004/006.
- `test/chain.test.ts` L17–22 documents the "seeding order gotcha" (phrase admission shadows the word) — the very behavior BUG-005 fixes.
- `test/fixtures/sessions/`: `prose.jsonl`, `nrel.jsonl`, `large-100k.jsonl`, `zendesk-lwlock.jsonl` — use for e2e probes.
- `test/helpers/dict-writer.ts`: independent binary writer, injects arbitrary quant values (no rank math) — unaffected by band recalibration, affected only by any format-version bump.

## Constraints
- Bands/weights are baked constants (spec/08): never config/env. Secret rules always-on, not configurable.
- Spec files under `spec/` are the human-owned PRD source — do not edit; document changes in README/JSDoc.
- `.gitignore` does not cover `dict/`, `*.tsv`, or `tools/corpus/` — vendoring the frequency list is committable as-is.
- No runtime deps may be added (package.json has zero runtime deps); tools are stdlib-only Node.