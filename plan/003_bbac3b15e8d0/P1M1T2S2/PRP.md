# PRP — P1.M1.T2.S2 (plan 003): Shape-gate path-class cap 4–96 + secret/entropy application

---

## Goal

**Feature Goal**: Give `passesShape` (src/core/shapeGate.ts) a
**class-conditional cap mechanism** keyed on the new
`CandidateDraft.path` flag (P1.M1.T2.S1): path drafts require post-trim
key length **4–96** (floor 4 — not the global MIN_LENGTH 2; ceiling 96 —
not MAX_WHOLE_LENGTH 64; this class only, all other classes unchanged).
Secret and entropy rules apply to path drafts **unchanged** — verified by
test: a URL-ish display with `@`+`.` rejects the whole candidate; a
base64url-texture path segment rejects whole (conservative, spec'd); an
ordinary deep path admits.

**Deliverable**:
- `src/core/shapeGate.ts`: path-keyed min/max in `passesShape` (+ JSDoc
  citing spec/04 rule 4d / h2.25 rule 1), new private constants
  (`PATH_MIN_LENGTH = 4`, `PATH_MAX_LENGTH = 96`).
- TDD cases in `test/shapeGate.test.ts`: path cap 96/97 boundary, floor 4,
  accept/reject texture cases per spec §09 h2.25 bullets.

**Success Definition**: `npm run check` + `npm test` green; path drafts
with 4–96-char keys and clean texture pass; 97+ or <4 reject (`tooLong`/
`tooShort`); all existing (non-path) gate behavior byte-identical; gated
path drafts flow to P1.M1.T2.S3.

## Why

- Spec/04 h2.25 rule 1: "whole-token candidates must be 2–64 chars
  (**path-class candidates 4–96**, rule 4d)". Today `passesShape`
  (shapeGate.ts:171–194) selects caps by `draft.isSubword` ONLY — a 96-char
  path key would die `tooLong` under MAX_WHOLE_LENGTH=64. The gate is the
  spec's stated home for the cap; S1's `classifyPath` length check is
  segmentation-side pre-filtering, not the contract holder.
- The 4 floor exists because sub-4 path fragments (e.g. `a/b` key after
  trim) are noise; the 96 ceiling matches the widened literal scan window.
- Secret/entropy application must be *verified*, not assumed: paths are
  letter-bearing (entropy floor applies as-is via the existing
  `/[a-z]/.test(key)` guard), and `isSecretShaped(draft.display)` sees the
  ORIGINAL edge symbols — both behaviors are spec'd and need regression pins.

## What

Edit `passesShape` — replace the single max line with class-conditional
bounds; nothing else in the function changes:

```ts
// Current (shapeGate.ts ~L174):
const max = draft.isSubword ? MAX_SUBWORD_LENGTH : MAX_WHOLE_LENGTH;
// Becomes:
const min = draft.path ? PATH_MIN_LENGTH : MIN_LENGTH;
const max = draft.path
  ? PATH_MAX_LENGTH
  : draft.isSubword ? MAX_SUBWORD_LENGTH : MAX_WHOLE_LENGTH;
if (key.length < min) return { ok: false, reason: "tooShort" };
if (key.length > max) return { ok: false, reason: "tooLong" };
```

All downstream rules in `passesShape` (secret → entropy → unigramRun →
consonantRun) run unchanged for path drafts. Add module constants
`PATH_MIN_LENGTH = 4` / `PATH_MAX_LENGTH = 96` (private, same style as
MIN_LENGTH/MAX_WHOLE_LENGTH) + JSDoc on the branch citing spec/04 rule 4d
and h2.25 rule 1.

### Success Criteria

- [ ] Path key 96 chars → `{ok: true}`; 97 chars → `{ok:false, reason:"tooLong"}`
- [ ] Path key 3 chars → `tooShort` (floor 4, not MIN_LENGTH 2)
- [ ] URL-ish path display containing `@` and `.` → `secret` reject (whole candidate)
- [ ] Base64url-texture segment inside a path display → `secret` reject (conservative whole reject)
- [ ] Ordinary deep path (`src/core/query.ts`, `/home/user/projects/hapax` trimmed key) → `{ok:true}`
- [ ] `a/a/a/a`-shaped path → `lowEntropy` (letter-bearing floor applies)
- [ ] Non-path behavior identical: existing length/entropy/secret suites pass unchanged (base 2–64, subword 2–32)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they implement this
successfully?" — Yes: the exact current passesShape body, constants and
line anchors, the upstream draft shape, the test helper, and the full case
list are reproduced below.

### Documentation & References

```yaml
- file: src/core/shapeGate.ts
  why: THE edit site. Verified live source:
        L68 `const MIN_LENGTH = 2;`  L71 `const MAX_WHOLE_LENGTH = 64;`
        L73 `const MAX_SUBWORD_LENGTH = 32;`
        passesShape L171–194: caps line, then length checks, then
        `isSecretShaped(draft.display)`, then entropy floor guarded by
        `/[a-z]/.test(key) && charEntropy(key) < MIN_ENTROPY_BITS`, then
        unigramRun, consonantRun. Reason precedence: length → secret →
        entropy → unigramRun → consonantRun (keep).
  pattern: add PATH_MIN_LENGTH/PATH_MAX_LENGTH as module consts next to
        the existing trio, same JSDoc style.
  gotcha: isSecretShaped runs on draft.display — for path drafts display
        is the ORIGINAL untrimmed raw (leading '/', '../', ':42:13' all
        present). That is deliberate (conservative, spec'd) — do not
        switch it to key.

- file: plan/003_bbac3b15e8d0/P1M1T2S1/PRP.md
  why: CONTRACT (parallel, in flight): segment.ts emits path drafts
        { key: trimmed lowercase, display: ORIGINAL raw, path: true,
        isSubword: false, properName: false }; types.ts gains
        CandidateDraft.path?: boolean. Consume; do not redefine.

- docfile: plan/003_bbac3b15e8d0/architecture/r2-path-candidates.md
  section: §2 (gate analysis)
  why: confirmed "no per-class cap mechanism today"; entropy floor
        applies to paths as letter-bearing keys; isSecretShaped rule
        inventory (prefixes, '@'+'.', base64 ≥24, hex ≥20, decimal ≥16,
        base64url ≥16 mixed+digits, charset-relative entropy).

- file: test/shapeGate.test.ts
  why: conventions. Existing helper (L~26):
        const draft = (key: string, isSubword = false): CandidateDraft =>
          ({ key, display: key, properName: false, isSubword,
             ...(isSubword ? { parentKey: "p" } : {}) });
        ADD a pathDraft(key, display?) variant: { key, display: display
        ?? key, properName: false, isSubword: false, path: true }.
        Suite style: per-rule describe blocks, exact {ok,reason} equality
        assertions.

- PRD §09 h2.25 shapeGate bullets + §04 h2.25 rule 1 (selected content)
  why: normative case list (65+ chars base / path rejects above 96,
        rule 4d; accept zendesk/lwlock/NREL/f3a9c2e unchanged).
```

### Current Codebase tree (relevant)

```bash
src/core/shapeGate.ts     # ← edit (passesShape + 2 constants)
test/shapeGate.test.ts    # ← TDD cases
src/core/types.ts         # path flag arrives from S1 (parallel)
```

### Desired Codebase tree

```bash
src/core/shapeGate.ts     # class-conditional caps
test/shapeGate.test.ts    # +path describe block
```

### Known Gotchas of our Codebase & Library Quirks

```ts
// GOTCHA: a 97-char path KEY cannot come from the real pipeline (the
// literal scan window is 96 and trim only shortens) — the gate test
// constructs the draft DIRECTLY. That's correct: the gate is the
// contract holder; segment-side checks are pre-filtering.

// GOTCHA: floor 4 for paths while base floor is 2 — do not touch
// MIN_LENGTH; branch on draft.path first (path drafts are never
// subwords, isSubword:false pinned by S1 — no precedence question).

// CRITICAL: '/' is not [a-z], but real path keys contain letters, so the
// existing /[a-z]/ guard admits them to the entropy floor — 'a/a/a/a'
// dies lowEntropy exactly per spec. Do NOT special-case entropy for paths.

// GOTCHA: keep the reason precedence contract (length → secret → entropy
// → …) — a 97-char base64url path asserts tooLong, not secret.
```

## Implementation Blueprint

### Implementation Tasks (ordered, TDD)

```yaml
Task 1: ADD path cases to test/shapeGate.test.ts (red)
  - Helper: const pathDraft = (key: string, display = key): CandidateDraft
    => ({ key, display, properName: false, isSubword: false, path: true });
  - describe("passesShape — path-class caps (rule 4d, 4–96)"):
    1. pathDraft("src/core/query.ts") → {ok:true} (ordinary deep path admits)
    2. pathDraft("/home/user/projects/hapax".slice(1)) → {ok:true}
       (trimmed key form)
    3. cap boundary: pathDraft("a/".padEnd(97, "b").replace(...)) — build a
       96-char key with ≥2 slashes → {ok:true}; a 97-char key →
       {ok:false, reason:"tooLong"}
    4. floor: pathDraft("a/b") (3 chars) → {ok:false, reason:"tooShort"}
       — and confirm draft("ab") (base, non-path) still hits entropy
       lowEntropy, NOT tooShort (floor 2 unchanged for base)
    5. secret '@'+'.': pathDraft("example.com/a/b",
       display="user@example.com/a/b") → {ok:false, reason:"secret"}
    6. base64url-texture segment: pathDraft with display containing a
       ≥16-char [A-Za-z0-9_-] run w/ lower+upper+≥2 digits
       (e.g. "src/aB12xY34zQ56wE78/b") → {ok:false, reason:"secret"}
       (conservative whole reject, spec'd)
    7. entropy: pathDraft("a/a/a/a") → {ok:false, reason:"lowEntropy"}
    8. precedence: a 97-char key whose display is also base64url-shaped →
       tooLong (length first)
  - Also pin base-class non-regression: 65-char non-path key still tooLong
    (may already exist — extend only if missing).

Task 2: EDIT src/core/shapeGate.ts
  - Add PATH_MIN_LENGTH=4 / PATH_MAX_LENGTH=96 consts (+JSDoc citing
    spec/04 rule 4d, h2.25 rule 1).
  - Class-conditional min/max in passesShape per the What section; update
    the passesShape JSDoc length bullet to mention the path class.
  - Nothing else: isSecretShaped, entropy guard, run rules untouched.

Task 3: VALIDATE
```

### Implementation Patterns & Key Details

```ts
// Boundary key builders (deterministic):
const key96 = "src/" + "a".repeat(92) + "/x";        // length 96, ≥2 slashes
const key97 = "src/" + "a".repeat(93) + "/x";        // length 97
// Entropy note: 'a'-runs would die lowEntropy/unigramRun BEFORE the cap
// matters — use ALTERNATING letters ("ab".repeat(46)) so ONLY the length
// rule can fire. Same for the 97 case.
const key96 = "src/" + "ab".repeat(45) + "z";        // 4+90+1 = 95… adjust to exactly 96/97
```

### Integration Points

```yaml
CODE: src/core/shapeGate.ts only
TESTS: test/shapeGate.test.ts
CONSUMES: CandidateDraft.path (types.ts, from S1 — parallel; if not yet
          landed, the field is optional so tests can construct it inline;
          the gate reads draft.path defensively as truthy/undefined)
DOWNSTREAM: P1.M1.T2.S3 (store display flow) receives only gated path drafts
FROZEN: segment.ts, types.ts, score.ts, store.ts, query.ts, isSecretShaped body
```

## Validation Loop

### Level 1–2

```bash
npm run check
npx vitest --run test/shapeGate.test.ts
npm test        # full suite — segment path cases (S1) may land in parallel
```

### Level 3: Behavior spot-check

```bash
# Ordinary path admits; 97 tooLong; 3 tooShort; '@'+'. display secret;
# a/a/a/a lowEntropy; base class 65+ still tooLong (non-path).
```

## Final Validation Checklist

- [ ] `npm run check` + `npm test` green
- [ ] Path caps 4–96 with floor 4 ≠ global MIN_LENGTH; 96/97 boundary pinned
- [ ] Secret rules verified on path displays ('@'+'.', base64url texture → whole reject)
- [ ] Entropy floor applies to letter-bearing path keys ('a/a/a/a' lowEntropy)
- [ ] Reason precedence preserved (length before secret)
- [ ] Base/subword caps byte-identical (existing suites untouched)
- [ ] Diff confined to shapeGate.ts + shapeGate.test.ts

## Anti-Patterns to Avoid

- ❌ Replacing/augmenting isSecretShaped or the entropy guard with
  path-specific variants — they apply unchanged
- ❌ Running isSecretShaped on key instead of display (loses original edges)
- ❌ Boundary keys built from single-letter runs (die on unigram/entropy
  before the cap fires) — use alternating letters
- ❌ Changing MIN_LENGTH/MAX_WHOLE_LENGTH globals instead of branching
- ❌ Touching segment.ts/types.ts (S1 owns, in flight)

---

**Confidence Score: 9/10** — live-source-anchored edit site, exact case
list, precedence contract, and the one subtlety (boundary-key construction
avoiding earlier-firing rules) are all specified.
