# Research findings — P4.M1.T2.S1 (fallback-path seam change + re-request verification + PIN + battery)

Verified against HEAD `a618343` (provider.ts untouched by the parallel widget work —
`git status` shows only widget.ts/widget.test.ts/tasks.json dirty). Line numbers drift;
navigate by quoted text.

## 1. THE RUNTIME CONTRACT — VERIFIED: pi-tui 0.84.4 does NOT re-request after applyCompletion

File: `node_modules/@earendil-works/pi-tui/dist/components/editor.js` (version
0.84.4, from package.json). Both accept paths, read in full:

- **Menu-Tab accept** (editor.js :540-552): `kb.matches(data, "tui.input.tab")` while
  `autocompleteState && autocompleteList` → `getSelectedItem()` →
  `applyCompletion(...)` → set lines/cursor → **`cancelAutocomplete()`** →
  `onChange`. NO `requestAutocomplete` anywhere in the block.
- **Forced single-item fast path** (:1902-1917, `runAutocompleteRequest`):
  `options.force && options.explicitTab && items.length === 1` → `applyCompletion`
  → set → `onChange` → `requestRender` → `return`. NO re-request.
- The ONLY re-request seams in the editor:
  - `updateAutocomplete()` (:1955-1959) — guarded by `if (!this.autocompleteState ||
    !this.autocompleteProvider) return;` — fires ONLY while pi's menu is OPEN (per
    keystroke via handleChar's else-branch :977; also paste/cursor sites). After an
    accept the menu is cancelled → never fires.
  - `tryTriggerAutocomplete()` from handleChar (:946-972) — the typed char must be a
    registered trigger character at a word start (line start / after space/tab).
    `setAutocompleteTriggerCharacters` (:1869-1880) EXPLICITLY EXCLUDES whitespace
    (`isWhitespaceChar(character)` → skip) — so the SPACE after an accepted word
    fires nothing; the next request comes at the next word's first letter, or on
    continuation letters (the trigger pattern `(?:^|\s)[chars][^\s]*$` re-anchors at
    the word start and matches every subsequent letter of the same token).

**Consequences (the degradation, spec 07 h3.11:316-321 anticipated it):**
- The extension offer does NOT render immediately post-Tab on the fallback path —
  no getSuggestions call arrives at the completed word.
- The zero-char chain offer's real vehicle is ALSO not a post-apply re-request: it
  fires when a query lands at an empty word start while the menu is open
  (updateAutocomplete on the space keystroke of a typed-word flow) — the armed
  branch is evaluated before the close-on-space guard (branch order in
  createHapaxProvider.getSuggestions).
- The practical post-accept extension paths in 0.84.4: (i) type-ahead — the next
  letter's query goes through the ARMED branch (b) fragment arm (successor
  filtering, exact-equal exclusion); (ii) Tab-Tab — the second Tab (menu closed)
  takes handleTabCompletion → forceFileAutocomplete(true) → forced getSuggestions →
  armed (b) forced single-item return → pi-tui's :1902 fast path applies it. The
  ladder IS walkable via forced Tab.

## 2. SUPPRESSION INVENTORY — no rest-of-word suppression exists on the provider path

