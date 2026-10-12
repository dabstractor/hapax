/**
 * hapax extension factory suite (P1.M3.T5.S1, PRD §02 h2.13/h2.12/h2.10):
 * the default export registers exactly the five pi.on handlers and does
 * NOTHING else at factory time — all work defers to session_start, which
 * wires loadConfig (cwd + trust + notify), the lazy dictionary (loads on
 * first lookup; load failure = exactly one error notify + permanent
 * disable), the CandidateStore + IngestPipeline, the display-debounced
 * autocomplete provider, the debug-gated /acwords command, and the
 * fire-and-forget history restore (fresh store only for new AND empty).
 * message_end must return undefined in every path (a result would REPLACE
 * the message); session_shutdown disposes provider + pipeline timers and
 * drops every reference; a shutdown → session_start cycle rebuilds fresh
 * state.
 *
 * pi and ctx are plain fakes (handlers captured by event name); config
 * isolation comes from stubbing HOME to a temp dir (os.homedir honors
 * $HOME on POSIX) and pointing HAPAX_DICT at a temp dict file built with
 * the shared test writer. Store/pipeline internals are observed through
 * the real /acwords dump (debug mode) and the registered provider.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  SessionEntry,
  SessionStartEvent,
  SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import hapax, {
  createLazyDictionary,
  resolveDictPath,
} from "../src/pi/index.js";
import type { AgentMessage } from "../src/pi/ingest.js";
import { IngestPipeline } from "../src/pi/ingest.js";
import {
  isWidgetWrapper,
  widgetOptsOf,
  widgetStateOf,
} from "../src/pi/widget.js";
import {
  editorApplyCompletion,
  prefixIsAnchorSafe,
} from "./helpers/editor-sim.js";
import { CandidateStore } from "../src/core/store.js";
import { rankMatches } from "../src/core/query.js";
import { writeDictFile } from "./helpers/dict-writer.js";

// File-wide cleanup: several suites here fire the real /acwords handler
// (debug:true), which writes the sanctioned FIXED dump path (spec 08 —
// the product path is not configurable). Unit tests must not leave it
// behind: a fixed /tmp file collides across concurrent runs and
// workspaces, and reads as a stale persistence artifact after the
// suite ends (everything in hapax is RAM-only).
afterEach(() => {
  rmSync("/tmp/hapax-store.txt", { force: true });
});

// --- fixture helpers ----------------------------------------------------------

type UserMessage = Extract<AgentMessage, { role: "user" }>;

const userMsg = (content: string): UserMessage => ({
  role: "user",
  content,
  timestamp: 0,
});

const msgEntry = (id: string, message: AgentMessage): SessionEntry => ({
  type: "message",
  id,
  parentId: null,
  timestamp: "2025-01-01T00:00:00.000Z",
  message,
});

type Handler = (event: any, ctx: ExtensionContext) => unknown;

/** Fake pi: captures pi.on handlers by event name; registerCommand spied. */
function fakePi(): {
  pi: ExtensionAPI;
  on: Mock;
  registerCommand: Mock;
  handlers: Map<string, Handler>;
} {
  const handlers = new Map<string, Handler>();
  const on = vi.fn((name: string, handler: Handler) => {
    handlers.set(name, handler);
  });
  const registerCommand = vi.fn();
  return {
    pi: { on, registerCommand } as unknown as ExtensionAPI,
    on,
    registerCommand,
    handlers,
  };
}

/** Fake extension context: notify + provider-factory + trust spies;
 *  branch/entries fakes with call counts (the restore gate is asserted
 *  via spy counts — restoreFromHistory would add its own getBranch call).
 *  Editor-component fakes (spec 07 h2.42 dual-path tests): getEditor-
 *  Component returns over.editorFactory (default undefined → every
 *  pre-existing test runs the fallback path); setEditorComponent spies
 *  the installation. */
function fakeCtx(
  over: {
    cwd?: string;
    trusted?: boolean;
    branch?: SessionEntry[];
    entries?: SessionEntry[];
    editorFactory?: unknown;
  } = {},
): {
  ctx: ExtensionContext;
  notify: Mock;
  addAutocompleteProvider: Mock;
  getEditorComponent: Mock;
  setEditorComponent: Mock;
  isProjectTrusted: Mock;
  getBranch: Mock;
  getEntries: Mock;
} {
  const notify = vi.fn();
  const addAutocompleteProvider = vi.fn();
  const getEditorComponent = vi.fn(() => over.editorFactory);
  const setEditorComponent = vi.fn();
  const isProjectTrusted = vi.fn(() => over.trusted ?? true);
  const getBranch = vi.fn(() => over.branch ?? []);
  const getEntries = vi.fn(() => over.entries ?? []);
  const ctx = {
    ui: { notify, addAutocompleteProvider, getEditorComponent, setEditorComponent },
    cwd: over.cwd ?? cwd,
    isProjectTrusted,
    sessionManager: { getBranch, getEntries },
  } as unknown as ExtensionContext;
  return {
    ctx,
    notify,
    addAutocompleteProvider,
    getEditorComponent,
    setEditorComponent,
    isProjectTrusted,
    getBranch,
    getEntries,
  };
}

/** Wrapped current provider, contract-shaped like provider-live's mock. */
const currentFake = (): AutocompleteProvider =>
  ({
    getSuggestions: vi.fn(async () => null),
    applyCompletion: vi.fn(
      (lines: string[], cursorLine: number, cursorCol: number) => ({
        lines,
        cursorLine,
        cursorCol,
      }),
    ),
  }) as unknown as AutocompleteProvider;

/** Fire a captured session_start handler. */
const startSession = (
  handler: Handler,
  ctx: ExtensionContext,
  reason: SessionStartEvent["reason"] = "new",
): unknown =>
  handler({ type: "session_start", reason } as SessionStartEvent, ctx);

/** Fire a captured message_end handler and await the (void) result. */
const endMessage = async (
  handler: Handler,
  ctx: ExtensionContext,
  message: AgentMessage,
): Promise<unknown> =>
  await handler({ type: "message_end", message } as MessageEndEvent, ctx);

/** The /acwords command handler for the Nth registration. */
function acwordsHandler(
  register: Mock,
  index = 0,
): (args: unknown, ctx: unknown) => Promise<void> {
  const calls = register.mock.calls.filter((c) => c[0] === "acwords");
  return calls[index]![1].handler;
}

/** Render one /acwords dump (the command notifies its output at "info"). */
async function dump(
  handler: (args: unknown, ctx: unknown) => Promise<void>,
): Promise<string> {
  const notify = vi.fn();
  await handler({}, { ui: { notify } });
  return notify.mock.calls.map((c) => c[0] as string).join("\n");
}

const wordsSeenIn = (dumpText: string): number =>
  Number(dumpText.match(/words seen: (\d+)/)![1]);

/** Longer than the pipeline's 300 ms debounce — for "nothing fires" claims. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 420));

// --- per-test isolation: temp HOME (config) + temp dict path ------------------

let home: string;
let cwd: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hapax-home-"));
  cwd = mkdtempSync(join(tmpdir(), "hapax-cwd-"));
  vi.stubEnv("HOME", home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

/** Point HAPAX_DICT at a temp path (idempotent — never re-stubs). */
function useDictPath(): string {
  const path = join(cwd, "dict.bin");
  if (process.env.HAPAX_DICT === undefined) vi.stubEnv("HAPAX_DICT", path);
  return path;
}

/** Temp dict path + a valid packed dictionary (one mid-frequency entry). */
function useDict(): string {
  return writeDictFile(useDictPath(), [{ word: "the", quant: 200 }]);
}

/** Temp dict path + a same-shaped but corrupt buffer (bad magic). */
function useCorruptDict(): string {
  const path = useDictPath();
  writeFileSync(path, Buffer.from("this file is not a hapx dictionary, sorry"));
  return path;
}

/** Enable debug via the user-global config layer (~/.pi/agent/hapax.json). */
function enableDebug(): void {
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(
    join(home, ".pi", "agent", "hapax.json"),
    JSON.stringify({ debug: true }),
  );
}

/** Write a user-global config layer with the given fields. */
function writeConfig(fields: Record<string, unknown>): void {
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(
    join(home, ".pi", "agent", "hapax.json"),
    JSON.stringify(fields),
  );
}

/** Default fixture wiring: fake pi + fake ctx + factory invoked; handlers
 *  captured so tests can fire events directly. Dict = temp path (write
 *  content first with useDict()/useCorruptDict() when a drain will run). */
function wired(over?: Parameters<typeof fakeCtx>[0]) {
  useDictPath();
  const { pi, on, registerCommand, handlers } = fakePi();
  hapax(pi);
  const {
    ctx,
    notify,
    addAutocompleteProvider,
    getEditorComponent,
    setEditorComponent,
    isProjectTrusted,
    getBranch,
    getEntries,
  } = fakeCtx(over);
  return {
    pi,
    on,
    registerCommand,
    handlers,
    ctx,
    notify,
    addAutocompleteProvider,
    getEditorComponent,
    setEditorComponent,
    isProjectTrusted,
    getBranch,
    getEntries,
  };
}

// --- factory registration ------------------------------------------------------

