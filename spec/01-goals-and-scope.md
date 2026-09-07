# 01 — Goals and Scope

## Problem

LLM sessions accumulate project-specific vocabulary — identifiers, API names,
proper names, technical terms — that the user must retype into the prompt box.
Standard autocomplete cannot suggest these because it only knows files and
commands.

hapax watches what enters the context window, extracts the rare and
useful words, and completes them from 2 typed characters (or 1 character after
the trigger char, default `#`).

## Core definitions

- **Candidate** — a word admitted to the session store, available for completion.
- **Admission** — the decision that a segmented word is worth storing (global
  commonness + shape gates).
- **Salience** — the dynamic per-session ranking score (frequency, recency,
  source, rarity).
- **Trigger char** — a configurable character (default `#`) that initiates
  lookup from the first character after it.
- **Threshold matching** — prefix lookup after N characters of a word
  (default N=2, configurable 1–3), firing everywhere the user types.

## Goals (M1)

1. Extract uncommon words from user prompts and final assistant output.
2. Admit them via a static common-words dictionary + shape gates.
3. Rank them via session salience.
4. Complete them through pi's built-in autocomplete menu with zero typing
   interference.
5. Total memory < 6 MB steady state; query latency < 1 ms; ingest of a
   300k-token session < 100 ms in background.

## Goals (M2)

6. Multi-word phrase candidates (n=2,3) admitted by repetition or all-rare
   first sight.
7. Chained completion: accepting a word arms its most-likely successor for
   zero-additional-typing Tab completion.

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

## UX principles

- The user's typing experience is identical with or without the extension,
  except that Tab occasionally does something useful.
- The menu is a suggestion surface, never a modal, never a key consumer.
- Suggestions that would embarrass (secrets, garbage tokens) must never appear;
  the shape gate is load-bearing for the absent-from-dictionary class.