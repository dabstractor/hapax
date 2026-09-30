/**
 * Widget suite — two halves:
 *
 * 1. Line rendering (spec §07 h3.8, plan 003 P1.M3.T1.S2): join
 *    format, caps (maxSuggestions AND cached render(width)), overflow
 *    dropping the RIGHTMOST (lowest-ranked) items, accent highlight on
 *    the leftmost (reset on every set), display-strings-only output,
 *    zero-never (invariant 3: structurally absent, never a blank
 *    line), width caching/re-fit, and the never-mutate/forwarding
 *    pins over the composed proxy editor (patterns from
 *    test/editor-enter.test.ts).
 *
 * 2. Key handling (spec §07 h3.9, plan 003 P1.M3.T3.S1 + S2): while
 *    the line is visible the composed handleInput consumes ←/→/↑/↓
 *    (navigate; up≡left, down≡right), ↑/← on the FIRST word
 *    (boundary-Esc: consumed + hidden + suppressed), →/↓ on the LAST
 *    word (clamp: consumed, no movement) and Escape (dismiss +
 *    suppress). S2 (P1.M3.T3.S2) adds the completion keys: Tab
 *    SYNCHRONOUSLY inserts the highlighted candidate's display string
 *    over the word/#fragment span (consumed — never delegated, never
 *    debounce-gated, never menu-opening) and Enter dismisses the line
 *    then forwards so the inner editor still submits. Every other key
 *    — and EVERY key while hidden or empty — forwards verbatim,
 *    exactly once. The pure
 *    decision table (decideWidgetKey) is tested directly; consumption,
 *    clock-tick and suppression semantics through the composed editor
 *    with a recording inner stub and a never-mutate pin (v1 crash
 *    regression). Suppression is asserted via the real visibility
 *    machine's state — only explicit dismissal ever sets it.
 *
 * The pure renderer (renderWidgetLine) is tested directly; the proxy
 * render override is tested through createWidgetEditorFactory with a
 * fake inner editor (render: (w) => ["hello"]) — asserting composition
 * (inner output is a PREFIX of the wrapped output), not replacement.
 * No tui/requestRender involvement here; live TTY verification is
 * P1.M3.T4.S1's binding gate (spec §09).
 */

import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { CandidateStore } from "../src/core/store.js";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { HapaxConfig } from "../src/pi/config.js";
import type { ChainMachine } from "../src/pi/provider.js";
import type { WidgetState } from "../src/pi/widget.js";
import {
  createWidgetEditorFactory,
  decideWidgetKey,
  isWidgetWrapper,
  renderWidgetLine,
  widgetMachineOf,
  widgetOptsOf,
  widgetStateOf,
  type WidgetLayerOptions,
} from "../src/pi/widget.js";

// ── fixtures ────────────────────────────────────────────────────────────────

const items = (...displays: string[]) => displays.map((display) => ({ display }));

/** Items that ALSO carry RankedMatch-only fields — the renderer must
 *  ignore everything but `display` (h2.42: "the candidate display
 *  string, nothing else"). */
const rankedItems = (...displays: string[]) =>
  displays.map((display) => ({
    display,
    key: display.toLowerCase(),
    description: `session ×3`,
    salience: 7.5,
    sessionCount: 3,
  }));

/** Visible accent: brackets make the highlighted item assertable. */
const bracket = (t: string) => `[${t}]`;

const cfg = (over: Partial<HapaxConfig> = {}): HapaxConfig => ({
  ...DEFAULT_CONFIG,
  ...over,
});

/** Fake inner editor: render(width) returns ["hello"] and records its
 *  width arguments. Deliberately NOT a proxy — S2 must never mutate it
 *  (v1 lesson pin). */
const makeInnerEditor = () => {
  const editor = {
    renderWidths: [] as number[],
    render: (width: number): string[] => {
      editor.renderWidths.push(width);
      return ["hello"];
    },
    getLines: (): string[] => ["hello"],
    handleInput: function (data: string) {
      return `inner:${data}`;
    },
  };
  return editor;
};

/** Build a composed widget editor over a fresh fake inner. */
const buildWidget = (over: Partial<WidgetLayerOptions> = {}) => {
  const innerEditor = makeInnerEditor();
  const opts: WidgetLayerOptions = {
    inner: () => innerEditor,
    store: {} as unknown as CandidateStore,
    config: cfg(),
    chain: {} as unknown as ChainMachine,
    restoreReady: Promise.resolve(),
    onKeystroke: () => {},
    ...over,
  };
  const factory = createWidgetEditorFactory(opts);
  // No pi EditorTheme → the identity accent fallback (theme probe fails
  // structurally). The themed-accent path has its own case below.
  const editor = factory(undefined, {}, undefined);
  const state = widgetStateOf(editor)!;
  return { factory, opts, editor, innerEditor, state };
};

// ── pure renderer ────────────────────────────────────────────────────────────

