# 09 — Testing and Acceptance

## Unit tests (per module)

**segment.test.ts**
- Atomic identifiers (2026-10 owner rule): `fixRoundingError`,
  `HTTPServer`, `session_token_valid`, `utf8Reader`, `__init__`, and
  `searchReplacementDownloads` each yield EXACTLY ONE draft — the whole
  token; no camel/snake parts ever surface.
- Hexish: `f3a9c2e` captured; `123456` (no letter) not; 41+ chars not.
- CJK run skipped; ASCII resumes after.
- Hyphenated compounds are ONE token (2026-09 rule 4b): `state-of-the-art`
  → single token; apostrophes still split (`don't` → `don`); `--flag`/`-v`
  never form tokens. Threshold fragments admit inner/trailing hyphens
  (`load-b` → prefix `load-b`).
- Path-shaped runs are ONE token (2026-10 rule 4d): `src/core/query.ts`
  (2 interior slashes), `/home/user/projects/hapax` (key trims the
  leading `/`, display keeps it), `docs/architecture.md` (slash+dot),
  `../tools/build.mjs` (leading `../` edge-trimmed from the key,
  preserved in display), `example.com/a/b` (URL host+path). Contained
  base/hexish/filename tokens are absorbed (`query.ts` never surfaces
  alone inside a path span). Line/col trim: `src/foo.ts:42:13` →
  `src/foo.ts`; `4:36` and `localhost:8080` keep their colons. Guards:
  `and/or` (single slash, no dot) is NOT a token; interior `..`
  (`a/../b`) rejects whole; path key cap 96 (96 admits, 97 shreds).

**shapeGate.test.ts** (each rule is a case)
- Accept: `zendesk`, `lwlock`, `NREL`, `f3a9c2e`.
- Reject: `aaaaa`, `aaaaaaa`, `sk-abc123DEF456...`, `ghp_...`, `eyJhbG...`,
  20+ pure hex, `qqqxxxzzzvvv` (consonant run), `ab` (low entropy — since
  the 2026 floor drop it is length-legal; every 2-char key dies at
  entropy, max H = 1.0), single chars (too short), 65+ chars (base class; path class rejects
  above 96, rule 4d), base64 ≥ 24 mixed.

**score.test.ts**
- Admission is length-conditioned (2026-10 gradient; assert relative to
  the imported constants/R_eff, not absolute quants): floor hold —
  q ≥ 30 rejects at any length ≤ 8; sqrt ramp 9–19 (boundary probes,
  e.g. q=94 admits / q=95 rejects at 9 chars; 10-char 110/139,
  14-char 189/190); admit-all at len ≥ 20;
  every attested admission lands at GROUP 1 (flat — the old group-2
  band stays dead); absent → group 0; the `rejectCommonness` override
  moves the floor and the curve scales from it.
- Proper-noun relief stays retired: the ceiling equals the floor band,
  so no capitalized table-reject ever relieves — under the 2026-10
  ramp, long capitalized words that admit do so via R_eff at group 1,
  not relief.
- Conjugation guard: inflection whose stem is reject-common rejects
  (any q of the word); absent word + mid-band stem rejects; e-restoration
  and doubled-consonant stems match; properName drafts skip the guard;
  stem comparisons ride R_eff(len(word)) (2026-10) — `uploads` (7c,
  stem q=38) rejects, `configurations` (15c, stem q=26) admits; the
  rejectCommonness override moves the floor the curve scales from.
- Salience arithmetic: construct store entries, assert exact values for
  hand-computed cases (frequency term, recency decay at τ=20, sticky
  userTyped, properName, rarity bonus).
- Eviction ordering (salience × slower τ=50 decay) — menu ordering is
  NOT salience (see below).

**query.test.ts**
- Anchor: the fragment's first char must equal the candidate's first
  char (`esk` never matches `zendesk`; mid-identifier entry from
  non-initial fragments is gone — the 2026-10 atomic-identifier rule
  removed sub-word candidates); case-insensitive throughout.
- Tier classification: exact prefix (3) / contiguous tail (2: `zsk` →
  `zendesk`, `zlock` → `z_lwlock`) / scattered (1: `hrp` →
  `handleResponseProxy`).
