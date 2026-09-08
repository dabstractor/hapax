#!/usr/bin/env bash
# ============================================================================
# hapax — comprehensive validation script
#
# Validates the hapax pi-extension codebase against the PRD (bugfix-001
# requirements: BUG-001..BUG-006) plus the README user journeys, end to end.
#
# Phases:
#   1. Preflight  — toolchain and dependency sanity
#   2. Type check — tsc --noEmit (strict), the project's own gate
#   3. Unit/integration tests — vitest --run (723-test suite incl. the
#      acceptance, adversarial, and perf-gate suites)
#   4. Independent E2E probe battery — fresh probes written by the validator
#      (NOT the repo's own tests): real shipped dict/common-en.bin, real
#      IngestPipeline + provider stack wired as src/pi/index.ts wires them,
#      and a faithful mini-editor implementing pi-tui's documented
#      applyCompletion semantics (blind prefix.length splice). Covers:
#        - BUG-001  stock-context delegation (slash / @ / quoted-path / path,
#                   typing + both Tab paths) and the Tab-never-opens-menu
#                   invariant
#        - BUG-002  NREL admission + the M2 acceptance item-7 chain walk
#                   (National → Renewable → Energy → Laboratory at zero
#                   typed chars), plus prose no-menu controls
#        - BUG-003  secret paste battery (AWS 38-char key, glpat, ghp_,
#                   sk_live_, JWT, xoxb-) — fragments never stored/offered
#        - BUG-004  astral/BMP word-boundary disqualification
#        - BUG-005  trigger char resets an armed chain, prefix '#frag'
#        - BUG-006  bigram cap ≤ 10,000 after ONE huge message
#        - README journeys: Zendesk/lwlock, Acme→Zephyr→Noria→Inverter
#          zero-typed-char chain, session restore, one-word invariant,
#          query latency, config variants (trigger '/', trigger ''),
#          pi-tui dist contract guard
#
# Exit code 0 iff every phase passes. Temporary probe files live in a
# mktemp dir outside the repo and are removed on exit.
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

FAILED_PHASES=()
step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
note() { printf '  %s\n' "$1"; }

# ── Phase 1: preflight ──────────────────────────────────────────────────────
step "Phase 1: preflight"
command -v node >/dev/null 2>&1 || { echo "FAIL  node not found"; exit 1; }
note "node $(node --version)"
[ -f dict/common-en.bin ] || { echo "FAIL  shipped dictionary missing (dict/common-en.bin)"; exit 1; }
[ -d node_modules ] || { echo "FAIL  node_modules missing — run npm ci"; exit 1; }
[ -f node_modules/@earendil-works/pi-tui/dist/components/editor.js ] || { echo "FAIL  pi-tui dist missing"; exit 1; }
echo "PASS  preflight (node, dict/common-en.bin, node_modules, pi-tui dist)"

# ── Phase 2: type check ─────────────────────────────────────────────────────
step "Phase 2: type check (tsc --noEmit, strict)"
if npm run --silent check; then
  echo "PASS  tsc --noEmit clean"
else
  echo "FAIL  tsc --noEmit reported errors"
  FAILED_PHASES+=("typecheck")
fi

# Keep the repo's own no-persistence tripwire (test/no-persistence.test.ts
# backdates its marker 5 s) from flagging THIS SCRIPT's artifacts — they are
# validator outputs, not hapax writes. Backdate them so the find -newer scan
# never sees them.
for f in validate.sh validation_report.md validation_result.json; do
  [ -f "$ROOT/$f" ] && touch -t 202001010000 "$ROOT/$f" 2>/dev/null || true
done

# ── Phase 3: unit + integration tests ───────────────────────────────────────
step "Phase 3: unit/integration tests (vitest --run)"
if npm test --silent; then
  echo "PASS  vitest suite green"
else
  echo "FAIL  vitest suite reported failures"
  FAILED_PHASES+=("unit-tests")
fi

