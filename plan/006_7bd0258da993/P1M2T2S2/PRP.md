---
name: "P1.M2.T2.S2 (plan 006, REV 2 — re-plan after issue) — Widget path series-first offers + typed arming; deliver verification + hermetic acceptance probe"
---

## Goal

**Feature Goal** (unchanged from REV 1): Mirror spec §07 h2.53's series rules on the WIDGET path: (1) the armed zero-char word-start offer composes **series successors first (count desc, `Successor.nextDisplay` run casing) then ordinary successors (count desc)** as ONE item set at the `succ.map(chainShim)` composition site; (2) typed-word arming at the widget's close-on-space site: an uppercase-first-letter word closed by space, whose lowercase key has successors (direct `topSuccessors` consult — chain-only members arm), arms the chain; lowercase never arms. Typed capital first letter preserved on insert; lowercase typing inserts verbatim; first-char anchor case-insensitive once typing.

**Deliverable** (REV 2 — two work packages):
- **WP-A**: `src/pi/widget.ts` series-aware chain path + batteries in `test/widget.test.ts` / `test/widget-visibility.test.ts`. **ALREADY DELIVERED AND COMMITTED** at `95b1727` ("feat(pi): widget path series offers + typed arming") — verified present in the current worktree (chainShim series branch :664–684, series-first composition comment :891–897, `const items = succ.map(chainShim)` :932, typed-arming seam :984). WP-A is a **VERIFY-OR-REBUILD** pass, not a redo.
- **WP-B (NEW — the issue remediation)**: make the network-gated acceptance probe `test/acceptance.test.ts > … > "pi -p -e loads the real extension and answers cleanly"` hermetic by adding `-ne` (`--no-extensions`) to its spawn args. This is the fix for the environmental failure that blocked attempt 1.

**Success Definition**: All widget/chain batteries green; `npm run check` zero errors; **full `npm test` green INCLUDING the formerly-failing acceptance probe** (verified working via the `-ne` spawn, 2026-10-09 session, exit 0 + model answered + clean stderr); uncommitted sibling-task work in the tree preserved untouched. Unit tests are necessary, NOT sufficient — live TTY verification is BINDING and happens in P3.M1.T2.S3 (spec/09 technique).

## Re-Planning Context (attempt 1 issue — READ FIRST)

Attempt 1 (identical PRP, md5 22d91946af48d1a7c1f17c0a85229b4d) implemented and validated EVERYTHING in WP-A: 151/151 widget-suite tests green, `npm run check` clean, 1251 passed / 0 failed across the suite excluding one file. The single failure was **environmental, outside the feature's code, and still reproduces today** (re-verified this session: exit 1 in ~2 s — crash-on-load, not network):

- **Root cause**: the probe spawns bare `pi` from PATH; under the vitest worker PATH that resolves to the **repo-pinned runtime** (`node_modules/.bin/pi` → `@earendil-works/pi-coding-agent` ~0.84.4, per package.json). That runtime **discovers and loads the user's GLOBAL extensions from `~/.pi/agent`**, where the mid-session-updated `pi-subagents` extension calls `_piAi.toToolDeclaration` — an API absent in 0.84.x — crashing the subprocess (exit 1, stderr names pi-subagents; hapax never implicated). The same command against the global pi 1.0.2 exits 0.
- **Verified remediation (2026-10-09)**: pi 0.84.4 `--help` documents `--no-extensions, -ne  Disable extension discovery (explicit -e paths still work)`. Confirmed live:
  `node_modules/.bin/pi -p -ne -e "$PWD" --no-builtin-tools "say Zendesk lwlock" </dev/null` → **exit 0, model answered, empty stderr**. hapax still loads via the explicit `-e process.cwd()`; global discovery (the crash surface) is structurally disabled; auth/models still resolve from the default config dir.
