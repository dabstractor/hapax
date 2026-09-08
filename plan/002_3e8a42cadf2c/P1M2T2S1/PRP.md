---
name: "P1.M2.T2.S1 (plan 002) — provider.ts force branch (abort → armed → force-aware returns → normal)"
---

## Goal

**Feature Goal**: Implement the PRD §07 h3.8 mitigation for the Tab-opens-menu
bug: read `options.force` in `createHapaxProvider`'s `getSuggestions` and, at
every hapax-owned return point (armed zero-char offer, armed filtered list,
normal threshold/trigger query), return a **single-item** set — the live top
item per §04 ranking (the top successor during an armed chain) — so
pi-tui's `force && explicitTab && items.length === 1` fast path applies the
completion in the same keypress instead of opening a menu. Delegation paths
forward the ORIGINAL options object unchanged so stock path/slash completion
keeps native Tab behavior.

**Deliverable**: Modified `src/pi/provider.ts` (force branch + pinning
comment); extended `test/provider-live.test.ts` (force contract cases) and
`test/provider.test.ts` (PRD §09's new Tab-only-completes bullet, forced
path).

**Success Definition**: `getSuggestions(..., {force:true})` with a live
fragment returns exactly ONE item (live top / chain successor); forced
returns are never empty-when-live and never multi-item; all delegation
paths still pass the identical options object (asserted by `toBe`);
`npm run check` + `npm test` green, chain.test.ts (S2, in flight) and
provider.test.ts existing cases unaffected.

## Why

- Root cause (traced, PRD §07 h3.8): pi-tui's editor Tab-with-no-menu path
  calls `getSuggestions(lines, line, col, {force:true, explicitTab:true})`
  (editor.js ~1892 providers get only `{signal, force}`; `explicitTab` is
  editor-internal). `runAutocompleteRequest` then branches:
  `items.length === 1` → applies immediately; `items.length > 1` → opens the
  menu in `'force'` state. hapax ignores `force` today (verified:
  `options.force` is never read in provider.ts) and returns its full ranked
  set → Tab lands in the menu-open branch. This violates design invariant 2
  ("Tab only ever completes… never opens, toggles, or summons the menu").
- Ordering contract (this task's title): abort check → armed branch →
  force-aware returns → normal path. `forced` is read once, after abort.
- Output contract consumed by P1.M2.T2.S2 (display-layer forced bypass) and
  audited by P1.M4.T1.S2.

## What

Modify `createHapaxProvider`'s `getSuggestions` in `src/pi/provider.ts`
ONLY. No changes to `extractMatchState`, `applyCompletion`, the chain
machine, `createDisplayProvider`, or any core module.

1. **Read force once, after abort**: at the top of the armed-branch section
   (immediately after the `options.signal.aborted` early return):
   `const forced = options.force === true;` — with a doc comment tying it
   to the branch order (abort → armed → force-aware returns → normal).
2. **Armed returns become force-aware**: `publishChain(succ, prefix)`
   currently returns `{items, prefix}`. Change its return (or wrap its call
   sites — pick whichever keeps the diff smallest and the `lastLive`
   publication semantics identical) so that when `forced`, the RETURNED
   value is `{ items: [items[0]], prefix }` — but `lastLive` still records
   the FULL filtered set (S2/S3's display layer and the live-map are not
   force-consumed; the single-item return is purely what pi-tui sees).
   `items[0]` is the top successor: `topSuccessors()` is count-desc and
   `publishChain` preserves that order.
3. **Normal path returns become force-aware**: at the final return (after
   `lastLive` publication and the `liveKeyByValue` rebuild), when `forced`,
   return `{ items: [firstItem], prefix: state.prefix }` where `firstItem`
   is the item mapped from `matches[0]` — §04 ranking's top (salience desc,
   shorter, lexicographic — `rankMatches` already ordered it). Again:
   `lastLive` keeps the full set; only the returned payload narrows.
4. **Delegation stays byte-identical**: the three delegate paths
   (aborted; null match state; zero candidates) already forward the ORIGINAL
   `options` object — do not change them. When `forced` with no hapax
   fragment (path/slash contexts), the null-match-state delegation is
   exactly the desired behavior: stock path/file completion keeps native
   Tab. Zero-candidate + forced → delegates (pi-tui's stock
   "no completion available" cancels and renders nothing) — no special
   empty-result branch needed; do NOT fabricate one.
