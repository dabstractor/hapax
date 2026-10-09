/**
 * Never-hijack acceptance suite (P1.M3.T3.S4) — the regression net for
 * PRD §01 invariant 1 ("never hijack typing") and PRD §07's never-hijack
 * rules, exercised at the exact object stack registered in P1.M3.T5.S1:
 *
 *   provider = createDisplayProvider(createHapaxProvider(store, config, current))
 *
 * The provider only ever RETURNS suggestions; pi owns all key handling.
 * Every case here asserts one of two disciplines:
 *
 *   DELEGATION — on every non-hapax path (no match state, zero
 *   candidates, aborted signal) the wrapped `current` provider is called
 *   with the unchanged original arguments (object identity on all four
 *   args, including the options object) and its result — sentinel or
 *   null — is returned untouched, so pi's path/slash completion
 *   (quoting paths, @-mentions) keeps working exactly as before.
 *
 *   EMISSION — zero-candidate queries never render a hapax menu
 *   (__hapaxLive() stays null); common words ("the", "context", q ≥
 *   REJECT_COMMON_THRESHOLD) never enter the store so they can never
 *   surface; and the provider's own surface is exactly pi's
 *   AutocompleteProvider contract plus the documented dispose seam —
 *   no key handling of any kind, Tab semantics stay pi's.
 *
 * `current` is a vi.fn() mock returning recognizable sentinels, so
 * pass-through is provable by object identity, not call counts. A fresh
 * store + provider per test keeps S3's debounce state out of every
 * assertion. P2.M2.T2.S1 (chain machine) MUST keep this suite green.
 */

import { describe, expect, it, vi, type Mock } from "vitest";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import type { CandidateDraft } from "../src/core/segment.js";
import { rankMatches } from "../src/core/query.js";
import { admit, REJECT_COMMON_THRESHOLD } from "../src/core/score.js";
import { CandidateStore } from "../src/core/store.js";
import type { Dictionary, Sighting } from "../src/core/types.js";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { HapaxConfig } from "../src/pi/config.js";
import {
  createChainMachine,
  createDisplayProvider,
  createHapaxProvider,
  extractMatchState,
} from "../src/pi/provider.js";

// ── fixtures ────────────────────────────────────────────────────────────────

/** Fresh group-2 sighting at ordinal 1; override any field. */
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

/** Upsert `key` `times` times at `ordinal` (display casing via `over`). */
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

/** Fresh config per call (defaults: trigger "#", threshold 2, max 8). */
const cfg = (over: Partial<HapaxConfig> = {}): HapaxConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

/** Fresh { signal } per call (real AbortController — no fake timers). */
const opts = (): { signal: AbortSignal } => ({ signal: new AbortController().signal });

type MockedCurrent = AutocompleteProvider & {
  getSuggestions: Mock;
  applyCompletion: Mock;
  shouldTriggerFileCompletion: Mock;
};

/** Mock wrapped provider: contract-shaped spies over the FULL surface. */
const makeCurrent = (over: Partial<AutocompleteProvider> = {}): MockedCurrent =>
  ({
    getSuggestions: vi.fn(async () => null),
    applyCompletion: vi.fn(
      (
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        item: AutocompleteItem,
        prefix: string,
      ) => ({
        lines,
        cursorLine,
        cursorCol: cursorCol + item.value.length - prefix.length,
      }),
    ),
    shouldTriggerFileCompletion: vi.fn(() => true),
    ...over,
  }) as MockedCurrent;

/** The exact registration stack of P1.M3.T5.S1, with the inner provider
 *  exposed for __hapaxLive() assertions. Fresh per test. */
function makeStack(store: CandidateStore, current: AutocompleteProvider) {
  const inner = createHapaxProvider(store, cfg(), current);
  const provider = createDisplayProvider(inner);
  return { inner, provider };
}

/** Non-hapax sentinel pi's built-in provider might return (path completion). */
const PATH_SENTINEL: AutocompleteSuggestions = {
  items: [{ value: "/path/", label: "/path/" }],
  prefix: "",
};

/** One getSuggestions call through the display wrapper, fresh options. */
const suggest = (
  provider: AutocompleteProvider,
  lines: string[],
  line: number,
  col: number,
): Promise<AutocompleteSuggestions | null> => provider.getSuggestions(lines, line, col, opts());

/** All four forwarded args arrived as the SAME objects/values pi passed. */
const expectUntouchedArgs = (
  current: MockedCurrent,
  lines: string[],
  line: number,
  col: number,
  options: { signal: AbortSignal },
): void => {
  expect(current.getSuggestions).toHaveBeenCalledOnce();
  const call = current.getSuggestions.mock.calls[0];
  expect(call[0]).toBe(lines); // same array object — never cloned/rebuilt
  expect(call[1]).toBe(line);
  expect(call[2]).toBe(col);
  expect(call[3]).toBe(options); // same options object — signal/force intact
};

