# 04 — Tokenization and Scoring

Two independent scores, deliberately conflated nowhere:

- **Global commonness** — static, from the dictionary. Drives **admission**
  (plus the conjugation guard below).
- **Session salience** — dynamic, from store stats. Drives **eviction**
  (06). Its frequency component (`sessionCount`) now ALSO breaks ranking
  ties within match-strictness tiers (2026-10 owner rule — see Query
  matching / Query ranking below); the salience score itself still never
  orders anything.

## Segmentation (`src/core/segment.ts`)

### What counts as a word

Regex passes over input text (base + hexish, then the compound/literal
sweep of rules 4a–4c below):

```
/[A-Za-z][A-Za-z0-9_]{0,63}/g          → identifiers/words
plus a second scan for hexish tokens:
/(?=[0-9a-fA-F]*[A-Fa-f])(?:[0-9a-fA-F]{6,40})\b/g  → letter-containing hex
plus the 4c literal scan (trim/composition rules below):
/[A-Za-z0-9._@:+/~=-]{4,96}/g          → technical literals (digit-bearing)
                                       → and 4d path-shaped runs (see 4d)
```

Rules:

1. **Base tokens:** `[A-Za-z][A-Za-z0-9_]*`, length 2–64. (Admission later
   requires ≥ 4.)
2. **Hexish tokens:** 6–40 hex chars containing at least one letter `[a-f]`.
   These are commit-hash-shaped and deliberately captured; the shape gate
   decides their fate (long ones rejected as noise, see below).
3. **Skip CJK and all non-ASCII runs — and never resume mid-word.** A word
   candidate must be a run of `[A-Za-z0-9_]` bounded on BOTH sides by
   non-letter characters (any Unicode letter counts as a letter). A
   non-ASCII letter adjacent to an ASCII run disqualifies the whole run:
   `Þórhildur` yields NOTHING (not `rhildur`), `ΩbsidianMirror` yields
   NOTHING (not `bsidianMirror`). Never slice a non-ASCII letter out of a
   word and complete the ASCII remainder. CJK word segmentation remains a
   documented non-goal.
