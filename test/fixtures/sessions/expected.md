# Expected completions — session fixture corpus (PRD §09 tuning protocol)

Hand labels for the three synthetic session transcripts in this directory,
used for precision@8 measurement during admission/salience tuning
(PRD §09) and consumed as documentation by `test/acceptance.test.ts`.

Each label is `fixture → fragment → expected top-8` where the fragment is
what a user types (threshold mode: bare fragment; trigger mode: `#` +
fragment against the default trigger char `#`) and the expected set is the
ranked top-8 `display` strings hapax's menu should show, in order.
Label casing matters: the menu shows the stored display casing verbatim
(most recent sighting wins).

- Corpus recorded: 2026-09 (P1.M4.T1.S1) against shipped `dict/common-en.bin`
  (HAPX v1, 50,927 entries) with DEFAULT_CONFIG (trigger `#`, threshold 2,
  maxSuggestions 8) — no network, deterministic fixtures.
- Re-label after any change to: admission bands (score.ts 120/220),
  salience weights/taus, STORE_CAP/eviction, the fixture files, or the
  shipped dictionary artifact.
- **Provisional-dictionary caveat**: the shipped `common-en.bin` is built
  from the PROVISIONAL position-derived TSV (tools/gen-provisional-tsv.mjs),
  so its quantized ranks do not reflect real corpus frequencies and the
  ≥220 "very common" reject band is essentially unpopulated. Admission
  therefore keeps most dictionary words (only length/entropy/secret/consonant
  gate rules reject). The `prose.jsonl` labels below reflect that reality:
  an ordinary-prose session DOES admit its longer words, and the no-hijack
  guarantee is exercised through fragments whose only in-session source
  words are shorter than the gate's 4-char minimum. When a real corpus
  dictionary lands, re-run the corpus and re-label before trusting
  precision@8 numbers.

## zendesk-lwlock.jsonl (item 1 — jargon picked up mid-session)

| fragment | mode | expected top-8 (in rank order) |
| --- | --- | --- |
| `ze` | threshold | `["Zendesk"]` — exactly one candidate, cased `Zendesk` |
| `#l` | trigger | `["lwlock","locks","look","logs","long","loses"]` — `lwlock` first |
| `we` | threshold | `["webhook"]` |
| `pos` | threshold | `["Postgres"]` |
| `fix` | threshold | `["fixRoundingError"]` (camelCase token, stored casing) |
| `ba` | threshold | `["batch","backlog","batches"]` |
| `con` | threshold | `["contention"]` |
| `sy` | threshold | `["sync","symptom"]` |
| `dig` | threshold | `["digest"]` |
| `men` | threshold | `[]` (no candidate → provider delegates) |

## prose.jsonl (item 2 — ordinary prose, no jargon)

Stored keys come only from this fixture's ≥4-char words. The item-2 probe
fragments below are 2-char prefixes of words that OCCUR in the transcript,
but every such source word is shorter than the shape gate's 4-char minimum,
so nothing is stored under those prefixes → zero candidates → the provider
must delegate (never a menu).

| fragment | expected top-8 | note |
| --- | --- | --- |
| `of`,`on`,`at`,`be`,`by`,`do`,`go`,`he`,`in`,`it`,`no`,`or`,`so`,`to`,`up`,`we`,`me`,`my`,`us`,`if` | `[]` for every one | source words are all <4 chars → gate-rejected at ingest |
| `re` | `[]` | item 6 slash-command probe: no stored key starts `re` |
| `men` | `[]` | item 6 @mention probe: no stored key starts `men` |
| `wate` | `["Water"]` | positive control: a menu DOES appear for stored words |
| `kit` | `["kitchen"]` | |
| `mor` | `["morning","more"]` | |
| `wind` | `["window","wind"]` | |
| `fresh` | `["fresh"]` | |
| `bread` | `["bread"]` | |
| `gar` | `["garden"]` | |
| `fenc` | `["fence","Fences"]` | display casing = most recent sighting |

## large-100k.jsonl (items 3 + 5 — restore performance, secrets never suggested)

Deterministic seeded corpus (mulberry32 seed 42, tools/gen-large-session.mjs);
labels stable across regenerations. Rare terms recur throughout; numbered
service terms (`vertex000`…`ledger039`) spread vocabulary across the whole
history.

| fragment | expected top-8 (in rank order) | note |
| --- | --- | --- |
| `kes` | `["kestrel"]` | |
| `kest` | `["kestrel"]` | |
| `verd` | `["Verdigris"]` | display casing = most recent sighting |
| `vertex0` | `["vertex028","vertex025","vertex018","vertex013","vertex017","vertex037","vertex010","vertex006"]` | recency-ranked numbered terms |
| `sable` | `["sable"]` | |
| `zeph` | `["zephyr"]` | |
| `tund` | `["tundra"]` | |
| `sk` | `[]` | never a menu: the fake `sk-…` key must never surface |
| `gh` | `[]` | never a menu: the fake `ghp_…` token must never surface |
| `sk-4f9` | `[]` | key's first 6 chars — `[]`, key absent from the store |
| `ghp_9f8` | `[]` | token's first 7 chars — `[]`, token absent from the store |

The fake credentials pasted near the transcript's end (generated literals,
never real):

```
sk-4f9a2c7e1b8d5a3f6e0c9b2d7f4a8e1c9d5b3a7f
ghp_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e
```

Both must be shape-gate-REJECTED on ingest (`passesShape` → `{ok:false,
reason:"secret"}`; pipeline stats `rejectedByGate.secret` +2) and must
never appear in any top-8 for any prefix.