// ── cases ───────────────────────────────────────────────────────────────────

// ── fuzzThreshold config pass-through (plan 003 P1.M2.T1.S3) ──────────────

describe("fuzzThreshold config reaches the provider's query (plan 003 P1.M2.T1.S3)", () => {
  it("config fuzzThreshold: 100 → exact-prefix-only mode end-to-end: prefix probes render, non-prefix fragments delegate", async () => {
    // SCAN-SEQUENCING REALITY (see test/query.test.ts's S2 note): the
    // rankMatches scan is prefix-only until P1.M2.T2.S2 generalizes it,
    // so every provider-reachable candidate scores exactly 100 and ANY
    // configured threshold ≤ 100 renders it (strict <). Provable
    // end-to-end TODAY — and pinned here — is the mode's full-stack
    // behavior: the clamped knob (config {fuzzThreshold: 100}) flows
    // through provider.getSuggestions without breaking the prefix-only
    // contract; observable tier-2/1 filtering activates with T2.S2.
    const store = new CandidateStore();
    put(store, "zendesk", 2);
    const current = makeCurrent({
      getSuggestions: vi.fn(async () => PATH_SENTINEL),
    });
    // plan 004: the provider resolves per mode via resolveFuzzThreshold —
    // an EXPLICIT setting is expressed by fuzzThresholdSet (loadConfig
    // sets it; config.test.ts pins the resolution table), so the raw
    // 100 without the flag would now mean "unset → mode defaults".
    const provider = createHapaxProvider(
      store,
      cfg({ fuzzThreshold: 100, fuzzThresholdSet: true }),
      current,
    );

    // Exact-prefix probe at the knob's prefix-only setting: renders.
    const hit = await suggest(provider, ["zen"], 0, 3);
    expect(hit?.items.map((i) => i.value)).toEqual(["zendesk"]);
    expect(hit?.prefix).toBe("zen");
    expect(current.getSuggestions).not.toHaveBeenCalled();

    // A fragment with no exact prefix in the store: zero candidates →
    // delegate untouched (never-hijack discipline holds in this mode).
    const miss = await suggest(provider, ["zsk"], 0, 3);
    expect(miss).toBe(PATH_SENTINEL);
    expect(current.getSuggestions).toHaveBeenCalledOnce();
  });
});

