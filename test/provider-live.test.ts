/**
 * PRD §07 live-provider suite (P1.M3.T3.S2): createHapaxProvider wraps
 * pi's current AutocompleteProvider and answers EVERY keystroke with a
 * synchronous store query (rule 1 — zero awaits on the hapax path),
 * mapped to pi's AutocompleteSuggestions shape. Delegation is the
 * safety net: aborted signals, null match state (S1), and zero
 * candidates all forward the ORIGINAL arguments to the wrapped provider
 * untouched, so pi's path/slash completion is never hijacked. The
 * live-result cache (__hapaxLive) and the value→key side-map
 * (__hapaxKey) are the documented seams read by S3's display debounce
 * and P2.M2.T2.S1's Tab-armed chaining.
 *
 * `current` is a vi.fn() mock — S2's contract with it is delegation,
 * not implementation. Stores are built by upserting fabricated
 * Sightings (same fixture style as store/query tests).
 */

import { describe, expect, it, vi, type Mock } from "vitest";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { CandidateStore } from "../src/core/store.js";
import type { Sighting } from "../src/core/types.js";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { HapaxConfig } from "../src/pi/config.js";
import { createHapaxProvider } from "../src/pi/provider.js";

/** Fresh group-2 sighting of "hapax" at ordinal 1; override any field. */
const sighting = (over: Partial<Sighting> = {}): Sighting => ({
  key: "hapax",
  display: "hapax",
  ordinal: 1,
  fromUser: false,
  properName: false,
  casing: "lower",
  rankGroup: 2,
  ...over,
});

/** Upsert `key` `times` times at `ordinal` (sessionCount = times). */
const put = (
  s: CandidateStore,
  key: string,
  times = 1,
  ordinal = 1,
  over: Partial<Sighting> = {},
): void => {
  for (let i = 0; i < times; i++) {
    s.upsert(sighting({ key, display: key, ordinal, ...over }));
  }
};

/** Store with ze* + alpha candidates: Zendesk ×3 (recent), zephyr ×1,
 *  alpha ×2 (older). zephyr (6 chars) is SHORTER than Zendesk (7) —
 *  under §04 h2.29 (progressive completion: tier tie → shorter key
 *  first, count only breaks equal-length ties) zephyr sorts FIRST. */
const zeStore = (): CandidateStore => {
  const s = new CandidateStore();
  put(s, "zendesk", 3, 9, { display: "Zendesk", casing: "mid-cap" });
  put(s, "zephyr", 1, 9);
  put(s, "alpha", 2, 5);
  return s;
};

/** Fresh config per call — never mutate DEFAULT_CONFIG. */
const cfg = (over: Partial<HapaxConfig> = {}): HapaxConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

/** Fresh { signal } per call (real AbortController — no fake timers needed). */
const opts = (over: { force?: boolean } = {}): { signal: AbortSignal; force?: boolean } => ({
  signal: new AbortController().signal,
  ...over,
});

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

describe("delegation — aborted signal (args untouched)", () => {
  it("aborted signal → delegates once with the exact original arguments", async () => {
    const sentinel = {
      items: [{ value: "path/to/file", label: "path/to/file" }],
      prefix: "/",
    };
    const current = mockCurrent({ getSuggestions: vi.fn(async () => sentinel) });
    const provider = createHapaxProvider(zeStore(), cfg(), current);
    const lines = ["foo #ze"]; // hapax match state EXISTS — abort still wins
    const controller = new AbortController();
    controller.abort();
    const options = { signal: controller.signal, force: true };

    const result = await provider.getSuggestions(lines, 0, 7, options);

    expect(result).toBe(sentinel); // pass-through, not a copy
    expect(current.getSuggestions).toHaveBeenCalledOnce();
    const call = current.getSuggestions.mock.calls[0];
    expect(call[0]).toBe(lines); // same array object
    expect(call[1]).toBe(0);
    expect(call[2]).toBe(7);
    expect(call[3]).toBe(options); // same options object — force not dropped
  });
});

