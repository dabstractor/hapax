/**
 * PRD §05 IngestPipeline suite (P1.M3.T2.S2): 300 ms trailing debounce
 * (h2.29), chunked core chain with an awaited yield between ≤chunkBytes
 * slices (h2.30, §02 h2.15), IngestStats accounting for /acwords (§08),
 * subword admission independence + parent-group clamp (§04), the M2
 * whole-token hook, and handler purity (h2.34 — void return, no message
 * mutation, no text retention).
 *
 * Timer strategy: vi.useFakeTimers() for debounce timing; the inter-slice
 * yield is ALWAYS injected (an async counter) so fake timers never meet
 * the real setImmediate fallback. The default-yield smoke test restores
 * real timers first.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateStore } from "../src/core/store.js";
import {
  MID_FREQ_THRESHOLD,
  REJECT_COMMON_THRESHOLD,
} from "../src/core/score.js";
import type { Dictionary } from "../src/core/types.js";
import { IngestPipeline, type AgentMessage } from "../src/pi/ingest.js";

// --- fixture helpers: minimal valid pi messages (copied from ingest.test.ts;
// --- test files are self-contained) -----------------------------------------

type UserMessage = Extract<AgentMessage, { role: "user" }>;
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;

const userMsg = (content: UserMessage["content"]): UserMessage => ({
  role: "user",
  content,
  timestamp: 0,
});

const assistantMsg = (
  content: AssistantMessage["content"],
): AssistantMessage => ({
  role: "assistant",
  content,
  api: "anthropic-messages",
  provider: "anthropic",
  model: "test-model",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 0,
});

const toolResultMsg = (): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: "call_1",
  toolName: "read",
  content: [],
  isError: false,
  timestamp: 0,
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as object)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

// --- stub dictionary + pipeline harness -------------------------------------

/** COMMON words sit in the reject band, MIDFREQ in group 2 — values built
 *  from the score.ts constants so a retune can't silently invert intent:
 *  q ≥ REJECT_COMMON_THRESHOLD → admit 'reject'; q in [MID_FREQ_THRESHOLD,
 *  REJECT_COMMON_THRESHOLD) → group 2; null → 0. */
const COMMON = new Set(["context", "contextzephyr"]);
const MIDFREQ = new Set(["granite", "graniteore"]);
const stubDict = (): Dictionary => ({
  lookup: (w) =>
    COMMON.has(w)
      ? REJECT_COMMON_THRESHOLD + 30
      : MIDFREQ.has(w)
        ? MID_FREQ_THRESHOLD + 20
        : null,
  version: 1,
  entryCount: 0,
});

interface Harness {
  pipeline: IngestPipeline;
  store: CandidateStore;
  counts: { yields: number };
}

function makePipeline(
  opts: {
    chunkBytes?: number;
    onAdmittedTokens?: (runs: string[][]) => void;
    withYieldFn?: boolean;
  } = {},
): Harness {
  const store = new CandidateStore();
  const counts = { yields: 0 };
  const pipeline = new IngestPipeline({
    store,
    dictionary: stubDict(),
    ...(opts.withYieldFn === false
      ? {}
      : {
          yieldFn: async () => {
            counts.yields++;
          },
        }),
    ...(opts.chunkBytes !== undefined ? { chunkBytes: opts.chunkBytes } : {}),
    ...(opts.onAdmittedTokens ? { onAdmittedTokens: opts.onAdmittedTokens } : {}),
  });
  return { pipeline, store, counts };
}

/** "zephyr quartz vortex " — exactly 21 chars, so chunkBytes 21 slices land
 *  on token boundaries and per-word sessionCounts stay exact. */
const UNIT = "zephyr quartz vortex ";

const drainNow = async (h: Harness): Promise<void> => {
  vi.advanceTimersByTime(300); // fire the debounce
  await h.pipeline.flush(); // let the in-flight drain settle
};

