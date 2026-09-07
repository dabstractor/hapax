# PRP — P1.M4.T1.S1: Scripted integration acceptance (PRD §09 items 1–6) + session fixtures

## Goal

**Feature Goal**: Produce (a) a reusable 3-session fixture corpus in
`test/fixtures/sessions/` that doubles as the PRD §09 tuning-protocol corpus,
and (b) a recorded acceptance run of PRD §09 integration items 1–6 against
the REAL extension via the verified dev loop (`pi -e
/home/dustin/projects/hapax`, P1.M3.T5.S2), with results captured in
`test/fixtures/sessions/RESULTS.md`.

**Deliverable**:
1. `test/fixtures/sessions/` — 3 synthetic session transcripts
   (`zendesk-lwlock.jsonl`, `prose.jsonl`, `large-100k.jsonl`) plus
   hand-labeled expected completions (`expected.md`) for precision@8 tuning.
2. `test/fixtures/sessions/RESULTS.md` — per-item checklist (items 1–6) with
   PASS/FAIL, evidence, and an explicit list of which checks were scripted vs
   verified manually.
3. `test/acceptance.test.ts` — vitest suite that SCRIPTS every automatable
   acceptance check by replaying fixtures through hapax's real modules
   (ingest → store → query → provider match state), plus real-extension
   `pi -p -e` load/ingest checks.

**Success Definition**: `npm test` green including the new acceptance suite;
RESULTS.md records all six items with at least the scripted subset passing
deterministically; interactive-only sub-checks (menu render, Tab insert) are
explicitly marked "verified manually" with evidence notes; fixtures stay
under git with no generated session files leaking outside `test/fixtures/`.

## User Persona

**Target User**: hapax developer running the PRD §09 tuning protocol and the
M1 definition-of-done sweep (P1.M4.T2.S2).
**Use Case**: after changing an admission/salience constant, run the
acceptance suite + corpus precision check; before shipping M1, walk
RESULTS.md's checklist.
**User Journey**: `npm test` → acceptance suite replays fixtures → developer
reads RESULTS.md checklist → interactive items ticked off after a live
`pi -e` session.
**Pain Points Addressed**: PRD §09 items 1–6 currently have no executable
representation; the tuning protocol requires a fixed 3-session corpus that
does not exist yet.

## Why

- PRD §09 tuning protocol *requires* `test/fixtures/sessions/` as the fixed
  corpus — this task creates it.
- PRD §09 M1 definition of done (h2.53) requires integration items 1–6 to
  pass — this task is the evidence.
- M2 acceptance (P2.M2.T3.S1) reuses this corpus and checklist format.

## What

1. **Fixtures** (synthetic, deterministic, no network): pi-session-shaped
   JSONL transcripts (same entry shape as `pi --export` output:
   entries with `type`/`message{role, content}`; loader tolerant of unknown
   fields). Three files:
   - `zendesk-lwlock.jsonl` — multi-turn user/assistant discussion of
     `Zendesk` ticketing and Postgres `lwlock` contention; also contains
     camelCase identifiers (`fixRoundingError`), hexish tokens, and a quoted
     path mention (for item 6 context). Item 1 corpus.
   - `prose.jsonl` — 30+ turns of ordinary English prose with NO rare
     vocabulary. Item 2 corpus (no-hijack: expect zero admitted candidates
     beyond dictionary-common filtering → no menu).
   - `large-100k.jsonl` — ≥100k tokens (~420KB+ of text; generate
     programmatically once, commit the file) with vocabulary spread across
     the whole history (tests eviction interplay on restore) and, near the
     END, a user message pasting an API key (`sk-` + 40+ mixed chars) and a
     `ghp_...` token. Items 3 + 5 corpus.
   - `expected.md` — hand-labeled expected completions per fixture
     (fragment → expected top-8 set) for precision@8 measurement during
     tuning.
