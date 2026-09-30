# Research: BUG-004 — 64KB chunk-boundary token shredding

## Claim verification

**Claim 1 — VERIFIED.** `src/pi/ingest.ts:392` `processText`; the chunk loop is `for (let off = 0; off < text.length; off += this.#chunkBytes)` at `src/pi/ingest.ts:403`, slicing `text.slice(off, off + this.#chunkBytes)` (line ~404). `#chunkBytes` defaults to `65_536` (constructor, `src/pi/ingest.ts:307`, option `chunkBytes` documented "slice size in chars; default 65_536 (PRD §05 h2.30)"). Each slice is split on `"\n"` and every segment goes through `this.#admitSegment(segments[i]!, ordinal, fromUser)` (lines 413–426). `#admitSegment` (`src/pi/ingest.ts:465`) runs `const masked = maskSecrets(segment)` then `for (const token of tokenize(masked))` — **tokenize is slice-local; there is NO token stitching across slice edges.** The docstring at lines ~388–391 even admits it: *"A slice boundary can split one token — an accepted approximation (regex tokenize is safe on any slice)"* — accepted in code comment only, not in spec (drift, see below).

**Claim 2 — VERIFIED.** Run-assembly DOES stitch across chunk boundaries: `appendSegment` (`src/pi/ingest.ts:190`) returns the updated carry *"the newline-free masked text after the line's last admitted token (spans chunk boundaries)"*, and computes a boundary-spanning gap:
```ts
const gapBefore =
  j > 0 ? r.masked.slice(r.entries[j-1]!.end, e.start)
  : openLine.length > 0
    ? openTail + r.masked.slice(0, e.start) // gap spans the boundary
    : ""; // line's first entry: always opens a run
```
plus the comment at `appendSegment`: *"Segments with NO admitted tokens still extend the carry … dropping it would lose punctuation that must break the run — e.g. `zephyr,` | ` quuxblat` split across a chunk boundary"*. So stitching was designed for runs (openLine/openTail) but never for tokens. CONFIRMED intent mismatch.

**Claim 3 — VERIFIED by live repro.** Ran the exact input through a vitest one-off harness (`/tmp/004.test.ts`, node_modules of the repo, only /tmp written):
```
zorpwibble: undefined
ibble: PRESENT
quuxblat: PRESENT
runs: [["ibble","quuxblat"]]
succ (topSuccessors("zorpwibble")): []
```
Exactly as claimed: the real token `zorpwibble` is lost, junk `ibble` (the trailing half after the 65536-char cut inside "Zorpwibble") is admitted, the bigram run records `["ibble","quuxblat"]` instead of `["zorpwibble","quuxblat"]`, and `topSuccessors("zorpwibble")` is empty.

**Claim 4 — VERIFIED as correct design.** Carrying the trailing partial token into the next slice is the right fix and mirrors openLine/openTail. Detail in "Recommended fix design".

## Exact contracts

- `processText(text: string, fromUser: boolean): Promise<void>` — `src/pi/ingest.ts:392`. One `ordinal = this.#store.nextOrdinal()` per message (line ~397).
- Chunk loop `src/pi/ingest.ts:403`:
  ```ts
  for (let off = 0; off < text.length; off += this.#chunkBytes) {
    const slice = text.slice(off, off + this.#chunkBytes);
    const segments = slice.split("\n");
    ```
  Newline is the only structural break; segments `[0..n-2]` finalize a line (`runs.push(...splitRuns(openLine))` line ~418), the tail segment stays open via `openTail = appendSegment(...)` (lines 421–426). Final unterminated line flushed at line ~434.
- `#admitSegment(segment, ordinal, fromUser): SegmentResult` — `src/pi/ingest.ts:465`. Returns `{ masked, entries: {key,start,end}[] }`; spans are **UTF-16 offsets into the MASKED segment only** — there is NO absolute line:col tracking anywhere in the pipeline (maskSecrets is length-preserving so spans index raw text too). Offsets never leave the segment, so a carry prefix shifts nothing observable.
- `appendSegment(openLine, openTail, r): string` — `src/pi/ingest.ts:190`; returns new openTail = `r.masked.slice(r.entries[last].end)`.
- Tokenizer regexes (`src/core/segment.ts:75–101`):
  - `BASE_RE = /[A-Za-z][A-Za-z0-9_]{0,63}/g` (line 75)
  - `HEXISH_RE = /(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g` (78)
  - `FILENAME_RE = /\b[A-Za-z][A-Za-z0-9_]{0,30}(?:\.[A-Za-z0-9_]{1,16}){0,2}\.[A-Za-z]{1,5}\b/g` (83)
  - `HYPHEN_RE = /\b[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)+\b/g` (91)
  - `LITERAL_RE = /[A-Za-z0-9._@:+/~=-]{4,96}/g` (101)
