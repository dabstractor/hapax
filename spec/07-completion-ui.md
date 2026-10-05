# 07 — Completion UI

## Display architecture (2026-10 owner rule: one-line widget, dual-path)

hapax displays word suggestions on its own **one-line result widget** —
not pi-tui's vertical SelectList (which renders one item per row, with
an optional right-hand description column, and has no horizontal
mode). Two paths, decided at session start:

- **Primary (widget):** when an editor factory exists — some extension
  installed an editor, so hapax's editor proxy (below) can compose
  around it — hapax renders the widget and owns display and key
  semantics entirely. No autocomplete provider is registered on this
  path; stock path/slash/`@` completion is untouched by construction.
- **Fallback (stock vertical menu):** pi exposes no stock editor to
  extensions (`getEditorComponent()` is undefined until an extension
  sets one). Where no factory exists the proxy cannot install and the
  widget cannot run; there hapax registers the provider below and
  displays through pi-tui's vertical menu (the pre-2026-10 behavior,
  single-item forced return included). Both paths share the query
  core (04), the startup gate, and the debounce/hysteresis timing.

**Session lifecycle (rebind, 2026-10):** `session_start` builds a fresh
store/pipeline/chain/restore-gate per fire and can fire repeatedly
in-process (resume, session switch). The widget path therefore
RE-BINDS on every re-fire: the installed wrapper is replaced by a
fresh composition around the ORIGINAL pre-hapax factory (remembered
in the wrapper's introspection seam), bound to the new session's
deps. This preserves the no-stacking invariant (a wrapper is never
wrapped again) while never leaving the widget reading a previous
session's store — the pre-2026-10 keep-installed behavior left
completions serving stale vocabulary after any `/resume` (violating
acceptance item 3; live-observed via the §09 technique). The fallback
path re-registers a fresh provider per fire and needs no such step.

Considered and rejected (2026-10, recorded for history): a single
synthesized menu item whose label is the joined line (zero pi-tui
changes, but arrow selection of non-top words is lost) and waiting
for an upstream pi-tui horizontal menu mode (no timeline; blocks the
display change indefinitely). The owner chose arrow selection on an
own-rendered line.

### One-line widget (primary display)

- One line directly below the input editor: items joined by `" | "`,
  rank order left→right (04), never wraps. The right-hand column is
  RETIRED: no `Session xN` frequency, no `description` provenance (the
  `chain` marker included). Frequency still ranks (04); it just isn't
  displayed. A result item is the candidate display string, nothing
  else.
- Line cap = terminal WIDTH first: fill the screen edge with as many
  words as fit (2026-10 owner rule — the count cap is a vertical-menu
  relic; on a one-line surface width is the resource, as in shell
  completions), bounded above by `maxSuggestions` (default 20 = the
  schema max, so width binds on every realistic terminal). Overflow
  drops the lowest-ranked (rightmost) items first.
- Zero candidates never render content (invariant 3). UNCLAIMED (never
  shown this prompt — Line claim below), zero candidates mean no row at
  all; once the row is CLAIMED, zero candidates render the row blank.
- The highlight (theme accent) sits on the leftmost/top item by
  default and resets to it on every result-set change.

### Line claim — the row is owned for the prompt's duration (2026-10 owner rule; status: adopted ahead of implementation — code lands with this spec)

**Problem.** Every hide verdict (zero candidates, disqualification,
trailing space, dismissal, stock context) removes the row below the
editor, and the next show re-adds it — the entire input area bounces
up and down by one line while the user types. The stock vertical menu
never had this problem: pi-tui reserves the menu's space until the
interface reflows (e.g. submit). The widget must do the same, for one
line.

**Rule.** The moment the line first renders a NON-EMPTY result set
during a prompt, hapax CLAIMS the row directly below the input
editor. From that instant until release, the row exists
unconditionally: every state that would otherwise hide the line —
zero candidates, disqualification, trailing-space close, Escape or
boundary-pass-through dismissal, the rest-of-word suppression window,
stock-owned path/slash/`@` contexts — renders the row BLANK (empty
content: no words, no separators, no highlight) instead of removing
it. Layout is frozen for the rest of the prompt; appearance and
disappearance of suggestions become content-only changes, never
layout changes.

**Arming.** Only a first non-empty display claims. A prompt that never
produces a visible result set never grows a row — no pre-emptive
blank line for every prompt; minimal height for never-suggesting
prompts is kept.

**Release.** The claim releases — the row is removed until some later
first-show re-claims it — exactly on the interface-reflow events:
prompt submission (the Enter that actually submits, not a
newline-inserting one; the same keystroke the Enter-submits proxy
forwards), `before_agent_start` (the same turn boundary that resets
the chain state), `session_start` re-fire (rebind — never leave a
claimed row serving a dead session), and `session_shutdown`.
Terminal resize and stock-UI reflow re-render the layout but do NOT
release the claim — the row returns blank or with content per current
state; the claim is widget-layer logical state, not a property of any
one render.

**Invariant interplay.** A claimed blank row is reserved whitespace,
never a zero-candidate render: invariant 3 governs candidate CONTENT,
and no content is ever painted without candidates. The fallback path
is untouched (pi-tui's vertical menu manages its own space
reservation).

### Widget key handling (amends the never-hijack invariant; 2026-10)

While the line is visible, the editor proxy consumes — before the
inner editor sees them:

- **All four arrows navigate.** ← and ↑ move the highlight left; →
  and ↓ move it right. (Owner-accepted capture of the arrow cluster
  once the list is entered — an arrow that moved the highlight;
  boundary pass-through below is the un-entered escape hatch.)
- **Boundary pass-through (owner refinement; 2026-10 one-press rule;
  status: adopted ahead of implementation — code lands with this
  spec).** ↑ or ← while the highlight is on the FIRST word of an
  UN-interacted generation: the line dismisses, suppression arms
  until the next word start, and the press FORWARDS verbatim to the
  editor — the caret moves on that same keypress. ONE press,
  plain-pi parity: a user who never enters the list experiences
  ↑/← exactly as with no extension installed. (Supersedes the
  consumed-press variant — first press dismisses, second moves the
  caret — rejected by the owner 2026-10: no second press.)
  Symmetric transparency: → or ↓ with nothing to navigate (a
  one-word line, un-interacted) forwards verbatim too and the line
  simply stays — NO arrow press is ever consumed before the list
  has actually been entered.
- **Carousel after interaction (2026-10 owner rule; status: adopted
  ahead of implementation — code lands with this spec).** A
  generation is one continuously-displayed result set. The first
  arrow press that MOVES the highlight — →/↓ entering an
  un-interacted multi-word line — marks the generation as
  interacted; from then on, for that generation only, the arrow
  cluster is captured and both edges wrap end-to-end: ↑/← on the
  FIRST word wraps to the LAST, →/↓ on the LAST word wraps to the
  FIRST. The clamp is RETIRED — unreachable: reaching the last word
  requires navigation, which interacts the generation, and
  interacted edges wrap. Plain Escape is unchanged (always dismiss +
  suppress) and is the exit once interacted. A genuinely new result
  set (narrowed, replaced, or otherwise changed) starts a FRESH
  generation: the highlight returns to the first word, the
  interaction flag resets with it, and boundary pass-through is
  available again. A pass-through press never sets the flag (no
  movement happened) — a one-word line therefore never becomes
  interacted and keeps full plain-pi arrow behavior. Tab inserts
  and Enter submits are unaffected by the interaction state.
- **Explicit dismissal (Escape, boundary pass-through, Tab-accept,
  Enter-submit — all through the same suppression seam) suppresses the
  line for
  the REST OF THE WORD.** Re-open only at the next word start or
  trigger char. A disqualification close (candidates hit zero) does
  not suppress — the next qualifying keystroke reopens. Suppression
  hides CONTENT only: a claimed row renders blank through the
  suppression window (Line claim above).
  **Suppression lapse (2026-10 owner rule, live-observed wedge fix):
  suppression also ends the moment a tick OBSERVES the dismissed word
  occurrence GONE — the live buffer is a prefix of the dismissed
  buffer that no longer reaches the dismissed fragment's start (the
  word fully backspaced, the empty buffer included).** What is typed
  there next is a NEW word at a word start ("re-open at the next word
  start" includes a retyped one), never a same-word continuation.
  Without this, a Tab-completed FIRST word (fragment start 0, no
  preceding space to delete) wedged forever: every retype was
  prefix-indistinguishable from same-word backspacing, and mid-prompt
  recovery demanded deleting the word AND the space before it. The
  lapse only ever RELEASES (shows sooner): the completed word still on
  screen never lapses (the buffer still reaches past its start — this
  is exactly the immediate post-Tab re-offer guard), and EXTENDING the
  dismissed word (the dismissed buffer a prefix of the live one) stays
  suppressed for the rest of the word as before. The Enter-submit
  variant's cleared buffer lapses on the next observed tick, so a
  single-word submitted prompt can no longer wedge the next prompt's
  prefix-sharing first word.
- **Tab inserts the highlighted word** (leftmost if none
  highlighted), synchronously against the live query — never gated by
  the display debounce (invariant 2). Insertion replaces the live
  fragment span (word regex or `#fragment`, below) with the
  candidate's resolved casing (04 Case handling: a typed capital first
  letter is preserved — only the first letter adapts; typed lowercase
  inserts the winning form verbatim): stock `applyCompletion`
  semantics, reimplemented on the widget path because no provider
  item exists there.
