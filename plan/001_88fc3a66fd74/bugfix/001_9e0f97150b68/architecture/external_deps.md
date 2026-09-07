# External Dependencies & Data — hapax bugfix 001_9e0f97150b68

Research lane ran WITHOUT live web tools; claims are confidence-labeled. Network availability in this
environment was verified independently: `curl -sI` on the en_50k raw URL returns HTTP 200.

## 1. Frequency corpus (BUG-001) — vendoring target

**Primary: hermitdave/FrequencyWords 2018 `en_50k.txt`**
- URL: https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt (verified reachable)
- Format: `word count` per line (space-separated), sorted desc — line order = rank; ~50k entries, ≈600 KB raw.
  NOTE: build-dict's `mergeTsv` expects TAB-separated; convert on vendor (tr ' ' '\t') or extend parser.
- License: repo MIT (verify LICENSE at vendor time); data derives from OpenSubtitles 2018 (dialogue skew:
  you/i/my rank high; the/with/this still well inside top 100 — passes the sanity gate).
- Use the RAW list, not the `qaredux` lemmatized variant: hapax lookups use surface forms; a lemmatized
  list would miss inflected common forms (e.g. gerunds) → they'd fall to rank-group-0 "rare".
- Sanity assertions at vendor time: head contains the/you/i/to/a; the/with/this all in top 100.

**Alternatives (if primary fails license/sanity checks):**
- Norvig `count_1w.txt` (https://norvig.com/ngrams/count_1w.txt) — Google Trillion Word Corpus, ≈334k
  lines `word<TAB>count` (already tab-separated!), ≈4 MB, written-corpus register (closer to prose than
  subtitles). Slice to top ~60k during vendor.
- wordfreq (Python, MIT) `top_n_list('en', 50000)` — blended corpus but requires a Python export step; no
  npm equivalent ships frequency data (`an-array-of-english-words` is an unordered ~275k list — useless here).

## 2. Quantization math (BUG-001) — verified arithmetic

Current curve (build-dict `quant`, denominator fixed at DICT_N=70,000): q≥220 ⇔ rank ≤ 3; q≥120 ⇔ rank ≤ 391.
Rank-based mapping is the right primitive (count-proportional q cannot reach 220 at rank 1000 under Zipf).

**Chosen fix: keep curve/format v1, recalibrate `score.ts` bands.** With denominator 70,000:
rank 100→q150, rank 500→q114, rank 1000→q98, rank 5000→q64, rank 20000→q30.
So REJECT_COMMON_THRESHOLD≈100 rejects the top ~900 ranks ('with'/'this'/'them'/'context' all reject);
MID_FREQ_THRESHOLD≈40 puts ranks ~900–7,500 in group 2, tail in group 1. Exact constants are tuned at
implementation against the vendored corpus with pinned calibration assertions (not guessed here).

**Alternative (only if band widening fails review):** piecewise curve
`q(r) = r ≤ 1024 ? round(255 − 3.5·log2 r) : max(0, round(220 − 22·log2(r/1024)))`
(rank 1→255, 1000→220, 51k→96; monotone, continuous at 1024). REQUIRES format version bump 1→2 per
spec/03 L102–103 + `DICT_VERSION` + loader + `test/helpers/dict-writer.ts` + `test/build-dict.test.ts`.

## 3. Secret detection (BUG-003) — gitleaks-derived patterns (quoted from memory of gitleaks.toml v8.x; pin/verify at implementation)

- AWS Access Key ID: `(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}`
- AWS secret (core run): `[0-9a-zA-Z/+]{40}` (gitleaks wraps with aws-context + quotes; use the bare run for masking, context-optional)
- Slack: `xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9]*` (also covers the tail-segment leak 'abcdefghijklmnopqrstuvwx')
- JWT: `ey[a-zA-Z0-9]{17,}\.ey[a-zA-Z0-9/_-]{17,}\.(?:[a-zA-Z0-9/_-]{10,}={0,2})?` — JWTs WITHOUT the second
  `ey` lead still need the looser three-segment shape `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*`
- OpenAI legacy: `sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}` (T3BlbkFJ marker in every legacy key)
- OpenAI modern (inference, validate against the PRD's own probe key): `sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}`
- GitHub: `ghp_[A-Za-z0-9]{36}`, `github_pat_[A-Za-z0-9_]{36,}`; Google: `AIza[0-9A-Za-z_-]{35}`

Entropy (charset-relative — flat "≥3.5 bits/char" false-positives on English prose ≈4.0–4.2):
- base64-ish runs `[A-Za-z0-9+/=_-]{16,}`: flag iff Shannon entropy ≥ 4.5 bits/char AND ≥1 digit AND (mixed case or symbol)
- hex runs: ≥ 3.0 bits/char (random hex max = 4.0; English text never pure-hex)
- Structured-prefix matches bypass entropy entirely.

## 4. pi-tui applyCompletion contract (BUG-002) — verified from node_modules dist

`node_modules/@earendil-works/pi-tui/dist/autocomplete.js:265–267`:
`beforePrefix = currentLine.slice(0, cursorCol - prefix.length)` — deletes exactly `prefix.length` chars
before the cursor, verbatim, unconditionally. `editor.js:1925–2626` stores `suggestions.prefix` from every
rendered provider response; no re-verification at Tab time (L540–551) nor in the single-item force-apply
path (L1903–1912). Provider invariant: the prefix returned by `getSuggestions` must be the exact suffix of
the line at the cursor for the buffer state at Tab time.