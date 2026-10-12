# System context — bugfix changeset 001_140e40041dd1 (PRD bugs BUG-001..004)

Synthesis of the four research reports in this directory. Read those for file:line evidence.

## Repo state (verified at planning time)
- Branch `main`, HEAD `bb1e99b` ("docs: record validation run; fix its 8 minor findings"). Working tree
  CLEAN except staged plan artifacts. The concurrent doc edits noted in the PRD landed in commits
  `955de50`/`bb1e99b` — none touch the 4 bug areas (re-verified after landing).
- `npm run check` (tsc --noEmit, strict, no noUncheckedIndexedAccess) + `npm test` (vitest --run) both
  green at hunt time (40 files, 1286 passed / 1 skipped).

## PRD validation verdict
All four bugs CONFIRMED against the current tree:
- **BUG-001** `src/pi/index.ts:241-248` — the ONLY production `recordBigramRuns` feed projects runs to
  bare keys (`runs.map(r => r.map(m => m.key))`), so the store's both-members-`series===true` check
  (store.ts:≈745-756) never fires; provider.ts:604 / widget.ts:1021 arming gates, series-first
  ordering, run-casing display (`chainShim` nextDisplay), and /acwords markers are dead end-to-end.
  Store already accepts `RunMemberInput | string` (store.ts:735-744) — fix is the single seam.
  session_tree rebuild + history restore reuse the SAME pipeline instance → inherit the fix free.
  Test mirrors of the shim: successors.test.ts:68-70, adversarial-typing.test.ts:471-472,
  acceptance.test.ts:739-740 (makeChainPipeline), branch-purity.test.ts:309-310, bigrams.test.ts
  flood ≈238-240 (legacy-string coverage by design — keep one legacy arm), index.test.ts:462 pins the
  bare-key payload through the REAL factory (`toEqual([["alpha","beta","gamma"]])`). Direct enriched
  fabrications (legit, keep): widget.test.ts seedTheFedStore:2391-2406, bigrams.test.ts series
  describe.