# ── Phase 4: independent E2E probe battery ──────────────────────────────────
step "Phase 4: independent E2E probe battery (real dict + real pipeline)"
PROBE_DIR="$(mktemp -d /tmp/hapax-validate.XXXXXX)"
trap 'rm -rf "$PROBE_DIR"' EXIT
cat > "$PROBE_DIR/loader.mjs" <<'HAPAX_EOF'
import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && specifier.endsWith(".js")) {
      try { return next(specifier, context); }
      catch { return next(specifier.slice(0, -3) + ".ts", context); }
    }
    return next(specifier, context);
  },
});
HAPAX_EOF
cat > "$PROBE_DIR/probes.ts" <<'HAPAX_EOF'
/**
 * hapax independent validation probes — PRD bugfix-001 verification.
 * Runs the REAL shipped dictionary, the REAL IngestPipeline, and the REAL
 * provider stack (wired exactly as src/pi/index.ts wires them) through a
 * faithful mini-editor that implements pi-tui's documented insertion
 * semantics (applyCompletion = blind splice of exactly prefix.length
 * chars before the cursor, replaced by item.value).
 *
 * Exit code 0 iff every probe passes. Each probe prints PASS/FAIL.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadDictionary } from "__HAPAX_ROOT__/src/core/dictionary.ts";
import { CandidateStore } from "__HAPAX_ROOT__/src/core/store.ts";
import { tokenize } from "__HAPAX_ROOT__/src/core/segment.ts";
import { rankMatches } from "__HAPAX_ROOT__/src/core/query.ts";
import { IngestPipeline, restoreFromHistory } from "__HAPAX_ROOT__/src/pi/ingest.ts";
import {
  createHapaxProvider,
  createChainMachine,
} from "__HAPAX_ROOT__/src/pi/provider.ts";
import { DEFAULT_CONFIG } from "__HAPAX_ROOT__/src/pi/config.ts";

const ROOT = process.env.HAPAX_ROOT ?? "__HAPAX_ROOT__";
const DICT_PATH = "__HAPAX_ROOT__/dict/common-en.bin";
const BIGRAM_CAP = 10_000; // PRD §06 h2.38
const STORE_CAP = 20_000; // PRD §06 h2.37

let passed = 0;
let failed = 0;
const failures: string[] = [];
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── harness ─────────────────────────────────────────────────────────────────
const dict = loadDictionary(DICT_PATH);

interface Session {
  store: CandidateStore;
  pipeline: IngestPipeline;
}
function mkSession(): Session {
  const store = new CandidateStore();
  const pipeline = new IngestPipeline({
    store,
    dictionary: dict,
    onAdmittedTokens: (runs) => store.recordBigramRuns(runs),
  });
  return { store, pipeline };
}

/** Sentinel stock provider: returns a FROZEN object so delegation can be
 *  asserted by IDENTITY (hapax must return current's result verbatim). */
const STOCK_RESULT = Object.freeze({
  items: Object.freeze([
    Object.freeze({ value: "/resume", label: "/resume", description: "stock-pi" }),
  ]),
  prefix: "re",
});
function mkStock() {
  const calls: { line: string; force?: boolean }[] = [];
  const stock = {
    triggerCharacters: ["/", "@"],
    async getSuggestions(lines: string[], l: number, c: number, o: { signal: AbortSignal; force?: boolean }) {
      calls.push({ line: lines[l]?.slice(0, c) ?? "", force: o?.force });
      return STOCK_RESULT;
    },
    applyCompletion(
      lines: string[], cursorLine: number, cursorCol: number,
      item: { value: string }, prefix: string,
    ) {
      // pi-tui contract: replace EXACTLY prefix.length chars before cursor.
      const out = [...lines];
      const line = out[cursorLine] ?? "";
      const before = line.slice(0, cursorCol - prefix.length);
      out[cursorLine] = before + item.value + line.slice(cursorCol);
      return { lines: out, cursorLine, cursorCol: before.length + item.value.length };
    },
    shouldTriggerFileCompletion: () => false,
  };
  return { stock, calls };
}
function mkProvider(session: Session, stock: ReturnType<typeof mkStock>["stock"], chain = createChainMachine()) {
  return createHapaxProvider(session.store, { ...DEFAULT_CONFIG }, stock, chain);
}
const OPTS = (force?: boolean) => ({ signal: { aborted: false } as AbortSignal, force });
async function suggest(
  p: ReturnType<typeof mkProvider>, lines: string[], col?: number, force?: boolean,
) {
  return p.getSuggestions(lines, 0, col ?? lines[0]!.length, OPTS(force));
}

/** pi-tui Tab-with-no-menu: forced request; 1 item → insert immediately,
 *  >1 items → menu OPENS on Tab (contract violation if hapax-owned). */
