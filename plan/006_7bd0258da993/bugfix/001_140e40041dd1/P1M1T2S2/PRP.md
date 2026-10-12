# PRP — P1.M1.T2.S2 (bugfix 001_140e40041dd1): Widget-path typed-arming e2e, /acwords '(series)' markers, and the live TTY spot-check

---

## Goal

**Feature Goal**: Complete the production-composition acceptance layer for
BUG-001 on the **widget path**: through the REAL `hapax` factory with
`fakeCtx({editorFactory})`, a capitalized-run history (`The Fed raised
rates today`) must yield typed-word chain arming (`typing 'T','h','e',' '`
through the composed editor arms `{word:'the'}`) with the successor offer
carrying run casing `Fed` (nextDisplay). Plus (b) the /acwords `(series)`
marker proof on the widget branch, and (c) the BINDING live TTY
spot-check (spec/09 technique) verifying the real stack.

**Deliverable**:
- New describe in `test/index.test.ts` (widget-path e2e), reusing S1's
  harness conventions (`seriesSession`-style setup, `makeInsertHarness` /
  `typeChar` typing pattern from test/widget.test.ts:≈852/:2000-2008).
- /acwords widget-branch marker case.
- Live TTY evidence recorded (run notes / test-file comment).

**Success Definition**: Widget arming fires and the offer contains run-cased
`Fed` through the real factory; `/acwords` dump shows `the → fed ×1
(series)`; the tmux capture shows the `Fed` offer in a real pi session;
`npm run check` + `npm test` green; spec/*.md untouched (drift recorded for
P2.M2.T2.S2 instead).

## Why

- S1's composition layer covers the FALLBACK path only (its scope line:
  "T2.S2 owns the widget path"). The widget branch is PRIMARY whenever any
  editor extension installs — the BUG-001 verification itself ran "typing
  'The ' leaves the chain state null" through exactly this composition.
- The PRD recommends an end-to-end production-wiring layer "rather than
  fabricating stores"; both majors survived the 1286-test suite because
  every test built its own store.
- Live TTY verification is BINDING for UI-layer changes (spec/09); no test
  mocks are permitted there — it exists precisely to verify the real stack.

## What

### (a) Widget-path typed-arming e2e (test/index.test.ts)

New describe `index.ts e2e — series pipeline through the real factory
(widget path)`:

- Compose the real extension with `fakeCtx({ editorFactory })` — a
  factory-shaped editor (see architecture map §fakeCtx :110–152) so
  index.ts:281–336 takes the `createWidgetEditorFactory` branch.
- Ingest `'The Fed raised rates today'` via `message_end` + settle
  (S1's `vi.waitFor` dump-poll pattern; temp dict with `the` at top-band if
  needed so `the` is chain-only — match S1's `useDict` fixture).
- Drive the composed editor: type `'T','h','e',' '` one tick each
  (`makeInsertHarness`/`typeChar` pattern: advance the live buffer at the
  caret, press the char, let the W1 microtask evaluate the NEW state).
- Assertions:
  1. **Arming (timing-independent)**: chain state is `{word:'the'}` — the
     arming gate (widget.ts:1021, `topSuccessors('the').some(s => s.series)`)
     is live through the production seam.
  2. **Offer content**: the successor set / painted offer contains `Fed`
     (run casing via nextDisplay — chainShim semantics), never bare `fed`.
  3. **Paint timing**: write the assertion to match whichever landed —
     pre-P2.M1.T1.S1 the widget paints on the NEXT tick; post-fix it paints
     at the space tick. Comment BOTH expectations at the assertion; if
     P2.M1.T1.S1 hasn't landed, assert next-tick and leave a pointer
     comment for its pin flip.

### (b) /acwords widget-branch marker

- With `debug` config enabled and the capitalized run ingested, `dump()`
  output must contain the `the → fed ×1 (series)` sample line
  (src/pi/debug.ts:134–135) with run casing visible — the marker that never
  rendered under the stale shim. Distinct from S1's case (a), which runs
  the fallback branch; this runs the widget branch.

### (c) Live TTY spot-check (BINDING; no mocks)

Per spec/09's live verification technique and repo-governance §3:
- tmux pane, ephemeral `pi --no-session` with hapax loaded.
- Seed `'The Fed raised rates today'` as a user message (submit), Ctrl+C to
  a fresh prompt, then type `'The '` ONE key at a time with 0.08–0.12 s
  sleeps (bursts cancel in-flight queries).
- `capture-pane`: the `Fed` offer must appear (widget path).
- If instrumentation is needed, `appendFileSync` behind an env var is the
  sanctioned precedent (src/pi/provider.ts) — REMOVE before commit.
- Record the capture result in a run note or test-file comment. If reality
  drifts from spec 07 M2 wording, record it for P2.M2.T2.S2's drift report;
  never edit spec/*.md.

### Success Criteria

- [ ] Widget e2e: arming `{word:'the'}` + offer `Fed` (run casing) through the real factory
- [ ] Paint assertion matches the landed timing state, with both expectations documented
- [ ] /acwords widget-branch dump shows `(series)` marker + run casing
- [ ] tmux capture shows the `Fed` offer in a real pi session; evidence recorded; instrumentation removed
- [ ] `npm run check` + `npm test` green; no spec/*.md edits; no source changes (test-only)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they implement this
successfully?" — Yes: the S1 harness contract, the widget typing pattern
with anchors, the fakeCtx widget-branch mechanism, the marker site, the
arming gates, the timing caveat, and the full TTY technique are specified.

### Documentation & References

```yaml
- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P1M1T2S1/PRP.md
  why: CONTRACT (parallel): fallback-path composition describe with
        seriesSession/composeProvider helpers and cases (a)-(d); its scope
        line fences the widget path to THIS task. Reuse its helpers verbatim
        where possible (wired/useDict/enableDebug/userMsg/acwordsHandler/
        dump/settle/vi.waitFor).
- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/bug001-series-pipeline.md
  section: §6 + harness map (fakeCtx :110-152)
  why: fakeCtx({editorFactory}) drives the widget branch (index.ts:281-336);
        ctx editor-factory shape needed for the widget composition.
- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/repo-governance-and-conventions.md
  section: §3
  why: the BINDING live TTY technique: pi --no-session in tmux, send-keys
        one char with 0.08-0.12s sleeps, capture-pane asserts;
        appendFileSync-behind-env-var instrumentation precedent.
- files: test/widget.test.ts (makeInsertHarness ≈:852; typeChar pattern
        :2000-2008 — advance buffer at caret, press char, W1 microtask
        evaluates), test/index.test.ts (S1's describe to extend beside)
  why: the two harness conventions this suite fuses.
- files: src/pi/index.ts (:281-336 widget branch), src/pi/widget.ts (:1021
        arming gate), src/pi/provider.ts (:597-608 typed arming, fallback),
        src/pi/debug.ts (:134-135 series marker)
  why: the production sites being proven; read-only for this task.
- PRD h3.0 (BUG-001 repro step 5: "typing 'The ' ... arms {word:'the'} +
  paints 'Fed' with the enriched wiring") — the exact behavior to pin.
```

### Current Codebase tree (relevant)

```bash
test/index.test.ts        # S1's fallback describe + THIS widget describe
test/widget.test.ts       # makeInsertHarness / typeChar conventions
src/pi/{index,widget,provider,debug}.ts   # read-only sites under proof
```

### Desired Codebase tree

```bash
test/index.test.ts        # + widget-path describe (arming e2e + /acwords marker)
# + live TTY evidence in run notes / test comment (no new file required)
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: keep the ARMING assertion independent of paint timing — the
// offer paint is BUG-003 territory (P2.M1.T1); assert chain state first,
// paint second, with the landed-timing comment at the paint assertion.

// CRITICAL: the widget branch requires ctx.editorFactory to be a
// factory-shaped editor (fakeCtx default undefined → fallback path) —
// mirror what the architecture map documents for the shape.

// GOTCHA: typing bursts cancel in-flight queries — one char per tick,
// await the W1 microtask between presses (the typeChar pattern).

// GOTCHA: 'the' must be dictionary top-band (chain-only) or ordinary —
// either way the pair 'the fed' forms via the enriched wire; match S1's
// useDict fixture so both suites tell the same story.

// GOTCHA: live TTY — mock NOTHING; remove any appendFileSync
// instrumentation before commit; record drift, never edit spec/*.md.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: ADD widget-path describe to test/index.test.ts (red)
  - Widget composition via fakeCtx({editorFactory}); S1's settle pattern;
    typeChar sequence 'T','h','e',' '; assertions (a) arming
    (timing-independent), (b) offer contains 'Fed' run casing, (c) paint
    with dual-expectation comment.
Task 2: ADD /acwords widget-branch marker case (dump → /the\s*→\s*fed\s*×1\s*\(series\)/i).
Task 3: RUN live TTY spot-check per the technique; record capture evidence;
  remove instrumentation.
Task 4: VALIDATE — npm test -- test/index.test.ts; full npm test; check.
```

### Integration Points

```yaml
TESTS: test/index.test.ts (extends S1's composition layer)
READ-ONLY: src/pi/{index,widget,provider,debug}.ts
DOWNSTREAM: P2.M1.T1.S2 (space-tick paint TTY — sibling, distinct focus);
  P2.M2.T2.S2 (drift report receives any TTY findings)
FROZEN: spec/*.md (read-only for pipeline agents)
```

## Validation Loop

### Level 1–2

```bash
npm run check
npx vitest --run test/index.test.ts
npm test
```

### Level 3: Live TTY (binding)

```bash
# tmux new-session; pi --no-session (hapax loaded); type the seed message;
# Enter; Ctrl+C; then for k in T h e ' ' ; tmux send-keys $k; sleep 0.1; done
# tmux capture-pane -p | grep -i fed     → offer must appear
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green; test-only diff
- [ ] Widget arming `{word:'the'}` + run-cased `Fed` offer through real factory
- [ ] Paint assertion matches landed timing, both expectations documented
- [ ] /acwords widget-branch `(series)` marker + run casing pinned
- [ ] TTY capture evidence recorded; instrumentation removed; no mocks in the live check
- [ ] No spec/*.md edits; drift (if any) recorded for P2.M2.T2.S2

## Anti-Patterns to Avoid

- ❌ Duplicating S1's fallback-path cases on the widget branch without the
  widget-specific typing/arming mechanics
- ❌ Asserting paint timing unconditionally (BUG-003 fix in flight)
- ❌ Mocking anything in the live TTY check
- ❌ Editing spec/*.md instead of recording drift
- ❌ Leaving appendFileSync instrumentation committed
- ❌ Fabricating the store instead of composing through the real factory —
  that is the exact suite gap BUG-001 exploited

---

**Confidence Score: 8/10** — harness conventions, sites, and technique are
all pinned from the recon docs and sibling PRP; the deliberate
uncertainties (which timing fix has landed; the editor-factory shape for
fakeCtx) are resolved by documented conditional assertions and a
read-the-map instruction.