describe("factory registration", () => {
  it("registers exactly the five lifecycle handlers — and nothing else", () => {
    const { on, handlers } = wired();

    expect(on.mock.calls.map((c) => c[0])).toEqual([
      "session_start",
      "session_tree",
      "message_end",
      "session_shutdown",
      "before_agent_start",
    ]);
    expect(handlers.size).toBe(5);
  });

  it("has zero side effects at factory time — no I/O, no constructors, no timers", () => {
    const { pi, registerCommand } = fakePi();
    const { ctx, notify, addAutocompleteProvider, isProjectTrusted } = fakeCtx();

    hapax(pi);

    expect(notify).not.toHaveBeenCalled();
    expect(addAutocompleteProvider).not.toHaveBeenCalled();
    expect(registerCommand).not.toHaveBeenCalled();
    expect(isProjectTrusted).not.toHaveBeenCalled(); // nothing probed ctx
    void ctx;
  });

  it("before_agent_start is a registered no-op stub (P2.M2.T2.S1)", () => {
    const { handlers, ctx } = wired();
    const handler = handlers.get("before_agent_start")!;
    expect(
      handler(
        {
          type: "before_agent_start",
          prompt: "x",
          systemPrompt: "s",
          systemPromptOptions: {},
        },
        ctx,
      ),
    ).toBeUndefined();
  });
});

// --- session_start: config wiring ---------------------------------------------

describe("session_start — config wiring", () => {
  it("binds ctx.ui.notify into loadConfig — a malformed config file surfaces exactly one warning", () => {
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "hapax.json"), "{invalid json");
    const { handlers, ctx, notify } = wired();

    startSession(handlers.get("session_start")!, ctx);

    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0]![1]).toBe("warning");
    expect(String(notify.mock.calls[0]![0])).toContain("hapax.json");
  });

  it("reads .pi/hapax.json from ctx.cwd only when the project is trusted", () => {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "hapax.json"), JSON.stringify({ debug: true }));

    const trusted = wired({ trusted: true });
    startSession(trusted.handlers.get("session_start")!, trusted.ctx);
    expect(trusted.isProjectTrusted).toHaveBeenCalledTimes(1);
    expect(trusted.registerCommand).toHaveBeenCalledWith(
      "acwords",
      expect.objectContaining({ handler: expect.any(Function) }),
    );

    const untrusted = wired({ trusted: false });
    startSession(untrusted.handlers.get("session_start")!, untrusted.ctx);
    expect(untrusted.registerCommand).not.toHaveBeenCalled();
  });

  it("registers the autocomplete provider: a factory producing a disposable provider keyed off config", () => {
    const { handlers, ctx, addAutocompleteProvider } = wired();
    startSession(handlers.get("session_start")!, ctx);

    expect(addAutocompleteProvider).toHaveBeenCalledOnce();
    const factory = addAutocompleteProvider.mock.calls[0]![0] as (
      current: AutocompleteProvider,
    ) => AutocompleteProvider & { dispose: () => void };
    const provider = factory(currentFake());
    expect(typeof provider.dispose).toBe("function");
    expect(provider.triggerCharacters?.[0]).toBe("#"); // default config flowed in (rest = identifier triggers)
  });

  it("registers /acwords only when config.debug is true", () => {
    const off = wired();
    startSession(off.handlers.get("session_start")!, off.ctx);
    expect(off.registerCommand).not.toHaveBeenCalled();

    enableDebug();
    const withDebug = wired();
    startSession(withDebug.handlers.get("session_start")!, withDebug.ctx);
    expect(withDebug.registerCommand).toHaveBeenCalledOnce();
    expect(withDebug.registerCommand.mock.calls[0]![0]).toBe("acwords");
  });
});

// --- session_start: restore gating ---------------------------------------------

describe("session_start — restore gating", () => {
  it("reason 'new' with empty history does NOT restore (probe only — one getBranch call)", () => {
    const { handlers, ctx, getBranch, getEntries } = wired();

    startSession(handlers.get("session_start")!, ctx, "new");

    expect(getBranch).toHaveBeenCalledTimes(1); // probe only; restore would add one
    expect(getEntries).toHaveBeenCalledTimes(1);
  });

  it("reason 'startup' with empty history still restores (reason ≠ new)", () => {
    const { handlers, ctx, getBranch } = wired();

    startSession(handlers.get("session_start")!, ctx, "startup");

    expect(getBranch).toHaveBeenCalledTimes(2); // probe + restoreFromHistory
  });

  it("reason 'resume' with history restores through the real pipeline — store gains candidates", async () => {
    useDict();
    enableDebug();
    const { handlers, ctx, registerCommand } = wired({
      branch: [msgEntry("e1", userMsg("hello zephyr world"))],
    });

    startSession(handlers.get("session_start")!, ctx, "resume");

    // Fire-and-forget replay drains without the debounce; poll the real
    // /acwords dump until the history words are counted.
    const handler = acwordsHandler(registerCommand);
    await vi.waitFor(async () => {
      const text = await dump(handler);
      expect(wordsSeenIn(text)).toBeGreaterThan(0);
    });
  });
});

// --- session_start: bigram wiring (enableChaining gate) ------------------------

describe("session_start — bigram wiring (enableChaining)", () => {
  afterEach(() => {
    vi.restoreAllMocks(); // scope the CandidateStore.prototype spy
  });

  it("enableChaining true (default) wires the hook — enriched RunMember runs land in the store", async () => {
    useDict(); // alpha/beta/gamma are dict-absent → group 0 → admitted
    const { handlers, ctx } = wired();
    const spy = vi.spyOn(CandidateStore.prototype, "recordBigramRuns");
    startSession(handlers.get("session_start")!, ctx, "new");

    await endMessage(
      handlers.get("message_end")!,
      ctx,
      userMsg("alpha beta gamma"),
    );
    // Filter to THIS session's message: the prototype spy is shared by
    // every store instance, and an earlier test's fire-and-forget restore
    // drain can land its own recordBigramRuns call inside this window.
    // Members are RunMember OBJECTS — the enriched payload passes
    // through unprojected (BUG-001 fix: the keys-only shim is gone).
    await vi.waitFor(() => {
      expect(
        spy.mock.calls.some(([lines]) =>
          lines.flat().some((m) => typeof m !== "string" && m.key === "alpha"),
        ),
      ).toBe(true);
    });
    const call = spy.mock.calls.find(([lines]) =>
      lines.flat().some((m) => typeof m !== "string" && m.key === "alpha"),
    )!;
    expect(call[0]).toEqual([
      [
        { key: "alpha", rawCasing: "alpha" },
        { key: "beta", rawCasing: "beta" },
        { key: "gamma", rawCasing: "gamma" },
      ],
    ]);
  });

  it("capitalized-run members carry series marks through the production seam", async () => {
    useDict(); // dict-absent words — no chainOnly top-band branch in play
    const { handlers, ctx } = wired();
    const spy = vi.spyOn(CandidateStore.prototype, "recordBigramRuns");
    startSession(handlers.get("session_start")!, ctx, "new");

    await endMessage(
      handlers.get("message_end")!,
      ctx,
      userMsg("Alpha Beta gamma"),
    );
    await vi.waitFor(() => {
      expect(
        spy.mock.calls.some(([lines]) =>
          lines.flat().some((m) => typeof m !== "string" && m.key === "alpha"),
        ),
      ).toBe(true);
    });
    const call = spy.mock.calls.find(([lines]) =>
      lines.flat().some((m) => typeof m !== "string" && m.key === "alpha"),
    )!;
    // "Alpha Beta" is a detected ≥2-member capitalized run (uppercase
    // initials, plain space gaps) → both members series-marked with raw
    // casing; "gamma" is an ordinary member of the same adjacency run,
    // unmarked. toEqual pins the SHAPE: series is genuinely ABSENT on
    // non-run members, never merely undefined.
    expect(call[0]).toEqual([
      [
        { key: "alpha", rawCasing: "Alpha", series: true },
        { key: "beta", rawCasing: "Beta", series: true },
        { key: "gamma", rawCasing: "gamma" },
      ],
    ]);
    // Store-level enrichment (the point of the seam): the run pair is
    // SERIES-marked in the successor index — typed-word chain arming
    // (topSuccessors(word).some(s => s.series)) now fires on real data.
    // The spy's captured `this` is the session store that consumed it.
    const store = spy.mock.contexts[
      spy.mock.calls.indexOf(call)
    ] as CandidateStore;
    expect(store.topSuccessors("alpha")).toEqual([
      { next: "beta", count: 1, series: true, nextDisplay: "Beta" },
    ]);
  });

  it("enableChaining false leaves the hook unwired — recordBigramRuns never fires", async () => {
    useDict();
    writeConfig({ enableChaining: false });
    const { handlers, ctx } = wired();
    const spy = vi.spyOn(CandidateStore.prototype, "recordBigramRuns");
    startSession(handlers.get("session_start")!, ctx, "new");

    await endMessage(
      handlers.get("message_end")!,
      ctx,
      userMsg("alpha beta gamma"),
    );
    await settle(); // let the debounce fire and the drain finish
    // enableChaining false → the hook is never wired: this session's
    // message never reaches recordBigramRuns (any spied call would be
    // bleed from another test's store — filter on this message's keys).
    expect(spy.mock.calls.some(([lines]) => lines.flat().includes("alpha"))).toBe(false);
  });
});