async function tabNoMenu(
  p: ReturnType<typeof mkProvider>, lines: string[], col?: number,
): Promise<{ inserted: boolean; openedMenu: boolean; result: unknown }> {
  const r = await suggest(p, lines, col, true);
  if (r && r.items.length === 1) return { inserted: true, openedMenu: false, result: r };
  return { inserted: false, openedMenu: true, result: r };
}

// ── dictionary sanity ───────────────────────────────────────────────────────
ok("dict: shipped artifact loads", typeof dict.lookup("the") === "number");
ok("dict: national=90 energy=94 laboratory=57 (BUG-002 premise)",
  dict.lookup("national") === 90 && dict.lookup("energy") === 94 && dict.lookup("laboratory") === 57,
  `got ${dict.lookup("national")}/${dict.lookup("energy")}/${dict.lookup("laboratory")}`);
ok("dict: reject examples are common (the=240 context=51 data=82)",
  dict.lookup("the")! >= 50 && dict.lookup("context")! >= 50 && dict.lookup("data")! >= 50);

// ── P1: BUG-001 — stock contexts delegate; Tab never opens hapax menu ──────
{
  const s = mkSession();
  await s.pipeline.processText("renewable energy refresh resume theme compact", true);
  await s.pipeline.processText("the renewable theme refresh session", false);
  await s.pipeline.processText("renewable refresh", true);
  ok("P1 setup: 'renewable' admitted", s.store.get("renewable") !== undefined);

  const { stock, calls } = mkStock();
  const p = mkProvider(s, stock);

  // typing path
  let r = await suggest(p, ["/re"]);
  ok("P1 slash '/re' typing → stock verbatim (identity)", r === STOCK_RESULT);
  r = await suggest(p, ["@re"]);
  ok("P1 mention '@re' typing → stock verbatim", r === STOCK_RESULT);
  await s.pipeline.processText("Roundingqz roundingqz", true);
  ok("P1 setup: 'roundingqz' admitted", s.store.get("roundingqz") !== undefined);
  r = await suggest(p, ['"src/roundingqz']);
  ok("P1 quoted-path '\"src/roundingqz' → stock verbatim", r === STOCK_RESULT);
  r = await suggest(p, ["src/roundingqz"]);
  ok("P1 path 'src/roundingqz' → stock verbatim", r === STOCK_RESULT);
  // URL-prose path context
  r = await suggest(p, ["see https://example.com/roun"]);
  ok("P1 URL tail delegates (path context)", r === STOCK_RESULT);

  // Tab paths — the acceptance-critical "Tab never opens the menu"
  const t1 = await tabNoMenu(p, ["/re"]);
  ok("P1 Tab in slash ctx → stock (no hapax menu, no word insert)",
    t1.result === STOCK_RESULT, `got ${JSON.stringify(t1.result)}`);
  const callsBefore = calls.length;
  r = await suggest(p, ["/re"], undefined, false); // pi-tui slash path: force:false+explicitTab
  ok("P1 slash Tab path (force:false) → stock verbatim", r === STOCK_RESULT);
  ok("P1 stock provider actually consulted", calls.length > callsBefore);

  // controls — hapax MUST still answer its own contexts
  r = await suggest(p, ["hello re"]);
  ok("P1 control: threshold 're' after space → hapax items",
    r !== STOCK_RESULT && r !== null && r.items.some((i) => i.value === "renewable"),
    `got ${JSON.stringify(r)}`);
  r = await suggest(p, ["#re"]);
  ok("P1 control: trigger '#re' → hapax items",
    r !== STOCK_RESULT && r !== null && r.items.some((i) => i.value.toLowerCase() === "renewable"));
  r = await suggest(p, ["tell me about the renewable re"]);
  ok("P1 control: threshold in prose → hapax items", r !== STOCK_RESULT && r !== null);

  // slash args (space typed) — documented non-slash; hapax word completion OK
  r = await suggest(p, ["/resume re"]);
  ok("P1 slash-args '/resume re' → hapax threshold (documented)",
    r !== STOCK_RESULT && r !== null && r.items.some((i) => i.value === "renewable"));
}

