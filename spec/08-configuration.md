# 08 — Configuration

## Config surface (deliberately tiny)

pi has no extension-settings API for this; the extension reads a plain JSON
config file itself. Load order (later wins):

1. Built-in defaults (in code).
2. `~/.pi/agent/hapax.json` (user-global).
3. `.pi/hapax.json` (project-local, if the project is trusted).

Malformed file → warn once via `ctx.ui.notify(..., "warn")`, fall back to
defaults, continue running. Missing files are normal.

## Schema

```jsonc
{
  "triggerChar": "#",        // single non-alphanumeric char; "" disables
                              // trigger mode entirely
  "threshold": 2,            // RETAINED BUT INERT in the live editor:
                              // pi-tui only requests at word starts, so
                              // matching is effectively 1 char (see 07).
                              // Kept for schema compatibility. 1 | 2 | 3.
  "maxSuggestions": 8,       // 1–20
  "rejectCommonness": 50,    // 1–255: dictionary quantile at/above which
                              // a word is rejected from the store (higher
                              // = looser). Governs admission AND the
                              // conjugation guard's stem comparison. Probe
                              // any word first: node tools/calibrate-bands.mjs
                              // <words...> prints q + verdict (lowercase and
                              // Capitalized). Default: the baked constant
                              // in src/core/score.ts.
  "menuDelayMs": 300,        // 0–2000: hesitation gate for the menu's
                              // first appearance, measured at the WORD
                              // BOUNDARY (queries only fire at word
                              // starts, and the space→letter gap is the
                              // longest natural one: 150–250 ms at 100+
                              // WPM — 150 suppressed almost nothing in
                              // real rhythm). Word-completions paint only
                              // when a keystroke arrives ≥ this many ms
                              // after the previous. Trigger-char and
                              // Tab-chain results bypass it. 0 = always
                              // immediate.
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
`menuDelayMs` clamped 0–2000.

## Not configurable (by settled decision)

- Salience weights, the mid-frequency band (20), the proper-noun relief
  ceiling (95), shape-gate secret rules, the conjugation-guard suffix
  set, eviction cap, debounce intervals, popup timing. These are
  internal tuning constants — the tuning protocol lives in 09, not in
  user config. The reject band is the one deliberate exception
  (`rejectCommonness`): everyday-word leakage is an ongoing dial the
  owner tunes against real sessions, and a code edit per tweak would
  defeat that.

## Debug command (`/acwords`, registered when `debug: true`)

Read-only inspection for development: dumps top-50 candidates by salience,
store size, rank-group histogram, shape-gate rejection counts, and (M2)
a successor-index sample. Output via `ctx.ui.notify` or the
widget API; never logs message bodies (store holds words + counters only).