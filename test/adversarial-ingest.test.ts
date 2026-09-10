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

// --- Probe C synthetic-token battery keys (BUG-003, PRD h3.2). Every vector
// --- was empirically run through the pre-fix pipeline (maskSecrets →
// --- tokenize → expandCandidates → passesShape → store) before these
// --- assertions were locked; the fragments each vector actually emitted
// --- define the shapeGate fixes, the rest pin S1 (bare-run floor 32) + S2
// --- (parent-secret propagation) behavior.

/** PRD h3.2 exact repro: the classic 38-char AWS secret access key WITHOUT
 *  its slashes. At BARE_RUN_MIN = 32 the bare-run catch-all (layer 1) masks
 *  it whole — pinned here, no new rule needed. */
const AWS_38_NOSLASH = "wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY";

/** npm publish token, LONG form: 'npm_' + 36 alnum. Layer 1 masks the ≥32
 *  payload run, but the 'npm_' remainder still tokenizes (a 4-char token:
 *  entropy 2.0 bits/char) — pre-fix it was STORED and ranked under the
 *  'npm_' query. Closed by the 'npm_' SECRET_PREFIXES entry. */
const NPM_LONG = "npm_" + "aA0bB1cC2dD3eE4fF5gG6hH7iI8jJ9kK2mM3";

/** npm token, SHORT form: 'npm_' + 22-char mixed-case no-digit payload with
 *  every camelCase sub-word ≥ 4 vowel-bearing chars. Pre-fix the whole
 *  token AND its sub-words admitted — zero digits means rules 6/7 never
 *  fire, which is exactly the gap the 'npm_' SECRET_PREFIXES entry closes
 *  (S2 then poisons the sub-words). */
const NPM_SHORT = "npm_XoremuFapikDolamYsunet";

/** GitLab PAT, the REAL hyphen format: 'glpat-' + 22-char mixed-case
 *  no-digit payload. Tokenization splits at the hyphen, so NO token-level
 *  prefix can ever see 'glpat-…' whole — pre-fix 'glpat' itself stored and
 *  the payload token plus its sub-words admitted. Closed by the glpat- mask
 *  regex (SECRET_WINDOW_RES with its index-aligned "glpat-" anchor). */
const GLPAT_HYPHEN = "glpat-QaleviSorekTumibYrenod";

/** Stripe-style live secret key: 'sk_live_' + 22-char payload. NO new rule —
 *  the existing 'sk_' prefix already matches via startsWith, and S2's
 *  parent-secret propagation poisons the payload sub-words. Battery pins
 *  both; adding a redundant 'sk_live' entry is an anti-pattern. */
const SK_LIVE = "sk_live_MiwokaZeltaPurinVoseka";

/** Bearer authorization payload: <32-char mixed-case no-digit — the
 *  documented RESIDUAL class ('bearer' is prose; a prefix rule on it would
 *  reject every auth discussion). Sized so every case-boundary sub-word is
 *  < 4 chars (below MIN_LENGTH) and the whole token is consonant-run
 *  repelled — nothing from it may be stored or ranked. The general
 *  vowel-bearing <32 payload after a prose word stays theoretically leaky:
 *  owner-accepted residual, documented in shapeGate's isSecretShaped JSDoc. */
const BEARER_PAYLOAD = "QmXvRtYpLwZkJhGfDsAa";

/** The alphabet-run synthetic behind PRD h3.2's documented fragments
 *  ('abcdefghijklmnopqrstuvwxy' / 'yz0123456789' / 'zabc'): 40 chars, fully
 *  masked by the bare-run catch-all (layer 1). */
const ALPHA_RUN = "abcdefghijklmnopqrstuvwxyz0123456789zabc";

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
    await pipeline.processText(`aws secret: ${AWS_SECRET}\nslack: ${SLACK}\nturbine notes turbinez`, true);
    await pipeline.processText(`token: ${JWT} ok`, true);
    await pipeline.processText(`token: ${JWT_DOZJG} ok`, true);
    await pipeline.processText(`key: ${OPENAI} ok`, true);
    await pipeline.processText(`id ${AWS_ID} google ${GOOGLE} done`, true);
    // Positive control rides the SAME store: a rare prose word from these
    // messages must admit, so the no-leak assertions can never pass
    // vacuously against a dead store.
    await pipeline.processText("a zephra drifted over the vestibule", true);
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

  it("positive control: the rare prose word 'zephra' from the same messages admits", () => {
    expect(rankMatches(store, "zeph").map((m) => m.key)).toContain("zephra");
  });

  it("masking is surgical: ordinary prose words of the repro message still admit", () => {
    // 2026-09 retighten: "turbine" (q=26) now REJECTS at admission too —
    // the masking-surgical control needs an admitted prose word, so the
    // repro corpus carries "turbinez" (dictionary-absent). "secret"
    // (q=108), "slack" (q=51), and now "turbine" are all admission
    // deaths; "aws" is gate-tooShort — unmasked gate deaths, never
    // masking damage (shipped-dict facts per test/mask-secrets.test.ts).
    expect(rankMatches(store, "tur").map((m) => m.key)).toContain("turbinez");
  });
});

// --- Probe C: synthetic-token paste battery (BUG-003, PRD h3.2) --------------

