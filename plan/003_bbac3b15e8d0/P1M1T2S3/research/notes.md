# Research notes — P1.M1.T2.S3 (plan 003): store display flow + key!=display audit + bigram whole-token entry

## Source research
- `plan/003_bbac3b15e8d0/architecture/r2-path-candidates.md` §3 (store) and §4 (bigrams) — full
  line-anchored analysis; this item's contract is essentially "verify §3/§4 claims and pin them
  with tests."
- Sibling PRPs: `plan/003_bbac3b15e8d0/P1M1T2S1/PRP.md` (classifyPath, key≠display drafts — COMPLETE,
  landed in src/core/segment.ts) and `P1M1T2S2/PRP.md` (shape-gate path cap 4–96 — in flight;
  assumed exact per its PRP).

## Verified current state

### Store (src/core/store.ts)
- Upsert merge at store.ts:293: `existing.display = sighting.display; // most recent casing wins`.
  Nothing anywhere in store.ts assumes `display.toLowerCase() === key`. Confirmed by reading
  upsert (~L270–300) and the class docs (L5–12).
- Prefix index (`#sortedKeys`/`#pending`, INDEX_MERGE_BATCH=256, prefixRange at store.ts:394-409):
  keys with `/` sort fine (byte-lex; `/` = 0x2F < `0`-`9` < `a-z`). Path keys flow through the
  index unchanged.
- `recordBigramRuns(runs)` (store.ts:479-515): counts `"w1 w2"` single-space-joined keys, bumps
  `#bumpSuccessor` (top-3 per word). `#dropSuccessorFor` splits on first/last space (store.ts:638-647).
  Path keys contain no whitespace (whitespace terminates the literal scan run), so join/split
  invariants hold with path keys as ONE key.

### Segmentation (already landed, S1 complete)
- segment.ts:744: path tokens emit `display: token.raw, // ORIGINAL edges preserved for insertion`;
  key is the trimmed-lower path. Path spans keep original start/end (segment.ts:487-491).
- test/segment.test.ts:742 already asserts `d.display.toLowerCase() !== d.key` for edge-trimmed paths.

### Query / debug outflow
- query.ts:118 `display: c.display // insertion casing exactly as stored (h2.27)` — flows unchanged.
- One-word-invariant comments at query.ts:6, 83, 118 say "every item's display is exactly one word /
  single word". A path display has no whitespace, so the letter holds, but the wording ("word")
  is now inaccurate for path candidates — safe to clarify comments (paths are single tokens) but
  MUST NOT change behavior.
- /acwords (src/pi/debug.ts): top rows print `c.display` (L74-75); tab-dump prints
  `${c.key}\t${c.display}\t...` (L203) — edge-bearing displays flow out unchanged in format.
  No code change needed; needs a pin test.

### Audit surface — `display.toLowerCase() === key` assumptions
Repo-wide grep results:
- src/core/shapeGate.ts:257, 434 — `display.toLowerCase()` inside secret checks; operates on
  display content, not an equality assumption. FINE (spec'd: isSecretShaped sees original edges).
- test/acceptance.test.ts:503 — `key: display.toLowerCase()` fixture construction; check context,
  benign unless a case conflates key and display for path tokens.
- test/store.test.ts — display cases (L128-136) assert recency-wins for CASING only; no
  key≡display assumption; extend with edge-variant cases.
- test/bigrams.test.ts — describes: "recordBigramRuns — counting" (4 cases), "— successor index"
  (2), "bigram cap — 10,000..." (5), "BUG-006 ..." (2). No path cases; add adjacency-with-path case.

### Spec anchors
- spec/04-tokenization-and-scoring.md:118-174 (rule 4d); :157-158 "the successor
  `edit → path` is legitimate" — this is the required bigram test case.
- spec/06-candidate-store.md:71-78 (raw-text adjacency window: breaks on anything but plain
  spaces/tabs between tokens), :109-111 (successor index, cap 10k).
- spec/04:162-166: paths surface at the path's FIRST character only (mid-path typing is stock pi).

## Validation commands
- `npm run check` → tsc --noEmit
- `npm test` → vitest --run; targeted: `npx vitest --run test/store.test.ts test/bigrams.test.ts test/debug.test.ts test/segment.test.ts`

## Conclusion
ZERO production-code changes are expected. Deliverable = regression tests (store display merge
under edge variants, bigram `edit → path` adjacency, debug dump outflow) + comment clarification
(query.ts one-word-invariant wording) + audit fixes only if grep finds a real breakage.
