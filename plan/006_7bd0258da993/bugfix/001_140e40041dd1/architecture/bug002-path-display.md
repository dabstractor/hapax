# BUG-002 (bugfix 001_140e40041dd1): path candidates lose their verbatim display — end-to-end display-flow map

Read-only research. Line numbers marked `[V]` were verified by direct slice reads of the
file at that offset; numbers marked `≈` are derived by counting from a verified anchor in
the same file (confidence ±1–2 lines). This subagent has no shell tool, so `git show` /
`git log` could not be run; git evidence comes from `.git/logs/HEAD` (see §7).

Bug validated: a path seen in conversation as `/home/user/projects/hapax` is stored under
key `home/user/projects/hapax` and, because the edge-bearing path class always classifies
casing `"lower"`, the sighting's display string (which still carries the leading `/`) is
discarded at `store.upsert`'s create branch. `resolveCompletionCasing` therefore returns
the trimmed lowercase key, and both display paths (provider menu + widget insert) render
and insert the key — losing the leading `/`, `~`, `./`, `../`. This contradicts
spec/04 rule 4d ("The DISPLAY preserves the original LEADING edge symbols"), spec/04
"Case handling" ("paths and technical literals always insert verbatim"), and spec/09
integration item 7 ("an absolute path inserts with its leading `/`").

---

## 1. Segment stage — the draft DOES carry the verbatim display (`src/core/segment.ts`, 816 lines)

**CandidateDraft type** — `src/core/segment.ts:722-740` `[V]` (fields 723–739; `casing: CasingClass;` verified at :733, `path?: boolean;` at :739):

```ts
export interface CandidateDraft {
  /** lowercase — lookup/store key */
  key: string;
  /** casing of this sighting (recency-merge is the store's job) */
  display: string;            // ≈:726
  /** first char of display is uppercase at extraction */
  properName: boolean;
  casing: CasingClass;        // [V] :733
  /** true for path-shaped candidates (2026-10 rule 4d): the key is the
   *  edge/line:col-trimmed lowercase path while display keeps the
   *  original edge symbols … */   // [V] :734-738
  path?: boolean;             // [V] :739
}
```

**expandCandidates path branch** — `src/core/segment.ts:795-806` `[V]`:

```ts
  if (token.path) {
    return [
      {
        key: token.raw
          .slice(token.trimFrom ?? 0, token.trimTo ?? token.raw.length)
          .toLowerCase(),                                    // :798-800
        display: token.raw, // ORIGINAL edges preserved for insertion   // :801 [V]
        properName: false,
        casing, // same raw[0] rule — no path special-case
        path: true,                                            // :804
      },
    ];
  }
```

Preceding it, the comment block `// PATHS (rule 4d) — the ONLY key≠display site beyond casing …` (≈:784-792) and the pin `// properName is pinned FALSE — a documented choice: paths are not names (spec is silent; recorded for T2.S3's display-flow audit)` at :793-794 `[V]`.

**Path classification (casing)** — ≈:780-783 (derived): classification uses
`token.raw.charAt(0)` — the DISPLAY form, uniformly for every token kind:

```ts
  const casing: CasingClass = !isUpperAscii(token.raw.charAt(0))
    ? "lower"
    : token.sentenceStart
      ? "structural-cap"
      : "mid-cap";
```

Consequence: any path whose raw starts with `/`, `~`, `.`, `@`… (every edge-trimmed key
case — the BUG-002 class) classifies `"lower"`. Corner case worth recording: a
letter-initial path (`Home/User/x`, 2 interior slashes) CAN classify mid-cap — the "always
lower" claim holds only for the edge-bearing class; the fix design should decide
`pathDisplay` vs `capDisplay` precedence for that corner (see §8).

**classifyPath** (rule-4d trim decisions; exported) lives ≈:300-360; the tokenize pass-4
path handling keeps `raw = m[0].slice(0, p.to)` (display span ends at KEY end — sentence
periods / trailing `/` / `:line:col` are trimmed from BOTH key and display) and carries
`trimFrom/trimTo` on the RawToken (types.ts RawToken.path/trimFrom/trimTo ≈:128-146).

## 2. Store stage — where the verbatim display is DESTROYED (`src/core/store.ts`, 996 lines)

`upsert` receives a **`Sighting`**, not the draft. `Sighting` (types.ts ≈:77-95) is
`{ key, display, ordinal, fromUser, properName, casing, rankGroup }` — **no `path`
field**, so `draft.path` never reaches the store.

**Create branch tally init** — `src/core/store.ts:384-398` `[V]` (lower row verified at :398):

