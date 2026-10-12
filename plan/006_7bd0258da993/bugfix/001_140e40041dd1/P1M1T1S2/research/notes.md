# Research notes — P1.M1.T1.S2 (bugfix 001_140e40041dd1): un-shim mirrored test pipelines

## Sources examined (all read at HEAD)
- test/acceptance.test.ts makeChainPipeline (:737-742): the shim mirror —
  `onAdmittedTokens: (lines) => store.recordBigramRuns(lines.map((r) =>
  r.map((m) => m.key)))` inside an enableChaining spread; uses the REAL
  dictionary (loadDictionary(resolveDictPath())) + zephyr-chain.jsonl.
  Assertions ≈822-827: topSuccessors('zorp') toEqual([{next:'zephra',
  count:4},{next:'turbine',count:1}]) etc. — all LOWERCASE words, so after
  un-shim these entries stay {next,count}-only UNLESS the fixture contains
  capitalized runs (verify: 'AZNI' acronym — all-caps token begins with
  uppercase; is it run-adjacent? read the fixture; if a run exists the
  entry gains series:true + nextDisplay — pin whatever the enriched
  payload truthfully produces, never weaken count/order).
- test/adversarial-typing.test.ts:465-478: NREL fixture replay
  (`parseSessionFixture(NREL)`) with the same shim; NREL text contains
  'National Renewable Energy Laboratory' — a genuine capitalized run →
  THE prime site for new series assertions
  (topSuccessors('national') gains series:true, nextDisplay 'Renewable',
  etc. — 'the' class chainOnly members appear in payload, never stored).
- test/successors.test.ts makeSuccPipeline (:60-70): stub dictionary
  (rejects via REJECT_COMMON_THRESHOLD+30), comment literally says
  "index.ts's shim: members → keys (plan 006 payload widening)" — comment
  must be rewritten (Mode A).
- test/branch-purity.test.ts makeRig (:304-311): same shim, stubDict.
- KEEP legacy bare-string arms: test/bigrams.test.ts direct string[][]
  calls (:16-41: recordBigramRuns([["a","b"]]) counting semantics) and
  the 11k-pair flood test (:238-240 area — its shim stays; store's
  string|RunMemberInput union is a pinned compat contract).
- S1 PRP contract: index.ts now passes `runs` unprojected inside the
  enableChaining spread; store.recordBigramRuns accepts
  readonly (readonly (RunMemberInput|string)[])[]; series marked iff BOTH
  members enriched with series===true; RunMember = {key, rawCasing,
  series?, chainOnly?}; keys read via typeof m === "string" ? m : m.key.
- S1's out-of-scope list also named bigrams:118/140, chain:751,
  perf-gates:496, chaining-gating:143, ingest-pipeline:34 — but THIS
  contract enumerates exactly four mirrors to un-shim
  (acceptance/adversarial/successors/branch-purity) + the two bigrams
  legacy arms to keep. Follow THIS contract's enumeration; leave the
  others untouched (they're store-level or perf fixtures).
- architecture/bug001-series-pipeline.md §5 tables every mirror.
- Assertion-update principle: lowercase non-run members → entries remain
  {next,count}; capitalized-run pairs → entries gain series:true +
  nextDisplay. Use field-wise/partial matching where a fixture's full
  shape is noisy; never weaken count/order semantics.
- New regression deliverable: capitalized-run history through the real
  pipeline yields series-marked successors (not fabricated stores).
- Dictionary: acceptance/adversarial use the REAL shipped dict; others use
  stubs — no network, no new mocks.
