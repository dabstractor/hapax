# Research: BUG-002 — tokenize() emits OVERLAPPING tokens when a technical literal's trailing '_' trim straddles a base token

Repo: /home/dustin/projects/hapax (read-only research). Harness: vitest one-off at /tmp/bug002.test.ts run via
`node /tmp/run-bug002.mjs` (vitest programmatic API, root=/tmp, output to /tmp/bug002-out.txt). No repo files touched.

## Claim verification

### Claim 1 — invariant documented and violated. VERIFIED
- Invariant doc: `src/core/segment.ts:314-316` — "Returns one token per disjoint match span, ascending by position" / "**Never emits overlapping tokens**; never lowercases."
- Base pass: `src/core/segment.ts:75` — `const BASE_RE = /[A-Za-z][A-Za-z0-9_]{0,63}/g;` — '_' is a word char, so a base match can run through and past the literal's post-trim end.
- Pass-4 literal classification + trailing-symbol trim: `src/core/segment.ts:184-188` — `classifyLiteral`:
  `while (to > from && LITERAL_SYMBOL_CHARS.has(raw.charAt(to - 1))) to--;` with
  `LITERAL_SYMBOL_CHARS = new Set("._@:+/~=-")` (segment.ts:109). '_' is a symbol char for the literal pass
  but a word char for the base pass — the sole character in both charclasses' intersection, hence the only
  character whose trim can straddle a base token.
- Post-trim span computed at `src/core/segment.ts:560-563` (`start = m.index + lit.from; end = m.index + lit.to`).
- Strict-containment absorber (final merge): `src/core/segment.ts:655` —
  `if (fn !== undefined && fn.start <= tok.start && tok.end <= fn.end)` → emit absorber, skip token.
  A base token ending PAST `fn.end` fails this check.
- Overlap-safety branch: `src/core/segment.ts:658-661` —
  `if (fn !== undefined && fn.start < tok.end) { emitFn(f); // overlap safety (\b boundaries make this unreachable)` —
  emits the literal AND falls through to `kept.push(tok)` (line 662), so the straddling base token is kept too.
  The comment's assumption ("\b boundaries make this unreachable") is FALSE for rule-4c literals whose trailing
  '_' was trimmed (no \b involved — LITERAL_RE has no \b; the hexish pass's \b comment at segment.ts:390-392 is
  what the safety comment was mirroring).
- Equal-span defer (pass 4): `src/core/segment.ts:569-570` — `if (o !== undefined && o.start === start && o.end === end) { continue; // equal-span token wins — pass is additive-only }` — only EXACT equality defers; strict containment by the base token does not.

### Claim 2 — repro. VERIFIED (real run, /tmp/bug002-out.txt)
- `tokenize('FOO_1_')` → `[["FOO_1",0,5,literal:true],["FOO_1_",0,6,base:false]]` — two tokens, spans [0,5) ⊂ [0,6). Overlapping.
- `tokenize('X=1ZZ ZZ_')` → `[["X=1ZZ",0,5,true],["ZZ_",6,9,false]]` (second word: literal 'ZZ' trimmed to length 2 < LITERAL_MIN_LENGTH 4 → literal rejected, base 'ZZ_' kept; the first word shows the '@'/ '=' joins working).
- `tokenize('cY1Z cY1Z_')` → `[["cY1Z",0,4,false],["cY1Z",5,9,true],["cY1Z_",5,10,false]]` — literal [5,9) and straddling base [5,10) both emitted.
- `tokenize('call API_V2_KEY_ now')` → `[["call",0,4],["API_V2_KEY",5,15,true],["API_V2_KEY_",5,16,false],["now",17,20]]` (mine).
- IngestPipeline.processText('rename FOO_1_ and USER_2_TOKEN_ constants') then rankMatches:
  - `rankMatches(store,'foo_')` → `["foo_1","foo_1_"]` — BOTH keys in the store, both offered as menu candidates.
  - `rankMatches(store,'user_2')` → `["user_2_token","user_2_token_"]`.
- Plural pruning non-coverage: `src/core/query.ts:553-565` — "EXACT single-"s" pairs only … `ss`-final keys never
  prune … `es`/`ies` plurals are different keys entirely". `foo_1_` is `foo_1` + '_', not + 's' → never pruned.

### Claim 3 — fix directions. VERIFIED as stated; union-filter precedent quote below.
- Union filter (compound-vs-literal containment): `src/core/segment.ts:604-624` — spans sorted
  `start asc, then end desc (longer first), then compound before literal before path on exact ties`, then
  `if (s.end <= maxEnd) continue; // contained in a kept span` (line 623). I.e. within the compound/literal/path
  family, a SHORTER span covered by a kept LONGER span is dropped — "never overlapping spans" is made
  "a structural invariant instead of a proof obligation" (segment.ts:608-610).

## Exact contracts

