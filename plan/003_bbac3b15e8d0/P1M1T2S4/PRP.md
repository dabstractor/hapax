# PRP — P1.M1.T2.S4 (plan 003): Query-interaction + perf regression verification (paths under the CURRENT matcher)

---

## Goal

**Feature Goal**: Pin — with regression tests, zero new features — the
query-interaction contract between rule-4d path candidates and the CURRENT
(prefix) matcher, and prove the widened literal window (80→96) did not break
the 800 KB ingest perf gate. This is the baseline the fuzzy anchor
(P1.M2.T1.S1: anchor matches first char of the TRIMMED key) and integration
items 6/7 (P1.M3.T4.S1, P1.M4.T1.S2) will be verified against.

**Deliverable**:
1. New/extended test cases pinning: (a) a stored path candidate surfaces
   when the user types the path's FIRST segment prefix (`sr` → key
   `src/core/query.ts` via `rankMatches`/`prefixRange`, insert display
   casing); (b) a path key is ONLY matchable by a prefix of the trimmed
   key before its first `/` (a fragment containing `/` can never match —
   the threshold regex excludes `/` and the stock gate disarms trigger
   fragments containing `/`); (c) `classifyStockContext` still owns
   every `/`-preceded cursor, including trigger-mode fragments with `/`
   and quoted paths, so pi's stock completion is untouched.
2. Re-run `test/perf-gates.test.ts`, `test/shipped-dict.test.ts`, and
   `npm run bench` and record numbers confirming the 800 KB ingest gate
   still holds (< 180 ms CI bound, ~56–65 ms measured floor). If the
   widened window breaks the bound, optimize WITHIN segment.ts pass 4
   keeping per-match work linear — never weaken the gate.

**Success Definition**: `npm run check` + `npm test` green including the
new pins; perf gate c green with headroom noted in a comment or the
research notes; no production behavior change (unless a real regression
is found and fixed per the perf-risk clause).

## IMPORTANT — nature of this item

**Verification-only.** P1.M1.T2.S1–S3 delivered path tokenization,
gating, and store flow; this item proves the query/delegation/perf
interaction under the CURRENT prefix matcher (`src/core/query.ts` —
`rankMatches` → `prefixRange`) before P1.M2 replaces it with anchored
fuzzy matching. Do not build new features; write tests that become the
contract baseline.

Key mechanism (research note r2-path-candidates.md §6–7, mirrored in the
code):
- Threshold-mode fragment regex `/[A-Za-z][A-Za-z0-9_-]*$/`
  (`src/pi/provider.ts:105`, `extractMatchState`) admits no `/` — so
  typing inside a path yields at most the current segment... but
  `classifyStockContext` (provider.ts:115-160, `'path'` case ~153-156:
  a `/` earlier in `before` with a whitespace-free cursor tail) runs
  BEFORE fragment matching in the provider gate, so once any `/`
  precedes the cursor pi's stock file completion owns it. Net effect:
  paths surface at the FIRST segment only (`sr` → fragment `sr` →
  prefixRange hits key `src/core/query.ts`).
- Trigger-mode fragments CAN contain `/` (its regex excludes only
  whitespace + the trigger char): `#sr/co` would match trigger mode —
  but the stock path/quoted-path classification disarms it first. PIN
  this with a test so a future reordering can't silently change it.

## User Persona

**Target User**: pi users; implementers of P1.M2/P1.M3 who need a frozen
baseline.

**Use Case**: User types `sr` after a conversation mentioned
`src/core/query.ts` → hapax offers the whole path; Tab inserts
`src/core/query.ts` in display casing. User then types `src/co` → hapax
delegates entirely; pi's stock file completion appears.

**Pain Points Addressed**: silent drift of the stock-delegation gate
relative to fragment matching; perf regressions from the widened literal
window (history: two O(n²) regressions originated in segment pass 4).

## Why

