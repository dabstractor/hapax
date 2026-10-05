/**
 * Successor index suite (PRD 002 §06 h2.38/h3.7) — the word → top-3
 * most-frequent-successors map CandidateStore maintains INCREMENTALLY at
 * bigram ingest (inside recordBigramRuns — never a scan, never on the
 * keystroke path).
 *
 * The end-to-end cases drive the REAL IngestPipeline (text → tokenize →
 * shape/admission → strict-adjacency gap split → recordBigramRuns, the
 * P1.M1.T3.S2 runs contract), because P1.M2 chaining, /acwords, and M4
 * acceptance all consume topSuccessors() AS PRODUCED BY INGEST — a
 * newline is the only structural run break and only plain spaces/tabs
 * chain within a line. Two cases stay store-direct by design: the cap /
 * byte-lex mechanics and the 10,000-cap eviction flood fabricate
 * `string[][]` runs directly (impractical as raw text; the store takes
 * the pipeline's admitted lowercase keys on faith).
 */

import { describe, expect, it } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { CandidateStore } from "../src/core/store.js";
import { REJECT_COMMON_THRESHOLD } from "../src/core/score.js";
import type { Dictionary } from "../src/core/types.js";
import {
  IngestPipeline,
  restoreFromHistory,
  type AgentMessage,
} from "../src/pi/ingest.js";

// --- harness -----------------------------------------------------------------

type UserMessage = Extract<AgentMessage, { role: "user" }>;

const userMsg = (content: string): UserMessage => ({
  role: "user",
  content,
  timestamp: 0,
});

/** Session-format message entry (shapes per test/ingest-restore.test.ts). */
const msgEntry = (id: string, parentId: string | null, text: string): SessionEntry => ({
  type: "message",
  id,
  parentId,
  timestamp: "2025-01-01T00:00:00.000Z",
  message: userMsg(text),
});

/**
 * Pipeline wired like src/pi/index.ts's session_start: onAdmittedTokens →
 * store.recordBigramRuns. The dictionary stub decides admission per word
 * (PRP pattern from test/ingest-pipeline.test.ts): lookup → null means
 * rare-group admit; lookup ≥ REJECT_COMMON_THRESHOLD rejects, turning the
 * word into gap text that BREAKS adjacency runs.
 */
function makeSuccPipeline(rejects: (w: string) => boolean = () => false): {
  store: CandidateStore;
  pipeline: IngestPipeline;
} {
  const store = new CandidateStore();
  const dictionary = {
    lookup: (w: string) => (rejects(w) ? REJECT_COMMON_THRESHOLD + 30 : null),
    version: 1,
    entryCount: 0,
  } as unknown as Dictionary;
  const pipeline = new IngestPipeline({
    store,
    dictionary,
    onAdmittedTokens: (runs) =>
      // index.ts's shim: members → keys (plan 006 payload widening)
      store.recordBigramRuns(runs.map((r) => r.map((m) => m.key))),
  });
  return { store, pipeline };
}

/** Feed raw texts through the pipeline's direct drain path. processText is
 *  awaited per message (the restore-replay entry point — no debounce timer
 *  involved), so each message — including its single onAdmittedTokens call
 *  — is fully processed when the await resolves; flush() would be a no-op. */
async function feed(pipeline: IngestPipeline, texts: string[]): Promise<void> {
  for (const text of texts) await pipeline.processText(text, true);
}

/** Replay raw texts as session history through restoreFromHistory (the
 *  /resume path): minimal fake session manager + done-counter promise,
 *  mirroring acceptance.test.ts's replayNrel pattern. */
async function replayTexts(pipeline: IngestPipeline, texts: string[]): Promise<void> {
  const entries = texts.map((t, i) => msgEntry(`e${i}`, i === 0 ? null : `e${i - 1}`, t));
  const real = pipeline.processText.bind(pipeline);
  let done = 0;
  let resolve!: () => void;
  const finished = new Promise<void>((r) => {
    resolve = r;
  });
  restoreFromHistory(
    {
      processText: async (text, fromUser) => {
        await real(text, fromUser);
        if (++done === entries.length) resolve();
      },
    },
    {
      getBranch: () => [...entries].reverse(), // leaf → root, like pi
      getEntries: () => [...entries],
    },
  );
  await finished;
}

/** "p00042"-style fixed-width keys so byte order == insertion order. */
const padded = (i: number): string => String(i).padStart(5, "0");

// ── End-to-end contract through the real pipeline ───────────────────────────

