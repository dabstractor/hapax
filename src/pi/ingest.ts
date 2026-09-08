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
import type { CandidateDraft } from "../core/segment.js";
import { maskSecrets, passesShape } from "../core/shapeGate.js";
import { admit } from "../core/score.js";
import type { AdmissionResult } from "../core/score.js";
import type { CandidateStore } from "../core/store.js";
import type {
  Dictionary,
  GateResult,
  IngestStats,
  RankGroup,
  RawToken,
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

/** One admitted WHOLE token with its span (UTF-16 offsets into the masked
 *  segment) plus the raw gap text between it and the previous entry of the
 *  same line — the unit the adjacency-run splitter consumes (PRD 002 §06
 *  h3.6). Internal to the pipeline. */
interface SpanEntry {
  key: string;
  start: number;
  end: number;
  gapBefore: string;
}

/** What #admitSegment hands back to the line assembler: the post-
 *  maskSecrets segment text (gaps are computed against it — see
 *  appendSegment) and the spans of its admitted whole tokens, in document
 *  order. */
interface SegmentResult {
  masked: string;
  entries: { key: string; start: number; end: number }[];
}

/** Gap test for strict adjacency (PRD 002 §06 h3.6): a run continues only
 *  across a gap of ONE OR MORE spaces/tabs. Deliberately not `\s` (it
 *  admits `\n`/`\r` — newlines are structural breaks) and not `*` (a
 *  zero-width gap must break; tokens never emit adjacently anyway, but the
 *  regex decides, not that accident). */
const WHITESPACE_GAP_RE = /^[ \t]+$/;

/** Cap on the per-pipeline admission memo (#admitMemo). Distinct raw
 *  tokens per session sit well below this in practice (the PRD's own
 *  vocabulary estimate is ~10–20k uniques per 300k tokens); on overflow
 *  the whole cache clears — bounded memory, deterministic behavior, and
 *  a cold rebuild is exactly the pre-memo cost. */
const ADMIT_MEMO_CAP = 65_536;

/** One raw token's computed admission plan (2026-09 Issue 4): the drafts
 *  expandCandidates emits for it, each draft's shape-gate result, and each
 *  gate-passing draft's admission result. Pure functions of (raw, dict,
 *  rules) — all session-constant — so the plan is computed once per
 *  DISTINCT raw token and replayed (stats counting + store upserts) for
 *  every occurrence. `complete` is false only when the isDisabled gate
 *  fired mid-token (dictionary failure): the partial prefix replays once
 *  and is never cached. */
interface AdmitMemoEntry {
  drafts: CandidateDraft[];
  /** index-aligned with drafts — always present for processed drafts */
  gates: GateResult[];
  /** index-aligned with drafts; undefined for gate-rejected drafts and
   *  for the draft whose lookup observed the disable flip */
  admits: (AdmissionResult | undefined)[];
  complete: boolean;
}

/** Split a finalized line's span entries into adjacency runs: a new run
 *  starts at the line's first entry (its empty gapBefore breaks by
 *  construction) and at every entry whose gapBefore is not pure
 *  spaces/tabs. Never emits empty runs. */
function splitRuns(entries: SpanEntry[]): string[][] {
  const runs: string[][] = [];
  let cur: string[] = [];
  for (const e of entries) {
    if (cur.length > 0 && !WHITESPACE_GAP_RE.test(e.gapBefore)) {
      runs.push(cur);
      cur = [];
    }
    cur.push(e.key);
  }
  if (cur.length > 0) runs.push(cur);
  return runs;
}

/** Append one segment's span entries to the open line, computing each
 *  entry's gapBefore, and return the updated carry: the newline-free
 *  masked text after the line's last admitted token (spans chunk
 *  boundaries).
 *
 *  GAP PROVENANCE — all gaps are taken against the MASKED segment:
 *  maskSecrets is length-preserving (" ".repeat(m.length) per match), so
 *  token spans also index the raw text, but the gap TEXT is read from the
 *  masked string. A masked secret becomes spaces, so two words around a
 *  removed secret look adjacent — accepted: the secret's bytes are gone,
 *  the gap is real whitespace.
 *
 *  Segments with NO admitted tokens still extend the carry (their whole
 *  masked text is gap text): dropping it would lose punctuation that must
 *  break the run — e.g. "zephyr," | " quuxblat" split across a chunk
 *  boundary inside the gap would silently chain if the comma were dropped. */
function appendSegment(
  openLine: SpanEntry[],
  openTail: string,
  r: SegmentResult,
): string {
  if (r.entries.length === 0) return openTail + r.masked;
  for (let j = 0; j < r.entries.length; j++) {
    const e = r.entries[j]!;
    const gapBefore =
      j > 0
        ? r.masked.slice(r.entries[j - 1]!.end, e.start)
        : openLine.length > 0
          ? openTail + r.masked.slice(0, e.start) // gap spans the boundary
          : ""; // line's first entry: always opens a run
    openLine.push({ key: e.key, start: e.start, end: e.end, gapBefore });
  }
  return r.masked.slice(r.entries[r.entries.length - 1]!.end);
}

/** Construction options for IngestPipeline (PRD §05, P1.M3.T2.S2). */
export interface IngestPipelineOptions {
  /** session candidate store — the pipeline feeds sightings into it */
  store: CandidateStore;
  /** injectable so tests can stub lookup() without the packed dict */
  dictionary: Dictionary;
  /** Optional disable gate (BUG-004): checked at the top of processText,
   *  at the top of #admitSegment's token loop, AND again immediately
   *  after admit()'s dictionary lookup (NEW-001: the lookup is the only
   *  call that can trigger — and fail — the lazy dictionary load, and a
   *  lookup-observed failure returns null, which admit() would otherwise
   *  misread as "rarest word → group 0" and store). When it returns true,
   *  no further candidates are admitted. The factory wires it to the
   *  sticky dictionary-failure flag; tests wire it to a mutable boolean.
   *  NOT config — internal wiring (PRD §08 surface unchanged). */
  isDisabled?: () => boolean;
  /** trailing-debounce window; default 300 (PRD §05 h2.29, baked) */
  debounceMs?: number;
  /** slice size in chars; default 65_536 (PRD §05 h2.30, baked) */
  chunkBytes?: number;
  /** awaited between slices; default scheduler.yield/setImmediate/Promise
   *  fallback chain; test-injectable to count chunk boundaries */
  yieldFn?: YieldFn;
  /** M2 successor-index hook (P1.M1.T3.S2, PRD 002 §06 h3.6): adjacency
   *  RUNS of the lowercase keys of admitted WHOLE-token candidates, in
   *  document order, exactly one call per message. A run breaks between
   *  two consecutive admitted tokens unless the raw gap between them is
   *  plain spaces/tabs on the same line — clause punctuation, quoting and
   *  bracketing, digits/hexish/symbols, and intervening rejected words all
   *  break; a newline always breaks; a chunk boundary never does (gap text
   *  carries across). Runs hold ≥ 1 word (empty lines emit nothing).
   *  Wired to store.recordBigramRuns, whose per-run adjacent-pair counting
   *  builds the word → top-3 successor index. */
  onAdmittedTokens?: (runs: string[][]) => void;
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
 * the successor index (P1.M1.T3.S2) supplies onAdmittedTokens with
 * adjacency runs (strict whitespace-only adjacency, PRD 002 §06 h3.6).
 */
export class IngestPipeline {
  #store: CandidateStore;
  #dictionary: Dictionary;
  #debounceMs: number;
  #chunkBytes: number;
  #yieldFn: YieldFn;
  #onAdmittedTokens?: (runs: string[][]) => void;
  /** Optional disable gate (BUG-004) — see IngestPipelineOptions. */
  #isDisabled?: () => boolean;
  /** Admission memo (2026-09 Issue 4): distinct raw token → computed
   *  admission plan. Sessions repeat vocabulary heavily (Zipf), and the
   *  expand → shape-gate → admit chain was ~70% of a large-ingest
   *  profile; recomputing it per OCCURRENCE was the whole cost. The plan
   *  is pure per raw token (dict + rules are session-constant), so
   *  caching changes nothing observable — stats and store upserts are
   *  still applied per occurrence by #replayAdmitMemo. Session-lifetime,
 *  capped at ADMIT_MEMO_CAP (clear-on-full). Never persisted. */
  #admitMemo = new Map<string, AdmitMemoEntry>();
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
    }
  }

  /** Process one message's text synchronously-ish through the core chain
   *  (PRD §05 h2.30): one store ordinal for the WHOLE message, then ≤
   *  chunkBytes slices each running tokenize → expandCandidates →
   *  passesShape → admit → store.upsert, followed by an awaited yield so
   *  a multi-MB message never blocks a keystroke (§02 h2.15). P1.M3.T2.S3
   *  restore calls this directly to bypass the debounce. A slice boundary
   *  can split one token — an accepted approximation (regex tokenize is
   *  safe on any slice) — but NEVER an adjacency run: text is split on
   *  '\n' per slice, every newline-terminated segment finalizes a line,
   *  and an unterminated tail segment carries the open line AND its
   *  trailing gap text (openTail) into the next slice, so only a newline
   *  structurally breaks a run (PRD 002 §06 h3.6); within a line, runs
   *  break on any gap that is not plain spaces/tabs (splitRuns). */
  async processText(text: string, fromUser: boolean): Promise<void> {
    if (this.#isDisabled?.()) return; // BUG-004: disabled pipeline = total no-op
    if (text.length === 0) return; // no content → no ordinal, no stats
    const ordinal = this.#store.nextOrdinal(); // ONCE per message
    const runs: string[][] = []; // finalized adjacency runs, in order
    // The line still open at a chunk boundary: its admitted whole tokens
    // (with spans) plus the masked gap text after the last one — the gap
    // between "zephyr   " and "   quuxblat" straddling a 64 KiB edge is
    // openTail + the next segment's prefix, so it chains like any other.
    let openLine: SpanEntry[] = [];
    let openTail = "";
    for (let off = 0; off < text.length; off += this.#chunkBytes) {
      const slice = text.slice(off, off + this.#chunkBytes);
      // Newline is the only STRUCTURAL break (PRD 002 §06 h3.6) — a chunk
      // boundary never breaks a run. segments[0..n-2] were each terminated
      // by a '\n' inside this slice → finalize each line's runs; the tail
      // segment stays open. (An empty tail segment is just the newline's
      // right side — nothing to carry; an empty line finalizes as zero
      // runs, since runs hold ≥ 1 word.)
      const segments = slice.split("\n");
      for (let i = 0; i < segments.length - 1; i++) {
        openTail = appendSegment(
          openLine,
          openTail,
          this.#admitSegment(segments[i]!, ordinal, fromUser),
        );
        runs.push(...splitRuns(openLine));
        openLine = [];
        openTail = "";
      }
      openTail = appendSegment(
        openLine,
        openTail,
        this.#admitSegment(segments[segments.length - 1]!, ordinal, fromUser),
      );
      // BUG-004: a failure observed mid-message ends the message HERE —
      // remaining slices are skipped and the hook below is NOT called: a
      // half-admitted message's runs are meaningless once the extension
      // is dead.
      if (this.#isDisabled?.()) return;
      await this.#yieldFn(); // keystroke path resumes between slices
    }
    runs.push(...splitRuns(openLine)); // unterminated final line
    // Successor-index hook — adjacency runs, once per message. Empty text
    // never gets here (early return); null-extracted messages never enqueue.
    this.#onAdmittedTokens?.(runs);
  }

  /** Run one '\n'-free segment through the core chain (maskSecrets →
   *  tokenize → expandCandidates → passesShape → admit → store.upsert) and
   *  return the post-maskSecrets segment plus span-carrying entries for its
   *  admitted WHOLE tokens, in document order. Spans are the RawToken's own
   *  UTF-16 offsets into the MASKED segment (tokenize runs on the masked
   *  text and maskSecrets is length-preserving, so they index the raw text
   *  too). Sub-words are stored as candidates but never enter runs
   *  (PRD 002 §06 h3.6). Gate/admission accounting and #stats updates are
   *  exactly the message-loop behavior this was extracted from
   *  (P1.M3.T2.S2). Masking (BUG-003 layer 1) runs FIRST so structured
   *  secret windows never reach tokenize — this method is the single
   *  funnel for live messages AND restoreFromHistory replay, so one seam
   *  covers both paths.
   *
   *  Per-distinct-token memoization (2026-09 Issue 4): the expand → gate →
   *  admit plan is computed once per distinct raw token (see #admitMemo)
   *  and replayed per occurrence — stats counters, whole-token run
   *  entries, and store upserts stay strictly per occurrence, so counts
   *  and store state are byte-identical to the per-occurrence pipeline
   *  this replaced. The BUG-004 disable gate keeps its exact seams: the
   *  loop-top check, the post-lookup re-check inside the computation (the
   *  only place a lazy dict load can fail), and the message-level check
   *  in processText after each slice. An interrupt mid-token replays the
   *  computed prefix once (pre-abort drafts of this token still landed,
   *  exactly as the per-occurrence loop did) and is never cached. */
  #admitSegment(
    segment: string,
    ordinal: number,
    fromUser: boolean,
  ): SegmentResult {
    // Blank structured secret windows before tokenization (BUG-003 layer
    // 1): key bytes never become tokens, hence never candidates. The
    // token-level rules in isSecretShaped stay the layer-2 residue net
    // (P1.M2.T2.S1) — untouched here.
    const masked = maskSecrets(segment);
    const entries: SegmentResult["entries"] = [];
    for (const token of tokenize(masked)) {
      if (this.#isDisabled?.()) break; // BUG-004: dict failure mid-message
      let memo = this.#admitMemo.get(token.raw);
      if (memo === undefined) {
        memo = this.#computeAdmitMemo(token);
        if (!memo.complete) {
          // Disabled mid-token (dict failed inside admit's lookup): land
          // this token's pre-abort drafts exactly as the per-occurrence
          // loop did, then stop processing the segment. Never cached.
          this.#replayAdmitMemo(memo, token, ordinal, fromUser, entries);
          return { masked, entries };
        }
        if (this.#admitMemo.size >= ADMIT_MEMO_CAP) this.#admitMemo.clear();
        this.#admitMemo.set(token.raw, memo);
      }
      this.#replayAdmitMemo(memo, token, ordinal, fromUser, entries);
    }
    return { masked, entries };
  }

  /** Compute one token's admission plan (expand → gate → admit) WITHOUT
   *  stats, upserts, or run entries — those are per-occurrence effects
   *  applied by #replayAdmitMemo. Mirrors the original draft loop exactly,
   *  including the subword parent clamp input (wholeGroup = the admitted
   *  whole token's group, computed before sub-drafts are admitted) and
   *  the post-lookup isDisabled re-check (NEW-001): when the gate fires,
   *  the draft's lookup result is discarded, `complete` stays false, and
   *  the caller replays the computed prefix once without caching.
   *
   *  Parent-secret propagation (BUG-003 layer 2, PRD h3.5 minimum bar):
   *  when the WHOLE-token draft is gate-rejected with reason 'secret',
   *  every later sub-word draft of that token inherits a synthetic
   *  {ok:false, reason:'secret'} gate instead of being gated — let alone
   *  admitted — independently. CamelCase/snake_case fragments of a
   *  pasted secret (cyexamplekey, femik7, …) are short and letter-heavy
   *  and defeat isSecretShaped's token-level rules on their own gate, so
   *  without the poison they surface as completions (§01 "never
   *  embarrass"; §09 integration item 5; masking is layer 1 and never
   *  reaches tokenize). Only 'secret' propagates, and only whole →
   *  sub-word: the other reject reasons are per-draft noise shapes, and
   *  a sub-word secret reject already dies at its own gate (no
   *  secret→secret chain). The plan stays a pure function of the token's
   *  drafts — the flag lives only inside this call, ordered reliance is
   *  expandCandidates' whole-token-first contract — so memoization is
   *  untouched; #replayAdmitMemo counts the synthetic gates per
   *  occurrence through its existing !gate.ok branch (no new stats
   *  field), and poisoned drafts skip admit() so the disable seams and
   *  wholeGroup clamp semantics are unaffected. */
  #computeAdmitMemo(token: RawToken): AdmitMemoEntry {
    const drafts = expandCandidates(token); // whole token first
    const entry: AdmitMemoEntry = { drafts, gates: [], admits: [], complete: true };
    // Group of the whole token WHEN ADMITTED — the only state shared
    // by a token's drafts (subword clamp input, PRD §04).
    let wholeGroup: RankGroup | undefined;
    // BUG-003 layer 2 (PRD h3.5 minimum bar): set when the whole-token
    // draft is secret-rejected; poisons every later sub-word draft.
    let parentSecret = false;
    for (const draft of drafts) {
      if (parentSecret && draft.isSubword) {
        // Fragment of a secret-rejected whole token: inherits the
        // parent's verdict as a synthetic secret gate — never gated
        // independently, never admitted, counted per occurrence by
        // #replayAdmitMemo's existing !gate.ok branch. passesShape is
        // deliberately not recomputed (cheaper, and semantically the
        // fragment "inherits" rather than re-earns the verdict).
        entry.gates.push({ ok: false, reason: "secret" });
        entry.admits.push(undefined);
        continue;
      }
      const gate = passesShape(draft);
      entry.gates.push(gate);
      if (!gate.ok) {
        // reason is present iff !ok (GateResult contract); gate-rejected
        // drafts never reach admit (and can never trigger the dict load).
        entry.admits.push(undefined);
        // Only a WHOLE-token 'secret' reject poisons sub-words (BUG-003
        // layer 2); non-secret reasons stay per-draft (§04 semantics).
        if (!draft.isSubword && gate.reason === "secret") parentSecret = true;
        continue;
      }
      const result = admit(
        draft,
        this.#dictionary,
        draft.isSubword ? wholeGroup : undefined,
      );
      // NEW-001: admit()'s lookup is the only call that can trigger (and
      // fail) the lazy dictionary load. If the failure is observed here,
      // this draft lands nothing — its result is discarded (undefined in
      // the plan) and the token is marked incomplete.
      if (this.#isDisabled?.()) {
        entry.admits.push(undefined);
        entry.complete = false;
        break;
      }
      if (!draft.isSubword && result !== "reject") wholeGroup ??= result;
      entry.admits.push(result);
    }
    return entry;
  }

  /** Apply one token's admission plan for ONE occurrence: gate-reject
   *  accounting, wordsSeen, admitted, whole-token run entries (spans from
   *  THIS occurrence's token), and store upserts — the per-occurrence
   *  effects the memo deliberately excludes. An interrupted plan (the
   *  draft whose lookup observed the disable flip) counts its wordsSeen
   *  and stops, mirroring the original loop's discard-after-failure. */
  #replayAdmitMemo(
    memo: AdmitMemoEntry,
    token: RawToken,
    ordinal: number,
    fromUser: boolean,
    entries: SegmentResult["entries"],
  ): void {
    for (let i = 0; i < memo.drafts.length; i++) {
      const gate = memo.gates[i]!;
      const draft = memo.drafts[i]!;
      if (!gate.ok) {
        // reason is present iff !ok (GateResult contract)
        this.#stats.rejectedByGate[gate.reason!]++;
        continue; // gate-rejected drafts are never wordsSeen
      }
      this.#stats.wordsSeen++;
      const result = memo.admits[i];
      if (result === undefined) break; // interrupted plan — computed no further
      if (result === "reject") continue; // admission reject: simply
      // not stored (PRD §04 h2.24); no IngestStats field by design.
      this.#stats.admitted++;
      if (!draft.isSubword) {
        entries.push({ key: draft.key, start: token.start, end: token.end });
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
 *
 * The replay is fire-and-forget (…void…): session_start does not await
 * it; failures inside the loop are swallowed per entry.
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
      if (shouldAbort?.()) {
        return; // BUG-004: dict failed → stop replay cold
      }
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