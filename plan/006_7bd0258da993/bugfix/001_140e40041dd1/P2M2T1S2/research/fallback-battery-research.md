# P2.M2.T1.S2 research — fallback-path post-accept battery (provider + display)

Primary evidence file: `../../architecture/bug003-004-widget-provider.md` §2.4 (harness survey
+ recommended battery shape). This note adds facts verified directly in the tree during this
session (2026-04 session; files as of this research).

## Verified signatures / line anchors (re-verify before writing — tree moves)

- `src/pi/provider.ts`
  - `createHapaxProvider(store, cfg, current, chain?)` — 4th param injects a `ChainMachine`
    (Probe C / widget pattern). Without it the provider creates its own.
  - Armed branch: ≈:378–549. (a) zero-char offer at word start (before === "" or /[ \t]$/)
    → `publishChain(topSuccessors(armed.word), "")`; (b) typed fragment at a word start →
    membership-filtered successors at chain threshold 0; (c) disqualify (incl. zero matching
    successors) → `chain.reset()` + fall through to the normal path on the SAME keystroke.
  - Grant tick ≈:404: `grant.tick(curArmedPrefix)` disarms only on "typed through to a NEW
    word"; the FIRST armed answer of an arming counts as the granted word (returns false).
  - applyCompletion override: :678–736. Arming: `liveKeyByValue.get(item.value)` →
    CHAIN_KEY_PREFIX key → `chain.arm(next)`; single token → tier≠0 → `chain.arm(key)`;
    each arm site calls `grant.reset()`. Delegates verbatim at :736.
  - `CHAIN_KEY_PREFIX = "\u0000chain:"` at ≈:759 (module-private; the literal is assertable).
  - `__hapaxLive: () => lastLive`, `__hapaxKey: (v) => liveKeyByValue.get(v)` at :743–744.
  - Zero-candidate hapax query clears `lastLive`/`liveKeyByValue` and delegates (pinned in
    provider-live.test.ts "zero candidates clear the live cache first").
- `src/pi/chain-grant.ts` (90 lines): `tick(cur)` returns true only when the grant is spent
  (second word reached); `reset()` = fresh grant. **The provider's tracker is created
  internally at provider.ts:282 — NOT injectable.** "grant reset exactly once per arm" is
  therefore pinned observably (arm-call sequence + one granted word-start offer), not by
  counting reset() calls. vi.mock'ing the module is NOT repo style — avoid.
- `src/core/store.ts:747`: `recordBigramRuns(runs: readonly (readonly (RunMemberInput |
  string)[])[], )` — accepts BOTH the enriched payload and bare `string[][]` runs.
  `store.recordBigramRuns([["implement", "policy"]])` seeds an ordinary successor.
- `src/pi/provider.ts:1034+` `createDisplayProvider`: its own `applyCompletion` (:1262–1268)
  forwards to `base.applyCompletion` AND sets `applyRanSincePaint` (:1054) so the NEXT
  qualifying result paints immediately (4c-exception; pinned at provider-display.test.ts:241).

## Verified behavior walk (source-derived; the battery asserts these)

Ladder store implement/implements/implementation, equal sessionCounts (×2, same ordinal band)
so §04 h2.29 ties fall to shortest-first:

1. `getSuggestions(["implem"], 0, 6, {signal, force:false})` → hapax-owned (no delegation);
   plural pruning → pre-Tab set `[implement, implementation]` (widget battery :2592 comment);
   top item `implement`, prefix `implem`, anchor-safe.
2. `applyCompletion(["implem"], 0, 6, {value:"implement"}, "implem")` → arms
   `chain.arm("implement")` + grant.reset() → delegates; `editingCurrent` visibly splices to
   `["implement"]`, col 9. `__hapaxLive()` UNCHANGED by the apply (no republish — nothing
   self-requests).
3. Next explicit request `(["implement"], 0, 9)` → armed branch: tick("implement") = first
   armed answer (false) → (b) `topSuccessors("implement")` = [] in ladder-only store →
   (c) `chain.reset()` → normal path → exact-equal exclusion → extension offer
   `{items:[implements, implementation], prefix:"implement"}`, anchor-safe; live cache
   republished; `__hapaxKey("implements") === "implements"`.
4. Two-rung: accept `implements` (prefix "implement") → arm `implements`; buffer
   `["implements"]`, col 10. Next request → (c) reset → rankMatches("implements") = []
   ("implementation" does not extend it) → null + delegation → **disqualification close,
   nothing suppresses**. Recovery: one backspace → (["implement"],0,9) re-renders the
   extension offer — proves no rest-of-word suppression armed (h3.11 unconditional).
5. Zero-char leg (companion store + seeded successors): after arm at "implement", request at
   `["implement "], 0, 10` → (a) `publishChain(topSuccessors("implement"), "")` → prefix "",
   values in successor display casing, `__hapaxKey(value)` = `"\u0000chain:"+key`.

## Harness idioms (copy sources)

- `editingCurrent(initial, cursorCol)` — test/chaining-gating.test.ts:85–112 (persistent
  buffer, visible-splice applyCompletion). NOT yet in provider-live.test.ts — add locally.
- `suggest(p, lines, line, col)` one-request helper — chaining-gating.test.ts:114–120.
- sighting/put/cfg/opts/mockCurrent — provider-live.test.ts:24–90 (duplicated per-suite by
  convention; provider-display.test.ts has its own copies).
- Display harness + emissions-as-value-lists + fake timers (clock 0) —
  provider-display.test.ts:1–160; `wrapper.applyCompletion` use at :241–270.
- Widget h3.11 battery (the analog being mirrored) — test/widget.test.ts:2537–2652.
- `editorApplyCompletion` / `prefixIsAnchorSafe` — test/helpers/editor-sim.ts (63 lines).
- Recording chain double — widget.test.ts:1428 `spiedChain`; hybrid (delegating spy over a
  REAL machine) gives both arm-call recording and live `state()`.

## Decisions

- Battery homes: append describes to test/provider-live.test.ts (provider+chain legs) and
  test/provider-display.test.ts (display companion) — matches the widget-battery precedent
  (battery as a named describe inside the domain suite) and the per-suite helper duplication.
- Test-only item: no src/ changes. If an assertion fails against real behavior, STOP and
  report (production fixes are other items' scope).
- Banner (Mode A): cite spec/07 h3.11 fallback paragraph (spec/07-completion-ui.md:316–321)
  + the P2.M2.T1.S1 PIN location (provider.ts applyCompletion override). Soft dependency:
  battery must not fail if the PIN comment hasn't landed yet — cite the spec paragraph as
  authoritative.
