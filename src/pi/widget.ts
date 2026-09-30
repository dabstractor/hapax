/**
 * Widget display layer (PRD 003 §07 h2.42, plan 003 P1.M3.T1.S1/S2).
 *
 * spec 07 h2.42 (2026-10 owner rule): when an editor factory is
 * installed, some extension owns the editor — hapax composes AROUND it
 * and renders its own one-line widget (the PRIMARY display path). No
 * autocomplete provider is registered on this path; stock path/slash/@
 * completion is untouched by construction. Where no factory exists the
 * proxy cannot install and the widget cannot run — pi keeps the
 * provider + vertical-menu FALLBACK (index.ts's fallback branch,
 * today's behavior verbatim).
 *
 * Composition (S1): the captured inner factory is built VERBATIM and
 * wrapped in the Enter-submits guard — createEnterSubmitEditor is
 * REUSED, never re-implemented; it also owns the input-clock tick via
 * its onKeystroke callback, so the skeleton already feeds the shared
 * hesitation clock. The inner instance is never mutated (v1 recursion
 * crash lesson, editor.ts header) and the composed editor is never a
 * thenable (createEnterSubmitEditor pins `then` → undefined).
 *
 * Rendering (S2, spec §07 h3.8/h2.50): the layer's proxy overrides
 * `render` — an UNBOUND composing closure (fresh per read, never the
 * inner's bound render) that calls the inner's render(width), then
 * appends AT MOST ONE line below the editor's lines: candidates joined
 * by " | " in rank order (leftmost = best), display strings ONLY (no
 * descriptions, no counts, no markers), capped at config.maxSuggestions
 * AND the terminal width — width comes from render(width)'s argument,
 * the ONLY width source (pi-tui's TUI exposes no width getter, r4 doc
 * §2), so the last seen width is cached. Overflow drops the RIGHTMOST
 * (lowest-ranked) items; an unfittable single item means NO line.
 * Zero candidates / hidden state / no width yet → the inner's lines are
 * returned BYTE-IDENTICAL (invariant 3: the widget is structurally
 * absent, never a blank line). The accent highlight is
 * theme.selectList.selectedText, applied to the leftmost item by
 * default and reset to index 0 on every set(); styling is applied LAST
 * (width arithmetic runs on plain strings — ANSI codes inflate
 * .length).
 *
 * Repaint strategy: natural per-keystroke render only — pi-tui renders
 * on every input event. `tui` is NOT captured and requestRender() is
 * NOT called here (recorded decision, r4 §6 + work item); if T2's
 * visibility machine needs forced repaints, that is its call.
 *
 * Forward-task map:
 *   - P1.M3.T1.S2  (this task) render override + state holder. The
 *     novel proxy render override is a flagged risk (r4 §6): LIVE-VERIFY
 *     in P1.M3.T4.S1 per spec §09.
 *   - P1.M3.T2.S1  visibility machine drives state.set()/hide().
 *   - P1.M3.T3.S1/S2  key consumption (arrows/Esc/Tab/Enter) BEFORE the
 *     enter-submit guard; mutate state.highlightIndex and consume the
 *     rendered list for Tab insertion.
 *
 * Idempotence: the built factory is stamped WIDGET_WRAPPED (mirroring
 * editor.ts's WRAPPED) so a reload cycle re-running session_start with
 * our wrapper already installed neither stacks a second layer nor
 * re-installs — index.ts branches on isWidgetWrapper. TOCTOU with an
 * extension calling setEditorComponent AFTER our read is the same
 * accepted tolerance as today's enter-submit wrap (reload cycles re-run
 * session_start and re-read).
 */

import type { CandidateStore } from "../core/store.js";
import type { HapaxConfig } from "./config.js";
import { createEnterSubmitEditor } from "./editor.js";
import type { ChainMachine } from "./provider.js";

/** Structural editor factory — duck-typed like editor.ts's
 *  wrapEditorFactory: `any` params on purpose (the wrapper is
 *  transparent to whatever factory signature it composes with); no
 *  runtime values are imported from the pi package. */
export type EditorFactory = (tui: any, theme: any, keybindings?: any) => any;

/** Options for the widget editor composition (PRD 003 §07 h2.42). */
export interface WidgetLayerOptions {
  /** the captured pi editor factory — built verbatim, never mutated */
  inner: EditorFactory;
  store: CandidateStore;
  /** triggerChar, maxSuggestions, menuDelayMs, fuzzThreshold, trigger
   *  modes… — consumed by S2 (render) / T2 (visibility) / T3 (keys). */
  config: HapaxConfig;
  /** Tab-chain machine — the same instance index.ts resets on
   *  before_agent_start (createChainMachine). */
  chain: ChainMachine;
  /** startup restore gate signal — shared with the fallback path's
   *  createStartupGate (resolves when history replay settles). */
  restoreReady: Promise<void>;
  /** input clock tick (hesitation timing) — invoked for EVERY input
   *  event; createEnterSubmitEditor calls it before each delegation. */
  onKeystroke: () => void;
}

