# PRP — P1.M1.T1.S3 (plan 003): calibrate-bands.mjs R_eff-aware verdicts + prose fixture re-audit (Mode A)

---

## Goal

**Feature Goal**: Make `tools/calibrate-bands.mjs` (the spec-09-named
measurement probe) fully R_eff-aware — probe verdicts print the active
curve parameters and each word's own `R_eff(len)`, sections that remain
flat are explicitly labeled legacy, and acceptance assertions pin the
2026-10 boundary words (`uploads` REJECT, `configurations` ADMIT, group-2
band still empty under the curve). Re-audit `test/calibration.test.ts`
against the landed ramp (re-measured finding: prose.jsonl has NO 9+ char
words — max length 7 — so the store-EMPTY gate holds for the right
reason; update comments and pin the fixture property) and re-verify
`test/shipped-dict.test.ts`'s prose gate (COMMON_PROBES are 4–6 chars,
floor-hold rejects — no change).

**Deliverable**:
- Updated `tools/calibrate-bands.mjs` (probe header + verdict lines,
  legacy labels, new acceptance assertions; zero-arg mode still exits 0
  only on green, exit 1 on drift)
- Updated `test/calibration.test.ts` comments + a fixture-length pin
  assertion keeping `store.size === 0` meaningful under the 2026-10 curve
- Confirmation runs: `node tools/calibrate-bands.mjs <boundary words>`
  against the shipped `dict/common-en.bin`, full `npm test` +
  `npm run check` green

**Success Definition**: `node tools/calibrate-bands.mjs uploads
configurations` prints REJECT and ADMIT(g0) respectively with the curve
formula + floor in the header; zero-arg mode passes all assertions
including the new boundary pins; `test/calibration.test.ts` and
`test/shipped-dict.test.ts` pass unchanged in behavior (comment/pin
edits only in calibration.test.ts); README is NOT touched (Mode A —
README rejectCommonness row is R5/P1.M4, Mode B).

## Why

spec/09 h2.59 names `tools/calibrate-bands.mjs` as the tuning probe that
must run after any retune or dictionary regen. After S1 (R_eff curve in
`admit()`) and S2 (guard rides R_eff), the tool's own header,
verdict-lens, and assertions still describe the retired flat band
(`REJECT=12, MID=20`, "a word rejects when its q ≥ the configured band",
flat sweep, flat populations, `group-2 band empty` measured flatly). A
drift probe that misdescribes the live banding is worse than none: a
future retune would read wrong verdicts off it. The prose fixture gate
(`store EMPTY`) was written under the 2026-09 flat band; the 2026-10 ramp
admits 9+ char attested words, so the gate's justification must be
re-measured and re-pinned (measured: holds, because the fixture contains
no 9+ char words).

## What

All changes are to `tools/calibrate-bands.mjs` and
`test/calibration.test.ts` (comments/pin only). No `src/` changes, no
`test/shipped-dict.test.ts` behavior change, no README change.

### 1. Probe mode (word arguments) — R_eff-aware output

- Extend the score.ts import: `rEff`, `REJECT_LEN_FLOOR`,
  `REJECT_LEN_FULL` (S1's exports; keep `admit`,
  `REJECT_COMMON_THRESHOLD`; keep or keep-and-relabel
  `MID_FREQ_THRESHOLD`).
- Replace the header line
  `word → q → verdict under REJECT=..., MID=...` with a curve header:
  print the active floor R (= `REJECT_COMMON_THRESHOLD`), the hold/fully
  points (`hold ≤ ${REJECT_LEN_FLOOR}`, `admit-all ≥
  ${REJECT_LEN_FULL}`), and the formula, e.g.:
  `word → q → verdict under R_eff(len), R=12 (hold ≤8, admit-all ≥20, sqrt ramp: R + (255−R)·√((len−8)/12))`.