- **Enter ALWAYS submits, never inserts** — the Enter-submits proxy
  rule extends to the widget: Enter dismisses the line, then forwards
  the keystroke so the inner editor submits.
- **Everything else forwards verbatim.** Typing updates the query and
  the line per the debounce/hysteresis rules; no text is ever altered
  outside Tab-insertion.

Invariant amendment (binding; SPEC.md): the never-hijack invariant's
sanctioned captures are now Tab while a suggestion is selected, the
Enter-submits proxy, and — while the result line is visible — the
four arrows and Escape. Outside those windows, zero key handling.

### Widget visibility state machine (auto-open, re-based)

The widget path does not depend on pi-tui's request cadence (the
one-request-per-word constraint was the vertical-menu world's).
Visibility is driven by the editor proxy's input clock (already the
hesitation gate's timing source) plus hapax's own context detection
on each keystroke:

1. Extract the live fragment per the regexes below (trigger char,
   word fragment). Path/slash/`@` contexts: line hidden (stock
   completion owns them).
2. Fragment live + ≥ 1 candidate above the fuzzy threshold (04) →
   line visible, subject to `menuDelayMs` (hesitation gate) and the
   100 ms swap debounce — both carried over unchanged.
3. Trailing space with no `@`/`/` in text-before-cursor → hidden
   (close-on-space carried over as the widget's own state).
4. Cursor move, Escape, boundary pass-through, disqualification →
   hidden (flicker hysteresis carried over: narrowing must not
   close-and-reopen).
5. The startup restore gate (below) applies identically.

Throughout this machine, "hidden" is a CONTENT verdict: while the row
is claimed (Line claim above), every hidden state renders the row
blank rather than removing it; only an unclaimed hidden state renders
no row at all.

## Provider integration (fallback path only)

Single registration in the `session_start` handler — used ONLY when
no editor factory exists (see Display architecture):

```ts
ctx.ui.addAutocompleteProvider((current) => ({
  // trigger char PLUS every identifier char [A-Za-z0-9_] — see
  // "Auto-open" below: pi-tui only auto-requests on keystrokes whose
  // char is a registered trigger character at a word start
  triggerCharacters: [config.triggerChar, ...IDENTIFIER_CHARS],
  async getSuggestions(lines, line, col, options) { /* below */ },
  applyCompletion(lines, line, col, item, prefix) {
    return current.applyCompletion(lines, line, col, item, prefix);
  },
  shouldTriggerFileCompletion(lines, line, col) {
    return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true;
  },
}));
```

Delegate `applyCompletion` to `current` (built-in insertion semantics are
correct: replace the matched prefix with `item.value`). Only override
insertion if validation proves a need. The one sanctioned exception to
"never touch the editor" is the Enter-submits wrapper below.

The wired stack (`src/pi/index.ts`) composes bottom-up: hapax core
query (04) → startup gate → display layer — the widget (primary:
hesitation gate + 100 ms swap debounce + key handling) or provider
registration (fallback). The editor proxy (below) wraps whichever
factory the extension ecosystem installed and feeds the shared input
clock; the widget path depends on it.

## Auto-open (fallback path): how the menu ever appears

Fallback path only — the widget opens per its own visibility state
machine (Display architecture above). pi-tui's editor only CALLS `getSuggestions` while the user types plain
letters under narrow conditions: the typed char must be a registered
trigger character, at a word start (line start or after space/tab) — the
first letter of each word — and once a menu is open it re-requests on
every keystroke (self-updating). Consequences, all load-bearing:

- hapax registers `[A-Za-z0-9_]` as trigger characters so the FIRST
  letter of a word produces a request (the stock letter/continuation
  branch is unreachable when letters are registered — branch shadowing).
- The word-start request carries a 1-char fragment. The effective
  threshold is therefore **1**: `config.threshold` (1–3) is retained for
  schema compatibility but inert in the live editor — a threshold above
  1 is unobservable, because pi-tui never asks at "N chars in" and a
  delegated (empty) answer at 1 char means no menu ever opens and no
  further request arrives for that word.
- The menu opens when the 1st-char query returns candidates; zero
  candidates → delegation → nothing renders, and pi-tui cancels.
- hapax still delegates whenever no fragment matches, so stock contexts
  (slash, @, paths) are unaffected by the registered letters.
- Path-class candidates (04, rule 4d, 2026-10) surface at a path's
  FIRST segment (`sr` → `src/core/query.ts`); once a `/` precedes the
  cursor, stock pi file completion owns the rest — unchanged.

## Trigger modes

Two lookup modes, both always active:

1. **Trigger char** (default `#`): the regex `/(?:^|[ \t])#([^\s#]*)$/` on
   text-before-cursor. When matched, lookup starts from the **first** char
   after `#` (0-char minimum: `#` alone lists the top candidates in
   frequency order — sessionCount desc, 04's zero-fragment rule). On
   completion, `applyCompletion` (fallback) or the widget's Tab
   insertion (primary) replaces `#fragment` with the word (trigger
   char is consumed).
2. **Word matching**: the regex `/[A-Za-z][A-Za-z0-9_-]*$/` on
   text-before-cursor (inner and trailing hyphens admitted — hyphenated
   compounds are single candidates per spec 04 rule 4b, so mid-compound
   continuation queries the compound prefix: `load-b` → fragment
   `load-b`, never `b`; leading hyphens never enter a fragment —
   `--flag` yields fragment `flag` and the `--` survives insertion),
   effective from **1** typed char (see
   "Auto-open" above; `config.threshold` is inert). Fires **everywhere** —
   any word start, any context, not just after whitespace. This is
   settled: we never gate on position because the menu never interferes
   with typing (see invariants).

Priority: trigger-char match wins; otherwise word-fragment match;
otherwise `return current.getSuggestions(...)` untouched (path/slash
completion must keep working exactly as before, including inside quoted
paths).

Case-insensitive **anchored fuzzy** match (04 — first char exact,
subsequence after, threshold-gated, tier-ranked); insertion uses the
resolved casing (04 Case handling).

**Match gates per mode (2026-10 owner rules; 04).** Word matching is
anchored-only PLUS the zero-result tier-0 fallback: one anchorless
contiguous-run pass (fragment ≥ 3, score 85 − 40·runStart/len,
threshold-gated) when — and only when — the anchored scan returns
nothing. Trigger-char matching is the loose mode: tier-0 runs always
consulted (no zero-result precondition; `#query` →
`src/core/query.ts`) and scattered tier-1 visible (`#` default
threshold 45 vs ambient 60; an explicit `fuzzThreshold` overrides
both modes). Successor chaining stays anchored everywhere — tier-0
matches never arm or extend a chain.

## Debounce, flicker, and the Tab contract

Four interacting rules, implemented in the provider:

0. **Tab only ever completes — it never opens anything.** A single Tab
   keypress, when a live suggestion set exists (computed synchronously,
   whether or not the debounced popup has painted it), completes the
   **selected** item — or the **top** item if none is selected — immediately.
   (Widget path: the proxy consumes Tab while the line is visible and
   inserts the highlighted word — exactly this rule. Fallback path:
   the forced single-item return below.)
   Tab must never open, toggle, summon, or expand the menu. Menu visibility
   is driven exclusively by typing: the menu opens automatically on the
   1st char of any word matching a candidate, on the 1st char after the
   trigger char, and at the zero-char chain offer (see chained
   completion). There is no manual open gesture of any kind, and
   completion is always exactly one keypress.

1. **Synchronous search, every keystroke.** `getSuggestions` runs the store
   query (< 1 ms) on every call and caches the result set. Tab resolves
   against this live result — **never gated by the debounce**. (Known minor:
   tab may insert a top item before the popup painted it; accepted, see 01.)
   Tab resolves to a completion, never to a menu-open action.
2. **Display debounce: 100 ms — and an OPTIONAL hesitation gate on
   first appearance (`menuDelayMs`, **default 0 = OFF**).** Suggestions
   are
   *returned* to pi immediately from the live query, but:
   - First appearance: with `menuDelayMs: 0` (default) the menu paints
     immediately at the word-start query — the auto-open behavior. A
     non-zero value arms a hesitation gate: while the menu is CLOSED,
     a word-completion paints only when the keystroke that triggered
     the query arrived ≥ `menuDelayMs` after the PREVIOUS keystroke
     (typing with gaps under the threshold never pops the menu).
     CALIBRATION HISTORY (binding): the gate was built to stop
     constant popping that was actually caused by stuck chain offers
     and relief-word clutter (both since fixed). Thresholds 150 ms
     (still popped) and 300 ms (never popped) both failed against
     real typing — the owner's word-boundary gaps straddle any fixed
     value, and because a word's first-letter query is its ONLY one
     (pi-tui asks once per word), suppression is permanent per word.
     Default is therefore OFF; the knob stays for owners with a
     measured pause length. If popping ever returns as a complaint,
     instrument real keystroke gaps before picking any value —
     thresholds chosen without measurement failed twice (150, 300).
     Keystroke times come from the editor
     proxy's input clock; without an editor factory the gate degrades
     to query-gap timing (rarely suppresses). Explicit intent —
     trigger-char results and armed-chain successors — bypasses the
     gate and shows immediately. Forced (Tab) requests are unaffected
     (rule 0/1.5). `menuDelayMs: 0` restores the pre-2026-09 immediate
     first paint.
   - Subsequent set changes: the provider suppresses non-empty result
     *sets* that differ from the currently displayed set within 100 ms
     of the last paint. Implementation: timestamp of last visible set;
     if a new set arrives < 100 ms after paint, schedule the swap on a
     100 ms timer; if another keystroke supersedes, replace the pending
     set. The menu thus updates at most every 100 ms, between
     keystrokes.
3. **Flicker hysteresis.**
   - **Empty = invisible.** Zero candidates → return empty/delegate; the menu
     never renders. (Inherited from built-in behavior; assert in tests.)
     Widget path: empty means no CONTENT — no row while unclaimed, a
     blank CLAIMED row otherwise (Line claim above).
   - Once visible, the set only ever **narrows, replaces, or closes** — a
     narrowing keystroke (`zend` → `zendk`) must not close-and-reopen.
   - Close events: disqualification (no candidates), cursor move, escape,
     space. A close followed by a qualifying keystroke within 200 ms re-opens
     fresh (no stale set).

### Startup restore gate

History replay (05) runs in the background after `session_start`, and
pi-tui asks the provider exactly once per word — so a word queried
while the store is still replaying got zero candidates and never
re-asked: its menu was permanently missing until retyped (observed:
"first typed word after restart missed its menu"). The provider stack
carries a bounded startup gate (`createStartupGate`, src/pi/provider.ts):
queries racing an unfinished replay wait for the replay's settled
signal (`restoreFromHistory` onSettled — fires exactly once on
completion, abort, or error) or **≤ 500 ms**, whichever comes first.
Effect: the first typed word's menu is at most ~500 ms late instead of
missing. Fresh sessions (no replay) resolve the signal immediately —
the gate is a no-op there. Forced (Tab) requests wait under the same
bound during that window only; the synchronous-query Tab contract
(rule 1) applies to the steady state, which is unchanged.

### Tab-open gesture: root cause (traced) and mitigation

(FALLBACK PATH ONLY — on the widget path Tab is consumed by the editor
proxy before this editor branch can run, and no provider answers word
fragments, so no stock menu can open for them; the bug class is
structurally absent there.)

The "Tab opens the menu" gesture originates in **pi-tui's editor**
(`components/editor.js`), not in hapax:

- **Tab while the menu is open** → completes the selected item via
  `applyCompletion` (one keypress). Already correct.
- **Tab while no menu is open** → `handleTabCompletion()` →
  `forceFileAutocomplete(true)` → `requestAutocomplete({ force: true,
  explicitTab: true })` → `getSuggestions(lines, line, col, { force: true })`.
  In `runAutocompleteRequest` the editor then branches on the result:
  - `items.length === 1` → it **applies the completion immediately**
    (single-item fast path — one keypress, no menu).
  - `items.length > 1` → it **opens the menu** in state `"force"`.

hapax ignored `options.force` and returned its full ranked word set
(> 1 item), so a Tab pressed before the debounced popup had painted —
or after a set change — landed in the menu-open branch. That is the bug.

**Mitigation (extension-only; no pi-tui changes required):** in
`getSuggestions`, when `options.force === true` AND a hapax fragment is
live (threshold word, trigger char, or armed-chain word start), return a
**single-item** set: the top-ranked item per 04 ranking (during an armed
chain, the top successor). pi-tui's existing single-item fast path then
applies it in the same keypress. Rules:

- The forced single-item return bypasses the 100 ms display debounce
  (forced requests are undelayed by design); always return the live top
  item.
- When hapax has no live fragment (path/slash contexts), delegate to
  `current.getSuggestions(...)` passing the options object through
  unchanged, so stock path/file completion keeps its native Tab behavior.
- Empty live set on force → return empty; the editor cancels and renders
  nothing (stock behavior for "no completion available").
- Verify against pi-tui updates: this leans on the
  `force && explicitTab && items.length === 1` branch; if pi-tui ever
  changes that contract, the mitigation needs revisit (the zero-char
  chain offer and auto-open rules are unaffected).

### pi-tui contract dependencies (re-verify on upgrades)

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

## Never-hijack rules (acceptance-critical)

- No key handling outside `applyCompletion`/Tab semantics — with the one
  sanctioned exception of the Enter-submits proxy (below), which cancels
  hapax's own menu and alters no text.
- **Close-on-space (2026-09, "stuck file menu" fix):** a NON-forced
  query at a plain trailing space — no `@`, no `/` in the text before
  the cursor — returns null (menu closes) instead of delegating (widget
path: the line hides at trailing space by its own state machine). pi's
  stock provider treats text-ending-in-space as the start of file
  completion (`extractPathPrefix` returns `""` → the whole cwd
  listing); in stock pi that is reachable only through deliberate
  flows (Tab-forced file menu, `@` attachments), but a hapax menu open
  at a word delegated straight into it on space and got REPLACED by a
  file listing nobody asked for. Forced (Tab) requests keep native
  delegation; `@`/`/`-bearing text keeps stock behavior; the armed
  chain's zero-char offer (evaluated earlier) is untouched.
- **Tab never opens the menu.** Menu opening is automatic (typing-driven)
  only: 1st-char word match, 1st char after the trigger char, or the
  zero-char chain offer. There is no manual open gesture; Tab completes,
  full stop.
- Fallback path: Escape, arrows, backspace, space behave exactly as
  stock pi. Widget path: arrows and Escape are consumed only after
  the list is entered (boundary pass-through above moves the caret
  on the same press); backspace and space behave as
  stock.
- Tab with no live suggestion set passes through as a literal Tab.
- The user can type an entire session and never trigger a menu for common
   words: `the`, `context` are rank-rejected; conjugations of common words
   (`deleted`, `lists`) are guard-rejected; zero-candidate queries never
   render anything.

## Enter always submits (editor proxy)

pi-tui's stock `handleInput` handles the autocomplete branch BEFORE the
submit branch: while any menu is open, Enter accepts the highlighted item
and the submit branch never runs (slash menus are special-cased to
accept-then-submit; word menus just swallow the key). With auto-open
menus this is disqualifying: finish a word that prefixes a candidate,
press Enter to send, and the candidate gets inserted instead. Policy
(shell convention — fish, zsh): the completion menu is advisory, **Tab
is the accept key, Enter ALWAYS submits.** This is non-negotiable for
this extension.

Mechanism (`src/pi/editor.ts`): hapax captures the editor factory set by
any extension (pi-vim, split-editor, … — the documented capture-previous
composition) and returns a **Proxy** around the factory's instance:
`handleInput` is the only overridden member — when the configured submit
key arrives while a **non-slash** menu is open, it cancels the menu
before delegating, so the inner editor's own submit branch handles that
same keystroke. Everything else (get/set/has, functions bound to inner)
forwards verbatim; `then` is undefined so the proxy is never a thenable.
Slash menus keep stock accept-and-submit. No text is ever altered; the
guard body is fully defensive (worst case inert, never broken).

**HISTORY — v1 monkey-patch crashed (recorded so it never returns):**
v1 patched `handleInput` as an own property on the constructed editor
instance. Sibling wrappers forward keystrokes with DYNAMIC reads
(split-editor: `this.inner.handleInput?.(data)`), so the mutated
property cycled: patch → captured forwarder → dynamic read → patch → …
= `RangeError: Maximum call stack size exceeded` (reproduced live with
pi-vim + split-editor + Shift+Tab). Lessons, both binding: (1) NEVER
mutate a shared editor instance — compose with a forwarding proxy that
leaves the inner untouched (the pattern split-editor itself uses);
(2) any fix here must be verified against the real extension stack
(pi-vim + split-editor + pi-nvim-bridge), not unit tests alone.

Limitation: pi does not expose its stock editor to extensions
(`getEditorComponent()` is undefined until an extension sets one), so
the proxy installs only when an editor factory exists. In a
stock-editor session pi's Enter-accepts behavior stands; the universal
fix belongs upstream in pi-tui (non-slash confirm → cancel + fall
through, exactly as this proxy does).

## M2: chained completion

State machine, armed by acceptance or by typing of a series member:

```
idle ──Tab accepts word W──► armed(W)
idle ──space closes a typed word whose first letter is UPPERCASE and
       whose lowercase key has series successors──► armed(W)
armed(W):
  - word start (cursor at the empty next word, ZERO typed chars) → offer
    the successors of W immediately: series successors first (count
    descending among them), then ordinary successors (count descending).
    No trigger char, no threshold, no typed
    fragment needed — the top series successor is the top result before
    the user types anything. This is the entire meaning of "phrase
    completion".
  - ONE-SHOT GRANT (2026-09): the immediate offer is granted for exactly
    ONE word per acceptance. Typing through that offer without accepting
    disarms at the next word boundary — the normal path (under the
    hesitation gate) answers from there. Rationale: chain results carry
    the display layer's intent bypass, so an indefinitely-armed chain
    popped immediate menus at EVERY word start for the rest of the
    message after a single Tab (live-reproduced; fixed same day).
    Acceptance re-arms with a fresh grant: Tab→offer→Tab→offer flows
    exactly as before.
  - typed chars filter the live successor list with the same
    anchored fuzzy matcher (04) as a membership gate — INCLUDING its
    exact-equal exclusion (04 h2.29 parity): a successor the user has
    fully typed is filtered out, so typing an offered word to
    completion empties the filter, disqualifies, and resets the arm on
    that same keystroke; ranking within a chain stays
    SUCCESSOR-COUNT-based (the successor index's counts,
    not sessionCount — chains are bigram-driven by design); threshold
    stays 0 for the duration of the chain
  - Tab during armed (selected item, or top if none selected, per rule 0)
    → insert it (ONE word), transition armed(next)
  - Any non-Tab key that disqualifies (space, escape, punctuation) → idle
  - Typing continues to filter normally (chain never blocks typing;
    it only feeds the suggestion set)
  - No successors for W → idle (normal threshold matching resumes)
```

- Chaining arms from our own candidates and from typed series-member
  words — never from path completion. Typed-word arming requires the
  typed word's first letter to be uppercase (the casing form the
  series was learned from; a lowercase typing of a top-band word must
  not arm, or every prose `the ` would offer its run successor) and
  consults the successor index directly, so chain-only members (04)
  arm it too — typing `The ` offers `Fed`.
- Chain offers render on the widget line (or fallback menu) like any
  result set — with the description column retired there is no `chain`
  marker; the offer is visually indistinguishable from a typed match.
  Series items display and insert their run casing at zero typed
  chars; once the user types, the first-char anchor is case-insensitive
  as everywhere, and insertion preserves a typed capital first letter
  (lowercase typing inserts the offer item verbatim).
  On the widget path, arming happens at the widget's Tab-insert (the
  applyCompletion equivalent) and successor offers publish through the
  visibility machine's intent bypass.
- The chain state resets on every `before_agent_start` (new user turn).
- Trigger-char completions also arm the chain (they're whole-word
  insertions).

## Result item shape

A result item is **one word**: the candidate's resolved casing (04
Case handling). On the
widget path an item carries NO metadata — no `Session xN` frequency,
no provenance (`chain`), no rank-group markers. The line is words,
`" | "` separators, and one highlight, nothing else. (Frequency and
provenance still drive ordering; they just aren't rendered.)

On the FALLBACK path, items are `AutocompleteItem`s: `value` = the
string to insert — **always exactly one word** (candidate display
casing); multi-word items are forbidden (invariant; see 06); `label` =
same; `description` = optional short provenance (e.g. `session x12`
— ASCII `x` by item contract, never U+00D7 `×`)
or `chain`) — keep minimal; do not clutter.

Max `maxSuggestions` (default 8) items per result set, ordered per 04
ranking (including 04's plural pruning: an exact key/key+`"s"` pair
in the same result set yields only the singular). Every item is a
single word, including during chains (06, 07); the widget line
additionally truncates to terminal width, lowest-ranked dropped
first.