describe("widget line rendering (spec §07 h3.8 — join, caps, overflow, highlight, zero-never)", () => {
  describe("renderWidgetLine — pure line building", () => {
    it("joins with \" | \" in rank order (input order preserved, leftmost = best)", () => {
      expect(
        renderWidgetLine(items("Zendesk", "zephyr", "zlock"), {
          width: 40,
          maxSuggestions: 8,
          highlightIndex: 0,
          accent: (t) => t,
        }),
      ).toBe("Zendesk | zephyr | zlock");
      // Never re-sorts: a reversed input renders reversed.
      expect(
        renderWidgetLine(items("zlock", "zephyr", "Zendesk"), {
          width: 40,
          maxSuggestions: 8,
          highlightIndex: 0,
          accent: (t) => t,
        }),
      ).toBe("zlock | zephyr | Zendesk");
    });

    it("count cap: only the first maxSuggestions items render", () => {
      const ten = items("w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "w10");
      expect(
        renderWidgetLine(ten, {
          width: 1000,
          maxSuggestions: 8,
          highlightIndex: 0,
          accent: (t) => t,
        }),
      ).toBe("w1 | w2 | w3 | w4 | w5 | w6 | w7 | w8");
    });

    it("width cap: greedy left→right fit; overflow drops the RIGHTMOST first", () => {
      const three = items("Zendesk", "zephyr", "zlock"); // 7,6,5 — joined2=16, joined3=24
      const opts = (width: number) => ({
        width,
        maxSuggestions: 8,
        highlightIndex: 0,
        accent: (t: string) => t,
      });
      expect(renderWidgetLine(three, opts(24))).toBe("Zendesk | zephyr | zlock"); // exact fit
      expect(renderWidgetLine(three, opts(23))).toBe("Zendesk | zephyr"); // drop rightmost
      expect(renderWidgetLine(three, opts(16))).toBe("Zendesk | zephyr"); // exact fit
      expect(renderWidgetLine(three, opts(15))).toBe("Zendesk"); // drop rightmost
      expect(renderWidgetLine(three, opts(10))).toBe("Zendesk");
      expect(renderWidgetLine(three, opts(7))).toBe("Zendesk"); // exact fit
      // Not even the first item fits → NO line (invariant 3).
      expect(renderWidgetLine(three, opts(6))).toBeNull();
      expect(renderWidgetLine(three, opts(0))).toBeNull();
    });

    it("zero candidates → null (structurally absent, never a blank line)", () => {
      expect(
        renderWidgetLine([], {
          width: 80,
          maxSuggestions: 8,
          highlightIndex: 0,
          accent: (t) => t,
        }),
      ).toBeNull();
    });

    it("accent hits highlightIndex only (spy); index clamped into the rendered list", () => {
      const accent = vi.fn(bracket);
      const line = renderWidgetLine(items("Zendesk", "zephyr", "zlock"), {
        width: 40,
        maxSuggestions: 8,
        highlightIndex: 1,
        accent,
      });
      expect(line).toBe("Zendesk | [zephyr] | zlock");
      expect(accent).toHaveBeenCalledTimes(1);
      expect(accent).toHaveBeenCalledWith("zephyr");

      // Clamp high → last rendered item.
      const hi = vi.fn(bracket);
      expect(
        renderWidgetLine(items("Zendesk", "zephyr"), {
          width: 40,
          maxSuggestions: 8,
          highlightIndex: 99,
          accent: hi,
        }),
      ).toBe("Zendesk | [zephyr]");
      // Clamp low → first rendered item.
      const lo = vi.fn(bracket);
      expect(
        renderWidgetLine(items("Zendesk", "zephyr"), {
          width: 40,
          maxSuggestions: 8,
          highlightIndex: -5,
          accent: lo,
        }),
      ).toBe("[Zendesk] | zephyr");
    });

    it("items are display strings ONLY — description/sessionCount/marker never leak", () => {
      const line = renderWidgetLine(rankedItems("Zendesk", "zephyr"), {
        width: 80,
        maxSuggestions: 8,
        highlightIndex: 0,
        accent: (t) => t,
      });
      expect(line).toBe("Zendesk | zephyr");
      expect(line).not.toMatch(/session/);
      expect(line).not.toMatch(/×/);
      expect(line).not.toMatch(/chain/);
    });
  });

  describe("widget state — set/hide/highlight", () => {
    it("set() resets highlightIndex to 0 on every result-set change (spec h2.55)", () => {
      const { editor, state } = buildWidget();
      state.set(items("alpha", "beta"));
      state.highlightIndex = 1; // T3 will move this; plain mutation suffices
      expect(state.highlightIndex).toBe(1);
      state.set(items("gamma", "delta"));
      expect(state.highlightIndex).toBe(0); // reset — highlight back on leftmost
      const line = (editor.render as (w: number) => string[])(40);
      expect(line).toEqual(["hello", "gamma | delta"]);
    });

    it("hide() renders nothing; set() after hide() shows the new set again", () => {
      const { editor, state } = buildWidget();
      state.set(items("Zendesk", "zephyr"));
      state.hide();
      expect((editor.render as (w: number) => string[])(40)).toEqual(["hello"]);
      state.set(items("zlock"));
      expect((editor.render as (w: number) => string[])(40)).toEqual([
        "hello",
        "zlock",
      ]);
    });

    it("set() copies the caller's array — later caller mutations never leak in", () => {
      const { editor, state } = buildWidget();
      const mutable = [{ display: "Zendesk" }, { display: "zephyr" }];
      state.set(mutable);
      mutable.length = 0; // caller trashes its array after set
      expect((editor.render as (w: number) => string[])(80)).toEqual([
        "hello",
        "Zendesk | zephyr",
      ]);
    });
  });

  // ── composed proxy: the render override ────────────────────────────────────

  describe("proxy render override (composes inner.render, never replaces)", () => {
    it("success definition: inner [\"hello\"] + 3-item set + width 40 → [\"hello\", \"Zendesk | zephyr | zlock\"], accent on item 0", () => {
      const accent = vi.fn((t: string) => t);
      const innerEditor = makeInnerEditor();
      const opts: WidgetLayerOptions = {
        inner: () => innerEditor,
        store: {} as unknown as CandidateStore,
        config: cfg(),
        chain: {} as unknown as ChainMachine,
        restoreReady: Promise.resolve(),
        onKeystroke: () => {},
      };
      // A pi-shaped EditorTheme: selectedText IS the accent channel.
      const themed = createWidgetEditorFactory(opts)(
        undefined,
        { selectList: { selectedText: accent } },
        undefined,
      );
      widgetStateOf(themed)!.set(items("Zendesk", "zephyr", "zlock"));
      expect((themed.render as (w: number) => string[])(40)).toEqual([
        "hello",
        "Zendesk | zephyr | zlock",
      ]);
      // Exactly the leftmost item rides the theme's selected-text styler.
      expect(accent).toHaveBeenCalledTimes(1);
      expect(accent).toHaveBeenCalledWith("Zendesk");
      expect(innerEditor.renderWidths).toEqual([40]);
    });

    it("zero candidates / hidden → the inner's lines BYTE-IDENTICAL (no blank line)", () => {
      const { editor, state, innerEditor } = buildWidget();
      state.set([]); // empty set
      const empty = (editor.render as (w: number) => string[])(40);
      expect(empty).toEqual(["hello"]);
      expect(empty.length).toBe(1); // structurally absent — no blank line
      state.set(items("Zendesk"));
      state.hide(); // hidden
      const hidden = (editor.render as (w: number) => string[])(40);
      expect(hidden).toEqual(["hello"]);
      expect(hidden.length).toBe(1);
      // Composition, not replacement: the inner's output is a PREFIX of
      // the wrapped output whenever a line IS appended.
      state.set(items("Zendesk", "zephyr"));
      const composed = (editor.render as (w: number) => string[])(40);
      expect(composed.slice(0, composed.length - 1)).toEqual(
        innerEditor.render(40),
      );
      expect(composed[composed.length - 1]).toBe("Zendesk | zephyr");
    });

    it("width cache: render(24) then render(16) re-truncates to the NEW width", () => {
      const { editor, state, innerEditor } = buildWidget();
      state.set(items("Zendesk", "zephyr", "zlock"));
      expect((editor.render as (w: number) => string[])(24)).toEqual([
        "hello",
        "Zendesk | zephyr | zlock",
      ]);
      expect((editor.render as (w: number) => string[])(16)).toEqual([
        "hello",
        "Zendesk | zephyr",
      ]);
      // The inner received every width verbatim.
      expect(innerEditor.renderWidths).toEqual([24, 16]);
    });

    it("set() BEFORE the first render: no eager render, and the first render uses its own width", () => {
      const { editor, state, innerEditor } = buildWidget();
      state.set(items("Zendesk", "zephyr", "zlock"));
      expect(innerEditor.renderWidths).toEqual([]); // nothing rendered eagerly
      // First render call: the width comes from the ARGUMENT (there is
      // no cached/stale width) — 16 caps to the two leftmost items.
      expect((editor.render as (w: number) => string[])(16)).toEqual([
        "hello",
        "Zendesk | zephyr",
      ]);
      expect(innerEditor.renderWidths).toEqual([16]);
    });

    it("unfittable single item → NO line: inner lines returned unchanged", () => {
      const { editor, state } = buildWidget();
      state.set(items("extraordinarily", "tiny"));
      expect((editor.render as (w: number) => string[])(10)).toEqual(["hello"]);
      // `tiny` never rescues a line once an earlier item overflows:
      // "extraordinarily | tiny" is 22 cols, so at width 20 the
      // RIGHTMOST remainder drops (rank adjacency, no mid-line skips).
      expect((editor.render as (w: number) => string[])(20)).toEqual([
        "hello",
        "extraordinarily",
      ]);
    });

    it("inner never mutated; forwarder intact; render closure is fresh per read", () => {
      const { editor, state, innerEditor, factory, opts } = buildWidget();
      const renderRef = innerEditor.render;
      state.set(items("Zendesk"));
      (editor.render as (w: number) => string[])(40);
      state.hide();
      (editor.render as (w: number) => string[])(40);

      // The fake inner's own property was never overwritten.
      expect(innerEditor.render).toBe(renderRef);
      expect(innerEditor.render(10)).toEqual(["hello"]); // still works directly
      // The composed editor is NOT the inner, and every "render" READ
      // returns a FRESH closure (never the inner's bound render, never
      // a memoized identity — r4 §2).
      expect(editor).not.toBe(innerEditor as unknown as object);
      const r1 = editor.render as unknown;
      const r2 = editor.render as unknown;
      expect(typeof r1).toBe("function");
      expect(r1).not.toBe(r2);
      expect(r1).not.toBe(renderRef);

      // Forwarding: non-render members pass through (get/set/has), and
      // the enter-submit guard is still the handleInput in charge.
      expect(editor.handleInput).toBeTypeOf("function");
      (editor as { probe?: number }).probe = 42;
      expect((editor as { probe?: number }).probe).toBe(42);
      expect("render" in editor).toBe(true);
      expect("noSuchMember" in editor).toBe(false);

      // S1 seams intact.
      expect(isWidgetWrapper(factory)).toBe(true);
      expect(widgetOptsOf(factory)).toBe(opts);
      void state;
    });

    it("onKeystroke still ticks via the enter-submit layer (S1 wiring untouched)", async () => {
      const onKeystroke = vi.fn();
      const { editor } = buildWidget({ onKeystroke });
      (editor.handleInput as (d: string) => unknown)("x");
      expect(onKeystroke).toHaveBeenCalledWith();
      expect(onKeystroke).toHaveBeenCalledTimes(1);
    });
  });
});

// ── T3/S1: widget key handling (spec §07 h3.9) ─────────────────────────────

/** Arrow/Esc byte sequences — the legacy forms matchesKey recognizes
 *  (production matches via matchesKey, never raw bytes; these literals
 *  are what a real terminal emits). */
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const RIGHT = "\x1b[C";
const LEFT = "\x1b[D";
const ESC = "\x1b";

/** Key-handling fixture: a RECORDING inner editor wrapped in a
 *  never-mutate pin (any property WRITE through the pin throws AND
 *  counts — the v1 recursion-crash regression), composed through
 *  createWidgetEditorFactory with the real visibility machine (empty
 *  store: any forwarded key closes the line without suppressing —
 *  exactly the disqualification shape the suppression clauses pin).
 *  `show()` makes the line visible with a controlled result set via
 *  the widgetStateOf seam; `press()` drives the composed handleInput. */
const makeKeyHarness = () => {
  const innerCalls: string[] = [];
  let setTrapHits = 0;
  const raw = {
    handleInput: (data: string): string => {
      innerCalls.push(data);
      return `inner:${data}`;
    },
    getLines: (): string[] => ["hello"],
    getCursor: (): { line: number; col: number } => ({ line: 0, col: 0 }),
    render: (): string[] => ["hello"],
  };
  const pinned = new Proxy(raw as unknown as Record<PropertyKey, unknown>, {
    get(target, prop) {
      return target[prop];
    },
    set(_target, _prop, _value) {
      setTrapHits += 1;
      throw new Error("NEVER mutate the inner editor instance (v1 crash lesson)");
    },
  });
  const onKeystroke = vi.fn();
  const opts: WidgetLayerOptions = {
    inner: () => pinned,
    store: {} as unknown as CandidateStore,
    config: cfg(),
    chain: {} as unknown as ChainMachine,
    restoreReady: Promise.resolve(),
    onKeystroke,
  };
  const editor = createWidgetEditorFactory(opts)(undefined, {}, undefined);
  // The runtime state carries `hidden` (createWidgetState) — the public
  // WidgetState interface just doesn't advertise it; widen structurally
  // for assertions.
  const state = widgetStateOf(editor)! as WidgetState & {
    readonly hidden: boolean;
  };
  const machine = widgetMachineOf(editor)!;
  const press = (data: string): unknown =>
    (editor.handleInput as (d: string) => unknown)(data);
  const show = (displays: string[]): void =>
    state.set(displays.map((display) => ({ display })));
  return {
    editor,
    state,
    machine,
    innerCalls,
    press,
    show,
    onKeystroke,
    setHits: () => setTrapHits,
  };
};

describe("widget key handling — navigation (spec §07 h3.9: arrows move the highlight, never out of range)", () => {
  it("→ then ↓ navigate right through the list; presses consumed (inner never sees them)", () => {
    const h = makeKeyHarness();
    h.show(["alpha", "beta", "gamma"]);
    h.press(RIGHT);
    expect(h.state.highlightIndex).toBe(1);
    h.press(DOWN);
    expect(h.state.highlightIndex).toBe(2);
    expect(h.state.hidden).toBe(false); // navigation never dismisses
    expect(h.innerCalls).toEqual([]); // consumed — the caret cannot move
  });

  it("← then ↑ navigate left; up≡left and down≡right (either pair spans the list both ways)", () => {
    const h = makeKeyHarness();
    h.show(["alpha", "beta", "gamma"]);
    h.press(DOWN);
    h.press(DOWN);
    expect(h.state.highlightIndex).toBe(2); // down walked right
    h.press(LEFT);
    expect(h.state.highlightIndex).toBe(1);
    h.press(UP);
    expect(h.state.highlightIndex).toBe(0); // up walked left
    expect(h.innerCalls).toEqual([]);
  });

  it("highlight moves within the RENDERED list: at width 16 only 2 of 3 items render → →/↓ clamps at 1", () => {
    const h = makeKeyHarness();
    h.show(["Zendesk", "zephyr", "zlock"]); // joined: 16 | 24 cols
    expect((h.editor.render as (w: number) => string[])(16)).toEqual([
      "hello",
      "Zendesk | zephyr",
    ]);
    h.press(RIGHT);
    expect(h.state.highlightIndex).toBe(1); // last RENDERED word
    h.press(RIGHT);
    expect(h.state.highlightIndex).toBe(1); // clamped to the rendered end
    h.press(DOWN);
    expect(h.state.highlightIndex).toBe(1); // down≡right at the boundary
    h.press(LEFT);
    expect(h.state.highlightIndex).toBe(0);
    expect(h.state.hidden).toBe(false);
  });
});

describe("widget key handling — boundary-Esc (spec §07 h3.9: ↑/← on the FIRST word dismisses, consumed)", () => {
  it("↑ and ← on the first word: press CONSUMED (no inner call — caret unmoved), line hidden, suppressed", () => {
    for (const key of [UP, LEFT]) {
      const h = makeKeyHarness();
      h.show(["alpha", "beta", "gamma"]);
      h.press(key);
      expect(h.innerCalls, `key ${JSON.stringify(key)}`).toEqual([]);
      expect(h.state.hidden, `key ${JSON.stringify(key)}`).toBe(true);
      expect(h.state.highlightIndex, `key ${JSON.stringify(key)}`).toBe(0);
      expect(
        h.machine.getState().suppressUntilWordStart,
        `key ${JSON.stringify(key)}`,
      ).toBe(true); // explicit dismissal → suppress until the next word
    }
  });

  it("a single-item list: ↑/← is boundary-Esc (first === last, left branch wins), →/↓ is clamp", () => {
    const up = makeKeyHarness();
    up.show(["solo"]);
    up.press(UP);
    expect(up.state.hidden).toBe(true);
    expect(up.machine.getState().suppressUntilWordStart).toBe(true);

    const down = makeKeyHarness();
    down.show(["solo"]);
    down.press(DOWN);
    expect(down.state.hidden).toBe(false); // clamp — NOT a dismissal
    expect(down.state.highlightIndex).toBe(0);
    expect(down.machine.getState().suppressUntilWordStart).toBe(false);
  });
});

describe("widget key handling — clamp (spec §07 h3.9: →/↓ on the LAST word consumes, no movement)", () => {
  it("→ and ↓ on the last word: consumed, highlight unchanged, no dismissal, no suppression", () => {
    for (const key of [RIGHT, DOWN]) {
      const h = makeKeyHarness();
      h.show(["alpha", "beta", "gamma"]);
      h.press(RIGHT);
      h.press(RIGHT); // → index 2 (last)
      h.innerCalls.length = 0;
      h.press(key);
      expect(h.state.highlightIndex, `key ${JSON.stringify(key)}`).toBe(2);
      expect(h.state.hidden, `key ${JSON.stringify(key)}`).toBe(false);
      expect(
        h.machine.getState().suppressUntilWordStart,
        `key ${JSON.stringify(key)}`,
      ).toBe(false);
      expect(h.innerCalls, `key ${JSON.stringify(key)}`).toEqual([]);
    }
  });
});

describe("widget key handling — Escape and suppression taxonomy (spec §07 h3.9)", () => {
  it("Escape: line hides + suppressed (explicit dismissal), press consumed from any highlight index", () => {
    const h = makeKeyHarness();
    h.show(["alpha", "beta", "gamma"]);
    h.press(RIGHT); // mid-list — Escape dismisses from anywhere
    h.press(ESC);
    expect(h.state.hidden).toBe(true);
    expect(h.machine.getState().suppressUntilWordStart).toBe(true);
    expect(h.innerCalls).toEqual([]); // consumed
  });

  it("a close WITHOUT explicit dismissal (forwarded key → machine closes) never suppresses; onDismissed(false) neither", async () => {
    const h = makeKeyHarness();
    h.show(["alpha", "beta"]);
    h.press("x"); // forwarded verbatim → the machine ticks, no fragment → closes
    await Promise.resolve(); // W1 fix: visibility evaluates post-keystroke (microtask)
    expect(h.innerCalls).toEqual(["x"]); // forwarded, not consumed
    expect(h.state.hidden).toBe(true); // closed…
    expect(h.machine.getState().suppressUntilWordStart).toBe(false); // …NOT suppressed
    // The machine's own non-explicit dismissal seam never suppresses.
    h.machine.onDismissed(false);
    expect(h.machine.getState().suppressUntilWordStart).toBe(false);
  });
});

describe("widget key handling — forward-verbatim (spec §07 h3.9 + invariant 1)", () => {
  it("every non-arrow/non-Escape key (text, space, backspace, Enter, Tab, Ctrl-chars) forwards verbatim, exactly once, while visible", () => {
    for (const key of ["a", " ", "\x7f", "\r", "\t", "\x03"]) {
      const h = makeKeyHarness();
      h.show(["alpha", "beta"]); // visible when the decision runs
      const out = h.press(key);
      expect(h.innerCalls, `key ${JSON.stringify(key)}`).toEqual([key]);
      expect(out, `key ${JSON.stringify(key)}`).toBe(`inner:${key}`); // return value passes through
    }
  });

  it("hidden line: EVERY key — arrows and Escape included — forwards verbatim (zero capture outside the visible window)", () => {
    const h = makeKeyHarness(); // a fresh editor starts hidden
    const keys = [UP, DOWN, LEFT, RIGHT, ESC, "a", "\t", "\r", "\x7f"];
    for (const key of keys) h.press(key);
    expect(h.innerCalls).toEqual(keys); // same order, same bytes, once each
  });

  it("visible with an EMPTY result set: nothing is captured (zero candidates never render — invariant 3)", () => {
    const h = makeKeyHarness();
    h.show([]); // hidden flag false, but the list is empty
    for (const key of [UP, DOWN, ESC, "a"]) h.press(key);
    expect(h.innerCalls).toEqual([UP, DOWN, ESC, "a"]);
  });
});

describe("widget key handling — input clock (exactly one tick per keypress)", () => {
  it("consumed keys tick via the widget layer (the guard's seam only fires on delegation) and never tick the machine", () => {
    const h = makeKeyHarness();
    h.show(["alpha", "beta", "gamma"]);
    h.press(RIGHT); // consumed → widget layer ticks
    expect(h.onKeystroke).toHaveBeenCalledTimes(1);
    expect(h.state.hidden).toBe(false); // machine NOT ticked: an empty-store
    // tick would have closed the line — navigation must keep it open.
    h.press(DOWN); // clamp at last — still a consumed input event
    expect(h.onKeystroke).toHaveBeenCalledTimes(2);
    expect(h.state.hidden).toBe(false);
    h.press(ESC); // consumed dismissal
    expect(h.onKeystroke).toHaveBeenCalledTimes(3);
    h.press("x"); // forwarded → the guard's clock seam (its normal path)
    expect(h.onKeystroke).toHaveBeenCalledTimes(4);
  });
});

// ── T3/S2: Tab insert + Enter dismiss-then-forward (spec §07 h2.46 rule 0 / h3.9) ──

/** S2 fixture: a recording inner editor with a LIVE buffer — getLines/
 *  getCursor read a mutable {lines,line,col} box, setText applies
 *  (mimicking the real editor: lines replaced, caret parked at buffer
 *  END) and records, setCursorCol records + applies. Every inner
 *  interaction lands in one ordered `calls` log so assertions pin the
 *  exact sequence; handleInput data is mirrored in `innerCalls`.
 *  Wrapped in the never-mutate pin (any property WRITE through the pin
 *  throws AND counts — v1 crash regression). Composed with a tui stub
 *  (requestRender spy) and a keybindings stub (\r = submit) so the
 *  decision layer runs exactly as in production. */
/** Minimal WORKING empty store for the visibility machine's query
 *  seam: rankMatches(store, …) must not throw — the machine's async
 *  wake (restoreReady settle, ≤500 ms gate) queries AFTER the
 *  synchronous test body, and a throwing query there would surface as
 *  an unhandled rejection. prefixRange → [0,0] ⇒ empty result ⇒ clean
 *  close, same as a real store with no candidates. */
const emptyStore = {
  prefixRange: (): [number, number] => [0, 0],
  sortedKeysSnapshot: (): string[] => [],
  currentOrdinal: (): number => 0,
  get: (): undefined => undefined,
} as unknown as CandidateStore;

const makeInsertHarness = (
  seed: { lines: string[]; line: number; col: number; noCaret?: boolean } = {
    lines: ["ze"],
    line: 0,
    col: 2,
  },
  over: Partial<WidgetLayerOptions> = {},
) => {
  const innerCalls: string[] = [];
  const calls: string[] = [];
  let setTrapHits = 0;
  const buf = { lines: [...seed.lines], line: seed.line, col: seed.col };
  const raw: Record<string, unknown> = {
    handleInput: (data: string): string => {
      innerCalls.push(data);
      calls.push(`inner:${JSON.stringify(data)}`);
      return `inner:${data}`;
    },
    getLines: (): string[] => buf.lines,
    getCursor: (): { line: number; col: number } => ({ line: buf.line, col: buf.col }),
    setText: (t: string): void => {
      calls.push(`setText:${JSON.stringify(t)}`);
      buf.lines = t.split("\n");
      buf.line = buf.lines.length - 1;
      // The real setText parks the caret at buffer END (setTextInternal
      // "end") — mimic that so caret-fix assertions are realistic.
      buf.col = (buf.lines[buf.lines.length - 1] ?? "").length;
    },
    getText: (): string => buf.lines.join("\n"),
    render: (): string[] => [buf.lines[buf.lines.length - 1] ?? ""],
  };
  if (!seed.noCaret) {
    raw.setCursorCol = (c: number): void => {
      calls.push(`caret:${c}`);
      buf.col = c;
    };
  }
  const pinned = new Proxy(raw, {
    get(target, prop) {
      return target[prop as string];
    },
    set(_target, _prop, _value) {
      setTrapHits += 1;
      throw new Error("NEVER mutate the inner editor instance (v1 crash lesson)");
    },
  });
  const onKeystroke = vi.fn();
  const requestRender = vi.fn();
  const opts: WidgetLayerOptions = {
    inner: () => pinned,
    store: emptyStore,
    config: cfg(),
    chain: {} as unknown as ChainMachine,
    restoreReady: Promise.resolve(),
    onKeystroke,
    ...over,
  };
  const editor = createWidgetEditorFactory(opts)({ requestRender }, {}, {
    matches: (data: string, action: string) =>
      action === "tui.input.submit" && data === "\r",
  });
  const state = widgetStateOf(editor)! as WidgetState & {
    readonly hidden: boolean;
  };
  const machine = widgetMachineOf(editor)!;
  const press = (data: string): unknown =>
    (editor.handleInput as (d: string) => unknown)(data);
  // NOTE: show() writes WidgetState.set DIRECTLY — it does NOT populate
  // machine.painted() (the arming seam; S1's single write site is the
  // machine's paint()). A case that needs REAL painted records must pass
  // a real store via `over.store` and paint through a forwarded
  // keystroke + a microtask flush (see the classification matrix below);
  // a show()-driven "acceptance" is vacuously never-arming.
  const show = (displays: string[]): void =>
    state.set(displays.map((display) => ({ display })));
  return {
    editor,
    state,
    machine,
    buf,
    innerCalls,
    calls,
    press,
    show,
    onKeystroke,
    requestRender,
    setHits: () => setTrapHits,
  };
};

describe("widget key handling — Tab inserts the highlighted word (spec §07 h2.46 rule 0, S2)", () => {
  it("Tab inserts items[highlightIndex].display over the word span; consumed end-to-end: no inner keypress, line dismissed + suppressed, repaint requested", () => {
    const h = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 });
    h.show(["Zendesk", "zephyr"]); // highlightIndex 0 → Zendesk

    const out = h.press("\t");

    expect(out).toBeUndefined(); // consumed — nothing delegated
    expect(h.calls).toEqual([`setText:${JSON.stringify("Zendesk")}`, "caret:7"]); // span "ze" (0..2) → Zendesk; caret = 0 + 7
    expect(h.innerCalls).toEqual([]); // the inner editor NEVER sees the Tab
    expect(h.buf.lines).toEqual(["Zendesk"]); // the edit landed in the buffer
    expect(h.state.hidden).toBe(true); // dismissed…
    expect(h.machine.getState().suppressUntilWordStart).toBe(true); // …explicitly (suppress until next word)
    expect(h.requestRender).toHaveBeenCalledTimes(1); // consumed key → defensive repaint
    expect(h.onKeystroke).toHaveBeenCalledTimes(1); // the S1 clock tick, once
  });

  it("highlightIndex selects the item (index 1 → zephyr) and DISPLAY casing is inserted, not the typed casing", () => {
    const h = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 });
    h.show(["Zendesk", "zephyr"]);
    h.state.highlightIndex = 1; // plain mutation — the T3 highlight field

    h.press("\t");

    expect(h.calls).toEqual([`setText:${JSON.stringify("zephyr")}`, "caret:6"]);
    // Typed fragment was lowercase "ze"; the insert is the display string.
    expect(h.buf.lines).toEqual(["zephyr"]);
  });

  it("trigger span: 'foo #ze' → 'foo Zendesk' — the trigger char is consumed together with the fragment", () => {
    const h = makeInsertHarness({ lines: ["foo #ze"], line: 0, col: 7 });
    h.show(["Zendesk"]);

    h.press("\t");

    expect(h.calls).toEqual([
      `setText:${JSON.stringify("foo Zendesk")}`,
      "caret:11", // spanStart 4 + display 7
    ]);
    expect(h.buf.lines).toEqual(["foo Zendesk"]);
    expect(h.innerCalls).toEqual([]);
  });

  it("hyphenated word span: 'load-b' is replaced WHOLESALE with 'load-balancer' (no restart at the hyphen)", () => {
    const h = makeInsertHarness({ lines: ["load-b"], line: 0, col: 6 });
    h.show(["load-balancer"]);

    h.press("\t");

    expect(h.calls).toEqual([
      `setText:${JSON.stringify("load-balancer")}`,
      "caret:13",
    ]);
    expect(h.buf.lines).toEqual(["load-balancer"]);
  });

  it("bare '#' (zero-length trigger fragment) inserts the top candidate, replacing just the trigger char", () => {
    const h = makeInsertHarness({ lines: ["#"], line: 0, col: 1 });
    h.show(["Zendesk", "zephyr"]);

    h.press("\t");

    expect(h.calls).toEqual([`setText:${JSON.stringify("Zendesk")}`, "caret:7"]);
    expect(h.buf.lines).toEqual(["Zendesk"]);
  });

  it("synchronous: the insert lands with ZERO timer advancement — never debounce-gated (fake timers)", () => {
    vi.useFakeTimers();
    try {
      const h = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 });
      h.show(["Zendesk"]);

      h.press("\t"); // asserted BEFORE any timer advancement

      expect(h.buf.lines).toEqual(["Zendesk"]);
      expect(h.calls).toEqual([`setText:${JSON.stringify("Zendesk")}`, "caret:7"]);
      vi.advanceTimersByTime(5000); // no delayed work can add a second insert
      expect(h.calls).toEqual([`setText:${JSON.stringify("Zendesk")}`, "caret:7"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Tab NEVER opens or toggles anything: the only inner interactions are setText + caret (no delegation, no autocomplete surface — structurally absent on this path)", () => {
    const h = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 });
    h.show(["Zendesk"]);

    h.press("\t");

    // No `inner:` entry at all — the key never reached the inner editor,
    // and the widget layer holds no provider/menu seam to summon (h2.42:
    // no autocomplete provider is registered on the widget path).
    expect(h.calls.every((c) => c.startsWith("setText:") || c.startsWith("caret:"))).toBe(
      true,
    );
    expect(h.innerCalls).toEqual([]);
  });

  it("setCursorCol absent on the inner → insert still succeeds, caret degrades to buffer end, no throw", () => {
    const h = makeInsertHarness({ lines: ["ze"], line: 0, col: 2, noCaret: true });
    h.show(["Zendesk"]);

    expect(() => h.press("\t")).not.toThrow();

    expect(h.calls).toEqual([`setText:${JSON.stringify("Zendesk")}`]); // no caret entry
    expect(h.buf.lines).toEqual(["Zendesk"]);
    expect(h.state.hidden).toBe(true); // still a full acceptance
    expect(h.machine.getState().suppressUntilWordStart).toBe(true);
    expect(h.innerCalls).toEqual([]);
  });

  it("no span under the cursor (trailing space) → Tab forwards verbatim, exactly once (never-hijack fallback)", async () => {
    const h = makeInsertHarness({ lines: ["foo "], line: 0, col: 4 });
    h.show(["Zendesk"]); // visible + non-empty, but nothing to replace

    const out = h.press("\t");

    expect(out).toBe("inner:\t"); // literal Tab passed through
    expect(h.innerCalls).toEqual(["\t"]);
    expect(h.calls).toEqual(["inner:\"\\t\""]); // no setText/caret attempted
    // The forward ticks the machine (post-keystroke, microtask), whose
    // gate-held close HIDES the line — but that is a disqualification-style
    // close, never an acceptance: no suppression.
    await Promise.resolve(); // W1 fix: visibility evaluates post-keystroke (microtask)
    expect(h.state.hidden).toBe(true);
    expect(h.machine.getState().suppressUntilWordStart).toBe(false);
  });

  it("Tab with an EMPTY list forwards verbatim exactly once; Tab while HIDDEN forwards verbatim exactly once", async () => {
    const empty = makeInsertHarness();
    empty.show([]); // visible flag, zero candidates — nothing is captured
    expect(empty.press("\t")).toBe("inner:\t");
    await Promise.resolve(); // W1 fix: let the deferred machine tick settle
    expect(empty.innerCalls).toEqual(["\t"]);

    const hidden = makeInsertHarness(); // fresh editors start hidden
    expect(hidden.press("\t")).toBe("inner:\t");
    await Promise.resolve(); // W1 fix: let the deferred machine tick settle
    expect(hidden.innerCalls).toEqual(["\t"]);
    expect(hidden.state.hidden).toBe(true); // hiding state untouched
  });

  it("never-mutate: zero set-trap hits across a full Tab-insert + Enter scenario (v1 crash regression)", () => {
    const h = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 });
    h.show(["Zendesk", "zephyr"]);
    h.press(RIGHT); // navigate (consumed)
    h.press("\t"); // insert (consumed, accepted)
    h.show(["alpha", "beta"]); // re-show via the seam
    h.press("\r"); // Enter dismiss-then-forward
    h.press("x"); // forwarded text (the machine closes the line)
    (h.editor.render as (w: number) => string[])(40);
    expect(h.setHits()).toBe(0); // the inner instance was NEVER written to
    expect(h.innerCalls).toEqual(["\r", "x"]); // only the forwarded keys
  });
});