- `maskSecrets` runs per-segment inside `#admitSegment` (line ~471): `const masked = maskSecrets(segment);` — masking is slice-local today and stays slice-local under carry (a secret straddling the seam is unmaskable today and remains so; see Risks).
- `tokenize(text): RawToken[]` — `src/core/segment.ts:322`; maximal-run semantics with unicode-letter disqualification (`isUniLetterBefore`/`isUniLetter` rules 3/R2, lines ~335–345).

## Boundary-char definition & carry rule (Task B)

A slice may legally end anywhere today. The set of characters that can appear INSIDE a token (union of the five regexes above) is exactly:
```
[A-Za-z0-9._@:+/~=-]
```
(BASE adds `_`; FILENAME adds `.`; HYPHEN adds `-`; LITERAL adds `._@:+/~=-`; HEXISH is a subset). `\n` is never a token char. Any char outside this class terminates any possible token.

**Carry rule (sufficient and necessary):**
- Detect "slice ends mid-token": the slice's LAST char matches the class AND the next slice's FIRST char also matches the class. (If either side is a non-token char, the token ended/was bounded — no carry needed. If the slice's last char is not in the class, no token can continue past it.)
- On carry: let `k` = length of the trailing maximal run of class-chars at the end of the slice. Move those `k` chars into a `carry` string; tokenize them only as a PREFIX of the next slice (`slice = carry + text.slice(off, off+chunkBytes)`).
- **No double admission:** the carried chars are removed from the current slice before `#admitSegment` (slice the segments loop over `slice.slice(0, slice.length - k)`), so tokenize never sees them in slice N and sees them exactly once in slice N+1. Memoization (`#admitMemo`) is per distinct raw token, immune.
- **No gap/run distortion:** `openTail` must be computed from the trimmed slice, so the carried token chars are not counted as gap text — then in slice N+1 the stitched token's `gapBefore` is `openTail + masked.slice(0, e.start)` = pure pre-token gap, and `zorpwibble quuxblat` chains correctly. (If the carry were left inside openTail, the non-whitespace token chars would WRONGLY break the run — this is the one subtle trap.)
- **No offset shifts to worry about:** spans are per-segment and consumed inside `appendSegment`; nothing downstream sees absolute offsets. There is no line:col attribution in the ingest path at all.
- **Carry size is naturally bounded:** every token regex caps match length (BASE 64, HEXISH 40, LITERAL 96, FILENAME ~74, HYPHEN unbounded-ish but each segment ≤64+63…, practically ≤ a few hundred chars for a maximal hyphen chain). Worst case a pathological >64KB single identifier: its trailing class-char run can exceed any bound. Cap the carry (e.g. `MAX_CARRY = 1024` chars); on overflow drop the excess (the token was already >96 chars and unmatchable by any regex anyway — BASE matches its first 64 in an earlier slice as today).
- **Last slice (no successor): do nothing.** Current single-slice behavior already admits a token at end-of-text without a trailing boundary char (BASE_RE/LITERAL_RE have no `$`-anchor or trailing `\b`; only FILENAME/HYPHEN use `\b`, which a following-space/EOF case satisfies the same way). Keep it: the trailing partial IS tokenized normally — that restores exactly the single-message semantics.
- **Newline interplay:** the carried run contains no `\n` (not a class char), so prepending before `slice.split("\n")` cannot merge lines. Carry only when `off + chunkBytes < text.length`.

## Recommended fix design (ordered steps)

All changes in `src/pi/ingest.ts`, function `processText` (line 392), plus one spec edit in `spec/05-ingestion-pipeline.md`:

1. Add a module-level const near `WHITESPACE_GAP_RE` (line ~154):
   ```ts
   /** Characters that can legally appear INSIDE a token (union of the
    *  five tokenize regexes in core/segment.ts). A slice boundary may
    *  only fall mid-token if the char before AND after it are in this
    *  class; otherwise the token cannot span. */
   const TOKEN_CHAR_RE = /[A-Za-z0-9._@:+/~=-]/;
   const MAX_CARRY = 1024;
   ```
   (Keep in sync with `LITERAL_SYMBOL_CHARS` in segment.ts if those regexes ever change — add a comment cross-referencing both.)
2. In `processText`, restructure the loop to hold `let carry = "";` before the `for (let off…)` loop (line 403). Inside:
   - `const raw = text.slice(off, off + this.#chunkBytes);`
   - Compute `k` = trailing class-run length of `raw`, only if `carry === ""` check next char: simpler formulation — compute the **junction**: if `raw` is non-final (`off + this.#chunkBytes < text.length`), let `k` = number of trailing TOKEN_CHAR chars in `raw` **capped at MAX_CARRY**; else `k = 0`. Set `carry = raw.slice(raw.length - k)`; `const slice = carry_in + raw.slice(0, raw.length - k)` where `carry_in` is the previous iteration's carry. (Order: prepend previous carry FIRST, then trim the new tail; the two runs cannot overlap because `carry_in` was itself trimmed at a class boundary — but trim only the `raw` part's tail, which is exactly the end of `slice`.)
   - Feed the (possibly empty) `slice` through the existing `slice.split("\n")` / `appendSegment` / `#admitSegment` machinery unchanged. An empty `slice` (whole raw slice carried) still yields once — keep the `await this.#yieldFn()` unconditionally to preserve yield-count tests.
   - Guard: `if (slice.length === 0 && off + this.#chunkBytes < text.length) { await this.#yieldFn(); continue; }` style handling only needed if MAX_CARRY ≥ chunkBytes, which it is not.
