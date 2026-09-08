# PRP — P1.M4.T2.S1: README.md sweep — features, known limitations, reference (bugfix-001 Mode B docs)

## Goal

**Feature Goal**: Sweep `README.md` so every section reflects the shipped
bugfix-001 delta (BUG-001..BUG-006 fixes, all Complete) and contains zero
statements describing pre-fix behavior. Five specific content updates +
a retirement sweep, verified against shipped code and the fresh acceptance
evidence produced by P1.M4.T1.S1.

**Deliverable**: Updated `README.md` — the ONLY file modified. No code
changes, no spec/*.md edits (READ-ONLY product spec), no .gitignore changes.

**Success Definition**:
1. Features/Usage document stock-context delegation (slash/@/quoted-path
   contexts identical to stock pi).
2. Admission description includes the proper-noun relief band (capitalized
   mid-frequency words admit; lowercase common words still reject; NREL
   chain reachable).
3. Secrets feature bullet covers the 32-char mask floor, parent-secret
   propagation to sub-words, and the synthetic-token paste battery.
4. Segmentation/known-limitations text states code-point-correct Unicode
   boundaries (no astral trade-off wording anywhere).
5. Bigram cap wording states the same-call guarantee (drained to ≤ 10,000
   within the same `recordBigramRuns` call).
6. Retirement grep gates pass (below); claims match shipped behavior;
   `npm run check` + `npm test` still green.

## User Persona

**Target User**: pi user / prospective contributor reading README as the
canonical description of what hapax does after the six fixes.
**Use Case**: learn that typing `/re` or `@frag` or inside quoted paths
behaves exactly like stock pi; that `National`-class proper nouns chain;
that pasted-secret fragments never appear.
**User Journey**: Features → Usage → invariants; every statement traceable
to a shipped test named in the README or in the code's JSDoc.
**Pain Points Addressed**: README (last swept at D2) predates the six
end-to-end fixes; any leftover "accepted trade-off / non-goal" wording now
describes fixed defects.

## Why

- bugfix-001 landed six fixes (all subtasks Complete): stock-context
  delegation + Tab-never-opens (P1.M1.T1), armed-chain trigger reset
  (P1.M1.T2), proper-noun relief band ceiling 95 (P1.M2.T1), 32-char mask
  floor + sub-word secret poisoning + paste battery (P1.M2.T2), astral
  boundary guard (P1.M3.T1), same-call bigram cap drain (P1.M3.T2). Each
  landed per-file JSDoc (Mode A); the README is the changeset-level record.
- P1.M4.T1.S1 (PARALLEL) re-runs the full gauntlet and re-measures §09
  items 5/6/7 into `docs/M1-DoD.md` — its evidence is this task's INPUT.
- This is the Mode B documentation task for README.md; the only other docs
  task (P1.M4.T2.S2) touches `docs/M1-DoD.md`, not README.

## What — itemized edits

1. **Features — add/extend a stock-context delegation bullet**: hapax
   never preempts stock completion — slash-command lines (`/re`), `@`
   mentions, and fragments inside quoted paths delegate verbatim to pi's
   own provider (`classifyStockContext` + delegation in
   `src/pi/provider.ts`, P1.M1.T1); Tab in those contexts behaves exactly
   as stock pi (it never opens the hapax menu). Fold into the existing
   never-hijack/usage prose if a separate bullet reads better there.
2. **Admission description (Features/Architecture/Reference as
   applicable)**: state the proper-noun relief band — a *capitalized*
   word in the mid-frequency band (dictionary quantized rank below the
   relief ceiling, shipped value 95 in `src/core/score.ts`) admits as a
   proper-noun candidate; lowercase common words still reject (calibrated
   bands, prose-no-menu unchanged). Cite the NREL chain acceptance pin
   (integration item 7 test) as the visible consequence.
3. **Secrets bullet**: extend the two-layer description — Layer 1's
   raw-text bare-run mask now fires from **32 chars** (not 40; catches
   38-char AWS-style secrets whole), and whole-token secret rejection
   **propagates to camelCase/snake_case sub-word fragments** of the same
   token (ingest memo poisoning) — `CYEXAMPLEKEY`-style fragments never
   store. Reference the synthetic-token paste battery
   (`test/adversarial-ingest.test.ts`, npm/glpat/sk_live/Bearer shapes).
   DELETE any "secret fragments are an accepted non-goal" wording — it
   describes the fixed BUG-003.
4. **Unicode/segmentation wording**: state that word-boundary guards step
   by full code points — a non-ASCII (including astral-plane) letter
   adjacent to an ASCII run disqualifies the run (§04 rule 3, now
   enforced both sides). DELETE any "astral trade-off / accepted v1
   limitation" wording (fixed BUG-004). If the README says nothing about
   it today, add one sentence under Architecture's `segment` line.
5. **Bigram cap wording**: wherever the successor index / bigram store is
   described (Features chaining bullet, Architecture store line, /acwords
   debug prose), the 10,000-key cap must be stated WITH the same-call
   guarantee: eviction drains to ≤ cap within the same
   `recordBigramRuns` call (looped 256-batch) — no transient overshoot
   survives a message (fixed BUG-006).
6. **Chaining bullet**: confirm it reflects the armed-chain trigger-char
   reset (typing the trigger char mid-chain resets to idle and honors
   trigger mode with the `#frag` prefix, P1.M1.T2) — add a clause if
   absent. Also update the NREL-class example reachability if the
   current example (`Acme → Zephyr → …`) is fine to keep — no change
   needed unless prose implies only rare/rare chains work.
7. **Retirement sweep (grep gates)**: no text implying (a) an accepted
   astral/surrogate trade-off, (b) accepted secret-fragment leakage,
   (c) hapax completing inside slash/@/quoted-path contexts, (d) band
   descriptions lacking the relief band where admission is described,
   (e) a bigram cap that can be exceeded until later messages.
8. **Evidence consumption**: read the P1.M4.T1.S1 re-verification record
   in `docs/M1-DoD.md` (§09 items 5/6/7) and, where the README states
   measurable behavior (prose-no-menu, NREL chain, secret battery), make
   sure the README's claims are consistent with those measured results
   (cite the test names, not the numbers).

### Success Criteria

- [ ] All 7 itemized edits applied (or verified already-present verbatim)
- [ ] Retirement greps pass (see Level 1)
- [ ] README is the only changed file; check + test green
- [ ] Every new claim cites a shipped source file or test that exists

## All Needed Context

### Context Completeness Check

An implementer needs: the six fixed behaviors with their shipped locations,
the current README structure, the parallel S1 evidence record, and the PRD
defect text explaining what each fix means. All below.

### Documentation & References

```yaml
- file: README.md
  why: edit target. Structure: Features / Quick start / Usage /
        Architecture / Design invariants / Known limitations / Non-goals /
        Reference (Dictionary build, Configuration, Debug) / Development.
        The Secrets bullet is at Features (~lines 37-46); store line at
        Architecture (~118-121); Known limitations at ~197.
  gotcha: PRESERVE the correct, current content (M2 successor-chaining
    docs landed in the D2 sweep are accurate; NREL/Acme chain examples,
    enableChaining config row, successor-index /acwords sample all stay).
    This sweep is additive/corrective, not a rewrite.

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/spec-acceptance-map.md
  why: README heading inventory + explicit instruction that astral
        trade-off / secret-fragment non-goal statements "must be revised
        by the final docs task" (this one).

- file: plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/prd_snapshot.md
  why: BUG-001..006 descriptions + Recommendations — the authoritative
        statement of what changed (quoted in this work item's selected
        PRD content).

- file: src/pi/provider.ts
  why: classifyStockContext + delegation wiring (P1.M1.T1.S1) and the
        armed-branch trigger reset (P1.M1.T2.S1) — verify delegation and
        reset semantics before writing them.

- file: src/core/score.ts
  why: proper-noun relief band implementation (P1.M2.T1.S1; relief
        ceiling 95 per the S1 PRP) — README admission wording must match
        the shipped constants/conditions.

- file: src/core/shapeGate.ts + src/core/segment.ts + src/pi/ingest.ts
  why: mask floor 32 (SECRET window), parent-token secret rejection
        propagating to sub-word drafts in the ingest memo
        (P1.M2.T2.S1/S2), code-point boundary guard (P1.M3.T1.S1).

- file: src/core/store.ts
  why: #evictBigramsIfOverCap now LOOPS the 256-batch until within
        BIGRAM_CAP in the same recordBigramRuns call (P1.M3.T2.S1) — the
        same-call guarantee wording.

- file: docs/M1-DoD.md
  why: P1.M4.T1.S1 (PARALLEL) refreshes §09 integration items 5/6/7 with
        re-runnable commands + fresh results — consume as evidence; do
        NOT edit this file (P1.M4.T2.S2 owns it).
  gotcha: if the refreshed section is not yet present, verify claims
        directly against the cited tests instead of waiting.

- file: test/adversarial-ingest.test.ts + test/adversarial-typing.test.ts
        + test/calibration.test.ts + test/shipped-dict.test.ts
  why: the pinned behaviors to cite: secret paste battery, chain
        post-restore, prose-no-menu/calibration. Cite by file name in
        README prose (house style).
```

### Current Codebase tree (relevant)

```bash
README.md
src/pi/provider.ts src/pi/ingest.ts
src/core/{score,shapeGate,segment,store}.ts
test/{adversarial-ingest,adversarial-typing,calibration,shipped-dict,mask-secrets}.test.ts
docs/M1-DoD.md            # owned by parallel P1.M4.T2.S2 — read-only here
plan/002_3e8a42cadf2c/bugfix/001_0f4b641cf9ce/architecture/spec-acceptance-map.md
```

### Desired Codebase tree

```bash
README.md   # swept — the ONLY file this task modifies
```

### Known Gotchas

```text
# DOCS-ONLY: README.md and nothing else. spec/*.md is READ-ONLY.
# docs/M1-DoD.md belongs to parallel P1.M4.T2.S2 — never edit it here.
# Relief ceiling 95 and mask floor 32 are SHIPPED CONSTANTS (verify in
#   score.ts / shapeGate.ts at implementation time; cite behavior, and
#   only name the number if the source confirms it).
# House style: cite test files by path; date verification lines
#   ("Verified YYYY-MM-DD (...)"); keep the precise, table-heavy voice.
# Do not weaken or paraphrase the design invariants — they are PRD text.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: VERIFY shipped behavior
  - READ src/pi/provider.ts (classifyStockContext, delegation, armed
    reset), src/core/score.ts (relief band), src/core/shapeGate.ts +
    src/pi/ingest.ts (mask floor, sub-word poisoning),
    src/core/segment.ts (code-point guard), src/core/store.ts (drain loop)
  - RUN npx vitest --run test/adversarial-ingest.test.ts
    test/adversarial-typing.test.ts test/calibration.test.ts
    test/shipped-dict.test.ts — confirm every claim to be written
  - READ docs/M1-DoD.md items 5/6/7 (if the S1 refresh has landed)

Task 2: APPLY itemized edits 1-8
  - ADD stock-context delegation bullet/clause
  - EXTEND admission wording with the proper-noun relief band
  - EXTEND secrets bullet (32-char floor, sub-word propagation, battery);
    DELETE accepted-non-goal wording
  - FIX/ADD Unicode boundary wording; DELETE astral trade-off wording
  - ADD same-call bigram cap guarantee wherever the cap is mentioned
  - ADD armed-chain trigger-reset clause if absent
  - PRESERVE everything else (D2-era chaining docs, config table, debug,
    dictionary build, development)

Task 3: RETIREMENT GREP SWEEP (Level 1 below) + citation check
  - RUN the grep gates; fix any hit
  - CHECK every cited src/test path exists (ls)

Task 4: GATES
  - npm run check && npm test   # green
  - git status                  # README.md only
```

## Validation Loop

### Level 1: Retirement + content greps

```bash
# must have NO matches (retired wording):
grep -inE 'accepted (v1 )?(trade-?off|non-goal).*(astral|surrogate|fragment)' README.md
grep -inE 'surrogate' README.md
grep -inE 'fragments? of (pasted )?secrets.*(non-goal|accepted)' README.md
grep -inE 'until (further|later) (messages|ingest)' README.md

# must HAVE matches (new content):
grep -in 'slash' README.md          # delegation described
grep -in 'relief' README.md         # proper-noun band
grep -in '32' README.md             # mask floor
grep -in 'code point' README.md     # boundary guard
grep -in 'same' README.md | grep -i bigram   # cap guarantee
```

### Level 2: Citation integrity

```bash
grep -oE 'test/[a-z-]+\.test\.ts' README.md | sort -u | xargs ls
grep -oE 'src/[a-z/]+\.ts' README.md | sort -u | xargs ls
```

### Level 3: Regression gates

```bash
npm run check && npm test
git status --short   # README.md only
```

### Level 4: Evidence consistency

```bash
grep -n "item 5\|item 6\|item 7" docs/M1-DoD.md | head
# README behavior claims must not contradict the recorded results
```

## Final Validation Checklist

- [ ] All Level-1 retirement greps clean; all content greps present
- [ ] Stock-context delegation, relief band, 32-char floor + sub-word
      propagation, code-point boundaries, same-call cap, trigger reset —
      all documented and verified against source
- [ ] No edits to spec/, docs/M1-DoD.md, source, tests, .gitignore
- [ ] All cited file/test paths exist
- [ ] `npm run check` + `npm test` green; README.md is the only change
- [ ] Existing voice/structure preserved (additive sweep, not rewrite)

## Anti-Patterns to Avoid

- ❌ Don't rewrite sections the D2 sweep already got right
- ❌ Don't name numeric constants without checking the shipped source
- ❌ Don't edit docs/M1-DoD.md or spec/*.md
- ❌ Don't leave any pre-fix "accepted limitation" wording behind — the
      grep gates are the acceptance
- ❌ Don't describe unverified behavior — run the cited test first
