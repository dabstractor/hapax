/**
 * /acwords debug command suite (PRD §08 h2.48, P1.M3.T4.S1): the pure
 * formatter — top-50 salience ordering with deterministic byte-lex tie
 * breaks, store size/cap/ordinal line, rank-group histogram, ingest
 * stats with all six gate counts, display casing and ×N counts, and
 * words/counters-only output — plus the registration guard (command
 * registered only when config.debug, notify level "info"). Uses a real
 * CandidateStore; the pipeline and pi surfaces are structural stubs.
 */

import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PHRASE_CAP, STORE_CAP, CandidateStore } from "../src/core/store.js";
import type { IngestStats, Sighting } from "../src/core/types.js";
import { formatAcwordsDump, registerAcwordsCommand } from "../src/pi/debug.js";

// --- fixtures ----------------------------------------------------------------

/** Upsert one sighting (its own fresh ordinal unless overridden). */
function see(
  store: CandidateStore,
  key: string,
  display = key,
  extra: Partial<Sighting> = {},
): void {
  const sighting: Sighting = {
    key,
    display,
    ordinal: store.nextOrdinal(),
    fromUser: false,
    properName: false,
    rankGroup: 0,
    isSubword: false,
    ...extra,
  };
  store.upsert(sighting);
}

/** IngestStats literal with every gate key non-zero and distinct, so a
 *  rendering bug swaps/mislabels counts visibly. */
const fakeStats: IngestStats = {
  wordsSeen: 5432,
  admitted: 1234,
  rejectedByGate: {
    tooShort: 11,
    tooLong: 22,
    lowEntropy: 33,
    unigramRun: 44,
    secret: 55,
    consonantRun: 66,
  },
};

const statsStub = (): { getStats: () => IngestStats } => ({
  getStats: () => fakeStats,
});

/** Minimal fake pi: only registerCommand is observable here. */
function fakePi(): { pi: ExtensionAPI; register: ReturnType<typeof vi.fn> } {
  const register = vi.fn();
  return { pi: { registerCommand: register } as unknown as ExtensionAPI, register };
}

/** The numbered top-N rows of a dump (lines between the header and the
 *  blank line before the stats section). */
function topRows(dump: string): string[] {
  const lines = dump.split("\n");
  const start = lines.findIndex((l) => l.includes("top 50 by salience"));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.trim() === "");
  return rest.slice(0, end === -1 ? undefined : end);
}

// --- formatAcwordsDump --------------------------------------------------------

