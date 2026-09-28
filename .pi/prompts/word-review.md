---
description: Trace a word/string through hapax's admission pipeline — diagnose why it appears or doesn't, or propose a rule change with side effects
argument-hint: <question about a word or string, e.g. '"--mode" should be in'>
---

The user's question: $ARGUMENTS

(If the question is empty or names no string, ask which word/string to review before doing anything else.)

You are reviewing admission/menu behavior for the **hapax** extension — this
repo. Do the same job a careful senior reviewer would: reproduce the string's
actual fate instead of theorizing, name the governing rules with file cites,
and if a rule change is proposed, lay out side effects both good and bad.
Default deliverable is **analysis + proposal** — do not edit code unless the
user explicitly asks you to implement.

## What hapax is for (the purpose that decides every line)

hapax is an autocomplete extension for the pi coding agent. It watches user
prompts and final agent output, extracts rare vocabulary, and offers it as
Tab completions. It is named for the *hapax legomenon* — a word seen only
once in a corpus. **The value class is dictionary-ABSENT strings:**
identifiers, commit-hash-shaped tokens, jargon, proper names. Dictionary
ATTESTATION is near-disqualifying evidence — ordinary English (`the`,
`provider`, `null`, `node`) must not flood the menu. Menu order is
content-derived and stable (shortest-first, then lexicographic; never
reshuffled by session stats) because completion exists to build muscle
memory. Salience (recency/frequency/stickiness) governs store
retention/eviction only — never menu position.

Behavioral truth lives in `spec/SPEC.md` + the numbered files under
`spec/`. **Read `spec/04-tokenization-and-scoring.md` (pipeline rules) and,
if the question is about typing/menu behavior, `spec/07-completion-ui.md`.**
Many exclusion lines are deliberate 2026-09 OWNER RULES with audit history
(the commonness retighten to R=12, the hyphen-compound rule, proper-noun
relief retirement). Never casually reverse them — frame a proposal as an
owner decision, and cite the history the spec records.

## The pipeline (stage → file → the rules that matter)

A candidate passes through ALL of these; its fate is decided at the FIRST
stage that rejects it:

1. **Ingest** (`src/pi/ingest.ts`) — user prompts + final agent output only,
   sliced ≤64KB. `maskSecrets()` blanks secret-shaped windows in raw text
   BEFORE tokenization (`src/core/shapeGate.ts`, gitleaks-derived inventory).
2. **Tokenize** (`src/core/segment.ts`, `tokenize`):
   - Base: `[A-Za-z][A-Za-z0-9_]{0,63}` (length ≥2 to emit). Digit-initial
     runs are NOT base tokens.
   - Hexish: 6–40 hex chars containing a letter (commit-hash-shaped).
   - Rule 3: a run abutting a non-ASCII letter on either side is
     disqualified WHOLE (`Þórhildur` yields nothing).
   - Compound 4a (dotted filenames): final part 1–5 letters
     (`AGENTS.md`, `package.json`); version numbers/decimals excluded.
   - Compound 4b (hyphenated): letter-initial, ≥2 segments, SINGLE inner
     hyphens (`load-bearing`, `e2e-test`). **Leading/doubled hyphens never
     form tokens**: `--flag` yields bare `flag`; `--load-bearing` yields
     `load-bearing` (dashes dropped). Trailing hyphens split.
3. **Subword expansion** (`expandCandidates`, same file) — whole token plus
   camelCase/snake sub-words ≥4 chars; `properName` hint suppressed at
   structural starts (line start, bullets, after `.!?;:`).
4. **Shape gate** (`src/core/shapeGate.ts`, `passesShape`) — whole tokens
   2–64 chars, subwords 2–32; entropy ≥1.5 bits/char (kills ≤3-distinct-char
   keys, so `-v`-class flags can NEVER pass); no ≥4 unigram run; no ≥6
   consonant run; always-on secret shapes (prefixes `sk-`/`ghp_`/`xox`-/
   `akia`/`eyJ`/`npm_`…, base64/hex entropy rules). Note the prefix checks
   are `startsWith` on the raw display — a leading-dash token would dodge
   them (this is the kind of interaction to check in rule-change reviews).
5. **Admission** (`src/core/score.ts`) — `q = dictionary.lookup(lowercased
   key)`. `q >= 12` (config `rejectCommonness`) → REJECT. `0 <= q < 12` →
   admit, rank group 1 (rarest ~10% of corpus). Absent → admit, group 0
   (THE value class). Conjugation guard: inflections of attested stems
   (`-s/-es/-ed/-d/-ing/-ly`) reject too. Proper-noun relief is
   retired-in-place. Salience (`score.ts`) feeds eviction only.
