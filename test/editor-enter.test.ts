/**
 * Enter-submits guard (src/pi/editor.ts, v2 proxy composition) — unit
 * tests over a duck-typed inner editor: Enter while a non-slash menu is
 * open cancels the menu then delegates exactly once; every other
 * combination is pure pass-through; the inner instance is NEVER
 * mutated (the v1 recursion crash); proxy forwarding (get/set/has,
 * thenable guard) is pinned.
 */
import { describe, expect, it, vi } from "vitest";

import {
  createEnterSubmitEditor,
  isEnterSubmitWrapper,
  wrapEditorFactory,
  type EditorLike,
  type KeybindingsLike,
} from "../src/pi/editor.js";

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