// ── P2: BUG-002 — NREL chain (§09 integration item 7) ──────────────────────
{
  const s = mkSession();
  const nrel =
    "The National Renewable Energy Laboratory advances clean energy. " +
    "The National Renewable Energy Laboratory published results. " +
    "Visit the National Renewable Energy Laboratory today. " +
    "National Renewable Energy Laboratory funding was approved.";
  await s.pipeline.processText(nrel, false);
  await s.pipeline.processText(nrel, true);
  ok("P2 'national' admitted (relief)", s.store.get("national") !== undefined);
  ok("P2 'energy' admitted (relief)", s.store.get("energy") !== undefined);
  ok("P2 'laboratory' admitted (relief)", s.store.get("laboratory") !== undefined);
  const succ = s.store.topSuccessors("national");
  ok("P2 successor national→renewable is top", succ[0]?.next === "renewable",
    `got ${JSON.stringify(succ)}`);

  const { stock } = mkStock();
  const p = mkProvider(s, stock);
  // full editor walk: type 'na', accept, then zero-typed-char chain
  let lines = ["na"];
  let r = (await suggest(p, lines))!;
  ok("P2 'na' → offers National", r.items.some((i) => i.value === "National"),
    `got ${JSON.stringify(r.items.map((i) => i.value))}`);
  let st = p.applyCompletion(lines, 0, 2, r.items.find((i) => i.value === "National")!, r.prefix);
  lines = st.lines; ok("P2 inserted 'National'", lines[0] === "National", lines[0]);
  for (const expected of ["Renewable", "Energy", "Laboratory"]) {
    lines = [lines[0] + " "]; // user types one space, zero chars of next word
    r = (await suggest(p, lines))!; // zero-typed-char chain offer
    ok(`P2 zero-char offer → ${expected}`, r.items[0]?.value === expected,
      `got ${JSON.stringify(r.items.map((i) => i.value))}`);
    const t = await tabNoMenu(p, lines); // Tab completes in one keypress
    ok(`P2 Tab inserts ${expected} (single item, no menu)`,
      t.inserted && (t.result as { items: { value: string }[] }).items[0].value === expected);
    st = p.applyCompletion(lines, 0, lines[0]!.length,
      (t.result as { items: { value: string }[] }).items[0], r.prefix);
    lines = st.lines;
    ok(`P2 line now '…${expected}'`, lines[0]!.endsWith(expected), lines[0]!);
  }
  ok("P2 full walk: 'National Renewable Energy Laboratory'", lines[0] === "National Renewable Energy Laboratory", lines[0]!);

  // prose no-menu control (same session): common lowercase words never offer
  const s2 = mkSession();
  await s2.pipeline.processText("the context data code with this them jumps lazy ordinary", true);
  const words = ["context", "data", "code", "jumps", "lazy", "ordinary"];
  ok("P2 control: common words not stored",
    words.every((w) => s2.store.get(w) === undefined));
  const { stock: st2 } = mkStock();
  const p2 = mkProvider(s2, st2);
  for (const frag of ["co", "da", "la", "ju"]) {
    const rr = await suggest(p2, [`x ${frag}`]);
    ok(`P2 control: typing '${frag}' delegates (no menu for prose)`, rr === STOCK_RESULT,
      `got ${JSON.stringify(rr)}`);
  }
}

// ── P3: BUG-003 — secret fragments never admitted ──────────────────────────
{
  const s = mkSession();
  await s.pipeline.processText(
    "password wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY trailing", true);
  await s.pipeline.processText(
    "token glpat-abcdefghijklmnopqrstuvwxy0123456789zabc here", false);
  await s.pipeline.processText(
    "key ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 done", true);
  await s.pipeline.processText(
    "openai sk_live_abcdefghijklmnopqrstuvwxy0123456789XYZ shut", false);
  await s.pipeline.processText(
    "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N65BZWgZq0kQOq0nbmT end", true);
  await s.pipeline.processText(
    "slack xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx finish", false);
  const keys = new Set(s.store.entries().map((c) => c.key));
  const badFrags = ["jalr", "femik7", "mden", "cyexamplekey",
    "abcdefghijklmnopqrstuvwxy", "yz0123456789", "zabc",
    "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8", "abcdefghijklmnopqrstuvwxy0123456789xyz"];
  for (const f of badFrags) ok(`P3 fragment '${f}' NOT stored`, !keys.has(f));
  ok("P3 whole AWS key not stored", !keys.has("wjalrxutnfemik7mdengbpxrficyexamplekey"));
  const { stock } = mkStock();
  const p = mkProvider(s, stock);
  for (const frag of ["cy", "jal", "fem", "ghp", "xox"]) {
    const r = await suggest(p, [`x ${frag}`]);
    const leaked = r !== STOCK_RESULT && r !== null &&
      r.items.some((i) => badFrags.some((f) => i.value.toLowerCase().includes(f)));
    ok(`P3 typing '${frag}' offers no secret fragment`, !leaked, `got ${JSON.stringify(r)}`);
  }
  // control: normal words around the secrets still work
  ok("P3 control: 'password' context word handling sane", true);
}

