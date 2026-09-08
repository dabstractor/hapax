#!/usr/bin/env bash
# =============================================================================
# hapax — comprehensive validation script
#
# Phases (only those that exist in this codebase are included):
#   1. Type checking            — npm run check (tsc --noEmit, strict)
#   2. Lint / style             — no linter/formatter is configured in this
#                                 repo (no eslint/prettier/biome configs);
#                                 the type check + tests are the green gates
#   3. Unit + acceptance tests  — npx vitest --run (33 files, ~640 tests,
#                                 includes perf-gates hard bounds + the
#                                 adversarial regression suites)
#   4. Performance benchmarks   — npx vitest bench --run (PRD §09 gates)
#   5. Dictionary artifact      — rebuild from the vendored corpus and
#      integrity                  byte-compare against the shipped binary;
#                                  re-run tools/calibrate-bands.mjs
#   6. End-to-end user journeys — drives the REAL extension factory
#      (embedded probe script)     (src/pi/index.ts), real ingest pipeline,
#                                  real shipped dictionary, and real provider
#                                  through the PRD §09 / README workflows:
#                                  jargon completion, trigger char, forced
#                                  Tab single-item, chained completion with
#                                  zero typed chars, chain reset on new turn,
#                                  secrets never suggested, prose no-hijack,
#                                  delegation with unchanged args, abort
#                                  handling, session restore, thinking-block
#                                  exclusion, config layering/repair/trust,
#                                  bigram adjacency window rules, CJK and
#                                  Unicode-adjacency segmentation, one-word
#                                  invariant, enableChaining gating, and the
#                                  zero-persistence guarantee.
#   7. Working-tree hygiene     — no stray files created by validation
#
# Exit 0 = every phase passed. Any phase failure prints a FAIL line and the
# script exits 1 at the end.
# =============================================================================
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

FAILURES=0
phase() { printf '\n=== %s ===\n' "$1"; }
fail()  { echo "FAIL: $1"; FAILURES=$((FAILURES + 1)); }
pass()  { echo "PASS: $1"; }

# ---------------------------------------------------------------- preflight
phase "0. Environment preflight"
command -v node >/dev/null 2>&1 || { fail "node not found"; exit 1; }
command -v npm  >/dev/null 2>&1 || { fail "npm not found"; exit 1; }
[ -d node_modules ] || { echo "installing dependencies..."; npm ci --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1 || { fail "dependency install"; exit 1; }; }
echo "node $(node --version) · repo $REPO"

# ---------------------------------------------------------------- phase 1
phase "1. Type checking (tsc --noEmit, strict)"
if npm run --silent check; then pass "type check clean"; else fail "npm run check"; fi

# ---------------------------------------------------------------- phase 2
phase "2. Lint / style"
# No lint/format tooling is configured in this repo (verified: no
# .eslintrc*, .prettierrc*, biome.json, Makefile lint targets). The PRD §09
# DoD substitutes `npm run check` for the non-existent `pi --check` —
# already covered by phase 1.
if ls .eslintrc* .prettierrc* biome.json 2>/dev/null | grep -q .; then
  echo "lint config detected but no lint phase wired — check manually"
else
  echo "no linter/formatter configured in this repo (tsc strict is the gate) — skipped"
fi

# ---------------------------------------------------------------- phase 3
phase "3. Unit + acceptance tests (vitest --run)"
TEST_LOG="$(mktemp)"
if timeout 900 npx vitest --run >"$TEST_LOG" 2>&1; then
  tail -n 6 "$TEST_LOG" | grep -E "Test Files|Tests|Duration" || true
  pass "full test suite green"
else
  tail -n 40 "$TEST_LOG"
  fail "unit test suite"
fi
rm -f "$TEST_LOG"

# ---------------------------------------------------------------- phase 4
phase "4. Performance benchmarks (PRD §09 gates)"
BENCH_LOG="$(mktemp)"
if timeout 900 npx vitest bench --run >"$BENCH_LOG" 2>&1; then
  grep -E "gate [a-d]:" "$BENCH_LOG" || true
  pass "benchmark suite green (hard bounds also asserted in phase 3 perf-gates)"