describe("Probe C — synthetic-token paste battery (BUG-003, PRD h3.2)", () => {
  let store: CandidateStore;

  beforeAll(async () => {
    const pipeline = makePipeline((store = new CandidateStore()));
    await pipeline.processText(`aws key: ${AWS_38_NOSLASH} end`, true);
    await pipeline.processText(`npm long: ${NPM_LONG} end`, true);
    await pipeline.processText(`npm short: ${NPM_SHORT} end`, true);
    await pipeline.processText(`gitlab: ${GLPAT_HYPHEN} end`, true);
    await pipeline.processText(`stripe: ${SK_LIVE} end`, true);
    await pipeline.processText(`auth: Bearer ${BEARER_PAYLOAD} end bearerz`, true);
    await pipeline.processText(`synthetic: ${ALPHA_RUN} end`, true);
    // Positive control rides the SAME store (Probe A convention): rare prose
    // words from these very messages must admit, so the no-leak assertions
    // can never pass vacuously against a dead store.
    await pipeline.processText("a zephra drifted over the vestibule", true);
  });

  // Each row: [fragment, provenance]. The PRD-documented leaks plus every
  // battery token's plausible sub-word pieces (camelCase/case-boundary
  // splits ≥ 4 chars, lowercased — derived from the constants above).
  const FRAGMENTS: [string, string][] = [
    // PRD h3.2 documented fragments (the alphabet-run synthetic's leaks)
    ["abcdefghijklmnopqrstuvwxy", "PRD h3.2 documented leak (alphabet run)"],
    ["yz0123456789", "PRD h3.2 documented leak (alphabet run)"],
    ["zabc", "PRD h3.2 documented leak (alphabet run)"],
    // AWS 38-char no-slash key (layer-1 bare-run pin; camelCase pieces)
    ["wjal", "AWS 38-char no-slash key head (layer-1 masked)"],
    ["k7mdeng", "AWS key mid-piece (layer-1 masked)"],
    ["bpxrfi", "AWS key tail-piece (layer-1 masked)"],
    // npm_ tokens ('npm_' prefix rule closes both)
    ["npm_", "bare npm_ remainder token post-masking (pre-fix stored+ranked)"],
    ["a0bb", "npm 36-char payload head (layer-1 masks the ≥32 run)"],
    ["xore", "npm short-payload sub-word Xoremu (pre-fix admitted)"],
    ["fapi", "npm short-payload sub-word Fapik (pre-fix admitted)"],
    ["dola", "npm short-payload sub-word Dolam (pre-fix admitted)"],
    ["ysun", "npm short-payload sub-word Ysunet (pre-fix admitted)"],
    // glpat- token (hyphen split — mask-regex closed)
    ["glpa", "glpat- hyphen-split token (pre-fix stored+ranked)"],
    ["qale", "glpat payload sub-word Qalevi (pre-fix admitted)"],
    ["sore", "glpat payload sub-word Sorek (pre-fix admitted)"],
    ["tumi", "glpat payload sub-word Tumib (pre-fix admitted)"],
    ["yren", "glpat payload sub-word Yrenod (pre-fix admitted)"],
    // sk_live_ (existing 'sk_' prefix + S2 propagation pin — no new rule)
    ["sk_l", "sk_live_ prefix head (existing sk_ rule)"],
    ["miwo", "sk_live payload sub-word Miwoka (S2-poisoned)"],
    ["zelt", "sk_live payload sub-word Zelta (S2-poisoned)"],
    ["puri", "sk_live payload sub-word Purin (S2-poisoned)"],
    ["vose", "sk_live payload sub-word Voseka (S2-poisoned)"],
    // Bearer residual class (sub-words < 4; whole token consonant-run-repelled)
    ["qmxv", "Bearer payload head (documented residual class)"],
  ];

  it.each(FRAGMENTS)("never stores or ranks %s (%s)", (fragment) => {
    expect(
      rankMatches(store, fragment)
        .map((m) => m.key)
        .some((k) => k.includes(fragment)),
    ).toBe(false);
    expect(storedKeys(store).some((k) => k.includes(fragment))).toBe(false);
  });

  it("provider query path: 'abc'/'yz0'/'zabc' prefixes return no fragment-bearing items", () => {
    for (const prefix of ["abc", "yz0", "zabc"]) {
      expect(
        rankMatches(store, prefix).some((m) =>
          ["abcdefghijklmnopqrstuvwxy", "yz0123456789", "zabc"].some((f) =>
            m.key.includes(f),
          ),
        ),
      ).toBe(false);
    }
  });

  it("positive control: the rare prose word 'zephra' from the same messages admits", () => {
    expect(rankMatches(store, "zeph").map((m) => m.key)).toContain("zephra");
  });

  it("positive control: 'bearer' stays prose — the ordinary word itself admits", () => {
    // 'Bearer' must never become a secret prefix: the word lands in the
    // store like any prose word, proving the Bearer line reached ingest
    // while its payload contributed nothing (the residual-class contract).
    // 2026-09 retighten: "bearer" (q=38) rejects at admission — the
    // control word is "bearerz" (absent). The Bearer-line contract
    // (payload contributes nothing) is unchanged; the word-class control
    // just tracks the tighter bands.
    expect(rankMatches(store, "bear").map((m) => m.key)).toContain("bearerz");
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
    // restoreFromHistory.
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
    pipeline.onMessageEnd(userMsg("more common prose here with zephra"));
    await settle(); // > 300 ms: debounce fired and the drain finished

    expect(store.size).toBe(0);
    expect(rankMatches(store, "zeph")).toEqual([]);
    expect(pipeline.getStats().admitted).toBe(0);
    expect(pipeline.getStats().wordsSeen).toBe(0);
    expect(onLoadError).toHaveBeenCalledOnce(); // still exactly once, ever
  });
});
