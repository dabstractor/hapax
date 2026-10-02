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
import type { ChainMachine } from "../src/pi/provider.js";
import { createChainGrantTracker, type ChainGrantTracker } from "../src/pi/chain-grant.js";
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
    grant?: ChainGrantTracker;
    restoreReady?: Promise<void>;
    chain?: ChainMachine;
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
    ...(over.chain ? { chain: over.chain } : {}),
    ...(over.grant ? { grant: over.grant } : {}),
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

// ── painted() — the arming classification seam (BUG-001, plan 004) ──────────

/** rm() with a tier — match-path records carry the public diagnostic
 *  (plan 004's omit-contract: listings omit, matches populate). */
const rmt = (display: string, tier: 0 | 1 | 2 | 3): RankedMatch => ({
  ...rm(display),
  tier,
});

describe("visibility machine — painted() accessor (BUG-001 arming seam)", () => {
  it("painted() mirrors currentSet 1:1 after a paint (length + order)", async () => {
    const { machine, editor } = await build({
      query: () => [rmt("Zendesk", 3), rmt("Zendkrypto", 2)],
    });
    editor.set("zend", 4);
    machine.onInput();
    const st = machine.getState();
    const painted = machine.painted();
    expect(painted.length).toBe(st.currentSet.length);
    for (let i = 0; i < painted.length; i++) {
      expect(painted[i]!.display).toBe(st.currentSet[i]!.display);
    }
    expect(painted.map((m) => m.key)).toEqual(["zendesk", "zendkrypto"]);
  });

  it("painted() carries key and tier — the arming prerequisites (incl. the tier-0 never-arm signal)", async () => {
    const { machine, editor } = await build({
      query: canned({
        zend: [rmt("Zendesk", 3)],
        unb: [rmt("unbundler", 0)], // anchorless ambient record
      }),
    });
    editor.set("zend", 4);
    machine.onInput();
    let [m] = machine.painted();
    expect(m!.key).toBe("zendesk");
    expect(m!.tier).toBe(3);
    await vi.advanceTimersByTime(150); // past the swap window → immediate paint
    editor.set("unb", 3);
    machine.onInput();
    [m] = machine.painted();
    expect(m!.key).toBe("unbundler");
    expect(m!.tier).toBe(0); // S2 reads tier === 0 → never arm
  });

  it("painted() is empty whenever the line is hidden (lifetime parity with currentSet)", async () => {
    const { machine, editor } = await build({
      query: () => [rmt("Zendesk", 3)],
    });
    editor.set("zend", 4);
    machine.onInput();
    expect(machine.painted()).toHaveLength(1);
    // Stock-context hide (R1) clears BOTH — stock hides stamp no close,
    // so the following paint re-arms the seam without reopen ceremony.
    editor.set("/cmd", 4);
    machine.onInput();
    expect(machine.painted()).toEqual([]);
    expect(machine.getState().currentSet).toEqual([]);
    // Paint again, then explicit dismissal (Escape) clears BOTH too.
    editor.set("zend", 4);
    machine.onInput();
    expect(machine.painted()).toHaveLength(1);
    machine.onDismissed(true);
    expect(machine.painted()).toEqual([]);
    expect(machine.getState().currentSet).toEqual([]);
  });

  it("swap-debounce promotion updates painted() too — paint is the single write site", async () => {
    const { machine, editor } = await build({
      query: canned({
        zend: [rmt("Zendesk", 3)],
        zendk: [rmt("Zendesk", 3), rmt("Zendkrypto", 2)],
      }),
    });
    editor.set("zend", 4);
    machine.onInput();
    expect(machine.painted().map((m) => m.key)).toEqual(["zendesk"]);
    await vi.advanceTimersByTime(1); // narrowing keystroke inside the window
    editor.set("zendk", 5);
    machine.onInput(); // old set held, swap parked — painted() unchanged
    expect(machine.painted().map((m) => m.key)).toEqual(["zendesk"]);
    await vi.advanceTimersByTime(100); // the parked swap promotes THROUGH paint()
    expect(machine.painted().map((m) => m.key)).toEqual([
      "zendesk",
      "zendkrypto",
    ]);
    expect(machine.painted()[1]!.tier).toBe(2);
  });
});

// ── armed chain consult (BUG-001 fix, P1.M1.T2.S1) ─────────────────────────

