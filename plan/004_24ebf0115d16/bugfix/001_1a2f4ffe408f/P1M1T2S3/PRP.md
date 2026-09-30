# PRP — P1.M1.T2.S3 (bugfix 001_1a2f4ffe408f): End-to-end widget chain tests, live TTY verification, and spec/07 clarifying clause

---

## Goal

**Feature Goal**: Close BUG-001 by pinning the complete widget-path chain flow
end-to-end — Tab-accept arms, zero-typed-char successor offer renders on the
widget line, one-shot grant disarms, re-arm on acceptance, stock contexts and
trigger chars win over armed chains, `enableChaining:false` inert — verified
BOTH through unit tests on the composed widget proxy AND live in a real TTY
per the binding spec/09 technique, with the spec/07 M2 clarifying clause
landing in the same change (AGENTS.md spec-sync policy).

**Deliverable**:
- `test/widget.test.ts`: new end-to-end describe(s) composing
  `createWidgetEditorFactory` over a stateful fake inner editor covering the
  PRD §Issue-1 repro sequence plus the seven behavior pins listed below.
- Live TTY verification run (tmux, per spec/09:179-196) with results recorded;
  all temporary instrumentation removed before commit.
- `spec/07-completion-ui.md`: ONE clarifying clause after the "Chain offers
  render on the widget line (or fallback menu)" bullet (~line 472) — on the
  widget path, arming happens at the widget's Tab-insert (the applyCompletion
  equivalent) and successor offers publish through the visibility machine's
  intent bypass.

**Success Definition**: `npm run check` + full `npm test` green with every
fallback-path canary suite untouched (see Must-Keep list); the PRD repro
sequence passes live in tmux; spec clause lands in the same commit; BUG-001
(the M2 goal on the PRIMARY path, spec/01 goal 7) is closable.

## CRITICAL — upstream contracts this item consumes

1. **T1 (COMPLETE, commits fc08633/fef3e54/2a595cf)**: `insertHighlighted`
   arms `opts.chain` on whole-word Tab accepts using the painted record's
   store key; chain-shim records carry `description: "chain"`, plain store
   keys, and `tier: undefined` (which the accept gate treats as armable).
   Pinned by the classification matrix at test/widget.test.ts:1117.
2. **T2.S1 (COMPLETE)**: the visibility machine's chain consult branch
   (src/pi/widget.ts ~L665-748): when armed, the chain answers BEFORE the
   normal query; `chainIntent` true bypasses hesitation (R5); empty successor
   set → `chain.reset()` + fall through (zero-candidate invariant). Partially
   pinned at test/widget.test.ts:1280-1349 (paint + re-arm, fragment filter).
3. **T2.S2 (IN FLIGHT — treat its PRP as a contract)**:
   `src/pi/chain-grant.ts` exports `createChainGrantTracker()` with
   `tick(prefix): boolean` (true = grant spent → caller chain.reset() +
   fall through) and `reset()`; provider.ts refactored byte-identically;
   the widget path consumes the same tracker. READ
   `plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/P1M1T2S2/PRP.md` before
   writing tests. If S2 has not landed when you start, write your one-shot
   tests against the BEHAVIOR (typed-through offer disarms at next word
   boundary) using the real composed proxy — they must pass unchanged once
   S2 lands; coordinate sequencing with the orchestrator if blocked.

Your job is the LAST slice: end-to-end composition tests, live verification,
and the spec clause. Do NOT re-implement arming, the consult branch, or the
grant tracker.

## User Persona

**Target User**: pi users with editor-factory extensions (pi-vim,
split-editor) — the widget PRIMARY path — who accepted a word and expect its
most-likely successor offered for zero-additional-typing Tab completion
(spec/01 goal 7).

**Use Case / Journey**: type `zorp` → widget line shows `Zorp`/`ZorpWibble` →
Tab inserts `Zorp` (chain arms at `zorpwibble`) → space → widget line shows
`Quuxblat` at zero typed chars → Tab inserts it and re-arms.

**Pain Points Addressed**: before this changeset the chain never armed on the
widget path at all (BUG-001); this item proves the fix holds end-to-end and
live, which unit-only verification historically failed to do (spec/09: the
v1 proxy crash precedent).

## Why

- PRD BUG-001 (h2.2/h3.0): M2 chaining was structurally dead on the widget
  PRIMARY path; the fix spans T1 arming + T2.S1 consult + T2.S2 grant; S3 is
  the acceptance proof + the spec-sync the repo's binding policy requires.
- spec/09:179-196 makes live TTY verification BINDING for UI-layer changes —
  "unit tests have repeatedly encoded wrong platform models".
- AGENTS.md: interactive sessions MUST keep spec and code in agreement; the
  clarifying clause records where widget-path arming and publish happen.

## What

### Behavior pins (each = at least one test case)

