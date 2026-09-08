# Core Engine Findings (BUG-002, BUG-003, BUG-004, BUG-006)

## BUG-002 — admission bands vs M2 acceptance phrase
- `src/core/score.ts`: `REJECT_COMMON_THRESHOLD = 50` (:76, prior retune 220→100→50), `MID_FREQ_THRESHOLD = 20` (:89).
  `admit(draft, dictionary, parentGroup?)`: `q===null → 0; q>=50 → reject; q>=20 → 2; else 1`; subword clamp `min(2, max(result, parentGroup+1))`.
  No proper-noun handling in admission (`properName` only feeds salience W_PROPER_NAME=0.8).
- Shipped dict lookups (bugfix PRD, verified e2e): national=90, energy=94, laboratory=57, renewable=19 → only `renewable` admits.
  Score.ts comments list: the=240, with=179, this=197, them=156 (must stay rejected), context=51.
- History: with the ORIGINAL spec bands (220/120) all four NREL words admitted — integration item 7 passed (docs/M1-DoD.md, RESULTS.md).
  The 50/20 retune (prior bugfix: no menu for common words) silently broke item 7.
- **Chosen fix — proper-noun admission relief (not a blanket retune):** raising REJECT to ≥95 would re-admit lowercase
  `context`(51)/`posts`(47) and break the calibration no-menu suite. Instead add a whole-token-only relief band:
  `if (result === "reject" && !draft.isSubword && draft.properName && q !== null && q < PROPER_NOUN_ADMIT_CEILING) result = 2;`
  with `PROPER_NOUN_ADMIT_CEILING = 120` (default; must satisfy 94 < ceiling ≤ 156 so national/energy/laboratory admit at
  group 2 while The/This/With/Them stay rejected; 120 = original spec mid-band boundary). Capitalized occurrences only —
  lowercase `energy` in prose still rejects, so prose menu noise stays calibrated. Admission ⇒ words enter runs ⇒ bigrams
  form (§06: bigrams only between admitted whole tokens) — no separate bigram path change needed.
- Validate with `tools/calibrate-bands.mjs` + calibration.test.ts COMMON_PROBES (posts/thin/firs are lowercase → unaffected)
  and the §09 tuning protocol (one constant, acceptance suite, fixture A/B precision@8).
- Pin the M2 phrase in an automated test (PRD requirement): real dict, ingest the PRD's 3-sentence NREL fixture, assert
  store admission of all four words + full chain National→Renewable→Energy→Laboratory at zero typed chars (editor-sim).

## BUG-003 — secret fragments admitted
- Two-layer defense today: `maskSecrets(segment)` (raw text, pre-tokenize) + `passesShape` per draft.
- Gaps (verified): bare-run catch-all `/[0-9a-zA-Z/+]{40,}/g` (SECRET_WINDOW_RES, last in claim order, no anchor prefilter)
  misses the 38-char AWS key `wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY`. Whole token IS shape-rejected (rule 7a high-entropy
  run ≥16, ≥1 digit, mixed case, entropy ≥4.5) — but camelCase sub-words `jalr`/`femik7`/`mden`/`cyexamplekey` (4-12 chars,
  ≤1 digit) pass every gate: rule 6 needs ≥2 digits, rules 7a/7b need ≥16-char runs. Code comments document this as a
  non-goal — a trade-off the PRD does not sanction.
- **CRITICAL structural fact:** NO parent context is tracked. `expandCandidates` (segment.ts:236) emits whole draft first,
  then sub-words; `#computeAdmitMemo` (ingest.ts ~590-650) gates each draft independently; the only cross-draft state is
  `wholeGroup`, set ONLY when the whole token gate-passed AND admitted (`if (!draft.isSubword && result !== "reject") wholeGroup ??= result;`).
  A secret-rejected parent leaves `wholeGroup` undefined and its sub-words sail through.