- `BASE_RE = /[A-Za-z][A-Za-z0-9_]{0,63}/g` — segment.ts:75.
- `LITERAL_RE = /[A-Za-z0-9._@:+/~=-]{4,96}/g` — segment.ts:101.
- `LITERAL_SYMBOL_CHARS = new Set("._@:+/~=-")` — segment.ts:109.
- `LITERAL_MIN_LENGTH = 4` — segment.ts:116.
- `classifyLiteral(raw: string): { from: number; to: number } | null` — segment.ts:184-188 (edge trims), returns
  null on length/digit/adjacent-symbol failures.
- `tokenize(text: string): RawToken[]` — segment.ts:318; invariant doc 314-317.
- Pass-4 literal loop: segment.ts:517-575; equal-span defer at 569-570.
- Final merge absorber check: segment.ts:655-662 (strict containment, then overlap-safety branch).
- Union filter: segment.ts:604-632.
- `IngestPipeline.processText(text, fromUser): Promise<void>` — src/pi/ingest.ts:392; constructor takes
  `{ store, dictionary, ... }` (ingest.ts:303).
- `rankMatches(store: CandidateStore, prefix: string, opts?): RankedMatch[]` — src/core/query.ts:424;
  plural pruning at query.ts:566+.

## Recommended fix design

Recommend **fix (b)** — defer to the base token when it strictly CONTAINS the trimmed literal span (mirror of
the existing equal-span defer). Reasons (see C below): consistent with "strictly additive" philosophy and the
equal-span defer; the base token is the identifier the user actually typed ('FOO_1_' — trailing '_' is part of
the identifier per rule 1, '_' is a word char); fix (a) would absorb a NON-strictly-contained token, directly
contradicting spec/04:104-105 ("literals absorb only strictly-contained tokens") and would complete 'FOO_1'
by deleting a typed character.

Steps:
1. `src/core/segment.ts`, pass-4 literal loop (~line 569): replace the equal-span check
   `if (o !== undefined && o.start === start && o.end === end)` with
   `if (o !== undefined && o.start <= start && end <= o.end)` (equality is the subset case) and update the
   comment: a kept base/hexish token that CONTAINS the trimmed literal span (equal or larger) wins — the
   trailing-'_' trim case ('FOO_1_' keeps its base token; no literal is emitted). Note `o` is the first
   not-yet-passed `out` token ending after `start` (cursor advanced at line 568), so `o.start <= start`
   identifies the only candidate container (base spans are disjoint; only a base STARTING at/before the
   literal start can overlap, and only '_' can carry it past `end`).
2. Update the "overlap safety" comment at segment.ts:660 — it stays as a defensive branch but note the
   reachability caveat is now moot for this class (or leave code untouched; the branch becomes dead for
   trailing-'_' literals but is still the correct guard).
3. Spec edit (binding per AGENTS.md): spec/04-tokenization-and-scoring.md, "Strictly additive" bullet
   (lines 101-106) — extend to: a literal whose post-trim span is equal to OR CONTAINED IN a kept
   base/hexish/compound token defers to that token (add example: `FOO_1_` stays the base token `FOO_1_`,
   no `FOO_1` literal forks). Code and spec land together.
4. Add regression tests (test/segment.test.ts, "technical literals (2026-10 rule 4c)" describe block ~line 615):
   `expect(raws("FOO_1_")).toEqual(["FOO_1_"])` (single token, base class); add "rename FOO_1_ ok" to the
   disjoint-spans test's `cases` array (test/segment.test.ts:293-305) so the invariant test would have caught
   this shape; add an ingest/query-level assertion that 'foo_1' and 'foo_1_' never both surface
   (test/ingest.test.ts or test/query.test.ts pattern).

Condition to change, exactly: segment.ts:569 `o.start === start && o.end === end` → `o.start <= start && end <= o.end`.

## Tests: must-change vs must-keep-passing

- Must CHANGE (currently absent, i.e. pin nothing but must be ADDED): no existing test exercises a
  digit-bearing base identifier with a trailing '_'; the disjoint-span invariant test
  (test/segment.test.ts:292-313, "spans are valid slice bounds, disjoint and ascending across mixed inputs")
  passes today only because no case in its list has this shape — add 'FOO_1_'-class inputs there and new
  assertions in the rule-4c describe (615+). No existing assertion becomes false under fix (b): grep found no
  test expecting both 'FOO_1' and 'FOO_1_' or a trailing-'_' literal.
- Must KEEP PASSING (adjacent invariants, unaffected by (b)):
  - "the motivating case: '2560x1440@2' … parts absorbed" (segment.test.ts:617-631) — bases 'x1440' etc. are
    strictly contained in the literal, still absorbed (fix (b) only fires when the BASE is the container).
  - "literals are OPAQUE … equal-span tokens keep their class" (segment.test.ts:679-690) — 'utf8Reader'
    equal-span defer unchanged; '2ndReader' digit-initial literal has no containing base token (base 'ndReader'
    starts inside), unchanged.
  - hexish absorb tests (segment.test.ts:96-100, 128-150), CJK literal guard (692-703), path tests (805-821),
    union-filter behavior via filename tests (49-70).
