# PRP — P1.M5.T2.S1: README.md changeset sync: dictionary provenance, security, restore, chaining

## Goal

**Feature Goal**: Update `README.md` (the single changeset-level documentation
surface) so it accurately describes the stabilized post-bug-fix behavior of
the P1 stabilization changeset. This is the final gate of the changeset:
every behavioral claim in the README must match the shipped tests.

**Deliverable**: Edited `README.md` only. Six update areas:

- (a) **§Dictionary build** — real-corpus provenance (FrequencyWords
  `en_50k` → `tools/corpus/en-50k.tsv`, 48,802 entries), regeneration
  command, and the calibration guarantee (top-1000 English words reject;
  pinned by `test/calibration.test.ts` + `test/shipped-dict.test.ts`).
- (b) **§Features + §Design invariants** — "no menu for ordinary prose" is
  now guaranteed and regression-pinned; Tab never corrupts text
  (stale-prefix anchor invalidation in the display provider).
- (c) **Security posture** — shape gate masks realistic key formats
  (AWS secret keys, Slack `xoxb-…`, dotted JWTs, OpenAI `sk-proj-…`,
  GitHub/Google tokens) via a raw-text pre-segmentation mask pass plus
  entropy fallback rules; reference the adversarial probes.
- (d) **Restore behavior** — disable-don't-degrade now honored on the
  restore path (dictionary failure aborts `restoreFromHistory` replay),
  plus the phrase-demotion sweep at restore completion.
- (e) **§Features chaining** — zero-typing chain is reachable in resumed
  sessions (successor-aware constituent-suppression exemption + chain
  arming on phrase acceptance).
- (f) **§Known limitations** — remove/adjust any line documenting
  now-fixed behavior.

**Success Definition**: `npm run check` and `npm test` still green (README
is not code, but the gate confirms nothing else changed); every factual
claim added to the README is traceable to a specific shipped test or
source file; README voice/structure preserved.

## User Persona

**Target User**: hapax users and future maintainers reading the README.
**Use Case**: evaluating/trusting hapax's no-hijack and no-secret-leak
guarantees; regenerating the dictionary artifact.
**Pain Points Addressed**: README currently predates the six bug fixes —
its calibration story, security claim, restore contract, and chaining
caveats are stale or incomplete.

## Why

The P1 changeset fixed 6 adversarial-probe bugs (dictionary miscalibration,
Tab text corruption, secret leakage, bad-dict restore ingestion, chain
unreachability post-restore, demotion-sweep skip). Per-feature docs rode
with implementing subtasks (Mode A); this is the cross-cutting Mode B
sweep that makes the top-level README the accurate, single source of truth
— the final gate of the changeset.

## What

Edit only these README sections (line numbers from the current tree):
Features (L19), Architecture lifecycle paragraph (~L160), Design
invariants (L165), Known limitations (L177), Dictionary build (L202),
Missing dictionary → graceful disable (L384), Development checks (~L335).

### Success Criteria

- [ ] §Dictionary build documents FrequencyWords en_50k provenance,
      48,802 entries, the rebuild command, and the calibration guarantee
      (top-1000 English words reject; `test/calibration.test.ts` /
      `test/shipped-dict.test.ts` pin it; recalibrated bands are
      `REJECT_COMMON_THRESHOLD = 100`, `MID_FREQ_THRESHOLD = 50` in
      `src/core/score.ts`, with `tools/calibrate-bands.mjs` as the
      calibration instrument).
- [ ] Features/invariants state that prose no-menu is guaranteed and
      regression-pinned (`test/adversarial-typing.test.ts` prose probe,
      `test/shipped-dict.test.ts`), and that Tab can never replace the
      wrong span (stale-prefix anchor invalidation, editor-sim regression
      from P1.M4.T1.S1).
- [ ] Secrets paragraph covers the raw-text `maskSecrets()` pre-segmentation
      pass (`src/core/shapeGate.ts`, wired in `IngestPipeline.#admitSegment`)
      and entropy-fallback rules, referencing
      `test/mask-secrets.test.ts` and `test/adversarial-ingest.test.ts`
      realistic-key probes.
- [ ] Restore/disable section documents that dictionary failure during
      restore aborts replay (no rank-group-0 ingestion of history) and that
      `sweepPhrases()` runs at restore completion.
- [ ] Chaining paragraph updated: chain reachable in resumed sessions;
      bare word exempted from constituent suppression when it has
      successors; phrase acceptance arms the chain (last-word successor
      semantics).
- [ ] Known limitations contains no claim about a now-fixed bug (audit all
      three current bullets + any prose caveat about phrase admission
      killing the chain window — that caveat at ~L107 stays only if
      softened to match the successor-exemption behavior).

