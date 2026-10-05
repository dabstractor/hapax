# 08 — Configuration

## Config surface (deliberately tiny)

pi has no extension-settings API for this; the extension reads a plain JSON
config file itself. Load order (later wins):

1. Built-in defaults (in code).
2. `~/.pi/agent/hapax.json` (user-global).
3. `.pi/hapax.json` (project-local, if the project is trusted).

Malformed file → warn once via `ctx.ui.notify(..., "warning")` (pi's
notify levels are `"info" | "warning" | "error"` — there is no
`"warn"`), fall back to
defaults, continue running. Missing files are normal.

## Schema

```jsonc
{
  "triggerChar": "#",        // single non-alphanumeric char; "" disables
                              // trigger mode entirely. "@", "/" and '"'
                              // are RESERVED: pi's stock @-mention,
                              // path/slash and quoted-path contexts own
                              // them, so the trigger could never fire —
                              // load emits one warning (below); word
                              // matching is unaffected.
  "threshold": 2,            // RETAINED BUT INERT in the live editor:
                              // pi-tui only requests at word starts, so
                              // matching is effectively 1 char (see 07).
                              // Kept for schema compatibility. 1 | 2 | 3.
  "maxSuggestions": 20,      // 1–20: WIDTH-BOUND default (2026-10) — the
                              // widget line caps at the terminal width
                              // (rightmost dropped first); the count is
                              // only a sanity ceiling, so the default
                              // sits at the schema max and width binds
                              // on every realistic terminal. Tune down
                              // for fewer words per line.
  "rejectCommonness": 12,    // 1–255: dictionary-attestation FLOOR of
                              // the length-conditioned reject curve R_eff
                              // (04): flat through 8 chars, sqrt ramp to
                              // admit-all at 20 — higher = looser, the
                              // whole curve scales from this floor.
                              // Governs admission AND the conjugation
                              // guard's stem comparisons (via R_eff).
                              // Probe any word first: node
                              // tools/calibrate-bands.mjs <words...>
                              // prints q + verdict (lowercase and
                              // Capitalized). Default: the baked constant
                              // in src/core/score.ts.
  "fuzzThreshold": 60,      // 0–100: minimum fuzzy match score (04) for a
                              // candidate to enter a result set. Higher =
                              // stricter; 100 = exact-prefix-only mode.
                              // Per-mode defaults (2026-10): 60 ambient
                              // (word matching), 45 under the trigger
                              // char (scattered tier-1 visible there);
                              // an explicitly set value overrides BOTH.
                              // Default is the calibration starting
                              // point (09 tuning protocol), imported from
                              // the baked constant in the query module
                              // automatically — same pattern as
                              // rejectCommonness.
  "menuDelayMs": 0,          // 0–2000: hesitation gate for the menu's
                              // first appearance. DEFAULT 0 (OFF): the
                              // popping the gate was built to stop turned
                              // out to be chain-offer stickiness and
                              // relief-word clutter (since fixed), and
                              // calibrated values (150, 300) never matched
                              // real typing — the owner's word-boundary
                              // gaps straddle any fixed threshold. Set to
                              // your measured pause length if flow-popping
                              // ever bothers again.
  "enableChaining": true,    // M2 flag; gates the successor-index chain
                              // layer only. "enablePhrases" is accepted as a
                              // deprecated alias for this key. Word
                              // completion is unaffected either way.
  "debug": false             // enables /acwords command + store dump
}
```

Validation: clamp/repair invalid values to defaults (log when repaired).
`triggerChar` must match `/^[^\w\s]$/` or be empty. `threshold` clamped to
1–3. `maxSuggestions` clamped 1–20. `rejectCommonness` clamped 1–255.
`fuzzThreshold` clamped 0–100. `menuDelayMs` clamped 0–2000.

Reserved triggerChar (2026-09-30, validation Issue 2): `@`, `/` and `"`
pass the schema but are structurally dead — `classifyStockContext`
(provider.ts) unconditionally routes `@frag` to the stock mention
context, `/`-bearing text to path (and a line-leading `/` to the
slash-command context), and text under an unclosed `"` to quoted-path
BEFORE the trigger branch is consulted, and that stock delegation is
deliberately config-independent (BUG-001). A user who sets one of these
gets a silently non-functional trigger (word matching still works, so
the failure is invisible). `loadConfig` therefore checks the EFFECTIVE
value once, after all layers merge, and emits one `"warning"` notify
naming the colliding char and the stock context that owns it; a later
layer overriding the collision away silences it. The value still applies
(trigger mode is merely dead, never half-dead); the warning is advisory,
not a rejection.

## Not configurable (by settled decision)

- Salience weights, the mid-frequency band (20; retired 2026-10 — both
  conjugation-guard tiers ride the length-conditioned R_eff), the
  capitalized-series admission band (95) and the dictionary top-band
  ceiling (04), the
  proper-noun relief ceiling (30, retired-in-place — scales with the
  floor), the
  length-gradient curve shape (sqrt, 8-char floor hold, 20-char
  admit-all — 2026-10), shape-gate secret rules, the conjugation-guard
  suffix set, eviction cap, debounce intervals, popup timing, the
  widget line-claim lifecycle (07 — release events are semantics), and
  the
  fuzzy scorer's tier constants (04 — tier BOUNDARIES are semantics,
  not tuning). These are
  internal tuning constants — the tuning protocol lives in 09, not in
  user config. The admission floor and the fuzzy admission threshold
  are the TWO deliberate exceptions (`rejectCommonness`,
  `fuzzThreshold`): dictionary attestation is near-disqualifying
  evidence at short lengths (2026-09 owner rule — "commit hashes and
  variable names, not half of the english language"; length-conditioned
  2026-10 — see 04); the knob exists so the owner can loosen or tighten
  against real sessions without a code edit (fuzz threshold,
  2026-10: a large store with loose fuzzy settings bloats the
  suggestions). The
  config default imports score.ts's baked REJECT_COMMON_THRESHOLD
  automatically — no separate default to keep in sync.

## Debug command (`/acwords`, registered when `debug: true`)

Read-only inspection for development: dumps top-50 candidates by salience,
store size, rank-group histogram, shape-gate rejection counts, and (M2)
a successor-index sample. Output via `ctx.ui.notify` or the
widget API; never logs message bodies (store holds words + counters only).
**Complete list (2026-09):** every invocation also writes the FULL store
to `/tmp/hapax-store.txt` — one line per word (key, display, count,
group, proper/typed flags), count-desc then content order — and the
notify footer names the path. The popup caps at 50; the file does not.

Why the popup/menu is capped at all: `maxSuggestions` (default 8,
1–20) is the per-query return cap — a menu-height decision (04), not a
store cap; pi-tui additionally renders only `autocompleteMaxVisible`
rows (a pi setting) and pages the rest with ↑/↓. The store itself
holds up to 20,000 words (06).