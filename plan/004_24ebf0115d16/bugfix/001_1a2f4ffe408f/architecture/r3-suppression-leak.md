# Research: BUG-003 — suppression keyed by numeric fragment START leaks across messages

## Claim verification

### Claim 1 — spec/07 suppression clause + numeric-start recording — VERIFIED
- spec/07-completion-ui.md:72-75: "**Explicit dismissal (Escape, boundary-Esc) suppresses the line for the REST OF THE WORD.** Re-open only at the next word start or trigger char. A disqualification close (candidates hit zero) does not suppress — the next qualifying keystroke reopens."
- src/pi/widget.ts:707-721 — `onDismissed(explicit)`:
  ```ts
  if (explicit) {
    const { lines, line, col } = deps.getEditorState();
    const match = extractMatchState(lines, line, col, deps.config);
    suppressed = true;
    suppressedFragmentStart =
      match !== null && match.mode === "threshold"
        ? col - match.fragment.length
        : col;
  }
  closeWith(now);
  ```
- State declaration: src/pi/widget.ts:482 `let suppressedFragmentStart: number | null = null;` (comment at :477-481: "released at a NEW word start (fragment start differs from the suppressed one) or trigger mode").
- R4 release check: src/pi/widget.ts:628-637:
  ```ts
  if (suppressed && match.mode !== "trigger") {
    const start = col - match.fragment.length;
    const atBoundary =
      start <= 0 || !/[A-Za-z0-9_]/.test((lines[line] ?? "")[start - 1]!);
    if (!atBoundary || start === suppressedFragmentStart) {
      return state(); // stay suppressed — hidden, flag kept
    }
  }
  ```

### Claim 2 — start-0 suppression leaks to next message's first word — VERIFIED (reproduced)
- All `onDismissed(true)` call sites (the ONLY suppression seam — see comment widget.ts:830-831 "the ONLY suppression seam; never onDismissed(false) from the key layer"):
  - **Tab acceptance**: `insertHighlighted` → widget.ts:921 `visibility.onDismissed(true); // …+ suppression until the next word start`. After insertion the caret sits at `start + display.length`; the fragment at dismissal time is e.g. "Zendesk" at start 0.
  - **Escape / boundary-Esc**: widget.ts:1117-1120 `state.hide(); machine.onDismissed(true);`
  - **Enter (enter-submit)**: widget.ts:1113-1119 (inside `widgetHandleInput`'s `decision.action === "enter-submit"` branch): `state.hide(); machine.onDismissed(true);` then `return forwardInput(data)` — dismiss-then-forward per spec §07:83-85 ("Enter ALWAYS submits… Enter dismisses the line, then forwards").
- Enter-submit forwarding path: widget.ts:1110-1121; `forwardInput` (widget.ts:1108-1110) delegates to the enter-submit proxy's `handleInput`; the guard's clock seam ticks and the inner editor submits, clearing the buffer. The visibility machine is NOT reset on submit — its suppression state survives into the freshly cleared buffer.
- Live repro (tsx harness, /tmp/bug003/harness.mts, machine with canned query): msg1 "ze" → paint → `onDismissed(true)` after "Zendesk" inserted → msg2 fresh buffer "lw" at col 2 → `onInput()` returns `{visible:false, suppressUntilWordStart:true, currentSet:[]}` although "lw" and "lwlock" match; second word " qu" (start 3 ≠ 0) → `visible:true`. Exactly as claimed: first word of msg2 silently loses its completion line because `start === suppressedFragmentStart === 0` (widget.ts:634).

### Claim 3 — fix directions — evaluated in "Recommended fix design"

## Exact contracts

- `VisibilityMachine` interface, widget.ts:368-376:
  ```ts
  interface VisibilityMachine {
    onInput(): VisibilityState;
    onDismissed(explicit: boolean): void;
    getState(): VisibilityState;
    dispose(): void;
  }
  ```
- `VisibilityMachineDeps`, widget.ts:324-355: `store`, `config`, `restoreReady`, `getEditorState(): { lines: string[]; line: number; col: number }`, optional `query`, optional `isIntentBypass()`, optional `onPaint()`.
- `VisibilityState`, widget.ts:~305-315: `{ visible: boolean; suppressUntilWordStart: boolean; currentSet: readonly {display:string}[] }`.
- Machine state vars: `visible` (:464), `suppressed` (:465), `suppressedFragmentStart` (:482), `lastFingerprint` (:468, already computed every `onInput` as `lines.join("\n")` at :598 — a buffer fingerprint ALREADY EXISTS at the seam), `lastLine/lastCol` (:469-470), `closeAt` (:502), startup gate (:505-507).
- Trigger-char bypass (already exists, untouched by any fix): widget.ts:628 `if (suppressed && match.mode !== "trigger")` — trigger mode skips the whole suppression block; `paint()` (:529-541) clears `suppressed`/`suppressedFragmentStart` on any qualifying paint.
- Does the machine see buffer text? YES — `getEditorState()` returns `lines` and `evaluate` uses them (stock context classify :612, `extractMatchState` :617, boundary test :633, fingerprint :598). So a buffer-context release condition needs NO new dependency injection.
- Exposed seams for tests: proxy keys `WIDGET_STATE`, `WIDGET_MACHINE` (widget.ts:1163-1164).

### Full state model (as implemented)
- Inputs: `onInput()` (every editor input event, deferred to a microtask post-keystroke, widget.ts:1076-1083), `onDismissed(explicit)` (only from widget key layer: Tab-accept, Escape, boundary-Esc, Enter-submit), gate wakes (`wakeEvaluate` :568).
- Outcomes per tick: stock-context `hide()` (no close stamp, no suppression, :612-615); no-fragment `closeWith(now)` (:618-624); gate hold (:627-630); disqualification `closeWith` (:625 area, `matches.length===0` → closeWith, NEVER suppress); suppression hold (:628-637); hesitation hold; `paint()` (releases suppression); `parkSwap`.

## Recommended fix design

Fix direction verdicts (question C):
1. **start===0 + fresh-buffer heuristic** — fragile: "fresh buffer" is not directly observable (an in-message full backspace to col 0 is indistinguishable from a new message at start 0 only by fingerprint), and it would NOT release a start-0 suppression whose fragment wasn't at 0 after Enter at column >0… it only patches one symptom. REJECT.
2. **reset-on-submit** — the widget layer's enter-submit branch fires only when the line is VISIBLE; after a Tab acceptance the line is hidden, so Enter forwards with no dismissal hook (widget.ts:934-941 pins hidden-Enter forwards with NO suppression bookkeeping — adding a reset there would fight that test's intent but is compatible). Submit detection when hidden would need the enter-submit guard to expose a submit event — a new seam through editor.ts. Works but touches two layers. SECOND CHOICE.
3. **Buffer-context release (fingerprint at dismissal)** — RECOMMENDED. The machine already computes `lines.join("\n")` every tick; recording it at dismissal and releasing when the current buffer is no longer a same-word continuation handles ALL leak sites (Tab-acceptance, Escape at start 0, Enter-submit at start 0) in one place, inside the machine, with no new seams. It also automatically releases BUG-001's chain-offer-at-start-0 interference (see Risks).

