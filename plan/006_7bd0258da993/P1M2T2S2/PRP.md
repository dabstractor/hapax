---
name: "P1.M2.T2.S2 (plan 006) — Widget path: series-first zero-char offers + close-on-space typed arming"
---

## Goal

**Feature Goal**: Mirror spec §07 h2.53's series rules on the WIDGET path (the widget twin of P1.M2.T2.S1's fallback work): (1) the armed zero-char word-start offer composes **series successors first (count desc, `Successor.nextDisplay` run casing) then ordinary successors (count desc)** as ONE item set at the `succ.map(chainShim)` composition site (widget.ts :904-930); (2) typed-word arming at the widget's close-on-space site (:951-957, the `match === null → closeWith(now)` trailing-space branch): an uppercase-first-letter word closed by space, whose lowercase key has successors (direct `topSuccessors` consult — series entries included, so chain-only members arm), arms the chain; lowercase never arms. Typed-capital-first-letter preserved on insert; lowercase typing inserts verbatim; first-char anchor case-insensitive once typing.

**Deliverable**: Modified `src/pi/widget.ts` (chainShim series casing, series-first composition, typed-arming seam at close-on-space, Mode-A JSDoc citing 07 h2.53) + battery extensions in `test/widget.test.ts` / `test/widget-visibility.test.ts`.

**Success Definition**: `The ` typed on the widget → chain armed; next word-start tick offers successors with top = `Fed` (series-first, `Fed` run casing); typed-through disarm and re-arm work; lowercase `the ` never arms; exact-equal exclusion, suppression-lapse semantics, one-shot grant, never-zero-candidates invariant, and the Tab-deferral rule (`isShowingAutocomplete() === true` → forward verbatim) all unchanged; `npm run check` + `npm test` green. Unit tests are necessary, NOT sufficient — live TTY verification is BINDING and happens in P3.M1.T2.S3.

## Why

- Spec h2.53: chaining arms "by acceptance **or by typing** of a series member"; the offer lists "series successors first (count descending among them), then ordinary successors (count descending)". S1 lands these rules on the fallback provider; the widget path (:655-665 chainShim has the same `TODO(P1.M2.T2)` interim as provider.ts had) is the other half of "both display paths series-aware — R2 complete".
- The widget arms only at Tab-insert today (architecture/03 §R2); the typed-arming seam is absent — typing `The ` offers nothing at the next word start.

## What

