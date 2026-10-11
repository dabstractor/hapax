# PRP — P4.M1.T2.S1: Provider seam change + re-request verification + PIN + battery (spec 07 h3.11, fallback path)

---

## Goal

**Feature Goal**: Implement spec 07 h3.11's fallback-path paragraph: a Tab-accept
(`applyCompletion` accept) NEVER arms suppression on the provider path —
unconditionally, independent of whether any offer ever renders — and the post-Tab
extension offer rides the same post-applyCompletion re-request the zero-char chain
offer depends on, which must be VERIFIED against real pi-tui and PINNED (verified
state: pi-tui 0.84.4 does NOT re-request → the path degrades to no re-offer;
document the degradation at the consumption site).

**Deliverable**: (1) Mode A JSDoc on the acceptance-handling sites in
`src/pi/provider.ts` (base `applyCompletion`'s arming side-effect block + the
display machine's 4c-exception / `completionSincePaint` site) stating the h3.11
rule; (2) the new PIN comment at the would-be consumption site (the armed branch's
fragment arm) citing spec 07 h3.11 + h3.15 with the verified 0.84.4 evidence and
the degradation note; (3) a fifth bullet in spec 07 h3.15's re-verify list (spec
edit lands with the code — AGENTS.md maintenance policy); (4) a provider battery in
`test/provider.test.ts` (post-accept no-suppression for forced AND unforced
requests, offer content when the re-request is simulated, zero-candidate
delegation, preservation pins); (5) a NEW real-Editor contract test
`test/fallback-post-tab.contract.test.ts` (harness pattern of
`test/defer-pi-menu.repro.test.ts`) that verifies and pins the re-request
contract's verified ABSENCE. NO behavioral production-code change is expected —
see "What" for why this is a guarantee-and-pin item, not a mechanism change.

**Success Definition**: After a Tab-accept on the provider path, every subsequent
query — forced (Tab-Tab) or unforced — is answered FRESH (never a re-served
pre-acceptance set, never hesitation-gated); a simulated re-request at the
completed word yields the extension offer (armed-branch successor filtering with
exact-equal exclusion when chained; the normal 04 query offer when chaining is
disabled); a terminal word's empty offer delegates as ever; the real-Editor test
pins that pi-tui 0.84.4 fires NO getSuggestions after applyCompletion (degradation
documented at the PIN); the chain still arms at every accept; the forced
single-item return, close-on-space, series-first offers, and typed-word arming
(P1.M2.T2.S1) are untouched and their existing tests stay green; `npm run check` +
`npm test` green.

## User Persona (if applicable)

**Target User**: the pi coding-agent user typing prompts with hapax installed in a
configuration with NO editor factory (fallback display path — pi-tui's vertical
menu).

**Use Case**: Repeated-Tab ladders (`implem` → Tab → `implement` → Tab → …) and
ordinary single-word completion where the accepted word is terminal.

**User Journey**: Type a fragment; the menu offers ranked candidates; Tab accepts
the highlighted item; if extensions exist, the next keystroke's query (or a second
Tab's forced query) offers them — never a wedged word, never a stale set, never a
suppressed re-query; if no extension exists, the menu simply closes and the next
qualifying edit reopens normally.

**Pain Points Addressed**: The h3.11 "Problem" — Tab-accept lumped into
explicit-dismissal suppression wedged the word mid-message. On the fallback path
the wedge class is structurally milder (pi owns the menu and re-asks per
keystroke), but the same rule must hold unconditionally: acceptance never
suppresses, and the (potential) re-offer must never be blocked by hapax machinery.

## Why

