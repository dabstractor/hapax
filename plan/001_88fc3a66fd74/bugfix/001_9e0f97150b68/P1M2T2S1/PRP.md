---
name: "P1.M2.T2.S1 (bugfix 001_9e0f97150b68) — base64url run + charset-relative entropy rules in isSecretShaped"
---

## Goal

**Feature Goal**: Close BUG-003's residue path by hardening the private
`isSecretShaped` in `src/core/shapeGate.ts` with two new token-level rules:
(a) a **base64url run** rule (≥16 chars from `[A-Za-z0-9_-]`, mixed case,
≥2 digits, NO `+`/`/` requirement) and (b) a **charset-relative Shannon-entropy**
refinement (base64-charset runs flagged only at ≥4.5 bits/char with digit +
mixed-case-or-symbol; hex runs at ≥3.0) — so standalone high-entropy key
fragments that survive upstream `maskSecrets()` (P1.M2.T1.S1) are still
rejected at the gate, without false-positiving ordinary identifiers.

**Deliverable**: Two new sub-rules inside `isSecretShaped` (+ helper
functions/constants) in `src/core/shapeGate.ts`, with JSDoc documenting
thresholds, charset-relative entropy rationale, and the masking/entropy
layering boundary. Extended secret-shape cases in `test/shapeGate.test.ts`.

**Success Definition**: All realistic key payloads from the bug report are
rejected by `passesShape` when they arrive as standalone tokens
(`abcdefghijklmnopqrstuvwx` Slack tail, `4t7RX2bQ9wLm3vN8xKpZ6dJh1cA5eFgH0iU`
OpenAI payload); the false-positive corpus
(`fixRoundingError`, `HTTPServer`, SCREAMING_CASE constants, hexish 13–19
band, `zendesk`, `lwlock`, `nrel`, `f3a9c2e`) still passes the gate;
the PRD repro boundary (`wJalrXUtnFEMI`, `bPxRfiCYEXAMPLEKEY` — mixed case,
NO digits) is pinned as NOT caught by these rules (masking is their catcher)
and documented in JSDoc. `npm test` + `npm run check` green; the existing
523-test suite unaffected.

## Why

