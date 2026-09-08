/**
 * Chain machine suite (PRD §07 h2.43, plan 002 P1.M2.T1.S1 redesign) —
 * the Tab-armed successor-chaining state machine wired through the hapax
 * provider:
 *
 *   inner = createHapaxProvider(store, config, current, chain)
 *
 * Every armed rule of h2.43, as redesigned (bare values, threshold 0):
 *   - arming ONLY from hapax's own live items — whole words and chain
 *     successors; never path completion or out-of-map values
 *   - the ZERO-TYPED-CHAR word-start offer at EVERY armed word start
 *     (line start or right after a space/tab): the armed word's
 *     unfiltered top successors with BARE single-word values, prefix
 *     "", description "chain" — pi-tui splices a bare value VERBATIM at
 *     prefix "" (external_deps.md §2a), so the user's separating space
 *     stays the single separator; no leading-space value exists
 *   - live fragment filtering at CHAIN THRESHOLD 0 for the whole chain
 *     duration (config.threshold is never consulted on this path)
 *   - disqualification — punctuation, word-less non-start input, zero
 *     matching successors, empty successor index — disarms and the
 *     normal path (or pi's stock delegate) answers on the SAME keystroke
 *   - Tab accept of a successor → armed(next), verbatim applyCompletion
 *     delegation, exactly ONE word inserted (PRD §06 h2.38 one-word
 *     invariant; §07 h2.44)
 *   - reset on before_agent_start (h2.43; h2.54's M2 DoD audit builds on
 *     these cases) and composition with the S3 display debounce (PRD §07
 *     rules 2–4)
 *
 * Machine-level cases run against the inner provider (no display
 * debounce interference); display composition is case 14, under fake
 * timers. Verbatim delegation of applyCompletion is pinned by
 * test/provider.test.ts, which stays untouched; case 11 re-asserts the
 * pass-through from this suite's side. The config gate is
 * enableChaining — every gate read was re-pointed and the transitional
 * mirror field removed by P1.M3.T1.S2.
 *
 * SEEDING (PRD §06 h3.9): bigrams enter ONLY through
 * store.recordBigramRuns — the sole bigram seam (real ingest in the
 * replay cases below). Successor bumps are admission-independent, and
 * seeding order relative to the arming-menu query is only a determinism
 * convenience: whole-word Tab acceptance arms regardless of menu
 * membership, so each arming menu stays a pure word list.
 */

import { describe, expect, it, vi, type Mock } from "vitest";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { loadDictionary } from "../src/core/dictionary.js";
import { CandidateStore } from "../src/core/store.js";
import type { Sighting } from "../src/core/types.js";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { HapaxConfig } from "../src/pi/config.js";
import {
  extractText,
  IngestPipeline,
  restoreFromHistory,
  type AgentMessage,
  type RestoreSessionManager,
} from "../src/pi/ingest.js";
import { resolveDictPath } from "../src/pi/paths.js";
import {
  createChainMachine,
  createDisplayProvider,
  createHapaxProvider,
  extractMatchState,
} from "../src/pi/provider.js";
import {
  asSessionManager,
  parseSessionFixture,
} from "./helpers/session-fixture.js";

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

/** Word candidates only. Bigrams (theta→kappa ×2) enter exclusively
 *  through store.recordBigramRuns — the only bigram seam — so the
 *  successor index has a non-degenerate occupant independent of the
 *  per-case alpha/beta seeds. */
const seedStore = (): CandidateStore => {
  const s = new CandidateStore();
  for (let r = 0; r < 2; r++) s.recordBigramRuns([["theta", "kappa"]]);
  put(s, "alpha", 3);
  put(s, "beta", 3);
  put(s, "bravo", 3);
  put(s, "gamma", 3);
  put(s, "theta", 3);
  return s;
};

/** Bigram seeding for alpha→beta(3), alpha→bravo(2) — count-desc menu
 *  order. Exclusive seam: store.recordBigramRuns. Call ONLY after the
 *  arming menu for "alpha" has been captured (determinism convenience). */
const seedAlphaSuccessors = (s: CandidateStore): void => {
  for (let r = 0; r < 3; r++) s.recordBigramRuns([["alpha", "beta"]]);
  for (let r = 0; r < 2; r++) s.recordBigramRuns([["alpha", "bravo"]]);
};

