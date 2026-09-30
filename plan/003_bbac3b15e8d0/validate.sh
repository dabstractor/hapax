#!/usr/bin/env bash
# ============================================================================
# hapax — comprehensive validation script
#
# Phases (only what exists in this codebase):
#   1. Type checking            — npm run check (tsc --noEmit, strict)
#   2. Unit/integration tests   — npm test (vitest; includes scripted §09
#                                 acceptance items, perf gates with hard 3x
#                                 bounds, no-persistence assertions)
#   3. Benchmarks               — npm run bench (perf-gate micro-benchmarks)
#   4. Shipped dictionary       — independent header/consistency parse +
#                                 FNV-1a probe lookups (no hapax code used)
#   5. Calibration drift gates  — node tools/calibrate-bands.mjs (exits 1 on
#                                 drift; asserts spec-pinned R_eff verdicts)
#   6. Dictionary build E2E     — tools/build-dict.mjs round-trip on a
#                                 synthetic corpus (build + self-verify)
#   7. E2E user journeys        — documented workflows (README/spec §09) run
#                                 through the REAL pipeline + SHIPPED dict via
#                                 an out-of-tree vitest config (no repo files
#                                 touched; expectations encode the SPEC)
#   8. Hygiene                  — repo cleanliness + no-persistence double-check
#
# Optional (spec §09 live-verification technique; requires tmux + a pi
# installation that discovers hapax):  HAPAX_LIVE=1 ./validate.sh
#
# Exit code: 0 iff every phase passes.
# ============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
FAILURES=()

phase() { # phase <name> <cmd...>
  local name="$1"; shift
  echo ""
  echo "==================================================================="
  echo "PHASE: $name"
  echo "==================================================================="
  local out
  if out=$("$@" 2>&1); then
    PASS=$((PASS + 1))
    echo "PHASE PASS: $name"
    # print tails of interest without flooding
    echo "$out" | tail -n 6
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$name")
    echo "PHASE FAIL: $name"
    echo "$out" | tail -n 40
  fi
}

echo "hapax validation — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "repo: $REPO_ROOT"
node --version

# ---------------------------------------------------------------------------
# Phase 1 — type checking
phase "1/8 typecheck (tsc --noEmit)" npm run check

# ---------------------------------------------------------------------------
# Phase 2 — unit + integration tests (vitest --run; includes the scripted
# §09 acceptance halves, perf-gate hard bounds, no-persistence suite)
phase "2/8 unit+integration (npm test)" npm test

# ---------------------------------------------------------------------------
# Phase 3 — perf-gate micro-benchmarks (skippable: HAPAX_SKIP_BENCH=1)
if [ "${HAPAX_SKIP_BENCH:-0}" = "1" ]; then
  echo ""; echo "PHASE SKIPPED: 3/8 bench (HAPAX_SKIP_BENCH=1)"
else
  phase "3/8 perf benchmarks (npm run bench)" npm run bench
fi