All in `src/pi/widget.ts` (verify S1's landed provider.ts first; mirror its semantics exactly — keep the logic widget-local, no shared-module refactor):

1. **chainShim series casing** (:655-665): replace the interim `display: deps.store.get(s.next)?.capDisplay || s.next` with series-aware resolution: `s.series && s.nextDisplay ? s.nextDisplay : (resolver/capDisplay interim form)`. Series items display AND insert their run casing at zero typed chars. KEEP the shim's documented invariants verbatim: plain `key = s.next` (tab-insert re-arm reads `painted()`), **tier deliberately omitted** (`undefined` arms the `rec.tier !== 0` gate — never set `tier: 0`), `salience: -s.count` / `sessionCount: s.count`, no re-sort. Note `Candidate.display` is GONE (P1.M2.T1.S2) — never read `.display`; the capDisplay interim per S1's landed form is the fallback for ordinary items.
2. **Series-first zero-char composition** (:874-884 → :906): at the `(a) Zero-typed-char offer` push, partition `topSuccessors(armed.word)`: if the store API (P1.M1.T2.S2's series-first top-3 retention) already emits series-first, verify and cite it; otherwise partition here (`series = succ.filter(s => s.series)`, ordinary = rest, both already count-desc from topSuccessors, concat series→ordinary) BEFORE the `.slice(0, maxSuggestions)` — the cap applies to the combined list. One items set; the chain branch still either paints or falls through (no mixing with the normal query path — unchanged).
3. **Typed-fragment branch (:886-900 region)**: unchanged membership filter (exact-equal exclusion :894, `matchFragment` gate, threshold 0, word-start guard) — series/ordinary stay concatenated in the same count-desc-with-series-first order under filtering; casing rule: once typed, anchor is case-insensitive (matchFragment already), and Tab-insert of a highlighted item preserves a typed capital first letter / inserts verbatim — that is the span-replace/casing logic's job (S1's landed resolver semantics; do not fork them).
4. **Typed-word arming at close-on-space (:951-957)**: in the `match === null` branch, the close-on-space flavor is the trailing-space-with-no-`@`/`/` case (R3 taxonomy comment). BEFORE `closeWith(now)` in exactly that flavor: extract the just-ended word `before.match(/([A-Za-z][A-Za-z0-9_-]*)[ \t]$/)`; if the match exists AND first letter is uppercase AND `deps.store.topSuccessors(word.toLowerCase())` is non-empty AND `deps.chain` exists AND not already armed (check the widget's armed state seam) — arm it the same way the Tab-insert arm site does (`chain.arm(word.toLowerCase())` + grant reset, mirroring the existing arm site's calls; consult S1's landed provider seam for the exact grant interplay) — then STILL `closeWith(now)` (the space closes the line; the NEXT word-start tick produces the zero-char offer). Lowercase first letter → never arm. Uppercase with no successors → never arm.
5. **Fences (unchanged)**: Tab-insert arming, trigger-char arming, one-shot grant (grantSpent reset at :867-872), `before_agent_start` reset, exact-equal exclusion, suppression-lapse semantics, line-claim blank-row rendering, hesitation-gate intent bypass (`chainIntent = true`), never-zero-candidates, **Tab-deferral rule (h3.10, now-normative from P3.M1.T1.S1)**: Tab while `isShowingAutocomplete() === true` forwards verbatim — this task touches key-adjacent code and MUST NOT regress it. **Do NOT introduce or rely on Tab-accept suppression anywhere** (spec 07 h3.11, P4): Tab-accept no longer arms rest-of-word suppression; chain ARMING on Tab-insert is unchanged.
6. **JSDoc (Mode A)**: on the chainShim series branch and the typed-arming seam, citing 07 h2.53 (the idle transition: uppercase first letter + direct successor consult + lowercase-never-arms rationale) and 07 h3.10/h3.11 where adjacent.

### Success Criteria

- [ ] `The ` typed (widget, space closes) arms; next word-start offers top = `Fed` with run casing from `nextDisplay`
- [ ] Series-before-ordinary in the combined zero-char set (count desc within each group); cap applies to the combined list
- [ ] Lowercase `the ` never arms; uppercase-no-successors never arms; chain-only members arm via direct consult
- [ ] Typed-through disarm at next word boundary + acceptance re-arm (grant) intact; exact-equal exclusion intact
- [ ] Tab-deferral (`isShowingAutocomplete()`) regression pin still green; no Tab-accept suppression introduced
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer needs: the exact widget chain-block code (anchors quoted), S1's landed provider twin (the reference rule set), the Successor.series/nextDisplay contract, the widget test conventions, and the binding live-TTY caveat. All below.

### Documentation & References

```yaml
- file: src/pi/widget.ts
  why: THE file (1820 lines). Verified anchors: chainShim :655-665 (with the
        TODO(P1.M2.T2) interim + the tier-omission invariant comment);
        armGate :756-766; grantSpent reset :867-872; zero-char arm shape
        test `before === "" || /[ \t]$/.test(before)` :874-884; typed
        fragment + exact-equal exclusion :886-900 (exclusion at :894);
        COMPOSITION SITE `const items = succ.map(chainShim)` :906 +
        chainIntent/paint/parkSwap R6/R7 block :906-930; close-on-space
        closeWith(now) :951-957 (inside `match === null`, R3 taxonomy
        comment); zero-char Tab-accept span handling :1345+.
  pattern: state-machine evaluate() with R-numbered rule comments; paint()
           is the single publish seam; closeWith stamps closeAt.
  gotcha: distinguish the close-on-space flavor from the plain
          "nothing to offer" close inside the same match===null branch —
          arming belongs ONLY to the trailing-space flavor.

- file: plan/006_7bd0258da993/P1M2T2S1/PRP.md
  why: THE CONTRACT (in flight, fallback twin): the exact rule set to mirror
        — series-first partition semantics, nextDisplay casing,
        typed-arming regex + uppercase gate + direct topSuccessors consult,
        arm-and-still-return-null/close. Read its landed provider.ts diff
        before writing widget code.

- file: plan/006_7bd0258da993/architecture/03-pi-surfaces-r2-r3-r4.md
  section: "R2 surfaces" (:52-64) + widget chain surfaces (:655-965 map)
  why: The line anchors in the work item's research note; armGate seam
        (:668-673/:955-958) and the "arming comes only from Tab-insert"
        finding.

- file: plan/006_7bd0258da993/architecture/02-store-query-r1-r2.md
  why: Successor.series/nextDisplay contract + series-first top-3 retention
        in topSuccessors (P1.M1.T2.S2). READ FIRST — if topSuccessors
        already emits series-first, task item 2 collapses to verification.

- file: test/widget.test.ts + test/widget-visibility.test.ts
  why: THE suites to extend. Conventions: fake timers, simulated
        keystroke/evaluate ticks, state()/painted() assertions. Add the
        chain parity battery: 'The ' → 'Fed' arm+offer, typed-through
        disarm, re-arm, lowercase-never-arms, Tab-deferral pin untouched.

- file: src/pi/provider.ts (S1's landed version)
  why: The reference implementation of the same rules — mirror, don't fork.
  gotcha: the widget's publish seam is paint()/state(), not publishChain;
          the grant/chain APIs are shared (chain-grant.ts / chain state).
```

### Current Codebase tree (relevant)

```bash
src/pi/widget.ts                # MODIFY: chainShim series casing, composition, typed-arming seam, JSDoc
test/widget.test.ts             # EXTEND: chain parity battery
test/widget-visibility.test.ts  # EXTEND: arming/visibility interplay cases
```

### Known Gotchas of our Codebase & Library Quirks

```typescript
// TIER-OMISSION IS LOAD-BEARING: chainShim deliberately sets NO tier —
// the arming gate is `rec.tier !== 0`, and undefined arms. Your series/
// ordinary distinction must NOT accidentally set tier on the shim.

// ONE ITEMS SET, ONE PAINT: today successors and ordinary words never mix
// in one menu — keep it that way (chain branch paints or falls through).
// "Series-first" means series successors BEFORE ordinary successors within
// the chain offer, not a merge with the ambient query.

// CAP ORDER: slice AFTER the series→ordinary concat, so series items are
// never pushed out of the top-N by ordinary ones (and vice versa per count
// order within groups).

// ARM ON CLOSE, OFFER NEXT TICK: the typed-arming seam runs inside the
// close-on-space branch and still closes the line. The zero-char offer
// appears on the NEXT word-start evaluate tick via the (a) branch — never
// paint from the arming site itself.

// CLOSE FLAVOR MATTERS: match===null covers BOTH trailing-space and
// plain-no-fragment; arm only in the trailing-space-with-no-@// flavor
// (the R3 taxonomy comment marks it). Cursor-move/other closes never arm.

// NO TAB-ACCEPT SUPPRESSION: spec 07 h3.11 (P4) — Tab-accept exits the
// suppression seam. Do not add suppression anywhere on this path; chain
// ARMING on Tab-insert is untouched.

// TAB-DEFERRAL PIN: P3.M1.T1.S1's rule (isShowingAutocomplete() → forward
// verbatim) is now-normative (h3.10). Its regression test must stay green;
// if your diff touches the Tab branch's neighborhood, re-read that test.

// SUPPRESSION BYPASS: chain offers are intent — the existing
// chainIntent=true hesitation bypass and the explicit-dismissal-suppression
// bypass for chain paints stay exactly as-is (comment at :912-916 notes
// S1's suppression-release refinement lands on the fallback; mirror only
// what S1 actually landed for the widget).

// Candidate.display IS GONE (P1.M2.T1.S2): read capDisplay/resolver forms
// or Successor.nextDisplay only.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ S1's landed provider.ts + its PRP; confirm topSuccessors'
  series-first ordering (architecture/02) — decide partition vs verify.

Task 1: MODIFY src/pi/widget.ts — chainShim (:655-665)
  - series items: display/insert = s.nextDisplay (run casing); ordinary:
    the S1-landed interim/resolver form. Keep key/salience/sessionCount/
    no-tier invariants verbatim; resolve the TODO(P1.M2.T2) comment.

Task 2: MODIFY src/pi/widget.ts — zero-char composition (:874-884 → :906)
  - series→ordinary concat (or verified store ordering), THEN slice to
    maxSuggestions; single items set; paint/parkSwap block untouched.

Task 3: MODIFY src/pi/widget.ts — typed-arming at close-on-space (:951-957)
  - trailing-space flavor only: uppercase word regex + topSuccessors
    consult + chain.arm + grant reset (mirror S1's exact arm-site calls);
    still closeWith(now). JSDoc citing 07 h2.53 idle transition.

Task 4: EXTEND test/widget.test.ts (+ widget-visibility.test.ts)
  - 'The ' (space) arms → next word-start tick offers top 'Fed' (run
    casing, series-first); typed-through disarm at next boundary; accept
    re-arms; lowercase 'the ' never arms; uppercase-no-successor never
    arms; chain-only member arms via consult; exact-equal exclusion case;
    Tab-deferral regression pin untouched and green.

Task 5: VALIDATE
  - npm run check
  - npx vitest --run test/widget.test.ts test/widget-visibility.test.ts -v
  - npm test   # full suite — provider suites (S1) included
```

### Implementation pattern

```typescript
// Typed-arming seam (sketch — inside the close-on-space flavor)
const m = before.match(/([A-Za-z][A-Za-z0-9_-]*)[ \t]$/);
if (m && m[1][0] === m[1][0].toUpperCase() && m[1][0] !== m[1][0].toLowerCase()) {
  const key = m[1].toLowerCase();
  if (deps.chain && /* not already armed */ deps.store.topSuccessors(key).length > 0) {
    // 07 h2.53 idle transition: uppercase-first typed word + direct
    // successor consult (series included → chain-only members arm);
    // lowercase never arms or every prose "the " would offer its run
    // successor. Arm and STILL close — the offer comes at the next
    // word-start tick (branch (a)).
    deps.chain.arm(key); /* + grant reset, mirroring the Tab-insert arm site */
  }
}
closeWith(now);
```

### Integration Points

```yaml
NONE this task:
  - Widget-internal; store/provider/chain-grant APIs consumed, not changed.
  - Downstream (do NOT implement): P3.M1.T2.S3 live TTY verification
    (BINDING — unit tests necessary not sufficient); P3.M1.T2.S1 README
    sweep covers the series blurb; P1.M2.T3.S1 /acwords update separate.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/widget.test.ts test/widget-visibility.test.ts -v
npm test   # full suite green
```

### Level 3: Live TTY

BINDING but NOT this task — P3.M1.T2.S3 executes it (spec/09 technique). Record in the task report that unit coverage is provisional pending that pass.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors; `npm test` all green (incl. S1's provider suites and the Tab-deferral pin)

### Feature Validation

- [ ] Zero-char offer: series first (count desc, nextDisplay run casing), then ordinary (count desc); combined-list cap
- [ ] `The ` arms; lowercase/no-successor/already-armed never arms; chain-only members arm; close still closes
- [ ] Exact-equal exclusion, one-shot grant, typed-through disarm, before_agent_start reset unchanged
- [ ] No Tab-accept suppression introduced; Tab-deferral (h3.10) preserved
- [ ] chainShim invariants intact: plain key, no tier, -count salience

### Code Quality Validation

- [ ] JSDoc (Mode A) on chainShim series branch + arming seam citing 07 h2.53
- [ ] Mirrors S1's landed semantics; no forked casing/suppression rules

## Anti-Patterns to Avoid

- ❌ Don't set `tier` on chainShim (breaks re-arm) or re-sort topSuccessors output
- ❌ Don't merge chain items with the ambient query set — one chain set at the :906 site
- ❌ Don't paint from the arming site — arm-and-close; the next tick offers
- ❌ Don't arm on the plain no-fragment close or cursor-move — trailing-space flavor only
- ❌ Don't introduce Tab-accept suppression (h3.11 retired it) or regress Tab deferral (h3.10)
- ❌ Don't read `.display` off a store candidate — it's gone; capDisplay/nextDisplay only
- ❌ Don't treat unit tests as sufficient — live TTY is binding (P3.M1.T2.S3)
