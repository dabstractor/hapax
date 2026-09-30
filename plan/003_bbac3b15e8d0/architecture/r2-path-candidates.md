# R2 — Rule 4d slash-joined path candidates (PRD 003, Task P1.M1.T2)

Read-only research report. All claims cite `file:line` in the hapax repo at
the time of writing. Spec (`spec/04-tokenization-and-scoring.md` § rules,
`spec/SPEC.md` feature table) is the adopted source of truth; rule 4d is
"adopted ahead of implementation — code lands with this spec"
(spec/04:118).

---

## 1. Segmentation architecture (`src/core/segment.ts`)

**Rule ordering / passes.** `tokenize(text)` (segment.ts:208) runs:

- **Pass 1 — base** (rule 1): `BASE_RE = /[A-Za-z][A-Za-z0-9_]{0,63}/g`
  (segment.ts:33); length-1 matches dropped; the 64-char cap comes from the
  quantifier.
- **Pass 2 — hexish** (rule 2): `HEXISH_RE = /(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g`
  (segment.ts:36). Dedupe vs. base spans via one monotonic cursor
  (segment.ts:283-320): equal span + digit ⇒ hexish wins; strictly-inside ⇒
  hexish dropped; hexish-contains-base ⇒ base absorbed (`dead: true`).
- **Pass 3 — compounds** (rules 4a/4b): `FILENAME_RE` (segment.ts:43) and
  `HYPHEN_RE` (segment.ts:52), merged into one `compounds` list
  (segment.ts:406-413).
- **Pass 4 — technical literals** (rule 4c): `LITERAL_RE = /[A-Za-z0-9._@:+/~=-]{4,80}/g`
  (segment.ts:63) — **the scan window is 80 in code, 96 in spec/04:28-30**.
  Each raw match is validated by `classifyLiteral(raw)` (segment.ts:150-190):
  trim leading/trailing symbol chars (LITERAL_SYMBOL_CHARS = `._@:+/~=-`,
  segment.ts:68), require post-trim length 4–64, reject adjacent interior
  symbols (`..`, `//`, `::`), and require a digit. Rule-3 Unicode adjacency
  is checked per match (segment.ts:461-463); equal-span tokens defer to the
  existing token (segment.ts:466-468, "strictly additive").
- **Absorption merge** (segment.ts:472-540): compounds+literals sorted by
  start asc / longer-first, containment-filtered, then a linear merge drops
  every base/hexish token strictly inside an absorber span. Output is
  `RawToken[]` (`{ raw, hexish, literal?, start, end, sentenceStart }`,
  types.ts:83-113) — never overlapping spans, document order.

**Span model.** UTF-16 offsets into the exact (post-`maskSecrets`) string;
`text.slice(t.start, t.end) === t.raw` (types.ts:96-98). Ingest relies on
this for gap computation between entries (ingest.ts:195-210).

**Edge trimming today.** Only inside `classifyLiteral` — symbols never
start/end a literal; the *raw* span keeps the symbols and the trimmed
`from/to` are re-offset (segment.ts:462-465: `start = m.index + lit.from`).
The token `raw` is the TRIMMED slice (segment.ts:471), i.e. **trimmed
content, no display/edge preservation anywhere today**.

**Rule 3 (Unicode-letter adjacency).** `isUniLetter` / `isUniLetterBefore`
(segment.ts:100-146) — a non-ASCII letter adjacent on either side kills the
run whole. Applied in the base pass (segment.ts:265-269), hexish pass
(segment.ts:291-300), and literal pass (segment.ts:461-463). **Known gap
(spec/04:73-77): the compound (4a/4b) sweep never gained the guard.**

**Additivity rules.** Hexish-vs-base and literal-vs-existing are decided by
span comparison: equal span ⇒ existing class wins ("richer semantics",
segment.ts:444-450); strictly-contained ⇒ absorbed. 4d must slot into this
same convention.

## 2. Shape gate (`src/core/shapeGate.ts`)