describe("visibility machine — armed chain consult (BUG-001 fix)", () => {
  /** Recording ChainMachine double — starts IDLE so build()'s settle-
   *  wake evaluate (which runs against the empty editor) never consults
   *  the branch; call armNow() to arm before the ticks under test
   *  (arming itself is T1.S1/S2's, pinned elsewhere). reset calls are
   *  the assertion surface for the disqualification paths. */
  const armedChain = (
    word: string,
  ): {
    chain: ChainMachine;
    grant: ChainGrantTracker;
    armNow: () => void;
    reset: ReturnType<typeof vi.fn>;
  } => {
    const chain = {
      state: vi.fn((): { word: string } | null => null),
      arm: vi.fn(),
      // FAITHFUL double (plan 004 T2.S2): a real ChainMachine goes idle on
      // reset — the armed branch (and with it the grant tracker) is then
      // never consulted again until the next arm. A state() that stayed
      // armed through reset() would let stale grant history cross a
      // disqualification — impossible with the real machine.
      reset: vi.fn((): void => {
        chain.state.mockImplementation(() => null);
      }),
    };
    // The REAL grant tracker (plan 004 T2.S2) — same instance the build
    // wires as deps.grant. armNow() models the ARM-SITE CONTRACT (arm ⇒
    // fresh grant — what the provider/widget arm sites do beside
    // chain.arm), so re-arms never inherit stale grant history.
    const grant = createChainGrantTracker();
    return {
      chain: chain as unknown as ChainMachine,
      grant,
      armNow: () => {
        chain.state.mockImplementation(() => ({ word }));
        grant.reset();
      },
      reset: chain.reset,
    };
  };

  const seedChainStore = (): CandidateStore => {
    const s = new CandidateStore();
    s.recordBigramRuns([["zorpwibble", "quuxblat"]]);
    s.recordBigramRuns([["zorpwibble", "quuxblat"]]);
    s.recordBigramRuns([["zorpwibble", "deltaword"]]);
    const put = (key: string, display: string): void =>
      s.upsert({
        key,
        display,
        ordinal: s.currentOrdinal() + 1,
        fromUser: false,
        properName: false,
        rankGroup: 0,
        isSubword: false,
      });
    put("zorpwibble", "zorpwibble");
    put("quuxblat", "Quuxblat"); // distinct casing: display comes from the store entry
    put("deltaword", "deltaword");
    return s;
  };

  it("(1) zero-char offer: an empty word start paints the successors IMMEDIATELY (count order, store casing, no reset)", async () => {
    const c = armedChain("zorpwibble");
    const { machine, editor } = await build({ store: seedChainStore(), chain: c.chain, grant: c.grant });
    c.armNow();
    editor.set("zorpwibble ", 12);
    const st = machine.onInput();
    expect(st.visible).toBe(true);
    expect(st.currentSet.map((i) => i.display)).toEqual([
      "Quuxblat",
      "deltaword",
    ]); // count-desc order; store display casing (Quuxblat)
    expect(machine.painted().map((m) => m.key)).toEqual([
      "quuxblat",
      "deltaword",
    ]);
    expect(machine.painted().every((m) => m.description === "chain")).toBe(
      true,
    );
    expect(c.reset).not.toHaveBeenCalled();
  });

  it("(2) typed fragment filters via matchFragment membership; the swap is R6-debounced, not immediate", async () => {
    const c = armedChain("zorpwibble");
    const { machine, editor } = await build({ store: seedChainStore(), chain: c.chain, grant: c.grant });
    c.armNow();
    editor.set("zorpwibble ", 12);
    machine.onInput(); // full offer paints (count order)
    editor.set("zorpwibble qu", 14);
    machine.onInput(); // inside the 100 ms window → parked, OLD set stays
    expect(machine.painted().map((m) => m.key)).toEqual([
      "quuxblat",
      "deltaword",
    ]); // narrowing must not close+repaint
    await vi.advanceTimersByTimeAsync(100); // R6 promotion through paint()
    expect(machine.getState().currentSet.map((i) => i.display)).toEqual([
      "Quuxblat",
    ]); // deltaword filtered (anchored 'd' ≠ 'q')
    expect(machine.painted().map((m) => m.key)).toEqual(["quuxblat"]);
    expect(c.reset).not.toHaveBeenCalled();
  });

  it("(3) glued trigger fragment '#q' resets the chain; trigger mode answers (no chain shim)", async () => {
    const c = armedChain("zorpwibble");
    const { machine, editor } = await build({ store: seedChainStore(), chain: c.chain, grant: c.grant });
    c.armNow();
    editor.set("zorpwibble #q", 13); // col = line length (13)
    const st = machine.onInput();
    expect(c.reset).toHaveBeenCalledTimes(1); // disqualify → idle
    expect(st.visible).toBe(true); // the normal path answered — trigger mode
    expect(machine.painted().every((m) => m.description !== "chain")).toBe(
      true,
    );
  });

  it("(4) punctuation-glued fragment resets and falls through (word-start guard)", async () => {
    const c = armedChain("zorpwibble");
    const { machine, editor } = await build({ store: seedChainStore(), chain: c.chain, grant: c.grant });
    c.armNow();
    editor.set("zorpwibble!qu", 13);
    const st = machine.onInput();
    expect(c.reset).toHaveBeenCalledTimes(1);
    expect(st.visible).toBe(true); // threshold path answered — never an empty return
    expect(machine.painted().every((m) => m.description !== "chain")).toBe(
      true,
    );
  });

  it("(5) empty successor set → reset + fall-through; NEVER a visible line with zero candidates", async () => {
    const c = armedChain("loneword"); // armed, but no bigrams seeded
    const { machine, editor } = await build({ store: seedChainStore(), chain: c.chain, grant: c.grant });
    c.armNow();
    editor.set("loneword ", 9);
    const st = machine.onInput();
    expect(c.reset).toHaveBeenCalledTimes(1);
    expect(st.visible).toBe(false); // R3 close on the fall-through
    expect(st.currentSet).toEqual([]);
    expect(machine.painted()).toEqual([]);
  });

  it("(6) stock context wins: R1 hides before the branch runs (no paint, no reset)", async () => {
    const c = armedChain("zorpwibble");
    const { machine, editor } = await build({ store: seedChainStore(), chain: c.chain, grant: c.grant });
    c.armNow();
    editor.set("/cmd", 4); // line-0 slash command → stock context
    const st = machine.onInput();
    expect(st.visible).toBe(false);
    expect(c.reset).not.toHaveBeenCalled(); // R1 returned before the branch
    expect(machine.painted()).toEqual([]);
  });

  it("(7) enableChaining false: the branch is fully inert (idle byte-identical)", async () => {
    const c = armedChain("zorpwibble");
    const { machine, editor } = await build({
      store: seedChainStore(),
      chain: c.chain,
      grant: c.grant,
      config: { enableChaining: false },
    });
    c.armNow();
    editor.set("zorpwibble ", 12);
    const st = machine.onInput();
    expect(st.visible).toBe(false); // trailing space → the R3 close, as idle
    expect(machine.painted()).toEqual([]);
    expect(c.reset).not.toHaveBeenCalled(); // never consulted
  });

  it("(8) hesitation bypass: a chain offer paints immediately under menuDelayMs (a word-mode reopen would be held)", async () => {
    const c = armedChain("zorpwibble");
    const { machine, editor } = await build({
      store: seedChainStore(),
      chain: c.chain,
      grant: c.grant,
      config: { menuDelayMs: 2000 },
    });
    c.armNow();
    // Disqualify first: fragment 'x' matches no successor → reset + the
    // normal query closes the line (closeAt stamped).
    editor.set("zorpwibble x", 13);
    machine.onInput();
    expect(machine.getState().visible).toBe(false);
    // 300 ms later: past freshReopen (200), far under menuDelayMs (2000).
    await vi.advanceTimersByTime(300);
    c.armNow(); // re-armed (the user accepted a word again) — arm ⇒ fresh grant
    editor.set("zorpwibble ", 12);
    const st = machine.onInput();
    // The chain offer is INTENT — it paints NOW; a word-mode reopen at
    // this gap would sit in the hesitation gate.
    expect(st.visible).toBe(true);
    expect(st.currentSet.map((i) => i.display)).toEqual([
      "Quuxblat",
      "deltaword",
    ]);
  });

  it("(9) restore-gate parity: chain offers hold until the replay settles, then paint", async () => {
    const c = armedChain("zorpwibble");
    const gate = deferred();
    const { machine, editor } = await build({
      store: seedChainStore(),
      chain: c.chain,
      grant: c.grant,
      restoreReady: gate.promise,
    });
    c.armNow();
    editor.set("zorpwibble ", 12);
    let st = machine.onInput();
    expect(st.visible).toBe(false); // held — armGate, never painted
    expect(machine.painted()).toEqual([]);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0); // settle microtask → wakeEvaluate
    st = machine.getState();
    expect(st.visible).toBe(true);
    expect(st.currentSet.map((i) => i.display)).toEqual([
      "Quuxblat",
      "deltaword",
    ]);
  });

  // ── one-shot grant (plan 004 T2.S2, bugfix 001_1a2f4ffe408f) ──

  it("(10) typing through the offered word disarms at the NEXT word start — the normal path answers that same tick", async () => {
    const c = armedChain("zorpwibble");
    const { machine, editor } = await build({
      store: seedChainStore(),
      chain: c.chain,
      grant: c.grant,
    });
    c.armNow();

    // The granted offer's word: empty word start → tick("") = word 1.
    editor.set("zorpwibble ", 12);
    machine.onInput();
    expect(machine.painted().every((m) => m.description === "chain")).toBe(true);
    expect(c.reset).not.toHaveBeenCalled();

    // Typing INTO the offered word — same word, still armed, still offering.
    // (The narrowed set differs inside the 100 ms swap window → parked;
    // promote it before asserting, mirroring S1's case (2).)
    editor.set("zorpwibble quuxblat", 19);
    machine.onInput();
    await vi.advanceTimersByTimeAsync(100);
    expect(machine.painted().map((m) => m.display)).toEqual(["Quuxblat"]);
    expect(c.reset).not.toHaveBeenCalled();

    // The NEXT word start → the grant is spent: chain reset + fall
    // through — the normal path answers THIS tick (trailing space → R3
    // close; never a chain shim, never a stuck offer).
    editor.set("zorpwibble quuxblat ", 20);
    const st = machine.onInput();
    expect(c.reset).toHaveBeenCalledTimes(1);
    expect(st.visible).toBe(false);
    expect(machine.painted().every((m) => m.description !== "chain")).toBe(true);
  });

  it("(11) narrowing AND backspace inside the granted word keep the chain (mutual prefix)", async () => {
    const c = armedChain("zorpwibble");
    const { machine, editor } = await build({
      store: seedChainStore(),
      chain: c.chain,
      grant: c.grant,
    });
    c.armNow();

    editor.set("zorpwibble ", 12);
    machine.onInput(); // word 1 granted
    editor.set("zorpwibble q", 12);
    machine.onInput(); // typing into the offer (empty → non-empty: same word)
    await vi.advanceTimersByTimeAsync(100); // promote the narrowed set
    editor.set("zorpwibble qu", 13); // narrowing — mutual prefix, same word
    machine.onInput();
    editor.set("zorpwibble q", 12); // backspace — still mutual prefix
    machine.onInput();
    await vi.advanceTimersByTimeAsync(100); // promote the widened-back set

    expect(c.reset).not.toHaveBeenCalled(); // never disarmed mid-word
    expect(machine.painted().map((m) => m.display)).toEqual(["Quuxblat"]);
  });

  it("(12) the acceptance contract (arm ⇒ fresh grant) re-offers at the next word start", async () => {
    const c = armedChain("zorpwibble");
    const { machine, editor } = await build({
      store: seedChainStore(),
      chain: c.chain,
      grant: c.grant,
    });
    c.armNow();

    editor.set("zorpwibble ", 12);
    machine.onInput(); // tick #1 → the granted offer paints
    expect(machine.painted().every((m) => m.description === "chain")).toBe(true);

    // Type through the offered word (same word — the grant is NOT spent),
    // then the next word start spends it (non-empty → "" = new word).
    editor.set("zorpwibble quuxblat", 19);
    machine.onInput();
    editor.set("zorpwibble quuxblat ", 20);
    machine.onInput(); // tick #2 → spent → chain reset + fall through
    expect(c.reset).toHaveBeenCalledTimes(1);

    // The acceptance half (widget.test.ts's matrix pins grant.reset beside
    // chain.arm): re-arm — armNow models that contract (arm ⇒ fresh grant).
    c.armNow();

    editor.set("zorpwibble quuxblat ", 20);
    machine.onInput(); // fresh grant → tick #1 → the offer paints again
    expect(machine.painted().map((m) => m.display)).toEqual([
      "Quuxblat",
      "deltaword",
    ]);
    expect(c.reset).toHaveBeenCalledTimes(1); // not re-spent — one shot
  });
});

