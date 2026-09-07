# Acceptance results — PRD §09 integration items 1–6 (P1.M4.T1.S1) · item 7 addendum (P2.M2.T3.S1)

Record of the scripted acceptance run for hapax M1, executed against the
REAL extension modules and the SHIPPED `dict/common-en.bin` with
DEFAULT_CONFIG (trigger `#`, threshold 2, maxSuggestions 8).

- Run date: **2026-09-07** (this workspace; vitest 4.1.11, pi 0.84.4, Node ≥ 22)
- Suite: `test/acceptance.test.ts` — **18/18 passing** (`npx vitest --run test/acceptance.test.ts`)
- Full gates: `npm run check` clean · `npm test` → 22 files, **406 passed / 1 skipped**
  (the one skip is the pre-existing gc-dependent `dictionary.test.ts` case, not part of this task)
- Corpus: `test/fixtures/sessions/{zendesk-lwlock,prose,large-100k}.jsonl` + labels in `expected.md`

Legend: **[scripted]** = asserted by a named test in `test/acceptance.test.ts`
(deterministic, runs on every `npm test`); **[manual]** = requires the live
input box / human eyes, with the exact procedure and pass criteria below.
Manual items are **pending a live `pi -e` run** — this scripted pass did not
execute them, per the automation reality that `pi -p` never opens the editor
(`ctx.mode === "print"`).

---

## Item 1 — session jargon completion (zendesk-lwlock.jsonl) — VERDICT: PASS (scripted)

| check | status | evidence |
| --- | --- | --- |
| Ingest fixture → non-empty store via real pipeline | PASS [scripted] | `acceptance item 1 … › ingests the fixture into a non-empty store` — 107 store keys, 133 admissions |
| `ze` (threshold mode) → top-1 exactly `Zendesk` (cased), sole candidate | PASS [scripted] | `…threshold "ze" → exactly one candidate, top-1 display "Zendesk"` (expected.md row matched) |
| `ze` through the real provider → menu item `Zendesk`, prefix `ze`, no delegation | PASS [scripted] | `…provider "ze" → hapax menu…` |
| `#l` (trigger mode) → top-1 exactly `lwlock`, prefix `#l`, ranked list per expected.md | PASS [scripted] | `…trigger "#l" → trigger mode, top-1 display "lwlock"` |
| Live: type `ze` → menu renders, Tab inserts cased `Zendesk`; `#l` → `lwlock` | PENDING [manual] | procedure below (item 1 live) |

## Item 2 — ordinary prose never hijacks (prose.jsonl) — VERDICT: PASS (scripted, with dict caveat)

| check | status | evidence |
| --- | --- | --- |
| All 22 two-char probes (`of on at be by do go he in it no or so to up we me my us if re men`) → zero candidates | PASS [scripted] | `acceptance item 2 … › ingests with the default config…` |
| Every probe → provider delegates with byte-identical args, live cache cleared | PASS [scripted] | `…every 2-char prose probe → zero candidates → delegates…` |
| Positive control: stored word still opens a menu (`wate` → `Water`) | PASS [scripted] | `…positive control: a stored word fragment DOES open a hapax menu` |
| Live: continuous prose keeps keystrokes verbatim; Tab with no selection = literal tab | PENDING [manual] | procedure below (item 2 live) |

**Caveat (recorded, not silently assumed):** the shipped `common-en.bin` is
built from the PROVISIONAL position-derived TSV (tools/gen-provisional-tsv.mjs),
whose ranks do not track real corpus frequency; the ≥220 "very common" reject
band is effectively unpopulated, so a prose session is NOT an empty store
(160 admitted keys here). The no-hijack contract is therefore pinned through
probes whose only in-session source words are shorter than the gate's 4-char
minimum. When a real corpus dictionary lands, re-run the corpus against
`expected.md` (designed for that re-label) before trusting precision@8.

## Item 3 — 100k-token session restore (large-100k.jsonl) — VERDICT: PASS (scripted)

| check | status | evidence |
| --- | --- | --- |
| 1561 message entries / ~161k model-tokens of text replay through `restoreFromHistory` + real pipeline | PASS [scripted] | both item-3 tests |
| Restore time < 300 ms (loose CI margin; PRD hard regression = > 3× budget) | PASS [scripted] | `…restoreFromHistory completes well under the 300 ms CI margin` |
| **Measured** restore wall-clock (validation run, 3 back-to-back runs) | — | **100.2 / 101.0 / 110.9 ms (median 101.0 ms)** |
| Completions available immediately afterwards; store stays bounded | PASS [scripted] | `rankMatches(store, "kes")` → `["kestrel"]` right after replay; size ≤ STORE_CAP 20 000 (628 keys) |
| Live: `pi -r` resume of the 100k session → completions within the first second | PENDING [manual] | procedure below (item 3 live) |

