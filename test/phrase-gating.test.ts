/**
 * enablePhrases gating suite (P2.M2.T3.S1, PRD §08: the flag disables the
 * phrase layer, NOT hapax). With `enablePhrases: false` the extension
 * wires no onAdmittedTokens hook (src/pi/index.ts), so the store never
 * sees recordPhraseLines — and because the successor index is built
 * INSIDE the phrase-upsert path (store.ts #upsertPhrase's bigram successor tail), it has
 * zero successors too. Downstream, everything phrase-shaped is inert for
 * want of data: rankMatches finds no phrase candidates (no items, no
 * constituent suppression) and the provider's chain layer never arms
 * (its armed branch + arming intercept are additionally gated on the
 * flag in src/pi/provider.ts). Word completion must be byte-identical
 * to M1.
 *
 * Fixtures: the SAME nrel.jsonl / zendesk-lwlock.jsonl transcripts as
 * test/acceptance.test.ts, replayed through the real pipeline + shipped
 * dictionary with the hook wired/unwired exactly like src/pi/index.ts.
 * Phrase-on contrast cases document what the flag removes.
 */

import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { describe, expect, it, vi, type Mock } from "vitest";

import { loadDictionary } from "../src/core/dictionary.js";
import { rankMatches } from "../src/core/query.js";
import { CandidateStore } from "../src/core/store.js";
import type { Dictionary } from "../src/core/types.js";
import {
  extractText,
  IngestPipeline,
  restoreFromHistory,
  type AgentMessage,
  type RestoreSessionManager,
} from "../src/pi/ingest.js";
import { resolveDictPath } from "../src/pi/paths.js";
import { createChainMachine, createHapaxProvider } from "../src/pi/provider.js";
import { DEFAULT_CONFIG, type HapaxConfig } from "../src/pi/config.js";
import {
  asSessionManager,
  parseSessionFixture,
} from "./helpers/session-fixture.js";

const FIXTURES = "test/fixtures/sessions";

/** Pipeline wired like src/pi/index.ts's session_start (the ternary):
 *  the phrase hook exists ONLY under enablePhrases. */
function makePipeline(enablePhrases: boolean): { store: CandidateStore; pipeline: IngestPipeline } {
  const store = new CandidateStore();
  const dictionary: Dictionary = loadDictionary(resolveDictPath());
  const pipeline = new IngestPipeline({
    store,
    dictionary,
    ...(enablePhrases
      ? {
          onAdmittedTokens: (lines: string[][]) =>
            store.recordPhraseLines(lines, store.currentOrdinal()),
        }
      : {}),
  });
  return { store, pipeline };
}

/** Replay a whole fixture through restoreFromHistory + the real pipeline
 *  (acceptance-suite pattern: completion observed on the last message). */
async function ingestFixture(path: string, enablePhrases: boolean): Promise<{ store: CandidateStore }> {
  const entries = parseSessionFixture(path);
  const { store, pipeline } = makePipeline(enablePhrases);
  const total = entries.filter(
    (e) => e.message !== undefined && extractText(e.message as unknown as AgentMessage) !== null,
  ).length;
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
        if (++done === total) resolve();
      },
      // BUG-006 (P1.M3.T2.S1) widened the Pick; the tail sweep is out
      // of scope here — no-op keeps this replay behavior identical.
      sweepPhrases: () => {},
    },
    asSessionManager(entries) as unknown as RestoreSessionManager,
  );
  await finished;
  return { store };
}

/** Fresh config per call — never mutate DEFAULT_CONFIG. */
const cfg = (over: Partial<HapaxConfig> = {}): HapaxConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

/** Fresh { signal } per call. */
const opts = (): { signal: AbortSignal } => ({ signal: new AbortController().signal });

type MockedCurrent = AutocompleteProvider & {
  getSuggestions: Mock;
  applyCompletion: Mock;
};

/** Mock wrapped provider (acceptance-suite style). */
const mockCurrent = (result: unknown = null): MockedCurrent =>
  ({
    getSuggestions: vi.fn(async () => result),
    applyCompletion: vi.fn(
      (lines: string[], cursorLine: number, cursorCol: number) => ({ lines, cursorLine, cursorCol }),
    ),
  }) as MockedCurrent;

