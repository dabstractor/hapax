/**
 * REGRESSION SUITE (was an investigation repro; P3.M1.T1.S1): the widget
 * layer defers to pi's own autocomplete menu when it is open — spec 07
 * h2.46 (stock path/slash completion untouched by construction) + h2.51
 * (never-hijack). A Tab over an OPEN pi menu is forwarded verbatim so pi's
 * menu accepts its highlighted item; hapax inserts nothing.
 *
 * Drives the REAL pi-tui Editor (the same class pi instantiates) as
 * the widget factory's inner editor, with a provider that mimics
 * pi's CombinedAutocompleteProvider semantics for the two surfaces
 * classifyStockContext does NOT model:
 *
 *   1. Tab-forced file completion on a plain word (editor.js
 *      handleTabCompletion → forceFileAutocomplete → provider
 *      extractPathPrefix(force=true) answers the bare token).
 *   2. Slash-command ARGUMENT completion after a space
 *      (isInSlashCommandContext allows spaces; provider answers via
 *      getArgumentCompletions).
 *
 * Real async timing: pi's requestAutocomplete → getSuggestions is a
 * Promise; the menu opens only after it resolves.
 */
import { describe, expect, it, vi } from "vitest";

import { Editor, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";

import { CandidateStore } from "../src/core/store.js";
import type { Sighting } from "../src/core/types.js";
import { DEFAULT_CONFIG } from "../src/pi/config.js";
import { createChainMachine } from "../src/pi/provider.js";
import {
  createWidgetEditorFactory,
  widgetStateOf,
} from "../src/pi/widget.js";

setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));

const TAB = "\t";

const fakeTui = () => ({
  requestRender: () => {},
  terminal: { rows: 40, columns: 120 },
});

const theme = {
  borderColor: "white",
  selectList: { selectedText: (t: string) => t },
};

/** pi-provider double implementing the two unmodeled surfaces. */
function makePiProvider(itemsFor: (token: string) => string[]) {
  const applied: string[] = [];
  return {
    provider: {
      triggerCharacters: ["@", "#"],
      async getSuggestions(
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        options: { force?: boolean },
      ) {
        const before = lines[cursorLine]!.slice(0, cursorCol);
        // forced Tab file completion on a plain token (extractPathPrefix
        // force branch — the BARE TRAILING TOKEN of any line, exactly like
        // the real provider), or argument completion after "/cmd "
        // P3.M1.T1.S1: the original anchored regex
        // `^(?:\/[^\s/][^\s]* )?([^\s]*)$` matched only single-token
        // lines and "/cmd arg" buffers — for "load the te" it returned
        // null, so pi's forced menu could NEVER open and the deferral
        // cases could never go green. Trailing-token extraction is what
        // the real CombinedAutocompleteProvider does.
        const m = before.match(/(?:^|\s)([^\s]*)$/);
        const token = m?.[1] ?? "";
        if (!token) return null;
        const names = itemsFor(token);
        if (names.length === 0) return null;
        return {
          items: names.map((n) => ({ value: n, label: n })),
          prefix: token,
        };
      },
      applyCompletion(
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        item: { value: string },
        prefix: string,
      ) {
        applied.push(item.value);
        const line = lines[cursorLine]!;
        const newLine =
          line.slice(0, cursorCol - prefix.length) +
          item.value +
          line.slice(cursorCol);
        const newLines = [...lines];
        newLines[cursorLine] = newLine;
        return {
          lines: newLines,
          cursorLine,
          cursorCol: cursorCol - prefix.length + item.value.length,
        };
      },
    },
    applied,
  };
}

const sight = (display: string, ordinal = 1): Sighting => ({
  key: display.toLowerCase(),
  display,
  ordinal,
  fromUser: true,
  properName: false,
  casing: "lower",
  rankGroup: 0,
});

/** Composed stack: real Editor ← enter-submit guard ← widget layer. */
function build(hapaxWords: string[]) {
  const store = new CandidateStore();
  hapaxWords.forEach((w, i) => store.upsert(sight(w, i + 1)));

  const pi = makePiProvider((token) =>
    token === "te" ? ["templates/", "terminal-bell/"] : [],
  );
  const tui = fakeTui();
  const factory = createWidgetEditorFactory({
    inner: (t: unknown, th: unknown, kb?: unknown) => {
      const ed = new Editor(t as never, th as never, {});
      (ed as unknown as { setAutocompleteProvider(p: unknown): void }).setAutocompleteProvider(
        pi.provider,
      );
      void kb;
      return ed;
    },
    store,
    config: { ...DEFAULT_CONFIG, menuDelayMs: 0 },
    chain: createChainMachine(),
    restoreReady: Promise.resolve(),
    onKeystroke: () => {},
  });
  const editor = factory(tui, theme, undefined) as Editor;
  const state = widgetStateOf(editor)! as unknown as { hidden: boolean; items: { display: string }[] };
  return { editor, state, pi };
}

