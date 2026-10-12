#!/usr/bin/env bash
# ============================================================================
# hapax — comprehensive validation script (validator agent, re-validation pass)
#
# Phases (only those that exist in this repo):
#   0. Preflight      — toolchain + clean-source-tree guard
#   1. Linting        — SKIPPED (no linter configured: no eslint/ruff config)
#   2. Type checking  — npm run check (tsc --noEmit)
#   3. Style checking — SKIPPED (no formatter configured: no prettier/editorconfig check target)
#   4. Unit testing   — npm test (vitest --run, full shipped suite)
#   5. E2E validation — independent probe suite through the REAL production
#                       factory (src/pi/index.ts) + static contract checks
#                       (BUG-001..004 fix seams, pi-tui dist PIN) + advisory
#                       open-item checks (spec-drift worklist, stale e2e pin)
#
# Exit code: non-zero if ANY hard check fails. Advisory items (known-open
# minor findings, also listed in validation_report.md) print as OPEN ITEMS
# and do not fail the run — the structured verdict lives in
# validation_result.json and stays consistent with validation_report.md.
#
# E2E probes write only to /tmp (never to the repo). The repo itself is
# never modified by this script.
# ============================================================================
set -u -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK=/tmp/hapax-validate-run
PASS=0; FAIL=0
hr() { printf '%s\n' "------------------------------------------------------------"; }
ok()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
skip(){ printf '  \033[33mSKIP\033[0m  %s\n' "$1"; }
warn(){ printf '  \033[33mOPEN\033[0m  %s\n' "$1"; }
cd "$REPO_ROOT"

hr; echo "Phase 0 — Preflight"
command -v node >/dev/null 2>&1 && ok "node $(node --version) present" || { bad "node missing"; exit 1; }
[ -d node_modules ] && ok "node_modules present (deps installed)" || { bad "node_modules missing — run npm install"; exit 1; }
# Clean-source guard: validating uncommitted src/test/spec edits produces
# non-reproducible evidence. plan/ and the 3 validation artifacts are exempt.
DIRTY="$(git status --porcelain -- src test spec README.md package.json tsconfig.json 2>/dev/null | head -5)"
if [ -z "${DIRTY:-}" ]; then ok "source tree clean (src/ test/ spec/ README.md)"; else
  bad "source tree dirty — commit or stash before validating:"; printf '%s\n' "$DIRTY"; exit 1
fi

hr; echo "Phase 1 — Linting"; skip "no linter configured in this repo (package.json: check/test/bench only)"
hr; echo "Phase 3 — Style";  skip "no formatter/check-style target configured"

hr; echo "Phase 2 — Type checking (npm run check)"
if npm run --silent check >/tmp/hapax-tsc.log 2>&1; then ok "tsc --noEmit clean"; else
  bad "typecheck failed"; tail -30 /tmp/hapax-tsc.log; fi

hr; echo "Phase 4 — Unit testing (npm test — full shipped suite)"
if npm test >/tmp/hapax-vitest.log 2>&1; then
  SUMMARY="$(grep -E "Tests  " /tmp/hapax-vitest.log | tail -1 | sed 's/^ *//')"
  ok "vitest suite green — ${SUMMARY:-summary unavailable}"
else
  bad "vitest suite FAILED"; grep -E "Test Files|Tests  |FAIL" /tmp/hapax-vitest.log | tail -15
fi

# ============================================================================
hr; echo "Phase 5 — End-to-end validation"
# 5a. Static contract checks at the four bugfix seams (fast, deterministic)
echo "  [5a] static contract checks (BUG-001..004 fix seams)"
grep -q "onAdmittedTokens: (runs) => sessionStore.recordBigramRuns(runs)" src/pi/index.ts \
  && ok "BUG-001 seam: production wiring passes the enriched runs payload" \
  || bad "BUG-001 seam: enriched wiring missing in src/pi/index.ts"
if grep -q "onAdmittedTokens: (runs) => sessionStore.recordBigramRuns(runs.map" src/pi/index.ts \
   || grep -q "onAdmittedTokens: (runs) => .*recordBigramRuns(runs.map" test/acceptance.test.ts test/adversarial-typing.test.ts test/index.test.ts; then
  bad "BUG-001 seam: a bare-key shim still mirrors the old production wiring"
