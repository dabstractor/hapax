/**
 * Scripted integration acceptance suite (P1.M4.T1.S1) — the AUTOMATABLE
 * half of PRD §09 integration items 1–6, replayed against the REAL hapax
 * pipeline (ingest → store → query → provider match state) and the SHIPPED
 * dictionary artifact (dict/common-en.bin via loadDictionary(resolveDictPath())).
 *
 *   item 1 — session jargon completion (zendesk-lwlock.jsonl)
 *   item 2 — ordinary-prose no-hijack: zero candidates → delegate (prose.jsonl)
 *   item 3 — 100k-token session restore timing (large-100k.jsonl)
 *   item 4 — compaction: the store survives (no reset seam exists)
 *   item 5 — fake API keys are gate-rejected and never suggested
 *   item 6 — path/slash/@ delegation with byte-identical arguments
 *
 * Fixture corpus + hand labels: test/fixtures/sessions/ (expected.md).
 * NOT automatable here (documented in RESULTS.md, verified manually):
 * popup rendering, Tab insertion casing, keystroke debouncing, live
 * /acwords output, and with/without `-e` parity — `pi -p` never opens the
 * input box (ctx.mode === "print"), so this suite's real-extension check
 * (bottom) proves jiti load + clean run only.
 *
 * Anti-pattern honored on purpose: tests drive src/pi/ingest.ts,
 * src/core/* and src/pi/provider.ts — the REAL extension modules — never
 * a re-implementation of ingestion logic.
 */

import { spawn } from "node:child_process";

import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { describe, expect, it, vi, beforeAll, type Mock } from "vitest";

import { loadDictionary } from "../src/core/dictionary.js";
import type { Dictionary } from "../src/core/types.js";
import { maskSecrets, passesShape } from "../src/core/shapeGate.js";
import { rankMatches } from "../src/core/query.js";
import { CandidateStore } from "../src/core/store.js";
import type { CandidateDraft } from "../src/core/segment.js";
import {
  extractText,
  IngestPipeline,
  restoreFromHistory,
  type AgentMessage,
  type RestoreSessionManager,
} from "../src/pi/ingest.js";
import { resolveDictPath } from "../src/pi/paths.js";
import {
  createChainMachine,
  createDisplayProvider,
  createHapaxProvider,
  extractMatchState,
} from "../src/pi/provider.js";
import { DEFAULT_CONFIG, type HapaxConfig } from "../src/pi/config.js";
import {
  asSessionManager,
  messageEntriesOf,
  parseSessionFixture,
} from "./helpers/session-fixture.js";

const FIXTURES = "test/fixtures/sessions";

/** FAKE secret-shaped literals (generated for fixtures, never real). Must
 *  match test/fixtures/sessions/large-100k.jsonl and expected.md. */
const FAKE_SK = "sk-4f9a2c7e1b8d5a3f6e0c9b2d7f4a8e1c9d5b3a7f";
const FAKE_GHP = "ghp_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e";

/** Fresh store + real pipeline wired to the SHIPPED dictionary artifact. */
function makePipeline(): { store: CandidateStore; pipeline: IngestPipeline } {
  const store = new CandidateStore();
  const dictionary: Dictionary = loadDictionary(resolveDictPath());
  return { store, pipeline: new IngestPipeline({ store, dictionary }) };
}

/**
 * Replay a fixture through restoreFromHistory + the REAL pipeline and wait
 * for the fire-and-forget replay to finish. restoreFromHistory returns
 * void synchronously, so completion is observed by wrapping processText:
 * the wrapper resolves when every ingestable message (extractText !== null,
 * exactly what restore replays) has been processed. Returns the store plus
 * wall-clock restore time (item 3's measurement).
 */
async function ingestFixture(path: string): Promise<{ store: CandidateStore; pipeline: IngestPipeline; ms: number }> {
  const entries = parseSessionFixture(path);
  const total = messageEntriesOf(entries).filter(
    (e) => e.message !== undefined && extractText(e.message as unknown as AgentMessage) !== null,
  ).length;
  const { store, pipeline } = makePipeline();
  const real = pipeline.processText.bind(pipeline);
  let done = 0;
  let resolve!: () => void;
  const finished = new Promise<void>((r) => {
    resolve = r;
  });
  const t0 = performance.now();
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
  return { store, pipeline, ms: performance.now() - t0 };
}

/** Fresh config per call — never mutate DEFAULT_CONFIG (fixtures must work
 *  with DEFAULTS: trigger "#", threshold 2, maxSuggestions 8). */
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

/** Mock wrapped provider (contract-shaped spies — the delegation target
 *  whose call arguments the never-hijack assertions inspect). */
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