describe("delegation — null match state (args untouched)", () => {
  it("fragment 'z' below config threshold 2 → still answers (auto-open: pi-tui only asks at word start, effective threshold 1)", async () => {
    const current = mockCurrent();
    const provider = createHapaxProvider(zeStore(), cfg(), current);
    const lines = ["z"];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 1, options);

    expect(result!.prefix).toBe("z");
    expect(result!.items.map((i) => i.value)).toEqual(["zephyr", "Zendesk"]); // length-first (§04 h2.29)
    expect(current.getSuggestions).not.toHaveBeenCalled(); // hapax owns the word-start request
  });
});

describe("delegation — zero candidates clear the live cache first", () => {
  it("state but zero matches ('#zzz') → live cache cleared → delegates", async () => {
    const current = mockCurrent();
    const provider = createHapaxProvider(zeStore(), cfg(), current);
    await provider.getSuggestions(["#ze"], 0, 3, opts()); // prime the cache
    expect(provider.__hapaxLive()).not.toBeNull();
    const lines = ["#zzz"];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 4, options);

    expect(result).toBeNull();
    expect(provider.__hapaxLive()).toBeNull(); // S3 closes, never stale
    expect(provider.__hapaxKey("Zendesk")).toBeUndefined(); // side-map cleared too
    expect(current.getSuggestions).toHaveBeenCalledOnce(); // only the '#zzz' call
    expect(current.getSuggestions.mock.calls[0][0]).toBe(lines);
    expect(current.getSuggestions.mock.calls[0][3]).toBe(options);
  });
});

describe("hapax result path — synchronous query, pi-shaped mapping", () => {
  it("'#ze' → { items, prefix: '#ze' } with display casing and query.ts descriptions", async () => {
    const current = mockCurrent();
    const provider = createHapaxProvider(zeStore(), cfg(), current);

    const result = await provider.getSuggestions(["foo #ze"], 0, 7, opts());

    expect(current.getSuggestions).not.toHaveBeenCalled(); // never hijacks
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe("#ze"); // trigger prefix includes '#'
    expect(result!.items).toHaveLength(2); // exactly the ze* candidates
    expect(result!.items[0]).toEqual({
      value: "zephyr", // stored display casing (h2.27), length-first top
      label: "zephyr",
      description: "session x1", // query.ts provenance, verbatim
    });
    expect(result!.items[1].value).toBe("Zendesk");
    expect(result!.items[1].description).toBe("session x3");
  });

  it("threshold mode 'ze' → same items, bare-fragment prefix 'ze'", async () => {
    const provider = createHapaxProvider(zeStore(), cfg(), mockCurrent());

    const result = await provider.getSuggestions(["ze"], 0, 2, opts());

    expect(result!.prefix).toBe("ze"); // no trigger char in threshold mode
    expect(result!.items.map((i) => i.value)).toEqual(["zephyr", "Zendesk"]); // length-first (§04 h2.29)
  });

  it("items.length respects maxSuggestions (1 → only the top match)", async () => {
    const provider = createHapaxProvider(
      zeStore(),
      cfg({ maxSuggestions: 1 }),
      mockCurrent(),
    );

    const result = await provider.getSuggestions(["ze"], 0, 2, opts());

    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].value).toBe("zephyr"); // length-first top (tier-3 tie → h2.29 key 2)
  });

  it("zero awaits on the hapax path — the live cache is published before the promise is awaited", () => {
    const provider = createHapaxProvider(zeStore(), cfg(), mockCurrent());

    const promise = provider.getSuggestions(["#ze"], 0, 3, opts());

    expect(provider.__hapaxLive()).not.toBeNull(); // set synchronously
    return promise.then((result) => {
      expect(result!.items).toHaveLength(2);
    });
  });
});

