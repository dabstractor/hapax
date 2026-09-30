# PRP — P1.M3.T4.S1: tmux scripted widget verification + instrumentation removal + record

## Goal

**Feature Goal**: Execute the BINDING live-TTY verification (spec/09 "Live
verification technique") of the complete M3 widget path from P1.M3.T3 (S1
arrows/boundary-Esc + S2 Tab/Enter), driven by scripted tmux keys against a
real `pi --no-session` TTY, with sanctioned temporary instrumentation added
and then removed, producing a recorded evidence file (captures + verdicts)
consumed by P1.M4.T1.S2's DoD append.

**Deliverable**: `plan/003_bbac3b15e8d0/P1M3T4S1/verification-record.md` +
`plan/003_bbac3b15e8d0/P1M3T4S1/captures/*.txt` (tmux capture-pane
artifacts), and a **clean tree** (zero instrumentation residue; `git status`
showing no modifications to src/ beyond what P1.M3.T3 committed). No
production-code changes ship from this task (except any bug the verification
SURFACES — then a minimal documented fix is in scope, this is the task's
purpose).

**Success Definition**: Every verification item below has a capture + a
PASS/FAIL verdict recorded; any FAIL is either fixed (minimal, documented,
full suite green) or escalated in the record; instrumentation removed;
`npm run check` + `npm test` green at the end.

## User Persona

**Target User**: hapax maintainer + the P1.M4.T1.S2 DoD author (Mode B feed).

**Use Case**: Accepting M3 — spec/09 makes live verification of the widget
("the deepest UI-layer change yet") MANDATORY before acceptance; unit tests
have "repeatedly encoded wrong platform models" (spec/09, verbatim).

**Pain Points Addressed**: The v1 proxy crash was invisible to every unit
test and only reproduced live with the real extension stack; proxy render
overrides and the repaint path are flagged as novel risks (r4 research §6).

## Why

- spec/09 (binding): "live verification against the real extension stack
  (pi-vim + split-editor) is mandatory before acceptance — the v1 proxy
  crash (07) is the precedent."
- P1.M3.T3.S2's PRP explicitly deferred two items here: onChange notification
  after programmatic insert, and caret placement on mid-line insertion.
- P1.M4.T1.S2 cannot write the M3 DoD section without this record.

## What

### Verification procedure (binding technique, spec/09)

1. `tmux new-session -d -s hapaxv -x 160 -y 45`, then in the pane:
   `cd /home/dustin/projects/hapax && pi --no-session` (hapax auto-loads —
   package.json `"pi".extensions` points at ./src/pi/index.ts; verified).
   Never pipe stdout (TUI exits silently).
2. Seed the store: send one short user message mentioning `Zendesk` and
   `lwlock` and `src/core/query.ts` (use `sr` … path per item 7), submit it,
   wait for the turn to finish (or Ctrl+C the turn) so message_end ingests
   and the debounce (300 ms) settles.
3. Drive keys with `tmux send-keys -t hapaxv -l <char>` ONE CHARACTER AT A
   TIME, sleeping 0.08–0.12 s between keys (e.g.
   `for ch in z e; do tmux send-keys -t hapaxv -l "$ch"; sleep 0.1; done`).
   NEVER send whole strings — bursts cancel in-flight queries and have
   produced false conclusions before.
4. Capture state: `tmux capture-pane -t hapaxv -p > captures/<id>.txt`.
5. Instrumentation: add temporary `appendFileSync` debug logging behind an
   env var (e.g. `HAPAX_DEBUG_LOG=path`) in `src/pi/widget.ts` (widget-path
   key decisions, visibility transitions, insert span/caret) and, for the
   fallback path checks, `src/pi/provider.ts` (spec/09's named site). REMOVE
   ALL of it before finishing; verify with `git diff` that src/ matches the
   pre-instrumentation state exactly.
6. Extension stack: attempt to load the real pi-vim + split-editor
   extensions (`pi --no-session -e <pi-vim> -e <split-editor>`). They are
   NOT in this repo nor in pi's examples dir (verified) — search the machine
   (`~/.pi/agent/extensions`, installed packages) first. If unlocatable, run
   the minimum viable stack: (a) hapax + one factory-installing extension
   from pi's examples (`~/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/border-status-editor.ts`,
   loaded via `-e`) to prove capture-previous composition with a foreign
   factory, and (b) bare hapax `pi --no-session` (no other extension) for
   the fallback path. RECORD which stack was used and flag the
   pi-vim/split-editor gap explicitly if unresolvable — do not fake it.

### Verification items (each → capture + verdict)

W1 **Widget line renders below input (item 1 M3 clause)** — type `ze` after
seeding: line one below the input shows `Zendesk | …` (join, highlight on
first item). Zero-candidate fragment (`zz`) renders NO line (invariant 3).

