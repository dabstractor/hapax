# PRP — P1.M3.T2.S2: IngestPipeline: 300ms debounce queue + chunked core pipeline + stats

## Goal

**Feature Goal**: Implement class `IngestPipeline` in `src/pi/ingest.ts` — the
background ingestion engine that turns finalized pi messages into admitted
store candidates, per PRD §05 (h2.29/h2.30/h2.34) and §02 h2.12. On each
`message_end` it enqueues extracted text behind a 300 ms debounce; when the
timer fires it drains the queue oldest-first, running each text through the
existing core chain (`tokenize` → `expandCandidates` → `passesShape` →
`admit` → `store.upsert`) in ≤64 KB slices with an awaited yield between
slices, accumulating `IngestStats`, and never mutating/returning anything
from the handler.

**Deliverable**:
1. `src/pi/ingest.ts` extended with `IngestPipeline` (S1's `extractText` stays
   intact and is reused).
2. `test/ingest-pipeline.test.ts` — unit suite using `vi.useFakeTimers` for
   the debounce, an injected fake yield fn to assert chunk boundaries, and a
   stub Dictionary.

**Success Definition**: `npm run check` and `npm test` green (including the new
suite and the pre-existing `test/ingest.test.ts`); the handler returns `void`
(never `{ message }`); a multi-MB text processes across slices with yields
between them; stats count words seen / admitted / rejected-by-gate by reason.

## Why

- PRD §05 h2.29: agents emit several messages in quick succession during tool
  loops — batching via a 300 ms debounce avoids repeated chunk-yield overhead
  mid-typing.
- PRD §05 h2.30 + §02 h2.15: all ingest work is off the keystroke path by
  construction (only `getSuggestions` is on it); a pathological multi-MB
  message must never block a keystroke, hence ≤64 KB slices with yields.
- This is the second half of ingestion wiring. The pipeline instance is owned
  by `index.ts` (P1.M3.T5.S1), its stats feed `/acwords` (P1.M3.T4.S1), and
  P1.M3.T2.S3 (session restore) replays history through this same pipeline.
  P2.M1.T1.S1 (n-gram capture) hooks in here later — hence an optional
  per-message admitted-whole-token callback parameter now.

## What

### Behavior contract (exact)

```ts
export interface IngestPipelineOptions {
  store: CandidateStore;
  dictionary: Dictionary;          // injectable — tests stub lookup()
  debounceMs?: number;             // default 300
  chunkBytes?: number;             // default 65_536
  yieldFn?: () => Promise<void>;   // default: scheduler.yield() if available
                                   // else setImmediate-wrapped; test-injectable
  onAdmittedTokens?: (keys: string[]) => void; // M2 n-gram hook (optional)
}

export class IngestPipeline {
  constructor(options: IngestPipelineOptions);
  /** pi message_end handler. Extracts text, enqueues on non-null, restarts
   *  debounce. Returns void — NEVER a { message } result. May be async? No —
   *  keep it synchronous (enqueue only); pi awaits async handlers but there
   *  is nothing to await here. */
  onMessageEnd(message: AgentMessage): void;
  /** Fire the debounce immediately and await full drain. For tests and for
   *  P1.M3.T2.S3 restore replay (which can call processMessage directly). */
  flush(): Promise<void>;
  /** Process one message's text synchronously-ish through the core chain,
   *  chunked with yields. Issues store.nextOrdinal() once. S3 restore uses
   *  this directly to bypass debounce. */
  processText(text: string, fromUser: boolean): Promise<void>;
  /** Cumulative counters (PRD §08 /acwords). Returns a copy. */
  getStats(): IngestStats;
}
```

**Debounce (h2.29)**: `onMessageEnd` calls `extractText(message)`; `null` →
return immediately (no enqueue, NO timer restart per S1's settled null
contract — actually simplest correct behavior: restart the timer only when
something is queued; a null extraction leaves the timer untouched). Non-null
text is pushed to a FIFO `pending` array and the 300 ms timer is (re)started
(trailing-edge debounce: each new message resets the countdown). When it
fires, drain ALL queued texts in order (each via `processText`), then clear.

**Chunking (h2.30)**: inside `processText`, take slices of `chunkBytes` chars
(bytes≈chars for our ASCII token stream; use string slicing by char count —
tokenize is regex-based so any slice boundary is safe, tokens never span
slices incorrectly because slicing text can at worst split one token at the
boundary, which is an accepted approximation). After each slice's core-chain
work, `await this.#yieldFn()`. The default yieldFn:

