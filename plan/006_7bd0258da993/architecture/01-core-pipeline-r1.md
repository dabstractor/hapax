# R1 Core Pipeline — Verified Architecture Notes (baseline 6d8f158)

READ-ONLY research. All line numbers verified against the working tree at
git baseline 6d8f158.

## 1. Verified anchor table

| PRD anchor | Verified file:line | Symbol | Role |
|---|---|---|---|
| ingest ~123-199 | `src/pi/ingest.ts:109-122` `SpanEntry`; `:128` `WHITESPACE_GAP_RE = /^[ \t]+$/`; `:176-189` `splitRuns`; `:206-247` `appendSegment` | adjacency-window machinery | Runs break on any gapBefore not pure spaces/tabs; newline structural; chunk boundary carries (openLine/openTail) |
| ingest ~254-266 | `src/pi/ingest.ts:226-262` `IngestPipelineOptions` | options | `onAdmittedTokens?: (runs: string[][]) => void` — payload is an array of runs, each run an array of lowercase KEYS (strings only, no casing/spans) |
| ingest :354 | `src/pi/ingest.ts:354-362` `dispose()` | teardown | clears timer + empties `#pending`; in-flight drain NOT cancelled |
| ingest :521-545 | `src/pi/ingest.ts:522-552` `#admitSegment`; `:567-598` `#computeAdmitMemo`; `:606-643` `#replayAdmitMemo`; `:304` `#admitMemo = new Map()` (cap `ADMIT_MEMO_CAP=65536`, clear-on-full at `:544-545`) | memoization | see §2 |
| ingest :711-745 | `src/pi/ingest.ts:711-763` `restoreFromHistory` | restore | CONFIRMED: `sessionManager.getBranch()` (leaf→root), `[...branch].reverse()` into oldest-first (`:738-741`); fallback `getEntries()` already oldest-first |
| segment ~763-795 | `src/core/segment.ts:745-768` `expandCandidates`; `:418-445` `isSentenceStartBefore`; `:738-740` `isUpperAscii` | sentenceStart + casing | see §3 |
| types ~100-118 | `src/core/types.ts:105-141` `RawToken`; `:20-33` `Candidate`; `:43-60` `Sighting` | type shapes | see §4 |
| shapeGate | `src/core/shapeGate.ts:182` `passesShape(draft: CandidateDraft)`; `:194` `isSecretShaped(draft.display)` secret rule; `:674` `maskSecrets` | gate | Rejection happens BEFORE admission; a gate-rejected member simply never emits a run entry (never enters `entries`), so it breaks the run exactly like any rejected word. Layer-1 `maskSecrets` blanks secret windows into spaces, keeping gaps "whitespace" |
| score.ts | `src/core/score.ts:109` `REJECT_COMMON_THRESHOLD = 30`; `:121` `MID_FREQ_THRESHOLD = 20` (retired compat); `:152` `PROPER_NOUN_ADMIT_CEILING = 30`; `:188-196` `rEff`; `:282-361` `admit` | admission | see §5 |
| calibrate-bands | `tools/calibrate-bands.mjs:56` `dictPath = join(root, "dict", "common-en.bin")`; argv words mode `:68-105`; full mode from `:107` | tool | see §7 |

## 2. Occurrence-vs-memo pattern (the load-bearing seam)

`#computeAdmitMemo` (ingest.ts:567-598) computes expand→passesShape→admit
for a DISTINCT raw token and caches the plan; it touches NO store, NO
stats, NO entries. `#replayAdmitMemo` (ingest.ts:606-643) applies the plan
per OCCURRENCE:

```ts
// #replayAdmitMemo — per-occurrence effects only
if (!gate.ok) { this.#stats.rejectedByGate[gate.reason!]++; continue; }
this.#stats.wordsSeen++;
if (result === undefined) break;
if (result === "reject") continue;
this.#stats.admitted++;
entries.push({ key: draft.key, start: token.start, end: token.end });  // run entry, this occurrence's spans
const sighting: Sighting = { key: draft.key, display: draft.display, ordinal,
  fromUser, properName: draft.properName, rankGroup: result };
this.#store.upsert(sighting);
```