W2 **Arrow navigation + clamp** — with the line visible: →/↓ move highlight;
→/↓ at last item clamp (highlight stays, caret unmoved); ↑/↓ per S1 table.
Captures before/after each arrow.

W3 **Boundary-Esc (item 1 M3 clause + spec/07 h3.9)** — mid-word, highlight
anywhere: press ← on FIRST item → line dismisses, press consumed (caret does
NOT move); press ← again → caret moves back one char. Two captures.

W4 **Capture window (item 2)** — while visible: arrows/Escape/Tab consumed;
type an ordinary letter mid-visibility → lands verbatim in the input (widget
refines or hides per visibility rules, letter never swallowed); Escape
dismisses and subsequent keys all return to the user.

W5 **Tab inserts display casing (S2 deferred item)** — `ze` + Tab → `Zendesk`
inserted (capital Z), caret after insertion, no menu; `#l` + Tab → `lwlock`
(trigger char consumed). Verify caret position mid-line insertion (insert at
start of line, not end — the setText parks-at-end bug class).

W6 **Enter dismisses then submits** — with line visible, Enter: line
dismisses AND the message submits (verify the turn starts). Enter must never
insert a candidate.

W7 **Fallback path (no factory)** — stock `pi --no-session` with NO
editor-factory extension: hapax provider path still works (`ze` → menu
offers Zendesk, Tab inserts) — or, if the environment provides no factory at
all, confirm the provider registered and delegate behavior identical.

W8 **Stock contexts untouched (item 6)** — quoted path completion
(`read "src/co` + Tab → stock pi path completion), `/` slash-command menu,
`@`-mention — all identical to stock pi behavior.

W9 **Item 7 conversational path completion** — after a message mentioning
`src/core/query.ts`: type `sr` → `src/core/query.ts` offered, Tab inserts
the whole path; a message with an ABSOLUTE path (e.g.
`/home/user/projects/hapax`) → typing its first segment offers it and Tab
inserts with the leading `/`. Once a `/` precedes the cursor mid-path, stock
pi file completion owns the rest (no hapax hijack).

W10 **Trigger fragment containing `/` (R2 open question)** — type `#sr/c`
(or any trigger fragment containing `/`): the stock gate must disarm the
widget — no widget line for a trigger fragment containing `/`. Record the
observed behavior either way; if it shows, that is a FAIL + bugfix.

W11 **Proxy render + repaint eyeball (r4 §6 risks)** — across all of the
above: no border corruption, no stale widget line after keystrokes (repaint
path), no flicker, first-keystroke render before width cache is safe,
terminal-width truncation sane at -x 160 (and re-verify at -x 80 with
`tmux resize-window`).

W12 **No crash / no recursion** — full session: no `RangeError: Maximum call
stack size exceeded` anywhere (v1 precedent), no wedged input (type prose
continuously after everything above — keystrokes land verbatim).

### Success Criteria

- [ ] Evidence file with all items W1–W12: capture references + verdicts
- [ ] All FAILs either fixed (minimal change, full `npm test` green,
      documented in the record) or escalated
- [ ] Instrumentation fully removed; `git status`/`git diff` clean for src/
      (only pre-existing P1.M3.T3 state)
- [ ] `npm run check` + `npm test` green at task end
- [ ] pi-vim/split-editor availability question answered and recorded

## All Needed Context

### Context Completeness Check

An agent knowing nothing of this repo needs: the binding technique verbatim,
the exact contract clauses, the input contracts (T3.S1/S2 PRPs), the
extension-stack facts and stand-in plan, instrumentation/removal rules, and
where the record goes. All below.

### Documentation & References