- **Rejected alternatives**: (a) `PI_CODING_AGENT_DIR=<temp>` — isolates the whole config dir, but `auth.json`/`models.json` live there; without credentials the run dies on a no-provider error that does NOT match the probe's environmental-skip regex (assertion messages never reach the catch), i.e. it converts an environmental failure into a hard one. (b) pointing PATH at the global pi 1.0.2 — un-tests the repo-pinned runtime the probe exists to exercise. (c) bumping the pinned devDependency / editing `~/.pi/agent` — outside this repo's scope (orchestrator/human decisions).
- **Why this is in-scope now**: the previous agent's permitted scope (`src/` + `test/`) includes `test/acceptance.test.ts`; a one-flag spawn change is test-infra hardening that makes the probe machine-independent (no dependence on any developer's personal global extension set) without weakening a single assertion.

## Why

- Spec h2.53: chaining arms "by acceptance **or by typing** of a series member"; the offer lists "series successors first (count descending among them), then ordinary successors (count descending)". P1.M2.T2.S1 landed these rules on the fallback provider; this task is the widget half of "both display paths series-aware — R2 complete".
- The acceptance probe must stop failing on machines whose global pi extensions outdate the pinned runtime — otherwise every subsequent task's full-suite gate inherits this blocker.

## What

### Work Package A — VERIFY (rebuild only if missing) the widget series path

