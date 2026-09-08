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
 *
 * BUG-002 (P1.M4.T1.S1): suppression may only re-serve a displayed set
 * whose prefix EQUALS the fresh prefix (hard invariant — never return a
 * prefix that is not the exact suffix of the line at the cursor; pi-tui
 * deletes prefix.length chars verbatim at Tab). Keystrokes that move the
 * anchor (cross-prefix narrowing) therefore paint immediately; the
 * suppression-window tests below use identical-prefix store mutations
 * (ingest changes membership mid-window) to exercise the debounce.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { CandidateStore } from "../src/core/store.js";
import type { Sighting } from "../src/core/types.js";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { HapaxConfig } from "../src/pi/config.js";
import type { LiveResult } from "../src/pi/provider.js";
import { createDisplayProvider, createHapaxProvider } from "../src/pi/provider.js";
import { editorApplyCompletion, prefixIsAnchorSafe } from "./helpers/editor-sim.js";

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

/** BUG-002 repro store — exactly zendesk (display "Zendesk") ×3 + zephyr ×1.
 *  'z' alone stays below the 2-char threshold; 'ze' paints both; 'zep'
 *  live-narrows to zephyr. Ordering via rankMatches: Zendesk (8.70) >
 *  zephyr (6.70). */
const reproStore = (): CandidateStore => {
  const s = new CandidateStore();
  put(s, "zendesk", 3, 9, { display: "Zendesk" });
  put(s, "zephyr", 1, 9);
  return s;
};

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

/** Harness: S2 base + S3 wrapper + emission log; emit types a trigger query.
 *  The underlying store is returned so tests can mutate membership
 *  mid-window (identical-prefix suppression scenarios, BUG-002). */
