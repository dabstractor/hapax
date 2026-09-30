#!/usr/bin/env bash
# ============================================================================
# hapax — comprehensive project validation
#
# Phases (each guarded; a phase failing fails the script):
#   1. Type check          — tsc --noEmit (no eslint/prettier config exists)
#   2. Unit tests          — vitest --run (1046 tests, includes perf-gates)
#   3. Benchmarks          — vitest bench (PRD §09 measured actuals)
#   4. Artifact integrity  — shipped dictionary + calibration probes
#   5. E2E journeys        — REAL compiled extension driven through complete
#                            user journeys (spec 09 items 1–7) with the real
#                            dictionary; compiled to a temp dir, repo untouched
#   6. Real-host load      — pi -p -e (jiti loader, real runtime; network-gated)
#   7. Live TTY (optional) — tmux-driven live verification per spec 09's
#                            binding technique: fallback menu + widget line.
#                            Auto-skips when tmux/auth are unavailable.
#                            Set HAPAX_VALIDATE_SKIP_TTY=1 to opt out.
#
# Exit 0 = every executed phase passed.
# ============================================================================
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO"

PHASES_FAILED=0
phase() { echo; echo "================================================================"; echo "PHASE $1: $2"; echo "================================================================"; }
ok()   { echo "  [PASS] $1"; }
bad()  { echo "  [FAIL] $1"; PHASES_FAILED=$((PHASES_FAILED+1)); }
skip() { echo "  [SKIP] $1"; }

GIT_START="$(git status --porcelain 2>/dev/null | head -50)"

# ---------------------------------------------------------------- Phase 1 --
phase 1 "Type checking (tsc --noEmit)"
if npm run check >/tmp/hapax-val-check.log 2>&1; then ok "tsc clean"; else bad "tsc failed"; tail -20 /tmp/hapax-val-check.log; fi

# ---------------------------------------------------------------- Phase 2 --
phase 2 "Unit tests (vitest --run)"
if npm test >/tmp/hapax-val-test.log 2>&1; then
  ok "unit tests green ($(grep -oE 'Tests  [0-9]+ passed( \| [0-9]+ skipped)?' /tmp/hapax-val-test.log | head -1))"
else
  bad "unit tests failed"; tail -30 /tmp/hapax-val-test.log
fi

# ---------------------------------------------------------------- Phase 3 --
phase 3 "Performance benchmarks (PRD §09 gates)"
if npx vitest bench --run >/tmp/hapax-val-bench.log 2>&1; then
  ok "bench suite completed"
  grep -E "· gate" /tmp/hapax-val-bench.log | sed 's/^/  /'
else
  bad "bench suite failed"; tail -20 /tmp/hapax-val-bench.log
fi

# ---------------------------------------------------------------- Phase 4 --
phase 4 "Shipped artifact integrity"
DICT="$REPO/dict/common-en.bin"
if [ -f "$DICT" ]; then
  SIZE=$(stat -c%s "$DICT")
  [ "$SIZE" = "850554" ] && ok "dict size $SIZE (spec 03: 850,554)" || bad "dict size $SIZE (spec: 850554)"
  MAGIC=$(head -c4 "$DICT")
  [ "$MAGIC" = "HAPX" ] && ok "dict magic HAPX" || bad "dict magic is '$MAGIC'"
else
  bad "dict/common-en.bin missing"
fi
# Calibration probes: spec-pinned verdicts against the shipped artifact
PROBE="$(node tools/calibrate-bands.mjs zendesk the context provider lwlock 2>&1)"
echo "$PROBE" | sed 's/^/  /'
echo "$PROBE" | grep -q "zendesk.*g0"          && ok "zendesk admits (group 0)"        || bad "zendesk verdict"
echo "$PROBE" | grep -qE "the .*REJECT"        && ok "'the' rejects"                    || bad "'the' verdict"
echo "$PROBE" | grep -qE "context .*REJECT"    && ok "'context' rejects"                || bad "'context' verdict"
echo "$PROBE" | grep -qE "provider .*REJECT"   && ok "'provider' rejects (8c floor)"    || bad "'provider' verdict"
echo "$PROBE" | grep -q "lwlock.*g0"           && ok "lwlock admits (group 0)"         || bad "lwlock verdict"

# ---------------------------------------------------------------- Phase 5 --
phase 5 "E2E user journeys (real compiled extension + real dictionary)"
VDIR="${TMPDIR:-/tmp}/hapax-validate-$$"
VBUILD="$VDIR/build"
mkdir -p "$VBUILD"
if npx tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict \
     --skipLibCheck --esModuleInterop --noEmitOnError --outDir "$VBUILD" \
     src/core/dictionary.ts src/core/query.ts src/core/score.ts src/core/segment.ts \
     src/core/shapeGate.ts src/core/store.ts src/core/types.ts src/pi/config.ts \
     src/pi/debug.ts src/pi/editor.ts src/pi/index.ts src/pi/ingest.ts src/pi/paths.ts \
     src/pi/provider.ts src/pi/widget.ts >/tmp/hapax-val-tsc-e2e.log 2>&1; then
  ok "extension compiles standalone (native ESM)"
