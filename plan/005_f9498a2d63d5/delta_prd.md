# hapax Delta PRD — Widget Arrow Interaction Model v2
## (Boundary pass-through + interaction carousel; retiring boundary-Esc's consumed press and the clamp)

**Source delta:** previous PRD (post tier-0/loose-mode session, plan/004) → current PRD.
**Spec status:** `spec/*.md` is ALREADY at the current-PRD text (verified: boundary
pass-through, carousel, token carry, reserved triggerChar, 180 ms gate, Zorp re-theme
all present). Spec is READ-ONLY this run; this is a code-catches-up delta, same shape
as the tier-0 run.

---

## 1. Diff analysis — what actually changed

The PRD-to-PRD diff touches ~10 areas. **Exactly ONE is unimplemented.** Verified
against the working tree (commit `23fd764`):

### 1a. ALREADY LANDED — verification-only, NO tasks (do not redo)

| PRD delta | Code evidence |
|---|---|
| Rule 4c span semantics: "equals OR CONTAINED IN" deferral + overlapping / trailing-`_` straddle absorption (`FOO_1_`, `q~z9_`, `X=1ZZ_`; "one span per character class region") | commit `141610d` "drop token overlaps containment missed"; segment.ts:575–580 |
| Ingest chunk-boundary token carry (05: "a slice boundary never splits a token") | commits `4255690` + `390a8f1`; ingest.ts:402–428 ("BUG-004 fix") |
| `R_eff(9)` float-compare clarification; score.test probes q=82 admits / q=83 rejects | test/score.test.ts:129 ("rEff ≈ 82.15, float compare, no rounding") |
| Reserved `triggerChar` (`@`, `/`, `"`) advisory warning + `"warn"` → `"warning"` notify level (08) | config.ts:135–162, 237, 246+ ("advisory" collision check post-merge) |
| Ingest perf gate 60 → 180 ms CI bound + validation note (09) | perf-gates.test.ts:309 ("3× the 60 ms budget", CI < 180) |
| store.test eviction: one pass / full 256-victim batch wording (09) | store.test.ts:431 |
| M2 DoD journey re-themed AGAIN: `Acme`/`Zephyr` → `Zorp`/`Zephra` (09, validation Issue 1) | acceptance.test.ts:838, fixtures (`zephyr-chain.jsonl` content, RESULTS.md) |
| ASCII `x` in fallback descriptions, never U+00D7 `×` (07) | query.ts:480, 530 (`session x${c.sessionCount}` "ASCII x per item contract") |
| Widget-path chain arming sentence (07 M2: "arming happens at the widget's Tab-insert… intent bypass") | widget.ts:1443–1460 (BUG-001 fix — arms at `rec.key`, `tier !== 0` strict, fresh grant); spec documents landed code |

The implementation session should spot-check these agree with spec (one read pass,
no edits expected) and record anything found in the drift report.

### 1b. THE DELTA — unimplemented, spec marks it "adopted ahead of implementation"

**Widget arrow interaction model v2** (spec/07 "Widget key handling"; SPEC.md
invariant 1; 01 goal 10 / limitations / UX principles; 09 widget.test.ts +
integration items 1–2; decision-log Display row; M3 milestone):

- **Boundary pass-through replaces boundary-Esc.** Old (live in code): ↑/← on the
  first word dismiss + **CONSUME** the press (caret unmoved; second press moves it);
  →/↓ at the last word **clamp**. New: on an UN-ENTERED line, ↑/← on the first word
  dismiss + suppress **AND forward the press verbatim — the caret moves on the same
  keypress** (one press, plain-pi parity; the owner rejected the two-press variant
  2026-10). Symmetric transparency: →/↓ with nothing to navigate (one-word line,
  un-interacted) forwards verbatim and the line simply stays — **no arrow press is
  ever consumed before the list has actually been entered**.
- **Interaction carousel after entry.** A *generation* = one continuously-displayed
  result set. The first arrow press that **MOVES** the highlight (→/↓ entering an
  un-interacted multi-word line) marks the generation **interacted**; from then on
  the arrow cluster is captured and **both edges wrap end-to-end** (↑/← on the first
  word wraps to the LAST; →/↓ on the last word wraps to the FIRST). **The clamp is
  RETIRED** (unreachable: reaching the last word requires navigation, which interacts
  the generation, and interacted edges wrap). Plain Escape unchanged at every state
  (always dismiss + suppress) and is the exit once interacted. A genuinely new result
  set (narrowed, replaced, or otherwise changed) starts a FRESH generation: highlight
  resets to the first word, the interaction flag resets with it, boundary
  pass-through is re-armed. A pass-through press never sets the flag (no movement
  happened) — a one-word line therefore never becomes interacted. Tab inserts and
  Enter submits are unaffected by the interaction state.

