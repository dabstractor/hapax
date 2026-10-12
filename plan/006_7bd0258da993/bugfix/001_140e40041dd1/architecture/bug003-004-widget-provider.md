# BUG-003 / BUG-004 research — widget zero-char offer timing + provider.ts PIN & fallback battery

Read-only validation pass. All citations from the working tree at `/home/dustin/projects/hapax` (HEAD of plan 006 bugfix prep). Line numbers counted from file reads; those I derived by counting chunk offsets are marked `≈` (verify with an editor before patching).

**Label collision warning (read first):** the shipped code already contains a DIFFERENT "BUG-003" — the 2026-10 start-0 suppression-release fix (`src/pi/widget.ts` ≈:640-660 and ≈:1057-1070; `test/widget-visibility.test.ts` references it too). Plan 006's BUG-003 (zero-char offer timing) is a separate issue; keep the two names distinct in commits/comments.

**Spec-section labeling:** the task (and the code's own comments) refer to "h3.11" = the `### Post-Tab extension offer` section and "h3.15" = the `### pi-tui contract dependencies (re-verify on upgrades)` section of `spec/07-completion-ui.md`. The file's literal `###` header sequence does not number to 11/15 — I cite sections by exact title + line range; do not renumber them.

---

## 1. BUG-003 — the arming site and today's tick flow

### 1.1 The trailing-space typed-word arming site (inside the R3 close branch of `evaluate()`)

`src/pi/widget.ts` — `evaluate()` begins ≈:783 (doc comment "The decision core (shared by onInput and gate wakes)"). The arming site lives in the `match === null` (no-fragment) branch. Exact comment, `src/pi/widget.ts:984-1012`:

> ```
>       // TYPED-WORD ARMING (spec 07 h2.53 idle transition, P1.M2.T2.S2 —
>       // provider.ts close-on-space twin, mirrored not forked): the chain
>       // is "armed by acceptance or by typing of a series member." Inside
>       // the close-on-space flavor ONLY (trailing space/tab, no '@'/'/'
>       // anywhere — the plain no-fragment close and cursor-move closes
>       // never arm), a space that just closed a TYPED word whose first
>       // letter is UPPERCASE and whose lowercase key carries SERIES
>       // successors arms the chain (typing "The " offers "Fed" at the
>       // next word start). Three gates mirror the provider exactly:
>       //   - UPPERCASE on the TYPED form (ASCII A–Z) — a lowercase typing
>       //     of a top-band word must never arm, or every prose "the "
>       //     would offer its run successor;
>       //   - the SERIES flag on a DIRECT topSuccessors(lowercased key)
>       //     consult (never store.get): a chain-only member — known only
>       //     to the successor index, never admitted as a candidate — arms
>       //     too, but a word with only ordinary successors is not a
>       //     series member and never arms;
>       //   - enableChaining + chain idle — the whole chain layer is inert
>       //     under the flag, and an already-armed chain never re-arms
>       //     (the armed branch runs before this site anyway; this guard
>       //     is cheap safety).
>       // Arm + STILL closeWith(now): the space closes the line (this
>       // branch's contract); the armed branch's zero-char offer answers
>       // the NEXT word-start tick — never paint from the arming site.
>       // grant.reset() beside the arm (an arm is an arm — identical to
>       // the Tab-insert arm site's fresh-grant discipline). No
>       // Tab-accept suppression exists anywhere on this path (spec 07
>       // h3.11 retired it); Tab deferral (h3.10) lives upstream of
>       // evaluate and is untouched.
> ```

Code, `src/pi/widget.ts:1013-1028`:

> ```ts
>       if (/[ \t]$/.test(before) && !before.includes("@") && !before.includes("/")) {
>         const typed = before.match(/([A-Za-z][A-Za-z0-9_-]*)[ \t]$/)?.[1];
>         if (
>           typed !== undefined &&
>           deps.config.enableChaining &&
>           (deps.chain?.state?.() ?? null) === null &&
>           typed.charAt(0) >= "A" &&
>           typed.charAt(0) <= "Z" &&
>           deps.store.topSuccessors(typed.toLowerCase()).some((s) => s.series)
>         ) {
>           deps.chain?.arm?.(typed.toLowerCase());
>           grant.reset(); // fresh one-shot grant — an arm is an arm
>         }
>       }
>       closeWith(now);
>       return state();
> ```

`closeWith(now)` (`src/pi/widget.ts:713-716`) = `hide()` + `closeAt = now` (a close-event stamp for the 200 ms fresh-reopen window). `hide()` (≈:703-711) clears `visible`, `currentSet`, `paintedSet`, `displayedSig`, `pendingSet`, and kills the swap timer.

### 1.2 Why painting at the arming site was avoided; the current tick flow

1. **Ordering inside `evaluate()`:** the armed-chain consult runs at the TOP of evaluate (≈:829 `const armed = deps.chain?.state?.();`), long before the R3 close branch. At the space keystroke the chain is still idle when the consult runs, so the consult is skipped; `extractMatchState` (with the threshold clamped to 1, ≈:974-977) returns `null` at a trailing space; the close branch then arms and closes. The zero-char offer therefore cannot fire on this tick without new code at the arming site — hence the comment "never paint from the arming site."
2. **W1 microtask deferral (the key integration fact):** the machine tick is wired as `src/pi/widget.ts` ≈:1597-1607 — `const tick = (): void => { opts.onKeystroke(); queueMicrotask(() => { applyVisibility(machine.onInput()); requestRender(); }); };` with the comment: "the enter-submit guard's seam fires BEFORE it delegates the key, so a synchronous machine.onInput() here would read the PRE-keystroke buffer … The evaluation is therefore deferred to a MICROTASK, which runs after the inner editor has synchronously applied the character." So evaluate() sees the POST-keystroke buffer: at the space tick, `before === "The "` — the arming conditions hold exactly on that tick, and a paint issued there would land in the same `applyVisibility(...)` + `requestRender()` frame (visible at the space keystroke's render).
3. **Consequence in production:** after the space tick, the machine evaluates again only on the NEXT input event. That next keystroke's buffer is already `"The F"` → the consult's branch **(b)** (typed-fragment filter, ≈:907-929) answers, not the **(a)** zero-char offer. The pure (a) zero-char offer paints today only on ticks whose buffer still ends in space/tab (a second space, a backspace to the space, a gate wake). **Researcher inference:** in live use the "zero-char" offer is effectively a "first-letter-of-next-word filtered offer"; the user never sees the zero-char successor list at rest after typing `"The "`. (The composed test harness masks this: `restoreReady` is `Promise.resolve()`, so the settle-wake `wakeEvaluate()` (≈:747-751) re-evaluates the live `"The "` buffer within the test's microtask flush and paints the offer without another keystroke — see §4.2.)
4. **Contract the comment defends:** spec 07's visibility-machine step 3 — "Trailing space with no `@`/`/` in text-before-cursor → hidden (close-on-space carried over as the widget's own state)" (`spec/07-completion-ui.md:336-337`, section "### Widget visibility state machine (auto-open, re-based)" ≈:324). The close-on-space contract is why the site arms *and still closes*. A space-tick paint contradicts this step unless the spec gains an armed-chain exception (AGENTS.md requires the spec edit to land with the code).

### 1.3 The armed(W) zero-char offer code that answers "the NEXT word-start tick" today

`src/pi/widget.ts:889-906` (branch (a) inside the consult; grant tick at ≈:876-885 precedes it):

> ```ts
>         if (before === "" || /[ \t]$/.test(before)) {
>           // (a) Zero-typed-char offer: cursor at an EMPTY word start.
>           // SERIES FIRST (spec 07 h2.53, P1.M2.T2.S2 — provider parity):
>           // topSuccessors already orders series entries ahead of
>           // ordinary ones … One chain items
>           // set at the composition site below — never mixed with the
>           // ambient query.
>           succ.push(
>             ...deps.store
>               .topSuccessors(armed.word)
>               .slice(0, deps.config.maxSuggestions),
>           );
>         } else { … (b) typed-fragment filter … }
> ```

Paint block, `src/pi/widget.ts:931-956`:

> ```ts
>         if (succ.length > 0) {
>           const items = succ.map(chainShim);
>           chainIntent = true; // R5 intent: a chain paint bypasses hesitation
>           const sig = items.map((m) => m.display).join("\u0000");
>           // Suppression note: chain offers are INTENT — this branch paints
>           // even under explicit-dismissal suppression (mirroring trigger
>           // mode's R4 bypass). …
>           if (!visible) { paint(items, sig, now); return state(); }
>           if (sig === displayedSig) { paint(items, sig, now); return state(); }
>           if (now - lastPaintAt >= debounceMs) { paint(items, sig, now); return state(); }
>           parkSwap(items);
>           return state();
>         }
> ```

`chainShim` (≈:683-694) maps a `Successor` to a `RankedMatch` (series run casing via `nextDisplay`, `description: "chain"`, tier deliberately omitted so accepts re-arm). `paint()` (≈:718-737) sets `visible/currentSet/paintedSet/displayedSig/lastPaintAt`, **clears `closeAt`, `suppressed`, and both suppression fingerprints**, and calls `deps.onPaint?.()`.

The chain state machine itself is NOT in a `chain.ts` — `ChainMachine` lives in `src/pi/provider.ts:796-827` (`idle ─ arm(W) ─ reset`, `state(): { word: string } | null`). The visibility machine's own state is `getState().visible` (`VisibilityState`, `src/pi/widget.ts:464-478`; `state()` closure ≈:700-704).

### 1.4 Guards and their interaction with an arming-tick paint

- **Hesitation gate (R5), `src/pi/widget.ts:1089-1101`:**
  > ```ts
  >     if (!visible) {
  >       // R5 — hesitation gate: a CLOSED line opens on a word-mode set
  >       // only when the tick gap ≥ menuDelayMs (0 = OFF → first paint is
  >       // immediate). Trigger/intent/fresh-reopen bypass.
  >       if (
  >         !intent &&
  >         !freshReopen &&
  >         menuDelayMs > 0 &&
  >         prev !== null &&
  >         now - prev < menuDelayMs
  >       ) { return state(); // held — not a close event (the line never opened) }
  >       paint(matches, sig, now);
  >       return state();
  >     }
  >  ```
  - `prev` comes from `onInput()` (`src/pi/widget.ts` ≈:1125-1129): "Rule 0 — bookkeeping FIRST": `const now = Date.now(); const prev = lastTickAt; lastTickAt = now;` — i.e. the PREVIOUS tick's wall-clock time (the same clock `opts.onKeystroke` feeds via the enter-submit guard's seam). There is no separate `inputClock.prevAt` field read by the gate; the gate's only time inputs are `prev`/`lastTickAt` (this machine) — the shared input clock exists so consumed keys and forwarded keys all advance it.
  - **Would an arming-tick paint violate the gate? No.** R5 only gates the *normal-path* `!visible` word-mode paint. An arming-site paint is an intent paint: the (a) branch sets `chainIntent = true` and `intent = match.mode === "trigger" || chainIntent || …` (≈:1081) bypasses R5; and if the fix paints through the branch's own `paint()` call (not the word-mode path below), R5 is never reached at all. With `menuDelayMs: 0` (the default; config-clamped) the gate is OFF regardless. Contrast: if the fix were written as a *word-mode* paint without intent, R5 would silently hold it during fast typing (gap < menuDelayMs) — the fix must keep the chain-intent character.
- **Fresh-reopen / closeAt:** if the fix paints INSTEAD of `closeWith(now)`, no `closeAt` stamp is recorded (fine — chain paints don't need it; `paint()` nulls `closeAt` anyway). If the fix keeps `closeWith(now)` then paints in the same tick, `paint()` clears `closeAt` and suppression flags — consistent, no stale 200 ms window. (Precedent: the post-Tab extension offer does exactly close-then-paint via `onDismissed(false)`'s stamp + immediate re-eval — `src/pi/widget.ts` ≈:1398-1404 doc + the tab-insert branch ≈:1833-1840.)
- **Double-paint on the next tick? No.** Next tick with an unchanged trailing-space buffer re-enters (a), computes the identical `sig` → `sig === displayedSig` → idempotent refresh (paint advances the window clock; no flicker). Next tick with a typed letter enters (b) with a narrower set → R6 swap debounce parks the differing set inside the 100 ms window and paints after it (`src/pi/widget.ts:1106-1121`) — narrowing never closes+reopens.
- **Grant (one-shot) semantics, `src/pi/chain-grant.ts:56-88`:** `tick()` with `lastPrefix === null` (i.e. the first tick after `reset()`) sets `seen = 1` and NEVER spends; spending requires reaching a *second* word boundary. The arming site calls `grant.reset()` beside `chain.arm` (widget.ts:1023-1024). Whether the fix's arming-tick paint ticks the grant (with prefix `""`) or not, the next tick is still the first-or-same word → never disarms early; typing through to the next word boundary still spends exactly once. Ticking at the paint (before it, per the armed branch's discipline "tick BEFORE any paint", widget.ts ≈:873-876) is the closer parity: `""`→`"f"` is not a new word (`isNewWord` requires `cur !== "" && lastPrefix !== ""` or `""` after non-empty), so the grant survives into the offer word either way.
- **Line claim:** the render override is the ONLY claim arm site — `src/pi/widget.ts` ≈:1873-1876: `claim.arm(); return [...lines, line];` ("only a line that actually painted claims the row"). An arming-tick paint makes the space tick CLAIM the row (if unclaimed) and show content instead of a blank/absent row. If the row was already claimed (a prior offer this prompt), layout is unchanged (content-only change — exactly what Line claim exists for). Fresh-prompt first-arm timing shifts one tick earlier. This is live-visible layout behavior → §3.2's live TTY verification is binding.

