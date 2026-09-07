/**
 * PRD §07 display-layer suite (P1.M3.T3.S3): createDisplayProvider wraps
 * the S2 live provider with the flicker-hysteresis state machine — the
 * menu changes at most once per debounceMs (default 100), the first paint
 * is never delayed, close/delegate events reset state so the next
 * qualifying keystroke re-opens fresh, and narrowing never flaps the menu
 * closed+open (we always return a non-empty set once open). The inner
 * provider is called on EVERY keystroke — Tab resolves against
 * __hapaxLive(), which stays ungated. pi is pull-based: a suppressed set
 * is only remembered as pending; the timer promotes internal state
 * between keystrokes and gives dispose() something to own.
 *
 * All timing runs under vi.useFakeTimers with the clock pinned to 0
 * (vitest 4 fakes Date.now with real-epoch start; setSystemTime(0) makes
 * absolute-time assertions readable). Emissions are recorded as value
 * lists (or "<delegate>") and asserted as whole sequences.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { CandidateStore } from "../src/core/store.js";
import type { Sighting } from "../src/core/types.js";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { HapaxConfig } from "../src/pi/config.js";
import type { LiveResult } from "../src/pi/provider.js";
import { createDisplayProvider, createHapaxProvider } from "../src/pi/provider.js";

/** Fresh group-2 sighting at ordinal 1; override any field. */
const sighting = (over: Partial<Sighting> = {}): Sighting => ({
  key: "hapax",
  display: "hapax",
  ordinal: 1,
  fromUser: false,
  properName: false,
  rankGroup: 2,
  isSubword: false,
  ...over,
});

/** Upsert `key` `times` times at `ordinal` (sessionCount = times). Keys are
 * lowercase (the store's prefix index matches lowercased prefixes); display
 * carries the user-visible casing (h2.27), emitted verbatim in item.value. */
const put = (
  s: CandidateStore,
  key: string,
  times: number,
  ordinal: number,
  over: Partial<Sighting> = {},
): void => {
  for (let i = 0; i < times; i++) {
    s.upsert(sighting({ key, display: key, ordinal, ...over }));
  }
};

/** Store with ze* narrowing fixture — ordering verified against rankMatches:
 * salience desc → zendesk ×4 (9.35) > zendeskagent ×3 (8.7) > zephyr ×1 (6.7);
 * alpha ×2 sits older (ordinal 5) and never enters ze* queries. */
const zeStore = (): CandidateStore => {
  const s = new CandidateStore();
  put(s, "zendesk", 4, 9, { display: "Zendesk" });
  put(s, "zendeskagent", 3, 9, { display: "ZendeskAgent" });
  put(s, "zephyr", 1, 9);
  put(s, "alpha", 2, 5);
  return s;
};

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

/** Mock wrapped provider: contract-shaped spies; no shouldTriggerFileCompletion. */
const mockCurrent = (over: Partial<AutocompleteProvider> = {}): MockedCurrent =>
  ({
    getSuggestions: vi.fn(async () => null),
    applyCompletion: vi.fn(
      (lines: string[], cursorLine: number, cursorCol: number) => ({
        lines,
        cursorLine,
        cursorCol,
      }),
    ),
    ...over,
  }) as MockedCurrent;

/** What pi actually sees per keystroke: the painted value list, or
 * "<delegate>" for a null / empty (invisible) result. */
type Emission = string[] | "<delegate>";

/** Fixture values — derived from the store via rankMatches ordering above. */
const ZE = ["Zendesk", "ZendeskAgent", "zephyr"]; // fragment "ze"
const ZEND = ["Zendesk", "ZendeskAgent"]; // fragment "zend"
const ZENDESKA = ["ZendeskAgent"]; // fragment "zendeska" — strict subset of ZEND

/** Harness: S2 base + S3 wrapper + emission log; emit types a trigger query. */
const harness = (debounceMs?: number) => {
  const current = mockCurrent();
  const base = createHapaxProvider(zeStore(), cfg(), current);
  const wrapper = createDisplayProvider(
    base,
    debounceMs === undefined ? {} : { debounceMs },
  );
  const emissions: Emission[] = [];
  const emit = async (fragment: string): Promise<Emission> => {
    const line = "#" + fragment;
    const result = await wrapper.getSuggestions([line], 0, line.length, opts());
    const e: Emission =
      !result || result.items.length === 0
        ? "<delegate>"
        : result.items.map((i) => i.value);
    emissions.push(e);
    return e;
  };
  return { current, base, wrapper, emissions, emit };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0); // t=0 so suppression-window math reads absolutely
});
afterEach(() => {
  vi.useRealTimers();
});