else ok "BUG-001 seam: no bare-key shim at the production seam or its e2e mirrors (bigrams.test.ts legacy-string feed is the documented store input contract)"; fi
grep -q 'if (c.pathDisplay !== undefined) return c.pathDisplay;' src/core/query.ts \
  && ok "BUG-002 seam: query resolver returns verbatim pathDisplay first" \
  || bad "BUG-002 seam: pathDisplay guard missing in src/core/query.ts"
grep -q '...(sighting.path ? { pathDisplay: sighting.display } : {}),' src/core/store.ts \
  && ok "BUG-002 seam: store seeds pathDisplay sticky-first at create branch" \
  || bad "BUG-002 seam: pathDisplay seeding missing in src/core/store.ts"
grep -q 'zeroCharOffer(typed.toLowerCase(), now) === "painted"' src/pi/widget.ts \
  && ok "BUG-003 seam: arming tick paints the zero-char offer" \
  || bad "BUG-003 seam: same-tick paint missing in src/pi/widget.ts"
grep -q "NO RE-REQUEST AFTER APPLY" src/pi/provider.ts \
  && ok "BUG-004 seam: no-re-request PIN present at the consumption site" \
  || bad "BUG-004 seam: PIN comment missing in src/pi/provider.ts"
grep -q "fallback path — post-accept battery (spec 07 h3.11 fallback paragraph)" test/provider-live.test.ts \
  && ok "BUG-004 seam: fallback-path post-accept battery exists" \
  || bad "BUG-004 seam: fallback battery missing in test/provider-live.test.ts"