2. **Scripted acceptance** (`test/acceptance.test.ts`): replays each fixture
   through the REAL pipeline modules — `restoreFromHistory` /
   `IngestPipeline` (`src/pi/ingest.ts`), `CandidateStore`, `rankMatches`
   (`src/core/query.ts`), `extractMatchState` + `createHapaxProvider`
   (`src/pi/provider.ts`) — against the SHIPPED `dict/common-en.bin`
   (load via `loadDictionary`, path from `resolveDictPath()` in
   `src/pi/paths.ts` or the index seam per P1.M3.T5.S2):
   - Item 1: after ingesting `zendesk-lwlock.jsonl`, `ze` → top candidate
     `Zendesk` (exact cased insertion string — provider item label); `#l`
     via trigger mode → `lwlock`.
   - Item 2: after `prose.jsonl`, type-2-char fragments of prose words →
     zero candidates → provider DELEGATES (assert `current.getSuggestions`
     was called with unchanged args, using the fake-current-provider pattern
     already used in `test/provider-live.test.ts`).
   - Item 3: time `restoreFromHistory` on `large-100k.jsonl` → < 100 ms
     (loose CI margin: assert < 300 ms, record exact number in RESULTS.md;
     PRD hard regression = > 3×). Completions available immediately after.
   - Item 4: compaction = pi replaces history entries; hapax store survives
     by design (in-memory, PRD §05 h2.32). Script: ingest fixture, then
     invoke the extension's compaction handling path — assert store stats
     unchanged and previously admitted word still completes. If the
     compaction seam is not exposed by S1 (check `src/pi/index.ts` for a
     `session_compact`-style hook; if none exists, PRD §05 says compaction
     does NOT touch the store), then assert at minimum that no ingest/store
     reset occurs across a simulated message_end-after-compaction sequence
     and DOCUMENT the exact manual verification in RESULTS.md.
   - Item 5: after ingesting `large-100k.jsonl`, query prefixes `sk`, `gh`,
     and the key's first 6 chars → key NEVER present in top-8; additionally
     assert `passesShape(key) === false` directly.
   - Item 6: for match states that return null (quoted path `"./src/`,
     slash `/re`, `@men`), assert delegation to `current` with byte-identical
     args — this is the scripted half; the LIVE parity check (identical
     behavior with/without `-e`) is manual, recorded in RESULTS.md.
3. **Real-extension scripted checks** (also in acceptance.test.ts or a
   `scripts/acceptance.sh`): run
   `pi -p -e /home/dustin/projects/hapax --no-builtin-tools "say Zendesk lwlock"`
   — print mode proves jiti load + message_end ingest on the real runtime.
   Note: `pi -p` does NOT exercise the input-box popup (ctx.mode ===
   "print"); it proves load + ingest only. Popup/Tab/keystroke items are
   manual.
4. **RESULTS.md**: checklist per item 1–6; each sub-check marked
   `[scripted]` (test name) or `[manual]` (how verified, evidence/date);
   measured timings; verdict per item.

### Success Criteria

- [ ] `test/fixtures/sessions/` contains the 3 JSONL fixtures + `expected.md`
- [ ] `test/acceptance.test.ts` passes and covers items 1–6's scripted halves
- [ ] `pi -p -e` load of the real extension verified inside the scripted run
- [ ] RESULTS.md present, all 6 items recorded, manual items documented with
      verification instructions
- [ ] `npm run check` + `npm test` green; `git status` shows no stray session
      files outside `test/fixtures/sessions/`

## All Needed Context

### Context Completeness Check

The implementing agent gets the fixture formats, the exact module APIs to
drive, the exact CLI invocations, and the automation/manual split with
reasoning. No prior hapax knowledge assumed beyond PRP-pointed files.

### Documentation & References