```ts
      const tallies =
        sighting.casing === "mid-cap"
          ? { capCount: 1, lowerCount: 0, capDisplay: sighting.display, }   // :389 [V]
          : sighting.casing === "structural-cap"
            ? { capCount: 1, lowerCount: 0, capDisplay: "", structuralCapCount: 1, }
            : { capCount: 0, lowerCount: 1, capDisplay: "" };               // :398 [V] ← display discarded here
```

For a `"lower"` path sighting, `sighting.display` (e.g. `"/home/user/projects/hapax"`) is
read nowhere — only `lowerCount: 1` is recorded; the record stores no display form at all.
(The mid-cap row is the only casing that seeds a display — which means an uppercase-initial
path like `Home/User/x` keeps its edges in `capDisplay` *by accident*; the BUG-002 class
never does.)

**Merge branch (capDisplay maintenance on later sightings)** — `case "mid-cap"` ≈:449-465
(anchor verified: `this.#capForms.set(existing.key, forms);` at :455 `[V]`):

```ts
      case "mid-cap": {
        existing.capCount++;
        const forms = this.#capForms.get(existing.key) ?? new Map();
        const f = (forms.get(sighting.display) ?? 0) + 1;
        forms.set(sighting.display, f);
        this.#capForms.set(existing.key, forms);        // :455 [V]
        // capDisplay argmax; ties → the most recently bumped form …
        if (existing.capDisplay === "" || f >= (forms.get(existing.capDisplay) ?? 0)) {
          existing.capDisplay = sighting.display;
        }
```

`"lower"` sightings (all path sightings) take the `lower` case (≈:438-448): `lowerCount++`
plus twin suppression; they never touch any display. `#capForms` is a side map that dies
with eviction (`evictIfOverCap` deletes it beside the record).

**Candidate shape post-migration** — `src/core/types.ts:21-50` `[V]` (`capDisplay: string;`
at :35): `{ key, capCount, lowerCount, capDisplay, structuralCapCount?, sessionCount,
lastSeenOrdinal, firstSeenOrdinal, userTyped, properName, rankGroup }`. **There is NO
`display` field** — store.ts module doc: "…the insertion form is derived AT COMPLETION
TIME from the casing tallies (capCount/lowerCount/capDisplay) by query.ts's
resolveCompletionCasing (spec 04 h2.32, PRD R2.1) — recency never decides it, and no
display field is stored."

## 3. Query stage — the resolver can only return the key (`src/core/query.ts`, 724 lines)

**resolveCompletionCasing, full body** — `src/core/query.ts:386-408` `[V]`:

```ts
export function resolveCompletionCasing(
  c: Pick<Candidate, "key" | "capCount" | "lowerCount" | "capDisplay">,
  fragmentFirstLetter: string,
): string {
  const upper = fragmentFirstLetter >= "A" && fragmentFirstLetter <= "Z";
  if (upper) {
    // UPPERCASE fragment: the Shift press is never overridden — the
    // capitalized form wins (capDisplay verbatim; capitalize-key
    // fallback when no valid capitalized sighting exists).
    return c.capDisplay !== ""
      ? c.capDisplay
      : c.key.charAt(0).toUpperCase() + c.key.slice(1);
  }
  // Frequency branch (lowercase, zero-fragment, non-letter —
  // defensive): the form that occurred more often wins; ties →
  // lowercase (spec: ties resolve down).
  if (c.capCount > c.lowerCount) {
    return c.capDisplay !== ""
      ? c.capDisplay
      : c.key.charAt(0).toUpperCase() + c.key.slice(1); // defensive: never ""
  }
  return c.key; // lowercase wins or ties
}
```

For a `"lower"`-classified path record (capCount 0 ≤ lowerCount): lowercase fragment →
`:407` returns `c.key` (edges lost). Capital fragment (`/`? no — but e.g. typing `Sr` for
`Src/core/…` or any letter-initial fragment while Shift is held) → `:396-398` capitalizes
the KEY (`Home/user/...`), still edge-less. Its doc (≈:345-360) states: "Paths/technical
literals have no casing variance — lowercase-only tallies return the key verbatim. (A typed
CAPITAL first letter still capitalizes a path key — the never-override rule outranks path
verbatim-ness, which holds on the frequency branch; pinned in the battery.)" — the pinned
acceptance of the broken output.

**rankMatches construction site** — anchored + tier-0 (`MatchResult` = `{ tier: 0|1|2|3;
score: number }` ≈:217-231; public record `RankedMatch` in types.ts ≈:195-223 carries
`key, display, description, salience, sessionCount, tier?`):

