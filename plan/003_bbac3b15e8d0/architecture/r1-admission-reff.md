# R1 — R_eff length-conditioned admission curve (delta PRD 003, P1.M1.T1)

Research report, read-only. All references verified against the working tree.

## 1. Current admission path in `src/core/score.ts`

Exported constants (all `as const`, baked per PRD §08):

| Constant | Value | Line (approx) | Role |
|---|---|---|---|
| `REJECT_COMMON_THRESHOLD` | 12 | ~L91 | reject at/above this q |
| `MID_FREQ_THRESHOLD` | 20 | ~L112 | table group-2 band start — DEAD at the table (every q ≥ 12 rejects first); live only in guard tier-2 and kept for the clamp's saturation shape |
| `PROPER_NOUN_ADMIT_CEILING` | 12 | ~L134 | retired-in-place relief ceiling |
| `admit`, `AdmissionOptions`, `AdmissionResult`, `salience`, `evictionScore`, `compareCandidates` | — | | |

`RankGroup` is defined in `src/core/types.ts:17` as `export type RankGroup = 0 | 1 | 2;` (a type alias, not an enum). In practice: group 0 live (absent), group 1 live (q < 12), group 2 dead at the table (retired 2026-09) but still producible by the subword clamp (`Math.min(2, Math.max(result, parentGroup + 1))`) and pinned by tests (calibration.test.ts asserts the band's emptiness only in calibrate-bands; score.test.ts pins clamp→2).

Quantile q: `dictionary.lookup(draft.key)` — `src/core/dictionary.ts` `lookup(word: string): number | null` inside `loadDictionary`; `null` means absent (miss, >64 UTF-8 bytes, or corrupt table). 0 = rarest, 255 = most common.

Exact branch (score.ts, `admit()`):

```ts
const rejectAt = opts.rejectCommonness ?? REJECT_COMMON_THRESHOLD;
const q = dictionary.lookup(draft.key);
let result: AdmissionResult;
if (q === null) result = 0;
else if (q >= rejectAt) result = "reject";
else if (q >= MID_FREQ_THRESHOLD) result = 2;   // dead row (12 ≤ q < 20 impossible)
else result = 1;
```

Then relief check → guard → `if (result === "reject") return result;` → subword clamp → return.

## 2. Conjugation guard

Helpers: `INFLECTION_SUFFIXES = ["s","es","ed","d","ing","ly"]` and `inflectionStems(word)` (one-level strip, stems <3 chars dropped, e-restoration for -ed/-ing, doubled-consonant undo). Guard body (score.ts ~L269–283):

```ts
if (result !== "reject" && !draft.properName) {
  for (const stem of inflectionStems(draft.key)) {
    const qs = dictionary.lookup(stem);
    if (qs === null) continue;
    if (qs >= rejectAt || (q === null && qs >= MID_FREQ_THRESHOLD)) {
      result = "reject";
      break;
    }
  }
}
```

Two tiers TODAY, both against FLAT thresholds:
- Tier 1: stem q ≥ `rejectAt` (knob-resolved flat `REJECT_COMMON_THRESHOLD` = 12) → reject, any word q.
- Tier 2: word absent (`q === null`) AND stem q ≥ `MID_FREQ_THRESHOLD` (flat 20) → reject.

There is no "MID/20-style constant" beyond `MID_FREQ_THRESHOLD` itself (value 20); its only live usages are this tier-2 comparison and the dead table row (plus the sweep/population prints in calibrate-bands.mjs and test/config asserts of the exported value). `rejectCommonness` overrides tier-1 only ("The rejectCommonness knob governs the stem comparisons too" — score.ts L267 comment; pinned by test/score.test.ts:163-175). Subwords are guarded too; `properName` drafts skip the guard.

## 3. Proper-noun relief remnants (retired-in-place)

Lives in `admit()` between the table and the guard: if `result === "reject" && !draft.isSubword && draft.properName && q !== null && q < PROPER_NOUN_ADMIT_CEILING` → `result = 2`. Ceiling semantics: `PROPER_NOUN_ADMIT_CEILING = 12` == `REJECT_COMMON_THRESHOLD` (floor), so ceiling == floor == 12 — the relief can never fire at the table today (a word with q ≥ 12 cannot also have q < 12). Pure dead code kept deliberately ("RETIRED-IN-PLACE"; restoring is a one-constant change). Under R_eff: relief would need `q >= R_eff(len) && q < 12`, and R_eff(len) ≥ R = 12 everywhere, so it stays unreachable for any knob value ≥ the strict-< gap — no change needed; note the delta PRD keeps it dead.

## 4. `rejectCommonness` knob flow

- Schema: `src/pi/config.ts` — `HapaxConfig.rejectCommonness: number` (L64), `DEFAULT_CONFIG.rejectCommonness: REJECT_COMMON_THRESHOLD` (L91, baked default), parsing `clampNumber(v, 1, 255)` with a repair-to-default warning (L239–246).
- Flow: `src/pi/index.ts:167` passes `rejectCommonness: config.rejectCommonness` into `new IngestPipeline({...})` → `IngestPipeline` stores `#rejectCommonness` (ingest.ts L277/310) and passes it **per-call** into `admit(draft, dict, parentGroup, { rejectCommonness })` at ingest.ts L558–563. It is a direct optional parameter on `admit()` (`AdmissionOptions`), resolved inside `admit` via `?? REJECT_COMMON_THRESHOLD` — no `applyLayer`, no score.ts import of config. R_eff must consume the same resolved floor R (i.e., compute from `rejectAt`), not the baked constant.

## 5. `tools/calibrate-bands.mjs`

- CLI: zero args = full calibration report (header, band populations, rank↔word↔q probe table at ranks {100…40000}, BUG-001 word set, threshold sweep T=15..255, acceptance assertions; exit 1 on drift). `node tools/calibrate-bands.mjs <word...>` = probe mode: for each word prints `q` (or "absent") and `admit()` verdict for lowercase AND Capitalized (`properName: true`) drafts, then `exit 0` (L51–83).
- Dictionary access: `loadDictionary(dict/common-en.bin)` via native TS-stripping imports from `../src/core/dictionary.ts` and `../src/core/score.ts` (Node ≥ 23.6); also raw `readFileSync` + DataView for the scores section.
- To become R_eff-aware, the probe header ("verdict under REJECT=12, MID=20") and verdicts must print/apply R_eff(word.length) for both lc and Cap drafts (Cap also skips the guard); the sweep (§4) and population counts (§1) are length-blind q-histograms — they'd need per-length recomputation or replacement with curve-aware checks; acceptance assertions §5 must add the boundary words (`uploads` REJECT, `configurations` ADMIT) and re-check "group-2 band is empty" under the new curve. Boundary examples verified against the shipped artifact today: `uploads` q=absent (stem `upload` q=38), `configurations` q=absent (stem `configuration` q=26).

## 6. Test patterns

- `test/score.test.ts`: stubs the Dictionary (`dict(entries)` plain map), a `draft(key, isSubword, over)` factory; boundary cases expressed via IMPORTED constants (`REJECT_COMMON_THRESHOLD - 1`, `MID_FREQ_THRESHOLD + 18`) so the suite survives retunes; one deliberate absolute pin test (`expect(REJECT_COMMON_THRESHOLD).toBe(12)`); knob test at L163-175 passes `{ rejectCommonness: 10 }` as 4th arg. Guard tests hard-code stems like `upload: 38` via `MID_FREQ_THRESHOLD + 18`.
- `test/calibration.test.ts`: e2e — real IngestPipeline + shipped dict + `prose.jsonl`, asserts store EMPTY and common probes delegate; imports both constants; asserts measured absolute q's (`posts` ≥ REJECT etc.). `COMMON_PROBES` exported for typing-path tests.
- `test/config.test.ts` asserts default 12 and override 49 round-trips.

## 7. FEASIBILITY of R_eff(len)

Proposed (matches spec/04-tokenization-and-scoring.md §"Admission decision" lines ~263–283, already adopted in spec text):

```
R_eff(len) = R                                  len ≤ 8
R_eff(len) = R + (255 − R)·√((len − 8)/12)      8 < len < 20
R_eff(len) = 255                                len ≥ 20     (admit-all)
```

Feasible with a small, surgical change; the plumbing (knob R, null semantics, group placement) already supports it:

- **Table branch**: replace `q >= rejectAt` with `q >= rEff(rejectAt, draft.key.length)`; DELETE the dead `else if (q >= MID_FREQ_THRESHOLD) result = 2;` row so every attested admission lands at group 1 FLAT (matches spec: "Group placement is flat at 1"). `q === null → 0` unchanged. Group 2 remains reachable only via the subword clamp — keep `MID_FREQ_THRESHOLD` exported (tests + calibrate-bands import it; tier-2 uses it) or remove tier-2's dependency per spec decision (delta PRD keeps it? spec/09 says "the old [20,50) group-2 band stays dead" and mentions the override moves the floor the curve scales from; tier-2's fate should follow the delta PRD — see open question).
- **Guard**: both tiers compare the STEM against `R_eff(len(word))` (the WORD's length, not the stem's — delta PRD Task wording). Tier-1 becomes `qs >= rEff`; tier-2 (`q === null && qs >= MID_FREQ_THRESHOLD`) should also become `qs >= rEff` or be subsumed — with R_eff(8)=12, tier-1 alone covers 'uploads' (stem 38 ≥ 12). Boundary examples hold:
  - `uploads`: len 7 → R_eff = 12; absent word, stem `upload` q=38 (measured) → 38 ≥ 12 → REJECT ✔ (today also rejects; unchanged).
  - `configurations`: len 15 → R_eff = 12 + 243·√(7/12) ≈ 197.4; word absent → group 0 ADMIT unless guard fires: stem `configuration` q=26 (measured) < 197.4 → no reject → ADMIT ✔ (today it REJECTS via tier-1, verified by probe run above).
