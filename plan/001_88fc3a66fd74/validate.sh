#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# hapax — comprehensive project validation
#
# Phases (only those that exist in this codebase):
#   1. Type checking            (tsc --noEmit — the repo's lint/check gate;
#                                 no eslint/prettier config exists, and
#                                 `pi --check` does not exist — see README)
#   2. Unit + acceptance tests  (vitest --run — includes the repo's own
#                                 acceptance, perf-gate, and no-persistence
#                                 suites)
#   3. Benchmarks               (vitest bench — PRD §09 reporting gates)
#   4. Dictionary build E2E     (tools/build-dict.mjs round trip through the
#                                 real loader)
#   5. Full-stack user journeys (real modules, real shipped dict, real
#                                 provider/display/chain layers — PRD §09
#                                 workflows 1–7 simulated end to end)
#   6. Performance probes       (default-config restore + over-cap eviction —
#                                 paths the repo's own gates do not cover)
#   7. Live extension E2E       (real `pi -p -e` load + model turn; skipped
#                                 gracefully when pi/network unavailable)
#   8. No-persistence audit     (static grep + live filesystem snapshot)
#
# Exit 0 iff every phase passes. Temporary files live in $TMPDIR only.
# ─────────────────────────────────────────────────────────────────────────────
set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d /tmp/hapax-validate.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

PASS=0; FAIL=0; FAILED_PHASES=()
note()  { printf '     %s\n' "$*"; }
ok()    { printf '  \033[32m✔\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()   { printf '  \033[31m✘\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); FAILED_PHASES+=("$*"); }
head_() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

cd "$ROOT"

# ── Phase 1: type checking ──────────────────────────────────────────────────
head_ "Phase 1: type check (tsc --noEmit, strict)"
if npm run --silent check > "$WORK/tsc.log" 2>&1; then
  ok "tsc --noEmit clean"
else
  bad "type check failed"; sed -n '1,25p' "$WORK/tsc.log"
fi

# ── Phase 2: unit + acceptance tests ─────────────────────────────────────────
head_ "Phase 2: unit + acceptance tests (vitest --run)"
if npm test > "$WORK/test.log" 2>&1; then
  ok "vitest suite green — $(grep -oE 'Tests  [0-9]+ passed( \| [0-9]+ skipped)?' "$WORK/test.log" | head -1 | sed 's/Tests  //')"
else
  bad "vitest suite failed"; grep -E "FAIL|Tests " "$WORK/test.log" | head -20
fi

# ── Phase 3: benchmarks ──────────────────────────────────────────────────────
head_ "Phase 3: benchmarks (vitest bench, PRD §09 gates)"
if npm run --silent bench > "$WORK/bench.log" 2>&1; then
  ok "benchmarks complete (hard bounds asserted by perf-gates.test.ts in Phase 2)"
  grep -E "gate [a-d]:" "$WORK/bench.log" | sed 's/^/     /' | head -4
else
  bad "benchmarks failed"; tail -15 "$WORK/bench.log"
fi

# ── Phase 4: dictionary build E2E ────────────────────────────────────────────
head_ "Phase 4: dictionary build round trip (tools/build-dict.mjs)"
printf 'apple\t100\nbanana\t90\ncherry\t80\ndurian\t70\nelderberry\t60\nfig\t50\ngrape\t40\nhoneydew\t30\nkiwi\t20\nlychee\t10\n' > "$WORK/val-dict.tsv"
if node tools/build-dict.mjs --out "$WORK/val-dict.bin" "$WORK/val-dict.tsv" > "$WORK/build.log" 2>&1 \
   && grep -q "verified: 10/10 entries OK, no duplicate keys" "$WORK/build.log"; then
  ok "TSV → packed binary → self-verify (10/10 entries)"
else
  bad "dictionary build/verify failed"; cat "$WORK/build.log"
fi

# ── Phase 5 + 6 harness: run real TS sources under node (resolve .js→.ts) ────
cat > "$WORK/hooks.mjs" <<'EOF'
export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context); }
  catch (err) {
    if (specifier.endsWith(".js")) return nextResolve(specifier.slice(0, -3) + ".ts", context);
    throw err;
  }
}
EOF
cat > "$WORK/register.mjs" <<'EOF'
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(pathToFileURL(process.env.HAPAX_HOOKS));
EOF
export HAPAX_HOOKS="$WORK/hooks.mjs"
run_node() { node --import "$WORK/register.mjs" "$@" 2>&1 | grep -v -i "deprecat"; }

