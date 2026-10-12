# PRP — P2.M1.T1.S2: Live TTY verification of the space-tick paint (binding technique)

## Goal

**Feature Goal**: Produce the binding live-TTY proof that the P2.M1.T1.S1 fix (zero-char successor offer painting AT the space tick of typed-word arming) holds on the REAL stack — real TTY, real editor factory, real render pipeline — not just the unit harness. AGENTS.md: "UI-layer changes need live TTY verification, not unit tests alone"; spec/09 makes the technique binding and the live result ground truth.

**Deliverable**:
1. A run-notes file `plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/live-tty-bug003-run-notes.md` containing the verbatim `tmux capture-pane` transcripts proving: (a) the `Fed` offer line is visible immediately after the space keystroke of `"The "` (before any further input); (b) typing `F` narrows the offer without close+reopen; (c) Escape dismisses and forwards (invariant — no key consumed un-entered).
2. Any observed real-stack vs unit-harness divergence recorded in that file and routed to P2.M2.T2.S2 (the spec-drift report compiler) — NOT fixed here.
3. Proof instrumentation (if any was added) is removed: `git diff` clean of `appendFileSync`.

**Success Definition**: The three-step live sequence passes on the real stack with capture-pane evidence at each step; the run-notes file records the exact commands, sleeps, and captures (Mode A — rides with the verification); if any step diverges, the divergence is recorded verbatim and routed, with the item still delivering its artifact (the honest run note) rather than a forced pass.

## User Persona (if applicable)

**Target User**: The hapax owner (and the changeset's future auditors). Every prior suite-level test of this timing passed while the real TUI behavior was wrong (BUG-003 itself was found live/in composition, not by the unit suites — the bug-hunt overview records the unit harness masking it via a resolved `restoreReady` making `wakeEvaluate()` paint inside the test's microtask flush).

**Use Case**: Before accepting the BUG-003 fix, the owner runs (or re-runs) the documented tmux recipe and sees the offer appear at the space tick.

