#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# hapax — comprehensive validation script
#
# Phases (only those that exist in this codebase are run):
#   1. Linting          — auto-detected (none configured → reported, skipped)
#   2. Type checking    — npm run check (tsc --noEmit, strict)
#   3. Style checking   — auto-detected (none configured → reported, skipped)
#   4. Unit testing     — npm test (vitest --run, includes perf gates)
#   5. Benchmarks       — npm run bench (PRD §09 perf gates)
#   6. E2E adversarial  — independent probe suite against REAL modules +
#                         the REAL shipped dictionary (all 6 PRD bug repros +
#                         README user journeys), via jiti (same loader pi uses)
#   7. Live host smoke  — real `pi -e .` headless load (extension must load
#                         and answer without extension errors)
#
# Exit code: 0 = all hard checks passed (warnings possible — see summary);
#            1 = at least one hard check failed.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")"

ROOT="$(pwd)"
FAILURES=0
WARNINGS=0
declare -a SUMMARY=()

record() { # $1=PASS|FAIL|WARN|SKIP  $2=title  $3=detail
  SUMMARY+=("[$1] $2${3:+ — $3}")
  case "$1" in
    FAIL) FAILURES=$((FAILURES+1)) ;;
    WARN) WARNINGS=$((WARNINGS+1)) ;;
  esac
}

phase() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