describe("live-result seams for S3 / P2.M2.T2.S1", () => {
  it("successful query publishes __hapaxLive with matches, prefix, ts", async () => {
    const provider = createHapaxProvider(zeStore(), cfg(), mockCurrent());
    const before = Date.now();

    await provider.getSuggestions(["#ze"], 0, 3, opts());

    const live = provider.__hapaxLive();
    expect(live).not.toBeNull();
    expect(live!.prefix).toBe("#ze");
    expect(live!.matches.map((m) => m.key)).toEqual(["zephyr", "zendesk"]); // length-first publication order
    expect(live!.ts).toBeGreaterThanOrEqual(before);
    expect(live!.ts).toBeLessThanOrEqual(Date.now());
  });

  it("__hapaxKey maps emitted display values back to store keys", async () => {
    const provider = createHapaxProvider(zeStore(), cfg(), mockCurrent());

    await provider.getSuggestions(["#ze"], 0, 3, opts());

    expect(provider.__hapaxKey("Zendesk")).toBe("zendesk");
    expect(provider.__hapaxKey("zephyr")).toBe("zephyr");
    expect(provider.__hapaxKey("alpha")).toBeUndefined(); // not emitted
    expect(provider.__hapaxKey("nope")).toBeUndefined();
  });

  it("the key map is rebuilt per query — values from the previous query vanish", async () => {
    const provider = createHapaxProvider(zeStore(), cfg(), mockCurrent());

    await provider.getSuggestions(["#ze"], 0, 3, opts());
    await provider.getSuggestions(["#a"], 0, 2, opts()); // only alpha matches

    expect(provider.__hapaxKey("alpha")).toBe("alpha");
    expect(provider.__hapaxKey("Zendesk")).toBeUndefined(); // stale value gone
    expect(provider.__hapaxLive()!.prefix).toBe("#a");
  });
});

describe("pass-through members", () => {
  it("applyCompletion delegates with all five arguments and returns current's result", () => {
    const current = mockCurrent();
    const provider = createHapaxProvider(new CandidateStore(), cfg(), current);
    const lines = ["foo #ze"];
    const item = { value: "Zendesk", label: "Zendesk", description: "session x3" };

    const out = provider.applyCompletion(lines, 0, 7, item, "#ze");

    expect(current.applyCompletion).toHaveBeenCalledOnce();
    expect(current.applyCompletion).toHaveBeenCalledWith(lines, 0, 7, item, "#ze");
    expect(out).toEqual({ lines, cursorLine: 0, cursorCol: 7 });
  });

  it("shouldTriggerFileCompletion returns true when current does not define it", () => {
    const provider = createHapaxProvider(new CandidateStore(), cfg(), mockCurrent());

    // The factory always defines shouldTriggerFileCompletion — the ! is
    // only for the optional member on pi's interface.
    expect(provider.shouldTriggerFileCompletion!([], 0, 0)).toBe(true);
  });

  it("shouldTriggerFileCompletion delegates to current when present", () => {
    const spy = vi.fn(() => false);
    const current = mockCurrent({ shouldTriggerFileCompletion: spy });
    const provider = createHapaxProvider(new CandidateStore(), cfg(), current);

    expect(provider.shouldTriggerFileCompletion!(["x"], 0, 1)).toBe(false);
    expect(spy).toHaveBeenCalledWith(["x"], 0, 1);
  });
});

describe("triggerCharacters mirror config.triggerChar + identifier triggers", () => {
  const ID = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_".split("");

  it("default config → ['#'] + identifier chars (auto-open on word typing)", () => {
    const provider = createHapaxProvider(new CandidateStore(), cfg(), mockCurrent());
    expect(provider.triggerCharacters).toEqual(["#", ...ID]);
  });

  it("triggerChar '' (trigger mode disabled) → identifier chars only, never undefined", () => {
    const provider = createHapaxProvider(
      new CandidateStore(),
      cfg({ triggerChar: "" }),
      mockCurrent(),
    );
    expect(provider.triggerCharacters).toEqual(ID);
  });
});

