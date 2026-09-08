/**
 * BUG-001 e2e no-menu gate (bugfix 001_9e0f97150b68) — the full-pipeline
 * twin of test/shipped-dict.test.ts's calibration block.
 *
 * BUG-001: the original, uncalibrated band constants made common-word
 * rejection mathematically unreachable against the shipped artifact (the
 * old artifact scored the=103, with=71), so typing "with"/"this"/"them"
 * during ordinary prose popped hapax menus — a direct violation of the
 * #1 UX invariant (§01/§07: never trigger a menu for common words). The
 * scripted acceptance item 2 MASKED this failure because all of its probe
 * words were ≤3 chars: the shape gate's 4-char minimum rejects those by
 * length, so the probes never reached the dictionary band at all. A gate
 * that cannot see the failure is worse than no gate.
 *
 * This suite closes the hole end-to-end: prose.jsonl is replayed through
 * a REAL IngestPipeline with the SHIPPED dictionary (no mocks, no
 * synthetic binaries — the same wiring as acceptance.test.ts's
 * ingestFixture), then common words must DELEGATE: the provider returns
 * the delegate's result (exact sentinel identity) and __hapaxLive()
 * stays null — never a hapax menu. P1.M5.T1.S1's typing-path probes
 * build on this gate; import COMMON_PROBES from here rather than
 * re-listing the words.
 *
 * Band constants are IMPORTED from src/core/score.ts — never hard-coded —
 * so a retune keeps these gates meaningful (they assert band membership
 * relative to the live constants) while a regressed artifact or band
 * still fails loudly.
 */

import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi, type Mock } from "vitest";

import { loadDictionary } from "../src/core/dictionary.js";
import { rankMatches } from "../src/core/query.js";
import { MID_FREQ_THRESHOLD, REJECT_COMMON_THRESHOLD } from "../src/core/score.js";
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
import { createHapaxProvider } from "../src/pi/provider.js";
import { DEFAULT_CONFIG, type HapaxConfig } from "../src/pi/config.js";
import {
  asSessionManager,
  messageEntriesOf,
  parseSessionFixture,
} from "./helpers/session-fixture.js";

const PROSE = "test/fixtures/sessions/prose.jsonl";

/**
 * The BUG-001 gate words: ≥4-char top-common English, so every one PASSES
 * the shape gate and rejection can only come from the dictionary band.
 * All measured ≥ REJECT_COMMON_THRESHOLD against the shipped artifact
 * (that=215, with=179, this=197, them=156, have=190, would=156) and all
 * measured zero candidates against the prose-ingested store. Exported
 * for P1.M5.T1.S1's typing-path probes.
 */
export const COMMON_PROBES = ["with", "this", "them", "that", "have", "would"];

// ── local helpers (replicated from acceptance.test.ts on purpose — this
// file stays self-contained so later tasks can lift it whole) ──────────────

/** Fresh config per call — never mutate DEFAULT_CONFIG. */
const cfg = (over: Partial<HapaxConfig> = {}): HapaxConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

/** Fresh { signal } per call — real AbortController, not aborted. */
const opts = (): { signal: AbortSignal } => ({ signal: new AbortController().signal });

type MockedCurrent = AutocompleteProvider & {
  getSuggestions: Mock;
  applyCompletion: Mock;
};

/** Mock wrapped provider (the delegation target whose result identity the
 *  no-hijack assertions inspect). */
const mockCurrent = (result: unknown = null): MockedCurrent =>
  ({
    getSuggestions: vi.fn(async () => result),
    applyCompletion: vi.fn(
      (lines: string[], cursorLine: number, cursorCol: number) => ({ lines, cursorLine, cursorCol }),
    ),
  }) as MockedCurrent;

/** The built-in result a delegating provider must hand back untouched. */
const SENTINEL = {
  items: [{ value: "src/core/query.ts", label: "src/core/query.ts" }],
  prefix: "/",
};