// ── R4 — fingerprint release (BUG-003: dismissal must not leak across messages) ──

describe("R4 — fingerprint release (BUG-003)", () => {
  /** Chain double + store, mirroring the armed-chain-consult describe's
   *  harness (those helpers are describe-scoped; this block needs its
   *  own). */
  const armedChain = (word: string) => {
    const chain = {
      state: vi.fn((): { word: string } | null => null),
      arm: vi.fn(),
      reset: vi.fn((): void => {
        chain.state.mockImplementation(() => null);
      }),
    };
    const grant = createChainGrantTracker();
    return {
      chain: chain as unknown as ChainMachine,
      grant,
      armNow: () => {
        chain.state.mockImplementation(() => ({ word }));
        grant.reset();
      },
    };
  };

  const seedChainStore = (): CandidateStore => {
    const s = new CandidateStore();
    s.recordBigramRuns([["zorpwibble", "quuxblat"]]);
    s.recordBigramRuns([["zorpwibble", "quuxblat"]]);
    s.recordBigramRuns([["zorpwibble", "deltaword"]]);
    const put = (key: string, display: string): void =>
      s.upsert({
        key,
        display,
        ordinal: s.currentOrdinal() + 1,
        fromUser: false,
        properName: false,
        rankGroup: 0,
        isSubword: false,
      });
    put("zorpwibble", "zorpwibble");
    put("quuxblat", "Quuxblat");
    put("deltaword", "deltaword");
    return s;
  };

  it("Escape variant: dismiss 'ze' at start 0 → a fresh buffer's first word ('lw') paints", async () => {
    const { machine, editor } = await build({
      query: canned({ ze: [rm("Zendesk")], lw: [rm("Lwlock")] }),
    });
    editor.set("ze", 2);
    machine.onInput(); // paints
    expect(machine.getState().visible).toBe(true);

    machine.onDismissed(true); // Escape: start 0, fingerprint "ze"
    expect(machine.getState()).toMatchObject({
      visible: false,
      suppressUntilWordStart: true,
    });

    // The submitted message clears the buffer: an empty-buffer tick
    // OBSERVES the dismissed word occurrence gone → the suppression
    // LAPSES (2026-10 wedge fix — spec §07 dismissal bullet). The old
    // behavior kept suppressUntilWordStart: true here.
    editor.set("", 0);
    await vi.advanceTimersByTime(10);
    expect(machine.onInput()).toMatchObject({
      visible: false,
      suppressUntilWordStart: false,
    });

    // THE inversion: the next message's first word at start 0 — neither
    // buffer is a prefix of the other → released, lwlock visible.
    await vi.advanceTimersByTime(10);
    editor.set("lw", 2);
    const st = machine.onInput();
    expect(st.visible).toBe(true);
    expect(st.suppressUntilWordStart).toBe(false);
    expect(st.currentSet).toEqual([{ display: "Lwlock" }]);
  });

  it("Tab-accept variant: dismiss the completed 'Zendesk' → cleared buffer → 'lw' paints", async () => {
    // insertHighlighted's seam (widget.ts Tab path): the COMPLETED buffer
    // is on screen when the key layer fires onDismissed(true), so the
    // recorded fingerprint is the post-accept buffer.
    const { machine, editor } = await build({
      query: canned({ lw: [rm("Lwlock")] }),
    });
    editor.set("Zendesk", 7);
    machine.onDismissed(true); // Tab-accept: start 0, fingerprint "Zendesk"
    expect(machine.getState().suppressUntilWordStart).toBe(true);

    editor.set("", 0); // Enter-submit cleared the buffer
    await vi.advanceTimersByTime(10);
    // The cleared buffer OBSERVES the occurrence gone → lapse (the
    // dismissed word can never re-wedge the next prompt's first word,
    // even when it shares the prefix — the 2026-10 wedge fix).
    expect(machine.onInput()).toMatchObject({
      visible: false,
      suppressUntilWordStart: false,
    });

    await vi.advanceTimersByTime(10);
    editor.set("lw", 2);
    const st = machine.onInput();
    expect(st.visible).toBe(true);
    expect(st.suppressUntilWordStart).toBe(false);
    expect(st.currentSet).toEqual([{ display: "Lwlock" }]);
  });

  it("Enter-submit variant: dismiss 'ze' pre-submit → cleared buffer → 'lw' paints", async () => {
    const { machine, editor } = await build({
      query: canned({ ze: [rm("Zendesk")], lw: [rm("Lwlock")] }),
    });
    editor.set("ze", 2);
    machine.onInput();
    machine.onDismissed(true); // Enter fires onDismissed BEFORE clearing (:1113-1119)
    editor.set("", 0); // the submit clears the buffer
    await vi.advanceTimersByTime(10);
    machine.onInput();

    await vi.advanceTimersByTime(10);
    editor.set("lw", 2);
    const st = machine.onInput();
    expect(st.visible).toBe(true);
    expect(st.suppressUntilWordStart).toBe(false);
  });

  it("same-word backspace within the SAME buffer stays suppressed (prefix relation)", async () => {
    const { machine, editor } = await build({
      query: canned({ zend: [rm("Zendesk")], zen: [rm("Zendesk")] }),
    });
    editor.set("zend", 4);
    machine.onInput();
    machine.onDismissed(true); // fingerprint "zend", start 0

    await vi.advanceTimersByTime(10);
    editor.set("zen", 3); // backspace: current is a prefix OF the dismissed buffer
    expect(machine.onInput()).toMatchObject({
      visible: false,
      suppressUntilWordStart: true,
    });
  });

  // ── suppression lapse — the 2026-10 wedge fix (live-observed) ────────────

  it("WEDGE REPRO: Tab-completed FIRST word backspaced away → retyping the SAME word paints (no preceding space exists to delete)", async () => {
    const { machine, editor } = await build({
      query: canned({
        z: [rm("Zendesk")],
        ze: [rm("Zendesk")],
      }),
    });
    // Tab-accept seam: the COMPLETED buffer is live at dismissal.
    editor.set("Zendesk", 7);
    machine.onDismissed(true); // fingerprint "Zendesk", start 0
    expect(machine.getState().suppressUntilWordStart).toBe(true);

    // Backspace the whole word — the "" tick observes the occurrence
    // gone and lapses suppression.
    await vi.advanceTimersByTime(10);
    editor.set("", 0);
    expect(machine.onInput()).toMatchObject({
      visible: false,
      suppressUntilWordStart: false, // LAPSED
    });

    // Retype the SAME word — previously wedged (every prefix looked
    // like same-word backspace continuation); now a fresh word start.
    await vi.advanceTimersByTime(10);
    editor.set("ze", 2);
    const st = machine.onInput();
    expect(st.visible).toBe(true);
    expect(st.currentSet).toEqual([{ display: "Zendesk" }]);
  });

  it("mid-prompt: Tab-completed word backspaced to the PRECEDING SPACE → retype paints (no space-deletion workaround needed)", async () => {
    const { machine, editor } = await build({
      query: canned({
        z: [rm("Zendesk")],
        ze: [rm("Zendesk")],
      }),
    });
    editor.set("foo Zendesk", 11);
    machine.onDismissed(true); // fingerprint "foo Zendesk", start 4

    // Backspace exactly the word — the space stays ("foo ", len 4 =
    // the dismissed start) → the occurrence is gone → lapse.
    await vi.advanceTimersByTime(10);
    editor.set("foo ", 4);
    expect(machine.onInput()).toMatchObject({
      visible: false,
      suppressUntilWordStart: false,
    });

    await vi.advanceTimersByTime(10);
    editor.set("foo ze", 6);
    const st = machine.onInput();
    expect(st.visible).toBe(true);
    expect(st.currentSet).toEqual([{ display: "Zendesk" }]);
  });

  it("immediate post-Tab re-offer protection intact: the completed word on screen NEVER lapses or repaints", async () => {
    const { machine, editor } = await build({
      query: canned({ Zendesk: [rm("Zendesk")] }),
    });
    editor.set("Zendesk", 7);
    machine.onDismissed(true);

    // The very next tick — buffer still holds the completed word: no
    // lapse (len 7 > start 0), no re-offer (same-word continuation).
    await vi.advanceTimersByTime(10);
    expect(machine.onInput()).toMatchObject({
      visible: false,
      suppressUntilWordStart: true,
    });

    // Extending it stays hidden too ("rest of the word").
    await vi.advanceTimersByTime(10);
    editor.set("Zendeskx", 8);
    expect(machine.onInput()).toMatchObject({
      visible: false,
      suppressUntilWordStart: true,
    });
  });

  it("empty-dismissed buffer is context-free: any boundary releases", async () => {
    const { machine, editor } = await build({
      query: canned({ lw: [rm("Lwlock")] }),
    });
    editor.set("", 0);
    machine.onDismissed(true); // fingerprint "" → null (context-free)

    await vi.advanceTimersByTime(10);
    editor.set("lw", 2);
    const st = machine.onInput();
    expect(st.visible).toBe(true);
    expect(st.suppressUntilWordStart).toBe(false);
  });

  it("BUG-001 composition: a zero-char chain offer at start 0 paints after a Tab-accept dismissal", async () => {
    const c = armedChain("zorpwibble");
    const { machine, editor } = await build({
      store: seedChainStore(),
      chain: c.chain,
      grant: c.grant,
    });
    editor.set("zorpwibble", 10);
    machine.onDismissed(true); // Tab-accept dismissal at start 0, fingerprint "zorpwibble"
    expect(machine.getState().suppressUntilWordStart).toBe(true);
    c.armNow(); // the acceptance armed the chain (arm ⇒ fresh grant)

    await vi.advanceTimersByTime(10);
    editor.set("zorpwibble ", 12); // the next word start
    const st = machine.onInput(); // the zero-char successor offer PAINTS
    expect(st.visible).toBe(true);
    expect(st.suppressUntilWordStart).toBe(false);
    expect(st.currentSet.map((i) => i.display)).toEqual([
      "Quuxblat",
      "deltaword",
    ]);
  });
});

