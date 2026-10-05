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
import { isWidgetWrapper, widgetOptsOf } from "../src/pi/widget.js";
import { CandidateStore } from "../src/core/store.js";
import { rankMatches } from "../src/core/query.js";
import { writeDictFile } from "./helpers/dict-writer.js";

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

  it("enableChaining true (default) wires the hook — bigrams land in the store", async () => {
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
    await vi.waitFor(() => {
      expect(spy.mock.calls.some(([lines]) => lines.flat().includes("alpha"))).toBe(true);
    });
    const call = spy.mock.calls.find(([lines]) => lines.flat().includes("alpha"))!;
    expect(call[0]).toEqual([["alpha", "beta", "gamma"]]);
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
