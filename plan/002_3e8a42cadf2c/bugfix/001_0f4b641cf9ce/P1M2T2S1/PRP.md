---
name: "P1.M2.T2.S1 (bugfix 001_0f4b641cf9ce) — Lower the raw-text bare-run mask floor from 40 to 32 chars"
---

## Goal

**Feature Goal**: Fix the raw-text masking gap in BUG-003's primary leak: the
greedy catch-all `/[0-9a-zA-Z/+]{40,}/g` in `SECRET_WINDOW_RES`
(src/core/shapeGate.ts, index 9, last in claim order) misses the classic
38-char AWS secret access key
`wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY`, leaving unmasked camelCase
fragments (`jalr`, `femik7`, `mden`, `cyexamplekey`) for
`expandCandidates`. Introduce a named constant `BARE_RUN_MIN = 32` and
change the catch-all to `/[0-9a-zA-Z/+]{32,}/g` so the whole key is masked
pre-segmentation (same-length spaces).

**Deliverable**: `BARE_RUN_MIN` constant + tightened regex + updated
comments/JSDoc in `src/core/shapeGate.ts`; TDD cases in
`test/mask-secrets.test.ts` (38-char AWS key fully masked, 31-char boundary
NOT masked, existing 40+ cases unchanged, prose-fixture over-masking audit).

**Success Definition**: `maskSecrets` fully blanks the 38-char AWS key
inside a sentence; a 31-char `[0-9a-zA-Z/+]` run passes through untouched;
all existing mask-secrets cases (incl. the fixture-vocabulary FP guard and
the anchored-prefilter equivalence pins) stay green; the `prose.jsonl`
fixture replay loses no legitimate candidates; `npm run check` +
`npm test` green.

## Why

- BUG-003 (Major, h3.2): pasting the 38-char AWS key admits recognizable
  fragments as completions (`cy` → `CYEXAMPLEKEY`). The whole 38-char token
  IS rejected by the token-level entropy rule — but segmentation splits
  camelCase, so the sub-word fragments (4–12 chars, ≤1 digit) pass every
  gate. The PRD recommendation (h2.5): "lower the bare-run mask to ~32
  chars". Masking pre-segmentation is the correct layer — the fragments
  never reach `expandCandidates`.
- 32 is safely below 38 and safely above anything prose-shaped: unbroken
  32+ `[0-9a-zA-Z/+]` runs are effectively absent from English prose
  (longest real words ~30 with no separators), and 32+ pure-hex runs are
  secret-shaped by intent anyway (the token-level pure-hex rule already
  rejects ≥20 at the gate; this only prevents candidate generation).

## What

1. **Constant**: add `const BARE_RUN_MIN = 32;` near the other baked
   constants in `src/core/shapeGate.ts`, JSDoc'd with the rationale
   (38-char AWS secret access key class; PRD h2.5 recommendation "~32";
   prose-safety argument above; baked/non-configurable per PRD §08).