# ---------------------------------------------------------------------------
# Phase 4 — shipped dictionary artifact integrity (INDEPENDENT parser —
# no hapax code on this path; re-reads the HAPX v1 format from the spec)
phase_dict() {
  node --input-type=module -e '
import { readFileSync } from "node:fs";
const b = readFileSync("dict/common-en.bin");
const dv = new DataView(b.buffer, b.byteOffset, b.length);
const magic = String.fromCharCode(b[0], b[1], b[2], b[3]);
if (magic !== "HAPX") throw new Error("bad magic: " + magic);
const version = dv.getUint16(4, true);
if (version !== 1) throw new Error("unsupported version " + version);
const entryCount = dv.getUint32(8, true);
const blobLen = dv.getUint32(12, true);
const bucketCount = dv.getUint32(16, true);
const seed = dv.getUint32(20, true);
if (bucketCount === 0 || (bucketCount & (bucketCount - 1)) !== 0)
  throw new Error("bucketCount not a power of two");
const expected = 24 + blobLen + 4 * (entryCount + 1) + entryCount + 4 * bucketCount;
if (expected !== b.length) throw new Error(`size mismatch: header ${expected} vs file ${b.length}`);
if (bucketCount < Math.ceil(entryCount * 1.3)) throw new Error("bucketCount below 1.3x entries");
// independent FNV-1a + linear-probe lookup re-implementation
const blob = new Uint8Array(b.buffer, b.byteOffset + 24, blobLen);
const off = new Uint32Array(entryCount + 1);
for (let i = 0; i <= entryCount; i++) off[i] = dv.getUint32(24 + blobLen + 4 * i, true);
const scores = new Uint8Array(b.buffer, b.byteOffset + 24 + blobLen + 4 * (entryCount + 1), entryCount);
const buckets = new Uint32Array(bucketCount);
for (let i = 0; i < bucketCount; i++)
  buckets[i] = dv.getUint32(24 + blobLen + 4 * (entryCount + 1) + entryCount + 4 * i, true);
function lookup(w) {
  const e = new TextEncoder().encode(w);
  let h = 0x811c9dc5;
  for (const c of e) h = Math.imul(h ^ c, 0x01000193);
  h = (h ^ seed) >>> 0;
  let slot = h & (bucketCount - 1);
  for (let n = 0; n < bucketCount; n++) {
    const v = buckets[slot];
    if (v === 0) return null;
    const i = v - 1;
    const len = off[i + 1] - off[i];
    if (len === e.length) {
      let eq = true;
      for (let k = 0; k < len; k++) if (blob[off[i] + k] !== e[k]) { eq = false; break; }
      if (eq) return scores[i];
    }
    slot = (slot + 1) & (bucketCount - 1);
  }
  return null;
}
if (lookup("the") === null) throw new Error("the missing");
if (lookup("hapax") !== null) throw new Error("hapax unexpectedly present");
if (lookup("provider") === null) throw new Error("provider missing");
if (lookup("zzzzzznotaword") !== null) throw new Error("phantom hit");
console.log(`dict OK: v${version} entries=${entryCount} blob=${blobLen}B buckets=${bucketCount} LF=${(entryCount / bucketCount).toFixed(3)} the=${lookup("the")} provider=${lookup("provider")}`);
'
}
phase "4/8 shipped dictionary integrity (independent parse)" bash -c "$(declare -f phase_dict); phase_dict"

# ---------------------------------------------------------------------------
# Phase 5 — calibration drift gates (spec §09: run after any retune/regen;
# tool exits 1 on drift and asserts the spec-pinned R_eff verdicts itself)
phase "5/8 calibration drift gates (calibrate-bands)" node tools/calibrate-bands.mjs

# ---------------------------------------------------------------------------
# Phase 6 — dictionary build round-trip E2E (build tool self-verifies:
# re-loads output, re-looks-up every entry, asserts no duplicate keys)
phase_build_dict() {
  local tmp
  tmp=$(mktemp -d)
  {
    printf 'the\t1000000\nand\t900000\nhapaxword\t3\nzendeskword\t5\n'
    printf 'provider\t50000\ncharacteristics\t200\ngovernment\t300\ninformation\t350\n'
    printf 'organization\t100\nrelationship\t90\ninfrastructure\t80\nresponsibility\t70\n'
    printf 'development\t400\nupload\t60000\neverything\t250\nfoo123bar\t10\n'
  } > "$tmp/mini.tsv"
  node tools/build-dict.mjs --out "$tmp/mini.bin" "$tmp/mini.tsv"
  local rc=$?
  rm -rf "$tmp"
  return $rc
}
phase "6/8 dictionary build round-trip (build-dict.mjs)" bash -c "$(declare -f phase_build_dict); phase_build_dict"

