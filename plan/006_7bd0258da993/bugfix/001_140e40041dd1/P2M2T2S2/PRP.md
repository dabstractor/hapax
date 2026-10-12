# PRP — P2.M2.T2.S2: Compile the spec-drift report for the reconciling interactive session

---

## Goal

**Feature Goal**: Compile the complete, actionable spec-drift reconciliation
worklist for the bugfix-001 changeset (`001_140e40041dd1`), as a single
markdown report at
`plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/spec-drift.md`.
The changeset's pipeline tasks were Mode A (spec/*.md READ-ONLY — drift
recorded, never applied); this report gathers every recorded drift item,
verifies each proposed edit against the CURRENT working-tree spec text, and
hands the interactive session a ready-to-apply edit list so it can discharge
the AGENTS.md obligation ("a change that ships code without the matching spec
edit is incomplete") in one sitting.

**Deliverable**: One new file — `architecture/spec-drift.md` (path relative to
`plan/006_7bd0258da993/bugfix/001_140e40041dd1/`). Markdown only. No code, no
spec edits, no other files. It is itself the changeset's doc deliverable
(Mode B per the item contract).

**Success Definition**: The report contains one section per spec file with
drift (spec/04, spec/06, spec/07 ×2), every drift item carrying all six
required fields (file, section title, current-text quote, proposed text, the
code that now depends on it, originating subtask ID); every current-text
quote byte-matches the working tree (grep-verified at write time); input (d)
(live-TTY divergences) is recorded as verified-empty; the no-delta
determinations (BUG-001, BUG-002-behavior, README) are ledgered;
`git status --porcelain -- spec/ src/ test/ README.md` is clean.

## User Persona

**Target User**: the interactive session (human + agent) that reconciles spec
and code after this changeset — the item contract's OUTPUT consumer.

**Use Case**: That session opens ONE file and applies every edit in order,
re-verifying nothing, deciding nothing that wasn't already decided — each item
is a drop-in diff with its governing rationale attached.

**User Journey**: open spec-drift.md → read the header (governance basis,
method, tree commit) → for each section: open the named spec file at the
named section title, compare the quoted current text (guard against further
tree drift — re-run the quote greps), apply the proposed text, tick the item →
run `npm run check` + `npm test` → close the changeset's docs obligation.

**Pain Points Addressed**: drift fragments currently live in four different
places (two research files, two PRPs, code comments); without compilation,
the reconciling session would have to re-derive each edit and could miss one,
leaving the changeset permanently in AGENTS.md-violating state.

## Why

- **Binding policy**: AGENTS.md — "interactive sessions MUST keep spec and
  code in agreement — a change that ships code without the matching spec edit
  (or vice versa) is incomplete; either order is fine so long as they land
  together. Pipeline/plan agents treat `spec/*.md` as read-only inputs and
  record drift in their reports." spec/SPEC.md "## Spec maintenance policy
  (binding)" (:14-27) says the same. This task is the "record drift in their
  reports" half; the interactive session performs the mandatory reconciliation.
- **What drifted**: BUG-001 and BUG-002's *behavior* restores already-pinned
  spec text (no behavior delta) — but BUG-002's implementation introduced new
  internal shapes the spec documents (Candidate record, resolver rules), and
  BUG-003/BUG-004 imply genuine spec additions. Those four deltas are the
  worklist.
- **Mode B**: per the item contract, this report closes the changeset's
  documentation obligations (the README half is sibling task P2.M2.T2.S1 —
  not ours; do not duplicate it).

## What

Write `architecture/spec-drift.md` with EXACTLY this structure:

1. **Header** — purpose, changeset ID, tree commit verified against,
   governance citations (AGENTS.md spec-maintenance policy; spec/SPEC.md
   :14-27 heading "Spec maintenance policy (binding)";
   architecture/system_context.md "## Binding governance (drives task
   design)" item 1; architecture/repo-governance-and-conventions.md §1), and
   the method note (quotes verified against working tree; cite by SECTION
   TITLE because commits 955de50/bb1e99b landed concurrent spec edits and
   line numbers shift).
2. **One section per spec file** (spec/04, spec/06, spec/07), each drift item
   a block with the six fields: file · section title · current text quote
   (verbatim, fenced) · proposed text (diff-style or fenced replacement,
   marked draft-vs-final) · code that now depends on it (file:symbol:line) ·
   originating subtask ID.
3. **Input (d) section** — live-TTY divergence sweep result: none (cite
   architecture/live-tty-bug003-run-notes.md §Divergence log).
4. **No-delta ledger** — BUG-001, BUG-002's behavior, README, and the
   bb1e99b-concurrent spec edits: why each is NOT a drift item.
5. **Reconciliation instructions** — apply in the interactive session
   (mandatory per AGENTS.md); re-verify each quote first; after applying,
   `npm run check` + `npm test`; keep the provider.ts PIN and the h3.15
   bullet in lockstep on any future pi-tui upgrade.

### Success Criteria

- [ ] Report exists at the exact path; markdown only; no other file touched.
- [ ] Sections for spec/04, spec/06, spec/07 present; spec/07 has BOTH items
      (visibility step-3 exception; re-verify fifth bullet).
- [ ] Every drift item has all six fields.
- [ ] Every current-text quote matches the working tree at write time
      (`rg -F` verification — see Level 2).
- [ ] h3.15 fifth-bullet text is byte-identical to the final draft in
      `P2M2T2S2/research/spec07-h315-reverify-drift.md`.
- [ ] Input (d) recorded as verified-empty with citation.
- [ ] No-delta ledger covers BUG-001, BUG-002 behavior, README (S1), and
      bb1e99b's already-reconciled spec/08/09/SPEC.md edits.
- [ ] `git status --porcelain -- spec/ src/ test/ README.md` → empty.

## All Needed Context

### Context Completeness Check

Passes "No Prior Knowledge": the four drift items' full content (current
quotes + proposed texts), their code anchors, the governance citations, and
the report skeleton are all below or in the two research files this PRP
names. The implementer adds no analysis — only verification and assembly.

