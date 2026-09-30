# Research notes — P1.M3.T4.S1 tmux scripted widget verification

## Binding technique (spec/09 "Live verification technique", read in full, lines 166–189)

- `pi --no-session` inside a tmux pane — pi's TUI needs a real TTY; piping
  stdout makes it exit silently.
- Keys via `tmux send-keys`, ONE CHARACTER AT A TIME, 0.08–0.12 s sleeps
  between. Bursts CANCEL in-flight autocomplete queries (source of at least
  one false conclusion historically).
- Visible state via `tmux capture-pane`.
- Sanctioned temporary instrumentation: `appendFileSync` behind an env var in
  the UI-layer module (spec names src/pi/provider.ts; for M3 the widget path
  the relevant module is src/pi/widget.ts). REMOVE before committing —
  verify clean tree afterwards (`git diff` empty vs pre-instrumentation).
- Seed the store by submitting one short user message, then Ctrl+C the turn.
- The M3 widget is "the deepest UI-layer change yet (own rendering + own key
  handling): live verification against the real extension stack (pi-vim +
  split-editor) is mandatory before acceptance — the v1 proxy crash (07) is
  the precedent."

## What "the real extension stack (pi-vim + split-editor)" means (spec/07 ~l.375–405)

- spec 07: hapax captures the editor factory set by ANY extension (pi-vim,
  split-editor — the documented capture-previous composition) and wraps the
  factory's instance in a Proxy. The v1 crash was reproduced live with
  pi-vim + split-editor + Shift+Tab (own-property mutation → dynamic
  read cycle → RangeError).
- pi-vim and split-editor are NOT in this repo and NOT shipped in pi's
  examples dir (`examples/extensions` has border-status-editor.ts,
  modal-editor.ts, rainbow-editor.ts — verified). If pi-vim/split-editor
  cannot be located on this machine, the minimum live stack is hapax + one
  editor-factory extension that itself composes capture-previous (e.g.
  border-status-editor as the factory-installing stand-in), PLUS a
  plain `pi --no-session` run with NO other extension to verify the fallback
  (no-factory) path. Record exactly which stack was used in the evidence
  file; flag the pi-vim/split-editor gap explicitly if unresolvable.

## Extension loading

- package.json line 7: `"pi": { "extensions": ["./src/pi/index.ts"] }` —
  hapax auto-loads as the project extension when pi runs in this repo
  (`pi --no-session` from repo root). Additional stand-in extensions can be
  loaded with `-e ./path.ts`.
- Dual-path branch (src/pi/index.ts, read): `ctx.ui.getEditorComponent()`
  first → factory exists ⇒ widget PRIMARY (no provider registered); no
  factory ⇒ FALLBACK provider path. Both paths must be exercised live.

## Contract clauses to verify (r5-spec-readme-dod.md §1–2 verbatim extracts)

Integration item 1 M3 clause: offer one line below the input —
`Zendesk | …`; arrows move the highlight; ← twice mid-word dismisses then
moves the caret — boundary-Esc.
Item 2 capture window: while the result line is visible only
arrows/Escape/Tab are consumed (boundary-Esc returns the rest).
Item 7: `sr` → `src/core/query.ts`, Tab inserts the whole path; absolute
path inserts with leading `/`; once `/` precedes cursor, stock pi file
completion owns the rest.
Item 6: quoted path completion, slash commands, @-mention identical to
stock pi.
Trigger-mode fragments containing `/`: open question from R2 research —
verify the stock gate disarms them (fragment with `/` must not show the
widget; classifyStockContext/visibility machine).

## r4-widget-pi-api.md flagged live-eyeball risks (§6 Risks)

- Proxy `get`-trap render override is novel (examples subclass instead) —
  eyeball the composed render in a real TTY (widget line below input,
  no border corruption, terminal-width cap).
- Repaint path: tui.requestRender availability through the factory closure —
  eyeball for missed repaints (stale widget line after keystrokes).
- Enter/Tab/caret: P1.M3.T3.S2 flagged onChange-after-programmatic-insert and
  caret placement (setCursorCol fix) as its live verify items.
- Terminal width only known at render(width) — check first-keystroke render
  before width cache (should render empty/safe).

## Where the record goes

- Mode B: the verification RECORD lands in docs/M1-DoD.md's M3 section via
  P1.M4.T1.S2 — THIS subtask makes NO doc edits. Evidence file + captures go
  to plan/003_bbac3b15e8d0/P1M3T4S1/verification-record.md (+ captures/
  subdir). P1.M4.T1.S2's PRP will cite it.
- Environment: tmux at /usr/bin/tmux, pi at /home/dustin/.local/bin/pi (both
  verified present). npm scripts: check/test/bench.
- S1/S2 of P1.M3.T3 (arrow/Esc + Tab/Enter key layers) are the inputs; treat
  their PRPs (plan/003_bbac3b15e8d0/P1M3T3S1|S2/PRP.md) as contracts.
