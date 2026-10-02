---
name: "P1.M2.T1.S3 (plan 005) — Live smoke in tmux (4 scenarios) with capture-pane evidence — BINDING"
---

## Goal

**Feature Goal**: Execute the BINDING live verification (spec/09 h2.57) of the widget arrow-interaction model v2 (boundary pass-through + interaction carousel, P1.M1.T1.S1–S3) against the REAL extension stack in a tmux pane, covering the four PRD R4 scenarios, capturing `tmux capture-pane` evidence for each — with pacing noted (one char at a time, 0.08–0.12 s) — and leaving the tree clean (no instrumentation, `git status` clean).

**Deliverable**:
- `plan/005_f9498a2d63d5/P1M2T1S3/research/live-smoke.md` (+ `research/captures/` verbatim pane dumps): per scenario — before/after captures, pacing note, PASS/FAIL verdict — in the exact format of the docs/M1-DoD.md gauntlet-item-4 precedent (~L1056–1210)
- Clean tree: any temporary instrumentation (env-gated `appendFileSync` in src/pi/provider.ts) REMOVED; `git status` shows only the research files

**Success Definition**: All four scenarios PASS with verbatim capture evidence; evidence usable verbatim by P1.M2.T1.S4's DoD gauntlet append; no source/test/spec/README/docs edits; tmux session killed afterward.

## Why

- spec/09 h2.57 is BINDING: "UI-layer changes are verified live, not by unit tests alone … The M3 one-line widget is the deepest UI-layer change yet (own rendering + own key handling): live verification against the real extension stack is mandatory before acceptance — the v1 proxy crash (07) is the precedent." The v2 arrow model (decision table, wiring) changed exactly that key-handling path.
- No unit test substitutes: widget.test.ts drives doubles; this item proves the behaviors against a real TTY, real pi-tui editor, real timing.

## What

### Technique (verbatim from spec/09 h2.57 / external_deps.md "Live verification technique")

1. tmux session, one pane (200×50 like the precedent), `pi --no-session` (the TUI needs a real TTY — piping stdout makes it exit silently). Network-gated environment caveat: if no model is reachable, the seed turn can still be submitted and Ctrl+C'd — the store seeds from the user message BEFORE any model output; if `pi` won't start at all, record the environmental blocker and STOP (never fake captures).
2. Seed the store: submit ONE short user message containing a vocabulary engineered for the scenarios (see below), then Ctrl+C the turn (`tmux send-keys C-c`).
3. Drive every typed string with `tmux send-keys` ONE CHARACTER AT A TIME with 0.10–0.12 s sleeps between (`send-keys -t <pane> <char>; sleep 0.12`). NEVER burst-send — bursts cancel in-flight queries and are the documented false-conclusion source. Arrows/Tab/Enter/Esc are single `send-keys` events (e.g. `Left`, `Right`, `Tab`, `Enter`, `Escape`).
4. Evidence: `tmux capture-pane -t <pane> -p` BEFORE and AFTER each significant keypress; record captures verbatim (input line, separator, mode tag, the widget line directly under the input).
5. Sanctioned internal probe ONLY if visible state is insufficient to conclude: temporary `appendFileSync` behind an env var in `src/pi/provider.ts` (e.g. gated on `HAPAX_SMOKE_LOG`) — MUST be removed before finishing; `git status` clean afterward, no instrumentation left in the tree.

### Seed vocabulary (one message, then Ctrl+C)

Needs: (a) a MULTI-word-producing fragment for scenarios i/iii — e.g. `zendesk lwlock zephyr` …: typing `z` should offer `zendesk | zephyr | …` (verify what actually renders and quote it); (b) a ONE-word-producing fragment for scenario ii — a unique-prefix rare word (e.g. `lwlock` via `lw`). Recommended seed (mirror the precedent style, adjust after seeing the real menus): `The zendesk lwlock zephyr verdigris kestrel scribe unsaidlock thread — note zendesk zephyr twice.` Confirm via the rendered widget line (not assumptions) which fragments give ≥2 items vs exactly 1.

### The four scenarios (PRD R4; spec/09 item 1 amended bullets)