- **BUG-002** single point of loss: `store.upsert` create branch (store.ts:398) discards
  `sighting.display` for casing "lower" (all edge-bearing paths classify lower). Drafts DO carry
  verbatim display (segment.ts:795-806, `display: token.raw`, `path: true`) but `Sighting` has no
  `path` field. `resolveCompletionCasing` (query.ts:386-408) frequency branch returns the trimmed
  key; provider (provider.ts:668-671) and widget insert (widget.ts:1390/1449) faithfully render
  MatchResult.display — fixing store+resolver fixes BOTH UIs with zero pi-layer changes.
  Recommended design (option a): `Sighting.path?: boolean` (types.ts) + ingest pass-through +
  `Candidate.pathDisplay?: string` seeded from `sighting.display` (sticky-first; field on record so
  eviction kills it; no serialization exists — reset+replay rebuilds it). Resolver: pre-branch guard
  `if (c.pathDisplay) return c.pathDisplay;` — verbatim ALWAYS (a leading `/~.` is not a letter;
  supersedes the current battery's Shift-capitalizes-path pin — update that pin). Tests to update:
  store.test.ts:209 no-display pin (extend with pathDisplay), query.test.ts:1576-1582 battery
  (extend with edge-bearing key). NOT test/paths.test.ts (dictionary resolution only).
  Corner: letter-initial paths can classify mid-cap → both capDisplay and pathDisplay present;
  pathDisplay wins (spec-consistent).
- **BUG-003** arming site widget.ts:984-1028 deliberately closes without painting ("never paint from
  the arming site" comment :1005-1007); the (a) zero-char offer (:889-906) answers only a later tick,
  and W1 microtask deferral (:1597-1607) means the next tick's buffer already has a letter → filtered
  offer. Minimal fix: factor (a)-body into `zeroCharOffer(word, now)` helper; at the arming site
  (after chain.arm + grant.reset, grant ticked before paint) call it; if painted, return WITHOUT
  closeWith; else fall through to closeWith. Hesitation gate R5 not violated (chain paints are
  intent — chainIntent bypass); no double-paint (sig-identical → idempotent); line claim arms via the
  paint itself (content-only change if already claimed). Spec 07 visibility step 3 (:336-337
  "trailing space → hidden") is the clause the fix outgrows → record drift (armed-exception wording),
  do NOT edit spec (see policy). Flip pins: widget-visibility.test.ts close-on-space typed-arming
  visibility case + widget.test.ts typed-arming battery. NOTE: shipped code already contains an
  UNRELATED "BUG-003" label (2026-10 start-0 suppression fix) — don't conflate names in commits.
- **BUG-004** pi-tui editor.js evidence: menu-accept Tab ≈:538-552 (calls cancelAutocomplete) and
  forced fast path ≈:1895-1906 (does NOT call it — correction to PRD's "both call cancelAutocomplete";
  the load-bearing shared fact is: NEITHER re-requests after apply). PIN home: provider.ts
  applyCompletion override :679-735, matching the existing PIN style at ≈:313-331 (cite version,
  call sites, re-verify instruction). Battery: provider-live.test.ts / chaining-gating.test.ts
  request-by-request shape (accept via real applyCompletion → no self-request → next getSuggestions
  at post-apply cursor returns the offer; display-level no-emission pin in provider-display.test.ts
  style). Widget-path h3.11 battery pattern: widget.test.ts ≈:2556.

## Binding governance (drives task design)
1. **spec/*.md is READ-ONLY for pipeline implementation agents** (spec/SPEC.md:14-27). Interactive
   sessions reconcile later. → The PRD's "mirror the PIN in spec 07 h3.15" and BUG-003's step-3
   exception become **drift records** compiled in the final docs task (spec-drift.md), NOT spec edits.
   Bugs 001/002 restore existing spec-pinned behavior — no spec change needed at all.
2. **README.md is editable** (not spec/) — has a post-delta-note precedent (:22-30); series-chaining
   (:126, :177-235), path-completion, and widget/fallback sections are the change surface.
3. **Live TTY verification is binding for UI-layer changes** (spec/09 "Live verification technique"):
   `pi --no-session` in tmux, `tmux send-keys` one char at a time (0.08–0.12 s sleeps — bursts cancel
   queries), `capture-pane` asserts. Applies to BUG-001 (widget arming goes live) and BUG-003.
4. Design invariants (never hijack typing; Tab-only completion; no zero-candidate menu; RAM-only) —
   none of the fixes may touch them; all four preserve them by construction.
5. TDD implied per subtask; `npm run check` + `npm test` green before commit.

## Key entry points for implementers
- Production factory: `export default hapax(pi)` src/pi/index.ts:166; handlers session_start (:211),
  session_tree (:408), message_end (:489), session_shutdown (:496), before_agent_start (:513).
- Production-seam test harness: test/index.test.ts — fakePi (:88), fakeCtx (:110, pass
  `editorFactory` for the widget branch), currentFake (:155), startSession/endMessage (:169/:177),
  dump/wordsSeenIn (:194/:203), settle() 420 ms (:205), temp-HOME isolation (:207), useDict/writeConfig (:220/:249).
- Widget typing harness: makeInsertHarness + typeChar (widget.test.ts:≈860/2000-2008); machine
  level: fakeEditor + machine.onInput() (widget-visibility.test.ts:59-100).
- Prior-plan contracts: P1.M1.T2.S2 (store series fields — Complete), P1.M2.T2.S1 (fallback arming —
  Complete), P1.M2.T2.S2 (widget arming — tasks.json says "Ready"; PRD says Complete; code+tests
  exist, the production wire is what's missing), P4.M1.T2.S1 (PIN+battery — marked Complete, PIN
  deliverable absent; this changeset completes it).
