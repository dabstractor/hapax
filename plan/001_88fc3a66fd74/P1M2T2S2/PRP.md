---
name: "P1.M2.T2.S2 — Shape gate: secret-shape rejection rules (always-on, not configurable)"
---

## Goal

**Feature Goal**: Add the secret-shape rejection rule (`GateRejectReason 'secret'`) to `src/core/shapeGate.ts`, slotting it into the existing precedence chain between the length checks and the entropy checks. Acceptance-critical: pasted API keys must NEVER appear in suggestions (PRD §09 integration item 5). Always-on, no config escape hatch (PRD §08 "Not configurable").

**Deliverable**: Modified `src/core/shapeGate.ts` (secret check inserted at the marked slot from P1.M2.T2.S1) plus secret-rule coverage in `test/shapeGate.test.ts`.

**Success Definition**: All PRD §09 secret cases rejected with `{ok: false, reason: "secret"}`: `sk-abc123DEF456...`, `ghp_...`, `eyJhbG...`, 20+ pure hex. Hexish 6–12 still passes. `npm run check` and `npm test` green.

## Why

- Security acceptance item (PRD §09 integration item 5): secrets in the transcript must never surface as suggestions. The gate runs on every candidate BEFORE dictionary lookup — even a dictionary-hit string shaped like a secret is rejected first (gate first, then lookup, PRD §04).
- The gate is the load-bearing filter for dictionary-absent words; secret shapes are exactly the dangerous subset of that class.

## What

Implement one private check function `isSecretShaped(raw: string): boolean` in `src/core/shapeGate.ts` and call it at the insertion point left by P1.M2.T2.S1 (between `tooLong` and `lowEntropy`), returning `{ ok: false, reason: "secret" }` when it fires.

### The five secret sub-rules (any one → reject)

1. **Known key prefixes** — case-insensitive prefix match on the **raw candidate text** (`draft.display`, which preserves original casing and characters): `sk-`, `sk_`, `ghp_`, `gho_`, `github_pat_`, `xoxb-`, `xoxp-`, `xoxa-`, `xoxr-`, `xoxs-` (the `xox[bpars]-` family), `akia`, `aiza`, `eyJ` (JWT bodies always start with base64-encoded `{"` = `eyJ`). Prefix list is a baked constant — no config.
2. **Digit+symbol ratio**: for `raw.length >= 16`, count chars in `[0-9]` plus non-alphanumeric symbol chars (`+/=_-` etc. — anything not `[A-Za-z0-9]`); reject when `(digits + symbols) / length > 0.4`.
3. **Base64-shaped run**: a contiguous run ≥ 24 chars from the base64 alphabet `[A-Za-z0-9+/]` that contains at least one lowercase letter, one uppercase letter, one digit, and at least one of `+` or `/`.
4. **Pure-hex length ≥ 20**: the entire candidate matches `/^[0-9a-fA-F]+$/` (case-insensitive) with length ≥ 20 (private-key-shaped). NOTE the hexish band contract: hexish 6–12 pass; hexish ≥ 20 reject; the 13–19 band is **admitted by the gate** (only dictionary/admission in P1.M2.T3 can demote it) — do NOT reject 13–19.
5. **Email belt-and-braces**: contains `@` plus at least one `.`. (Segmentation normally excludes emails anyway; this is defense in depth. It can only fire on drafts constructed with unusual input.)

### Success Criteria

- [ ] All five sub-rules implemented; any firing returns exactly `{ok: false, reason: "secret"}`
- [ ] Precedence preserved: tooShort/tooLong → **secret** → lowEntropy → unigramRun → consonantRun
- [ ] PRD §09 cases rejected: `sk-abc123DEF456ghi789`, `ghp_16CHARACTERSTOKEN0000`, `eyJhbGciOiJIUzI1NiIsInR5`, 20+ pure hex (`a1b2c3d4e5f6a7b8c9d0`)
- [ ] Hexish 6–12 (`f3a9c2e`) still passes; normal words (`zendesk`, `lwlock`, `NREL`) still pass
- [ ] No config surface, no parameters — baked constants only

## All Needed Context

### Context Completeness Check

The implementer needs: the existing `passesShape` skeleton with the marked secret slot (from P1.M2.T2.S1, quoted below), the `CandidateDraft`/`GateResult`/`GateRejectReason` contracts (already in the codebase), the exact sub-rule semantics, and test conventions. Pure TypeScript + vitest; no external docs needed.

### Documentation & References