/** Flush pi's async requestAutocomplete chain + hapax microtasks. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const type = (editor: Editor, text: string) => {
  for (const ch of text) editor.handleInput(ch);
};

describe("regression: hapax must defer to pi's open autocomplete menu", () => {
  it("forced file surface ('load the te') — the widget line arms OVER pi's Tab-forced menu: the accepting Tab must reach pi, never insert a hapax word", async () => {
    const { editor, state, pi } = build(["terminal", "template", "test"]);
    // NO flush before the 1st Tab: the visibility machine paints on a
    // microtask, so the synchronous Tab races the first paint. It
    // forwards (line still hidden) → pi's forced file menu opens; the
    // flush then lets hapax's query paint the line OVER the open menu.
    type(editor, "load the te");
    editor.handleInput(TAB); // 1st Tab: forwarded → pi's forced file menu opens
    await flush();
    // Preconditions of the accepting Tab: pi's menu REALLY opened (the
    // provider answers the bare trailing token "te" — real
    // extractPathPrefix(force=true) semantics) AND the hapax line armed
    // on top of it — exactly the hijack setup: without the deferral
    // this Tab inserts "test" over pi's open menu.
    const showing = (editor as unknown as { isShowingAutocomplete(): boolean }).isShowingAutocomplete();
    expect(showing).toBe(true);
    expect(state.hidden).toBe(false);
    expect(state.items.length).toBeGreaterThan(0);

    editor.handleInput(TAB); // accepting Tab: forwarded verbatim → pi accepts its highlighted item
    await flush();
    expect(pi.applied).toEqual(["templates/"]);
    const text = (editor as unknown as { getText(): string }).getText();
    expect(text).toContain("templates/");

    editor.handleInput(TAB); // follow-up Tab: menu closed + no live span → inert, nothing more applied
    await flush();
    expect(pi.applied).toEqual(["templates/"]);
  });

  it("argument completion menu ('/model te') — pi menu auto-opens; Tab must accept pi's item", async () => {
    const { editor, pi } = build(["terminal", "template", "test"]);
    type(editor, "/model te");
    await flush();
    // pi's argument menu auto-opened — the deferral's precondition
    const showing = (editor as unknown as { isShowingAutocomplete(): boolean }).isShowingAutocomplete();
    expect(showing).toBe(true);

    editor.handleInput(TAB); // accept pi's highlighted item
    await flush();
    expect(pi.applied).toEqual(["templates/"]);
  });

  it("async race (menuDelayMs 400, fake timers): the hapax line arms OVER pi's open menu — the hesitation race must not defeat the deferral", async () => {
    vi.useFakeTimers();
    try {
      const store = new CandidateStore();
      ["terminal", "template", "test"].forEach((w, i) => store.upsert(sight(w, i + 1)));
      const pi = makePiProvider((token) =>
        token === "te" ? ["templates/", "terminal-bell/"] : [],
      );
      const tui = fakeTui();
      const factory = createWidgetEditorFactory({
        inner: (t: unknown, th: unknown) => {
          const ed = new Editor(t as never, th as never, {});
          (ed as unknown as { setAutocompleteProvider(p: unknown): void }).setAutocompleteProvider(pi.provider);
          return ed;
        },
        store,
        config: { ...DEFAULT_CONFIG, menuDelayMs: 400 },
        chain: createChainMachine(),
        restoreReady: Promise.resolve(),
        onKeystroke: () => {},
      });
      const editor = factory(tui, theme, undefined) as Editor;
      const state = widgetStateOf(editor)! as unknown as { hidden: boolean };

      type(editor, "load the te");
      // Same microtask race as case 1, but the arm is additionally held
      // by the 400 ms hesitation gate: it lands only when the user
      // PAUSES (the 500 ms advance), with pi's menu already open.
      editor.handleInput(TAB); // 1st Tab: forwarded (line still hidden) → pi's forced file menu
      await vi.advanceTimersByTimeAsync(500); // the pause: menu opens AND the gate opens → hapax arms over it

      // Preconditions of the accepting Tab: pi's menu REALLY opened AND
      // the hapax line armed on top of it (the race this case pins).
      const showing = (editor as unknown as { isShowingAutocomplete(): boolean }).isShowingAutocomplete();
      expect(showing).toBe(true);
      expect(state.hidden).toBe(false);

      editor.handleInput(TAB); // accepting Tab: forwarded verbatim → pi accepts its highlighted item
      await vi.advanceTimersByTimeAsync(10);
      expect(pi.applied).toEqual(["templates/"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pure slash typing ('/mo', no space) — the classified stock context — defers today (contrast case)", async () => {
    const { editor } = build(["model", "mock", "mocha"]);
    type(editor, "/mo");
    await flush();
    editor.handleInput(TAB);
    await flush();
    const text = (editor as unknown as { getText(): string }).getText();
    // hapax must not have inserted its own dictionary word over the slash
    expect(text.startsWith("/mo")).toBe(true);
  });
});