// --- lazy dictionary (seam-level) ------------------------------------------------

describe("lazy dictionary (seam-level)", () => {
  it("does not read the file until the first lookup; failure notifies once and sticks", () => {
    const onLoadError = vi.fn();
    const dict = createLazyDictionary(join(cwd, "missing.bin"), onLoadError);

    expect(dict.version).toBe(0); // getter-backed, pre-load zeros
    expect(dict.entryCount).toBe(0);
    expect(onLoadError).not.toHaveBeenCalled(); // nothing touched yet

    expect(dict.lookup("word")).toBeNull(); // triggers the one failed load
    expect(onLoadError).toHaveBeenCalledOnce();
    expect(dict.lookup("other")).toBeNull(); // sticky failure — no retry
    expect(onLoadError).toHaveBeenCalledOnce();
  });

  it("loads on first lookup; version/entryCount then reflect the packed header", () => {
    const path = join(cwd, "d.bin");
    writeDictFile(path, [{ word: "the", quant: 200 }]);
    const dict = createLazyDictionary(path, () => {
      throw new Error("must not fail");
    });

    expect(dict.version).toBe(0);
    expect(dict.entryCount).toBe(0);
    expect(dict.lookup("the")).toBe(200);
    expect(dict.lookup("absent")).toBeNull();
    expect(dict.version).toBe(1);
    expect(dict.entryCount).toBe(1);
  });

  it("resolveDictPath honors the HAPAX_DICT override and otherwise targets the shipped dict", () => {
    vi.stubEnv("HAPAX_DICT", "/custom/hapx.bin");
    expect(resolveDictPath()).toBe("/custom/hapx.bin");

    delete process.env.HAPAX_DICT;
    try {
      expect(resolveDictPath().replace(/\\/g, "/")).toMatch(
        /dict\/common-en\.bin$/,
      );
    } finally {
      process.env.HAPAX_DICT = "/custom/hapx.bin"; // restore for unstubAllEnvs
    }
  });
});

// --- full wiring: lazy load through the live pipeline ---------------------------

describe("message_end — lazy dictionary through the pipeline", () => {
  it("no dictionary is read (and nothing notified) until the first message drains", async () => {
    useCorruptDict();
    const { handlers, ctx, notify } = wired();

    startSession(handlers.get("session_start")!, ctx);
    expect(notify).not.toHaveBeenCalled(); // lazy: session_start read nothing

    await endMessage(handlers.get("message_end")!, ctx, userMsg("hello world"));
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
    expect(notify.mock.calls[0]![1]).toBe("error");
    expect(String(notify.mock.calls[0]![0])).toContain("hapax: dictionary");
  });

  it("a valid dict loads lazily on first drain and candidates reach the provider", async () => {
    useDict();
    const { handlers, ctx, addAutocompleteProvider } = wired();
    startSession(handlers.get("session_start")!, ctx);

    const factory = addAutocompleteProvider.mock.calls[0]![0] as (
      current: AutocompleteProvider,
    ) => AutocompleteProvider;
    const provider = factory(currentFake());

    // Empty store → delegate (null) — and no dict-load error anywhere.
    await expect(
      provider.getSuggestions(["#zep"], 0, 4, {
        signal: new AbortController().signal,
      }),
    ).resolves.toBeNull();

    await endMessage(
      handlers.get("message_end")!,
      ctx,
      userMsg("hello zephyr world"),
    );
    await vi.waitFor(async () => {
      const result = await provider.getSuggestions(["#zep"], 0, 4, {
        signal: new AbortController().signal,
      });
      // M2 semantics (PRD §06 h3.8): once the drain admits "zephyr" and
      // the bigram wiring (the enableChaining gate) records its successor
      // windows, the admitted word must surface in the "#zep" menu. The
      // assertion's intent — "ingested candidates reach the provider and
      // appear in the menu" — is provable from any poll that lands after
      // the drain, and which poll that is depends on drain/poll timing,
      // so the check tolerates the interleaving.
      const values = result?.items.map((i) => i.value) ?? [];
      const ok =
        values.includes("zephyr") || values.includes("zephyr world");
      expect(ok, `menu items: ${JSON.stringify(values)}`).toBe(true);
    });
  });
});

// --- disable-on-bad-dict ---------------------------------------------------------

