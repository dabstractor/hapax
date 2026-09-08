# P1.M2.T2.S3 research notes

## Layer state entering this task
- Layer 1 (S1, DONE): `maskSecrets` in src/core/shapeGate.ts blanks `[0-9a-zA-Z/+]{32,}` bare runs (BARE_RUN_MIN=32) plus 9 structured regexes (ghp_, github_pat_, AIza, xox…, sk-, ey…, AKIA…). Wired at IngestPipeline.#admitSegment.
- Layer 2 (S2, IN FLIGHT — treat as done): #computeAdmitMemo poisons sub-word drafts when the whole-token draft rejects with reason 'secret' (counted in rejectedByGate.secret via #replayAdmitMemo's existing branch).
- Remaining gap (this task): synthetics whose WHOLE token passes every gate and is NOT masked.

## Secret-prefix inventory (SECRET_PREFIXES, shapeGate.ts)
sk-, sk_, ghp_, gho_, github_pat_, xoxb-, xoxp-, xoxa-, xoxr-, xoxs-, akia, aiza, eyj.
- `sk_live_...` already caught by `sk_` (startsWith). 
- `glpat_` underscore variant caught; **`glpat-` hyphen variant NOT caught** (hyphen also splits tokenize, so the payload token is separate; glpat becomes a short word-ish token).
- `npm_` NOT in the list (but npm token format npm_ + 36 alnum: the `_` breaks the bare-run regex charset `[0-9a-zA-Z/+]`; the 36-char alnum tail after `npm_` IS ≥32 → masked by layer 1). Wait — underscore not in charset, so run after npm_ is 36 pure alnum chars → masked. So npm_ leaks only for shorter payloads.
- `Bearer <payload>`: 'Bearer' tokenizes separately; defense must be on the payload itself (layer 1 run rule) — a <32 mixed-case no-digit payload after Bearer is the residual leak.

## Repro fragments documented (PRD h3.2 / core-engine-findings)
'abcdefghijklmnopqrstuvwxy' (25-char lowercase run), 'yz0123456789' (digit-suffixed), 'zabc'. These came from a synthetic alphabet-ish token like 'abcdefghijklmnopqrstuvwxyz0123456789...' broken at run boundaries.

## Test infrastructure
- test/adversarial-ingest.test.ts: real pipeline + shipped dict (resolveDictPath), makePipeline helper, storedKeys(store) forces prefix-index rebuild, rankMatches === [] assertions, positive control ('a zephyr drifted over the vestibule').
- test/mask-secrets.test.ts L96 "leaves prose, URLs and fixture vocabulary byte-identical", L254 "prose fixture replay" (test/fixtures/sessions/prose.jsonl) — the false-positive guards to re-run after any SECRET_PREFIXES/mask addition.
- test/calibration.test.ts + test/shipped-dict.test.ts calibration blocks — must stay green.
- Validation: npm run check (tsc), npm test (vitest --run).