4. **Punctuation/whitespace terminate tokens — EXCEPT the symbol/hyphen
   joins of rules 4a–4d.** Apostrophes always split (`don't` →
   `don`); commas, brackets, quotes, whitespace terminate.
   4a. **Dotted filename-shaped tokens stay whole (2026-09 rule).** A
       word run with one or more dotted alphanumeric parts whose FINAL
       part is 1–5 letters is ONE token: `AGENTS.md`, `package.json`,
       `file.tar.gz`. The `.` is not a word boundary here — filenames
       are completion targets as typed ("agent" should offer
       `AGENTS.md`, not the bare `AGENTS`). Base/hexish tokens inside
       the span are absorbed. Version numbers (`v1.2.3` — final part
       numeric) and decimals (`3.14`) do not match and keep the
       base-pass split.
   4b. **Hyphenated compounds stay whole (2026-09 owner rule — a
       hyphen between word segments does NOT split).** A letter-initial
       run of two or more segments joined by single inner hyphens is
       ONE token: `load-bearing`, `opt-in`, `e2e-test`,
       `state-of-the-art`. The compound as typed is the completion
       target; the parts are absorbed (never separate candidates),
       exactly like the filename pass. Leading, doubled, or trailing
       hyphens never form tokens — CLI `--flag` and `-v` are not
       candidates (and digit-initial runs like `2e-test` are owned by
       4c). Admission falls out naturally: compound keys are
       dictionary-absent → group 0, the identifier class.
       Rules 4a/4b are one family: COMPOUND TOKENS — typed-shape units
       (`.`-joined or `-`-joined) that complete whole, with contained
       base tokens absorbed by a shared sweep.
       Known gap (accepted): the compound sweep predates rule 3's
       Unicode-letter adjacency guard and never gained it — a non-ASCII
       letter adjacent to a compound span does not disqualify it
       (`草AGENTS.md` yields `AGENTS.md`), unlike the base, hexish, and
       literal passes, which all guard.
   4c. **Technical literals stay whole (2026-10 owner rule — digit-bearing
       mixed strings and long numbers are completion targets).** A
       maximal run of `[A-Za-z0-9]` joined by SINGLE INTERIOR symbols
       from `._@:+/~=-` qualifies as ONE literal token when, after
       trimming leading/trailing symbols, it is 4–64 chars, has no two
       adjacent symbols, and CONTAINS A DIGIT plus a letter or symbol —
       or is pure digits of length ≥ 4: `2560x1440@2`, `v1.2.3`,
       `192.168.1.1`, `3.14`, `8080`, `2026-09-15`, `4:36`, `2e-test`,
       `mode=2`. Motivation (owner, 2026-10): hapax exists to type
       strange identifiers, codes, and ARGUMENTS — LLM output like
       "drop the virtual mode to 2560x1440@2" must complete whole;
       pre-rule it fragmented to the base tail `x1440` only. Guards
       (each is load-bearing against a prose-noise class):
       - **Digit-bearing requirement.** Digit-FREE letter+symbol strings
         (`C++`, `and/or`, `e.g.`) do NOT qualify — that class stays
         with 4a/4b, where prose-shaped noise is already curated. The
         owner's phrase was "any two of numbers, symbols or letters";
         digit-free joins are the deliberately dropped corner
         (digit-free SLASH-joined runs are owned by 4d's path
         predicate).
       - **Single interior symbols, edges trimmed.** `..`, `//`, `::`
         reject (URLs die at `://` exactly as before); trailing
         sentence periods never glue (`fox.` stays `fox`); leading
         `--`/`~` trim (`--mode=2` → `mode=2`, `~2.1.0` → `2.1.0`).
       - **Length floor 4** mirrors "numbers over 3 digits": `123` and
         two-char codes (`4K`) stay out.
       - **Strictly additive.** A literal whose post-trim span EQUALS OR
         IS CONTAINED IN a kept base/hexish/compound token defers to
         that token (`utf8Reader` keeps camelCase subword splitting;
         `0f3a9c2` stays hexish-flagged; `FOO_1_` keeps its base token —
         the trailing-`_` trim cannot fork a `FOO_1` literal);
         literals absorb every base/hexish token inside or OVERLAPPING
         their post-trim span — containment (`2560x1440@2` absorbs its
         `x1440` tail) AND the trailing-`_` straddle class: `_` is a
         base word char AND a trim symbol, so a base token can start
         inside the literal and end past its trimmed edge without either
         span containing the other (`q~z9_` → `q~z9` whole, never the
         shred `z9_`; `X=1ZZ_` → `X=1ZZ`, never `ZZ_`). One span per
         character class region — never overlapping tokens. Rule 3
         (Unicode-letter adjacency) applies to literals like every
         pass. Literals are OPAQUE to subword splitting — codes
         complete whole as typed.

       Shape-gate interplay: letter-free keys (pure digits,
         digit+symbol codes) skip the character-entropy floor —
         `8080` (1.0 bits/char) is a real port shape and unigram-run
         still rejects `1111`. The secret rules apply unchanged
         (`user2@host.com` rejects `@`+`.`; pure-hex ≥ 20 and pure
         decimal ≥ 16 reject) — `192.168.1.1:8080` and ISO
         timestamps pass (the ratio heuristic that killed them is
         retired, 2026-10).
   4d. **Slash-joined paths stay whole (2026-10 owner rule; status:
       adopted ahead of implementation — code lands with this spec).**
       A maximal literal-charset run that is PATH-SHAPED is ONE token:
       `src/core/query.ts`, `/home/user/projects/hapax`,
       `docs/architecture.md`, `../tools/build.mjs`, `example.com/a/b`.
       Paths from conversation — model-suggested, user-typed,
       planned-but-not-yet-created — are retyping targets disk
       completion cannot know. Predicate (after edge trimming):
       **≥ 2 interior single `/` separators, OR exactly 1 interior `/`
       plus a dotted component** (`docs/readme.md`). Digit-bearing runs
       already qualify via 4c; a run qualifying both ways takes the
       path class (the more specific one — downstream behavior is
       identical, both are opaque whole tokens).
       - **Edge trim vs display.** The KEY trims leading `/`, `~`,
         `./`, `../` (and combinations) and a trailing `/` — matching
         happens on the trimmed form, because the editor fragment
         always starts at a letter. The DISPLAY preserves the original
         LEADING edge symbols: `/home/...` inserts with its leading
         slash, `../tools/build.mjs` with its `../`. TRAILING trims —
         sentence periods, a trailing `/`, a trimmed `:line:col` tail —
         leave key AND display alike (2026-09-30 validation fixes; 4c's
         `fox.` guard applied to the path family): a sentence-final
         `query.ts.` or `query.ts:42:13.` inserts as `query.ts`, never
         the period or the line numbers, and one visible path stays ONE
         candidate whether it was seen mid-sentence or sentence-final.
         Casing recency-merge is unchanged.
       - **Line/column suffix.** A trailing `:digits(:digits)?` is
         trimmed when the remainder is path-shaped
         (`src/foo.ts:42:13` → `src/foo.ts`) — the user retypes the
         path, not the line numbers; the trim applies to key AND
         display, so Tab never inserts the suffix. Non-path colons
         keep their meaning: `4:36` (time) and `localhost:8080`
         (host:port) are untouched.
       - **Guards.** Single interior symbols only (interior `..`
         rejects the whole run — `a/../b` shreds; leading `../` is an
         EDGE, trimmed); rule-3 Unicode-letter adjacency applies;
         strictly additive against equal spans of other classes (in
         practice paths cannot equal a base/hexish/compound span —
         they contain `/`); post-trim key length 4–96 (the shape
         gate's path-class cap; the literal scan window is sized to
         96 for this rule); opaque to subword splitting, exactly
         like 4c literals. Secret rules apply unchanged: a path
         segment with base64url-secret texture rejects the whole
         candidate (conservative), and `@`+`.` keeps URL userinfo
         out. The entropy floor applies like any letter-bearing key
         (real paths clear it comfortably; `a/a/a/a`-shaped noise
         dies). Path tokens enter adjacency runs like any whole
         token (the successor `edit → path` is legitimate).
       - **Completion context (owner decision).** hapax's
         stock-context gate delegates to pi's built-in file
         completion whenever a `/` precedes the cursor — UNCHANGED.
         Path candidates therefore surface at the path's FIRST
         segment (`sr` → `src/core/query.ts`; Tab inserts the whole
         path); mid-path typing belongs to stock pi (which completes
         existing files from disk). Integration item 6
         (path/slash/@ identical to stock) is unaffected.
       - **Documented gaps (accepted):** a single-slash letter-only
         path (`src/core`) is shape-identical to prose `and/or` and
         does not qualify — it shreds to components (the common
         `src/core/query.ts` form qualifies via its second slash,
         `docs/readme.md` via slash+dot); trailing-slash directory
         paths (`src/core/`) reduce to that same non-qualifying form;
         interior `..` rejects; Windows backslash paths are not in
         the charset (POSIX-shaped input assumed).

