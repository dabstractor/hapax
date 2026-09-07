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
- Admission bands: quant 250 → reject; quant 150 → group 2; quant 80 →
  group 1; absent → group 0.
- Salience arithmetic: construct store entries, assert exact ordering for
  hand-computed cases (frequency beats rare-once; recency decay at τ=20;
  userTyped flips a tie).
- Ranking tiebreaks: salience equal → shorter, then lexicographic.

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
- Threshold: fragment of 1 char with threshold 2 → delegate; 2 chars →
  match; case-insensitive `nrel` → `NREL` insertion casing.
- Zero candidates → delegate/empty, never a menu.
- Debounce: two rapid set updates → only one swap at +100 ms; Tab mid-debounce
  resolves the live (undebounced) top item.
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

The only tuning surfaces: admission bands (220/120), salience weights
(2.0/3.0/1.5/0.8/1.0), phrase multipliers (M2). Protocol: change one constant,
run the acceptance suite, A/B against a fixed 3-session corpus fixture
(`test/fixtures/sessions/`) checking precision@8 by hand-labeled expected
completions. No telemetry exists; tuning is fixture-driven by design.

## Definition of done — M1

All unit tests green, integration items 1–6 pass, performance gates pass,
no persistence files written anywhere (assert store dir untouched), `pi
--check` (or lint) clean.

## Definition of done — M2

M1 done plus: phrase admission paths (repetition + fast-path + 40-message
decay), constituent suppression, successor-index chaining state machine,
chain resets on `before_agent_start`, and integration item 7: accept
`National` → chain offers `Renewable` → Tab → chain offers `Energy`
→ Tab → `Laboratory`, zero additional typed characters.