- Admission score + threshold: below-`fuzzThreshold` matches never
  render; `fuzzThreshold: 100` = exact-prefix-only mode; score
  arithmetic per 04's formula for each tier. Tier-1 gap-size scaling
  (2026-10 retune, 04): the single-1-char-hole class admits at the
  ambient default (`delt`→`delete` = 62 ≥ 60 — the retune's motivating
  case; `del`/`delet` stay tier-3 100); every looser scattered shape
  gates at 60 (2-char hole 59, a second gap ≤ 54 — e.g. the two-gap
  `dlvr`→`deliver` = 54); gapChars saturates via `min(3·gapChars,
  15)`; `#cfg` admits at the trigger default 45 (62), retiring the
  first calibration's erratum (max 44 admitted nothing at 45).
- Ranking: tier descending always (a 1-count exact-prefix word
  outranks a 40-count scattered match, which outranks any tier-0
  anchorless run); sessionCount descending within
  a tier (counts reorder ONLY same-tier neighbors); shorter key, then
  byte-lex, as final ties; zero-fragment (`#` alone) = sessionCount
  desc then ties; plural pruning still runs before the limit slice.
- Tier-0 anchorless fallback (2026-10): the contiguous run matches
  ANYWHERE in the key (`esk` → `zendesk`, `query` →
  `src/core/query.ts`); fragment floor 3; score 85 − 40·runStart/len
  (position-gated at the default 60); fires ONLY when the anchored
  scan returns zero — a non-empty anchored result is byte-identical
  to pre-tier-0 output; `#` mode consults tier-0 unconditionally AND
  surfaces scattered tier-1 at its 45 default (`#cfg` → `config`);
  an explicit fuzzThreshold overrides both mode defaults; successor
  chains arm/extend on anchored tiers only.