### camelCase / snake_case splitting

Each base token yields **the whole token plus its sub-words**, all as separate
candidates:

- Split on `_` segments.
- Split camelCase boundaries: lowercase→uppercase (`fixR` → `fix|R`), and
  acronym-lowercase (`HTTPServer` → `HTTP|Server`).
- Sub-words shorter than 4 are dropped as standalone candidates (still counted
  for the whole token).

The whole token is what users usually Tab; sub-words enable mid-identifier
completion (`roun` → `Rounding` from `fixRoundingError`).

### Normalization

- Lookup keys and store keys are **lowercase**.
- Each candidate remembers its **display casing**: the most recently seen
  casing variant (recency wins; "how it was last used is how you want it").
- **properName hint (2026-09 structural-start rule, extended after a
  live audit of real session history):** a Capitalized token sets the
  `properName` hint ONLY when its capital is not orthographic — i.e.
  the token is NOT at a **structural start**: (a) the first word of
  its line (this covers message starts — the audit showed
  "Project"-class clutter entering precisely there), (b) preceded by
  a bullet/heading/list marker run (`- ` `* ` `## ` `1. `), or (c)
  preceded — after whitespace and closing quotes/brackets — by
  sentence or clause punctuation (`.` `!` `?` `;` `:`). Mid-sentence
  "then Check the logs" keeps the hint; "Done. Check", "- Check",
  "## Check", "Note: Check", and message-initial "Check" do not.
  Applies to the whole token and its FIRST sub-word. Detection is a
  bounded walk-back (a fixed window per token; an unbounded scan made
  ingest quadratic and failed the 800 KB perf gate). Downstream:
  unhinted capitals lose the proper-noun relief and the conjugation
  guard's casing exemption. AUDIT FINDING (2026-09, real history
  replay): across ~2k messages this removes the systematic
  sentence-initial harvesting, but ~480 common words still admit via
  relief from occasional MID-SENTENCE capitalized sightings — a mix
  of legitimate names (Windows, Intel) and noise (echo, reject,
  device). The proposed next lever — relief requires the word to have
  no lowercase sightings in-session — is an OPEN DESIGN ITEM: it would
  also filter words like `national` that appear both ways. The
  alternative is retiring relief outright and relying on the
  dictionary-absent class (identifiers rarely need relief). No decision
  recorded; nothing changes until the owner calls it.

