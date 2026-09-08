# hapax Delta PRD — D2: M2 Redesign (Successor-Chaining Only) + Tab Contract Hardening

**Status:** Draft v1.0 (delta) · **Base:** hapax PRD v1.0 as amended · **Size:** medium
(~140 changed PRD lines across §00 invariants, §01 goals, §04, §06, §07, §08, §09)

## Diff summary (previous PRD → current PRD)

1. **Invariant #2 rewritten** — "Tab only ever completes": Tab never opens/toggles/summons the
   menu; menu opens only via typing (2nd threshold char, 1st char after trigger, zero-char
   chain offer). New §07 rule 0 + a new "Tab-open gesture: root cause and mitigation" section
   (pi-tui `force`/`explicitTab` single-item fast path).
2. **Goal 6 inverted** — M2 no longer has multi-word phrase candidates. One word per
   completion, always; the only phrase behavior is successor chaining.
3. **§04 segmentation rule 3 expanded** — non-ASCII letters adjacent to an ASCII run disqualify
   the whole run (`Þórhildur` → nothing, `ΩbsidianMirror` → nothing). Never resume mid-word.
4. **§06 M2 section rewritten** — phrase candidates (PhraseEntry, n-gram admission, sticky,
   40-ordinal demotion, constituent suppression, phrase salience) **removed**; replaced by
   strict raw-text-adjacency **bigram-only** capture with enumerated window breaks, feeding
   the successor index (retained, top-3, 10k cap).
5. **§07 chain machine changed** — successor offer at **zero** typed chars, threshold **0** for
   the whole chain duration (was: threshold 1, one-shot adjacent pending offer).
6. **§07 menu item shape** — `value` always exactly one word; multi-word forbidden; chain
   provenance marker `chain`.
7. **§08 config** — `enablePhrases` → `enableChaining` (primary), `enablePhrases` accepted as
   deprecated alias; gates chain layer only.
8. **§08/§09** — `/acwords` drops the phrase dump (successor-index sample only); tuning
   protocol notes no phrase multipliers exist; M2 DoD rewritten; new provider test bullet
   (Tab-only-completes, forced single-item).

## Removed requirements (awareness — no standalone tasks; deletion folded into R1)

The previous session **implemented** all of the following (phase P2 complete). They are now
removed by the PRD and their code must be deleted as part of R1:

- `PhraseEntry` map, bigram **and trigram** capture of consecutive admitted tokens
  (`store.ts`, `types.ts`, `ingest.ts`)
- Phrase admission (repetition ≥2 / all-rare fast path), `sticky`, 40-ordinal demotion sweep,
  phrase candidacy set, phrase eviction heap (`store.ts`)
- Phrase items in query results, `phraseSalience`, constituent suppression (`query.ts`)
- Phrase tuning multipliers, `/acwords` top-10 phrase dump (`debug.ts`)

## Requirements

### R1 — One-word invariant: strict adjacency bigrams, successor index only

**Changed from:** phrases were multi-word completion candidates with hybrid admission,
decay, and suppression. **Now:** a completion item is always exactly one word, under all
circumstances. No multi-word string is ever a menu item, a `value`, or an insertion. "Phrase
support" means only: after a word is accepted, its most-likely successor is the top result
with zero additional typed characters (see R4).

**Bigram capture (raw-text adjacency, strictly):** during ingestion, record bigrams of
admitted whole-token candidates (sub-words excluded) that are **adjacent in the raw text** —
the two words separated by nothing but plain whitespace (spaces/tabs) on the same line. Key =
lowercase `first second`. The window breaks — no bigram forms — when ANYTHING other than
plain whitespace appears between the two words:

- **Clause/punctuation:** `,` `;` `:` `.` `!` `?` `—` `–` `…` `|`
- **Quotes and brackets:** `` ` `` `"` `'` `(` `)` `[` `]` `{` `}` `<` `>` — words entering or
  leaving a quote do not chain across the boundary
