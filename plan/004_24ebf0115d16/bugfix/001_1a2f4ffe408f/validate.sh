#!/usr/bin/env bash
# ============================================================================
# hapax — comprehensive project validation
#
# Phases (only those configured in this repo are executed):
#   1. Linting        — none configured (no eslint/ruff config) → SKIPPED
#   2. Type checking  — npm run check (tsc --noEmit)
#   3. Style checking — none configured (no prettier/editorconfig) → SKIPPED
#   4. Unit testing   — npm test (vitest, 38 files)
#   5. E2E validation — independent harness (real modules, real dictionary,
#                       real widget/fallback compositions) + spec-agreement
#                       checks against the binding spec files
#
# Exit code: 0 only if every executed phase passes.
# ============================================================================
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export HAPAX_REPO="$REPO"
cd "$REPO"

RED=$'\033[31m'; GREEN=$'\033[32m'; YEL=$'\033[33m'; NC=$'\033[0m'
PHASE_FAILED=0
declare -a SUMMARY

note()  { printf '%s\n' "${YEL}[validate]${NC} $*"; }
pass()  { printf '%s\n' "${GREEN}[PASS]${NC} $*"; SUMMARY+=("PASS  $*"); }
fail()  { printf '%s\n' "${RED}[FAIL]${NC} $*"; SUMMARY+=("FAIL  $*"); PHASE_FAILED=1; }

# ── Phase 1: Linting ────────────────────────────────────────────────────────
if ls .eslintrc* eslint.config.* 2>/dev/null | grep -q .; then
  note "Phase 1: linting — eslint config found"
  npx eslint . && pass "Phase 1 (lint)" || fail "Phase 1 (lint)"
else
  note "Phase 1: linting — no linter configured in this repo; skipped"
  pass "Phase 1 (lint: N/A — none configured)"
fi

# ── Phase 2: Type checking ──────────────────────────────────────────────────
note "Phase 2: type checking — npm run check"
if npm run --silent check; then pass "Phase 2 (tsc --noEmit)"; else fail "Phase 2 (tsc --noEmit)"; fi

# ── Phase 3: Style checking ─────────────────────────────────────────────────
if ls .prettierrc* prettier.config.* 2>/dev/null | grep -q .; then
  note "Phase 3: style — prettier config found"
  npx prettier --check "src/**/*.ts" && pass "Phase 3 (style)" || fail "Phase 3 (style)"
else
  note "Phase 3: style — no formatter configured in this repo; skipped"
  pass "Phase 3 (style: N/A — none configured)"
fi

# ── Phase 4: Unit testing ───────────────────────────────────────────────────
note "Phase 4: unit tests — npm test (vitest)"
note "  (stderr 'error:' lines below are intentional bad-dictionary test output)"
if npm test --silent; then pass "Phase 4 (vitest unit suite)"; else fail "Phase 4 (vitest unit suite)"; fi

# ── Phase 5: E2E validation ────────────────────────────────────────────────
note "Phase 5a: independent E2E harness (real modules through the project resolver)"
WORK="$(mktemp -d /tmp/hapax-validate.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
ln -s "$REPO/node_modules" "$WORK/node_modules"
cat > "$WORK/validation.e2e.test.ts" <<'HARNESS_EOF'
/**
 * hapax independent E2E validation harness (validator-authored).
 * REAL modules end-to-end: shipped dictionary, IngestPipeline/CandidateStore,
 * query core, chain machine, widget editor factory, fallback provider.
 * Replays every PRD bug repro verbatim, adds fuzz probes and README journeys.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";

const REPO = process.env.HAPAX_REPO ?? "/home/dustin/projects/hapax";

// ── real modules ─────────────────────────────────────────────────────────────
const { tokenize } = await import(join(REPO, "src/core/segment.js"));
const { expandCandidates } = await import(join(REPO, "src/core/segment.js"));
const { CandidateStore } = await import(join(REPO, "src/core/store.js"));
const { rankMatches, matchFragment } = await import(join(REPO, "src/core/query.js"));
const { loadDictionary } = await import(join(REPO, "src/core/dictionary.js"));
const { IngestPipeline } = await import(join(REPO, "src/pi/ingest.js"));
const {
  createWidgetEditorFactory,
  widgetStateOf,
  widgetMachineOf,
} = await import(join(REPO, "src/pi/widget.js"));
const { createHapaxProvider, createChainMachine } = await import(
  join(REPO, "src/pi/provider.js")
);
const { DEFAULT_CONFIG } = await import(join(REPO, "src/pi/config.js"));
const { formatAcwordsDump } = await import(join(REPO, "src/pi/debug.js"));

const dict = loadDictionary(join(REPO, "dict/common-en.bin"));
const cfg = (over: Record<string, unknown> = {}) => ({ ...DEFAULT_CONFIG, ...over });

// ── fixtures ─────────────────────────────────────────────────────────────────

/** Real pipeline + real store + real shipped dict; bigrams wired like index.ts. */
async function seedStore(text: string, over: Record<string, unknown> = {}) {
  const store = new CandidateStore();
  const pipeline = new IngestPipeline({
    store,
    dictionary: dict,
    onAdmittedTokens: (runs) => store.recordBigramRuns(runs),
    debounceMs: 0,
    ...over,
  });
  await pipeline.processText(text, true);
  pipeline.dispose();
  return store;
}