describe("never-hijack acceptance (PRD §07)", () => {
  describe("case (a) — no fragment → untouched delegation", () => {
    it("empty line, col 0 → match state null → delegates with identical arguments, sentinel returned as-is", async () => {
      const current = makeCurrent({ getSuggestions: vi.fn(async () => PATH_SENTINEL) });
      const { provider } = makeStack(new CandidateStore(), current);
      const lines = [""];
      const options = opts();

      expect(extractMatchState(lines, 0, 0, cfg())).toBeNull(); // precondition: S1 null
      const result = await provider.getSuggestions(lines, 0, 0, options);

      expectUntouchedArgs(current, lines, 0, 0, options);
      expect(result).toBe(PATH_SENTINEL); // identity — pi's result, not a copy
    });

    it("prose 'hello ' after a space → CLOSE (2026-09 close-on-space rule), never delegate into pi's file listing", async () => {
      const current = makeCurrent(); // getSuggestions → null
      const { provider } = makeStack(new CandidateStore(), current);
      const lines = ["hello "];
      const options = opts();

      expect(extractMatchState(lines, 0, 6, cfg())).toBeNull();
      const result = await provider.getSuggestions(lines, 0, 6, options);

      // pi's stock provider treats a trailing space as the start of file
      // completion (extractPathPrefix → "" → the whole cwd listing);
      // delegating there replaced hapax's closing menu with a stuck file
      // menu. The rule: plain trailing space (no '@', no '/') closes.
      expect(result).toBeNull();
      expect(current.getSuggestions).not.toHaveBeenCalled();
    });

    it("quoted path 'read \"src/co' → delegated so pi's path completion keeps working", async () => {
      // Threshold state EXISTS ("co", length 2) but the store has no "co…"
      // candidates → the zero-candidate delegate path. Either way pi's
      // quoted-path completion receives the request untouched.
      const store = new CandidateStore();
      put(store, "nrel", 2, 3, { display: "NREL", casing: "mid-cap", properName: true });
      put(store, "zendesk", 3, 9, { display: "Zendesk", casing: "mid-cap" });
      const current = makeCurrent({ getSuggestions: vi.fn(async () => PATH_SENTINEL) });
      const { inner, provider } = makeStack(store, current);
      const lines = ['read "src/co'];
      const options = opts();

      const result = await provider.getSuggestions(lines, 0, lines[0].length, options);

      expectUntouchedArgs(current, lines, 0, lines[0].length, options);
      expect(result).toBe(PATH_SENTINEL);
      expect(inner.__hapaxLive()).toBeNull(); // no hapax menu ever armed
    });
  });

  describe("case (b) — applyCompletion ALWAYS delegates", () => {
    it("with a live hapax menu → arbitrary args forwarded verbatim, current's return passed through", async () => {
      const store = new CandidateStore();
      put(store, "zendesk", 3, 9, { display: "Zendesk", casing: "mid-cap" });
      const current = makeCurrent();
      const { inner, provider } = makeStack(store, current);

      // Arm a live menu first (first paint is immediate — no debounce).
      const menu = await suggest(provider, ["#zen"], 0, 4);
      expect(menu?.items.map((i) => i.value)).toContain("Zendesk");
      expect(inner.__hapaxLive()).not.toBeNull(); // hapax menu IS live

      // Now applyCompletion with arbitrary args — hapax must not touch them.
      const lines = ["#zen"];
      const item: AutocompleteItem = { value: "Zendesk", label: "Zendesk" };
      const ret = provider.applyCompletion(lines, 0, 4, item, "#zen");

      expect(current.applyCompletion).toHaveBeenCalledOnce();
      const call = current.applyCompletion.mock.calls[0];
      expect(call[0]).toBe(lines); // verbatim: same objects, same numbers
      expect(call[1]).toBe(0);
      expect(call[2]).toBe(4);
      expect(call[3]).toBe(item);
      expect(call[4]).toBe("#zen");
      expect(ret).toEqual({ lines, cursorLine: 0, cursorCol: 7 }); // 4 + 7 - 4
      expect(ret.lines).toBe(lines); // return passed through, not rebuilt
    });
  });

  describe("case (c) — shouldTriggerFileCompletion delegation", () => {
    it("defined on current → verbatim delegate, its return value passed through", () => {
      const current = makeCurrent({ shouldTriggerFileCompletion: vi.fn(() => false) });
      const { provider } = makeStack(new CandidateStore(), current);
      const lines = ["src/ma"];
      expect(typeof provider.shouldTriggerFileCompletion).toBe("function");
      const result = provider.shouldTriggerFileCompletion!(lines, 0, 6);

      expect(result).toBe(false); // current said false — not hapax's default
      expect(current.shouldTriggerFileCompletion).toHaveBeenCalledOnce();
      const call = current.shouldTriggerFileCompletion.mock.calls[0];
      expect(call[0]).toBe(lines);
      expect(call[1]).toBe(0);
      expect(call[2]).toBe(6);
    });

    it("absent on current → returns true (pi's own behavior), no throw", () => {
      const current = makeCurrent({ shouldTriggerFileCompletion: undefined });
      const { provider } = makeStack(new CandidateStore(), current);

      // The wrapper method itself is always defined — 'absent' lives on current.
      const result = provider.shouldTriggerFileCompletion!(["x"], 0, 1);

      expect(result).toBe(true); // ?.() ?? true
      expect(current.getSuggestions).not.toHaveBeenCalled();
    });
  });

  describe("case (d) — zero-candidate query → delegation, never a menu", () => {
    it("fragment 'zzzz' qualifies (≥ threshold) but store has no candidates → current's exact return, __hapaxLive() null", async () => {
      const store = new CandidateStore();
      put(store, "nrel", 2, 3, { display: "NREL", casing: "mid-cap", properName: true });
      put(store, "zendesk", 3, 9, { display: "Zendesk", casing: "mid-cap" });
      const current = makeCurrent({ getSuggestions: vi.fn(async () => PATH_SENTINEL) });
      const { inner, provider } = makeStack(store, current);
      const lines = ["zzzz"];
      const options = opts();

      // Precondition: the match state DOES qualify — delegation here is the
      // zero-candidate path, not the null-match-state path.
      expect(extractMatchState(lines, 0, 4, cfg())?.fragment).toBe("zzzz");
      const result = await provider.getSuggestions(lines, 0, 4, options);

      expectUntouchedArgs(current, lines, 0, 4, options);
      expect(result).toBe(PATH_SENTINEL); // exactly current's return — zero hapax items
      expect(inner.__hapaxLive()).toBeNull(); // cache cleared: no menu armed
    });
  });

  describe("case (e) — common words never produce hapax items", () => {
    it("admission: q ≥ REJECT_COMMON_THRESHOLD rejects 'the' and 'context' before the store ever sees them", () => {
      const commonAt = (q: number): Dictionary => ({
        lookup: () => q,
        version: 1,
        entryCount: 0,
      });
      const draft = (key: string): CandidateDraft => ({
        key,
        display: key,
        properName: false,
        casing: "lower",
      });

      expect(admit(draft("the"), commonAt(REJECT_COMMON_THRESHOLD))).toBe("reject");
      expect(admit(draft("context"), commonAt(REJECT_COMMON_THRESHOLD + 35))).toBe("reject");
      // The boundary is q ≥ REJECT_COMMON_THRESHOLD exactly: just below it
      // the word is admitted.
      expect(admit(draft("the"), commonAt(REJECT_COMMON_THRESHOLD - 1))).not.toBe("reject");
    });

    it("end-to-end: store without common words + lines ending 'the'/'contex' → delegation, zero hapax items", async () => {
      const store = new CandidateStore();
      put(store, "nrel", 2, 3, { display: "NREL", casing: "mid-cap", properName: true });
      put(store, "zendesk", 3, 9, { display: "Zendesk", casing: "mid-cap" }); // store is NOT empty
      const current = makeCurrent({ getSuggestions: vi.fn(async () => PATH_SENTINEL) });
      const { inner, provider } = makeStack(store, current);

      for (const [line, col] of [
        ["the", 3],
        ["contex", 6],
      ] as const) {
        current.getSuggestions.mockClear(); // each query asserted in isolation
        const lines = [line];
        const options = opts();
        const result = await provider.getSuggestions(lines, 0, col, options);
        expectUntouchedArgs(current, lines, 0, col, options);
        expect(result).toBe(PATH_SENTINEL); // no hapax items ever emitted
      }
      expect(inner.__hapaxLive()).toBeNull();
    });
  });

  describe("case (f) — Tab pass-through — nothing intercepts", () => {
    it("provider surface is exactly the pi-tui contract + dispose, and non-qualifying queries hand the result back", async () => {
      const current = makeCurrent({ getSuggestions: vi.fn(async () => PATH_SENTINEL) });
      const { provider } = makeStack(new CandidateStore(), current);

      // No key-handling surface of ANY kind: pi owns Tab. The provider's own
      // enumerable keys are only the AutocompleteProvider contract members
      // plus S3's documented dispose seam.
      expect(Object.keys(provider).sort()).toEqual([
        "applyCompletion",
        "dispose",
        "getSuggestions",
        "shouldTriggerFileCompletion",
        "triggerCharacters",
      ]);

      // With nothing qualifying there is no visible/selected suggestion —
      // getSuggestions hands pi's own result straight back.
      const lines = [""];
      const options = opts();
      const result = await provider.getSuggestions(lines, 0, 0, options);
      expectUntouchedArgs(current, lines, 0, 0, options);
      expect(result).toBe(PATH_SENTINEL);
    });
  });

  describe("case (g) — case-insensitive match, display casing inserted", () => {
    it("typed 'nre' matches stored NREL — item.value === 'NREL', prefix 'nre', no delegation", async () => {
      const store = new CandidateStore();
      put(store, "nrel", 2, 3, { display: "NREL", casing: "mid-cap", properName: true });
      const current = makeCurrent();
      const { inner, provider } = makeStack(store, current);

      // One char short of the full key: the exact-equal exclusion (§04
      // h2.29) offers nothing once "nrel" is fully typed.
      const result = await suggest(provider, ["nre"], 0, 3);

      expect(current.getSuggestions).not.toHaveBeenCalled(); // hapax answered
      expect(inner.__hapaxLive()?.prefix).toBe("nre"); // live menu, not delegate
      expect(result?.prefix).toBe("nre");
      const nrel = result?.items.filter((i) => i.value === "NREL") ?? [];
      expect(nrel).toHaveLength(1); // prefix matched case-insensitively…
      expect(nrel[0].label).toBe("NREL"); // …insertion uses display casing
    });
  });
});