```yaml
- file: src/core/shapeGate.ts
  why: Module being modified. Contains the comment-marked insertion point:
        "// P1.M2.T2.S2: secret-shape check slots HERE". Insert the check there.
  pattern: early-return chain of { ok: false, reason: ... } checks.
  gotcha: Do NOT reorder existing checks; secret sits between tooLong and lowEntropy.

- file: src/core/types.ts
  why: GateRejectReason already includes 'secret' — do NOT redeclare or modify.
  contract: GateResult = { ok: boolean; reason?: GateRejectReason }

- file: src/core/segment.ts
  why: Exports CandidateDraft: { key: string (lowercase); display: string (original
        casing — but note segmentation regex only matches [A-Za-z0-9_], so '@', '+',
        '/', '-', '!' never reach the gate via the real pipeline. Sub-rules 1/2/3/5
        still fire on shaped drafts; rule 1's sk-/ghp_/xox- prefixes CANNOT normally
        arrive either ('-' and '_' — '_' does arrive via [A-Za-z0-9_]; '-' does not).
        Implement the rules on the raw text ANYWAY: the gate is defense in depth and
        may be called with arbitrary drafts in tests; PRD specifies raw-candidate
        prefix matching. Use draft.display as the "raw" text.
  gotcha: key === lowercase(display), same length.

- file: test/shapeGate.test.ts
  why: Existing suite from T2.S1 — ADD a "secret rules" describe block; do not
        alter existing cases. Follows vitest conventions, ESM .js imports.

- file: plan/001_88fc3a66fd74/prd_snapshot.md
  section: §04 h2.23 rule 3 (secret-shaped strings), §09 h2.50 item 5
  why: Authoritative spec, quoted in this PRP.

- file: plan/001_88fc3a66fd74/P1M2T2S1/PRP.md
  why: Contract for the skeleton this task extends (insertion point, precedence).
```

### Current Codebase tree (relevant)

```bash
src/core/types.ts        # GateResult, GateRejectReason ('secret' already declared)
src/core/segment.ts      # CandidateDraft (key/display/properName/isSubword/parentKey)
src/core/shapeGate.ts    # passesShape with marked secret insertion point (T2.S1)
test/shapeGate.test.ts   # T2.S1's rule coverage — extend, don't rewrite
```

### Desired Codebase tree

```bash
src/core/shapeGate.ts    # MODIFIED: isSecretShaped() + call at the slot
test/shapeGate.test.ts   # EXTENDED: secret describe block
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// PREFIX MATCH IS CASE-INSENSITIVE on draft.display: "SK-...", "Ghp_...", "AKIA..."
// all match. Precompute nothing; lowercase once per call: const raw = draft.display.toLowerCase().

// SEGMENTATION CANNOT PRODUCE '-' OR '@': real pipeline candidates never contain
// them. This is fine — the rules are belt-and-braces per PRD ("emails are
// segmented out anyway"). Tests construct such drafts directly.

// PURE-HEX BAND: reject >= 20 ONLY. "a1b2c3d4e5f6a7b" (16 hexish) must PASS the
// gate. The 13–19 band is deliberately admitted (PRD §04: only dictionary/
// admission can demote it). Hexish 6–12 also pass.

// RATIO RULE denominator: use raw length (>= 16 gate first). Count digits [0-9]
// and symbols (any char matching /[^A-Za-z0-9]/). Underscore IS a symbol here.
// "ghp_16CHARACTERSTOKEN0000": length 22; digits 8; symbol 1 → 9/22 ≈ 0.41 > 0.4
// BUT prefix rule fires first anyway (ghp_) — tests should isolate rules with
// prefixed-free strings for the ratio case.

// BASE64 RUN: must find a contiguous run — don't test whole-string shape only.
// A 30-char base64-shaped run inside a longer token still fires. Require ALL of:
// mixed case + digit + at least one of '+' or '/'. A 30-char alphanumeric-only
// string (no +//) does NOT fire this rule (it may pass entirely — e.g. long
// camelCase identifiers).

// EYJ AMBIGUITY: short identifiers starting "eyJ..." are theoretically possible
// but vanishingly rare in English/code; PRD accepts this cost. Match exactly
// the 3-char prefix per spec.

// ENTROPY INTERACTION: many secret-shaped strings also fail entropy — tests must
// pick entropy-clean secret examples (mixed case+digits keeps H high) so the
// 'secret' reason is observable, and prefix-rule rejections (which precede
// everything after length) are trivially isolated.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/core/shapeGate.ts
  - ADD private const SECRET_PREFIXES: readonly string[] = ["sk-", "sk_", "ghp_",
    "gho_", "github_pat_", "xoxb-", "xoxp-", "xoxa-", "xoxr-", "xoxs-",
    "akia", "aiza", "eyJ"]
  - ADD private function isSecretShaped(display: string): boolean implementing
    the five sub-rules (single lowercased pass where feasible; sub-rule order:
    prefixes → email → digit+symbol ratio → base64 run → pure-hex length)
  - INSERT at the marked slot (after tooLong, before lowEntropy):
        if (isSecretShaped(draft.display)) return { ok: false, reason: "secret" };
  - KEEP: all existing checks, order, and helpers untouched
  - NAMING: isSecretShaped (private, not exported); passesShape signature unchanged

Task 2: EXTEND test/shapeGate.test.ts
  - ADD describe("secret rules (PRD §04 h2.23 rule 3 / §09 item 5)") with cases:
    * prefix: "sk-abc123DEF456ghi789" → secret; "SK-Abc123def456ghi789" → secret
      (case-insensitive); "ghp_16CHARACTERSTOKEN0000" → secret; "gho_Token..." →
      secret; "github_pat_11AAAA0000bbbb0000" → secret; "xoxb-1234567890123456" →
      secret; "AKIAIOSFODNN7EXAMPLE" → secret (also ratio, but prefix first);
      "AIzaSyA1234567890abcdefghijklmnop" → secret; "eyJhbGciOiJIUzI1NiIsInR5" → secret
    * ratio: length-20 string with > 0.4 digit+symbol ratio and NO known prefix and
      passing entropy, e.g. "ab12cd34ef56gh78ij9_" (20 chars: 9 digits + 1 symbol = 0.5) → secret
    * base64 run: "abcdefghij012345ABCD+/xyzw" style 24+ run with mixed case +
      digit + '/' → secret; 30-char alnum-only mixed string → ok (no +//)
    * pure hex: "a1b2c3d4e5f6a7b8c9d0" (20 hex) → secret; uppercase 24 hex → secret;
      "a1b2c3d4e5f6a7b" (16 hexish) → ok; "f3a9c2e" → ok (existing case preserved)
    * email: draft "user.name@corp.com" (constructed directly, bypassing tokenize)
      → secret
    * precedence: "sk-aaaa" (7 chars, prefix + would-be entropy fail) → secret
      (secret before lowEntropy); "ab12cd34ef56gh78ij9_" → secret not consonantRun
    * accepts unchanged: zendesk, lwlock, nrel (NREL), f3a9c2e still { ok: true }
  - REUSE the draft() helper already present in the file from T2.S1
  - Do NOT modify existing describe blocks

Task 3: VALIDATE (Validation Loop below)
```

