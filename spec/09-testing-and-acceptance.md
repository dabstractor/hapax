# 09 — Testing and Acceptance

## Unit tests (per module)

**segment.test.ts**
- camelCase splits: `fixRoundingError` → whole + `fix`(dropped, len<4) +
  `Rounding`, `Error`; `HTTPServer` → `HTTP` + `Server`.
- snake_case: `session_token_valid` → whole + `session`, `token`, `valid`.
- Hexish: `f3a9c2e` captured; `123456` (no letter) not; 41+ chars not.
- CJK run skipped; ASCII resumes after.
- Hyphen/apostrophe not joined: `state-of-the-art` → three tokens.

**shapeGate.test.ts** (each rule is a case)
- Accept: `zendesk`, `lwlock`, `NREL`, `f3a9c2e`.
- Reject: `aaaaa`, `aaaaaaa`, `sk-abc123DEF456...`, `ghp_...`, `eyJhbG...`,
  20+ pure hex, `qqqxxxzzzvvv` (consonant run), `ab` (too short), 65+ chars,
  base64 ≥ 24 mixed.

**score.test.ts**
- Admission bands (asserted relative to the imported constants, not
  absolute quants): q ≥ REJECT → reject; MID ≤ q < REJECT → group 2;
  q < MID → group 1; absent → group 0.
- Proper-noun relief: capitalized whole token with REJECT ≤ q < 95 →
  group 2; at/above the ceiling stays rejected.
- Conjugation guard: inflection whose stem is reject-common rejects
  (any q of the word); absent word + mid-band stem rejects; e-restoration
  and doubled-consonant stems match; properName drafts skip the guard;
  the rejectCommonness override governs the stem comparison.
- Salience arithmetic: construct store entries, assert exact values for
  hand-computed cases (frequency term, recency decay at τ=20, sticky
  userTyped, properName, rarity bonus).
- Eviction ordering (salience × slower τ=50 decay) — menu ordering is
  NOT salience (see below).

**query.test.ts**
- Menu order is content-derived: shorter key first, ties byte-lex;
  salience stats (count, recency, userTyped, rarity) never reorder;
  ordinal advances leave order unchanged.

**store.test.ts**
- Upsert merge semantics (count, ordinals, sticky flags, rankGroup min).
- Eviction: insert 20,001 → exactly one eviction, lowest evictionScore;
  userTyped survives.
- Prefix index rebuild-after-dirty correctness.

**dictionary.test.ts**
- Round-trip: build a tiny table in-memory (10 words), write format, load,
  assert every lookup, absent → null, no allocation in lookup (optional
  via node `--expose-gc` smoke test).
- Corrupt file (bad magic, truncated) → load throws.

**provider.test.ts**
- Trigger regex: `#`, `#ze`, mid-line `foo #ze`, `foo#ze` (no match — needs
  start/whitespace), two `##` → no match.
- Word matching: 1-char fragment answers (auto-open contract — pi-tui
  only asks at word starts, effective threshold 1); case-insensitive
  `nrel` → `NREL` insertion casing.
- Enter-submits proxy (test/editor-enter.test.ts): Enter + open word
  menu → cancel then delegate exactly once; slash menus, closed menus,
  non-submit keys untouched; the inner instance is NEVER mutated (v1
  recursion regression pin); proxy get/set/has forwarding and the
  thenable guard.
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

## Integration acceptance (manual or scripted via pi)

1. **Happy path:** session discussing `Zendesk` + `lwlock`; type `ze` → menu
   offers `Zendesk`; Tab inserts `Zendesk` (cased). Type `#l` → `lwlock`.
2. **No-hijack:** type ordinary prose continuously; keystrokes land verbatim,
   no menu for common words, Tab with no selection = literal tab.
3. **Restore:** `/resume` a 100k+ token session; store rebuilt in background
   (< 100 ms total); completions available within the first second.
4. **Compaction:** trigger compaction (long session + `/compact`); store
   survives; previously admitted words still complete.
5. **Secrets:** paste an API key into a user prompt; key never appears in
   suggestions afterwards (shape gate).
6. **Path completion regression:** quoted path completion, slash commands,
   and `@`-mention behaviors identical to stock pi.

## Performance gates (CI-scriptable micro-benchmarks)

| Gate | Limit |
|---|---|
| 20k-candidate prefix query + rank + top 8 | < 1 ms p99 |
| Dictionary load + full lookup sweep of 20k words | < 60 ms |
| Ingest 800 KB synthetic session text | < 60 ms, yields every ≤ 64 KB |
| Steady-state heap delta (dict + store) | < 6 MB |

Benchmarks run with a synthetic dictionary fixture; numbers asserted loosely
(CI variance) — hard regressions (> 3× budget) fail.

## Tuning protocol

Tuning surfaces: the runtime `rejectCommonness` config knob (08), and
the baked constants — admission bands (reject 50 / mid 20), relief
ceiling 95, conjugation-guard suffix set, salience weights
(2.0/3.0/1.5/0.8/1.0). No phrase multipliers exist (the M2 successor
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
words (stopword bridging forbidden), newlines. Integration item 7: accept
`National` → with zero additional typed chars `Renewable` is the top result
→ Tab → `Energy` → Tab → `Laboratory`.