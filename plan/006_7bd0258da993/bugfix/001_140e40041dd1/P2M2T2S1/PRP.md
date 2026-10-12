# PRP — P2.M2.T2.S1: README.md sync — series chaining, path completion, display-path claims

---

## Goal

**Feature Goal**: Bring `README.md` (721 lines) into factual agreement with the
behavior restored by the bugfix-001 changeset (BUG-001 series wiring, BUG-002
verbatim path edges, BUG-003 widget arming-tick paint, BUG-004 fallback
PIN/battery), and record the changeset with a dated post-delta note in the
established style. README is a summary — `spec/SPEC.md` stays the sole source
of truth and README never overrides it.

**Deliverable**: An edited `README.md` (markdown-only changes): (a) a dated
post-delta note appended to the Status paragraph's parenthetical chain
(:9–30 precedent); (b) the `/acwords` Debug successor-sample bullet updated to
match the actual dump output (run-casing display + ` (series)` markers); (c)
optionally one short clause on verbatim-edge path display in the tier-0
bullet; (d) every other series/path/widget-vs-fallback claim verified against
shipped behavior and corrected ONLY where factually wrong.

**Success Definition**: Every affected README section (chaining :177–204,
post-Tab :205–222, series :223–235, tier-0/path :47–72, widget-vs-fallback
:9–16 and :95–114, Debug :588–610) reads TRUE against the landed code; a
dated changeset note exists; `npm run check` unaffected; full `npx vitest run`
still green (no code touched — run it once as the changeset's standing gate).

## User Persona

**Target User**: the human/interactive session reviewing this changeset
(item contract OUTPUT), plus future readers of the README.

**Use Case**: README review to confirm shipped behavior after the bugfix
changeset; the post-delta note is the changeset's changelog entry.

**Pain Points Addressed**: README describing dead (pre-fix) behavior or
omitting new observable output shapes (`(series)` markers).

## Why

- Item contract: this IS the changeset-level docs task (Mode B — no further
  doc work follows; the spec-drift report is the sibling S2 item, not ours).
- The chaining/series claims were written for the intended design; the bug
  hunt found they were false in production (BUG-001); this changeset made
  them true — so most claims need verification, not rewriting.
- The Debug section predates the series markers in `src/pi/debug.ts` and is
  now factually incomplete (it omits run-casing rows and ` (series)`).

## What

Per the item contract's LOGIC:

1. **(a) Correct overstated wording** — walk each affected claim against the
   landed code (see anchors below). Expected outcome: after the changeset the
   claims are TRUE, so corrections should be rare; if one is still wrong
   against the code, fix the wording to describe shipped behavior and flag it
   in the final report (do NOT paper over a code/spec mismatch).
2. **(b) Post-delta note** — one dated sentence in the Status paragraph's
   parenthetical chain, modeled on the 2026-09-30 precedent at :22–30,
   recording: series enrichment now wired at the production seam (typed-word
   arming, series-first ordering, run-casing display), path completion
   displays/inserts verbatim edges on both display paths, the widget
   zero-char offer paints at the space (arming) tick, and the fallback-path
   PIN + post-accept battery landed.
3. **(c) Debug section check** — update the successor-index sample bullet so
   the documented row shape matches `src/pi/debug.ts` output.
4. Keep edits minimal and factual; markdown only; no spec edits, no code
   edits.

### Success Criteria

- [ ] Status paragraph carries a dated post-delta note in the established
      inline-parenthetical style covering all four fix areas.
- [ ] Debug section's successor-sample bullet matches src/pi/debug.ts
      (:106–135): series-first ordering, run-casing `nextDisplay` rows, the
      ` (series)` marker on series entries, ordinary pairs plain.
- [ ] Chained-completion (:177–204), post-Tab (:205–222), capitalized-series
      (:223–235) bullets verified against shipped behavior — each claim
      either confirmed or corrected; no speculative rewrites.
- [ ] Widget-vs-fallback claims (:9–16, :95–114) verified.
- [ ] Path-completion claims (:47–72 tier-0 bullet; :255 Usage) verified;
      verbatim-edge display stated where it belongs (one clause suffices).
- [ ] `git diff` touches ONLY README.md.

## All Needed Context

### Context Completeness Check

Passes "No Prior Knowledge": exact line anchors, the verified debug.ts output
shape, the note-style precedent, and the verification sources are all below.

### Documentation & References

```yaml
- file: README.md
  why: THE file. Verified anchors (current tree, 721 lines):
    - :9-30 Status paragraph — the post-delta note precedent lives here
      ("...and the 2026-09-30 widget-path bugfix post-delta note (four
      defects found and fixed: ...)"); append the new dated note into this
      same parenthetical chain.
    - :47-72 tier-0 fallback bullet — path examples `query` →
      `src/core/query.ts` at :52, :56, :62; after BUG-002, path candidates
      display AND insert with their original leading edges (`/`, `../`,
      `~`) — add/verify a factual clause here.
    - :93-114 Enter-submits / stock-contexts bullets — "both display
      paths" claims; verify only.
    - :126-136 proper-nouns bullet (series bigrams, chain-only top band).
    - :177-204 Chained Tab completion bullet — recordBigramRuns, BOTH
      display paths, zero-char offer, one-word-per-Tab re-arm: BUG-001
      restored exactly these; verify each clause.
    - :205-222 Post-Tab extension offer bullet (widget path).
    - :223-235 Capitalized-series bullet — "a space closing an
      UPPERCASE-initial typed word ... arms" is the BUG-003 timing fix's
      subject (offer paints AT the space tick on the widget path); verify.
    - :588-610 Debug section — successor-sample bullet ≈:603-606 says rows
      are `word → successor ×count` with no series wording. THIS IS THE ONE
      KNOWN-STALE CLAIM.
  pattern: dense factual bullets, spec cites inline ("spec 04", "spec 07"),
           dates in YYYY-MM-DD form, post-delta notes as inline
           parentheticals inside the Status paragraph.
  gotcha: README is editable by pipeline agents; spec/*.md is READ-ONLY for
          this task. Never restate behavior in a way that contradicts
          spec/SPEC.md — when in doubt, mirror spec wording.

- file: src/pi/debug.ts
  why: The actual /acwords successor-sample output (:106-135): rows
        `nextDisplay ×count (series)` for series entries (run casing),
        plain `next ×count` otherwise; series-first then count-desc,
        byte-lex ties, max 3 per word, SUCCESSOR_SAMPLE_N = 10 words
        sampled. The README bullet must match THIS shape.

- file: spec/SPEC.md + spec/04, 07 (read-only)
  why: Source of truth for the behavior claims being verified — cite, never
        override. Rule 4d (path runs keep edges) governs the BUG-002 clause.

- prd: bug-hunt PRD §h2.0 (Overview), §h2.2 h3.0/h3.1 (the two majors),
       §h3.2/h3.3 (the two minors) — the changeset being documented.

- plan: sibling PRPs (already landed): P1.M1.T1.S1 (index.ts runs
        pass-through), P1.M2.T1.S2 (pathDisplay resolver guard),
        P2.M1.T1.S1 (zeroCharOffer arming-site paint), P2.M2.T1.S1 (the
        provider.ts PIN) — the shipped fixes the note records. Do NOT
        restate their internals; one clause each.

- governance: repo-governance-and-conventions.md §3 (per item contract) —
        README editability and the spec-freeze rule.
```

### Current Codebase tree (relevant excerpt)

```bash
README.md            # THE deliverable (markdown-only edits)
src/pi/debug.ts      # verification source for the /acwords bullet
src/pi/provider.ts   # verification source for chaining/series claims
src/pi/widget.ts     # verification source for widget-path claims
src/pi/index.ts      # verification source for the production wiring claim
spec/                # READ-ONLY source of truth
```

### Desired Codebase tree with files to be added

```bash
README.md            # edited in place; no new files
```

### Known Gotchas of our codebase & Library Quirks

```markdown
# CRITICAL: spec/*.md is FROZEN for pipeline agents — only README.md is
# editable here. If a README fix would require a spec change, DON'T: record
# it for the P2.M2.T2.S2 drift report instead.

# GOTCHA: the post-delta note belongs INSIDE the Status paragraph's
# parenthetical chain (:22-30 style), not as a new top-level section.

# GOTCHA: keep line-length/wrap style of the file (~76-col hard wraps in
# prose bullets) — match surrounding wrapping.

# GOTCHA: "both display paths" claims must be checked on BOTH paths
# (widget + fallback) — the bug-hunt majors were precisely cross-path
# wiring gaps. The e2e tests from P1.M1.T2 / P1.M2.T2 are the fastest
# verification (test names cite the behaviors).

# GOTCHA: markdown only — `npm run check` does not typecheck README; still
# run it once plus the full vitest suite as the changeset's standing gate
# (nothing should change, which is itself the assertion).
```

## Implementation Blueprint

### Data models and structure

Not applicable — documentation-only item.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: VERIFY the series/path claims against landed behavior
  - READ src/pi/index.ts (enriched runs pass-through landed by P1.M1.T1.S1),
    src/pi/provider.ts (armed branch, series-first ordering, pathDisplay
    guard from P1.M2.T1.S2), src/pi/widget.ts (zeroCharOffer at the arming
    tick from P2.M1.T1.S1), src/pi/debug.ts (:106-135 series rows).
  - SKIM the e2e suites that pin them: test/index.test.ts (series arming,
    path edges), test/widget.test.ts (space-tick paint), the P2.M2.T1.S1
    PIN location in provider.ts applyCompletion.
  - CHECKLIST each README clause at :177-204, :205-222, :223-235, :47-72,
    :9-16, :95-114, :255: TRUE / needs-correction. Note any that are still
    false → fix wording to shipped behavior AND flag in the final report.

Task 2: EDIT README.md — Debug section successor-sample bullet
  - UPDATE the bullet at ≈:603-606 to the verified output shape: for the
    10 highest-salience words with successors, rows render series entries
    first in their run casing (`nextDisplay`) with a ` (series)` marker;
    ordinary pairs stay plain `word → successor ×count`; count-desc,
    byte-lex ties, max 3 per word.

Task 3: EDIT README.md — path-completion clause
  - In the tier-0 bullet (:47-72), state (one clause) that path candidates
    display and insert with their original leading edges (`/`, `../`, `~`)
    per spec 04 rule 4d. Only if an existing sentence already implies it,
    sharpen rather than duplicate.

Task 4: EDIT README.md — dated post-delta note
  - APPEND one dated sentence to the Status paragraph parenthetical chain
    (:22-30 precedent), e.g. structure (keep to the file's factual tone):
    "the 2026-10 bugfix-002 post-delta note (series enrichment wired at
    the production seam — typed-word chain arming, series-first ordering,
    run-casing display; path completions display and insert their
    verbatim leading edges on both paths; the widget zero-char offer
    paints at the arming space tick; the fallback-path no-re-request
    contract pinned with a post-accept battery)". Use the actual date and
    match the existing note's phrasing conventions.

Task 5: VALIDATE
  - git diff = README.md only.
  - npm run check (clean, unaffected).
  - npx vitest run (full suite green — 40 files baseline; nothing should
    change; this is the changeset's standing gate, not a README test).
  - Proofread the Status paragraph for grammar/flow after the insertion.
```

### Implementation Patterns & Key Details

```markdown
<!-- Note-style precedent (README :22-30, abridged) — mirror this shape:
"..., and the 2026-09-30 widget-path bugfix post-delta note (four defects
found and fixed: <list>);" -->
<!-- New note: same position in the chain, same "found and fixed" list
     style, four items (BUG-001..004 outcomes), dated, factual. -->
```

### Integration Points

```yaml
NO code/config/spec integration. Consumers:
  - The human review session for this changeset (item contract OUTPUT).
  - P2.M2.T2.S2 (spec-drift report) runs AFTER this item and consumes the
    README state; do not touch spec/*.md or report drift here.
```

## Validation Loop

### Level 1: Syntax & Style

```bash
git diff --stat          # README.md only
npm run check            # unaffected (markdown-only) — must stay clean
```

### Level 2: Unit Tests

```bash
npx vitest run           # full suite green — the changeset's standing gate
```

### Level 3: Integration

Not applicable (docs-only).

### Level 4: Domain-Specific Validation

```bash
grep -n "series" README.md | head    # Debug bullet + series bullets updated
grep -n "post-delta" README.md       # new dated note present
# Manual: read the four affected regions end-to-end for factual coherence.
```

## Final Validation Checklist

- [ ] git diff touches ONLY README.md
- [ ] Dated post-delta note in the Status paragraph, established style
- [ ] Debug successor-sample bullet matches src/pi/debug.ts output exactly
- [ ] All series/path/widget-vs-fallback claims verified; corrections
      factual and minimal; any residual code/spec mismatch flagged for
      P2.M2.T2.S2 (not silently worded around)
- [ ] npm run check clean; full vitest suite green
- [ ] Mode B honored: this is the final docs task; no spec edits made

## Anti-Patterns to Avoid

- ❌ Don't edit spec/*.md — read-only; drift goes to the S2 report
- ❌ Don't rewrite bullets wholesale — minimal, factual corrections only
- ❌ Don't document intended-but-unshipped behavior — verify against code/tests first
- ❌ Don't add a new README section for the note — it lives in the Status
      paragraph parenthetical chain
- ❌ Don't touch any code file "while you're in there" — README only