describe("widget key handling — Enter dismiss-then-forward (spec §07 h2.48, S2)", () => {
  it("Enter while visible: dismiss + suppress recorded FIRST, then forwarded EXACTLY once so the inner editor submits", () => {
    const h = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 });
    h.show(["Zendesk", "zephyr"]);
    // Ordering proof: the machine's dismissal seam and the inner's
    // handleInput both log into h.calls — dismissal must come first.
    const realDismissed = h.machine.onDismissed.bind(h.machine);
    h.machine.onDismissed = (explicit: boolean): void => {
      h.calls.push(`dismissed:${explicit}`);
      realDismissed(explicit);
    };

    const out = h.press("\r");

    expect(out).toBe("inner:\r"); // the submit flow's return value passes through
    expect(h.calls[0]).toBe("dismissed:true"); // dismissal PRECEDES the inner call
    expect(h.calls[1]).toBe("inner:\"\\r\"");
    expect(h.calls).toHaveLength(2); // exactly one delegation, nothing else
    expect(h.innerCalls).toEqual(["\r"]); // the inner editor submits, once
    expect(h.state.hidden).toBe(true); // the line is gone…
    expect(h.machine.getState().suppressUntilWordStart).toBe(true); // …until the next word start
  });

  it("Enter while hidden forwards verbatim with NO dismissal and NO suppression (S1 regression)", async () => {
    const h = makeInsertHarness(); // starts hidden
    h.press("\r");
    await Promise.resolve(); // W1 fix: let the deferred machine tick settle
    expect(h.innerCalls).toEqual(["\r"]);
    expect(h.machine.getState().suppressUntilWordStart).toBe(false);
    expect(h.state.hidden).toBe(true);
  });

  it("Enter with an EMPTY list is plain forward (zero candidates never capture)", () => {
    const h = makeInsertHarness();
    h.show([]);
    h.press("\r");
    expect(h.innerCalls).toEqual(["\r"]);
    expect(h.machine.getState().suppressUntilWordStart).toBe(false);
  });

  it("consumed-and-forwarded keys each tick the shared clock exactly once (Tab insert = widget layer, Enter = guard seam)", () => {
    const h = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 });
    h.show(["Zendesk", "zephyr"]);
    h.press("\t"); // consumed insert → the widget layer's single tick
    expect(h.onKeystroke).toHaveBeenCalledTimes(1);
    h.press("\r"); // forwarded → the guard's clock seam, once
    expect(h.onKeystroke).toHaveBeenCalledTimes(2);
  });
});

