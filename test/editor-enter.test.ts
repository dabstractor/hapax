/**
 * Enter-submits guard (src/pi/editor.ts, v2 proxy composition) — unit
 * tests over a duck-typed inner editor: Enter while a non-slash menu is
 * open cancels the menu then delegates exactly once; every other
 * combination is pure pass-through; the inner instance is NEVER
 * mutated (the v1 recursion crash); proxy forwarding (get/set/has,
 * thenable guard) is pinned.
 *
 * Widget-layer doubles (plan 003 P1.M3.T3.S2): the SAME guard semantics
 * are re-pinned UNDER the widget composition (createWidgetEditorFactory
 * around createEnterSubmitEditor) — the widget adds its dismiss-then-
 * forward Enter step, it never replaces the guard; the thenable guard
 * holds on both proxy layers; the input clock fires for EVERY event
 * (consumed keys included); a throwing clock never breaks input; and
 * the never-mutate pin stays at zero hits through the whole stack.
 */
import { describe, expect, it, vi } from "vitest";

import {
  createEnterSubmitEditor,
  isEnterSubmitWrapper,
  wrapEditorFactory,
  type EditorLike,
  type KeybindingsLike,
} from "../src/pi/editor.js";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import type { CandidateStore } from "../src/core/store.js";
import type { ChainMachine } from "../src/pi/provider.js";
import {
  createWidgetEditorFactory,
  widgetMachineOf,
  widgetStateOf,
  type WidgetState,
} from "../src/pi/widget.js";

/** Keybindings stub: Enter (\r) is the only submit key. */
const kb: KeybindingsLike = {
  matches: (data, action) => action === "tui.input.submit" && data === "\r",
};

/** Inner editor recording calls; menu state toggled per test. */
const fakeInner = (over: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const e = {
    calls,
    menuOpen: false,
    prefix: "",
    isShowingAutocomplete: function (this: { menuOpen: boolean }) {
      return this.menuOpen;
    },
    cancelAutocomplete: function (this: { calls: string[]; menuOpen: boolean }) {
      this.menuOpen = false;
      this.calls.push("cancel");
    },
    autocompletePrefix: "",
    handleInput: function (this: { calls: string[] }, data: string) {
      this.calls.push(`inner:${data}`);
      return "inner-return";
    },
    getText: function () {
      return "text";
    },
    ...over,
  } as unknown as EditorLike & { calls: string[]; menuOpen: boolean; prefix: string };
  Object.defineProperty(e, "autocompletePrefix", {
    get() {
      return e.prefix;
    },
  });
  return e;
};

describe("createEnterSubmitEditor — guard semantics", () => {
  it("Enter + open word menu → cancel FIRST, then inner handles the same key", () => {
    const inner = fakeInner();
    inner.menuOpen = true;
    inner.prefix = "zep";
    const editor = createEnterSubmitEditor(inner, kb);

    const out = editor.handleInput("\r");

    expect(out).toBe("inner-return"); // delegation return value passes through
    expect(inner.calls).toEqual(["cancel", "inner:\r"]); // order is the contract
  });

  it("Enter + open SLASH menu → untouched (stock accept-and-submit stands)", () => {
    const inner = fakeInner();
    inner.menuOpen = true;
    inner.prefix = "/mod";
    createEnterSubmitEditor(inner, kb).handleInput("\r");
    expect(inner.calls).toEqual(["inner:\r"]);
  });

  it("Enter + NO menu open → untouched", () => {
    const inner = fakeInner();
    createEnterSubmitEditor(inner, kb).handleInput("\r");
    expect(inner.calls).toEqual(["inner:\r"]);
  });

  it("non-submit keys are untouched even with a menu open (Tab, arrows, text, Esc)", () => {
    for (const key of ["\t", "\x1b[A", "\x1b[B", "z", "\x1b"]) {
      const inner = fakeInner();
      inner.menuOpen = true;
      inner.prefix = "z";
      createEnterSubmitEditor(inner, kb).handleInput(key);
      expect(inner.calls, `key ${JSON.stringify(key)}`).toEqual([`inner:${key}`]);
    }
  });

  it("a rebound submit key is honored via keybindings.matches (ctrl+j as submit)", () => {
    const customKb: KeybindingsLike = {
      matches: (data, action) => action === "tui.input.submit" && data === "\x0a",
    };
    const inner = fakeInner();
    inner.menuOpen = true;
    inner.prefix = "zep";
    const editor = createEnterSubmitEditor(inner, customKb);
    editor.handleInput("\x0a");
    expect(inner.calls).toEqual(["cancel", "inner:\x0a"]);

    const inner2 = fakeInner();
    inner2.menuOpen = true;
    inner2.prefix = "zep";
    const editor2 = createEnterSubmitEditor(inner2, customKb);
    editor2.handleInput("\r"); // plain Enter is NOT submit under this binding
    expect(inner2.calls).toEqual(["inner:\r"]);
  });

  it("no keybindings → raw '\\r' fallback still intercepts", () => {
    const inner = fakeInner();
    inner.menuOpen = true;
    inner.prefix = "zep";
    createEnterSubmitEditor(inner).handleInput("\r");
    expect(inner.calls).toEqual(["cancel", "inner:\r"]);
  });
});

