/**
 * Adversarial typing-path e2e probes (P1.M5.T1.S1, bugfix 001_9e0f97150b68).
 *
 * METHODOLOGY — the original 523-green acceptance suite masked six real
 * bugs because its probes used ≤3-char words, single-token fake keys, and
 * pre-ingestion acceptance ordering: a gate that cannot see the failure is
 * worse than no gate. These three probes re-run the typing-path shapes
 * from the 8-suite bug hunt that actually FOUND the bugs, against REAL
 * modules and the SHIPPED dictionary artifact (resolveDictPath — the
 * HAPAX_DICT seam honored). Nothing is mocked except the pi session
 * shell: the delegate provider (mockCurrent sentinel/null), the session
 * manager boundary cast (asSessionManager), and the pi-shaped editing
 * buffer (editingCurrent). Store, pipeline, dictionary, chain machine,
 * and both provider layers are the production code paths.
 *
 *   Probe A — prose no-menu      → BUG-001 (PRD §h2.1 / §h3.0): ordinary
 *     prose.jsonl replayed through a real IngestPipeline with the shipped
 *     dict; REJECT-band common words must DELEGATE (exact sentinel
 *     identity, empty live cache); the mid/reject boundary is pinned per
 *     band (posts admits exactly ['posts'], firs delegates) using the
 *     IMPORTED band constants — never hard-coded numbers.
 *   Probe B — Tab corruption     → BUG-002 (PRD §h2.2 / §h3.1): the full
 *     ze→zep editor-sim through createDisplayProvider under fake timers;
 *     whatever the provider returns is Tab-applied through the faithful
 *     pi-tui deletion math (editorApplyCompletion) and must land in an
 *     explicit allowlist — 'zzendesk'-class corruption is structurally
 *     impossible only while every response prefix stays anchor-safe.
 *   Probe C — chain post-restore → BUG-005 (PRD §h2.2 / §h3.4): full
 *     zephyr-chain.jsonl replay via restoreFromHistory (the /resume
 *     scenario), then the bare word 'Zorp' (present thanks to
 *     P1.M4.T2.S1's suppression exemption) is accepted via the provider's
 *     real applyCompletion — whose arming side effect (P1.M4.T2.S2)
 *     drives the PRD §09 M2 item 7 sequence: Zephra → Noria → Inverter,
 *     each hop asserted individually so a failure names the broken link.
 *
 * The chain-arming route (accept a successor item) and the ingest-path
 * probes (secrets, bad-dict restore, demotion cadence) are deliberately
 * NOT here: they live in test/chain.test.ts and the sibling
 * P1.M5.T1.S2 suite respectively.
 */

import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { loadDictionary } from "../src/core/dictionary.js";
import { rankMatches } from "../src/core/query.js";
import {
  MID_FREQ_THRESHOLD,
  REJECT_COMMON_THRESHOLD,
} from "../src/core/score.js";
import { CandidateStore } from "../src/core/store.js";
import type { Dictionary, Sighting } from "../src/core/types.js";
import { DEFAULT_CONFIG, type HapaxConfig } from "../src/pi/config.js";
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
} from "../src/pi/provider.js";
import { COMMON_PROBES } from "./calibration.test.js";
import {
  editorApplyCompletion,
  prefixIsAnchorSafe,
} from "./helpers/editor-sim.js";
import {
  asSessionManager,
  parseSessionFixture,
} from "./helpers/session-fixture.js";

const PROSE = "test/fixtures/sessions/prose.jsonl";
const NREL = "test/fixtures/sessions/zephyr-chain.jsonl";

// ── harness (lifted whole from test/calibration.test.ts and
// test/provider-display.test.ts — those files are built to be lifted) ───────

/** Fresh config per call — never mutate DEFAULT_CONFIG. */
const cfg = (over: Partial<HapaxConfig> = {}): HapaxConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

/** Fresh { signal } per call — real AbortController, not aborted. */
const opts = (): { signal: AbortSignal } => ({ signal: new AbortController().signal });

type MockedCurrent = AutocompleteProvider & {
  getSuggestions: Mock;
  applyCompletion: Mock;
};

/** Mock wrapped provider — the ONLY mock: pi's session shell. */
const mockCurrent = (result: unknown = null): MockedCurrent =>
  ({
    getSuggestions: vi.fn(async () => result),
    applyCompletion: vi.fn(
      (lines: string[], cursorLine: number, cursorCol: number) => ({ lines, cursorLine, cursorCol }),
    ),
  }) as MockedCurrent;

