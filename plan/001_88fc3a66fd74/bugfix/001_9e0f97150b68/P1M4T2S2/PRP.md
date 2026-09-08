# PRP — P1.M4.T2.S2: Arm the chain on phrase acceptance (last-word successor semantics) (BUG-005, part 2)

## Goal

**Feature Goal**: Close the second half of BUG-005: in `src/pi/provider.ts`'s
arming intercept (inside the hapax provider's `applyCompletion` shim,
~L351–375), add a phrase branch so that accepting a **phrase** candidate
(a key containing a space) arms the chain machine at the phrase's **LAST
word** — `chain.arm(words[words.length - 1])`. Today phrase keys fall into the
empty `else // never arms`, so even with P1.M4.T2.S1's suppression exemption
restoring the bare word, phrase acceptance cannot engage the chain. Delegation
to `current.applyCompletion` stays verbatim and unconditional (existing arming
contract).

**Deliverable**:
1. `src/pi/provider.ts` — phrase branch in the `enablePhrases`-gated arming
   intercept + updated comment block documenting the three key shapes
   (`CHAIN_KEY_PREFIX`, single-token word, space-joined phrase) and the
   last-word rationale (Mode A docs).
2. `test/chain.test.ts` — new tests pinning phrase-arming: full NREL replay →
   accept the phrase item via `applyCompletion` (existing `armViaTab` pattern)
   → next `getSuggestions` offers `topSuccessors(lastWord)` as
   `CHAIN_KEY_PREFIX` items; accepting one re-arms per existing chain
   semantics; `enablePhrases=false` → nothing arms.