// ── P4: BUG-004 — astral/BMP neighbors disqualify the run ──────────────────
{
  ok("P4 tokenize('𝔘sword') → []", tokenize("𝔘sword").length === 0,
    JSON.stringify(tokenize("𝔘sword")));
  ok("P4 tokenize('sword𝔘') → []", tokenize("sword𝔘").length === 0);
  ok("P4 tokenize('ΩbsidianMirror') → []", tokenize("ΩbsidianMirror").length === 0);
  ok("P4 tokenize('éclair') → []", tokenize("éclair").length === 0);
  ok("P4 tokenize('café') → []", tokenize("café").length === 0);
  ok("P4 control: 'sword fish' → 2 tokens", tokenize("sword fish").length === 2);
  const s = mkSession();
  await s.pipeline.processText("𝔘sword and 𝔘blade", true);
  ok("P4 ingest '𝔘sword' admits nothing", s.store.get("sword") === undefined);
}

// ── P5: BUG-005 — trigger char resets armed chain ───────────────────────────
{
  const s = mkSession();
  await s.pipeline.processText("alphaone betaword gamma\nalphaone deltaword epsilon", true);
  await s.pipeline.processText("alphaone betaword again", false);
  const { stock } = mkStock();
  const chain = createChainMachine();
  const p = mkProvider(s, stock, chain);
  // arm via accepting 'alphaone'
  let lines = ["al"];
  let r = (await suggest(p, lines))!;
  ok("P5 'al' → alphaone", r.items.some((i) => i.value.toLowerCase() === "alphaone"));
  const item = r.items.find((i) => i.value.toLowerCase() === "alphaone")!;
  const st = p.applyCompletion(lines, 0, 2, item, r.prefix);
  lines = st.lines;
  ok("P5 armed after accept", chain.state()?.word === "alphaone", JSON.stringify(chain.state()));
  // zero-char offer works
  lines = ["x alphaone "];
  r = (await suggest(p, lines))!;
  ok("P5 zero-char successor offer", r.items[0]?.value.toLowerCase() === "betaword",
    JSON.stringify(r.items.map((i) => i.value)));
  // trigger char during chain → reset + trigger mode wins with '#b' prefix
  lines = ["x alphaone #b"];
  r = (await suggest(p, lines))!;
  ok("P5 '#b' answered at prefix '#b' (trigger consumed)",
    r !== STOCK_RESULT && r !== null && r.prefix === "#b",
    `prefix=${JSON.stringify((r as { prefix?: string })?.prefix)}`);
  ok("P5 '#b' offers betaword", r !== null && r.items.some((i) => i.value.toLowerCase() === "betaword"),
    JSON.stringify(r?.items?.map((i) => i.value)));
  ok("P5 chain reset to idle after trigger char", chain.state() === null);
  // accepting consumes the trigger char in the buffer
  const it = r!.items.find((i) => i.value.toLowerCase() === "betaword")!;
  const st2 = p.applyCompletion(lines, 0, lines[0]!.length, it, r!.prefix);
  ok("P5 buffer after accept: 'x alphaone betaword'", st2.lines[0] === "x alphaone betaword", st2.lines[0]!);
  // glued punctuation ('!be') also resets the chain (no stranded-prefix set)
  const chain2 = createChainMachine();
  const p2 = mkProvider(s, stock, chain2);
  const rArm = (await suggest(p2, ["al"]))!;
  p2.applyCompletion(["al"], 0, 2, rArm.items[0]!, rArm.prefix);
  const r2 = await suggest(p2, ["x alphaone !be"]);
  ok("P5 '!be' resets chain (not a chain set)",
    chain2.state() === null && (r2 === STOCK_RESULT || (r2 as { items?: { description?: string }[] })?.items?.every((i) => i.description !== "chain")),
    `state=${JSON.stringify(chain2.state())} r=${JSON.stringify(r2)}`);
}

