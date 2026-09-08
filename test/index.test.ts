/**
 * hapax extension factory suite (P1.M3.T5.S1, PRD §02 h2.13/h2.12/h2.10):
 * the default export registers exactly the four pi.on handlers and does
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
import { CandidateStore } from "../src/core/store.js";
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
 *  via spy counts — restoreFromHistory would add its own getBranch call). */
function fakeCtx(
  over: {
    cwd?: string;
    trusted?: boolean;
    branch?: SessionEntry[];
    entries?: SessionEntry[];
  } = {},
): {
  ctx: ExtensionContext;
  notify: Mock;
  addAutocompleteProvider: Mock;
  isProjectTrusted: Mock;
  getBranch: Mock;
  getEntries: Mock;
} {
  const notify = vi.fn();
  const addAutocompleteProvider = vi.fn();
  const isProjectTrusted = vi.fn(() => over.trusted ?? true);
  const getBranch = vi.fn(() => over.branch ?? []);
  const getEntries = vi.fn(() => over.entries ?? []);
  const ctx = {
    ui: { notify, addAutocompleteProvider },
    cwd: over.cwd ?? cwd,
    isProjectTrusted,
    sessionManager: { getBranch, getEntries },
  } as unknown as ExtensionContext;
  return {
    ctx,
    notify,
    addAutocompleteProvider,
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
  const { ctx, notify, addAutocompleteProvider, isProjectTrusted, getBranch, getEntries } =
    fakeCtx(over);
  return {
    pi,
    on,
    registerCommand,
    handlers,
    ctx,
    notify,
    addAutocompleteProvider,
    isProjectTrusted,
    getBranch,
    getEntries,
  };
}

// --- factory registration ------------------------------------------------------

describe("factory registration", () => {
  it("registers exactly the four lifecycle handlers — and nothing else", () => {
    const { on, handlers } = wired();

    expect(on.mock.calls.map((c) => c[0])).toEqual([
      "session_start",
      "message_end",
      "session_shutdown",
      "before_agent_start",
    ]);
    expect(handlers.size).toBe(4);
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
    expect(provider.triggerCharacters).toEqual(["#"]); // default config flowed in
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