describe("BUG-001 e2e — ordinary prose never opens a common-word menu", () => {
  let store: CandidateStore;
  let dict: Dictionary;

  beforeAll(async () => {
    // REAL pipeline + SHIPPED dictionary artifact (resolveDictPath honors
    // the HAPAX_DICT test seam exactly like the acceptance suite).
    dict = loadDictionary(resolveDictPath());
    const entries = parseSessionFixture(PROSE);
    store = new CandidateStore();
    const pipeline = new IngestPipeline({ store, dictionary: dict });
    const total = messageEntriesOf(entries).filter(
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
  }, 60_000);

  it("ingests prose.jsonl into a live (non-empty) store", () => {
    // Positive control, half 1: the replay really admitted words. Every
    // no-menu assertion below would be vacuous against an empty store.
    expect(store.size).toBeGreaterThan(0);
  });

  it.each(COMMON_PROBES)(
    "common prose word '%s' never opens a hapax menu (delegates)",
    async (w) => {
      // Pure-core half: the band-rejected word is absent from the store,
      // so ranking has nothing to offer.
      expect(rankMatches(store, w), `rankMatches('${w}') must be empty`).toEqual([]);

      // Full-provider half — where BUG-001 was actually visible: the
      // provider must DELEGATE. Exact sentinel identity (toBe, not
      // toEqual) proves the delegate's result came back untouched; a
      // hapax menu would be a fresh { items, prefix } object.
      const current = mockCurrent(SENTINEL);
      const provider = createHapaxProvider(store, cfg(), current);
      const lines = [w];
      const options = opts();
      const result = await provider.getSuggestions(lines, 0, w.length, options);
      expect(result, `typing '${w}' must delegate, not open a menu`).toBe(SENTINEL);
      expect(provider.__hapaxLive(), `'${w}' must leave the live cache empty`).toBeNull();
      expect(current.getSuggestions, `'${w}' must reach the wrapped provider once`).toHaveBeenCalledOnce();
      const args = current.getSuggestions.mock.calls[0]!;
      expect(args[0]).toBe(lines); // same array object — never cloned
      expect(args[1]).toBe(0);
      expect(args[2]).toBe(w.length);
      expect(args[3]).toBe(options); // same options object — signal intact
    },
  );

  it("thin/firs: measured mid-band and rejected-prefix behavior, pinned", async () => {
    // MEASURED against the shipped artifact (bugfix recalibration):
    //   lookup('thin')  = 76  → mid band (MID ≤ q < REJECT) → ADMITS
    //   lookup('first') = 144 → ≥ REJECT_COMMON_THRESHOLD    → rejected
    // 'thin' occurs in prose.jsonl ("This one gets thin light") and is a
    // legitimate mid-frequency completion: mid-band words are SUPPOSED to
    // open menus — only the common band carries the no-menu contract.
    // Band membership is asserted relative to the IMPORTED constants, so
    // this pin survives band retunes: it says "thin sits in the mid
    // band", not "thin equals any particular value".
    const thinQ = dict.lookup("thin");
    expect(thinQ, "shipped dict lost 'thin'").not.toBeNull();
    expect(thinQ!).toBeGreaterThanOrEqual(MID_FREQ_THRESHOLD);
    expect(thinQ!).toBeLessThan(REJECT_COMMON_THRESHOLD);
    expect(rankMatches(store, "thin").map((m) => m.display)).toEqual(["thin"]);

    // Provider path pins the same measured behavior: a single-item menu.
    const thinCurrent = mockCurrent(SENTINEL);
    const thinProvider = createHapaxProvider(store, cfg(), thinCurrent);
    const menu = await thinProvider.getSuggestions(["thin"], 0, 4, opts());
    expect(menu).not.toBe(SENTINEL); // menu, not delegation
    expect(menu!.items.map((i) => i.value)).toEqual(["thin"]);
    expect(menu!.prefix).toBe("thin");
    expect(thinProvider.__hapaxLive()).not.toBeNull();

    // 'firs': 'first' is a top-corpus word (measured q=144, in the REJECT
    // band), so it was rejected at admission and can NEVER appear as an
    // item — the PRD permits 'first'-adjacent suggestions only if 'first'
    // itself is not rejected, and it is. No other stored prose word starts
    // with 'firs', so the fragment has zero candidates → delegation.
    const firstQ = dict.lookup("first");
    expect(firstQ, "shipped dict lost 'first' (measured in the REJECT band)").not.toBeNull();
    expect(firstQ!).toBeGreaterThanOrEqual(REJECT_COMMON_THRESHOLD);
    expect(rankMatches(store, "firs")).toEqual([]);
    const firsCurrent = mockCurrent(SENTINEL);
    const firsProvider = createHapaxProvider(store, cfg(), firsCurrent);
    const firsResult = await firsProvider.getSuggestions(["firs"], 0, 4, opts());
    expect(firsResult).toBe(SENTINEL); // delegated — no menu at all
    expect(firsProvider.__hapaxLive()).toBeNull();
  });

  it("positive control: garde → garden opens a real menu (store is alive)", async () => {
    // Guards this file against vacuous no-menu results: the SAME store
    // DOES answer fragments of admitted mid/rare words through the same
    // provider path. 'garden' (measured q=86, mid band) occurs in
    // prose.jsonl. (The former control 'wate'→'Water' is obsolete under
    // the recalibrated bands: measured water q=121 lands in the REJECT
    // band, so 'wate' now yields [] — rejection there is CORRECT, not a
    // dead store. This is exactly the acceptance suite's canary.)
    expect(rankMatches(store, "garde").map((m) => m.display)).toEqual(["garden"]);
    const current = mockCurrent(SENTINEL);
    const provider = createHapaxProvider(store, cfg(), current);
    const result = await provider.getSuggestions(["garde"], 0, 5, opts());
    expect(result).not.toBe(SENTINEL); // menu, not delegation
    expect(result!.items.map((i) => i.value)).toEqual(["garden"]);
    expect(result!.prefix).toBe("garde");
    expect(provider.__hapaxLive()).not.toBeNull();
  });
});