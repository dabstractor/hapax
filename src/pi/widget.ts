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
 * Zero candidates / hidden state / no width yet → NO CONTENT line: the
 * inner's lines are returned BYTE-IDENTICAL while the row is UNCLAIMED;
 * while CLAIMED (spec §07 Line claim, 2026-10) a single BLANK line is
 * appended instead — the first non-empty render claims the row for the
 * prompt's duration (blank-when-empty, never row-removal, released on
 * submit / turn reset / session rebind), so the input area never jumps
 * by one line mid-prompt. Invariant 3 governs CONTENT — a blank
 * reserved row paints none. The accent highlight is
 * theme.selectList.selectedText, applied to the leftmost item by
 * default and reset to index 0 on every set(); styling is applied LAST
 * (width arithmetic runs on plain strings — ANSI codes inflate
 * .length).
 *
 * Repaint strategy: natural per-keystroke render only — pi-tui renders
 * on every input event. `tui` is NOT captured for the render path and
 * requestRender() is NOT called there (recorded decision, r4 §6 + work
 * item); if T2's visibility machine needs forced repaints, that is its
 * call. AMENDED in T3/S2: the CONSUMED Tab (insertHighlighted) never
 * delegates, so the key layer captures `tui` and asks for a repaint
 * defensively — best-effort, try/catch'd, and the ONLY requestRender
 * on this path.
 *
 * Forward-task map:
 *   - P1.M3.T1.S2  (this task) render override + state holder. The
 *     novel proxy render override is a flagged risk (r4 §6): LIVE-VERIFY
 *     in P1.M3.T4.S1 per spec §09.
 *   - P1.M3.T2.S1  LANDED: createVisibilityMachine (spec §07 h3.10)
 *     decides show/hide/suppress per input tick; the factory glues its
 *     VisibilityState into the S2 state holder (set/hide below) and is
 *     ticked through the enter-submit guard's onKeystroke seam.
 *   - P1.M3.T3.S1  LANDED: the widget key layer (spec §07 h3.9, 2026-10
 *     model v2). While the line is visible the composed handleInput
 *     decides BEFORE the enter-submit guard: →/↓ ENTER the list
 *     (navigate +1) — unless the line holds a single word, in which
 *     case the press forwards verbatim (no arrow is ever consumed
 *     pre-entry); un-entered ↑/← on the FIRST word PASS THROUGH (line
 *     hides, suppressed via machine.onDismissed(true), press FORWARDED
 *     — the caret moves on that same keypress; one-press plain-pi
 *     parity). After the first highlight-moving arrow the generation is
 *     `interacted` (WidgetState.interacted; reset by set() — a
 *     genuinely-new result set — and defensively by hide()) and the
 *     arrow cluster is captured with CAROUSEL WRAP at both edges
 *     (applied modularly in the wiring; the old clamp is retired as
 *     unreachable). Escape dismisses + suppresses. Every other key —
 *     Tab and Enter included — forwards verbatim to the enter-submit
 *     proxy; while hidden or empty NOTHING is captured (invariant 1
 *     amendment). Suppression is ONLY ever set through the machine's
 *     onDismissed seam — never directly.
 *   - P1.M3.T3.S2  LANDED: replaces the Tab/Enter forward branches —
 *     Tab (visible, non-empty) synchronously inserts the highlighted
 *     word (insertHighlighted); Enter dismisses the line then forwards
 *     so the inner editor still submits (the guard stays in the chain).
 *   - P1.M1.T1.S2  LANDED (BUG-001, plan 004 bugfix): the tab-insert
 *     branch arms opts.chain at the accepted record's store key —
 *     painted() captured pre-insert (hide() clears it), strict tier-0
 *     skip, enableChaining gate, never on span-miss forwards. Still
 *     forward: the successor-offer consult branch (P1.M1.T2.S1), the
 *     shared grant tracker (P1.M1.T2.S2), the formal arming pin suite
 *     (P1.M1.T1.S3).
 *
 * Repaint note (T2): the visibility machine does NOT request forced
 * repaints — decisions land at the next natural per-keystroke render;
 * async gate wakes (restoreReady settle / 500 ms bound) surface then
 * too (accepted; live-verify in P1.M3.T4.S1).
 *
 * Line claim (2026-10 owner rule, spec §07 "Line claim"): the row
 * directly below the editor, once first shown for a prompt, is OWNED
 * until an interface reflow — empty result sets render BLANK, never
 * row-removal (kills the 1-line input-area bounce; the stock vertical
 * menu reserves its space the same way). Arming happens at the render
 * override (only a real non-empty painted line claims); release hooks:
 * the submit key in this file's key layer (the canonical reflow) and
 * before_agent_start/session rebind in index.ts (belt and braces —
 * the claim object is created per session and shared with the wiring).
 *
 * Idempotence: the built factory is stamped WIDGET_WRAPPED (mirroring
 * editor.ts's WRAPPED) so a reload cycle re-running session_start with
 * our wrapper already installed never STACKS a layer around itself —
 * instead index.ts RE-BINDS: it replaces the installed wrapper with a
 * fresh composition around the ORIGINAL (remembered, pre-hapax)
 * factory, bound to the new session's store/config/chain/restoreReady
 * (2026-10 stale-store fix — the old keep-installed behavior left the
 * widget querying the previous session's store after any in-process
 * session_start re-fire). TOCTOU with an extension calling
 * setEditorComponent AFTER our read is the same accepted tolerance as
 * today's enter-submit wrap (a later re-fire re-reads and wraps the
 * new owner's factory).
 */

import { matchesKey } from "@earendil-works/pi-tui";
import { matchFragment, rankMatches } from "../core/query.js";
import type { CandidateStore } from "../core/store.js";
import type { RankedMatch, Successor } from "../core/types.js";
import { resolveFuzzThreshold, type HapaxConfig } from "./config.js";
import { createChainGrantTracker, type ChainGrantTracker } from "./chain-grant.js";
import {
  createEnterSubmitEditor,
  isSubmitKey,
  type EditorLike,
  type KeybindingsLike,
} from "./editor.js";
import {
  classifyStockContext,
  extractMatchState,
  type ChainMachine,
} from "./provider.js";

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
   *  before_agent_start (createChainMachine). READ by the tab-insert
   *  branch (BUG-001 fix, 2026-10): a consumed whole-word / trigger-span
   *  / chain-successor accept arms it at the accepted record's store key
   *  (enableChaining-gated, tier-0 skipped, never on span-miss
   *  forwards). The successor-offer consult branch is P1.M1.T2.S1; the
   *  shared one-shot grant tracker is P1.M1.T2.S2. */
  chain: ChainMachine;
  /** Test seam: the ONE-SHOT grant tracker (spec/07:450–457, plan 004
   *  T2.S2) shared by the consult branch (ticks before paints) and the
   *  tab-insert arm site (reset beside chain.arm). Absent → the factory
   *  creates one, so production wiring is zero-config; injected → tests
   *  can spy/reset or share an instance deliberately. */
  grant?: ChainGrantTracker;
  /** Line-claim controller (spec §07 "Line claim", 2026-10): the row,
   *  once first shown for a prompt, renders BLANK-while-empty until
   *  release (submit / turn reset / session rebind) instead of being
   *  removed. Absent → the factory creates one per built editor;
   *  injected → the session wiring (index.ts) can release it on
   *  before_agent_start, and tests can drive/assert it directly. */
  claim?: LineClaim;
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

/** Per-built-editor visibility machine seam (T2): T3's key handler
 *  reaches onDismissed(true/false) here; tests drive/assert the machine
 *  through the composed editor. */
const WIDGET_MACHINE = Symbol("hapax.widgetMachine");

/** The visibility machine of a BUILT editor (or undefined when
 *  `editor` is not a hapax widget composition — see WIDGET_MACHINE). */
export function widgetMachineOf(editor: unknown): VisibilityMachine | undefined {
  if (editor === null || typeof editor !== "object") return undefined;
  return (editor as { [WIDGET_MACHINE]?: VisibilityMachine })[WIDGET_MACHINE];
}

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
 * Width-fit core shared by rendering (renderWidgetLine) and key
 * handling (the T3 highlight decisions must see the same list the user
 * sees): applies BOTH caps — at most `maxSuggestions` items (leftmost
 * first; input is rankMatches output, already final-ranked, never
 * re-sorted), then a greedy width fit left→right where an item is
 * admissible only if the joined line WITH it (separator included)
 * still fits. Overflow drops the RIGHTMOST (lowest-ranked) items —
 * never ellipsis, never wrap, never a truncated word. Length
 * arithmetic runs on the PLAIN display strings (ANSI-styled text must
 * never feed the width fit — its .length counts escape codes, not
 * columns). An empty result means NO line can exist (invariant 3).
 */
function fitItems(
  items: readonly { display: string }[],
  width: number,
  maxSuggestions: number,
): { display: string }[] {
  // Cap 1 — count (leftmost first; input order is rank order).
  const capped = items.slice(0, Math.max(0, maxSuggestions));
  const kept: { display: string }[] = [];
  for (const item of capped) {
    const display = item.display;
    const candidateLength =
      kept.length === 0
        ? display.length
        : kept.map((k) => k.display).join(" | ").length +
          " | ".length +
          display.length;
    if (candidateLength > width) {
      if (kept.length === 0) return kept; // not even one word fits
      break; // drop the rightmost (lowest-ranked) remainder
    }
    kept.push(item);
  }
  return kept;
}

/**
 * Build the one-line widget (spec §07 h3.8): candidates joined by
 * " | " in rank order, display strings ONLY. Returns null when there
 * is no CONTENT line (invariant 3 — zero items, or not even the first
 * item fits `width`); the render GLUE decides absent-vs-blank from
 * there per the Line claim (unclaimed → byte-identical inner lines,
 * claimed → one blank row, spec §07).
 *
 * Caps and the width fit are fitItems (above). `accent` is applied
 * last, only to the item at `highlightIndex` (clamped into the
 * rendered list).
 */
export function renderWidgetLine(
  items: readonly { display: string }[],
  opts: WidgetLineOptions,
): string | null {
  const kept = fitItems(items, opts.width, opts.maxSuggestions);
  if (kept.length === 0) return null; // invariant 3 — structurally absent
  const hi = Math.max(0, Math.min(opts.highlightIndex, kept.length - 1));
  return kept.map((item, i) => (i === hi ? opts.accent(item.display) : item.display)).join(" | ");
}

// ── S2: widget state holder (T2 drives set/hide; T3 moves highlight) ────────

/** Minimal seam over the per-editor widget state. `set` replaces the
 *  result set and RESETS highlightIndex to 0 (spec h3.8: "resets to
 *  [leftmost] on every result-set change") and `interacted` to false
 *  (2026-10 model v2: a genuinely-new result set starts a fresh
 *  generation — the signature compare upstream means set() fires
 *  exactly at set changes, so set() IS the generation boundary);
 *  `hide` renders nothing (dismiss/suppress/zero — invariant 3) and
 *  defensively resets `interacted` too. Highlight MOVEMENT (arrows) is
 *  T3's API — a plain mutable `highlightIndex` field suffices. */
export interface WidgetState {
  /** Replace the result set (resets highlightIndex to 0 and interacted
   *  to false, clears the hidden flag — the visibility machine owns the
   *  show/hide policy). */
  set(items: readonly { display: string }[]): void;
  /** Hide the line (dismiss/suppress/zero) — renders nothing. */
  hide(): void;
  /** 0-based highlight index within the CURRENT rendered list. */
  highlightIndex: number;
  /** True once an arrow has MOVED the highlight in the CURRENT
   *  generation (2026-10 model v2): un-entered boundary ↑/← pass
   *  through (one-press plain-pi parity) while interacted edges wrap
   *  end-to-end (carousel). Reset by set() — a genuinely-new result set
   *  — and defensively by hide(). A pass-through press, Tab, Enter, and
   *  Escape NEVER set it; a one-word line therefore never becomes
   *  interacted (its →/↓ forwards pre-entry). The WIRING sets it when a
   *  navigate decision lands — the decision itself stays pure. */
  interacted: boolean;
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
    interacted: false,
    set(items: readonly { display: string }[]): void {
      state.items = [...items];
      state.highlightIndex = 0; // spec h3.8: reset to leftmost on set change
      state.interacted = false; // v2: a new result set starts a fresh generation
      state.hidden = false;
    },
    hide(): void {
      state.hidden = true;
      state.items = [];
      state.interacted = false; // defensive — a hidden line has no generation
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

// ── Line claim (spec §07 "Line claim", 2026-10 owner rule) ───────────────────

/** Per-prompt ROW reservation controller (spec §07 "Line claim"):
 *  once the widget line first renders a NON-EMPTY result set during a
 *  prompt, the row directly below the editor is OWNED by hapax until
 *  an interface reflow — every would-be-hide state (zero candidates,
 *  disqualification, trailing-space close, dismissal, suppression,
 *  stock contexts) renders the row BLANK instead of removing it, so
 *  the input area never jumps by one line mid-prompt (the stock
 *  vertical menu reserves its space the same way until pi-tui
 *  reflows, e.g. on submit).
 *
 *  Arming lives at the render override (only a line that actually
 *  painted claims — an unfittable word never does); release lives at
 *  the submit key (this file's key layer) and at before_agent_start /
 *  session rebind (index.ts wiring, via the shared instance passed in
 *  WidgetLayerOptions.claim). Deliberately NOT part of the visibility
 *  machine: the claim never changes show/hide/suppress decisions — it
 *  is a RENDER-layer concern (blank vs absent), and keeping it here
 *  means the machine's tests are untouched. */
export interface LineClaim {
  /** True once the row is claimed for the current prompt (armed at the
   *  first non-empty render; false again after release). */
  held(): boolean;
  /** Arm the claim (idempotent) — called by the render override exactly
   *  when a non-empty widget line is appended. */
  arm(): void;
  /** Release the claim (idempotent) — the row stops rendering until a
   *  later first-show re-arms it. */
  release(): void;
}

/** Fresh UNCLAIMED controller (one per session in index.ts, injected
 *  into the widget factory; the factory also creates one per built
 *  editor when absent — tests may pass their own). */
export function createLineClaim(): LineClaim {
  let held = false;
  return {
    held: () => held,
    arm: () => {
      held = true;
    },
    release: () => {
      held = false;
    },
  };
}

// ── T2/S1: the visibility machine (spec §07 h3.10, "auto-open, re-based") ───

/** What the visibility machine hands to rendering/key-handling
 *  (spec §07 h3.10): a pure decision snapshot, recomputed per input
 *  event. Pushing it into the S2 WidgetState is the wiring's job. */
export interface VisibilityState {
  /** Should the widget line render right now? */
  visible: boolean;
  /** Explicit dismissal (Escape/boundary-pass-through, set via
   *  onDismissed(true))
   *  — the line stays hidden until the next word start or trigger char. */
  suppressUntilWordStart: boolean;
  /** The current (post-debounce/hysteresis) result set to render —
   *  { display } items in rank order. Empty when not visible. */
  currentSet: readonly { display: string }[];
}

/** Dependencies of the visibility machine — all injected so tests drive
 *  a fake editor stream with a stubbed query (no store, no pi). */
export interface VisibilityMachineDeps {
  store: CandidateStore;
  /** triggerChar, threshold, fuzzThreshold, maxSuggestions, menuDelayMs
   *  (loadConfig-clamped — never re-validated here). */
  config: HapaxConfig;
  /** Live editor state per tick — the wiring closes this over the
   *  composed editor's getLines()/getCursor() (reads only, never
   *  mutated). Tests inject a mutable fake. */
  getEditorState: () => { lines: string[]; line: number; col: number };
  /** Settled when history replay finishes (the shared gate signal,
   *  index.ts's restoreReady). Queries before settle are HELD and
   *  re-evaluated when it settles — bounded at 500 ms (the same bound
   *  as the fallback's createStartupGate); a settled promise is a
   *  pass-through (fresh sessions). */
  restoreReady: Promise<void>;
  /** Test seam: the query core entry point, threaded with the match
   *  mode. Default: rankMatches(store, fragment, { limit:
   *  maxSuggestions, fuzzThreshold: resolveFuzzThreshold(config, mode),
   *  loose: mode === "trigger" }) — the SAME per-mode resolution as the
   *  provider call site (spec §04 h2.28, plan 004): trigger 45 + the
   *  loose tier-0 pass, ambient 60 with the zero-result precondition;
   *  an explicit fuzzThreshold setting overrides both. The threshold
   *  discard happens inside, so "≥ 1 candidate above fuzzThreshold" ===
   *  non-empty result. */
  query?: (fragment: string, mode: "trigger" | "ambient") => RankedMatch[];
  /** Tab-chain machine (BUG-001 fix, P1.M1.T2.S1): when armed (and
   *  config.enableChaining), evaluate consults store.topSuccessors at
   *  empty word starts / word-start fragments BEFORE the normal query —
   *  mirroring the provider armed branch (provider.ts). Optional so
   *  idle-chain builds and tests without a machine change behavior. */
  chain?: ChainMachine;
  /** One-shot grant tracker (spec/07:450–457, plan 004 T2.S2): the
   *  consult branch ticks it BEFORE painting offers (the granted offer's
   *  word is word 1); a spent grant resets the chain and falls through.
   *  Absent → the machine creates its own, so direct machine tests need
   *  no wiring; the factory always passes ITS instance so the machine
   *  and the tab-insert arm site share one grant (no drift). */
  grant?: ChainGrantTracker;
  /** Called after every paint() — INCLUDING swap-timer promotions — so
   *  the wiring can push the fresh snapshot and request a repaint even
   *  when no keystroke tick follows (W1 fix, P1.M3.T4.S1: a parked swap
   *  that promotes at rest must still reach the screen). */
  onPaint?: () => void;
  /** Intent test ADDITIONAL to trigger mode (explicit intent bypasses
   *  the hesitation gate, spec h2.46 rule 2). The machine accounts for
   *  its OWN chain offers internally (chainIntent — a chain paint this
   *  tick bypasses hesitation without consulting this dep); this seam
   *  remains for EXTERNAL intent sources. Default: nothing extra. */
  isIntentBypass?: () => boolean;
  /** Swap-debounce window; default 100 (spec h2.46 rule 2). */
  debounceMs?: number;
  /** Fresh-reopen window after a close; default 200 (spec h2.46 rule 3). */
  reopenMs?: number;
}

export interface VisibilityMachine {
  /** Run once per input event — the onKeystroke tick. Synchronous:
   *  reads live editor state + the pure helpers, decides show/hide/
   *  suppress, and returns the fresh snapshot. */
  onInput(): VisibilityState;
  /** T3 key-handler seam: explicit=true (Escape/boundary-pass-through) sets
   *  suppressUntilWordStart and hides; explicit=false (disqualification-
   *  style close) hides only. */
  onDismissed(explicit: boolean): void;
  /** Current snapshot (for render glue / tests). */
  getState(): VisibilityState;
  /** The currently painted match records (the machine's own
   *  RankedMatch list, verbatim — not reshaped), aligned 1:1 with
   *  VisibilityState.currentSet in ORDER and LIFETIME: populated on
   *  paint() (the single write site — swap-debounce promotions route
   *  through it), cleared on hide() (closeWith delegates there).
   *  The Tab-insert arming seam (BUG-001 fix, P1.M1.T1.S2): the
   *  accepted item's key (the store key for chain.arm) and tier
   *  (tier-0 anchorless matches never arm — spec §04) are read here,
   *  mirroring the provider path's applyCompletion classification.
   *  Chain-offer shims (P1.M1.T2.S1) paint through the same site and
   *  surface here automatically. */
  painted(): readonly RankedMatch[];
  /** Release the machine's timers (pending swap, gate deadline) — a
   *  lifecycle courtesy for teardown; not required for correctness
   *  (timers are self-invalidating). */
  dispose(): void;
}

/** Startup-gate bound, shared with the fallback's createStartupGate
 *  default (≤ 500 ms). */
const GATE_MAX_WAIT_MS = 500;

/** Global timer bindings read off globalThis (never node:timers) so
 *  environment doubles — vitest fake timers — are honored (same
 *  pattern as ingest.ts). */
interface WidgetTimerGlobals {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}
const widgetTimers = globalThis as unknown as WidgetTimerGlobals;

/**
 * The widget path's visibility state machine (spec §07 h3.10): a per-
 * keystroke, INPUT-CLOCK-DRIVEN decision core — no pi-tui request
 * cadence exists here (r4 §2). Every `onInput()` tick: record the
 * timestamp FIRST (rule 0 — the hesitation gate's gap math needs
 * consecutive-tick deltas even for ticks that end in hide), read live
 * editor state through the injected seam, then decide:
 *
 *   R1  stock contexts (classifyStockContext — ALWAYS ahead of
 *       extractMatchState, which cannot see slash/@/path) → hidden,
 *       never suppression (stock contexts are not dismissal).
 *   R2  startup gate: queries before restoreReady settles (or the
 *       500 ms bound elapses) are HELD — the settle/deadline wake
 *       re-evaluates the live state and paints if it qualifies.
 *   R3  no fragment → close (trailing space without @// is the
 *       close-on-space flavor; both are close events, neither
 *       suppresses).
 *   R4  zero candidates → disqualification close (never suppresses);
 *       with candidates: explicit-dismissal suppression releases only
 *       at a NEW word start (or trigger mode — same-word continuation
 *       stays hidden).
 *   R5  hesitation gate (menuDelayMs, 0 = OFF): a CLOSED line opens on
 *       a word-mode set only when the tick gap ≥ menuDelayMs; trigger
 *       mode, the isIntentBypass seam, and a fresh close (< reopenMs)
 *       bypass it.
 *   R6  100 ms swap debounce + flicker hysteresis: once visible, a
 *       differing set paints only after the window; otherwise it is
 *       parked as a pending swap (newer keystrokes supersede) while
 *       the OLD set stays on screen — narrowing never closes+reopens.
 *   R7  cursor move with unchanged text → close; a close followed by
 *       a qualifying keystroke within reopenMs re-opens FRESH (the
 *       set is always the live query's — never the pre-close set).
 *
 * Pure-core discipline: the machine NEVER mutates the editor, never
 * renders, never consumes keys. The timing stack (swap debounce,
 * hysteresis, hesitation, startup gate) is RE-HOMED from the fallback's
 * createDisplayProvider by copy (spec h2.42: both paths share the
 * LOGIC — the fallback code stays untouched; the pull-model
 * prefix-anchor/acceptance exceptions have no push-model equivalent
 * here because every tick re-queries the live buffer).
 */
export function createVisibilityMachine(
  deps: VisibilityMachineDeps,
): VisibilityMachine {
  const debounceMs = deps.debounceMs ?? 100;
  const reopenMs = deps.reopenMs ?? 200;
  const menuDelayMs = deps.config.menuDelayMs ?? 0;
  const grant = deps.grant ?? createChainGrantTracker();
  const query =
    deps.query ??
    ((fragment: string, mode: "trigger" | "ambient"): RankedMatch[] =>
      rankMatches(deps.store, fragment, {
        limit: deps.config.maxSuggestions,
        // Per-mode fuzz resolution — the SAME helper as the provider call
        // site (spec §04 h2.28, plan 004): trigger 45 + the loose tier-0
        // pass, ambient 60 with the zero-result precondition; an explicit
        // fuzzThreshold setting overrides both mode defaults.
        fuzzThreshold: resolveFuzzThreshold(deps.config, mode),
        loose: mode === "trigger",
      }));

  // Visibility snapshot (what render/key-handling see).
  let visible = false;
  let suppressed = false;
  let currentSet: readonly { display: string }[] = [];
  // The painted RECORDS behind currentSet (BUG-001 arming seam): same
  // lifetime, same order — both derive from paint()'s one `items`
  // argument, so the pair cannot drift. Cleared only in hide().
  let paintedSet: readonly RankedMatch[] = [];

  // Rule 0 — input clock: EVERY onInput tick records (gap math needs
  // consecutive-tick deltas even for hide/delegate/stock ticks).
  let lastTickAt: number | null = null;

  // Rule 7 — cursor-move detection: identical text + moved cursor.
  let lastFingerprint: string | null = null;
  let lastLine = -1;
  let lastCol = -1;

  // Rule 6 — swap debounce: displayed* is what the line shows; pending*
  // is the swap parked inside the window (superseded per keystroke).
  let displayedSig: string | null = null;
  let lastPaintAt = 0;
  let pendingSet: readonly RankedMatch[] | null = null;
  let swapTimer: unknown = null;

  // Rule 7 — hysteresis bookkeeping: Date.now() of the last close event
  // (cursor-move, disqualification, space/no-fragment close, dismissal —
  // NOT stock-context hides: leaving pi's context is not a hapax close).
  let closeAt: number | null = null;

  // Rule 4 — explicit-dismissal suppression (spec/07:72–75: "Explicit
  // dismissal … suppresses the line for the REST OF THE WORD. Re-open
  // only at the next word start or trigger char."): released at a NEW
  // word start — at a word boundary whose fragment start differs from
  // the dismissed one AND whose buffer is not a same-word continuation
  // of the dismissed buffer. Same-word continuation (extend / edit /
  // backspace within one buffer) means one buffer is a prefix of the
  // other; a submitted-and-cleared buffer matches neither direction, so
  // the next message's first word — which is a start-0 word start, the
  // numeric-start comparison's blind spot (BUG-003: a start-0 dismissal
  // used to suppress every following message's first word) — releases.
  // The fingerprint is lines.join("\n") of the DISMISSED buffer (multi-
  // line safe; distinct from rule 7's lastFingerprint — different
  // lifetime). null means context-free: the dismissal happened on an
  // empty buffer, so any boundary releases. Cleared ONLY in paint(),
  // beside suppressedFragmentStart.
  let suppressedFragmentStart: number | null = null;
  let suppressedFingerprint: string | null = null;

  // Chain-offer intent (BUG-001 fix, P1.M1.T2.S1): set when THIS tick's
  // evaluation painted a chain offer, read by R5's intent computation,
  // reset at the TOP of every evaluate — a stale flag would bypass
  // hesitation for a subsequent normal word-mode paint.
  let chainIntent = false;

  /** RankedMatch shim for one chain successor (BUG-001 fix): painted
   *  through paint() so currentSet + painted() populate together.
   *  - key = s.next PLAIN (no prefix — the widget has no liveKeyByValue;
   *    the plain key IS the store key, so T1.S2's tab-insert arming
   *    (which reads painted()) re-arms at s.next for free).
   *  - display from the word's own store entry (most-recent-casing-wins,
   *    same as word completions); evicted successor → lowercase key.
   *  - tier deliberately OMITTED: the arming gate is `rec.tier !== 0`,
   *    so undefined arms (chain members passed an anchored membership
   *    gate) — setting tier: 0 would silently break successor re-arm.
   *  - salience is negative-count (provider publishChain parity); count
   *    order is preserved by topSuccessors — no re-sort anywhere. */
  const chainShim = (s: Successor): RankedMatch => ({
    key: s.next,
    display: deps.store.get(s.next)?.display ?? s.next,
    description: "chain", // provenance marker (provider publishChain parity)
    salience: -s.count,
    sessionCount: s.count,
  });

  // Rule 2 — startup gate.
  let settled = false;
  let gateDeadline: number | null = null;
  let gateTimer: unknown = null;

  const clearSwapTimer = (): void => {
    if (swapTimer !== null) {
      widgetTimers.clearTimeout(swapTimer);
      swapTimer = null;
    }
  };

  const state = (): VisibilityState => ({
    visible,
    suppressUntilWordStart: suppressed,
    currentSet,
  });

  /** Hide without a close-event stamp (stock contexts, gate holds). */
  const hide = (): void => {
    visible = false;
    currentSet = [];
    paintedSet = []; // lifetime parity: empty exactly when currentSet is
    displayedSig = null;
    pendingSet = null;
    clearSwapTimer();
  };

  /** Hide AS a close event — stamps closeAt for the fresh-reopen window
   *  (hysteresis: a qualifying keystroke within reopenMs re-opens). */
  const closeWith = (now: number): void => {
    hide();
    closeAt = now;
  };

  /** Make `items` the displayed set and advance the window clock. A
   *  qualifying paint RELEASES suppression (the release conditions were
   *  checked on the way in: word start / trigger mode). */
  const paint = (
    items: readonly RankedMatch[],
    sig: string,
    now: number,
  ): void => {
    clearSwapTimer();
    pendingSet = null;
    visible = true;
    currentSet = items.map((m) => ({ display: m.display }));
    paintedSet = items; // arming seam: same order as currentSet by construction
    displayedSig = sig;
    lastPaintAt = now;
    closeAt = null;
    suppressed = false;
    suppressedFragmentStart = null;
    suppressedFingerprint = null;
    deps.onPaint?.(); // W1 fix: timer-driven paints must reach the screen too
  };

  /** Rule 6 — park a differing set as the pending swap; a newer
   *  keystroke supersedes the timer (re-scheduled, never stacked). */
  const parkSwap = (items: readonly RankedMatch[]): void => {
    pendingSet = items;
    clearSwapTimer();
    swapTimer = widgetTimers.setTimeout(() => {
      swapTimer = null;
      if (pendingSet === null || !visible) return; // superseded/closed
      const items = pendingSet;
      paint(items, items.map((m) => m.display).join("\u0000"), Date.now());
    }, debounceMs);
  };

  /** Rule 2 — re-evaluate on a gate wake (settle or deadline). NOT a
   *  keystroke: the input clock is untouched; the decision simply runs
   *  again against the LIVE editor state (its repaint surfaces at the
   *  next natural render — no forced repaint is requested, matching
   *  the recorded repaint strategy in the file header). */
  const wakeEvaluate = (): void => {
    const { lines, line, col } = deps.getEditorState();
    evaluate(Date.now(), lastTickAt, lines, line, col);
  };

  const armGate = (now: number): void => {
    if (gateDeadline !== null) return; // armed once, at the first held query
    gateDeadline = now + GATE_MAX_WAIT_MS;
    gateTimer = widgetTimers.setTimeout(() => {
      gateTimer = null;
      wakeEvaluate(); // bound elapsed → re-evaluate regardless of settle
    }, GATE_MAX_WAIT_MS);
  };
  void deps.restoreReady.then(
    () => {
      settled = true; // replay errors settle too — never wedge the gate
      wakeEvaluate();
    },
    () => {
      settled = true;
      wakeEvaluate();
    },
  );

  /** The decision core (shared by onInput and gate wakes) — runs after
   *  timestamp/cursor bookkeeping. `prev` is the PREVIOUS tick's time
   *  (null before the first): the hesitation gate's gap source. */
  function evaluate(
    now: number,
    prev: number | null,
    lines: string[],
    line: number,
    col: number,
  ): VisibilityState {
    // Chain-offer intent is per-tick: reset BEFORE any path can set it.
    chainIntent = false;
    // Suppression LAPSE (2026-10 wedge fix, spec §07 key-handling
    // dismissal bullet): the moment a tick OBSERVES the dismissed word
    // occurrence GONE — the live buffer is a prefix of the dismissed
    // fingerprint that no longer reaches the dismissed fragment's start
    // (fully backspaced, the empty buffer included) — suppression is
    // OVER: whatever gets typed there next is a NEW word at a word
    // start ("re-open at the next word start"), never a same-word
    // continuation. Without this a Tab-completed FIRST word (fragment
    // start 0, no preceding space to delete) wedged forever: every
    // retype was prefix-indistinguishable from same-word backspacing
    // (live-observed 2026-10: tab-complete → backspace → no suggestions
    // until a differently-starting word). Runs BEFORE R1 so ticks that
    // never reach the R4 check (empty buffer → R3, stock contexts →
    // R1) still observe the removal; it only ever RELEASES (shows
    // sooner), never suppresses, so the BUG-003 cross-message release
    // is unaffected. Length is the JOINED buffer's — exact for
    // single-line dismissals, and the multi-line corner can only err
    // toward releasing (the safe direction).
    if (
      suppressed &&
      suppressedFingerprint !== null &&
      suppressedFragmentStart !== null
    ) {
      const liveBuffer = lines.join("\n");
      if (
        suppressedFingerprint.startsWith(liveBuffer) &&
        liveBuffer.length <= suppressedFragmentStart
      ) {
        suppressed = false;
        suppressedFragmentStart = null;
        suppressedFingerprint = null;
      }
    }
    // R1 — stock contexts OWN slash/@/quoted-path/path verdicts; classify
    // FIRST (extractMatchState is blind to them). Hidden, no suppression,
    // no close stamp: leaving pi's context is not a hapax close.
    if (classifyStockContext(lines, line, col) !== null) {
      hide();
      return state();
    }

    // BUG-001 fix (P1.M1.T2.S1) — CHAIN CONSULT: while a word is armed
    // (and chaining enabled), the chain answers BEFORE the normal query,
    // mirroring the provider's armed branch (provider.ts): (a) a zero-
    // typed-char offer at an empty word start; (b) word-start fragment
    // filtering at threshold 0 (matchFragment membership — NEVER
    // resolveFuzzThreshold here: the chain gate is membership, full
    // stop); (c) disqualification resets and falls through to the normal
    // path on this SAME tick. R1 already ran above — armed chains never
    // override stock contexts (provider.ts parity). All chain calls are
    // fully defensive (optional member access): a partial/double-shaped
    // dep degrades to inert, never to a thrown tick.
    const armed = deps.chain?.state?.();
    if (armed && deps.config.enableChaining) {
      const before = (lines[line] ?? "").slice(0, col);

      // Restore-gate parity with R2: chain offers never fire during
      // history replay (they would race the replaying store) — hold
      // exactly like a normal query would; the settle/deadline wake
      // re-evaluates the live state.
      if (!settled && (gateDeadline === null || now < gateDeadline)) {
        armGate(now);
        return state();
      }

      // ONE-SHOT GRANT (spec/07:450–457, plan 004 T2.S2) — tick BEFORE any
      // paint: the granted offer's word is word 1 (the first tick with a
      // null history sets seen=1, never disarms), so ticking after the
      // paint would disarm one word late. Null prefixes (glued
      // punctuation, no trailing word) skip the tick entirely — the (c)
      // guards below own disqualification, exactly like the provider's
      // armed branch. Spent → the tracker has already zeroed itself: reset
      // the chain and fall through — the normal (hesitation-gated) path
      // answers this SAME tick, byte-for-byte the (c) precedent.
      const curArmedPrefix =
        before === "" || /[ \t]$/.test(before)
          ? ""
          : (before.match(/[A-Za-z][A-Za-z0-9_]*$/)?.[0] ?? null);
      const grantSpent =
        curArmedPrefix !== null && grant.tick(curArmedPrefix);
      if (grantSpent) {
        deps.chain?.reset?.();
        chainIntent = false;
      }

      if (!grantSpent) {
        const succ: Successor[] = [];
        if (before === "" || /[ \t]$/.test(before)) {
          // (a) Zero-typed-char offer: cursor at an EMPTY word start.
          succ.push(
            ...deps.store
              .topSuccessors(armed.word)
              .slice(0, deps.config.maxSuggestions),
          );
        } else {
          // (b) Typed fragment at a WORD START (BUG-005 guard, provider
          // parity): a fragment glued to the trigger char or punctuation
          // is not a chain fragment — pi-tui-style blind prefix deletion
          // would strand the glue. Membership filter, threshold 0.
          const frag = before.match(/[A-Za-z][A-Za-z0-9_]*$/)?.[0];
          const fragAt = frag === undefined ? -1 : before.length - frag.length;
          const atWordStart =
            frag !== undefined &&
            (fragAt === 0 || /[ \t]/.test(before[fragAt - 1] ?? ""));
          if (frag !== undefined && atWordStart) {
            succ.push(
              ...deps.store
                .topSuccessors(armed.word)
                .filter(
                  (s) =>
                    s.next !== frag.toLowerCase() && // exact-equal exclusion (§07 h2.49 parity with §04 h2.29)
                    matchFragment(frag, s.next) !== null,
                )
                .slice(0, deps.config.maxSuggestions),
            );
          }
        }
  
        if (succ.length > 0) {
          const items = succ.map(chainShim);
          chainIntent = true; // R5 intent: a chain paint bypasses hesitation
          const sig = items.map((m) => m.display).join("\u0000");
          // Suppression note: chain offers are INTENT — this branch paints
          // even under explicit-dismissal suppression (mirroring trigger
          // mode's R4 bypass). Suppression-release refinement lands in
          // P1.M2.T2.S1 on this same block.
          // R6/R7 composition (fallback parity): the FIRST paint is
          // immediate; a visible line refreshes idempotently on the same
          // set, paints an elapsed-window change, and PARKS a differing
          // set inside the swap window (narrowing never closes+reopens).
          if (!visible) {
            paint(items, sig, now);
            return state();
          }
          if (sig === displayedSig) {
            paint(items, sig, now);
            return state();
          }
          if (now - lastPaintAt >= debounceMs) {
            paint(items, sig, now);
            return state();
          }
          parkSwap(items);
          return state();
        }
        // (c) Disqualification: glued fragment ('#q' — trigger mode wins
        // at '#q'), non-start/punctuation fragment, or zero matching
        // successors → reset + fall through to the normal path on this
        // SAME tick (the provider's reset-WITHOUT-return precedent).
        // NEVER paint an empty set; NEVER return one from this branch.
        // (Also the grant-spent fall-through target — see the tick above.)
        deps.chain?.reset?.();
        chainIntent = false;
      } // if (!grantSpent) — the whole offer half is grant-gated
    }

    // Threshold clamp (spec §07 trigger modes: word matching is effective
    // from 1 typed char — config.threshold is RETAINED BUT INERT in the
    // live editor). Same clamp as the fallback path (provider.ts
    // getSuggestions); without it a 1-char ambient fragment returns null
    // and the line never opens on the first keystroke (spec invariant 2).
    const match = extractMatchState(lines, line, col, {
      ...deps.config,
      threshold: 1,
    });
    if (match === null) {
      // R3 — close-event taxonomy (both flavors stamp closeAt, neither
      // suppresses): a trailing space/tab with no @// anywhere before the
      // cursor is the close-on-space rule; any other no-fragment position
      // is the plain "nothing to offer" close.
      closeWith(now);
      return state();
    }

    // R2 — startup gate: hold qualifying queries until settle or the
    // 500 ms bound; the wake re-evaluates (armGate fires once).
    if (!settled && (gateDeadline === null || now < gateDeadline)) {
      armGate(now);
      return state();
    }

    const matches = query(
      match.fragment,
      match.mode === "trigger" ? "trigger" : "ambient",
    );
    if (matches.length === 0) {
      // R4 — disqualification close: clears the set, NEVER suppresses
      // (the next qualifying keystroke reopens).
      closeWith(now);
      return state();
    }

    // R4 — explicit-dismissal suppression: word-mode results show only
    // at a NEW word start (line start / after a non-word char) — a
    // DIFFERENT one from the dismissed fragment's, AND a buffer that is
    // not a same-word continuation of the dismissed one, so extending
    // the same word stays hidden while the next message's first word
    // releases (BUG-003: the start-only test leaked across messages).
    // Trigger mode bypasses entirely.
    if (suppressed && match.mode !== "trigger") {
      const start = col - match.fragment.length;
      const atBoundary =
        start <= 0 || !/[A-Za-z0-9_]/.test((lines[line] ?? "")[start - 1]!);
      // Same-word continuation (BUG-003): the current buffer must still
      // be the dismissed context — one of the two a prefix of the other.
      // A cleared/rewritten buffer matches neither direction → release.
      // fp === null (empty dismissed buffer) is context-free: release.
      // An empty CURRENT buffer never reaches here — the lapse above
      // clears suppression the moment the dismissed word's region is
      // observed gone (2026-10 wedge fix); within-word backspaces
      // (buffer still past the dismissed start) stay suppressed.
      const fp = suppressedFingerprint;
      const current = lines.join("\n");
      const sameWordContinuation =
        fp !== null && (current.startsWith(fp) || fp.startsWith(current));
      const released =
        !atBoundary ||
        start !== suppressedFragmentStart ||
        !sameWordContinuation;
      if (!released) {
        return state(); // stay suppressed — hidden, flags kept
      }
    }

    const intent =
      match.mode === "trigger" || chainIntent || (deps.isIntentBypass?.() ?? false);
    // R7 — fresh-reopen hysteresis: a close < reopenMs ago means active
    // editing — the reopen is immediate (hesitation bypassed) and FRESH
    // (the set below is this tick's live query, never the old one).
    const freshReopen = closeAt !== null && now - closeAt < reopenMs;
    const sig = matches.map((m) => m.display).join("\u0000");

    if (!visible) {
      // R5 — hesitation gate: a CLOSED line opens on a word-mode set
      // only when the tick gap ≥ menuDelayMs (0 = OFF → first paint is
      // immediate). Trigger/intent/fresh-reopen bypass.
      if (
        !intent &&
        !freshReopen &&
        menuDelayMs > 0 &&
        prev !== null &&
        now - prev < menuDelayMs
      ) {
        return state(); // held — not a close event (the line never opened)
      }
      paint(matches, sig, now);
      return state();
    }

    // R6 — swap debounce on the open line. Identical set → idempotent
    // refresh (advances the window clock, cancels any stale pending).
    if (sig === displayedSig) {
      paint(matches, sig, now);
      return state();
    }
    if (now - lastPaintAt >= debounceMs) {
      paint(matches, sig, now);
      return state();
    }
    // Inside the window: keep the OLD set on screen (flicker hysteresis
    // — narrowing must not close+reopen); park the new one; a newer
    // keystroke supersedes the pending swap. A disqualifying tick above
    // already closed the line ("or the set empties").
    parkSwap(matches);
    return state();
  }

  return {
    onInput(): VisibilityState {
      // Rule 0 — bookkeeping FIRST, before any state read.
      const now = Date.now();
      const prev = lastTickAt;
      lastTickAt = now;
      const { lines, line, col } = deps.getEditorState();
      // R7 — cursor move with unchanged text (a click / paste-reset that
      // ticked the clock; arrow keys consumed by T3 never tick): close,
      // no suppression.
      const fingerprint = lines.join("\n");
      const movedCursor =
        lastFingerprint !== null &&
        fingerprint === lastFingerprint &&
        (line !== lastLine || col !== lastCol);
      lastFingerprint = fingerprint;
      lastLine = line;
      lastCol = col;
      if (movedCursor) {
        closeWith(now);
        return state();
      }
      return evaluate(now, prev, lines, line, col);
    },

    onDismissed(explicit: boolean): void {
      const now = Date.now();
      if (explicit) {
        // T3 seam (Escape / boundary pass-through / Tab-accept / Enter-submit):
        // suppress until a NEW word start or trigger char. Record the
        // dismissed fragment's start (the word-start half of the release
        // test) AND the dismissed buffer's fingerprint (the same-word
        // half — BUG-003), so release requires BOTH a different word
        // start AND a non-continuation buffer. An empty buffer records
        // null — context-free, any boundary releases.
        const { lines, line, col } = deps.getEditorState();
        // Same 1-char clamp as the evaluate path: the dismissed
        // fragment's start must be recorded identically to how the
        // visibility machine saw it, or the R4 release test (new word
        // start) mis-fires after dismissing a 1-char fragment.
        const match = extractMatchState(lines, line, col, {
          ...deps.config,
          threshold: 1,
        });
        suppressed = true;
        suppressedFragmentStart =
          match !== null && match.mode === "threshold"
            ? col - match.fragment.length
            : col;
        const dismissedBuffer = lines.join("\n");
        suppressedFingerprint = dismissedBuffer === "" ? null : dismissedBuffer;
      }
      closeWith(now);
    },

    getState: state,

    painted: () => paintedSet,

    dispose(): void {
      clearSwapTimer();
      if (gateTimer !== null) {
        widgetTimers.clearTimeout(gateTimer);
        gateTimer = null;
      }
    },
  };
}

// ── T3/S1: the widget key layer (spec §07 h3.9) ─────────────────────────────

/** Decision of the widget key layer for one input event (2026-10 model
 *  v2, spec §07 h3.9). Consumed decisions never reach the enter-submit
 *  guard; "forward" delegates verbatim. The completion keys:
 *  "tab-insert" (synchronously insert the highlighted word) and
 *  "enter-submit" (dismiss the line, THEN forward so the inner editor
 *  still submits — the guard itself stays in the chain). "boundary-
 *  pass-through" is the v2 one-press plain-pi parity arm: an un-entered
 *  ↑/← on the first word dismisses+suppresses AND forwards. The retired
 *  "clamp" arm is gone — interacted edges wrap end-to-end (carousel),
 *  so reaching an edge at all implies an interacted generation. */
export type WidgetKeyDecision =
  | { action: "navigate"; delta: -1 | 1 } // move the highlight; wraps emerge from the wiring's modular application
  | { action: "boundary-pass-through" } // un-entered first word + ↑/←: dismiss+suppress+FORWARD (caret moves)
  | { action: "escape" } // plain Escape: dismiss+consume+suppress
  | { action: "tab-insert" } // Tab: insert highlighted word, consume
  | { action: "enter-submit" } // Enter: dismiss, then forward (still submits)
  | { action: "forward" }; // everything else — never captured

/**
 * Pure decision — no editor access, trivially table-testable (the
 * wiring below owns every state mutation, including the `interacted`
 * generation flag). While the line is hidden or the rendered list is
 * empty NOTHING is captured (invariant 1 amendment: the capture window
 * exists only while the line is visible; zero candidates never render —
 * invariant 3). Keys are matched via pi-tui's matchesKey so custom
 * keybindings and the kitty protocol keep working (never raw ANSI byte
 * matching).
 *
 * The v2 table (2026-10, spec §07 h3.9 — all index math on the RENDERED
 * count; `highlightIndex` is clamped into [0, count-1] BEFORE the
 * boundary checks — the list can shrink between paints):
 *
 *   0. !visible || count ≤ 0                      → forward
 *   1. Escape (any state, any index)              → escape (consumed)
 *   2. ↑/←, un-entered, i = 0                     → boundary-pass-through
 *      (dismiss + suppress + FORWARD — the caret moves on this press)
 *   3. →/↓, un-entered, count = 1                 → forward (nothing to enter)
 *   4. →/↓, un-entered, multi-word                → navigate +1 (enters the
 *      list — the wiring sets interacted)
 *   5. ↑/←, interacted, i = 0                     → navigate −1 (wrap:
 *      the wiring's modular step lands at LAST)
 *   6. →/↓, interacted, i = count−1               → navigate +1 (wrap:
 *      lands at FIRST)
 *   7. interior arrows                            → navigate ±1
 *   8. un-entered arrow with i > 0 (theoretically
 *      unreachable — a stale index)               → navigate (DEGRADE,
 *      never forward: hapax's highlight must not disagree with the caret)
 *   9. Tab                                        → tab-insert
 *  10. submit key                                 → enter-submit
 *
 * Row order is load-bearing: the `interacted` checks precede the
 * boundary checks (rows 2–5 would invert), and the count=1 forward
 * (row 3) precedes the generic navigate arm (a one-word line must never
 * navigate to itself — that would be a consumed arrow pre-entry).
 * Wrap representation: plain ±1 — the WIRING applies it modularly
 * (((i + delta) % count + count) % count), which makes an interacted
 * edge step wrap end-to-end; the old clamping application would have
 * eaten the step at the edges instead. The stale-index clamp into
 * [0, count−1] stays (a stale index must not produce out-of-range
 * moves); only the clamp ACTION variant is retired.
 */
export function decideWidgetKey(
  data: string,
  visible: boolean,
  count: number,
  highlightIndex: number,
  interacted: boolean,
  keybindings?: KeybindingsLike,
): WidgetKeyDecision {
  if (!visible || count <= 0) return { action: "forward" };
  const i = Math.min(Math.max(highlightIndex, 0), count - 1);
  if (matchesKey(data, "escape")) return { action: "escape" };
  if (matchesKey(data, "up") || matchesKey(data, "left")) {
    if (!interacted && i === 0) return { action: "boundary-pass-through" };
    // Interior move; an interacted i = 0 (row 5) is ALSO −1 — the WRAP
    // emerges from the wiring's modular application (0 − 1 ≡ count−1).
    // (The design sketch's ±(count−1) deltas land at the wrong index:
    // (0 − (count−1)) mod count = 1, not count−1. Plain ±1 is the
    // representation whose modular landing matches the spec outcomes.)
    return { action: "navigate", delta: -1 };
  }
  if (matchesKey(data, "down") || matchesKey(data, "right")) {
    if (!interacted) {
      if (count === 1) return { action: "forward" }; // row 3: nothing to enter
      return { action: "navigate", delta: 1 }; // row 4: entering the list
    }
    // Interior move; an interacted i = count−1 (row 6) is ALSO +1 — the
    // wrap emerges modularly ((count−1) + 1 ≡ 0).
    return { action: "navigate", delta: 1 };
  }
  // S2 — the completion keys, only while a non-empty line is visible
  // (hidden/empty falls through to forward: literal Tab, plain Enter).
  if (matchesKey(data, "tab")) return { action: "tab-insert" };
  // The guard's OWN submit test (exported from editor.ts) — never a raw
  // "\r" re-derivation here, so custom keybindings stay consistent.
  if (isSubmitKey(data, keybindings)) return { action: "enter-submit" };
  return { action: "forward" };
}

/**
 * Tab acceptance (spec §07 h2.46 rule 0 / h3.9, P1.M3.T3.S2): insert the
 * highlighted candidate's DISPLAY string by REIMPLEMENTING stock
 * applyCompletion semantics against the live query — no provider item
 * exists on the widget path, so pi-tui never performs this edit. The
 * live state is read SYNCHRONOUSLY through the inner's public methods
 * (getLines/getCursor) — never a debounce/painted copy, zero awaits,
 * zero timers (the widget path does not depend on pi-tui's request
 * cadence, r4 §2/§5).
 *
 * The replaced span mirrors what the user actually typed, longest-
 * context first:
 *   1. extractMatchState's prefix (trigger mode: triggerChar +
 *      fragment — the trigger char is consumed; threshold mode: the
 *      hyphen-admitting fragment, provider.ts contract),
 *   2. else the raw trigger regex (a widget opened by an armed chain
 *      can sit on a below-threshold or zero-length trigger fragment),
 *   3. else the hyphen-admitting word regex — the same pattern
 *      provider.ts threshold mode matches with,
 *   4. else nothing that looks like a fragment → NOT consumed; the
 *      caller forwards the Tab verbatim (never-hijack rule: Tab with
 *      no live span passes through as a literal Tab).
 *
 * The edit goes through the inner's OWN public API: setText (public,
 * undoable — it pushes its own undo snapshot; another one must NOT be
 * added) — then a defensive setCursorCol caret fix, because setText
 * parks the caret at buffer END (setTextInternal "end") and mid-line
 * insertions would otherwise jump the caret. CALLING methods — even
 * the private-MARKED setCursorCol, present at runtime — is not
 * instance mutation; the v1 ban is on own-property WRITES.
 *
 * Stock parity: pi-tui's applyCompletion also fires onChange(getText())
 * after the edit (editor.js ~l.1906-1912) and setText does NOT — fire
 * it defensively when present so app-side draft bindings see the
 * programmatic insert exactly as they would a typed one (flagged
 * live-verify item for P1.M3.T4.S1).
 *
 * Dismissal: this is an EXPLICIT acceptance — hide() for the immediate
 * visual, then machine.onDismissed(true) (the ONLY suppression seam;
 * never onDismissed(false) from the key layer). The consumed key never
 * delegates, so requestRender is asked for defensively — best-effort.
 *
 * Chain arming (BUG-001 fix, 2026-10): lives at the CALL SITE (the
 * tab-insert branch in the key handler), NOT here — the accepted record
 * must be captured from machine.painted() BEFORE this function runs,
 * because the success path below hides the line and hide() clears
 * painted(). Classification mirrors the fallback provider's
 * applyCompletion: arm the STORE KEY (never a lowercased display),
 * strict tier-0 skip, enableChaining-gated, never on the !consumed
 * forward path.
 *
 * Failure model (editor.ts's): fully defensive, worst case inert — ANY
 * missing member, out-of-range cursor, or throw returns false and the
 * caller forwards the Tab verbatim. Input is never broken.
 *
 * @returns true = consumed (caller must NOT delegate); false = forward.
 */
function insertHighlighted(
  inner: EditorLike,
  state: WidgetStateInternal,
  visibility: VisibilityMachine,
  config: HapaxConfig,
  requestRender?: () => void,
): boolean {
  try {
    if (state.hidden) return false;
    const items = state.items;
    if (items.length === 0) return false;
    // Clamp BEFORE the read — the list can shrink between paints (width
    // truncation, set changes); same rule as the highlight decisions.
    const idx = Math.min(Math.max(state.highlightIndex, 0), items.length - 1);
    const display = items[idx]?.display;
    if (typeof display !== "string" || display === "") return false;

    const lines = (inner.getLines as (() => string[] | undefined) | undefined)?.();
    const cur = (
      inner.getCursor as
        | (() => { line: number; col: number } | undefined)
        | undefined
    )?.();
    if (!lines || !cur) return false;
    const { line, col } = cur;
    if (line < 0 || line >= lines.length) return false;
    const row = lines[line] ?? "";
    if (col < 0 || col > row.length) return false;
    const before = row.slice(0, col);

    // Span to replace (see doc comment for the priority order).
    let spanLen = 0;
    const st = extractMatchState(lines, line, col, config);
    if (st) {
      spanLen = st.prefix.length; // trigger mode: includes the trigger char
    } else if (config.triggerChar !== "") {
      const esc = config.triggerChar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      spanLen =
        before.match(new RegExp(`(?:^|[ \\t])${esc}([^\\s${esc}]*)$`))?.[0].length ?? 0;
    }
    if (spanLen <= 0) {
      const word = before.match(/[A-Za-z][A-Za-z0-9_-]*$/);
      if (word) {
        spanLen = word[0].length;
      } else if (
        state.items.length > 0 &&
        (before === "" || /[ \t]$/.test(before)) &&
        visibility
          .painted()
          [
            Math.min(
              Math.max(state.highlightIndex, 0),
              state.items.length - 1,
            )
          ]?.description === "chain"
      ) {
        // Zero-typed-char acceptance (BUG-001 fix, P1.M1.T2.S1): the
        // visibility machine's CHAIN CONSULT painted a successor offer at
        // an EMPTY word start (cursor right after the separating space),
        // so there is no typed span to replace — a zero-length span
        // inserts the highlighted successor at the cursor. Gated on the
        // highlighted painted record being a chain shim (description
        // "chain"): a word-mode set is never painted at a fragment-less
        // cursor, so this can only be the armed-chain offer — every other
        // position still forwards the literal Tab (never-hijack), and the
        // arming gate at the call site still applies downstream.
        spanLen = 0;
      } else {
        return false; // no fragment span → forward the literal Tab
      }
    }

    const start = col - spanLen;
    const newLine = before.slice(0, start) + display + row.slice(col);
    const newLines = lines.slice();
    newLines[line] = newLine;
    (inner.setText as ((t: string) => void) | undefined)?.(newLines.join("\n"));
    // Caret fix — setText parks the cursor at buffer END; move it after
    // the insertion. Defensive optional call in its own guard: a missing
    // or throwing setCursorCol degrades to end-of-buffer (correct when
    // typing at the end — the common case), never to a crash.
    try {
      (inner.setCursorCol as ((c: number) => void) | undefined)?.(
        start + display.length,
      );
    } catch {
      /* degrade: caret stays at end */
    }
    // Stock parity (see doc comment): applyCompletion notifies onChange;
    // setText does not. Best-effort, never load-bearing for input flow.
    try {
      const text = (inner.getText as (() => string | undefined) | undefined)?.();
      if (typeof text === "string") {
        (inner.onChange as ((t: string) => void) | undefined)?.(text);
      }
    } catch {
      /* an app-side onChange hiccup must never break the keypress */
    }

    state.hide(); // immediate visual dismissal…
    visibility.onDismissed(true); // …+ suppression until the next word start
    try {
      requestRender?.(); // consumed key — no delegation, so ask for a repaint
    } catch {
      /* repaint failures never break input */
    }
    return true; // consumed
  } catch {
    return false; // ANY failure → the caller forwards the Tab verbatim
  }
}

/** Accent fallback for tests/environments without a pi EditorTheme
 *  (theme.selectList.selectedText is the real channel — editor.d.ts/
 *  select-list.d.ts). */
const identityAccent = (text: string): string => text;

/**
 * Compose the widget layer AROUND the captured editor factory: build
 * the inner editor verbatim, wrap it in the Enter-submits guard (which
 * ticks opts.onKeystroke on every input event), and wrap THAT in the
 * widget proxy — the widget layer sees reads and KEYS first (its
 * handleInput override decides arrows/Esc before the guard, spec §07
 * h3.9); the enter-submit guard second; the inner editor last. The
 * inner instance is never mutated (v1 recursion crash lesson). Nested
 * proxies are safe because neither mutates the inner and each owns
 * exactly its own members (r4 doc §2).
 *
 * S2 render override: the get trap intercepts "render" and returns an
 * UNBOUND composing closure — FRESH on every read (never the inner's
 * bound render, never memoized; pi-tui must not see a cached identity,
 * r4 §2 risk note). The closure caches the width (render(width) is the
 * only terminal-width source), calls the inner's render, and appends at
 * most one widget line per the renderWidgetLine contract — or, when
 * there is no content line, returns the inner's lines byte-identical
 * while UNCLAIMED and appends one BLANK line while CLAIMED (Line
 * claim, spec §07).
 */
export function createWidgetEditorFactory(
  opts: WidgetLayerOptions,
): EditorFactory {
  const wrapped: EditorFactory = (tui, theme, keybindings) => {
    // Per-built-editor widget state: a new editor instance starts
    // empty/hidden; T2's visibility machine drives set/hide.
    const state = createWidgetState();

    // Line claim (spec §07, 2026-10): the shared controller from the
    // session wiring when provided (index.ts releases it on
    // before_agent_start / rebind), else one per built editor.
    const claim = opts.claim ?? createLineClaim();

    // ONE-SHOT GRANT tracker (spec/07:450–457, plan 004 T2.S2) — ONE
    // instance per built editor, owned HERE next to the chain machine and
    // shared by both consumers so they cannot drift: the visibility
    // machine's consult branch ticks it before painting offers; the
    // tab-insert arm site below resets it beside chain.arm (fresh grant
    // per acceptance). opts.grant overrides for tests.
    const chainGrant = opts.grant ?? createChainGrantTracker();

    // T2/S1 — the visibility machine. Created per BUILT editor (fresh
    // state per instance, mirroring the S2 state holder). Its editor
    // reads go through the enter-submit proxy once it exists — reads
    // only, bound methods, never a mutation; before that they
    // degrade to an empty state (defensive ?.).
    let editorRef: {
      getLines?: () => string[];
      getCursor?: () => { line: number; col: number };
    } | null = null;
    const machine = createVisibilityMachine({
      store: opts.store,
      config: opts.config,
      restoreReady: opts.restoreReady,
      // plan 004 T2.S2: the factory's grant instance — the SAME object
      // the tab-insert arm site resets (shared state, no drift).
      grant: chainGrant,
      // BUG-001 fix (P1.M1.T2.S1): the SAME chain instance the tab-insert
      // branch arms — evaluate consults it at empty word starts /
      // word-start fragments (the successor-offer half of the fix).
      chain: opts.chain,
      getEditorState: () => ({
        lines: editorRef?.getLines?.() ?? [],
        line: editorRef?.getCursor?.().line ?? 0,
        col: editorRef?.getCursor?.().col ?? 0,
      }),
      // W1 fix: paints that happen OUTSIDE any keystroke tick (the 100 ms
      // swap-timer promotion, gate wakes) must still push into the S2
      // state holder and surface at a render. Lazy machine/applyVisibility
      // references are safe: paint() cannot fire during construction.
      onPaint: () => {
        applyVisibility(machine.getState());
        requestRender();
      },
    });

    // Glue: push the machine's snapshot into the S2 state holder. set()
    // resets the highlight, so it fires only on REAL set changes
    // (signature-compared) — pending-swap ticks re-serve the displayed
    // set without clobbering T3's highlight index.
    let pushedSig: string | null = null;
    const applyVisibility = (st: VisibilityState): void => {
      if (!st.visible || st.currentSet.length === 0) {
        if (!state.hidden) state.hide();
        pushedSig = null;
        return;
      }
      const sig = st.currentSet.map((i) => i.display).join("\u0000");
      if (sig !== pushedSig) {
        state.set(st.currentSet);
        pushedSig = sig;
      }
    };

    // Input clock composition: the SHARED clock ticks first (index.ts's
    // hesitation timing source), then the machine consumes the same
    // event. Both run for EVERY input event (rule 0 — hide/delegate
    // ticks still count for the gap math).
    //
    // W1 FIX (P1.M3.T4.S1 live verification; spec §07 h3.10 rule 2
    // "extract the live fragment"): the enter-submit guard's seam fires
    // BEFORE it delegates the key, so a synchronous machine.onInput()
    // here would read the PRE-keystroke buffer — the rendered set trailed
    // the visible text by one character forever (live-observed: input
    // "zet" showing the "ze" set, resting state stale). The evaluation
    // is therefore deferred to a MICROTASK, which runs after the inner
    // editor has synchronously applied the character, and a repaint is
    // requested because this input event's frame drew the old state.
    const tick = (): void => {
      opts.onKeystroke();
      queueMicrotask(() => {
        applyVisibility(machine.onInput());
        requestRender();
      });
    };

    const inner = createEnterSubmitEditor(
      opts.inner(tui, theme, keybindings),
      keybindings,
      tick,
    );
    editorRef = inner as unknown as NonNullable<typeof editorRef>;

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
    // stays undefined, handleInput stays the guard). This layer adds
    // exactly two members of its own: "render" (S2) and "handleInput"
    // (T3/S1 key layer). Never mutate the inner.
    const innerRecord = inner as unknown as Record<PropertyKey, unknown>;

    // The list the highlight moves within — the state's items AS THE
    // RENDER PATH truncates them (fitItems at the cached width; T1.S2
    // width truncation means the rendered list can be shorter than
    // state.items). Before the first render there is no width and the
    // uncapped-by-width list is the honest list. Zero (empty set,
    // unfittable line) → nothing is on screen → capture nothing
    // (invariant 3).
    const renderedCount = (): number =>
      lastWidth === undefined
        ? state.items.length
        : fitItems(state.items, lastWidth, opts.config.maxSuggestions).length;

    // Forward = the enter-submit proxy's handleInput (the guard — its
    // clock seam keeps ticking and the Enter guard stays in the chain);
    // NEVER the raw inner. The read is dynamic (fresh through the get
    // trap per call — no cached identity can cycle, r4 §2).
    const forwardInput = (data: string): unknown =>
      (innerRecord.handleInput as ((d: string) => unknown) | undefined)?.(data);

    // S2 — the consumed Tab never delegates, so nothing downstream
    // repaints for it; ask the TUI defensively (the factory closure
    // holds tui). insertHighlighted try/catches this — best-effort only.
    const requestRender = (): void => {
      (tui as { requestRender?: () => void } | undefined)?.requestRender?.();
    };

    // T3/S1 — the widget key handler (spec §07 h3.9, 2026-10 model v2):
    // decides BEFORE the enter-submit guard. Consumed = RETURN WITHOUT
    // delegating (navigate/Escape only — the pass-through arm forwards,
    // so the caret moves); forwarded keys reach the guard verbatim,
    // exactly once.
    const widgetHandleInput = (data: string): unknown => {
      // Line claim release (spec §07 "Line claim"): the submit key is
      // the canonical interface reflow — the row is released BEFORE the
      // decision so both arms (the visible enter-submit dismiss-then-
      // forward AND the plain forward while hidden/blank) release
      // identically. isSubmitKey is the guard's OWN test (custom
      // keybindings consistent by construction). Best-effort: a claim
      // hiccup never breaks input.
      try {
        if (isSubmitKey(data, keybindings)) claim.release();
      } catch {
        /* claim failures never break input */
      }
      let decision: WidgetKeyDecision;
      try {
        decision = decideWidgetKey(
          data,
          !state.hidden,
          renderedCount(),
          state.highlightIndex,
          state.interacted,
          keybindings,
        );
      } catch {
        return forwardInput(data); // decision hiccup → degrade to forward
      }
      if (decision.action === "forward") return forwardInput(data);
      if (decision.action === "enter-submit") {
        // S2 — dismiss-then-forward (spec §07 h2.48: Enter ALWAYS
        // submits). The explicit dismissal (suppress until the next
        // word start) lands FIRST, then the key is forwarded: the
        // enter-submit guard stays in the chain (it may still cancel a
        // stock slash/path menu) and the inner editor's own submit
        // branch handles the same keystroke. The guard's clock seam
        // ticks on this delegation — exactly one tick, like every
        // forwarded key.
        try {
          state.hide();
          machine.onDismissed(true);
        } catch {
          /* dismissal hiccups never break the submit */
        }
        return forwardInput(data);
      }
      if (decision.action === "boundary-pass-through") {
        // v2 row 2 — one-press plain-pi parity: the un-entered ↑/← at the
        // first word dismisses AND forwards. Same shape as enter-submit:
        // the explicit dismissal (suppress until the next word start)
        // lands first via the machine's seam, then the key is FORWARDED
        // (the caret moves on this press) BEFORE the consumed-tick block
        // — exactly one tick via the guard's seam, never double-ticked.
        try {
          state.hide();
          machine.onDismissed(true);
        } catch {
          /* dismissal hiccups never break the pass-through */
        }
        return forwardInput(data);
      }
      // Consumed keys never reach the guard, whose clock seam fires
      // only on delegation — tick the shared clock HERE so arrows/Esc
      // count as input activity (hesitation timing). The visibility
      // machine is deliberately NOT ticked: the editor state did not
      // change (consumed keys never move the caret), and a re-
      // evaluation could paint a pending swap and clobber the highlight
      // mid-navigation. Exactly ONE clock tick per keypress, consumed
      // or forwarded.
      try {
        opts.onKeystroke?.();
      } catch {
        /* clock failures never break input */
      }
      try {
        if (decision.action === "navigate") {
          // v2 carousel: apply the delta MODULARLY — a wrap delta
          // ±(count−1) through the old clamping application would null
          // out (the CRITICAL pitfall). count is the RENDERED count
          // (width truncation shrinks the list; the decision used the
          // same number).
          const n = renderedCount();
          if (n > 0) {
            state.highlightIndex =
              (((state.highlightIndex + decision.delta) % n) + n) % n;
          }
          // Any arrow press that MOVES the highlight marks the generation
          // interacted (spec: "the first arrow press that MOVES the
          // highlight marks the generation"). Set on EVERY navigate
          // decision — also covering the defensive row-8 corner
          // (un-interacted i>0 degraded to navigate); the ONLY setter
          // (pass-through, Tab, Enter, Escape never do).
          state.interacted = true;
        } else if (decision.action === "escape") {
          state.hide(); // immediate visual dismissal…
          machine.onDismissed(true); // …+ suppression until the next word
          // start — set ONLY via the machine's seam (it owns the flag).
        } else if (decision.action === "tab-insert") {
          // S2 — synchronous insert of the highlighted word (spec rule
          // 0: Tab only ever completes — it never opens anything). A
          // false return (no live span, missing member, any throw)
          // degrades to forwarding the literal Tab — never-hijack.
          // Capture the accepted record BEFORE the insert:
          // insertHighlighted's success path hides the line, and hide()
          // clears painted() (the machine's lifetime contract) — a
          // post-call read would see [] and never arm.
          const paintedNow = machine.painted();
          const rec =
            paintedNow.length > 0
              ? paintedNow[
                  Math.min(
                    Math.max(state.highlightIndex, 0),
                    paintedNow.length - 1,
                  )
                ]
              : undefined;
          const consumed = insertHighlighted(
            innerRecord as unknown as EditorLike,
            state,
            machine,
            opts.config,
            requestRender,
          );
          if (!consumed) return forwardInput(data); // span-miss forward: NEVER arms
          // Chain arming (BUG-001 fix, 2026-10 — mirrors provider.ts's
          // applyCompletion classification): whole-word, trigger-span,
          // and chain-successor accepts all arm at the accepted record's
          // STORE KEY (rec.key verbatim — never a lowercased display:
          // rule-4d path keys are trimmed-lowercase while displays keep
          // edge slashes, so a display-lowercase misses the successor
          // index). Strict `tier !== 0`: tier-0 anchorless matches never
          // arm or extend a chain (spec §04); records that OMIT tier
          // (chain shims, '#' listings) keep arming. enableChaining gate:
          // the flag false → M1 word-only behavior, byte-identical.
          // Arm + FRESH GRANT (plan 004 T2.S2): the one-shot grant
          // tracker is now WIRED (portned from provider.ts into
          // src/pi/chain-grant.ts) — this arm site resets the factory's
          // shared instance so the NEXT word start offers the accepted
          // word's successors exactly once. opts.chain
          // is the SAME instance index.ts resets on before_agent_start,
          // so reset semantics compose unchanged. An arm() throw lands
          // in this branch's catch — worst case inert, input never
          // breaks (the file's failure model).
          if (opts.config.enableChaining && rec && rec.tier !== 0 && rec.key) {
            opts.chain.arm(rec.key);
            chainGrant.reset();
          }
        }
      } catch {
        /* state/machine failures never break input */
      }
      return undefined; // consumed
    };

    return new Proxy(inner as object, {
      get(_target, prop) {
        if (prop === WIDGET_STATE) return state;
        if (prop === WIDGET_MACHINE) return machine;
        if (prop === "handleInput") return widgetHandleInput;
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
            if (line !== null) {
              // Line claim ARM (spec §07): only a line that actually
              // painted claims the row — an unfittable word never does.
              claim.arm();
              return [...lines, line];
            }
            // No content line: UNCLAIMED → the inner's lines BYTE-IDENTICAL
            // (the widget is structurally absent); CLAIMED → one BLANK row
            // — the reservation is never withdrawn mid-prompt (invariant 3
            // governs CONTENT, and a blank row paints none).
            return claim.held() ? [...lines, ""] : lines;
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