## Shape gate (`src/core/shapeGate.ts`)

Applied to **every** segmented candidate before dictionary lookup. Rejects:

1. **Too short/long:** whole-token candidates must be 2–64 chars
   (path-class candidates 4–96, rule 4d); sub-words 2–32. (Floor dropped 4 → 2, 2026: short dictionary-absent acronyms —
   API, CLI — are hapax's core class; common short English is rejected
   downstream by the commonness band, not by length.)
2. **Low entropy:** character-entropy < 1.5 bits/char, for LETTER-BEARING
   keys only (kills `aaaaa`, `aaaaaaaargh`-ish repetition), or unigram-run
   of any single char ≥ 4. Letter-free keys — the 2026-10 rule-4c literal
   class: `8080`, `10.0.0.1` — skip the entropy floor (two-char digit
   alternation is a real code shape, not noise; `1111` still dies by the
   unigram run, and pure-digit strings cap at log2(10) ≈ 3.3 bits/char so
   the exemption cannot mint secrets).
3. **Secret-shaped strings** (always reject, not configurable):
   - matches known key prefixes: `sk-`, `sk_`, `ghp_`, `gho_`, `github_pat_`,
     `xox[bpars]-`, `AKIA`, `AIza`, `eyJ` (JWT bodies);
   - `@` plus a dot (emails are segmented out anyway; belt and braces);
   - base64-shaped run ≥ 24 chars with mixed case+digits+`+/`;
   - whole-candidate pure hex ≥ 20 (private-key-shaped) or pure
     decimal ≥ 16 (card/account-shaped);
   - base64url/entropy residue rules (BUG-003; see shapeGate.ts).

   RETIRED 2026-10 (owner): the digit+symbol-ratio heuristic (> 0.4 at
   length ≥ 16) — written before technical literals existed, it
   rejected `192.168.1.1:8080`, ISO timestamps, and dotted versions,
   the exact class hapax exists to complete. Residue accepted:
   separator-bearing card numbers (`5105-1051-0521-0510`) and
   all-lowercase non-hex random alnum ≥ 16 pass the token gate;
   maskSecrets' format rules own real leaked keys, and PAN-shaped
   pure decimals (≥ 16 digits) still reject via the long-number rule.
   Binding layering rule: future card/secret SHAPE rejection belongs
   in maskSecrets (raw layer — it runs before tokenization and covers
   live and restore paths alike), never in a token-shape rule.
4. **Pure noise:** consonant run ≥ 6 with no vowel and no digits.

Hexish tokens 6–12 chars (commit-hash-like) **pass** the gate — they are
legitimate completion targets in dev sessions. Hexish ≥ 20 rejected by rule 3.

The gate is the load-bearing filter for dictionary-absent words; everything
absent from the table enters here or not at all.

## Admission decision (`src/core/score.ts`)

Let `q = dictionary.lookup(lowercase)` (null when absent) and `len` be
the key length. The reject band is **length-conditioned (2026-10 owner
rule, the long-word gradient; status: adopted ahead of implementation —
code lands with this spec)**:

    R_eff(len) = R                                len ≤ 8   (floor hold)
    R_eff(len) = R + (255 − R)·√((len − 8)/12)    8 < len < 20
    R_eff(len) = 255 (admit-all)                  len ≥ 20

`R` is the floor — **default 30** (2026-10 width-bound retune; owner
rule — was 12 since the 2026-09 retighten), runtime-tunable via the
`rejectCommonness` config (see 08; the knob moves the floor and the
whole curve scales from it). The design premise (2026-09, refined
2026-10): **dictionary attestation is discounting evidence at short
lengths** — hapax completes the dictionary-ABSENT class (identifiers,
commit-hash-shaped tokens, jargon) — but commonness stops being
evidence of noise as words lengthen: typing savings grow with length
while noise mass collapses (of ~50k corpus words, ~13k
currently-rejected live at 7–9 chars, ~2.8k at 11+, ~250 at 14+).
The sqrt shape is steep where noise dies (9–12) and saturates where
almost nothing remains to admit (16+). Curve chosen by owner
measurement (2026-10): linear 6→20 was rejected (≈18.9k flips,
re-admitting the audit's own `provider` class); floor-10 variants were
rejected as stricter than the owner's intent (~3.2k flips, nothing
below 11 chars); **sqrt 8→20 adopted** (≈10.5k flips).