Consequence for R1: **run membership, casing tallies, series bigram
marking, and any band override for run members CANNOT live in the memo** —
they depend on line context (neighbors, gaps) that `#computeAdmitMemo`
never sees. The natural insertion point is per-occurrence: `#admitSegment`
already returns `entries` per segment; the line assembler
(`appendSegment`+`splitRuns`, and the `runs` collection in `processText`
ingest.ts:416-496) is where maximal runs become visible. Either (a) enrich
`SpanEntry` with per-occurrence casing/class info so `splitRuns`/the hook
payload can classify runs, or (b) post-process runs after
`splitRuns(openLine)` at ingest.ts:472-484 and :495. The store upsert +
`onAdmittedTokens` call are BOTH at occurrence/message level today
(upsert inside `#replayAdmitMemo`; hook at the tail of `processText`,
ingest.ts:495-497), so a run-member admission override must happen at or
before upsert time — i.e. the memo's `admits[i]` result would need an
occurrence-level override, or run detection must run per segment BEFORE
the upsert. **Design tension flagged:** currently upsert happens inside
`#admitSegment` per segment, but runs only finalize at line end (newline
or message end). A run-member override therefore needs either lookahead
the pipeline lacks, or a deferred upsert. This is the single biggest R1
engineering question.

`admit()` reads commonness via `dictionary.lookup(draft.key)` (score.ts:294),
an injected `Dictionary` (`src/core/dictionary.ts:187` returns
`{ lookup, version, entryCount }`; lazy `createLazyDictionary` elsewhere).

## 3. sentenceStart & per-token case info today

`RawToken.sentenceStart` (types.ts:131-141) is set by segment.ts
`isSentenceStartBefore` (segment.ts:418-445) for every token: true when
first word of line/message, after bullet/heading/list marker, or after
sentence/clause punctuation (`.!?;:` optionally behind closers). This is
the **structural-start** signal, broader than sentence punctuation.