describe("Tab-only-completes — forced path (PRD §09 bullet; PRD §07 h3.8)", () => {
  /** Fresh ze-fixture: zephyr (6 chars) is SHORTER than Zendesk (7) →
   *  forced top is "zephyr" (same fixture as provider-live.test.ts;
   *  §04 h2.29 progressive-completion order: length before count). */
  const zeStore = (): CandidateStore => {
    const s = new CandidateStore();
    put(s, "zendesk", 3, 9, { display: "Zendesk", casing: "mid-cap" });
    put(s, "zephyr", 1, 9);
    return s;
  };

  it("Tab-before-paint: a direct forced query with no prior paint returns exactly the top item", async () => {
    // The editor's Tab-with-no-menu path calls getSuggestions(force:true)
    // with no preceding query at this keystroke; per pi-tui's editor.js
    // ~1903 (`options.force && options.explicitTab &&
    // suggestions.items.length === 1` → applyCompletion in the same
    // keypress), hapax's single-item return makes Tab complete instead of
    // opening the menu. Primed with NOTHING — the cold path is the bug's
    // repro shape.
    const current = makeCurrent();
    const { provider } = makeStack(zeStore(), current);
    const options = { signal: new AbortController().signal, force: true };

    const result = await provider.getSuggestions(["ze"], 0, 2, options);

    expect(current.getSuggestions).not.toHaveBeenCalled(); // hapax answered
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0].value).toBe("zephyr"); // length-first top (h2.29)
    expect(result?.prefix).toBe("ze");
  });

  it("Tab never opens/toggles/summons a menu: forced live queries never return length > 1", async () => {
    // Threshold fragment, trigger fragment, and the armed zero-char chain
    // offer — every hapax-owned forced return is single-item (the seam the
    // editor fast path consumes; a multi-item forced return would open a
    // menu in pi-tui's 'force' state).
    const current = makeCurrent();
    const { inner, provider } = makeStack(zeStore(), current);

    const threshold = await provider.getSuggestions(["ze"], 0, 2, {
      signal: new AbortController().signal,
      force: true,
    });
    const trigger = await provider.getSuggestions(["#ze"], 0, 3, {
      signal: new AbortController().signal,
      force: true,
    });
    expect(threshold?.items.length).toBe(1);
    expect(trigger?.items.length).toBe(1);

    // Armed chain: arm "alpha" via the production path (live menu + Tab),
    // then a forced zero-char word start offers exactly the top successor.
    // A dedicated inner bound to the alpha store (default machine) — the
    // stack's inner holds the ze fixture.
    const store = new CandidateStore();
    put(store, "alpha", 3, 5);
    const chainInner = createHapaxProvider(store, cfg(), current);
    const menu = await chainInner.getSuggestions(["alph"], 0, 4, opts());
    expect(menu?.items.map((i) => i.value)).toContain("alpha");
    for (let r = 0; r < 3; r++) store.recordBigramRuns([["alpha", "beta"]]);
    for (let r = 0; r < 2; r++) store.recordBigramRuns([["alpha", "bravo"]]);
    chainInner.applyCompletion(
      ["alpha"],
      0,
      5,
      { value: "alpha", label: "alpha" },
      "alpha",
    );
    const armed = await chainInner.getSuggestions(["alpha "], 0, 6, {
      signal: new AbortController().signal,
      force: true,
    });
    expect(armed?.items).toHaveLength(1);
    expect(armed?.items[0].value).toBe("beta");
  });

  it("menu auto-open semantics unaffected: force:false still returns the full multi-item set", async () => {
    // Typing, not Tab, drives the menu: without force the full ranked set
    // flows (the display layer's auto-open rules are untouched by the
    // mitigation).
    const current = makeCurrent();
    const { provider } = makeStack(zeStore(), current);

    const result = await provider.getSuggestions(["ze"], 0, 2, {
      signal: new AbortController().signal,
      force: false,
    });

    expect(result?.items.map((i) => i.value)).toEqual(["zephyr", "Zendesk"]); // length-first (h2.29)
  });
});
// ── stock-context delegation (BUG-001) ──────────────────────────────────────