## Item 4 — compaction never resets the store — VERDICT: PASS (scripted halves)

Seam reality (src/pi/index.ts): hapax registers **no compaction handler** —
when pi compacts, history entries are replaced and hapax observes nothing;
the in-memory store survives by design (PRD §05 h2.32). Scripted halves:

| check | status | evidence |
| --- | --- | --- |
| Compaction-typed history entries never ingest on the restore path (A/B store equality) | PASS [scripted] | `acceptance item 4 … › compaction-typed history entries are skipped by restore…` |
| message_end after compaction: same store keeps prior admissions (`ze`→`Zendesk`, `lw`→`lwlock`), never resets, still grows | PASS [scripted] | `…message_end after compaction: store persists, prior word still completes` |
| Live: `/compact` in a long session → `/acwords` still lists prior words; they still complete | PENDING [manual] | procedure below (item 4 live) |

## Item 5 — fake API keys are never suggested (large-100k.jsonl) — VERDICT: PASS (scripted)

Fake literals (generated for fixtures; never real, never valid):
`sk-4f9a2c7e1b8d5a3f6e0c9b2d7f4a8e1c9d5b3a7f`,
`ghp_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e`.

| check | status | evidence |
| --- | --- | --- |
| `passesShape` rejects both directly (`{ok:false, reason:"secret"}`) | PASS [scripted] | `acceptance item 5 … › both fake credentials are secret-shaped` |
| Ingest counted both as secret rejections (`rejectedByGate.secret` ≥ 2) | PASS [scripted] | `…ingest counted both keys as secret rejections` |
| `sk` / `gh` / first-chars probes → key never in any top-8; keys never stored | PASS [scripted] | `…key prefixes never yield the key in any top-8` (all four probes `[]`) |
| Live: paste a fake key mid-session → never appears in any menu | PENDING [manual] | procedure below (item 5 live) |

## Item 6 — path/slash/@ never hijacked — VERDICT: PASS (scripted half) + PENDING (live parity)

| check | status | evidence |
| --- | --- | --- |
| Quoted path `read "./src/co` → NULL match state → delegate | PASS [scripted] | `acceptance item 6 … › quoted path…` (args[0..3] byte-identical, SENTINEL passthrough) |
| Slash `/re` → threshold state, zero candidates → delegate, args untouched | PASS [scripted] | `…slash command /re → delegates once, args untouched` |
| `@men` → threshold state, zero candidates → delegate, args untouched | PASS [scripted] | `…@mention @men → delegates once, args untouched` |
| Live parity: identical path/slash/@ behavior with and without `-e` | PENDING [manual] | procedure below (item 6 live) |

## Real-extension scripted check — VERDICT: PASS (executed)

`pi -p -e /home/dustin/projects/hapax --no-builtin-tools "say Zendesk lwlock"`

- Executed: **2026-09-07**, exit **0**, ~9.8 s, stdout `Zendesk lwlock`, **stderr empty (0 bytes)** — jiti load of the real extension, message_end wiring on the real runtime, no extension errors.
- Same check scripted as `acceptance — real extension loads under pi -p -e (network-gated) › pi -p -e loads the real extension and answers cleanly` (stdin-ignored spawn; auto-skips — never fails CI — when the environment is offline/unauthenticated).
- **Boundary (do not over-claim):** `pi -p` does NOT exercise the input-box
  autocomplete popup (ctx.mode === "print"). It proves load + clean run only.
  Menu rendering, Tab insertion, debounce feel are manual items below.
- The suite run also exercised load-in-vitest: full `npm test` green with this
  check included (18/18 acceptance tests).

## Item 7 — chained completion, zero typed characters (nrel.jsonl) — VERDICT: PASS (scripted; P2.M2.T3.S1)

New fixture `test/fixtures/sessions/nrel.jsonl` (10 messages, M2 evidence
corpus): "National Renewable Energy Laboratory" verbatim ×4 (chain bigrams
`national→renewable`, `renewable→energy`, `energy→laboratory` each count 4 —
deterministic top-1), plus standalone `NREL` occurrences (acronym stored as a
rare word, display `NREL`). Ingest through the real pipeline + shipped dict:
97 store keys, 216 stored phrases, 131 admissions, ordinal 10.

Provider amendments under test (src/pi/provider.ts): the PENDING OFFER —
`arm()` records a one-shot pending word, and the FIRST armed query whose
cursor is immediately adjacent to the accepted insertion (buffer text before
the cursor, lowercased, ends with the armed word — no trailing whitespace)
offers the unfiltered top successors at prefix `""`; plus the
`enablePhrases` gate on the armed branch and the arming intercept.