**Success Definition**: `npm run check` + `npm test` green. After a full
`nrel.jsonl` replay, both arming routes work: (a) accept bare `National`
(P1.M4.T2.S1's exemption) → arms; (b) accept the phrase
`National Renewable Energy` → chain arms at `energy` → next suggestions offer
`laboratory` as a chain item → Tab accepts it and the chain re-arms. The §09
M2 item 7 chain is reachable in resumed sessions via either route.

## Important design decision (deliberate PRD deviation — documented)

The bug-hunt recommendation says "arm the chain from phrase acceptance of the
**phrase's first word**". That is wrong per PRD §07 chain mechanics:
`chain.arm(word)` primes `store.topSuccessors(word)` — the NEXT-word
continuation. Arming the FIRST word would re-offer words already typed into
the buffer (`renewable`, `energy`); arming the **LAST** word continues the
chain past what was accepted: accepting `national renewable energy` arms
`energy` → offers `laboratory`. This deviation is documented in
`plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/architecture/system_context.md`
(BUG-005). Encode it in the provider comment block (Task 1) and the new tests.

## User Persona

**Target User**: hapax user in a resumed session (or any session where the
bigram already recurred) who Tab-accepts a learned phrase and wants chained
successors to keep flowing.
**Use Case**: `/resume` NREL session; type `natio`; accept the phrase
`National Renewable Energy`; menu immediately offers `Laboratory` via the
chain — zero additional typing, continuing §09 M2 item 7's flow through the
phrase route.
**Pain Points Addressed**: Phrase acceptance was a chain dead-end ('never
arms'); with S1's exemption both routes must restore chaining post-restore.

## Why

- BUG-005 (bugfix PRD Major Issue 4): two co-causes — constituent suppression
  always removed the bare word (fixed by P1.M4.T2.S1, the immediate
  dependency) and phrase keys never armed (this task). Both are needed for
  chain reachability in resumed sessions.
- `liveKeyByValue` maps display value → store key; phrase keys are
  single-space-joined lowercase (`src/core/query.ts` builds them), so
  `key.includes(' ')` is the reliable discriminator after the existing
  `CHAIN_KEY_PREFIX` check.
- Consumed by P1.M5.T1.S1 (chain post-restore probe).

## What

In the arming intercept of the provider's `applyCompletion` shim, replace the
`// else: phrase key (space) → never arms.` dead branch with a phrase branch:

```ts
} else {
  // Phrase candidate (space-joined key): arm at the phrase's LAST word.
  // chain.arm(W) primes topSuccessors(W) — the NEXT-word continuation
  // (PRD §07 h2.43) — so last-word arming continues past the accepted
  // text ('national renewable energy' → successors of 'energy', e.g.
  // 'laboratory'). First-word arming would re-offer already-typed words.
  const words = key.split(" ");
  chain.arm(words[words.length - 1]);
}
```

Everything else is untouched: `CHAIN_KEY_PREFIX` branch, single-token branch,
`enablePhrases` gate, `liveKeyByValue` miss → never arms, and the verbatim
`current.applyCompletion(...)` delegation.

### Success Criteria

- [ ] Accepting a phrase item arms `chain` at the phrase's last word; next
      `getSuggestions` (typing a space / continuing) serves
      `topSuccessors(lastWord)` as `CHAIN_KEY_PREFIX` menu items
- [ ] Accepting a chain item re-arms per existing chain semantics (already
      covered by current tests; one new assertion riding the phrase path)
- [ ] `enablePhrases=false` → neither route arms (existing test stays green;
      add phrase-route variant)
- [ ] Path completion / out-of-map values still never arm
- [ ] `applyCompletion` return value still delegates verbatim (existing
      pass-through tests stay green)
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

Implementer needs: the exact arming intercept, the key-shape taxonomy, the
chain machine contract (`arm(word)` / `topSuccessors`), the live-key map
lifecycle (rebuilt each query), and the chain test harness (real store +
shipped dict + real pipeline replay). All specified below.

### Documentation & References

```yaml
- file: src/pi/provider.ts
  why: THE change site — applyCompletion arming intercept (~L351-375 in the
        current tree; the block beginning "Arming side-effect ONLY (PRD §07
        h2.43)"). Three branches today: CHAIN_KEY_PREFIX → arm(next);
        !key.includes(' ') → arm(lowercase); else → never arms.
  pattern: every branch has a doc comment; update the block header comment
    to enumerate the THREE key shapes + last-word rationale (Mode A docs)
  gotcha: liveKeyByValue is cleared and rebuilt on EVERY getSuggestions —
    the arming map is only valid between queries; do not cache it

- file: src/pi/provider.ts (ChainMachine section, ~L380+)
  why: chain.arm(word) contract — arms {word}; topSuccessors(word) feeds
        CHAIN_KEY_PREFIX entries on subsequent getSuggestions; \u0000 lead
        byte can never collide with store keys

- file: src/core/store.ts
  why: topSuccessors(word) (L856) — O(1), lowercase-keyed; returns frozen
        NO_SUCCESSORS (length 0) on miss. Phrase keys are lowercase
        space-joined, so split(' ') tokens are already the index's keys.
  gotcha: no case folding needed — phrase keys arrive lowercase; only the
    bare-word branch lowercases

- file: test/chain.test.ts
  why: the harness to extend — armViaTab pattern: drive provider
        getSuggestions, resolve item, call applyCompletion with the live
        item + prefix, then inspect __hapaxKey / next getSuggestions for
        CHAIN_KEY_PREFIX items. Uses REAL store + shipped dict + real
        IngestPipeline (mock nothing).
  gotcha: accept the phrase BEFORE any further getSuggestions call that
    would rebuild liveKeyByValue — arm via the item from the same query

- file: test/fixtures/sessions/nrel.jsonl
  why: full replay gives store with phrase 'national renewable energy'
        (count>=2) and successor index; topSuccessors('energy') should
        yield 'laboratory' — the canonical assertion
  pattern: replay helpers in test/acceptance.test.ts (parseSessionFixture /
    makeNrelPipeline / replayNrel)

- file: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M4T2S1/PRP.md
  why: IMMEDIATE DEPENDENCY (implementing in parallel, serialized before
        this item). It makes the bare word co-present in menus so both
        arming routes are reachable. Its query.ts change is independent of
        this provider.ts change — do NOT touch src/core/query.ts here.

- docfile: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/architecture/system_context.md
  section: BUG-005
  why: documents the last-word-vs-first-word deviation rationale
```

### Current codebase tree (relevant)

```bash
src/pi/provider.ts     # change site: applyCompletion arming intercept + ChainMachine
src/core/store.ts      # topSuccessors, successor index (read-only for this task)
src/core/query.ts      # owned by S1 — DO NOT TOUCH
test/chain.test.ts     # extend with phrase-arming tests
test/fixtures/sessions/nrel.jsonl
```

### Desired Codebase tree

```bash
# no new files; provider.ts + chain.test.ts modified only
```

### Known Gotchas

```ts
// CRITICAL: branch ORDER — CHAIN_KEY_PREFIX first (\u0000 can't occur in a
//   store key, but check it before the space test anyway, as today).
// CRITICAL: last word, not first — topSuccessors(W) is next-word
//   continuation; first-word arming would re-offer typed words.
// Phrase keys are already lowercase + single-space-joined (query.ts) —
//   no normalization on the split tokens; only the bare-word branch
//   lowercases item.value.
// liveKeyByValue is rebuilt per query: arm within the same query cycle
//   (applyCompletion is called immediately after a menu accept, so the map
//   from the last getSuggestions is valid — that's the existing contract).
// enablePhrases=false must short-circuit the WHOLE intercept (unchanged).
// topSuccessors miss is a frozen empty array (truthy) — never needed here
//   (arm() tolerates empty successors; the chain simply offers nothing).
// src/core/query.ts and its tests belong to parallel S1 — zero edits there.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: MODIFY src/pi/provider.ts arming intercept
  - ADD phrase branch (split key on ' ', arm last word) replacing the
    'never arms' else
  - UPDATE the intercept's comment block: three key shapes
    (CHAIN_KEY_PREFIX / single-token / space-joined phrase) + the
    last-word rationale (next-word continuation per §07; first-word
    arming would re-offer typed words; deviation documented in
    system_context.md BUG-005)
  - PRESERVE: branch order, enablePhrases gate, verbatim delegation

Task 2: EXTEND test/chain.test.ts
  - TEST phrase arming: full nrel.jsonl replay → getSuggestions('natio')
    → pick the phrase item ('National Renewable Energy', description
    'phrase') → applyCompletion via armViaTab pattern → assert next
    getSuggestions (with the chain active: next keystroke/space) offers
    CHAIN_KEY_PREFIX items derived from topSuccessors('energy') — i.e.
    'laboratory' present via __hapaxKey or item mapping
  - TEST chain re-arm: accept one of those chain items → chain arms at
    it (existing semantics; assert next successors served or armed state)
  - TEST enablePhrases=false: same replay/accept flow → next
    getSuggestions has NO chain items; nothing armed
  - TEST bare-word route still arms (S1 made it reachable): accept bare
    'National' after FULL replay → chain items for topSuccessors('national')
    — guards the S1/S2 interaction end-to-end
  - NAMING: describe('phrase acceptance arms the chain (BUG-005 part 2)')
  - PATTERN: reuse existing harness helpers; real store/dict/pipeline

Task 3: RUN gates
  - npm run check && npm test
  - IF S1 has landed: npx vitest --run test/acceptance.test.ts -t "item 7"
    still green (its zero-typing chain is unaffected; phrase route is
    additive). If S1 has NOT landed yet, chain tests here still pass —
    phrase arming does not depend on the suppression exemption (phrases
    are never suppressed).
```

### Key pattern: the arming intercept after the change

```ts
if (config.enablePhrases) {
  const key = liveKeyByValue.get(item.value);
  if (key !== undefined) {
    if (key.startsWith(CHAIN_KEY_PREFIX)) {
      chain.arm(key.slice(CHAIN_KEY_PREFIX.length));
    } else if (!key.includes(" ")) {
      chain.arm(item.value.toLowerCase());
    } else {
      // Phrase key (space-joined lowercase). Arm the LAST word:
      // arm(W) primes topSuccessors(W) = next-word continuation (§07),
      // so 'national renewable energy' → successors of 'energy'
      // (e.g. 'laboratory'). First-word arming would re-offer words
      // already typed (documented deviation, system_context.md BUG-005).
      const words = key.split(" ");
      chain.arm(words[words.length - 1]);
    }
  }
}
return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
```

### Integration Points

```yaml
DOWNSTREAM_CONSUMERS:
  - P1.M5.T1.S1: chain post-restore probe asserts BOTH routes
NO_CONFIG: no config fields added; enablePhrases gate unchanged
NO_QUERY_CHANGES: src/core/query.ts is S1's file — do not edit
README: chaining notes ride with P1.M5.T2.S1 final sweep — nothing here
```

## Validation Loop

### Level 1: Type & style

```bash
npm run check    # tsc --noEmit strict — zero errors
```

### Level 2: Unit tests

```bash
npx vitest --run test/chain.test.ts -v
# new phrase-arming suite green; all existing chain/provider tests green
```

### Level 3: Full suite + interaction

```bash
npm test
# provider.test.ts / provider-live.test.ts / acceptance.test.ts must stay
# green — the delegation contract and enablePhrases-inert behavior unchanged
```

### Level 4: Behavior proof (BUG-005 route 2, inverted)

```bash
npx vitest --run test/chain.test.ts -t "phrase" -v
# full replay → accept phrase → CHAIN_KEY_PREFIX items from
# topSuccessors('energy') → includes 'laboratory' — the exact dead-end
# the adversarial audit found
```

## Final Validation Checklist

- [ ] `npm run check` zero errors; `npm test` fully green
- [ ] Phrase acceptance arms at LAST word; successors of `energy`
      (incl. `laboratory`) served as chain items after full NREL replay
- [ ] Chain-item acceptance re-arms (existing semantics intact)
- [ ] `enablePhrases=false`: no arming on any route
- [ ] Bare-word route (S1's exemption) e2e-tested in the same suite
- [ ] `applyCompletion` delegates verbatim; return value untouched
- [ ] Intercept comment block documents three key shapes + last-word
      rationale (Mode A)
- [ ] Only `src/pi/provider.ts` + `test/chain.test.ts` modified
- [ ] No changes to src/core/*, config, constants (PRD §08)

## Anti-Patterns to Avoid

- ❌ Don't arm the phrase's FIRST word — re-offers typed text; the deviation
      from the bug-hunt recommendation is deliberate and documented
- ❌ Don't touch the CHAIN_KEY_PREFIX order or the enablePhrases gate
- ❌ Don't cache liveKeyByValue across queries
- ❌ Don't mock the store/dictionary/pipeline — real replay harness
- ❌ Don't edit src/core/query.ts (parallel S1 owns it)
- ❌ Don't add config surface or "helpful" normalization of phrase keys —
      they are already lowercase space-joined