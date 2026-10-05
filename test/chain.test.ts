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

import { beforeAll, describe, expect, it, vi, type Mock } from "vitest";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { loadDictionary } from "../src/core/dictionary.js";
import { rankMatches } from "../src/core/query.js";
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
import {
  editorApplyCompletion,
  prefixIsAnchorSafe,
} from "./helpers/editor-sim.js";
import { assertWordsOnly } from "./helpers/query-invariants.js";

// ── fixtures (provider.test.ts style) ───────────────────────────────────────

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

  it("ONE-SHOT offer (2026-09): typing through the granted offer disarms at the next word boundary", async () => {
    const store = seedStore();
    const ed = editingCurrent(["al"], 2);
    const { chain, inner } = makeStack(store, ed);
    await armViaTab(inner, chain, store, "alpha", "al");

    // Word 1 — the granted immediate offer.
    ed.typeSpace();
    const offer = await suggest(inner, ed.state.lines, 0, ed.state.cursorCol);
    expect(offer?.prefix).toBe("");
    expect(offer?.items.map((i) => i.value)).toEqual(["beta", "bravo"]);

    // The user TYPES THROUGH without accepting: same-word narrowing
    // queries keep the chain (each prefix extends the last)…
    for (const c of ["b", "e", "t"]) {
      ed.type(c);
      const narrowing = await suggest(inner, ed.state.lines, 0, ed.state.cursorCol);
      expect(narrowing?.items.some((i) => i.description === "chain")).toBe(true);
    }
    expect(chain.state()).toEqual({ word: "alpha" }); // still armed within the word

    // …but typing the offer word to COMPLETION ("beta") empties the
    // chain filter — the exact-equal exclusion (§04 h2.29 parity)
    // drops the fully-typed successor too — so the (c) disqualification
    // resets the arm on this SAME tick and the normal path answers
    // (fragment equals the stored key → empty → delegate).
    ed.type("a");
    const full = await suggest(inner, ed.state.lines, 0, ed.state.cursorCol);
    expect(full).toBeNull();
    expect(chain.state()).toBeNull();

    // …but the NEXT word boundary (space, zero-char query) disarms and
    // falls through: the normal path answers (no fragment → delegate),
    // and the chain is idle — no more intent-bypass offers at every
    // word start for the rest of the message.
    ed.typeSpace();
    expect(ed.state.lines).toEqual(["alpha beta "]);
    const after = await suggest(inner, ed.state.lines, 0, ed.state.cursorCol);
    expect(chain.state()).toBeNull();
    expect(after).toBeNull(); // delegated (zero fragment) — NOT a chain offer
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

// ── armed-chain fuzzy membership gate (§07 h2.49, plan 003 S1) ───────
// The typed-fragment filter is the SAME anchored fuzzy matcher as the
// query path (core/query.ts matchFragment), used as a pure MEMBERSHIP
// gate: any tier (3/2/1) passes at chain threshold 0, scores/tiers never
// reorder, and the menu keeps topSuccessors' successor-count order.

/** Bigram seeding for alpha→zendesk(3), alpha→kappa(2) — count-desc menu
 *  order [zendesk, kappa]. Both words are put() so menu values carry
 *  store display casing. Fragment matrix: "zk" matches zendesk only
 *  (tier-2 contiguous tail; kappa anchor-misses: z ≠ k); "zdk" matches
 *  zendesk only (tier-1 gapped subsequence d…k); "q…" anchor-misses
 *  both. */
const seedZSuccessors = (s: CandidateStore): void => {
  put(s, "zendesk", 3);
  put(s, "kappa", 3);
  for (let r = 0; r < 3; r++) s.recordBigramRuns([["alpha", "zendesk"]]);
  for (let r = 0; r < 2; r++) s.recordBigramRuns([["alpha", "kappa"]]);
};

/** Bigram seeding for alpha→zaza(3), alpha→zaay(2) — count-desc order
 *  [zaza, zaay]. Fragment "zaa" matches BOTH at different tiers — zaza
 *  tier 1 (scattered a…a tail), zaay tier 3 (exact prefix, score 100) —
 *  so any tier/score re-sort would flip the menu; count order must hold. */
const seedTierOrderSuccessors = (s: CandidateStore): void => {
  put(s, "zaza", 3);
  put(s, "zaay", 3);
  for (let r = 0; r < 3; r++) s.recordBigramRuns([["alpha", "zaza"]]);
  for (let r = 0; r < 2; r++) s.recordBigramRuns([["alpha", "zaay"]]);
};

describe("armed-chain fuzzy membership gate (§07 h2.49, plan 003 S1)", () => {
  it("tier-2 tail membership: 'zk' offers 'zendesk' (non-prefix contiguous tail; old startsWith missed it)", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al", seedZSuccessors);

    // "zk" is NOT a prefix of "zendesk" — under startsWith this disarmed.
    // matchFragment: anchor z, contiguous tail "k" found at index 6 →
    // tier 2 → membership passes at threshold 0. kappa is filtered by an
    // ANCHOR miss (fragment z vs successor k).
    const menu = await suggest(inner, ["alpha zk"], 0, 8);
    expect(menu?.items.map((i) => i.value)).toEqual(["zendesk"]);
    expect(menu?.prefix).toBe("zk");
    expect(chain.state()).toEqual({ word: "alpha" }); // membership never disarms
  });

  it("tier-1 scattered membership: 'zdk' (anchored gapped subsequence) offers 'zendesk'", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al", seedZSuccessors);

    // anchor z; tail "dk" placed greedy-leftmost (d@3, k@6) with one gap
    // run ("es") → tier 1, low score — but scores are NEVER consulted on
    // this path (threshold 0; membership = !== null only).
    const menu = await suggest(inner, ["alpha zdk"], 0, 9);
    expect(menu?.items.map((i) => i.value)).toEqual(["zendesk"]);
    expect(chain.state()).toEqual({ word: "alpha" });
  });

  it("anchor-miss on every successor (zero membership) → disarm + delegate on the SAME call", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al", seedZSuccessors);

    // "q" anchors on q — no successor starts with q (the h2.43
    // disqualification shape, now via matchFragment's anchor rule):
    // disarm on THIS keystroke, the normal path answers — at threshold 2
    // a 1-char fragment has no match state → pi's stock delegate (mock
    // null), arguments/options forwarded verbatim.
    const options = opts();
    const lines = ["alpha q"];
    expect(await inner.getSuggestions(lines, 0, 7, options)).toBeNull();
    expect(current.getSuggestions).toHaveBeenCalledOnce();
    const call = current.getSuggestions.mock.calls[0]!;
    expect(call[0]).toBe(lines); // verbatim array identity
    expect(call[3]).toBe(options); // verbatim options identity
    expect(chain.state()).toBeNull(); // disarmed THIS call
  });

  it("successor-count order survives different-tier matches (no tier/score re-sort)", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alpha", "al", seedTierOrderSuccessors);

    // "zaa": zaza → tier 1, zaay → tier 3 (score 100). A tier/score sort
    // would hoist zaay; the chain keeps topSuccessors' count-desc order.
    const menu = await suggest(inner, ["alpha zaa"], 0, 9);
    expect(menu?.items.map((i) => i.value)).toEqual(["zaza", "zaay"]);
    expect(menu?.prefix).toBe("zaa");
    expect(chain.state()).toEqual({ word: "alpha" });
  });
});