describe("successor index (PRD 002 §06 h2.38/h3.7) — strict-adjacency ingest", () => {
  it("builds the top-3 from adjacency runs of one multi-line message (count desc)", async () => {
    const { store, pipeline } = makeSuccPipeline();
    // One message, six lines → one onAdmittedTokens call carrying six
    // 2-word runs: alpha→beta ×3, alpha→gamma ×2, alpha→delta ×1.
    await feed(pipeline, [
      "alpha beta\nalpha beta\nalpha beta\nalpha gamma\nalpha gamma\nalpha delta",
    ]);
    expect(store.bigramSize).toBe(3); // one counted bigram per adjacent pair
    expect(store.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 3 },
      { next: "gamma", count: 2 },
      { next: "delta", count: 1 },
    ]);
  });

  it("strict adjacency end-to-end: punctuation breaks, whitespace-only gaps chain, stopword bridges are forbidden", async () => {
    const { store, pipeline } = makeSuccPipeline((w) => w === "of");
    // Comma gap → two 1-word runs → no bigram at all.
    await feed(pipeline, ["zephyr, quuxblat"]);
    expect(store.bigramSize).toBe(0);
    expect(store.topSuccessors("zephyr")).toEqual([]);
    // Space+tab gap is plain whitespace → chains.
    await feed(pipeline, ["zephyr \t quuxblat"]);
    expect(store.topSuccessors("zephyr")).toEqual([{ next: "quuxblat", count: 1 }]);
    // Stopword bridge: "of" is dictionary-rejected → gap text " of " is
    // not pure whitespace → states and america never chain. Only the
    // united→states bigram exists (store-level consequence of the runs
    // contract — ingest-pipeline.test.ts pins the run shapes themselves).
    await feed(pipeline, ["United States of America"]);
    expect(store.topSuccessors("united")).toEqual([{ next: "states", count: 1 }]);
    expect(store.topSuccessors("states")).toEqual([]); // america broke off
    expect(store.topSuccessors("america")).toEqual([]); // no trailing successor
  });

  it("run breaks are inherited from the ingest contract — no successor crosses a line", async () => {
    const { store, pipeline } = makeSuccPipeline();
    await feed(pipeline, ["alpha beta\ngamma delta"]);
    expect(store.topSuccessors("alpha")).toEqual([{ next: "beta", count: 1 }]);
    expect(store.topSuccessors("beta")).toEqual([]); // beta→gamma never formed
    expect(store.topSuccessors("gamma")).toEqual([{ next: "delta", count: 1 }]);
  });

  it("runs longer than 2 keys form no trigram — counts come from adjacent pairs only", async () => {
    const { store, pipeline } = makeSuccPipeline();
    await feed(pipeline, ["echo foxtrot golf"]);
    expect(store.bigramSize).toBe(2); // "echo foxtrot" + "foxtrot golf" — NO trigram
    expect(store.topSuccessors("echo")).toEqual([{ next: "foxtrot", count: 1 }]);
    expect(store.topSuccessors("foxtrot")).toEqual([{ next: "golf", count: 1 }]);
    expect(store.topSuccessors("golf")).toEqual([]); // no trailing successor exists
    // A skip-bigram "echo golf" would surface as echo's 2nd entry — it
    // must not exist.
    expect(store.topSuccessors("echo")).toHaveLength(1);
  });

  it("restore replay through the REAL pipeline: two stores fed the identical stream build deep-equal indices", async () => {
    const STREAM = [
      "alpha beta",
      "alpha beta",
      "alpha gamma",
      "alpha delta",
      "nova quark solar", // 3-word run → adjacent pairs only
      "nova quark", // quark recurs
      "wind", // no windows at all
    ];
    const a = makeSuccPipeline();
    const b = makeSuccPipeline();
    await replayTexts(a.pipeline, STREAM);
    await replayTexts(b.pipeline, STREAM);
    // Every first word of the stream — plus misses — deep-equal.
    for (const w of [
      "alpha",
      "nova",
      "quark",
      "beta",
      "gamma",
      "delta",
      "solar",
      "wind",
      "unseen",
    ]) {
      expect(a.store.topSuccessors(w)).toEqual(b.store.topSuccessors(w));
    }
    expect(a.store.bigramSize).toBe(b.store.bigramSize);
    // And the replayed index equals the live-ingest index value-for-value
    // (same adjacency stream ⇒ same counts, order, and truncation).
    expect(a.store.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 2 },
      { next: "delta", count: 1 }, // count tie → byte-lex asc: delta < gamma
      { next: "gamma", count: 1 },
    ]);
    expect(a.store.topSuccessors("nova")).toEqual([{ next: "quark", count: 2 }]);
    expect(a.store.topSuccessors("quark")).toEqual([{ next: "solar", count: 1 }]);
  });

  it("unseen word returns the shared empty constant — same reference every miss (pre- AND post-data)", async () => {
    const { store, pipeline } = makeSuccPipeline();
    const miss = store.topSuccessors("nowhere");
    expect(miss).toEqual([]);
    expect(store.topSuccessors("elsewhere")).toBe(miss); // shared pre-data…
    await feed(pipeline, ["alpha beta", "alpha gamma"]);
    expect(store.topSuccessors("nowhere")).toBe(miss); // …and post-data
    // Hits return the LIVE array (mutations after the read stay visible),
    // never the shared constant and never a copy.
    const live = store.topSuccessors("alpha");
    expect(live).not.toBe(miss);
    await feed(pipeline, ["alpha delta"]);
    expect(live).toContainEqual({ next: "delta", count: 1 });
  });
});

