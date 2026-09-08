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
| Positive control: stored word still opens a menu (`post` → `posts`; re-labeled 2026-09 from the pre-retune `wate` → `Water`, which now correctly rejects) | PASS [scripted] | `…positive control: a stored word fragment DOES open a hapax menu` |
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

## Item 7 — chained completion, zero typed characters (zephyr-chain.jsonl) — VERDICT: PASS (scripted)

**CORRECTED 2026-09-08.** An earlier version of this section documented the
REMOVED phrase-era design — "216 stored phrases", a one-shot "pending offer"
mechanism, the `enablePhrases` gate, PRD §06 h3.8 constituent suppression,
and `test/phrase-gating.test.ts` (a file that no longer exists; its successor
is `test/chaining-gating.test.ts`). The phrase layer was deleted (PRD 002
delta R1: "no phrase admission/sticky/demotion lifecycle"); the live
implementation is the ARMED-BRANCH CHAIN MACHINE in `src/pi/provider.ts`
(`createChainMachine` + the armed getSuggestions branch + the
applyCompletion arming intercept classified through `CHAIN_KEY_PREFIX`),
gated by `enableChaining` (PRD §08 h2.46). This section now records the
CURRENT machinery; the stale text was evidence-grade misleading (2026-09
validation Issue 3).

Fixture `test/fixtures/sessions/zephyr-chain.jsonl` (10 messages; renamed
from `nrel.jsonl` and rethemed in the same pass): the adjacency run
"Acme Zephyr Noria Inverter" verbatim ×4 (chain bigrams `acme→zephyr`,
`zephyr→noria`, `noria→inverter` each count 4 — deterministic top-1), plus
"Acme turbine" ×1 (secondary successor) and standalone `AZNI` occurrences
(acronym stored as a rare word, display `AZNI`). The walk words are
dictionary-absent (`acme`, `noria`, `inverter`) or q ≤ 26 (`zephyr`,
`turbine`) so the journey is IMMUNE to admission-band retunes — the former
National/renewable/energy/laboratory walk words all moved into the reject
band (q ≥ 50) with the 2026-09 Issue-1 recalibration, since on this
dialogue-register corpus any band rejecting `context` (q=51) necessarily
rejects `national` (q=90) too.

Chain items insert the successor's CANDIDATE DISPLAY CASING ("Zephyr", not
"zephyr") per PRD §07/§04 — the 2026-09 Issue-2 fix; arming itself stays
lowercase (the successor index is lowercase-keyed).

| check | status | evidence |
| --- | --- | --- |
| Fixture sanity: real ingest builds the strictly top-ranked successor chain (`zephyr ×4` / `noria ×4` / `inverter ×4` under `acme`/`zephyr`/`noria`, plus `turbine ×1`); walk vocabulary admitted | PASS [scripted] | `acceptance item 7 — chained completion, zero typed characters (zephyr-chain.jsonl) › fixture sanity — real ingest builds…` |
| Zero-typing chain: `"acme"` menu → Tab `Acme` → immediate offer `[Zephyr, turbine]` at prefix `""` (display-cased, zero typed characters) → Tab → `Noria` → Tab → `Inverter`; buffer reads `Acme Zephyr Noria Inverter`; hapax answers every query (no delegation) | PASS [scripted] | `…zero-typing chain — Acme → space → top successor → Tab → Noria → Tab → Inverter…` |
| Word start after an arm offers the chain; word-less non-start (punctuation) still disarms + delegates on the same keystroke | PASS [scripted] | `…word start after an arm offers the chain…` |
| Typed fragments after an arm live-filter through the armed branch at chain threshold 0 (never config.threshold) | PASS [scripted] | `…typed fragments after an arm still filter through the armed branch…` |
| Reset (new user turn, `before_agent_start`) clears the arm | PASS [scripted] | `…reset (new user turn) clears the arm` |
| Word-start offer composes with the S3 display layer (prefix `""` on both sides → classified hapax → immediate paint) | PASS [scripted] | `…word-start offer flows through the display layer's classification…` |
| `enableChaining: false`: the armed branch never runs, Tab-accept never arms, forced queries cannot resurrect the arm, zero successors captured, word-completion parity | PASS [scripted] | `test/chaining-gating.test.ts` — 6/6 |
| Replay/resume route: full-fixture restore then the same arm → walk (the PRD §09 item-7 route, h2.54); hop-by-hop assertions each name the broken link | PASS [scripted] | `test/chain.test.ts › replayed-store arming end-to-end…` (2/2) and `test/adversarial-typing.test.ts › adversarial Probe C` (chain post-restore) |
| One-word invariant on every offer (no multi-word item is ever published) | PASS [scripted] | `expectSingleWordItems` on every chain offer in the suites above |
| M1 regression: items 1–6, never-hijack a–g, perf gates — all green | PASS [scripted] | `npm test` (see Reproduction) |
| Live: discuss the Acme Zephyr Noria Inverter stack a few turns, then `acme` → accept `Acme` → observe the chained menu with zero typing | PENDING [manual] | procedure below (item 7 live) |

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
- **Item 7 live** (M2): in a fresh session discuss the "Acme Zephyr Noria
  Inverter" stack for a few turns (paste sentences from
  `zephyr-chain.jsonl`), then type `acme` → Tab the `Acme` menu item →
  press Space and look: the menu should offer `Zephyr` (then `turbine`) in
  display casing with NO fragment typed; Tab through `Zephyr` → `Noria` →
  `Inverter`. PASS = each accept is followed by a successor menu with zero
  additional word characters typed, ending in `Acme Zephyr Noria Inverter`.
  (The armed branch answers at every word start for the whole chain
  duration; a new user turn or disqualifying input resets it.)

## Hygiene (PRD DoD: no persistence, no stray files)

- `git status --porcelain` shows only intended additions/edits. M1
  (P1.M4.T1.S1): `test/acceptance.test.ts`, `test/fixtures/sessions/`
  (4 files), `test/helpers/session-fixture.ts`, `tools/gen-large-session.mjs`.
  M2 item 7 (P2.M2.T3.S1) added `test/fixtures/sessions/nrel.jsonl`,
  `test/phrase-gating.test.ts` (both since superseded — see the Item 7
  correction note above; the fixture is now `zephyr-chain.jsonl`, the
  gating suite is `test/chaining-gating.test.ts`), and touched
  `src/pi/provider.ts`, `src/pi/debug.ts`, `README.md`
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
npx vitest --run test/chaining-gating.test.ts   # enableChaining:false gating suite (M2)
npx vitest --run test/debug.test.ts             # /acwords dump incl. successor sample (M2)
npx vitest --run test/chain.test.ts             # chain machine incl. replayed-store arming end-to-end (M2)
pi -p -e /home/dustin/projects/hapax --no-builtin-tools "say Zendesk lwlock"
node tools/gen-large-session.mjs /tmp/regen.jsonl && cmp /tmp/regen.jsonl test/fixtures/sessions/large-100k.jsonl   # determinism
```