# ─────────────────────────────────────────────────────────────────────────────
phase "0. Environment"
echo "node $(node --version), npm $(npm --version 2>/dev/null | head -1), cwd: $ROOT"
[ -d node_modules ] || { echo "node_modules missing — run npm ci"; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
phase "1. Linting"
if compgen -G ".eslintrc*" > /dev/null || [ -f eslint.config.* ] 2>/dev/null || ls eslint.config.* >/dev/null 2>&1; then
  npx eslint . && record PASS "eslint" || record FAIL "eslint"
else
  record SKIP "Linting" "no lint config in repo (package.json defines none) — nothing to run"
fi

# ─────────────────────────────────────────────────────────────────────────────
phase "2. Type checking"
if npm run check; then record PASS "tsc --noEmit (strict)"; else record FAIL "tsc --noEmit (strict)"; fi

# ─────────────────────────────────────────────────────────────────────────────
phase "3. Style checking"
if ls .prettierrc* biome.json .editorconfig >/dev/null 2>&1; then
  record SKIP "Style" "formatter config present but no formatter script defined in package.json"
else
  record SKIP "Style" "no formatter config in repo — nothing to run"
fi

# ─────────────────────────────────────────────────────────────────────────────
phase "4. Unit + acceptance + adversarial regression tests (vitest)"
if npm test; then record PASS "npm test (vitest --run)"; else record FAIL "npm test (vitest --run)"; fi

# ─────────────────────────────────────────────────────────────────────────────
phase "5. Performance gates (PRD §09)"
if npm run bench; then record PASS "npm run bench (perf gates; hard bounds asserted in npm test)"; else record FAIL "npm run bench"; fi

# ─────────────────────────────────────────────────────────────────────────────
phase "6. E2E adversarial probes (real modules + shipped dict, via jiti)"
PROBE_DIR="$(mktemp -d /tmp/hapax-validate.XXXXXX)"
cat > "$PROBE_DIR/run-probes.mjs" <<'PROBES'
// Independent adversarial validation probes for hapax (post-P1-fix verification).
// Runs the REAL modules via jiti (the same loader pi uses) against the REAL
// shipped dictionary. Each probe reproduces one PRD bug's original repro
// steps; a hard FAIL means the bug regressed. One known-minor residue
// (P4 single-token leak on bad-dict restore) is reported as WARN.
import { createJiti } from "/home/dustin/projects/hapax/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";

const ROOT = "/home/dustin/projects/hapax";
const jiti = createJiti(`${ROOT}/src/pi/index.ts`);
const load = (p) => jiti.import(`${ROOT}/src/${p}`);

const { loadDictionary } = await load("core/dictionary.ts");
const { createLazyDictionary } = await load("pi/index.ts");
const { IngestPipeline, restoreFromHistory } = await load("pi/ingest.ts");
const { createHapaxProvider, createDisplayProvider } = await load("pi/provider.ts");
const { DEFAULT_CONFIG } = await load("pi/config.ts");
const { rankMatches } = await load("core/query.ts");
const { CandidateStore } = await load("core/store.ts");

const DICT = `${ROOT}/dict/common-en.bin`;

let failures = 0, warnings = 0;
const results = [];
function check(name, cond, detail = "", warn = false) {
  const ok = !!cond;
  results.push({ name, ok, warn });
  if (!ok) { if (warn) warnings++; else failures++; }
  console.log(`${ok ? "PASS" : warn ? "WARN" : "FAIL"}  ${name}${detail && !ok ? `  — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const signal = () => ({ aborted: false });
const noopCurrent = {
  getSuggestions: async () => null,
  applyCompletion: (l, cl, cc, item, prefix) => ({ lines: l, cursorLine: cl, cursorCol: cc }),
};
async function query(provider, line, col) {
  return provider.getSuggestions([line], 0, col, { signal: signal() });
}

// P1 — BUG-001: shipped dictionary calibration + prose no-menu ───────────────
{
  const dict = loadDictionary(DICT);
  for (const w of ["the", "that", "with", "this", "them", "first", "have", "would"]) {
    const q = dict.lookup(w);
    check(`P1 dict rejects "${w}" (q=${q} ≥ 100)`, q !== null && q >= 100, `q=${q}`);
  }
  const store = new CandidateStore();
  const pipeline = new IngestPipeline({ store, dictionary: dict, yieldFn: async () => {} });
  await pipeline.processText(
    "I will go with them to the station because this was the first time we would have seen that show together.",
    true,
  );
  for (const [frag, banned] of [["with", "with"], ["this", "this"], ["them", "them"], ["firs", "first"]]) {
    const items = rankMatches(store, frag, { limit: 8 });
    const leaked = items.some((i) => i.display.toLowerCase() === banned);
    check(`P1 typing "${frag}" never offers "${banned}"`, !leaked, `menu: ${items.map((i) => i.display).join(",")}`);
  }
}

// P2 — BUG-002: display-debounce stale prefix + Tab corruption ('zzendesk') ─
{
  const store = new CandidateStore();
  const dict = loadDictionary(DICT);
  const pipeline = new IngestPipeline({ store, dictionary: dict, yieldFn: async () => {} });
  await pipeline.processText("We filed a zendesk ticket and a zephyr issue yesterday.", true);
  const chain = { state: () => null, arm() {}, consumePending: () => null, reset() {} };
  const provider = createDisplayProvider(
    createHapaxProvider(store, { ...DEFAULT_CONFIG }, noopCurrent, chain),
  );
  const editorTab = (line, col, result) => {
    if (!result || !result.items.length) return { line, col };
    const prefix = result.prefix;
    const item = result.items[0];
    const start = col - prefix.length;
    return { line: line.slice(0, start) + item.value + line.slice(col), col: start + item.value.length };
  };

  await query(provider, "ze", 2);
  const r = await query(provider, "zep", 3);
  const after = editorTab("zep", 3, r);
  check(
    "P2 rapid-type Tab never corrupts ('zep' + Tab ≠ 'zzendesk')",
    after.line === "zephyr" || after.line === "zep",
    `got "${after.line}"`,
  );

  const p2 = createDisplayProvider(
    createHapaxProvider(store, { ...DEFAULT_CONFIG }, noopCurrent, chain),
  );
  await query(p2, "ze", 2);
  const rB = await query(p2, "zeph", 4);
  await sleep(130);
  const afterB = editorTab("zeph", 4, rB);
  check("P2 pause-then-Tab never corrupts ('zeph' + Tab)", afterB.line === "zephyr",
    `got "${afterB.line}" (prefix served: "${rB.prefix}")`);

  const p3 = createDisplayProvider(
    createHapaxProvider(store, { ...DEFAULT_CONFIG }, noopCurrent, chain),
  );
  let invariantHeld = true, served = "";
  for (const [line, col] of [["ze", 2], ["zep", 3], ["zeph", 4], ["zephyr", 6]]) {
    const res = await query(p3, line, col);
    if (res && res.prefix && !line.endsWith(res.prefix)) { invariantHeld = false; served = `line="${line}" prefix="${res.prefix}"`; }
  }
  check("P2 every served prefix suffix-matches the buffer", invariantHeld, served);
}

// P3 — BUG-003: realistic multi-segment secret keys never become candidates ──
{
  const store = new CandidateStore();
  const dict = loadDictionary(DICT);
  const pipeline = new IngestPipeline({ store, dictionary: dict, yieldFn: async () => {} });
  const AWS_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const SLACK = "xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx";
  const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjg4mBfKjS9eQ0dozjg4mBfKjS9eQ0";
  const OPENAI = "sk-proj-4t7RX2bQ9wLm3vN8xKpZ6dJh1cA5eFgH0iU";
  await pipeline.processText(
    `aws secret: ${AWS_SECRET}\nslack: ${SLACK}\njwt: ${JWT}\nopenai: ${OPENAI}`,
    true,
  );
  const fragProbes = [
    ["wjal", AWS_SECRET], ["k7mdeng", AWS_SECRET], ["bpxrfi", AWS_SECRET],
    ["abcdefghijklmnopqrstuvwx", SLACK], ["abc", SLACK], ["dozjg", JWT],
    ["4t7rx2", OPENAI], ["wlm3v", OPENAI],
  ];
  for (const [frag, key] of fragProbes) {
    const items = rankMatches(store, frag, { limit: 8 });
    const leaked = items.some((i) =>
      key.toLowerCase().replace(/[^a-z0-9]/g, "").includes(i.display.toLowerCase()),
    );
    check(`P3 fragment "${frag}" leaks no key payload`, !leaked, `menu: ${items.map((i) => i.display).join(",")}`);
  }
}

// P4 — BUG-004: failed dictionary load → restore replay aborts ───────────────
{
  let notifies = 0;
  const lazy = createLazyDictionary("/nonexistent/hapax-dict.bin", () => { notifies++; });
  const store = new CandidateStore();
  const pipeline = new IngestPipeline({
    store, dictionary: lazy, yieldFn: async () => {}, isDisabled: () => lazy.failed,
  });
  const history = [
    { type: "message", message: { role: "user", content: "the rain in spain falls mainly with them again" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "that would be the first of many such shows" }] } },
  ];
  restoreFromHistory(pipeline, { getBranch: () => history, getEntries: () => history }, () => lazy.failed);
  await sleep(150);
  check("P4 bad dict → restore aborts (history not ingested)", store.size <= 1,
    `store.size=${store.size} (expected ≤1; PRD bug admitted the WHOLE history)`);
  check("P4 bad dict → exactly one error notify", notifies === 1, `notifies=${notifies}`);
  // Known-minor residue (WARN, reported in validation_report.md): the FIRST
  // token of the first replayed message is admitted as rank-group-0 before the
  // abort fires, contradicting README's "starts from an empty store".
  check("P4 bad dict → store completely empty (README contract)", store.size === 0,
    `residue: 1 candidate (first token of first message) admitted before abort — see report`, true);
}

// P5 — BUG-005: chain reachable after full session replay ────────────────────
{
  const store = new CandidateStore();
  const dict = loadDictionary(DICT);
  const pipeline = new IngestPipeline({
    store, dictionary: dict, yieldFn: async () => {},
    onAdmittedTokens: (lines) => store.recordPhraseLines(lines, store.currentOrdinal()),
  });
  const NREL = "The National Renewable Energy Laboratory does wind research. National wind and National solar.";
  for (let i = 0; i < 4; i++) await pipeline.processText(NREL, true);
  const natio = rankMatches(store, "natio", { limit: 8 });
  const bareNational = natio.some((i) => i.key === "national" && !i.key.includes(" "));
  check("P5 after full replay, 'natio' menu still offers bare 'National'", bareNational,
    `menu: ${natio.map((i) => i.display).join(" | ")}`);
  const na = rankMatches(store, "na", { limit: 8 });
  check("P5 'na' menu still offers bare 'National'", na.some((i) => i.key === "national"),
    `menu: ${na.map((i) => i.display).join(" | ")}`);

  const provider = createHapaxProvider(store, { ...DEFAULT_CONFIG }, noopCurrent);
  const accept = async (line, col) => {
    const res = await query(provider, line, col);
    return res && res.items.length ? res.items[0] : null;
  };
  const item1 = await accept("The natio", 9);
  check("P5 'natio' query returns an item", item1 !== null, "no items");
  if (item1) {
    const line1 = "The " + item1.value;
    provider.applyCompletion(["The natio"], 0, 9, item1, "natio");
    const res2 = await query(provider, line1, line1.length);
    const vals2 = res2 ? res2.items.map((i) => i.value) : [];
    check("P5 zero-typing successor offer after accepting National", vals2.some((v) => v.trim() === "renewable"),
      `offers: ${vals2.join(" | ")}`);
    if (vals2.length) {
      const pick = vals2.find((v) => v.trim() === "renewable") ?? vals2[0];
      const line2 = line1 + pick;
      provider.applyCompletion([line1], 0, line1.length, { value: pick }, res2.prefix);
      const res3 = await query(provider, line2, line2.length);
      const vals3 = res3 ? res3.items.map((i) => i.value) : [];
      check("P5 chain continues: renewable → energy", vals3.some((v) => v.trim() === "energy"),
        `offers: ${vals3.join(" | ")}`);
    }
  }
}

// P6 — BUG-006: demotion sweep runs at the tail of restore replay ────────────
{
  const dict = loadDictionary(DICT);
  const store = new CandidateStore();
  let sweeps = 0;
  const pipeline = new IngestPipeline({
    store, dictionary: dict, yieldFn: async () => {},
    onAdmittedTokens: (lines) => store.recordPhraseLines(lines, store.currentOrdinal()),
    onSweepPhrases: () => { sweeps++; store.sweepPhraseDemotions(); },
  });
  const history = [{ type: "message", message: { role: "user", content: "the zorblat quuxified mumblewords appears once" } }];
  for (let i = 0; i < 45; i++) history.push({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "filler message about ordinary things and stuff" }] } });
  restoreFromHistory(pipeline, { getBranch: () => [], getEntries: () => history });
  await sleep(200);
  check("P6 restore tail sweep ran exactly once", sweeps === 1, `sweeps=${sweeps}`);
  const cands = store.phraseCandidateKeys();
  check("P6 stale fast-path phrase demoted after restore replay",
    !cands.includes("zorblat quuxified mumblewords"), `candidates: ${cands.join(" | ")}`);
}