- Per word, print `len`, the word's own threshold `rEff(R, len)`
  (compute directly — do NOT re-implement the formula; import `rEff`),
  and both verdicts (lc | Cap) exactly as today (`admit()` already rides
  R_eff after S1/S2 — the probe's job is to SHOW it). Example target
  line shape:
  `  configurations   len=15 q=absent R_eff=197  g0 | Cap: g0`.
  Keep the existing "pick a rejectCommonness value" guidance comment but
  reword it: the knob moves the floor R and the whole curve scales from
  it; a word rejects when its q (or its stem's q, per the guard) ≥
  R_eff(len(word)).

### 2. Zero-arg mode — length-aware or explicitly-labeled legacy

- Section 1 (artifact header + band populations): the flat
  `popReject(REJECT_COMMON_THRESHOLD)` population is now a LEGACY view
  (it ignores length). Keep it but label the line, e.g.
  `band populations (legacy flat view — admission is length-conditioned since 2026-10):`.
  OPTIONALLY add one length-aware line: population that would reject at
  each probe length is expensive to compute exactly (the artifact does
  not store word lengths) — if added, approximate by bucketing the TSV
  words via the already-built `rankWord[]` (e.g. count words at len ≤ 8
  with q ≥ R vs len 9–19 with q ≥ rEff(R,len)). If not added, the
  legacy label suffices for this task.
- Section 4 (threshold sweep T=15..255): label
  `threshold sweep (legacy flat view — per-length boundaries come from
  R_eff; T = floor R only)`. Keep the sweep (it is how a floor-R value
  is chosen) but drop/keep the `← MID` marker as
  `← MID (retired 2026-10)` if kept.
- Section 3 (BUG-001 word set): no change needed — all words there are
  ≤ 8 chars (floor hold); the section now implicitly exercises R_eff
  via `admit()`.

### 3. Acceptance assertions (section 5) — update + extend

- KEEP all existing assertions (they still hold: every word named is
  ≤ 8 chars → floor hold → same verdicts as before). Keep the
  population band 40k..47k check (legacy-labeled flat view is still the
  right measurement for the floor R's coverage).
- ADD boundary pins from spec/04 h2.26 (these are the contract's named
  checks; they pass only once S2 has landed):
  - `admit('uploads')` (7c, absent, stem `upload` q=38 ≥ R_eff(12,7)=12)
    → `"reject"`
  - `admit('configurations')` (15c, absent, stem `configuration` q=26 <
    R_eff(12,15)) → group `0`
  - `admit('government')` (10c, q≈<110) → admits group `1`;
    `admit('everything')` (10c, q=139 ≥ R_eff(12,10)≈110) → `"reject"`
    (spec-named pair — if either verdict differs, the CURVE is drifted:
    report it, do not loosen the assertion)
- RE-CHECK the group-2 assertion under the curve: the flat
  `popBand2(MID, REJECT) === 0` measurement remains valid for the
  artifact's score distribution (unchanged by admission logic) — keep
  it, but ALSO pin it behaviorally: `admit()` of an attested word in
  the (MID..REJECT) quant range with len ≤ 8 must return `"reject"` or
  group 1, never 2 (find one via the loaded dict, e.g. any word with
  `MID_FREQ_THRESHOLD ≤ q < REJECT_COMMON_THRESHOLD` is impossible since
  MID=20 > REJECT=12 — so instead pin: every attested word with q < 12
  admits at group 1, e.g. the rank-47000 tail word if q < 12, else pick
  `rankWord[48700]`). Simplest correct form:
  `check(admit(draft(tailWord), dict) !== 2, "attested admission never lands at group 2 (flat at 1)")`.
- Update the tool's top-of-file header comment to describe R_eff-aware
  verdicts (Mode A: this rides WITH the work; no separate docs subtask).

### 4. test/calibration.test.ts re-audit (measured outcome: gate HOLDS)

- Re-measure first (the finding is pre-verified here): replay
  prose.jsonl through the real pipeline; **store stays EMPTY** — the
  fixture's 187 distinct words have max length 7 (longest: `morning`,
  `through`, `kitchen`, …), all inside the floor-hold region, so the
  2026-10 ramp changes zero admissions for THIS fixture.
- Update the `store.size === 0` test's comment from "2026-09 retighten"
  to 2026-10 semantics: ordinary prose stays out because every
  fixture word is ≤ 8 chars (floor hold R=12 rejects all attested ones);
  9+ char attested words WOULD admit under the ramp but the fixture
  contains none.
- ADD a pin so that claim can't silently rot (keeps the test meaningful
  rather than accidentally true): assert the fixture's distinct
  lowercased word set contains no word of length ≥ 9. Implementation:
  reuse the suite's own parsing (`parseSessionFixture(PROSE)` +
  `extractText`, already imported) in a small test that regex-scans all
  text and asserts `max(len) <= REJECT_LEN_FLOOR` (import
  `REJECT_LEN_FLOOR` from `../src/core/score.js`). If a future fixture
  edit adds long words, this pin forces the store-empty expectation to
  be revisited deliberately.
