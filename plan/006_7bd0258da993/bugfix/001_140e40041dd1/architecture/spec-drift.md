# Spec-drift reconciliation worklist — changeset 001_140e40041dd1

This report is the complete, actionable worklist for reconciling `spec/*.md`
with the code landed by bugfix changeset `001_140e40041dd1`. The changeset's
pipeline tasks ran Mode A (spec READ-ONLY — drift recorded, never applied);
this file gathers every recorded drift item, re-verifies each current-text
quote against the working tree, and hands the interactive session a
ready-to-apply edit list. Applying these four items discharges the AGENTS.md
obligation ("a change that ships code without the matching spec edit is
incomplete") in one sitting.

**Mode B note:** this report is itself the changeset's doc deliverable for
the spec half. The README half belongs to sibling task P2.M2.T2.S1 and is
deliberately NOT duplicated here (see the no-delta ledger).

## Governance basis

1. **AGENTS.md** (repo root), spec-maintenance policy: "interactive sessions
   MUST keep spec and code in agreement — a change that ships code without
   the matching spec edit (or vice versa) is incomplete; either order is fine
   so long as they land together. Pipeline/plan agents treat `spec/*.md` as
   read-only inputs and record drift in their reports."
2. **spec/SPEC.md**, "## Spec maintenance policy (binding)" (:13–29,
   re-measured at `b7c6cc2`; research recorded :14–27) — both bullets:
   interactive sessions MUST update the spec; implementation pipeline agents
   MUST NOT touch the spec.
3. **architecture/system_context.md**, "## Binding governance (drives task
   design)" (:62) item 1 — spec READ-ONLY for pipeline agents; drift is
   recorded, a later interactive session reconciles.
4. **architecture/repo-governance-and-conventions.md** §1 "Spec: invariants +
   maintenance policy" (:5) — the same policy, condensed.

## Method

- **Quote by section title, never by bare line number.** Commits `955de50` /
  `bb1e99b` landed concurrent spec/docs edits (`bb1e99b` touched spec/08,
  spec/09, and SPEC.md), and the tree keeps moving (the P2.M2.T1.S2 battery
  commit `b7c6cc2` landed after the research inputs were written; P2.M2.T2.S1's
  README sync is in flight). Line references below were re-measured at
  **`b7c6cc2`** (research inputs were verified at `c9097c6`); where they
  differ from the research files the current measurement is used and flagged.
- Every current-text quote below was re-verified byte-for-byte against the
  working tree at write time (the `rg -F` checks in the validation loop).
  If a quote fails to match when YOU read this, the spec moved again —
  re-quote from the current tree and still apply the item's substance.
- Primary input: `P2M2T2S2/research/drift-inputs-consolidated.md` (all four
  items + ledger, verified at `c9097c6`). Each item cites its own research
  source in its originating-subtask field.
- The tree sweep for post-research drift (Task 0 of this task) found **no
  additional items**: commit `b7c6cc2` touched only `test/provider-live.test.ts`,
  `test/provider-display.test.ts`, and plan artifacts; a grep of both battery
  files for "drift"/"P2.M2.T2.S2" returns nothing routed here.

---

## spec/04 — tokenization and scoring

### D-1 — Verbatim-path insertion outranks Shift-preserve  [DRAFT]

- File: `spec/04-tokenization-and-scoring.md`
- Section: "## Case handling" (:701–716 at `b7c6cc2`); the insertion-casing
  bullet (:705–715) — specifically the Shift-preserve sentence (:706–708) and
  the verbatim sentence (:713–714).
- Current text:

  ```markdown
  - **Insertion casing is resolved at completion time from the casing
    tallies.** When the typed fragment begins with an uppercase letter,
    the capitalized form wins — the user's Shift press is never
    overridden; only the first letter is adapted and the rest of the
    word comes from the winning form's spelling. When the fragment is
    typed all-lowercase, the form that occurred more often in the
    conversation wins (ties → lowercase; a word seen only capitalized
    completes capitalized). Words seen only in all caps complete
    verbatim in all caps; paths and technical literals always insert
    verbatim. Menu labels use the same resolution against the live
    fragment's first letter.
  ```

