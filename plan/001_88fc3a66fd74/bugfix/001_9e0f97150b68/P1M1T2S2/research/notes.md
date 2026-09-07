# Research notes — P1.M1.T2.S2 (bugfix 001): shipped-dict calibration test + prose no-menu e2e gate

## Upstream contracts (assume exact)
- P1.M1.T2.S1: `REJECT_COMMON_THRESHOLD` / `MID_FREQ_THRESHOLD` in
  `src/core/score.ts` (exported `as const`, expected ≈100/≈40), retuned so
  the/with/this/them/context reject. admit(): q>=REJECT→"reject", q>=MID→2,
  else 1, null→0.
- P1.M1.T1.S2: regenerated `dict/common-en.bin` from tools/corpus/en-50k.tsv,
  entryCount = 48,802, version 1.

## Verified codebase facts
- `test/shipped-dict.test.ts` already exists with a `SHIPPED` path const
  (fileURLToPath(new URL("../dict/common-en.bin", import.meta.url))) and
  existing tests incl. entryCount===48_802 and 'qqqqzzzz' → null. The
  calibration block EXTENDS this describe (new describe block in same file).
  NOTE existing comment: "band calibration (q >= 220 REJECT) is P1.M1.T2's
  concern, NOT asserted here" — this task now adds exactly that, update the
  comment.
- `test/acceptance.test.ts` item 2 (L185-233): PROBES = 22 two-char words,
  all ≤3 chars → shape-gate length rejection, masking BUG-001. Helper
  `ingestFixture(path)` (L80) already builds real IngestPipeline with the
  shipped dictionary via resolveDictPath (L69) — the e2e gate reuses it.
- Provider pattern: `createHapaxProvider(store, cfg(), current)` where
  `current = mockCurrent(SENTINEL)`; delegation returns SENTINEL identically;
  a hapax menu returns `{ items, prefix }` and sets `provider.__hapaxLive()`.
  `opts()` builds options; cursor args (lines, 0, col).
- `rankMatches(store, fragment)` is the pure core check (no provider needed).
- prose.jsonl: session v3 jsonl, message.content[].text; contains words like
  with/this/them/thin/first ("The morning was cold, ...").
- style: vitest describe/it/expect, double quotes in newer files, `!` non-null.

## Test design decisions
1. Calibration block: import REJECT_COMMON_THRESHOLD from src/core/score.ts;
   assert lookup(w) >= REJECT for the/with/this/them/that/have/would;
   'qqqqzzzz' → null (already asserted elsewhere but harmless to repeat).
   NEVER hard-code 220/120.
2. e2e no-menu gate: ingest prose.jsonl via ingestFixture; for each of
   with/this/them assert getSuggestions returns SENTINEL (delegate) — i.e.
   no hapax item whose value lowercase equals the typed word. Use BOTH
   rankMatches (pure) and provider delegation (end-to-end).
   'thin'/'firs': measure actual behavior; only pin 'first'-adjacent items
   if 'first' is not top-1000 (it likely IS top-1000 → expect no menu; pin
   whatever is measured, with a comment).
3. Acceptance item 2 probe broadening: add ≥4-char common words (that/with/
   this/them/have/would) to PROBES — but current tests assert ZERO
   candidates for all probes; ≥4-char words pass the shape gate, so with
   recalibrated bands the store simply won't contain them as prefixes of
   themselves... careful: 'wate'→'Water' positive control must keep passing;
   new probes must still yield rankMatches(store, p) === [] (they do only if
   bands reject those words AND no other stored word shares the prefix —
   measure 'thin' carefully: 'thing','think' are common too (rejected), but
   'thin'-prefixed rare words may exist; measure and only add probes that
   genuinely yield zero candidates, or assert no-item-equals-the-probe-word
   instead of zero candidates for the ≥4-char additions).
4. P1.M5.T1.S1 consumes these gates (typing-path probes) — keep helpers
   (ingestFixture already shared; export the COMMON_PROBE word list from
   the calibration test file if useful, or duplicate).

## Gotchas
- Threshold ≥4-char probes must not break the existing
  "stores only gate-passed words" assertion semantics; read the whole item-2
  describe before editing.
- import constants with .js extension (NodeNext).
- Do not regenerate dict here; do not touch score.ts constants (S1 owns them).