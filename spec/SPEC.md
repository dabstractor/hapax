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
   Tab while a suggestion is selected — plus, on the one-line widget display
   (M3), the arrow keys and Escape once the result line has been ENTERED; on
   an un-entered line ↑/← on the first word dismiss the line AND forward the
   press (the caret moves — one press, plain-pi parity). The user's typing
   experience is otherwise unchanged; the result line is strictly
   take-it-or-leave.
2. **Tab is never delayed by UI — and Tab only ever completes.** The top
   suggestion is computed synchronously on every keystroke; the popup may be
   debounced, but a single Tab keypress always resolves the current top or
   selected item immediately. Tab never opens, toggles, or summons the
   menu; the menu opens automatically on the 1st char of a matching word
   (when candidates exist), on the 1st char after the trigger char, or at
   the zero-char chain offer. Enter always submits — never accepts a
   completion (see 07).
3. **The popup never flickers and never appears with zero candidates.**
   (Widget-path amendment, 2026-10: once the suggestion row is CLAIMED
   for the current prompt — 07 "Line claim" — an empty result renders
   the row BLANK rather than removing it; reserved whitespace is not a
   zero-candidate appearance.)
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
| Dictionary size | ~50k English frequent words (shipped: 48,802 entries), 8-bit quantized frequency, ~0.85 MB packed binary |
| Scoring | Global commonness (static: admission bands + conjugation guard). Result order (2026-10): match-strictness tier desc → sessionCount desc within tier → shorter key → lex; the pure content-derived order is RETIRED (stability now holds only among equal counts within tiers). Session salience (dynamic) drives store eviction only. Admission reject band is length-conditioned (2026-10): flat floor through 8 chars, sqrt ramp to admit-all at 20; runtime-tunable floor via `rejectCommonness`; remaining constants baked; capitalized-evidence admission (04): run members admit regardless of band (attested top-band members are chain-only), single mid-sentence capitals admit under the relaxed band 95, and casing evidence never affects ordering |
| Matching | Anchored fuzzy after the first character (2026-10): the fragment's first char must equal the candidate's first char; the rest is a subsequence. Three strictness tiers (exact prefix > contiguous tail > scattered); admission gated by `fuzzThreshold` (0–100, higher = stricter; 100 = prefix-only). The store's first-char index remains the scan entry, preserving the < 1 ms budget |
| Display | One-line widget (2026-10): hapax renders its own single-line result set below the input — words joined `" | "`, no `Session ×N` column, no descriptions, width-truncated lowest-ranked-first, zero candidates never render content. Arrow semantics are two-state per generation (2026-10): UN-ENTERED — ↑/← on the first word dismiss + suppress AND forward the press (one press, caret moves — plain-pi parity); →/↓ with nothing to navigate forwards verbatim; →/↓ entering a multi-word line navigates and ENTERS the list. ENTERED — the cluster is captured and both edges wrap end-to-end (carousel; the clamp is retired/unreachable); plain Escape always dismisses. Every new result set resets to un-entered. Tab inserts the highlighted word; Enter always submits. The vertical stock menu is retained as the FALLBACK where no editor factory exists (dual-path; rejected alternatives: a synthesized single item — loses arrow selection — and upstream horizontal-menu support — no timeline). **Line claim (2026-10):** the row below the editor, once first shown for a prompt, is OWNED until submit / turn reset / session rebind — empty result sets render it blank, never row-removal (kills the 1-line input-area jump; 07) |
| Long-word admission (2026-10) | R_eff length gradient (04): floor R holds through 8 chars (R=12 2026-09, **30 since the 2026-10 width-bound retune** — the one-line widget + line claim + width-bound count dropped the UI cost of a common word; 15,064→32,544 attested table words admit; dev-vocab node/spec/null/turbine in, prose head holds), sqrt ramp to admit-all at 20; every attested admission lands at group 1 (+0.5 rarity bonus); conjugation-guard stems ride R_eff; mid band (20) retired. Shape chosen by owner measurement: linear 6→20 (~18.9k flips, re-admits the audit's `provider`) rejected; floor-10 (~3.2k) stricter than owner intent; sqrt 8→20 (~10.5k) adopted |
| File-path candidates (2026-10, rule 4d) | Slash-joined path runs are whole tokens (≥2 interior slashes, or 1 slash + dotted component); key trims leading `/`/`~`/`./`/`../`, display preserves them (absolute paths insert with the slash); key cap 96; `:line:col` suffix trimmed; single-slash letter-only paths (`src/core` ≡ `and/or`) a documented gap; mid-path typing still delegates to stock pi file completion |
| Tier-0 anchorless fallback (2026-10) | When the anchored scan returns zero — and only then — one full-store pass matches the fragment as ONE contiguous run anywhere in the key (`esk`→`zendesk`, `query`→`src/core/query.ts`); floor 3 chars; score 85−40·runStart/len, threshold-gated; sorts below tier 1. `#` mode: tier-0 always consulted + scattered tier-1 visible (default threshold 45 vs ambient 60; explicit knob overrides both). Measured cost: ~5% (3c) → ~20% (7c) one-shot prose-cousin menus, owner-accepted; fallback pass budget < 3 ms p99; chaining stays anchored |
| Ingestion | `message_end` events only; roles `user` + `assistant`; assistant text blocks only (no thinking blocks); code blocks inside assistant output included; toolResult excluded entirely |
| Store lifecycle | Per-session, in-memory, survives compaction, no persistence. Rebuild on resume from history (~30–50 ms background for 200k tokens) |
| Trigger | Configurable trigger char (default `#`, 1st-char lookup); word matching effectively at 1 char (widget path: the line opens at word start by its own state machine; fallback path: pi-tui requests only at word starts) — the `threshold` config value is retained but inert (see 07) |
| Popup | First appearance immediate by default; OPTIONAL hesitation gate (`menuDelayMs`, default 0 — 150/300 calibration attempts failed against real rhythm); subsequent set changes display-debounced ~100 ms; synchronous search every keystroke; hysteresis against flicker |
| Phrases & chaining | v2 (M2): one word per completion, ALWAYS. There are no multi-word menu items. "Phrase support" = successor index + chained Tab completion: after a word is accepted, its most-likely successor is the top result with zero additional typed chars. Bigrams form between raw-text-adjacent admitted words (nothing but whitespace between, same line) and between all members of a capitalized run — series bigrams, including chain-only top-band members (04); series successors top the after-space offer, and the chain arms from Tab acceptance or a typed capitalized word boundary (07). Any other intervening character or word breaks the window |
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
- **M3 (v3):** anchored-fuzzy matching, frequency tie-break ranking, and the
  one-line widget display with arrow selection + boundary pass-through
  (07), plus the per-prompt line claim — the row, once shown, stays
  (blank when empty) until the prompt is submitted (07).