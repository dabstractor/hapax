# Research — P1.M1.T2.S1 (plan 002): store.ts phrase machinery out, recordBigramRuns in

## Authoritative deletion/keep inventory
`plan/002_3e8a42cadf2c/architecture/core_phrase_layer_map.md` gives exact line
ranges (verified against live source during recon):

DELETE in src/core/store.ts:
- constants/helpers: PHRASE_CAP (98–99), PHRASE_EVICT_BATCH (106–112),
  phraseSortKey (121–127), EvictNode (143–147), evictNodeBefore (150–156),
  heapPush (159–171), heapPop (174–196)
- fields: #phrases (213), #phraseCandidates (218), #phraseEvictHeap (230),
  #fastPathAdmitted (235)
- methods: recordPhraseLines (445–481), #upsertPhrase (484–526),
  #admitPhrase (578–603), #firstSightFastPathEligible (609–625),
  #evictPhrasesIfOverCap (655–709), #rebuildPhraseHeap (714–738),
  setPhraseSticky (763–766), isPhraseCandidate (774–777),
  phraseCandidateKeys (781–784), isFastPathPhrase (790–793),
  removePhraseCandidacy (800–803), sweepPhraseDemotions (825–841),
  getPhrase (844–848), get phraseSize (861–864), phraseEntries (868–871),
  iteratePhrases (878–880); PhraseEntry import (~L79); phrase/successor doc
  sections (44–71 → trim to successor-only).

KEEP: successorBefore (129–135), NO_SUCCESSORS (199), #successorIndex (225),
#bumpSuccessor (528–575), #dropSuccessorFor (748–758), topSuccessors (856–859);
entire word layer (#map, STORE_CAP=20_000, EVICT_BATCH, evictIfOverCap 329–372,
upsert/prefixRange/get/entries/rankGroupHistogram/sortedKeysSnapshot/lowerBound).

types.ts: DELETE PhraseEntry (61–78). KEEP Successor (82–90) and all others.

## Key mechanics learned from source
- #bumpSuccessor(w1,w2): top-3 sorted count-desc/byte-lex, insertion-shift
  bounded; tail drops on length 4. Perfect as-is bigram recording tail.
- #dropSuccessorFor(key): splits on FIRST space, requires exactly one space
  (bigram only), splices from w1's array, deletes empty arrays. Re-point from
  #evictPhrasesIfOverCap to the new bigram eviction.
- Lazy-heap eviction pattern (to re-implement minus sticky): heap built
  wholesale on first overflow from the live map, then maintained by
  heapPush on create; batch drop via heapPop while over cap; victims are
  popped keys deleted from the map + #dropSuccessorFor(key).
- phraseSortKey = log(count) + lastSeenOrdinal/50 — log-domain eviction key
  for the bigram variant (no sticky exclusion in the new design).
- recordPhraseLines today stamps ordinal from caller
  (sessionStore.currentOrdinal()); new recordBigramRuns has NO ordinal param —
  it should read the store's own #ordinal/currentOrdinal() for lastSeenOrdinal.

## Production re-points (compile integrity)
- src/pi/index.ts:183 recordPhraseLines → recordBigramRuns(lines);
  delete onSweepPhrases wiring at index.ts:188 (and the enablePhrases gate
  wrapping 180–188 → keep onAdmittedTokens ALWAYS wired; enablePhrases key
  removal is P1.M3.T1.S1's job — for now the gate may stay if config still
  declares enablePhrases, but onSweepPhrases must go).
  DECISION: minimal change = keep the enablePhrases gate around the surviving
  onAdmittedTokens (P1.M3.T1.S2 re-points the gate read); delete only the
  onSweepPhrases entry.
- src/pi/ingest.ts: remove onSweepPhrases option (L135), field (164),
  assignment (188), invocations (233, 277). KEEP onAdmittedTokens
  (129/163/187/233) — it is the seam that still feeds bigrams
  (P1.M1.T3.S2 will change its payload contract; here the type stays
  (lines: string[][]) and callers stay identical).

## Test pruning (keep suite green; full rewrites land in T3.S3/M2)
- DELETE entire: test/phrases.test.ts, test/phrase-gating.test.ts
- test/index.test.ts:411–444 (recordPhraseLines spy + enablePhrases gating
  case) — prune/trim to compile
- test/ingest-restore.test.ts:519–522, 605–676 (sweep/candidacy/fast-path/
  getPhrase cases)
- test/ingest-pipeline.test.ts:355–375 (recordPhraseLines/getPhrase)
- test/acceptance.test.ts:585, 667 (recordPhraseLines, phraseSize)
- test/adversarial-ingest.test.ts:293–353; adversarial-typing.test.ts:444
- test/perf-gates.test.ts:33, 282–283, 295–300 (PHRASE_CAP/PHRASE_EVICT_BATCH/
  recordPhraseLines/sweepPhraseDemotions/phraseSize)
- test/debug.test.ts phrase dump cases (P1.M1.T2.S3 owns debug.ts itself, but
  debug.ts imports PhraseEntry/phraseSalience/firstWord/PHRASE_CAP → it MUST
  compile; minimal stub: strip phrasesSection in this task ONLY IF compilation
  forces it — otherwise T3.S3's PRP handles it. Coordinate: debug.ts imports
  doomed symbols, so this task's "tree compiles" gate REQUIRES touching
  debug.ts at least minimally.)
- test/successors.test.ts / chain.test.ts use recordPhraseLines as feeder
  (chain.test.ts 134, 147–148, 372, 466) → re-point to recordBigramRuns.
- query.ts: NOT in this task (P1.M1.T2.S2) — but query.ts imports
  phraseCandidateKeys/getPhrase from store + PhraseEntry. Same compile gate
  issue → minimal seam: keep this task self-contained by ALSO minimally
  trimming query.ts's phrase block? NO — T2.S2 is the dedicated task. To keep
  the tree compiling at THIS task's end, the phrase store methods must remain
  until... CONFLICT. Resolution per item contract: "Prune now-dead test cases
  so the tree compiles" and the contract lists only index.ts/ingest.ts/test
  pruning. The clean sequencing: this task deletes store methods, so query.ts
  and debug.ts MUST be minimally patched (delete their phrase blocks) in the
  same commit to satisfy compilation — do the minimal deletion there, leaving
  deeper redesign (suppress seam removal, one-word invariant tests, successor
  dump) to T2.S2/T2.S3.

## PRD anchors
PRD §06 h2.38/h3.7 (delta_prd): bigrams of adjacent admitted whole tokens,
key `first second`, map cap 10,000 with standard eviction, evicting a bigram
splices it from the successor index. No trigrams, no PhraseEntry, no
admission/sticky/demotion, no constituent suppression. One word per
completion, always.