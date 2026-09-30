/**
 * Widget visibility machine suite (spec §07 h3.10, plan 003
 * P1.M3.T2.S1) — the per-keystroke show/hide/suppress decision core:
 * stock-context hiding (R1), candidate open + flicker hysteresis with
 * the 100 ms swap debounce (R2/R6/R2b), trailing-space close (R3),
 * cursor-move close + 200 ms fresh-reopen (R4/R7), the restoreReady
 * startup gate bounded at 500 ms (R2/R5), explicit-dismissal
 * suppression vs disqualification (R4), and the menuDelayMs hesitation
 * gate with intent bypass (R5).
 *
 * The machine is driven through a fake editor stream (mutable
 * lines/col) with a stubbed query — no store, no pi — under fake
 * timers (setTimeout + Date, so both the swap timer and the gap math
 * advance together). The timing stack is the widget-path RE-HOME of
 * the fallback display provider's (provider.ts createDisplayProvider —
 * untouched); these tests pin the re-homed semantics.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CandidateStore } from "../src/core/store.js";
import type { RankedMatch, Sighting } from "../src/core/types.js";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { HapaxConfig } from "../src/pi/config.js";
import {
  createVisibilityMachine,
  type VisibilityMachine,
  type VisibilityMachineDeps,
} from "../src/pi/widget.js";

// ── fixtures ────────────────────────────────────────────────────────────────

const cfg = (over: Partial<HapaxConfig> = {}): HapaxConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

const rm = (display: string): RankedMatch => ({
  key: display.toLowerCase(),
  display,
  description: "session ×1",
  salience: 1,
  sessionCount: 1,
});

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

/** Mutable single-line editor stream: tests set text+cursor, then tick. */
function fakeEditor() {
  return {
    lines: [""] as string[],
    line: 0,
    col: 0,
    set(text: string, col: number): void {
      this.lines = [text];
      this.line = 0;
      this.col = col;
    },
  };
}

/** A machine over a fake editor with a canned per-fragment query.
 *  Async: flushes the constructor's settle microtask before returning —
 *  a resolved restoreReady must be OBSERVED as settled before the first
 *  tick (the same pass-through the fallback's createStartupGate gets
 *  from its first await; a pending promise is unaffected by the flush). */
async function build(
  over: {
    config?: Partial<HapaxConfig>;
    query?: (fragment: string, mode: "trigger" | "ambient") => RankedMatch[];
    store?: CandidateStore;
    restoreReady?: Promise<void>;
  } = {},
): Promise<{ machine: VisibilityMachine; editor: ReturnType<typeof fakeEditor> }> {
  const editor = fakeEditor();
  const deps: VisibilityMachineDeps = {
    store: over.store ?? ({} as never), // never hit — query is always stubbed (unless a store is injected for default-closure tests)
    config: cfg(over.config),
    getEditorState: () => ({
      lines: editor.lines,
      line: editor.line,
      col: editor.col,
    }),
    restoreReady: over.restoreReady ?? Promise.resolve(),
    ...(over.query ? { query: over.query } : {}),
  };
  const machine = createVisibilityMachine(deps);
  await vi.advanceTimersByTimeAsync(0);
  return { machine, editor };
}

const canned = (map: Record<string, RankedMatch[]>) => vi.fn((f: string) => map[f] ?? []);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

// ── R1 — stock contexts ─────────────────────────────────────────────────────