- Proposed text (DRAFT for the reconciling session — polish wording, not
  substance): replace the bullet's tail so the precedence is explicit. The
  Shift rule governs letters only; a leading `/`, `~`, or `.` is not a
  letter, so a candidate carrying a verbatim path display inserts its edges
  unchanged even under a capitalized fragment:

  ```diff
     completes capitalized). Words seen only in all caps complete
  -  verbatim in all caps; paths and technical literals always insert
  -  verbatim. Menu labels use the same resolution against the live
  -  fragment's first letter.
  +  verbatim in all caps; paths and technical literals always insert
  +  verbatim — and the verbatim-path rule outranks the Shift-preserve rule
  +  above: a candidate carrying a verbatim path display (04 rule 4d edges —
  +  leading `/`, `~`, `./`, `../`) inserts its edges unchanged even when the
  +  fragment begins with a capital; the Shift rule governs letters only, and
  +  a leading `/`, `~`, or `.` is not a letter. Menu labels use the same
  +  resolution against the live fragment's first letter.
  ```

- Code that depends on it: `src/core/query.ts` `resolveCompletionCasing` —
  the :404 first-line guard
  `if (c.pathDisplay !== undefined) return c.pathDisplay;` enforces
  path-display-first resolution regardless of the fragment's case; widened
  `Pick` type at :391–393 (adds `"pathDisplay"`); doc block :366.
- Originating subtask: P1.M2.T1.S2 (evidence:
  `P2M2T2S2/research/drift-inputs-consolidated.md` item 1; wording intent
  recorded in that subtask's PRP Goal item 3 and "Why" bullet citing
  spec/04 :713–714). NOTE: this clause SUPERSEDES the old battery reading
  "a typed capital capitalizes a path key" — that pin was flipped in
  `test/query.test.ts` (:201 comment records the superseded reading) by the
  same subtask. The item contract's "h2.32" label is a PRD-index ordinal;
  the actual section title is "## Case handling" — match on titles.

---

## spec/06 — candidate store

### D-2 — Candidate gains `pathDisplay`; upsert create branch seeds it sticky-first  [NEAR-FINAL]

- File: `spec/06-candidate-store.md`
- Section: "## M1: word candidates" (:3–37 at `b7c6cc2`; the `Candidate`
  interface :8–19 — re-measured; research recorded :8–21) with a sub-edit in
  "## Upsert semantics" (:53–66; the create-branch bullet :57).
- Current text:

  ```markdown
  interface Candidate {
    key: string            // lowercase
    capCount: number       // capitalized-tally sightings (04 normalization)
    lowerCount: number     // lowercase sightings
    capDisplay: string     // most frequent capitalized form (ties → most recent)
    sessionCount: number   // occurrences this session, both casings
    lastSeenOrdinal: number // message ordinal at last sighting
    firstSeenOrdinal: number
    userTyped: boolean     // sticky once true
    properName: boolean    // capitalized-initial seen at least once
    rankGroup: 0 | 1 | 2   // admission group (04)
  }
  ```

  and, under "## Upsert semantics" (:57):

  ```markdown
  - Absent → create entry (`sessionCount = 1`, ordinals = n, source flags set).
  ```

- Proposed text (near-final, based on `P1M2T1S1/research/spec06-drift.md` —
  adjust to taste, keep the semantics):

  (a) the interface gains the field:

  ```diff
     properName: boolean    // capitalized-initial seen at least once
     rankGroup: 0 | 1 | 2   // admission group (04)
  +  pathDisplay?: string   // verbatim edge-bearing display for path-class
  +                         // candidates (04 rule 4d: leading `/`, `~`, `./`,
  +                         // `../`); seeded sticky-first by the FIRST path
  +                         // sighting at the upsert create branch; the merge
  +                         // branch never writes it; absent ≡ the candidate
  +                         // never arrived as a path sighting; wins over
  +                         // capDisplay at resolution (both coexist on
  +                         // letter-initial paths that classify mid-cap)
   }
  ```

  (b) the create-branch bullet becomes:

  ```diff
  -- Absent → create entry (`sessionCount = 1`, ordinals = n, source flags set).
  +- Absent → create entry (`sessionCount = 1`, ordinals = n, source flags
  +  set). A path sighting (04 rule 4d shape: leading `/`, `~`, `./`, `../`)
  +  additionally seeds `pathDisplay` from that first sighting's display —
  +  sticky-first: later sightings never overwrite it, and the merge branch
  +  never writes it. A candidate that FIRST arrived as a non-path word
  +  keeps NO `pathDisplay` even when a later path sighting merges into it
  +  (create-only seeding keeps it deterministic) — such a candidate inserts
  +  bare.
  ```

  (c) OPEN NOTE for the reconciling session (do not silently resolve):
  "Sighting" appears NOWHERE in `spec/*.md` (verified `rg -n "Sighting" spec/`
  → 0 hits); it is a code-level type (`src/core/types.ts` :99, `Sighting.path`
  mirrors `CandidateDraft.path` and is what seeds `pathDisplay`). Placement
  decision is yours; recommendation: one sentence under "## M1: word
  candidates", not a new section.