describe("widget key handling — never-mutate pin (v1 recursion-crash regression)", () => {
  it("zero set-trap hits across a full scenario: navigate, clamp, forward, re-show, Esc, boundary-Esc, render", () => {
    const h = makeKeyHarness();
    h.show(["alpha", "beta", "gamma"]);
    h.press(RIGHT);
    h.press(LEFT);
    h.press(DOWN); // clamp
    h.press("x"); // forward (the machine closes the line)
    h.show(["Zendesk", "zephyr"]); // re-show via the seam
    h.press(ESC); // dismiss + suppress
    h.show(["alpha"]);
    h.press(UP); // boundary-Esc
    (h.editor.render as (w: number) => string[])(40);
    expect(h.setHits()).toBe(0); // the inner instance was NEVER written to
    expect(h.innerCalls.length).toBeGreaterThan(0); // and forwarding lived
  });
});

describe("decideWidgetKey — pure decision table (no editor access)", () => {
  it("hidden → forward; visible-but-empty → forward (arrows, Escape, Tab, Enter included)", () => {
    for (const key of [UP, DOWN, LEFT, RIGHT, ESC, "a", "\t", "\r"]) {
      expect(decideWidgetKey(key, false, 3, 0), `hidden ${JSON.stringify(key)}`).toEqual({
        action: "forward",
      });
      expect(decideWidgetKey(key, true, 0, 0), `empty ${JSON.stringify(key)}`).toEqual({
        action: "forward",
      });
    }
  });

  it("up/left walk left (boundary-esc at index 0); down/right walk right (clamp at count-1)", () => {
    expect(decideWidgetKey(LEFT, true, 3, 2)).toEqual({ action: "navigate", delta: -1 });
    expect(decideWidgetKey(UP, true, 3, 2)).toEqual({ action: "navigate", delta: -1 });
    expect(decideWidgetKey(LEFT, true, 3, 1)).toEqual({ action: "navigate", delta: -1 });
    expect(decideWidgetKey(UP, true, 3, 0)).toEqual({ action: "boundary-esc" });
    expect(decideWidgetKey(LEFT, true, 3, 0)).toEqual({ action: "boundary-esc" });
    expect(decideWidgetKey(RIGHT, true, 3, 0)).toEqual({ action: "navigate", delta: 1 });
    expect(decideWidgetKey(DOWN, true, 3, 1)).toEqual({ action: "navigate", delta: 1 });
    expect(decideWidgetKey(RIGHT, true, 3, 2)).toEqual({ action: "clamp" });
    expect(decideWidgetKey(DOWN, true, 3, 2)).toEqual({ action: "clamp" });
  });

  it("Escape → escape from any index", () => {
    for (const i of [0, 1, 5]) {
      expect(decideWidgetKey(ESC, true, 3, i)).toEqual({ action: "escape" });
    }
  });

  it("Tab → tab-insert and Enter → enter-submit while visible+non-empty (S2)", () => {
    expect(decideWidgetKey("\t", true, 3, 1)).toEqual({ action: "tab-insert" });
    // No keybindings → isSubmitKey's raw "\r" fallback decides.
    expect(decideWidgetKey("\r", true, 3, 1)).toEqual({ action: "enter-submit" });
    // With a keybindings stub: same decision via the shared submit test.
    expect(
      decideWidgetKey("\r", true, 3, 1, {
        matches: (data, action) => action === "tui.input.submit" && data === "\r",
      }),
    ).toEqual({ action: "enter-submit" });
  });

  it("custom submit bindings route through isSubmitKey — rebound submit decides enter-submit, plain Enter does not", () => {
    const ctrlJ = {
      matches: (data: string, action: string) =>
        action === "tui.input.submit" && data === "\x0a",
    };
    expect(decideWidgetKey("\x0a", true, 3, 1, ctrlJ)).toEqual({ action: "enter-submit" });
    expect(decideWidgetKey("\r", true, 3, 1, ctrlJ)).toEqual({ action: "forward" });
  });

  it("everything else forwards — text, space, backspace, Ctrl-chars, other ANSI sequences", () => {
    for (const key of ["a", " ", "\x7f", "\x03", "\x1b[H", "\x1b[5~"]) {
      expect(decideWidgetKey(key, true, 3, 1), `key ${JSON.stringify(key)}`).toEqual({
        action: "forward",
      });
    }
  });

  it("a stale highlightIndex clamps into [0, count-1] BEFORE the boundary checks", () => {
    expect(decideWidgetKey(DOWN, true, 3, 99)).toEqual({ action: "clamp" }); // 99 → 2 = last
    expect(decideWidgetKey(UP, true, 3, 99)).toEqual({ action: "navigate", delta: -1 });
    expect(decideWidgetKey(UP, true, 3, -5)).toEqual({ action: "boundary-esc" }); // -5 → 0 = first
    expect(decideWidgetKey(DOWN, true, 3, -5)).toEqual({ action: "navigate", delta: 1 });
  });

  it("single-item list: up/left boundary-esc, down/right clamp", () => {
    expect(decideWidgetKey(UP, true, 1, 0)).toEqual({ action: "boundary-esc" });
    expect(decideWidgetKey(LEFT, true, 1, 0)).toEqual({ action: "boundary-esc" });
    expect(decideWidgetKey(DOWN, true, 1, 0)).toEqual({ action: "clamp" });
    expect(decideWidgetKey(RIGHT, true, 1, 0)).toEqual({ action: "clamp" });
  });
});

