/**
 * Widget display layer (PRD 003 §07 h2.42, plan 003 P1.M3.T1.S1) — S1
 * SKELETON.
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
 * Forward-task map — this skeleton is the seam all three extend:
 *   - P1.M3.T1.S2  render override: append the one-line widget below
 *     the editor's lines (proxy `render` trap; terminal width comes
 *     from render(width) — the only width source, r4 doc §2).
 *   - P1.M3.T2.S1  visibility machine on the same layer.
 *   - P1.M3.T3.S1/S2  key consumption (arrows/Esc/Tab/Enter) BEFORE
 *     the enter-submit guard — the get-trap seam documented in
 *     plan/003_bbac3b15e8d0/architecture/r4-widget-pi-api.md §2.
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

/**
 * Compose the widget layer AROUND the captured editor factory (S1
 * skeleton): build the inner editor verbatim, wrap it in the
 * Enter-submits guard (which ticks opts.onKeystroke on every input
 * event), and delegate EVERYTHING else — S1 renders nothing and
 * consumes no keys. Later tasks wrap `inner` OUTWARD from here: the
 * widget layer sees keys FIRST (T3), enter-submit second, inner last.
 * Never mutate the inner instance (v1 recursion crash lesson).
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
    // S1 SKELETON: pass-through — return the enter-submit proxy as-is.
    // P1.M3.T1.S2 overrides render (append the one-line widget below
    // the editor's lines); P1.M3.T2.S1 adds the visibility machine;
    // P1.M3.T3.S1/S2 add key consumption (arrows/Esc/Tab/Enter) BEFORE
    // the enter-submit guard — the get-trap seam documented in
    // plan/003_bbac3b15e8d0/architecture/r4-widget-pi-api.md §2.
    return inner;
  };
  (wrapped as { [WIDGET_WRAPPED]?: boolean })[WIDGET_WRAPPED] = true;
  (wrapped as { [WIDGET_OPTS]?: WidgetLayerOptions })[WIDGET_OPTS] = opts;
  return wrapped;
}