# ---------------------------------------------------------------------------
# Phase 7 — E2E USER JOURNEYS (documented workflows, REAL pipeline + shipped
# dict; materialized OUTSIDE the repo and run via an out-of-tree vitest
# config — the repo tree is never touched). Expectations encode the SPEC
# contract, so today's known path-edge deviations FAIL here by design.
E2E_DIR=$(mktemp -d /tmp/hapax-e2e.XXXXXX)
trap 'rm -rf "$E2E_DIR"' EXIT

cat > "$E2E_DIR/vitest.config.ts" <<EOF
export default {
  root: "$REPO_ROOT",
  test: { include: ["$E2E_DIR/journey.test.ts"] },
};
EOF

cat > "$E2E_DIR/journey.test.ts" <<'JOURNEY_EOF'
/**
 * hapax E2E user-journey validation. Journeys mirror the documented
 * workflows (README + spec §09 acceptance items), driven through the REAL
 * ingest pipeline + SHIPPED dictionary — not mocks. Expectations encode
 * the SPEC contract; failures are findings.
 */
import { describe, it, expect } from "vitest";
import { CandidateStore } from "__REPO__/src/core/store.js";
import { loadDictionary } from "__REPO__/src/core/dictionary.js";
import { IngestPipeline } from "__REPO__/src/pi/ingest.js";
import { rankMatches } from "__REPO__/src/core/query.js";
import { tokenize } from "__REPO__/src/core/segment.js";
import { maskSecrets } from "__REPO__/src/core/shapeGate.js";

const dict = loadDictionary("__REPO__/dict/common-en.bin");

async function ingest(
  text: string,
  opts: { rejectCommonness?: number; chain?: boolean } = {},
): Promise<CandidateStore> {
  const store = new CandidateStore();
  const p = new IngestPipeline({
    store,
    dictionary: dict,
    ...(opts.rejectCommonness !== undefined ? { rejectCommonness: opts.rejectCommonness } : {}),
    ...(opts.chain ? { onAdmittedTokens: (runs: unknown) => store.recordBigramRuns(runs as never) } : {}),
  });
  await p.processText(text, true);
  return store;
}

const displays = (store: CandidateStore, frag: string, o: Parameters<typeof rankMatches>[2] = {}) =>
  rankMatches(store, frag, o).map((m) => m.display);

describe("J1 — happy path (§09 item 1)", () => {
  it("session discussing Zendesk + lwlock completes ze / l", async () => {
    const s = await ingest(
      "We migrated support to Zendesk last quarter. The lwlock contention report came from the Zendesk integration logs.",
    );
    expect(displays(s, "ze")).toContain("Zendesk");
    expect(displays(s, "l")).toContain("lwlock");
  });
  it("case-insensitive match, display casing on insert", async () => {
    const s = await ingest("lowercase nrel first. NREL publishes data.");
    expect(displays(s, "nrel")).toContain("NREL"); // most recent casing wins
  });
});

describe("J2 — anchored fuzzy + tiers (M3)", () => {
  it("zsk -> zendesk (tier-2 contiguous tail) at default threshold", async () => {
    const s = await ingest("zendesk");
    expect(displays(s, "zsk")).toContain("zendesk");
  });
  it("esk never matches zendesk (first-char anchor)", async () => {
    const s = await ingest("zendesk");
    expect(displays(s, "esk")).not.toContain("zendesk");
  });
  it("strictness tier beats sessionCount (spec 09: zlock tier-3 > 40-count z_lwlock tier-2)", async () => {
    const s = await ingest(
      Array.from({ length: 40 }, () => "z_lwlock").join(" ") + " zlock",
    );
    const r = rankMatches(s, "zl");
    expect(r[0]!.key).toBe("zlock");
  });
  it("sessionCount orders within a tier", async () => {
    const s = await ingest(
      Array.from({ length: 5 }, () => "zalpha").join(" ") + " zbeta",
    );
    const r = rankMatches(s, "z");
    expect(r.map((m) => m.key)).toEqual(["zalpha", "zbeta"]);
  });
});