```ts
const defaultYield: () => Promise<void> =
  typeof globalThis.scheduler !== "undefined" &&
  typeof globalThis.scheduler.yield === "function"
    ? () => globalThis.scheduler!.yield()
    : () => new Promise<void>((r) => setImmediate(r));
```

(Both `scheduler` and `setImmediate` guarded with `typeof` checks — vitest's
jsdom-less node environment has `setImmediate`; browsers/sandboxed runtimes
may not.)

**Per-message core chain**: `ordinal = store.nextOrdinal()` ONCE per message
(before processing slices); `fromUser = message.role === "user"` (checked by
the caller — `onMessageEnd` passes it; `processText` takes it as a param).
For each slice: `tokenize(slice)` → for each RawToken `expandCandidates` →
for each CandidateDraft: `passesShape` (fail → count
`stats.rejectedByGate[reason]++`, skip) → `admit(draft, dictionary,
parentGroup?)` → `"reject"` → not counted as gate-reject (admission reject;
PRD's stats surface distinguishes rejected-by-gate; count admission rejects
under... see Decision below) → else build a `Sighting` and
`store.upsert(sighting)`.

**Subword handling (settled per item contract, matches score.ts's `admit`)**:
each candidate admits INDEPENDENTLY — no dependency of subword admission on
parent admission. Within one token's drafts, process the whole-token draft
FIRST; if it was admitted, remember its `RankGroup` and pass it as
`parentGroup` to each subword's `admit` call (clamp: subword group ≤ parent+1
only affects the stored group, never admission). If the whole token was
rejected (gate or admit), subwords are still processed, with `parentGroup`
omitted (no clamp).

**Stats (IngestStats from src/core/types.ts)**:
- `wordsSeen` — incremented once per CandidateDraft that reached admission
  (i.e. passed the shape gate). Gate-rejected drafts are NOT wordsSeen.
- `admitted` — incremented per admit-result ≠ `"reject"` (each upsert).
- `rejectedByGate` — `Record<GateRejectReason, number>` initialized with ALL
  six keys (`tooShort`, `tooLong`, `lowEntropy`, `unigramRun`, `secret`,
  `consonantRun`) at 0 — the type is a full Record; missing keys break
  `/acwords` rendering. Increment by `gate.reason`.
- Admission rejects (`admit === "reject"`, i.e. too-common words) are not in
  the IngestStats interface — do NOT invent a field; they are simply not
  admitted (store stays without them, per PRD §04 h2.24).

**Ordinal note**: `evictIfOverCap()` is invoked inside `store.upsert` already
(P1.M2.T4.S1/S3) — the pipeline does NOT call eviction itself.

**M2 hook**: when `onAdmittedTokens` is provided, collect the lowercase keys
of admitted WHOLE-token candidates (isSubword === false) per message, in
order, and invoke the callback once per message with that array (empty array
allowed). Subwords excluded (n-grams chain whole tokens). No-op when the
callback is absent (M1 default).

**What ingestion must NOT do (h2.34)** — acceptance-critical:
- Handler returns `void`; never `{ message }`; never mutates/rewrites the
  message object.
- Never reads files or runs tools.
- Never hold message text after processing: after `processText` completes,
  the queued string reference must be droppable (do not stash text anywhere;
  the pending array entry is removed when processed).
- All work happens on the debounce fire (or explicit flush/processText) —
  `onMessageEnd` itself only pushes and resets a timer.

### Success Criteria

- [ ] 300 ms trailing debounce: messages arriving within the window coalesce;
      queue drains oldest-first on fire.
- [ ] Null-extraction messages enqueue nothing.
- [ ] A 200 KB text processes in ≥3 slices with a yield awaited between each
      (verified via injected fake yield that counts calls).
- [ ] One `store.nextOrdinal()` per message regardless of slice count.
- [ ] Stats correct: wordsSeen/admitted/rejectedByGate tallies match
      hand-computed fixtures with a stub dictionary.
- [ ] Subwords admit independently; admitted subwords' groups clamped to
      parent group + 1 only when the parent was admitted.
- [ ] `onAdmittedTokens` receives admitted whole-token keys per message.
- [ ] Handler returns undefined; frozen message objects unmodified.

## All Needed Context

### Context Completeness Check

Validated: all core signatures below were read from the actual source files
(src/core/store.ts, score.ts, segment.ts, shapeGate.ts, types.ts). The S1
extractText contract was read from plan/001_88fc3a66fd74/P1M3T2S1/PRP.md and
is treated as already implemented in src/pi/ingest.ts.

### Documentation & References