describe("stock-context delegation (BUG-001)", () => {
  /** Sentinel pi's stock completion returns in slash/mention/path contexts. */
  const STOCK_SENTINEL: AutocompleteSuggestions = {
    items: [{ value: "/resume", label: "/resume", description: "stock" }],
    prefix: "/re",
  };

  /** Store holding a rare word whose prefix collides with the stock probes
   *  ("renewable" matches fragment "re"): proves the GATE, not candidate
   *  absence, drives the delegating cases. */
  const reStore = (): CandidateStore => {
    const s = new CandidateStore();
    put(s, "renewable", 2, 4);
    return s;
  };

  it("'/re' (slash command, force:false) delegates with args by identity", async () => {
    const current = makeCurrent({ getSuggestions: vi.fn(async () => STOCK_SENTINEL) });
    const { inner, provider } = makeStack(reStore(), current);
    const lines = ["/re"];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 3, options);

    expect(result).toBe(STOCK_SENTINEL); // identity — pi's menu, not a copy
    expectUntouchedArgs(current, lines, 0, 3, options);
    expect(inner.__hapaxLive()).toBeNull(); // no hapax menu ever painted
  });

  it("'/re' with force:true STILL delegates (stock gate outranks the force read — Tab-opens-menu fix)", async () => {
    const current = makeCurrent({ getSuggestions: vi.fn(async () => STOCK_SENTINEL) });
    const { inner, provider } = makeStack(reStore(), current);
    const lines = ["/re"];
    const options = { signal: new AbortController().signal, force: true };

    const result = await provider.getSuggestions(lines, 0, 3, options);

    expect(result).toBe(STOCK_SENTINEL);
    expectUntouchedArgs(current, lines, 0, 3, options);
    expect(inner.__hapaxLive()).toBeNull();
  });

  it("'@jo' (mention) delegates", async () => {
    const current = makeCurrent({ getSuggestions: vi.fn(async () => STOCK_SENTINEL) });
    const { provider } = makeStack(new CandidateStore(), current);
    const lines = ["@jo"];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 3, options);

    expect(result).toBe(STOCK_SENTINEL);
    expectUntouchedArgs(current, lines, 0, 3, options);
  });

  it("'\"src/roun' (quoted path) delegates", async () => {
    const current = makeCurrent({ getSuggestions: vi.fn(async () => STOCK_SENTINEL) });
    const { provider } = makeStack(new CandidateStore(), current);
    const lines = ['"src/roun'];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 9, options);

    expect(result).toBe(STOCK_SENTINEL);
    expectUntouchedArgs(current, lines, 0, 9, options);
  });

  it("'src/roun' (path) delegates", async () => {
    const current = makeCurrent({ getSuggestions: vi.fn(async () => STOCK_SENTINEL) });
    const { provider } = makeStack(new CandidateStore(), current);
    const lines = ["src/roun"];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 8, options);

    expect(result).toBe(STOCK_SENTINEL);
    expectUntouchedArgs(current, lines, 0, 8, options);
  });

  it("'/model arg re' does NOT delegate (classifier no-space clause) — hapax answers with the store word", async () => {
    // Slash WITH a spaced argument is not a stock menu context (the
    // classifier's no-space clause returns null), so the plain threshold
    // word-completion path stays hapax's — even after the '/'.
    const current = makeCurrent({ getSuggestions: vi.fn(async () => STOCK_SENTINEL) });
    const { inner, provider } = makeStack(reStore(), current);
    const lines = ["/model arg re"];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 13, options);

    expect(current.getSuggestions).not.toHaveBeenCalled();
    expect(result).not.toBe(STOCK_SENTINEL);
    expect(result?.items.map((i) => i.value)).toContain("renewable");
    expect(inner.__hapaxLive()).not.toBeNull(); // hapax owns this menu
  });

  it("plain 're' (prose fragment) after ingest → hapax items, gate silent on prose", async () => {
    const current = makeCurrent({ getSuggestions: vi.fn(async () => STOCK_SENTINEL) });
    const { inner, provider } = makeStack(reStore(), current);
    const lines = ["re"];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 2, options);

    expect(current.getSuggestions).not.toHaveBeenCalled();
    expect(result).not.toBe(STOCK_SENTINEL);
    expect(result?.items.map((i) => i.value)).toContain("renewable");
    expect(inner.__hapaxLive()).not.toBeNull();
  });
});

