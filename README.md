# hapax

An autocomplete extension for the [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent, named for the [*hapax legomenon*](https://en.wikipedia.org/wiki/Hapax_legomenon) —
a word that occurs only once in a corpus, which is exactly what it harvests.
hapax watches user prompts and final agent output as they enter the context
window, extracts uncommon words, identifiers, and proper names, and offers
them as Tab completions in the prompt input via pi's built-in autocomplete
menu.

**Status: M2 (v2) — complete, verified 2026-09-07.** The M1
definition-of-done gauntlet — every gate, command, and measured number — is
recorded in [`docs/M1-DoD.md`](docs/M1-DoD.md); the M2 evidence sweep
(zero-typing chained completion, `enablePhrases` gating, `/acwords` phrase
dump, M1 regression) is the item-7 section of
[`test/fixtures/sessions/RESULTS.md`](test/fixtures/sessions/RESULTS.md)
("Item 7 — chained completion, zero typed characters — VERDICT: PASS").

## Features

- **Trigger-char completion from the 1st character** (default `#`) — `#ze`
  looks up from the first character after `#`; a bare `#` lists the
  session's top candidates (`src/pi/provider.ts`).
- **Threshold matching from N typed characters**, anywhere a word starts
  (default 2, configurable 1–3) — no position gating, no special mode
  (`src/pi/provider.ts`).
- **Session salience ranking** — recency, repetition, and a sticky
  user-typed boost decide what reaches the menu and in what order
  (`src/core/score.ts`).
- **Case-preserving insertion** — type `nrel`, get `NREL`: matching is
  case-insensitive, insertion uses the casing last seen in-session.
- **Secrets never suggested** — an always-on shape gate rejects
  key-shaped strings (API keys, tokens, JWT bodies, long hex) before they
  are ever stored (`src/core/shapeGate.ts`).
- **Zero persistence, zero telemetry, zero network** — everything lives in
  RAM and dies at `session_shutdown` (`src/pi/index.ts`).
- **Phrase completions** (`src/core/store.ts`, `src/core/query.ts`) —
  2- and 3-word phrases join the menu when the phrase occurs **≥ 2 times
  in-session** (repetition — confirmed and sticky), or on **first sight
  when every constituent word is rare** (fast path — unconfirmed, and
  demoted again unless repeated within **40 messages**). While a phrase is
  a candidate, its constituent words are suppressed from word-only
  completion so the phrase wins.
- **Chained Tab completion — zero additional typing**
  (`src/pi/provider.ts`) — accepting a word via Tab arms its most-likely
  successor (top-3 successor index built at ingest, `src/core/store.ts`);
  the very next Tab completes that successor with no additional typing —
  `National` → `renewable` → `energy` → `laboratory` (scripted proof:
  item 7 of `test/fixtures/sessions/RESULTS.md`). Chaining resets on
  `before_agent_start` and on disqualifying input. Caveat: once a phrase
  headed by that word is admitted, the phrase completes instead (phrase
  salience outranks the bare word, and phrase acceptances never arm the
  chain) — chain-arming applies to words that do not head an admitted
  phrase.

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

Chained completion needs no typing at all once a phrase chain exists in the
session — discuss the National Renewable Energy Laboratory, then:

```text
type  natio            → menu offers National → Tab inserts "National"
     (menu stays up)   → top offer renewable → Tab (no typing!)
                        → energy → Tab → laboratory — four words, four Tabs
```

Once admitted (by repetition or an all-rare first sight), phrases appear in
the same menu as words. Note that this narrows the zero-typing chain window
above: from the first line that contains `National Renewable Energy`, the
`natio` menu offers the phrases (phrase salience = 1.2 × the sum of its
constituents, which always outranks the prefix word — the bare `National`
item is suppressed), and Tab then inserts the whole phrase in one step.
The `National → renewable → energy → …` walk is the behavior in the window
BEFORE the phrase's first admission (and in phrase-free sessions, or with
`enablePhrases: false`); once the phrase is admitted, chain-arming applies
to words that do not head an admitted phrase.

Ordinary prose: typing is identical to stock pi — no key is captured, no
menu appears for common words, and Tab with no selection inserts a literal
Tab. The menu is strictly take-it-or-leave.

## Architecture

Two layers:

- `src/core/` — pure, agent-agnostic computation: `dictionary` (packed
  binary loader), `segment` (word segmentation + camelCase/snake_case
  splitting), `shapeGate` (noise/secret rejection), `score` (admission +
  salience), `store` (per-session candidates, 20k cap, plus the M2 phrase
  store and top-3 successor index), `query` (prefix search + ranking). No
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
stays registered, delegating all completion to pi — see
[Missing dictionary → graceful disable](#missing-dictionary--graceful-disable).

## Design invariants

1. **Never hijack typing.** No key is ever captured, consumed, or altered
   except Tab while a suggestion is selected. The user's typing experience is
   unchanged; the menu is strictly take-it-or-leave.
2. **Tab is never delayed by UI.** The top suggestion is computed
   synchronously on every keystroke; the popup may be debounced, but Tab
   always resolves the current top item immediately.
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
50,927 entries, ~1.2 MB). It is loaded at runtime by
`src/core/dictionary.ts` (`loadDictionary()`).

**Status: PROVISIONAL.** This artifact was generated from a local system word
list (`/usr/share/dict/cracklib-small`) with synthetic rank ordering (shorter
words rank higher; counts are positional, not corpus-derived). It does **not**
reflect real word frequencies and will be replaced by a corpus-derived build.

#### Where real frequency TSVs come from

Corpus preparation is out of scope for this repo — the build script is
corpus-agnostic and accepts any unigram list. For a real build, source
`word<TAB>count` TSVs (UTF-8, one word per line, counts as plain integers)
from e.g.:

- [Google Books Ngrams](https://en.wikipedia.org/wiki/Google_Books_Ngram_Grammar)
  (English unigrams), or
- [`wordfreq`](https://github.com/rspeer/wordfreq)-derived per-language
  frequency lists.

Cross-check the list against an LLM tokenizer vocabulary (o200k / cl100k) so
tokenization frequency informs ranking: words the tokenizer splits should not
outrank common whole words.

#### Rebuilding

```bash
node tools/build-dict.mjs --out dict/common-en.bin input1.tsv [input2.tsv ...]
```

Merge → filter (`^[a-z][a-z0-9_-]{1,31}$`) → sort by count desc → cap at
70,000 entries → quantize to u8 → emit. The script prints a per-section size
summary and self-verifies the written file; exit 0 with
`verified: N/N entries OK, no duplicate keys` means the artifact is safe to
commit.

Provisional fallback (regenerate the shipped artifact from a system word
list):

```bash
node tools/gen-provisional-tsv.mjs /usr/share/dict/words > /tmp/prov.tsv
node tools/build-dict.mjs --out dict/common-en.bin /tmp/prov.tsv
```

`gen-provisional-tsv.mjs` is stdlib-only and deterministic: same word list →
byte-identical TSV → byte-identical binary.

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
| `threshold`      | number  | `2`     | `1`–`3` (clamped)                                        | chars before threshold matching                 |
| `maxSuggestions` | number  | `8`     | `1`–`20` (clamped)                                       | cap on candidates offered at once               |
| `enablePhrases`  | boolean | `true`  | `true` / `false`                                         | `true` enables phrase completions and Tab-chained successor completion; `false` removes the entire phrase layer — no phrase items, no constituent suppression, no successor capture or chaining — while word completion is unchanged |
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

Salience weights, admission bands (220/120), shape-gate rules, the eviction
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
- the phrase layer (M2): the stored-phrase count against the 10,000-phrase
  cap, the top 10 phrases by salience — display form, occurrence count
  (`×N`), and a `(repeat)` marker on repetition-admitted phrases (seen ≥ 2
  times) — plus one successor-index sample: the top successors of the top
  phrase's first word, rendered `national → renewable ×4, license ×1`.
  This sample is the tuning signal for the Tab-chained completion offers.

The dump contains stored words and counters only — it never prints
message bodies. A session with no stored phrases (nothing ingested yet,
or `enablePhrases: false` in the config) renders `phrases: (none)` and
omits the successor sample.

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
pi's built-in completion is delegated, never hijacked. pi itself remains
fully functional. Restore the file and restart pi to re-enable hapax.
(For testing, the `HAPAX_DICT=/path/to/file.bin` environment variable
overrides the resolved path.)

#### Checks

```bash
npm run check   # tsc --noEmit (strict)
npm test        # vitest --run
npm run bench   # PRD §09 perf-gate micro-benchmarks (synthetic fixtures; >3× budget regressions fail via the test/perf-gates.test.ts suite in `npm test`)
```

Performance gates (PRD §09; asserted at 3× budget headroom by
`test/perf-gates.test.ts`):

| Gate | Budget |
|---|---|
| 20k-candidate prefix query + rank + top 8 | < 1 ms p99 |
| Dictionary load + full 20k-word lookup sweep | < 60 ms |
| Ingest of 800 KB session text | < 60 ms, yield every ≤ 64 KB |
| Steady-state heap delta (dict + store) | < 6 MB |

`pi --check` does not exist — these three gates are the definition of green.