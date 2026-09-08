---
name: "P1.M2.T2.S2 (bugfix 001_0f4b641cf9ce) — Propagate whole-token secret rejection to sub-word drafts in the ingest memo"
---

## Goal

**Feature Goal**: Close the remaining BUG-003 leak: in `#computeAdmitMemo` (src/pi/ingest.ts ~L495–530), each `CandidateDraft` from `expandCandidates` is gated independently, and a whole token rejected with `GateRejectReason 'secret'` leaves no trace — so its camelCase/snake_case sub-words (`jalr`, `femik7`, `mden`, `cyexamplekey` from `wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY` — all sub-16-char, ≤1 digit, defeating `isSecretShaped` rules 6/7) pass every gate and get stored. Implement the PRD h3.5 minimum bar: *"at minimum suppress candidates whose parent token was secret-rejected."*

**Deliverable**: Parent-secret-aware `#computeAdmitMemo` in `src/pi/ingest.ts` (whole-token `secret` rejection poisons all later sub-word drafts of that token) + updated `#computeAdmitMemo` doc-block (Mode A) + TDD cases in `test/ingest-pipeline.test.ts` (or `test/adversarial-ingest.test.ts`) using the real pipeline and a synthetic dict binary (`test/helpers/dict-writer.ts`).

**Success Definition**: After `processText('password wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY trailing')`, `store.entries()` contains NONE of `jalr`/`femik7`/`mden`/`cyexamplekey`, and `provider.getSuggestions(['cy'], …)` returns no items; sub-words of gate-PASSING parents still admit (regression); suppressed sub-words are counted in the existing `rejectedByGate.secret` counter; `npm run check` + `npm test` green.

## Why

- BUG-003 (Major, h3.2): fragments of pasted secrets are offered as completions (`cy` → `CYEXAMPLEKEY`), violating §01 "never embarrass" and §09 integration item 5. S1 (parallel, treat as done) lowered the raw-text bare-run mask to 32 chars — masked text never reaches `tokenize` — but secrets that ESCAPE masking (broken runs, symbol-interrupted payloads, prefix-rule hits like `ghp_…`) still reach the gate, where only the WHOLE token is rejected. Sub-words of that token are the remaining leak; this task closes it.
- Output feeds P1.M2.T2.S3's synthetic-token paste battery (npm/glpat/sk_live/Bearer), which tests this propagation end-to-end.

## What

In `#computeAdmitMemo` (src/pi/ingest.ts), the draft loop already processes drafts in `expandCandidates` order — **whole token FIRST, then sub-words**. Add one ordered flag:

```typescript
// inside #computeAdmitMemo, next to wholeGroup:
let parentSecret = false; // whole token secret-rejected → poison sub-words

// in the draft loop:
if (parentSecret && draft.isSubword) {
  // Parent-secret propagation (BUG-003, PRD h3.5 minimum bar): the whole
  // token was rejected as secret-shaped; its fragments inherit that fate —
  // never gated independently, never admitted, counted as secret rejects
  // by #replayAdmitMemo's existing !gate.ok branch.
  entry.gates.push({ ok: false, reason: "secret" });
  entry.admits.push(undefined);
  continue;
}
const gate = passesShape(draft);
entry.gates.push(gate);
if (!gate.ok) {
  entry.admits.push(undefined);
  if (!draft.isSubword && gate.reason === "secret") parentSecret = true;
  continue;
}
// ... admit() call and the rest UNCHANGED
```