- Spec §07 auto-open (PRD h2.44, last bullet): "Path-class candidates
  surface at a path's FIRST segment (`sr` → `src/core/query.ts`); once a
  `/` precedes the cursor, stock pi file completion owns the rest —
  unchanged."
- Spec §09 h2.56 items 6–7: stock path/slash/@ behavior identical to
  pi; conversational path completion at first segment. These are the
  acceptance items this PRP makes CI-executable.
- Spec §09 h2.58: 800 KB ingest < 60 ms (CI 180 ms). Gate c's measured
  floor is ~56–65 ms after ISSUE-4; the 80→96 window widening adds
  pass-4 matches and must not eat the ~2.8× headroom.

## What

### Success Criteria

- [ ] `sr` (typed at a word start, store holding key
      `src/core/query.ts`) returns that candidate from `rankMatches`
      with display outflow intact (`display: c.display`).
- [ ] No fragment containing `/` can ever produce a hapax match under
      threshold mode (regex pin) AND trigger-mode `/` fragments are
      disarmed by the stock gate (provider-level delegation test).
- [ ] Existing stock-context delegation tests still pass; add
      trigger-mode-`/`-fragment and path-candidate-present cases.
- [ ] Perf gate c green (3 runs, best-of-3, < 180 ms); numbers
      recorded. `shipped-dict.test.ts` green; `npm run bench` runs and
      gate c mean noted.
- [ ] `npm run check` + `npm test` green. No production code change
      unless a genuine regression is found (document it).

## All Needed Context

### Context Completeness Check

A fresh agent gets: exact regexes and gating order with file:line, the
store/query call path, existing test patterns to extend, perf gate
anatomy, and the optimization escalation clause — sufficient for one-pass
implementation.

### Documentation & References

```yaml
- file: src/pi/provider.ts
  why: extractMatchState threshold regex /[A-Za-z][A-Za-z0-9_-]*$/ (L105) — no '/' ever enters a threshold fragment;
        trigger regex (L91) — fragment excludes only whitespace + trigger char, '/' CAN appear;
        classifyStockContext (L115-160): slash → mention → quoted-path → path; 'path' case = lastIndexOf('/') + whitespace-free tail;
        provider gate order: classifyStockContext BEFORE extractMatchState (find it in createHapaxProvider getSuggestions).
  pattern: pure, line-local classifiers — call directly in unit tests
  gotcha: provider.ts may be named src/pi/provider.ts or the provider factory may live in src/pi/index.ts — RECON first (grep "classifyStockContext(" src/)

- file: src/core/query.ts
  why: rankMatches (L98+) lowercases prefix BEFORE prefixRange (L105 — prefixRange throws RangeError on uppercase);
        prefix-then-snapshot enumeration invariant (module doc L38-46); display outflow `display: c.display`
  pattern: call rankMatches(fragment, store) directly to assert surfacing
  gotcha: keys are already trimmed-lowercase (rule 4d); "sr" prefixes "src/core/query.ts" byte-lex fine ('/' = 0x2F sorts low, no special handling)

- file: src/core/segment.ts
  why: LITERAL_RE window {4,96} (L101), classifyPath guards (L208-260), pass-4 bounded-window perf lessons (L391, L403-420, L501)
  pattern: if perf breaks, optimize here — bounded windows, memoization precedent (IngestPipeline.#admitMemo)
  gotcha: two historical O(n^2) regressions came from per-token unbounded slices; keep per-match work LINEAR

- file: test/perf-gates.test.ts
  why: gate c (L165+, "ingest 800 KB"): makeSessionText, best-of-3, fresh store+pipeline per run, deterministic yield count;
        GATE-C LESSON comment documents the 56-65 ms floor and 180 ms bound rationale
  pattern: do NOT relax the bound; regression → fix the hot path

- file: test/provider-match.test.ts
  why: classifyStockContext describe (L330+) with exact cases ("src/roun" → "path", quoted-path L356); threshold/trigger describes to mirror
  pattern: extend this file with the interaction pins

- file: test/provider.test.ts / test/provider-live.test.ts
  why: provider-level delegation tests with a sentinel stock completion (L463+ "'\"src/roun' (quoted path) delegates", "'src/roun' (path) delegates")
  pattern: add trigger-mode '/' fragment delegation cases alongside

- file: test/query.test.ts
  why: rankMatches test patterns; add the path-surfacing cases here (or a new test/paths-query.test.ts if cleaner — follow file conventions)

- file: plan/003_bbac3b15e8d0/P1M1T2S4/research/r2-path-candidates.md (and siblings)
  why: §6-7 are this item's contract (query interaction + perf risk); if absent there, the same content lives in plan/003_bbac3b15e8d0/architecture/r2-path-candidates.md
  gotcha: research dir may share notes across S1-S4 — read the §6/§7 sections specifically

- file: plan/003_bbac3b15e8d0/P1M1T2S3/PRP.md
  why: S3 (running in parallel) delivers the store display flow your tests consume — store state via upsert(Sighting literals) is gate-agnostic
  gotcha: do not duplicate S3's store/bigram/debug pins; yours are QUERY + delegation + perf only

- spec: spec/04-tokenization-and-scoring.md rule 4d (L118-174; L162-166 first-char surface);
        spec/07-completion-ui.md trigger modes + auto-open delegation bullets;
        spec/09-testing-and-acceptance.md perf gates table + integration items 6-7
```