describe("forced single-item returns (PRD §07 h3.8)", () => {
  /** Arm "alpha" via the ONLY production path — a live menu + Tab
   *  acceptance (armViaTab pattern from chain.test.ts; the factory's
   *  default chain machine is real) — then seed alpha→beta(3),
   *  alpha→bravo(2) through the sole bigram seam, so the count-desc top
   *  successor is "beta". */
  const armAlpha = async (
    store: CandidateStore,
    provider: ReturnType<typeof createHapaxProvider>,
  ): Promise<void> => {
    put(store, "alpha", 3, 5);
    const menu = await provider.getSuggestions(["alph"], 0, 4, opts());
    expect(menu!.items.map((i) => i.value)).toContain("alpha");
    for (let r = 0; r < 3; r++) store.recordBigramRuns([["alpha", "beta"]]);
    for (let r = 0; r < 2; r++) store.recordBigramRuns([["alpha", "bravo"]]);
    provider.applyCompletion(
      ["alph"],
      0,
      4,
      { value: "alpha", label: "alpha" },
      "alph",
    );
  };

  it("force:true + threshold fragment 'ze' → exactly the live top, prefix unchanged", async () => {
    const provider = createHapaxProvider(zeStore(), cfg(), mockCurrent());

    const result = await provider.getSuggestions(["ze"], 0, 2, opts({ force: true }));

    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(1); // pi-tui's === 1 fast path fires
    expect(result!.items[0].value).toBe("zephyr"); // length-first top (h2.29 key 2)
    expect(result!.prefix).toBe("ze"); // prefix unchanged under force
    // The seam keeps the FULL set — only the returned payload narrowed.
    expect(provider.__hapaxLive()!.matches).toHaveLength(2);
    expect(provider.__hapaxLive()!.matches[0].key).toBe("zephyr");
    expect(provider.__hapaxLive()!.prefix).toBe("ze");
  });

  it("force absent/false → full set, byte-identical legacy behavior", async () => {
    const provider = createHapaxProvider(zeStore(), cfg(), mockCurrent());

    const unforced = await provider.getSuggestions(["ze"], 0, 2, opts());
    const forceFalse = await provider.getSuggestions(["ze"], 0, 2, opts({ force: false }));

    expect(unforced!.items.map((i) => i.value)).toEqual(["zephyr", "Zendesk"]);
    expect(forceFalse!.items.map((i) => i.value)).toEqual(["zephyr", "Zendesk"]);
  });

  it("force:true + trigger fragment '#ze' → 1 item, trigger prefix kept", async () => {
    const provider = createHapaxProvider(zeStore(), cfg(), mockCurrent());

    const result = await provider.getSuggestions(["#ze"], 0, 3, opts({ force: true }));

    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].value).toBe("zephyr"); // length-first top (h2.29)
    expect(result!.prefix).toBe("#ze");
    expect(provider.__hapaxLive()!.matches).toHaveLength(2); // full set published
  });

  it("force:true + 1-char fragment → single top item (auto-open contract: effective threshold 1)", async () => {
    const current = mockCurrent();
    const provider = createHapaxProvider(zeStore(), cfg(), current);
    const lines = ["z"];
    const options = opts({ force: true });

    const result = await provider.getSuggestions(lines, 0, 1, options);

    expect(result!.items).toHaveLength(1); // pi-tui's === 1 fast path
    expect(result!.items[0].value).toBe("zephyr"); // length-first top (h2.29)
    expect(result!.prefix).toBe("z");
    expect(current.getSuggestions).not.toHaveBeenCalled();
  });

  it("force:true + zero candidates ('#zzz') → delegates; no fabricated empty set", async () => {
    const current = mockCurrent();
    const provider = createHapaxProvider(zeStore(), cfg(), current);
    const options = opts({ force: true });
    await provider.getSuggestions(["#ze"], 0, 3, opts()); // prime the cache

    const result = await provider.getSuggestions(["#zzz"], 0, 4, options);

    expect(result).toBeNull(); // stock pi-tui cancels + renders nothing
    expect(provider.__hapaxLive()).toBeNull(); // cache drop preserved
    expect(current.getSuggestions.mock.calls[0][3]).toBe(options);
  });

  it("force:true + aborted signal → abort still wins (delegates first)", async () => {
    const current = mockCurrent();
    const provider = createHapaxProvider(zeStore(), cfg(), current);
    const controller = new AbortController();
    controller.abort();
    const options = { signal: controller.signal, force: true };

    await provider.getSuggestions(["ze"], 0, 2, options);

    expect(current.getSuggestions).toHaveBeenCalledOnce();
    expect(current.getSuggestions.mock.calls[0][3]).toBe(options);
  });

  it("force:true + armed zero-char word start → 1 item = count-desc top successor, prefix ''", async () => {
    const store = new CandidateStore();
    const provider = createHapaxProvider(store, cfg(), mockCurrent());
    await armAlpha(store, provider);

    const result = await provider.getSuggestions(["alpha "], 0, 6, opts({ force: true }));

    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].value).toBe("beta"); // beta×3 out-counts bravo×2
    expect(result!.items[0].label).toBe("beta"); // bare value
    expect(result!.prefix).toBe(""); // zero-char offer prefix unchanged
    // The seam still holds the FULL successor set (S2/S3 compose on it).
    const live = provider.__hapaxLive()!;
    expect(live.matches.map((m) => m.display)).toEqual(["beta", "bravo"]);
    expect(live.prefix).toBe("");
  });

  it("force:true + armed typed fragment → 1 item = top matching successor", async () => {
    const store = new CandidateStore();
    const provider = createHapaxProvider(store, cfg(), mockCurrent());
    await armAlpha(store, provider);

    const result = await provider.getSuggestions(["alpha b"], 0, 7, opts({ force: true }));

    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].value).toBe("beta");
    expect(result!.prefix).toBe("b"); // the raw typed fragment
  });
});
describe("armed chain + stock context (BUG-001)", () => {
  /** Arm "alpha" via the ONLY production path — a live menu + Tab
   *  acceptance (same recipe as the forced-single-item suite). */
  const armAlpha = async (
    store: CandidateStore,
    provider: ReturnType<typeof createHapaxProvider>,
  ): Promise<void> => {
    put(store, "alpha", 3, 5);
    const menu = await provider.getSuggestions(["alph"], 0, 4, opts());
    expect(menu!.items.map((i) => i.value)).toContain("alpha");
    provider.applyCompletion(
      ["alph"],
      0,
      4,
      { value: "alpha", label: "alpha" },
      "alph",
    );
  };

  it("'/re' while a chain is armed delegates to current (stock gate precedes the armed branch)", async () => {
    const sentinel = {
      items: [{ value: "/resume", label: "/resume", description: "stock" }],
      prefix: "/re",
    };
    const current = mockCurrent({ getSuggestions: vi.fn(async () => sentinel) });
    const store = new CandidateStore();
    const provider = createHapaxProvider(store, cfg(), current);
    await armAlpha(store, provider); // chain now armed on "alpha"

    const lines = ["/re"];
    const options = opts();
    const result = await provider.getSuggestions(lines, 0, 3, options);

    expect(result).toBe(sentinel); // stock context wins over the armed branch
    expect(current.getSuggestions).toHaveBeenCalledOnce();
    expect(current.getSuggestions.mock.calls[0][0]).toBe(lines); // same array
    expect(current.getSuggestions.mock.calls[0][3]).toBe(options); // same object
    // Deliberately NOT asserting chain reset here — P1.M1.T2 owns the
    // armed-state-after-stock-delegation rules; this pins delegation only.
  });
});

