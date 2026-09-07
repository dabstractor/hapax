# Research — P1.M4.T1.S1 scripted integration acceptance

## Verified facts (2026-09 pass + live checks)

- pi CLI (0.84.4): `pi -e <path>` loads an extension dir via package.json
  `pi.extensions` manifest. `-p/--print` = non-interactive one-shot mode.
  `-r/--resume` selects a session. `--export <file>` exports a session as
  JSONL. Sessions live under `~/.pi/agent/sessions/`.
- hapax package.json manifest: `"pi": { "extensions": ["./src/pi/index.ts"] }`
  — the verified dev-load path from P1.M3.T5.S2 is `pi -e /home/dustin/projects/hapax`.
- `src/pi/index.ts` is still the empty stub (P1.M3.T5.S1/S2 are Implementing/
  Ready in parallel) — this task CONSUMES their outputs; treat their PRPs as
  contracts.
- Extension event surface (architecture/pi_extension_api.md):
  `session_start {reason: startup|reload|new|resume|fork, previousSessionFile?}`,
  `message_end`, `session_shutdown`. `ctx.sessionManager.getEntries()`
  returns SessionEntry[] for restore replay (implemented in ingest.ts
  `restoreFromHistory`, reason-independent). `ctx.mode` is
  `tui|rpc|json|print`.
- provider.ts: `extractMatchState` pure gate; `createHapaxProvider` wraps
  `current` provider and DELEGATES (calls `current.getSuggestions` with
  unchanged args) on null match state / zero candidates — this delegation is
  what preserves path/slash/@ completion, and what item 6 regression-tests.
- Test stack: vitest 4, `npm test` (vitest --run), `npm run check`
  (tsc --noEmit). `pi --check` does NOT exist.
- Automation reality: popup rendering + Tab insertion are TUI-interactive —
  not automatable headless. `pi -p` mode does not exercise the input-box
  autocomplete at all (it processes a prompt and exits; ctx.mode === "print").
  => Acceptance strategy is HYBRID:
  - Scriptable: store/ingest behavior per fixture (drive hapax modules
    directly in vitest against the fixture transcripts; and `pi -p -e` to
    prove real-extension load + message_end ingest + /acwords stats in print
    mode).
  - Manual (documented in RESULTS.md): items requiring the live input box —
    menu offer/Tab insert casing, no-hijack keystroke behavior, debounce,
    path-completion parity with/without `-e`.

## Fixture design (doubles as PRD §09 tuning corpus)

`test/fixtures/sessions/` holds 3 synthetic session JSONL transcripts in pi
session-entry shape (role user/assistant, content blocks) + expected
completion labels (precision@8 hand labels):
1. `zendesk-lwlock.jsonl` — happy-path vocabulary session.
2. `prose.jsonl` — ordinary prose, no jargon; no expected completions.
3. `large-100k.jsonl` — 100k+ token session (~400KB+ text) with distributed
   vocabulary incl. an API-key paste (item 5) near the end — used for both
   item 3 (resume restore timing) and item 5 (secret never suggested).
Compaction (item 4) is scripted at module level (rebuild store, simulate
compaction dropping entries — store survives by design, no persistence).

## pi session JSONL entry shape

Export via `pi --export` on a real session gives the authoritative shape;
fixtures are hand-built to that shape (fields: type/id/timestamp/message{role,
content}). Loader fixture helper should be tolerant of unknown fields.