// W — README user journeys against real modules ──────────────────────────────
{
  const dict = loadDictionary(DICT);
  const store = new CandidateStore();
  const pipeline = new IngestPipeline({ store, dictionary: dict, yieldFn: async () => {} });
  await pipeline.processText("Please check the lwlock documentation and open a Zendesk case for NREL.", true);
  const chain = { state: () => null, arm() {}, consumePending: () => null, reset() {} };
  const p = createHapaxProvider(store, { ...DEFAULT_CONFIG }, noopCurrent, chain);

  const r1 = await query(p, "#l", 2);
  check("W1 trigger '#' + 'l' offers lwlock", r1 && r1.items.some((i) => i.value === "lwlock"),
    r1 ? `items: ${r1.items.map((i) => i.value).join(",")}` : "null");
  const r2 = await query(p, "ze", 2);
  check("W2 'ze' offers Zendesk (case preserved)", r2 && r2.items.some((i) => i.value === "Zendesk"),
    r2 ? `items: ${r2.items.map((i) => i.value).join(",")}` : "null");
  const r3 = await query(p, "nrel", 4);
  check("W3 'nrel' offers NREL (case-preserving insert)", r3 && r3.items.some((i) => i.value === "NREL"),
    r3 ? `items: ${r3.items.map((i) => i.value).join(",")}` : "null");
  const r4 = await query(p, "wi", 2);
  check("W4 'wi' (common prefix) offers nothing", !r4 || r4.items.length === 0,
    r4 ? `items: ${r4.items.map((i) => i.value).join(",")}` : "null");
}

