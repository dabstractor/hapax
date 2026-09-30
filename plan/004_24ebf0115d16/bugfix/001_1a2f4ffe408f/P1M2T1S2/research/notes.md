# Research notes — bugfix 001_1a2f4ffe408f P1.M2.T1.S2: end-to-end no-duplicate pin

## Upstream contract (P1.M2.T1.S1, implementing in parallel — assume delivered)
- src/core/segment.ts pass-4 containment defer: a literal whose post-trim span is CONTAINED IN (or equals) a kept base/hexish token defers — `tokenize('FOO_1_')` → exactly `['FOO_1_']` (base, literal:false); `'USER_2_TOKEN_'`, `'API_V2_KEY_'` likewise single tokens. S1's tests are tokenizer-level (test/segment.test.ts); this task adds the PIPELINE-level pin (ingest → store → rankMatches).

## Verified repro (r2-tokenizer-overlap.md Claim 2 — real run, /tmp/bug002-out.txt)
- Pre-fix: `IngestPipeline.processText('rename FOO_1_ and USER_2_TOKEN_ constants')` → store holds BOTH `foo_1` + `foo_1_` (and `user_2_token` + `user_2_token_`); `rankMatches(store,'foo_')` → `["FOO_1","FOO_1_"]`; `'user_2'` → both twins.
- Post-fix expectation: store holds ONLY `foo_1_` / `user_2_token_`; each probe returns exactly one candidate.
- Plural pruning non-coverage root cause: query.ts:553–565 prunes exact key+'s' pairs only — `foo_1_` is `foo_1`+'_', never pruned. (No change to pruning — the fix is upstream at tokenize.)

## Test home + harness pattern (verified in test/ingest-pipeline.test.ts)
- `stubDict(): Dictionary` at :89 — lookup returns q for common words, null otherwise; version 1. Absent words (foo_1_, user_2_token_) → null → group 0 admission. Use this stub — no real dict needed; "no mocking" in the contract means no pipeline/store mocking, the dict stub is the file's own established pattern (everything still in RAM, real IngestPipeline + real CandidateStore + real rankMatches).
- `makePipeline({onAdmittedTokens?})` at :110 → Harness {pipeline, store, counts}.
- Precedent for pipeline→rankMatches assertions: :662 `expect(rankMatches(h.store, "cy")).toEqual([])`; BUG-residue describe at :637 ("parent-secret propagation to sub-words (BUG-003 residue)") — naming precedent: cite the BUG id + PRD section in the describe title.
- rankMatches imported from ../src/core/query.js (:17); CandidateStore from ../src/core/store.js.

## Where the pin goes
- New `it` (or small describe) appended near the BUG-residue block in test/ingest-pipeline.test.ts — it exercises ingest, not segment; segment-level cases belong to S1's suite (don't duplicate).
- Assertions: (1) `store.get('foo_1_')` defined, `store.get('foo_1')` undefined (trimmed twin NOT stored); same for user_2_token twins. (2) `rankMatches(h.store, 'foo_')` → exactly one match, key 'foo_1_' (display 'FOO_1_'). (3) Same for 'user_2'. (4) Optional: exact expected candidate arrays for both probes.
- Await pipeline.processText(text, true) (fromUser=true matches the repro).

## Commands
- npx vitest --run test/ingest-pipeline.test.ts -v; npm run check; npm test.
