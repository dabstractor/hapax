# Research notes — P1.M1.T2.S2 (plan 006): series bigrams + series-first top-3 retention

## Upstream contracts
- P1.M1.T1.S2 (Complete): `RunMember { key: string; rawCasing: string }`;
  `onAdmittedTokens?: (runs: readonly (readonly RunMember[])[]) => void`.
  rawCasing = run casing of each member (e.g. "National"). Runs pre-chunked
  by ingest; window-break logic lives upstream — store does NO windowing.
- P1.M1.T3.S1 (Planned): chain-only members (dictionary top-band ceiling)
  never reach upsert but DO appear in runs — include them in pairs (spec
  h3.6/h2.26). Store needs no admission knowledge: every run member forms
  pairs.
- P1.M1.T2.S1 (parallel): casing tallies at upsert; touches upsert/eviction
  + #capForms — NOT recordBigramRuns/#bumpSuccessor. No conflict; both edit
  store.ts (different regions).

## Verified live source (store.ts)
- recordBigramRuns :536-561 — takes `readonly string[][]` today (plain
  keys); must widen to RunMember payload.
- BigramEntry :113 `{count, lastSeenOrdinal}`; bigramSortKey :136
  `log(count) + lastSeenOrdinal/50`; BIGRAM_CAP 10_000; eviction drains
  via heap, splices successors (#dropSuccessorFor :706-717).
- #bumpSuccessor :573-606 — top-3 array, successorBefore :143 (count desc,
  byte-lex asc), sorted-tail drop at length 4; a bump only moves toward head.
- Successor (types.ts :82) `{next, count}`; topSuccessors O(1) read
  returning live array (NO_SUCCESSORS shared-empty for absent words).
- Tests: test/bigrams.test.ts (:14-71 region) + test/successors.test.ts
  conventions — pure store, no mocks.

## Design
- types.ts: `Successor` + `BigramEntry` gain `series?: boolean` and
  `nextDisplay?: string` (Mode-A JSDoc: series-derived + run casing of the
  second word for offer display, spec 06 h3.6/h3.7).
- recordBigramRuns(runs: readonly (readonly RunMember[])[]): for each
  adjacent pair (m1, m2): key `${m1.key} ${m2.key}`; entry gains
  series/nextDisplay when the pair came from a capitalized run.
  Q: how does the store know a run is "capitalized"? The payload runs from
  T1.S2 are uppercase-run walks — per its PRP, onAdmittedTokens now carries
  member runs (decide: runs payload may mix ordinary adjacency runs and
  capitalized runs — verify at implementation whether T1.S2 marks run
  kind; if unmarked, derive from `rawCasing[0]` uppercase on BOTH members,
  matching the walk's definition). Mark series = both members' rawCasing
  starts with uppercase ASCII. nextDisplay = m2.rawCasing.
- Backward compat: existing tests call recordBigramRuns([["a","b"]]) with
  plain strings. Options: accept `readonly (readonly (RunMember|string)[])[])`
  (typeof check) or update call sites/tests. RECOMMEND: accept both —
  string members are ordinary (series false, no nextDisplay) — keeps
  chain.test.ts feeders green.
- Series-first retention: successor ordering becomes (series first, then
  count desc, then byte-lex). Extend successorBefore:
  `if (a.series !== b.series) return !!a.series && !b.series;` first.
  Careful with mixed upgrades: an ordinary entry bumping later can't jump a
  series entry; a series entry always displaces ordinary on overflow.
  nextDisplay must survive count bumps (stored on the Successor entry at
  creation; refresh on series re-sight is fine).
- Eviction parity unchanged (bigramSortKey ignores series — same policy);
  #dropSuccessorFor splice unchanged.

## Gotchas
- Series-first is the 07 h2.53 "series first regardless of counts" rule —
  topSuccessors consumers (chain offers) must see series entries first.
- successorBefore change must keep the "bump only moves toward head"
  invariant: series flag never flips on an existing entry EXCEPT when an
  ordinary bigram later re-forms as series (same pair, capitalized run) —
  upgrade-in-place: set entry.series = true + nextDisplay, then resort;
  document this direction (never downgrades).
- Keep O(1) topSuccessors read; arrays still ≤3.
- NodeNext .js imports.
