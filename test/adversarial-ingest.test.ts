/**
 * Adversarial ingest-path e2e probes (P1.M5.T1.S2, bugfix 001_9e0f97150b68).
 *
 * METHODOLOGY — the original 523-green acceptance suite masked six real
 * bugs because its probes used shapes that could never fail: acceptance
 * item 5's fake keys (FAKE_SK is pure hex ≥ 20 → caught by the pure-hex
 * rule; FAKE_GHP keeps its prefix in one token) pass masking by
 * construction, its bad-dict probe never asserted store-emptiness or the
 * live no-op, and no probe ever ran the restore-tail demotion cadence.
 * These three probes re-run the INGEST-PATH shapes from the 8-suite bug
 * hunt that actually FOUND the bugs, against REAL modules: IngestPipeline,
 * CandidateStore, rankMatches, restoreFromHistory, and the SHIPPED
 * dictionary artifact (resolveDictPath — the HAPAX_DICT seam honored).
 * Only the pi session manager is faked (minimal RestoreSessionManager
 * fakes); store, pipeline, dictionary, masking, and ranking are the
 * production code paths. The typing-path probes (prose no-menu, Tab
 * corruption, chain post-restore) deliberately live in the sibling
 * P1.M5.T1.S1 suite (test/adversarial-typing.test.ts) — this file owns
 * the ingest path; the two files are one adversarial suite.
 *
 *   Probe A — realistic secrets   → BUG-003 (PRD §h2.2 / §h3.2): the
 *     PRD's exact repro text (aws secret: wJalr… + the xoxb-… line) plus
 *     the dotted JWT (incl. the bug hunt's 'dozjg…' signature), an
 *     sk-proj-… key, an AKIA id, and an AIza key — every key-derived
 *     probe fragment must rank ZERO candidates, while a rare prose word
 *     from the same messages DOES admit (positive control: no-leak
 *     assertions are vacuous against a dead store).
 *   Probe B — bad-dict restore    → BUG-004 (PRD §03 disable-don't-
 *     degrade): createLazyDictionary on a nonexistent path + a prose
 *     history replayed through restoreFromHistory (fake session manager,
 *     getEntries fallback) must store NOTHING, fire onLoadError EXACTLY
 *     once, and leave the LIVE message_end path a total no-op — the
 *     sticky disable covers live traffic, not just the replay.
 *   Probe C — demotion cadence    → BUG-006 (PRD §h2.3 / §h3.5): a
 *     fast-path all-rare bigram phrase admitted at first sight, then 45
 *     restore-style DIRECT processText calls (which bypass #drainQueue
 *     and its once-per-flush sweep — the exact BUG-006 premise), then
 *     pipeline.sweepPhrases() (the restore-tail sweep): the stale
 *     candidacy is demoted and the bare first word stays offered.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadDictionary } from "../src/core/dictionary.js";
import { rankMatches } from "../src/core/query.js";
import { CandidateStore } from "../src/core/store.js";
import {
  IngestPipeline,
  restoreFromHistory,
  type AgentMessage,
  type RestoreSessionManager,
} from "../src/pi/ingest.js";
import { createLazyDictionary } from "../src/pi/index.js";
import { resolveDictPath } from "../src/pi/paths.js";

// --- BUG-003 probe keys (validated in test/mask-secrets.test.ts; test
// --- files are self-contained, so the constants are copied verbatim) -----

const AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const SLACK = "xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx";
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0." +
  "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const OPENAI = "sk-proj-4t7RX2bQ9wLm3vN8xKpZ6dJh1cA5eFgH0iU";
const AWS_ID = "AKIAIOSFODNN7EXAMPLE";
const GOOGLE = "AIza" + "aA0-_Z9".repeat(5); // AIza + exactly 35

/** The original bug hunt's JWT: identical (validated) header/payload,
 *  signature head 'dozjg' — the exact probe fragment named in the work
 *  item ("JWT signature fragments 'dozjg' etc. are stored", pre-fix). */
const JWT_DOZJG =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0." +
  "dozjgT4fwpMeJf36POk6yJV_adQssw5cSflKxwRJSMeK";

/** First 5 chars of the sk-proj payload — computed, never hard-coded. */
const SK_PROJ_PREFIX = OPENAI.slice("sk-proj-".length, "sk-proj-".length + 5)
  .toLowerCase();

// --- shared helpers ----------------------------------------------------------

