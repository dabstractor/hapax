# hapax — Context-Driven Autocomplete Extension

**Status:** Draft v1.0 · **Name:** `hapax`

## Purpose

A pi extension named **hapax** (from *hapax legomenon*, a word that occurs
only once in a corpus — exactly what it harvests) that watches user prompts and final agent output as they enter the
context window, extracts uncommon words / identifiers / proper names, and offers
them as tab-completions in the prompt input box — reusing pi's built-in
autocomplete menu via `ctx.ui.addAutocompleteProvider()`.

## Spec maintenance policy (binding)

This spec is the **single source of truth** for hapax's requirements and
behavior. Nothing else — JSDoc, README, plan artifacts — overrides it.

- **Interactive sessions MUST update the spec.** When the owner requests
  a behavior change in an interactive session, updating the spec is a
  mandatory part of the change, not an optional follow-up. Without this
  rule the spec could never change: the owner defines requirements only
  here. A change that ships code without the matching spec edit is
  incomplete. Either ORDER is fine — spec-first then implement, or
  implement then sync the spec — so long as the two land in agreement:
  the spec must match what's in the code.
- **Implementation pipeline agents MUST NOT touch the spec.** Agents
  executing plan/ PRPs (P1.M3-style staged tasks) treat `spec/*.md` as
  read-only inputs; they record drift in code comments and reports, and
  an interactive session later reconciles the spec. The
  "do not edit; document changes in JSDoc" instructions inside plan/
  artifacts apply to those pipeline runs only.
- `plan/` directories are historical run artifacts — never edited, never
  authoritative.

## Design invariants (non-negotiable)

1. **Never hijack typing.** No key is ever captured, consumed, or altered except
   Tab while a suggestion is selected. The user's typing experience is unchanged;
   the menu is strictly take-it-or-leave.
2. **Tab is never delayed by UI — and Tab only ever completes.** The top
   suggestion is computed synchronously on every keystroke; the popup may be
   debounced, but a single Tab keypress always resolves the current top or
   selected item immediately. Tab never opens, toggles, or summons the
   menu; the menu opens automatically on the 1st char of a matching word
   (when candidates exist), on the 1st char after the trigger char, or at
   the zero-char chain offer. Enter always submits — never accepts a
   completion (see 07).
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
| Scoring | Global commonness (static: admission bands + conjugation guard). Menu order is content-derived — shortest match first, then lexicographic — independent of salience. Session salience (dynamic) drives store eviction only. Admission reject band runtime-tunable via `rejectCommonness`; remaining constants baked |
| Ingestion | `message_end` events only; roles `user` + `assistant`; assistant text blocks only (no thinking blocks); code blocks inside assistant output included; toolResult excluded entirely |
| Store lifecycle | Per-session, in-memory, survives compaction, no persistence. Rebuild on resume from history (~30–50 ms background for 200k tokens) |
| Trigger | Configurable trigger char (default `#`, 1st-char lookup); word matching effectively at 1 char in the live editor (pi-tui requests only at word starts; the `threshold` config value is retained but inert — see 07) |
| Popup | First appearance hesitation-gated (`menuDelayMs`, default 150 ms — full-speed typing never pops the menu; trigger-char/chain bypass); subsequent set changes display-debounced ~100 ms; synchronous search every keystroke; hysteresis against flicker |
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