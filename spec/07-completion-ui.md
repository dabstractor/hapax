# 07 — Completion UI

## Provider integration

Single registration in the `session_start` handler:

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

## Auto-open: how the menu ever appears

pi-tui's editor only CALLS `getSuggestions` while the user types plain
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

## Trigger modes

Two lookup modes, both always active:

1. **Trigger char** (default `#`): the regex `/(?:^|[ \t])#([^\s#]*)$/` on
   text-before-cursor. When matched, lookup starts from the **first** char
   after `#` (0-char minimum: `#` alone lists the top candidates in
   content-derived order). On completion, `applyCompletion` replaces
   `#fragment` with the word (trigger char is consumed).
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

Case-insensitive prefix match; insertion uses candidate display casing.

## Debounce, flicker, and the Tab contract

Four interacting rules, implemented in the provider:

0. **Tab only ever completes — it never opens anything.** A single Tab
   keypress, when a live suggestion set exists (computed synchronously,
   whether or not the debounced popup has painted it), completes the
   **selected** item — or the **top** item if none is selected — immediately.
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
     measured pause length. Keystroke times come from the editor
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

## Never-hijack rules (acceptance-critical)

- No key handling outside `applyCompletion`/Tab semantics — with the one
  sanctioned exception of the Enter-submits proxy (below), which cancels
  hapax's own menu and alters no text.
- **Close-on-space (2026-09, "stuck file menu" fix):** a NON-forced
  query at a plain trailing space — no `@`, no `/` in the text before
  the cursor — returns null (menu closes) instead of delegating. pi's
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
- Escape, arrows, backspace, space behave exactly as stock pi.
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

State machine, armed only via Tab acceptance of a whole-word candidate:

```
idle ──Tab accepts word W──► armed(W)
armed(W):
  - word start (cursor at the empty next word, ZERO typed chars) → offer
    the top successor from the successor index immediately (lookup W →
    top-3, ranked by count). No trigger char, no threshold, no typed
    fragment needed — the successor IS the top result before the user
    types anything. This is the entire meaning of "phrase completion".
  - ONE-SHOT GRANT (2026-09): the immediate offer is granted for exactly
    ONE word per acceptance. Typing through that offer without accepting
    disarms at the next word boundary — the normal path (under the
    hesitation gate) answers from there. Rationale: chain results carry
    the display layer's intent bypass, so an indefinitely-armed chain
    popped immediate menus at EVERY word start for the rest of the
    message after a single Tab (live-reproduced; fixed same day).
    Acceptance re-arms with a fresh grant: Tab→offer→Tab→offer flows
    exactly as before.
  - typed chars filter the live successor list (prefix,
    case-insensitive, as usual); threshold stays 0 for the duration of
    the chain
  - Tab during armed (selected item, or top if none selected, per rule 0)
    → insert it (ONE word), transition armed(next)
  - Any non-Tab key that disqualifies (space, escape, punctuation) → idle
  - Typing continues to filter normally (chain never blocks typing;
    it only feeds the suggestion set)
  - No successors for W → idle (normal threshold matching resumes)
```

- Chaining arms only from our own candidates, never from path completion.
- The chain state resets on every `before_agent_start` (new user turn).
- Trigger-char completions also arm the chain (they're whole-word
  insertions).

## Menu item shape

`AutocompleteItem`: `value` = the string to insert — **always exactly one
word** (candidate display casing). Multi-word items are forbidden
(invariant; see 06). `label` = same, `description` = optional short
provenance (e.g. `session ×12` or `chain`) — keep minimal; do not clutter.

Max 8 items per result set, ordered per 04 ranking (including 04's
plural pruning: an exact key/key+`"s"` pair in the same result set
yields only the singular). Every item is a single
word, including during chains (06, 07).