describe('acceptance item 1 — session jargon completes (zendesk-lwlock.jsonl)', () => {
  it("ingests the fixture into a non-empty store", async () => {
    const { store, pipeline } = await ingestFixture(`${FIXTURES}/zendesk-lwlock.jsonl`);
    expect(store.size).toBeGreaterThan(0);
    expect(pipeline.getStats().admitted).toBeGreaterThan(0);
  });

  it('threshold "ze" → exactly one candidate, top-1 display "Zendesk"', async () => {
    const { store } = await ingestFixture(`${FIXTURES}/zendesk-lwlock.jsonl`);
    const state = extractMatchState(["ze"], 0, 2, cfg());
    expect(state).toEqual({ mode: "threshold", fragment: "ze", prefix: "ze" });
    const matches = rankMatches(store, "ze");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]!.display).toBe("Zendesk"); // exact cased insertion string
    expect(matches.map((m) => m.display)).toEqual(["Zendesk"]); // expected.md label
  });

  it('provider "ze" → hapax menu with label "Zendesk", prefix "ze"', async () => {
    const { store } = await ingestFixture(`${FIXTURES}/zendesk-lwlock.jsonl`);
    const current = mockCurrent();
    const provider = createHapaxProvider(store, cfg(), current);
    const result = await provider.getSuggestions(["ze"], 0, 2, opts());
    expect(result).toEqual({
      items: [{ value: "Zendesk", label: "Zendesk", description: expect.stringMatching(/^session x\d+$/) }],
      prefix: "ze",
    });
    expect(provider.__hapaxLive()).not.toBeNull();
    expect(current.getSuggestions).not.toHaveBeenCalled(); // hapax answers, no delegation
  });

  it('trigger "#l" → trigger mode, top-1 display "lwlock", prefix "#l"', async () => {
    const { store } = await ingestFixture(`${FIXTURES}/zendesk-lwlock.jsonl`);
    const state = extractMatchState(["#l"], 0, 2, cfg());
    expect(state).toEqual({ mode: "trigger", fragment: "l", prefix: "#l" });
    const matches = rankMatches(store, "l");
    expect(matches[0]!.display).toBe("lwlock"); // exact cased insertion string
    // expected.md label for "#l" (lwlock must out-rank incidental l-words;
    // the loses/long tail order follows the real-corpus rank groups under
    // the calibrated bands — look=157 and long=138 sit in the REJECT band
    // (≥100) and never reach the store; loses=62, locks=58, logs=49 admit):
    expect(matches.map((m) => m.display)).toEqual(["lwlock", "locks", "logs", "loses"]);

    const provider = createHapaxProvider(store, cfg(), mockCurrent());
    const result = await provider.getSuggestions(["#l"], 0, 2, opts());
    expect(result!.items[0]!.value).toBe("lwlock");
    expect(result!.prefix).toBe("#l");
  });
});

