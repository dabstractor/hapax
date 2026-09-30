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
import { rankMatches } from "../src/core/query.js";
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

/** COMMON words sit in the reject band, MIDFREQ (2026-09 retighten) in
 *  group 1 — the rarest-attested tail — values built from the score.ts
 *  constants so a retune can't silently invert intent:
 *  q ≥ REJECT_COMMON_THRESHOLD → 'reject'; q just under it → group 1
 *  (the old group-2 mid band is unreachable with REJECT=12); null → 0.
 *  "the"/"of" joined COMMON with the 2026 MIN_LENGTH floor drop: they used
 *  to die at the GATE (tooShort) and the stub never needed to attest
 *  them; now only the commonness band rejects them, exactly as the
 *  shipped dictionary does (q=240/230, deep in the reject band). */
const COMMON = new Set(["context", "the", "of"]);
const COMMON_LONG = new Set(["contextlwlock"]);
const MIDFREQ = new Set(["granite", "graniteore"]);
const stubDict = (): Dictionary => ({
  lookup: (w) =>
    COMMON.has(w)
      ? REJECT_COMMON_THRESHOLD + 30
      : COMMON_LONG.has(w)
        ? // 2026-10 gradient: a 13-char compound must attest DEEP in the
          // band to stay a reject under its sqrt ramp (rEff(12,13) ≈ 168.9),
          // matching how the shipped dictionary attests common words
          // (q=240/230 — see the fixture note above).
          230
        : MIDFREQ.has(w)
          ? REJECT_COMMON_THRESHOLD - 2
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

/** "lwlock norias invert " — exactly 21 chars, so chunkBytes 21 slices land
 *  on token boundaries and per-word sessionCounts stay exact. */
const UNIT = "lwlock norias invert ";

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
    h.pipeline.onMessageEnd(userMsg("lwlock"));
    h.pipeline.onMessageEnd(userMsg("norias"));
    h.pipeline.onMessageEnd(userMsg("invert"));
    // Trailing edge: three messages, ONE re-armed timer (never stacked).
    expect(vi.getTimerCount()).toBe(1);
    await drainNow(h);
    expect(h.store.currentOrdinal()).toBe(3); // one ordinal per message
    expect(h.store.get("lwlock")?.firstSeenOrdinal).toBe(1);
    expect(h.store.get("norias")?.firstSeenOrdinal).toBe(2);
    expect(h.store.get("invert")?.firstSeenOrdinal).toBe(3);
    expect(h.store.get("lwlock")?.userTyped).toBe(true); // fromUser plumbed
  });

  it("re-arms the debounce on each new message (fires 300ms after the LAST)", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(userMsg("lwlock"));
    vi.advanceTimersByTime(250);
    h.pipeline.onMessageEnd(userMsg("norias"));
    expect(vi.getTimerCount()).toBe(1); // re-armed, not stacked
    vi.advanceTimersByTime(250); // t=500 — original fire (t=300) passed
    expect(h.store.currentOrdinal()).toBe(0); // nothing drained yet
    vi.advanceTimersByTime(50); // t=550 = 250 + 300
    await h.pipeline.flush();
    expect(h.store.currentOrdinal()).toBe(2);
    expect(h.store.get("lwlock")).toBeDefined();
    expect(h.store.get("norias")).toBeDefined();
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
    expect(h.store.get("lwlock")?.sessionCount).toBe(15);
    expect(h.store.get("norias")?.sessionCount).toBe(15);
    expect(h.store.get("invert")?.sessionCount).toBe(15);
  });

  it("issues exactly one store ordinal per multi-chunk message", async () => {
    const h = makePipeline({ chunkBytes: 21 });
    h.pipeline.onMessageEnd(userMsg(UNIT.repeat(15)));
    await drainNow(h);
    expect(h.store.currentOrdinal()).toBe(1); // not per slice, not per token
    expect(h.store.get("lwlock")?.firstSeenOrdinal).toBe(
      h.store.get("lwlock")?.lastSeenOrdinal,
    );
  });

  it("tallies IngestStats exactly on a hand-computed fixture", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(
      userMsg("lwlock lwlock abc a1b2c3d4e5f6a7b8c9d0 context granite"),
    );
    await drainNow(h);
    const stats = h.pipeline.getStats();
    // 2026 floor drop: "abc" (3 chars, stub-absent) now PASSES the gate
    // and ADMITS (group 0) — the old tooShort death is gone.
    expect(stats.wordsSeen).toBe(5); // lwlock×2, abc, context, granite
    expect(stats.admitted).toBe(4); // lwlock×2 + granite + abc ("context" is the lone admission reject)
    expect(stats.rejectedByGate).toEqual({
      tooShort: 0,
      tooLong: 0,
      lowEntropy: 0,
      unigramRun: 0,
      secret: 1, // 20-char pure hex
      consonantRun: 0,
    });
    expect(h.store.get("lwlock")?.sessionCount).toBe(2);
    expect(h.store.get("lwlock")?.rankGroup).toBe(0); // dictionary-absent
    expect(h.store.get("granite")?.rankGroup).toBe(1); // rarest-attested tail (q = REJECT − 2; the g2 mid band is retired)
    expect(h.store.get("context")).toBeUndefined(); // admission reject
    expect(h.store.get("abc")?.rankGroup).toBe(0); // stub-absent → admits since the floor drop
    // getStats returns a copy — mutating it must not touch the pipeline.
    stats.rejectedByGate.secret = 99;
    expect(h.pipeline.getStats().rejectedByGate.secret).toBe(1);
  });

  it("admits subwords independently and clamps only under an admitted parent", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(userMsg("contextLwlock hammerTime"));
    await drainNow(h);
    // Whole "contextlwlock" is COMMON → admission reject; the rare subword
    // "lwlock" is STILL admitted, without the parent clamp (group 0).
    expect(h.store.get("contextlwlock")).toBeUndefined();
    expect(h.store.get("lwlock")?.rankGroup).toBe(0);
    // Whole "hammertime" admitted rare (0) → subwords clamp to parent+1.
    expect(h.store.get("hammertime")?.rankGroup).toBe(0);
    expect(h.store.get("hammer")?.rankGroup).toBe(1);
    expect(h.store.get("time")?.rankGroup).toBe(1);
  });

  it("calls onAdmittedTokens once per message with adjacency runs of whole-token keys", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(userMsg("lwlock deltaWave"));
    h.pipeline.onMessageEnd(assistantMsg([{ type: "text", text: "invert" }]));
    h.pipeline.onMessageEnd(userMsg("context")); // COMMON → admission reject — nothing admitted
    await drainNow(h);
    // Whole tokens only ("delta"/"wave" subwords excluded), doc order,
    // one call per message. Runs hold ≥ 1 word: "context" admitted nothing
    // (COMMON reject), so its runs array is empty (the old per-line shape
    // emitted []s).
    expect(calls).toEqual([[["lwlock", "deltawave"]], [["invert"]], []]);
    // Role plumbing: user → userTyped sticky, assistant → not.
    expect(h.store.get("lwlock")?.userTyped).toBe(true);
    expect(h.store.get("invert")?.userTyped).toBe(false);
  });

  it("treats an absent onAdmittedTokens as a no-op", async () => {
    const h = makePipeline(); // no hook supplied (M1 default)
    h.pipeline.onMessageEnd(userMsg("lwlock"));
    await drainNow(h); // must not throw
    expect(h.store.size).toBe(1);
  });

  it("routes each gate-reject reason to its own stats bucket", async () => {
    const h = makePipeline();
    // tooLong is only reachable via subwords: tokenize caps whole tokens at
    // 64 chars, but a camelCase sub-word over 32 hits the gate's cap — and
    // a >32-char sub needs a >32-char alnum segment. The 39-char whole
    // token below was DELIBERATELY under the old bare-40 catch-all so it
    // reached the gate ("norias" sub passed, 33-char "T…" sub → tooLong);
    // BUG-003 h3.2 lowered the catch-all to BARE_RUN_MIN = 32, so
    // maskSecrets now blanks it BEFORE segmentation — a >32-char alnum
    // segment can no longer reach the gate at all. tooLong is therefore
    // pipeline-unreachable (pinned 0 here); its gate-level coverage lives
    // in test/shapeGate.test.ts.
    h.pipeline.onMessageEnd(
      userMsg(
        "aabbaabb " + // entropy 1.0 < 1.5 → lowEntropy
          "rhythmjs " + // 8-consonant run (y is not a vowel) → consonantRun
          "aaaabcdee " + // 4×'a' run, entropy 2.1 → unigramRun
          "noriasTabecidofuabecidofuabecidofuaheki", // 39 alnum chars → masked, zero drafts
      ),
    );
    await drainNow(h);
    expect(h.pipeline.getStats().rejectedByGate).toEqual({
      // tooShort is pipeline-unreachable since the 2026 floor drop
      // (MIN_LENGTH=2): tokenize() emits whole tokens ≥ 2 chars, so no
      // draft can fall under the floor — pinned 0 here, gate-level
      // coverage lives in test/shapeGate.test.ts (mirrors the tooLong
      // precedent below).
      tooShort: 0,
      tooLong: 0, // masked pre-segmentation (BARE_RUN_MIN = 32) — see above
      lowEntropy: 1,
      unigramRun: 1,
      secret: 0,
      consonantRun: 1,
    });
    // wordsSeen counts only gate-passed drafts: the four reachable rejects
    // above never count, and the 39-char token is masked away entirely
    // (pre-change it contributed the "noriasT…" whole + "norias" sub).
    expect(h.pipeline.getStats().wordsSeen).toBe(0);
    expect(h.store.size).toBe(0);
  });

  it("handler purity: returns undefined and never mutates a frozen message", async () => {
    const h = makePipeline();
    const message = deepFreeze(userMsg("lwlock norias"));
    expect(Object.isFrozen(message)).toBe(true);
    expect(h.pipeline.onMessageEnd(message)).toBeUndefined(); // void, always
    await drainNow(h); // frozen input ingests fine (read-only access)
    expect(h.store.get("lwlock")).toBeDefined();
    expect(h.store.get("norias")).toBeDefined();
  });

  it("queues messages arriving during an in-flight drain without double-draining", async () => {
    const h = makePipeline({ chunkBytes: 21 });
    h.pipeline.onMessageEnd(userMsg(UNIT.repeat(3))); // 3 slices
    vi.advanceTimersByTime(300); // drain starts (in flight)
    h.pipeline.onMessageEnd(userMsg("lwlock")); // lands mid-drain → re-arms
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(300); // second fire — must reuse, not double-drain
    await h.pipeline.flush();
    expect(h.store.get("lwlock")?.sessionCount).toBe(4); // 3 + 1, no re-processing
    expect(h.store.currentOrdinal()).toBe(2);
  });

  it("drains immediately via flush() with the default yield path", async () => {
    vi.useRealTimers(); // the setImmediate fallback needs real timers
    const store = new CandidateStore();
    const pipeline = new IngestPipeline({ store, dictionary: stubDict() });
    pipeline.onMessageEnd(userMsg("lwlock norias invert")); // arms a real timer
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
    h.pipeline.onMessageEnd(userMsg("lwlock deltaWave"));
    h.pipeline.onMessageEnd(userMsg("lwlock \t deltaWave")); // space+tab+space
    h.pipeline.onMessageEnd(userMsg("lwlock norias invert"));
    await drainNow(h);
    expect(calls).toEqual([
      [["lwlock", "deltawave"]],
      [["lwlock", "deltawave"]],
      [["lwlock", "norias", "invert"]],
    ]);
    // A 3-word run yields BOTH adjacent-pair bigrams via the real wiring.
    h.store.recordBigramRuns(calls[2]!);
    expect(h.store.topSuccessors("lwlock")).toEqual([{ next: "norias", count: 1 }]);
    expect(h.store.topSuccessors("norias")).toEqual([{ next: "invert", count: 1 }]);
  });

  it.each([",", ";", ":", ".", "!", "?", "—", "–", "…", "|"])(
    "clause punctuation %j breaks the run",
    async (p) => {
      const calls: string[][][] = [];
      const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
      h.pipeline.onMessageEnd(userMsg(`lwlock${p} quuxblat`));
      await drainNow(h);
      expect(calls).toEqual([[["lwlock"], ["quuxblat"]]]);
      h.store.recordBigramRuns(calls[0]!);
      expect(h.store.topSuccessors("lwlock")).toEqual([]); // no cross bigram
    },
  );

  it("backtick-quoted words never chain", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(userMsg("`lwlock` `quuxblat`"));
    await drainNow(h);
    expect(calls).toEqual([[["lwlock"], ["quuxblat"]]]);
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
      userMsg(`invert ${open}lwlock quuxblat${close} granite`),
    );
    await drainNow(h);
    // The inner pair chains; both boundary words are fenced off by the
    // bracket characters in their gaps.
    expect(calls).toEqual([[["invert"], ["lwlock", "quuxblat"], ["granite"]]]);
  });

  it.each(["/", "\\", "=", "+", "&", "%", "#", "*", "@", "-", "~", "^"])(
    "symbol %j between two words breaks the run",
    async (s) => {
      const calls: string[][][] = [];
      const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
      h.pipeline.onMessageEnd(userMsg(`lwlock ${s} quuxblat`));
      await drainNow(h);
      expect(calls).toEqual([[["lwlock"], ["quuxblat"]]]);
    },
  );

  it("digit runs and hexish tokens break the chain ACROSS them", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    // "v2" is gate-rejected (low entropy: H("v2") = 1.0 < 1.5 — since the
    // 2026 floor drop it is length-legal but entropy-killed) → pure gap
    // text → the run breaks.
    h.pipeline.onMessageEnd(userMsg("lwlock v2 quuxblat"));
    // "0f3a9c2" is hexish and ADMITS (rare) → it sits IN the run — but
    // only consecutive pairs bigram, so lwlock→quuxblat never happens.
    h.pipeline.onMessageEnd(userMsg("lwlock 0f3a9c2 quuxblat"));
    await drainNow(h);
    expect(calls).toEqual([
      [["lwlock"], ["quuxblat"]],
      [["lwlock", "0f3a9c2", "quuxblat"]],
    ]);
    h.store.recordBigramRuns([...calls[0]!, ...calls[1]!]);
    expect(h.store.topSuccessors("lwlock")).toEqual([
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
    // "of" rejects at ADMISSION (COMMON since the 2026 floor drop — the
    // shipped dictionary attests it at q=230) — its TEXT stays in the gap
    // and must break, never bridge: the PRD §06 h3.6 exemplar. Same
    // class: "the" (q=240).
    h.pipeline.onMessageEnd(userMsg("United States of America"));
    h.pipeline.onMessageEnd(userMsg("lwlock the quuxblat"));
    await drainNow(h);
    expect(calls).toEqual([
      [["united", "states"], ["america"]],
      [["lwlock"], ["quuxblat"]],
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
    // first message's line array produced the bridged bigram. ("the"
    // rejects at admission under the COMMON stub, as it does under the
    // shipped dictionary since the floor drop.)
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
    h.pipeline.onMessageEnd(userMsg("lwlock norias\ninvert granite"));
    h.pipeline.onMessageEnd(userMsg("lwlock\n\ninvert\n"));
    await drainNow(h);
    expect(calls).toEqual([
      [["lwlock", "norias"], ["invert", "granite"]],
      [["lwlock"], ["invert"]], // the blank line emits NO empty run
    ]);
  });

  it("a chunk boundary inside a whitespace gap still chains", async () => {
    const calls: string[][][] = [];
    // "lwlock" + 6 spaces + "quuxblat", sliced at 12: slice 1 ends exactly
    // at the gap's end ("lwlock      "), slice 2 starts at "quuxblat".
    const h = makePipeline({
      chunkBytes: 12,
      onAdmittedTokens: (runs) => calls.push(runs),
    });
    h.pipeline.onMessageEnd(userMsg("lwlock      quuxblat"));
    await drainNow(h);
    expect(h.counts.yields).toBe(2); // the boundary really happened
    expect(calls).toEqual([[["lwlock", "quuxblat"]]]); // gap carried → chains
    h.store.recordBigramRuns(calls[0]!);
    expect(h.store.topSuccessors("lwlock")).toEqual([
      { next: "quuxblat", count: 1 },
    ]);
  });

  it("a chunk boundary inside a punctuation gap still breaks", async () => {
    const calls: string[][][] = [];
    // "lwlock, quuxblat" sliced at 8: slice 1 ends mid-gap ("lwlock, ").
    // The comma must survive the carry (openTail) and break the run.
    const h = makePipeline({
      chunkBytes: 8,
      onAdmittedTokens: (runs) => calls.push(runs),
    });
    h.pipeline.onMessageEnd(userMsg("lwlock, quuxblat"));
    await drainNow(h);
    expect(h.counts.yields).toBe(2);
    expect(calls).toEqual([[["lwlock"], ["quuxblat"]]]);
  });

  it("a chunk boundary never breaks a run — only '\\n' does", async () => {
    const calls: string[][][] = [];
    // "lwlock norias invert" cut after each token (7-char slices): two
    // chunk boundaries, zero newlines — still ONE run with all words.
    const h = makePipeline({
      chunkBytes: 7,
      onAdmittedTokens: (runs) => calls.push(runs),
    });
    h.pipeline.onMessageEnd(userMsg("lwlock norias invert"));
    await drainNow(h);
    expect(h.counts.yields).toBe(3); // boundaries really happened
    expect(calls).toEqual([[["lwlock", "norias", "invert"]]]);
    // The pairs SPANNING the slice boundaries survive recording.
    h.store.recordBigramRuns(calls[0]!);
    expect(h.store.topSuccessors("norias")).toEqual([{ next: "invert", count: 1 }]);
    expect(h.store.topSuccessors("lwlock")).toEqual([{ next: "norias", count: 1 }]);
  });

  it("a chunk boundary INSIDE a token carries it whole (BUG-004): no junk half, bigram chains", async () => {
    const calls: string[][][] = [];
    // "lwlock Zorpwibble quuxblat" (26 chars) sliced at 12: the seam at
    // offset 12 falls inside "Zorpwibble" ("Zorpw" | "ibble"). Slice 1
    // carries "Zorpw"; slice 2 processes "Zorpwibble " whole; slice 2
    // carries "quuxbla"; the final slice carries nothing and admits
    // "quuxblat" ("quuxbla" + "at" reassembled). chunkBytes 12 keeps a
    // non-class char in every raw slice, so no slice degenerates to a
    // whole-raw class run (the documented >1KB degradation path).
    const h = makePipeline({
      chunkBytes: 12,
      onAdmittedTokens: (runs) => calls.push(runs),
    });
    h.pipeline.onMessageEnd(userMsg("lwlock Zorpwibble quuxblat"));
    await drainNow(h);
    expect(h.counts.yields).toBe(3); // one yield per slice, carry or not
    // The straddled token is admitted WHOLE; neither half exists.
    expect(h.store.get("zorpwibble")).toBeDefined();
    expect(h.store.get("ibble")).toBeUndefined();
    expect(h.store.get("zorpw")).toBeUndefined();
    // The run stitched across the boundary → the bigram forms.
    expect(calls).toEqual([[["lwlock", "zorpwibble", "quuxblat"]]]);
    h.store.recordBigramRuns(calls[0]!);
    expect(h.store.topSuccessors("zorpwibble")).toEqual([
      { next: "quuxblat", count: 1 },
    ]);
  });

  it("repeated runs double the successor count", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(userMsg("lwlock norias"));
    h.pipeline.onMessageEnd(userMsg("lwlock norias"));
    await drainNow(h);
    expect(calls).toEqual([[["lwlock", "norias"]], [["lwlock", "norias"]]]);
    h.store.recordBigramRuns(calls[0]!);
    h.store.recordBigramRuns(calls[1]!);
    expect(h.store.topSuccessors("lwlock")).toEqual([{ next: "norias", count: 2 }]);
  });

  it("sub-words never enter runs — only whole-token keys", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    // Whole "contextlwlock" is COMMON → admission reject; its admitted
    // subwords ("context", "lwlock") are subword drafts — excluded.
    h.pipeline.onMessageEnd(userMsg("contextLwlock standalone"));
    await drainNow(h);
    expect(calls).toEqual([[["standalone"]]]);
    // Subwords DID reach the word store (established §04 behavior; the
    // "context" subword is COMMON → admission reject there)…
    expect(h.store.get("lwlock")).toBeDefined();
    expect(h.store.get("standalone")).toBeDefined();
  });

  it("multi-block messages produce runs per line (extractText joins with '\\n')", async () => {
    const calls: string[][][] = [];
    const h = makePipeline({ onAdmittedTokens: (runs) => calls.push(runs) });
    h.pipeline.onMessageEnd(
      userMsg([
        { type: "text", text: "lwlock norias" },
        { type: "text", text: "invert" },
      ]),
    );
    await drainNow(h);
    expect(calls).toEqual([[["lwlock", "norias"], ["invert"]]]);
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

// --- parent-secret propagation (BUG-003 layer 2, PRD h3.5) -------------------

/**
 * A whole token rejected with reason 'secret' must poison its sub-word
 * drafts: camelCase/snake_case fragments of a pasted secret are short and
 * letter-heavy and defeat isSecretShaped's token-level rules on their own
 * gate ("cy" → "CYEXAMPLEKEY" was the leak). Vectors verified non-vacuous
 * against maskSecrets + tokenize: the 38-char AWS repro is MASKED by S1's
 * BARE_RUN_MIN = 32 layer and never reaches the gate (kept as the PRD
 * contract pin), while the ghp_ vector below survives masking, its whole
 * token is secret-rejected AT the gate, and every sub-word passes its own
 * gate pre-fix (empirically checked — the PRP's literal AbCdEfGhIjKlMn
 * payload has no ≥4-char sub-words and would make the case vacuous).
 */
describe("parent-secret propagation to sub-words (BUG-003 residue, PRD h3.5)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("PRD repro: the masked 38-char AWS secret stores none of its fragments", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(
      userMsg("password wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY trailing"),
    );
    await drainNow(h);
    // No fragment of the secret exists anywhere — the run is blanked by
    // maskSecrets (layer 1) before tokenize, so nothing reaches the gate.
    for (const leak of [
      "jalr",
      "femik7",
      "mden",
      "cyexamplekey",
      "wjalrxutnfemik7mdengbpxrficyexamplekey",
    ]) {
      expect(h.store.get(leak)).toBeUndefined();
    }
    expect(rankMatches(h.store, "cy")).toEqual([]); // provider-equivalent
    // Layer-1 pin: the secret never even reached the gate.
    expect(h.pipeline.getStats().rejectedByGate.secret).toBe(0);
    // Positive control: prose words of the same message admit.
    expect(h.store.get("password")).toBeDefined();
    expect(h.store.get("trailing")).toBeDefined();
  });

  it("layer 2: a gate-reaching ghp_ whole token poisons every sub-word draft", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(userMsg("gate ghp_AbcdEfghIjklmnop done"));
    await drainNow(h);
    // Whole token secret-rejected AT the gate; each camelCase sub-word
    // (all gate-clean on their own — verified) inherits the verdict.
    expect(h.store.get("ghp_abcdefghijklmnop")).toBeUndefined();
    for (const frag of ["abcd", "efgh", "ijklmnop"]) {
      expect(h.store.get(frag)).toBeUndefined();
    }
    expect(rankMatches(h.store, "ij")).toEqual([]); // provider-equivalent
    // Exactly 1 whole + 3 poisoned sub-words in the EXISTING secret
    // bucket (via #replayAdmitMemo's !gate.ok branch — no new field).
    expect(h.pipeline.getStats().rejectedByGate.secret).toBe(4);
    // Positive control: prose words of the same message admit.
    expect(h.store.get("gate")).toBeDefined();
    expect(h.store.get("done")).toBeDefined();
  });

  it("memoized replay: the same secret text twice doubles the secret counter", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(userMsg("gate ghp_AbcdEfghIjklmnop done"));
    h.pipeline.onMessageEnd(userMsg("gate ghp_AbcdEfghIjklmnop done"));
    await drainNow(h);
    // 4 secret rejects per occurrence (1 whole + 3 poisoned subs); the
    // memo is computed once per distinct token and replayed per
    // occurrence, so the count doubles — never re-computed, never lost.
    expect(h.pipeline.getStats().rejectedByGate.secret).toBe(8);
    for (const frag of ["abcd", "efgh", "ijklmnop"]) {
      expect(h.store.get(frag)).toBeUndefined();
    }
  });

  it("regression: sub-words of a gate-PASSING parent still admit", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(userMsg("ZendeskLwlockTool"));
    await drainNow(h);
    expect(h.store.get("zendesklwlocktool")).toBeDefined();
    expect(h.store.get("zendesk")).toBeDefined();
    expect(h.store.get("lwlock")).toBeDefined();
    expect(h.store.get("tool")).toBeDefined();
  });

  it("non-propagation: a consonantRun whole-token reject does NOT poison gate-clean sub-words", async () => {
    const h = makePipeline();
    h.pipeline.onMessageEnd(userMsg("qqqxxxzzzvvvWord"));
    await drainNow(h);
    // The parent (and its noise-shaped sub "qqqxxxzzzvvv") die at their
    // own gates for consonantRun — but "word" is gate-clean and must
    // still admit independently: only 'secret' propagates (§04).
    expect(h.store.get("qqqxxxzzzvvvword")).toBeUndefined();
    expect(h.store.get("qqqxxxzzzvvv")).toBeUndefined();
    expect(h.store.get("word")).toBeDefined();
    const stats = h.pipeline.getStats();
    expect(stats.rejectedByGate.consonantRun).toBe(2);
    expect(stats.rejectedByGate.secret).toBe(0);
  });
});