3. openTail correctness comes free: `#admitSegment` runs on the trimmed slice, so `appendSegment`'s returned openTail excludes carried chars. Verify with the new repro test that `runs` contains `["zorpwibble","quuxblat"]`.
4. Update the stale docstring at lines ~388–391: replace "A slice boundary can split one token — an accepted approximation" with the carry contract ("a slice boundary never splits a token; the trailing partial token is carried into the next slice and tokenized there once").
5. Spec edit (spec maintenance policy — must land together): in `spec/05-ingestion-pipeline.md` "Chunked processing" (lines 30–36), extend the ≤64KB clause with one sentence, e.g.: *"A slice boundary never splits a token: the trailing partial token (suffix of class characters `[A-Za-z0-9._@:+/~=-]`) is carried into the next slice and tokenized there exactly once, mirroring the open-line/open-tail run carry."* Keep "≤ 64 KB slices" true by stating slices are read at ≤64 KB with a bounded (≤1 KB) boundary carry prepended before processing (see Risks re: accounting).

## Tests

**Must keep passing (pin chunking behavior that is correct):**
- `test/ingest-pipeline.test.ts:197` "chunks multi-chunk text into slices with a yield awaited between each" (yield count = slice count; token-aligned slices — unaffected by carry since boundaries land in gaps).
- `:208` "issues exactly one store ordinal per multi-chunk message".
- `:336` drain-reuse test (chunkBytes 21, token-aligned).
- `:523` "a chunk boundary inside a whitespace gap still chains" — with carry this STILL passes (boundary in gap → no class chars at edge → no carry; openTail logic untouched).
- `:541` "a chunk boundary inside a punctuation gap still breaks" — comma is not a class char → no carry; passes.
- `:554` "a chunk boundary never breaks a run — only '\n' does" (chunkBytes 7 cuts INSIDE tokens "lwlock|…" wait: 7 chars = "lwlock " → boundary after space; no token split) — passes.
- `test/perf-gates.test.ts` (chunkBytes mention) — verify it uses token-aligned text; performance unchanged.

**Must add (no existing test pins shredding — nothing to change, the bug is untested):**
- New test in `test/ingest-pipeline.test.ts`: the exact repro — `chunkBytes: 65536` (or small analogue like `chunkBytes: 8` with `"aaaaZorpwibble quuxblat"`), assert `store.get("zorpwibble")` defined, `store.get("ibble")` undefined, run `[["zorpwibble","quuxblat"]]`, `topSuccessors("zorpwibble")` non-empty.
- Boundary at a class char followed by non-class char in next slice (no carry, no double count): e.g. `"lwlock!" sliced at 6` → `!` not class char → no carry.
- Token split with the junction inside a HYPHEN/FILENAME token ("foo-bar-meat".split mid-hyphen-word) — stitched to one token.
- Final slice ending mid-token (no successor): `"aaa zorpwibble"` at `chunkBytes: 4` → `zorpwibble` admitted (restores single-slice semantics).
- `test/adversarial-ingest.test.ts`: no chunk-boundary cases today (only case-boundary sub-words and session-boundary fakes — greps confirm no chunkBytes usage); optionally add a secret straddling a seam case to pin the documented limitation.

