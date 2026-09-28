# hapax

An autocomplete extension for the [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent, named for the [*hapax legomenon*](https://en.wikipedia.org/wiki/Hapax_legomenon) —
a word that occurs only once in a corpus, which is exactly what it harvests.
hapax watches user prompts and final agent output as they enter the context
window, extracts uncommon words, identifiers, and proper names, and offers
them as Tab completions in the prompt input via pi's built-in autocomplete
menu.

**Status: M2 (v2) — complete, verified 2026-09-07; P1 stabilization sweep
(adversarial-probe regression fixes) verified 2026-09-07; documentation
swept to the successor-chaining design (R6) 2026-09-08 and to the
bugfix-001 fixes (stock-context delegation, proper-noun relief, secret
hardening, Unicode boundaries, bigram-cap drain) 2026-09-08.** The M1
definition-of-done gauntlet — every gate, command, and measured number — is
recorded in [`docs/M1-DoD.md`](docs/M1-DoD.md), together with its "M2
Definition of Done" post-delta re-verification (zero-typed-char chain
offers, one-word-per-Tab invariant, `before_agent_start` reset); the
scripted zero-typing chain proof is the item-7 section of
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
  starts — no position gating, no special mode. The menu opens
  automatically while typing (identifier chars are registered as
  autocomplete triggers; `config.threshold` is retained but inert —
  pi-tui only requests at word starts) (`src/pi/provider.ts`).
- **Predictable, content-derived menu order** — shortest match first,
  then lexicographic; never reshuffled by session stats. Salience
  (recency, repetition, sticky user-typed, rarity) governs store
  retention/eviction only (`src/core/score.ts`, `src/core/query.ts`).
- **English words barely admit (2026-09 retighten)** — hapax completes
  identifiers, commit-hash-shaped tokens, and jargon: the
  dictionary-ABSENT class. Attested English rejects unless it sits in
  the rarest ~10% of the corpus (`provider`, `null`, `node` reject;
  `handoff` stays). The `rejectCommonness` knob
  (`~/.pi/agent/hapax.json` / `.pi/hapax.json`) tunes the band without a
  code edit; probe words with `node tools/calibrate-bands.mjs
  <words...>`. The conjugation guard additionally rejects inflections
  of attested stems (`deleted`, `lists`, `uploads`).
- **Enter always submits** — while a hapax word menu is open, Enter
  dismisses the menu and submits the prompt (Tab is the accept key).
  Composes with pi-vim/split-editor via a non-mutating forwarding
  proxy (`src/pi/editor.ts`).
- **Stock contexts are never preempted** — slash-command lines (`/re`),
  `@` mentions, and fragments inside quoted paths delegate verbatim to
  pi's own completion (`classifyStockContext` in `src/pi/provider.ts`,
  priority slash → mention → quoted-path → path): hapax answers nothing
  there, and Tab in those contexts behaves exactly as stock pi — it
  never opens the hapax menu (`test/provider-match.test.ts`).
- **Proper-noun relief — retired (2026-09)** — the relief that admitted
  capitalized attested words (`National`-class) is retired-in-place
  (ceiling == reject band): a live audit showed it admitting ~483
  capitalized common words (`echo`, `windows`, `failed`). Mechanism and
  calibration history live in `src/core/score.ts`; named-entity
  completion, if wanted back, is an allowlist design question
  (spec 04).
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
  (`src/pi/provider.ts`) — a top-3 successor index is built at ingest from
  strict-adjacency bigrams captured from raw text (`recordBigramRuns`,
  `src/core/store.ts`; the 10,000-key bigram cap drains to ≤ cap within
  the same `recordBigramRuns` call — looped 256-batch eviction — so no
  transient overshoot survives a message). Accepting a word via Tab arms its most-likely
  successor: at the next word start the successor is already the top
  result with ZERO typed characters — Tab inserts ONE word and re-arms, so
  `Acme` → `Zephyr` → `Noria` → `Inverter` walks with nothing
  typed between accepts. Inserted chain words use the candidate's display
  casing (most-recent-casing-wins), exactly like word completions. Typed characters filter the live successor list
  normally. Chaining resets on `before_agent_start` (each new user turn)
  and on disqualifying input — including the trigger char, which resets
  the chain to idle and honors trigger mode with the `#frag` prefix —
  and arms normally in resumed sessions —
  chain-after-restore probe in `test/adversarial-typing.test.ts` (machine:
  `test/chain.test.ts`; gating: `test/chaining-gating.test.ts`; index:
  `test/successors.test.ts`).

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
type  ze        → menu offers Zendesk → Tab inserts "Zendesk" (cased)
type  #l        → menu offers lwlock  → Tab inserts it
```

Chaining is the only multi-word mechanism — and every insertion is exactly
one word. Discuss the Acme Zephyr Noria Inverter product line, then:

```text
type  acme    → menu offers Acme → Tab inserts "Acme"
              → successor already the top result, ZERO typing
              → Tab inserts "Zephyr" → Tab → "Noria" → Tab → "Inverter"
