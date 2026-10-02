# Plan 005 P1.M2.T1.S3 — live smoke in tmux (4 scenarios), capture-pane evidence

BINDING live verification per spec/09 h2.57: the widget arrow-interaction
model v2 (boundary pass-through + interaction carousel, P1.M1.T1.S1–S3)
driven against the REAL extension stack (real TTY, real pi-tui editor, real
key timing) in a tmux pane, covering the four PRD R4 scenarios. Evidence
below is verbatim `tmux capture-pane` output, formatted for verbatim reuse
by P1.M2.T1.S4's DoD gauntlet append (docs/M1-DoD.md item-4 precedent,
~L1056–1210).

## Environment (echoes P1.M2.T1.S2's research/gauntlet-evidence.md)

- **Date:** 2026-09-30 (session run) · record written same day
- **Head commit:** `a2e9470` (`a2e94703d1488191f32db10a50aaa9c961ffeeeb`) —
  the exact tree S2 certified green (gauntlet: `npm run check` exit 0,
  `npm test` 1126 passed | 1 skipped, bench 9/9 gates)
- **tmux:** 3.7c · **pi:** 1.0.0 · **Node:** v26.10.0 (per S2's record)
- **Pane:** 200×50 (`tmux new-session -d -s hapax-smoke -x 200 -y 50`)
- **Launch:** `cd /home/dustin/projects/hapax && pi --no-session` (the repo's
  `package.json` `"pi".extensions` auto-loads hapax; the TUI needs a real
  TTY — piped stdout exits silently, everything ran inside the pane)
- **Seed (submitted, turn then cancelled):** `The zendesk lwlock zephyr
  verdigris kestrel scribe unsaidlock thread - note zendesk zorvex zendral
  twice.` — engineered so `ze` offers ≥2 words and `lw` exactly 1. Two
  earlier seed drafts were discarded before this one (see honesty notes);
  the shipped store held exactly the admitted vocabulary
  zendesk/lwlock/verdigris/kestrel/unsaidlock/zorvex/zendral (group 0,
  dictionary-absent), confirmed by the rendered menus below.
- **Widget line (canonical):** `zendesk | zendral | zorvex` for fragment
  `ze` — the 2026-10 owner rank order (tier → sessionCount desc → shorter →
  byte-lex; `zendesk` ×2 in the seed tops) — one line below the input.

## Pacing (binding technique, as executed)

Typed strings went in ONE CHARACTER AT A TIME, each keystroke verified
landed (cursor-position handshake) before the next — never a burst. The
sanctioned floor (0.10–0.12 s between keys) was superseded by this
handshake pacing after the pty-backlog discovery (honesty note 1): the
handshake is strictly SLOWER than the floor, so the anti-burst rule is
satisfied with margin. Arrows / Tab / Enter / Escape were single
`tmux send-keys` events with 0.4–0.5 s settle. Captures were taken ~0.6 s
after the final keystroke of each probe (100 ms display debounce well
settled), matching the precedent's timing note. Every capture below carries
a `# cursor: x=… y=…` header line — `cursor_x` is the input caret column;
`cursor_y` dropping 46→47 is itself dismissal evidence (the widget line
left the layout).

Evidence method: `tmux capture-pane -p` for pane text, plus `capture-pane
-p -e` (escape sequences) for the highlight — the theme accent
(`38;2;167;152;215`, theme.selectList.selectedText) marks the highlighted
word and is invisible in plain captures. **Zero instrumentation was
needed — no `appendFileSync` probe was ever added** (grep proof below).

---

## Scenario (i) — un-entered ← mid-word: one-press boundary pass-through — PASS

Pacing: `ze` typed char-by-char (handshake); captures ~0.6 s after each
key event.

BEFORE the press (line visible, caret at line end, un-interacted):

```
# cursor: x=2 y=46
ze                                          ← input line
──────────────────────────────────────────
INSERT
zendesk | zendral | zorvex                  ← widget line (3 items, ≥2 as required)
```

ONE `Left`:

```
# cursor: x=1 y=47
ze                                          ← input line: caret moved 2→1
──────────────────────────────────────────
INSERT                                      ← NO widget line: dismissed
```

Reading: BOTH pass conditions hold on the SINGLE press — the caret moved
one char left (x=2→1) AND the widget line dismissed (y 46→47: the widget
row left the layout). One press, both effects — v2 row 2
(boundary-pass-through), no carousel entry.

Second `Left` (suppression check):

```
# cursor: x=0 y=47
ze                                          ← caret 1→0: plain movement
──────────────────────────────────────────
INSERT                                      ← NO re-offer: suppression held
```

Reading: the second Left is plain caret movement — the dismissed
generation's suppression keeps the line hidden even though the fragment
still matches.

Re-offer at a fresh word start (typed ` z` then one more char; see honesty
note 3 for the threshold precision):

```
# cursor: x=5 y=46
ze ze                                       ← fresh word typed
──────────────────────────────────────────
INSERT
zendesk | zendral | zorvex                  ← line RE-OFFERED at the new word
```

Reading: the line re-offers once the fresh word's fragment reaches the
configured query threshold (config `threshold: 2`): the 1-char fragment
`z` ("ze z") produces no match state at all (nothing to offer — capture
`s1-reoffer-at-word-start.txt`), and at `ze` the line returns with a FRESH
generation — proving the suppression RELEASED (a leaked suppression would
have kept it hidden; the release test — different word start AND
non-continuation buffer — is what this beat demonstrates).

## Scenario (ii) — → on a one-word line passes through — PASS

Pacing: `lw` typed char-by-char; captures as above.

BEFORE (fragment yielding EXACTLY one word):

```
# cursor: x=2 y=46
lw                                          ← input line
──────────────────────────────────────────
INSERT
lwlock                                      ← widget line: EXACTLY 1 item
```

ONE `Right`:

```
# cursor: x=2 y=46
lw                                          ← caret unchanged: → at EOL is a
──────────────────────────────────────────     plain-pi no-op (parity noted)
INSERT
lwlock                                      ← line STAYS visible, un-interacted
```

Reading: the one-word line never becomes interacted — Right is FORWARDED
verbatim (row 3: count=1 → forward, nothing to enter). The caret stays at
x=2 because the caret was already at end-of-line; plain pi's → at EOL is
the same no-op (parity confirmed by observation — arrows forwarded during
scenario (i)'s suppression phase moved the caret 0→1→2 visibly, so the
forward path itself is caret-live).

Follow-up `Left` (still boundary pass-through, NOT carousel wrap):

```
# cursor: x=1 y=47
lw                                          ← caret 2→1
──────────────────────────────────────────
INSERT                                      ← dismissed on the same press
```

Reading: a following Left dismisses AND moves — boundary pass-through, not
a wrap-to-itself navigate; the one-word line never entered the carousel.

## Scenario (iii) — multi-word line: enter, carousel both edges, Escape, re-offer — PASS

Pacing: `ze` typed char-by-char; arrows/Escape single events, 0.5 s settle;
highlight read from the styled capture (`capture-pane -p -e`, accent
escape shown as `<acc>` below = `^[[38;2;167;152;215m`).

BEFORE (un-entered, highlight on FIRST word):

```
# cursor: x=2 y=46
ze
──────────────────────────────────────────
INSERT
<acc>zendesk | zendral | zorvex             ← accent on word 1 (s3-before.styled)
```

ONE `Right` — enters the carousel (generation now interacted):

```
zendesk | <acc>zendral | zorvex             ← accent moved to word 2 (s3-entered.styled)
```

ONE `Left` — back to the first word:

```
<acc>zendesk | zendral | zorvex             ← accent on word 1 (s3-back-first.styled)
```

ONE more `Left` — WRAPS to the LAST word:

```
zendesk | zendral | <acc>zorvex             ← accent on word 3 (s3-wrap-last.styled)
```

ONE `Right` — WRAPS to the FIRST word:

```
<acc>zendesk | zendral | zorvex             ← accent on word 1 (s3-wrap-first.styled)
```

Reading: after interaction the carousel wraps BOTH edges — 0 steps Left
from the first word lands on the LAST (modular `(0−1) mod 3`), and one
Right from the last lands on the FIRST (`(2+1) mod 3`). Plain ±1 wrap
representation, exactly the v2 wiring.

`Escape` — exit:

```
# cursor: x=2 y=47   mode=INSERT
ze
──────────────────────────────────────────
INSERT                                      ← line dismissed; mode STAYED INSERT
```

Reading: the widget CONSUMED the Escape — dismissal with suppression AND
the editor never left INSERT mode (pi-vim, which flips INSERT→NORMAL on a
forwarded Escape, never saw it — mode tag verbatim INSERT). Suppression
held through the next capture.

Fresh word re-offer (typed ` ze`) — fresh generation:

```
# cursor: x=5 y=46
ze ze
──────────────────────────────────────────
INSERT
<acc>zendesk | zendral | zorvex             ← re-offered, accent back on word 1
```

ONE `Left` — pass-through available again on the fresh generation:

```
# cursor: x=4 y=47   mode=INSERT
ze ze
──────────────────────────────────────────
INSERT                                      ← dismissed + caret moved (5→4)
```

Reading: the fresh generation is un-interacted — one Left dismisses and
moves the caret (boundary pass-through), never a wrap. The full lifecycle
(un-entered → interacted → wrapped both edges → Escape → suppressed →
re-offered fresh → pass-through restored) is evidenced end-to-end.

## Scenario (iv) — Tab inserts and Enter submits while visible — PASS

Pacing: as above; Tab/Enter single events, 0.5 s settle.

(a) **Tab on an UN-interacted line inserts the TOP word:**

```
# cursor: x=2 y=46                          BEFORE
ze
──────────────────────────────────────────
INSERT
zendesk | zendral | zorvex
```

```
# cursor: x=7 y=47                          AFTER ONE Tab
zendesk                                     ← fragment `ze` replaced by the TOP word
──────────────────────────────────────────
INSERT                                      ← dismissed after accept
```

Reading: Tab inserted `zendesk` (top-ranked), consuming the typed
fragment; the line dismissed on accept. (Documented side effect, verified
live: this Tab accept ARMS the chain — the next word's widget then offers
the chain successor, a single `zorvex`, capture `s4b-before.txt` /
`s4b-tab-after.txt` showing `zendesk zorvex` after Tab. Consistent with
the chain contract; noted because it shaped beat (b)'s setup.)

(b) **Tab on an INTERACTED line inserts the HIGHLIGHTED word.** A comma
was typed first (word-less input disqualifies and RESETS the armed chain —
verified: the next `ze` offered all three words again):

```
# cursor: x=18 y=46                         BEFORE (after ONE Right)
zendesk zorvex, ze
──────────────────────────────────────────
INSERT
zendesk | <acc>zendral | zorvex             ← accent on word 2 (s4b2-interacted.styled)
```

```
# cursor: x=23 y=47                         AFTER ONE Tab
zendesk zorvex, zendral                     ← the HIGHLIGHTED word inserted (not top)
──────────────────────────────────────────
INSERT                                      ← dismissed after accept
```

Reading: with the highlight on the 2nd word, Tab inserted `zendral` — the
highlighted candidate, not the top (`zendesk`). Cursor advanced by
exactly the inserted word's length (18→23), fragment replaced.

(c) **Enter submits while visible (never inserts):**

```
# cursor: x=27 y=46                         BEFORE
zendesk zorvex, zendral, ze
──────────────────────────────────────────
INSERT
zendesk | zendral | zorvex
```

```
# cursor: x=0 y=47                          AFTER ONE Enter   mode=INSERT
                                            ← input line CLEARED
 ⠋ Working                                  ← message SUBMITTED: model turn started
──────────────────────────────────────────
INSERT                                      ← line dismissed, nothing inserted
```

Reading: Enter dismissed the visible line AND submitted the message — the
input cleared (x 27→0) and a model turn started on the submitted text
(the transcript reply, captured in `s4c-transcript-final.txt`, analyzes
exactly this text). No word was inserted; dismiss-then-forward per v2 row
10.

---

## Honesty notes

1. **pty input backlog (environment, procedure adapted):** with the relay +
   MCP extensions polling in the background, this pi build's input reader
   intermittently stalls; keystrokes sent while stalled are not lost but
   REPLAY LATE (observed: a `ze` typed minutes earlier surfacing mid-line
   as `zeeze`). Two early capture sessions were discarded as contaminated
   and every scenario re-run under HANDSHAKE pacing (each keystroke
   observed in the cursor position before the next; verified-clear loops
   confirm the input row empty before each scenario). Handshake pacing is
   strictly slower than the sanctioned 0.10–0.12 s floor — the anti-burst
   rule is satisfied with margin; the recorded captures are from the clean
   sessions.
2. **Interrupt keybind (matches the M1 precedent):** `Ctrl+C` did not
   cancel a working turn on this build; the live-cancel is pi-vim's
   `Escape` ×2 (first Escape INSERT→NORMAL, second aborts — "Operation
   aborted"). Seed finalization worked as the spec describes (the store
   seeds from the user message before/regardless of model output). Stray
   "Operation aborted" lines visible in some transcript areas are stale
   paint from these seed-phase aborts, not scenario events.
3. **Re-offer threshold precision (procedure semantics, not drift):** the
   scenario text says the line "re-offers at the new word start" after
   "a space + first char". With the shipped `threshold: 2`, a 1-char
   fragment produces no match state at all (no query, no offer — capture
   `s1-reoffer-at-word-start.txt`); the re-offer rendered at the fresh
   word's SECOND char (`ze`), which is what releases the suppression and
   re-opens the line. The PASS rests on the suppression-release
   observable (the line returns for a fresh word and pass-through works
   again), which is the v2 property under test; a 1-char re-offer would
   require `threshold: 1` (a config choice, not a widget behavior).
4. **Highlight observability:** the theme accent is invisible in plain
   `capture-pane -p`; all carousel beats were additionally captured with
   `capture-pane -p -e`, where the accent escape
   (`^[[38;2;167;152;215m`, theme.selectList.selectedText) marks the
   highlighted word verbatim. No instrumentation was needed — the
   sanctioned provider.ts probe was never added.
5. **Chain arming on Tab accepts (documented, verified live):** a Tab
   insert arms the chain at the accepted word, so the immediately
   following word's widget offers the chain successor (single item,
   capture `s4b-*`). Scenario (iv)(b) resets the chain with a comma
   (word-less disqualification) to reach a 3-item line for the
   highlight-Tab beat. This is shipped chain behavior (P1.M1.T2), not a
   widget-arrow concern; recorded so S4's readers can reproduce.
6. **Store/menu facts:** `zephyr`, `scribe`, `thread` are
   dictionary-attested and REJECT under the 2026-09 `R_eff` curve — the
   seed's z-family in the store is exactly zendesk/zorvex/zendral, which
   is why `ze` offers precisely those three. Menu order
   `zendesk | zendral | zorvex` follows the 2026-10 owner rank order
   (tier → sessionCount desc → shorter → byte-lex; `zendesk` ×2).

## Tree cleanliness (post-smoke)

- **Zero instrumentation:** no `appendFileSync` probe was ever added; the
  sanctioned `HAPAX_SMOKE_LOG` seam was never used. `grep -rn
  "HAPAX_SMOKE_LOG\|appendFileSync" src/pi/provider.ts src/pi/widget.ts`
  → no matches.
- `git status --porcelain src/ test/ spec/ README.md docs/` → **empty**
  (zero source/test/spec/doc edits; the only tree change is this
  `research/` directory).
- The tmux session `hapax-smoke` was **killed** after the captures
  (`tmux kill-session`; `tmux ls` no longer lists it). Nothing persists.

## Reproduction

```bash
tmux kill-session -t hapax-smoke 2>/dev/null
tmux new-session -d -s hapax-smoke -x 200 -y 50
tmux send-keys -t hapax-smoke 'cd /home/dustin/projects/hapax && pi --no-session' Enter
# wait for the INSERT-mode input box, then (all sends one key at a time,
# each observed landed before the next — handshake pacing):
#   seed: type the seed message, Enter, wait for the turn, Escape, Escape, i
#   probe `ze` (expect 3-item widget) and `lw` (expect exactly `lwlock`)
#   scenarios (i)→(iv) per the sections above, capturing before/after:
tmux capture-pane -t hapax-smoke -p        # plain pane text
tmux capture-pane -t hapax-smoke -p -e     # styled: the <acc> highlight
tmux kill-session -t hapax-smoke
```

Raw pane dumps for every quoted capture: `research/captures/*.txt`
(plain) and `*.styled.txt` (escape sequences).