5. **Pinning comment (REQUIRED, verbatim intent)**: at the `forced` read,
   comment that this mitigation leans on pi-tui's
   `options.force && options.explicitTab && suggestions.items.length === 1`
   branch (`components/editor.js` ~1903, verified against
   `@earendil-works/pi-tui` ~0.84.4): if pi-tui changes that contract, the
   mitigation needs revisit (zero-char chain offer and auto-open rules
   unaffected).
6. **The 100 ms display debounce is NOT this task's concern**
   (P1.M2.T2.S2 makes `createDisplayProvider` bypass suppression for forced
   results). Base-layer forced returns are correct even if the display layer
   currently re-serves its cached set — S2 fixes that seam.

### Success Criteria

- [ ] `force:true` + live threshold fragment → exactly 1 item = live top (`Zendesk` in the zeStore fixture)
- [ ] `force:true` + armed chain word-start/fragment → exactly 1 item = top successor
- [ ] `force:true` + trigger-char fragment → exactly 1 item
- [ ] All delegation paths still receive the identical options object (`toBe`)
- [ ] `force` absent/false → behavior byte-identical to today (full sets)
- [ ] Pinning comment present; `lastLive` always holds the FULL live set
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer with no prior knowledge needs: the exact current
`getSuggestions` control flow (quoted/sketched below), the pi-tui contract
(editor.js ~1892/~1903), the return-point inventory, the `lastLive`
seam semantics, and the test harness conventions. All below.

### Documentation & References

```yaml
- file: src/pi/provider.ts
  why: THE file. getSuggestions flow (≈L199-340): 1. abort delegate; 1.5 armed
        branch (publishChain at ≈L258, zero-char offer ≈L283, filtered fragment
        ≈L294-315); 2. extractMatchState null → delegate; 3. rankMatches; 4.
        lastLive publish + items mapping + return.
  pattern: numbered stage comments (1/1.5/2/3/4); delegations pass `options`
           by identifier, never cloned.
  gotcha: `options.force` is currently NEVER read — verified. Do not touch
          applyCompletion (its arming intercept is S1's) or the abort branch's
          priority (aborted + force:true still delegates — pinned by
          provider-live.test.ts:103-113).

- file: plan/002_3e8a42cadf2c/architecture/external_deps.md
  section: §1e (+ §2a for zero-prefix insertion)
  why: VERIFIED pi-tui contract: editor.js:1903
        `options.force && options.explicitTab && suggestions.items.length === 1`
        → applyCompletion immediately; items.length > 1 → menu opens 'force'
        state; editor.js:1892 passes providers only {signal, force};
        slash-context Tab routes NON-forced so the fast path can't fire there.

- file: plan/002_3e8a42cadf2c/architecture/pi_layer_map.md
  why: Where the force contract sits in the layer stack; S2's display-layer
        bypass consumes this task's return shape.

- file: plan/002_3e8a42cadf2c/P1M2T1S2/PRP.md
  why: Sibling contract (chain test rewrite, in flight). Its case-14 display
        classification asserts `result.prefix === live.prefix` composition —
        your forced single-item return must keep `prefix` equal to the
        unforced return's prefix so that invariant survives force.
  gotcha: don't reorder the armed branch relative to abort (S2's cases 1-3
          depend on the current ordering).

- file: test/provider-live.test.ts
  why: THE live-provider suite you extend. Verified helpers: opts(over)
        (L68) already accepts {force}; mockCurrent (L82); zeStore (L55) —
        Zendesk×3@ord9 out-saliences zephyr×1 → forced top IS "Zendesk";
        delegation asserts `call[3]).toBe(options)` identity style.
  pattern: describe/it, mock current getSuggestions sentinel, assert
           result shape + delegation-identity.

- file: test/provider.test.ts
  why: Never-hijack acceptance suite (cases a–g) + the §09 provider bullet.
        Extend with the forced-path assertion; keep existing cases untouched.
  pattern: delegation identity assertion at L147 `expect(call[3]).toBe(options)`.

- file: src/pi/config.ts
  why: DEFAULT_CONFIG / HapaxConfig (tests build cfg()). No config changes —
        force is not a config knob.
```