```yaml
- file: src/pi/ingest.ts
  why: S1's extractText + AgentMessage type alias — call it, don't reimplement
  pattern: |
    extractText(message: AgentMessage): string | null
    export type AgentMessage = MessageEndEvent["message"]  // from pi-coding-agent root

- file: src/core/segment.ts
  why: tokenize(text): RawToken[]; expandCandidates(token): CandidateDraft[]
  critical: drafts are whole-token-first then subwords (length ≥ 4);
    CandidateDraft = { key (lowercase), display, properName, isSubword, parentKey? }

- file: src/core/shapeGate.ts
  why: passesShape(draft: CandidateDraft): GateResult ({ ok, reason? })

- file: src/core/score.ts
  why: admit(draft, dictionary, parentGroup?): RankGroup | "reject";
    thresholds REJECT_COMMON_THRESHOLD=220, MID_FREQ_THRESHOLD=120

- file: src/core/store.ts
  why: CandidateStore API — nextOrdinal(): number; upsert(sighting: Sighting): void
    (upsert internally calls evictIfOverCap; the pipeline NEVER evicts directly)
  gotcha: upsert takes the ordinal INSIDE the Sighting; nextOrdinal is called
    by the pipeline exactly once per message

- file: src/core/types.ts
  why: Sighting = { key, display, ordinal, fromUser, properName, rankGroup,
    isSubword, parentKey? }; IngestStats = { wordsSeen, admitted,
    rejectedByGate: Record<GateRejectReason, number> }; GateRejectReason union
    of exactly six values; Dictionary = { lookup(key): number|null, version,
    entryCount }

- file: test/store.test.ts
  why: existing stub-dictionary pattern for admit/upsert tests
  pattern: object literal { lookup: (w) => (common.has(w) ? 200 : null), version: 1, entryCount: 0 }

- file: test/segment.test.ts
  why: vitest conventions — describe/it/expect, PRD-section header comment

- url: https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield
  why: scheduler.yield() semantics and availability (Chrome 129+, not in Node
    as of Node 22 — hence the setImmediate fallback with typeof guards)
```

### Current Codebase tree (relevant)

```bash
src/core/  # dictionary, segment, shapeGate, score, store, query, types — ALL COMPLETE
src/pi/
  index.ts    # placeholder factory (P1.M3.T5.S1 will wire IngestPipeline in)
  config.ts   # complete (P1.M3.T1.S1)
  ingest.ts   # S1 extractText (+ AgentMessage alias); S2 adds IngestPipeline
test/         # flat vitest suites: ingest.test.ts (S1) exists already
```

### Desired Codebase tree with files to be added/changed

```bash
src/pi/ingest.ts            # MODIFY: add IngestPipeline (+ options interface) alongside extractText
test/ingest-pipeline.test.ts # NEW: pipeline unit suite
```

### Known Gotchas of our codebase & Library quirks

```ts
// CRITICAL: `scheduler.yield` does not exist in Node — guard with
// `typeof globalThis.scheduler !== "undefined" && typeof ...yield === "function"`.
// Same for setImmediate (`typeof setImmediate === "function"`); fall back to
// `Promise.resolve()` if even that's missing (never throw at yield time).

// CRITICAL: IngestStats.rejectedByGate is Record<GateRejectReason, number> —
// initialize ALL SIX keys to 0 up front, or /acwords and the type break.

// CRITICAL: ESM project — internal imports use ".js" extension:
// import { tokenize, expandCandidates } from "../core/segment.js"; etc.

// GOTCHA: pi awaits async message_end handlers, but onMessageEnd itself must
// stay synchronous (enqueue + timer only). The async part is flush/processText.

// GOTCHA: vi.useFakeTimers does not fake setImmediate by default config —
// use `vi.useFakeTimers({ toFake: ["setTimeout", "setImmediate"] })` or just
// inject a fake yieldFn in tests (preferred — deterministic and countable).
// With fake timers, advancing 300ms fires the drain: vi.advanceTimersByTime(300).
// The drain is async — after advancing, `await pipeline.flush()` or await a
// resolved promise (microtask) to let processText promises settle.

// GOTCHA: debounce must not stack multiple timers — clear the previous
// timeout on each restart (trailing edge), and guard re-entrancy so a flush
// triggered while a drain is in flight awaits it rather than double-draining.

// GOTCHA: never store message text beyond processing (h2.34) — pending queue
// holds only { text, fromUser } entries removed as processed.

// GOTCHA: `import type` only for pi packages in src/pi (erased at runtime);
// runtime imports come from ../core/*.js only.
```

## Implementation Blueprint

### Data models and structure