### Documentation & References

```yaml
- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P2M2T2S2/research/drift-inputs-consolidated.md
  why: THE input — all four drift items, verified current quotes, code anchors,
        governance citations, method note. Written from this PRP's research
        session at HEAD c9097c6.
  pattern: one ### block per drift item; copy its quotes and anchors into the
           report, re-verifying quotes first.

- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P2M2T2S2/research/spec07-h315-reverify-drift.md
  why: FINAL (not draft) proposed text for the spec/07 re-verify-list item —
        intro "Four→Five" diff + the complete fifth bullet (three editor.js
        apply sites :545/:560/:1906, pi-tui 0.84.4, next-keystroke
        degradation) + application note. Copy verbatim; do not re-draft.

- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P1M2T1S1/research/spec06-drift.md
  why: Near-final wording for the spec/06 item (pathDisplay field semantics,
        sticky-first policy, the known bare-insert edge, Sighting.path note,
        why-a-record-field rationale). Base the spec/06 proposal on it.

- file: plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/live-tty-bug003-run-notes.md
  why: Input (d) — §Divergence log says "None … Nothing to route to
        P2.M2.T2.S2 from this item." Quote it; record the sweep happened.

- file: spec/SPEC.md, spec/04-tokenization-and-scoring.md, spec/06-candidate-store.md, spec/07-completion-ui.md
  why: READ-ONLY. Current-text sources for the quotes. Verified anchors at
        c9097c6 (re-verify at write time — tree keeps moving):
        - spec/SPEC.md "## Spec maintenance policy (binding)" :14-27
        - spec/04 "## Case handling" :701-716 (Shift-preserve :706-708;
          "paths and technical literals always insert verbatim" :713-714)
        - spec/06 "## M1: word candidates" :3-37 (Candidate interface :8-21,
          NO pathDisplay today); "## Upsert semantics" :53-66
        - spec/07 "### Widget visibility state machine (auto-open, re-based)"
          :323, step 3 :336-337; "### pi-tui contract dependencies (re-verify
          on upgrades)" :596-613 ("Four runtime contracts" :598); "## M2:
          chained completion" :690-757 (armed(W) "the successors of W
          immediately: series successors first" ≈:700-701)
  gotcha: NEVER edit these files in this task. If a quote no longer matches,
          the SPEC moved (not you) — update the quote + line refs in the
          report, and say so; the reconciling session still applies the item.

- file: src/pi/widget.ts, src/pi/provider.ts, src/core/query.ts, src/core/store.ts, src/core/types.ts
  why: READ-ONLY code anchors (the "code that now depends on it" field):
        widget.ts :787 zeroCharOffer def, :956-960 arming-site paint (comment
        records the step-3 tension); provider.ts ≈:745-760 the no-re-request
        PIN (:750, :755) in applyCompletion; query.ts :366/:392/:404
        resolveCompletionCasing pathDisplay-first guard; types.ts :43
        Candidate.pathDisplay, :99 Sighting.path; store.ts :407-409
        create-branch sticky-first seeding.

- plan: plan/006_7bd0258da993/bugfix/001_140e40041dd1/P2M2T2S1/PRP.md
  why: Sibling task CONTRACT (runs in parallel) — README sync. Explicitly
        out of scope here; reference it in the no-delta ledger only.

- governance: AGENTS.md (repo root) spec maintenance policy; system_context.md
        "## Binding governance"; repo-governance-and-conventions.md §1 — cite
        all three in the report header.
```

