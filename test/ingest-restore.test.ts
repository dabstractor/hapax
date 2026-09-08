/**
 * PRD §05 session-restore suite (P1.M3.T2.S3): restoreFromHistory replays
 * stored history oldest → newest through the IDENTICAL ingestion pipeline
 * (h2.31/h2.33 — same gates, counters, eviction; never special-cased).
 * Acceptance-critical property is ORDERING: getBranch() arrives leaf→root
 * and must be reversed (from a copy — pi's array is never mutated); the
 * getEntries() fallback is already oldest→newest and must NOT be reversed.
 * Also verified: type==="message" filtering, null-extraction skips,
 * fromUser mapping, synchronous void return, and fire-and-forget error
 * containment (a rejecting processText must never surface as an unhandled
 * rejection nor abort the remaining replay). P1.M3.T1.S2 (BUG-004) adds
 * the abort contract: an optional shouldAbort predicate polled at the top
 * of the replay loop, wired by the factory to the sticky dictionary-
 * failure flag, proven here with fakes AND a real pipeline + real lazy
 * dictionary on a nonexistent path.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { rankMatches } from "../src/core/query.js";
import { CandidateStore } from "../src/core/store.js";
import type { Dictionary } from "../src/core/types.js";
import {
  IngestPipeline,
  restoreFromHistory,
  type AgentMessage,
  type RestoreSessionManager,
} from "../src/pi/ingest.js";
import { createLazyDictionary } from "../src/pi/index.js";

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

const text = (s: string) => ({ type: "text", text: s }) as const;

// --- entry fixtures (session-format.md shapes) -------------------------------

/** A message entry; ids are explicit so ordering assertions read clearly. */
const msgEntry = (
  id: string,
  parentId: string | null,
  message: AgentMessage,
): SessionEntry => ({
  type: "message",
  id,
  parentId,
  timestamp: "2025-01-01T00:00:00.000Z",
  message,
});

const compactionEntry = (id: string): SessionEntry => ({
  type: "compaction",
  id,
  parentId: null,
  timestamp: "2025-01-01T00:00:00.000Z",
  summary: "earlier work summarized",
  firstKeptEntryId: "e1",
  tokensBefore: 1000,
});

const modelChangeEntry = (id: string): SessionEntry => ({
  type: "model_change",
  id,
  parentId: null,
  timestamp: "2025-01-01T00:00:00.000Z",
  provider: "anthropic",
  modelId: "test-model",
});

const branchSummaryEntry = (id: string): SessionEntry => ({
  type: "branch_summary",
  id,
  parentId: null,
  timestamp: "2025-01-01T00:00:00.000Z",
  fromId: "e2",
  summary: "branched from earlier work",
});

// The "session" header line is not a SessionEntryBase and (depending on pi
// version) can surface in getEntries() output — SessionHeader is not part of
// the SessionEntry union, so the fixture casts; the point under test is that
// the type==="message" filter passes over it without choking.
const headerEntry = {
  type: "session",
  id: "hdr",
  timestamp: "2025-01-01T00:00:00.000Z",
  cwd: "/tmp/hapax",
  version: 3,
} as unknown as SessionEntry;

/** Canonical three-message history e1 → e2 → e3 (user/assistant/user). */
const e1 = msgEntry("e1", null, userMsg("alpha"));
const e2 = msgEntry("e2", "e1", assistantMsg([text("beta one"), text("beta two")]));
const e3 = msgEntry("e3", "e2", userMsg("gamma"));

// --- fake session manager + recording pipeline -------------------------------

interface FakeSmOptions {
  /** readonly tolerated so the frozen-array non-mutation fixture type-checks */
  branch?: readonly SessionEntry[];
  entries?: SessionEntry[];
  branchThrows?: boolean;
  entriesThrows?: boolean;
}

const fakeSm = (opts: FakeSmOptions = {}) => ({
  getBranch: vi.fn((): SessionEntry[] => {
    if (opts.branchThrows) throw new Error("branch unavailable");
    return (opts.branch ?? []) as SessionEntry[];
  }),
  getEntries: vi.fn(() => {
    if (opts.entriesThrows) throw new Error("entries unavailable");
    return opts.entries ?? [];
  }),
});

/** Pipeline double satisfying Pick<IngestPipeline, "processText" |
 *  "sweepPhrases"> (BUG-006) that records (text, fromUser) in exact call
 *  order plus every tail-sweep call. */