- **Relief ceiling**: ceiling 12 ≤ R_eff(len) for all len when R = 12 (equality at len ≤ 8; strict below for len > 8). Relief needs `q ≥ R_eff(len) && q < 12`, impossible → stays dead for every R ≤ 12. For R > 12 knob values the ceiling 12 < R ≤ R_eff keeps it dead too. If the spec demands strict "ceiling below every R_eff value", note the len ≤ 8 equality is harmless (dead code either way) but a strict reading would want ceiling ≤ R − 1 or leaving as-is with a comment.
- **Rounding caution**: `R + (255-R)*sqrt(...)` yields non-integers; q is an integer 0–255. Compare directly as floats (`q >= rEff`) — at len 20, R_eff = 255 exactly and q max 255 → `q >= 255` rejects q=255 words at len 20! Spec says len ≥ 20 = "admit-all": need `255` sentinel handled as "never reject" (e.g., clamp to 256 or special-case len ≥ 20 → skip reject). This is the main correctness trap.
- **Len source**: use `draft.key.length` (UTF-16 units; ASCII after segmentation — fine).
- Spec/code sync: spec/04 already contains the R_eff table (adopted ahead of implementation) and spec/09 line ~40-51 describes it; the pipeline run treats spec as read-only — code landing later will match, no drift.

