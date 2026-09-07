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
import { admit, REJECT_COMMON_THRESHOLD } from "../src/core/score.js";
import { CandidateStore } from "../src/core/store.js";
import type { Dictionary, Sighting } from "../src/core/types.js";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { HapaxConfig } from "../src/pi/config.js";
import {
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
  rankGroup: 2,
  isSubword: false,
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

    it("prose 'hello ' after a space (threshold 2) → match state null → delegates, even a null result passes through", async () => {
      const current = makeCurrent(); // getSuggestions → null
      const { provider } = makeStack(new CandidateStore(), current);
      const lines = ["hello "];
      const options = opts();

      expect(extractMatchState(lines, 0, 6, cfg())).toBeNull();
      const result = await provider.getSuggestions(lines, 0, 6, options);

      expectUntouchedArgs(current, lines, 0, 6, options);
      expect(result).toBeNull(); // current's null returned unchanged
    });

    it("quoted path 'read \"src/co' → delegated so pi's path completion keeps working", async () => {
      // Threshold state EXISTS ("co", length 2) but the store has no "co…"
      // candidates → the zero-candidate delegate path. Either way pi's
      // quoted-path completion receives the request untouched.
      const store = new CandidateStore();
      put(store, "nrel", 2, 3, { display: "NREL", properName: true });
      put(store, "zendesk", 3, 9, { display: "Zendesk" });
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
      put(store, "zendesk", 3, 9, { display: "Zendesk" });
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
      put(store, "nrel", 2, 3, { display: "NREL", properName: true });
      put(store, "zendesk", 3, 9, { display: "Zendesk" });
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
        isSubword: false,
      });

      expect(admit(draft("the"), commonAt(REJECT_COMMON_THRESHOLD))).toBe("reject");
      expect(admit(draft("context"), commonAt(REJECT_COMMON_THRESHOLD + 35))).toBe("reject");
      // The boundary is q ≥ REJECT_COMMON_THRESHOLD exactly: just below it
      // the word is admitted.
      expect(admit(draft("the"), commonAt(REJECT_COMMON_THRESHOLD - 1))).not.toBe("reject");
    });

    it("end-to-end: store without common words + lines ending 'the'/'contex' → delegation, zero hapax items", async () => {
      const store = new CandidateStore();
      put(store, "nrel", 2, 3, { display: "NREL", properName: true });
      put(store, "zendesk", 3, 9, { display: "Zendesk" }); // store is NOT empty
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
    it("typed 'nrel' matches stored NREL — item.value === 'NREL', prefix === 'nrel', no delegation", async () => {
      const store = new CandidateStore();
      put(store, "nrel", 2, 3, { display: "NREL", properName: true });
      const current = makeCurrent();
      const { inner, provider } = makeStack(store, current);

      const result = await suggest(provider, ["nrel"], 0, 4);

      expect(current.getSuggestions).not.toHaveBeenCalled(); // hapax answered
      expect(inner.__hapaxLive()?.prefix).toBe("nrel"); // live menu, not delegate
      expect(result?.prefix).toBe("nrel");
      const nrel = result?.items.filter((i) => i.value === "NREL") ?? [];
      expect(nrel).toHaveLength(1); // prefix matched case-insensitively…
      expect(nrel[0].label).toBe("NREL"); // …insertion uses display casing
    });
  });
});