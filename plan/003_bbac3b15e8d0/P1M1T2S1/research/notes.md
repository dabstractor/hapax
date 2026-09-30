# Research — P1.M1.T2.S1 (plan 003): classifyPath predicate + 4d path drafts in segment.ts

## Authoritative recon: architecture/r2-path-candidates.md
Full feasibility map (§5–§7). Key facts:
- LITERAL_RE = /[A-Za-z0-9._@:+/~=-]{4,80}/g (segment.ts:97) — code window 80
  vs spec 96: WIDEN to {4,96} IN THIS CHANGE.
- classifyLiteral (segment.ts:174-196): edge-trims LITERAL_SYMBOL_CHARS
  ("._@:+/~=-"), len 4–64 post-trim, rejects adjacent interior symbols,
  requires a digit; returns post-trim [from,to) bounds.
- Literal pass loop (segment.ts ~404-421): classifyLiteral → per-match bounds
  start/end are POST-TRIM; `raw: text.slice(start, end)` — i.e. today literal
  tokens emit the TRIMMED slice as raw. Rule-3 guard: isUniLetterBefore(text,
  start) || isUniLetter(codePointAt(end)) → skip. Equal-span defers via
  monotonic cursor `ck`.
- Absorber sweep (segment.ts ~423-470): compounds+literals sorted start asc /
  longer-first / compound-before-literal on ties; containment dedupe; mk()
  builds RawToken {raw, hexish:false, literal, start, end, sentenceStart}.
- expandCandidates (segment.ts ~543-580): whole = {key: raw.toLowerCase(),
  display: raw, properName: nameInitial, isSubword:false};
  `if (token.hexish || token.literal) return [whole];` — opacity branch.
- types.ts RawToken has `literal?: boolean` (~83-113 with start/end/
  sentenceStart); CandidateDraft lacks path flag (needed by T2.S2's gate caps,
  but the draft flag should be added here since drafts are produced here).

## Design decisions for the PRP
1. classifyPath(raw): string → { from, to } | null where from/to bound the
   TRIMMED KEY inside the raw match (leading '/', '~', './', '../' combos +
   trailing '/' trimmed; ':digits(:digits)?' tail handled per rule below).
   Path-shaped predicate on the key: >=2 interior single '/' OR exactly 1
   interior '/' plus a dotted component ('.' present). Guards: interior '..'
   rejects the whole run (adjacent-symbol rule already rejects '//' and '..'?
   NO — classifyLiteral rejects adjacent symbols; classifyPath must apply the
   same single-interior-symbol scan since '..' contains adjacent symbols —
   reuse the same loop). Post-trim key length 4–96.
2. ':line:col' rule (pinned): after edge trim, strip ONE trailing
   /:\d+(?::\d+)?$/ tail; then the remainder must be path-shaped AND contain
   no ':' (host:port / time colons keep meaning). 'src/foo.ts:42:13' → key
   'src/foo.ts'. '4:36' / 'localhost:8080' → not path (no '/' count / colon
   remains / single slash no dot) → fall through to classifyLiteral.
   PIN: 'a/b.ts:42:13:99' → strip ':13:99' leaves 'a/b.ts:42' which still
   contains ':' → path classification fails → run falls back to the 4c
   literal classification (digit-bearing, single interior symbols → literal
   token). Document + test this behavior.
3. Ordering in the pass-4 loop: for each LITERAL_RE match, run classifyPath
   FIRST (a slash-bearing run qualifying both ways takes the path class —
   emit path:true, literal:false). Non-path → classifyLiteral as today.
4. RawToken divergence (first key≠display beyond casing): path tokens keep
   raw/start/end = the ORIGINAL match (m.index .. m.index+m[0].length) and
   carry trim metadata `trimFrom`/`trimTo` (relative to raw, bounding the
   key). mk() gains `path` + trim fields; spans arrays gain a class tag
   (literal|path) so sorting/absorption keep working (path spans contain '/',
   so equal-span ties with other classes are impossible — keep tie rule for
   symmetry/tests).
5. Rule-3 Unicode adjacency at TRIMMED bounds: isUniLetterBefore(text,
   m.index+trimFrom) || isUniLetter(text.codePointAt(m.index+trimTo)).
6. expandCandidates: `if (token.hexish || token.literal || token.path)` →
   for path: whole = { key: raw.slice(trimFrom, trimTo).toLowerCase(),
   display: raw, properName: false (paths are not names; keep false — spec
   silent; choose false and document), isSubword: false, path: true }.
   Also add `path?: boolean` to CandidateDraft (types.ts) so T2.S2's gate
   can select 4–96 caps.

## Tests to add (test/segment.test.ts, spec §09 h2.55 path bullet)
src/core/query.ts (2 slashes) → one token; /home/user/projects/hapax (key
trims '/', display keeps); docs/architecture.md (slash+dot); ../tools/
build.mjs (key 'tools/build.mjs', display '../tools/build.mjs');
example.com/a/b; :line:col trims; 4:36 + localhost:8080 untouched (4c);
'and/or' NOT a token (1 slash, no dot, digit-free → 4c rejects too);
interior '..' rejects whole; 96/97 key-length boundary (96 admits, 97 —
not reachable since window is 96+edges; test the key-cap check directly);
equal-span symmetry guard; absorbed 'query.ts' never surfaces alone inside
the path span (existing contained tokens like 'query' — wait, base tokens
inside a path span: the path absorber span covers them, so they're absorbed
via the union sweep — verify with 'use src/core/query.ts here').

## Perf note (risk)
Widening to 96 increases matches; classifyPath is O(len). perf-gates 800 KB
budget has little headroom (~174–187 ms baseline vs <60/<180 budgets).
History: two O(n²) regressions came from this pass — keep everything
single-pass linear (no .some() scans).

## Upstream contract (P1.M1.T1.S3, parallel)
calibrate-bands.mjs R_eff-aware verdicts — tools-only, no overlap with
segment.ts/types.ts. No conflict.
