# Research notes — bugfix 001_0f4b641cf9ce P1.M2.T1.S2: re-run tuning protocol

## Upstream contract (P1.M2.T1.S1, implementing in parallel — assume delivered)
- `src/core/score.ts`: `export const PROPER_NOUN_ADMIT_CEILING = 120 as const` + relief branch in `admit()`:
  reject → group 2 when `!draft.isSubword && draft.properName && q !== null && q < PROPER_NOUN_ADMIT_CEILING`.
  Ceiling constraint interval: **(94, 156]** — must admit national(90)/energy(94)/laboratory(57), reject The(240)/This(197)/With(179)/Them(156).
- S1 already runs `node tools/calibrate-bands.mjs` (exit 0) and keeps calibration.test.ts green; S1's unit tests live in test/score.test.ts.
- properName comes from segment.ts expandCandidates: first char of display uppercase AT EXTRACTION — i.e., **sentence-initial capitalized common words also carry properName=true**. This is the tuning risk this task measures.

## The A/B risk (the heart of this item)
- prose.jsonl contains sentence-initial capitalized prose words. With the relief, any capitalized occurrence of a q<120 word (Water q=121 — above 120, safe at ceiling 120; but `Garden` q=86, `Kitchen` q=96, `Window` q=99, `Fresh` q=93, `Bread` q=84, `Fences` q=41) admits at group 2 when capitalized in the transcript.
- expected.md (item 2 prose labels) pins: `wate/kit/mor/wind/fresh/bread/gar` → `[]` (delegate), `post` → ["posts"], `fenc` → ["Fences"]. Any capitalized occurrence of garden/kitchen/window/fresh/bread in prose.jsonl that now admits will flip a `[]` label to a menu → **precision@8 regression** → ceiling must be raised above those q values (e.g. ceiling must be ≤ min(capitalized-offending-q) ... actually ceiling must be < the smallest offending q to exclude it) while staying in (94, 156]. If garden(86)/bread(84) appear capitalized, no ceiling in (94,156] excludes them → then expected.md must be re-labeled (expected.md's own header sanctions re-labeling after band changes) — measure and decide; record in run notes.
- expected.md header: "Re-label after any change to: admission bands (score.ts 50/20) ..." — the relief IS an admission-band change; re-labeling is the documented fallback, but preference order per item contract: adjust ceiling within (94,156] FIRST, one constant only, re-run; re-label only if impossible.

## Test assets verified
- test/calibration.test.ts: COMMON_PROBES = ["with","this","them","that","have","would"] (line 64), all lowercase — relief-immune. `posts/thin/firs` pin (line 164): posts q=47 mid-band menu, thin q=76 / first q=144 rejected — lowercase probes, relief-immune. Suite must stay green UNTOUCHED; if it fails, the relief leaked (properName gating bug) → report upstream, don't patch the test.
- test/acceptance.test.ts: ingestFixture helper; prose probes assert SENTINEL delegation identity (result === SENTINEL, current.getSuggestions calledOnce); SHORT_PROBES from expected.md (line ~192); item-2 describe at 188. These ARE the scripted precision@8 vs expected.md.
- test/adversarial-typing.test.ts: "adversarial Probe A — prose no-menu" (line 262) asserts delegation SENTINEL + `provider.__hapaxLive()` null — the exact sentinel-identity + live-null checks this task replays.
- Fixtures: test/fixtures/sessions/{prose,zendesk-lwlock,zephyr-chain,large-100k}.jsonl + expected.md + RESULTS.md.
- Delegation harness: mockCurrent(SENTINEL) pattern; provider created via createHapaxProvider(store, cfg(), current); `__hapaxLive()` accessor on the hapax provider.

## Tuning protocol (spec/09, quoted in spec-acceptance-map.md L14)
"change one constant, run the acceptance suite, A/B against a fixed 3-session corpus fixture (test/fixtures/sessions/) checking precision@8." One constant only = PROPER_NOUN_ADMIT_CEILING.

## Docs mode A (from item contract)
Append measured calibration numbers (probe words, q values, delegation verdicts, final ceiling, A/B precision@8) to the score.ts JSDoc note P1.M2.T1.S1 added. spec/*.md and expected.md are label documents — expected.md may be re-labeled ONLY as documented fallback.

## Commands
- Targeted: `npx vitest --run test/calibration.test.ts test/shipped-dict.test.ts test/adversarial-ingest.test.ts test/adversarial-typing.test.ts test/score.test.ts test/acceptance.test.ts`
- Full: `npm run check && npm test`; `node tools/calibrate-bands.mjs` (exit 0).
- Shipped dict lookups: `loadDictionary(resolveDictPath('common-en.bin')).lookup(word)` via a scratch vitest `it.only`-style probe or node script — but do NOT commit scratch probes.