const fakePipeline = () => {
  const calls: { text: string; fromUser: boolean }[] = [];
  return {
    calls,
    processText: vi.fn(async (text: string, fromUser: boolean) => {
      calls.push({ text, fromUser });
    }),
    sweepPhrases: vi.fn(),
  };
};

/** Flush background work until `probe` holds (restore is fire-and-forget). */
const settle = async (
  probe: () => void,
): Promise<void> => vi.waitFor(probe);

describe("restoreFromHistory — PRD §05 h2.31/h2.33", () => {
  describe("branch replay ordering (acceptance-critical)", () => {
    it("replays getBranch() reversed: leaf→root becomes oldest→newest", async () => {
      const sm = fakeSm({ branch: [e3, e2, e1] }); // leaf → root
      const pipe = fakePipeline();
      restoreFromHistory(pipe, sm);
      await settle(() => expect(pipe.calls).toHaveLength(3));
      expect(pipe.calls.map((c) => c.text)).toEqual([
        "alpha",
        "beta one\nbeta two",
        "gamma",
      ]);
      // exactly one processText per message, in order, nothing else
      expect(pipe.processText).toHaveBeenCalledTimes(3);
      // non-empty branch → the entries fallback is never consulted
      expect(sm.getEntries).not.toHaveBeenCalled();
    });

    it("never mutates the array returned by getBranch (copy before reverse)", async () => {
      const branch = Object.freeze([e3, e2, e1]);
      // An in-place .reverse() on this frozen array would throw, forcing the
      // (wrong) getEntries fallback — so success below proves copy-first.
      const sm = fakeSm({ branch });
      const pipe = fakePipeline();
      restoreFromHistory(pipe, sm);
      await settle(() => expect(pipe.calls).toHaveLength(3));
      expect(pipe.calls.map((c) => c.text)).toEqual(["alpha", "beta one\nbeta two", "gamma"]);
      expect(sm.getEntries).not.toHaveBeenCalled();
    });

    it("maps roles: user message → fromUser true, assistant → false", async () => {
      const sm = fakeSm({ branch: [e3, e2, e1] });
      const pipe = fakePipeline();
      restoreFromHistory(pipe, sm);
      await settle(() => expect(pipe.calls).toHaveLength(3));
      expect(pipe.calls).toEqual([
        { text: "alpha", fromUser: true },
        { text: "beta one\nbeta two", fromUser: false },
        { text: "gamma", fromUser: true },
      ]);
    });

    it("skips non-message entries interleaved in the branch (branch_summary, compaction, model_change)", async () => {
      const branch: SessionEntry[] = [
        e3,
        branchSummaryEntry("bs1"),
        e2,
        modelChangeEntry("mc1"),
        compactionEntry("c1"),
        e1,
      ];
      const sm = fakeSm({ branch });
      const pipe = fakePipeline();
      restoreFromHistory(pipe, sm);
      await settle(() => expect(pipe.calls).toHaveLength(3));
      expect(pipe.calls.map((c) => c.text)).toEqual(["alpha", "beta one\nbeta two", "gamma"]);
    });
  });

  describe("getEntries fallback", () => {
    it("empty branch → getEntries() replayed in its own order (NOT reversed)", async () => {
      const entries = [e1, e2, e3]; // already oldest → newest
      const sm = fakeSm({ branch: [], entries });
      const pipe = fakePipeline();
      restoreFromHistory(pipe, sm);
      await settle(() => expect(pipe.calls).toHaveLength(3));
      expect(pipe.calls.map((c) => c.text)).toEqual([
        "alpha",
        "beta one\nbeta two",
        "gamma",
      ]);
      expect(sm.getEntries).toHaveBeenCalledTimes(1);
    });

    it("throwing getBranch() falls back to getEntries()", async () => {
      const sm = fakeSm({ branchThrows: true, entries: [e1, e2, e3] });
      const pipe = fakePipeline();
      restoreFromHistory(pipe, sm);
      await settle(() => expect(pipe.calls).toHaveLength(3));
      expect(pipe.calls.map((c) => c.text)).toEqual([
        "alpha",
        "beta one\nbeta two",
        "gamma",
      ]);
    });
  });

  describe("no-op cases", () => {
    it("empty branch and empty entries → no processText calls, no throw", async () => {
      const sm = fakeSm({ branch: [], entries: [] });
      const pipe = fakePipeline();
      expect(() => restoreFromHistory(pipe, sm)).not.toThrow();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(pipe.processText).not.toHaveBeenCalled();
    });

    it("getBranch and getEntries both throw → clean no-op", async () => {
      const sm = fakeSm({ branchThrows: true, entriesThrows: true });
      const pipe = fakePipeline();
      expect(() => restoreFromHistory(pipe, sm)).not.toThrow();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(pipe.processText).not.toHaveBeenCalled();
    });

    it("entries with zero message-type entries (header first, then metadata) → no calls", async () => {
      const sm = fakeSm({
        branch: [],
        entries: [
          headerEntry,
          compactionEntry("c1"),
          modelChangeEntry("mc1"),
          branchSummaryEntry("bs1"),
        ],
      });
      const pipe = fakePipeline();
      restoreFromHistory(pipe, sm);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(pipe.processText).not.toHaveBeenCalled();
    });

    it("messages extracting to null (toolResult, assistant thinking/toolCall-only) are skipped", async () => {
      const entries = [
        msgEntry("e1", null, toolResultMsg()),
        e2, // "beta one\nbeta two" — the only ingestable message
        msgEntry(
          "e3",
          "e2",
          assistantMsg([
            { type: "thinking", thinking: "SECRET-THINKING" },
            { type: "toolCall", id: "t1", name: "read", arguments: {} },
          ]),
        ),
      ];
      const sm = fakeSm({ branch: [], entries });
      const pipe = fakePipeline();
      restoreFromHistory(pipe, sm);
      await settle(() => expect(pipe.calls).toHaveLength(1));
      expect(pipe.calls).toEqual([{ text: "beta one\nbeta two", fromUser: false }]);
      expect(JSON.stringify(pipe.calls)).not.toContain("SECRET");
    });
  });

  describe("fire-and-forget background semantics", () => {
    it("returns undefined synchronously; the gated replay still completes", async () => {
      const sm = fakeSm({ branch: [e3, e2, e1] });
      const calls: string[] = [];
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      // First call parks on the gate — proving restoreFromHistory returned
      // BEFORE the background work finished (and before its first push).
      const processText = vi.fn(async (text: string) => {
        if (calls.length === 0) await gate;
        calls.push(text);
      });
      const result = restoreFromHistory({ processText, sweepPhrases: () => {} }, sm);
      expect(result).toBeUndefined(); // void — never a promise
      expect(calls).toEqual([]); // first message still in flight
      release();
      await settle(() => expect(calls).toEqual(["alpha", "beta one\nbeta two", "gamma"]));
    });

    it("a rejecting processText is contained: remaining entries replay, no unhandled rejection", async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const sm = fakeSm({ branch: [e3, e2, e1] }); // replay order e1→e2→e3
        const seen: string[] = [];
        let n = 0;
        const processText = vi.fn(async (text: string) => {
          n += 1;
          if (n === 2) throw new Error("boom mid-replay"); // e2 fails
          seen.push(text);
        });
        restoreFromHistory({ processText, sweepPhrases: () => {} }, sm);
        await settle(() => expect(n).toBe(3)); // e3 was still attempted
        expect(seen).toEqual(["alpha", "gamma"]); // per-entry catch continued
        // let any stray rejection surface on the macrotask queue
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(unhandled).toEqual([]); // nothing escaped the void promise
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });
  });
});