### Current Codebase tree (relevant slice)

```bash
plan/006_7bd0258da993/bugfix/001_140e40041dd1/
  architecture/
    system_context.md                      # governance (cite)
    repo-governance-and-conventions.md     # governance §1 (cite)
    live-tty-bug003-run-notes.md           # input (d): zero divergences
    spec-drift.md                          # ← THE DELIVERABLE (new file)
  P2M2T2S2/research/
    drift-inputs-consolidated.md           # primary input
    spec07-h315-reverify-drift.md          # final h3.15 wording
spec/{SPEC.md,04,06,07}*.md                # read-only quote sources
src/{pi/widget.ts,pi/provider.ts,core/query.ts,core/store.ts,core/types.ts}  # read-only anchors
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
architecture/spec-drift.md   # NEW — the reconciliation worklist: header +
                             # per-file sections (spec/04, spec/06, spec/07×2)
                             # + input-(d) result + no-delta ledger +
                             # reconciliation instructions. Closes the
                             # changeset's Mode-B doc obligation.
```

### Known Gotchas of our codebase & Library Quirks

```text
# CRITICAL: spec/*.md is READ-ONLY for this task (Mode A inheritance). The
# report PROPOSES edits; only the interactive session applies them.
# CRITICAL: quote by SECTION TITLE — commits 955de50/bb1e99b landed concurrent
# spec edits (bb1e99b touched spec/08, spec/09, SPEC.md); the item contract's
# old line refs (spec/07:336-337, :596-607) were re-measured at c9097c6 and
# hold, but P2.M2.T1.S2 (fallback battery) and P2.M2.T2.S1 (README) land
# AFTER this research — re-measure before quoting.
# CRITICAL: "Sighting" appears NOWHERE in spec/*.md (verified) — it is a
# code-level type (src/core/types.ts:99). Don't invent a spec section for it;
# record the placement decision as an open note in the spec/06 item.
# GOTCHA: two of the four proposals are DRAFTS (spec/04 precedence clause,
# spec/07 step-3 exception) — label them "draft for the reconciling session";
# the h3.15 bullet and the spec/06 wording are near-final from research files.
# GOTCHA: the item contract's "h2.32" label for spec/04 is a PRD-index
# ordinal — the actual section title is "## Case handling". Match on titles.
```

## Implementation Blueprint

### Data models and structure

Not applicable — markdown report. The "model" is the per-item block schema
(six mandatory fields):

