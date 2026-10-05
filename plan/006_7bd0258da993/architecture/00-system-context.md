# System context — hapax capitalized-series + branch-hygiene delta (baseline 6d8f158)

Written by the breakdown architect after four parallel research lanes
(`01`–`04` in this directory). This file is the cross-cutting synthesis;
per-area detail lives in the lane reports. All anchors below were
verified against the working tree at HEAD `6d8f158`.

## 1. What this repo is

hapax = pi-extension autocomplete (TypeScript, ESM). Two layers:

- `src/core/` — pure, no pi imports (architecture invariant): `segment.ts`
  (tokenize, 797 L), `shapeGate.ts`, `score.ts` (admit + salience, 451 L),
  `store.ts` (CandidateStore: words + bigrams + successor index, 736 L),
  `query.ts` (ranked matching, 634 L), `types.ts` (178 L), `dictionary.ts`
  (packed-bin loader; `dict/common-en.bin`, 48,802 entries verified).
- `src/pi/` — the adapter: `index.ts` (423 L, lifecycle + event table),
  `ingest.ts` (763 L, debounce + admit memo + restore), `provider.ts`
  (1194 L, fallback menu path + startup gate), `widget.ts` (1790 L,
  one-line widget primary path + key machine), `editor.ts` (Enter-submit
  proxy), `chain-grant.ts`, `debug.ts` (/acwords), `config.ts`, `paths.ts`.

Spec is the source of truth (`spec/`, already at target state for this
delta — READ-ONLY for pipeline agents; record drift, never edit).
Plan agents get PRD sections via selectors into
`plan/006_7bd0258da993/prd_snapshot.md` (2733 L; headings verified to
match the PRD STRUCTURE INDEX).

## 2. Delta landing zones (verified)

| Area | State at baseline | Where it lands |
|---|---|---|
| R1 core (runs, tallies, admission, series bigrams) | NOT implemented — zero hits for capCount/capDisplay/series bigrams | `segment.ts` casing class, `ingest.ts` run walk + occurrence overrides, `types.ts`/`store.ts` schema, `score.ts` constants |
| R2 surfaces (resolver, series offers, typed arming) | NOT implemented | `query.ts` :531/:582, `provider.ts` :436/:462-474/:511/:528-560, `widget.ts` :655-665/:880-930/:894/:951-957, `debug.ts` |
| R3 branch rebuild | NOT implemented — no `session_tree` handler anywhere; restore reads `getBranch()` already (`ingest.ts:711-763`) | `index.ts` new handler, `store.ts` reset, `ingest.ts` discardPending, gate re-arm |
| R4 Tab deferral | RED — 3 failing cases in `test/defer-pi-menu.repro.test.ts` | `widget.ts` `widgetHandleInput` (:1592+), before tab-insert handling (~:1688) |
| R5 docs/gauntlet | README stale (:105-114 relief blurb; config table :462-474 says 12/8 vs baked 30/20) | README, docs/M1-DoD.md append |

## 3. Load-bearing architectural facts (from research)

1. **The admit memo is token-intrinsic; runs are occurrence-context.**
   `#computeAdmitMemo` (`ingest.ts:567-598`) caches expand→gate→admit per
   distinct `token.raw`; `#replayAdmitMemo` (`ingest.ts:606-643`) applies
   stats/upserts/run-entries per occurrence. Run membership, casing-class
   tallies, the run-member band bypass, and the 95-band relaxation MUST be
   occurrence-level (in/around `#replayAdmitMemo` + the line assembler),
   never memoized. Confirmed memo hazard: the SAME raw token at a
   structural start vs mid-sentence shares one memo entry, so a
   sentenceStart-dependent relaxation cannot live in the memo.
2. **Upserts are segment-scoped; runs finalize line/message-scoped.**
   Upsert fires inside `#admitSegment`; maximal runs only become visible
   at `splitRuns`/line assembly (`ingest.ts:176-189`, processText
   :416-497, `onAdmittedTokens(runs: string[][])` hook at :495-497,
   wired at `index.ts:211` → `store.recordBigramRuns`, `store.ts:536`).
   De-risked plan (researcher-recommended, low-risk): keep eager
   segment-level upserts and apply run-derived effects (band-bypass
   admission override, chain-only skip, series marking) as
   store-level/occurrence-level merges at run finalization — no
   pipeline restructure. The alternative (deferred upserts) is a large
   refactor and is NOT recommended.
3. **`recordBigramRuns` already exists** (`store.ts:536-561`, takes
   `string[][]` runs of lowercase keys; `BigramEntry {count,
   lastSeenOrdinal}`; top-3 successor index via `#bumpSuccessor`
   :573-606, `successorBefore` :140 count-desc/byte-lex; BIGRAM_CAP
   10_000 with log-count+recency eviction; eviction splices successors
   via `#dropSuccessorFor` :706-717). R1 series work = enrich payload +
   additive fields + comparator tweak, not a new subsystem.
