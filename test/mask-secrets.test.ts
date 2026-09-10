/**
 * BUG-003 (001_9e0f97150b68) — layer 1 of the two-layer secret strategy:
 * maskSecrets() blanks structured secret windows in the RAW segment before
 * tokenization (wired at IngestPipeline.#admitSegment), so multi-segment
 * keys that tokenize would split at / - . can never become candidates.
 * Layer 2 (token-level base64url/entropy residue rules) is P1.M2.T2.S1.
 *
 * Patterns are gitleaks-derived (gitleaks.toml v8.x) and every rule was
 * validated against the bug report's probe keys BEFORE these assertions
 * were written. Validated inventory deviation: the Slack rule's trailing
 * segment is `(?:-[a-zA-Z0-9]+)*`, not `[a-zA-Z0-9]*` — the 24-char secret
 * tail follows a THIRD hyphen, which the original trailing class cannot
 * cross (the PRD probe key leaked its tail under the as-listed pattern).
 *
 * Pipeline block runs the REAL IngestPipeline + shipped dictionary + real
 * store/query — nothing mocked (per test/ingest-pipeline.test.ts
 * conventions; only the inter-slice yield is a no-op since processText is
 * awaited directly). Shipped-dict facts these assertions rely on:
 * "secret" q=108 (rejected as too common at admission), "slack" q=51
 * (admits, group 2), zendesk/lwlock/nrel/f3a9c2e absent (admit, group 0).
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDictionary } from "../src/core/dictionary.js";
import { rankMatches } from "../src/core/query.js";
import { maskSecrets } from "../src/core/shapeGate.js";
import { CandidateStore } from "../src/core/store.js";
import {
  extractText,
  IngestPipeline,
  type AgentMessage,
} from "../src/pi/ingest.js";
import {
  messageEntriesOf,
  parseSessionFixture,
} from "./helpers/session-fixture.js";

// --- BUG-003 probe keys (bug report + deterministic built formats) ----------

const AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const SLACK = "xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx";
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0." +
  "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const OPENAI = "sk-proj-4t7RX2bQ9wLm3vN8xKpZ6dJh1cA5eFgH0iU";
const AWS_ID = "AKIAIOSFODNN7EXAMPLE";
const GOOGLE = "AIza" + "aA0-_Z9".repeat(5); // AIza + exactly 35
const GHP = "ghp_" + "aB3".repeat(12); // ghp_ + exactly 36
const GPAT = "github_pat_" + "aB3_".repeat(9); // github_pat_ + exactly 36
const SK_LEGACY = "sk-" + "a1".repeat(10) + "T3BlbkFJ" + "b2".repeat(10);
const GLPAT = "glpat-" + "aB3".repeat(8); // glpat- + exactly 24 (Probe C, BUG-003 h3.2)

// --- unit block: pure maskSecrets -------------------------------------------

describe("maskSecrets — BUG-003 probe keys (unit)", () => {
  const cases: [string, string][] = [
    ["the AWS secret key", AWS_SECRET],
    ["the Slack key incl. secret tail", SLACK],
    ["the three-segment JWT incl. signature", JWT],
    ["the OpenAI modern key", OPENAI],
    ["the OpenAI legacy key", SK_LEGACY],
    ["the AWS key ID", AWS_ID],
    ["the Google API key", GOOGLE],
    ["the GitHub PAT", GHP],
    ["the GitHub fine-grained PAT", GPAT],
    ["the GitLab PAT (Probe C)", GLPAT],
  ];
  for (const [name, key] of cases) {
    it(`fully masks ${name}, length preserved`, () => {
      const out = maskSecrets(`x ${key} y`);
      expect(out.length).toBe(key.length + 4); // same geometry
      expect(out.startsWith("x ")).toBe(true); // context untouched
      expect(out.endsWith(" y")).toBe(true);
      expect(out.replace(/ /g, "")).toBe("xy"); // span is spaces only
    });
  }

  it("masks the Slack tail across the third hyphen (validated deviation)", () => {
    // The as-listed inventory rule (trailing [a-zA-Z0-9]*) left
    // "-abcdefghijklmnopqrstuvwx" unmasked — the exact BUG-003 'abc' leak.
    const out = maskSecrets(SLACK);
    expect(out).not.toContain("abcdefghijklmnopqrstuvwx");
    expect(out.length).toBe(SLACK.length);
  });

  it("masks a JWT whose signature is short (loose three-segment rule)", () => {
    const short = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123XY";
    // Payload segment is 13 chars — under the strict rule's {17} — so this
    // exercises the LOOSE three-segment rule; the sig still goes with it.
    const out = maskSecrets(`t=${short};`);
    expect(out.length).toBe(short.length + 3);
    expect(out.replace(/ /g, "")).toBe("t=;");
  });
});

describe("maskSecrets — false-positive guards (unit)", () => {
  it("leaves prose, URLs, and fixture vocabulary byte-identical", () => {
    const prose = "The quick brown fox jumps over the lazy dog near our warehouse.";
    const url = "see https://example.com/path/to/thing for details";
    const vocab =
      "we use zendesk and lwlock at NREL; commit f3a9c2e fixed state-of-the-art routing";
    expect(maskSecrets(prose)).toBe(prose);
    expect(maskSecrets(url)).toBe(url);
    expect(maskSecrets(vocab)).toBe(vocab);
    // Probe C (glpat- window): the literal prefix without a ≥20-char
    // payload must stay byte-identical — the regex needs glpat- + 20.
    const glpatProse = "we prefix gitlab tokens with glpat- but never paste one here";
    expect(maskSecrets(glpatProse)).toBe(glpatProse);
  });

  it("returns empty string for empty input", () => {
    expect(maskSecrets("")).toBe("");
  });

  it("masks multiple keys in one segment, keeping ordinary separators", () => {
    const src = `${AWS_ID} and ${SLACK}!`;
    const out = maskSecrets(src);
    expect(out.length).toBe(src.length);
    expect(out.replace(/ /g, "")).toBe("and!");
  });

  it("masks keys at segment start and end boundaries", () => {
    expect(maskSecrets(AWS_SECRET + " tail").trim()).toBe("tail");
    expect(maskSecrets("head " + OPENAI).trim()).toBe("head");
    expect(maskSecrets(SK_LEGACY).trim()).toBe("");
  });
});

// --- pipeline block: real IngestPipeline + shipped dict, no mocks -----------

const SHIPPED = fileURLToPath(new URL("../dict/common-en.bin", import.meta.url));

function makePipeline(): { pipeline: IngestPipeline; store: CandidateStore } {
  const store = new CandidateStore();
  return {
    store,
    pipeline: new IngestPipeline({
      store,
      dictionary: loadDictionary(SHIPPED),
      yieldFn: async () => {}, // processText is awaited directly
    }),
  };
}

/** sortedKeysSnapshot() is stale-until-rebuild by contract (store.ts:
 *  "never rebuilds") — force the key-index rebuild before reading it. */