describe("visibility machine — spec §07 h3.10", () => {
  it("R1: stock contexts (slash/mention/quoted-path/path) never show the line", async () => {
    const { machine, editor } = await build({ query: () => [rm("Zendesk")] });
    const cases: [string, number][] = [
      ["/acw", 4], // line-0 slash command
      ["hello @zen", 11], // @-mention
      ['say "src/ro', 11], // unclosed quote → quoted-path
      ["src/roun", 8], // unquoted path
    ];
    for (const [text, col] of cases) {
      editor.set(text, col);
      const st = machine.onInput();
      expect(st.visible, text).toBe(false);
      expect(st.currentSet, text).toEqual([]);
    }
    // Stock contexts are NOT dismissal — no suppression is ever set.
    expect(machine.getState().suppressUntilWordStart).toBe(false);
  });

  // ── R2/R6 — open + flicker hysteresis + swap debounce ─────────────────────

  it("R2: fragment with candidates opens; narrowing inside the window never closes (old set held, swap at +100 ms)", async () => {
    const { machine, editor } = await build({
      query: canned({
        zend: [rm("Zendesk")],
        zendk: [rm("Zendesk"), rm("Zendkrypto")],
      }),
    });
    editor.set("zend", 4);
    expect(machine.onInput()).toMatchObject({ visible: true });
    expect(machine.getState().currentSet).toEqual([{ display: "Zendesk" }]);

    await vi.advanceTimersByTime(1); // narrowing keystroke 1 ms later
    editor.set("zendk", 5);
    const st = machine.onInput();
    // Flicker hysteresis: visible the WHOLE time — no close+reopen —
    // with the OLD set still on screen inside the suppression window.
    expect(st.visible).toBe(true);
    expect(st.currentSet).toEqual([{ display: "Zendesk" }]);

    await vi.advanceTimersByTime(100); // the parked swap promotes
    expect(machine.getState().visible).toBe(true);
    expect(machine.getState().currentSet).toEqual([
      { display: "Zendesk" },
      { display: "Zendkrypto" },
    ]);
  });

  it("R2b: rapid set changes supersede — exactly one swap, the NEWEST set paints", async () => {
    const { machine, editor } = await build({
      query: canned({
        ze: [rm("Zendesk")],
        zen: [rm("Zendesk"), rm("Zend formed")],
        zend: [rm("Zendesk"), rm("Zend formed"), rm("Zendkrypto")],
      }),
    });
    editor.set("ze", 2);
    machine.onInput(); // paint [Zendesk]
    await vi.advanceTimersByTime(1);
    editor.set("zen", 3);
    machine.onInput(); // park swap → [Zendesk, Zend formed]
    await vi.advanceTimersByTime(1);
    editor.set("zend", 4);
    machine.onInput(); // SUPERSEDE → [Zendesk, Zend formed, Zendkrypto]
    expect(machine.getState().currentSet).toEqual([{ display: "Zendesk" }]);

    await vi.advanceTimersByTime(100);
    // Only the newest parked set ever paints — the middle one is gone.
    expect(machine.getState().currentSet).toEqual([
      { display: "Zendesk" },
      { display: "Zend formed" },
      { display: "Zendkrypto" },
    ]);
  });

  it("R6: a set change after the window paints immediately (no pending swap)", async () => {
    const { machine, editor } = await build({
      query: canned({ ze: [rm("Zendesk")], zephyr: [rm("Zephyr")] }),
    });
    editor.set("ze", 2);
    machine.onInput();
    await vi.advanceTimersByTime(150); // window long elapsed
    editor.set("zephyr", 6);
    expect(machine.onInput().currentSet).toEqual([{ display: "Zephyr" }]);
  });

  // ── R3 — trailing space close ───────────────────────────────────────────────

  it("R3: trailing space (no @//) closes without suppressing", async () => {
    const { machine, editor } = await build({ query: () => [rm("Zendesk")] });
    editor.set("zend", 4);
    machine.onInput();
    expect(machine.getState().visible).toBe(true);

    editor.set("zend ", 5); // space — fragment gone
    const st = machine.onInput();
    expect(st.visible).toBe(false);
    expect(st.currentSet).toEqual([]);
    // A space close is NOT a dismissal — suppression must not engage.
    expect(st.suppressUntilWordStart).toBe(false);
  });

  it("R3b: trailing space after '@' still hides (never the space-close path — and never suppresses)", async () => {
    const { machine, editor } = await build({ query: () => [rm("Zendesk")] });
    editor.set("@zen ", 5);
    const st = machine.onInput();
    expect(st.visible).toBe(false);
    expect(st.suppressUntilWordStart).toBe(false);
  });

  // ── R4/R7 — cursor-move close + fresh reopen ─────────────────────────────

  it("R4: cursor move with unchanged text hides (no suppression); a qualifying keystroke reopens FRESH", async () => {
    const query = canned({ zend: [rm("Zendesk")], zende: [rm("Zendesk"), rm("Zend formed")] });
    const { machine, editor } = await build({ query });
    editor.set("zend", 4);
    machine.onInput();
    expect(machine.getState().visible).toBe(true);

    editor.set("zend", 2); // cursor jumped back — text identical
    const st = machine.onInput();
    expect(st.visible).toBe(false);
    expect(st.suppressUntilWordStart).toBe(false);

    // Fresh reopen: the set is the NEW query's, never the pre-close one.
    editor.set("zende", 5);
    const reopened = machine.onInput();
    expect(reopened.visible).toBe(true);
    expect(reopened.currentSet).toEqual([{ display: "Zendesk" }, { display: "Zend formed" }]);
  });

  // ── R2/R5 — startup gate ────────────────────────────────────────────────────

  it("R5: a pending restoreReady holds the first qualifying query; the 500 ms bound releases it", async () => {
    const { promise } = deferred(); // never settles in this test
    const { machine, editor } = await build({
      restoreReady: promise,
      query: () => [rm("Zendesk")],
    });
    editor.set("zend", 4);
    expect(machine.onInput().visible).toBe(false); // held — replay racing

    await vi.advanceTimersByTimeAsync(499);
    editor.set("zende", 5); // still inside the bound
    expect(machine.onInput().visible).toBe(false);

    await vi.advanceTimersByTimeAsync(1); // bound elapses → wake repaints
    expect(machine.getState().visible).toBe(true);
    expect(machine.getState().currentSet).toEqual([{ display: "Zendesk" }]);
  });

  it("R5: restoreReady settling releases the held query before the bound", async () => {
    const { promise, resolve } = deferred();
    const { machine, editor } = await build({
      restoreReady: promise,
      query: () => [rm("Zendesk")],
    });
    editor.set("zend", 4);
    expect(machine.onInput().visible).toBe(false);

    resolve();
    await vi.advanceTimersByTimeAsync(0); // flush the settle microtask
    expect(machine.getState().visible).toBe(true);
  });

  it("R5: a settled restoreReady is a pass-through (fresh session paints immediately)", async () => {
    const { machine, editor } = await build({ query: () => [rm("Zendesk")] });
    editor.set("zend", 4);
    expect(machine.onInput().visible).toBe(true);
  });

  // ── R4 — suppression vs disqualification ─────────────────────────────────

  it("suppression: onDismissed(true) hides; extending the SAME word stays hidden; a new word reopens", async () => {
    const { machine, editor } = await build({
      query: canned({ zend: [rm("Zendesk")], zendeskl: [rm("Zendesk")], lumen: [rm("Lumen")] }),
    });
    editor.set("zend", 4);
    machine.onInput();
    expect(machine.getState().visible).toBe(true);

    machine.onDismissed(true); // Escape / boundary-Esc
    expect(machine.getState()).toMatchObject({
      visible: false,
      suppressUntilWordStart: true,
    });

    // Extending the SAME word: fragment start (0) == dismissed start → stays hidden.
    await vi.advanceTimersByTime(10);
    editor.set("zendeskl", 8);
    expect(machine.onInput()).toMatchObject({ visible: false, suppressUntilWordStart: true });

    // A NEW word after a space: different word start → released.
    await vi.advanceTimersByTime(10);
    editor.set("zendesk lumen", 13);
    const st = machine.onInput();
    expect(st.visible).toBe(true);
    expect(st.suppressUntilWordStart).toBe(false);
    expect(st.currentSet).toEqual([{ display: "Lumen" }]);
  });

  it("suppression: a trigger char reopens despite suppression", async () => {
    const { machine, editor } = await build({
      config: { triggerChar: "#" },
      query: canned({ ze: [rm("Zendesk")] }),
    });
    editor.set("zend", 4);
    machine.onInput();
    machine.onDismissed(true);
    expect(machine.getState().suppressUntilWordStart).toBe(true);

    editor.set("#ze", 3); // trigger mode — explicit intent
    const st = machine.onInput();
    expect(st.visible).toBe(true);
    expect(st.suppressUntilWordStart).toBe(false);
    expect(st.currentSet).toEqual([{ display: "Zendesk" }]);
  });

  it("disqualification (zero candidates) hides WITHOUT suppressing — the next qualifying keystroke reopens", async () => {
    const { machine, editor } = await build({
      query: canned({ zend: [rm("Zendesk")], zenx: [], zende: [rm("Zendesk")] }),
    });
    editor.set("zend", 4);
    machine.onInput();
    expect(machine.getState().visible).toBe(true);

    await vi.advanceTimersByTime(10);
    editor.set("zenx", 4); // narrow out of the candidate set
    const st = machine.onInput();
    expect(st.visible).toBe(false);
    expect(st.suppressUntilWordStart).toBe(false); // never a dismissal

    await vi.advanceTimersByTime(10);
    editor.set("zende", 5);
    expect(machine.onInput()).toMatchObject({ visible: true }); // immediate reopen
  });

  it("invariant: zero candidates are never visible, even at a word start with no suppression", async () => {
    const { machine, editor } = await build({ query: () => [] });
    editor.set("zzqq", 4);
    expect(machine.onInput()).toMatchObject({ visible: false, currentSet: [] });
  });

  // ── R5 — hesitation gate (menuDelayMs carry-over) ─────────────────────────

  it("hesitation: menuDelayMs holds a word-mode first paint on a fast gap — and EVERY tick feeds the gap math", async () => {
    const { machine, editor } = await build({
      config: { menuDelayMs: 200 },
      query: canned({ zend: [rm("Zendesk")], zephyr: [rm("Zephyr")], zephyrx: [rm("Zephyr")] }),
    });
    // t=0: first-ever tick — no previous keystroke → nothing to measure → paints.
    editor.set("zend", 4);
    machine.onInput();
    expect(machine.getState().visible).toBe(true);

    // t=500: space close.
    await vi.advanceTimersByTime(500);
    editor.set("zend ", 5);
    machine.onInput();

    // t=1000: a STOCK tick — hidden, stamps no close, but its timestamp
    // still feeds the input clock (rule 0: EVERY tick counts for the
    // gap math, even hide/delegate ticks).
    await vi.advanceTimersByTime(500);
    editor.set("/x", 2);
    machine.onInput();

    // t=1050: qualifying fragment after a 50 ms gap → HELD (gap < 200;
    // last close was 550 ms ago → no fresh-reopen bypass).
    await vi.advanceTimersByTime(50);
    editor.set("zephyr", 6);
    expect(machine.onInput()).toMatchObject({ visible: false });

    // t=1350: the next keystroke's gap (300 ms) clears the gate → paints.
    await vi.advanceTimersByTime(300);
    editor.set("zephyrx", 7);
    expect(machine.onInput()).toMatchObject({ visible: true });
  });

  it("hesitation: trigger mode bypasses the gate (explicit intent paints immediately)", async () => {
    const { machine, editor } = await build({
      config: { menuDelayMs: 200, triggerChar: "#" },
      query: canned({ ze: [rm("Zendesk")] }),
    });
    editor.set("zend", 4);
    machine.onInput();
    await vi.advanceTimersByTime(500);
    editor.set("/x", 2);
    machine.onInput(); // stock tick — resets the gap clock
    await vi.advanceTimersByTime(10); // fast gap — word mode would hold
    editor.set("#ze", 3);
    const st = machine.onInput();
    expect(st.visible).toBe(true);
    expect(st.currentSet).toEqual([{ display: "Zendesk" }]);
  });

  it("hesitation: menuDelayMs=0 (default) paints immediately regardless of gap", async () => {
    const { machine, editor } = await build({ query: canned({ ze: [rm("Zendesk")] }) });
    editor.set("ze", 2);
    expect(machine.onInput().visible).toBe(true);
    await vi.advanceTimersByTime(500);
    editor.set("/x", 2);
    machine.onInput(); // stock tick — resets the gap clock
    await vi.advanceTimersByTime(0); // ZERO-ms gap — word mode would hold
    editor.set("ze", 2);
    expect(machine.onInput().visible).toBe(true); // 0 = OFF → immediate
  });

  it("hesitation: a fresh close (<200 ms) reopens through the gate — active editing resumes the menu", async () => {
    const { machine, editor } = await build({
      config: { menuDelayMs: 200 },
      query: canned({ zend: [rm("Zendesk")], zenx: [], zende: [rm("Zendesk")] }),
    });
    editor.set("zend", 4);
    machine.onInput(); // t=0 paint
    await vi.advanceTimersByTime(10);
    editor.set("zenx", 4);
    machine.onInput(); // t=10 disqualification close
    await vi.advanceTimersByTime(10);
    editor.set("zende", 5); // t=20 qualifying again — gap 10 ms, close 10 ms ago
    // Both the fresh-reopen window AND the fast gap apply: the reopen
    // window wins (active editing) → immediate paint, no 200 ms hold.
    expect(machine.onInput()).toMatchObject({ visible: true });
  });
});

