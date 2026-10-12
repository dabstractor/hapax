# PRP — P2.M2.T1.S2: Fallback-path post-accept battery (provider + display layers)

---

## Goal

**Feature Goal**: Build the missing spec/07 h3.11 **fallback-path** post-accept battery —
the provider/display-layer twin of the existing widget-path battery (test/widget.test.ts
≈:2556). It pins, in executable form: after a Tab-accept through the provider's REAL
`applyCompletion` (arming side effect fires, buffer visibly spliced with pi-tui's
prefix-deletion math), (a) the provider NEVER self-requests — pi-tui issues no
autocomplete re-request after an apply, so no offer appears until the next keystroke's
explicit `getSuggestions` call (the pinned contract from P2.M2.T1.S1); (b) that next
explicit request at the post-apply cursor returns the post-Tab extension offer set with a
prefixIsAnchor-safe prefix (and the zero-char chain offer at the next word start); (c)
clean state: chain armed at the FINAL accepted word, one granted offer per arm,
`__hapaxLive()`/`__hapaxKey()` consistent, and NO Tab-accept rest-of-word suppression
armed (h3.11: "suppression still never arms — the seam change is unconditional"); plus a
display-layer companion proving the display provider emits NOTHING between the apply and
the next request (no pending swap, no timer promotion).

**Deliverable**: Test-only additions — one new `describe` battery appended to
`test/provider-live.test.ts` (provider + chain legs) and one new `describe` companion
appended to `test/provider-display.test.ts` (display leg), each with a banner citing
spec/07 h3.11's fallback paragraph (spec/07-completion-ui.md:316–321) and the PIN
location from P2.M2.T1.S1 (the comment inside `applyCompletion` in src/pi/provider.ts).
Zero production-code changes.

**Success Definition**: `npm run check` clean; full `npx vitest run` green (existing
1286-passed baseline plus the new tests, zero modified/removed tests); `git diff` touches
ONLY the two test files; every assertion in the item contract's (a)/(b)/(c) + display
legs is present and passing; a pi-tui upgrade that someday re-requests after an apply
now has a documented, failing pinned contract to trip over.

## User Persona

Not applicable — internal test artifact (Mode A: no user-facing change). Beneficiaries:
maintainers re-verifying after a pi-tui upgrade (spec/07 h3.15 re-verify workflow) and
the P2.M2.T2.S2 spec-drift session that documents this battery's existence.

## Why

- BUG-004 (bug-hunt Minor Issue 2, PRD §h3.3): spec 07 h3.11 required "verify at
  implementation and PIN at the consumption site" for the fallback path; today only the
  WIDGET-path h3.11 battery exists (test/widget.test.ts ≈:2556) and no fallback-path
  post-accept battery does.
- Verified contract (architecture note §2.1, against @earendil-works/pi-tui 0.84.4): all
  three apply sites in the dist editor (menu-Tab accept ≈:545, select.confirm ≈:560,
  forced single-item fast path ≈:1906) return WITHOUT calling `requestAutocomplete`. The
  fallback path therefore degrades to "no re-offer until the next keystroke" — the
  degradation spec 07 accepts. Nothing currently pins this in tests.
- Risk closed: a pi-tui upgrade that adds a post-apply re-request silently changes
  fallback-path offer timing; this battery makes that change trip a documented, pinned
  contract (paired with the P2.M2.T1.S1 comment PIN).

## What

New tests only. Three provider-level legs + one display leg:

1. **Rung-1 pin (extension offer)**: ladder store (`implement`/`implements`/
   `implementation`); `getSuggestions(["implem"],0,6,{force:false})` → accept the top
   item via the provider's REAL `applyCompletion` → assert the arming side effect
   (chain armed at `implement`), the visible buffer splice, NO provider self-request
   activity, `__hapaxLive()` NOT republished by the apply; then the NEXT explicit
   `getSuggestions(["implement"],0,9)` returns the extension offer
   `[implements, implementation]` with anchor-safe prefix `"implement"`.
2. **Two-rung walk + recovery (no suppression)**: accept `implements` from the extension
   offer → next request at `["implements"]` returns null (0-candidate disqualification
   close — "NOTHING suppresses"); ONE backspace → the request at `["implement"],0,9`
   re-renders the extension offer — proving no rest-of-word suppression armed.