describe("restoreFromHistory — dictionary-failure abort (BUG-004)", () => {
  it("aborts replay when the predicate flips mid-replay → only the first entry replays", async () => {
    const sm = fakeSm({ branch: [e3, e2, e1] });
    const calls: { text: string; fromUser: boolean }[] = [];
    // The factory shape: `disabled` is false at session_start and flips
    // DURING the replay (first lookup triggers the failed load) — so the
    // loop must RE-POLL the predicate per entry, not consult it once.
    let disabled = false;
    const processText = vi.fn(async (text: string, fromUser: boolean) => {
      calls.push({ text, fromUser });
      disabled = true; // "dictionary died" after the first message
    });
    const sweepPhrases = vi.fn();
    restoreFromHistory({ processText, sweepPhrases }, sm, () => disabled);
    await settle(() => expect(calls).toHaveLength(1));
    // Drain the macrotask queue: the replay must have RETURNED at the top
    // of entry 2 — a `continue` here would keep scanning and replaying.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls.map((c) => c.text)).toEqual(["alpha"]);
    // BUG-006 work-item contract: an ABORTED replay must never sweep —
    // the store was never fully populated, so the "40 subsequent
    // ordinals" of the partial history never accrued.
    expect(sweepPhrases).not.toHaveBeenCalled();
  });

  it("predicate true before the first entry → zero processText calls", async () => {
    const sm = fakeSm({ branch: [e3, e2, e1] });
    const pipe = fakePipeline();
    restoreFromHistory(pipe, sm, () => true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pipe.processText).not.toHaveBeenCalled();
    expect(pipe.calls).toEqual([]);
  });

  it("no predicate → unchanged two-arg behavior (regression guard)", async () => {
    const sm = fakeSm({ branch: [e3, e2, e1] });
    const pipe = fakePipeline();
    restoreFromHistory(pipe, sm);
    await settle(() => expect(pipe.calls).toHaveLength(3));
    expect(pipe.calls.map((c) => c.text)).toEqual([
      "alpha",
      "beta one\nbeta two",
      "gamma",
    ]);
  });

  it("real pipeline + bad dict, failure observed before the replay: ZERO candidates, notify once", async () => {
    const onError = vi.fn();
    const dict = createLazyDictionary(
      "/nonexistent/hapax-test-dict.bin",
      onError,
    );
    const store = new CandidateStore();
    const pipeline = new IngestPipeline({
      store,
      dictionary: dict,
      // Mirrors the factory wiring (P1.M3.T1.S1): sticky failure flag →
      // admission gate.
      isDisabled: () => dict.failed === true,
      yieldFn: async () => {},
    });
    const m1 = msgEntry("m1", null, userMsg("with this that them"));
    const m2 = msgEntry("m2", "m1", userMsg("with another go here"));
    const sm = fakeSm({ branch: [m2, m1] }); // leaf → root

    // Observe the failure BEFORE the replay (the very first lookup
    // triggers the load) — the established "zero after the failure is
    // observed" pattern from the S1 suite (test/bad-dict-gate.test.ts).
    // The warmup fires onLoadError once; the replay must not re-fire it.
    expect(dict.lookup("warmup")).toBeNull();
    expect(dict.failed).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);

    // Same closure shape as the factory: live flag, not a stale value.
    restoreFromHistory(pipeline, sm, () => dict.failed === true);

    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    // The predicate was true at the TOP of the loop → the replay never
    // reached the first entry: strictly nothing admitted, no ordinals
    // beyond the warmup, no stats movement.
    expect(pipeline.getStats().wordsSeen).toBe(0);
    expect(pipeline.getStats().admitted).toBe(0);
    expect(store.size).toBe(0);
    expect(store.get("with")).toBeUndefined();
    expect(rankMatches(store, "with")).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1); // notify-once preserved
  });

  it("real pipeline + bad dict, failure observed mid-replay (factory timing): replay stops after the first message", async () => {
    const onError = vi.fn();
    const dict = createLazyDictionary(
      "/nonexistent/hapax-test-dict.bin",
      onError,
    );
    const store = new CandidateStore();
    const pipeline = new IngestPipeline({
      store,
      dictionary: dict,
      isDisabled: () => dict.failed === true,
      yieldFn: async () => {},
    });
    const processTextSpy = vi.spyOn(pipeline, "processText");
    const m1 = msgEntry("m1", null, userMsg("with this that them"));
    const m2 = msgEntry("m2", "m1", userMsg("with another go here"));
    const sm = fakeSm({ branch: [m2, m1] }); // leaf → root

    // No warmup — the factory's real timing: at session_start the lazy
    // dict has NOT loaded, so message 1's first lookup triggers the
    // failed load mid-replay.
    restoreFromHistory(pipeline, sm, () => dict.failed === true);

    await settle(() => expect(onError).toHaveBeenCalledTimes(1));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(onError).toHaveBeenCalledTimes(1); // notify-once preserved
    // The abort gate owns every entry AFTER the failure: exactly ONE
    // processText (message 1) — message 2 never replays.
    expect(processTextSpy).toHaveBeenCalledTimes(1);
    // The in-flight message itself is owned by the pipeline's per-segment
    // S1 gate (pinned identically by test/bad-dict-gate.test.ts's
    // mid-message contract): only the trigger token ("with", whose lookup
    // observed the failed load) got through; its siblings and every word
    // of message 2 are blocked.
    expect(store.size).toBe(1);
    expect(store.get("with")).toBeDefined();
    expect(store.get("this")).toBeUndefined();
    expect(store.get("another")).toBeUndefined();
    expect(store.get("here")).toBeUndefined();
  });
});
// ── Demotion tail sweep (BUG-006, P1.M3.T2.S1) ──────────────────────────────