The fallback path has NO `suppressUntilWordStart` analog (that is widget.ts
machinery; its lapse-rule retirement is P4.M1.T1.S1's spec 07 :218-232 text).
grep confirms: provider.ts "suppression" hits are all the display machine's
TRANSIENT 100 ms swap window (rule 4d) or the first-paint hesitation gate (3.5).

- **Rule 4d swap window** (createDisplayProvider getSuggestions, "4d. Suppression
  window" ~:1250): re-serves the displayed set only when the fresh prefix EQUALS
  the displayed prefix. Post-accept this is pre-empted by the **4c-exception**
  (~:1210-1222): `completionSincePaint` (set by the display wrapper's
  applyCompletion :1262-1268) → paint fresh. Acceptance can never be re-served.
- **Hesitation gate 3.5** (~:1160-1195): applies ONLY when `displayedSig === null`
  (first paint). Acceptance does NOT reset display state (applyCompletion sets only
  the flag), so a post-accept query is never a gated first paint.
- **ANTI-PATTERN (do not do)**: "reset on accept" in the display machine would null
  `displayedSig` and push the post-accept query through the hesitation gate —
  under `menuDelayMs > 0` with a non-intent result that WOULD suppress the offer.
  Current no-reset + 4c-exception IS the h3.11 behavior.

So the "seam change" on the provider path is a GUARANTEE (acceptance never suppresses;
every post-accept query answered fresh), landed as Mode A JSDoc + the h3.15 PIN +
battery — there is no suppress-state to delete. The chain ARM on accept
(base applyCompletion :678-736) is explicitly UNCHANGED (item contract; spec h2.53).

## 3. OFFER CONTENT — where the offer would come from if a re-request fired

- **Chaining ON (default)**: accept arms chain(accepted word). A re-request at the
  completed word (before = "…implement", fragment at a word start) is answered by
  the ARMED branch (b) fragment arm (~:501-529): `topSuccessors(armed.word)` filtered
  by `s.next !== frag.toLowerCase() && matchFragment(frag, s.next) !== null`
  (exact-equal exclusion, §07 h2.49 parity with §04 h2.29), successor-count order,
  published via publishChain with `description: "chain"` → display-layer intent
  classification (index.ts :375-378 `isIntentResult`: description === "chain") →
  hesitation bypass. NOTE: this is the SUCCESSOR-index offer — the spec's fallback
  paragraph deliberately rides "the same re-request the zero-char chain offer uses";
  the store-wide query offer (h3.11's "every live match, ranked by the normal 04
  rules") is observable only when chaining is disabled or the chain (c)-resets.
- **Chaining OFF**: re-request → armed branch skipped → extractMatchState(fragment =
  completed word, threshold clamped 1) → rankMatches → tier-3 proper-prefix
  extensions, exact-equal excluded (src/core/query.ts ~:592 anchored pass), shortest
  key first — the h3.11 offer VERBATIM from the query.
- **Terminal word (0 candidates)**: armed (b) empty → (c) chain.reset() → normal
  query → zero matches → `lastLive = null` → delegate to current (zero-candidate
  rule). Empty offer → delegation as ever.
- **Grant interplay**: a fresh grant's first tick (grant.tick(frag)) records seen=1
  and returns false — the simulated re-request does NOT spend the one-shot grant;
  the chain stays armed through it.

## 4. HARNESS / FIXTURE CONVENTIONS (verified)

- `test/provider.test.ts`: `sighting`/`put` (store seeding), `cfg` (fresh config,
  defaults trigger "#", threshold 2, max 8), `opts()` (real AbortController — no
  fake timers), `makeCurrent` (vi.fn mock of pi's provider with splice-semantics
  applyCompletion), `makeStack` (inner = createHapaxProvider; provider =
  createDisplayProvider(inner)), `suggest(provider, lines, line, col)` helper
  (:129). Series/bigram seeding idiom: `store.recordBigramRuns([[{key, rawCasing,
  series}, …]])` (:720-747). Forced queries call `provider.getSuggestions(lines, 0,
  col, { signal, force: true })` directly.
- `test/defer-pi-menu.repro.test.ts` — the REAL-Editor harness pattern: import
  `{ Editor, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS }` from
  "@earendil-works/pi-tui"; `setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS))`;
  `fakeTui = { requestRender: () => {}, terminal: { rows: 40, columns: 120 } }`;
  theme stub; `ed.setAutocompleteProvider(p)` (auto-wires triggerCharacters,
  editor.js :287-291); `editor.handleInput(ch)` per char; `flush()` = 10×
  `await Promise.resolve()`; `isShowingAutocomplete()` / `getText()` via
  `as unknown as` casts.
- pi-tui async: requestAutocomplete → getSuggestions is a Promise; menu opens only
  after it resolves. explicitTab/force debounce = 0; plain letters debounce = 0
  (ATTACHMENT debounce only for @/# patterns).
- Validation: `npm run check` (tsc --noEmit), `npm test` (vitest --run),
  `npx vitest run test/provider.test.ts`.

## 5. SPEC SITES

- spec/07-completion-ui.md h3.11 :261-321; fallback paragraph :316-321 ("verify at
  implementation and PIN at the consumption site" — this item fulfills it).
- h3.15 :596-610: "Four runtime contracts … re-verify each" — the item adds the
  fifth: "pi-tui re-requests autocomplete after applyCompletion" (verified ABSENT in
  0.84.4 — pin the absence + degradation). Count "Four" → "Five".
- h2.50 rule 2 already lists post-Tab extension offers among intent bypasses.
- AGENTS.md spec-maintenance policy (binding): the h3.15 list edit lands WITH the
  code (Mode A rides-with-the-work reading of the item's (c)).

## 6. PARALLEL-WORK BOUNDARY

P4.M1.T1.S1/S2 (widget path) touch ONLY src/pi/widget.ts + test/widget.test.ts.
This item touches src/pi/provider.ts + test/provider.test.ts + one new real-Editor
contract test + spec/07 h3.15. No shared files; no conflicts.