- Fix levers (PRD recommendations, in order):
  1. Lower bare-run mask floor 40 → 32 (constant, e.g. `BARE_RUN_MIN = 32`) — kills the AWS-key case pre-segmentation.
     Audit mask-secrets/adversarial fixtures for over-masking (32+ unbroken `[0-9a-zA-Z/+]` runs are absent from prose;
     32+ hex hashes are secret-shaped anyway).
  2. Parent-secret propagation in `#computeAdmitMemo`: when the whole-token draft's `passesShape` rejects with reason
     `"secret"`, mark the token and reject ALL its sub-word drafts (never stored). Masked-away text never reaches tokenize,
     so this covers shape-gate-rejected parents.
  3. Synthetic battery (npm_/glpat-/sk_live_/Bearer-style per PRD repro: fragments `abcdefghijklmnopqrstuvwxy`,
     `yz0123456789`, `zabc` must never be offered). Where a synthetic's whole token passes all gates and is not masked
     (e.g. `glpat-…` — hyphen not in SECRET_PREFIXES `glpat_`; 0 digits defeats rules 6/7), add conservative prefix/mask
     rules (SECRET_PREFIXES: `npm_`, `glpat-`, `sk_live` …) bounded by the battery, avoiding prose false positives;
     document additions in JSDoc.
- Acceptance mirrors §09 item 5 + PRD repro: after pasting the key, `store.entries()` contains none of the fragments and
  `getSuggestions(['cy'],…)` offers no `CYEXAMPLEKEY`.

## BUG-004 — astral letter before ASCII run
- `isUniLetter(cp)` (segment.ts:78-83): `String.fromCodePoint(cp)` then `\p{L}` && !ASCII. Guard sites call
  `isUniLetter(text.codePointAt(m.index - 1))` (base pass :130-131 AND hexish pass :152-155). For an astral letter
  immediately BEFORE a match, `codePointAt(m.index-1)` is the lone LOW surrogate (0xDC00-0xDFFF) → not `\p{L}` → run slips
  through: `tokenize('𝔘sword') → ['sword']`. After-side is correct (codePointAt at a high surrogate returns the full pair).
- Fix: step by full code points — at the before-site, if the code unit at `index-1` is a low surrogate, back up one more
  unit and test the combined code point (e.g. helper `isUniLetterBefore(text, index)`); apply at BOTH guard sites.
  Tests: `𝔘sword` → [], `sword𝔘` → [] (regression), `ΩbsidianMirror` → [], `Þórhildur` → [], BMP `é` both sides,
  hexish variant. Remove the "Accepted v1 trade-off" JSDoc and replace with the code-point-correct note.

## BUG-006 — bigram cap overshoot
- `store.ts`: `BIGRAM_CAP = 10_000` (:59, not exported), `BIGRAM_EVICT_BATCH = 256` (:66). `recordBigramRuns` (:452) upserts
  all pairs then calls `#evictBigramsIfOverCap()` ONCE — which pops at most 256 victims (`while over cap && batch-- > 0`,
  lazy min-heap `#bigramEvictHeap`, `evictNodeBefore` = bigramSortKey asc then byte-lex; evicted keys also
  `#dropSuccessorFor`). One message with 11,000 distinct bigrams leaves `bigramSize` at 10,714 until later messages drain more.
- Fix: make `#evictBigramsIfOverCap` drain fully within the same call — wrap the 256-batch in a `do/while (size > BIGRAM_CAP)`
  loop (keep the inner batch constant for heap pacing/stale-node re-push hygiene). Cost: O(overflow·log n) — trivial.
- Test: single `processText` of 11k distinct rare-pair lines → `bigramSize <= 10_000` immediately; perf gates (ingest
  800 KB < 60 ms) still pass; successor splice consistency retained.

## Cross-cutting cautions
- Perf budgets (§02/§09): keystroke query <1 ms p99, dict load <50 ms, ingest <5 ms/message, restore <100 ms, heap <6 MB —
  perf-gates.test.ts fails only >3× budget, but keep the drain/mask changes in-budget.
- The word store's own eviction (evictIfOverCap, every upsert, drop = max(overflow,256)) is NOT in scope — only the bigram map.
- Do not edit spec/*.md (product spec, human-owned). Document the admission relief + any mask additions in score.ts /
  shapeGate.ts JSDoc, docs/M1-DoD.md, and README (final docs task).