describe("acwords dump (PRD §08)", () => {
  it("renders store size, cap denominator, and current ordinal", () => {
    const store = new CandidateStore();
    see(store, "zendesk");
    see(store, "nrel", "NREL");
    const dump = formatAcwordsDump(store, fakeStats);

    expect(dump).toContain("hapax candidate store");
    expect(dump).toContain(`size: 2 / ${STORE_CAP}`);
    expect(dump).toContain("(ordinal 2)");
  });

  it("renders the rank-group histogram with all three groups", () => {
    const store = new CandidateStore();
    const ord = store.nextOrdinal();
    see(store, "rareword", "rareword", { ordinal: ord, rankGroup: 0 });
    see(store, "midword", "midword", { ordinal: ord, rankGroup: 1 });
    see(store, "commonword", "commonword", { ordinal: ord, rankGroup: 2 });
    const dump = formatAcwordsDump(store, fakeStats);

    expect(dump).toContain("rank groups: rare=1 mid=1 common=1");
  });

  it("orders top rows by salience descending (frequency within one ordinal)", () => {
    const store = new CandidateStore();
    const ord = store.nextOrdinal(); // same recency for both → count decides
    for (let i = 0; i < 5; i++) see(store, "often", "often", { ordinal: ord });
    see(store, "once", "once", { ordinal: ord });
    const rows = topRows(formatAcwordsDump(store, fakeStats));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("often");
    expect(rows[1]).toContain("once");
  });

  it("breaks salience ties by byte-lexicographic key for determinism", () => {
    const store = new CandidateStore();
    const ord = store.nextOrdinal(); // identical stats → exact tie
    see(store, "zeta", "zeta", { ordinal: ord });
    see(store, "alpha", "alpha", { ordinal: ord });
    const rows = topRows(formatAcwordsDump(store, fakeStats));

    expect(rows[0]).toContain("alpha");
    expect(rows[1]).toContain("zeta");
    // Determinism: a second identical dump is byte-identical.
    const second = formatAcwordsDump(store, fakeStats);
    expect(second).toBe(formatAcwordsDump(store, fakeStats));
  });

  it("caps output at exactly 50 rows when the store holds more", () => {
    const store = new CandidateStore();
    const ord = store.nextOrdinal(); // all ties → pure byte order
    for (let i = 0; i < 60; i++) {
      const key = `w${String(i).padStart(2, "0")}`;
      see(store, key, key, { ordinal: ord });
    }
    const rows = topRows(formatAcwordsDump(store, fakeStats));

    expect(store.size).toBe(60);
    expect(rows).toHaveLength(50);
    expect(rows[0]).toContain("w00");
    expect(rows[49]).toContain("w49");
    expect(dumpHasRow(formatAcwordsDump(store, fakeStats), "w50")).toBe(false);
  });

  it("lists every entry (no padding) when the store holds fewer than 50", () => {
    const store = new CandidateStore();
    const ord = store.nextOrdinal(); // same recency → key-order tie
    see(store, "zendesk", "zendesk", { ordinal: ord });
    see(store, "nrel", "NREL", { ordinal: ord });
    const rows = topRows(formatAcwordsDump(store, fakeStats));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("1. NREL");
    expect(rows[1]).toContain("2. zendesk");
  });

  it("shows the most recent display casing and ×N session counts", () => {
    const store = new CandidateStore();
    const ord = store.nextOrdinal();
    see(store, "nrel", "nrel", { ordinal: ord });
    see(store, "nrel", "NREL", { ordinal: ord }); // most recent casing wins
    const rows = topRows(formatAcwordsDump(store, fakeStats));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("NREL");
    expect(rows[0]).not.toMatch(/(^|\s)nrel/); // lowercase form is gone
    expect(rows[0]).toContain("×2");
    expect(rows[0]).toContain("group 0 (rare)");
  });

  it("renders wordsSeen, admitted, and all six gate-rejection counts", () => {
    const store = new CandidateStore();
    see(store, "zendesk");
    const dump = formatAcwordsDump(store, fakeStats);

    expect(dump).toContain("ingest stats");
    expect(dump).toContain("words seen: 5432   admitted: 1234");
    expect(dump).toContain(
      "gate rejections: tooShort=11 tooLong=22 lowEntropy=33 " +
        "unigramRun=44 secret=55 consonantRun=66",
    );
  });

  it("never contains words absent from the store snapshot (words only)", () => {
    const populated = new CandidateStore();
    see(populated, "nrel", "NREL");
    expect(formatAcwordsDump(populated, fakeStats)).toContain("NREL");

    const empty = new CandidateStore(); // different store, same stats fixture
    const emptyDump = formatAcwordsDump(empty, fakeStats);
    expect(emptyDump).not.toContain("NREL");
    expect(emptyDump).toContain(`size: 0 / ${STORE_CAP}`);
    expect(topRows(emptyDump)).toHaveLength(0);
  });
});

/** True when some top row mentions the given text. */
function dumpHasRow(dump: string, text: string): boolean {
  return topRows(dump).some((row) => row.includes(text));
}

// --- registerAcwordsCommand ----------------------------------------------------

describe("acwords registration (PRD §08)", () => {
  it("registers nothing when config.debug is false", () => {
    const store = new CandidateStore();
    const { pi, register } = fakePi();
    registerAcwordsCommand(pi, {
      store,
      pipeline: statsStub(),
      config: { debug: false },
    });

    expect(register).not.toHaveBeenCalled();
  });

  it('registers "acwords" once when debug is true; handler notifies the dump at "info"', async () => {
    const store = new CandidateStore();
    const ord = store.nextOrdinal();
    see(store, "zendesk", "zendesk", { ordinal: ord });
    const { pi, register } = fakePi();
    registerAcwordsCommand(pi, {
      store,
      pipeline: statsStub(),
      config: { debug: true },
    });

    expect(register).toHaveBeenCalledTimes(1);
    const [name, options] = register.mock.calls[0];
    expect(name).toBe("acwords");
    expect(typeof options.description).toBe("string");

    const notify = vi.fn();
    await options.handler("", { ui: { notify } });
    expect(notify).toHaveBeenCalledTimes(1);
    const [message, level] = notify.mock.calls[0];
    expect(level).toBe("info");
    expect(typeof message).toBe("string");
    expect(message).toContain(`size: 1 / ${STORE_CAP}`);
    expect(message).toContain("zendesk");
    expect(message).toContain("words seen: 5432   admitted: 1234");
    expect(message).toContain("gate rejections:");
  });

  it("handler renders a fresh snapshot per invocation (ordinal advances)", async () => {
    const store = new CandidateStore();
    const { pi, register } = fakePi();
    registerAcwordsCommand(pi, {
      store,
      pipeline: statsStub(),
      config: { debug: true },
    });
    const options = register.mock.calls[0][1];

    const first = vi.fn();
    await options.handler("", { ui: { notify: first } });
    expect(first.mock.calls[0][0]).toContain("(ordinal 0)");

    see(store, "zendesk"); // later activity — ordinal 1 now
    const second = vi.fn();
    await options.handler("", { ui: { notify: second } });
    expect(second.mock.calls[0][0]).toContain("(ordinal 1)");
    expect(second.mock.calls[0][0]).toContain("zendesk");
  });
});
// --- phrases / successor sample section (P2.M2.T3.S1, PRD §08 h2.48) -----