// ── Store-direct by design (cap mechanics + eviction flood fabricate runs) ──

describe("successor index (PRD 002 §06 h2.38/h3.7) — bump mechanics (store-direct)", () => {
  it("caps at 3: a 4th distinct successor never appears while the top 3 stand", () => {
    const s = new CandidateStore();
    for (let r = 0; r < 3; r++) s.recordBigramRuns([["alpha", "beta"]]);
    for (let r = 0; r < 2; r++) s.recordBigramRuns([["alpha", "gamma"]]);
    s.recordBigramRuns([["alpha", "delta"]]);
    s.recordBigramRuns([["alpha", "epsilon"]]);
    expect(s.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 3 },
      { next: "gamma", count: 2 },
      { next: "delta", count: 1 },
    ]);
    // The array NEVER holds more than 3 — the newcomer was refused, not
    // hidden (a later delta recurrence would still bump delta's count).
    s.recordBigramRuns([["alpha", "delta"]]);
    expect(s.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 3 },
      { next: "delta", count: 2 },
      { next: "gamma", count: 2 }, // byte-lex asc tie: delta before gamma
    ]);
  });

  it("breaks count ties byte-lex ascending on `next`", () => {
    const s = new CandidateStore();
    // All counts tie at 1; arrival order (zulu first) must not matter.
    s.recordBigramRuns([["w", "zulu"]]);
    s.recordBigramRuns([["w", "novel"]]);
    s.recordBigramRuns([["w", "aurora"]]);
    expect(s.topSuccessors("w")).toEqual([
      { next: "aurora", count: 1 },
      { next: "novel", count: 1 },
      { next: "zulu", count: 1 },
    ]);
    // A 4th byte-lex-smaller newcomer CAN displace the byte-lex-largest
    // incumbent at the same count — sorted-tail drop, fully deterministic.
    s.recordBigramRuns([["w", "ember"]]);
    expect(s.topSuccessors("w")).toEqual([
      { next: "aurora", count: 1 },
      { next: "ember", count: 1 },
      { next: "novel", count: 1 },
    ]);
  });
});

// ── Eviction cleanup (PRD §06 h2.38 + §06 M2 eviction interplay) ────────────

describe("successor index (PRD 002 §06 h2.38/h3.7) — eviction cleanup (store-direct)", () => {
  it("evicted bigrams are spliced out of the index — no backfill, no recomputation", () => {
    // STORE-DIRECT BY DESIGN: pins the 10,000-cap overflow determinism —
    // 9,996 throwaway bigrams are impractical to synthesize as raw text.
    const s = new CandidateStore();
    // High-value incumbents first: ×9 → log(9)-boosted eviction key, must
    // survive any eviction pass.
    for (let r = 0; r < 9; r++) s.recordBigramRuns([["alpha", "beta"]]);
    for (let r = 0; r < 9; r++) s.recordBigramRuns([["alpha", "gamma"]]);
    // Base: 9,996 count-1 throwaway bigrams (distinct first words, so no
    // top-3 capping interferes), all at the same current ordinal.
    const base: string[][] = [];
    for (let i = 1; i <= 9_996; i++) base.push([`p${padded(i)}`, `q${padded(i)}`]);
    s.recordBigramRuns(base);
    // Two doomed bigrams: count 1 and byte-lex BELOW every base key
    // ("alpha …" < "p…", "ghost …" < "p…") — the lowest eviction keys in
    // the map (bigramSortKey ties break by byte-lex key order).
    s.recordBigramRuns([["alpha", "delta"]]); // alpha's 3rd successor
    s.recordBigramRuns([["ghost", "final"]]); // ghost's ONLY successor
    expect(s.bigramSize).toBe(10_000); // exactly full, nothing evicted yet
    // +2 → the exact overflow drains: exactly the two doomed bigrams go
    // (batch bound 256 ≥ overflow 2 — eviction is deterministic).
    s.recordBigramRuns([["zzz", "overflow"]]);
    s.recordBigramRuns([["yyy", "overflow"]]);
    expect(s.bigramSize).toBe(10_000);
    // alpha: delta spliced out, survivors intact — and NOT backfilled to 3.
    expect(s.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 9 },
      { next: "gamma", count: 9 },
    ]);
    // ghost: its array emptied → the whole map entry is gone (an unseen-
    // word miss and a post-eviction miss share the same empty constant).
    expect(s.topSuccessors("ghost")).toEqual([]);
    expect(s.topSuccessors("ghost")).toBe(s.topSuccessors("never-seen"));
    // Survivor bigrams recorded after the base are indexed as usual.
    expect(s.topSuccessors("zzz")).toEqual([{ next: "overflow", count: 1 }]);
    expect(s.topSuccessors("yyy")).toEqual([{ next: "overflow", count: 1 }]);
  });
});