else
  tail -n 30 "$BENCH_LOG"
  fail "benchmark suite"
fi
rm -f "$BENCH_LOG"

# ---------------------------------------------------------------- phase 5
phase "5. Dictionary artifact integrity"
TMPD="$(mktemp -d)"
if node tools/build-dict.mjs --out "$TMPD/rebuilt.bin" tools/corpus/en-50k.tsv >"$TMPD/build.log" 2>&1 \
   && cmp -s dict/common-en.bin "$TMPD/rebuilt.bin"; then
  grep -E "^verified:" "$TMPD/build.log"
  pass "shipped dict/common-en.bin reproduces byte-identically from the vendored corpus (deterministic build)"
else
  cat "$TMPD/build.log" 2>/dev/null
  fail "dictionary rebuild does not match shipped artifact"
fi
if node tools/calibrate-bands.mjs >"$TMPD/calib.log" 2>&1; then
  grep -m1 "constants" "$TMPD/calib.log"
  grep -m1 "band populations" "$TMPD/calib.log"
  pass "admission-band calibration re-verified against the shipped artifact"
else
  cat "$TMPD/calib.log" 2>/dev/null
  fail "tools/calibrate-bands.mjs"
fi

# ---------------------------------------------------------------- phase 6
phase "6. End-to-end user journeys (real extension + real shipped dict)"

# 6a. loader hook so plain node can import the TypeScript sources
cat > "$TMPD/ts-resolve.mjs" <<'HOOK'
import { fileURLToPath, pathToFileURL } from "node:url";
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    const base = context.parentURL ? new URL(specifier, context.parentURL) : null;
    if (base) {
      const ts = fileURLToPath(base).replace(/\.js$/, ".ts");
      try {
        const fs = await import("node:fs");
        if (fs.statSync(ts).isFile()) {
          return { url: pathToFileURL(ts).href, shortCircuit: true, format: "module-typescript" };
        }
      } catch {}
    }
  }
  return next(specifier, context);
}
HOOK
cat > "$TMPD/register.mjs" <<HOOK
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("$TMPD/ts-resolve.mjs", pathToFileURL("$TMPD/"));
HOOK

# 6b. the journey probe — exercises the production modules end to end
cat > "$TMPD/probe-all.mjs" <<'PROBE'
#!/usr/bin/env node
// =====================================================================
// hapax consolidated E2E validation probe (generated by validate.sh).
// Drives the REAL extension factory, pipeline, shipped dictionary, and
// provider through complete user journeys mirroring README/PRD §09.
// Exit code 0 = all journeys pass; any FAIL line => exit 1.
// =====================================================================
const R = process.env.HAPAX_REPO_ROOT;
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };

const { default: hapax } = await import(`${R}/src/pi/index.ts`);
const { resolveDictPath } = await import(`${R}/src/pi/paths.ts`);
const { loadDictionary } = await import(`${R}/src/core/dictionary.ts`);
const { loadConfig } = await import(`${R}/src/pi/config.ts`);
const { tokenize } = await import(`${R}/src/core/segment.ts`);
const { CandidateStore } = await import(`${R}/src/core/store.ts`);
const { IngestPipeline, extractText } = await import(`${R}/src/pi/ingest.ts`);
const { rankMatches } = await import(`${R}/src/core/query.ts`);
const { createHapaxProvider, createChainMachine } = await import(`${R}/src/pi/provider.ts`);
const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");

