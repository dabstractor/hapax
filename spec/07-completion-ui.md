# 07 — Completion UI

## Provider integration

Single registration in the `session_start` handler:

```ts
ctx.ui.addAutocompleteProvider((current) => ({
  triggerCharacters: [config.triggerChar],   // default "#"
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
insertion if validation proves a need. Never intercept `input`, never replace
the editor component, never consume keys outside the provider contract.

## Trigger modes

Two lookup modes, both always active:

1. **Trigger char** (default `#`): the regex `/(?:^|[ \t])#([^\s#]*)$/` on
   text-before-cursor. When matched, lookup starts from the **first** char
   after `#` (0-char minimum: `#` alone lists top-salience candidates).
   On completion, `applyCompletion` replaces `#fragment` with the word
   (trigger char is consumed).
2. **Threshold matching**: the regex `/[A-Za-z][A-Za-z0-9_]*$/` on
   text-before-cursor. Fires when fragment length ≥ `config.threshold`
   (default 2; 1–3 allowed). Fires **everywhere** — any word start, any
   context, not just after whitespace. This is settled: we never gate on
   position because the menu never interferes with typing (see invariants).

Priority: trigger-char match wins; otherwise threshold match; otherwise
`return current.getSuggestions(...)` untouched (path/slash completion must
keep working exactly as before, including inside quoted paths).

Case-insensitive prefix match; insertion uses candidate display casing.

## Debounce, flicker, and the Tab contract

Four interacting rules, implemented in the provider:

0. **Tab only ever completes — it never opens anything.** A single Tab
   keypress, when a live suggestion set exists (computed synchronously,
   whether or not the debounced popup has painted it), completes the
   **selected** item — or the **top** item if none is selected — immediately.
   Tab must never open, toggle, summon, or expand the menu. Menu visibility
   is driven exclusively by typing: the menu opens automatically on the
   2nd char of any word matching a candidate (threshold mode), on the 1st
   char after the trigger char, and at the zero-char chain offer (see
   chained completion). There is no manual open gesture of any kind, and
   completion is always exactly one keypress.

1. **Synchronous search, every keystroke.** `getSuggestions` runs the store
   query (< 1 ms) on every call and caches the result set. Tab resolves
   against this live result — **never gated by the debounce**. (Known minor:
   tab may insert a top item before the popup painted it; accepted, see 01.)
   Tab resolves to a completion, never to a menu-open action.
2. **Display debounce: 100 ms.** Suggestions are *returned* to pi immediately
   from the live query, but the provider suppresses non-empty result *sets*
   that differ from the currently displayed set within 100 ms of the last
   paint. Implementation: timestamp of last visible set; if a new set
   arrives < 100 ms after paint, schedule the swap on a 100 ms timer; if
   another keystroke supersedes, replace the pending set. The menu thus
   updates at most every 100 ms, between keystrokes.
3. **Flicker hysteresis.**
   - **Empty = invisible.** Zero candidates → return empty/delegate; the menu
     never renders. (Inherited from built-in behavior; assert in tests.)
   - Once visible, the set only ever **narrows, replaces, or closes** — a
     narrowing keystroke (`zend` → `zendk`) must not close-and-reopen.
   - Close events: disqualification (no candidates), cursor move, escape,
     space. A close followed by a qualifying keystroke within 200 ms re-opens
     fresh (no stale set).

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

- No key handling outside `applyCompletion`/Tab semantics.
- **Tab never opens the menu.** Menu opening is automatic (typing-driven)
  only: 2nd-char threshold match, 1st char after the trigger char, or the
  zero-char chain offer. There is no manual open gesture; Tab completes,
  full stop.
- Escape, arrows, backspace, space behave exactly as stock pi.
- Tab with no live suggestion set passes through as a literal Tab.
- The user can type an entire session and never trigger a menu for common
   words: `the`, `context` are rank-rejected; zero-candidate queries never
   render anything.

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

Max 8 items per result set, ordered per 04 ranking. Every item is a single
word, including during chains (06, 07).