**Floor retune 12 → 30 (2026-10 owner rule, width-bound):** the
one-line widget + per-prompt line claim + width-bound suggestion
count dropped the UI cost of an admitted common word — the 8-item
vertical-menu flooding that justified R=12 is gone, and a fuller line
is now the deliberate display. Measured against the shipped artifact:
attested-admitted table words 15,064 → 32,544 of 48,802. The
dev-vocabulary class comes in (`node` q=23, `spec` q=28, `null` q=24,
`turbine` q=26 — the zephyr fixture's successor tail grew with it);
the prose HEAD holds (`the` 240, `with` 179, `this` 197, `window` 99,
`context` 51, `everything` 139) and the conjugation guard rides the
curve unchanged (`deleted`/`lists`/`uploads` still reject — their
stems sit at/above the floor). Accepted consequence (owner): mid-class
words now carry high sessionCount and can out-rank rare identifiers
within a match tier; the rarity-weighted ordering that would neutralize
this is a recorded future design item, not shipped.

| Condition | Result |
|---|---|
| `q !== null && q >= R_eff(len)` | **Reject** — attested English too common for its length (`the`, `context`, `provider`, `everything`) |
| `q !== null && q < R_eff(len)` | **Admit, rank group 1** — attested, but worth completing at this length |
| `q === null` (absent) | **Admit, rank group 0** — rare-by-default (post shape gate): THE value class |

Measured effect against the shipped artifact (sqrt 8→20, floor R=30
since the 2026-10 width-bound retune): at floor lengths (≤ 8 chars)
admits q<30; 9 chars admits q≤94 (`R_eff(9)` ≈ 94.95, float compare —
q=95 is the first reject), 10 → q<121.8 (`R_eff(10)` ≈ 121.8;
`government` q=101 yes; `everything` q=139 no),
11 → q<142.5 (`information`, `development`), 12 → q<159.9
(`organization`, `relationship`), 14 → q<189.1 (`characteristics`,
`infrastructure`, `responsibility`); admit-all from 20. The prose head
stays rejected (`provider` q=34 and `cache` q=30 sit at/on the 8-char
floor hold; `default` q=44, `enable` q=38); the dev-vocabulary class
(`node` 23, `spec` 28, `null` 24) ADMITS — the deliberate 2026-10
flip.

**Group placement is flat at 1 (2026-10 owner rule).** Every attested
admission lands at rank group 1 regardless of q — long ramp-admitted
words carry the +0.5 rarity bonus like the rarest tail ("weighted a
little more heavily", owner), and the old `[20, 50)` group-2 band
stays dead. That band was the 2026-09 live-audit noise leak (1,183
everyday words: `provider`, `default`, `null`, `node`, `enable`,
`spec`, `cache`, against 4,889 absent identifiers); the ramp does not
revive it. The `RankGroup` type keeps group 2 for compatibility (the
subword clamp can still produce it); it is unreachable via the table
and via relief.

The bands are baked constants calibrated against the shipped artifact
with `tools/calibrate-bands.mjs`, which doubles as a word probe:
`node tools/calibrate-bands.mjs lists deleted` prints a word's `q` and
its verdict (lowercase and capitalized). Calibration history: 220
(BUG-001, mathematically unreachable) → 100 → 50 (Issue-1) → **12**
(2026-09 final) → length-conditioned sqrt 8→20 (2026-10 gradient) →
**30** (2026-10 width-bound retune).

**Proper-noun relief — RETIRED-IN-PLACE.** The relief mechanism (a
capitalized whole token whose table result is reject admits at group 2)
remains in code but its ceiling is set equal to the reject band, so it
can no longer admit anything. History: it existed so M2's "National
Renewable Energy Laboratory" (q 57–94) could chain; a live audit showed
it admitting ~483 capitalized common words (`echo`, `windows`,
`failed`, `file`). The owner retired it ("not half of the english
language"); restoring named-entity completion is a user-allowlist design
question (config layer), not a band change. The 2026-10 ramp changes
nothing here: the ceiling sits at the floor R, below every R_eff —
relief stays dead.

**Conjugation guard.** An inflection whose STEM is a common word rejects
too, whatever its own `q`. The dictionary ranks inflections separately
(`delete` q=51 rejects; `deleted` q=45 would admit; absent `deletes`
would admit as "rarest"), which leaked everyday verbs, adverbs, and
plurals into the menu. Stems are one-level strips of `-s -es -ed -d
-ing -ly`, with e-restoration (`typing`→`type`, `caching`→`cache`) and
doubled-consonant undo (`stopped`→`stop`). Two tiers, both comparing
the stem against the SAME length-conditioned threshold of the word
being admitted — `R_eff(len(word))` (2026-10):

- stem `q >= R_eff(len)` → reject (any `q` of the word itself);
- word absent AND stem `q >= R_eff(len)` → reject (absent inflections
  of attested stems: `uploads` → `upload` q=38 ≥ R_eff(7) = 30).

The fixed mid-band stem threshold (20, MID) is retired (2026-10) —
both tiers ride R_eff; it survives only as a compatibility constant.
At ramp lengths the guard loosens with the table: `configurations`
(14c, stem `configuration` q=26 < R_eff(14) ≈ 184) admits; a 9-char
absent inflection of a mid-common stem admits at group 0 — an accepted
consequence of the owner-chosen curve. Capitalized (properName) candidates skip the guard — casing
evidence outranks morphology (a relief-restoring change would need this
intact). Known leak (accepted): an inflection whose stem is ALSO
dictionary-absent admits as group 0 — no tier can fire (`parse` and
`parses` are both absent from the table, so `parses` stores as a rare
word). Derivational suffixes (`-tion`, `-ment`, `-er`) are
deliberately NOT stripped: `deletion` is a distinct lexeme.

Sub-word candidates require their own admission (same table, plus the
guard) but never rank above rank group +1 of their parent whole token.

## Salience formula (eviction)

Computed at query time from store stats; consumed only by the eviction
score (06). For candidate `c`:

```
salience(c) =
    2.0 * log2(1 + sessionCount)          // in-session frequency
  + 3.0 * exp(-(msgsSinceLastSeen) / 20)  // recency decay, τ = 20 messages
  + 1.5 * userTypedBonus                  // 1.0 if ever typed by user, else 0
  + 0.8 * properNameHint                  // 1.0 if capitalized-initial, else 0
  + 1.0 * rarityBonus                     // group 0: 1.0, group 1: 0.5, else 0
```

- `sessionCount`: occurrences this session (each upsert increments; a word
  appearing in both a user message and the assistant reply counts twice).
- `msgsSinceLastSeen`: message ordinal delta (store tracks a per-session
  monotonic message counter, not wall-clock — sessions can idle for hours).
- `userTypedBonus`: set once, forever sticky for the session.
- Weights are baked constants. **Not configurable.** Tuning happens in the
  codebase via 09's protocol, not at user runtime.

## Query matching (anchored fuzzy + anchorless tier-0; 2026-10 owner rules)

The plain prefix match is RETIRED. The typed fragment `f` (from word
matching or after the trigger char, 07) matches candidate key `c` (both
lowercase) iff:

1. **First-character anchor:** `f[0] === c[0]` — the first typed
   character must equal the candidate's FIRST character
   (case-insensitive). A fragment that does not start with the
   candidate's first character never matches (`esk` never matches
   `zendesk`; mid-identifier entry stays available through sub-word
   candidates — segmentation above).
2. **Anchored subsequence:** `f[1..]` appears in `c[1..]` in order
   (subsequence, greedy leftmost matching).

The anchor is load-bearing for performance: only the store's
first-char bucket is fuzzy-scanned per query (06), so the < 1 ms
keystroke budget (02/09) survives the fuzzy scan.

**Strictness tiers** (order-determining — see Query ranking):

- **Tier 3 — exact prefix:** `c` starts with the whole fragment (the
  retired behavior; always the strictest).
- **Tier 2 — contiguous tail:** `f[1..]` occurs contiguously somewhere
  in `c[1..]` (`zsk` → `zendesk`; `zlock` → `z_lwlock`).
- **Tier 1 — scattered:** anchored-subsequence only, with gaps
  (`hrp` → `handleResponseProxy`).

**Admission score (threshold-gated; NOT order-determining).** Every
match gets an integer score 0–100:

```
tier 3: 100
tier 2: 85 − 40 · (charsSkippedBeforeRun / len(c))   → ~45–85
tier 1: 70 − 5 · gapRuns − min(3 · gapChars, 15)      → ≤ 62
```

Candidates scoring below `fuzzThreshold` (config, 08; default 60,
higher = stricter; 100 degenerates to exact-prefix-only mode) are
discarded BEFORE ranking — they render nothing even though they
technically match. Owner rationale (2026-10): a ~20k-entry store with
loose fuzzy settings floods the results; only fairly strict matches
belong. At the default this admits every exact prefix, strong
contiguous tails (`zsk`→`zendesk` ≈ 62, `hr`→`handleResponse` ≈ 69)
and — since the gap-size retune below — exactly one scattered class:
the single 1-char interior hole (`delt`→`delete` = 62, the word minus
one letter). Every looser scattered shape gates: a 2-char hole scores
59 (`hrp`→`handleResponseProxy`), a second gap ≤ 54. The formula
constants are calibration starting points (09 tuning protocol), not
gospel; the tier BOUNDARIES (what is a prefix / contiguous tail /
scattered match) are semantics, never tunable.

**Tier-1 gap-size scaling (2026-10 retune of the first calibration,
`50 − 5·gapRuns − min(gapChars, 15)`).** The first calibration was a
cliff, not a slope: its ceiling (44, since every tier-1 trace has ≥ 1
gap run of ≥ 1 char) sat below BOTH mode defaults, so no scattered
match could ever render — while `del`/`delet`→`delete` scored 100 and
`delt` (the word minus ONE interior letter, a plain skipped-keystroke
typo) scored 44 and vanished at ambient 60 AND `#` 45. The retune
keeps the flat 5-per-gap-run (fragility of the subsequence) and
scales the per-gap-CHAR cost to 3 (capped at 15 total, saturating at
5 skipped chars), off a base of 70 — so hole SIZE slopes (62 / 59 /
56 / 53 / 50…) instead of one near-flat drop, and the tightest
possible trace — one 1-char hole — lands at 62, just over the ambient
gate with every looser shape still under it. Verified against a
synthetic d-bucket corpus: the ambient-60 delta is exactly the
one-1-char-hole class (e.g. `dlt`/`delt`/`dlte`→`delete`-shaped
traces); tier-2/3/0 arithmetic is untouched.

**Tier 0 — anchorless contiguous run (2026-10 owner rule; status:
adopted ahead of implementation — code lands with this spec).** When
the ANCHORED scan (tiers 1–3, threshold-gated) returns ZERO results —
and only then — one anchorless pass runs over the full store: the
fragment appears as ONE contiguous run, EITHER placement — anywhere
in the key, or at the first position (the owner's either/or; position
0 is tier 3's territory whenever anchored results exist, so the
anywhere arm is the operative one). Fragment floor **3 chars**;
anchors, subsequence logic, and boundaries do not apply. Admission
score:

    tier 0: 85 − 40 · (runStart / len(c))   → ~45–85

threshold-gated exactly like the other tiers (a run starting in the
front ~62% of the key passes 60; late runs gate). Tier 0 sorts BELOW
tier 1 — the strictness order extends to 3 > 2 > 1 > 0.

Measured record (2026-10, rare-tail corpus — the class that actually
admits; collisions counted only on fragments whose ANCHORED result is
empty, the only case where the fallback fires): the fallback can
never enrich a menu that would already open — it only rescues menus
that would not appear. Cost: ~5% of common 3-char words rising to
~20% at 7 chars summon a one-shot menu that narrows away as typing
continues; the collisions are overwhelmingly morphological cousins
(`said`→`unsaid`, `heard`→`unheard`, `people`→`townspeople`),
accepted by the owner. Wins: mid-word recall no anchored rule can
serve (`esk`→`zendesk`, `tok`→`session_token`) and, in particular,
path-filename entry (`query`→`src/core/query.ts`, score 64) — rule-4d
path tokens are opaque to subword splitting, so nothing else serves
this. This AMENDS integration item 2 (09): "no menu for common
words" now reads "no menu for common words WITH ANCHORED MATCHES; the
zero-result fallback may surface contiguous-run cousins."

**Performance.** The anchorless pass scans the full store (there is
no first-char bucket to enter — measured 1.1–2.6 ms per query at the
20k cap, synthetic). The < 1 ms keystroke budget keeps applying to
the ANCHORED scan (unchanged, bucket-only); the tier-0 pass carries
its own budget — < 3 ms p99, CI gate at 3×, mirroring the existing
gate structure — and fires only on the empty-anchored path, so the
common case never pays it.

**Trigger-char mode (`#`) loosening (2026-10 owner rule).** Under the
trigger char the gates relax — `#` is hapax's explicit "search the
session vocabulary" gesture, and the picker precedent (fzf, command
palettes) puts promiscuous matching behind an explicit invocation,
never in the ambient word-start path: (a) tier-0 anchorless runs are
ALWAYS consulted — no zero-anchored-result precondition (`#query` →
`src/core/query.ts` works directly); (b) scattered tier-1 matches are
VISIBLE — the `#` mode's default threshold is **45** (vs ambient 60;
45 sits under tier-1's max of 62, so the tighter scattered shapes
admit — those with `5·gapRuns + min(3·gapChars, 15) ≤ 25`, i.e. up to
two gaps of any size or three/four tiny gaps: `#cfg` →
`config_manager_service` (62), `#hrp` → `handleResponseProxy` (59);
three-plus sizeable gaps still gate). Under the first calibration
this clause was vacuously false (max 44 < 45 admitted nothing); the
gap-size retune makes it true as written. An explicitly set
`fuzzThreshold` (08) overrides BOTH mode defaults. Successor
chaining stays ANCHORED everywhere: chain arming and the chain gate
consult tiers 1–3 only — tier-0 matches never arm or extend a chain.