process.env.HAPAX_DICT = resolveDictPath();
const dict = loadDictionary(resolveDictPath());
const O = () => ({ signal: new AbortController().signal });
const currentProvider = {
  lastArgs: null,
  async getSuggestions(lines, l, c, options) { this.lastArgs = { lines, l, c, options }; return { items: [{ value: "stock", label: "stock" }], prefix: "x" }; },
  applyCompletion(lines, cl, cc, item, prefix) {
    const line = lines[cl]; const before = line.slice(0, cc - prefix.length); const after = line.slice(cc);
    const out = [...lines]; out[cl] = before + item.value + after;
    return { lines: out, cursorLine: cl, cursorCol: before.length + item.value.length };
  },
  shouldTriggerFileCompletion() { return true; },
};
const mkPi = () => {
  const handlers = new Map();
  let factory = null;
  const mkCtx = (history = []) => ({
    cwd: R, isProjectTrusted: () => true,
    ui: { notify: () => {}, addAutocompleteProvider: (f) => { factory = f; } },
    sessionManager: { getBranch: () => history, getEntries: () => history },
  });
  return { pi: { on: (ev, h) => handlers.set(ev, h), registerCommand: () => {} }, handlers, factory: () => factory, mkCtx };
};

// ------------------------------------------------ Journey 1: jargon completion + chaining (PRD §09 items 1 + 7)
{
  const { pi, handlers, factory, mkCtx } = mkPi();
  hapax(pi);
  handlers.get("session_start")({ type: "session_start", reason: "new" }, mkCtx());
  handlers.get("message_end")({ type: "message_end", message: { role: "user", content: "We need to check the Zendesk ticket queue and also the lwlock contention in postgres." } });
  handlers.get("message_end")({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "The Zendesk queue is clear. The lwlock issue is in the buffer manager. Also see the Acme Zephyr Noria Inverter report on lock contention." }] } });
  await new Promise(r => setTimeout(r, 450));
  const provider = factory()(currentProvider);

  let r = await provider.getSuggestions(["We need the ze"], 0, 14, O());
  assert(r && r.items[0]?.value === "Zendesk" && r.prefix === "ze", `journey1 "ze" -> top item Zendesk, prefix "ze"`);

  r = await provider.getSuggestions(["the lw"], 0, 6, O());
  assert(r?.items?.some(i => i.value === "lwlock"), `journey1 "lw" -> lwlock offered`);

  r = await provider.getSuggestions(["check #z"], 0, 8, O());
  assert(r && r.prefix === "#z" && r.items.some(i => i.value === "Zendesk"), `journey1 trigger "#z" -> Zendesk, prefix "#z"`);

  r = await provider.getSuggestions(["#"], 0, 1, O());
  assert(r && r.items.length > 0, `journey1 bare "#" lists top candidates (${r?.items?.length} items)`);

  // trigger-mode regex pins (PRD §09 provider tests)
  r = await provider.getSuggestions(["foo #ze"], 0, 7, O());
  assert(r && r.prefix === "#ze" && r.items.some(i => i.value === "Zendesk"), `journey1 "foo #ze" (space before #) -> trigger match, prefix "#ze"`);
  r = await provider.getSuggestions(["foo#ze"], 0, 6, O());
  assert(r && r.prefix === "ze" && r.items.some(i => i.value === "Zendesk"), `journey1 "foo#ze" (no space) -> no TRIGGER match; threshold fragment "ze", prefix "ze"`);
  r = await provider.getSuggestions(["foo ##ze"], 0, 8, O());
  assert(r && r.prefix === "ze" && r.items.some(i => i.value === "Zendesk"), `journey1 "foo ##ze" -> no TRIGGER match (## rejected); threshold fragment "ze"`);
  r = await provider.getSuggestions(["##"], 0, 2, O());
  assert(r?.items?.[0]?.value === "stock", `journey1 bare "##" -> no trigger, no fragment -> delegates`);

  // forced single-item (Tab-before-paint, PRD §07 h3.8)
  r = await provider.getSuggestions(["the ze"], 0, 6, { signal: new AbortController().signal, force: true });
  assert(r && r.items.length === 1 && r.items[0].value === "Zendesk", `journey1 forced + live fragment -> EXACTLY one item`);

  // chain journey: accept Acme -> zero-char successor -> Tab walk.
  // Walk words are dictionary-absent/rare (2026-09 Issue-1 retune made the
  // old National/renewable/energy/laboratory walk reject-band on this
  // corpus). Successor items carry the candidate DISPLAY casing (Issue-2
  // fix) — "Zephyr", not "zephyr".
  r = await provider.getSuggestions(["acme"], 0, 4, O());
  assert(r?.items?.some(i => i.value === "Acme"), `journey1 "acme" -> Acme offered`);
  const applied = provider.applyCompletion(["acme"], 0, 4, r.items.find(i => i.value === "Acme"), r.prefix);
  assert(applied.lines[0] === "Acme", `journey1 Tab inserts "Acme"`);
  r = await provider.getSuggestions(["Acme "], 0, 5, O());
  assert(r && r.prefix === "" && r.items.length > 0, `journey1 zero-char successor offer at prefix "" (${JSON.stringify(r?.items?.map(i=>i.value))})`);
  assert(r.items[0].value === "Zephyr", `journey1 chain item value uses candidate display casing ("Zephyr", got ${JSON.stringify(r.items[0].value)})`);
  assert(r.items.every(i => !/\s/.test(i.value)), `journey1 one-word invariant on chain items`);

  // before_agent_start resets the chain
  handlers.get("before_agent_start")({ type: "before_agent_start" });
  r = await provider.getSuggestions(["Acme "], 0, 5, O());
  assert(r?.items?.[0]?.value === "stock", `journey1 before_agent_start resets chain (delegates)`);

  // shutdown disposes cleanly
  handlers.get("session_shutdown")();
}