`passesShape(draft)` (shapeGate.ts:171-194), precedence: length → secret →
lowEntropy → unigramRun → consonantRun. **A reject rejects the whole
candidate draft** (and in ingest, a whole-token `secret` reject poisons all
sub-word drafts — ingest.ts:531-547; paths are opaque so this only matters
for uniformity).

- **Caps:** `MIN_LENGTH = 2` (shapeGate.ts:48), `MAX_WHOLE_LENGTH = 64`
  (shapeGate.ts:52), `MAX_SUBWORD_LENGTH = 32` (shapeGate.ts:54). Selected
  by `draft.isSubword` only (shapeGate.ts:172) — **there is no per-class cap
  mechanism today; the spec's "path-class candidates 4–96" (spec/04:227)
  needs new plumbing** (e.g. a `path?: boolean` flag on
  CandidateDraft/RawToken mirroring `literal?`).
- **Entropy floor:** `charEntropy(key) < MIN_ENTROPY_BITS (1.5)` rejects, but
  only letter-bearing keys — `if (/[a-z]/.test(key) && …)` (shapeGate.ts:178-181).
  Letter-free (digit/symbol) keys skip the floor (2026-10 rule-4c interplay).
  Paths are letter-bearing ⇒ floor applies as-is (spec/04:152-157).