3. **Zero-char chain-offer leg**: store seeded with successors of `implement` (via
   `recordBigramRuns`); after the arm, the request at `["implement "],0,10` (the next
   word start) returns the zero-char successor offer at prefix `""` — the offer the spec
   says "rides the same post-applyCompletion re-request".
4. **Display companion (fake timers)**: after `wrapper.applyCompletion(...)`,
   `advanceTimersByTime` promotes NOTHING (emissions sequence unchanged — no pending
   swap); the next `wrapper.getSuggestions` paints the extension set (immediately, per
   the applyRanSincePaint rule) — emissions asserted as whole value sequences.

### Success Criteria

- [ ] Provider battery in test/provider-live.test.ts with banner citing spec/07 h3.11
      fallback paragraph + the P2.M2.T1.S1 PIN location in provider.ts.
- [ ] Assertion set (a): after the apply, no `getSuggestions` activity without an
      explicit new call (`current.getSuggestions` count unchanged; `current.applyCompletion`
      called exactly once; `__hapaxLive()` not republished) — documented in the banner as
      the pinned "provider never self-requests / pi-tui never re-requests" contract.
- [ ] Assertion set (b): next explicit request returns the extension offer set with
      `prefixIsAnchorSafe(line, col, result.prefix) === true`; zero-char leg returns
      prefix `""` successor offer with `__hapaxKey` chain-marker consistency.
- [ ] Assertion set (c): chain armed at the FINAL accepted word (arm-call sequence
      `["implement", "implements"]` on the two-rung walk); exactly one granted offer per
      arm pinned observably; `__hapaxLive()`/`__hapaxKey()` consistent after each request
      (live.prefix === returned prefix; key defined for every returned value); no
      suppression armed (recovery request re-renders the offer).
- [ ] Display companion in test/provider-display.test.ts: post-apply emissions sequence
      empty until the next request, under fake timers.
- [ ] Mock surface: `vi.fn()` current provider + fabricated stores only — no editor
      double, no widget, no pi-tui import beyond types already used by the suites.
- [ ] `npm run check` clean; full vitest suite green; git diff = the two test files only.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase would they have everything?" — Yes. Every
helper to copy has an exact file:line source, every expected return value is derived from
the provider source walk in research/fallback-battery-research.md, and the validation
commands are the repo's own.

### Documentation & References