describe("first paint", () => {
  it("first qualifying keystroke at t=0 → immediate paint, no timer left", async () => {
    const { emissions, emit } = harness();

    expect(await emit("ze")).toEqual(ZE);

    expect(emissions).toEqual([ZE]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("suppression window", () => {
  it("differing set at +50ms → displayed set held; __hapaxLive already fresh (Tab ungated); swap lands after the window", async () => {
    const { base, emissions, emit } = harness();

    await emit("ze"); // paints at t=0
    vi.advanceTimersByTime(50);

    expect(await emit("zend")).toEqual(ZE); // suppressed → old set held
    // Tab contract: the live cache reflects the NEWEST query despite suppression.
    expect(base.__hapaxLive()!.prefix).toBe("#zend");
    expect(base.__hapaxLive()!.matches.map((m) => m.key)).toEqual([
      "zendesk",
      "zendeskagent",
    ]);

    vi.advanceTimersByTime(60); // t=110 ≥ lastPaintAt(0) + 100
    expect(await emit("zend")).toEqual(ZEND); // window elapsed → painted now
    expect(vi.getTimerCount()).toBe(0); // immediate paint cleared the stale timer
    expect(emissions).toEqual([ZE, ZE, ZEND]);
  });

  it("differing set at exactly +100ms → painted immediately (boundary is inclusive)", async () => {
    const { emissions, emit } = harness();

    await emit("ze"); // t=0
    vi.advanceTimersByTime(100);

    expect(await emit("zend")).toEqual(ZEND);
    expect(emissions).toEqual([ZE, ZEND]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("identical set refreshes the window — a later differing set stays suppressed", async () => {
    const { emissions, emit } = harness();

    await emit("ze"); // t=0, lastPaintAt=0
    vi.advanceTimersByTime(60);
    await emit("ze"); // identical sig → repaint, lastPaintAt=60
    vi.advanceTimersByTime(50); // t=110: 110−0 would paint, 110−60 must not

    expect(await emit("zend")).toEqual(ZE); // suppressed by the REFRESHED window

    vi.advanceTimersByTime(50); // t=160: 160−60 ≥ 100
    expect(await emit("zend")).toEqual(ZEND);
    expect(emissions).toEqual([ZE, ZE, ZE, ZEND]);
  });
});

describe("superseded pending", () => {
  it("superseding keystroke replaces the pending set — only the newest set is ever painted", async () => {
    const { emissions, emit } = harness();

    await emit("ze"); // t=0 → ZE painted
    vi.advanceTimersByTime(50);
    await emit("zend"); // t=50 → suppressed, pending=ZEND, timer → t=150
    vi.advanceTimersByTime(20);
    await emit("zendeska"); // t=70 → suppressed, pending=ZENDESKA, timer → t=170

    vi.advanceTimersByTime(100); // t=170: timer promotes ZENDESKA
    expect(await emit("zendeska")).toEqual(ZENDESKA); // sig === displayed → held set

    expect(emissions).toEqual([ZE, ZE, ZE, ZENDESKA]); // ZEND never painted
    expect(emissions).not.toContainEqual(ZEND);
  });
});

describe("narrowing — no close+reopen", () => {
  it("narrowing zend→zendeska holds the old set — no <delegate> between non-empty paints", async () => {
    const { emissions, emit } = harness();

    await emit("zend"); // t=0 → [Zendesk, ZendeskAgent]
    expect(await emit("zendeska")).toEqual(ZEND); // narrowed set suppressed → old held

    vi.advanceTimersByTime(100); // pending promotion
    expect(await emit("zendeska")).toEqual(ZENDESKA); // narrowed set lands

    // No zero/delegate emission ever squeezed between non-empty paints.
    expect(emissions).toEqual([ZEND, ZEND, ZENDESKA]);
    expect(emissions).not.toContain("<delegate>");
  });
});

describe("close events reset state", () => {
  it("zero candidates ('#zzz') → <delegate> unchanged, no timers, next keystroke paints fresh", async () => {
    const { emissions, emit } = harness();

    await emit("zend"); // t=0 → ZEND painted
    vi.advanceTimersByTime(50);
    expect(await emit("zzz")).toEqual("<delegate>"); // close: state dropped
    expect(vi.getTimerCount()).toBe(0);

    expect(await emit("ze")).toEqual(ZE); // fresh paint at t=50 — not the stale ZEND
    expect(emissions).toEqual([ZEND, "<delegate>", ZE]);
  });

  it("delegated built-in result → passes through by identity, never enters the debounce machine", async () => {
    const sentinel = {
      items: [{ value: "src/index.ts", label: "src/index.ts" }],
      prefix: "/",
    };
    const { base, wrapper, emissions, emit } = harness();

    await emit("zend"); // prime a real hapax paint (stale live cache afterwards)
    vi.spyOn(base, "getSuggestions").mockResolvedValue(sentinel);
    const result = await wrapper.getSuggestions(["/s"], 0, 3, opts());

    expect(result).toBe(sentinel); // pass-through, not a copy, not suppressed
    expect(emissions).toEqual([ZEND]); // no hapax emission for the delegate
    expect(vi.getTimerCount()).toBe(0);
  });

  it("space (delegate) then re-qualify within the window → fresh open paints immediately", async () => {
    const { emissions, emit } = harness();

    await emit("zend"); // t=0 → ZEND painted
    vi.advanceTimersByTime(50);
    expect(await emit(" ")).toEqual("<delegate>"); // '# ' is no match → close + reset

    // t=50, within the old window: a stale machine would suppress and hold
    // ZEND; the reset one paints the fresh ZE set at once.
    expect(await emit("ze")).toEqual(ZE);
    expect(emissions).toEqual([ZEND, "<delegate>", ZE]);
  });

  it("live-but-empty hapax result (defensive) → close semantics, passed through unchanged", async () => {
    // Hand-rolled base: a hapax-shaped result with zero items must never
    // render (PRD §01 invariant 3) — S2 shouldn't produce it, we still close.
    const empty = { items: [] as AutocompleteItem[], prefix: "#ze" };
    const live = (): LiveResult => ({ matches: [], prefix: "#ze", ts: 0 });
    const base: AutocompleteProvider & { __hapaxLive: () => LiveResult | null } = {
      getSuggestions: vi.fn(async () => empty),
      applyCompletion: (lines, cursorLine, cursorCol) => ({
        lines,
        cursorLine,
        cursorCol,
      }),
      __hapaxLive: live,
    };
    const wrapper = createDisplayProvider(base);

    const result = await wrapper.getSuggestions(["#ze"], 0, 3, opts());

    expect(result).toBe(empty); // unchanged
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("pass-through members", () => {
  it("applyCompletion → delegates with all five arguments and returns base's result", () => {
    const { base, wrapper } = harness();
    const spy = vi.spyOn(base, "applyCompletion");
    const lines = ["foo #ze"];
    const item = { value: "Zendesk", label: "Zendesk", description: "session x4" };

    const out = wrapper.applyCompletion(lines, 0, 7, item, "#ze");

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(lines, 0, 7, item, "#ze");
    expect(out).toEqual({ lines, cursorLine: 0, cursorCol: 7 });
  });

  it("shouldTriggerFileCompletion and triggerCharacters → mirrored from base", () => {
    const current = mockCurrent({ shouldTriggerFileCompletion: vi.fn(() => false) });
    const base = createHapaxProvider(zeStore(), cfg(), current);
    const wrapper = createDisplayProvider(base);

    expect(wrapper.shouldTriggerFileCompletion!(["x"], 0, 1)).toBe(false);
    expect(current.shouldTriggerFileCompletion).toHaveBeenCalledWith(["x"], 0, 1);
    expect(wrapper.triggerCharacters).toEqual(["#"]);
  });
});

describe("dispose", () => {
  it("suppressed swap then dispose() → timer count 0; advancing time never promotes the pending set", async () => {
    const { wrapper, emissions, emit } = harness();

    await emit("ze"); // t=0 → ZE painted
    vi.advanceTimersByTime(50);
    await emit("zend"); // suppressed → pending=ZEND, timer armed
    expect(vi.getTimerCount()).toBe(1);

    wrapper.dispose();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(500); // the swap would have fired at t=150
    expect(await emit("ze")).toEqual(ZE); // ZE again — ZEND never surfaces
    expect(emissions).toEqual([ZE, ZE, ZE]);
    expect(emissions).not.toContainEqual(ZEND);
  });
});