No new core models — reuse `Sighting`, `IngestStats`, `GateRejectReason` from
`src/core/types.ts`. Add only `IngestPipelineOptions` and the class in
`src/pi/ingest.ts` (private state: `#pending: { text: string; fromUser:
boolean }[]`, `#timer: ReturnType<typeof setTimeout> | null`, `#drain:
Promise<void> | null`, `#stats: IngestStats`).

### Implementation Tasks (ordered by dependencies)

```yaml
Task 1: EXTEND src/pi/ingest.ts — IngestPipeline
  - ADD: IngestPipelineOptions interface + IngestPipeline class per the
    behavior contract above; import from ../core/segment.js (tokenize,
    expandCandidates), ../core/shapeGate.js (passesShape), ../core/score.js
    (admit), ../core/store.js (CandidateStore), ../core/types.js (types)
  - STRUCTURE of processText(text, fromUser):
      1. ordinal = this.#store.nextOrdinal()
      2. admittedWhole: string[] = []
      3. for (let off = 0; off < text.length; off += chunkBytes):
           slice = text.slice(off, off + chunkBytes)
           for (const token of tokenize(slice)):
             drafts = expandCandidates(token)
             wholeGroup: RankGroup | undefined = undefined
             for (const draft of drafts):   // whole token is drafts[0]
               gate = passesShape(draft)
               if (!gate.ok) { stats.rejectedByGate[gate.reason]++; continue }
               stats.wordsSeen++
               const res = admit(draft, dict, draft.isSubword ? wholeGroup : undefined)
               if (res === "reject") continue
               stats.admitted++
               if (!draft.isSubword) wholeGroup ??= res
               if (!draft.isSubword) admittedWhole.push(draft.key)
               store.upsert({ key: draft.key, display: draft.display, ordinal,
                 fromUser, properName: draft.properName, rankGroup: res,
                 isSubword: draft.isSubword, ...(draft.parentKey ? { parentKey: draft.parentKey } : {}) })
           await this.#yieldFn()
      4. drop the text reference (slice/text go out of scope); if
         onAdmittedTokens, call it with admittedWhole
  - NAMING: onMessageEnd, flush, processText, getStats (public); #pending,
    #timer, #drain, #stats, #yieldFn (private)
  - FOLLOW pattern: src/core/store.ts class style (#private fields, JSDoc
    one-liners citing PRD sections)
  - PLACEMENT: src/pi/ingest.ts after extractText

Task 2: CREATE test/ingest-pipeline.test.ts
  - FIXTURES: stub dictionary `{ lookup: (w) => (COMMON.has(w) ? 230 : null),
    version: 1, entryCount: 0 }` (230 ⇒ reject band) plus a mid-freq variant;
    real CandidateStore instance per test (it's pure in-memory)
  - CASES (all required):
    1. debounce coalescing: 3 onMessageEnd calls within 300ms of fake time →
       one drain of 3 texts in order (assert store ordinals 1,2,3 assigned to
       the right words via currentOrdinal and lastSeenOrdinal ordering)
    2. debounce re-arms: message at t=0, another at t=250 → fires at t=550
       not t=300 (vi.advanceTimersByTime asserts)
    3. null extraction (toolResult message) → nothing queued, no timer
    4. chunking: text of 3×chunkBytes (use small chunkBytes like 100 via
       options) → injected fake yieldFn awaited ≥2 times; all tokens ingested
    5. one ordinal per message: multi-chunk message → currentOrdinal == 1
    6. stats: mixed fixture of good word, too-short, secret-shaped, and
       dictionary-reject word → wordsSeen/admitted/rejectedByGate exact
    7. subword independence: token whose whole form is dictionary-reject but
       subword is rare → subword admitted without parentGroup clamp; token
       whose whole is admitted → subword group clamped to parent+1
    8. onAdmittedTokens: called once per message with admitted whole-token
       keys in order; absent option = no error
    9. handler purity: returns undefined; deepFrozen message unmodified
    10. gate-reason accounting: candidates rejected by each distinct reason
        (tooShort, secret at minimum) increment the right bucket
  - FOLLOW pattern: test/ingest.test.ts (reuse its assistantMsg/userMsg
    factories by copying them — tests are self-contained files)
  - NAMING: describe("IngestPipeline — PRD §05 h2.29/h2.30")
  - TIMERS: vi.useFakeTimers() in beforeEach, vi.useRealTimers() in
    afterEach; inject yieldFn: async () => { yieldCalls++ } for counting
  - PLACEMENT: test/ingest-pipeline.test.ts
```

### Implementation Patterns & Key Details