function storedKeys(store: CandidateStore): string[] {
  store.prefixRange(""); // "" → [0, n]: rebuilds and covers every key
  return store.sortedKeysSnapshot();
}

describe("maskSecrets — ingest pipeline (BUG-003 end-to-end)", () => {
  it("leaks zero candidates from the bug-report message; prose still admits", async () => {
    const { pipeline, store } = makePipeline();
    await pipeline.processText(`aws secret: ${AWS_SECRET}\nslack: ${SLACK}\nturbine notes turbinez`, true); // turbinez: absent control (turbine q26 rejects, 2026-09)

    const keys = storedKeys(store);
    // No candidate key draws bytes from either masked key.
    expect(
      keys.some((k) =>
        /wjal|k7mdeng|bpxrfi|xoxb|abcdefghijklmnopqrstuvwx/.test(k),
      ),
    ).toBe(false);
    // PRD probes: nothing suggestible on key-derived prefixes.
    expect(rankMatches(store, "wjal")).toEqual([]);
    expect(rankMatches(store, "abc")).toEqual([]);
    expect(rankMatches(store, "xoxb")).toEqual([]);
    // Ordinary words flow through UNMASKED: "turbinez" (absent) admits —
    // "turbine" (q=26) itself rejects at the table since the 2026-09
    // retighten; the masking-surgical contract is about unmasked words
    // store holds exactly it — "aws" is gate-tooShort, while "secret"
    // (q=108) and "slack" (q=51; joined the reject band in the 2026-09
    // Issue-1 retune) are rejected at ADMISSION for commonness, i.e. they
    // reached the gate unmasked and died on normal gate decisions, not on
    // masking.
    expect(keys).toEqual(["turbinez"]);
    expect(rankMatches(store, "tur").map((m) => m.key)).toContain("turbinez");
  });

  it("leaks zero candidates from JWT and sk-proj keys", async () => {
    const { pipeline, store } = makePipeline();
    await pipeline.processText(`token: ${JWT} ok`, true);
    await pipeline.processText(`key ${OPENAI} finished`, true);

    const keys = storedKeys(store);
    expect(keys.some((k) => /eyj|sflkx|4t7rx2|t3blbkfj/.test(k))).toBe(false);
    expect(rankMatches(store, "sflkx")).toEqual([]); // JWT signature
    expect(rankMatches(store, "4t7rx2")).toEqual([]); // sk-proj payload head
    expect(rankMatches(store, "eyj")).toEqual([]); // JWT header
  });

  it("still admits the fixture vocabulary (pipeline-level FP guard)", async () => {
    const { pipeline, store } = makePipeline();
    await pipeline.processText("zendesk lwlock NREL f3a9c2e zendesk", true);

    // All four admit (dictionary-absent → group 0); the bare-run catch-all
    // (BARE_RUN_MIN = 32) did NOT eat any of them — every fixture word is
    // far below the floor.
    expect(storedKeys(store)).toEqual([
      "f3a9c2e",
      "lwlock",
      "nrel",
      "zendesk",
    ]);
    expect(rankMatches(store, "ze").map((m) => m.key)).toContain("zendesk");
    expect(rankMatches(store, "lw").map((m) => m.key)).toContain("lwlock");
    expect(
      rankMatches(store, "nr").map((m) => m.display),
    ).toContain("NREL");
    expect(rankMatches(store, "f3a9").map((m) => m.key)).toContain("f3a9c2e");
  });
});