- Spec 07 h3.11 is adopted ahead of implementation ("code lands with this spec");
  the widget-path half is P4.M1.T1.S1/S2 (in flight, parallel). This item ships
  the fallback-path half so BOTH display paths sit under the one rule
  ("fallback-path parity" — the item's OUTPUT).
- The fallback path leans on untyped pi-tui runtime contracts marked as PINs at
  their consumption sites (spec 07 h3.15). The post-applyCompletion re-request is
  a NEW dependency of the zero-char chain offer AND the extension offer; this item
  verifies it against real pi-tui and pins the verified state — the research pass
  already established the answer for 0.84.4 (ABSENT — see Context), so the pin
  lands as an absence-pin with the degradation documented.
- Downstream: P3.M1.T2.S2 (full gauntlet) counts this battery green; P3.M1.T2.S3
  live-smokes the post-Tab offer scenarios.

## What

Research established (see `research/findings.md`, verified against
`node_modules/@earendil-works/pi-tui/dist/components/editor.js` @ 0.84.4):

1. **No rest-of-word suppression exists on the provider path.** The fallback path
   has no `suppressUntilWordStart` analog (that is widget machinery; its
   retirement is T1.S1's). The display machine's only suppression is the transient
   100 ms swap window (rule 4d — same-prefix set re-serve) and the first-paint
   hesitation gate (3.5). Post-accept, 4d is pre-empted by the 4c-exception
   (`completionSincePaint` → paint fresh), and 3.5 cannot apply (acceptance does
   not reset `displayedSig`). **The seam change therefore lands as a GUARANTEE +
   documentation + battery, not a mechanism removal.** Production code: comments
   only (plus the spec edit), unless the battery exposes a defect.
2. **pi-tui 0.84.4 does NOT re-request after applyCompletion.** Menu-Tab accept
   (editor.js :540-552) → `cancelAutocomplete()`, no request; forced single-item
   fast path (:1902-1917) → return, no request. Re-requests come only from
   `updateAutocomplete` (menu OPEN only) and per-keystroke triggers (whitespace is
   excluded from triggerCharacters — editor.js :1869-1880). **Consequence
   (spec-anticipated degradation): the extension offer does not render immediately
   post-Tab on the fallback path.** The ladder remains walkable via forced Tab
   (Tab-Tab) and type-ahead (the next letter's query goes through the armed
   branch's fragment arm).
3. **Offer content when a re-request IS simulated**: with chaining ON, the
   completed-word query is answered by the armed branch (b) fragment arm —
   `topSuccessors(armed.word)` filtered by the anchored matcher INCLUDING
   exact-equal exclusion (`s.next !== frag.toLowerCase()`), successor-count order,
   `description: "chain"` (→ intent classification → hesitation bypass). With
   chaining OFF, the normal path answers — rankMatches at the completed word:
   tier-3 proper-prefix extensions, exact-equal excluded, shortest key first (the
   h3.11 query offer verbatim). Terminal word → zero candidates → delegate
   (zero-candidate rule).

### Success Criteria

- [ ] After `applyCompletion` (accept), an UNFORCED query inside the 100 ms window
      at the completed word returns the FRESH set with prefix === the completed
      word (4c-exception) — never the stale pre-acceptance set/prefix.
- [ ] After an accept, a FORCED query (`force: true`) returns the base result
      untouched (rule 1.5): single top extension item, never a re-served set.
- [ ] Rule 4d narrowing suppression is INTACT for non-acceptance same-prefix set
      changes (control test — the seam change is accept-specific).
- [ ] Simulated re-request at the completed word (chaining ON): extension
      successors offered, exact-equal excluded, prefix = completed word,
      `description: "chain"`; the one-shot grant is NOT spent; accepting the offer
      re-arms at the extension (ladder arming, armed(final word)).
- [ ] Simulated re-request (chaining OFF): the normal 04 query offer (store-wide
      extensions, shortest-first, exact-equal excluded).
- [ ] Terminal word: empty offer → delegation to `current` (zero-candidate rule).
- [ ] Real-Editor contract test: after a menu-Tab accept, NO getSuggestions fires
      before the next keystroke (the verified absence PIN); the accept delegated
      verbatim; pi's menu closed; the NEXT keystroke's query is answered fresh.
- [ ] Real-Editor: Tab-Tab ladder — the second Tab (menu closed) takes the forced
      single-item path and applies the top extension (options.force semantics
      UNCHANGED — pinned, not modified).
- [ ] Chain arming on accept unchanged; close-on-space, series-first offers,
      typed-word arming untouched (existing describes green).
- [ ] spec 07 h3.15 lists the fifth contract with the verified absence +
      degradation note; `npm run check` + `npm test` green.

## All Needed Context

### Context Completeness Check

"If someone knew nothing about this codebase, would they have everything needed to
implement this successfully?" — Yes: the verified runtime contract is quoted with
file:line evidence; every production edit site is pinned by quoted anchor text;
the battery enumerates each test with fixtures, call sequences, and assertions;
the harness idiom for the real-Editor test is spelled out (imports, fakes, flush,
cast pattern). The one non-obvious judgment (why "reset on accept" would be WRONG)
is analyzed under Known Gotchas.

### Documentation & References

```yaml
# MUST READ - Include these in your context window
- file: spec/07-completion-ui.md
  why: The binding contract. h3.11 "Post-Tab extension offer" (:261-321) — the
    Rule, the 0-candidate disqualification close, and the fallback-path paragraph
    (:316-321: "the offer rides the same post-applyCompletion re-request the
    zero-char chain offer uses; if pi-tui does not re-request after an apply, the
    fallback path degrades to no re-offer (suppression still never arms — the
    seam change is unconditional) — verify at implementation and PIN at the
    consumption site"). h3.15 "pi-tui contract dependencies" (:596-610) — the
    four existing PINs; this item adds the fifth. h2.50 rule 2 (intent bypass
    list already includes post-Tab extension offers), rule 0/1.5 (forced
    requests undelayed). h2.53 (chain arming; extension-offer accepts arm at the
    FINAL accepted word).
  pattern: h3.11 fallback paragraph verbatim; h3.15 bullet style.
  gotcha: The spec maintenance policy (AGENTS.md, binding) requires the h3.15
    edit to land WITH the code — this item's (c) explicitly mandates it. Update
    "Four runtime contracts" → "Five" in the h3.15 intro sentence.

- file: plan/006_7bd0258da993/P4M1T2S1/research/findings.md
  why: The verified evidence this PRP is built on — pi-tui 0.84.4 editor.js
    line-by-line findings (no re-request after applyCompletion; the only
    re-request seams), the provider-path suppression inventory (nothing
    rest-of-word exists; 4c-exception pre-empts 4d post-accept; hesitation gate
    cannot apply), and the offer-content derivation (armed branch vs
    chaining-off query vs zero-candidate delegation).
  pattern: section 1 (contract), section 2 (inventory), section 3 (offer paths).
  gotcha: All editor.js line numbers are @earendil-works/pi-tui 0.84.4
    (node_modules/@earendil-works/pi-tui/dist/components/editor.js) — re-verify
    if package.json's ~0.84.4 range resolved a newer minor.

- file: src/pi/provider.ts
  why: The ONLY production file touched (comments). Key sites, verify by quoted
    text: (1) the createHapaxProvider doc block — "applyCompletion arms through
    it as a side-effect BEFORE delegating verbatim" (~:260); (2) the armed
    branch (a) zero-char offer — `if (before === "" || /[ \t]$/.test(before))`
    (~:462-474); (3) the armed branch (b) fragment arm with exact-equal
    exclusion — `.filter((s) => s.next !== frag.toLowerCase() && matchFragment(
    frag, s.next) !== null)` (~:501-529) — THE PIN SITE; (4) base applyCompletion
    `applyCompletion(lines, cursorLine, cursorCol, item, prefix)` (~:678-736,
    ends `return current.applyCompletion(...)`) — THE MODE A JSDoc SITE; (5)
    display machine doc rule 4 acceptance EXCEPTION + code 4c-exception
    (`if (completionSincePaint)` ~:1210-1222); (6) display applyCompletion —
    `completionSincePaint = true; return base.applyCompletion(...)` (~:1262-1268).
  pattern: The file's house style — dense JSDoc citing spec sections by number,
    PIN-marked runtime contracts ("PIN: if pi-tui changes …").
  gotcha: provider.ts is NOT touched by the parallel widget work (verified via
    git status) — no merge friction.

- file: src/pi/index.ts
  why: The exact fallback wiring this item's battery mirrors —
    createDisplayProvider(createStartupGate(createHapaxProvider(store, config,
    current, sessionChain), restoreReady), { firstPaintDelayMs:
    config.menuDelayMs, getPreviousKeystrokeAt, isIntentResult }) (~:359-380);
    isIntentResult = trigger-char prefix OR `i.description === "chain"`
    (~:375-378) — why armed-branch offers bypass the hesitation gate.
  pattern: the addAutocompleteProvider registration block.
  gotcha: Read-only — do NOT touch index.ts.

- file: test/provider.test.ts
  why: Conventions the battery MUST follow (item contract: "provider tests with
    store fixtures + fake current-provider per test/provider.test.ts
    conventions"): `sighting`/`put` fixtures, `cfg()` (defaults: trigger "#",
    threshold 2, max 8), `opts()` (real AbortController — no fake timers),
    `makeCurrent()` (vi.fn mock with splice-semantics applyCompletion),
    `makeStack(store, current)` (inner = createHapaxProvider; provider =
    createDisplayProvider(inner)), `suggest(provider, lines, line, col)` (:129);
    the series-first describe (:720+) shows the recordBigramRuns seeding idiom.
  pattern: fresh store + stack per test; object-identity delegation proofs via
    makeCurrent sentinels; forced queries call getSuggestions directly with
    `{ signal, force: true }`.
  gotcha: `suggest` passes no options — forced/flagged queries bypass it.

- file: test/defer-pi-menu.repro.test.ts
  why: The REAL-Editor harness pattern the item contract names — imports
    `{ Editor, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS }` from
    "@earendil-works/pi-tui"; setKeybindings(new KeybindingsManager(
    TUI_KEYBINDINGS)); `fakeTui()`; theme stub; `ed.setAutocompleteProvider(p)`
    (auto-wires triggerCharacters); `editor.handleInput(ch)` per char;
    `flush()` = 10× `await Promise.resolve()`; `isShowingAutocomplete()` /
    `getText()` via `as unknown as` casts; the splice-semantics applyCompletion
    double (:56-79) to copy for the fake `current`.
  pattern: build() composes the stack once; real async timing (menu opens only
    after the getSuggestions Promise resolves).
  gotcha: Do NOT edit this file — it must stay green verbatim.

- file: src/core/query.ts
  why: Read-only PROOF of offer content: exact-equal exclusion `if (k === lower)
    continue;` (~:592 anchored, ~:646 tier-0 parity); tier-3 proper-prefix
    matching; shortest-key-first ranking. The chaining-off battery's expected
    sets derive from here.
  gotcha: Do NOT touch query.ts.
```

### Current Codebase tree (relevant excerpt)

```bash
src/pi/provider.ts            # 1278 lines — base provider + display machine (ONLY prod file, comments only)
src/pi/index.ts               # fallback wiring (read-only)
src/core/query.ts             # exact-equal exclusion (read-only)
test/provider.test.ts         # 856 lines — battery appended here
test/defer-pi-menu.repro.test.ts  # real-Editor harness pattern (read-only, must stay green)
spec/07-completion-ui.md      # h3.11 (:261-321), h3.15 (:596-610) — ONE bullet-list edit
```

### Desired Codebase tree with files to be added and responsibility of file

```bash
src/pi/provider.ts            # Mode A JSDoc (accept sites) + the h3.15 PIN at the fragment arm — comments only
spec/07-completion-ui.md      # h3.15: fifth PIN bullet + "Four"→"Five"
test/provider.test.ts         # + 2 describe blocks (~10 tests): post-accept no-suppression + offer battery
test/fallback-post-tab.contract.test.ts  # NEW: real-Editor re-request contract PIN (absence) + Tab-Tab ladder
```

### Known Gotchas of our codebase & Library Quirks

```typescript
// CRITICAL — do NOT "reset on accept" in the display machine. reset() nulls
// displayedSig, which would make the post-accept query a FIRST PAINT and push it
// through the hesitation gate (menuDelayMs) — under a future re-requesting
// pi-tui with chaining disabled that WOULD suppress the offer (a non-intent
// word result is gated). The current no-reset + 4c-exception IS the h3.11
// behavior. Document this in the 4c-exception comment so nobody "cleans it up".

// CRITICAL — the armed branch (b) requires the fragment AT A WORD START
// (fragAtWordStart, BUG-005 guard). Battery lines must place the completed word
// at line start or after a space: ["implement"] col 9, or ["please implement"]
// col 17 — NOT ["ximplement"] (glued → (c) reset → normal path answers).

// CRITICAL — grant interplay: a fresh grant's first grant.tick(frag) records
// seen=1 and returns false (never spends). The simulated re-request at the
// completed word therefore leaves the chain ARMED — assert chain.state() stays
// the accepted word after the query (and after accepting the offer, the
// extension word — "armed at the FINAL accepted word", h2.53).

// GOTCHA — makeStack's display provider is created WITHOUT hesitation options
// (firstPaintDelayMs defaults 0) — fine for the no-suppression battery; if you
// add a menuDelayMs case, pass opts to createDisplayProvider explicitly.

// GOTCHA — real-Editor menu selection: pi-tui picks the initial selection via
// getBestAutocompleteMatchIndex. Seed the store so the intended accept item is
// unambiguous (e.g. only "implement" + "implementation" for fragment "implem" —
// "implement" wins). If a run ever selects the longer item, select explicitly
// with a down-arrow handleInput ("\x1b[B") before Tab — but prefer deterministic
// seeding.

// GOTCHA — pi-tui async: requestAutocomplete → getSuggestions is a Promise; the
// menu opens only after it resolves (flush() pattern). explicitTab/force
// debounce is 0; plain-letter debounce is 0 (attachment debounce applies only
// to @/# patterns).

// GOTCHA — the display wrapper's applyCompletion sets completionSincePaint and
// delegates; the BASE applyCompletion arms the chain; current.applyCompletion
// splices. Order in the battery: call provider.applyCompletion (the DISPLAY
// provider — the registered surface), never inner.applyCompletion, when testing
// the 4c no-suppression path.
```

## Implementation Blueprint

### Data models and structure

None. No new types, no config, no store changes, no wiring changes. The provider
stack's public surface is unchanged.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EDIT spec/07-completion-ui.md — h3.15 re-verify list gains the fifth PIN
  - FIND: "### pi-tui contract dependencies (re-verify on upgrades)" (~:596):
    intro sentence "Four runtime contracts are leaned on by the FALLBACK path…"
    → change "Four" to "Five".
  - APPEND to the bullet list (match the existing bullet style):
    "the post-applyCompletion re-request — pi-tui 0.84.4 does NOT re-query
    after an apply (menu-Tab accept ends in cancelAutocomplete, the forced
    single-item fast path returns; verified 2026-10), so the fallback path's
    post-Tab extension offer degrades to no re-offer (07 h3.11) while
    suppression still never arms; if a pi-tui upgrade ever re-requests, the
    offer rides it — re-verify test/fallback-post-tab.contract.test.ts."
  - WHY FIRST: the AGENTS.md spec-maintenance policy (binding) requires spec and
    code to land in agreement; h3.11's fallback paragraph (:316-321) already
    mandated "verify at implementation and PIN at the consumption site".

Task 2: MODIFY src/pi/provider.ts — Mode A JSDoc on the acceptance sites
  - SITE A (base applyCompletion, ~:678): extend the existing doc comment with a
    paragraph citing spec 07 h3.11: acceptance ARMS the chain (h2.53 —
    unchanged) but NEVER arms suppression — the seam change is unconditional,
    independent of whether any offer renders; the 100 ms display window can
    never re-serve a pre-acceptance set (the display layer's 4c-exception), and
    the (verified absent — see the fragment-arm PIN) post-apply re-request would
    carry the extension offer.
  - SITE B (display machine): in the rule-4 doc EXCEPTION text and at the
    4c-exception code comment (`if (completionSincePaint)`, ~:1210) cite spec 07
    h3.11 — acceptance invalidates the anchor AND paints fresh; suppression (4d)
    never re-serves post-accept; add the anti-pattern note: acceptance must NOT
    reset display state (a reset would make the post-accept query a gated first
    paint under menuDelayMs and suppress a future re-request's offer).
  - SITE C (display applyCompletion, ~:1262): one line citing h3.11 (the flag is
    what makes every post-accept query fresh — the seam guarantee).

Task 3: MODIFY src/pi/provider.ts — the PIN at the consumption site
  - SITE: the armed branch (b) fragment arm, at/above the `.filter((s) =>
    s.next !== frag.toLowerCase() && …)` (~:501-529). Add a PIN comment:
    "PIN (spec 07 h3.11 fallback + h3.15, re-verify on pi-tui upgrades):
    pi-tui 0.84.4 does NOT re-request autocomplete after applyCompletion
    (editor.js menu-Tab accept → cancelAutocomplete; forced single-item fast
    path → return). The post-Tab extension offer therefore rides the NEXT
    keystroke's query — this fragment arm (successor filtering with exact-equal
    exclusion) when the chain is armed, the normal 04 query when it is not —
    and the immediate post-Tab re-offer DEGRADES to nothing (no render),
    while suppression never arms (unconditional). If a future pi-tui re-requests
    after an apply, this arm answers that re-request at the completed word —
    test/fallback-post-tab.contract.test.ts flips red; re-verify and update
    this PIN plus the h3.15 list."
  - Keep it in the file's established PIN voice (cf. the force fast-path PIN at
    the `forced` read ~:330).

Task 4: ADD the battery to test/provider.test.ts (describe blocks at end of file)
  Block 1 — "post-accept never suppresses (spec 07 h3.11 fallback path)":
  - it("accept then unforced re-query inside the 100 ms window paints FRESH —
    4c-exception, never the pre-acceptance set"): makeStack; seed
    implement×3, implementation×2, implements×1 via put; suggest(provider,
    ["implem"], 0, 6) → non-empty set, prefix "implem"; provider.applyCompletion(
    ["implem"], 0, 6, {value:"implement",label:"implement"}, "implem") (display
    surface); IMMEDIATELY suggest(provider, ["implement"], 0, 9) → assert
    returned prefix === "implement" (NOT "implem") and items exclude
    "implement" (fresh extension set — armed branch successor offer for the
    bigram-seeded store; see Block 2 for the exact set) — no re-serve.
    Seed bigrams recordBigramRuns([["implement","implementation"]]) ×2 and
    ([["implement","implements"]]) ×1 so the successor offer is deterministic:
    ["implementation","implements"]? — count desc → implementation(2) first.
  - it("accept then FORCED re-query returns the base single top item untouched
    (rule 1.5)"): same setup; provider.getSuggestions(["implement"], 0, 9,
    { signal, force: true }) → exactly 1 item, the top extension, prefix
    "implement" — never a re-served multi-item set.
  - it("CONTROL — 4d narrowing suppression intact WITHOUT an accept"): paint
    set for "implem" (implement+implementation seeded); put(store,
    "implemented") between queries; re-suggest at ["implem"] (same prefix,
    differing set, real-clock gap ≈ 0 < 100 ms) → the DISPLAYED set is
    re-served (prefix "implem", old items) — proves the seam change is
    accept-specific. (Query twice in a row quickly; no fake timers needed —
    the queries are synchronous-fast.)
  Block 2 — "post-Tab extension offer content (spec 07 h3.11, simulated
  re-request)":
  - it("chaining ON: re-request at the completed word offers extension
    successors — exact-equal excluded, count-desc, description 'chain'"):
    fresh store + createHapaxProvider(store, cfg(), makeCurrent(), chain);
    put implement/implementation/implements; recordBigramRuns per above;
    inner.applyCompletion(["implem"], 0, 6, item implement, "implem") (arms
    chain("implement"), delegates to current — assert current.applyCompletion
    called once); suggest(inner, ["implement"], 0, 9) → items
    [implementation, implements] (NO "implement"), prefix "implement",
    description "chain"; chain.state() STILL "implement" (grant not spent —
    assert); __hapaxLive().prefix === "implement".
  - it("mid-sentence completed word takes the same rule"):
    ["please implement"], 0, 17 — same assertions.
  - it("accepting the offer re-arms at the extension (h2.53 final-word)"):
    applyCompletion with the offered item (value "implementation") →
    chain.state() === "implementation".
  - it("chaining OFF: the normal 04 query answers — store-wide extensions,
    shortest-first, exact-equal excluded"): cfg({enableChaining:false}); put
    implement×3, implementation×2, implements×1 (no bigrams); accept via
    applyCompletion (arms nothing); suggest(inner, ["implement"], 0, 9) →
    [implements, implementation] (10 < 14 chars — shortest key first; NO
    "implement"), prefix "implement", descriptions from query.ts provenance.
  - it("terminal word: empty offer → delegation as ever (zero-candidate
    rule)"): store with node only; accept "node" (typed "nod"); suggest(inner,
    ["node"], 0, 4) → current.getSuggestions called; its sentinel returned
    verbatim; __hapaxLive() null; chain reset (armed (b) found no successors).
  - it("PRESERVATION — forced single-item unchanged; close-on-space and
    typed-word arming untouched"): assert the forced read still narrows the
    armed extension offer to items[0]; suggest(inner, ["node "], 0, 5) → null
    (close-on-space); the existing "series-first offers + typed arming"
    describe stays green untouched (do not edit it).

Task 5: CREATE test/fallback-post-tab.contract.test.ts (real-Editor PIN)
  - HEADER comment: the contract suite for spec 07 h3.11 fallback + h3.15 pin
    5; cites the verified 0.84.4 evidence (editor.js :540-552 menu-Tab accept
    ends in cancelAutocomplete — no requestAutocomplete; :1902-1917 forced
    fast path returns) and the degradation (no immediate re-offer; suppression
    never arms).
  - HARNESS (defer-pi-menu.repro.test.ts pattern): setKeybindings(new
    KeybindingsManager(TUI_KEYBINDINGS)); fakeTui(); theme stub; a counting
    current-provider: getSuggestions vi.fn(async () => null) (pi's stock
    yields nothing — hapax fully owns word completion) + splice-semantics
    applyCompletion copied from the repro's makePiProvider (:56-79), recording
    applied values; build the FULL fallback stack: inner =
    createHapaxProvider(store, cfg(), current, createChainMachine()); provider
    = createDisplayProvider(inner); const ed = new Editor(tui, theme, {});
    ed.setAutocompleteProvider(provider) (auto-wires triggerCharacters —
    editor.js :287-291).
  - FIXTURE: store seeded put implement×3, implementation×2 + recordBigramRuns
    [["implement","implementation"]] ×2 (chain arms on accept; top successor
    "implementation"). NOTE threshold default 2: fragment "implem" is 6 chars ✓.
  - TESTS:
  - it("typing opens the menu (precondition)"): type "implem" char-by-char +
    flush → isShowingAutocomplete() true; current.getSuggestions NOT called
    for word fragments (hapax owns) — count pinned at 0.
  - it("menu-Tab accept delegates verbatim, closes the menu, and fires NO
    re-request (PIN: 0.84.4 absence — degradation)"): type "implem", flush;
    const calls = current.getSuggestions.mock.calls.length; handleInput("\t")
    + flush → applied === ["implement"], getText() contains "implement",
    isShowingAutocomplete() === false, and NO additional provider-level
    getSuggestions call occurred (instrument by wrapping provider with a
    counting proxy object delegating all four members — assert its
    getSuggestions count unchanged after the accept until the next keystroke).
  - it("next keystroke after accept queries fresh — no suppression"): after
    the accept, type "a" + flush → a getSuggestions DID fire at
    "implementa" (counting proxy) and the menu re-opened
    (isShowingAutocomplete true — the armed fragment arm's extension offer).
  - it("Tab-Tab ladder via the forced path (options.force UNCHANGED)"):
    type "implem", flush; Tab (menu accept "implement"); Tab again (menu
    closed → handleTabCompletion → force:true → armed branch forced
    single-item → pi-tui :1902 fast path applies) + flush → applied ===
    ["implement", "implementation"], text walks the ladder.
  - gotcha: if the initial menu selection ever lands on "implementation"
    instead of "implement", make the seeding unambiguous or select via
    down-arrow handleInput("\x1b[B") — prefer deterministic seeding; the
    assertion is on `applied`, so a wrong selection fails loudly, not
    silently.

Task 6: RUN the validation loop; record results in the PRP's wake (commit message
  or follow-up notes). If ANY battery test exposes a real suppression defect in
  the display machine (it should not, per the research), fix it MINIMALLY inside
  the h3.11 contract and document the fix in the forcing test — never delete
  coverage.
```

### Implementation Patterns & Key Details

```typescript
// The no-suppression guarantee, mechanically (why comments + battery suffice):
// accept → display.applyCompletion sets completionSincePaint = true →
// delegates → base arms chain(accepted word) → current splices. The next query
// at the completed word: base answers via armed branch (b) (fragment at a word
// start, exact-equal exclusion, publishChain → description "chain") → display
// classify: isHapax ✓ (prefix === live.prefix) → gate 3.5 skipped
// (displayedSig non-null — acceptance never resets) → 4a sig differs → 4b
// maybe (≥100 ms) → 4c-exception (completionSincePaint) → PAINT FRESH. There
// is NO path where a post-accept query re-serves the pre-acceptance set.
//
// Forced post-accept query: rule 1.5 returns the base result BEFORE any
// classification — the armed branch's forced single-top extension, untouched.
//
// The verified absence (0.84.4): after applyCompletion pi-tui calls
// cancelAutocomplete (menu path) or returns (forced fast path); the ONLY
// re-request seams are updateAutocomplete (menu OPEN only) and per-keystroke
// triggers (whitespace excluded from triggerCharacters). Hence: no immediate
// re-offer (degradation), ladder reachable via Tab-Tab (forced) and type-ahead
// (armed fragment arm) — all pinned by the contract suite.
```

### Integration Points

```yaml
SPEC:
  - edit: spec/07-completion-ui.md h3.15 (~:596-610) — fifth bullet + "Four"→"Five"
  - none elsewhere: h3.11's fallback paragraph already specifies the degradation;
    this item's PIN fulfills its "verify at implementation and PIN at the
    consumption site" mandate.

NO OTHER INTEGRATION POINTS — no config, no store, no index.ts, no widget files
(parallel P4.M1.T1.S1/S2 own src/pi/widget.ts + test/widget.test.ts; do not touch
them). Feeds: P3.M1.T2.S2 (gauntlet counts this battery + contract suite green),
P3.M1.T2.S3 (live smoke scenario iv).
```

## Validation Loop

### Level 1: Syntax & Style (Immediate Feedback)

```bash
npm run check        # tsc --noEmit — zero errors (comments + tests only; the
                     # new test file must typecheck against pi-tui's Editor)
# Expected: clean. Type errors mean the contract-test casts are wrong — follow
# the repro file's `as unknown as` idiom rather than fighting the types.
```

### Level 2: Unit Tests (Component Validation)

```bash
npx vitest run test/provider.test.ts                      # the new battery + all existing describes green
npx vitest run test/fallback-post-tab.contract.test.ts    # the real-Editor PIN suite
npm test                                                  # full suite (vitest --run)
# Expected: all green. Existing describes that must stay green UNTOUCHED:
# "series-first offers + typed arming", "Tab-only-completes — forced path",
# "never-hijack acceptance", "stock-context delegation (BUG-001)".
```

### Level 3: Integration Testing (Real pi-tui — the VERIFY mandate)

```bash
# The item's verification instrument IS the contract suite (real Editor, real
# async timing) — run it and READ the pin test names as the verified record:
npx vitest run test/fallback-post-tab.contract.test.ts -v
# The "fires NO re-request" test is the PIN: if a pi-tui upgrade changes the
# contract, it flips red and forces the h3.15 re-verification (update the PIN
# comment in provider.ts + the spec bullet + the test to the new truth).

# Cross-check the installed pi-tui version matches the research (0.84.4):
grep '"version"' node_modules/@earendil-works/pi-tui/package.json
# and spot-check the two accept sites still match the findings:
sed -n '540,552p;1902,1917p' node_modules/@earendil-works/pi-tui/dist/components/editor.js
```

### Level 4: Creative & Domain-Specific Validation

```bash
# Live TTY (spec 09 h2.61) is BINDING for UI-layer changes, but the fallback
# path only registers when NO editor factory exists (index.ts dual-path), and
# the plan routes the post-Tab-offer live smoke to P3.M1.T2.S3 scenario (iv).
# This item's sanctioned verification surface is the real-Editor contract suite
# above (the item contract names the harness explicitly). Optional sanity:
# a live session cannot exercise the fallback path while the widget is primary;
# do not force it — S3 owns the live gate.
# Performance: zero new queries, timers, or allocation on the keystroke path —
# comments and tests only; nothing to benchmark.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean
- [ ] `npm test` green (full suite)
- [ ] `test/defer-pi-menu.repro.test.ts` green VERBATIM (untouched)
- [ ] Existing provider describes green UNTOUCHED (forced path, never-hijack,
      stock-context, series-first/typed-arming)
- [ ] widget files untouched (parallel item's scope)

### Feature Validation

- [ ] Post-accept unforced query → fresh paint, prefix = completed word, no
      re-serve (4c-exception pinned)
- [ ] Post-accept forced query → base single top item untouched (rule 1.5)
- [ ] 4d narrowing suppression intact without an accept (control)
- [ ] Simulated re-request: armed-fragment successor offer (exact-equal
      excluded, "chain", grant unspent, armed(final) on offer-accept);
      chaining-off query offer (shortest-first); terminal word → delegation
- [ ] Real-Editor: no getSuggestions after applyCompletion (PIN), next
      keystroke queries fresh, Tab-Tab ladder applies the top extension
- [ ] Degradation documented at the PIN site + spec h3.15 fifth bullet

### Code Quality Validation

- [ ] JSDoc cites spec 07 h3.11 at both acceptance sites + h3.15 at the PIN
- [ ] No behavioral production change beyond comments (any forced fix is
      minimal, documented in the forcing test)
- [ ] Spec/code agreement: h3.15 edit landed with the code (AGENTS.md policy)
- [ ] Battery follows test/provider.test.ts conventions (fresh store per test,
      makeCurrent sentinels, suggest helper)

### Documentation & Deployment

- [ ] No new env vars, config, or dependencies (nothing to document)
- [ ] PR notes the verified contract state (0.84.4 absence) for future
      upgraders

---

## Anti-Patterns to Avoid

- ❌ Don't add a "reset on accept" to the display machine — it would make the
  post-accept query a gated FIRST PAINT under menuDelayMs and suppress a future
  re-request's offer (the exact anti-h3.11 behavior). The no-reset + 4c-exception
  IS the rule.
- ❌ Don't touch the chain arming in base applyCompletion — acceptance arming is
  UNCHANGED (item contract; spec h2.53).
- ❌ Don't modify the forced single-item return, close-on-space, series-first
  offers, or typed-word arming — preservation is pinned by existing tests.
- ❌ Don't invent a hapax-side re-request (no timers, no pushing into pi — pi is
  pull-based; the provider only ever RETURNS sets).
- ❌ Don't turn the PIN test into an internal-state assertion on pi-tui — pin the
  OBSERVABLE contract (getSuggestions call count across the accept boundary).
- ❌ Don't edit test/defer-pi-menu.repro.test.ts, src/pi/widget.ts,
  test/widget.test.ts, src/pi/index.ts, or src/core/query.ts — other items' scope.
- ❌ Don't ship the spec edit separately from the code (spec-maintenance policy:
  they land together).
- ❌ Don't skip reading a red contract test as a contract change signal — a red
  "no re-request" pin on upgrade means pi-tui changed; update the PIN trio
  (provider.ts comment, spec bullet, test) to the new verified truth.