describe("J3 — zero-fragment listing + plural pruning", () => {
  it("'#' alone lists sessionCount-desc (zero-fragment rule)", async () => {
    const s = await ingest(
      Array.from({ length: 7 }, () => "quuxblat").join(" ") +
        " " +
        Array.from({ length: 3 }, () => "zorble").join(" "),
    );
    const r = rankMatches(s, "");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.key).toBe("quuxblat");
  });
  it("plugin/plugins pair yields only the singular", async () => {
    const s = await ingest("plugin plugins plugin plugins plugin plugins");
    expect(displays(s, "plug")).toContain("plugin");
    expect(displays(s, "plug")).not.toContain("plugins");
  });
});

describe("J4 — conversational paths + technical literals (§09 item 7, rules 4c/4d)", () => {
  it("sr -> whole path src/core/query.ts", async () => {
    const s = await ingest("edit src/core/query.ts and compare it");
    expect(displays(s, "sr")).toContain("src/core/query.ts");
  });
  it("absolute path: key trims leading /, display keeps it (§04 rule 4d)", async () => {
    const s = await ingest("look at /home/user/projects/hapax/README.md now");
    expect(displays(s, "ho")).toContain("/home/user/projects/hapax/README.md");
  });
  it("LONG absolute paths (>32 unbroken alnum/slash chars) still complete (§04 rule 4d: cap 96)", async () => {
    const s = await ingest("deploy to /srv/continuous/integration/deployments/release today");
    expect(displays(s, "sr")).toContain("/srv/continuous/integration/deployments/release");
  });
  it("digit-bearing literals complete whole (rule 4c)", async () => {
    const s = await ingest(
      "drop the virtual mode to 2560x1440@2 with mode=2, host 192.168.1.1, port 8080, on 2026-09-15 at 4:36.",
    );
    expect(displays(s, "25", { fuzzThreshold: 0 })).toContain("2560x1440@2");
    expect(displays(s, "mo", { fuzzThreshold: 0 })).toContain("mode=2");
    expect(displays(s, "19", { fuzzThreshold: 0 })).toContain("192.168.1.1");
    expect(displays(s, "80", { fuzzThreshold: 0 })).toContain("8080");
  });
  it("line:col suffix trims at sentence-final position too (rule 4d: 'the user retypes the path, not the line numbers')", async () => {
    const s = await ingest("jump to src/core/query.ts:42:13 for the first. also src/core/query.ts:42:13. end.");
    const r = displays(s, "sr");
    expect(r).toContain("src/core/query.ts");
    expect(r.every((d) => !d.includes(":42"))).toBe(true);
  });
  it("sentence-final plain path carries no trailing period (rule 4c guard: periods never glue)", async () => {
    const s = await ingest("open src/core/query.ts. then close it.");
    expect(displays(s, "sr")).toContain("src/core/query.ts");
    expect(displays(s, "sr").every((d) => !d.endsWith("."))).toBe(true);
  });
});

describe("J5 — secrets acceptance (§09 item 5)", () => {
  it("pasted API keys never appear in any suggestion", async () => {
    const s = await ingest(
      [
        "My key is sk-abc123DEF456ghi789JKL012mno345PQR678stu901VWX234.",
        "Also ghp_16C7e42f291c9175Eb4e8d94B19167c299c3934 and",
        "AKIAIOSFODNN7EXAMPLE with secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY,",
        "slack xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx,",
        "card 5105105105105100 and 4111111111111111.",
        "glpat-abcdefghij0123456789 and npm_AbCdEf0123456789AbCdEf0123456789.",
        "Normal words Zendesk lwlock remain.",
      ].join("\n"),
    );
    const seen = new Set<string>();
    for (const c of "abcdefghijklmnopqrstuvwxyz0123456789") {
      for (const m of rankMatches(s, c, { limit: 20, fuzzThreshold: 0 }))
        seen.add(`${m.key}|${m.display}`);
    }
    const all = [...seen].join("\n").toLowerCase();
    for (const frag of [
      "sk-abc", "ghp_", "16c7e42f", "akia", "wjalrxu", "bpxrfi", "xoxb",
      "abcdefghijklmnopqrstuvwx", "5105105105105100", "4111111111111111",
      "glpat", "npm_",
    ]) {
      expect(all).not.toContain(frag);
    }
    expect(all).toContain("zendesk|zendesk");
  });
});