- Code that depends on it: `src/core/types.ts` :43 `pathDisplay?: string` on
  `Candidate` (with the resolver-guard cross-reference comment) and :98–101
  the `Sighting.path` seeding doc; `src/core/store.ts` :407–409 the
  create-branch seeding
  `...(sighting.path ? { pathDisplay: sighting.display } : {})` (sticky-first:
  merge branch never writes it). Semantics of the field: verbatim
  edge-bearing display for path-class candidates; absent ≡ never arrived as
  a path sighting; wins over `capDisplay` at resolution.
- Originating subtask: P1.M2.T1.S1 (evidence:
  `P1M2T1S1/research/spec06-drift.md` — the near-final wording base — and
  `P1M2T1S1/research/notes.md`).

---

## spec/07 — completion UI

### D-3 — Visibility step 3: exception for the arming trailing space  [DRAFT]

- File: `spec/07-completion-ui.md`
- Section: "### Widget visibility state machine (auto-open, re-based)"
  (:323 at `b7c6cc2`), step 3 (:337–338 — re-measured; the research/contract
  recorded :336–337).
- Current text:

  ```markdown
  3. Trailing space with no `@`/`/` in text-before-cursor → hidden
     (close-on-space carried over as the widget's own state).
  ```

- Proposed text (DRAFT for the reconciling session — keep the step
  numbering; polish wording, not substance):

  ```diff
  -3. Trailing space with no `@`/`/` in text-before-cursor → hidden
  -   (close-on-space carried over as the widget's own state).
  +3. Trailing space with no `@`/`/` in text-before-cursor → hidden
  +   (close-on-space carried over as the widget's own state) — except when
  +   that space completes a typed word that arms a series chain (M2 armed(W)
  +   below): the zero-char successor offer paints at the space tick itself,
  +   before the user types anything (an intent-driven show in the spirit of
  +   step 6; every subsequent edit returns to steps 1–5).
  ```

- Code that depends on it: `src/pi/widget.ts` :787 the `zeroCharOffer`
  helper definition and :956–960 the arming-site paint (the comment there
  records this exact step-3 tension for this task). Governing requirement:
  "## M2: chained completion" (:690), the `armed(W)` successor offer
  (:698–705): "the successors of W immediately" (:700) … "before the user
  types anything" (:703–704). The unit pins took the M2-intent reading
  (`test/widget-visibility.test.ts`); the live-TTY run confirmed consistency
  (see Input (d) below).
- Originating subtask: P2.M1.T1.S1 (evidence: `P2M1T1S1/research/notes.md`;
  cross-checked against `P2M2T2S2/research/drift-inputs-consolidated.md`
  item 3).

### D-4 — Re-verify list grows a fifth bullet: no re-request after applyCompletion  [FINAL]

- File: `spec/07-completion-ui.md`
- Section: "### pi-tui contract dependencies (re-verify on upgrades)"
  (:596–613 at `b7c6cc2`; intro :598–603, the four bullets :605–612 —
  re-measured; research recorded :604–611).
- Current text:

  ```markdown
  Four runtime contracts are leaned on by the FALLBACK path (marked as
  PINs at their consumption sites in `src/pi/provider.ts`); none is
  enforced by types. The widget path leans instead on the editor-proxy
  composition rules (never mutate shared instances — the v1 crash
  lesson below) and its own render surface below the editor. On any
  pi-tui upgrade, re-verify each:

  - the single-item forced fast path (`force && explicitTab &&
    items.length === 1` applies the completion without opening a menu);
  - trigger-char branch shadowing (letters registered ⇒ the stock
    letter-continuation branch is unreachable);
  - one-query-per-word while the menu is closed (the word-start request
    is that word's only one — the startup gate exists because of it);
  - the editor's space-updates-open-menu flow (close-on-space depends on
    being consulted at trailing space).
  ```

- Proposed text (FINAL — copied byte-identically from
  `P2M2T2S2/research/spec07-h315-reverify-drift.md`; do NOT re-draft).
  Intro wording change:

  ```diff
  -Four runtime contracts are leaned on by the FALLBACK path (marked as
  +Five runtime contracts are leaned on by the FALLBACK path (marked as
  ```

  New fifth bullet (append to the re-verify list):

