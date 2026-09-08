/**
 * Chain machine suite (P2.M2.T2.S1, PRD §07 h2.43) — the Tab-armed
 * successor-chaining state machine wired through the S2 provider:
 *
 *   inner = createHapaxProvider(store, config, current, chain)
 *
 * Covers every armed rule of h2.43: arming ONLY from hapax whole-word
 * items (never path completion, never phrases), successor-only menus at
 * chain threshold 1 (NOT config.threshold), live fragment filtering,
 * Tab accept → armed(next) with verbatim delegation, word-less /
 * zero-match disarm falling through to the normal path on the SAME
 * keystroke, reset-on-new-turn, and composition with the S3 display
 * debounce. The machine feeds the suggestion set ONLY: applyCompletion
 * always delegates verbatim — test/provider.test.ts pins that and must
 * stay green untouched.
 *
 * SEEDING ORDER NOTE (PRD §06 h3.8 + BUG-005 exemption): an ADMITTED
 * phrase (bigram count ≥ 2 — the repetition path) always ranks ABOVE its
 * first-word constituent (PHRASE_MULTIPLIER 1.2 makes phraseSalience ≥
 * the word's), and before the BUG-005 fix it REMOVED the bare word from
 * the menu entirely — making the chain un-armable in any session where
 * the bigrams already recurred. Since the exemption (rankMatches keeps
 * the bare first word whenever topSuccessors() is non-empty, PRD §07
 * h2.43: arming is whole-word Tab acceptance), the arming menu stays
 * visible even after the bigrams are recorded. The successor index
 * itself builds on EVERY phrase upsert regardless of admission
 * (store.ts #upsertPhrase's bigram successor tail). The before-query
 * seeding order below is therefore only a determinism convenience now:
 * kept because it costs nothing and keeps each arming menu a pure word
 * list. Machine-level cases run against the inner
 * provider (no debounce interference); display composition is test 12's
 * job, under the fake timers of provider-display.test.ts.
 */

import { describe, expect, it, vi, type Mock } from "vitest";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { CandidateStore } from "../src/core/store.js";
import type { Sighting } from "../src/core/types.js";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { HapaxConfig } from "../src/pi/config.js";
import {
  createChainMachine,
  createDisplayProvider,
  createHapaxProvider,
  extractMatchState,
} from "../src/pi/provider.js";

// ── fixtures (provider.test.ts style) ───────────────────────────────────────

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

/** Upsert `key` `times` times at `ordinal` (3 sightings = menu-eligible). */
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

/** Word candidates only — NO bigrams yet (see the seeding-order gotcha
 *  above). "theta"/"kappa" additionally carry an admitted count-2 phrase
 *  for the phrase-acceptance case. */
const seedStore = (): CandidateStore => {
  const s = new CandidateStore();
  for (let r = 0; r < 2; r++) s.recordPhraseLines([["theta", "kappa"]], 4);
  put(s, "alpha", 3);
  put(s, "beta", 3);
  put(s, "bravo", 3);
  put(s, "gamma", 3);
  put(s, "theta", 3);
  return s;
};

/** Bigram seeding for alpha→beta(3), alpha→bravo(2) — the PRP §07
 *  success-definition index shape. Call ONLY after the arming menu for
 *  "alpha" has been captured. */
const seedAlphaSuccessors = (s: CandidateStore): void => {
  for (let r = 0; r < 3; r++) s.recordPhraseLines([["alpha", "beta"]], 1);
  for (let r = 0; r < 2; r++) s.recordPhraseLines([["alpha", "bravo"]], 2);
};

/** Fresh provider stack with the chain machine exposed. Machine tests use
 *  `inner` (no display debounce); test 12 uses the full `provider`. */
function makeStack(store: CandidateStore, current: AutocompleteProvider) {
  const chain = createChainMachine();
  const inner = createHapaxProvider(store, cfg(), current, chain);
  const provider = createDisplayProvider(inner);
  return { chain, inner, provider };
}

/** One getSuggestions call, fresh options each time. */
const suggest = (
  p: AutocompleteProvider,
  lines: string[],
  line: number,
  col: number,
): Promise<AutocompleteSuggestions | null> => p.getSuggestions(lines, line, col, opts());

const item = (value: string): AutocompleteItem => ({ value, label: value });

/**
 * Arm via the ONLY production path: a live menu + Tab acceptance. Seeds
 * `seed` AFTER the menu query (see the header note) — no longer required
 * for arming visibility (the BUG-005 exemption keeps successor-bearing
 * words in the menu), kept as a cheap determinism convenience.
 */
async function armViaTab(
  inner: ReturnType<typeof createHapaxProvider>,
  chain: ReturnType<typeof createChainMachine>,
  store: CandidateStore,
  word: string,
  fragment: string,
  seed: (s: CandidateStore) => void = seedAlphaSuccessors,
): Promise<void> {
  put(store, word, 3); // ensure the word itself is menu-eligible
  const menu = await suggest(inner, [fragment], 0, fragment.length);
  seed(store); // successors land AFTER the menu snapshot
  expect(menu?.items.map((i) => i.value)).toContain(word); // live menu is up
  inner.applyCompletion([fragment], 0, fragment.length, item(word), fragment);
  expect(chain.state()).toEqual({ word }); // precondition: armed
}