/** Fresh provider stack with the chain machine exposed. Machine tests use
 *  `inner` (no display debounce); case 14 uses the full `provider`. */
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
 * One-word invariant on pi's menu shape (AutocompleteItem): h2.38/h2.44
 * forbid multi-word (and leading-space) values everywhere. (helpers/
 * query-invariants.ts's assertWordsOnly covers RankedMatch outputs; chain
 * menus are pi items, so the assertion is direct here.)
 */
const expectSingleWordItems = (items: readonly AutocompleteItem[]): void => {
  for (const i of items) expect(i.value).not.toContain(" ");
};

/**
 * Arm via the ONLY production path: a live menu + Tab acceptance. Seeds
 * `seed` AFTER the menu query (see the header note) — arming visibility
 * no longer depends on it (whole-word acceptance arms regardless), kept
 * as a cheap determinism convenience.
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

// ── cases (PRD §07 h2.43, plan 002 P1.M2.T1.S1 redesign) ────────────────────

describe("chain machine — armed successor chaining (PRD §07 h2.43, plan 002 S1 redesign)", () => {
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

  it("Tab-accept of a live hapax word item arms the chain (h2.43 whole-word arming)", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);

    await armViaTab(inner, chain, store, "alpha", "al");
    expect(chain.state()).toEqual({ word: "alpha" });
    expect(inner.__hapaxKey("alpha")).toBe("alpha"); // plain key, no space
  });

  it("accepting an item absent from the live map (path completion) never arms", async () => {
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

  it("zero-char word-start offer after the separator: bare values, prefix \"\", count-desc, still armed (h2.43)", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al");

    // The user typed the separating space: the cursor sits at the empty
    // NEXT word with zero typed chars — the redesign's word-start offer
    // serves alpha's UNFILTERED successors with BARE values at prefix
    // "" (external_deps.md §2a: pi-tui splices the value verbatim there,
    // so a leading-space value would double-space — bare is the shape).
    const res = await suggest(inner, ["alpha "], 0, 6);
    expect(res).toEqual({
      items: [
        { value: "beta", label: "beta", description: "chain" },
        { value: "bravo", label: "bravo", description: "chain" },
      ],
      prefix: "",
    }); // beta(3) before bravo(2) — the index's count-desc order
    expect(chain.state()).toEqual({ word: "alpha" }); // offer ≠ disarm
    expect(inner.__hapaxLive()?.prefix).toBe(""); // lastLive == returned prefix
    expect(current.getSuggestions).not.toHaveBeenCalled(); // pi never consulted
    expectSingleWordItems(res?.items ?? []);

    // Line-start variant: cursor on an EMPTY second line, col 0 —
    // before === "" is a zero-typed-char word start too; same offer.
    const lineStart = await suggest(inner, ["alpha", ""], 1, 0);
    expect(lineStart).toEqual(res);
    expect(chain.state()).toEqual({ word: "alpha" });
  });

  it("zero-char offer fires at EVERY armed word start, not just the first post-arm query (h2.43)", async () => {
    const store = seedStore();
    // The faithful editor IS the wrapped provider, so accepts mutate the
    // one persistent buffer exactly like the real editor flow would.
    const ed = editingCurrent(["al"], 2);
    const { chain, inner } = makeStack(store, ed);
    await armViaTab(inner, chain, store, "alpha", "al");
    expect(ed.state.lines).toEqual(["alpha"]); // the arming accept landed

    // FIRST word start: the user's separating space → alpha's unfiltered
    // offer at zero typed chars.
    ed.typeSpace();
    const first = await suggest(inner, ed.state.lines, 0, ed.state.cursorCol);
    expect(first?.prefix).toBe("");
    expect(first?.items.map((i) => i.value)).toEqual(["beta", "bravo"]);

    // Accept beta from the offer → armed(beta); exactly ONE word lands.
    inner.applyCompletion(ed.state.lines, 0, ed.state.cursorCol, item("beta"), "");
    expect(chain.state()).toEqual({ word: "beta" });
    expect(ed.state.lines).toEqual(["alpha beta"]);

    // SECOND word start: after the user's next separating space, beta's
    // own successors are offered with zero typed chars — the offer is
    // not a one-shot post-arm event; every armed word start gets it.
    for (let r = 0; r < 2; r++) store.recordBigramRuns([["beta", "eyes"]]);
    ed.typeSpace();
    expect(ed.state.lines).toEqual(["alpha beta "]);
    const second = await suggest(inner, ed.state.lines, 0, ed.state.cursorCol);
    expect(second?.prefix).toBe("");
    expect(second?.items.map((i) => i.value)).toEqual(["eyes"]);
    expect(chain.state()).toEqual({ word: "beta" }); // still armed
  });

  it("1-char fragment offers at chain threshold 0; past-match fragment disarms + delegates on the SAME call (h2.43)", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al");

    // Threshold 0 for the whole chain duration: ONE typed char already
    // filters the successor set. Precondition — config.threshold is 2,
    // so extractMatchState would delegate here; only the chain answers.
    expect(extractMatchState(["alpha b"], 0, 8, cfg())).toBeNull();
    const menu = await suggest(inner, ["alpha b"], 0, 8);
    expect(menu).toEqual({
      items: [
        { value: "beta", label: "beta", description: "chain" },
        { value: "bravo", label: "bravo", description: "chain" },
      ],
      prefix: "b",
    });
    expect(inner.__hapaxLive()?.prefix).toBe("b"); // armed set is live
    expect(chain.state()).toEqual({ word: "alpha" });

    // Typing past every successor ("z" matches none) disarms on the
    // SAME keystroke and the normal path answers — which at threshold 2
    // has no match state for "z" → pi's stock delegate (null from the
    // mock), with the original arguments forwarded untouched.
    const options = opts();
    const lines = ["alpha z"];
    expect(await inner.getSuggestions(lines, 0, 7, options)).toBeNull();
    expect(current.getSuggestions).toHaveBeenCalledOnce();
    const call = current.getSuggestions.mock.calls[0]!;
    expect(call[0]).toBe(lines); // verbatim array identity
    expect(call[3]).toBe(options); // verbatim options identity
    expect(chain.state()).toBeNull(); // disarmed THIS call
  });

  it("further typing filters the successor set live (threshold 0, never disarms while matching)", async () => {
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

  it("zero matching successors → disarm + normal candidates on the SAME call (h2.43 disqualification)", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al");

    // No successor of alpha starts with "gam", but word candidate
    // "gamma" does — the same keystroke must show the normal menu
    // (never an empty hapax set).
    const menu = await suggest(inner, ["alpha gam"], 0, 9);
    expect(menu?.items.map((i) => i.value)).toEqual(["gamma"]);
    expect(menu?.prefix).toBe("gam"); // normal path's prefix (threshold 2 ok)
    expect(chain.state()).toBeNull(); // disarmed
    expect(inner.__hapaxLive()?.prefix).toBe("gam"); // normal live set republished
  });

  it("armed word with an empty successor index → disarm + normal path (h2.43)", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "gamma", "ga", () => {}); // no bigrams

    const menu = await suggest(inner, ["gamma gam"], 0, 9);
    expect(menu?.items.map((i) => i.value)).toEqual(["gamma"]);
    expect(chain.state()).toBeNull();
  });

  it("word-less non-start buffer (punctuation) → disarm + delegate with byte-identical args/options (h2.43; the old trailing-space disarm is superseded by case 4's offer)", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);

    // Fresh stack armed on "beta" (alpha's admitted bigrams would shadow
    // its own arming menu — seeding-order gotcha; no stored word's key
    // prefixes "be", so beta's menu is clean).
    await armViaTab(inner, chain, store, "beta", "be", () => {});

    // "!" ends the line — no word start, no trailing identifier →
    // disarm + delegate on the same call, arguments/options identity
    // preserved (acceptance-critical: never hijack, never clone).
    const options = opts();
    const pLines = ["beta!"];
    expect(await inner.getSuggestions(pLines, 0, 5, options)).toBeNull();
    const call = current.getSuggestions.mock.calls[0]!;
    expect(call[0]).toBe(pLines); // verbatim array identity
    expect(call[3]).toBe(options); // verbatim options identity
    expect(chain.state()).toBeNull();
  });

  it("Tab-accept of a successor: re-arms, delegates verbatim, and inserts exactly ONE word (h2.43 × h2.38)", async () => {
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

    // Verbatim delegation: same objects/numbers in, current's return
    // passed through untouched (provider.test.ts pins this too).
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
    for (let r = 0; r < 2; r++) store.recordBigramRuns([["beta", "eyes"]]);
    expect(chain.state()).toEqual({ word: "beta" });
    const chained = await suggest(inner, ["beta e"], 0, 6);
    expect(chained?.items.map((i) => i.value)).toEqual(["eyes"]);
    expect(chained?.prefix).toBe("e");

    // ONE-word insertion through a faithful buffer (pi-tui splice math):
    // arm on the editor, let the user type the separator, accept the
    // word-start offer — the user's space stays the SINGLE separator
    // (bare value spliced verbatim at prefix ""), cursor after "beta".
    const ed = editingCurrent(["al"], 2);
    const edChain = createChainMachine();
    const edInner = createHapaxProvider(store, cfg(), ed, edChain);
    const armMenu = await suggest(edInner, ed.state.lines, 0, ed.state.cursorCol);
    expect(armMenu?.items.map((i) => i.value)).toContain("alpha");
    edInner.applyCompletion(ed.state.lines, 0, ed.state.cursorCol, item("alpha"), "al");
    expect(edChain.state()).toEqual({ word: "alpha" });
    expect(ed.state.lines).toEqual(["alpha"]);

    ed.typeSpace(); // the separating space — a boundary, not a word char
    const edOffer = await suggest(edInner, ed.state.lines, 0, ed.state.cursorCol);
    expect(edOffer?.prefix).toBe("");
    expectSingleWordItems(edOffer?.items ?? []);
    edInner.applyCompletion(
      ed.state.lines,
      0,
      ed.state.cursorCol,
      edOffer!.items[0]!,
      edOffer!.prefix,
    );
    expect(ed.state.lines).toEqual(["alpha beta"]); // single space, one word
    expect(ed.state.cursorCol).toBe("alpha beta".length); // cursor after "beta"
    expect(edChain.state()).toEqual({ word: "beta" });
  });

  it("reset() forces idle — the before_agent_start rule; normal config.threshold resumes (h2.43)", async () => {
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

  it("trigger-mode acceptance arms too (whole-word insertion) (h2.43)", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);

    // "#al" is trigger mode; the menu is the same word candidate.
    await armViaTab(inner, chain, store, "alpha", "#al");

    // The chain continues with plain threshold-mode successors.
    const chained = await suggest(inner, ["alpha b"], 0, 8);
    expect(chained?.items.map((i) => i.value)).toEqual(["beta", "bravo"]);
  });

  it("armed word-start offer flows through display classification + 100ms debounce at prefix \"\" (h2.43 × S3 rules 2–4)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0); // t=0; vitest 4 fakes Date.now too
    try {
      const current = makeCurrent();
      const store = seedStore();
      const { chain, inner, provider } = makeStack(store, current);

      await armViaTab(inner, chain, store, "alpha", "al");

      // First armed word-start query → immediate paint (first paint is
      // never delayed) with prefix "" on BOTH sides — the classifier
      // (result.prefix === live.prefix) must accept the zero-char offer
      // as hapax (S1 keeps the lastLive shape; this pins it).
      const first = await suggest(provider, ["alpha "], 0, 6);
      expect(first?.items.map((i) => i.value)).toEqual(["beta", "bravo"]);
      expect(first?.prefix).toBe("");

      // t=50, inside the suppression window: an IDENTICAL re-query (same
      // set + same prefix "") repaints idempotently — classification and
      // the debounce window compose unchanged at prefix "".
      vi.advanceTimersByTime(50);
      const repainted = await suggest(provider, ["alpha "], 0, 6);
      expect(repainted?.items.map((i) => i.value)).toEqual(["beta", "bravo"]);
      expect(repainted?.prefix).toBe("");

      // t=110: typing moved the anchor ("" → "be"), so the narrowed
      // armed set paints IMMEDIATELY (BUG-002 anchor safety: re-serving
      // the prefix-"" set would hand pi the stale anchor and Tab's blind
      // splice would corrupt the line).
      vi.advanceTimersByTime(60);
      const painted = await suggest(provider, ["alpha be"], 0, 9);
      expect(painted?.items.map((i) => i.value)).toEqual(["beta"]);
      expect(painted?.prefix).toBe("be");
    } finally {
      vi.useRealTimers();
    }
  });

  it("one-word invariant: every chain item value is a single word, never leading/multi-word (h2.38/h2.44)", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al");

    // The zero-char word-start offer (case 4):
    const offer = await suggest(inner, ["alpha "], 0, 6);
    expectSingleWordItems(offer?.items ?? []);

    // The live fragment sets (case 11):
    const frag = await suggest(inner, ["alpha b"], 0, 8);
    expectSingleWordItems(frag?.items ?? []);

    // The re-armed word-start offer and its fragments:
    inner.applyCompletion(["alpha "], 0, 6, item("beta"), ""); // armed(beta)
    for (let r = 0; r < 2; r++) store.recordBigramRuns([["beta", "eyes"]]);
    const chainedOffer = await suggest(inner, ["alpha beta "], 0, 11);
    expectSingleWordItems(chainedOffer?.items ?? []);
    const chainedFrag = await suggest(inner, ["alpha beta e"], 0, 12);
    expectSingleWordItems(chainedFrag?.items ?? []);

    // Explicitly: no leading or trailing space anywhere — a space is
    // always the USER's separator, never part of a value.
    for (const i of [
      ...(offer?.items ?? []),
      ...(frag?.items ?? []),
      ...(chainedOffer?.items ?? []),
      ...(chainedFrag?.items ?? []),
    ]) {
      expect(i.value.startsWith(" ")).toBe(false);
      expect(i.value.endsWith(" ")).toBe(false);
    }
  });
});

// ── NREL replay harness (real ingest; the PRD §09 item-7 route) ────────
// Mirrors acceptance.test.ts's item-7 helpers (makeNrelPipeline /
// replayNrel / editingCurrent): the REAL ingest pipeline with the bigram
// hook wired exactly like src/pi/index.ts, the SHIPPED dictionary, and a
// pi-shaped editing current provider so ONE buffer flows through accepts
// like the editor would. Local copies on purpose — small test-plumbing
// duplication across suites matches the repo's fixture-generator
// discipline (cf. test/helpers/dict-writer.ts vs tools/build-dict.mjs).

const FIXTURES = "test/fixtures/sessions";

/** Pipeline wired like src/pi/index.ts's session_start: the bigram hook
 *  is recordBigramRuns — the ONLY bigram path (phrase upserts are gone
 *  since P1.M1.T2). The enableChaining flag gates the whole chain layer
 *  (P1.M3.T1.S2). */