describe("createEnterSubmitEditor — v2 regression pins (recursion crash)", () => {
  it("the inner instance is NEVER mutated (handleInput stays the inner's own)", () => {
    const inner = fakeInner();
    const ownBefore = Object.getOwnPropertyDescriptor(inner, "handleInput");
    createEnterSubmitEditor(inner, kb);
    expect(Object.getOwnPropertyDescriptor(inner, "handleInput")).toEqual(ownBefore);
    expect(inner.handleInput).toBe((inner as any).handleInput);
  });

  it("dynamic forwarders cannot re-enter: a sibling-style inner that re-reads its own handleInput terminates", () => {
    // Simulates split-editor's dynamic `this.inner.handleInput?.(data)`
    // forwarding: the inner's method re-reads handleInput on itself.
    // Under v1 (instance mutation) this looped forever; under the proxy
    // the inner's property is untouched, so the re-read terminates.
    const seen: string[] = [];
    const inner = {
      menuOpen: false,
      prefix: "",
      isShowingAutocomplete: () => false,
      cancelAutocomplete: () => {},
      autocompletePrefix: "",
      handleInput(data: string) {
        seen.push(data);
        if (data === "\r") {
          // dynamic self-forward, exactly the shape that cyc'd in v1
          (this as { handleInput: (d: string) => void }).handleInput?.("forwarded");
        }
        return "ok";
      },
    } as unknown as EditorLike & { handleInput: (d: string) => unknown };
    const editor = createEnterSubmitEditor(inner, kb);
    expect(() => editor.handleInput("\r")).not.toThrow();
    expect(seen).toEqual(["\r", "forwarded"]); // inner loop is the inner's own business
  });

  it("delegation is exactly ONE call per keystroke", () => {
    const inner = fakeInner();
    const spy = vi.fn(inner.handleInput);
    (inner as { handleInput: unknown }).handleInput = spy;
    inner.menuOpen = true;
    inner.prefix = "zep";
    createEnterSubmitEditor(inner, kb).handleInput("\r");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual(["\r"]);
  });
});

describe("createEnterSubmitEditor — proxy forwarding", () => {
  it("forwards gets to inner (methods bound, values verbatim)", () => {
    const inner = fakeInner();
    const editor = createEnterSubmitEditor(inner, kb) as unknown as { getText(): string };
    expect(editor.getText()).toBe("text");
    expect((editor as unknown as { prefix: string }).prefix).toBe("");
  });

  it("forwards sets to inner (the app assigns onSubmit/onChange this way)", () => {
    const inner = fakeInner();
    const editor = createEnterSubmitEditor(inner, kb) as unknown as Record<string, unknown>;
    editor.onSubmit = () => "submitted";
    expect(typeof (inner as unknown as Record<string, unknown>).onSubmit).toBe("function");
    expect(
      ((inner as unknown as Record<PropertyKey, unknown>).onSubmit as () => string)(),
    ).toBe("submitted");
  });

  it("forwards has", () => {
    const inner = fakeInner();
    const editor = createEnterSubmitEditor(inner, kb);
    expect("getText" in (editor as unknown as object)).toBe(true);
    expect("nope" in (editor as unknown as object)).toBe(false);
  });

  it("never looks like a thenable (await-safety)", () => {
    const editor = createEnterSubmitEditor(fakeInner(), kb) as unknown as { then?: unknown };
    expect(editor.then).toBeUndefined();
  });

  it("onKeystroke hook fires for EVERY input event, before delegation (the input clock seam)", () => {
    const ticks: number[] = [];
    const inner = fakeInner();
    const editor = createEnterSubmitEditor(inner, kb, () => ticks.push(Date.now()));
    for (const key of ["z", "e", "\r", "\t", "\x1b[A"]) {
      editor.handleInput(key);
    }
    expect(ticks).toHaveLength(5); // every key, including Enter/Tab/arrows
    expect(inner.calls).toEqual(["inner:z", "inner:e", "inner:\r", "inner:\t", "inner:\x1b[A"]);
  });

  it("a throwing onKeystroke never breaks input", () => {
    const inner = fakeInner();
    const editor = createEnterSubmitEditor(inner, kb, () => {
      throw new Error("clock boom");
    });
    expect(() => editor.handleInput("z")).not.toThrow();
    expect(inner.calls).toEqual(["inner:z"]);
  });

  it("missing menu helpers on inner → pure pass-through, no throw", () => {
    const inner = {
      handleInput: (d: string) => d,
    } as unknown as EditorLike;
    const editor = createEnterSubmitEditor(inner, kb);
    expect(editor.handleInput("\r")).toBe("\r");
  });

  it("a throwing isShowingAutocomplete never breaks the keypress", () => {
    const inner = fakeInner({
      isShowingAutocomplete: () => {
        throw new Error("boom");
      },
    });
    inner.menuOpen = true;
    inner.prefix = "zep";
    const editor = createEnterSubmitEditor(inner, kb);
    expect(() => editor.handleInput("\r")).not.toThrow();
    expect(inner.calls).toEqual(["inner:\r"]); // guard inert, input intact
  });
});