// ── path-candidate interaction (rule 4d baseline, P1.M1.T2.S4) ─────────────
// Spec §07 auto-open + §09 integration items 6–7, made CI-executable at the
// provider seam (the live-TTY half is P1.M3.T4.S1's job): a stored rule-4d
// path candidate surfaces at its FIRST segment; the moment a '/' precedes
// the cursor — threshold mode, trigger mode, quoted or bare — the stock
// gate delegates and hapax never answers, even though a match WOULD exist.
// That counterfactual is proven below with a direct rankMatches call, so
// these tests pin the GATE (classifyStockContext before extractMatchState
// in getSuggestions), never candidate absence. P1.M2's fuzzy rewrite must
// keep this suite green except where it deliberately re-derives the
// matcher-specific assertions.

describe("path-candidate interaction (rule 4d: first segment surfaces, then stock owns)", () => {
  /** Sentinel pi's stock completion returns in path contexts. */
  const STOCK_SENTINEL: AutocompleteSuggestions = {
    items: [{ value: "/resume", label: "/resume", description: "stock" }],
    prefix: "/re",
  };

  /** Store holding the rule-4d path candidate; display = key. */
  const pathStore = (): CandidateStore => {
    const s = new CandidateStore();
    put(s, "src/core/query.ts", 2, 4);
    return s;
  };

  it("'edit sr' with the candidate seeded → hapax answers with the whole path (integration item 7, CI half)", async () => {
    const current = makeCurrent({ getSuggestions: vi.fn(async () => STOCK_SENTINEL) });
    const { inner, provider } = makeStack(pathStore(), current);
    const lines = ["edit sr"];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 7, options);

    expect(current.getSuggestions).not.toHaveBeenCalled();
    expect(result?.items.map((i) => i.value)).toContain("src/core/query.ts");
    expect(result?.prefix).toBe("sr");
    expect(inner.__hapaxLive()).not.toBeNull(); // hapax owns this menu
  });

  it("'edit src/co' delegates even with the path candidate seeded (gate, not absence)", async () => {
    const current = makeCurrent({ getSuggestions: vi.fn(async () => STOCK_SENTINEL) });
    const { inner, provider } = makeStack(pathStore(), current);
    const lines = ["edit src/co"];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 11, options);

    expect(result).toBe(STOCK_SENTINEL);
    expectUntouchedArgs(current, lines, 0, 11, options);
    expect(inner.__hapaxLive()).toBeNull(); // no hapax menu ever painted
  });

  it("'#src/co' (trigger fragment with '/') delegates — although it WOULD prefix-match the seeded key (gate order pin)", async () => {
    const store = pathStore();
    // Counterfactual proof: the query layer is pure byte-lex prefix, so the
    // slash-bearing trigger fragment matches the seeded key. Delegation is
    // therefore the stock gate's doing — a reordering that ran
    // extractMatchState first would surface a hapax menu here and fail.
    expect(rankMatches(store, "src/co").map((m) => m.key)).toContain(
      "src/core/query.ts",
    );

    const current = makeCurrent({ getSuggestions: vi.fn(async () => STOCK_SENTINEL) });
    const { inner, provider } = makeStack(store, current);
    const lines = ["#src/co"];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 7, options);

    expect(result).toBe(STOCK_SENTINEL);
    expectUntouchedArgs(current, lines, 0, 7, options);
    expect(inner.__hapaxLive()).toBeNull();
  });

  it("'#sr/co' (trigger fragment with '/') delegates", async () => {
    const current = makeCurrent({ getSuggestions: vi.fn(async () => STOCK_SENTINEL) });
    const { inner, provider } = makeStack(pathStore(), current);
    const lines = ["#sr/co"];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 6, options);

    expect(result).toBe(STOCK_SENTINEL);
    expectUntouchedArgs(current, lines, 0, 6, options);
    expect(inner.__hapaxLive()).toBeNull();
  });

  it("'edit \"src/co' (quoted path) delegates with the candidate seeded", async () => {
    const current = makeCurrent({ getSuggestions: vi.fn(async () => STOCK_SENTINEL) });
    const { inner, provider } = makeStack(pathStore(), current);
    const lines = ['edit "src/co'];
    const options = opts();

    const result = await provider.getSuggestions(lines, 0, 12, options);

    expect(result).toBe(STOCK_SENTINEL);
    expectUntouchedArgs(current, lines, 0, 12, options);
    expect(inner.__hapaxLive()).toBeNull();
  });
});