/** Marker preventing double-wrap across reload cycles (mirrors
 *  editor.ts WRAPPED). */
const WIDGET_WRAPPED = Symbol("hapax.widgetWrapped");

/** Introspection seam for a composition's options (S1): lets tests —
 *  and S2/T2/T3 diagnostics — verify the shared core (store / config /
 *  chain / restoreReady / input clock) a built factory was composed
 *  with, without behavioral probes the skeleton cannot expose yet. */
const WIDGET_OPTS = Symbol("hapax.widgetOpts");

/** Per-built-editor widget state seam (S2): lets tests drive set/hide
 *  directly, and lets T2/T3 reach the state without behavior probes. */
const WIDGET_STATE = Symbol("hapax.widgetState");

/** True when the factory is a hapax widget wrapper (prevents stacking
 *  and re-install on repeated session_start runs). */
export function isWidgetWrapper(factory: unknown): boolean {
  return (
    typeof factory === "function" &&
    (factory as { [WIDGET_WRAPPED]?: boolean })[WIDGET_WRAPPED] === true
  );
}

/** The options a widget wrapper was composed with, or undefined when
 *  `factory` is not one (see WIDGET_OPTS — test/diagnostic seam). */
export function widgetOptsOf(
  factory: unknown,
): WidgetLayerOptions | undefined {
  if (typeof factory !== "function") return undefined;
  return (factory as { [WIDGET_OPTS]?: WidgetLayerOptions })[WIDGET_OPTS];
}

// ── S2: the one-line widget renderer (spec §07 h3.8/h2.50) ──────────────────

/** Options for renderWidgetLine. `width` is the last render(width)
 *  argument (the only terminal-width source); `maxSuggestions` is the
 *  already-clamped config value (1–20); `highlightIndex` is 0-based
 *  into the RENDERED (post-truncate) list; `accent` is the theme's
 *  selected-text styler. */
export interface WidgetLineOptions {
  width: number;
  maxSuggestions: number;
  highlightIndex: number;
  accent: (text: string) => string;
}

/**
 * Build the one-line widget (spec §07 h3.8): candidates joined by
 * " | " in rank order, display strings ONLY. Returns null when the
 * line must be STRUCTURALLY ABSENT (invariant 3, h2.2 — never a blank
 * line):
 *   - zero items → null;
 *   - not even the first item fits `width` → null (a line that can't
 *     hold a word must not exist);
 *
 * Caps (h2.50): at most `maxSuggestions` items (leftmost first — input
 * is rankMatches output, already final-ranked, never re-sorted), then a
 * greedy width fit left→right: an item is admissible only if the joined
 * line WITH it (separator included) still fits; overflow drops the
 * RIGHTMOST (lowest-ranked) items — never ellipsis, never wrap, never a
 * truncated word.
 *
 * Length arithmetic runs on the PLAIN display strings; `accent` is
 * applied last, only to the item at `highlightIndex` (clamped into the
 * rendered list) — ANSI-styled text must never feed the width fit (its
 * .length counts escape codes, not columns).
 */
export function renderWidgetLine(
  items: readonly { display: string }[],
  opts: WidgetLineOptions,
): string | null {
  // Cap 1 — count (leftmost first; input order is rank order).
  const capped = items.slice(0, Math.max(0, opts.maxSuggestions));
  const kept: string[] = []; // PLAIN displays — styling happens at the end
  for (const item of capped) {
    const display = item.display;
    const candidateLength =
      kept.length === 0
        ? display.length
        : kept.join(" | ").length + " | ".length + display.length;
    if (candidateLength > opts.width) {
      if (kept.length === 0) return null; // not even one word fits
      break; // drop the rightmost (lowest-ranked) remainder
    }
    kept.push(display);
  }
  if (kept.length === 0) return null; // invariant 3 — structurally absent
  const hi = Math.max(0, Math.min(opts.highlightIndex, kept.length - 1));
  return kept.map((d, i) => (i === hi ? opts.accent(d) : d)).join(" | ");
}

// ── S2: widget state holder (T2 drives set/hide; T3 moves highlight) ────────

/** Minimal seam over the per-editor widget state. `set` replaces the
 *  result set and RESETS highlightIndex to 0 (spec h3.8: "resets to
 *  [leftmost] on every result-set change"); `hide` renders nothing
 *  (dismiss/suppress/zero — invariant 3). Highlight MOVEMENT (arrows)
 *  is T3's API — a plain mutable `highlightIndex` field suffices. */
export interface WidgetState {
  /** Replace the result set (resets highlightIndex to 0, clears the
   *  hidden flag — the visibility machine owns the show/hide policy). */
  set(items: readonly { display: string }[]): void;
  /** Hide the line (dismiss/suppress/zero) — renders nothing. */
  hide(): void;
  /** 0-based highlight index within the CURRENT rendered list. */
  highlightIndex: number;
}

/** Internal view: the proxy also needs the items and the hidden flag. */
interface WidgetStateInternal extends WidgetState {
  items: readonly { display: string }[];
  hidden: boolean;
}