| check | status | evidence |
| --- | --- | --- |
| Fixture sanity: real ingest builds the strictly top-ranked successor chain (`renewable ×4` / `energy ×4` / `laboratory ×4`); NREL vocabulary admitted | PASS [scripted] | `acceptance item 7 — chained completion, zero typed characters (nrel.jsonl) › fixture sanity — real ingest builds…` |
| Zero-typing chain: `"natio"` menu → Tab `National` → immediate offer `[renewable, license, wind]` at prefix `""` (no typed characters) → Tab → `energy` → Tab → `laboratory`; buffer reads `National renewable energy laboratory`; hapax answers every query (no delegation) | PASS [scripted] | `…zero-typing chain — accept National → renewable → energy → laboratory…` |
| Pending offer is ONE-SHOT and adjacency-gated: word-less first query (`"National "`) keeps T2.S1 disarm + delegate; the consumed offer never re-fires | PASS [scripted] | `…pending offer is one-shot and adjacency-gated…` |
| Typed fragments after an arm still live-filter through the T2.S1 armed branch (no pending double-fire) | PASS [scripted] | `…typed fragments after an arm still filter through the T2.S1 armed branch…` |
| Reset (new user turn) clears the pending offer with the arm | PASS [scripted] | `…reset (new user turn) clears the pending offer with the arm` |
| Pending offer composes with the S3 display layer (prefix `""` on both sides → classified hapax → immediate paint) | PASS [scripted] | `…pending offer flows through the display layer's classification…` |
| `enablePhrases: false`: zero phrases, zero successors, no phrase items, NO constituent suppression, chain never arms, `ze` → `Zendesk` word-completion parity | PASS [scripted] | `test/phrase-gating.test.ts` — 5/5 (`enablePhrases: false — capture layer fully inert…`, incl. a phrases-ON contrast case) |
| `/acwords` M2 dump: phrases-vs-cap line, top-10 by phrase salience (deterministic byte-lex ties, `(repeat)` markers), successor sample; `(none)` for empty AND phrases-disabled stores | PASS [scripted] | `test/debug.test.ts › acwords dump — phrases + successor sample (P2.M2.T3.S1)` — 4 new cases, 16/16 total |
| M1 regression: items 1–6, never-hijack a–g, perf gates — all green, zero modifications | PASS [scripted] | `npm test` (see Reproduction); `provider.test.ts` / `perf-gates.test.ts` untouched |
| Live: discuss NREL a few turns, then `#n` → accept `National` → observe the chained menu with zero typing | PENDING [manual] | procedure below (item 7 live) |

**Design note (recorded, not silently assumed):** the arming accept happens
on the phrase-free prefix of the transcript (messages n01–n03) — the chain
bigrams recur ×4, so they are ADMITTED phrases and PRD §06 h3.8 constituent
suppression permanently shadows the bare word `National` once they land
(settled M2 semantics per P2.M2.T2.S1). This mirrors a real session (the
user accepts the word before the repeated phrase occurs) and reuses the
documented `armViaTab` seeding-order gotcha from `test/chain.test.ts`. The
pending-offer adjacency rule is likewise deliberately strict (no trailing
whitespace) so the word-less first query keeps T2.S1's disarm + delegate
behavior pinned by chain.test.ts case (8); the PRD's zero-additional-CHARACTERS
gate is exercised at the cursor position the item-7 script constructs
(nothing typed, not even a space).