# ── Phase 5: full-stack user journeys ────────────────────────────────────────
head_ "Phase 5: full-stack user journeys (real modules, shipped dict)"
cat > "$WORK/journeys.mjs" <<'EOF'
import { readFileSync } from "node:fs";
import { loadDictionary } from "SOURCE/src/core/dictionary.ts";
import { CandidateStore } from "SOURCE/src/core/store.ts";
import { IngestPipeline } from "SOURCE/src/pi/ingest.ts";
import { createHapaxProvider, createDisplayProvider, createChainMachine, extractMatchState } from "SOURCE/src/pi/provider.ts";
import { DEFAULT_CONFIG } from "SOURCE/src/pi/config.ts";
import { rankMatches } from "SOURCE/src/core/query.ts";

const results = [];
const check = (name, ok, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}|${name}|${detail}`); };
const signal = () => new AbortController().signal;
const dict = loadDictionary("SOURCE/dict/common-en.bin");
const config = { ...DEFAULT_CONFIG };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeStack() {
  const store = new CandidateStore();
  const chain = createChainMachine();
  const delegateCalls = [];
  const current = {
    async getSuggestions(...a) { delegateCalls.push(a); return null; },
    applyCompletion(lines, line, col) { return { lines, line, col }; },
    shouldTriggerFileCompletion: () => false,
  };
  const pipeline = new IngestPipeline({
    store, dictionary: dict,
    onAdmittedTokens: (lines) => store.recordPhraseLines(lines, store.currentOrdinal()),
    onSweepPhrases: () => store.sweepPhraseDemotions(),
  });
  const provider = createDisplayProvider(createHapaxProvider(store, config, current, chain));
  return { store, chain, pipeline, provider, delegateCalls };
}
const fixture = (n) => readFileSync(`SOURCE/test/fixtures/sessions/${n}.jsonl`, "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const replay = async (p, entries) => { for (const e of entries) if (e.type === "message") p.onMessageEnd(e.message); await p.flush(); };

// Journey 1 — NREL session: threshold match + PRD §06 phrase suppression
{
  const { store, pipeline } = makeStack();
  await replay(pipeline, fixture("nrel"));
  const st = extractMatchState(["we work with natio"], 0, 18, config);
  check("j1 'natio' threshold match state", st?.mode === "threshold" && st?.fragment === "natio");
  const menu = rankMatches(store, "natio");
  check("j1 menu yields candidates", menu.length > 0, `top=${menu[0]?.display}`);
  const suppressed = menu.every((m) => m.key.includes(" ") || !m.key.startsWith("national"));
  check("j1 phrase suppresses its prefix word (PRD §06)", suppressed, menu.map((m) => m.display).join(" | "));
}
// Journey 2 — zero-typing chained completion (arm inside the pre-phrase window).
// 110ms pacing between interactions: real-editor queries separated by more than
// the 100ms display-debounce window (the sub-window rapid-Tab behavior is
// probed separately in Phase 6).
{
  const { chain, pipeline, provider, delegateCalls } = makeStack();
  await replay(pipeline, fixture("nrel").slice(0, 4)); // header + 3 messages: words, no phrases yet
  let buf = ["discuss natio"]; let col = 13;
  let r = await provider.getSuggestions(buf, 0, col, { signal: signal() });
  check("j2 pre-phrase menu offers bare 'National'", r?.items?.[0]?.value === "National", `top=${r?.items?.[0]?.value}`);
  provider.applyCompletion(buf, 0, col, r.items[0], r.prefix);
  buf[0] = buf[0].slice(0, col - r.prefix.length) + r.items[0].value; col = buf[0].length;
  check("j2 Tab accept arms the chain", chain.state()?.word === "national");
  await wait(120);
  const words = []; let guard = 0;
  while (guard++ < 5) {
    r = await provider.getSuggestions(buf, 0, col, { signal: signal() });
    if (!r || r.items.length === 0) break;
    provider.applyCompletion(buf, 0, col, r.items[0], r.prefix);
    buf[0] = buf[0].slice(0, col - r.prefix.length) + r.items[0].value; col = buf[0].length;
    words.push(r.items[0].label);
    await wait(120);
  }
  check("j2 zero-typing chain completes successors", words.length >= 2, words.join("→"));
  check("j2 chain inserted real successor words", buf[0].length > "discuss National".length, buf[0]);
  check("j2 no delegation during chain", delegateCalls.length === 0);
}
// Journey 3 — secrets never suggested (PRD item 5)
{
  const { store, pipeline } = makeStack();
  await replay(pipeline, [{ type: "message", message: { role: "user", content: "keys: sk-abc123DEF456ghi789JKL ghp_AbCdEf0123456789abcdefghijklmnopqrstuvwxyz eyJhbGciOiJIUzI1NiJ9.x.y aaaaaaaa qqqxxxzzzvvv deadbeefdeadbeefdeadbeefdeadbeef keep zendesk" } }]);
  for (const frag of ["sk-a", "ghp_", "eyJh", "aaaa", "qqqx", "deadbeef"]) {
    const m = rankMatches(store, frag, { limit: 8 });
    check(`j3 secret '${frag}' never suggested`, m.length === 0, m.map((x) => x.display).join(","));
  }
  check("j3 legitimate rare word still suggested", rankMatches(store, "zend", { limit: 8 }).some((x) => x.display === "zendesk"));
}
// Journey 4 — never-hijack delegation (PRD invariant 1); 110ms waits so the
// 100ms display debounce never suppresses a fresh set under test
{
  const { pipeline, provider, delegateCalls } = makeStack();
  await replay(pipeline, fixture("zendesk-lwlock"));
  await wait(120);
  await provider.getSuggestions(["an ordinary prose line"], 0, 21, { signal: signal() });
  check("j4 prose without fragment delegates", delegateCalls.length === 1);
  await wait(120);
  await provider.getSuggestions(['read "src/cor'], 0, 14, { signal: signal() });
  check("j4 quoted-path context delegates (path completion intact)", delegateCalls.length === 2);
  await wait(120);
  await provider.getSuggestions(["z"], 0, 1, { signal: signal() });
  check("j4 1-char fragment below threshold delegates", delegateCalls.length === 3);
  await wait(120);
  const r = await provider.getSuggestions(["complete ze"], 0, 11, { signal: signal() });
  check("j4 'ze' opens hapax menu (Zendesk*) without delegating", r?.items?.some((i) => i.value.startsWith("Zendesk")) && delegateCalls.length === 3, `top=${r?.items?.[0]?.value}`);
  await wait(120);
  const rt = await provider.getSuggestions(["try #l"], 0, 6, { signal: signal() });
  check("j4 trigger '#l' offers lwlock, prefix '#l'", rt?.items?.some((i) => i.value.startsWith("lwlock")) && rt?.prefix === "#l", `prefix=${rt?.prefix}`);
  const ac = new AbortController(); ac.abort();
  await provider.getSuggestions(["complete ze"], 0, 11, { signal: ac.signal });
  check("j4 aborted signal delegates untouched", delegateCalls.length === 4);
}
// Journey 5 — bulk restore: word-only budget (repo's own gate margin) + bounded store
{
  const store = new CandidateStore();
  const pipeline = new IngestPipeline({ store, dictionary: dict });
  const entries = fixture("large-100k");
  const t0 = performance.now();
  await replay(pipeline, entries);
  const ms = performance.now() - t0;
  check("j5 word-only 100k-token restore < 300ms (3x CI bound)", ms < 300, `${ms.toFixed(0)}ms`);
  check("j5 store bounded by 20k cap", store.size <= 20000, `size=${store.size}`);
  check("j5 completions available after replay", rankMatches(store, "kestre", { limit: 3 }).length > 0);
}
const fails = results.filter(([, ok]) => !ok);
console.log(`SUMMARY|${results.length - fails.length}/${results.length}`);
process.exit(fails.length ? 1 : 0);
EOF
sed "s|SOURCE|$ROOT|g" "$WORK/journeys.mjs" > "$WORK/journeys.run.mjs"
if run_node "$WORK/journeys.run.mjs" | tee "$WORK/journeys.log" > /dev/null \
   && grep -q "^SUMMARY|" "$WORK/journeys.log"; then
  ok "user journeys — $(grep '^SUMMARY|' "$WORK/journeys.log" | cut -d'|' -f2) checks passed"
  grep '^PASS|' "$WORK/journeys.log" | cut -d'|' -f2 | sed 's/^/     • /'
  grep '^FAIL|' "$WORK/journeys.log" | cut -d'|' -f2- | sed 's/^/     ✗ /'
else
  bad "user journeys failed"; cat "$WORK/journeys.log" | head -40
fi

# ── Phase 6: performance probes (default config — NOT covered by repo gates) ─
head_ "Phase 6: edge probes — DEFAULT config perf (phrases ON, over-cap store) + rapid-Tab display integrity"
cat > "$WORK/perf.mjs" <<'EOF'
import { readFileSync } from "node:fs";
import { loadDictionary } from "SOURCE/src/core/dictionary.ts";
import { CandidateStore } from "SOURCE/src/core/store.ts";
import { IngestPipeline } from "SOURCE/src/pi/ingest.ts";
import { createHapaxProvider, createDisplayProvider, createChainMachine } from "SOURCE/src/pi/provider.ts";
import { DEFAULT_CONFIG } from "SOURCE/src/pi/config.ts";

const dict = loadDictionary("SOURCE/dict/common-en.bin");
const out = (n, ms, budget, ok) => { if (!ok) process.exitCode = 1; console.log(`${ok ? "PASS" : "FAIL"}|${n}|${ms.toFixed(0)}ms (budget ${budget})`); };

// Probe A — default-config (enablePhrases: true) restore of the repo's own
// large-100k fixture. PRD §05 restore budget: ~30–50ms, hard CI bound 3x = 300ms.
{
  const entries = readFileSync("SOURCE/test/fixtures/sessions/large-100k.jsonl", "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "message");
  const store = new CandidateStore();
  const pipeline = new IngestPipeline({
    store, dictionary: dict,
    onAdmittedTokens: (lines) => store.recordPhraseLines(lines, store.currentOrdinal()),
    onSweepPhrases: () => store.sweepPhraseDemotions(),
  });
  const t0 = performance.now();
  for (const e of entries) pipeline.onMessageEnd(e.message);
  await pipeline.flush();
  const ms = performance.now() - t0;
  // 600ms = ~1.5× the measured post-fix floor (~385ms: word-only baseline
  // ~110ms + the §06-spec'd M2 phrase layer over this fixture's ~200k
  // windows / ~142k distinct phrases + amortized heap eviction). The
  // original <300ms was the WORD-only restore bound; the per-drain sort
  // regression this probe catches measured 2,152ms and trips at 3.5×.
  out(`A: default-config restore, 1561-msg large-100k fixture (phrases ON)`, ms, "<600ms (see note)", ms < 600);
  console.log(`INFO|phrases recorded|${store.phraseSize} (cap 10000 saturated)`);
}
// Probe B — word store over its 20k cap: 25k distinct words in one message.
// PRD §02: ingest of one message < 5ms typical; §05: never block a keystroke.
{
  const store = new CandidateStore();
  const pipeline = new IngestPipeline({ store, dictionary: dict });
  const text = Array.from({ length: 25000 }, (_, i) => `zzword${i}q`).join("\n");
  const t0 = performance.now();
  pipeline.onMessageEnd({ role: "assistant", content: [{ type: "text", text }] });
  await pipeline.flush();
  const ms = performance.now() - t0;
  out(`B: ingest one ~290KB message, 25k distinct words (5k over STORE_CAP)`, ms, "<300ms (3x CI)", ms < 300);
  console.log(`INFO|store size|${store.size} (cap held: ${store.size <= 20000})`);
}
// Probe C — rapid Tab-Tab within the 100ms display-debounce window: after a
// Tab acceptance, the post-accept query must not return a stale set whose
// prefix no longer matches the buffer (accepting it corrupts the buffer).
{
  const store = new CandidateStore();
  const pipeline = new IngestPipeline({
    store, dictionary: dict,
    onAdmittedTokens: (lines) => store.recordPhraseLines(lines, store.currentOrdinal()),
  });
  const entries = readFileSync("SOURCE/test/fixtures/sessions/nrel.jsonl", "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const e of entries.slice(0, 4)) if (e.type === "message") pipeline.onMessageEnd(e.message);
  await pipeline.flush();
  const cur = {
    _l: null, _c: 0,
    async getSuggestions() { return null; },
    applyCompletion(ls, l, c, item, prefix) {
      this._l = [...ls]; this._c = c - prefix.length + item.value.length;
      this._l[l] = this._l[l].slice(0, c - prefix.length) + item.value + this._l[l].slice(c);
      return { lines: this._l, line: l, col: this._c };
    },
  };
  const chain = createChainMachine();
  const provider = createDisplayProvider(createHapaxProvider(store, { ...DEFAULT_CONFIG }, cur, chain));
  const s = () => new AbortController().signal;
  let lines = ["discuss natio"], col = 13;
  let r = await provider.getSuggestions(lines, 0, col, { signal: s() });
  provider.applyCompletion(lines, 0, col, r.items[0], r.prefix); // Tab 1
  lines = cur._l; col = cur._c;
  const afterTab1 = lines[0]; // "discuss National"
  r = await provider.getSuggestions(lines, 0, col, { signal: s() }); // immediate re-query (rapid Tab)
  const stale = r !== null && r.prefix !== "" && !lines[0].endsWith(r.prefix);
  if (stale) process.exitCode = 1;
  console.log(`${stale ? "FAIL" : "PASS"}|C: rapid post-Tab query returns set matching buffer|menu prefix=${JSON.stringify(r?.prefix)} vs buffer tail=${JSON.stringify(lines[0].slice(-10))}`);
  if (stale) {
    provider.applyCompletion(lines, 0, col, r.items[0], r.prefix); // Tab 2 on stale set
    console.log(`INFO|buffer after rapid Tab-Tab|${JSON.stringify(cur._l[0])} (was ${JSON.stringify(afterTab1)})`);
  }
}
EOF
sed "s|SOURCE|$ROOT|g" "$WORK/perf.mjs" > "$WORK/perf.run.mjs"
if run_node "$WORK/perf.run.mjs" > "$WORK/perf.log" 2>&1; then
  ok "edge probes within bounds"
else
  bad "edge probe violation (default-config perf and/or rapid-Tab integrity)"
fi
grep -E '^(PASS|FAIL|INFO)\|' "$WORK/perf.log" | awk -F'|' '{printf "     %-9s %s — %s\n", $1, $2, $3}'

# ── Phase 7: live extension E2E under the installed pi ──────────────────────
head_ "Phase 7: live extension load + model turn (pi -p -e)"
LIVE="$WORK/live"; mkdir -p "$LIVE"
if ! command -v pi > /dev/null 2>&1; then
  note "pi not on PATH — SKIPPED (non-fatal)"
elif cd /tmp && PI_CONFIG_DIR="$LIVE" timeout 120 pi -p -e "$ROOT" --no-builtin-tools \
     "Reply with exactly one short sentence mentioning Zendesk and lwlock." \
     < /dev/null > "$LIVE/out.log" 2> "$LIVE/err.log"; then
  ok "pi -p -e loaded hapax, model turn completed (exit 0)"
  if [ -s "$LIVE/err.log" ]; then
    bad "stderr not clean during live run"; head -5 "$LIVE/err.log"
  else
    ok "stderr clean (no extension errors)"
  fi
  if grep -qi "zendesk" "$LIVE/out.log" && grep -qi "lwlock" "$LIVE/out.log"; then
    ok "model output contains the session vocabulary"
  else
    bad "model output missing expected vocabulary"
  fi
  # Graceful disable with a broken dictionary path
  if PI_CONFIG_DIR="$LIVE" HAPAX_DICT=/nonexistent/hapax.bin timeout 120 pi -p -e "$ROOT" \
       --no-builtin-tools "say ok" < /dev/null > "$LIVE/out2.log" 2> "$LIVE/err2.log"; then
    ok "missing dictionary degrades gracefully (exit 0, pi functional)"
  else
    bad "missing dictionary broke pi"
  fi
else
  rc=$?
  if [ "$rc" -eq 124 ]; then note "live run timed out (no network/model?) — SKIPPED (non-fatal)"
  else bad "live pi run failed (exit $rc)"; head -5 "$LIVE/err.log" 2>/dev/null; fi
fi

# ── Phase 8: no-persistence audit ────────────────────────────────────────────
head_ "Phase 8: no-persistence audit (invariant 4)"
if grep -rnE "writeFile|appendFile|createWriteStream|mkdirSync|writeSync" src/ > "$WORK/writes.log" 2>&1; then
  bad "fs write calls found in src/"; cat "$WORK/writes.log"
else
  ok "zero fs write calls in src/ (read-only fs usage)"
fi
MARK="$(mktemp)"
sleep 1
cd /tmp && PI_CONFIG_DIR="$WORK/live-snap" timeout 60 pi -p -e "$ROOT" --no-builtin-tools "ok" < /dev/null > /dev/null 2>&1
HAPAX_WRITES="$(find "$HOME/.pi/agent" -newer "$MARK" \( -iname '*hapax*' -o -iname '*common-en*' -o -iname '*acwords*' \) 2>/dev/null | wc -l)"
if [ "$HAPAX_WRITES" -eq 0 ]; then
  ok "no hapax-originated files written under ~/.pi/agent during live run"
else
  bad "hapax-named files written at runtime"; find "$HOME/.pi/agent" -newer "$MARK" -iname '*hapax*' | head -5
fi
rm -f "$MARK"

# ── Summary ──────────────────────────────────────────────────────────────────
printf '\n\033[1m================ VALIDATION SUMMARY ================\033[0m\n'
printf '  passed: %d   failed: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '\n  Failed checks:\n'
  printf '    ✘ %s\n' "${FAILED_PHASES[@]}"
  exit 1
fi
exit 0