```yaml
- file: plan/001_88fc3a66fd74/P1M3T5S2/PRP.md
  why: CONTRACT for the dev loop this task runs on — pi -e load, resolveDictPath
    location (src/pi/paths.ts preferred, exported name resolveDictPath),
    graceful-disable behavior, README Development section.
  gotcha: S2 may still be landing; if src/pi/paths.ts is absent, import
    resolveDictPath from src/pi/index.ts (S1's seam location).

- file: plan/001_88fc3a66fd74/P1M3T5S1/PRP.md
  why: CONTRACT for the factory — session_start/message_end/session_shutdown
    wiring, /acwords debug command registration (use /acwords stats output as
    evidence in the live manual run), lazy dict, disable-on-bad-dict.

- file: src/pi/ingest.ts
  why: real ingestion API — extractText, IngestPipeline, restoreFromHistory(
    sessionManager-like {getEntries(), getBranch?()}), safeEntries guard.
  pattern: acceptance tests construct a minimal SessionEntry[] from fixture
    JSONL and call restoreFromHistory / pipeline directly.

- file: src/pi/provider.ts
  why: createHapaxProvider(current, ...) wrapper + extractMatchState — the
    delegation assertions and item 1/2/6 queries go through these.
  pattern: see test/provider-live.test.ts for the fake current-provider used
    to observe delegation (call-args capture).

- file: src/core/query.ts, src/core/store.ts, src/core/dictionary.ts
  why: rankMatches(store, prefix, ...) for direct top-8 checks; loadDictionary
    + DICT_VERSION for loading the shipped artifact.

- file: test/provider-live.test.ts, test/ingest-restore.test.ts
  why: existing patterns for driving provider and restore without pi runtime;
    follow their fixture/fake styles.

- file: plan/001_88fc3a66fd74/architecture/pi_extension_api.md
  why: event payloads (session_start reasons incl. resume), ctx.mode values,
    sessionManager.getEntries() contract.
  section: "4. Session history (restore path)" + event table.

- url: local pi repo /home/dustin/projects/pi (packages/coding-agent/examples/extensions/)
  why: only needed if delegation/popup questions arise; not required for the
    scripted path.

- file: plan/001_88fc3a66fd74/P1M4T1S1/research/notes.md
  why: verified CLI facts, fixture design rationale, automation reality
    (pi -p does not exercise the popup).
```

### Current Codebase tree (relevant)

```bash
hapax/
├── package.json            # pi manifest + scripts: check, test (vitest 4)
├── dict/common-en.bin      # shipped artifact (HAPX v1, 50,927 entries)
├── src/core/               # dictionary, segment, shapeGate, score, store, query, types
├── src/pi/                 # index (S1/S2 in flight), config, ingest, provider, debug
└── test/                   # vitest suites incl. provider-live, ingest-restore
```

### Desired Codebase tree with files to be added