# pi-tui dist contract (the PIN's factual basis — verified against the
# installed package, not the comment): all three applyCompletion sites must
# apply-and-return WITHOUT a requestAutocomplete call nearby.
echo "  [5b] pi-tui installed-dist contract (no re-request after apply)"
DIST=node_modules/@earendil-works/pi-tui/dist/components/editor.js
SITES="$(grep -n "this.autocompleteProvider.applyCompletion(" "$DIST" | cut -d: -f1 | tr '\n' ' ')"
LEAK=0
for L in $SITES; do
  if sed -n "${L},$((L+12))p" "$DIST" | grep -q "requestAutocomplete"; then LEAK=1; fi
done
if [ "${#SITES}" -gt 0 ] && [ "$LEAK" -eq 0 ]; then
  ok "all applyCompletion sites ($SITES) return without re-requesting"
else bad "pi-tui contract drifted: a post-apply re-request appeared (PIN + spec 07 h3.15 must be re-verified)"; fi

# 5c. Independent E2E probe suite — composes the REAL extension factory with
# a fake pi shell + a minimal fixture dictionary (ONLY the shell and the dict
# file are faked; pipeline, store, query, provider, widget are production
# objects). Covers the four PRD bugs end-to-end plus regression corners.
echo "  [5c] independent E2E probes through the real factory (materialized to $WORK)"
rm -rf "$WORK"; mkdir -p "$WORK"
ln -sfn "$REPO_ROOT/node_modules" "$WORK/node_modules"
cat > "$WORK/vitest.config.ts" <<'EOF'
import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: process.env.HAPAX_PROBE_ROOT!,
  test: { include: ['/tmp/hapax-validate-run/**/*.test.ts'] },
});
EOF
cat > "$WORK/probe.test.ts" <<'EOF'
/**
 * INDEPENDENT validation probes (validate.sh Phase 5c).
 * Self-contained harness; composes the REAL src/pi/index.ts factory.
 * Only the pi shell (fakePi/fakeCtx) and the dictionary file are faked.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI, ExtensionContext, MessageEndEvent, SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import hapax from "__REPO_ROOT__/src/pi/index.ts";
import type { AgentMessage } from "__REPO_ROOT__/src/pi/ingest.ts";
import { widgetOptsOf, widgetStateOf } from "__REPO_ROOT__/src/pi/widget.ts";
import { writeDictFile } from "__REPO_ROOT__/test/helpers/dict-writer.ts";

type Handler = (event: any, ctx: ExtensionContext) => unknown;
function fakePi() {
  const handlers = new Map<string, Handler>();
  const on = vi.fn((name: string, handler: Handler) => handlers.set(name, handler));
  const registerCommand = vi.fn();
  return { pi: { on, registerCommand } as unknown as ExtensionAPI, registerCommand, handlers };
}
function fakeCtx(over: { editorFactory?: unknown } = {}) {
  const notify = vi.fn();
  const addAutocompleteProvider = vi.fn();
  const getEditorComponent = vi.fn(() => over.editorFactory);
  const setEditorComponent = vi.fn();
  const ctx = {
    ui: { notify, addAutocompleteProvider, getEditorComponent, setEditorComponent },
    cwd: workCwd,
    isProjectTrusted: vi.fn(() => true),
    sessionManager: { getBranch: vi.fn(() => []), getEntries: vi.fn(() => []) },
  } as unknown as ExtensionContext;
  return { ctx, addAutocompleteProvider, setEditorComponent };
}
const userMsg = (content: string) => ({ role: "user", content, timestamp: 0 }) as AgentMessage;
const startSession = (h: Handler, ctx: ExtensionContext) =>
  h({ type: "session_start", reason: "new" } as SessionStartEvent, ctx);
const endMessage = async (h: Handler, ctx: ExtensionContext, m: AgentMessage) =>
  await h({ type: "message_end", message: m } as MessageEndEvent, ctx);
const currentFake = (): AutocompleteProvider =>
  ({ getSuggestions: vi.fn(async () => null),
     applyCompletion: vi.fn((lines: string[], cursorLine: number, cursorCol: number) =>
       ({ lines, cursorLine, cursorCol })) }) as unknown as AutocompleteProvider;
const sig = () => ({ signal: new AbortController().signal });

let home: string; let workCwd: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hapax-val-home-"));
  workCwd = mkdtempSync(join(tmpdir(), "hapax-val-cwd-"));
  vi.stubEnv("HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workCwd, { recursive: true, force: true });
  rmSync("/tmp/hapax-store.txt", { force: true });
});
function useDict() {
  const p = join(workCwd, "dict.bin");
  writeDictFile(p, [{ word: "the", quant: 200 }]);
  if (process.env.HAPAX_DICT === undefined) vi.stubEnv("HAPAX_DICT", p);
  return p;
}
function writeConfig(fields: Record<string, unknown>) {
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  writeFileSync(join(home, ".pi", "agent", "hapax.json"),
    JSON.stringify({ debug: true, ...fields }));
}
function acwordsHandler(register: Mock, index = 0) {
  const calls = register.mock.calls.filter((c: any[]) => c[0] === "acwords");
  return calls[index]![1].handler;
}
async function dump(handler: (args: unknown, ctx: unknown) => Promise<void>) {
  const notify = vi.fn();
  await handler({}, { ui: { notify } });
  return notify.mock.calls.map((c) => c[0] as string).join("\n");
}
async function wiredSession(opts: {
  editorFactory?: unknown; config?: Record<string, unknown>;
  msgs: string[]; until: RegExp;
}) {
  useDict(); writeConfig(opts.config ?? {});
  const f = fakePi(); const c = fakeCtx({ editorFactory: opts.editorFactory });
  hapax(f.pi, {} as never);
  startSession(f.handlers.get("session_start")!, c.ctx);
  for (const m of opts.msgs) await endMessage(f.handlers.get("message_end")!, c.ctx, userMsg(m));
  const handler = acwordsHandler(f.registerCommand);
  await vi.waitFor(async () => {
    expect(await dump(handler)).toMatch(opts.until);
  }, { timeout: 4000 });
  return { ...f, ...c, dumpHandler: handler };
}
function statefulInnerEditor() {
  const buf = { lines: [""] as string[], line: 0, col: 0 };
  const factory = () => ({
    handleInput: (d: string): string => d,
    getLines: () => buf.lines,
    getCursor: () => ({ line: buf.line, col: buf.col }),
    setText: (t: string) => {
      buf.lines = t.split("\n");
      buf.line = buf.lines.length - 1;
      buf.col = (buf.lines[buf.lines.length - 1] ?? "").length;
    },
    setCursorCol: (cc: number) => { buf.col = cc; },
    getText: () => buf.lines.join("\n"),
    render: () => [buf.lines[buf.line] ?? ""],
  });
  return { factory, buf };
}
const typeChar = async (
  editor: unknown, buf: { lines: string[]; line: number; col: number }, ch: string,
) => {
  const row = buf.lines[buf.line] ?? "";
  buf.lines = [...buf.lines];
  buf.lines[buf.line] = row.slice(0, buf.col) + ch + row.slice(buf.col);
  buf.col += 1;
  (editor as { handleInput: (d: string) => unknown }).handleInput(ch);
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const composeWidget = (setEditorComponent: Mock) => {
  const installed = setEditorComponent.mock.calls[0]![0] as (
    tui: unknown, theme: unknown, keybindings: unknown) => Record<string, unknown>;
  const editor = installed({}, {},
    { matches: (d: string, a: string) => a === "tui.input.submit" && d === "\r" });
  const state = widgetStateOf(editor)! as unknown as {
    hidden: boolean; items: readonly { display: string }[];
  };
  const opts = widgetOptsOf(installed)!;
  return { editor, state, chainState: () => opts.chain.state() };
};

// PROBE-1 — BUG-001 on the FALLBACK path (independent corpus Alpha/Beta)
describe("PROBE-1: series enrichment through the real factory (fallback)", () => {
  it("run Alpha->Beta lands series-marked with run casing; 'Alpha ' arms + offers 'Beta'", async () => {
    const { addAutocompleteProvider, dumpHandler } = await wiredSession({
      msgs: ["Alpha Beta gamma delta epsilon today"],
      until: /alpha → Beta ×1 \(series\)/,
    });
    const text = await dump(dumpHandler);
    expect(text).toMatch(/alpha → Beta ×1 \(series\)/);
    expect(text).not.toMatch(/alpha → beta ×/);
    const provider = (addAutocompleteProvider.mock.calls[0]![0] as (
      c: AutocompleteProvider) => AutocompleteProvider)(currentFake());
    expect(await provider.getSuggestions(["Alpha "], 0, 6, sig())).toBeNull();
    const offer = await provider.getSuggestions(["Alpha "], 0, 6, sig());
    expect(offer!.prefix).toBe("");
    expect(offer!.items[0]!.value).toBe("Beta");
  });
  it("series-first: x1 series successor outranks a x3 ordinary successor", async () => {
    const { addAutocompleteProvider } = await wiredSession({
      msgs: ["Alpha Beta gamma", "alpha gamma delta", "alpha gamma delta", "alpha gamma delta"],
      until: /alpha → Beta ×1 \(series\), gamma ×3/,
    });
    const provider = (addAutocompleteProvider.mock.calls[0]![0] as (
      c: AutocompleteProvider) => AutocompleteProvider)(currentFake());
    await provider.getSuggestions(["Alpha "], 0, 6, sig());
    const offer = await provider.getSuggestions(["Alpha "], 0, 6, sig());
    expect(offer!.items[0]!.value).toBe("Beta");
    expect(offer!.items.map((i) => i.value)).toContain("gamma");
  });
  it("negative control: no series successor -> no arm, no zero-char offer", async () => {
    const { addAutocompleteProvider } = await wiredSession({
      msgs: ["alpha beta gamma delta epsilon today"], until: /words seen: [1-9]/,
    });
    const provider = (addAutocompleteProvider.mock.calls[0]![0] as (
      c: AutocompleteProvider) => AutocompleteProvider)(currentFake());
    expect(await provider.getSuggestions(["Alpha "], 0, 6, sig())).toBeNull();
    const r2 = await provider.getSuggestions(["Alpha "], 0, 6, sig());
    expect(r2?.prefix ?? "x").not.toBe("");
  });
});

// PROBE-2 — BUG-001 + BUG-003 on the WIDGET path (space-tick paint)
describe("PROBE-2: typed-word arming + SAME-TICK zero-char paint (widget)", () => {
  async function seriesWidget(config?: Record<string, unknown>) {
    const ed = statefulInnerEditor();
    const w = await wiredSession({
      editorFactory: ed.factory, config,
      msgs: ["Alpha Beta gamma delta epsilon today"],
      until: /alpha → Beta ×1 \(series\)/,
    });
    return { ed, w, ...composeWidget(w.setEditorComponent) };
  }
  it("'Alpha ' arms AND paints 'Beta' at the SPACE tick; Tab inserts it", async () => {
    const { ed, editor, state, chainState } = await seriesWidget();
    for (const ch of ["A", "l", "p", "h", "a"]) await typeChar(editor, ed.buf, ch);
    expect(state.hidden).toBe(true);
    expect(chainState()).toBeNull();
    await typeChar(editor, ed.buf, " ");
    expect(chainState()).toEqual({ word: "alpha" });
    expect(state.hidden).toBe(false);              // painted at the arming tick
    expect(state.items.map((i) => i.display)).toEqual(["Beta"]);
    expect(state.items.length).toBeGreaterThan(0); // invariant 3
    await typeChar(editor, ed.buf, "B");
    expect(state.hidden).toBe(false);
    expect(state.items.map((i) => i.display)).toContain("Beta");
    (editor as { handleInput: (d: string) => unknown }).handleInput("\t");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(ed.buf.lines[0]).toBe("Alpha Beta");
  });
  it("paint survives a maximal hesitation window (chain intent)", async () => {
    const { ed, editor, state, chainState } = await seriesWidget({ menuDelayMs: 5000 });
    for (const ch of ["A", "l", "p", "h", "a", " "]) await typeChar(editor, ed.buf, ch);
    expect(chainState()).toEqual({ word: "alpha" });
    expect(state.hidden).toBe(false);
    expect(state.items.map((i) => i.display)).toEqual(["Beta"]);
  });
  it("ordinary lowercase trailing space: closes, no paint, no arm", async () => {
    const { ed, editor, state, chainState } = await seriesWidget();
    for (const ch of ["g", "a", "m", "m", "a", " "]) await typeChar(editor, ed.buf, ch);
    expect(state.hidden).toBe(true);
    expect(chainState()).toBeNull();
    expect(state.items.length).toBe(0);
  });
});

// PROBE-3 — BUG-002 verbatim path display/insert (independent paths)
const TILDE = "~/logs/hapax-run.log";
const ABS2 = "/srv/data/manifest.json";
describe("PROBE-3: path edges preserved end-to-end (BUG-002)", () => {
  async function pathSession(editorFactory?: unknown) {
    return wiredSession({
      editorFactory, msgs: [`inspect ${TILDE} and ${ABS2} carefully please`],
      until: /logs\/hapax-run\.log/,
    });
  }
  it("fallback provider offers the '~' and '/' edge-bearing displays", async () => {
    const { addAutocompleteProvider } = await pathSession();
    const provider = (addAutocompleteProvider.mock.calls[0]![0] as (
      c: AutocompleteProvider) => AutocompleteProvider)(currentFake());
    const t = await provider.getSuggestions(["lo"], 0, 2, sig());
    expect(t?.items.map((i) => i.value)).toContain(TILDE);
    expect(t?.prefix).toBe("lo");
    const a = await provider.getSuggestions(["sr"], 0, 2, sig());
    expect(a?.items.map((i) => i.value)).toContain(ABS2);
  });
  it("widget: 'sr'/'lo' + Tab keep edges; uppercase fragment inserts verbatim", async () => {
    const ed = statefulInnerEditor();
    const w = await pathSession(ed.factory);
    const { editor, state } = composeWidget(w.setEditorComponent);
    for (const ch of ["s", "r"]) await typeChar(editor, ed.buf, ch);
    expect(state.hidden).toBe(false);
    expect(state.items.map((i) => i.display)).toContain(ABS2);
    (editor as { handleInput: (d: string) => unknown }).handleInput("\t");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(ed.buf.lines[0]).toBe(ABS2);
    expect(ed.buf.col).toBe(ABS2.length);
    (editor as unknown as { setText: (t: string) => void }).setText("");
    for (const ch of ["l", "o"]) await typeChar(editor, ed.buf, ch);
    expect(state.items.map((i) => i.display)).toContain(TILDE);
    (editor as { handleInput: (d: string) => unknown }).handleInput("\t");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(ed.buf.lines[0]).toBe(TILDE);
    (editor as unknown as { setText: (t: string) => void }).setText("");
    for (const ch of ["S", "r"]) await typeChar(editor, ed.buf, ch);
    expect(state.items.map((i) => i.display)).toContain(ABS2);
    (editor as { handleInput: (d: string) => unknown }).handleInput("\t");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(ed.buf.lines[0]).toBe(ABS2);
  });
});

// PROBE-4 — regressions around the four fixes
describe("PROBE-4: regressions around the fixes", () => {
  it("Shift-preserve for ordinary words is unregressed", async () => {
    const { addAutocompleteProvider } = await wiredSession({
      msgs: ["the Federal Reserve met quietly"], until: /federal/i,
    });
    const provider = (addAutocompleteProvider.mock.calls[0]![0] as (
      c: AutocompleteProvider) => AutocompleteProvider)(currentFake());
    const lower = await provider.getSuggestions(["feder"], 0, 5, sig());
    expect(lower?.items.map((i) => i.value)).toContain("Federal");
    const upper = await provider.getSuggestions(["Feder"], 0, 5, sig());
    expect(upper?.items.map((i) => i.value)).toContain("Federal");
  });
  it("applyCompletion delegates verbatim, exactly once, no self-query (BUG-004 seam)", async () => {
    const { addAutocompleteProvider } = await wiredSession({
      msgs: ["Alpha Beta gamma"], until: /alpha → Beta ×1 \(series\)/,
    });
    const current = currentFake();
    const provider = (addAutocompleteProvider.mock.calls[0]![0] as (
      c: AutocompleteProvider) => AutocompleteProvider)(current);
    const out = provider.applyCompletion(["Alpha Bet"], 0, 9,
      { label: "Beta", value: "Beta", description: "" }, "Bet");
    expect(current.applyCompletion).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ lines: ["Alpha Bet"], cursorLine: 0, cursorCol: 9 });
  });
  it("sticky-first pathDisplay across two edge variants of one key", async () => {
    const { addAutocompleteProvider } = await wiredSession({
      msgs: ["run ../lib/util.mjs now", "then /lib/util.mjs later"], until: /util\.mjs/,
    });
    const provider = (addAutocompleteProvider.mock.calls[0]![0] as (
      c: AutocompleteProvider) => AutocompleteProvider)(currentFake());
    const r = await provider.getSuggestions(["li"], 0, 2, sig());
    expect(r?.items.map((i) => i.value)).toContain("../lib/util.mjs");
    expect(r?.items.map((i) => i.value)).not.toContain("/lib/util.mjs");
  });
});
EOF
sed -i "s|__REPO_ROOT__|$REPO_ROOT|g" "$WORK/probe.test.ts"
if HAPAX_PROBE_ROOT="$REPO_ROOT" npx vitest --run --config "$WORK/vitest.config.ts" > /tmp/hapax-probe.log 2>&1; then
  PROBES="$(grep -E "Tests  " /tmp/hapax-probe.log | tail -1 | sed 's/^ *//')"
  ok "independent E2E probes green — ${PROBES:-summary unavailable}"
