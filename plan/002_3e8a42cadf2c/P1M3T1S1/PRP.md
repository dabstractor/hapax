# PRP — plan 002 P1.M3.T1.S1: config.ts — enableChaining primary key, enablePhrases alias, precedence, test rewrite

## Goal

**Feature Goal**: Bring `src/pi/config.ts` to PRD §08 (h2.46, current revision):
the config's fourth key becomes **`enableChaining: boolean` (default `true`)**,
gating ONLY the successor-index chain layer. `enablePhrases` is accepted as a
**deprecated alias**, resolved per-layer inside `applyLayer` (alias first, then
`enableChaining` overrides when present and valid — so `enableChaining` wins
when both appear, in-layer or across layers). Validation is unchanged
(real-boolean-only; repair invalid values to the previous value with one
notify per field), plus an optional one-time deprecation notify when only the
alias key is present. Rewrite the boolean-field test cases in
`test/config.test.ts` accordingly.

**Deliverable**:
1. Modified `src/pi/config.ts` — `enableChaining` field (+ transitional
   `enablePhrases` mirror, see Design Decision below), alias-aware
   `applyLayer`, deprecation notify, JSDoc.
2. Rewritten boolean-field cases in `test/config.test.ts`.
3. Updated `README.md` Configuration **table row** (Mode A, rides here per R5).