```

Accepting a word arms its most-likely successor (`src/pi/provider.ts`):
at the very next word start the armed successor is offered as the top
result with nothing typed, each Tab inserts one word and re-arms, and
typed characters filter the live successor list normally. The chain resets
on `before_agent_start` (each new user turn) and on disqualifying input —
typing the trigger char mid-chain resets to idle and honors trigger mode
with the `#frag` prefix — and arms normally in resumed sessions: the walk
above is reachable after a history replay (regression-pinned in
`test/adversarial-typing.test.ts`).

Ordinary prose: typing is identical to stock pi — no key is captured, no
menu appears for common words, and Tab with no selection inserts a literal
Tab. Stock contexts are never preempted: slash-command lines (`/re`),
`@` mentions, and fragments inside quoted paths complete exactly as they
do in stock pi. The menu is strictly take-it-or-leave.

## Architecture

Two layers:

- `src/core/` — pure, agent-agnostic computation: `dictionary` (packed
  binary loader), `segment` (word segmentation + camelCase/snake_case
  splitting; word-boundary guards step by full code points — a non-ASCII,
  including astral-plane, letter adjacent to an ASCII run disqualifies
  the run), `shapeGate` (noise/secret rejection), `score` (admission +
  salience), `store` (per-session word candidates, 20k cap, plus the
  top-3 successor index fed by strict-adjacency bigrams captured from raw
  text at ingest — the 10,000-key bigram cap drains to ≤ cap within the
  same ingest call), `query` (prefix search + ranking). No
  pi imports.
- `src/pi/` — the pi adapter: `index` (extension factory + lifecycle),
  `ingest` (message handling), `provider` (autocomplete integration),
  `config`, `debug` (`/acwords`), `paths` (jiti-safe dictionary path).

Three paths connect them:

- **Ingest** (background, never on the keystroke path): `message_end`
  events feed a pipeline with a 300 ms trailing debounce and chunked
  processing (≤ 64 KB slices, event-loop yield between slices).
- **Query** (synchronous, every keystroke): match-state extraction →
  prefix search → salience sort, with zero awaits; Tab always resolves
  the live result.
- **Popup** (display only): a 100 ms paint debounce with flicker
  hysteresis — the menu never flickers and never appears with zero
  candidates.

```
   user prompt ─┐                       keystroke
 agent output ──┤                           │
                ▼                           ▼
      ┌──────────────────┐        ┌───────────────────┐
      │   src/pi/ingest  │        │  src/pi/provider  │
      │  message_end     │        │  sync query       │
      │  300 ms debounce │        │  100 ms paint     │
      │  ≤64 KB chunks   │        │  hysteresis       │
      └────────┬─────────┘        └─────────┬─────────┘
               ▼                            │
      ┌─────────────────────────────────────┴───┐
      │                 src/core                │
      │ segment → shapeGate → dictionary →      │
      │   score → store (cap 20,000) → query    │
      └─────────────────────────────────────────┘
```

Lifecycle: `session_start` loads config, builds a fresh store, registers
the provider, and (unless the session is genuinely new and empty) replays
existing session history through the same pipeline oldest→newest — a
resumed session's vocabulary is available again. `message_end` only
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

