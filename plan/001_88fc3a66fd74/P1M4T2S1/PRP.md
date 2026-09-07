# PRP — P1.M4.T2.S1: README.md changeset sync (M1 final sweep)

## Goal

**Feature Goal**: Rewrite/expand `README.md` into a coherent whole-feature
document covering the complete M1 implementation — what hapax is, its feature
list, quick start, usage examples, architecture summary, the four design
invariants verbatim, known limitations, and non-goals — with **every claim
verified against shipped behavior** (anything not implemented is deleted).
Per-feature docs that already rode with earlier subtasks (Dictionary build,
Configuration, Debug, Development sections — Mode A) are preserved and
reorganized, not duplicated or contradicted.

**Deliverable**: An updated `README.md` (repo root) reflecting the entire M1
delta. No source code changes.

**Success Definition**: README sections per the contract below exist; every
factual claim matches shipped code in `src/` (verified by reading the modules);
the four design invariants appear verbatim; the three known limitations and the
non-goals are present; the existing Mode A sections (Dictionary build,
Configuration, Debug, Development) remain intact and consistent; the
`npm run bench` line from P1.M4.T1.S2 is preserved (that PRP adds it to the
Development section — do not duplicate or remove it).

## User Persona

**Target User**: A pi user deciding whether to install hapax, and a developer
evaluating/contributing to the repo.
**Use Case**: Read the README top-to-bottom to learn what hapax does, how to
install it (`pi -e / symlink / .pi/extensions`), how to use trigger and
threshold completion, and what it will never do (hijack keys, persist, phone
home).
**User Journey**: land on README → one-paragraph hook (hapax legomenon) →
feature list → install → try `#ze` → trust established via invariants/privacy
statements → link into detailed sections.
**Pain Points Addressed**: current README reads as scaffolding notes ("Status:
scaffolding") and opens with dictionary internals; a newcomer cannot tell what
the extension does or how to use it.

## Why

- M1 is complete (all P1.M1–P1.M3 subtasks done; see plan_status); the README
  still opens with "(Status: scaffolding.)" and dictionary-build minutiae.
- This is the Mode B changeset-level docs subtask: the final sweep that turns
  per-subtask doc riders into a coherent whole-feature document.
- Feeds P1.M4.T2.S2 (M1 definition-of-done verification sweep), which will
  check README accuracy as part of DoD.

## What

Rewrite `README.md` with this structure (top to bottom). Keep ALL existing
Mode A sections' content (Dictionary build, Configuration, Debug, Development)
— they may be repositioned under headings but their verified technical content
must survive intact.

1. **Title + one-paragraph intro**: what hapax is — a pi extension named for
   the *hapax legomenon* (a word that occurs only once in a corpus — exactly
   what it harvests): it watches user prompts and final agent output, extracts
   uncommon words/identifiers/proper names, and offers them as Tab
   completions in the prompt input via pi's built-in autocomplete menu.
   Remove "(Status: scaffolding.)"; state "Status: M1 (v1) — fully usable."
2. **Features** (bulleted, all shipped — verify each against code):
   - Trigger-char completion from the 1st character (default `#`)
   - Threshold matching from N typed characters anywhere a word starts
     (default 2, configurable 1–3) — `src/pi/provider.ts`
   - Session salience ranking (recency + repetition + user-typed boost —
     `src/core/score.ts`)
   - Case-preserving insertion (type `nrel`, get `NREL` — provider mapping)
   - Secrets never suggested (always-on shape gate — `src/core/shapeGate.ts`)
   - Zero persistence / zero telemetry / zero network — everything in RAM,
     dies at `session_shutdown` (`src/pi/index.ts`)
3. **Quick start**: the three install paths already documented in Development
   (a) `pi -e /path/to/hapax`, (b) global symlink
   `ln -s ... ~/.pi/agent/extensions/hapax`, (c) project-local
   `.pi/extensions/hapax` (trust-gated — pi prompts; untrusted never loads).
   Keep the details in Development; Quick start is a short pointer, avoid
   duplicating prose.
4. **Usage** mirroring PRD §09 item 1 happy path: session mentions
   `Zendesk` + `lwlock`; type `ze` → menu offers `Zendesk`; Tab inserts it
   cased. Type `#l` → `lwlock` from the 1st char. Note: ordinary typing is
   untouched; menu is take-it-or-leave.
5. **Architecture** (prose + small ASCII diagram): two-layer split —
   `src/core/` (pure, agent-agnostic: dictionary, segment, shapeGate, score,
   store, query) and `src/pi/` (adapter: index/ingest/provider/config/debug/
   paths). Three paths per PRD §02: **ingest** (background, `message_end`,
   300 ms debounce, chunked — never on keystroke path), **query**
   (synchronous, every keystroke), **popup** (display-only, 100 ms debounce +
   hysteresis). Entry point `src/pi/index.ts`; lifecycle wiring
   session_start / message_end / session_shutdown; store survives compaction;
   history restore rebuilds on resume.
6. **Design invariants** — the four verbatim from PRD h2.1 (see context
   below; copy word-for-word).
7. **Known limitations** — the three from PRD §01, linked conceptually to
   PRD: English-only dictionary; Tab-before-paint cosmetic; absence-vs-rarity
   conflation (shape gates + salience mitigate).
8. **Non-goals** — condensed from PRD: no ingestion of tool results / file
   reads / thinking tokens; no persistence or per-project caches; no learned
   scorer or embeddings; no CJK segmentation; no modification of messages or
   anything sent to providers.
9. **Dictionary build / Configuration / Debug / Development** — existing
   sections, kept (possibly under a "Reference" or "Internals" grouping).
   Include the performance gates table summary + `npm run bench` /
   `npm test` / `npm run check` (bench suite arrives with P1.M4.T1.S2; the
   README line for it is that subtask's deliverable — coordinate so exactly
   one such line exists).

### Success Criteria

- [ ] README opens with the hapax legomenon hook paragraph; no
      "scaffolding" status text
- [ ] All six feature bullets present and true of shipped code
- [ ] Quick start covers `pi -e`, global symlink, `.pi/extensions`
- [ ] Usage example mirrors the Zendesk/lwlock happy path
- [ ] Architecture section names the core/pi split and ingest/query/popup
      paths with their timing properties
- [ ] Four design invariants verbatim
- [ ] Three known limitations + non-goals present
- [ ] Existing Configuration/Debug/Dictionary-build/Development content
      preserved and non-contradictory
- [ ] Every README claim verified against `src/` — anything unimplemented
      deleted

## All Needed Context

### Context Completeness Check

An implementer needs: current README (to preserve Mode A sections), the PRD
snapshot (invariants, limitations, non-goals, happy path — quoted below), the
shipped source layout, and the P1.M4.T1.S2 PRP contract (bench README line).
All provided here; no other files strictly required, but spot-reading the
listed source files is expected during verification.

### Documentation & References

```yaml
- file: README.md
  why: starting point — preserve Dictionary build, Configuration, Debug,
        Development sections verbatim-ish; remove "(Status: scaffolding.)"
  pattern: existing tone is precise, table-heavy, verification-dated
  gotcha: do NOT delete the verified technical content (config precedence,
    jiti path pattern, graceful-disable behavior, versioning contract)

- file: plan/001_88fc3a66fd74/prd_snapshot.md
  why: h2.1 design invariants (copy verbatim); §01 non-goals + known
        limitations; §09 integration item 1 happy path
  section: h2.1, "Non-goals (explicit)", "Known limitations (accepted)",
           "Integration acceptance" item 1

- file: src/pi/index.ts
  why: lifecycle facts for architecture section (session_start/message_end/
        session_shutdown, no compaction handler, message_end returns
        undefined, disable-on-bad-dict)
- file: src/pi/provider.ts
  why: trigger/threshold matching, debounce 100 ms + hysteresis, synchronous
        query, case-preserving insertion, delegation gate
- file: src/pi/ingest.ts
  why: 300 ms debounce, chunked processing, restoreFromHistory
- file: src/core/score.ts, src/core/shapeGate.ts, src/core/store.ts
  why: salience ranking, secret-shape rejection, 20k cap / eviction
- file: plan/001_88fc3a66fd74/P1M4T1S2/PRP.md
  why: running in parallel; that PRP adds the "npm run bench" line to the
        README Development section — assume it exists; do not duplicate
  gotcha: exactly one bench line in the final README

- url: https://en.wikipedia.org/wiki/Hapax_legomenon
  why: one-line authority for the hapax legomenon definition in the hook
```

### Current Codebase tree (relevant parts)

```bash
src/core/  dictionary.ts query.ts score.ts segment.ts shapeGate.ts store.ts types.ts
src/pi/    config.ts debug.ts index.ts ingest.ts paths.ts provider.ts
test/      (21 test files incl. provider-live, ingest-restore, shipped-dict)
tools/     build-dict.mjs gen-provisional-tsv.mjs
dict/      common-en.bin
README.md
```

### Desired Codebase tree

```bash
README.md   # rewritten — the ONLY file this task touches
```

### Known Gotchas

```text
# This is a DOCS-ONLY task: modify README.md and nothing else.
# The four invariants must be VERBATIM (they are a PRD contract, h2.1).
# Parallel work: P1.M4.T1.S2 adds test/bench + one README bench line —
#   coordinate; final README should contain that line exactly once.
# README claims are contracts for future readers — verify against code,
#   delete anything not implemented (e.g. nothing phrase/M2-related may be
#   described as working; enablePhrases is documented as inert in M1 — keep
#   that framing).
# The "(Verified 2026-09-07 ...)" dating convention in Development is a
#   house style — keep existing dated claims; optionally add a new dated
#   verification line for the final sweep.
```

## Implementation Blueprint

### Implementation Tasks (ordered)

```yaml
Task 1: VERIFY shipped behavior
  - READ src/pi/index.ts, provider.ts, ingest.ts (lifecycle, timings,
    delegation, disable-on-bad-dict); skim src/core/* for feature claims
  - LIST any current README claim NOT backed by code → delete list

Task 2: RESTRUCTURE README.md
  - WRITE new top: title + hapax legomenon hook paragraph, status line
    "M1 (v1) — fully usable"
  - ADD Features (6 bullets), Quick start, Usage (Zendesk/lwlock), Architecture
    (core/pi split, ingest/query/popup, small ASCII diagram)
  - ADD Design invariants verbatim (from PRD h2.1, quoted in this PRP)
  - ADD Known limitations (3) + Non-goals
  - KEEP Dictionary build / Configuration / Debug / Development sections;
    ensure headings nest sensibly (e.g. under "Reference")
  - REMOVE: "(Status: scaffolding.)" and any stale/untrue claims
  - COORDINATE with P1.M4.T1.S2 bench line: exactly one `npm run bench`
    mention in Development/Checks

Task 3: SELF-REVIEW pass
  - CHECK every feature bullet against the source file it cites internally
  - CHECK no M2 feature is described as working (phrases = "inert in M1",
    or omitted except the existing config-table row)
  - CHECK internal consistency: Quick start install paths match Development
    section; timings (100 ms popup, 300 ms ingest, 20k cap) match code/PRD
```

### The four design invariants (copy verbatim into README)

1. **Never hijack typing.** No key is ever captured, consumed, or altered
   except Tab while a suggestion is selected. The user's typing experience is
   unchanged; the menu is strictly take-it-or-leave.
2. **Tab is never delayed by UI.** The top suggestion is computed
   synchronously on every keystroke; the popup may be debounced, but Tab
   always resolves the current top item immediately.
3. **The popup never flickers and never appears with zero candidates.**
4. **Everything stays in RAM.** No persistence, no telemetry, no network.
   The candidate store is per-session and dies at `session_shutdown`.

### Usage example (mirror PRD §09 item 1)

```text
Session mentions `Zendesk` and `lwlock`. Later:
  type  ze        → menu offers Zendesk → Tab inserts "Zendesk" (cased)
  type  #l        → menu offers lwlock  → Tab inserts it
Ordinary prose: typing identical to stock pi; no menu for common words;
Tab with no selection = literal Tab.
```

## Validation Loop

### Level 1: Fact-check (docs equivalent of lint)

```bash
# Every claim in the final README must be traceable:
grep -n "100" src/pi/provider.ts        # popup debounce
grep -n "300" src/pi/ingest.ts          # ingest debounce
grep -n "20_000\|STORE_CAP" src/core/store.ts
grep -rn "enablePhrases" src/ README.md # must read inert in M1
```

### Level 2: Markdown sanity

```bash
# Render check (any available): no broken heading levels, tables intact
npx --yes markdownlint-cli README.md || true   # informational
# Config table row count and columns unchanged from current README
```

### Level 3: Consistency with parallel/neighbor deliverables

```bash
grep -c "npm run bench" README.md   # exactly 1 (from P1.M4.T1.S2)
grep -n "scaffolding" README.md     # no matches
# package.json scripts referenced in README must exist:
node -e "console.log(Object.keys(require('./package.json').scripts))"
```

### Level 4: Definition-of-done readiness

- README stands alone for a newcomer: what/why/install/use/never-do.
- No unverified marketing claims; no future tense for shipped features.

## Final Validation Checklist

- [ ] README.md is the only modified file (`git status`)
- [ ] Hook paragraph + status "M1 (v1) — fully usable"
- [ ] 6 feature bullets, all verified against src/
- [ ] Quick start (3 install paths) + Usage happy path
- [ ] Architecture: core/pi split, ingest/query/popup with timings
- [ ] Invariants verbatim (4), limitations (3), non-goals present
- [ ] Configuration / Debug / Dictionary build / Development preserved
- [ ] Exactly one `npm run bench` mention; no "scaffolding" text
- [ ] `npm test` and `npm run check` still pass (docs-only change must not
      break anything)

## Anti-Patterns to Avoid

- ❌ Don't describe M2 features (phrases, chaining) as working
- ❌ Don't paraphrase the design invariants — verbatim only
- ❌ Don't delete verified Mode A content to "clean up"
- ❌ Don't invent commands or file paths — copy them from the repo
- ❌ Don't duplicate the bench line being added in parallel by P1.M4.T1.S2