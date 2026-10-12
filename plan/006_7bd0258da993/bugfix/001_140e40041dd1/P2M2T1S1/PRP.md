# PRP — P2.M2.T1.S1: provider.ts PIN comment for the no-re-request-after-apply contract

---

## Goal

**Feature Goal**: Add a PIN comment inside the `applyCompletion` override in
`src/pi/provider.ts` recording the verified pi-tui contract that **no
autocomplete re-request is issued after an apply** — so the fallback path's
post-Tab extension offer (spec/07 "Post-Tab extension offer" §) and the
zero-char chain offer surface only on the NEXT keystroke's request, the
degradation spec 07 explicitly accepts. Comment-only; no behavior change.

**Deliverable**:
1. A PIN comment block inside `applyCompletion(lines, cursorLine, cursorCol,
   item, prefix)` in src/pi/provider.ts, placed before the final
   `return current.applyCompletion(...)` delegation, following the existing
   PIN style (the force-read PIN at provider.ts ≈305–331): cite the verified
   apply call sites in the installed pi-tui dist with line refs + package
   version + "re-verify on upgrade".
2. A drafted fifth bullet for spec/07 h3.15's re-verify list (plus the
   "Four"→"Five" intro wording change) delivered as **drift content** into
   `plan/006_7bd0258da993/bugfix/001_140e40041dd1/P2M2T2S2/research/`
   (a small markdown file, NOT an edit to spec/*.md — pipeline agents must
   not edit spec; the reconciling interactive session applies it in
   P2.M2.T2.S2).
3. After (1), `grep -nE 're-request|re-offer|post-applyCompletion' src/pi/provider.ts`
   matches the new PIN.

**Success Definition**: The PIN exists at the consumption site with accurate
citations to the INSTALLED pi-tui version's dist lines; grep matches; `npm
test` (or `npx vitest run`) fully green with zero test changes; zero changes
to any other source file; the drift file exists in P2M2T2S2/research/.

## User Persona

Not applicable — internal documentation artifact (contract: "The PIN comment
IS the doc"). Indirect beneficiary: future maintainers/agents re-verifying
contracts after a pi-tui upgrade (spec/07 h3.15 is the intended home).

## Why

- BUG-004 (bug-hunt Minor Issue 2, PRD §h3.3): spec/07 h3.11's fallback
  paragraph required "verify at implementation and PIN at the consumption
  site" for the no-re-request contract; P4.M1.T2.S1 shipped without it.
  Today `grep 're-request|re-offer|post-applyCompletion' src/pi/provider.ts`
  finds nothing.
- Risk being closed: a pi-tui upgrade that ADDS a post-apply re-request
  would silently change fallback-path behavior (extension offer / chain offer
  timing) with no pinned contract to re-verify.
- Sibling item P2.M2.T1.S2 builds the fallback-path post-accept battery that
  pins this behavior in tests; this PRP supplies the comment contract it
  references.

## What

- **Comment-only change** to `src/pi/provider.ts`, inside the existing
  `applyCompletion` override (~lines 679–735; see blueprint for exact anchor).
- **No spec edits** (Mode A): the spec/07 h3.15 mirror is recorded as drift
  content for P2.M2.T2.S2 (the spec-drift report compiler), because pipeline
  agents must not edit spec/*.md.
- TDD not applicable to a comment; the battery in S2 pins the behavior.

### Success Criteria

- [ ] PIN present inside applyCompletion before the delegated return; cites
      ALL verified apply call sites with dist line numbers and the installed
      pi-tui version.
- [ ] PIN states the consequence: post-Tab extension offer and zero-char
      chain offer appear only on the next keystroke's request — the
      degradation spec 07 accepts.
- [ ] PIN includes "re-verify on upgrade" instruction naming the sites.
- [ ] `grep -nE 're-request|re-offer|post-applyCompletion' src/pi/provider.ts`
      now matches.
- [ ] Drift file `plan/.../P2M2T2S2/research/spec07-h315-reverify-drift.md`
      exists with the drafted fifth bullet and the Four→Five wording fix.
- [ ] Full test suite green; `git diff` shows ONLY provider.ts comment lines
      plus the new research file.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase would they have everything?" —
Yes. The verified evidence (dist lines, version), the exact insertion anchor,
the existing PIN style to mirror, and the drift-file target are all embedded.

### Documentation & References

```yaml
- file: node_modules/@earendil-works/pi-tui/package.json
  why: Confirms the installed version the PIN must cite.
  critical: "\"version\": \"0.84.4\" (verified during this research). The PIN
             must say e.g. 'verified against @earendil-works/pi-tui 0.84.4'."

- file: node_modules/@earendil-works/pi-tui/dist/components/editor.js
  why: The verified applyCompletion call sites. THE IMPLEMENTER MUST RE-READ
        THESE before writing, in case the tree moved (lines verified in this
        research: :545, :560, :1906). Facts verified against 0.84.4:
    1. :545 (menu-accept Tab, inside `kb.matches(data, "tui.input.tab")`):
       applyCompletion → set lines/cursor → `this.cancelAutocomplete()` →
       `if (this.onChange) this.onChange(...)` → `return;` — NO
       requestAutocomplete.
    2. :560 (select.confirm / Enter-accept path): applyCompletion → cursor
       set → prefix.startsWith("/") ? `cancelAutocomplete()` then FALL
       THROUGH TO SUBMIT : else `cancelAutocomplete()` + onChange +
       `return;` — NO requestAutocomplete on either arm.
    3. :1906 (forced single-item fast path, `options.force &&
       options.explicitTab && suggestions.items.length === 1`): applyCompletion
       → cursor set → onChange → `this.tui.requestRender()` → return — NO
       cancelAutocomplete AND NO requestAutocomplete.
  gotcha: "The task contract's 'BOTH call sites' (≈538-552 and ≈1895-1906)
           missed the :560 confirm site — cite all THREE for accuracy. Also
           the contract notes the PRD's claim that 'both call
           cancelAutocomplete' is imprecise (the 1906 fast path does NOT
           cancel); the load-bearing shared fact is: NONE of the three
           re-requests. Phrase the PIN accordingly."

- file: src/pi/provider.ts
  why: PIN style template at ≈305–331 (the force-read PIN: cites
        'components/editor.js ~1903, verified against
        @earendil-works/pi-tui ~0.84.4' + explicit revisit instruction).
        Insertion anchor: the applyCompletion override — the block starting
        `applyCompletion(lines, cursorLine, cursorCol, item, prefix) {`
        (~line 679) whose final statement is
        `return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);`
        (~line 735). Place the PIN immediately before that return, AFTER the
        enableChaining arming block, as a sibling comment block.
  pattern: "existing comments are dense JSDoc-style // blocks documenting
           contracts, cite spec sections as 'spec/07:NNN' or 'PRD §07 h3.x',
           and name the re-verify trigger."

- file: spec/07-completion-ui.md
  why: (a) 'Post-Tab extension offer' section (~line 261) — the fallback
        behavior that degrades; (b) 'pi-tui contract dependencies
        (re-verify on upgrades)' (~line 596) — the 'Four runtime contracts'
        list the drafted fifth bullet extends.
  gotcha: "READ-ONLY for the implementer. The spec mirror goes to the
           P2M2T2S2 research drift file, never into spec/."

- file: architecture/bug003-004-widget-provider.md
  why: The bug-hunt §2 evidence file the task contract cites (already
        reflected in the verified facts above).
```

### Current Codebase tree (relevant excerpt)

```bash
src/pi/provider.ts          # applyCompletion override ~679–735 ← PIN here
node_modules/@earendil-works/pi-tui/dist/components/editor.js   # evidence :545/:560/:1906
spec/07-completion-ui.md    # READ-ONLY; h3.15 re-verify list ~596–607
plan/006_.../P2M2T2S2/research/spec07-h315-reverify-drift.md    # NEW (drift deliverable)
```

### Known Gotchas of our codebase & Library Quirks

```ts
// CRITICAL: Do NOT touch any executable line. The whole diff in provider.ts
// must be comment lines only — behavior-neutral by construction.

// GOTCHA: cite the version WITHOUT '~' ambiguity is fine either way — the
// existing force-read PIN uses '~0.84.4'; matching that style is safest.

// GOTCHA: pi-tui dist is minified-ish but stable; if the implementer's
// re-read shows shifted line numbers, cite what THEY see (re-verify step is
// part of the task) — never copy this PRP's line numbers blindly if the
// tree moved.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: RE-VERIFY the evidence (5 min, mandatory)
  - READ node_modules/@earendil-works/pi-tui/package.json (version field).
  - READ editor.js around the applyCompletion call sites (grep -n
    "applyCompletion" — expect three: menu-Tab ~545, confirm ~560,
    forced fast path ~1906). Confirm NONE is followed (on any branch) by
    requestAutocomplete before the surrounding handler returns.
  - If evidence differs (e.g. an upgrade landed), PIN what is actually true;
    if a site DOES re-request, STOP and route to P2M2.T2.S2 as drift (the
    contract change would also affect S2's battery).

Task 2: MODIFY src/pi/provider.ts — add the PIN
  - PLACE: inside applyCompletion override, immediately before the final
    `return current.applyCompletion(...)` line (~735).
  - CONTENT (adapt wording; keep the established density):
    // NO RE-REQUEST AFTER APPLY (BUG-004 PIN, spec/07 h3.11 fallback
    // paragraph + h3.15 re-verify list): pi-tui issues NO autocomplete
    // request after applying a completion — all three apply sites in
    // components/editor.js (verified against @earendil-works/pi-tui 0.84.4)
    // apply, cancel (menu Tab :545, confirm :560) or requestRender (forced
    // single-item fast path :1906), and return:
    //   :545  tui.input.tab menu-accept   → apply → cancelAutocomplete → return
    //   :560  tui.select.confirm          → apply → cancelAutocomplete → return/submit
    //   :1906 force && explicitTab && items.length===1 → apply → requestRender → return
    // (the :1906 path does NOT cancelAutocomplete — the load-bearing shared
    // fact is that none re-requests). CONSEQUENCE, accepted by spec/07:
    // the fallback path's post-Tab extension offer and the zero-char chain
    // offer surface only on the NEXT keystroke's request — pi-tui only
    // requests on keystrokes. RE-VERIFY all three call sites on any pi-tui
    // upgrade; if an upgrade adds a post-apply re-request, the fallback
    // offer timing (and S2's post-accept battery) changes.
  - KEEP: surrounding comments untouched.

Task 3: CREATE the drift deliverable
  - PATH: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P2M2T2S2/research/
          spec07-h315-reverify-drift.md
  - CONTENT: drafted replacement text for spec/07 h3.15 —
    (a) intro wording change: "Four runtime contracts" →
        "Five runtime contracts";
    (b) new fifth bullet, e.g.:
        "- no autocomplete re-request after applyCompletion (all three
           apply sites in editor.js — menu-Tab accept, select.confirm, and
           the forced single-item fast path — apply then cancel/render and
           return; the fallback path's post-Tab extension offer and the
           zero-char chain offer therefore ride the next keystroke's
           request, the degradation spec 07 accepts — PIN in
           src/pi/provider.ts applyCompletion);"
    (c) note that P2.M2.T2.S2 (reconciling session) applies it to
        spec/07-completion-ui.md.

Task 4: VALIDATE
  - grep -nE 're-request|re-offer|post-applyCompletion' src/pi/provider.ts → matches.
  - npx tsc --noEmit (or repo's check script) clean.
  - npx vitest run → all green, unchanged counts.
  - git diff --stat: only src/pi/provider.ts + the new research file.
```

### Integration Points

```yaml
NO code integration. Consumers:
  - P2.M2.T1.S2 (fallback post-accept battery) references this PIN as the
    contract its tests pin.
  - P2.M2.T2.S2 (spec-drift compiler) consumes the research drift file.
```

## Validation Loop

### Level 1: Syntax

```bash
npx tsc --noEmit          # comment-only diff must stay clean
git diff src/pi/provider.ts   # visually confirm comment-only
```

### Level 2: Tests

```bash
npx vitest run            # zero new/changed tests expected; all green
```

### Level 3–4: Not applicable (comment-only; behavior pinned by S2's battery
and by the widget-path h3.11 battery already in test/widget.test.ts).

## Final Validation Checklist

- [ ] PIN inside applyCompletion before the delegated return, citing all
      three apply sites + installed version + re-verify instruction
- [ ] grep 're-request|re-offer|post-applyCompletion' matches in provider.ts
- [ ] Drift file written to P2M2T2S2/research/ with bullet + Four→Five fix
- [ ] No spec/*.md, test/, or other source file modified
- [ ] tsc clean; vitest full suite green, counts unchanged

## Anti-Patterns to Avoid

- ❌ Don't edit spec/07 directly (pipeline agents never touch spec/*.md)
- ❌ Don't cite only the two sites from the task contract — there are three
- ❌ Don't add any executable code, test, or log line
- ❌ Don't cite line numbers without re-reading the installed dist first
