# PRP — P1.M4.T2.S1: README.md changeset sweep (features, usage, architecture, invariants, config, debug) — R6, final docs task

## Goal

**Feature Goal**: Sweep `README.md` so it documents the D2-redesigned M2 —
**successor chaining only, no phrase layer** — implementing PRD R6. Every
stale phrase reference is deleted; every surviving claim is verified against
shipped behavior. Final grep gate: `grep -iE 'phrase|enablePhrases' README.md`
matches ONLY the deprecated-alias note in the Configuration section.

**Deliverable**: One file — `README.md` — edited per the itemized edit list
below (all stale passages pre-located with approximate line numbers in
`plan/002_3e8a42cadf2c/architecture/tests_docs_inventory.md` §3, quoted in
this PRP). This is the Mode B changeset-level documentation task; no further
docs subtasks exist.

**Success Definition**:
- Features: no phrase bullet; chaining bullet rewritten as one-word-per-Tab
  zero-typed-char chaining.
- Usage: no multi-word insertion prose, no `enablePhrases` prose.
- Architecture: store line = words (20k cap) + top-3 successor index fed by
  strict-adjacency bigrams; phrase-demotion lifecycle sentence deleted;
  `before_agent_start` chain-reset sentence kept.
- Design invariants: extended with "Tab only completes — the menu opens by
  typing only" (2nd threshold char, 1st char after trigger char, zero-char
  chain offer; no manual open gesture).
- Configuration: `enableChaining` row matching what `src/pi/config.ts` shipped
  (P1.M3.T1.S1, already landed) + deprecated `enablePhrases` alias note —
  verify, don't rewrite from scratch.
- Debug: phrase dump gone; successor-index sample section described as
  implemented in `src/pi/debug.ts` (`SUCCESSOR_SAMPLE_N` words → successor
  ×count rows; `(none)` when empty).
- `npm run check` + `npm test` still green (docs-only change).

## User Persona

**Target User**: pi user reading the README to learn what hapax M2 does; and
maintainers using it as the canonical feature contract.
**Use Case**: after the D2 redesign, a reader must learn chaining (accept a
word → next word is the top result with zero typing → Tab) without being
told phrases exist.
**User Journey**: read Features → try `natio` + Tab → Tab → Tab chain; check
config table for `enableChaining`; trust invariants/privacy statements.
**Pain Points Addressed**: README currently documents a deleted phrase layer
(2/3-word candidates, suppression, phrase salience, demotion sweeps) — every
such claim is now false against shipped code.

## Why

- The D2 delta (P1.M1–P1.M3, all Complete) deleted the phrase layer, made
  one-word-per-completion an invariant, redesigned chaining to zero-typed-char
  offers, renamed the config flag to `enableChaining` (deprecated
  `enablePhrases` alias), and stripped the phrase dump from `/acwords`. The
  README still describes the old M2 throughout.
- PRD §01 h2.6 (rewritten M2 goals): "One word per completion, always — no
  multi-word candidates, ever. The only phrase behavior is successor
  chaining."
- Gating input: the M2-DoD audit record appended to `docs/M1-DoD.md` by
  P1.M4.T1.S2 (in-flight, treat as contract) — consume it as the source of
  truth for "verify every claim"; do not duplicate its evidence tables in
  the README.

## What — itemized edit list

All quotes below are verbatim from
`plan/002_3e8a42cadf2c/architecture/tests_docs_inventory.md` §3; line
numbers there are approximate — locate by quoted text.