### 1.5 Minimal fix sketch (researcher inference, grounded in the above)

1. Factor the (a)-offer body into a small helper next to the consult (e.g. `zeroCharOffer(word: string, now: number): boolean` — build `succ` from `deps.store.topSuccessors(word).slice(0, deps.config.maxSuggestions)`, map `chainShim`, set `chainIntent = true`, run the same first-paint/idempotent/swap-debounce paint ladder, return whether it painted).
2. At the arming site (widget.ts:1013-1027): after `deps.chain?.arm?.(...)` + `grant.reset()`, call the helper; if it painted, `return state()` WITHOUT `closeWith(now)`; otherwise fall through to `closeWith(now)` as today (zero successors, or the chain inert — same behavior). Tick the grant before the paint for branch-(a) parity.
3. Spec edits (binding, AGENTS.md): spec 07 visibility-machine step 3 (lines ≈:336-337) gains the armed exception ("trailing space → hidden, EXCEPT an armed typed-word space-tick paints the zero-char successor offer immediately — M2's phrase-completion offer"); the M2 section text (below) already reads as requiring immediacy, so no M2 change needed beyond maybe a widget-path note. Update the widget.ts:1005-1007 comment (it currently forbids exactly this).
4. Test updates: flip the two pins — `test/widget-visibility.test.ts` "close-on-space typed-arming × visibility" (visible must be TRUE on the `"The "` tick; §4.1) and `test/widget.test.ts` typed-arming battery comment/assertions (§4.2). New machine-level test: fake timers, `menuDelayMs: 5000`, `editor.set("The ", 4)` → single `onInput()` → `visible === true` with the successor set (intent bypass, no double-paint on the follow-up tick with identical buffer).

