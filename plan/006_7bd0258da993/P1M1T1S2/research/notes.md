# Research notes — P1.M1.T1.S2 (plan 006): uppercase-run walk + enriched onAdmittedTokens payload

## Sources examined
- src/pi/ingest.ts (read :100-500):
  - SpanEntry (:109-122): { key, start, end, gapBefore } — carries ONLY the
    lowercase key; NO casing, NO raw. Enrichment needed for run detection.
  - WHITESPACE_GAP_RE = /^[ \t]+$/ (:128).
  - splitRuns(:176-189): pushes runs of keys; breaks when gapBefore fails
    WHITESPACE_GAP_RE. This is the bigram-run machinery — run detection
    rides the SAME line/openLine/appendSegment stream.
  - appendSegment (:206-247): computes gapBefore from the MASKED segment
    ("GAP PROVENANCE" comment: maskSecrets is length-preserving, gaps are
    read from masked text — "two words around a removed secret look
    adjacent — accepted" FOR BIGRAMS). Segments with no admitted tokens
    still extend the carry (punctuation preserved in gap → breaks run).
  - processText (:416-497): line/openLine/openTail/carry machinery;
    runs: string[][] collected; `this.#onAdmittedTokens?.(runs)` once per
    message at the end.
  - IngestPipelineOptions.onAdmittedTokens (:~258): (runs: string[][])
    => void, documented as the M2 successor-index hook.
  - #admitSegment returns SegmentResult { masked, entries } — spans are
    UTF-16 offsets into the MASKED segment which ALSO index the raw
    segment (length-preserving mask).
- S1 PRP contract: CasingClass = "lower" | "mid-cap" | "structural-cap"
  on CandidateDraft.casing + Sighting.casing; derived in expandCandidates
  from raw[0] + sentenceStart; properName === (casing === "mid-cap").
  IMPORTANT for run detection: run membership = casing is mid-cap OR
  structural-cap (uppercase occurrence regardless of structural start —
  spec h2.26: "the structural-start exclusion does NOT apply to run
  detection"). But S1 classifies DRAFTS, and the SpanEntry stream carries
  only keys — the walk needs the occurrence casing AT THE SPAN SITE.
  Options: (a) derive casing in #admitSegment/appendSegment from the
  token's raw (start..end slice of the segment — raw[0] uppercase check;
  structural-start is IRRELEVANT for run membership, so a simple
  isUpperAscii(rawFirstChar) suffices — no sentenceStart needed!). (b)
  thread draft.casing into SpanEntry. (a) is simpler and exact: run rule
  = "every token beginning with an uppercase ASCII letter".
- MASKED-SECRET PITFALL (architecture/01 §9 + contract): maskSecrets
  blanks secret windows to SPACES → gapBefore around a masked secret is
  pure whitespace → splitRuns-style adjacency would NOT break. For
  BIGRAMS this is accepted (existing comment); for RUNS the contract
  mandates the conservative break. Detection: spans index the RAW text
  too — compute the run-walk's gap purity against the RAW segment (the
  raw window contains the secret's non-whitespace bytes → breaks), or
  carry a per-entry flag `gapMaskedSecret` computed in appendSegment
  where both raw and masked are available. Note: multiple consecutive
  literal spaces in raw prose are legal — so the flag must come from
  masking knowledge, not space-count heuristics. Check how maskSecrets
  exposes match spans (it likely doesn't) — simplest robust approach:
  pass the RAW segment into appendSegment alongside masked and compute
  `gapBreaksRun = !/^[ \t]+$/.test(rawGap)` for the run walk. Masked
  spaces vs raw: a secret's raw window is non-whitespace → breaks.
  Caveat: raw gap where the masked text differs ONLY by secrets is the
  only divergence; prose spaces are identical in both. So raw-gap testing
  is strictly stricter and correct.
- Wiring: src/pi/index.ts:211 `onAdmittedTokens: (runs) =>
  sessionStore.recordBigramRuns(runs)`; store.recordBigramRuns(runs:
  readonly string[][]) (store.ts:536). Widening the payload requires a
  shim at :211 (map members → keys) until T2.S2 consumes the enrichment.
  recordBigramRuns itself UNTOUCHED this task.
- Gate interplay: shape-gate-rejected members never emit SpanEntries →
  they split runs naturally (their gap becomes non-whitespace
  punctuation/symbols... actually a gate-rejected token between two
  capitalized words: the token emits no entry; the GAP between the
  surrounding entries then contains the rejected token's raw text →
  non-whitespace → breaks. Correct per spec: "a secret-shaped/noise
  member splits the run around it").
- Newline breaks runs (line-local stream already). Chunk boundaries
  never break (openLine/openTail carry). Digit/hexish/intervening-word
  breaks fall out of gap purity.
- Tests: test/ingest.test.ts + ingest-pipeline.test.ts conventions —
  in-memory dictionary doubles, onAdmittedTokens spy capture. Battery:
  'ZorpWibbleEngine, quuxblat' comma break; 'Alpha Beta Gamma' run;
  line-initial 'Alpha Beta'; after-punctuation 'Done. Alpha Beta';
  secret member split (sk-... between capitals); MASKED-secret split
  (layer-1 mask window between capitals); lowercase member breaks;
  'Alpha the Beta' intervening word breaks; newline break; single
  capitalized word = no run (runs need ≥2); rawCasing preserved.
- Architecture docs: plan/006.../architecture/01-core-pipeline-r1.md
  (§9 pitfall), 02-store-query (T2.S2 consumer), 03-pi-surfaces.
