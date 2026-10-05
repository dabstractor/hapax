/**
 * INVESTIGATION REPRO (not a regression suite yet): does the widget
 * layer defer to pi's own autocomplete menu when it is open?
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
        // force branch), or argument completion after "/cmd "
        const m = before.match(/^(?:\/[^\s/][^\s]* )?([^\s]*)$/);
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

describe("repro: hapax must defer to pi's open autocomplete menu", () => {
  it("forced file menu (Tab on plain word) — pi's menu opens, then Tab inserts the PI item, not a hapax word", async () => {
    const { editor, state, pi } = build(["terminal", "template", "test"]);
    type(editor, "load the te");
    await flush();
    // hapax's line is armed (dictionary words) at this point
    // eslint-disable-next-line no-console
    console.log("after typing:", {
      hidden: state.hidden,
      items: state.items.map((i) => i.display),
    });

    editor.handleInput(TAB); // 1st Tab: no pi menu yet → forced file menu opens
    await flush();
    const showing = (editor as unknown as { isShowingAutocomplete(): boolean }).isShowingAutocomplete();
    // eslint-disable-next-line no-console
    console.log("after 1st Tab:", { piMenuShowing: showing });

    editor.handleInput(TAB); // 2nd Tab: user accepts pi's highlighted item
    await flush();
    // eslint-disable-next-line no-console
    console.log("after 2nd Tab:", {
      piApplied: pi.applied,
      text: (editor as unknown as { getText(): string }).getText(),
    });
    expect(pi.applied).toEqual(["templates/"]);
  });

  it("argument completion menu ('/model te') — pi menu auto-opens; Tab must accept pi's item", async () => {
    const { editor, state, pi } = build(["terminal", "template", "test"]);
    type(editor, "/model te");
    await flush();
    const showing = (editor as unknown as { isShowingAutocomplete(): boolean }).isShowingAutocomplete();
    // eslint-disable-next-line no-console
    console.log("argument menu:", {
      piMenuShowing: showing,
      hapaxHidden: state.hidden,
      hapaxItems: state.items.map((i) => i.display),
    });

    editor.handleInput(TAB);
    await flush();
    // eslint-disable-next-line no-console
    console.log("after Tab:", {
      piApplied: pi.applied,
      text: (editor as unknown as { getText(): string }).getText(),
    });
    expect(pi.applied).toEqual(["templates/"]);
  });

  it("async race: pi's Tab-forced menu opens while the widget line is closed (menuDelayMs hesitation), then re-opens armed and steals the NEXT Tab", async () => {
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
      await vi.advanceTimersByTimeAsync(0); // flush queries; hesitation holds the line closed
      // eslint-disable-next-line no-console
      console.log("fast typing:", { hapaxHidden: state.hidden });

      editor.handleInput(TAB); // 1st Tab: hidden line → forwarded → pi's forced menu opens
      await vi.advanceTimersByTimeAsync(500); // user pauses, looking at pi's menu
      const showing = (editor as unknown as { isShowingAutocomplete(): boolean }).isShowingAutocomplete();
      // eslint-disable-next-line no-console
      console.log("after 1st Tab + pause:", {
        piMenuShowing: showing,
        hapaxHidden: state.hidden,
      });

      editor.handleInput(TAB); // 2nd Tab: accept pi's highlighted item
      await vi.advanceTimersByTimeAsync(10);
      // eslint-disable-next-line no-console
      console.log("after 2nd Tab:", {
        piApplied: pi.applied,
        text: (editor as unknown as { getText(): string }).getText(),
      });
      expect(pi.applied).toEqual(["templates/"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pure slash typing ('/mo', no space) — the classified stock context — defers today (contrast case)", async () => {
    const { editor } = build(["model", "mock", "mocha"]);
    type(editor, "/mo");
    await flush();
    const showing = (editor as unknown as { isShowingAutocomplete(): boolean }).isShowingAutocomplete();
    editor.handleInput(TAB);
    await flush();
    const text = (editor as unknown as { getText(): string }).getText();
    // eslint-disable-next-line no-console
    console.log("slash contrast:", {
      piMenuShowingBeforeTab: showing,
      text,
    });
    // hapax must not have inserted its own dictionary word over the slash
    expect(text.startsWith("/mo")).toBe(true);
  });
});