describe("wrapEditorFactory / isEnterSubmitWrapper", () => {
  it("wraps: builds the inner, proxies it, marker set", () => {
    const inners: EditorLike[] = [];
    const innerFactory = vi.fn((..._args: unknown[]) => {
      const e = fakeInner();
      inners.push(e);
      return e;
    });
    const wrapped = wrapEditorFactory(innerFactory);
    expect(isEnterSubmitWrapper(wrapped)).toBe(true);
    expect(isEnterSubmitWrapper(innerFactory)).toBe(false);

    const tui = { tui: true };
    const theme = { theme: true };
    const editor = wrapped(tui, theme, kb);

    expect(innerFactory).toHaveBeenCalledTimes(1);
    expect(innerFactory.mock.calls[0]).toEqual([tui, theme, kb]); // args verbatim

    // The proxy guards the built inner: Enter + menu cancels.
    inners[0]!.menuOpen = true;
    (inners[0]! as unknown as { prefix: string }).prefix = "zep";
    editor.handleInput("\r");
    expect(inners[0]!.calls).toEqual(["cancel", "inner:\r"]);
  });

  it("isEnterSubmitWrapper rejects non-factories", () => {
    expect(isEnterSubmitWrapper(undefined)).toBe(false);
    expect(isEnterSubmitWrapper(null)).toBe(false);
    expect(isEnterSubmitWrapper(() => null)).toBe(false); // unmarked function
    expect(isEnterSubmitWrapper({})).toBe(false);
  });
});

// ── Widget-layer doubles (P1.M3.T3.S2): the guard UNDER the widget composition ──

/** Inner editor for the widget doubles: guard state (menu) AND a live
 *  buffer for Tab inserts, ALL state in closures (never `this` — the
 *  guard binds methods to the pin, and a `this`-write would trip the
 *  never-mutate set trap). `order` records dismiss/cancel/submit
 *  events across BOTH layers for exact ordering assertions. */
const makeWidgetInner = () => {
  const calls: string[] = []; // inner-method interactions
  const order: string[] = []; // cross-layer event ordering
  let setTrapHits = 0;
  let menuOpen = false;
  let prefix = "";
  const buf = { lines: ["ze"], line: 0, col: 2 };
  const inner = {
    calls,
    isShowingAutocomplete: (): boolean => menuOpen,
    cancelAutocomplete: (): void => {
      menuOpen = false;
      calls.push("cancel");
      order.push("cancel");
    },
    get autocompletePrefix(): string {
      return prefix;
    },
    handleInput: (data: string): string => {
      calls.push(`inner:${data}`);
      order.push(`inner:${data}`);
      return "inner-return";
    },
    getLines: (): string[] => buf.lines,
    getCursor: (): { line: number; col: number } => ({ line: buf.line, col: buf.col }),
    setText: (t: string): void => {
      calls.push(`setText:${t}`);
    },
    setCursorCol: (c: number): void => {
      calls.push(`caret:${c}`);
    },
    getText: (): string => buf.lines.join("\n"),
    render: (): string[] => ["ze"],
  };
  const pinned = new Proxy(inner as unknown as Record<PropertyKey, unknown>, {
    get(target, prop) {
      return target[prop];
    },
    set(_target, _prop, _value) {
      setTrapHits += 1;
      throw new Error("NEVER mutate the inner editor instance (v1 crash lesson)");
    },
  });
  return {
    pinned,
    calls,
    order,
    open: (): void => {
      menuOpen = true;
    },
    isShowingAutocomplete: (): boolean => menuOpen,
    setPrefix: (p: string): void => {
      prefix = p;
    },
    setHits: (): number => setTrapHits,
  };
};

