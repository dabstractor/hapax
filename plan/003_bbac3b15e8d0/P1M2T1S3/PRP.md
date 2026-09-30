---
name: "P1.M2.T1.S3 (plan 003) — fuzzThreshold config surface (0–100 clamped, baked default auto-import)"
---

## Goal

**Feature Goal**: Wire the `fuzzThreshold` runtime knob (PRD §08 h2.52 schema row) into the config surface exactly like `rejectCommonness`: bake the default in `src/core/query.ts` (`DEFAULT_FUZZ_THRESHOLD = 60`, done by P1.M2.T1.S2), auto-import it into `DEFAULT_CONFIG`, add the field to `HapaxConfig`, clamp 0–100 in `applyLayer` (silent clamp for out-of-range numbers, one-warning repair for wrong types), and thread it through the provider's `rankMatches` call site so the live editor honors it. Pin `100 = exact-prefix-only mode` in tests.

**Deliverable**:
- `src/pi/config.ts`: `HapaxConfig.fuzzThreshold: number` field (JSDoc mirroring the §08 schema row), `DEFAULT_CONFIG.fuzzThreshold = DEFAULT_FUZZ_THRESHOLD` (imported from `../core/query.js`), and an `applyLayer` branch `clampNumber(v, 0, 100)` / wrong-type repair with one warning — cloned verbatim from the `rejectCommonness` branch (config.ts ~L239–248).
- `src/pi/provider.ts` (~L583): pass `fuzzThreshold: config.fuzzThreshold` into the `rankMatches(store, state.fragment, { limit: ... })` call.
- TDD tests: `test/config.test.ts` (default, override round-trip, clamps 0/100, invalid type repairs with warning) + `test/query.test.ts` (`fuzzThreshold: 100` = prefix-only mode).
- [Mode A] JSDoc on the query module's exported constants (DEFAULT_FUZZ_THRESHOLD + score constants) documenting the knob semantics. README config-table row is R5 (P1.M4.T1.S1) — do NOT touch README here.

**Success Definition**: `DEFAULT_CONFIG.fuzzThreshold === DEFAULT_FUZZ_THRESHOLD === 60` (one number, never two — the rejectCommonness invariant); a config file `{"fuzzThreshold": 100}` round-trips to 100 and makes the provider's queries exact-prefix-only; `npm run check` + `npm test` green.

## Why

- §04 h2.28 + §08 h2.52: `fuzzThreshold` is the runtime-tunable admission threshold for anchored-fuzzy matching (higher = stricter; 100 = prefix-only; 0 = admit all). S2 landed the RankOptions surface and the discard; without this item the knob exists only in code defaults and no owner can turn it.
- The spec mandates the auto-import pattern verbatim: "Default … imported from the baked constant in the query module automatically — same pattern as rejectCommonness."
- Output is consumed by the provider (provider.ts:583 call site) and later by the widget visibility rule (P1.M3.T2.S1).

## What