- COMMON_PROBES (`with/this/them/that/have/would`, 4–6 chars, q=156..240),
  the `posts/thin/firs` block (q=47/76/144, 4–5 chars), and the
  positive control are all floor-hold — NO behavior change. Leave their
  code as-is; optionally refresh the "2026-09" comment dates to mention
  "floor hold under the 2026-10 curve".
- test/shipped-dict.test.ts: re-verify only (its BUG-001 gate words are
  the same 4–6 char set; lookups vs `REJECT_COMMON_THRESHOLD` still
  hold). NO edits required — do not touch this file.

### Success Criteria

- [ ] `node tools/calibrate-bands.mjs uploads configurations` prints
      `uploads … REJECT` and `configurations … g0` (lc), with len +
      per-word R_eff shown, and the header carries the curve formula +
      active floor
- [ ] `node tools/calibrate-bands.mjs` (zero-arg) exits 0 with all
      assertions PASS, including the new `uploads`/`configurations`/
      `government`-admits/`everything`-rejects pins and the
      never-group-2 pin
- [ ] Flat sweep + flat populations sections carry explicit "legacy"
      labels
- [ ] `test/calibration.test.ts` green: store EMPTY assertion retained
      with 2026-10 comment + new max-word-length ≤ REJECT_LEN_FLOOR pin
- [ ] `test/shipped-dict.test.ts` green with zero edits
- [ ] `npm test` + `npm run check` green
- [ ] No changes to `src/**`, `README.md`, `spec/**` (Mode A — spec ride
      happened with S1/S2)

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything
needed to implement this successfully?" — Yes: the current probe source
is read in full during research, the S1/S2 contracts (`rEff`,
`REJECT_LEN_FLOOR`, `REJECT_LEN_FULL` exports; guard riding R_eff) are
quoted from their PRPs, the prose.jsonl re-measurement is already done
(max length 7 → store stays empty), and every assertion's expected
verdict is given with its arithmetic.

### Documentation & References