/** All-rare dictionary: every lookup is null → every admitted word is
 *  rankGroup 0 (dictionary-absent) → all-rare n-grams pass the fast path
 *  (PRD §06 h3.7). Self-contained; deliberately NOT the pipeline suite's
 *  stubDict (its COMMON/MIDFREQ words would block the fast path). */
const rareDict = (): Dictionary => ({
  lookup: () => null,
  version: 1,
  entryCount: 0,
});

/** Production-shaped harness (mirrors test/perf-gates.test.ts gate e):
 *  real pipeline + real store with onAdmittedTokens/onSweepPhrases wired
 *  to the store exactly like src/pi/index.ts's session_start. The sweeps
 *  counter makes the tail sweep an observable completion probe. */
const makePhrasePipeline = () => {
  const store = new CandidateStore();
  let sweeps = 0;
  const pipeline = new IngestPipeline({
    store,
    dictionary: rareDict(),
    yieldFn: async () => {},
    onAdmittedTokens: (lines) =>
      store.recordPhraseLines(lines, store.currentOrdinal()),
    onSweepPhrases: () => {
      sweeps++;
      store.sweepPhraseDemotions();
    },
  });
  return { pipeline, store, sweeps: () => sweeps };
};

const FILLER = "filler zephyr quartz vortex";
// Control phrase rides two of the filler messages: first sight fast-path
// admits it, second sight reaches count ≥ 2 → sticky → NEVER demoted.
const CONTROL = "darla voss zephyr quartz vortex";

