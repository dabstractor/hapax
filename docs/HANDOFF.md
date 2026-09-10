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

1. **TOP: relief evidence bar (the "fine line").** Audited against
   real history (~2k messages replayed through the real pipeline,
   /tmp technique preserved in git history of this session): the store
   holds ~6.7k words; menus are dominated by genuinely useful jargon
   (`sessionmanager`, `agents.md`, `stdout`, `projecttrusted`), but
   ~480 common words admit via capitalized-sighting relief even after
   the structural-start rule — `echo`, `reject`, `device`, `failed`,
   `file` — because across thousands of messages nearly every common
   word gets one MID-SENTENCE capitalized occurrence. Proposed lever:
   relief only for words with NO lowercase sighting in-session
   (sticky `lowercaseSeen` flag on the store entry, consulted by the
   pipeline at admit time). Trade-off to decide: it also filters
   words used both ways (`national` lowercase AND the capitalized NREL
   phrase). Alternative: drop relief entirely and rely on the
   dictionary-absent class (identifiers rarely need it).
2. **`menuDelayMs` — hesitation gate is now OFF by default (0).**
   Calibration history: 150 ms still popped, 300 ms never popped —
   the owner's word-boundary gaps straddle any fixed threshold, and
   the original popping complaint was actually chain-offer stickiness
   + relief clutter (both fixed since). Auto-open is immediate again;
   the knob remains for owners with a measured pause length. If
   flow-popping returns as a complaint, instrument REAL keystroke
   gaps first (gate logging technique in git history) before picking
   any value.
3. **Enter-submits + keystroke clock + hesitation gate all depend on
   the editor proxy**, which only installs when an extension set an
   editor factory (here: pi-vim). With pi's stock editor: no Enter
   guard (Enter accepts the highlighted word — the owner called this
   disqualifying), degraded gate timing. The durable fix is upstream
   in pi-tui: non-slash `tui.select.confirm` should cancel + fall
   through to submit (mirroring the slash case). Worth filing.
4. **pi-tui version pin risk.** hapax devDeps pin ~0.84.4; runtime is
   0.85.1. Contracts leaned on (documented as PINs in
   `src/pi/provider.ts`): single-item forced fast path, trigger-char
   branch shadowing (letters registered ⇒ continuation branch
   unreachable), one-query-per-word when the menu is closed, and the
   editor's space-updates-open-menu flow. Re-verify on pi upgrades.
5. **Editor-slot ecosystem is fragile by design.** pi has ONE custom
   editor slot; split-editor restores previousFactory on shutdown,
   pi-vim's factory has per-call cursor-shape side effects. hapax's
   proxy composes last via capture-previous (spec 07 records the v1
   monkey-patch recursion crash as binding history — never mutate a
   shared editor instance).
6. **Known leaks, accepted/by-design:** derivational suffixes
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
