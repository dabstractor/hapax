# Research: BUG-001 series-bigram enrichment pipeline — end-to-end map (hapax repo @ /home/dustin/projects/hapax)

## Summary

BUG-001 is **CONFIRMED**: the production seam `src/pi/index.ts:241-248` projects the enriched
`RunMember` runs (`{key, rawCasing, series?}`) down to bare lowercase keys before handing them to
`CandidateStore.recordBigramRuns`, so the store's `isSeries` check (requires BOTH members enriched
with `series===true`, `src/core/store.ts:≈752-756`) can never fire in production. Every downstream
consumer (`provider.ts:604`, `widget.ts:1021`, `widget.ts chainShim`, `debug.ts /acwords`) reads
`Successor.series`/`nextDisplay` — fields that, in real sessions, are only ever populated by tests
that fabricate enriched stores directly (`widget.test.ts seedTheFedStore`, `bigrams.test.ts` series
describe) or by pipelines that mirror the same stripping shim (`successors.test.ts`,
`adversarial-typing.test.ts`, `acceptance.test.ts`, `bigrams.test.ts` flood test). The store itself
already accepts both bare strings and enriched members (`store.ts:735-744`), so the fix is confined
to the single `session_start` wiring seam — but the `session_tree` rebuild and `session_start`
history restore funnel through the SAME `IngestPipeline` instance, so they inherit the fix for free.

**Line-number convention:** numbers marked `P` were pinned by a read whose offset anchors the exact
line; numbers marked `≈` were derived by counting from a pinned anchor in the same file (±1 line
possible). Verbatim snippets are exact.

---

## 1. RunMember payload type + ingest emission

### 1a. `RunMember` — defined in `src/pi/ingest.ts` (NOT src/core/types.ts)

`src/pi/ingest.ts:104-140 (P for interface head; body ≈)`:

```ts
/** One run member in the onAdmittedTokens payload (spec §04 h2.26).
 *  Serializable plain data — the payload crosses the ingest→store seam. */
export interface RunMember {
  /** lowercase store key (as today) */
  key: string;
  /** the token's casing as seen in the raw text this occurrence
   *  (e.g. "National") — run casing for series-bigram display. */
  rawCasing: string;
  /** true when this occurrence belongs to a DETECTED capitalized run ... */
  series?: boolean;
  /** true when this series member's dictionary q sits in the table's very
   *  top band ... it STAYS in the runs payload so its series bigrams
   *  still form ("typing 'The ' offers 'Fed'"). ... */
  chainOnly?: boolean;
}
```

(`export interface RunMember {` is at `src/pi/ingest.ts:106 (P)`.)

The hook's declared payload type, `src/pi/ingest.ts:≈444`:

```ts
onAdmittedTokens?: (runs: readonly (readonly RunMember[])[]) => void;
```

Its JSDoc (`src/pi/ingest.ts:≈427-443`) says verbatim:

> "Bigrams (unchanged): every member's `key`, projected by index.ts's shim
> (`runs.map(r => r.map(m => m.key))`), reproduces the pre-widening string[][] byte-identically —
> recordBigramRuns' adjacent-pair counting is untouched until P1.M1.T2.S2." and
> "P1.M1.T2.S2 consumes members incl. rawCasing and **replaces the shim**."

### 1b. Series marking (cap-run detection) — `src/pi/ingest.ts`

- `UPPER_FIRST_RE = /^[A-Z]/` and `WHITESPACE_GAP_RE = /^[ \t]+$/` (≈ lines 218/205 region).
- `buildMemberRuns(entries: SpanEntry[]): RunMember[][]` — `src/pi/ingest.ts:250 (P)`. Key verbatim
  fragment:

```ts
const member: RunMember = cap
  ? { key: e.key, rawCasing: e.rawCasing, series: true }
  : { key: e.key, rawCasing: e.rawCasing };
```

- `capRunMemberIndices` — maximal ≥2-entry uppercase-initial sequences with gaps pure spaces/tabs in
  BOTH masked and raw texts (≈ lines 272-296); `detectCapRuns` exported at `src/pi/ingest.ts:313 (P)`.

### 1c. Where the pipeline emits runs — `src/pi/ingest.ts:739-744 (P)`

Inside `IngestPipeline.processText`, after the final line's series overrides:

