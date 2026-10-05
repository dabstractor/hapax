/**
 * PRD §05 ingestion filter suite (P1.M3.T2.S1): extractText maps finalized
 * AgentMessages to ingestable text — user prompt text (string content or text
 * blocks, images silently skipped), assistant text blocks only (thinking and
 * toolCall blocks are not agent output to the user; toolResult/custom roles
 * are ignored). Zero text parts → null (never ""). Purity is verified with
 * deep-frozen inputs: any mutation attempt throws in strict mode.
 */

import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { extractText, type AgentMessage } from "../src/pi/ingest.js";
import { IngestPipeline, type RunMember } from "../src/pi/ingest.js";
import { CandidateStore } from "../src/core/store.js";
import type { Dictionary } from "../src/core/types.js";

// --- fixture helpers: minimal valid pi messages (contextually typed) -------

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

const text = (s: string) => ({ type: "text", text: s }) as const;

describe("extractText — PRD §05 event contract (P1.M3.T2.S1)", () => {
  it("user string content → the string itself", () => {
    expect(extractText(userMsg("fix the state machine"))).toBe(
      "fix the state machine",
    );
  });

  it("user empty string content → \"\" (faithful; pipeline may drop it)", () => {
    expect(extractText(userMsg(""))).toBe("");
  });

  it("user [text, image, text] → texts joined with \\n, images skipped", () => {
    expect(
      extractText(
        userMsg([
          text("first"),
          { type: "image", data: "Zm9v", mimeType: "image/png" },
          text("second"),
        ]),
      ),
    ).toBe("first\nsecond");
  });

  it("user images-only array → null (zero text parts, never \"\")", () => {
    expect(
      extractText(
        userMsg([{ type: "image", data: "Zm9v", mimeType: "image/png" }]),
      ),
    ).toBeNull();
  });

  it("user [] → null (zero text parts)", () => {
    expect(extractText(userMsg([]))).toBeNull();
  });

  it("user parts join with \\n even when a part is the empty string", () => {
    expect(extractText(userMsg([text(""), text("b")]))).toBe("\nb");
  });

  it("assistant [text, thinking, toolCall, text] → texts joined; bodies absent", () => {
    const out = extractText(
      assistantMsg([
        text("answer one"),
        { type: "thinking", thinking: "SECRET-THINKING" },
        {
          type: "toolCall",
          id: "t1",
          name: "read",
          arguments: { path: "SECRET-ARGS" },
        },
        text("answer two"),
      ]),
    );
    expect(out).toBe("answer one\nanswer two");
    expect(out).not.toContain("SECRET-THINKING");
    expect(out).not.toContain("SECRET-ARGS");
  });

  it("assistant thinking+toolCall only → null (never \"\")", () => {
    expect(
      extractText(
        assistantMsg([
          { type: "thinking", thinking: "hmm" },
          { type: "toolCall", id: "t1", name: "read", arguments: {} },
        ]),
      ),
    ).toBeNull();
  });

  it("assistant [] → null (zero text parts)", () => {
    expect(extractText(assistantMsg([]))).toBeNull();
  });

  it("assistant text with markdown code fences → returned verbatim", () => {
    const fenced = "```ts\nconst x = 1;\n```";
    expect(extractText(assistantMsg([text(fenced)]))).toBe(fenced);
  });

  it("toolResult → null (generated-or-ingested content, not fair game)", () => {
    expect(extractText(toolResultMsg())).toBeNull();
  });

  it("custom role (e.g. system) → null, never throws", () => {
    const custom = { role: "system", content: "ignored" } as unknown as AgentMessage;
    expect(extractText(custom)).toBeNull();
  });

  it("purity: deep-frozen messages → no throw, correct output (non-mutation)", () => {
    // Any write to a frozen object throws a TypeError in strict mode (ESM),
    // so completing without throwing proves extractText never mutates input.
    const frozenUser = deepFreeze(userMsg([text("a"), text("b")]));
    expect(extractText(frozenUser)).toBe("a\nb");
    expect(Object.isFrozen(frozenUser)).toBe(true);

    const frozenAssistant = deepFreeze(
      assistantMsg([text("only"), { type: "thinking", thinking: "x" }]),
    );
    expect(extractText(frozenAssistant)).toBe("only");
    expect(Object.isFrozen(frozenAssistant)).toBe(true);
  });
});

