# P1.M3.T4.S1 — Live-TTY verification record: M3 widget path (W1–W12)

**Task**: P1.M3.T4.S1 — tmux scripted widget verification + instrumentation
removal + record (spec/09 "Live verification technique", binding).
**Date**: 2026-11-14 (session timestamps 1790767000000–1790769100000).
**Verifier**: automated tmux driver, one character per `send-keys -l` with
0.08–0.12 s gaps (spec/09 binding rule; no bursts), `capture-pane -p` for
state. All captures: `plan/003_bbac3b15e8d0/P1M3T4S1/captures/*.txt`.

## Extension stack actually used (recorded per PRP §What 6)

- **pi-vim 0.14.2** — FOUND: `/home/dustin/.pi/agent/npm/node_modules/pi-vim/index.ts`
- **split-editor** — FOUND: `/home/dustin/.pi/agent/git/github.com/dabstractor/split-editor/index.ts`
- **Session A (primary)**: `pi --no-session -e <pi-vim>/index.ts -e <split-editor>/index.ts`
  — the REAL named stack ran; **no stand-in needed, no gap to flag.**
- **Session B**: bare `pi --no-session` (no `-e`) — see W7 for the finding.
- pi 0.99.x, hapax auto-loaded from the repo root (package.json `"pi".extensions`),
  `HAPAX_DEBUG_LOG=/tmp/hapax-trace-{A,A2,A3,B,B2}.log` (env-gated temporary
  instrumentation — added then FULLY removed, see §Instrumentation).

**Path decision (from traces)**: with pi-vim + split-editor loaded, hapax took
the WIDGET-PRIMARY path (`ctx.ui.getEditorComponent()` returned a factory).
Bare pi ALSO returns a factory — the stock editor's — so session B exercised
the widget composition around the stock editor.

## Instrumentation add/remove summary (spec/09 sanction)

- Added, env-gated (`HAPAX_DEBUG_LOG`, try/catch'd `appendFileSync`, never
  throws): `src/pi/widget.ts` — key decisions (action/consumed/forward),
  visibility machine decisions per rule (stock / no-fragment / gate-held /
  zero / suppressed / paint / hesitation), show/hide transitions, render
  lines (width + produced line), Tab-insert span/caret;
  `src/pi/provider.ts` — getSuggestions entry + paint (fallback path).
- Removed before finishing: `grep -rn "hapaxTrace\|TEMP INSTRUMENTATION" src/`
  → 0 hits. Final `git diff src/` = **only the documented W1 bugfix** (below).
- Scripts: `/tmp/hapax-verify/a*.sh, b*.sh` (not part of the repo tree).

## Verdicts W1–W12

Legend: capture files are relative to `captures/`. "trace" = the
HAPAX_DEBUG_LOG files (not committed; representative excerpts quoted).

### W1 — Widget line renders below input — **PASS after bugfix (FAIL found & fixed)**

