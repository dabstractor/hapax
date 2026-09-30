/**
 * BUG-001 e2e no-menu gate (bugfix 001_9e0f97150b68) — the full-pipeline
 * twin of test/shipped-dict.test.ts's calibration block.
 *
 * BUG-001: the original, uncalibrated band constants made common-word
 * rejection mathematically unreachable against the shipped artifact (the
 * old artifact scored the=103, with=71), so typing "with"/"this"/"them"
 * during ordinary prose popped hapax menus — a direct violation of the
 * #1 UX invariant (§01/§07: never trigger a menu for common words). The
 * scripted acceptance item 2 MASKED this failure because all of its probe
 * words were ≤3 chars: the shape gate's 4-char minimum rejects those by
 * length, so the probes never reached the dictionary band at all. A gate
 * that cannot see the failure is worse than no gate.
 *
 * This suite closes the hole end-to-end: prose.jsonl is replayed through
 * a REAL IngestPipeline with the SHIPPED dictionary (no mocks, no
 * synthetic binaries — the same wiring as acceptance.test.ts's
 * ingestFixture), then common words must DELEGATE: the provider returns
 * the delegate's result (exact sentinel identity) and __hapaxLive()
 * stays null — never a hapax menu. P1.M5.T1.S1's typing-path probes
 * build on this gate; import COMMON_PROBES from here rather than
 * re-listing the words.
 *
 * Band constants are IMPORTED from src/core/score.ts — never hard-coded —
 * so a retune keeps these gates meaningful (they assert band membership
 * relative to the live constants) while a regressed artifact or band
 * still fails loudly.
 */

import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi, type Mock } from "vitest";

import { loadDictionary } from "../src/core/dictionary.js";
import { rankMatches } from "../src/core/query.js";
import {
  MID_FREQ_THRESHOLD,
  REJECT_COMMON_THRESHOLD,
  REJECT_LEN_FLOOR,
} from "../src/core/score.js";
import { CandidateStore } from "../src/core/store.js";
import type { Dictionary } from "../src/core/types.js";
import {
  extractText,
  IngestPipeline,
  restoreFromHistory,
  type AgentMessage,
  type RestoreSessionManager,
} from "../src/pi/ingest.js";
import { resolveDictPath } from "../src/pi/paths.js";
import { createHapaxProvider } from "../src/pi/provider.js";
import { DEFAULT_CONFIG, type HapaxConfig } from "../src/pi/config.js";
import {
  asSessionManager,
  messageEntriesOf,
  parseSessionFixture,
} from "./helpers/session-fixture.js";

const PROSE = "test/fixtures/sessions/prose.jsonl";

/**
 * The BUG-001 gate words: ≥4-char top-common English, so every one PASSES
 * the shape gate and rejection can only come from the dictionary band.
 * All measured ≥ REJECT_COMMON_THRESHOLD against the shipped artifact
 * (that=215, with=179, this=197, them=156, have=190, would=156) and all
 * measured zero candidates against the prose-ingested store. Exported
 * for P1.M5.T1.S1's typing-path probes.
 */
export const COMMON_PROBES = ["with", "this", "them", "that", "have", "would"];

// ── local helpers (replicated from acceptance.test.ts on purpose — this
// file stays self-contained so later tasks can lift it whole) ──────────────

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

/** Mock wrapped provider (the delegation target whose result identity the
 *  no-hijack assertions inspect). */
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