```markdown
### D-N — <one-line title>  [DRAFT|FINAL]
- File: spec/NN-….md
- Section: "<exact ## / ### title>"  (current lines X–Y at commit <sha>)
- Current text: <verbatim fenced quote>
- Proposed text: <fenced diff or replacement>
- Code that depends on it: <file:symbol:lines — one clause on the behavior>
- Originating subtask: <ID> (evidence: <research file / PRP section>)
```

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: RE-VERIFY the tree state (before writing anything)
  - RUN: git log --oneline -8   # expect fixes through c9097c6 "docs: pin the
    no-re-request-after-apply contract"; NOTE anything newer, especially the
    P2.M2.T1.S2 battery commits (test/provider-live.test.ts,
    test/provider-display.test.ts) and P2.M2.T2.S1 README commit
  - RUN: rg -n "drift" plan/006_7bd0258da993/bugfix/001_140e40041dd1/*/research/
    and rg -n "P2.M2.T2.S2|drift" test/provider-live.test.ts
    test/provider-display.test.ts 2>/dev/null
    # sweep for drift items routed here AFTER this PRP's research; fold any
    # new ones in as additional items (same six-field schema)
  - RE-MEASURE the quote anchors (rg -n on the section titles listed in the
    YAML refs); update line refs in what you write

Task 1: CREATE architecture/spec-drift.md — header + method + governance
  - WRITE: purpose, changeset ID 001_140e40041dd1, verified-at commit,
    governance citations (AGENTS.md; spec/SPEC.md :14-27 "Spec maintenance
    policy (binding)"; system_context.md "Binding governance" item 1;
    repo-governance §1), and the quote-by-section-title method note
    (955de50/bb1e99b concurrency)

Task 2: ADD spec/04 section — "## Case handling" verbatim-path precedence [DRAFT]
  - ITEM D-1: current = the :713-714 "paths and technical literals always
    insert verbatim" sentence + the :706-708 Shift-preserve sentence;
    proposal = explicit precedence clause (draft below in Implementation
    Patterns); code = src/core/query.ts resolveCompletionCasing guard
    (:404 first line `if (c.pathDisplay !== undefined) return c.pathDisplay;`,
    widened Pick :392); subtask P1.M2.T1.S2; note it SUPERSEDES the old
    battery reading "a typed capital capitalizes a path key" (pin flipped in
    test/query.test.ts by the same subtask)

Task 3: ADD spec/06 section — Candidate.pathDisplay + upsert seeding [near-FINAL]
  - ITEM D-2: base wording on P1M2T1S1/research/spec06-drift.md: field block
    for the :8-21 interface (pathDisplay?: string, sticky-first semantics,
    absent-≡-never-path, wins-over-capDisplay); plus the "## Upsert
    semantics" create-branch sub-edit incl. the known edge (first-arrival-
    non-path never gains pathDisplay → inserts bare); plus the Sighting.path
    open note (spec-silent today — placement decision for the reconciling
    session); code = types.ts :43/:99, store.ts :407-409; subtask P1.M2.T1.S1

Task 4: ADD spec/07 section, item 1 — visibility step-3 armed exception [DRAFT]
  - ITEM D-3: current = step 3 text at :336-337 (quote verbatim); proposal =
    exception clause (draft below); governing requirement = M2 armed(W)
    :≈700-701 "the successors of W immediately … before the user types
    anything"; code = widget.ts :787 zeroCharOffer + :956-960 arming-site
    paint; subtask P2.M1.T1.S1; note the unit pins took the M2-intent
    reading (test/widget-visibility.test.ts) and the live-TTY run confirmed
    consistency

Task 5: ADD spec/07 section, item 2 — re-verify list fifth bullet [FINAL]
  - ITEM D-4: copy BYTE-IDENTICAL from
    P2M2T2S2/research/spec07-h315-reverify-drift.md: the "Four→Five" intro
    diff, the complete fifth bullet (three editor.js apply sites, pi-tui
    0.84.4, next-keystroke degradation), and the application note (PIN in
    provider.ts applyCompletion ≈:745-760 must move in lockstep; P2.M2.T1.S2's
    post-accept battery depends on it); subtask P2.M2.T1.S1

Task 6: ADD input-(d) section + no-delta ledger
  - INPUT (d): live-TTY divergence sweep = NONE — quote
    live-tty-bug003-run-notes.md §Divergence log ("**None.** … Nothing to
    route to P2.M2.T2.S2 from this item."); note the pre-existing step-3
    tension it references IS item D-3
  - LEDGER: BUG-001 (P1.M1.*) restores spec-pinned behavior — no delta;
    BUG-002 behavior already pinned (spec/04 rule 4d + integration item 7) —
    only internal shapes drifted (D-1, D-2); README = sibling P2.M2.T2.S1,
    not spec; spec/08/09/SPEC.md ranking wording reconciled by bb1e99b
    itself — not this changeset's drift

Task 7: ADD reconciliation instructions (the worklist's "how to apply")
  - Apply in the interactive session ONLY (mandatory per AGENTS.md); re-run
    the quote greps first (tree drifts); apply D-1…D-4 in any order;
    afterwards `npm run check` + `npm test`; on any future pi-tui upgrade
    update the provider.ts PIN and the h3.15 bullet together

Task 8: VALIDATE (all four levels below) — then STOP; spec/*.md untouched
```

### Implementation Patterns & Key Details

```markdown
<!-- DRAFT — D-1 spec/04 "## Case handling" (:706-714 region). Diff against
     current text; reconciling session may polish wording, not substance: -->
- verbatim in all caps; paths and technical literals always insert
- verbatim — and the verbatim-path rule outranks the Shift-preserve rule
- above: a candidate carrying a verbatim path display (04 rule 4d edges —
- leading `/`, `~`, `./`, `../`) inserts its edges unchanged even when the
- fragment begins with a capital; the Shift rule governs letters only, and
- a leading `/`, `~`, or `.` is not a letter. Menu labels use the same
- resolution against the live fragment's first letter.
<!-- Rationale: query.ts :404 guard is this rule's enforcement; the old "a
     typed capital capitalizes a path key" reading is superseded. -->

<!-- DRAFT — D-3 spec/07 step 3 (:336-337). Keep step numbering: -->
- 3. Trailing space with no `@`/`/` in text-before-cursor → hidden
-    (close-on-space carried over as the widget's own state) — except when
-    that space completes a typed word that arms a series chain (M2 armed(W)
-    below): the zero-char successor offer paints at the space tick itself,
-    before the user types anything (an intent-driven show in the spirit of
-    step 6; every subsequent edit returns to steps 1–5).
<!-- Rationale: M2 armed(W) ":≈700 the successors of W immediately" is the
     governing requirement; widget.ts zeroCharOffer (:787, call :956-960)
     implements it; live-TTY verified twice with zero divergence. -->
```

### Integration Points

```yaml
FILES:
  - create: "plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/spec-drift.md"
  - touch: NOTHING ELSE (spec/, src/, test/, README.md all untouched)
PIPELINE:
  - downstream: the reconciling interactive session consumes this report
    verbatim; tasks.json status for P2.M2.T2.S2 flips Complete via the
    orchestrator (never edit tasks.json yourself)
```

## Validation Loop

### Level 1: Structure (Immediate Feedback)

```bash
cd plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture
# Required sections exist
rg -c "spec/04|spec/06|spec/07" spec-drift.md        # all three files named
rg -n "Divergence" spec-drift.md                      # input-(d) section
rg -n "no-delta|No-delta|NOT a drift" -i spec-drift.md  # ledger present
# Six fields per item — expect 4 matches each
for f in "File:" "Section:" "Current text" "Proposed text" "Code that depends" "Originating subtask"; do
  echo "$f: $(rg -c "$f" spec-drift.md)"; done        # each prints 4
```

### Level 2: Quote Verification (the report's core guarantee)

```bash
cd /home/dustin/projects/hapax
# Every current-text quote must byte-match the working tree NOW. For each
# quote in the report, extract a distinctive ≥8-word substring and:
rg -F --quiet "paths and technical literals always insert" spec/04-tokenization-and-scoring.md && echo OK-04
rg -F --quiet "close-on-space carried over as the widget's own state" spec/07-completion-ui.md && echo OK-07s3
rg -F --quiet "Four runtime contracts are leaned on by the FALLBACK path" spec/07-completion-ui.md && echo OK-07h315
rg -F --quiet "user's Shift press is never" spec/04-tokenization-and-scoring.md && echo OK-04shift
rg -F --quiet "capDisplay: string" spec/06-candidate-store.md && echo OK-06record
# Expected: every check OK. A miss = the spec moved since research — re-quote
# from the current tree (the item still applies; fix the report, not the spec).
# h3.15 bullet byte-identity:
diff <(sed -n '/^```markdown$/,/^```$/p' ../plan/006_7bd0258da993/bugfix/001_140e40041dd1/P2M2T2S2/research/spec07-h315-reverify-drift.md | sed '1d;$d') \
     <(rg -A14 "no autocomplete re-request after applyCompletion" ../plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/spec-drift.md) && echo BULLET-IDENTICAL
```

### Level 3: Cleanliness (System Validation)

```bash
cd /home/dustin/projects/hapax
git status --porcelain -- spec/ src/ test/ README.md   # EXPECT: empty
git status --porcelain | rg "spec-drift"               # EXPECT: the new report (untracked)
# Standing no-touch gate (cheap, run once):
npm run check && npx vitest run 2>&1 | tail -3         # EXPECT: clean / all green
```

### Level 4: Cross-Artifact Sweep (Completeness)

```bash
# Input (d) cites the run notes; the report covers every drift-bearing source
rg -n "live-tty-bug003-run-notes" plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/spec-drift.md
# No drift record was missed — every *drift* artifact is referenced:
rg -ln "drift" plan/006_7bd0258da993/bugfix/001_140e40041dd1/*/research/ | while read f; do
  rg -q "$(basename $f .md)" plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/spec-drift.md \
    || echo "UNREFERENCED: $f"; done                    # EXPECT: no output