**Success Definition**: `npm run check` and `npm test` green (this task must
NOT break the still-un-re-pointed `config.enablePhrases` reads in index.ts /
provider.ts — that is S2's work); alias-only config resolves identically to
the primary key; both-present → `enableChaining` wins; defaults remain
`#, 2, 8, true(chaining), false(debug)`.

## Why

- The M2 redesign (PRD 002) replaced the phrase layer with successor-index
  chaining; PRD §08 h2.46 now specifies `enableChaining` with
  `enablePhrases` as a deprecated alias. Existing user configs
  (`enablePhrases: false`) must keep working (mapped to chaining off) and get
  one deprecation warning.
- Word completion is unaffected either way (PRD h2.46) — the flag gates only
  the chain layer (bigram capture + successor index + armed branch), exactly
  what index.ts's `onAdmittedTokens` spread gate and provider.ts's armed
  branch consume (re-pointed from `enablePhrases` to `enableChaining` in
  **P1.M3.T1.S2**, together with the enableChaining-inertness suite).
- Config surface stays deliberately tiny; nothing from h2.47 becomes
  configurable.

## ⚠️ Key Design Decision (read first): transitional mirror field

`src/pi/index.ts:180` and `src/pi/provider.ts:261,398` currently read
`config.enablePhrases` and will NOT be re-pointed until S2. If this task
removes the field, `npm run check` breaks between the two subtasks. Therefore:

- `HapaxConfig` gets **both** fields after this task:
  ```ts
  enableChaining: boolean;  // PRIMARY (PRD §08 h2.46) — gates the successor-
                            // index chain layer ONLY; word completion
                            // unaffected either way.
  enablePhrases: boolean;   // TRANSITIONAL MIRROR of enableChaining (same
                            // resolved value every time) so pre-S2 gate reads
                            // keep compiling. DEPRECATED as a config KEY;
                            // removed from this interface by P1.M3.T1.S2,
                            // which re-points all reads to enableChaining.
  ```
- `DEFAULT_CONFIG`: `enableChaining: true, enablePhrases: true`.
- `applyLayer` resolves the pair ONCE (alias → override) and writes the same
  value into BOTH fields of the result, so the two can never diverge.
- S2 will delete `enablePhrases` from the interface, DEFAULT_CONFIG, and all
  gate reads. Do not do that here.

## What

### Behavior contract

1. **Resolution order inside `applyLayer`** (replaces the current
   `enablePhrases`-only block at src/pi/config.ts L197–208):
   ```ts
   // Deprecated alias first (PRD §08 h2.46): a valid boolean enablePhrases
   // sets the resolved chaining value; an invalid one repair-notifies naming
   // enablePhrases exactly like any other field.
   if ("enablePhrases" in raw) {
     const v = raw.enablePhrases;
     if (typeof v === "boolean") {
       next.enableChaining = v;
       notify(`hapax: enablePhrases is deprecated; use enableChaining (mapped)`, "warning");
     } else {
       notify(`hapax: invalid enablePhrases in ${filePath}, using ${formatValue(current.enableChaining)}`, "warning");
     }
   }
   // Primary key second: overrides the alias when present and valid.
   if ("enableChaining" in raw) {
     const v = raw.enableChaining;
     if (typeof v === "boolean") {
       next.enableChaining = v;
     } else {
       notify(`hapax: invalid enableChaining in ${filePath}, using ${formatValue(current.enableChaining)}`, "warning");
     }
   }
   next.enablePhrases = next.enableChaining; // transitional mirror (S2 removes)
   ```
   Consequences to pin in tests:
   - Alias-only layer: resolved value = alias value, plus the deprecation
     notify (one per layer that uses the alias — "one-time" per layer/file,
     matching the existing per-field-per-layer notify mechanism).
   - Both keys in one layer: `enableChaining` wins (written second).
   - `enableChaining` in an earlier layer, alias in a later layer: the later
     layer's alias wins (ordinary later-wins on the resolved value).
   - Alias in earlier layer, `enableChaining` in later layer: later primary
     wins.
   - Invalid alias + valid primary in the same layer: primary applies AND the
     alias repair-notify fires (one per field, per existing shape).
   - Valid alias + INVALID primary in the same layer: alias value applies,
     primary repair-notifies (repair target = the alias-resolved value, i.e.
     `current.enableChaining` after the alias block ran — careful with the
     `formatValue(current.…)` in the primary's repair message; simplest
     correct form: keep `current.enableChaining` (pre-layer value) OR the
     alias-resolved `next.enableChaining` — pick the alias-resolved
     `next.enableChaining` and note it in a comment, since that is the value
     actually kept).
2. **Everything else unchanged**: triggerChar/threshold/maxSuggestions/debug
   blocks, layer read order, malformed-file handling, unknown-key silence,
   fresh-copy return semantics, node-builtin-only imports.
3. **README.md** (Mode A): in the Configuration table (~L316), replace the
   `enablePhrases` row with:
   `| enableChaining | boolean | true | true / false | gates chained (successor) completion only; word completion unaffected either way; "enablePhrases" is accepted as a deprecated alias and is mapped to this key |`
   Do NOT rewrite the prose mentions at L15/L118/L369 — the M4.T2
   documentation sweep owns those (avoid scope creep / merge conflicts).

## All Needed Context

### Documentation & References

```yaml
- file: src/pi/config.ts
  why: the module under change — HapaxConfig (L36–45), DEFAULT_CONFIG (L47–53),
        applyLayer boolean block (L197–208), notify/formatValue helpers
  pattern: per-key "k" in raw blocks; boolean-only acceptance; repair-notify
           message shape `hapax: invalid <field> in <path>, using <value>`

- file: src/pi/index.ts
  why: L175–180 — the onAdmittedTokens spread gate reads config.enablePhrases
        with a comment naming THIS task's successor (S2 re-points it)
  gotcha: do NOT touch index.ts/provider.ts in this task; the mirror field
          exists precisely so those reads keep compiling

- file: test/config.test.ts
  why: fixture helpers to reuse (writeUserConfig/writeProjectConfig, loadOpts,
        warnings array); boolean cases at ~L311 to rewrite; default-object
        literals at L91/L124 and precedence assertions at L125/L144 to update

- file: README.md
  why: Configuration table row to replace (~L316)

- docfile: plan/002_3e8a42cadf2c/architecture/pi_layer_map.md
  why: §2 documents the config module layout this task follows
  section: §2

- file: plan/002_3e8a42cadf2c/P1M2T2S2/PRP.md
  why: parallel item touching provider.ts only — confirms no overlap with
        config.ts / config.test.ts
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: keep enablePhrases on HapaxConfig as a mirror (same value) —
// index.ts:180 + provider.ts:261,398 still read it until S2. Removing it
// here breaks `npm run check` mid-milestone.
// CRITICAL: applyLayer must set BOTH fields at the END of the pair logic
// (next.enablePhrases = next.enableChaining) so they can never diverge.
// Notify level is exactly "warning"; messages start with "hapax:".
// Deprecation notify fires per layer that uses the alias (matches the
// existing per-field-per-layer notify mechanism); NOT per process load.
// NodeNext: .js import extensions in tests.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/pi/config.ts — interface + defaults
  - ADD enableChaining to HapaxConfig with the JSDoc above (Mode A docs)
  - KEEP enablePhrases with the "transitional mirror" JSDoc (S2 removes)
  - DEFAULT_CONFIG: enableChaining: true, enablePhrases: true
  - UPDATE the module header doc-comment: mention alias mapping + mirror

Task 2: MODIFY src/pi/config.ts — applyLayer pair logic
  - REPLACE the enablePhrases-only block with the alias→primary sequence
    shown in "What" §1 (deprecation notify, repair messages, mirror write)

Task 3: REWRITE test/config.test.ts boolean cases
  - FOLLOW pattern: existing suite (fixtures, loadOpts, warnings array,
    header doc-comment style)
  - UPDATE the two default-object literals (L91, L124) to include both
    enableChaining and enablePhrases = true/false
  - REPLACE the enablePhrases describe block with:
    * primary key parsed: { enableChaining: false } → both fields false,
      no warnings
    * alias mapped: { enablePhrases: false } → both fields false + exactly
      one deprecation warning
    * both present, same layer: { enablePhrases: true, enableChaining: false }
      → enableChaining wins (both fields false); deprecation warning still
      fires (alias was present+valid)
    * both present, reversed: { enablePhrases: false, enableChaining: true }
      → true
    * cross-layer: alias in user, primary in project → project primary wins;
      primary in user, alias in project → project alias wins
    * alias invalid ("yes") alone → repair-notify naming enablePhrases,
      value unchanged from defaults
    * alias valid + primary invalid in same layer → alias value applies +
      repair-notify naming enableChaining
    * defaults fresh-copy: mutate cfg.enableChaining; DEFAULT_CONFIG untouched
  - KEEP all non-boolean suites unchanged (they may need literal updates only)

Task 4: MODIFY README.md — the Configuration table row only (see What §3)
```

### Integration Points

```yaml
# No new integration. Consumers AFTER S2: index.ts onAdmittedTokens gate and
# provider.ts armed-branch gates read config.enableChaining. This task only
# produces the field + alias resolution; the mirror keeps old reads alive.
# No config file format change beyond the documented alias.
```

## Validation Loop

### Level 1: Syntax & Style
```bash
npm run check        # tsc --noEmit — zero errors (proves the mirror works)
```

### Level 2: Unit Tests
```bash
npx vitest --run test/config.test.ts
npm test             # full suite green — index/provider read paths unaffected
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green
- [ ] `HapaxConfig.enableChaining` exists, default true; `enablePhrases`
      mirror holds the same resolved value everywhere
- [ ] Alias-only → mapped + one deprecation warning; both-present (any layer
      combination) → `enableChaining` wins per later-wins/override rules
- [ ] Invalid values repair-notify with the existing message shape
- [ ] No changes to index.ts / provider.ts (S2's scope)
- [ ] README Configuration table row updated; prose mentions left for M4.T2
- [ ] No new configurable constants (h2.47 respected); notify level "warning"
- [ ] config.ts still imports only node builtins

## Anti-Patterns to Avoid

- ❌ Don't delete `enablePhrases` from HapaxConfig — the mirror is what keeps
  the milestone green until S2
- ❌ Don't resolve the alias in `loadConfig` after layering — per-layer
  resolution is required for the precedence semantics
- ❌ Don't truthy-coerce the booleans or skip the deprecation notify
- ❌ Don't rewrite README prose beyond the table row (M4.T2 owns the sweep)
- ❌ Don't add tests colocated in src/ — tests live in test/

**Confidence Score: 9/10** — exact current code (line-level), alias semantics,
and the transitional-mirror constraint are all verified against the live
source and the S2 boundary; the only residual risk is test-literal churn,
which Task 3 enumerates exhaustively.