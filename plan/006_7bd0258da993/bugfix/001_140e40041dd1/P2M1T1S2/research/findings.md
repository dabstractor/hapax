# Research findings — P2.M1.T1.S2: Live TTY verification of the space-tick paint

## The fix under test (P2.M1.T1.S1 PRP, treated as contract)

- `zeroCharOffer(word, now): boolean` helper in src/pi/widget.ts factored from armed-branch
  (a)-offer body (≈:889-906 succ build + :931-956 paint ladder); called at the typed-word
  arming site (≈:1013-1027) after `chain.arm` + `grant.reset()` + grant tick prefix `""`;
  painted → `return state()` WITHOUT `closeWith(now)`; no successors → fall through to
  `closeWith(now)` (zero-candidate invariant).
- S1 pins (unit): space tick → visible=true, currentSet series-first `[Fed, …]`; second
  identical tick idempotent; `F` narrows via branch (b) park/swap (no close+reopen);
  chainIntent bypasses R5 hesitation; one-shot grant survives.
- S1's Level 4 explicitly defers live TTY to THIS item (S2) citing spec/09 :291-314.

## Prerequisites confirmed live-reachable

- BUG-001 fix (P1.M1.T1.S1) marked Complete: index.ts passes the enriched runs payload →
  seeded message "The Fed raised rates today" yields series-marked the→Fed successor in the
  REAL store (typed-word arming gate needs series successors).
- Config defaults (src/pi/config.ts :134-135): `menuDelayMs: 0`, `enableChaining: true` —
  no config override needed for the live run (chainIntent bypasses R5 anyway per S1).
- Widget vs fallback path: widget path needs an editor factory; the prior live smoke
  (docs/M1-DoD.md :1055+) captured a widget line under the input in the same environment,
  proving the stock `pi --no-session` setup renders the widget. Verify at capture time:
  one-line under input = widget path; vertical menu = fallback (wrong path — record it).

## The binding technique (spec/09-testing-and-acceptance.md :291-314; AGENTS.md)

- `pi --no-session` in a tmux pane (200×50 per precedent) — real TTY required; piping
  stdout makes pi exit silently.
- Seed: submit ONE short user message, then Ctrl+C the turn; wait out the 300 ms ingest
  debounce before probing.
- `tmux send-keys` ONE CHAR AT A TIME, 0.08–0.12 s sleeps — bursts cancel in-flight
  autocomplete queries (documented false-conclusion source). Uppercase literal `T` works
  via send-keys.
- Assert via `tmux capture-pane` (prior format: input line, separator, mode tag, widget
  line directly under input — quoted verbatim in run notes).
- Temporary `appendFileSync` behind an env var in src/pi/provider.ts is SANCTIONED but
  MUST be removed before commit (git diff clean). Precedent needed zero instrumentation —
  prefer capture-pane only.

## Line-claim interplay (architecture/bug003-004-widget-provider.md :145)

An arming-tick paint makes the space tick CLAIM the row (if unclaimed this prompt) and
show content — a first-arm claims; if a prior offer already claimed, the change is
content-only. Live-visible layout behavior is exactly why this verification is binding.

## Divergence protocol (item contract, spec 09 ground-truth rule)

If the real stack diverges from the unit harness (e.g. W1 microtask render timing,
paint-not-visible at tick), STOP and record the divergence for the drift report —
routed to P2.M2.T2.S2 — rather than forcing the test. The live result is ground truth.

## Output homes

- Run notes: new file in plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/
  (e.g. live-tty-bug003-run-notes.md) with verbatim capture-pane transcripts.
- Optional test-file comment cross-reference in test/widget-visibility.test.ts near the
  flipped timing pins.
- Drift items → P2.M2.T2.S2 (spec-drift report compiler). Mode A: run-note rides with
  the verification.

## Key anchors

- spec/09-testing-and-acceptance.md :291-314 (technique), :291 heading "Live verification
  technique (binding)"
- docs/M1-DoD.md :1055-1100 (prior live smoke precedent, verbatim captures, zero
  instrumentation, git-clean check)
- architecture/bug003-004-widget-provider.md §1.2.3 area (:15-76 BUG-003 mechanics,
  :145 line claim, :273-300 technique quote)
- architecture/repo-governance-and-conventions.md §2 (technique summary + integration
  acceptance items 8/9/10 context)
- src/pi/widget.ts: arming site ≈:1013-1027, (a)-offer ≈:889-956 (post-S1: zeroCharOffer)
- Commands: `npm run check`, `npm test` (no live-code change expected in this item)