### Current Codebase tree (relevant slice)

```bash
src/core/segment.ts    # S1: path tokens, window {4,96}
src/core/shapeGate.ts  # S2: path-class cap 4-96
src/core/store.ts      # S3-verified store; prefixRange byte-lex
src/core/query.ts      # CURRENT prefix matcher (rankMatches/prefixRange) — retired only in P1.M2
src/pi/provider.ts     # extractMatchState + classifyStockContext + provider factory (gate order!)
test/query.test.ts test/provider-match.test.ts test/provider.test.ts
test/perf-gates.test.ts test/shipped-dict.test.ts test/bench/
```

### Desired Codebase tree with changes

```bash
test/query.test.ts            # + describe: path candidates under the prefix matcher (first-segment surfacing)
test/provider-match.test.ts   # + threshold fragment can never contain '/'; classifyStockContext cases for trigger-fragments-with-'/'
test/provider.test.ts         # + provider-level: '#sr/co' (trigger fragment with '/') delegates; path candidate present + 'src/co' delegates
test/perf-gates.test.ts       # numbers comment update only if headroom changed (no bound change)
plan/003_bbac3b15e8d0/P1M1T2S4/research/perf-notes.md  # recorded bench/gate numbers
# src/ — UNCHANGED unless a genuine perf regression or delegation defect is found (then: minimal fix, documented)
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL: prefixRange throws RangeError on non-lowercase — rankMatches lowercases for you; raw prefixRange calls in tests must pass lowercase.
// CRITICAL: gate ORDER is the pin: classifyStockContext must run before extractMatchState. A test where '#sr/co' (trigger mode matches, '/' in fragment) STILL delegates proves the order holds.
// CRITICAL: perf gate c is best-of-3 with fresh store+pipeline per run — replicate exactly when re-measuring; sibling-file parallelism (acceptance's `pi -p` subprocess) adds noise the best-of-3 absorbs.
// CRITICAL: never weaken a perf bound to pass; escalate to segment.ts pass-4 optimization (linear per-match work, bounded windows, memo like #admitMemo).
// CRITICAL: threshold regex also admits hyphens but NOT '/', '.', '@' — 'sr.co' is not a threshold fragment either (falls to stock path context via '.'? no — only '/' triggers path class; 'sr.co' with no '/' is a word fragment 'co'... verify against the regex, don't guess: pin only what the regex actually does).
// Imports use .js extensions (ESM/NodeNext). Tests: vitest, `import { describe, expect, it } from "vitest"`.
// Store construction: upsert Sighting literals (key, display, ordinal: store.nextOrdinal(), fromUser, properName, rankGroup: 1, isSubword: false) — see test/store.test.ts helpers.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: RECON
  - READ src/pi/provider.ts (extractMatchState, classifyStockContext, and the
    getSuggestions gate order in the provider factory — grep createHapaxProvider),
    src/core/query.ts (rankMatches), test/query.test.ts, test/provider-match.test.ts,
    test/provider.test.ts (delegation sentinel pattern), test/perf-gates.test.ts (gate c).
  - CONFIRM S1/S2 landed (path tokens gated in) and S3's store tests green; construct store
    state directly via upsert where gate independence is safer.

Task 1: QUERY pins in test/query.test.ts (or new test/paths-query.test.ts following file style)
  - NEW describe "path candidates under the prefix matcher (rule 4d interaction, pre-fuzzy baseline)":
    - store with key "src/core/query.ts" (display "src/core/query.ts"); rankMatches("sr", store)
      → contains it; the returned RankedMatch.display === the display string (Tab inserts whole path).
    - absolute path key "home/dustin/projects/hapax" display "/home/dustin/projects/hapax":
      rankMatches("home/dus", store) matches (pre-first-slash prefix); display keeps leading '/'.
    - NON-matchability pin: rankMatches("sr/c", store) → empty (no candidate key contains a
      matchable mid-path fragment under the prefix matcher — a fragment with '/' can never
      prefix a key's first segment... actually verify: "sr/c" is not even producible by
      threshold mode; assert via the provider pin instead. Here assert: no fragment that
      includes '/' is reachable (regex pin belongs to Task 2); query-level: rankMatches("core", store)
      does NOT return the path (path components are absorbed, keys are whole-path)).

Task 2: FRAGMENT-REGEX + STOCK-GATE pins in test/provider-match.test.ts
  - NEW describe "path fragments never reach hapax matching":
    - extractMatchState(["edit src/co"], 0, 11, cfg) → null is NOT the right expectation if
      no '/'-gate applied — assert the ACTUAL current behavior chain: classifyStockContext(...)
      === "path" (it does: '/' with whitespace-free tail), so the provider delegates. Pin both
      primitives separately:
        expect(extractMatchState(["edit src/co"], 0, 11, defaultCfg)?.mode) — document what the
        threshold regex actually yields (fragment "co" — the regex takes the trailing identifier!),
        and expect(classifyStockContext(["edit src/co"], 0, 11)).toBe("path").
      THE PIN: even though threshold mode would match "co", the stock gate runs first → delegate.
    - Trigger-mode '/': extractMatchState(["#sr/co"], 0, 6, cfg) → {mode:"trigger", fragment:"sr/co"}
      (regex excludes only whitespace + '#') — pin this; then classifyStockContext(["#sr/co"],0,6)
      → "path" → provider delegates. Add the provider-level test in Task 3.
    - Quoted: classifyStockContext(["edit \"src/co"], 0, 12) → "quoted-path".
    - First-segment surfacing without slash: classifyStockContext(["edit sr"], 0, 8) → null
      (no '/' yet) — hapax owns it; that's WHERE the path offer happens.

Task 3: PROVIDER-LEVEL delegation pins in test/provider.test.ts
  - FOLLOW pattern: existing "'src/roun' (path) delegates" sentinel tests (L516, L528).
  - ADD: store seeded with path candidate "src/core/query.ts"; type "edit src/co" → provider
    returns pi's stock sentinel untouched (never the hapax path candidate).
  - ADD: "#sr/co" (trigger fragment containing '/') → delegates.
  - ADD: "edit sr" with the candidate seeded → hapax answer contains the path candidate
    (integration item 7 made CI-executable at the provider seam; live TTY version is P1.M3.T4.S1).

Task 4: PERF verification
  - npx vitest --run test/perf-gates.test.ts test/shipped-dict.test.ts
  - npm run bench  (gate c mean; note warm vs cold)
  - RECORD numbers in plan/003_bbac3b15e8d0/P1M1T2S4/research/perf-notes.md:
    gate a/b/c/d values, comparison to the ~56-65 ms floor and 180 ms bound.
  - IF gate c fails (any of the 3 best-of runs ≥ 180 ms): profile segment.ts pass 4;
    optimize with linear per-match work (bounded windows / memo precedent). NEVER touch the
    bound. Document the fix in perf-notes.md.

Task 5: FULL VALIDATION
  - npm run check; npm test (full suite — catches cross-file interactions with S3's parallel work)
```