describe("IngestPipeline — PRD §05 h2.29/h2.30", () => {
  beforeEach(() => {
    // vitest 4 no longer fakes setTimeout by default — name it explicitly
    // (PRP gotcha: never fake timers alongside the real setImmediate yield).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces messages arriving within the window and drains oldest-first", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(userMsg("zephyr"));
    h.pipeline.onMessageEnd(userMsg("quartz"));
    h.pipeline.onMessageEnd(userMsg("vortex"));
    // Trailing edge: three messages, ONE re-armed timer (never stacked).
    expect(vi.getTimerCount()).toBe(1);
    await drainNow(h);
    expect(h.store.currentOrdinal()).toBe(3); // one ordinal per message
    expect(h.store.get("zephyr")?.firstSeenOrdinal).toBe(1);
    expect(h.store.get("quartz")?.firstSeenOrdinal).toBe(2);
    expect(h.store.get("vortex")?.firstSeenOrdinal).toBe(3);
    expect(h.store.get("zephyr")?.userTyped).toBe(true); // fromUser plumbed
  });

  it("re-arms the debounce on each new message (fires 300ms after the LAST)", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(userMsg("zephyr"));
    vi.advanceTimersByTime(250);
    h.pipeline.onMessageEnd(userMsg("quartz"));
    expect(vi.getTimerCount()).toBe(1); // re-armed, not stacked
    vi.advanceTimersByTime(250); // t=500 — original fire (t=300) passed
    expect(h.store.currentOrdinal()).toBe(0); // nothing drained yet
    vi.advanceTimersByTime(50); // t=550 = 250 + 300
    await h.pipeline.flush();
    expect(h.store.currentOrdinal()).toBe(2);
    expect(h.store.get("zephyr")).toBeDefined();
    expect(h.store.get("quartz")).toBeDefined();
  });

  it("ignores messages with no ingestable text (null extraction → no enqueue, no timer)", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(toolResultMsg());
    expect(vi.getTimerCount()).toBe(0); // timer untouched by null extraction
    vi.advanceTimersByTime(1000);
    await h.pipeline.flush();
    expect(h.store.currentOrdinal()).toBe(0);
    expect(h.store.size).toBe(0);
  });

  it("chunks multi-chunk text into slices with a yield awaited between each", async () => {
    const h = makePipeline({ chunkBytes: 21 });
    h.pipeline.onMessageEnd(userMsg(UNIT.repeat(15))); // 315 chars → 15 slices
    await drainNow(h);
    expect(h.counts.yields).toBe(15); // one awaited yield per slice (≥2 req.)
    // Token-aligned slices: every word seen exactly once per unit.
    expect(h.store.get("zephyr")?.sessionCount).toBe(15);
    expect(h.store.get("quartz")?.sessionCount).toBe(15);
    expect(h.store.get("vortex")?.sessionCount).toBe(15);
  });

  it("issues exactly one store ordinal per multi-chunk message", async () => {
    const h = makePipeline({ chunkBytes: 21 });
    h.pipeline.onMessageEnd(userMsg(UNIT.repeat(15)));
    await drainNow(h);
    expect(h.store.currentOrdinal()).toBe(1); // not per slice, not per token
    expect(h.store.get("zephyr")?.firstSeenOrdinal).toBe(
      h.store.get("zephyr")?.lastSeenOrdinal,
    );
  });

  it("tallies IngestStats exactly on a hand-computed fixture", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(
      userMsg("zephyr zephyr abc a1b2c3d4e5f6a7b8c9d0 context granite"),
    );
    await drainNow(h);
    const stats = h.pipeline.getStats();
    expect(stats.wordsSeen).toBe(4); // zephyr×2, context, granite (gate-passed)
    expect(stats.admitted).toBe(3); // zephyr×2 + granite ("context" is reject)
    expect(stats.rejectedByGate).toEqual({
      tooShort: 1, // "abc"
      tooLong: 0,
      lowEntropy: 0,
      unigramRun: 0,
      secret: 1, // 20-char pure hex
      consonantRun: 0,
    });
    expect(h.store.get("zephyr")?.sessionCount).toBe(2);
    expect(h.store.get("zephyr")?.rankGroup).toBe(0); // dictionary-absent
    expect(h.store.get("granite")?.rankGroup).toBe(2); // mid band: MID ≤ q < REJECT
    expect(h.store.get("context")).toBeUndefined(); // admission reject
    expect(h.store.get("abc")).toBeUndefined();
    // getStats returns a copy — mutating it must not touch the pipeline.
    stats.rejectedByGate.secret = 99;
    expect(h.pipeline.getStats().rejectedByGate.secret).toBe(1);
  });

  it("admits subwords independently and clamps only under an admitted parent", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(userMsg("contextZephyr hammerTime"));
    await drainNow(h);
    // Whole "contextzephyr" is COMMON → admission reject; the rare subword
    // "zephyr" is STILL admitted, without the parent clamp (group 0).
    expect(h.store.get("contextzephyr")).toBeUndefined();
    expect(h.store.get("zephyr")?.rankGroup).toBe(0);
    // Whole "hammertime" admitted rare (0) → subwords clamp to parent+1.
    expect(h.store.get("hammertime")?.rankGroup).toBe(0);
    expect(h.store.get("hammer")?.rankGroup).toBe(1);
    expect(h.store.get("time")?.rankGroup).toBe(1);
  });

  it("calls onAdmittedTokens once per message with adjacency runs of whole-token keys", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(userMsg("zephyr deltaWave"));
    h.pipeline.onMessageEnd(assistantMsg([{ type: "text", text: "vortex" }]));
    h.pipeline.onMessageEnd(userMsg("abc")); // nothing admitted anywhere
    await drainNow(h);
    // Whole tokens only ("delta"/"wave" subwords excluded), doc order,
    // one call per message. Runs hold ≥ 1 word: "abc" admitted nothing,
    // so its runs array is empty (the old per-line shape emitted []s).
    expect(calls).toEqual([[["zephyr", "deltawave"]], [["vortex"]], []]);
    // Role plumbing: user → userTyped sticky, assistant → not.
    expect(h.store.get("zephyr")?.userTyped).toBe(true);
    expect(h.store.get("vortex")?.userTyped).toBe(false);
  });

  it("treats an absent onAdmittedTokens as a no-op", async () => {
    const h = makePipeline(); // no hook supplied (M1 default)
    h.pipeline.onMessageEnd(userMsg("zephyr"));
    await drainNow(h); // must not throw
    expect(h.store.size).toBe(1);
  });

  it("routes each gate-reject reason to its own stats bucket", async () => {
    const h = makePipeline();
    // tooLong is only reachable via subwords: tokenize caps whole tokens at
    // 64 chars, but a camelCase sub-word over 32 hits the gate's cap. The
    // "quartzT…" whole token and its "quartz" sub pass (high entropy, no
    // runs); the 33-char "T…" sub rejects on length before any other rule.
    // The whole token is 39 chars — deliberately UNDER maskSecrets' bare
    // 40-char catch-all (BUG-003 layer 1 blanks ≥40 alnum runs before the
    // gate), so it still reaches the gate to exercise this bucket.
    h.pipeline.onMessageEnd(
      userMsg(
        "abc " + // 3 chars → tooShort
          "aabbaabb " + // entropy 1.0 < 1.5 → lowEntropy
          "rhythmjs " + // 8-consonant run (y is not a vowel) → consonantRun
          "aaaabcdee " + // 4×'a' run, entropy 2.1 → unigramRun
          "quartzTabecidofuabecidofuabecidofuaheki", // 33-char sub → tooLong
      ),
    );
    await drainNow(h);
    expect(h.pipeline.getStats().rejectedByGate).toEqual({
      tooShort: 1,
      tooLong: 1,
      lowEntropy: 1,
      unigramRun: 1,
      secret: 0,
      consonantRun: 1,
    });
    // wordsSeen counts only gate-passed drafts: the "quartzT…" whole token
    // and its "quartz" sub (the four rejects above never count).
    expect(h.pipeline.getStats().wordsSeen).toBe(2);
    expect(h.store.size).toBe(2);
  });

  it("handler purity: returns undefined and never mutates a frozen message", async () => {
    const h = makePipeline();
    const message = deepFreeze(userMsg("zephyr quartz"));
    expect(Object.isFrozen(message)).toBe(true);
    expect(h.pipeline.onMessageEnd(message)).toBeUndefined(); // void, always
    await drainNow(h); // frozen input ingests fine (read-only access)
    expect(h.store.get("zephyr")).toBeDefined();
    expect(h.store.get("quartz")).toBeDefined();
  });

  it("queues messages arriving during an in-flight drain without double-draining", async () => {
    const h = makePipeline({ chunkBytes: 21 });
    h.pipeline.onMessageEnd(userMsg(UNIT.repeat(3))); // 3 slices
    vi.advanceTimersByTime(300); // drain starts (in flight)
    h.pipeline.onMessageEnd(userMsg("zephyr")); // lands mid-drain → re-arms
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(300); // second fire — must reuse, not double-drain
    await h.pipeline.flush();
    expect(h.store.get("zephyr")?.sessionCount).toBe(4); // 3 + 1, no re-processing
    expect(h.store.currentOrdinal()).toBe(2);
  });

  it("drains immediately via flush() with the default yield path", async () => {
    vi.useRealTimers(); // the setImmediate fallback needs real timers
    const store = new CandidateStore();
    const pipeline = new IngestPipeline({ store, dictionary: stubDict() });
    pipeline.onMessageEnd(userMsg("zephyr quartz vortex")); // arms a real timer
    await pipeline.flush(); // clears the timer, drains now — no 300ms wait
    expect(store.size).toBe(3);
    expect(store.currentOrdinal()).toBe(1);
  });
});

