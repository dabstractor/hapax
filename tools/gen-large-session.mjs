#!/usr/bin/env node
/**
 * One-shot generator for test/fixtures/sessions/large-100k.jsonl
 * (P1.M4.T1.S1, PRD §09 items 3 + 5 corpus).
 *
 * Emits a pi-session-shaped JSONL transcript (same entry shape as
 * `pi --export`: a "session" header line, then message entries with
 * {type,id,parentId,timestamp,message{role, content: blocks}}) holding a
 * ≥100k-token (~420 KB+ of text) synthetic conversation. Vocabulary is
 * drawn from FIXED pools with a SEEDED PRNG (mulberry32, seed 42), so the
 * output is byte-for-byte deterministic and the precision@8 labels in
 * test/fixtures/sessions/expected.md stay valid forever. The committed
 * file is the artifact — this script never runs at test time.
 *
 * Shape details (mirrors a real `pi --export` dump):
 *   - header: {"type":"session","version":3,"id",...,"cwd"}
 *   - entries: {"type":"message","id","parentId","timestamp",
 *               "message":{"role":"user"|"assistant",
 *                          "content":[{"type":"text","text":…}]}}
 *   - assistant messages carry a couple of extra real-world fields
 *     (model, stopReason) to exercise the loader's unknown-field tolerance.
 *
 * Near the END a user message pastes two FAKE API-shaped credentials
 * (an "sk-…" key and a "ghp_…" token, generated literals — never real).
 * They must be shape-gate-rejected on ingest (PRD §09 item 5) and never
 * appear in any completion menu.
 *
 * Stdlib-only; runs on stock Node: node tools/gen-large-session.mjs
 * (default output test/fixtures/sessions/large-100k.jsonl; pass a path to
 * override). Re-running must produce an identical file — CI never runs it.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const OUT_DEFAULT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sessions",
  "large-100k.jsonl",
);
const outPath = process.argv[2] ?? OUT_DEFAULT;

/** Deterministic PRNG (mulberry32). Fixed seed — NEVER randomize. */
const SEED = 42;
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
/** Uniform integer in [0, n). */
const pickInt = (n) => Math.floor(rand() * n);
/** Uniform pick from a non-empty array. */
const pick = (arr) => arr[pickInt(arr.length)];

// ── Vocabulary pools (FIXED — determinism requirement, see header) ──────────

/** Ordinary English filler (function + common words). Mixed lengths on
 *  purpose; short words (<4 chars) are gate-rejected on ingest, which is
 *  realistic traffic, not a problem. */
const COMMON = [
  "the", "and", "that", "with", "this", "from", "they", "have", "will",
  "would", "there", "about", "which", "when", "make", "time", "work",
  "first", "after", "back", "where", "right", "think", "still", "under",
  "again", "water", "night", "while", "every", "great", "little", "world",
  "own", "way", "day", "life", "hand", "part", "case", "point", "fact",
  "place", "group", "number", "home", "room", "area", "story", "study",
  "book", "word", "side", "head", "house", "power", "hour", "line", "city",
  "team", "idea", "body", "face", "level", "door", "person", "morning",
  "reason", "moment", "air", "light", "end", "hand", "small", "large",
  "next", "early", "few", "keep", "let", "begin", "seem", "help", "turn",
  "start", "might", "must", "should", "may", "never", "again", "last",
];

/** Rare technical terms repeated across the history (stable completion
 *  targets for expected.md). All lowercase plain words — each ingests as a
 *  single whole token. */
const RARE = [
  "kestrel", "verdigris", "quartzite", "basalt", "harbor", "lantern",
  "meadow", "cobalt", "fjord", "gully", "isthmus", "juniper", "knoll",
  "lichen", "marl", "nescent", "opal", "plateau", "quarry", "riftpine",
  "sable", "tundra", "umbra", "veldt", "willow", "yarrow", "zephyr",
];

/** camelCase identifiers (exercise subword expansion during restore —
 *  vocabulary spread across the whole history includes compound tokens). */
const CAMEL = [
  "parseHttpResponse", "retryQueueDepth", "batchCounter", "lockWaitRatio",
  "digestHexOutput", "syncJobRunner", "ticketBacklog", "webhookAckPath",
];

/** Numbered service terms — widen the unique-key vocabulary so the store
 *  grows across restore (exercise eviction-interplay paths, staying well
 *  under STORE_CAP = 20 000: 12 stems × 40 variants = 480 unique keys). */
const STEMS = [
  "vertex", "signal", "beacon", "cipher", "harbor", "socket", "throttle",
  "gateway", "pipeline", "shard", "cursor", "ledger",
];
const numberedTerms = [];
for (const stem of STEMS) {
  for (let i = 0; i < 40; i++) {
    numberedTerms.push(`${stem}${String(i).padStart(3, "0")}`);
  }
}

