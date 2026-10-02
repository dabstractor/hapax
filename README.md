# hapax

An autocomplete extension for the [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent, named for the [*hapax legomenon*](https://en.wikipedia.org/wiki/Hapax_legomenon) —
a word that occurs only once in a corpus, which is exactly what it harvests.
hapax watches user prompts and final agent output as they enter the context
window, extracts uncommon words, identifiers, and proper names, and offers
them as Tab completions while you type. When pi exposes an editor factory,
hapax renders its own one-line result widget below the input (the primary
path); where no editor factory exists, hapax falls back to pi's built-in
vertical autocomplete menu (spec 07).

**Status: M3 (v3) — complete, live-verified 2026-09-08** (one-line widget
primary display, anchored-fuzzy matching with an anchorless tier-0
fallback and tier/frequency ranking,
length-conditioned R_eff admission; widget live-verified against the real
pi + split-editor stack per spec 09). The M1 definition-of-done gauntlet —
every gate, command, and measured number — is recorded in
[`docs/M1-DoD.md`](docs/M1-DoD.md), together with its M2 post-delta
re-verification (zero-typed-char chain offers, one-word-per-Tab invariant,
`before_agent_start` reset), the 2026-09 bugfix-001 re-verification, and
the 2026-09-30 widget-path bugfix post-delta note (four defects found and
fixed: chained Tab completion armed on the widget primary display,
duplicate-free ingest of trailing-`_` literals, dismissal suppression
bounded to its own message, and tokens carried whole across 64 KB slice
boundaries); the M3 DoD
append lands with the DoD re-verification sweep. The scripted zero-typing
chain proof is the item-7 section of
[`test/fixtures/sessions/RESULTS.md`](test/fixtures/sessions/RESULTS.md)
("Item 7 — chained completion, zero typed characters — VERDICT: PASS").

## Features

Behavioral truth lives in [`spec/`](spec/SPEC.md) — the single source
of truth (see its "Spec maintenance policy": interactive sessions must
keep it current; this README is a summary).

- **Trigger-char completion from the 1st character** (default `#`) — `#ze`
  looks up from the first character after `#`; a bare `#` lists the
  session's top candidates (`src/pi/provider.ts`).
- **Word matching from the 1st typed character**, anywhere a word
  starts — no position gating, no special mode. Matching is
  anchored-fuzzy (2026-10): the fragment's first character must equal the
  candidate's first character (the anchor), the rest matches as a
  subsequence — `zsk` finds `zendesk`. Matches come in four strictness
  tiers (exact prefix > contiguous tail > scattered > **tier 0, the
  anchorless fallback**), and a candidate enters the result set only
  above the `fuzzThreshold` score (0–100; 100 = exact-prefix-only).
  Tier 0 fires only when the anchored scan returns ZERO results — and
  only then: one full-store pass matches the fragment (≥ 3 chars) as a
  single contiguous run anywhere in the key (`esk` → `zendesk`,
  `query` → `src/core/query.ts` — path filenames, which sub-word
  splitting can't serve), scored `85 − 40·runStart/len`,
  threshold-gated, sorted below tier 1. Under the trigger char (`#`)
  the gates relax (spec 04/07): tier-0 runs are ALWAYS consulted — no
  zero-result precondition (`#query` completes `src/core/query.ts`
  directly) — and scattered tier-1 matches are visible (`#` default
  threshold 45 vs ambient 60; an explicitly set `fuzzThreshold`
  overrides both modes). The store's first-character index stays the
  anchored scan entry, preserving the < 1 ms query budget; the fallback
  pass carries its own (< 3 ms p99, empty-anchored path only)
  (`src/core/query.ts`, spec 04).
- **Predictable tiered menu order** — results order by match-strictness
  tier (exact prefix > contiguous tail > scattered > anchorless run),
  then in-session frequency (sessionCount) within a tier, then
  shorter key, then byte-lexicographic (a 4-key comparator; spec 09,
  `src/core/query.ts`). The zero-result tier-0 fallback can never enrich
  a menu that would already open — it only rescues menus that would not
  appear. The pure content-derived order (shortest match
  first, lexicographic) is RETIRED (2026-10 decision log). A bare-trigger
  listing has no tiers — frequency order. Session salience (recency,
  repetition, sticky user-typed, rarity) governs store
  retention/eviction only (`src/core/score.ts`).
- **English words barely admit — and admission is length-conditioned
  (2026-10 R_eff curve)** — hapax completes identifiers, commit-hash-shaped
  tokens, and jargon: the dictionary-ABSENT class. Attested English
  rejects when its frequency quantile `q` meets the length-conditioned
  reject curve R_eff: flat through 8 chars at the `rejectCommonness`
  floor, a sqrt ramp across 9–19 chars, admit-all at ≥ 20 — so short
  common words (`context`, `data`, `code`, `provider`) reject while
  longer attested words slip in as they grow (`handoff`, q = 10, stays).
  A prose-only session ingests to an empty store — ordinary prose never
  opens a menu (`test/shipped-dict.test.ts`, 2026-10 pin). The
  `rejectCommonness` knob is the FLOOR of that curve — higher = looser,
  the whole curve scales from it (`~/.pi/agent/hapax.json` /
  `.pi/hapax.json`); probe any word with `node tools/calibrate-bands.mjs
  <words...>` (prints q + verdict). The conjugation guard additionally
  rejects inflections of attested stems (`deleted`, `lists`, `uploads`),
  with stem comparisons riding the same curve.
- **Enter always submits — on both display paths** — while a hapax result
  is showing, Enter dismisses it and submits the prompt (Tab is the
  accept key); on the widget path the dismiss-then-forward runs through
  the editor proxy, so pi-vim/split-editor keep working
  (`src/pi/editor.ts`, `src/pi/widget.ts`).
- **Stock contexts are never preempted — by construction on the widget
  path.** When the widget composition is active, hapax registers no
  autocomplete provider at all, so pi's own path/slash/`@` completion is
  untouched by construction. On the fallback path, slash-command lines
  (`/re`), `@` mentions, and fragments inside quoted paths are classified
  and delegated verbatim to pi's own completion
  (`classifyStockContext` in `src/pi/provider.ts`, priority slash →
  mention → quoted-path → path): hapax answers nothing there, and Tab in
  those contexts behaves exactly as stock pi — it never opens the hapax
  menu (`test/provider-match.test.ts`).
- **Proper-noun relief — retired (2026-09)** — the relief that admitted
  capitalized attested words (`National`-class) is retired-in-place
  (ceiling == reject band); the 2026-10 R_eff curve subsumes it. A live
  audit showed the old band admitting ~483 capitalized common words
  (`echo`, `windows`, `failed`). Mechanism and calibration history live
  in `src/core/score.ts`; named-entity completion, if wanted back, is an
  allowlist design question (spec 04).
- **Session salience retention** — recency, repetition, and a sticky
  user-typed feed the eviction score that decides which candidates
  stay in the bounded store (`src/core/score.ts`).
- **Case-preserving insertion** — type `nrel`, get `NREL`: matching is
  case-insensitive, insertion uses the casing last seen in-session.
- **Secrets never suggested** — an always-on, two-layer gate keeps
  key-shaped strings out of the store (`src/core/shapeGate.ts`). Layer 1
  (`maskSecrets()`, a raw-text pre-segmentation pass wired at
  `IngestPipeline.#admitSegment`) blanks structured keys in the segment
  before tokenization: AWS access/secret keys, Slack `xoxb-…`, GitHub
  `ghp_`/`github_pat_`, Google `AIza…`, OpenAI `sk-…`/`sk-proj-…`, and
  dotted JWTs; a bare run of ≥ 32 key-material characters (mixed
  alphanumeric, `+`, and `/` — the 38-char AWS-style secret class) is
  masked whole via the `BARE_RUN_MIN = 32` catch-all. Layer 2
  (token-level residue rules)
  catches fragments that reach the gate anyway: known key prefixes,
  base64url runs ≥ 16 (mixed case + digits), and charset-relative entropy
  floors on long base64/hex runs. Whole-token secret rejection also
  propagates to the token's camelCase/snake_case sub-word fragments
  (ingest memo poisoning — poisoned drafts skip admission), so
  `CYEXAMPLEKEY`-style fragments never store. Masked keys yield zero
  candidates; ordinary prose passes through byte-identical. Pinned by
  `test/mask-secrets.test.ts` and the synthetic-token paste battery
  (npm/glpat/sk_live/Bearer shapes) in `test/adversarial-ingest.test.ts`
  (integration item 5, PASS in `docs/M1-DoD.md`).
- **Zero persistence, zero telemetry, zero network** — everything lives in
  RAM and dies at `session_shutdown` (`src/pi/index.ts`).
- **Chained Tab completion — zero additional typing, one word per Tab**
  (`src/pi/provider.ts`, `src/pi/widget.ts`) — a top-3 successor index is
  built at ingest from
  strict-adjacency bigrams captured from raw text (`recordBigramRuns`,
  `src/core/store.ts`; the 10,000-key bigram cap drains to ≤ cap within
  the same `recordBigramRuns` call — looped 256-batch eviction — so no
  transient overshoot survives a message). Accepting a word via Tab arms
  its most-likely successor on BOTH display paths: on the widget line (the
  primary path) the zero-typed-char successor renders like any result set —
  explicit intent bypasses the display hesitation gate (spec 07) — and in
  the fallback menu it arms and offers exactly as before. At the next word
  start the successor is already the top result with ZERO typed characters —
  Tab inserts ONE word and re-arms, so `Acme` → `Zephyr` → `Noria` →
  `Inverter` walks with nothing typed between accepts; every other chain
  behavior below (one-word-per-Tab re-arm, live filtering, resets, restore
  arming) is identical on the two paths. Inserted chain words use the candidate's display
  casing (most-recent-casing-wins), exactly like word completions. Typed characters filter the live successor list
  normally (anchored fuzzy matches admitted into chains, gated by the
  same `fuzzThreshold`) — and chains stay ANCHORED everywhere: the chain
  gate consults tiers 1–3 only; tier-0 anchorless matches never arm or
  extend a chain (spec 07). Chaining resets on `before_agent_start` (each new user
  turn) and on disqualifying input — including the trigger char, which
  resets the chain to idle and honors trigger mode with the `#frag`
  prefix — and arms normally in resumed sessions —
  chain-after-restore probe in `test/adversarial-typing.test.ts` (machine:
  `test/chain.test.ts`; gating: `test/chaining-gating.test.ts`; index:
  `test/successors.test.ts`; widget path: `test/widget.test.ts`).

## Quick start

Three ways to load hapax (details and verified commands in
[Development](#development)):

1. **One-off:** `pi -e /path/to/hapax` — pi loads the TypeScript source
   directly through jiti; there is no build step.
2. **Global symlink:** `ln -s /path/to/hapax ~/.pi/agent/extensions/hapax`
   — auto-loads with plain `pi`.
3. **Project-local:** `.pi/extensions/hapax` inside a project —
   trust-gated; pi prompts on first load and untrusted projects never load
   local extensions.

Configuration is optional (`hapax.json`; defaults work out of the box) —
see [Configuration](#configuration).

## Usage

hapax learns the session's vocabulary in the background while you work.
Session mentions `Zendesk` and `lwlock`. Later:

```text
type  ze        → offers Zendesk → Tab inserts "Zendesk" (cased)
type  #l        → offers lwlock  → Tab inserts it
```

**Widget mode** (the primary display whenever pi exposes an editor
factory): results render as one line below the input — words joined with
`" | "`, no descriptions. Arrow behavior is two-state per result set:
un-entered (no arrow has moved the highlight yet) — ↑/← on the first
word dismiss the line and the caret moves on that same press (boundary
pass-through, identical to plain pi), →/↓ enter the list; entered —
the four arrows move the highlight and both edges wrap end-to-end
(carousel; →/↓ on the last word returns to the first), Escape dismisses
(suppressing the line for the rest of that word), Tab inserts the
highlighted word, and Enter always submits. Where no editor factory
exists, the same results appear in pi's vertical autocomplete menu
instead (the fallback path).

Chaining is the only multi-word mechanism — and every insertion is exactly
one word. Discuss the Acme Zephyr Noria Inverter product line, then:

```text
type  acme    → offers Acme → Tab inserts "Acme"
              → successor already the top result, ZERO typing
              → Tab inserts "Zephyr" → Tab → "Noria" → Tab → "Inverter"
```

Accepting a word arms its most-likely successor (`src/pi/provider.ts`,
`src/pi/widget.ts`):
at the very next word start the armed successor is offered as the top
result with nothing typed, each Tab inserts one word and re-arms, and
typed characters filter the live successor list normally. The chain resets
on `before_agent_start` (each new user turn) and on disqualifying input —
typing the trigger char mid-chain resets to idle and honors trigger mode
with the `#frag` prefix — and arms normally in resumed sessions: the walk
above is reachable after a history replay (regression-pinned in
`test/adversarial-typing.test.ts`).

Ordinary prose: typing is identical to stock pi — no key is captured, no
result line appears for common words **WITH ANCHORED MATCHES** — the
zero-result tier-0 fallback MAY surface one-shot contiguous-run cousin
menus (`said`→`unsaid` class, ~5–20% by fragment length) that narrow away
as typing continues (spec 09 item 2) — and Tab with no selection inserts a
literal Tab. Stock contexts are never preempted: slash-command lines
(`/re`), `@` mentions, and fragments inside quoted paths complete exactly
as they do in stock pi. The result line is strictly take-it-or-leave.

## Architecture

Two layers:

- `src/core/` — pure, agent-agnostic computation: `dictionary` (packed
  binary loader), `segment` (word segmentation + camelCase/snake_case
  splitting; word-boundary guards step by full code points — a non-ASCII,
  including astral-plane, letter adjacent to an ASCII run disqualifies
  the run; slash-joined path runs are whole tokens per rule 4d),
  `shapeGate` (noise/secret rejection), `score` (length-conditioned R_eff
  admission + salience), `store` (per-session word candidates, 20k cap,
  plus the top-3 successor index fed by strict-adjacency bigrams captured
  from raw text at ingest — the 10,000-key bigram cap drains to ≤ cap
  within the same ingest call), `query` (anchored-fuzzy matching + the
  zero-result tier-0 fallback + tier/frequency ranking). No pi imports.
- `src/pi/` — the pi adapter: `index` (extension factory + lifecycle +
  the dual-path display decision), `ingest` (message handling),
  `widget` (the primary one-line result display: visibility machine +
  key capture), `editor` (non-mutating forwarding proxy: Tab completes /
  Enter submits carry-over, composes with pi-vim/split-editor),
  `provider` (the fallback-path autocomplete integration, registered
  only when no editor factory exists), `config`, `debug` (`/acwords`),
  `paths` (jiti-safe dictionary path).

Three paths connect them:

- **Ingest** (background, never on the keystroke path): `message_end`
  events feed a pipeline with a 300 ms trailing debounce and chunked
  processing (≤ 64 KB slices, event-loop yield between slices).
- **Query** (synchronous, every keystroke): match-state extraction →
  anchored-fuzzy tiered query (first-char bucket scan; zero-result
  tier-0 fallback) → frequency ranking, with zero awaits; Tab always
  resolves the live result.
- **Display** (dual-path, decided at session start): when an editor
  factory exists, the widget composition renders the one-line result
  line below the input — its own visibility machine (never with zero
  candidates), key capture, and repaint-on-swap; otherwise the fallback
  popup path uses a 100 ms paint debounce with flicker hysteresis via
  the stacked autocomplete provider. Either way the menu/result line
  never flickers and never appears with zero candidates.

```
   user prompt ─┐                       keystroke
 agent output ──┤                           │
                ▼                           ▼
      ┌──────────────────┐        ┌───────────────────┐
      │   src/pi/ingest  │        │ src/pi/widget ────┤─► one-line result
      │  message_end     │        │ (primary display) │    below the input
      │  300 ms debounce │        └─────────┬─────────┘
      │  ≤64 KB chunks   │        ┌─────────┴─────────┐
      └────────┬─────────┘        │ src/pi/provider   │
               ▼                  │ (fallback display)│
      ┌───────────────────────────┴───┐               │
      │            src/core           │               │
      │ segment → shapeGate → dict →  │               │
      │  score → store (cap 20k) →    │               │
      │  query (anchored + tier-0)    │               │
      └───────────────────────────────┘               │
```

Lifecycle: `session_start` loads config, builds a fresh store, wires the
display path — the widget composition when pi exposes an editor factory,
otherwise the stacked autocomplete provider — and (unless the session is
genuinely new and empty) replays existing session history through the same
pipeline oldest→newest — a resumed session's vocabulary is available
again. `message_end` only
observes: the handler never returns a value, so hapax cannot modify
messages or anything sent to providers. `session_shutdown` disposes
timers and drops every reference — nothing to flush, because there is no
persistence. Compaction fires no handler; the store survives compaction
untouched. `before_agent_start` (each new user turn) resets the Tab-chain
machine to idle, so a chained successor offer never leaks across turns. If
the packed dictionary fails to load, ingestion is disabled
permanently for that runtime (one error notify) while the empty provider
stays registered, delegating all completion to pi; a failure observed
during the history replay also aborts the replay itself — a resumed
session never admits history through a broken dictionary.

## Design invariants

Mirrored from [`spec/SPEC.md`](spec/SPEC.md) ("Design invariants") — that
file is authoritative; the text below is verbatim.

1. **Never hijack typing.** No key is ever captured, consumed, or altered except
   Tab while a suggestion is selected — plus, on the one-line widget display
   (M3), the arrow keys and Escape once the result line has been ENTERED; on
   an un-entered line ↑/← on the first word dismiss the line AND forward the
   press (the caret moves — one press, plain-pi parity). The user's typing
   experience is otherwise unchanged; the result line is strictly
   take-it-or-leave.
2. **Tab is never delayed by UI — and Tab only ever completes.** The top
   suggestion is computed synchronously on every keystroke; the popup may be
   debounced, but a single Tab keypress always resolves the current top or
   selected item immediately. Tab never opens, toggles, or summons the
   menu; the menu opens automatically on the 1st char of a matching word
   (when candidates exist), on the 1st char after the trigger char, or at
   the zero-char chain offer. Enter always submits — never accepts a
   completion (see 07).
3. **The popup never flickers and never appears with zero candidates.**
4. **Everything stays in RAM.** No persistence, no telemetry, no network. The
   candidate store is per-session and dies at `session_shutdown`.

The guarantee behind invariant 1 is calibrated, not best-effort: under the
2026-10 R_eff curve, a prose-only session ingests to an EMPTY store —
`the`, `with`, `this`, `context`, `data`, `code` and every everyday word
in their rank band reject outright
(`test/shipped-dict.test.ts`), and prose-no-menu probes pin it
(`test/adversarial-typing.test.ts`). Tab also never replaces the wrong
span: the displayed result set is invalidated whenever the input prefix
moves (a character typed, or a fresh acceptance), so a stale suggestion
set is never applied over shifted text — the rapid-Tab corruption class is
regression-pinned by the editor sims in `test/adversarial-typing.test.ts`.

## Known limitations

- **English-only dictionary.** Non-English common words are absent from
  the table and therefore over-admitted as "rare." This degrades memory
  efficiency, not correctness — salience still ranks them usefully, and
  the most valuable completions (identifiers, API names) are English-shaped
  regardless of user language. Per-language tables are a drop-in later via
  dictionary format versioning.
- **Absence conflates "rare real word" with "random string."** Shape gates
  filter the worst noise; salience handles the ordering. A rare real word
  that never recurs in-session was never a useful completion.
- **Tab may insert a top item the display hasn't repainted yet.** The
  computation is deterministic and correct; the widget line (or fallback
  popup) can be up to one debounce behind the live result. Treated as
  cosmetic.

## Non-goals

- No ingestion of tool-call results, file reads, or thinking tokens —
  only user prompts and the agent's final text output.
- No persistence across sessions; no per-project caches.
- No learned/ML scorer, no embeddings — hand-tuned constants only.
- No CJK word segmentation (CJK runs are skipped).
- No modification of messages, context, or anything sent to providers.

## Reference

### Dictionary build

#### What ships

`dict/common-en.bin` — a packed HAPX v1 binary (magic `HAPX`, version 1,
48,802 entries, ~0.9 MB). It is loaded at runtime by
`src/core/dictionary.ts` (`loadDictionary()`). Quants are ordered by real
word frequency.

#### Corpus provenance

The shipped artifact is built from `tools/corpus/en-50k.tsv` — the top 50,000
English word frequencies (hermitdave/FrequencyWords 2018 `en_50k`, RAW
non-lemmatized variant; data origin OpenSubtitles 2018, CC-BY-SA-4.0),
vendored verbatim. Source URL, license, retrieval/integrity details, and the
build-time filtering behavior (988 lines not matching `KEY_RE` are dropped at
build; case variants merge with summed counts) are documented in
[`tools/corpus/README.md`](tools/corpus/README.md).

The corpus is dialogue register, so `you`/`i` outrank `the` — expected, and
harmless: admission gating uses the R_eff curve, not exact rank order.

The build script itself is corpus-agnostic: any `word<TAB>count` unigram list
(UTF-8, plain integer counts) works as input. When sourcing a different list,
cross-check it against an LLM tokenizer vocabulary (o200k / cl100k) so
tokenization frequency informs ranking: words the tokenizer splits should not
outrank common whole words.

#### Rebuilding

Regenerate the shipped artifact from the vendored corpus (pass exactly ONE
input file — counts sum across multiple inputs):

```bash
node tools/build-dict.mjs --out dict/common-en.bin tools/corpus/en-50k.tsv
```

Merge → filter (`^[a-z][a-z0-9_-]{1,31}$`) → sort by count desc → cap at
70,000 entries → quantize to u8 → emit. The script prints a per-section size
summary and self-verifies the written file; exit 0 with
`verified: N/N entries OK, no duplicate keys` means the artifact is safe to
commit. Builds are deterministic: same input TSVs → byte-identical binary.

#### Calibration guarantee

Admission is governed by the length-conditioned reject curve R_eff in
`src/core/score.ts` (2026-10): a flat floor at `REJECT_COMMON_THRESHOLD =
12` through 8 characters, a sqrt ramp `R + (255−R)·√((len−8)/12)` across
9–19, admit-all at ≥ 20. The floor is calibrated against this artifact's
quantized rank distribution and the calibration is load-bearing: 45,118 of
the 48,802 entries score q ≥ 12, so essentially the whole everyday-prose
vocabulary rejects at short lengths — `the` (240), `with` (179), `this`
(197), `them` (156), the PRD's named reject example `context` (51), plus
`data` (82), `code` (91), `lazy` (67), `ordinary` (79), `provider` (34)
— while longer rare words survive the ramp (`handoff`, q = 10, admits;
nothing attested admits below the floor). Ordinary prose never opens a
result line: a prose-only session ingests to an empty store, pinned by
`test/shipped-dict.test.ts` (2026-10). Band recalibration is a separate
concern from artifact regeneration: `node tools/calibrate-bands.mjs
<words...>` is R_eff-aware — it prints each word's q, R_eff(len), and
verdict (lowercase and Capitalized) and re-verifies the constants against
the artifact — while `test/calibration.test.ts` (band edges, measured
behavior) and `test/shipped-dict.test.ts` (top words reject, prose
no-menu, empty prose store) pin the guarantee to the shipped binary.

#### Versioning contract

The format version lives in the file header (u16 at offset 4). The extension
requires an **exact match** and refuses mismatched files (notifies and
disables itself). Rules:

- Any regeneration with **different quantization or a different entry set
  MUST bump the version**.
- Same-format rebuilds that only refresh word data keep the current version
  (1).
- After changing the version in `src/core/dictionary.ts` (`DICT_VERSION`),
  regenerate and commit `dict/common-en.bin` in the same change.

### Configuration

pi exposes no extension-settings API for extensions, so hapax reads a plain
JSON config file itself (`src/pi/config.ts`, `loadConfig()`). The surface is
deliberately tiny; all fields are optional and unknown keys are ignored
silently (forward compatibility):

| Field            | Type    | Default | Valid                                                   | Meaning                                        |
| ---------------- | ------- | ------- | ------------------------------------------------------- | ---------------------------------------------- |
| `triggerChar`    | string  | `"#"`   | one non-word, non-space character (`/^[^\w\s]$/`), or `""` to disable trigger mode entirely; `@`, `/` and `"` are reserved (pi's stock contexts own them — the trigger could never fire, so load emits one warning) | prefix that opens the completion popup |
| `threshold`      | number  | `2`     | `1`–`3` (clamped)                                        | retained but inert — matching is effectively 1 char (see spec 07) |
| `maxSuggestions` | number  | `8`     | `1`–`20` (clamped)                                       | cap on candidates offered at once (the widget line cap AND terminal-width truncation) |
| `rejectCommonness` | number | `12`  | `1`–`255` (clamped)                                      | dictionary-attestation FLOOR of the length-conditioned reject curve R_eff (flat through 8 chars, sqrt ramp, admit-all at 20) — higher = looser; the whole curve scales from this floor. Also governs the conjugation guard's stem comparisons (via R_eff). Probe any word first: `node tools/calibrate-bands.mjs <words...>` prints q + verdict (lowercase and Capitalized). Default is the baked constant in `src/core/score.ts` |
| `fuzzThreshold`  | number  | `60`    | `0`–`100` (clamped)                                      | minimum fuzzy match score (spec 04) for a candidate to enter a result set. Per-mode defaults (2026-10): 60 ambient (word matching), 45 under the trigger char (scattered tier-1 visible there); an explicitly set value overrides BOTH modes. Higher = stricter; 100 = exact-prefix-only mode. Default is the calibration starting point (tuning protocol, spec 09), imported automatically from the baked constant in the query module — same pattern as `rejectCommonness` |
| `menuDelayMs`     | number  | `0`     | `0`–`2000` (clamped)                                     | hesitation gate for the menu's first appearance; **default OFF** (150/300 calibration attempts failed against real rhythm — set only if flow-popping returns) |
| `enableChaining` | boolean | `true`  | `true` / `false`                                         | gates chained (successor) completion only; word completion unaffected either way; `enablePhrases` is accepted as a deprecated alias and is mapped to this key |
| `debug`          | boolean | `false` | `true` / `false`                                         | enables the `/acwords` command + store dump     |

#### File paths and precedence

Layers merge in order, later wins per key:

1. Built-in defaults (in code).
2. `~/.pi/agent/hapax.json` — user-global.
3. `.pi/hapax.json` — project-local; read **only when the project is
   trusted** (untrusted ⇒ ignored entirely, as if missing — the path is
   never touched).

Missing files are the normal case and stay silent. A malformed file (bad
JSON, or JSON that is not an object) is discarded as a whole with a single
`hapax: malformed <path>, using defaults` warning; the remaining layers
still apply. A present-but-invalid value is repaired to the previous
layer's value with one warning per repaired field; out-of-range numbers
are clamped into range without a warning. Booleans accept only real
booleans — no truthy coercion.

#### Not configurable (by design)

The match-tier boundaries and tier constants (including the tier-0
fallback's 3-char floor and score formula), the R_eff curve shape, the
conjugation-guard suffix set, salience weights, the eviction cap, debounce
intervals, and popup timing are internal tuning constants — never
user-configurable (only the two floors above are knobs; tier BOUNDARIES
are semantics, never runtime-tunable). If better values are learned, they
ship as new constants, not new config fields.

### Debug

Set `"debug": true` in `~/.pi/agent/hapax.json` (or `.pi/hapax.json`) and
hapax registers a `/acwords` command when the session starts. With the
default `debug: false` the command does not exist. `/acwords` is a
read-only tuning instrument (PRD §09): it dumps, via a popup
notification, what the ingest pipeline actually admitted this session:

- the candidate store size against the 20,000-entry cap and the current
  message ordinal;
- the rank-group histogram (admission group entry counts — under the
  2026-10 curve attested admissions land in group 1, so the mid/common
  buckets stay near-empty);
- the top 50 candidates by salience — display form, occurrence count
  (`×N`), and admission group;
- ingest counters: words seen, admitted, and per-rule shape-gate
  rejections (`tooShort`, `tooLong`, `lowEntropy`, `unigramRun`,
  `secret`, `consonantRun`);
- the successor-index sample: for the 10 highest-salience words that have
  successors (`SUCCESSOR_SAMPLE_N` in `src/pi/debug.ts`), rows rendered
  `word → successor ×count` — the tuning signal for chained offers. A
  store with no successor entries renders `successor index sample` /
  `(none)`.

The dump contains stored words and counters only — it never prints
message bodies.

### Development

#### Dev loop (no build step)

pi loads hapax's TypeScript source directly through jiti — there is no
build step and no install copy to keep in sync. Point pi at the repo:

```bash
pi -e /home/dustin/projects/hapax
```

The `pi` manifest in `package.json`
(`"pi": { "extensions": ["./src/pi/index.ts"] }`) resolves the entry file.
Edit `src/**`, quit and relaunch pi (extensions load at startup), and the
new source is live.

Verified 2026-09-07 (P1.M3.T5.S2): `pi -e` starts with zero extension-load
errors; sending a message containing a distinctive word (`quokkatestword`)
and then typing `#quok` in the input box shows a hapax result. The M3
widget path was additionally live-verified 2026-09-08 against the real
pi + split-editor stack (widget visibility; arrow/Escape/Tab key
handling — arrows and Escape are captured only once the list is
entered, with one-press boundary pass-through on an un-entered line
(spec 07, 2026-10 v2 model); Enter submits — spec 09 live-verification
technique).

#### jiti and the dictionary path

pi transpiles the extension with jiti 2.7.0 (TypeScript → CommonJS at load
time), where `import.meta` does not exist; native ESM hosts (vitest, a
future native-ESM pi) are the mirror case with no `__dirname`. The packed
dictionary is therefore resolved in `src/pi/paths.ts` (`resolveDictPath()`)
with the dual pattern:

```ts
const here = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
```

Never "simplify" this to `import.meta.url` only — it breaks under jiti.
`test/paths.test.ts` covers the native-ESM branch; the jiti branch is
exercised by every real `pi -e` load.

#### Loading without the flag: global symlink vs project-local

To auto-load hapax with plain `pi` (no flags), symlink the repo into the
global extensions directory:

```bash
ln -s /home/dustin/projects/hapax ~/.pi/agent/extensions/hapax
```

A project-local copy/symlink (`.pi/extensions/hapax` inside a project)
also works, but project-local extension directories are trust-gated: pi
prompts on first load, and untrusted projects never load local extensions.
The `-e` flag and the global symlink bypass the prompt. Remove the symlink
if you don't want hapax in every session.

#### Missing dictionary → graceful disable

If `dict/common-en.bin` is missing or corrupt, hapax degrades instead of
crashing: the first dictionary lookup fails, pi shows exactly one
`hapax: dictionary failed to load` error notify, and ingestion is disabled
permanently for that extension runtime — every later event degrades to a
no-op (no repeated toasts), while the empty provider stays registered so
pi's built-in completion is delegated, never hijacked. The same gate owns
the restore path: if the dictionary dies during `session_start` history
replay, the replay aborts immediately and none of the remaining history is
admitted — a resumed session starts from an empty store, never a
half-ingested one — and the live path stays disabled afterwards. pi itself
remains fully functional. Restore the file and restart pi to re-enable hapax.
(For testing, the `HAPAX_DICT=/path/to/file.bin` environment variable
overrides the resolved path.)

#### Checks

```bash
npm run check   # tsc --noEmit (strict)
npm test        # vitest --run
npm run bench   # PRD §09 perf-gate micro-benchmarks (synthetic fixtures; >3× budget regressions fail via the test/perf-gates.test.ts suite in `npm test`)
```

The `npm test` gate also runs the adversarial suites —
`test/adversarial-typing.test.ts` (prose no-menu, Tab-corruption editor
sims, chain-after-restore) and `test/adversarial-ingest.test.ts`
(realistic-key masking, bad-dict restore) — the
regression pins behind the guarantees above.

Performance gates (PRD §09; asserted at 3× budget headroom by
`test/perf-gates.test.ts`):

| Gate | Budget |
|---|---|
| 20k-candidate anchored-fuzzy query (first-char bucket + tiers + frequency sort + top 8) | < 1 ms p99 |
| Tier-0 anchorless fallback pass (full store; fires only when the anchored scan returns zero; also `#` loose-mode scans) | < 3 ms p99 |
| Dictionary load + full 20k-word lookup sweep | < 60 ms |
| Ingest of 800 KB session text | < 60 ms, yield every ≤ 64 KB |
| Steady-state heap delta (dict + store) | < 6 MB |

(The suite additionally pins two shipped-extras beyond the PRD gates: a
large-session bigram-ON restore bound and a 25k-distinct-word eviction
flood bound.)

`pi --check` does not exist — these three gates are the definition of green.