describe("acceptance item 2 — ordinary prose never hijacks (prose.jsonl)", () => {
  /**
   * Two probe families — together they close the BUG-001 masking hole:
   *
   * SHORT_PROBES — the 2-char fragments from expected.md: each IS a
   * prefix of words occurring in the transcript, but every such source
   * word is shorter than the shape gate's 4-char minimum, so the store
   * holds no key under these prefixes → zero candidates → the provider
   * MUST delegate.
   *
   * COMMON_PROBES — ≥4-char top-common English words (all measured zero
   * candidates; artifact quants that=215, with=179, this=197, them=156,
   * have=190, would=156). These PASS the shape gate, so they exercise
   * the dictionary admission band directly: pre-bugfix item 2 probed
   * ONLY ≤3-char fragments, which the shape gate rejects by length
   * regardless of calibration — exactly how BUG-001 (every common word
   * admitted as rare) stayed invisible to this suite. The ≥4-char
   * probes make that blind spot impossible again. (With the real-corpus
   * shipped dictionary the REJECT band IS populated ('the', 'you', …),
   * so common prose words are rejected at admission; the prose store is not EMPTY — mid/rare words still admit. The
   * no-hijack contract is what these probes pin down.)
   */
  const SHORT_PROBES = ["of","on","at","be","by","do","go","he","in","it","no","or","so","to","up","we","me","my","us","if","re","men"];
  const COMMON_PROBES = ["that", "with", "this", "them", "have", "would"];
  const PROBES = [...SHORT_PROBES, ...COMMON_PROBES];

  it("ingests with the default config and stores only gate-passed words", async () => {
    const { store } = await ingestFixture(`${FIXTURES}/prose.jsonl`);
    expect(store.size).toBeGreaterThan(0); // mid/rare prose words still admit under the calibrated bands
    for (const probe of PROBES) {
      expect(rankMatches(store, probe), `probe "${probe}" must have zero candidates`).toEqual([]);
    }
  });

  it("every 2-char prose probe → zero candidates → delegates with unchanged args", async () => {
    const { store } = await ingestFixture(`${FIXTURES}/prose.jsonl`);
    // SHORT_PROBES only: queried mid-word (col 2), where prefixes of
    // ADMITTED words like "window" would legitimately open a menu for the
    // longer common words — the full-word common-probe gate lives below.
    for (const probe of SHORT_PROBES) {
      const current = mockCurrent(SENTINEL);
      const provider = createHapaxProvider(store, cfg(), current);
      const lines = [probe];
      const options = opts();
      const result = await provider.getSuggestions(lines, 0, 2, options);
      expect(result, `probe "${probe}" must return the delegate's result`).toBe(SENTINEL);
      expect(provider.__hapaxLive(), `probe "${probe}" must clear the live cache`).toBeNull();
      expect(current.getSuggestions, `probe "${probe}" must delegate to current`).toHaveBeenCalledOnce();
      const args = current.getSuggestions.mock.calls[0]!;
      expect(args[0]).toBe(lines); // same array object — never cloned
      expect(args[1]).toBe(0);
      expect(args[2]).toBe(2);
      expect(args[3]).toBe(options); // same options object
    }
  });

  it("common ≥4-char probes → zero candidates → delegates (BUG-001 gate)", async () => {
    // The full typed word at the cursor — the exact BUG-001 repro shape.
    // These probes pass the shape gate (≥4 chars), so delegation here can
    // only come from dictionary-band rejection, never the length rule.
    const { store } = await ingestFixture(`${FIXTURES}/prose.jsonl`);
    for (const probe of COMMON_PROBES) {
      const current = mockCurrent(SENTINEL);
      const provider = createHapaxProvider(store, cfg(), current);
      const lines = [probe];
      const options = opts();
      const result = await provider.getSuggestions(lines, 0, probe.length, options);
      expect(result, `probe "${probe}" must return the delegate's result`).toBe(SENTINEL);
      expect(provider.__hapaxLive(), `probe "${probe}" must clear the live cache`).toBeNull();
      expect(current.getSuggestions, `probe "${probe}" must delegate to current`).toHaveBeenCalledOnce();
      const args = current.getSuggestions.mock.calls[0]!;
      expect(args[0]).toBe(lines); // same array object — never cloned
      expect(args[1]).toBe(0);
      expect(args[2]).toBe(probe.length); // cursor after the full word
      expect(args[3]).toBe(options); // same options object
    }
  });

  it("positive control: a stored word fragment DOES open a hapax menu (garde → garden)", async () => {
    const { store } = await ingestFixture(`${FIXTURES}/prose.jsonl`);
    const provider = createHapaxProvider(store, cfg(), mockCurrent(SENTINEL));
    const result = await provider.getSuggestions(["garde"], 0, 5, opts());
    expect(result).not.toBe(SENTINEL); // menu, not delegation — the harness can tell the difference
    // 'garden' (corpus q=86, mid-frequency group 2) is stored and answers
    // the fragment; the former control word 'water' (q=121) now correctly
    // lands in the REJECT band and never reaches the store.
    expect(result!.items.map((i) => i.value)).toEqual(["garden"]);
    expect(result!.prefix).toBe("garde");
    expect(provider.__hapaxLive()).not.toBeNull();
  });
});

describe("acceptance item 3 — 100k-token session restores fast (large-100k.jsonl)", () => {
  // PRD §09 hard-regression threshold is 3× the <100 ms budget; CI machines
  // are noisy, so the gate here is the loose 300 ms margin. The exact
  // measured number from the validation run is recorded in
  // test/fixtures/sessions/RESULTS.md (item 3).
  it("restoreFromHistory completes well under the 300 ms CI margin", async () => {
    const { store, ms } = await ingestFixture(`${FIXTURES}/large-100k.jsonl`);
    expect(ms).toBeLessThan(300);
    expect(store.size).toBeGreaterThan(0);
    // Completions are available immediately afterwards (no warm-up pass):
    expect(rankMatches(store, "kes").map((m) => m.display)).toEqual(["kestrel"]);
  });

  it("replays a large vocabulary through the same bounded store", async () => {
    const { store } = await ingestFixture(`${FIXTURES}/large-100k.jsonl`);
    expect(store.size).toBeLessThanOrEqual(20_000); // STORE_CAP holds on restore
    // Rare terms recur across the whole history — they survive replay:
    expect(rankMatches(store, "verd").map((m) => m.display)).toEqual(["Verdigris"]);
    expect(rankMatches(store, "zeph").map((m) => m.display)).toEqual(["zephyr"]);
  });
});

