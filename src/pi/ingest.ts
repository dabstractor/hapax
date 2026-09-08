/**
 * PRD §05 message ingestion filter (P1.M3.T2.S1): map a finalized pi
 * AgentMessage to the text hapax should ingest. Pure module — no pi runtime
 * usage, no timers, no listeners; message_end wiring belongs to the
 * IngestPipeline (P1.M3.T2.S2), which also owns chunked processing and
 * stats; session restore replay (P1.M3.T2.S3) sits on top of both.
 */
import type {
  MessageEndEvent,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

import { expandCandidates, tokenize } from "../core/segment.js";
import { maskSecrets, passesShape } from "../core/shapeGate.js";
import { admit } from "../core/score.js";
import type { CandidateStore } from "../core/store.js";
import type {
  Dictionary,
  IngestStats,
  RankGroup,
  Sighting,
} from "../core/types.js";

/** Finalized agent message as delivered by pi's message_end event. */
export type AgentMessage = MessageEndEvent["message"];

/**
 * Extract ingestable text per PRD §05: user → prompt text (string content or
 * text blocks; images ignored); assistant → text blocks only (thinking and
 * toolCall blocks skipped); everything else (toolResult, custom roles) → null.
 * Multiple text blocks join with "\n"; zero text parts → null. Pure: never
 * mutates or retains the message.
 */
export function extractText(message: AgentMessage): string | null {
  if (message.role === "user") {
    if (typeof message.content === "string") return message.content;
    const parts = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  if (message.role === "assistant") {
    const parts = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null; // toolResult, custom roles — ignore entirely
}

/** Inter-slice suspension handed to the pipeline (PRD §05 h2.30).
 *  Test-injectable so slice boundaries and yield counts are observable. */
type YieldFn = () => Promise<void>;

/** Platform globals the default yield path probes (both optional — absent
 *  in Node 22 and sandboxed runtimes respectively). */
interface YieldGlobals {
  scheduler?: { yield?: YieldFn };
  setImmediate?: (callback: () => void) => unknown;
}

/** Default inter-slice yield (PRD §05 h2.30): `scheduler.yield()` where the
 *  platform provides it (Chrome 129+; not in Node 22), else a setImmediate
 *  turn, else a resolved promise. Resolved ONCE at module load through
 *  typeof guards so a runtime missing either global never throws at yield
 *  time. Tests inject their own yieldFn instead of relying on this. */
const defaultYield: YieldFn = (() => {
  const platform = globalThis as typeof globalThis & YieldGlobals;
  const schedulerYield = platform.scheduler?.yield;
  if (typeof schedulerYield === "function") return schedulerYield;
  const immediate = platform.setImmediate;
  if (typeof immediate === "function") {
    return () => new Promise<void>((resolve) => immediate(resolve));
  }
  return () => Promise.resolve();
})();

/** Global timer bindings — read off globalThis (never imported from
 *  node:timers, whose named exports are distinct function objects) so
 *  environment doubles that patch the global — vitest fake timers in
 *  tests, pi's runtime — are honored. */
interface TimerGlobals {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}
const timers = globalThis as unknown as TimerGlobals;

/** All six gate-reject reasons at zero — IngestStats.rejectedByGate is a
 *  full Record; missing keys break /acwords rendering (PRD §08) and the
 *  type. Fresh object per pipeline (counters mutate in place). */
const emptyGateCounts = (): IngestStats["rejectedByGate"] => ({
  tooShort: 0,
  tooLong: 0,
  lowEntropy: 0,
  unigramRun: 0,
  secret: 0,
  consonantRun: 0,
});

/** Construction options for IngestPipeline (PRD §05, P1.M3.T2.S2). */
export interface IngestPipelineOptions {
  /** session candidate store — the pipeline feeds sightings into it */
  store: CandidateStore;
  /** injectable so tests can stub lookup() without the packed dict */
  dictionary: Dictionary;
  /** Optional disable gate (BUG-004): checked at the top of processText
   *  AND per segment inside #admitSegment's admission loop. When it
   *  returns true, no further candidates are admitted. The factory wires
   *  it to the sticky dictionary-failure flag; tests wire it to a
   *  mutable boolean. NOT config — internal wiring (PRD §08 surface
   *  unchanged). */
  isDisabled?: () => boolean;
  /** trailing-debounce window; default 300 (PRD §05 h2.29, baked) */
  debounceMs?: number;
  /** slice size in chars; default 65_536 (PRD §05 h2.30, baked) */
  chunkBytes?: number;
  /** awaited between slices; default scheduler.yield/setImmediate/Promise
   *  fallback chain; test-injectable to count chunk boundaries */
  yieldFn?: YieldFn;
  /** M2 n-gram hook (P2.M1.T1.S1): per-LINE arrays of the lowercase keys
   *  of admitted WHOLE-token candidates, in document order, once per
   *  message. A newline is the only window break — a line never spans
   *  one, and a slice boundary never breaks one (open lines carry
   *  across). Empty lines produce empty arrays; a message whose lines
   *  admit nothing still calls with its (possibly empty-array) lines. */
  onAdmittedTokens?: (lines: string[][]) => void;
  /** M2 demotion-sweep hook (P2.M1.T2.S2, PRD §06 h3.7): called ONCE at
   *  the tail of every flush drain — after the queue empties, regardless
   *  of how many messages it drained (demotion is not latency-sensitive).
   *  Wired to CandidateStore.sweepPhraseDemotions and gated exactly like
   *  onAdmittedTokens, so phrases-disabled builds never sweep. */
  onSweepPhrases?: () => void;
}

/**
 * Background ingestion engine (PRD §05 h2.29/h2.30/h2.34): turns finalized
 * pi messages into admitted store candidates behind a 300 ms trailing
 * debounce, draining oldest-first through the core chain (maskSecrets →
 * tokenize → expandCandidates → passesShape → admit → store.upsert) in ≤chunkBytes
 * slices with an awaited yield between slices.
 *
 * Handler discipline (h2.34): onMessageEnd is synchronous — extract,
 * enqueue, (re)arm the timer — returns void (NEVER a { message } result)
 * and never mutates the message. Message text is held only until
 * processed: queue entries are shifted BEFORE processing and nothing is
 * stashed elsewhere. Wiring belongs to index.ts (P1.M3.T5.S1), whose
 * session_shutdown handler calls dispose() to drop the debounce timer and
 * any queued-but-unprocessed text; restore replay (P1.M3.T2.S3) calls
 * flush/processText directly; /acwords (P1.M3.T4.S1) reads getStats;
 * n-grams (P2.M1.T1.S1) supply onAdmittedTokens (per-line keys); the
 * 40-ordinal demotion sweep (P2.M1.T2.S2) supplies onSweepPhrases (once
 * per drain).
 */
export class IngestPipeline {
  #store: CandidateStore;
  #dictionary: Dictionary;
  #debounceMs: number;
  #chunkBytes: number;
  #yieldFn: YieldFn;
  #onAdmittedTokens?: (lines: string[][]) => void;
  #onSweepPhrases?: () => void;
  /** Optional disable gate (BUG-004) — see IngestPipelineOptions. */
  #isDisabled?: () => boolean;
  /** FIFO queue; entries hold nothing but { text, fromUser } and are
   *  removed before processing so text is never retained (h2.34). */
  #pending: { text: string; fromUser: boolean }[] = [];
  #timer: unknown = null;
  /** In-flight drain promise — a timer fire or flush while a drain runs
   *  reuses/awaits it instead of starting a second loop (keeps FIFO
   *  order; the running loop re-checks the queue until empty). */
  #drain: Promise<void> | null = null;
  #stats: IngestStats = {
    wordsSeen: 0,
    admitted: 0,
    rejectedByGate: emptyGateCounts(),
  };

  constructor(options: IngestPipelineOptions) {
    this.#store = options.store;
    this.#dictionary = options.dictionary;
    this.#debounceMs = options.debounceMs ?? 300;
    this.#chunkBytes = options.chunkBytes ?? 65_536;
    this.#yieldFn = options.yieldFn ?? defaultYield;
    this.#onAdmittedTokens = options.onAdmittedTokens;
    this.#onSweepPhrases = options.onSweepPhrases;
    this.#isDisabled = options.isDisabled;
  }

  /** pi message_end handler (PRD §05 h2.29/h2.34). Extracts text; null →
   *  return immediately (nothing queued, timer untouched). Non-null →
   *  push to the FIFO and restart the 300 ms trailing debounce (each new
   *  message resets the countdown, so rapid tool-loop output coalesces).
   *  Synchronous by contract — enqueue only; the async work is the drain. */
  onMessageEnd(message: AgentMessage): void {
    const text = extractText(message);
    if (text === null) return;
    this.#pending.push({ text, fromUser: message.role === "user" });
    if (this.#timer !== null) timers.clearTimeout(this.#timer); // trailing edge
    this.#timer = timers.setTimeout(() => {
      this.#timer = null;
      // A drain already in flight loops until the queue is empty and will
      // pick these items up — never start a second one (FIFO order).
      if (this.#drain === null) this.#drain = this.#drainQueue();
    }, this.#debounceMs);
  }

  /** Tear the pipeline down (P1.M3.T5.S1 session_shutdown wiring):
   *  cancel the armed debounce timer and empty the pending queue so no
   *  post-shutdown drain ever fires. An in-flight #drain is deliberately
   *  NOT cancelled — it cannot be interrupted, and needn't be: the queue
   *  it loops over is now empty, so it exits after its current item and
   *  touches nothing but state the caller is discarding anyway. */
  dispose(): void {
    if (this.#timer !== null) {
      timers.clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#pending.length = 0;
  }

  /** Fire the debounce immediately and await the full drain (PRD §05;
   *  for tests and P1.M3.T2.S3 restore replay). Cancels any pending
   *  timer; messages arriving later start their own fresh debounce. */
  async flush(): Promise<void> {
    if (this.#timer !== null) {
      timers.clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#drain === null && this.#pending.length > 0) {
      this.#drain = this.#drainQueue();
    }
    if (this.#drain !== null) await this.#drain;
  }

  /** Drain the pending queue oldest-first. The in-flight item's reference
   *  is dropped (shift) before processing; a throw — impossible from the
   *  pure core chain, but a bug must not wedge the queue or reject the
   *  fire-and-forget promise — skips that text and keeps draining. */
  async #drainQueue(): Promise<void> {
    try {
      while (this.#pending.length > 0) {
        const item = this.#pending.shift()!;
        try {
          await this.processText(item.text, item.fromUser);
        } catch {
          // defensive: one bad text never blocks the rest of the queue
        }
      }
    } finally {
      this.#drain = null;
      // One demotion sweep per flush (P2.M1.T2.S2, PRD §06 h3.7) — in the
      // finally so every flush path (timer fire, flush(), restore drain)
      // sweeps exactly once, even for N messages. O(candidates) and pure
      // over store state, but swallowed defensively to match this loop's
      // error posture: a throwing callback must never wedge the queue.
      // dispose()-cancelled queues never start a drain, so this never
      // fires for them.
      try {
        this.#onSweepPhrases?.();
      } catch {
        // defensive: sweep failure never blocks the next flush
      }
    }
  }

  /** Process one message's text synchronously-ish through the core chain
   *  (PRD §05 h2.30): one store ordinal for the WHOLE message, then ≤
   *  chunkBytes slices each running tokenize → expandCandidates →
   *  passesShape → admit → store.upsert, followed by an awaited yield so
   *  a multi-MB message never blocks a keystroke (§02 h2.15). P1.M3.T2.S3
   *  restore calls this directly to bypass the debounce. A slice boundary
   *  can split one token — an accepted approximation (regex tokenize is
   *  safe on any slice) — but NEVER a phrase-window line: text is split
   *  on '\n' per slice, every newline-terminated segment finalizes a
   *  line, and an unterminated tail segment carries the open line into
   *  the next slice, so only a newline breaks a window (PRD §06 M2). */
  async processText(text: string, fromUser: boolean): Promise<void> {
    if (this.#isDisabled?.()) return; // BUG-004: disabled pipeline = total no-op
    if (text.length === 0) return; // no content → no ordinal, no stats
    const ordinal = this.#store.nextOrdinal(); // ONCE per message
    const lines: string[][] = []; // finalized per-line key arrays, in order
    let openLine: string[] = []; // the line still open at a slice boundary
    for (let off = 0; off < text.length; off += this.#chunkBytes) {
      const slice = text.slice(off, off + this.#chunkBytes);
      // Newline is the ONLY phrase-window break (PRD §06 M2) — a slice
      // boundary never breaks one. segments[0..n-2] were each terminated
      // by a '\n' inside this slice → finalize each as a line; the tail
      // segment stays open. (An empty tail segment is just the newline's
      // right side — nothing to carry; empty lines finalize as [].)
      const segments = slice.split("\n");
      for (let i = 0; i < segments.length - 1; i++) {
        const keys = this.#admitSegment(segments[i]!, ordinal, fromUser);
        lines.push(openLine.length > 0 ? [...openLine, ...keys] : keys);
        openLine = [];
      }
      openLine.push(
        ...this.#admitSegment(segments[segments.length - 1]!, ordinal, fromUser),
      );
      // BUG-004: a failure observed mid-message ends the message HERE —
      // remaining slices are skipped and the phrase hook below is NOT
      // called: a half-admitted message's phrase windows are meaningless
      // once the extension is dead.
      if (this.#isDisabled?.()) return;
      await this.#yieldFn(); // keystroke path resumes between slices
    }
    if (openLine.length > 0) lines.push(openLine); // unterminated final line
    // M2 n-gram hook — per line, once per message. Empty text never gets
    // here (early return); null-extracted messages never enqueue.
    this.#onAdmittedTokens?.(lines);
  }

  /** Run one '\n'-free segment through the core chain (maskSecrets →
   *  tokenize → expandCandidates → passesShape → admit → store.upsert) and
   *  return the lowercase keys of its admitted WHOLE tokens, in order.
   *  Sub-words are stored as candidates but never enter phrase windows
   *  (PRD §06 M2). Gate/admission accounting and #stats updates are
   *  exactly the message-loop behavior this was extracted from
   *  (P1.M3.T2.S2). Masking (BUG-003 layer 1) runs FIRST so structured
   *  secret windows never reach tokenize — this method is the single
   *  funnel for live messages AND restoreFromHistory replay, so one seam
   *  covers both paths. */
  #admitSegment(
    segment: string,
    ordinal: number,
    fromUser: boolean,
  ): string[] {
    // Blank structured secret windows before tokenization (BUG-003 layer
    // 1): key bytes never become tokens, hence never candidates. The
    // token-level rules in isSecretShaped stay the layer-2 residue net
    // (P1.M2.T2.S1) — untouched here.
    segment = maskSecrets(segment);
    const keys: string[] = [];
    for (const token of tokenize(segment)) {
      if (this.#isDisabled?.()) break; // BUG-004: dict failure mid-message
      const drafts = expandCandidates(token); // whole token first
      // Group of the whole token WHEN ADMITTED — the only state shared
      // by a token's drafts (subword clamp input, PRD §04).
      let wholeGroup: RankGroup | undefined;
      for (const draft of drafts) {
        const gate = passesShape(draft);
        if (!gate.ok) {
          // reason is present iff !ok (GateResult contract)
          this.#stats.rejectedByGate[gate.reason!]++;
          continue; // gate-rejected drafts are never wordsSeen
        }
        this.#stats.wordsSeen++;
        // Subwords admit independently; the parent clamp applies only
        // when the whole token admitted (wholeGroup stays undefined
        // after a gate or admission reject — no clamp then).
        const result = admit(
          draft,
          this.#dictionary,
          draft.isSubword ? wholeGroup : undefined,
        );
        if (result === "reject") continue; // admission reject: simply
        // not stored (PRD §04 h2.24); no IngestStats field by design.
        this.#stats.admitted++;
        if (!draft.isSubword) {
          wholeGroup ??= result;
          keys.push(draft.key);
        }
        const sighting: Sighting = {
          key: draft.key,
          display: draft.display,
          ordinal,
          fromUser,
          properName: draft.properName,
          rankGroup: result,
          isSubword: draft.isSubword,
          ...(draft.parentKey !== undefined
            ? { parentKey: draft.parentKey }
            : {}),
        };
        this.#store.upsert(sighting); // upsert owns eviction (§06 h2.37)
      }
    }
    return keys;
  }

  /** Cumulative counters (PRD §08 /acwords). Returns a copy — a live
   *  object would keep mutating under /acwords rendering. */
  getStats(): IngestStats {
    return {
      ...this.#stats,
      rejectedByGate: { ...this.#stats.rejectedByGate },
    };
  }
}

/**
 * Read-only slice of pi's session manager needed for restore replay
 * (P1.M3.T2.S3). Structural on purpose: ReadonlySessionManager is not
 * re-exported at the package root, and tests substitute plain fakes.
 * Ordering contract (pi docs, session-format.md): getBranch() walks
 * leaf → root (newest → oldest); getEntries() is append-only
 * oldest → newest, including abandoned branches.
 */
export interface RestoreSessionManager {
  getBranch(): SessionEntry[];
  getEntries(): SessionEntry[];
}

/** getEntries behind a guard — an unavailable history falls back to
 *  empty so restore degrades to a clean no-op, never a throw. */
function safeEntries(sessionManager: RestoreSessionManager): SessionEntry[] {
  try {
    return sessionManager.getEntries();
  } catch {
    return [];
  }
}

/**
 * Session restore (PRD §05 h2.31/h2.33): replay stored history oldest →
 * newest through the SAME pipeline as live messages — one store ordinal
 * per message, identical gates, counters, and store eviction (never
 * special-cased here; a huge history evicts early words exactly as live
 * traffic would).
 *
 * Source selection: primary getBranch() — leaf → root, so it is REVERSED
 * (from a copy; pi's array is never mutated in place) into oldest-first
 * faithful-to-context order. Empty or throwing branch falls back to
 * getEntries(), already oldest → newest and kept as-is. Only
 * `type === "message"` entries replay; the session header, compaction,
 * model_change, branch_summary, and custom entries are skipped, as are
 * messages whose extractText is null (toolResult, no text parts).
 *
 * Fire-and-forget: returns void synchronously (session start never
 * blocks); replay errors are caught per entry and swallowed so one bad
 * entry cannot abort the rest or escape as an unhandled rejection.
 * Reason-independent: every session_start reason can carry history, so
 * replay happens whenever history exists; empty history is a no-op.
 *
 * Abort contract (BUG-004, P1.M3.T1.S2): the optional `shouldAbort`
 * predicate is polled at the TOP of every replay iteration — before the
 * message-type filter, so an aborted replay stops scanning immediately.
 * Once it returns true the replay RETURNS: no further entries are
 * processed and nothing throws (fire-and-forget discipline holds — abort
 * is a return, never a rejection). Combined with the pipeline's
 * `isDisabled` per-segment gate (P1.M3.T1.S1), which owns the in-flight
 * message, a dictionary failure observed mid-replay stops the remaining
 * messages here. Notify-once semantics live in
 * createLazyDictionary/onLoadError and are untouched by this contract.
 * The factory wires `() => disabled` — a CLOSURE over the live flag,
 * which flips DURING the replay (the first lookup triggers the failed
 * load); never pass the flag by value.
 */
export function restoreFromHistory(
  pipeline: Pick<IngestPipeline, "processText">,
  sessionManager: RestoreSessionManager,
  shouldAbort?: () => boolean,
): void {
  // Collect the ordered entry list synchronously — metadata only. Text
  // is never extracted or held here (h2.34: touch bodies one message at
  // a time, inside the replay loop).
  let ordered: readonly SessionEntry[];
  try {
    const branch = sessionManager.getBranch();
    ordered =
      branch.length > 0
        ? [...branch].reverse() // copy BEFORE reverse — never mutate pi's array
        : safeEntries(sessionManager);
  } catch {
    ordered = safeEntries(sessionManager);
  }

  void (async () => {
    for (const entry of ordered) {
      if (shouldAbort?.()) return; // BUG-004: dict failed → stop replay cold
      if (entry.type !== "message") continue;
      try {
        const text = extractText(entry.message);
        if (text === null) continue; // toolResult, no text parts → no-op
        await pipeline.processText(text, entry.message.role === "user");
      } catch {
        // Best-effort background work: one bad entry must never break
        // session start or abort the rest of the replay.
        continue;
      }
    }
  })();
}