# Research notes — P2.M2.T3.S1 (integration item 7 + enablePhrases gating + /acwords M2 dump)

## Codebase facts verified (2026-09 workspace state)

- `src/pi/debug.ts` (146 lines): `formatAcwordsDump(store, stats)` builds sections via
  small helpers (`storeSection`, `topSection`, `statsSection`) and joins. Module header
  explicitly anticipates this task: "M2 (P2.M2.T3.S1) appends a phrases/successor section:
  build sections through the small helpers below so a new section lands in exactly one place."
  `AcwordsCommandDeps` is a structural Pick slice — extend it, tests pass stubs.
- `src/pi/config.ts`: `enablePhrases: boolean` exists (line 42), default `true` (line 51),
  validated from raw config (lines 197–203). No new config needed.
- `src/pi/index.ts` (~line 142–155): phrase capture (`onAdmittedTokens → recordPhraseLines`)
  and demotion sweep (`onSweepPhrases`) are ALREADY gated by `config.enablePhrases`.
  `before_agent_start` handler exists at line 213 (chain reset wiring per T2.S1 PRP).
- `src/pi/provider.ts` (417 lines): `rankMatches(store, state.fragment, { limit })` is
  called WITHOUT any phrase gate — phrases inside `src/core/query.ts` rankMatches are
  first-class (constituent suppression included). With `enablePhrases: false` the store's
  phrase map is empty (capture gated), so query-side phrases are inert by construction —
  but successor index recording must ALSO be verified/gated (see below), and the chain
  machine arming/armed branch must be gated explicitly in provider (T2.S1 PRP deferred
  this to T3.S1: "guard: if (!config.enablePhrases) skip arming — leave that to T3.S1").
- `src/core/store.ts`: phrase APIs `recordPhraseLines`, `sweepPhraseDemotions`,
  `getPhrase`, `phraseEntries()`, `iteratePhrases()`, `#phrases` map with cap.
  Successor index (T1.S1, in-flight) contract: `Successor = { next: string; count: number }`,
  `topSuccessors(word): readonly Successor[]` (lowercase, ≤3, empty const for misses),
  built at ingest. Per T1.S1 PRP it rides the admitted-token flow — verify whether it
  is inside `recordPhraseLines` (then already gated) or a separate hook (then gate it).
- `test/fixtures/sessions/`: **NO "National Renewable Energy Laboratory" vocabulary
  exists** in any fixture (grep: 0 hits for national/renewable/laboratory/NREL in
  zendesk-lwlock.jsonl, prose.jsonl, large-100k.jsonl, expected.md). The item brief's
  claim that fixtures provide it is stale — a NEW fixture `nrel.jsonl` must be authored
  in this task (same JSONL shape as zendesk-lwlock.jsonl; loader `test/helpers/session-fixture.ts`
  parses tolerantly: lines = objects with `type` + `message{role,content}`).
- `test/acceptance.test.ts` (486 lines): items 1–6 scripted via real extension modules +
  shipped dict; RESULTS.md in test/fixtures/sessions/ is the evidence ledger with
  [scripted]/[manual] verdict tables + hygiene + reproduction sections. Item 7 appends.
- `test/debug.test.ts` (260 lines): tests `formatAcwordsDump` pure builder with stub
  store/pipeline — extend for phrases section.
- `test/perf-gates.test.ts`, `test/provider.test.ts` (never-hijack cases a–g): must stay
  green untouched.

## Contract interfaces consumed (from sibling PRPs, assume landed)

- P2.M2.T1.S1: `store.topSuccessors(word)`, `Successor` in `src/core/types.ts`.
- P2.M2.T2.S1: `createChainMachine()` in provider.ts (`state/arm/reset`), armed branch in
  `getSuggestions` (threshold-1, fragment `before.match(/[A-Za-z][A-Za-z0-9_]*$)`),
  arming intercept in `applyCompletion` via `liveKeyByValue` (`"\u0000chain:"` marker),
  `before_agent_start → chain.reset()` in index.ts.
- **IDENTIFIED GAP**: T2.S1's armed-branch contract requires fragment length ≥ 1 and
  disarms on word-less state — directly after a Tab-accept the cursor sits at "…National"
  (fragment = "national", matches no successor) or "…National " (word-less → disarm).
  Either way, PRD item 7's ZERO-additional-typed-characters chain cannot display. This
  task must add a minimal "post-accept pending offer" amendment to the chain machine.

## README

- README.md has a Debug section (from P1.M3.T4.S1/P1.M4.T2.S1) documenting /acwords
  output — extend for phrases + successor sample lines.