### Implementation Patterns & Key Details

```typescript
// Task 1 pattern:
const store = new CandidateStore();
store.upsert({ key: "src/core/query.ts", display: "src/core/query.ts",
  ordinal: store.nextOrdinal(), fromUser: false, properName: false,
  rankGroup: 1, isSubword: false });
const m = rankMatches("sr", store);
expect(m.some((r) => r.key === "src/core/query.ts" && r.display === "src/core/query.ts")).toBe(true);

// Task 2 pattern — pin BOTH primitives and the ORDER:
const cfg = { ...DEFAULT_CONFIG }; // follow existing tests' config construction
const ms = extractMatchState(["edit src/co"], 0, 11, cfg);
const sc = classifyStockContext(["edit src/co"], 0, 11);
expect(sc).toBe("path"); // this wins → delegate, whatever ms is

// Task 3 pattern — reuse the existing provider-test sentinel (see test/provider.test.ts L463+)
```

### Integration Points

```yaml
NONE (structural). This PRP lands tests + recorded numbers only.
  - P1.M2.T1.S1 (fuzzy anchor) must keep Tasks 1-3 pins green EXCEPT the matcher-specific
    assertions (they are the baseline the rewrite is validated against — expect to re-derive,
    not weaken).
  - P1.M3.T4.S1 / P1.M4.T1.S2 reference these pins as the CI-executable half of integration
    items 6-7.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/query.test.ts test/provider-match.test.ts test/provider.test.ts
npm test
```