// --- run-member band bypass + chain-only (spec §04 h2.26, P1.M1.T3.S1) -----

/** In-memory dictionary over a plain map (types.ts contract; missing →
 *  null). Same convention as test/score.test.ts's stub. */
const mapDict = (entries: Record<string, number>): Dictionary => ({
  lookup: (w) => (w in entries ? entries[w]! : null),
  version: 1,
  entryCount: Object.keys(entries).length,
});

/** Self-contained pipeline harness: real core chain, fake dictionary,
 *  onAdmittedTokens capture (same discipline as ingest-pipeline.test.ts;
 *  test files are self-contained by convention). */
function makeRunPipeline(entries: Record<string, number>): {
  store: CandidateStore;
  pipeline: IngestPipeline;
  runs: (readonly (readonly RunMember[])[])[];
  drain: () => Promise<void>;
} {
  const store = new CandidateStore();
  const runs: (readonly (readonly RunMember[])[])[] = [];
  const pipeline = new IngestPipeline({
    store,
    dictionary: mapDict(entries),
    yieldFn: async () => {}, // deterministic; no real setImmediate turns
    onAdmittedTokens: (r) => runs.push(r),
  });
  return {
    store,
    pipeline,
    runs,
    drain: async () => {
      vi.advanceTimersByTime(300);
      await pipeline.flush();
    },
  };
}

/** The series-marked members of a captured payload, in document order. */
const seriesMembers = (
  runs: (readonly (readonly RunMember[])[])[],
): RunMember[] =>
  runs
    .flat()
    .flatMap((r) => [...r])
    .filter((m) => m.series === true);