- `rawFirst = prefix.charAt(0)` captured before lowercasing (≈:547); `rankMatches` signature verified at :538-542.
- Anchored site — `src/core/query.ts:616` (derived from verified anchor :600-603 + exact intervening content):

```ts
        display: resolveCompletionCasing(c, rawFirst),   // :616
```

- Tier-0 anchorless site passes the SAME `rawFirst` (≈:647-670; the test comment in
  query.test.ts ≈:1586 cites "The tier-0 pass (:647 site)").

## 4. Downstream consumption — both paths render/insert `MatchResult.display` (no bug here)

**Provider (fallback menu path)** — `src/pi/provider.ts:668-671` `[V]`:

```ts
      const items = matches.map((m) => ({
        value: m.display,        // :669
        label: m.display,        // :670
        description: m.description,
```

`liveKeyByValue.set(m.display, m.key)` (≈:655) keys acceptance on the display string; the
applyCompletion arm-site comment already anticipates key≠display for paths: "a path
display keeps its original edges ("/home/x", "home/x/") while the store key is the
trimmed-lowercase form" (≈:705-715) — arming uses the mapped STORE KEY, so a verbatim path
display needs NO provider change.

**Widget (primary display path)** — `src/pi/widget.ts`:
- render: `renderWidgetLine`/`fitItems` join `item.display` strings (≈:230-260).
- Tab insert: `insertHighlighted` reads `const display = items[idx]?.display;`
  (**widget.ts:1390** `[V]`) and splices it over the typed span:

```ts
    const start = col - spanLen;                                              // :1448 [V]
    const newLine = before.slice(0, start) + display + row.slice(col);       // :1449 [V]
```

The widget inserts **display, never the key** — once the resolver returns a verbatim
display, insertion is correct with zero widget changes. (Span replacement is computed from
what the user typed — `extractMatchState` prefix / word regex — so a display longer than
the typed span is fine.)

**chain-grant.ts**: irrelevant to display (one-shot word counter only; verified full
read — no display strings).

**ingest boundary** — `src/pi/ingest.ts` imports `expandCandidates`/`CandidateDraft` and
builds `Sighting`s (≈ mid-file); since `Sighting` has no `path` field, `draft.path` is
dropped here. This is the second seam a fix must thread (see §8).

## 5. Spec anchors (exact quotes)

- **spec/04-tokenization-and-scoring.md, rule 4d "Edge trim vs display"** (≈:121-129 inside the 4d block :119-172):
  > "The KEY trims leading `/`, `~`, `./`, `../` (and combinations) and a trailing `/` — matching happens on the trimmed form, because the editor fragment always starts at a letter. The DISPLAY preserves the original LEADING edge symbols: `/home/...` inserts with its leading slash, `../tools/build.mjs` with its `../`. TRAILING trims — sentence periods, a trailing `/`, a trimmed `:line:col` tail — leave key AND display alike (2026-09-30 validation fixes …)" (:145 `[V]` ends this bullet).
- **spec/04, "Case handling"** — `spec/04:701-717` `[V]`; the operative sentence at :713-714:
  > "Words seen only in all caps complete verbatim in all caps; paths and technical literals always insert verbatim. Menu labels use the same resolution against the live fragment's first letter."
- **spec/09-testing-and-acceptance.md, integration item 7** — `spec/09:262-267` `[V]`:
  > "7. **Conversational path completion (2026-10, rule 4d):** a path that appeared in conversation (user-typed or model output) is offered when its FIRST segment is typed — `sr` → `src/core/query.ts`, Tab inserts the whole path; **an absolute path inserts with its leading `/`** (:265). Once a `/` precedes the cursor, stock pi file completion owns the rest (item 6 unchanged)."
- Also spec/09 unit-test list for segment.test.ts (≈:14-19) already names "`/home/user/projects/hapax` (key trims the leading `/`, display keeps it)" — draft-level only.

## 6. Existing tests pinning the current (broken) behavior — must be updated/extended

- **test/segment.test.ts:782-795** `[V]` — `it("'/home/user/projects/hapax' → key trims the leading '/', display keeps it", ...)`:
  `expect(d.key).toBe("home/user/projects/hapax");` (:791), `expect(d.display).toBe("/home/user/projects/hapax"); // edge kept for insertion` (:792), `expect(d.display.toLowerCase()).not.toBe(d.key);` (:794). Draft-level ONLY — nothing store/query level. Also `:810-817` `[V]` ("../tools/build.mjs" draft pin).