describe("hyphenated-compound completion (2026-09 compound rule)", () => {
  const compoundStore = (): CandidateStore => {
    const s = new CandidateStore();
    put(s, "load-bearing", 3, 9);
    return s;
  };

  it("fragment regex admits inner hyphens: 'load-b' → prefix 'load-b', matches the compound", async () => {
    const provider = createHapaxProvider(compoundStore(), cfg(), mockCurrent());
    const result = await provider.getSuggestions(["the load-b"], 0, 10, opts());
    expect(result!.prefix).toBe("load-b");
    expect(result!.items.map((i) => i.value)).toEqual(["load-bearing"]);
  });

  it("trailing-hyphen fragment continues the compound: 'load-' matches", async () => {
    const provider = createHapaxProvider(compoundStore(), cfg(), mockCurrent());
    const result = await provider.getSuggestions(["the load-"], 0, 9, opts());
    expect(result!.prefix).toBe("load-");
    expect(result!.items.map((i) => i.value)).toEqual(["load-bearing"]);
  });

  it("word-start query still opens the menu for a compound: 'load' matches", async () => {
    const provider = createHapaxProvider(compoundStore(), cfg(), mockCurrent());
    const result = await provider.getSuggestions(["the load"], 0, 8, opts());
    expect(result!.prefix).toBe("load");
    expect(result!.items.map((i) => i.value)).toEqual(["load-bearing"]);
  });
});