```yaml
- file: spec/09-testing-and-acceptance.md
  section: "Live verification technique (binding)" (~lines 166–189) and
    "Integration acceptance" items 1, 2, 6, 7 (verbatim above)
  why: THE binding procedure + the acceptance clauses being verified.
  critical: one-char send-keys with 0.08–0.12 s gaps; capture-pane for state;
    instrumentation removed before commit; piping stdout makes pi exit silently.

- file: spec/07-completion-ui.md
  section: h3.9 "Widget key handling" boundary-Esc wording (~l.390–400) and
    HISTORY "v1 monkey-patch crashed" (~l.396–404)
  why: exact boundary-Esc semantics (first-press consumed, caret unmoved) and
    the RangeError precedent W12 watches for; the pi-vim/split-editor origin.

- docfile: plan/003_bbac3b15e8d0/architecture/r5-spec-readme-dod.md
  section: §1–2 (widget.test.ts + integration items verbatim), §5 (DoD record
    pattern — this task's evidence feeds it)
  why: verbatim acceptance contract extraction; the M3 clause parentheticals.

- docfile: plan/003_bbac3b15e8d0/architecture/r4-widget-pi-api.md
  section: §6 Risks (proxy render override, repaint, width cache)
  why: the specific novel risks to eyeball live (W11); §3 dual-path branch
    explains W7's fallback activation condition.

- file: plan/003_bbac3b15e8d0/P1M3T3S2/PRP.md
  why: CONTRACT for Tab/Enter behavior being verified (W5/W6) — and its two
    explicitly deferred live-verify items: onChange after programmatic
    insert, caret placement on mid-line insert.

- file: plan/003_bbac3b15e8d0/P1M3T3S1/PRP.md
  why: CONTRACT for arrows/clamp/boundary-Esc (W2/W3).

- file: src/pi/index.ts
  why: dual-path wiring — getEditorComponent() first; factory ⇒ widget primary
    (no provider); no factory ⇒ fallback provider path. package.json "pi".
    extensions auto-loads hapax from the repo root.

- file: src/pi/widget.ts, src/pi/editor.ts, src/pi/provider.ts
  why: instrumentation sites (widget.ts for the widget path, provider.ts is
    spec/09's named site for fallback checks); editor.ts holds the enter-submit
    guard W6 exercises through the chain.
  gotcha: instrumentation is APPEND + REMOVE ONLY — never restructure logic.

- file: docs/M1-DoD.md
  why: downstream consumer (P1.M4.T1.S2 appends the M3 section). READ to match
    its evidence style (per-item ### sections, reproduction commands). DO NOT
    EDIT in this task (Mode B: no doc edits here).
```

### Current Codebase tree (relevant)

```
src/pi/{index,widget,editor,provider,config,ingest,paths,debug}.ts   # all landed through P1.M3.T3
test/widget.test.ts, test/editor-enter.test.ts                        # S1/S2 suites (green)
docs/M1-DoD.md            # M1+M2 sections exist; M3 section is P1.M4.T1.S2's job
tools/gen-large-session.mjs  # (restore/compaction items are NOT in scope — items 3/4)
```

### Desired additions

```
plan/003_bbac3b15e8d0/P1M3T4S1/verification-record.md   # the deliverable record
plan/003_bbac3b15e8d0/P1M3T4S1/captures/*.txt           # capture-pane artifacts
(temporary, then REMOVED: instrumentation lines in src/pi/widget.ts / provider.ts)
```

### Known Gotchas of our codebase & Library Quirks

```bash
# CRITICAL: send-keys ONE CHAR AT A TIME (`-l` literal mode) with 0.08–0.12 s
#   sleeps — bursts cancel in-flight queries (spec/09; historical false conclusion).
# CRITICAL: pi needs a real TTY — run inside the tmux pane, never piped.
# CRITICAL: remove ALL instrumentation before finishing; verify `git diff` on
#   src/ is empty vs the P1.M3.T3 state. A dirty tree FAILS this task.
# GOTCHA: tmux must be new session per scenario (`-x 160 -y 45` fixed size) so
#   captures are comparable; `tmux capture-pane -p` for text.
# GOTCHA: seed message must FINISH (message_end) before testing — wait for turn
#   completion or Ctrl+C, plus the 300 ms ingest debounce, before typing fragments.
# GOTCHA: `pi` is at /home/dustin/.local/bin/pi; run from the repo root so the
#   project extension auto-loads; `--no-session` keeps it ephemeral.
# GOTCHA: pi-vim/split-editor may not exist on this machine — search first,
#   fall back to border-status-editor example as the foreign factory + bare run
#   for fallback, and RECORD the gap. Never claim stack coverage you didn't run.
# GOTCHA: widget line is BELOW the input (item 1) — captures must show the
#   relative position, not just the content.
# GOTCHA: if a FAIL requires a code fix: minimal change, comment citing the
#   failed item (W#), full `npm run check && npm test` green, and the record
#   documents bug→fix. This is sanctioned — the verification exists to find bugs.
# GOTCHA: keep instrumentation behind an env var (e.g. HAPAX_DEBUG_LOG) with
#   try/catch so it can never break the live run if the path is unwritable.
```

## Implementation Blueprint

### Procedure script skeleton (bash, run from repo root)

```bash
mkdir -p plan/003_bbac3b15e8d0/P1M3T4S1/captures
tmux new-session -d -s hapaxv -x 160 -y 45
tmux send-keys -t hapaxv "cd /home/dustin/projects/hapax && pi --no-session" Enter
sleep 3                                              # TUI boot
type() { for ch in $(printf '%s' "$1" | fold -w1); do
  tmux send-keys -t hapaxv -l "$ch"; sleep 0.1; done; }
cap() { tmux capture-pane -t hapaxv -p > \
  "plan/003_bbac3b15e8d0/P1M3T4S1/captures/$1.txt"; }
# seed: type "We use Zendesk, the lwlock, see src/core/query.ts" ; Enter; wait/Ctrl+C
# W1: type "ze"; sleep 0.3; cap w1-widget-line ; Esc (or boundary) to clear
# ... per-item sequences W1–W12, each with cap <id>
tmux kill-session -t hapaxv
```

