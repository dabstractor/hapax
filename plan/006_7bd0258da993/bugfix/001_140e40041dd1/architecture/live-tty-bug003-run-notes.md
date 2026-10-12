# Live TTY verification — BUG-003 space-tick paint (P2.M1.T1.S2)

Binding technique per spec/09 "Live verification technique (binding)" and
AGENTS.md ("UI-layer changes need live TTY verification, not unit tests
alone"). Verifies the P2.M1.T1.S1 fix (commit `7098ea7` — "paint the
zero-char offer at the arming tick") on the real stack: real TTY, real
editor factory, real render pipeline. Capture-pane quoting format follows
docs/M1-DoD.md "Gauntlet item 4" (input line / separator / mode tag /
widget line directly under the input).

**Result: PASS — all three captures, reproduced twice in fresh panes.
Zero divergences observed. Zero instrumentation used.**

## Pre-flight

- HEAD: `7098ea7` (`fix: paint the zero-char offer at the arming tick` — S1 landed)
- S1 unit gate: `npm test` → **40 files, 1311 passed, 1 skipped, 0 failed**
- `git status` before the run: clean in `src/` and `test/` (only
  orchestrator-owned `plan/**/tasks.json` modified + the untracked PRP dir)

## Environment

- tmux 3.7c, pane 200×50 (`tmux new-session -d -s hapaxbug003 -x 200 -y 50
  -c /home/dustin/projects/hapax`)
- `pi --no-session` launched INSIDE the pane (real TTY; pane polled until
  the INSERT mode tag rendered, ≥ 1 s startup + gate settle)
- Config defaults affirmed sufficient (src/pi/config.ts :134-135):
  `enableChaining: true`, `menuDelayMs: 0` — no overrides, no env vars

## Seed (real seam — no pre-seeding)

```
tmux send-keys -t hapaxbug003 'The Fed raised rates today' Enter
# wait for the turn to settle (polled until the "Working" spinner cleared;
# the reply streamed to completion before the defensive C-c landed)
tmux send-keys -t hapaxbug003 C-c
sleep 0.7   # 300 ms ingest debounce + margin (≥ 0.5 s per runbook)
```

## Probe sequence (exact commands + sleeps; ONE CHAR per send-keys —
bursts cancel in-flight autocomplete queries, the documented
false-conclusion source; 0.12 s pacing inside the binding 0.08–0.12 s band)

```
tmux send-keys -t hapaxbug003 T;     sleep 0.12
tmux capture-pane -t hapaxbug003 -p          # ← path check
tmux send-keys -t hapaxbug003 h;     sleep 0.12
tmux send-keys -t hapaxbug003 e;     sleep 0.12
tmux send-keys -t hapaxbug003 Space; sleep 0.12
tmux capture-pane -t hapaxbug003 -p          # ← CAPTURE A (space tick —
                                             #   NO key between Space and capture)
tmux send-keys -t hapaxbug003 F;     sleep 0.12
tmux capture-pane -t hapaxbug003 -p          # ← CAPTURE B (after F)
tmux send-keys -t hapaxbug003 Escape; sleep 0.2
tmux capture-pane -t hapaxbug003 -p          # ← CAPTURE C (after Escape)
```

## Path check — WIDGET PATH CONFIRMED

After `T` the pane showed the one-line widget shape (offer renders as a
single line under the input in the INSERT-area slot, exactly the M1-DoD
widget format) — the widget path is live; the BUG-003 fix's home path.
(Typed prefixes `T`/`Th`/`The` paint no menu — below the offer floor; the
space-tick successor offer is the expected first paint, which is exactly
what the fix targets.) The fallback vertical menu never appeared.

## RUN 1 — captures (verbatim pane tails)

**Capture A — the space tick.** Input is `The ` (trailing space, invisible
in capture); the `Fed` offer (series-first, run casing) is visible NOW,
before any further key — the exact behavior BUG-003 denied:

```
The                                          ← input line (trailing Space)
──────── (200-col separator, verbatim below)
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT
Fed                                          ← the widget line: zero-char successor offer AT the space tick
glm-5.3  ❯  high  ❯  1.3% / 1.0M  ❯  🔌 MCP: 2 servers enabled  ❯  📡 local (5)  ❯  🟢 relay
```

**Capture B — after `F`.** Offer narrowed in place (park/swap, no
close+reopen): `Fed` still offered, input now `The F`:

```
The F                                        ← input line
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT
Fed                                          ← narrowed offer persists
glm-5.3  ❯  high  ❯  1.3% / 1.0M  ❯  🔌 MCP: 2 servers enabled  ❯  📡 local (5)  ❯  🟢 relay
```

**Capture C — after Escape.** Offer line GONE (dismissed); input `The F`
intact (nothing consumed un-entered); mode tag flipped INSERT→NORMAL —
the forwarded key behaved as stock pi (vim-mode escape), proving the
dismiss forwards rather than swallows:

```
The F                                        ← input line, intact
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
NORMAL                                       ← forwarded Escape: stock pi mode flip; NO widget line
                                             ← (blank line where the offer was)
glm-5.3  ❯  high  ❯  1.3% / 1.0M  ❯  🔌 MCP: 2 servers enabled  ❯  📡 local (5)  ❯  🟢 relay
```

## RUN 2 — reproducibility (fresh pane, fresh pi --no-session, fresh seed;
identical recipe) — captures verbatim

**Capture A2 (space tick):**

```
The
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT
Fed
glm-5.3  ❯  high  ❯  1.3% / 1.0M  ❯  🔌 MCP: 2 servers enabled  ❯  📡 local (5)  ❯  🟢 relay
```

**Capture B2 (after F):**

```
The F
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT
Fed
glm-5.3  ❯  high  ❯  1.3% / 1.0M  ❯  🔌 MCP: 2 servers enabled  ❯  📡 local (5)  ❯  🟢 relay
```

**Capture C2 (after Escape):**

```
The F
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
NORMAL

glm-5.3  ❯  high  ❯  1.3% / 1.0M  ❯  🔌 MCP: 2 servers enabled  ❯  📡 local (5)  ❯  🟢 relay
```

## Verdict per step

| Step | Expected | Run 1 | Run 2 |
|---|---|---|---|
| Path check | one-line widget offer under input | PASS | PASS |
| Capture A — space tick | `Fed` visible with NO key after Space | PASS | PASS |
| Capture B — after `F` | narrowed offer persists (no close) | PASS | PASS |
| Capture C — Escape | dismissed + forwarded stock behavior | PASS | PASS |

## Divergence log

**None.** The real stack matched the unit harness's prediction at every
step, in both runs — including the exact tick the bug-hunt flagged as
harness-maskable (the arming-tick paint landed in the live render frame,
not a harness-only microtask). Nothing to route to P2.M2.T2.S2 from this
item. (The spec-07 step-3 "trailing space → hidden" tension already
recorded in test/widget-visibility.test.ts predates this run and remains
P2.M2.T2.S2's — this run's evidence is consistent with the spec-07
h2.53-intent reading the unit pins already took.)

## Instrumentation

**None used** — capture-pane alone sufficed (same as the M1-DoD live
smoke). No `appendFileSync` probe was ever added. Proof at close:
`git diff | grep -c appendFileSync` → `0`.

## Cleanup

`tmux kill-session -t hapaxbug003` after run 2 (only pre-existing,
unrelated sessions remain). Final gates: `npm run check` + `npm test`
green; tree carries only this run note + the cross-reference comment in
`test/widget-visibility.test.ts` (pointing here from S1's flipped
space-tick pins).