function makeNrelPipeline(enableChaining: boolean): { store: CandidateStore; pipeline: IngestPipeline } {
  const store = new CandidateStore();
  const pipeline = new IngestPipeline({
    store,
    dictionary: loadDictionary(resolveDictPath()),
    ...(enableChaining
      ? {
          onAdmittedTokens: (lines: string[][]) =>
            store.recordBigramRuns(lines),
        }
      : {}),
  });
  return { store, pipeline };
}

/** Replay pre-parsed fixture entries through restoreFromHistory on the
 *  GIVEN pipeline (same completion-tracking wrapper as acceptance). */
async function replayNrel(
  pipeline: IngestPipeline,
  entries: ReturnType<typeof parseSessionFixture>,
): Promise<void> {
  const total = entries.filter(
    (e) => e.message !== undefined && extractText(e.message as unknown as AgentMessage) !== null,
  ).length;
  const real = pipeline.processText.bind(pipeline);
  let done = 0;
  let resolve!: () => void;
  const finished = new Promise<void>((r) => {
    resolve = r;
  });
  restoreFromHistory(
    {
      processText: async (text, fromUser) => {
        await real(text, fromUser);
        if (++done === total) resolve();
      },
    },
    asSessionManager(entries) as unknown as RestoreSessionManager,
  );
  await finished;
}