6. **Store** (`src/core/store.ts`) — lowercase keys, display casing = most
   recent sighting, 20k cap with salience eviction, 10k bigram/successor cap.
7. **Query** (`src/core/query.ts`, `rankMatches`) — lowercase prefix match;
   shortest-first then byte order; single-`s` plural pruning; top 8
   (`maxSuggestions`).
8. **Match state / provider** (`src/pi/provider.ts`, `extractMatchState`) —
   the OTHER half of any "why doesn't it complete" answer: even a stored
   candidate only fires when the typed fragment matches. Threshold-mode
   regex is `/[A-Za-z][A-Za-z0-9_-]*$/` — **letter-initial; inner/trailing
   hyphens admitted, leading hyphens NEVER** (`--mo` yields fragment `mo`,
   `--` survives insertion). Trigger mode (`#` at line start/after space)
   admits any non-space fragment including dashes. Stock pi contexts
   (slash command, `@mention`, paths) always delegate. `-` is NOT a
   triggerCharacter, so menus never auto-open while typing dash-led strings
   (Tab-force and `#` still work). The chain machine's typed-fragment regex
   is letter-initial too (zero-char successor offers still surface dash-led
   words).

Config (`~/.pi/agent/hapax.json` or `.pi/hapax.json`): `triggerChar`,
`rejectCommonness` (default 12), `maxSuggestions` (1–20, default 8),
`threshold` (retained, near-inert), `menuDelayMs`, `enableChaining`.

## Method — do these in order

1. **Extract the exact string(s)** from the question. Strip quotes the user
   typed around them.
2. **Reproduce, don't guess.** Run the real pipeline on the exact string:

   ```bash
   node -e '
   const { createJiti } = require("./node_modules/@earendil-works/pi-coding-agent/node_modules/jiti");
   const jiti = createJiti(process.cwd() + "/");
   const { tokenize, expandCandidates } = jiti("./src/core/segment.ts");
   const { passesShape } = jiti("./src/core/shapeGate.ts");
   for (const tok of tokenize(process.argv[1]))
     for (const d of expandCandidates(tok)) console.log(JSON.stringify(d), JSON.stringify(passesShape(d)));
   ' "THE STRING IN CONTEXT HERE"
   ```

   (cwd = repo root; masks secrets first if you want that stage too — call
   `maskSecrets` before `tokenize`. For dictionary values: `node
   tools/calibrate-bands.mjs <word...>` prints each word's `q` and verdict.
   For fragment/match-state questions, replicate `extractMatchState`'s regex
   on the typed text, or run `npx vitest --run test/provider-match.test.ts`.)
3. **Classify the question** and follow its track:
   - **"Why is X included/excluded?"** → identify the FIRST rejecting (or
     admitting) stage from your trace and explain the rule's rationale
     (spec §04 for tokenization/admission, §07 for fragments/menu).
   - **"X should be in" (rule change)** → the full proposal format below.
   - **Tuning complaint** (too much/little noise) → check `rejectCommonness`
     first; note what band the offending words sit in via calibrate-bands.
   - **Bug report** (wrong completion, hijacked menu, corruption) → suspect
     provider layers (BUG-005 word-start guard, BUG-002 anchor staleness,
     stock-context delegation, close-on-space); read the bug-history notes
     in `src/pi/provider.ts` and `spec/09-testing-and-acceptance.md`.
4. **Check test pins**: `rg -n '<string or shape>' test/ spec/ README.md` —
   pinned expectations (e.g. `test/segment.test.ts` "leading/doubled hyphens
   never form tokens") are deliberate decisions; a proposal that flips them
   must say so explicitly.

## Proposal format (for rule changes)

1. **Verdict up front** (1–3 sentences).
2. **Where the rule lives today** — every place it's pinned (spec section,
   code file, test) — exclusion lines usually live in BOTH segmentation and
   the provider's fragment regex.
3. **The proposed rule** — precise enough to write spec text from (regex +
   prose), placed in the existing rule family where possible (the compound
   rules 4a/4b are the template).
4. **Side effects — good and bad**, traced concretely: which other strings
   flip fate (run them through the trace recipe), gate interactions
   (entropy floors, secret-prefix parity, span overlaps with existing
   compound regexes), admission asymmetries (dictionary-absent classes admit
   wholesale — is that bounded?), menu/ordering/chaining/triggerCharacters
   consequences, muscle-memory breaks for existing completions.
5. **Blockers & companion changes** — e.g. secret-gate parity edits that are
   REQUIRED, not optional.
6. **Test/doc flips** — which spec sections, tests, and README claims must
   change.