// ── chain arming on consumed Tab accepts — classification matrix (BUG-001 fix pin) ──

// CONTRACT (BUG-001 fix, P1.M1.T1.S2; mirrors provider.ts's
// applyCompletion classification): a consumed Tab acceptance arms
// opts.chain at the accepted record's STORE KEY — whole-word,
// trigger-span, and (P1.M1.T2) chain-successor accepts all arm, while
// tier-0 anchorless records never arm (strict `tier !== 0` skip),
// `enableChaining: false` never arms, and every FORWARDED Tab (span
// miss, hidden line, empty list) never arms. Arming lives at the widget
// tab-insert call site (src/pi/widget.ts): the accepted record is
// captured from machine.painted() BEFORE the insert (insertHighlighted's
// success path hides the line, and hide() clears painted()), so every
// arming case below PAINTS THROUGH THE REAL MACHINE — a real
// CandidateStore seeded via seedStore, a forwarded keystroke, and a
// microtask flush. NEVER drive an arming case with h.show(): state.set()
// bypasses paint(), leaving painted() empty ⇒ vacuously never-arming
// (the one trap that would make this suite green while BUG-001 recurs).
// The Tab press itself and its assertions stay SYNCHRONOUS (the insert
// is never debounce-gated — pinned in the S2 block above); only the
// paint flush awaits microtasks. Successor-OFFER rendering after an arm
// is P1.M1.T2 scope — not pinned here.