---

## 2. BUG-004 — pi-tui contract evidence, the PIN home, and the spec quotes

### 2.1 pi-tui `applyCompletion` call sites (both verified; no re-request at either)

`node_modules/@earendil-works/pi-tui/dist/components/editor.js` (provider.ts:327-328 itself notes "verified against @earendil-works/pi-tui ~0.84.4").

**Site 1 — menu-open Tab accept, editor.js:538-552 (≈):**

> ```js
>             if (kb.matches(data, "tui.input.tab")) {
>                 const selected = this.autocompleteList.getSelectedItem();
>                 if (selected && this.autocompleteProvider) {
>                     this.pushUndoSnapshot();
>                     this.lastAction = null;
>                     const result = this.autocompleteProvider.applyCompletion(this.state.lines, this.state.cursorLine, this.state.cursorCol, selected, this.autocompletePrefix);
>                     this.state.lines = result.lines;
>                     this.state.cursorLine = result.cursorLine;
>                     this.setCursorCol(result.cursorCol);
>                     this.cancelAutocomplete();
>                     if (this.onChange)
>                         this.onChange(this.getText());
>                 }
>                 return;
>             }
> ```

Calls `cancelAutocomplete()`; `return`s with **no `requestAutocomplete`**.

**Site 2 — forced single-item fast path in `runAutocompleteRequest`, editor.js:1895-1906 (≈):**