describe(
  "run-member band bypass + chain-only ceiling (spec §04 h2.26, P1.M1.T3.S1)",
  () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("'National Renewable Energy Laboratory' stores all four members (national g1 despite q ≥ floor)", async () => {
      const h = makeRunPipeline({ national: 90, energy: 94, laboratory: 57 });
      h.pipeline.onMessageEnd(
        userMsg("National Renewable Energy Laboratory"),
      );
      await h.drain();
      // national/energy: band-rejected eagerly (q 90/94 ≥ rEff=30), then
      // retro-admitted at finalization via seriesMember (both < ceiling
      // 135) → group 1. renewable/laboratory: absent/under-the-ramp →
      // admitted eagerly (g0/g1). One occurrence each.
      expect(h.store.get("national")).toMatchObject({
        rankGroup: 1,
        sessionCount: 1,
        display: "National",
      });
      expect(h.store.get("renewable")).toMatchObject({ rankGroup: 0 });
      expect(h.store.get("energy")).toMatchObject({
        rankGroup: 1,
        sessionCount: 1,
        display: "Energy",
      });
      expect(h.store.get("laboratory")).toMatchObject({ rankGroup: 1 });
      // stats: 2 eager + 2 retro-admitted; chain-only would add nothing.
      expect(h.pipeline.getStats().admitted).toBe(4);
    });

    it("'The Fed Cut': 'the' never upserted but stays in the runs payload (chainOnly)", async () => {
      const h = makeRunPipeline({ the: 240 });
      h.pipeline.onMessageEnd(userMsg("The Fed Cut"));
      await h.drain();
      // fed/cut: absent → group 0 eagerly. the: q=240 ≥ ceiling →
      // chain-only — NO sighting, NO admitted count, payload mark only.
      expect(h.store.get("the")).toBeUndefined();
      expect(h.store.get("fed")).toMatchObject({ rankGroup: 0 });
      expect(h.store.get("cut")).toMatchObject({ rankGroup: 0 });
      expect(h.pipeline.getStats().admitted).toBe(2);
      // h.runs is [message][run][member] — one message, one run, three
      // series members ('the' chain-only-marked).
      expect(h.runs).toEqual([
        [
          [
            { key: "the", rawCasing: "The", series: true, chainOnly: true },
            { key: "fed", rawCasing: "Fed", series: true },
            { key: "cut", rawCasing: "Cut", series: true },
          ],
        ],
      ]);
    });

    it("'Uploaded Files' admits 'uploaded' (conjugation guard bypassed by run membership)", async () => {
      const h = makeRunPipeline({ upload: 200 });
      h.pipeline.onMessageEnd(userMsg("Uploaded Files"));
      await h.drain();
      // Line-initial 'Uploaded' is structural-cap (properName false), so
      // the EAGER path hits the guard (upload=200 ≥ rEff(30,8)) and
      // band-rejects; the seriesMember override bypasses the guard and
      // admits absent → group 0. 'files' admits eagerly (file absent).
      expect(h.store.get("uploaded")).toMatchObject({ rankGroup: 0 });
      expect(h.store.get("files")).toMatchObject({ rankGroup: 0 });
    });

    it("lowercase 'national energy' (no run) stores nothing and leaks no series members", async () => {
      const h = makeRunPipeline({ national: 90, energy: 94 });
      h.pipeline.onMessageEnd(userMsg("national energy"));
      await h.drain();
      expect(h.store.get("national")).toBeUndefined();
      expect(h.store.get("energy")).toBeUndefined();
      expect(h.runs).toEqual([[]]); // band-rejected lowercase → no entries
    });

    it("memo stays context-free: 'National' in a run admits THIS message only; later lowercase occurrence stays out", async () => {
      const h = makeRunPipeline({ national: 90 });
      h.pipeline.onMessageEnd(userMsg("National Grid Corp")); // run → retro-admit g1
      await h.drain();
      expect(h.store.get("national")).toMatchObject({
        rankGroup: 1,
        sessionCount: 1,
      });
      const firstOrdinal = h.store.get("national")!.lastSeenOrdinal;
      // Same DISTINCT token text lowercase: a different memo key AND (even
      // for the capitalized memo entry) no run context — the band-reject
      // stands. Memoizing seriesMember would have admitted this occurrence.
      h.pipeline.onMessageEnd(userMsg("national grid"));
      await h.drain();
      expect(h.store.get("national")).toMatchObject({
        rankGroup: 1,
        sessionCount: 1,
        lastSeenOrdinal: firstOrdinal, // no new sighting
      });
    });

    it("reverse purity: lowercase first (rejected), capitalized run later (retro-admitted)", async () => {
      const h = makeRunPipeline({ national: 90 });
      h.pipeline.onMessageEnd(userMsg("national grid"));
      await h.drain();
      expect(h.store.get("national")).toBeUndefined();
      h.pipeline.onMessageEnd(userMsg("National Grid Corp"));
      await h.drain();
      expect(h.store.get("national")).toMatchObject({
        rankGroup: 1,
        sessionCount: 1,
      });
    });

    it("ordinary runs unchanged: 'the quick brown fox' excludes 'the'", async () => {
      const h = makeRunPipeline({ the: 240 });
      h.pipeline.onMessageEnd(userMsg("the quick brown fox"));
      await h.drain();
      expect(h.store.get("the")).toBeUndefined();
      expect(h.runs).toEqual([
        [
          [
            { key: "quick", rawCasing: "quick" },
            { key: "brown", rawCasing: "brown" },
            { key: "fox", rawCasing: "fox" },
          ],
        ],
      ]);
      expect(seriesMembers(h.runs)).toEqual([]); // no cap run here
    });

    it("band-rejected uppercase singleton stays out of ordinary runs (no cap run)", async () => {
      const h = makeRunPipeline({ the: 240 });
      h.pipeline.onMessageEnd(userMsg("The quick brown fox"));
      await h.drain();
      // 'The' band-rejects (entry exists, run-eligible) but is alone —
      // below the ≥2 cap-run floor → excluded from the payload entirely.
      expect(h.runs).toEqual([
        [
          [
            { key: "quick", rawCasing: "quick" },
            { key: "brown", rawCasing: "brown" },
            { key: "fox", rawCasing: "fox" },
          ],
        ],
      ]);
    });
  },
);

// --- single mid-sentence capital (spec §04 h2.28, P1.M1.T3.S2) ---------------

/** The casing-class override is OCCURRENCE context; the admission memo is
 *  keyed on token.raw and must never learn it. These pins hold for BOTH
 *  first-sighting orders. */