/** Minimal WORKING empty store — see the note in widget.test.ts: the
 *  machine's async wake (restoreReady settle / gate bound) queries
 *  after the synchronous test body; a throwing query would surface as
 *  an unhandled rejection. Empty range ⇒ clean close. */
const emptyStore = {
  prefixRange: (): [number, number] => [0, 0],
  sortedKeysSnapshot: (): string[] => [],
  currentOrdinal: (): number => 0,
  get: (): undefined => undefined,
} as unknown as CandidateStore;

/** The full stack: inner (pinned) → enter-submit guard → widget layer.
 *  The widget wiring builds its OWN guard around opts.inner (editor.ts
 *  reuse, never re-implemented) — so opts.inner gets the RAW pinned
 *  inner; pre-building a guard here would double-wrap (double clock
 *  ticks on forwarded keys). The wiring-built guard is reachable for
 *  assertions via the composed editor's own `then` forwarding. */
const buildWidgetDouble = (onKeystroke: () => void = () => {}) => {
  const inner = makeWidgetInner();
  const factory = createWidgetEditorFactory({
    inner: () => inner.pinned,
    store: emptyStore,
    config: { ...DEFAULT_CONFIG },
    chain: {} as unknown as ChainMachine,
    restoreReady: Promise.resolve(),
    onKeystroke,
  });
  const editor = factory(undefined, {}, kb);
  // Widen with the runtime `hidden` flag (the public WidgetState just
  // doesn't advertise it — same structural widening as widget.test.ts).
  const state = widgetStateOf(editor)! as WidgetState & {
    readonly hidden: boolean;
  };
  const machine = widgetMachineOf(editor)!;
  const press = (data: string): unknown =>
    (editor.handleInput as (d: string) => unknown)(data);
  const show = (displays: string[]): void =>
    state.set(displays.map((display) => ({ display })));
  return { inner, editor, state, machine, press, show, onKeystroke };
};

