# Research notes — P1.M2.T1.S1 (base tokenization)

## Codebase facts verified
- `src/core/types.ts` (complete, P1.M1.T1.S2) is a pure-declaration module (NO imports, no runtime code). It does NOT yet define `RawToken` — this task must add it there.
- Module layout per PRD §02: `src/core/segment.ts` (segmentation), tests in `test/segment.test.ts` (flat test dir, sibling of `src/`; existing suites: `test/dictionary.test.ts`, `test/types.test.ts`, etc.).
- Tooling: vitest (`npx vitest --run` / `npm test`), `tsc --noEmit` via `npm run check`. No eslint/ruff; plain ESM (`"type": "module"`), TS strict, imports use `.js` extensions (see `test/dictionary.test.ts` importing `../src/core/dictionary.js`).
- Test style (from `test/dictionary.test.ts`): top doc-comment explaining scope, `describe`/`it`, real fixtures, no mocks where avoidable, ESM imports from vitest.
- Architecture invariant: `src/core/` must never import from pi packages; segment.ts is pure (no pi imports, no node imports).
- Dictionary test fixture already uses `f3a9c2e` as a hexish word — consistent with PRD §09 segment cases.
- Downstream consumer: P1.M2.T1.S2 (subword splitting + normalization) consumes RawToken[]; hexish tokens skip subword splitting (whole-token only, decided below: hexish tokens are opaque commit hashes — splitting them is meaningless).

## PRD extraction (§04 Segmentation, §09 segment.test.ts)
- Base regex: `/[A-Za-z][A-Za-z0-9_]{0,63}/g` — captures identifiers/words, implicitly caps length at 64.
- Hexish scan: `/(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g` — 6–40 hex chars, must contain at least one letter a–f (lookahead `[0-9a-fA-F]*[A-Fa-f]`), `\b`-terminated. Dedupe against tokens already captured by base scan.
- CJK rule: if a codepoint ≥ 0x3000 opens a run, skip to next ASCII word boundary. Since base regex is ASCII-only `[A-Za-z]`, CJK/non-ASCII chars are naturally never matched — the "skip" is mostly automatic; tests assert ASCII resumes after CJK runs.
- Punctuation/whitespace terminate: `state-of-the-art` → 3 tokens (regex naturally handles this — no hyphen/apostrophe in char class).
- §09 cases: `f3a9c2e` captured; `123456` not (no letter); 41+ hex chars not; CJK run skipped with ASCII resuming after; hyphen splits.

## Regex semantics notes (gotchas)
- Length bounds: whole tokens 2–64. The `{0,63}` quantifier with a leading letter caps at 64 but the PRD says length 2–64 for base tokens, and admission later requires ≥4 — S1 should EMIT length-2/3 tokens (filtering is shapeGate's job in T2), i.e. min length is 2 per PRD rule 1 ("Base tokens … length 2–64"). The regex allows single-char matches? No — leading `[A-Za-z]` + `{0,63}` allows a 1-char match. PRD says 2–64, so filter len < 2 (single letters) out in tokenize.
- Hexish dedupe: a hexish token like `abcdef` would ALSO match the base regex (starts with letter, all alnum). Dedupe: track matched spans or a Set of raw strings from base pass; skip hexish matches whose span/text already captured. Simplest: since base pass runs first and hexish runs second, drop hexish match if identical span was captured (Set of `start` indices or raw text).
- Hexish tokens are NOT necessarily also base tokens when they start with a digit (e.g. `0f3a9c2`), so the second scan is genuinely additive.
- `\b` after hex: a 41+ char hex run will match the first 40 chars only if `\b` holds — it doesn't (`\b` requires a word boundary; char 41 is a hex word char, so no boundary → the {6,40} alternative backtracks... actually regex backtracks to shorter lengths where `\b` may hold; e.g. 41 'a' chars: no `\b` at any internal position since all word chars → no match. But 41 mixed chars where position 40 is word char and 41 is word char: still no boundary inside. So genuinely no match for a 41+ contiguous hex run. Tests should verify with e.g. 41 hex chars.)
  - Actually caution: `abcdef...` of length 41 all word chars — every candidate substring end inside the run has a word char after it, so `\b` fails everywhere. Correct: not captured.
- Non-ASCII beyond CJK range (e.g. accented é) also skipped naturally — non-goal per PRD ("all non-ASCII runs").
- Allocation-light: runs on every ingested message in ≤64KB slices; avoid intermediate arrays beyond the result; use `exec` loop or `matchAll`, no per-char scanning.