```yaml
- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P2M2T1S2/research/fallback-battery-research.md
  why: Verified behavior walk (steps 1-5), exact signatures, line anchors, decisions.
  critical: The expected values in the tests below were derived from THIS walk; if an
            assertion fails, re-derive from src/pi/provider.ts before weakening it.

- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/bug003-004-widget-provider.md
  section: §2.4 (battery shape recommendation), §2.1 (pi-tui apply-site evidence), §2.3 (spec quotes)
  why: The bug-hunt evidence file the item contract cites; §2.4's recommended battery
       shape is exactly what this PRP specs.

- file: src/pi/provider.ts
  why: The system under test. Armed branch :378-549 ((a) zero-char / (b) membership /
       (c) disqualify+reset); applyCompletion override :678-736 (arming side effect,
       verbatim delegation); CHAIN_KEY_PREFIX :759; __hapaxLive/__hapaxKey :743-744;
       grant created internally :282 (NOT injectable); createDisplayProvider :1034+
       with applyRanSincePaint :1054 and its applyCompletion forward :1262-1268.
  pattern: read the armed branch before writing assertions — the extension offer comes
           from the NORMAL path after the armed branch's (c) reset on a ladder-only
           store (topSuccessors("implement") is empty there).
  gotcha: The apply itself does NOT clear or republish __hapaxLive()/liveKeyByValue —
          that is part of the "no self-request" pin.

- file: test/provider-live.test.ts
  why: HOME of the provider battery (append a describe). Local helper idioms to reuse
        verbatim: sighting() :26, put() :37, cfg() :59, opts() :64, mockCurrent() :74-90.
        NOTE: it has NO editingCurrent — copy the helper from chaining-gating.test.ts.
  pattern: header doc-comment style — the new describe banner documents the pinned
           contract with spec cites (mirror the widget battery banner, widget.test.ts:2537).

- file: test/chaining-gating.test.ts
  why: editingCurrent(initial, cursorCol) helper :85-112 (pi-shaped current with a
        persistent buffer whose applyCompletion visibly splices the accepted value) and
        suggest(p, lines, line, col) :114-120 ("one getSuggestions call, fresh options
        each time" — the request-by-request fallback harness shape).
  pattern: copy editingCurrent locally into provider-live.test.ts (per-suite helper
           duplication is the repo convention).

- file: test/provider-display.test.ts
  why: HOME of the display companion (append a describe). harness(debounceMs?, store?)
        idiom :147-160; emissions recorded as value lists (Emission = string[] |
        "<delegate>") asserted as whole sequences; wrapper.applyCompletion usage :241-270;
        fake-timers clock-pinned-to-0 beforeEach/afterEach pattern.
  gotcha: the harness emit() helper builds "#" + fragment (trigger mode) — the display
          leg runs in trigger mode; prefix assertions must include the "#".

- file: test/widget.test.ts
  why: :2537-2652 — the WIDGET-path h3.11 battery being mirrored (banner style, fork
        fixture, rung walk, chain.arm call-sequence assertion, fork-recovery test).
        spiedChain double :1428.
  pattern: `(chain.arm as Mock).mock.calls.map((c) => c[0])` assertion shape.

- file: test/helpers/editor-sim.ts
  why: editorApplyCompletion (pi-tui's blind prefix.length deletion math) and
        prefixIsAnchorSafe — import both; use prefixIsAnchorSafe on every returned
        prefix, and (optionally) cross-check the spliced buffer against
        editorApplyCompletion's math.

- file: test/adversarial-typing.test.ts
  why: Probe C :455-565 — the multi-hop template: REAL applyCompletion accepts through
        a live menu, chain re-arms per hop, next-hop requests hand-set
        current.state.lines/cursorCol then call getSuggestions.

- file: spec/07-completion-ui.md
  why: h3.11 "Post-Tab extension offer" — the fallback paragraph :316-321 (quote it in
        the banner); h3.15 re-verify list ≈:589-610 (context for why the battery exists).
  gotcha: READ-ONLY. Labels "h3.11"/"h3.15" are the task shorthand (by section title),
          not literal header numbers — cite by title + line.

- file: src/pi/chain-grant.ts
  why: tick semantics — the FIRST armed answer of an arming counts as the granted word
        (tick returns false); ""-after-nonempty or an unrelated fragment = new word
        (spent → true). reset() beside every arm site.
  gotcha: the provider's tracker is internal (provider.ts:282) and NOT injectable —
          "grant reset exactly once per arm" is pinned OBSERVABLY (arm-call sequence +
          one granted word-start offer), never by counting reset() calls; do NOT
          vi.mock the module (not repo style).
```

### Current Codebase tree (relevant excerpt)