/** Real pipeline + shipped dict via the HAPAX_DICT seam — nothing mocked. */
function makePipeline(store: CandidateStore): IngestPipeline {
  return new IngestPipeline({
    store,
    dictionary: loadDictionary(resolveDictPath()),
    yieldFn: async () => {}, // processText is awaited directly
  });
}

/** Longer than the pipeline's 300 ms debounce — for "nothing fires" claims
 *  (the settle() convention from test/index.test.ts:180). */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 420));

/** sortedKeysSnapshot() is stale-until-rebuild by contract — prefixRange
 *  ("") → [0, n] forces the key-index rebuild before reading it. */
function storedKeys(store: CandidateStore): string[] {
  store.prefixRange("");
  return store.sortedKeysSnapshot();
}

// --- Probe A: realistic secrets (BUG-003, PRD §h2.2/h3.2) --------------------

describe("Probe A — realistic secrets never become candidates (BUG-003)", () => {
  let store: CandidateStore;

  beforeAll(async () => {
    const pipeline = makePipeline((store = new CandidateStore()));
    // The PRD's exact repro text, verbatim.
    await pipeline.processText(`aws secret: ${AWS_SECRET}\nslack: ${SLACK}`, true);
    await pipeline.processText(`token: ${JWT} ok`, true);
    await pipeline.processText(`token: ${JWT_DOZJG} ok`, true);
    await pipeline.processText(`key: ${OPENAI} ok`, true);
    await pipeline.processText(`id ${AWS_ID} google ${GOOGLE} done`, true);
    // Positive control rides the SAME store: a rare prose word from these
    // messages must admit, so the no-leak assertions can never pass
    // vacuously against a dead store.
    await pipeline.processText("a zephyr drifted over the vestibule", true);
  });

  const FRAGMENTS: [string, string][] = [
    ["wjal", "AWS secret payload head (the pre-fix 'wjal → wJalrXUtnFEMI' leak)"],
    ["abc", "Slack token tail (the pre-fix 'abc → abcdefghijklmnopqrstuvwx' leak)"],
    ["dozjg", "bug-hunt JWT signature head (pre-fix stored)"],
    [SK_PROJ_PREFIX, "sk-proj payload head (34-char OpenAI-style payload, pre-fix leaked)"],
    ["sflkx", "validated JWT signature head"],
    ["akiai", "AWS key ID prefix"],
    ["aiza", "Google API key prefix"],
    ["xoxb", "Slack token prefix"],
  ];

  it.each(FRAGMENTS)("ranks zero candidates for %s (%s)", (fragment) => {
    expect(rankMatches(store, fragment)).toEqual([]);
  });

  it("no stored candidate key draws bytes from any masked key", () => {
    expect(
      storedKeys(store).some((k) =>
        /wjal|k7mdeng|bpxrfi|xoxb|abcdefghijklmnopqrstuvwx|dozjg|sflkx|4t7rx2|t3blbkfj|akiai|aizas/.test(
          k,
        ),
      ),
    ).toBe(false);
  });

  it("positive control: the rare prose word 'zephyr' from the same messages admits", () => {
    expect(rankMatches(store, "zeph").map((m) => m.key)).toContain("zephyr");
  });

  it("masking is surgical: ordinary prose words of the repro message still admit", () => {
    // "slack" (q=51) admits; "secret" (q=108) is rejected at ADMISSION for
    // commonness and "aws" is gate-tooShort — both unmasked gate deaths,
    // never masking damage (shipped-dict facts per test/mask-secrets.test.ts).
    expect(rankMatches(store, "sl").map((m) => m.key)).toContain("slack");
  });
});

// --- Probe B: bad-dict restore (BUG-004, PRD §03 disable-don't-degrade) ------

/** A path that never exists → loadDictionary throws ENOENT on the first
 *  lookup; the lazy wrapper flips `failed` sticky and notifies once (the
 *  exact idiom from test/bad-dict-gate.test.ts). */
const MISSING_DICT = "/nonexistent/common-en.bin";

// Minimal valid pi message constructors (copied from
// test/ingest-restore.test.ts; test files are self-contained).

type UserMessage = Extract<AgentMessage, { role: "user" }>;
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;

const userMsg = (content: UserMessage["content"]): UserMessage => ({
  role: "user",
  content,
  timestamp: 0,
});

const assistantMsg = (content: AssistantMessage["content"]): AssistantMessage => ({
  role: "assistant",
  content,
  api: "anthropic-messages",
  provider: "anthropic",
  model: "test-model",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 0,
});