1. **PRD repro end-to-end**: seed store (upsert ×2 + `recordBigramRuns`
   [["zorpwibble","quuxblat"]] twice → `topSuccessors("zorpwibble") ===
   [{next:"quuxblat",count:2}]`); compose factory over a stateful fake inner
   editor; type `zorp` → line visible with candidates; Tab → word inserted
   AND `chain.state()` reflects the accepted key; space → zero-typed-char
   offer `Quuxblat` VISIBLE on the widget line at the empty word start.
2. **Tab on the offer** inserts exactly one word (buffer gains one word, not
   two) and re-arms at the successor's key (chain.arm called with
   `quuxblat`-style plain key).
3. **One-shot grant end-to-end**: typing THROUGH the offer (not Tab) disarms
   at the next word boundary; the normal gated path answers that same
   keystroke; no successor offers pop at subsequent word starts.
4. **Stock context wins**: an armed chain overlapping a `/cmd`, `@mention`,
   or path context NEVER offers (R1 `classifyStockContext` stays ahead of
   the consult branch — provider.ts:308 parity; fallback pin at
   test/provider-live.test.ts:424-443).
5. **Trigger char wins over a glued chain fragment**: typing `#` mid-armed
   offer yields trigger mode, not the chain set.
6. **`enableChaining:false`**: every new branch inert — no arm on accept, no
   consult, no offer (parity with test/chaining-gating.test.ts fallback
   cases at :203/:254/:281).
7. **Zero-candidate invariant**: armed word with NO successors → chain
   resets, line stays hidden, normal path proceeds; the line never renders
   with zero candidates.
8. **Multi-successor ordering**: offers ordered count-descending and capped
   at ≤ maxSuggestions (seed 2+ successors with different counts).

### Success Criteria

- [ ] All 8 pins above green through the composed proxy
- [ ] All Must-Keep canary suites green UNCHANGED
- [ ] Live tmux verification of the repro sequence recorded
- [ ] spec/07 clause added; instrumentation removed; `npm run check` +
      `npm test` green

## All Needed Context

### Context Completeness Check