describe("restoreFromHistory — demotion tail sweep (BUG-006, P1.M3.T2.S1)", () => {
  it("runs exactly one sweepPhrases at the tail of a completed replay", async () => {
    const sm = fakeSm({ branch: [e3, e2, e1] });
    const pipe = fakePipeline();
    restoreFromHistory(pipe, sm);
    await settle(() => expect(pipe.calls).toHaveLength(3));
    expect(pipe.sweepPhrases).toHaveBeenCalledTimes(1); // once per replay
  });

  it("aborted replay (predicate true up front) skips the tail sweep", async () => {
    const sm = fakeSm({ branch: [e3, e2, e1] });
    const pipe = fakePipeline();
    restoreFromHistory(pipe, sm, () => true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pipe.processText).not.toHaveBeenCalled();
    expect(pipe.sweepPhrases).not.toHaveBeenCalled();
  });

  it("empty history completes normally → exactly one (no-op) tail sweep", async () => {
    // Documented semantics: empty history "completes normally", so the
    // tail sweep runs — a harmless no-op on an empty store (see
    // restoreFromHistory's JSDoc demotion-tail paragraph).
    const sm = fakeSm({ branch: [], entries: [] });
    const pipe = fakePipeline();
    restoreFromHistory(pipe, sm);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pipe.processText).not.toHaveBeenCalled();
    expect(pipe.sweepPhrases).toHaveBeenCalledTimes(1);
  });

  it("a throwing sweep hook never surfaces as an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const store = new CandidateStore();
      const pipeline = new IngestPipeline({
        store,
        dictionary: rareDict(),
        yieldFn: async () => {},
        onSweepPhrases: () => {
          throw new Error("sweep boom");
        },
      });
      const sm = fakeSm({
        branch: [msgEntry("m1", null, userMsg("zephyr quartz"))],
      });
      restoreFromHistory(pipeline, sm);
      // The replay itself completed (the hook only throws at the tail)…
      await settle(() => expect(store.size).toBeGreaterThan(0));
      // …and the tail sweep's swallowed throw never escaped the
      // fire-and-forget IIFE (vitest fails this test on unhandled
      // rejections; the macrotask drains let any stray one surface).
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("BUG-006 — demotion cadence after restore replay (PRD §06 h3.7 repro)", () => {
  /** PRD repro step 1: the LIVE path admits "zorblat quuxified mumblewords"
   *  — all three words are rare (null lookups) → both bigrams (and the
   *  trigram) fast-path admit as candidates at store ordinal 1. */
  const admitZorblatPhrases = async (
    h: ReturnType<typeof makePhrasePipeline>,
  ): Promise<void> => {
    h.pipeline.onMessageEnd(userMsg("zorblat quuxified mumblewords"));
    await h.pipeline.flush(); // live path: drain → once-per-flush sweep
    // (that sweep is a no-op here: ordinal 1 − firstSeen 1 = 0 < 40)
    const keys = h.store.phraseCandidateKeys();
    expect(keys).toContain("zorblat quuxified");
    expect(keys).toContain("quuxified mumblewords");
    expect(h.store.isFastPathPhrase("zorblat quuxified")).toBe(true);
    expect(h.store.isFastPathPhrase("quuxified mumblewords")).toBe(true);
  };

  it("PRD repro: 45 direct processText calls leave the phrases stale; public sweepPhrases() demotes them", async () => {
    const h = makePhrasePipeline();
    await admitZorblatPhrases(h);

    // Steps 2–3: restore-style DIRECT processText calls — no queue, no
    // drain, no once-per-flush sweep. 45 messages = ordinals 2..46; the
    // control phrase repeats in two of them (count ≥ 2 → confirmed).
    for (let i = 1; i <= 45; i++) {
      await h.pipeline.processText(
        i === 5 || i === 6 ? CONTROL : FILLER,
        true,
      );
    }

    // The bug's precondition, verbatim: WITHOUT a sweep the stale
    // candidates survive 45 subsequent ordinals (46 − 1 = 45 ≥ 40 by now).
    expect(h.store.isFastPathPhrase("zorblat quuxified")).toBe(true);
    expect(h.store.phraseCandidateKeys()).toContain("zorblat quuxified");
    expect(h.store.phraseCandidateKeys()).toContain("quuxified mumblewords");

    // Step 4: the fix's public seam, invoked exactly as the restore tail.
    h.pipeline.sweepPhrases();

    // Step 5: demoted — candidacy + fast-path provenance gone for the
    // one-shot phrases (counts/ordinals kept for later re-promotion).
    const keys = h.store.phraseCandidateKeys();
    expect(keys).not.toContain("zorblat quuxified");
    expect(keys).not.toContain("quuxified mumblewords");
    expect(keys).not.toContain("zorblat quuxified mumblewords"); // trigram too
    expect(h.store.isFastPathPhrase("zorblat quuxified")).toBe(false);
    expect(h.store.getPhrase("zorblat quuxified")).toBeDefined(); // count kept
    // Control: the repetition-confirmed (count ≥ 2, sticky) phrase survives.
    expect(keys).toContain("darla voss");
    expect(h.store.getPhrase("darla voss")!.count).toBe(2);
  });

  it("end to end: restoreFromHistory's own tail sweep demotes stale phrases after a 45-message replay", async () => {
    const h = makePhrasePipeline();
    await admitZorblatPhrases(h);

    // The 45 filler messages replayed by the REAL restore path — each is
    // one awaited processText (ordinals 2..46), the control phrase rides
    // entries 5 and 6, and the TAIL sweep fires once after the loop.
    const fillers: SessionEntry[] = [];
    for (let i = 1; i <= 45; i++) {
      fillers.push(
        msgEntry(
          `f${i}`,
          i === 1 ? null : `f${i - 1}`,
          userMsg(i === 5 || i === 6 ? CONTROL : FILLER),
        ),
      );
    }
    const sm = fakeSm({ branch: [], entries: fillers }); // oldest → newest
    restoreFromHistory(h.pipeline, sm);

    // Deterministic completion probe: the tail sweep is the LAST thing
    // the replay does, and the live flush above already spent sweep #1.
    await settle(() => expect(h.sweeps()).toBe(2));
    expect(h.store.currentOrdinal()).toBe(46); // 1 + 45 replayed messages

    const keys = h.store.phraseCandidateKeys();
    expect(keys).not.toContain("zorblat quuxified");
    expect(keys).not.toContain("quuxified mumblewords");
    expect(h.store.isFastPathPhrase("zorblat quuxified")).toBe(false);
    expect(keys).toContain("darla voss"); // count ≥ 2 control survives
  });
});