1. **Never hijack typing.** No key is ever captured, consumed, or altered
   except Tab while a suggestion is selected. The user's typing experience is
   unchanged; the menu is strictly take-it-or-leave. Tab only completes —
   the menu opens by typing only: the 2nd threshold char, the 1st char
   after the trigger char, or the zero-char chain offer. There is no
   manual open gesture. This is guaranteed, not
   best-effort: ordinary prose never opens a menu — the calibrated bands
   reject the top ~8,500 English words, including the PRD's named
   `context` example and every everyday word in its rank band
   (`test/shipped-dict.test.ts`), and prose-no-menu probes pin it
   (`test/adversarial-typing.test.ts`).
2. **Tab is never delayed by UI.** The top suggestion is computed
   synchronously on every keystroke; the popup may be debounced, but Tab
   always resolves the current top item immediately. Tab also never
   replaces the wrong span: the debounced popup's displayed set is
   invalidated whenever the input prefix moves (a character typed, or a
   fresh acceptance), so a stale suggestion set is never applied over
   shifted text — the rapid-Tab corruption class is regression-pinned by
   the editor sims in `test/adversarial-typing.test.ts`.
3. **The popup never flickers and never appears with zero candidates.**
4. **Everything stays in RAM.** No persistence, no telemetry, no network.
   The candidate store is per-session and dies at `session_shutdown`.

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
- **Tab may insert a top item the debounced popup hasn't painted yet.**
  The computation is deterministic and correct; treated as cosmetic.

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
harmless: admission gating uses the score bands, not exact rank order.

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

The admission bands in `src/core/score.ts` (`REJECT_COMMON_THRESHOLD = 50`,
`MID_FREQ_THRESHOLD = 20`) are calibrated against this artifact's quantized
rank distribution, and the calibration is load-bearing: `q ≥ 50` covers
the top ~8,501 of the 48,802 entries under this dialogue-register corpus —
everyday prose words rank far more frequent here than in the PRD's
web/books register, so the band must reach deep to keep the guarantee:
`the`, `with`, `this`, `them` … and the PRD's named reject example
`context` (q = 51), plus `data`, `code`, `lazy`, `ordinary`-class words,
are all rejected outright, so ordinary prose never opens a menu. (The
first BUG-001 recalibration, q ≥ 100, covered only the top ~945 ranks and
still admitted `context` — the 2026-09 Issue-1 retune closed that gap.) Band recalibration is a separate
concern from artifact regeneration: `node tools/calibrate-bands.mjs` prints
the rank↔word↔q table and re-verifies the constants against the artifact,
while `test/calibration.test.ts` (band edges, measured behavior) and
`test/shipped-dict.test.ts` (top words reject, prose no-menu) pin the
guarantee to the shipped binary.

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
| `triggerChar`    | string  | `"#"`   | one non-word, non-space character (`/^[^\w\s]$/`), or `""` to disable trigger mode entirely | prefix that opens the completion popup |
| `threshold`      | number  | `2`     | `1`–`3` (clamped)                                        | retained but inert — matching is effectively 1 char (see spec 07) |
| `maxSuggestions` | number  | `8`     | `1`–`20` (clamped)                                       | cap on candidates offered at once               |
| `rejectCommonness` | number | `12`  | `1`–`255` (clamped)                                      | dictionary quantile at/above which words reject (lower = stricter); probes: `node tools/calibrate-bands.mjs <words>` |
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

Salience weights, admission bands (100/50), shape-gate rules, the eviction
cap, debounce intervals, and popup timing are internal tuning constants —
never user-configurable. If better values are learned, they ship as new
constants, not new config fields.

### Debug

Set `"debug": true` in `~/.pi/agent/hapax.json` (or `.pi/hapax.json`) and
hapax registers a `/acwords` command when the session starts. With the
default `debug: false` the command does not exist. `/acwords` is a
read-only tuning instrument (PRD §09): it dumps, via a popup
notification, what the ingest pipeline actually admitted this session:

- the candidate store size against the 20,000-entry cap and the current
  message ordinal;
- the rank-group histogram (rare / mid / common entry counts);
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
and then typing `#quok` in the input box shows the hapax suggestion popup.

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
| 20k-candidate prefix query + rank + top 8 | < 1 ms p99 |
| Dictionary load + full 20k-word lookup sweep | < 60 ms |
| Ingest of 800 KB session text | < 60 ms, yield every ≤ 64 KB |
| Steady-state heap delta (dict + store) | < 6 MB |

`pi --check` does not exist — these three gates are the definition of green.