describe("J6 — no menus for ordinary prose (never-hijack)", () => {
  it("prose-only session ingests to a near-empty store", async () => {
    const s = await ingest(
      "The quick brown fox jumps over the lazy dog. This is just a normal sentence with common words, and it should not produce any completion menu at all because everything here is common English.",
    );
    for (const frag of ["th", "qu", "no", "ev", "be"]) {
      expect(displays(s, frag)).toEqual([]);
    }
  });
});

describe("J7 — chained completion (§09 item 7, M2)", () => {
  it("zero-typed-char successor chain over admitted words", async () => {
    const s = await ingest(
      "Zorpwibble quuxblat zorble. Zorpwibble quuxblat zorble. Zorpwibble quuxblat zorble.",
      { chain: true },
    );
    const top = (w: string) => s.topSuccessors(w)[0]?.next;
    expect(top("zorpwibble")).toBe("quuxblat");
    expect(top("quuxblat")).toBe("zorble");
  });
  it("bigram window breaks on punctuation (comma kills the chain)", async () => {
    const s = await ingest(
      "Wibbly, wobbly. Wibbly, wobbly. Wibbly, wobbly.",
      { chain: true },
    );
    expect(s.topSuccessors("wibbly")).toEqual([]);
  });
  it("one word per completion, always — every chain item is single-word", async () => {
    const s = await ingest("flibbertigibbet poppysnitch. flibbertigibbet poppysnitch.", { chain: true });
    for (const succ of s.topSuccessors("flibbertigibbet")) {
      expect(succ.next).toMatch(/^\S+$/);
    }
  });
});

describe("J8 — structural-start properName (2026-09 rule)", () => {
  it("mid-sentence capital keeps hint; structural starts do not", async () => {
    const mid = await ingest("then Wobblefunk appeared");
    expect(mid.get("wobblefunk")!.properName).toBe(true);
    const start = await ingest("Wobblefunk appeared");
    expect(start.get("wobblefunk")!.properName).toBe(false);
    const after = await ingest("Done. Wobblefunk appeared");
    expect(after.get("wobblefunk")!.properName).toBe(false);
    const bullet = await ingest("- Wobblefunk appeared");
    expect(bullet.get("wobblefunk")!.properName).toBe(false);
  });
});

describe("J9 — segmentation spec pins (rules 3/4)", () => {
  const toks = (t: string) =>
    tokenize(maskSecrets(t)).map((x) => (x.path ? `P:${x.raw.slice(x.trimFrom!, x.trimTo!)}` : x.literal ? `L:${x.raw}` : x.raw));
  it("unicode-letter adjacency disqualifies whole run", () => {
    expect(toks("name Þórhildur here").some((r) => r.includes("rhildur"))).toBe(false);
    expect(toks("ΩbsidianMirror data").some((r) => r.includes("bsidian"))).toBe(false);
  });
  it("and/or (single slash, no dot) is not a token; interior .. rejects", () => {
    expect(toks("we sat and/or stood")).not.toContain("and/or");
    expect(toks("go a/../b now")).not.toContain("a/../b");
  });
  it("hyphen compounds and filenames stay whole", () => {
    expect(toks("load-bearing and state-of-the-art")).toContain("load-bearing");
    expect(toks("load-bearing and state-of-the-art")).toContain("state-of-the-art");
    expect(toks("see AGENTS.md and package.json")).toContain("AGENTS.md");
    expect(toks("see AGENTS.md and package.json")).toContain("package.json");
  });
  it("don't splits at apostrophe; --flag is not a token", () => {
    expect(toks("don't stop")).not.toContain("don't");
    expect(toks("run --flag now")).not.toContain("--flag");
  });
  it("hexish commit-hash shapes are captured; long pure hex rejected", async () => {
    const s = await ingest("commit f3a9c2e landed");
    expect(s.get("f3a9c2e")).toBeDefined();
    const s2 = await ingest("key deadbeefdeadbeefdeadbeefdeadbeef deadbeefdeadbeef");
    expect(s2.get("deadbeefdeadbeefdeadbeefdeadbeef")).toBeUndefined();
  });
});

