# Research notes — P1.M2.T1.S1 (bugfix 001_1a2f4ffe408f): containment defer in tokenize pass 4

## Verified facts (code + architecture doc, all live-verified by the scout)
- Root cause chain (architecture/r2-tokenizer-overlap.md, verified in code):
  - `BASE_RE = /[A-Za-z][A-Za-z0-9_]{0,63}/g` (segment.ts:75) — '_' is a word char.
  - `LITERAL_SYMBOL_CHARS = new Set("._@:+/~=-")` (segment.ts:109) — '_' is a trim symbol. '_' is the ONLY character in both classes → the only straddle class is trailing-'_' literals.
  - Pass-4 equal-span defer at segment.ts:569–570: `if (o !== undefined && o.start === start && o.end === end) continue;` — exact equality only.
  - Final-merge strict-containment absorber at :655 (`fn.start <= tok.start && tok.end <= fn.end` → absorb) — a base token ending PAST fn.end fails it.
  - Overlap-safety branch :658–662 emits the literal AND keeps the straddling base (`kept.push(tok)`) — its `\b boundaries make this unreachable` comment is FALSE for rule 4c (LITERAL_RE has no `\b`).
- Repro (scout-run): `tokenize('FOO_1_')` → literal ['FOO_1',0,5) + base ['FOO_1_',0,6); also `cY1Z`/`cY1Z_`, `API_V2_KEY`/`API_V2_KEY_`; end-to-end: ingest 'rename FOO_1_ and USER_2_TOKEN_ constants' → `rankMatches(store,'foo_')` → ['foo_1','foo_1_'] (plural pruning doesn't cover '_' pairs).
- Chosen fix (b) — defer-to-containing-base — REJECTED alternative (a) overlap-absorption because it contradicts spec/04:104-105 ("literals absorb only strictly-contained tokens") and would complete 'FOO_1' by deleting a typed '_'.
- Exact one-line change: segment.ts:569 `o.start === start && o.end === end` → `o.start <= start && end <= o.end` (equality is the subset case). `o` is the first not-yet-passed out-token ending after `start` (cursor advanced at :568) — the only candidate container (base spans are disjoint; only a base starting at/before the literal start can overlap, and only '_' carries it past end).
- Overlap-safety comment at :660: branch STAYS as defensive guard; note the 4c caveat is now moot for the trailing-'_' class (branch becomes dead for it) — comment-only update.
- The pass-4 PATH equal-span defer (:549-553, "structurally impossible for paths") is a SEPARATE site — leave it (paths contain '/', no base can contain them).
- Tests:
  - No existing test exercises a digit-bearing base identifier with trailing '_'; no existing assertion becomes false under fix (b) (scout grepped).
  - Add: rule-4c describe (test/segment.test.ts ~615, `raws` helper defined there): `expect(raws("FOO_1_")).toEqual(["FOO_1_"])`.
  - Add trailing-'_' inputs to the disjoint-spans invariant cases (:293-305): 'FOO_1_', 'rename FOO_1_ ok', 'USER_2_TOKEN_'.
  - Must KEEP passing: '2560x1440@2' absorption (:617-631 — contained bases still absorb; the defer only fires when the BASE is the container); opaque-literal equal-span pins (:679-690: 'utf8Reader' base wins, '2ndReader' literal — digit-initial literal has NO containing base since base 'ndReader' starts inside); hexish (:96-100,128-150), CJK literal (:692-703), path (:805-821), filename union (:49-70).
- Spec edit (Mode A, binding — spec and code land together per AGENTS.md): spec/04-tokenization-and-scoring.md "Strictly additive" bullet :101-106 — extend the first sentence: a literal whose post-trim span is EQUAL TO or CONTAINED IN a kept base/hexish/compound token defers to that token; add the FOO_1_ example. NOTE: the current bullet already reads "with EXACTLY the span … defers" — the edit widens "exactly" to "equal to or contained in".
- End-to-end no-duplicate assertion is P1.M2.T1.S2's deliverable (0.5pt, planned) — this task provides tokenize-level correctness only.
- Predecessor P1.M1.T2.S3 (parallel): widget chain tests + spec/07 clause — different files (widget/provider/spec-07), no overlap.
- Validation: `npm run check`, `npx vitest --run test/segment.test.ts`, `npm test`.

## Note on PRD wording
The PRD snapshot (h3.1) describes the trim char as trailing '*' — that is a transcription artifact; the codebase and architecture doc confirm it is '_' (LITERAL_SYMBOL_CHARS contains '_' not '*'). Follow the code/architecture.