Everything else in the PRD diff is spec/README wording riding on (a) or already
landed per (a).

---

## 2. Requirements (single feature — proportional scope)

### R1. Generation state + pure decision function v2 (`src/pi/widget.ts`)
`WidgetState` gains a per-generation `interacted` boolean, reset to `false` at the
existing result-set-change site where `highlightIndex` resets to 0 (widget.ts:304,
"spec h3.8") — the generation boundary lives there (and on hide/show cycles, since a
reshown line is a new paint). `decideWidgetKey` (widget.ts:999–1017) gains an
`interacted` parameter and implements the decision table:

| State | Key | Decision |
|---|---|---|
| !visible or 0 items | any | `forward` (unchanged) |
| any | Escape | `escape` — consumed, dismiss + suppress (unchanged at EVERY state) |
| un-interacted | ↑/← at index 0 | **`boundary-pass-through`** — hide + suppress + **forward verbatim** (replaces `boundary-esc`) |
| un-interacted | →/↓, one-word line | `forward` — line stays, no dismiss, no suppress |
| un-interacted | →/↓, multi-word | `navigate +1` AND mark the generation interacted (enters the list) |
| interacted | ↑/← at first | navigate **wrap to last** |
| interacted | →/↓ at last | navigate **wrap to first** |
| interacted | interior arrows | `navigate ±1`, consumed |
| any | Tab / submit key | `tab-insert` / `enter-submit` (unchanged) |

- `WidgetKeyDecision` (widget.ts:972–981): replace `boundary-esc` with
  `boundary-pass-through`; **delete `clamp`**; a navigate decision marks the
  generation interacted (a dedicated field or wiring-side mutation — implementer's
  choice; keep the decision function pure/table-testable as today).
- Defensive totality: "any arrow press that MOVES the highlight marks interacted."
  Un-interacted + index > 0 is theoretically unreachable (reset-on-set-change +
  only-moves-mark) but must degrade to that rule, never to a forward.
- Wrap math uses the **rendered** count (`renderedCount()`; width truncation
  shrinks the list — widget.ts:258 already clamps the highlight into range).
  Wrap may be expressed as delta = ±(count−1) or as modular arithmetic in the
  wiring; it must land exactly on first/last.

### R2. Wiring (`widgetHandleInput`, widget.ts:1366–1490)
- `boundary-pass-through`: `state.hide()` + `machine.onDismissed(true)` (the SAME
  explicit-dismissal suppression seam as Escape — suppression until next word
  start), then `return forwardInput(data)` — **NOT consumed**. Follow the
  `enter-submit` branch precedent exactly for the clock: **no widget-layer
  `opts.onKeystroke` tick** on a forwarded key (the guard's delegation seam ticks
  exactly once — double-ticking would corrupt hesitation timing).
- `navigate`: mutate `highlightIndex` (interior clamp; edges wrap when interacted)
  and set the interaction flag. Consumed (widget-layer tick retained).
- `escape`, `tab-insert`, `enter-submit`, `forward`: unchanged — including the
  Tab-insert chain-arm block (widget.ts:1443–1460; only its branch labels/comments
  shift if the union is renamed).
- Stale comment/doc rewrites: header model blurb (widget.ts:59–66), "caret must
  not move on boundary-Esc/clamp" (:1367), "clamp: consumed, no movement" (:1480),
  and the WidgetState field docs.

### R3. Test battery rewrite (`test/widget.test.ts`)
Rewrite the old-model describes — :526 (boundary-Esc), :542 (single-item list),
:558 (clamp), :507 (width truncation clamp), :637 (clock tick on clamp), :969
(full scenario) — to the new model, per spec/09 widget.test.ts bullets:
- one-press pass-through: ↑/← first word un-interacted → line hidden + suppression
  armed + the key FORWARDED verbatim (spy on the inner/delegation path receives
  the data — caret-move parity on the same press);
- →/↓ one-word un-interacted → forwarded, line stays visible, no suppression;
- entering: →/↓ multi-word un-interacted → highlight moves + flag set;
- carousel: interacted edges wrap both directions; interior navigates; all
  consumed; clamp case class gone;
