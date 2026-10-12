---
name: "P1.M2.T1.S2 (bugfix 001_140e40041dd1) — resolveCompletionCasing pathDisplay-first guard + query-level regression battery"
---

## Goal

**Feature Goal**: Fix the query half of BUG-002 — `resolveCompletionCasing` returns the edge-trimmed key for path candidates, losing the leading `/`, `../`, `~` on display and Tab-insert. Add a **pathDisplay-first guard** as the function's first line (verbatim path display wins on EVERY branch, including a typed capital first letter — the documented, spec-consistent decision that supersedes the current battery's interim pin), widen the Pick with `'pathDisplay'`, and land a query-level regression battery proving rankMatches renders edge-preserving displays on all path classes while non-path candidates behave exactly as before.

**Deliverable**:
1. `src/core/query.ts`: guard + widened Pick + updated doc block (Mode A); construction sites (:616 anchored, :671 tier-0) UNCHANGED
2. `test/query.test.ts`: (a–f) regression battery — absolute/`../`/`~` paths keep edges; capital-fragment pin flipped; guard inertness for non-paths
3. Superseded battery comment/doc updated; spec/04 h2.32 verbatim-precedence clarification RECORDED as drift for P2.M2.T2.S2 (spec/*.md NOT edited)

**Success Definition**: `rankMatches(store-with-path-sighting, 'ho')[0].display === '/home/dustin/projects/hapax/src/core/query.ts'` while `.key` stays trimmed; `'Ho'` (rawFirst uppercase) returns the SAME verbatim pathDisplay; `'to'` → `'../tools/build.mjs'`; `'~'` variant pinned; every existing non-path casing case green UNCHANGED; `npm run check` + `npm test` green.

## Why

- BUG-002 (Major): spec 04 rule 4d + Case handling + integration item 7 all pin verbatim path insertion; the tally migration dropped it, and the old battery pinned the broken interim ("a typed capital capitalizes a path key"). P1.M2.T1.S1 restored the DATA (Candidate.pathDisplay via Sighting.path, sticky-first); this task makes the resolver consume it.
- The precedence decision is load-bearing and documented: spec/04 :713-714 "paths and technical literals always insert verbatim" outranks the Shift-preserve rule, which is about LETTERS — a leading `/`, `~`, `.` is not one. Recording the drift (not editing spec) routes the clarification to the interactive session.

## What

### 1. src/core/query.ts — the guard (resolver only; sites untouched)

```ts
export function resolveCompletionCasing(
  c: Pick<Candidate, "key" | "capCount" | "lowerCount" | "capDisplay" | "pathDisplay">,
  fragmentFirstLetter: string,
): string {
  // Paths and technical literals insert VERBATIM, on every branch —
  // including a typed CAPITAL first letter (spec 04 Case handling
  // "paths and technical literals always insert verbatim" outranks the
  // Shift-preserve rule, which governs letters; a leading '/', '~',
  // '.' is not one). pathDisplay is seeded sticky-first by the store
  // (rule 4d edge preservation). [BUG-002; supersedes the earlier pin
  // that capitalized path keys under uppercase fragments.]
  if (c.pathDisplay !== undefined) return c.pathDisplay;
  // ... existing uppercase + frequency branches, unchanged
```

- Update the doc block (≈:345–360): replace the "A typed CAPITAL first letter still capitalizes a path key" sentence with the verbatim-precedence rule above.
- Do NOT touch :616/:671 (`display: resolveCompletionCasing(c, rawFirst)`) — the guard handles it via the widened Pick; `rawFirst` threading already exists (:551).

### 2. test/query.test.ts — battery (TDD; extend the :161 casing describe)

```yaml
PATH REGRESSION (store fabricated via sighting({key, display, path:true}); put() at :92 works too):
  a. rankMatches(s, 'ho')[0] after sighting({key:'home/dustin/projects/hapax/src/core/query.ts',
     display:'/home/dustin/projects/hapax/src/core/query.ts', path:true}):
     .display === the verbatim path (leading '/' kept); .key stays TRIMMED
     ('home/dustin/...') — key≠display is the whole point (rule 4d)
  b. '../tools/build.mjs': sighting({key:'tools/build.mjs', display:'../tools/build.mjs', path:true})
     → rankMatches(s,'to')[0].display === '../tools/build.mjs'
  c. '~' variant: sighting({key:'dustin/hapax/x', display:'~/dustin/hapax/x', path:true})
     → display keeps '~' (probe fragment per first-char anchor, e.g. 'du')
  d. CAPITAL-FRAGMENT PIN (the flipped pin): rankMatches(s, 'Ho') — rawFirst uppercase —
     returns the SAME verbatim pathDisplay, NOT 'Home/...'. Comment: supersedes the
     interim pin (never-override governs letters only; spec 04 verbatim rule outranks)
  e. TIER-0 EXTENSION: extend the ≈:1576-1586 tier-0 battery with one edge-bearing case —
     e.g. rankMatches(s, 'que') with 'src/core/query.ts' path candidate → tier-0 anchorless
     display still verbatim (the :671 site passes rawFirst but the guard fires before it)
  f. GUARD INERTNESS: every pre-existing non-path casing case passes UNCHANGED
     (pathDisplay undefined → first line no-ops) — do not edit them; run them

DRIFT RECORD (comment in the battery + hand to P2.M2.T2.S2): spec/04 h2.32's
"paths ... insert verbatim" needs the explicit precedence over the Shift-preserve
rule; the old pin encoded the wrong reading. spec/*.md stays READ-ONLY.
```

### Success Criteria

- [ ] Guard is the resolver's FIRST line; Pick widened with 'pathDisplay'
- [ ] (a)–(e) all green; key stays trimmed while display is verbatim
- [ ] Capital-fragment pin flipped and the supersession documented in both doc and test comments
- [ ] Existing non-path casing battery passes with zero edits
- [ ] Drift note recorded for P2.M2.T2.S2; no spec edits
- [ ] `npm run check` + `npm test` green

## All Needed Context

### Context Completeness Check

An implementer needs: S1's pathDisplay contract, the resolver's exact current body, the flipped-pin history, the battery helper idioms, the site line numbers (unchanged), the downstream zero-change proof, and the drift routing. All below.

### Documentation & References

```yaml
- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P1M2T1S1/PRP.md
  why: THE upstream contract: Sighting.path, Candidate.pathDisplay
        (optional, absent ≡ not-a-path), sticky-first store seeding in
        EVERY casing branch (letter-initial paths classify mid-cap).
        Assume delivered exactly.

- file: src/core/query.ts
  why: resolver at :386-408 (full body quoted in bug002 doc §3); doc
        block ≈:345-360; rawFirst at :551; sites :616/:671 — READ, do
        not modify the sites.
  gotcha: only the resolver's signature Pick + first line + doc change.

- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/bug002-path-display.md
  section: §3 (resolver body + construction sites, line-verified),
        §4 (downstream: provider.ts:668-671 value/label = m.display,
        liveKeyByValue display-keyed with arming on the mapped store
        key — ZERO provider/widget changes; widget.ts:1390/1449 splice
        display), §6 (fix design)
  why: Proves this task is resolver-only and P1.M2.T2.S1 is the e2e layer.

- file: test/query.test.ts
  why: helpers put(:92)/sighting; casing describe :161; tier-0 battery
        ≈:1576-1586. Battery home; spec-cite describe style.

- docfile: plan/006_7bd0258da993/bugfix/001_140e40041dd1/prd_snapshot.md
  section: h2.2/h3.1 (BUG-002) + recommendations
  why: The defect + the recommended fix this implements (verbatim
        display form consumed on the lowercase branch — generalized to
        all branches by the documented decision).
```

### Current Codebase tree (relevant)

```bash
src/core/query.ts     # resolver guard + Pick + doc — MODIFY (sites untouched)
test/query.test.ts    # battery (a)–(f) + superseded-pin updates
```

### Desired Codebase tree

```bash
src/core/query.ts     # pathDisplay-first resolver (verbatim on every branch)
test/query.test.ts    # path regression battery + flipped capital pin
```

### Known Gotchas & Library Quirks

```typescript
// CRITICAL: the guard MUST be the first line — before the uppercase
// branch — or a typed capital still capitalizes the trimmed key.
// pathDisplay is optional: `c.pathDisplay !== undefined` (not truthiness —
// an empty string could never be seeded by S1, but undefined-check is exact).

// GOTCHA: the '~' and './' edge variants: '/'-initial paths classify
// 'lower', but LETTER-initial path variants can classify mid-cap — S1
// seeds pathDisplay on every casing branch for exactly that; the guard
// therefore fires for them too (outranks capDisplay, per S1's JSDoc).

// GOTCHA: probe fragments must respect the first-char anchor ('ho' for
// 'home/...', 'to' for 'tools/...', not mid-word probes); tier-0 case (e)
// intentionally uses an anchorless fragment ('que') to hit the :671 site.

// GOTCHA: the flipped pin (d) — check whether the OLD battery case
// ('S' + 'src/core/query.ts' → 'Src/core/query.ts') still exists in the
// describe; it must be updated to expect verbatim (with a path:true
// sighting so pathDisplay is set) or removed with the supersession note.

// GOTCHA: rankMatches returns key trimmed + display verbatim for the
// SAME match — assert BOTH fields in case (a); that pair is the
// acceptance-relevant fact (liveKeyByValue keys arming on display →
// store key).

// GOTCHA: don't touch provider.ts/widget.ts (zero changes per §4) and
// don't do the e2e index.test.ts insertion (P1.M2.T2.S1's scope).
```

## Implementation Blueprint

### Implementation Tasks (ordered — TDD)

```yaml
Task 1: WRITE the failing battery (test/query.test.ts)
  - Cases (a)–(e) in the :161 casing describe + tier-0 extension;
    update the superseded capital-pin case with its history note
  - RUN: npx vitest --run test/query.test.ts -v → path cases RED

Task 2: IMPLEMENT the guard (src/core/query.ts)
  - Widen the Pick with "pathDisplay"; add the first-line guard with
    the Mode-A doc comment (verbatim precedence, BUG-002, supersession)
  - Update the function doc block (replace the capital-capitalizes-path
    sentence)
  - RUN: npx vitest --run test/query.test.ts -v → all green (incl. (f)
    unedited non-path cases)

Task 3: DRIFT note + full validation
  - Add the battery-header drift note (spec/04 h2.32 precedence
    clarification → P2.M2.T2.S2); confirm zero spec edits
  - npm run check; npm test
  - grep -n "pathDisplay" src/ — resolver guard + store seeding + types only
```

### Implementation pattern

The guard in context:

```typescript
export function resolveCompletionCasing(
  c: Pick<Candidate, "key" | "capCount" | "lowerCount" | "capDisplay" | "pathDisplay">,
  fragmentFirstLetter: string,
): string {
  // [BUG-002] Paths/technical literals insert VERBATIM on every branch...
  if (c.pathDisplay !== undefined) return c.pathDisplay;
  const upper = fragmentFirstLetter >= "A" && fragmentFirstLetter <= "Z";
  // ... unchanged
```

### Integration Points

```yaml
DOWNSTREAM (not this task):
  - P1.M2.T2.S1: index.test.ts e2e — ingest a path mention → provider
    display + widget Tab insert keep the edges (consumes this guard)
  - P2.M2.T2.S2: spec-drift report — carry the h2.32 precedence note
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check
```

### Level 2: Unit Tests

```bash
npx vitest --run test/query.test.ts -v
npm test
```

### Level 3: Behavioral audit

- (a) asserts BOTH display verbatim AND key trimmed on the same match
- (d) 'Ho' returns the same display as 'ho' (guard precedes the uppercase branch)
- (f) non-path battery diff is empty (git diff shows no edits to pre-existing cases)

### Level 4: Residual grep

```bash
grep -n "pathDisplay" src/    # types.ts, store.ts seeding, query.ts guard — nothing else
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` + `npm test` green; pathDisplay appears at exactly three src sites

### Feature Validation

- [ ] '/', '../', '~' edges preserved on display; key trimmed; capital fragment verbatim too
- [ ] Tier-0 site also verbatim; non-path behavior bit-identical

### Code Quality Validation

- [ ] Mode-A doc (verbatim precedence + supersession); battery comments carry the drift note
- [ ] Sites :616/:671, provider, widget untouched; spec untouched

## Anti-Patterns to Avoid

- ❌ Don't put the guard after the uppercase branch — order is the fix
- ❌ Don't edit the pre-existing non-path cases to "make room" — guard inertness is the test
- ❌ Don't touch spec/*.md or provider/widget/e2e layers (other tasks own them)
- ❌ Don't use truthiness for the optional field — `!== undefined` is exact
- ❌ Don't re-litigate the precedence in code comments — cite the spec line and the supersession, done

**Confidence Score: 9/10** — the resolver body, sites, helpers, and downstream zero-change proof are line-verified; the one judgment call (verbatim-over-Shift) is explicitly decided in the item contract with its supersession target identified.