## Spec citations & drift

- `spec/05-ingestion-pipeline.md:30–34` — "## Chunked processing … Process in ≤ 64 KB slices; `await` a microtask/yield between slices … so the event loop breathes. A pathological multi-MB message must never block a keystroke." Nothing here authorizes splitting tokens; it's silent on boundaries' content.
- `spec/04-tokenization-and-scoring.md` — maximal-run tokenization: line ~77 "maximal run of `[A-Za-z0-9]` joined by SINGLE INTERIOR symbols", line ~120 "A maximal literal-charset run that is PATH-SHAPED is ONE token". **Drift:** `processText`'s docstring ("accepted approximation") plus the observed behavior violate spec/04's maximal-run semantics for any token straddling a 64KB edge; spec/05 does not override spec/04. The fix RESTORES spec-mandated semantics; it does not change them. The only new spec text needed is the carry sentence in spec/05 (step 5) so code and spec stay in agreement per AGENTS.md.
- `spec/02-architecture.md:160` — "Ingest chunk yield granularity | ≤ 64 KB text per event-loop turn" — still true under the fix (carry ≤1 KB is text moved BETWEEN turns, not extra text per turn; if strict, subtract carry length from the next slice read size — optional tightening).

## Risks & edge cases

1. **Token longer than 64KB (single identifier >65536 class chars):** carry would grow unbounded. Mitigate with `MAX_CARRY` (1024); excess is dropped — but note such a run matches no tokenize regex in full anyway (max ~96 chars); only its first ~64 chars ever became a BASE token even pre-fix. Behavior degrades to today's, no crash.
2. **Entire chunk one identifier:** raw slice fully class chars → carry = min(64KB, MAX_CARRY) = 1024, next processed slice nearly empty; loop still advances `off` by `chunkBytes` per iteration so no infinite loop. Ensure the code never carries chars twice (carry is prepended only to the immediately-following slice).
3. **Unicode/surrogate pairs at the boundary:** token class is ASCII-only; a lone high surrogate at the slice edge is not a class char → no carry, no splitting of a surrogate pair by the carry logic itself. The 64KB cut can still split a surrogate pair (existing, orthogonal — `text.slice` may cut mid-pair; regexes just won't match; same before/after).
4. **Unicode-letter disqualification (rule 3/R2) across the seam:** if `草zorpwibble` straddles the boundary with the seam inside the identifier, the stitched token in slice N+1 sees start-of-segment where `isUniLetterBefore` returns false, so a token the whole-text tokenizer would disqualify could be admitted. Rare (requires a \p{L} char immediately adjacent to a 64KB-aligned position inside a class run). Optional hardening: also carry ONE preceding char when it is `\p{L}` (it is not a class char so it cannot join a token; spans shift by 1 harmlessly) — or document as accepted. Recommend documenting first, hardening only if word-review flags it.
5. **Double-count of counts:** prevented by construction (chars are removed from slice N's input). Watch `wordsSeen`/`admitted` stats — with the fix, the boundary junk token ("ibble") disappears, which slightly CHANGES stats for multi-chunk messages (correctly: fewer bogus wordsSeen). No existing stat test covers a mid-token boundary, so nothing breaks.
6. **Secret masking across seams:** `maskSecrets` runs per-segment (`src/pi/ingest.ts:471`), so a structured secret whose pattern straddles a chunk seam is not masked by layer 1 either before or after this fix (layer 2 `isSecretShaped` may still catch halves). The carry does not make this worse — the carried prefix alone was already tokenizable garbage pre-fix. Optional follow-up only.
7. **Restore replay performance:** `restoreFromHistory` calls `processText` per message (`src/pi/ingest.ts`, restore loop ~"await pipeline.processText(text, …)"); the fix adds O(carry-length) work per slice — ≤1KB per 64KB slice, negligible vs the admit-memo economics. Yield counts per message unchanged (perf-gates unaffected).
8. **Yield-count tests:** the `await this.#yieldFn()` must fire once per slice iteration regardless of carry (even when the processed slice is empty), or test at `:197` (15 yields) and perf tests shift. Design keeps `off` stepping by `chunkBytes`, so counts are identical.