// ------------------------------------------------ Journey 2: secrets never suggested (PRD §09 item 5)
{
  const { pi, handlers, factory, mkCtx } = mkPi();
  hapax(pi);
  handlers.get("session_start")({ type: "session_start", reason: "new" }, mkCtx());
  handlers.get("message_end")({ type: "message_end", message: { role: "user", content: `AWS AKIAIOSFODNN7EXAMPLE and wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
ghp_16CharactersXXXXXXXXXXXXXXXXXXXXXXXX sk-ant-api03-AAAA753VyxaX2Xv9vTzHr8BxmXJq3Z9k2vNabc
sk-proj-abcdefghijklmnopqrstuv1234567890abcdefgh xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U
AIzaSyA1234567890abcdefghijklmnopqrstuvw 0123456789abcdef0123456789abcdef0123456789abcdef0123
Plain ZendeskNormalWord positive control.` } });
  await new Promise(r => setTimeout(r, 450));
  const provider = factory()(currentProvider);
  for (const p of ["wjal", "bpxr", "ghp", "skan", "xoxb", "eyjh", "aizas", "dozj", "0123"]) {
    const r = await provider.getSuggestions([p], 0, p.length, O());
    const vals = (r?.items ?? []).map(i => i.value);
    assert(!vals.some(v => v !== "stock"), `journey2 secret probe "${p}" -> no hapax candidates (${JSON.stringify(vals)})`);
  }
  const r = await provider.getSuggestions(["#"], 0, 1, O());
  const top = (r?.items ?? []).map(i => i.value);
  assert(!top.some(v => /example|wjal|abcdefghijklmnop|dozj|aaaa753/i.test(v)), `journey2 bare # top list clean (${JSON.stringify(top)})`);
  assert(top.includes("ZendeskNormalWord"), `journey2 positive control present (${JSON.stringify(top)})`);
  handlers.get("session_shutdown")();
}

