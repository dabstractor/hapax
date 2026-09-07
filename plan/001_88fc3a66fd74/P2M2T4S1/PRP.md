# PRP — P2.M2.T4.S1: README.md M2 sync (final sweep)

---

## Goal

**Feature Goal**: Bring `README.md` in line with the complete M2 changeset
(phrases + chained completion + `enablePhrases` flag) so the README is a
truthful, verified description of the shipped M1+M2 behavior — PRD §09 h2.54
DoD closes only when the docs match the code.

**Deliverable**: An edited `README.md` (and nothing else) covering:
1. Status line → M2 complete, with a DoD evidence pointer.
2. Features section → two new M2 bullets: phrase completions (with admission
   rules in one sentence each) and chained Tab completion (with the
   National→Renewable→Energy→Laboratory example).
3. Configuration table → `enablePhrases` note updated from "inert in M1
   builds" to LIVE with its actual effect.
4. Usage → chained-completion example.
5. Limitations, Non-goals, Architecture, Debug → verified-accurate; Debug
   should already reflect the `/acwords` M2 dump (P2.M2.T3.S1 rides that
   edit); extend only if gaps remain.

**Success Definition**: Every factual claim in the README is verifiable
against shipped code/tests; `npm test` and `npm run check` are green (README
changes must not break anything, including any README-content assertions in
tests); no other file is modified.

## User Persona

The next developer (or future maintainer/agent) reading the README to decide
whether and how to use hapax. Accuracy beats marketing: wrong claims (e.g., a
feature described that doesn't gate correctly) are the failure mode.

## Why

- PRD §09 h2.56 milestones: M2 = "phrase candidates + n-gram admission +
  successor-index chained completion" — the README still says M1 and marks
  `enablePhrases` as "inert in M1 builds".
- PRD §09 h2.54 (DoD M2) is the acceptance contract this doc change
  finalizes; the evidence chain (RESULTS.md item 7) is produced by
  P2.M2.T3.S1 — this task consumes it as the status pointer.
- Mode B final sweep: one coherent README for the whole M2 changeset; per-feature
  docs (the `/acwords` Debug section) already rode with T3.S1.

## What

Edit `README.md` sections as follows. **Verify every claim against the actual
code/tests before writing it** — the tests in `test/phrases.test.ts`,
`test/provider.test.ts`, `test/acceptance.test.ts` (item 7), and
`test/debug.test.ts` are ground truth.

### 1. Status (top of file)

Replace the M1 status block with:

- **Status: M2 (v2) — complete**, verified `<date of the actual M2 sweep>` —
  keep/extend the existing pointer style: M1 evidence stays at
  `docs/M1-DoD.md`; M2 evidence pointer = the item-7 + M2 sections of
  `test/fixtures/sessions/RESULTS.md` (produced by P2.M2.T3.S1). **Read
  RESULTS.md first** and cite the sections that actually exist. If T3.S1 (or a
  sibling) created a `docs/M2-DoD.md`, point there instead — cite what
  exists, never a hypothetical file.

### 2. Features section — add two bullets (keep existing six)

- **Phrase completions** (`src/core/store.ts`, `src/core/query.ts`): 2- and
  3-word phrases become candidates when (one sentence each):
  - **repetition**: the phrase occurs **≥ 2 times** in-session (confirmed,
    sticky), or
  - **all-rare first sight**: every constituent word is rare on first sight
    (fast path; unconfirmed — demoted if not repeated within **40 messages**).
  Also state **constituent suppression** in one sentence: while a phrase is a
  candidate, its constituent words are suppressed from word-only completion so
  the phrase wins (PRD §06 h3.8). Verify wording against
  `test/phrases.test.ts` / `test/query.test.ts`.
- **Chained Tab completion** (`src/pi/provider.ts`): accepting a word via Tab
  arms its most-likely successor (top-3 successor index built at ingest,
  `src/core/store.ts`); the very next Tab completes the successor with **zero
  additional typing** — `National` → Tab → `Renewable` → Tab → `Energy` →
  Tab → `Laboratory` (scripted proof: acceptance item 7 in
  `test/fixtures/sessions/RESULTS.md`). Chaining resets on
  `before_agent_start` and on disqualifying input.

### 3. Configuration table — `enablePhrases` row

Change the Meaning cell from "phrase completions (M2); inert in M1 builds" to
its LIVE semantics: `true` enables phrase completions and Tab-chained
successor completion; `false` removes the entire phrase layer (no phrase
items, no constituent suppression, no successor capture or chaining) while
word completion is unchanged. Verify against `src/pi/index.ts`
(`config.enablePhrases` ternary, ~line 159) and the gating tests.

### 4. Usage — add a chained example after the existing example block

```text
type  natio            → menu offers National → Tab inserts "National"
     (menu stays up)   → top offer Renewable  → Tab (no typing!)
                        → Energy → Tab → Laboratory — four words, four Tabs
```

Also add one sentence: phrases appear in the same menu as words once admitted
(repetition or all-rare first sight).

### 5. Sections that should need NO or minimal edits — verify, don't rewrite

- **Debug**: T3.S1 already documented the phrases/successor dump lines. Read
  the section; if its bullets do not yet mention "top-10 phrases + successor
  sample", add the same wording T3.S1 used in its tests (`test/debug.test.ts`
  shows the exact dump format). Remove the trailing sentence "M2 will extend
  the dump with phrase and successor-index sections." — that future is now.