describe(
  "single mid-sentence capital — occurrence-level relaxation (spec §04 h2.28, P1.M1.T3.S2)",
  () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("mid-sentence 'Zephyr' (q=94) stores at g1; lowercase 'zephyr' never stores", async () => {
      const h = makeRunPipeline({ zephyr: 94 });
      h.pipeline.onMessageEnd(userMsg("then Zephyr checked"));
      await h.drain();
      // then/checked: absent → g0 eagerly; Zephyr: band-rejected in the
      // memo (94 ≥ floor 30) → mid-cap retry lifts the band to 95 → g1.
      expect(h.store.get("zephyr")).toMatchObject({
        rankGroup: 1,
        sessionCount: 1,
        display: "Zephyr",
      });
      expect(h.pipeline.getStats().admitted).toBe(3); // then + zephyr + checked

      const lc = makeRunPipeline({ zephyr: 94 });
      lc.pipeline.onMessageEnd(userMsg("then zephyr checked"));
      await lc.drain();
      expect(lc.store.get("zephyr")).toBeUndefined(); // plain floor 30
      expect(lc.pipeline.getStats().admitted).toBe(2); // then + checked only
    });

    it("memo purity, order A: structural-start 'Zephyr' stays out; the later mid-sentence occurrence admits", async () => {
      const h = makeRunPipeline({ zephyr: 94 });
      h.pipeline.onMessageEnd(userMsg("Zephyr checked")); // structural-cap
      await h.drain();
      expect(h.store.get("zephyr")).toBeUndefined(); // no relaxation
      h.pipeline.onMessageEnd(userMsg("then Zephyr checked")); // mid-cap
      await h.drain();
      // Same raw token — the memoized plan said reject; the occurrence
      // override re-runs admit() with THIS occurrence's casing.
      expect(h.store.get("zephyr")).toMatchObject({
        rankGroup: 1,
        sessionCount: 1, // the structural occurrence added no sighting
      });
    });

    it("memo purity, order B (reverse): mid-sentence admits; the later structural-start occurrence adds no sighting", async () => {
      const h = makeRunPipeline({ zephyr: 94 });
      h.pipeline.onMessageEnd(userMsg("then Zephyr checked"));
      await h.drain();
      const firstOrdinal = h.store.get("zephyr")!.lastSeenOrdinal;
      expect(h.store.get("zephyr")!.rankGroup).toBe(1);
      h.pipeline.onMessageEnd(userMsg("Zephyr checked")); // structural
      await h.drain();
      // A memoized mid-cap verdict must NOT loosen the structural
      // occurrence: no new sighting, no count bump, same ordinal.
      expect(h.store.get("zephyr")).toMatchObject({
        rankGroup: 1,
        sessionCount: 1,
        lastSeenOrdinal: firstOrdinal,
      });
    });

    it("mid-cap absent word stores at g0 (casing never ranks)", async () => {
      const h = makeRunPipeline({});
      h.pipeline.onMessageEnd(userMsg("then Quuxblat checked"));
      await h.drain();
      expect(h.store.get("quuxblat")).toMatchObject({ rankGroup: 0 });
    });

    it("mid-cap single over the band stays out (no store entry, no admitted count)", async () => {
      const h = makeRunPipeline({ zephyr: 150 });
      h.pipeline.onMessageEnd(userMsg("then Zephyr checked"));
      await h.drain();
      // 150 ≥ max(rEff(30,6)=30, 95) → still rejected after the retry;
      // a singleton is below the ≥2 cap-run floor, so the run machinery
      // never retro-admits it either. No upsert, no stats.admitted.
      expect(h.store.get("zephyr")).toBeUndefined();
      expect(h.pipeline.getStats().admitted).toBe(2); // then + checked only
    });

    it("conjugation guard: mid-sentence 'Uploaded' (stem upload=200) admits; lowercase 'uploaded' rejects", async () => {
      // Mid-sentence 'Uploaded' is properName (the mid-cap condition) →
      // the guard is skipped → absent → g0. Lowercase 'uploaded' hits the
      // guard (upload=200 ≥ rEff(30,8)) and rejects.
      const h = makeRunPipeline({ upload: 200 });
      h.pipeline.onMessageEnd(userMsg("then Uploaded files"));
      await h.drain();
      expect(h.store.get("uploaded")).toMatchObject({ rankGroup: 0 });

      const lc = makeRunPipeline({ upload: 200 });
      lc.pipeline.onMessageEnd(userMsg("then uploaded files"));
      await lc.drain();
      expect(lc.store.get("uploaded")).toBeUndefined();
    });
  },
);