```ts
// Debounce + drain re-entrancy pattern (the non-obvious part):
onMessageEnd(message: AgentMessage): void {
  const text = extractText(message);
  if (text === null) return;
  this.#pending.push({ text, fromUser: message.role === "user" });
  if (this.#timer !== null) clearTimeout(this.#timer);
  this.#timer = setTimeout(() => {
    this.#timer = null;
    this.#drain = this.#drainQueue();  // fire-and-forget; errors must not
  }, this.#debounceMs);                 // reject an unhandled promise — wrap
}                                       // drain body defensively

async #drainQueue(): Promise<void> {
  while (this.#pending.length > 0) {
    const item = this.#pending.shift()!;  // remove BEFORE processing so the
    await this.processText(item.text, item.fromUser);  // text is not held
  }
}

async flush(): Promise<void> {
  if (this.#timer !== null) { clearTimeout(this.#timer); this.#timer = null; }
  if (this.#drain) await this.#drain;
  else if (this.#pending.length > 0) this.#drain = this.#drainQueue(), await this.#drain;
  this.#drain = null;
}

// getStats must return a COPY (callers: /acwords renders it; a live object
// would keep mutating under rendering):
getStats(): IngestStats {
  return { ...this.#stats, rejectedByGate: { ...this.#stats.rejectedByGate } };
}
```

### Integration Points

```yaml
RUNTIME WIRING (NOT in this task — P1.M3.T5.S1 owns it):
  - index.ts will construct IngestPipeline({ store, dictionary }) and do
    pi.on("message_end", (e) => pipeline.onMessageEnd(e.message))
  - Do NOT modify src/pi/index.ts here.
CONSUMERS:
  - P1.M3.T4.S1 (/acwords) reads pipeline.getStats()
  - P1.M3.T2.S3 (restore) calls processText directly, oldest-first
  - P2.M1.T1.S1 (n-grams) supplies onAdmittedTokens
CONFIG: none — debounce/chunk constants are constructor defaults, not user
  config (PRD §08 h2.47 "not configurable").
```

## Validation Loop

### Level 1: Syntax & Style

```bash
npm run check   # tsc --noEmit — zero errors
```

### Level 2: Unit Tests

```bash
npx vitest --run test/ingest-pipeline.test.ts
npm test        # full suite — ingest.test.ts and all core suites stay green
```

### Level 3: Integration Testing

Not applicable — runtime wiring lands in P1.M3.T5.S1. Optional smoke: none
required here.

### Level 4: Domain-Specific Validation

```bash
# Verify the scheduling guard compiles and the fallback path is exercised:
npx vitest --run test/ingest-pipeline.test.ts -t "chunk"
# The injected-yield tests prove slice boundaries + yield counts.
```

## Final Validation Checklist

### Technical Validation

- [ ] `npm run check` clean
- [ ] `npm test` green including new suite and existing ingest.test.ts

### Feature Validation

- [ ] Trailing 300 ms debounce; queue drains oldest-first; null ⇒ no enqueue
- [ ] ≤64 KB (configurable) slices with awaited yield between each
- [ ] One nextOrdinal() per message; Sighting fields complete
- [ ] Subwords admit independently; group clamp only with admitted parent
- [ ] IngestStats exact on fixtures; all six gate reasons initialized
- [ ] onAdmittedTokens per-message whole-token keys (M2 hook)
- [ ] Handler returns void; no message mutation; text dropped after processing

### Code Quality Validation

- [ ] Reuses extractText, core chain, CandidateStore as-is — no reimplementation
- [ ] `.js` ESM import extensions; `import type` for pi packages only
- [ ] No direct eviction calls (upsert owns it); no config surface added

## Anti-Patterns to Avoid

- ❌ Don't return `{ message }` from onMessageEnd (h2.34 — never mutate).
- ❌ Don't call nextOrdinal per slice or per token — once per message.
- ❌ Don't gate subword admission on parent admission — independent per PRD §04.
- ❌ Don't fake timers AND real setImmediate in the same test — inject yieldFn.
- ❌ Don't store message bodies or text beyond processing.
- ❌ Don't add admission-reject counters to IngestStats (type is fixed).
- ❌ Don't wire pi.on in this module — index.ts (P1.M3.T5.S1) owns wiring.

## Confidence Score: 9/10

All consumed interfaces verified in source; S1 contract pinned; test strategy
(fake timers + injected yield + stub dict) matches existing vitest patterns.
Residual risk: exact behavior when a drain is in flight and new messages
arrive (spec'd above via #drain reuse — implementer should keep it simple).