### Implementation Tasks (ordered)

```yaml
Task 1: PRE-FLIGHT
  - npm run check && npm test          # input suites green (P1.M3.T3 contract)
  - git status snapshot                # baseline for the cleanliness check
  - locate pi-vim / split-editor (~/.pi/agent/extensions, npm globals);
    decide stack per "What" §6 and note it

Task 2: ADD sanctioned instrumentation (env-var-gated appendFileSync)
  - src/pi/widget.ts: log key decisions (action), visibility transitions,
    insert span/caret on Tab
  - src/pi/provider.ts (fallback checks W7/W8): log delegation/suggestion sets
  - all writes try/catch behind HAPAX_DEBUG_LOG

Task 3: RUN the W1–W12 scenarios per the procedure; capture each; note verdicts
  - one tmux session per major scenario group (widget-primary stack; fallback
    stack; width re-check at -x 80 for W11)

Task 4: FIX any FAILs (minimal, cited, tests green) and RE-VERIFY those items

Task 5: REMOVE all instrumentation; git diff src/ vs Task-1 baseline == empty
  - final npm run check && npm test

Task 6: WRITE plan/003_bbac3b15e8d0/P1M3T4S1/verification-record.md
  - per W1–W12: what was run (stack, keys), capture filename, verdict, notes
  - instrumentation add/remove diff summary; stack used (+pi-vim gap if any)
  - overall verdict line; reproduction commands; explicit hand-off note for
    P1.M4.T1.S2 (Mode B feed: it appends the DoD M3 section citing this file)
```

### Integration Points

```yaml
CONSUMES:
  - P1.M3.T3.S1/S2 widget key layers (their PRPs = contracts)
  - P1.M3.T1.S2 render, P1.M3.T2.S1 visibility machine (already complete)
FEEDS:
  - P1.M4.T1.S2 (DoD M3 section append) — cite this record verbatim
  - README sweep P1.M4.T1.S1 consumes any behavior surprises found
DO NOT: edit docs/M1-DoD.md, README.md, spec/*; modify core modules; leave
  instrumentation; commit instrumentation.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # clean (after any bugfix + instrumentation removal)
```

### Level 2: Unit Tests

```bash
npm test        # fully green at task end
```

### Level 3: Integration (this task IS the integration gate)

```bash
git status --porcelain src/   # EMPTY (or exactly the documented bugfix diff)
git diff                      # no instrumentation residue
ls plan/003_bbac3b15e8d0/P1M3T4S1/captures/ | wc -l   # ≥ 12 captures
```

## Final Validation Checklist

- [ ] All W1–W12 items have captures + verdicts in verification-record.md
- [ ] Boundary-Esc two-← behavior and the arrows/Escape/Tab capture window verified live
- [ ] Tab inserts display casing (`Zendesk`), caret after insertion, mid-line correct (S2's deferred items answered)
- [ ] Item 7 path completion + item 6 stock regression + trigger-with-`/` disarm all checked
- [ ] Fallback (no-factory) path exercised; dual-path both live-verified
- [ ] Extension stack used recorded honestly (pi-vim/split-editor or documented stand-in gap)
- [ ] Zero instrumentation left: `git diff` on src/ clean vs baseline (modulo documented bugfixes)
- [ ] `npm run check` + `npm test` green
- [ ] No edits to docs/M1-DoD.md, README.md, or spec/

## Anti-Patterns to Avoid

- ❌ Don't send whole strings via send-keys — bursts cancel in-flight queries (the recorded false-conclusion trap)
- ❌ Don't pipe pi's stdout — it exits silently without a TTY
- ❌ Don't keep instrumentation "for next time" — the spec's removal rule is absolute
- ❌ Don't claim pi-vim/split-editor coverage without running them — record the stand-in honestly
- ❌ Don't edit the DoD or README here — Mode B: this task records evidence only
- ❌ Don't skip re-verification after a bugfix — every FAIL needs a post-fix capture
- ❌ Don't treat a capture-less verdict as evidence — each item cites its capture file

---

**Confidence Score: 8/10** — the binding procedure, contract clauses, wiring
facts (auto-load, dual-path), instrumentation sites, and stand-in plan are
all verified by direct read; the residual unknown is exactly what the task
exists to discover (live behavior) plus pi-vim/split-editor availability,
which the PRP handles with an honest-gap fallback path.