```bash
src/pi/provider.ts            # SUT: armed branch, applyCompletion, display wrapper
src/pi/chain-grant.ts         # one-shot grant tracker (internal to the provider)
src/core/store.ts             # CandidateStore, recordBigramRuns(:747)
test/provider-live.test.ts    # ← append provider+chain battery describe
test/provider-display.test.ts # ← append display companion describe
test/chaining-gating.test.ts  # editingCurrent + suggest helper source
test/helpers/editor-sim.ts    # editorApplyCompletion / prefixIsAnchorSafe
test/widget.test.ts           # widget-path h3.11 battery (the analog), :2537-2652
spec/07-completion-ui.md      # h3.11 :316-321, h3.15 ≈:589-610 (READ-ONLY)
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
test/provider-live.test.ts    # + describe "fallback path — post-accept battery …":
                               #   forkStore/editingCurrent/chain-double helpers,
                               #   rung-1 pin, two-rung+recovery, zero-char leg
test/provider-display.test.ts # + describe "display — post-apply silence …":
                               #   ladder fixture, post-apply no-emission pin,
                               #   next-request paints extension set
# (no new files; no src/ changes)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: pre-Tab set is [implement, implementation] — "implements" is PLURAL-PRUNED
// (spec 04) while the singular is offered; it enters only after the Tab's exact-equal
// exclusion removes "implement" (widget battery :2592 comment pins the same on the
// widget path). Expect the top accepted item to be "implement".

// CRITICAL: give implement/implements/implementation EQUAL sessionCounts (e.g. put ×2,
// same ordinal band) so §04 h2.29 tier ties fall to shortest-first — the fork order
// [implements, implementation] must not depend on counts.

// CRITICAL: on a ladder-only store, the post-apply request at "implement" goes armed
// branch (b) → zero successors → (c) chain.reset() → the NORMAL path returns the
// extension offer. The chain is IDLE after that request — assert armed state BEFORE
// further requests, exactly as the contract's "armed at the FINAL accepted word" says.

// CRITICAL: getSuggestions is async — await every call; opts() makes a fresh
// AbortController per call (suite idiom). force stays ABSENT for keystroke-shaped
// requests ({ signal } only).

// GOTCHA: rankMatches("implements") is [] — "implementation".startsWith("implements")
// is false ('a' ≠ 's' at index 8) and exact-equal drops "implements" itself. The
// 0-candidate path clears __hapaxLive() and DELEGATES: the mock current returns null →
// the rung-2 request result is null and current.getSuggestions is finally called once.

// GOTCHA: __hapaxKey of a chain successor is "\u0000chain:" + key (provider.ts:759,
// module-private) — assert the literal with a comment, or assert defined-and-not-equal
// to the plain key.

// GOTCHA: display suite runs vi.useFakeTimers with the clock pinned to 0 — follow its
// beforeEach/afterEach; every advanceTimersByTime call needs explicit t= math comments
// (existing style).

// GOTCHA: soft dependency on P2.M2.T1.S1 (parallel): the banner cites the PIN inside
// provider.ts applyCompletion, but the battery must NOT require the comment to exist —
// cite spec/07 h3.11 as authoritative and mention the PIN location. Do not duplicate
// S1's work (no provider.ts edits).
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: RE-VERIFY anchors (10 min, mandatory)
  - READ src/pi/provider.ts :378-549 (armed branch), :678-744 (applyCompletion +
    introspection), :1034-1270 (display wrapper); src/pi/chain-grant.ts (tick/reset);
    the headers of the three test suites; test/widget.test.ts:2537-2652.
  - RE-DERIVE the expected values from research/fallback-battery-research.md §"Verified
    behavior walk". If the tree moved and a step differs, follow the SOURCE (update the
    test expectations to the real behavior); if the real behavior contradicts spec 07
    h3.11 itself, STOP and report — production fixes are other items' scope.

Task 1: ADD local helpers to test/provider-live.test.ts (inside the new describe or
        beside the existing helpers — match file layout)
  - forkStore(): CandidateStore — put(s,"implement",2,9); put(s,"implements",2,9);
    put(s,"implementation",2,9) (equal counts, same ordinal band; reuse the file's
    existing sighting/put helpers).
  - editingCurrent(initial: string[], cursorCol: number) — COPY verbatim from
    test/chaining-gating.test.ts:85-112 (persistent state buffer; applyCompletion
    splices accepted.value via prefix.length math and returns the new cursor).
  - suggest(p, lines, line, col) — COPY from chaining-gating.test.ts:114-120 (fresh
    opts() per call).
  - recording chain double: a delegating spy over a REAL machine —
    `const real = createChainMachine(); const chain = { state: () => real.state(),
    arm: vi.fn(real.arm), reset: vi.fn(real.reset) }` — gives BOTH the arm-call
    sequence (widget battery assertion surface) and live state() (probe-C surface).
    createChainMachine is already exported from ../src/pi/provider.js.
  - IMPORT { editorApplyCompletion, prefixIsAnchorSafe } from "./helpers/editor-sim.js".

Task 2: ADD describe "fallback path — post-accept battery (spec 07 h3.11 fallback
        paragraph, spec/07-completion-ui.md:316-321; PIN in src/pi/provider.ts
        applyCompletion — P2.M2.T1.S1)" to test/provider-live.test.ts
  - BANNER (block comment above the describe, mirror widget.test.ts:2537): quote the
    h3.11 fallback sentence; state THE PIN in test form — "pi-tui issues no request
    after an apply (all three dist editor apply sites return without
    requestAutocomplete, verified vs @earendil-works/pi-tui 0.84.4); this provider is
    pull-only, so the extension offer and the zero-char chain offer surface ONLY on the
    next explicit getSuggestions call — these tests ARE that next call. A pi-tui
    upgrade adding a post-apply re-request must re-verify this battery (spec 07 h3.15)."
  - TEST "rung 1: accept 'implement' via the REAL applyCompletion → armed at it, buffer
    spliced, provider silent, next explicit request returns the anchor-safe extension
    offer":
      1. current = editingCurrent(["implem"], 6); chain double; provider =
         createHapaxProvider(forkStore(), cfg(), current, chain).
      2. r1 = await suggest(provider, ["implem"], 0, 6)  // force:false shape
         → expect r1.prefix === "implem"; r1.items[0].value === "implement";
         prefixIsAnchorSafe("implem", 6, r1.prefix) === true;
         current.getSuggestions NOT called (hapax owns the word request).
      3. const live1 = provider.__hapaxLive();
         provider.applyCompletion(["implem"], 0, 6, r1.items[0], r1.prefix);
         → expect current.state.lines === ["implement"], current.state.cursorCol === 9
           (visible splice);
         → cross-check: lines[0] === editorApplyCompletion("implem", 6,
           "implement", "implem") (pi-tui deletion math);
         → chain: state() === { word: "implement" }; (chain.arm as
           Mock).mock.calls.map(c => c[0]) === ["implement"];
         → (a) THE PIN: current.applyCompletion called EXACTLY once (the delegation);
           current.getSuggestions STILL not called; provider.__hapaxLive() === live1
           (toBe — same object, NOT republished) — the apply answers nothing.
      4. r2 = await suggest(provider, ["implement"], 0, 9)  // the next keystroke's request
         → expect r2.prefix === "implement";
           r2.items.map(i => i.value) === ["implements", "implementation"]
           (exact-equal exclusion + shortest-first);
           prefixIsAnchorSafe("implement", 9, r2.prefix) === true — the hard BUG-002
           invariant on the post-Tab offer;
         → live cache consistent: provider.__hapaxLive()?.prefix === "implement";
           for every item, provider.__hapaxKey(item.value) is defined
           (=== the plain lowercase key for word candidates).
  - TEST "two-rung walk: accept 'implements' → null disqualification close with NO
    suppression → ONE backspace re-renders the offer (h3.11: the seam change is
    unconditional)":
      1. Continue from rung 1 (fresh harness): provider.applyCompletion(["implement"],
         0, 9, r2.items[0], r2.prefix) → buffer ["implements"], col 10;
         arm sequence === ["implement", "implements"]; state() === { word: "implements" }
         — armed at the FINAL accepted word.
      2. r3 = await suggest(provider, ["implements"], 0, 10) → expect r3 === null;
         current.getSuggestions called exactly once (the 0-candidate delegation);
         provider.__hapaxLive() === null (zero-candidate clears the cache);
         buffer unchanged — NOTHING suppresses (disqualification close).
      3. Recovery: r4 = await suggest(provider, ["implement"], 0, 9) → the extension
         offer re-renders: r4.items.map(...) === ["implements", "implementation"],
         r4.prefix === "implement", anchor-safe — a rest-of-word suppression seam
         would have returned null here; h3.11 says it never arms. Assert it.
  - TEST "zero-char chain offer rides the same next request (companion store with
    seeded successors)":
      1. store = forkStore(); store.recordBigramRuns([["implement", "policy"],
         ["implement", "policy"]])  (store.ts:747 accepts bare string[][]; count 2
         gives a stable top successor; a DIFFERENT word than the ladder isolates the
         successor index from the extension set).
      2. Re-run the rung-1 accept (armed at "implement"), then simulate the separating
         space's request: current.state.lines = ["implement "]; col 10;
         z = await suggest(provider, current.state.lines, 0, 10)
         → expect z.prefix === "" (zero typed chars of the next word);
           z.items[0].value === "policy" (successor display casing);
           provider.__hapaxKey("policy") === "\u0000chain:policy" (the chain marker —
           comment: module-private CHAIN_KEY_PREFIX, provider.ts:759);
           provider.__hapaxLive()?.prefix === "" (published prefix === returned prefix).
      3. Grant observable (one granted offer per arm): after accepting "policy"
         (armed(next)) the NEXT word-start request re-offers policy's successors —
         and typing through to an unrelated word disarms (chain.test.ts:324 pins the
         tracker unit; here assert ONE compact consequence: after the zero-char offer
         answers, a request at ["implement z"], 0, 11 still answers from the armed
         branch per (b); a request at ["implement zx "], 0, 14 (typed through, new
         word start) no longer offers successors — chain.state() === null).

Task 3: ADD describe "display — post-apply silence until the next request (spec 07
        h3.11 fallback companion; PIN in provider.ts applyCompletion — P2.M2.T1.S1)"
        to test/provider-display.test.ts
  - FIXTURE: ladder store via the file's existing put() idiom (equal counts);
    harness(debounceMs 100, store) per the file's helper; emissions log.
  - TEST: (1) e1 = await emit("implem") → emission [implement, implementation] (plural
    pruning); emissions === [[implement, implementation]].
    (2) wrapper.applyCompletion(["#implem"], 0, 7, { value: "implement", label:
    "implement" }, "#implem") — the display wrapper forwards to base.applyCompletion
    (provider.ts:1262-1268) so the arming fires; assert the returned splice math via
    editorApplyCompletion if the harness exposes the inner current (optional).
    (3) vi.advanceTimersByTime(1000) → emissions STILL ===
    [[implement, implementation]] — the apply scheduled NOTHING: no pending swap, no
    timer promotion (THE pin — an emission can only come from a getSuggestions call).
    (4) e2 = await emit("implement") → the extension set paints IN THIS CALL
    (applyRanSincePaint, provider.ts:1054; existing precedent :241) — emissions ===
    [[implement, implementation], [implements, implementation]]. Assert the whole
    sequence (file convention).
    (5) Optional third rung: emit("implements") → "<delegate>" (0 candidates) and
    emissions grows by exactly "<delegate>" — the disqualification close on the
    display path; still no suppression (a following emit("implement") re-paints).

Task 4: VALIDATE (see Validation Loop) — then `git diff --stat` must show exactly the
        two test files.
```