1. **Features — DELETE the phrase bullet** (starts "**Phrase completions**
   (`src/core/store.ts`, `src/core/query.ts`) — 2- and 3-word phrases join
   the menu when the phrase occurs ≥ 2 times in-session … except a
   constituent that bears successors in the chain index, which stays
   completable so it can still arm the chain (next bullet).").
2. **Features — REWRITE the chaining bullet** (starts "**Chained Tab
   completion — zero additional typing**"): new text describes the top-3
   successor index built at ingest from **strict-adjacency bigrams** in raw
   text (`recordBigramRuns`), and the armed chain: accepting a word via Tab
   arms its most-likely successor; at the next word start **the successor is
   already the top result with ZERO typed characters**; Tab inserts ONE word
   and re-arms (`National` → `Renewable` → `Energy` → `Laboratory`); typed
   chars filter the live successor list; reset on `before_agent_start` and
   on disqualifying input. Drop phrase-last-word arming and the
   constituent-suppression exemption prose entirely (that layer is gone).
3. **Usage (~lines 100–115) — REWRITE paragraphs 2–3**: delete the
   "four words, four Tabs … phrase salience (1.2 × …) outranks the prefix
   word … successor-bearing-constituent exemption … accepting a phrase arms
   the chain on its last word … `enablePhrases: false`" prose. Replacement:
   chaining as the only multi-word mechanism — e.g. "type `natio`, Tab
   accepts `National`; the next word start already offers `Renewable` as
   the top result with nothing typed — Tab, Tab, Tab walks the chain. Every
   insertion is exactly one word."
4. **Architecture — store line**: "store (per-session candidates, 20k cap,
   plus the M2 phrase store and top-3 successor index)" → drop the phrase
   store; keep "top-3 successor index fed by strict-adjacency bigrams
   captured from raw text at ingest". **DELETE** the phrase-demotion-sweep
   lifecycle sentence ("A completed replay ends with one phrase-demotion
   sweep …"). **KEEP** the `before_agent_start` chain-reset sentence.
5. **Design invariants #1 (never-hijack)**: keep the existing text (incl.
   the calibrated-bands / prose-no-menu sentence citing
   `test/shipped-dict.test.ts` and `test/adversarial-typing.test.ts`), and
   ADD the Tab-only-completes clause: "Tab only completes — the menu opens
   by typing only: the 2nd threshold char, the 1st char after the trigger
   char, or the zero-char chain offer. There is no manual open gesture."
   (mirror PRD §07 h2.42; the forced single-item Tab branch
   (P1.M2.T2.S1) means Tab NEVER opens a menu even when a forced
   completion is pending — the invariant text above covers it).
6. **Configuration table**: the `enableChaining` row was landed Mode A by
   P1.M3.T1.S1 — VERIFY it matches shipped `src/pi/config.ts` (primary key
   `enableChaining`, default `true`, gates bigram capture + chained offers;
   `enablePhrases` accepted as deprecated alias, resolved first, one
   deprecation notify per layer). Fix only drift; do not duplicate.
7. **Debug / `/acwords`**: DELETE the phrase-dump bullets (10,000-phrase
   cap, top-10 phrases, "phrases: (none)" rendering). DESCRIBE the
   successor-index sample as implemented in `src/pi/debug.ts`: rows
   "word → successor ×count" for the `SUCCESSOR_SAMPLE_N`
   highest-salience words that have successors; `successor index sample
   (none)` when empty — this is the tuning signal for chained offers
   (PRD §08 h2.48, §09 h2.52). Keep the word-store bullets (size vs 20k
   cap + ordinal, rank-group histogram, top-50 by salience, six shape-gate
   rejection counters).
8. **Global sweep**: after edits, `grep -inE 'phrase|enablePhrases'
   README.md` must show ONLY the deprecated-alias note (Configuration).
   Any other hit (including in Usage/Architecture/Debug/Features) is a
   leftover — delete or rewrite it.

### Success Criteria

- [ ] Zero stale phrase references (grep gate above passes)
- [ ] Chaining bullet + usage describe zero-typed-char offers, one word per
      Tab, `before_agent_start` reset — matching `src/pi/provider.ts` /
      `test/chain.test.ts`
- [ ] Architecture store line matches `src/core/store.ts` (no phrase map;
      `recordBigramRuns` → top-3 successor index)
- [ ] "Tab only completes" clause present in invariants
- [ ] Configuration table row equals shipped config semantics
- [ ] Debug section matches shipped `debug.ts` output sections
- [ ] README.md is the only modified file; check + test still green

## All Needed Context

### Context Completeness Check

An implementer needs the stale-passage quotes (below + inventory §3), the
shipped source of truth for each edited section, the PRD M2 contract text
(h2.6/42/43/44/46/48/54 — quoted in the selected PRD content of this work
item), and the DoD record from P1.M4.T1.S2. All specified here.

### Documentation & References

```yaml
- file: plan/002_3e8a42cadf2c/architecture/tests_docs_inventory.md
  why: §3 quotes EVERY stale README passage verbatim with approximate line
        numbers — the edit worklist. §4-5 confirm docs/ (M1-DoD.md only) and
        package.json scripts (check/test/bench).

- file: README.md
  why: the file being swept; locate passages by the quoted text, not line
        numbers.
  gotcha: PRESERVE untouched sections that are already correct — Quick
    start, Dictionary build (corpus provenance, calibration guarantee),
    Known limitations, Non-goals, Development (dev loop, jiti path,
    graceful disable, checks). Only the itemized edits change.

- file: src/pi/config.ts
  why: shipped enableChaining semantics (P1.M3.T1.S1): primary key +
        deprecated enablePhrases alias resolved first, one-per-layer
        deprecation notify, config object carries only enableChaining.
        README Configuration row must match THIS.

- file: src/pi/debug.ts
  why: shipped /acwords sections: word-store dump + successorsSection()
        rendering "word → successor ×count" for SUCCESSOR_SAMPLE_N
        highest-salience words with successors, "(none)" fallback. README
        Debug section must match THIS.

- file: src/pi/provider.ts
  why: shipped chain machine + forced single-item Tab branch (P1.M2.T2.S1)
        — basis for the rewritten chaining bullet and the Tab-only-completes
        invariant clause.

- file: src/core/store.ts
  why: recordBigramRuns + top-3 successor index (phrase machinery deleted,
        P1.M1.T2.S1) — basis for the Architecture store line.

- file: test/chain.test.ts + test/chaining-gating.test.ts
  why: pinned behavior for chaining and enableChaining gating — cite them
        in README prose where the old text cited phrase tests.

- file: docs/M1-DoD.md
  why: P1.M4.T1.S2 (PARALLEL) appends the M2 DoD audit record here — the
        gating evidence for "verify every claim". Consume; don't duplicate.
  gotcha: if that section is not yet present at implementation time, verify
        claims directly against source/tests instead of waiting.

- docfile: selected PRD content of this work item (h2.6, h2.42, h2.43,
        h2.44, h2.46, h2.48, h2.54)
  why: canonical wording for the one-word invariant, Tab-only-completes,
        chain state machine, config schema, debug command — reuse phrasing.
```

### Current Codebase tree (relevant)

```bash
README.md                 # the edit target
src/core/store.ts         # recordBigramRuns, top-3 successor index
src/core/query.ts         # words-only rankMatches (no suppress seam)
src/pi/config.ts          # enableChaining + deprecated alias
src/pi/debug.ts           # /acwords successor-index sample
src/pi/provider.ts        # chain machine + forced single-item Tab
test/chain.test.ts test/chaining-gating.test.ts test/successors.test.ts
docs/M1-DoD.md            # DoD record (M2 section appended in parallel)
plan/002_3e8a42cadf2c/architecture/tests_docs_inventory.md
```

### Desired Codebase tree

```bash
README.md   # swept — the ONLY file this task modifies
```

### Known Gotchas

```text
# DOCS-ONLY task: README.md and nothing else.
# The phrase-grep gate is the acceptance: only the deprecated-alias note
#   may match 'phrase' (case-insensitive).
# enableChaining config row ALREADY landed (P1.M3.T1.S1 Mode A) — verify
#   against src/pi/config.ts, don't re-author.
# P1.M4.T1.S2 runs in parallel on docs/M1-DoD.md — do not touch that file.
# Every behavior claim must cite or match a shipped test/source file;
#   delete anything unimplemented (the old README's phrase/suppression/
#   demotion prose describes deleted code).
# Keep the dated-verification house style; optionally add a new dated
#   line for this sweep.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: VERIFY shipped behavior per section
  - READ src/pi/config.ts (enableChaining/alias), src/pi/debug.ts
    (successorsSection), src/pi/provider.ts (armed branch + forced Tab),
    src/core/store.ts (recordBigramRuns, topSuccessors)
  - RUN npx vitest --run test/chain.test.ts test/chaining-gating.test.ts
    test/successors.test.ts — confirm the behavior you're documenting

Task 2: APPLY the itemized edits 1–8 from "What" above
  - DELETE phrase features bullet; REWRITE chaining bullet
  - REWRITE usage paragraphs 2-3
  - FIX architecture store line + lifecycle sentence
  - ADD Tab-only-completes clause to invariant #1
  - VERIFY config table row; FIX debug section
  - PRESERVE all other sections

Task 3: GREP sweep + self-review
  - RUN grep -inE 'phrase|enablePhrases' README.md → only the
    deprecated-alias note remains
  - CHECK no claim of multi-word insertion anywhere; no phrase salience,
    suppression, demotion, 10k-phrase-cap text
  - CHECK citations point at existing files/tests (ls each cited path)

Task 4: GATES
  - npm run check && npm test   # green (docs-only must not break)
  - git status                  # README.md only
```

## Validation Loop

### Level 1: Fact-check greps

```bash
grep -inE 'phrase|enablePhrases' README.md       # only deprecated-alias note
grep -n "enableChaining" README.md               # config row present
grep -n "one word\|exactly one word\|single word" README.md  # invariant present
grep -n "Tab only completes" README.md           # new invariant clause
grep -c "successor" README.md                    # chaining documented
```

### Level 2: Citation integrity

```bash
# every file/test named in README must exist:
grep -oE 'test/[a-z-]+\.test\.ts' README.md | sort -u | xargs ls
grep -oE 'src/[a-z/]+\.ts' README.md | sort -u | xargs ls
```

### Level 3: Regression gates

```bash
npm run check && npm test
git status --short   # README.md only
```

### Level 4: DoD-record consistency

```bash
# if P1.M4.T1.S2's M2-DoD section has landed in docs/M1-DoD.md, spot-check
# README behavior claims against its PASS items (chain offers, one-word
# invariant, reset-on-before_agent_start).
grep -n "M2 Definition of Done" docs/M1-DoD.md
```

## Final Validation Checklist

- [ ] `grep -inE 'phrase|enablePhrases' README.md` → only deprecated-alias note
- [ ] Phrase features bullet gone; chaining bullet = zero-typed-char,
      one-word-per-Tab, with NREL example
- [ ] Usage paragraphs rewritten; no enablePhrases prose
- [ ] Architecture: phrase store + demotion sentence gone; successor index
      + before_agent_start reset kept
- [ ] "Tab only completes — the menu opens by typing only" in invariant #1
- [ ] Config row matches shipped config.ts; Debug matches shipped debug.ts
- [ ] All cited test/source paths exist
- [ ] `npm run check` + `npm test` green; README.md is the only change

## Anti-Patterns to Avoid

- ❌ Don't re-document the phrase layer anywhere, even as history
- ❌ Don't rewrite the whole README — itemized edits; preserve correct sections
- ❌ Don't re-author the enableChaining row (verify the landed one)
- ❌ Don't touch docs/M1-DoD.md or any source/test file
- ❌ Don't describe unverified behavior — cite a shipped test or delete