/** Recording ChainMachine double — arm calls are the assertion surface. */
const spiedChain = (): ChainMachine & { arm: Mock } => ({
  state: vi.fn(() => null),
  arm: vi.fn(),
  reset: vi.fn(),
}) as ChainMachine & { arm: Mock };

/** A REAL CandidateStore seeded via upsert (ordinal: currentOrdinal+1
 *  per entry) — the machine's default query (rankMatches) reads this, so
 *  painted records carry real key/tier/display triples instead of the
 *  display-only stubs state.set would hold. */
const seedStore = (entries: readonly (readonly [string, string])[]): CandidateStore => {
  const s = new CandidateStore();
  for (const [key, display] of entries) {
    s.upsert({
      key,
      display,
      ordinal: s.currentOrdinal() + 1,
      fromUser: false,
      properName: false,
      rankGroup: 0,
      isSubword: false,
    });
  }
  return s;
};

/** Flush the W1 deferred visibility tick: the widget queues the machine's
 *  onInput evaluation as a MICROTASK (so it reads the post-keystroke
 *  buffer), and restoreReady = Promise.resolve() settles the R2 startup
 *  gate on the first turn — a few microtask turns guarantee the paint has
 *  landed without touching any timer. */
const flushPaint = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("widget Tab acceptance arms the chain — classification matrix (BUG-001 fix pin)", () => {
  it("(a) consumed Tab acceptance of a word candidate arms the chain EXACTLY ONCE at the STORE key — and the edit still lands", async () => {
    const chain = spiedChain();
    const h = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 }, {
      chain,
      store: seedStore([["zendesk", "Zendesk"]]),
    });

    h.press("x"); // forwarded text event ticks the machine (W1: reads the live buffer "ze")
    await flushPaint();

    // Fixture sanity — the case is about THIS record being armed:
    const rec = h.machine.painted()[0];
    expect(rec?.key).toBe("zendesk");
    expect(rec?.display).toBe("Zendesk");
    expect(rec?.tier).toBe(3); // exact-prefix word record (never the tier-0 diagnostic)

    h.innerCalls.length = 0; // drop the tick keystroke — the Tab's own consumption is asserted below
    h.press("\t"); // consumed acceptance — synchronous, no timer advancement

    // KEY-VERBATIM (provider.ts's documented rule-4d trap): arm gets the
    // STORE key ("zendesk" — the trimmed-lowercase form), never a
    // lowercased display; path keys keep that trimmed-lowercase form
    // while displays keep their edge slashes, so a display-derived key
    // would miss the successor index.
    expect(chain.arm).toHaveBeenCalledTimes(1);
    expect((chain.arm as Mock).mock.calls[0]![0]).toBe("zendesk");
    expect(h.buf.lines).toEqual(["Zendesk"]); // arming never displaces the insert
    expect(h.state.hidden).toBe(true); // consumed → dismissed
    expect(h.innerCalls).toEqual([]); // consumed — the inner editor never saw the Tab
  });

  it("(b) tier-0 anchorless accept NEVER arms — the insert lands, the arm is strictly skipped", async () => {
    const chain = spiedChain();
    // Trigger-mode loose pass, zero anchored results: 'd' anchors nothing
    // in "zendesk" (the anchored scan enters the 'd' first-char bucket),
    // so the unconditional trigger loose pass rescues it as tier 0
    // (indexOf 4, score 85 − 40·4/7 ≈ 62 ≥ 45 — spec §04 h2.28).
    const h = makeInsertHarness({ lines: ["#desk"], line: 0, col: 5 }, {
      chain,
      store: seedStore([["zendesk", "Zendesk"]]),
    });

    h.press("x");
    await flushPaint();

    // Fixture sanity — MUST be the tier-0 anchorless diagnostic. If this
    // ever fails because the loose-mode shape changed, fix the FIXTURE
    // (per the research recipe) — never let the case silently degrade to
    // a forwarded-Tab case.
    const rec = h.machine.painted()[0];
    expect(rec?.key).toBe("zendesk");
    expect(rec?.tier).toBe(0);

    h.innerCalls.length = 0; // drop the tick keystroke — assert the Tab's consumption below
    h.press("\t"); // consumed accept of a tier-0 record

    expect(h.buf.lines).toEqual(["Zendesk"]); // the accept landed…
    expect(h.state.hidden).toBe(true);
    expect(h.innerCalls).toEqual([]); // …was fully consumed…
    expect(chain.arm).not.toHaveBeenCalled(); // …but tier-0 never arms (spec §04)
  });

  it("(c) trigger-span acceptance arms at the word key (whole-word insertion)", async () => {
    const chain = spiedChain();
    const h = makeInsertHarness({ lines: ["foo #ze"], line: 0, col: 7 }, {
      chain,
      store: seedStore([["zendesk", "Zendesk"]]),
    });

    h.press("x"); // forwarded event ticks the machine: trigger fragment "ze"
    await flushPaint();

    // Fixture sanity — trigger-mode paint of the anchored prefix record:
    const rec = h.machine.painted()[0];
    expect(rec?.key).toBe("zendesk");
    expect(rec?.tier).toBe(3);

    h.innerCalls.length = 0; // drop the tick keystroke — assert the Tab's consumption below
    h.press("\t"); // consumed: span "#ze" → "Zendesk"

    expect(h.buf.lines).toEqual(["foo Zendesk"]); // trigger char consumed with the fragment
    expect(chain.arm).toHaveBeenCalledTimes(1);
    expect((chain.arm as Mock).mock.calls[0]![0]).toBe("zendesk"); // STORE key
    expect(h.state.hidden).toBe(true);
    expect(h.innerCalls).toEqual([]);
  });

  it("(d) forwarded Tab NEVER arms — visible span-miss, hidden, and empty variants", async () => {
    // Visible span-miss, machine-painted for consistency: the line is
    // LIVE with real records, but the caret has no word/#span under it —
    // insertHighlighted returns false ⇒ forward ⇒ never arms.
    const miss = spiedChain();
    const hMiss = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 }, {
      chain: miss,
      store: seedStore([["zendesk", "Zendesk"]]),
    });
    hMiss.press("x");
    await flushPaint();
    expect(hMiss.state.hidden).toBe(false); // sanity: the line IS live…
    expect(hMiss.machine.painted().length).toBeGreaterThan(0); // …with real records
    hMiss.buf.lines = ["foo "]; // the caret now sits after a space — no span
    hMiss.buf.col = 4;
    hMiss.innerCalls.length = 0; // drop the tick keystroke — assert the Tab's forward below
    expect(hMiss.press("\t")).toBe("inner:\t"); // forwarded verbatim
    expect(hMiss.innerCalls).toEqual(["\t"]); // exactly once
    await flushPaint(); // the forward's deferred tick closes the line
    expect(hMiss.state.hidden).toBe(true);
    expect(miss.arm).not.toHaveBeenCalled();

    // Hidden variant: nothing painted ⇒ the Tab forwards, never arms.
    const hidden = spiedChain();
    const hHidden = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 }, {
      chain: hidden,
      store: seedStore([["zendesk", "Zendesk"]]),
    });
    expect(hHidden.press("\t")).toBe("inner:\t");
    await flushPaint();
    expect(hHidden.innerCalls).toEqual(["\t"]);
    expect(hidden.arm).not.toHaveBeenCalled();

    // Empty variant (show([]) shape — valid here: a never-arm case needs
    // no painted records, and state.set cannot arm anything).
    const empty = spiedChain();
    const hEmpty = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 }, {
      chain: empty,
      store: seedStore([["zendesk", "Zendesk"]]),
    });
    hEmpty.show([]);
    expect(hEmpty.press("\t")).toBe("inner:\t");
    await flushPaint();
    expect(hEmpty.innerCalls).toEqual(["\t"]);
    expect(empty.arm).not.toHaveBeenCalled();
  });

  it("(e) enableChaining:false NEVER arms — consumed word completion is byte-identical and the chain stays idle", async () => {
    const chain = spiedChain();
    const h = makeInsertHarness({ lines: ["ze"], line: 0, col: 2 }, {
      chain,
      store: seedStore([["zendesk", "Zendesk"]]),
      config: cfg({ enableChaining: false }),
    });

    h.press("x");
    await flushPaint();

    // Fixture sanity — identical fixture to (a): the record is really
    // painted and armable; only the config gate differs.
    const rec = h.machine.painted()[0];
    expect(rec?.key).toBe("zendesk");
    expect(rec?.tier).toBe(3);

    h.innerCalls.length = 0; // drop the tick keystroke — assert the Tab's consumption below
    h.press("\t"); // consumed acceptance — M1 word-only behavior

    expect(h.buf.lines).toEqual(["Zendesk"]); // completion unchanged
    expect(h.state.hidden).toBe(true);
    expect(h.innerCalls).toEqual([]);
    expect(chain.arm).not.toHaveBeenCalled(); // gated off — never arms
    expect(chain.state()).toBeNull(); // the chain machine stays idle
  });
});