- **Secret gate:** `isSecretShaped(display)` (shapeGate.ts:233-289): known
  prefixes (`SECRET_PREFIXES`, incl. `npm_`); **`'@' plus '.'` —
  `raw.includes("@") && raw.includes(".")` (shapeGate.ts:243-244)** — this is
  what keeps URL userinfo out of 4d; base64 run ≥ 24 (`hasBase64SecretRun`);
  pure hex ≥ 20 / pure decimal ≥ 16; base64url run ≥ 16 with ≥1 lower, ≥1
  upper, ≥2 digits (`hasBase64UrlSecretRun`, shapeGate.ts:339-362); charset
  entropy residue (`hasHighEntropySecretRun`). Note `/` is IN the base64
  alphabet for rule 3 runs and in the entropy-run alphabet — long path
  segments could trip the ≥16 base64url/entropy rules exactly as spec'd
  ("a path segment with base64url-secret texture rejects the whole
  candidate (conservative)", spec/04:153-155). `maskSecrets`
  (shapeGate.ts:528-546) runs on raw text pre-tokenization (anchored
  prefilter, `SECRET_WINDOW_ANCHORS`) and is unaffected by 4d.

## 3. Store (`src/core/store.ts`, `src/core/types.ts`)

**Candidate** (types.ts:16-33): `key` (lowercase), `display`, `sessionCount`,
`lastSeenOrdinal`, `firstSeenOrdinal`, `userTyped` (sticky), `properName`
(sticky), `rankGroup`, `isSubword`. **Sighting** (types.ts:36-51) adds
`ordinal`, `fromUser`, optional `parentKey`.

**Key vs display divergence today: casing only.** `expandCandidates` emits
`key: token.raw.toLowerCase(), display: token.raw` (segment.ts:545-546) —
same string modulo case. The store's upsert merges display by recency:
`existing.display = sighting.display; // most recent casing wins`
(store.ts:222) — plus sticky OR-in of `userTyped`/`properName`, `rankGroup`
min-merge, `isSubword` fixed at creation (store.ts:205-232). **Nothing in
store assumes `display.toLowerCase() === key`**, so a 4d sighting with
trimmed key + original-edge display flows through unchanged — the merge
semantics ("most recent wins") naturally extend to edge variants
(`/home/...` vs `home/...` sightings both upsert key `home/...` and the
latest display wins).

**Prefix index:** `#sortedKeys` + `#pending`, `INDEX_MERGE_BATCH = 256`
(store.ts:74); upsert pushes new keys to `#pending` and consolidates in
256-chunks (store.ts:211-214); `prefixRange(prefix)` (store.ts:394-409)
consolidates the ≤-batch tail, binary-searches `lowerBound`, forward-scans
`startsWith`. Keys containing `/` sort fine (byte-lex UTF-16 code-unit
order; `/` = 0x2F < `0`-`9` < `a-z`). Eviction: `STORE_CAP = 20_000`,
`EVICT_BATCH = 256`, `evictIfOverCap` (store.ts:236-292).

**Display outflow:** `query.ts` builds `RankedMatch` with
`display: c.display` (query.ts:118 — "insertion casing exactly as stored").
`/acwords` (`src/pi/debug.ts`) prints `c.display` and the tab-dump
`${c.key}\t${c.display}\t…` (debug.ts:74, 203) — edge-bearing displays flow
out with no changes needed. One caveat: query.ts documents "every returned
display is a single word (the one-word invariant: no multi-word …)"
(query.ts:6, h2.26/h2.44) — a path display has no whitespace so it does not
violate the letter of that invariant, but any downstream assumption/tests
keyed on "display ≡ key + casing" need review.

## 4. Bigram adjacency (`src/pi/ingest.ts`, `store.recordBigramRuns`)

- **Where runs are built:** `#admitSegment` emits `SegmentResult.entries`
  (spans of admitted WHOLE tokens); `appendSegment` computes `gapBefore` per
  entry (ingest.ts:195-210); `splitRuns` (ingest.ts:156-171) breaks a run
  whenever the gap is not pure spaces/tabs (`WHITESPACE_GAP_RE = /^[ \t]+$/`,
  ingest.ts:127); a `\n` finalizes the line (ingest.ts:396-434). Runs go to
  `store.recordBigramRuns(runs)` via the `onAdmittedTokens` hook, once per
  message (ingest.ts:435-440).
- **"Whole token" there:** the entries are the whole-token drafts' keys
  (first draft of `expandCandidates` output, admitted) — subwords never
  enter runs. `recordBigramRuns` (store.ts:479-515) counts adjacent pairs
  `"w1 w2"` (single-space-joined keys) and bumps the successor index
  (`#bumpSuccessor`, top-3 per word, store.ts:520-552).
- **What must change for paths:** nothing structural. A 4d token's
  whole-token draft has key = trimmed path (e.g. `src/core/query.ts`), so it
  enters the run as one whole key exactly like any token; `edit →
  src/core/query.ts` becomes a bigram/successor pair automatically
  (spec/04:157-158). Keys with spaces are impossible (whitespace terminates
  the literal run). Only check: the bigram key construction `${w1} ${w2}`
  and `#dropSuccessorFor`'s `indexOf(" ")`/`lastIndexOf(" ")` split
  (store.ts:638-647) still hold — a path key contains no space, so yes.

## 5. Feasibility of rule 4d as spec'd (spec/04:118-174, SPEC.md:77)

**Verdict: feasible with modest, well-localized changes.** Mapping each
spec'd predicate to the code:

- **Scan window:** widen `LITERAL_RE` from `{4,80}` to `{4,96}`
  (segment.ts:63; spec/04:28-30 already says 96). Cost: slightly more raw
  matches reaching validation; `classifyLiteral` and a path predicate are
  O(len) per match. The perf history (unbounded walk-backs made ingest
  quadratic and blew the 800 KB gate — segment.ts:348-352 comments) says
  keep everything per-match linear; that holds.
- **Predicate:** a maximal literal-charset run that is path-shaped = ONE
  token. Natural implementation: a `classifyPath(raw)` sibling of
  `classifyLiteral` — after edge trimming of leading `/`, `~`, `./`, `../`
  combinations and trailing `/`, count interior single `/` separators:
  ≥2 ⇒ path; exactly 1 plus a dotted component ⇒ path. Interior `..`
  rejects the WHOLE run (spec: "a/../b shreds"). Single interior symbols
  only (reuse `classifyLiteral`'s adjacent-symbol rejection). Trailing
  `:digits(:digits)?` trimmed only when the remainder is path-shaped
  (`4:36`, `localhost:8080` untouched). Digit-bearing runs qualifying both
  ways take the **path class** (spec/04:128-131) — i.e. path check runs
  before/instead of the digit check for slash-bearing runs.
- **First key≠display divergence beyond casing:** `RawToken` gains
  `path?: boolean` (mirroring `literal?`, types.ts:99-107); the token's
  `raw`/span must be the ORIGINAL run (display preserves edges), while
  `expandCandidates` for path tokens emits `key: trimmed.toLowerCase()`,
  `display: original raw` (or equivalently a `trimFrom/trimTo` on the token
  and ingest uses the trimmed slice for the key). **Careful:** today the
  literal pass emits the trimmed slice as `raw` (segment.ts:471); 4d needs
  the untrimmed span with a separate trimmed key — this is the cleanest
  insertion point for divergence.
- **Gate caps:** plumbing needed — `passesShape` selects max by
  `isSubword` only; add `path` flag to CandidateDraft and use 96 (floor 4
  via existing MIN_LENGTH would be 2 — spec says path candidates 4–96,
  spec/04:148-150, so the floor must be class-conditional too).
- **Opacity / secrets / entropy:** automatic — path tokens return
  `[whole]` from `expandCandidates` next to the
  `if (token.hexish || token.literal) return [whole]` branch
  (segment.ts:557-559); `isSecretShaped` runs on display (raw edges
  included — harmless: `@`+`.` rejection is intended to fire on URLs);
  entropy floor applies (letter-bearing). Whole-token secret reject poisons
  nothing extra (no subwords).
- **Strictly additive / equal spans:** paths contain `/`, and base/hexish/
  compound spans never do, so equal-span collisions are impossible by
  construction (spec/04:146-148) — the literal pass's existing
  equal-span-defers logic (segment.ts:466-468) can be reused verbatim; the
  path branch just needs the same guard for symmetry/tests.
- **Rule 3 adjacency:** apply `isUniLetterBefore`/`isUniLetter` at the
  TRIMMED bounds, same as the literal pass does (segment.ts:461-463).

## 6. Query-interaction facts (verified)

- **Fragment regex admits no `/`:** threshold mode matches
  `/[A-Za-z][A-Za-z0-9_-]*$/` (provider.ts:105) — letter-initial,
  `[A-Za-z0-9_-]` only. Trigger mode excludes whitespace and the trigger
  char only (provider.ts:84-88), so a fragment could in principle contain
  `/` in trigger mode, but the stock gate below disarms it. Net effect
  matches spec/04:159-166: paths surface at the FIRST segment (`sr` → key
  `src/core/query.ts` via prefixRange); mid-path typing never queries hapax.
- **Stock-context gate:** `classifyStockContext` in provider.ts:115-160 —
  `StockContext = "slash" | "mention" | "quoted-path" | "path"`; "path" = a
  `/` earlier in `before` whose cursor-adjacent tail matches the file-shape
  test (provider.ts:153-156); non-null ⇒ getSuggestions delegates to pi's
  built-in completion untouched (provider.ts:32-40). Spec: UNCHANGED by 4d
  (spec/04:167-172).
- **Ranking caveat:** query.ts's tier/score math and the one-word display
  invariant (query.ts:6) were designed for words; long path keys (up to 96
  chars, `/`-bearing) will rank via the same prefix/fuzzy tiers — worth a
  spot check that the anchored first-char/fuzzy logic treats `/` sanely
  (it is not in the fragment charset, but prefix matching on the key side
  is plain `startsWith`, store.ts:404).

## 7. Recommended insertion points + risks

1. **segment.ts:** widen `LITERAL_RE` to `{4,96}`; add `classifyPath` +
   `path?: boolean` on the emitted RawToken; path runs carry the ORIGINAL
   span (raw/display) + trim metadata for the key. Feed paths into the same
   absorber sweep (compound/literal union) so contained tokens absorb —
   minimal structural change.
2. **segment.ts `expandCandidates`:** for path tokens emit
   `{ key: trimmed.toLowerCase(), display: raw, …, isSubword: false }` and
   return `[whole]` (opacity) — one new branch beside the hexish/literal
   one.
3. **types.ts:** `RawToken.path?`, `CandidateDraft.path?` (for gate caps).
4. **shapeGate.ts:** class-conditional caps (path: 4–96) instead of the
   isSubword-only selection.
5. **ingest.ts:** nothing required for bigrams (keys flow as whole tokens);
   but the `AdmitMemoEntry` plan (ingest.ts:131-148) keys memoization on
   the raw token — path raws (untrimmed) are distinct per occurrence shape,
   fine; and `SegmentResult.entries` uses the whole-token key = trimmed
   path, correct.
6. **store.ts / query.ts / debug.ts:** no changes; display merge
   (recency-wins) already generalizes to edge variants. `/acwords` prints
   display as-is.

**Risks:**

- **Scan-window cost:** widening to 96 increases literal-pass matches;
   every extra match pays classifyLiteral/classifyPath O(len). The 800 KB
   perf gate (test/perf-gates.test.ts:165-166, budget <60 ms / CI <180 ms,
   currently calibrated ~174-187 ms baseline) has little headroom — measure.
   History: two O(n²) regressions already came from this pass
   (segment.ts:348-352, 453-456).
- **First key/display divergence:** any code or test that assumes
   `display.toLowerCase() === key` breaks silently. Known surfaces: query.ts
   one-word invariant comment (query.ts:6,83,118), /acwords tab-dump, store
   tests. Grep-audit before landing.
- **Key cap plumbing:** `passesShape`'s single `isSubword` switch is the
   only length policy point; forgetting the path class would wrongly cap
   paths at 64 (rejecting real 65-96-char paths) or wrongly floor at 2.
- **Secret interplay:** `/` is in the base64 alphabets of secret rules 3/5/7
   — a 96-char path with a high-entropy ≥16-char alnum segment
   (`/_-`-bearing) rejects whole (conservative, spec'd); but ordinary deep
   paths with mixed-case segment names could false-positive rule 5 if a
   segment carries ≥2 digits + mixed case at ≥16 chars (e.g. commit-hash
   directory names — arguably correct rejection).
- **Spec/code window drift already present:** code says `{4,80}`, spec says
   `{4,96}` — the 4d implementation MUST fix this in the same change (spec
   is already adopted).
- **Equal-span/additivity tests:** path spans cannot equal other classes'
   spans (they contain `/`), but the shared absorber sweep tie-break
   (compound-before-literal, segment.ts:477-488) needs a rule for
   literal-vs-path ties (same span qualifying both ways — spec says path
   class wins; since the path branch replaces the literal classification for
   such runs, emit `path: true, literal: false`).

**Open questions:**

- Does `classifyPath` run on the trimmed form for the `:digits` suffix, or
  trim-then-check-then-retrim (spec: "trimmed when the remainder is
  path-shaped" — one iteration suffices; `a/b.ts:42:13:99` edge case)?
- Should the path-class flag also relax `MAX_WHOLE_LENGTH` for the
  dictionary admission path (score.ts `admit` sees the 96-char key —
  dictionary lookups on such keys will be misses ⇒ group 0, which is the
  intended identifier class; verify no length assumption in score.ts).
- Trigger-mode fragments can contain `/` before the cursor (regex only
  excludes whitespace + trigger char, provider.ts:84-88): confirm the
  stock-context "path" classification fires FIRST so hapax never offers
  word completions mid-path in trigger mode (reading of provider.ts:206-215
  says yes — classifyStockContext runs before fragment matching — but
  worth a live TTY check per spec/09).

## VERDICT

**Feasible.** Rule 4d lands cleanly in the existing pass-4 machinery: the
literal scan, edge-trim, additivity, opacity, and absorption semantics all
extend naturally; the store and bigram layer need zero changes (whole-token
keys flow through verbatim). Required code surfaces: segment.ts (window 96,
classifyPath, path flag, trimmed-key/original-display drafts), types.ts
(flag), shapeGate.ts (class-conditional 4–96 caps). Main risks: perf-gate
headroom on the widened scan, silent breakage of the key≡display·casing
assumption, and the already-present spec/code window drift (80 vs 96) that
must be fixed in the same change.
