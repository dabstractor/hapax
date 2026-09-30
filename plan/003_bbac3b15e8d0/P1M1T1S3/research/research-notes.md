# Research — P1.M1.T1.S3: calibrate-bands.mjs R_eff-aware verdicts + prose re-audit

## Measured facts (against the current shipped repo state, pre-S1/S2 landing)

### tools/calibrate-bands.mjs (current)
- Two modes: word-probe (`process.argv.slice(2)`) exits early; zero-arg runs
  5 sections: (1) artifact header + flat band populations parsed from
  `dict/common-en.bin` scores section (24B header + blob + u32 offsets +
  u8 scores, HAPX v1), (2) rank↔word↔q table at probe ranks 100..40000
  (via `rankWord[]` built from `tools/corpus/en-50k.tsv` filtered by
  build-dict `KEY_RE`), (3) BUG-001 word set via `admit()`, (4) flat
  threshold sweep T=15..255 step 5 using `popReject(T)` (scores u8 array),
  (5) acceptance assertions with `check()` / `failures` / exit 1.
- Imports from `../src/core/score.ts`: `admit, MID_FREQ_THRESHOLD,
  REJECT_COMMON_THRESHOLD` (native TS-strip, Node ≥ 23.6). S1 adds
  `rEff, REJECT_LEN_FLOOR, REJECT_LEN_FULL` exports — import them.
- Probe header currently prints
  `REJECT=${REJECT_COMMON_THRESHOLD}, MID=${MID_FREQ_THRESHOLD}`.
- Assertions to keep passing today: the/with/this/them reject;
  context/because/would/data/code/provider/null/node reject (all ≤ 8
  chars → floor hold, still reject under curve); absent word group 0;
  rank-47000 tail word; reject band population 40k..47k; group-2 band
  empty; q monotone over top 500 ranks.

### Current probe output (sanity)
`node tools/calibrate-bands.mjs uploads configurations` (pre-S2) prints
`uploads REJECT`, `configurations REJECT` — after S2 both must be
REJECT and ADMIT(g0) respectively. Cap drafts currently g0 (properName
skips guard; absent → group 0).

### test/fixtures/sessions/prose.jsonl re-measurement (KEY FINDING)
Replayed word extraction (lowercased regex `[A-Za-z][A-Za-z'-]+` over
all message text): **187 distinct words, maximum length 7**. The
longest are `morning/through/matters/kitchen/...` — all ≤ 8 chars, so
under the R_eff curve every prose.jsonl word is in the floor-hold
region and the store stays EMPTY exactly as today. There are NO 9+
char words in the fixture. The contract item's worry ("9+ char common
prose words now ADMIT") does not materialize for THIS fixture — the
re-audit must document that with a pinned assertion, not weaken the
gate.

### test/calibration.test.ts
- `COMMON_PROBES = ["with","this","them","that","have","would"]`
  (exported, 4–6 chars, measured q=156..240) — all floor-hold rejects
  under the curve; the delegation assertions need NO behavior change.
- `store.size === 0` assertion (2026-09 comment) — still true; comment
  must be updated to 2026-10 semantics and a length-pin added so the
  claim can't silently rot.
- `posts(47)/thin(76)/first(144)` q ≥ REJECT assertions: 4–5 chars,
  floor hold, unchanged.
- Positive control upserts `lwlock` directly — unchanged.

### test/shipped-dict.test.ts
- BUG-001 gate: `the/with/this/them/that/have/would` lookup ≥
  REJECT_COMMON_THRESHOLD — 4–6 chars, floor hold, survives the curve
  unchanged. Entry-count pins (48,802), version 1, ordering pins
  untouched.

### Spec anchors
- spec/04 h2.26: R_eff formula, boundary arithmetic (9→q<82, 10→q<110,
  11→q<133, 12→q<152, 14→q<184; admit-all ≥20), flat group 1, relief
  dead, `uploads` reject / `configurations` admit examples.
- spec/09 h2.59: calibrate-bands.mjs is THE measurement probe — word
  verdicts, band populations, drift assertions; run after any retune
  or dict regen.
- Sibling PRPs: S1 delivers `rEff(floor,len)` (returns 256 sentinel at
  len ≥ 20) + `REJECT_LEN_FLOOR=8` + `REJECT_LEN_FULL=20`; S2 makes the
  guard ride `rEff(rejectAt, key.length)` and keeps
  `MID_FREQ_THRESHOLD` exported as compatibility constant.