### Implementation Patterns & Key Details

```ts
// The rung-1 spine (provider leg) — every value below is source-derived (research note):
const current = editingCurrent(["implem"], 6);
const real = createChainMachine();
const chain = { state: () => real.state(), arm: vi.fn(real.arm), reset: vi.fn(real.reset) };
const provider = createHapaxProvider(forkStore(), cfg(), current, chain as ChainMachine);

const r1 = await suggest(provider, ["implem"], 0, 6);
expect(r1!.items[0]!.value).toBe("implement");          // plural pruning kept it on top

const live1 = provider.__hapaxLive();
provider.applyCompletion(["implem"], 0, 6, r1!.items[0]!, r1!.prefix);

// (a) THE PIN — silence after the apply:
expect(current.applyCompletion).toHaveBeenCalledOnce(); // the delegation, nothing more
expect(current.getSuggestions).not.toHaveBeenCalled();  // never self-requests
expect(provider.__hapaxLive()).toBe(live1);             // not even republished

// (b) the next keystroke's request — the ONLY thing that can produce an offer:
const r2 = await suggest(provider, ["implement"], 0, 9);
expect(r2!.items.map((i) => i.value)).toEqual(["implements", "implementation"]);
expect(prefixIsAnchorSafe("implement", 9, r2!.prefix)).toBe(true); // BUG-002 invariant
```