```yaml
- file: tools/calibrate-bands.mjs
  why: The primary file to modify. Structure (verify against the live
        file first): argv word-probe block at top (draft/capDraft
        helpers, header line, per-word console.log, process.exit(0));
        sections 1-5 in zero-arg mode; check()/failures/exit-1 tail.
  pattern: keep the existing section comments/style; only the probe
        header line, verdict lines, labels, and assertion block change.
  gotcha: import rEff etc. from "../src/core/score.ts" (native
        TS-stripping, Node ≥ 23.6 — do not add build steps). admit()
        ALREADY rides R_eff after S1/S2 — the probe must not re-implement
        banding; it computes rEff only for DISPLAY.

- file: src/core/score.ts
  why: S1/S2 deliverables consumed (do not modify): rEff(floor, len)
        — floor hold len≤8, R + (255−R)·√((len−8)/12) for 8<len<20,
        returns 256 sentinel at len ≥ 20; REJECT_LEN_FLOOR=8;
        REJECT_LEN_FULL=20; MID_FREQ_THRESHOLD stays exported (value 20,
        retired). Guard compares stem q against rEff(rejectAt,
        draft.key.length).
  gotcha: rEff returns 256 (not 255) at len ≥ 20 — display it as
        "admit-all", not 256, to avoid confusion.

- file: test/calibration.test.ts
  why: Second file to modify (comments + one new pin test). Key
        elements: PROSE path const (~L54), COMMON_PROBES export (~L64),
        beforeAll real-pipeline replay, store.size===0 test (~L131),
        posts/thin/firs test, lwlock positive control.
  pattern: new pin test follows the suite's existing imports
        (parseSessionFixture, extractText, AgentMessage) — mirror the
        beforeAll text-extraction loop to gather words, then assert
        max length ≤ REJECT_LEN_FLOOR.
  gotcha: import from "../src/core/score.js" (test files use .js
        specifiers), while tools/*.mjs imports use "../src/core/score.ts".

- file: test/shipped-dict.test.ts
  why: Re-verify ONLY — its BUG-001 gate (the/with/this/them/that/
        have/would lookup ≥ REJECT_COMMON_THRESHOLD) survives the curve
        because all are 4-6 chars (floor hold). Do NOT edit.

- file: test/fixtures/sessions/prose.jsonl
  why: The fixture under re-audit. Measured: 33 lines, 187 distinct
        lowercased words, MAX LENGTH 7 — no word reaches the ramp.
        Do not edit the fixture in this task.

- spec: spec/04 h2.26 (Admission decision) — R_eff formula, boundary
        arithmetic (9→q<82, 10→q<110: government in, everything q=139
        out; 14→q<184), uploads/configurations guard examples, flat
        group 1, relief dead.
- spec: spec/09 h2.59 (Tuning protocol) — calibrate-bands.mjs is the
        named probe: word verdicts, band populations, drift assertions.
- file: plan/003_bbac3b15e8d0/P1M1T1S1/PRP.md and P1M1T1S2/PRP.md
  why: Contracts for what landed in score.ts before this task (rEff
        signature/sentinel, knob scaling, guard riding R_eff, MID kept
        exported as compatibility constant).
- file: plan/003_bbac3b15e8d0/P1M1T1S3/research/research-notes.md
  why: Full measurements backing this PRP (probe output, fixture scan,
        probe line numbers).
```

### Current Codebase tree (relevant excerpt)

```bash
tools/calibrate-bands.mjs      # modify
tools/build-dict.mjs           # read-only import source (DICT_N, KEY_RE, quant)
tools/corpus/en-50k.tsv        # read by section 2
dict/common-en.bin             # shipped artifact, 48,802 entries
src/core/score.ts              # read-only here (S1/S2 landed)
src/core/dictionary.ts         # loadDictionary
test/calibration.test.ts       # modify (comments + pin)
test/shipped-dict.test.ts      # verify only, no edits
test/fixtures/sessions/prose.jsonl  # read-only
```

### Known Gotchas of our codebase & Library Quirks

