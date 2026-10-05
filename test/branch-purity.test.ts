/**
 * Branch-purity + rebuild acceptance battery (P2.M1.T2.S2) — the standalone
 * unit-level proof for spec 09 h2.59's three mandated bullets:
 *
 *   - "Branch purity (2026-10, spec 06)": replaying a fixed message sequence
 *     twice yields identical stores; a store built incrementally
 *     (message_end sequence) equals the store rebuilt from a getBranch()
 *     snapshot of the same sequence — no dead-branch words survive, nothing
 *     double-counts. (spec 06 h2.42)
 *   - "Branch rebuild (2026-10, spec 05)": session_tree discards the pending
 *     ingest queue (queued-but-unflushed dead-branch texts never reach the
 *     new store; texts on the new path are re-captured by the snapshot —
 *     never lost, never double-counted); newLeafId === oldLeafId skips;
 *     queries during the replay window wait behind the same bounded gate as
 *     resume (≤ 500 ms, forced requests included). (spec 05 h2.36–h2.37)
 *   - "Branch rebind (2026-10, spec 05/07)": session_tree releases a claimed
 *     row and re-binds the widget to the rebuilt store — a fragment typed
 *     after navigation never completes from abandoned-branch vocabulary.
 *
 * LIVE VERSION of integration item 9 (spec 09 h2.60) runs in P3.M1.T2.S3 —
 * that is the owner-scenario script; this battery pins the properties.
 *
 * MECHANISM — deterministic replay hold: ingest.ts's defaultYield prefers
 * globalThis.scheduler.yield() when the platform provides it (captured at
 * module load). The battery installs a CONTROLLABLE scheduler before
 * dynamically importing the extension, so every index-level replay parks at
 * each message's yield until drain() releases it — the replay window is
 * deterministic (no timing races; fake-timer immediates are ambiguous, see
 * probe: any timer advancement drains real/faked immediates). Test-only —
 * no src/ changes (topSuccessors enumeration sufficed; the sanctioned
 * store.ts bigram dump was NOT needed).
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CandidateStore } from "../src/core/store.js";
import type { Dictionary, Successor } from "../src/core/types.js";
import {
  isWidgetWrapper,
  widgetOptsOf,
  widgetStateOf,
  type EditorFactory,
} from "../src/pi/widget.js";
import type { AgentMessage } from "../src/pi/ingest.js";
import { writeDictFile } from "./helpers/dict-writer.js";

// ── deterministic replay hold (MUST run before ingest.ts module load) ───────

const yieldControl = (() => {
  let pending: Array<() => void> = [];
  return {
    yield: (): Promise<void> =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
      }),
    releaseAll: (): void => {
      const fns = pending;
      pending = [];
      for (const f of fns) f();
    },
    get pending(): number {
      return pending.length;
    },
  };
})();
(globalThis as unknown as { scheduler: { yield: () => Promise<void> } }).scheduler =
  { yield: yieldControl.yield };

// Dynamic (value) imports — AFTER the scheduler install above. index.js pulls
// in ingest.js, whose defaultYield captures scheduler.yield at load.
const { default: hapax } = await import("../src/pi/index.js");
const { IngestPipeline, restoreFromHistory } = await import(
  "../src/pi/ingest.js"
);

/** Release every parked replay yield, in rounds, until the replay chain
 *  finishes. The preface turn lets the fire-and-forget rebuild reach its
 *  first park (it starts on microtasks AFTER the session_tree handler
 *  returns); each release round then lets the next yield register within
 *  the same macrotask window. Bounded; exits immediately when a full turn
 *  shows nothing parked (idempotent — safe to call liberally). */
const drain = async (): Promise<void> => {
  for (let i = 0; i < 200; i++) {
    yieldControl.releaseAll();
    await new Promise<void>((r) => setImmediate(r));
    if (yieldControl.pending === 0) return;
  }
};

// ── local fake pi/ctx (replicated from test/index.test.ts on purpose —
//    makeCtx is not exported; the codebase favors local doubles) ────────────

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

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