describe("trailing-'_' literals store once — no duplicate candidates (BUG-002, PRD h3.1)", () => {
  it("processText('rename FOO_1_ and USER_2_TOKEN_ constants') stores foo_1_/user_2_token_ and NOT the trimmed twins; rankMatches offers exactly one candidate per probe", async () => {
    const h = makePipeline();
    await h.pipeline.processText("rename FOO_1_ and USER_2_TOKEN_ constants", true);

    // Store level: the whole identifier (with trailing '_') is the token;
    // the trimmed literal fork must never become a candidate. (S1's fix —
    // the containment defer in tokenize's literal pass, pinned at the
    // segment level in test/segment.test.ts "trailing-'_' trim defers to
    // the containing base token" — this is the ingest→store seam.)
    expect(h.store.get("foo_1_")).toBeDefined();
    expect(h.store.get("foo_1")).toBeUndefined();
    expect(h.store.get("user_2_token_")).toBeDefined();
    expect(h.store.get("user_2_token")).toBeUndefined();

    // Menu level (the user-visible symptom): one completion target, not
    // ['FOO_1','FOO_1_']. Pre-fix both keys stored → both offered (plural
    // pruning covers only key+'s' pairs — query.ts:553-565 — never '_'),
    // so ranking can never rescue this class; admission must never see
    // both tokens (r2-tokenizer-overlap.md Claim 2 repro).
    const fooMatches = rankMatches(h.store, "foo_");
    expect(fooMatches.map((m) => m.key)).toEqual(["foo_1_"]);
    expect(fooMatches[0]!.display).toBe("FOO_1_"); // single sighting → as-typed casing

    const userMatches = rankMatches(h.store, "user_2");
    expect(userMatches.map((m) => m.key)).toEqual(["user_2_token_"]);
    expect(userMatches[0]!.display).toBe("USER_2_TOKEN_");
  });
});