```js
// CRITICAL: tools/*.mjs import TS sources with the .ts extension
// (Node ≥ 23.6 native type stripping); test/*.ts import with .js
// specifiers. Match each file's local convention or nothing resolves.
// CRITICAL: do NOT re-implement banding in the probe — call admit() and
// rEff from score.ts; duplication is what BUG-001 was about.
// GOTCHA: rEff's len ≥ 20 sentinel is 256 — print "admit-all" for it.
// GOTCHA: MID_FREQ_THRESHOLD (20) > REJECT_COMMON_THRESHOLD (12) since
// the 2026-09 retighten, so the flat group-2 population is trivially 0 —
// that's why the behavioral never-group-2 pin is also needed.
// GOTCHA: prose.jsonl replay takes up to 60s (beforeAll timeout is
// already set); the new pin test should reuse cheap string ops on the
// already-parsed fixture, not re-run the pipeline.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: VERIFY preconditions (S1/S2 landed)
  - RUN: node tools/calibrate-bands.mjs uploads configurations
  - EXPECT: uploads REJECT, configurations g0 (post-S2). If
    configurations still REJECTs, S2 has not landed — STOP and report;
    do not patch around it.

Task 1: MODIFY tools/calibrate-bands.mjs — probe mode
  - EXTEND import: add rEff, REJECT_LEN_FLOOR, REJECT_LEN_FULL from
    ../src/core/score.ts
  - REPLACE header line with curve header (floor R, hold/admit-all
    points, sqrt formula)
  - AUGMENT per-word line: len + rEff(R, lower.length) next to q and
    both verdicts (admit() calls unchanged)
  - UPDATE the usage comment block: knob moves the floor; a word (or
    its stem) rejects when q ≥ R_eff(len(word))

Task 2: MODIFY tools/calibrate-bands.mjs — zero-arg sections
  - LABEL section 1 populations line "(legacy flat view — admission is
    length-conditioned since 2026-10)"
  - LABEL section 4 sweep "(legacy flat view — per-length boundaries
    come from R_eff; T = floor R only)"; mark MID marker "retired 2026-10"
  - KEEP sections 2, 3, and the monotonicity check unchanged

Task 3: MODIFY tools/calibrate-bands.mjs — acceptance assertions
  - ADD: uploads → "reject"; configurations → 0; government admits
    (group 1); everything → "reject"; attested admission never lands at
    group 2 (tail-word behavioral pin)
  - KEEP: all existing assertions + reject-population 40k..47k window
  - RUN: node tools/calibrate-bands.mjs   → exit 0, all PASS

Task 4: MODIFY test/calibration.test.ts
  - UPDATE store.size===0 comment to 2026-10 semantics (fixture max
    word length 7 → floor hold → empty by design)
  - ADD pin test: distinct lowercased words of prose.jsonl all have
    length ≤ REJECT_LEN_FLOOR (import from ../src/core/score.js;
    reuse parseSessionFixture/extractText already in the file)
  - REFRESH stale "2026-09" comment dates where they describe verdicts
    that now ride the floor hold (light touch — code unchanged)

Task 5: VERIFY shipped-dict gate + full validation
  - RUN: npx vitest run test/shipped-dict.test.ts (must pass UNEDITED)
  - RUN: npm test && npm run check
```

### Implementation Patterns & Key Details

```js
// Probe verdict line (target shape):
// header:
console.log(
  `word → q → verdict under R_eff(len), R=${REJECT_COMMON_THRESHOLD} ` +
  `(hold ≤${REJECT_LEN_FLOOR}, admit-all ≥${REJECT_LEN_FULL}, ` +
  `ramp: R + (255−R)·√((len−8)/12))`);
// per word:
const eff = rEff(REJECT_COMMON_THRESHOLD, lower.length);
console.log(
  `  ${w.padEnd(16)} len=${lower.length} q=${qText.padEnd(6)} ` +
  `R_eff=${eff >= 256 ? "admit-all" : eff.toFixed(0)}  ` +
  `${fmt(verdict).padEnd(6)} | Cap: ${fmt(cap)}`,
);

// New assertions (section 5 pattern — reuse existing check()):
check(admit(draft("uploads"), dict) === "reject",
  "guard rides R_eff: 'uploads' (7c, stem upload q=38) rejects");
check(admit(draft("configurations"), dict) === 0,
  "guard rides R_eff: 'configurations' (15c, stem q=26 < R_eff(15)) admits group 0");
check(admit(draft("government"), dict) === 1, "'government' (10c, q<110) admits group 1");
check(admit(draft("everything"), dict) === "reject", "'everything' (10c, q=139 ≥ R_eff(10)≈110) rejects");
check(admit(draft(tailWord), dict) !== 2,
  "attested admission is flat at group 1 — group 2 stays dead");

// calibration.test.ts pin (inside the existing describe; reuses suite imports):
it("prose.jsonl contains no ramp-length words (store-empty pin, 2026-10)", () => {
  // The 2026-10 R_eff ramp admits 9+ char attested prose; this fixture
  // deliberately has none (max measured length 7), which is why the
  // store-EMPTY expectation above still holds. Adding long words here
  // requires revisiting that expectation.
  const words = new Set<string>();
  for (const e of entries /* captured in beforeAll's parse loop or re-parsed cheaply */) {
    const text = e.message !== undefined ? extractText(e.message as unknown as AgentMessage) : null;
    if (text === null) continue;
    for (const m of text.matchAll(/[A-Za-z][A-Za-z'-]+/g)) words.add(m[0].toLowerCase());
  }
  for (const w of words) {
    expect(w.length, `fixture word '${w}' is ≥ ramp length — revisit store-empty expectation`)
      .toBeLessThanOrEqual(REJECT_LEN_FLOOR);
  }
});
```