### Level 3: Perf Gates

```bash
npx vitest --run test/perf-gates.test.ts test/shipped-dict.test.ts
npm run bench
# Expect: gate c best-of-3 < 180 ms with ~2.8x headroom over the ~56-65 ms floor.
# Record actual numbers in research/perf-notes.md.
```

### Level 4: Domain-Specific

None beyond Level 3 — live TTY verification of path completion is
P1.M3.T4.S1's binding job.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean; `npm test` green (full suite)
- [ ] perf-gates + shipped-dict green; bench gate c numbers recorded
- [ ] No perf bound weakened; any src/ change documented as a genuine fix

### Feature Validation

- [ ] `sr` surfaces the whole-path candidate with display casing at the query seam
- [ ] `/`-preceded cursors delegate (threshold, trigger-with-slash, quoted) even with path candidates seeded
- [ ] First-segment-only surfacing pinned (no mid-path component ever matches)
- [ ] Gate order pinned: classifyStockContext before extractMatchState

### Code Quality Validation

- [ ] New tests follow existing describe/it style and helper patterns
- [ ] No duplication of S3's store/bigram/debug pins; no scope creep into P1.M2's matcher rewrite

## Anti-Patterns to Avoid

- ❌ Don't implement the fuzzy matcher early — this item verifies the CURRENT one
- ❌ Don't relax perf bounds to go green — optimize pass 4 instead
- ❌ Don't guess regex behavior — run extractMatchState on each probe string and pin what it actually returns
- ❌ Don't test path-internal components as matchable keys — rule 4d absorbs them
```

**Confidence Score: 8/10** — mechanisms are pinned to file:line and the
tests are additive; residual risk is S2/S3 landing state (mitigated by
gate-agnostic store construction) and provider-file location drift
(mitigated by Task 0 recon).