// ── plan 004 — query seam mode threading ────────────────────────────────────
describe("visibility machine — query seam receives (fragment, mode) (plan 004)", () => {
  it("trigger keystrokes drive trigger-mode queries; word typing drives ambient", async () => {
    const query = vi.fn((f: string, _mode: "trigger" | "ambient"): RankedMatch[] =>
      f === "cfg" ? [rm("config")] : f === "query" ? [rm("src/core/query.ts")] : [],
    );
    const { machine, editor } = await build({ query });

    editor.set("#cfg", 4);
    machine.onInput();
    expect(query).toHaveBeenLastCalledWith("cfg", "trigger");

    editor.set("cfg", 3);
    machine.onInput();
    expect(query).toHaveBeenLastCalledWith("cfg", "ambient");

    editor.set("#query", 6);
    machine.onInput();
    expect(query).toHaveBeenLastCalledWith("query", "trigger");
  });

  it("default query closure resolves per mode: trigger is loose (tier-0 visible), ambient is not", async () => {
    // REAL store + the DEFAULT closure (no query stub): 'query' anchors
    // "queryplan" (tier 3); the rule-4d path key is reachable only via the
    // loose tier-0 pass — visible under the trigger tick, never ambient.
    const sighting = (key: string, display = key): Sighting => ({
      key,
      display,
      ordinal: 1,
      fromUser: false,
      properName: false,
      rankGroup: 2,
      isSubword: false,
    });
    const store = new CandidateStore();
    store.upsert(sighting("queryplan"));
    store.upsert(sighting("src/core/query.ts"));

    const { machine, editor } = await build({ store });

    editor.set("query", 5);
    const ambient = machine.onInput();
    expect(ambient.currentSet.map((i) => i.display)).toEqual(["queryplan"]);

    // Past the 100 ms swap window: the trigger tick's DIFFERENT set paints
    // immediately instead of being parked as a pending swap.
    await vi.advanceTimersByTimeAsync(100);

    editor.set("#query", 6);
    const trigger = machine.onInput();
    expect(trigger.currentSet.map((i) => i.display)).toEqual([
      "queryplan",
      "src/core/query.ts",
    ]);
  });
});