describe("the enter-submit guard UNDER the widget layer (P1.M3.T3.S2)", () => {
  it("Enter + open WORD menu + widget visible → widget dismisses FIRST, guard cancels, inner submits — exactly once, in that order", () => {
    const h = buildWidgetDouble();
    h.show(["Zendesk", "zephyr"]);
    h.inner.open();
    h.inner.setPrefix("zep");
    const realDismissed = h.machine.onDismissed.bind(h.machine);
    h.machine.onDismissed = (explicit: boolean): void => {
      h.inner.order.push("dismissed");
      realDismissed(explicit);
    };

    const out = h.press("\r");

    expect(out).toBe("inner-return"); // delegation return passes through both layers
    expect(h.inner.order).toEqual(["dismissed", "cancel", "inner:\r"]);
    expect(h.inner.calls).toEqual(["cancel", "inner:\r"]); // guard: cancel-then-delegate, once
    expect(h.state.hidden).toBe(true); // widget dismissal happened…
    expect(h.machine.getState().suppressUntilWordStart).toBe(true); // …explicitly
    expect(h.inner.setHits()).toBe(0); // and nothing wrote to the inner
  });

  it("Enter while HIDDEN + open word menu → stock guard untouched (cancel then submit), no widget dismissal", async () => {
    const h = buildWidgetDouble();
    h.inner.open();
    h.inner.setPrefix("zep");

    h.press("\r");
    await Promise.resolve(); // W1 fix: let the deferred machine tick settle

    expect(h.inner.calls).toEqual(["cancel", "inner:\r"]);
    expect(h.inner.order).toEqual(["cancel", "inner:\r"]); // no "dismissed"
    expect(h.machine.getState().suppressUntilWordStart).toBe(false);
    expect(h.state.hidden).toBe(true); // never showed
  });

  it("SLASH menu stays stock under the widget layer: widget dismisses, guard does NOT cancel (accept-and-submit)", () => {
    const h = buildWidgetDouble();
    h.show(["Zendesk"]);
    h.inner.open();
    h.inner.setPrefix("/mod");
    const realDismissed = h.machine.onDismissed.bind(h.machine);
    h.machine.onDismissed = (explicit: boolean): void => {
      h.inner.order.push("dismissed");
      realDismissed(explicit);
    };

    h.press("\r");

    expect(h.inner.order).toEqual(["dismissed", "inner:\r"]); // no "cancel"
    expect(h.inner.calls).toEqual(["inner:\r"]);
    expect(h.state.hidden).toBe(true);
    expect(h.machine.getState().suppressUntilWordStart).toBe(true);
  });

  it("CLOSED menu under the widget layer: dismiss then submit, guard inert", () => {
    const h = buildWidgetDouble();
    h.show(["Zendesk"]);
    const realDismissed = h.machine.onDismissed.bind(h.machine);
    h.machine.onDismissed = (explicit: boolean): void => {
      h.inner.order.push("dismissed");
      realDismissed(explicit);
    };

    h.press("\r");

    expect(h.inner.order).toEqual(["dismissed", "inner:\r"]);
    expect(h.inner.calls).toEqual(["inner:\r"]);
  });

  it("non-submit keys pass through untouched: forwarded, menu kept open, no dismissal, no suppression", () => {
    const h = buildWidgetDouble();
    h.show(["Zendesk"]);
    h.inner.open();
    h.inner.setPrefix("zep");

    h.press("z");

    expect(h.inner.calls).toEqual(["inner:z"]);
    // The forward ticks the machine (gate-held in unit tests) which may
    // close the LINE — but never as an explicit dismissal.
    expect(h.machine.getState().suppressUntilWordStart).toBe(false);
    expect(h.inner.isShowingAutocomplete()).toBe(true);
  });

  it("thenable guard holds on BOTH proxy layers (widget get forwards to the guard's pinned `then`)", () => {
    const h = buildWidgetDouble();
    // The composed editor's `then` reads forward through the widget
    // proxy → the wiring-built guard proxy → the pinned `undefined`.
    expect((h.editor as unknown as { then?: unknown }).then).toBeUndefined();
    // The guard layer's own pin, asserted directly on a fresh instance
    // of the exact member the wiring composes with.
    expect(
      (createEnterSubmitEditor(h.inner.pinned, kb) as unknown as { then?: unknown }).then,
    ).toBeUndefined();
  });

  it("onKeystroke fires for EVERY input event — consumed keys included (arrows, Tab insert)", () => {
    const ticks = vi.fn();
    const h = buildWidgetDouble(ticks);
    h.show(["Zendesk", "zephyr"]);
    h.press("\x1b[C"); // RIGHT — consumed navigation
    h.press("\t"); // consumed Tab insert (buffer "ze" @ col 2 → span)
    h.press("x"); // forwarded text
    h.press("\r"); // forwarded submit (line hidden after the insert)
    expect(ticks).toHaveBeenCalledTimes(4); // one tick per event, consumed or not
    // RIGHT moved the highlight to index 1, so the Tab inserted zephyr;
    // only the two forwarded keys reached the inner editor.
    expect(h.inner.calls).toEqual([
      "setText:zephyr",
      "caret:6",
      "inner:x",
      "inner:\r",
    ]);
  });

  it("a throwing onKeystroke never breaks input — forwarded keys still delegate, consumed inserts still land", () => {
    const h = buildWidgetDouble(() => {
      throw new Error("clock boom");
    });
    h.show(["Zendesk"]);

    expect(() => h.press("z")).not.toThrow();
    expect(() => h.press("\t")).not.toThrow();

    expect(h.inner.calls).toEqual(["inner:z", "setText:Zendesk", "caret:7"]); // forwarded key arrived; insert landed anyway
    expect(h.state.hidden).toBe(true); // acceptance completed
  });

  it("never-mutate: zero set-trap hits across the whole double stack", () => {
    const h = buildWidgetDouble();
    h.show(["Zendesk", "zephyr"]);
    h.press("\x1b[C");
    h.press("\t");
    h.press("\r");
    h.press("x");
    (h.editor.render as (w: number) => string[])(40);
    expect(h.inner.setHits()).toBe(0);
  });
});