const text = (s: string) => ({ type: "text", text: s }) as const;

const msgEntry = (
  id: string,
  parentId: string | null,
  message: AgentMessage,
): SessionEntry => ({
  type: "message",
  id,
  parentId,
  timestamp: "2025-01-01T00:00:00.000Z",
  message,
});

/** Minimal RestoreSessionManager fake: empty branch → the getEntries()
 *  fallback is exercised (the only session boundary that is faked). */
const fakeSm = (entries: SessionEntry[]): RestoreSessionManager => ({
  getBranch: vi.fn((): SessionEntry[] => []),
  getEntries: vi.fn(() => entries),
});

describe("Probe B — bad-dict restore is a total no-op (BUG-004)", () => {
  it("restore replay stores nothing and notifies once; the LIVE path stays dead afterwards", async () => {
    const onLoadError = vi.fn();
    const dict = createLazyDictionary(MISSING_DICT, onLoadError);
    const store = new CandidateStore();
    const pipeline = new IngestPipeline({
      store,
      dictionary: dict,
      // CLOSURE over the live flag — it flips at the first failed load and
      // must be re-read on every gate check, never passed by value.
      isDisabled: () => dict.failed === true,
      yieldFn: async () => {},
    });
    const processTextSpy = vi.spyOn(pipeline, "processText");

    // Observe the failure BEFORE the replay (the factory's real session
    // -start timing: the dictionary died before history replays). The very
    // first lookup triggers the failed load; the replay then starts with
    // the sticky disable already true, so the store stays byte-empty.
    expect(dict.lookup("warmup")).toBeNull();
    expect(dict.failed).toBe(true);

    // BUG-004 repro history: ordinary prose (the "whole history ingested
    // as ultra-rare candidates" vocabulary), replayed through the REAL
    // restoreFromHistory — two-arg, so the real sweepPhrases rides along
    // (a harmless no-op on the empty store and empty hook).
    const entries = [
      msgEntry("m1", null, userMsg("with that and have the session notes")),
      msgEntry("m2", "m1", assistantMsg([text("with more accumulated prose right there")])),
      msgEntry("m3", "m2", userMsg("with another go at the ordinary thing")),
    ];
    restoreFromHistory(pipeline, fakeSm(entries));

    // Deterministic completion probe (restoreFromHistory is fire-and-
    // forget): every message went through processText — each an instant
    // no-op at the top gate — then the settle() belt-and-suspenders waits
    // out any straggler macrotask.
    await vi.waitFor(() => expect(processTextSpy).toHaveBeenCalledTimes(3));
    await settle();

    expect(store.size).toBe(0); // the exact BUG-004 assertion
    expect(rankMatches(store, "with")).toEqual([]); // exact BUG-004 probe word
    expect(onLoadError).toHaveBeenCalledOnce(); // notify-once, never retried

    // The sticky disable must cover the LIVE path too: a real message_end
    // after the failure enqueues, the debounce fires, the drain runs —
    // and the top gate stops it before a single word is seen.
    pipeline.onMessageEnd(userMsg("more common prose here with zephyr"));
    await settle(); // > 300 ms: debounce fired and the drain finished

    expect(store.size).toBe(0);
    expect(rankMatches(store, "zeph")).toEqual([]);
    expect(pipeline.getStats().admitted).toBe(0);
    expect(pipeline.getStats().wordsSeen).toBe(0);
    expect(onLoadError).toHaveBeenCalledOnce(); // still exactly once, ever
  });
});

// --- Probe C: demotion cadence (BUG-006, PRD §h2.3/h3.5) ---------------------

