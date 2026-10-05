# 01 — Goals and Scope

## Problem

LLM sessions accumulate project-specific vocabulary — identifiers, API names,
proper names, technical terms — that the user must retype into the prompt box.
Standard autocomplete cannot suggest these because it only knows files and
commands.

hapax watches what enters the context window, extracts the rare and
useful words, and completes them from the 1st typed character of a
matching word (or the 1st character after the trigger char, default `#`).

## Core definitions

- **Candidate** — a word admitted to the session store, available for completion.
- **Admission** — the decision that a segmented word is worth storing (global
  commonness + shape gates).
- **Salience** — the dynamic per-session retention score (frequency,
  recency, source, rarity). Drives store eviction; its frequency
  component (sessionCount) breaks ranking ties within match-strictness
  tiers (04).
- **Trigger char** — a configurable character (default `#`) that initiates
  lookup from the first character after it.
- **Word matching** — anchored fuzzy lookup from the first character
  of a word (first char exact, then a threshold-gated fuzzy
  subsequence — 04), firing everywhere the user types. (The
  `threshold` config value, 1–3, is retained for schema compatibility
  but inert — see 07.)

## Goals (M1)

1. Extract uncommon words from user prompts and final assistant output.
2. Admit them via a static common-words dictionary + shape gates.
3. Order the menu content-derived (shortest match first, then
   lexicographic — stable and predictable); salience governs retention
   and eviction only. (Ordering superseded 2026-10 by M3 goal 9;
   admission/eviction split unchanged.)
4. Complete them through pi's built-in autocomplete menu with zero typing
   interference. (Superseded as PRIMARY display 2026-10 by M3 goal 10;
   retained as the fallback path.)
5. Total memory < 6 MB steady state; query latency < 1 ms; ingest of a
   300k-token session < 100 ms in background.

## Goals (M2)

6. One word per completion, always — no multi-word candidates, ever. The
   only phrase behavior is successor chaining (goal 7).
7. Chained completion: accepting a word arms its most-likely successor for
   zero-additional-typing Tab completion.

## Goals (M3)

8. Anchored-fuzzy matching after the first typed character,
   threshold-gated (`fuzzThreshold`, 08) so a large store never floods
   the results (04).
9. Conversation-frequency tie-breaking within equal match-strictness
   tiers — sessionCount descending inside a tier (04).
10. One-line horizontal result display: words joined `" | "`, no
    frequency column, hapax-rendered widget with arrow selection and
    one-press boundary pass-through on un-entered lists (07); the
    vertical stock menu retained as fallback. The suggestion row is
    CLAIMED for the prompt's duration once first shown — blank when
    empty, so the input area never jumps mid-prompt (07).

## Goals — capitalized-series completion

11. Consecutive capitalized words are recognized as proper-noun
   series: every run member becomes completable vocabulary, and the
   words chain — completing or typing a member offers the next member
   as the top suggestion with zero additional typed characters.
12. Casing evidence admits, never ranks: mid-sentence capitals ease
   admission (runs fully, singles under a relaxed band); result
   ordering stays content-derived and unchanged.
13. Completion casing respects the user's typing: a typed capital
   first letter is never uncased, and displayed forms follow
   conversation frequency rather than recency.

## Non-goals (explicit)

- No ingestion of tool-call results, file reads, thinking tokens, or any
  content the agent did not explicitly present to the user (plus user prompts).
- No persistence across sessions; no per-project caches.
- No learned/ML scorer (hand-tuned constants only; revisit post-M2 with real
  usage experience).
- No semantic/embedding-based matching.
- No CJK word segmentation (CJK runs skipped; see limitations).
- No modification of messages, context, or anything sent to providers.

## Known limitations (accepted)

- **English-only dictionary.** Non-English common words are absent from the
  table and therefore over-admitted as "rare." This degrades memory efficiency,
  not correctness — session salience still ranks them usefully, and the most
  valuable completions (identifiers, API names) are English-shaped regardless
  of user language. Per-language tables are a drop-in later via dictionary
  format versioning.
- **Absence conflates "rare real word" with "random string."** Shape gates
  filter the worst noise; salience handles the ordering. A rare real word that
  never recurs in-session was never a useful completion.
- **Tab may insert a top item the debounced popup hasn't painted yet.** The
  computation is deterministic and correct; treated as cosmetic. Revisit only
  if observed in practice (see 07, "Tab-before-paint").
- **Arrow capture while the result line shows.** The arrow cluster is
  captured only once the list has been ENTERED (an arrow that moved
  the highlight); before that, boundary arrows pass through to the
  editor with the caret moving on the same press (plain-pi parity),
  and after entry both edges carousel end-to-end, per generation
  (07). Owner-accepted trade-off, 2026-10; one-press + interaction
  rules 2026-10.

## UX principles

- The user's typing experience is identical with or without the extension,
  except that Tab occasionally does something useful and, while the
  result line is visible, the arrow keys navigate it (boundary
  pass-through returns the keys instantly, one press, until the
  list has been entered — then Escape is the exit; 07).
- The result line is a suggestion surface, never a modal. The arrow
  cluster is consumed only after the list is entered — boundary
  pass-through returns control instantly, one press (07); never any
  typing key.
- The input area never moves vertically mid-prompt. Once the
  suggestion row has appeared, hapax owns it until the prompt is
  submitted (or the tree resets): no suggestions means a blank row,
  not a missing one (07).
- Suggestions that would embarrass (secrets, garbage tokens) must never appear;
  the shape gate is load-bearing for the absent-from-dictionary class.