/**
 * enableChaining inertness suite (PRD §08 h2.46, P1.M3.T1.S2) — the
 * chaining flag gates the SUCCESSOR-INDEX CHAIN LAYER ONLY; word
 * completion is unaffected either way. Successor of the deleted
 * phrase-gating.test.ts (P1.M1.T2.S1), re-scoped to the redesigned
 * chain + force path (P1.M2.T1.S1 / P1.M2.T2.S2).
 *
 * With enableChaining:false the proven inertness contract is:
 *   - bigram capture is unwired (the src/pi/index.ts false-branch
 *     shape — no onAdmittedTokens), so recordBigramRuns (the ONLY
 *     successor-index path, src/core/store.ts) never runs and the
 *     successor index is never built: topSuccessors → [];
 *   - Tab-accepting a live word item never arms the machine
 *     (applyCompletion gate) — delegation itself still happens
 *     verbatim;
 *   - an externally-armed machine never offers successors
 *     (getSuggestions armed-branch gate) — and force:true cannot
 *     resurrect the layer: the armed branch precedes force, so a
 *     forced query still delegates (P1.M2.T2 branch-order contract);
 *   - word completion (threshold + trigger modes) is identical to the
 *     ungated provider over the SAME store.
 *
 * A gated-true control case proves this suite's harness actually
 * exercises the layer it claims is inert (arm + zero-char successor
 * offer fire under the default config).
 *
 * Patterns reuse test/chain.test.ts: cfg() fresh-config helper,
 * editingCurrent() pi-shaped mock, suggest()/opts(), a real
 * IngestPipeline wired like session_start, and the NREL fixture
 * (test/fixtures/sessions/zephyr-chain.jsonl) replayed through
 * restoreFromHistory with the REAL shipped dictionary
 * (loadDictionary(resolveDictPath())).
 */

import { describe, expect, it, vi, type Mock } from "vitest";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { loadDictionary } from "../src/core/dictionary.js";
import { CandidateStore } from "../src/core/store.js";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { HapaxConfig } from "../src/pi/config.js";
import {
  extractText,
  IngestPipeline,
  restoreFromHistory,
  type AgentMessage,
  type RestoreSessionManager,
} from "../src/pi/ingest.js";
import { resolveDictPath } from "../src/pi/paths.js";
import { createChainMachine, createHapaxProvider } from "../src/pi/provider.js";
import {
  asSessionManager,
  parseSessionFixture,
} from "./helpers/session-fixture.js";

// ── fixtures/helpers (chain.test.ts patterns) ───────────────────────────────

const FIXTURES = "test/fixtures/sessions";

/** Fresh config per call (defaults: trigger "#", threshold 2, max 8). */
const cfg = (over: Partial<HapaxConfig> = {}): HapaxConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

/** Fresh { signal } per call (real AbortController — no fake timers). */
const opts = (): { signal: AbortSignal } => ({
  signal: new AbortController().signal,
});

type MockedCurrent = AutocompleteProvider & {
  getSuggestions: Mock;
  applyCompletion: Mock;
};

/** Pi-shaped current provider with a persistent editing buffer, so
 *  applyCompletion delegation visibly splices the accepted value. */
function editingCurrent(initial: string[] = ["natio"], cursorCol = 5) {
  const state = { lines: initial, cursorLine: 0, cursorCol };
  return {
    state,
    getSuggestions: vi.fn(
      async (
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        options: { signal: AbortSignal },
      ) => null,
    ),
    applyCompletion: vi.fn(
      (
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        accepted: AutocompleteItem,
        prefix: string,
      ) => {
        const line = lines[cursorLine] ?? "";
        const before = line.slice(0, cursorCol - prefix.length);
        const after = line.slice(cursorCol);
        const newLines = [...lines];
        newLines[cursorLine] = before + accepted.value + after;
        state.lines = newLines;
        state.cursorLine = cursorLine;
        state.cursorCol = before.length + accepted.value.length;
        return { lines: newLines, cursorLine, cursorCol: state.cursorCol };
      },
    ),
  };
}

/** One getSuggestions call, fresh options each time. */
const suggest = (
  p: AutocompleteProvider,
  lines: string[],
  line: number,
  col: number,
): Promise<AutocompleteSuggestions | null> =>
  p.getSuggestions(lines, line, col, opts());

const expectSingleWordItems = (items: readonly AutocompleteItem[]): void => {
  for (const i of items) expect(i.value).not.toContain(" ");
};

