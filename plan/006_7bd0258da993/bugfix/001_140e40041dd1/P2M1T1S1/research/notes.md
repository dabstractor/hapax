# P2.M1.T1.S1 research notes — BUG-003 zero-char offer timing (widget path)

Primary source: `plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/bug003-004-widget-provider.md`
§1 (read in full this session — every quote below verified against it and the live tree).

## Verified code facts (src/pi/widget.ts, current tree)

- Armed-branch consult top of evaluate ≈:829; grant tick block :873-885 with the
  "tick BEFORE any paint" discipline; (a) zero-char offer :889-906; paint ladder :931-956
  (!visible → paint; sig===displayedSig → idempotent paint; debounceMs elapsed → paint;
  else parkSwap); (b) typed-fragment filter :907-929; (c) reset fall-through.
- chainShim ≈:683-694 (series run casing via nextDisplay, description "chain", tier omitted).
- closeWith :713-716 = hide() + closeAt stamp; paint() :718-737 clears closeAt + suppression
  flags + calls deps.onPaint?.().
- Typed-word arming site :≈995-1027, comment :1005-1007 forbids painting there (to be
  rewritten). Gates: trailing space/tab, no '@'/'/', typed word, enableChaining, chain idle,
  first char A–Z, topSuccessors(lower).some(s => s.series).
- W1 microtask tick ≈:1597-1607 (queueMicrotask → machine.onInput → requestRender) —
  evaluate() sees the POST-keystroke buffer, so an arming-site paint lands in the same frame.
- NAME COLLISION: unrelated "BUG-003" comment ≈:640-660 (start-0 dismissal fix, 2026-10).
- Line claim: only painted lines claim (render override ≈:1873-1876).

## Guard interactions (research §1.4 — pre-analyzed)

- R5 hesitation: only gates the normal-path !visible word-mode paint; the helper keeps
  chainIntent = true and paints through its own paint() → never held. Proving test uses
  menuDelayMs 5000.
- closeAt/fresh-reopen: painting INSTEAD of closeWith leaves no closeAt stamp — fine;
  paint() clears closeAt anyway. Precedent: post-Tab close-then-paint.
- Double-paint: identical-buffer next tick → sig-identical idempotent; typed letter → (b)
  narrowing via parkSwap — never close+reopen.
- Grant (src/pi/chain-grant.ts:56-88): first post-reset tick sets seen=1, never spends;
  ''→'f' is not a new word → one-shot survives into the offer word. Tick before paint.
- Empty set impossible via gates (series .some guarantees ≥1) but helper guards anyway
  (zero-candidate invariant).

## Pinned tests (to flip)

- test/widget-visibility.test.ts :1244 describe "close-on-space typed-arming × visibility
  (P1.M2.T2.S2)": `expect(machine.getState().visible).toBe(false); // arm-and-close` at the
  "The " tick → flip to true with currentSet ["Fed"] (that store has only the series
  successor). Harness fakeEditor/machine :59-100.
- test/widget.test.ts ≈:2422 describe "widget typed-word arming + series-first offers":
  seedTheFedStore :2388-2406 (the→Fed series run + the→market ×5); comment currently hedges
  "whether the offer landed on this tick or the settle-wake's re-evaluation" — tighten to the
  same-tick contract. makeInsertHarness :852-960 (restoreReady: Promise.resolve() at :922 is
  what masked the timing), typeChar :2000-2008.

## Spec tension (Mode A — no spec edits here)

- spec/07-completion-ui.md M2 armed(W) :≈688-715: "offer the successors of W immediately …
  before the user types anything" → requires the space-tick paint.
- spec/07 step 3 :336-337: "trailing space → hidden" → what current code honors.
- Resolution: implement M2 timing in code; record the step-3 armed-exception as drift for
  P2.M2.T2.S2 (the drift-report task). AGENTS.md spec-sync is satisfied at the changeset level
  by that later task per the plan's Mode A declaration.

## Neighbor scope checks

- P1.M2.T2.S1 PRP (read): path-display e2e (index/provider/widget Tab insert) — disjoint
  describes in widget.test.ts; no conflict.
- P2.M1.T1.S2: live TTY verification of this fix — explicitly NOT in S1.
- Tab-accept-originated arms and the fallback path are already correct / owned by pi-tui:
  untouched.
