---
name: "P1.M2.T1.S1 (bugfix 001_9e0f97150b68) — maskSecrets() window scan wired into #admitSegment"
---

## Goal

**Feature Goal**: Close BUG-003's primary leak path by masking structured
secret windows in the RAW segment string BEFORE tokenization, so key bytes
never reach `tokenize()` and can never become candidates. Adds exported
`maskSecrets(segment: string): string` to `src/core/shapeGate.ts` and wires
it at the top of `IngestPipeline.#admitSegment` in `src/pi/ingest.ts`.

**Deliverable**:
- `maskSecrets()` export in `src/core/shapeGate.ts` (always-on,
  non-configurable, JSDoc'd rule inventory)
- One-line seam in `src/pi/ingest.ts` `#admitSegment`
- Unit + pipeline tests: every PRD-quoted probe key fully masked with zero
  candidates from masked spans; false-positive guards for normal prose,
  URLs, and fixture vocabulary

**Success Definition**: After `processText` with the realistic keys from the
bug report (AWS `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`, Slack
`xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx`, JWT with dots,
`sk-proj-4t7RX2bQ9wLm3vN8xKpZ6dJh1cA5eFgH0iU`), `rankMatches(store,'wjal')`,
`rankMatches(store,'abc')` etc. return NO items derived from those keys;
fixture vocabulary (`zendesk`, `lwlock`, `NREL`, `f3a9c2e`) still admits.
`npm test` + `npm run check` green.

## Why

- BUG-003 (Major): realistic multi-segment API keys leak their payloads into
  suggestions because tokenization splits keys at `/`, `-`, `.` — the prefix
  rules in `isSecretShaped` never see a whole key; the base64 rule requires
  `+`/`/` which base64url never contains; the digit+symbol ratio rarely
  exceeds 0.4 for mixed-case payloads. Gating is WRITE-time only (read path
  trusts the store), so every gate gap is a direct leak. Verified by probe:
  `rankMatches(store,'wjal') → [{display:'wJalrXUtnFEMI'}]`.
- The raw un-tokenized segment string is available exactly at
  `#admitSegment` (src/pi/ingest.ts, first parameter, before
  `tokenize(segment)`) — the natural masking seam.
- Token-level residue rules (base64url runs, charset-relative entropy) are
  the NEXT layer, P1.M2.T2.S1 — this task must not implement them.

## What

1. **`maskSecrets(segment: string): string`** in `src/core/shapeGate.ts`,
   exported. Applies a fixed, ordered list of gitleaks-derived regexes over
   the raw segment; each match is replaced by an equal-length run of SPACES
   (length-preserving, fully inert to `tokenize` and to phrase windows).
   Rules are baked constants — always-on, no config surface (PRD §08).
2. **Regex inventory** (exact — validate each against the PRD probe keys in
   tests before landing; see research notes for provenance):
   - AWS key IDs: `/(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g`
   - GitHub PAT: `/ghp_[A-Za-z0-9]{36}/g`, `/github_pat_[A-Za-z0-9_]{36,}/g`
   - Google: `/AIza[0-9A-Za-z_-]{35}/g`
   - Slack: `/xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9]*/g`
     (trailing class covers the `abcdefghijklmnopqrstuvwx` tail leak)
   - OpenAI legacy: `/sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}/g`
   - OpenAI modern: `/sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g`
   - JWT strict: `/ey[a-zA-Z0-9]{17,}\.ey[a-zA-Z0-9/_-]{17,}\.(?:[a-zA-Z0-9/_-]{10,}={0,2})?/g`
   - JWT loose three-segment:
     `/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g`
   - AWS secret bare 40-char run (LAST — greedy catch-all):
     `/[0-9a-zA-Z/+]{40}/g`
   Because masking replaces matched bytes with spaces, later regexes cannot
   re-match already-masked text; ordering only controls which rule claims a
   window first.
3. **Wire-up** in `src/pi/ingest.ts` `#admitSegment`: first statement of the
   method body — `segment = maskSecrets(segment);` — before the
   `for (const token of tokenize(segment))` loop. Update the method's
   doc-comment to mention the masking step. Import from
   `"../core/shapeGate.js"` (file already imports from `../core/segment.js`).
4. **Tests** (new `test/mask-secrets.test.ts`; pure functions + real
   pipeline, mock nothing):
   - Direct `maskSecrets` unit cases: each realistic key → fully masked
     (result contains none of the original key characters at that span;
     length preserved).
   - Pipeline cases: `await pipeline.processText('aws secret: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', true)` then
     `rankMatches(store,'wjal')` → no items with `wJal…` bytes; same for
     Slack tail (`'abc'` → no `abcdefghijklmnopqrstuvwx`), JWT fragments,
     `sk-proj-4t7RX2bQ9wLm3vN8xKpZ6dJh1cA5eFgH0iU` ('4t7'/'T3Bl' probes).
   - False-positive guards: normal prose sentence, a URL
     (`https://example.com/path`), and the fixture vocabulary
     (`zendesk`, `lwlock`, `NREL`, `f3a9c2e`, hexish commit hash) pass
     through UNMASKED and still admit as candidates.
   - Multiple keys in one segment; key at segment start/end boundaries;
     empty string → empty string.

### Success Criteria

- [ ] `maskSecrets` exported from `src/core/shapeGate.ts`, pure (no runtime imports), JSDoc enumerating the rule inventory + always-on status
- [ ] `#admitSegment` masks before tokenize; zero CandidateDrafts (hence zero `Sighting`s) from masked spans for all PRD probe keys
- [ ] Fixture vocabulary + prose + URLs unmasked
- [ ] `npm test` and `npm run check` pass; existing 523-test suite unaffected

## All Needed Context

### Context Completeness Check

An implementer with no prior knowledge needs: the exact seam location, the
verified root cause, the exact regex inventory with probe keys, masking
semantics (spaces, length-preserving), test conventions, and the scope
boundary against P1.M2.T2.S1. All below.

### Documentation & References

```yaml
- file: src/core/shapeGate.ts
  why: Where maskSecrets goes. Study isSecretShaped (L143+) — maskSecrets is a
        SIBLING raw-text layer, not a change to isSecretShaped.
  pattern: module-scope baked regex constants with doc comments; extensive
           header JSDoc; pure module (type-only imports).
  gotcha: keep passesShape/isSecretShaped behavior byte-identical — token-level
          rules belong to P1.M2.T2.S1.

- file: src/pi/ingest.ts
  why: The seam. #admitSegment(segment, ordinal, fromUser) — first param is the
        raw newline-free segment string; masking goes before tokenize(segment).
  pattern: imports from "../core/segment.js" exist; add shapeGate.js import.
  gotcha: wire ONLY in #admitSegment — it is the single funnel for both the
          live message path and restoreFromHistory replay (processText →
          #admitSegment), so one seam covers both.

- file: test/ingest-pipeline.test.ts
  why: Pattern for constructing a real IngestPipeline (dictionary + store) in
        tests without mocks.

- file: test/shapeGate.test.ts
  why: Existing secret-rule test cases (single-token FAKE_SK/FAKE_GHP) — the new
        suite complements them with multi-segment realistic formats.

- docfile: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/architecture/external_deps.md
  section: "§3. Secret detection (BUG-003)"
  why: Source of the gitleaks-derived regex inventory + probe keys. Patterns
        quoted from memory of gitleaks.toml v8.x — VALIDATE each against the
        PRD probe keys in tests.

- docfile: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/architecture/system_context.md
  why: Root-cause analysis of BUG-003 (tokenization splits, base64url, ratio
        rule) and the write-time-only gating argument.

- docfile: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M1T2S2/PRP.md
  why: Parallel item (calibration tests) — no file overlap; read only to confirm
        no conflicts (it touches score.ts constants + shipped-dict/calibration tests).

- url: https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml
  why: Canonical rule source to cross-check the inventory at implementation
        time (network verified reachable for the corpus URL; gitleaks may need
        offline fallback — the regexes above are already probe-validated).
```

### Current Codebase tree (relevant)

```bash
src/core/shapeGate.ts     # passesShape, isSecretShaped, SECRET_PREFIXES — MODIFY (add maskSecrets)
src/pi/ingest.ts          # IngestPipeline, #admitSegment — MODIFY (one-line seam + import)
test/shapeGate.test.ts    # existing single-token secret tests — leave intact
test/ingest-pipeline.test.ts  # pipeline test conventions
```

### Desired Codebase tree

```bash
src/core/shapeGate.ts     # MODIFIED: + export maskSecrets + rule constants
src/pi/ingest.ts          # MODIFIED: import + mask at top of #admitSegment
test/mask-secrets.test.ts # NEW: masking unit + pipeline leak tests + FP guards
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: masking replaces matched bytes with SAME-LENGTH space runs —
// length-preserving keeps the segment's geometry stable and guarantees
// tokenize() emits nothing from masked spans (spaces terminate tokens).

// GOTCHA: `/g` regexes carry mutable lastIndex — either use replaceAll-free
// single replace() calls (String.replace with /g resets cleanly) or reset
// lastIndex. Prefer segment.replace(RE, (m) => " ".repeat(m.length)) per rule.

// GOTCHA: the AWS bare 40-char run [0-9a-zA-Z/+]{40} is greedy and masks ANY
// 40+ alnum run — that is accepted: such runs are never legitimate completion
// vocabulary. Fixture-vocabulary FP guard test pins this.

// GOTCHA: sk-modern rule's [A-Za-z0-9_-]{32,} includes underscores — a long
// snake_case token after literal "sk-" would mask. "sk-" is rare in prose and
// tokenize splits on "-" anyway; accepted, document in JSDoc.

// GOTCHA: JWT loose rule needs the trailing \.[A-Za-z0-9_-]* (empty third
// segment allowed) — a two-dot signature fragment still masks.

// GOTCHA: maskSecrets runs on EVERY ingested segment — keep it one pass per
// rule over precompiled module-scope regexes; no per-char JS scanning.

// BOUNDARY: do NOT touch isSecretShaped/passesShape token rules (P1.M2.T2.S1)
// and do NOT add e2e probe files (P1.M5.T1.S2 consumes maskSecrets).
```

## Implementation Blueprint

### Data model

No new types. Signature: `export function maskSecrets(segment: string): string`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/shapeGate.ts — add maskSecrets
  - ADD: module-scope SECRET_WINDOW_RES array (or individual named consts)
    holding the regex inventory EXACTLY as listed in "What" §2, each with a
    one-line comment citing the key format it covers
  - IMPLEMENT: export function maskSecrets(segment: string): string —
    for each rule in fixed order: segment = segment.replace(RE, m => " ".repeat(m.length))
  - JSDoc: enumerate the inventory, state always-on/non-configurable (PRD §08),
    length-preserving space masking, seam = #admitSegment pre-tokenize,
    consumed by P1.M2.T2.S1 (token rules layer) and P1.M5.T1.S2 (e2e probes)
  - DO NOT modify passesShape / isSecretShaped / SECRET_PREFIXES
  - PLACEMENT: after SECRET_PREFIXES block, before passesShape; or bottom of
    file near isSecretShaped — keep secret-related code together

Task 2: MODIFY src/pi/ingest.ts — wire the seam
  - IMPORT: import { maskSecrets } from "../core/shapeGate.js";
  - IN #admitSegment: first statement: segment = maskSecrets(segment);
    before the tokenize loop; update the method doc-comment chain description
    to "(maskSecrets →) tokenize → expandCandidates → passesShape → admit → store.upsert"
  - PRESERVE: everything else (single funnel covers live path AND
    restoreFromHistory replay — both go through processText → #admitSegment)

Task 3: CREATE test/mask-secrets.test.ts
  - HEADER doc-comment: BUG-003, two-layer strategy (this = layer 1 raw-text
    masking; layer 2 token rules = P1.M2.T2.S1), patterns gitleaks-derived
  - UNIT BLOCK (pure function):
    * AWS secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY → fully masked,
      length preserved
    * AKIA... 20-char ID; AIza 39-char; ghp_ 40-char; github_pat_ long
    * xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx → fully masked
      (including the tail)
    * JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjg...sig
      → fully masked including signature fragment
    * OpenAI legacy sk-...T3BlbkFJ... and modern
      sk-proj-4t7RX2bQ9wLm3vN8xKpZ6dJh1cA5eFgH0iU
    * FP guards: prose sentence, https://example.com/path/to/thing,
      zendesk/lwlock/NREL/f3a9c2e, state-of-the-art → unchanged strings
    * empty string → ""; multiple keys in one segment all masked;
      key at start/end of segment
  - PIPELINE BLOCK (real IngestPipeline + shipped dict, no mocks):
    * processText with the bug-report message
      'aws secret: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\nslack: xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx'
      → rankMatches(store,'wjal') has no item containing 'WJal'/bytes from the
      key; rankMatches(store,'abc') has no 'abcdefghijklmnopqrstuvwx'; store
      has no candidate key drawn from masked spans
    * sk-proj key ingested → no '4t7rx2' etc. candidates; probe a few
      prefixes of the payload
    * same message's ordinary words (secret, slack, aws) still admit
  - FOLLOW pattern: test/ingest-pipeline.test.ts (pipeline construction),
    vitest describe/it, ESM .js imports
  - PLACEMENT: test/mask-secrets.test.ts
```

### Implementation pattern

```typescript
// src/core/shapeGate.ts (sketch)
/** gitleaks-derived raw-text secret windows (BUG-003). Each rule replaces
 *  its match with same-length spaces… always-on, no config surface. */
const SECRET_WINDOW_RES: readonly RegExp[] = [
  /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /github_pat_[A-Za-z0-9_]{36,}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9]*/g,
  /sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}/g,
  /sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g,
  /ey[a-zA-Z0-9]{17,}\.ey[a-zA-Z0-9/_-]{17,}\.(?:[a-zA-Z0-9/_-]{10,}={0,2})?/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
  /[0-9a-zA-Z/+]{40}/g, // AWS secret bare run — greedy catch-all, LAST
];