**Pain Points Addressed**: Unit harnesses encode wrong platform models (spec/09's own opening sentence); this item is the guard against accepting a timing fix that only works in the harness.

## Why

- **Binding rule**: spec/09 "Live verification technique (binding)" (:291-314) + AGENTS.md ("UI-layer changes need live TTY verification, not unit tests alone"). P2.M1.T1.S1's PRP explicitly ends at "green suite + code/comment contract" and defers the live verification to THIS item (its Level 4 section names this task and the technique).
- **The change is live-visible layout behavior**: the arming-site paint makes the space tick CLAIM the row (first offer of the prompt) or flip claimed-blank to content (architecture/bug003-004-widget-provider.md :145) — exactly the class of behavior capture-pane exists to check.
- **Drift detection**: the bug-hunt found the unit harness paints via a settle-wake microtask the real stack may not take at the same instant; only a live run can tell (see Divergence Protocol).

## What

This item changes NO production or test code (except: temporary sanctioned instrumentation, removed before commit; and an optional cross-reference comment in `test/widget-visibility.test.ts` near the flipped timing pins pointing at the run-notes file). It is a verification runbook + evidence artifact:

1. **Environment**: tmux pane (200×50, per the M1-DoD precedent) running `pi --no-session` (real TTY required — piping stdout makes pi exit silently). Config defaults suffice: `enableChaining: true`, `menuDelayMs: 0` (src/pi/config.ts :134-135), and chainIntent bypasses R5 hesitation anyway.
2. **Seed**: submit ONE short user message containing a capitalized run — `The Fed raised rates today` — then Ctrl+C the turn; wait out the 300 ms ingest debounce (sleep ≥ 0.5 s) so the the→Fed series successor lands in the real store through the production seam (BUG-001 fix makes the enrichment live).
3. **Probe sequence** (keys via `tmux send-keys`, ONE CHAR AT A TIME, 0.08–0.12 s sleeps — a whole-string burst cancels in-flight autocomplete queries, the documented false-conclusion source; uppercase literals like `T` send fine):
   - Type `T`, `h`, `e`, ` ` (paced).
   - **Capture A — immediately after the space keystroke, before ANY further key**: the offer line (`Fed` …, series-first, run casing) must be visible directly under the input line. This is the space-tick paint — the exact behavior BUG-003 denied.
   - Type `F`; **Capture B**: the narrowed offer persists (Fed still offered, filtered/ordered by `f`) — no flicker/close+reopen (park/swap narrowing, not close).
   - **Capture C — Escape**: the line dismisses; the forwarded Escape behaves as stock pi (invariant: un-entered generation, no key consumed; the in-flight request cancels as pi does natively).
4. **Divergence Protocol** (binding): if the real stack diverges from the unit harness at any step — e.g. the offer paints only after `F` (the pre-fix symptom), the W1 microtask/render timing differs in a real TTY, or the paint lands but the row-claim layout behaves oddly — STOP that scenario, record the divergence VERBATIM (captures + what the unit harness predicted), and route it to P2.M2.T2.S2. Do NOT force the test, do NOT patch code in this item. The live result is ground truth per spec/09.
5. **Instrumentation policy**: prefer capture-pane only (the M1-DoD live smoke needed zero instrumentation). If internal state is needed to diagnose a divergence, `appendFileSync` behind an env var in `src/pi/provider.ts` is the sanctioned probe — it MUST be removed before the item completes (`git diff` clean of `appendFileSync`; record the removal in the run note).
6. **Path check** (one capture before the probe sequence suffices): confirm the widget path is live — a one-line offer under the input. If the environment instead shows a vertical menu, hapax took the fallback path (no editor factory); the BUG-003 fix is widget-path-only by design — record that fact and the fallback observation in the run note (it is environment, not a bug, but the space-tick proof then cannot run in that environment; escalate per Divergence Protocol).

### Success Criteria

- [ ] Run-notes file exists at the architecture/ path with: environment (tmux size, pi invocation), exact send-keys commands + sleeps, and verbatim captures A/B/C
- [ ] Capture A shows the `Fed` offer at the space tick (no further key between space and capture)
- [ ] Capture B shows the narrowed offer persisting after `F`
- [ ] Capture C shows Escape dismiss + stock-forward behavior (no capture of the press itself)
- [ ] Widget-path confirmed live (one-line offer under input), else divergence recorded + routed
- [ ] Any divergence recorded verbatim and explicitly routed to P2.M2.T2.S2; nothing papered over
- [ ] `git diff` clean of `appendFileSync` (instrumentation provably removed); `npm test` still green (nothing regressed — this item ships evidence, not code)
- [ ] Optional: cross-reference comment near the flipped pins in test/widget-visibility.test.ts naming the run-notes file

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, could they run this verification from this PRP alone?" — Yes: the tmux recipe (sizes, invocation, sleeps, capture), the seed message, the exact key sequence, the expected observable at each capture, the divergence protocol, and the sanctioned-but-removable instrumentation rule are all stated, each anchored to the spec section or precedent run that used it.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: spec/09-testing-and-acceptance.md
  why: ":291-314 Live verification technique (binding)" — THE technique this item executes.
  critical: Bursts cancel in-flight autocomplete queries (false-conclusion source); pi needs a
        real TTY; the live result is ground truth over any harness.

- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P2M1.T1.S1/PRP.md
  why: The fix contract under test — Goal/What define the exact expected observable (space
        tick paints zeroCharOffer; F narrows; zero-successor arm still closes) and its
        Level 4 defers live verification to THIS item.
  gotcha: Assume S1 landed exactly as specified; verify its unit gates green FIRST
        (npm test) before the live run, so a failed live check means real-stack divergence,
        not an unbuilt fix.

- file: docs/M1-DoD.md
  why: ":1055-1100 Gauntlet item 4 — live smoke" — the precedent run: tmux 200×50,
        pi --no-session, one seeded message + interrupt, char-by-char 0.12 s send-keys,
        verbatim capture format (input line / separator / mode tag / widget line),
        zero instrumentation, git-clean assertion. Copy its capture-quoting format.
  gotcha: That run typed a lowercase fragment; this one needs uppercase `T` — tmux
        send-keys handles uppercase literals directly.

- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/bug003-004-widget-provider.md
  why: BUG-003 mechanics — the pre-fix symptom (offer only on NEXT input event, as a
        filtered offer), why the unit harness masked it (resolved restoreReady +
        wakeEvaluate microtask, §4.2), and :145 the line-claim consequence of an
        arming-tick paint (first offer claims the row → layout-visible in capture).
  critical: The masking mechanism is the divergence class to watch for: if capture A
        shows nothing but capture B (after F) shows Fed, that is the OLD behavior —
        record it, do not rationalize it.

- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/repo-governance-and-conventions.md
  why: §2 summarizes the binding technique + the integration acceptance items the run
        touches (item 8 line claim, item 10 post-Tab offer context).

- file: src/pi/config.ts
  why: ":134-135 defaults — enableChaining: true, menuDelayMs: 0" — no config override
        needed; states this affirmatively so the runner doesn't hunt for one.
```

### Current Codebase tree (relevant slice)

```bash
src/pi/widget.ts               # post-S1: zeroCharOffer helper + arming-site paint (READ ONLY here)
src/pi/provider.ts             # sanctioned instrumentation site IF needed (must end clean)
test/widget-visibility.test.ts # S1's flipped timing pins (optional cross-ref comment only)
docs/M1-DoD.md                 # precedent live-smoke capture format (READ ONLY)
plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/   # run-notes file lands HERE
```

### Desired Codebase tree with files to be added

```bash
plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/
  live-tty-bug003-run-notes.md   # NEW — environment, commands, sleeps, verbatim captures A/B/C,
                                 # path-check result, divergence log (if any), instrumentation
                                 # removal proof. Mode A: rides with the verification.
# No production/test code changes (optional single comment in test/widget-visibility.test.ts).
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL: pi --no-session needs a REAL TTY — run it INSIDE the tmux pane; piping its
# stdout makes it exit silently (spec/09's first bullet).

# CRITICAL: NEVER send a whole string ("The ") in one send-keys — a burst cancels
# in-flight autocomplete queries. One character per send-keys with 0.08–0.12 s sleeps.
# The space character is `tmux send-keys -t <pane> Space`.

# CRITICAL: capture A must fire BEFORE any further key. Sequence: send Space, sleep 0.1,
# capture-pane. A capture taken only after typing F proves nothing (that is the pre-fix
# behavior's only visible state).

# GOTCHA: wait out the 300 ms ingest debounce after the seed message + Ctrl+C (sleep
# ≥ 0.5 s) before probing, or the store may not yet hold the→Fed.

# GOTCHA: the seeded message must go through the REAL seam (submit it in pi, don't
# pre-seed files) — the point is the production wiring (BUG-001 fix) feeding the arming.

# GOTCHA: widget vs fallback: one line under the input = widget path (the fix's home);
# a vertical menu = fallback (no editor factory in that environment). The fallback
# CANNOT show a space-tick paint by design (pi-tui owns its menu) — check before probing.

# GOTCHA: instrumentation (appendFileSync behind an env var in src/pi/provider.ts) is
# sanctioned ONLY as a divergence diagnostic; remove it and prove `git diff` clean.
# The precedent run needed none — capture-pane alone.

# GOTCHA: Escape while un-entered must FORWARD (stock pi cancels the in-flight request);
# verifying "dismiss + no capture" via capture C. Do not assert pi internals here.
```

## Implementation Blueprint

### Data models and structure

None — no data/code models. The artifact structure is the run-notes file:

```markdown
# live-tty-bug003-run-notes.md (skeleton)
- Date / commit HEAD (git rev-parse --short HEAD) / S1 gate: npm test green (counts)
- Environment: tmux new-session -d -s hapaxbug003 -x 200 -y 50; pi --no-session in pane
- Seed: send "The Fed raised rates today" + Enter, Ctrl+C, sleep 0.6
- Path check capture (widget line format confirmed)
- Capture A (space tick): commands + sleeps + verbatim pane
- Capture B (after F): verbatim pane
- Capture C (after Escape): verbatim pane
- Result: PASS per-step, or DIVERGENCE (verbatim) → routed to P2.M2.T2.S2
- Instrumentation: none used / used + removed, git diff --stat proof
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: PRE-FLIGHT (no code changes)
  - VERIFY S1 landed: `npm test` green (esp. test/widget-visibility.test.ts + test/widget.test.ts
    flipped pins). Record counts + `git rev-parse --short HEAD` for the run note.
  - VERIFY `git status` clean BEFORE starting (so the post-run clean-diff assertion is
    attributable to this run's instrumentation alone).

Task 2: RUN the live sequence (the runbook above, What §1-3)
  - tmux: `tmux new-session -d -s hapaxbug003 -x 200 -y 50` then run `pi --no-session`
    inside the pane (e.g. `tmux send-keys -t hapaxbug003 'pi --no-session' Enter`;
    sleep for startup + gate settle ≥ 1 s).
  - SEED: send the seed message text (Enter to submit), interrupt the turn (C-c),
    sleep 0.6 s (300 ms debounce + margin).
  - PATH CHECK: capture-pane once; confirm the one-line widget shape (else follow the
    Divergence Protocol for environment mismatch).
  - PROBE: T / h / e / Space each followed by sleep 0.1; capture A immediately
    (no further key); then F + sleep 0.1 → capture B; then Escape → capture C
    (after one sleep, so the forwarded key settles).
  - ASSERT per captures A/B/C as in Success Criteria; quote verbatim in the run note.

Task 3: WRITE plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/live-tty-bug003-run-notes.md
  - FOLLOW pattern: docs/M1-DoD.md "Gauntlet item 4" capture-quoting format (input line,
    separator, mode tag, widget line, verbatim fenced).
  - INCLUDE: skeleton fields above; per-step PASS/DIVERGENCE verdict; any divergence
    quoted verbatim + explicitly "routed to P2.M2.T2.S2".
  - MODE A: this file IS the documentation deliverable; nothing pending elsewhere
    except routed drift items.
  - OPTIONAL: one-line cross-reference comment in test/widget-visibility.test.ts next to
    S1's flipped space-tick pins pointing at this run-notes file.

Task 4: CLEAN + FINAL GATES
  - IF instrumentation was used: remove it; `git diff | grep -c appendFileSync` → 0
    (and git diff --stat shows only sanctioned files: the run note + optional comment).
  - `npm run check` + `npm test` — both green (nothing regressed; this item ships
    evidence, not code).
  - Kill the tmux session (`tmux kill-session -t hapaxbug003`).
```

### Implementation Patterns & Key Details

```bash
# The probe core (char-by-char, paced; space is its own key name):
tmux send-keys -t hapaxbug003 T;  sleep 0.1
tmux send-keys -t hapaxbug003 h;  sleep 0.1
tmux send-keys -t hapaxbug003 e;  sleep 0.1
tmux send-keys -t hapaxbug003 Space; sleep 0.1
tmux capture-pane -t hapaxbug003 -p   # ← Capture A: 'Fed' offer must be under the input NOW
tmux send-keys -t hapaxbug003 F; sleep 0.1
tmux capture-pane -t hapaxbug003 -p   # ← Capture B: narrowed, still offered
tmux send-keys -t hapaxbug003 Escape; sleep 0.15
tmux capture-pane -t hapaxbug003 -p   # ← Capture C: line dismissed
# Read captures the way the precedent does: input line, separator, mode tag, and the
# widget line directly under the input. Anything else recorded verbatim, not summarized.
```

### Integration Points

```yaml
CODE: none (verification-only; optional single test-file comment)
DOCS:
  - run-notes file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/live-tty-bug003-run-notes.md
  - drift routing: any divergence → P2.M2.T2.S2 (spec-drift report compiler); do NOT edit
    spec/ here (P2.M2.T2.S2 owns the reconciliation record)
CONFIG: none (defaults already enableChaining:true, menuDelayMs:0)
DEPENDS-ON:
  - P2.M1.T1.S1 (the fix — verify green before the run)
  - P1.M1.T1.S1/P1.M1.T2.* (series wiring live through production — already Complete)
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
# No code changes expected — this level is the clean-tree check:
git status --short          # pre-flight: clean (record it)
# Post-run: only the run-notes file (+ optional comment) may appear.
npm run check               # still green (no code touched)
```

### Level 2: Unit Tests (Component Validation)

```bash
npm test    # full suite green — S1's pins intact; nothing in this item can regress them
```

### Level 3: Integration Testing (System Validation)

```bash
# THIS item's core level — the live run itself (Tasks 2): the three captures + path check.
# The run-notes file is the evidence artifact; a re-runnable command transcript must let
# the owner reproduce every capture.
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Reproducibility: run the probe sequence TWICE in fresh panes (fresh pi --no-session,
# fresh seed) — both runs' capture A must show the space-tick paint. A one-off pass is
# not a timing proof; the second run is cheap and rules out flake.
tmux kill-session -t hapaxbug003   # cleanup after the second run
```

## Final Validation Checklist

### Technical Validation

- [ ] Pre-flight: `npm test` green, HEAD recorded, tree clean
- [ ] Post-run: `git diff` contains NO `appendFileSync`; only run note + optional comment
- [ ] `npm run check` + `npm test` green at close; tmux session killed

### Feature Validation

- [ ] Capture A: `Fed` offer visible at the space tick (no key between Space and capture)
- [ ] Capture B: narrowed offer persists after `F` (no close+reopen)
- [ ] Capture C: Escape dismisses + forwards (stock behavior)
- [ ] Widget path confirmed (one-line offer under input)
- [ ] Sequence reproduced twice (fresh panes) — both passes

### Code Quality Validation

- [ ] Run note quotes captures verbatim (no paraphrase), includes commands + sleeps
- [ ] Divergences (if any) recorded verbatim + routed to P2.M2.T2.S2 — nothing forced
- [ ] No production/test code modified (beyond the optional cross-ref comment)

### Documentation & Deployment

- [ ] Run-notes file at the exact architecture/ path with all skeleton fields
- [ ] Mode A satisfied: evidence rides with the verification; drift routed onward
- [ ] No environment variables, no config, no deployment

## Anti-Patterns to Avoid

- ❌ Don't send multi-char strings via send-keys — bursts cancel in-flight queries and manufacture false failures (and false passes).
- ❌ Don't capture only after typing `F` and call it the space-tick proof — that is exactly the pre-fix symptom's only visible state.
- ❌ Don't fix code or "adjust" the test when the live run diverges — record verbatim, route to P2.M2.T2.S2; the live result is ground truth per spec/09.
- ❌ Don't leave instrumentation in the tree — sanctioned means temporary; the clean git diff is part of the deliverable.
- ❌ Don't pre-seed the store by editing files or fabricating a session — the seed must ride the real ingest seam (that is the point of the production wiring being live).
- ❌ Don't probe before the 300 ms debounce settles or before the startup gate window — sleep after seed and after pi startup.
- ❌ Don't assert pi internals from the pane (request cancellation machinery, chain state) — assert only what capture-pane shows; use the sanctioned probe if internals are genuinely needed.
- ❌ Don't treat a fallback-path vertical menu as the fix failing — it is a different display path by design; record the environment fact and escalate.

---

**Confidence Score: 8/10** — The runbook is fully concrete (exact commands, sleeps, capture points, expected observables) and is lifted from two binding precedents (spec/09 :291-314 and the M1-DoD live smoke that ran the same technique successfully in the same environment shape). Residual risk is environmental, not informational: whether the runner's environment has an editor factory (widget path), and whether the real render timing matches the harness at the space tick — both are handled by explicit protocol (path check + divergence routing) rather than assumed away.