/** Branch fake in restoreFromHistory's shape: getBranch returns a REVERSED
 *  copy (leaf → root, pi's contract — restoreFromHistory reverses it back),
 *  mirroring test/helpers/session-fixture.ts's asSessionManager for typed
 *  SessionEntry fixtures (same idiom as test/ingest-restore.test.ts). */
const fakeSm = (branch: SessionEntry[]): RestoreSessionManagerLike => ({
  getBranch: () => [...branch].reverse(),
  getEntries: () => branch,
});
interface RestoreSessionManagerLike {
  getBranch: () => SessionEntry[];
  getEntries: () => SessionEntry[];
}

/** Non-message entry (summary/compaction class): restore must FILTER it
 *  without counting it. Single documented boundary cast (the union member's
 *  payload fields are irrelevant — only `type !== "message"` is read). */
const summaryEntry = (id: string): SessionEntry =>
  ({ type: "summary", id, summary: "summagicide neveringest" }) as unknown as SessionEntry;

const treeEvent = (
  newLeafId: string | null,
  oldLeafId: string | null,
): SessionTreeEvent =>
  ({ type: "session_tree", newLeafId, oldLeafId }) as SessionTreeEvent;

function fakePi(): { pi: ExtensionAPI; handlers: Map<string, Handler>; registerCommand: ReturnType<typeof vi.fn> } {
  const handlers = new Map<string, Handler>();
  const on = vi.fn((name: string, handler: Handler) => {
    handlers.set(name, handler);
  });
  const registerCommand = vi.fn();
  return { pi: { on, registerCommand } as unknown as ExtensionAPI, handlers, registerCommand };
}