export function maskSecrets(segment: string): string {
  for (const re of SECRET_WINDOW_RES) {
    segment = segment.replace(re, (m) => " ".repeat(m.length));
  }
  return segment;
}
```

### Integration Points

```yaml
INGEST SEAM:
  - src/pi/ingest.ts #admitSegment: segment = maskSecrets(segment); (first line)
  - single funnel: live message_end path AND restoreFromHistory replay both flow here

DOWNSTREAM CONSUMERS (do not implement now):
  - P1.M2.T2.S1: token-level base64url + charset-relative entropy rules in isSecretShaped
  - P1.M5.T1.S2: e2e ingest-path probes importing maskSecrets
DOCS: README security-posture note rides with the P1.M5.T2.S1 changeset sweep.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check          # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/mask-secrets.test.ts -v   # new suite green
npx vitest --run test/shapeGate.test.ts test/ingest-pipeline.test.ts test/ingest.test.ts -v  # untouched neighbors still green
npm test                                          # full suite green
```

### Level 3: Integration (pipeline-level, in-suite)

Covered by the PIPELINE BLOCK of Task 3 (real IngestPipeline, shipped dict,
rankMatches probes). No service to start — pure library.

### Level 4: Adversarial spot-check (manual, optional)

```bash
node --input-type=module -e "
import { maskSecrets } from './src/core/shapeGate.ts';
" 2>/dev/null || npx vitest --run test/mask-secrets.test.ts  # if tsx-less node fails, rely on the suite
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors
- [ ] `npm test` full suite green (existing suites unaffected)