**(i) Un-entered ← mid-word — one-press boundary pass-through.** Type a multi-word fragment (e.g. `ze`) until the line shows ≥2 words. Capture BEFORE the press (line visible, caret at line end). Send ONE `Left`. Capture AFTER. PASS = BOTH: the caret moved one char left (visible in the input line's cursor position) AND the widget line dismissed — on that SINGLE press. Then verify suppression: another `Left` is plain caret movement (no re-offer); type a space + first char of a fresh word → the line re-offers at the new word start.

**(ii) → on a one-word line passes through.** Type a fragment yielding EXACTLY one word (e.g. `lw` → `lwlock`). Capture before; send ONE `Right`; capture after. PASS = the line STAYS visible and the press forwarded verbatim (caret advances past the last char — check the input line grew a literal movement; note what the editor does with → at end-of-line in plain pi and match that parity). Also confirm the one-word line never became interacted: a following `Left` still behaves as boundary pass-through (dismiss + move), NOT carousel wrap.

**(iii) Multi-word line: enter, carousel both edges, Escape exit, re-offer.** Type the multi-word fragment (line visible, ≥2 words, un-interacted). Send `Right` → capture: highlight moves to the 2nd word (generation now interacted). Send `Left` until highlight is on the FIRST word, then one more `Left` → capture: wraps to the LAST word. Send `Right` past the last → capture: wraps to the FIRST. Send `Escape` → capture: line dismissed (suppression armed). Type a space + first char of a fresh word → capture: line re-offers (fresh generation, highlight on first word — pass-through available again: prove with one `Left` = dismiss + move). NOTE: hapax's widget highlight rendering must be visible in capture-pane (theme accent on the highlighted word) — if the highlight is NOT visually distinguishable in the capture, use the sanctioned provider.ts probe to log the highlight index per keypress and pair the log with the captures.

**(iv) Tab inserts and Enter submits while visible.** Type a fragment with the line visible (interacted or not — test BOTH if cheap: Tab on an un-interacted line inserts the TOP word; after one `Right`, Tab inserts the HIGHLIGHTED word). Capture before/after each. Enter: type a fresh fragment (line visible), send `Enter` → capture: line dismissed AND the message SUBMITTED (input line clears / message appears in transcript), no word inserted.

### Recording

Each scenario section in `research/live-smoke.md`: heading, PASS/FAIL, pacing note ("typed one char at a time, 0.12 s apart"), the verbatim before/after capture blocks (```-fenced, exactly as `capture-pane -p` prints), and a one-line reading (what the capture proves, mirroring the DoD precedent's "Reading:" lines). Failures: record verbatim, diagnose with the probe if needed, and STOP — fixes are not this task's mandate; report back into the plan (S4 cannot record a FAIL gauntlet).

### Success Criteria

- [ ] All four scenarios PASS with before/after verbatim captures + pacing notes
- [ ] Suppression/re-offer behavior captured in (i) and (iii); caret movement visible in (i)/(ii)
- [ ] Zero instrumentation left; `git status` clean of src/test edits; tmux session killed
- [ ] Evidence written to research/ where S4 consumes it verbatim

## All Needed Context

### Context Completeness Check

An implementer needs: the binding technique's five rules, the exact scenario semantics (v2 model: pass-through/carousel/generation), the precedent capture format, the widget code under test, the probe pattern, and the scope fences. All below.

### Documentation & References

```yaml
- file: docs/M1-DoD.md (~L1056–1210)
  why: THE precedent: the M3 live-smoke gauntlet item — tmux pane 200×50,
        pi --no-session, seed-then-Ctrl+C, char-by-char 0.12 s pacing,
        verbatim capture blocks with "Reading:" annotations, the
        no-instrumentation + clean-tree closing claims. Copy the format.

- file: plan/005_f9498a2d63d5/architecture/external_deps.md
  section: "Live verification technique (spec/09 :194–218 — BINDING)" (~L60–69)
  why: The binding technique summary + the probe rule (appendFileSync
        behind an env var in src/pi/provider.ts, REMOVE before finishing).

- file: plan/005_f9498a2d63d5/P1M1T1S1/PRP.md (+ S2, S3 PRPs)
  why: The v2 model under test: WidgetState generation flag,
        decideWidgetKey decision table (pass-through vs navigate-wrap vs
        forward), widgetHandleInput wiring. Read to know exactly what
        each keypress SHOULD do per scenario — the PASS oracle.

- file: src/pi/widget.ts
  why: The code under test: decideWidgetKey (:1056), widgetHandleInput
        (:1440+), the handleInput proxy member (:1584). Locate the
        highlight/interaction state so probe placement is obvious if needed.

- file: plan/005_f9498a2d63d5/P1M2T1S2/PRP.md
  why: The contract: S2 certifies the gauntlet green BEFORE this smoke —
        this item runs against a green tree; S2's research/gauntlet-evidence.md
        is the environment record (HEAD, versions) to echo at the top of
        live-smoke.md. S4 consumes BOTH.

- file: spec/09-testing-and-acceptance.md (in-repo, READ-ONLY)
  section: h2.57 (technique) + h2.56 item 1 (the amended M3 widget
        acceptance bullets — the four scenarios' normative source)
```

### Current Codebase tree (relevant)

```bash
src/pi/widget.ts        # under test (read-only; probe goes in provider.ts per the sanction)
src/pi/provider.ts      # sanctioned probe site, ONLY if needed, then reverted
docs/M1-DoD.md          # format precedent (read-only for this task)
```

### Desired Codebase tree

```bash
plan/005_f9498a2d63d5/P1M2T1S3/research/live-smoke.md      # NEW — the deliverable
plan/005_f9498a2d63d5/P1M2T1S3/research/captures/          # NEW — verbatim pane dumps (optional if quoted inline)
```

### Known Gotchas & Library Quirks

```bash
# CRITICAL: NEVER send a whole string with one tmux send-keys — bursts
# CANCEL in-flight autocomplete queries and produce false conclusions
# (documented, live-observed). One char per send-keys + sleep 0.10–0.12.

# CRITICAL: `pi --no-session` needs a real TTY — running pi with piped
# stdout exits silently. Everything happens inside the tmux pane.

# GOTCHA: capture the caret position — capture-pane shows the cursor; the
# one-press rule (scenario i) asserts caret movement AND dismissal on the
# SAME press. Capture before AND after that single Left.

# GOTCHA: the widget line must have ≥2 items for (i)/(iii) and EXACTLY 1
# for (ii) — verify what actually renders from your seed BEFORE running
# the scenario proper, and quote the real line. Don't assume the seed
# vocabulary yields the shape you want; adjust the probe fragment
# (e.g. 'z' vs 'ze' vs 'lw') until the rendered count is right.

# GOTCHA: if the theme accent highlight is not distinguishable in plain
# capture-pane text, the highlight index is unobservable — use the
# sanctioned env-gated appendFileSync probe in src/pi/provider.ts to log
# the highlight index per key event, pair log lines with captures, then
# REMOVE the probe and show git diff clean.

# GOTCHA: Enter submits — the seed turn must be Ctrl+C'd BEFORE the
# scenario-iv Enter test (you don't want a real model turn racing the
# capture). Also Enter in scenario iv submits a message containing the
# fragment text; that's fine (it re-seeds the store).

# GOTCHA: timing — the precedent noted captures taken ~0.6 s after the
# final keystroke to let the 100 ms display debounce settle; do the same,
# and note the delay in each scenario's pacing line.

# GOTCHA: kill the tmux session when done (`tmux kill-session`) — nothing
# persists; record that in the closing note (precedent L1209).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: PRECONDITIONS
  - Confirm P1.M2.T1.S2's gauntlet is green (read its research evidence);
    the v2 battery (P1.M1.T1.S3) has landed; git status clean start
  - tmux new-session -d -s hapax-smoke -x 200 -y 50; split/select pane

Task 1: START + SEED
  - pi --no-session in the pane (cd to repo root so `-e .` loads hapax…
    NOTE: check how the precedent launched it — likely `pi --no-session`
    with the extension loaded via the repo's usual local-extension
    mechanism; mirror docs/M1-DoD.md item 4 exactly)
  - Submit the seed message char-by-char + Enter; Ctrl+C the turn
  - Probe-store: type a fragment, capture — confirm the widget line
    renders and note which fragments give 1 vs multi-word lines

Task 2: SCENARIOS (i) → (iv), each: capture-before, ONE key event,
        capture-after, note pacing (~0.6 s settle), verdict
  - (i) boundary pass-through: one Left mid-word = caret moves + dismiss;
        suppression then re-offer at next word start
  - (ii) one-word line: Right passes through, line stays; follow-up Left
        is still pass-through (never interacted)
  - (iii) enter + carousel both edges + Escape + re-offer fresh generation
        (+ probe for highlight index if accent not visible in captures)
  - (iv) Tab inserts top (un-interacted) and highlighted (interacted);
        Enter dismisses + submits

Task 3: CLEANUP
  - Remove any probe; git diff/src clean; tmux kill-session
  - git status shows ONLY plan/005…/P1M2T1S3/research/ additions

Task 4: WRITE research/live-smoke.md
  - Header: date, HEAD (from S2's evidence), environment, pacing summary
  - Per scenario: PASS/FAIL, captures verbatim, Reading lines
  - Closing: no-instrumentation claim + clean-tree proof + session-killed
    note (precedent L1205–1209 style)
  - If ANY scenario FAILS: record verbatim, do not fix, report — S4 blocks
```

### Implementation pattern

Per-keypress loop (bash, run from outside the pane):

```bash
type_chars() { for c in $(printf '%s' "$1" | fold -w1); do
  tmux send-keys -t hapax-smoke "$c"; sleep 0.12; done; }
snap() { sleep 0.6; tmux capture-pane -t hapax-smoke -p; }
# scenario i:
type_chars "ze"; snap                    # before: line visible, cursor at end
tmux send-keys -t hapax-smoke Left; snap # after: caret left one AND line gone
```

### Integration Points

```yaml
UPSTREAM:
  - P1.M2.T1.S2 (gauntlet green): the tree this smoke runs against; echo
    its environment block
DOWNSTREAM:
  - P1.M2.T1.S4 (DoD append): consumes live-smoke.md + captures/ verbatim
    into the dated docs/M1-DoD.md gauntlet item — write it so it can be
    pasted without re-editing
```

## Validation Loop

### Level 1: Preconditions

```bash
git status --porcelain src/ test/        # clean before starting
tmux -V; pi --version                    # environment recorded
```

### Level 2: The smoke itself

All four scenarios executed with before/after captures; PASS verdicts.

### Level 3: Evidence integrity

- Every capture block re-derivable (a replayed scenario reproduces the capture)
- Each PASS assertion names the observable it rests on (caret position / line presence / inserted text / submitted message)

### Level 4: Clean-tree proof

```bash
git status        # only plan/005…/P1M2T1S3/research/ files
tmux ls           # session gone
grep -rn "HAPAX_SMOKE_LOG\|appendFileSync" src/pi/provider.ts   # no probe remains
```

## Final Validation Checklist

### Technical Validation

- [ ] Tree clean of instrumentation; probe (if used) removed; tmux session killed
- [ ] Evidence complete: 4 scenarios × before/after captures + pacing notes

### Feature Validation

- [ ] (i) one-press: caret moves AND line dismisses on a single Left; suppression + re-offer shown
- [ ] (ii) one-word line: Right forwards verbatim, line stays, never becomes interacted
- [ ] (iii) carousel wraps both edges after interaction; Escape exits; fresh generation re-offers pass-through
- [ ] (iv) Tab inserts top/highlighted while visible; Enter dismisses + submits, never inserts

### Code Quality Validation

- [ ] Zero edits to src/, test/, spec/, README.md, docs/ (S4 owns the DoD append)
- [ ] Evidence formatted to paste verbatim into S4's gauntlet item (DoD precedent style)

## Anti-Patterns to Avoid

- ❌ Don't burst-send strings with one send-keys — pacing is binding (false-conclusion source)
- ❌ Don't run pi with piped stdout — it exits silently; real TTY only
- ❌ Don't leave the appendFileSync probe in the tree — remove before finishing, prove with git status
- ❌ Don't fix a failing scenario in this task — record verbatim and report (S4 cannot record a FAIL gauntlet; the plan must route the fix)
- ❌ Don't write captures into docs/M1-DoD.md — S4 owns the append

**Confidence Score: 9/10** — the technique, scenario semantics (v2 decision table), capture format precedent, probe sanction, and downstream handoff are all pinned to verified files/lines; the residual risk is environmental (model/network for the seed turn, highlight visibility in captures) and both have explicit fallbacks (seed precedes model output; sanctioned probe for the highlight index).