describe("BUG-001 e2e — ordinary prose never opens a common-word menu", () => {
  let store: CandidateStore;
  let dict: Dictionary;

  beforeAll(async () => {
    // REAL pipeline + SHIPPED dictionary artifact (resolveDictPath honors
    // the HAPAX_DICT test seam exactly like the acceptance suite).
    dict = loadDictionary(resolveDictPath());
    const entries = parseSessionFixture(PROSE);
    store = new CandidateStore();
    const pipeline = new IngestPipeline({ store, dictionary: dict });
    const total = messageEntriesOf(entries).filter(
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
  }, 60_000);

  it("ingests prose.jsonl into a store that is now EMPTY by design (2026-10 R_eff curve)", () => {
    // Ordinary English prose is no longer completion material. 2026-10
    // semantics: every prose.jsonl word is ≤ 8 chars, so the R_eff ramp
    // (spec/04 h2.26) stays in its floor-hold region for the whole
    // fixture — R=12 rejects all attested words (fences 41, posts 47,
    // garden 86…) exactly as the 2026-09 flat band did; the rest are
    // capitalized-only-at-structural-starts. 9+ char attested words
    // WOULD admit under the ramp, but the fixture contains none — a
    // property pinned by the length test below so this expectation
    // cannot silently rot. The no-menu assertions below are therefore
    // trivially true for the RIGHT reason (nothing admits); the
    // live-menu control elsewhere in this suite uses a direct store
    // upsert, keeping this file non-vacuous.
    expect(store.size).toBe(0);
  });

  it("prose.jsonl contains no ramp-length words (store-empty pin, 2026-10)", () => {
    // The 2026-10 R_eff ramp admits 9+ char attested prose; this fixture
    // deliberately has none (max measured distinct-word length 7), which
    // is why the store-EMPTY expectation above still holds under the
    // curve. If a future fixture edit adds a long word, this pin forces
    // that expectation to be revisited deliberately instead of passing
    // by accident. Cheap string scan over the parsed fixture — the
    // pipeline replay in beforeAll is NOT re-run.
    const entries = parseSessionFixture(PROSE);
    const words = new Set<string>();
    for (const e of entries) {
      if (e.message === undefined) continue;
      const text = extractText(e.message as unknown as AgentMessage);
      if (text === null) continue;
      for (const m of text.matchAll(/[A-Za-z][A-Za-z'-]+/g)) {
        words.add(m[0].toLowerCase());
      }
    }
    expect(words.size, "fixture scan found no words — parsing regressed").toBeGreaterThan(0);
    for (const w of words) {
      expect(
        w.length,
        `fixture word '${w}' is ≥ ramp length — revisit the store-empty expectation`,
      ).toBeLessThanOrEqual(REJECT_LEN_FLOOR);
    }
  });

  it.each(COMMON_PROBES)(
    "common prose word '%s' never opens a hapax menu (delegates)",
    async (w) => {
      // Pure-core half: the band-rejected word is absent from the store,
      // so ranking has nothing to offer.
      expect(rankMatches(store, w), `rankMatches('${w}') must be empty`).toEqual([]);

      // Full-provider half — where BUG-001 was actually visible: the
      // provider must DELEGATE. Exact sentinel identity (toBe, not
      // toEqual) proves the delegate's result came back untouched; a
      // hapax menu would be a fresh { items, prefix } object.
      const current = mockCurrent(SENTINEL);
      const provider = createHapaxProvider(store, cfg(), current);
      const lines = [w];
      const options = opts();
      const result = await provider.getSuggestions(lines, 0, w.length, options);
      expect(result, `typing '${w}' must delegate, not open a menu`).toBe(SENTINEL);
      expect(provider.__hapaxLive(), `'${w}' must leave the live cache empty`).toBeNull();
      expect(current.getSuggestions, `'${w}' must reach the wrapped provider once`).toHaveBeenCalledOnce();
      const args = current.getSuggestions.mock.calls[0]!;
      expect(args[0]).toBe(lines); // same array object — never cloned
      expect(args[1]).toBe(0);
      expect(args[2]).toBe(w.length);
      expect(args[3]).toBe(options); // same options object — signal intact
    },
  );

  it("posts/thin/firs: attested English rejects at the TABLE now (2026-09 retighten; floor hold under the 2026-10 curve), rejected prefixes stay rejected", async () => {
    // posts(47), thin(76), first(144) are all ≥ REJECT(12): admission
    // rejects them before the conjugation guard is even consulted. The
    // dict-band assertions keep documenting where these words sit.
    const postsQ = dict.lookup("posts");
    expect(postsQ, "shipped dict lost 'posts'").not.toBeNull();
    expect(postsQ!).toBeGreaterThanOrEqual(REJECT_COMMON_THRESHOLD); // 2026-09: 47 ≥ 12 — table-rejected
    expect(rankMatches(store, "posts")).toEqual([]);

    const postsCurrent = mockCurrent(SENTINEL);
    const postsProvider = createHapaxProvider(store, cfg(), postsCurrent);
    const menu = await postsProvider.getSuggestions(["posts"], 0, 5, opts());
    expect(menu).toBe(SENTINEL); // delegated — table reject
    expect(postsProvider.__hapaxLive()).toBeNull();

    // 'thin' and 'firs' are top-corpus words (measured q=76 and q=144,
    // both in the REJECT band), so they were rejected at admission and
    // can NEVER appear as items — the PRD permits 'thin'-/'first'-
    // adjacent suggestions only if the words themselves are not
    // rejected, and they are. No other stored prose word starts with
    // 'thin'/'firs', so the fragments have zero candidates → delegation.
    const thinQ = dict.lookup("thin");
    expect(thinQ, "shipped dict lost 'thin' (measured in the REJECT band)").not.toBeNull();
    expect(thinQ!).toBeGreaterThanOrEqual(REJECT_COMMON_THRESHOLD);
    const firstQ = dict.lookup("first");
    expect(firstQ, "shipped dict lost 'first' (measured in the REJECT band)").not.toBeNull();
    expect(firstQ!).toBeGreaterThanOrEqual(REJECT_COMMON_THRESHOLD);
    expect(rankMatches(store, "thin")).toEqual([]);
    expect(rankMatches(store, "firs")).toEqual([]);
    const thinCurrent = mockCurrent(SENTINEL);
    const thinProvider = createHapaxProvider(store, cfg(), thinCurrent);
    const thinResult = await thinProvider.getSuggestions(["thin"], 0, 4, opts());
    expect(thinResult).toBe(SENTINEL); // delegated — no menu at all
    expect(thinProvider.__hapaxLive()).toBeNull();
    const firsCurrent = mockCurrent(SENTINEL);
    const firsProvider = createHapaxProvider(store, cfg(), firsCurrent);
    const firsResult = await firsProvider.getSuggestions(["firs"], 0, 4, opts());
    expect(firsResult).toBe(SENTINEL); // delegated — no menu at all
    expect(firsProvider.__hapaxLive()).toBeNull();
  });

  it("positive control: a directly-stored jargon word opens a real menu (store is alive)", async () => {
    // Guards this file against vacuous no-menu results: the SAME store
    // DOES answer fragments of admitted words through the same provider
    // path. 2026-09 structural-start rule: every capitalized sighting in
    // prose.jsonl is message/sentence-initial ('Fences', 'Apple',
    // 'Rain'…), so relief no longer fires for ANY of them — correct, but
    // it leaves the fixture with zero stored words. The live control is
    // therefore a directly-upserted jargon sighting (the dictionary-
    // absent class the tool actually exists for).
    store.upsert({
      key: "lwlock", display: "lwlock", ordinal: store.currentOrdinal() + 1,
      fromUser: true, properName: false, rankGroup: 0, isSubword: false,
    });
    expect(rankMatches(store, "lwl").map((m) => m.display)).toEqual(["lwlock"]);
    const current = mockCurrent(SENTINEL);
    const provider = createHapaxProvider(store, cfg(), current);
    const result = await provider.getSuggestions(["lwl"], 0, 3, opts());
    expect(result).not.toBe(SENTINEL); // menu, not delegation
    expect(result!.items.map((i) => i.value)).toEqual(["lwlock"]);
    expect(result!.prefix).toBe("lwl");
    expect(provider.__hapaxLive()).not.toBeNull();
  });
});