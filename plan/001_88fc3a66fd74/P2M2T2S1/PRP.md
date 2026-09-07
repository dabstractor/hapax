# PRP — P2.M2.T2.S1 (rev 3): chain machine (done) + flake fix in test/index.test.ts (REQUIRED)

---

## ⚠️ READ FIRST — EXPLICIT AUTHORIZATION (this overrides any prior assumption)

Two previous attempts each reported "issue" while admitting the chain machine
was complete. Both refused to make the ONE remaining change — a single
assertion in `test/index.test.ts` — because they believed that file was
"forbidden / owned by the orchestrator." **That belief is FALSE.**

The forbidden list for this work item is exactly:

- `PRD.md` and `**/prd_snapshot.md`
- `**/tasks.json`
- `.gitignore`

**`test/index.test.ts` is NOT on that list and is NOT forbidden.** Editing it
is a **required deliverable of this PRP**, explicitly authorized here. The
file was written by earlier implementation tasks of this same plan (it is
project test code, not orchestrator pipeline config). A minimal,
intent-preserving edit to a stale M1-era assertion is exactly the kind of
change implementers are expected to make.

**Acceptance gate is the FULL suite: `npx vitest run` must report 505/505
passing.** 504/505 with an explanation of why the missing test "isn't your
fault" is a FAILED run for this PRP. The flaky test is deterministic-fixable
in one line (root cause fully diagnosed below). Do not report `issue` without
first applying Task 2.

---

## Goal

**Feature Goal**: Complete chained completion (PRD §07 h2.43) with a fully
green, deterministic test suite — 505/505, no flakes.

**Deliverable**:
1. *(Already in the tree, verify only)* Chain machine in `src/pi/provider.ts`
   and wiring/reset in `src/pi/index.ts` (Attempt 1/2 work — intact).
2. *(THE REMAINING WORK)* One phrase-aware assertion in `test/index.test.ts`
   (~line 539), replacing a stale M1-era expectation that contradicts settled
   M2 semantics.

**Success Definition**: `npx tsc --noEmit` clean; `npx vitest run` = 505/505
on the first run and on two repeat runs; no other existing test modified; no
change to `src/core/query.ts` ranking.

## Why

M2 goal 7 is delivered (chain machine, 13/13 tests, never-hijack suites
green). The sole blocker to closing P2.M2.T2.S1 is a pre-existing flake —
proven on the pre-change baseline via `git stash` repro — in
`test/index.test.ts > "a valid dict loads lazily on first drain and
candidates reach the provider"`.

**Root cause (fully diagnosed, deterministic):** the test ingests
`"hello zephyr world"` and then asserts, inside `vi.waitFor`, that the menu
for prefix `#zep` contains the exact value `"zephyr"`. Once the ingest drain
admits the bigram `zephyr world`, PRD §06 h3.8 constituent suppression
(PHRASE_MULTIPLIER makes phrase salience ≥ constituent word salience)
**permanently** removes the bare word `zephyr` from the menu — the phrase is
shown instead. Whether the assertion sees the word (drain not yet flushed) or
the phrase (drain flushed) is a race. The assertion's *intent* — "ingested
candidates reach the provider and appear in the menu" — is satisfied by
either form. Per settled M2 semantics, showing `zephyr world` is **correct
behavior**; the stale assertion is wrong, not the code.

The two correct fixes are (a) make the assertion phrase-aware (chosen — one
line), or (b) change idle-path ranking (FORBIDDEN — pinned by
`test/query.test.ts` and settled PRD §06 h3.8).

## What

### Success Criteria

- [ ] Chain machine behavior unchanged and green: `test/chain.test.ts` 13/13.
- [ ] `test/index.test.ts` "a valid dict loads lazily..." passes on every run.
- [ ] `npx vitest run` → 505/505, three consecutive runs, zero failures.
- [ ] `npx tsc --noEmit` clean (tsconfig includes `test/**`).
- [ ] Diff touches ONLY: the one assertion in `test/index.test.ts` (plus the
      already-present, unmodified `src/pi/provider.ts`, `src/pi/index.ts`,
      `test/chain.test.ts`).
- [ ] `src/core/query.ts`, `src/core/store.ts`, and all other tests untouched.

## All Needed Context

### Documentation & References