/** Fresh per-BUILT-EDITOR state (a new editor instance starts hidden
 *  and empty). set() COPIES the caller's array — the renderer never
 *  aliases input it does not own. */
function createWidgetState(): WidgetStateInternal {
  const state: WidgetStateInternal = {
    items: [],
    hidden: false,
    highlightIndex: 0,
    set(items: readonly { display: string }[]): void {
      state.items = [...items];
      state.highlightIndex = 0; // spec h3.8: reset to leftmost on set change
      state.hidden = false;
    },
    hide(): void {
      state.hidden = true;
      state.items = [];
    },
  };
  return state;
}

/** The widget state of a BUILT editor (or undefined when `editor` is
 *  not a hapax widget composition — see WIDGET_STATE). Test/diagnostic
 *  seam; T2/T3 consume the same seam. */
export function widgetStateOf(editor: unknown): WidgetState | undefined {
  if (editor === null || typeof editor !== "object") return undefined;
  return (editor as { [WIDGET_STATE]?: WidgetState })[WIDGET_STATE];
}

/** Accent fallback for tests/environments without a pi EditorTheme
 *  (theme.selectList.selectedText is the real channel — editor.d.ts/
 *  select-list.d.ts). */
const identityAccent = (text: string): string => text;

/**
 * Compose the widget layer AROUND the captured editor factory: build
 * the inner editor verbatim, wrap it in the Enter-submits guard (which
 * ticks opts.onKeystroke on every input event), and wrap THAT in the
 * widget proxy — the widget layer sees reads first; the enter-submit
 * guard second; the inner editor last. The inner instance is never
 * mutated (v1 recursion crash lesson). Nested proxies are safe because
 * neither mutates the inner and each owns exactly its own members
 * (r4 doc §2).
 *
 * S2 render override: the get trap intercepts "render" and returns an
 * UNBOUND composing closure — FRESH on every read (never the inner's
 * bound render, never memoized; pi-tui must not see a cached identity,
 * r4 §2 risk note). The closure caches the width (render(width) is the
 * only terminal-width source), calls the inner's render, and appends at
 * most one widget line per the renderWidgetLine contract — or returns
 * the inner's lines byte-identical when there is no line (zero
 * candidates, hidden, unfittable).
 */
export function createWidgetEditorFactory(
  opts: WidgetLayerOptions,
): EditorFactory {
  const wrapped: EditorFactory = (tui, theme, keybindings) => {
    const inner = createEnterSubmitEditor(
      opts.inner(tui, theme, keybindings),
      keybindings,
      opts.onKeystroke,
    );

    // Per-built-editor widget state: a new editor instance starts
    // empty/hidden; T2's visibility machine drives set/hide.
    const state = createWidgetState();

    // Accent = the theme's selected-text styler (the channel pi-tui
    // itself uses for highlighted select-list items). Structural probe
    // + identity fallback keeps tests without a real EditorTheme safe.
    const themeShape = theme as
      | { selectList?: { selectedText?: (text: string) => string } }
      | undefined;
    const accent: (text: string) => string =
      typeof themeShape?.selectList?.selectedText === "function"
        ? themeShape.selectList.selectedText
        : identityAccent;

    // render(width) is the ONLY width source (r4 §2: TUI exposes no
    // width getter). Cached per built editor; before the first render
    // call it is undefined and nothing has been (or can be) appended.
    let lastWidth: number | undefined = undefined;

    // Reads forward THROUGH the enter-submit proxy (innerRecord[prop]
    // triggers its get trap: functions bind to the real inner, `then`
    // stays undefined, handleInput stays the guard) — S2 adds exactly
    // one member of its own: "render". Never mutate the inner.
    const innerRecord = inner as unknown as Record<PropertyKey, unknown>;
    return new Proxy(inner as object, {
      get(_target, prop) {
        if (prop === WIDGET_STATE) return state;
        if (prop === "render") {
          // UNBOUND composing closure — fresh on EVERY read (r4 §2:
          // pi-tui must not see a cached identity; the inner's bound
          // render is never exposed for this member). LIVE-VERIFY in
          // P1.M3.T4.S1 per spec §09 (novel proxy render override,
          // r4 §6 risk).
          return (width: number): string[] => {
            lastWidth = width;
            const lines = (
              innerRecord.render as (w: number) => string[]
            )(width);
            const line =
              state.hidden || state.items.length === 0
                ? null
                : renderWidgetLine(state.items, {
                    width: lastWidth,
                    maxSuggestions: opts.config.maxSuggestions,
                    highlightIndex: state.highlightIndex,
                    accent,
                  });
            // Invariant 3: no line → the inner's lines BYTE-IDENTICAL
            // (never a blank appended line).
            return line === null ? lines : [...lines, line];
          };
        }
        return innerRecord[prop];
      },
    });
  };
  (wrapped as { [WIDGET_WRAPPED]?: boolean })[WIDGET_WRAPPED] = true;
  (wrapped as { [WIDGET_OPTS]?: WidgetLayerOptions })[WIDGET_OPTS] = opts;
  return wrapped;
}
