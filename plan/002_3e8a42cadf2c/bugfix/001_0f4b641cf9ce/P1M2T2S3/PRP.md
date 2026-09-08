---
name: "P1.M2.T2.S3 (bugfix 001_0f4b641cf9ce) — Synthetic-token paste battery: npm/glpat/sk_live/Bearer fragments never offered"
---

## Goal

**Feature Goal**: Build the PRD h3.2 **synthetic-token paste battery** — an automated, real-pipeline test suite covering the AWS 38-char example key AND representative `npm_`/`glpat-`/`sk_live_`/`Bearer`-style synthetic tokens — asserting that none of the documented leaked fragments (`abcdefghijklmnopqrstuvwxy`, `yz0123456789`, `zabc`, plus each token's own sub-word fragments) appear in `store.entries()` or in `rankMatches`/`getSuggestions` results for their prefixes. Where the battery proves a synthetic's whole token still passes every gate and is not masked, add **conservative** rules to `SECRET_PREFIXES` (e.g. `npm_`, `glpat-`) — each addition citing the battery case it closes and verified not to fire on prose/fixtures.

**Deliverable**: (1) New battery `describe` block in `test/adversarial-ingest.test.ts` (real IngestPipeline + shipped dict + CandidateStore + rankMatches — nothing mocked); (2) minimal `SECRET_PREFIXES` additions in `src/core/shapeGate.ts` with JSDoc (Mode A) documenting each addition's battery provenance alongside S1's note; (3) calibration + prose-fixture replay stay green.

**Success Definition**: Every battery token's documented fragments: not in `storedKeys(store)`, `rankMatches(store, <fragment-prefix>)` returns no key containing the fragment, and a provider-level `getSuggestions([<prefix>], …)` returns no items — while a rare prose word from the SAME messages still admits (non-vacuity). `npm run check` + `npm test` green, including `test/calibration.test.ts`, `test/shipped-dict.test.ts`, and the prose fixture replay in `test/mask-secrets.test.ts` (L96 "leaves prose, URLs and fixture vocabulary byte-identical" and L254 "prose fixture replay").

## Why

- BUG-003 (Major, h3.2): pasting npm/glpat/sk_live/Bearer-style synthetic tokens historically admitted fragments `abcdefghijklmnopqrstuvwxy`, `yz0123456789`, `zabc` — violating §01 "never embarrass" and §09 integration item 5 ("key never appears in suggestions afterwards" — including recognizable fragments).
- S1 (mask floor 32, COMPLETE) and S2 (parent-secret propagation, IN FLIGHT — treat as done per its PRP) close most of the leak: payloads ≥32 unbroken alnum chars are masked pre-tokenize, and sub-words of secret-REJECTED parents propagate-reject. The residual gap is a synthetic whose **whole token passes every gate and survives masking** — e.g. `glpat-…` (hyphen not in SECRET_PREFIXES `glpat_`; a zero-digit payload defeats rules 6/7). This task proves the gap empirically and closes it minimally.
- Output is the locking test for §09 integration item 5; consumed by P1.M4.T1.S1 (full-suite regression) and cited by P1.M4.T2 docs.

## What

1. **Battery (test-first)**: extend `test/adversarial-ingest.test.ts` with a new `describe("Probe C — synthetic-token paste battery (BUG-003, PRD h3.2)")` following the existing Probe A structure exactly: shared store built in `beforeAll` via `makePipeline`, `FRAGMENTS: [string, string][]` + `it.each`, `storedKeys()` helper, a positive-control prose ingest, plus per-token assertions on `store.entries()` and `rankMatches`. Tokens to include (design each vector per the layer analysis below):
   - AWS 38-char key WITHOUT slashes: `wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY` (PRD h3.2 exact repro; masked at layer 1 by BARE_RUN_MIN=32).
   - `sk_live_` + ~24 mixed-case chars (already caught by `sk_` prefix — proves the prefix rule holds; document why no new rule needed).
   - `glpat-` + payload(s) including a **zero-digit** ≥20-char mixed-case payload and a **<32-char lowercase+digit** payload.
   - `npm_` + payloads both ≥36 (tail masked by layer 1) and shorter no-digit mixed-case.
   - `Bearer ` + a <32-char mixed-case no-digit payload (the residual class; 'Bearer' itself is an ordinary word and must keep admitting-checkable but not required).
   - The alphabet-run synthetic that produced the documented fragments: a token like `abcdefghijklmnopqrstuvwxyz0123456789zabc…` shaped so its fragments `abcdefghijklmnopqrstuvwxy` / `yz0123456789` / `zabc` were historically emitted.
   For each token, compute its plausible sub-word fragments (camelCase/case-boundary splits ≥4 chars) and assert none are stored and none rank. **Empirically verify each vector before locking assertions**: run the pipeline in a scratch check (or temporarily `it.only`) and record which fragments leak today — those define the fixes; the rest pin S1+S2 behavior.
2. **Conservative fixes (only where the battery proves a live leak)**:
   - Extend `SECRET_PREFIXES` with `npm_`, `glpat-` (and any other battery-proven prefix — NOT speculative ones). Each entry gets a JSDoc comment citing the battery case id/fragment it closes.
   - `sk_live` needs NO addition — `sk_` already matches `startsWith`. `Bearer` gets NO prefix rule ('bearer' is prose; the defense for Bearer payloads is layer 1's bare-run + the prefix rules on real key formats) unless the battery shows an unmasked ≥32-fragment leak, in which case prefer a targeted mask regex over a prose-unsafe prefix.
   - After each addition: re-run calibration (`test/calibration.test.ts`, `test/shipped-dict.test.ts`) and the prose-fixture identity tests (`test/mask-secrets.test.ts`) — additions must be no-ops on prose/fixtures. If any fires on prose, tighten (e.g. require minimum payload length via a mask regex instead of a bare prefix).
3. **Docs (Mode A)**: update the `SECRET_PREFIXES` JSDoc and the `isSecretShaped` rule-1 note in `src/core/shapeGate.ts` to document the battery-derived additions, next to S1's BARE_RUN_MIN note.

### Success Criteria

- [ ] All documented fragments (`abcdefghijklmnopqrstuvwxy`, `yz0123456789`, `zabc`) absent from `store.entries()` and zero-ranked
- [ ] Every battery token's fragments: absent + zero-ranked + no `getSuggestions` items for their prefixes
- [ ] Every new rule addition cites its closing battery case; calibration, shipped-dict, prose-identity, and prose-fixture-replay tests stay green
- [ ] Positive control (rare prose word from the same messages) still admits — assertions provably non-vacuous
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer needs: the layer-1/layer-2 contracts (S1/S2 PRPs), the exact SECRET_PREFIXES inventory, maskSecrets' regex charset (underscore/hyphen NOT in `[0-9a-zA-Z/+]`), the adversarial-ingest suite conventions, and the false-positive guard tests. All below.

### Documentation & References

```yaml
- file: src/core/shapeGate.ts
  why: SECRET_PREFIXES (~L75-95): sk-, sk_, ghp_, gho_, github_pat_, xoxb-/p/a/r/s-, akia,
        aiza, eyj — matched via startsWith on lowercased display. isSecretShaped rules
        1-7 (JSDoc ~L150-200) document rules 6/7 requiring ≥2 digits / ≥16 runs — the
        zero-digit payload gap. maskSecrets SECRET_WINDOW_RES (~L457-470) + BARE_ALNUM_RUN_RE
        `[0-9a-zA-Z/+]{32,}`: '_' and '-' break the run, so npm_/glpat- payloads mask only
        in their unbroken ≥32 segments.
  pattern: JSDoc block citing PRD sections + bug IDs; SECRET_WINDOW_ANCHORS index-aligned
           array MUST gain anchors for any new MASK regex (prefix additions to
           SECRET_PREFIXES need no anchor — they are token-level, not mask-level).
  gotcha: adding to SECRET_PREFIXES is token-level (affects isSecretShaped); adding a
          SECRET_WINDOW_RES regex requires the index-aligned anchors entry and the
          mask-secrets suite re-run.

- file: test/adversarial-ingest.test.ts
  why: THE pattern to follow — Probe A. makePipeline(store) builds real pipeline with
        loadDictionary(resolveDictPath()); storedKeys(store) forces prefixRange('')
        rebuild before sortedKeysSnapshot(); FRAGMENTS it.each asserts
        `rankMatches(store, f)` maps to no leaked key AND storedKeys contains no
        byte-run; positive control 'a zephyr drifted over the vestibule' must admit.
        Probe C copies these helpers (module-scope, already defined — reuse, don't
        duplicate).
  pattern: keys defined as module constants with computed prefix slices (see
        SK_PROJ_PREFIX), comments citing provenance.

- file: test/mask-secrets.test.ts
  why: the false-positive guards: L96 "leaves prose, URLs, and fixture vocabulary
        byte-identical" (maskSecrets identity on prose/URL strings) and L254 "prose
        fixture replay" over test/fixtures/sessions/prose.jsonl. BOTH must stay green
        after any addition.
  gotcha: if you add a MASK regex (not just a prefix), extend the unit case list with a
        negative case proving it does not fire on prose.

- file: test/calibration.test.ts, test/shipped-dict.test.ts
  why: calibration re-run requirement — admission-band / gate-rate assertions pinned
        against the shipped dict. New secret prefixes change gate counts only for
        prefix-shaped tokens (absent from these fixtures), but re-run to prove it.

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M2T2S2/PRP.md
  why: S2 CONTRACT (in flight): parent-secret propagation — whole-token 'secret' reject
        poisons sub-words via #computeAdmitMemo. Combined with a new prefix rule, an
        npm_/glpat- whole token rejects as 'secret' AND its sub-words inherit. Your
        battery exercises S2 end-to-end (do not re-implement it).

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M2T2S1/PRP.md
  why: S1 CONTRACT (complete): BARE_RUN_MIN=32. Battery vectors that rely on layer 1
        (≥32 unbroken alnum) should ALSO include a variant with a shorter/underscore-
        broken payload so the prefix rule (not just masking) is exercised.

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/core-engine-findings.md
  why: BUG-003 lever 3 — this exact task: "add conservative prefix/mask rules
        (SECRET_PREFIXES: npm_, glpat-, sk_live …) bounded by the battery, avoiding
        prose false positives; document additions in JSDoc."
```

### Current Codebase tree (relevant)

```bash
src/core/shapeGate.ts            # MODIFY: SECRET_PREFIXES additions + JSDoc (Mode A)
test/adversarial-ingest.test.ts  # EXTEND: Probe C synthetic-token battery
test/mask-secrets.test.ts        # re-run (extend only if a mask regex is added)
test/calibration.test.ts         # re-run only
```

### Desired Codebase tree

```bash
src/core/shapeGate.ts            # + npm_, glpat- (battery-proven set) in SECRET_PREFIXES
test/adversarial-ingest.test.ts  # + describe("Probe C — synthetic-token paste battery (BUG-003, PRD h3.2)")
```

### Known Gotchas of our Codebase & Library Quirks

```typescript
// TOKENIZATION SPLITS ON '-' AND '_': 'glpat-AbCd' produces tokens 'glpat' and
// 'AbCd', NOT one whole token — so a SECRET_PREFIXES entry 'glpat-' can NEVER fire
// at the token level (isSecretShaped sees draft.display without the hyphen-joined
// neighbor). For hyphen-formats the defense must be a MASK regex in SECRET_WINDOW_RES
// (e.g. /glpat-[A-Za-z0-9_-]{20,}/g, WITH its index-aligned anchors entry ["glpat-"]),
// which blanks the payload pre-tokenize. Verify empirically: tokenize() in segment.ts
// is the ground truth — check what tokens your vector actually produces BEFORE
// choosing prefix vs mask regex. '_'-joined prefixes (npm_, sk_live_, glpat_) DO stay
// in one token and a SECRET_PREFIXES entry works there.

// sk_live_ NEEDS NO RULE: 'sk_' already matches startsWith('sk_live…'). Battery pins
// this; do not add a redundant 'sk_live' entry.

// 'Bearer' IS PROSE: never add 'bearer' as a prefix (every sentence about auth would
// reject). Bearer-payload defense = layer-1 bare-run on the payload itself; only the
// <32 no-digit mixed-case payload after 'Bearer ' remains theoretically leaky — size
// battery payloads to prove whether that class actually leaks fragments ≥4 chars with
// the real dict, and if it does, prefer nothing (documented residual, sub-word lengths
// <4) or a targeted anchored regex — owner call, cite the case.

// THE VACUOUS-TEST TRAP (from S2's gotchas): verify each vector reaches the layer you
// think it does. A 40-char npm_ payload's tail is masked (never tokenized) — that case
// pins layer 1, not your new rule. Include a SHORT no-digit payload variant so the
// prefix rule itself is what rejects it. Cheap direct check:
//   tokenize(maskSecrets("npm_" + payload)) — import both from src/core.

// LAYER-2 INTERACTION: with S2 in place, a whole token rejecting 'secret' (via your new
// prefix) poisons its sub-words automatically. Do not assert sub-word absence through
// any new mechanism — assert outcomes (store/rank empty) only.

// STORE SNAPSHOT STALENESS: always call store.prefixRange("") before
// sortedKeysSnapshot() (the storedKeys() helper does this — reuse it).

// rejectedByGate.secret COUNTERS: new prefix rejections flow through the existing
// #replayAdmitMemo !gate.ok branch; if you assert counters, count per-occurrence and
// include poisoned sub-words (memo replayed per occurrence).

// DO NOT ADD MASK REGEXES WITHOUT ANCHORS: SECRET_WINDOW_ANCHORS is index-aligned;
// a new SECRET_WINDOW_RES entry without its anchors row (or with []) always runs —
// correct but slow; with anchors ["npm_"]/["glpat-"] it fast-paths. If the mask
// regex's literal prefix is its own anchor, add the row.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies — TDD)

```yaml
Task 1: BUILD the battery (test/adversarial-ingest.test.ts)
  - ADD module-constant keys: NPM_LONG ('npm_' + 36 alnum — masks at layer 1),
    NPM_SHORT ('npm_' + ~20 mixed-case no-digit — exercises the prefix rule),
    GLPAT_HYPHEN ('glpat-' + ~20 zero-digit payload), SK_LIVE ('sk_live_' + 24),
    BEARER_LINE ('Bearer ' + <32-char mixed-case no-digit payload),
    ALPHA_RUN (the alphabet synthetic reproducing 'abcdefghijklmnopqrstuvwxy' /
    'yz0123456789' / 'zabc' fragments — reconstruct from the h3.2 repro shape)
  - ADD describe("Probe C — synthetic-token paste battery (BUG-003, PRD h3.2)"):
    beforeAll ingests all lines (with surrounding prose 'token: … end') plus the
    positive control 'a zephyr drifted over the vestibule' into ONE shared store
    via makePipeline
  - FRAGMENTS: [string, string][] = each documented fragment + each token's plausible
    ≥4-char sub-words (compute slices as constants, mirroring SK_PROJ_PREFIX style)
  - it.each(FRAGMENTS): rankMatches(store, f) maps to no key containing f AND
    storedKeys(store) has no such key (copy Probe A's leak predicate verbatim)
  - ONE it(): provider-level assertion — createHapaxProvider (or rankMatches-empty
    ⇒ no items, matching Probe A's convention) for 'abc', 'yz0', 'zabc' prefixes
    returns no items whose value contains the fragments
  - RUN npx vitest --run test/adversarial-ingest.test.ts — record which cases FAIL
    (these are the live leaks; everything else pins S1+S2)

Task 2: CLOSE live leaks conservatively (src/core/shapeGate.ts)
  - IF '_'-joined prefixes leak: add 'npm_' to SECRET_PREFIXES with JSDoc citing the
    Probe C case; sk_live_ needs nothing (sk_ covers); glpat_ likely already covered
    by existing entry — verify
  - IF hyphen-formats leak: add mask regex(es) to SECRET_WINDOW_RES, e.g.
    /glpat-[A-Za-z0-9_-]{20,}/g, PLUS the index-aligned SECRET_WINDOW_ANCHORS row
    ["glpat-"], with JSDoc citing the closing battery case
  - EMPIRICAL rule: every addition must be justified by a Task-1 failing case that
    now passes; no speculative entries
  - EXTEND the SECRET_PREFIXES/inventory JSDoc (Mode A): battery provenance note
    alongside S1's BARE_RUN_MIN note

Task 3: VALIDATE
  - npm run check
  - npx vitest --run test/adversarial-ingest.test.ts test/mask-secrets.test.ts -v
  - npx vitest --run test/calibration.test.ts test/shipped-dict.test.ts -v
  - npm test  # full suite green
```

### Implementation pattern

```typescript
// Probe C skeleton (test/adversarial-ingest.test.ts — reuse module helpers)
describe("Probe C — synthetic-token paste battery (BUG-003, PRD h3.2)", () => {
  let store: CandidateStore;
  beforeAll(async () => {
    const pipeline = makePipeline((store = new CandidateStore()));
    await pipeline.processText(`token: ${AWS_38_NOSLASH} end`, true);
    await pipeline.processText(`npm: ${NPM_LONG} / ${NPM_SHORT}`, true);
    await pipeline.processText(`gitlab: ${GLPAT_HYPHEN}`, true);
    await pipeline.processText(`stripe: ${SK_LIVE}`, true);
    await pipeline.processText(`auth: Bearer ${BEARER_PAYLOAD}`, true);
    await pipeline.processText(`synthetic: ${ALPHA_RUN}`, true);
    await pipeline.processText("a zephyr drifted over the vestibule", true);
  });
  const FRAGMENTS: [string, string][] = [
    ["abcdefghijklmnopqrstuvwxy", "PRD h3.2 documented leak"],
    ["yz0123456789", "PRD h3.2 documented leak"],
    ["zabc", "PRD h3.2 documented leak"],
    // + computed sub-word slices per token
  ];
  it.each(FRAGMENTS)("never stores or ranks %s (%s)", (f) => {
    expect(rankMatches(store, f).map((m) => m.key)
      .some((k) => k.includes(f))).toBe(false);
    expect(storedKeys(store).some((k) => k.includes(f))).toBe(false);
  });
  it("positive control: 'zephyr' admits (non-vacuity)", () => {
    expect(rankMatches(store, "zeph").map((m) => m.key)).toContain("zephyr");
  });
});

// shapeGate.ts — prefix addition (token-level, '_'-joined only)
const SECRET_PREFIXES: readonly string[] = [
  // ... existing entries ...
  // Probe C (P1.M2.T2.S3): npm publish tokens 'npm_' + 36 — closes the
  // <32-payload no-digit gap S1's bare-run can't reach.
  "npm_",
];

// shapeGate.ts — hyphen-format mask (raw-text level; index-aligned anchors!)
// SECRET_WINDOW_RES push: /glpat-[A-Za-z0-9_-]{20,}/g
// SECRET_WINDOW_ANCHORS push: ["glpat-"]  // keep arrays index-aligned
```

### Integration Points

```yaml
NONE structurally:
  - Test suite extension + baked constants in shapeGate; no wiring, no config.
  - Downstream (do NOT implement): P1.M4.T1.S1 consumes this battery in the full
    regression; P1.M4.T2.S1 documents the additions at changeset level.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Tests

```bash
npx vitest --run test/adversarial-ingest.test.ts -v          # Probe C green
npx vitest --run test/mask-secrets.test.ts -v                # prose identity + fixture replay green
npx vitest --run test/calibration.test.ts test/shipped-dict.test.ts -v
npm test                                                     # full suite green
```

### Level 3: Integration

The battery IS the integration test (real pipeline + shipped dict + real store/query). No further runtime wiring.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green

### Feature Validation

- [ ] All three PRD-documented fragments (`abcdefghijklmnopqrstuvwxy`, `yz0123456789`, `zabc`) never stored, never ranked, never suggested
- [ ] AWS 38-char no-slash key, npm_/glpat-/sk_live_/Bearer synthetics: no derived fragments offered
- [ ] Every SECRET_PREFIXES / SECRET_WINDOW_RES addition cites its closing battery case; none fires on prose (mask-secrets prose identity + fixture replay green)
- [ ] Positive control admits — assertions non-vacuous
- [ ] SECRET_WINDOW_ANCHORS stays index-aligned with SECRET_WINDOW_RES if any mask regex was added

### Code Quality Validation

- [ ] JSDoc (Mode A) documents additions alongside S1's note
- [ ] Test conventions match Probe A (constants with provenance comments, computed slices, it.each)
- [ ] No speculative rules; each addition empirically justified by a battery case

## Anti-Patterns to Avoid

- ❌ Don't add prefix rules for hyphen-formats (tokenization splits them — use a mask regex) or for prose words ('bearer')
- ❌ Don't duplicate S1/S2 assertions with new mechanisms — the battery asserts OUTCOMES only
- ❌ Don't add a mask regex without its anchors row
- ❌ Don't write vacuous tests — verify vectors reach the intended layer (tokenize(maskSecrets(s)))
- ❌ Don't add redundant prefixes already covered (sk_live ⊂ sk_, glpat_ already present)
```