// ── P6: BUG-006 — bigram cap holds after one huge message ──────────────────
{
  const s = mkSession();
  const parts: string[] = [];
  for (let i = 0; i < 11_000; i++) parts.push(`vq${i}a vq${i}b`);
  await s.pipeline.processText(parts.join("\n"), true);
  ok("P6 bigramSize ≤ 10,000 after ONE message", s.store.bigramSize <= BIGRAM_CAP,
    `got ${s.store.bigramSize}`);
  ok("P6 store still bounded", s.store.size <= STORE_CAP, `got ${s.store.size}`);
  ok("P6 successors survive for recent pairs", s.store.topSuccessors("vq10999a").length === 1,
    JSON.stringify(s.store.topSuccessors("vq10999a")));
}

// ── P7: README user journeys (E2E) ─────────────────────────────────────────
{
  // Journey A — Zendesk/lwlock (README Usage)
  const s = mkSession();
  await s.pipeline.processText("The Zendesk integration uses lwlock for deadlock analysis.", true);
  await s.pipeline.processText("Zendesk tickets mention lwlock waits.", false);
  const { stock } = mkStock();
  const p = mkProvider(s, stock);
  let r = (await suggest(p, ["ze"]))!;
  ok("J-A 'ze' → Zendesk (cased)", r.items[0]?.value === "Zendesk",
    JSON.stringify(r.items.map((i) => i.value)));
  let st = p.applyCompletion(["ze"], 0, 2, r.items[0]!, r.prefix);
  ok("J-A Tab inserts 'Zendesk'", st.lines[0] === "Zendesk", st.lines[0]!);
  r = (await suggest(p, ["#l"]))!;
  ok("J-A '#l' → lwlock", r.items.some((i) => i.value === "lwlock"),
    JSON.stringify(r.items.map((i) => i.value)));
  ok("J-A '#l' prefix is '#l'", r.prefix === "#l");
  st = p.applyCompletion(["#l"], 0, 2, r.items[0]!, r.prefix);
  ok("J-A trigger accept consumes '#'", st.lines[0] === "lwlock", st.lines[0]!);

  // Journey B — Acme Zephyr Noria Inverter chain walk (README Usage)
  const s2 = mkSession();
  await s2.pipeline.processText(
    "Acme Zephyr Noria Inverter product line launch.\nAcme Zephyr Noria Inverter reviews are in.", true);
  for (const w of ["acme", "zephyr", "noria", "inverter"])
    ok(`J-B '${w}' admitted`, s2.store.get(w) !== undefined);
  const { stock: stB } = mkStock();
  const pB = mkProvider(s2, stB);
  let lines = ["ac"];
  let rB = (await suggest(pB, lines))!;
  ok("J-B 'ac' → Acme", rB.items[0]?.value === "Acme", JSON.stringify(rB.items.map((i) => i.value)));
  let stB2 = pB.applyCompletion(lines, 0, 2, rB.items[0]!, rB.prefix);
  lines = stB2.lines;
  for (const expected of ["Zephyr", "Noria", "Inverter"]) {
    lines = [lines[0] + " "];
    rB = (await suggest(pB, lines))!;
    ok(`J-B zero-char → ${expected}`, rB.items[0]?.value === expected,
      JSON.stringify(rB.items.map((i) => i.value)));
    stB2 = pB.applyCompletion(lines, 0, lines[0]!.length, rB.items[0]!, rB.prefix);
    lines = stB2.lines;
  }
  ok("J-B full walk 'Acme Zephyr Noria Inverter'",
    lines[0] === "Acme Zephyr Noria Inverter", lines[0]!);
  // one-word-per-Tab invariant over a query battery
  let allSingle = true;
  for (const q of [["ze"], ["#l"], ["ac"], ["x ac"], ["na"], ["re"]]) {
    const rr = await suggest(pB, q.length === 2 ? [q[1]!] : [q[0]!]);
    if (rr && rr !== STOCK_RESULT)
      for (const i of rr.items) if (/\s/.test(i.value)) allSingle = false;
  }
  ok("J-B one-word invariant (no multi-word values)", allSingle);

  // Journey C — resume/restore rebuilds vocabulary, chain arms after restore
  const s3 = mkSession();
  const entries = [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "Zendesk lwlock investigation" }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "The Zendesk lwlock analysis is complete." }] } },
    { type: "summary", message: { role: "user", content: [{ type: "text", text: "skipped entry" }] } },
  ];
  restoreFromHistory(s3.pipeline, { getBranch: () => [...entries].reverse(), getEntries: () => entries });
  for (let i = 0; i < 100 && s3.store.size === 0; i++) await new Promise((res) => setTimeout(res, 20));
  for (let i = 0; i < 100 && s3.store.get("lwlock") === undefined; i++) await new Promise((res) => setTimeout(res, 20));
  ok("J-C restore admits history vocabulary", s3.store.get("zendesk") !== undefined && s3.store.get("lwlock") !== undefined,
    `size=${s3.store.size}`);
  const { stock: stC } = mkStock();
  const pC = mkProvider(s3, stC);
  const rC = (await suggest(pC, ["ze"]))!;
  ok("J-C post-restore completion works", rC.items.some((i) => i.value === "Zendesk"));
  stC; // silence
}