> ```js
>         if (options.force && options.explicitTab && suggestions.items.length === 1) {
>             const item = suggestions.items[0];
>             this.pushUndoSnapshot();
>             this.lastAction = null;
>             const result = this.autocompleteProvider.applyCompletion(this.state.lines, this.state.cursorLine, this.state.cursorCol, item, suggestions.prefix);
>             this.state.lines = result.lines;
>             this.state.cursorLine = result.cursorLine;
>             this.setCursorCol(result.cursorCol);
>             if (this.onChange)
>                 this.onChange(this.getText());
>             this.tui.requestRender();
>             return;
>         }
> ```

**No `cancelAutocomplete()` here** (the request path already tore down prior state via `requestAutocomplete` → `cancelAutocompleteRequest`, editor.js ≈:1838-1861) and **no `requestAutocomplete`** — it `return`s straight after the apply + render.

**Correction to the task's premise:** only site 1 calls `cancelAutocomplete()`; site 2 does not (it doesn't need to — no menu is open on the forced path). The load-bearing fact for h3.11 is the one both sites share: **neither re-requests after an apply.** Consequence (matches the spec's own conditional): the fallback path's post-Tab extension offer and zero-char chain offer ride only the NEXT keystroke-driven request; there is no automatic re-request after `applyCompletion`. The h3.11 instruction "verify at implementation and PIN at the consumption site" is therefore still outstanding work: verification = this evidence; the PIN comment + battery are the deliverable.

### 2.2 The provider.ts consumption site / PIN insertion point

`src/pi/provider.ts` — the display-provider consumption seam is the `applyCompletion` override inside `createHapaxProvider`, **`src/pi/provider.ts:679-735`** (signature at :679 `applyCompletion(lines, cursorLine, cursorCol, item, prefix) {`; arming classification through `liveKeyByValue` :681-722; ends `return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);` at ≈:735). This is where an apply's results are consumed (chain re-arm + grant reset) and where a re-request would have been observable — the natural home for the new PIN.

Existing PIN precedent (match its style): `getSuggestions` 1.1 force-read comment, `src/pi/provider.ts` ≈:313-331, including:

> ```
> … pi-tui's editor Tab-with-no-menu path calls getSuggestions with force:true,
> then applies a single-item result IMMEDIATELY — its fast path is
> `options.force && options.explicitTab && suggestions.items.length
> === 1` (components/editor.js ~1903, verified against
> @earendil-works/pi-tui ~0.84.4; >1 items opens the menu in its
> 'force' state). … PIN: if
> pi-tui changes the items.length === 1 fast path, this mitigation
> needs revisit (the zero-char chain offer and auto-open rules are
> unaffected).
> ```

Existing comments about post-Tab / re-request / re-offer in provider.ts (grep-equivalent sweep from reads): there is NO existing post-Tab/re-request PIN. The closest texts are (i) the typed-word arming comment at `src/pi/provider.ts` ≈:551-577 — "Arm + STILL return null: the space closes the menu (the h2.51 close-on-space contract below is untouched); the armed branch's zero-char offer answers the NEXT word-start query. grant.reset() beside chain.arm …" — and (ii) `applyCompletion`'s arming-side-effect comments (:681-722). Suggested PIN wording (new comment inside the applyCompletion override, before the `return current.applyCompletion(...)`): note that pi-tui issues NO request after an apply (editor.js menu-accept Tab ≈:543-552 and forced fast path ≈:1899-1906 both return without `requestAutocomplete`), so the post-Tab extension offer (07 h3.11) and the zero-char chain offer surface only on the NEXT keystroke's request on this path — re-verify both call sites on any pi-tui upgrade.

### 2.3 Spec quotes

**spec/07 h3.11 — the fallback-path paragraph, `spec/07-completion-ui.md:316-321`** (end of `### Post-Tab extension offer`, section starts ≈:247):

> ```
> **Fallback path:** the offer rides the same post-applyCompletion
> re-request the zero-char chain offer uses (M2 below); if pi-tui
> does not re-request after an apply, the fallback path degrades to
> no re-offer (suppression still never arms — the seam change is
> unconditional) — verify at implementation and PIN at the
> consumption site.
> ```

**spec/07 h3.15 — the re-verify list, `spec/07-completion-ui.md` ≈:589-610** (`### pi-tui contract dependencies (re-verify on upgrades)`), intro + current four bullets (exact format for a matching fifth bullet — lowercase start, parenthetical rationale, semicolon-terminated):

> ```
> Four runtime contracts are leaned on by the FALLBACK path (marked as
> PINs at their consumption sites in `src/pi/provider.ts`); none is
> enforced by types. … On any pi-tui upgrade, re-verify each:
>
> - the single-item forced fast path (`force && explicitTab &&
>   items.length === 1` applies the completion without opening a menu);
> - trigger-char branch shadowing (letters registered ⇒ the stock
>   letter-continuation branch is unreachable);
> - one-query-per-word while the menu is closed (the word-start request
>   is that word's only one — the startup gate exists because of it);
> - the editor's space-updates-open-menu flow (close-on-space depends on
>   being consulted at trailing space).
> ```

Proposed new bullet (matching style; also update "Four" → "Five"): `- no re-request after applyCompletion (both apply call sites — menu-accept Tab and the forced single-item fast path — return without calling requestAutocomplete; the fallback's post-Tab extension offer and zero-char chain offer therefore surface only on the next keystroke's request, never at the apply itself);`

**spec/07 M2 — the armed(W) zero-char requirement, `spec/07-completion-ui.md` ≈:688-715** (`## M2: chained completion` state-machine block; the diagram includes `idle ──space closes a typed word whose first letter is UPPERCASE and whose lowercase key has series successors──► armed(W)`):

> ```
> armed(W):
>   - word start (cursor at the empty next word, ZERO typed chars) → offer
>     the successors of W immediately: series successors first (count
>     descending among them), then ordinary successors (count descending).
>     No trigger char, no threshold, no typed
>     fragment needed — the top series successor is the top result before
>     the user types anything. This is the entire meaning of "phrase
>     completion".
> ```

**Researcher inference (BUG-003 validation):** at the space tick the cursor IS "at the empty next word" with zero typed chars of it — so M2's "immediately" reads as requiring the space-tick paint, while visibility-machine step 3 (`→ hidden`) is the clause the current code honors. The fix must reconcile the two in the spec (an armed exception to step 3), not just in code.

**spec/09 — live TTY verification technique (AGENTS.md's binding requirement), `spec/09-testing-and-acceptance.md:291-314`:**

> ```
> ## Live verification technique (binding)
>
> Unit tests have repeatedly encoded wrong platform models — the editor,
> the trigger plumbing, and the menu lifecycle behave differently in a
> real TTY than in test doubles. UI-layer changes are verified live, not
> by unit tests alone:
>
> - Run an ephemeral instance: `pi --no-session` inside a tmux pane
>   (pi's TUI needs a real TTY — piping stdout makes it exit silently).
>   Seed the store by submitting one short user message, then Ctrl+C the
>   turn.
> - Drive keys with `tmux send-keys`, one char at a time with 0.08–0.12 s
>   sleeps between them. A whole string sent at once is a burst, and
>   bursts CANCEL in-flight autocomplete queries — different behavior
>   from human typing, and the source of at least one false conclusion.
> - Verify visible state via `tmux capture-pane`.
> - Temporary instrumentation (`appendFileSync` behind an env var) in
>   `src/pi/provider.ts` is the sanctioned way to observe internal state
>   live; two bugs invisible to every test were found this way. Remove
>   instrumentation before committing. The M3 one-line widget is the
>   deepest UI-layer change yet (own rendering + own key handling): live
>   verification against the real extension stack (pi-vim +
>   split-editor) is mandatory before acceptance — the v1 proxy crash
>   (07) is the precedent.
> ```

Also relevant: spec/09 integration item 10 (`:286-289`) is the existing live check for the post-Tab offer — "type `implem`, Tab (→ `implement`) — the extension offer must appear without further typing" — a BUG-004 live check analog would assert the FALLBACK path's degradation (no offer until the next keystroke) and a BUG-003 live check would assert the widget offer appears AT the space (tmux capture-pane).

### 2.4 The widget-path h3.11 battery (pattern for the fallback battery) and the fallback harnesses

**Widget-path battery:** `test/widget.test.ts` — `describe("widget key handling — Post-Tab extension offer battery (spec 09 h2.59 / 07 h3.11)")` at ≈:2556, with `forkStore()` (`implement`/`implements`/`implementation` — the h3.11 fork) and a `rung1()` helper that reaches the mid-ladder state machine-painted ("forwarded keystroke + flushPaint — never show()-driven"). Earlier post-Tab tests ≈:1630-1830, including the falsifiable intent-show pin at ≈:1733: `"menuDelayMs > 0: the post-Tab offer still renders in the SAME keypress (intent show — R7 fresh-reopen bypasses the hesitation gate)"`, the trigger-completion rule test, the chain re-arm test ("the chain ends ARMED at the final accepted word with a fresh grant — including the mid-ladder (c)-reset case"), and `"Escape on the offer still suppresses"`. Battery style: `makeInsertHarness` + `await flushPaint()` + assertions on `machine.getState()`/`chain.arm`/`grant.reset` call counts.

**Fallback-path harnesses (no real editor exists in any of them — requests are simulated as direct `getSuggestions` calls):**

- `test/provider-live.test.ts` (header :1-30): `createHapaxProvider` over a `vi.fn()` mock `current`; "Stores are built by upserting fabricated Sightings"; helpers `sighting()`, `put()`, `zeStore()`. One request = one `getSuggestions(lines, line, col, opts)` call.
- `test/provider-display.test.ts` (header :1-30): `createDisplayProvider` (the S3 debounce/hysteresis wrapper) under `vi.useFakeTimers` with the clock pinned to 0; "Emissions are recorded as value lists (or `\"<delegate>\"`) and asserted as whole sequences"; imports `editorApplyCompletion`/`prefixIsAnchorSafe` from `test/helpers/editor-sim.ts`.
- `test/provider.test.ts` (per spec/09 :117-130): trigger/threshold regex + delegation cases — same pull-based call shape.
- `test/adversarial-typing.test.ts` (header :1-50): e2e probes with REAL store/pipeline/dictionary and only the pi session shell mocked; Probe C drives the chain sequence through the provider's REAL `applyCompletion` ("the bare word 'Zorp' … is accepted via the provider's real applyCompletion — whose arming side effect … drives the PRD §09 M2 item 7 sequence"). Uses `editingCurrent()` (a pi-shaped mock with a persistent buffer whose `applyCompletion` visibly splices the accepted value) and `editorApplyCompletion` for pi-tui's deletion math.
- `test/chaining-gating.test.ts` (:79-115): `editingCurrent(initial, cursorCol)` + `suggest(p, lines, line, col, opts)` — "One getSuggestions call, fresh options each time"; the closest existing "request-by-request" fallback harness for arming-timing cases.
- `test/helpers/editor-sim.ts` (:1-77): NOT a tick-by-tick typing simulator — it exports only `editorApplyCompletion` (pi-tui's blind `prefix.length` deletion math, mirroring dist autocomplete.js ≈:265-267) and `prefixIsAnchorSafe`. The repo's "types keys one tick at a time" harnesses are: **widget path** — `typeChar` in `test/widget.test.ts:2000-2008` ("Model typing one character: advance the live buffer at the caret, then press the char (forwarded → the W1 microtask evaluates the NEW state)") over `makeInsertHarness` (≈:860-960, live `buf` box + `press()` + `flushPaint()`); **machine level** — `fakeEditor()` + `machine.onInput()` in `test/widget-visibility.test.ts:59-100` ("Mutable single-line editor stream: tests set text+cursor, then tick").

**How to simulate applyCompletion → next request for the BUG-004 battery (researcher recommendation):** there is no way (and no need) to make pi-tui itself re-request in these harnesses — that is precisely the contract being pinned. The battery shape that fits the existing patterns:
1. Provider-level (provider-live.test.ts style): seed a ladder store; call `getSuggestions` at `implem` → force:false; accept via the provider's real `applyCompletion` (arming side effect fires); then assert (a) NO further provider activity occurs without a new `getSuggestions` call (trivially true — document it as the pin: the provider never self-requests), (b) the NEXT `getSuggestions` call at the post-apply cursor (simulating the next keystroke's request, chaining-gating's `suggest()` shape) returns the extension/zero-char offer set with `prefix` anchor-safe (`prefixIsAnchorSafe`), and (c) clean state: `__hapaxLive()`/`__hapaxKey()` consistent, chain armed at the FINAL accepted word, grant reset exactly once per arm.
2. Display-level (provider-display.test.ts style): after the apply, assert the display layer emits NOTHING until the next `getSuggestions` (no pending swap, no timer promotion) — recording emissions as value lists per its convention.
3. Chain-level: adversarial-typing Probe C's per-hop assertions are the template for multi-hop fallback ladders.

---

## 3. Residual risks / open items

- `≈` line numbers were derived by counting within read chunks; re-verify with an editor before writing patches (the verbatim quotes themselves are exact).
- The two `applyCompletion` sites were read in the CURRENT `node_modules` dist; provider.ts's own comment says "~0.84.4". Confirm the installed version (`package.json`/lockfile) when writing the PIN so the comment cites the right version.
- h3.11/h3.15 label mapping: cited by section title because the file's literal header sequence doesn't number to 11/15; if the repo has an authoritative h3.x index somewhere (not found in this pass), align to it.
- BUG-003's production-time claim ("offer appears only at the next keystroke in live use") is researcher inference from the tick wiring (W1 microtask, no timer/no wake between keystrokes); the unit harness masks it via the `restoreReady` settle wake. A live tmux capture-pane run (spec/09 technique) should confirm before the fix is designed in detail.
- The provider.ts typed-word arming twin (≈:551-591, "Arm + STILL return null") has the same next-request timing on the fallback path; if BUG-003's fix changes the widget path, decide deliberately whether the fallback stays as-is (it has no paint site of its own — pi-tui owns the menu) — likely yes, no change.