describe("enablePhrases: false — capture layer fully inert (P2.M2.T3.S1)", () => {
  it("full nrel ingest stores ZERO phrases and ZERO successors (hook unwired)", async () => {
    const { store } = await ingestFixture(`${FIXTURES}/nrel.jsonl`, false);
    expect(store.phraseSize).toBe(0);
    expect(store.phraseEntries()).toEqual([]);
    expect(store.phraseCandidateKeys()).toEqual([]);
    // Successors ride the phrase-upsert path — gated with it (index.ts):
    expect(store.topSuccessors("national")).toEqual([]);
    expect(store.topSuccessors("renewable")).toEqual([]);
    expect(store.topSuccessors("energy")).toEqual([]);
    // Word ingestion is untouched by the flag:
    expect(store.size).toBeGreaterThan(0);
    expect(store.get("national")).toBeDefined();
    expect(store.get("nrel")?.display).toBe("NREL");
  });

  it("rankMatches yields no phrase items and NO constituent suppression — the bare word survives", async () => {
    const { store } = await ingestFixture(`${FIXTURES}/nrel.jsonl`, false);
    const menu = rankMatches(store, "natio");
    // With phrases ON, the admitted "national renewable …" bigram/trigram
    // shadow this exact menu (contrast case below). Flag OFF → pure words.
    expect(menu.map((m) => m.display)).toContain("National");
    expect(menu.map((m) => m.description)).not.toContain("phrase");
    // nrel completes as the acronym too (no admitted bigram shadows it):
    expect(rankMatches(store, "nrel").map((m) => m.display)).toEqual(["NREL"]);
  });

  it("the provider chain layer never arms — accepting a live word item leaves the machine idle", async () => {
    const { store } = await ingestFixture(`${FIXTURES}/nrel.jsonl`, false);
    const current = mockCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg({ enablePhrases: false }), current, chain);

    // Live word menu ("natio" → National), then Tab:
    const menu = await provider.getSuggestions(["natio"], 0, 5, opts());
    expect(menu?.items.map((i) => i.value)).toEqual(["National"]);
    provider.applyCompletion(["natio"], 0, 5, { value: "National", label: "National" }, "natio");
    expect(chain.state()).toBeNull(); // intercept gated — never arms

    // The armed branch can therefore never run: a zero-typing-position
    // query gets the normal (phrase-free) threshold menu, prefix intact.
    const after = await provider.getSuggestions(["National"], 0, 8, opts());
    expect(after?.prefix).toBe("National");
    expect(after?.items.map((i) => i.value)).toEqual(["National"]);
    expect(chain.state()).toBeNull();
    expect(provider.__hapaxLive()?.prefix).toBe("National");
  });

  it("word completion parity — ze → Zendesk on zendesk-lwlock.jsonl, exactly the M1 surface", async () => {
    const { store } = await ingestFixture(`${FIXTURES}/zendesk-lwlock.jsonl`, false);
    // Same expected.md label as acceptance item 1:
    expect(rankMatches(store, "ze").map((m) => m.display)).toEqual(["Zendesk"]);

    const current = mockCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg({ enablePhrases: false }), current, chain);
    const result = await provider.getSuggestions(["ze"], 0, 2, opts());
    expect(result).toEqual({
      items: [
        { value: "Zendesk", label: "Zendesk", description: expect.stringMatching(/^session x\d+$/) },
      ],
      prefix: "ze",
    });
    expect(current.getSuggestions).not.toHaveBeenCalled(); // hapax answers

    // Accepting it also never arms (flag off):
    provider.applyCompletion(["ze"], 0, 2, { value: "Zendesk", label: "Zendesk" }, "ze");
    expect(chain.state()).toBeNull();
  });

  it("contrast — with enablePhrases: true the same ingest phrase-completes and suppresses", async () => {
    // Documents exactly what the flag removes: the "natio" menu's bare
    // word is shadowed by the admitted "National Renewable …" phrases and
    // the successor index is populated for the chain machine.
    const { store } = await ingestFixture(`${FIXTURES}/nrel.jsonl`, true);
    const menu = rankMatches(store, "natio");
    expect(menu.map((m) => m.description)).toEqual(["phrase", "phrase"]);
    expect(store.topSuccessors("national")[0]).toEqual({ next: "renewable", count: 4 });
  });
});