All in `src/pi/widget.ts` (mirror S1's landed provider.ts semantics exactly — keep the logic widget-local, no shared-module refactor). **Current worktree already satisfies all of this** (commit `95b1727`; markers grep-verified at :664/:681/:891/:932/:984):

1. **chainShim series casing** (~:664–690): series items (`s.series && s.nextDisplay`) display AND insert their run casing via `s.nextDisplay`; ordinary successors fall back to the interim `capDisplay` form (S1-landed). KEEP invariants verbatim: plain `key = s.next` (Tab-insert re-arm reads `painted()`), **tier deliberately omitted** (`undefined` arms the `rec.tier !== 0` gate — never set `tier: 0`), `salience: -s.count` / `sessionCount: s.count`, no re-sort. `Candidate.display` is GONE (P1.M2.T1.S2) — never read `.display`.
2. **Series-first zero-char composition** (~:885–935): the store's `successorBefore`/`topSuccessors` ordering (P1.M1.T2.S2 series-first top-3 retention) already emits series-first — pass through untouched; the `maxSuggestions` cap applies to the COMBINED list (a narrow cap trims the tail, never dislodges a series head). One items set; the chain branch still either paints or falls through to the normal query() path — no mixing with the ambient query.
3. **Typed-fragment branch**: unchanged membership filter (exact-equal exclusion, `matchFragment` gate, threshold 0, word-start guard); once typing, first-char anchor case-insensitive; Tab-insert preserves a typed capital first letter / inserts lowercase-typed offers verbatim (S1's landed resolver semantics — do not fork).
4. **Typed-word arming at close-on-space** (~:980+, the trailing-space-with-no-`@`/`/` flavor inside the `match === null` branch, BEFORE `closeWith(now)`): gates in order — word regex `/([A-Za-z][A-Za-z0-9_-]*)[ \t]$/` matches; first letter uppercase (and `!==` its lowercase — excludes non-letters); `topSuccessors(word.toLowerCase())` non-empty (direct consult → chain-only members arm); chaining enabled; chain idle. On pass: `chain.arm(key)` + one-shot grant reset (mirroring the Tab-insert arm site) — then STILL `closeWith(now)` (arm-and-close; the offer materializes at the NEXT word-start tick, never from the arming tick). Lowercase never arms; uppercase-no-successors never arms; plain no-fragment closes and cursor-move closes never arm.
5. **Fences (unchanged)**: Tab-insert arming, trigger-char arming, one-shot grant, `before_agent_start` reset, exact-equal exclusion, suppression-lapse semantics, line-claim blank-row rendering, chain-intent hesitation bypass, never-zero-candidates. **Tab-deferral rule (07 h3.10, now-normative)**: Tab while `isShowingAutocomplete() === true` forwards verbatim — MUST NOT regress. **No Tab-accept suppression anywhere** (07 h3.11, P4): Tab-accept no longer arms rest-of-word suppression; chain ARMING on Tab-insert is unchanged.
6. **JSDoc (Mode A)**: on the chainShim series branch and the typed-arming seam, citing 07 h2.53 (idle transition: uppercase first letter + direct successor consult + lowercase-never-arms rationale) and h3.10/h3.11 where adjacent — already present; verify.

### Work Package B — hermetic acceptance probe (THE fix)

`test/acceptance.test.ts`, the `runPi()` helper's `spawn` call (bottom describe "acceptance — real extension loads under pi -p -e (network-gated)", assertion at :649):

```typescript
const child = spawn(
  "pi",
  // -ne (0.84.4: "Disable extension discovery (explicit -e paths still
  // work)") keeps the probe HERMETIC: without it the spawned pi loads the
  // user's GLOBAL extensions from ~/.pi/agent, and any global extension
  // built against a newer pi API (2026-10 live case: pi-subagents calling
  // _piAi.toToolDeclaration, absent in the pinned 0.84.x) crashes the
  // subprocess before hapax runs. hapax itself still loads via -e below.
  ["-p", "-ne", "-e", process.cwd(), "--no-builtin-tools", "say Zendesk lwlock"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
```

- **Touch NOTHING else in the file**: assertions (`code === 0`, non-empty stdout, stderr not `/hapax/i`) and the environmental-skip catch/regex stay exactly as-is (offline/unauthenticated machines still SKIP, never fail).
- Do not isolate via `PI_CODING_AGENT_DIR` (loses `auth.json` → hard-fails past the skip regex — see Re-Planning Context).

## Success Criteria

- [ ] WP-A markers present and batteries green: `The ` arms → next word-start offers top `Fed` (run casing, series-first); typed-through disarm + acceptance re-arm; lowercase `the ` / uppercase-no-successors / already-armed never arm; chain-only member arms via direct consult; cap trims ordinary tail before any series head; exact-equal exclusion intact; Tab-deferral pin green; no Tab-accept suppression
- [ ] WP-B: `npx vitest --run test/acceptance.test.ts` → **27/27 green** (was 26 pass + 1 fail); the probe asserts exit 0 with the model answering under the repo-pinned runtime
- [ ] `npm run check` zero errors; `npm test` FULL suite green (no exclusions)
- [ ] Uncommitted sibling-task work (P4-flavored widget.ts/widget.test.ts diffs — post-Tab extension offer / T3 seam) preserved as found

## All Needed Context

### Context Completeness Check

An implementer needs: the current-tree status (what is done vs. to-do), the exact WP-B spawn site, the widget chain-block anchors, S1's landed provider twin, the Successor contract, and the test conventions. All below.

### Documentation & References

```yaml
- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/environment-variables.md
  why: PI_CODING_AGENT_DIR semantics (config-dir override) — documented here
        to justify REJECTING it (auth.json lives in the config dir).
  critical: isolation via config-dir loses credentials; -ne is the scoped tool.

- file: test/acceptance.test.ts
  why: WP-B target. runPi() spawn at the bottom describe (assertion :649);
        header comment states the probe proves "jiti load + clean run only" —
        -ne preserves exactly that while removing machine-dependent global
        extension loading.
  pattern: spawn("pi", [...args], { stdio: ["ignore","pipe","pipe"] });
        environmental failures route to ctx.skip() ONLY from the catch block
        (spawn errors/timeouts) — assertion failures always fail.
  gotcha: never weaken assertions or the skip regex to "fix" this.

- file: src/pi/widget.ts  (1820+ lines; carries BOTH committed 95b1727 work
        AND uncommitted P4.M1.T1.S1-flavored sibling work — do not revert)
  why: WP-A file. Verified anchors: chainShim :664-690 (series branch
        :681-684, tier-omission invariant); series-first composition comment
        :891-897; `const items = succ.map(chainShim)` :932; typed-arming
        seam :984+; close-on-space inside `match === null` (R3 taxonomy).
  pattern: state-machine evaluate() with R-numbered rule comments; paint()
           is the single publish seam; closeWith stamps closeAt.
  gotcha: the match===null branch covers BOTH trailing-space and
          plain-no-fragment closes — arming belongs ONLY to the
          trailing-space-with-no-@// flavor.

- file: plan/006_7bd0258da993/P1M2T2S1/PRP.md
  why: the fallback twin's contract — the exact rule set mirrored here.
        Read S1's landed src/pi/provider.ts before any rebuild.

- file: plan/006_7bd0258da993/architecture/02-store-query-r1-r2.md
  why: Successor.series/nextDisplay contract + series-first top-3 retention
        in topSuccessors (why the widget passes store ordering through).

- file: plan/006_7bd0258da993/architecture/03-pi-surfaces-r2-r3-r4.md
  why: widget chain-surface line map + armGate seam (R2).

- file: test/widget.test.ts + test/widget-visibility.test.ts
  why: WP-A suites (already extended by 95b1727 + the uncommitted battery).
        Conventions: fake timers, simulated keystroke/evaluate ticks,
        state()/painted() assertions.

- file: src/pi/provider.ts (S1's landed version)
  why: reference implementation of the same rules — mirror, don't fork.
  gotcha: the widget's publish seam is paint()/state(), not publishChain.
```

### Current Codebase tree (relevant)

```bash
src/pi/widget.ts                # WP-A: committed (95b1727) + uncommitted P4 sibling work — VERIFY, don't redo
test/widget.test.ts             # WP-A battery: committed + uncommitted additions — VERIFY
test/widget-visibility.test.ts  # WP-A interplay cases — VERIFY
test/acceptance.test.ts         # WP-B: the ONLY file to MODIFY this revision
```

### Known Gotchas of our Codebase & Library Quirks

```typescript
// TIER-OMISSION IS LOAD-BEARING: chainShim sets NO tier — the arming gate
// is `rec.tier !== 0`, and undefined arms. Never set tier on the shim.

// ONE ITEMS SET, ONE PAINT: chain items never merge with the ambient
// query set; series-first means series successors BEFORE ordinary
// successors WITHIN the chain offer.

// CAP ORDER: cap applies to the combined series→ordinary list.

// ARM ON CLOSE, OFFER NEXT TICK: the arming seam closes the line; the
// zero-char offer appears on the NEXT word-start evaluate tick.

// NO TAB-ACCEPT SUPPRESSION (07 h3.11): do not add suppression anywhere
// on this path; chain ARMING on Tab-insert is untouched. The worktree's
// uncommitted P4 seam changes already implement h3.10/h3.11 — build on
// them, never revert them.

// TAB-DEFERRAL PIN (h3.10): isShowingAutocomplete() → forward verbatim;
// its regression test must stay green.

// Candidate.display IS GONE (P1.M2.T1.S2): capDisplay/nextDisplay only.

// WP-B BLAST RADIUS: one flag in one spawn call. The probe is
// network-gated by design (ctx.skip on environmental spawn errors) —
// that behavior is correct and stays.
```

## Implementation Blueprint

### Implementation Tasks (ordered by dependencies)

```yaml
Task 0: READ this PRP's Re-Planning Context + git state
  - git log --oneline -3 (95b1727 = WP-A commit); git status --short
  - Understand: the P4-flavored UNCOMMITTED diffs in src/pi/widget.ts +
    test/widget.test.ts belong to a SIBLING task — preserve verbatim.

Task 1: VERIFY WP-A markers (rebuild ONLY if absent, per "What" WP-A 1-6)
  - grep -n 'chainShim\|nextDisplay\|SERIES FIRST\|TYPED-WORD ARMING' src/pi/widget.ts
  - Expect :664-690 series casing, :891-897 composition, :932 map site,
    :984+ arming seam, 07 h2.53 JSDoc citations.

Task 2: WP-B — MODIFY test/acceptance.test.ts (the ONLY edit if Task 1 passes)
  - Insert "-ne" into runPi()'s spawn args + the explanatory comment
    (exact text in "What" WP-B). Nothing else in the file changes.

Task 3: VALIDATE (all must be green)
  - npm run check
  - npx vitest --run test/widget.test.ts test/widget-visibility.test.ts
  - npx vitest --run test/acceptance.test.ts     # 27/27 — the WP-B proof
  - npm test                                      # FULL suite, no exclusions
  - Manual evidence capture (record output in the report):
    node_modules/.bin/pi -p -ne -e "$PWD" --no-builtin-tools \
      "say Zendesk lwlock" </dev/null; echo "exit=$?"
    # Expect exit=0, a model answer, empty stderr (verified 2026-10-09).
```

### Implementation pattern

WP-B is the only code sketch needed (see "What" — copy the spawn verbatim). For a WP-A rebuild, follow S1's landed `src/pi/provider.ts` chain branch and the anchors above; the typed-arming sketch:

```typescript
// Inside the close-on-space flavor, before closeWith(now):
const m = before.match(/([A-Za-z][A-Za-z0-9_-]*)[ \t]$/);
if (m && m[1]![0] === m[1]![0].toUpperCase() && m[1]![0] !== m[1]![0].toLowerCase()) {
  const key = m[1]!.toLowerCase();
  if (/* chaining enabled && chain idle */ deps.store.topSuccessors(key).length > 0) {
    // 07 h2.53 idle transition: uppercase-first typed word + direct
    // successor consult (series included → chain-only members arm);
    // lowercase never arms. Arm and STILL close — the offer comes at the
    // next word-start tick.
    chain.arm(key); /* + grant reset, mirroring the Tab-insert arm site */
  }
}
closeWith(now);
```

### Integration Points

```yaml
NONE beyond WP-B's one spawn call:
  - Widget-internal work is committed; store/provider/chain APIs unchanged.
  - Downstream (do NOT implement): P3.M1.T2.S3 live TTY verification
    (BINDING); P3.M1.T2.S1 README sweep; /acwords already updated (a618343).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests (component)

```bash
npx vitest --run test/widget.test.ts test/widget-visibility.test.ts   # chain + visibility batteries
npx vitest --run test/acceptance.test.ts                              # WP-B: 27/27 green
```

### Level 3: Full Suite + Manual Probe

```bash
npm test    # FULL suite green — the acceptance probe included, no exclusions
node_modules/.bin/pi -p -ne -e "$PWD" --no-builtin-tools "say Zendesk lwlock" </dev/null
# exit=0, model answers, stderr clean (hapax loaded via -e under the pinned runtime)
```

### Level 4: Live TTY

BINDING but NOT this task — P3.M1.T2.S3 executes it (spec/09 technique). Record in the task report that unit coverage is provisional pending that pass.

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` zero errors
- [ ] `npm test` FULL suite green (acceptance probe included — the attempt-1 blocker is closed)
- [ ] Manual `-ne` probe: exit 0, answered, clean stderr (output recorded)

### Feature Validation

- [ ] WP-A verified present & green: series-first zero-char offers (count desc, `nextDisplay` run casing), combined-list cap, `The ` typed-arming with all refusal gates, chain-only member arming, typed-through disarm + re-arm, exact-equal exclusion
- [ ] Tab-deferral (h3.10) pin green; no Tab-accept suppression (h3.11)
- [ ] Sibling P4 work in the worktree preserved as found

### Code Quality Validation

- [ ] WP-B change is exactly one flag + comment in `runPi()`; no assertion/skip-regex weakening
- [ ] JSDoc (Mode A) citing 07 h2.53 still on the chainShim series branch + arming seam

## Anti-Patterns to Avoid

- ❌ Don't re-implement or revert the committed WP-A work — verify first; rebuild only verified-missing pieces
- ❌ Don't revert/normalize the uncommitted P4-flavored diffs in widget.ts/widget.test.ts — sibling task property
- ❌ Don't "fix" the probe by weakening assertions, widening the skip regex, skipping/deleting the test, or pointing PATH at the global pi
- ❌ Don't isolate via PI_CODING_AGENT_DIR (loses auth.json → hard-fails past the skip regex)
- ❌ Don't set `tier` on chainShim, re-sort topSuccessors output, or merge chain items with the ambient query
- ❌ Don't paint from the arming site — arm-and-close; the next tick offers
- ❌ Don't arm on plain no-fragment or cursor-move closes — trailing-space flavor only
- ❌ Don't read `.display` off a store candidate — gone; capDisplay/nextDisplay only
- ❌ Don't treat unit tests as sufficient — live TTY is binding (P3.M1.T2.S3)