const harness = (debounceMs?: number, store: CandidateStore = zeStore()) => {
  const current = mockCurrent();
  const base = createHapaxProvider(store, cfg(), current);
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
  return { current, base, wrapper, emissions, emit, store };
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
  it("cross-prefix narrowing at +50ms → paints immediately (anchor-safe, BUG-002); __hapaxLive stays fresh", async () => {
    const { base, emissions, emit } = harness();

    await emit("ze"); // paints at t=0, prefix "#ze"
    vi.advanceTimersByTime(50);

    // Typing moved the anchor ("#ze" → "#zend"): re-serving the old set
    // would hand pi the stale "#ze" prefix, and Tab would delete the wrong
    // characters (BUG-002). The fresh set paints at once instead.
    expect(await emit("zend")).toEqual(ZEND);
    // Tab contract: the live cache reflects the NEWEST query regardless.
    expect(base.__hapaxLive()!.prefix).toBe("#zend");
    expect(base.__hapaxLive()!.matches.map((m) => m.key)).toEqual([
      "zendesk",
      "zendeskagent",
    ]);

    expect(emissions).toEqual([ZE, ZEND]);
    expect(vi.getTimerCount()).toBe(0); // immediate paint, no swap left armed
  });

  it("differing set at exactly +100ms → painted immediately (boundary is inclusive)", async () => {
    const { emissions, emit } = harness();

    await emit("ze"); // t=0
    vi.advanceTimersByTime(100);

    expect(await emit("zend")).toEqual(ZEND);
    expect(emissions).toEqual([ZE, ZEND]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("identical set refreshes the window — a later identical-prefix membership change stays suppressed", async () => {
    const { store, emissions, emit } = harness();

    await emit("ze"); // t=0, lastPaintAt=0
    vi.advanceTimersByTime(60);
    await emit("ze"); // identical sig → repaint, lastPaintAt=60
    vi.advanceTimersByTime(50); // t=110: 110−0 would paint, 110−60 must not

    // Ingest changes membership mid-window WITHOUT moving the anchor:
    // same fragment "ze" (same prefix "#ze"), different set → still
    // suppressed by the REFRESHED window.
    put(store, "zesty", 2, 9, { display: "Zesty" });
    expect(await emit("ze")).toEqual(ZE); // suppressed — Zesty not shown yet

    vi.advanceTimersByTime(60); // t=170: 170−60 ≥ 100 → pending promoted
    // zeStore membership: Zendesk 9.35 > ZendeskAgent 8.70 > Zesty 7.87 > zephyr 6.70
    expect(await emit("ze")).toEqual(["Zendesk", "ZendeskAgent", "Zesty", "zephyr"]);
    expect(emissions).toEqual([
      ZE,
      ZE,
      ZE,
      ["Zendesk", "ZendeskAgent", "Zesty", "zephyr"],
    ]);
  });
});

describe("rapid Tab-Tab integrity (acceptance invalidates the anchor)", () => {
  it("applyCompletion since the last paint → the next qualifying result paints immediately, never the stale set", async () => {
    const { base, store, wrapper, emissions, emit } = harness();

    await emit("ze"); // t=0 → ZE painted
    vi.advanceTimersByTime(50);
    // Tab accepts a hapax item: the buffer changes underneath the painted
    // set, and pi's immediate re-query lands INSIDE the suppression window.
    wrapper.applyCompletion(
      ["#ze"],
      0,
      4,
      { value: "Zendesk", label: "Zendesk", description: "" },
      "#ze",
    );
    expect(base.__hapaxLive()).not.toBeNull();

    // The stale displayed set must NOT be re-served: its prefix anchors
    // the PRE-acceptance buffer, and applying it would replace the wrong
    // characters (buffer corruption). The fresh set paints at once.
    expect(await emit("zend")).toEqual(ZEND);
    expect(emissions).toEqual([ZE, ZEND]);

    // Normal debounce resumes after the fresh paint — for IDENTICAL-PREFIX
    // set changes (ingest membership), the only kind suppression may hold
    // (cross-prefix narrowing paints immediately, BUG-002).
    put(store, "zendzest", 2, 9, { display: "ZendZest" }); // enters "zend" queries
    vi.advanceTimersByTime(30); // t=80 < lastPaintAt(50) + 100
    expect(await emit("zend")).toEqual(ZEND); // suppressed again — same prefix "#zend"
    expect(emissions).toEqual([ZE, ZEND, ZEND]);
  });
});

describe("superseded pending", () => {
  it("superseding identical-prefix membership change replaces the pending set — only the newest set is ever painted", async () => {
    const { store, emissions, emit } = harness();

    await emit("ze"); // t=0 → ZE painted
    vi.advanceTimersByTime(50);
    put(store, "zesty", 2, 9, { display: "Zesty" });
    await emit("ze"); // t=50 → same prefix, new set → suppressed, pending=[Ze,Zesty,zephyr]
    vi.advanceTimersByTime(20);
    put(store, "zeta", 2, 9, { display: "Zeta" });
    await emit("ze"); // t=70 → pending superseded by the newest membership

    vi.advanceTimersByTime(100); // t=170: timer promotes the newest membership
    // zeStore ordering: Zendesk 9.35 > ZendeskAgent 8.70 > Zesty/Zeta 7.87
    // (tie → byte-lex "zeta" < "zesty") > zephyr 6.70.
    const newest = ["Zendesk", "ZendeskAgent", "Zeta", "Zesty", "zephyr"];
    expect(await emit("ze")).toEqual(newest); // sig === displayed → held

    expect(emissions).toEqual([ZE, ZE, ZE, newest]);
    expect(emissions).not.toContainEqual(["Zendesk", "ZendeskAgent", "Zesty", "zephyr"]); // set1 never painted
  });
});

describe("narrowing — no close+reopen", () => {
  it("narrowing zend→zendeska paints the fresh set immediately (anchor-safe) — still no <delegate> between paints", async () => {
    const { emissions, emit } = harness();

    await emit("zend"); // t=0 → [Zendesk, ZendeskAgent]
    // Cross-prefix narrowing paints immediately (BUG-002 anchor safety):
    // holding the old set would re-serve the stale "#zend" prefix.
    expect(await emit("zendeska")).toEqual(ZENDESKA);

    // Still no zero/delegate emission squeezed between non-empty paints —
    // the never-close invariant is untouched by the anchor fix.
    expect(emissions).toEqual([ZEND, ZENDESKA]);
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
  it("suppressed identical-prefix swap then dispose() → timer count 0; advancing time never promotes the pending set", async () => {
    const { store, wrapper, emissions, emit } = harness();

    await emit("ze"); // t=0 → ZE painted
    vi.advanceTimersByTime(50);
    put(store, "zesty", 2, 9, { display: "Zesty" }); // membership change, same prefix
    await emit("ze"); // suppressed → pending=[Ze,Zesty,zephyr], timer armed
    expect(vi.getTimerCount()).toBe(1);

    wrapper.dispose();
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(500); // the swap would have fired at t=150
    expect(vi.getTimerCount()).toBe(0); // cancelled, not deferred
    // A post-dispose query behaves like a fresh stack — pi is pull-based,
    // so the pending swap can only ever surface through a query, and the
    // timer that would have auto-promoted it is gone.
    expect(await emit("zend")).toEqual(ZEND);
    expect(emissions).toEqual([ZE, ZE, ZEND]);
    expect(emissions).not.toContainEqual(["Zendesk", "ZendeskAgent", "Zesty", "zephyr"]);
  });
});

describe("prefix-anchor invalidation (BUG-002)", () => {
  /** Threshold-mode typing (the PRD repro: plain chars, no '#' trigger):
   *  each query sees the WHOLE current line, exactly as pi's editor passes
   *  it back. Below the 2-char threshold extractMatchState returns null →
   *  the stack delegates. */
  const type = async (
    wrapper: ReturnType<typeof createDisplayProvider>,
    line: string,
  ): Promise<AutocompleteSuggestions | null> =>
    wrapper.getSuggestions([line], 0, line.length, opts());

  it("repro: 'ze' paints {Zendesk,zephyr}; 'zep' inside the window returns prefix 'zep', never 'ze'; Tab never corrupts", async () => {
    const current = mockCurrent();
    const base = createHapaxProvider(reproStore(), cfg(), current);
    const wrapper = createDisplayProvider(base);

    // 'z' — below threshold → null match state → full-stack delegate.
    expect(await type(wrapper, "z")).toBeNull();

    // 'e' — buffer "ze": first qualifying query → immediate paint of both.
    const ze = await type(wrapper, "ze");
    expect(ze!.items.map((i) => i.value)).toEqual(["Zendesk", "zephyr"]);
    expect(ze!.prefix).toBe("ze");

    // 'p' typed 50 ms later, inside the suppression window: the fresh
    // result narrows to zephyr @prefix "zep". The old code re-served the
    // displayed set with the STALE "ze" prefix here — the exact
    // "zzendesk" corruption anchor.
    vi.advanceTimersByTime(50);
    const zep = await type(wrapper, "zep");
    expect(zep!.items.map((i) => i.value)).toEqual(["zephyr"]);
    expect(zep!.prefix).toBe("zep"); // NEVER "ze"
    expect(prefixIsAnchorSafe("zep", 3, zep!.prefix)).toBe(true);

    // Tab-apply through pi-tui's REAL deletion math: blind
    // prefix.length splice. Anchor-safe prefix + matching buffer →
    // correct completion, no duplicated text.
    const completed = editorApplyCompletion("zep", 3, zep!.items[0]!.value, zep!.prefix);
    expect(completed).toBe("zephyr");
    expect(completed).not.toContain("zzendesk");
    expect(completed).not.toContain("zZendesk");
  });

  it("Tab after a pause: immediate paint cleared any pending swap; the anchor stays suffix-safe with no further keystroke", async () => {
    const current = mockCurrent();
    const base = createHapaxProvider(reproStore(), cfg(), current);
    const wrapper = createDisplayProvider(base);

    await type(wrapper, "ze"); // paints {Zendesk, zephyr} @"ze" at t=0
    vi.advanceTimersByTime(50);
    const zep = await type(wrapper, "zep"); // immediate paint @"zep" (anchor moved)
    expect(zep!.prefix).toBe("zep");

    // Pause past the debounce: an immediate paint superseded every timer —
    // nothing pending, nothing that could re-introduce a stale anchor.
    vi.advanceTimersByTime(150);
    expect(vi.getTimerCount()).toBe(0);

    // Tab with NO further keystroke: pi applies the last returned
    // suggestions. Their prefix is the fresh "zep" — exactly the buffer's
    // suffix — so the splice replaces only the fragment.
    const completed = editorApplyCompletion("zep", 3, zep!.items[0]!.value, zep!.prefix);
    expect(completed).toBe("zephyr");
  });

  it("Tab after a promoted identical-prefix pending: last response's prefix still matches the unchanged buffer", async () => {
    const store = reproStore();
    const current = mockCurrent();
    const base = createHapaxProvider(store, cfg(), current);
    const wrapper = createDisplayProvider(base);

    const firstPaint = await type(wrapper, "ze"); // paints @"ze"
    void firstPaint;
    vi.advanceTimersByTime(50);
    put(store, "zesty", 2, 9, { display: "Zesty" }); // membership change only
    const held = await type(wrapper, "ze"); // identical prefix → suppressed
    expect(held!.items.map((i) => i.value)).toEqual(["Zendesk", "zephyr"]);
    expect(held!.prefix).toBe("ze"); // anchor-safe: buffer still "ze"

    vi.advanceTimersByTime(100); // pending swap promotes internally
    // Tab with NO further keystroke: pi applies the last RESPONSE (the
    // held set). Its prefix matches the unchanged buffer — safe splice.
    const completed = editorApplyCompletion("ze", 2, held!.items[0]!.value, held!.prefix);
    expect(completed).toBe("Zendesk");
  });

  it("suppression preserved: identical prefix + differing set (ingest membership) → displayed set held, swap lands later", async () => {
    const store = reproStore();
    const current = mockCurrent();
    const base = createHapaxProvider(store, cfg(), current);
    const wrapper = createDisplayProvider(base);

    await type(wrapper, "ze"); // t=0 → {Zendesk, zephyr}@"ze"
    vi.advanceTimersByTime(50);
    put(store, "zesty", 2, 9, { display: "Zesty" }); // ingest mid-window

    // Prefix identical ("ze"), set differs → suppression must hold (the
    // 4d branch below the anchor exception is untouched).
    const held = await type(wrapper, "ze");
    expect(held!.items.map((i) => i.value)).toEqual(["Zendesk", "zephyr"]);
    expect(held!.prefix).toBe("ze");
    expect(vi.getTimerCount()).toBe(1); // swap armed

    vi.advanceTimersByTime(100); // t=150 ≥ 50+100 → promote
    const landed = await type(wrapper, "ze");
    expect(landed!.items.map((i) => i.value)).toEqual(["Zendesk", "Zesty", "zephyr"]);
    expect(landed!.prefix).toBe("ze");
  });
});