## All Needed Context

### Context Completeness Check

Implementer needs: exact README anchors, the post-fix facts and where each
is pinned in code/tests, and the README's voice. All provided below.

### Documentation & References

```yaml
- file: README.md
  why: THE file being edited; read fully first
  pattern: existing voice — bold-led bullets, section anchors, links to tests/docs
  gotcha: spec/ files are human-owned PRD source — NEVER edit them; README only

- file: src/core/score.ts
  why: current band constants REJECT_COMMON_THRESHOLD=100, MID_FREQ_THRESHOLD=50,
        with BUG-001 calibration history comments; the README previously said 220/120
        ("Not configurable (by design)" section, ~L322)

- file: tools/corpus/README.md
  why: canonical provenance text (FrequencyWords en_50k, OpenSubtitles 2018,
        CC-BY-SA-4.0, filtering rules) — summarize/link, do not duplicate wholesale

- file: tools/build-dict.mjs + tools/calibrate-bands.mjs
  why: rebuild command (`node tools/build-dict.mjs --out dict/common-en.bin tools/corpus/en-50k.tsv`)
        and calibration instrument

- file: test/shipped-dict.test.ts
  why: entry count 48,802; calibration guarantee (top words reject);
        prose no-menu e2e gate — cite as the pin

- file: test/calibration.test.ts
  why: band-constant calibration gates

- file: test/mask-secrets.test.ts
  why: maskSecrets() raw-text pass tests; realistic key formats

- file: test/adversarial-typing.test.ts   (from P1.M5.T1.S1 — parallel item, treat as landed)
  why: prose no-menu, Tab-corruption editor-sim, chain-post-restore probes

- file: test/adversarial-ingest.test.ts   (from P1.M5.T1.S2 — parallel item, treat as landed)
  why: realistic secrets, bad-dict restore (store empty + live no-op), demotion cadence

- file: src/core/shapeGate.ts
  why: maskSecrets + isSecretShaped entropy rules (base64url runs ≥16 mixed-case+digit)

- file: src/pi/ingest.ts (IngestPipeline)
  why: per-segment disable gate, sweepPhrases() public method, restoreFromHistory abort

- file: src/pi/provider.ts
  why: createDisplayProvider stale-prefix anchor invalidation; successor-exempt
        constituent suppression (rankMatches) — read to describe accurately

- docfile: plan/001_88fc3a66fd74/bugfix/001_9e0f97150b68/P1M5T1S2/PRP.md
  why: contract for the sibling ingest-probe test file; reference its probes, don't duplicate
```

### Current Codebase tree (relevant)

```bash
README.md            # EDIT TARGET
spec/                # human-owned PRD source — READ-ONLY, never edit
docs/M1-DoD.md       # historical DoD — leave untouched
tools/corpus/README.md  # provenance detail (link target)
test/*.test.ts       # shipped gates cited in README claims
src/{core,pi}/*.ts   # sources of every factual claim
```

### Desired Codebase tree

```bash
README.md            # updated in place — no new files, no deletions
```

### Known Gotchas

- README line anchors in the work item (L19/L165/L177/L202/L267/L335) are
  approximate — re-locate sections by heading.
- The old "admission bands (220/120)" mention in "Not configurable (by
  design)" must become (100/50).
- The Features chaining caveat ("phrase acceptances never arm the chain")
  is now FALSE — phrase acceptance arms the chain via last-word successor
  semantics (P1.M4.T2.S2); rewrite the caveat and the Usage "narrows the
  zero-typing chain window" paragraph (~L103–110) accordingly.
- Keep the "Verified 2026-09-07" style markers only where still true; you
  may add a new dated marker noting the P1 stabilization sweep.
- Verify each claim by opening the cited test/source — do not invent
  numbers. Entry count is 48,802; artifact ~0.9 MB.

## Implementation Blueprint

### Tasks (ordered)