/** The built-in result a delegating provider must hand back untouched. */
const SENTINEL = {
  items: [{ value: "src/core/query.ts", label: "src/core/query.ts" }],
  prefix: "/",
};

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

/** Upsert `key` `times` times at `ordinal`; display carries the
 *  user-visible casing, the store key stays lowercase. */
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

/** BUG-002 repro store (provider-display convention) — exactly zendesk
 *  (display "Zendesk") ×3 + zephra ×1: 'z' stays below the 2-char
 *  threshold, 'ze' paints both, 'zep' live-narrows to zephra. */
const reproStore = (): CandidateStore => {
  const s = new CandidateStore();
  put(s, "zendesk", 3, 9, { display: "Zendesk" });
  put(s, "zephra", 1, 9);
  return s;
};

/** Replay fixture entries through restoreFromHistory on `pipeline`,
 *  resolving once every text-bearing message has been ingested (the
 *  calibration/acceptance completion-tracking convention; restoreFromHistory
 *  replays async — the promise is what keeps beforeAll honest). */
async function replay(
  pipeline: IngestPipeline,
  entries: ReturnType<typeof parseSessionFixture>,
): Promise<void> {
  const total = entries.filter(
    (e) =>
      e.message !== undefined &&
      extractText(e.message as unknown as AgentMessage) !== null,
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

/** Pi-shaped editing harness (chain.test.ts/acceptance convention): a
 *  current provider whose applyCompletion performs pi-tui's insertion
 *  (replace `prefix` before the cursor with item.value) on ONE persistent
 *  buffer, so chain hops flow through a realistic editing surface. */
function editingCurrent() {
  const state = { lines: ["natio"], cursorLine: 0, cursorCol: 5 };
  return {
    state,
    getSuggestions: vi.fn(
      async (
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        options: { signal: AbortSignal },
      ) => null,
    ),
    applyCompletion: vi.fn(
      (
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        accepted: AutocompleteItem,
        prefix: string,
      ) => {
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

// ── Probe A table — probe → expected outcome, pinned in ONE place. Band
// membership is asserted against the IMPORTED score.ts constants (never
// hard-coded), so a band retune keeps the gate meaningful. ──────────────────

interface ProseProbe {
  readonly fragment: string;
  /** The full dictionary word whose band this probe pins. */
  readonly full: string;
  readonly title: string;
  readonly expected: "delegate" | readonly string[];
}

const PROSE_PROBES: readonly ProseProbe[] = [
  ...COMMON_PROBES.map(
    (w): ProseProbe => ({
      fragment: w,
      full: w,
      title: "delegate (REJECT band)",
      expected: "delegate",
    }),
  ),
  {
    fragment: "posts",
    full: "post",
    title: "delegate (stem 'post' REJECT band — conjugation guard)",
    expected: "delegate",
  },
  {
    // 2026-09 structural-start rule: 'Fences' is capitalized only at a
    // message start → no properName → conjugation guard rejects (stem
    // fence=71). Delegation is the CORRECT new outcome.
    fragment: "fenc",
    full: "fence",
    title: "delegate (structural-start capital → no relief → guard rejects)",
    expected: "delegate",
  },
  {
    fragment: "firs",
    full: "first",
    title: "delegate ('first' REJECT band)",
    expected: "delegate",
  },
];

// ── probes ──────────────────────────────────────────────────────────────────

describe("adversarial Probe A — prose no-menu (BUG-001)", () => {
  let store: CandidateStore;
  let dict: Dictionary;

  beforeAll(async () => {
    // REAL pipeline + SHIPPED dictionary artifact (resolveDictPath honors
    // the HAPAX_DICT seam exactly like the calibration/acceptance suites).
    dict = loadDictionary(resolveDictPath());
    const entries = parseSessionFixture(PROSE);
    store = new CandidateStore();
    const pipeline = new IngestPipeline({ store, dictionary: dict });
    await replay(pipeline, entries);
  }, 60_000);

  it("ingests prose.jsonl into a live (non-empty) store", () => {
    // 2026-09 retighten: ordinary English prose admits NOTHING — the
    // store is empty by design and the no-menu assertions below are true
    // for the right reason. The live-menu control in this file uses a
    // direct store upsert, keeping the suite non-vacuous.
    expect(store.size).toBe(0);
  });

  it.each(PROSE_PROBES)("prose probe '$fragment' → $title", async ({ fragment, full, expected }) => {
    const q = dict.lookup(full);
    expect(q, `shipped dict lost '${full}'`).not.toBeNull();

    if (expected === "delegate") {
      // Band pin: the full word sits at/above REJECT_COMMON_THRESHOLD, so
      // it was rejected at admission and can never be a menu item. The
      // invariant is band membership relative to the live constants, not
      // any particular score.
      expect(q!).toBeGreaterThanOrEqual(REJECT_COMMON_THRESHOLD);
      expect(rankMatches(store, fragment), `rankMatches('${fragment}') must be empty`).toEqual([]);

      // Full-provider half — where BUG-001 was actually visible: exact
      // sentinel identity (toBe) proves the delegate's result came back
      // untouched; a hapax menu would be a fresh { items, prefix } object.
      const current = mockCurrent(SENTINEL);
      const provider = createHapaxProvider(store, cfg(), current);
      const result = await provider.getSuggestions(
        [fragment],
        0,
        fragment.length,
        opts(),
      );
      expect(result, `typing '${fragment}' must delegate, not open a menu`).toBe(SENTINEL);
      expect(provider.__hapaxLive(), `'${fragment}' must leave the live cache empty`).toBeNull();
      expect(current.getSuggestions, `'${fragment}' must reach the wrapped provider once`).toHaveBeenCalledOnce();
    } else {
      // Mid-band pin: the word sits in [MID_FREQ_THRESHOLD,
      // REJECT_COMMON_THRESHOLD) — mid-band words LEGITIMATELY open menus.
      // The adversarial pin is the exact item-value set, not emptiness.
      expect(q!).toBeGreaterThanOrEqual(MID_FREQ_THRESHOLD);
      expect(q!).toBeLessThan(REJECT_COMMON_THRESHOLD);
      expect(rankMatches(store, fragment).map((m) => m.display)).toEqual(expected);

      const current = mockCurrent(SENTINEL);
      const provider = createHapaxProvider(store, cfg(), current);
      const menu = await provider.getSuggestions([fragment], 0, fragment.length, opts());
      expect(menu, `typing '${fragment}' must open its pinned menu`).not.toBe(SENTINEL);
      expect(menu!.items.map((i) => i.value)).toEqual(expected);
      expect(menu!.prefix).toBe(fragment);
      expect(provider.__hapaxLive()).not.toBeNull();
    }
  });

  it("positive control: a directly-stored jargon word opens a real menu on the SAME store", async () => {
    // Guards this file against vacuous no-menu results: the SAME store
    // DOES answer fragments of admitted words through the same provider
    // path. 2026-09 structural-start rule: every capitalized sighting in
    // prose.jsonl is message/sentence-initial, so relief no longer fires
    // for any of them ('Fences' included) — the live control is a
    // directly-upserted dictionary-absent jargon sighting instead.
    store.upsert({
      key: "lwlock", display: "lwlock", ordinal: store.currentOrdinal() + 1,
      fromUser: true, properName: false, rankGroup: 0, isSubword: false,
    });
    expect(rankMatches(store, "lwl").map((m) => m.display)).toEqual(["lwlock"]);
    const current = mockCurrent(SENTINEL);
    const provider = createHapaxProvider(store, cfg(), current);
    const result = await provider.getSuggestions(["lwl"], 0, 3, opts());
    expect(result).not.toBe(SENTINEL);
    expect(result!.items.map((i) => i.value)).toEqual(["lwlock"]);
  });
});

describe("adversarial Probe B — Tab corruption (BUG-002)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0); // t=0 — suppression-window math reads absolutely
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Threshold-mode typing (the PRD repro: plain chars, no '#' trigger):
   *  each query sees the WHOLE current line, cursor at line end. */
  const type = (
    wrapper: ReturnType<typeof createDisplayProvider>,
    line: string,
  ): Promise<AutocompleteSuggestions | null> =>
    wrapper.getSuggestions([line], 0, line.length, opts());

  it("'ze'→'zep' inside the suppression window: every response anchor-safe, Tab-apply lands in the allowlist", async () => {
    const current = mockCurrent(); // session shell delegate → null
    const base = createHapaxProvider(reproStore(), cfg(), current);
    const wrapper = createDisplayProvider(base);

    // 'z' — auto-open contract (effective threshold 1): the word-start
    // request already publishes the live set.
    expect((await type(wrapper, "z"))!.items.map((i) => i.value)).toEqual([
      "Zendesk", // count-desc top (h2.29: zendesk ×3 > zephra ×1, tier-3 tie)
      "zephra",
    ]);
    expect(base.__hapaxLive()).not.toBeNull();

    // 'e' — first qualifying keystroke paints {Zendesk, zephra} @"ze".
    const ze = await type(wrapper, "ze");
    expect(ze!.items.map((i) => i.value)).toEqual(["Zendesk", "zephra"]); // count order
    expect(
      prefixIsAnchorSafe("ze", 2, ze!.prefix),
      "'ze' response prefix must be the buffer's exact suffix",
    ).toBe(true);

    // 'p' 50 ms later — INSIDE the suppression window, but the anchor
    // moved ('ze' → 'zep'): the fresh narrowed set must paint immediately,
    // never be held with a stale prefix (the BUG-002 corruption anchor).
    vi.advanceTimersByTime(50);
    const zep = await type(wrapper, "zep");
    expect(zep, "'zep' must paint the narrowed live menu").not.toBeNull();
    expect(zep!.items.map((i) => i.value)).toEqual(["zephra"]);
    expect(zep!.prefix).toBe("zep");
    expect(prefixIsAnchorSafe("zep", 3, zep!.prefix)).toBe(true);

    // Tab-apply through pi-tui's REAL deletion math (blind prefix.length
    // splice — the helper trusts the provider's prefix verbatim, exactly
    // like the editor). The ALLOWLIST pins every legitimate outcome; any
    // doubled-prefix shape ('zzendesk', 'zeZendesk', …) falls outside it.
    const completed = editorApplyCompletion("zep", 3, zep!.items[0]!.value, zep!.prefix);
    expect(["zephra", "Zendesk"], `Tab-apply corrupted the line: '${completed}'`).toContain(
      completed,
    );
  });

  it("pause past the debounce after 'zep', then Tab with no further keystroke: the last response stays anchor-safe", async () => {
    const current = mockCurrent();
    const base = createHapaxProvider(reproStore(), cfg(), current);
    const wrapper = createDisplayProvider(base);

    const ze = await type(wrapper, "ze"); // paints {Zendesk, zephra} @"ze" at t=0
    expect(ze!.items.map((i) => i.value)).toEqual(["Zendesk", "zephra"]); // count order

    vi.advanceTimersByTime(50);
    const zep = await type(wrapper, "zep"); // immediate paint @"zep" (anchor moved)
    expect(zep!.items.map((i) => i.value)).toEqual(["zephra"]);
    expect(zep!.prefix).toBe("zep");

    // Pause PAST the debounce: the immediate paint superseded every timer
    // — nothing pending, nothing that could re-introduce a stale anchor
    // between the response and Tab.
    vi.advanceTimersByTime(150);
    expect(vi.getTimerCount()).toBe(0);

    // Tab with NO further keystroke: pi applies the LAST returned
    // suggestions — their prefix is the only thing standing between the
    // buffer and pi's blind prefix.length splice.
    expect(prefixIsAnchorSafe("zep", 3, zep!.prefix)).toBe(true);
    const completed = editorApplyCompletion("zep", 3, zep!.items[0]!.value, zep!.prefix);
    expect(
      ["zephra", "Zendesk"],
      `post-pause Tab-apply corrupted the line: '${completed}'`,
    ).toContain(completed);
  });
});

describe("adversarial Probe C — chain post-restore (BUG-005)", () => {
  let store: CandidateStore;

  beforeAll(async () => {
    // FULL zephra-chain replay — the /resume scenario — through a REAL
    // pipeline with the SHIPPED dict and the bigram hook wired exactly
    // like src/pi/index.ts's session_start: successor index complete
    // (store.topSuccessors: zorp→zephra — turbine (q26) table-rejects
    // since the 2026-09 retighten; the old "license" entry was a
    // gate-rejected-"lab" bridge, removed by
    // P1.M1.T3.S2's strict adjacency — zephra→noria, noria→inverter).
    const entries = parseSessionFixture(NREL);
    const s = new CandidateStore();
    const pipeline = new IngestPipeline({
      store: s,
      dictionary: loadDictionary(resolveDictPath()),
      onAdmittedTokens: (lines: string[][]) => s.recordBigramRuns(lines),
    });
    store = s;
    await replay(pipeline, entries);
  }, 60_000);

  it("replay is live and the bare word 'Zorp' is co-present with its chain successors (P1.M4.T2.S1 exemption)", async () => {
    expect(store.size, "fixture replay admitted nothing — the probes below would be vacuous").toBeGreaterThan(0);

    const current = mockCurrent();
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg(), current, chain);

    const menu = await provider.getSuggestions(["zorp"], 0, 4, opts());
    expect(menu, "'zorp' must open a menu in the resumed session").not.toBeNull();
    const zorp = menu!.items.find((i) => i.value === "Zorp");
    expect(
      zorp,
      "bare 'Zorp' missing from the 'zorp' menu — the BUG-005 constituent-suppression exemption regressed",
    ).toBeDefined();
    expect(
      zorp!.description,
      "bare word must carry word-provenance ('session xN'), not chain markers",
    ).toMatch(/^session x\d+$/);
    expect(chain.state(), "suggestions alone must never arm the chain").toBeNull();
  });

  it("§09 M2 item 7 post-restore: bare-word accept arms 'zorp' → Zephra → Noria → Inverter", async () => {
    const current = editingCurrent(); // pi-shaped persistent buffer
    const chain = createChainMachine();
    const provider = createHapaxProvider(store, cfg(), current, chain);

    // Hop 0 — accept the BARE word from a live menu, in the SAME query
    // cycle (liveKeyByValue rebuilds on every query). The provider's real
    // applyCompletion arms the chain as a side effect (P1.M4.T2.S2).
    const menu = await provider.getSuggestions(["zorp"], 0, 4, opts());
    const zorp = menu!.items.find((i) => i.value === "Zorp")!;
    provider.applyCompletion(["zorp"], 0, 4, zorp, "zorp");
    expect(chain.state(), "hop 0: accepting bare 'Zorp' must arm 'zorp'").toEqual({
      word: "zorp",
    });
    expect(current.state.lines, "hop 0: the editor must have inserted the bare word").toEqual([
      "Zorp",
    ]);

    // Hop 1 — the user types the separating space; the word-start offer
    // (plan 002 redesign) serves topSuccessors('zorp') at prefix ""
    // (zero typed characters of the NEXT word) in candidate display
    // casing (PRD §07; Issue-2 fix).
    current.state.lines = ["Zorp "];
    current.state.cursorCol = 5;
    const offer1 = await provider.getSuggestions(
      current.state.lines,
      0,
      current.state.cursorCol,
      opts(),
    );
    expect(offer1!.prefix, "hop 1: word-start offer must answer with zero typed chars").toBe("");
    expect(offer1!.items.map((i) => i.label), "hop 1: 'zorp' successors (count-desc)").toEqual([
      "Zephra", // 2026-09: turbine (q26) table-rejects — sole successor
    ]);
    provider.applyCompletion(
      current.state.lines,
      0,
      current.state.cursorCol,
      offer1!.items[0]!,
      offer1!.prefix,
    );
    expect(chain.state(), "hop 1: Tab-accepting 'Zephra' must re-arm to it").toEqual({
      word: "zephra",
    });
    expect(current.state.lines, "hop 1: buffer after accepting 'Zephra'").toEqual([
      "Zorp Zephra",
    ]);

    // Hop 2 — space again, then 'Noria' offered as zephra's successor
    // and accepted.
    current.state.lines = ["Zorp Zephra "];
    current.state.cursorCol = 12;
    const offer2 = await provider.getSuggestions(
      current.state.lines,
      0,
      current.state.cursorCol,
      opts(),
    );
    expect(offer2!.prefix).toBe("");
    expect(offer2!.items.map((i) => i.label), "hop 2: 'zephra' successors").toEqual(["Noria"]);
    provider.applyCompletion(
      current.state.lines,
      0,
      current.state.cursorCol,
      offer2!.items[0]!,
      offer2!.prefix,
    );
    expect(chain.state(), "hop 2: Tab-accepting 'Noria' must re-arm to it").toEqual({
      word: "noria",
    });
    expect(current.state.lines).toEqual(["Zorp Zephra Noria"]);

    // Hop 3 — space again, then 'Inverter' offered as noria's
    // successor: the exact link the original bug hunt found dead in
    // resumed sessions (BUG-005).
    current.state.lines = ["Zorp Zephra Noria "];
    current.state.cursorCol = 18;
    const offer3 = await provider.getSuggestions(
      current.state.lines,
      0,
      current.state.cursorCol,
      opts(),
    );
    expect(offer3!.prefix).toBe("");
    expect(offer3!.items.map((i) => i.label), "hop 3: 'noria' successors").toEqual([
      "Inverter",
    ]);
    provider.applyCompletion(
      current.state.lines,
      0,
      current.state.cursorCol,
      offer3!.items[0]!,
      offer3!.prefix,
    );
    expect(chain.state(), "hop 3: Tab-accepting 'Inverter' must re-arm to it").toEqual({
      word: "inverter",
    });
    expect(current.state.lines).toEqual(["Zorp Zephra Noria Inverter"]);
  });
});