```markdown
- no autocomplete re-request after applyCompletion (all three apply
  sites in editor.js — menu-Tab accept (:545), select.confirm (:560),
  and the forced single-item fast path (:1906), verified against
  @earendil-works/pi-tui 0.84.4 — apply then cancel (the fast path:
  requestRender) and return; the fallback path's post-Tab extension
  offer and the zero-char chain offer therefore ride the NEXT
  keystroke's request, the degradation spec 07 accepts — PIN in
  src/pi/provider.ts applyCompletion);
```

  Application note (from the same research file): the PIN comment in
  `src/pi/provider.ts` (`applyCompletion` override, before the delegated
  `return current.applyCompletion(...)`) is the consumption-site mirror of
  this bullet and cites the same three dist sites + version + re-verify
  instruction. If a pi-tui upgrade changes any of the three sites (in
  particular, adds a post-apply `requestAutocomplete`), update BOTH this
  bullet and the PIN — the fallback offer timing and P2.M2.T1.S2's
  post-accept battery depend on it.

- Code that depends on it: the PIN comment in `src/pi/provider.ts`
  `applyCompletion` (≈:737–760; ":750 none of the three re-requests",
  ":755 any pi-tui upgrade…"), landed in commit `c9097c6` — the bullet and
  the PIN must move in lockstep.
- Originating subtask: P2.M2.T1.S1 (evidence:
  `P2M2T2S2/research/spec07-h315-reverify-drift.md`, FINAL wording, copied
  verbatim above).

---

## Input (d): live-TTY divergence sweep — verified empty

The live-TTY verification of BUG-003/BUG-004
(`architecture/live-tty-bug003-run-notes.md`, §Divergence log, :148–157)
produced ZERO divergences between the real stack and the unit harness —
nothing new to route into this report:

> **None.** The real stack matched the unit harness's prediction at every
> step, in both runs — including the exact tick the bug-hunt flagged as
> harness-maskable (the arming-tick paint landed in the live render frame,
> not a harness-only microtask). Nothing to route to P2.M2.T2.S2 from this
> item. (The spec-07 step-3 "trailing space → hidden" tension already
> recorded in test/widget-visibility.test.ts predates this run and remains
> P2.M2.T2.S2's — this run's evidence is consistent with the spec-07
> h2.53-intent reading the unit pins already took.)

The pre-existing step-3 tension that passage references IS item D-3 above;
the run's evidence supports the M2-intent reading D-3 encodes. Supporting
research: `P2M1T1S2/research/findings.md`.

## No-delta ledger

Determinations that something is NOT a drift item — recorded so the
reconciling session doesn't go hunting:

1. **BUG-001 (P1.M1.\*)** — restores already-spec-pinned behavior (spec/07
   "## M2: chained completion", spec/05): no spec delta. The e2e layers are
   test-only (evidence: `P1M1T2S2/research/notes.md`).
2. **BUG-002's user-visible behavior** (verbatim edge insertion) — already
   pinned by spec/04 rule 4d, integration item 7, and "## Case handling";
   the fix restored compliance. Only the internal-shape documentation
   drifted, which is exactly items D-1 and D-2 above.
3. **README** — sibling task P2.M2.T2.S1's deliverable, not spec. Per
   AGENTS.md / SPEC.md the README never overrides the spec; its sync is not
   a drift item here and must not be duplicated in this report.
4. **spec/08 / spec/09 / SPEC.md ranking wording** — reconciled by the
   concurrent commit `bb1e99b` itself; not this changeset's drift.

## Reconciliation instructions

1. **Apply in the interactive session ONLY** — mandatory per the AGENTS.md
   policy cited in the header. This report proposes; it never edits
   `spec/*.md` (Mode A inheritance).
2. **Re-verify each quote first.** Re-run the `rg -F` quote checks against
   the current tree before editing; if a quote no longer matches, the spec
   moved — re-quote from the current tree and still apply the item's
   substance. Match sections by TITLE, not line number.
3. **Apply D-1…D-4 in any order** (independent edits, four distinct
   regions). D-1 and D-3 are DRAFTS — the reconciling session may polish
   wording, not substance. D-2 is near-final. D-4 is FINAL — copy
   byte-identically.
4. **After applying:** `npm run check` && `npm test` — both must stay green
   (the specs' proposed texts document existing, tested behavior; nothing
   in them changes code).
5. **pi-tui upgrades (standing rule):** update the `src/pi/provider.ts`
   `applyCompletion` PIN (≈:737–760) and the h3.15 fifth bullet (D-4)
   together, in lockstep — the fallback offer timing and P2.M2.T1.S2's
   post-accept battery depend on both agreeing.
6. **Mode B closure:** once D-1…D-4 are applied, the changeset's spec
   obligations are discharged; the README half is P2.M2.T2.S1's. This
   report may then be archived with the changeset's plan artifacts.