/** All lines of the dump's trailing "hapax phrases" section (it is the
 *  LAST section, so slice to the end of the dump). */
function phrasesSectionOf(dump: string): string[] {
  const lines = dump.split("\n");
  const start = lines.findIndex((l) => l === "hapax phrases");
  return lines.slice(start);
}

describe("acwords dump — phrases + successor sample (P2.M2.T3.S1)", () => {
  it("populated store: count vs cap, top-10 by phrase salience, (repeat) markers, successor sample", () => {
    const store = new CandidateStore();
    // Word candidates first: phrase salience sums their word saliences,
    // and the display casings come from the word store (h2.27).
    const ord = 1;
    for (const [key, display] of [
      ["national", "National"],
      ["renewable", "Renewable"],
      ["energy", "Energy"],
      ["laboratory", "Laboratory"],
    ] as const) {
      for (let r = 0; r < 3; r++) see(store, key, display, { ordinal: ord });
    }
    // Three verbatim windows of the 4-gram → 3 bigrams + 2 trigrams ×3,
    // plus one count-1 bigram (golden colorado — rare+constituents would
    // fast-path admit; the dump lists the stored map either way).
    for (let r = 0; r < 3; r++) {
      store.recordPhraseLines([["national", "renewable", "energy", "laboratory"]], ord);
    }
    store.recordPhraseLines([["golden", "colorado"]], ord);

    const dump = formatAcwordsDump(store, fakeStats);
    expect(dump).toContain("hapax phrases");
    expect(dump).toContain(`phrases: 6   (cap ${PHRASE_CAP})`);

    const section = phrasesSectionOf(dump);
    // Deterministic order: trigrams (3 constituents) before bigrams (2),
    // byte-lex within equal salience; count-1 phrase last (no bonus).
    expect(section.slice(2, 9)).toEqual([
      "  top 10 by salience:",
      "    1. National Renewable Energy  ×3  (repeat)",
      "    2. Renewable Energy Laboratory  ×3  (repeat)",
      "    3. Energy Laboratory  ×3  (repeat)",
      "    4. National Renewable  ×3  (repeat)",
      "    5. Renewable Energy  ×3  (repeat)",
      "    6. golden colorado  ×1",
    ]);
    // Successor sample: top successors of the TOP phrase's first word,
    // count-descending — the PRD §09 tuning signal for the chain machine.
    expect(section[9]).toBe("  successor sample (top successors of the top word):");
    expect(section[10]).toBe("    national → renewable ×3");
  });

  it("caps the phrase rows at exactly 10", () => {
    const store = new CandidateStore();
    for (let i = 0; i < 12; i++) {
      store.recordPhraseLines([[`p${String(i).padStart(2, "0")}`, `q${String(i).padStart(2, "0")}`]], 1);
    }
    const section = phrasesSectionOf(formatAcwordsDump(store, fakeStats));
    expect(section[2]).toBe("  top 10 by salience:");
    expect(section[3]).toContain("1. p00 q00");
    expect(section[12]).toContain("10. p09 q09");
    expect(formatAcwordsDump(store, fakeStats)).not.toContain("p10");
  });

  it("empty store renders (none) and omits the successor sample", () => {
    const dump = formatAcwordsDump(new CandidateStore(), fakeStats);
    expect(dump).toContain("hapax phrases");
    expect(dump).toContain("  phrases: (none)");
    expect(dump).not.toContain("successor sample");
    expect(dump).not.toContain("top 10 by salience:");
  });

  it("phrases-disabled renders identically to empty — capture never ran", () => {
    // `enablePhrases: false` leaves the capture hook unwired (index.ts),
    // so a disabled session's store IS an empty-phrase store; the section
    // must not distinguish the two.
    const disabled = formatAcwordsDump(new CandidateStore(), fakeStats);
    const empty = formatAcwordsDump(new CandidateStore(), fakeStats);
    expect(disabled).toBe(empty);
    expect(phrasesSectionOf(disabled)).toEqual(["hapax phrases", "  phrases: (none)"]);
  });
});