describe("Probe C — 45-ordinal demotion cadence after restore-style ingestion (BUG-006)", () => {
  /** Real pipeline + shipped dict + real store with the phrase hooks wired
   *  exactly like the factory (src/pi/index.ts session_start). The demotion
   *  log makes each sweepPhrases() observable (count of phrases demoted). */
  function makePhraseHarness(): {
    pipeline: IngestPipeline;
    store: CandidateStore;
    dict: ReturnType<typeof loadDictionary>;
    demotedLog: number[];
  } {
    const store = new CandidateStore();
    const dict = loadDictionary(resolveDictPath());
    const demotedLog: number[] = [];
    const pipeline = new IngestPipeline({
      store,
      dictionary: dict,
      yieldFn: async () => {},
      onAdmittedTokens: (lines) =>
        store.recordPhraseLines(lines, store.currentOrdinal()),
      onSweepPhrases: () => {
        demotedLog.push(store.sweepPhraseDemotions());
      },
    });
    return { pipeline, store, dict, demotedLog };
  }

  const PHRASE = "zorblat quuxified"; // both dictionary-absent (asserted below)
  const PHRASE_PREFIX = "zorbl";
  const FIRST_WORD = "zorblat";
  const FIRST_WORD_PREFIX = "zorb";
  const FILLER = (n: number) => `filler prose message number ${n}`;

  it("fast-path phrase goes stale over 45 direct calls; the sweep demotes it; the first word stays offered", async () => {
    const { pipeline, store, dict, demotedLog } = makePhraseHarness();

    // Measured premise (never assumed): both constituents are dictionary-
    // absent → both admit rankGroup 0 → the bigram is fast-path eligible.
    expect(dict.lookup("zorblat")).toBeNull();
    expect(dict.lookup("quuxified")).toBeNull();

    // 1) Fast-path admission at first sight (PRD §06 h3.7): one message,
    //    one ordinal, both words admitted, the line's bigram admits with
    //    count 1 through the real onAdmittedTokens wiring.
    await pipeline.processText(PHRASE, true);
    expect(store.isFastPathPhrase(PHRASE)).toBe(true);
    expect(store.phraseCandidateKeys()).toContain(PHRASE);
    const before = rankMatches(store, PHRASE_PREFIX).map((m) => m.key);
    expect(before).toContain(PHRASE); // the phrase is offered — the 'before'
    // The bare first word co-presents pre-sweep: a fast-path bigram arms
    // its first word's successor index (recordPhraseLines → #bumpSuccessor),
    // and successor-bearing words are exempt from constituent suppression
    // (BUG-005, PRD §07 h2.43) — pin that mechanism explicitly.
    expect(store.topSuccessors(FIRST_WORD).length).toBeGreaterThan(0);
    expect(before).toContain(FIRST_WORD);

    // 2) 45 restore-style DIRECT processText calls — no queue, no drain,
    //    and therefore no once-per-flush demotion sweep (the exact BUG-006
    //    premise: restore replays bypass #drainQueue). 45 messages =
    //    ordinals 2..46; each call is one awaited ordinal.
    for (let n = 1; n <= 45; n++) {
      await pipeline.processText(FILLER(n), true);
    }
    expect(store.currentOrdinal()).toBe(46); // 1 + 45: 45 − 1st-seen 1 = 45 ≥ 40
    expect(demotedLog).toHaveLength(0); // no flush ran → no sweep ever fired
    // The stale-survival bug, pinned verbatim: WITHOUT a sweep the
    // fast-path candidacy survives 45 subsequent ordinals.
    expect(store.isFastPathPhrase(PHRASE)).toBe(true);
    expect(store.phraseCandidateKeys()).toContain(PHRASE);

    // 3) The fix's public seam, invoked exactly as restoreFromHistory's
    //    tail sweep (count < 2, not sticky, ≥ 40 subsequent ordinals).
    pipeline.sweepPhrases();

    // 4) Demoted: candidacy + fast-path provenance gone from the offer
    //    path; counts/ordinals kept for a later repetition-path re-admit.
    expect(demotedLog[0]).toBeGreaterThanOrEqual(1);
    expect(store.phraseCandidateKeys()).not.toContain(PHRASE);
    expect(store.isFastPathPhrase(PHRASE)).toBe(false);
    expect(store.getPhrase(PHRASE)).toBeDefined();
    const after = rankMatches(store, PHRASE_PREFIX).map((m) => m.key);
    expect(after).not.toContain(PHRASE); // the demoted phrase is never offered
    expect(after).toContain(FIRST_WORD); // the bare first word stays offered
    const afterWord = rankMatches(store, FIRST_WORD_PREFIX).map((m) => m.key);
    expect(afterWord).toContain(FIRST_WORD);

    // 5) Idempotent: a second consecutive sweep finds nothing left to
    //    demote and changes nothing about the offers.
    pipeline.sweepPhrases();
    expect(demotedLog[1]).toBe(0);
    expect(rankMatches(store, PHRASE_PREFIX).map((m) => m.key)).toEqual(after);
    expect(rankMatches(store, FIRST_WORD_PREFIX).map((m) => m.key)).toEqual(
      afterWord,
    );
  });
});