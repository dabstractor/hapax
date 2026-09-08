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
│   │   ├── query.ts          # prefix search + ranking (pure store queries)
│   │   └── types.ts          # shared core types
│   └── pi/                   # pi extension adapter
│       ├── index.ts          # extension factory, event wiring
│       ├── ingest.ts         # message_end handling, debounce, chunking,
│       │                     #   session-history restore replay
│       ├── provider.ts       # autocomplete provider (trigger regexes,
│       │                     #   debounce, hysteresis, chaining M2)
│       └── config.ts         # config load/merge with defaults
└── test/
    ├── segment.test.ts
    ├── shapeGate.test.ts
    ├── score.test.ts
    ├── store.test.ts
    ├── dictionary.test.ts
    ├── query.test.ts
    └── provider.test.ts       # pi-adapter tests (mock ctx.ui)
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
3. If fragment length ≥ threshold (default 2) or trigger char active: prefix
   search the store, score-sort, return top 8 items.
4. This must complete in < 1 ms. No allocation-heavy work; the store's prefix
   index is maintained at ingest time.

### Popup path (display only)

- The provider returns items synchronously; pi renders the menu. The 100 ms
  display debounce and flicker hysteresis are implemented inside the provider
  (see 07). Tab completion reads the synchronous result directly and is never
  gated by the debounce.

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
| Single keystroke query (prefix + sort + top 8) | < 1 ms |
| Dictionary load (parse packed file) | < 50 ms cold, < 5 ms warm |
| Ingest of one message (typical 1–10 KB) | < 5 ms |
| Full 300k-token session restore | < 100 ms total, chunked |
| Steady-state memory (dict + store) | < 6 MB |
| Ingest chunk yield granularity | ≤ 64 KB text per event-loop turn |