### Integration Points

```yaml
NONE outside the two files:
  - src/core/score.ts: read-only dependency (S1/S2 exports)
  - spec/README: untouched (Mode A; README row is P1.M4.T1.S1 / Mode B)
  - dict/common-en.bin: read-only; probe runs against it as-is
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npx tsc --noEmit -p . 2>/dev/null || npm run check   # repo check command
# tools/*.mjs is JS — covered by npm run check linting if configured; the
# probe itself exercises at runtime (Level 3).
```

### Level 2: Unit Tests

```bash
npx vitest run test/calibration.test.ts
npx vitest run test/shipped-dict.test.ts   # unedited, must stay green
npx vitest run test/score.test.ts          # S1/S2 suites unaffected
npm test
```

### Level 3: Integration / probe runs (the real deliverable check)

```bash
node tools/calibrate-bands.mjs uploads configurations
# expect: uploads  len=7  q=absent  R_eff=12   REJECT | Cap: g0
#         configurations len=15 q=absent R_eff=197 g0 | Cap: g0
node tools/calibrate-bands.mjs
# expect: all acceptance assertions PASS incl. new pins; exit code 0
echo $?   # 0
node tools/calibrate-bands.mjs government everything posts
# spot-check verdicts against spec/04 h2.26's published table
```

### Level 4: Domain validation

```bash
# No UI change — no TTY verification required (spec/09 binding applies to
# UI-layer changes; this task is tooling + tests).
```

## Final Validation Checklist

- [ ] Task 0 precondition check passed (S1/S2 landed, configurations admits)
- [ ] Probe header prints curve formula + active floor + hold/admit-all points
- [ ] Per-word lines show len + per-word R_eff; verdicts via admit()
- [ ] Flat sweep/populations labeled legacy
- [ ] New assertions in place and passing; exit 0 on zero-arg mode
- [ ] test/calibration.test.ts: store-empty comment updated to 2026-10 +
      length-pin added and passing
- [ ] test/shipped-dict.test.ts green with zero edits
- [ ] `npm test` + `npm run check` green
- [ ] No edits to src/**, README.md, spec/**, dict/**, prose.jsonl

## Anti-Patterns to Avoid

- ❌ Don't re-implement the banding/curve in the probe — import `admit`
  and `rEff` (BUG-001's root cause was duplicated calibration logic)
- ❌ Don't loosen or delete the store-empty or shipped-dict assertions to
  make them pass — the re-audit's measured result is that they HOLD;
  if they don't hold at implementation time, STOP and report (S1/S2
  contract violation), don't paper over it
- ❌ Don't edit prose.jsonl to add long words "to test the ramp" — the
  fixture's shortness is now a pinned, documented property; changing it
  is a separate deliberate decision
- ❌ Don't touch README (Mode A; the rejectCommonness row is R5/Mode B)
- ❌ Don't round rEff before comparing in any new assertion — reuse
  admit()'s verdicts, not recomputed thresholds
