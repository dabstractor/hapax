# Research notes — P2.M2.T2.S1 (README sync for bugfix-001 changeset)

## Verified README.md anchors (721 lines, current tree)

- **:9–30 Status paragraph** — contains the post-delta note precedent: the
  2026-09-30 widget-path bugfix note is an inline parenthetical inside the
  Status paragraph ("...and the 2026-09-30 widget-path bugfix post-delta note
  (four defects found and fixed: ...)"). The new note follows this exact
  style: a dated sentence appended to the same parenthetical chain.
- **:47–72 Features bullet 2 (tier-0 fallback)** — `query` →
  `src/core/query.ts` path examples at :52, :56, :62. No current claim about
  edge trimming; after BUG-002 the display/insert is verbatim-edge
  (leading `/`, `../`, `~`). Minimal factual clause can be added here.
- **:93–114 Enter/stock-contexts bullets** — "both display paths" claims
  (widget vs fallback). Unaffected by the changeset; verify only.
- **:126–136 proper-nouns bullet** — series bigrams / chain-only claims.
- **:177–204 Chained Tab completion bullet** — claims identical chain
  behavior on BOTH display paths, `recordBigramRuns`, zero-char offer,
  one-word-per-Tab re-arm. These were the BUG-001-dead features; the
  changeset (P1.M1) restored them, so the wording should now be TRUE —
  verify against landed code, no rewrite expected.
- **:205–222 Post-Tab extension offer bullet** — widget path; verify.
- **:223–235 Capitalized-series completion bullet** — "on BOTH display
  paths", "a space closing an UPPERCASE-initial typed word" arming —
  BUG-001/BUG-003 restored this; verify.
- **:255 Usage** — basic Tab usage; unaffected.
- **:588–610 Debug section (/acwords)** — successor-index sample bullet
  (≈:603–606) currently reads rows as `word → successor ×count` with NO
  mention of the `(series)` marker or run-casing display. Verified against
  src/pi/debug.ts:106-135: rows are `nextDisplay RUN CASING plus a
  " (series)" marker` for series entries; ordering series-first, count-desc,
  byte-lex ties, max 3 (SUCCESSOR_SAMPLE_N = 10 words sampled). THIS BULLET
  NEEDS UPDATING.

## Changeset state (from task tree)

- BUG-001 (series wiring): P1.M1 complete — enriched runs payload at index.ts
  seam, mirrored test un-shims, e2e acceptance layer.
- BUG-002 (verbatim path edges): P1.M2 complete — Sighting.path,
  Candidate.pathDisplay, resolver guard, e2e insertion.
- BUG-003 (widget zero-char offer at space tick): P2.M1 complete —
  zeroCharOffer helper + timing pins + live TTY.
- BUG-004 (fallback PIN + battery): P2.M2.T1.S1 PIN complete; S2 battery in
  flight (test-only — no README impact).

## Edit plan (minimal)

1. Status paragraph: append dated post-delta note (2026-10 style, matching
   the 2026-09-30 precedent sentence).
2. Debug successor-sample bullet: add run-casing display + ` (series)`
   marker wording to match src/pi/debug.ts output.
3. Tier-0 bullet: one short clause noting path candidates display and insert
   with their original leading edges (`/`, `../`, `~`) — only if not already
   implied; keep to one clause.
4. Everything else: verify-against-behavior only; no rewrite unless a claim
   is factually wrong against shipped code.