### Current Codebase tree (relevant)

```bash
src/pi/provider.ts          # MODIFY: getSuggestions force branch + pinning comment
test/provider-live.test.ts  # EXTEND: force contract cases (base provider)
test/provider.test.ts       # EXTEND: §09 Tab-only-completes forced bullet
```

### Desired Codebase tree with files added

```bash
# no new files — modifications only
src/pi/provider.ts          # forced read + force-aware returns at 3 hapax-owned points
test/provider-live.test.ts  # + describe("forced single-item returns (PRD §07 h3.8)")
test/provider.test.ts       # + forced-path never-hijack bullet cases
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// ORDER IS THE CONTRACT: abort → armed → force-aware returns → normal.
// aborted + force:true STILL delegates (provider-live.test.ts:103-113 pins
// this with toBe(options) identity) — force never outranks abort.

// lastLive KEEPS THE FULL SET on forced returns. The display layer (S3/S2)
// classifies via result.prefix === live.prefix and debounces sets; if forced
// returns published a 1-item lastLive, un-forcing on the next keystroke would
// look like a set change and fight the hysteresis. Only the RETURNED payload narrows.

// items[0] IS the top by construction: topSuccessors() is count-desc;
// rankMatches is salience desc → shorter → lexicographic. Do NOT re-sort.

// publishChain's returned prefix ("zero-char offer" or the raw fragment) must
// be UNCHANGED under force — pi-tui applies completion by replacing prefix
// chars before the cursor; a forced prefix mismatch would splice wrongly.

// Do NOT return a fabricated empty result on forced+zero-candidates — the
// existing zero-candidate path delegates with the original options, and
// pi-tui's stock behavior for a null/empty forced result is cancel+render-
// nothing. Fabricating {items:[],prefix:""} changes what pi-tui sees.

// options type: pi passes {signal, force?} — force is optional/possibly
// undefined; use `options.force === true` (never truthiness, `1`/objects
// from other callers must not fire the branch).

// The enabled-armed branch runs only under config.enablePhrases (gate stays
// until P1.M3.T1.S1) — forced tests that exercise the armed path must pass
// cfg({enablePhrases:true}) explicitly.

// Arm for chain tests via applyCompletion of a live hapax word item
// (armViaTab pattern in test/chain.test.ts ~171) — do not poke chain internals.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: MODIFY src/pi/provider.ts — force branch
  - ADD after the abort early-return, before the armed-branch comment block:
      const forced = options.force === true;
    plus the pinning comment (editor.js ~1903, pi-tui ~0.84.4, revisit clause).
  - MODIFY publishChain's return contract (smallest-diff choice: change the
    two `return publishChain(succ, prefix)` call sites to
    `const r = publishChain(succ, prefix); return forced ? { items: [r.items[0]], prefix: r.prefix } : r;`
    — keeps lastLive publication inside publishChain untouched).
  - MODIFY the normal-path final return identically: keep building the full
    items array (lastLive/liveKeyByValue already built from full matches),
    return forced ? { items: [items[0]], prefix: state.prefix } : { items, prefix: state.prefix }.
  - NO other edits: abort/null/zero-candidate delegates, applyCompletion,
    chain machine, extractMatchState, createDisplayProvider untouched.

Task 2: EXTEND test/provider-live.test.ts
  - ADD describe("forced single-item returns (PRD §07 h3.8)"):
    * force:true + "ze" (threshold 2, zeStore) → result.items.length === 1,
      items[0].value === "Zendesk" (live top), prefix "ze"
    * force:false/absent + "ze" → full set (Zendesk + zephyr) — behavior
      unchanged (regression pin)
    * force:true + trigger-char "#ze" → 1 item, prefix from trigger state
    * force:true + null match state ("z", threshold 2) → delegates with
      toBe(options) identity (native path Tab intact)
    * force:true + zero candidates ("#zzz") → delegates, toBe(options)
    * force:true + aborted signal → delegates FIRST (abort wins), toBe(options)
    * force:true + armed chain: arm via applyCompletion of a live word item
      (cfg enablePhrases:true; seed successors via store.recordBigramRuns),
      then getSuggestions(["alpha "],0,6,{force:true}) → items.length === 1,
      items[0].value === top successor (bare, count-desc top), prefix ""
    * force:true + armed + typed fragment ("alpha b") → 1 item = top match
    * lastLive after a forced armed query still holds the FULL successor set
      (via provider.__hapaxLive()) — the seam contract for S2/S3

Task 3: EXTEND test/provider.test.ts (§09 bullet, forced path)
  - ADD to the never-hijack area (new describe "Tab-only-completes — forced path"):
    * simulate Tab-before-paint: prime nothing (no prior query), call
      getSuggestions(["ze"], 0, 2, opts({force:true})) directly → exactly
      1 item → per the editor contract this completes rather than opening
      the menu (assert items.length === 1; comment cites editor.js ~1903)
    * "Tab never opens/toggles/summons a menu": with force:true and a live
      fragment the returned set can never have length > 1 (property-style:
      assert on the zeStore and an armed-chain case)
    * menu auto-open semantics unaffected: force:false + 2nd char of a
      matching word still returns the full multi-item set (typing, not Tab,
      drives the menu)
  - DO NOT modify existing cases (a)–(g) or delegation identity assertions.

Task 4: VALIDATE
  - npm run check
  - npx vitest --run test/provider-live.test.ts test/provider.test.ts -v
  - npm test   # full suite — chain.test.ts (S2, in flight) must stay green
```