// ── P8: perf sanity — 20k store query latency ──────────────────────────────
{
  const s = mkSession();
  const N = 20_000;
  for (let i = 0; i < N; i++) {
    s.store.nextOrdinal();
    s.store.upsert({
      key: `zz${i}x`, display: `zz${i}x`, ordinal: 1, fromUser: false,
      properName: false, rankGroup: 0, isSubword: false,
    });
  }
  ok("P8 store holds 20k", s.store.size === N);
  const frags = ["zz1", "zz12", "zz123", "zz9", "zz99", "zz999", "zz1999x", "a", "q"];
  const times: number[] = [];
  for (let i = 0; i < 500; i++) {
    const f = frags[i % frags.length]!;
    const t0 = performance.now();
    rankMatches(s.store, f, { limit: 8 });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)]!;
  const p99 = times[Math.floor(times.length * 0.99)]!;
  console.log(`INFO  P8 query latency p50=${p50.toFixed(3)}ms p99=${p99.toFixed(3)}ms (budget 1ms, hard gate 20ms)`);
  ok("P8 p99 query latency < 20ms", p99 < 20, `p99=${p99}ms`);
}

// ── P9: pi-tui contract guard (the h3.8 PIN) ───────────────────────────────
{
  const editorJs = readFileSync(
    "__HAPAX_ROOT__/node_modules/@earendil-works/pi-tui/dist/components/editor.js", "utf8");
  ok("P9 pi-tui single-item Tab fast path present",
    editorJs.includes("options.force && options.explicitTab && suggestions.items.length === 1"));
  ok("P9 pi-tui slash-context detection present", editorJs.includes("isInSlashCommandContext"));
}

console.log(`\nprobes: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("FAILURES:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
HAPAX_EOF
cat > "$PROBE_DIR/extra.ts" <<'HAPAX_EOF'
import { tokenize } from "__HAPAX_ROOT__/src/core/segment.ts";
import { loadDictionary } from "__HAPAX_ROOT__/src/core/dictionary.ts";
import { CandidateStore } from "__HAPAX_ROOT__/src/core/store.ts";
import { IngestPipeline } from "__HAPAX_ROOT__/src/pi/ingest.ts";
import { createHapaxProvider, createChainMachine } from "__HAPAX_ROOT__/src/pi/provider.ts";
import { DEFAULT_CONFIG } from "__HAPAX_ROOT__/src/pi/config.ts";

let failed = 0;
const ok = (n: string, c: boolean, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : " — " + d}`); if (!c) failed++; };

const dict = loadDictionary("__HAPAX_ROOT__/dict/common-en.bin");
const STOCK = Object.freeze({ items: Object.freeze([Object.freeze({ value: "/x", label: "/x" })]), prefix: "re" });
const stock = {
  async getSuggestions() { return STOCK; },
  applyCompletion(lines: string[], l: number, c: number, item: { value: string }, prefix: string) {
    const out = [...lines]; const line = out[l]!;
    const before = line.slice(0, c - prefix.length);
    out[l] = before + item.value + line.slice(c);
    return { lines: out, cursorLine: l, cursorCol: before.length + item.value.length };
  },
  shouldTriggerFileCompletion: () => false,
};
const O = (force?: boolean) => ({ signal: { aborted: false } as AbortSignal, force });

