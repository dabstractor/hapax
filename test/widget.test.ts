/**
 * Widget line rendering suite (spec §07 h3.8, plan 003 P1.M3.T1.S2) —
 * join format, caps (maxSuggestions AND cached render(width)), overflow
 * dropping the RIGHTMOST (lowest-ranked) items, accent highlight on the
 * leftmost (reset on every set), display-strings-only output, zero-
 * never (invariant 3: structurally absent, never a blank line), width
 * caching/re-fit, and the never-mutate/forwarding pins over the
 * composed proxy editor (patterns from test/editor-enter.test.ts).
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
import {
  createWidgetEditorFactory,
  isWidgetWrapper,
  renderWidgetLine,
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