```yaml
Task 1: READ the full README.md, then every reference file above
  - Build a claim→evidence table before editing anything.

Task 2: EDIT §Dictionary build
  - (already partially updated for provenance — VERIFY it matches reality)
  - Ensure: FrequencyWords en_50k provenance + link to tools/corpus/README.md;
    48,802 entries; rebuild command present; NEW calibration paragraph:
    top-1000 English words reject, bands 100/50, pinned by
    test/calibration.test.ts + test/shipped-dict.test.ts, instrumented by
    tools/calibrate-bands.mjs.

Task 3: EDIT §Features (Secrets bullet, Chaining bullet) + §Usage caveat
  - Secrets: add raw-text pre-segmentation maskSecrets() pass, realistic
    key formats (AWS/Slack/JWT/OpenAI sk-proj/GitHub/Google), entropy
    fallback, reference test/mask-secrets.test.ts + adversarial probes.
  - Chaining: resumed-session reachability, successor exemption, phrase-
    acceptance arming; update the "narrows the chain window" paragraph.

Task 4: EDIT §Design invariants + §Architecture lifecycle
  - Invariant 1 (never hijack typing): append "guaranteed and
    regression-pinned: no menu appears for ordinary prose (top-1000
    words reject; shipped-dict + adversarial typing probes)".
  - Invariant 2 (Tab): append stale-prefix anchor invalidation — Tab can
    never replace a span computed for a stale prefix.
  - Lifecycle paragraph: dictionary failure also aborts restore replay;
    sweepPhrases() runs at restore completion.

Task 5: EDIT §Known limitations + §Not configurable + §Missing dictionary
  - Remove/adjust limitation lines documenting fixed bugs; bands 220/120 →
    100/50; restore section gains the restore-path disable + demotion
    sweep semantics.

Task 6: EDIT §Development (checks) — add the adversarial suites to the
  test narrative if a one-line mention fits the existing voice (optional;
  do not bloat).

Task 7: VERIFY — reread the whole README top-to-bottom; every code/test
  path cited must exist (`ls test/`, `grep -n` constants). Do not ship a
  dangling reference.
```

### Key factual pins (verified against the tree)

- Bands: `REJECT_COMMON_THRESHOLD = 100`, `MID_FREQ_THRESHOLD = 50`
  (`src/core/score.ts`, post BUG-001 recalibration; original 220/120
  covered only ranks 0–3).
- Artifact: 48,802 entries, HAPX v1, built from
  `tools/corpus/en-50k.tsv` (FrequencyWords 2018 en_50k, OpenSubtitles,
  CC-BY-SA-4.0).
- Rebuild: `node tools/build-dict.mjs --out dict/common-en.bin tools/corpus/en-50k.tsv`
- Calibration tests: `test/calibration.test.ts`, `test/shipped-dict.test.ts`.
- Security: `maskSecrets()` in `src/core/shapeGate.ts`, wired into
  `IngestPipeline.#admitSegment`; `test/mask-secrets.test.ts`;
  adversarial probes in `test/adversarial-ingest.test.ts`.
- Restore: disable gate in `IngestPipeline` (lazy-dict failure flag,
  per-segment check), `restoreFromHistory` abort, `sweepPhrases()` at
  restore tail; probes in `test/adversarial-ingest.test.ts`.
- Display safety: prefix-anchor invalidation in `createDisplayProvider`
  (`src/pi/provider.ts`); editor-sim regression in
  `test/adversarial-typing.test.ts`.
- Chaining: successor-aware suppression exemption in `rankMatches`; chain
  armed on phrase acceptance (last-word successor semantics); chain-post-
  restore probe in `test/adversarial-typing.test.ts`.

## Validation Loop

```bash
# 1. Nothing but README.md changed
git diff --stat          # README.md only

# 2. Gates still green (proves no accidental code edits)
npm run check            # tsc --noEmit
npm test                 # vitest --run

# 3. Every cited file/constant exists (run these, fix README if any fail)
ls test/adversarial-typing.test.ts test/adversarial-ingest.test.ts test/calibration.test.ts test/shipped-dict.test.ts test/mask-secrets.test.ts
grep -n "REJECT_COMMON_THRESHOLD = 100" src/core/score.ts
grep -n "MID_FREQ_THRESHOLD = 50" src/core/score.ts
grep -n "sweepPhrases" src/pi/ingest.ts
grep -n "maskSecrets" src/core/shapeGate.ts

# 4. Markdown links resolve (spot-check each new relative link target exists)
```

## Final Validation Checklist

- [ ] All six update areas (a)–(f) addressed
- [ ] No stale claims remain (search README for "220", "120", "never arm
      the chain", and any limitation describing a fixed bug)
- [ ] Every added claim traceable to a shipped test/source
- [ ] README voice/structure preserved (bold-led bullets, anchors, links)
- [ ] `git diff --stat` shows README.md only; `npm run check` + `npm test` green
- [ ] spec/, docs/M1-DoD.md, tasks.json, prd_snapshot.md untouched

## Anti-Patterns to Avoid

- ❌ Don't restate implementation detail the README never carried (it's a
  user/maintainer doc, not a changelog).
- ❌ Don't copy prose from prior PRPs verbatim — write in README voice.
- ❌ Don't cite tests/files without verifying they exist in the tree.
- ❌ Don't touch spec/ or any file other than README.md.