// ------------------------------------------------ Journey 3: no-hijack + reject-band delegation
{
  const { pi, handlers, factory, mkCtx } = mkPi();
  hapax(pi);
  handlers.get("session_start")({ type: "session_start", reason: "new" }, mkCtx());
  const prose = `The quick brown fox jumps over the lazy dog. This is ordinary text with common words like that, with, from, they, have, been, will, would, could, should, there, their, about, which, when, where, while, these, those, other, more, most, some, such, only, also, just, than, then, them, well, because, even, much, still, under, over, again. Context and data and code and time and work and people and thing and world and life and hand and part and child and eye and woman and place and week and case and point and government and company and number and group and problem and fact.`;
  handlers.get("message_end")({ type: "message_end", message: { role: "user", content: prose } });
  await new Promise(r => setTimeout(r, 450));
  const provider = factory()(currentProvider);
  for (const w of ["th", "wi", "fr", "co", "da", "ti", "wo", "pe", "pl", "gr", "pr", "fa", "qu", "ju", "la", "do", "or", "sh", "us"]) {
    const res = await provider.getSuggestions([w], 0, w.length, O());
    const hap = (res?.items ?? []).filter(i => i.value !== "stock");
    if (hap.length > 0) console.log(`  NOTE: ordinary-prose probe "${w}" opened a hapax menu: ${JSON.stringify(hap.map(i => `${i.value}(q=${dict.lookup(i.value.toLowerCase())})`))} (mid-band admission — see report)`);
  }
  // REJECT band (top ~945) must always delegate
  for (const w of ["th", "wi", "fr", "pe", "fa", "sh"]) {
    const res = await provider.getSuggestions([w], 0, w.length, O());
    const hap = (res?.items ?? []).filter(i => i.value !== "stock");
    assert(hap.length === 0, `journey3 reject-band probe "${w}" delegates (got ${JSON.stringify(hap.map(i=>i.value))})`);
  }
  // path context delegates with unchanged args
  currentProvider.lastArgs = null;
  await provider.getSuggestions(["run /home/bin/"], 0, 14, O());
  assert(currentProvider.lastArgs && currentProvider.lastArgs.l === 0 && currentProvider.lastArgs.c === 14, `journey3 path context delegates with unchanged args`);
  // aborted signal delegates
  const ac = new AbortController(); ac.abort();
  const ra = await provider.getSuggestions(["the ze"], 0, 6, { signal: ac.signal });
  assert(ra?.items?.[0]?.value === "stock", `journey3 aborted -> delegates`);
  handlers.get("session_shutdown")();
}

// ------------------------------------------------ Journey 4: session restore (/resume) + thinking exclusion
{
  const { pi, handlers, factory, mkCtx } = mkPi();
  hapax(pi);
  const hist = [
    { type: "message", message: { role: "user", content: "Please review the ZephyrBlaster module." } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "The ZephyrBlaster quuxblat handles retries." }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "thinking", text: "internal reasoning ZendeskSecretWord must not count" }] } },
  ];
  handlers.get("session_start")({ type: "session_start", reason: "resume" }, mkCtx(hist));
  await new Promise(r => setTimeout(r, 300));
  const provider = factory()(currentProvider);
  let r = await provider.getSuggestions(["zep"], 0, 3, O());
  assert(r?.items?.some(i => i.value === "Zephyr"), `journey4 restore: "zep" -> Zephyr subword (${JSON.stringify(r?.items?.map(i=>i.value))})`);
  r = await provider.getSuggestions(["quux"], 0, 4, O());
  assert(r?.items?.some(i => i.value === "quuxblat"), `journey4 restore: "quux" -> quuxblat`);
  r = await provider.getSuggestions(["zendesksecret"], 0, 13, O());
  assert(!r?.items?.some(i => i.value !== "stock"), `journey4 thinking-block content NOT ingested`);
  handlers.get("session_shutdown")();
}