/** Editing-harness mock (item-7 pattern): pi-shaped current provider
 *  whose applyCompletion performs pi-tui's insertion (replace `prefix`
 *  before the cursor with item.value) on ONE persistent buffer.
 *  `typeSpace()` simulates the user typing the separating space — a word
 *  BOUNDARY, never a word char — without touching the machine, landing
 *  the cursor at the zero-typed-char word start the offer fires at.
 *  `initial`/`cursorCol` default to the item-7 shape ("natio", col 5). */
function editingCurrent(initial: string[] = ["natio"], cursorCol = 5) {
  const state = { lines: initial, cursorLine: 0, cursorCol };
  return {
    state,
    typeSpace(): void {
      const line = state.lines[state.cursorLine] ?? "";
      const lines = [...state.lines];
      lines[state.cursorLine] =
        line.slice(0, state.cursorCol) + " " + line.slice(state.cursorCol);
      state.lines = lines;
      state.cursorCol += 1;
    },
    getSuggestions: vi.fn(
      async (lines: string[], cursorLine: number, cursorCol: number, options: { signal: AbortSignal }) => null,
    ),
    applyCompletion: vi.fn(
      (lines: string[], cursorLine: number, cursorCol: number, accepted: AutocompleteItem, prefix: string) => {
        const line = lines[cursorLine] ?? "";
        const before = line.slice(0, cursorCol - prefix.length);
        const after = line.slice(cursorCol);
        const newLines = [...lines];
        newLines[cursorLine] = before + accepted.value + after;
        state.lines = newLines;
        state.cursorLine = cursorLine;
        state.cursorCol = before.length + accepted.value.length;
        return { lines: newLines, cursorLine, cursorCol: state.cursorCol };
      },
    ),
  };
}