- Pre-fix (sessions A1/A2): typing `ze` painted the line only on the NEXT
  input event; the set always trailed the visible text by one character
  (trace: input `zet` displayed the `ze` set; captures
  `w1-widget-line.txt` [no line] vs `w2a-right1.txt` [line] 150 ms apart).
  **FAIL against spec §07 h3.10 rule 2 ("extract the live fragment per
  keystroke").**
- **Root cause**: the enter-submit guard's `onKeystroke` seam fires BEFORE it
  delegates the key, so `machine.onInput()` read the PRE-keystroke buffer.
- **Fix (ships, documented in code)**: `src/pi/widget.ts` — evaluate in a
  `queueMicrotask` (post-apply) + `requestRender()`; new `onPaint` machine
  dep so timer-driven paints (100 ms swap promotion) also surface at rest.
  5 tests adapted to flush the microtask (same final states); full suite
  1007 green.
- Post-fix live: `w1fix-t0.txt` — captured immediately after typing `ze`
  with NO extra key: line `Zendesk | zendesk-zephyr` directly below the
  input; trace `eval paint frag="ze" n=2` + `vis show` in the same
  millisecond as the keystroke. Zero-candidate fragment renders NO line:
  `w1b-zero-candidate.txt` (`zze`, structurally absent — invariant 3).
- Cold-boot note (not reproducible on clean boots A2/A3; recorded, monitor
  in M4): session A1's very first fragment held ~500 ms — the startup
  restore-gate bound — surfacing on the next keystroke, which is the
  widget.ts-header-recorded accepted tradeoff for gate wakes.

### W2 — Arrow navigation + clamp — **PASS**

- Trace (A1, 2-candidate set): `→ navigate` (hi 0→1), `→ clamp` at last,
  `↓ clamp`, `↑ navigate` (1→0) — consumed, never delegated (caret fixed).
- Fixed-build captures: `w2fix-right1/clamp/back0.txt`; v2 set
  `w2v2-*.txt`; raw A1 sequence `w2a`–`w2h`. Highlight movement is ANSI-
  styled; the trace's `hi=` field and unchanged input text prove clamping.

### W3 — Boundary-Esc (first item + ← dismisses, press consumed) — **PASS**

- Trace (A1): `key "\u001b[D" visible=true count=2 hi=0 -> boundary-esc`
  (consumed — returned before any delegation), followed by exactly three
  `-> forward` Lefts. Captures: `w3a-boundary.txt` (line gone),
  `w3b-after-boundary.txt` (text `ze` unchanged), `w3c-left-again.txt` +
  the later `z` landing as `zze` (`w1b-zero-candidate.txt`) — proving the
  caret had NOT moved on the boundary press and DID move on forwarded ones.
- Fixed-build re-verify: `w3fix-boundary.txt`, `w3fix-caret.txt`.

### W4 — Capture window while visible — **PASS**

- Letters land verbatim mid-visibility: `w4c-visible.txt` (`x ze` + line) →
  `w4c-refine.txt` (`x zet`, letter present, widget hid on zero candidates —
  the refine-or-hide rule; the swap-flavor refine is in the A2 trace:
  `paint frag="ze" n=1` → `zero frag="zet"` → `vis hide`).
- Escape dismisses (`w4b-esc.txt`, line gone, `zet` intact) and subsequent
  keys return to the user (`w4b-return.txt`; note: the interposed `qq`
  appears mid-word because pi-vim's Escape shifts the caret one left —
  pi-vim behavior, not hapax; keys themselves never swallowed).
- Arrows/Tab consumed while visible: W2/W5 traces (`-> navigate/clamp/
  tab-insert`, zero `innerCalls`).

### W5 — Tab inserts display casing; trigger char consumed; caret — **PASS**

- Threshold Tab: `w5d-capital-line.txt` (`x ze` → line `Zendesk |
  zendesk-zephyr | zeph`) → Tab → `w5d-capital-after.txt`: input `x
  Zendesk` — capital Z inserted; trace `insert display="Zendesk" span=2
  start=2 caret=9` (caret = start + display, NOT buffer end).
- Trigger Tab: `w5b-before/after.txt` + trace `insert display="lwlock"
  span=2 start=0 caret=6` — span 2 = `#l`, **trigger char consumed**.
- Display-casing caveat recorded: display = most-recent-casing-seen
  (h2.36). The model reply's lowercase mention had rewritten `Zendesk` →
  `zendesk` (w5c-after.txt); a capitalized sighting restores it (w5d). The
  contract "insert the display string" holds either way.
- S2 deferred item — caret on MID-LINE insertion: live, a visible line
  implies the caret sits at the live fragment's end (caret movers are
  consumed while visible; R7 closes on cursor moves), so a mid-BUFFER
  insert is not reachable by typing. Unit-verified instead:
  `test/widget.test.ts` asserts `caret:11  # spanStart 4 + display 7`.
- S2 deferred item — onChange after programmatic insert: `insertHighlighted`
  fires `onChange(getText())` defensively (stock `applyCompletion` parity);
  no app-side consumer was installed in the live sessions, so no misbehavior
  was observable; mechanism code-verified, no regression seen.

### W6 — Enter dismisses then submits — **PASS**

- `w6b-before.txt` (`qq ze` + line) → Enter → `w6b-after.txt`: line gone,
  input cleared, `⠦ Working` spinner; `w6b-turn.txt` (`⠙ Working`) — the
  message SUBMITTED (raw text, no candidate inserted: zero `insert` trace
  lines between). Trace shows the dismiss-then-forward branch
  (`enter-submit` decision, guard stays in chain).

### W7 — Fallback path (no factory) — **PASS with recorded finding**

- **Finding**: on pi 0.99.x, `ctx.ui.getEditorComponent()` returns a factory
  even with ZERO third-party extensions (the stock editor). Trace B2: 185
  `[widget]` lines, 0 `[provider]` lines. **The fallback provider path is
  unreachable on this pi build**; it could not be live-exercised and
  remains covered by the unit suites only. Recorded honestly per the PRP
  ("never claim coverage you didn't run"); flag for P1.M4.T1.S2's DoD.
- What WAS verified live in session B: the widget composition around the
  STOCK editor — `b6-widget-stock-editor.txt` (`ze` → `Zendesk` line) →
  `b7-tab-stock-editor.txt` (Tab inserted `Zendesk`; trace `insert
  display="Zendesk" span=2 start=0 caret=7`). Dual-path verification
  therefore covers widget-around-pi-vim+split-editor AND widget-around-
  stock-editor.

### W8 — Stock contexts untouched — **PASS**

- Quoted path: `w8a-quoted.txt` (`read "src/co`, NO hapax line) → Tab →
  `w8a-quoted-tab.txt`: `read "src/core/"` — pi's OWN path completion did
  the insert; hapax never hijacked.
- Slash menu: `w8b-slash.txt` — stock command menu (1/95 pages) renders.
- @-mention: `w8c-at.txt` — stock file-mention menu (fixture files listed),
  no hapax line.

### W9 — Conversational path completion (item 7) — **PASS**

