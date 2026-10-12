# Repo governance & conventions — bugfix changeset 001_140e40041dd1

Working-tree state read directly (current text, no `git show`). Repo: /home/dustin/projects/hapax.

## 1. Spec: invariants + maintenance policy (spec/SPEC.md, current tree)

**Spec maintenance policy** (spec/SPEC.md:14-27, quoted/condensed):
- Interactive sessions MUST update the spec; "A change that ships code without the matching spec edit is incomplete." Either order OK; spec and code must land in agreement.
- Implementation pipeline agents MUST NOT touch `spec/*.md` — read-only inputs; record drift in code comments/reports; a later interactive session reconciles.
- `plan/` directories are historical run artifacts — never edited, never authoritative.

**Design invariants** (spec/SPEC.md:29-43, verbatim):
1. **Never hijack typing.** "No key is ever captured, consumed, or altered except Tab while a suggestion is selected — plus, on the one-line widget display (M3), the arrow keys and Escape once the result line has been ENTERED; on an un-entered line Escape and ↑/← on the first word dismiss the line AND forward the press verbatim (one press, plain-pi parity …). The user's typing experience is otherwise unchanged; the result line is strictly take-it-or-leave."
2. **Tab is never delayed by UI — and Tab only ever completes.** "The top suggestion is computed synchronously on every keystroke; the popup may be debounced, but a single Tab keypress always resolves the current top or selected item immediately. Tab never opens, toggles, or summons the menu … Enter always submits — never accepts a completion."
3. **The popup never flickers and never appears with zero candidates.** "(Widget-path amendment, 2026-10: once the suggestion row is CLAIMED for the current prompt … an empty result renders the row BLANK rather than removing it; reserved whitespace is not a zero-candidate appearance.)"
4. **Everything stays in RAM.** "No persistence, no telemetry, no network. The candidate store is per-session and dies at `session_shutdown`."

## 2. spec/09-testing-and-acceptance.md (current tree)

- **Integration acceptance list**: items 1–10 (09:integration section). Item 7 (paths): "Conversational path completion (2026-10, rule 4d): a path that appeared in conversation (user-typed or model output) is offered when its FIRST segment is typed — `sr` → `src/core/query.ts`, Tab inserts the whole path; an absolute path inserts with its leading `/`. Once a `/` precedes the cursor, stock pi file completion owns the rest (item 6 unchanged)." Item 10 = post-Tab extension offer; item 8 = line claim; item 9 = branch hygiene.
- **Live verification technique (binding)** (09 "Live verification technique"): `pi --no-session` inside tmux (needs real TTY); seed store by one submitted message + Ctrl+C; drive keys via `tmux send-keys` one char at a time with 0.08–0.12 s sleeps (bursts cancel in-flight autocomplete queries); verify via `tmux capture-pane`; temporary `appendFileSync` instrumentation behind an env var in `src/pi/provider.ts` is sanctioned, removed before commit. "UI-layer changes are verified live, not by unit tests alone." Performance gates table also lives here (09 "Performance gates").
- **Production-wiring/e2e requirements**: unit tests per module listed per file (segment/shapeGate/score/query/store/dictionary/provider/widget); provider tests cover Tab-only-completes incl. the forced `getSuggestions({force:true})` single-item fast path; widget tests cover visibility machine, suppression lapse, line claim, key handling, post-Tab extension offer. No dedicated "e2e composition" test spec — that's what the live tmux technique is for. Definition of done sections (M1/M2) at the end of 09.

## 3. README.md (current tree) — change surface

Structure (headings): `# hapax` (1) / Features (32) / Quick start (239) / Usage (255) / Architecture (322) / Design invariants (401) / Known limitations (436) / Non-goals (452) / Reference → Dictionary build (463), Configuration (542), Debug (588), Development (615, incl. Checks at 690).

Bug-relevant sections needing a sync touch after fixes:
- Series chaining: lines 126, 177–204 ("Chained Tab completion — zero additional typing, one word per Tab", `src/pi/provider.ts`, `src/pi/widget.ts`; claims identical behavior "on the two paths"), 206–222 (post-Tab extension ladder), 229–235 (series bigrams, both display paths).
- Path completion: Features bullet near 47–72 region + path rule text; Usage (255) likely covers paths.
- Widget vs fallback: lines 9–16 (status note + 2026-09-30 widget-path bugfix post-delta note at 20–30), 95–114 (widget vs fallback forwarding / stock-context preemption).
README is 721 lines; it already documents a prior widget-path bugfix round (lines 22–30) — precedent for a post-delta note per fix.