/** FAKE secret-shaped literals (PRD §09 item 5). Generated constants —
 *  these are NOT real credentials and were never valid anywhere. The
 *  alnum cores are pure hex ≥ 20 chars, so the shape gate rejects them
 *  (secret rule), and "ghp_…" additionally trips the secret-prefix list. */
const FAKE_SK = "sk-4f9a2c7e1b8d5a3f6e0c9b2d7f4a8e1c9d5b3a7f"; // sk- + 40 hex
const FAKE_GHP = "ghp_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e"; // ghp_ + 40 hex

// ── Message synthesis ────────────────────────────────────────────────────────

const PAIRS = 780; // user+assistant pairs → 1560 message entries
const SENTENCES_PER_MESSAGE = [4, 7]; // inclusive range
const WORDS_PER_SENTENCE = [8, 14];

/** Weighted token draw: mostly common filler, with rare terms, numbered
 *  service terms, and camelCase identifiers sprinkled throughout so the
 *  vocabulary spreads across the WHOLE history (restore-eviction interplay). */
function nextToken() {
  const roll = rand();
  if (roll < 0.68) return pick(COMMON);
  if (roll < 0.84) return pick(RARE);
  if (roll < 0.94) return pick(numberedTerms);
  return pick(CAMEL);
}

function nextSentence() {
  const n =
    WORDS_PER_SENTENCE[0] +
    pickInt(WORDS_PER_SENTENCE[1] - WORDS_PER_SENTENCE[0] + 1);
  const words = [];
  for (let i = 0; i < n; i++) words.push(nextToken());
  const s = words.join(" ");
  return s[0].toUpperCase() + s.slice(1) + ".";
}

function nextParagraph() {
  const n =
    SENTENCES_PER_MESSAGE[0] +
    pickInt(SENTENCES_PER_MESSAGE[1] - SENTENCES_PER_MESSAGE[0] + 1);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(nextSentence());
  return parts.join(" ");
}

// ── Transcript assembly ──────────────────────────────────────────────────────

const lines = [];
let textBytes = 0; // total message TEXT bytes (the ≥420 KB budget)

lines.push(
  JSON.stringify({
    type: "session",
    version: 3,
    id: "6f1e2a34-0000-4000-8000-424242424242",
    timestamp: "2025-01-15T09:00:00.000Z",
    cwd: "/tmp/hapax-fixtures",
  }),
);

const BASE_MS = Date.parse("2025-01-15T09:00:01.000Z");
let parentId = null;
let entryNo = 0;

/** Emit one message entry; returns its text (for the byte budget). */
function pushMessage(role, text, extra = {}) {
  entryNo += 1;
  const id = `e${String(entryNo).padStart(4, "0")}`;
  const timestamp = new Date(BASE_MS + entryNo * 8000).toISOString();
  const message = { role, content: [{ type: "text", text }], ...extra };
  lines.push(
    JSON.stringify({ type: "message", id, parentId, timestamp, message }),
  );
  parentId = id;
  textBytes += text.length;
}

/** The fake-key paste lands THIS many entries before the end (near the
 *  end, per PRD §09 item 5, so restore-order is exercised too). */
const KEY_PASTE_OFFSET = 12;

for (let i = 0; i < PAIRS; i++) {
  pushMessage("user", nextParagraph());
  pushMessage(
    "assistant",
    nextParagraph(),
    { model: "fixture-model", stopReason: "stop" }, // extra-field tolerance
  );
  // Inject the fake-key paste shortly before the transcript ends.
  if (i === PAIRS - 1 - Math.ceil(KEY_PASTE_OFFSET / 2)) {
    pushMessage(
      "user",
      `Before I forget, the staging key is ${FAKE_SK} and the backup token is ${FAKE_GHP}. Both values are fake fixtures generated for acceptance testing, never real credentials.`,
    );
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join("\n") + "\n");

// ── Run summary (stdout, human-only) ────────────────────────────────────────
const approxTokens = Math.round(textBytes / 4);
console.log(`wrote ${outPath}`);
console.log(`  entries:     ${entryNo} message entries (+1 header line)`);
console.log(`  text bytes:  ${textBytes}`);
console.log(`  file bytes:  ${fs.statSync(outPath).size}`);
console.log(`  ~tokens:     ${approxTokens} (bytes/4)`);
if (textBytes / 4 < 100_000) {
  console.error("FAIL: fewer than ~100k tokens — increase PAIRS or sentence sizes");
  process.exit(1);
}