```ts
// Display leg — emissions as whole sequences, clock at 0 (suite idiom):
vi.advanceTimersByTime(1000); // t=1000: the apply scheduled nothing — nothing promotes
expect(emissions).toEqual([["implement", "implementation"]]);
const e2 = await emit("implement"); // paints immediately (applyRanSincePaint)
expect(emissions).toEqual([
  ["implement", "implementation"],
  ["implements", "implementation"],
]);
```

### Integration Points

```yaml
NO production integration — test-only.
CONSUMERS:
  - spec 07 h3.15 re-verify workflow: on any pi-tui upgrade, this battery is the
    executable contract paired with the P2.M2.T1.S1 comment PIN.
  - P2.M2.T2.S2 (spec-drift compiler): the battery's existence + banner is cited in
    the drift report; no dependency the other way.
PARALLEL ITEM BOUNDARY: P2.M2.T1.S1 lands a comment inside provider.ts
applyCompletion. This item MUST NOT edit src/ at all; its banner cites the PIN's
location and degrades gracefully if S1's comment is not yet present.
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npx tsc --noEmit            # repo check script: npm run check
# Expected: clean. Test files are typechecked too — the chain-double cast and
# editor-sim imports must compile.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run test/provider-live.test.ts test/provider-display.test.ts
# Expected: all existing tests in both files still pass + the new describes green.

npx vitest run              # FULL suite — baseline 40 files / 1286 passed / 1 skipped;
                            # only ADDITIONS allowed, zero modified test names.
```