describe("replayed-store arming end-to-end (real ingest pipeline, NREL fixture — the PRD §09 item-7 route, h2.54)", () => {
  it("bare-word arming end-to-end: 'National' in menu → accept → armed → word-start offer yields renewable → energy", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/nrel.jsonl`);
    const { store, pipeline } = makeNrelPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg(), current, chain);

    await replayNrel(pipeline, entries);

    // The bare word is present in the word-only menu (whole-word
    // acceptance arms the chain — h2.43), sorting last among the word
    // candidates.
    const menu = await suggest(provider, ["natio"], 0, 5);
    const nationalItem = menu!.items[menu!.items.length - 1]!;
    expect(nationalItem.value).toBe("National");
    expect(nationalItem.description).toMatch(/^session x\d+$/);

    provider.applyCompletion(["natio"], 0, 5, nationalItem, "natio");
    expect(chain.state()).toEqual({ word: "national" });
    expect(current.state.lines).toEqual(["National"]);

    // The user types the separating space — the cursor is now at the
    // empty next word with ZERO typed chars, where the redesigned
    // word-start offer (plan 002) serves topSuccessors('national') at
    // prefix "" with BARE values.
    current.typeSpace();
    expect(current.state.lines).toEqual(["National "]);
    const offer = await suggest(provider, current.state.lines, 0, current.state.cursorCol);
    expect(offer?.prefix).toBe("");
    expect(offer?.items.map((i) => [i.label, i.value])).toEqual([
      ["renewable", "renewable"],
      ["wind", "wind"], // license dropped: was a gate-rejected-"lab" bridge (P1.M1.T3.S2)
    ]);
    expectSingleWordItems(offer?.items ?? []);

    // Tab → armed(renewable); pi-tui splices the BARE value verbatim at
    // the cursor (prefix ""), so the user's space stays the single
    // separator — no double space.
    provider.applyCompletion(
      current.state.lines,
      0,
      current.state.cursorCol,
      offer!.items[0]!,
      offer!.prefix,
    );
    expect(chain.state()).toEqual({ word: "renewable" });
    expect(current.state.lines).toEqual(["National renewable"]); // ONE space

    // Space again → the chain continues at the next word start:
    // renewable's successors, still bare, still one word each.
    current.typeSpace();
    expect(current.state.lines).toEqual(["National renewable "]);
    const offer2 = await suggest(provider, current.state.lines, 0, current.state.cursorCol);
    expect(offer2?.prefix).toBe("");
    expect(offer2?.items.map((i) => i.label)).toEqual(["energy"]);
    expectSingleWordItems(offer2?.items ?? []);
  });

  it("config gate inertness: enableChaining:false never arms and never offers", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/nrel.jsonl`);
    // Successors ARE present (hook on) so the case proves the CONFIG
    // gate alone blocks the chain layer — not a missing index.
    const { store, pipeline } = makeNrelPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg({ enableChaining: false }), current, chain);

    await replayNrel(pipeline, entries);

    // (i) Arming is gated: accepting a live word item must NOT arm
    // (word completion itself still works — the flag disables the chain
    // layer, not hapax's word menu).
    const menu = await suggest(provider, ["natio"], 0, 5);
    expect(menu?.items.map((i) => i.value)).toContain("National");
    provider.applyCompletion(["natio"], 0, 5, menu!.items[menu!.items.length - 1]!, "natio");
    expect(chain.state()).toBeNull();

    // (ii) Even a machine armed by ANY means never offers: the armed
    // branch is gated off, so the zero-char word start falls through to
    // extractMatchState (null there) → pi's stock delegate, no chain
    // item ever published. The machine's own state is untouched — the
    // gate lives in the provider.
    chain.arm("national");
    const options = opts();
    const lines = ["National "];
    expect(await provider.getSuggestions(lines, 0, 9, options)).toBeNull();
    expect(current.getSuggestions).toHaveBeenCalledOnce();
    expect(current.getSuggestions.mock.calls[0]![3]).toBe(options); // args identity
    expect(chain.state()).toEqual({ word: "national" }); // inert, never consulted
  });
});