- `w9a-sr.txt`: `sr` → line `src/core/query.ts | subword | score.ts | …`
  (path candidate first) → Tab → `w9a-after.txt`: input is the WHOLE PATH
  `src/core/query.ts`.
- Absolute path: `w9b-abs.txt` — `see /ho`: no hapax line (hapax disarms
  once `/` precedes the cursor), stock pi shows no menu at that position
  either; input verbatim — no hijack, exactly the item-7 hand-off clause.

### W10 — Trigger fragment containing `/` — **PASS (disarmed)**

- `w10-trigger-slash.txt`: `#sr/c` → NO widget line. The stock gate disarms
  the widget for trigger fragments containing `/` — R2's open question
  answered: nothing shows, nothing hijacks.

### W11 — Proxy render + repaint eyeball — **PASS**

- Width 80 (`w11b-narrow80.txt`, pane verified 80 cols): 8-item `sr` set
  truncates to 6 items (`…| structural`, rightmost dropped, 76 chars ≤ 80);
  at 160 (`w11b-wide160.txt`) all 8 return — the render(width) width cache
  tracks resizes live. No border corruption, no stale lines after
  keystrokes, no flicker across all captures; first-keystroke render is
  safe (`w1fix-t0.txt` rendered on the typing keystroke itself).
- Note: two earlier resize attempts targeted `hapaxv:0` (wrong window id —
  `@87`) and silently stayed 160 cols (`w11-narrow.txt`,
  `w11-narrow-truncated.txt`, `w11-back-160.txt` — superseded by w11b).

### W12 — No crash / no recursion — **PASS**

- `w12-prose.txt`: a 150-char sentence typed continuously lands verbatim;
  input never wedged. `grep -ci "rangeerror|maximum call stack"` over the
  full session trace = **0** (v1 RangeError precedent absent).

## Bugs found & disposition

1. **W1 one-keystroke set lag** (spec §07 h3.10 rule 2 violation) — FIXED in
   `src/pi/widget.ts` (microtask post-keystroke evaluation + `onPaint` seam +
   defensive `requestRender`); 5 tests flush the microtask; full suite green;
   live re-verified (`w1fix-t0.txt`). This is the task's sanctioned
   minimal documented fix — the only src change vs the P1.M3.T3 state.
2. **Cold-boot ~500 ms first-paint hold** (A1 only; startup-gate bound +
   next-keystroke surfacing = the recorded accepted tradeoff) — NOT fixed
   (designed worst case; not reproducible on clean boots). Monitor in M4.
3. **Suppression is same-COLUMN sticky**: after Tab/Esc/Enter dismissal,
   deleting the word and typing a DIFFERENT word at the same start keeps the
   line hidden (release needs a different start column or a trigger char).
   Spec-letter-conformant (same word start); flagged as a tuning/UX question
   for the owner — no code change in this task.

## Reproduction commands

```bash
# widget-primary stack (session A)
tmux new-session -d -s hapaxv -x 160 -y 45
tmux send-keys -t hapaxv "cd /home/dustin/projects/hapax && HAPAX_DEBUG_LOG=/tmp/hapax-trace.log pi --no-session -e /home/dustin/.pi/agent/npm/node_modules/pi-vim/index.ts -e /home/dustin/.pi/agent/git/github.com/dabstractor/split-editor/index.ts" Enter
# fallback-check stack (session B) — proved fallback unreachable on pi 0.99.x
tmux send-keys -t hapaxb "cd /home/dustin/projects/hapax && HAPAX_DEBUG_LOG=/tmp/trace-b.log pi --no-session" Enter
# keystroke pacing (binding rule): one char per send-keys, 0.08–0.12 s gaps
for ch in $(printf '%s' "ze" | fold -w1); do tmux send-keys -t hapaxv -l "$ch"; sleep 0.1; done
tmux capture-pane -t hapaxv -p > capture.txt
```

## Final state

- `git status src/`: only `src/pi/widget.ts` modified = the W1 fix (+ its
  test flushes in `test/widget.test.ts`, `test/editor-enter.test.ts`);
  ZERO instrumentation residue (grep-verified).
- `npm run check` clean; `npm test` 1007 passed / 1 pre-existing skip
  (7 consecutive full-suite green runs at task end; one earlier run had a
  single non-recurring failure during concurrent tmux/LLM load — name not
  captured, all suites green before and after; treated as environmental).
- No edits to `docs/M1-DoD.md`, `README.md`, or `spec/` (Mode B).

**Hand-off to P1.M4.T1.S2 (Mode B feed)**: append the M3 DoD section citing
this file — the seven M3 integration items are covered by W1–W12 above
(items 1→W1/W3, 2→W2/W4, 6→W8, 7→W9/W10; widget-key layers→W2–W6); include
the W1 bugfix note, the W7 fallback-unreachable finding, and observation 3
(suppression same-column stickiness) as known-behavior notes.

**Overall verdict: PASS** — every W item verified live with captures; one
real bug found, minimally fixed, re-verified; stack honestly recorded
(real pi-vim + split-editor ran; fallback path documented unreachable).