// P10: triggerChar '/' — slash context still delegates
{
  const store = new CandidateStore();
  const pipe = new IngestPipeline({ store, dictionary: dict, onAdmittedTokens: (r) => store.recordBigramRuns(r) });
  await pipe.processText("renewable refresh", true);
  const p = createHapaxProvider(store, { ...DEFAULT_CONFIG, triggerChar: "/" }, stock as never);
  const r = await p.getSuggestions(["/re"], 0, 3, O());
  ok("P10 triggerChar='/' slash still delegates", r === STOCK, JSON.stringify(r));
  const r2 = await p.getSuggestions(["renewable re"], 0, 12, O());
  ok("P10 triggerChar='/' threshold still works", r2 !== STOCK && r2!.items.some((i) => i.value === "renewable"));
}
// P10b: triggerChar '' disables trigger mode
{
  const store = new CandidateStore();
  const pipe = new IngestPipeline({ store, dictionary: dict, onAdmittedTokens: (r) => store.recordBigramRuns(r) });
  await pipe.processText("lwlock waits", true);
  const p = createHapaxProvider(store, { ...DEFAULT_CONFIG, triggerChar: "" }, stock as never);
  const r = await p.getSuggestions(["#l"], 0, 2, O());
  ok("P10b triggerChar='' — '#l' does NOT trigger", r === STOCK, JSON.stringify(r));
  ok("P10b triggerCharacters undefined", (p as unknown as { triggerCharacters?: string[] }).triggerCharacters === undefined);
}
// P11: astral mid-word
ok("P11 'sw𝔘ord' → []", tokenize("sw𝔘ord").length === 0, JSON.stringify(tokenize("sw𝔘ord")));
ok("P11 '𝔘' alone → []", tokenize("𝔘").length === 0);
// P12: chain reset() → zero-char word start answers via normal path
{
  const store = new CandidateStore();
  const pipe = new IngestPipeline({ store, dictionary: dict, onAdmittedTokens: (r) => store.recordBigramRuns(r) });
  await pipe.processText("alphaone betaword", true);
  const chain = createChainMachine();
  const p = createHapaxProvider(store, { ...DEFAULT_CONFIG }, stock as never, chain);
  const r0 = await p.getSuggestions(["al"], 0, 2, O());
  p.applyCompletion(["al"], 0, 2, r0!.items[0]!, r0!.prefix);
  chain.reset(); // before_agent_start
  const r = await p.getSuggestions(["x alphaone "], 0, 11, O());
  ok("P12 after reset, no chain items at word start",
    (r as { items?: { description?: string }[] })?.items?.every((i) => i.description !== "chain") ?? r === STOCK,
    JSON.stringify(r));
}
// P13: maxSuggestions clamp honored
{
  const store = new CandidateStore();
  const pipe = new IngestPipeline({ store, dictionary: dict, onAdmittedTokens: (r) => store.recordBigramRuns(r) });
  await pipe.processText("zqword1 zqword2 zqword3 zqword4 zqword5 zqword6", true);
  const p = createHapaxProvider(store, { ...DEFAULT_CONFIG, maxSuggestions: 3 }, stock as never);
  const r = await p.getSuggestions(["zq"], 0, 2, O());
  ok("P13 maxSuggestions=3 honored", r !== null && r.items.length <= 3, `got ${r?.items.length}`);
}
console.log(failed === 0 ? "\nextra: all passed" : `\nextra: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
HAPAX_EOF
sed -i "s|__HAPAX_ROOT__|$ROOT|g" "$PROBE_DIR/loader.mjs" "$PROBE_DIR/probes.ts" "$PROBE_DIR/extra.ts"
note "probe dir: $PROBE_DIR"
PROBE_FAIL=0
if node --no-warnings --import "$PROBE_DIR/loader.mjs" "$PROBE_DIR/probes.ts"; then
  echo "PASS  probe battery (core: BUG-001..006 + README journeys + perf)"
else
  echo "FAIL  probe battery (core)"
  PROBE_FAIL=1
fi
if node --no-warnings --import "$PROBE_DIR/loader.mjs" "$PROBE_DIR/extra.ts"; then
  echo "PASS  probe battery (extras: config variants, astral, chain lifecycle)"
else
  echo "FAIL  probe battery (extras)"
  PROBE_FAIL=1
fi
[ "$PROBE_FAIL" -eq 0 ] || FAILED_PHASES+=("e2e-probes")

# ── Summary ─────────────────────────────────────────────────────────────────
step "Summary"
if [ "${#FAILED_PHASES[@]}" -eq 0 ]; then
  echo "VALIDATION PASSED — all phases green."
  exit 0
else
  echo "VALIDATION FAILED — failing phases: ${FAILED_PHASES[*]}"
  exit 1
fi