- fresh generation: new result set (narrow/replace) resets flag + highlight,
  re-arms pass-through; pass-through never sets the flag (one-word line never
  becomes interacted);
- Escape unchanged at every state; Tab synchronous insert / Enter dismiss+forward
  unaffected by flag; inner instance NEVER mutated (v1 regression pin — keep);
- width truncation: 2-of-3 rendered → entering navigates to rendered end, further
  →/↓ (now interacted) wraps to 0;
- clock ticks: navigate/escape → exactly one widget-layer tick;
  boundary-pass-through → zero widget-layer ticks, exactly one delegation tick
  (enter-submit precedent pattern).

### R4. Mode B — changeset coherence (final task, depends on all above)
- **README sweep:** the invariant-1 mirror (README.md:317–324 claims "verbatim from
  spec" but carries the OLD boundary-Esc text) must be re-mirrored from spec/SPEC.md;
  sweep every other stale arrow-model claim (grep `boundary`, `clamp`, `second
  press`, `Esc`) including the widget/arrow blurbs and the decision-log Display row
  mirror if present.
- **docs/M1-DoD.md:** append a dated gauntlet item (follow the file's own
  "## Gauntlet item N — <name>: PASS" pattern, cf. :739) with suite counts, gate
  numbers, and the live-smoke captures.
- **Full gauntlet:** `npm run check`, `npm test`, `npm run bench` — all green.
- **Live smoke (BINDING, spec/09 technique):** ephemeral `pi --no-session` in tmux,
  one char at a time (0.08–0.12 s apart), capture-pane evidence, no instrumentation
  left in the tree: (i) un-entered ← mid-word moves the caret one char AND dismisses
  the line on that single press; (ii) → on a one-word line passes through; (iii) →
  enters a multi-word line, ← at first wraps to last, → at last wraps to first,
  Escape exits and the next word start re-offers; (iv) Tab still inserts, Enter
  still submits while the line is visible. This is a key-handling change on the
  widget path — live verification against the real extension stack is mandatory
  (the v1 proxy crash is the precedent).
- **Drift report:** spec/*.md were read-only; record any spec-vs-repo mismatch
  found (expected: none; the §1a table is the spot-check list).

### Documentation impact
- **Mode A (rides with R1–R3):** widget.ts header model blurb (:59–66),
  `WidgetKeyDecision`/`decideWidgetKey` JSDoc, wiring comments (:1367, :1480),
  `WidgetState.interacted` field doc. No user-facing/config/API surface changes.
- **Mode B:** R4 above (README + DoD + smoke + drift) — the breakdown agent should
  make this a final Task depending on all implementing subtasks.
- **Explicitly none:** no spec edits (already synced), no config schema, no core/
  module, no provider path (fallback path arrows are stock pi — untouched).

---

## 3. Reference to completed work / prior research

- **Do not re-implement:** everything in §1a (landed commits cited). The widget
  Tab-insert chain arming, suppression machinery (`onDismissed(true)` seam, bounded
  to the dismissed buffer — commit `fac248b`), highlight reset-on-set-change
  (:304), rendered-count clamping (:258/:996), and the `enter-submit`
  dismiss-then-forward precedent (:1381–1394) are all LIVE and are the seams this
  delta builds on.
- **Prior research:** `plan/004_24ebf0115d16/architecture/system_context.md`
  (widget/proxy structure, chain-arm reality — now partly superseded by newer
  commits; verify line numbers against the current tree), `external_deps.md`
  (gauntlet commands, DoD pattern, tmux technique). The line numbers in §R1–R3
  above are re-verified against the current working tree (widget.ts is 1,524 lines
  at `23fd764`).

---

## 4. Suggested breakdown (proportional: 1 phase, 2 milestones, 2 tasks)

- **P1.M1.T1 — Generation state + decideWidgetKey v2 + wiring** (S1: state + pure
  decision + wiring per R1–R2, ~3 pts; S2: widget.test.ts battery rewrite per R3,
  ~2 pts, depends S1).
- **P1.M2.T1 — Changeset coherence** per R4 (~2 pts; depends on every
  implementing subtask): README sweep + DoD append + gauntlet + live smoke +
  drift report. Optional second subtask split (docs vs smoke) at the breakdown
  agent's discretion — the work is small.

Out of scope: fallback-path behavior, core/ modules, config, spec edits, chain
semantics, tier/matching behavior, everything in §1a.