- **Known limitations / Non-goals**: unchanged per the item contract — leave
  as-is; only re-verify they are still true (e.g., no persistence claims
  broken by phrase store — phrases are RAM-only too, `src/core/store.ts`).
- **Architecture**: consider one added line in the core layer description
  ("phrase store + successor index (M2)" alongside `store`) and, in the
  lifecycle paragraph, that `before_agent_start` resets chain state. Keep the
  ASCII diagram untouched.
- **Reference / Dictionary / Development / Checks**: untouched.

### Success Criteria

- [ ] Status says M2 complete with a real, existing evidence pointer.
- [ ] Both new feature bullets present with correct admission/decay numbers
      (≥2 repetition, all-rare fast path, 40-message demotion, constituent
      suppression, top-3 successors).
- [ ] `enablePhrases` row documents LIVE behavior, no "inert" text anywhere.
- [ ] Usage shows the zero-typing chained example.
- [ ] No stale "M2 will…" future-tense sentences remain anywhere in README.
- [ ] No claims contradict the shipped code or tests; no other file modified.

## All Needed Context

### Context Completeness Check

Passes "No Prior Knowledge": the README itself (reproduced/known), the exact
sections to edit, the ground-truth files for every claim, and the T3.S1
contract for the Debug section and RESULTS.md evidence are all named below.

### Documentation & References

```yaml
- file: README.md
  why: THE file to edit. Current state = M1-complete docs (written by
        P1.M4.T2.S1). Structure: title/status, Features (6 bullets),
        Quick start, Usage, Architecture, Design invariants, Known
        limitations, Non-goals, Reference (Dictionary/Config/Debug/
        Development/Checks).

- file: test/fixtures/sessions/RESULTS.md
  why: M2 DoD evidence produced by P2.M2.T3.S1 (item-7 section + verdict
        tables). Cite its actual section names in the status pointer.

- file: docs/M1-DoD.md
  why: pattern for evidence pointers; stays linked for the M1 gauntlet.

- file: test/phrases.test.ts
  why: ground truth for admission (count>=2 OR all-rare first sight; sticky),
        40-ordinal demotion, constituent suppression, phrase salience.

- file: src/core/store.ts
  why: header comment documents phrase map, cap (5120), successor index
        (top-3 per word), admission at upsert tail — cite-accurate numbers.

- file: src/pi/provider.ts
  why: chain machine (createChainMachine, CHAIN_KEY_PREFIX), armed branch,
        Tab-armed chaining, enablePhrases guard; before_agent_start reset is
        wired in src/pi/index.ts.

- file: src/pi/index.ts (~line 159)
  why: config.enablePhrases ternary gating phrase capture — the flag's real
        effect for the config table row.

- file: src/pi/config.ts
  why: enablePhrases schema/default/validation (true default, boolean-only).

- prp: plan/001_88fc3a66fd74/P2M2T3S1/PRP.md
  why: CONTRACT for what exists when this task runs: pending-offer
        zero-typing chain, gating tests, /acwords phrases section, README
        Debug-section edit (Task 8 of that PRP). Do not duplicate or
        contradict; only fill what remains.

- prd: §01 h2.6 (M2 goals), §09 h2.54 (DoD M2 — the item-7 wording to
        echo), §06 h3.7/h3.8/h3.9 (admission/suppression/successor specs),
        §08 h2.46 (config schema).
```

### Current Codebase tree (relevant excerpt)

```bash
README.md                              # MODIFY (the only deliverable)
docs/M1-DoD.md                         # READ (pointer target)
test/fixtures/sessions/RESULTS.md      # READ (M2 evidence pointer target)
src/core/store.ts src/core/query.ts src/pi/provider.ts src/pi/index.ts
src/pi/config.ts                       # READ (verify every claim)
test/phrases.test.ts test/acceptance.test.ts test/debug.test.ts  # READ (truth)
```

### Known Gotchas of our codebase & Library Quirks

