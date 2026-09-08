# PRP — P1.M1.T2.S2 (plan 002): query.ts words-only rankMatches; drop suppress seam; one-word invariant test

---

## Goal

**Feature Goal**: Finish the R1 simplification of `src/core/query.ts`:
`rankMatches` returns **single words only** (PRD §04 h2.26 + §07 h2.44
one-word invariant), the phrase layer is fully deleted (P1.M1.T2.S1 removed
the phrase symbols; this task owns the query-side redesign), and the
`RankOptions.suppress` seam is removed entirely (no production caller —
verified: `provider.ts:325` calls `rankMatches(store, fragment,
{ limit })` only). Rewrite `test/query.test.ts` accordingly and add the
**one-word invariant test** — a real-ingest-fed store whose every returned
`RankedMatch.display` contains no space — exposed as a reusable helper for
the chain tests (P1.M2.T1.S2).

**Deliverable**:
- `src/core/query.ts`: words-only `rankMatches(store, prefix, {limit})`,
  `RankOptions` = `{ limit?: number }` only, `DEFAULT_LIMIT` and
  `compareRankedMatches` kept, module docs rewritten.
- `test/helpers/query-invariants.ts`: exported `assertWordsOnly(matches, label?)`.
- `test/query.test.ts`: rewritten (phrase/suppress suites deleted, invariant
  test added).

**Success Definition**: `npm run check` + `npm test` green;
`grep -rn "suppress" src/core/query.ts test/query.test.ts` empty (note:
`src/pi/provider.ts` contains an UNRELATED display-debounce "suppression"
concept — do not touch it); every `rankMatches` result item's display is a
single word, proven through the real ingest path.

## Why

- PRD 002 (delta R1): the one-word invariant — "no multi-word candidates,
  ever; the only phrase behavior is successor chaining." Constituent
  suppression and the phrase salience machinery were the removed design;
  the `suppress` seam existed only to support them and has no production
  caller — leaving it invites future misuse that could violate the invariant.
- P1.M1.T2.S1 deletes the phrase store symbols, which forces the phrase
  blocks out of query.ts for compilation — but only minimally. This task
  owns the real redesign: seam removal, doc rewrite, and the test that PINS
  the invariant so the chain machine (P1.M2.T1.S1) and forced-Tab work
  (P1.M2.T2.S1) build on a words-only ranker with a regression gate.
- The provider normal path and trigger/threshold flows are unchanged —
  they already pass only `{ limit }`.

## What

### src/core/query.ts (final shape)

- Module header: rewrite to PRD §04 h2.26 + §07 h2.44 — synchronous
  words-only ranking, one-word invariant, salience imported from score.ts,
  prefixRange-then-snapshot ordering invariant (KEEP that paragraph —
  eviction/dirty reasoning is still valid), R1 note that the suppress seam
  was removed with the phrase layer.
- DELETE: `RankOptions.suppress` field (+ its doc), the `Candidate` type
  import if now unused (salience takes Candidates internally — the loop
  uses `store.get()` results typed via inference; keep the import only if
  still referenced), any leftover phrase prose.
- KEEP verbatim: `DEFAULT_LIMIT = 8`, `compareRankedMatches`,
  the rankMatches word path (prefixRange → sortedKeysSnapshot slice → get →
  salience → map to RankedMatch with `description: \`session x${count}\`` →
  sort via compareRankedMatches → `limit` slice).
- `rankMatches` body reduces to: limit guard, `prefix.toLowerCase()`,
  prefixRange, snapshot slice, get-loop (no suppress check), map, sort, cap.
- Confirm P1.M1.T2.S1 already removed: phrase gathering block, constituent
  suppression block (incl. BUG-005 successor-bearing exemption), phrase
  RankedMatch push (`description: "phrase"` literal), `phraseSalience`,
  `firstWord`, `phraseSuppresses`, `PHRASE_MULTIPLIER`, `PHRASE_REPETITION_W`,
  `PhraseEntry` import. If any remain, delete them here (S1 was authorized
  to do only minimal compile-preserving deletions; you own the rest).

### Success Criteria

- [ ] `rankMatches(store, prefix)` / `rankMatches(store, prefix, { limit })` compile; `RankOptions` has ONLY `limit?: number`
- [ ] `grep -n "suppress" src/core/query.ts` → empty; `grep -n "phrase" src/core/query.ts` → empty (case-insensitive)
- [ ] One-word invariant test passes through the REAL ingest path
- [ ] `assertWordsOnly` helper exported and reusable (no test-file-only coupling)
- [ ] `npm run check` + `npm test` green; provider/trigger flows unaffected
- [ ] No changes to `src/pi/provider.ts`, `src/core/store.ts`, `src/core/score.ts`, `src/core/segment.ts`

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed?" — Yes: the exact current query.ts structure (line-anchored), the
surviving-word-path algorithm reproduced below, the test-file describe
inventory (keep/delete per block), the ingest-fixture pattern for the
invariant test, and the verified no-caller fact for `suppress` are all
specified.