2. **Regex**: change `SECRET_WINDOW_RES[9]` from
   `/[0-9a-zA-Z/+]{40,}/g` to `/[0-9a-zA-Z/+]{${BARE_RUN_MIN},}/g` built
   via `new RegExp(...)` at module scope (see Gotchas — a template literal
   in a regex literal is impossible; the array is `readonly RegExp[]`, so a
   module-scope `new RegExp` with the `g` flag and a doc comment preserving
   the existing inline comment's intent is the pattern).
3. **Comments (Mode A docs)**: update every comment that says "bare 40" /
   "40+ chars" to say 32 and cite `BARE_RUN_MIN` + the 38-char AWS key
   reason — specifically: the `SECRET_WINDOW_RES` entry comment (≈L442),
   the `SECRET_WINDOW_ANCHORS` JSDoc ("the bare 40-char alnum catch-all,
   index 9" ≈L450), and the inventory JSDoc above the array (≈L412
   "bare-40 catch-all rationale"). Grep for `40` in the masking region and
   sweep every stale mention.
4. **Anchors unchanged**: `SECRET_WINDOW_ANCHORS[9]` stays `[]` — the
   catch-all has no literal anchor and always runs. The prefilter fast path
   is untouched.
5. **Tests (TDD — write the failing test first)** in
   `test/mask-secrets.test.ts`:
   - Direct `maskSecrets` unit case: the AWS key embedded in a sentence
     (`"password wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY trailing"`) → the
     38-char span becomes 38 spaces; surrounding words byte-identical;
     total length preserved.
   - Pipeline case: `processText` the same sentence through the real
     pipeline (reuse the file's `makePipeline`/`storedKeys` helpers) →
     `storedKeys` contains NONE of `jalr`/`femik7`/`mden`/`cyexamplekey`/
     the whole key; `rankMatches(store, "cy")` → `[]` (THE inverted BUG-003
     repro).
   - Boundary: a 31-char `[0-9a-zA-Z/+]` run (e.g. `"a".repeat(31)` or a
     mixed alnum string) is NOT masked — passes through byte-identical.
   - 32-char run IS masked (the new floor).
   - Existing 40+ cases unchanged: the existing suite's 40-char catch-all
     expectations must pass WITHOUT modification (they already exceed 32 —
     verify no test constructs a 32–39-char run EXPECTED to survive; if
     one exists, it is exactly the false positive this task now catches —
     update it and note why in a comment).
   - Prose over-masking audit: replay `test/fixtures/sessions/prose.jsonl`
     (and `large-100k.jsonl` if used by mask-secrets tests) through the
     real pipeline and assert candidate count / key set is unchanged from
     the pre-change baseline (practically: assert common prose words
     present and NO wholesale-masking symptom — e.g. `storedKeys(store)`
     still contains ordinary words; a 32+ unbroken run in prose is
     pathological). Keep this lightweight — one test, prose fixture only.
   - Fixture-vocabulary guard (already exists at ≈L179): must stay green
     (all of `zendesk`/`lwlock`/`nrel`/`f3a9c2e` are < 32 chars).

### Success Criteria

- [ ] 38-char AWS key fully masked (direct + pipeline levels); `cy` query returns nothing
- [ ] 31-char run unmasked; 32-char run masked; 40+ behavior unchanged
- [ ] `BARE_RUN_MIN = 32` named constant, no bare `32` literals elsewhere
- [ ] All "40" comment mentions updated; `SECRET_WINDOW_ANCHORS[9]` still `[]`
- [ ] Prose fixture loses no legitimate candidates; full suite green

## All Needed Context

### Context Completeness Check

An implementer with no prior knowledge needs: the exact current structure of
`SECRET_WINDOW_RES`/`SECRET_WINDOW_ANCHORS`/`maskSecrets` (quoted below),
the BUG-003 repro strings, the test-file helper names, the fixture
inventory, and the downstream/boundary contracts (S2 sibling, S3 battery).
All below.

### Documentation & References

```yaml
- file: src/core/shapeGate.ts
  why: THE file. SECRET_WINDOW_RES ≈L432 (catch-all at index 9, ≈L442:
        `/[0-9a-zA-Z/+]{40,}/g` with the "AWS secret bare run — greedy
        catch-all, LAST" comment); SECRET_WINDOW_ANCHORS ≈L457 (index 9 =
        [], unanchored, always runs); maskSecrets() ≈L474+ (anchor
        prefilter loop then per-rule replace with same-length spaces);
        inventory JSDoc ≈L412 mentions "bare-40 catch-all rationale".
  pattern: module-scope baked constants + doc comments; precompiled
           module-scope regexes (String.replace resets /g lastIndex —
           no shared mutable state; preserve this by building the new
           regex ONCE at module scope).
  gotcha: isSecretShaped's token-level rules (L150-260) are NOT touched —
          this task changes ONLY the raw-text masking floor. Sibling
          P1.M2.T2.S2 (sub-word propagation) builds on this change but is
          NOT in scope.

- file: test/mask-secrets.test.ts
  why: THE test file to extend. Verified helpers/conventions: makePipeline
        + storedKeys + rankMatches pipeline-level guards; the
        fixture-vocabulary FP guard at ≈L179 ("the bare-40-char catch-all
        did NOT eat any of them" — update this comment to cite 32/BARE_RUN_MIN);
        direct maskSecrets unit cases with length-preservation asserts.
  pattern: describe/it, vitest, ESM .js imports, per-case comments
           explaining WHY.

- file: test/fixtures/sessions/
  why: prose.jsonl (prose over-masking audit), large-100k.jsonl,
        zendesk-lwlock.jsonl, zephyr-chain.jsonl, expected.md. Only
        prose.jsonl needs replaying here; do NOT add fixtures.

- docfile: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/core-engine-findings.md
  why: Research note cited by the work item: SECRET_WINDOW_RES ≈L410,
        catch-all last in claim order, no anchor prefilter, the 38-char
        AWS key slips past, leaving unmasked camelCase fragments for
        expandCandidates.

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/prd_snapshot.md
  section: h2.2/h3.2 (Issue 3, BUG-003) + h2.5 recommendation bullet 3
  why: Authoritative spec: "lower the bare-run mask to ~32 chars".

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M2T1S3/PRP.md
  why: Sibling in flight (NREL acceptance pin). Uses the SAME test
        infrastructure but different fixtures — no overlap with this task.
        Your change must not alter nrel/zephyr ingestion (all their words
        are far below 32 chars).
  gotcha: do not touch acceptance.test.ts — P1.M2.T1.S3 owns it right now.
```

### Current Codebase tree (relevant)

```bash
src/core/shapeGate.ts       # MODIFY: BARE_RUN_MIN, regex {32,}, comment sweep
test/mask-secrets.test.ts   # EXTEND: TDD cases + prose audit
test/fixtures/sessions/     # read-only (prose.jsonl replay)
```

### Desired Codebase tree with files added

```bash
# no new files
src/core/shapeGate.ts       # BARE_RUN_MIN = 32; catch-all floor 40 → 32
test/mask-secrets.test.ts   # + describe for the lowered floor + audit
```

### Known Gotchas of our Codebase & Library Quirks

```typescript
// REGEX LITERAL CAN'T TAKE A CONSTANT: `/[0-9a-zA-Z/+]{${BARE_RUN_MIN},}/g`
// is not a regex literal — build it at MODULE SCOPE with
//   new RegExp(`[0-9a-zA-Z/+]{${BARE_RUN_MIN},}`, "g")
// exactly ONCE (the existing code's no-shared-mutable-state property:
// String.replace with a /g regex resets lastIndex; module-scope singleton
// preserves the precompiled-regex perf profile). SECRET_WINDOW_RES is
// `readonly RegExp[]` — a RegExp object satisfies it fine.

// THE CATCH-ALL IS LAST IN CLAIM ORDER and UNANCHORED (anchors index 9 =
// []). Do not reorder; earlier structured rules (AKIA/ghp_/sk-/ey... )
// claim their windows first — lowering the floor must not let the
// catch-all steal a window a structured rule would otherwise claim with a
// tighter bound. Since masking blanks matched spans with spaces, a
// 32-char catch-all hit inside what would have been a 36-char sk-proj
// payload could pre-empt... check rule order: sk- rule (index 7) runs
// BEFORE the catch-all (index 9), so structured rules still win. Keep it
// last.

// 38-CHAR KEY IS ALSO A <40 TOKEN: after masking, zero candidates derive
// from the key — that's the point. But do NOT also try to "fix" the
// token-level rules here (sub-word propagation is P1.M2.T2.S2, synthetic
// battery is P1.M2.T2.S3). Scope: one constant, one regex, comments,
// tests.

// PROSE SAFETY ARGUMENT (put it in the JSDoc): longest unbroken English
// words are ~30 chars (antidisestablishmentarianism = 28); URLs contain
// '://' or '.' which break the [0-9a-zA-Z/+] run; hexish tokens 6–40 with
// letters are ≤40 and only pathological ones reach 32 — and 32+ pure-hex
// is private-key-shaped by intent (gate rule 5 rejects ≥20 anyway).

// f3a9c2e (7 chars), zendesk (7), lwlock (6), NREL (4): all far below the
// floor — the existing fixture-vocabulary guard doubles as the FP pin.

// test/mask-secrets.test.ts's FP-guard comment (~L181) says "the bare-40-
// char catch-all" — update to 32/BARE_RUN_MIN so it doesn't mislead.

// A 31/32 boundary test: use a MIXED alnum string (e.g. "a1B2c3..." ×N),
// not "a".repeat(31) alone — "a".repeat(31) would also be gate-rejected
// by unigramRun later; the masking assertion should be about maskSecrets
// alone, and any 31-char string is fine for THAT, but mixed-case makes
// the intent clearer.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: TDD — write the failing tests first in test/mask-secrets.test.ts
  - ADD describe("bare-run mask floor 32 (BUG-003 h3.2)") with the 5 cases
    from "What" §5 (AWS key direct + pipeline, 31 boundary, 32 floor,
    prose audit). Run: they FAIL (38-char key leaks, 32 unmasked).

Task 1: MODIFY src/core/shapeGate.ts
  - ADD: /** Min length of the raw-text bare alnum run the greedy
      catch-all masks. 32 sits below the 38-char classic AWS secret access
      key (the class BUG-003 h3.2 targets) and above anything prose-shaped
      (longest English words ~28-30; punctuation/'.'/'://' break runs).
      Baked per PRD §08. */ const BARE_RUN_MIN = 32;
  - BUILD: const BARE_ALNUM_RUN_RE = new RegExp(`[0-9a-zA-Z/+]{${BARE_RUN_MIN},}`, "g");
  - REPLACE SECRET_WINDOW_RES[9]'s literal with BARE_ALNUM_RUN_RE
    (keep its trailing comment, updated: "AWS secret bare run — greedy
    catch-all, LAST; floor BARE_RUN_MIN=32 (38-char AWS secret class)")
  - SWEEP comments: grep -n "40" src/core/shapeGate.ts — update the
    inventory JSDoc (≈L412), the anchors JSDoc (≈L450), and any other
    masking-region mention to cite BARE_RUN_MIN/32.
  - DO NOT TOUCH: SECRET_WINDOW_ANCHORS[9] ([]), the prefilter loop,
    isSecretShaped, rules 6/7, maskSecrets' replace semantics.

Task 2: EXTEND test/mask-secrets.test.ts to green
  - Verify Task 0 cases now pass; update the FP-guard comment (~L181);
    scan existing cases for any 32–39-char run EXPECTED to survive (update
    with a comment if found — it is the false positive class this task
    now catches).

Task 3: VALIDATE
  - npm run check
  - npx vitest --run test/mask-secrets.test.ts -v
  - npm test   # full suite — P1.M2.T1.S3's acceptance tests (in flight)
               # must stay green: all NREL/zephyr words are << 32 chars
```

### Implementation pattern

```typescript
// Module scope, near SECRET_WINDOW_RES (sketch)
/** (JSDoc per Task 1) */
const BARE_RUN_MIN = 32;
/** Greedy catch-all run, precompiled once — String.replace resets /g. */
const BARE_ALNUM_RUN_RE = new RegExp(`[0-9a-zA-Z/+]{${BARE_RUN_MIN},}`, "g");

const SECRET_WINDOW_RES: readonly RegExp[] = [
  /* ...rules 1–8 unchanged... */
  BARE_ALNUM_RUN_RE, // AWS secret bare run — greedy catch-all, LAST
];
```

### Integration Points

```yaml
NONE this task:
  - Constant/regex floor change inside maskSecrets; the #admitSegment seam,
    anchor prefilter, and token-level rules untouched.
  - Downstream (do NOT implement): P1.M2.T2.S2 propagates whole-token
    secret rejection to sub-word drafts (builds on this task but separate);
    P1.M2.T2.S3 runs the synthetic-token paste battery (npm/glpat/sk_live/
    Bearer fragments never offered) consuming this tightened mask;
    P1.M4.T1.S1 re-verifies the full suite.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/mask-secrets.test.ts -v   # all cases green
npm test                                        # full suite green
```

### Level 3: Integration

None beyond the pipeline-level cases in mask-secrets.test.ts (real
IngestPipeline + real store already exercised there). The e2e battery is
P1.M2.T2.S3's deliverable.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green (incl. in-flight P1.M2.T1.S3 acceptance tests)

### Feature Validation

- [ ] 38-char AWS key fully masked at both direct and pipeline levels; `rankMatches(store,"cy")` → `[]`
- [ ] 31-char run passes through; 32-char run masked; existing 40+ cases unchanged
- [ ] Prose fixture replay loses no legitimate candidates
- [ ] `BARE_RUN_MIN` named constant used; no stale "40" comments in the masking region
- [ ] Catch-all still LAST in SECRET_WINDOW_RES; anchors[9] still `[]`

### Code Quality Validation

- [ ] Regex built once at module scope (precompiled profile preserved); no per-call construction
- [ ] JSDoc (Mode A) documents the 32 floor and the 38-char AWS secret rationale
- [ ] No config surface; token-level rules and sibling-scope code untouched

## Anti-Patterns to Avoid

- ❌ Don't touch `isSecretShaped` rules 6/7 or the anchor prefilter — one floor constant is the whole change
- ❌ Don't move the catch-all from LAST position or give it anchors
- ❌ Don't construct the regex per call or inside maskSecrets — module scope, once
- ❌ Don't add fixtures or touch acceptance.test.ts (P1.M2.T1.S3's in-flight file)
- ❌ Don't implement sub-word propagation (P1.M2.T2.S2) or the synthetic battery (P1.M2.T2.S3)
- ❌ Don't make the floor configurable (PRD §08: baked constants)