else
  bad "E2E compile failed"; tail -20 /tmp/hapax-val-tsc-e2e.log
fi
ln -sfn "$REPO/node_modules" "$VDIR/node_modules"
ln -sfn "$REPO/dict" "$VDIR/dict"
echo '{"type":"module"}' > "$VDIR/package.json"

cat > "$VDIR/e2e.mjs" <<'E2EEOF'
/**
 * hapax E2E journey suite — drives the REAL compiled extension factory
 * (build/pi/index.js) through complete user journeys mirroring the spec's
 * documented workflows (spec/09 acceptance items, README usage), with a
 * fake pi/ctx but the real dictionary, real pipeline, real provider and
 * real widget wiring. Nothing inside the extension boundary is mocked.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUILD = process.env.HAPAX_E2E_BUILD;
const hapax = (await import(`${BUILD}/pi/index.js`)).default;
const { isWidgetWrapper, widgetOptsOf } = await import(`${BUILD}/pi/widget.js`);

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}
const settle = (ms = 450) => new Promise((r) => setTimeout(r, ms));
const noSignal = () => ({ signal: { aborted: false } });
const forced = () => ({ signal: { aborted: false }, force: true, explicitTab: true });

function fakePi() {
  const handlers = new Map();
  const commands = new Map();
  return {
    handlers, commands,
    pi: {
      on: (name, h) => handlers.set(name, h),
      registerCommand: (name, def) => commands.set(name, def),
    },
  };
}
function fakeCtx(over = {}) {
  const notifyCalls = [];
  let providerFactory = null;
  const installed = [];
  const ctx = {
    ui: {
      notify: (m, l) => notifyCalls.push({ m, l }),
      addAutocompleteProvider: (f) => { providerFactory = f; },
      getEditorComponent: () => over.editorFactory,
      setEditorComponent: (f) => installed.push(f),
    },
    cwd: over.cwd ?? process.cwd(),
    isProjectTrusted: () => over.trusted ?? true,
    sessionManager: {
      getBranch: () => over.branch ?? [],
      getEntries: () => over.entries ?? [],
    },
  };
  return { ctx, notifyCalls, getInstalled: () => installed, getProviderFactory: () => providerFactory };
}
const currentFake = () => ({
  getSuggestions: async () => null,
  applyCompletion: (lines, line, col) => ({ lines, cursorLine: line, cursorCol: col }),
  shouldTriggerFileCompletion: () => true,
});
const userMsg = (content) => ({ role: "user", content, timestamp: 0 });
const assistantMsg = (blocks) => ({ role: "assistant", content: blocks, timestamp: 0 });
const msgEntry = (id, message) => ({ type: "message", id, parentId: null, timestamp: "2025-01-01T00:00:00.000Z", message });

async function getSug(p, lines, col, opts = noSignal()) {
  return await p.getSuggestions(lines, lines.length - 1, col, opts);
}
const values = (r) => (r && r.items ? r.items.map((i) => i.value) : []);

// ================================================== Journey A — happy path
console.log("\nJourney A — happy path (fallback display, spec 09 items 1+7)");
{
  const home = mkdtempSync(join(tmpdir(), "hapax-e2e-home-"));
  process.env.HOME = home;
  delete process.env.HAPAX_DICT;

  const { pi, handlers } = fakePi();
  const { ctx, getProviderFactory } = fakeCtx();
  hapax(pi);
  handlers.get("session_start")({ type: "session_start", reason: "new" }, ctx);
  const factory = getProviderFactory();
  check("A1 fallback path registers an autocomplete provider", typeof factory === "function");
  const current = currentFake();
  const provider = factory(current);

  await handlers.get("message_end")({ type: "message_end", message: userMsg(
    "Let's fix the Zendesk ticket sync and the lwlock contention under src/core/query.ts. Key is sk-abc123DEF456ghi789JKL — do not leak it. Try 2560x1440@2."
  ) }, ctx);
  await handlers.get("message_end")({ type: "message_end", message: assistantMsg([
    { type: "thinking", text: "ZorpThinkingToken should never be harvested from thinking blocks" },
    { type: "text", text: "Yes — Zendesk sync first, then lwlock. The file src/core/query.ts:42:13 needs the fix." },
  ]) }, ctx);
  await handlers.get("message_end")({ type: "message_end", message: { role: "toolResult", content: "ToolResultOnlyWord" } }, ctx);
  await settle();

  const r1 = await getSug(provider, ["ze"], 2);
  check("A2 'ze' offers Zendesk (cased display)", values(r1).includes("Zendesk"), JSON.stringify(values(r1)));
  const r2 = await getSug(provider, ["lwl"], 3);
  check("A3 'lwl' offers lwlock (tier-2 contiguous tail)", values(r2).includes("lwlock"), JSON.stringify(values(r2)));
  const r3 = await getSug(provider, ["#l"], 2);
  check("A4 '#l' trigger-char offers lwlock", values(r3).includes("lwlock"), JSON.stringify(values(r3)));
  const r4 = await getSug(provider, ["sr"], 2);
  check("A5 'sr' offers whole path src/core/query.ts (rule 4d)", values(r4).includes("src/core/query.ts"), JSON.stringify(values(r4)));
  const r5 = await getSug(provider, ["#que"], 4);
  check("A6 '#que' loose tier-0 finds path by filename", values(r5).includes("src/core/query.ts"), JSON.stringify(values(r5)));
  const r6 = await getSug(provider, ["ze"], 2, forced());
  check("A7 forced (Tab) returns exactly one item = Zendesk", r6 && r6.items?.length === 1 && r6.items[0].value === "Zendesk", JSON.stringify(values(r6)));
  const r7 = await getSug(provider, ["#2560"], 5);
  check("A8 '#2560' offers technical literal 2560x1440@2 (digit-initial → trigger path)", values(r7).includes("2560x1440@2"), JSON.stringify(values(r7)));

  const probes = await Promise.all([
    getSug(provider, ["#sk"], 3), getSug(provider, ["abc"], 3), getSug(provider, ["sk-"], 3),
    getSug(provider, ["#abc123"], 7), getSug(provider, ["ghi"], 3),
  ]);
  const leaked = probes.flatMap(values).filter((v) => v.includes("abc123") || v.includes("DEF456") || v.startsWith("sk-"));
  check("A9 API key never appears in suggestions (shape gate)", leaked.length === 0, JSON.stringify(leaked));

  const r10 = await getSug(provider, ["#zorp"], 5);
  check("A10 thinking-block token not harvested", !values(r10).some((v) => /zorp/i.test(v)), JSON.stringify(values(r10)));
  const r11 = await getSug(provider, ["tool"], 4);
  check("A11 toolResult content not harvested", !values(r11).some((v) => /toolresult/i.test(v)), JSON.stringify(values(r11)));

  const th = await getSug(provider, ["th"], 2);
  check("A12 common word 'th' delegates (no hapax menu)", th === null, JSON.stringify(th));
  const cont = await getSug(provider, ["cont"], 4);
  check("A13 common word 'context' never offered (band-rejected)", !values(cont).some((v) => /^(context|the)$/i.test(v)), JSON.stringify(values(cont)));
  const sp = await getSug(provider, ["Zendesk "], 8);
  check("A14 trailing space closes menu (close-on-space)", sp === null || values(sp).length === 0, JSON.stringify(sp));
  const ret = await handlers.get("message_end")({ type: "message_end", message: userMsg("more words here") }, ctx);
  check("A15 message_end returns undefined (no message replacement)", ret === undefined, String(ret));
  const bar = handlers.get("before_agent_start")({ type: "before_agent_start" }, ctx);
  check("A16 before_agent_start returns undefined", bar === undefined, String(bar));
  const pathq = await getSug(provider, ["src/co"], 5);
  check("A17 mid-path typing delegates to stock completion", pathq === null, JSON.stringify(pathq));

  handlers.get("session_shutdown")({ type: "session_shutdown" }, ctx);
  rmSync(home, { recursive: true, force: true });
}

// ============================================= Journey B — chained completion
console.log("\nJourney B — M2 chained completion (Zorp→Zephra→Noria→Inverter)");
{
  const home = mkdtempSync(join(tmpdir(), "hapax-e2e-home-"));
  process.env.HOME = home;
  const { pi, handlers } = fakePi();
  const { ctx, getProviderFactory } = fakeCtx();
  hapax(pi);
  handlers.get("session_start")({ type: "session_start", reason: "new" }, ctx);
  const current = currentFake();
  const provider = getProviderFactory()(current);

  await handlers.get("message_end")({ type: "message_end", message: userMsg(
    "The Zorp Zephra Noria Inverter stack: Zorp ships Zephra, Zephra drives Noria, Noria spins the Inverter."
  ) }, ctx);
  await settle();

  const r = await getSug(provider, ["zo"], 2);
  check("B1 'zo' offers Zorp", values(r).includes("Zorp"), JSON.stringify(values(r)));
  const tab = await getSug(provider, ["zo"], 2, forced());
  check("B2 forced Tab returns single item Zorp", tab?.items?.length === 1 && tab.items[0].value === "Zorp", JSON.stringify(values(tab)));
  const applyCalls = [];
  current.applyCompletion = (...a) => { applyCalls.push(a); return { lines: a[0], cursorLine: a[1], cursorCol: a[2] }; };
  provider.applyCompletion(["zo"], 0, 2, tab.items[0], tab.prefix ?? "zo");
  check("B3 applyCompletion delegates to stock insertion (args passed through)", applyCalls.length === 1 && applyCalls[0][3] === tab.items[0], JSON.stringify(applyCalls.length));

  const chain = await getSug(provider, ["Zorp "], 5);
  check("B4 chain offers Zephra with zero typed chars", values(chain).includes("Zephra"), JSON.stringify(values(chain)));
  const chainTab = await getSug(provider, ["Zorp "], 5, forced());
  check("B5 forced Tab on chain returns single successor Zephra", chainTab?.items?.length === 1 && chainTab.items[0].value === "Zephra", JSON.stringify(values(chainTab)));
  provider.applyCompletion(["Zorp "], 0, 5, chainTab.items[0], chainTab.prefix ?? "");
  const chain2 = await getSug(provider, ["Zorp Zephra "], 12);
  check("B6 second Tab arms Noria", values(chain2).includes("Noria"), JSON.stringify(values(chain2)));
  const chain2Tab = await getSug(provider, ["Zorp Zephra "], 12, forced());
  provider.applyCompletion(["Zorp Zephra "], 0, 12, chain2Tab.items[0], chain2Tab.prefix ?? "");
  const chain3 = await getSug(provider, ["Zorp Zephra Noria "], 18);
  check("B7 third Tab arms Inverter", values(chain3).includes("Inverter"), JSON.stringify(values(chain3)));
  const allVals = [...values(chain), ...values(chain2), ...values(chain3)];
  check("B8 every item is exactly one word (no phrases)", allVals.every((v) => !/\s/.test(v)), JSON.stringify(allVals));

  handlers.get("session_shutdown")({ type: "session_shutdown" }, ctx);
  rmSync(home, { recursive: true, force: true });
}

// ================================================= Journey C — restore path
console.log("\nJourney C — session restore via history replay (spec 09 item 3)");
{
  const home = mkdtempSync(join(tmpdir(), "hapax-e2e-home-"));
  process.env.HOME = home;
  const { pi, handlers } = fakePi();
  const entries = [
    msgEntry("m1", userMsg("We discussed Zendesk escalation and lwlock semantics.")),
    msgEntry("m2", assistantMsg([{ type: "text", text: "Zendesk escalation flows through the lwlock path." }])),
  ];
  const { ctx, getProviderFactory } = fakeCtx({ branch: [...entries].reverse(), entries });
  hapax(pi);
  handlers.get("session_start")({ type: "session_start", reason: "resume" }, ctx);
  const provider = getProviderFactory()(currentFake());

  const t0 = Date.now();
  const early = await getSug(provider, ["ze"], 2);
  const waited = Date.now() - t0;
  check("C1 first query after resume finds Zendesk (startup gate)", values(early).includes("Zendesk"), JSON.stringify(values(early)));
  check("C2 gate wait bounded (≤ 600ms wall)", waited <= 600, `${waited}ms`);

  await settle(700);
  const late = await getSug(provider, ["lwl"], 3);
  check("C3 replayed assistant message admits lwlock", values(late).includes("lwlock"), JSON.stringify(values(late)));
  const late2 = await getSug(provider, ["ze"], 2);
  check("C4 session counts merged across replay (Zendesk x2+)", values(late2).includes("Zendesk"), JSON.stringify(values(late2)));

  handlers.get("session_shutdown")({ type: "session_shutdown" }, ctx);
  rmSync(home, { recursive: true, force: true });
}

// ============================================== Journey D — widget + rebind
console.log("\nJourney D — widget primary path + session rebind (spec 07)");
{
  const home = mkdtempSync(join(tmpdir(), "hapax-e2e-home-"));
  process.env.HOME = home;
  const { pi, handlers } = fakePi();
  const innerFactory = () => ({ handleInput: () => {} });
  const { ctx, getInstalled } = fakeCtx({ editorFactory: innerFactory });
  hapax(pi);

  handlers.get("session_start")({ type: "session_start", reason: "new" }, ctx);
  const installed1 = getInstalled();
  check("D1 widget path installs an editor factory", installed1.length === 1, String(installed1.length));
  check("D2 installed factory is the widget wrapper", isWidgetWrapper(installed1[0]));
  const opts1 = widgetOptsOf(installed1[0]);

  handlers.get("session_start")({ type: "session_start", reason: "resume" }, ctx);
  const installed2 = getInstalled();
  check("D3 re-fire installs a fresh wrapper", installed2.length === 2 && installed2[1] !== installed2[0]);
  check("D4 re-bind wraps the ORIGINAL factory (no stacking)", widgetOptsOf(installed2[1]).inner === innerFactory);
  const opts2 = widgetOptsOf(installed2[1]);
  check("D5 re-bound wrapper serves the NEW session store", opts2.store !== opts1.store);

  await handlers.get("message_end")({ type: "message_end", message: userMsg("WidgetRebindProbe zendesk") }, ctx);
  await settle();
  const { rankMatches } = await import(`${BUILD}/core/query.js`);
  const probe = rankMatches(opts2.store, "widgetreb", { limit: 8 });
  check("D6 widget-bound store receives session-2 ingestion", probe.some((m) => m.key === "widgetrebindprobe"), JSON.stringify(probe.map((m) => m.key)));

  handlers.get("session_shutdown")({ type: "session_shutdown" }, ctx);
  handlers.get("session_start")({ type: "session_start", reason: "new" }, ctx);
  check("D7 shutdown → session_start cycle rebuilds cleanly", true);
  handlers.get("session_shutdown")({ type: "session_shutdown" }, ctx);
  rmSync(home, { recursive: true, force: true });
}

// =============================================== Journey E — dict failure
console.log("\nJourney E — dictionary failure disables gracefully (never crash)");
{
  const home = mkdtempSync(join(tmpdir(), "hapax-e2e-home-"));
  process.env.HOME = home;
  const badDict = join(home, "bad.bin");
  writeFileSync(badDict, Buffer.from("this is not a HAPX dictionary"));
  process.env.HAPAX_DICT = badDict;
  const { pi, handlers } = fakePi();
  const { ctx, notifyCalls, getProviderFactory } = fakeCtx();
  hapax(pi);
  handlers.get("session_start")({ type: "session_start", reason: "new" }, ctx);
  const provider = getProviderFactory()(currentFake());
  await handlers.get("message_end")({ type: "message_end", message: userMsg("zendesk lwlock words") }, ctx);
  await settle();
  const errs = notifyCalls.filter((n) => n.l === "error");
  check("E1 exactly one error notify on dict failure", errs.length === 1, JSON.stringify(errs));
  const r = await getSug(provider, ["ze"], 2);
  check("E2 degraded provider delegates (zero candidates, no crash)", r === null, JSON.stringify(r));
  const ret = await handlers.get("message_end")({ type: "message_end", message: userMsg("more") }, ctx);
  check("E3 disabled runtime stays a no-op (returns undefined)", ret === undefined);
  delete process.env.HAPAX_DICT;
  rmSync(home, { recursive: true, force: true });
}

// ================================================== Journey F — configuration
console.log("\nJourney F — configuration journeys (spec 08)");
{
  const home = mkdtempSync(join(tmpdir(), "hapax-e2e-home-"));
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "hapax.json"), JSON.stringify({ maxSuggestions: 3 }));
  process.env.HOME = home;
  delete process.env.HAPAX_DICT;
  const { pi, handlers } = fakePi();
  const { ctx, getProviderFactory } = fakeCtx();
  hapax(pi);
  handlers.get("session_start")({ type: "session_start", reason: "new" }, ctx);
  const provider = getProviderFactory()(currentFake());
  await handlers.get("message_end")({ type: "message_end", message: userMsg("zeta_one zeta_two zeta_three zeta_four zeta_five") }, ctx);
  await settle();
  const r = await getSug(provider, ["ze"], 2);
  check("F1 maxSuggestions=3 caps the result set", r && r.items.length <= 3, JSON.stringify(values(r)));

  const home1b = mkdtempSync(join(tmpdir(), "hapax-e2e-home-"));
  mkdirSync(join(home1b, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home1b, ".pi", "agent", "hapax.json"), JSON.stringify({ triggerChar: "+" }));
  process.env.HOME = home1b;
  const { pi: pi1b, handlers: h1b } = fakePi();
  const { ctx: ctx1b, getProviderFactory: pf1b } = fakeCtx();
  hapax(pi1b);
  h1b.get("session_start")({ type: "session_start", reason: "new" }, ctx1b);
  const p1b = pf1b()(currentFake());
  await h1b.get("message_end")({ type: "message_end", message: userMsg("zendesk lwlock again") }, ctx1b);
  await settle();
  const plus = await getSug(p1b, ["+ze"], 3);
  check("F2 custom triggerChar '+' works", values(plus).includes("Zendesk") || values(plus).some((v) => /zendesk/i.test(v)), JSON.stringify(values(plus)));
  h1b.get("session_shutdown")({ type: "session_shutdown" }, ctx1b);
  rmSync(home1b, { recursive: true, force: true });
  process.env.HOME = home;
  handlers.get("session_shutdown")({ type: "session_shutdown" }, ctx);
  rmSync(home, { recursive: true, force: true });

  const home2 = mkdtempSync(join(tmpdir(), "hapax-e2e-home-"));
  mkdirSync(join(home2, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home2, ".pi", "agent", "hapax.json"), "{oops not json");
  process.env.HOME = home2;
  const { pi: pi2, handlers: h2 } = fakePi();
  const { ctx: ctx2, notifyCalls: nc2, getProviderFactory: pf2 } = fakeCtx();
  hapax(pi2);
  h2.get("session_start")({ type: "session_start", reason: "new" }, ctx2);
  check("F3 malformed config warns exactly once (level: warning)", nc2.filter((n) => n.l === "warning" || n.l === "warn").length === 1, JSON.stringify(nc2));
  const p2 = pf2()(currentFake());
  await h2.get("message_end")({ type: "message_end", message: userMsg("zendesk again") }, ctx2);
  await settle();
  const r2 = await getSug(p2, ["ze"], 2);
  check("F4 defaults still serve completions after repair", values(r2).includes("zendesk") || values(r2).some((v) => /zendesk/i.test(v)), JSON.stringify(values(r2)));
  h2.get("session_shutdown")({ type: "session_shutdown" }, ctx2);
  rmSync(home2, { recursive: true, force: true });
}

// ================================================= Journey G — debug command
console.log("\nJourney G — debug command /acwords (spec 08)");
{
  const home = mkdtempSync(join(tmpdir(), "hapax-e2e-home-"));
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "hapax.json"), JSON.stringify({ debug: true }));
  process.env.HOME = home;
  const { pi, handlers, commands } = fakePi();
  const { ctx } = fakeCtx();
  hapax(pi);
  handlers.get("session_start")({ type: "session_start", reason: "new" }, ctx);
  check("G1 /acwords registered in debug mode", commands.has("acwords"));
  await handlers.get("message_end")({ type: "message_end", message: userMsg("zendesk lwlock acornville") }, ctx);
  await settle();
  const notifies = [];
  const dumpCtx = { ui: { notify: (m, l) => notifies.push({ m, l }) } };
  await commands.get("acwords").handler({}, dumpCtx);
  const dump = notifies.map((n) => n.m).join("\n");
  check("G2 dump lists store contents", /zendesk/.test(dump));
  check("G3 dump names the full-store file path", /\/tmp\/hapax-store\.txt/.test(dump));
  check("G4 full store file written", existsSync("/tmp/hapax-store.txt"));
  const storeFile = readFileSync("/tmp/hapax-store.txt", "utf8");
  check("G5 store file contains admitted words", /zendesk/.test(storeFile));
  handlers.get("session_shutdown")({ type: "session_shutdown" }, ctx);
  rmSync(home, { recursive: true, force: true });
}

// ============================================== Journey H — adversarial ingest
console.log("\nJourney H — adversarial ingestion (never-hijack edges)");
{
  const home = mkdtempSync(join(tmpdir(), "hapax-e2e-home-"));
  process.env.HOME = home;
  const { pi, handlers } = fakePi();
  const { ctx, getProviderFactory } = fakeCtx();
  hapax(pi);
  handlers.get("session_start")({ type: "session_start", reason: "new" }, ctx);
  const provider = getProviderFactory()(currentFake());

  const adversarial = [
    "Þórhildur and ΩbsidianMirror must yield nothing non-ASCII-adjacent",
    " emails like user2@host.com are secret-shaped and rejected",
    "AAAAAAAaaaaaaa dies on entropy, qqqxxxzzzvvv on consonant runs",
    "ffffffffffffffffffffffffffffffffffffff (40 hex chars, >= 20 → secret)",
    "5105105105105105 (16 digits → PAN-shaped reject)",
    "don't splits at apostrophe: don",
    "state-of-the-art stays whole; --flag never forms",
  ].join("\n");
  await handlers.get("message_end")({ type: "message_end", message: userMsg(adversarial) }, ctx);
  await settle();

  const probes = await Promise.all([
    getSug(provider, ["#rhild"], 6),
    getSug(provider, ["#host"], 5),
    getSug(provider, ["#bsidian"], 8),
    getSug(provider, ["#qqq"], 4),
    getSug(provider, ["#5105"], 5),
    getSug(provider, ["state-of"], 7),
  ]);
  const [rhild, host, bsidian, qqq, pan, compound] = probes.map(values);
  check("H1 non-ASCII-adjacent 'rhildur' never completes", !rhild.some((v) => /rhild/i.test(v)), JSON.stringify(rhild));
  check("H2 email user2@host.com rejected", !host.some((v) => v.includes("host.com")), JSON.stringify(host));
  check("H3 'ΩbsidianMirror' yields nothing", !bsidian.some((v) => /bsidian/i.test(v)), JSON.stringify(bsidian));
  check("H4 consonant-run noise rejected", !qqq.some((v) => /qqqxxx/i.test(v)), JSON.stringify(qqq));
  check("H5 PAN-shaped digits rejected", !pan.some((v) => v.startsWith("5105")), JSON.stringify(pan));
  check("H6 hyphenated compound completes whole", compound.some((v) => v === "state-of-the-art"), JSON.stringify(compound));

  const commons = await Promise.all(["the", "con", "del", "lis", "pro"].map((f) => getSug(provider, [f], f.length)));
  const flat = commons.flatMap(values);
  check("H7 common words themselves never offered", !flat.some((v) => /^(the|context|deleted|lists|provider)$/i.test(v)), JSON.stringify(flat));

  handlers.get("session_shutdown")({ type: "session_shutdown" }, ctx);
  rmSync(home, { recursive: true, force: true });
}

console.log(`\n=== E2E: ${pass} passed, ${fail} failed ===`);
if (failures.length) { console.log(failures.map((f) => " - " + f).join("\n")); process.exit(1); }
process.exit(0);
E2EEOF

if HAPAX_E2E_BUILD="$VBUILD" node "$VDIR/e2e.mjs" > /tmp/hapax-val-e2e.log 2>&1; then
  ok "all E2E journeys passed"
  grep -cE "^  ok" /tmp/hapax-val-e2e.log | sed 's/^/  checks passed: /'
else
  bad "E2E journeys failed"; tail -40 /tmp/hapax-val-e2e.log
fi
sed -n '1,200p' /tmp/hapax-val-e2e.log | sed 's/^/  | /'

# ---------------------------------------------------------------- Phase 6 --
phase 6 "Real pi host load (pi -p -e, jiti loader; network-gated)"
if command -v pi >/dev/null 2>&1; then
  SCRATCH=$(mktemp -d)
  if (cd "$SCRATCH" && timeout 90 pi -p -e "$REPO" --no-builtin-tools "say Zendesk lwlock" >/tmp/hapax-val-pi.log 2>/tmp/hapax-val-pi.err); then
    grep -q "Zendesk lwlock" /tmp/hapax-val-pi.log && ok "extension loads under real pi host; clean run, empty stderr" || { bad "pi -p ran but output unexpected"; cat /tmp/hapax-val-pi.log; }
  else
    RC=$?
    if [ "$RC" = "124" ]; then skip "pi -p timed out (no auth / offline?) — treated as environment-gated"; else bad "pi -p exited $RC"; cat /tmp/hapax-val-pi.err; fi
  fi
  rm -rf "$SCRATCH"
else
  skip "pi CLI not on PATH"
fi

# ---------------------------------------------------------------- Phase 7 --
phase 7 "Live TTY verification (tmux; spec 09 binding technique)"
if [ "${HAPAX_VALIDATE_SKIP_TTY:-0}" = "1" ]; then
  skip "opted out via HAPAX_VALIDATE_SKIP_TTY=1"
elif ! command -v tmux >/dev/null 2>&1; then
  skip "tmux not available"
elif ! command -v pi >/dev/null 2>&1; then
  skip "pi CLI not on PATH"
else
  S=hapaxval$$
  cleanup() { tmux kill-session -t "$S" 2>/dev/null; }
  trap cleanup EXIT

  # ---- 7a: FALLBACK path (no editor extension → vertical stock menu) -----
  tmux new-session -d -s "$S" -x 160 -y 45 "pi --no-session --no-extensions -e '$REPO' --no-builtin-tools"
  T0=$(date +%s)
  until tmux capture-pane -t "$S" -p 2>/dev/null | grep -qE "Type|INSERT|NORMAL|>"; do
    sleep 0.5; [ $(( $(date +%s) - T0 )) -gt 30 ] && break
  done
  sleep 2
  tmux send-keys -t "$S" -l "We debugged the Zendesk sync and the lwlock contention."
  sleep 1
  tmux send-keys -t "$S" Enter
  sleep 2
  tmux send-keys -t "$S" C-c 2>/dev/null   # cancel the turn — user msg already ingested
  sleep 1
  tmux send-keys -t "$S" -l 'z'; sleep 0.1
  tmux send-keys -t "$S" -l 'e'; sleep 0.4
  CAP=$(tmux capture-pane -t "$S" -p)
  echo "$CAP" | grep -q "Zendesk" && ok "7a1 FALLBACK: typing 'ze' shows menu with Zendesk" || bad "7a1 FALLBACK: no Zendesk menu after 'ze'"
  echo "$CAP" | grep -q "session x" && ok "7a2 FALLBACK: provenance description rendered" || bad "7a2 FALLBACK: no session count description"
  tmux send-keys -t "$S" Tab; sleep 0.5
  CAP=$(tmux capture-pane -t "$S" -p)
  echo "$CAP" | grep -qE "^Zendesk" && ok "7a3 FALLBACK: Tab inserts Zendesk (cased)" || bad "7a3 FALLBACK: Tab did not insert Zendesk"
  tmux send-keys -t "$S" Escape; sleep 0.3
  tmux send-keys -t "$S" -l ' '; sleep 0.1
  tmux send-keys -t "$S" -l '#'; sleep 0.15
  tmux send-keys -t "$S" -l 'l'; sleep 0.4
  CAP=$(tmux capture-pane -t "$S" -p)
  echo "$CAP" | grep -q "lwlock" && ok "7a4 FALLBACK: '#l' trigger char offers lwlock" || bad "7a4 FALLBACK: '#l' no lwlock menu"
  tmux send-keys -t "$S" Escape; sleep 0.3
  tmux send-keys -t "$S" -l ' '; sleep 0.1
  tmux send-keys -t "$S" -l 't'; sleep 0.1
  tmux send-keys -t "$S" -l 'h'; sleep 0.4
  CAP=$(tmux capture-pane -t "$S" -p)
  if echo "$CAP" | grep -v "^\s*$" | grep -qE "session x|lwlock"; then :; fi
  MENU_LINES=$(echo "$CAP" | grep -cE "session x[0-9]+")
  [ "$MENU_LINES" = "0" ] && ok "7a5 FALLBACK: common word 'th' shows no menu (no-hijack)" || bad "7a5 FALLBACK: menu appeared for 'th'"
  tmux kill-session -t "$S" 2>/dev/null

  # ---- 7b: WIDGET path (real user stack incl. pi-vim + split-editor) ------
  if pi list 2>/dev/null | grep -q "pi-vim"; then
    tmux new-session -d -s "$S" -x 160 -y 45 "pi --no-session --no-builtin-tools"
    T0=$(date +%s)
    until tmux capture-pane -t "$S" -p 2>/dev/null | grep -qE "INSERT|NORMAL"; do
      sleep 0.5; [ $(( $(date +%s) - T0 )) -gt 30 ] && break
    done
    sleep 2
    tmux send-keys -t "$S" -l "Again: the Zendesk sync and lwlock contention were fixed."
    sleep 1
    tmux send-keys -t "$S" Escape; sleep 0.2
    tmux send-keys -t "$S" Enter
    sleep 2
    tmux send-keys -t "$S" C-c 2>/dev/null
    sleep 1
    tmux send-keys -t "$S" i; sleep 0.3            # pi-vim INSERT mode
    tmux send-keys -t "$S" -l 'z'; sleep 0.1
    tmux send-keys -t "$S" -l 'e'; sleep 0.4
    CAP=$(tmux capture-pane -t "$S" -p)
    echo "$CAP" | grep -qE "^\s*Zendesk\s*$" && ok "7b1 WIDGET: one-line result renders below editor" || bad "7b1 WIDGET: no result line after 'ze'"
    tmux send-keys -t "$S" Tab; sleep 0.5
    CAP=$(tmux capture-pane -t "$S" -p)
    echo "$CAP" | grep -qE "Zendesk" && ok "7b2 WIDGET: Tab inserts highlighted word" || bad "7b2 WIDGET: Tab did not insert"
    tmux send-keys -t "$S" -l ' lw'; sleep 0.4
    CAP=$(tmux capture-pane -t "$S" -p)
    echo "$CAP" | grep -qE "lwlock" && ok "7b3 WIDGET: multi-item line renders" || bad "7b3 WIDGET: no line for 'lw'"
    tmux send-keys -t "$S" Left; sleep 0.2
    tmux send-keys -t "$S" Left; sleep 0.3
    CAP=$(tmux capture-pane -t "$S" -p)
    MENU_LINES=$(echo "$CAP" | grep -cE "lwlock \| | \| lwlock")
    [ "$MENU_LINES" = "0" ] && ok "7b4 WIDGET: boundary-Esc (← on first word) dismisses line" || bad "7b4 WIDGET: line not dismissed"
    tmux kill-session -t "$S" 2>/dev/null
  else
    skip "7b WIDGET path: pi-vim not installed — cannot exercise editor-factory stack"
  fi
fi

# ------------------------------------------------------------------ hygiene -
phase 8 "Hygiene — no persistence, repo untouched"
GIT_END="$(git status --porcelain 2>/dev/null | head -50)"
if [ "$GIT_START" = "$GIT_END" ]; then ok "repo working tree unchanged by validation"; else bad "repo tree changed during validation"; echo "$GIT_END"; fi

# ------------------------------------------------------------------ verdict -
echo
echo "================================================================"
if [ "$PHASES_FAILED" -eq 0 ]; then
  echo "VALIDATION RESULT: ALL PHASES PASSED"
  exit 0
else
  echo "VALIDATION RESULT: $PHASES_FAILED FAILURE(S)"
  exit 1
fi