Steps (for a developer with no other context):
1. In `src/pi/widget.ts` `createVisibilityMachine`, next to `suppressedFragmentStart` (:482) add:
   ```ts
   let suppressedFingerprint: string | null = null; // buffer at dismissal (BUG-003)
   ```
2. In `onDismissed(explicit)` (:707-721), after computing `lines`, record `suppressedFingerprint = lines.join("\n")`. Guard the empty case: if the dismissed fingerprint is `""` (dismissal with an empty buffer — no word to suppress), still set `suppressed = true` but set `suppressedFingerprint = null` meaning "no context; release at any boundary".
3. In `evaluate`'s R4 block (:628-637), change the stay-suppressed condition so same-start is only honored while the buffer is a same-word continuation of the dismissed one. Compute `const fingerprint = lines.join("\n")` (already available in `onInput`; `evaluate` receives `lines` and can rebuild it, or hoist the fingerprint into `evaluate` — the `onInput` fingerprint at :598 is computed before `evaluate` is called, so the simplest change is to pass it in or recompute). New condition:
   ```ts
   const suppressedFp = suppressedFingerprint;
   const sameWordContinuation =
     suppressedFp !== null &&
     (fingerprint.startsWith(suppressedFp) || suppressedFp.startsWith(fingerprint));
   if (!atBoundary || (start === suppressedFragmentStart && sameWordContinuation)) {
     return state(); // stay suppressed
   }
   ```
   Rationale: within one message, editing/extending the dismissed word keeps one buffer a prefix of the other (backspace included); a submitted-and-cleared buffer ("lw" after "Zendesk") is neither → released at the boundary start 0. A new word in the SAME message ("Zendesk lumen") still releases via `start !== suppressedFragmentStart`, unchanged.