// ── 1-char ambient open — the live-editor threshold clamp (spec §07: word
//    matching is effective from 1 typed char; config.threshold is RETAINED
//    BUT INERT here — spec invariant 2: the menu opens on the 1st char) ──

describe("1-char ambient open (live-editor threshold clamp)", () => {
  it("the 1st char of a matching word opens the line under DEFAULT_CONFIG (threshold 2 stays inert)", async () => {
    // DEFAULT_CONFIG unmodified (threshold: 2) — the exact shape that
    // shipped the drift: the widget's extractMatchState call must clamp
    // internally, never inherit the raw schema default.
    const query = vi.fn(
      canned({ l: [rm("lwlock")], lw: [rm("lwlock")], z: [rm("Zendesk")] }),
    );
    const { machine, editor } = await build({ query });

    editor.set("l", 1);
    const st = machine.onInput();
    expect(st.visible).toBe(true);
    expect(st.currentSet).toEqual([{ display: "lwlock" }]);
    expect(query).toHaveBeenCalledWith("l", "ambient");

    editor.set("z", 1);
    machine.onInput();
    expect(query).toHaveBeenLastCalledWith("z", "ambient");

    // The reported repro's backspace leg: 'lw' → backspace to 'l' must
    // STAY open (a 1-char fragment still qualifies), not close.
    await vi.advanceTimersByTime(100); // past the swap window for a clean re-paint
    editor.set("lw", 2);
    expect(machine.onInput().visible).toBe(true);
    await vi.advanceTimersByTime(100); // past the swap window: the set paints immediately
    editor.set("l", 1);
    const back = machine.onInput();
    expect(back.visible).toBe(true);
    expect(back.currentSet).toEqual([{ display: "lwlock" }]);
  });

  it("Escape at a 1-char fragment records the fragment start: extending the same word stays hidden", async () => {
    // The dismissal bookkeeping must run the same clamp, or the recorded
    // suppressedFragmentStart is the cursor (not col − fragment.length)
    // and the R4 release test re-opens mid-word on the next keystroke.
    const { machine, editor } = await build({
      query: canned({ l: [rm("lwlock")], lw: [rm("lwlock")] }),
    });
    editor.set("l", 1);
    expect(machine.onInput().visible).toBe(true); // opens at 1 char

    machine.onDismissed(true); // Escape: fragment 'l' starts at 0, fingerprint "l"
    expect(machine.getState()).toMatchObject({
      visible: false,
      suppressUntilWordStart: true,
    });

    // Extending the SAME word (start 0, buffer continues the dismissed
    // one): stays suppressed — release needs a NEW word start (BUG-003).
    await vi.advanceTimersByTime(10);
    editor.set("lw", 2);
    const st = machine.onInput();
    expect(st.visible).toBe(false);
    expect(st.suppressUntilWordStart).toBe(true);
  });
});
