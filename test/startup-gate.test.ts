/**
 * Startup gate (src/pi/provider.ts createStartupGate) — the fix for
 * "first typed word after restart missed its menu": queries racing an
 * unfinished history replay wait (bounded) for the replay's settled
 * signal; once settled, pure pass-through. Also pins
 * restoreFromHistory's onSettled contract (exactly once: end, abort,
 * or error).
 */
import { describe, expect, it, vi } from "vitest";

import { restoreFromHistory } from "../src/pi/ingest.js";
import type { RestoreSessionManager } from "../src/pi/ingest.js";
import { createStartupGate } from "../src/pi/provider.js";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";

/** Deferred helper. */
const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

/** Minimal provider double with a call recorder. */
const fakeBase = () => {
  const calls: string[] = [];
  const base = {
    calls,
    triggerCharacters: ["#"],
    getSuggestions: async (lines: string[], _l: number, _c: number, o: { force?: boolean }) => {
      calls.push(`q:${lines[0]}${o.force ? ":force" : ""}`);
      return { items: [], prefix: "" };
    },
    applyCompletion: (l: unknown, a: unknown, b: unknown, c: unknown, d: unknown) => {
      calls.push(`apply:${String(d)}`);
      return { lines: l as string[], cursorLine: a as number, cursorCol: b as number };
    },
    shouldTriggerFileCompletion: () => true,
    __hapaxLive: () => ({ marker: "live" }),
    __hapaxKey: (v: string) => `key:${v}`,
  } as unknown as AutocompleteProvider & {
    __hapaxLive: () => unknown;
    __hapaxKey: (v: string) => unknown;
    calls: string[];
  };
  return base;
};

describe("createStartupGate", () => {
  it("a query racing an unfinished replay WAITS for the settled signal, then queries", async () => {
    const base = fakeBase();
    const { promise, resolve } = deferred();
    const gate = createStartupGate(base, promise);

    let out: unknown;
    const p = gate.getSuggestions(["ze"], 0, 2, { signal: new AbortController().signal });
    void p.then((r) => (out = r));
    await Promise.resolve();
    await Promise.resolve();
    expect(base.calls).toEqual([]); // still waiting — replay not settled

    resolve();
    await p;
    expect(base.calls).toEqual(["q:ze"]); // queried after settle
    expect(out).toEqual({ items: [], prefix: "" });
  });

  it("the wait is BOUNDED: a replay that never settles delays the query by ≤ maxWaitMs", async () => {
    vi.useFakeTimers();
    try {
      const base = fakeBase();
      const never = new Promise<void>(() => {});
      const gate = createStartupGate(base, never, 500);
      const p = gate.getSuggestions(["ze"], 0, 2, { signal: new AbortController().signal });
      const pending = vi.waitFor(() => expect(base.calls.length).toBe(0), { timeout: 50 });
      await pending.catch(() => {});
      await vi.advanceTimersByTimeAsync(500);
      await p;
      expect(base.calls).toEqual(["q:ze"]); // cap elapsed → query anyway
    } finally {
      vi.useRealTimers();
    }
  });

  it("settled gate is a pure pass-through (zero wait), and members forward", async () => {
    const base = fakeBase();
    const { promise, resolve } = deferred();
    const gate = createStartupGate(base, promise);
    resolve();
    await promise;

    const t0 = Date.now();
    await gate.getSuggestions(["ze"], 0, 2, { signal: new AbortController().signal });
    expect(Date.now() - t0).toBeLessThan(50);
    expect(base.calls).toEqual(["q:ze"]);
    // Spread-forwarded members reach the base closures verbatim.
    expect(gate.triggerCharacters).toEqual(["#"]);
    expect((gate as unknown as { __hapaxLive(): unknown }).__hapaxLive()).toEqual({ marker: "live" });
    expect((gate as unknown as { __hapaxKey(v: string): unknown }).__hapaxKey("x")).toBe("key:x");
  });

  it("a REJECTED replay promise still unblocks the gate (errors never wedge it)", async () => {
    const base = fakeBase();
    let reject!: () => void;
    const doomed = new Promise<void>((_, r) => {
      reject = r;
    });
    const gate = createStartupGate(base, doomed);
    reject();
    await gate.getSuggestions(["ze"], 0, 2, { signal: new AbortController().signal });
    expect(base.calls).toEqual(["q:ze"]);
  });
});

describe("restoreFromHistory onSettled (exactly once, always)", () => {
  const pipelineStub = () => ({ processText: vi.fn(async () => {}) });
  const sessionManager = (entries: unknown[]): RestoreSessionManager =>
    ({
      getBranch: () => [],
      getEntries: () => entries as never[],
    }) as RestoreSessionManager;

  it("settles after replay finishes", async () => {
    const settled = vi.fn();
    restoreFromHistory(
      pipelineStub(),
      sessionManager([{ type: "message", message: { role: "user", content: "hi" } }]),
      undefined,
      settled,
    );
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
  });

  it("settles on abort (BUG-004 dict failure path)", async () => {
    const settled = vi.fn();
    restoreFromHistory(
      pipelineStub(),
      sessionManager([{ type: "message", message: { role: "user", content: "hi" } }]),
      () => true, // abort immediately
      settled,
    );
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
  });

  it("settles on empty history", async () => {
    const settled = vi.fn();
    restoreFromHistory(pipelineStub(), sessionManager([]), undefined, settled);
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
  });
});