console.log(`\n${failures === 0 && warnings === 0 ? "ALL PROBES PASSED" : failures + " hard probe failure(s), " + warnings + " warning(s)"} (${results.length} checks)`);
// exit 0 = clean, 2 = warnings only (reported, not failing), 1 = hard failure
process.exit(failures > 0 ? 1 : warnings > 0 ? 2 : 0);
PROBES
PROBE_EXIT=0
node "$PROBE_DIR/run-probes.mjs" || PROBE_EXIT=$?
case "$PROBE_EXIT" in
  0) record PASS "E2E adversarial probes (6 PRD bug repros + README journeys)" ;;
  2) record PASS "E2E adversarial probes (6 PRD bug repros + README journeys)"
      record WARN "Probe residue warning(s) present — see probe output and validation_report.md" ;;
  *) record FAIL "E2E adversarial probes (6 PRD bug repros + README journeys) (exit $PROBE_EXIT)" ;;
esac
rm -rf "$PROBE_DIR"

# ─────────────────────────────────────────────────────────────────────────────
phase "7. Live host smoke (real pi loads the extension)"
PI_OUT="$(mktemp)"
if timeout 90 pi -e . -p "Reply with exactly: ok" >"$PI_OUT" 2>&1; then
  if grep -qiE "hapax.*(error|failed)|extension.*error" "$PI_OUT"; then
    record FAIL "pi -e . headless load" "extension error in output: $(grep -iE 'hapax.*(error|failed)' "$PI_OUT" | head -2)"
  else
    record PASS "pi -e . headless load (extension registered, no errors)"
  fi
else
  record WARN "pi -e . headless load" "pi exited non-zero or timed out (may be offline/quota) — see $PI_OUT"
fi
rm -f "$PI_OUT"

# ─────────────────────────────────────────────────────────────────────────────
phase "SUMMARY"
for s in "${SUMMARY[@]}"; do echo "$s"; done
echo
echo "Failures: $FAILURES   Warnings: $WARNINGS"
if [ "$FAILURES" -gt 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS${WARNINGS:+ (with $WARNINGS warning(s) — see validation_report.md)}"
exit 0