```md
# GOTCHA: This task runs while P2.M2.T3.S1 may still be landing — README
# Debug-section content from T3.S1 might not be present yet. Treat the T3.S1
# PRP as the contract: if its Debug edit is absent, ADD the equivalent
# wording yourself (dump format is visible in test/debug.test.ts); if
# present, leave it alone.

# GOTCHA: Never cite a docs file that doesn't exist. Check `ls docs/` and
# the RESULTS.md headings before writing the status pointer.

# GOTCHA: The 40-message decay is a 40-ORDINAL demotion sweep for
# UNCONFIRMED (fast-path) phrases only — confirmed-by-repetition phrases are
# sticky. Say it precisely; "phrases expire after 40 messages" is wrong.

# GOTCHA: enablePhrases:false disables phrases AND chaining AND successor
# capture, never word completion — the config row must say exactly this.

# GOTCHA: No future tense about M2 anywhere; M2 is shipped. Future tense
# about later milestones (per-language dictionaries) may remain in
# limitations.

# CRITICAL: documentation-only change — do not touch source, tests, fixtures,
# package.json, or plan/ files.
```

## Implementation Blueprint

No data models. Ordered tasks:

```yaml
Task 1: RESEARCH PASS (read-only)
  - Read test/fixtures/sessions/RESULTS.md (M2 sections + names), ls docs/,
    src/core/store.ts header, src/pi/provider.ts chain comments,
    src/pi/index.ts enablePhrases ternary, test/phrases.test.ts admission
    cases, and the current README Debug section.
  - Build a claim→evidence checklist; mark any claim you cannot verify.

Task 2: EDIT README.md — Status
  - Status: M2 (v2) — complete, verified <actual date from RESULTS.md>;
    M1 evidence link (docs/M1-DoD.md) kept, M2 evidence link added
    (RESULTS.md M2/item-7 section or docs/M2-DoD.md if it exists).

Task 3: EDIT README.md — Features
  - Append the two M2 bullets (phrases w/ one-sentence admission rules +
    suppression; chained Tab w/ National→Renewable→Energy→Laboratory).

Task 4: EDIT README.md — Configuration
  - enablePhrases Meaning cell → live semantics; scan whole file for any
    remaining "inert" text and remove.

Task 5: EDIT README.md — Usage
  - Chained zero-typing example + one sentence on phrase menu behavior.

Task 6: EDIT README.md — Debug (gap-fill only) + Architecture (one-line adds)
  - Remove "M2 will extend the dump…" sentence; add dump bullet only if
    T3.S1's edit is absent. Optionally add "phrase store + successor index"
    to the core layer line and before_agent_start reset mention.

Task 7: VERIFY PASS
  - Re-read full README against the claim→evidence checklist; fix drift.
  - grep -nE 'inert|M2 will|future' README.md → expect no M2 stale text.
```

## Validation Loop

### Level 1: Rendered-doc sanity

```bash
# README is markdown; check tables/fences render (no broken pipes/fences):
npx markdown-link-check README.md 2>/dev/null || true   # optional
grep -nE 'inert in M1|M2 will extend' README.md         # MUST return nothing
grep -c '^|' README.md                                  # tables intact
```

### Level 2: Repo still green (README is referenced by nothing executable, prove it)

```bash
npm run check   # clean
npm test        # fully green (proves the doc change broke nothing)
```

### Level 3: Claim verification (the real gate)

```bash
# Every numeric claim must be traceable:
grep -n "PHRASE_CAP\|>= *2\|40" src/core/store.ts src/core/query.ts | head
grep -n "enablePhrases" src/pi/index.ts src/pi/provider.ts src/pi/config.ts
ls docs/ && grep -n "^## " test/fixtures/sessions/RESULTS.md
```

### Level 4: Human review

- [ ] Read the final README top-to-bottom as a first-time user; no
      contradictions, no stale tense, all links resolve to real files.

## Final Validation Checklist

- [ ] Status: M2 complete + real evidence pointer(s)
- [ ] Features: phrases bullet (repetition ≥2 / all-rare fast path /
      40-message demotion / constituent suppression) + chained bullet with
      the four-word example
- [ ] Config: enablePhrases LIVE, "inert" gone everywhere
- [ ] Usage chained example; Debug dump documented (from T3.S1 or gap-filled)
- [ ] Limitations & Non-goals unchanged and still true
- [ ] No future-tense M2 references; no other files modified
- [ ] `npm run check` + `npm test` green
- [ ] Every claim cross-checked against code/tests per Task 7

## Anti-Patterns to Avoid

- ❌ Don't invent behavior — if a claim can't be verified in code/tests, cut it
- ❌ Don't cite docs files that don't exist
- ❌ Don't rewrite T3.S1's Debug wording if it already landed
- ❌ Don't touch the ASCII diagram, dictionary reference, or checks tables
      beyond what's specified
- ❌ Don't modify any file other than README.md