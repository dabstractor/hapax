# PRP — P1.M1.T2.S1 (plan 004): Config explicit-vs-default resolution + per-mode defaults (60 ambient / 45 trigger)

---

## Goal

**Feature Goal**: Make an explicitly set `fuzzThreshold` distinguishable
from the default so per-mode resolution (spec §04 trigger loosening / §08
h2.52) is possible: unset → 60 ambient / 45 trigger; explicit → overrides
BOTH modes. No new user-facing config key; the schema row text in §08 is
already correct.

**Deliverable**:
- `TRIGGER_FUZZ_THRESHOLD = 45` exported from `src/core/query.ts` beside
  `DEFAULT_FUZZ_THRESHOLD` (JSDoc'd as the `#`-mode calibration default).
- Internal explicitness signal in `src/pi/config.ts`
  (`fuzzThresholdSet?: boolean`, set by `applyLayer` only on
  present-and-number) + ONE shared resolver
  `resolveFuzzThreshold(config, mode)` exported from config.ts.
- Extended TDD cases in `test/config.test.ts` (the existing :351 describe).

**Success Definition**: Unset config resolves 60 ambient / 45 trigger;
explicit (incl. clamped) value resolves for both modes; wrong-type repair
falls back to per-mode defaults with exactly one warning; layering
(user-global then project) preserves explicitness correctly; `npm run check`
+ `npm test` green with ALL existing config tests unchanged (the
`toEqual(DEFAULT_CONFIG)` identity tests must keep passing).

## Why

- Spec §04 "Trigger-char mode loosening": under `#`, scattered tier-1
  matches become visible at threshold 45 (below tier-1's max of 50) and
  tier-0 is always consulted — but only when the user has NOT set an
  explicit `fuzzThreshold`. Today explicit-set is indistinguishable from
  default (DEFAULT_CONFIG bakes 60 into a required field), so no consumer
  can tell — the exact gap this task closes.
- P1.M1.T2.S2 consumes this resolver at both display call sites
  (provider.ts:599–603, widget.ts:437–442); without a single shared
  resolver the two paths would diverge.

## What

### 1. query.ts — the 45 constant

```ts
/** Default fuzzThreshold under the trigger char (PRD §04 trigger
 *  loosening, §08 h2.52): 45 sits under tier-1's max score of 50, so the
 *  strongest scattered matches (≤1 gap run, ≤5 gap chars) admit only in
 *  `#` mode. Calibration starting point (09 tuning protocol), exactly
 *  like DEFAULT_FUZZ_THRESHOLD (60) for ambient matching. An explicitly
 *  set config fuzzThreshold overrides BOTH mode defaults. */
export const TRIGGER_FUZZ_THRESHOLD = 45 as const;
```

(Additive edit beside `DEFAULT_FUZZ_THRESHOLD` at query.ts:107; the tier-0
constants from P1.M1.T1.S1 already landed in this file — do not disturb them.)

### 2. config.ts — explicitness signal + resolver

**Chosen design** (both options were vetted in
`architecture/system_context.md` §Config seam; this one preserves the
required-field shape and every existing test):

- Keep `fuzzThreshold: number` REQUIRED; `DEFAULT_CONFIG.fuzzThreshold =
  DEFAULT_FUZZ_THRESHOLD` unchanged (the ambient default, 60).
- Add to `HapaxConfig` (JSDoc: INTERNAL load-result field, NOT a config
  file key — never read from JSON):

```ts
/** INTERNAL (not a config-file key): true when a config layer supplied a
 *  valid numeric fuzzThreshold (post-clamp). Absent/undefined = unset →
 *  consumers resolve per-mode via resolveFuzzThreshold (60 ambient / 45
 *  trigger, §08 h2.52). Set ONLY by applyLayer on present-and-number. */
fuzzThresholdSet?: boolean;
```

- `applyLayer` fuzzThreshold block (config.ts:261–271) becomes:

```ts
if ("fuzzThreshold" in raw) {
  const v = raw.fuzzThreshold;
  if (typeof v === "number") {
    next.fuzzThreshold = clampNumber(v, 0, 100); // round-then-clamp, silent
    next.fuzzThresholdSet = true;                // explicit beats per-mode
  } else {
    // wrong type: repair keeps BOTH the previous value AND its
    // explicitness (repaired-from-default stays unset → per-mode defaults)
    notify(`hapax: invalid fuzzThreshold in ${filePath}, using ${formatValue(current.fuzzThreshold)}`, "warning");
  }
}
```

  Layering note: `next` is spread forward between layers, so a later layer
  that OMITS the key keeps the earlier layer's value+flag ("presence wins,
  later presence wins over earlier presence"); a later layer's wrong-type
  entry repairs to the CURRENT value and leaves the flag as-is.

- Shared resolver (exported from config.ts; provider AND widget both
  consume — no divergence):

```ts
/** Resolve the effective fuzzThreshold for a query mode (PRD §04 trigger
 *  loosening / §08 h2.52): an explicitly configured value overrides both
 *  mode defaults; unset → DEFAULT_FUZZ_THRESHOLD (60) ambient /
 *  TRIGGER_FUZZ_THRESHOLD (45) under the trigger char. */
export function resolveFuzzThreshold(
  config: HapaxConfig,
  mode: "trigger" | "ambient",
): number {
  if (config.fuzzThresholdSet) return config.fuzzThreshold;
  return mode === "trigger"
    ? TRIGGER_FUZZ_THRESHOLD
    : DEFAULT_FUZZ_THRESHOLD;
}
```

  (config.ts already imports DEFAULT_FUZZ_THRESHOLD from query.ts — extend
  that import with TRIGGER_FUZZ_THRESHOLD, the rejectCommonness pattern.)

### 3. TDD cases (extend test/config.test.ts's :351 describe)

Using the existing `writeUserConfig` + `loadConfig(loadOpts())` + `h.warnings`
harness — no new mocking:

1. Fresh default: `loadConfig(loadOpts()).fuzzThresholdSet` is undefined;
   `resolveFuzzThreshold(cfg, "ambient") === 60` and `(..., "trigger") === 45`.
2. Explicit round-trip: `{fuzzThreshold: 80}` → flag true;
   resolves 80 for BOTH modes; zero warnings.
3. Clamps preserve per-mode resolution: `−5` → 0 (resolves 0/0);
   `150` → 100 (100/100); `100.7` → 100; `60.4` → 60 — and explicit 60
   still OVERRIDES trigger's 45: `resolveFuzzThreshold(cfg, "trigger") === 60`
   when set to 60.4→60.
4. Wrong-type repair (`"80"`, `null`, `true` via the existing it.each):
   value repairs to 60, flag stays undefined (per-mode defaults), exactly
   one warning containing "fuzzThreshold", the file path, and "using 60".
5. Layering: user file `{fuzzThreshold: 80}` + project file absent → still
   80/flag true; project file `{fuzzThreshold: 50}` → 50/flag true;
   project file `{fuzzThreshold: "x"}` → value 80 kept, flag stays true,
   one warning. (Use the harness's project-file writing helper if present —
   check the file's helpers; else write `.pi/hapax.json` under the
   loadOpts cwd with projectTrusted: true.)

### Success Criteria

- [ ] All new cases pass; ALL existing config tests pass UNCHANGED
      (especially `loadConfig(loadOpts())` toEqual DEFAULT_CONFIG — the
      flag must be undefined-absent, never initialized to `false`, because
      `toEqual` ignores undefined-valued keys but not explicit false)
- [ ] `TRIGGER_FUZZ_THRESHOLD` exported from query.ts; resolver exported
      from config.ts; no other module duplicates the logic
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed?" — Yes: the exact current applyLayer block, DEFAULT_CONFIG shape,
test harness helpers, layering semantics, the chosen design with its
rationale (both vetted alternatives documented), and the consumer sites
this feeds are all specified.

### Documentation & References

```yaml
- docfile: plan/004_24ebf0115d16/architecture/system_context.md
  section: §Config seam (L140-166)
  why: verified line anchors for HapaxConfig.fuzzThreshold (:73),
        DEFAULT_CONFIG (:101), applyLayer (:261-271), loadConfig (:348-367);
        the two vetted signal designs; the test patterns to extend
        (:359-362 identity, :366-379 clamps, :384-388 repair).
  critical: "Explicit-set is indistinguishable from default — the exact
        gap"; resolution MUST live in ONE shared helper.

- docfile: plan/004_24ebf0115d16/architecture/tier0_design.md
  section: §4 (Per-mode threshold resolution)
  why: the task split (this task = config seam; T2.S2 = call sites),
        resolver signature precedent, pin cases (#cfg → tier-1 at 45).

- file: src/pi/config.ts
  pattern: the rejectCommonness import+default pattern to extend;
        clampNumber round-then-clamp; notify-once repair convention;
        layering via spread (presence-wins).
  gotcha: do NOT initialize fuzzThresholdSet to false in DEFAULT_CONFIG —
        undefined-absent is what keeps toEqual identity tests green.

- file: src/core/query.ts (DEFAULT_FUZZ_THRESHOLD :107, JSDoc :94-106)
  why: the constant's home + JSDoc style to mirror; TIER0 constants from
        T1.S1 live here too — additive edit only.

- file: test/config.test.ts (:351 describe, writeUserConfig/loadOpts/h)
  why: the harness to extend; it.each repair pattern to reuse.

- PRD §04 h2.28 (trigger loosening) + §08 h2.52 (schema row with per-mode
  text) — normative source; schema/spec need NO edit (row already correct).
```

### Current Codebase tree (relevant)

```bash
src/core/query.ts     # DEFAULT_FUZZ_THRESHOLD (+T1.S1 tier-0 constants)
src/pi/config.ts      # HapaxConfig, DEFAULT_CONFIG, applyLayer, loadConfig
test/config.test.ts   # extend the :351 describe
```

### Desired Codebase tree

```bash
src/core/query.ts     # + TRIGGER_FUZZ_THRESHOLD = 45
src/pi/config.ts      # + fuzzThresholdSet internal flag, resolveFuzzThreshold
test/config.test.ts   # + per-mode/layering cases
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// CRITICAL: vitest toEqual ignores undefined-valued properties but NOT
// explicit `false` — the flag must be assigned only when explicit. A
// `fuzzThresholdSet: false` in DEFAULT_CONFIG breaks every identity test.

// CRITICAL: wrong-type repair must NOT set the flag — repaired-from-default
// config must resolve per-mode (45 under trigger), not lock to 60.

// GOTCHA: the flag is a LOAD RESULT field, not a schema key. applyLayer
// reads raw JSON keys; the flag is only ever WRITTEN, never read, there.
// If a user's hapax.json contains "fuzzThresholdSet": true, it must be
// ignored (applyLayer never reads that key — verify no generic key-copy
// exists; it doesn't, applyLayer is per-key explicit).

// GOTCHA: layering is presence-based: a later layer omitting the key keeps
// the earlier layer's explicit value (next spreads forward). Do not "reset"
// the flag per layer.

// GOTCHA: explicit 0 is a legal value (admit everything) — clamp floor 0,
// and resolveFuzzThreshold(0-explicit, any mode) === 0.
```

## Implementation Blueprint

### Implementation Tasks (ordered, TDD)

```yaml
Task 1: ADD TDD cases to test/config.test.ts's :351 describe (red)
  - The 5 case groups above; reuse writeUserConfig/loadOpts/h.warnings.

Task 2: EDIT src/core/query.ts
  - Add TRIGGER_FUZZ_THRESHOLD = 45 as const + JSDoc per the What section.

Task 3: EDIT src/pi/config.ts
  - HapaxConfig.fuzzThresholdSet?: boolean (+internal JSDoc)
  - fuzzThreshold JSDoc: document per-mode semantics (explicit overrides
    both; unset → 60/45) — Mode A docs ride with the work
  - applyLayer: set flag on present-and-number
  - export resolveFuzzThreshold (imports TRIGGER_FUZZ_THRESHOLD)

Task 4: VALIDATE (npm test -- test/config.test.ts; full npm test; check)
```

### Implementation Patterns & Key Details

```ts
// Resolver — single source, consumed by T2.S2 at provider.ts:599-603 and
// widget.ts:437-442 (mode from extractMatchState's discriminated union:
// state.mode === "trigger" ? "trigger" : "ambient").
export function resolveFuzzThreshold(
  config: HapaxConfig, mode: "trigger" | "ambient",
): number {
  if (config.fuzzThresholdSet) return config.fuzzThreshold;
  return mode === "trigger" ? TRIGGER_FUZZ_THRESHOLD : DEFAULT_FUZZ_THRESHOLD;
}
```

### Integration Points

```yaml
CODE: src/core/query.ts (additive constant), src/pi/config.ts (flag + resolver)
TESTS: test/config.test.ts
DOWNSTREAM (do not implement here):
  - P1.M1.T2.S2: provider + widget loose-mode wiring — calls
    resolveFuzzThreshold(config, mode) at both query seams; passes loose:true
    under trigger; chain-arm suppression on tier 0
FROZEN: schema/JSON surface (no new user key), all other config fields,
  query.ts matching logic (T1.S1's tier-0 already landed)
```

## Validation Loop

### Level 1: Syntax

```bash
npm run check
```

### Level 2: Unit tests

```bash
npm test -- test/config.test.ts
npm test        # full suite — config identity tests are the canary
```

### Level 3: Behavior spot-check

```bash
# Fresh default: resolveFuzzThreshold(loadConfig(loadOpts()), "ambient") === 60
#                                            (... , "trigger") === 45
# Explicit 80 → 80/80; explicit 60.4 → 60/60 (trigger NOT 45); repair → 60/45.
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green; existing config tests byte-unchanged
- [ ] Unset → 60 ambient / 45 trigger; explicit → both modes; explicit-60
      overrides trigger 45
- [ ] Repair keeps per-mode defaults + exactly one warning
- [ ] Layering preserves explicitness (presence-wins both directions)
- [ ] Flag never user-facing; no new schema key; §53 untouched
- [ ] Resolver exported once, consumed by no one yet (T2.S2 wires it)

## Anti-Patterns to Avoid

- ❌ Initializing `fuzzThresholdSet: false` in DEFAULT_CONFIG (breaks
  toEqual identity tests)
- ❌ Two resolvers or per-call-site `?? 45` logic — one shared helper only
- ❌ Setting the flag on wrong-type repair, or resetting it per layer
- ❌ Making the mode a boolean (`isTrigger`) — the string union keeps
  future modes expressible and matches extractMatchState's shape
- ❌ Wiring provider/widget in this task (T2.S2 owns the call sites)

---

**Confidence Score: 9/10** — current code shape, both vetted designs, the
chosen one's test-compatibility rationale, layering semantics, and the
consumer contract are all pinned from verified line-anchored recon.