describe("acceptance item 4 — compaction never resets the store", () => {
  // Seam reality (src/pi/index.ts): hapax registers NO compaction handler —
  // when pi compacts, history entries are replaced and hapax simply observes
  // nothing; the in-memory store survives by design (PRD §05 h2.32). The
  // scripted halves below pin the two behaviors that ARE code-owned:
  // (a) compaction-typed history entries never ingest on the restore path;
  // (b) a message_end after compaction keeps prior admissions and grows the
  //     store — no reset anywhere on the post-compaction path.
  // The live half (/compact in a running session, then /acwords) is manual —
  // see RESULTS.md item 4.

  it("compaction-typed history entries are skipped by restore, contributing nothing", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/zendesk-lwlock.jsonl`);
    const withCompaction = [...entries];
    // pi-shaped compaction entry spliced mid-history:
    withCompaction.splice(3, 0, {
      type: "compaction",
      id: "c1",
      parentId: "e02",
      timestamp: "2025-02-10T10:00:20.000Z",
      summary: "earlier work summarized",
      firstKeptEntryId: "e01",
      tokensBefore: 1234,
    });
    const a = new CandidateStore();
    const b = new CandidateStore();
    const dictA = loadDictionary(resolveDictPath());
    const dictB = loadDictionary(resolveDictPath());
    await replayEntries(withCompaction, a, dictA);
    await replayEntries(entries, b, dictB);
    expect(a.size).toBe(b.size); // identical stores…
    expect(rankMatches(a, "ze")).toEqual(rankMatches(b, "ze")); // …compaction entry added nothing
  });

  it("message_end after compaction: store persists, prior word still completes", async () => {
    const { store, pipeline } = await ingestFixture(`${FIXTURES}/zendesk-lwlock.jsonl`);
    const sizeBefore = store.size;
    expect(sizeBefore).toBeGreaterThan(0);
    expect(rankMatches(store, "ze")[0]!.display).toBe("Zendesk");

    // Compaction HAPPENS here — pi replaces history entries; hapax has no
    // handler and no reset path, so nothing observes it (by design).

    // Post-compaction traffic still ingests into the SAME store:
    pipeline.onMessageEnd({
      role: "user",
      content: "lwlock again - the Zendesk ticket reopened and waits climbed",
      timestamp: 0,
    } as AgentMessage);
    await pipeline.flush();
    expect(store.size).toBeGreaterThanOrEqual(sizeBefore); // never reset, never emptied
    expect(store.size).toBeGreaterThan(0);
    expect(rankMatches(store, "ze")[0]!.display).toBe("Zendesk"); // prior word still completes
    expect(rankMatches(store, "lw")[0]!.display).toBe("lwlock");
  });
});

describe("acceptance item 5 — fake API keys are never suggested (large-100k.jsonl)", () => {
  let store: CandidateStore;
  beforeAll(async () => {
    const ingested = await ingestFixture(`${FIXTURES}/large-100k.jsonl`);
    store = ingested.store;
  }, 120_000);

  it("both fake credentials are secret-shaped (passesShape rejects directly)", () => {
    const draftOf = (display: string): CandidateDraft => ({
      key: display.toLowerCase(),
      display,
      properName: false,
      isSubword: false,
    });
    expect(passesShape(draftOf(FAKE_SK))).toEqual({ ok: false, reason: "secret" });
    expect(passesShape(draftOf(FAKE_GHP))).toEqual({ ok: false, reason: "secret" });
  });

  it("keys are masked before the gate (BUG-003 layer 1) — never become drafts", () => {
    // BUG-003 fix (001_9e0f97150b68): maskSecrets() blanks the raw key
    // windows in IngestPipeline.#admitSegment BEFORE tokenize, so FAKE_SK
    // and FAKE_GHP never become candidate drafts and never reach
    // isSecretShaped — the old "≥ 2 secret rejections" assertion tested
    // the layer-2-only path, which layer 1 short-circuits by design. The
    // never-suggested outcome now holds one layer earlier: the sibling
    // test pins zero key bytes in the store and empty probe results.
    // maskSecrets still claims both windows, length-preserving:
    for (const key of [FAKE_SK, FAKE_GHP]) {
      const masked = maskSecrets(key);
      expect(masked.length).toBe(key.length);
      expect(masked.trim()).toBe(""); // all spaces — fully blanked
    }
  });

  it("key prefixes never yield the key in any top-8", () => {
    const cores = [FAKE_SK.slice(2), FAKE_GHP.slice(4)]; // hexish alnum cores
    for (const prefix of ["sk", "gh", FAKE_SK.slice(0, 6), FAKE_GHP.slice(0, 7)]) {
      const matches = rankMatches(store, prefix);
      for (const m of matches) {
        expect(cores.some((core) => m.key.includes(core) || m.display.includes(core))).toBe(false);
      }
    }
    // And the exact probe labels from expected.md: all empty.
    for (const prefix of ["sk", "gh", "sk-4f9", "ghp_9f8"]) {
      expect(rankMatches(store, prefix), `prefix "${prefix}"`).toEqual([]);
    }
    // Direct store check: the keys themselves were never stored.
    expect(store.get(FAKE_SK.toLowerCase())).toBeUndefined();
    expect(store.get(FAKE_GHP.toLowerCase())).toBeUndefined();
  });
});

describe("acceptance item 6 — path/slash/@ requests delegate with byte-identical args", () => {
  // Scripted half. The LIVE parity check (identical behavior with and
  // without `-e` on the real input box) is manual — RESULTS.md item 6.
  // Quoted paths hit the NULL match state; "/re" and "@men" produce
  // threshold states whose fragments have zero candidates in a prose-only
  // store — both must end in delegation with the ORIGINAL arguments.
  let store: CandidateStore;
  beforeAll(async () => {
    store = (await ingestFixture(`${FIXTURES}/prose.jsonl`)).store;
  }, 60_000);

  const cases: { name: string; lines: string[]; col: number; nullState: boolean }[] = [
    { name: 'quoted path read "./src/co', lines: ['read "./src/co'], col: 15, nullState: true },
    { name: "slash command /re", lines: ["/re"], col: 3, nullState: false },
    { name: "@mention @men", lines: ["say hi to @men"], col: 14, nullState: false },
  ];

  it.each(cases)("$name → delegates once, args untouched", async ({ lines, col, nullState }) => {
    const state = extractMatchState(lines, 0, col, cfg());
    if (nullState) {
      expect(state).toBeNull(); // hapax has no opinion at all
    } else {
      expect(state).not.toBeNull();
      expect(rankMatches(store, state!.fragment)).toEqual([]); // zero candidates → delegate
    }
    const current = mockCurrent(SENTINEL);
    const provider = createHapaxProvider(store, cfg(), current);
    const options = opts();
    const result = await provider.getSuggestions(lines, 0, col, options);
    expect(result).toBe(SENTINEL); // pass-through, not a copy
    expect(current.getSuggestions).toHaveBeenCalledOnce();
    const args = current.getSuggestions.mock.calls[0]!;
    expect(args[0]).toBe(lines); // same array object — never cloned
    expect(args[1]).toBe(0);
    expect(args[2]).toBe(col);
    expect(args[3]).toBe(options); // same options object — force/signal intact
    expect(provider.__hapaxLive()).toBeNull();
  });
});

/**
 * Real-extension scripted check (PRD §09 evidence that the extension as
 * SHIPPED loads through pi's jiti loader and survives a real turn):
 * `pi -p -e <repo> --no-builtin-tools "<trivial prompt mentioning Zendesk>"`.
 *
 * What this CAN prove: exit 0, jiti load of src/pi/index.ts, message_end
 * wiring running on the real runtime, no extension errors on stderr.
 * What it CANNOT prove: anything about the input-box popup — `pi -p` never
 * opens the editor (ctx.mode === "print"); popup/Tab/debounce items are
 * MANUAL (RESULTS.md).
 *
 * Network-gated: the prompt needs a reachable model. When the environment
 * is offline or unauthenticated the check SKIPS (never fails CI); a real
 * extension load error still fails.
 */
describe("acceptance — real extension loads under pi -p -e (network-gated)", () => {
  /** spawn (not execFile): `pi -p` waits on stdin when stdin is an open
   *  pipe, which deadlocks under execFile — stdin must be IGNORED, exactly
   *  like an interactive `pi -p` run in a terminal with EOF available. */
  const runPi = (): Promise<{ stdout: string; stderr: string; code: number | null }> =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "pi",
        ["-p", "-e", process.cwd(), "--no-builtin-tools", "say Zendesk lwlock"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("pi -p timed out after 120000 ms"));
      }, 120_000);
      child.stdout.on("data", (d: Buffer) => (stdout += d));
      child.stderr.on("data", (d: Buffer) => (stderr += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });

  it("pi -p -e loads the real extension and answers cleanly", async (ctx) => {
    try {
      const { stdout, stderr, code } = await runPi();
      expect(code).toBe(0); // exit 0
      expect(stdout.trim().length).toBeGreaterThan(0); // the model answered
      expect(stderr).not.toMatch(/hapax/i); // no extension errors leaked to stderr
    } catch (error) {
      const err = error as { message?: string; code?: string };
      const evidence = err.message ?? "";
      const environmental =
        /ENOENT/i.test(err.code ?? evidence) ||
        /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timed out|aborted/i.test(evidence) ||
        /\b(401|402|403|429)\b|unauthor|api key|quota|rate limit|credit|billing|no available model|provider/i.test(evidence);
      if (environmental) {
        ctx.skip(); // offline / unauthenticated / no pi — record in RESULTS.md, never fail CI
      }
      throw error; // anything else IS an acceptance failure (real extension error)
    }
  }, 180_000);
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** Replay pre-parsed entries into a fresh store (item 4's A/B compare). */
async function replayEntries(
  entries: ReturnType<typeof parseSessionFixture>,
  store: CandidateStore,
  dictionary: Dictionary,
): Promise<void> {
  const pipeline = new IngestPipeline({ store, dictionary });
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
    },
    asSessionManager(entries) as unknown as RestoreSessionManager,
  );
  await finished;
}


// ─────────────────────────────────────────────────────────────────────────────
// Item 7 (P2.M2.T3.S1, PRD §09 DoD M2): accept `National` → chain offers
// `Renewable` → Tab → `Energy` → Tab → `Laboratory` with ZERO additional
// typed characters — driven through the REAL provider (chain machine,
// pending offer) against a store built from the NEW nrel.jsonl fixture via
// the real ingest pipeline (phrase hook wired exactly like src/pi/index.ts)
// and the SHIPPED dictionary.
//
// Fixture phases (the seeding-order gotcha from test/chain.test.ts, applied
// to a real fixture): the chain bigrams recur ×4, so they are ADMITTED
// phrases and h3.8 constituent suppression permanently shadows the bare
// word "National" in "natio"-prefixed menus once they land. The arming
// accept therefore happens on the EARLY (phrase-free) prefix of the
// transcript — phase 1, messages n01–n03 — exactly like armViaTab queries
// the menu before its bigrams are recorded; the phrase-bearing messages
// (phase 2) replay afterwards and fill the successor index. This mirrors a
// real session: the user accepts the word before the repeated phrase ever
// occurs; the chain engages on the very next query with zero typing.
// ─────────────────────────────────────────────────────────────────────────────

/** Entries 0..PHASE1 (header + n01–n03) carry NO "National Renewable …"
 *  adjacency; PHASE1.. carries the four verbatim phrase occurrences. */
const NREL_PHASE1 = 4;

/** Pipeline wired like src/pi/index.ts's session_start: the phrase hook
 *  (and with it the successor index) exists ONLY under enablePhrases. */
function makeNrelPipeline(enablePhrases: boolean): { store: CandidateStore; pipeline: IngestPipeline } {
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

/** Replay pre-parsed fixture entries through restoreFromHistory on the
 *  GIVEN pipeline (phase splitting needs two replays into one store). */
async function replayNrel(
  pipeline: IngestPipeline,
  entries: ReturnType<typeof parseSessionFixture>,
): Promise<void> {
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
    },
    asSessionManager(entries) as unknown as RestoreSessionManager,
  );
  await finished;
}

/** Editing-harness mock: pi-shaped current provider whose applyCompletion
 *  performs pi-tui's insertion (replace `prefix` before the cursor with
 *  item.value) on persistent state, so the test drives ONE buffer through
 *  accepts exactly like the editor would. `state` is the buffer. */
function editingCurrent() {
  const state = { lines: ["natio"], cursorLine: 0, cursorCol: 5 };
  return {
    state,
    getSuggestions: vi.fn(
      async (lines: string[], cursorLine: number, cursorCol: number, options: { signal: AbortSignal }) => null,
    ),
    applyCompletion: vi.fn(
      (lines: string[], cursorLine: number, cursorCol: number, item: AutocompleteItem, prefix: string) => {
        const line = lines[cursorLine] ?? "";
        const before = line.slice(0, cursorCol - prefix.length);
        const after = line.slice(cursorCol);
        const newLines = [...lines];
        newLines[cursorLine] = before + item.value + after;
        state.lines = newLines;
        state.cursorLine = cursorLine;
        state.cursorCol = before.length + item.value.length;
        return { lines: newLines, cursorLine, cursorCol: state.cursorCol };
      },
    ),
  };
}

describe("acceptance item 7 — chained completion, zero typed characters (nrel.jsonl)", () => {
  it("fixture sanity — real ingest builds the strictly top-ranked successor chain and admits the NREL vocabulary", async () => {
    const { store, pipeline } = makeNrelPipeline(true);
    const nrel = parseSessionFixture(`${FIXTURES}/nrel.jsonl`);
    await replayNrel(pipeline, nrel);

    // Successor chain (PRD §06 h3.9), deterministic top-1 per word:
    expect(store.topSuccessors("national")).toEqual([
      { next: "renewable", count: 4 },
      { next: "license", count: 1 },
      { next: "wind", count: 1 },
    ]);
    expect(store.topSuccessors("renewable")).toEqual([{ next: "energy", count: 4 }]);
    expect(store.topSuccessors("energy")).toEqual([{ next: "laboratory", count: 4 }]);

    // The vocabulary admits as word candidates (replay for the phrase
    // bigrams also stores the tokens themselves):
    expect(store.get("national")).toBeDefined();
    expect(store.get("nrel")?.display).toBe("NREL"); // acronym stays a rare word
    expect(store.phraseSize).toBeGreaterThan(0);

    // Documented consequence (drives the phase-split arming below): with
    // the phrase bigrams admitted, h3.8 suppression shadows the bare word.
    const menu = rankMatches(store, "natio");
    expect(menu.map((m) => m.description)).toEqual(["phrase", "phrase"]);
  });

  it("zero-typing chain — accept National → renewable → energy → laboratory with no fragment characters between accepts", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/nrel.jsonl`);
    // One pipeline instance feeding one store across both phases:
    const { store, pipeline } = makeNrelPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg(), current, chain);

    // Phase 1: phrase-free traffic only.
    await replayNrel(pipeline, entries.slice(0, NREL_PHASE1));

    // Live menu for "natio" contains the whole-word item (no phrases yet):
    const menu = await provider.getSuggestions(["natio"], 0, 5, opts());
    expect(menu?.items).toEqual([
      { value: "National", label: "National", description: expect.stringMatching(/^session x\d+$/) },
    ]);
    expect(menu?.prefix).toBe("natio");

    // Tab accepts it → harness buffer "natio" becomes "National", cursor
    // adjacent; the arming intercept arms the chain (T2.S1).
    const nationalItem: AutocompleteItem = { value: "National", label: "National" };
    provider.applyCompletion(["natio"], 0, 5, nationalItem, "natio");
    expect(chain.state()).toEqual({ word: "national" });
    expect(current.state.lines).toEqual(["National"]);
    expect(current.state.cursorCol).toBe(8);

    // Phase 2: the four verbatim phrase occurrences land (successor index
    // fills) — NO keystrokes, NO chain reset in between.
    await replayNrel(pipeline, entries.slice(NREL_PHASE1));

    // ZERO typed characters: the very next getSuggestions runs on the
    // post-accept buffer ("National", cursor 8) and the PENDING OFFER
    // answers with the armed word's unfiltered successors at prefix "".
    const offer1 = await provider.getSuggestions(current.state.lines, 0, current.state.cursorCol, opts());
    expect(offer1?.prefix).toBe("");
    expect(offer1?.items.map((i) => [i.label, i.value])).toEqual([
      ["renewable", " renewable"], // leading space: pi inserts value verbatim
      ["license", " license"],
      ["wind", " wind"],
    ]);
    expect(provider.__hapaxLive()?.prefix).toBe("");

    // Tab → harness inserts " renewable" (no typed characters); re-armed.
    provider.applyCompletion(current.state.lines, 0, current.state.cursorCol, offer1!.items[0]!, offer1!.prefix);
    expect(chain.state()).toEqual({ word: "renewable" });
    expect(current.state.lines).toEqual(["National renewable"]);
    const colAfterRenewable = current.state.cursorCol;

    const offer2 = await provider.getSuggestions(current.state.lines, 0, current.state.cursorCol, opts());
    expect(offer2?.prefix).toBe("");
    expect(offer2?.items.map((i) => i.label)).toEqual(["energy"]); // sole successor
    provider.applyCompletion(current.state.lines, 0, current.state.cursorCol, offer2!.items[0]!, offer2!.prefix);
    expect(chain.state()).toEqual({ word: "energy" });
    expect(current.state.lines).toEqual(["National renewable energy"]);

    const offer3 = await provider.getSuggestions(current.state.lines, 0, current.state.cursorCol, opts());
    expect(offer3?.items.map((i) => i.label)).toEqual(["laboratory"]);
    provider.applyCompletion(current.state.lines, 0, current.state.cursorCol, offer3!.items[0]!, offer3!.prefix);

    // Full insertion sequence landed; the chain rests armed at the final
    // word (it still has successors, so it does not disarm).
    expect(current.state.lines).toEqual(["National renewable energy laboratory"]);
    expect(current.state.cursorCol).toBe("National renewable energy laboratory".length);
    expect(chain.state()).toEqual({ word: "laboratory" });

    // Zero-typing proof: cursor positions between accepts came ONLY from
    // accepts (each offer was queried exactly at the previous accept's
    // landed cursor), and hapax answered every query — no delegation.
    expect(colAfterRenewable).toBe("National renewable".length);
    expect(current.getSuggestions).not.toHaveBeenCalled();
  });

  it("pending offer is one-shot and adjacency-gated — word-less queries keep T2.S1 disarm semantics", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/nrel.jsonl`);
    const { store, pipeline } = makeNrelPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg(), current, chain);

    await replayNrel(pipeline, entries.slice(0, NREL_PHASE1));
    await provider.getSuggestions(["natio"], 0, 5, opts());
    provider.applyCompletion(["natio"], 0, 5, { value: "National", label: "National" }, "natio");
    await replayNrel(pipeline, entries.slice(NREL_PHASE1));

    // FIRST post-accept query word-less ("National ") → NOT adjacent
    // (trailing whitespace) → T2.S1 disarm + delegate, not the offer.
    const options = opts();
    const result = await provider.getSuggestions(["National "], 0, 9, options);
    expect(result).toBeNull();
    expect(current.getSuggestions).toHaveBeenCalledOnce();
    expect(current.getSuggestions.mock.calls[0][3]).toBe(options);
    expect(chain.state()).toBeNull();

    // The pending word was consumed by that one-shot query (it never
    // re-fires): a later adjacency-position query takes the NORMAL path —
    // phrase-shadowed menu at threshold — with no chain menu.
    const normal = await provider.getSuggestions(["National"], 0, 8, opts());
    expect(normal?.prefix).toBe("National");
    expect(normal?.items[0]?.description).toBe("phrase");
    expect(chain.state()).toBeNull();
  });

  it("typed fragments after an arm still filter through the T2.S1 armed branch (no pending double-fire)", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/nrel.jsonl`);
    const { store, pipeline } = makeNrelPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg(), current, chain);

    await replayNrel(pipeline, entries.slice(0, NREL_PHASE1));
    await provider.getSuggestions(["natio"], 0, 5, opts());
    provider.applyCompletion(["natio"], 0, 5, { value: "National", label: "National" }, "natio");
    await replayNrel(pipeline, entries.slice(NREL_PHASE1));

    // First post-accept query carries a typed fragment "r": adjacency
    // fails, pending is consumed one-shot, and the FRAGMENT rules answer —
    // live-filtered successors at the fragment, threshold 1 (T2.S1).
    const filtered = await provider.getSuggestions(["National r"], 0, 10, opts());
    expect(filtered?.prefix).toBe("r");
    expect(filtered?.items).toEqual([
      { value: "renewable", label: "renewable", description: "chain" },
    ]);
    expect(chain.state()).toEqual({ word: "national" });

    // Further typing keeps filtering live (never re-offers unfiltered):
    const narrowed = await provider.getSuggestions(["National re"], 0, 11, opts());
    expect(narrowed?.prefix).toBe("re");
    expect(narrowed?.items.map((i) => i.label)).toEqual(["renewable"]);
    expect(chain.state()).toEqual({ word: "national" });
  });

  it("reset (new user turn) clears the pending offer with the arm", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/nrel.jsonl`);
    const { store, pipeline } = makeNrelPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg(), current, chain);

    await replayNrel(pipeline, entries.slice(0, NREL_PHASE1));
    await provider.getSuggestions(["natio"], 0, 5, opts());
    provider.applyCompletion(["natio"], 0, 5, { value: "National", label: "National" }, "natio");
    await replayNrel(pipeline, entries.slice(NREL_PHASE1));

    chain.reset(); // the before_agent_start handler

    // Adjacent cursor position, but the arm (and its pending offer) is
    // gone: plain threshold matching answers — phrase-shadowed menu.
    const menu = await provider.getSuggestions(["National"], 0, 8, opts());
    expect(menu?.prefix).toBe("National");
    expect(menu?.items[0]?.description).toBe("phrase");
    expect(chain.state()).toBeNull();
  });

  it("pending offer flows through the display layer's classification (prefix \"\" on both sides)", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/nrel.jsonl`);
    const { store, pipeline } = makeNrelPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const inner = createHapaxProvider(store, cfg(), current, chain);
    const display = createDisplayProvider(inner);

    await replayNrel(pipeline, entries.slice(0, NREL_PHASE1));
    // Arm on the inner provider (Tab resolves against the live cache —
    // the display layer never gates the inner query, S3 rule 1).
    await inner.getSuggestions(["natio"], 0, 5, opts());
    inner.applyCompletion(["natio"], 0, 5, { value: "National", label: "National" }, "natio");
    await replayNrel(pipeline, entries.slice(NREL_PHASE1));

    // The pending offer through the DISPLAY provider: live prefix "" and
    // result prefix "" match → classified hapax → painted immediately
    // (first paint of this stack is never delayed, S3 rule 4a).
    const painted = await display.getSuggestions(["National"], 0, 8, opts());
    expect(painted?.prefix).toBe("");
    expect(painted?.items.map((i) => i.label)).toEqual(["renewable", "license", "wind"]);
    expect(display.dispose).toBeDefined();
  });
});
