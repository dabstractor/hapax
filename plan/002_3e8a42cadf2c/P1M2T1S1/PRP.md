---
name: "P1.M2.T1.S1 (plan 002) — Chain machine + provider armed branch redesign (bare values, threshold 0)"
---

## Goal

**Feature Goal**: Implement PRD §07 h2.43 (R4) as redesigned: while armed(W),
offer W's unfiltered top successors at a **zero-typed-char word start** with
**bare single-word values** and **threshold 0 for the whole chain duration**;
retire the pending/consumePending one-shot and the leading-space value hack;
delete the dead phrase-key arm case from applyCompletion; simplify
createChainMachine to armed-only ({state, arm, reset}).

**Deliverable**:
- Redesigned armed branch in `src/pi/provider.ts` `createHapaxProvider.getSuggestions` (zero-char offer + threshold-0 fragment filtering + disqualification)
- Simplified `ChainMachine` (pending/consumePending removed) in the same file
- Cleaned `applyCompletion` (phrase case deleted; CHAIN re-arm + whole-word arm kept)
- Minimal test reconciliation in `test/chain.test.ts` (case 8 first sub-case + retired seam references; full rewrite is P1.M2.T1.S2's job)
- Verified `src/pi/index.ts` `before_agent_start` reset wiring still compiles/behaves

**Success Definition**: `npm run check` + `npm test` green; a Tab-accepted
word followed by a plain space offers its top successors with bare values at
prefix "" (no double-space insertion possible); typed fragments filter at
threshold 0; punctuation/no-successors disarm and fall through on the SAME
keystroke; no multi-word value exists anywhere; consumePending/pending are
gone from source and tests.

## Why

- R4/BUG-era design flaw: the current zero-char offer exists only as a
  one-shot `consumePending()` + strict adjacency check (cursor immediately
  after the accepted word, NO whitespace) with leading-space values — it
  misses the PRD's actual semantics ("cursor at the empty next word, ZERO
  typed chars") and would double-space if the user's separating space
  intervened.
- pi-tui insertion semantics are now CONFIRMED
  (plan/002_3e8a42cadf2c/architecture/external_deps.md §2a): with
  `prefix: ""`, `applyCompletion` splices `item.value` verbatim at the
  cursor; the text before the cursor already ends with the delimiter, so a
  BARE word inserts correctly word-separated, while a leading-space value
  produces a double space. Bare values are the correct shape.
- P1.M1.T2.S2 made `rankMatches` words-only — the applyCompletion
  space-joined phrase-key arm branch is dead code and must go (one-word
  invariant, PRD §06 h2.38).

## What

All inside `src/pi/provider.ts` unless noted. Keep reading
`config.enablePhrases` as the chain gate (the `enableChaining` rename is
P1.M3.T1.S1 — out of scope here).

### 1. armed(W) query branch (replaces lines ~239–316)

```text
const armed = chain.state();
if (armed && config.enablePhrases) {
  const before = lines[cursorLine]?.slice(0, cursorCol) ?? "";

  // (a) ZERO-TYPED-CHAR OFFER — cursor at an empty word start:
  //     before === "" (line start) or before ends with a space/tab.
  if (before === "" || /[ \t]$/.test(before)) {
    const succ = store.topSuccessors(armed.word).slice(0, config.maxSuggestions);
    if (succ.length > 0) {
      // items: { value: s.next, label: s.next, description: "chain" }  ← BARE values
      // lastLive: { matches: succ.map(s => ({ key: CHAIN_KEY_PREFIX+s.next,
      //            display: s.next, description: "chain", salience: -s.count })),
      //            prefix: "", ts: Date.now() }
      // liveKeyByValue: set(s.next → CHAIN_KEY_PREFIX+s.next)   ← BARE keys
      return { items, prefix: "" };
    }
    chain.reset();            // no successors → idle, fall through
  }
  // (b) TYPED FRAGMENT (≥1 word chars) — threshold 0:
  const frag = before.match(/[A-Za-z][A-Za-z0-9_]*$/)?.[0];
  const succ = frag === undefined ? [] :
    store.topSuccessors(armed.word)
      .filter(s => s.next.startsWith(frag.toLowerCase()))
      .slice(0, config.maxSuggestions);
  if (frag === undefined || succ.length === 0) {
    chain.reset();            // (c) disqualify: punctuation/word-less/no match
  } else {
    // items: bare values, prefix: frag, CHAIN_KEY_PREFIX live keys, salience -s.count
    return { items, prefix: frag };
  }
}
// fall through to extractMatchState → normal path (unchanged)
```

Notes:
- "Threshold 0 for the whole chain duration" = the armed branch never
  consults `config.threshold` and fires from zero chars (case a) through
  any fragment length (case b). extractMatchState stays bypassed on this
  path exactly as today.
- (a) and (b) are mutually exclusive (a word start has no trailing word
  chars); order the (a) check first.
- ZERO matching successors at a word start → `chain.reset()` + fall
  through to the normal path on the SAME keystroke (extractMatchState at
  an empty word start returns null → delegate to pi — stock behavior).
- Typing never blocks: while a fragment matches, the set only filters.

### 2. applyCompletion (lines ~351–400)

- KEEP: `CHAIN_KEY_PREFIX` branch → `chain.arm(key.slice(CHAIN_KEY_PREFIX.length))`.
- KEEP: whole-word branch (`!key.includes(" ")`) → `chain.arm(item.value.toLowerCase())`.
  This is also how trigger-char completions arm (they are whole-word
  insertions; test case 11 pins it).
- DELETE: the space-joined phrase-key arm branch and its BUG-005 comment
  block — query.ts no longer emits phrase keys (P1.M1.T2.S2).
- Unconditional verbatim delegation stays (`current.applyCompletion(...)`).
- Multi-word values remain FORBIDDEN everywhere (one-word invariant).

### 3. ChainMachine simplification (lines ~409–498)

```ts
export interface ChainMachine {
  state(): ChainState;            // { word } | null
  arm(word: string): void;        // armed = word   (pending dies)
  reset(): void;                  // armed = null
}
```
- Remove `pending` closure var, `consumePending()` from interface +
  implementation + ALL JSDoc references; update the machine's doc-comment
  armed-rules list to the new semantics (word-start offer, threshold-0
  filter, disqualification, before_agent_start reset).
- Rewrite the stale comment block at provider.ts ~200–238 (the pending-offer
  rationale, leading-space justification, and the case-(8) pin at ~265) to
  describe the new word-start offer + bare-value rationale (cite
  external_deps.md §2a).

### 4. index.ts — verify only

`before_agent_start` → `chain?.reset()` (src/pi/index.ts 251–255) still
valid against the simplified machine; no edit expected. `tsc` proves it.

### 5. test/chain.test.ts — MINIMAL reconciliation only

The full rewrite is P1.M2.T1.S2. This task touches only what the redesign
breaks, keeping the suite green:
- Case (8) first sub-case (`"alpha "` trailing space): superseded by the
  zero-char offer — now expects the unfiltered successor menu
  (`{items:[beta,bravo…], prefix:""}`) instead of disarm+delegate.
  KEEP the second sub-case (punctuation `"beta!"` → disarm + delegate)
  and ALL delegation-identity assertions (verbatim lines/options identity,
  `current.applyCompletion` call passthrough) — those semantics are
  preserved. **Documented decision**: the old pin (provider.ts ~265,
  "word-less first query must disarm") belonged to the retired
  adjacency/pending mechanism and contradicts PRD h2.43's word-start offer;
  update the pin comment accordingly (see research notes).
- Remove/adjust any reference to `consumePending` or leading-space values
  (`grep -n 'consumePending\|` `' test/chain.test.ts`).
- Cases 1, 2, 4–7, 9–12 and the line-500 end-to-end route should pass
  unchanged; if case (12)'s display composition references the pending
  offer specifically, re-point it at the word-start offer (same prefix-""
  lastLive shape — the display classifier is unchanged).

### Success Criteria

- [ ] Zero-char offer at word start (after space/tab or line start) returns unfiltered `topSuccessors(W)` with BARE values, prefix "", description "chain"
- [ ] No leading-space values anywhere; `liveKeyByValue` successor keys are bare `s.next`
- [ ] Fragment filtering at threshold 0; punctuation / word-less-non-start / zero-match / no-successors → `chain.reset()` + normal path on the SAME keystroke
- [ ] `consumePending` and `pending` absent from src/ and test/
- [ ] applyCompletion phrase case deleted; CHAIN re-arm + whole-word arm (incl. trigger-mode) intact; delegation verbatim
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer needs: the exact current armed-branch/applyCompletion/ChainMachine
code layout, the confirmed pi-tui bare-value semantics, the case-(8)
reconciliation decision, the topSuccessors contract, and the scope fences
(force branch = P1.M2.T2.S1; config rename = P1.M3.T1.S1; full chain.test.ts
rewrite = P1.M2.T1.S2). All below.

### Documentation & References

```yaml
- file: src/pi/provider.ts
  why: The entire change surface. armed branch 239–316, applyCompletion 351–400,
        ChainMachine 409–498, CHAIN_KEY_PREFIX ~421, lastLive/liveKeyByValue
        closure state ~187–190.
  pattern: publish every armed set through lastLive with matching prefix so
           createDisplayProvider's `result.prefix === live.prefix`
           classification composes unchanged.
  gotcha: keep `config.enablePhrases` as the gate (rename is P1.M3.T1.S1);
          delegate paths forward the ORIGINAL options object.

- file: test/chain.test.ts
  why: The suite this must keep green (minimal edits only). Helpers makeStack /
        armViaTab / suggest / seedStore; cases enumerated at lines 190–500.
  gotcha: case (8) first sub-case is superseded (see decision above); do not
          touch provider.test.ts (pins verbatim delegation).

- file: src/pi/index.ts
  why: before_agent_start chain.reset() wiring (251–255) — verify, not edit.

- file: src/core/store.ts
  why: topSuccessors(word) contract — O(1), Array<{next,count}>, frozen shared
        empty on miss; ≤3 entries maintained at ingest.

- docfile: plan/002_3e8a42cadf2c/architecture/pi_layer_map.md
  section: "§1 src/pi/provider.ts"
  why: Line-precise map of today's control flow, the leading-space sites
        (254, ~280), and the redesign risk notes.

- docfile: plan/002_3e8a42cadf2c/architecture/external_deps.md
  section: "§2a. Zero-prefix at an empty word start" + confirmations (b)
  why: CONFIRMED pi-tui insertion semantics — bare value at prefix "" splices
        verbatim and word-separated; leading space double-spaces; no trailing
        space added on the plain path.

- docfile: plan/002_3e8a42cadf2c/P1M1T3S3/PRP.md
  why: The immediately-preceding item's contract (successors suite through the
        real pipeline, phrase-symbol-free tree) — assume delivered exactly.

- url: (pi-tui source, local) node_modules/@earendil-works/pi-tui/dist/components/editor.js
  why: applyCompletion / requestAutocomplete branches cited by external_deps.md;
        re-verify only if behavior contradicts the documented §2a semantics.
```

### Current Codebase tree (relevant)

```bash
src/pi/provider.ts     # armed branch, applyCompletion, ChainMachine — MODIFY
src/pi/index.ts        # before_agent_start reset — VERIFY
test/chain.test.ts     # minimal reconciliation — MODIFY (case 8 + seam refs)
test/provider.test.ts  # verbatim-delegation pins — DO NOT TOUCH
```

### Desired Codebase tree

```bash
src/pi/provider.ts     # MODIFIED: word-start offer, bare values, threshold 0,
                       #   no pending, no phrase arm case
src/pi/index.ts        # unchanged (verified)
test/chain.test.ts     # MODIFIED (minimal): case 8 sub-case 1, consumePending refs
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: with prefix "" pi-tui splices item.value VERBATIM — the value must
// be the BARE word; a leading space double-spaces (external_deps §2a).

// GOTCHA: pi's plain applyCompletion adds NO trailing space — chains rely on
// the USER's separating space as the word boundary ("zero typed chars" means
// zero chars of the NEXT word, not a magic auto-space).

// GOTCHA: the (a) word-start check (before === "" || /[ \t]$/.test(before))
// must run BEFORE the fragment regex — a word start has no trailing word
// chars, but ordering makes the intent explicit and avoids double evaluation.

// GOTCHA: armed sets must publish lastLive.prefix EXACTLY equal to the
// returned prefix ("" or frag) or createDisplayProvider's hapax classifier
// (result.prefix === live.prefix) treats them as non-hapax and bypasses the
// debounce logic incorrectly.

// GOTCHA: chain.reset() before fall-through — never return an empty hapax
// set; the normal path (or delegation) answers on the SAME keystroke
// (invariant 3: menu never renders with zero candidates).

// GOTCHA: don't read options.force here — the forced single-item branch is
// P1.M2.T2.S1 and will insert AFTER this armed block.

// GOTCHA: multi-word values are FORBIDDEN everywhere (PRD §06 h2.38 / §07
// h2.44). If real-editor validation ever contradicts the bare-value
// separation, DOCUMENT the exact constraint before choosing a minimal fix —
// never "fix" it with a multi-word or leading-space value.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: SIMPLIFY ChainMachine (src/pi/provider.ts ~409–498)
  - DELETE: pending closure var, consumePending() (interface + impl + JSDoc)
  - CHANGE: arm(word) → armed = word only
  - UPDATE: the machine's doc-comment armed-rules list (word-start offer,
    threshold-0 filter, disqualification rules, reset triggers)
  - KEEP: state(), reset(), CHAIN_KEY_PREFIX, ChainState

Task 2: REDESIGN the armed branch (src/pi/provider.ts 239–316)
  - REPLACE the pending/adjacency block with the (a)/(b)/(c) logic in "What" §1
  - VALUES: bare s.next everywhere; liveKeyByValue keys bare s.next
  - REWRITE the comment block 200–238 (retire pending-offer + leading-space
    rationale + case-(8) pin; cite external_deps §2a for bare values)

Task 3: CLEAN applyCompletion (src/pi/provider.ts 351–400)
  - DELETE the space-joined phrase arm branch + BUG-005 comment
  - KEEP CHAIN re-arm + whole-word arm; keep unconditional verbatim delegation
  - KEEP the config.enablePhrases gate around the arming side-effect

Task 4: VERIFY src/pi/index.ts
  - npm run check proves chain?.reset() still typechecks against the slim
    interface; no edit

Task 5: MINIMAL test/chain.test.ts reconciliation
  - Case (8) sub-case 1: expect the successor offer at "alpha " (items +
    prefix ""); keep punctuation sub-case + ALL delegation-identity assertions
  - Remove consumePending / leading-space references (grep first)
  - Re-point case (12)'s composition if it names the pending offer
  - DO NOT rewrite the suite (P1.M2.T1.S2) or touch provider.test.ts
```

### Implementation pattern

Word-start offer publishing (the critical seam — mirror the existing
fragment path's publish shape exactly):

```typescript
const items = succ.map((s) => ({
  value: s.next,          // BARE — pi-tui splices verbatim at prefix ""
  label: s.next,
  description: "chain",
}));
lastLive = {
  matches: succ.map((s) => ({
    key: CHAIN_KEY_PREFIX + s.next,
    display: s.next,
    description: "chain",
    salience: -s.count,   // count-desc ordering
  })),
  prefix: "",             // MUST equal the returned prefix
  ts: Date.now(),
};
liveKeyByValue.clear();
for (const s of succ) liveKeyByValue.set(s.next, CHAIN_KEY_PREFIX + s.next);
return { items, prefix: "" };
```

### Integration Points

```yaml
NONE new:
  - Downstream: P1.M2.T2.S1 inserts the forced single-item branch after the
    armed block (it will return the top successor when armed on force).
  - P1.M2.T1.S2 rewrites chain.test.ts + adds PRD §09 integration item 7.
  - P1.M3.T1.S1 renames the config gate enablePhrases → enableChaining.
  - index.ts reset wiring unchanged.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check        # tsc --noEmit — zero errors (proves index.ts wiring too)
grep -rn 'consumePending\|pending' src/pi/provider.ts   # expect nothing
```

### Level 2: Unit Tests

```bash
npx vitest --run test/chain.test.ts -v          # reconciled suite green
npx vitest --run test/provider.test.ts test/provider-display.test.ts test/provider-live.test.ts -v
npm test                                          # full suite green
grep -n 'consumePending' test/chain.test.ts      # expect nothing
```

### Level 3: Behavioral spot-checks (via the suite)

- Zero-char offer: armed "alpha" + buffer `"alpha "` → `{items:[beta,bravo,...], prefix:""}`, chain still armed
- Line-start offer: buffer `[""]` col 0 while armed (edge — verify and pin whichever behavior extractMatchState fall-through gives if successors empty)
- Insertion shape: accepting the offer at `"alpha "` yields `"alpha beta"` (single space) — assert via `current.applyCompletion` delegation or a faithful-editor check in S2's rewrite
- Punctuation `"beta!"` → disarm + delegate, options/lines identity preserved (case 8 preserved semantics)

### Level 4: Real-editor validation (optional here, mandatory in S2)

The bare-value separation is CONFIRMED from pi-tui dist source (external_deps
§2a). If any live pi run contradicts it, STOP and document the exact
constraint in this task before choosing a minimal fix — multi-word values
remain forbidden regardless.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors
- [ ] `npm test` full suite green
- [ ] No `consumePending`/`pending`/leading-space values in src/ or test/

### Feature Validation

- [ ] Zero-char offer at word start (space/tab/line start), bare values, prefix "", description "chain"
- [ ] Threshold-0 fragment filtering for the whole chain duration
- [ ] Disqualification (punctuation, word-less non-start, zero matches, no successors) → reset + normal path SAME keystroke
- [ ] applyCompletion: phrase case gone; CHAIN re-arm + whole-word arm (incl. trigger-mode) intact; verbatim delegation
- [ ] before_agent_start reset still wired (tsc + existing test 10)
- [ ] No multi-word value anywhere

### Code Quality Validation

- [ ] Comment blocks rewritten (no stale pending/adjacency/leading-space rationale)
- [ ] Scope fences respected: no force branch, no config rename, no full test rewrite
- [ ] Case-8 decision documented in code/test comments

## Anti-Patterns to Avoid

- ❌ No leading-space or multi-word values — bare single words only (pi-tui splices verbatim at prefix "")
- ❌ Don't return an empty hapax set — reset and fall through
- ❌ Don't read options.force or touch the display debounce layer (S2 tasks own them)
- ❌ Don't silently change pinned test expectations — the case-8 sub-case change is documented, everything else preserved
- ❌ Don't arm from anything but hapax's own liveKeyByValue candidates (path completion never arms)

**Confidence Score: 8/10** — pi-tui semantics and all seams are
line-verified; the one judgment call (case-8 sub-case supersession) is
explicitly resolved and documented with PRD backing.