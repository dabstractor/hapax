# 02 — Architecture

## Components

```
┌─────────────────────────────────────────────────────────────┐
│ pi extension (ESM, TypeScript)                               │
│                                                              │
│  message_end events ──► Ingestion Pipeline                   │
│                          │  (debounced, chunk-yielded)       │
│                          ▼                                   │
│                        Segmenter ──► Shape Gate              │
│                          │            │                      │
│                          ▼            ▼                      │
│                     Dictionary    Candidate Store             │
│                     (packed,      (per-session, mutable)     │
│                      frozen,            ▲                    │
│                      ~1–2 MB)           │                    │
│                                       │ │                    │
│  keystrokes ──► Autocomplete Provider ─┘ │ (M2: successor    │
│                 (via addAutocomplete-    │  index)           │
│                  Provider, debounced     │                   │
│                  popup)                  │                   │
└─────────────────────────────────────────│───────────────────┘
                                          │
                            pi built-in path/slash completion
                            (delegated via `current`)
```

## Module layout

Two-layer split: `src/core/` is **pure, agent-agnostic computation** (no
pi imports allowed — enforced by review; unit tests run against it standalone)
and `src/pi/` is the extension wiring. This split is load-bearing for a
future iteration (see "Portability note" at the end of this document).

```
hapax/
├── package.json              # pi extension manifest
├── dict/
│   └── common-en.bin         # packed dictionary (build artifact, shipped)
├── tools/
│   └── build-dict.mjs        # offline dictionary build script
├── src/
│   ├── core/                 # pure, agent-agnostic — no pi imports
│   │   ├── dictionary.ts     # packed-binary loader + lookup
│   │   ├── segment.ts        # word segmentation + normalization
│   │   ├── shapeGate.ts      # shape/entropy/secret rejection
│   │   ├── score.ts          # admission decision + salience formula
│   │   ├── store.ts          # candidate store, eviction, (M2: successor index)
│   │   ├── query.ts          # anchored fuzzy match, tier + frequency
│   │   │                     #   ranking (pure store queries)
│   │   └── types.ts          # shared core types
│   └── pi/                   # pi extension adapter
│       ├── index.ts          # extension factory, event wiring
│       ├── ingest.ts         # message_end handling, debounce, chunking,
│       │                     #   session-history restore replay
│       ├── provider.ts       # autocomplete provider — FALLBACK display
│       │                     #   path (trigger regexes, debounce,
│       │                     #   hysteresis, chaining M2)
│       ├── widget.ts         # one-line result widget — PRIMARY display
│       │                     #   path: rendering, key handling,
│       │                     #   visibility state machine + per-prompt
│       │                     #   line claim (M3, 07)
│       ├── editor.ts         # enter-submits-while-autocompleting guard
│       │                     #   (07: Enter accepts the menu instead)
│       ├── debug.ts          # /acwords read-only store+stats dump
│       │                     #   (08 h2.48; registered when config.debug)
│       ├── paths.ts          # jiti-safe dictionary path resolution
│       └── config.ts         # config load/merge with defaults
└── test/
    ├── segment.test.ts
    ├── shapeGate.test.ts
    ├── score.test.ts
    ├── store.test.ts
    ├── dictionary.test.ts
    ├── query.test.ts
    ├── provider.test.ts       # fallback-path provider tests (mock ctx.ui)
    └── widget.test.ts         # one-line widget tests (M3: keys, visibility)
```

`package.json` (pi auto-discovers `.pi/extensions/*/index.ts` or
`~/.pi/agent/extensions/*/index.ts`; use the subdirectory package layout):

```json
{
  "name": "hapax",
  "version": "0.1.0",
  "type": "module",
  "pi": { "extensions": ["./src/pi/index.ts"] }
}
```

No npm dependencies required for M1 (dictionary loader is hand-rolled;
build script uses only node stdlib). Do not add dependencies.

## Data flow

### Ingest path (background, never on keystroke path)

1. `message_end` fires with the finalized message (see 05 for event contract).
2. If role is `user` or `assistant` and content yields text: schedule ingest
   (300 ms debounce; only latest message per debounce window is processed —
   intermediate ones queue).
3. Segmentation → per-word shape gate → dictionary lookup → admission decision
   → store upsert (count, lastSeen, source weights).
4. Chunked: yield to the event loop every ≤64 KB of processed text.

### Query path (synchronous, every keystroke)

1. Provider's `getSuggestions` receives editor lines + cursor.
2. Extract the current word fragment before the cursor (or trigger-char run).
3. If a word fragment is live (1 char; see 07) or the trigger char is
   active: anchored-fuzzy search the store (first-char bucket, 04),
   sort tier → sessionCount → length → lex (04), return top 8 items.
4. This must complete in < 1 ms. No allocation-heavy work; the store's
   prefix index is maintained at ingest time — the fuzzy anchor (first
   char exact) keeps it the scan entry point.

### Display path (widget primary; menu fallback)

- Primary: the one-line widget renders the result set synchronously;
  the 100 ms display debounce, flicker hysteresis, and the visibility
  state machine live in the widget layer (07). Fallback: the provider
  returns items and pi renders the vertical menu. Tab completion reads
  the synchronous result directly on either path and is never gated by
  the debounce.

## Extension lifecycle wiring

- `session_start { reason }`: lazily load dictionary (first use), rebuild store
  by replaying session history oldest→newest in background (reason `"resume"`
  or `"startup"` with existing history).
- `message_end`: schedule ingestion.
- `session_shutdown`: drop store and dictionary references; nothing to flush
  (no persistence).
- The factory itself must not start background resources; everything is
  deferred to `session_start` per pi extension rules.

## Portability note (future iteration, out of M1/M2 scope)

The `core/` layer is intentionally free of pi dependencies so that other
agents can reuse it. Verified ecosystem survey (2026-09): message harvesting
is available on every major agent (hooks or on-disk transcripts), but
input-box completion injection is rare. The one credible second target is
**Claude Code**, whose `fileSuggestion` setting offers a pipe-a-query /
print-lines contract for `@`-triggered suggestions — enough for a
trigger-char-only degraded mode (harvest via its `UserPromptSubmit` /
`MessageDisplay` hooks). Do not design for it now; keeping `core/` pure is
the entire obligation this note creates.

## Performance budgets (hard requirements)

| Operation | Budget |
|---|---|
| Single keystroke query (anchored fuzzy + tier/count sort + top 8) | < 1 ms |
| Dictionary load (parse packed file) | < 50 ms cold, < 5 ms warm |
| Ingest of one message (typical 1–10 KB) | < 5 ms |
| Full 300k-token session restore | < 100 ms total, chunked |
| Steady-state memory (dict + store) | < 6 MB |
| Ingest chunk yield granularity | ≤ 64 KB text per event-loop turn |