4. **`Candidate.display` removal is safe for scoring** — nothing in
   `score.ts` reads `display` (salience uses sessionCount/recency/
   userTyped/properName/rankGroup). BUT ~22 sites read `.display`
   (inventory in `02` §5): most read `RankedMatch.display` and keep
   working if query fills `display` resolved at BOTH construction sites
   (`query.ts:531` anchored AND `:582` tier-0 — two sites, not one).
   Direct `Candidate.display` readers needing migration: `store.ts`
   :269/:291, `query.ts` :531/:582, `debug.ts` :74/:120/:203,
   `provider.ts:436` + `widget.ts:667` (successor label fallback
   `store.get(s.next)?.display ?? s.next` → becomes `nextDisplay`-
   aware). **Migration strategy: additive-then-subtractive** — M1 adds
   tallies alongside `display` (all consumers stay green), M2.T1.S2
   switches query to the resolver and removes `display`.
5. **R3 must rebuild the store IN PLACE for the fallback path.**
   `addAutocompleteProvider` has NO unregister; the registered provider
   closure captured the session's `CandidateStore` instance at factory
   time. Reassigning module slots is invisible to it. Therefore:
   same-store-instance `reset()` (drop words+bigrams+successor index),
   `IngestPipeline.discardPending()` (dispose's timer+queue clear
   without teardown; in-flight drain exits on the empty queue),
   `restoreFromHistory` reused verbatim (it only ADDS through the normal
   chain — hence the reset first), gate RE-ARM (provider gate
   `createStartupGate` `provider.ts:793` currently settles once; widget
   gate is already re-armable via `armGate` `widget.ts:668-673`/`:955`).
   Widget path rebind follows the session_start reload precedent
   (`index.ts:275-308`: re-wrap `widgetOptsOf(editorFactory)?.inner`).
   `session_tree` event type verified in
   `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:505-512`
   (`{newLeafId: string|null, oldLeafId: string|null, summaryEntry?}`);
   registered via `pi.on("session_tree", handler)`. `summaryEntry` =
   branch summary — never ingested (h2.38/h2.40). Compaction must NOT
   rebuild (no new compact handler).
6. **R4 fix point**: `widgetHandleInput` (`widget.ts:1592+`) — after
   `decideWidgetKey` (pure, :1194) returns, before tab-insert handling
   (~:1688): if Tab and `inner.isShowingAutocomplete?.() === true` →
   forward verbatim (precedent: Enter-submit guard `editor.ts:111-115`).
   This alone satisfies all 3 red cases (each asserts `pi.applied`);
   case 3 (hesitation race) is covered because deferral keys on pi's
   menu actually being open, not on static context classification.
7. **Dead code confirmed**: `PROPER_NOUN_ADMIT_CEILING = 30`
   (`score.ts:152`) == floor ⇒ relief branch `score.ts:303-310`
   provably dead — stays retired-in-place (do not revive; R1's bypass is
   occurrence-level, not this branch).
8. **Dictionary top-band ceiling**: trivial constant beside
   `REJECT_COMMON_THRESHOLD = 30` (`score.ts:109`); calibrate with
   `node tools/calibrate-bands.mjs <words...>` (already prints a `Cap:`
   column; artifact 48,802 entries; PRD pins q ≥ 135 ≈ 203 words).

## 4. Baseline drift the plan must carry (record, don't fix silently)

- **Suite counts**: actual `npm test` at baseline = **4 failed / 1128
  passed / 1 skipped (1133)**, not the PRD-claimed 3/1129/1. The 3
  repro reds match; the 4th is `test/acceptance.test.ts`'s network-gated
  `pi -p -e` case exiting 1 with stderr outside the environmental-skip
  regex (acceptance.test.ts:645-658) — environment-sensitive; R5's
  gauntlet must resolve or explicitly acknowledge it.
- Anchor corrections vs PRD (all ±<10 lines): `#replayAdmitMemo` at
  ingest.ts:606; `Candidate` types.ts:19-33; `Sighting` :36-47;
  `Successor` :54-60; upsert store.ts:264-298; ranking comparators
  query.ts:370-404; provider exact-equal :511; close-on-space :528-560;
  dispose :353-363; debug :60-91/:118-127/:195-210.
- Known spec-internal staleness (owner reconciles interactively; we
  record in the R5 drift report): spec/08 schema example
  `"rejectCommonness": 12` vs baked 30; spec/09 query.test.ts ranking
  bullet (retired count-before-length) vs 04 h2.31
  tier→length→count→lex.

## 5. Non-negotiables that constrain every subtask

Tab-only completion; menu never renders with zero candidates; RAM-only
(no persistence/telemetry/network — new store dump APIs for purity tests
must not touch fs); `npm run check` + `npm test` green before commit;
UI-layer changes need live TTY verification (spec/09 h2.61) — that is
why P3.M1.T2.S3 exists; spec/*.md is read-only for implementers.

## 6. File map of this directory

- `00-system-context.md` — this file.
- `01-core-pipeline-r1.md` — ingest/segment/score/types anchors, the
  memo pattern, feasibility verdicts per R1 item.
- `02-store-query-r1-r2.md` — store/query anchors, verbatim types,
  `.display` consumer inventory, purity-comparison options, test
  conventions.
- `03-pi-surfaces-r2-r3-r4.md` — provider/widget/editor/index anchors,
  pi extension API quotes, R3 rebind seams, R4 insertion options.
- `04-tests-docs-r5.md` — repro case analysis, confirmed suite counts,
  spec/09 acceptance extraction, README/DoD sync targets, perf gates,
  calibration tool.
- `external_deps.md` — pi / pi-tui API surfaces this delta depends on.