**Baseline repair (one pre-existing failure, fixed in place):** the full
suite failed on the UNTOUCHED baseline before this task's first run —
`test/index.test.ts › "a valid dict loads lazily on first drain…"` failed
**4/4 consecutive full-suite runs** with `expected [ 'zephyr world' ] to
include 'zephyr'` (verified via `git stash` of this task's entire diff).
Root cause: the bigram `zephyr world` is fast-path-admitted (both
constituents rare in the provisional dictionary), so settled h3.8
suppression legitimately replaces the bare word in the `#zep` menu —
exactly the race P2.M2.T2.S1's PRP adjudicated ("the stale assertion is
wrong, not the code; fix (a) make the assertion phrase-aware — chosen"). That sanctioned one-line fix was absent from the tree; this task
re-applied it (accept either `zephyr` or `zephyr world` — both prove
"ingested candidates reach the provider"). No implementation change was
involved; idle-path ranking is untouched. After the repair: `npm test`
green on 3 consecutive runs (520 passed / 1 pre-existing gc-skip).

## Manual verification procedures (pending live `pi -e` run)

Run from any scratch dir with the extension loaded:
`cd /tmp && pi -e /home/dustin/projects/hapax` (add `--debug-config`-equivalent
debug by placing `{"debug":true}` in a trusted `.pi/hapax.json` to enable
`/acwords`; DEFAULT_CONFIG otherwise). The fixture transcripts can be typed
verbatim; each item lists its pass criteria.

- **Item 1 live**: discuss Zendesk/lwlock for a few turns (or paste turns 1–8
  of `zendesk-lwlock.jsonl`), then type `ze` → menu shows `Zendesk`; Tab
  inserts cased `Zendesk`. Type `#l` → menu shows `lwlock` first; Tab inserts
  `lwlock`. PASS = menu order matches expected.md rows.
- **Item 2 live**: type several sentences of ordinary prose (from
  `prose.jsonl`) character by character → no menu appears for short common
  fragments; keystrokes feel verbatim (no inserted text); Tab with no visible
  menu inserts a literal tab. PASS = never an unrequested menu.
- **Item 3 live**: start a session, paste ~50 turns of `large-100k.jsonl`
  content (or generate volume by chatting), quit, `pi -r` to resume → type a
  rare term prefix (`kes`, `verd`) within the first second → menu offers the
  term. PASS = completions work immediately after resume (PRD §09: < 100 ms
  restore budget; subjective here, objective number comes from item 3
  scripted).
- **Item 4 live**: in a long session run `/compact` → then `/acwords` →
  previously admitted words still listed; type one (e.g. `lwlock` prefix) →
  still completes. PASS = store survives compaction.
- **Item 5 live**: paste the two fake keys from expected.md → type `sk`, `gh`,
  and longer key fragments → no menu ever offers the key. PASS = key never
  suggested anywhere.
- **Item 6 live**: in the SAME buffer try `read "./src/co` (path completion
  from pi), `/re` at line start, `@men` — then repeat the exact keystrokes in
  a session started WITHOUT `-e`. PASS = behavior identical with and without
  the extension (byte-identical delegation is the scripted guarantee; this
  checks the live parity).
- **Item 7 live** (M2): in a fresh session discuss "National Renewable Energy
  Laboratory" for a few turns (paste sentences from `nrel.jsonl`), then type
  `natio` → Tab the `National` menu item → press Space and look: the menu
  should offer `renewable` (then `license`, `wind`) with NO fragment typed;
  Tab through `renewable` → `energy` → `laboratory`. PASS = each accept is
  followed by a successor menu with zero additional word characters typed,
  ending in `National renewable energy laboratory`. (Note: the chained offer
  appears on the first query after an accept whose cursor sits immediately
  after the accepted word — the scripted suite drives that position
  directly; pi's editor surfaces it on your next keystroke.)

## Hygiene (PRD DoD: no persistence, no stray files)

- `git status --porcelain` shows only intended additions/edits. M1
  (P1.M4.T1.S1): `test/acceptance.test.ts`, `test/fixtures/sessions/`
  (4 files), `test/helpers/session-fixture.ts`, `tools/gen-large-session.mjs`.
  M2 item 7 (P2.M2.T3.S1) adds `test/fixtures/sessions/nrel.jsonl`,
  `test/phrase-gating.test.ts`, appends to `test/acceptance.test.ts` /
  `test/debug.test.ts` / this ledger, and touches `src/pi/provider.ts`,
  `src/pi/index.ts` (comment only), `src/pi/debug.ts`, `README.md`
  (plan/ entries are orchestrator-owned; untouched by this task).
- No session/state files leaked outside `test/fixtures/sessions/`; nothing
  under `test/fixtures/` is gitignored.
- No hapax-written files anywhere: hapax is in-memory only; after the real
  `pi -p -e` run there are no hapax artifacts under `~/.pi` (pi's own session
  logs are pi's, not hapax's), and the repo tree gained no generated session
  files beyond the committed fixture corpus.

## Reproduction

```bash
npm run check
npm test                                        # full suite incl. items 1–7, gating, debug, perf gates
npx vitest --run test/acceptance.test.ts        # acceptance suite alone (items 1–6 + item 7)
npx vitest --run test/phrase-gating.test.ts     # enablePhrases:false gating suite (M2)
npx vitest --run test/debug.test.ts             # /acwords dump incl. phrases + successor sample (M2)
npx vitest --run test/chain.test.ts             # chain machine incl. T2.S1 case (8) — untouched, green
pi -p -e /home/dustin/projects/hapax --no-builtin-tools "say Zendesk lwlock"
node tools/gen-large-session.mjs /tmp/regen.jsonl && cmp /tmp/regen.jsonl test/fixtures/sessions/large-100k.jsonl   # determinism
```