## 8. Recommended insertion points / exports / risks

- Add `export function rEff(floor: number, len: number): number` (or `REJECT_LEN_FLOOR = 8`, `REJECT_LEN_FULL = 20` exported constants + the function) in `src/core/score.ts` next to the constants — single source of truth; `tools/calibrate-bands.mjs` and tests import it from there (native TS import already works).
- Change `admit()` only: (a) compute `rEff = rEff(rejectAt, draft.key.length)`; (b) table row `q >= rEff → "reject"`; drop the MID row; (c) guard comparison `qs >= rEff` in tier-1 (and tier-2 per decision); nothing else in the pipeline — ingest.ts, config.ts, index.ts need ZERO changes (knob semantics "moves the floor the curve scales from" fall out naturally since `rejectAt` is the curve input).
- Update `tools/calibrate-bands.mjs` probe/sweep/assertions (§5) and add boundary tests to `test/score.test.ts` (uploads REJECT / configurations ADMIT, len-boundary cases at len 8/9/19/20/21, knob-scaling test, admit-all at ≥ 20). `test/calibration.test.ts`'s store-EMPTY assertion may BREAK: prose.jsonl contains long common words that will now admit — must re-audit that fixture (risk below).
- Surprises/risks:
  1. **len ≥ 20 admit-all vs q=255**: naive `R_eff=255` comparison rejects the most-common long words; must special-case.
  2. **calibration.test.ts prose store-EMPTY** and shipped-dict/no-menu gates: any ≥9-char attested prose word flips to admitted; fixture needs re-measurement (spec claims "nothing below 9 chars changes", so COMMON_PROBES (4–6 chars) survive).
  3. Tier-2 / `MID_FREQ_THRESHOLD` fate is ambiguous: spec/04 says the [20,50) band "stays dead" but doesn't clearly retire the guard's tier-2; delta PRD Task P1.M1.T1 should pin it (open question).
  4. `Calibrate`'s flat threshold sweep/population sections become misleading unless made length-aware.
  5. Guard length choice (word vs stem length) changes outcomes for short-stem/long-word cases (e.g. `badly`, len 5, stem `bad`); spec wording "len(word)" should be pinned by tests.

## VERDICT

**Feasible — low-to-moderate complexity, fully localized to `admit()` + one new exported curve function + calibration/test updates.** The knob flow, null semantics, group plumbing, and even the spec text are already in place; the curve is a pure function of the already-resolved `rejectAt`. Top risks: the len≥20/q=255 admit-all edge, tier-2/MID_FREQ_THRESHOLD retirement ambiguity, and re-calibrating the prose e2e gates that currently assert an empty store. Open questions: (a) does guard tier-2 survive (against R_eff or flat 20, or is tier-1 subsumption enough — delta PRD should say); (b) exact fate of exported `MID_FREQ_THRESHOLD` (tests/calibrate import it); (c) confirm relief ceiling stays 12 (dead) rather than being formally re-pointed below R.