/** Stateful fake inner editor: typing inserts, \r submits+clears. */
function makeStatefulInner(initial = "") {
  const buf = {
    lines: initial.split("\n"),
    line: 0,
    col: initial.length,
    submitted: [] as string[],
    innerCalls: [] as string[],
  };
  const editor = {
    getLines: () => buf.lines.slice(),
    getCursor: () => ({ line: buf.line, col: buf.col }),
    getText: () => buf.lines.join("\n"),
    setText(t: string) {
      buf.lines = t.split("\n");
    },
    setCursorCol(c: number) {
      buf.col = c;
    },
    render: () => buf.lines.slice(),
    isShowingAutocomplete: () => false,
    autocompletePrefix: "",
    handleInput(data: string) {
      buf.innerCalls.push(data);
      if (data === "\r") {
        buf.submitted.push(buf.lines.join("\n"));
        buf.lines = [""];
        buf.line = 0;
        buf.col = 0;
        return;
      }
      const row = buf.lines[buf.line] ?? "";
      buf.lines[buf.line] = row.slice(0, buf.col) + data + row.slice(buf.col);
      buf.col += data.length;
    },
  };
  return { editor, buf };
}

/** Compose the REAL widget factory over the fake inner. */
function composeWidget(store, chain = createChainMachine(), config = cfg()) {
  const { editor: inner, buf } = makeStatefulInner();
  const factory = createWidgetEditorFactory({
    inner: () => inner,
    store,
    config,
    chain,
    restoreReady: Promise.resolve(),
    onKeystroke: () => {},
  });
  const editor = factory({ requestRender: () => {} }, {}, undefined);
  const state = widgetStateOf(editor)!;
  const machine = widgetMachineOf(editor)!;
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  const typeChar = async (ch: string) => {
    (editor.handleInput as (d: string) => unknown)(ch);
    await flush();
    // settle past the 100ms swap debounce so display-set changes land
    await new Promise((r) => setTimeout(r, 130));
  };
  const press = (d: string) => (editor.handleInput as (d: string) => unknown)(d);
  const render = (w = 100) => (editor.render as (w: number) => string[])(w);
  return { editor, buf, state, machine, chain, typeChar, press, render, flush };
}

// deterministic RNG for fuzz reproducibility
let rngState = 0x2f6e2b1;
const rnd = () => {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  rngState >>>= 0;
  return rngState / 0x100000000;
};
const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];