### Implementation Patterns & Key Details

```typescript
// Secret check — insertion at T2.S1's marked slot
export function passesShape(draft: CandidateDraft): GateResult {
  const s = draft.key;
  const max = draft.isSubword ? 32 : 64;
  if (s.length < 4) return { ok: false, reason: "tooShort" };
  if (s.length > max) return { ok: false, reason: "tooLong" };
  if (isSecretShaped(draft.display)) return { ok: false, reason: "secret" };
  // ... existing entropy/unigram/consonant checks unchanged
}

function isSecretShaped(display: string): boolean {
  const raw = display.toLowerCase();
  // 1. known prefixes — startsWith against baked constant array
  for (const p of SECRET_PREFIXES) if (raw.startsWith(p)) return true;
  // 5. '@' plus '.' (belt and braces)
  if (raw.includes("@") && raw.includes(".")) return true;
  // 2. digit+symbol ratio for length >= 16
  if (raw.length >= 16) {
    let noisy = 0;
    for (const ch of raw) if (!/[a-z]/.test(ch)) noisy++; // raw already lowercase
    if (noisy / raw.length > 0.4) return true;
  }
  // 3. base64-shaped run >= 24 with mixed case + digit + at least one of +/
  //    (evaluate on ORIGINAL display for case; single scan tracking run bounds
  //     and seen-classes within the current run)
  // 4. pure hex >= 20: /^[0-9a-f]{20,}$/.test(raw)
  return false;
}
// CRITICAL: rule 3's mixed-case test must use display (not lowercased raw),
// and the run alphabet check must include '+' and '/' as run members.
```

### Integration Points

```yaml
NONE this task:
  - Pure module; no store/dictionary/config wiring; no new types.
  - Gate-before-dictionary ordering is consumed later by P1.M3.T2.S2 (ingest)
    and rejects feed IngestStats.rejectedByGate['secret'].
  - Security behavior is summarized changeset-level in P1.M4.T2.S1; NO docs task here.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/shapeGate.test.ts -v   # all cases green, including T2.S1's
npm test                                      # full suite green
```

### Level 3: Integration Testing

None — pure module. The downstream acceptance (secrets never in suggestions) is exercised by P1.M4.T1.S1's scripted integration acceptance (PRD §09 item 5).

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green (existing cases untouched)
- [ ] Only type imports; no new module dependencies; SECRET_PREFIXES not exported

### Feature Validation

- [ ] All five sub-rules fire with reason exactly `"secret"`
- [ ] PRD §09 cases rejected: `sk-abc123DEF456...`, `ghp_...`, `eyJhbG...`, 20+ pure hex
- [ ] Hexish 6–12 and the 13–19 hex band still pass the gate
- [ ] Precedence: length → secret → entropy → unigramRun → consonantRun
- [ ] No configuration surface — thresholds and prefixes are baked constants

### Code Quality Validation

- [ ] Existing describe blocks in test/shapeGate.test.ts unmodified
- [ ] JSDoc on isSecretShaped referencing PRD §04 h2.23 rule 3 and §09 item 5
- [ ] Single-pass, allocation-light (the gate runs per candidate on every message)

## Anti-Patterns to Avoid

- ❌ Don't reject hexish 13–19 — that band is gate-admitted by spec
- ❌ Don't add a config flag to disable secret checks — always-on per PRD §08
- ❌ Don't test prefixes on `draft.key` with original casing — lowercase first
- ❌ Don't reorder the check chain or touch T2.S1's rules
- ❌ Don't require the base64 rule to lack `+/` — at least one of `+` or `/` is required