// --- onAdmittedTokens: adjacency runs (PRD 002 §06 h3.6, P1.M1.T3.S2) -------

/**
 * A run breaks between two consecutive admitted tokens unless the raw gap
 * is plain spaces/tabs on the SAME line: clause punctuation, quotes and
 * brackets, digits/hexish/symbols, intervening rejected words ("of", "the",
 * "v2"), and newlines all break; multi-space/tab gaps chain, including
 * across a chunk boundary (gap text carries via openTail). Counting cases
 * feed the captured runs to the real store (index.ts's wiring shape) and
 * check the successor index, so a bridged bigram can never hide behind a
 * well-shaped runs array.
 */
describe("onAdmittedTokens — adjacency runs (PRD 002 §06 h3.6, P1.M1.T3.S2)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("chains whitespace-only gaps — single space, mixed space/tab, 3-word run", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(userMsg("zephyr deltaWave"));
    h.pipeline.onMessageEnd(userMsg("zephyr \t deltaWave")); // space+tab+space
    h.pipeline.onMessageEnd(userMsg("zephyr quartz vortex"));
    await drainNow(h);
    expect(calls).toEqual([
      [["zephyr", "deltawave"]],
      [["zephyr", "deltawave"]],
      [["zephyr", "quartz", "vortex"]],
    ]);
    // A 3-word run yields BOTH adjacent-pair bigrams via the real wiring.
    h.store.recordBigramRuns(calls[2]!);
    expect(h.store.topSuccessors("zephyr")).toEqual([{ next: "quartz", count: 1 }]);
    expect(h.store.topSuccessors("quartz")).toEqual([{ next: "vortex", count: 1 }]);
  });

  it.each([",", ";", ":", ".", "!", "?", "—", "–", "…", "|"])(
    "clause punctuation %j breaks the run",
    async (p) => {
      const calls: string[][][] = [];
      const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
      h.pipeline.onMessageEnd(userMsg(`zephyr${p} quuxblat`));
      await drainNow(h);
      expect(calls).toEqual([[["zephyr"], ["quuxblat"]]]);
      h.store.recordBigramRuns(calls[0]!);
      expect(h.store.topSuccessors("zephyr")).toEqual([]); // no cross bigram
    },
  );

  it("backtick-quoted words never chain", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(userMsg("`zephyr` `quuxblat`"));
    await drainNow(h);
    expect(calls).toEqual([[["zephyr"], ["quuxblat"]]]);
  });

  it.each([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["<", ">"],
    ['"', '"'],
    ["'", "'"],
  ])("words entering/leaving %s…%s never chain to neighbors outside", async (open, close) => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(
      userMsg(`vortex ${open}zephyr quuxblat${close} granite`),
    );
    await drainNow(h);
    // The inner pair chains; both boundary words are fenced off by the
    // bracket characters in their gaps.
    expect(calls).toEqual([[["vortex"], ["zephyr", "quuxblat"], ["granite"]]]);
  });

  it.each(["/", "\\", "=", "+", "&", "%", "#", "*", "@", "-", "~", "^"])(
    "symbol %j between two words breaks the run",
    async (s) => {
      const calls: string[][][] = [];
      const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
      h.pipeline.onMessageEnd(userMsg(`zephyr ${s} quuxblat`));
      await drainNow(h);
      expect(calls).toEqual([[["zephyr"], ["quuxblat"]]]);
    },
  );

  it("digit runs and hexish tokens break the chain ACROSS them", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    // "v2" is gate-rejected (too short) → pure gap text → the run breaks.
    h.pipeline.onMessageEnd(userMsg("zephyr v2 quuxblat"));
    // "0f3a9c2" is hexish and ADMITS (rare) → it sits IN the run — but
    // only consecutive pairs bigram, so zephyr→quuxblat never happens.
    h.pipeline.onMessageEnd(userMsg("zephyr 0f3a9c2 quuxblat"));
    await drainNow(h);
    expect(calls).toEqual([
      [["zephyr"], ["quuxblat"]],
      [["zephyr", "0f3a9c2", "quuxblat"]],
    ]);
    h.store.recordBigramRuns([...calls[0]!, ...calls[1]!]);
    expect(h.store.topSuccessors("zephyr")).toEqual([
      { next: "0f3a9c2", count: 1 },
    ]);
    expect(h.store.topSuccessors("0f3a9c2")).toEqual([
      { next: "quuxblat", count: 1 },
    ]);
    expect(h.store.topSuccessors("quuxblat")).toEqual([]);
  });

  it("a rejected word between two admitted words breaks the run (no stopword bridging)", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    // "of" is gate-rejected (2 chars) — its TEXT stays in the gap and must
    // break, never bridge: the PRD §06 h3.6 exemplar. Same class: "the".
    h.pipeline.onMessageEnd(userMsg("United States of America"));
    h.pipeline.onMessageEnd(userMsg("zephyr the quuxblat"));
    await drainNow(h);
    expect(calls).toEqual([
      [["united", "states"], ["america"]],
      [["zephyr"], ["quuxblat"]],
    ]);
    h.store.recordBigramRuns(calls[0]!);
    expect(h.store.topSuccessors("united")).toEqual([
      { next: "states", count: 1 },
    ]);
    expect(h.store.topSuccessors("states")).toEqual([]); // never bridges to america
  });

  it("ZorpWibbleEngine, quuxblat never chains (the stopword-bridge bug class)", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(userMsg("ZorpWibbleEngine, quuxblat"));
    h.pipeline.onMessageEnd(userMsg("ZorpWibbleEngine, the quuxblat"));
    await drainNow(h);
    // ", " and ", the " both break — under the old per-line shape the
    // first message's line array produced the bridged bigram.
    expect(calls).toEqual([
      [["zorpwibbleengine"], ["quuxblat"]],
      [["zorpwibbleengine"], ["quuxblat"]],
    ]);
    h.store.recordBigramRuns(calls[0]!);
    expect(h.store.topSuccessors("zorpwibbleengine")).toEqual([]);
  });

  it("newline breaks runs; blank lines yield nothing (no empty arrays); one call per message", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(userMsg("zephyr quartz\nvortex granite"));
    h.pipeline.onMessageEnd(userMsg("zephyr\n\nvortex\n"));
    await drainNow(h);
    expect(calls).toEqual([
      [["zephyr", "quartz"], ["vortex", "granite"]],
      [["zephyr"], ["vortex"]], // the blank line emits NO empty run
    ]);
  });

  it("a chunk boundary inside a whitespace gap still chains", async () => {
    const calls: string[][][] = [];
    // "zephyr" + 6 spaces + "quuxblat", sliced at 12: slice 1 ends exactly
    // at the gap's end ("zephyr      "), slice 2 starts at "quuxblat".
    const h = makePipeline({
      chunkBytes: 12,
      onAdmittedTokens: (runs) => calls.push(runs),
    });
    h.pipeline.onMessageEnd(userMsg("zephyr      quuxblat"));
    await drainNow(h);
    expect(h.counts.yields).toBe(2); // the boundary really happened
    expect(calls).toEqual([[["zephyr", "quuxblat"]]]); // gap carried → chains
    h.store.recordBigramRuns(calls[0]!);
    expect(h.store.topSuccessors("zephyr")).toEqual([
      { next: "quuxblat", count: 1 },
    ]);
  });

  it("a chunk boundary inside a punctuation gap still breaks", async () => {
    const calls: string[][][] = [];
    // "zephyr, quuxblat" sliced at 8: slice 1 ends mid-gap ("zephyr, ").
    // The comma must survive the carry (openTail) and break the run.
    const h = makePipeline({
      chunkBytes: 8,
      onAdmittedTokens: (runs) => calls.push(runs),
    });
    h.pipeline.onMessageEnd(userMsg("zephyr, quuxblat"));
    await drainNow(h);
    expect(h.counts.yields).toBe(2);
    expect(calls).toEqual([[["zephyr"], ["quuxblat"]]]);
  });

  it("a chunk boundary never breaks a run — only '\\n' does", async () => {
    const calls: string[][][] = [];
    // "zephyr quartz vortex" cut after each token (7-char slices): two
    // chunk boundaries, zero newlines — still ONE run with all words.
    const h = makePipeline({
      chunkBytes: 7,
      onAdmittedTokens: (runs) => calls.push(runs),
    });
    h.pipeline.onMessageEnd(userMsg("zephyr quartz vortex"));
    await drainNow(h);
    expect(h.counts.yields).toBe(3); // boundaries really happened
    expect(calls).toEqual([[["zephyr", "quartz", "vortex"]]]);
    // The pairs SPANNING the slice boundaries survive recording.
    h.store.recordBigramRuns(calls[0]!);
    expect(h.store.topSuccessors("quartz")).toEqual([{ next: "vortex", count: 1 }]);
    expect(h.store.topSuccessors("zephyr")).toEqual([{ next: "quartz", count: 1 }]);
  });

  it("repeated runs double the successor count", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(userMsg("zephyr quartz"));
    h.pipeline.onMessageEnd(userMsg("zephyr quartz"));
    await drainNow(h);
    expect(calls).toEqual([[["zephyr", "quartz"]], [["zephyr", "quartz"]]]);
    h.store.recordBigramRuns(calls[0]!);
    h.store.recordBigramRuns(calls[1]!);
    expect(h.store.topSuccessors("zephyr")).toEqual([{ next: "quartz", count: 2 }]);
  });

  it("sub-words never enter runs — only whole-token keys", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    // Whole "contextzephyr" is COMMON → admission reject; its admitted
    // subwords ("context", "zephyr") are subword drafts — excluded.
    h.pipeline.onMessageEnd(userMsg("contextZephyr standalone"));
    await drainNow(h);
    expect(calls).toEqual([[["standalone"]]]);
    // Subwords DID reach the word store (established §04 behavior; the
    // "context" subword is COMMON → admission reject there)…
    expect(h.store.get("zephyr")).toBeDefined();
    expect(h.store.get("standalone")).toBeDefined();
  });

  it("multi-block messages produce runs per line (extractText joins with '\\n')", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(
      userMsg([
        { type: "text", text: "zephyr quartz" },
        { type: "text", text: "vortex" },
      ]),
    );
    await drainNow(h);
    expect(calls).toEqual([[["zephyr", "quartz"], ["vortex"]]]);
  });

  it("no callback for empty text or null-extraction messages", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(toolResultMsg()); // null extraction → never queued
    h.pipeline.onMessageEnd(userMsg("")); // empty text → processText early-return
    await drainNow(h);
    expect(calls).toEqual([]);
    expect(h.store.currentOrdinal()).toBe(0); // no ordinal issued either
  });
});