```bash
test/fixtures/sessions/
├── zendesk-lwlock.jsonl    # item 1 corpus
├── prose.jsonl             # item 2 corpus
├── large-100k.jsonl        # items 3+5 corpus (committed; ~400KB+)
├── expected.md             # hand-labeled completions (precision@8)
└── RESULTS.md              # acceptance checklist record (this task's output)
test/acceptance.test.ts     # scripted acceptance suite
tools/gen-large-session.mjs # one-shot generator for large-100k.jsonl (deterministic seed)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: pi -p (--print) does NOT exercise the input-box autocomplete
//   (ctx.mode === "print"; no editor keystroke path). Popup, Tab insertion,
//   debounce, and no-hijack keystroke feel are MANUAL — record in RESULTS.md.
// CRITICAL: never run `pi -p` with tools enabled on fixtures — use
//   --no-builtin-tools (or -nt) to avoid the model calling tools; keep the
//   prompt trivial. If network/model is unavailable, skip that check with a
//   clear RESULTS.md note rather than failing CI.
// GOTCHA: timing assertions in CI are flaky — assert restore < 300 ms
//   (3x PRD budget per §09 "loose CI" rule), RECORD the measured number.
// GOTCHA: large-100k.jsonl must be DETERMINISTIC (seeded PRNG in
//   tools/gen-large-session.mjs) so precision@8 labels stay valid.
// GOTCHA: fixture entry shape must match real session entries — build one
//   reference by running `pi --export` on a scratch session, or mirror the
//   MessageEndEvent message shape ({role, content: string | blocks}).
// CRITICAL: store is in-memory only — assert no files written: snapshot
//   `git status --porcelain` + check ~/.pi for hapax artifacts after the
//   scripted run (PRD DoD "no persistence files").
// GOTCHA: API-key strings in fixtures are FAKE (generated, never real);
//   still shape-gate-reject them (sk-/ghp_ prefixes).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: CREATE tools/gen-large-session.mjs (deterministic, seeded)
  - IMPLEMENT: node script emitting large-100k.jsonl (~1500 turns,
    vocabulary seeded from a fixed word list incl. repeated rare terms;
    API-key paste near the end); run once, COMMIT the output
  - NAMING: plain node script, no deps
  - DETERMINISM: mulberry32/linear PRNG with fixed seed 42

Task 2: CREATE test/fixtures/sessions/{zendesk-lwlock,prose}.jsonl + expected.md
  - IMPLEMENT: hand-authored multi-turn transcripts in session-entry JSONL
    shape; expected.md maps fragment -> expected top-8 word sets per fixture
  - VALIDATE shape against a real `pi --export` session file (or the
    MessageEndEvent message shape) before writing the loader

Task 3: CREATE test/helpers/session-fixture.ts (loader)
  - IMPLEMENT: parseSessionFixture(path): SessionEntry[]-compatible array;
    tolerant of unknown fields; used by acceptance tests
  - PLACEMENT: test/helpers/ (sibling of dict-writer.ts)

Task 4: CREATE test/acceptance.test.ts — items 1,2,3,4,5,6 (scripted halves)
  - LOAD: dict via loadDictionary(resolveDictPath()); store via new
    CandidateStore(...); pipeline/restore via src/pi/ingest.ts; provider via
    createHapaxProvider(fakeCurrent, ...) — follow test/provider-live.test.ts
  - ITEM 1: ingest zendesk fixture → extractMatchState on "ze" (threshold
    mode) → rankMatches top-1 label === "Zendesk"; trigger "#l" → "lwlock"
  - ITEM 2: prose fixture → common-word fragments yield zero candidates AND
    delegation (capture fakeCurrent call args)
  - ITEM 3: performance.now() around restoreFromHistory(large fixture) →
    < 300 ms; afterwards rankMatches("ze") etc. return results
  - ITEM 4: per the compaction-seam reality check in What §2 item 4
  - ITEM 5: assert passesShape(apiKey) === false and absent from all top-8s
  - ITEM 6: null match states (quoted path, "/re", "@men") delegate with
    unchanged args
  - NAMING: describe("acceptance item N — ...")

Task 5: Scripted real-extension check
  - IMPLEMENT: run `pi -p -e /home/dustin/projects/hapax --no-builtin-tools
    "<trivial prompt mentioning Zendesk>"` from the test (execFile, generous
    timeout) OR as scripts/acceptance.sh; assert exit 0, no stderr extension
    errors. Mark network-dependent: skip when offline, note in RESULTS.md.

Task 6: MANUAL verification pass + CREATE test/fixtures/sessions/RESULTS.md
  - RUN live `pi -e /home/dustin/projects/hapax` sessions covering:
    a. item 1 live: discuss Zendesk/lwlock, type `ze` → menu, Tab inserts
       cased `Zendesk`; `#l` → `lwlock`
    b. item 2 live: continuous ordinary prose; keystrokes verbatim; Tab with
       no selection = literal tab
    c. item 3 live: resume the 100k session (`pi -r`) → completions within
       first second (subjective + /acwords stats)
    d. item 4 live: /compact in a long session → /acwords still lists prior
       words; they still complete
    e. item 5 live: paste fake key → verify never suggested
    f. item 6 live: run identical path/slash/@ interactions with and without
       -e; record parity
  - RECORD: per-item PASS/FAIL, [scripted]/[manual] tags, test names, dates,
    measured restore timing