## Query ranking (final result order)

**2026-10 owner rule — frequency tie-breaking (settled).** Order is:

1. **Strictness tier descending** (3 exact prefix > 2 contiguous tail
   > 1 scattered > 0 anchorless run — 04 Query matching). A
   1-occurrence exact-prefix word outranks a
   40-occurrence scattered match — strictness always wins first.
2. **Within a tier: `sessionCount` descending** — conversation
   frequency breaks ties among equally strict matches (the owner's
   rule: higher occurrence counts make a word rank higher than
   another word matching the query exactly).
3. Ties → shorter candidate key first.
4. Ties → lexicographic (byte order on the lowercase key).

**Zero-fragment listing** (`#` alone — no fragment, no tiers):
sessionCount descending, then rules 3–4.

**Retired (same rule):** the pure content-derived order ("shortest
first, then byte-lex; never salience"). Its 2026-09 rationale was
cross-session muscle-memory stability. Superseding rationale (owner,
2026-10): among equally strict matches the more conversation-relevant
word (higher session count) belongs leftmost; the accepted cost is
that same-tier neighbors may swap as counts change during a session.
Residual stability: tiers and rules 3–4 are content-derived, and two
candidates only reorder relative to each other when one's
sessionCount strictly passes the other's.

**Plural pruning (2026-09 owner rule):** when a result set contains
both a key and that key + `"s"` (exact single-`s` pair: `plugin` /
`plugins`), the plural is dropped — the pair is redundant menu noise
and the singular is the completion target. Guards: the pair must be
in the SAME result set (a plural whose singular is absent — filtered
by the limit, not a match, or evicted — stays); `ss`-final
keys never prune (`glass`/`glas`); `es`/`ies` plurals are different
keys entirely (`class`/`classes` is out of scope); filename-shaped
keys are untouched (`agents` vs `agents.md` is not a pair). Pruning
runs BEFORE the limit slice, so a pruned plural never consumes a
slot. The store itself is never pruned — this is a query-time menu
rule only (the conjugation guard in admission handles common stems;
this covers dictionary-absent jargon pairs that both stored
legitimately).

Rationale for the retired order (kept for history): a menu whose order
depends on recency or frequency reshuffles between keystrokes and
between sessions, defeating the muscle memory completion exists to
build. The 2026-10 owner decision accepts same-tier churn as the price
of conversation-relevant ordering; salience still decides MEMBERSHIP —
admission and eviction — and the full salience score never orders
anything (only its raw `sessionCount` component does, within tiers).

Return top `maxSuggestions` items (config, 1–20; **default 20 since
the 2026-10 width-bound rule** — the widget line's real cap is the
terminal width, so the count is only a sanity ceiling and the default
sits at the schema max; the fallback menu's height — 07). Under the
trigger char, same rules.

## Case handling

- Matching is **case-insensitive** throughout — anchor, tiers, and score
  all computed on lowercase keys: typed `nrel` matches `NREL`.
- Insertion uses the candidate's display casing (`NREL`).
- The store keys on lowercase; one candidate per lowercase key (casing
  variants merge, display casing = most recent).