**docs/**: only `docs/M1-DoD.md` (M1 definition-of-done artifact). No other docs files.

## 4. Test conventions

- `package.json` scripts: `check` = `tsc --noEmit`, `test` = `vitest --run`, `bench` = `vitest bench`. No CI/fast script; no vitest.config.* file (defaults + globals via tsconfig `types: ["vitest/globals"]`).
- `tsconfig.json`: `strict: true`, target ES2022, NodeNext modules, noEmit, skipLibCheck, includes `src/**/*.ts` + `test/**/*.ts`.
- `test/helpers/` exports:
  - `session-fixture.ts`: `FixtureEntry` (iface, :25), `parseSessionFixture(path): FixtureEntry[]` (:43), `messageEntriesOf(entries): FixtureEntry[]` (:60), `asSessionManager(entries): {…}` (:72).
  - `editor-sim.ts`: `editorApplyCompletion(…)` (:42), `prefixIsAnchorSafe(…)` (:58).
  - `dict-writer.ts`: `DictEntry` (:44), `fnv1a(word, seed): number` (:59), `buildDictBinary(entries): Buffer` (:84), `writeDictFile(path, entries): string` (:139).
  - Also `bench-fixtures.ts` (mulberry32, makeStore, makeSyntheticDict, makeAbsentWords, makeSessionText) and `query-invariants.ts` (`assertWordsOnly`).

### test/index.test.ts harness API (precise — follow this for new production-seam tests)
File header (lines 1-22) states the contract: default export registers exactly the five `pi.on` handlers and does nothing at factory time.
- `fakePi(): { pi: ExtensionAPI; on: Mock; registerCommand: Mock; handlers: Map<string, Handler> }` (:88-104) — captures handlers by event name; `registerCommand` spied.
- `fakeCtx(over?: { cwd?; trusted?; branch?: SessionEntry[]; entries?: SessionEntry[]; editorFactory?: unknown })` (:110-152) — returns ctx + spies: `notify, addAutocompleteProvider, getEditorComponent, setEditorComponent, isProjectTrusted, getBranch, getEntries`. `getEditorComponent` returns `over.editorFactory` (default undefined → fallback path; pass a factory to exercise the widget branch).
- `currentFake(): AutocompleteProvider` (:155-165) — contract-shaped wrapped provider (`getSuggestions` → null, `applyCompletion` echo).
- `startSession(handler, ctx, reason?)` (:169-174), `endMessage(handler, ctx, message)` (:177-181), `acwordsHandler(register, index?)` (:184-192), `dump(handler)` (:194-201) renders /acwords notify output; `wordsSeenIn(dump)` (:203); `settle()` waits 420 ms (> 300 ms debounce).
- Isolation (beforeEach :207-217): temp HOME + cwd via mkdtemp, `vi.stubEnv("HOME", home)`; `useDictPath()` / `useDict()` / `useCorruptDict()` (:220-246); `enableDebug()` / `writeConfig(fields)` write `~/.pi/agent/hapax.json` (:249-263). File-wide afterEach removes `/tmp/hapax-store.txt` (:60-66).
- Message/entry builders: `userMsg(content)` (:70), `msgEntry(id, message)` (:76).
- Imports the real `hapax` default export, `createLazyDictionary`, `resolveDictPath` from `../src/pi/index.js`; observes store/pipeline via real /acwords dump and the registered provider. 1208 lines total; remaining ~950 lines are the test suites themselves.

## 5. src/pi/index.ts full structure (562 lines)

- `createLazyDictionary(path, onLoadError): Dictionary` (:100-152) — lazy load, sticky failure, `failed` getter (BUG-004 seam).
- `export { resolveDictPath }` (:92).
- Default export `hapax(pi: ExtensionAPI): void` (:166-562). Factory-scope closure state: `store, lazyDict, pipeline, displayProvider, chain, claim, disabled, sessionGate, sessionConfig, sessionTickInputClock` (:167-209).
- **session_start** (:211-406): disabled guard → loadConfig (trust-gated) → fresh `sessionStore = new CandidateStore()` bound to local const → `createChainMachine()`, `createLineClaim()`, `createLazyDictionary` (failure → notify + `disabled = true`) → `new IngestPipeline({ store: sessionStore, dictionary, rejectCommonness, isDisabled: () => disabled, ...(config.enableChaining ? { onAdmittedTokens: (runs) => sessionStore.recordBigramRuns(runs.map(r => r.map(m => m.key))) } : {}) })` (:254-260; shim comment :229-249 — **the shim strips run enrichment to keys only; series/nextDisplay info is discarded at the wiring — the series-bigram bug site**). Display branch (:281-336): editor factory → widget PRIMARY via `createWidgetEditorFactory`; already-wrapped → re-bind reload branch; else FALLBACK `addAutocompleteProvider` with `createStartupGate(createHapaxProvider(...), restoreReady)` + display provider; enter-submit wrap. Then `/acwords` (debug), history probe, `restoreFromHistory(pipeline, ctx.sessionManager, () => disabled, markReady)`.
- **session_tree** (:408-487): guards (`disabled || !pipeline || !store`, `newLeafId === oldLeafId`) → `pipeline.discardPending()` → `claim?.release()` → fresh `restoreReady` promise → widget recompose (same store instance) OR `sessionGate?.arm(restoreReady)` → async `flush(); store.reset(); restoreFromHistory(...)`. **The rebuild does NOT re-wire onAdmittedTokens — it doesn't need to: it resets the SAME `store`/`pipeline` instances, and the pipeline's `onAdmittedTokens` closure (captured at construction, :244) still targets that same `sessionStore` instance.** So series wiring survives rebuild intact.
- **message_end** (:489-494): `pipeline.onMessageEnd(event.message)`, never returns a value.
- **session_shutdown** (:496-511): disposes displayProvider + pipeline, nulls all slots.
- **before_agent_start** (:513-522): `chain?.reset(); claim?.release()`.

### All recordBigramRuns call sites under src/
- `src/pi/index.ts:244` — the ONLY functional call site (`sessionStore.recordBigramRuns(runs.map(r => r.map(m => m.key)))`, gated by `config.enableChaining`).
- `src/core/store.ts:735` — the definition (`recordBigramRuns(...)`); other store.ts hits are comments (:58, :69, :112, :142, :283, :321, :878, :981).
- Comments elsewhere: `src/core/types.ts:95`, `src/pi/ingest.ts:128, 439, 450, 1014`, `src/pi/debug.ts:112`.

## 6. plan/006_7bd0258da993/tasks.json — prior-plan task requirements + status

- **P1.M1.T2.S2 — "Series bigrams: BigramEntry/Successor extension + series-first top-3 retention" — status: Complete.** Required: `Successor` gains `series?: boolean` and `nextDisplay?: string`; BigramEntry same; `recordBigramRuns` consumes the enriched payload — every adjacent pair in a capitalized run recorded as series bigram INCLUDING chain-only members, marked series, remembering run casing (nextDisplay); retention: series entries rank above ordinary successors in per-word top-3; same window-break/cap/eviction; battery in bigrams/successors tests; JSDoc rides.
- **P1.M2.T2.S1 — "Fallback provider: series-first zero-char offers + close-on-space typed arming" — status: Complete.** Required: spec 07 h2.53 on the fallback path; zero-char armed offer = series first (count desc, run-casing display/insert) then ordinary; NEW arming at close-on-space: typed word with uppercase first letter + series successors in topSuccessors (chain-only members arm; lowercase never arms); Tab-accept arming, one-shot grant, before_agent_start reset, exact-equal exclusion unchanged.
- **P1.M2.T2.S2 — "Widget path: series-first zero-char offers + close-on-space typed arming" — status: Ready, NOT Complete** (PRD claims all Complete — discrepancy). Required: mirror 07 h2.53 on the widget: zero-char offer items composed at the widget paint merge site (~widget.ts:904-930) with nextDisplay casing; close-on-space arming at the widget visibility-machine site (~:951-957) with uppercase-first-letter + successor consult; exact-equal exclusion/suppression-lapse unchanged. Research note cites widget.ts chainShim :655-665, armGate :668-673.
- **P4.M1.T2.S1 — "Provider seam change + re-request verification + PIN + battery" — status: Complete** (PRD says deliverables partially missing). Required: (a) Tab-accept never arms rest-of-word suppression on the provider path (unconditional, spec 07 h3.11); (b) extension offer rides the post-applyCompletion re-request — VERIFY the pi-tui runtime re-request contract and PIN it at consumption sites; battery of tests. The "PIN" deliverable appears to be the partially-missing piece per the PRD.

## 7. git state + uncommitted-edit overlap

`git status --short`: only five ADDED (staged-new) files, all under `plan/006_7bd0258da993/bugfix/001_140e40041dd1/` (TEST_RESULTS.md, bug_hunt_result.json, prd_index.txt, prd_manifest.txt, prd_snapshot.md). `git diff --stat`: empty.
- `git diff test/index.test.ts test/debug.test.ts`: **empty — no uncommitted edits to those files in the current tree** (task brief said otherwise; current state is clean).
- `git diff src/core/query.ts`: **empty — comment-only claim not applicable; no diff at all.**
- Net: no working-tree drift overlaps any of the 4 bug areas; the only uncommitted content is new bugfix-plan artifacts.

## 8. Tooling constraints

- `npm run check` (tsc --noEmit, strict) and `npm test` (vitest --run) must both be green before committing (AGENTS.md). Suite: 39+ test files, no fast/CI script; perf-gates.test.ts contains timed gates — full run may take tens of seconds; not run here.
- UI-layer changes additionally need the live tmux TTY verification (spec 09, binding) — applies to the widget-arming and widget-path bugs.

## Start here
`src/pi/index.ts:244` (the onAdmittedTokens shim that strips series enrichment — bug #1's likely site), then `test/index.test.ts` harness (lines 68-263) for the new production-seam tests, then plan/006 tasks P1.M2.T2.S2 (widget arming, status Ready) and P4.M1.T2.S1 (missing PIN).