1. **Field + default** (`src/pi/config.ts`): add `fuzzThreshold: number` to `HapaxConfig` (place after `rejectCommonness`, JSDoc ≈ the §08 schema row: "0–100: minimum anchored-fuzzy match score (§04) for a candidate to enter a result set. Higher = stricter; 100 = exact-prefix-only mode. Default: the baked constant in src/core/query.ts (rejectCommonness pattern)."). Add the import `import { DEFAULT_FUZZ_THRESHOLD } from "../core/query.js";` and `fuzzThreshold: DEFAULT_FUZZ_THRESHOLD,` to `DEFAULT_CONFIG`.
2. **applyLayer branch** (clone the rejectCommonness branch shape): `if ("fuzzThreshold" in raw) { if (typeof v === "number") next.fuzzThreshold = clampNumber(v, 0, 100); else notify(\`hapax: invalid fuzzThreshold in ${filePath}, using ${formatValue(current.fuzzThreshold)}\`, "warning"); }`. Out-of-range clamps SILENTLY (clampNumber rounds + bounds — right type, wrong bounds is normalization, not repair); wrong type repairs with exactly one warning.
3. **Provider pass-through** (`src/pi/provider.ts` ~L583): `rankMatches(store, state.fragment, { limit: config.maxSuggestions, fuzzThreshold: config.fuzzThreshold })`. This is the ONLY provider change — do not touch chain gating (P1.M2.T3.S1 re-points that filter separately, at threshold 0).
4. **Tests (TDD)**:
   - `test/config.test.ts`: (a) defaults block — `fuzzThreshold: DEFAULT_CONFIG.fuzzThreshold` (add to the existing defaults assertion object); (b) layer override round-trip (`{"fuzzThreshold": 100}` → 100); (c) clamp bounds: −5 → 0, 150 → 100, and 100.7 → 101? NO — clampNumber rounds first: 100.7 → 101 → clamp 100; pin 60.4 → 60 (rounding + clamp together, matching clampNumber semantics); (d) invalid type (`"80"`, null) → repaired to previous value with exactly one warning (mirror the existing threshold/maxSuggestions describe at ~L308).
   - `test/query.test.ts`: only if S2's "admission threshold" describe does not already pin it — `fuzzThreshold: 100` = exact-prefix-only mode: tier 3 (score 100 ≥ 100) survives; tier 2/1 max 85 all discard. Check first; do not duplicate S2's tests.
   - New in `test/provider.test.ts` or existing provider wiring test if one fits: config `{fuzzThreshold: 100}` flows through provider.getSuggestions → tier-2-only matches return zero candidates → delegate. (Optional if S2's RankOptions tests + the pass-through line are trivially reviewable; prefer one thin end-to-end assertion.)
5. **Mode A JSDoc**: on the exported constants in `src/core/query.ts` — DEFAULT_FUZZ_THRESHOLD's doc-block already drafted by S2; extend it (and the tier score constants) with the knob semantics: range 0–100, config key name, 100 = prefix-only, tier-1 max 50 < default 60 so scattered matches never render at default. No spec/*.md or README edits.

### Success Criteria

- [ ] `DEFAULT_CONFIG.fuzzThreshold === 60` sourced from `DEFAULT_FUZZ_THRESHOLD` (imported, not duplicated)
- [ ] `applyLayer`: numbers clamp to [0,100] silently (round-then-clamp); non-numbers repair to previous with exactly one warning
- [ ] Provider passes `config.fuzzThreshold` to rankMatches at the ~L583 site
- [ ] `fuzzThreshold: 100` pinned as exact-prefix-only (config round-trip + query semantics)
- [ ] `npm run check` + `npm test` green; README/spec untouched

## All Needed Context

### Context Completeness Check

An implementer needs: the exact rejectCommonness pattern to clone, the S2 contract (constant name/export, RankOptions semantics, strict-< boundary), the provider call site, clampNumber's round-then-clamp semantics, and test-file conventions. All below.

### Documentation & References

```yaml
- file: plan/003_bbac3b15e8d0/P1M2T1S2/PRP.md
  why: THE upstream contract: exports DEFAULT_FUZZ_THRESHOLD = 60 (as const,
        with JSDoc) + the six tier score constants from src/core/query.ts;
        RankOptions.fuzzThreshold?: number (absent = default, NOT 0); the
        discard gate in rankMatches compares score < threshold STRICTLY
        (100 vs 100 survives → prefix-only at 100); tier-1 max = 50, tier-2
        max = 85; zero-fragment listing bypasses the gate.
  critical: S3 consumes; it does NOT re-add any query.ts logic. If S2's
        tests already pin threshold-100-prefix-only, reference, don't
        duplicate.

- file: src/pi/config.ts
  why: The ONLY config file to edit. Clone the rejectCommonness precedent:
        field on HapaxConfig (L~64) with the schema-row JSDoc;
        DEFAULT_CONFIG entry (L~91) importing from ../core/score.js —
        replicate with ../core/query.js; applyLayer branch L239–248.
  gotcha: config.ts deliberately imports only node builtins + one pure
        constant from core — keep it that way (query.ts is pure, no pi
        imports; safe to add).

- file: src/pi/provider.ts (L583)
  why: The rankMatches call site to extend: currently
        rankMatches(store, state.fragment, { limit: config.maxSuggestions }).
        Add fuzzThreshold: config.fuzzThreshold.
  gotcha: provider re-reads config per query via a `{...config, threshold: 1}`
        spread (L~574) — the field flows automatically once added; no other
        plumbing.

- file: test/config.test.ts
  why: Test conventions: defaults describe (L89) asserts the whole
        DEFAULT_CONFIG object — add the field there; clamp/repair describe
        pattern at L308 ("threshold / maxSuggestions — clamp in range,
        repair on type"); notify assertions count warnings exactly.
  pattern: writeConfig helper + loadConfig with injected notify spy +
        temp homeDir/cwd (see file header imports/setup).

- file: test/query.test.ts
  why: S2's "admission threshold" describe lives here (search
        fuzzThreshold) — check what S2 already pinned before adding;
        matchFragment score pins at L513+ give the worked values
        (tier 3 = 100, tier 2 max 85, tier 1 ≤ 50).

- docfile: plan/003_bbac3b15e8d0/architecture/r3-query-fuzzy.md
  section: §4 (the rejectCommonness precedent, per the item contract)
  why: Confirms the four-step wiring: bake in query.ts (S2, done) →
        field on HapaxConfig → DEFAULT_CONFIG entry → applyLayer clamp
        branch.

- docfile: plan/003_bbac3b15e8d0/prd_snapshot.md
  section: h2.52 (schema row for fuzzThreshold, verbatim text to mirror
        in JSDoc) + h2.59 (tuning protocol: fuzzThreshold is a runtime
        tuning surface; tier boundaries are NOT tunable)
```

### Current Codebase tree (relevant)

```bash
src/core/query.ts     # DEFAULT_FUZZ_THRESHOLD exported (S2) — JSDoc extension only
src/pi/config.ts      # MODIFY: field, default, applyLayer branch
src/pi/provider.ts    # MODIFY: one call-site option (L~583)
test/config.test.ts   # ADD: fuzzThreshold describe
test/query.test.ts    # EXTEND only if S2 left a gap
```

### Desired Codebase tree

```bash
src/core/query.ts     # knob-semantics JSDoc on exported constants (Mode A)
src/pi/config.ts      # + fuzzThreshold field/default/clamp branch
src/pi/provider.ts    # rankMatches call passes fuzzThreshold
test/config.test.ts   # + "fuzzThreshold — clamp in range, repair on type"
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: ONE number, never two. DEFAULT_CONFIG.fuzzThreshold MUST be
// the imported DEFAULT_FUZZ_THRESHOLD — a literal 60 in config.ts forks
// the default and breaks the rejectCommonness invariant (S2's JSDoc says
// "config.ts auto-imports this").

// GOTCHA: clampNumber(v, 0, 100) ROUNDS before clamping (Math.round
// inside) — 100.7 → 101 → clamped 100; 60.4 → 60. Pin both in tests so
// the round-then-clamp order is regression-safe.

// GOTCHA: absent key ≠ 0. RankOptions.fuzzThreshold absent means the
// baked 60. But once the provider always passes config.fuzzThreshold,
// absence never happens on the live path — config guarantees a number.

// GOTCHA: 100 = prefix-only FALLS OUT of the strict-< gate (tier 3 score
// 100 survives at threshold 100; tiers 2/1 max 85 discard). Don't add a
// special-case — it's arithmetic.

// GOTCHA: out-of-range is a SILENT clamp (normalization), wrong TYPE is a
// repair with EXACTLY one warning per field per layer — mirror the
// rejectCommonness branch's wording shape:
// `hapax: invalid fuzzThreshold in ${filePath}, using ${formatValue(current.fuzzThreshold)}`.
// Repair target is `current.fuzzThreshold` (pre-layer), matching
// rejectCommonness (NOT the enableChaining next-target subtlety).

// GOTCHA: do NOT touch the chain successor filter in provider.ts — that
// re-points to fuzzy membership at threshold 0 in P1.M2.T3.S1. Here only
// the L~583 rankMatches call gains the option.

// GOTCHA: unknown keys stay ignored (forward compat) — fuzzThreshold is
// now KNOWN, so it must actually apply; the defaults-assertion object in
// config.test.ts will fail to compile if the field is missing (HapaxConfig
// literal) — that's the free type pin.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies — TDD)

```yaml
Task 1: WRITE failing config tests (test/config.test.ts)
  - ADD field to the defaults assertion object (L~89 describe):
    fuzzThreshold: DEFAULT_CONFIG.fuzzThreshold
  - ADD describe("fuzzThreshold — clamp in range, repair on type
    (PRD §08 h2.52)") mirroring the L308 pattern:
    * override round-trip: {"fuzzThreshold": 100} → 100
    * clamp: -5 → 0; 150 → 100; 100.7 → 100; 60.4 → 60 (round-then-clamp)
    * repair: "80" / null / true → previous value, exactly one warning,
      warning text names field + file
    * layering: user 90, project "bad" → 90 survives (repair target is
      current, not defaults)
  - RUN: npx vitest --run test/config.test.ts → red

Task 2: IMPLEMENT (src/pi/config.ts)
  - import { DEFAULT_FUZZ_THRESHOLD } from "../core/query.js";
  - HapaxConfig.fuzzThreshold field (schema-row JSDoc, after rejectCommonness)
  - DEFAULT_CONFIG.fuzzThreshold = DEFAULT_FUZZ_THRESHOLD
  - applyLayer branch (rejectCommonness clone, clamp 0–100)
  - RUN: config tests green

Task 3: PROVIDER pass-through (src/pi/provider.ts ~L583)
  - rankMatches(store, state.fragment, {
      limit: config.maxSuggestions,
      fuzzThreshold: config.fuzzThreshold,
    })
  - RUN: npx vitest --run test/provider*.test.ts → green (no behavior
    change at default 60 for prefix-era expectations)

Task 4: QUERY semantic pin (test/query.test.ts) — ONLY if S2's describe
        lacks it
  - fuzzThreshold: 100 → prefix probe renders, tier-2 ('zsk'→'zendesk',
    68) does not; fuzzThreshold: 85 → 'zsk' (68) still discarded,
    zlock-tier2 boundary as S2 pinned

Task 5: MODE A JSDoc (src/core/query.ts)
  - Extend DEFAULT_FUZZ_THRESHOLD + tier-constant doc-blocks with the knob
    semantics (0–100 config key, 100 = prefix-only, tier-1 max 50 < default
    60 — scattered never renders at default). No README/spec edits.

Task 6: FULL validation — npm run check; npm test
```

### Implementation pattern

The applyLayer branch (clone of rejectCommonness, config.ts L239–248):

```typescript
if ("fuzzThreshold" in raw) {
  const v = raw.fuzzThreshold;
  if (typeof v === "number") {
    next.fuzzThreshold = clampNumber(v, 0, 100); // round-then-clamp, silent
  } else {
    notify(
      `hapax: invalid fuzzThreshold in ${filePath}, using ${formatValue(current.fuzzThreshold)}`,
      "warning",
    );
  }
}
```

### Integration Points

```yaml
CONFIG:
  - HapaxConfig gains fuzzThreshold — every literal construction of
    HapaxConfig in tests (cfg() helpers etc.) must add the field or rely
    on spreading DEFAULT_CONFIG (tsc will point them out).

PROVIDER: rankMatches call site L~583 gains the option (this task).

DOWNSTREAM (P1.M3.T2.S1): the widget visibility rule consumes
  config.fuzzThreshold the same way — this task defines the surface.

DOWNSTREAM (P1.M2.T3.S1): chain successor filter re-points to fuzzy
  membership at threshold 0 — orthogonal; do not touch here.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check    # zero errors — also proves every HapaxConfig literal has the field
grep -n "fuzzThreshold: 60" src/ && echo "LEAK: duplicated default" || true
```

### Level 2: Unit Tests

```bash
npx vitest --run test/config.test.ts -v
npx vitest --run test/query.test.ts -v
npx vitest --run test/provider.test.ts test/provider-live.test.ts -v
```

### Level 3: Full suite

```bash
npm test   # all green; perf gates unaffected (default unchanged)
```

### Level 4: Behavioral audit

- Write a scratch `~/.pi/agent/hapax.json`-style layer in a config test: `{"fuzzThreshold": 100}` → a store probe where only a tier-2 match exists returns [] (provider delegates) — the knob demonstrably reaches rankMatches end-to-end
- Warning count is exactly one for a single invalid field; zero for clamps

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` + `npm test` green; README, spec/*.md, tasks untouched
- [ ] No literal 60 default anywhere except `src/core/query.ts`

### Feature Validation

- [ ] Default auto-imported from DEFAULT_FUZZ_THRESHOLD (one number)
- [ ] Clamp 0–100 silent; wrong type repairs with exactly one warning naming field+file
- [ ] Provider passes config.fuzzThreshold to rankMatches; 100 = prefix-only pinned end-to-end

### Code Quality Validation

- [ ] Branch cloned from rejectCommonness — same wording shape, same repair target (`current`)
- [ ] Tests assert round-then-clamp order (100.7→100, 60.4→60)
- [ ] Chain filter / comparator / scan untouched (T3.S1 / T2 scope)

## Anti-Patterns to Avoid

- ❌ Don't duplicate the default 60 in config.ts — import it (rejectCommonness invariant)
- ❌ Don't warn on out-of-range numbers — clamping is silent normalization
- ❌ Don't special-case threshold 100 — it falls out of the strict-< gate
- ❌ Don't touch the chain successor filter, ranking, or README (other items' scope)

**Confidence Score: 9/10** — the pattern to clone (rejectCommonness), the upstream contract (S2's exports + strict-< semantics), the exact call site (provider.ts L583), and the test conventions are all pinned to verified files/lines; the only judgment (round-then-clamp pinning, non-duplication of S2's query tests) is explicitly resolved in the gotchas.