4. Keep `paint()` (:529-541) clearing both fields; keep the trigger-char bypass (:628) untouched — it already re-opens at a trigger char per spec.
5. Add a regression test mirroring the harness: dismiss at start 0, then a fresh-buffer first word must paint (see Tests).

## Tests

Must-keep-passing (pin rest-of-word suppression / trigger reopen / non-suppression):
- test/widget-visibility.test.ts:282 `it("suppression: onDismissed(true) hides; extending the SAME word stays hidden; a new word reopens")` — with the recommended fix, "zend"→"zendeskl" is a prefix continuation → still hidden; " lumen" start differs → released. PASSES UNCHANGED (good — it pins the same-word semantics, not the numeric key itself).
- test/widget-visibility.test.ts:316 `it("suppression: a trigger char reopens despite suppression")` — trigger bypass, unchanged.
- test/widget-visibility.test.ts:342 disqualification-never-suppresses — unchanged.
- test/widget.test.ts:526 boundary-Esc suppressed (:535-537); :558 clamp not suppressed; :578 Escape suppressed; :588 close-without-dismissal never suppresses; :756 Tab-acceptance suppressed (:767); :860-862 trigger-forward not suppressed; :912 Enter dismiss-then-forward suppressed (:931); :934 hidden-Enter no suppression. All assert the flag immediately after dismissal — unaffected by a release-condition change.

Must-add (no existing test pins the numeric-start release against a fresh buffer — none must CHANGE under the recommended design):
- New: widget-visibility test "suppression at start 0 releases for the first word of a fresh buffer (BUG-003)" — the /tmp/bug003/harness.mts sequence.
- New: same-word backspace-after-Escape stays suppressed (pins the prefix-window rule): dismiss on "zend", backspace to "zen", retype "zenx" at start 0 → still hidden.
- If direction 2 (reset-on-submit) were chosen instead, test/widget.test.ts:934 ("Enter while hidden forwards verbatim with NO dismissal and NO suppression") would need a companion showing suppression CLEARED by the hidden-Enter submit — an interaction with that test's intent.

## Spec citations & drift
- spec/07-completion-ui.md:72-75 — exact clause quoted in Claim 1. Also :83-85 (Enter always submits, dismiss-then-forward) and :76-82 (Tab inserts the highlighted word).
- Drift: the CODE over-suppresses relative to spec intent. "Re-open only at the next word start" — the first word of a new message IS a next word start (the buffer was cleared; nothing about it is "the rest of the word" that was dismissed). The numeric-start comparison is an implementation of "same word" that fails when the buffer resets. NO spec wording change needed — the fix restores spec intent. (Optional: add one clarifying sentence to §07 that a buffer reset/new message counts as a new word start, but not required by the binding text.)

## Risks & edge cases
- **BUG-001 interaction (ordering dependency)**: BUG-001 is chain offers at an EMPTY word start after a Tab acceptance — exactly when suppression is still active at start 0. Whichever fix lands SECOND must re-verify: if BUG-001's fix adds chain-successor paints through the machine, the current BUG-003 leak would suppress those offers at start 0 (chain intent should show immediately — note `isIntentBypass` at :352/:640 is the existing intent seam and trigger mode already bypasses). Both fixes touch `evaluate`'s R4 block / the same `suppressed*` state in `createVisibilityMachine` — land them in one change or sequence carefully and re-run both test files.
- **Prefix-window edge**: after Escape on "zend", selecting/inserting nothing and deleting the entire word then typing a new first word releases suppression (buffer no longer prefix-related) — acceptable; the dismissed word is gone, spec's "rest of the word" no longer applies.
- **Empty-buffer dismissal**: if `onDismissed(true)` ever fires with an empty buffer, `suppressedFingerprint = ""` is a prefix of EVERYTHING → leak persists. The step-2 guard (treat as context-free: release at any boundary) closes this; alternatively skip suppression entirely when the buffer is empty (there was no word).
- **Multi-line buffers**: fingerprint is `lines.join("\n")` over the whole buffer (:598); prior-message transcript lines (if any linger in `lines`) only make the prefix check STRICTER — no false releases. If pi keeps history in the same `lines`, verify with the live TTY technique in spec/09 (UI-layer change ⇒ live TTY verification, per AGENTS.md).
- **Stock contexts**: unaffected — stock ticks hide without suppression (:612-615); release logic only runs when `extractMatchState` yields a word-mode match.
- **Enter-always-submits**: the enter-submit branch (:1110-1121) stays byte-identical; the fix is purely inside the machine's release condition, so the dismiss-then-forward ordering and the exactly-once forwarding tests (widget.test.ts:912-932) are untouched.