/** Pipeline wired like src/pi/index.ts's session_start: the bigram hook
 *  is recordBigramRuns — the ONLY successor-index path. enableChaining
 *  (P1.M3.T1.S2) gates exactly this wiring; false mirrors the shipped
 *  false-branch (hook absent entirely). */
function makeChainPipeline(enableChaining: boolean): {
  store: CandidateStore;
  pipeline: IngestPipeline;
} {
  const store = new CandidateStore();
  const pipeline = new IngestPipeline({
    store,
    dictionary: loadDictionary(resolveDictPath()),
    ...(enableChaining
      ? {
          onAdmittedTokens: (lines: string[][]) =>
            store.recordBigramRuns(lines),
        }
      : {}),
  });
  return { store, pipeline };
}

/** Replay pre-parsed fixture entries through restoreFromHistory on the
 *  GIVEN pipeline (completion-tracking wrapper so the fire-and-forget
 *  replay is awaitable). */
async function replayChain(
  pipeline: IngestPipeline,
  entries: ReturnType<typeof parseSessionFixture>,
): Promise<void> {
  const total = entries.filter(
    (e) =>
      e.message !== undefined &&
      extractText(e.message as unknown as AgentMessage) !== null,
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
    },
    asSessionManager(entries) as unknown as RestoreSessionManager,
  );
  await finished;
}

// ── cases ────────────────────────────────────────────────────────────────────

