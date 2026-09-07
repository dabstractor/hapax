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

Three interacting rules, implemented in the provider:

1. **Synchronous search, every keystroke.** `getSuggestions` runs the store
   query (< 1 ms) on every call and caches the result set. Tab resolves
   against this live result — **never gated by the debounce**. (Known minor:
   tab may insert a top item before the popup painted it; accepted, see 01.)
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

## Never-hijack rules (acceptance-critical)

- No key handling outside `applyCompletion`/Tab semantics.
- Escape, arrows, backspace, space behave exactly as stock pi.
- Tab with no visible/selected suggestion passes through as a literal Tab.
- The user can type an entire session and never trigger a menu for common
   words: `the`, `context` are rank-rejected; zero-candidate queries never
   render anything.

## M2: chained completion

State machine, armed only via Tab acceptance of a whole-word candidate:

```
idle ──Tab accepts word W──► armed(W)
armed(W):
  - next word start (any char) → offer top successor from successor index
    (lookup W → top-3; filtered live by typed fragment; threshold = 1 char
    during chain, per user rule "first char triggers lookup")
  - Tab with a highlighted successor → insert it, transition armed(next)
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

`AutocompleteItem`: `value` = the string to insert (candidate display text),
`label` = same, `description` = optional short provenance (e.g. `session ×12`
or `phrase`) — keep minimal; do not clutter.

Max 8 items per result set, ordered per 04 ranking, phrase suppression per 06.