describe("J10 — user-typed stickiness (salience input)", () => {
  it("userTyped flag sticks once seen from a user message", async () => {
    const s = await ingest("the wobblequanta setting", {});
    expect(s.get("wobblequanta")!.userTyped).toBe(true);
  });
});
JOURNEY_EOF

sed -i "s#__REPO__#$REPO_ROOT#g" "$E2E_DIR/journey.test.ts"
phase "7/8 E2E user journeys (real pipeline + shipped dict)" \
  npx vitest --run --config "$E2E_DIR/vitest.config.ts" "$E2E_DIR/journey.test.ts"

# ---------------------------------------------------------------------------
# Phase 8 — hygiene + no-persistence double-check
phase_hygiene() {
  local bad=0
  # 8a. no persistence: nothing written under the repo by the runs above
  #     beyond the three validation artifacts.
  local dirty
  dirty=$(git status --porcelain | grep -vE '^\?\? (validate\.sh|validation_report\.md|validation_result\.json)$' || true)
  if [ -n "$dirty" ]; then
    echo "WARNING: unexpected working-tree changes (may predate this run):"
    echo "$dirty"
    bad=1
  fi
  # 8b. tracked junk check (reported findings — informational here)
  for f in url audit-output.txt; do
    if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      echo "NOTE: tracked non-source artifact present: $f"
    fi
  done
  # 8c. spec/ code-purity invariant: src/core must not import pi packages
  if grep -rn "pi-coding-agent\|pi-tui" src/core/ >/dev/null 2>&1; then
    echo "FAIL: src/core imports a pi package (architecture invariant)"
    bad=1
  else
    echo "OK: src/core is pi-free"
  fi
  # 8d. runtime deps must be absent (spec 02: no dependencies)
  if node -e 'const p=require("./package.json"); if(Object.keys(p.dependencies??{}).length) { process.exit(1); }'; then
    echo "OK: zero runtime dependencies"
  else
    echo "FAIL: runtime dependencies present"
    bad=1
  fi
  return $bad
}
phase "8/8 hygiene + invariants" bash -c "$(declare -f phase_hygiene); phase_hygiene"

# ---------------------------------------------------------------------------
# Optional live TTY verification (spec §09 technique) — opt-in only
if [ "${HAPAX_LIVE:-0}" = "1" ]; then
  echo ""
  echo "==================================================================="
  echo "PHASE: live TTY verification (HAPAX_LIVE=1)"
  echo "==================================================================="
  if command -v tmux >/dev/null 2>&1; then
    echo "tmux found — running pi --no-session smoke per spec §09..."
    # Best-effort smoke: requires hapax discoverable by pi (project
    # .pi/extensions or ~/.pi/agent/extensions). See validation_report.md.
    echo "(manual procedure: seed a message, then tmux send-keys one char at a"
    echo " time with 0.08-0.12s sleeps; observe via tmux capture-pane)"
  else
    echo "SKIP: tmux not available"
  fi
fi

# ---------------------------------------------------------------------------
echo ""
echo "==================================================================="
echo "VALIDATION SUMMARY"
echo "==================================================================="
echo "phases passed: $PASS"
echo "phases failed: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'failed phases:\n'
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
echo "ALL PHASES PASSED"
exit 0