describe("enableChaining inertness (PRD §08 h2.46 — successor chain layer only)", () => {
  it("capture off: full ingest with the hook unwired builds NO successor index", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/zephyr-chain.jsonl`);
    // Mirror of index.ts's enableChaining:false branch: the spread
    // yields {} — no onAdmittedTokens, so recordBigramRuns (the only
    // successor path) never fires.
    const { store, pipeline } = makeChainPipeline(false);

    await replayChain(pipeline, entries);

    // Control: the replay DID ingest (word candidates admitted through
    // the real pipeline + shipped dict) — the empty index below is the
    // gate's doing, not a dead fixture.
    expect(store.size).toBeGreaterThan(0);
    // The successor index was never built: no bigrams, no successors.
    expect(store.bigramSize).toBe(0);
    expect(store.topSuccessors("acme")).toEqual([]);
    expect(store.topSuccessors("zephyr")).toEqual([]);
    expect(store.topSuccessors("noria")).toEqual([]);
  });

  it("no arming on Tab-accept: a live word item never arms, delegation still happens", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/zephyr-chain.jsonl`);
    // Successors ARE present (hook on) so the case proves the CONFIG
    // gate alone blocks the chain layer — not a missing index.
    const { store, pipeline } = makeChainPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(
      store,
      cfg({ enableChaining: false }),
      current,
      chain,
    );

    await replayChain(pipeline, entries);

    const menu = await suggest(provider, ["acme"], 0, 4);
    expect(menu?.items.map((i) => i.value)).toContain("Acme");
    const acmeItem = menu!.items.find((i) => i.value === "Acme")!;

    const lines = ["acme"];
    const returned = provider.applyCompletion(
      lines,
      0,
      4,
      acmeItem,
      "acme",
    );

    // (i) Arming is gated: the machine stays idle after a whole-word
    // accept (word completion itself still works — the flag disables
    // the chain layer, not hapax's word menu).
    expect(chain.state()).toBeNull();
    // (ii) Delegation is UNCONDITIONAL (PRD §07 h2.43): pi's provider
    // gets the ORIGINAL arguments — same array, item and prefix
    // references — and hapax returns its result verbatim.
    expect(current.applyCompletion).toHaveBeenCalledTimes(1);
    const call = current.applyCompletion.mock.calls[0]!;
    expect(call[0]).toBe(lines); // args identity — original array forwarded
    expect(call[1]).toBe(0);
    expect(call[2]).toBe(4);
    expect(call[3]).toBe(acmeItem);
    expect(call[4]).toBe("acme");
    expect(returned).toEqual({
      lines: ["Acme"],
      cursorLine: 0,
      cursorCol: 4,
    });
    expect(current.state.lines).toEqual(["Acme"]); // word inserted
  });

  it("externally-armed machine never offers: armed query delegates with unchanged args, state untouched", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/zephyr-chain.jsonl`);
    const { store, pipeline } = makeChainPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(
      store,
      cfg({ enableChaining: false }),
      current,
      chain,
    );

    await replayChain(pipeline, entries);
    chain.arm("acme"); // armed by ANY means — the gate lives in the provider

    const options = opts();
    const lines = ["Acme "];
    // Zero-typed-char word start — the exact query the armed branch
    // would answer with successors. Gated → falls through to pi.
    expect(await provider.getSuggestions(lines, 0, 5, options)).toBeNull();
    expect(current.getSuggestions).toHaveBeenCalledTimes(1);
    expect(current.getSuggestions.mock.calls[0]![0]).toBe(lines); // identity
    expect(current.getSuggestions.mock.calls[0]![3]).toBe(options); // identity
    // The machine's own state is untouched — never consulted, never
    // disqualified: the branch simply never ran.
    expect(chain.state()).toEqual({ word: "acme" });
  });

  it("force path gated too: force:true cannot resurrect the armed branch (P1.M2.T2 branch order)", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/zephyr-chain.jsonl`);
    const { store, pipeline } = makeChainPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(
      store,
      cfg({ enableChaining: false }),
      current,
      chain,
    );

    await replayChain(pipeline, entries);
    chain.arm("acme");

    // Branch order is a landed contract: abort → armed → force-aware →
    // normal. The gated-off armed branch precedes force, so a forced
    // query can never synthesize a forced single-item successor — it
    // takes the normal path (no live fragment after the space) and
    // delegates with the force options VERBATIM.
    const options = { ...opts(), force: true } as Parameters<
      AutocompleteProvider["getSuggestions"]
    >[3];
    const lines = ["Acme "];
    expect(await provider.getSuggestions(lines, 0, 5, options)).toBeNull();
    expect(current.getSuggestions).toHaveBeenCalledTimes(1);
    expect(current.getSuggestions.mock.calls[0]![3]).toBe(options); // force forwarded
    expect(chain.state()).toEqual({ word: "acme" }); // inert, untouched
  });

  it("word completion identical to ungated: threshold + trigger modes over the SAME store", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/zephyr-chain.jsonl`);
    // One store, bigram hook ON (successors present): the ONLY delta
    // between the two providers is the enableChaining flag, so any
    // word-menu difference would be the gate leaking into the word path.
    const { store, pipeline } = makeChainPipeline(true);
    await replayChain(pipeline, entries);

    const gated = createHapaxProvider(
      store,
      cfg({ enableChaining: false }),
      editingCurrent(),
      createChainMachine(),
    );
    const ungated = createHapaxProvider(
      store,
      cfg(), // enableChaining: true (default)
      editingCurrent(),
      createChainMachine(),
    );

    // Threshold mode ("acme", 4 chars ≥ 2): byte-identical menus.
    const gatedMenu = await suggest(gated, ["acme"], 0, 4);
    const ungatedMenu = await suggest(ungated, ["acme"], 0, 4);
    expect(gatedMenu).toEqual(ungatedMenu);
    expect(gatedMenu?.items.length).toBeGreaterThan(0);

    // Trigger mode ("#acme"): byte-identical menus.
    const gatedTrigger = await suggest(gated, ["#acme"], 0, 5);
    const ungatedTrigger = await suggest(ungated, ["#acme"], 0, 5);
    expect(gatedTrigger).toEqual(ungatedTrigger);
    expect(gatedTrigger?.items.length).toBeGreaterThan(0);

    // Below threshold (1 char < 2): BOTH delegate to pi.
    expect(await suggest(gated, ["n"], 0, 1)).toBeNull();
    expect(await suggest(ungated, ["n"], 0, 1)).toBeNull();
  });

  it("control (gated true): the harness arms on word accept and fires the zero-char successor offer", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/zephyr-chain.jsonl`);
    const { store, pipeline } = makeChainPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg(), current, chain);

    await replayChain(pipeline, entries);

    // Harness sanity: the successor index is populated by the replay.
    expect(store.topSuccessors("acme").length).toBeGreaterThan(0);

    // Arm via the production path: live menu → Tab accept.
    const menu = await suggest(provider, ["acme"], 0, 4);
    const acmeItem = menu!.items.find((i) => i.value === "Acme")!;
    provider.applyCompletion(["acme"], 0, 4, acmeItem, "acme");
    expect(chain.state()).toEqual({ word: "acme" });

    // The zero-typed-char offer fires: bare single-word successors at
    // prefix "", exactly the store's topSuccessors("acme") list rendered
    // in the candidate display casing (PRD §07; Issue-2 fix).
    const offer = await suggest(provider, ["Acme "], 0, 5);
    expect(offer?.prefix).toBe("");
    expect(offer?.items.map((i) => i.value)).toEqual(
      store.topSuccessors("acme").map((s) => store.get(s.next)?.display ?? s.next),
    );
    expectSingleWordItems(offer?.items ?? []);
  });
});