else
  bad "E2E probes FAILED"; grep -E "FAIL|Tests  |×" /tmp/hapax-probe.log | head -30
fi

# 5d. Advisory open-item checks (known-open minor findings — see
# validation_report.md). These do NOT fail the run; they clear when the
# pending reconciliation lands.
echo "  [5d] advisory open-item checks (reported, non-fatal)"
OPEN=0
if grep -q "Four runtime contracts" spec/07-completion-ui.md; then
  warn "spec drift D-4 pending: spec/07 h3.15 still 'Four' contracts (PIN's fifth bullet unapplied)"; OPEN=1
fi
if ! grep -q "pathDisplay" spec/06-candidate-store.md; then
  warn "spec drift D-2 pending: spec/06 Candidate interface lacks pathDisplay"; OPEN=1
fi
if grep -q "Trailing space with no \`@\`/\`/\` in text-before-cursor → hidden$" spec/07-completion-ui.md 2>/dev/null || grep -q "close-on-space carried over as the widget's own state)" spec/07-completion-ui.md && ! grep -q "arms a series chain" spec/07-completion-ui.md; then
  warn "spec drift D-3 pending: spec/07 visibility step 3 lacks the arming-space exception"; OPEN=1
fi
if ! grep -q "outranks the Shift-preserve" spec/04-tokenization-and-scoring.md; then
  warn "spec drift D-1 pending: spec/04 Case handling lacks verbatim-path precedence clause"; OPEN=1
fi
if grep -q "next word-start tick paints" test/index.test.ts; then
  warn "stale factory-seam timing pin: test/index.test.ts e2e (a) still describes pre-BUG-003-fix timing"; OPEN=1
fi
[ "$OPEN" -eq 0 ] && echo "  (no open advisory items)"

hr
echo "RESULT: $PASS passed, $FAIL failed (advisory open items are listed above and in validation_report.md)"
hr
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
