# hapax — Context-Driven Autocomplete Extension

**Status:** Draft v1.0 · **Name:** `hapax`

## Purpose

A pi extension named **hapax** (from *hapax legomenon*, a word that occurs
only once in a corpus — exactly what it harvests) that watches user prompts and final agent output as they enter the
context window, extracts uncommon words / identifiers / proper names, and offers
them as tab-completions in the prompt input box — reusing pi's built-in
autocomplete menu via `ctx.ui.addAutocompleteProvider()`.

## Design invariants (non-negotiable)

1. **Never hijack typing.** No key is ever captured, consumed, or altered except
   Tab while a suggestion is selected. The user's typing experience is unchanged;
   the menu is strictly take-it-or-leave.
2. **Tab is never delayed by UI — and Tab only ever completes.** The top
   suggestion is computed synchronously on every keystroke; the popup may be
   debounced, but a single Tab keypress always resolves the current top or
   selected item immediately. Tab never opens, toggles, or summons the
   menu; the menu opens automatically on the 2nd char of a matching word, on
   the 1st char after the trigger char, or at the zero-char chain offer.
3. **The popup never flickers and never appears with zero candidates.**
4. **Everything stays in RAM.** No persistence, no telemetry, no network. The
   candidate store is per-session and dies at `session_shutdown`.

## Document index

@01-goals-and-scope.md
@02-architecture.md
@03-dictionary-format-and-build.md
@04-tokenization-and-scoring.md
@05-ingestion-pipeline.md
@06-candidate-store.md
@07-completion-ui.md
@08-configuration.md
@09-testing-and-acceptance.md

## Decision log (all settled)

| Topic | Decision |
|---|---|
| Rarity source | Known-common-words frequency table (presence = commonness evidence; absence = rare-by-default, shape-gated) |
| Dictionary size | Top ~60–80k English frequent words, 8-bit quantized frequency, ~1–2 MB packed binary |
| Scoring | Global commonness (static, admission) + session salience (dynamic, ranking). Constants baked, not configurable |
| Ingestion | `message_end` events only; roles `user` + `assistant`; assistant text blocks only (no thinking blocks); code blocks inside assistant output included; toolResult excluded entirely |
| Store lifecycle | Per-session, in-memory, survives compaction, no persistence. Rebuild on resume from history (~30–50 ms background for 200k tokens) |
| Trigger | Configurable trigger char (default `#`, 1st-char lookup); threshold-matching at 2 chars (configurable 1–3), fires after any word start |
| Popup | Display-debounced ~100 ms; synchronous search every keystroke; hysteresis against flicker |
| Phrases & chaining | v2 (M2): one word per completion, ALWAYS. There are no multi-word menu items. "Phrase support" = successor index + chained Tab completion: after a word is accepted, its most-likely successor is the top result with zero additional typed chars. Bigrams form only between raw-text-adjacent admitted words (nothing but whitespace between, same line); any other intervening character or word breaks the window |
| Language | English table v1; CJK runs skipped (known limitation); per-language tables possible later via format versioning |
| Secrets | Shape/entropy gate rejects key-shaped strings (sk-, ghp_, long hex, high digit+symbol entropy). Default-on, no config |
| Telemetry | None |

## Implementation milestones

- **M1 (v1):** dictionary build + packed loader, ingestion pipeline, candidate
  store, trigger char + threshold matching, autocomplete provider with debounce
  and hysteresis. Fully usable tool.
- **M2 (v2):** bigram successor index + chained Tab completion — one word per
  Tab, zero typed chars to see the next word. No phrase menu items, no
  multi-word insertion, ever. Specced in 06/07; implemented after M1 acceptance.