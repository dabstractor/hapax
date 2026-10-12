# spec/06 drift record — Candidate record shape (bugfix 001_140e40041dd1)

For P2.M2.T2.S2's drift report. spec/*.md is READ-ONLY this run; the drift
below is documented here instead, per the binding AGENTS.md policy.

## Candidate record shape (spec 06 vs landed)

- **NEW optional field `pathDisplay?: string`** on the Candidate record
  (bugfix 001_140e40041dd1, BUG-002 store-half fix): verbatim edge-bearing
  display (leading `/`, `~`, `./`, `../`) for path-class candidates
  (spec 04 rule 4d). Seeded by the FIRST path sighting at upsert's create
  branch (sticky-first — later sightings never overwrite; merge branch
  never writes it). Absent ≡ the candidate never arrived as a path
  sighting. Wins over capDisplay in completion-time resolution when both
  exist (letter-initial paths can classify mid-cap — both fields then
  coexist; the resolver guard ordering is P1.M2.T1.S2's).
- **NEW optional field `path?: boolean`** on Sighting (mirrors
  CandidateDraft.path): true ≡ this occurrence is path-shaped; the store
  seeds pathDisplay from the first such sighting.

## Known edge recorded for S2

- A candidate that FIRST arrived as a non-path word keeps NO pathDisplay
  even when a later path sighting merges into it (merge branch is
  create-only by design — sticky-first/deterministic). Such a candidate
  inserts bare. The resolver guard (P1.M2.T1.S2) owns whether that corner
  needs further handling.

## Rationale (why a record field, not a side map)

- Dies with eviction automatically; no reset()/replay special casing
  (rebuild flows through normal upsert); O(1) reads; no #capForms-style
  cross-structure cleanup.