// ── cases ───────────────────────────────────────────────────────────────────

describe("chain machine (P2.M2.T2.S1, PRD §07 h2.43)", () => {
  it("starts idle: state() is null and the first query takes the normal path", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);

    expect(chain.state()).toBeNull();

    // Threshold 2 (normal): "al" → plain word menu, not a chain menu.
    const menu = await suggest(inner, ["al"], 0, 2);
    expect(menu?.items.map((i) => i.value)).toEqual(["alpha"]);
    expect(chain.state()).toBeNull(); // suggestions alone never arm
  });

  it("(1) Tab-accept of a live hapax word item arms the chain", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);

    await armViaTab(inner, chain, store, "alpha", "al");
    expect(inner.__hapaxKey("alpha")).toBe("alpha"); // plain key, no space
  });

  it("(2) accepting an item absent from the live map (path completion) never arms", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);

    // No live menu at all — e.g. pi's path completion on an empty line.
    inner.applyCompletion([""], 0, 0, item("/path/"), "");
    expect(chain.state()).toBeNull();

    // Even with a hapax menu open, a value outside liveKeyByValue
    // (path completion raced in) must never arm.
    await suggest(inner, ["al"], 0, 2);
    inner.applyCompletion(["al"], 0, 2, item("/path/"), "al");
    expect(chain.state()).toBeNull();
  });

  it("(3) accepting a phrase item (space-joined key) never arms", async () => {
    const current = makeCurrent();
    const store = seedStore(); // "theta kappa" admitted (count 2)
    const { chain, inner } = makeStack(store, current);

    // The admitted phrase ranks ABOVE its first-word constituent, and
    // the BUG-005 exemption keeps the bare word co-presented below it
    // (theta carries a successor tail). The PHRASE item itself is what
    // this case accepts — a space-joined key must never arm (h2.43).
    const menu = await suggest(inner, ["thet"], 0, 4);
    expect(menu?.items.map((i) => i.value)).toEqual(["theta kappa", "theta"]);
    expect(inner.__hapaxKey("theta kappa")).toBe("theta kappa"); // space

    inner.applyCompletion(["thet"], 0, 4, item("theta kappa"), "thet");
    expect(chain.state()).toBeNull(); // phrase → no chain
  });

  it("(4) armed + 1-char fragment → successor-only menu at threshold 1, count-desc order", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al");

    // Precondition: 1-char fragment is BELOW config.threshold — the
    // normal path would delegate; only the chain can answer it.
    expect(extractMatchState(["alpha b"], 0, 8, cfg())).toBeNull();

    const menu = await suggest(inner, ["alpha b"], 0, 8);
    expect(menu).toEqual({
      items: [
        { value: "beta", label: "beta", description: "chain" },
        { value: "bravo", label: "bravo", description: "chain" },
      ],
      prefix: "b",
    }); // beta(3) before bravo(2) — the index's count-desc order
    expect(inner.__hapaxLive()?.prefix).toBe("b"); // armed set is live
  });

  it("(5) further typing filters the successor set live", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al");

    const wide = await suggest(inner, ["alpha b"], 0, 8);
    expect(wide?.items.map((i) => i.value)).toEqual(["beta", "bravo"]);

    const narrow = await suggest(inner, ["alpha br"], 0, 9);
    expect(narrow?.items.map((i) => i.value)).toEqual(["bravo"]);
    expect(chain.state()).toEqual({ word: "alpha" }); // filtering never disarms
  });

  it("(6) zero matching successors → disarm + normal candidates on the SAME call", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al");

    // No successor of alpha starts with "gam", but word candidate
    // "gamma" does — the same keystroke must show the normal menu.
    const menu = await suggest(inner, ["alpha gam"], 0, 9);
    expect(menu?.items.map((i) => i.value)).toEqual(["gamma"]);
    expect(menu?.prefix).toBe("gam"); // normal path's prefix (threshold 2 ok)
    expect(chain.state()).toBeNull(); // disarmed
    expect(inner.__hapaxLive()?.prefix).toBe("gam"); // normal live set republished
  });

  it("(7) armed word with an empty successor index → disarm + normal path", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "gamma", "ga", () => {}); // no bigrams

    const menu = await suggest(inner, ["gamma gam"], 0, 9);
    expect(menu?.items.map((i) => i.value)).toEqual(["gamma"]);
    expect(chain.state()).toBeNull();
  });

  it("(8) word-less state (trailing space, then punctuation) → disarm + delegate", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al");

    // Trailing space: nothing the fragment regex matches → disarm, and
    // the request DELEGATES (extractMatchState null → pi stays in charge).
    const options = opts();
    const lines = ["alpha "];
    const result = await inner.getSuggestions(lines, 0, 6, options);
    expect(result).toBeNull(); // current's null passed through
    expect(current.getSuggestions).toHaveBeenCalledOnce();
    const call = current.getSuggestions.mock.calls[0];
    expect(call[0]).toBe(lines); // verbatim array identity
    expect(call[3]).toBe(options);
    expect(chain.state()).toBeNull();

    // Punctuation: "!" ends the line — no trailing identifier → same
    // disarm + delegate. Fresh stack armed on "beta" (alpha's admitted
    // bigrams would shadow its own arming menu — seeding-order gotcha;
    // no phrase's first word prefixes "be", so beta's menu is clean).
    const fresh = makeStack(store, current);
    await armViaTab(fresh.inner, fresh.chain, store, "beta", "be", () => {});
    expect(await suggest(fresh.inner, ["beta!"], 0, 5)).toBeNull();
    expect(current.getSuggestions).toHaveBeenCalledTimes(2);
    expect(fresh.chain.state()).toBeNull();
  });

  it("(9) Tab-accept of a successor re-arms to it and delegates verbatim", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al");
    current.applyCompletion.mockClear(); // the arming accept already delegated

    const menu = await suggest(inner, ["alpha b"], 0, 8);
    expect(menu?.items.map((i) => i.value)).toEqual(["beta", "bravo"]);

    const lines = ["alpha b"];
    const accepted = item("beta");
    const ret = inner.applyCompletion(lines, 0, 8, accepted, "b");

    // Verbatim delegation (case (b) discipline): same objects/numbers in,
    // current's return passed through untouched.
    expect(current.applyCompletion).toHaveBeenCalledOnce();
    const forwarded = current.applyCompletion.mock.calls[0];
    expect(forwarded[0]).toBe(lines);
    expect(forwarded[1]).toBe(0);
    expect(forwarded[2]).toBe(8);
    expect(forwarded[3]).toBe(accepted);
    expect(forwarded[4]).toBe("b");
    expect(ret).toBe(current.applyCompletion.mock.results[0].value);

    // armed(next): beta's own successors now feed the menu. beta's
    // bigrams were never live-menu-relevant, so seed them directly.
    for (let r = 0; r < 2; r++) store.recordPhraseLines([["beta", "eyes"]], 3);
    expect(chain.state()).toEqual({ word: "beta" });
    const chained = await suggest(inner, ["beta e"], 0, 6);
    expect(chained?.items.map((i) => i.value)).toEqual(["eyes"]);
    expect(chained?.prefix).toBe("e");
  });

  it("(10) reset() forces idle — the before_agent_start rule; normal threshold resumes", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al");

    chain.reset(); // what the before_agent_start handler calls
    expect(chain.state()).toBeNull();

    // Sub-threshold fragment delegates again — no chain menu.
    expect(extractMatchState(["alpha b"], 0, 8, cfg())).toBeNull();
    expect(await suggest(inner, ["alpha b"], 0, 8)).toBeNull();
    // Normal threshold matching is back on this keystroke.
    const menu = await suggest(inner, ["ga"], 0, 2);
    expect(menu?.items.map((i) => i.value)).toEqual(["gamma"]);
  });

  it("(11) trigger-mode acceptance arms too (whole-word insertion)", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);

    // "#al" is trigger mode; the menu is the same word candidate.
    await armViaTab(inner, chain, store, "alpha", "#al");

    // The chain continues with plain threshold-mode successors.
    const chained = await suggest(inner, ["alpha b"], 0, 8);
    expect(chained?.items.map((i) => i.value)).toEqual(["beta", "bravo"]);
  });

  it("(12) armed sets flow through the display layer's classification + 100ms debounce", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0); // t=0; vitest 4 fakes Date.now too
    try {
      const current = makeCurrent();
      const store = seedStore();
      const { chain, inner, provider } = makeStack(store, current);

      await armViaTab(inner, chain, store, "alpha", "al");

      // First armed query → immediate paint (first paint is never delayed).
      const first = await suggest(provider, ["alpha b"], 0, 8);
      expect(first?.items.map((i) => i.value)).toEqual(["beta", "bravo"]);
      expect(first?.prefix).toBe("b");

      // t=50: typing moved the anchor ("b" → "be"), so the display layer
      // paints the narrowed armed set IMMEDIATELY (BUG-002 anchor safety:
      // re-serving the old set would hand pi the stale "b" prefix, and
      // Tab's blind prefix.length splice would corrupt the line).
      vi.advanceTimersByTime(50);
      const painted = await suggest(provider, ["alpha be"], 0, 9);
      expect(painted?.items.map((i) => i.value)).toEqual(["beta"]);
      expect(painted?.prefix).toBe("be");

      // Identical re-query: same set + same prefix → idempotent repaint.
      vi.advanceTimersByTime(60);
      const repainted = await suggest(provider, ["alpha be"], 0, 9);
      expect(repainted?.items.map((i) => i.value)).toEqual(["beta"]);
      expect(repainted?.prefix).toBe("be");
    } finally {
      vi.useRealTimers();
    }
  });
});