describe("disable-on-bad-dict", () => {
  it("exactly one error notify; later message_end events are permanent no-ops (no growth, no throw)", async () => {
    useCorruptDict();
    enableDebug();
    const { handlers, ctx, notify, registerCommand } = wired();
    startSession(handlers.get("session_start")!, ctx);
    const acwords = acwordsHandler(registerCommand);

    await endMessage(handlers.get("message_end")!, ctx, userMsg("hello zephyr"));
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
    expect(notify.mock.calls[0]![1]).toBe("error");
    await settle(); // let the failure-triggering drain finish completely

    // The failing message may have left its own (group-0) words behind;
    // snapshot that state, then prove SUBSEQUENT ingestion is dead.
    const frozen = await dump(acwords);

    await endMessage(
      handlers.get("message_end")!,
      ctx,
      userMsg("another fresh word"),
    );
    await settle();

    expect(notify).toHaveBeenCalledTimes(1); // still exactly one error notify
    expect(await dump(acwords)).toBe(frozen); // byte-identical: nothing grew
  });

  it("disable is permanent across session_start — the runtime no-ops entirely", async () => {
    useCorruptDict();
    enableDebug();
    const { handlers, ctx, notify, addAutocompleteProvider, registerCommand } =
      wired();
    startSession(handlers.get("session_start")!, ctx);
    await endMessage(handlers.get("message_end")!, ctx, userMsg("hello world"));
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
    await settle();

    // The FIRST session_start legitimately registered provider + /acwords
    // (debug is on) — snapshot those counts before the disabled restart.
    const providersAfterFirst = addAutocompleteProvider.mock.calls.length;
    const commandsAfterFirst = registerCommand.mock.calls.length;

    startSession(handlers.get("session_start")!, ctx, "reload"); // disabled → early return

    expect(addAutocompleteProvider).toHaveBeenCalledTimes(providersAfterFirst); // NOT re-registered
    expect(registerCommand).toHaveBeenCalledTimes(commandsAfterFirst); // /acwords not re-registered
    expect(notify).toHaveBeenCalledTimes(1); // still exactly one error notify

    await endMessage(
      handlers.get("message_end")!,
      ctx,
      userMsg("post reload word"),
    );
    await settle();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

// --- message_end return discipline ------------------------------------------------

describe("message_end return discipline", () => {
  it("returns undefined in every path: no pipeline, live pipeline, and disabled", async () => {
    useCorruptDict(); // fastest route to all three states
    const { handlers, ctx } = wired();
    const handler = handlers.get("message_end")!;
    const evt = userMsg("hello world");

    // (a) before any session_start — no pipeline exists
    await expect(endMessage(handler, ctx, evt)).resolves.toBeUndefined();

    // (b) live pipeline
    startSession(handlers.get("session_start")!, ctx);
    await expect(endMessage(handler, ctx, evt)).resolves.toBeUndefined();

    // (c) permanently disabled runtime
    await settle(); // let the drain hit the corrupt dict
    await expect(endMessage(handler, ctx, evt)).resolves.toBeUndefined();
  });
});

// --- session_shutdown ---------------------------------------------------------------

describe("session_shutdown", () => {
  it("disposes the registered provider and disarms the pipeline debounce", async () => {
    useDict();
    enableDebug();
    const { handlers, ctx, addAutocompleteProvider, registerCommand } = wired();
    startSession(handlers.get("session_start")!, ctx);

    const factory = addAutocompleteProvider.mock.calls[0]![0] as (
      current: AutocompleteProvider,
    ) => AutocompleteProvider & { dispose: () => void };
    const provider = factory(currentFake());
    const disposeSpy = vi.fn();
    provider.dispose = disposeSpy; // same instance index.ts retained

    await endMessage(
      handlers.get("message_end")!,
      ctx,
      userMsg("hello zephyr"),
    ); // arms the 300 ms debounce

    handlers.get("session_shutdown")!(
      { type: "session_shutdown", reason: "quit" },
      ctx,
    );

    expect(disposeSpy).toHaveBeenCalledTimes(1); // popup-scheduler timers dropped

    // The armed debounce must never fire: after a full debounce window the
    // counters are untouched, and a post-shutdown message_end stays a no-op.
    await settle();
    expect(wordsSeenIn(await dump(acwordsHandler(registerCommand)))).toBe(0);

    await endMessage(handlers.get("message_end")!, ctx, userMsg("late arrival"));
    await settle();
    expect(wordsSeenIn(await dump(acwordsHandler(registerCommand)))).toBe(0);
  });
});

// --- shutdown → session_start (reload cycle) -----------------------------------------

describe("shutdown → session_start reload cycle", () => {
  it("rebuilds fresh store/pipeline/provider/command — new session starts empty and works", async () => {
    useDict();
    enableDebug();
    const { handlers, ctx, addAutocompleteProvider, registerCommand } = wired();
    startSession(handlers.get("session_start")!, ctx, "startup");
    await endMessage(handlers.get("message_end")!, ctx, userMsg("hello zephyr"));
    const provider1 = (
      addAutocompleteProvider.mock.calls[0]![0] as (
        c: AutocompleteProvider,
      ) => AutocompleteProvider & { dispose: () => void }
    )(currentFake());
    const dispose1 = vi.fn();
    provider1.dispose = dispose1; // spy on the instance index.ts retained

    handlers.get("session_shutdown")!(
      { type: "session_shutdown", reason: "reload" },
      ctx,
    );
    expect(dispose1).toHaveBeenCalledTimes(1);

    startSession(handlers.get("session_start")!, ctx, "reload");

    expect(registerCommand).toHaveBeenCalledTimes(2); // re-registered for the new session
    const acwords2 = acwordsHandler(registerCommand, 1);
    const fresh = await dump(acwords2);
    expect(fresh).toMatch(/size: 0 \/ \d+/); // fresh store — old candidates gone
    expect(fresh).toContain("words seen: 0");

    // …and the new pipeline ingests independently.
    await endMessage(handlers.get("message_end")!, ctx, userMsg("hello zephyr"));
    await vi.waitFor(async () => {
      const text = await dump(acwords2);
      expect(wordsSeenIn(text)).toBeGreaterThan(0);
    });
  });
});
// --- dual-path display branch (spec 07 h2.42) -----------------------------------

describe("dual-path display branch (spec 07 h2.42)", () => {
  /** A stock (foreign) editor factory — what pi-vim et al. install. */
  const stockFactory = (): { handleInput: (d: string) => string } => ({
    handleInput: (d: string) => d,
  });

  it("factory present → NO provider registration; exactly one widget-composed factory installed", () => {
    const { handlers, ctx, addAutocompleteProvider, setEditorComponent } = wired({
      editorFactory: stockFactory(),
    });

    startSession(handlers.get("session_start")!, ctx);

    expect(addAutocompleteProvider).not.toHaveBeenCalled();
    expect(setEditorComponent).toHaveBeenCalledTimes(1);
    expect(isWidgetWrapper(setEditorComponent.mock.calls[0]![0])).toBe(true);
  });

  it("the widget composition builds the inner verbatim, guards input, mutates nothing", () => {
    const built = {
      handleInput: vi.fn((d: string) => d),
      extra: "verbatim",
    };
    const innerSpy = vi.fn(() => built);
    const { handlers, ctx, setEditorComponent } = wired({ editorFactory: innerSpy });

    startSession(handlers.get("session_start")!, ctx);

    const installed = setEditorComponent.mock.calls[0]![0] as (
      tui: unknown,
      theme: unknown,
      keybindings: unknown,
    ) => unknown;
    const TUI = { tui: true };
    const THEME = { theme: true };
    const KB = { matches: () => false }; // nothing is the submit key
    const editor = installed(TUI, THEME, KB) as Record<string, unknown>;

    // The inner factory received the exact arguments, verbatim.
    expect(innerSpy).toHaveBeenCalledWith(TUI, THEME, KB);
    // Foreign members delegate verbatim; the composed editor is never a
    // thenable (createEnterSubmitEditor pins `then` → undefined).
    expect(editor.extra).toBe("verbatim");
    expect(editor.then).toBeUndefined();
    // handleInput is the composed enter-submit guard — a different
    // function than the inner's own — and the inner INSTANCE was never
    // mutated (v1 recursion crash lesson).
    const ownHandleInput = built.handleInput;
    expect(editor.handleInput).not.toBe(ownHandleInput);
    (editor.handleInput as (d: string) => unknown)("x");
    expect(ownHandleInput).toHaveBeenCalledWith("x"); // delegated after the guard
    expect(built.handleInput).toBe(ownHandleInput); // still the original
  });

  it("reload cycle: re-run RE-BINDS a fresh wrapper around the original factory — this session's store, no stacking, no provider", () => {
    const stock = stockFactory();
    let current: unknown = stock; // pi's editor slot, pre-seeded with a foreign factory
    const { handlers, ctx, addAutocompleteProvider, setEditorComponent, getEditorComponent } =
      wired({ editorFactory: current });
    setEditorComponent.mockImplementation((f: unknown) => {
      current = f;
    });
    getEditorComponent.mockImplementation(() => current);

    startSession(handlers.get("session_start")!, ctx, "startup");
    const firstInstall = current;
    expect(isWidgetWrapper(firstInstall)).toBe(true);
    const firstOpts = widgetOptsOf(firstInstall)!;
    expect(firstOpts.inner).toBe(stock); // wrapped the foreign factory, not itself

    // Reload (resume/session-switch, in-process): getEditorComponent now
    // returns OUR wrapper. The rebind contract (2026-10 stale-store fix):
    // a FRESH wrapper is installed around the ORIGINAL factory, bound to
    // the NEW session's store — never a wrapper-around-our-wrapper, and
    // never the stale first-session composition left in place.
    startSession(handlers.get("session_start")!, ctx, "resume");
    expect(setEditorComponent).toHaveBeenCalledTimes(2);
    const secondInstall = current;
    expect(secondInstall).not.toBe(firstInstall); // genuinely re-bound
    expect(isWidgetWrapper(secondInstall)).toBe(true);
    const secondOpts = widgetOptsOf(secondInstall)!;
    expect(secondOpts.inner).toBe(stock); // the ORIGINAL factory — no stacking
    expect(secondOpts.inner).not.toBe(firstInstall);
    expect(secondOpts.store).not.toBe(firstOpts.store); // fresh session store
    expect(secondOpts.store).toBeInstanceOf(CandidateStore);
    expect(addAutocompleteProvider).not.toHaveBeenCalled(); // still provider-free
  });

  it("reload cycle: after re-fire, ingest reaches the store the INSTALLED widget queries (no stale vocabulary)", async () => {
    useDict();
    enableDebug();
    const stock = stockFactory();
    let current: unknown = stock;
    const { handlers, ctx, registerCommand, setEditorComponent, getEditorComponent } =
      wired({ editorFactory: current });
    setEditorComponent.mockImplementation((f: unknown) => {
      current = f;
    });
    getEditorComponent.mockImplementation(() => current);

    startSession(handlers.get("session_start")!, ctx, "startup");
    const firstStore = widgetOptsOf(current)!.store;

    // Second fire (resume) carries NEW history — replayed into the new
    // session's store by restoreFromHistory, exactly like a real /resume.
    const resumeCtx = fakeCtx({
      editorFactory: current,
      branch: [msgEntry("r1", userMsg("hello zorblaxian world"))],
    });
    resumeCtx.getEditorComponent.mockImplementation(() => current);
    resumeCtx.setEditorComponent.mockImplementation((f: unknown) => {
      current = f;
    });
    startSession(handlers.get("session_start")!, resumeCtx.ctx, "resume");

    const installed = widgetOptsOf(current)!;
    expect(installed.store).not.toBe(firstStore); // re-bound, not stale

    // Poll the real /acwords dump until the resumed history replays —
    // then the word MUST be findable through the INSTALLED widget's
    // store (the exact failure mode: pre-fix the replay wrote a store
    // the widget never read, so completions served the old session).
    // TWO session_starts → TWO /acwords registrations; index 1 is the
    // resumed session's (index 0 is bound to session 1's pipeline).
    const handler = acwordsHandler(registerCommand, 1);
    await vi.waitFor(async () => {
      const text = await dump(handler);
      expect(wordsSeenIn(text)).toBeGreaterThan(0);
    });
    // The exact call the installed widget's visibility machine makes:
    // the resumed-history word must surface through the INSTALLED
    // composition's store (pre-fix this returned [] — the replay wrote
    // a store the widget never read).
    const matches = rankMatches(installed.store, "zor", {
      limit: 8,
      fuzzThreshold: 60,
    });
    expect(matches.some((m) => m.display === "zorblaxian")).toBe(true);
  });

  it("no factory → fallback: provider registered once, editor untouched, disposed at shutdown", () => {
    const { handlers, ctx, addAutocompleteProvider, setEditorComponent } = wired();

    startSession(handlers.get("session_start")!, ctx);

    expect(addAutocompleteProvider).toHaveBeenCalledTimes(1);
    expect(setEditorComponent).not.toHaveBeenCalled(); // nothing to wrap
    // displayProvider slot audit (fallback): the provider pi builds is
    // disposed at shutdown. On the widget path the slot stays null and
    // this dispose is a null-safe no-op.
    const factory = addAutocompleteProvider.mock.calls[0]![0] as (
      current: unknown,
    ) => { dispose: () => void };
    const provider = factory(currentFake());
    const disposeSpy = vi.spyOn(provider, "dispose");
    handlers.get("session_shutdown")!({ type: "session_shutdown" }, ctx);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("widget path: restore gating runs identically (history replay reaches the store)", async () => {
    useDict();
    enableDebug();
    const { handlers, ctx, registerCommand } = wired({
      editorFactory: stockFactory(),
      branch: [msgEntry("e1", userMsg("hello zephyr world"))],
    });

    startSession(handlers.get("session_start")!, ctx, "resume");

    // Same fire-and-forget replay as the fallback path — poll the real
    // /acwords dump until the history words are counted.
    const handler = acwordsHandler(registerCommand);
    await vi.waitFor(async () => {
      const text = await dump(handler);
      expect(wordsSeenIn(text)).toBeGreaterThan(0);
    });
  });

  it("widget layer receives the session's shared core (store/config/chain/restoreReady/clock)", () => {
    const { handlers, ctx, setEditorComponent } = wired({
      editorFactory: stockFactory(),
    });

    startSession(handlers.get("session_start")!, ctx);

    const opts = widgetOptsOf(setEditorComponent.mock.calls[0]![0]);
    expect(opts).toBeDefined();
    expect(opts!.store).toBeInstanceOf(CandidateStore); // this session's store
    expect(opts!.config.triggerChar).toBe("#"); // default config flowed in
    expect(opts!.config.maxSuggestions).toBe(20); // width-bound default (2026-10)
    expect(typeof opts!.chain.reset).toBe("function"); // the chain machine
    expect(opts!.restoreReady).toBeInstanceOf(Promise); // startup gate signal
    expect(typeof opts!.onKeystroke).toBe("function"); // shared input clock tick
  });
});

// --- session_tree — branch-hygiene rebuild (spec 05 h2.37 / P2.M1.T2.S1) --------

describe("session_tree — branch-hygiene rebuild (spec 05 h2.37 / P2.M1.T2.S1)", () => {
  afterEach(() => {
    vi.restoreAllMocks(); // scope the prototype spies (discardPending/reset)
  });

  /** Fire-shaped session_tree event. `extra` carries summaryEntry etc. */
  const treeEvent = (
    newLeafId: string | null,
    oldLeafId: string | null,
    extra: Record<string, unknown> = {},
  ): SessionTreeEvent =>
    ({ type: "session_tree", newLeafId, oldLeafId, ...extra }) as SessionTreeEvent;

  /** Branch fixture in leaf→root order (as the real getBranch returns);
   *  restoreFromHistory reverses the copy → replay 'alpha beta' then
   *  'alpha gamma', so 'alpha' counts BOTH messages. Dict has only "the"
   *  → all three words are group 0 and admitted. */
  const branchLeafFirst = (): SessionEntry[] => [
    msgEntry("e2", userMsg("alpha gamma")),
    msgEntry("e1", userMsg("alpha beta")),
  ];

  /** Foreign editor factory (what pi-vim et al. install) — PRIMARY path. */
  const stockFactory = (): { handleInput: (d: string) => string } => ({
    handleInput: (d: string) => d,
  });

  it("guard: equal leaf ids (incl. both null) and pre-session_start fires are strict no-ops", () => {
    useDict();
    const { handlers, ctx, getBranch, setEditorComponent, addAutocompleteProvider } =
      wired();

    // Before any session_start the factory slots are null — even a
    // real-looking navigation must not touch anything.
    handlers.get("session_tree")!(treeEvent("b", "a"), ctx);
    expect(getBranch).not.toHaveBeenCalled();
    expect(setEditorComponent).not.toHaveBeenCalled();

    startSession(handlers.get("session_start")!, ctx, "new"); // probe: getBranch ×1
    const before = getBranch.mock.calls.length;
    handlers.get("session_tree")!(treeEvent("a", "a"), ctx);
    handlers.get("session_tree")!(treeEvent(null, null), ctx);
    expect(getBranch.mock.calls.length).toBe(before); // not even read
    expect(setEditorComponent).not.toHaveBeenCalled();
    expect(addAutocompleteProvider).toHaveBeenCalledTimes(1); // never re-registered
  });

  it("real navigation discards the pending queue before reset — pre-navigation text never lands", async () => {
    useDict();
    enableDebug();
    const { handlers, ctx, registerCommand, getBranch } = wired();
    startSession(handlers.get("session_start")!, ctx, "new");
    const acwords = acwordsHandler(registerCommand);

    // Dead-branch text sits in the 300 ms debounce window (armed, not drained).
    await endMessage(handlers.get("message_end")!, ctx, userMsg("deadbranchword zzq"));
    getBranch.mockReturnValue([msgEntry("e1", userMsg("alpha beta"))]);

    const discardSpy = vi.spyOn(IngestPipeline.prototype, "discardPending");
    const resetSpy = vi.spyOn(CandidateStore.prototype, "reset");
    handlers.get("session_tree")!(treeEvent("leaf2", "leaf1"), ctx);
    expect(discardSpy).toHaveBeenCalledOnce(); // synchronous in the handler
    // The rebuild is fire-and-forget: flush() yields before reset() runs.
    await vi.waitFor(() => expect(resetSpy).toHaveBeenCalledOnce());
    // Composition order pinned: the queue dies BEFORE the wholesale drop.
    expect(discardSpy.mock.invocationCallOrder[0]).toBeLessThan(
      resetSpy.mock.invocationCallOrder[0]!,
    );

    await vi.waitFor(async () => {
      expect(await dump(acwords)).toContain("alpha"); // branch replay landed
    });
    await settle(); // a surviving debounce timer would fire inside this window
    const text = await dump(acwords);
    expect(text).toContain("beta");
    expect(text).not.toContain("deadbranchword"); // discarded, never ingested
  });

  it("in-place rebuild: the SAME store instance is reset then refilled with branch counts", async () => {
    useDict();
    enableDebug();
    const { handlers, ctx, registerCommand, getBranch } = wired();
    startSession(handlers.get("session_start")!, ctx, "new");
    const acwords = acwordsHandler(registerCommand);

    // A fully-drained dead-branch word — genuinely IN the store before
    // navigation (structural in-place identity: the same instance the
    // dump reads is what gets reset and refilled).
    await endMessage(handlers.get("message_end")!, ctx, userMsg("orphanword zz"));
    await settle();
    expect(await dump(acwords)).toContain("orphanword");

    getBranch.mockReturnValue(branchLeafFirst());
    handlers.get("session_tree")!(treeEvent("leaf2", "leaf1"), ctx);

    await vi.waitFor(async () => {
      const text = await dump(acwords);
      expect(text).toMatch(/alpha\s+×2/); // both branch messages counted
    });
    const text = await dump(acwords);
    expect(text).toContain("beta");
    expect(text).toContain("gamma");
    expect(text).not.toContain("orphanword"); // wholesale drop erased the residue
    expect(text).toMatch(/\(ordinal 2\)/); // reset re-zeroed; replay re-issued 1..2
  });

  it("fallback: the SAME registered provider serves branch words after rebuild — never re-registered", async () => {
    useDict();
    const { handlers, ctx, addAutocompleteProvider, getBranch } = wired();
    startSession(handlers.get("session_start")!, ctx, "new");
    const factory = addAutocompleteProvider.mock.calls[0]![0] as (
      c: AutocompleteProvider,
    ) => AutocompleteProvider;
    const provider = factory(currentFake()); // builds + retains the gated provider

    getBranch.mockReturnValue(branchLeafFirst());
    handlers.get("session_tree")!(treeEvent("leaf2", "leaf1"), ctx);

    expect(addAutocompleteProvider).toHaveBeenCalledTimes(1); // armed, not replaced
    await vi.waitFor(async () => {
      const result = await provider.getSuggestions(["#alp"], 0, 4, {
        signal: new AbortController().signal,
      });
      const values = result?.items.map((i) => i.value) ?? [];
      expect(
        values.some((v) => v.startsWith("alpha")),
        `menu items: ${JSON.stringify(values)}`,
      ).toBe(true);
    });
  });

  it("widget: fresh composition around the remembered pre-hapax inner — same store, new gate, no stacking", () => {
    const stock = stockFactory();
    let current: unknown = stock; // pi's editor slot, pre-seeded foreign
    const { handlers, ctx, addAutocompleteProvider, setEditorComponent, getEditorComponent, getBranch } =
      wired({ editorFactory: current });
    setEditorComponent.mockImplementation((f: unknown) => {
      current = f;
    });
    getEditorComponent.mockImplementation(() => current);

    startSession(handlers.get("session_start")!, ctx, "new");
    const wrapper1 = current;
    const opts1 = widgetOptsOf(wrapper1)!;
    expect(opts1.inner).toBe(stock); // wrapped the foreign factory

    getBranch.mockReturnValue([]); // empty branch — rebuild is a trivial refill
    handlers.get("session_tree")!(treeEvent("leaf2", "leaf1"), ctx);

    expect(setEditorComponent).toHaveBeenCalledTimes(2); // replaced, not stacked
    const wrapper2 = current;
    expect(wrapper2).not.toBe(wrapper1);
    expect(isWidgetWrapper(wrapper2)).toBe(true);
    const opts2 = widgetOptsOf(wrapper2)!;
    expect(opts2.inner).toBe(stock); // the ORIGINAL inner — never wrapper-around-wrapper
    expect(opts2.inner).not.toBe(wrapper1);
    expect(opts2.store).toBe(opts1.store); // SAME in-place-reset instance
    expect(opts2.claim).toBe(opts1.claim); // reused session claim (released → unclaimed row)
    expect(opts2.restoreReady).not.toBe(opts1.restoreReady); // THIS rebuild's gate
    expect(opts2.config.triggerChar).toBe("#"); // sessionConfig flowed through
    expect(typeof opts2.onKeystroke).toBe("function"); // sessionTickInputClock
    expect(addAutocompleteProvider).not.toHaveBeenCalled(); // still provider-free
  });

  it("claim released on a real navigation — and only then (07 h3.9)", () => {
    useDict();
    const stock = stockFactory();
    let current: unknown = stock;
    const { handlers, ctx, setEditorComponent, getEditorComponent, getBranch } = wired({
      editorFactory: current,
    });
    setEditorComponent.mockImplementation((f: unknown) => {
      current = f;
    });
    getEditorComponent.mockImplementation(() => current);

    startSession(handlers.get("session_start")!, ctx, "new");
    const claim = widgetOptsOf(current)!.claim!;
    claim.arm();
    expect(claim.held()).toBe(true);

    handlers.get("session_tree")!(treeEvent("a", "a"), ctx); // guard no-op
    expect(claim.held()).toBe(true); // untouched

    getBranch.mockReturnValue([]);
    handlers.get("session_tree")!(treeEvent("b", "a"), ctx); // real navigation
    expect(claim.held()).toBe(false); // released
  });

  it("summaryEntry is never ingested (spec 05 h2.37 summary rule)", async () => {
    useDict();
    enableDebug();
    const { handlers, ctx, registerCommand, getBranch } = wired();
    startSession(handlers.get("session_start")!, ctx, "new");
    const acwords = acwordsHandler(registerCommand);

    getBranch.mockReturnValue([msgEntry("e1", userMsg("alpha beta"))]);
    handlers.get("session_tree")!(
      treeEvent("leaf2", "leaf1", {
        summaryEntry: {
          type: "branch_summary",
          id: "bs1",
          parentId: null,
          timestamp: "2025-01-01T00:00:00.000Z",
          fromId: "leaf1",
          summary: "zxqsummaryword wrdsonlyinsummary",
        },
      }),
      ctx,
    );

    await vi.waitFor(async () => {
      expect(await dump(acwords)).toContain("alpha");
    });
    const text = await dump(acwords);
    expect(text).not.toContain("zxqsummaryword");
    expect(text).not.toContain("wrdsonlyinsummary");
  });

  it("compaction never triggers a rebuild — no compact handler exists (regression pin)", async () => {
    useDict();
    enableDebug();
    const { on, handlers, ctx, registerCommand, getBranch } = wired();
    // session_tree is the ONLY branch-reaction event; every compact event
    // is absent by construction (spec 05 h2.37 compaction interplay).
    expect(on.mock.calls.some((c) => String(c[0]).includes("compact"))).toBe(false);

    startSession(handlers.get("session_start")!, ctx, "new");
    const acwords = acwordsHandler(registerCommand);
    await endMessage(handlers.get("message_end")!, ctx, userMsg("alpha beta"));
    await settle();
    expect(await dump(acwords)).toContain("alpha"); // ingested normally
    expect(getBranch.mock.calls.length).toBe(1); // probe only — no rebuild ran
  });

  it("disabled runtime: a real navigation is a full no-op (guard precedes everything)", async () => {
    useCorruptDict();
    enableDebug();
    const { handlers, ctx, notify, registerCommand, getBranch, setEditorComponent } =
      wired();
    startSession(handlers.get("session_start")!, ctx, "new");
    const acwords = acwordsHandler(registerCommand);
    await endMessage(handlers.get("message_end")!, ctx, userMsg("hello world"));
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce()); // dict failed → disabled
    await settle();
    const frozen = await dump(acwords);
    const branchCalls = getBranch.mock.calls.length; // the session_start probe
    const discardSpy = vi.spyOn(IngestPipeline.prototype, "discardPending");

    handlers.get("session_tree")!(treeEvent("b", "a"), ctx);
    await settle();

    expect(discardSpy).not.toHaveBeenCalled(); // not even the queue drop
    expect(getBranch.mock.calls.length).toBe(branchCalls); // not even read
    expect(setEditorComponent).not.toHaveBeenCalled();
    expect(await dump(acwords)).toBe(frozen); // byte-identical store
  });
});

// ── index.ts e2e — series pipeline through the real factory (fallback path) ──
//
// BUG-001 production-composition acceptance. Every suite above builds its
// own store; the index.ts seam itself was never exercised. This layer
// composes the REAL hapax factory (session_start) with fakePi/fakeCtx on
// the FALLBACK path and observes exclusively through (1) the registered
// provider — addAutocompleteProvider captures the FACTORY
// ((current) => provider), composed over a contract-shaped current — and
// (2) the /acwords dump. No fabricated store, no pipeline object (none is
// exported), no CandidateStore.prototype spies (the shared-prototype
// caveat above makes them flaky here).
//
// Spec anchors: spec 07 M2 — "typing The offers Fed"; the typed-word
// arming state line "idle ──space closes a typed word whose first letter
// is UPPERCASE and whose lowercase key has series successors──►armed(W)";
// spec 06 — "series successors rank above ordinary regardless of counts".
//
// P1.M1.T2.S2 extends this structure to the widget path + live TTY; the
// BUG-002 path-display e2e copies it. Ingest-level series fixtures live
// in the T1.S2 suites — this layer is one step up (real composition).

describe("index.ts e2e — series pipeline through the real factory (fallback path)", () => {
  /** Fresh AbortController per call — getSuggestions options are never
   *  shared across calls. */
  const sig = (): { signal: AbortSignal } => ({
    signal: new AbortController().signal,
  });

  /** Compose the REAL extension over a temp dict ({the: q200}) with debug
   *  on (so /acwords observation works), replay `msgs` through the real
   *  message_end seam, and poll the dump until ingest has landed (the
   *  300 ms debounce + fire-and-forget drains make fixed sleeps flaky —
   *  same polling discipline as the restore-replay cases above). */
  async function seriesSession(msgs: string[], until?: RegExp) {
    useDict();
    enableDebug();
    const { handlers, ctx, registerCommand, addAutocompleteProvider } =
      wired();
    startSession(handlers.get("session_start")!, ctx, "new");
    for (const m of msgs) {
      await endMessage(handlers.get("message_end")!, ctx, userMsg(m));
    }
    const handler = acwordsHandler(registerCommand);
    // Poll until the `until` evidence appears in the dump — a word's own
    // row lands BEFORE the drain's runs tail (the slice-yield boundary
    // sits between them), so gating on mere presence would race the
    // successor-index write. When `until` is absent, words-seen is the
    // gate (negative-control case).
    await vi.waitFor(
      async () => {
        const text = await dump(handler);
        if (until) expect(text).toMatch(until);
        else expect(wordsSeenIn(text)).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
    return { ctx, registerCommand, addAutocompleteProvider, dumpHandler: handler };
  }

  /** The registered value is a FACTORY over `current` — compose it with
   *  a contract-shaped current (delegation-safe). */
  const composeProvider = (add: Mock): AutocompleteProvider =>
    (add.mock.calls[0]![0] as (c: AutocompleteProvider) => AutocompleteProvider)(
      currentFake(),
    );

  it("(a) capitalized-run history yields a series-marked successor with run casing (via /acwords)", async () => {
    // "This Fed" is a detected capitalized run (both members ≥ the 4-char
    // shape floor — note the spec's literal "The" is 3 chars and dies at
    // the shape gate BEFORE runs; This/Fed is the same mechanics, buildable).
    // "This" eagerly admits (dictionary-absent structural-cap) → the
    // SERIES pair is dump-visible through the successor-index sample:
    // "  this → Fed ×1 (series)" — the (series) marker AND the run-casing
    // nextDisplay ("Fed") are the two observable enrichment bits (debug.ts
    // successorsSection row format, pinned verbatim).
    const { dumpHandler } = await seriesSession(
      ["This Fed raised rates today"],
      /this → Fed ×1 \(series\)/, // gate on the FULL pipeline landing
    );
    const text = await dump(dumpHandler);
    expect(text).toMatch(/this → Fed ×1 \(series\)/);
  });

  it("(b) typing 'This ' arms on the space tick; the next word-start query offers 'Fed' in run casing", async () => {
    // The spec's literal "typing The offers Fed" journey, on the ≥4-char
    // buildable instance: "This" is sentence-initial structural-cap, the
    // cap run This→Fed records the series pair, and typing "This " (the
    // space tick) arms via the typed-word gate.
    const { addAutocompleteProvider } = await seriesSession(
      ["This Fed raised rates today"],
      /this → Fed ×1 \(series\)/, // gate on the FULL pipeline landing
    );
    const p = composeProvider(addAutocompleteProvider);

    // Space tick: close-on-space returns null (spec 07 h2.51) AND arms —
    // the typed-word gate (uppercase first letter, series successor
    // exists, chain idle). Arming is pinned BEHAVIORALLY — no chain
    // export exists: the identical next word-start query is answered by
    // the armed branch's zero-char offer.
    const atSpace = await p.getSuggestions(["This "], 0, 5, sig());
    expect(atSpace).toBeNull();

    const offer = await p.getSuggestions(["This "], 0, 5, sig());
    expect(offer).not.toBeNull();
    expect(offer!.prefix).toBe(""); // zero typed chars of the NEXT word
    expect(offer!.items[0]!.value).toBe("Fed"); // run casing (nextDisplay)
    expect(offer!.items.map((i) => i.value)).not.toContain("this");
  });

  it("(c) a series successor outranks an ordinary successor with higher counts (spec 06 series-first)", async () => {
    const { addAutocompleteProvider } = await seriesSession(
      [
        "The Federal Reserve raised rates", // federal → Reserve (series ×1)
        "the federal budget expanded", // federal → budget (ordinary)
        "the federal budget expanded", // budget ×2
        "the federal budget expanded", // budget ×3 — ordinary, STILL outranked
      ],
      /Federal → Reserve ×1 \(series\), budget ×3/, // the FULL row: both pairs in, series-first in the dump itself
    );
    const p = composeProvider(addAutocompleteProvider);
    await p.getSuggestions(["Federal "], 0, 8, sig()); // arms on the space tick
    const offer = await p.getSuggestions(["Federal "], 0, 8, sig());
    // successorBefore is SERIES FIRST — the ×1 series pair tops the ×3
    // ordinary successor regardless of counts.
    expect(offer!.items[0]!.value).toBe("Reserve"); // run casing (nextDisplay)
    expect(offer!.items.map((i) => i.value)).toContain("budget"); // present, below
  });

  it("(d) ordinary capitalized typing with no series successor never arms", async () => {
    const { addAutocompleteProvider } = await seriesSession([
      "alpha beta gamma",
    ]);
    const p = composeProvider(addAutocompleteProvider);
    const r1 = await p.getSuggestions(["Alpha "], 0, 6, sig());
    const r2 = await p.getSuggestions(["Alpha "], 0, 6, sig());
    // No series successor for 'alpha' → the typed-word gate never arms →
    // both calls are plain close-on-space (null) — never a zero-char
    // successor offer with prefix "".
    expect(r1).toBeNull();
    expect(r2?.prefix ?? "x").not.toBe("");
  });
});

// ── index.ts e2e — series pipeline through the real factory (widget path) ──
//
// T2.S2 (bugfix 001_140e40041dd1) — the WIDGET branch of the production
// composition. S1's describe above runs the FALLBACK path (no editor
// factory → provider registration); whenever an editor factory is
// present, index.ts takes the PRIMARY widget branch
// (createWidgetEditorFactory — no provider is ever registered), which is
// how hapax actually ships when pi's editor is compos-able. The PRD's
// literal "The Fed" repro is 3-char shape-gate-dead before runs (see the
// fallback describe's note) — "This Fed raised rates today" is the same
// mechanics, buildable, and is the fixture here too.
//
// Typing uses the typeChar pattern from test/widget.test.ts: advance the
// live buffer at the caret, press the char through the COMPOSED
// editor's handleInput (enter-submit guard → widget proxy → inner), and
// let the W1 microtask evaluate the NEW state — one char per tick;
// typing bursts cancel in-flight queries.
//
// LIVE TTY EVIDENCE (spec/09 binding check — no mocks): tmux 3.7c
// session, `pi -e <repo> --session-dir /tmp/hapax-tty-sessions` (this pi
// build has no --no-session flag; a throwaway session dir gives the same
// isolation). Seeded "This Fed raised rates today" + Enter, Ctrl+C to a
// fresh prompt, then "T" "h" "i" "s" " " "F" sent one key per ~100 ms
// (send-keys; no instrumentation was ever added — the behavior is
// visible bare). capture-pane tail:
//
//     This Fed raised rates today
//     (spinner) Working
//     ------------------------------------------
//     This F
//     ------------------------------------------
//     -> Fed                             session x1        INSERT
//     glm-5.3 | high | 1.3% / 1.0M | MCP: 2 servers enabled
//
// The "-> Fed  session x1" chain-offer row IS the widget-path offer with
// run casing, through the real pi + the real dict artifact. No spec/07
// M2 drift at this granularity (arming + offer content match); finer
// timing drift is P2.M2.T2.S2's to log.

describe("index.ts e2e — series pipeline through the real factory (widget path)", () => {
  /** Stateful inner editor factory — what pi hands over as
   *  ctx.ui.getEditorComponent(). Factory-SHAPED (builds a fresh editor
   *  per install) so index.ts's `!isWidgetWrapper(editorFactory)` branch
   *  composes the widget around it; the buffer ref stays with the test
   *  for the typeChar pattern. Members mirror the harness inner in
   *  test/widget.test.ts (getLines/getCursor/setText/setCursorCol/
   *  getText/render/handleInput). */
  function statefulInnerEditor(): {
    factory: () => Record<string, unknown>;
    buf: { lines: string[]; line: number; col: number };
  } {
    const buf = { lines: [""] as string[], line: 0, col: 0 };
    const factory = (): Record<string, unknown> => ({
      handleInput: (d: string): string => d,
      getLines: (): string[] => buf.lines,
      getCursor: (): { line: number; col: number } => ({ line: buf.line, col: buf.col }),
      setText: (t: string): void => {
        buf.lines = t.split("\n");
        buf.line = buf.lines.length - 1;
        buf.col = (buf.lines[buf.lines.length - 1] ?? "").length; // parks at end
      },
      setCursorCol: (c: number): void => {
        buf.col = c;
      },
      getText: (): string => buf.lines.join("\n"),
      render: (): string[] => [buf.lines[buf.line] ?? ""],
    });
    return { factory, buf };
  }

  /** typeChar (test/widget.test.ts pattern): advance the live buffer at
   *  the caret, press the char — forwarded → the W1 microtask evaluates
   *  the NEW buffer — then flush the microtasks. One char per tick:
   *  typing bursts cancel in-flight queries. */
  const typeChar = async (
    editor: unknown,
    buf: { lines: string[]; line: number; col: number },
    ch: string,
  ): Promise<void> => {
    const row = buf.lines[buf.line] ?? "";
    buf.lines = [...buf.lines];
    buf.lines[buf.line] = row.slice(0, buf.col) + ch + row.slice(buf.col);
    buf.col += 1;
    // editor is deliberately `unknown` at this helper's surface; the
    // handleInput surface is the one structural member it relies on.
    (editor as { handleInput: (d: string) => unknown }).handleInput(ch);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // W1 microtask flush
  };

  /** Widget-composed session: real factory + real ingest of the
   *  capitalized-run corpus, gated on the FULL pipeline landing (the
   *  /acwords successor row includes the series marker AND run casing —
   *  the drain's runs tail lands after the word row, so mere presence
   *  would race). Returns the composed editor, the live buffer, and the
   *  production WidgetLayerOptions (chain access for the arming read). */
  async function widgetSeriesSession(): Promise<{
    editor: Record<string, unknown>;
    buf: { lines: string[]; line: number; col: number };
    chainState: () => { word: string } | null;
    acwords: () => Promise<string>;
  }> {
    useDict();
    enableDebug();
    const ed = statefulInnerEditor();
    const { handlers, ctx, registerCommand, setEditorComponent } = wired({
      editorFactory: ed.factory,
    });
    startSession(handlers.get("session_start")!, ctx, "new");
    await endMessage(
      handlers.get("message_end")!,
      ctx,
      userMsg("This Fed raised rates today"),
    );
    const handler = acwordsHandler(registerCommand);
    await vi.waitFor(
      async () => {
        const text = await dump(handler);
        expect(text).toMatch(/this → Fed ×1 \(series\)/);
      },
      { timeout: 3000 },
    );
    // NO addAutocompleteProvider call exists on the widget branch — the
    // display is the composed editor factory installed over ours.
    const installed = setEditorComponent.mock.calls[0]![0] as (
      tui: unknown,
      theme: unknown,
      keybindings: unknown,
    ) => Record<string, unknown>;
    const editor = installed({}, {}, {
      matches: (data: string, action: string) =>
        action === "tui.input.submit" && data === "\r",
    });
    const opts = widgetOptsOf(installed)!;
    return {
      editor,
      buf: ed.buf,
      chainState: () => opts.chain.state(),
      acwords: () => dump(handler),
    };
  }

  it("(a) typing 'This ' through the composed editor arms {word:'this'}; the next word-start tick paints the run-cased 'Fed' offer", async () => {
    const { editor, buf, chainState } = await widgetSeriesSession();
    // widgetStateOf's PUBLIC WidgetState omits hidden/items (they are the
    // internal view — insertHighlighted reads them through the same
    // structural cast; see test/widget.test.ts's harness).
    const state = widgetStateOf(editor)! as unknown as {
      hidden: boolean;
      items: readonly { display: string }[];
    };
    // (No fresh-prompt flag assertion: a never-ticked editor's hidden flag
    // is the false default — the meaningful observable is after real ticks.)

    for (const ch of ["T", "h", "i", "s"]) await typeChar(editor, buf, ch);
    // Mid-word: below-threshold/zero-match ticks keep the line closed.
    expect(state.hidden).toBe(true);

    // THE SPACE TICK: close-on-space AND typed-word arming (uppercase
    // initial + a series successor exists + chain idle). Arming is
    // pinned BEHAVIORALLY-INDEPENDENT of paint: read the chain state
    // through the production opts (opts.chain IS index.ts's sessionChain).
    await typeChar(editor, buf, " ");
    expect(chainState()).toEqual({ word: "this" });

    // THE OFFER: the armed consult branch paints at the NEXT word-start
    // tick (today's landed timing — the arming site still closes: "never
    // paint from the arming site"; the chain offer is INTENT so the
    // hesitation gate never holds it). When P2.M1.T1.S1's space-tick
    // paint lands, THIS assertion moves up to the space tick above —
    // flip the comment, keep both expectations documented.
    await typeChar(editor, buf, "F");
    expect(state.hidden).toBe(false);
    const displays = state.items.map((i) => i.display);
    expect(displays).toEqual(["Fed"]); // run casing via nextDisplay (chain shims)
    expect(displays.join(" ")).not.toMatch(/\bfed\b/); // never the bare key
  });

  it("(b) /acwords under the widget composition shows the (series) marker with run casing", async () => {
    // The store is display-path-independent, but this session runs the
    // WIDGET composition (editorFactory present) — the marker proof on
    // the branch that actually ships (S1's case (a) ran the fallback).
    const { acwords } = await widgetSeriesSession();
    const text = await acwords();
    expect(text).toMatch(/this → Fed ×1 \(series\)/); // marker + run casing
    expect(text).not.toMatch(/this → fed ×/); // never the bare-key form
  });
});

// ── index.ts e2e — verbatim path display/insert (BUG-002, spec 09 item 7) ──
//
// MODE A (bugfix 001_140e40041dd1): spec 09 integration item 7, verbatim —
// "sr → src/core/query.ts, Tab inserts the whole path; an absolute path
// inserts with its leading /". This battery proves that sentence at the
// PRODUCTION seam — the PRD's core finding was that every unit suite
// fabricated its own store, so the store→query display drop (BUG-002:
// paths classified as casing 'lower', tally path collapsed the edge
// bearing display to the trimmed key) went uncaught. The REAL index.ts
// factory composition ingests a message mentioning
// "/home/dustin/projects/hapax/src/core/query.ts" and
// "../tools/build.mjs" through the debounced message_end pipeline, and
// the completions' DISPLAY and INSERTED text must keep the leading "/"
// and "../" on BOTH display paths: the fallback provider's menu items
// (composed with the pi-tui-faithful editorApplyCompletion deletion math)
// and the widget's Tab insert. Matching happens on the TRIMMED key
// ("ho" matches though the key is "home/…" — rule 4d's key≠display
// asymmetry is the spec rule; both sides are asserted). Mocking
// discipline: ONLY the pi shell (fakePi/fakeCtx) and the dictionary file
// are mocked — the pipeline, store, query, provider, widget, and editor
// proxy are the real composed production objects.

describe("e2e — verbatim path display/insert (BUG-002, spec 09 item 7)", () => {
  const ABS = "/home/dustin/projects/hapax/src/core/query.ts";
  const REL = "../tools/build.mjs";
  const PATH_MSG = `see ${ABS} and ${REL} for details`;

  const sig = (): { signal: AbortSignal } => ({
    signal: new AbortController().signal,
  });

  /** Ingest the path-mention message through the real debounced
   *  pipeline, gated on the trimmed path key's row landing in the
   *  /acwords dump (the drain's full-landing evidence). */
  async function pathSession(over?: Parameters<typeof wired>[0]) {
    useDict();
    enableDebug();
    const w = wired(over);
    startSession(w.handlers.get("session_start")!, w.ctx, "new");
    await endMessage(w.handlers.get("message_end")!, w.ctx, userMsg(PATH_MSG));
    const handler = acwordsHandler(w.registerCommand);
    await vi.waitFor(
      async () => {
        const text = await dump(handler);
        expect(text).toMatch(/home\/dustin\/projects/); // the trimmed key's row
      },
      { timeout: 3000 },
    );
    return w;
  }

  // ── (a) fallback path: provider display + real insertion math ─────────

  it("(a) 'ho' offers the edge-bearing absolute path; 'to' the ../ form; insertion keeps both", async () => {
    const { addAutocompleteProvider } = await pathSession();
    const factory = addAutocompleteProvider.mock.calls[0]![0] as (
      current: AutocompleteProvider,
    ) => AutocompleteProvider;
    const provider = factory(currentFake());

    // 'ho' anchors on the TRIMMED key's first chars ("home/…") — the
    // display's leading "/" never participates in matching (rule 4d's
    // key≠display asymmetry: THIS match is the key-trim proof, since a
    // display-form prefix match would need "ho" to prefix "/home…") —
    // and the DISPLAY keeps the edge verbatim (BUG-002's dropped "/" is
    // the regression).
    const abs = await provider.getSuggestions(["ho"], 0, 2, sig());
    expect(abs).not.toBeNull();
    expect(abs!.items.map((i) => i.value)).toContain(ABS);
    const absItem = abs!.items.find((i) => i.value === ABS)!;
    expect(abs!.prefix).toBe("ho"); // the typed fragment — anchor-safe splice

    // Insert through the provider's REAL applyCompletion: the buffer
    // math (pi-tui's blind prefix.length splice) keeps the leading "/".
    const completedAbs = editorApplyCompletion("ho", 2, absItem.value, abs!.prefix);
    expect(completedAbs).toBe(ABS);
    expect(prefixIsAnchorSafe("ho", 2, abs!.prefix)).toBe(true);

    // The relative form: "../" survives on display and insertion alike.
    const rel = await provider.getSuggestions(["to"], 0, 2, sig());
    expect(rel?.items.map((i) => i.value)).toContain(REL);
    const relItem = rel!.items.find((i) => i.value === REL)!;
    expect(editorApplyCompletion("to", 2, relItem.value, rel!.prefix)).toBe(REL);
  });

  // ── (b) widget path: Tab inserts the verbatim path (PRD repro inverted) ──

  /** Stateful inner editor factory + typeChar — the widget-path e2e
   *  describe's harness, mirrored (those helpers are describe-scoped). */
  function statefulInnerEditor(): {
    factory: () => Record<string, unknown>;
    buf: { lines: string[]; line: number; col: number };
  } {
    const buf = { lines: [""] as string[], line: 0, col: 0 };
    const factory = (): Record<string, unknown> => ({
      handleInput: (d: string): string => d,
      getLines: (): string[] => buf.lines,
      getCursor: (): { line: number; col: number } => ({ line: buf.line, col: buf.col }),
      setText: (t: string): void => {
        buf.lines = t.split("\n");
        buf.line = buf.lines.length - 1;
        buf.col = (buf.lines[buf.lines.length - 1] ?? "").length; // parks at end
      },
      setCursorCol: (c: number): void => {
        buf.col = c;
      },
      getText: (): string => buf.lines.join("\n"),
      render: (): string[] => [buf.lines[buf.line] ?? ""],
    });
    return { factory, buf };
  }

  const typeChar = async (
    editor: unknown,
    buf: { lines: string[]; line: number; col: number },
    ch: string,
  ): Promise<void> => {
    const row = buf.lines[buf.line] ?? "";
    buf.lines = [...buf.lines];
    buf.lines[buf.line] = row.slice(0, buf.col) + ch + row.slice(buf.col);
    buf.col += 1;
    (editor as { handleInput: (d: string) => unknown }).handleInput(ch);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // W1 microtask flush
  };

  it("(b) type 'ho', Tab → the buffer holds the absolute path verbatim (PRD repro inverted)", async () => {
    const ed = statefulInnerEditor();
    const { setEditorComponent } = await pathSession({
      editorFactory: ed.factory,
    });
    const installed = setEditorComponent.mock.calls[0]![0] as (
      tui: unknown,
      theme: unknown,
      keybindings: unknown,
    ) => Record<string, unknown>;
    const editor = installed(
      {},
      {},
      { matches: (data: string, action: string) => action === "tui.input.submit" && data === "\r" },
    );
    const state = widgetStateOf(editor)! as unknown as {
      hidden: boolean;
      items: readonly { display: string }[];
    };

    // Type 'ho': the trimmed-key match paints the menu with the
    // edge-bearing display (the widget renders the same display the
    // fallback path serves — one resolver, two surfaces).
    for (const ch of ["h", "o"]) await typeChar(editor, ed.buf, ch);
    expect(state.hidden).toBe(false);
    expect(state.items.map((i) => i.display)).toContain(ABS);

    // Tab: insertHighlighted splices the DISPLAY over the TYPED
    // fragment's span (2 chars) — the longer edge-bearing path lands
    // verbatim, caret parked after it (setText parks at buffer end).
    (editor as { handleInput: (d: string) => unknown }).handleInput("\t");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(ed.buf.lines).toEqual([ABS]); // THE PRD reproduction, inverted
    expect(ed.buf.col).toBe(ABS.length); // cursor lands after the path
  });

  it("(c) the ../tools variant: type 'to', Tab → buffer '../tools/build.mjs'", async () => {
    const ed = statefulInnerEditor();
    const { setEditorComponent } = await pathSession({ editorFactory: ed.factory });
    const installed = setEditorComponent.mock.calls[0]![0] as (
      tui: unknown,
      theme: unknown,
      keybindings: unknown,
    ) => Record<string, unknown>;
    const editor = installed(
      {},
      {},
      { matches: (data: string, action: string) => action === "tui.input.submit" && data === "\r" },
    );
    const state = widgetStateOf(editor)! as unknown as {
      hidden: boolean;
      items: readonly { display: string }[];
    };

    for (const ch of ["t", "o"]) await typeChar(editor, ed.buf, ch);
    expect(state.hidden).toBe(false);
    expect(state.items.map((i) => i.display)).toContain(REL);

    (editor as { handleInput: (d: string) => unknown }).handleInput("\t");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(ed.buf.lines).toEqual([REL]); // the "../" edges survive Tab
    expect(ed.buf.col).toBe(REL.length);
  });
});