Task 7: VALIDATE
  - npm run check && npm test — green
  - git status clean except intended new files; no session files leaked
    outside test/fixtures/sessions/
```

### Implementation Patterns & Key Details

```ts
// PATTERN: observe delegation with a fake current provider
// (already proven in test/provider-live.test.ts — reuse its shape)
const calls: unknown[][] = [];
const fakeCurrent = { async getSuggestions(...args: unknown[]) {
  calls.push(args); return { items: [], prefix: "" };
} } as unknown as AutocompleteProvider;

// PATTERN: drive ingestion without pi runtime
const entries = parseSessionFixture("test/fixtures/sessions/zendesk-lwlock.jsonl");
const store = new CandidateStore(...);
await restoreFromHistory({ getEntries: () => entries }, pipeline, store);

// PATTERN: loose CI timing (PRD §09: hard regression = > 3x budget)
t = performance.now(); await restore...; dt = performance.now() - t;
expect(dt).toBeLessThan(300); // record exact dt in RESULTS.md
```

### Integration Points

```yaml
ROUTES: none
CONFIG: none — fixtures must work with DEFAULT config (trigger "#", threshold 2)
DEPENDS-ON (contracts): src/pi/index.ts factory (S1), resolveDictPath (S2),
  /acwords debug command (S1). If S2 delivered paths.ts, import from there;
  else from index.ts.
CONSUMED-BY: PRD §09 tuning protocol (precision@8 vs expected.md),
  P1.M4.T1.S2 benchmarks, P2.M2.T3.S1 (M2 acceptance reuses corpus).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — clean
```

### Level 2: Unit / Acceptance Tests

```bash
npm test                          # all suites incl. test/acceptance.test.ts
npx vitest --run test/acceptance.test.ts -v   # item-by-item visibility
```

### Level 3: Real-extension integration

```bash
pi -p -e /home/dustin/projects/hapax --no-builtin-tools "Reply with one word: ok"
# expect exit 0, no extension errors on stderr
pi -e /home/dustin/projects/hapax   # interactive session for Task 6 manual pass
```

### Level 4: Records

```bash
# RESULTS.md complete: 6 items, scripted+manual evidence, timings recorded
# No persistence: git status --porcelain → only intended files; ~/.pi clean
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean; `npm test` green (incl. acceptance suite)
- [ ] Fixtures deterministic and committed; loader tolerant of extra fields
- [ ] No files written by hapax anywhere (PRD DoD)

### Feature Validation

- [ ] Items 1–6 each recorded in RESULTS.md with scripted or manual evidence
- [ ] Scripted item 1 exact-case assertion (`Zendesk`, `lwlock`) passes
- [ ] Item 5: fake keys never in any top-8 across all fixtures
- [ ] Item 6: delegation asserted scripted + live parity manually verified
- [ ] expected.md labels consistent with fixture contents (spot-check 5)

### Code Quality

- [ ] Reuses existing test-helper/fake patterns (provider-live, ingest-restore)
- [ ] No new npm dependencies
- [ ] Manual-vs-scripted split explicitly documented, not silently assumed

## Anti-Patterns to Avoid

- ❌ Don't claim `pi -p` tests the popup — it cannot; mark popup items manual
- ❌ Don't put real API keys (even revoked) in fixtures — generate fakes
- ❌ Don't assert hard < 100 ms in CI (flaky); 3× margin + record measurement
- ❌ Don't generate large-100k.jsonl at test time — commit it (deterministic)
- ❌ Don't write session/state files outside test/fixtures/sessions/
- ❌ Don't re-implement ingestion logic in tests — always go through
  src/pi/ingest.ts + src/core/* (the point is accepting the REAL extension)

## Confidence Score

**8/10** — the scripted half is well-grounded in existing test patterns and
verified CLI facts; residual risk sits in (a) the exact session-entry JSONL
shape (mitigated: validate against a real `pi --export` before writing the
loader) and (b) S1/S2 landing their contracts (their PRPs are explicit and
parallel; fallback import locations documented).