### Documentation & References

```yaml
- docfile: plan/002_3e8a42cadf2c/architecture/core_phrase_layer_map.md
  section: "## query.ts (src/core/query.ts, 273 lines)" (~L70–117)
  why: THE map — deletion inventory (phraseSalience 115–131, firstWord
        100–104, phraseSuppresses 136–140, PHRASE_MULTIPLIER 86,
        PHRASE_REPETITION_W 93, phrase gathering 218–233, suppression
        236–253 incl. BUG-005 exemption, phrase push 255–262) and the keep
        list (rankMatches, RankOptions+suppress, DEFAULT_LIMIT,
        compareRankedMatches). suppress: "no production caller (tests only)".
  gotcha: line numbers are from PRE-S1 source; S1 (in flight) already did
        minimal deletions — READ the live file first and reconcile.

- file: plan/002_3e8a42cadf2c/P1M1T2S1/PRP.md
  why: CONTRACT for the store this consumes: phrase accessors GONE
        (phraseCandidateKeys, getPhrase, PhraseEntry, topSuccessors stays,
        recordBigramRuns added). TypeScript enforces your deletions.
  gotcha: S1 may have already pruned some query.test.ts phrase cases to keep
        the suite green — your rewrite is the full, authoritative version.

- file: src/pi/provider.ts (L325)
  why: VERIFIED the only production rankMatches call:
        rankMatches(store, state.fragment, { limit: config.maxSuggestions })
        — no suppress. No provider change needed for seam removal.
  critical: provider.ts contains many "suppression" comments — that is the
        display-debounce stale-prefix machine (BUG-002 fix), an UNRELATED
        concept sharing the word. Do NOT touch provider.ts.

- file: test/query.test.ts
  why: the suite to rewrite. Current describes:
        L67 empty results (KEEP), L88 case-insensitive/display casing (KEEP),
        L117 result shape "session x<count>" (KEEP), L149 ordering (KEEP),
        L220 limits/top-8 (KEEP), L267 suppress hook (DELETE),
        L313 ordinal interplay/recency (KEEP), L337 perf sanity (KEEP),
        L393 phrase helpers — 6 cases (DELETE),
        L438 phrase salience + constituent suppression — 11 cases (DELETE,
        incl. L494 BUG-005 exemption and L689 suppress-interplay).
        Imports to drop: PHRASE_CAP, firstWord, phraseSalience,
        phraseSuppresses, PHRASE_MULTIPLIER, PHRASE_REPETITION_W, PhraseEntry.
        KEEP the compareCandidates brute-force-oracle cross-check pattern.

- file: test/acceptance.test.ts (L69, L80 ingestFixture)
  why: the real-ingest pattern for the invariant test:
        dictionary via loadDictionary(resolveDictPath()) (or synthetic),
        `new IngestPipeline({ store, dictionary })`, replay message texts
        via `pipeline.processText(text, fromUser)`.

- file: test/helpers/dict-writer.ts
  why: buildDictBinary(entries) — build a SYNTHETIC dictionary so the
        invariant test's words admit at known groups; do NOT depend on the
        shipped dict's calibration (that is a different gate's concern).

- file: src/core/query.ts current module doc + word path
  why: the surviving algorithm (reproduced in Blueprint below) and the
        prefixRange-then-snapshot ordering-invariant paragraph to PRESERVE
        in the rewritten docs.

- PRD §04 h2.26 (ranking order: salience desc → shorter → byte-lex, top 8)
  and §07 h2.44 (menu item shape: value/label = exactly one word)
  why: the contract this module now implements alone.
```

### Current Codebase tree (relevant)

```bash
src/core/query.ts        # THIS TASK's main file
src/core/store.ts        # S1 contract: bigram store (in flight)
src/pi/provider.ts       # caller — DO NOT TOUCH
test/query.test.ts       # rewrite
test/helpers/            # dict-writer.ts exists; add query-invariants.ts
```

### Desired Codebase tree

```bash
src/core/query.ts                  # words-only rankMatches, no suppress seam
test/helpers/query-invariants.ts   # NEW — assertWordsOnly helper
test/query.test.ts                 # rewritten + invariant test
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// NodeNext ESM: relative imports use .js extensions.

// CRITICAL: provider.ts's "suppression" = display-debounce stale-prefix
// machinery — different concept, same word. Your cleanliness grep must
// scope to src/core/query.ts and test/query.test.ts, NOT the whole repo.

// GOTCHA: rankMatches lowercases the prefix BEFORE prefixRange (store
// throws RangeError on uppercase) — preserve.

// GOTCHA: keep the prefixRange-BEFORE-snapshot ordering invariant and its
// doc comment — eviction may dirty the index between keystrokes; only a
// snapshot taken after prefixRange agrees with get().

// GOTCHA: the invariant test must feed the store via the REAL ingest path
// (IngestPipeline.processText), not store.upsert — the point is that no
// pipeline stage can produce a multi-word display. Use a synthetic dict
// (buildDictBinary) with the test words at low quants so they admit.

// GOTCHA: S1 runs in parallel and touches query.ts minimally — rebase/
// re-read the live file before editing; expect some deletions already done.
```