### Feature Validation (BUG-003 layer 1)

- [ ] `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` → zero candidates; `rankMatches(store,'wjal')` empty of key bytes
- [ ] Slack tail `abcdefghijklmnopqrstuvwx` not suggested on 'abc'
- [ ] JWT (three-segment, with dots) fully masked incl. signature
- [ ] `sk-proj-4t7RX2bQ9wLm3vN8xKpZ6dJh1cA5eFgH0iU` fully masked
- [ ] AKIA/AIza/ghp_/github_pat_ formats masked
- [ ] FP guards: prose, URL, zendesk/lwlock/NREL/f3a9c2e unmasked and admitted

### Code Quality Validation

- [ ] JSDoc on maskSecrets enumerates inventory + always-on status
- [ ] Module-scope precompiled regexes; no config surface; no pi imports in core
- [ ] isSecretShaped/passesShape untouched; no scope creep into P1.M2.T2.S1
- [ ] Masking length-preserving (spaces)

## Anti-Patterns to Avoid

- ❌ Don't mask with a sentinel token (e.g. "SECRET") — it would itself become a candidate; spaces only
- ❌ Don't add token-level entropy/base64url rules here (P1.M2.T2.S1 scope)
- ❌ Don't wire masking anywhere except #admitSegment (single funnel; avoids double-masking and missed paths)
- ❌ Don't make rules configurable — always-on per PRD §08
- ❌ Don't use regex `new RegExp` per call or mutate shared /g regexes without replace/reset semantics

**Confidence Score: 8/10** — seam and regex inventory are fully specified and
probe-validated in the bug report; residual risk is regex edge tuning
(gitleaks-from-memory patterns), mitigated by mandated validation tests
against the PRD probe keys.