Rules:
- **Only `secret` propagates.** A whole token rejected for `lowEntropy`/`tooShort`/`consonantRun` etc. does NOT poison sub-words (e.g. `aaaaa-bbbb`-style noise words: sub-words still get their own independent gate, per §04's existing semantics). Check `gate.reason === "secret"` explicitly.
- **Only whole-token drafts set the flag** (`!draft.isSubword && gate.reason === "secret"`); only sub-word drafts consume it. The whole draft is emitted first, so the ordered flag sees the parent's verdict before any child arrives — guaranteed by `expandCandidates`' documented contract ("whole token first"; comment already in `#computeAdmitMemo`).
- **Memoization stays valid**: the propagation is a pure function of the token's drafts, computed once per distinct raw token in `#admitMemo` — deterministic, no cross-token state, cap/clear semantics untouched.
- **`#replayAdmitMemo` needs NO changes**: its existing `if (!gate.ok) { this.#stats.rejectedByGate[gate.reason!]++; continue; }` branch already counts synthetic `{ok:false, reason:'secret'}` gates per occurrence and never stores them. Verify this by reading it; do not duplicate logic there.
- **`wholeGroup` interaction**: a secret-rejected parent never sets `wholeGroup` (the `if (!draft.isSubword && result !== "reject")` line is unreachable for it — gate-rejected drafts never reach `admit`). Poisoned sub-words skip `admit()` entirely, so `wholeGroup` remains `undefined` for them — same clamp behavior as any gate-rejected sub-word today.
- **Docs (Mode A)**: extend the `#computeAdmitMemo` doc-block with a short paragraph documenting the parent-secret propagation rule and its rationale (§01 "never embarrass"; §09 item 5; BUG-003 layer-2 residue net over S1's masking).

### Success Criteria

- [ ] Sub-words of a `secret`-rejected whole token are never stored (store, bigram entries, prefix index)
- [ ] They ARE counted in `IngestStats.rejectedByGate.secret` per occurrence (via #replayAdmitMemo's existing branch)
- [ ] Sub-words of gate-passing parents still admit; whole-token rejection for non-secret reasons does not propagate
- [ ] Memoization, disable-gate (BUG-004 NEW-001) seams, ADMIT_MEMO_CAP behavior untouched
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer with no prior knowledge needs: the exact current `#computeAdmitMemo` code (quoted below), the `#replayAdmitMemo` gate-reject branch, the `expandCandidates` whole-first ordering contract, `GateResult`/`GateRejectReason` from types.ts, S1's masking contract (what already never reaches the gate), the synthetic-dict test helper, and the existing adversarial-ingest suite conventions. All below.

### Documentation & References

```yaml
- file: src/pi/ingest.ts
  why: THE file. #admitSegment (~L462-495): maskSecrets → tokenize → memo
        cache (this.#admitMemo, ADMIT_MEMO_CAP clear-when-full) →
        #computeAdmitMemo + #replayAdmitMemo per occurrence.
        #computeAdmitMemo (~L495-530): quoted in Blueprint below.
        #replayAdmitMemo (~L534-580): per-draft loop; FIRST branch is
        `if (!gate.ok) { this.#stats.rejectedByGate[gate.reason!]++; continue; }`
        — this is what counts your synthetic secret gates. NO changes needed there.
  pattern: numbered JSDoc doc-blocks citing PRD sections and bug IDs; private
           #methods; entry: AdmitMemoEntry = { drafts, gates, admits, complete }.
  gotcha: admits[] uses `undefined` for both gate-rejected and
          interrupted drafts; gates.length always equals drafts.length. Keep
          that invariant when pushing synthetic gates.

- file: src/core/types.ts
  why: GateResult = { ok: boolean; reason?: GateRejectReason };
        GateRejectReason = 'tooShort'|'tooLong'|'lowEntropy'|'unigramRun'|
        'secret'|'consonantRun'. 'secret' already exists — no type changes.

- file: src/core/segment.ts
  why: expandCandidates(token) emits the WHOLE-token draft FIRST, then
        sub-words (the existing comment "// whole token first" in
        #computeAdmitMemo pins this). Hexish tokens are OPAQUE — subword
        splitting skips them — so a hexish parent has no sub-words to poison.
  gotcha: sub-word drafts carry isSubword === true and parentKey set.

- file: src/core/shapeGate.ts
  why: passesShape + isSecretShaped + maskSecrets. S1 (parallel — treat as
        done) lowered the bare-run mask to BARE_RUN_MIN = 32: any
        [0-9a-zA-Z/+]{32,} run is blanked BEFORE tokenize. Your test inputs
        must be strings whose whole token SURVIVES masking and reaches the
        gate (see Gotchas).
  gotcha: whole tokens that reach the gate and reject as 'secret' include:
          known-prefix hits (ghp_…, xoxb-… — but '-' terminates tokens, so
          only '_'-joined prefixes produce a single whole token: ghp_/gho_/
          github_pat_/sk_), digit+symbol ratio > 0.4 at ≥16 chars, base64
          runs ≥24 with +/, pure-hex ≥20 (hexish parents are opaque — no
          sub-words, not a useful test vector).

- file: test/helpers/dict-writer.ts
  why: Synthetic dictionary binary writer — build a tiny in-memory dict for
        the pipeline so admission outcomes are deterministic without the
        shipped dict. Used by test/ingest-pipeline.test.ts.

- file: test/adversarial-ingest.test.ts
  why: The BUG-003 probe suite (Probe A): real IngestPipeline + shipped
        dict via resolveDictPath(), rankMatches(store, fragment) === []
        assertions, storedKeys(store) helper (forces prefix-index rebuild
        via store.prefixRange("") before sortedKeysSnapshot()), positive
        control pattern ("a zephyr drifted over the vestibule" — proves the
        no-leak assertions aren't vacuous against a dead store).
  pattern: FRAGMENTS: [string, string][] it.each; regex over storedKeys for
           leaked byte-runs.

- file: test/ingest-pipeline.test.ts
  why: Alternative home for the new cases — has rejectedByGate.secret
        counter assertions (L218: `secret: 1` for 20-char pure hex; L227
        mutates getStats() copy to prove it's a copy). Check both files and
        place cases where the fixtures fit best; do not duplicate.

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/P1M2T2S1/PRP.md
  why: S1 CONTRACT (in flight): BARE_RUN_MIN=32 masking. Your propagation is
        layer 2 over layer 1; the two must not conflict (masked text produces
        no tokens at all, so propagation simply never fires for masked keys).

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/core-engine-findings.md
  why: The finding this work item cites: #computeAdmitMemo gates each draft
        independently; wholeGroup is the only cross-draft state; the ordered
        flag works because expandCandidates emits whole-first.
```

### Current Codebase tree (relevant)

```bash
src/pi/ingest.ts               # MODIFY: #computeAdmitMemo parent-secret flag + doc-block
test/ingest-pipeline.test.ts   # EXTEND (or adversarial-ingest.test.ts): TDD cases
test/helpers/dict-writer.ts    # reuse: synthetic dict binary
```

### Desired Codebase tree

```bash
# no new files — modifications only
src/pi/ingest.ts               # parent-secret-aware memo (BUG-003 layer 2)
test/ingest-pipeline.test.ts   # + describe("parent-secret propagation (BUG-003 residue)")
```

### Known Gotchas of our Codebase & Library Quirks

```typescript
// THE MASKING TRAP (test design): the work item's repro text
// 'password wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY trailing' is a pure-alnum
// 38-char run — S1's BARE_RUN_MIN=32 MASKS it before tokenize, so the
// assertion passes through layer 1 and your layer-2 propagation is never
// exercised (vacuous). Keep that exact repro as the end-to-end PRD contract
// case, BUT also include at least one input whose whole token REACHES the
// gate and is secret-rejected there — e.g. an '_'-joined prefix token:
// 'ghp_' + ~14 mixed-case chars ("ghp_AbCdEfGhIjKlMn") — no 32+ bare run
// (the '_' breaks it), whole token hits the ghp_ prefix rule, sub-words
// (the 14-char payload, its camelCase splits) would otherwise admit.
// EMPIRICALLY VERIFY each vector before asserting: confirm
// tokenize(maskSecrets(s)) still contains the whole token (import both from
// src/core — cheap direct check) so the test exercises layer 2, not layer 1.

// HEXISH PARENTS ARE USELESS VECTORS: hexish tokens are opaque (no sub-word
// splitting), so a pure-hex ≥20 secret reject has no children to poison.
// Use identifier-shaped parents with '_' joins or camelCase.

// ADMITS-ARRAY SHAPE: gates.length must stay === drafts.length ===
// admits.length; gate-rejected drafts get admits[i] === undefined. Your
// synthetic sub-word gates follow the same shape — #replayAdmitMemo iterates
// all three arrays by index with non-null assertions (memo.gates[i]!).

// COUNTER SEMANTICS: rejectedByGate.secret counts PER OCCURRENCE (the memo
// is computed once per distinct raw token, replayed per occurrence — ingest
// the secret twice and the sub-word secret rejects double). Assert with
// exact numbers in the counter test, mirroring ingest-pipeline.test.ts L218.

// DO NOT PROPAGATE non-secret reasons: 'qqqxxxzzzvvv' (consonantRun whole
// token) — its sub-words, if any ≥4 exist, still get their own independent
// gate today; keep that. Pin with a regression case if expandCandidates
// emits sub-words for such a token.

// DISABLE-GATE (NEW-001) SEAMS: the isDisabled re-check after admit()'s
// lookup and the incomplete-memo flow are untouched — your synthetic gates
// skip admit() entirely so they can never observe the dict failure; the
// flag path adds no new lookup. Keep #computeAdmitMemo's structure
// otherwise identical.

// MEMO CACHE: the poison is part of the memo (deterministic per raw token),
// so repeated occurrences replay it for free — no new state, no cache
// invalidation, ADMIT_MEMO_CAP clear-when-full unchanged.

// STORE SIDE-EFFECT ORDER: #replayAdmitMemo pushes whole-token run entries
// only for admitted whole tokens — a secret-rejected parent contributes no
// run entry, and its poisoned sub-words contribute none either (they die at
// the gate branch before the entries.push). Bigram capture (onAdmittedTokens)
// is therefore automatically clean for this token.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies — TDD: write failing tests first)

```yaml
Task 1: ADD failing tests (test/ingest-pipeline.test.ts or test/adversarial-ingest.test.ts)
  - NEW describe("parent-secret propagation to sub-words (BUG-003 residue, PRD h3.5)")
    using the REAL pipeline + synthetic dict via test/helpers/dict-writer.ts:
    * PRD contract case: processText('password wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY trailing')
      → store.entries()/sortedKeysSnapshot() contains none of jalr/femik7/mden/cyexamplekey;
      rankMatches(store, 'cy') === [] (provider-equivalent: rankMatches empty ⇒
      getSuggestions returns no items — or wire createHapaxProvider like
      adversarial-ingest does and assert getSuggestions(['cy'],0,2,{signal}).items === [])
    * Layer-2 vector (reaches the gate — verify tokenize(maskSecrets(s)) still
      yields the whole token): 'gate ghp_AbCdEfGhIjKlMn done' → none of the
      payload sub-words stored; rejectedByGate.secret counts whole + poisoned
      sub-words (exact number, per occurrence)
    * Counter case: same secret text twice → rejectedByGate.secret doubles
      (memo replayed per occurrence)
    * Regression: sub-words of gate-PASSING parents still admit — e.g.
      'ZendeskLwlockTool' style camelCase whole token that passes → its
      sub-words (≥4 chars) ARE stored
    * Non-propagation: whole token rejected for a non-secret reason
      (consonantRun) does NOT poison sub-words (pick a vector whose
      sub-words are gate-clean, e.g. 'qqqxxxzzzvvvWord' if its sub-word
      'word' is dict-absent — assert it stores; adjust vector empirically)
    * Positive control: a rare prose word in the same message admits
      (non-vacuity, adversarial-ingest pattern)
  - RUN: npx vitest --run <file> -v → the propagation cases FAIL, others pass.

Task 2: MODIFY src/pi/ingest.ts — #computeAdmitMemo
  - ADD `let parentSecret = false;` beside wholeGroup (comment: BUG-003
    layer-2 residue, PRD h3.5 minimum bar)
  - ADD the poison check at the top of the draft loop (sketch in "What"),
    BEFORE passesShape, for (parentSecret && draft.isSubword) drafts
  - SET the flag in the !gate.ok branch: only when !draft.isSubword &&
    gate.reason === "secret"
  - NO other changes: #admitSegment, #replayAdmitMemo, admit() call, NEW-001
    seams, memo cache untouched
  - EXTEND the #computeAdmitMemo doc-block: parent-secret propagation rule,
    rationale (§01 never-embarrass; §09 item 5), why only 'secret' and only
    whole→sub direction, memoization validity note

Task 3: VALIDATE
  - npm run check
  - npx vitest --run test/ingest-pipeline.test.ts test/adversarial-ingest.test.ts -v
  - npm test   # full suite — S1's mask-secrets cases and Probe A stay green
```

### Implementation pattern

```typescript
#computeAdmitMemo(token: RawToken): AdmitMemoEntry {
  const drafts = expandCandidates(token); // whole token first
  const entry: AdmitMemoEntry = { drafts, gates: [], admits: [], complete: true };
  let wholeGroup: RankGroup | undefined;
  // BUG-003 layer 2: a whole-token 'secret' reject poisons every sub-word
  // draft of this token — fragments of a secret never admit (PRD h3.5
  // minimum bar; masking is layer 1 and never reaches tokenize).
  let parentSecret = false;
  for (const draft of drafts) {
    if (parentSecret && draft.isSubword) {
      entry.gates.push({ ok: false, reason: "secret" });
      entry.admits.push(undefined);
      continue;
    }
    const gate = passesShape(draft);
    entry.gates.push(gate);
    if (!gate.ok) {
      entry.admits.push(undefined);
      if (!draft.isSubword && gate.reason === "secret") parentSecret = true;
      continue;
    }
    // ... unchanged: admit() + NEW-001 disable re-check + wholeGroup
  }
  return entry;
}
```

### Integration Points

```yaml
NONE this task:
  - Ingest-internal change; core modules (shapeGate/segment/score/store) untouched.
  - Downstream (do NOT implement): P1.M2.T2.S3's synthetic-token paste battery
    consumes this propagation end-to-end (npm/glpat/sk_live/Bearer fragments);
    P1.M4.T1.S1 re-verifies; P1.M4.T2 documents at changeset level.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/ingest-pipeline.test.ts -v
npx vitest --run test/adversarial-ingest.test.ts -v
npm test   # full suite green (mask-secrets, Probe A, chain, provider suites)
```

### Level 3: Integration

Covered by the adversarial-ingest real-pipeline cases; no runtime wiring beyond ingest.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green
- [ ] gates/admits array-length invariants preserved (=== drafts.length)

### Feature Validation

- [ ] PRD repro text: none of jalr/femik7/mden/cyexamplekey stored; 'cy' query returns no items
- [ ] A gate-reaching secret-rejected whole token (verified to survive masking) poisons all its sub-words — stored nowhere, counted in rejectedByGate.secret per occurrence
- [ ] Sub-words of gate-passing parents still admit; non-secret rejections do not propagate
- [ ] Memo cache, NEW-001 disable seams, ADMIT_MEMO_CAP, #replayAdmitMemo untouched

### Code Quality Validation

- [ ] Doc-block updated (Mode A): propagation rule + rationale + §01/§09 citations
- [ ] Tests verified non-vacuous (layer-2 vectors empirically reach the gate; positive controls present)

## Anti-Patterns to Avoid

- ❌ Don't count the poison in a new stats field — reuse rejectedByGate.secret via the existing !gate.ok branch
- ❌ Don't propagate non-secret reject reasons, or secret→secret (sub-word secret rejects already die at their own gate)
- ❌ Don't add cross-token state — the flag is per-#computeAdmitMemo call only
- ❌ Don't change #replayAdmitMemo, #admitSegment, expandCandidates, or isSecretShaped
- ❌ Don't write tests that only exercise S1's masking layer — verify vectors reach tokenize post-mask
- ❌ Don't recompute passesShape for poisoned sub-words (skip it — cheaper and semantically "inherits the parent's verdict")
