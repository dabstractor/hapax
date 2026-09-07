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

- Corpus recorded: 2026-09 (P1.M4.T1.S1) against shipped `dict/common-en.bin`;
  re-labeled 2026-09 (bugfix 001_9e0f97150b68) after the REAL-corpus
  regeneration (hermitdave/FrequencyWords en_50k, HAPX v1, 48,802 entries)
  and the admission-band recalibration in score.ts
  (REJECT_COMMON_THRESHOLD=100, MID_FREQ_THRESHOLD=50 — measured by
  tools/calibrate-bands.mjs), with DEFAULT_CONFIG (trigger `#`, threshold 2,
  maxSuggestions 8) — no network, deterministic fixtures.
- Re-label after any change to: admission bands (score.ts 100/50),
  salience weights/taus, STORE_CAP/eviction, the fixture files, or the
  shipped dictionary artifact.
- **Calibrated-band reality**: with the real corpus the reject band
  (q ≥ 100 = top ~945 corpus ranks) is fully populated, so formerly
  admitted common prose words (`water` q=121, `morning` q=129, `more`
  q=150, `look` q=157, `long` q=138) are rejected at admission and never
  reach a menu; mid/rare words still admit (prose store: 66 keys).

## zendesk-lwlock.jsonl (item 1 — jargon picked up mid-session)

| fragment | mode | expected top-8 (in rank order) |
| --- | --- | --- |
| `ze` | threshold | `["Zendesk"]` — exactly one candidate, cased `Zendesk` |
| `#l` | trigger | `["lwlock","locks","logs","loses"]` — `lwlock` first; `look`/`long` reject-band (q ≥ 100) |
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
| `garde` | `["garden"]` | positive control: a menu DOES appear for stored words (garden q=86 → group 2) |
| `wate` | `[]` | `water` q=121 ≥ REJECT → rejected at admission, never stored |
| `kit` | `["kitchen"]` | |
| `mor` | `[]` | `morning` q=129 and `more` q=150 both reject-band → never stored |
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