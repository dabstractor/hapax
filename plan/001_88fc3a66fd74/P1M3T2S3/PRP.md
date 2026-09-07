# PRP — P1.M3.T2.S3: Session restore: history replay via sessionManager

## Goal

**Feature Goal**: Implement `restoreFromHistory(pipeline, sessionManager): void` in
`src/pi/ingest.ts` — the PRD §05 (h2.31/h2.33) session-restore path. On session
start it reads conversation history from pi's read-only session manager and
replays it **oldest → newest** through the *identical* ingestion pipeline
(same gates, same counters, same eviction cap) in the background, so the
candidate store is progressively populated and completions are available
within minutes of session start.

**Deliverable**:
1. `src/pi/ingest.ts` extended with `restoreFromHistory` (S1's `extractText`
   and S2's `IngestPipeline` stay intact and are reused, not reimplemented).
2. `test/ingest-restore.test.ts` — unit suite with fake session managers
   (branch ordering, fallback entries, non-message entries, empty history).

**Success Definition**: `npm run check` and `npm test` green (including the new
suite and the existing `test/ingest.test.ts`); replay is oldest-first through
`pipeline.processText`; empty history is a no-op; the function returns
immediately (replay is fire-and-forget background work that never rejects an
unhandled promise); `index.ts` (P1.M3.T5.S1) can call it inside
`session_start`.

## Why

- PRD §05 h2.31: there is **no persistence layer by design** — the store is
  rebuilt from session history at session start (rebuild beats deserialize at
  ~200k tokens / ~800KB ≈ 30–50 ms). This is the only cold-start work.
- Without restore, the extension forgets session vocabulary on every restart
  and completions are limited to the live dictionary until the user types.
- Oldest-first ordering is **load-bearing**: `lastSeen` ordinals and display
  casing must end in the correct final state (the last sighting of a word in
  real history determines its casing and recency).
- Runs whenever history exists, regardless of `session_start` reason
  (`startup`, `resume`, `new`, `fork`, `reload` all can carry history —
  verified in pi docs extensions.md:281/319/325/1319).

## What

### Behavior contract (exact)

```ts
// Minimal structural type — avoids depending on the exact pi export list for
// ReadonlySessionManager (it is NOT re-exported at the package root; only
// SessionManager/SessionEntry are). Structural typing is safe and testable.
export interface RestoreSessionManager {
  getBranch(): SessionEntry[];   // leaf → root order (walk from entry to root)
  getEntries(): SessionEntry[];  // ALL entries, oldest → newest, incl. abandoned branches
}

/**
 * Replay session history oldest→newest through the pipeline in the background.
 * Returns immediately (void) — never blocks session_start. Fire-and-forget:
 * internal errors are caught and swallowed/logged, never an unhandled rejection.
 */
export function restoreFromHistory(
  pipeline: Pick<IngestPipeline, "processText">,
  sessionManager: RestoreSessionManager,
): void;
```

**Source selection**:
1. Primary: `sessionManager.getBranch()` — current-branch entries, returned
   **leaf → root**; REVERSE for oldest → newest (faithful to what the live
   context actually contains).
2. Fallback: if the branch is empty (or throws), use `sessionManager.getEntries()`
   — all append-only entries oldest → newest (includes abandoned branches;
   acceptable fallback vocabulary). Already oldest-first — do NOT reverse.

**Copy before reverse**: `getBranch()` may return an internal array reference —
`const branch = [...sessionManager.getBranch()].reverse()` (never mutate the
returned array in place).

**Filtering**: keep only `entry.type === "message"` entries; the `session`
header, `compaction`, `model_change`, `thinking_level_change`,
`branch_summary`, file and custom entries are skipped entirely. Per PRD §05
h2.32 the store deliberately survives compaction — we replay pre-compaction
messages; this is correct per the settled decision.

**Replay loop** (inside an async function launched fire-and-forget):
```ts
for (const entry of orderedEntries) {
  if (entry.type !== "message") continue;
  const text = extractText(entry.message);   // S1's extractor — same rules as live
  if (text === null) continue;               // toolResult etc. → skip, no-op
  await pipeline.processText(text, entry.message.role === "user");
  // text reference goes out of scope each iteration (h2.34: never hold bodies)
}
```
`processText` (from S2) already: chunks at ≤64 KB with yields (background-safe),
calls `store.nextOrdinal()` once per message, upserts through the same gates
and counters, and store.upsert internally applies the 20k-cap eviction with
the same salience formula (h2.33 — a huge history evicts early words correctly
during replay; `restoreFromHistory` must NOT special-case or bypass eviction).

**No-op cases**: empty branch AND empty entries; entries but zero `message`
entries; only messages whose `extractText` returns `null`. In all cases the
function returns cleanly without starting work.

**Reason-independence**: `restoreFromHistory` does NOT inspect the
`session_start` reason — it replays whenever history exists. The caller
(`index.ts`, P1.M3.T5.S1) invokes it unconditionally inside its
`session_start` handler; reason gating ("startup"/"resume" named in the PRD,
"reload"/"fork" also carry history — verified) is unnecessary and would
*drop* valid history.

**Scheduling**: replay starts immediately in the background (debounced
startup is fine per PRD, but simply awaiting `processText`'s built-in chunk
yields already keeps it off the keystroke path — no extra debounce needed).
If `flush()`/live `message_end` processing overlaps the replay, both paths go
through the store's synchronous upsert — safe; worst case ordinals interleave,
which only affects recency ranking marginally and is acceptable.

### Success Criteria

- [ ] `getBranch()` entries replayed in reversed (oldest→newest) order.
- [ ] Empty/unavailable branch falls back to `getEntries()` (oldest→newest,
      not reversed).
- [ ] Non-`message` entries (header, compaction, model_change, branch_summary,
      custom) skipped.
- [ ] Messages extracting to `null` (toolResult, empty) skipped without
      calling `processText`.
- [ ] Each replayed message calls `processText(text, fromUser)` exactly once,
      in order.
- [ ] Returns `void` synchronously; background errors swallowed — no unhandled
      rejection.
- [ ] No special-casing of eviction, stats, or gates — identical pipeline.
- [ ] Arrays returned by `getBranch()` are never mutated in place.

## All Needed Context

### Context Completeness Check

Validated: sessionManager API verified against pi's shipped docs
(`extensions.md` §ctx.sessionManager, `session-format.md` §SessionManager /
entry types) and `dist/core/session-manager.d.ts` (ReadonlySessionManager
type). S1/S2 upstream contracts pinned via their PRPs; `processText` signature
confirmed in the S2 PRP behavior contract.

### Documentation & References

```yaml
- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md#ctx.sessionmanager
  why: ctx.sessionManager read-only surface — getBranch()/getEntries() semantics
  critical: getBranch(fromId?) = "Walk from entry to root" ⇒ LEAF→ROOT order (must reverse);
    getEntries() = all entries (append-only, oldest→newest incl. abandoned branches)

- url: file:///home/dustin/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md
  why: SessionEntry shapes — SessionEntryBase {type,id,parentId,timestamp}; SessionMessageEntry
    = {type:"message", message: AgentMessage}; full list of other entry types to skip
  critical: the "session" header is NOT a SessionEntryBase and appears in getEntries();
    filter type==="message" handles it

- file: dist/core/session-manager.d.ts (in @earendil-works/pi-coding-agent)
  why: ReadonlySessionManager = Pick<SessionManager, ...| "getBranch" | "getEntries" | ...>
  gotcha: ReadonlySessionManager is NOT re-exported at the package root — use the structural
    RestoreSessionManager interface instead, or import type { SessionEntry } from the root

- file: src/pi/ingest.ts
  why: S1 extractText(message): string|null and S2 IngestPipeline.processText(text, fromUser)
  pattern: reuse both — restore adds no text-extraction or scoring logic of its own

- file: plan/001_88fc3a66fd74/P1M3T2S2/PRP.md
  why: contract for processText (chunked, one nextOrdinal per message, upsert→eviction inside store)

- file: plan/001_88fc3a66fd74/P1M3T2S3/research/notes.md
  why: this item's research — session_start reason semantics, ordering facts, decisions

- file: test/ingest-pipeline.test.ts (created by S2) and test/ingest.test.ts
  why: vitest conventions, message factories (userMsg/assistantMsg) to copy
```

### Current Codebase tree (relevant)

```bash
src/core/  # dictionary, segment, shapeGate, score, store, query, types — COMPLETE
src/pi/
  index.ts   # placeholder — P1.M3.T5.S1 wires restoreFromHistory in session_start
  config.ts  # complete
  ingest.ts  # S1 extractText (+ AgentMessage alias); S2 adds IngestPipeline; S3 adds restoreFromHistory
test/       # flat vitest suites: ingest.test.ts (S1) exists; ingest-pipeline.test.ts (S2) incoming
```

### Desired Codebase tree with files to be added/changed

```bash
src/pi/ingest.ts              # MODIFY: add RestoreSessionManager interface + restoreFromHistory
test/ingest-restore.test.ts   # NEW: restore unit suite
```

### Known Gotchas of our codebase & Library quirks

```ts
// CRITICAL: getBranch() returns leaf→root; REVERSE a COPY
// ([...sm.getBranch()].reverse()) — never .reverse() the original array in place.

// CRITICAL: getEntries() is ALREADY oldest→newest — do not reverse it.

// CRITICAL: fire-and-forget async work must never produce an unhandled
// rejection — wrap the replay loop body in try/catch, or attach a .catch()
// to the launched promise. Errors during replay are swallowed (optionally
// console.warn); session start must proceed.

// CRITICAL: ESM project — internal imports use ".js" extension:
// import { extractText } from "./ingest.js" is NOT needed (same file) — only
// `import type { SessionEntry } from "@earendil-works/pi-coding-agent"` if used.

// GOTCHA: don't gate on event.reason — every session_start reason that carries
// history (startup/resume/new/fork/reload) should replay; empty history no-ops.

// GOTCHA: don't accumulate texts into one big string — process each message
// individually (one nextOrdinal per message, ordinal semantics preserved).

// GOTCHA: `import type` only for pi packages in src/pi (erased at runtime).
```

## Implementation Blueprint

### Data models and structure

No new core models. Add `RestoreSessionManager` (structural interface, above)
and one exported function. Entry shape comes from pi's `SessionEntry` — narrow
with `entry.type === "message"` and access `entry.message`; if the root export
of `SessionEntry` is a union, a local minimal type
`{ type: string; message?: AgentMessage }` filtered on `type === "message"`
then cast is acceptable — keep it type-safe without `any`.

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EXTEND src/pi/ingest.ts — restoreFromHistory
  - ADD: RestoreSessionManager interface + restoreFromHistory per the behavior
    contract; structure:
      1. collect ordered messages:
         try { branch = sessionManager.getBranch() } catch { branch = [] }
         ordered = branch.length > 0 ? [...branch].reverse() : safeGetEntries()
         (safeGetEntries: try getEntries() catch → [])
      2. filter message entries into a plain array of {text, fromUser} BEFORE
         starting async work? NO — extract lazily inside the loop (h2.34: never
         hold text bodies longer than needed); pre-filter only the entry list.
      3. launch void (async () => { for (entry of ordered) { if type!=="message"
         continue; const text = extractText(entry.message); if (text === null)
         continue; await pipeline.processText(text, entry.message.role === "user"); } })()
         wrapped so no rejection escapes.
  - NAMING: restoreFromHistory (exported), RestoreSessionManager (exported)
  - FOLLOW pattern: JSDoc one-liners citing PRD §05 h2.31/h2.33 like the rest
    of src/pi/ingest.ts
  - PLACEMENT: src/pi/ingest.ts after IngestPipeline

Task 2: CREATE test/ingest-restore.test.ts
  - FIXTURES: fake session managers as plain objects:
      const msgEntry = (id, parentId, role, content) => ({ type: "message", id,
        parentId, timestamp: "t", message: { role, content } });
      non-message entries: { type: "session", ... }, { type: "compaction", ... },
      { type: "model_change", ... }, { type: "branch_summary", ... }
    fake pipeline: { processText: vi.fn(async (_t, _f) => {}) } recording
    (text, fromUser) pairs in call order.
  - CASES (all required):
    1. branch ordering: getBranch returns leaf→root [e3, e2, e1] → processText
       called for e1, e2, e3 in that order
    2. getBranch not mutated: pass a frozen/spied array, assert no in-place
       reverse (array property order unchanged / toHaveBeenCalled patterns)
    3. fallback: getBranch returns [] → getEntries used in its own order
       (oldest→newest, NOT reversed)
    4. fallback not taken when branch non-empty (getEntries spy not called)
    5. both throw / both empty → no processText calls, no throw
    6. non-message entries skipped (header first in entries, compaction
       mid-branch)
    7. null-extraction messages (toolResult, assistant tool_use-only) skipped
    8. fromUser mapping: user message → true; assistant → false
    9. one processText per message, text equals extracted text (string user
       content and block-array assistant content both exercised)
    10. sync return: restoreFromHistory returns undefined immediately; with a
        processText that awaits, all calls still complete when awaited via
        flushing microtasks (await vi.waitFor or a settled-promise helper)
    11. background error resilience: processText rejects once → no unhandled
        rejection (process-level unhandledRejection listener or just assert
        subsequent messages still processed if design continues on error —
        pick: catch per-iteration and continue with remaining entries)
  - FOLLOW pattern: test/ingest.test.ts factories + describe header
    `describe("restoreFromHistory — PRD §05 h2.31/h2.33")`
  - PLACEMENT: test/ingest-restore.test.ts
```

### Implementation Patterns & Key Details

```ts
// The whole non-obvious core:
export function restoreFromHistory(
  pipeline: Pick<IngestPipeline, "processText">,
  sessionManager: RestoreSessionManager,
): void {
  let ordered: readonly SessionEntryLike[] = [];
  try {
    const branch = sessionManager.getBranch();
    if (branch.length > 0) ordered = [...branch].reverse(); // copy + reverse
    else ordered = safeEntries(sessionManager);
  } catch { ordered = safeEntries(sessionManager); }

  void (async () => {
    for (const entry of ordered) {
      if (entry.type !== "message") continue;
      try {
        const text = extractText(entry.message);
        if (text === null) continue;
        await pipeline.processText(text, entry.message.role === "user");
      } catch {
        // PRD: restore is best-effort background work; a single bad entry
        // must never break session start or abort the rest of the replay.
        continue;
      }
    }
  })();
}
// GOTCHA: processText already chunks + yields + applies eviction via
// store.upsert — restore adds NOTHING on top except ordering and filtering.
```

### Integration Points

```yaml
RUNTIME WIRING (NOT in this task — P1.M3.T5.S1 owns it):
  - index.ts session_start handler will call:
      restoreFromHistory(pipeline, ctx.sessionManager)
    unconditionally (no reason gating).
CONSUMERS:
  - P1.M3.T5.S1 calls it; store fills progressively → provider (T3) sees
    candidates minutes after start.
CONFIG: none. TEST HOOKS: none beyond DI-friendly parameters (already injected).
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/ingest-restore.test.ts
npm test        # full suite green — S1/S2 suites unaffected
```

### Level 3: Integration Testing

Not applicable — runtime wiring lands in P1.M3.T5.S1. Optional manual smoke
(deferred): load extension in a session with prior history, run `/acwords`
(T4) after a minute, observe store size > 0.

### Level 4: Domain-Specific Validation

```bash
# Ordering is the acceptance-critical property:
npx vitest --run test/ingest-restore.test.ts -t "order"
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean
- [ ] `npm test` green including new suite

### Feature Validation

- [ ] Branch reversed to oldest→newest; entries fallback already ordered
- [ ] type==="message" filter; null-extraction skip; per-message processText
- [ ] Empty/throwing history → clean no-op
- [ ] Fire-and-forget: returns void; per-entry catch, no unhandled rejection
- [ ] No eviction/stats/gate special-casing — identical pipeline (h2.31/h2.33)
- [ ] No reason gating; arrays from sessionManager never mutated

### Code Quality Validation

- [ ] Reuses extractText + IngestPipeline.processText only — no reimplementation
- [ ] `.js` ESM import extensions; `import type` for pi packages only
- [ ] No modification of src/pi/index.ts (owned by P1.M3.T5.S1)

## Anti-Patterns to Avoid

- ❌ Don't reverse `getBranch()`'s returned array in place — copy first.
- ❌ Don't reverse `getEntries()` — it's already oldest→newest.
- ❌ Don't gate on `session_start` reason — replay whenever history exists.
- ❌ Don't concatenate texts into one blob — one processText per message.
- ❌ Don't catch-and-abort the whole replay on one bad entry — catch per entry.
- ❌ Don't accumulate message texts in an array before replay — extract lazily.
- ❌ Don't bypass or duplicate the pipeline's chunking/eviction — restore is
  ordering + filtering only.

## Confidence Score: 9/10

sessionManager ordering semantics verified in shipped pi docs and .d.ts;
S1/S2 contracts pinned by their PRPs. Residual risk: exact `SessionEntry`
export shape for typed narrowing — mitigated by the structural
RestoreSessionManager interface and a local entry type.