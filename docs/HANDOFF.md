# hapax — handoff (2026-09-09, post-stabilization session)

Session scope: interactive bug-chasing + spec sync after the
implementation pipeline completed. Eight commits (`196b1af..5ad55b7`),
everything committed, tree clean, **778 tests passing (1 pre-existing
skip), typecheck clean**. The spec (`spec/*.md`) is the single source
of truth and is fully synced to code as of `5ad55b7`.

## What shipped this session

| Commit | Change |
|---|---|
| `196b1af`, `83e13b6` | Auto-open: identifier chars registered as autocomplete triggers; effective threshold 1 (pi-tui requests once per word) |
| `e5b5b33` | Content-derived menu order (shortest → byte-lex; salience → eviction only); conjugation guard; `rejectCommonness` knob; calibrate-bands word probe; Enter-submits editor proxy (v1); menuDelayMs hesitation gate; spec maintenance policy |
| `b5ce0fc` | Gate fixed to time REAL keystrokes via the editor proxy's input clock (v1 measured query-to-query gaps = word-to-word, never suppressed; live-verified broken then fixed) |
| `f741a81` | Startup gate: first query bound-waits (≤500 ms) for history replay (restore race + one-query-per-word made the first typed word's menu permanently missing) |
| `f92097f` | Chain offers are one-shot per acceptance (armed chain re-offered at every word start with intent bypass — "menus forever after one Tab") |
| `ef84811` | `menuDelayMs` default 150→300 (the gate only sees word-BOUNDARY gaps, the longest natural ones — 150 suppressed nothing real); sentence-initial capitals don't set `properName` |
| `5ad55b7` | Close-on-space (stuck cwd file-menu fix — pi's stock treats trailing-space text as file-completion start); dotted filename tokens stay whole (`AGENTS.md`) |

## Verification method that worked (use it again)

Unit tests twice encoded wrong platform models this session. The
reliable loop: ephemeral live instance (`cd ~/projects/hapax && pi
--no-session` in a tmux pane; seed the store by submitting one short
user message, Ctrl+C the turn), drive keys with `tmux send-keys`
(per-char `sleep 0.08–0.12` ≈ real rhythm; a whole string at once =
burst, which CANCELS in-flight queries — different behavior), verify
via `capture-pane`. pi's TUI needs a real TTY — piping stdout
(`pi | tee`) makes it exit silently. Temporary instrumentation
(appendFileSync behind an env var) in `provider.ts` found two bugs
tests couldn't see.

## Open items (nothing known-broken; all need owner judgment)

1. **`menuDelayMs: 300` is calibrated but unconfirmed.** Rationale is
   measured (word-boundary gaps 150–250 ms at 100+ WPM), but only the
   owner's real typing validates it. If menus still pop in flow:
   raise; if help feels laggy: lower. Knob is in `~/.pi/agent/hapax.json`.
2. **Enter-submits + keystroke clock + hesitation gate all depend on
   the editor proxy**, which only installs when an extension set an
   editor factory (here: pi-vim). With pi's stock editor: no Enter
   guard (Enter accepts the highlighted word — the owner called this
   disqualifying), degraded gate timing. The durable fix is upstream
   in pi-tui: non-slash `tui.select.confirm` should cancel + fall
   through to submit (mirroring the slash case). Worth filing.
3. **pi-tui version pin risk.** hapax devDeps pin ~0.84.4; runtime is
   0.85.1. Contracts leaned on (documented as PINs in
   `src/pi/provider.ts`): single-item forced fast path, trigger-char
   branch shadowing (letters registered ⇒ continuation branch
   unreachable), one-query-per-word when the menu is closed, and the
   editor's space-updates-open-menu flow. Re-verify on pi upgrades.
4. **Editor-slot ecosystem is fragile by design.** pi has ONE custom
   editor slot; split-editor restores previousFactory on shutdown,
   pi-vim's factory has per-call cursor-shape side effects. hapax's
   proxy composes last via capture-previous (spec 07 records the v1
   monkey-patch recursion crash as binding history — never mutate a
   shared editor instance).
5. **Known leaks, accepted/by-design:** derivational suffixes
   (`deletion`) not stem-stripped; absent-stem conjugations
   (`parses` — `parse` itself is dictionary-absent) leak →
   `rejectCommonness` knob covers them; message-START capitals still
   count as properName (the owner's rule was literally "after
   punctuation" — ask before extending); `zephyrs`-class plurals of
   rare words reject (identifiers-not-plurals policy).

## Where things live

- Spec policy: `spec/SPEC.md` (interactive sessions MUST keep spec ↔
  code in agreement, either order; pipeline agents treat spec as
  read-only; `plan/` is historical).
- Config knobs: `spec/08-configuration.md` (`triggerChar`,
  `threshold` (inert), `maxSuggestions`, `rejectCommonness`,
  `menuDelayMs`, `enableChaining`, `debug`).
- Word admission probes: `node tools/calibrate-bands.mjs <words...>`
  (prints q + verdict, lowercase and Capitalized).
- Provider stack order (wired in `src/pi/index.ts`): hapax provider →
  startup gate → display layer (hesitation gate + 100 ms swap
  debounce) → pi. Editor proxy wraps the active factory and feeds the
  shared input clock.