An implementer with no prior knowledge gets: the upstream contracts
(T1/T2.S1 done, T2.S2's PRP as contract), the exact existing test fixtures to
reuse, the exact spec anchor and clause text, the binding live-TTY recipe,
and the canary list — sufficient for one pass.

### Documentation & References

```yaml
- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/r1-chain-widget.md
  why: §Tests (must-change/must-keep lists), §Spec citations & drift, §Risks (zero-candidate invariant, stock-context ordering, BUG-003 interaction)
  section: "## Tests: must-change vs must-keep-passing" onward
  critical: tier-0 never arms; trigger-mode accepts arm too; armed chain never overrides stock contexts

- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/architecture/system_context.md
  why: §Spec-sync obligations table (this subtask's spec/07 clause verbatim), §Verification norms, §Documentation targets
  critical: "UI-layer subtasks additionally need live TTY verification per spec/09"

- docfile: plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/P1M1T2S2/PRP.md
  why: the in-flight one-shot grant tracker contract (createChainGrantTracker) your tests exercise end-to-end

- file: src/pi/widget.ts
  why: consult branch ~L665-748 (chain answers first, chainIntent bypass, reset-on-empty), chainShim ~L538, arming seam ~L1163, VisibilityMachineDeps.chain ~L359-374
  pattern: read-only for this item — tests only; do not modify unless a pin fails and the defect is provably in the machine
  gotcha: shims OMIT tier (undefined ⇒ armable); description "chain" is the provenance marker

- file: test/widget.test.ts
  why: reuse existing fixtures — spiedChain(), seedStore(), makeInsertHarness (L648+ live-buffer recording inner editor with getLines/getCursor/setText/setCursorCol), flushPaint()
  pattern: the :1280-1349 describe already covers paint+re-arm and fragment filtering — ADD the missing pins (one-shot end-to-end, stock context, trigger char, enableChaining:false, zero-candidate, count order, full repro typing sequence), don't duplicate existing ones
  gotcha: forwarded keystrokes tick the machine (W1); consumed Tab does not — clear innerCalls before asserting consumption

- file: test/chain.test.ts
  why: fallback-path reference pins at :260 (zero-char offer), :291/:324 (one-shot), :356/:391 (filtering), :405/:421 (disqualification), :454 (re-arm), :516 (reset), :533 (trigger-mode arming), :585 (one-word invariant), :651 (fuzzy membership gate) — mirror their SEMANTICS through the widget proxy; do not edit them

- file: test/provider-live.test.ts
  why: :424-443 armed chain loses to stock contexts — the fallback pin your widget stock-context case mirrors

- file: test/chaining-gating.test.ts
  why: :203/:254/:281 enableChaining:false never arms/offers — mirror for the widget path

- file: spec/07-completion-ui.md
  why: M2 section ~L437-476; insert the clarifying clause after the "Chain offers render on the widget line (or fallback menu)" bullet (~L472)
  gotcha: MODE A only — one clause; README sweep is deliberately P1.M2.T4 (Mode B)

- file: spec/09-testing-and-acceptance.md
  why: L179-196 live verification technique (binding) — the exact tmux recipe
```

### Current Codebase tree (relevant slice)

```bash
src/pi/widget.ts        # T1+T2.S1 landed: arming, consult branch, chainIntent bypass
src/pi/chain-grant.ts   # T2.S2 (in flight): shared one-shot grant tracker
src/pi/provider.ts      # fallback path — refactored by S2, byte-identical
spec/07-completion-ui.md  # M2 section gains one clarifying clause
test/widget.test.ts       # + end-to-end chain describes (this item)
```

### Known Gotchas of our codebase & Library Quirks

```python
# CRITICAL: tmux send-keys ONE CHAR AT A TIME with 0.08–0.12s sleeps — bursts cancel in-flight autocomplete queries (spec/09).
# CRITICAL: pi --no-session inside a tmux pane; piped stdout makes pi exit silently.
# CRITICAL: instrumentation = appendFileSync behind an env var, sanctioned; REMOVE before committing.
# CRITICAL: on the widget path there is NO forced single-item getSuggestions fast path — Tab at zero chars completes via decideWidgetKey "tab-insert" once the line is visible.
# CRITICAL: armed chains never fire during restore (restore-gate parity) — don't write a test that expects offers mid-replay.
# CRITICAL: index.ts guarantees widget/provider mutual exclusivity; the shared chain instance is reset in before_agent_start (spec/07:475) — free on the widget path.
# Imports use .js extensions (ESM/NodeNext).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: RECON
  - READ src/pi/widget.ts consult branch + arming seam; test/widget.test.ts
    fixtures (spiedChain, seedStore, makeInsertHarness, flushPaint, the :1117
    matrix and :1280 describe); P1M1T2S2/PRP.md; verify whether src/pi/chain-grant.ts landed.

Task 1: CREATE end-to-end repro describe in test/widget.test.ts
  - NEW describe "widget chain end-to-end — BUG-001 acceptance (PRD §Issue 1 repro)":
  - CASE 1 (repro): seed, compose, type "zorp" (press per char), Tab, assert
    inserted word + chain armed at accepted key; then space → zero-char offer
    visible; Tab on offer → exactly one word inserted + re-armed at successor key.
  - CASE 2 (one-shot): same seed; type through the offer to the next word
    boundary; assert disarm (no offer at subsequent word starts; normal path
    answers the boundary keystroke). Consume S2's tracker through the real
    factory wiring — no direct tracker unit tests here (S2 owns those).
  - CASE 3 (stock context): armed chain + cursor inside "/cmd", "@name", or a
    path → NO chain offer (visible false or normal gating, never the chain set).
  - CASE 4 (trigger char wins): armed chain live, type "#" → trigger-mode set,
    not the chain set.
  - CASE 5 (enableChaining:false): full repro sequence with config disabled →
    no arm on Tab, no offer at word start, zero new behavior.
  - CASE 6 (zero-candidate invariant): arm at a word with NO successors →
    chain.reset() called, line never renders empty.
  - CASE 7 (count order + cap): two/three successors with distinct counts →
    offers count-desc, length ≤ maxSuggestions.

Task 2: RUN suites + canaries
  - npx vitest --run test/widget.test.ts test/chain.test.ts test/chaining-gating.test.ts test/provider*.test.ts test/widget-visibility.test.ts test/successors.test.ts
  - npm test — full suite green (baseline 1053 passed / 1 skipped, may grow).
  - IF a pin fails because the machine (not the test) is wrong: minimal fix in
    src/pi/widget.ts, document in the commit, re-run canaries.

Task 3: SPEC SYNC — spec/07-completion-ui.md
  - LOCATE the bullet beginning "Chain offers render on the widget line (or
    fallback menu)" in the M2 section (~L472).
  - APPEND one clarifying clause/bullet immediately after, wording (adapt to file style):
    "On the widget path, arming happens at the widget's Tab-insert (the
    applyCompletion equivalent) and successor offers publish through the
    visibility machine's intent bypass."
  - NO other spec edits (Mode A only; README sweep is P1.M2.T4).

Task 4: LIVE TTY VERIFICATION (binding, spec/09:179-196)
  - tmux new-session; run `pi --no-session` in the pane (a debug/config path
    enabling the widget may be needed — the widget path activates when an
    editor factory extension is installed; use the repo's existing live-test
    setup if scripted, e.g. plan/004 validate.sh conventions).
  - Seed: submit one short user message containing a repeated bigram twice
    (e.g. "zorpwibble quuxblat mode. zorpwibble quuxblat again."), Ctrl+C the turn.
  - Drive: tmux send-keys one char at a time (0.08–0.12s sleeps): type "zorp",
    Tab, space; capture-pane after each step; assert the widget line shows the
    successor offer at the empty word start; Tab inserts it.
  - Optional instrumentation: appendFileSync behind an env var in src/pi/widget.ts
    to log chain state — REMOVE before committing.
  - RECORD results (verification transcript/summary appended to
    plan/004_24ebf0115d16/bugfix/001_1a2f4ffe408f/TEST_RESULTS.md or the commit
    message — match the repo's existing convention; TEST_RESULTS.md exists).

Task 5: FINAL validation + cleanup
  - grep instrumentation removed: git diff must show no appendFileSync/console debug.
  - npm run check && npm test.
  - Commit code+tests+spec together (spec-maintenance policy).
```

### Implementation Patterns & Key Details

```typescript
// Existing fixtures to reuse (test/widget.test.ts):
// spiedChain() — ChainMachine mock with vi.fn arm/state/reset
// seedStore([[key,display],...]) — real CandidateStore with upserts
// makeInsertHarness({lines, line, col}, {chain, store, config}) — composed
//   factory over the live-buffer fake inner editor; h.press(key), h.buf.lines,
//   h.state.hidden, h.innerCalls, h.machine.getState()/painted()
// await flushPaint() after forwarded keystrokes (async paint tick)

// Stock-context pin pattern: position cursor inside "/cmd " (col at fragment),
// assert machine set is NOT the chain set (or visible false per R1 semantics)
// — mirror provider-live.test.ts:424-443 expectations.
```

### Integration Points

```yaml
SPEC:
  - spec/07-completion-ui.md M2 section: +1 clarifying clause (Task 3)
DOCS:
  - README sweep deliberately deferred to P1.M2.T4 (Mode B) — do not touch README here
CODE:
  - no production changes expected; minimal machine fixes only if a pin exposes a real defect
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests (component + canaries)

```bash
npx vitest --run test/widget.test.ts
npx vitest --run test/chain.test.ts test/chaining-gating.test.ts test/provider.test.ts test/provider-live.test.ts test/provider-display.test.ts test/provider-match.test.ts test/widget-visibility.test.ts test/successors.test.ts
npm test   # full suite, zero regressions
```

### Level 3: Live TTY Integration (binding)

```bash
tmux new-session -d -s hapaxbug001 'pi --no-session'
# seed via send-keys + Enter; Ctrl+C the turn
# drive: for ch in z o r p; do tmux send-keys -t hapaxbug001 "$ch"; sleep 0.1; done
# tmux send-keys -t hapaxbug001 Tab; sleep 0.3; tmux send-keys -t hapaxbug001 Space; sleep 0.3
tmux capture-pane -t hapaxbug001 -p   # assert successor offer on the widget line
tmux send-keys -t hapaxbug001 Tab; sleep 0.3; tmux capture-pane -t hapaxbug001 -p  # inserted
tmux kill-session -t hapaxbug001
```

### Level 4: Domain-Specific Validation

```bash
# Zero-candidate + gating assertions are unit-level (Task 1 cases 5-7).
# Instrumentation sweep before commit:
grep -rn "appendFileSync\|console.log" src/pi/   # expect no debug residue
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean; `npm test` green (baseline + new cases, zero regressions)
- [ ] Canary suites byte-unchanged expectations (chain/chaining-gating/provider*)

### Feature Validation

- [ ] All 8 behavior pins green through the composed proxy
- [ ] PRD repro verified LIVE in tmux; results recorded; instrumentation removed
- [ ] spec/07 clause lands with the code (same commit)

### Code Quality Validation

- [ ] New tests reuse existing fixtures; no fixture duplication
- [ ] No README edits (deferred to P1.M2.T4)
- [ ] No production-code changes unless a pin exposed a proven defect (documented)

## Anti-Patterns to Avoid

- ❌ Don't re-implement arming/consult/grant-tracker — they are T1/T2.S1/T2.S2 contracts
- ❌ Don't send multi-char bursts via tmux send-keys — bursts cancel in-flight queries
- ❌ Don't weaken or edit fallback canary suites to make widget cases pass
- ❌ Don't skip the live TTY step — spec/09 makes it binding for UI-layer changes
- ❌ Don't leave instrumentation in the commit
- ❌ Don't sweep README/docs beyond the one spec clause (Mode B is P1.M2.T4)
```

**Confidence Score: 8/10** — upstream T1/T2.S1 are landed and partially pinned;
the main risk is S2's landing timing (mitigated by behavior-level one-shot
tests that survive either sequencing) and live-TTY environment variance
(the spec's own recipe is included verbatim).