```ts
this.#applySeriesOverrides(openLine, ordinal, fromUser);
if (this.#isDisabled?.()) return;
runs.push(...buildMemberRuns(openLine)); // unterminated final line
// Adjacency-run hook — once per message. ...
// carries RunMember runs (see onAdmittedTokens's JSDoc); the cap-run
// view rides the series marks.
this.#onAdmittedTokens?.(runs);
```

(Per-line emissions push into `runs` earlier in the same loop; the single hook call at line ≈744 is
"exactly one call per message" per the option's JSDoc.)

---

## 2. `recordBigramRuns` — `src/core/store.ts`

### 2a. Structural input type (declared LOCALLY, core never imports src/pi)

`src/core/store.ts:137-152 (≈; doc pinned at 137-143, BigramEntry.series doc pinned at 126-134)`:

```ts
/** Structural view of the enriched run-member payload (src/pi/ingest.ts's
 *  RunMember, plan 006 T1.S2) — declared LOCALLY and structurally so
 *  src/core never imports from src/pi (the architecture invariant;
 *  RunMember is plain serializable data and assignable to this shape). ... */
interface RunMemberInput {
  key: string;
  rawCasing: string;
  series?: boolean;
}
```

### 2b. Full signature + bare-string backwards compat (item 8)

`src/core/store.ts:735-738 (≈; inner loop pinned at 740)`:

```ts
recordBigramRuns(
  runs: readonly (readonly (RunMemberInput | string)[])[],
): void {
```

Member coercion at `store.ts:743-744 (≈)`:

```ts
const w1 = typeof m1 === "string" ? m1 : m1.key;
const w2 = typeof m2 === "string" ? m2 : m2.key;
```

**Yes — it accepts BOTH bare `string` members (legacy feeders, ordinary pair, no series fields) and
enriched `RunMemberInput` objects.** Because `RunMember` is structurally assignable to
`RunMemberInput` (extra optional `chainOnly` is fine for structural typing of non-literal values),
`recordBigramRuns(runs)` compiles as-is when handed the raw `RunMember[][]` payload.

### 2c. The isSeries check — BOTH members enriched with `series===true`

`src/core/store.ts:745-758 (≈; comment+const derived from pinned 740-744)`:

```ts
// SERIES PAIR (spec 06 h3.6): BOTH members are enriched RunMembers
// carrying T1.S2's cap-run mark ... Plain
// string members (legacy feeders) and unmarked members are
// ordinary adjacency pairs. ...
const isSeries =
  typeof m1 !== "string" &&
  typeof m2 !== "string" &&
  m1.series === true &&
  m2.series === true;
const nextDisplay =
  isSeries && typeof m2 !== "string" ? m2.rawCasing : undefined;
```

With the shim, `m1`/`m2` are always plain strings → `isSeries` is always `false` in production.

### 2d. Storage + one-directional series mark + successor bump

Same method (verbatim, ≈ store.ts:759-784):

```ts
const key = `${w1} ${w2}`;
const existing = this.#bigrams.get(key);
if (existing) {
  existing.count++;
  existing.lastSeenOrdinal = ordinal;
  // Series marking is ONE-DIRECTIONAL (plan 006): a later ordinary
  // sighting of the same pair never downgrades it; a series
  // re-sighting refreshes nextDisplay (occurrence casing).
  if (isSeries) {
    existing.series = true;
    existing.nextDisplay = nextDisplay;
  }
} else {
  const entry: BigramEntry = {
    count: 1,
    lastSeenOrdinal: ordinal,
    ...(isSeries ? { series: true, nextDisplay } : {}),
  };
  ...
}
this.#bumpSuccessor(w1, w2, isSeries ? nextDisplay : undefined); // successor tail (PRD §06 h3.9)
```

`nextDisplay` = the SECOND member's `rawCasing` (store side); the `BigramEntry.series`/`nextDisplay`
doc block is pinned at `src/core/store.ts:126-134`.

### 2e. topSuccessors index build — `#bumpSuccessor` + `successorBefore`

- `successorBefore` at `src/core/store.ts:173-179 (P for function line ≈173)`:

```ts
function successorBefore(a: Successor, b: Successor): boolean {
  // SERIES FIRST (07 h2.53, plan 006): a proper-noun series entry (spec
  // 06 h3.6) outranks ANY ordinary one regardless of counts, ...
  if (!!a.series !== !!b.series) return !!a.series;
  if (a.count !== b.count) return a.count > b.count;
  return a.next < b.next;
}
```

- `#bumpSuccessor(w1, w2, nextDisplay?)` (≈ store.ts:815-860): creates/updates `Successor` entries
  keeping the array sorted series-first, count-desc, byte-lex; on update `existing.series = true;
  existing.nextDisplay ??= nextDisplay` **before** the re-sort walk; overflow truncates `arr.length = 3`.
- `topSuccessors(word): readonly Successor[]` (≈ store.ts:965) — O(1) live-array read.

### 2f. Exact `Successor` shape — `src/core/types.ts:≈97-107` (read verbatim, ≈ by count)

```ts
/** One of a word's most frequent bigram successors (PRD §06 h3.9): ... */
export interface Successor {
  /** the word that followed `word` in a bigram */
  next: string;
  /** occurrences of the bigram "word next" this session */
  count: number;
  /** True when this pair came from a capitalized run (spec 06 h3.6): a
   *  proper-noun series pair. Series successors rank above ordinary ones
   *  in the per-word top-3 regardless of counts (07 h2.53). */
  series?: boolean;
  /** Run casing of the SECOND word of a series pair (e.g. "Renewable") —
   *  the offer's display form. Undefined for ordinary pairs. */
  nextDisplay?: string;
}
```

---

## 3. The production seam — `src/pi/index.ts:241-248 (P)`

Verbatim, inside `pi.on("session_start", ...)`'s `new IngestPipeline({...})` options:

```ts
      // Plan 006 widening: the payload now carries RunMembers
      // ({key, rawCasing, series?}) — the shim projects keys so
      // recordBigramRuns' input stays byte-identical until P1.M1.T2.S2
      // consumes the enrichment (series casing + cap-run marks).
      ...(config.enableChaining
        ? {
            onAdmittedTokens: (runs) =>
              sessionStore.recordBigramRuns(
                runs.map((r) => r.map((m) => m.key)),
              ),
          }
        : {}),
```

- Line 243 = `onAdmittedTokens: (runs) =>`; line 245 = `runs.map((r) => r.map((m) => m.key)),` — the
  stripping projection. The "stays until P1.M1.T2.S2" comment is at lines 237-240.
- Above it (lines 228-236) the "Chaining gate" comment states: with `enableChaining:false` the hook
  is unwired entirely (no bigrams, no successors — by design), and "recordBigramRuns is the ONLY
  successor-index path".
- This hook is the ONLY production caller of `recordBigramRuns` (grep-consistent with that comment).

---

## 4. Consumers of `Successor.series` / `nextDisplay`

### 4a. `src/pi/provider.ts:597-608 (P)` — typed-word arming gate (series consult at line 604)

Inside the close-on-space branch:

```ts
const typed = beforeText.match(/([A-Za-z][A-Za-z0-9_-]*)\s$/)?.[1];
if (
  typed !== undefined &&
  config.enableChaining &&
  chain.state() === null &&
  typed.charAt(0) >= "A" &&
  typed.charAt(0) <= "Z" &&
  store.topSuccessors(typed.toLowerCase()).some((s) => s.series)   // line 604
) {
  chain.arm(typed.toLowerCase());
  grant.reset(); // fresh one-shot grant (spec/07:450–457) — an arm is an arm
}
```

Series-first ordering in the armed branch: `src/pi/provider.ts:≈460-542`. The armed-branch filter
keeps the store's order verbatim (≈ line 522-524): "NO re-sort happens: the menu keeps topSuccessors'
successor-count order (the chain's ranking identity)" — i.e., series-first comes from
`store.successorBefore`.

### 4b. `src/pi/widget.ts:1013-1026 (P; series consult at line 1021)` — typed-word arming gate

```ts
if (/[ \t]$/.test(before) && !before.includes("@") && !before.includes("/")) {
  const typed = before.match(/([A-Za-z][A-Za-z0-9_-]*)[ \t]$/)?.[1];
  if (
    typed !== undefined &&
    deps.config.enableChaining &&
    (deps.chain?.state?.() ?? null) === null &&
    typed.charAt(0) >= "A" &&
    typed.charAt(0) <= "Z" &&
    deps.store.topSuccessors(typed.toLowerCase()).some((s) => s.series)  // line 1021
  ) {
    deps.chain?.arm?.(typed.toLowerCase());
    grant.reset(); // fresh one-shot grant — an arm is an arm
  }
}
```

### 4c. `src/pi/widget.ts:≈679-687` — `chainShim` nextDisplay fallback for display AND insertion

```ts
const chainShim = (s: Successor): RankedMatch => ({
  key: s.next,
  display: s.series && s.nextDisplay
    ? s.nextDisplay
    : (deps.store.get(s.next)?.capDisplay || s.next),
  description: "chain", // provenance marker (provider publishChain parity)
  salience: -s.count,
  sessionCount: s.count,
});
```

Doc above it (≈ 664-675) verbatim: "a series successor displays AND inserts its RUN CASING —
Successor.nextDisplay ... ('The ' offers and inserts 'Fed'). Ordinary successors keep the
casing-resolver interim: capDisplay ... when one exists, the bare key otherwise (the `||` also
covers the empty sentinel + evicted entry — never render '')." Zero-char offer branch: `widget.ts:≈891-907`
(`SERIES FIRST (spec 07 h2.53 ...): topSuccessors already orders series entries ahead of ordinary
ones ... the slice preserves that order`), consumed via `const items = succ.map(chainShim);` at
`widget.ts:≈933`.

### 4d. `src/pi/debug.ts:118-143 (P)` — `/acwords` successorsSection, series markers at ≈136-137

```ts
const succ = store
  .topSuccessors(c.key)
  .map((s) => {
    const word = s.series && s.nextDisplay ? s.nextDisplay : s.next;
    return `${word} ×${s.count}${s.series ? " (series)" : ""}`;
  })
  .join(", ");
```

---

## 5. Test fixtures — shim mirrors and fabricated enriched stores

| Test | Lines | Pattern | Verbatim |
|---|---|---|---|
| `test/successors.test.ts` `makeSuccPipeline` | 55-73 (P); shim 68-70 | **Shim mirror** ("Pipeline wired like src/pi/index.ts's session_start") | `onAdmittedTokens: (runs) =>` / `  // index.ts's shim: members → keys (plan 006 payload widening)` / `  store.recordBigramRuns(runs.map((r) => r.map((m) => m.key))),` |
| `test/adversarial-typing.test.ts` | 468-473 (P; hook at 471, projection 472) | **Shim mirror** ("the bigram hook wired exactly like src/pi/index.ts's session_start") | `onAdmittedTokens: (lines) =>` / `      s.recordBigramRuns(lines.map((r) => r.map((m) => m.key))),` |
| `test/acceptance.test.ts` `makeChainPipeline` | shim at 737-742 (P); used at ≈815 (describe "acceptance item 7 — chained completion" at ≈813) | **Shim mirror**, including the `enableChaining` spread-gate | `...(enableChaining` / `      ? {` / `          onAdmittedTokens: (lines) =>` / `            store.recordBigramRuns(lines.map((r) => r.map((m) => m.key))),` |
| `test/bigrams.test.ts` | direct string[][] at 16-21, 25-32, 37-41 (P); shim mirror at ≈238-240 (BUG-006 flood test); series describe ≈262-282 | **Both**: bare-string direct calls AND enriched fabrication | `const mem = (key, rawCasing, extra = {}) => ({ key, rawCasing, ...extra });` then `s.recordBigramRuns([[ mem("national","National",{series:true}), mem("renewable","Renewable",{series:true}), ... ]])` (describe `"recordBigramRuns — series bigrams (spec 06 h3.6/h3.7)"`) |
| `test/widget.test.ts` `seedTheFedStore` | 2391-2406 (P); section banner ≈2387; describe at ≈2408 | **Direct enriched fabrication** (bypasses ingest entirely) | `for (let i = 0; i < 5; i++) { store.recordBigramRuns([["the", "market"]]); }` then `store.recordBigramRuns([[ { key: "the", rawCasing: "The", series: true }, { key: "fed", rawCasing: "Fed", series: true } ]]);` |
| `test/index.test.ts` | imports at ≈38-42; `fakePi` ≈74-89; `fakeCtx` 110-148 (P) | **Real factory composition** — see item 6 | — |

**Does any test exercise index.ts's production composition?** Yes at the wiring level:
`test/index.test.ts` imports the REAL default export (`import hapax, { createLazyDictionary,
resolveDictPath } from "../src/pi/index.js"`), registers handlers via `fakePi()`, and fires
`session_start`/`message_end` with `fakeCtx()` — so its message_end flows DO traverse the shim at
index.ts:241-248. However, per its header, internals are "observed through the real /acwords dump
(debug mode) and the registered provider"; **no assertion on series data through this composition
was located in the portions read** (header + helpers, ~lines 1-210 of ~1209) — i.e., the bug is
invisible to it. (Not fully verified across the whole file; flagged under Missing evidence.)

**Net:** every series-behavior test either (a) fabricates the enriched store directly
(widget.test.ts `seedTheFedStore`, bigrams.test.ts series describe), or (b) wires a pipeline whose
hook strips enrichment exactly like production (successors/adversarial/acceptance/bigrams-flood).
No test feeds real ingest output through index.ts's (or an un-shimmed) seam and asserts series
marks — which is why the stripping shim ships undetected.

---

## 6. index.ts export structure + what a production-seam test needs

Exports (`src/pi/index.ts`):
- **default**: `export default function hapax(pi: ExtensionAPI): void` (≈ line 143) — the extension
  factory; registers `session_start`, `session_tree`, `message_end`, `session_shutdown`,
  `before_agent_start` handlers.
- **named**: `createLazyDictionary(path, onLoadError)` (≈ line 100), `resolveDictPath` re-export
  (≈ line 77).

Existing fake-ctx harness in `test/index.test.ts` (reusable pattern):
- `fakePi()` — `pi: { on, registerCommand }` with handlers captured into a `Map<string, Handler>`.
- `fakeCtx(over)` — returns `ctx` with `ui: { notify, addAutocompleteProvider,
  getEditorComponent, setEditorComponent }`, `cwd`, `isProjectTrusted()`, `sessionManager: {
  getBranch, getEntries }` (all `vi.fn()`; editorFactory defaults undefined → fallback path).
- Plus `startSession(handler, ctx, reason)`, `endMessage(handler, ctx, message)`,
  `settle(): Promise<void>` (420 ms > 300 ms debounce), temp-`HOME` config isolation and `HAPAX_DICT`
  temp dict file via `writeDictFile`.

A production-seam test therefore needs: `hapax(fakePi().pi)` → fire `session_start` with
`fakeCtx({ trusted: true })` (config via stubbed HOME; `debug` config + `HAPAX_DICT` if observing
via `/acwords`) → fire `message_end` with a user message containing a capitalized run
(e.g. `"The Fed meeting"` where "Fed" is dictionary-absent) → `await settle()` (or pipeline flush
via the command handler) → assert series data reached the store. Observation paths: (a) the
provider registered through `addAutocompleteProvider` mock (its closure holds the session store) —
e.g. drive its `getSuggestions` at `"The "` and assert the arm + `Fed` offer; (b) with
`config.debug`, the `/acwords` dump's successor line must show `"Fed ×1 (series)"` (debug.ts:136-137)
— with the shim it shows no `(series)` marker and `the→fed` ranks as an ordinary pair. No pipeline
object is exported, so the debounce settle (or a sufficiently awaited drain) is required.

---

## 7. Spec anchors (verbatim quotes)

### spec/04-tokenization-and-scoring.md — "## Capitalized runs (proper-noun series)" at line 256 (P)

Successors bullet, lines 287-289 (P):

> "- **Successors.** Every adjacent pair inside a run is recorded as a
>   series bigram (06), including chain-only members, **remembering the
>   run casing of both words for offer display**."

Also the top-band ceiling bullet, ≈ lines 280-283: "Such members are **chain-only**: ... the run's
bigrams still form and the after-space offer (07) still presents their neighbors — typing `The `
offers `Fed`."

### spec/06-candidate-store.md — "### Bigram capture" at 89 (P); series sentence ≈ 95-99:

> "Capitalized runs (04) contribute their adjacent member pairs as **series bigrams** — including
> chain-only (top-band) members that are not word candidates — each marked series-derived and
> remembering both words' run casing for offer display; series bigrams observe the same
> window-break rules."

"### Successor index (for chained completion)" at 125 (P); ranking sentence ≈ 133-135:

> "In the after-space offer, series successors (04) rank above ordinary successors regardless of
> counts (07); `nextDisplay` carries the run casing for series entries."

Type sketch (spec 06, ≈ 127-130): `Map<string, Array<{ next: string, count: number,
series?: boolean, nextDisplay?: string }>>  // top 3 per word`.

### spec/07-completion-ui.md — "## M2: chained completion" at line 690 (P)

- Line 692 (P): "State machine, armed by acceptance or by typing of a series member:"
- Lines 696-697 (P): "idle ──space closes a typed word whose first letter is UPPERCASE and /
  whose lowercase key has series successors──► armed(W)"
- Lines 700-701 (P): "offer the successors of W immediately: **series successors first (count
  descending among them), then ordinary successors** (count descending)."
- Lines ≈720-725 (P block, typed-word arming bullet): "Typed-word arming requires the typed word's
  first letter to be uppercase (the casing form the series was learned from; a lowercase typing of a
  top-band word must not arm, or every prose `the ` would offer its run successor) and consults the
  successor index directly, so chain-only members (04) arm it too — **typing `The ` offers `Fed`**."
- ≈ Lines 727-729: "Series items display and insert their run casing at zero typed chars; ..."

---

## 8. Risks / adjacent paths for the fix

1. **`enableChaining:false`** — the hook is conditionally spread (`...(config.enableChaining ? {...}
   : {})`, index.ts:241-248). The fix must live INSIDE the spread (pass `runs` directly or map to
   `RunMemberInput`), never move the call outside the gate, or chaining-off sessions would start
   recording bigrams.
2. **`session_tree` rebuild path (index.ts ≈ 430-540)** — verified: it calls `livePipeline.flush()`,
   `liveStore.reset()`, then `restoreFromHistory(livePipeline, ...)` on the SAME pipeline instance
   built in `session_start`. There is no second `recordBigramRuns` call site — the rebuild replays
   through the identical `onAdmittedTokens` hook, so fixing the single seam fixes branch rebuild
   automatically (and is the ONLY place it could be fixed).
3. **`session_start` history restore (index.ts ≈ 423-437)** — same: `restoreFromHistory(pipeline,
   ...)` reuses the same pipeline/hook. Covered by the single seam.
4. **Test blast radius** — the four shim-mirror fixtures (successors.test.ts:68-70,
   adversarial-typing.test.ts:471-472, acceptance.test.ts:739-740, bigrams.test.ts:≈238-240) encode
   the stripping behavior. If those pipelines are also un-shimmed (passing `runs` through), any
   capitalized-run text they ingest (e.g. fixtures containing "National Renewable Energy Laboratory")
   would start producing `series:true`/`nextDisplay` entries — `toEqual` assertions on
   `topSuccessors(...)` arrays (e.g. acceptance.test.ts ≈822-827 expecting
   `{ next: "zephra", count: 4 }`) could fail on the added fields. Production fix alone (index.ts)
   leaves all four mirrors byte-identical (they don't import index.ts's wiring).
5. **Chain-only members** — `RunMember.chainOnly` is upstream-only; `RunMemberInput` ignores it, and
   `recordBigramRuns` records its pairs like any member's (store doc verbatim). Passing the full
   payload through is safe; no store change needed.
6. **Invariant guard** — `topSuccessors` returns the LIVE array (read-only contract); any seam test
   must not mutate it.

## Contradictions

None found. Code, comments, and spec all agree that the shim is a deliberate, documented temporary
state ("until P1.M1.T2.S2 consumes the enrichment") — BUG-001 is that the replacement never landed
while every consumer (provider/widget/debug) already shipped reading the enrichment.

## Missing evidence

- Full scan of `test/index.test.ts` (≈1209 lines) for a series assertion through the real factory
  was not completed (header + helpers read); none found in the read portions.
- `provider.ts` `publishChain` (successorDisplay mapping on the fallback path) was not read
  line-by-line; its existence is inferred from `chainShim`'s "provider publishChain parity" comment.
- `src/core/types.ts` and `store.ts` field-line numbers marked ≈ may be off by ±1; the pinned
  anchors (index.ts:241-248, provider.ts:597-608, widget.ts:1013-1026, debug.ts:118-143,
  successors.test.ts:55-73, adversarial-typing.test.ts:468-473, acceptance.test.ts:737-742,
  widget.test.ts:2391-2406, spec/04:256+287-289, spec/06:89+125, spec/07:690+) are exact.