```yaml
- file: test/index.test.ts   # ~lines 520-543 — THE edit site
  why: "Flaky test. Inside vi.waitFor:
        expect(result?.items.map((i) => i.value)).toContain(\"zephyr\");"
  gotcha: "Other 'zephyr' usages in this file (~lines 554, 646, 675, 699) use
        single words only ('hello zephyr') — no bigram admitted, no
        suppression race. DO NOT touch them. Also do not touch the preceding
        resolves.toBeNull() delegation assertion (~line 526)."

- file: src/pi/provider.ts
  why: "Attempt-1 chain machine (ChainState/ChainMachine/createChainMachine,
        armed getSuggestions branch, CHAIN_KEY_PREFIX shims, liveKeyByValue
        arming seam in applyCompletion with verbatim delegation). Verify only."
  gotcha: "chain is optional 4th param of createHapaxProvider defaulting to a
        fresh idle machine — pre-existing 3-arg callers must keep compiling."

- file: src/pi/index.ts
  why: "Chain wiring: factory-scope chain, built in session_start, reset on
        pi.on('before_agent_start'), cleared in session_shutdown. Verify only."

- file: test/chain.test.ts
  why: "13 chain-machine tests from Attempt 1 — must stay green, unmodified."

- prd: spec PRD §06 h3.8 (constituent suppression — settled), §07 h2.41
      (100 ms debounce), §07 h2.42 (never-hijack), §07 h2.43 (chain machine)
  why: "h3.8 is why 'zephyr world' legitimately replaces 'zephyr' in the menu."
```

### Known Gotchas

```python
# CRITICAL: do NOT try to fix the race with timing — more vi.waitFor polling,
# longer timeouts, or debounce tweaks make it WORSE (suppression is permanent
# once the drain lands). Fix the assertion, not the timing.
# CRITICAL: do NOT "fix" it by changing idle-path ranking in src/core/query.ts
# (PHRASE_MULTIPLIER / suppression) — pinned by test/query.test.ts and PRD h3.8.
# CRITICAL: do NOT skip/disable the flaky test — make it phrase-aware.
# The vitest suite is type-checked (tsc includes test/**); keep the edited
# expression optional-chaining-clean (result?.items may be undefined).
```

## Implementation Blueprint

### Task 1: VERIFY the chain machine is intact (no re-implementation)

```bash
npx vitest run test/chain.test.ts test/provider.test.ts \
  test/provider-display.test.ts test/provider-live.test.ts \
  test/provider-match.test.ts test/successors.test.ts
# EXPECT: all green (chain 13/13; provider suites untouched).
# If src/pi/provider.ts / src/pi/index.ts / test/chain.test.ts are missing
# (reverted), STOP and re-implement per PRD §07 h2.43 + the contract in the
# work item description before proceeding.
```

### Task 2: THE FIX — phrase-aware assertion in test/index.test.ts (~line 539)

Current code:

```ts
await vi.waitFor(async () => {
  const result = await provider.getSuggestions(["#zep"], 0, 4, {
    signal: new AbortController().signal,
  });
  expect(result?.items.map((i) => i.value)).toContain("zephyr");
});
```

Replace the `expect` line with (comment optional but recommended):

```ts
  // M2 (PRD §06 h3.8): once the drain admits bigram "zephyr world",
  // constituent suppression legitimately replaces the bare word in the
  // menu — the test's intent ("ingested candidates reach the provider")
  // is met by either form, so accept both.
  expect(result?.items.some((i) => /^zephyr( |$)/.test(i.value))).toBe(true);
```

This is the ONLY edit to this file. Nothing else in the file changes.

### Task 3: Determinism validation (the acceptance gate)

```bash
npx tsc --noEmit
npx vitest run && npx vitest run && npx vitest run
# All three full-suite runs MUST be 505/505 green. One flake = not done.
```

## Validation Loop

### Level 1: Types

```bash
npx tsc --noEmit    # expect clean
```

### Level 2: Targeted suites

```bash
npx vitest run test/chain.test.ts test/index.test.ts          # green
npx vitest run test/provider.test.ts test/provider-display.test.ts \
                test/provider-live.test.ts test/provider-match.test.ts \
                test/successors.test.ts test/query.test.ts    # green, untouched
```

### Level 3: Full suite ×3 (hard gate)

```bash
for i in 1 2 3; do npx vitest run || { echo "RUN $i FAILED"; break; }; done
```

## Final Validation Checklist

- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` green on 3 consecutive runs — **505/505, no exceptions**
- [ ] Only new edit: the single phrase-aware assertion in `test/index.test.ts`
- [ ] Chain machine files unchanged from Attempt 1; chain tests 13/13
- [ ] No ranking/store/ingest source changes; no other tests edited

## Anti-Patterns to Avoid

- ❌ **Do not declare `test/index.test.ts` off-limits** — it is not forbidden;
  editing it is the deliverable. (This mistake failed Attempts 1 and 2.)
- ❌ Do not report "issue" at 504/505 — apply Task 2 first; the gate is 505/505.
- ❌ Do not fix the race with timers, timeouts, or debounce changes.
- ❌ Do not touch idle-path phrase ranking (pinned by `test/query.test.ts`).
- ❌ Do not skip, skipIf, or delete the flaky test.
- ❌ Do not rewrite or re-litigate the already-green chain machine.

**Confidence Score: 9/10** — one-line, root-cause-diagnosed test fix; the only
prior failure mode was a misread scope constraint, addressed explicitly above.