- **Digits, hexish, any non-word character:** `/` `\` `=` `+` `&` `%` `#` `*` `@` `-` `~` `^`
  — a digit run or hexish token between two words breaks the window (`v2 release` does not
  chain `v2`→`release`)
- **Any other word, common or rare** — an intervening word, even a rank-rejected common word
  like `the` or `of`, breaks the window. **Stopword bridging is FORBIDDEN**: `United States
  of America` yields only `united states` and `america`
- **Newline:** the window never crosses a line break (unchanged)

No trigrams. The one M2 store structure is the **successor index**
(`Map<string, Array<{ next: string, count: number }>>`, top-3 per word, built at ingest).
Cap the bigram map at 10,000 keys with the standard eviction policy; evicting a bigram also
splices it from the successor index.

**Files (existing, complete — modify, don't rebuild):**
- `src/core/store.ts` — delete the phrase layer (`#phrases`, `#phraseCandidates`, admission/
  sticky/demotion, phrase eviction heap; ~line 40-230 region and the eviction index classes);
  retain and re-point the successor index to the new bigram capture; keep `topSuccessors()`
- `src/core/types.ts` — remove `PhraseEntry` (successor types stay)
- `src/pi/ingest.ts` — replace the admitted-token-sequence windowing ("newline is the ONLY
  window break") with raw-text adjacency: track token spans per line; a window forms between
  consecutive admitted whole tokens only when the raw text between them is all `[ \t]+`
- `src/core/query.ts` — remove phrase items, `phraseSalience`, constituent suppression, and
  the `opts.suppress` seam; `rankMatches` returns single words only
- `src/pi/debug.ts` — drop the phrase dump and `phraseSalience`/`firstWord` imports

**Tests:** `phrases.test.ts` and `phrase-gating.test.ts` are deleted or rewritten as
adjacency-window tests (each enumerated break is a case: comma, backtick-quoted pair, digit
run, intervening stopword, newline); `successors.test.ts` updated for strict adjacency
ingest; `query.test.ts` phrase cases removed; one-word invariant asserted (no multi-word
item ever returned).

**Docs (Mode A):** none beyond code comments — user-facing doc impact is changeset-level
(R6).

### R2 — Segmentation: never resume mid-word after non-ASCII

**Changed from:** "Skip CJK and all non-ASCII runs" (ASCII regex simply resumes after the
non-ASCII run — current `segment.ts` yields `rhildur` from `Þórhildur` and `bsidianMirror`
from `ΩbsidianMirror`). **Now:** a word candidate must be a run of `[A-Za-z0-9_]` bounded on
**both** sides by non-letter characters, where any Unicode letter counts as a letter. A
non-ASCII letter adjacent to an ASCII run disqualifies the whole run: `Þórhildur` yields
NOTHING (not `rhildur`), `ΩbsidianMirror` yields NOTHING (not `bsidianMirror`). Never slice a
non-ASCII letter out of a word and complete the ASCII remainder.

**Files:** `src/core/segment.ts` — after the base/hexish scans, reject any token whose
immediately-preceding or immediately-following source character is a Unicode letter
(`/\p{L}/u` covers CJK, Latin-1 letters, etc.). The existing "CJK skipped, ASCII resumes
after" test expectation changes to "whole adjacent run disqualified".

**Tests:** `segment.test.ts` — add `Þórhildur` → nothing, `ΩbsidianMirror` → nothing,
`草sword` → nothing; keep pure-ASCII-after-CJK-run-punctuation cases that should still match
(e.g. `漢字 word` still yields `word` — the CJK run is bounded by a space).

**Docs (Mode A):** none (internal module).

### R3 — Tab-only-completes contract + forced single-item mitigation

**New requirement** (§07 rule 0 + root-cause section). Invariant #2 now reads: *Tab only
ever completes.* A single Tab keypress, when a live suggestion set exists (computed
synchronously, whether or not the debounced popup painted it), completes the **selected**
item — or the **top** item if none selected — immediately. Tab must never open, toggle,
summon, or expand the menu. Menu visibility is driven exclusively by typing; there is no
manual open gesture of any kind, and completion is always exactly one keypress.

**Root cause (traced in the PRD, verified in the installed pi-tui):** in
`@earendil-works/pi-tui` `dist/components/editor.js`, Tab while no menu is open →
`handleTabCompletion()` → `forceFileAutocomplete(true)` →
`requestAutocomplete({ force: true, explicitTab: true })` →
`getSuggestions(lines, line, col, { signal, force: true })`. In `runAutocompleteRequest`:
`items.length === 1` → applied immediately (single-item fast path, line ~1902);
`items.length > 1` → menu opens in `"force"` state. hapax currently ignores `options.force`
and returns its full ranked set (>1 item), so Tab lands in the menu-open branch. That is the
bug.

**Mitigation (extension-only; no pi-tui changes):** in `getSuggestions`, when
`options.force === true` AND a hapax fragment is live (threshold word, trigger char, or
armed-chain word start):

- Return a **single-item** set: the top-ranked item per §04 ranking; during an armed chain,
  the top successor.
- The forced single-item return **bypasses the 100 ms display debounce** (forced requests are
  undelayed by design); always return the live top item.
- When hapax has no live fragment (path/slash contexts), delegate to
  `current.getSuggestions(...)` passing the options object through unchanged, so stock
  path/file completion keeps its native Tab behavior (current delegation already forwards
  the original options object — keep that).
- Empty live set on force → return empty; the editor cancels and renders nothing.
- Add a code comment pinning the dependency: this leans on pi-tui's
  `force && explicitTab && items.length === 1` branch; if pi-tui changes that contract, the
  mitigation needs revisit.

**Files:** `src/pi/provider.ts` — add the force branch ahead of the normal query path
(after the abort check and chain handling, ordering: abort → armed/pending → force → normal).
Display-debounce layer (`provider-display` logic) must let forced single-item returns
through untouched.

**Tests:** `provider.test.ts` / `provider-live.test.ts` — per §09's new bullet: Tab with a
live set completes the selected (or top) item and never opens/toggles a menu; menu appears
automatically on the 2nd char of a matching word and the 1st char after the trigger char;
`getSuggestions` with `force: true` + live fragment returns exactly one item (the live top /
chain successor); Tab-before-paint completes rather than opening the menu (drive the editor
flow or simulate the `{ force: true }` call and assert `items.length === 1`).

**Docs (Mode A):** none (internal; the never-hijack README bullet is refreshed in R6).

### R4 — Zero-typed-char chain offers (threshold 0 for the chain)

**Changed from:** chain filtering at threshold 1 plus a one-shot pending offer requiring
strict cursor adjacency to the accepted word, implemented with **leading-space item values**
(`" renewable"`). **Now:** while armed(W), a word start — cursor at the empty next word,
ZERO typed chars — offers the top successor immediately (lookup W → top-3, ranked by count);
the successor IS the top result before the user types anything. Typed chars filter the live
successor list (prefix, case-insensitive); **threshold stays 0 for the duration of the
chain**. Tab during armed inserts ONE word and transitions `armed(next)`; any non-Tab key
that disqualifies (space, escape, punctuation) → idle; no successors → idle. Chains arm only
from hapax's own candidates (never path completion); chain resets on `before_agent_start`;
trigger-char completions also arm.

The zero-char offer must compose with pi's prefix replacement to produce correct word
separation with a **bare one-word value** (R1's invariant forbids multi-word values; retire
the leading-space-value mechanism in favor of the word-start semantics — the empty-prefix
insertion after the separating space/whitespace). If validation against the real editor
shows the bare-value form cannot separate words correctly, document the exact constraint in
the task before choosing the minimal fix; multi-word values remain forbidden regardless.

**Files:** `src/pi/provider.ts` — chain machine (`createChainMachine`, armed branch, pending
offer); `src/pi/index.ts` — unchanged wiring (before_agent_start reset already exists).

**Tests:** `chain.test.ts` — update: zero-char offer at every armed word start (not just the
first post-arm query); typed-char filtering from the unfiltered list; one-keypress
transitions; `National` → zero chars → `Renewable` top → Tab → `Energy` → Tab → `Laboratory`
(integration item 7). Existing case (8) semantics (word-less buffer keeps disarm+delegate)
preserved.

**Docs (Mode A):** none (usage example is R6).

### R5 — Config `enableChaining` + deprecated `enablePhrases` alias; `/acwords` successor-only

**Changed from:** `enablePhrases` primary key gating the whole phrase layer. **Now:**
`enableChaining` (default `true`) gates the successor-index chain layer only;
`enablePhrases` is accepted as a **deprecated alias** for this key. Word completion is
unaffected either way. Validation behavior unchanged (coerce boolean, repair with one-time
notify). When both keys are present, `enableChaining` wins.

`/acwords` debug dump: drop the phrase section entirely; keep store size, top-50 by
salience, rank-group histogram, gate rejection counts, and a successor-index sample.

**Files:** `src/pi/config.ts` (key rename + alias, keep validation/notify shape);
`src/pi/index.ts` and `src/pi/provider.ts` (`config.enablePhrases` reads → `enableChaining`);
`src/pi/debug.ts` (dump change).

**Tests:** `config.test.ts` — primary key, alias mapping, precedence when both present;
`debug.test.ts` — no phrase section, successor sample present; gating tests from R1 assert
`enableChaining: false` leaves the chain layer inert while word completion works.

**Docs (Mode A):** update the README Configuration table row (`enableChaining`, alias note)
— small enough to ride here rather than in R6.

### R6 — Sync changeset-level documentation + DoD re-verification (Mode B)

Depends on R1–R5. The whole delta must ship coherent: README feature list drops phrase
completions and multi-word insertion; describes chained Tab completion (one word per Tab,
zero typed chars to see the next word, `National`→`Renewable`→`Energy`→`Laboratory`);
never-hijack section gains "Tab only completes — the menu opens by typing only";
configuration table shows `enableChaining` (+ deprecated alias); Debug section drops the
phrase dump. Verify every claim against shipped behavior; delete anything unimplemented.

**DoD re-verification** (M2 DoD as rewritten): all unit tests green including the one-word
invariant assertion and every raw-text-adjacency break case (commas, quotes/brackets/
backticks, digits, non-word characters, intervening words — stopword bridging forbidden —
newlines); forced-single-item tests green; chain resets on `before_agent_start`; integration
item 7 with zero additional typed chars; M1 suites (never-hijack, perf gates, no-persistence)
re-run green; `npm run check` clean.

## Prior work & research references

- All M1 + old-M2 work is **complete** in `/home/dustin/projects/hapax` — modify, don't
  rebuild. Key existing symbols: `CandidateStore` (`src/core/store.ts`, `topSuccessors()`
  retained), `rankMatches` (`src/core/query.ts`), `createHapaxProvider` /
  `createChainMachine` (`src/pi/provider.ts`), `loadConfig` (`src/pi/config.ts`),
  `IngestPipeline` (`src/pi/ingest.ts`), `/acwords` (`src/pi/debug.ts`).
- `plan/001_88fc3a66fd74/architecture/pi_extension_api.md` — provider contract
  (`getSuggestions(lines, line, col, { signal, force? })`, delegation rules) still applies.
- pi-tui forced-Tab branch verified in-repo at
  `node_modules/@earendil-works/pi-tui/dist/components/editor.js` (~line 1902:
  `options.force && options.explicitTab && suggestions.items.length === 1` → immediate
  apply; else menu opens). No new research needed.

## Out of scope

- No changes to dictionary, admission bands, salience weights, shape gate, thresholds
  (config), ingest event contract, or M1 word completion.
- No pi-tui modifications — the Tab-open fix is extension-only.
- No persistence, telemetry, or network (unchanged invariants #3, #4).
- English-only dictionary, CJK segmentation non-goals unchanged.