describe("series-first offers + typed arming (spec 07 h2.53)", () => {
  /** Series fixture (spec 06 h3.6/h3.7): the→Fed series pair ×4 (run
   *  casing "Fed" — the h2.53 battery's headline), the→file ordinary ×2,
   *  dog→bone ordinary (an uppercase-typed word with NO series
   *  successors must never arm), and the CHAIN-ONLY member Zephyrion —
   *  never admitted as a word candidate, known only to the successor
   *  index — whose successor is the series Fed. */
  const seriesStore = (): CandidateStore => {
    const s = new CandidateStore();
    for (let i = 0; i < 4; i++) {
      s.recordBigramRuns([
        [
          { key: "the", rawCasing: "The", series: true },
          { key: "fed", rawCasing: "Fed", series: true },
        ],
      ]);
    }
    for (let i = 0; i < 2; i++) s.recordBigramRuns([["the", "file"]]);
    s.recordBigramRuns([["dog", "bone"]]);
    s.recordBigramRuns([
      [
        { key: "zephyrion", rawCasing: "Zephyrion", series: true },
        { key: "fed", rawCasing: "Fed", series: true },
      ],
    ]);
    put(s, "zendesk", 3, 9, { display: "Zendesk" }); // re-arm vehicle
    return s;
  };

  it("'The ' (space) arms by typing; the next word start offers Fed first (series-first, run casing)", async () => {
    const store = seriesStore();
    const chain = createChainMachine();
    const inner = createHapaxProvider(store, cfg(), makeCurrent(), chain);

    // The space query closes (null) AND arms — the h2.53 idle transition:
    // uppercase typed first letter + series successors on the lowercase
    // key. The offer itself comes from the NEXT word-start query.
    expect(await suggest(inner, ["The "], 0, 4)).toBeNull();
    expect(chain.state()).toEqual({ word: "the" }); // lowercase key arms

    const offer = await suggest(inner, ["The "], 0, 4);
    expect(offer?.prefix).toBe(""); // zero-char offer
    expect(offer?.items.map((i) => i.value)).toEqual([
      "Fed", // series first — nextDisplay RUN CASING, count 4
      "file", // ordinary, count 2
    ]);
    // Published order IS rank order (topSuccessors series-first; never
    // re-sorted): the lastLive seam mirrors the rendered items.
    expect(inner.__hapaxLive()!.matches.map((m) => m.display)).toEqual([
      "Fed",
      "file",
    ]);
  });

  it("lowercase 'the ' never arms — even with successors", async () => {
    const store = seriesStore();
    const chain = createChainMachine();
    const inner = createHapaxProvider(store, cfg(), makeCurrent(), chain);

    expect(await suggest(inner, ["the "], 0, 4)).toBeNull(); // space still closes
    expect(chain.state()).toBeNull(); // lowercase typing never arms
    // And the next word-start query stays chain-free (no offer to
    // displace the normal path).
    expect(await suggest(inner, ["the "], 0, 4)).toBeNull();
  });

  it("uppercase word with NO series successors never arms (dog→bone is ordinary)", async () => {
    const store = seriesStore();
    const chain = createChainMachine();
    const inner = createHapaxProvider(store, cfg(), makeCurrent(), chain);

    expect(await suggest(inner, ["Dog "], 0, 4)).toBeNull();
    expect(chain.state()).toBeNull();
  });

  it("chain-only member: a typed uppercase word present only in the successor index arms", async () => {
    const store = seriesStore();
    expect(store.get("zephyrion")).toBeUndefined(); // never a word candidate
    const chain = createChainMachine();
    const inner = createHapaxProvider(store, cfg(), makeCurrent(), chain);

    expect(await suggest(inner, ["Zephyrion "], 0, 10)).toBeNull();
    expect(chain.state()).toEqual({ word: "zephyrion" }); // direct topSuccessors consult
    const offer = await suggest(inner, ["Zephyrion "], 0, 10);
    expect(offer?.items.map((i) => i.value)).toEqual(["Fed"]); // its series successor
  });

  it("typed-through disarm + acceptance re-arm: the grant interplay is identical for typed arming", async () => {
    const store = seriesStore();
    const chain = createChainMachine();
    const inner = createHapaxProvider(store, cfg(), makeCurrent(), chain);

    await suggest(inner, ["The "], 0, 4); // arms; grant fresh
    // The granted zero-char offer paints…
    expect(
      (await suggest(inner, ["The "], 0, 4))?.items.map((i) => i.value),
    ).toEqual(["Fed", "file"]);

    // …typing INTO the offer narrows it (same word — no grant spend).
    const narrowed = await suggest(inner, ["The f"], 0, 5);
    expect(narrowed?.items.map((i) => i.value)).toEqual(["Fed", "file"]);
    expect(chain.state()).toEqual({ word: "the" });

    // Moving past the typed-through word (a space) spends the one-shot
    // grant: the chain DISARMS and the space closes (null) on the SAME
    // keystroke — the normal path answers from here.
    expect(await suggest(inner, ["The f "], 0, 6)).toBeNull();
    expect(chain.state()).toBeNull();

    // Acceptance re-arms (an arm is an arm): a live word item accepted
    // through applyCompletion arms with a fresh grant.
    const menu = await suggest(inner, ["Zen"], 0, 3);
    expect(menu?.items.map((i) => i.value)).toContain("Zendesk");
    inner.applyCompletion(
      ["Zen"],
      0,
      3,
      { value: "Zendesk", label: "Zendesk" },
      "Zen",
    );
    expect(chain.state()).toEqual({ word: "zendesk" });
  });

  it("enableChaining:false gates typed arming (the whole chain layer stays inert)", async () => {
    const store = seriesStore();
    const chain = createChainMachine();
    const inner = createHapaxProvider(
      store,
      cfg({ enableChaining: false }),
      makeCurrent(),
      chain,
    );

    expect(await suggest(inner, ["The "], 0, 4)).toBeNull(); // close-on-space unchanged
    expect(chain.state()).toBeNull(); // never arms under the flag
  });
});