### Level 3: Integration Testing (System Validation)

Not applicable — no service/runtime change (test-only item). The battery itself IS the
integration pin between provider.applyCompletion and the request cadence.

### Level 4: Creative & Domain-Specific Validation

```bash
grep -n "h3.11" test/provider-live.test.ts test/provider-display.test.ts
# Expected: banner cites in both files.
grep -nE "re-request|re-offer|post-applyCompletion" src/pi/provider.ts
# Expected: matches (the P2.M2.T1.S1 PIN — if absent because S1 hasn't landed, note it
# in the final report; this item does not add it).
git diff --stat             # Expected: exactly test/provider-live.test.ts and
                            # test/provider-display.test.ts.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean; full `npx vitest run` green (additions only).
- [ ] `git diff --stat` = the two test files; no src/, spec/, or other test files touched.

### Feature Validation

- [ ] Banner in both suites cites spec/07 h3.11 fallback paragraph (title + :316-321)
      and the P2.M2.T1.S1 PIN location.
- [ ] Pin (a) present: post-apply silence (applyCompletion once, no delegation, no
      republish) with the banner documenting WHY (pi-tui never re-requests).
- [ ] Pin (b) present: extension offer set + prefixIsAnchorSafe; zero-char successor
      leg with prefix "" and chain-marker keys.
- [ ] Pin (c) present: arm sequence ["implement", "implements"], armed-at-final-word
      state assertion, live-cache consistency after each request, recovery request
      re-renders (no suppression).
- [ ] Display companion present: post-apply timer advance promotes nothing; next
      request paints the extension set; whole-sequence emissions assertions.
- [ ] Expected values re-derived from source in Task 0 (not copied blindly).

### Code Quality Validation

- [ ] Helpers copied from the named sources with a comment crediting the origin suite
      (repo convention for shared-shape helpers duplicated per suite).
- [ ] No vi.mock of internal modules; no editor double beyond editingCurrent's
      pi-shaped buffer; no new dependencies.
- [ ] Assertions carry the spec-citing comment style of the surrounding suites
      (every non-obvious expect has a why).

### Documentation & Deployment

- [ ] Mode A honored: no spec edits, no README changes, no user-facing change.
- [ ] Final report notes the battery's location for P2.M2.T2.S2's drift report.

---

## Anti-Patterns to Avoid

- ❌ Don't edit ANY production file — this is a battery item; a failing assertion
      against real behavior is a FINDING (report it), not something to fix in src/.
- ❌ Don't weaken an assertion because it failed — re-derive the expected value from
      src/pi/provider.ts first (the research walk's values are source-derived but the
      tree may have moved).
- ❌ Don't build a "tick-by-tick typing simulator" or try to make pi-tui re-request —
      "there is no way (and no need)… that is precisely the pinned contract"; the
      request-by-request shape (explicit sequential getSuggestions calls) IS the
      harness.
- ❌ Don't assert the internal grant tracker (not injectable at provider.ts:282) —
      pin its OBSERVABLE contract (arm sequence + one granted word-start offer).
- ❌ Don't duplicate P2.M2.T1.S1's PIN comment work or the widget battery — mirror,
      don't merge.
- ❌ Don't forget plural pruning: the pre-Tab set is [implement, implementation], not
      the full fork.