describe("widget chain offers render + re-arm (BUG-001 fix, P1.M1.T2.S1 consult branch)", () => {
  it("armed chain: the empty-word-start tick paints the successor offer on the widget line; Tab accepts it with ZERO typed chars and re-arms at the successor key", async () => {
    const chain = spiedChain();
    // Pre-armed (T1.S1/S2 own arming — pinned in the matrix above); this
    // case is the CONSULT half: the visibility machine must offer the
    // armed word's successors and the Tab accept must re-arm downstream.
    chain.state = vi.fn(() => ({ word: "zorpwibble" }));
    const store = seedStore([
      ["zorpwibble", "zorpwibble"],
      ["quuxblat", "Quuxblat"],
    ]);
    store.recordBigramRuns([["zorpwibble", "quuxblat"]]);
    store.recordBigramRuns([["zorpwibble", "quuxblat"]]);
    const h = makeInsertHarness({ lines: ["zorpwibble "], line: 0, col: 11 }, {
      chain,
      store,
    });

    h.press("x"); // forwarded event ticks the machine (W1: reads the live buffer)
    await flushPaint();

    // The consult branch painted the successor offer through paint():
    expect(h.machine.getState().visible).toBe(true); // the widget line is live…
    expect(h.machine.getState().currentSet.map((i) => i.display)).toEqual([
      "Quuxblat",
    ]); // …with the successor offer
    const rec = h.machine.painted()[0]!;
    expect(rec.key).toBe("quuxblat"); // PLAIN store key — no chain prefix
    expect(rec.tier).toBeUndefined(); // shims OMIT tier → the accept re-arms
    expect(rec.description).toBe("chain"); // provenance marker

    h.innerCalls.length = 0; // drop the tick keystroke — assert the Tab below
    h.press("\t"); // consumed acceptance at ZERO typed chars
    expect(h.buf.lines).toEqual(["zorpwibble Quuxblat"]); // inserted at the cursor
    expect(h.state.hidden).toBe(true); // consumed → dismissed
    expect(h.innerCalls).toEqual([]); // fully consumed
    // Re-arm seam: the painted() record (plain key, tier undefined) fed
    // the tab-insert arming gate → armed at the SUCCESSOR's key.
    expect(chain.arm).toHaveBeenCalledTimes(1);
    expect((chain.arm as Mock).mock.calls[0]![0]).toBe("quuxblat");
  });

  it("armed chain + typed fragment 'qu' on the widget line: Tab completes the filtered successor over the typed span", async () => {
    const chain = spiedChain();
    chain.state = vi.fn(() => ({ word: "zorpwibble" }));
    const store = seedStore([
      ["zorpwibble", "zorpwibble"],
      ["quuxblat", "Quuxblat"],
      ["deltaword", "deltaword"],
    ]);
    store.recordBigramRuns([["zorpwibble", "quuxblat"]]);
    store.recordBigramRuns([["zorpwibble", "deltaword"]]);
    const h = makeInsertHarness(
      { lines: ["zorpwibble qu"], line: 0, col: 13 },
      { chain, store },
    );

    h.press("x");
    await flushPaint();

    // Fragment filter at threshold 0: quuxblat matches 'qu', deltaword does not.
    expect(h.machine.getState().currentSet.map((i) => i.display)).toEqual([
      "Quuxblat",
    ]);
    h.innerCalls.length = 0;
    h.press("\t"); // the word span "qu" exists → the NORMAL span path inserts
    expect(h.buf.lines).toEqual(["zorpwibble Quuxblat"]);
    expect((chain.arm as Mock).mock.calls[0]![0]).toBe("quuxblat");
  });
});