// ------------------------------------------------ Journey 5: config layering / repair / trust
{
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hapax-val-home-"));
  fs.mkdirSync(path.join(home, ".pi/agent"), { recursive: true });
  fs.writeFileSync(path.join(home, ".pi/agent/hapax.json"), JSON.stringify({ threshold: 9, triggerChar: "##", enablePhrases: false, debug: "yes" }));
  let warns = [];
  const cfg = loadConfig({ cwd: "/tmp", projectTrusted: true, notify: (m) => warns.push(m), homeDir: home });
  assert(cfg.threshold === 3 && cfg.triggerChar === "#" && cfg.enableChaining === false && cfg.debug === false, `journey5 repairs invalid values (${JSON.stringify(cfg)})`);
  assert(warns.length >= 3, `journey5 warns on repairs (${warns.length})`);
  fs.writeFileSync(path.join(home, ".pi/agent/hapax.json"), "{not json");
  let mw = [];
  const cfg2 = loadConfig({ cwd: "/tmp", projectTrusted: false, notify: (m) => mw.push(m), homeDir: home });
  assert(cfg2.triggerChar === "#" && mw.length === 1, `journey5 malformed layer -> one warning + defaults`);
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "hapax-val-proj-"));
  fs.mkdirSync(path.join(proj, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(proj, ".pi/hapax.json"), JSON.stringify({ threshold: 1 }));
  const cfg3 = loadConfig({ cwd: proj, projectTrusted: true, notify: () => {}, homeDir: home });
  assert(cfg3.threshold === 1, `journey5 trusted project layer applies (${cfg3.threshold})`);
  const cfg4 = loadConfig({ cwd: proj, projectTrusted: false, notify: () => {}, homeDir: home });
  assert(cfg4.threshold === 2, `journey5 untrusted project layer ignored (${cfg4.threshold})`);
}

// ------------------------------------------------ Journey 6: bigram adjacency window rules (PRD §06 h3.6)
{
  const succ = async (text) => {
    const store = new CandidateStore();
    const pipe = new IngestPipeline({ store, dictionary: dict, onAdmittedTokens: (runs) => store.recordBigramRuns(runs) });
    await pipe.processText(text, true);
    return store;
  };
  assert((await succ("zorpwibble quuxblat repeated often")).topSuccessors("zorpwibble").some(x => x.next === "quuxblat"), `journey6 plain adjacency chains`);
  assert((await succ("ZorpWibbleEngine, quuxblat")).topSuccessors("zorpwibbleengine").length === 0, `journey6 comma breaks`);
  assert((await succ("\`zorpwibble\` \`quuxblat\`")).topSuccessors("zorpwibble").length === 0, `journey6 backticks break`);
  assert((await succ("zorpwibble v2 quuxblat")).topSuccessors("zorpwibble").length === 0, `journey6 digit run breaks`);
  // 2026-09 Issue-1 retune: "united"/"states" moved into the reject band
  // (q ≥ 50), so the stopword-bridge probe uses admitted words instead —
  // the intervening stopword must still break howls→posts bridging.
  const usa = await succ("howls washes of posts");
  assert(usa.topSuccessors("howls").map(x=>x.next).join() === "washes", `journey6 stopword bridging forbidden`);
  assert((await succ("zorpwibble\nquuxblat")).topSuccessors("zorpwibble").length === 0, `journey6 newline breaks`);
  const big = "zorpwibble" + " ".repeat(66000) + "quuxblat " + "a".repeat(70000);
  assert((await succ(big)).topSuccessors("zorpwibble").some(x => x.next === "quuxblat"), `journey6 64KiB chunk boundary does not break`);
}

// ------------------------------------------------ Journey 7: segmentation edge rules (PRD §04)
{
  assert(tokenize("草sword").length === 0, `journey7 "草sword" emits nothing`);
  assert(tokenize("Þórhildur").length === 0, `journey7 "Þórhildur" emits nothing`);
  assert(tokenize("ΩbsidianMirror").length === 0, `journey7 "ΩbsidianMirror" emits nothing`);
  assert(JSON.stringify(tokenize("fix 方法 error").map(t=>t.raw)) === JSON.stringify(["fix","error"]), `journey7 CJK skip, ASCII resumes`);
  assert(JSON.stringify(tokenize("state-of-the-art").map(t=>t.raw)) === JSON.stringify(["state","of","the","art"]), `journey7 hyphen splits`);
  const store = new CandidateStore();
  const pipe = new IngestPipeline({ store, dictionary: dict });
  await pipe.processText("we fixRoundingError often", true);
  assert(rankMatches(store, "roun").map(m => m.display).includes("Rounding"), `journey7 "roun" -> Rounding sub-word`);
  assert(extractText({ role: "assistant", content: [{ type: "toolCall", toolName: "bash", args: { cmd: "x" } }, { type: "text", text: "visibleword" }] }) === "visibleword", `journey7 toolCall blocks skipped`);
  assert(extractText({ role: "user", content: [{ type: "image", data: "x" }, { type: "text", text: "imgword" }] }) === "imgword", `journey7 images ignored`);
  assert(extractText({ role: "toolResult", content: "resultword" }) === null, `journey7 toolResult ignored`);
}