## Implementation Blueprint

### Surviving rankMatches (target shape)

```ts
export interface RankOptions {
  /** Max results; default 8. limit ≤ 0 → [] (defensive). */
  limit?: number;
}

export function rankMatches(
  store: CandidateStore,
  prefix: string,
  opts: RankOptions = {},
): RankedMatch[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  if (limit <= 0) return [];
  const lower = prefix.toLowerCase();           // BEFORE prefixRange
  const [start, end] = store.prefixRange(lower); // rebuilds dirty index FIRST
  const keys = store.sortedKeysSnapshot().slice(start, end);
  const ordinal = store.currentOrdinal();
  const out: RankedMatch[] = [];
  for (const k of keys) {
    const c = store.get(k);                      // undefined if evicted — skip
    if (!c) continue;
    out.push({
      key: c.key,
      display: c.display,                        // one word, stored casing
      description: `session x${c.sessionCount}`,
      salience: salience(c, ordinal),
    });
  }
  out.sort(compareRankedMatches);                // salience↓ → shorter → byte-lex
  return out.slice(0, limit);
}
```

(`compareRankedMatches` and `DEFAULT_LIMIT` keep their current bodies/docs.)

### Implementation Tasks (ordered)

```yaml
Task 0: RECONCILE
  - Read live src/core/query.ts + test/query.test.ts after S1's landing
    (minimal deletions). Determine which Blueprint deletions remain.

Task 1: EDIT src/core/query.ts
  - Remove RankOptions.suppress (+doc); drop `Candidate` import if unused.
  - Remove any residual phrase symbols/prose S1 left.
  - Rewrite module header: words-only ranking per PRD §04 h2.26 + §07 h2.44
    one-word invariant; PRESERVE the prefixRange/snapshot ordering-invariant
    paragraph; note R1 (seam removed with the phrase layer; successor
    chaining in the provider, P1.M2.T1.S1, is the only M2 query behavior).
  - Reduce rankMatches to the target shape above.

Task 2: CREATE test/helpers/query-invariants.ts
  - EXPORT assertWordsOnly(matches: ReadonlyArray<RankedMatch>, label = ""): void
    — vitest expect: for every m, `!m.display.includes(" ")` with a message
    including label + the offending display. (Import type RankedMatch from
    ../src/core/types.js; import expect from "vitest" — helpers are
    type-checked and vitest is a devDependency, fine.)
  - Header comment: PRD §07 h2.44 invariant; consumed by query.test.ts and
    P1.M2.T1.S2 chain tests.

Task 3: REWRITE test/query.test.ts
  - DELETE describes: "suppress hook" (L267+), "phrase helpers — baked
    weights and key math" (L393+), "phrase salience + constituent
    suppression" (L438+, incl. BUG-005 exemption + suppress-interplay cases).
  - DELETE imports: PHRASE_CAP, firstWord, phraseSalience, phraseSuppresses,
    PHRASE_MULTIPLIER, PHRASE_REPETITION_W, PhraseEntry.
  - KEEP (adjusting only if S1's pruning already touched them): empty
    results, case-insensitive/display casing, result shape, ordering
    (compareCandidates oracle), limits/top-8 (assert DEFAULT_LIMIT === 8),
    ordinal interplay, perf sanity.
  - UPDATE header comment: drop "the M2 suppression seam" mention; add the
    one-word invariant.
  - ADD describe "one-word invariant (PRD §07 h2.44, R1)":
      * Build a synthetic dictionary via buildDictBinary with the test's
        content words at low quants (e.g. 10 → group 1) so they admit;
        write to a temp file (mkdtempSync; rmSync afterEach — pattern from
        test/dictionary.test.ts).
      * new IngestPipeline({ store: new CandidateStore(), dictionary }) and
        processText over chainable prose, e.g.:
          "Please check the lwlock guard before the zendesk ticket closes."
          "The lwlock guard failed again; file a zendesk ticket."
        (repeated bigrams so the (future) successor index has material —
        harmless now since chaining is provider-side).
      * For prefixes ["", "l", "lw", "z", "t", "g"]: const matches =
        rankMatches(store, p); expect(matches.length).toBeGreaterThan(0)
        for at least the populated prefixes; assertWordsOnly(matches, p).
      * Assert descriptions still match /^session x\d+$/.

Task 4: VALIDATE (loop below), incl. scoped cleanliness greps.
```