- **test/store.test.ts:200-220** `[V]` — `it("edge-variant sightings of one path merge to one entry")` upserts `key: KEY, display: "/"+KEY` and `KEY+"/"` and pins `expect(c).not.toHaveProperty("display"); // completion-time resolution owns casing` (**:209**). This is the store-level pin of "no stored display" — the field the bug report wants contradicts its *spirit* (a literal `display` property would still not exist, but a `pathDisplay` must be added and this describe extended). The suite header (:5-6) states "casing merging into one entry whose casing lives in the tallies (completion-time resolution in query.ts; no stored display)".
- **test/query.test.ts:1576-1582** (derived, anchor :1550 `[V]`) — the battery pin:
  `it("all-caps form completes verbatim; path keys stay verbatim on the frequency branch", ...)` —
  `put(s, "src/core/query.ts", 2, 1);` then `expect(rankMatches(s, "sr")[0]!.display).toBe("src/core/query.ts");` (:1581). Passes only because this fixture's key has no trimmed edges — once a verbatim field exists this test should be extended with an edge-bearing key (`/home/...` → key `home/...`, display `/home/...`).
- **test/query.test.ts:1440-1458** `[V]` — loose tier-0 fixture upserts `sighting({ key: "src/core/query.ts", display: "src/core/query.ts" })` (:1448): again key===display, so it does not pin the divergence.
- **test/paths.test.ts** (whole file, 62 lines) is the **dictionary path resolution** suite (`resolveDictPath`, `HAPAX_DICT` override) — NOTHING about path candidates or displays. Do not add the regression test there.

## 7. Migration commit survey (limited: no shell tool in this subagent)

- `.git/logs/HEAD` (≈line 221) shows the full hash **7b2884991b006f214ffc9975e6a84469f3f4ebd3** (parent `bad61cee2b…`, timestamp 1791190761) with an unannotated entry followed by `reset: moving to HEAD` — the commit exists, but the reflog carries no message, and `git show 7b28849` / `git log --oneline --all | head -30` could not be executed (read-only file tools only). **The 'upcoming display subtask' commit-message language is UNVERIFIED.**
- Independent code/test evidence that the migration removed `Candidate.display`:
  - query.ts ≈:349-351 (resolver doc): "Exported-but-unconsumed until P1.M2.T1.S2 wires it at the two match-construction sites (and removes the legacy `Candidate.display`);"
  - widget.ts chainShim doc: "Candidate.display is GONE (P1.M2.T1.S2)";
  - store.test.ts:209 `[V]`: `expect(c).not.toHaveProperty("display")`;
  - types.ts Candidate (§2) has no display field.
- Naming caution: `src/core/segment.ts` comments reference a DIFFERENT "BUG-002" (the 2026-10 span-disjointness fuzz class: "BUG-002 class, found by the span-disjointness fuzz", "BUG-002 second arm (V-1)"). Not the PRD BUG-002 — don't conflate when grepping.

## 8. DESIGN QUESTION — minimal-change verbatim path display

**Option (b) "recompute edges in query" is not viable**: the store key has irreversibly
lost the edge information (`home/user/projects/hapax` cannot know it was seen as
`/home/…` vs bare), and edge variants of one key merge (store.test.ts:200-220) —
recomputation is ambiguous. Something must be stored. ⇒ **Option (a): a store-side field
populated from `draft.display` when the candidate is a path.**

**What flows into upsert today**: `Sighting` (types.ts) — full sighting-level data
(key, display, ordinal, fromUser, properName, casing, rankGroup) but NOT the draft's
`path` flag. `sighting.display` DOES reach upsert — it is simply discarded for
casing `"lower"` (store.ts:398). So option (a) needs:

