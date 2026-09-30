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
 * 2. Key handling (spec §07 h3.9, plan 003 P1.M3.T3.S1): while the
 *    line is visible the composed handleInput consumes ←/→/↑/↓
 *    (navigate; up≡left, down≡right), ↑/← on the FIRST word
 *    (boundary-Esc: consumed + hidden + suppressed), →/↓ on the LAST
 *    word (clamp: consumed, no movement) and Escape (dismiss +
 *    suppress); every other key — Tab/Enter included until S2 — and
 *    EVERY key while hidden forwards verbatim, exactly once. The pure
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

import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { HapaxConfig } from "../src/pi/config.js";
import type { CandidateStore } from "../src/core/store.js";
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

  it("a close WITHOUT explicit dismissal (forwarded key → machine closes) never suppresses; onDismissed(false) neither", () => {
    const h = makeKeyHarness();
    h.show(["alpha", "beta"]);
    h.press("x"); // forwarded verbatim → the machine ticks, no fragment → closes
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
  it("hidden → forward; visible-but-empty → forward (arrows and Escape included)", () => {
    for (const key of [UP, DOWN, LEFT, RIGHT, ESC, "a"]) {
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

  it("everything else forwards — Tab, Enter, text, space, backspace, Ctrl-chars, other ANSI sequences", () => {
    for (const key of ["\t", "\r", "a", " ", "\x7f", "\x03", "\x1b[H", "\x1b[5~"]) {
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
