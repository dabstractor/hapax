# Spec & docs map — arrow model v2 (spec synced ahead; code catches up)

## Authoritative v2 text (READ-ONLY inputs this run)

- **spec/07-completion-ui.md "Widget key handling" :57–122** — the v2 model:
  boundary pass-through (ONE press: dismiss + suppress + forward verbatim;
  caret moves same keypress; symmetric transparency for →/↓ one-word
  un-interacted), interaction carousel (generation = one continuously
  displayed result set; first highlight-MOVING arrow press marks it
  interacted; both edges wrap end-to-end; clamp RETIRED as unreachable),
  fresh-generation reset (new result set ⇒ highlight to first word, flag
  reset, pass-through re-armed), pass-through never sets the flag (one-word
  line never interacted), plain Escape unchanged at every state, Tab/Enter
  unaffected by interaction state, invariant amendment (captures = Tab,
  Enter-submits proxy, arrows + Escape only once the line is ENTERED).
- **spec/SPEC.md invariant 1 :38–43** (v2: "once the result line has been
  ENTERED … dismiss the line AND forward the press (the caret moves — one
  press, plain-pi parity)"); decision-log **Display row :76** (two-state per
  generation, carousel wording); **M3 milestone :97–98**.
- **spec/09**: widget.test.ts battery bullets **:134–159**; integration
  items 1–2 **:164–173**; live technique **:194–218**.
- spec/07 "Never-hijack rules" :392–423 (widget bullet ~:407–410 already
  v2); "One-line widget" :43–56 (highlight resets on every set change);
  "Widget visibility state machine" :123–143 (boundary pass-through listed
  as a hide cause ~:137).

## Gauntlet commands

`npm run check` (tsc --noEmit) · `npm test` (vitest --run) · `npm run bench`
(vitest bench). All green required. (docs/M1-DoD.md:16–29 records that
`pi --check` does not exist; sanctioned equivalents are these.)

## docs/M1-DoD.md pattern (1261 lines, APPEND-ONLY)

Never edit prior items. Pattern: `## Gauntlet item N — <name>: PASS` (or
`### <item>: PASS` inside a dated section) → fenced re-runnable commands →
dated bullet with suite counts ("52/52"), gate numbers, named test cases
verbatim. Worked example at **:739–757** (old-model evidence — historical,
do not touch). Latest sections end ~:1230; append the new dated section at
end of file.

## README.md stale inventory (626 lines)

- **:313–331 "Design invariants" mirror** claims "verbatim from spec/SPEC.md"
  but **:318–323** still teaches the OLD model ("the four arrow keys and
  Escape while the result line is visible … ↑/← on the first word act as
  Escape (boundary-Esc), dismissing the line and returning every key to the
  user" — capture-while-visible + consumed press). Re-mirror from
  SPEC.md:38–43.
- **:195–200** widget-mode prose is ALREADY v2 (two-state, pass-through,
  carousel) — do not regress it.
- **:545** verification note ("arrow/Escape/Tab key capture") — check
  wording consistency with v2.
- False-positive grep hits (ignore): "rescues"/"TypeScript"/"desc"/"narrow";
  config-table "(clamped)" :462–486 (knob ranges); :241 word-boundary
  tokenization mention.
- README does NOT mirror the decision-log table (prose refs only: :14, :23,
  :70, :251–252, :268).

## Live verification technique (spec/09 :194–218 — BINDING)

tmux pane; `pi --no-session` (the TUI needs a real TTY — piping stdout exits
silently). Seed the store: submit one short user message, then Ctrl+C the
turn. Drive keys with `tmux send-keys` ONE char at a time, 0.08–0.12 s sleeps
between (burst-typed strings cancel in-flight queries — known
false-conclusion source). Evidence via `tmux capture-pane`. Sanctioned
internal probe: temporary `appendFileSync` behind an env var in
src/pi/provider.ts — REMOVE before finishing; tree must be clean post-smoke.

## plan/004 artifacts (partly stale — re-verified numbers live in this dir)

plan/004_24ebf0115d16/architecture/system_context.md — tier-0-era widget
seams (insertHighlighted ~853–910, currentSet ~519, chain-arm reality
provider.ts:644–686); cites verified vs b26a917, predate arrow-v2 — use the
line numbers in THIS directory's system_context.md instead.
external_deps.md there — gauntlet commands still valid; contains no
tmux/DoD-pattern details (they are recorded above).