- Ingest/query duplicates: no existing test observes the duplicate pair; add one (processText → rankMatches
  uniqueness on 'foo_' prefix).

## Spec citations & drift

- spec/04:19-23 (rules 1+2 regexes) and spec/04:30 (rule 1: base tokens `[A-Za-z][A-Za-z0-9_]*`) — '_'
  is a word char for base tokens.
- spec/04:74-100 (rule 4c): "A maximal run … qualifies as **ONE literal token** when, after trimming
  leading/trailing symbols, it is 4–64 chars …" (74-80); "Single interior symbols, edges trimmed … trailing
  sentence periods never glue (`fox.` stays `fox`)" (95-98).
- spec/04:101-106 ("Strictly additive"): "A literal with EXACTLY the span of a kept base/hexish/compound token
  defers to that token (`utf8Reader` keeps camelCase subword splitting …); **literals absorb only
  strictly-contained tokens** (`2560x1440@2` absorbs its `x1440` tail)."
- Drift assessment: the spec does NOT mandate emitting both tokens; "ONE literal token" (74-76) plus the code's
  own "Never emits overlapping tokens" invariant (segment.ts:316) make the current output a bug. However, the
  spec's "EXACTLY the span" defer wording does not cover the straddling case — a one-line spec amendment
  (containment defer, mirroring the code fix) closes the gap. Fix (b) RESTORES spec-mandated single-token
  behavior plus needs the small clarifying edit; fix (a) would CONTRADICT "absorb only strictly-contained
  tokens" outright and need a bigger rewrite.

## C. Fix (a) vs (b) — comparison

- Union-filter precedent (segment.ts:604-624): within compound/literal/path spans, sort longer-first and drop
  any covered span. That precedent resolves SAME-START ties toward the LONGER span — which for 'FOO_1_'
  vs 'FOO_1' is the base token ('FOO_1_'), aligning with (b). But the union filter never sees base tokens;
  the base-vs-literal relationship is governed by the pass-4 defer philosophy: the literal pass is
  "STRICTLY ADDITIVE" (segment.ts:493-501) — "The literal class exists for what the other passes CANNOT see:
  digit-initial runs and symbol-joined codes." 'FOO_1_' IS fully seen by the base pass.
- Divergent inputs: every trailing-'_' digit-bearing identifier ('FOO_1_', 'API_V2_KEY_', 'a1_b2_').
  (a) → menu offers 'FOO_1' (completing DELETES the typed trailing '_'); (b) → menu offers 'FOO_1_' as typed.
  No input was found where they agree on the span but differ on class except via the trim itself.
- Recommendation: **(b)**, exact condition in the fix design above.

## D. Downstream impact (confirmed)

- Admission banding: both tokens go through the shape gate independently — 'FOO_1' (5 chars) and 'FOO_1_'
  (7 chars) are both letter-bearing ≥4 keys, same min-length band (MIN_LENGTH; path-only bands at
  src/core/shapeGate.ts:185-190), letter-bearing so the literal entropy-floor exemption (shapeGate.ts:202)
  doesn't differentiate them — both admitted (empirically: both returned by rankMatches).
- Store upsert: two DISTINCT lowercase keys (`foo_1`, `foo_1_`) upserted into CandidateStore's map —
  confirmed by rankMatches returning both (query prefix scan hits both).
- rankMatches duplicates: both keys are separate RankedMatch entries in ONE result set — two menu rows for
  one typed identifier (confirmed: `["foo_1","foo_1_"]`).
- Plural pruning: query.ts:553-565 handles only exact key vs key+'s'; '_'-suffix pairs untouched. Confirmed.

## G. Risks & edge cases

- Can fix (b) LOSE a legitimately distinct identifier/literal? No distinct key is lost: when a base strictly
  contains a trimmed literal, the literal is a PREFIX of the base plus possibly more '_' word chars — the
  information the literal carried (digit-bearing code shape) is fully present in the base token, which is
  admitted on its own merits. Counterexample attempt: 'A_1_2' — no trailing trim (last char digit), equal
  spans → existing defer, unchanged. 'ZZ_' → trimmed literal 'ZZ' < 4 already rejected today; base kept —
  unchanged. '2026-09-15_' → base '2026' etc. are digit-led (BASE_RE needs letter first), so no containing
  base exists; literal '2026-09-15' still emitted — unchanged. The ONLY behavioral change is the bug class:
  letter-initial digit-bearing identifiers ending in '_'.
- Fix (a) risk (for contrast): menu inserts 'FOO_1', silently deleting the user's trailing '_' — a typing
  hijack adjacent to the "never hijack typing" invariant spirit, plus spec contradiction.
- Edge: 64-cap bases — a base capped at 64 chars inside a ≤96 literal: base is contained in literal,
  existing absorber handles it (segment.test.ts:144-148); fix (b) does not touch that direction.
- Edge: `sentenceStart` computation is per token start; both tokens share start 0 — under (b) the survivor
  keeps its flag correctly.
- Perf: fix (b) tightens an existing O(1) cursor check; no new scan.