// ═════════════════════════════════════════════════════════════════════════════
// A. PRD BUG-001 — M2 chained completion on the widget PRIMARY path
// ═════════════════════════════════════════════════════════════════════════════
describe("A. BUG-001: widget-path chained completion (PRD §Issue 1 repro)", () => {
  it("A0. seeds the PRD's exact bigram precondition through the REAL pipeline", async () => {
    const store = await seedStore(
      "ZorpWibble quuxblat mode. ZorpWibble quuxblat again.",
    );
    expect(store.topSuccessors("zorpwibble")).toEqual([
      { next: "quuxblat", count: 2 },
    ]);
  });

  it("A1. zorpw → Tab arms the chain → space offers the successor at ZERO typed chars → Tab inserts and re-arms", async () => {
    const store = await seedStore(
      "ZorpWibble quuxblat mode. ZorpWibble quuxblat again.",
    );
    const h = composeWidget(store);

    // 'zorpw' disambiguates from the admitted camelCase fragment 'zorp'
    for (const ch of "zorpw") await h.typeChar(ch);
    expect(h.state.hidden).toBe(false); // line live
    expect(h.machine.painted()[0]?.key).toBe("zorpwibble");

    h.buf.innerCalls.length = 0;
    h.press("\t"); // Tab accept
    expect(h.buf.lines).toEqual(["ZorpWibble"]);
    expect(h.buf.innerCalls).toEqual([]); // consumed, never forwarded
    expect(h.chain.state()).toEqual({ word: "zorpwibble" }); // ARMED (was: null)

    await h.typeChar(" "); // empty word start
    // THE M2 FEATURE: zero-typed-char successor offer ON THE WIDGET LINE
    expect(h.machine.getState().visible).toBe(true);
    // display carries the STORE's casing (seed text was lowercase here)
    expect(h.machine.getState().currentSet.map((i) => i.display)).toEqual([
      "quuxblat",
    ]);
    const rec = h.machine.painted()[0]!;
    expect(rec.description).toBe("chain");

    h.buf.innerCalls.length = 0;
    h.press("\t"); // zero-char acceptance
    expect(h.buf.lines).toEqual(["ZorpWibble quuxblat"]); // exactly one word, store casing
    expect(h.buf.innerCalls).toEqual([]);
    expect(h.chain.state()).toEqual({ word: "quuxblat" }); // re-armed
  });

  it("A2. chain offer filters live as typing continues (README: typed chars filter the successor list)", async () => {
    const store = await seedStore(
      "ZorpWibble quuxblat mode. ZorpWibble quorble again.",
    );
    const h = composeWidget(store);
    for (const ch of "zorpw") await h.typeChar(ch);
    h.press("\t");
    await h.typeChar(" ");
    expect(h.machine.getState().currentSet.length).toBeGreaterThan(0);
    await h.typeChar("q");
    await h.typeChar("u");
    // still offering (both successors share the qu- prefix)
    const displays = h.machine.getState().currentSet.map((i) => i.display);
    expect(displays.some((d) => /^qu/i.test(d))).toBe(true);
  });

  it("A3. fallback provider path still chains (regression: the fix must not break the fallback menu)", async () => {
    const store = await seedStore(
      "ZorpWibble quuxblat mode. ZorpWibble quuxblat again.",
    );
    const chain = createChainMachine();
    const current = {
      getSuggestions: async () => ({ items: [], replacePrefix: "" }),
    };
    const provider = createHapaxProvider(store, cfg(), current, chain);
    chain.arm("zorpwibble");
    const res = await provider.getSuggestions(["ZorpWibble "], 0, 11, {
      signal: new AbortController().signal,
    } as never);
    const items = (res as { items: { value: string }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.value.toLowerCase()).toBe("quuxblat");
  });

  it("A4. enableChaining=false keeps M1 word-only behavior (Tab arms NOTHING)", async () => {
    const store = await seedStore(
      "ZorpWibble quuxblat mode. ZorpWibble quuxblat again.",
    );
    const chain = createChainMachine();
    const h = composeWidget(store, chain, cfg({ enableChaining: false }));
    for (const ch of "zorpw") await h.typeChar(ch);
    h.press("\t");
    expect(h.buf.lines).toEqual(["ZorpWibble"]); // word completion intact
    expect(chain.state()).toBeNull(); // never armed
    await h.typeChar(" ");
    expect(h.machine.getState().visible).toBe(false); // no successor offer
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B. PRD BUG-002 — tokenizer overlapping spans / duplicate candidates
// ═════════════════════════════════════════════════════════════════════════════
describe("B. BUG-002: no overlapping tokens, no duplicate menu candidates", () => {
  it("B1. tokenize('FOO_1_') — one token, no overlap (PRD repro)", () => {
    const toks = tokenize("FOO_1_");
    expect(toks.length).toBe(1);
    const spans = toks.map((t) => [t.start, t.end]);
    expect(spans).toEqual([[0, 6]]); // the base token wins (defer rule)
  });

  it("B2. full ingest → store → rankMatches path offers NO prefix-duplicate pair (PRD repro)", async () => {
    const store = await seedStore("rename FOO_1_ and USER_2_TOKEN_ constants");
    const keys = store.entries().map((e) => e.key);
    expect(keys).toContain("foo_1_");
    expect(keys).toContain("user_2_token_");
    // the literal-trim duplicate must be gone
    const dupPair = keys.includes("foo_1") && keys.includes("foo_1_");
    expect(dupPair).toBe(false);
    const ranked = rankMatches(store, "foo_").map((m) => m.display);
    expect(ranked).toContain("FOO_1_");
    expect(ranked).not.toContain("FOO_1"); // no near-duplicate
  });

  it("B3. MINIMIZED residual overlap cases (validator finding V-1): literal/base straddle without containment", () => {
    // Deterministic, minimized repros of the overlap class the fuzz found.
    // Each input makes pass-4 emit a rule-4c literal AND a base token that
    // starts INSIDE the literal's span and runs past its post-trim end —
    // overlap without containment, the case the BUG-002 fix (defer-on-
    // containment) does not cover.
    const cases = ["q~z9_", "X=1ZZ_", "l~gY1p_", "foo~bar_1_"];
    for (const s of cases) {
      const toks = tokenize(s);
      let prevEnd = -1;
      const spans: string[] = [];
      for (const t of toks) {
        spans.push(`${JSON.stringify(t.raw)}[${t.start},${t.end})`);
        if (t.start < prevEnd) {
          throw new Error(
            `OVERLAP for ${JSON.stringify(s)}: ${spans.join(" ")}`,
          );
        }
        prevEnd = t.end;
      }
    }
  });

  it("B4. fuzz: 25k random adversarial inputs — spans are always sorted & disjoint", () => {
    const ALPHA =
      "abXY_19-./:#@'\"~+=| \t\r\nqwzzZZpppperghl1234";
    let checked = 0;
    for (let i = 0; i < 25_000; i++) {
      const len = 1 + Math.floor(rnd() * 24);
      let s = "";
      for (let j = 0; j < len; j++) s += pick([...ALPHA]);
      const toks = tokenize(s);
      let prevEnd = -1;
      for (const t of toks) {
        if (t.start < prevEnd) {
          throw new Error(
            `OVERLAP at iter ${i}: input ${JSON.stringify(s)} token [${t.start},${t.end}) after ${prevEnd}`,
          );
        }
        if (t.end <= t.start) {
          throw new Error(`EMPTY SPAN at iter ${i}: ${JSON.stringify(s)}`);
        }
        prevEnd = t.end;
      }
      checked++;
    }
    expect(checked).toBe(25_000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C. PRD BUG-003 — cross-message suppression leak
// ═════════════════════════════════════════════════════════════════════════════
describe("C. BUG-003: suppression releases across messages", () => {
  it("C1. Tab at col 0 → Enter submits → FIRST word of next message gets its line (PRD repro)", async () => {
    const store = await seedStore(
      "Zendesk ticket lwlock quuxblat zorpwibble",
    );
    const h = composeWidget(store);

    await h.typeChar("z");
    await h.typeChar("e");
    expect(h.machine.getState().visible).toBe(true); // Zendesk offered

    h.press("\t"); // accept at column 0 → suppression recorded
    expect(h.buf.lines).toEqual(["Zendesk"]);

    h.press("\r"); // Enter submits; fake editor clears buffer
    expect(h.buf.submitted).toEqual(["Zendesk"]);
    expect(h.buf.lines).toEqual([""]);

    // fresh message, first word at start 0 — was silently hidden (BUG-003)
    await h.typeChar("l");
    await h.typeChar("w");
    expect(h.machine.getState().visible).toBe(true);
    expect(
      h.machine.getState().currentSet.map((i) => i.display),
    ).toEqual(["lwlock"]);
  });

  it("C2. same-word continuation stays suppressed (the fix must not over-release)", async () => {
    const store = await seedStore(
      "Zendesk ticket lwlock quuxblat zorpwibble",
    );
    const h = composeWidget(store);
    await h.typeChar("z");
    await h.typeChar("e");
    expect(h.machine.getState().visible).toBe(true);
    h.press("\x1b"); // Escape: explicit dismissal, same word suppressed
    expect(h.machine.getState().visible).toBe(false);
    await h.typeChar("p"); // EXTENDING the dismissed word
    expect(h.machine.getState().visible).toBe(false); // still suppressed
    await h.typeChar(" ");
    await h.typeChar("l"); // next word start → released
    await h.typeChar("w");
    expect(h.machine.getState().visible).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// D. PRD BUG-004 — 64KB chunk-boundary token shredding
// ═════════════════════════════════════════════════════════════════════════════
describe("D. BUG-004: tokens survive chunk seams whole", () => {
  it("D1a. PRD construction, SEPARATED at true 64KB scale: straddled word lands whole, no junk half, bigram spans the seam", async () => {
    // a word starting exactly at the slice edge, boundary inside it
    const big =
      "a".repeat(65531) + " Zorpwibble quuxblat " + "b".repeat(70000);
    const store = await seedStore(big);
    expect(store.get("zorpwibble")).toBeDefined();
    expect(store.get("ibble")).toBeUndefined();
    expect(store.get("zorpw")).toBeUndefined();
    expect(store.get("quuxblat")).toBeDefined();
    expect(store.topSuccessors("zorpwibble")).toEqual([
      { next: "quuxblat", count: 1 },
    ]);
  }, 30_000);

  it("D1b. PRD's exact GLUED construction: the junk-half defect symptom is gone; result consistent with unchunked semantics", async () => {
    // 'a'.repeat(65531) + 'Zorpwibble' glues into ONE >96-char run; even
    // UNCHUNKED, clean 'zorpwibble' is not extractable (run-cap shred).
    // The BUG-004 defect symptoms were: junk 'ibble' half admitted + the
    // word's tail lost. Post-fix: no junk half, no shredded fragments.
    const big =
      "a".repeat(65536 - 5) + "Zorpwibble quuxblat " + "b".repeat(70000);
    const store = await seedStore(big);
    const junk = store
      .entries()
      .map((e) => e.key)
      .filter((k) => /ibble$/.test(k) && k !== "zorpwibble");
    expect(junk).toEqual([]); // no severed halves
    expect(store.get("quuxblat")).toBeDefined(); // post-seam word intact
  }, 30_000);

  it("D2. boundary on space / comma / newline: each word counted exactly once", async () => {
    // tiny-chunk analogue: force a seam at a known spot with chunkBytes
    const mk = async (text: string) => {
      const store = new CandidateStore();
      const pipeline = new IngestPipeline({
        store,
        dictionary: dict,
        onAdmittedTokens: (runs) => store.recordBigramRuns(runs),
        debounceMs: 0,
        chunkBytes: 32,
      });
      await pipeline.processText(text, true);
      pipeline.dispose();
      return store;
    };
    const s1 = await mk("zorpwibble quuxblat noria"); // seam mid-text
    expect(s1.get("zorpwibble")?.sessionCount).toBe(1); // counted exactly once
    const s2 = await mk("zorpwibble,quuxblat,noria");
    const keys = [...s2.entries().map((e) => e.key)];
    expect(keys).toContain("zorpwibble");
    expect(keys).toContain("quuxblat");
    const s3 = await mk("zorpwibble\nquuxblat");
    expect([...s3.entries().map((e) => e.key)]).toContain("zorpwibble");
  });

  it("D3. fuzz: 300 random texts at chunkBytes=13 — every intended word lands whole, no junk fragments", async () => {
    const WORDS = ["zorpwibble", "quuxblat", "noria", "inverter", "lwlock", "zendesk"];
    for (let i = 0; i < 300; i++) {
      const n = 2 + Math.floor(rnd() * 6);
      const words: string[] = [];
      for (let j = 0; j < n; j++) words.push(pick(WORDS));
      const sep = pick([" ", ", ", "\n", "  ", " "]);
      const text = words.join(sep);
      const store = await seedStore(text, { chunkBytes: 13 });
      const keys = new Set(store.entries().map((e) => e.key));
      for (const w of words) {
        if (!keys.has(w)) {
          throw new Error(
            `chunk fuzz iter ${i}: word ${w} missing from store (text=${JSON.stringify(text)})`,
          );
        }
      }
      // no junk: every stored key is one of the intended words
      for (const k of keys) {
        if (!WORDS.includes(k)) {
          throw new Error(
            `chunk fuzz iter ${i}: junk key ${JSON.stringify(k)} from text ${JSON.stringify(text)}`,
          );
        }
      }
    }
  }, 120_000);
});

// ═════════════════════════════════════════════════════════════════════════════
// E. README user journeys (end-to-end through the composed widget)
// ═════════════════════════════════════════════════════════════════════════════
describe("E. README user journeys", () => {
  it("E1. 'type ze → offers Zendesk → Tab inserts Zendesk (cased)'", async () => {
    const store = await seedStore("Zendesk integration quuxblat");
    const h = composeWidget(store);
    await h.typeChar("z");
    await h.typeChar("e");
    expect(
      h.machine.getState().currentSet.map((i) => i.display),
    ).toEqual(["Zendesk"]);
    h.press("\t");
    expect(h.buf.lines).toEqual(["Zendesk"]);
  });

  it("E2. 'type #l → offers lwlock → Tab inserts it' (trigger mode)", async () => {
    const store = await seedStore("lwlock quuxblat zorpwibble");
    const h = composeWidget(store);
    await h.typeChar("#");
    await h.typeChar("l");
    expect(h.machine.getState().visible).toBe(true);
    // lwlock ranks TOP (anchored exact-prefix beats loose-mode cousins)
    expect(h.machine.getState().currentSet[0]!.display).toBe("lwlock");
    h.press("\t");
    expect(h.buf.lines).toEqual(["lwlock"]); // trigger+fragment span replaced (stock parity)
  });

  it("E3. chain walk: accept → successor top at zero chars → Tab → next successor (README journey, admitting words)", async () => {
    const store = await seedStore("Noria Inverter quuxblat Zorpwibble done");
    const h = composeWidget(store);
    for (const ch of "nor") await h.typeChar(ch);
    expect(h.machine.painted()[0]?.key).toBe("noria");
    h.press("\t");
    expect(h.buf.lines).toEqual(["Noria"]);
    await h.typeChar(" ");
    expect(h.machine.getState().currentSet.map((i) => i.display)).toEqual([
      "Inverter",
    ]);
    h.press("\t");
    expect(h.buf.lines).toEqual(["Noria Inverter"]);
    await h.typeChar(" ");
    expect(h.machine.getState().currentSet.map((i) => i.display)).toEqual([
      "quuxblat",
    ]);
    h.press("\t");
    expect(h.buf.lines).toEqual(["Noria Inverter quuxblat"]);
    await h.typeChar(" ");
    expect(h.machine.getState().currentSet.map((i) => i.display)).toEqual([
      "Zorpwibble",
    ]);
    h.press("\t");
    expect(h.buf.lines).toEqual(["Noria Inverter quuxblat Zorpwibble"]);
  });

  it("E4. Enter always submits (forwarded verbatim to the inner editor)", async () => {
    const store = await seedStore("Zendesk lwlock");
    const h = composeWidget(store);
    await h.typeChar("z");
    await h.typeChar("e");
    expect(h.machine.getState().visible).toBe(true);
    h.buf.innerCalls.length = 0;
    h.press("\r");
    expect(h.buf.innerCalls).toContain("\r"); // forwarded, not swallowed
    expect(h.buf.submitted).toEqual(["ze"]); // the inner submitted
  });

  it("E5. ordinary prose typing never captures keys (never-hijack)", async () => {
    const store = await seedStore("zorpwibble quuxblat");
    const h = composeWidget(store);
    for (const ch of "the quick brown fox") await h.typeChar(ch);
    // every printable char reached the inner editor verbatim
    expect(h.buf.lines.join("")).toContain("the quick brown fox");
  });

  it("E6. /acwords dump format contains every stored word", async () => {
    const store = await seedStore("zorpwibble quuxblat noria");
    const dump = formatAcwordsDump(store, { wordsSeen: 5, admitted: 3, rejectedByGate: {} } as never);
    expect(dump).toContain("zorpwibble");
    expect(dump).toContain("quuxblat");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// F. independent core invariants (fresh-eyes fuzz)
// ═════════════════════════════════════════════════════════════════════════════
describe("F. query-core invariants under fuzz", () => {
  it("F1. rankMatches: deterministic order (tier>count>len>lex), no dup keys, anchor rule", () => {
    const store = new CandidateStore();
    const words = ["zendesk", "zorpwibble", "quuxblat", "lwlock", "noria",
      "inverter", "zephyrlock", "quuxen", "norial", "lwlocked", "zorpwibbler"];
    for (const w of words) {
      for (const d of expandCandidates({ raw: w, hexish: false, start: 0, end: w.length, sentenceStart: false })) {
        store.upsert({
          key: d.key,
          display: d.display,
          ordinal: store.currentOrdinal(),
          fromUser: false,
          properName: d.properName ?? false,
          rankGroup: 1,
          isSubword: d.isSubword ?? false,
        });
      }
    }
    for (let i = 0; i < 5_000; i++) {
      const frag = pick(["z", "qu", "lw", "nor", "inv", "zep", "zo", "q", "l"]);
      const out = rankMatches(store, frag);
      const keys = out.map((m) => m.key);
      expect(new Set(keys).size).toBe(keys.length); // no dup keys
      for (const m of out) {
        // anchor: match starts at char 0 of the candidate
        expect(m.key[0]).toBe(frag[0]);
      }
    }
  });

  it("F2. matchFragment anchor invariant: esk never matches zendesk", () => {
    expect(matchFragment("esk", "zendesk")).toBeNull();
    expect(matchFragment("roun", "Rounding")).not.toBeNull();
  });

  it("F3. store upsert/eviction smoke: userTyped survives a mass insert", () => {
    const store = new CandidateStore();
    const sight = (key: string, fromUser = false) => ({
      key,
      display: key,
      ordinal: store.currentOrdinal(),
      fromUser,
      properName: false,
      rankGroup: 1 as const,
      isSubword: false,
    });
    store.upsert(sight("usertypeword", true));
    for (let i = 0; i < 21_000; i++) store.upsert(sight(`fuzzword${i}`));
    expect(store.get("usertypeword")).toBeDefined();
  });
});
HARNESS_EOF

E2E_PASSED=0
if "$REPO/node_modules/.bin/vitest" --root "$WORK" --run validation.e2e.test.ts >"$WORK/e2e.log" 2>&1; then
  pass "Phase 5a (E2E harness: 24 tests — A0–F3)"
  grep -E "Test Files|Tests " "$WORK/e2e.log" | sed 's/^/  /'
else
  fail "Phase 5a (E2E harness) — failures below (known: V-1 residual overlap, B3/B4)"
  grep -E "Test Files|Tests |AssertionError|Error: OVERLAP|FAIL " "$WORK/e2e.log" | sed 's/^/  /' | head -20
fi
note "  E2E harness failures B3/B4 are the recorded validator finding V-1"
note "  (residual tokenizer overlap class; see validation_report.md)."

note "Phase 5b: spec-agreement checks (AGENTS.md binding policy)"
# 5b-1: spec/07 must document chain offers on the widget line (BUG-001 spec sync)
if grep -q "Chain offers render on the widget line" "$REPO/spec/07-completion-ui.md"; then
  pass "5b-1: spec/07 documents widget-line chain offers"
else
  fail "5b-1: spec/07 missing widget-line chain clause (BUG-001 spec sync)"
fi
# 5b-2: spec/04 must contain the amended R_eff(9) boundary (q<=82 admits)
if grep -q "admits q≤82" "$REPO/spec/04-tokenization-and-scoring.md"; then
  pass "5b-2: spec/04 9-char boundary corrected (q≤82 admits)"
else
  fail "5b-2: spec/04 9-char boundary text missing amendment"
fi
# 5b-3: spec/05 must document the chunk-seam token carry (BUG-004 spec sync)
if grep -q "carry" "$REPO/spec/05-ingestion-pipeline.md"; then
  pass "5b-3: spec/05 documents chunk-seam carry"
else
  fail "5b-3: spec/05 missing chunk-carry clause"
fi
# 5b-4: spec/09 must NOT still claim q=82 rejects at 9 chars (drift twin)
if grep -q "q=82 rejects" "$REPO/spec/09-testing-and-acceptance.md"; then
  fail "5b-4: spec/09 still says 'q=82 rejects at 9 chars' — contradicts amended spec/04 and test/score.test.ts (validator finding V-2)"
else
  pass "5b-4: spec/09 score boundary consistent with spec/04"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo
note "═══════════════ VALIDATION SUMMARY ═══════════════"
for s in "${SUMMARY[@]}"; do echo "  $s"; done
echo
if [ "$PHASE_FAILED" -eq 0 ]; then
  printf '%s\n' "${GREEN}VALIDATION PASSED${NC}"
  exit 0
else
  printf '%s\n' "${RED}VALIDATION FAILED — see validation_report.md${NC}"
  exit 1
fi
