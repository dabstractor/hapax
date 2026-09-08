# Research notes — bugfix P1.M3.T1.S1 (BUG-004 part 1: failure probe + per-segment disable gate)

## Verified codebase state (this is the FULL M1+M2 implementation, not the early scaffold)

- `src/pi/index.ts`:
  - `createLazyDictionary(path, onLoadError)` (≈L79–112): closure `let failed = false;`
    `let dict: Dictionary | null`. `lookup()` returns null immediately when `failed`,
    sets `failed = true; onLoadError(); return null` on the first load throw. Exposes
    `version`/`entryCount` getters only. **No failure getter** — the bug.
  - Factory has `let disabled = false` (≈L125); set true in the `onLoadError`
    callback (≈L147–150). `disabled` gates only the `message_end` handler
    (L217: `if (!disabled && pipeline) ...`). `session_start` runs
    `restoreFromHistory(pipeline, ctx.sessionManager)` with NO disabled check
    (L213-214) — and at that point the lazy dict hasn't loaded yet, so `disabled`
    is still false even when the dict is broken. Exactly BUG-004.
  - `pipeline = new IngestPipeline({...})` at L151 — wire `isDisabled` there.
- `src/core/types.ts` L115-119: `interface Dictionary { lookup(word): number|null;
  readonly version; readonly entryCount }`.
- `src/pi/ingest.ts`:
  - `IngestPipelineOptions` (L101+) — add optional `isDisabled?: () => boolean`.
  - Constructor stores all options in `#private` fields (pattern: `this.#x = options.x ?? default`).
  - `processText(text, fromUser)` (L267): early return on empty text; allocates ordinal;
    loops slices → `#admitSegment(segment, ordinal, fromUser)` per '\n' segment;
    awaits `yieldFn` between slices; fires `#onAdmittedTokens(lines)` at the end.
  - `#admitSegment` (L302): per token → `expandCandidates` → `passesShape` →
    `admit(draft, this.#dictionary, ...)` → `store.upsert`.
  - Note: P1.M2.T1.S1 (maskSecrets pre-segmentation) is being implemented in
    parallel and will also touch `#admitSegment` — keep this PRP's edits to the
    admission loop MINIMAL (one gate check at top of the token loop + top of
    processText) to avoid conflict.
- `restoreFromHistory` at ingest.ts ~L409: standalone function taking
  `pipeline: Pick<IngestPipeline, "processText">`. P1.M3.T1.S2 (next task) will
  abort it — this task only provides the seam (`failed` probe + `isDisabled`).
- `src/pi/paths.ts` has `resolveDictPath()` re-exported from index.ts.
- Tests live in `test/*.test.ts`, vitest, NodeNext `.js` imports, header
  doc-comment style. Relevant existing suites: `test/ingest-pipeline.test.ts`,
  `test/ingest-restore.test.ts`, `test/index.test.ts`. Gates: `npm run check`,
  `npm test`.
- createLazyDictionary can be tested against a nonexistent path — loadDictionary
  throws; sticky failure thereafter (no retry, exactly one onLoadError).

## Design decisions
- Probe shape: `get failed(): boolean` getter on the lazy dictionary object.
  Backward compat: add OPTIONAL `readonly failed?: boolean` to `Dictionary`
  interface in src/core/types.ts (other Dictionary impls — the real
  loadDictionary result, test stubs — simply omit it; `?.` at check sites).
- Gate placement: (1) top of `processText` (covers whole call — message drain and
  restore both funnel through it); (2) inside `#admitSegment`'s token loop so a
  failure observed MID-message stops admissions for the rest of that message
  (multiple slices await yieldFn; failure can be set by an earlier lookup).
- Phrase hooks: when the gate trips mid-`processText`, skip the remaining
  admissions but it's fine to still call `#onAdmittedTokens` with whatever lines
  were built (nothing new will be admitted after the gate). Simplest correct:
  check the gate at the top of the `#admitSegment` loop AND break out of
  processText's chunk loop when disabled — record decision: break the outer loop
  and return early (before `#onAdmittedTokens`? — no: partial lines already
  admitted could feed phrases; safest minimal: return early WITHOUT calling
  onAdmittedTokens, since this state is "extension disabled" and M2 phrases from
  a half-disabled message are meaningless). Document this.
- index.ts wiring: `isDisabled: () => disabled` in the `new IngestPipeline({...})`
  call at ~L151.
- No config surface change; JSDoc only (Mode A docs).