### Implementation pattern

```typescript
// Force-aware return wrap (sketch — normal path; armed path identical shape)
const items = matches.map((m) => ({ value: m.display, label: m.display,
                                    description: m.description }));
lastLive = { matches, prefix: state.prefix, ts: Date.now() };
liveKeyByValue.clear();
for (const m of matches) liveKeyByValue.set(m.display, m.key);
// PRD §07 h3.8: pi-tui's force && explicitTab && items.length === 1 fast
// path applies the completion in the same keypress; >1 items opens a menu.
// Pinned against @earendil-works/pi-tui ~0.84.4 (editor.js ~1903): if that
// contract changes, this mitigation needs revisit.
return forced ? { items: [items[0]], prefix: state.prefix }
              : { items, prefix: state.prefix };
```

### Integration Points

```yaml
NONE this task:
  - Provider-internal change; no config/core/store edits.
  - Downstream (do NOT implement): P1.M2.T2.S2 makes createDisplayProvider
    bypass the 100 ms suppression for forced results (consumes this task's
    single-item return shape); P1.M4.T1.S2 audits this contract in the DoD
    sweep; P1.M4.T2.S1 refreshes the README never-hijack bullet (Mode B).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/provider-live.test.ts test/provider.test.ts -v
npm test   # full suite green (chain.test.ts included)
```

### Level 3: Integration

None beyond the suites (item 7 / acceptance is S2's and P1.M4.T1.S2's scope).

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green

### Feature Validation

- [ ] Every hapax-owned return point honors force: armed zero-char offer, armed filtered list, normal threshold/trigger query → exactly 1 item (top / chain successor)
- [ ] Delegation paths forward the identical options object (`toBe`); aborted+force still delegates first
- [ ] `lastLive` holds the full set on forced queries; returned prefix unchanged under force
- [ ] Pinning comment (editor.js ~1903, pi-tui ~0.84.4, revisit clause) present
- [ ] Unforced behavior byte-identical (regression pins in both suites)

### Code Quality Validation

- [ ] Smallest-diff change; numbered stage comments updated (branch order documented)
- [ ] `options.force === true` strict comparison; no config knobs; no new types
- [ ] applyCompletion / chain machine / createDisplayProvider / extractMatchState untouched

## Anti-Patterns to Avoid

- ❌ Don't let force outrank the abort check — abort always delegates first
- ❌ Don't narrow `lastLive` or the live-map to the single forced item — the display layer composes against the full set
- ❌ Don't change the returned prefix under force — pi-tui splices by prefix length
- ❌ Don't fabricate empty results on forced zero-candidates — delegate (stock pi-tui cancels)
- ❌ Don't implement the display-debounce bypass here (P1.M2.T2.S2 owns it)
- ❌ Don't use truthiness on `options.force` (`=== true` only)
- ❌ Don't touch chain.test.ts (S2's in-flight rewrite) or existing never-hijack cases