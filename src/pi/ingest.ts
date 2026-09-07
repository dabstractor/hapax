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
import { passesShape } from "../core/shapeGate.js";
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
  /** trailing-debounce window; default 300 (PRD §05 h2.29, baked) */
  debounceMs?: number;
  /** slice size in chars; default 65_536 (PRD §05 h2.30, baked) */
  chunkBytes?: number;
  /** awaited between slices; default scheduler.yield/setImmediate/Promise
   *  fallback chain; test-injectable to count chunk boundaries */
  yieldFn?: YieldFn;
  /** M2 n-gram hook (P2.M1.T1.S1): lowercase keys of admitted WHOLE-token
   *  candidates, in order, once per message (empty array allowed) */
  onAdmittedTokens?: (keys: string[]) => void;
}

/**
 * Background ingestion engine (PRD §05 h2.29/h2.30/h2.34): turns finalized
 * pi messages into admitted store candidates behind a 300 ms trailing
 * debounce, draining oldest-first through the core chain (tokenize →
 * expandCandidates → passesShape → admit → store.upsert) in ≤chunkBytes
 * slices with an awaited yield between slices.
 *
 * Handler discipline (h2.34): onMessageEnd is synchronous — extract,
 * enqueue, (re)arm the timer — returns void (NEVER a { message } result)
 * and never mutates the message. Message text is held only until
 * processed: queue entries are shifted BEFORE processing and nothing is
 * stashed elsewhere. Wiring belongs to index.ts (P1.M3.T5.S1); restore
 * replay (P1.M3.T2.S3) calls flush/processText directly; /acwords
 * (P1.M3.T4.S1) reads getStats; n-grams (P2.M1.T1.S1) supply
 * onAdmittedTokens.
 */
export class IngestPipeline {
  #store: CandidateStore;
  #dictionary: Dictionary;
  #debounceMs: number;
  #chunkBytes: number;
  #yieldFn: YieldFn;
  #onAdmittedTokens?: (keys: string[]) => void;
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
    }
  }

  /** Process one message's text synchronously-ish through the core chain
   *  (PRD §05 h2.30): one store ordinal for the WHOLE message, then ≤
   *  chunkBytes slices each running tokenize → expandCandidates →
   *  passesShape → admit → store.upsert, followed by an awaited yield so
   *  a multi-MB message never blocks a keystroke (§02 h2.15). P1.M3.T2.S3
   *  restore calls this directly to bypass the debounce. A slice boundary
   *  can split one token — an accepted approximation (regex tokenize is
   *  safe on any slice). */
  async processText(text: string, fromUser: boolean): Promise<void> {
    if (text.length === 0) return; // no content → no ordinal, no stats
    const ordinal = this.#store.nextOrdinal(); // ONCE per message
    const admittedWhole: string[] = [];
    for (let off = 0; off < text.length; off += this.#chunkBytes) {
      const slice = text.slice(off, off + this.#chunkBytes);
      for (const token of tokenize(slice)) {
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
            admittedWhole.push(draft.key);
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
      await this.#yieldFn(); // keystroke path resumes between slices
    }
    // M2 n-gram hook — whole tokens only, once per message (may be []).
    this.#onAdmittedTokens?.(admittedWhole);
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
 */
export function restoreFromHistory(
  pipeline: Pick<IngestPipeline, "processText">,
  sessionManager: RestoreSessionManager,
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