// ── NREL replay harness (real ingest; the PRD §09 item-7 route) ────────
// Mirrors acceptance.test.ts's item-7 helpers (makeChainPipeline /
// replayChain / editingCurrent): the REAL ingest pipeline with the bigram
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
function makeChainPipeline(enableChaining: boolean): { store: CandidateStore; pipeline: IngestPipeline } {
  const store = new CandidateStore();
  const pipeline = new IngestPipeline({
    store,
    dictionary: loadDictionary(resolveDictPath()),
    ...(enableChaining
      ? {
          onAdmittedTokens: (lines) =>
            store.recordBigramRuns(lines.map((r) => r.map((m) => m.key))),
        }
      : {}),
  });
  return { store, pipeline };
}

/** Replay pre-parsed fixture entries through restoreFromHistory on the
 *  GIVEN pipeline (same completion-tracking wrapper as acceptance). */
async function replayChain(
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
    type(ch: string): void {
      const line = state.lines[state.cursorLine] ?? "";
      const lines = [...state.lines];
      lines[state.cursorLine] =
        line.slice(0, state.cursorCol) + ch + line.slice(state.cursorCol);
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

describe("replayed-store arming end-to-end (real ingest pipeline, zephra-chain fixture — the PRD §09 item-7 route, h2.54)", () => {
  it("bare-word arming end-to-end: 'Zorp' in menu → accept → armed → word-start offer yields Zephra → Noria", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/zephyr-chain.jsonl`);
    const { store, pipeline } = makeChainPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg(), current, chain);

    await replayChain(pipeline, entries);

    // The bare word is present in the word-only menu (whole-word
    // acceptance arms the chain — h2.43), topping the candidates:
    // dictionary-absent "zorp" (group 0, rarity bonus) outranks its
    // q≤26 walk partners (group 2).
    const menu = await suggest(provider, ["zor"], 0, 3);
    const zorpItem = menu!.items[0]!;
    expect(zorpItem.value).toBe("Zorp");
    expect(zorpItem.description).toMatch(/^session x\d+$/);

    provider.applyCompletion(["zor"], 0, 3, zorpItem, "zor");
    expect(chain.state()).toEqual({ word: "zorp" });
    expect(current.state.lines).toEqual(["Zorp"]);

    // The user types the separating space — the cursor is now at the
    // empty next word with ZERO typed chars, where the redesigned
    // word-start offer (plan 002) serves topSuccessors('zorp') at
    // prefix "" with BARE values in the candidate display casing
    // (PRD §07; the 2026-09 Issue-2 fix).
    current.typeSpace();
    expect(current.state.lines).toEqual(["Zorp "]);
    const offer = await suggest(provider, current.state.lines, 0, current.state.cursorCol);
    expect(offer?.prefix).toBe("");
    expect(offer?.items.map((i) => [i.label, i.value])).toEqual([
      ["Zephra", "Zephra"],
      ["turbine", "turbine"], // 2026-10 R=30: turbine (q=26) admits — count-1 tail of the offer
    ]);
    expectSingleWordItems(offer?.items ?? []);

    // Tab → armed(zephra); pi-tui splices the BARE value verbatim at
    // the cursor (prefix ""), so the user's space stays the single
    // separator — no double space.
    provider.applyCompletion(
      current.state.lines,
      0,
      current.state.cursorCol,
      offer!.items[0]!,
      offer!.prefix,
    );
    expect(chain.state()).toEqual({ word: "zephra" });
    expect(current.state.lines).toEqual(["Zorp Zephra"]); // ONE space

    // Space again → the chain continues at the next word start:
    // zephra's successors, still bare, still one word each.
    current.typeSpace();
    expect(current.state.lines).toEqual(["Zorp Zephra "]);
    const offer2 = await suggest(provider, current.state.lines, 0, current.state.cursorCol);
    expect(offer2?.prefix).toBe("");
    expect(offer2?.items.map((i) => i.label)).toEqual(["Noria"]);
    expectSingleWordItems(offer2?.items ?? []);
  });

  it("config gate inertness: enableChaining:false never arms and never offers", async () => {
    const entries = parseSessionFixture(`${FIXTURES}/zephyr-chain.jsonl`);
    // Successors ARE present (hook on) so the case proves the CONFIG
    // gate alone blocks the chain layer — not a missing index.
    const { store, pipeline } = makeChainPipeline(true);
    const current = editingCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg({ enableChaining: false }), current, chain);

    await replayChain(pipeline, entries);

    // (i) Arming is gated: accepting a live word item must NOT arm
    // (word completion itself still works — the flag disables the chain
    // layer, not hapax's word menu).
    const menu = await suggest(provider, ["zor"], 0, 3);
    expect(menu?.items.map((i) => i.value)).toContain("Zorp");
    provider.applyCompletion(["zor"], 0, 3, menu!.items[0]!, "zor");
    expect(chain.state()).toBeNull();

    // (ii) Even a machine armed by ANY means never offers: the armed
    // branch is gated off, so the zero-char word start falls through to
    // extractMatchState (null there) → pi's stock delegate, no chain
    // item ever published. The machine's own state is untouched — the
    // gate lives in the provider.
    chain.arm("zorp");
    const options = opts();
    const lines = ["Zorp "];
    // 2026-09 close-on-space rule: a plain trailing space returns null
    // WITHOUT delegating (pi's stock provider answers a trailing space
    // with the whole-cwd file listing; that delegation stuck a file
    // menu where hapax's menu closed).
    expect(await provider.getSuggestions(lines, 0, 5, options)).toBeNull();
    expect(current.getSuggestions).not.toHaveBeenCalled();
    expect(chain.state()).toEqual({ word: "zorp" }); // inert, never consulted
  });
});

describe("chain machine — armed branch word-start guard (BUG-005)", () => {
  // Fixture per the bugfix item contract: two successors of "alphaone",
  // all three words menu-eligible (trigger-mode fall-through needs them).
  const seedAlphaoneSuccessors = (s: CandidateStore): void => {
    s.recordBigramRuns([["alphaone", "betaword"]]);
    s.recordBigramRuns([["alphaone", "deltaword"]]);
    put(s, "alphaone", 3);
    put(s, "betaword", 3);
    put(s, "deltaword", 3);
  };

  it("armed chain resets on the trigger char: '#b' answers in trigger mode at prefix '#b' and leaves the chain idle", async () => {
    const current = makeCurrent();
    const store = new CandidateStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alphaone", "al", seedAlphaoneSuccessors);

    const lines = ["x alphaone #b"];
    const r = await suggest(inner, lines, 0, lines[0]!.length);
    // Trigger mode consumed the '#': the prefix is the RAW typed text
    // '#b' (never the bare fragment 'b' — pi-tui deletes prefix.length
    // chars blindly, so a chain answer at 'b' would strand the '#').
    expect(r?.prefix).toBe("#b");
    expect(chain.state()).toBeNull(); // disqualify → idle (PRD §07)
    // Normal-path items (word provenance), never chain-provenance ones.
    const items = r?.items ?? [];
    expect(items.every((i) => i.description !== "chain")).toBe(true);
    expect(items.map((i) => i.value)).toContain("betaword"); // matches 'b'
  });

  it("armed chain still filters successors at a word start ('x alphaone be')", async () => {
    const current = makeCurrent();
    const store = new CandidateStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alphaone", "al", seedAlphaoneSuccessors);

    const lines = ["x alphaone be"];
    const r = await suggest(inner, lines, 0, lines[0]!.length);
    expect(r?.prefix).toBe("be"); // raw fragment — the armed branch owns it
    expect(chain.state()).toEqual({ word: "alphaone" }); // still armed
    expect(r?.items.map((i) => i.value)).toEqual(["betaword"]); // deltaword filtered
  });

  it("zero-typed-char offer unchanged after the guard (regression)", async () => {
    const current = makeCurrent();
    const store = new CandidateStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alphaone", "al", seedAlphaoneSuccessors);

    const lines = ["x alphaone "];
    const r = await suggest(inner, lines, 0, lines[0]!.length);
    expect(r?.prefix).toBe(""); // the (a) path — untouched by the guard
    expect(r?.items.map((i) => i.value)).toEqual(["betaword", "deltaword"]); // unfiltered, count order
    expect(chain.state()).toEqual({ word: "alphaone" }); // stays armed
  });

  it("punctuation glued before a fragment also resets (state machine consistency)", async () => {
    const current = makeCurrent();
    const store = new CandidateStore();
    const { chain, inner } = makeStack(store, current);
    await armViaTab(inner, chain, store, "alphaone", "al", seedAlphaoneSuccessors);

    const lines = ["x alphaone!be"]; // 'be' glued to '!' — not a word start
    const r = await suggest(inner, lines, 0, lines[0]!.length);
    expect(chain.state()).toBeNull(); // disqualify → idle
    // The normal path answers: threshold mode at the bare fragment 'be'.
    expect(r?.prefix).toBe("be");
    expect((r?.items ?? []).every((i) => i.description !== "chain")).toBe(true);
  });
});

// ── editor-sim integration (bugfix 001_0f4b641cf9ce, P1.M1.T2.S2) ───────
// S1's unit cases above assert PROVIDER RETURN VALUES at the makeStack
// level; this describe is the editor-level layer ABOVE them: a persistent
// buffer flows through real accepts, and the assertions are on the
// resulting LINE TEXT — pi-tui's applyCompletion deletes exactly
// prefix.length chars blindly, so only the buffer can prove that the
// BUG-005 fix consumes '#' AND 'b' with no stranded residue (the h3.4
// repro). The store is populated through the REAL ingest pipeline
// (shipped dictionary: the nonsense words are dictionary-absent → group 0
// → admit); only `current` is mocked. Cursors are line.length-derived —
// col > text.length would delegate via extractMatchState's range guard
// and prove nothing.
describe("editor-sim integration — trigger consumption & one-word invariant (BUG-005/BUG-001)", () => {
  /** The h3.4 repro corpus: two lines; the real bigram hook records
   *  alphaone→betaword, betaword→gamma, alphaone→deltaword,
   *  deltaword→epsilonz. 'betaword' is the ONLY stored b-word, so the
   *  '#b' trigger menu is deterministic without extra seeding. */
  let store: CandidateStore;
  beforeAll(async () => {
    const wired = makeChainPipeline(true);
    await wired.pipeline.processText("alphaone betaword gammaz", false); // gammaz: absent (gamma q47 now rejects)
    await wired.pipeline.processText("alphaone deltaword epsilonz", true); // epsilonz: absent (epsilon q19 now rejects)
    store = wired.store;
  });

  /** Production arming path on the real-ingested word: live menu at
   *  "al" + whole-word Tab acceptance (menu membership + arming both
   *  asserted). Lines/col are the arming buffer, e.g. (["al"], 2). */
  async function armAlphaone(
    p: ReturnType<typeof createHapaxProvider>,
    chain: ReturnType<typeof createChainMachine>,
    lines: string[],
    col: number,
  ): Promise<void> {
    const menu = await suggest(p, lines, 0, col);
    expect(menu?.items.map((i) => i.value)).toContain("alphaone");
    p.applyCompletion(lines, 0, col, item("alphaone"), "al");
    expect(chain.state()).toEqual({ word: "alphaone" });
  }

  it("case 1 — trigger char during an armed chain is consumed by completion (BUG-005 e2e)", async () => {
    const ed = editingCurrent(["al"], 2);
    const chain = createChainMachine();
    const inner = createHapaxProvider(store, cfg(), ed, chain);

    // Arm: accept "alphaone" from the live "al" menu through the REAL
    // provider accept path — the editing mock's pi-tui splice lands it
    // in the buffer.
    await armAlphaone(inner, chain, ed.state.lines, ed.state.cursorCol);
    expect(ed.state.lines).toEqual(["alphaone"]);

    // The user has typed on to the h3.4 repro line (typing never touches
    // the provider — the sim sets buffer state directly; ONLY accepts
    // flow through applyCompletion).
    const line = "x alphaone #b";
    ed.state.lines = [line];
    ed.state.cursorCol = line.length; // end of the typed text

    // The armed branch disqualifies ('b' is glued to '#') and the
    // normal path answers in TRIGGER mode at prefix '#b':
    const r = await suggest(inner, ed.state.lines, 0, line.length);
    expect(r?.prefix).toBe("#b"); // never the bare 'b' — that strands '#'
    expect(chain.state()).toBeNull(); // glued fragment → idle (PRD §07)
    expectSingleWordItems(r?.items ?? []); // invariant pre-accept
    expect((r?.items ?? []).every((i) => i.description !== "chain")).toBe(true);
    expect(r?.items.map((i) => i.value)).toEqual(["betaword"]); // deterministic

    // Anchor-safety contract BEFORE every sim apply — without it the sim
    // models nothing (the provider handed pi a non-suffix prefix).
    expect(prefixIsAnchorSafe(line, line.length, r!.prefix!)).toBe(true);

    // THE CORRUPTION DETECTOR: pi-tui's blind splice through the raw
    // sim math — '#' AND 'b' consumed, no residue:
    const out = editorApplyCompletion(line, line.length, r!.items[0]!.value, r!.prefix!);
    expect(out).toBe("x alphaone betaword"); // pre-fix: "x alphaone #betaword"

    // Accepting through the REAL provider re-arms on the accepted word
    // and lands the SAME buffer result through the editing mock:
    inner.applyCompletion(ed.state.lines, 0, line.length, r!.items[0]!, r!.prefix!);
    expect(ed.state.lines).toEqual(["x alphaone betaword"]); // buffer truth
    expect(ed.state.cursorCol).toBe("x alphaone betaword".length);
    expect(chain.state()).toEqual({ word: "betaword" }); // re-armed
  });

  it("case 2 — one-word invariant holds across every chain-context menu", async () => {
    const ed = editingCurrent(["al"], 2);
    const chain = createChainMachine();
    const inner = createHapaxProvider(store, cfg(), ed, chain);

    await armAlphaone(inner, chain, ed.state.lines, ed.state.cursorCol);

    // (i) Zero-typed-char word-start offer — unfiltered successors at
    // prefix "", bare values:
    const offerLine = "x alphaone ";
    ed.state.lines = [offerLine];
    ed.state.cursorCol = offerLine.length;
    const offer = await suggest(inner, ed.state.lines, 0, offerLine.length);
    expect(offer?.prefix).toBe("");
    expect(offer?.items.map((i) => i.value)).toEqual(["betaword", "deltaword"]);
    expectSingleWordItems(offer?.items ?? []);

    // (ii) Word-start fragment filter — live narrowing at chain
    // threshold 0, prefix is the raw fragment:
    const fragLine = "x alphaone be";
    ed.state.lines = [fragLine];
    ed.state.cursorCol = fragLine.length;
    const filtered = await suggest(inner, ed.state.lines, 0, fragLine.length);
    expect(filtered?.prefix).toBe("be");
    expect(filtered?.items.map((i) => i.value)).toEqual(["betaword"]);
    expectSingleWordItems(filtered?.items ?? []);

    // (iii) Post-accept offer: accepting 'betaword' re-arms the chain on
    // it; the NEXT word start serves betaword's own successor (the
    // real hook recorded betaword→gamma) — still single-word:
    inner.applyCompletion(ed.state.lines, 0, fragLine.length, filtered!.items[0]!, filtered!.prefix!);
    expect(chain.state()).toEqual({ word: "betaword" }); // re-armed
    expect(ed.state.lines).toEqual(["x alphaone betaword"]); // buffer truth
    ed.typeSpace();
    const post = await suggest(inner, ed.state.lines, 0, ed.state.cursorCol);
    expect(post?.prefix).toBe("");
    expect(post?.items.map((i) => i.value)).toEqual(["gammaz"]);
    expectSingleWordItems(post?.items ?? []);

    // (iv) RankedMatch level: the shared helper gates the direct core
    // path with the same rule the pi-item checks above apply.
    assertWordsOnly(rankMatches(store, "al"), "rankMatches 'al'");
  });

  it("case 3 — slash flow: Tab-equivalent forced call on '/re' returns the stock result, never hapax items (BUG-001 sim)", async () => {
    // Stock sentinel: identity-proves the DELEGATE's result came back —
    // a hapax menu would be a fresh { items, prefix } object.
    const stockResult: AutocompleteSuggestions = {
      items: [{ value: "/retry", label: "/retry" }],
      prefix: "/re",
    };
    const current = makeCurrent({
      getSuggestions: vi.fn(async () => stockResult),
    });
    const chain = createChainMachine();
    const inner = createHapaxProvider(store, cfg(), current, chain);

    // Arm FIRST: the stock-context gate must win even over an armed
    // chain (branch order: abort → stock → armed → force-aware → normal).
    await armAlphaone(inner, chain, ["al"], 2);

    // pi-tui's Tab shape (editor.js Tab-with-no-menu path): force:false +
    // explicitTab:true. The stock gate fires BEFORE the force read, so
    // the flags cannot change the outcome — they pin the real shape.
    const options = {
      ...opts(),
      force: false,
      explicitTab: true,
    } as Parameters<AutocompleteProvider["getSuggestions"]>[3];
    const lines = ["/re"];
    const r = await inner.getSuggestions(lines, 0, 3, options);

    expect(r).toBe(stockResult); // exact sentinel identity — delegated
    expect(current.getSuggestions).toHaveBeenCalledOnce();
    expect(current.getSuggestions.mock.calls[0]![0]).toBe(lines); // args identity
    expect(current.getSuggestions.mock.calls[0]![3]).toBe(options); // options identity
    // Zero hapax items: hapax menus ALWAYS stamp provenance ("chain" or
    // "session x<N>"); pi's stock items carry no description at all.
    const hapaxItem = (r?.items ?? []).find(
      (i) => i.description === "chain" || /^session x\d+$/.test(i.description ?? ""),
    );
    expect(hapaxItem, "stock result must contain no hapax items").toBeUndefined();
    // The stock gate delegates WITHOUT disarming — the machine is never
    // consulted on this path (branch-order contract).
    expect(chain.state()).toEqual({ word: "alphaone" });
  });
});

describe("chain arming × match tier (plan 004: tier-0 never arms)", () => {
  // Arm-suppression contract: the accepted item is looked up in lastLive's
  // ≤ 8 records (liveKeyByValue carries only display→key — tier is not
  // there). Strict `tier === 0` suppresses; chain shims and '#'-alone
  // listing records OMIT tier, so they keep arming; a stale/null live set
  // fails open. Trigger-mode menus are loose since plan 004, so a mid-key
  // fragment reaches these states through the REAL provider path.
  it("tier-0 (anchorless) acceptance never arms the chain", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);

    // '#eta' → trigger mode → loose 45: 'eta' sits mid-key in "beta" (and
    // "theta") — tier-0 records, no anchored match (anchor 'e' leads no
    // seed word). Count tie → shorter key first: beta tops the menu.
    const menu = await suggest(inner, ["#eta"], 0, 4);
    expect(menu?.items.map((i) => i.value)).toEqual(["beta", "theta"]);
    expect(menu?.items.every((i) => i.description === "chain")).toBe(false);

    inner.applyCompletion(["#eta"], 0, 4, item("beta"), "#eta");
    expect(chain.state()).toBeNull(); // tier-0: NEVER arms (spec §04)
  });

  it("tier-2 (contiguous-tail) acceptance arms", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);

    // '#bta': anchor 'b', tail "ta" contiguous at index 2 of "beta" →
    // tier 2, score 75 ≥ 45 → anchored menu (the armed-style accept).
    const menu = await suggest(inner, ["#bta"], 0, 4);
    expect(menu?.items.map((i) => i.value)).toEqual(["beta"]);

    inner.applyCompletion(["#bta"], 0, 4, item("beta"), "#bta");
    expect(chain.state()).toEqual({ word: "beta" }); // tier 2 arms
  });

  it("'#'-alone listing acceptance arms (listing records omit tier)", async () => {
    const current = makeCurrent();
    const store = seedStore();
    const { chain, inner } = makeStack(store, current);

    // Bare '#' → zero-fragment listing: every record omits `tier`, so the
    // strict === 0 suppression cannot see them — arming is preserved.
    const menu = await suggest(inner, ["#"], 0, 1);
    expect(menu?.items.map((i) => i.value)).toContain("alpha");

    inner.applyCompletion(["#"], 0, 1, item("alpha"), "#");
    expect(chain.state()).toEqual({ word: "alpha" });
  });
});