### Implementation Patterns & Key Details

```ts
// Reusable invariant helper (test/helpers/query-invariants.ts):
import { expect } from "vitest";
import type { RankedMatch } from "../src/core/types.js";
export function assertWordsOnly(
  matches: ReadonlyArray<RankedMatch>,
  label = "",
): void {
  for (const m of matches) {
    expect(
      m.display,
      `${label ? label + ": " : ""}multi-word display violates the one-word invariant (PRD §07 h2.44)`,
    ).not.toContain(" ");
  }
}

// Real-ingest fixture sketch (invariant test):
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hapax-q-"));
const dictPath = writeDictFile(path.join(dir, "d.bin"),
  [["lwlock",10],["zendesk",10],["guard",20],["ticket",20],["check",30]]);
const dict = loadDictionary(dictPath);
const store = new CandidateStore();
const pipeline = new IngestPipeline({ store, dictionary: dict });
await pipeline.processText("Please check the lwlock guard before the zendesk ticket closes.", false);
await pipeline.processText("The lwlock guard failed; file a zendesk ticket.", true);
// (match the actual IngestPipeline constructor/processText signature at
//  implementation time — see src/pi/ingest.ts L147/L267.)
```

### Integration Points

```yaml
CONSUMES:
  - src/core/store.ts (S1 contract): prefixRange, sortedKeysSnapshot, get,
    currentOrdinal — unchanged word layer.
  - src/core/score.ts: salience (import, never reimplement).

CALLER (unchanged):
  - src/pi/provider.ts L325 rankMatches(store, fragment, {limit}) — trigger
    and normal flows identical; P1.M2.T2.S1's forced branch consumes the
    same words-only results.

DOWNSTREAM:
  - P1.M2.T1.S2 chain.test.ts imports assertWordsOnly from
    test/helpers/query-invariants.ts.

FROZEN:
  - src/pi/provider.ts, src/core/{store,score,segment}.ts,
    src/pi/{ingest,debug}.ts (T2.S1/T2.S3/T3.* own them)
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check
```

### Level 2: Unit Tests

```bash
npx vitest --run test/query.test.ts
npm test        # full suite green
```

### Level 3: Cleanliness gates (SCOPED — see gotcha)

```bash
grep -in "suppress\|phrase" src/core/query.ts          # expect: empty
grep -in "suppress\|phraseSalience\|firstWord\|PHRASE_" test/query.test.ts  # expect: empty
# provider.ts's unrelated "suppression" comments are OUT OF SCOPE — do not grep repo-wide.
grep -n "assertWordsOnly" test/helpers/query-invariants.ts test/query.test.ts  # helper wired in
```

### Level 4: Behavior spot-check

```bash
# Empty prefix on a populated ingest-fed store returns top-8 single words;
# limit: 3 returns exactly ≤3; display casings preserved (e.g. "Zendesk").
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green
- [ ] `RankOptions` = `{ limit?: number }` only; no suppress anywhere in query.ts/query.test.ts
- [ ] No phrase symbols or prose remain in src/core/query.ts
- [ ] One-word invariant test passes via REAL IngestPipeline ingest with chainable text; helper `assertWordsOnly` exported from test/helpers/query-invariants.ts
- [ ] Kept suites intact: empty/casing/shape/ordering/limits/ordinal/perf (DEFAULT_LIMIT===8 pin kept)
- [ ] provider.ts, store.ts, score.ts, segment.ts untouched (`git diff --stat` scope check)
- [ ] Module header preserves the prefixRange-then-snapshot ordering-invariant documentation
- [ ] Temp dict files cleaned up in the invariant test

## Anti-Patterns to Avoid

- ❌ Touching provider.ts because a grep for "suppress" matched its
  display-debounce comments — different concept, same word
- ❌ Keeping a private filter hook "just in case" — R1 explicitly removes
  the seam; future filtering goes through the provider, not rankMatches
- ❌ Feeding the invariant test with store.upsert instead of the real
  ingest path — the invariant must be proven end-to-end
- ❌ Depending on the shipped dict for the invariant test — synthetic
  buildDictBinary keeps it calibration-independent
- ❌ Re-deriving salience or ordering locally instead of importing
  salience / reusing compareRankedMatches
- ❌ Deleting the prefixRange/snapshot ordering-invariant docs along with
  the phrase prose — that paragraph is load-bearing

---

**Confidence Score: 9/10** — the surviving algorithm is reproduced verbatim,
every delete/keep decision is line-anchored with a live-source map, the
suppress no-caller fact is verified, and the only uncertainty (S1's
in-flight partial deletions) is handled by an explicit reconcile-first task.