Case info today is minimal: `RawToken.raw` carries the casing;
`expandCandidates` (segment.ts:745-768) derives `properName =
isUpperAscii(token.raw.charAt(0)) && !token.sentenceStart` and sets
`display = token.raw` (this occurrence's casing). No per-token "all caps /
lowercase / capitalized" class field exists — R1's capCount/lowerCount
tallies must classify casing from `token.raw` (occurrence-level, available
in `#replayAdmitMemo` and enrichable into `SpanEntry.key`'s entry).

## 4. Exact current type shapes

```ts
// types.ts:20-33
interface Candidate { key: string; display: string /* most recent casing */;
  sessionCount: number; lastSeenOrdinal: number; firstSeenOrdinal: number;
  userTyped: boolean; properName: boolean; rankGroup: RankGroup /*0|1|2*/; }

// types.ts:43-60
interface Sighting { key: string; display: string /* casing this occurrence */;
  ordinal: number; fromUser: boolean; properName: boolean; rankGroup: RankGroup; }

// types.ts:105-141 (abridged; see file for full JSDoc)
interface RawToken { raw: string; hexish: boolean; literal?: boolean;
  path?: boolean; trimFrom?: number; trimTo?: number; start: number; end: number;
  sentenceStart: boolean; }

// segment.ts:722-736
interface CandidateDraft { key: string; display: string;
  properName: boolean; path?: boolean; }

// onAdmittedTokens payload (ingest.ts:258): (runs: string[][]) => void
// — runs of lowercase keys, exactly one call per processed message.
```

Note: PRD's "replace store Candidate.display with capCount/lowerCount/
capDisplay" touches `Candidate` (types.ts:20) and `store.upsert`
(store.ts:264-298, where `existing.display = sighting.display // most
recent casing wins` and `properName ||= ...` are sticky merges). The
sticky-merge site is where the "first lowercase sighting removes cap
contributions PERMANENTLY" rule lands; a single boolean `seenLowercase`
sticky flag is the natural implementation.

## 5. score.ts admission detail

- Floor: `REJECT_COMMON_THRESHOLD = 30` (score.ts:109) — PRD claim
  "floor constant = 30 (~:109)" ✅.
- `rEff(floor,len)` (score.ts:188-196): flat floor ≤8 chars
  (`REJECT_LEN_FLOOR=8`), sqrt ramp `floor+(255−floor)·√((len−8)/12)` for
  9–19, sentinel 256 at `REJECT_LEN_FULL=20` (admit-all). PRD's "band
  max(R_eff(len), 95)" for mid-sentence capitals: no 95 exists today;
  this would be a NEW formula/branch in admit() or an occurrence-level
  override — feasible, but admit() is currently pure
  f(draft, dictionary, opts); a casing-class relaxation would go through
  `opts` or a new draft field (draft is memoized — careful: the relaxed
  band depends on sentenceStart which is occurrence context, NOT in the
  memo; the draft's properName flag is computed from the token, which IS
  the memo's input, so properName IS memo-safe; a per-occurrence
  sentenceStart-based relaxation is NOT memo-safe as-is. Today
  properName already folds sentenceStart in at expand time, per token,
  and token.raw IS the memo key — so casing-dependent admission IS
  memo-compatible because distinct raw tokens have distinct memo
  entries. Verified: memo key = `token.raw`, so capitalized vs lowercase
  forms memoize separately. ✅ feasible.)
- PROPER_NOUN_ADMIT_CEILING relief: `PROPER_NOUN_ADMIT_CEILING = 30`
  (score.ts:152) == floor ⇒ the branch at score.ts:303-310
  (`result === "reject" && draft.properName && q !== null &&
  q < PROPER_NOUN_ADMIT_CEILING`) is provably dead (rEff ≥ 30 = ceiling
  for all len; rejection requires q ≥ rEff ≥ 30 ⇒ q < 30 impossible).
  Confirmed dead, exactly as PRD claims. Restoring relief for series
  members = constant change + guard, but R1 says run members bypass the
  band entirely — cleaner to do at occurrence level, not via this branch.
- Conjugation guard (score.ts:316-343): skipped when `draft.properName`
  (score.ts:317 `if (result !== "reject" && !draft.properName)`) —
  R1's "series admission bypasses conjugation guard" maps to the
  properName-style skip; a series member needs an equivalent skip, which
  again is occurrence-context (run membership) ⇒ must be an occurrence
  override or a new occurrence-computed flag.
- properName detection today: mid-sentence capital (sentenceStart
  suppressed) at segment.ts:768.

## 6. Store upsert, bigram, debounce mechanics

- Upsert: `store.upsert(sighting)` at ingest.ts:641 inside
  `#replayAdmitMemo` — per occurrence, per segment.
- Bigrams: `onAdmittedTokens(runs)` fired once per message at the tail of
  `processText` (ingest.ts:495-497); wired in `src/pi/index.ts:211` to
  `sessionStore.recordBigramRuns(runs)` (store.ts:536-558). Adjacent
  pairs counted in `#bigrams` (BIGRAM_CAP=10_000, store.ts:102);
  successor index top-3 per word maintained incrementally by
  `#bumpSuccessor` (store.ts:566+; tie: count desc, byte-lex asc; on a
  4th entrant the sorted tail drops — deterministic). `BigramEntry`
  today = `{count, lastSeenOrdinal}` (store.ts:110) — R1's `series`
  flag + `nextDisplay` are additive fields here.
- Debounce: `#pending: {text, fromUser}[]` FIFO (ingest.ts:310); timer
  rearmed on each message (ingest.ts:335-348); `#drain` promise reused;
  `dispose()` (ingest.ts:354) cancels timer and empties `#pending`
  (queued text is DROPPED, never processed).

## 7. tools/calibrate-bands.mjs

Invoked `node tools/calibrate-bands.mjs [words...]` — argv words trigger
the manual tuning dial (lines 68-105): prints per word
`word | len | q(absent|n) | R_eff | verdict(lowercase) | Cap: verdict(capitalized)`
— **a Cap column already exists** (properName:true draft through admit).
No-args mode prints the artifact header, band populations, rank→word→q
table, BUG-001 word set, and PASS/FAIL acceptance of constants. Reads
`dict/common-en.bin` (line 56). Artifact entry count verified live:
**48,802** ✅ (`readUInt32LE(8)` on the shipped bin).

## 8. Feasibility verdicts (R1)

| R1 item | Verdict |
|---|---|
| Maximal capitalized-run detection, strict adjacency window | FEASIBLE — reuse `splitRuns`/`SpanEntry`; need per-entry casing class + a "≥2 members, all capitalized" classifier. Enrich `SpanEntry`/`entries` with casing; runs currently expose only lowercase keys. |
| Run-member admission bypassing commonness band | FEASIBLE but touches the memo seam: admission happens per-segment inside `#admitSegment` before runs finalize. Options: (a) two-pass per finalized line (defer upserts to line finalization — large refactor), (b) upsert eagerly at segment level and retro-override on run finalization (store.upsert is merge-friendly; `rankGroup` already min-merges at store.ts:295). Option (b) is the low-risk path. |
| Baked dictionary top-band ceiling constant (q ≥ ~135 chain-only) | TRIVIAL — new constant beside `REJECT_COMMON_THRESHOLD` (score.ts:109); query.ts must filter standalone suggestions above it while bigram formation stays untouched. |
| Relaxed band max(R_eff, 95) for mid-sentence capitals, not structural starts | FEASIBLE — sentenceStart already per-token (types.ts:131); relaxation is casing-dependent and therefore memo-safe only if keyed on token.raw (it is — memo key = raw). But structural-start exclusion means the relaxed result differs per OCCURRENCE of the same raw string at different positions... memo key is raw, so "Foo" at line start vs mid-sentence share one memo entry — CONFLICT. The memo cannot distinguish occurrences; the relaxation must be an occurrence-level override in `#replayAdmitMemo` (e.g. re-run admit with relaxed opts when !sentenceStart), keeping `#computeAdmitMemo` context-free. |
| capCount/lowerCount/capDisplay tallies replacing Candidate.display | FEASIBLE — touches `Candidate` (types.ts:20), `Sighting` (types.ts:43), `store.upsert` merge (store.ts:264-298), `RankedMatch.display` consumers (types.ts:163, query.ts), tests. Sentence-initial contribution + permanent removal on first lowercase = sticky `seenLowercase` flag in the merge. |
| Series bigrams marked series + nextDisplay + series-first top-3 retention | FEASIBLE — additive fields on `BigramEntry` (store.ts:110) and the `#bumpSuccessor` comparator (series-first is a sort-key tweak); the runs payload needs enrichment (casing + series marking) before `onAdmittedTokens`. |

## 9. PRD-vs-code drift / notes

- All PRD line anchors verified within ±5 lines; only the memo internals
  sit slightly later than claimed (:522 vs :521; :606 vs ":521-545" —
  `#replayAdmitMemo` is at 606, not inside 521-545).
- The relief branch (score.ts:303-310) is dead code exactly as PRD says.
- `onAdmittedTokens` payload carries ONLY lowercase keys — no casing,
  no spans. Every R1 series feature that needs `nextDisplay`/casing
  requires widening this payload (breaking-ish change to the option's
  contract; wired at index.ts:211).
- The single hardest structural fact: **upserts are segment-scoped, runs
  are line/message-scoped**. Run-finalized overrides must be applied as
  store-level merges (or by restructuring `#admitSegment` to buffer).
- `maskSecrets` blanks secrets to spaces, so a secret between two words
  looks like whitespace-adjacent — matches PRD's "secret-shaped member
  splits the run" only for tokens (layer-2 `isSecretShaped` rejects the
  draft ⇒ no run entry ⇒ run splits). Layer-1-masked secrets do NOT
  split (they become gaps) — PRD wording should distinguish these.