**store.test.ts**
- Upsert merge semantics (count, ordinals, sticky flags, rankGroup min).
- Eviction: insert 20,001 → exactly one eviction pass (a full 256-victim
  batch, per spec/06's batch-of-256 rule), dropping the lowest
  evictionScore victims; userTyped survives.
- Prefix index rebuild-after-dirty correctness.
- Branch purity (2026-10, spec 06): replaying a fixed message sequence
  twice yields identical stores; a store built incrementally
  (message_end sequence) equals the store rebuilt from a `getBranch()`
  snapshot of the same sequence — no dead-branch words survive, nothing
  double-counts.

**dictionary.test.ts**
- Round-trip: build a tiny table in-memory (10 words), write format, load,
  assert every lookup, absent → null, no allocation in lookup (optional
  via node `--expose-gc` smoke test).
- Corrupt file (bad magic, truncated) → load throws.

**provider.test.ts (fallback path)**
- Trigger regex: `#`, `#ze`, mid-line `foo #ze`, `foo#ze` (no match — needs
  start/whitespace), two `##` → no match.
- Word matching: 1-char fragment answers (auto-open contract — pi-tui
  only asks at word starts, effective threshold 1); case-insensitive
  `nrel` → `NREL` insertion casing.
- Enter-submits proxy (test/editor-enter.test.ts): Enter + open word
  menu → cancel then delegate exactly once; slash menus, closed menus,
  non-submit keys untouched; the inner instance is NEVER mutated (v1
  recursion regression pin); proxy get/set/has forwarding, the
  thenable guard, and the onKeystroke input-clock hook (fires for every
  input event; a throwing hook never breaks input).
- Startup gate (test/startup-gate.test.ts): queries racing an
  unfinished replay wait for settled then query; the wait is bounded
  (≤ maxWaitMs); settled gate is pure pass-through; a rejected replay
  promise never wedges it; restoreFromHistory's onSettled fires
  exactly once (finish, abort, empty).
- Branch rebuild (2026-10, spec 05): `session_tree` discards the pending
  ingest queue (queued-but-unflushed texts from the dead branch never
  reach the new store; texts on the new path are re-captured by the
  snapshot — never lost, never double-counted); `newLeafId === oldLeafId`
  skips the rebuild; queries during the replay window wait behind the same
  bounded gate as resume.
- Chain one-shot grant (test/chain.test.ts): typing through the granted
  offer disarms at the next word boundary (normal gated path answers);
  same-word narrowing (incl. backspace) keeps the chain; acceptance
  re-arms with a fresh grant.
- Zero candidates → delegate/empty, never a menu.
- Debounce: two rapid set updates → only one swap at +100 ms; Tab mid-debounce
  resolves the live (undebounced) top item.
- Tab-only-completes: Tab with a live set completes the selected (or top)
  item and never opens/toggles a menu; the menu appears automatically on
  the 1st char of a matching word and on the 1st char after the trigger
  char, with no manual open gesture of any kind; completion is exactly one
  keypress. Includes the forced path: `getSuggestions` with
  `force: true` + live fragment MUST return exactly one item (the live
  top / chain successor) so pi-tui's single-item fast path applies it —
  assert Tab-before-paint completes rather than opening the menu.
- Hysteresis: narrowing keystroke must not emit close+reopen (assert via
  recorded provider emission sequence).
- Delegation: no fragment → `current.getSuggestions` called with unchanged
  args (path completion intact).

**widget.test.ts (primary path, M3)**
- Visibility machine: word-start fragment + candidates → line shows;
  trailing space (no `@`/`/`) → hides; path/slash/`@` contexts never
  show; zero candidates never render content (unclaimed: no row;
  claimed: blank row — Line claim below).
- Suppression lapse (2026-10, spec 07): after explicit dismissal
  (Escape / boundary / Tab-accept / Enter-submit), a tick that
  OBSERVES the dismissed word occurrence gone — live buffer a prefix
  of the dismissed buffer no longer reaching the dismissed fragment's
  start (fully backspaced, empty buffer included) — releases
  suppression: retyping the SAME word at that word start paints (the
  Tab-completed FIRST word no longer wedges; mid-prompt recovery
  needs no space deletion). The completed word still on screen and
  same-word EXTENSION stay suppressed (rest-of-word + the immediate
  post-Tab re-offer guard).
- Line claim (2026-10, spec 07): the first non-empty display claims the
  row; from then on zero-candidate queries, disqualification and
  trailing-space closes, Escape/boundary dismissal, rest-of-word
  suppression, and stock-context hides render the row BLANK (present,
  empty) — never back to byte-identical inner lines while claimed;
  release fires on submit / `before_agent_start` / session rebind,
  after which no row renders until the next first-show; a prompt that
  never shows a result set never grows a row.
- Key handling (editor-proxy double): ←/→/↑/↓ all navigate once the
  list is entered; ↑/← on the first word of an UN-interacted
  generation FORWARDS to the editor — the line dismisses +
  suppresses AND the caret moves on that same press (one-press
  plain-pi parity; disqualification close does NOT suppress);
  un-entered Escape likewise dismisses + suppresses AND FORWARDS
  verbatim (the inner editor receives the exact bytes — plain-pi Esc
  parity; stock pi's cancel-request behavior is unchanged by the
  extension's presence), while an INTERACTED generation's Escape is
  CONSUMED (dismiss + suppress; the inner editor never sees it); →/↓
  with no word to navigate (one-word line, un-interacted) forwards
  verbatim and the line stays; Tab inserts the highlighted word
  synchronously (never debounce-gated); Tab with pi's own menu open
  (`isShowingAutocomplete() === true`) forwards verbatim — never
  inserts a hapax word over an open stock menu (P3.M1.T1.S1); Enter
  dismisses then forwards (submits); every other key forwards
  verbatim; the inner instance is NEVER mutated (v1 regression pin).
  Interaction carousel (2026-10; spec 07): the first
  highlight-MOVING arrow press (→/↓ entering an un-interacted
  multi-word line) marks the generation interacted — from then on
  ↑/← on the first word wraps to the LAST and →/↓ on the last word
  wraps to the FIRST (the clamp is retired — unreachable); a new
  result set resets the flag with the highlight and re-arms
  boundary pass-through; a pass-through press never sets the flag
  (a one-word line therefore never becomes interacted); Escape never
  sets the flag either, in either state.
- Insertion: replaces the word-regex span or `#fragment` with the
  candidate's display casing.
- Highlight resets to top on every set change; debounce/hysteresis
  and the startup gate carry over to the widget.
- Branch rebind (2026-10, spec 05/07): `session_tree` releases a claimed
  row and re-binds the widget to the rebuilt store — a fragment typed
  after navigation never completes from abandoned-branch vocabulary
  (store purity is asserted at the core layer; here assert the widget
  reads the new pipeline instance).
- Post-Tab extension offer (2026-10, spec 07): Tab-accept arms NO
  suppression. Ladder: `implem` → Tab inserts `implement` → extension
  offer renders (exact-equal excludes `implement`; shortest-first:
  `implements | implementation`) → Tab inserts top → recursion until
  the empty offer dismisses WITHOUT suppression; backspace after the
  empty-offer dismiss re-queries (fragment `implement` → offer
  re-renders); Escape/boundary on an offer suppresses rest-of-word
  (seam retained); the offer is a fresh generation (highlight reset,
  pass-through live); menuDelayMs bypass (intent show); extension
  accepts arm the chain on the FINAL accepted word.

## Integration acceptance (manual or scripted via pi)

1. **Happy path:** session discussing `Zendesk` + `lwlock`; type `ze` → menu
   offers `Zendesk`; Tab inserts `Zendesk` (cased). Type `#l` → `lwlock`.
   (M3 widget: the offer is one line below the input — `Zendesk | …`;
   arrows move the highlight once the list is entered; ← on an
   un-entered list moves the caret on that same press and the line
   dismisses with it — boundary pass-through, one press; entered
   lists carousel at both edges and Escape is the exit.)
2. **No-hijack (amended 2026-10):** type ordinary prose continuously;
   keystrokes land verbatim, no menu for the common PROSE HEAD (the /
   with / context / everything class; 04) WITH ANCHORED
   MATCHES — the mid-frequency class (node/spec/turbine) DOES menu
   since the 2026-10 R=30 retune, owner-accepted; the zero-result
   tier-0 fallback MAY surface one-shot
   contiguous-run cousin menus (said→unsaid class, ~5–20% by length,
   narrowing away as typing continues; 04); Tab with no selection =
   literal tab. While the result line is visible only arrows/Escape/Tab
   are consumed — and arrows and Escape only once the list is entered
   (un-entered: boundary pass-through moves the caret on the same
   press, and Escape dismisses then forwards verbatim — with no
   key-consuming editor extension installed, the forwarded Escape
   cancels the in-flight request exactly as stock pi does).
3. **Restore:** `/resume` a 100k+ token session; store rebuilt in background
   (< 100 ms total); completions available within the first second.
4. **Compaction:** trigger compaction (long session + `/compact`); store
   survives; previously admitted words still complete.
5. **Secrets:** paste an API key into a user prompt; key never appears in
   suggestions afterwards (shape gate).
6. **Path completion regression:** quoted path completion, slash commands,
   and `@`-mention behaviors identical to stock pi.
7. **Conversational path completion (2026-10, rule 4d):** a path that
   appeared in conversation (user-typed or model output) is offered when
   its FIRST segment is typed — `sr` → `src/core/query.ts`, Tab inserts
   the whole path; an absolute path inserts with its leading `/`. Once a
   `/` precedes the cursor, stock pi file completion owns the rest
   (item 6 unchanged).
8. **Line claim (2026-10):** within one prompt, type a word whose
   suggestions show, then one with none, press Escape, keep typing —
   the input box never moves (tmux capture-pane: the editor's screen
   row is stable; the suggestion row goes blank, never away). Submit →
   the row is released; a suggestion-free stretch of the next prompt
   shows no row at all. Live verification mandatory — this is a
   layout behavior, invisible to unit doubles (§Live verification
   technique).
9. **Branch hygiene (2026-10):** the owner scenario, live: submit a prompt
   containing a rare misspelled word (dictionary-absent — probe with
   `node tools/calibrate-bands.mjs <word>`), Ctrl+C the turn, `/tree` back
   to that prompt, edit the misspelling out, resubmit — the misspelling
   never appears in suggestions or the `/acwords` store dump afterwards;
   the corrected word does. The `/tree` navigation itself shows no
   perceptible delay; completions on the first word typed immediately
   after navigation arrive late-but-present (gate) and settle within the
   bound. Item 4 (compaction survival) re-checked: unaffected absent a
   tree navigation; a post-compaction `/tree` rebuilds from the branch as
   replayable (accepted, 05).
10. **Post-Tab extension offer (2026-10):** live: type `implem`, Tab
    (→ `implement`) — the extension offer must appear without further
    typing — Tab again (→ `implementation`, or `implements` per the
    store), backspace recovery on a sibling fork, and Enter immediately
    after a Tab completion still submits (never accepts the offer).

## Live verification technique (binding)

Unit tests have repeatedly encoded wrong platform models — the editor,
the trigger plumbing, and the menu lifecycle behave differently in a
real TTY than in test doubles. UI-layer changes are verified live, not
by unit tests alone:

- Run an ephemeral instance: `pi --no-session` inside a tmux pane
  (pi's TUI needs a real TTY — piping stdout makes it exit silently).
  Seed the store by submitting one short user message, then Ctrl+C the
  turn.
- Drive keys with `tmux send-keys`, one char at a time with 0.08–0.12 s
  sleeps between them. A whole string sent at once is a burst, and
  bursts CANCEL in-flight autocomplete queries — different behavior
  from human typing, and the source of at least one false conclusion.
- Verify visible state via `tmux capture-pane`.
- Temporary instrumentation (`appendFileSync` behind an env var) in
  `src/pi/provider.ts` is the sanctioned way to observe internal state
  live; two bugs invisible to every test were found this way. Remove
  instrumentation before committing. The M3 one-line widget is the
  deepest UI-layer change yet (own rendering + own key handling): live
  verification against the real extension stack (pi-vim +
  split-editor) is mandatory before acceptance — the v1 proxy crash
  (07) is the precedent.

## Performance gates (CI-scriptable micro-benchmarks)

| Gate | Limit |
|---|---|
| 20k-candidate anchored-fuzzy query (first-char bucket + tiers + frequency sort + top 8) | < 1 ms p99 |
| Tier-0 anchorless fallback full-store pass (fires only on empty anchored result; also `#` loose-mode scans) | < 3 ms p99 |
| Dictionary load + full lookup sweep of 20k words | < 60 ms |
| Ingest 800 KB synthetic session text (≈ 02's 300k-token restore) | < 180 ms CI bound, yields every ≤ 64 KB |
| Steady-state heap delta (dict + store) | < 6 MB |

Benchmarks run with a synthetic dictionary fixture; numbers asserted loosely
(CI variance) — hard regressions (> 3× budget) fail.

Ingest (gate c) note — 2026-09-30, validation Issue 4: the original
< 60 ms headline was never met by the shipped implementation (healthy
baseline ~174–187 ms; ~92–104 ms after the admission-memoization work).
The operative user-facing budget is 02's restore figure — full
300k-token session < 100 ms total — which the 800 KB pass meets
(~97 ms); the CI gate enforces the 3× variance allowance (180 ms) as
the hard line. Do not re-tighten this row to 60 ms without
re-optimizing the ingest path first.

The `session_tree` branch rebuild (05) runs the identical restore/replay
code path — the existing ingest and restore budgets apply; no separate
gate row.

## Tuning protocol

Tuning surfaces: the runtime `rejectCommonness` and `fuzzThreshold`
config knobs (08 — the
floor of the length-conditioned curve; the anchored-fuzzy admission
threshold), and
the baked constants — the length-gradient parameters (floor R=30
(2026-10 width-bound retune; was 12), floor-hold 8, admit-all 20, sqrt
shape — 2026-10), the retired mid-band
and relief constants, conjugation-guard suffix set, salience weights
(2.0/3.0/1.5/0.8/1.0), fuzzy scorer tier bases/penalties (04 — tier
BOUNDARIES are semantics, never runtime-tunable; only the threshold
is). No phrase multipliers exist (the M2 successor
index has none). Protocol: change one constant (or the knob), run the
acceptance suite, A/B against a fixed 3-session corpus fixture
(`test/fixtures/sessions/`) checking precision@8 by hand-labeled expected
completions. `tools/calibrate-bands.mjs` is the measurement probe — word
verdicts, band populations, drift assertions; run it after any retune
or dictionary regen. No telemetry exists; tuning is fixture-driven by
design.

## Definition of done — M1

All unit tests green, integration items 1–6 pass, performance gates pass,
no persistence files written anywhere (assert store dir untouched), `pi
--check` (or lint) clean.

## Definition of done — M2

M1 done plus: successor-index chaining state machine with ZERO-typed-char
successor offers, live successor filtering, chain resets on
`before_agent_start`, the one-word invariant (no multi-word item is ever
offered — asserted in tests), and raw-text-adjacency window breaks:
commas, quotes/brackets/backticks, digits, non-word characters, intervening
words (stopword bridging forbidden), newlines. Integration item 7
(re-themed 2026-09: the PRD's `National` → `Renewable` → `Energy` →
`Laboratory` walk cannot run at the shipped floors — `national` (q=90)
and `energy` (q=94) reject at the floor length, so the bigram never
forms; the inversion is pinned in test/acceptance.test.ts, the re-themed
journey in test/fixtures/sessions/RESULTS.md — re-themed AGAIN
2026-09-30, validation Issue 1: the first re-theme's `Acme`/`Zephyr`
walk died the same way, `acme` (q=17) and `zephyr` (q=22) are
dictionary-attested and reject at the floor length): accept `Zorp` →
with zero additional typed chars `Zephra` is the top result → Tab →
`Noria` → Tab → `Inverter`.