describe("bare-run mask floor 32 (BUG-003 h3.2)", () => {
  /** The 38-char slash-free form of the classic AWS secret access key —
   *  the exact BUG-003 h3.2 leak shape (the /-bearing 40-char variant was
   *  already caught; this one slipped under the old bare-40 floor). */
  const AWS_SECRET_38 = "wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY";

  it("fully masks the 38-char slash-free AWS secret in a sentence (length preserved)", () => {
    expect(AWS_SECRET_38.length).toBe(38); // the leak class this floor targets
    const out = maskSecrets(`password ${AWS_SECRET_38} trailing`);
    expect(out.length).toBe(`password ${AWS_SECRET_38} trailing`.length); // same geometry
    expect(out.startsWith("password ")).toBe(true); // context untouched
    expect(out.endsWith(" trailing")).toBe(true);
    expect(out.replace(/ /g, "")).toBe("passwordtrailing"); // key span → spaces only
  });

  it("pipeline: the 38-char key leaks zero candidates; 'cy' queries nothing (inverted repro)", async () => {
    const { pipeline, store } = makePipeline();
    await pipeline.processText(
      `password ${AWS_SECRET_38} trailing turbine turbinez`,
      true,
    );

    const keys = storedKeys(store);
    // No candidate key draws bytes from the masked key (pre-fix the
    // camelCase split admitted jalr/femik7/mden/cyexamplekey fragments).
    expect(
      keys.some((k) => /jalr|femik|mden|cyexample|wjalrxu/.test(k)),
    ).toBe(false);
    expect(rankMatches(store, "cy")).toEqual([]); // THE bug-report repro
    expect(rankMatches(store, "wjal")).toEqual([]);
    // Positive control: "turbinez" (absent) still admits — the
    // sentence was ingested, only the key was blanked.
    expect(rankMatches(store, "tur").map((m) => m.key)).toContain("turbinez");
  });

  it("31-char mixed-alnum run passes through unmasked (boundary below the floor)", () => {
    const run31 = "a1B2".repeat(7) + "a1B"; // mixed case + digits, exactly 31
    expect(run31.length).toBe(31);
    expect(maskSecrets(`x ${run31} y`)).toBe(`x ${run31} y`); // byte-identical
  });

  it("32-char mixed-alnum run IS masked (the new floor)", () => {
    const run32 = "a1B2".repeat(8); // mixed case + digits, exactly 32
    expect(run32.length).toBe(32);
    expect(maskSecrets(`x ${run32} y`)).toBe(`x ${" ".repeat(32)} y`);
  });

  it("prose fixture replay: masking is a no-op on every text, so zero candidates are lost", async () => {
    const entries = parseSessionFixture("test/fixtures/sessions/prose.jsonl");
    const texts = messageEntriesOf(entries)
      .map((e) => extractText(e.message as unknown as AgentMessage))
      .filter((t): t is string => t !== null);
    expect(texts.length).toBeGreaterThan(0);
    // Masking-layer identity: no prose text contains a ≥ 32-char unbroken
    // [0-9a-zA-Z/+] run (longest English words ~28–30; URLs break on
    // ':'/'.')  — so the lowered floor cannot lose a single legitimate
    // candidate relative to unmasked ingestion.
    for (const t of texts) expect(maskSecrets(t)).toBe(t);
    // End-to-end half: the real pipeline still builds a live store from
    // the fixture, and nothing store-sized slipped through the mask.
    const { pipeline, store } = makePipeline();
    // 2026-09 retighten: the prose fixture itself admits nothing (all
    // attested English), so an absent marker word rides along to keep
    // the no-candidates-lost assertion non-vacuous.
    for (const t of texts) await pipeline.processText(t, true);
    await pipeline.processText("gzorch marker", true);
    expect(store.size).toBeGreaterThan(0);
    for (const k of storedKeys(store)) expect(k.length).toBeLessThan(32);
  });
});