# Research — P1.M4.T1.S1 prefix-anchor invalidation (BUG-002)

## Verified code facts (read from live source)

- `createDisplayProvider` lives in `src/pi/provider.ts` ≈L540–700. Relevant
  state: `displayedSig/displayedItems/displayedPrefix`, `lastPaintAt`,
  `completionSincePaint`, `pending*`, `paint()`, `promotePending()`,
  `scheduleSwap()`, `reset()`, `copyOf()`, `signatureOf()`.
- Rule order in `getSuggestions` (verified by reading): 1 inner query →
  2–3 isHapax classification (`result.prefix === live.prefix`, live computed
  from CURRENT buffer ⇒ any fresh hapax result is anchor-safe) → 4a first
  paint/identical → 4b window elapsed → 4c-exception
  (`completionSincePaint`) → 4d suppression returns
  `{items: copyOf(displayedItems), prefix: displayedPrefix}` — THE BUG: when
  the fresh set differs but the user typed MORE characters, displayedPrefix
  is stale relative to the buffer; pi's editor stores suggestions.prefix and
  Tab deletes exactly `prefix.length` chars before the cursor with no
  re-verification (pi-tui editor.js:1925-26, 540-551, 1903-12;
  autocomplete.js:265-267 `slice(0, cursorCol - prefix.length)`).
- 4c-exception block (≈L659-673) with `applyCompletion` wrapper setting
  `completionSincePaint = true` (≈L690) is the pattern to mirror for the new
  exception. Note the new check goes AFTER 4c and BEFORE 4d.
- Important subtlety: identical-prefix narrowing (set changes, prefix
  UNCHANGED, e.g. 'ze'→'ze' after new ingest) must KEEP suppression — only
  `result.prefix !== displayedPrefix` forces a paint. Also: a SHORTER fresh
  prefix (user backspaced) also differs → paint (suffix-match invariant
  covers both directions).
- Test harness to extend: `test/provider-display.test.ts` — fake timers
  pinned via `setSystemTime(0)`, `zeStore()` fixture
  (zendesk×4/ZendeskAgent×3/zephyr×1/alpha), `mockCurrent()`,
  `harness(debounceMs)` emit pattern recording Emission lists. Existing
  mocks do NOT model pi's deletion math — new faithful helper needed.
- The PRD repro needs store zendesk+zephyr where 'z' delegates/none and
  'ze' paints {zendesk,zephyr}, 'zep' live-narrows to {zephyr}.
  `zeStore()` orders Zendesk, ZendeskAgent, zephyr — a dedicated store with
  exactly zendesk+zephyr (and 'z' below the 2-char threshold delegating) is
  cleaner for the repro; note threshold default = 2 so 'z' alone delegates
  via zero-candidate/length path, and '#z' trigger mode with 1-char fragment
  vs threshold 2 — use threshold typing (no '#') like the existing harness's
  emit("#"+fragment)? Existing harness uses trigger '#'. For the repro use
  plain threshold-mode typing (fragment chars typed directly) to match the
  PRD scenario ("type z, then e, then p") — extractMatchState supports both.
  Verify with live.provider what mode fires; simplest: build lines as
  fragment-only (threshold mode, chars ≥ threshold 2).
- Reuse/export: helper must be exported for P1.M5.T1.S1 (typing-path probes).
  Place in `test/helpers/editor-sim.ts` (sibling of dict-writer.ts) or
  export from the test file; helpers/ dir preferred for cross-suite import.
- Prior-item contract (P1.M3.T2.S1, parallel): touches src/pi/ingest.ts only
  — zero overlap with provider.ts; safe.
- Gates: `npm run check` (tsc --noEmit strict), `npm test` (vitest --run,
  currently 523+ tests). No new deps.