function fakeCtx(over: { editorFactory?: unknown } = {}) {
  const notify = vi.fn();
  const addAutocompleteProvider = vi.fn();
  const getEditorComponent = vi.fn(() => over.editorFactory);
  const setEditorComponent = vi.fn();
  const isProjectTrusted = vi.fn(() => true);
  const getBranch = vi.fn(() => [] as SessionEntry[]);
  const getEntries = vi.fn(() => [] as SessionEntry[]);
  const ctx = {
    ui: { notify, addAutocompleteProvider, getEditorComponent, setEditorComponent },
    cwd: cwd,
    isProjectTrusted,
    sessionManager: { getBranch, getEntries },
  } as unknown as ExtensionContext;
  return { ctx, addAutocompleteProvider, getEditorComponent, setEditorComponent, getBranch, getEntries };
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

const startSession = (handler: Handler, ctx: ExtensionContext): unknown =>
  handler({ type: "session_start", reason: "new" } as SessionStartEvent, ctx);

const endMessage = async (
  handler: Handler,
  ctx: ExtensionContext,
  message: AgentMessage,
): Promise<unknown> =>
  await handler({ type: "message_end", message } as MessageEndEvent, ctx);

// ── env isolation + /acwords dump (index-level observability) ───────────────

let home = "";
let cwd = "";

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

const useDictPath = (): string => {
  const path = join(cwd, "dict.bin");
  vi.stubEnv("HAPAX_DICT", path);
  return path;
};
const useDict = (): string =>
  writeDictFile(useDictPath(), [{ word: "the", quant: 200 }]);
const enableDebug = (): void => {
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(
    join(home, ".pi", "agent", "hapax.json"),
    JSON.stringify({ debug: true }),
  );
};

/** Default fixture wiring: fake pi + fake ctx + factory invoked. */
const wired = (over: { editorFactory?: unknown } = {}) => {
  useDictPath();
  const { pi, handlers, registerCommand } = fakePi();
  hapax(pi);
  const f = fakeCtx(over);
  return { handlers, registerCommand, ...f };
};

const acwordsHandler = (
  register: ReturnType<typeof vi.fn>,
): ((args: unknown, ctx: unknown) => Promise<void>) =>
  (register.mock.calls.filter((c) => c[0] === "acwords")[0]![1] as { handler: (args: unknown, ctx: unknown) => Promise<void> })
    .handler;

/** Render one /acwords dump (the command notifies its output at "info"). */
const dump = async (
  handler: (args: unknown, ctx: unknown) => Promise<void>,
): Promise<string> => {
  const notify = vi.fn();
  await handler({}, { ui: { notify } });
  return notify.mock.calls.map((c) => c[0] as string).join("\n");
};

/** Longer than the pipeline's 300 ms debounce — for "nothing fires" claims. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 420));

/** Microtask-only flush (never fires real timers) — proves a query is
 *  genuinely HELD, not merely slow. */
const flushMicro = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const PENDING = Symbol("pending");
const track = (p: Promise<unknown>): { slot: () => unknown } => {
  let v: unknown = PENDING;
  void p.then((r) => (v = r));
  return { slot: () => v };
};
const valuesOf = (r: unknown): string[] =>
  ((r as { items: { value: string }[] } | null)?.items ?? []).map((i) => i.value);

// ── store-state snapshot (local — NO src/ serialize/deepEqual helper) ──────

/** Observable store state: entries (key-sorted defensive copies), the sorted
 *  key index, and the per-word successor index (topSuccessors over the union
 *  of entry keys ∪ sorted keys). Compare with toEqual. */
const storeState = (store: CandidateStore) => {
  const entries = [...store.entries()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const words = new Set<string>([
    ...entries.map((e) => e.key),
    ...store.sortedKeysSnapshot(),
  ]);
  const successors = new Map<string, Successor[]>();
  for (const w of words) {
    successors.set(w, [...store.topSuccessors(w)].map((s) => ({ ...s })));
  }
  return { entries, sortedKeys: store.sortedKeysSnapshot(), successors };
};

// ════════════════════════════════════════════════════════════════════════════
// A — core purity (spec 09 h2.59 store bullet; spec 06 h2.42)
// ════════════════════════════════════════════════════════════════════════════

describe("A — branch purity: identical stores for identical sequences (spec 09 h2.59 / spec 06 h2.42)", () => {
  /** All-null → group 0 except `theta` (q 1 → rare-but-attested rank 1):
   *  mixed ranks must replay identically. */
  const stubDict = (): Dictionary => ({
    lookup: (w) => (w === "theta" ? 1 : null),
    version: 1,
    entryCount: 0,
  });

  const makeRig = () => {
    const store = new CandidateStore();
    const pipeline = new IngestPipeline({
      store,
      dictionary: stubDict(),
      yieldFn: async () => {},
      onAdmittedTokens: (runs) =>
        store.recordBigramRuns(runs.map((r) => r.map((m) => m.key))),
    });
    return { store, pipeline };
  };

  /** Fixed sequence: structural caps, mid-cap (tally drift), all-caps, a
   *  dict-rare word, cross-message repeats (merge), bigram-bearing runs. */
  const PURITY_TEXTS = [
    "Alpha beta gamma",
    "delta Alpha beta",
    "NREL theta zeta ALPHA",
  ];

  it("A1: replaying the fixed sequence twice yields identical stores", async () => {
    const a = makeRig();
    const b = makeRig();
    for (const text of PURITY_TEXTS) {
      await a.pipeline.processText(text, true);
      await b.pipeline.processText(text, true);
    }
    expect(storeState(a.store)).toEqual(storeState(b.store));
  });

  it("A2: incremental ≡ reset + restoreFromHistory (tallies + successor index, summary filtered)", async () => {
    const built = makeRig();
    for (const text of PURITY_TEXTS) await built.pipeline.processText(text, true);

    // Branch snapshot: oldest-first WITH a non-message entry — restore
    // filters it WITHOUT counting it, so replay re-issues ordinals 1..3
    // exactly like the incremental build (the equality below pins that).
    const branch: SessionEntry[] = [
      summaryEntry("s0"),
      ...PURITY_TEXTS.map((content, i) =>
        msgEntry(`m${i}`, userMsg(content)),
      ),
    ];
    const rebuilt = makeRig();
    rebuilt.store.reset(); // the h2.42 wholesale drop (fresh-store parity)
    await new Promise<void>((resolve) =>
      restoreFromHistory(
        rebuilt.pipeline,
        fakeSm(branch),
        undefined,
        resolve, // onSettled — replay finished
      ),
    );
    expect(storeState(built.store)).toEqual(storeState(rebuilt.store));
    expect(built.store.currentOrdinal()).toBe(3);
    expect(rebuilt.store.currentOrdinal()).toBe(3);
    // The summary entry never entered the store (h2.37 summary rule).
    expect(rebuilt.store.get("summagicide")).toBeUndefined();
    expect(rebuilt.store.get("neveringest")).toBeUndefined();
  });

  it("A3: dead-branch words never survive and nothing double-counts (successor edges included)", async () => {
    const rig = makeRig();
    // Dead-branch message sharing the word `shared` with the target branch.
    await rig.pipeline.processText("zorpwibbletypo shared one", true);
    rig.store.reset();
    const branch: SessionEntry[] = [
      msgEntry("b1", userMsg("shared alpha")),
      msgEntry("b2", userMsg("shared beta")),
    ];
    await new Promise<void>((resolve) =>
      restoreFromHistory(rig.pipeline, fakeSm(branch), undefined, resolve),
    );
    expect(rig.store.get("zorpwibbletypo")).toBeUndefined();
    expect(rig.store.get("one")).toBeUndefined();
    // Branch count alone — not summed with the dead branch's occurrence.
    expect(rig.store.get("shared")!.sessionCount).toBe(2);
    // Successor index dropped the dead edges too.
    expect([...rig.store.topSuccessors("shared")].map((s) => s.next)).toEqual([
      "alpha",
      "beta",
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B — handler acceptance (index level, fake ctx; spec 09 h2.59 provider bullet)
// ════════════════════════════════════════════════════════════════════════════

describe("B — session_tree rebuild acceptance: queue discard, equal-leaf skip, bounded gate (spec 09 h2.59 / spec 05 h2.37)", () => {
  it("B1: queue discard never loses or double-counts — live text re-captured exactly once, dead text dropped", async () => {
    useDict();
    enableDebug();
    const { handlers, ctx, registerCommand, getBranch } = wired();
    startSession(handlers.get("session_start")!, ctx);
    const acwords = acwordsHandler(registerCommand);

    // Two texts parked inside the 300 ms debounce window (armed, undrained):
    // one whose word is ALSO on the new branch, one dead-branch-only.
    await endMessage(handlers.get("message_end")!, ctx, userMsg("livebranch alpha"));
    await endMessage(handlers.get("message_end")!, ctx, userMsg("zorpqmistake qqdeadj"));

    // Branch (leaf→root as getBranch returns): livebranch in BOTH messages.
    getBranch.mockReturnValue([
      msgEntry("e2", userMsg("livebranch gamma")),
      msgEntry("e1", userMsg("livebranch alpha")),
    ]);
    handlers.get("session_tree")!(treeEvent("l2", "l1"), ctx);

    await vi.waitFor(async () => {
      await drain(); // release the rebuild's parked replay yields
      expect(await dump(acwords)).toContain("livebranch");
    });
    await settle(); // a surviving debounce timer would fire inside this window
    const text = await dump(acwords);
    expect(text).toMatch(/livebranch\s+×2/); // branch-derived — not 1, not 3+
    expect(text).toMatch(/\(ordinal 2\)/); // replay re-issued ordinals 1..2
    expect(text).toContain("alpha");
    expect(text).toContain("gamma");
    expect(text).not.toContain("zorpqmistake"); // queued dead text: never lands
    expect(text).not.toContain("qqdeadj");
  });

  it("B2: newLeafId === oldLeafId (incl. both null) skips the rebuild — not even a getBranch read", () => {
    useDict();
    enableDebug();
    const { handlers, ctx, getBranch, addAutocompleteProvider } = wired();
    startSession(handlers.get("session_start")!, ctx);
    const before = getBranch.mock.calls.length;
    handlers.get("session_tree")!(treeEvent("same", "same"), ctx);
    handlers.get("session_tree")!(treeEvent(null, null), ctx);
    expect(getBranch.mock.calls.length).toBe(before); // snapshot never re-read
    expect(addAutocompleteProvider).toHaveBeenCalledTimes(1); // never re-registered
  });

  const providerOf = (w: ReturnType<typeof wired>): AutocompleteProvider =>
    (w.addAutocompleteProvider.mock.calls[0]![0] as (c: AutocompleteProvider) => AutocompleteProvider)(
      currentFake(),
    );

  /** Pre-seed the store with a drained dead-branch word, then navigate. */
  const seedAndNavigate = async (
    w: ReturnType<typeof wired>,
  ): Promise<void> => {
    await endMessage(w.handlers.get("message_end")!, w.ctx, userMsg("zorpmistake qqq"));
    await settle();
    await drain();
    w.getBranch.mockReturnValue([msgEntry("e1", userMsg("branchword bravo"))]);
    w.handlers.get("session_tree")!(treeEvent("l2", "l1"), w.ctx);
  };

  it("B3a: queries during the replay window resolve only after settle, serving branch vocabulary (forced incl.)", async () => {
    useDict();
    const w = wired();
    startSession(w.handlers.get("session_start")!, w.ctx);
    const provider = providerOf(w);
    await seedAndNavigate(w);

    // Issued WHILE the replay is parked: held behind the gate.
    const plain = track(
      provider.getSuggestions(["bra"], 0, 3, { signal: new AbortController().signal }),
    );
    const forced = track(
      provider.getSuggestions(["bra"], 0, 3, {
        signal: new AbortController().signal,
        force: true,
      }),
    );
    await flushMicro();
    expect(plain.slot()).toBe(PENDING); // held — replay parked at its yield
    expect(forced.slot()).toBe(PENDING); // force never outranks the gate
    expect(yieldControl.pending).toBeGreaterThan(0);

    await drain(); // replay completes → settle → the gate releases
    await vi.waitFor(
      () => {
        expect(plain.slot()).not.toBe(PENDING);
        expect(forced.slot()).not.toBe(PENDING);
      },
      { timeout: 5000 },
    );
    const values = valuesOf(plain.slot());
    expect(values).toContain("branchword"); // branch vocabulary served…
    expect(values).toContain("bravo");
    expect(values.some((v) => v.startsWith("zorp"))).toBe(false); // …never the pre-reset store
  });

  it("B3b: a replay that never settles still releases queries at the ≤ 500 ms bound — then recovers", async () => {
    useDict();
    const w = wired();
    startSession(w.handlers.get("session_start")!, w.ctx);
    const provider = providerOf(w);
    await seedAndNavigate(w); // replay parks at its first yield — never released below

    const plain = track(
      provider.getSuggestions(["bra"], 0, 3, { signal: new AbortController().signal }),
    );
    const forced = track(
      provider.getSuggestions(["bra"], 0, 3, {
        signal: new AbortController().signal,
        force: true,
      }),
    );
    await flushMicro();
    expect(plain.slot()).toBe(PENDING);

    // No settle ever comes (the yield stays parked) — the bound must fire.
    await vi.waitFor(() => expect(plain.slot()).not.toBe(PENDING), {
      timeout: 5000,
      interval: 50,
    });
    expect(forced.slot()).not.toBe(PENDING);
    expect(yieldControl.pending).toBeGreaterThan(0); // replay still parked mid-rebuild
    // Never the PRE-NAVIGATION store: the dead word was dropped by the
    // reset. (Message 1's own upserts land before its yield park — that
    // content legitimately serves; the abandoned vocabulary must not.)
    expect(valuesOf(plain.slot()).some((v) => v.startsWith("zorp"))).toBe(false);

    // Recovery: release the replay; the (same, never re-registered)
    // provider now serves the branch vocabulary.
    await drain();
    await vi.waitFor(async () => {
      const again = await provider.getSuggestions(["bra"], 0, 3, {
        signal: new AbortController().signal,
      });
      expect(valuesOf(again)).toContain("branchword");
    }, { timeout: 5000 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C — widget rebind (spec 09 h2.59 widget bullet; spec 05/07)
// ════════════════════════════════════════════════════════════════════════════

describe("C — session_tree rebinds the widget: claim released, rebuilt store served (spec 09 h2.59 / spec 05/07)", () => {
  interface WidgetEditorDbl {
    render(w: number): string[];
    handleInput(d: string): void;
  }

  /** Foreign (pi-vim-class) editor factory: FRESH editor per call, buffer-
   *  maintaining handleInput so the visibility machine reads typed text. */
  const makeStockFactory = (): { factory: EditorFactory } => {
    const factory: EditorFactory = () => {
      const lines: string[] = [""];
      const editor = {
        render: (): string[] => [...lines],
        getLines: (): string[] => [...lines],
        getCursor: () => ({ line: 0, col: lines[0]!.length }),
        handleInput: (data: string): void => {
          if (data === "\r") return;
          lines[0] = lines[0]! + data;
        },
      };
      return editor;
    };
    return { factory };
  };

  const build = (wrapper: unknown): WidgetEditorDbl =>
    (wrapper as EditorFactory)(undefined, {}, undefined) as WidgetEditorDbl;

  const type = (editor: WidgetEditorDbl, frag: string): void => {
    for (const ch of frag) editor.handleInput(ch);
  };

  it("releases a genuinely-painted claim, rebinds in place, and serves only branch vocabulary after navigation", async () => {
    useDict();
    const stock = makeStockFactory();
    let current: unknown = stock.factory;
    const { handlers, ctx, setEditorComponent, getEditorComponent, getBranch } =
      wired({ editorFactory: current });
    setEditorComponent.mockImplementation((f: unknown) => {
      current = f;
    });
    getEditorComponent.mockImplementation(() => current);

    startSession(handlers.get("session_start")!, ctx);
    const wrapper1 = current;
    expect(isWidgetWrapper(wrapper1)).toBe(true);
    const opts1 = widgetOptsOf(wrapper1)!;

    // Claim the row through a REAL first non-empty paint (not claim.arm()).
    const editor1 = build(wrapper1);
    widgetStateOf(editor1)!.set([{ display: "preword" }]);
    editor1.render(80);
    const claim = opts1.claim!;
    expect(claim.held()).toBe(true);

    // Abandoned-branch vocabulary, fully drained into the store.
    await endMessage(handlers.get("message_end")!, ctx, userMsg("zorpmistake qqq"));
    await settle();
    await drain();

    getBranch.mockReturnValue([msgEntry("e1", userMsg("branchword bravo"))]);
    handlers.get("session_tree")!(treeEvent("l2", "l1"), ctx);

    // (a) the claim was released by the handler (rebind release set).
    expect(claim.held()).toBe(false);
    // (b) fresh composition — around the ORIGINAL inner (no stacking),
    //     SAME in-place store, THIS rebuild's readiness promise.
    expect(setEditorComponent).toHaveBeenCalledTimes(2);
    const wrapper2 = current;
    expect(wrapper2).not.toBe(wrapper1);
    const opts2 = widgetOptsOf(wrapper2)!;
    expect(opts2.inner).toBe(stock.factory);
    expect(opts2.store).toBe(opts1.store);
    expect(opts2.claim).toBe(claim);
    expect(opts2.restoreReady).not.toBe(opts1.restoreReady);

    await drain(); // replay completes → this rebuild's gate settles

    // (c) fragments typed after navigation NEVER complete from abandoned-
    //     branch vocabulary — the widget reads the rebuilt store.
    const editorZ = build(wrapper2);
    type(editorZ, "zorp");
    await vi.waitFor(() => {
      // Zero candidates on the rebuilt store → structurally absent line:
      // byte-identical inner lines (unclaimed row).
      expect(editorZ.render(80)).toEqual(["zorp"]);
    });
    expect(editorZ.render(80).join("\n")).not.toContain("zorpmistake");

    const editorB = build(wrapper2);
    type(editorB, "bra");
    await vi.waitFor(() => {
      expect(editorB.render(80).join("\n")).toContain("branchword");
    });
    const line = editorB.render(80).join("\n");
    expect(line).toContain("bravo");
    expect(line).not.toContain("zorpmistake");
  });
});