- BUG-003 (Major): realistic multi-segment API keys leak. `maskSecrets()`
  (P1.M2.T1.S1, in flight) masks structured keys on the raw text — but it
  targets known formats. Standalone residue tokens (a key fragment pasted
  alone, an unprefixed high-entropy blob, a format masking doesn't know)
  reach the gate, whose current base64 rule requires `+`/`/` — base64url
  payloads never contain those, so they sail through.
- A flat `>= 3.5 bits/char` entropy threshold false-positives: English prose
  is ≈4.0–4.2 bits/char and hex is exactly 4.0. Entropy must be judged
  **relative to the run's charset ceiling** (random base64 ≈6 bits/char max).
- Defense-in-depth layering: maskSecrets (raw text, format-aware) →
  isSecretShaped token rules (this task, format-blind, shape-aware) →
  consumed by P1.M5.T1.S2 e2e probes with realistic keys.

## What

Modify ONLY the private `isSecretShaped(display: string): boolean` and its
helpers in `src/core/shapeGate.ts`. `passesShape`'s signature, precedence
(length → secret → entropy → unigramRun → consonantRun), and all other rules
stay byte-identical — the new rules are additional `return true` branches
inside `isSecretShaped`, evaluated **after existing rule 5** (pure-hex ≥ 20):

**New rule 6 — base64url run** (primary fix):
- Some contiguous run of ≥ **16** chars from the base64url alphabet
  `[A-Za-z0-9_-]` (note: includes `_` and `-`; NO `+`/`/` required) on the
  ORIGINAL `display` casing, where the run contains **≥1 lowercase, ≥1
  uppercase, AND ≥2 digits**.
- Kills: `abcdefghijklmnopqrstuvwx` (24 chars, has upper `A–F`? — NO: it's
  all lowercase except… verify: `abcdefghijklmnopqrstuvwx` is all lowercase,
  so rule 6 alone does NOT catch it — see rule 7) and
  `4t7RX2bQ9wLm3vN8xKpZ6dJh1cA5eFgH0iU` (34 chars, mixed case, many digits →
  caught). **Verify each test expectation against the actual character
  classes before writing assertions** — the Slack tail
  `abcdefghijklmnopqrstuvwx` is caught by rule 7 (entropy), not rule 6.

**New rule 7 — charset-relative entropy refinement**:
- Compute Shannon entropy (bits/char) over candidate runs already in the
  base64/base64url alphabet `[A-Za-z0-9+/_-]` of length ≥ 16: reject iff
  entropy ≥ **4.5** AND contains ≥1 digit AND (mixed case OR ≥1 `+`/`/`/`_`/`-`).
  This catches all-lowercase-but-digited high-entropy payloads
  (`abcdefghijklmnopqrstuvwx` → 24 distinct chars of 24 → 24-way, entropy
  log2-based ≈ 4.58 ≥ 4.5, has digits? NO — `abcdefghijklmnopqrstuvwx` has
  NO digits. **Pin ACTUAL behavior in tests; see Gotchas** — you may need
  the digit requirement satisfied by realistic Slack tails like
  `xoxb-…-abcdefghijklmnopqrstuvwx` which tokenize as `xoxb` + digit runs +
  the tail: the standalone tail `abcdefghijklmnopqrstuvwx` has no digit and
  no uppercase; its catchers are (i) upstream masking (Slack regex tail
  class) and (ii) rule 7 ONLY if you apply rule 7's digit condition over the
  whole candidate when the run spans the whole candidate. DECISION: apply
  rules 6/7 per-RUN, and additionally evaluate rule 7 over the WHOLE display
  when the whole display is a single base64-charset run ≥ 24 — the 24-char
  distinct lowercase tail then has entropy ≈4.58 ≥ 4.5 but still no
  digit → still passes. FINAL CALL: the Slack tail's catcher is the
  maskSecrets Slack regex (P1.M2.T1.S1) + existing rule 3 if symbols were
  present. **Pin `abcdefghijklmnopqrstuvwx` as admitted-by-gate in tests and
  rely on masking** — do NOT weaken rule 7's digit/mixed-case guard just to
  catch it, that reopens prose false positives.)
- Hex runs: a run of `[0-9a-f]` (length ≥ 16, whole display) with entropy
  ≥ **3.0** bits/char rejects. (Random hex averages ≈4.0; structured
  repeated hex like `a1a1a1a1…` falls below 3.0 and stays — pure-hex ≥ 20
  is already rule 5's territory; this closes the 16–19 gap only for
  genuinely random-looking hex. Hexish 13–19 must remain admitted: 13 chars
  max entropy log2(13)≈3.7 — below the ≥16 length floor of this rule, so
  the 13–15 band is untouched by design.)

**JSDoc (Mode A)**: document on the new rules — thresholds (16 / 4.5 / 3.0),
charset-relative rationale (prose ≈4.0–4.2, hex 4.0, base64 max ≈6), the
masking-vs-gate layering (maskSecrets catches structured keys pre-tokenize;
these rules catch standalone residue; `wJalrXUtnFEMI`-shaped 13-char mixed-case
no-digit fragments are a documented NON-goal of the gate — masking owns them),
and the always-on/non-configurable status (spec §04 / PRD §08).

### Success Criteria

- [ ] `4t7RX2bQ9wLm3vN8xKpZ6dJh1cA5eFgH0iU` → `{ ok: false, reason: "secret" }`
- [ ] False-positive corpus passes: `fixRoundingError` (16 chars, mixed case,
      ZERO digits — rule 6's digit requirement is what saves it),
      `HTTPServer`, `SCREAMING_CASE` constants, hexish 13–19 (e.g.
      `deadbeefcafe12`), `zendesk`, `lwlock`, `nrel`, `f3a9c2e`
- [ ] Boundary pinned: `wJalrXUtnFEMI` (13, mixed case, no digit) and
      `bPxRfiCYEXAMPLEKEY` (19, mixed case, no digit) are NOT caught by the
      gate — maskSecrets is their catcher — documented in JSDoc, pinned in tests
- [ ] No config surface; no change to `passesShape` precedence or public API
      (maskSecrets export from P1.M2.T1.S1 untouched)

## All Needed Context

### Context Completeness Check

An implementer with no prior knowledge needs: the exact current
`isSecretShaped` code (rules 1–5, quoted below), the insertion point
(after rule 5), exact thresholds and charset definitions, the false-positive
corpus with per-token reasoning (why each survives), the sibling maskSecrets
contract (what it already catches), and test conventions. All below.

### Documentation & References

```yaml
- file: src/core/shapeGate.ts
  why: THE file. isSecretShaped (≈L143-191, private; sole call site
        passesShape L110 `if (isSecretShaped(draft.display))`).
  pattern: module-scope baked constants (MIN_BASE64_RUN etc.) + doc comments;
           single-pass scanners with sentinel flush (see hasBase64SecretRun).
  gotcha: maskSecrets() export (P1.M2.T1.S1, being added in parallel) lives in
          this file too — do NOT touch it or its tests.

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M2T1S1/PRP.md
  why: Sibling contract. maskSecrets masks structured keys on the raw segment
        BEFORE tokenize (Slack/AWS/JWT/OpenAI regex inventory quoted there).
        Your rules are the residue layer — do not duplicate its regexes.
  gotcha: its Slack regex tail class `[a-zA-Z0-9]*` masks the whole
          `xoxb-…-abcdefghijklmnopqrstuvwx` including the tail; the standalone
          pasted tail without the xoxb prefix is the only gate-side concern —
          and per the FINAL CALL above, that one is admitted (no digit/upper).

- file: test/shapeGate.test.ts
  why: Existing secret-rule tests + draft-helper convention. Extend in place.
  pattern: describe("passesShape — secret rules") block; construct drafts
           directly (no segment dependency): { key, display, isSubword:false }.

- file: plan/001_88fc3a66fd74/architecture/external_deps.md
  section: §3
  why: Referenced by the work item; entropy calibration table
        (base64 ≈6 max, hex 4.0, prose 4.0–4.2 — why a flat 3.5 threshold
        false-positives).

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68 (bug report)
  section: h2.2/h3.2 (Issue 2, BUG-003) + h2.5 recommendation bullet 3
  why: Root cause and the probe strings; recommendation text is the origin
        of rule 6's shape ("reject ≥16-char mixed-case+digit runs").
```

### Current Codebase tree (relevant)

```bash
src/core/shapeGate.ts     # passesShape, isSecretShaped (rules 1–5),
                          # hasBase64SecretRun, SECRET_PREFIXES — MODIFY
                          # (+ maskSecrets arriving from P1.M2.T1.S1)
src/pi/ingest.ts          # #admitSegment — maskSecrets seam (sibling task; NOT yours)
test/shapeGate.test.ts    # EXTEND with new-rule cases
```

### Desired Codebase tree with files added

```bash
src/core/shapeGate.ts     # MODIFIED: + BASE64URL_RUN_MIN=16, ENTROPY thresholds,
                          #   hasBase64UrlRun / entropy helpers, rules 6–7 in
                          #   isSecretShaped, JSDoc (Mode A)
test/shapeGate.test.ts    # EXTENDED: rule 6/7 hits, false-positive corpus pins,
                          #   repro-boundary pins
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// RULE 6 vs fixRoundingError: 16 chars, has lower+upper, but ZERO digits —
// the ">= 2 digits" condition is load-bearing. Any weakening to >=0/1 digits
// false-positives camelCase identifiers wholesale. Do not weaken it.

// ENTROPY IS OVER THE RUN, not the whole candidate, for per-run rules; compute
// over the run's own char distribution. For whole-display evaluation (rule 7
// hex branch) it's the whole string. Reuse the existing charEntropy() helper
// in shapeGate.ts (already present for the lowEntropy rule).

// SCREAMING_CASE: "MAX_RETRIES_EXCEEDED" is upper+underscore+digits maybe —
// run chars include '_' in the base64url alphabet; run must still need >=2
// digits AND >=1 lowercase to fire rule 6 — all-caps constants lack lowercase.
// Pin "MAX_RETRIES_EXCEEDED" and "SOME_CONST_NAME_VALUE" as passes.

// hexish 13–19 band (e.g. "deadbeefcafe12", 14 chars): rule 7's hex branch
// floor is 16 — 13–15 untouched; 16–19 hex like "abcdef0123456789" (16 chars,
// all distinct → entropy 4.0 ≥ 3.0) now REJECTS as secret. That is intended:
// 16+ random-looking hex is private-key-shaped residue; PRD's hexish 6–12
// commit-hash admissions and the 13–15 band are preserved.

// No /g-flag regexes with shared state; existing code deliberately avoids /g
// (see PURE_HEX_RE comment). New scanners: single-pass char loops like
// hasBase64SecretRun, or a fresh non-global regex per call.

// wJalrXUtnFEMI / bPxRfiCYEXAMPLEKEY: mixed case, NO digits, 13/19 chars.
// Rule 6 needs >=2 digits → miss. Rule 7 needs a digit → miss. They are
// caught ONLY by maskSecrets' AWS 40-char catch-all / structured regexes when
// the full key is present. Pin BOTH as gate-PASSES in tests with a comment
// pointing at maskSecrets — this is the documented layering boundary.
```

## Implementation Blueprint

### Data model

No new types. New module-scope constants + two helpers:

```typescript
/** Min run length for the base64url secret rule (no +/ required). */
const BASE64URL_RUN_MIN = 16;
/** Entropy (bits/char) above which a base64-charset run looks random. */
const BASE64_ENTROPY_MIN = 4.5;
/** Entropy (bits/char) above which a >=16 hex run looks random. */
const HEX_ENTROPY_MIN = 3.0;
const HEX_ENTROPY_MIN_LENGTH = 16;
const BASE64URL_CHARS = /* [A-Za-z0-9_-] char-class test */;
const HEX_CHARS = /* [0-9a-fA-F] char-class test, on display */;
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/shapeGate.ts — rules 6 & 7 in isSecretShaped
  - ADD constants above (baked, JSDoc'd with provenance: bug report h2.5,
    external_deps.md §3 calibration)
  - IMPLEMENT: hasBase64UrlSecretRun(display): boolean — single left-to-right
    pass over display; run resets on any char outside [A-Za-z0-9_-]; per run,
    tally lower/upper/digit; sentinel flush at i === length (copy
    hasBase64SecretRun's pattern); fire when run >= 16 && lower >= 1 &&
    upper >= 1 && digit >= 2. NO punct requirement.
  - IMPLEMENT: hasHighEntropySecretRun(display): boolean —
    (a) longest run of [A-Za-z0-9+/_-] with length >= 16: fire when
        charEntropy(run) >= 4.5 && run has >=1 digit && (has both cases ||
        has + / _ -);
    (b) whole-display hex (HEX_CHARS only) length >= 16: fire when
        charEntropy(display) >= 3.0.
  - INSERT in isSecretShaped after rule 5 (pure hex >= 20), before `return false`:
      // 6. base64url run (no +/ requirement) — BUG-003 residue layer
      if (hasBase64UrlSecretRun(display)) return true;
      // 7. charset-relative entropy — BUG-003 residue layer
      if (hasHighEntropySecretRun(display)) return true;
  - UPDATE isSecretShaped's JSDoc: rules 1–7 inventory, thresholds,
    masking/entropy layering note, the wJalrXUtnFEMI non-goal boundary (Mode A)
  - DO NOT TOUCH: passesShape, maskSecrets (if already present from the
    parallel task), rules 1–5, charEntropy internals.

Task 2: EXTEND test/shapeGate.test.ts
  - ADD describe("passesShape — secret residue rules (BUG-003)") block.
  - REJECT cases (expect { ok:false, reason:"secret" }):
    "4t7RX2bQ9wLm3vN8xKpZ6dJh1cA5eFgH0iU" (34, mixed, many digits)
    "Ab3xK9pQ2wLm5nRt" (16, 1 lower, 1 upper, 2 digits — minimal rule-6 hit)
    "Ab3xK9pQ2wLm5nR" (15 — below floor → PASSES; boundary pin)
    "abcdef0123456789" (16-char distinct hex, entropy 4.0 >= 3.0 → secret)
    mixed-case+digit 16-run containing '-' or '_' (base64url alphabet span)
  - PASS cases (expect { ok:true }) with per-case comment stating WHY:
    "fixRoundingError" (no digits), "HTTPServer" (short, no digits),
    "MAX_RETRIES_EXCEEDED", "SOME_CONST_NAME_VALUE" (no lowercase),
    "deadbeefcafe12" (14 < 16), "f3a9c2e" (hexish 6–12), "zendesk",
    "lwlock", "nrel", "abcdef" (6 hexish), "tokenizerProQ5" style
    identifier with <2 digits, English word 20 chars e.g. "characterization"
    (entropy ~3.9 < 4.5, no digit guard satisfied anyway)
  - BOUNDARY pins (documented layering — comment: masking owns these):
    "wJalrXUtnFEMI" → ok:true (gate non-goal; maskSecrets catches full key)
    "bPxRfiCYEXAMPLEKEY" → ok:true (19, mixed case, no digits — pin actual)
    "abcdefghijklmnopqrstuvwx" → ok:true (no digit/upper; Slack regex owns it)
  - VERIFY each expectation against the real char classes before finalizing;
    if a pinned expectation contradicts the implemented rule, the RULE text
    in this PRP wins — adjust the test, not the thresholds.

Task 3: VALIDATE
  - npm run check
  - npx vitest --run test/shapeGate.test.ts -v
  - npm test   # full suite — maskSecrets tests (if landed) must stay green
```

### Implementation pattern

```typescript
// Rule 6 scanner (sketch — mirror hasBase64SecretRun's sentinel pattern)
function hasBase64UrlSecretRun(display: string): boolean {
  let run = 0, lower = 0, upper = 0, digit = 0;
  for (let i = 0; i <= display.length; i++) {
    const ch = i < display.length ? display.charAt(i) : "";
    const isLower = ch >= "a" && ch <= "z";
    const isUpper = ch >= "A" && ch <= "Z";
    const isDigit = ch >= "0" && ch <= "9";
    if (isLower || isUpper || isDigit || ch === "_" || ch === "-") {
      run++; if (isLower) lower++; else if (isUpper) upper++; else if (isDigit) digit++;
    } else {
      if (run >= BASE64URL_RUN_MIN && lower >= 1 && upper >= 1 && digit >= 2) return true;
      run = lower = upper = digit = 0;
    }
  }
  return false;
}
```

### Integration Points

```yaml
NONE this task:
  - Pure module change; maskSecrets seam (ingest.ts) is P1.M2.T1.S1's.
  - Downstream consumer (do NOT implement): P1.M5.T1.S2 e2e ingest-path
    probes paste realistic keys and assert no leak — relying on this task's
    rules + maskSecrets together.
  - No config surface changes (PRD §08: secret rules always-on, baked).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/shapeGate.test.ts -v   # all new + existing cases green
npm test                                      # full suite green
```

### Level 3: Integration

None — pure module. (The e2e probes are P1.M5.T1.S2's deliverable.)

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green (incl. maskSecrets tests if landed)

### Feature Validation

- [ ] Rules 6 & 7 reject ≥16-char base64url mixed-case+2-digit runs and ≥4.5/≥3.0 entropy runs per spec
- [ ] False-positive corpus all passes, each pinned with reasoning comments
- [ ] `wJalrXUtnFEMI` / `bPxRfiCYEXAMPLEKEY` boundary pinned + JSDoc'd (masking owns them)
- [ ] `passesShape` precedence and public API unchanged; rules 1–5 untouched
- [ ] JSDoc (Mode A) documents thresholds, charset-relative rationale, layering

### Code Quality Validation

- [ ] Baked constants with provenance comments; no config knobs
- [ ] Single-pass scanners, no /g-state regexes; reuses charEntropy()
- [ ] maskSecrets (parallel task) untouched

## Anti-Patterns to Avoid

- ❌ Don't weaken rule 6's `>=2 digits` or `>=1 lowercase` — camelCase identifiers die
- ❌ Don't use a flat entropy threshold — 3.5 bits/char false-positives prose (≈4.0–4.2)
- ❌ Don't try to catch `wJalrXUtnFEMI`/`bPxRfiCYEXAMPLEKEY` at the gate — that's maskSecrets' contract; weakening to catch them reopens false positives
- ❌ Don't touch the hexish 6–12 admissions or the 13–15 band (floor is 16)
- ❌ Don't modify maskSecrets, passesShape, or the ingest seam (sibling scope)
- ❌ Don't add e2e probe files (P1.M5.T1.S2 owns those)