1. **types.ts**: `Sighting.path?: boolean` (thread `draft.path`); `Candidate.pathDisplay?: string` (optional, absent ≡ not-a-path — mirrors `structuralCapCount?`'s "undefined ≡ zero" style). Prefer a field ON the record over a `#capForms`-style side map: it dies with eviction automatically (no extra `evictIfOverCap` bookkeeping), replays deterministically, and `entries()`'s `{...c}` copies it for free.
2. **src/pi/ingest.ts**: one-line pass-through of `draft.path` at the Sighting build site.
3. **src/core/store.ts upsert**: create branch — seed `pathDisplay: sighting.display` when `sighting.path`; merge branch — pick a merge policy for edge variants (`/a/b/c` then bare `a/b/c`): sticky-first (deterministic, matches "recency never decides"), or argmax à la capDisplay. **Open design decision** — recommend sticky-first-sighting or "first non-degenerate (display ≠ key)" for simplicity; document in spec/06.
4. **src/core/query.ts resolveCompletionCasing**: widen the `Pick<…>` and add a guard BEFORE the `upper` branch: `if (c.pathDisplay) return c.pathDisplay;`. Precedence question: the current battery comment says a typed CAPITAL first letter capitalizes a path key ("the never-override rule outranks path verbatim-ness"), while spec/04 Case handling (:713-714) says "paths … always insert verbatim". Recommended reading: verbatim ALWAYS (a leading `/`/`~`/`.` is not a letter; "Shift preserve" is a letter-case rule), and update the battery pin to say so explicitly. Also decide the letter-initial-path corner (`Home/User/x` → both capDisplay and pathDisplay present); `pathDisplay`-wins is the spec-consistent order.
5. **No changes needed**: `RankedMatch` (display already flows), provider.ts (items + liveKeyByValue already display-keyed and the arming comment already assumes edge-bearing displays), widget.ts (inserts display at :1449), chain-grant.ts, matchFragment (matching stays on the key; anchor on the key's first char is unchanged).
6. **Serialization/restore**: none exists — the store is RAM-only; `snapshot()`/`restore()` of Candidate objects do not exist. `reset()` + branch replay goes through the normal `nextOrdinal() → upsert() → recordBigramRuns()` chain (store.ts reset() doc, verbatim: "replaying the branch snapshot through the normal public chain"), so a deterministically-derived `pathDisplay` needs NO migration handling. `/acwords` dumps `entries()` — the new field will appear there (harmless; consider whether to surface it).
7. **Spec edits are binding** (AGENTS.md): spec/06 (record shape / upsert contract + merge policy), spec/04 h2.32 (resolver rules: path verbatim precedence), spec/09 (the regression test) must land with the code.

**Casing-tally invariant safety (task item 9)**: the guard changes only the resolver's
OUTPUT for records carrying `pathDisplay`; `upsert`'s tally switch (store.ts:437-477) is
untouched, so `capCount/lowerCount/capDisplay/structuralCapCount` math and the
twin-suppression invariants (store.test.ts casing suites; header :5-6) are unaffected.
Backward compatibility: fabricated test Sightings simply omit `path` → `pathDisplay`
stays undefined → guard inert → every existing battery case (query.test.ts:1541-1583,
incl. the 'Nr'→'NREL' rawFirst pin at :1542-1551 and the frequency/tie battery
:1554-1574) is unchanged. The two pins that must CHANGE are the store-level
`not.toHaveProperty("display")` intent (store.test.ts:209 — extend the describe with a
pathDisplay assertion) and the path-verbatim battery (query.test.ts:1576-1582 — extend
with an edge-bearing key + decide the capital-fragment expectation).

**Where the new regression tests belong** (conventions): resolver-level → the
"completion-time display resolution (spec 04 h2.32, plan 006 S2)" describe in
**test/query.test.ts** (:1541+; helpers `put(s, key, lower, cap, {display, casing})` /
`sighting({...})`); record-level merge policy → the path-merge describe in
**test/store.test.ts** (:200+; `sighting({key: KEY, display, ordinal})`). An end-to-end
ingest→query case fits query.test.ts (its header already proves things "end-to-end
through the REAL ingest pipeline"). **Not** test/paths.test.ts (dictionary resolution).
segment.test.ts:759+ stays as the draft-level pin.

## Contradictions / open items

- Spec text "paths … always insert verbatim" (spec/04:713-714) vs the resolver battery's
  "typed CAPITAL first letter still capitalizes a path key" (query.ts doc + pinned
  battery). Today the conflict is unobservable (the key has no display), but the fix must
  pick an order — recommend verbatim and update the pin.
- "Paths always classify 'lower'" is true for the edge-bearing class (raw[0] is `/`, `~`,
  `.`) but not universally — letter-initial paths can classify mid-cap (corner above).
- The PRD document itself ("BUG-002 in the PRD below") was not attached to this task and
  was not located/read; validation is against spec + code. plan/ dirs are historical and
  were not searched exhaustively.
- `git show 7b28849` message/stat and any "upcoming display subtask" language: UNVERIFIED
  (no shell tool). Reflog hash + code/test evidence recorded in §7.

## Residual risks

- Derived (≈) line numbers may drift ±1–2 lines; all verbatim quotes were taken from
  direct file reads, and every decision-critical cite (store.ts:398/:455, query.ts:386-408,
  segment.ts:795-806, widget.ts:1390/:1449, provider.ts:668-671, spec/04:701-717,
  spec/09:262-267, the three test pins) is verified.
- Merge policy for edge-variant path displays, and Shift-vs-verbatim precedence, are
  owner decisions surfaced in §8, not settled here.