# All four subtask IDs present:
for id in P1.M2.T1.S1 P1.M2.T1.S2 P2.M1.T1.S1 P2.M2.T1.S1; do \
  rg -q "$id" plan/006_7bd0258da993/bugfix/001_140e40041dd1/architecture/spec-drift.md || echo "MISSING: $id"; done
# EXPECT: no output
```

## Final Validation Checklist

### Technical Validation

- [ ] All 4 validation levels completed successfully
- [ ] `npm run check` clean; `npx vitest run` green (no-touch confirmation)
- [ ] `git status --porcelain -- spec/ src/ test/ README.md` empty
- [ ] Only new file: `architecture/spec-drift.md`

### Feature Validation

- [ ] All Success Criteria under "What" met (sections, six fields ×4 items,
      byte-verified quotes, byte-identical h3.15 bullet, input (d), ledger)
- [ ] D-1…D-4 each name their governing spec requirement (M2 armed(W) for
      D-3; rule 4d for D-1/D-2; the degradation clause for D-4)
- [ ] DRAFT vs FINAL labels accurate (D-1, D-3 draft; D-2 near-final; D-4 final)
- [ ] Task 0 sweep ran; any post-research drift items folded in

### Code Quality Validation

- [ ] Report follows the six-field block schema exactly
- [ ] Quotes fenced verbatim; line refs carry the verified-at commit
- [ ] No speculative items — every item traces to a subtask + code anchor

### Documentation & Deployment

- [ ] Header cites all four governance sources
- [ ] Reconciliation instructions actionable standalone (open → apply → verify)
- [ ] Mode B noted: this report closes the changeset's doc obligations

## Anti-Patterns to Avoid

- ❌ Don't edit ANY spec/*.md file — this task proposes, the interactive
  session disposes (Mode A inheritance; the whole point of the report)
- ❌ Don't re-draft the h3.15 bullet or re-derive the spec/06 wording — copy
  from the research files (byte-identity is a validation gate)
- ❌ Don't quote by bare line number without the section title — the tree
  moved twice since the contract was written (955de50/bb1e99b) and keeps
  moving (T1.S2, T2.S1 land after this research)
- ❌ Don't fabricate a "Sighting" spec section — it doesn't exist in spec/;
  record the placement question instead
- ❌ Don't omit the no-delta ledger — "why BUG-001 needs no spec edit" is
  load-bearing information for the reconciling session
- ❌ Don't let the report drift from the research: if a quote no longer
  matches, the SPEC moved — update the report and say so; never "fix" it by
  editing spec/
- ❌ Don't touch tasks.json, PRD.md, or prd_snapshot.md (orchestrator-owned)

---

**Confidence Score: 9/10** — all four drift items have verified current-tree
quotes, near-final proposed text, and code anchors; the two research files
carry final wording for two of them; the only residual risk is post-research
tree movement, which Task 0's sweep and Level 2's quote greps absorb.