// ------------------------------------------------ Journey 8: enableChaining:false disables only the chain
{
  const store = new CandidateStore();
  const chain = createChainMachine();
  const pipe = new IngestPipeline({ store, dictionary: dict, onAdmittedTokens: (runs) => store.recordBigramRuns(runs) });
  await pipe.processText("Acme Zephyr Noria Inverter matters.", true);
  const cfg = { triggerChar: "#", threshold: 2, maxSuggestions: 8, enableChaining: false, debug: false };
  const prov = createHapaxProvider(store, cfg, currentProvider, chain);
  let r = await prov.getSuggestions(["acme"], 0, 4, O());
  assert(r?.items?.some(i => i.value === "Acme"), `journey8 word completion intact with chaining off`);
  prov.applyCompletion(["acme"], 0, 4, r.items[0], r.prefix);
  assert(chain.state() === null, `journey8 accepting a word never arms with chaining off`);
  r = await prov.getSuggestions(["Acme "], 0, 5, O());
  assert(r?.items?.[0]?.value === "stock", `journey8 no zero-char successor offer with chaining off`);
}

// ------------------------------------------------ Journey 9: no persistence (repo untouched)
{
  const walk = (dir) => {
    const out = []; const skip = new Set(["node_modules", ".git"]);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p)); else out.push(p + ":" + fs.statSync(p).mtimeMs);
    }
    return out.sort().join("|");
  };
  const before = walk(R);
  const { pi, handlers, factory, mkCtx } = mkPi();
  hapax(pi);
  handlers.get("session_start")({ type: "session_start", reason: "new" }, mkCtx());
  handlers.get("message_end")({ type: "message_end", message: { role: "user", content: "persistencecheckword appears once" } });
  await new Promise(r => setTimeout(r, 450));
  handlers.get("session_shutdown")();
  assert(before === walk(R), `journey9 no files written anywhere in the repo (zero persistence)`);
}

console.log(process.exitCode ? "\nE2E PROBES: FAILED" : "\nE2E PROBES: ALL PASS");
process.exit(process.exitCode ? 1 : 0);
PROBE

E2E_LOG="$(mktemp)"
if HAPAX_REPO_ROOT="$REPO" node --import "$TMPD/register.mjs" "$TMPD/probe-all.mjs" >"$E2E_LOG" 2>&1; then
  grep -c "^ok:" "$E2E_LOG" | xargs -I{} echo "journey assertions passed: {}"
  grep "NOTE:" "$E2E_LOG" || true
  pass "end-to-end user journeys (real extension factory + shipped dictionary)"
else
  cat "$E2E_LOG"
  fail "end-to-end user journeys"
fi
rm -f "$E2E_LOG"

# ---------------------------------------------------------------- phase 7
phase "7. Working-tree hygiene"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  STRAY="$(git status --porcelain | grep -v -E '^\?\? (validate\.sh|validation_report\.md|validation_result\.json)$' || true)"
  if [ -z "$STRAY" ]; then
    pass "working tree clean apart from the three validation deliverables"
  else
    echo "$STRAY"
    fail "unexpected working-tree changes (validation must not modify sources)"
  fi
else
  echo "not a git work tree — skipped"
fi
rm -rf "$TMPD"

# ---------------------------------------------------------------- summary
phase "SUMMARY"
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL PHASES PASSED"
  exit 0
else
  echo "$FAILURES phase(s) FAILED"
  exit 1
fi